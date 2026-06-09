import jsPDF from 'jspdf'
import QRCode from 'qrcode'

// ── EN7 — H3: etiquetas A4 de envíos con QR + datos del destinatario ─────────
// Genera una hoja A4 con N etiquetas por página (4 / 6 / 12). Cada etiqueta lleva
// un QR (link de seguimiento /transporte/:token o el número de envío) + datos del
// destinatario para pegar en el paquete.

export interface EtiquetaEnvio {
  numero?: number | string | null
  negocio?: string | null
  destinatario?: string | null
  direccion?: string | null
  zona?: string | null
  codigoPostal?: string | null
  telefono?: string | null
  courier?: string | null
  qrTexto: string                // contenido del QR (URL de seguimiento o número)
}

export type EtiquetasPorHoja = 4 | 6 | 12

interface Grid { cols: number; rows: number }
const GRIDS: Record<EtiquetasPorHoja, Grid> = {
  4: { cols: 2, rows: 2 },
  6: { cols: 2, rows: 3 },
  12: { cols: 3, rows: 4 },
}

const A4 = { w: 210, h: 297 }
const MARGIN = 8
const GAP = 4

function clip(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/** Genera el PDF de etiquetas y lo descarga. */
export async function generarEtiquetasA4PDF(
  etiquetas: EtiquetaEnvio[],
  porHoja: EtiquetasPorHoja = 6,
  fileName = 'etiquetas_envios',
): Promise<void> {
  if (etiquetas.length === 0) return
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const { cols, rows } = GRIDS[porHoja]
  const perPage = cols * rows
  const cellW = (A4.w - MARGIN * 2 - GAP * (cols - 1)) / cols
  const cellH = (A4.h - MARGIN * 2 - GAP * (rows - 1)) / rows
  const qrSize = Math.min(cellW, cellH) * 0.42

  // Pre-generar los QR (async) en data URLs
  const qrUrls = await Promise.all(
    etiquetas.map(e => QRCode.toDataURL(e.qrTexto || String(e.numero ?? ''), { width: 240, margin: 1 }).catch(() => '')),
  )

  etiquetas.forEach((et, i) => {
    const idxEnPagina = i % perPage
    if (i > 0 && idxEnPagina === 0) doc.addPage()
    const col = idxEnPagina % cols
    const row = Math.floor(idxEnPagina / cols)
    const x = MARGIN + col * (cellW + GAP)
    const y = MARGIN + row * (cellH + GAP)

    // Marco de la etiqueta
    doc.setDrawColor(180); doc.setLineWidth(0.2)
    doc.rect(x, y, cellW, cellH)

    const padX = x + 3
    let cy = y + 5

    // Encabezado: negocio + número
    doc.setFont('helvetica', 'bold'); doc.setFontSize(porHoja === 12 ? 8 : 10)
    doc.text(clip(et.negocio ?? 'Envío', 28), padX, cy)
    if (et.numero != null && et.numero !== '') {
      doc.setFontSize(porHoja === 12 ? 8 : 10)
      doc.text(`#${et.numero}`, x + cellW - 3, cy, { align: 'right' })
    }
    cy += porHoja === 12 ? 4 : 6

    // QR a la izquierda
    if (qrUrls[i]) doc.addImage(qrUrls[i], 'PNG', padX, cy, qrSize, qrSize)

    // Datos del destinatario a la derecha del QR
    const txtX = padX + qrSize + 3
    const txtW = cellW - (qrSize + 9)
    let ty = cy + 3
    doc.setFont('helvetica', 'bold'); doc.setFontSize(porHoja === 12 ? 7 : 9)
    const dest = doc.splitTextToSize(clip(et.destinatario ?? 'Destinatario', 60), txtW)
    doc.text(dest, txtX, ty); ty += dest.length * (porHoja === 12 ? 3 : 4)

    doc.setFont('helvetica', 'normal'); doc.setFontSize(porHoja === 12 ? 6.5 : 8)
    const dir = doc.splitTextToSize(clip(et.direccion ?? '', 90), txtW)
    if (dir.length) { doc.text(dir, txtX, ty); ty += dir.length * (porHoja === 12 ? 3 : 3.5) }
    const zonaCp = [et.zona, et.codigoPostal ? `CP ${et.codigoPostal}` : null].filter(Boolean).join(' · ')
    if (zonaCp) { doc.text(clip(zonaCp, 40), txtX, ty); ty += porHoja === 12 ? 3 : 3.5 }
    if (et.telefono) { doc.text(`Tel: ${clip(et.telefono, 22)}`, txtX, ty); ty += porHoja === 12 ? 3 : 3.5 }

    // Courier al pie de la etiqueta
    if (et.courier) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(porHoja === 12 ? 6.5 : 8)
      doc.text(clip(et.courier, 36), padX, y + cellH - 3)
    }
  })

  const fecha = new Date().toISOString().split('T')[0]
  doc.save(`${fileName}_${fecha}.pdf`)
}
