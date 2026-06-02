import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatMoneda as formatMonedaLib } from '@/lib/formato'

export interface EstadoCuentaVenta {
  numero: number
  fecha: string          // ISO
  saldo: number
  interes: number
  vencimiento?: string | null  // YYYY-MM-DD
}

export interface EstadoCuentaArgs {
  negocio: string
  moneda: string
  cliente: { nombre: string; telefono?: string | null; email?: string | null }
  ventas: EstadoCuentaVenta[]
  /** Si se pasa, descarga el archivo; si no, devuelve el doc para previsualizar. */
  output?: 'save' | 'doc'
}

/**
 * B8 — Estado de cuenta del cliente (PDF). Reusado por la ficha (ClientesPage) y
 * por el portal público (CuentaClientePage) con los mismos datos normalizados.
 */
export function generarEstadoCuentaPDF(args: EstadoCuentaArgs): jsPDF {
  const { negocio, moneda, cliente, ventas, output = 'save' } = args
  const fmt = (n: number) => formatMonedaLib(n, moneda)
  const doc = new jsPDF()
  const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  doc.setFontSize(16); doc.setTextColor(30, 58, 95)
  doc.text(negocio, 14, 18)
  doc.setFontSize(12); doc.setTextColor(60)
  doc.text('Estado de cuenta', 14, 26)
  doc.setFontSize(10); doc.setTextColor(90)
  doc.text(`Cliente: ${cliente.nombre}`, 14, 34)
  let y = 39
  if (cliente.telefono) { doc.text(`Tel: ${cliente.telefono}`, 14, y); y += 5 }
  if (cliente.email) { doc.text(`Email: ${cliente.email}`, 14, y); y += 5 }
  doc.text(`Emitido: ${hoy}`, 14, y); y += 4

  const rows = ventas.map(v => {
    const venc = v.vencimiento ? new Date(v.vencimiento + 'T12:00:00') : null
    const vencida = venc ? venc < new Date(new Date().toDateString()) : false
    return [
      `#${v.numero}`,
      new Date(v.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      venc ? venc.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + (vencida ? ' (vencida)' : '') : '—',
      v.interes > 0.5 ? fmt(v.interes) : '—',
      fmt(v.saldo + (v.interes || 0)),
    ]
  })
  const totalDeuda = ventas.reduce((a, v) => a + v.saldo + (v.interes || 0), 0)

  autoTable(doc, {
    startY: y + 4,
    head: [['Venta', 'Fecha', 'Vencimiento', 'Interés mora', 'Saldo']],
    body: rows.length ? rows : [['—', '—', '—', '—', fmt(0)]],
    foot: [['', '', '', 'Total adeudado', fmt(totalDeuda)]],
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 95] },
    footStyles: { fillColor: [240, 240, 240], textColor: [200, 30, 30], fontStyle: 'bold' },
    styles: { fontSize: 9 },
  })

  if (output === 'doc') return doc
  doc.save(`estado_cuenta_${cliente.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`)
  return doc
}
