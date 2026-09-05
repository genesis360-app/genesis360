import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

// wa-webhook — Asistente de WhatsApp con IA (propuesta de Fede, 25/8/2026; planes técnicos acordados
// con GO 2026-08-26/27). No comparte código con supabase/functions/ai-assistant (que sigue en PROD sin
// cambios) — prompt y modelo de auth distintos, ver plan.
//
// Fase 1: solo lectura, consultas de stock/precio (tool consultar_stock_precio).
// Fase 2: cargar gastos como BORRADOR (tool proponer_gasto) — el bot NUNCA escribe en `gastos`
// directamente (esa tabla dispara reglas de negocio reales: umbral por rol, saldo de caja, comprobante
// obligatorio, multi-CUIT, período cerrado — ver GastosPage.tsx). Doble confirmación: (1) el remitente
// de WhatsApp confirma con un botón interactivo antes de que se guarde el borrador, (2) un humano con
// acceso a Genesis360 aprueba el borrador desde el modal "Nuevo Gasto" de siempre (GastosPage.tsx —
// abrirDesdeBorrador), que corre TODA la lógica real. El borrador vive en `whatsapp_gastos_borrador`
// (mig 383) con 4 estados: pendiente_confirmacion -> pendiente -> aprobado | descartado.
// Fase 3: fotos y audio son solo formas nuevas de LLEGAR al mismo pipeline — nunca lógica fiscal
// nueva. Audio se transcribe (Groq Whisper) y el texto reemplaza a msg.text.body sin tocar
// llamarClaude. Una foto se manda como bloque de imagen en el mismo mensaje a Claude (ya es
// multimodal) — si Claude reconoce un comprobante de gasto, llama a proponer_gasto igual que con
// texto; esa foto queda linkeada al borrador (comprobante_url, mig 384) para precargarla en la
// aprobación humana.
//
// Secrets requeridos: META_APP_SECRET (firma X-Hub-Signature-256), META_VERIFY_TOKEN (handshake GET
// de suscripción del webhook). ANTHROPIC_API_KEY y GROQ_API_KEY ya existen en el proyecto (los usan
// scan-product/scan-ticket y ai-assistant respectivamente), no hace falta darlos de alta de nuevo.
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

const TOOL_PROPONER_GASTO = {
  name: 'proponer_gasto',
  description: 'Arma un BORRADOR de un gasto que el usuario contó — nunca lo guarda directo. El usuario debe confirmar con un botón, y recién después un humano lo revisa y lo carga de verdad en la app. Usar cuando el usuario cuente que gastó plata en algo (ej: "gasté 5000 en nafta").',
  input_schema: {
    type: 'object',
    properties: {
      descripcion: { type: 'string', description: 'Descripción corta del gasto (ej: "Nafta", "Compra de insumos")' },
      monto: { type: 'number', description: 'Monto del gasto en pesos, solo el número' },
      categoria: { type: 'string', description: 'Categoría del gasto si se puede inferir (ej: "Combustible", "Insumos") — opcional' },
      fecha: { type: 'string', description: 'Fecha del gasto en formato YYYY-MM-DD, SOLO si el usuario la menciona explícitamente (ej: "ayer", "el lunes") — si no dice nada, dejar vacío' },
      advertencia: { type: 'string', description: 'Discrepancia a avisarle al usuario antes de que confirme (ej: la foto del comprobante dice otro monto o comercio que lo que él escribió). NO se guarda en el gasto, solo se le muestra en el mensaje. Dejar vacío si no hay nada raro.' },
    },
    required: ['descripcion', 'monto'],
  },
}

function construirSystemPrompt(nombreNegocio: string): string {
  return `Sos el asistente de WhatsApp de "${nombreNegocio}" en Genesis360, hablando directamente con el dueño del negocio.

Reglas:
1. Consultas de stock y precio: usá la herramienta consultar_stock_precio. Nunca inventes números — si la herramienta no trae el dato, decilo.
2. Si te cuentan que gastaron plata en algo (por texto, por audio ya transcripto, o te mandan la FOTO de un comprobante/ticket), usá la herramienta proponer_gasto para armar un BORRADOR con lo que puedas leer (descripción, monto, categoría, fecha) — nunca asumas que ya quedó guardado, eso lo confirma el usuario con un botón y después lo revisa un humano en la app.
3. Si te mandan una foto que NO es un comprobante o ticket de un gasto, no llames a proponer_gasto — explicá qué ves en la imagen y qué podés hacer con eso.
4. Si la foto SÍ es un comprobante pero NO coincide con lo que te escribieron (otro monto, otro comercio, otro concepto), igual llamá a proponer_gasto, pero usá SIEMPRE los datos que leíste en el comprobante — nunca los del texto — y explicá la discrepancia en el campo advertencia. El usuario decide con los botones; vos no elegís por él ni descartás el gasto por tu cuenta.
5. NUNCA anuncies una acción que no ejecutás en el mismo turno. Está prohibido responder cosas como "te armo el borrador" o "ya lo cargo" sin llamar a proponer_gasto en esa misma respuesta: o llamás la herramienta, o preguntás qué querés que haga. Nunca las dos cosas por separado.
6. Si la búsqueda de stock no encuentra el producto, decilo claro y sugerí probar con otro nombre o SKU.
7. Todavía no podés modificar nada directo — si te piden eso, explicá que está en camino.
8. Respuestas cortas y directas en español, estilo WhatsApp (sin markdown, sin listas largas).`
}

