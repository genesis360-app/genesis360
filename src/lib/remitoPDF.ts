import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cargarLogo, normalizarCondIVA } from '@/lib/facturasPDF'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface RemitoPDFData {
  numero: string                  // ej: "R-0001"
  fecha: string                   // ISO

  // Emisor
  emisor_razon_social: string
  emisor_cuit: string
  emisor_domicilio?: string | null
  emisor_condicion_iva: string
  emisor_logo_url?: string | null
  emisor_ingresos_brutos?: string | null
  emisor_inicio_actividades?: string | null
  emisor_telefono?: string | null
  emisor_email?: string | null
  emisor_sitio_web?: string | null
  emisor_leyenda?: string | null

  // Receptor
  receptor_nombre: string
  receptor_cuit_dni?: string | null
  receptor_condicion_iva?: string | null
  receptor_domicilio?: string | null

  // Ítems (remito = qué se entrega; sin precios)
  items: { codigo?: string | null; descripcion: string; cantidad: number }[]

  observaciones?: string | null
}

// ─── Generador ────────────────────────────────────────────────────────────────

async function construirRemitoDoc(data: RemitoPDFData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210

  // ── Logo ─────────────────────────────────────────────────────────────────────
  const logo = data.emisor_logo_url ? await cargarLogo(data.emisor_logo_url) : null
  let emX = 14
  if (logo) {
    const LOGO_MAX_W = 26, LOGO_MAX_H = 20
    const ratio = Math.min(LOGO_MAX_W / logo.w, LOGO_MAX_H / logo.h)
    const lw = logo.w * ratio, lh = logo.h * ratio
    doc.addImage(logo.dataUrl, 'PNG', 14, 9, lw, lh)
    emX = 14 + lw + 4
  }

  // ── Emisor ─────────────────────────────────────────────────────────────────
  const LEFT_W = 120 - emX
  let y = 15
  doc.setFontSize(14).setFont('helvetica', 'bold').setTextColor(0)
  for (const ln of (doc.splitTextToSize(data.emisor_razon_social, LEFT_W) as string[])) {
    doc.text(ln, emX, y); y += 6
  }
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80)
  doc.text(`CUIT: ${formatCuit(data.emisor_cuit)}`, emX, y); y += 5
  if (data.emisor_domicilio) {
    for (const ln of (doc.splitTextToSize(data.emisor_domicilio, LEFT_W) as string[])) { doc.text(ln, emX, y); y += 5 }
  }
  doc.text(`IVA: ${normalizarCondIVA(data.emisor_condicion_iva)}`, emX, y); y += 5
  if (data.emisor_ingresos_brutos) { doc.text(`Ing. Brutos: ${data.emisor_ingresos_brutos}`, emX, y); y += 5 }
  if (data.emisor_inicio_actividades) { doc.text(`Inicio Act.: ${formatFecha(data.emisor_inicio_actividades)}`, emX, y); y += 5 }
  const contacto = [data.emisor_telefono, data.emisor_email, data.emisor_sitio_web].filter(Boolean).join('  ·  ')
  if (contacto) { for (const ln of (doc.splitTextToSize(contacto, LEFT_W) as string[])) { doc.text(ln, emX, y); y += 5 } }

  // ── Título + datos ───────────────────────────────────────────────────────────
  const RX = W - 14
  doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(0)
  doc.text('REMITO', RX, 16, { align: 'right' })
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(120)
  doc.text('Documento no válido como factura', RX, 21, { align: 'right' })
  doc.setFontSize(9).setTextColor(80)
  doc.text(`N° ${data.numero}`, RX, 27, { align: 'right' })
  doc.text(`Fecha: ${formatFecha(data.fecha)}`, RX, 32, { align: 'right' })

  // ── Divisoria ──────────────────────────────────────────────────────────────
  const lineY = Math.max(y, 35) + 3
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
  if (data.receptor_condicion_iva) { doc.text(`Condición IVA: ${data.receptor_condicion_iva}`, 14, ry); ry += 5 }
  if (data.receptor_domicilio) { doc.text(`Domicilio de entrega: ${data.receptor_domicilio}`, 14, ry); ry += 5 }

  // ── Ítems (sin precios) ──────────────────────────────────────────────────────
  const conCod = data.items.some(i => (i.codigo ?? '').trim().length > 0)
  const head = conCod ? [['Cód.', 'Descripción', 'Cantidad']] : [['Descripción', 'Cantidad']]
  const rows = data.items.map(i => {
    const cant = String(i.cantidad % 1 === 0 ? i.cantidad : i.cantidad.toFixed(3))
    return conCod ? [i.codigo ?? '', i.descripcion, cant] : [i.descripcion, cant]
  })
  autoTable(doc, {
    startY:     ry + 3,
    margin:     { left: 14, right: 14 },
    head,
    body:       rows,
    headStyles: { fillColor: [30, 58, 95], fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 8 },
    columnStyles: conCod
      ? { 0: { cellWidth: 30 }, 1: { cellWidth: 122 }, 2: { halign: 'center', cellWidth: 30 } }
      : { 0: { cellWidth: 152 }, 1: { halign: 'center', cellWidth: 30 } },
    theme: 'striped',
  })

  let ty = (doc as any).lastAutoTable.finalY + 10

  // ── Observaciones ────────────────────────────────────────────────────────────
  if (data.observaciones && data.observaciones.trim()) {
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0)
    doc.text('Observaciones:', 14, ty); ty += 5
    doc.setFont('helvetica', 'normal').setTextColor(60)
    for (const ln of (doc.splitTextToSize(data.observaciones.trim(), W - 28) as string[])) { doc.text(ln, 14, ty); ty += 5 }
    ty += 3
  }

  // ── Recibí conforme ──────────────────────────────────────────────────────────
  const firmaY = Math.max(ty + 18, 250)
  doc.setDrawColor(120).setLineWidth(0.3)
  doc.line(24, firmaY, 90, firmaY)
  doc.line(120, firmaY, 186, firmaY)
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(110)
  doc.text('Aclaración y DNI', 57, firmaY + 4, { align: 'center' })
  doc.text('Firma — Recibí conforme', 153, firmaY + 4, { align: 'center' })

  // ── Leyenda + pie ──────────────────────────────────────────────────────────
  if (data.emisor_leyenda) {
    doc.setFontSize(7.5).setFont('helvetica', 'italic').setTextColor(120)
    let ly = firmaY + 12
    for (const ln of (doc.splitTextToSize(data.emisor_leyenda, W - 28) as string[])) { doc.text(ln, 14, ly); ly += 4 }
  }
  doc.setDrawColor(180).setLineWidth(0.3)
  doc.line(14, 280, W - 14, 280)
  doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(150)
  doc.text('Remito — documento no fiscal', W / 2, 285, { align: 'center' })

  return doc
}

function nombreRemitoPDF(data: RemitoPDFData): string {
  const cli = sanitizarNombreArchivo(data.receptor_nombre)
  return `Remito_${data.numero}${cli ? '_' + cli : ''}.pdf`
}

/** Genera el PDF del remito y lo descarga (default) o lo abre para imprimir. */
export async function generarRemitoPDF(
  data: RemitoPDFData,
  accion: 'descargar' | 'imprimir' = 'descargar',
): Promise<void> {
  const doc = await construirRemitoDoc(data)
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
    doc.save(nombreRemitoPDF(data))
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
