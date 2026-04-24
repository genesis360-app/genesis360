import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Worker que procesa jobs de sync_stock pendientes para TiendaNube.
// Llamado por GitHub Actions cron cada 5 minutos.
//
// Flujo por job:
//   1. Marcar como 'processing'
//   2. Calcular stock disponible actual en Genesis360
//   3. Obtener credencial TN del tenant
//   4. PUT /v1/{store_id}/products/{tn_product_id}/variants/{tn_variant_id}
//   5. Marcar 'done' o reintentar con backoff exponencial (max 5 reintentos)

const TN_API_BASE   = 'https://api.tiendanube.com/v1'
const TN_USER_AGENT = 'Genesis360 (gaston.otranto@gmail.com)'
const BATCH_SIZE    = 50

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Leer jobs pendientes listos para procesar
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
    return new Response('Error reading queue', { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let done = 0, failed = 0, retrying = 0

  for (const job of jobs) {
    // Marcar como procesando para evitar que otro worker lo tome
    await supabase
      .from('integration_job_queue')
      .update({ status: 'processing' })
      .eq('id', job.id)

    const { producto_id, tn_product_id, tn_variant_id } = job.payload as {
      producto_id: string
      tn_product_id: number
      tn_variant_id: number
    }

    try {
      // Calcular stock disponible actual (suma todas las lineas activas del producto)
      const { data: lineas } = await supabase
        .from('inventario_lineas')
        .select('cantidad, cantidad_reservada')
        .eq('tenant_id', job.tenant_id)
        .eq('producto_id', producto_id)
        .eq('activo', true)

      const stockDisponible = Math.max(
        0,
        Math.floor(
          (lineas ?? []).reduce(
            (acc, l) => acc + (Number(l.cantidad) - Number(l.cantidad_reservada ?? 0)),
            0,
          ),
        ),
      )

      // Obtener credencial TN del tenant
      const { data: cred } = await supabase
        .from('tiendanube_credentials')
        .select('access_token, store_id')
        .eq('tenant_id', job.tenant_id)
        .eq('conectado', true)
        .maybeSingle()

      if (!cred) {
        await markFailed(supabase, job.id, 'No hay credencial TN conectada para este tenant')
        failed++
        continue
      }

      // PUT stock en TiendaNube
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
        // Actualizar ultimo_sync_at en el mapa
        await supabase
          .from('inventario_tn_map')
          .update({ ultimo_sync_at: new Date().toISOString() })
          .eq('tenant_id', job.tenant_id)
          .eq('producto_id', producto_id)
          .eq('tn_product_id', tn_product_id)
          .eq('tn_variant_id', tn_variant_id)

        await supabase
          .from('integration_job_queue')
          .update({ status: 'done' })
          .eq('id', job.id)

        console.log(`Stock sync OK: producto ${producto_id} → TN variant ${tn_variant_id} = ${stockDisponible}`)
        done++
      } else {
        const errText = await tnRes.text()
        console.warn(`Error TN API [${tnRes.status}]:`, errText)
        await markRetry(supabase, job, errText)
        retrying++
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('Error procesando job:', msg)
      await markRetry(supabase, job, msg)
      retrying++
    }
  }

  console.log(`Worker completado — done: ${done}, retrying: ${retrying}, failed: ${failed}`)

  return new Response(
    JSON.stringify({ ok: true, processed: jobs.length, done, retrying, failed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
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
    await supabase
      .from('integration_job_queue')
      .update({ status: 'failed', retries, error_last: error })
      .eq('id', job.id)
  } else {
    // Backoff exponencial: 1min, 2min, 4min, 8min, 16min
    const delayMs = Math.pow(2, retries - 1) * 60 * 1000
    const nextAttempt = new Date(Date.now() + delayMs).toISOString()
    await supabase
      .from('integration_job_queue')
      .update({ status: 'pending', retries, error_last: error, next_attempt_at: nextAttempt })
      .eq('id', job.id)
  }
}
