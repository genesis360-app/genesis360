// consultar-cuit — autocompletar por CUIT desde el padrón de ARCA (ws_sr_constancia_inscripcion)
//
// Al cargar un CUIT en la ficha de cliente, de proveedor, del emisor fiscal o en el alta rápida del POS, el
// front llama acá y muestra una VISTA PREVIA (razón social, condición IVA, domicilio fiscal) que el usuario
// acepta o descarta. Esta función nunca escribe en la ficha.
//
// Se consulta con el certificado de PLATAFORMA de Genesis360 (CUIT de Fede, alias `genesis360plataforma`), no
// con el del negocio: así funciona también para negocios que todavía no cargaron su certificado. `cuitRepresentada`
// = el CUIT del certificado (manual v3.4).
//
// Flujo: sesión válida → rate limit (usuario y negocio) → cache (padron_arca_cache) → WSAA (TA cacheado en
// afip_wsaa_ta, service = ws_sr_constancia_inscripcion) → getPersona_v2 → parser puro (_shared/padronArca.ts).
//
// Configuración (secrets, todos opcionales):
//   ARCA_PADRON_PRODUCCION=true   → padrón real (PROD). Sin esto: homologación (padrón de pruebas, datos ficticios).
//   ARCA_PADRON_CUIT              → CUIT del certificado (default 20422374168).
//   ARCA_PADRON_KEY_PATH          → clave privada en el bucket `certificados-afip` (OBLIGATORIO: el nombre del
//                                   archivo cambia si se regenera la clave, no se adivina).
//   ARCA_PADRON_CERT_PATH         → certificado (default plataforma/<cuit>/<ambiente>.crt).
//   AFIP_FORCE_HOMOLOGACION=true  → master kill, igual que emitir-factura.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore — npm: import para Deno (firma CMS/PKCS#7 del TRA, pure-JS)
import forge from 'npm:node-forge@1.4.0'
import { consumirRateLimit, respuesta429 } from '../_shared/rateLimit.ts'
import {
  PADRON_SERVICE,
  PADRON_URL,
  buildGetPersonaV2Envelope,
  cuitValido,
  normalizarCuit,
  parseGetPersonaV2Response,
  type ResultadoPadron,
} from '../_shared/padronArca.ts'
import { signTra } from '../emitir-factura/wsfe-sign.ts'
import {
  WSAA_URL,
  WsaaError,
  buildLoginCmsEnvelope,
  buildTRA,
  parseLoginCmsResponse,
  taVigente,
  type WsaaTa,
} from '../emitir-factura/wsfe-core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Vigencia del cache: un dato encontrado se reusa 24 h (la condición IVA puede cambiar, pero no de un día para
// otro); un "no existe" solo 1 h, por si el CUIT se acaba de dar de alta.
const TTL_OK_MS = 24 * 60 * 60 * 1000
const TTL_NO_EXISTE_MS = 60 * 60 * 1000
const TIMEOUT_MS = 15_000

// deno-lint-ignore no-explicit-any
type Admin = any

class ConsultaError extends Error {}

async function descargar(admin: Admin, path: string): Promise<string> {
  const { data, error } = await admin.storage.from('certificados-afip').download(path)
  if (error || !data) throw new ConsultaError(`No se encontró ${path} en el bucket de certificados.`)
  return await data.text()
}

