import { describe, it, expect, vi } from 'vitest'
import {
  CONFIG_REFRESCO,
  CortacircuitosRefresco,
  envolverFetchConCortacircuitos,
  esFalloDeBackend,
  esRefrescoDeSesion,
  esperaMs,
  type DetalleEstado,
} from '@/lib/authRefreshBreaker'

// D1 (tests/specs/uat-app.md, Tanda D — RESILIENCIA).
// El bug real: auth-js reintenta POST /auth/v1/token?grant_type=refresh_token sin techo global.
// Medido en los logs de edge de DEV (24 h al 2026-09-06): 595 requests, 563 con 5xx de Cloudflare
// y solo 32 con 200, sosteniendo ~65 requests/hora durante 5 horas seguidas de caída.
// Estos tests son la red que faltaba: ejercitan el backend DEGRADADO, no el sano.

const SIN_JITTER = () => 0.5 // ruido = base * jitter * (0.5*2 - 1) = 0 → esperas exactas
const URL_REFRESCO = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token'

function respuesta(status: number): Response {
  return new Response('{}', { status })
}

describe('esRefrescoDeSesion', () => {
  it('reconoce SOLO el endpoint de refresco', () => {
    expect(esRefrescoDeSesion(URL_REFRESCO)).toBe(true)
  })

  it('NO toca el login ni el resto de la API', () => {
    expect(esRefrescoDeSesion('https://x.supabase.co/auth/v1/token?grant_type=password')).toBe(false)
    expect(esRefrescoDeSesion('https://x.supabase.co/rest/v1/ventas?select=*')).toBe(false)
    expect(esRefrescoDeSesion('https://x.supabase.co/auth/v1/user')).toBe(false)
  })
})

describe('esFalloDeBackend', () => {
  it('cuenta los 5xx, incluidos los 52x de Cloudflare que vimos en DEV', () => {
    for (const s of [500, 502, 503, 504, 520, 521, 522, 524, 525]) {
      expect(esFalloDeBackend(s)).toBe(true)
    }
  })

  it('cuenta 429 y 408 — insistir contra quien ya nos frenó es la misma amplificación', () => {
    expect(esFalloDeBackend(429)).toBe(true)
    expect(esFalloDeBackend(408)).toBe(true)
  })

  it('NO cuenta una respuesta definitiva: 400/401 = refresh token inválido → login limpio', () => {
    expect(esFalloDeBackend(400)).toBe(false)
    expect(esFalloDeBackend(401)).toBe(false)
    expect(esFalloDeBackend(200)).toBe(false)
  })
})

describe('esperaMs', () => {
  it('crece exponencialmente: 2s, 4, 8, 16, 32…', () => {
    expect(esperaMs(0, CONFIG_REFRESCO, SIN_JITTER)).toBe(0)
    expect(esperaMs(1, CONFIG_REFRESCO, SIN_JITTER)).toBe(2_000)
    expect(esperaMs(2, CONFIG_REFRESCO, SIN_JITTER)).toBe(4_000)
    expect(esperaMs(3, CONFIG_REFRESCO, SIN_JITTER)).toBe(8_000)
    expect(esperaMs(4, CONFIG_REFRESCO, SIN_JITTER)).toBe(16_000)
    expect(esperaMs(5, CONFIG_REFRESCO, SIN_JITTER)).toBe(32_000)
  })

  it('nunca supera el techo de 5 minutos', () => {
    expect(esperaMs(9, CONFIG_REFRESCO, SIN_JITTER)).toBe(300_000)
    expect(esperaMs(50, CONFIG_REFRESCO, SIN_JITTER)).toBe(300_000)
  })

  it('el jitter se mantiene dentro de ±20% (N pestañas no reintentan todas en el mismo ms)', () => {
    expect(esperaMs(3, CONFIG_REFRESCO, () => 0)).toBe(6_400)   // -20%
    expect(esperaMs(3, CONFIG_REFRESCO, () => 1)).toBe(9_600)   // +20%
  })
})

