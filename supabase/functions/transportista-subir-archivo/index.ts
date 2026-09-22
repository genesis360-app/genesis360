// transportista-subir-archivo — el transportista sube la foto o la firma de entrega desde su link.
//
// `TransportistePage` (/transporte/:token) es pública: no hay sesión, así que ninguna política de
// storage para usuarios autenticados le sirve. Decisión de GO (2026-09-14): habilitarlo con un camino
// server-side que valide el token. Esta función:
//   1. valida el token con el mismo criterio que `get_envio_by_token` (existe y no venció) y que el
//      envío no esté cerrado (entregado o cancelado);
//   2. acepta solo imágenes PNG/JPEG de hasta 5 MB (el límite del bucket);
//   3. sube con service_role a `pod/<envio_id>/…` — la ruta la arma el servidor, nunca el cliente;
//   4. devuelve una URL firmada por un año (lo mismo que la página hacía antes).
//
// `verify_jwt: false` a propósito (el transportista no tiene JWT). La autorización ES el token.
//
// Request: multipart/form-data con `token`, `tipo` ('foto' | 'firma') y `archivo`.
// Response: { url, path } · 400 datos inválidos · 404 token inválido o vencido · 409 envío cerrado.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { consumirRateLimit, ipDelCliente, respuesta429 } from '../_shared/rateLimit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'etiquetas-envios'
const MAX_BYTES = 5 * 1024 * 1024
const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' }
const UN_ANIO = 60 * 60 * 24 * 365

// Freno contra abuso por IP. El contador vive en la base (mig 432) — ver _shared/rateLimit.ts.
const LIMITE_POR_IP = 30

const responder = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const limite = await consumirRateLimit(
    supabase, 'transportista-subir-archivo', ipDelCliente(req), LIMITE_POR_IP,
  )
  if (!limite.permitido) {
    return respuesta429(limite, 'Demasiados intentos. Probá en un minuto.', corsHeaders)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return responder(400, { error: 'Se esperaba multipart/form-data' })
  }

  const token = String(form.get('token') ?? '').trim()
  const tipo = String(form.get('tipo') ?? '')
  const archivo = form.get('archivo')

  if (!token) return responder(400, { error: 'Falta el token' })
  if (tipo !== 'foto' && tipo !== 'firma') return responder(400, { error: 'Tipo inválido' })
  if (!(archivo instanceof File)) return responder(400, { error: 'Falta el archivo' })
  const extension = EXTENSION[archivo.type]
  if (!extension) return responder(400, { error: 'Solo se aceptan imágenes PNG o JPEG' })
  if (archivo.size === 0 || archivo.size > MAX_BYTES) return responder(400, { error: 'La imagen tiene que pesar hasta 5 MB' })

  const { data: envio, error: envioErr } = await supabase
    .from('envios')
    .select('id, estado, token_expira_at')
    .eq('token_transportista', token)
    .maybeSingle()
  if (envioErr) {
    console.error('[transportista-subir-archivo] buscando el envío:', envioErr.message)
    return responder(500, { error: 'No se pudo validar el envío' })
  }
  if (!envio || (envio.token_expira_at && new Date(envio.token_expira_at) < new Date())) {
    return responder(404, { error: 'El link no es válido o venció' })
  }
  if (envio.estado === 'entregado' || envio.estado === 'cancelado') {
    return responder(409, { error: 'El envío ya está cerrado' })
  }

  const path = tipo === 'firma'
    ? `pod/${envio.id}/firma_${Date.now()}.${extension}`
    : `pod/${envio.id}/${Date.now()}.${extension}`

  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, archivo, { contentType: archivo.type, upsert: false })
  if (upErr) {
    console.error('[transportista-subir-archivo] subiendo:', upErr.message)
    return responder(500, { error: 'No se pudo guardar la imagen' })
  }

  const { data: firmada, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, UN_ANIO)
  if (signErr || !firmada?.signedUrl) {
    console.error('[transportista-subir-archivo] firmando:', signErr?.message)
    return responder(500, { error: 'La imagen se guardó pero no se pudo generar el enlace' })
  }

  return responder(200, { url: firmada.signedUrl, path })
})
