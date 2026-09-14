// Efectos de click de los videos: sticker de historieta, sacudida de cámara y "pop" sonoro.
//
// Pedido de GO (2026-09-14): el cursor no se ve en la grabación, así que no se entiende dónde se
// hace click. Cada click importante lleva un sticker con una onomatopeya que VARÍA según lo que hace
// el botón, y los que cierran algo (guardar, confirmar, cobrar) sacuden la imagen un instante.
//
// Entrada: los clicks que anotó `director.mjs` al grabar ({ t, x, y, tipo }).
// Todo es determinista (semilla fija): re-renderizar da exactamente el mismo video.
//
// Regla de mesura: como mucho un sticker cada ~2,4 s y una sacudida cada 3 s. El efecto tiene que dar
// ritmo, no tapar la pantalla que se está explicando.

import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = resolve(AQUI, 'sticker.html')
const VIDEO = { w: 1280, h: 720 }
export const STICKER = { w: 440, h: 280, fps: 25 }

export const TIPOS = {
  navegar:   { color: '#22D3EE', sacude: false, palabras: ['¡Adentro!', '¡Vamos!', '¡Zas!', '¡Toc!'] },
  agregar:   { color: '#A78BFA', sacude: false, palabras: ['¡Al carrito!', '¡Plop!', '¡Sumado!', '¡Uno más!'] },
  guardar:   { color: '#FFD60A', sacude: true,  palabras: ['¡Listo!', '¡Hecho!', '¡Pum!', '¡Anotado!'] },
  confirmar: { color: '#FF5FA2', sacude: true,  palabras: ['¡Confirmado!', '¡Dale!', '¡Bum!', '¡Eso!'] },
  cobrar:    { color: '#4ADE80', sacude: true,  palabras: ['¡Ka-ching!', '¡Vendido!', '¡Cha-chín!'] },
  abrir:     { color: '#FFB020', sacude: true,  palabras: ['¡Abierta!', '¡Clack!', '¡Arrancamos!'] },
  cerrar:    { color: '#FFB020', sacude: true,  palabras: ['¡Cuadra!', '¡Clack!', '¡Cerrado!'] },
  menor:     null, // tipear, elegir en un combo: solo el anillo del cursor, sin sticker
}

