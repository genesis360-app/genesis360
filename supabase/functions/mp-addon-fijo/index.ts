import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ─── Add-ons FIJOS (recurrentes) — Pricing 2026 Fase 3 ────────────────────────
// Un add-on fijo (SKU / sucursales / usuarios / movimientos) se cobra MES A MES → hay
// que cambiar el monto de la SUSCRIPCIÓN MP en vivo (PUT /preapproval con
// auto_recurring.transaction_amount). Usa el enfoque DELTA: lee el monto actual del
// preapproval y le suma/resta el precio del pack → preserva el descuento del plan base.
//
// 🛑 REGLA #0 (plata):
//   • El precio SIEMPRE sale del catálogo server-side, NUNCA del cliente.
//   • Fail-closed en ALTA: si el PUT a MP falla, NO se otorga el add-on (nada de upgrade
//     gratis). Solo se inserta la fila tenant_addons si MP confirmó el nuevo monto.
//   • Downgrade GUIADO (BAJA): revalida server-side que el uso NO quede sobre el nuevo
//     límite (el usuario debe DESACTIVAR recursos antes; para SKU: desactivar ≠ eliminar).
//
// ⚠️ NO deployado / NO activado hasta que GO: (1) reconfigure los planes base de MP a
//    $60k/$100k, (2) valide el flujo en sandbox (no hay e2e acá). Mismo criterio que el
//    adapter dual-provider AFIP.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Espejo server-side de ADDON_PACKS (src/config/brand.ts). Precio SIEMPRE de acá.
const ADDON_PACKS: Record<string, { tipos: string[]; packs: Array<{ cantidad: number; precio: number }> }> = {
  sku:         { tipos: ['fijo'],             packs: [{ cantidad: 500, precio: 5000 }, { cantidad: 2000, precio: 10000 }, { cantidad: 8000, precio: 25000 }] },
  sucursales:  { tipos: ['fijo'],             packs: [{ cantidad: 1, precio: 15000 }, { cantidad: 3, precio: 35000 }, { cantidad: 5, precio: 55000 }] },
  usuarios:    { tipos: ['fijo'],             packs: [{ cantidad: 1, precio: 5000 }, { cantidad: 3, precio: 10000 }, { cantidad: 5, precio: 15000 }] },
  movimientos: { tipos: ['fijo', 'temporal'], packs: [{ cantidad: 1000, precio: 5000 }, { cantidad: 5000, precio: 10000 }, { cantidad: 20000, precio: 15000 }] },
}

