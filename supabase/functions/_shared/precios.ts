// Espejo server-side de los PRECIOS de Genesis360 (src/config/brand.ts: PLANES[].precio, PRECIO_LISTA, ADDON_PACKS).
//
// Lo usa `admin-api` para calcular el MRR del panel interno. Antes el MRR salía de la tabla `planes` (precios viejos
// $0/$1.500/$3.000) cruzada con `tenants.plan_id`, que al 2026-10-01 tenía cargado 1 negocio de 11 → el panel mostraba
// ~$0 con un cliente pagando $60.000.
//
// 🛑 Mantener en sync con src/config/brand.ts en el mismo commit (igual que el espejo de `mp-addon-batch`, que es el
// que COBRA los add-ons). Pricing v7 cambia estos números: tocar los tres lugares juntos.

/** Precio mensual con débito automático (lo que paga `billing_mode = 'auto'`). */
export const PRECIO_DEBITO: Record<string, number> = { basico: 54000, pro: 90000 }

/** Precio de lista (otros medios de pago, `billing_mode = 'manual'` cuando no tiene monto congelado). */
export const PRECIO_LISTA: Record<string, number> = { basico: 60000, pro: 100000 }

/** Packs de add-on FIJOS (suman al recurrente). Los temporales son pago único: no son MRR. */
export const ADDON_PACKS: Record<string, Array<{ cantidad: number; precio: number }>> = {
  sku:          [{ cantidad: 500, precio: 5000 }, { cantidad: 2000, precio: 10000 }, { cantidad: 8000, precio: 25000 }],
  sucursales:   [{ cantidad: 1, precio: 15000 }, { cantidad: 3, precio: 35000 }, { cantidad: 5, precio: 55000 }],
  usuarios:     [{ cantidad: 1, precio: 5000 }, { cantidad: 3, precio: 10000 }, { cantidad: 5, precio: 15000 }],
  comprobantes: [{ cantidad: 1000, precio: 10000 }, { cantidad: 5000, precio: 30000 }, { cantidad: 10000, precio: 50000 }],
  cuits:        [{ cantidad: 1, precio: 20000 }, { cantidad: 2, precio: 35000 }, { cantidad: 3, precio: 45000 }],
}

export const precioAddon = (dimension: string, cantidad: number): number =>
  ADDON_PACKS[dimension]?.find(p => p.cantidad === cantidad)?.precio ?? 0

export const NOMBRE_PLAN: Record<string, string> = { free: 'Free', basico: 'Básico', pro: 'Pro', enterprise: 'Enterprise' }

type TenantMrr = { id: string; plan_tier: string | null; billing_mode: string | null; manual_monto_mensual: number | string | null }

/**
 * Cuánto paga por mes un negocio ACTIVO (el filtro de activos lo hace quien llama).
 * Manual: el monto congelado al pasar a manual (lo que realmente se le cobra) o, si no hay, el de lista.
 * Automático: precio con débito del plan + add-ons fijos (es lo que MP cobra: el batch hace PUT del recurrente).
 * Enterprise / plan sin precio publicado: 0 (se informa aparte como "sin precio").
 */
export function mrrDeTenant(t: TenantMrr, addonsFijos: Array<{ dimension: string; cantidad: number }>): number {
  const tier = String(t.plan_tier ?? '')
  const addons = addonsFijos.reduce((s, a) => s + precioAddon(a.dimension, a.cantidad), 0)
  if (t.billing_mode === 'manual') {
    const congelado = Number(t.manual_monto_mensual)
    return Number.isFinite(congelado) && congelado > 0 ? congelado : (PRECIO_LISTA[tier] ?? 0) + addons
  }
  return (PRECIO_DEBITO[tier] ?? 0) + addons
}
