import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// TODO: Cambiar a 'noreply@stokio.com' cuando el dominio esté verificado en Resend
const FROM = 'onboarding@resend.dev'
const APP_URL = 'https://stokio-tau.vercel.app'
const BRAND = 'Stokio'

// ─── Templates ────────────────────────────────────────────────────────────────

function templateBase(content: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width:560px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .header { background:#1E3A5F; padding:28px 32px; }
  .header h1 { margin:0; color:#fff; font-size:22px; font-weight:700; letter-spacing:-0.3px; }
  .header p { margin:4px 0 0; color:#90b4d8; font-size:13px; }
  .body { padding:28px 32px; }
  .body p { margin:0 0 14px; color:#374151; font-size:15px; line-height:1.6; }
  .btn { display:inline-block; background:#1E3A5F; color:#fff !important; text-decoration:none; padding:12px 24px; border-radius:8px; font-weight:600; font-size:14px; margin:8px 0 16px; }
  .divider { border:none; border-top:1px solid #e5e7eb; margin:20px 0; }
  .footer { background:#f9fafb; padding:16px 32px; }
  .footer p { margin:0; color:#9ca3af; font-size:12px; line-height:1.5; }
  .tag { display:inline-block; background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:4px; font-size:13px; font-weight:600; }
  .table { width:100%; border-collapse:collapse; margin:12px 0; font-size:14px; }
  .table th { text-align:left; color:#6b7280; font-weight:500; padding:6px 0; border-bottom:1px solid #e5e7eb; }
  .table td { padding:8px 0; color:#374151; border-bottom:1px solid #f3f4f6; }
  .table .right { text-align:right; }
  .total-row td { font-weight:700; color:#1E3A5F; border-bottom:none; padding-top:12px; }
  .alert-box { background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:16px; margin:12px 0; }
  .alert-box p { margin:0; color:#92400e; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>${BRAND}</h1>
    <p>El cerebro de tu negocio</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>Este es un email automático de ${BRAND}. No respondas a este mensaje.<br>
    <a href="${APP_URL}" style="color:#6b7280">${APP_URL}</a></p>
  </div>
</div>
</body></html>`
}

function welcomeTemplate(data: { nombre: string; negocio: string }) {
  return {
    subject: `¡Bienvenido a ${BRAND}, ${data.nombre}!`,
    html: templateBase(`
      <p>Hola <strong>${data.nombre}</strong>,</p>
      <p>¡Ya está todo listo! Tu negocio <strong>${data.negocio}</strong> fue creado exitosamente en ${BRAND}.</p>
      <p>Tenés <strong>7 días de prueba gratis</strong> con acceso a todas las funcionalidades. Empezá cargando tus productos.</p>
      <a href="${APP_URL}/dashboard" class="btn">Ir al dashboard →</a>
      <hr class="divider">
      <p style="font-size:13px;color:#6b7280">¿Dudas? Respondé este email y te ayudamos.</p>
    `),
  }
}

function ventaConfirmadaTemplate(data: {
  numero: number
  negocio: string
  total: number
  items: Array<{ nombre: string; cantidad: number; subtotal: number }>
  medio_pago: string
}) {
  const itemsHtml = data.items.map(i =>
    `<tr>
      <td>${i.nombre}</td>
      <td class="right">${i.cantidad}</td>
      <td class="right">$${i.subtotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
    </tr>`
  ).join('')

  return {
    subject: `Venta #${data.numero} registrada — $${data.total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`,
    html: templateBase(`
      <p>Se registró una nueva venta en <strong>${data.negocio}</strong>.</p>
      <p><span class="tag">Venta #${data.numero}</span></p>
      <table class="table">
        <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>
          ${itemsHtml}
          <tr class="total-row">
            <td colspan="2">Total</td>
            <td class="right">$${data.total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:13px;color:#6b7280">Medio de pago: ${data.medio_pago || 'No especificado'}</p>
      <a href="${APP_URL}/ventas" class="btn">Ver historial de ventas →</a>
    `),
  }
}

function alertaStockTemplate(data: {
  producto: string
  sku: string
  stock_actual: number
  stock_minimo: number
  negocio: string
}) {
  return {
    subject: `⚠️ Stock bajo: ${data.producto}`,
    html: templateBase(`
      <p>Hay un producto con stock por debajo del mínimo en <strong>${data.negocio}</strong>.</p>
      <div class="alert-box">
        <p><strong>${data.producto}</strong>${data.sku ? ` (SKU: ${data.sku})` : ''}</p>
        <p style="margin-top:8px">Stock actual: <strong>${data.stock_actual}</strong> unidades &nbsp;/&nbsp; Mínimo configurado: <strong>${data.stock_minimo}</strong></p>
      </div>
      <a href="${APP_URL}/inventario" class="btn">Ver inventario →</a>
    `),
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, to, data } = await req.json()

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) throw new Error('RESEND_API_KEY no configurado')
    if (!to) throw new Error('Falta el campo "to"')

    let subject: string
    let html: string

    if (type === 'welcome') {
      ;({ subject, html } = welcomeTemplate(data))
    } else if (type === 'venta_confirmada') {
      ;({ subject, html } = ventaConfirmadaTemplate(data))
    } else if (type === 'alerta_stock') {
      ;({ subject, html } = alertaStockTemplate(data))
    } else {
      throw new Error(`Tipo de email desconocido: ${type}`)
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })

    const result = await res.json()
    if (!res.ok) throw new Error(result.message ?? JSON.stringify(result))

    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('send-email error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
