import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Catálogo de packs (ESPEJO server-side de ADDON_PACKS en src/config/brand.ts) ──
// 🛑 El precio SIEMPRE sale de acá, nunca del cliente (REGLA #0: no cobrar montos
// arbitrarios). En Fase 2 este EF solo emite el add-on TEMPORAL de movimientos
// (pago único, vence a 30d). Los add-ons FIJOS (sku/sucursales/usuarios) cambian el
// monto del preapproval MP → Fase 3, otro flujo.
const ADDON_PACKS: Record<string, { tipos: string[]; packs: Array<{ cantidad: number; precio: number }> }> = {
  sku:         { tipos: ['fijo'],             packs: [{ cantidad: 500, precio: 5000 }, { cantidad: 2000, precio: 10000 }, { cantidad: 8000, precio: 25000 }] },
  sucursales:  { tipos: ['fijo'],             packs: [{ cantidad: 1, precio: 15000 }, { cantidad: 3, precio: 35000 }, { cantidad: 5, precio: 55000 }] },
  usuarios:    { tipos: ['fijo'],             packs: [{ cantidad: 1, precio: 5000 }, { cantidad: 3, precio: 10000 }, { cantidad: 5, precio: 15000 }] },
  movimientos: { tipos: ['fijo', 'temporal'], packs: [{ cantidad: 1000, precio: 5000 }, { cantidad: 5000, precio: 10000 }, { cantidad: 20000, precio: 15000 }] },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No autorizado')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Obtener usuario autenticado
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) throw new Error('Usuario no autenticado')

    // Obtener tenant_id del usuario
    const { data: userRow, error: userRowErr } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    if (userRowErr || !userRow) throw new Error('Tenant no encontrado')

    const tenantId = userRow.tenant_id

    // ── Pack solicitado (con back-compat: sin body = 500 movimientos legacy) ──────
    // Fase 2: solo add-on TEMPORAL de movimientos por este flujo (pago único).
    const body = await req.json().catch(() => ({}))
    const dimension = String(body?.dimension ?? 'movimientos')
    const cantidad  = Number(body?.cantidad ?? 500)

    if (dimension !== 'movimientos') {
      throw new Error(`Add-on de ${dimension} no disponible en este flujo (solo movimientos)`)
    }

    // Revalidar el pack contra el catálogo server-side (precio NUNCA del cliente).
    // 500 se sigue aceptando por compatibilidad con links viejos.
    const legacy = cantidad === 500 ? { cantidad: 500, precio: 990 } : null
    const pack = legacy ?? ADDON_PACKS.movimientos.packs.find(p => p.cantidad === cantidad)
    if (!pack) throw new Error(`Pack de movimientos inválido: ${cantidad}`)

    const appUrl = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) throw new Error('MP_ACCESS_TOKEN no configurado')

    // external_reference nuevo: `${tenant}|addon|movimientos|${cantidad}|temporal`.
    // El webhook lo parsea y crea la fila en tenant_addons (tipo temporal, vence 30d).
    const externalRef = `${tenantId}|addon|movimientos|${pack.cantidad}|temporal`

    // Crear preferencia MP (pago único)
    const preferenceBody = {
      items: [{
        id: `addon_movimientos_${pack.cantidad}`,
        title: `+${pack.cantidad.toLocaleString('es-AR')} movimientos extra`,
        description: 'Pack adicional de movimientos de stock — válido por 30 días',
        quantity: 1,
        unit_price: pack.precio,
        currency_id: 'ARS',
      }],
      external_reference: externalRef,
      back_urls: {
        success: `${appUrl}/suscripcion?status=approved&type=addon`,
        failure: `${appUrl}/suscripcion?status=failure&type=addon`,
        pending: `${appUrl}/suscripcion?status=pending&type=addon`,
      },
      auto_return: 'approved',
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
      statement_descriptor: 'GENESIS360 ADDON',
    }

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferenceBody),
    })

    if (!mpRes.ok) {
      const err = await mpRes.text()
      throw new Error(`MP error ${mpRes.status}: ${err}`)
    }

    const preference = await mpRes.json()
    console.log('Preference created:', preference.id, 'for tenant:', tenantId, 'pack:', pack.cantidad)

    return new Response(JSON.stringify({ init_point: preference.init_point, id: preference.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('mp-addon error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
