// Reglas puras del importador del Maestro (src/lib/importarMaestro.ts, mig 452).
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { colorHex, numeroCelda, siNo, tipoMotivo, validarMaestro, type ContextoMaestro } from '@/lib/importarMaestro'

const ctx = (c: Partial<ContextoMaestro> = {}): ContextoMaestro => ({ existentes: [], xlsx: XLSX, ...c })
const EST = [
  { id: 'e-disp', nombre: 'Disponible' },
  { id: 'e-prox', nombre: 'Próx a Vencer' },
  { id: 'e-venc', nombre: 'Vencido' },
  { id: 'e-viejo', nombre: 'Viejo', activo: false },
]
const PROD = [
  { id: 'p1', sku: 'SKU-001', nombre: 'Shampoo' },
  { id: 'p2', sku: 'SKU-002', nombre: 'Crema' },
  { id: 'p3', sku: 'SKU-003', nombre: 'Baja', activo: false },
]

describe('helpers', () => {
  it('tipoMotivo: egreso (plantilla vieja) = rebaje; vacío = ambos; desconocido = inválido', () => {
    expect(tipoMotivo('egreso')).toBe('rebaje')
    expect(tipoMotivo(' Rebaje ')).toBe('rebaje')
    expect(tipoMotivo('')).toBe('ambos')
    expect(tipoMotivo('salida')).toBe('invalido')
  })
  it('colorHex: normaliza y no inventa un color', () => {
    expect(colorHex('#AABBCC')).toBe('#aabbcc')
    expect(colorHex('22c55e')).toBe('#22c55e')
    expect(colorHex('')).toBeNull()
    expect(colorHex('rojo')).toBe('invalido')
  })
  it('numeroCelda: coma decimal sí, separador de miles NO (1.500 no es 1,5)', () => {
    expect(numeroCelda('10,5')).toBe(10.5)
    expect(numeroCelda(500)).toBe(500)
    expect(numeroCelda('1.500')).toBe('invalido')
    expect(numeroCelda('')).toBeNull()
  })
  it('siNo', () => {
    expect(siNo('Sí')).toBe(true)
    expect(siNo('')).toBe(false)
    expect(siNo('quizás')).toBe('invalido')
  })
})

describe('tipos simples', () => {
  it('lo existente se ignora (sin distinguir mayúsculas ni espacios) y no va a la carga', () => {
    const v = validarMaestro('categorias', [{ nombre: 'ferretería ' }, { nombre: 'Pinturería' }],
      ctx({ existentes: [{ id: 'c1', nombre: 'Ferretería' }] }))
    expect(v.filas.map(f => f.estado)).toEqual(['existente', 'nuevo'])
    expect(v.items).toEqual([{ fila: 3, nombre: 'Pinturería', descripcion: null }])
  })
  it('nombre repetido en el archivo o vacío = error, y con un error no se carga nada', () => {
    const v = validarMaestro('categorias', [{ nombre: 'A' }, { nombre: 'a' }, { nombre: '' }, { nombre: 'B' }], ctx())
    expect(v.filas[0].errores[0]).toMatch(/repetido.*filas 2, 3/)
    expect(v.filas[2].errores[0]).toMatch(/Falta el nombre/)
    expect(v.items).toEqual([])
  })
  it('estados: color inválido es error (antes se elegía uno al azar)', () => {
    const v = validarMaestro('estados', [{ nombre: 'X', color: 'rojo' }], ctx())
    expect(v.filas[0].errores[0]).toMatch(/Color "rojo" inválido/)
  })
  it('motivos: el ejemplo de la plantilla vieja ("egreso") ahora carga como rebaje', () => {
    const v = validarMaestro('motivos', [{ nombre: 'Venta mayorista', tipo: 'egreso' }], ctx())
    expect(v.items).toEqual([{ fila: 2, nombre: 'Venta mayorista', tipo: 'rebaje' }])
  })
  it('ubicaciones: el mismo nombre en OTRA sucursal es nuevo; código usado o mal formado = error', () => {
    const existentes = [
      { id: 'u1', nombre: 'Depósito', sucursal_id: 'S2', codigo: 'DEP' },
      { id: 'u2', nombre: 'Góndola', sucursal_id: 'S1', codigo: 'G1' },
    ]
    const v = validarMaestro('ubicaciones', [
      { nombre: 'Depósito', codigo: '' }, { nombre: 'Góndola' }, { nombre: 'Frío', codigo: 'dep' }, { nombre: 'Patio', codigo: 'a b' },
    ], ctx({ existentes, sucursalId: 'S1' }))
    expect(v.filas.map(f => f.estado)).toEqual(['nuevo', 'existente', 'error', 'error'])
    expect(v.filas[2].errores[0]).toMatch(/ya lo usa la ubicación "Depósito"/)
    expect(v.filas[3].errores[0]).toMatch(/inválido/)
  })
})

