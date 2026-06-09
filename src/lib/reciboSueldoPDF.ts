import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── RH3 — B6: recibo de sueldo PDF imprimible (con líneas de firma empleado+empleador) ──

export interface ReciboItem {
  descripcion: string
  tipo: 'HABER' | 'DESCUENTO'
  monto: number
}

export interface ReciboSueldoData {
  negocio: string
  cuit?: string | null
  empleado: string
  dni?: string | null
  puesto?: string | null
  periodo: string            // YYYY-MM-01
  basico: number
  items: ReciboItem[]
  totalHaberes: number
  totalDescuentos: number
  neto: number
  moneda?: string
}

const fmt = (n: number, moneda = 'ARS') =>
  `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function periodoLabel(periodo: string): string {
  const d = new Date(periodo + 'T00:00:00')
  if (isNaN(d.getTime())) return periodo
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

/** Genera y descarga el recibo de sueldo en PDF. */
export function generarReciboSueldoPDF(data: ReciboSueldoData): void {
  const doc = new jsPDF()
  const moneda = data.moneda ?? 'ARS'

  doc.setFontSize(15); doc.setFont('helvetica', 'bold')
  doc.text(data.negocio || 'Recibo de sueldo', 14, 18)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  if (data.cuit) doc.text(`CUIT: ${data.cuit}`, 14, 24)
  doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.text('RECIBO DE SUELDO', 196, 18, { align: 'right' })
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text(`Período: ${periodoLabel(data.periodo)}`, 196, 24, { align: 'right' })

  // Datos del empleado
  let y = 34
  doc.setDrawColor(200); doc.line(14, y, 196, y); y += 6
  doc.setFont('helvetica', 'bold'); doc.text('Empleado:', 14, y)
  doc.setFont('helvetica', 'normal'); doc.text(data.empleado, 40, y)
  if (data.dni) { doc.setFont('helvetica', 'bold'); doc.text('DNI/CUIL:', 130, y); doc.setFont('helvetica', 'normal'); doc.text(String(data.dni), 155, y) }
  y += 6
  if (data.puesto) { doc.setFont('helvetica', 'bold'); doc.text('Puesto:', 14, y); doc.setFont('helvetica', 'normal'); doc.text(data.puesto, 40, y); y += 6 }

  // Detalle
  autoTable(doc, {
    startY: y + 2,
    head: [['Concepto', 'Haberes', 'Descuentos']],
    body: data.items.map(it => [
      it.descripcion,
      it.tipo === 'HABER' ? fmt(it.monto, moneda) : '',
      it.tipo === 'DESCUENTO' ? fmt(it.monto, moneda) : '',
    ]),
    foot: [
      ['Totales', fmt(data.totalHaberes, moneda), fmt(data.totalDescuentos, moneda)],
      ['NETO A COBRAR', '', fmt(data.neto, moneda)],
    ],
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 95] },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  })

  // Firmas
  const afterY = (doc as any).lastAutoTable.finalY + 30
  doc.setDrawColor(120)
  doc.line(24, afterY, 90, afterY)
  doc.line(120, afterY, 186, afterY)
  doc.setFontSize(9)
  doc.text('Firma del empleado', 30, afterY + 5)
  doc.text('Firma del empleador', 128, afterY + 5)

  const fecha = new Date().toISOString().split('T')[0]
  doc.save(`recibo_${(data.empleado || 'sueldo').replace(/\s+/g, '_')}_${data.periodo.slice(0, 7)}_${fecha}.pdf`)
}
