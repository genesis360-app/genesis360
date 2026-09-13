import jsPDF from 'jspdf'
import bwipjs from 'bwip-js/browser'

// Repositores Fase 4 (mig 357, G1-G3 del relevamiento): etiquetas de precio para pegar en la
// góndola. Mismo patrón jsPDF en grilla A4 que `etiquetasEnvioPDF.ts` (EN7) — acá con código de
// barras del producto (bwip-js, igual mecanismo que `CodigoMasivoModal.tsx`) en vez de QR, y precio
// con tachado si hay descuento en vez de datos de envío.
//
// ── Rediseño horizontal (pedido de Fede, 2026-09-11) ─────────────────────────────────────────
// Antes las celdas eran casi cuadradas (3×4 en A4) y todo se apilaba alineado a la izquierda: el
// nombre arriba, el precio debajo y el código de barras al pie. Fede pidió lo que se usa de verdad
// en una góndola: **formato rectangular horizontal, el nombre más grande, y el precio más grande y
// del lado derecho** — que es donde el cliente lo busca cuando recorre la estantería.
//
// Ahora cada etiqueta es una banda horizontal partida en dos zonas:
//
//   ┌───────────────────────────────────────────────┐
//   │ NOMBRE DEL PRODUCTO            $12.345        │
//   │ (hasta 2 líneas, grande)       (grande, der.) │
//   │ ▌▌▌▌▌ código de barras         Precio por L…  │
//   └───────────────────────────────────────────────┘
//
// El tamaño del precio y del nombre se AUTO-AJUSTA a lo que entra (`fuenteQueEntra`): un precio de
// siete cifras no puede pisar el nombre ni salirse de la etiqueta, y con 3 tamaños de hoja el ancho
// disponible cambia bastante. Preferimos achicar la fuente antes que recortar un número de plata.

export interface EtiquetaPrecio {
  nombre: string
  sku?: string | null
  codigoBarras?: string | null
  precio: number
  precioAnterior?: number | null    // tachado arriba del nuevo, si hay descuento real (G1)
  precioPorUnidadGrande?: { valor: number; simbolo: string } | null   // "Precio por L: $25.000"
}

export type EtiquetasPorHoja = 4 | 6 | 12

interface Grid { cols: number; rows: number }
// Todas HORIZONTALES (ancho > alto). Antes: 4=2×2, 6=2×3, 12=3×4 — celdas cuadradas o verticales.
const GRIDS: Record<EtiquetasPorHoja, Grid> = {
  4:  { cols: 1, rows: 4 },   // 194 × 69,8 mm
  6:  { cols: 1, rows: 6 },   // 194 × 45,5 mm
  12: { cols: 2, rows: 6 },   //  95 × 45,5 mm
}

const A4 = { w: 210, h: 297 }
const MARGIN = 8
const GAP = 4

/** Proporción del ancho que ocupa la zona del precio (derecha). El resto es nombre + barras. */
const ZONA_PRECIO = 0.40

