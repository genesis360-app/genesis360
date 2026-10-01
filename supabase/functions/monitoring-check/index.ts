import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Resumen diario del EQUIPO de Genesis360 (lo dispara GitHub Actions, 1 vez por día) ────────────────────────────
//
// 🔁 Rehecho el 2026-10-01 (doc "Herramientas internas"). La versión anterior sumaba reservas viejas, stock crítico y
// cajas abiertas de TODOS los negocios juntos — temas de cada negocio, no nuestros, y sin decir de cuál — y salía desde
// el remitente de prueba de Resend. Ahora lista, negocio por negocio, lo que le toca hacer AL EQUIPO:
//   1. Cobros: alertas de Mercado Pago sin revisar y pagos manuales vencidos.
//   2. Facturación trabada: NC de AFIP sin emitir y emisiones que quedaron para conciliar a mano.
//   3. Soporte: consultas que esperan respuesta del equipo hace más de 24 h.
//   4. Pruebas: vencen en 3 días o vencieron en las últimas 24 h.
//   5. Clientes que pagan y no entran hace más de 14 días (riesgo de baja).
// Sin pendientes también se manda (sirve de latido: si un día no llega, algo se cayó).

const ALERT_EMAIL = 'gaston.otranto@gmail.com'
const FROM        = 'Genesis360 <noreply@genesis360.pro>'
const PANEL       = 'https://admin.genesis360.pro'
const DIA         = 86_400_000

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-AR') : '—')

type Item = { negocio: string; detalle: string; tenantId?: string | null }
type Seccion = { titulo: string; items: Item[] }

