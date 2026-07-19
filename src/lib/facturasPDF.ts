import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import { buildQrAfipUrl, esComprobanteSinIVA, TIPO_CBTE } from '@/lib/facturacionLogic'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FacturaPDFData {
  // Comprobante
  clase?: 'factura' | 'nota_credito'  // default 'factura'. Cambia título, COD y QR a NC.
  tipo_comprobante: string        // 'A' | 'B' | 'C' (la letra; para NC también acepta 'NC-B')
  numero_comprobante: number      // ej: 1
  punto_venta: number             // ej: 1
  fecha: string                   // ISO date
  cae: string
  vencimiento_cae: string         // ISO date

  // Emisor (tenant)
  emisor_razon_social: string
  emisor_cuit: string             // sin guiones: "20409378472"
  emisor_domicilio?: string
  emisor_condicion_iva: string    // "Responsable Inscripto" | "Monotributo" | etc.
  emisor_logo_url?: string | null // logo del negocio (bucket `logos`), se embebe arriba a la izq.
  emisor_ingresos_brutos?: string | null   // N° de Ingresos Brutos
  emisor_inicio_actividades?: string | null // ISO date
  emisor_telefono?: string | null
  emisor_email?: string | null
  emisor_sitio_web?: string | null
  // Datos para cobro / leyenda (pie del comprobante)
  emisor_banco?: string | null
  emisor_cbu?: string | null
  emisor_alias?: string | null
  emisor_leyenda?: string | null

  // Receptor (cliente)
  receptor_nombre: string
  receptor_cuit_dni?: string
  receptor_condicion_iva?: string // "Consumidor Final" | "Responsable Inscripto" | etc.
  receptor_domicilio?: string

  // Ítems
  items: {
    codigo?: string | null        // SKU / código de artículo
    descripcion: string
    descripcion_extra?: string | null  // descripción larga del producto (opcional) — 2da línea, gris chico
    cantidad: number
    precio_unitario: number
    alicuota_iva: number          // 0 | 10.5 | 21 | 27
    subtotal: number              // precio × cantidad (con IVA incluido)
  }[]

  // Totales
  total: number
  moneda?: string                 // 'PES' por defecto
  forma_pago?: string | null      // "Efectivo", "Cuenta Corriente", etc.

  // Pago online (MercadoPago) — QR del init_point, solo si hay saldo pendiente
  pago_mp_qr?: string | null      // dataURL del QR del link de pago
  pago_mp_monto?: number | null   // saldo a pagar
}

// ─── Mapeo tipo comprobante → número AFIP ────────────────────────────────────
// (TIPO_CBTE vive en facturacionLogic e incluye A/B/C + NC-A/B/C + ND-A/B/C.)

const COND_IVA_LABEL: Record<string, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributo:           'Monotributo',
  exento:                'Exento',
  consumidor_final:      'Consumidor Final',
}

export function normalizarCondIVA(v?: string | null): string {
  if (!v) return 'Consumidor Final'
  return COND_IVA_LABEL[v] ?? v
}

// El QR fiscal (RG 4291) se construye con buildQrAfipUrl de '@/lib/facturacionLogic'
// (lógica pura testeable).

// ─── Generador principal ──────────────────────────────────────────────────────

