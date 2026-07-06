import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { PLAN_BASE_LIMITS, FEATURES_POR_PLAN } from '@/config/brand'

export interface PlanLimits {
  plan_id: string                // tier real del tenant (free/basico/pro/enterprise)
  max_usuarios: number
  max_productos: number
  max_movimientos: number        // -1 = ilimitado (pricing v2: SIEMPRE -1, dejó de ser límite)
  max_comprobantes: number       // 🆕 pricing v2 — ventas finalizadas del mes; -1 = ilimitado
  max_sucursales: number
  usuarios_actuales: number
  productos_actuales: number
  movimientos_mes: number        // movimientos del mes en curso (telemetría)
  comprobantes_mes: number       // 🆕 ventas finalizadas del mes (no presupuestos/canceladas)
  sucursales_actuales: number
  addon_movimientos: number      // extra de movimientos (legacy + add-ons)
  puede_crear_usuario: boolean
  puede_crear_producto: boolean
  puede_crear_movimiento: boolean
  puede_crear_sucursal: boolean
  pct_usuarios: number
  pct_productos: number
  pct_movimientos: number        // 0–100 (0 si ilimitado)
  pct_comprobantes: number       // 🆕 0–100 (0 si ilimitado) — enforcement SOFT (solo aviso)
  pct_sucursales: number
  // Feature flags por plan
  puede_reportes: boolean
  puede_historial: boolean
  puede_metricas: boolean
  puede_importar: boolean
  puede_rrhh: boolean
  puede_aging: boolean
  puede_marketplace: boolean
  puede_wms: boolean
}

type Addon = { dimension: string; cantidad: number; tipo: string; vence_at: string | null }

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
        { count: sucursales },
        { count: movimientosMes },
        { count: comprobantesMes },
        { data: tenantRow },
        { data: addonRows },
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('productos').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('sucursales').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('movimientos_stock').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .gte('created_at', inicioMes.toISOString()),
        // 🆕 Comprobantes = ventas FINALIZADAS del mes (pricing v2, GO 2026-07-05). El estado
        // de ventas es TEXT configurable (mig 174) → predicado robusto: ni cancelada
        // (cancelado_at) ni presupuesto. Enforcement SOFT: esto solo alimenta avisos/upsell.
        supabase.from('ventas').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .gte('created_at', inicioMes.toISOString())
          .is('cancelado_at', null)
          .neq('estado', 'presupuesto'),
        supabase.from('tenants').select('plan_tier, addon_movimientos, subscription_status, trial_ends_at')
          .eq('id', tenant!.id).single(),
        supabase.from('tenant_addons').select('dimension, cantidad, tipo, vence_at')
          .eq('tenant_id', tenant!.id),
      ])

      // Tier efectivo (ESPEJO de fn_tenant_limite, mig 251): trial activo → 'pro'.
      const planTier = (tenantRow?.plan_tier as string) ?? 'free'
      const enTrialActivo =
        tenantRow?.subscription_status === 'trial' &&
        !!tenantRow?.trial_ends_at &&
        new Date(tenantRow.trial_ends_at) >= new Date()
      const effTier = enTrialActivo ? 'pro' : planTier
      const base = PLAN_BASE_LIMITS[effTier] ?? PLAN_BASE_LIMITS['free']

      // Suma de add-ons activos por dimensión (fijos + temporales no vencidos).
      const now = new Date()
      const addons = (addonRows ?? []) as Addon[]
      const addonSum = (dim: string) => addons
        .filter(a => a.dimension === dim && (a.tipo === 'fijo' || (a.vence_at && new Date(a.vence_at) > now)))
        .reduce((s, a) => s + (a.cantidad ?? 0), 0)

      // Límite efectivo = base + add-ons (−1 = ilimitado, no se le suma nada).
      const addonMovLegacy = tenantRow?.addon_movimientos ?? 0
      const eff = (dim: 'sku' | 'movimientos' | 'comprobantes' | 'sucursales' | 'usuarios', legacy = 0) =>
        base[dim] === -1 ? -1 : base[dim] + addonSum(dim) + legacy

      const max_productos    = eff('sku')
      const max_usuarios     = eff('usuarios')
      const max_sucursales   = eff('sucursales')
      const max_movimientos  = eff('movimientos', addonMovLegacy) // pricing v2: base -1 → siempre -1
      const max_comprobantes = eff('comprobantes')

      const usuarios_actuales   = usuarios ?? 0
      const productos_actuales  = productos ?? 0
      const sucursales_actuales = sucursales ?? 0
      const movimientos_mesAct  = movimientosMes ?? 0
      const comprobantes_mesAct = comprobantesMes ?? 0

      const features = FEATURES_POR_PLAN[effTier] ?? FEATURES_POR_PLAN['free']
      const tiene = (f: string) => features.includes(f)
      const pct = (act: number, max: number) => max === -1 ? 0 : Math.round((act / max) * 100)

      return {
        plan_id: planTier,
        max_usuarios,
        max_productos,
        max_movimientos,
        max_comprobantes,
        max_sucursales,
        usuarios_actuales,
        productos_actuales,
        movimientos_mes: movimientos_mesAct,
        comprobantes_mes: comprobantes_mesAct,
        sucursales_actuales,
        addon_movimientos: addonMovLegacy + addonSum('movimientos'),
        puede_crear_usuario:   max_usuarios === -1   || usuarios_actuales   < max_usuarios,
        puede_crear_producto:  max_productos === -1  || productos_actuales  < max_productos,
        puede_crear_movimiento: max_movimientos === -1 || movimientos_mesAct < max_movimientos,
        puede_crear_sucursal:  max_sucursales === -1 || sucursales_actuales < max_sucursales,
        pct_usuarios:   pct(usuarios_actuales, max_usuarios),
        pct_productos:  pct(productos_actuales, max_productos),
        pct_movimientos: pct(movimientos_mesAct, max_movimientos),
        pct_comprobantes: pct(comprobantes_mesAct, max_comprobantes),
        pct_sucursales: pct(sucursales_actuales, max_sucursales),
        puede_reportes:   tiene('reportes'),
        puede_historial:  tiene('historial'),
        puede_metricas:   tiene('metricas'),
        puede_importar:   tiene('importar'),
        puede_rrhh:       tiene('rrhh'),
        puede_aging:      tiene('aging'),
        puede_marketplace: tiene('marketplace'),
        puede_wms:        tiene('wms'),
      } as PlanLimits
    },
    enabled: !!tenant,
    staleTime: 30000,
  })

  return { limits, loading: isLoading }
}
