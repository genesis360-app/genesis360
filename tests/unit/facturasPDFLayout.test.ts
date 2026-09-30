/**
 * Layout de la factura — nada se sale del margen (2026-09-30).
 *
 * La primera factura real de El Tilo mostró la columna "Total" pasada del margen derecho: las columnas de la tabla con
 * IVA sumaban 188/184 mm con 182 mm disponibles. Al sumar la condición IVA completa, la condición de venta y el
 * domicilio del receptor (contador de El Tilo) había más texto largo en el encabezado. Este test arma el PDF REAL
 * (`construirFacturaPDFDoc`) con los peores casos y mide: ancho de la tabla y cada texto dibujado contra los márgenes.
 *
 * Con `FACTURA_LAYOUT_OUT=<dir>` además guarda los PDFs para mirarlos (evidencia visual).
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { construirFacturaPDFDoc, type FacturaPDFData } from '@/lib/facturasPDF'

// jsPDF define `text` por instancia (no en el prototipo): se envuelve la clase para registrar cada texto dibujado.
const textos: { txt: string; x: number; align?: string; w: number }[] = []
vi.mock('jspdf', async (importOriginal) => {
  const m: any = await importOriginal()
  class JsPDFEspia extends m.jsPDF {
    constructor(...a: any[]) {
      super(...a)
      const orig = (this as any).text.bind(this)
      ;(this as any).text = (...args: any[]) => {
        const [txt, x, , opts] = args
        // Ancho medido con la fuente y el tamaño VIGENTES al dibujar (la tabla usa 8 pt, el encabezado 9-10 pt, negrita…).
        for (const t of (Array.isArray(txt) ? txt : [txt])) textos.push({ txt: String(t), x: Number(x), align: opts?.align, w: (this as any).getTextWidth(String(t)) })
        return orig(...args)
      }
    }
  }
  return { ...m, jsPDF: JsPDFEspia, default: JsPDFEspia }
})

const W = 210, MARGEN = 14, EPS = 0.5

const base: FacturaPDFData = {
  tipo_comprobante: 'A', numero_comprobante: 12345678, punto_venta: 5, fecha: '2026-09-30T15:00:00-03:00',
  cae: '86395240625932', vencimiento_cae: '2026-10-10',
  emisor_razon_social: 'Madera Carrizo Hermanos Sociedad de Responsabilidad Limitada', emisor_cuit: '30715985027',
  emisor_domicilio: 'Av. Benavídez 2898, Ruta Provincial 27, Benavídez, Partido de Tigre, Provincia de Buenos Aires',
  emisor_condicion_iva: 'RI', emisor_ingresos_brutos: '30715985027', emisor_inicio_actividades: '2018-04-01',
  emisor_sitio_web: 'www.maderaseltilo.com.ar', emisor_telefono: '11 5555-5555', emisor_email: 'ventas@maderaseltilo.com.ar',
  emisor_banco: 'BBVA', emisor_cbu: '0170368720000000265511', emisor_alias: 'eltilo.maderas',
  emisor_leyenda: 'Gracias por tu compra!',
  receptor_nombre: 'Distribuidora de Maderas y Materiales para la Construcción del Delta Sociedad Anónima',
  receptor_cuit_dni: '30703088534', receptor_condicion_iva: 'Responsable Inscripto',
  receptor_domicilio: 'Av. del Libertador 14.520 Piso 3 Oficina B, entre Alvear y Pueyrredón, Martínez, Partido de San Isidro, Provincia de Buenos Aires (B1640)',
  items: [
    { codigo: 'SKU-00001', descripcion: 'Poste Euc impregnado 1.8m 9/10 diamentro', descripcion_extra: 'Impregnado CCA - 1.8 largo, 9/10 diametro',
      cantidad: 101, precio_unitario: 5750, alicuota_iva: 21, subtotal: 580750 },
    { codigo: 'MAD-TIRANTE-3X6-5.40', descripcion: 'Tirante de pino elliotis cepillado 3" x 6" x 5,40 m seco en horno', cantidad: 1250,
      precio_unitario: 18990.5, alicuota_iva: 10.5, subtotal: 23738125 },
    { codigo: 'EXE-1', descripcion: 'Flete', cantidad: 1, precio_unitario: 99999999.99, alicuota_iva: 0, subtotal: 99999999.99 },
  ],
  total: 580750 + 23738125 + 99999999.99,
  forma_pago: 'Efectivo + Transferencia + Cuenta Corriente',
  condicion_venta: 'Cuenta Corriente',
}

const casos: Record<string, Partial<FacturaPDFData>> = {
  'factura-A-peor-caso': {},
  'factura-B-consumidor-final': { tipo_comprobante: 'B', receptor_nombre: 'Consumidor Final', receptor_cuit_dni: undefined,
    receptor_condicion_iva: 'Consumidor Final', receptor_domicilio: undefined, condicion_venta: 'Contado', forma_pago: 'Efectivo' },
  'factura-C-monotributo': { tipo_comprobante: 'C', emisor_condicion_iva: 'Monotributista', condicion_venta: 'Contado' },
  'nc-A': { tipo_comprobante: 'NC-A', clase: 'nota_credito', forma_pago: null } as any,
  'sin-codigo': { items: base.items.map(i => ({ ...i, codigo: null })) },
  'forma-de-pago-larguisima': { forma_pago: 'Efectivo + Transferencia bancaria + Tarjeta de crédito Visa 3 cuotas + Mercado Pago + Cheque diferido', condicion_venta: 'Contado' },
}

describe('factura — layout dentro de los márgenes', () => {
  for (const [nombre, over] of Object.entries(casos)) {
    it(nombre, async () => {
      textos.length = 0
      const doc = await construirFacturaPDFDoc({ ...base, ...over } as FacturaPDFData)
      expect(textos.length, 'anti-vacío: no se registró ningún texto').toBeGreaterThan(20)

      // Tabla: ancho total ≤ ancho entre márgenes.
      const t = (doc as any).lastAutoTable
      const anchoTabla = t.columns.reduce((s: number, c: any) => s + c.width, 0)
      expect(anchoTabla, `${nombre}: la tabla mide ${anchoTabla.toFixed(1)} mm`).toBeLessThanOrEqual(W - 2 * MARGEN + EPS)

      // Texto fuera de la tabla: ninguno se pasa del margen derecho (ni arranca antes del izquierdo).
      for (const { txt, x, align, w } of textos) {
        if (!txt.trim()) continue
        const fin = align === 'right' ? x : align === 'center' ? x + w / 2 : x + w
        const ini = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
        expect(fin, `${nombre}: "${txt.slice(0, 60)}" termina en ${fin.toFixed(1)} mm`).toBeLessThanOrEqual(W - MARGEN + EPS)
        expect(ini, `${nombre}: "${txt.slice(0, 60)}" empieza en ${ini.toFixed(1)} mm`).toBeGreaterThanOrEqual(MARGEN - EPS)
      }

      // El nombre del producto (negrita, dibujado a mano por los hooks) no se mete en la columna siguiente.
      const conCod = ({ ...base, ...over } as FacturaPDFData).items.some(i => (i.codigo ?? '').trim())
      const colDesc = t.columns[conCod ? 1 : 0]
      const items = ({ ...base, ...over } as FacturaPDFData).items
      for (const { txt, w } of textos) {
        if (!items.some(i => i.descripcion_extra && i.descripcion.includes(txt.trim()) && txt.trim().length > 3)) continue
        expect(w, `${nombre}: el nombre "${txt}" mide ${w.toFixed(1)} mm en una columna de ${colDesc.width.toFixed(1)}`)
          .toBeLessThanOrEqual(colDesc.width - 3)
      }

      const out = process.env.FACTURA_LAYOUT_OUT
      if (out) {
        fs.mkdirSync(out, { recursive: true })
        fs.writeFileSync(path.join(out, `${nombre}.pdf`), Buffer.from(doc.output('arraybuffer')))
      }
    })
  }
})
