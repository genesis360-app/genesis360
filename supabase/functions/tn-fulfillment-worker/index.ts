import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Worker que procesa jobs `sync_fulfillment`: avisa a TiendaNube cuando G360 despacha/entrega
// un pedido (Fase C del roadmap de integraciones). Encolado por el trigger
// trg_tn_fulfillment_sync (migration 338) al cambiar envios.estado.
//
// Mapeo envios.estado → TN Fulfillment Order status y el endpoint PATCH confirmados contra la
// API real (tiendanube.github.io/api-documentation/resources/fulfillment-order) y verificados
// con un pedido de test real de la tienda conectada en DEV (orden 1955532685, fulfillment
// 01KQ5Q7G3AMZEVRXXDTN3JRG8H): GET .../orders/{id} trae fulfillments[0] = el fulfillment_order id
// (string ULID, no numérico) — no hace falta el endpoint de listado de fulfillment-orders.

const TN_API_BASE   = 'https://api.tiendanube.com/v1'
const TN_USER_AGENT = 'Genesis360 (gaston.otranto@gmail.com)'
const BATCH_SIZE     = 50

const ESTADO_A_TN: Record<string, string> = {
  despachado: 'DISPATCHED',
  entregado:  'DELIVERED',
}

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
    .eq('tipo', 'sync_fulfillment')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (jobsErr) return new Response('Error reading queue', { status: 500, headers: corsHeaders })
  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let done = 0, failed = 0, retrying = 0

  for (const job of jobs) {
    await supabase.from('integration_job_queue').update({ status: 'processing' }).eq('id', job.id)

    const { tn_order_id, estado_envio, tracking_number } = job.payload as {
      tn_order_id: number; estado_envio: string; tracking_number?: string | null
    }
    const tnStatus = ESTADO_A_TN[estado_envio]

    try {
      if (!tnStatus) {
        await markFailed(supabase, job.id, `Estado de envío sin mapeo TN: ${estado_envio}`)
        failed++
        continue
      }

      const { data: cred } = await supabase
        .from('tiendanube_credentials')
        .select('store_id, access_token')
        .eq('tenant_id', job.tenant_id)
        .eq('conectado', true)
        .maybeSingle()

      if (!cred) { await markFailed(supabase, job.id, 'Sin credenciales TN para este tenant'); failed++; continue }

      // Resolver el fulfillment_order_id de la orden — viene en order.fulfillments[0].
      const orderRes = await fetch(`${TN_API_BASE}/${cred.store_id}/orders/${tn_order_id}`, {
        headers: { 'Authentication': `bearer ${cred.access_token}`, 'User-Agent': TN_USER_AGENT },
      })
      if (!orderRes.ok) {
        const err = await orderRes.text()
        await markRetry(supabase, job, `GET order: ${err}`)
        retrying++
        continue
      }
      const order = await orderRes.json()
      const fulfillmentId = order.fulfillments?.[0]
      if (!fulfillmentId) {
        await markFailed(supabase, job.id, 'Orden sin fulfillment_order asociado')
        failed++
        continue
      }

      const body: Record<string, unknown> = { status: tnStatus }
      if (tracking_number) body.tracking_info = { code: tracking_number }

      const patchRes = await fetch(
        `${TN_API_BASE}/${cred.store_id}/orders/${tn_order_id}/fulfillment-orders/${fulfillmentId}`,
        {
          method: 'PATCH',
          headers: {
            'Authentication': `bearer ${cred.access_token}`,
            'User-Agent':     TN_USER_AGENT,
            'Content-Type':   'application/json',
          },
          body: JSON.stringify(body),
        },
      )

      if (!patchRes.ok) {
        const err = await patchRes.text()
        await markRetry(supabase, job, `PATCH fulfillment-order: ${err}`)
        retrying++
        continue
      }

      await supabase.from('integration_job_queue').update({ status: 'done' }).eq('id', job.id)
      console.log(`TN fulfillment sync OK: orden ${tn_order_id} → ${tnStatus} (tenant ${job.tenant_id})`)
      done++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await markRetry(supabase, job, msg)
      retrying++
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: jobs.length, done, retrying, failed }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

async function markFailed(sb: ReturnType<typeof createClient>, id: string, error: string) {
  await sb.from('integration_job_queue').update({ status: 'failed', error_last: error }).eq('id', id)
}

async function markRetry(sb: ReturnType<typeof createClient>, job: any, error: string) {
  const retries = Number(job.retries ?? 0) + 1
  if (retries >= Number(job.max_retries ?? 5)) {
    await sb.from('integration_job_queue').update({ status: 'failed', retries, error_last: error }).eq('id', job.id)
  } else {
    const delayMs = Math.pow(2, retries - 1) * 60 * 1000
    await sb.from('integration_job_queue').update({
      status: 'pending', retries, error_last: error,
      next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
    }).eq('id', job.id)
  }
}
