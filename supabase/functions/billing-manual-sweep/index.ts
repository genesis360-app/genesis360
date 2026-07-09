import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Sweep de vencimiento de pago MANUAL ──────────────────────────────────────────────────
// Plan aprobado 2026-07-08. Espejo puro testeado: src/lib/facturacionManual.ts
// (decidirSweepManual) — mantener EN SYNC. Corre en el mismo cron horario que
// mp-reconciliacion/mp-batch-sweep/platform-facturacion-sweep.
//
// Recordatorio 5 días y 1 día antes de manual_paid_until (dedupe por
// manual_ultimo_recordatorio_tipo) → a manual_paid_until + 5 días sin pago nuevo,
// subscription_status='inactive' (mismo gate que ya usa SubscriptionGuard/accesoSuscripcion,
// NO se toca ese código — un tenant 'inactive' ya pierde acceso hoy sin cambios).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const RECORDATORIO_DIAS_ANTES = [5, 1] as const
const GRACIA_DIAS = 5

type Decision = 'nada' | `recordatorio_${typeof RECORDATORIO_DIAS_ANTES[number]}d` | 'suspender'

function decidirSweepManual(p: { paidUntil: string | null; ultimoTipo: string | null; now: Date }): Decision {
  if (!p.paidUntil) return 'nada'
  const paidUntil = new Date(p.paidUntil).getTime()
  if (Number.isNaN(paidUntil)) return 'nada'
  const graceEnd = paidUntil + GRACIA_DIAS * 86400_000
  if (p.now.getTime() > graceEnd) return 'suspender'

  // Tier MÁS URGENTE ya alcanzado (espejo exacto de src/lib/facturacionManual.ts — mantener
  // en sync). Cerca del vencimiento se cruzan varios umbrales a la vez; quedarse con el más
  // urgente evita que el recordatorio "lejano" reviva después de mandado el "cercano".
  let tierActual: number | null = null
  for (const dias of RECORDATORIO_DIAS_ANTES) {
    const umbral = paidUntil - dias * 86400_000
    if (p.now.getTime() >= umbral && p.now.getTime() <= paidUntil) {
      if (tierActual === null || dias < tierActual) tierActual = dias
    }
  }
  if (tierActual === null) return 'nada'
  const ultimoDias = Number(p.ultimoTipo?.match(/^recordatorio_(\d+)d$/)?.[1] ?? NaN)
  if (!Number.isNaN(ultimoDias) && ultimoDias <= tierActual) return 'nada'
  return `recordatorio_${tierActual}d` as Decision
}

async function emailDueño(admin: any, tenantId: string, titulo: string, mensaje: string) {
  const { data: owner } = await admin.from('users')
    .select('id').eq('tenant_id', tenantId).eq('rol', 'DUEÑO').limit(1).maybeSingle()
  if (!owner?.id) return
  const { data: au } = await admin.auth.admin.getUserById(owner.id)
  const email = au?.user?.email
  if (!email) return
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'notificacion', to: email, data: { titulo, mensaje, action_url: '/suscripcion' } }),
  }).catch(() => {})
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const now = new Date()

    const { data: tenants } = await admin.from('tenants')
      .select('id, nombre, manual_paid_until, manual_ultimo_recordatorio_tipo')
      .eq('billing_mode', 'manual').eq('subscription_status', 'active')

    const resumen = { recordatorios: 0, suspendidos: 0 }

    for (const t of tenants ?? []) {
      const decision = decidirSweepManual({
        paidUntil: t.manual_paid_until, ultimoTipo: t.manual_ultimo_recordatorio_tipo, now,
      })
      if (decision === 'nada') continue

      if (decision === 'suspender') {
        await admin.from('tenants').update({ subscription_status: 'inactive' }).eq('id', t.id)
        await emailDueño(admin, t.id,
          'Tu cuenta de Genesis360 quedó suspendida por falta de pago',
          `No registramos el pago de este mes y venció el período de gracia. Tu cuenta quedó suspendida — regularizá el pago desde Mi Cuenta para recuperar el acceso.`,
        )
        console.log(`billing-manual-sweep: tenant ${t.id} (${t.nombre}) suspendido por falta de pago`)
        resumen.suspendidos++
        continue
      }

      // Recordatorio (5d o 1d antes)
      const dias = decision === 'recordatorio_5d' ? 5 : 1
      await admin.from('tenants').update({
        manual_ultimo_recordatorio_tipo: decision, manual_ultimo_recordatorio_at: now.toISOString(),
      }).eq('id', t.id)
      const fechaFmt = t.manual_paid_until
        ? new Date(t.manual_paid_until).toLocaleDateString('es-AR')
        : 'próximamente'
      await emailDueño(admin, t.id,
        dias === 1 ? 'Tu pago vence mañana' : `Tu pago vence en ${dias} días`,
        `Tu suscripción a Genesis360 vence el ${fechaFmt}. Pagá desde Mi Cuenta (con tarjeta, o por transferencia avisándonos después) para no perder el acceso.`,
      )
      console.log(`billing-manual-sweep: recordatorio ${decision} enviado a tenant ${t.id}`)
      resumen.recordatorios++
    }

    console.log('billing-manual-sweep:', JSON.stringify(resumen))
    return json({ ok: true, ...resumen, ran_at: now.toISOString() })
  } catch (e) {
    console.error('billing-manual-sweep error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
