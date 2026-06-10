// M4 (relevamiento Caja) — sonido al confirmar un cobro en el POS.
// Preferencia por usuario/dispositivo (localStorage), default ON. El sonido se genera
// con Web Audio (sin assets) para no agregar archivos ni dependencias.

const KEY = 'g360_sonido_cobro'

/** ¿Está activado el sonido al cobrar? (default true) */
export function getSonidoCobro(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

/** Activa/desactiva el sonido al cobrar. */
export function setSonidoCobro(activo: boolean): void {
  try {
    localStorage.setItem(KEY, activo ? '1' : '0')
  } catch {
    /* ignore (modo privado / sin storage) */
  }
}

/**
 * Reproduce un "ding" corto de confirmación de cobro si la preferencia está activa.
 * Fire-and-forget: nunca lanza (un AudioContext bloqueado no debe romper la venta).
 */
export function reproducirSonidoCobro(): void {
  if (!getSonidoCobro()) return
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    // Dos tonos ascendentes cortos (caja registradora).
    const tonos = [880, 1320]
    tonos.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = now + i * 0.12
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.2)
    })
    // Cerrar el contexto cuando termine para liberar recursos.
    setTimeout(() => { ctx.close().catch(() => {}) }, 600)
  } catch {
    /* audio bloqueado o no disponible — no romper el flujo de venta */
  }
}