// Fase 3: helper único para audio e imagen. Meta entrega solo un media_id — hay que resolverlo a una
// URL temporal (mismo Bearer token que el resto de la Graph API) y después descargar los bytes de esa
// URL con el mismo token.
async function descargarMediaWhatsapp(mediaId: string, accessToken: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!metaRes.ok) throw new Error(`Meta media API ${metaRes.status}: ${await metaRes.text()}`)
  const meta = await metaRes.json()
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!fileRes.ok) throw new Error(`Meta media download ${fileRes.status}`)
  const bytes = new Uint8Array(await fileRes.arrayBuffer())
  return { bytes, mimeType: meta.mime_type ?? 'application/octet-stream' }
}

// Groq Whisper (whisper-large-v3-turbo) solo transcribe — el "cerebro" que interpreta el texto sigue
// siendo Claude Sonnet 5 vía llamarClaude, igual que un mensaje de texto normal. Reusa GROQ_API_KEY,
// que ya existe como secret en el proyecto (lo usa ai-assistant para chat).
async function transcribirAudioGroq(bytes: Uint8Array, mimeType: string, groqApiKey: string): Promise<string> {
  const form = new FormData()
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mpeg') ? 'mp3' : 'ogg'
  form.append('file', new Blob([bytes], { type: mimeType }), `audio.${ext}`)
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'es')
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqApiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Groq transcription ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return String(data.text ?? '').trim()
}

function extensionDeImagen(mimeType: string): string {
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('webp')) return 'webp'
  return 'jpg'
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

type ResultadoClaude =
  | { tipo: 'texto'; texto: string; tokensIn: number; tokensOut: number }
  | { tipo: 'proponer_gasto'; datos: { descripcion: string; monto: number; categoria: string | null; fecha: string | null; advertencia: string | null }; tokensIn: number; tokensOut: number }

