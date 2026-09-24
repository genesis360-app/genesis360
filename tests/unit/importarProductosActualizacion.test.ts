import { describe, it, expect } from 'vitest'
import {
  celdaTieneValor, columnasConValor, payloadParaActualizar, problemaDePrecio,
} from '@/lib/importarProductosActualizacion'

// D-3 (`tests/specs/uat-modo-basico.md` §66.8): al actualizar, el importador reescribía la fila
// entera y borraba lo que el archivo no traía. Regla de GO (2026-09-23): lo que el archivo trae
// manda; lo que no trae, no se toca.

// Un payload con los campos que el importador escribe de verdad.
const PAYLOAD = {
  tenant_id: 'ten-1',
  nombre: 'Tornillo',
  sku: 'TORN-0001',
  codigo_barras: '7791234567890',
  categoria_id: 'cat-1',
  proveedor_id: 'prov-1',
  precio_costo: 150,
  precio_costo_usd: null,
  moneda_costo: 'local',
  precio_costo_moneda: 'ARS',
  precio_venta: 250,
  precio_usd: null,
  moneda_venta: 'local',
  precio_venta_moneda: 'ARS',
  stock_minimo: 10,
  unidad_medida: 'unidad',
  descripcion: 'Acero inoxidable',
  notas: 'nota interna',
  activo: true,
  alicuota_iva: 21,
  margen_objetivo: 35,
  tiene_series: false,
  tiene_lote: false,
  tiene_vencimiento: false,
  regla_inventario: 'FIFO',
  es_kit: false,
}

describe('celdaTieneValor', () => {
  it.each(['', '   ', null, undefined])('trata %p como vacío', (v) => {
    expect(celdaTieneValor(v)).toBe(false)
  })

  it('🛑 el 0 es un VALOR, no un vacío', () => {
    // El caso real: alicuota_iva = 0 (exento). Tratarlo como vacío dejaría el IVA sin actualizar.
    expect(celdaTieneValor(0)).toBe(true)
    expect(celdaTieneValor('0')).toBe(true)
  })

  it('🛑 el false también es un VALOR', () => {
    expect(celdaTieneValor(false)).toBe(true)
  })

  it('acepta texto y números normales', () => {
    expect(celdaTieneValor('ARS')).toBe(true)
    expect(celdaTieneValor(150)).toBe(true)
  })
})

describe('columnasConValor', () => {
  it('devuelve solo las columnas con contenido', () => {
    const cols = columnasConValor({ sku: 'A-1', precio_venta: 100, descripcion: '', notas: '   ' })
    expect([...cols].sort()).toEqual(['precio_venta', 'sku'])
  })

  it('no explota con una fila vacía', () => {
    expect(columnasConValor({}).size).toBe(0)
  })
})

