import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// Devuelve el último día (DATE) del último periodo contable cerrado del tenant.
// null si no hay cierres aplicados.
export function useCierreContable() {
  const { tenant } = useAuthStore()

  const { data: ultimoCierre = null, isLoading } = useQuery({
    queryKey: ['cierre-ultimo', tenant?.id],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('cierres_contables')
        .select('periodo')
        .eq('tenant_id', tenant!.id)
        .order('periodo', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) return null
      // periodo es YYYY-MM-01 → último día = fin del mes
      const d = new Date(data.periodo + 'T00:00:00')
      const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      return fin.toISOString().split('T')[0]
    },
    enabled: !!tenant?.id,
    staleTime: 60_000,
  })

  const isPeriodoCerrado = (fecha: string | null | undefined) => {
    if (!fecha || !ultimoCierre) return false
    const f = (fecha.length > 10 ? fecha.slice(0, 10) : fecha) // recorta TIMESTAMPTZ a DATE
    return f <= ultimoCierre
  }

  return { ultimoCierre, isPeriodoCerrado, isLoading }
}

// Convierte error de PG (mensaje del trigger) en toast amigable.
// Devuelve TRUE si el mensaje correspondía a un periodo cerrado.
export function manejarErrorPeriodoCerrado(error: any, toastFn: (msg: string) => void): boolean {
  const msg: string = error?.message ?? error?.error_description ?? ''
  if (msg.toLowerCase().includes('periodo contable cerrado') || msg.toLowerCase().includes('período contable cerrado')) {
    toastFn(msg)
    return true
  }
  return false
}
