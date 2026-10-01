// Reglas compartidas de los importadores (src/lib/importacion.ts) — D3-a / D3-b.
import { describe, it, expect } from 'vitest'
import {
  filaExcel,
  filasConErrorParaExportar,
  generarSkusAutomaticos,
  mensajeErrorCarga,
  resolverReferencia,
  skusRepetidos,
} from '@/lib/importacion'

const cats = [
  { id: 'c1', nombre: 'Almacén', activo: true },
  { id: 'c2', nombre: 'Bebidas', activo: false },
  { id: 'c3', nombre: 'Limpieza', activo: null },
]

describe('resolverReferencia (D3-a / D3-b)', () => {
  it('encuentra sin distinguir mayúsculas ni espacios de más', () => {
    expect(resolverReferencia('  almacén ', cats, 'Categoría')).toEqual({ id: 'c1' })
  })
  it('vacía → sin referencia y sin error', () => {
    expect(resolverReferencia('', cats, 'Categoría')).toEqual({ id: null })
  })
  it('desactivada → error "reactivala o elegí otra"', () => {
    expect(resolverReferencia('Bebidas', cats, 'Categoría').error).toBe('Categoría "Bebidas" está desactivada: reactivala o elegí otra')
  })
  it('activo NULL cuenta como activa', () => {
    expect(resolverReferencia('Limpieza', cats, 'Categoría')).toEqual({ id: 'c3' })
  })
  it('inexistente → no se crea: dice dónde crearla', () => {
    expect(resolverReferencia('Fiambres', cats, 'Categoría').error).toMatch(/no existe — creala primero en Configuración/)
    expect(resolverReferencia('ACME', [], 'Proveedor').error).toMatch(/no existe — crealo primero en Proveedores/)
  })
  it('si hay una activa y otra desactivada con el mismo nombre, usa la activa', () => {
    expect(resolverReferencia('dup', [{ id: 'a', nombre: 'Dup', activo: false }, { id: 'b', nombre: 'dup', activo: true }], 'Proveedor')).toEqual({ id: 'b' })
  })
})

describe('skusRepetidos', () => {
  it('devuelve las filas de Excel (encabezado = 1) de cada SKU repetido, sin distinguir mayúsculas', () => {
    const r = skusRepetidos(['A1', 'b2', '', 'a1', 'B2 ', 'C3'])
    expect(r.get('A1')).toEqual([2, 5])
    expect(r.get('B2')).toEqual([3, 6])
    expect(r.has('C3')).toBe(false)
    expect(r.has('')).toBe(false)
  })
})

describe('generarSkusAutomaticos', () => {
  it('saltea los que ya existen (en el negocio o en el archivo)', () => {
    expect(generarSkusAutomaticos(3, ['AUTO-0001', 'auto-0003'])).toEqual(['AUTO-0002', 'AUTO-0004', 'AUTO-0005'])
  })
  it('cero pedidos → lista vacía', () => {
    expect(generarSkusAutomaticos(0, [])).toEqual([])
  })
})

describe('filasConErrorParaExportar', () => {
  it('solo las filas con error, con su número de Excel y el motivo antes de las columnas originales', () => {
    const originales = [{ sku: 'A', precio: 1 }, { sku: 'B', precio: -1 }, { sku: 'C', precio: 2 }]
    const filas = filasConErrorParaExportar(originales, [
      { idx: 0, errores: [] }, { idx: 1, errores: ['Precio inválido', 'Nombre requerido'] }, { idx: 2, errores: [] },
    ])
    expect(filas).toEqual([{ fila: 3, motivo: 'Precio inválido · Nombre requerido', sku: 'B', precio: -1 }])
    expect(Object.keys(filas[0]).slice(0, 2)).toEqual(['fila', 'motivo'])
  })
  it('filaExcel: índice 0 = fila 2', () => {
    expect(filaExcel(0)).toBe(2)
  })
})

describe('mensajeErrorCarga', () => {
  it('error de la base con la fila → "No se cargó nada." + el detalle', () => {
    expect(mensajeErrorCarga({ message: 'Fila 151 (SKU X): ya existe un producto con ese SKU' }))
      .toBe('No se cargó nada. Fila 151 (SKU X): ya existe un producto con ese SKU')
  })
  it('timeout → dividir el archivo', () => {
    expect(mensajeErrorCarga({ code: '57014', message: 'canceling statement due to statement timeout' })).toMatch(/dividí el archivo/)
  })
  it('corte de red → avisa que es todo o nada antes de reintentar', () => {
    expect(mensajeErrorCarga({ message: 'TypeError: Failed to fetch' })).toMatch(/todo o nada/)
  })
})

describe('resolverReferencia — ubicación y estado (importador de inventario)', () => {
  it('mensajes con el género y el lugar correctos', () => {
    expect(resolverReferencia('Dep A', [{ id: 'u', nombre: 'Dep A', activo: false }], 'Ubicación').error).toBe('Ubicación "Dep A" está desactivada: reactivala o elegí otra')
    expect(resolverReferencia('Dep Z', [], 'Ubicación').error).toBe('Ubicación "Dep Z" no existe — tiene que existir en esta sucursal')
    expect(resolverReferencia('Roto', [{ id: 'e', nombre: 'Roto', activo: false }], 'Estado').error).toBe('Estado "Roto" está desactivado: reactivalo o elegí otro')
    expect(resolverReferencia('ACME', [{ id: 'p', nombre: 'ACME', activo: false }], 'Proveedor').error).toBe('Proveedor "ACME" está desactivado: reactivalo o elegí otro')
  })
})