describe('grupos de estados', () => {
  it('un estado inexistente o desactivado es error (antes se salteaba en silencio)', () => {
    const v = validarMaestro('grupos', [
      { nombre: 'G', estados: 'Disponible|Inexistente' }, { nombre: 'H', estados: 'Viejo' },
    ], ctx({ estados: EST }))
    expect(v.filas[0].errores[0]).toMatch(/Estado "Inexistente" no existe/)
    expect(v.filas[1].errores[0]).toMatch(/desactivado/)
  })
  it('sin estados = error; dos predeterminados = error en los dos', () => {
    const v = validarMaestro('grupos', [
      { nombre: 'A', estados: '', es_default: 'SI' }, { nombre: 'B', estados: 'Disponible', es_default: 'si' },
    ], ctx({ estados: EST }))
    expect(v.filas[0].errores.join()).toMatch(/al menos un estado/)
    expect(v.filas[0].errores.join()).toMatch(/Solo un grupo/)
    expect(v.filas[1].errores.join()).toMatch(/Solo un grupo/)
  })
  it('ok → ids de estado sin duplicar', () => {
    const v = validarMaestro('grupos', [{ nombre: 'Vendible', estados: 'Disponible|Próx a Vencer|disponible', es_default: 'SI' }], ctx({ estados: EST }))
    expect(v.items).toEqual([{ fila: 2, nombre: 'Vendible', descripcion: null, es_default: true, estados: ['e-disp', 'e-prox'] }])
  })
})

describe('perfiles de vencimiento', () => {
  it('agrupa por perfil; estado inexistente = error de la fila (antes se salteaba)', () => {
    const v = validarMaestro('aging', [
      { nombre_perfil: 'PERECEDERO', estado: 'Próx a Vencer', dias: 30 },
      { nombre_perfil: 'PERECEDERO', estado: 'Fantasma', dias: 0 },
    ], ctx({ estados: EST }))
    expect(v.filas[0].estado).toBe('nuevo')
    expect(v.filas[1].errores[0]).toMatch(/Estado "Fantasma" no existe/)
    expect(v.items).toEqual([])
  })
  it('un perfil que ya existe se ignora ENTERO (antes se le agregaban reglas duplicadas)', () => {
    const v = validarMaestro('aging', [
      { nombre_perfil: 'Estandar', estado: 'Vencido', dias: 0 },
      { nombre_perfil: 'Nuevo', estado: 'Vencido', dias: 0 },
      { nombre_perfil: 'Nuevo', estado: 'Próx a Vencer', dias: 15 },
    ], ctx({ estados: EST, existentes: [{ id: 'a1', nombre: 'ESTANDAR' }] }))
    expect(v.filas.map(f => f.estado)).toEqual(['existente', 'nuevo', 'nuevo'])
    expect(v.items).toEqual([{ fila: 3, nombre: 'Nuevo', reglas: [
      { fila: 3, estado_id: 'e-venc', dias: 0 }, { fila: 4, estado_id: 'e-prox', dias: 15 },
    ] }])
  })
  it('estado o días repetidos dentro del perfil = error', () => {
    const v = validarMaestro('aging', [
      { nombre_perfil: 'P', estado: 'Vencido', dias: 0 },
      { nombre_perfil: 'P', estado: 'Vencido', dias: 5 },
      { nombre_perfil: 'P', estado: 'Próx a Vencer', dias: 5 },
    ], ctx({ estados: EST }))
    expect(v.filas[1].errores.join()).toMatch(/dos veces/)
    expect(v.filas[2].errores.join()).toMatch(/mismos días/)
  })
})

