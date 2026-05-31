/**
 * GS1 — parser y encoder de códigos compuestos (ISS-127).
 *
 * Soporta los Application Identifiers (AIs) acordados:
 *   01  GTIN            (fijo, 14 dígitos)
 *   10  Lote            (variable, alfanumérico, terminado en FNC1)
 *   17  Vencimiento     (fijo, 6 dígitos YYMMDD)
 *   11  Producción      (fijo, 6 dígitos YYMMDD)
 *   21  Serie           (variable, terminado en FNC1)
 *   37  Cantidad        (variable, numérico, terminado en FNC1)
 *   30  Cantidad var.   (variable, numérico, terminado en FNC1)
 *   392x Precio         (AI de 4 dígitos; 4º dígito = decimales; monto variable)
 *
 * El parseo es autodescriptivo: los AIs vienen en el código. La generación se
 * alimenta de un perfil (qué AIs incluir) — ver `codigo_perfiles` (mig 157).
 *
 * FNC1: los lectores suelen emitir el separador de grupo como GS (\x1d). También
 * pueden anteponer un identificador de simbología (]C1, ]d2, ]Q3). Ambos se
 * normalizan antes de parsear.
 */

export interface GS1Fields {
  gtin?: string
  lote?: string
  /** ISO YYYY-MM-DD */
  vencimiento?: string
  /** ISO YYYY-MM-DD */
  produccion?: string
  cantidad?: number
  serie?: string
  /** valor decimal ya escalado (ej: 1234 con 2 decimales → 12.34) */
  precio?: number
  /** AIs presentes en el código que no mapeamos a un campo conocido */
  _desconocidos?: Record<string, string>
}

const GS = '\x1d' // FNC1 / group separator

// AIs de longitud FIJA (data length, sin contar el AI).
const FIXED: Record<string, number> = {
  '00': 18, '01': 14, '02': 14,
  '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6,
  '20': 2,
}

/** Quita prefijos de simbología (]C1, ]d2, ]Q3, ]e0) que algunos lectores anteponen. */
function stripSymbology(raw: string): string {
  return raw.replace(/^\][A-Za-z]\d/, '')
}

/** YYMMDD → ISO YYYY-MM-DD. DD='00' ⇒ último día del mes. Pivote de siglo 2000-2099. */
export function yymmddToISO(s: string): string | undefined {
  if (!/^\d{6}$/.test(s)) return undefined
  const yy = parseInt(s.slice(0, 2), 10)
  const mm = parseInt(s.slice(2, 4), 10)
  let dd = parseInt(s.slice(4, 6), 10)
  if (mm < 1 || mm > 12) return undefined
  const year = 2000 + yy
  if (dd === 0) dd = new Date(year, mm, 0).getDate() // último día del mes
  const mmS = String(mm).padStart(2, '0')
  const ddS = String(dd).padStart(2, '0')
  return `${year}-${mmS}-${ddS}`
}

/** ISO YYYY-MM-DD (o Date) → YYMMDD. */
export function isoToYYMMDD(iso: string): string {
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso
  const [y, m, day] = d.split('-')
  return `${y.slice(2)}${m.padStart(2, '0')}${(day ?? '01').padStart(2, '0')}`
}

