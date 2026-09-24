import { useEffect, useMemo, useState } from 'react'
import { useListaConteoStore } from '@/store/listaConteoStore'

/**
 * Paginado de un listado ya filtrado, con el selector de cuántos registros mostrar (pedido de GO,
 * 2026-09-24: *"el contador con filtro para poder visualizar 50, 100 o 500 registros, y que si hay
 * más del filtro aplicado puedan pasar de página o cargar más"*).
 *
 * 🛑 Pagina lo que se RENDERIZA, no lo que se trae. Las páginas que lo usan filtran, agrupan y
 * suman del lado del cliente sobre el set completo (stock por producto, totales, alertas): si el
 * paginado fuera de la query, el buscador solo buscaría dentro de la página actual y las sumas
 * saldrían mal — que es exactamente el bug que estamos sacando. El set completo lo garantiza
 * `traerTodo()`; esto solo evita dibujar 5.000 filas de una.
 *
 * La barra la pinta `AppLayout` (ver `listaConteoStore`), así que acá no se renderiza nada.
 */

export const TAMANOS_PAGINA = [50, 100, 500] as const
export const TAMANO_PAGINA_DEFAULT = 100

/** Debajo de esto no tiene sentido paginar: se muestra el contador de siempre y listo. */
export const MINIMO_PARA_PAGINAR = TAMANOS_PAGINA[0]

interface Opciones {
  /** Total sin filtrar, para el "de N" del contador. Por defecto, el largo de `items`. */
  total?: number
  /** El total viene de una query con límite y puede no ser exacto (ej. Envíos: "los últimos 100"). */
  totalTruncado?: boolean
  /** Clave de las condiciones de filtrado: cuando cambian, volvemos a la página 1. */
  claveFiltros?: unknown
  /**
   * `false` deja la barra como el contador de siempre y devuelve la lista entera. Para vistas donde
   * paginar rompería la estructura — p.ej. la vista agrupada de Productos, donde una madre y sus
   * variantes tienen que quedar juntas.
   */
  habilitado?: boolean
}

export function usePaginacionLista<T>(
  items: T[],
  entidad: string,
  { total, totalTruncado = false, claveFiltros, habilitado = true }: Opciones = {},
): T[] {
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_DEFAULT)
  const [pagina, setPagina] = useState(0)

  const setConteo = useListaConteoStore(s => s.setConteo)
  const clearConteo = useListaConteoStore(s => s.clearConteo)

  const cantidad = items.length
  const totalReal = total ?? cantidad
  const pagina_ = Math.min(pagina, Math.max(0, Math.ceil(cantidad / tamano) - 1))

  // Al cambiar el filtro o el tamaño, volver al principio: quedarse en la página 7 de una lista que
  // ahora tiene 2 páginas deja la pantalla vacía sin explicar por qué.
  useEffect(() => { setPagina(0) }, [claveFiltros, tamano])

  const visibles = useMemo(
    () => (habilitado && cantidad > tamano ? items.slice(pagina_ * tamano, (pagina_ + 1) * tamano) : items),
    [items, cantidad, tamano, pagina_, habilitado],
  )

  useEffect(() => {
    const totalPaginas = Math.max(1, Math.ceil(cantidad / tamano))
    setConteo({
      mostrados: visibles.length,
      total: totalReal,
      entidad,
      totalTruncado,
      paginacion: habilitado && cantidad > MINIMO_PARA_PAGINAR
        ? {
            pagina: pagina_,
            tamano,
            totalPaginas,
            desde: cantidad === 0 ? 0 : pagina_ * tamano + 1,
            hasta: Math.min((pagina_ + 1) * tamano, cantidad),
            setPagina,
            setTamano,
          }
        : undefined,
    })
    return () => clearConteo()
  }, [visibles.length, cantidad, totalReal, entidad, totalTruncado, tamano, pagina_, habilitado, setConteo, clearConteo])

  return visibles
}
