import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// wa-webhook — Fase 1 del Asistente de WhatsApp con IA (propuesta de Fede, 25/8/2026; plan técnico
// acordado con GO 2026-08-26). Solo lectura: responde consultas de stock/precio del dueño por
// WhatsApp. No comparte código con supabase/functions/ai-assistant (que sigue en PROD sin cambios) —
// prompt y modelo de auth distintos, ver plan.
//
// Secrets requeridos: META_APP_SECRET (firma X-Hub-Signature-256), META_VERIFY_TOKEN (handshake GET
// de suscripción del webhook). ANTHROPIC_API_KEY ya existe en el proyecto (lo usan scan-product/
// scan-ticket), no hace falta darlo de alta de nuevo.
//
// Deploy con --no-verify-jwt (Meta no manda JWT de Supabase, igual que tn-webhook/meli-webhook/
// mp-webhook/modo-webhook).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hub-signature-256',
}

const CLAUDE_MODEL = 'claude-sonnet-5'
const GRAPH_API_VERSION = 'v23.0'

// Firma de Meta: header `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 sobre el body RAW completo
// (a diferencia de MP, que firma un manifest armado con query params — acá es el body entero).
// Bloqueante desde el día 1 (a diferencia del modo log-only actual de mp-webhook): sin esto,
// cualquiera podría mandarle payloads falsos a esta función y disparar tool-calls sobre el tenant.
async function verificarFirmaMeta(bodyRaw: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = signatureHeader.slice('sha256='.length).toLowerCase()
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyRaw))
  const computed = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  if (computed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

const TOOL_CONSULTAR_STOCK = {
  name: 'consultar_stock_precio',
  description: 'Busca productos del negocio por nombre o SKU y devuelve su stock y precio de venta actuales. Usar SIEMPRE que el usuario pregunte por stock, precio o disponibilidad de un producto.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Nombre o SKU (parcial) del producto a buscar' },
    },
    required: ['query'],
  },
}

function construirSystemPrompt(nombreNegocio: string): string {
  return `Sos el asistente de WhatsApp de "${nombreNegocio}" en Genesis360, hablando directamente con el dueño del negocio.

Reglas:
1. Respondé SOLO sobre stock y precio de productos, usando la herramienta consultar_stock_precio. Nunca inventes números — si la herramienta no trae el dato, decilo.
2. Si la búsqueda no encuentra el producto, decilo claro y sugerí probar con otro nombre o SKU.
3. Todavía no podés cargar gastos, modificar nada, ni leer fotos o audios — si te piden eso, explicá que está en camino.
4. Respuestas cortas y directas en español, estilo WhatsApp (sin markdown, sin listas largas).`
}

