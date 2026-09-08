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
  | 'cupon'
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
  | 'wms_tarea'
  | 'pedido'
  | 'envio'
  | 'autorizacion'
  | 'tarea_repositor'

export type AccionLog = 'crear' | 'editar' | 'eliminar' | 'cambio_estado' | 'cerrar' | 'pagar' | 'solicitar' | 'aprobar' | 'rechazar' | 'reasignar' | 'ingreso_stock' | 'rebaje_stock' | 'incobrable' | 'despacho_traslado' | 'recepcion_traslado' | 'faltante_traslado'

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
  /** Venta a la que pertenece esta actividad, directa o indirectamente (pedido/envío/devolución de
   * esa venta) — mig 351. Resolver ANTES de llamar (nunca heurística de lectura). */
  venta_id?: string | null
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
    venta_id:         params.venta_id ?? null,
  }).then(() => {}) // fire-and-forget
}

// ─── Diff de campos para el HISTORIAL ────────────────────────────────────────────────────────
//
// Pedido de Fede (2026-09-08): "en el módulo historial debería aparecer el detalle cuando alguien
// edita un producto, ver los campos o cosas que se editaron". `HistorialPage` YA sabe renderizar
// `Editó <campo> de <entidad> <nombre>: "<anterior>" → "<nuevo>"`; lo que faltaba era que el
// formulario mandara el detalle en vez de un `accion: 'editar'` pelado.

export interface CampoCambiado {
  campo: string
  anterior: string | null
  nuevo: string | null
}

/** `null`, `undefined` y `''` son lo mismo a los ojos del historial: "vacío". */
function normalizar(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Compara los valores viejos contra el payload que se va a guardar y devuelve SOLO lo que cambió.
 *
 * 🛑 El `numeric` de Postgres llega como STRING (`"1500.00"`), así que comparar en crudo contra el
 * `1500` del formulario marcaría como "cambiado" un precio que nadie tocó — y el historial se
 * llenaría de ruido en cada guardado. Por eso, si los dos lados son numéricos, se comparan como
 * números. (Es el mismo gotcha que ya mordió con la alícuota de IVA.)
 *
 * Solo mira las claves que están en `etiquetas`: el historial es para humanos, no un dump de fila.
 */
export function diffCampos(
  original: Record<string, unknown> | null | undefined,
  nuevo: Record<string, unknown>,
  etiquetas: Record<string, string>,
): CampoCambiado[] {
  if (!original) return []
  const cambios: CampoCambiado[] = []
  for (const [clave, etiqueta] of Object.entries(etiquetas)) {
    if (!(clave in nuevo)) continue
    const a = normalizar(original[clave])
    const b = normalizar(nuevo[clave])
    if (a === b) continue
    // Ambos numéricos → comparar como números, no como texto.
    if (a !== null && b !== null && a !== '' && b !== '' && !isNaN(Number(a)) && !isNaN(Number(b))) {
      if (Number(a) === Number(b)) continue
    }
    cambios.push({ campo: etiqueta, anterior: a, nuevo: b })
  }
  return cambios
}
