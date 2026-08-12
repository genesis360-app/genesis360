import jsPDF from 'jspdf'
import bwipjs from 'bwip-js/browser'

// Repositores Fase 4 (mig 357, G1-G3 del relevamiento): etiquetas de precio para pegar en la
// góndola. Mismo patrón jsPDF en grilla A4 que `etiquetasEnvioPDF.ts` (EN7) — acá con código de
// barras del producto (bwip-js, igual mecanismo que `CodigoMasivoModal.tsx`) en vez de QR, y precio
// con tachado si hay descuento en vez de datos de envío.

export interface EtiquetaPrecio {
  nombre: string
  sku?: string | null
  codigoBarras?: string | null
  precio: number
  precioAnterior?: number | null    // tachado al lado del nuevo, si hay descuento real (G1)
  precioPorUnidadGrande?: { valor: number; simbolo: string } | null   // "Precio por L: $25.000"
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

function formatearPrecio(n: number): string {
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

/** Renderiza el código de barras a un canvas offscreen → dataURL. null si no hay código o falla
 *  (código inválido para code128 — no bloquea la tanda, esa etiqueta sale sin barras). */
function renderBarcode(codigo: string): string | null {
  try {
    const canvas = document.createElement('canvas')
    bwipjs.toCanvas(canvas, { bcid: 'code128', text: codigo, scale: 2, height: 10, includetext: true, textxalign: 'center', backgroundcolor: 'FFFFFF' } as any)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/** Genera el PDF de etiquetas de precio y lo descarga. */
export function generarEtiquetasPreciosPDF(
  etiquetas: EtiquetaPrecio[],
  porHoja: EtiquetasPorHoja = 12,
  fileName = 'etiquetas_precios',
): void {
  if (etiquetas.length === 0) return
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const { cols, rows } = GRIDS[porHoja]
  const perPage = cols * rows
  const cellW = (A4.w - MARGIN * 2 - GAP * (cols - 1)) / cols
  const cellH = (A4.h - MARGIN * 2 - GAP * (rows - 1)) / rows
  const barcodeH = cellH * 0.28

  etiquetas.forEach((et, i) => {
    const idxEnPagina = i % perPage
    if (i > 0 && idxEnPagina === 0) doc.addPage()
    const col = idxEnPagina % cols
    const row = Math.floor(idxEnPagina / cols)
    const x = MARGIN + col * (cellW + GAP)
    const y = MARGIN + row * (cellH + GAP)

    doc.setDrawColor(180); doc.setLineWidth(0.2)
    doc.rect(x, y, cellW, cellH)

    const padX = x + 3
    const chico = porHoja === 12
    let cy = y + (chico ? 5 : 6)

    // Nombre del producto (puede envolver 2 líneas)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(chico ? 8 : 10)
    const nombreLineas = doc.splitTextToSize(clip(et.nombre, chico ? 34 : 46), cellW - 6)
    doc.text(nombreLineas.slice(0, 2), padX, cy)
    cy += nombreLineas.slice(0, 2).length * (chico ? 3.2 : 4)

    // Precio — tachado el anterior al lado del nuevo si hay descuento real
    const hayDescuento = et.precioAnterior != null && et.precioAnterior > et.precio
    cy += chico ? 4 : 6
    if (hayDescuento) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(chico ? 8 : 10); doc.setTextColor(150)
      const anteriorTxt = formatearPrecio(et.precioAnterior!)
      doc.text(anteriorTxt, padX, cy)
      const w = doc.getTextWidth(anteriorTxt)
      doc.setLineWidth(0.25); doc.line(padX, cy - 1.2, padX + w, cy - 1.2)
      doc.setTextColor(0)
      cy += chico ? 4.5 : 5.5
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(chico ? 15 : 20)
    doc.text(formatearPrecio(et.precio), padX, cy)
    cy += chico ? 3 : 4

    // Precio por unidad grande (G1: "Precio por L: $25.000"), en chico
    if (et.precioPorUnidadGrande) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(chico ? 6 : 7); doc.setTextColor(90)
      doc.text(`Precio por ${et.precioPorUnidadGrande.simbolo}: ${formatearPrecio(et.precioPorUnidadGrande.valor)}`, padX, cy + 2)
      doc.setTextColor(0)
      cy += chico ? 3 : 4
    }

    // Código de barras + número, al pie de la etiqueta (G1)
    const codigo = (et.codigoBarras ?? '').trim()
    if (codigo) {
      const barcodeUrl = renderBarcode(codigo)
      const byBottom = y + cellH - barcodeH - 2
      if (barcodeUrl) {
        doc.addImage(barcodeUrl, 'PNG', padX, Math.max(cy, byBottom), cellW - 6, barcodeH)
      } else {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(chico ? 6 : 7)
        doc.text(clip(codigo, 20), padX, y + cellH - 3)
      }
    }
  })

  const fecha = new Date().toISOString().split('T')[0]
  doc.save(`${fileName}_${fecha}.pdf`)
}
