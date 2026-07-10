// ─── WSFE propio — núcleo PURO del transporte (fase 3 del dual-provider) ────────
// Builders y parsers de los XML de WSAA (LoginCms) y WSFEv1 (FECAESolicitar /
// FECompUltimoAutorizado). CERO dependencias y CERO I/O: todo lo que toca red o
// firma criptográfica vive en providers.ts (Deno) — este módulo lo comparte
// también la suite de vitest (tests/unit/wsfePropio.test.ts) y el script de
// integración contra homologación, así el XML que se testea es EXACTAMENTE el
// que se manda a AFIP (REGLA #0: el código fiscal no se duplica ni se bifurca).
//
// El ORDEN de los elementos del detalle sale del XSD real del servicio
// (wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL, complexType FEDetRequest):
//   Concepto, DocTipo, DocNro, CbteDesde, CbteHasta, CbteFch, ImpTotal,
//   ImpTotConc, ImpNeto, ImpOpEx, ImpTrib, ImpIVA, FchServDesde, FchServHasta,
//   FchVtoPago, MonId, MonCotiz, CanMisMonExt, CondicionIVAReceptorId,
//   CbtesAsoc, Tributos, Iva, Opcionales, Compradores, PeriodoAsoc, Actividades
// (⚠ ImpTrib va ANTES que ImpIVA — el payload del app los declara al revés; el
// builder emite SIEMPRE en el orden del XSD, el .NET de AFIP valida secuencia.)

// ── Endpoints ────────────────────────────────────────────────────────────────────
export const WSAA_URL = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
} as const

export const WSFE_URL = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
} as const

export const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/'
export const WSFE_SOAP_ACTION = (op: string) => `${WSFE_NS}${op}`

// ── Tipos ────────────────────────────────────────────────────────────────────────
export interface WsaaTa {
  token: string
  sign: string
  /** ISO 8601 tal como lo devuelve WSAA (hora AR con offset). */
  expirationTime: string
}

export interface WsfeError { code: number; msg: string }

export interface FECAESolicitarParsed {
  /** 'A' aprobado · 'R' rechazado · 'P' parcial (con CantReg=1 no debería darse). */
  resultado: string
  cae: string
  caeFchVto: string
  observaciones: WsfeError[]
  errors: WsfeError[]
  events: WsfeError[]
}

export interface UltimoAutorizadoParsed {
  cbteNro: number
  errors: WsfeError[]
}

// ── Helpers XML (escapado + extracción con tolerancia a prefijos de namespace) ──
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Extrae el contenido del PRIMER <tag>…</tag>, tolerando prefijo de namespace
 *  (soapenv:, ns1:, etc.) y atributos. Devuelve null si no está. */
export function pickTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`)
  const m = xml.match(re)
  return m ? m[1] : null
}

/** Extrae TODOS los bloques <tag>…</tag> (para arrays: Err, Obs, Evt…). */
export function pickTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

function parseErrList(xml: string | null, itemTag: string): WsfeError[] {
  if (!xml) return []
  return pickTags(xml, itemTag).map((b) => ({
    code: parseInt(pickTag(b, 'Code') ?? '0', 10),
    msg: unescapeXml((pickTag(b, 'Msg') ?? '').trim()),
  }))
}

// ── WSAA: TRA + LoginCms ─────────────────────────────────────────────────────────
/** TRA (Ticket de Requerimiento de Acceso). Ventana ±20 min alrededor de `now`
 *  para tolerar drift de reloj (AFIP rechaza TRAs fuera de ventana). */
export function buildTRA(service: string, now: Date = new Date()): string {
  const gen = new Date(now.getTime() - 20 * 60 * 1000).toISOString()
  const exp = new Date(now.getTime() + 20 * 60 * 1000).toISOString()
  const uniqueId = Math.floor(now.getTime() / 1000)
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${gen}</generationTime>
    <expirationTime>${exp}</expirationTime>
  </header>
  <service>${escapeXml(service)}</service>
</loginTicketRequest>`
}

