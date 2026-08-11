import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'

// Capa de datos genérica del patrón "Pestaña de Supervisor" reusable (relevamiento derivado #2 hacia
// Repositores, decisiones A1/A3/B1 — 2026-08-09). `autorizaciones` es una tabla ÚNICA compartida por
// módulo (columna `modulo`); lo que es específico de cada módulo (qué campos trae el join, qué hace
// "aprobar" para cada `tipo`) queda afuera de este hook — acá solo viven las 3 acciones genéricas
// (fetch, reasignar, rechazar) más "marcar aprobada", que el módulo llama DESPUÉS de aplicar su propio
// efecto de negocio (ver `aprobarAutorizacion` en InventarioPage.tsx).

export type EstadoAutorizacion = 'pendiente' | 'aprobada' | 'rechazada'

/** `selectExtra` son los joins específicos del módulo (ej. en Inventario: inventario_lineas(...)) —
 *  el hook siempre agrega el resto de columnas base + solicitante/aprobador/asignado. */
export function useSupervisorAutorizaciones(modulo: string, selectExtra: string, autEstado: EstadoAutorizacion) {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const queryKey = ['autorizaciones', modulo, tenant?.id, autEstado]

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('autorizaciones')
        .select(`*, ${selectExtra}, solicitante:users!solicitado_por(nombre_display), asignado:users!asignado_a(nombre_display)`)
        .eq('tenant_id', tenant!.id)
        .eq('modulo', modulo)
        .eq('estado', autEstado)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  async function marcarAprobada(id: string) {
    await supabase.from('autorizaciones').update({ estado: 'aprobada', aprobado_por: user?.id }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['autorizaciones', modulo] })
    qc.invalidateQueries({ queryKey: ['supervision-badge'] })
  }

  async function rechazar(id: string, motivo: string, entidadNombre: string) {
    if (!motivo.trim()) throw new Error('Ingresá un motivo de rechazo')
    const { error } = await supabase.from('autorizaciones').update({
      estado: 'rechazada', aprobado_por: user?.id, motivo_rechazo: motivo,
    }).eq('id', id)
    if (error) throw error
    logActividad({ entidad: 'autorizacion', entidad_id: id, entidad_nombre: entidadNombre, accion: 'rechazar', campo: 'estado', valor_anterior: 'pendiente', valor_nuevo: 'rechazada', pagina: `/${modulo}` })
    qc.invalidateQueries({ queryKey: ['autorizaciones', modulo] })
    qc.invalidateQueries({ queryKey: ['supervision-badge'] })
  }

  async function reasignar(id: string, usuarioId: string | null, usuarioNombre: string | null, entidadNombre: string) {
    const { error } = await supabase.from('autorizaciones').update({ asignado_a: usuarioId }).eq('id', id)
    if (error) throw error
    logActividad({ entidad: 'autorizacion', entidad_id: id, entidad_nombre: entidadNombre, accion: 'reasignar', campo: 'asignado_a', valor_nuevo: usuarioNombre ?? 'sin asignar', pagina: `/${modulo}` })
    qc.invalidateQueries({ queryKey: ['autorizaciones', modulo] })
  }

  return { autorizaciones: query.data ?? [], isLoading: query.isLoading, marcarAprobada, rechazar, reasignar }
}

/** Badge cross-módulo (nav "Supervisión") — cuenta autorizaciones pendientes de TODOS los módulos
 *  donde el usuario actual puede supervisar. Hoy solo 'inventario' escribe filas; agregar acá el
 *  módulo nuevo el día que otro se retrofitee al patrón (mismo criterio que el CHECK de `modulo`). */
export function useSupervisionBadge(modulosPermitidos: string[]) {
  const { tenant } = useAuthStore()
  const { data } = useQuery({
    queryKey: ['supervision-badge', tenant?.id, modulosPermitidos.join(',')],
    queryFn: async () => {
      if (modulosPermitidos.length === 0) return 0
      const { count } = await supabase.from('autorizaciones')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id).eq('estado', 'pendiente')
        .in('modulo', modulosPermitidos)
      return count ?? 0
    },
    enabled: !!tenant && modulosPermitidos.length > 0,
    refetchInterval: 30000,
  })
  return { count: data ?? 0 }
}