async function construirFacturaPDFDoc(data: FacturaPDFData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const COL = W / 2  // 105mm — divisor A/B

  // ── Clase de comprobante (factura vs nota de crédito) ────────────────────────
  const esNC = data.clase === 'nota_credito'
  const letra = data.tipo_comprobante.replace(/^N[CD]-/, '')  // 'NC-B' → 'B'
  const cbteKey = esNC ? `NC-${letra}` : letra                // clave para TIPO_CBTE / QR

  // ── QR ──────────────────────────────────────────────────────────────────────
  const qrUrl = buildQrAfipUrl({
    fecha:             data.fecha,
    emisorCuit:        data.emisor_cuit,
    puntoVenta:        data.punto_venta,
    tipoComprobante:   cbteKey,
    numeroComprobante: data.numero_comprobante,
    importe:           data.total,
    cae:               data.cae,
    receptorCuitDni:   data.receptor_cuit_dni,
    moneda:            data.moneda,
  })
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 1 })

  // ── Logo del negocio (arriba a la izquierda, opcional) ───────────────────────
  const logo = data.emisor_logo_url ? await cargarLogo(data.emisor_logo_url) : null
  let emX = 14  // x de inicio del bloque emisor (se corre a la derecha si hay logo)
  if (logo) {
    const LOGO_MAX_W = 26, LOGO_MAX_H = 20
    const ratio = Math.min(LOGO_MAX_W / logo.w, LOGO_MAX_H / logo.h)
    const lw = logo.w * ratio, lh = logo.h * ratio
    doc.addImage(logo.dataUrl, 'PNG', 14, 9, lw, lh)
    emX = 14 + lw + 4
  }

  // ── Caja central — tipo de comprobante ──────────────────────────────────────
  // Se dibuja primero para conocer su geometría (la columna izquierda hace wrap
  // para no superponerse con él).
  const boxW = 26; const boxX = COL - boxW / 2; const boxY = 10; const boxH = 24
  // Ancho útil de la columna izquierda: desde el bloque emisor hasta ~3mm antes del recuadro.
  const LEFT_W = boxX - emX - 3
  doc.setDrawColor(0).setLineWidth(0.5)
  doc.rect(boxX, boxY, boxW, boxH)
  doc.setFontSize(26).setFont('helvetica', 'bold').setTextColor(0)
  doc.text(letra, boxX + boxW / 2, boxY + 13, { align: 'center' })
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(80)
  doc.text('COD.', boxX + boxW / 2, boxY + 18.5, { align: 'center' })
  const cod = String(TIPO_CBTE[cbteKey] ?? 6).padStart(2, '0')
  doc.setFontSize(9).setTextColor(0)
  doc.text(cod, boxX + boxW / 2, boxY + 22.5, { align: 'center' })

  // ── Encabezado izquierdo — datos del emisor (con wrap para no chocar el recuadro) ─
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
  if (data.emisor_ingresos_brutos) { doc.text(`Ing. Brutos: ${data.emisor_ingresos_brutos}`, emX, y); y += 5 }
  if (data.emisor_inicio_actividades) { doc.text(`Inicio Act.: ${formatFecha(data.emisor_inicio_actividades)}`, emX, y); y += 5 }
  const contacto = [data.emisor_telefono, data.emisor_email, data.emisor_sitio_web].filter(Boolean).join('  ·  ')
  if (contacto) {
    for (const ln of (doc.splitTextToSize(contacto, LEFT_W) as string[])) { doc.text(ln, emX, y); y += 5 }
  }

  // ── Encabezado derecho — datos del comprobante ───────────────────────────────
  // Alineado al margen derecho (no pegado al recuadro central del tipo de comprobante).
  const RX = W - 14
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0)
  doc.text(esNC ? 'NOTA DE CRÉDITO' : 'FACTURA', RX, 15, { align: 'right' })
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80)
  const pvStr = String(data.punto_venta).padStart(4, '0')
  const ncStr = String(data.numero_comprobante).padStart(8, '0')
  doc.text(`N° ${letra}-${pvStr}-${ncStr}`, RX, 21, { align: 'right' })
  doc.text(`Fecha: ${formatFecha(data.fecha)}`, RX, 27, { align: 'right' })
  doc.text(`Moneda: ${data.moneda === 'USD' ? 'Dólares' : 'Pesos Argentinos'}`, RX, 32, { align: 'right' })
  if (data.forma_pago) doc.text(`Forma de pago: ${data.forma_pago}`, RX, 37, { align: 'right' })

  // ── Línea divisoria horizontal ───────────────────────────────────────────────
  const rightBottom = data.forma_pago ? 37 : 32
  const lineY = Math.max(y, boxY + boxH, rightBottom) + 3
  doc.setDrawColor(180).setLineWidth(0.3)
  doc.line(14, lineY, W - 14, lineY)

  // ── Datos del receptor ───────────────────────────────────────────────────────
  let ry = lineY + 6
  doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0)
  doc.text('DATOS DEL RECEPTOR', 14, ry); ry += 5
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

  // ── Tabla de ítems ───────────────────────────────────────────────────────────
  // Factura C (Monotributista) NO discrimina IVA → tabla y totales sin columnas de IVA.
  const tableY = ry + 3
  const sinIVA = esComprobanteSinIVA(cbteKey)
  const ivaGroups: Record<number, number> = {}
  const conCod = data.items.some(i => (i.codigo ?? '').trim().length > 0)
  const codCell = (item: FacturaPDFData['items'][number]) => (conCod ? [item.codigo ?? ''] : [])
  const codHead = conCod ? ['Cód.'] : []
  const codStyle: Record<number, { cellWidth: number }> = conCod ? { 0: { cellWidth: 20 } } : {}
  const off = conCod ? 1 : 0  // desplazamiento de índices de columna cuando hay Cód.

  // Texto de la celda "Descripción": si el producto tiene descripcion_extra, se manda con
  // un \n para que autoTable calcule bien el alto de la fila (2 líneas) — el dibujo real
  // (nombre en negrita + descripción en gris chico) lo hacen los hooks de abajo, que
  // suprimen el texto default de esa celda y lo redibujan a mano con 2 estilos.
  const descripcionCelda = (item: FacturaPDFData['items'][number]) =>
    item.descripcion_extra ? `${item.descripcion}\n${item.descripcion_extra}` : item.descripcion

  // Dibuja "nombre" en negrita y, si hay, "descripcion_extra" debajo en gris chico —
  // jspdf-autotable no soporta 2 estilos en una misma celda de forma nativa, así que se
  // suprime el texto default (willDrawCell) y se redibuja a mano (didDrawCell).
  const descripcionHooks = (descColIndex: number) => ({
    willDrawCell: (hd: any) => {
      if (hd.section === 'body' && hd.column.index === descColIndex && data.items[hd.row.index]?.descripcion_extra) {
        hd.cell.text = []
      }
    },
    didDrawCell: (hd: any) => {
      if (hd.section !== 'body' || hd.column.index !== descColIndex) return
      const item = data.items[hd.row.index]
      if (!item?.descripcion_extra) return
      const maxW = hd.cell.width - hd.cell.padding('left') - hd.cell.padding('right')
      // getTextPos() da el TOPE del área de texto (valign default de autoTable = 'top'),
      // no la línea base — autoTable ajusta con fontSize×(2−1.15) antes de dibujar (función
      // interna autoTableText). Replicarlo acá alinea "nombre" exactamente con Cód./Cant./
      // Subtotal de la misma fila (antes quedaba corrido hacia abajo con un offset a ojo).
      const { x, y: topY } = hd.cell.getTextPos()
      const k = (doc.internal as any).scaleFactor
      const fontSizeMm = 8 / k
      const y1 = topY + fontSizeMm * 0.85
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(0)
      doc.text(item.descripcion, x, y1)
      doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(130)
      const wrapped = doc.splitTextToSize(item.descripcion_extra, maxW) as string[]
      doc.text(wrapped, x, y1 + fontSizeMm * 1.15)
      doc.setTextColor(0)
    },
  })

  if (sinIVA) {
    const rows = data.items.map(item => [
      ...codCell(item),
      descripcionCelda(item),
      String(item.cantidad % 1 === 0 ? item.cantidad : item.cantidad.toFixed(3)),
      fmtPesos(item.subtotal / item.cantidad),
      fmtPesos(item.subtotal),
    ])
    const { willDrawCell, didDrawCell } = descripcionHooks(off)
    autoTable(doc, {
      startY:      tableY,
      margin:      { left: 14, right: 14 },
      head:        [[...codHead, 'Descripción', 'Cant.', 'P. Unitario', 'Subtotal']],
      body:        rows,
      headStyles:  { fillColor: [30, 58, 95], fontSize: 8, halign: 'center' },
      bodyStyles:  { fontSize: 8 },
      columnStyles: {
        ...codStyle,
        [off]:     { cellWidth: conCod ? 76 : 96 },
        [off + 1]: { halign: 'center', cellWidth: 20 },
        [off + 2]: { halign: 'right', cellWidth: 33 },
        [off + 3]: { halign: 'right', cellWidth: 33 },
      },
      theme: 'striped',
      willDrawCell, didDrawCell,
    })
  } else {
    const rows = data.items.map(item => {
      const neto = item.subtotal / (1 + item.alicuota_iva / 100)
      const ivaM = item.subtotal - neto
      ivaGroups[item.alicuota_iva] = (ivaGroups[item.alicuota_iva] ?? 0) + ivaM
      return [
        ...codCell(item),
        descripcionCelda(item),
        String(item.cantidad % 1 === 0 ? item.cantidad : item.cantidad.toFixed(3)),
        fmtPesos(item.subtotal / item.cantidad / (1 + item.alicuota_iva / 100)),
        `${item.alicuota_iva}%`,
        fmtPesos(neto),
        fmtPesos(ivaM),
        fmtPesos(item.subtotal),
      ]
    })
    const { willDrawCell, didDrawCell } = descripcionHooks(off)
    autoTable(doc, {
      startY:      tableY,
      margin:      { left: 14, right: 14 },
      head:        [[...codHead, 'Descripción', 'Cant.', 'P. Unit. Neto', 'IVA %', 'Subtotal Neto', 'IVA $', 'Total']],
      body:        rows,
      headStyles:  { fillColor: [30, 58, 95], fontSize: 8, halign: 'center' },
      bodyStyles:  { fontSize: 8 },
      columnStyles: {
        ...codStyle,
        [off]:     { cellWidth: conCod ? 44 : 60 },
        [off + 1]: { halign: 'center', cellWidth: 14 },
        [off + 2]: { halign: 'right', cellWidth: 26 },
        [off + 3]: { halign: 'center', cellWidth: 14 },
        [off + 4]: { halign: 'right', cellWidth: 26 },
        [off + 5]: { halign: 'right', cellWidth: 20 },
        [off + 6]: { halign: 'right', cellWidth: 24 },
      },
      theme: 'striped',
      willDrawCell, didDrawCell,
    })
  }

  // ── Totales ──────────────────────────────────────────────────────────────────
  const afterTable = (doc as any).lastAutoTable.finalY + 6
  let ty = afterTable
  const totalsX = W - 14
  doc.setFontSize(9).setTextColor(60)

  if (!sinIVA) {
    const totalNeto = data.total - Object.values(ivaGroups).reduce((a, b) => a + b, 0)
    doc.text('Subtotal Neto:', totalsX - 50, ty, { align: 'right' })
    doc.text(fmtPesos(totalNeto), totalsX, ty, { align: 'right' }); ty += 5

    for (const [rate, amount] of Object.entries(ivaGroups).sort()) {
      doc.text(`IVA ${rate}%:`, totalsX - 50, ty, { align: 'right' })
      doc.text(fmtPesos(amount), totalsX, ty, { align: 'right' }); ty += 5
    }
  }

  doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(0)
  doc.text('TOTAL:', totalsX - 50, ty + 1, { align: 'right' })
  doc.text(fmtPesos(data.total), totalsX, ty + 1, { align: 'right' })
  ty += 8

  // ── Régimen de Transparencia Fiscal al Consumidor (Ley 27.743) — Factura B ────
  // Obligatorio desde 2025 en comprobantes B a consumidor final: discriminar el IVA
  // contenido + otros impuestos nacionales indirectos.
  if (letra === 'B') {
    const ivaContenido = Object.values(ivaGroups).reduce((a, b) => a + b, 0)
    doc.setFontSize(7.5).setFont('helvetica', 'bold').setTextColor(90)
    doc.text('Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)', 14, ty)
    doc.setFont('helvetica', 'normal').setTextColor(110)
    doc.text(`IVA Contenido: ${fmtPesos(ivaContenido)}`, 14, ty + 4.5)
    doc.text(`Otros impuestos nacionales indirectos: ${fmtPesos(0)}`, 14, ty + 9)
    ty += 13
  }

  // ── CAE + QR ─────────────────────────────────────────────────────────────────
  const caeY = ty + 4
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(80)
  doc.text(`CAE N°: ${data.cae}`, 14, caeY)
  doc.text(`Vencimiento CAE: ${formatFecha(data.vencimiento_cae)}`, 14, caeY + 5)

  // QR (40×40mm a la derecha)
  const qrX = W - 14 - 35; const qrY = caeY - 4
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, 35, 35)
  doc.setFontSize(7).setFont('helvetica', 'bold').setTextColor(90)
  doc.text('Comprobante Autorizado', qrX + 17.5, qrY + 37, { align: 'center' })
  doc.setFont('helvetica', 'normal').setTextColor(120)
  doc.text('AFIP · ARCA', qrX + 17.5, qrY + 40, { align: 'center' })

  // ── Datos para transferencia + leyenda (debajo del CAE, a la izquierda) ───────
  let fy = caeY + 14
  if (data.emisor_banco || data.emisor_cbu || data.emisor_alias) {
    doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(80)
    doc.text('Datos para transferencia:', 14, fy); fy += 4.5
    doc.setFont('helvetica', 'normal').setTextColor(100)
    const banco = [
      data.emisor_banco && `Banco: ${data.emisor_banco}`,
      data.emisor_cbu   && `CBU: ${data.emisor_cbu}`,
      data.emisor_alias && `Alias: ${data.emisor_alias}`,
    ].filter(Boolean).join('    ')
    for (const ln of (doc.splitTextToSize(banco, W - 28) as string[])) { doc.text(ln, 14, fy); fy += 4.5 }
  }
  if (data.emisor_leyenda) {
    doc.setFontSize(7.5).setFont('helvetica', 'italic').setTextColor(120)
    for (const ln of (doc.splitTextToSize(data.emisor_leyenda, W - 28) as string[])) { doc.text(ln, 14, fy); fy += 4 }
  }

  // ── QR de pago MercadoPago (solo si hay saldo pendiente) ─────────────────────
  if (data.pago_mp_qr) {
    const mpy = fy + 2
    doc.addImage(data.pago_mp_qr, 'PNG', 14, mpy, 22, 22)
    doc.setFontSize(8.5).setFont('helvetica', 'bold').setTextColor(80)
    doc.text('Pagá con MercadoPago', 39, mpy + 8)
    doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(110)
    doc.text(data.pago_mp_monto ? `Escaneá el QR — saldo ${fmtPesos(data.pago_mp_monto)}` : 'Escaneá el QR para pagar', 39, mpy + 13)
  }

  // ── Pie ───────────────────────────────────────────────────────────────────────
  doc.setDrawColor(180).setLineWidth(0.3)
  doc.line(14, 280, W - 14, 280)
  doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(150)
  doc.text('Comprobante fiscal electrónico — Genesis360', W / 2, 285, { align: 'center' })

  return doc
}

