import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import { buildQrAfipUrl, esComprobanteSinIVA } from '@/lib/facturacionLogic'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FacturaPDFData {
  // Comprobante
  tipo_comprobante: string        // 'A' | 'B' | 'C'
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

  // Receptor (cliente)
  receptor_nombre: string
  receptor_cuit_dni?: string
  receptor_condicion_iva?: string // "Consumidor Final" | "Responsable Inscripto" | etc.
  receptor_domicilio?: string

  // Ítems
  items: {
    descripcion: string
    cantidad: number
    precio_unitario: number
    alicuota_iva: number          // 0 | 10.5 | 21 | 27
    subtotal: number              // precio × cantidad (con IVA incluido)
  }[]

  // Totales
  total: number
  moneda?: string                 // 'PES' por defecto
}

// ─── Mapeo tipo comprobante → número AFIP ────────────────────────────────────

const TIPO_CMP_AFIP: Record<string, number> = {
  A: 1,
  B: 6,
  C: 11,
}

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

  // ── QR ──────────────────────────────────────────────────────────────────────
  const qrUrl = buildQrAfipUrl({
    fecha:             data.fecha,
    emisorCuit:        data.emisor_cuit,
    puntoVenta:        data.punto_venta,
    tipoComprobante:   data.tipo_comprobante,
    numeroComprobante: data.numero_comprobante,
    importe:           data.total,
    cae:               data.cae,
    receptorCuitDni:   data.receptor_cuit_dni,
    moneda:            data.moneda,
  })
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 1 })

  // ── Encabezado izquierdo — datos del emisor ──────────────────────────────────
  let y = 15
  doc.setFontSize(14).setFont('helvetica', 'bold')
  doc.text(data.emisor_razon_social, 14, y)
  y += 6
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80)
  doc.text(`CUIT: ${formatCuit(data.emisor_cuit)}`, 14, y); y += 5
  if (data.emisor_domicilio) { doc.text(data.emisor_domicilio, 14, y); y += 5 }
  doc.text(`IVA: ${normalizarCondIVA(data.emisor_condicion_iva)}`, 14, y); y += 5

  // ── Caja central — tipo de comprobante ──────────────────────────────────────
  const boxX = COL - 12; const boxY = 10; const boxW = 24; const boxH = 18
  doc.setDrawColor(0).setLineWidth(0.5)
  doc.rect(boxX, boxY, boxW, boxH)
  doc.setFontSize(22).setFont('helvetica', 'bold').setTextColor(0)
  doc.text(data.tipo_comprobante, boxX + boxW / 2, boxY + 11, { align: 'center' })
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(80)
  doc.text('COD.', boxX + boxW / 2, boxY + 15, { align: 'center' })
  const cod = String(TIPO_CMP_AFIP[data.tipo_comprobante] ?? 6).padStart(2, '0')
  doc.setFontSize(9).setTextColor(0)
  doc.text(cod, boxX + boxW / 2, boxY + 18, { align: 'center' })

  // ── Encabezado derecho — datos del comprobante ───────────────────────────────
  const RX = COL + 14
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0)
  doc.text(`FACTURA`, RX, 15)
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80)
  const pvStr = String(data.punto_venta).padStart(4, '0')
  const ncStr = String(data.numero_comprobante).padStart(8, '0')
  doc.text(`N° ${pvStr}-${ncStr}`, RX, 21)
  doc.text(`Fecha: ${formatFecha(data.fecha)}`, RX, 27)

  // ── Línea divisoria horizontal ───────────────────────────────────────────────
  const lineY = Math.max(y, 34) + 2
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
  const sinIVA = esComprobanteSinIVA(data.tipo_comprobante)
  const ivaGroups: Record<number, number> = {}

  if (sinIVA) {
    const rows = data.items.map(item => [
      item.descripcion,
      String(item.cantidad % 1 === 0 ? item.cantidad : item.cantidad.toFixed(3)),
      fmtPesos(item.subtotal / item.cantidad),
      fmtPesos(item.subtotal),
    ])
    autoTable(doc, {
      startY:      tableY,
      margin:      { left: 14, right: 14 },
      head:        [['Descripción', 'Cant.', 'P. Unitario', 'Subtotal']],
      body:        rows,
      headStyles:  { fillColor: [30, 58, 95], fontSize: 8, halign: 'center' },
      bodyStyles:  { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 96 },
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'right', cellWidth: 33 },
        3: { halign: 'right', cellWidth: 33 },
      },
      theme: 'striped',
    })
  } else {
    const rows = data.items.map(item => {
      const neto = item.subtotal / (1 + item.alicuota_iva / 100)
      const ivaM = item.subtotal - neto
      ivaGroups[item.alicuota_iva] = (ivaGroups[item.alicuota_iva] ?? 0) + ivaM
      return [
        item.descripcion,
        String(item.cantidad % 1 === 0 ? item.cantidad : item.cantidad.toFixed(3)),
        fmtPesos(item.subtotal / item.cantidad / (1 + item.alicuota_iva / 100)),
        `${item.alicuota_iva}%`,
        fmtPesos(neto),
        fmtPesos(ivaM),
        fmtPesos(item.subtotal),
      ]
    })
    autoTable(doc, {
      startY:      tableY,
      margin:      { left: 14, right: 14 },
      head:        [['Descripción', 'Cant.', 'P. Unit. Neto', 'IVA %', 'Subtotal Neto', 'IVA $', 'Total']],
      body:        rows,
      headStyles:  { fillColor: [30, 58, 95], fontSize: 8, halign: 'center' },
      bodyStyles:  { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { halign: 'center', cellWidth: 14 },
        2: { halign: 'right', cellWidth: 26 },
        3: { halign: 'center', cellWidth: 14 },
        4: { halign: 'right', cellWidth: 26 },
        5: { halign: 'right', cellWidth: 20 },
        6: { halign: 'right', cellWidth: 24 },
      },
      theme: 'striped',
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

  // ── CAE + QR ─────────────────────────────────────────────────────────────────
  const caeY = ty + 4
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(80)
  doc.text(`CAE N°: ${data.cae}`, 14, caeY)
  doc.text(`Vencimiento CAE: ${formatFecha(data.vencimiento_cae)}`, 14, caeY + 5)

  // QR (40×40mm a la derecha)
  const qrX = W - 14 - 35; const qrY = caeY - 4
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, 35, 35)
  doc.setFontSize(7).setTextColor(120)
  doc.text('Comprobante', qrX + 17.5, qrY + 37, { align: 'center' })
  doc.text('Electrónico AFIP', qrX + 17.5, qrY + 40, { align: 'center' })

  // ── Pie ───────────────────────────────────────────────────────────────────────
  doc.setDrawColor(180).setLineWidth(0.3)
  doc.line(14, 280, W - 14, 280)
  doc.setFontSize(7).setTextColor(150)
  doc.text('Comprobante fiscal electrónico — Genesis360', W / 2, 285, { align: 'center' })

  return doc
}

function nombreFacturaPDF(data: FacturaPDFData): string {
  const pvPad = String(data.punto_venta).padStart(4, '0')
  const ncPad = String(data.numero_comprobante).padStart(8, '0')
  return `Factura_${data.tipo_comprobante}_${pvPad}_${ncPad}.pdf`
}

/** Genera el PDF y lo descarga (default) o lo abre listo para imprimir. */
export async function generarFacturaPDF(
  data: FacturaPDFData,
  accion: 'descargar' | 'imprimir' = 'descargar',
): Promise<void> {
  const doc = await construirFacturaPDFDoc(data)
  if (accion === 'imprimir') {
    doc.autoPrint()
    const url = doc.output('bloburl')
    window.open(url as unknown as string, '_blank')
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
