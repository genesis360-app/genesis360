// ─── Padrón de ARCA — núcleo PURO (ws_sr_constancia_inscripcion, getPersona_v2) ──────
// Validación de CUIT, sobre SOAP de la consulta y parser de la respuesta. CERO dependencias y
// CERO I/O: la red y la firma viven en la EF `consultar-cuit`. Lo importa también vitest
// (tests/unit/padronArca.test.ts) y el front (src/lib/padronArca.ts re-exporta), así el mapeo
// que se testea es exactamente el que usa la EF.
//
// Fuente: manual oficial ws_sr_constancia_inscripcion v3.4 (08/05/23).
//
// 🛑 REGLA #0 — la condición frente al IVA decide si al cliente se le hace Factura A o B. Solo
// se infiere cuando ARCA mandó los datos del régimen: si vino `errorRegimenGeneral` /
// `errorMonotributo` / `errorConstancia` sin datos de impuestos, la condición queda en `null`
// ("no se pudo determinar") y NUNCA cae a Consumidor Final por descarte.

// ── Endpoints ────────────────────────────────────────────────────────────────────
export const PADRON_URL = {
  homologacion: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  produccion: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
} as const

export const PADRON_SERVICE = 'ws_sr_constancia_inscripcion'

// ── CUIT ─────────────────────────────────────────────────────────────────────────
/** Deja solo los dígitos ("20-42237416-8" → "20422374168"). */
export function normalizarCuit(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '')
}

const PREFIJOS_CUIT = new Set(['20', '23', '24', '25', '26', '27', '30', '33', '34'])

/** CUIT/CUIL válido: 11 dígitos, prefijo conocido y dígito verificador (módulo 11). */
export function cuitValido(v: string | null | undefined): boolean {
  const c = normalizarCuit(v)
  if (!/^\d{11}$/.test(c)) return false
  if (!PREFIJOS_CUIT.has(c.slice(0, 2))) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(c[i]), 0)
  const resto = 11 - (suma % 11)
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto
  return dv === Number(c[10])
}

// ── Request ──────────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildGetPersonaV2Envelope(token: string, sign: string, cuitRepresentada: string, idPersona: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>${esc(token)}</token>
      <sign>${esc(sign)}</sign>
      <cuitRepresentada>${normalizarCuit(cuitRepresentada)}</cuitRepresentada>
      <idPersona>${normalizarCuit(idPersona)}</idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`
}

// ── Response ─────────────────────────────────────────────────────────────────────
/** Código NEUTRO; cada pantalla lo traduce a su vocabulario (clientes, proveedores, emisor). */
export type CondicionIvaPadron = 'RI' | 'MONOTRIBUTO' | 'EXENTO' | 'CF'

export interface PersonaPadron {
  cuit: string
  tipoPersona: 'FISICA' | 'JURIDICA' | null
  /** Razón social (jurídica) o "APELLIDO NOMBRE" (física). */
  nombre: string | null
  estadoClave: string | null
  activa: boolean
  /** null = ARCA no mandó los datos del régimen → no se puede decidir (nunca se asume CF). */
  condicionIva: CondicionIvaPadron | null
  domicilio: {
    direccion: string | null
    localidad: string | null
    codPostal: string | null
    provincia: string | null
    /** Una línea lista para `domicilio_fiscal`. */
    texto: string | null
  } | null
  /** Observaciones de ARCA (errorConstancia / errorRegimenGeneral / errorMonotributo). */
  avisos: string[]
}

export type ResultadoPadron =
  | { ok: true; persona: PersonaPadron }
  | { ok: false; motivo: 'no_existe' | 'error_arca'; mensaje: string; detalle?: string }

const MENSAJE_FALLA = 'ARCA no pudo responder la consulta. Podés cargar los datos a mano.'

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

function bloque(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`))
  return m ? m[1] : null
}

