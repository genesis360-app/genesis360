import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cargarLogo, normalizarCondIVA } from '@/lib/facturasPDF'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface PresupuestoPDFData {
  numero: string                  // ej: "PRES-0594"
  fecha: string                   // ISO
  validez_hasta?: string | null   // ISO — fecha de vto del presupuesto

  // Emisor (tenant)
  emisor_razon_social: string
  emisor_cuit: string
  emisor_domicilio?: string | null
  emisor_condicion_iva: string
  emisor_logo_url?: string | null

  // Receptor (cliente)
  receptor_nombre: string
  receptor_cuit_dni?: string | null
  receptor_condicion_iva?: string | null
  receptor_domicilio?: string | null

  // Ítems
  items: {
    codigo?: string | null
    descripcion: string
    cantidad: number
    precio_unitario: number
    subtotal: number
  }[]

  total: number
  observaciones?: string | null
}

// ─── Generador ────────────────────────────────────────────────────────────────

async function construirPresupuestoDoc(data: PresupuestoPDFData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210

  // ── Logo (arriba a la izquierda, opcional) ───────────────────────────────────
  const logo = data.emisor_logo_url ? await cargarLogo(data.emisor_logo_url) : null
  let emX = 14
  if (logo) {
    const LOGO_MAX_W = 26, LOGO_MAX_H = 20
    const ratio = Math.min(LOGO_MAX_W / logo.w, LOGO_MAX_H / logo.h)
    const lw = logo.w * ratio, lh = logo.h * ratio
    doc.addImage(logo.dataUrl, 'PNG', 14, 9, lw, lh)
    emX = 14 + lw + 4
  }

  // ── Encabezado izquierdo — emisor ────────────────────────────────────────────
  const LEFT_W = 120 - emX
  let y = 15
  doc.setFontSize(14).setFont('helvetica', 'bold').setTextColor(0)
  for (const ln of (doc.splitTextToSize(data.emisor_razon_social, LEFT_W) as string[])) {
    doc.text(ln, emX, y); y += 6
  }
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80)
  doc.text(`CUIT: ${formatCuit(data.emisor_cuit)}`, emX, y); y += 5
  if (data.emisor_domicilio) {
    for (const ln of (doc.splitTextToSize(data.emisor_domicilio, LEFT_W) as string[])) {
      doc.text(ln, emX, y); y += 5
    }
  }
  doc.text(`IVA: ${normalizarCondIVA(data.emisor_condicion_iva)}`, emX, y); y += 5

  // ── Encabezado derecho — título + datos del documento ────────────────────────
  const RX = W - 14
  doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(0)
  doc.text('PRESUPUESTO', RX, 16, { align: 'right' })
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80)
  doc.text(`N° ${data.numero}`, RX, 23, { align: 'right' })
  doc.text(`Fecha: ${formatFecha(data.fecha)}`, RX, 28, { align: 'right' })
  if (data.validez_hasta) {
    doc.text(`Válido hasta: ${formatFecha(data.validez_hasta)}`, RX, 33, { align: 'right' })
  }

  // ── Línea divisoria ──────────────────────────────────────────────────────────
  const lineY = Math.max(y, 36) + 3
  doc.setDrawColor(180).setLineWidth(0.3)
  doc.line(14, lineY, W - 14, lineY)

  // ── Receptor ─────────────────────────────────────────────────────────────────
  let ry = lineY + 6
  doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0)
  doc.text('DATOS DEL CLIENTE', 14, ry); ry += 5
  doc.setFont('helvetica', 'normal').setTextColor(60)
  doc.text(`Nombre / Razón Social: ${data.receptor_nombre}`, 14, ry); ry += 5
  if (data.receptor_cuit_dni) {
    const docLabel = data.receptor_cuit_dni.replace(/\D/g, '').length === 11 ? 'CUIT' : 'DNI'
    doc.text(`${docLabel}: ${data.receptor_cuit_dni}`, 14, ry); ry += 5
  }
  if (data.receptor_condicion_iva) {
    doc.text(`Condición IVA: ${data.receptor_condicion_iva}`, 14, ry); ry += 5
  }
  if (data.receptor_domicilio) {
    doc.text(`Domicilio: ${data.receptor_domicilio}`, 14, ry); ry += 5
  }

  // ── Tabla de ítems (sin discriminar IVA — el presupuesto no es comprobante fiscal) ─
  const tieneCodigo = data.items.some(i => (i.codigo ?? '').trim().length > 0)
  const head = tieneCodigo
    ? [['Cód.', 'Descripción', 'Cant.', 'P. Unitario', 'Importe']]
    : [['Descripción', 'Cant.', 'P. Unitario', 'Importe']]
  const rows = data.items.map(item => {
    const base = [
      String(item.cantidad % 1 === 0 ? item.cantidad : item.cantidad.toFixed(3)),
      fmtPesos(item.subtotal / item.cantidad),
      fmtPesos(item.subtotal),
    ]
    return tieneCodigo
      ? [item.codigo ?? '', item.descripcion, ...base]
      : [item.descripcion, ...base]
  })
  autoTable(doc, {
    startY:     ry + 3,
    margin:     { left: 14, right: 14 },
    head,
    body:       rows,
    headStyles: { fillColor: [30, 58, 95], fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 8 },
    columnStyles: tieneCodigo
      ? { 0: { cellWidth: 24 }, 1: { cellWidth: 86 }, 2: { halign: 'center', cellWidth: 18 }, 3: { halign: 'right', cellWidth: 29 }, 4: { halign: 'right', cellWidth: 29 } }
      : { 0: { cellWidth: 96 }, 1: { halign: 'center', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 33 }, 3: { halign: 'right', cellWidth: 33 } },
    theme: 'striped',
  })

  // ── Total ────────────────────────────────────────────────────────────────────
  let ty = (doc as any).lastAutoTable.finalY + 8
  doc.setFontSize(12).setFont('helvetica', 'bold').setTextColor(0)
  doc.text('TOTAL:', W - 14 - 50, ty, { align: 'right' })
  doc.text(fmtPesos(data.total), W - 14, ty, { align: 'right' })
  ty += 10

  // ── Observaciones ────────────────────────────────────────────────────────────
  if (data.observaciones && data.observaciones.trim()) {
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0)
    doc.text('Observaciones:', 14, ty); ty += 5
    doc.setFont('helvetica', 'normal').setTextColor(60)
    for (const ln of (doc.splitTextToSize(data.observaciones.trim(), W - 28) as string[])) {
      doc.text(ln, 14, ty); ty += 5
    }
  }

  // ── Pie ───────────────────────────────────────────────────────────────────────
  doc.setDrawColor(180).setLineWidth(0.3)
  doc.line(14, 280, W - 14, 280)
  doc.setFontSize(7).setTextColor(150)
  doc.text('Presupuesto — no válido como comprobante fiscal', W / 2, 285, { align: 'center' })

  return doc
}