describe('payloadParaActualizar — el fix de D-3', () => {
  it('un archivo de sku + precio SOLO toca el precio', () => {
    // 🛑 Este es el caso que borraba datos: antes reescribía las 26 columnas.
    const parcial = payloadParaActualizar(PAYLOAD, new Set(['sku', 'precio_venta']))
    expect(Object.keys(parcial).sort()).toEqual(
      ['moneda_venta', 'precio_usd', 'precio_venta', 'precio_venta_moneda'],
    )
  })

  it('no toca proveedor, descripción, código de barras, IVA ni trazabilidad', () => {
    const parcial = payloadParaActualizar(PAYLOAD, new Set(['sku', 'precio_venta'])) as Record<string, unknown>
    for (const campo of ['proveedor_id', 'descripcion', 'codigo_barras', 'alicuota_iva',
                         'tiene_series', 'tiene_lote', 'tiene_vencimiento', 'notas',
                         'margen_objetivo', 'regla_inventario', 'es_kit', 'categoria_id']) {
      expect(parcial).not.toHaveProperty(campo)
    }
  })

  it('nunca escribe el sku ni el tenant_id: el sku es la clave de búsqueda', () => {
    const parcial = payloadParaActualizar(PAYLOAD, new Set(['sku', 'nombre'])) as Record<string, unknown>
    expect(parcial).not.toHaveProperty('sku')
    expect(parcial).not.toHaveProperty('tenant_id')
    expect(parcial).toHaveProperty('nombre')
  })

  it('el precio y su moneda viajan en grupo, para no dejar el producto incoherente', () => {
    // Traer solo la columna de moneda también arrastra el grupo: cambiar la moneda sin recalcular
    // el espejo en pesos dejaría el monto viejo con la moneda nueva.
    const parcial = payloadParaActualizar(PAYLOAD, new Set(['precio_costo_moneda']))
    expect(Object.keys(parcial).sort()).toEqual(
      ['moneda_costo', 'precio_costo', 'precio_costo_moneda', 'precio_costo_usd'],
    )
  })

  it('el costo y la venta son grupos independientes', () => {
    const parcial = payloadParaActualizar(PAYLOAD, new Set(['precio_costo'])) as Record<string, unknown>
    expect(parcial).toHaveProperty('precio_costo')
    expect(parcial).not.toHaveProperty('precio_venta')
  })

  it('con IVA 0 (exento) SÍ actualiza el IVA', () => {
    // El 0 es un valor válido con significado. Si se tratara como vacío, un producto exento nunca
    // podría marcarse como tal por importación.
    const cols = columnasConValor({ sku: 'A-1', alicuota_iva: 0 })
    const parcial = payloadParaActualizar({ ...PAYLOAD, alicuota_iva: 0 }, cols) as Record<string, unknown>
    expect(parcial.alicuota_iva).toBe(0)
  })

  it('una fila sin ninguna columna útil devuelve un objeto vacío', () => {
    // Quien llama lo usa para NO mandar un UPDATE que no cambiaría nada.
    expect(Object.keys(payloadParaActualizar(PAYLOAD, new Set(['sku'])))).toEqual([])
  })

  it('un archivo completo actualiza todo menos sku y tenant_id', () => {
    const todas = new Set(['nombre', 'codigo_barras', 'categoria', 'proveedor', 'precio_costo',
      'precio_costo_moneda', 'precio_venta', 'precio_venta_moneda', 'stock_minimo', 'unidad_medida',
      'descripcion', 'notas', 'activo', 'alicuota_iva', 'margen_objetivo', 'tiene_series',
      'tiene_lote', 'tiene_vencimiento', 'regla_inventario', 'es_kit'])
    const parcial = payloadParaActualizar(PAYLOAD, todas)
    expect(Object.keys(parcial).length).toBe(Object.keys(PAYLOAD).length - 2)
  })

  it('🛑 activo solo se toca si el archivo lo trae', () => {
    // Antes estaba fijo en `true`: exportar y reimportar te reactivaba los productos dados de baja.
    expect(payloadParaActualizar(PAYLOAD, new Set(['precio_venta']))).not.toHaveProperty('activo')
    expect(payloadParaActualizar(PAYLOAD, new Set(['activo']))).toHaveProperty('activo')
  })
})

describe('problemaDePrecio — REGLA #0, las dos direcciones', () => {
  describe('precio sin moneda', () => {
    it('producto en dólares = ambiguo', () => {
      // ¿100 pesos o 100 dólares? Asumir pesos lo dejaría a ~1/1400 de su valor.
      expect(problemaDePrecio(new Set(['precio_venta']), 'usd', 'venta')).toBe('sin-moneda')
    })

    it('si el archivo aclara la moneda, no hay problema', () => {
      expect(problemaDePrecio(new Set(['precio_venta', 'precio_venta_moneda']), 'usd', 'venta')).toBeNull()
    })

    it('un producto en pesos nunca es ambiguo', () => {
      expect(problemaDePrecio(new Set(['precio_venta']), 'local', 'venta')).toBeNull()
      expect(problemaDePrecio(new Set(['precio_venta']), null, 'venta')).toBeNull()
    })
  })

  describe('🛑 moneda sin precio — zerorearía el precio', () => {
    it('traer solo la columna de moneda se rechaza, esté el producto en pesos o en dólares', () => {
      // El precio y su moneda se escriben en grupo, y una columna ausente se parsea como 0: sin este
      // chequeo, "quiero corregirle solo la moneda" dejaba el producto en $0 sin ningún aviso.
      expect(problemaDePrecio(new Set(['precio_venta_moneda']), 'local', 'venta')).toBe('sin-precio')
      expect(problemaDePrecio(new Set(['precio_venta_moneda']), 'usd', 'venta')).toBe('sin-precio')
      expect(problemaDePrecio(new Set(['precio_venta_moneda']), null, 'venta')).toBe('sin-precio')
    })

    it('con las dos columnas no hay problema', () => {
      expect(problemaDePrecio(new Set(['precio_venta', 'precio_venta_moneda']), 'local', 'venta')).toBeNull()
    })
  })

  it('si el archivo no toca ni el precio ni la moneda, no hay nada que decidir', () => {
    expect(problemaDePrecio(new Set(['descripcion']), 'usd', 'venta')).toBeNull()
  })

  it('el costo se evalúa por separado de la venta', () => {
    expect(problemaDePrecio(new Set(['precio_costo']), 'usd', 'costo')).toBe('sin-moneda')
    expect(problemaDePrecio(new Set(['precio_costo']), 'usd', 'venta')).toBeNull()
    expect(problemaDePrecio(new Set(['precio_costo_moneda']), 'local', 'costo')).toBe('sin-precio')
  })
})
