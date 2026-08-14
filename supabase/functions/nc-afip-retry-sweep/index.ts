import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// NC electrónica AFIP automática (relevamiento Ventas A10, retomado 2026-08-13). Cuando el intento
// automático que dispara VentasPage.tsx al confirmar una devolución facturada falla, queda encolado
// en `nc_afip_pendientes` (mig 359). Este sweep (GitHub Actions cada 15 min — no hay pg_cron en el
// proyecto) reintenta, con una regla de seguridad estricta:
//
// 🛑 REGLA #0 — NUNCA reintentar ciegamente. `emitir-factura/index.ts` marca con la frase literal
// "NO reintentar" los dos casos donde AFIP pudo haber autorizado el comprobante aunque nosotros no
// tengamos el CAE (error de transporte a mitad de la llamada al WSFE, o CAE autorizado pero la
// persistencia en `devoluciones.nc_cae` falló) — reintentar esos casos puede emitir una NC
// DUPLICADA en AFIP (plata real regalada al cliente dos veces). Si el error contiene esa frase, el
// sweep DEJA de tocar esa fila y escala a reconciliación manual (notifica a DUEÑO/CONTADOR con el
// detalle para que concilien contra el "último autorizado" de AFIP antes de que nadie reintente).
// Mismo criterio si se agotan los reintentos "seguros" (MAX_INTENTOS) sin éxito.
//
// Llama a `emitir-factura` con el SERVICE_ROLE_KEY como Authorization — la EF ya tiene ese camino
// contemplado (línea "esServiceRole" en emitir-factura/index.ts) para flujos internos como este.

const MAX_INTENTOS = 8
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function notificarTenant(admin: any, tenantId: string, titulo: string, mensaje: string) {
  const { data: sups } = await admin.from('users').select('id')
    .eq('tenant_id', tenantId).in('rol', ['DUEÑO', 'SUPER_USUARIO', 'CONTADOR'])
  for (const s of sups ?? []) {
    await admin.from('notificaciones').insert({
      tenant_id: tenantId, user_id: s.id, tipo: 'nc_afip_pendiente', titulo, mensaje, action_url: '/ventas',
    })
    const { data: au } = await admin.auth.admin.getUserById(s.id)
    const email = au?.user?.email
    if (!email) continue
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'notificacion', to: email, data: { titulo, mensaje, action_url: '/ventas' } }),
    }).catch(() => {})
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const { data: pendientes, error: qErr } = await admin.from('nc_afip_pendientes')
      .select('id, tenant_id, devolucion_id, venta_id, tipo_comprobante, punto_venta, intentos, ultimo_error, notificado_at')
      .is('resuelto_at', null).eq('requiere_reconciliacion_manual', false)
    if (qErr) throw new Error(`nc_afip_pendientes: ${qErr.message}`)

    let emitidas = 0, escaladas = 0, reintentadas = 0
    const errores: string[] = []

    const escalar = async (pend: any, motivo: string) => {
      await admin.from('nc_afip_pendientes')
        .update({ requiere_reconciliacion_manual: true, ultimo_error: motivo, notificado_at: new Date().toISOString() })
        .eq('id', pend.id)
      if (!pend.notificado_at) {
        await notificarTenant(admin, pend.tenant_id,
          '⚠️ NC electrónica AFIP requiere revisión manual',
          `No se pudo confirmar automáticamente si una NC quedó autorizada en AFIP (posible duplicado). Antes de reintentar, verificá el "último autorizado" en AFIP para el punto de venta ${pend.punto_venta} (${pend.tipo_comprobante}). Detalle: ${motivo}`)
      }
    }

    for (const p of pendientes ?? []) {
      try {
        // Ya venía marcado con un error "NO reintentar" desde el intento original — escalar directo,
        // sin gastar un intento nuevo contra AFIP.
        if (p.ultimo_error?.includes('NO reintentar')) {
          await escalar(p, p.ultimo_error)
          escaladas++
          continue
        }
        if (p.intentos >= MAX_INTENTOS) {
          await escalar(p, `Se agotaron ${MAX_INTENTOS} reintentos automáticos sin éxito. Último error: ${p.ultimo_error ?? 'desconocido'}`)
          escaladas++
          continue
        }

        const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/emitir-factura`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venta_id: p.venta_id, tenant_id: p.tenant_id,
            tipo_comprobante: p.tipo_comprobante, punto_venta: p.punto_venta, devolucion_id: p.devolucion_id,
          }),
        })
        const body = await res.json().catch(() => ({}))

        if (res.ok && !body.error) {
          await admin.from('nc_afip_pendientes').update({ resuelto_at: new Date().toISOString() }).eq('id', p.id)
          await notificarTenant(admin, p.tenant_id,
            'NC electrónica emitida automáticamente',
            `La NC pendiente de la devolución quedó emitida — CAE: ${body.cae ?? '(ver detalle en Ventas)'}.`)
          emitidas++
          continue
        }

        const msg = String(body?.error ?? `HTTP ${res.status}`)
        if (msg.includes('NO reintentar')) {
          await escalar(p, msg)
          escaladas++
        } else {
          await admin.from('nc_afip_pendientes').update({ intentos: p.intentos + 1, ultimo_error: msg }).eq('id', p.id)
          reintentadas++
        }
      } catch (err: any) {
        errores.push(`${p.id}: ${err.message}`)
      }
    }

    return json({
      ok: true, evaluados: (pendientes ?? []).length, emitidas, reintentadas, escaladas, errores,
      ran_at: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('nc-afip-retry-sweep error:', err)
    return json({ ok: false, error: err.message }, 500)
  }
})