/** Envelope SOAP 1.1 del loginCms (WSAA es Axis/Java: SOAPAction vacío). */
export function buildLoginCmsEnvelope(cmsBase64: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`
}

/** Fault de WSAA (p.ej. coe.alreadyAuthenticated). Null si no hay fault. */
export function parseSoapFault(xml: string): { code: string; msg: string } | null {
  const code = pickTag(xml, 'faultcode')
  if (!code) return null
  return { code: code.trim(), msg: (pickTag(xml, 'faultstring') ?? '').trim() }
}

/** Parsea la respuesta del loginCms → TA. Lanza si viene fault o si faltan campos. */
export function parseLoginCmsResponse(xml: string): WsaaTa {
  const fault = parseSoapFault(xml)
  if (fault) {
    const already = fault.code.includes('alreadyAuthenticated')
    throw new WsaaError(fault.code, fault.msg, already)
  }
  const returned = pickTag(xml, 'loginCmsReturn')
  if (!returned) throw new Error('WSAA: respuesta sin loginCmsReturn')
  const inner = unescapeXml(returned)
  const token = pickTag(inner, 'token')
  const sign = pickTag(inner, 'sign')
  const expirationTime = pickTag(inner, 'expirationTime')
  if (!token || !sign || !expirationTime) throw new Error('WSAA: loginTicketResponse incompleto (sin token/sign/expirationTime)')
  return { token: token.trim(), sign: sign.trim(), expirationTime: expirationTime.trim() }
}

export class WsaaError extends Error {
  constructor(public faultCode: string, faultString: string, public alreadyAuthenticated: boolean) {
    super(`WSAA ${faultCode}: ${faultString}`)
  }
}

/** ¿El TA sigue vigente con margen? (margen default 5 min: no usar un TA por vencerse.) */
export function taVigente(expirationTimeIso: string, now: Date = new Date(), marginMs = 5 * 60 * 1000): boolean {
  const exp = Date.parse(expirationTimeIso)
  if (Number.isNaN(exp)) return false
  return exp - marginMs > now.getTime()
}

// ── WSFEv1: envelopes ────────────────────────────────────────────────────────────
function wsfeEnvelope(op: string, inner: string): string {
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${op} xmlns="${WSFE_NS}">
${inner}
    </${op}>
  </soap:Body>
</soap:Envelope>`
}

function authXml(ta: WsaaTa, cuit: number): string {
  return `      <Auth>
        <Token>${escapeXml(ta.token)}</Token>
        <Sign>${escapeXml(ta.sign)}</Sign>
        <Cuit>${cuit}</Cuit>
      </Auth>`
}

export function buildFEDummyEnvelope(): string {
  return wsfeEnvelope('FEDummy', '')
}

export function buildFECompUltimoAutorizadoEnvelope(ta: WsaaTa, cuit: number, ptoVta: number, cbteTipo: number): string {
  return wsfeEnvelope('FECompUltimoAutorizado', `${authXml(ta, cuit)}
      <PtoVta>${ptoVta}</PtoVta>
      <CbteTipo>${cbteTipo}</CbteTipo>`)
}

// Payload estilo AfipSDK (el que arma index.ts — NO cambiarlo: es la lógica fiscal
// compartida). Acá solo se TRADUCE a XML en el orden del XSD.
export type WsfePayload = Record<string, unknown>

/** Emite `<name>value</name>` si el valor está definido; '' si no. */
function el(name: string, v: unknown): string {
  if (v === undefined || v === null) return ''
  return `<${name}>${typeof v === 'string' ? escapeXml(v) : String(v)}</${name}>`
}

function cbtesAsocXml(list: unknown): string {
  if (!Array.isArray(list) || !list.length) return ''
  const items = list.map((c: Record<string, unknown>) =>
    `<CbteAsoc>${el('Tipo', c.Tipo)}${el('PtoVta', c.PtoVta)}${el('Nro', c.Nro)}${el('Cuit', c.Cuit)}${el('CbteFch', c.CbteFch)}</CbteAsoc>`
  ).join('')
  return `<CbtesAsoc>${items}</CbtesAsoc>`
}

function tributosXml(list: unknown): string {
  if (!Array.isArray(list) || !list.length) return ''
  const items = list.map((t: Record<string, unknown>) =>
    `<Tributo>${el('Id', t.Id)}${el('Desc', t.Desc)}${el('BaseImp', t.BaseImp)}${el('Alic', t.Alic)}${el('Importe', t.Importe)}</Tributo>`
  ).join('')
  return `<Tributos>${items}</Tributos>`
}

function ivaXml(list: unknown): string {
  if (!Array.isArray(list) || !list.length) return ''
  const items = list.map((a: Record<string, unknown>) =>
    `<AlicIva>${el('Id', a.Id)}${el('BaseImp', a.BaseImp)}${el('Importe', a.Importe)}</AlicIva>`
  ).join('')
  return `<Iva>${items}</Iva>`
}

