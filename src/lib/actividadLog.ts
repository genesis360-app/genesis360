import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export type EntidadLog =
  | 'producto'
  | 'inventario_linea'
  | 'venta'
  | 'categoria'
  | 'proveedor'
  | 'ubicacion'
  | 'zona'
  | 'estado'
  | 'motivo'
  | 'atributo_variante'
  | 'usuario'
  | 'gasto'
  | 'combo'
  | 'caja'
  | 'empleado'
  | 'nomina'
  | 'vacacion'
  | 'asistencia'
  | 'recurso'
  | 'autorizacion_gasto'
  | 'cliente'
  | 'cheque'
  | 'traslado'
  | 'tenant'

export type AccionLog = 'crear' | 'editar' | 'eliminar' | 'cambio_estado' | 'cerrar' | 'pagar' | 'solicitar' | 'aprobar' | 'rechazar' | 'ingreso_stock' | 'rebaje_stock' | 'incobrable' | 'despacho_traslado' | 'recepcion_traslado' | 'faltante_traslado'

// Trazabilidad-extendida (mig 155): clasificación WMS de la transacción.
export type TipoTransaccion = 'ingreso' | 'rebaje' | 'traslado' | 'ajuste' | 'edicion' | 'venta' | 'devolucion' | 'eliminacion'

interface LogParams {
  entidad: EntidadLog
  entidad_id?: string
  entidad_nombre?: string
  accion: AccionLog
  campo?: string
  valor_anterior?: string | null
  valor_nuevo?: string | null
  pagina?: string
  // --- Ledger (mig 155) ---
  /** Cabecera lógica: todas las filas de UNA acción comparten este id. Usar nuevaTransaccion(). */
  transaccion_id?: string | null
  tipo_transaccion?: TipoTransaccion
  producto_id?: string | null
  /** Snapshot del LPN afectado (trazabilidad por unidad / recall). */
  lpn?: string | null
  /** Snapshot de la serie afectada. */
  nro_serie?: string | null
  /** Snapshot del lote afectado. */
  lote?: string | null
  sucursal_id?: string | null
}

/**
 * Genera un id de transacción para agrupar varias filas de log que pertenecen
 * a una misma acción del usuario (ej: editar un LPN cambiando 4 campos a la vez).
 * Pasar el mismo id a cada logActividad() de esa acción.
 */
export function nuevaTransaccion(): string {
  return crypto.randomUUID()
}

/**
 * Registra una actividad en el log. Fire-and-forget: no lanza errores ni bloquea el flujo.
 * Llamar sin await desde cualquier página.
 */
export function logActividad(params: LogParams): void {
  const { user, tenant } = useAuthStore.getState()
  if (!tenant?.id || !user?.id) return

  supabase.from('actividad_log').insert({
    tenant_id:        tenant.id,
    usuario_id:       user.id,
    usuario_nombre:   user.nombre_display ?? user.id,
    entidad:          params.entidad,
    entidad_id:       params.entidad_id ?? null,
    entidad_nombre:   params.entidad_nombre ?? null,
    accion:           params.accion,
    campo:            params.campo ?? null,
    valor_anterior:   params.valor_anterior ?? null,
    valor_nuevo:      params.valor_nuevo ?? null,
    pagina:           params.pagina ?? null,
    transaccion_id:   params.transaccion_id ?? null,
    tipo_transaccion: params.tipo_transaccion ?? null,
    producto_id:      params.producto_id ?? null,
    lpn:              params.lpn ?? null,
    nro_serie:        params.nro_serie ?? null,
    lote:             params.lote ?? null,
    sucursal_id:      params.sucursal_id ?? null,
  }).then(() => {}) // fire-and-forget
}
