import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SOPORTE, UUID_RE, destinatariosSegunTipo, esc, rutaInterna, textoPlano, validarAdjuntos, type Llamador,
} from './seguridad.ts'

// 🛑 Seguridad (2026-09-15): hasta acá la EF no validaba quién llamaba. `verify_jwt` estaba activo, pero la clave anon
// pública de la app ya es un JWT válido: cualquiera podía mandar mails con nuestro remitente, al destinatario que
// quisiera y con HTML propio en los datos. Ahora:
//   · solo entran un usuario con sesión real (y fila en `users`) o el servidor (clave de servicio, las otras EF);
//   · los reportes a soporte van siempre a soporte@ y la bienvenida pedida desde la app, solo al propio usuario;
//   · el negocio y el usuario que figuran en el mail salen de la base, no del pedido;
//   · todo lo que viene en `data` se escapa, y los links internos tienen que ser rutas de la app.
// Las reglas puras viven en `seguridad.ts` (tests en tests/unit/sendEmailSeguridad.test.ts).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Dominio genesis360.pro verificado en Resend (Cloudflare DNS, región sa-east-1) — 2026-06-06.
const FROM = 'Genesis360 <noreply@genesis360.pro>'
const APP_URL = 'https://genesis360.pro'
const PANEL_URL = 'https://admin.genesis360.pro'
const BRAND = 'Genesis360'

// deno-lint-ignore no-explicit-any
type Datos = Record<string, any>

const pesos = (n: unknown) => `$${Number(n ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
const lista = (v: unknown): Datos[] => (Array.isArray(v) ? v : [])

// ─── Templates ────────────────────────────────────────────────────────────────

function templateBase(content: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width:560px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .header { background:#7B00FF; background-image:linear-gradient(135deg,#7B00FF 0%,#06B6D4 100%); padding:22px 32px; }
  .header h1 { margin:0; color:#fff; font-size:22px; font-weight:700; letter-spacing:-0.3px; }
  .header p { margin:3px 0 0; color:rgba(255,255,255,.82); font-size:13px; }
  .body { padding:28px 32px; }
  .body p { margin:0 0 14px; color:#374151; font-size:15px; line-height:1.6; }
  .btn { display:inline-block; background:#7B00FF; color:#fff !important; text-decoration:none; padding:12px 24px; border-radius:8px; font-weight:600; font-size:14px; margin:8px 0 16px; }
  .divider { border:none; border-top:1px solid #e5e7eb; margin:20px 0; }
  .footer { background:#f9fafb; padding:16px 32px; }
  .footer p { margin:0; color:#9ca3af; font-size:12px; line-height:1.5; }
  .tag { display:inline-block; background:#f3e8ff; color:#7B00FF; padding:2px 8px; border-radius:4px; font-size:13px; font-weight:600; }
  .table { width:100%; border-collapse:collapse; margin:12px 0; font-size:14px; }
  .table th { text-align:left; color:#6b7280; font-weight:500; padding:6px 0; border-bottom:1px solid #e5e7eb; }
  .table td { padding:8px 0; color:#374151; border-bottom:1px solid #f3f4f6; }
  .table .right { text-align:right; }
  .total-row td { font-weight:700; color:#7B00FF; border-bottom:none; padding-top:12px; }
  .alert-box { background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:16px; margin:12px 0; }
  .alert-box p { margin:0; color:#92400e; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle"><img src="https://www.genesis360.pro/android-chrome-192x192.png" width="40" height="40" alt="${BRAND}" style="display:block;border-radius:9px"></td>
      <td style="vertical-align:middle;padding-left:12px"><h1>${BRAND}</h1><p>El inventario inteligente para tu negocio</p></td>
    </tr></table>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>Este es un email automático de ${BRAND}. No respondas a este mensaje.<br>
    <a href="${APP_URL}" style="color:#6b7280">${APP_URL}</a></p>
  </div>
</div>
</body></html>`
}

const PRE = 'background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:13px;color:#374151;white-space:pre-wrap;word-break:break-word'

function filasItems(items: Datos[]) {
  return items.map((i) =>
    `<tr>
      <td>${esc(i.nombre)}</td>
      <td class="right">${esc(i.cantidad)}</td>
      <td class="right">${pesos(i.subtotal)}</td>
    </tr>`
  ).join('')
}

