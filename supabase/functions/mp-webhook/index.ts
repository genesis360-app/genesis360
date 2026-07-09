import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
}

// preapproval_plan_id (MP) → tier del plan. plan_tier es la FUENTE DE VERDAD de los
// límites (fn_tenant_limite, mig 251); usePlanLimits ya no infiere por max_users. Los
// legacy max_users/max_productos se setean al valor BASE del tier solo por consistencia
// (AdminPage / tipos), NO gobiernan límites.
const MP_PLAN_TIER: Record<string, 'basico' | 'pro'> = {
  [Deno.env.get('MP_PLAN_BASICO') ?? '']: 'basico',
  [Deno.env.get('MP_PLAN_PRO')    ?? '']: 'pro',
}
const TIER_BASE: Record<string, { max_users: number; max_productos: number }> = {
  basico: { max_users: 5,  max_productos: 2000 },
  pro:    { max_users: 15, max_productos: 8000 },
}

// Espejo Deno de src/lib/addons.ts (las EF no importan del bundle del frontend).
// external_reference de add-on: `${tenantId}|addon|${dimension}|${cantidad}|${tipo}`.
type ParsedAddonRef = { tenantId: string; dimension: string; cantidad: number; tipo: string }
function parseAddonRef(ref: string): ParsedAddonRef | null {
  const parts = ref.split('|')
  if (parts.length !== 5 || parts[1] !== 'addon') return null
  const [tenantId, , dimension, cantidadStr, tipo] = parts
  const cantidad = Number(cantidadStr)
  if (!tenantId) return null
  if (!Number.isInteger(cantidad) || cantidad <= 0) return null
  if (!['sku', 'comprobantes', 'sucursales', 'usuarios', 'movimientos'].includes(dimension)) return null
  if (!['fijo', 'temporal'].includes(tipo)) return null
  return { tenantId, dimension, cantidad, tipo }
}

/**
 * Asienta un ingreso_informativo en caja por un cobro MP de una venta YA existente
 * (reserva/saldo cobrado por QR/link). No afecta el saldo de efectivo (es informativo,
 * para el arqueo). Requiere una sesión de caja OPERATIVA abierta (excluye la Bóveda).
 * REGLA #0: si no hay caja abierta, no se asienta (no se puede contra una caja cerrada)
 * pero se loguea para conciliación manual; el saldo de la venta SÍ queda conciliado.
 */
async function asentarIngresoInformativoMp(
  supabase: any,
  tenantId: string,
  venta: { id: string; sucursal_id: string | null; numero: number | null },
  monto: number,
): Promise<void> {
  if (!(monto > 0.01)) return
  let q = supabase.from('caja_sesiones')
    .select('id, cajas(es_caja_fuerte)')
    .eq('tenant_id', tenantId)
    .eq('estado', 'abierta')
  if (venta.sucursal_id) q = q.eq('sucursal_id', venta.sucursal_id)
  const { data: sesiones } = await q
  // Excluir la Bóveda/Caja Fuerte (igual que el POS) — solo cajas operativas
  const operativas = (sesiones ?? []).filter((s: any) => !s.cajas?.es_caja_fuerte)
  const sesionId = operativas[0]?.id
  if (!sesionId) {
    console.warn(`mp-webhook: sin caja operativa abierta para venta ${venta.id} (sucursal ${venta.sucursal_id ?? 'NULL'}) — ingreso informativo NO asentado (saldo de venta SÍ conciliado)`)
    return
  }
  const { error } = await supabase.from('caja_movimientos').insert({
    tenant_id:  tenantId,
    sesion_id:  sesionId,
    tipo:       'ingreso_informativo',
    concepto:   `[Mercado Pago] Venta #${venta.numero ?? ''}`.trim(),
    monto,
  })
  if (error) console.error('mp-webhook: error asentando ingreso_informativo en caja', error)
}