describe('CortacircuitosRefresco', () => {
  it('tras un fallo NO deja salir a la red hasta que pase la espera', () => {
    let ahora = 1_000_000
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })

    expect(b.permiteIntento()).toBe(true)
    b.registrarFallo(522)
    expect(b.permiteIntento()).toBe(false)

    ahora += 1_999
    expect(b.permiteIntento()).toBe(false)
    ahora += 1
    expect(b.permiteIntento()).toBe(true)
  })

  it('un éxito borra el historial de fallos', () => {
    const ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    b.registrarFallo(522)
    b.registrarFallo(522)
    expect(b.estado).toBe('degradado')

    b.registrarExito()
    expect(b.estado).toBe('ok')
    expect(b.permiteIntento()).toBe(true)
    expect(b.detalle().fallos).toBe(0)
  })

  it('tras maxFallos se RINDE y no vuelve a salir a la red por más que pase el tiempo', () => {
    let ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    for (let i = 0; i < CONFIG_REFRESCO.maxFallos; i++) {
      ahora += 10 * 60_000
      b.registrarFallo(522)
    }
    expect(b.estado).toBe('rendido')

    ahora += 24 * 3600_000 // un día entero después
    expect(b.permiteIntento()).toBe(false)
  })

  it('reiniciar() (botón "Reintentar" del usuario) lo vuelve a habilitar', () => {
    let ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    for (let i = 0; i < CONFIG_REFRESCO.maxFallos; i++) { ahora += 10 * 60_000; b.registrarFallo(522) }
    expect(b.permiteIntento()).toBe(false)

    b.reiniciar()
    expect(b.estado).toBe('ok')
    expect(b.permiteIntento()).toBe(true)
  })

  it('onEstado avisa SOLO en los cambios de estado, no en cada fallo', () => {
    let ahora = 0
    const vistos: DetalleEstado[] = []
    const b = new CortacircuitosRefresco({
      ahora: () => ahora, aleatorio: SIN_JITTER, onEstado: (d) => vistos.push({ ...d }),
    })
    for (let i = 0; i < 3; i++) { ahora += 10 * 60_000; b.registrarFallo(522) }
    expect(vistos.map((v) => v.estado)).toEqual(['degradado'])

    b.registrarExito()
    expect(vistos.map((v) => v.estado)).toEqual(['degradado', 'ok'])
  })
})

describe('envolverFetchConCortacircuitos', () => {
  it('deja pasar sin tocar todo lo que NO es el refresco — incluso rendido', async () => {
    let ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    for (let i = 0; i < CONFIG_REFRESCO.maxFallos; i++) { ahora += 10 * 60_000; b.registrarFallo(522) }

    const base = vi.fn(async () => respuesta(200))
    const f = envolverFetchConCortacircuitos(base as unknown as typeof fetch, b)

    const res = await f('https://x.supabase.co/rest/v1/productos?select=*')
    expect(res.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('con el circuito abierto NO sale a la red y devuelve 503 — el 503 es el único que auth-js trata como reintentable, así que la sesión guardada SOBREVIVE', async () => {
    const ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    const base = vi.fn(async () => respuesta(522))
    const f = envolverFetchConCortacircuitos(base as unknown as typeof fetch, b)

    await f(URL_REFRESCO)              // 1er intento: sale a la red y falla
    expect(base).toHaveBeenCalledTimes(1)

    const res = await f(URL_REFRESCO)  // 2do: cortado localmente
    expect(base).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: 'circuito_abierto' })
  })

  it('un 400 (refresh token inválido) NO abre el circuito: es respuesta definitiva, la maneja auth-js', async () => {
    const ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    const base = vi.fn(async () => respuesta(400))
    const f = envolverFetchConCortacircuitos(base as unknown as typeof fetch, b)

    const res = await f(URL_REFRESCO)
    expect(res.status).toBe(400)
    expect(b.estado).toBe('ok')
    expect(b.permiteIntento()).toBe(true)
  })

  it('un fetch que ni responde (red caída) cuenta como fallo y se propaga', async () => {
    const ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    const base = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const f = envolverFetchConCortacircuitos(base as unknown as typeof fetch, b)

    await expect(f(URL_REFRESCO)).rejects.toThrow('Failed to fetch')
    expect(b.estado).toBe('degradado')
    expect(b.detalle().ultimoStatus).toBeNull()
  })

  it('el backend se recupera dentro de la ventana → sigue trabajando sin volver a loguearse', async () => {
    let ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    let status = 522
    const base = vi.fn(async () => respuesta(status))
    const f = envolverFetchConCortacircuitos(base as unknown as typeof fetch, b)

    await f(URL_REFRESCO)
    expect(b.estado).toBe('degradado')

    status = 200
    ahora += 2_000
    const res = await f(URL_REFRESCO)
    expect(res.status).toBe(200)
    expect(b.estado).toBe('ok')
  })

  // 🟥 EL TEST DE REGRESIÓN DE D1. Reproduce la caída real del 5/9: auth-js golpeando cada 30 s
  // durante 5 horas. Sin cortacircuitos son 600 requests contra un backend que ya se está
  // cayendo; con cortacircuitos son 10 y después silencio.
  it('caída sostenida de 5 h: la app deja de amplificarla', async () => {
    let ahora = 0
    const b = new CortacircuitosRefresco({ ahora: () => ahora, aleatorio: SIN_JITTER })
    const base = vi.fn(async () => respuesta(522))
    const f = envolverFetchConCortacircuitos(base as unknown as typeof fetch, b)

    const TICKS = (5 * 3600) / 30 // el ticker de auth-js: cada 30 s durante 5 h
    for (let i = 0; i < TICKS; i++) {
      await f(URL_REFRESCO)
      ahora += 30_000
    }

    expect(TICKS).toBe(600)
    expect(base.mock.calls.length).toBe(CONFIG_REFRESCO.maxFallos) // 10, no 600
    expect(b.estado).toBe('rendido')
  })
})
