import type { SupabaseClient } from '@supabase/supabase-js'
import { planificarCobranzaFIFO } from '@/lib/ccLogic'

/**
 * Cobranza de cuenta corriente — distribución FIFO sobre las ventas CC pendientes
 * del cliente (más antigua primero). Reusado por la ficha del cliente (ClientesPage),
 * el POS (VentasPage) y Caja (CajaCobranzasCC) para que las 3 vías se comporten igual (B5).
 *
 * Auditoría 2026-06-11 — la cobranza ahora SÍ impacta la caja: si el método es
 * Efectivo y hay una sesión de caja resoluble, registra un `ingreso` real (entra
 * al arqueo); si es otro método, registra un `ingreso_informativo` (no afecta saldo,
 * igual que los medios no-efectivo de una venta). Si no hay caja abierta, devuelve
 * `cajaRegistrada: false` para que el caller avise (el efectivo entró al cajón y
 * ningún arqueo lo va a contar).
 */

export interface MovimientoCajaCobranza {
  tipo: 'ingreso' | 'ingreso_informativo'
  concepto: string
}

/**
 * Decide el movimiento de caja para una cobranza CC (lógica pura, testeable).
 * Efectivo → ingreso real (suma al arqueo). Otro método → ingreso_informativo.
 * Método vacío → null (sin movimiento).
 */
export function movimientoCajaCobranza(metodo: string, clienteNombre?: string | null): MovimientoCajaCobranza | null {
  const m = (metodo ?? '').trim()
  if (!m) return null
  const sufijo = clienteNombre?.trim() ? ` — ${clienteNombre.trim()}` : ''
  if (m.toLowerCase() === 'efectivo') return { tipo: 'ingreso', concepto: `Cobranza CC${sufijo}` }
  return { tipo: 'ingreso_informativo', concepto: `[${m}] Cobranza CC${sufijo}` }
}

/**
 * Resuelve a qué sesión de caja abierta imputar la cobranza:
 * 1º la sesión propia del usuario; 2º la única abierta del tenant.
 * Varias abiertas y ninguna propia → null (ambiguo, no se adivina).
 */
export async function resolverSesionCajaCobranza(
  supabase: SupabaseClient,
  tenantId: string,
  usuarioId?: string | null,
): Promise<string | null> {
  const { data } = await supabase.from('caja_sesiones')
    .select('id, usuario_id')
    .eq('tenant_id', tenantId)
    .eq('estado', 'abierta')
  const abiertas = data ?? []
  if (abiertas.length === 0) return null
  const propia = usuarioId ? abiertas.find((s: any) => s.usuario_id === usuarioId) : null
  if (propia) return propia.id
  if (abiertas.length === 1) return abiertas[0].id
  return null
}

export async function cobrarDeudaCCFIFO(
  supabase: SupabaseClient,
  args: {
    tenantId: string; clienteId: string; monto: number; metodo: string
    /** Contexto opcional para registrar el movimiento de caja de la cobranza */
    usuarioId?: string | null
    clienteNombre?: string | null
    /** Sesión de caja explícita (ej: la caja seleccionada en el POS); si falta se auto-resuelve */
    sesionCajaId?: string | null
    /** Cuenta de origen para el ingreso_informativo de métodos no-efectivo */
    cuentaOrigenId?: string | null
  },
): Promise<{ aplicado: number; ventasSaldadas: number; cajaRegistrada: boolean; requiereCaja: boolean }> {
  const { tenantId, clienteId, monto, metodo, usuarioId, clienteNombre, sesionCajaId, cuentaOrigenId } = args
  if (!(monto > 0)) return { aplicado: 0, ventasSaldadas: 0, cajaRegistrada: false, requiereCaja: false }

  // EFECTIVO: exigir una caja imputable ANTES de saldar. Si no hay, NO tocamos la deuda
  // (devolvemos requiereCaja) — de lo contrario el efectivo entra al cajón, ningún arqueo
  // lo cuenta y la deuda queda saldada sin respaldo (cash perdido). Bug reportado 2026-06-16.
  const esEfectivo = (metodo ?? '').trim().toLowerCase() === 'efectivo'
  let sesionId: string | null = sesionCajaId ?? null
  if (esEfectivo) {
    if (!sesionId) sesionId = await resolverSesionCajaCobranza(supabase, tenantId, usuarioId)
    if (!sesionId) return { aplicado: 0, ventasSaldadas: 0, cajaRegistrada: false, requiereCaja: true }
  }

  const { data: ventas } = await supabase
    .from('ventas')
    .select('id, total, monto_pagado, estado, medio_pago, created_at')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', clienteId)
    .eq('es_cuenta_corriente', true)
    .in('estado', ['despachada', 'facturada'])
    .order('created_at', { ascending: true })

  // Reparto FIFO puro (lógica testeable en ccLogic.ts); las ventas vienen ordenadas asc.
  const { updates, aplicado, ventasSaldadas } = planificarCobranzaFIFO(ventas ?? [], monto, metodo)

  // No tocamos `estado`: la venta CC ya está despachada/facturada; solo salda el receivable.
  for (const u of updates) {
    await supabase.from('ventas').update({
      monto_pagado: u.nuevoMontoPagado,
      medio_pago: u.nuevoMedioPago,
    }).eq('id', u.id)
  }

  // Registro en caja (impacto en arqueo) — fire-and-report, nunca rompe la cobranza.
  // El efectivo ya tiene `sesionId` resuelto arriba (garantizado); los no-efectivo lo
  // resuelven acá best-effort (su informativo no afecta el arqueo de efectivo).
  let cajaRegistrada = false
  if (aplicado > 0) {
    const mov = movimientoCajaCobranza(metodo, clienteNombre)
    if (mov) {
      try {
        const sid = sesionId ?? await resolverSesionCajaCobranza(supabase, tenantId, usuarioId)
        if (sid) {
          const { error } = await supabase.from('caja_movimientos').insert({
            tenant_id: tenantId,
            sesion_id: sid,
            tipo: mov.tipo,
            concepto: mov.concepto,
            monto: aplicado,
            usuario_id: usuarioId ?? null,
            cuenta_origen_id: mov.tipo === 'ingreso_informativo' ? (cuentaOrigenId ?? null) : null,
          })
          cajaRegistrada = !error
          if (error) console.error('[cobranzaCC] caja_movimientos error:', error)
        }
      } catch (e) {
        console.error('[cobranzaCC] registro en caja falló:', e)
      }
    }
  }

  return { aplicado, ventasSaldadas, cajaRegistrada, requiereCaja: false }
}