function welcomeTemplate(d: Datos) {
  return {
    subject: textoPlano(`¡Bienvenido a ${BRAND}, ${d.nombre}!`),
    html: templateBase(`
      <p>Hola <strong>${esc(d.nombre)}</strong>,</p>
      <p>¡Ya está todo listo! Tu negocio <strong>${esc(d.negocio)}</strong> fue creado exitosamente en ${BRAND}.</p>
      <p>Tenés <strong>30 días de prueba gratis</strong> con acceso a todas las funcionalidades. Empezá cargando tus productos.</p>
      <a href="${APP_URL}/dashboard" class="btn">Ir al dashboard →</a>
      <hr class="divider">
      <p style="font-size:13px;color:#6b7280">¿Dudas? Respondé este email y te ayudamos.</p>
    `),
  }
}

function ventaConfirmadaTemplate(d: Datos) {
  return {
    subject: textoPlano(`Venta #${Number(d.numero) || ''} registrada — ${pesos(d.total)}`),
    html: templateBase(`
      <p>Se registró una nueva venta en <strong>${esc(d.negocio)}</strong>.</p>
      <p><span class="tag">Venta #${esc(Number(d.numero) || '')}</span></p>
      <table class="table">
        <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>
          ${filasItems(lista(d.items))}
          <tr class="total-row">
            <td colspan="2">Total</td>
            <td class="right">${pesos(d.total)}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:13px;color:#6b7280">Medio de pago: ${esc(d.medio_pago || 'No especificado')}</p>
      <a href="${APP_URL}/ventas" class="btn">Ver historial de ventas →</a>
    `),
  }
}

function alertaStockTemplate(d: Datos) {
  return {
    subject: textoPlano(`⚠️ Stock bajo: ${d.producto}`),
    html: templateBase(`
      <p>Hay un producto con stock por debajo del mínimo en <strong>${esc(d.negocio)}</strong>.</p>
      <div class="alert-box">
        <p><strong>${esc(d.producto)}</strong>${d.sku ? ` (SKU: ${esc(d.sku)})` : ''}</p>
        <p style="margin-top:8px">Stock actual: <strong>${esc(d.stock_actual)}</strong> unidades &nbsp;/&nbsp; Mínimo configurado: <strong>${esc(d.stock_minimo)}</strong></p>
      </div>
      <a href="${APP_URL}/inventario" class="btn">Ver inventario →</a>
    `),
  }
}

function facturaEmitidaTemplate(d: Datos) {
  const numero = String(Number(d.numero_comprobante) || 0).padStart(8, '0')
  return {
    subject: textoPlano(`${d.tipo_comprobante} #${numero} — ${d.negocio}`),
    html: templateBase(`
      <p>Hola <strong>${esc(d.cliente_nombre)}</strong>,</p>
      <p>Te enviamos el comprobante correspondiente a tu compra en <strong>${esc(d.negocio)}</strong>.</p>
      <p><span class="tag">${esc(d.tipo_comprobante)} N° ${numero}</span></p>
      <table class="table">
        <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>
          ${filasItems(lista(d.items))}
          <tr class="total-row">
            <td colspan="2">Total</td>
            <td class="right">${pesos(d.total)}</td>
          </tr>
        </tbody>
      </table>
      <div class="alert-box" style="background:#f0fdf4;border-color:#86efac">
        <p style="color:#166534"><strong>CAE:</strong> ${esc(d.cae)} &nbsp;·&nbsp; <strong>Vence:</strong> ${esc(d.vencimiento_cae)}</p>
      </div>
      <p style="font-size:13px;color:#6b7280">Guardá este email como comprobante de tu operación.</p>
    `),
  }
}

function ocTemplate(d: Datos) {
  return {
    subject: textoPlano(`Orden de Compra ${d.numeroLabel} — ${d.negocio}`),
    html: templateBase(`
      <p>Hola,</p>
      <p><strong>${esc(d.negocio)}</strong> te envía la siguiente orden de compra. El detalle también va adjunto en PDF.</p>
      <p><span class="tag">${esc(d.numeroLabel)}</span></p>
      ${d.fechaEsperada ? `<p style="font-size:13px;color:#6b7280">Entrega esperada: ${esc(d.fechaEsperada)}</p>` : ''}
      <table class="table">
        <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>
          ${filasItems(lista(d.items))}
          <tr class="total-row">
            <td colspan="2">Total</td>
            <td class="right">${pesos(d.total)}</td>
          </tr>
        </tbody>
      </table>
      ${d.anticipoPct && d.anticipoMonto ? `<div class="alert-box"><p>💰 Anticipo (${esc(Number(d.anticipoPct))}%): <strong>${pesos(d.anticipoMonto)}</strong></p></div>` : ''}
      ${d.condiciones ? `<p style="font-size:13px;color:#6b7280">Condiciones de pago: ${esc(d.condiciones)}</p>` : ''}
      ${d.notas ? `<p style="font-size:13px;color:#6b7280">Notas: ${esc(d.notas)}</p>` : ''}
    `),
  }
}

