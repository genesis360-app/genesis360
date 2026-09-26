import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parsearDivisasBna } from '../_shared/bnaDivisas.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// D-1 (mig 439) — captura la cotización DIVISA del Banco Nación y la guarda en `cotizaciones_bna`.
//
// La dispara el workflow diario (`sweeps.yml`, 03:10 AR: a esa hora la página todavía muestra el
// CIERRE del día hábil anterior, con su fecha) y, como respaldo, la app al iniciar sesión (respuesta
// A-2 de GO). Devuelve la cotización VIGENTE = la del día hábil anterior (`fn_cotizacion_bna_vigente`).
//
// Quién puede llamarla: el cron (CRON_SECRET), otra EF (service key) o un usuario logueado de verdad.
// `verify_jwt` solo no alcanza: la ANON key lo satisface y viaja en el bundle.
//
// Si el BNA no responde o cambió el formato, NO se guarda nada y se devuelve la última vigente con
// `captura_ok: false`: la app sigue con la anterior y avisa (A-2). Nunca se inventa una tasa (D5).

const BNA_URL = 'https://www.bna.com.ar/Personas'
// Desde la app, no volver a pedirle al BNA si ya se capturó hace menos de esto (muchos logins por día).
const MIN_ENTRE_CAPTURAS_MS = 30 * 60 * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const esSistema =
    (cronSecret !== '' && (req.headers.get('x-cron-secret') ?? '') === cronSecret) ||
    (serviceKey !== '' && auth.includes(serviceKey))

  if (!esSistema) {
    const token = auth.replace(/^Bearer\s+/i, '')
    const { data, error } = token ? await svc.auth.getUser(token) : { data: null, error: true }
    if (error || !data?.user) return json({ error: 'No autorizado' }, 401)
  }

  let captura_ok = false
  let capturadas = 0
  let error_captura: string | null = null

  // El sistema captura siempre; un usuario solo si la última captura es vieja.
  let capturar = esSistema
  if (!capturar) {
    const { data: ultima } = await svc
      .from('cotizaciones_bna').select('capturada_at').order('capturada_at', { ascending: false }).limit(1)
    const t = ultima?.[0]?.capturada_at ? new Date(ultima[0].capturada_at).getTime() : 0
    capturar = Date.now() - t > MIN_ENTRE_CAPTURAS_MS
  }

  if (capturar) {
    try {
      const res = await fetch(BNA_URL, { headers: { 'User-Agent': 'Genesis360/1.0 (+https://genesis360.pro)' } })
      if (!res.ok) throw new Error(`BNA respondió ${res.status}`)
      const filas = parsearDivisasBna(await res.text())
      const { error } = await svc.from('cotizaciones_bna').upsert(
        filas.map(f => ({ ...f, capturada_at: new Date().toISOString() })),
        { onConflict: 'fecha,moneda' },
      )
      if (error) throw new Error(`guardar: ${error.message}`)
      captura_ok = true
      capturadas = filas.length
    } catch (e) {
      error_captura = e instanceof Error ? e.message : String(e)
      console.error('[cotizacion-bna]', error_captura)
    }
  }

  const { data: vig, error: eVig } = await svc.rpc('fn_cotizacion_bna_vigente', { p_moneda: 'USD' })
  if (eVig) return json({ ok: false, error: eVig.message }, 500)
  const vigente = Array.isArray(vig) ? vig[0] ?? null : vig ?? null

  // El cron tiene que FALLAR si no pudo capturar: si no, el workflow queda verde y nadie se entera.
  if (esSistema && !captura_ok) return json({ ok: false, error: error_captura, vigente }, 502)

  return json({ ok: true, capturo: capturar, captura_ok, capturadas, error_captura, vigente })
})
