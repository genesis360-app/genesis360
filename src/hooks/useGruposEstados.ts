import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface GrupoOption {
  id: string
  nombre: string
  es_default: boolean
  estado_ids: string[]
}

export function useGruposEstados() {
  const { tenant } = useAuthStore()

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_estados', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grupos_estados')
        .select('id, nombre, es_default, grupo_estado_items(estado_id)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('es_default', { ascending: false })
        .order('nombre')
      if (error) throw error
      return (data ?? []).map((g: any) => ({
        id: g.id,
        nombre: g.nombre,
        es_default: g.es_default,
        estado_ids: (g.grupo_estado_items ?? []).map((i: any) => i.estado_id),
      })) as GrupoOption[]
    },
    enabled: !!tenant,
  })

  const grupoDefault = grupos.find(g => g.es_default) ?? null
  const estadosDefault = grupoDefault?.estado_ids ?? []

  return { grupos, grupoDefault, estadosDefault }
}