function clip(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function formatearPrecio(n: number): string {
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

/**
 * El tamaño de fuente más grande (entre `max` y `min`) con el que `texto` entra en `anchoMax`.
 * Sin esto, un precio de seis o siete cifras se sale de la etiqueta o se superpone con el nombre:
 * el ancho disponible cambia según el tamaño de hoja y la longitud del número no es previsible.
 */
function fuenteQueEntra(doc: jsPDF, texto: string, anchoMax: number, max: number, min: number): number {
  for (let t = max; t > min; t -= 0.5) {
    doc.setFontSize(t)
    if (doc.getTextWidth(texto) <= anchoMax) return t
  }
  return min
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

  // Etiqueta angosta (2 columnas) → todo un escalón más chico.
  const angosta = cols > 1
  const PAD = angosta ? 3 : 4

  etiquetas.forEach((et, i) => {
    const idxEnPagina = i % perPage
    if (i > 0 && idxEnPagina === 0) doc.addPage()
    const col = idxEnPagina % cols
    const row = Math.floor(idxEnPagina / cols)
    const x = MARGIN + col * (cellW + GAP)
    const y = MARGIN + row * (cellH + GAP)

    doc.setDrawColor(180); doc.setLineWidth(0.2)
    doc.rect(x, y, cellW, cellH)

    // ── Zonas: izquierda (nombre + barras) · derecha (precio) ───────────────────────────────
    const anchoPrecio = cellW * ZONA_PRECIO
    const xPrecioDer  = x + cellW - PAD                 // borde derecho del texto del precio
    const anchoIzq    = cellW - anchoPrecio - PAD * 2
    const xIzq        = x + PAD

    // ── Nombre: hasta 2 líneas, lo más grande que entre ─────────────────────────────────────
    const tamNombre = angosta ? 11 : 14
    doc.setFont('helvetica', 'bold'); doc.setFontSize(tamNombre); doc.setTextColor(0)
    const nombreLineas: string[] = doc.splitTextToSize(clip(et.nombre, angosta ? 44 : 60), anchoIzq)
    const lineas = nombreLineas.slice(0, 2)
    const altoLinea = tamNombre * 0.38
    let cy = y + PAD + altoLinea
    doc.text(lineas, xIzq, cy)
    cy += (lineas.length - 1) * altoLinea

    // ── Precio: grande, alineado a la DERECHA ───────────────────────────────────────────────
    const hayDescuento = et.precioAnterior != null && et.precioAnterior > et.precio
    let yPrecio = y + PAD + (angosta ? 9 : 12)

    if (hayDescuento) {
      const anteriorTxt = formatearPrecio(et.precioAnterior!)
      doc.setFont('helvetica', 'normal')
      const tamAnt = fuenteQueEntra(doc, anteriorTxt, anchoPrecio, angosta ? 9 : 11, 6)
      doc.setFontSize(tamAnt); doc.setTextColor(150)
      doc.text(anteriorTxt, xPrecioDer, y + PAD + (angosta ? 4 : 5), { align: 'right' })
      const w = doc.getTextWidth(anteriorTxt)
      doc.setLineWidth(0.3); doc.setDrawColor(150)
      const yTachado = y + PAD + (angosta ? 2.8 : 3.5)
      doc.line(xPrecioDer - w, yTachado, xPrecioDer, yTachado)
      doc.setDrawColor(180); doc.setTextColor(0)
      yPrecio = y + PAD + (angosta ? 13 : 17)
    }

    const precioTxt = formatearPrecio(et.precio)
    doc.setFont('helvetica', 'bold')
    const tamPrecio = fuenteQueEntra(doc, precioTxt, anchoPrecio, angosta ? 22 : 30, 10)
    doc.setFontSize(tamPrecio); doc.setTextColor(0)
    doc.text(precioTxt, xPrecioDer, yPrecio, { align: 'right' })

    // ── Precio por unidad grande ("Precio por L: $25.000"), debajo del precio ───────────────
    if (et.precioPorUnidadGrande) {
      const pugTxt = `Precio por ${et.precioPorUnidadGrande.simbolo}: ${formatearPrecio(et.precioPorUnidadGrande.valor)}`
      doc.setFont('helvetica', 'normal')
      const tamPug = fuenteQueEntra(doc, pugTxt, anchoPrecio, angosta ? 7 : 8.5, 5)
      doc.setFontSize(tamPug); doc.setTextColor(90)
      doc.text(pugTxt, xPrecioDer, yPrecio + (angosta ? 4.5 : 6), { align: 'right' })
      doc.setTextColor(0)
    }

    // ── Código de barras, al pie de la zona izquierda ────────────────────────────────────────
    const codigo = (et.codigoBarras ?? '').trim()
    if (codigo) {
      const barcodeH = Math.min(cellH * 0.34, angosta ? 13 : 18)
      const barcodeW = Math.min(anchoIzq, angosta ? 42 : 62)
      const barcodeUrl = renderBarcode(codigo)
      const yBarras = y + cellH - barcodeH - PAD
      if (barcodeUrl) {
        doc.addImage(barcodeUrl, 'PNG', xIzq, yBarras, barcodeW, barcodeH)
      } else {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(angosta ? 7 : 8.5)
        doc.text(clip(codigo, 24), xIzq, y + cellH - PAD)
      }
    } else if (et.sku) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(angosta ? 7 : 8.5); doc.setTextColor(120)
      doc.text(clip(et.sku, 24), xIzq, y + cellH - PAD)
      doc.setTextColor(0)
    }
  })

  const fecha = new Date().toISOString().split('T')[0]
  doc.save(`${fileName}_${fecha}.pdf`)
}
