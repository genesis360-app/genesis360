// ISS-174 — Edge Function courier-api: cotizar / generar / tracking de envíos por courier.
//
// Seguridad: las credenciales de courier (courier_credenciales.credenciales) se leen
// SOLO acá con service_role; nunca viajan al front. El usuario se autentica por JWT y se
// resuelve su tenant_id; las credenciales se filtran por ese tenant.
//
// Body: { action: 'cotizar'|'generar'|'tracking'|'probar', ... }
//   cotizar  → { courier, origen_cp, destino_cp, peso_kg, largo_cm?, ancho_cm?, alto_cm?, valor_declarado? }
//   generar  → { envio_id, codigo_servicio? }
//   tracking → { envio_id }
//   probar   → { courier }  (valida credenciales con el paso de auth más barato; no genera nada)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { andreani } from './andreani.ts'
import { correo } from './correo.ts'
import { oca } from './oca.ts'
import { CourierAdapter, CourierCred, CourierError, GenerarParams } from './types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADAPTERS: Record<string, CourierAdapter> = {
  'Andreani': andreani,
  'Correo Argentino': correo,
  'OCA': oca,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Auth → tenant
  const { data: { user } } = await createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
  ).auth.getUser(req.headers.get('Authorization')?.replace('Bearer ', '') ?? '')
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const { data: userData } = await admin.from('users').select('tenant_id').eq('id', user.id).single()
  if (!userData) return json({ error: 'Tenant no encontrado' }, 404)
  const tenantId = userData.tenant_id

  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'Body inválido' }, 400) }
  const action = payload?.action
  // Log de entrada (sin credenciales): qué acción, qué courier, qué tenant.
  console.log(`[courier-api] → action=${action ?? '—'} courier=${payload?.courier ?? '—'} tenant=${tenantId}`)

  // requireActivo=false para "probar": se valida aunque el courier esté inactivo
  // (el dueño puede testear las claves antes de marcarlo activo).
  async function credsFor(courier: string, requireActivo = true): Promise<{ adapter: CourierAdapter; cred: CourierCred }> {
    const adapter = ADAPTERS[courier]
    if (!adapter) throw new CourierError(`Courier "${courier}" no soporta cotización por API.`)
    const { data: row } = await admin
      .from('courier_credenciales')
      .select('credenciales, activo')
      .eq('tenant_id', tenantId).eq('courier', courier).maybeSingle()
    if (!row) throw new CourierError(`${courier} no tiene credenciales configuradas. Cargalas en Config → Envíos.`)
    if (requireActivo && !row.activo) throw new CourierError(`${courier} está inactivo. Activalo en Config → Envíos.`)
    return { adapter, cred: (row.credenciales ?? {}) as CourierCred }
  }

  try {
    // ── COTIZAR ──────────────────────────────────────────────────────────────
    if (action === 'cotizar') {
      const { courier, origen_cp, destino_cp, peso_kg, largo_cm, ancho_cm, alto_cm, valor_declarado } = payload
      if (!courier) return json({ error: 'Falta el courier.' }, 400)
      if (!origen_cp || !destino_cp) return json({ error: 'Faltan códigos postales de origen/destino.' }, 400)
      const { adapter, cred } = await credsFor(courier)
      const opciones = await adapter.cotizar(cred, {
        origen_cp: String(origen_cp), destino_cp: String(destino_cp),
        peso_kg: Number(peso_kg) || 1,
        largo_cm: largo_cm ? Number(largo_cm) : undefined,
        ancho_cm: ancho_cm ? Number(ancho_cm) : undefined,
        alto_cm: alto_cm ? Number(alto_cm) : undefined,
        valor_declarado: valor_declarado ? Number(valor_declarado) : undefined,
      })
      return json({ opciones })
    }

    // ── GENERAR ──────────────────────────────────────────────────────────────
    if (action === 'generar') {
      const envioId = payload.envio_id
      if (!envioId) return json({ error: 'Falta envio_id.' }, 400)

      const { data: envio } = await admin.from('envios')
        .select('*').eq('id', envioId).eq('tenant_id', tenantId).maybeSingle()
      if (!envio) return json({ error: 'Envío no encontrado.' }, 404)
      if (!envio.courier || !ADAPTERS[envio.courier]) return json({ error: 'El envío no tiene un courier con API.' }, 400)

      const { adapter, cred } = await credsFor(envio.courier)

      // Origen: sucursal
      const { data: suc } = await admin.from('sucursales')
        .select('direccion, codigo_postal').eq('id', envio.sucursal_id).maybeSingle()
      // Destino: domicilio estructurado o descripción libre
      let destino: any = { codigo_postal: '' }
      if (envio.destino_id) {
        const { data: dom } = await admin.from('cliente_domicilios')
          .select('calle, numero, ciudad, provincia, codigo_postal').eq('id', envio.destino_id).maybeSingle()
        if (dom) destino = { calle: dom.calle, numero: dom.numero, localidad: dom.ciudad, provincia: dom.provincia, codigo_postal: dom.codigo_postal ?? '' }
      }
      if (!destino.codigo_postal) return json({ error: 'El destino no tiene código postal. Cargalo en el domicilio del cliente.' }, 400)
      if (!suc?.codigo_postal) return json({ error: 'La sucursal de origen no tiene código postal. Cargalo en Sucursales.' }, 400)

      // Destinatario desde la venta vinculada
      let destinatario = { nombre: 'Cliente', email: '', telefono: '', documento: '' }
      if (envio.venta_id) {
        const { data: venta } = await admin.from('ventas').select('cliente_id').eq('id', envio.venta_id).maybeSingle()
        if (venta?.cliente_id) {
          const { data: cli } = await admin.from('clientes')
            .select('nombre, email, telefono, documento').eq('id', venta.cliente_id).maybeSingle()
          if (cli) destinatario = { nombre: cli.nombre ?? 'Cliente', email: cli.email ?? '', telefono: cli.telefono ?? '', documento: cli.documento ?? '' }
        }
      }

      const params: GenerarParams = {
        servicio: envio.servicio ?? undefined,
        codigo_servicio: payload.codigo_servicio ?? envio.cotizacion_json?.elegida?.codigo_servicio,
        origen: { calle: suc?.direccion ?? '', codigo_postal: suc?.codigo_postal ?? '' },
        destino,
        bulto: {
          peso_kg: Number(envio.peso_kg) || 1,
          largo_cm: envio.largo_cm ? Number(envio.largo_cm) : undefined,
          ancho_cm: envio.ancho_cm ? Number(envio.ancho_cm) : undefined,
          alto_cm: envio.alto_cm ? Number(envio.alto_cm) : undefined,
          valor_declarado: envio.costo_cotizado ? Number(envio.costo_cotizado) : undefined,
        },
        destinatario,
      }
      const r = await adapter.generar(cred, params)

      await admin.from('envios').update({
        tracking_number: r.tracking_number ?? envio.tracking_number,
        tracking_url: r.tracking_url ?? envio.tracking_url,
        etiqueta_url: r.etiqueta_url ?? envio.etiqueta_url,
        courier_orden_id: r.courier_orden_id,
        costo_real: r.costo_real ?? envio.costo_real,
        cotizado_api: true,
        updated_at: new Date().toISOString(),
      }).eq('id', envioId)

      return json({ resultado: r })
    }

    // ── TRACKING ─────────────────────────────────────────────────────────────
    if (action === 'tracking') {
      const envioId = payload.envio_id
      if (!envioId) return json({ error: 'Falta envio_id.' }, 400)
      const { data: envio } = await admin.from('envios')
        .select('courier, tracking_number').eq('id', envioId).eq('tenant_id', tenantId).maybeSingle()
      if (!envio) return json({ error: 'Envío no encontrado.' }, 404)
      if (!envio.tracking_number) return json({ error: 'El envío no tiene número de tracking.' }, 400)
      const { adapter, cred } = await credsFor(envio.courier)
      const r = await adapter.tracking(cred, envio.tracking_number)
      return json({ tracking: r })
    }

    // ── PROBAR CREDENCIALES ───────────────────────────────────────────────────
    // Hace solo el paso de auth/login más barato del courier (sin cotizar ni generar).
    if (action === 'probar') {
      const { courier } = payload
      if (!courier) return json({ error: 'Falta el courier.' }, 400)
      const { adapter, cred } = await credsFor(courier, false)
      const resultado = await adapter.probar(cred)
      console.log(`[courier-api] probar ${courier} → OK`)
      return json({ resultado })
    }

    return json({ error: 'Acción no soportada.' }, 400)
  } catch (e) {
    if (e instanceof CourierError) {
      console.warn(`[courier-api] CourierError (action=${action}, courier=${payload?.courier ?? '—'}): ${e.message}`)
      return json({ error: e.message }, 400)
    }
    console.error(`[courier-api] error interno (action=${action}, courier=${payload?.courier ?? '—'})`, e)
    return json({ error: 'Error interno al contactar el courier.' }, 500)
  }
})
