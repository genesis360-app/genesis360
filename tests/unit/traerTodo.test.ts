import { describe, it, expect, vi } from 'vitest'
import { traerTodo, TAMANO_LOTE } from '@/lib/traerTodo'

/**
 * Simula PostgREST: tiene `total` filas y NUNCA devuelve más de `tope` por respuesta, aunque le
 * pidan un rango más grande. Ese recorte silencioso es exactamente el bug que `traerTodo` resuelve.
 */
function baseFalsa(total: number, tope = TAMANO_LOTE) {
  const llamadas: Array<[number, number]> = []
  const traerLote = async (desde: number, hasta: number) => {
    llamadas.push([desde, hasta])
    const pedidas = hasta - desde + 1
    const filas = Array.from(
      { length: Math.max(0, Math.min(pedidas, tope, total - desde)) },
      (_, i) => ({ id: desde + i }),
    )
    return { data: filas, error: null }
  }
  return { traerLote, llamadas }
}

describe('traerTodo', () => {
  it('trae las 1177 filas que la query sin paginar dejaba en 1000', async () => {
    const { traerLote, llamadas } = baseFalsa(1177)
    const filas = await traerTodo<{ id: number }>(traerLote)

    expect(filas).toHaveLength(1177)
    expect(filas[0].id).toBe(0)
    expect(filas[1176].id).toBe(1176)      // la última, la que antes no existía para la app
    expect(llamadas).toEqual([[0, 999], [1000, 1999]])
  })

  it('con menos de una tanda hace una sola llamada', async () => {
    const { traerLote, llamadas } = baseFalsa(40)
    expect(await traerTodo(traerLote)).toHaveLength(40)
    expect(llamadas).toHaveLength(1)
  })

  it('lista vacía: una llamada y ningún ciclo de más', async () => {
    const { traerLote, llamadas } = baseFalsa(0)
    expect(await traerTodo(traerLote)).toEqual([])
    expect(llamadas).toHaveLength(1)
  })

  // 🛑 El borde que en la versión ingenua deja un ciclo infinito o una fila fantasma: el total es
  // EXACTAMENTE un múltiplo del lote, así que la última tanda vuelve vacía.
  it('total múltiplo exacto del lote: pide una tanda más y corta', async () => {
    const { traerLote, llamadas } = baseFalsa(2000)
    const filas = await traerTodo(traerLote)
    expect(filas).toHaveLength(2000)
    expect(llamadas).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('propaga el error de la base en vez de devolver una lista a medias', async () => {
    const traerLote = async () => ({ data: null, error: { message: 'permission denied' } })
    await expect(traerTodo(traerLote)).rejects.toThrow('permission denied')
  })

  it('respeta el techo de seguridad y AVISA de que quedó incompleto', async () => {
    const onTecho = vi.fn()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { traerLote } = baseFalsa(10_000, 100)

    const filas = await traerTodo(traerLote, { tamanoLote: 100, maxFilas: 300, onTecho })

    expect(filas).toHaveLength(300)
    expect(onTecho).toHaveBeenCalledWith(300)
    expect(spy).toHaveBeenCalled()          // el corte nunca puede ser silencioso
    spy.mockRestore()
  })

  it('acepta un tamaño de lote propio', async () => {
    const { traerLote, llamadas } = baseFalsa(250, 100)
    expect(await traerTodo(traerLote, { tamanoLote: 100 })).toHaveLength(250)
    expect(llamadas).toEqual([[0, 99], [100, 199], [200, 299]])
  })
})