async function llamarClaude(
  apiKey: string, systemPrompt: string, userContent: string | any[], supabase: any, tenantId: string,
): Promise<ResultadoClaude> {
  const messages: any[] = [{ role: 'user', content: userContent }]
  let tokensIn = 0
  let tokensOut = 0

  // Máximo 2 turnos: 1 pedido de tool + 1 respuesta final. Alcanza para los casos de uso de hoy
  // (una sola tool por mensaje, sin encadenar múltiples búsquedas/propuestas).
  for (let turno = 0; turno < 2; turno++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        system: systemPrompt,
        messages,
        tools: [TOOL_CONSULTAR_STOCK, TOOL_PROPONER_GASTO],
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
      return { tipo: 'texto', texto: texto || 'No pude armar una respuesta, probá reformular la consulta.', tokensIn, tokensOut }
    }

    if (toolUse.name === 'proponer_gasto') {
      // No devuelve tool_result — este tool corta el turno acá (side-effect real: crea un
      // borrador), no hace falta que Claude arme una segunda respuesta de texto.
      const monto = Number(toolUse.input?.monto)
      const descripcion = String(toolUse.input?.descripcion ?? '').trim()
      if (!descripcion || !Number.isFinite(monto) || monto <= 0) {
        return { tipo: 'texto', texto: 'No entendí bien el gasto — decime descripción y monto (ej: "gasté 5000 en nafta").', tokensIn, tokensOut }
      }
      return {
        tipo: 'proponer_gasto',
        datos: {
          descripcion,
          monto,
          categoria: toolUse.input?.categoria ? String(toolUse.input.categoria).trim() || null : null,
          fecha: toolUse.input?.fecha ? String(toolUse.input.fecha).trim() || null : null,
          // Solo se le muestra al usuario en el mensaje de confirmación — nunca se guarda en el
          // borrador ni termina en la descripción del gasto real (no ensuciar el registro contable).
          advertencia: toolUse.input?.advertencia ? String(toolUse.input.advertencia).trim() || null : null,
        },
        tokensIn, tokensOut,
      }
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
  return { tipo: 'texto', texto: 'No pude terminar de procesar esa consulta, probá de nuevo.', tokensIn, tokensOut }
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

async function enviarMensajeInteractivoWhatsapp(
  phoneNumberId: string, accessToken: string, to: string, bodyText: string,
  botones: { id: string; title: string }[],
) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText.slice(0, 1024) },
        action: { buttons: botones.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    }),
  })
  if (!res.ok) {
    console.error('wa-webhook: error enviando mensaje interactivo a WhatsApp', res.status, await res.text())
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
            texto_truncado: (
              msg.text?.body ?? (msg.type === 'image' && msg.image?.caption ? `[foto] ${msg.image.caption}` : `[${msg.type}]`)
            ).slice(0, 200),
          })
          if (logInErr) {
            if ((logInErr as any).code === '23505') {
              console.log('wa-webhook: mensaje ya procesado (idempotente)', messageId)
            } else {
              console.error('wa-webhook: error de idempotencia, se aborta este mensaje', logInErr)
            }
            continue
          }

          // Botón de confirmación/cancelación de un borrador de gasto (Fase 2). Nunca confía en el
          // id del botón solo: el UPDATE exige tenant_id + estado='pendiente_confirmacion' actual,
          // así que un reintento de Meta sobre el mismo botón (o un id inventado) no hace nada.
          if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
            const buttonId = String(msg.interactive.button_reply?.id ?? '')
            const sep = buttonId.indexOf(':')
            const accion = sep >= 0 ? buttonId.slice(0, sep) : ''
            const borradorId = sep >= 0 ? buttonId.slice(sep + 1) : ''

            let textoRespuesta = 'No entendí esa selección, probá de nuevo.'
            if ((accion === 'confirmar' || accion === 'cancelar') && borradorId) {
              const nuevoEstado = accion === 'confirmar' ? 'pendiente' : 'descartado'
              const { data: actualizado } = await supabase
                .from('whatsapp_gastos_borrador')
                .update({ estado: nuevoEstado })
                .eq('id', borradorId)
                .eq('tenant_id', cred.tenant_id)
                .eq('estado', 'pendiente_confirmacion')
                .select('descripcion')
                .maybeSingle()

              textoRespuesta = !actualizado
                ? 'Esa propuesta ya no está disponible (puede que ya la hayas confirmado o cancelado antes).'
                : accion === 'confirmar'
                  ? `Listo, guardé el borrador de "${actualizado.descripcion}" — alguien del equipo lo va a revisar y cargar.`
                  : 'Cancelado, no se guardó nada.'
            }

            await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from, textoRespuesta)
            await supabase.from('whatsapp_mensajes_log').insert({
              tenant_id: cred.tenant_id, message_id: `${messageId}-out`, direccion: 'out',
              texto_truncado: textoRespuesta.slice(0, 200),
            })
            continue
          }

          // Fase 3: texto/audio/imagen convergen en el mismo `userContent` que alimenta a
          // llamarClaude — audio se resuelve a texto ANTES (reemplaza a msg.text.body sin tocar el
          // pipeline), imagen se manda como bloque multimodal (Claude ya sabe leer fotos). Si el
          // mensaje era una foto y termina en proponer_gasto, esos bytes se suben como comprobante.
          let userContent: string | any[]
          let notasOrigen: string
          let imagenParaComprobante: { bytes: Uint8Array; mimeType: string } | null = null

          if (msg.type === 'text' && msg.text?.body) {
            userContent = msg.text.body
            notasOrigen = msg.text.body
          } else if (msg.type === 'audio' && msg.audio?.id) {
            try {
              const media = await descargarMediaWhatsapp(msg.audio.id, cred.access_token)
              const groqKey = Deno.env.get('GROQ_API_KEY')
              if (!groqKey) throw new Error('GROQ_API_KEY no configurado')
              const transcript = await transcribirAudioGroq(media.bytes, media.mimeType, groqKey)
              if (!transcript) throw new Error('transcripción vacía')
              userContent = transcript
              notasOrigen = `(Audio transcripto) ${transcript}`
            } catch (e: any) {
              console.error('wa-webhook: error transcribiendo audio', e.message)
              await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from,
                'No pude entender ese audio, ¿me lo podés escribir? 🙂')
              continue
            }
          } else if (msg.type === 'image' && msg.image?.id) {
            try {
              const media = await descargarMediaWhatsapp(msg.image.id, cred.access_token)
              imagenParaComprobante = media
              const caption = String(msg.image.caption ?? '').trim()
              const base64 = encodeBase64(media.bytes)
              userContent = [
                { type: 'image', source: { type: 'base64', media_type: media.mimeType, data: base64 } },
                { type: 'text', text: caption ? `El usuario mandó esta foto con el texto: "${caption}"` : 'El usuario mandó esta foto sin ningún texto adicional.' },
              ]
              notasOrigen = caption ? `(Foto) ${caption}` : '(Foto sin texto)'
            } catch (e: any) {
              console.error('wa-webhook: error descargando imagen', e.message)
              await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from,
                'No pude descargar esa foto, ¿la podés volver a mandar? 🙂')
              continue
            }
          } else {
            await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from,
              'Por ahora no puedo leer este tipo de mensaje — mandame texto, un audio o una foto de un comprobante 🙂')
            continue
          }

          const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
          if (!apiKey) {
            console.error('wa-webhook: ANTHROPIC_API_KEY no configurado')
            continue
          }

          const { data: tenantRow } = await supabase.from('tenants').select('nombre').eq('id', cred.tenant_id).maybeSingle()
          const systemPrompt = construirSystemPrompt(tenantRow?.nombre ?? 'tu negocio')

          let respuesta: ResultadoClaude
          try {
            respuesta = await llamarClaude(apiKey, systemPrompt, userContent, supabase, cred.tenant_id)
          } catch (e: any) {
            console.error('wa-webhook: error llamando a Claude', e.message)
            respuesta = { tipo: 'texto', texto: 'Tuve un problema respondiendo, probá de nuevo en un rato.', tokensIn: 0, tokensOut: 0 }
          }

          if (respuesta.tipo === 'proponer_gasto') {
            const { data: borrador, error: borradorErr } = await supabase.from('whatsapp_gastos_borrador').insert({
              tenant_id: cred.tenant_id,
              descripcion: respuesta.datos.descripcion,
              monto: respuesta.datos.monto,
              categoria: respuesta.datos.categoria,
              fecha: respuesta.datos.fecha,
              notas: notasOrigen.slice(0, 500),
              origen_telefono: from,
              mensaje_id: messageId,
            }).select('id').single()

            if (borradorErr || !borrador) {
              console.error('wa-webhook: error creando borrador de gasto', borradorErr)
              await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from, 'No pude armar el borrador, probá de nuevo.')
            } else {
              // Comprobante adjunto (Fase 3): si la propuesta vino de una foto, subirla a Storage y
              // linkearla al borrador. Nunca bloquea el borrador ya creado si falla — el humano
              // puede subir el comprobante a mano al aprobar, como siempre.
              if (imagenParaComprobante) {
                const path = `${cred.tenant_id}/wa-${borrador.id}.${extensionDeImagen(imagenParaComprobante.mimeType)}`
                const { error: upErr } = await supabase.storage.from('comprobantes-gastos')
                  .upload(path, imagenParaComprobante.bytes, { contentType: imagenParaComprobante.mimeType, upsert: true })
                if (upErr) {
                  console.error('wa-webhook: error subiendo comprobante de WhatsApp', upErr)
                } else {
                  await supabase.from('whatsapp_gastos_borrador').update({ comprobante_url: path }).eq('id', borrador.id)
                }
              }

              const resumen = `📝 ¿Guardo este borrador de gasto?\n\n${respuesta.datos.descripcion}\n💰 $${respuesta.datos.monto.toLocaleString('es-AR')}` +
                (respuesta.datos.categoria ? `\n🏷️ ${respuesta.datos.categoria}` : '') +
                (respuesta.datos.advertencia ? `\n\n⚠️ ${respuesta.datos.advertencia}` : '') +
                `\n\nOjo: esto todavía NO es un gasto real — alguien del equipo lo revisa y lo carga después.`
              await enviarMensajeInteractivoWhatsapp(phoneNumberId, cred.access_token, from, resumen, [
                { id: `confirmar:${borrador.id}`, title: '✅ Confirmar' },
                { id: `cancelar:${borrador.id}`, title: '❌ Cancelar' },
              ])
            }

            await supabase.from('whatsapp_mensajes_log').insert({
              tenant_id: cred.tenant_id, message_id: `${messageId}-out`, direccion: 'out',
              texto_truncado: 'propuesta de gasto (interactivo)', modelo: CLAUDE_MODEL,
              tokens_in: respuesta.tokensIn, tokens_out: respuesta.tokensOut,
            })
          } else {
            await enviarMensajeWhatsapp(phoneNumberId, cred.access_token, from, respuesta.texto)
            await supabase.from('whatsapp_mensajes_log').insert({
              tenant_id: cred.tenant_id, message_id: `${messageId}-out`, direccion: 'out',
              texto_truncado: respuesta.texto.slice(0, 200), modelo: CLAUDE_MODEL,
              tokens_in: respuesta.tokensIn, tokens_out: respuesta.tokensOut,
            })
          }
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
