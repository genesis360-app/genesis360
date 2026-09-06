/**
 * Cortacircuitos del refresco de sesión — Tanda D, escenario D1 (`tests/specs/uat-app.md`).
 *
 * ── El bug ───────────────────────────────────────────────────────────────────────────────────
 * auth-js 2.98 reintenta `POST /auth/v1/token?grant_type=refresh_token` SIN techo global:
 *   • un ticker cada 30 s (`AUTO_REFRESH_TICK_DURATION_MS`) que nunca se detiene, y
 *   • hasta ~7 intentos con backoff DENTRO de cada tick (200, 400, 800… ms).
 * No hay contador de fallos ENTRE ticks: una pestaña abierta contra un backend caído reintenta
 * para siempre. La app amplifica la caída que la está rompiendo — con un cliente real, cada
 * navegador abierto es un amplificador.
 *
 * Medido en los logs de edge de DEV (24 h al 2026-09-06): 595 requests a ese endpoint, 563 con
 * 5xx de Cloudflare (452×522, 49×504, 45×521, 16×524, 1×525) y solo 32 con 200. Durante la caída
 * sostenida del 5/9 se mantuvo en ~65 requests/hora entre las 19 h y las 00 h — CINCO HORAS
 * seguidas sin rendirse. Eso confirma que la sesión no se descarta sola: el bucle es infinito.
 *
 * ── El fix ───────────────────────────────────────────────────────────────────────────────────
 * NO se toca auth-js ni su configuración: se envuelve el `fetch` del cliente y se intercepta
 * únicamente ese endpoint. Todo lo demás pasa sin tocar.
 *   1. Backoff exponencial con jitter entre intentos REALES (2 s → 4 → 8 … tope 5 min).
 *   2. Mientras el circuito está abierto, el intento se corta LOCALMENTE: cero tráfico de red.
 *   3. Tras `maxFallos` fallos consecutivos se rinde: no vuelve a salir a la red hasta que el
 *      usuario decida (ver `AvisoSesionSinRefresco`).
 * Contra una caída de 5 h esto pasa de ~325 requests a 10, y después silencio.
 *
 * ── Por qué el cortocircuito devuelve 503 y no un error cualquiera ──────────────────────────
 * auth-js solo considera "reintentable" a 502/503/504 (`NETWORK_ERROR_CODES`); ante cualquier
 * otro error BORRA la sesión. Devolver 503 mantiene la sesión guardada, así que si el backend
 * vuelve dentro de la ventana el usuario sigue trabajando sin volver a loguearse. Es deliberado:
 * un cajero en medio de una venta no puede quedar deslogueado por un blip de 30 s del backend.
 */

/** El único endpoint que interceptamos: el que reintenta sin freno. */
export function esRefrescoDeSesion(url: string): boolean {
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')
}

/**
 * ¿El status dice "el backend está caído" o "tu refresh token no sirve"?
 *
 * 5xx cubre los 52x de Cloudflare (520-527), que son los que realmente vimos. 429 y 408 también
 * cuentan: seguir martillando un endpoint que ya nos frenó es exactamente la amplificación que
 * este módulo viene a cortar.
 *
 * Un 400/401 (`invalid_grant`, refresh token revocado o vencido) NO es fallo de backend: es una
 * respuesta definitiva. Ahí el cortacircuitos se hace a un lado y deja que auth-js borre la
 * sesión y mande a login limpio, que es lo correcto.
 */
export function esFalloDeBackend(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}

export interface ConfigRefresco {
  /** Espera tras el primer fallo. */
  baseMs: number
  /** Multiplicador por cada fallo consecutivo. */
  factor: number
  /** Techo de la espera entre intentos. */
  maxEsperaMs: number
  /** Fallos consecutivos tras los cuales deja de salir a la red hasta que el usuario decida. */
  maxFallos: number
  /** Ruido ±fracción sobre la espera, para que N pestañas no reintenten todas en el mismo ms. */
  jitter: number
}

export const CONFIG_REFRESCO: ConfigRefresco = {
  baseMs: 2_000,
  factor: 2,
  maxEsperaMs: 5 * 60_000,
  maxFallos: 10,
  jitter: 0.2,
}

/**
 * Espera antes del próximo intento REAL, dado cuántos fallos consecutivos llevamos.
 * Con la config default: 2 s, 4, 8, 16, 32, 64, 128, 256, 300, 300 (tope) — ~13 min de
 * reintentos que se auto-curan, a costo de 10 requests en total.
 */
export function esperaMs(
  fallos: number,
  cfg: ConfigRefresco = CONFIG_REFRESCO,
  aleatorio: () => number = Math.random,
): number {
  if (fallos <= 0) return 0
  const base = Math.min(cfg.maxEsperaMs, cfg.baseMs * Math.pow(cfg.factor, fallos - 1))
  const ruido = base * cfg.jitter * (aleatorio() * 2 - 1)
  return Math.max(0, Math.round(base + ruido))
}

