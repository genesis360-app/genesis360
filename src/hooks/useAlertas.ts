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

      const [{ count: countAlertas }, { count: countReservas }] = await Promise.all([
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
      ])
      return (countAlertas ?? 0) + (countReservas ?? 0)
    },
    enabled: !!tenant,
    refetchInterval: 30000,
  })

  return { count: data ?? 0 }
}
