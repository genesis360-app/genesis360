import { useAuthStore } from '@/store/authStore'

export function useSucursalFilter() {
  const { sucursalId, sucursales, setSucursal, puedeVerTodas } = useAuthStore()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilter(q: any): any {
    if (sucursalId) return q.eq('sucursal_id', sucursalId)
    return q
  }

  return { sucursalId, sucursales, setSucursal, applyFilter, puedeVerTodas }
}