function generador(semilla) {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Decide qué clicks llevan sticker y/o sacudida, con qué palabra y dónde.
 * El sticker se ubica arriba a la derecha del click (el anillo del cursor ya marca el punto exacto,
 * así que el sticker no tapa el botón); si no entra, se espeja a la izquierda o abajo.
 */
export function planificar(clicks, { semilla = 1, escala = 0.68, separacionSticker = 2.4, separacionSacudida = 3 } = {}) {
  const azar = generador(semilla)
  const w = Math.round(STICKER.w * escala), h = Math.round(STICKER.h * escala)
  const bolsas = {}
  let ultimoSticker = -Infinity, ultimaSacudida = -Infinity, ultimaPalabra = ''
  const plan = []

  for (const c of [...clicks].sort((a, b) => a.t - b.t)) {
    const tipo = TIPOS[c.tipo]
    if (!tipo || c.t - ultimoSticker < separacionSticker) continue

    // Bolsa barajada por tipo: recorre todas las palabras antes de repetir, y nunca dos iguales seguidas.
    let palabra = c.palabra
    if (!palabra) {
      if (!bolsas[c.tipo]?.length) {
        bolsas[c.tipo] = [...tipo.palabras].sort(() => azar() - 0.5)
      }
      palabra = bolsas[c.tipo].pop()
      if (palabra === ultimaPalabra && bolsas[c.tipo].length) {
        const otra = bolsas[c.tipo].pop()
        bolsas[c.tipo].unshift(palabra)
        palabra = otra
      }
    }

    let cx = c.x + Math.round(w * 0.42)
    let cy = c.y - Math.round(h * 0.55)
    if (cx + w / 2 > VIDEO.w - 8) cx = c.x - Math.round(w * 0.42)
    if (cy - h / 2 < 8) cy = c.y + Math.round(h * 0.6)
    cx = Math.min(Math.max(cx, w / 2 + 6), VIDEO.w - w / 2 - 6)
    cy = Math.min(Math.max(cy, h / 2 + 6), VIDEO.h - h / 2 - 6)

    const sacudir = (c.sacudir ?? tipo.sacude) && c.t - ultimaSacudida >= separacionSacudida
    if (sacudir) ultimaSacudida = c.t
    ultimoSticker = c.t
    ultimaPalabra = palabra

    plan.push({
      t: c.t, tipo: c.tipo, palabra, color: tipo.color, sacudir,
      rot: Math.round(azar() * 20 - 12),
      semilla: Math.floor(azar() * 1e6),
      left: Math.round(cx - w / 2), top: Math.round(cy - h / 2), escala,
    })
  }
  return plan
}

/** Fotografía cada sticker cuadro por cuadro (PNG con alpha). Devuelve el patrón de archivos. */
export async function renderizarStickers(dir, plan) {
  if (!plan.length) return []
  const { chromium } = await import('@playwright/test')
  const ctx = await chromium.launchPersistentContext('', {
    headless: true, viewport: { width: STICKER.w, height: STICKER.h },
  })
  const page = await ctx.newPage()
  const base = 'file:///' + PLANTILLA.replace(/\\/g, '/')
  const hechos = []
  for (const [i, s] of plan.entries()) {
    const carpeta = join(dir, `sticker${i}`)
    mkdirSync(carpeta, { recursive: true })
    const q = new URLSearchParams({ palabra: s.palabra, color: s.color, rot: String(s.rot), semilla: String(s.semilla) })
    await page.goto(`${base}?${q}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => window.listo)
    const dur = await page.evaluate(() => window.duracion)
    const cuadros = Math.ceil((dur / 1000) * STICKER.fps)
    for (let f = 0; f <= cuadros; f++) {
      await page.evaluate((ms) => window.fijar(ms), (f * 1000) / STICKER.fps)
      await page.screenshot({ path: join(carpeta, `f${String(f).padStart(3, '0')}.png`), omitBackground: true })
    }
    hechos.push({ ...s, patron: join(carpeta, 'f%03d.png') })
  }
  await ctx.close()
  return hechos
}

/**
 * Sacudida: durante cada ventana se muestra una copia apenas agrandada (3 %) y recortada con un
 * desplazamiento que tiembla y se apaga. Fuera de las ventanas el cuadro original queda intacto,
 * sin perder nitidez.
 */
export function filtroSacudida(entrada, salida, tiempos, { amp = 9, dur = 0.32, zoom = 1.03 } = {}) {
  if (!tiempos.length) return [`${entrada}null${salida}`]
  const W2 = Math.round((VIDEO.w * zoom) / 2) * 2
  const H2 = Math.round((VIDEO.h * zoom) / 2) * 2
  const x0 = (W2 - VIDEO.w) / 2, y0 = (H2 - VIDEO.h) / 2
  const onda = (fn, frec, a0) => tiempos
    .map((a) => `if(between(t,${a},${a + dur}),${amp}*${fn}(${frec}*(t-${a}))*(1-(t-${a})/${dur}),0)`)
    .join('+') + `+${a0}`
  const enable = tiempos.map((a) => `between(t,${a},${a + dur})`).join('+')
  return [
    `${entrada}split[sq0][sq1]`,
    `[sq1]scale=${W2}:${H2},crop=${VIDEO.w}:${VIDEO.h}:x='${onda('sin', 88, x0)}':y='${onda('cos', 71, y0)}'[sqz]`,
    `[sq0][sqz]overlay=0:0:enable='${enable}'${salida}`,
  ]
}

/** Superpone cada secuencia de sticker en su instante. `primerIndice` = índice de input de ffmpeg. */
export function filtroStickers(entrada, salida, stickers, primerIndice) {
  if (!stickers.length) return [`${entrada}null${salida}`]
  const f = []
  let prev = entrada
  stickers.forEach((s, i) => {
    const out = i === stickers.length - 1 ? salida : `[vstk${i}]`
    f.push(`[${primerIndice + i}:v]format=rgba,scale=iw*${s.escala}:-1,setpts=PTS-STARTPTS+${s.t.toFixed(3)}/TB[stk${i}]`)
    f.push(`${prev}[stk${i}]overlay=${s.left}:${s.top}:eof_action=pass${out}`)
    prev = out
  })
  return f
}

/**
 * Pista de efectos sonoros sincronizada con los stickers: un "pop" con caída de tono en cada uno,
 * campanitas de caja registradora en los cobros y un golpe grave cuando la imagen se sacude.
 * Pico a -12 dBFS: tienen que oírse por encima de la música (a -24 LUFS) sin sobresaltar. A -18
 * quedaban tapados: medido en el Video 4, el cobro subía el pico de esa ventana apenas 0,9 dB.
 */
export function pistaSfx(duracion, eventos, SR = 44100) {
  const n = Math.ceil(duracion * SR)
  const out = new Float32Array(n)
  const sumar = (i, v) => { if (i >= 0 && i < n) out[i] += v }
  const tono = (i0, largo, frec, amp, caida, ataque = 0.002) => {
    let fase = 0
    for (let k = 0; k < Math.round(largo * SR); k++) {
      const s = k / SR
      fase += (2 * Math.PI * frec(s)) / SR
      sumar(i0 + k, amp * Math.min(1, s / ataque) * Math.exp(-s / caida) * Math.sin(fase))
    }
  }
  for (const e of eventos) {
    const i0 = Math.round(e.t * SR)
    tono(i0, 0.16, (s) => 320 + 820 * Math.exp(-s / 0.028), 0.5, 0.045)
    if (e.tipo === 'cobrar') {
      for (const [retardo, f] of [[0.06, 2093], [0.13, 2637]]) {
        tono(i0 + Math.round(retardo * SR), 0.45, () => f, 0.22, 0.16, 0.001)
        tono(i0 + Math.round(retardo * SR), 0.3, () => f * 2.01, 0.06, 0.08, 0.001)
      }
    }
    if (e.sacudir) tono(i0, 0.22, (s) => 55 + 45 * Math.exp(-s / 0.05), 0.6, 0.07, 0.004)
  }
  let pico = 0
  for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(out[i]))
  const objetivo = 10 ** (-12 / 20)
  if (pico > 0) for (let i = 0; i < n; i++) out[i] *= objetivo / pico
  return out
}
