import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Configurador de add-ons BATCH con cobro por delta ───────────────────────────
// Diseño: G360.Wiki/wiki/features/configurador-addons-batch.md (decisión GO 2026-07-05).
// Espejo puro testeado: src/lib/mpAddonBatch.ts (mantener EN SYNC).
//
// El cliente arma el ESTADO FINAL deseado de packs fijos (UN pack por dimensión) y confirma
// en batch:
//   • delta > 0  → se crea una preference de PAGO ÚNICO por la diferencia + un change
//                  'pendiente_pago'. El cobro y la aplicación los confirma mp-webhook
//                  (fail-closed: sin pago no cambia NADA).
//   • delta ≤ 0  → sin cobro ni reembolso: PUT del recurrente (fail-closed) + aplicación
//                  atómica (fn_aplicar_addon_batch). La próxima factura llega por el monto
//                  nuevo (next_payment_date del preapproval).
//
// 🛑 REGLA #0:
//   • TODO se recalcula server-side (catálogo espejo) — ningún monto viaja del cliente.
//   • Recurrente nuevo por DELTA sobre el monto real del preapproval (preserva descuentos):
//     nuevo = montoActualMP − precio(packs fijos actuales) + precio(packs objetivo).
//   • Guard de baja a nivel batch: límite resultante ≥ uso activo por dimensión de estado.
//   • Un solo batch 'pendiente_pago' por tenant (uq index) — sin dobles cobros concurrentes.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MP = 'https://api.mercadopago.com'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Espejo server-side de ADDON_PACKS (src/config/brand.ts) — solo packs FIJOS del batch.
const ADDON_PACKS: Record<string, Array<{ cantidad: number; precio: number }>> = {
  sku:          [{ cantidad: 500, precio: 5000 }, { cantidad: 2000, precio: 10000 }, { cantidad: 8000, precio: 25000 }],
  sucursales:   [{ cantidad: 1, precio: 15000 }, { cantidad: 3, precio: 35000 }, { cantidad: 5, precio: 55000 }],
  usuarios:     [{ cantidad: 1, precio: 5000 }, { cantidad: 3, precio: 10000 }, { cantidad: 5, precio: 15000 }],
  comprobantes: [{ cantidad: 1000, precio: 10000 }, { cantidad: 5000, precio: 30000 }, { cantidad: 10000, precio: 50000 }],
}
// Base por tier (espejo de PLAN_BASE_LIMITS / fn_plan_base_limite) — dims de ESTADO (guard).
const BASE_ESTADO: Record<string, { sku: number; sucursales: number; usuarios: number }> = {
  free:       { sku: 50,   sucursales: 1,  usuarios: 1 },
  basico:     { sku: 2000, sucursales: 1,  usuarios: 5 },
  pro:        { sku: 8000, sucursales: 4,  usuarios: 15 },
  enterprise: { sku: -1,   sucursales: -1, usuarios: -1 },
}
const DIM_TABLA: Record<string, string> = { sku: 'productos', usuarios: 'users', sucursales: 'sucursales' }

