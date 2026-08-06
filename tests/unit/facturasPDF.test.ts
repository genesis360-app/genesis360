import { describe, it, expect } from 'vitest'
import {
  normalizarCondIVA, formatCuit, formatFecha, fmtPesos, nombreFacturaPDF,
  sanitizarNombreArchivo, cantidadCelda, precioUnitarioCelda, composicionUnitaria,
  type FacturaPDFData,
} from '@/lib/facturasPDF'

// Incidente 2026-07: comprobantes con CUIT vacío llegaron a producción sin que la suite lo
// detectara — testeábamos el CAE, no el DOCUMENTO ("nadie mira el papel"). Este archivo cubre el
// contenido real que termina impreso: lo que un humano miraría en el papel.

type Item = FacturaPDFData['items'][number]
const item = (over: Partial<Item> = {}): Item => ({
  descripcion: 'Producto test', cantidad: 1, precio_unitario: 100, alicuota_iva: 21, subtotal: 100,
  ...over,
})

describe('normalizarCondIVA', () => {
  it('mapea las claves conocidas a su label', () => {
    expect(normalizarCondIVA('responsable_inscripto')).toBe('Responsable Inscripto')
    expect(normalizarCondIVA('monotributo')).toBe('Monotributo')
    expect(normalizarCondIVA('exento')).toBe('Exento')
    expect(normalizarCondIVA('consumidor_final')).toBe('Consumidor Final')
  })
  it('sin valor → Consumidor Final (default seguro)', () => {
    expect(normalizarCondIVA(undefined)).toBe('Consumidor Final')
    expect(normalizarCondIVA(null)).toBe('Consumidor Final')
    expect(normalizarCondIVA('')).toBe('Consumidor Final')
  })
  it('clave desconocida → se devuelve tal cual (no la pisa con el default)', () => {
    expect(normalizarCondIVA('Un valor ya legible')).toBe('Un valor ya legible')
  })
})

describe('formatCuit — 🛑 el campo del incidente de CUIT vacío', () => {
  it('CUIT de 11 dígitos se formatea con guiones XX-XXXXXXXX-X', () => {
    expect(formatCuit('20409378472')).toBe('20-40937847-2')
  })
  it('CUIT ya con guiones/espacios se limpia y reformatea igual', () => {
    expect(formatCuit('20-40937847-2')).toBe('20-40937847-2')
  })
  it('no son 11 dígitos (ej. DNI, o vacío) → se devuelve tal cual, sin inventar guiones', () => {
    expect(formatCuit('12345678')).toBe('12345678')
    expect(formatCuit('')).toBe('')
  })
})

describe('formatFecha', () => {
  it('fecha ISO solo-día (10 chars) NO se corre un día por huso horario (mig histórica)', () => {
    expect(formatFecha('2026-01-01')).toBe('01/01/2026')
    expect(formatFecha('2026-12-31')).toBe('31/12/2026')
  })
  it('vacío/undefined → string vacío, no explota ni imprime "Invalid Date"', () => {
    expect(formatFecha('')).toBe('')
  })
})

describe('fmtPesos', () => {
  it('default 2 decimales, separador de miles y coma decimal es-AR', () => {
    expect(fmtPesos(1234.5)).toBe('$1.234,50')
  })
  it('0 → "$0,00", no "$-0,00" ni vacío', () => {
    expect(fmtPesos(0)).toBe('$0,00')
  })
  it('decimales configurable (P. Unitario que necesita más precisión para multiplicar)', () => {
    expect(fmtPesos(333.333, 3)).toBe('$333,333')
  })
  it('negativo se formatea con signo, no se oculta', () => {
    expect(fmtPesos(-50)).toBe('$-50,00')
  })
})

describe('sanitizarNombreArchivo', () => {
  it('saca tildes/ñ y caracteres no alfanuméricos', () => {
    expect(sanitizarNombreArchivo('José Ñañez S.A.')).toBe('Jose_Nanez_SA')
  })
  it('colapsa espacios múltiples en un solo _', () => {
    expect(sanitizarNombreArchivo('Juan   Pérez')).toBe('Juan_Perez')
  })
  it('trunca a 40 caracteres (nombre de archivo no puede ser gigante)', () => {
    const largo = 'A'.repeat(60)
    expect(sanitizarNombreArchivo(largo).length).toBeLessThanOrEqual(40)
  })
  it('vacío/undefined → string vacío', () => {
    expect(sanitizarNombreArchivo(undefined)).toBe('')
    expect(sanitizarNombreArchivo('')).toBe('')
  })
})

