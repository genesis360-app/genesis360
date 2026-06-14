// Lógica pura de facturación electrónica AFIP/ARCA (RG 5616 / RG 4291).
//
// Es el ESPEJO testeable de la Edge Function `emitir-factura` (que corre en Deno y no
// puede importar de src/lib) + la auto-detección de tipo de comprobante usada en el
// frontend (VentasPage / FacturacionPage) + la construcción del QR del PDF.
//
// ⚠ Mantener sincronizado con: supabase/functions/emitir-factura/index.ts
//   y src/lib/facturasPDF.ts (que importa buildQrAfipUrl desde acá).

export type TipoComprobante = 'A' | 'B' | 'C'

// ── Mapeos AFIP ────────────────────────────────────────────────────────────────

// tipo_comprobante → CbteTipo (WSFE)
export const TIPO_CBTE: Record<string, number> = {
  A: 1, B: 6, C: 11,
  'NC-A': 3, 'NC-B': 8, 'NC-C': 13,
  'ND-A': 2, 'ND-B': 7, 'ND-C': 12,
}

// condicion_iva del receptor → CondicionIVAReceptorId (RG 5616, obligatorio desde 2025)
export const IVA_RECEPTOR_ID: Record<string, number> = {
  RI: 1,                 // Responsable Inscripto
  Exento: 2,
  'No Responsable': 3,
  Monotributista: 4,
  CF: 5,                 // Consumidor Final
  consumidor_final: 5,
}

// alicuota_iva → Id del array Iva del payload WSFE
export const ALICUOTA_ID: Record<string, number> = {
  '0': 3, '10.5': 4, '21': 5, '27': 6, exento: 3, sin_iva: 3,
}

export const UMBRAL_FACTURA_B_DEFAULT = 68305.16

const r2 = (n: number): number => parseFloat(n.toFixed(2))

// ── Auto-detección del tipo de comprobante ──────────────────────────────────────
// Emisor Monotributista → SIEMPRE C. Emisor RI: receptor RI → A (discrimina IVA),
// resto (CF/Mono/Exento) → B (IVA incluido).
export function detectarTipoComprobante(
  emisorCondIva?: string | null,
  receptorCondIva?: string | null,
): TipoComprobante {
  if (emisorCondIva === 'Monotributista') return 'C'
  if (receptorCondIva === 'RI') return 'A'
  return 'B'
}

// ── Desglose de IVA por alícuota ────────────────────────────────────────────────

export interface ItemFacturable {
  cantidad: number
  precio_unitario: number
  /** Total de la línea CON IVA incluido. Si falta, se usa precio_unitario × cantidad. */
  subtotal?: number | null
  /** '21' | 21 | '10.5' | '0' | 'exento' | 'sin_iva' (default '21'). */
  alicuota_iva?: string | number | null
}

export interface IvaItemWSFE {
  Id: number
  BaseImp: number
  Importe: number
}

export interface IvaDesglose {
  totalNeto: number
  totalIVA: number
  /** ImpTotal correcto para WSFE: neto + IVA (los demás Imp* son 0). */
  impTotal: number
  iva: IvaItemWSFE[]
}

/**
 * Calcula neto + IVA por alícuota a partir de líneas con precio CON IVA incluido.
 * El precio de venta en Genesis360 ya incluye IVA, así que el neto se obtiene
 * "desarmando" la tasa: neto = subtotal / (1 + tasa).
 */
export function calcularIvaDesglose(items: ItemFacturable[]): IvaDesglose {
  const ivaMap: Record<number, { base: number; importe: number }> = {}
  let totalNeto = 0
  let totalIVA = 0

  for (const it of items) {
    const qty = Number(it.cantidad)
    const precio = Number(it.precio_unitario)
    const subTotal = Number(it.subtotal ?? precio * qty)
    const tasaStr = String(it.alicuota_iva ?? '21')
    const ivaId = ALICUOTA_ID[tasaStr] ?? 5
    const tasa = tasaStr === 'exento' || tasaStr === 'sin_iva' ? 0 : parseFloat(tasaStr) / 100
    const ivaItem = tasa > 0 ? r2(subTotal - subTotal / (1 + tasa)) : 0
    const netoItem = r2(subTotal - ivaItem)

    totalNeto += netoItem
    totalIVA += ivaItem
    if (!ivaMap[ivaId]) ivaMap[ivaId] = { base: 0, importe: 0 }
    ivaMap[ivaId].base += netoItem
    ivaMap[ivaId].importe += ivaItem
  }

  totalNeto = r2(totalNeto)
  totalIVA = r2(totalIVA)

  return {
    totalNeto,
    totalIVA,
    impTotal: r2(totalNeto + totalIVA),
    iva: Object.entries(ivaMap).map(([id, v]) => ({
      Id: parseInt(id),
      BaseImp: r2(v.base),
      Importe: r2(v.importe),
    })),
  }
}

