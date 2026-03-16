import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface PlanLimits {
  max_usuarios: number
  max_productos: number
  usuarios_actuales: number
  productos_actuales: number
  puede_crear_usuario: boolean
  puede_crear_producto: boolean
  pct_usuarios: number
  pct_productos: number
}

export function usePlanLimits(): { limits: PlanLimits | null; loading: boolean } {
  const { tenant } = useAuthStore()

  const { data: limits = null, isLoading } = useQuery({
    queryKey: ['plan-limits', tenant?.id],
    queryFn: async () => {
      const [{ count: usuarios }, { count: productos }] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('productos').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('activo', true),
      ])

      const max_usuarios = tenant!.max_users ?? 2
      const max_productos = (tenant as any).max_productos ?? 50
      const usuarios_actuales = usuarios ?? 0
      const productos_actuales = productos ?? 0

      return {
        max_usuarios,
        max_productos,
        usuarios_actuales,
        productos_actuales,
        puede_crear_usuario: usuarios_actuales < max_usuarios,
        puede_crear_producto: productos_actuales < max_productos,
        pct_usuarios: Math.round((usuarios_actuales / max_usuarios) * 100),
        pct_productos: Math.round((productos_actuales / max_productos) * 100),
      } as PlanLimits
    },
    enabled: !!tenant,
    staleTime: 30000,
  })

  return { limits, loading: isLoading }
}