describe('nombreFacturaPDF', () => {
  const base: FacturaPDFData = {
    tipo_comprobante: 'B', numero_comprobante: 45, punto_venta: 3, fecha: '2026-01-01',
    cae: '1', vencimiento_cae: '2026-01-10', emisor_razon_social: 'x', emisor_cuit: '20409378472',
    emisor_condicion_iva: 'responsable_inscripto', receptor_nombre: 'Juan Pérez', total: 100,
    items: [],
  }
  it('padea punto de venta a 4 dígitos y número a 8', () => {
    expect(nombreFacturaPDF(base)).toBe('Factura_B_0003-00000045_Juan_Perez.pdf')
  })
  it('nota de crédito usa el prefijo NotaCredito y la letra sin el prefijo NC-', () => {
    expect(nombreFacturaPDF({ ...base, clase: 'nota_credito', tipo_comprobante: 'NC-B' }))
      .toBe('NotaCredito_B_0003-00000045_Juan_Perez.pdf')
  })
  it('sin nombre de cliente no deja un "_" colgado al final', () => {
    expect(nombreFacturaPDF({ ...base, receptor_nombre: '' })).toBe('Factura_B_0003-00000045.pdf')
  })
})

describe('cantidadCelda — venta por Unidad de Medida (backlog Fede 4/6/7)', () => {
  it('sin UoM: muestra la cantidad base tal cual (entero sin decimales)', () => {
    expect(cantidadCelda(item({ cantidad: 5 }))).toBe('5')
  })
  it('sin UoM, cantidad fraccionaria: 3 decimales', () => {
    expect(cantidadCelda(item({ cantidad: 2.5 }))).toBe('2.500')
  })
  it('🛑 con UoM: muestra la cantidad de la UoM vendida (ej. "3 Caja"), NUNCA las unidades base internas', () => {
    expect(cantidadCelda(item({ cantidad: 36, cantidad_uom: 3, unidad_medida: 'Caja' }))).toBe('3 Caja')
  })
  it('cantidad_uom sin unidad_medida (dato incompleto) → cae a la cantidad base, no la ignora en silencio con NaN', () => {
    expect(cantidadCelda(item({ cantidad: 36, cantidad_uom: 3, unidad_medida: undefined }))).toBe('36')
  })
})

describe('precioUnitarioCelda — 🛑 la factura tiene que MULTIPLICAR (UAT §48)', () => {
  it('caso simple: subtotal/cantidad exacto a 2 decimales', () => {
    expect(precioUnitarioCelda(item({ cantidad: 2, subtotal: 200 }))).toBe('$100,00')
  })
  it('$1.000 en 3 bultos: sube la precisión hasta que unitario × cantidad = importe impreso', () => {
    const out = precioUnitarioCelda(item({ cantidad: 3, subtotal: 1000 }))
    const digitos = out.replace(/[^0-9,]/g, '').replace(',', '.')
    expect(Math.round(parseFloat(digitos) * 3 * 100) / 100).toBeCloseTo(1000, 2)
  })
  it('con UoM: usa la cantidad de la UoM (no la base) para la división', () => {
    // 6 unidades base = 2 Cajas de 3u, subtotal $600 → precio de LA CAJA = $300, no $100 (por unidad base)
    expect(precioUnitarioCelda(item({ cantidad: 6, cantidad_uom: 2, unidad_medida: 'Caja', subtotal: 600 })))
      .toBe('$300,00')
  })
  it('divisor (Factura A, neto): divide el subtotal por (1+alícuota/100) antes de repartir por cantidad', () => {
    // subtotal $121 con IVA 21% incluido → neto $100, cantidad 1 → P.Unit.Neto $100
    expect(precioUnitarioCelda(item({ cantidad: 1, subtotal: 121, alicuota_iva: 21 }), 1.21)).toBe('$100,00')
  })
})

describe('composicionUnitaria — 🛑 el hallazgo real de GO: "la factura dice 2700 y no sé por qué"', () => {
  it('con UoM y más de 1 unidad base por bulto: muestra "N u × $precio_unitario"', () => {
    // 2 Cajas de 6u = 12 unidades base, precio_unitario (de la unidad base) $450
    expect(composicionUnitaria(item({ cantidad: 12, cantidad_uom: 2, unidad_medida: 'Caja', precio_unitario: 450 })))
      .toBe('6 u × $450,00')
  })
  it('sin UoM → null (no hay nada que descomponer)', () => {
    expect(composicionUnitaria(item({ cantidad: 5 }))).toBeNull()
  })
  it('UoM pero 1 unidad base por bulto (ej. "Unidad" = "Unidad") → null, sería redundante mostrar "1 u × $X"', () => {
    expect(composicionUnitaria(item({ cantidad: 1, cantidad_uom: 1, unidad_medida: 'Unidad', precio_unitario: 450 })))
      .toBeNull()
  })
  it('cantidad_uom en 0 (dato corrupto) → null, no divide por cero', () => {
    expect(composicionUnitaria(item({ cantidad: 6, cantidad_uom: 0, unidad_medida: 'Caja' }))).toBeNull()
  })
})
