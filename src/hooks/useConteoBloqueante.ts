import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Conteos 2.0 · A2 — ¿hay un conteo wall-to-wall en curso (borrador) que bloquea
 * ventas/movimientos en la sucursal? Devuelve el conteo bloqueante o null.
 * El POS y los movimientos de stock lo consultan para impedir operar durante el conteo full.
 */
export function useConteoBloqueante(tenantId: string | null | undefined, sucursalId: string | null | undefined) {
  return useQuery({
    queryKey: ['conteo-bloqueante', tenantId, sucursalId],
    queryFn: async () => {
      if (!tenantId || !sucursalId) return null
      const { data } = await supabase.from('inventario_conteos')
        .select('id, created_at, created_by')
        .eq('tenant_id', tenantId).eq('sucursal_id', sucursalId)
        .eq('estado', 'borrador').eq('bloquea_movimientos', true)
        .limit(1)
      return (data?.[0] ?? null) as { id: string; created_at: string; created_by: string | null } | null
    },
    enabled: !!tenantId && !!sucursalId,
    staleTime: 0,
  })
}
