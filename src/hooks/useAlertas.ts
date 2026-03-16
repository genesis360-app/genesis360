import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function useAlertas() {
  const { tenant } = useAuthStore()

  const { data } = useQuery({
    queryKey: ['alertas', tenant?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('alertas')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id)
        .eq('resuelta', false)
      return count ?? 0
    },
    enabled: !!tenant,
    refetchInterval: 30000,
  })

  return { count: data ?? 0 }
}
