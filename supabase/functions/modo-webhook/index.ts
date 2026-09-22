import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

/**
 * MODO Webhook Handler — ISS-072
 *
 * Recibe notificaciones de pago de MODO y actualiza la venta correspondiente.
 *
 * Formato esperado del payload MODO:
 * {
 *   event_type: "payment.approved" | "payment.rejected" | "payment.pending",
 *   payment_id: string,
 *   merchant_order_id: string,  // nuestro venta_id (UUID)
 *   amount: number,             // en centavos
 *   currency: "ARS",
 *   status: "approved" | "rejected" | "pending",
 *   timestamp: string
 * }
 *
 * No requiere JWT — MODO envía sin auth de usuario.
 *
 * ⚠️ AUDITORÍA DE SEGURIDAD 2026-09-20 — esto ANTES decía que verificaba autenticidad contra
 * `modo_credentials`, y era falso: no había una sola línea que lo hiciera (la única mención a
 * `modo_credentials` en todo el archivo era un comentario). Cualquiera que conociera el UUID de
 * una venta podía postear `{status:"approved", amount:<lo que quiera>}` sin credencial alguna y
 * dejar la venta marcada como pagada por el importe que eligiera. Eso mueve plata y cuenta
 * corriente → REGLA #0. Al 2026-09-20 no había ningún tenant con MODO conectado (0 filas en
 * `modo_credentials`), así que no hubo explotación posible en la práctica.
 *
 * Ahora se exige MODO_WEBHOOK_SECRET (header `x-modo-signature`) y el monto NUNCA sale del
 * body: se usa el total de nuestra propia venta.
 *
 * 📌 PENDIENTE cuando MODO se active de verdad con un cliente: reemplazar el secreto compartido
 * por la verificación nativa de MODO y, sobre todo, RE-CONSULTAR el pago a la API de MODO antes
 * de escribir, como ya hace `mp-ipn` con MercadoPago. El secreto compartido es el piso, no el techo.
 */

// Comparación en tiempo constante (no filtra el secreto byte a byte por timing).
function secretoValido(recibido: string, esperado: string): boolean {
  if (!recibido || !esperado || recibido.length !== esperado.length) return false
  let diff = 0
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i)
  return diff === 0
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-modo-signature',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // GUARD-AUTENTICIDAD: sin secreto configurado la función queda cerrada a propósito. Es el
  // estado seguro: hoy no hay ningún tenant con MODO conectado, así que no rompe nada, y
  // obliga a configurarlo bien antes del primer uso real.
  const modoSecret = Deno.env.get('MODO_WEBHOOK_SECRET') ?? ''
  if (!modoSecret) {
    console.error('modo-webhook: falta MODO_WEBHOOK_SECRET — se rechaza (no se puede autenticar el aviso)')
    return new Response(JSON.stringify({ error: 'Webhook mal configurado' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!secretoValido(req.headers.get('x-modo-signature') ?? '', modoSecret)) {
    console.warn('modo-webhook: firma ausente o invalida — descartado')
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders })
  }

  const { event_type, payment_id, merchant_order_id, amount, status } = body

  // Validar campos requeridos
  if (!payment_id || !merchant_order_id) {
    return new Response(JSON.stringify({ error: 'payment_id y merchant_order_id son requeridos' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // El merchant_order_id es nuestro venta_id (UUID)
  const ventaId = merchant_order_id

  // Idempotencia: verificar si este payment_id ya fue procesado
  const { data: logExistente } = await supabase
    .from('ventas_externas_logs')
    .select('id')
    .eq('integracion', 'MODO')
    .eq('webhook_external_id', payment_id)
    .maybeSingle()

  if (logExistente) {
    return new Response(JSON.stringify({ ok: true, msg: 'ya procesado' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Buscar el tenant a partir de la venta o del prefijo de preventa
  let tenantId: string | null = null
  let ventaExiste = false

  // Intentar buscar la venta real
  const { data: ventaData } = await supabase
    .from('ventas')
    .select('tenant_id, estado, total')
    .eq('id', ventaId)
    .maybeSingle()

  if (ventaData) {
    tenantId = ventaData.tenant_id
    ventaExiste = true
  } else {
    // Pre-venta: buscar en modo_credentials por cualquier tenant que use ese payment_id
    // (fallback: el webhook llega antes de que se cree la venta)
    console.log(`modo-webhook: venta ${ventaId} no encontrada en DB — puede ser pre-venta`)
  }

  // Solo procesar pagos aprobados
  const aprobado = status === 'approved' || event_type === 'payment.approved'

  if (aprobado && ventaExiste && ventaData) {
    // El monto NO sale del body. `amount` lo controla quien postea; el total de la venta lo
    // pusimos nosotros. Si no coinciden, se registra y NO se escribe: un pago por un importe
    // distinto al de la venta es una discrepancia para revisar a mano, no algo a asentar solo.
    const montoAvisado = typeof amount === 'number' ? amount / 100 : null
    const totalVenta = Number(ventaData.total)
    if (montoAvisado !== null && Math.abs(montoAvisado - totalVenta) > 0.01) {
      console.error(
        `modo-webhook: DISCREPANCIA de monto en venta ${ventaId} — MODO avisa ${montoAvisado}, ` +
        `la venta es ${totalVenta}. No se asienta el pago.`,
      )
      return new Response(JSON.stringify({ error: 'Monto no coincide con la venta' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Actualizar venta: marcar pago externo recibido
    const { error: updateErr } = await supabase
      .from('ventas')
      .update({
        id_pago_externo: payment_id,
        monto_pagado:    totalVenta,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', ventaId)

    if (updateErr) {
      console.error('modo-webhook: error actualizando venta', updateErr)
    }
  }

  // Registrar en log de idempotencia
  if (tenantId) {
    await supabase.from('ventas_externas_logs').insert({
      tenant_id:           tenantId,
      integracion:         'MODO',
      webhook_external_id: payment_id,
      venta_id:            ventaExiste ? ventaId : null,
      payload_raw:         body,
    })
  } else {
    // Sin tenant conocido: igual guardar con tenant_id nulo no es posible (NOT NULL)
    // Loguear para diagnóstico
    console.warn('modo-webhook: no se encontró tenant para payment_id', payment_id, 'venta_id', ventaId)
  }

  return new Response(JSON.stringify({ ok: true, aprobado }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