/** `ok` = refrescando normal · `degradado` = fallando pero todavía reintenta · `rendido` = mudo. */
export type EstadoRefresco = 'ok' | 'degradado' | 'rendido'

export interface DetalleEstado {
  estado: EstadoRefresco
  fallos: number
  /** Timestamp (ms) hasta el cual no se sale a la red. 0 = puede intentar ya. */
  esperaHasta: number
  /** Último status HTTP visto, o null si el fetch ni siquiera llegó a responder. */
  ultimoStatus: number | null
}

export interface OpcionesBreaker {
  cfg?: ConfigRefresco
  ahora?: () => number
  aleatorio?: () => number
  /** Se llama SOLO cuando el estado cambia, no en cada fallo. */
  onEstado?: (detalle: DetalleEstado) => void
}

export class CortacircuitosRefresco {
  private readonly cfg: ConfigRefresco
  private readonly ahora: () => number
  private readonly aleatorio: () => number
  private readonly onEstado?: (detalle: DetalleEstado) => void

  private fallos = 0
  private esperaHasta = 0
  private rendido = false
  private ultimoStatus: number | null = null

  constructor(opts: OpcionesBreaker = {}) {
    this.cfg = opts.cfg ?? CONFIG_REFRESCO
    this.ahora = opts.ahora ?? Date.now
    this.aleatorio = opts.aleatorio ?? Math.random
    this.onEstado = opts.onEstado
  }

  get estado(): EstadoRefresco {
    if (this.rendido) return 'rendido'
    return this.fallos > 0 ? 'degradado' : 'ok'
  }

  detalle(): DetalleEstado {
    return {
      estado: this.estado,
      fallos: this.fallos,
      esperaHasta: this.esperaHasta,
      ultimoStatus: this.ultimoStatus,
    }
  }

  /** ¿Se puede salir a la red ahora, o hay que cortar el intento localmente? */
  permiteIntento(): boolean {
    if (this.rendido) return false
    return this.ahora() >= this.esperaHasta
  }

  registrarExito(): void {
    const habiaProblema = this.fallos > 0 || this.rendido
    this.fallos = 0
    this.esperaHasta = 0
    this.rendido = false
    this.ultimoStatus = 200
    if (habiaProblema) this.onEstado?.(this.detalle())
  }

  registrarFallo(status: number | null): void {
    const estadoPrevio = this.estado
    this.fallos += 1
    this.ultimoStatus = status
    if (this.fallos >= this.cfg.maxFallos) {
      this.rendido = true
      this.esperaHasta = Number.POSITIVE_INFINITY
    } else {
      this.esperaHasta = this.ahora() + esperaMs(this.fallos, this.cfg, this.aleatorio)
    }
    if (this.estado !== estadoPrevio) this.onEstado?.(this.detalle())
  }

  /** Volver a intentar por decisión del usuario (botón "Reintentar"). */
  reiniciar(): void {
    const habiaProblema = this.fallos > 0 || this.rendido
    this.fallos = 0
    this.esperaHasta = 0
    this.rendido = false
    if (habiaProblema) this.onEstado?.(this.detalle())
  }
}

/**
 * Respuesta sintética del cortocircuito. 503 a propósito: es el único rango que auth-js trata
 * como reintentable, y por lo tanto el único que NO le hace borrar la sesión guardada.
 */
function respuestaCortocircuito(detalle: DetalleEstado): Response {
  const cuerpo = JSON.stringify({
    error: 'circuito_abierto',
    error_description:
      `Refresco de sesión cortado localmente tras ${detalle.fallos} fallo(s) del backend ` +
      `(último status: ${detalle.ultimoStatus ?? 'sin respuesta'}).`,
  })
  return new Response(cuerpo, {
    status: 503,
    statusText: 'Service Unavailable (cortacircuitos local)',
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Envuelve un `fetch` para que el refresco de sesión respete el cortacircuitos.
 * Cualquier otra request pasa sin tocar — esto NO es un wrapper de red genérico.
 */
export function envolverFetchConCortacircuitos(
  fetchBase: typeof fetch,
  breaker: CortacircuitosRefresco,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!esRefrescoDeSesion(urlDe(input))) return fetchBase(input, init)

    if (!breaker.permiteIntento()) return respuestaCortocircuito(breaker.detalle())

    try {
      const res = await fetchBase(input, init)
      if (esFalloDeBackend(res.status)) breaker.registrarFallo(res.status)
      else breaker.registrarExito()
      return res
    } catch (e) {
      // El fetch ni siquiera llegó a responder (red caída, DNS, CORS): cuenta como fallo.
      breaker.registrarFallo(null)
      throw e
    }
  }
}

/** Evento de ventana que emite el cliente cuando cambia el estado del refresco. */
export const EVENTO_ESTADO_REFRESCO = 'g360:estado-refresco-sesion'