// dimension → tabla de recursos ACTIVOS (para el guard de downgrade). movimientos es
// flujo (tope soft) → no se guardea la baja.
const DIM_TABLA: Record<string, string> = { sku: 'productos', usuarios: 'users', sucursales: 'sucursales' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'No autorizado' }, 401)

    const { data: userRow } = await userClient.from('users').select('tenant_id').eq('id', user.id).single()
    const tenantId = userRow?.tenant_id
    if (!tenantId) return json({ error: 'Tenant no encontrado' }, 400)

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action ?? '')      // 'agregar' | 'quitar'
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // La suscripción MP del tenant (necesaria para cambiar el monto recurrente).
    const { data: tenantRow } = await admin
      .from('tenants').select('mp_subscription_id, subscription_status').eq('id', tenantId).single()
    const preapprovalId = tenantRow?.mp_subscription_id
    if (!preapprovalId || tenantRow?.subscription_status !== 'active') {
      return json({ error: 'Necesitás una suscripción activa para agregar o quitar add-ons.' }, 400)
    }

    // Monto recurrente actual del preapproval (base para el cálculo delta).
    const getRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    })
    if (!getRes.ok) return json({ error: 'No se pudo leer la suscripción en Mercado Pago' }, 502)
    const sub = await getRes.json()
    const montoActual = Number(sub?.auto_recurring?.transaction_amount ?? 0)
    if (!(montoActual > 0)) return json({ error: 'Monto de suscripción inválido en MP' }, 502)

    // ── ALTA de add-on fijo ───────────────────────────────────────────────────
    if (action === 'agregar') {
      const dimension = String(body?.dimension ?? '')
      const cantidad  = Number(body?.cantidad ?? 0)
      const dim = ADDON_PACKS[dimension]
      if (!dim || !dim.tipos.includes('fijo')) return json({ error: `Dimensión inválida: ${dimension}` }, 400)
      const pack = dim.packs.find(p => p.cantidad === cantidad)
      if (!pack) return json({ error: `Pack inválido: ${dimension} ${cantidad}` }, 400)

      const nuevoMonto = montoActual + pack.precio

      // Cambiar el monto recurrente en MP ANTES de otorgar (fail-closed).
      const putRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_recurring: { transaction_amount: nuevoMonto, currency_id: 'ARS' } }),
      })
      if (!putRes.ok) {
        const t = await putRes.text()
        console.error('mp-addon-fijo: PUT monto falló', putRes.status, t)
        return json({ error: 'No se pudo actualizar el monto en Mercado Pago. No se cobró ni se agregó el add-on.' }, 502)
      }

      const { data: inserted, error: insErr } = await admin.from('tenant_addons').insert({
        tenant_id: tenantId, dimension, cantidad, tipo: 'fijo', vence_at: null,
      }).select('id').single()
      if (insErr) {
        // 🛑 MP ya cobra el monto nuevo pero no pudimos registrar el add-on → revertir el
        // monto en MP para no cobrar de más (best-effort) + avisar para conciliación.
        console.error('mp-addon-fijo: insert tenant_addons falló tras subir monto MP', insErr)
        await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_recurring: { transaction_amount: montoActual, currency_id: 'ARS' } }),
        }).catch(() => {})
        return json({ error: 'No se pudo registrar el add-on. Se revirtió el monto; reintentá.' }, 500)
      }

      console.log(`mp-addon-fijo: tenant ${tenantId} +${cantidad} ${dimension} fijo · monto ${montoActual}→${nuevoMonto}`)
      return json({ ok: true, addon_id: inserted.id, monto_mensual: nuevoMonto })
    }

    // ── BAJA de add-on fijo (downgrade guiado) ──────────────────────────────────
    if (action === 'quitar') {
      const addonId = String(body?.addon_id ?? '')
      if (!addonId) return json({ error: 'Falta addon_id' }, 400)

      const { data: addon } = await admin.from('tenant_addons')
        .select('id, dimension, cantidad, tipo').eq('id', addonId).eq('tenant_id', tenantId).maybeSingle()
      if (!addon || addon.tipo !== 'fijo') return json({ error: 'Add-on fijo no encontrado' }, 404)

      const pack = ADDON_PACKS[addon.dimension]?.packs.find(p => p.cantidad === addon.cantidad)
      const precio = pack?.precio ?? 0

      // Guard de downgrade guiado (solo dimensiones de ESTADO; movimientos es soft).
      const tabla = DIM_TABLA[addon.dimension]
      if (tabla) {
        const { data: efectivo } = await admin.rpc('fn_tenant_limite', { p_tenant_id: tenantId, p_dim: addon.dimension })
        const limiteEfectivo = Number(efectivo ?? 0)   // incluye el add-on que se quiere quitar
        if (limiteEfectivo !== -1) {
          const nuevoLimite = limiteEfectivo - addon.cantidad
          const { count } = await admin.from(tabla).select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId).eq('activo', true)
          const uso = count ?? 0
          if (uso > nuevoLimite) {
            // No es un error de servidor: es la señal del downgrade guiado (el usuario
            // debe desactivar recursos primero). 200 con flag para que el cliente lo lea fácil.
            return json({
              blocked: true,
              reason: 'downgrade',
              excedente: uso - nuevoLimite,
              nuevo_limite: nuevoLimite,
              uso,
              dimension: addon.dimension,
            })
          }
        }
      }

      const nuevoMonto = Math.max(0, montoActual - precio)
      const putRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_recurring: { transaction_amount: nuevoMonto, currency_id: 'ARS' } }),
      })
      if (!putRes.ok) {
        const t = await putRes.text()
        console.error('mp-addon-fijo: PUT baja monto falló', putRes.status, t)
        return json({ error: 'No se pudo actualizar el monto en Mercado Pago. No se quitó el add-on.' }, 502)
      }

      const { error: delErr } = await admin.from('tenant_addons').delete().eq('id', addonId).eq('tenant_id', tenantId)
      if (delErr) {
        console.error('mp-addon-fijo: delete tenant_addons falló tras bajar monto MP', delErr)
        return json({ error: 'Se ajustó el monto pero no se pudo quitar el add-on. Contactá soporte.' }, 500)
      }

      console.log(`mp-addon-fijo: tenant ${tenantId} -${addon.cantidad} ${addon.dimension} fijo · monto ${montoActual}→${nuevoMonto}`)
      return json({ ok: true, monto_mensual: nuevoMonto })
    }

    return json({ error: `Acción inválida: ${action}` }, 400)
  } catch (e) {
    console.error('mp-addon-fijo error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