function bloques(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

/** Valor de texto de un tag hoja, limpio (espacios colapsados, sin el "*" de relleno de ARCA). */
function texto(xml: string | null, tag: string): string | null {
  if (!xml) return null
  const v = bloque(xml, tag)
  if (v == null) return null
  const limpio = decode(v).replace(/\s+/g, ' ').replace(/\s*\*+\s*$/, '').trim()
  return limpio || null
}

function idsImpuesto(xml: string | null): number[] {
  if (!xml) return []
  return bloques(xml, 'impuesto')
    .map((b) => Number(texto(b, 'idImpuesto')))
    .filter((n) => Number.isFinite(n))
}

/**
 * Condición frente al IVA a partir de los regímenes que vinieron.
 *  - datosMonotributo presente → Monotributo (prevalece: el monotributista no está inscripto en IVA)
 *  - impuesto 30 (IVA) → Responsable Inscripto
 *  - impuesto 32 (IVA EXENTO) → Exento
 *  - datosRegimenGeneral presente sin IVA → Consumidor Final
 *  - nada de lo anterior, o un error de régimen → null (no determinada)
 */
export function condicionIvaDesde(personaXml: string): CondicionIvaPadron | null {
  const mono = bloque(personaXml, 'datosMonotributo')
  const rg = bloque(personaXml, 'datosRegimenGeneral')
  const errRg = bloque(personaXml, 'errorRegimenGeneral')
  const errMono = bloque(personaXml, 'errorMonotributo')

  if (mono != null) return 'MONOTRIBUTO'
  const ids = idsImpuesto(rg)
  if (ids.includes(30)) return 'RI'
  if (ids.includes(32)) return 'EXENTO'
  // Sin IVA ni monotributo: solo es CF si ARCA mandó el régimen general completo y sin error.
  // ⚠️ CRITERIO CONTABLE PENDIENTE DE VALIDAR — C-19 de wiki/business/consultas-contador.md.
  if (rg != null && errRg == null && errMono == null) return 'CF'
  return null
}

function erroresDe(xml: string | null): string[] {
  if (!xml) return []
  return bloques(xml, 'error').map((e) => decode(e).replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** Parsea la respuesta de getPersona_v2. */
export function parseGetPersonaV2Response(xml: string, cuitConsultado: string): ResultadoPadron {
  const faultString = texto(xml, 'faultstring')
  if (faultString) {
    // ARCA contesta "No existe persona con ese Id" como fault en algunos casos.
    if (/no existe persona/i.test(faultString)) return { ok: false, motivo: 'no_existe', mensaje: faultString }
    // Un fault es técnico (token, servidor): al usuario va un mensaje accionable; el detalle, al log.
    return { ok: false, motivo: 'error_arca', mensaje: MENSAJE_FALLA, detalle: faultString }
  }

  const persona = bloque(xml, 'personaReturn')
  if (persona == null) return { ok: false, motivo: 'error_arca', mensaje: MENSAJE_FALLA, detalle: 'Respuesta sin personaReturn' }

  const generales = bloque(persona, 'datosGenerales')
  const errConst = bloque(persona, 'errorConstancia')
  const erroresConst = erroresDe(errConst)

  if (!generales) {
    if (erroresConst.some((e) => /no existe persona/i.test(e))) {
      return { ok: false, motivo: 'no_existe', mensaje: 'No existe una persona con ese CUIT en el padrón de ARCA.' }
    }
    // Sin datosGenerales ARCA igual puede mandar nombre/apellido dentro de errorConstancia.
    const nom = [texto(errConst, 'apellido'), texto(errConst, 'nombre')].filter(Boolean).join(' ') || null
    if (!nom) {
      return { ok: false, motivo: 'error_arca', mensaje: erroresConst.join(' · ') || 'ARCA no devolvió datos para ese CUIT.' }
    }
    return {
      ok: true,
      persona: {
        cuit: normalizarCuit(cuitConsultado), tipoPersona: null, nombre: nom, estadoClave: null, activa: false,
        condicionIva: null, domicilio: null, avisos: erroresConst,
      },
    }
  }

  const tipo = texto(generales, 'tipoPersona')
  const tipoPersona = tipo === 'FISICA' || tipo === 'JURIDICA' ? tipo : null
  const razon = texto(generales, 'razonSocial')
  const nombrePf = [texto(generales, 'apellido'), texto(generales, 'nombre')].filter(Boolean).join(' ') || null
  const nombre = razon ?? nombrePf

  const domXml = bloque(generales, 'domicilioFiscal')
  let domicilio: PersonaPadron['domicilio'] = null
  if (domXml) {
    const direccion = texto(domXml, 'direccion')
    const localidad = texto(domXml, 'localidad')
    const codPostal = texto(domXml, 'codPostal')
    const provincia = texto(domXml, 'descripcionProvincia')
    const loc = [codPostal ? `(${codPostal})` : null, localidad].filter(Boolean).join(' ')
    const partes = [direccion, loc || null, provincia].filter(Boolean)
    domicilio = { direccion, localidad, codPostal, provincia, texto: partes.length ? partes.join(', ') : null }
  }

  const estadoClave = texto(generales, 'estadoClave')
  const avisos = [
    ...erroresConst,
    ...erroresDe(bloque(persona, 'errorRegimenGeneral')),
    ...erroresDe(bloque(persona, 'errorMonotributo')),
  ]

  return {
    ok: true,
    persona: {
      cuit: normalizarCuit(texto(generales, 'idPersona') ?? cuitConsultado),
      tipoPersona,
      nombre,
      estadoClave,
      activa: estadoClave === 'ACTIVO',
      condicionIva: condicionIvaDesde(persona),
      domicilio,
      avisos: [...new Set(avisos)],
    },
  }
}
