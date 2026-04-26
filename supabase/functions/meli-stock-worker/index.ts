import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Worker que procesa jobs de sync_stock y sync_precio para MercadoLibre.
// Llamado por GitHub Actions cron cada 5 minutos.

const MELI_API  = 'https://api.mercadolibre.com'
const BATCH_SIZE = 50

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
    .eq('integracion', 'MercadoLibre')
    .in('tipo', ['sync_stock', 'sync_precio'])
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (jobsErr) return new Response('Error reading queue', { status: 500 })
  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), { status: 200 })
  }

  let done = 0, failed = 0, retrying = 0

  for (const job of jobs) {
    await supabase.from('integration_job_queue').update({ status: 'processing' }).eq('id', job.id)

    const { producto_id, meli_item_id, meli_variation_id } = job.payload as {
      producto_id: string; meli_item_id: string; meli_variation_id?: number
    }

    try {
      // Obtener credenciales del tenant
      const { data: cred } = await supabase
        .from('meli_credentials')
        .select('seller_id, access_token, refresh_token, expires_at')
        .eq('tenant_id', job.tenant_id)
        .eq('conectado', true)
        .maybeSingle()

      if (!cred) { await markFailed(supabase, job.id, 'Sin credenciales ML'); failed++; continue }

      const token = await getValidToken(supabase, cred)

      if (job.tipo === 'sync_stock') {
        // Calcular stock disponible para MELI:
        // - estados con es_disponible_meli = true
        // - ubicaciones con disponible_meli = true (o sin ubicación)
        const { data: estadosMeli } = await supabase
          .from('estados_inventario').select('id')
          .eq('tenant_id', job.tenant_id).eq('es_disponible_meli', true)
        const emIds = (estadosMeli ?? []).map((e: any) => e.id)

        let lq = supabase.from('inventario_lineas')
          .select('cantidad, cantidad_reservada, ubicaciones(disponible_meli)')
          .eq('tenant_id', job.tenant_id).eq('producto_id', producto_id).eq('activo', true)
        if (emIds.length > 0) lq = lq.in('estado_id', emIds)
        const { data: lineasRaw } = await lq
        // Excluir líneas cuya ubicación tenga disponible_meli = false
        const lineas = (lineasRaw ?? []).filter(
          (l: any) => !l.ubicaciones || l.ubicaciones.disponible_meli !== false
        )

        const stock = Math.max(0, Math.floor(
          (lineas ?? []).reduce((acc: number, l: any) =>
            acc + (Number(l.cantidad) - Number(l.cantidad_reservada ?? 0)), 0)
        ))

        const body: Record<string, unknown> = { available_quantity: stock }
        const endpoint = meli_variation_id
          ? `${MELI_API}/items/${meli_item_id}/variations/${meli_variation_id}`
          : `${MELI_API}/items/${meli_item_id}`

        const res = await fetch(endpoint, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const err = await res.text(); await markRetry(supabase, job, err); retrying++; continue
        }
        console.log(`ML stock sync OK: ${meli_item_id} = ${stock}`)
      }

      if (job.tipo === 'sync_precio') {
        const { data: prod } = await supabase
          .from('productos').select('precio_venta')
          .eq('id', producto_id).maybeSingle()
        if (!prod) { await markFailed(supabase, job.id, 'Producto no encontrado'); failed++; continue }

        const endpoint = meli_variation_id
          ? `${MELI_API}/items/${meli_item_id}/variations/${meli_variation_id}`
          : `${MELI_API}/items/${meli_item_id}`

        const res = await fetch(endpoint, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: prod.precio_venta }),
        })

        if (!res.ok) {
          const err = await res.text(); await markRetry(supabase, job, err); retrying++; continue
        }
        console.log(`ML precio sync OK: ${meli_item_id} = $${prod.precio_venta}`)
      }

      // Actualizar ultimo_sync_at
      await supabase.from('inventario_meli_map')
        .update({ ultimo_sync_at: new Date().toISOString() })
        .eq('tenant_id', job.tenant_id).eq('meli_item_id', meli_item_id)

      await supabase.from('integration_job_queue').update({ status: 'done' }).eq('id', job.id)
      done++

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await markRetry(supabase, job, msg); retrying++
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: jobs.length, done, retrying, failed }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

async function getValidToken(supabase: ReturnType<typeof createClient>, cred: any): Promise<string> {
  if (new Date(cred.expires_at).getTime() - Date.now() > 10 * 60 * 1000) return cred.access_token
  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: Deno.env.get('MELI_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('MELI_CLIENT_SECRET') ?? '',
      refresh_token: cred.refresh_token,
    }),
  })
  if (!res.ok) return cred.access_token
  const t = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  await supabase.from('meli_credentials').update({
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq('seller_id', cred.seller_id)
  return t.access_token
}

async function markFailed(sb: ReturnType<typeof createClient>, id: string, error: string) {
  await sb.from('integration_job_queue').update({ status: 'failed', error_last: error }).eq('id', id)
}

async function markRetry(sb: ReturnType<typeof createClient>, job: any, error: string) {
  const retries = Number(job.retries ?? 0) + 1
  if (retries >= Number(job.max_retries ?? 5)) {
    await sb.from('integration_job_queue').update({ status: 'failed', retries, error_last: error }).eq('id', job.id)
  } else {
    const delay = Math.pow(2, retries - 1) * 60 * 1000
    await sb.from('integration_job_queue').update({
      status: 'pending', retries, error_last: error,
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
    }).eq('id', job.id)
  }
}