function nombrePresupuestoPDF(data: PresupuestoPDFData): string {
  const cli = sanitizarNombreArchivo(data.receptor_nombre)
  return `Presupuesto_${data.numero}${cli ? '_' + cli : ''}.pdf`
}

/** Genera el PDF del presupuesto y lo descarga (default) o lo abre para imprimir. */
export async function generarPresupuestoPDF(
  data: PresupuestoPDFData,
  accion: 'descargar' | 'imprimir' = 'descargar',
): Promise<void> {
  const doc = await construirPresupuestoDoc(data)
  if (accion === 'imprimir') {
    doc.autoPrint()
    const url = doc.output('bloburl') as unknown as string
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0'
    iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0'
    iframe.src = url
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() } catch { /* el visor ya imprime */ }
      setTimeout(() => iframe.remove(), 60_000)
    }
    document.body.appendChild(iframe)
  } else {
    doc.save(nombrePresupuestoPDF(data))
  }
}

/** Genera el PDF del presupuesto como base64 (sin prefijo data:) + nombre, para email. */
export async function generarPresupuestoPDFBase64(
  data: PresupuestoPDFData,
): Promise<{ base64: string; filename: string }> {
  const doc = await construirPresupuestoDoc(data)
  const dataUri = doc.output('datauristring')
  return { base64: dataUri.split(',')[1] ?? '', filename: nombrePresupuestoPDF(data) }
}

// ─── Helpers (espejo de facturasPDF, presupuesto es standalone) ────────────────

function fmtPesos(v: number): string {
  return `$${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCuit(cuit: string): string {
  const d = (cuit ?? '').replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
  return cuit ?? ''
}

function formatFecha(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function sanitizarNombreArchivo(s?: string): string {
  if (!s) return ''
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40)
}
