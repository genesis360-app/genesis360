import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Sweep de upgrades de plan PROGRAMADOS (E2, Fase 2 del batch — mig 260) ─────────────
// Lo dispara GitHub Actions cada hora (mismo workflow que mp-reconciliacion; pg_cron no
// está habilitado). Espejo puro testeado: src/lib/mpAddonBatch.ts (decidirSweepProgramado
// + decidirConfirmacionCobro) — mantener EN SYNC.
//
// Ciclo de vida de un change E2 (spec GO 2026-07-07):
//   'programado'      → en la VENTANA previa al próximo cobro (36h) el sweep hace el PUT
//                       del recurrente nuevo en MP para que ESE cobro ya salga por el plan
//                       nuevo → 'esperando_cobro'. La fecha de cobro NUNCA cambia.
//   'esperando_cobro' → cuando MP confirma el cobro APROBADO por el monto nuevo
//                       (authorized_payments del preapproval) → fn_aplicar_addon_batch
//                       (packs + plan_tier) → 'aplicado'. Si el preapproval muere o pasa
//                       el timeout (7 días) sin cobro → 'fallido' + email a soporte.
//
// 🛑 REGLA #0 (fail-closed): el tier NUNCA se habilita sin cobro confirmado del monto
// nuevo. Si el PUT falla se reintenta a la hora siguiente (sigue 'programado'). Sin
// parámetros de entrada: correrlo de más es inocuo (idempotente).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MP = 'https://api.mercadopago.com'
const VENTANA_HORAS = 36   // espejo SWEEP_VENTANA_HORAS
const TIMEOUT_DIAS = 7     // espejo SWEEP_TIMEOUT_DIAS

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function alertarSoporte(subject: string, html: string) {
  const rk = Deno.env.get('RESEND_API_KEY')
  if (!rk) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${rk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Genesis360 <noreply@genesis360.pro>', to: ['soporte@genesis360.pro'],
      subject, html,
    }),
  }).catch(() => {})
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)
    const H = { Authorization: `Bearer ${mpToken}` }
    const now = Date.now()

    const marcarFallido = async (changeId: string, tenantId: string, detalle: string) => {
      console.error(`mp-batch-sweep: change ${changeId} FALLIDO: ${detalle}`)
      await admin.from('addon_batch_changes')
        .update({ estado: 'fallido', error_detalle: detalle }).eq('id', changeId)
      await alertarSoporte(
        `🛑 Upgrade de plan programado FALLIDO — tenant ${tenantId}`,
        `<p>El cambio programado <b>${changeId}</b> (tenant ${tenantId}) quedó fallido: <b>${detalle}</b>.</p><p>Revisar el preapproval del tenant en MP y la tabla addon_batch_changes.</p>`,
      )
    }

    const resumen = { puts: 0, aplicados: 0, fallidos: 0, esperando: 0 }

    // ── 1) 'programado' → PUT del monto nuevo dentro de la ventana previa al cobro ──
    const { data: programados } = await admin.from('addon_batch_changes')
      .select('id, tenant_id, programado_para, monto_recurrente_nuevo')
      .eq('estado', 'programado')
    for (const ch of programados ?? []) {
      const objetivo = new Date(ch.programado_para).getTime()
      if (Number.isNaN(objetivo) || now > objetivo + TIMEOUT_DIAS * 86400_000) {
        await marcarFallido(ch.id, ch.tenant_id, 'programado vencido sin procesar (fecha inválida o sweep caído)')
        resumen.fallidos++
        continue
      }
      if (now < objetivo - VENTANA_HORAS * 3600_000) { resumen.esperando++; continue }

      const { data: t } = await admin.from('tenants')
        .select('mp_subscription_id, subscription_status').eq('id', ch.tenant_id).maybeSingle()
      if (!t?.mp_subscription_id || t.subscription_status !== 'active') {
        await marcarFallido(ch.id, ch.tenant_id, `tenant sin suscripción activa (status ${t?.subscription_status ?? 'sin fila'})`)
        resumen.fallidos++
        continue
      }
      const putRes = await fetch(`${MP}/preapproval/${t.mp_subscription_id}`, {
        method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_recurring: { transaction_amount: Number(ch.monto_recurrente_nuevo), currency_id: 'ARS' } }),
      })
      if (!putRes.ok) {
        // Transitorio: sigue 'programado' → reintenta a la hora (el timeout de arriba corta)
        console.warn(`mp-batch-sweep: PUT ${putRes.status} para change ${ch.id} — reintento en la próxima corrida`)
        resumen.esperando++
        continue
      }
      await admin.from('addon_batch_changes').update({ estado: 'esperando_cobro' }).eq('id', ch.id)
      console.log(`mp-batch-sweep: change ${ch.id} → esperando_cobro (recurrente ${ch.monto_recurrente_nuevo})`)
      resumen.puts++
    }

    // ── 2) 'esperando_cobro' → habilitar el tier al confirmarse el cobro aprobado ──
    const { data: esperando } = await admin.from('addon_batch_changes')
      .select('id, tenant_id, programado_para, monto_recurrente_nuevo')
      .eq('estado', 'esperando_cobro')
    for (const ch of esperando ?? []) {
      const { data: t } = await admin.from('tenants')
        .select('mp_subscription_id').eq('id', ch.tenant_id).maybeSingle()
      const preId = t?.mp_subscription_id
      if (!preId) {
        await marcarFallido(ch.id, ch.tenant_id, 'tenant sin mp_subscription_id (esperando cobro)')
        resumen.fallidos++
        continue
      }
      const getRes = await fetch(`${MP}/preapproval/${preId}`, { headers: H })
      const pre = getRes.ok ? await getRes.json() : null
      const preStatus = String(pre?.status ?? 'desconocido')

      // Cobro del ciclo: buscar en las cuotas del preapproval un pago APROBADO por el
      // monto NUEVO desde poco antes de la fecha programada (defensivo con el shape de MP).
      let cobroAprobado: number | null = null
      const searchRes = await fetch(
        `${MP}/authorized_payments/search?preapproval_id=${encodeURIComponent(preId)}&limit=50`, { headers: H })
      if (searchRes.ok) {
        const s = await searchRes.json()
        const results = s?.results ?? s?.elements ?? []
        const desde = new Date(ch.programado_para).getTime() - 48 * 3600_000
        for (const r of results) {
          const fecha = new Date(r?.debit_date ?? r?.date_created ?? 0).getTime()
          const aprobado = r?.payment?.status === 'approved'
          const monto = Number(r?.transaction_amount ?? r?.payment?.transaction_amount ?? 0)
          if (aprobado && fecha >= desde && monto > (cobroAprobado ?? 0)) cobroAprobado = monto
        }
      }

      const montoEsperado = Number(ch.monto_recurrente_nuevo)
      if (cobroAprobado !== null && cobroAprobado >= montoEsperado) {
        const { data: aplicado, error: rpcErr } = await admin
          .rpc('fn_aplicar_addon_batch', { p_tenant_id: ch.tenant_id, p_change_id: ch.id })
        if (rpcErr || aplicado !== true) {
          await marcarFallido(ch.id, ch.tenant_id, `cobro confirmado pero fn_aplicar_addon_batch falló: ${rpcErr?.message ?? 'false'}`)
          resumen.fallidos++
        } else {
          console.log(`mp-batch-sweep: change ${ch.id} APLICADO (cobro ${cobroAprobado} confirmado)`)
          resumen.aplicados++
        }
        continue
      }
      if (preStatus === 'cancelled') {
        await marcarFallido(ch.id, ch.tenant_id, 'el preapproval se canceló antes de confirmarse el cobro del monto nuevo')
        resumen.fallidos++
        continue
      }
      const limite = new Date(ch.programado_para).getTime() + TIMEOUT_DIAS * 86400_000
      if (Number.isNaN(limite) || now > limite) {
        await marcarFallido(ch.id, ch.tenant_id, `sin cobro aprobado por $${montoEsperado} a ${TIMEOUT_DIAS} días de la fecha programada (preapproval ${preStatus})`)
        resumen.fallidos++
        continue
      }
      resumen.esperando++ // MP puede estar reintentando el cobro — seguimos esperando
    }

    console.log('mp-batch-sweep:', JSON.stringify(resumen))
    return json({ ok: true, ...resumen, ran_at: new Date().toISOString() })
  } catch (e) {
    console.error('mp-batch-sweep error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
