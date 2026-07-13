// Multi-CUIT (F5, Fases 4/5) — emisores fiscales ACTIVOS del tenant + mapa sucursal→emisor.
// Con UN solo emisor (todos los tenants hoy) `multiEmisor` es false y ninguna UI cambia.
// Regla de resolución (espejo de la EF, ver src/lib/emisorFiscal.ts):
//   emisor default de una venta/gasto = el de su sucursal ?? el principal del tenant.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface EmisorFiscalLite {
  id: string
  nombre: string
  cuit: string
  condicion_iva_emisor: string | null
  umbral_factura_b: number | string | null
  es_default: boolean
}

export function useEmisoresFiscales() {
  const { tenant } = useAuthStore()

  const { data } = useQuery({
    queryKey: ['emisores-fiscales-activos', tenant?.id],
    queryFn: async () => {
      const [{ data: emisores }, { data: sucursales }] = await Promise.all([
        supabase.from('emisores_fiscales')
          .select('id, nombre, cuit, condicion_iva_emisor, umbral_factura_b, es_default')
          .eq('tenant_id', tenant!.id).eq('activo', true)
          .order('es_default', { ascending: false }).order('nombre'),
        supabase.from('sucursales')
          .select('id, emisor_fiscal_id').eq('tenant_id', tenant!.id),
      ])
      return {
        emisores: (emisores ?? []) as EmisorFiscalLite[],
        sucursales: (sucursales ?? []) as { id: string; emisor_fiscal_id: string | null }[],
      }
    },
    enabled: !!tenant,
  })

  const emisores = data?.emisores ?? []
  const principal = emisores.find(e => e.es_default) ?? null
  const multiEmisor = emisores.length > 1

  const emisorDeSucursal = (sucursalId?: string | null): EmisorFiscalLite | null => {
    if (!sucursalId) return principal
    const suc = (data?.sucursales ?? []).find(s => s.id === sucursalId)
    const asignado = suc?.emisor_fiscal_id ? emisores.find(e => e.id === suc.emisor_fiscal_id) : null
    return asignado ?? principal
  }

  return { emisores, principal, multiEmisor, emisorDeSucursal }
}