function invitacionProveedorTemplate(d: Datos) {
  return {
    subject: textoPlano(`${d.negocio} te invitó al Portal de Proveedores`),
    html: templateBase(`
      <p>Hola,</p>
      <p><strong>${esc(d.negocio)}</strong> te invitó a usar el Portal de Proveedores de ${BRAND} — ahí vas a poder ver sus órdenes de compra y cargar tu presupuesto directo, sin ida y vuelta por WhatsApp o email.</p>
      <a href="${esc(d.actionLink)}" class="btn">Entrar al portal →</a>
      <hr class="divider">
      <p style="font-size:13px;color:#6b7280">Si ya tenés cuenta (trabajás con otro negocio en ${BRAND}), este link te va a llevar directo — vas a ver ambos negocios desde el mismo lugar.</p>
    `),
  }
}

function bugReportTemplate(d: Datos) {
  return {
    subject: textoPlano(`🐛 Bug Report — ${d.tenant} (${d.usuario})`),
    html: templateBase(`
      <p>Nuevo reporte de soporte enviado desde Genesis360.</p>
      <div class="alert-box">
        <p><strong>Usuario:</strong> ${esc(d.usuario)}</p>
        <p style="margin-top:4px"><strong>Negocio:</strong> ${esc(d.tenant)}</p>
      </div>
      <p><strong>Detalle:</strong></p>
      <pre style="${PRE}">${esc(d.resumen)}</pre>
    `),
  }
}

/** Consulta de soporte creada o respondida desde la app (Ayuda → Mis consultas). Va siempre a soporte@. */
function soporteConsultaTemplate(d: Datos) {
  const ticket = UUID_RE.test(String(d.ticket_id ?? '')) ? String(d.ticket_id) : null
  const respuesta = d.es_respuesta === true
  return {
    subject: textoPlano(`${respuesta ? 'Respuesta del cliente' : 'Nueva consulta'} — ${d.negocio}: ${d.asunto}`, 180),
    html: templateBase(`
      <p>${respuesta ? 'Un cliente respondió una consulta desde la app.' : 'Entró una consulta nueva desde la app.'}</p>
      <div class="alert-box">
        <p><strong>Negocio:</strong> ${esc(d.negocio)}</p>
        <p style="margin-top:4px"><strong>Usuario:</strong> ${esc(d.usuario)}</p>
        ${d.tipo ? `<p style="margin-top:4px"><strong>Tipo:</strong> ${esc(d.tipo)}${d.urgencia ? ` · <strong>Urgencia:</strong> ${esc(d.urgencia)}` : ''}</p>` : ''}
      </div>
      <p><strong>${esc(d.asunto)}</strong></p>
      <pre style="${PRE}">${esc(d.cuerpo)}</pre>
      ${ticket ? `<a href="${PANEL_URL}/support?ticket=${ticket}" class="btn">Abrir en el panel →</a>` : ''}
    `),
  }
}