type Pack = { dimension: string; cantidad: number }
const precioDe = (dimension: string, cantidad: number): number | null =>
  ADDON_PACKS[dimension]?.find(p => p.cantidad === cantidad)?.precio ?? null

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'No autorizado' }, 401)
    const { data: userRow } = await userClient.from('users').select('tenant_id, rol').eq('id', user.id).single()
    const tenantId = userRow?.tenant_id
    if (!tenantId) return json({ error: 'Tenant no encontrado' }, 400)
    // Cambios de plan/facturación: solo el DUEÑO (mismo criterio que cancelar).
    if (userRow?.rol !== 'DUEÑO' && userRow?.rol !== 'ADMIN') {
      return json({ error: 'Solo el dueño puede modificar el plan.' }, 403)
    }

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)
    const H = { Authorization: `Bearer ${mpToken}` }
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action ?? '')
    const packsObjetivoRaw: Pack[] = Array.isArray(body?.packs_objetivo) ? body.packs_objetivo : []

    // ── Validar el objetivo contra el catálogo (una entrada por dimensión, pack real) ──
    const packsObjetivo: Pack[] = []
    const vistos = new Set<string>()
    for (const p of packsObjetivoRaw) {
      const dimension = String(p?.dimension ?? '')
      const cantidad = Number(p?.cantidad ?? 0)
      if (cantidad === 0) continue                      // 0 = sin pack en esa dimensión
      if (vistos.has(dimension)) return json({ error: `Dimensión repetida: ${dimension}` }, 400)
      if (precioDe(dimension, cantidad) === null) return json({ error: `Pack inválido: ${dimension} ${cantidad}` }, 400)
      vistos.add(dimension)
      packsObjetivo.push({ dimension, cantidad })
    }

    // ── Estado actual: tenant + packs fijos + preapproval ─────────────────────────
    const { data: t } = await admin.from('tenants')
      .select('subscription_status, mp_subscription_id, plan_tier').eq('id', tenantId).single()
    if (t?.subscription_status !== 'active' || !t?.mp_subscription_id) {
      return json({ error: 'Necesitás una suscripción activa para modificar tu plan.' }, 400)
    }
    const { data: fijosRows } = await admin.from('tenant_addons')
      .select('dimension, cantidad').eq('tenant_id', tenantId).eq('tipo', 'fijo')
    const packsActuales: Pack[] = (fijosRows ?? []) as Pack[]

    const getRes = await fetch(`${MP}/preapproval/${t.mp_subscription_id}`, { headers: H })
    if (!getRes.ok) return json({ error: 'No se pudo leer la suscripción en Mercado Pago' }, 502)
    const pre = await getRes.json()
    const montoActual = Number(pre?.auto_recurring?.transaction_amount ?? 0)
    if (!(montoActual > 0)) return json({ error: 'Monto de suscripción inválido en MP' }, 502)
    const nextPaymentDate = pre?.next_payment_date ?? pre?.summarized?.next_payment_date ?? null

    // ── Cálculo por delta (espejo calcularBatch) ──────────────────────────────────
    const suma = (packs: Pack[]) => packs.reduce((s, p) => s + (precioDe(p.dimension, p.cantidad) ?? 0), 0)
    const recurrenteNuevo = Math.max(0, montoActual - suma(packsActuales) + suma(packsObjetivo))
    const delta = recurrenteNuevo - montoActual
    const dims = ['sku', 'sucursales', 'usuarios', 'comprobantes']
    const cantidadDe = (packs: Pack[], d: string) => packs.find(p => p.dimension === d)?.cantidad ?? 0
    const sinCambios = dims.every(d => cantidadDe(packsActuales, d) === cantidadDe(packsObjetivo, d))

    // ── Guard de baja a nivel batch (espejo guardBatch) ───────────────────────────
    const base = BASE_ESTADO[t.plan_tier ?? 'free'] ?? BASE_ESTADO.free
    const bloqueos: Array<{ dimension: string; nuevo_limite: number; uso: number; excedente: number }> = []
    for (const dim of ['sku', 'sucursales', 'usuarios'] as const) {
      if (base[dim] === -1) continue
      const nuevoLimite = base[dim] + cantidadDe(packsObjetivo, dim)
      const { count } = await admin.from(DIM_TABLA[dim]).select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('activo', true)
      const uso = count ?? 0
      if (uso > nuevoLimite) bloqueos.push({ dimension: dim, nuevo_limite: nuevoLimite, uso, excedente: uso - nuevoLimite })
    }

    if (action === 'preview') {
      return json({
        monto_actual: montoActual, recurrente_nuevo: recurrenteNuevo,
        delta_a_pagar: delta > 0 ? delta : 0, sin_cambios: sinCambios,
        next_payment_date: nextPaymentDate, bloqueos,
      })
    }

    if (action !== 'confirmar') return json({ error: `Acción inválida: ${action}` }, 400)
    if (sinCambios) return json({ error: 'No hay cambios para confirmar.' }, 400)
    if (bloqueos.length) return json({ blocked: true, bloqueos })

    // Cancelar un batch pendiente anterior (quedó de un checkout abandonado) antes de crear
    // el nuevo — nunca dos pendientes (uq index lo garantiza igual, esto lo hace amable).
    await admin.from('addon_batch_changes')
      .update({ estado: 'cancelado' }).eq('tenant_id', tenantId).eq('estado', 'pendiente_pago')

    // ── BAJA / NEUTRO: sin cobro — PUT fail-closed + aplicación atómica ───────────
    if (delta <= 0) {
      const { data: change, error: insErr } = await admin.from('addon_batch_changes').insert({
        tenant_id: tenantId, packs_objetivo: packsObjetivo,
        monto_delta: 0, monto_recurrente_nuevo: recurrenteNuevo,
      }).select('id').single()
      if (insErr || !change) return json({ error: 'No se pudo registrar el cambio. Reintentá.' }, 500)

      const putRes = await fetch(`${MP}/preapproval/${t.mp_subscription_id}`, {
        method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_recurring: { transaction_amount: recurrenteNuevo, currency_id: 'ARS' } }),
      })
      if (!putRes.ok) {
        await admin.from('addon_batch_changes')
          .update({ estado: 'fallido', error_detalle: `PUT ${putRes.status}` }).eq('id', change.id)
        console.error('mp-addon-batch: PUT baja falló', putRes.status, await putRes.text())
        return json({ error: 'Mercado Pago no confirmó el cambio. No se modificó nada.' }, 502)
      }
      const { data: aplicado, error: rpcErr } = await admin
        .rpc('fn_aplicar_addon_batch', { p_tenant_id: tenantId, p_change_id: change.id })
      if (rpcErr || aplicado !== true) {
        // MP ya cobra menos y los add-ons no se sincronizaron → favorable al cliente pero
        // es drift: avisar fuerte para conciliación (no revertimos un monto menor).
        console.error('mp-addon-batch: fn_aplicar falló tras PUT', rpcErr)
        return json({ error: 'El monto se actualizó pero no pudimos registrar los add-ons. Contactá soporte.' }, 500)
      }
      console.log(`mp-addon-batch: tenant ${tenantId} BAJA aplicada → recurrente ${recurrenteNuevo}`)
      return json({ ok: true, recurrente_nuevo: recurrenteNuevo, next_payment_date: nextPaymentDate })
    }

    // ── SUBA: preference de pago único por el delta; aplica el webhook al pagar ───
    const { data: change, error: insErr } = await admin.from('addon_batch_changes').insert({
      tenant_id: tenantId, packs_objetivo: packsObjetivo,
      monto_delta: delta, monto_recurrente_nuevo: recurrenteNuevo,
    }).select('id').single()
    if (insErr || !change) return json({ error: 'No se pudo registrar el cambio. Reintentá.' }, 500)

    const appUrl = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'
    const prefRes = await fetch(`${MP}/checkout/preferences`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{
          id: `addonbatch_${change.id}`,
          title: 'Ajuste de plan — diferencia por add-ons',
          description: `Tu suscripción pasa a $${recurrenteNuevo.toLocaleString('es-AR')}/mes desde el próximo ciclo`,
          quantity: 1, unit_price: delta, currency_id: 'ARS',
        }],
        external_reference: `${tenantId}|addonbatch|${change.id}`,
        back_urls: {
          success: `${appUrl}/suscripcion?status=approved&type=addonbatch&change_id=${change.id}`,
          failure: `${appUrl}/suscripcion?status=failure&type=addonbatch&change_id=${change.id}`,
          pending: `${appUrl}/suscripcion?status=pending&type=addonbatch&change_id=${change.id}`,
        },
        auto_return: 'approved',
        notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
        statement_descriptor: 'GENESIS360 PLAN',
      }),
    })
    if (!prefRes.ok) {
      await admin.from('addon_batch_changes').update({ estado: 'cancelado' }).eq('id', change.id)
      console.error('mp-addon-batch: preference falló', prefRes.status, await prefRes.text())
      return json({ error: 'No se pudo iniciar el pago en Mercado Pago. Reintentá.' }, 502)
    }
    const preference = await prefRes.json()
    await admin.from('addon_batch_changes').update({ mp_preference_id: preference.id }).eq('id', change.id)
    console.log(`mp-addon-batch: tenant ${tenantId} SUBA delta ${delta} → change ${change.id} (pref ${preference.id})`)
    return json({
      ok: true, init_point: preference.init_point, change_id: change.id,
      delta_a_pagar: delta, recurrente_nuevo: recurrenteNuevo,
    })
  } catch (e) {
    console.error('mp-addon-batch error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
