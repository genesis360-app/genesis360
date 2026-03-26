import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { MAX_MOVIMIENTOS_POR_PLAN } from '@/config/brand'

export interface PlanLimits {
  max_usuarios: number
  max_productos: number
  max_movimientos: number      // -1 = ilimitado
  usuarios_actuales: number
  productos_actuales: number
  movimientos_mes: number      // movimientos del mes en curso
  addon_movimientos: number    // extra comprado
  puede_crear_usuario: boolean
  puede_crear_producto: boolean
  puede_crear_movimiento: boolean
  pct_usuarios: number
  pct_productos: number
  pct_movimientos: number      // 0–100 (0 si ilimitado)
}

export function usePlanLimits(): { limits: PlanLimits | null; loading: boolean } {
  const { tenant } = useAuthStore()

  const { data: limits = null, isLoading } = useQuery({
    queryKey: ['plan-limits', tenant?.id],
    queryFn: async () => {
      const inicioMes = new Date()
      inicioMes.setDate(1)
      inicioMes.setHours(0, 0, 0, 0)

      const [
        { count: usuarios },
        { count: productos },
        { count: movimientosMes },
        { data: tenantRow },
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('productos').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('movimientos_stock').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .gte('created_at', inicioMes.toISOString()),
        supabase.from('tenants').select('plan_id, max_users, max_productos, addon_movimientos')
          .eq('id', tenant!.id).single(),
      ])

      const planId = tenantRow?.plan_id ?? 'free'
      const max_usuarios = tenantRow?.max_users ?? 1
      const max_productos = tenantRow?.max_productos ?? 50
      const addonMov = tenantRow?.addon_movimientos ?? 0

      // Base del plan + add-ons comprados
      const basePlanMax = MAX_MOVIMIENTOS_POR_PLAN[planId] ?? MAX_MOVIMIENTOS_POR_PLAN['free']
      const max_movimientos = basePlanMax === -1 ? -1 : basePlanMax + addonMov

      const usuarios_actuales = usuarios ?? 0
      const productos_actuales = productos ?? 0
      const movimientosMesActual = movimientosMes ?? 0

      return {
        max_usuarios,
        max_productos,
        max_movimientos,
        usuarios_actuales,
        productos_actuales,
        movimientos_mes: movimientosMesActual,
        addon_movimientos: addonMov,
        puede_crear_usuario: usuarios_actuales < max_usuarios,
        puede_crear_producto: productos_actuales < max_productos,
        puede_crear_movimiento: max_movimientos === -1 || movimientosMesActual < max_movimientos,
        pct_usuarios: Math.round((usuarios_actuales / max_usuarios) * 100),
        pct_productos: Math.round((productos_actuales / max_productos) * 100),
        pct_movimientos: max_movimientos === -1
          ? 0
          : Math.round((movimientosMesActual / max_movimientos) * 100),
      } as PlanLimits
    },
    enabled: !!tenant,
    staleTime: 30000,
  })

  return { limits, loading: isLoading }
}
