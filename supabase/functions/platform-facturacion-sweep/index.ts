import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Sweep de facturación de cobros RECURRENTES de MP (billing_mode='auto') ──────────────
// Plan aprobado 2026-07-08 (facturación de Fede). Los webhooks `payment` de MP para una
// suscripción recurrente vienen con `external_reference` VACÍO (mismo gotcha MP-W6 ya
// documentado para la activación) — mp-webhook.ts ni siquiera entra a esa rama
// (`if (payment.status === 'approved' && payment.external_reference)`). En vez de adivinar
// la forma exacta del payload para enganchar un trigger de webhook (arriesgado con plata +
// fiscal), este sweep reconcilia: por cada tenant activo en modo auto, busca sus pagos
// aprobados reales en MP (`authorized_payments/search`, mismo endpoint ya usado en
// mp-batch-sweep/cancel-suscripcion) y factura los que todavía no estén en
// `platform_facturas` (idempotente por `payment_ref`, vía el claim de
// `emitir-factura-plataforma`). Corre en el mismo cron horario que mp-reconciliacion.
//
// Cubre TANTO la primera cuota de una suscripción nueva COMO cada renovación mensual — no
// hace falta un trigger de webhook separado para "se activó" vs "se renovó", este sweep
// encuentra todos los pagos aprobados igual.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MP = 'https://api.mercadopago.com'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)
    const H = { Authorization: `Bearer ${mpToken}` }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // Si todavía no hay ningún biller configurado (Fede sin AfipSDK token aún), no tiene
    // sentido ni siquiera consultar MP — evita ruido en los logs mientras se termina el alta.
    const { data: biller } = await admin.from('platform_billers')
      .select('id').eq('activo', true).limit(1).maybeSingle()
    if (!biller) return json({ ok: true, skip: 'sin_biller', revisados: 0, facturados: 0 })

    const { data: tenants } = await admin.from('tenants')
      .select('id, nombre, mp_subscription_id')
      .eq('billing_mode', 'auto').eq('subscription_status', 'active')
      .not('mp_subscription_id', 'is', null)

    let revisados = 0
    let facturados = 0
    let errores = 0

    for (const t of tenants ?? []) {
      const preId = String(t.mp_subscription_id)
      let results: any[] = []
      try {
        const r = await fetch(
          `${MP}/authorized_payments/search?preapproval_id=${encodeURIComponent(preId)}&limit=50`,
          { headers: H },
        )
        if (!r.ok) { console.warn(`platform-facturacion-sweep: search ${t.id} → ${r.status}`); continue }
        const s = await r.json()
        results = s?.results ?? s?.elements ?? []
      } catch (e) {
        console.error(`platform-facturacion-sweep: error consultando MP para tenant ${t.id}`, e)
        errores++
        continue
      }

      for (const inv of results) {
        const pago = inv?.payment
        if (!pago || pago.status !== 'approved') continue
        revisados++
        const paymentRef = String(pago.id)
        const monto = Number(pago.transaction_amount ?? inv?.transaction_amount ?? 0)
        if (!(monto > 0)) continue

        const periodo = pago.date_approved
          ? new Date(pago.date_approved).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
          : 'período no identificado'

        const res = await fetch(`${supabaseUrl}/functions/v1/emitir-factura-plataforma`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monto, payment_ref: paymentRef, origen_pago: 'mp_recurrente',
            tenant_origen_id: t.id,
            concepto: `Suscripción Genesis360 — ${t.nombre ?? t.id} — ${periodo}`,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data?.facturado) {
          facturados++
          console.log(`platform-facturacion-sweep: facturado pago ${paymentRef} tenant ${t.id} ($${monto})`)
        } else if (!res.ok) {
          errores++
          console.error(`platform-facturacion-sweep: emitir-factura-plataforma falló para pago ${paymentRef}`, data)
        }
        // data.facturado === false con reason 'ya_procesado' es el caso normal (ya facturado
        // en una corrida anterior) — no cuenta como error, no se loguea.
      }
    }

    console.log(`platform-facturacion-sweep: ${revisados} pagos revisados, ${facturados} facturados, ${errores} errores`)
    return json({ ok: true, revisados, facturados, errores, ran_at: new Date().toISOString() })
  } catch (e) {
    console.error('platform-facturacion-sweep error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
