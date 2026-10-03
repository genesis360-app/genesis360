// Límites y módulos efectivos de un negocio — ESPEJO de `fn_tenant_limite` (mig 457) para la app.
//
// Pricing v7 (GO 2026-10-02): los negocios que existían antes del cambio conservan los límites y módulos de su plan v6
// (`tenant_herencia_plan`). Límite = mayor(base del plan actual, base heredada) + add-ons; -1 = ilimitado.
import { FEATURES_POR_PLAN, PLAN_BASE_LIMITS } from '@/config/brand'

export type DimensionPlan = 'sku' | 'movimientos' | 'comprobantes' | 'sucursales' | 'usuarios' | 'cuits'

export interface HerenciaPlan {
  tier_heredado: string
  limites: Partial<Record<DimensionPlan, number>>
  features: string[]
}

/** Tier que rige: una prueba vigente da los límites de Pro (igual que la base). */
export function tierEfectivo(p: {
  planTier: string | null | undefined
  subscriptionStatus: string | null | undefined
  trialEndsAt: string | null | undefined
  now: Date
}): string {
  const enTrialVigente = p.subscriptionStatus === 'trial' && !!p.trialEndsAt && new Date(p.trialEndsAt) >= p.now
  return enTrialVigente ? 'pro' : (p.planTier ?? 'free')
}

/** Base del plan para una dimensión, con la herencia v6 como piso. */
export function limiteBase(tier: string, dim: DimensionPlan, herencia?: HerenciaPlan | null): number {
  const base = (PLAN_BASE_LIMITS[tier] ?? PLAN_BASE_LIMITS.free)[dim]
  const her = herencia?.limites?.[dim]
  if (base === -1 || her === -1) return -1
  return Math.max(base, typeof her === 'number' ? her : 0)
}

/** Límite final = base (con herencia) + add-ons activos. -1 = ilimitado. */
export function limiteEfectivo(tier: string, dim: DimensionPlan, addons: number, herencia?: HerenciaPlan | null, extra = 0): number {
  const base = limiteBase(tier, dim, herencia)
  return base === -1 ? -1 : base + addons + extra
}

/** Módulos habilitados: los del plan actual más los heredados (un negocio existente no pierde ninguno). */
export function featuresEfectivas(tier: string, herencia?: HerenciaPlan | null): string[] {
  const delPlan = FEATURES_POR_PLAN[tier] ?? FEATURES_POR_PLAN.free
  return [...new Set([...delPlan, ...(herencia?.features ?? [])])]
}