describe('combos', () => {
  it('varias filas con el mismo nombre = UN combo con sus productos (antes se creaba sin productos)', () => {
    const v = validarMaestro('combos', [
      { nombre: 'Pack', sku: 'sku-001', cantidad: 1, descuento_tipo: 'monto_ars', descuento_valor: '500', vigencia_desde: '01/10/2026', vigencia_hasta: '31/12/2026' },
      { nombre: 'Pack', sku: 'SKU-002', cantidad: 2 },
    ], ctx({ productos: PROD }))
    expect(v.filas.every(f => f.estado === 'nuevo')).toBe(true)
    expect(v.items).toEqual([{
      fila: 2, nombre: 'Pack', descuento_tipo: 'monto_ars', descuento_valor: 500,
      vigencia_desde: '2026-10-01', vigencia_hasta: '2026-12-31',
      items: [{ fila: 2, producto_id: 'p1', cantidad: 1 }, { fila: 3, producto_id: 'p2', cantidad: 2 }],
    }])
  })
  it('acepta la columna sku_producto de la plantilla vieja', () => {
    const v = validarMaestro('combos', [{ nombre: '3x', sku_producto: 'SKU-001', cantidad: 3, descuento_tipo: 'pct', descuento_valor: 10 }], ctx({ productos: PROD }))
    expect((v.items[0] as any).items).toEqual([{ fila: 2, producto_id: 'p1', cantidad: 3 }])
  })
  it('SKU inexistente/desactivado, % > 100, un solo producto con cantidad 1 = error', () => {
    const v = validarMaestro('combos', [
      { nombre: 'A', sku: 'NO-EXISTE', cantidad: 2, descuento_tipo: 'pct', descuento_valor: 10 },
      { nombre: 'B', sku: 'SKU-003', cantidad: 2, descuento_tipo: 'pct', descuento_valor: 10 },
      { nombre: 'C', sku: 'SKU-001', cantidad: 2, descuento_tipo: 'pct', descuento_valor: 150 },
      { nombre: 'D', sku: 'SKU-001', cantidad: 1, descuento_tipo: 'pct', descuento_valor: 5 },
    ], ctx({ productos: PROD }))
    expect(v.filas[0].errores.join()).toMatch(/no existe en el catálogo/)
    expect(v.filas[1].errores.join()).toMatch(/desactivado/)
    expect(v.filas[2].errores.join()).toMatch(/no puede superar 100/)
    expect(v.filas[3].errores.join()).toMatch(/cantidad 2 o más/)
  })
  it('descuento distinto entre filas del mismo combo, monto ambiguo o fechas al revés = error', () => {
    const v = validarMaestro('combos', [
      { nombre: 'X', sku: 'SKU-001', cantidad: 1, descuento_tipo: 'monto_ars', descuento_valor: '1.500', vigencia_desde: '31/12/2026', vigencia_hasta: '01/10/2026' },
      { nombre: 'X', sku: 'SKU-002', cantidad: 1, descuento_tipo: 'pct' },
    ], ctx({ productos: PROD }))
    expect(v.filas[1].errores.join()).toMatch(/distinto al de la fila 2/)
    expect(v.filas[0].errores.join()).toMatch(/sin separador de miles/)
    expect(v.filas[0].errores.join()).toMatch(/posterior/)
  })
  it('un combo activo con ese nombre se ignora', () => {
    const v = validarMaestro('combos', [{ nombre: 'Pack', sku: 'SKU-001', cantidad: 2, descuento_tipo: 'pct', descuento_valor: 5 }],
      ctx({ productos: PROD, existentes: [{ id: 'c', nombre: 'pack' }] }))
    expect(v.filas[0].estado).toBe('existente')
    expect(v.items).toEqual([])
  })
})