function nombreFacturaPDF(data: FacturaPDFData): string {
  const pvPad = String(data.punto_venta).padStart(4, '0')
  const ncPad = String(data.numero_comprobante).padStart(8, '0')
  const cli = sanitizarNombreArchivo(data.receptor_nombre)
  const letra = data.tipo_comprobante.replace(/^N[CD]-/, '')
  const prefijo = data.clase === 'nota_credito' ? 'NotaCredito' : 'Factura'
  return `${prefijo}_${letra}_${pvPad}-${ncPad}${cli ? '_' + cli : ''}.pdf`
}

/** Saca tildes/símbolos y limita el largo para usar el nombre del cliente en el filename. */
function sanitizarNombreArchivo(s?: string): string {
  if (!s) return ''
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40)
}

/** Genera el PDF y lo descarga (default) o lo abre listo para imprimir. */
export async function generarFacturaPDF(
  data: FacturaPDFData,
  accion: 'descargar' | 'imprimir' = 'descargar',
): Promise<void> {
  const doc = await construirFacturaPDFDoc(data)
  if (accion === 'imprimir') {
    // window.open tras un await queda bloqueado por el popup-blocker (se pierde el
    // gesto del usuario). Imprimimos vía un iframe oculto: con autoPrint() el visor
    // de PDF dispara el diálogo de impresión al cargar.
    doc.autoPrint()
    const url = doc.output('bloburl') as unknown as string
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.src = url
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() } catch { /* el visor ya imprime por autoPrint */ }
      // Limpiar el iframe tras un margen para no cortar el diálogo de impresión.
      setTimeout(() => iframe.remove(), 60_000)
    }
    document.body.appendChild(iframe)
  } else {
    doc.save(nombreFacturaPDF(data))
  }
}

/** Genera el PDF y lo devuelve como base64 (sin prefijo data:) + nombre, para adjuntar a un email. */
export async function generarFacturaPDFBase64(
  data: FacturaPDFData,
): Promise<{ base64: string; filename: string }> {
  const doc = await construirFacturaPDFDoc(data)
  const dataUri = doc.output('datauristring')
  return { base64: dataUri.split(',')[1] ?? '', filename: nombreFacturaPDF(data) }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Carga el logo del negocio desde su URL pública y lo pasa a dataURL PNG (vía canvas)
 * para embeberlo en el PDF. Devuelve también el tamaño natural (para conservar aspecto).
 * Si falla (URL caída, CORS, etc.) devuelve null y el PDF se genera sin logo.
 */
export async function cargarLogo(url: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('logo load error'))
      img.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight) return null
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight }
  } catch {
    return null
  }
}

function fmtPesos(v: number): string {
  return `$${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCuit(cuit: string): string {
  const d = cuit.replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
  return cuit
}

function formatFecha(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
