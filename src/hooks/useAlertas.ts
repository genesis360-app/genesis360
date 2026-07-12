import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { cajasSobreUmbralBoveda } from '@/lib/cajaSaldo'

const RESERVAS_DIAS_LIMITE = 3

/** Cajas operativas ABIERTAS (excluye la Caja Fuerte permanente) cuyo efectivo supera el umbral
 *  de bóveda. Compartido por el badge (useAlertas) y AlertasPage para que cuenten lo mismo.
 *  Devuelve [] sin tocar la DB si el umbral no está configurado. */
export async function cajasSobreUmbralBovedaDelTenant(tenantId: string, umbral: number | null | undefined) {
  if (!(Number(umbral) > 0)) return []
  const { data: sesiones } = await supabase.from('caja_sesiones')
    .select('id, monto_apertura, cajas(nombre)')
    .eq('tenant_id', tenantId).eq('estado', 'abierta')
    .not('es_permanente', 'is', true)
  if (!sesiones || sesiones.length === 0) return []
  const ids = (sesiones as any[]).map(s => s.id)
  const { data: movs } = await supabase.from('caja_movimientos')
    .select('sesion_id, tipo, monto').in('sesion_id', ids)
  const sesionesIn = (sesiones as any[]).map(s => ({ id: s.id, monto_apertura: s.monto_apertura, caja_nombre: s.cajas?.nombre ?? null }))
  return cajasSobreUmbralBoveda(sesionesIn, (movs ?? []) as any[], umbral)
}

async function contarCajasSobreUmbral(tenantId: string, umbral: number | null | undefined): Promise<number> {
  return (await cajasSobreUmbralBovedaDelTenant(tenantId, umbral)).length
}

export function useAlertas() {
  const { tenant } = useAuthStore()
  // El badge del sidebar debe contar SOLO los tipos de alerta que el usuario puede
  // accionar en su modo. En básico no hay vencimiento de lote (WMS), así que esa fuente
  // no se cuenta o el badge mostraría un número "fantasma" que no se corresponde con
  // nada visible en /alertas. Las OC SÍ cuentan en ambos modos (v1.126.0). Ver AlertasPage.tsx.
  const { avanzado: modoAvanzado } = useModoOperacion()

  const { data } = useQuery({
    queryKey: ['alertas', tenant?.id, modoAvanzado],
    queryFn: async () => {
      const fechaLimite = new Date()
      fechaLimite.setDate(fechaLimite.getDate() - RESERVAS_DIAS_LIMITE)

      const hoy = new Date().toISOString().split('T')[0]
      const en3dias = new Date()
      en3dias.setDate(en3dias.getDate() + 3)
      const en3diasStr = en3dias.toISOString().split('T')[0]

      // ── Fuentes comunes a ambos modos ──────────────────────────────────────
      // Las OC cuentan en AMBOS modos desde v1.126.0: el tab "Órdenes de compra" de
      // Prov./Servicios ya no es exclusivo de avanzado (decisión GO 2026-07-11 — la OC
      // sugerida de Alertas se genera también en básico y hay que poder continuarla).
      const baseQueries = [
        supabase
          .from('alertas')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .eq('resuelta', false),
        supabase
          .from('ventas')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .eq('estado', 'reservada')
          .lt('created_at', fechaLimite.toISOString()),
        supabase
          .from('productos')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .eq('activo', true)
          .is('categoria_id', null),
        supabase
          .from('ventas')
          .select('id, total, monto_pagado, cliente_id')
          .eq('tenant_id', tenant!.id)
          .in('estado', ['pendiente', 'reservada'])
          .not('cliente_id', 'is', null),
        // OC con fecha de vencimiento de pago ya pasada y no pagadas
        supabase
          .from('ordenes_compra')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .in('estado_pago', ['pendiente_pago', 'pago_parcial', 'cuenta_corriente'])
          .not('fecha_vencimiento_pago', 'is', null)
          .lt('fecha_vencimiento_pago', hoy),
        // OC que vencen en los próximos 3 días
        supabase
          .from('ordenes_compra')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .in('estado_pago', ['pendiente_pago', 'pago_parcial', 'cuenta_corriente'])
          .not('fecha_vencimiento_pago', 'is', null)
          .gte('fecha_vencimiento_pago', hoy)
          .lte('fecha_vencimiento_pago', en3diasStr),
      ] as const

      // ── Fuentes solo de modo avanzado (WMS) ────────────────────────────────
      const avanzadoQueries = modoAvanzado
        ? [
            // Vencimiento de lote (WMS)
            supabase
              .from('inventario_lineas')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenant!.id)
              .eq('activo', true)
              .gt('cantidad', 0)
              .not('fecha_vencimiento', 'is', null)
              .lt('fecha_vencimiento', hoy),
          ]
        : []

      const [
        { count: countAlertas },
        { count: countReservas },
        { count: countSinCategoria },
        clientesDeudaData,
        { count: countOcVencidasRaw },
        { count: countOcProximasRaw },
        ...avanzadoRes
      ] = await Promise.all([...baseQueries, ...avanzadoQueries])

      const countVencidos = (avanzadoRes[0] as any)?.count ?? 0
      const countOcVencidas = countOcVencidasRaw ?? 0
      const countOcProximas = countOcProximasRaw ?? 0

      // Contar clientes únicos con saldo > $0.50
      const clientesUnicos = new Set<string>()
      for (const v of (clientesDeudaData as any).data ?? []) {
        const saldo = Math.max(0, (v.total ?? 0) - (v.monto_pagado ?? 0))
        if (saldo >= 0.5 && v.cliente_id) clientesUnicos.add(v.cliente_id)
      }

      // H4 — efectivo en caja sobre el umbral de bóveda (ambos modos). Solo si el tenant lo configuró.
      const countBoveda = await contarCajasSobreUmbral(tenant!.id, (tenant as any)?.boveda_umbral_caja)

      return (countAlertas ?? 0) + (countReservas ?? 0) + (countSinCategoria ?? 0) + clientesUnicos.size + countVencidos + countOcVencidas + countOcProximas + countBoveda
    },
    enabled: !!tenant,
    refetchInterval: 30000,
  })

  return { count: data ?? 0 }
}