// ── Documento del receptor (DocTipo/DocNro) + condición IVA ──────────────────────

export interface ClienteReceptor {
  dni?: string | null
  cuit_receptor?: string | null
  condicion_iva_receptor?: string | null
}

export interface ReceptorDoc {
  docTipo: number   // 99 = Consumidor Final | 96 = DNI | 80 = CUIT
  docNro: number
  condicionIvaReceptorId: number
}

/**
 * Determina DocTipo/DocNro del receptor según RG 5616:
 *  - Factura A → exige CUIT del cliente (DocTipo 80). Lanza si falta.
 *  - Resto: bajo umbral → Consumidor Final (99/0); ≥ umbral con DNI → DNI (96).
 */
export function determinarReceptor(
  tipoComprobante: string,
  totalVenta: number,
  cliente: ClienteReceptor | null | undefined,
  umbral: number = UMBRAL_FACTURA_B_DEFAULT,
): ReceptorDoc {
  const condicion = cliente?.condicion_iva_receptor ?? 'CF'
  const condicionIvaReceptorId = IVA_RECEPTOR_ID[condicion] ?? 5

  let docTipo = 99
  let docNro = 0

  if (tipoComprobante === 'A') {
    docTipo = 80
    docNro = parseInt((cliente?.cuit_receptor ?? '').replace(/[-\s]/g, '')) || 0
    if (!docNro) throw new Error('Para Factura A se requiere CUIT del cliente')
  } else if (totalVenta >= umbral && cliente?.dni) {
    docTipo = 96
    docNro = parseInt((cliente.dni ?? '').replace(/[.\s-]/g, '')) || 0
  }

  return { docTipo, docNro, condicionIvaReceptorId }
}

// ── QR AFIP del comprobante (RG 4291) ───────────────────────────────────────────

export interface QrAfipInput {
  fecha: string              // ISO; se usa fecha.slice(0,10)
  emisorCuit: string         // con o sin guiones
  puntoVenta: number
  tipoComprobante: string    // 'A' | 'B' | 'C'
  numeroComprobante: number
  importe: number
  cae: string
  receptorCuitDni?: string | null
  moneda?: string            // default 'PES'
}

/**
 * Construye la URL del QR fiscal (RG 4291): payload JSON → base64 → URL de AFIP.
 * tipoDocRec se infiere del largo del número: 11 díg = CUIT (80), 7-10 = DNI (96),
 * resto = Consumidor Final (99).
 */
export function buildQrAfipUrl(i: QrAfipInput): string {
  const nroDocRec = (i.receptorCuitDni ?? '').replace(/\D/g, '') || '0'
  const tipoDocRec = nroDocRec.length === 11 ? 80
    : nroDocRec.length >= 7 ? 96
    : 99

  const payload = {
    ver: 1,
    fecha: i.fecha.slice(0, 10),
    cuit: parseInt(i.emisorCuit.replace(/\D/g, '')),
    ptoVta: i.puntoVenta,
    tipoCmp: TIPO_CBTE[i.tipoComprobante] ?? 6,
    nroCmp: i.numeroComprobante,
    importe: i.importe,
    moneda: i.moneda ?? 'PES',
    ctz: 1,
    tipoDocRec,
    nroDocRec: parseInt(nroDocRec) || 0,
    tipoCodAut: 'E',
    codAut: parseInt(i.cae),
  }

  const b64 = btoa(JSON.stringify(payload))
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}