async function buscarProductos(supabase: any, tenantId: string, query: string) {
  const q = query.replace(/[%_]/g, '').trim()
  if (!q) return []
  const { data, error } = await supabase
    .from('productos')
    .select('nombre, sku, precio_venta, stock_actual')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`)
    .limit(5)
  if (error) {
    console.error('wa-webhook: error consultando productos', error)
    return []
  }
  return data ?? []
}

async function llamarClaude(
  apiKey: string, systemPrompt: string, userText: string, supabase: any, tenantId: string,
): Promise<{ texto: string; tokensIn: number; tokensOut: number }> {
  const messages: any[] = [{ role: 'user', content: userText }]
  let tokensIn = 0
  let tokensOut = 0

  // Máximo 2 turnos: 1 pedido de tool + 1 respuesta final. Alcanza para el caso de uso de Fase 1
  // (una sola tool, sin encadenar múltiples búsquedas).
  for (let turno = 0; turno < 2; turno++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        system: systemPrompt,
        messages,
        tools: [TOOL_CONSULTAR_STOCK],
      }),
    })
    if (!res.ok) {
      throw new Error(`Claude API ${res.status}: ${await res.text()}`)
    }
    const data = await res.json()
    tokensIn += data.usage?.input_tokens ?? 0
    tokensOut += data.usage?.output_tokens ?? 0

    const toolUse = (data.content ?? []).find((b: any) => b.type === 'tool_use')
    if (!toolUse || data.stop_reason !== 'tool_use') {
      const texto = (data.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim()
      return { texto: texto || 'No pude armar una respuesta, probá reformular la consulta.', tokensIn, tokensOut }
    }

    const resultados = toolUse.name === 'consultar_stock_precio'
      ? await buscarProductos(supabase, tenantId, String(toolUse.input?.query ?? ''))
      : []

    messages.push({ role: 'assistant', content: data.content })
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(resultados) }],
    })
  }
  return { texto: 'No pude terminar de procesar esa consulta, probá de nuevo.', tokensIn, tokensOut }
}

async function enviarMensajeWhatsapp(phoneNumberId: string, accessToken: string, to: string, texto: string) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto.slice(0, 4000) } }),
  })
  if (!res.ok) {
    console.error('wa-webhook: error enviando respuesta a WhatsApp', res.status, await res.text())
  }
}

serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    // Handshake de verificación de Meta al conectar el webhook (paso único, no repetitivo).
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const verifyToken = Deno.env.get('META_VERIFY_TOKEN')
    if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
      return new Response(challenge ?? '', { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const bodyRaw = await req.text()

  const appSecret = Deno.env.get('META_APP_SECRET')
  if (!appSecret) {
    console.error('wa-webhook: META_APP_SECRET no configurado')
    return new Response('Server misconfigured', { status: 500 })
  }
  const firmaOk = await verificarFirmaMeta(bodyRaw, req.headers.get('x-hub-signature-256'), appSecret)
  if (!firmaOk) {
    console.warn('wa-webhook: firma inválida, request rechazado')
    return new Response('Invalid signature', { status: 403 })
  }

  let payload: any
  try {
    payload = JSON.parse(bodyRaw)
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {}
        const phoneNumberId = value.metadata?.phone_number_id
        const mensajes = value.messages ?? []
        // value.statuses = recibos de entrega/lectura de mensajes SALIENTES — nada que responder.
        if (!phoneNumberId || mensajes.length === 0) continue

        const { data: cred } = await supabase
          .from('whatsapp_credentials')
          .select('tenant_id, access_token')
          .eq('phone_number_id', phoneNumberId)
          .eq('conectado', true)
          .maybeSingle()

        if (!cred) {
          console.warn('wa-webhook: phone_number_id sin credenciales conectadas', phoneNumberId)
          continue
        }

        for (const msg of mensajes) {
          const from = msg.from
          const messageId = msg.id
          if (!from || !messageId) continue

          // Idempotencia: insert-primero (mismo patrón que meli-webhook/mp-webhook). Si el UNIQUE
          // ya existe (23505), es un reintento de Meta del mismo mensaje — no se reprocesa.
          const { error: logInErr } = await supabase.from('whatsapp_mensajes_log').insert({
            tenant_id: cred.tenant_id,
            message_id: messageId,
            direccion: 'in',
            texto_truncado: (msg.text?.body ?? `[${msg.type}]`).slice(0, 200),
          })
          if (logInErr) {
            if ((logInErr as any).code === '23505') {
              console.log('wa-webhook: mensaje ya procesado (idempotente)', messageId)
            } else {
              console.error('wa-webhook: error de idempotencia, se aborta este mensaje', logInErr)
            }
            continue
          }

          if (msg.type !== 'text' || !msg.text?.body) {
            await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from,
              'Por ahora solo puedo leer texto — todavía no leo fotos ni audios. Escribime tu consulta 🙂')
            continue
          }

          const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
          if (!apiKey) {
            console.error('wa-webhook: ANTHROPIC_API_KEY no configurado')
            continue
          }

          const { data: tenantRow } = await supabase.from('tenants').select('nombre').eq('id', cred.tenant_id).maybeSingle()
          const systemPrompt = construirSystemPrompt(tenantRow?.nombre ?? 'tu negocio')

          let respuesta: { texto: string; tokensIn: number; tokensOut: number }
          try {
            respuesta = await llamarClaude(apiKey, systemPrompt, msg.text.body, supabase, cred.tenant_id)
          } catch (e: any) {
            console.error('wa-webhook: error llamando a Claude', e.message)
            respuesta = { texto: 'Tuve un problema respondiendo, probá de nuevo en un rato.', tokensIn: 0, tokensOut: 0 }
          }

          await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from, respuesta.texto)

          await supabase.from('whatsapp_mensajes_log').insert({
            tenant_id: cred.tenant_id,
            message_id: `${messageId}-out`,
            direccion: 'out',
            texto_truncado: respuesta.texto.slice(0, 200),
            modelo: CLAUDE_MODEL,
            tokens_in: respuesta.tokensIn,
            tokens_out: respuesta.tokensOut,
          })
        }
      }
    }
  } catch (err: any) {
    // Errores de negocio (no de firma) nunca bloquean el ACK a Meta, para no generar reintentos en
    // cadena — quedan logueados server-side para revisar con query_logs.
    console.error('wa-webhook: error procesando payload', err.message)
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
