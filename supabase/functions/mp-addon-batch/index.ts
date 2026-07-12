import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Configurador de add-ons BATCH con cobro por delta ───────────────────────────
// Diseño: G360.Wiki/wiki/features/configurador-addons-batch.md (decisión GO 2026-07-05).
// Espejo puro testeado: src/lib/mpAddonBatch.ts (mantener EN SYNC).
//
// El cliente arma el ESTADO FINAL deseado de packs fijos (UN pack por dimensión) —y desde
// Fase 2 (mig 260) opcionalmente el PLAN objetivo (upgrade Básico→Pro)— y confirma en batch:
//   • delta > 0  → se crea una preference de PAGO ÚNICO por la diferencia + un change
//                  'pendiente_pago'. El cobro y la aplicación los confirma mp-webhook
//                  (fail-closed: sin pago no cambia NADA).
//   • delta ≤ 0  → sin cobro ni reembolso: PUT del recurrente (fail-closed) + aplicación
//                  atómica (fn_aplicar_addon_batch). La próxima factura llega por el monto
//                  nuevo (next_payment_date del preapproval).
//   • modo 'programado' (E2, solo con cambio de plan): el change queda 'programado' para la
//                  próxima fecha de cobro — sin cobro hoy; el sweep mp-batch-sweep hace el
//                  PUT en la ventana previa y el tier se habilita al confirmarse el cobro.
//
// 🛑 REGLA #0:
//   • TODO se recalcula server-side (catálogo espejo) — ningún monto viaja del cliente.
//   • Recurrente nuevo por DELTA sobre el monto real del preapproval (preserva descuentos):
//     nuevo = montoActualMP − precio(packs actuales) + precio(packs objetivo) + deltaPlan,
//     con deltaPlan = precio del plan MP objetivo − precio del plan MP actual (GET
//     /preapproval_plan — también relativo, no pisa montos custom).
//   • Guard de baja a nivel batch: límite resultante ≥ uso activo por dimensión de estado
//     (con cambio de plan, contra la base del tier OBJETIVO).
//   • Un solo batch 'pendiente_pago' (y uno programado/en curso) por tenant (uq indexes).
//   • Downgrade de plan NO disponible acá (se diseña con MP-P2) — solo upgrade Básico→Pro.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MP = 'https://api.mercadopago.com'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Espejo server-side de ADDON_PACKS (src/config/brand.ts) — solo packs FIJOS del batch.
// ⚠ 'cuits' (multi-CUIT F6): precio PROVISORIO — GO confirma el precio final antes de PROD.
const ADDON_PACKS: Record<string, Array<{ cantidad: number; precio: number }>> = {
  sku:          [{ cantidad: 500, precio: 5000 }, { cantidad: 2000, precio: 10000 }, { cantidad: 8000, precio: 25000 }],
  sucursales:   [{ cantidad: 1, precio: 15000 }, { cantidad: 3, precio: 35000 }, { cantidad: 5, precio: 55000 }],
  usuarios:     [{ cantidad: 1, precio: 5000 }, { cantidad: 3, precio: 10000 }, { cantidad: 5, precio: 15000 }],
  comprobantes: [{ cantidad: 1000, precio: 10000 }, { cantidad: 5000, precio: 30000 }, { cantidad: 10000, precio: 50000 }],
  cuits:        [{ cantidad: 1, precio: 20000 }, { cantidad: 2, precio: 35000 }, { cantidad: 3, precio: 45000 }],
}
// Base por tier (espejo de PLAN_BASE_LIMITS / fn_plan_base_limite) — dims de ESTADO (guard).
const BASE_ESTADO: Record<string, { sku: number; sucursales: number; usuarios: number; cuits: number }> = {
  free:       { sku: 50,   sucursales: 1,  usuarios: 1,  cuits: 1 },
  basico:     { sku: 2000, sucursales: 1,  usuarios: 5,  cuits: 1 },
  pro:        { sku: 8000, sucursales: 4,  usuarios: 15, cuits: 1 },
  enterprise: { sku: -1,   sucursales: -1, usuarios: -1, cuits: -1 },
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
    const planObjetivoRaw = body?.plan_objetivo ? String(body.plan_objetivo) : null
    // E2: 'programado' agenda el cambio a la próxima fecha de cobro (solo con cambio de plan)
    const modo = body?.modo === 'programado' ? 'programado' : 'ahora'

    // ── Cancelar un cambio PROGRAMADO (E2) que todavía no entró en ventana ─────────
    // 'esperando_cobro' NO se cancela desde acá: el PUT ya salió a MP (conciliación soporte).
    if (action === 'cancelar_programado') {
      const { data: cancelado } = await admin.from('addon_batch_changes')
        .update({ estado: 'cancelado' })
        .eq('tenant_id', tenantId).eq('estado', 'programado')
        .select('id').maybeSingle()
      if (!cancelado) return json({ error: 'No hay un cambio programado para cancelar.' }, 404)
      console.log(`mp-addon-batch: tenant ${tenantId} canceló el cambio programado ${cancelado.id}`)
      return json({ ok: true })
    }

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

    // ── Cambio de PLAN (Fase 2) — validación + precios reales de los planes MP ────
    const tierActual = String(t.plan_tier ?? 'free')
    const cambiaPlan = !!planObjetivoRaw && planObjetivoRaw !== tierActual
    if (cambiaPlan && !(tierActual === 'basico' && planObjetivoRaw === 'pro')) {
      // Downgrade / free / enterprise: fuera de Fase 2 (MP-P2 pendiente)
      return json({ error: 'Por ahora solo podés subir de Básico a Pro desde acá. Para bajar de plan escribinos a soporte.' }, 400)
    }
    const planObjetivo = cambiaPlan ? 'pro' : null

    // Precios REALES de los planes de MP (canal automático con descuento): el delta de
    // plan también es relativo → un monto custom del preapproval no se pisa.
    const precioPlanMP = async (envKey: string): Promise<number | null> => {
      const planId = Deno.env.get(envKey)
      if (!planId) return null
      const r = await fetch(`${MP}/preapproval_plan/${planId}`, { headers: H })
      if (!r.ok) return null
      const j = await r.json()
      const monto = Number(j?.auto_recurring?.transaction_amount ?? 0)
      return monto > 0 ? monto : null
    }
    const [planBasicoMP, planProMP] = await Promise.all([
      precioPlanMP('MP_PLAN_BASICO'), precioPlanMP('MP_PLAN_PRO'),
    ])
    let deltaPlan = 0
    if (cambiaPlan) {
      if (planBasicoMP === null || planProMP === null) {
        return json({ error: 'No se pudieron leer los precios de los planes en Mercado Pago. Reintentá.' }, 502)
      }
      deltaPlan = planProMP - planBasicoMP
    }

    // ── Cálculo por delta (espejo calcularBatch) ──────────────────────────────────
    const suma = (packs: Pack[]) => packs.reduce((s, p) => s + (precioDe(p.dimension, p.cantidad) ?? 0), 0)
    const recurrenteNuevo = Math.max(0, montoActual - suma(packsActuales) + suma(packsObjetivo) + deltaPlan)
    const delta = recurrenteNuevo - montoActual
    const dims = ['sku', 'sucursales', 'usuarios', 'comprobantes']
    const cantidadDe = (packs: Pack[], d: string) => packs.find(p => p.dimension === d)?.cantidad ?? 0
    const sinCambios = !cambiaPlan &&
      dims.every(d => cantidadDe(packsActuales, d) === cantidadDe(packsObjetivo, d))

    // ── Guard de baja a nivel batch (espejo guardBatch) — contra el tier OBJETIVO ──
    const base = BASE_ESTADO[planObjetivo ?? tierActual] ?? BASE_ESTADO.free
    const bloqueos: Array<{ dimension: string; nuevo_limite: number; uso: number; excedente: number }> = []
    for (const dim of ['sku', 'sucursales', 'usuarios', 'cuits'] as const) {
      if (base[dim] === -1) continue
      const nuevoLimite = base[dim] + cantidadDe(packsObjetivo, dim)
      // 'cuits': el emisor DEFAULT (es_default) es el CUIT del negocio y NO consume cupo →
      // el "uso" son los emisores adicionales activos + 1 (por el default, que ocupa el base).
      let uso: number
      if (dim === 'cuits') {
        const { count } = await admin.from('emisores_fiscales').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('activo', true).eq('es_default', false)
        uso = (count ?? 0) + 1
      } else {
        const { count } = await admin.from(DIM_TABLA[dim]).select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('activo', true)
        uso = count ?? 0
      }
      if (uso > nuevoLimite) bloqueos.push({ dimension: dim, nuevo_limite: nuevoLimite, uso, excedente: uso - nuevoLimite })
    }

    // Cambio programado / en curso existente (para que la UI lo muestre y el confirm choque)
    const { data: enCurso } = await admin.from('addon_batch_changes')
      .select('id, estado, plan_objetivo, monto_recurrente_nuevo, programado_para')
      .eq('tenant_id', tenantId).in('estado', ['programado', 'esperando_cobro']).maybeSingle()

    if (action === 'preview') {
      return json({
        monto_actual: montoActual, recurrente_nuevo: recurrenteNuevo,
        delta_a_pagar: delta > 0 ? delta : 0, sin_cambios: sinCambios,
        next_payment_date: nextPaymentDate, bloqueos,
        // Fase 2: contexto de plan para la UI (toggle + total en vivo)
        plan_actual: tierActual,
        planes_mp: { basico: planBasicoMP, pro: planProMP },
        cambio_en_curso: enCurso ?? null,
      })
    }

    if (action !== 'confirmar') return json({ error: `Acción inválida: ${action}` }, 400)
    if (sinCambios) return json({ error: 'No hay cambios para confirmar.' }, 400)
    if (bloqueos.length) return json({ blocked: true, bloqueos })
    // Con un change 'esperando_cobro' el PUT ya salió a MP: no se pisa con otro batch.
    if (enCurso?.estado === 'esperando_cobro') {
      return json({ error: 'Tenés un cambio de plan en curso esperando la confirmación del cobro. Cuando se acredite vas a poder hacer nuevos cambios.' }, 409)
    }

    // Cancelar un batch pendiente anterior (checkout abandonado) o programado (E2) antes
    // de crear el nuevo — nunca dos en vuelo (los uq indexes lo garantizan igual).
    await admin.from('addon_batch_changes')
      .update({ estado: 'cancelado' }).eq('tenant_id', tenantId)
      .in('estado', ['pendiente_pago', 'programado'])

    // ── E2: upgrade PROGRAMADO a la próxima fecha de cobro (sin cobro hoy) ─────────
    if (modo === 'programado') {
      if (!cambiaPlan) return json({ error: 'El cambio programado es solo para el cambio de plan.' }, 400)
      if (!nextPaymentDate) return json({ error: 'Mercado Pago no informó tu próxima fecha de cobro. Probá el cambio inmediato.' }, 502)
      const { data: change, error: insErr } = await admin.from('addon_batch_changes').insert({
        tenant_id: tenantId, packs_objetivo: packsObjetivo, plan_objetivo: planObjetivo,
        estado: 'programado', programado_para: new Date(nextPaymentDate).toISOString(),
        monto_delta: 0, monto_recurrente_nuevo: recurrenteNuevo,
      }).select('id').single()
      if (insErr || !change) return json({ error: 'No se pudo programar el cambio. Reintentá.' }, 500)
      console.log(`mp-addon-batch: tenant ${tenantId} PROGRAMÓ upgrade → ${recurrenteNuevo} el ${nextPaymentDate} (change ${change.id})`)
      return json({ ok: true, programado: true, programado_para: nextPaymentDate, recurrente_nuevo: recurrenteNuevo })
    }

    // ── BAJA / NEUTRO: sin cobro — PUT fail-closed + aplicación atómica ───────────
    if (delta <= 0) {
      const { data: change, error: insErr } = await admin.from('addon_batch_changes').insert({
        tenant_id: tenantId, packs_objetivo: packsObjetivo, plan_objetivo: planObjetivo,
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
      tenant_id: tenantId, packs_objetivo: packsObjetivo, plan_objetivo: planObjetivo,
      monto_delta: delta, monto_recurrente_nuevo: recurrenteNuevo,
    }).select('id').single()
    if (insErr || !change) return json({ error: 'No se pudo registrar el cambio. Reintentá.' }, 500)

    const appUrl = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'
    const prefRes = await fetch(`${MP}/checkout/preferences`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{
          id: `addonbatch_${change.id}`,
          title: cambiaPlan ? 'Cambio de plan - diferencia a pagar hoy' : 'Ajuste de plan - diferencia por add-ons',
          description: `Tu suscripcion pasa a $${recurrenteNuevo.toLocaleString('es-AR')}/mes desde el proximo ciclo`,
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
