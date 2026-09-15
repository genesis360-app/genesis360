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

/** 'dd/mm/aaaa hh:mm' en hora local. */
export function formatearVigencia(valor: string | Date): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
