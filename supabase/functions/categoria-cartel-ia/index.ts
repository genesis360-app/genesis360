// categoria-cartel-ia — B2 / Fase 5 (mig 469): la IA redacta el cartel del POS de una categoría de clientes.
//
// B-4 (GO 25/09): la IA SOLO REDACTA, al guardar la promoción (no en la venta); respaldo = plantilla fija; se le manda
// nombre de producto, categoría y %, NUNCA datos del cliente, costos ni márgenes. La llama la pantalla de la lista de
// descuentos después de guardar o importar (sin esperar: la venta nunca depende de esto). Escribe en
// `categorias_cliente.cartel_textos` las tres frases con marcadores (o NULL = plantilla) y `cartel_origen`.
//
// Validación en `_shared/cartelCategoria.ts` (copia idéntica de `src/lib/cartelCategoria.ts`): todos los marcadores,
// ninguno inventado, sin cifras ni "$"/"%". Si la IA falla o escribe algo inválido, queda la plantilla.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mensajesCartelIA, revisarTextosCartel } from '../_shared/cartelCategoria.ts'
import { consumirRateLimit, respuesta429 } from '../_shared/rateLimit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Mismos modelos que `ai-assistant` (el fallback tiene cupo separado en Groq).
const MODEL = 'openai/gpt-oss-120b'
const MODEL_FALLBACK = 'openai/gpt-oss-20b'

/** El primer objeto JSON del texto (algunos modelos lo envuelven en ```json … ```). */
function extraerJson(texto: string): unknown {
  const i = texto.indexOf('{')
  const j = texto.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try { return JSON.parse(texto.slice(i, j + 1)) } catch { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Sin sesión' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const usuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: { user } } = await usuario.auth.getUser()
  if (!user) return json({ error: 'Sin sesión' }, 401)
  const { data: perfil } = await admin.from('users').select('tenant_id, activo').eq('id', user.id).maybeSingle()
  if (!perfil?.tenant_id || perfil.activo === false) return json({ error: 'Usuario inactivo' }, 403)

  let categoriaId: string | null = null
  try { categoriaId = (await req.json())?.categoria_id ?? null } catch { /* cuerpo inválido */ }
  if (!categoriaId || !/^[0-9a-f-]{36}$/i.test(categoriaId)) return json({ error: 'Falta la categoría' }, 400)

  // Mismo permiso que editar la lista (mig 442): DUEÑO/ADMIN o los roles habilitados para gestionar categorías.
  const { data: puede } = await usuario.rpc('fn_usuario_en_roles_categoria', { p_columna: 'gestionar' })
  if (puede !== true) return json({ error: 'Tu rol no puede gestionar categorías' }, 403)

  // La categoría tiene que ser del negocio del usuario (se lee con la service_role, así que se filtra a mano).
  const { data: cat } = await admin.from('categorias_cliente').select('id, nombre, tenant_id, cartel_origen, cartel_textos')
    .eq('id', categoriaId).eq('tenant_id', perfil.tenant_id).maybeSingle()
  if (!cat) return json({ error: 'Categoría inexistente' }, 404)

  const rlUser = await consumirRateLimit(admin, 'categoria-cartel-ia:user', user.id, 20, 60)
  if (!rlUser.permitido) return respuesta429(rlUser, 'Demasiados pedidos seguidos. Esperá un minuto.', corsHeaders)
  const rlTenant = await consumirRateLimit(admin, 'categoria-cartel-ia:tenant', perfil.tenant_id, 200, 86_400)
  if (!rlTenant.permitido) return respuesta429(rlTenant, 'Se alcanzó el máximo diario de redacciones del negocio.', corsHeaders)

  const guardar = async (textos: unknown, origen: 'ia' | 'plantilla') => {
    const { error } = await admin.from('categorias_cliente')
      .update({ cartel_textos: textos, cartel_origen: origen, cartel_generado_at: new Date().toISOString() })
      .eq('id', cat.id).eq('tenant_id', perfil.tenant_id)
    if (error) throw new Error(`No se pudo guardar el cartel: ${error.message}`)
  }
  // Si la IA falla o escribe algo inválido y ya había una redacción válida, se conserva (no se pisa con la plantilla
  // por un problema pasajero). Si no había, queda registrado el intento con la plantilla.
  const fallar = async (motivo: string) => {
    if (cat.cartel_origen === 'ia' && cat.cartel_textos) return json({ origen: 'ia', motivo: `${motivo}; se mantiene la redacción anterior` })
    await guardar(null, 'plantilla')
    return json({ origen: 'plantilla', motivo })
  }

  // Datos para la IA: SOLO producto y % de la lista (B-4). Nada del cliente, del costo ni del margen.
  const { data: filas } = await admin.from('categoria_cliente_descuentos')
    .select('descuento_pct, productos(nombre)')
    .eq('categoria_id', cat.id).eq('tenant_id', perfil.tenant_id).gt('descuento_pct', 0)
    .order('descuento_pct', { ascending: false }).limit(5)
  const ejemplos = (filas ?? [])
    .map((f: any) => ({ producto: String(f.productos?.nombre ?? '').slice(0, 80), pct: Number(f.descuento_pct) }))
    .filter(e => e.producto)

  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) return await fallar('IA no configurada')

  const base = mensajesCartelIA(String(cat.nombre).slice(0, 80), ejemplos)
  const llamar = (model: string, messages: { role: string; content: string }[]) => fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    // Modelos de razonamiento: esfuerzo medio (con bajo las frases salían telegráficas) y cupo de tokens holgado para
    // que alcance para la respuesta. Timeout: si Groq no
    // contesta en 15 s, queda lo que había (la pantalla no se queda esperando).
    body: JSON.stringify({ model, temperature: 0.3, max_tokens: 1200, reasoning_effort: 'medium', response_format: { type: 'json_object' }, messages }),
    signal: AbortSignal.timeout(15_000),
  })
  const pedir = async (messages: { role: string; content: string }[]): Promise<string | null> => {
    let res = await llamar(MODEL, messages)
    if (!res.ok && (res.status === 429 || res.status >= 500)) res = await llamar(MODEL_FALLBACK, messages)
    if (!res.ok) { console.error('Groq', res.status, await res.text()); return null }
    return String((await res.json()).choices?.[0]?.message?.content ?? '')
  }

  try {
    const primera = await pedir(base)
    if (primera === null) return await fallar('La IA no respondió')
    let revision = revisarTextosCartel(extraerJson(primera))
    // Un solo reintento, diciéndole qué corregir. Si tampoco sirve, queda la plantilla.
    if ('motivo' in revision) {
      const segunda = await pedir([...base, { role: 'assistant', content: primera },
        { role: 'user', content: `No cumple las reglas: ${revision.motivo}. Devolvé el JSON corregido completo.` }])
      if (segunda !== null) revision = revisarTextosCartel(extraerJson(segunda))
    }
    if ('motivo' in revision) {
      console.warn('categoria-cartel-ia: texto inválido —', revision.motivo)
      return await fallar('La IA escribió un texto que no cumple las reglas')
    }
    await guardar(revision.textos, 'ia')
    return json({ origen: 'ia', textos: revision.textos })
  } catch (e) {
    console.error('categoria-cartel-ia', e)
    try { return await fallar('Error al redactar') } catch { return json({ error: 'No se pudo guardar el cartel' }, 500) }
  }
})