/** Normaliza un GTIN/EAN para comparar (quita ceros a la izquierda). */
export function normalizeGtin(code: string | null | undefined): string {
  return (code ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

/**
 * Parsea un string escaneado GS1 a campos. Tolerante: ignora AIs desconocidos
 * (los guarda en `_desconocidos`) y corta limpio si encuentra datos mal formados.
 */
export function parseGS1(rawInput: string): GS1Fields {
  const out: GS1Fields = {}
  const desconocidos: Record<string, string> = {}
  let raw = stripSymbology(rawInput ?? '')
  let i = 0

  const readVar = (from: number): { value: string; next: number } => {
    const gs = raw.indexOf(GS, from)
    if (gs === -1) return { value: raw.slice(from), next: raw.length }
    return { value: raw.slice(from, gs), next: gs + 1 }
  }

  while (i < raw.length) {
    if (raw[i] === GS) { i++; continue }
    // AI de 2 dígitos base
    let ai = raw.slice(i, i + 2)
    if (!/^\d{2}$/.test(ai)) break

    // Precio: AI de 4 dígitos 392x / 393x (4º dígito = decimales)
    if (ai === '39' && /^\d{4}$/.test(raw.slice(i, i + 4)) && (raw[i + 2] === '2' || raw[i + 2] === '3')) {
      const ai4 = raw.slice(i, i + 4)
      const dec = parseInt(ai4[3], 10)
      const { value, next } = readVar(i + 4)
      const intVal = parseInt(value.replace(/\D/g, ''), 10)
      if (!isNaN(intVal)) out.precio = dec > 0 ? intVal / Math.pow(10, dec) : intVal
      i = next
      continue
    }

    if (ai in FIXED) {
      const len = FIXED[ai]
      const value = raw.slice(i + 2, i + 2 + len)
      const next = i + 2 + len
      switch (ai) {
        case '01': out.gtin = value; break
        case '17': out.vencimiento = yymmddToISO(value); break
        case '11': out.produccion = yymmddToISO(value); break
        default:   desconocidos[ai] = value
      }
      i = next
      continue
    }

    // AIs variables que soportamos
    if (ai === '10' || ai === '21' || ai === '37' || ai === '30') {
      const { value, next } = readVar(i + 2)
      switch (ai) {
        case '10': out.lote = value; break
        case '21': out.serie = value; break
        case '37':
        case '30': {
          const n = parseInt(value.replace(/\D/g, ''), 10)
          if (!isNaN(n)) out.cantidad = n
          break
        }
      }
      i = next
      continue
    }

    // AI desconocido variable → leer hasta FNC1 para no romper el resto
    const { value, next } = readVar(i + 2)
    desconocidos[ai] = value
    i = next
  }

  if (Object.keys(desconocidos).length) out._desconocidos = desconocidos
  return out
}

/**
 * Construye el element string GS1 en formato con paréntesis — apto para bwip-js
 * (que inserta los FNC1 correctos). Ej: "(01)07501234567890(10)L123(17)251231".
 * `ais` define qué incluir y en qué orden; solo se emite el AI si hay dato.
 */
export function buildGS1ElementString(fields: GS1Fields, ais: string[]): string {
  const parts: string[] = []
  for (const ai of ais) {
    switch (ai) {
      case '01':
        if (fields.gtin) parts.push(`(01)${fields.gtin.replace(/\D/g, '').padStart(14, '0')}`)
        break
      case '10':
        if (fields.lote) parts.push(`(10)${fields.lote}`)
        break
      case '17':
        if (fields.vencimiento) parts.push(`(17)${isoToYYMMDD(fields.vencimiento)}`)
        break
      case '11':
        if (fields.produccion) parts.push(`(11)${isoToYYMMDD(fields.produccion)}`)
        break
      case '21':
        if (fields.serie) parts.push(`(21)${fields.serie}`)
        break
      case '37':
      case '30':
        if (fields.cantidad != null) parts.push(`(${ai})${Math.round(fields.cantidad)}`)
        break
      default:
        // Precio: AI 392x con 2 decimales por defecto (3922)
        if ((ai === '392' || ai.startsWith('392') || ai === 'precio') && fields.precio != null) {
          const cents = Math.round(fields.precio * 100)
          parts.push(`(3922)${cents}`)
        }
    }
  }
  return parts.join('')
}

/** Lista de AIs soportados para la UI de perfiles. */
export const AIS_SOPORTADOS: { ai: string; label: string }[] = [
  { ai: '01', label: 'GTIN (01)' },
  { ai: '10', label: 'Lote (10)' },
  { ai: '17', label: 'Vencimiento (17)' },
  { ai: '11', label: 'Producción (11)' },
  { ai: '21', label: 'Serie (21)' },
  { ai: '37', label: 'Cantidad (37)' },
  { ai: '3922', label: 'Precio (392x)' },
]