/** FECAEDetRequest en el ORDEN EXACTO del XSD (ver header del archivo). */
export function buildFECAEDetXml(p: WsfePayload): string {
  return `<FECAEDetRequest>${
    el('Concepto', p.Concepto)
  }${el('DocTipo', p.DocTipo)
  }${el('DocNro', p.DocNro)
  }${el('CbteDesde', p.CbteDesde)
  }${el('CbteHasta', p.CbteHasta)
  }${el('CbteFch', p.CbteFch)
  }${el('ImpTotal', p.ImpTotal)
  }${el('ImpTotConc', p.ImpTotConc)
  }${el('ImpNeto', p.ImpNeto)
  }${el('ImpOpEx', p.ImpOpEx)
  }${el('ImpTrib', p.ImpTrib)
  }${el('ImpIVA', p.ImpIVA)
  }${el('FchServDesde', p.FchServDesde)
  }${el('FchServHasta', p.FchServHasta)
  }${el('FchVtoPago', p.FchVtoPago)
  }${el('MonId', p.MonId)
  }${el('MonCotiz', p.MonCotiz)
  }${el('CondicionIVAReceptorId', p.CondicionIVAReceptorId)
  }${cbtesAsocXml(p.CbtesAsoc)
  }${tributosXml(p.Tributos)
  }${ivaXml(p.Iva)
  }</FECAEDetRequest>`
}

export function buildFECAESolicitarEnvelope(ta: WsaaTa, cuit: number, p: WsfePayload): string {
  return wsfeEnvelope('FECAESolicitar', `${authXml(ta, cuit)}
      <FeCAEReq>
        <FeCabReq>${el('CantReg', p.CantReg)}${el('PtoVta', p.PtoVta)}${el('CbteTipo', p.CbteTipo)}</FeCabReq>
        <FeDetReq>${buildFECAEDetXml(p)}</FeDetReq>
      </FeCAEReq>`)
}

// ── WSFEv1: parsers ──────────────────────────────────────────────────────────────
export function parseFECompUltimoAutorizadoResponse(xml: string): UltimoAutorizadoParsed {
  const fault = parseSoapFault(xml)
  if (fault) throw new Error(`WSFE fault en FECompUltimoAutorizado — ${fault.code}: ${fault.msg}`)
  const result = pickTag(xml, 'FECompUltimoAutorizadoResult')
  if (!result) throw new Error('WSFE: respuesta sin FECompUltimoAutorizadoResult')
  const errors = parseErrList(pickTag(result, 'Errors'), 'Err')
  const cbteNroStr = pickTag(result, 'CbteNro')
  const cbteNro = cbteNroStr === null ? NaN : parseInt(cbteNroStr, 10)
  return { cbteNro, errors }
}

export function parseFECAESolicitarResponse(xml: string): FECAESolicitarParsed {
  const fault = parseSoapFault(xml)
  if (fault) throw new Error(`WSFE fault en FECAESolicitar — ${fault.code}: ${fault.msg}`)
  const result = pickTag(xml, 'FECAESolicitarResult')
  if (!result) throw new Error('WSFE: respuesta sin FECAESolicitarResult')

  const errors = parseErrList(pickTag(result, 'Errors'), 'Err')
  const events = parseErrList(pickTag(result, 'Events'), 'Evt')

  // El Resultado global viene en FeCabResp; el detalle (con CAE y Observaciones)
  // en FeDetResp/FECAEDetResponse. Con CantReg=1 hay exactamente un det.
  const det = pickTag(result, 'FECAEDetResponse') ?? ''
  const observaciones = parseErrList(pickTag(det, 'Observaciones'), 'Obs')
  const resultado = (pickTag(det, 'Resultado') ?? pickTag(pickTag(result, 'FeCabResp') ?? '', 'Resultado') ?? '').trim()

  return {
    resultado,
    cae: (pickTag(det, 'CAE') ?? '').trim(),
    caeFchVto: (pickTag(det, 'CAEFchVto') ?? '').trim(),
    observaciones,
    errors,
    events,
  }
}

/** Formatea la lista de errores/observaciones de AFIP para mensajes de error. */
export function fmtWsfeErrs(list: WsfeError[]): string {
  return list.map((e) => `${e.code}: ${e.msg}`).join(' · ')
}