// WH-SIG: validación de firma HMAC-SHA256 del webhook, formato documentado por MP
// (header `x-signature: ts=...,v1=...` + `x-request-id` + `data.id` de la query string).
// Manifest: `id:{data.id};request-id:{x-request-id};ts:{ts};` firmado con el secret de
// firma del panel de MP (MP_WEBHOOK_SECRET — DISTINTO de MP_ACCESS_TOKEN/MP_CLIENT_SECRET).
async function verificarFirmaMp(req: Request, secret: string): Promise<{ valid: boolean; reason?: string }> {
  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id')
  if (!xSignature || !xRequestId) return { valid: false, reason: 'faltan headers x-signature/x-request-id' }

  const parts = Object.fromEntries(
    xSignature.split(',').map(p => p.trim().split('=').map(s => s.trim())),
  ) as Record<string, string>
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return { valid: false, reason: 'x-signature mal formado' }

  const url = new URL(req.url)
  const dataId = (url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '').toLowerCase()
  if (!dataId) return { valid: false, reason: 'sin data.id en query string' }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest))
  const computed = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === v1 ? { valid: true } : { valid: false, reason: 'hash no coincide' }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    // WH-SIG (2026-07-08) — modo LOG-ONLY a propósito: MP_WEBHOOK_SECRET (el secret de
    // firma del panel de MP, no configurado todavía) falta cargarse en Supabase. Mientras
    // tanto solo se loguea el resultado, nunca se bloquea el webhook — pasar a bloqueante
    // (early return 401 si !valid) recién cuando los logs muestren `OK` consistente contra
    // tráfico real de MP.
    const webhookSecret = Deno.env.get('MP_WEBHOOK_SECRET')
    if (webhookSecret) {
      const firma = await verificarFirmaMp(req, webhookSecret)
      console.log('MP Webhook firma:', firma.valid ? 'OK' : `INVALIDA (${firma.reason})`)
    }

    const body = await req.text()
    const event = JSON.parse(body)

    console.log('MP Webhook received:', event.type, event.data?.id, 'user_id:', event.user_id)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    const { type, data } = event

    // ── Suscripciones ────────────────────────────────────────────────────────
    if (type === 'subscription_preapproval' || type === 'preapproval') {
      const subscriptionId = data?.id
      if (!subscriptionId) throw new Error('No subscription id')

      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      })
      const subscription = await mpRes.json()
      console.log('Subscription status:', subscription.status, 'plan:', subscription.preapproval_plan_id)

      let newStatus: string
      switch (subscription.status) {
        case 'authorized': newStatus = 'active'; break
        case 'cancelled':  newStatus = 'cancelled'; break
        case 'paused':     newStatus = 'inactive'; break
        case 'pending':    newStatus = 'trial'; break
        default:           newStatus = 'inactive'
      }

      // external_reference viene VACÍO en checkouts por plan (MP no lo persiste). Si no
      // vino, resolvemos el tenant por el preapproval ya LINKEADO (mp_subscription_id, que
      // guarda mp-verificar-suscripcion al activar), así los eventos siguientes (cambios
      // de estado, cancelación desde el panel de MP) igual sincronizan la DB.
      let tenantId = subscription.external_reference || null
      if (!tenantId) {
        const { data: t } = await supabase
          .from('tenants').select('id').eq('mp_subscription_id', subscriptionId).maybeSingle()
        tenantId = t?.id ?? null
      }
      if (tenantId) {
        // Fase 2 (mig 260): tras un upgrade de plan el preapproval sigue apuntando al plan
        // MP ORIGINAL (solo cambió el monto) → si el tenant ya está linkeado a ESTA misma
        // suscripción con un tier pago en DB, el tier de DB es la fuente de verdad y NO se
        // pisa con el que se deriva del preapproval_plan_id (solo vale para el link inicial).
        const { data: tRow } = await supabase.from('tenants')
          .select('plan_tier, mp_subscription_id, subscription_period_end').eq('id', tenantId).maybeSingle()
        const tierDB = String(tRow?.plan_tier ?? '')
        const mismaSubConTier = tRow?.mp_subscription_id === subscriptionId &&
          ['basico', 'pro', 'enterprise'].includes(tierDB)
        const tier = mismaSubConTier ? undefined : MP_PLAN_TIER[subscription.preapproval_plan_id]
        // MP-C9 (grace period) también en el camino webhook: si el usuario cancela DESDE EL
        // PANEL DE MP (sin pasar por cancel-suscripcion), el acceso igual perdura hasta el
        // fin del período pagado. next_payment_date viene en el propio preapproval; fallback
        // now()+30d SOLO si el tenant no tenía ya un period_end (no extender en re-entregas).
        let periodEndUpdate: Record<string, unknown> = {}
        if (newStatus === 'cancelled') {
          const npd = subscription?.next_payment_date ?? subscription?.summarized?.next_payment_date
          const d = npd ? new Date(npd) : null
          if (d && !isNaN(d.getTime())) {
            periodEndUpdate = { subscription_period_end: d.toISOString() }
          } else if (!tRow?.subscription_period_end) {
            periodEndUpdate = { subscription_period_end: new Date(Date.now() + 30 * 86400000).toISOString() }
          }
        } else if (newStatus === 'active') {
          // Al (re)activar, limpiar el grace de una cancelación anterior (higiene MP-C9).
          periodEndUpdate = { subscription_period_end: null }
        }
        await supabase.from('tenants').update({
          subscription_status: newStatus,
          mp_subscription_id: subscriptionId,
          ...periodEndUpdate,
          ...(newStatus === 'active' && tier ? {
            plan_tier: tier,
            max_users: TIER_BASE[tier].max_users,
            max_productos: TIER_BASE[tier].max_productos,
          } : {}),
        }).eq('id', tenantId)
        console.log(`Tenant ${tenantId} → ${newStatus}`, tier ?? '(sin tier)')
      }
    }

    // ── Pagos ────────────────────────────────────────────────────────────────
    if (type === 'payment') {
      const paymentId = data?.id
      if (!paymentId) throw new Error('No payment id')

      // Determinar si es pago de un seller conectado (venta) o de plataforma
      const sellerId: number | undefined = event.user_id
      let sellerCred: { tenant_id: string; access_token: string } | null = null

      if (sellerId) {
        const { data: sc } = await supabase
          .from('mercadopago_credentials')
          .select('tenant_id, access_token')
          .eq('seller_id', String(sellerId))
          .eq('conectado', true)
          .maybeSingle()
        sellerCred = sc ?? null
      }

      const tokenToUse = sellerCred?.access_token ?? mpToken
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      })
      const payment = await mpRes.json()
      console.log('Payment status:', payment.status, 'ref:', payment.external_reference, 'seller:', !!sellerCred)

      if (payment.status === 'approved' && payment.external_reference) {
        const ref: string = payment.external_reference

        if (sellerCred) {
          // ── Pago de VENTA de un seller conectado ────────────────────────
          const monto = Number(payment.transaction_amount ?? 0)
          const releaseDate = payment.money_release_date
            ? new Date(payment.money_release_date).toISOString()
            : null
          const isUUID = /^[0-9a-f-]{36}$/i.test(ref)

          // Buscar la venta por id (external_reference = venta.id UUID)
          const { data: venta } = isUUID
            ? await supabase
                .from('ventas')
                .select('id, total, monto_pagado, estado, numero, sucursal_id')
                .eq('id', ref)
                .eq('tenant_id', sellerCred.tenant_id)
                .maybeSingle()
            : { data: null }

          if (venta) {
            // Idempotencia: insertar el log PRIMERO. El UNIQUE(tenant,integracion,external_id)
            // garantiza que un reintento de MP (envía varias notificaciones) no re-procese el
            // pago. Si el insert falla por algo distinto a duplicado, abortamos sin tocar plata.
            const logKey = `mp-payment-${paymentId}`
            const { error: logErr } = await supabase.from('ventas_externas_logs').insert({
              tenant_id:           sellerCred.tenant_id,
              integracion:         'MercadoPago',
              webhook_external_id: logKey,
              venta_id:            venta.id,
              payload_raw:         { payment_id: paymentId, monto, venta_id: venta.id, money_release_date: releaseDate },
            })
            if (logErr) {
              if ((logErr as any).code === '23505') {
                console.log('Pago MP ya procesado (idempotente):', logKey)
              } else {
                console.error('mp-webhook: no se pudo registrar idempotencia — abortando para no duplicar plata', logErr)
                throw new Error(`idempotencia ventas_externas_logs: ${logErr.message}`)
              }
            } else {
              // Conciliar el saldo de la venta (cap al total) + asentar caja informativa.
              const montoNuevo = Math.min((venta.monto_pagado ?? 0) + monto, venta.total ?? 0)
              const { error: updErr } = await supabase.from('ventas').update({
                id_pago_externo:    String(paymentId),
                money_release_date: releaseDate,
                monto_pagado:       montoNuevo,
              }).eq('id', venta.id)
              if (updErr) console.error('mp-webhook: error actualizando venta', updErr)
              else console.log(`Venta ${venta.id}: monto_pagado ${venta.monto_pagado} → ${montoNuevo}`)

              await asentarIngresoInformativoMp(supabase, sellerCred.tenant_id, venta, monto)
            }
          } else if (isUUID) {
            // Venta aún no existe (venta directa con pre-venta UUID): el webhook llegó antes
            // de finalizar. Guardamos el pago para que registrarVenta lo aplique al finalizar
            // (que es donde se asienta la caja según el medio del carrito).
            console.log('Venta no existe aún, guardando pago pre-venta:', ref)
            const { error: preErr } = await supabase.from('ventas_externas_logs').insert({
              tenant_id:           sellerCred.tenant_id,
              integracion:         'MercadoPago',
              webhook_external_id: `mp-preventa-${ref}`,
              payload_raw:         { payment_id: paymentId, monto, pre_venta_id: ref, money_release_date: releaseDate },
            })
            if (preErr && (preErr as any).code !== '23505') console.error('mp-webhook: error guardando pago pre-venta', preErr)
          }
        } else if (ref.includes('|addonbatch|')) {
          // ── BATCH de add-ons FIJOS pagado (delta): aplicar el cambio ─────────────
          // (diseño: wiki/features/configurador-addons-batch.md). El cliente pagó la
          // DIFERENCIA como pago único → recién ahora: (1) PUT del recurrente nuevo,
          // (2) sync atómico de tenant_addons + plan_tier si el batch incluía upgrade de
          // plan (fn_aplicar_addon_batch, mig 260).
          // Idempotente: claim por mp_payment_id (uq index) — reintentos de MP no re-aplican.
          const [batchTenantId, , changeId] = ref.split('|')
          const { data: claimed } = await supabase.from('addon_batch_changes')
            .update({ mp_payment_id: String(paymentId) })
            .eq('id', changeId).eq('tenant_id', batchTenantId)
            .eq('estado', 'pendiente_pago').is('mp_payment_id', null)
            .select('id, monto_recurrente_nuevo').maybeSingle()
          if (!claimed) {
            console.log(`addonbatch ${changeId}: ya procesado o inexistente (idempotente)`)
          } else {
            // 🛑 El cliente YA PAGÓ: cualquier falla de acá en más es prioridad máxima de
            // conciliación (estado 'fallido' + email a soporte) — nunca silenciosa.
            const marcarFallido = async (detalle: string) => {
              console.error(`addonbatch ${changeId} FALLIDO tras pago ${paymentId}: ${detalle}`)
              await supabase.from('addon_batch_changes')
                .update({ estado: 'fallido', error_detalle: detalle }).eq('id', changeId)
              const rk = Deno.env.get('RESEND_API_KEY')
              if (rk) {
                await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${rk}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    from: 'Genesis360 <noreply@genesis360.pro>', to: ['soporte@genesis360.pro'],
                    subject: `🛑 Batch de add-ons PAGADO sin aplicar — tenant ${batchTenantId}`,
                    html: `<p>El pago <b>${paymentId}</b> del batch <b>${changeId}</b> (tenant ${batchTenantId}) se acreditó pero el cambio NO se aplicó: <b>${detalle}</b>.</p><p>Resolver a mano: verificar el monto del preapproval en MP y la tabla addon_batch_changes.</p>`,
                  }),
                }).catch(() => {})
              }
            }
            const { data: bt } = await supabase.from('tenants')
              .select('mp_subscription_id').eq('id', batchTenantId).maybeSingle()
            const preId = bt?.mp_subscription_id
            if (!preId) {
              await marcarFallido('tenant sin mp_subscription_id')
            } else {
              const putRes = await fetch(`https://api.mercadopago.com/preapproval/${preId}`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ auto_recurring: { transaction_amount: Number(claimed.monto_recurrente_nuevo), currency_id: 'ARS' } }),
              })
              if (!putRes.ok) {
                await marcarFallido(`PUT preapproval ${putRes.status}: ${await putRes.text()}`)
              } else {
                const { data: aplicado, error: rpcErr } = await supabase
                  .rpc('fn_aplicar_addon_batch', { p_tenant_id: batchTenantId, p_change_id: changeId })
                if (rpcErr || aplicado !== true) {
                  await marcarFallido(`fn_aplicar_addon_batch: ${rpcErr?.message ?? 'devolvió false'}`)
                } else {
                  console.log(`addonbatch ${changeId} APLICADO: tenant ${batchTenantId} → recurrente ${claimed.monto_recurrente_nuevo}`)
                }
              }
            }
          }
        } else if (ref.includes('|manualpago|')) {
          // ── Pago único de un tenant en modo MANUAL ("Pagar ahora") ───────────────
          // Plan aprobado 2026-07-08. Idempotente por mp_payment_id (uq index, mig 262):
          // un reintento de MP no extiende el acceso dos veces (fn_registrar_pago_manual
          // aborta con unique_violation, código 23505, si ya se procesó este paymentId).
          const [manualTenantId] = ref.split('|')
          const monto = Number(payment.transaction_amount ?? 0)
          const { data: hasta, error: rpcErr } = await supabase.rpc('fn_registrar_pago_manual', {
            p_tenant_id: manualTenantId, p_monto: monto, p_medio: 'tarjeta_mp',
            p_referencia: null, p_registrado_por: null,
            p_mp_payment_id: String(paymentId), p_notas: null,
          })
          if (rpcErr) {
            if ((rpcErr as any).code === '23505') {
              console.log(`manualpago: pago ${paymentId} ya procesado (idempotente)`)
            } else {
              console.error(`manualpago: fn_registrar_pago_manual falló para tenant ${manualTenantId}`, rpcErr)
            }
          } else {
            console.log(`manualpago: tenant ${manualTenantId} pagó $${monto}, acceso hasta ${hasta}`)
            const { data: tRow } = await supabase.from('tenants').select('nombre').eq('id', manualTenantId).maybeSingle()
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/emitir-factura-plataforma`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                monto, origen_pago: 'mp_manual', tenant_origen_id: manualTenantId,
                payment_ref: String(paymentId),
                concepto: `Suscripción Genesis360 — ${tRow?.nombre ?? manualTenantId} — pago manual`,
              }),
            }).catch(e => console.error('manualpago: emitir-factura-plataforma falló', e))
          }
        } else {
          // ── Pago de PLATAFORMA (suscripción / add-on) ───────────────────
          const addon = parseAddonRef(ref)
          if (addon && addon.tipo === 'temporal') {
            // Add-on TEMPORAL (Fase 2, hoy solo movimientos): fila en tenant_addons
            // que vence a 30d del pago. Idempotente por mp_payment_id (uq index, mig 253):
            // MP reenvía notificaciones → un reintento no acredita de más (REGLA #0).
            const vence = new Date(Date.now() + 30 * 86400000).toISOString()
            const { error: insErr } = await supabase.from('tenant_addons').insert({
              tenant_id:     addon.tenantId,
              dimension:     addon.dimension,
              cantidad:      addon.cantidad,
              tipo:          'temporal',
              vence_at:      vence,
              mp_payment_id: String(paymentId),
            })
            if (insErr) {
              if ((insErr as any).code === '23505') {
                console.log('Add-on temporal ya acreditado (idempotente):', paymentId)
              } else {
                console.error('mp-webhook: error insertando add-on temporal', insErr)
                throw new Error(`tenant_addons: ${insErr.message}`)
              }
            } else {
              console.log(`Tenant ${addon.tenantId} +${addon.cantidad} ${addon.dimension} (temporal, vence ${vence})`)
            }
          } else if (ref.endsWith('|addon_movimientos')) {
            // Back-compat: links de pago viejos (pack fijo de 500, columna legacy).
            const tenantId = ref.replace('|addon_movimientos', '')
            const { data: tenantRow } = await supabase.from('tenants')
              .select('addon_movimientos').eq('id', tenantId).single()
            const actual = tenantRow?.addon_movimientos ?? 0
            await supabase.from('tenants').update({
              addon_movimientos: actual + 500,
            }).eq('id', tenantId)
            console.log(`Tenant ${tenantId} addon_movimientos: ${actual} → ${actual + 500}`)
          } else {
            await supabase.from('tenants').update({
              subscription_status: 'active',
            }).eq('id', ref)
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('Webhook error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