async function obtenerTa(admin: Admin, cuit: string, env: 'homologacion' | 'produccion', certPath: string, keyPath: string): Promise<WsaaTa> {
  const leer = async (): Promise<WsaaTa | null> => {
    const { data } = await admin.from('afip_wsaa_ta')
      .select('token, sign, expiration_time')
      .eq('cuit', Number(cuit)).eq('service', PADRON_SERVICE).eq('environment', env)
      .maybeSingle()
    return data ? { token: data.token, sign: data.sign, expirationTime: data.expiration_time } : null
  }

  const cached = await leer()
  if (cached && taVigente(cached.expirationTime)) return cached

  const [certPem, keyPem] = await Promise.all([descargar(admin, certPath), descargar(admin, keyPath)])
  const cms = signTra(forge, buildTRA(PADRON_SERVICE), certPem, keyPem)
  const resp = await fetch(WSAA_URL[env], {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
    body: buildLoginCmsEnvelope(cms),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const xml = await resp.text()
  try {
    const ta = parseLoginCmsResponse(xml)
    const { error } = await admin.from('afip_wsaa_ta').upsert({
      cuit: Number(cuit), service: PADRON_SERVICE, environment: env,
      token: ta.token, sign: ta.sign, expiration_time: ta.expirationTime,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cuit,service,environment' })
    if (error) console.warn('[consultar-cuit] no se pudo cachear el TA:', error.message)
    return ta
  } catch (e) {
    if (e instanceof WsaaError && e.alreadyAuthenticated) {
      // Otra instancia pudo haberlo pedido recién: se relee el cache antes de rendirse.
      await new Promise((r) => setTimeout(r, 1500))
      const retry = await leer()
      if (retry && taVigente(retry.expirationTime)) return retry
      throw new ConsultaError('ARCA ya emitió un ticket de acceso para este certificado que no está en el cache (vence solo, máx. 12 h).')
    }
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Sesión: usuario activo de un negocio ─────────────────────────────────────
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'No autorizado' }, 401)
  const { data: { user } } = await admin.auth.getUser(jwt)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const { data: perfil } = await admin.from('users').select('tenant_id, activo').eq('id', user.id).maybeSingle()
  // `activo` es NULLABLE: NULL = activo (criterio de la mig 433).
  if (!perfil?.tenant_id || perfil.activo === false) return json({ error: 'No autorizado' }, 403)

  const body = await req.json().catch(() => ({}))
  const cuit = normalizarCuit(body?.cuit)
  if (!cuitValido(cuit)) return json({ error: 'CUIT inválido' }, 400)

  const produccion = Deno.env.get('ARCA_PADRON_PRODUCCION') === 'true' && Deno.env.get('AFIP_FORCE_HOMOLOGACION') !== 'true'
  const env = produccion ? 'produccion' : 'homologacion'

  // ── Cache (no consume cupo: no toca ARCA) ────────────────────────────────────
  const { data: hit } = await admin.from('padron_arca_cache')
    .select('resultado, consultado_at').eq('cuit', cuit).eq('environment', env).maybeSingle()
  if (hit) {
    const r = hit.resultado as ResultadoPadron
    const edad = Date.now() - Date.parse(hit.consultado_at)
    const ttl = r.ok ? TTL_OK_MS : TTL_NO_EXISTE_MS
    if (edad < ttl) return json({ ...r, fuente: 'cache', ambiente: env, consultado_at: hit.consultado_at })
  }

  // ── Rate limit: por usuario (ráfaga) y por negocio (día) ────────────────────
  const rlUser = await consumirRateLimit(admin, 'consultar-cuit:user', user.id, 30, 60)
  if (!rlUser.permitido) return respuesta429(rlUser, 'Demasiadas consultas seguidas. Esperá un minuto.', corsHeaders)
  const rlTenant = await consumirRateLimit(admin, 'consultar-cuit:tenant', perfil.tenant_id, 500, 86_400)
  if (!rlTenant.permitido) return respuesta429(rlTenant, 'Se alcanzó el máximo diario de consultas a ARCA del negocio.', corsHeaders)
  // Tope de toda la plataforma: las consultas salen con la identidad del certificado de Genesis360.
  const rlGlobal = await consumirRateLimit(admin, 'consultar-cuit:global', 'plataforma', 5_000, 86_400)
  if (!rlGlobal.permitido) return respuesta429(rlGlobal, 'El servicio de consulta a ARCA está saturado. Probá más tarde.', corsHeaders)

  // ── ARCA ─────────────────────────────────────────────────────────────────────
  const cuitPlataforma = normalizarCuit(Deno.env.get('ARCA_PADRON_CUIT') ?? '20422374168')
  const certPath = Deno.env.get('ARCA_PADRON_CERT_PATH') ?? `plataforma/${cuitPlataforma}/${env}.crt`
  const keyPath = Deno.env.get('ARCA_PADRON_KEY_PATH') ?? ''

  const consultarArca = async (): Promise<ResultadoPadron> => {
    const ta = await obtenerTa(admin, cuitPlataforma, env, certPath, keyPath)
    const resp = await fetch(PADRON_URL[env], {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
      body: buildGetPersonaV2Envelope(ta.token, ta.sign, cuitPlataforma, cuit),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return parseGetPersonaV2Response(await resp.text(), cuit)
  }

  let resultado: ResultadoPadron
  try {
    if (!keyPath) throw new ConsultaError('Falta el secret ARCA_PADRON_KEY_PATH.')
    resultado = await consultarArca()
    // Un TA que figura vigente en el cache pero ARCA ya no acepta (revocado, cert renovado): se descarta y se
    // pide uno nuevo UNA vez. Sin esto, todas las consultas fallarían hasta que el TA venza solo (≤ 12 h).
    if (!resultado.ok && resultado.motivo === 'error_arca' && /token|sign|autoriz|expir/i.test(resultado.detalle ?? '')) {
      console.warn('[consultar-cuit] ARCA rechazó el TA cacheado, se renueva:', resultado.detalle)
      await admin.from('afip_wsaa_ta').delete()
        .eq('cuit', Number(cuitPlataforma)).eq('service', PADRON_SERVICE).eq('environment', env)
      resultado = await consultarArca()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[consultar-cuit] falla consultando ARCA:', msg)
    // El detalle técnico queda en el log; al usuario, un mensaje accionable.
    return json({ ok: false, motivo: 'error_arca', mensaje: 'No se pudo consultar ARCA en este momento. Podés cargar los datos a mano.', ambiente: env })
  }

  // Un error de ARCA no se cachea (puede ser transitorio); el resto sí.
  if (resultado.ok || resultado.motivo === 'no_existe') {
    const { error } = await admin.from('padron_arca_cache').upsert(
      { cuit, environment: env, resultado, consultado_at: new Date().toISOString() },
      { onConflict: 'cuit,environment' },
    )
    if (error) console.warn('[consultar-cuit] no se pudo cachear la respuesta:', error.message)
  } else {
    console.error('[consultar-cuit] ARCA devolvió error:', resultado.detalle ?? resultado.mensaje)
  }

  // `detalle` es técnico: queda en el log, no viaja al navegador.
  const { detalle: _detalle, ...publico } = resultado as ResultadoPadron & { detalle?: string }
  return json({ ...publico, fuente: 'arca', ambiente: env })
})