Deno.serve(async (req) => {
  // GUARD-CRON (auditoría de seguridad 2026-09-20): la dispara GitHub Actions o una EF, nunca un navegador.
  {
    const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const enviado = req.headers.get('x-cron-secret') ?? ''
    const auth = req.headers.get('Authorization') ?? ''
    const autorizado =
      (cronSecret !== '' && enviado === cronSecret) ||
      (serviceKey !== '' && auth.includes(serviceKey))
    if (!autorizado) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
  }

  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const ahora = Date.now()
    const isoHace = (ms: number) => new Date(ahora - ms).toISOString()

    const [alertasMp, manualesVencidos, ncPendientes, locks, tickets, overview] = await Promise.all([
      db.from('mp_billing_alertas').select('tipo, preapproval_id, tenant_id, first_seen')
        .is('resolved_at', null).is('descartada_at', null),
      db.from('tenants').select('id, nombre, manual_paid_until, manual_monto_mensual')
        .eq('billing_mode', 'manual').eq('subscription_status', 'active').lt('manual_paid_until', new Date().toISOString()),
      db.from('nc_afip_pendientes').select('tenant_id, intentos, ultimo_error, requiere_reconciliacion_manual, created_at')
        .is('resuelto_at', null),
      db.from('emision_factura_locks').select('tenant_id, iniciado_at').eq('requiere_reconciliacion_manual', true),
      db.from('support_tickets').select('tenant_id, asunto, ultimo_mensaje_at, created_at')
        .eq('pendiente_equipo', true).not('estado', 'in', '(resuelto,cerrado)'),
      db.rpc('fn_admin_tenants_overview', { p_q: null, p_limit: 500 }),
    ])

    // Nombre de cada negocio (una sola vez, del overview que ya trae todos).
    const tenants = (overview.data ?? []) as any[]
    const nombre = new Map<string, string>(tenants.map(t => [t.id, t.nombre ?? t.id]))
    const n = (id: string | null) => (id ? nombre.get(id) ?? id : 'sin negocio vinculado')

    const secciones: Seccion[] = [
      {
        titulo: 'Cobros',
        items: [
          ...((alertasMp.data ?? []) as any[]).map(a => ({
            negocio: n(a.tenant_id), tenantId: a.tenant_id,
            detalle: a.tipo === 'huerfana'
              ? `Mercado Pago cobra una suscripción que no está vinculada a ningún negocio (${a.preapproval_id}). Vincularla o descartarla en Facturación.`
              : a.tipo === 'drift_mp_cobra'
                ? 'Mercado Pago le cobra pero el negocio no tiene acceso.'
                : 'Tiene acceso activo pero su suscripción de Mercado Pago ya no cobra.',
          })),
          ...((manualesVencidos.data ?? []) as any[]).map(t => ({
            negocio: t.nombre, tenantId: t.id,
            detalle: `Pago manual vencido el ${fecha(t.manual_paid_until)} ($${Number(t.manual_monto_mensual ?? 0).toLocaleString('es-AR')}/mes).`,
          })),
        ],
      },
      {
        titulo: 'Facturación trabada',
        items: [
          ...((ncPendientes.data ?? []) as any[]).map(x => ({
            negocio: n(x.tenant_id), tenantId: x.tenant_id,
            detalle: x.requiere_reconciliacion_manual
              ? `Nota de crédito de AFIP para revisar a mano (${x.intentos} intentos): ${String(x.ultimo_error ?? '').slice(0, 140)}`
              : `Nota de crédito de AFIP sin emitir desde el ${fecha(x.created_at)} (${x.intentos} intentos).`,
          })),
          ...((locks.data ?? []) as any[]).map(l => ({
            negocio: n(l.tenant_id), tenantId: l.tenant_id,
            detalle: `Una emisión del ${fecha(l.iniciado_at)} quedó sin confirmar: verificar en AFIP si salió antes de reintentar.`,
          })),
        ],
      },
      {
        titulo: 'Soporte',
        items: ((tickets.data ?? []) as any[])
          .filter(t => new Date(t.ultimo_mensaje_at ?? t.created_at).getTime() < ahora - DIA)
          .map(t => ({ negocio: n(t.tenant_id), tenantId: t.tenant_id, detalle: `Espera respuesta desde el ${fecha(t.ultimo_mensaje_at ?? t.created_at)}: "${t.asunto}".` })),
      },
      {
        titulo: 'Pruebas',
        items: tenants.filter(t => t.subscription_status === 'trial' && t.trial_ends_at).flatMap(t => {
          const fin = new Date(t.trial_ends_at).getTime()
          if (fin > ahora && fin <= ahora + 3 * DIA) return [{ negocio: t.nombre, tenantId: t.id, detalle: `La prueba vence el ${fecha(t.trial_ends_at)}.` }]
          if (fin <= ahora && fin > ahora - DIA) return [{ negocio: t.nombre, tenantId: t.id, detalle: 'La prueba venció hoy sin elegir plan.' }]
          return []
        }),
      },
      {
        titulo: 'Clientes que pagan y no entran',
        items: tenants.filter(t => t.subscription_status === 'active'
          && (!t.ultimo_acceso || new Date(t.ultimo_acceso).getTime() < ahora - 14 * DIA))
          .map(t => ({ negocio: t.nombre, tenantId: t.id, detalle: `Último acceso: ${t.ultimo_acceso ? fecha(t.ultimo_acceso) : 'nunca'}.` })),
      },
    ]

    const total = secciones.reduce((s, x) => s + x.items.length, 0)
    const subject = total > 0
      ? `Genesis360 — ${total} pendiente${total > 1 ? 's' : ''} del equipo · ${new Date().toLocaleDateString('es-AR')}`
      : `Genesis360 — sin pendientes · ${new Date().toLocaleDateString('es-AR')}`

    const bloque = (s: Seccion) => s.items.length === 0 ? '' : `
      <h3 style="margin:24px 0 8px;font-size:15px;color:#111">${esc(s.titulo)} (${s.items.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${s.items.map(i => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;width:34%;vertical-align:top">
            ${i.tenantId ? `<a href="${PANEL}/customers/${esc(i.tenantId)}" style="color:#7B00FF;text-decoration:none">${esc(i.negocio)}</a>` : esc(i.negocio)}
          </td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#333">${esc(i.detalle)}</td>
        </tr>`).join('')}
      </table>`

    const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:12px;padding:24px">
    <h2 style="margin:0 0 4px;font-size:18px;color:#111">Resumen diario del equipo</h2>
    <p style="margin:0 0 8px;color:#666;font-size:13px">${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    ${total === 0
      ? '<p style="color:#059669;font-weight:600;font-size:14px">Sin pendientes: cobros, facturación, soporte y pruebas en orden.</p>'
      : secciones.map(bloque).join('')}
    <p style="margin:24px 0 0;font-size:12px;color:#999">
      <a href="${PANEL}" style="color:#7B00FF;text-decoration:none">Abrir el panel interno</a> · EF monitoring-check
    </p>
  </div>
</div></body></html>`

    const resendKey = Deno.env.get('RESEND_API_KEY')
    let emailId: string | null = null
    if (resendKey) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [ALERT_EMAIL], subject, html }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) console.error('monitoring-check: Resend', r.status, JSON.stringify(body))
      emailId = body?.id ?? null
    }

    return new Response(JSON.stringify({
      ok: true, total, emailId,
      por_seccion: Object.fromEntries(secciones.map(s => [s.titulo, s.items.length])),
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('monitoring-check error:', err)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
