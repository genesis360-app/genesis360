import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ─── "Avisé que ya pagué" (transferencia directa a la cuenta de Fede) ─────────────────────
// Plan aprobado 2026-07-08. NO extiende el acceso por sí solo (fail-closed: nadie se
// auto-activa) — solo crea un ticket en la cola de soporte que genesis360-admin ya tiene
// (SupportPage.tsx), para que el staff verifique la transferencia y recién ahí registre el
// pago vía admin-api `billing.manual_record_payment` (que sí extiende el acceso).
// support_tickets.creado_por es nullable (FK ON DELETE SET NULL) — no hace falta un agente.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'No autorizado' }, 401)
    const { data: userRow } = await userClient.from('users')
      .select('tenant_id, nombre_display, rol').eq('id', user.id).single()
    const tenantId = userRow?.tenant_id
    if (!tenantId) return json({ error: 'Tenant no encontrado' }, 400)

    const body = await req.json().catch(() => ({}))
    const referencia = String(body?.referencia ?? '').trim().slice(0, 500)
    const monto = body?.monto ? Number(body.monto) : null
    const fecha = body?.fecha ? String(body.fecha).slice(0, 20) : null

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { data: tenant } = await admin.from('tenants')
      .select('billing_mode, nombre').eq('id', tenantId).single()
    if (tenant?.billing_mode !== 'manual') {
      return json({ error: 'Tu cuenta no está en modo de pago manual.' }, 400)
    }

    const { data: ticket, error: tErr } = await admin.from('support_tickets').insert({
      tenant_id: tenantId,
      asunto: 'Aviso de pago manual — verificar transferencia',
      prioridad: 'alta',
      canal: 'in_app',
      estado: 'abierto',
      creado_por: null, // no es un agente — lo reporta el propio cliente
    }).select('id').single()
    if (tErr || !ticket) {
      console.error('billing-manual-avisar-pago: no se pudo crear el ticket', tErr)
      return json({ error: 'No se pudo registrar el aviso. Reintentá o escribinos por otro medio.' }, 500)
    }

    const cuerpo = [
      `${userRow?.nombre_display ?? 'El dueño'} (${tenant?.nombre ?? tenantId}) avisó que ya transfirió el pago mensual.`,
      monto ? `Monto informado: $${monto.toLocaleString('es-AR')}.` : null,
      fecha ? `Fecha informada: ${fecha}.` : null,
      referencia ? `Referencia: ${referencia}` : null,
      '\nVerificar en la cuenta y registrar el pago desde Billing → Pagos manuales para extender el acceso.',
    ].filter(Boolean).join('\n')

    await admin.from('support_messages').insert({
      ticket_id: ticket.id, autor_tipo: 'cliente', autor_id: user.id, cuerpo,
    })

    console.log(`billing-manual-avisar-pago: ticket ${ticket.id} creado para tenant ${tenantId}`)
    return json({ ok: true, ticket_id: ticket.id })
  } catch (e) {
    console.error('billing-manual-avisar-pago error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
