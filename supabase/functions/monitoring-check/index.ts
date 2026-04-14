import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const ALERT_EMAIL   = 'gaston.otranto@gmail.com'
const FROM          = 'onboarding@resend.dev'  // cambiar a noreply@genesis360.pro cuando esté verificado

// ─── Umbrales ─────────────────────────────────────────────────────────────────
const UMBRAL_RESERVAS_DIAS  = 5   // reservas sin despachar → alerta
const UMBRAL_CAJA_HORAS     = 16  // caja abierta sin cerrar → alerta

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const now      = Date.now()
    const hoy      = new Date(); hoy.setHours(0, 0, 0, 0)
    const hace5d   = new Date(now - UMBRAL_RESERVAS_DIAS * 86400 * 1000).toISOString()
    const hace16h  = new Date(now - UMBRAL_CAJA_HORAS   * 3600  * 1000).toISOString()

    // ── 1. Reservas viejas ────────────────────────────────────────────────────
    const { data: reservasViejas = [] } = await supabase
      .from('ventas')
      .select('numero, total, monto_pagado, created_at')
      .eq('estado', 'reservada')
      .lt('created_at', hace5d)
      .order('created_at', { ascending: true })
      .limit(20)

    // ── 2. Stock crítico ──────────────────────────────────────────────────────
    const { data: todosProductos = [] } = await supabase
      .from('productos')
      .select('sku, nombre, stock_actual, stock_minimo')
      .eq('activo', true)
      .not('stock_minimo', 'is', null)
      .gt('stock_minimo', 0)

    const stockCritico = (todosProductos ?? [])
      .filter((p: any) => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 0))

    // ── 3. Cajas abiertas > 16h ───────────────────────────────────────────────
    const { data: cajasViejas = [] } = await supabase
      .from('caja_sesiones')
      .select('id, created_at, cajas(nombre)')
      .is('cerrada_at', null)
      .lt('created_at', hace16h)

    // ── 4. Ventas finalizadas hoy ─────────────────────────────────────────────
    const { data: ventasHoy = [], count: countHoy } = await supabase
      .from('ventas')
      .select('total', { count: 'exact' })
      .eq('estado', 'despachada')
      .gte('created_at', hoy.toISOString())

    const totalHoy = (ventasHoy ?? []).reduce((s: number, v: any) => s + (v.total ?? 0), 0)

    // ── Alertas ───────────────────────────────────────────────────────────────
    const alerts: string[] = []
    if ((reservasViejas ?? []).length > 0)
      alerts.push(`🔒 ${(reservasViejas ?? []).length} reserva(s) sin despachar hace más de ${UMBRAL_RESERVAS_DIAS} días`)
    if (stockCritico.length > 0)
      alerts.push(`⚠️ ${stockCritico.length} producto(s) en stock crítico`)
    if ((cajasViejas ?? []).length > 0)
      alerts.push(`⏰ ${(cajasViejas ?? []).length} caja(s) abiertas hace más de ${UMBRAL_CAJA_HORAS} horas`)

    const hasAlerts = alerts.length > 0
    const fecha     = new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const subject   = hasAlerts
      ? `⚠️ Genesis360 — ${alerts.length} alerta(s) · ${new Date().toLocaleDateString('es-AR')}`
      : `✅ Genesis360 — Todo en orden · ${new Date().toLocaleDateString('es-AR')}`

    // ── HTML del email ────────────────────────────────────────────────────────
    const alertBox = hasAlerts
      ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:0 0 20px">
           <p style="margin:0 0 8px;color:#92400e;font-weight:600">Se detectaron ${alerts.length} alerta(s):</p>
           <ul style="margin:0;padding-left:18px">
             ${alerts.map(a => `<li style="color:#92400e;margin:4px 0;font-size:14px">${a}</li>`).join('')}
           </ul>
         </div>`
      : `<p style="color:#059669;font-weight:600;margin:0 0 20px;font-size:14px">✅ Sin alertas — todo en orden.</p>`

    const kpis = `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="background:#f3f4f6;border-radius:8px;padding:12px 20px;text-align:center;min-width:110px">
          <div style="font-size:22px;font-weight:700;color:#111">${countHoy ?? 0}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">Ventas hoy</div>
        </div>
        <div style="background:#f3f4f6;border-radius:8px;padding:12px 20px;text-align:center;min-width:110px">
          <div style="font-size:22px;font-weight:700;color:#111">$${totalHoy.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">Facturado hoy</div>
        </div>
        <div style="background:#f3f4f6;border-radius:8px;padding:12px 20px;text-align:center;min-width:110px">
          <div style="font-size:22px;font-weight:700;color:${stockCritico.length > 0 ? '#dc2626' : '#111'}">${stockCritico.length}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">Stock crítico</div>
        </div>
        <div style="background:#f3f4f6;border-radius:8px;padding:12px 20px;text-align:center;min-width:110px">
          <div style="font-size:22px;font-weight:700;color:${(reservasViejas ?? []).length > 0 ? '#d97706' : '#111'}">${(reservasViejas ?? []).length}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">Reservas viejas</div>
        </div>
      </div>`

    const stockTable = stockCritico.length > 0 ? `
      <p style="font-size:14px;font-weight:600;color:#dc2626;margin:0 0 6px">⚠ Stock crítico</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead><tr>
          <th style="text-align:left;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">SKU</th>
          <th style="text-align:left;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">Producto</th>
          <th style="text-align:right;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">Stock</th>
          <th style="text-align:right;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">Mínimo</th>
        </tr></thead>
        <tbody>
          ${stockCritico.slice(0, 10).map((p: any) =>
            `<tr>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;color:#374151">${p.sku}</td>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;color:#374151">${p.nombre}</td>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;text-align:right;color:#dc2626;font-weight:600">${p.stock_actual}</td>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;text-align:right;color:#374151">${p.stock_minimo}</td>
            </tr>`
          ).join('')}
        </tbody>
      </table>` : ''

    const reservasTable = (reservasViejas ?? []).length > 0 ? `
      <p style="font-size:14px;font-weight:600;color:#d97706;margin:0 0 6px">🔒 Reservas sin despachar</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead><tr>
          <th style="text-align:left;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">Venta</th>
          <th style="text-align:right;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">Total</th>
          <th style="text-align:right;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">Saldo pendiente</th>
          <th style="text-align:right;color:#6b7280;font-weight:500;padding:6px 4px;border-bottom:1px solid #e5e7eb">Antigüedad</th>
        </tr></thead>
        <tbody>
          ${(reservasViejas ?? []).slice(0, 10).map((r: any) => {
            const dias = Math.floor((now - new Date(r.created_at).getTime()) / 86400000)
            const saldo = (r.total ?? 0) - (r.monto_pagado ?? 0)
            return `<tr>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;color:#374151">#${r.numero}</td>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;text-align:right;color:#374151">$${Number(r.total).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;text-align:right;color:${saldo > 0 ? '#d97706' : '#374151'}">${saldo > 0 ? '$' + saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—'}</td>
              <td style="padding:7px 4px;border-bottom:1px solid #f3f4f6;text-align:right;color:#374151">${dias}d</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>` : ''

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <div style="background:#7B00FF;padding:24px 32px">
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">Genesis360 — Reporte diario</h1>
    <p style="margin:4px 0 0;color:#d4b3ff;font-size:13px">${fecha}</p>
  </div>
  <div style="padding:24px 32px">
    ${alertBox}
    ${kpis}
    ${stockTable}
    ${reservasTable}
  </div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
    <p style="margin:0;color:#9ca3af;font-size:12px">
      Reporte automático de Genesis360 ·
      <a href="https://app.genesis360.pro" style="color:#7B00FF;text-decoration:none">Abrir app</a> ·
      <a href="https://supabase.com/dashboard/project/jjffnbrdjchquexdfgwq" style="color:#7B00FF;text-decoration:none">Supabase PROD</a>
    </p>
  </div>
</div>
</body></html>`

    // ── Enviar via Resend ─────────────────────────────────────────────────────
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [ALERT_EMAIL], subject, html }),
    })
    const resendBody = await resendRes.json()

    return new Response(
      JSON.stringify({ ok: true, hasAlerts, alerts, emailId: resendBody.id }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    console.error('monitoring-check error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