function notificacionTemplate(d: Datos, ruta: string | null) {
  return {
    subject: textoPlano(d.titulo),
    html: templateBase(`
      <p>${esc(d.mensaje).replace(/\n/g, '<br>')}</p>
      ${ruta ? `<a href="${APP_URL}${esc(ruta)}" class="btn">Ver en Genesis360 →</a>` : ''}
    `),
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** `role` del JWT. Solo es confiable porque la función corre con `verify_jwt`: la plataforma ya validó la firma. */
function rolDelJwt(token: string): string | null {
  const partes = token.split('.')
  if (partes.length !== 3) return null
  try {
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof json?.role === 'string' ? json.role : null
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) throw new Error('RESEND_API_KEY no configurado')

    // ── Quién llama ──────────────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()

    let llamador: Llamador
    let remitente: { id: string; email: string | null; nombre: string | null; tenantId: string; negocio: string | null } | null = null

    // Las otras EF mandan la clave de su propio entorno (misma cadena que acá). La clave de servicio también puede llegar
    // en otro formato que el del entorno de esta función: por eso se acepta por el rol del JWT (firma ya validada).
    if ((serviceKey && token === serviceKey) || rolDelJwt(token) === 'service_role') {
      llamador = 'servicio'
    } else {
      if (!token) return respuesta({ error: 'No autorizado' }, 401)
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      })
      const { data: { user } } = await userClient.auth.getUser()
      if (!user) return respuesta({ error: 'No autorizado' }, 401)   // la clave anon sola cae acá
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
      // Sin embed `tenants(nombre)`: users↔tenants tiene 2 relaciones (tenants.wms_armado_operario_default_id) y
      // PostgREST responde PGRST201 → la fila venía vacía y se rechazaba a todos los usuarios.
      const { data: fila } = await admin.from('users')
        .select('tenant_id, nombre_display, activo').eq('id', user.id).maybeSingle()
      if (!fila?.tenant_id || fila.activo === false) return respuesta({ error: 'No autorizado' }, 403)
      const { data: negocio } = await admin.from('tenants').select('nombre').eq('id', fila.tenant_id).maybeSingle()
      llamador = 'usuario'
      remitente = {
        id: user.id, email: user.email ?? null, nombre: fila.nombre_display ?? user.email ?? null,
        tenantId: fila.tenant_id, negocio: negocio?.nombre ?? null,
      }
    }

    // ── Qué pide ─────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return respuesta({ error: 'Pedido inválido' }, 400)
    const type = String(body.type ?? '')
    const data: Datos = body.data && typeof body.data === 'object' ? { ...body.data } : {}

    const destinatarios = destinatariosSegunTipo(type, llamador, body.to, remitente?.email ?? null)
    if (!destinatarios.ok) return respuesta({ error: destinatarios.error }, destinatarios.status)
    const adjuntos = validarAdjuntos(body.attachments, llamador)
    if (!adjuntos.ok) return respuesta({ error: adjuntos.error }, adjuntos.status)

    // El negocio y el usuario que figuran en el mail salen de la base, no del pedido.
    if (remitente) {
      if (remitente.negocio) {
        data.negocio = remitente.negocio
        data.tenant = remitente.negocio
      }
      data.usuario = remitente.nombre
    }

    let ruta: string | null = null
    if (type === 'notificacion' && data.action_url) {
      ruta = rutaInterna(data.action_url)
      if (!ruta) return respuesta({ error: 'action_url inválido: tiene que ser una ruta de la app.' }, 400)
    }
    if (type === 'invitacion_proveedor' && !/^https:\/\/[^\s"'<>]+$/.test(String(data.actionLink ?? ''))) {
      return respuesta({ error: 'actionLink inválido' }, 400)
    }

    let plantilla: { subject: string; html: string }
    switch (type) {
      case 'welcome': plantilla = welcomeTemplate(data); break
      case 'venta_confirmada': plantilla = ventaConfirmadaTemplate(data); break
      case 'alerta_stock': plantilla = alertaStockTemplate(data); break
      case 'notificacion': plantilla = notificacionTemplate(data, ruta); break
      case 'factura_emitida': plantilla = facturaEmitidaTemplate(data); break
      case 'oc': plantilla = ocTemplate(data); break
      case 'bug_report': plantilla = bugReportTemplate(data); break
      case 'soporte_consulta': plantilla = soporteConsultaTemplate(data); break
      case 'invitacion_proveedor': plantilla = invitacionProveedorTemplate(data); break
      default: return respuesta({ error: `Tipo de email desconocido: ${type}` }, 400)
    }

    // attachments opcional: [{ filename, content (base64) }] — soportado por Resend.
    const payload: Record<string, unknown> = { from: FROM, to: destinatarios.valor, subject: plantilla.subject, html: plantilla.html }
    if (adjuntos.valor.length > 0) payload.attachments = adjuntos.valor

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const result = await res.json()
    if (!res.ok) throw new Error(result.message ?? JSON.stringify(result))

    // Traza de quién mandó qué (sin los mails de destino).
    console.log(`send-email ${type} · ${llamador === 'servicio' ? 'servicio' : `usuario ${remitente!.id} · negocio ${remitente!.tenantId}`} · ${destinatarios.valor.length} destinatario(s)`)

    return respuesta({
      ok: true, id: result.id,
      ...(type === 'bug_report' || type === 'soporte_consulta' ? { enviadoA: SOPORTE } : {}),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('send-email error:', msg)
    return respuesta({ error: msg }, 500)
  }
})
