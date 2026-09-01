import { useAuthStore } from '@/store/authStore'

export function useSucursalFilter() {
  const { sucursalId, sucursales, setSucursal, puedeVerTodas } = useAuthStore()

  function applyFilter(q: any): any {
    if (sucursalId) return q.eq('sucursal_id', sucursalId)
    return q
  }

  return { sucursalId, sucursales, setSucursal, applyFilter, puedeVerTodas }
}
