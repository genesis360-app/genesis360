import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export type EntidadLog =
  | 'producto'
  | 'inventario_linea'
  | 'venta'
  | 'categoria'
  | 'proveedor'
  | 'ubicacion'
  | 'estado'
  | 'motivo'
  | 'usuario'
  | 'gasto'
  | 'combo'
  | 'caja'

export type AccionLog = 'crear' | 'editar' | 'eliminar' | 'cambio_estado' | 'cerrar'

interface LogParams {
  entidad: EntidadLog
  entidad_id?: string
  entidad_nombre?: string
  accion: AccionLog
  campo?: string
  valor_anterior?: string | null
  valor_nuevo?: string | null
  pagina?: string
}

/**
 * Registra una actividad en el log. Fire-and-forget: no lanza errores ni bloquea el flujo.
 * Llamar sin await desde cualquier página.
 */
export function logActividad(params: LogParams): void {
  const { user, tenant } = useAuthStore.getState()
  if (!tenant?.id || !user?.id) return

  supabase.from('actividad_log').insert({
    tenant_id:      tenant.id,
    usuario_id:     user.id,
    usuario_nombre: user.nombre_display ?? user.id,
    entidad:        params.entidad,
    entidad_id:     params.entidad_id ?? null,
    entidad_nombre: params.entidad_nombre ?? null,
    accion:         params.accion,
    campo:          params.campo ?? null,
    valor_anterior: params.valor_anterior ?? null,
    valor_nuevo:    params.valor_nuevo ?? null,
    pagina:         params.pagina ?? null,
  }).then(() => {}) // fire-and-forget
}
