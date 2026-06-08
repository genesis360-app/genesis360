import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatMoneda as formatMonedaLib } from '@/lib/formato'
import { montoAnticipo, labelBaseCuota, montoCuota, type CuotaSchedule } from '@/lib/comprasPago'

// Compras · CO7/A6 + CO8/G3 — PDF imprimible de una Orden de Compra + texto para email/WhatsApp.

export interface OCItemPDF {
  nombre: string
  cantidad: number
  precio_unitario?: number | null
}

export interface OCPDFData {
  negocio: string
  moneda: string
  numeroLabel: string            // 'S1-OC-0001' o '#12'
  fecha: string                  // ISO
  fechaEsperada?: string | null  // YYYY-MM-DD
  sucursal?: string | null
  proveedor: { nombre: string; cuit?: string | null; email?: string | null; telefono?: string | null; condiciones?: string | null }
  items: OCItemPDF[]
  costoEnvio?: number | null
  costoAduana?: number | null
  costoComision?: number | null
  costoOtros?: number | null
  pagaConAnticipo?: boolean
  anticipoPct?: number | null
  pagoSchedule?: CuotaSchedule[] | null
  notas?: string | null
}

export function subtotalItems(items: OCItemPDF[]): number {
  return items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0)
}

export function totalOC(d: OCPDFData): number {
  return subtotalItems(d.items)
    + (d.costoEnvio ?? 0) + (d.costoAduana ?? 0) + (d.costoComision ?? 0) + (d.costoOtros ?? 0)
}

/** A6 — texto plano para WhatsApp / cuerpo de email. */
export function textoOC(d: OCPDFData): string {
  const fmt = (n: number) => formatMonedaLib(n, d.moneda)
  const lineas: string[] = []
  lineas.push(`*Orden de Compra ${d.numeroLabel}* — ${d.negocio}`)
  lineas.push(`Proveedor: ${d.proveedor.nombre}`)
  if (d.fechaEsperada) lineas.push(`Entrega esperada: ${new Date(d.fechaEsperada + 'T12:00:00').toLocaleDateString('es-AR')}`)
  lineas.push('')
  lineas.push('Detalle:')
  for (const it of d.items) {
    const sub = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0)
    lineas.push(`• ${it.cantidad} x ${it.nombre}${it.precio_unitario ? ` — ${fmt(sub)}` : ''}`)
  }
  const total = totalOC(d)
  lineas.push('')
  lineas.push(`TOTAL: ${fmt(total)}`)
  if (d.pagaConAnticipo && d.anticipoPct) {
    lineas.push(`Anticipo (${d.anticipoPct}%): ${fmt(montoAnticipo(total, d.anticipoPct))}`)
  }
  if (d.pagoSchedule && d.pagoSchedule.length) {
    lineas.push('Plan de pagos:')
    for (const c of d.pagoSchedule) lineas.push(`  - ${labelBaseCuota(c)} (${c.pct}%): ${fmt(montoCuota(total, c.pct))}`)
  }
  if (d.proveedor.condiciones) lineas.push(`Condiciones: ${d.proveedor.condiciones}`)
  if (d.notas) { lineas.push(''); lineas.push(`Notas: ${d.notas}`) }
  return lineas.join('\n')
}

/** A6/G3 — PDF imprimible de la OC. output 'save' descarga; 'doc' devuelve el jsPDF. */
export function generarOCPDF(d: OCPDFData, output: 'save' | 'doc' = 'save'): jsPDF {
  const fmt = (n: number) => formatMonedaLib(n, d.moneda)
  const doc = new jsPDF()

  doc.setFontSize(16); doc.setTextColor(30, 58, 95)
  doc.text(d.negocio, 14, 18)
  doc.setFontSize(12); doc.setTextColor(60)
  doc.text(`Orden de Compra ${d.numeroLabel}`, 14, 26)
  doc.setFontSize(10); doc.setTextColor(90)
  let y = 34
  doc.text(`Fecha: ${new Date(d.fecha).toLocaleDateString('es-AR')}`, 14, y); y += 5
  if (d.fechaEsperada) { doc.text(`Entrega esperada: ${new Date(d.fechaEsperada + 'T12:00:00').toLocaleDateString('es-AR')}`, 14, y); y += 5 }
  if (d.sucursal) { doc.text(`Sucursal: ${d.sucursal}`, 14, y); y += 5 }
  doc.text(`Proveedor: ${d.proveedor.nombre}`, 14, y); y += 5
  if (d.proveedor.cuit) { doc.text(`CUIT: ${d.proveedor.cuit}`, 14, y); y += 5 }
  if (d.proveedor.condiciones) { doc.text(`Condiciones de pago: ${d.proveedor.condiciones}`, 14, y); y += 5 }

  const rows = d.items.map(it => {
    const sub = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0)
    return [it.nombre, String(it.cantidad), it.precio_unitario ? fmt(it.precio_unitario) : '—', it.precio_unitario ? fmt(sub) : '—']
  })
  const total = totalOC(d)

  autoTable(doc, {
    startY: y + 3,
    head: [['Producto', 'Cantidad', 'Precio unit.', 'Subtotal']],
    body: rows.length ? rows : [['—', '—', '—', '—']],
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 95] },
    styles: { fontSize: 9 },
  })

  let yEnd = (doc as any).lastAutoTable.finalY + 6
  const accesorios: [string, number | null | undefined][] = [
    ['Envío', d.costoEnvio], ['Aduana', d.costoAduana], ['Comisión', d.costoComision], ['Otros', d.costoOtros],
  ]
  doc.setFontSize(10); doc.setTextColor(60)
  for (const [label, val] of accesorios) {
    if (val && val > 0) { doc.text(`${label}: ${fmt(val)}`, 140, yEnd); yEnd += 5 }
  }
  doc.setFontSize(12); doc.setTextColor(30, 58, 95)
  doc.text(`TOTAL: ${fmt(total)}`, 140, yEnd); yEnd += 7

  doc.setFontSize(10); doc.setTextColor(90)
  if (d.pagaConAnticipo && d.anticipoPct) {
    doc.text(`Anticipo (${d.anticipoPct}%): ${fmt(montoAnticipo(total, d.anticipoPct))}`, 14, yEnd); yEnd += 5
  }
  if (d.pagoSchedule && d.pagoSchedule.length) {
    doc.text('Plan de pagos:', 14, yEnd); yEnd += 5
    for (const c of d.pagoSchedule) {
      doc.text(`  • ${labelBaseCuota(c)} (${c.pct}%): ${fmt(montoCuota(total, c.pct))}`, 14, yEnd); yEnd += 5
    }
  }
  if (d.notas) { doc.text(`Notas: ${d.notas}`, 14, yEnd); yEnd += 5 }

  if (output === 'doc') return doc
  doc.save(`OC_${d.numeroLabel.replace(/[^\w-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`)
  return doc
}

/** A6 — link wa.me con el texto de la OC. Teléfono normalizado (solo dígitos). */
export function waLinkOC(telefono: string | null | undefined, texto: string): string {
  const tel = (telefono ?? '').replace(/\D/g, '')
  const base = tel ? `https://wa.me/${tel}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(texto)}`
}
