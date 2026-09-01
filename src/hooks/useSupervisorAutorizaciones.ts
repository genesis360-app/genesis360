import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { puedeSupervisarModulo } from '@/lib/permisosModulo'

// Capa de datos genérica del patrón "Pestaña de Supervisor" reusable (relevamiento derivado #2 hacia
// Repositores, decisiones A1/A3/B1 — 2026-08-09). `autorizaciones` es una tabla ÚNICA compartida por
// módulo (columna `modulo`); lo que es específico de cada módulo (qué campos trae el join, qué hace
// "aprobar" para cada `tipo`) queda afuera de este hook — acá solo viven las 3 acciones genéricas
// (fetch, reasignar, rechazar) más "marcar aprobada", que el módulo llama DESPUÉS de aplicar su propio
// efecto de negocio (ver `aprobarAutorizacion` en InventarioPage.tsx).

export type EstadoAutorizacion = 'pendiente' | 'aprobada' | 'rechazada'

/** `selectExtra` son los joins específicos del módulo (ej. en Inventario: inventario_lineas(...)) —
 *  el hook siempre agrega el resto de columnas base + solicitante/aprobador/asignado. */
// Mismo patrón de paginación que HistorialPage.tsx (page/pageSize/range + "Mostrando X de Y") —
// GO pidió replicarlo acá porque, a diferencia de Alertas (11 secciones chicas independientes),
// esta SÍ es una lista única homogénea que puede crecer sin límite con el uso.
export const AUT_PAGE_SIZES = [20, 50, 75, 100]

export function useSupervisorAutorizaciones(modulo: string, selectExtra: string, autEstado: EstadoAutorizacion) {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  // Cambiar de tab (pendiente/aprobada/rechazada) puede dejar `page` apuntando a una página que
  // no existe en el nuevo estado (ej. estabas en la página 3 de "pendiente" con 1 sola de
  // "rechazada") — se resetea a la primera página en cada cambio.
  useEffect(() => { setPage(0) }, [autEstado])

  const queryKey = ['autorizaciones', modulo, tenant?.id, autEstado, page, pageSize]

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      // selectExtra es opcional (módulos que no necesitan ningún join extra, ej. Clientes, guardan
      // todo lo necesario en datos_cambio) — sin el `.filter(Boolean)` una selectExtra vacía deja
      // una coma doble ("*, , solicitante:...") que PostgREST rechaza con error, silenciado como
      // "0 resultados" por el fallback `data ?? []` (bug real encontrado al retrofitear Clientes).
      const campos = ['*', selectExtra, 'solicitante:users!solicitado_por(nombre_display)', 'asignado:users!asignado_a(nombre_display)']
        .filter(Boolean).join(', ')
      const { data, error, count } = await supabase
        .from('autorizaciones')
        .select(campos, { count: 'exact' })
        .eq('tenant_id', tenant!.id)
        .eq('modulo', modulo)
        .eq('estado', autEstado)
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw error
      return { rows: data ?? [], total: count ?? 0 }
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

  return {
    autorizaciones: query.data?.rows ?? [],
    totalCount: query.data?.total ?? 0,
    page, pageSize, setPage, setPageSize,
    isLoading: query.isLoading,
    isError: query.isError,
    marcarAprobada, rechazar, reasignar,
  }
}

/** F1 del relevamiento de Supervisor: "cualquier módulo puede usar el botón 'Avisar al supervisor'" —
 *  genérico desde el día uno. F2: llega a quien tenga permiso `supervisa` en ese módulo (resuelto por
 *  herencia de C2, sin config aparte). Notifica a TODOS los que puedan supervisar el módulo, salvo
 *  quien avisa (no tiene sentido auto-notificarse). Devuelve cuántos destinatarios recibieron el aviso. */
export async function avisarSupervisor(
  tenantId: string, modulo: string, remitenteId: string | undefined,
  titulo: string, mensaje: string, actionUrl: string,
): Promise<number> {
  const { data: usuarios } = await supabase.from('users')
    .select('id, rol, permisos_custom:roles_custom(permisos)')
    .eq('tenant_id', tenantId).eq('activo', true)
  const destinatarios = (usuarios ?? [])
    .map((u: any) => ({ ...u, permisos_custom: u.permisos_custom?.permisos ?? null }))
    .filter((u: any) => u.id !== remitenteId && puedeSupervisarModulo(u, modulo))
  if (destinatarios.length === 0) return 0
  const { error } = await supabase.from('notificaciones').insert(
    destinatarios.map((u: any) => ({
      tenant_id: tenantId, user_id: u.id, tipo: 'aviso_supervisor', titulo, mensaje, action_url: actionUrl,
    }))
  )
  if (error) throw error
  return destinatarios.length
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
