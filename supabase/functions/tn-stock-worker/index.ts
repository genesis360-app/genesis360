import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const TN_API_BASE   = 'https://api.tiendanube.com/v1'
const TN_USER_AGENT = 'Genesis360 (gaston.otranto@gmail.com)'
const BATCH_SIZE    = 200   // aumentado de 50 → 200
const CONCURRENCY   = 20    // llamadas HTTP a TN en paralelo

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: jobs, error: jobsErr } = await supabase
    .from('integration_job_queue')
    .select('*')
    .eq('integracion', 'TiendaNube')
    .eq('tipo', 'sync_stock')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (jobsErr) {
    console.error('Error leyendo jobs:', jobsErr.message)
    return new Response('Error reading queue', { status: 500, headers: corsHeaders })
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Pre-fetch datos por tenant (1 query por tenant en lugar de 1 por job) ──
  const uniqueTenants: string[] = Array.from(new Set<string>(jobs.map((j: any) => String(j.tenant_id))))

  // Credenciales TN por tenant
  const credsMap = new Map<string, { access_token: string; store_id: number }>()
  // IDs de estados disponibles para TN por tenant
  const estadosMap = new Map<string, string[]>()

  await Promise.all(uniqueTenants.map(async (tenantId) => {
    const [credsRes, estadosRes] = await Promise.all([
      supabase.from('tiendanube_credentials')
        .select('access_token, store_id')
        .eq('tenant_id', tenantId)
        .eq('conectado', true)
        .maybeSingle(),
      supabase.from('estados_inventario')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('es_disponible_tn', true),
    ])
    if (credsRes.data) credsMap.set(tenantId, credsRes.data)
    estadosMap.set(tenantId, (estadosRes.data ?? []).map((e: any) => e.id))
  }))

  // Marcar todos como 'processing' en un solo UPDATE
  const jobIds = jobs.map((j: any) => j.id)
  await supabase
    .from('integration_job_queue')
    .update({ status: 'processing' })
    .in('id', jobIds)

  // ── Procesar jobs en paralelo (chunks de CONCURRENCY) ──────────────────────
  let done = 0, failed = 0, retrying = 0

  async function processJob(job: any): Promise<void> {
    const { producto_id, tn_product_id, tn_variant_id } = job.payload as {
      producto_id: string; tn_product_id: number; tn_variant_id: number
    }

    const cred = credsMap.get(job.tenant_id)
    if (!cred) {
      await markFailed(supabase, job.id, 'Sin credencial TN para este tenant')
      failed++
      return
    }

    try {
      const etIds = estadosMap.get(job.tenant_id) ?? []

      let lq = supabase.from('inventario_lineas')
        .select('cantidad, cantidad_reservada, ubicaciones(disponible_tn)')
        .eq('tenant_id', job.tenant_id)
        .eq('producto_id', producto_id)
        .eq('activo', true)
      if (etIds.length > 0) lq = lq.in('estado_id', etIds)
      const { data: lineasRaw } = await lq

      const lineas = (lineasRaw ?? []).filter(
        (l: any) => !l.ubicaciones || l.ubicaciones.disponible_tn !== false
      )
      const stockDisponible = Math.max(0, Math.floor(
        lineas.reduce((acc: number, l: any) =>
          acc + (Number(l.cantidad) - Number(l.cantidad_reservada ?? 0)), 0)
      ))

      const tnRes = await fetch(
        `${TN_API_BASE}/${cred.store_id}/products/${tn_product_id}/variants/${tn_variant_id}`,
        {
          method: 'PUT',
          headers: {
            'Authentication': `bearer ${cred.access_token}`,
            'User-Agent':     TN_USER_AGENT,
            'Content-Type':   'application/json',
          },
          body: JSON.stringify({ stock: stockDisponible }),
        },
      )

      if (tnRes.ok) {
        await Promise.all([
          supabase.from('inventario_tn_map')
            .update({ ultimo_sync_at: new Date().toISOString() })
            .eq('tenant_id', job.tenant_id)
            .eq('producto_id', producto_id)
            .eq('tn_product_id', tn_product_id)
            .eq('tn_variant_id', tn_variant_id),
          supabase.from('integration_job_queue')
            .update({ status: 'done' })
            .eq('id', job.id),
        ])
        done++
      } else {
        const errText = await tnRes.text()
        await markRetry(supabase, job, errText)
        retrying++
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await markRetry(supabase, job, msg)
      retrying++
    }
  }

  // Procesar en chunks paralelos
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const chunk = jobs.slice(i, i + CONCURRENCY)
    await Promise.all(chunk.map((job: any) => processJob(job)))
  }

  console.log(`Worker TN — done: ${done}, retrying: ${retrying}, failed: ${failed}`)

  return new Response(
    JSON.stringify({ ok: true, processed: jobs.length, done, retrying, failed }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

async function markFailed(supabase: ReturnType<typeof createClient>, jobId: string, error: string) {
  await supabase
    .from('integration_job_queue')
    .update({ status: 'failed', error_last: error })
    .eq('id', jobId)
}

async function markRetry(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
  error: string,
) {
  const retries = Number(job.retries ?? 0) + 1
  const maxRetries = Number(job.max_retries ?? 5)
  if (retries >= maxRetries) {
    await supabase.from('integration_job_queue')
      .update({ status: 'failed', retries, error_last: error })
      .eq('id', job.id)
  } else {
    const delayMs = Math.pow(2, retries - 1) * 60 * 1000
    await supabase.from('integration_job_queue')
      .update({ status: 'pending', retries, error_last: error, next_attempt_at: new Date(Date.now() + delayMs).toISOString() })
      .eq('id', job.id)
  }
}
