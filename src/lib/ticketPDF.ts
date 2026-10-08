// PDF del ticket de venta (no fiscal) para la página pública de comprobantes compartidos (/c/<código>, mig 451).
// El ticket del POS se imprime desde la pantalla; acá se arma un PDF angosto (80 mm) con los mismos datos.
import jsPDF from 'jspdf'

export interface TicketCompartidoData {
  negocio: string
  etiqueta: string            // "Venta #123" / "SUC1-0042"
  fecha: string               // ISO
  cliente?: string | null
  items: { nombre: string; cantidad: number; subtotal: number }[]
  total: number
  medio_pago?: string | null
  vuelto?: number | null
  estado?: string | null      // 'despachada' | 'reservada'…
  saldo?: number | null
  entrega?: string[] | null   // 🚚 transporte + n° de envío, fecha/horario (lineasEntregaTicket)
}

const $ = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function construirTicketPDF(d: TicketCompartidoData): jsPDF {
  const ancho = 80
  const alto = Math.max(120, 70 + d.items.length * 9 + (d.entrega?.length ?? 0) * 5)
  const doc = new jsPDF({ unit: 'mm', format: [ancho, alto] })
  let y = 10
  const centro = (t: string, size = 9, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size)
    for (const l of doc.splitTextToSize(t, ancho - 10)) { doc.text(l, ancho / 2, y, { align: 'center' }); y += size * 0.45 }
  }
  centro(d.negocio, 12, true); y += 1
  centro(d.etiqueta, 9)
  centro(new Date(d.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }), 8)
  if (d.cliente) centro(`Cliente: ${d.cliente}`, 8)
  centro('Comprobante no válido como factura', 7)
  y += 2; doc.setLineDashPattern([1, 1], 0).line(5, y, ancho - 5, y); y += 5

  doc.setFont('helvetica', 'normal').setFontSize(8)
  for (const it of d.items) {
    const nombre = doc.splitTextToSize(`${it.cantidad} × ${it.nombre}`, ancho - 32)
    doc.text(nombre, 5, y)
    doc.text($(it.subtotal), ancho - 5, y, { align: 'right' })
    y += nombre.length * 3.6 + 1.5
  }
  y += 1; doc.line(5, y, ancho - 5, y); y += 6
  doc.setFont('helvetica', 'bold').setFontSize(11)
  doc.text('TOTAL', 5, y); doc.text($(d.total), ancho - 5, y, { align: 'right' }); y += 6
  doc.setFont('helvetica', 'normal').setFontSize(8)
  if (d.medio_pago) { for (const l of doc.splitTextToSize(`Pago: ${d.medio_pago}`, ancho - 10)) { doc.text(l, 5, y); y += 3.6 } }
  if (d.vuelto) { doc.text(`Vuelto: ${$(d.vuelto)}`, 5, y); y += 4 }
  if (d.saldo) { doc.setFont('helvetica', 'bold'); doc.text(`Saldo a pagar: ${$(d.saldo)}`, 5, y); y += 4 }
  if (d.entrega?.length) {
    y += 2; doc.line(5, y, ancho - 5, y); y += 5
    doc.setFont('helvetica', 'normal').setFontSize(8)
    for (const l of d.entrega) { for (const t of doc.splitTextToSize(l, ancho - 10)) { doc.text(t, 5, y); y += 3.6 } }
  }
  y += 3
  centro(d.estado === 'reservada' ? '¡Gracias! Guardá este comprobante para retirar.' : '¡Gracias por su compra!', 8)
  return doc
}
