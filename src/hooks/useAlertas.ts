import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

const RESERVAS_DIAS_LIMITE = 3

export function useAlertas() {
  const { tenant } = useAuthStore()

  const { data } = useQuery({
    queryKey: ['alertas', tenant?.id],
    queryFn: async () => {
      const fechaLimite = new Date()
      fechaLimite.setDate(fechaLimite.getDate() - RESERVAS_DIAS_LIMITE)

      const hoy = new Date().toISOString().split('T')[0]
      const en3dias = new Date()
      en3dias.setDate(en3dias.getDate() + 3)
      const en3diasStr = en3dias.toISOString().split('T')[0]

      const [
        { count: countAlertas },
        { count: countReservas },
        { count: countSinCategoria },
        { count: countVencidos },
        clientesDeudaData,
        { count: countOcVencidas },
        { count: countOcProximas },
      ] = await Promise.all([
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
          .from('inventario_lineas')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .eq('activo', true)
          .gt('cantidad', 0)
          .not('fecha_vencimiento', 'is', null)
          .lt('fecha_vencimiento', hoy),
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
      ])

      // Contar clientes únicos con saldo > $0.50
      const clientesUnicos = new Set<string>()
      for (const v of clientesDeudaData.data ?? []) {
        const saldo = Math.max(0, (v.total ?? 0) - (v.monto_pagado ?? 0))
        if (saldo >= 0.5 && v.cliente_id) clientesUnicos.add(v.cliente_id)
      }

      return (countAlertas ?? 0) + (countReservas ?? 0) + (countSinCategoria ?? 0) + (countVencidos ?? 0) + clientesUnicos.size + (countOcVencidas ?? 0) + (countOcProximas ?? 0)
    },
    enabled: !!tenant,
    refetchInterval: 30000,
  })

  return { count: data ?? 0 }
}
