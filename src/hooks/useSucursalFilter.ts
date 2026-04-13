/**
 * useSucursalFilter — hook global para filtrar queries por sucursal activa.
 *
 * Uso:
 *   const { sucursalId, applyFilter } = useSucursalFilter()
 *   let q = supabase.from('ventas').select('*').eq('tenant_id', tenant.id)
 *   q = applyFilter(q)
 *   // Si hay sucursal activa, agrega .eq('sucursal_id', sucursalId)
 */
import { useAuthStore } from '@/store/authStore'

export function useSucursalFilter() {
  const { sucursalId, sucursales, setSucursal } = useAuthStore()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilter(q: any): any {
    // Incluye registros de la sucursal seleccionada + registros globales (sucursal_id IS NULL)
    // Los datos previos a multi-sucursal tienen NULL y deben seguir siendo visibles.
    if (sucursalId) return q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
    return q
  }

  return { sucursalId, sucursales, setSucursal, applyFilter }
}
