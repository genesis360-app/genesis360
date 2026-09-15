// Precio de venta con fecha/hora de vigencia — lógica pura (testeable), sin I/O.
//
// El guard autoritativo está en la base (`fn_programar_precio`, mig 422: permiso, producto del negocio,
// fecha al menos 1 minuto en el futuro y a no más de un año). Esto es el espejo de la pantalla, con un
// margen más amplio (2 minutos) para que lo que la pantalla deja pasar no lo rechace la base por los
// segundos que tarda en guardar.

export type ValidacionVigencia = { ok: true; vigenteDesde: Date } | { ok: false; error: string }

const MARGEN_MINIMO_MS = 2 * 60 * 1000
const MAXIMO_MS = 366 * 24 * 60 * 60 * 1000

/** `fecha` 'YYYY-MM-DD' + `hora` 'HH:MM', en la hora local del navegador. `null` si no es válida. */
export function combinarFechaHora(fecha: string, hora: string): Date | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha ?? '')
  const h = /^(\d{2}):(\d{2})$/.exec(hora ?? '')
  if (!f || !h) return null
  const [anio, mes, dia] = [Number(f[1]), Number(f[2]), Number(f[3])]
  const [hh, mm] = [Number(h[1]), Number(h[2])]
  if (hh > 23 || mm > 59) return null
  const d = new Date(anio, mes - 1, dia, hh, mm, 0, 0)
  // Rechaza fechas que Date "corrige" (ej. 31/02 → 03/03).
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null
  return d
}

/** Valida la fecha/hora elegida para que un precio programado entre en vigencia. */
export function validarVigencia(fecha: string, hora: string, ahora: Date = new Date()): ValidacionVigencia {
  const d = combinarFechaHora(fecha, hora)
  if (!d) return { ok: false, error: 'Elegí una fecha y una hora válidas.' }
  if (d.getTime() < ahora.getTime() + MARGEN_MINIMO_MS) {
    return { ok: false, error: 'La fecha y hora tienen que ser futuras. Para que el precio rija ya, elegí "Ahora".' }
  }
  if (d.getTime() > ahora.getTime() + MAXIMO_MS) {
    return { ok: false, error: 'No se puede programar un precio a más de un año.' }
  }
  return { ok: true, vigenteDesde: d }
}

/** ¿Cambió el precio? Normaliza el `numeric` que llega como string y tolera redondeos a centavos. */
export function cambioDePrecio(anterior: unknown, nuevo: unknown): boolean {
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
    return Number.isFinite(n) ? n : 0
  }
  return Math.abs(num(anterior) - num(nuevo)) >= 0.005
}

/** Propuesta por defecto al elegir "Programar": mañana a las 08:00, hora local. */
export function vigenciaSugerida(ahora: Date = new Date()): { fecha: string; hora: string } {
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1, 8, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { fecha: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hora: '08:00' }
}

// ── Fases 2-3 (mig 423): la etiqueta de la góndola ─────────────────────────────────────────────────

/** Lo mínimo de una tarea de repositor (`tareas_repositor` / `vw_tareas_repositor`) que usan estas reglas. */
export type TareaEtiqueta = {
  tipo: string
  estado: string
  precio_anterior: unknown
  precio_nuevo: unknown
  precio_programado_id?: string | null
  vigente_desde?: string | null
}

const TAREA_ACTIVA = ['pendiente', 'en_curso']

/**
 * C3 — ¿la góndola muestra un precio distinto del que se cobra? `precio_anterior` es lo que sigue impreso en la
 * etiqueta. Antes de la hora de un precio programado da `false`: la etiqueta vieja todavía es la correcta.
 */
export function etiquetaDesactualizada(tarea: TareaEtiqueta, precioVigente: unknown): boolean {
  if (tarea.tipo !== 'cambio_precio' || !TAREA_ACTIVA.includes(tarea.estado)) return false
  if (tarea.precio_anterior == null || precioVigente == null) return false
  return cambioDePrecio(tarea.precio_anterior, precioVigente)
}

/**
 * C1/C2 — espejo del guard `fn_tarea_repositor_guard_completar`: la etiqueta de un precio programado no se da por
 * puesta mientras siga rigiendo otro precio. Si alguien ya dejó el precio vigente igual al de la etiqueta, se puede.
 */
export function etiquetaAntesDeHora(tarea: TareaEtiqueta, precioVigente: unknown, ahora: Date = new Date()): boolean {
  if (tarea.tipo !== 'cambio_precio' || !TAREA_ACTIVA.includes(tarea.estado)) return false
  if (!tarea.precio_programado_id || !tarea.vigente_desde) return false
  const desde = new Date(tarea.vigente_desde)
  if (isNaN(desde.getTime()) || desde.getTime() <= ahora.getTime()) return false
  return cambioDePrecio(precioVigente, tarea.precio_nuevo)
}

/** C3 — etiqueta de un precio programado cuya hora ya pasó y sigue sin cambiarse. */
export function etiquetaVencida(tarea: TareaEtiqueta, ahora: Date = new Date()): boolean {
  if (tarea.tipo !== 'cambio_precio' || !TAREA_ACTIVA.includes(tarea.estado)) return false
  if (!tarea.precio_programado_id || !tarea.vigente_desde) return false
  const desde = new Date(tarea.vigente_desde)
  return !isNaN(desde.getTime()) && desde.getTime() <= ahora.getTime()
}

/** Opciones de anticipación de la tarea del repositor (minutos). `tenants.repositor_anticipacion_min` acepta 0-1440. */
export const ANTICIPACION_OPCIONES_MIN = [0, 15, 30, 60, 120, 240, 480, 1440] as const

export function etiquetaAnticipacion(min: number): string {
  if (min <= 0) return 'A la hora del cambio'
  if (min < 60) return `${min} minutos antes`
  if (min === 1440) return 'Un día antes'
  const h = min / 60
  return Number.isInteger(h) ? `${h} hora${h === 1 ? '' : 's'} antes` : `${min} minutos antes`
}

/** 'dd/mm/aaaa hh:mm' en hora local. */
export function formatearVigencia(valor: string | Date): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
