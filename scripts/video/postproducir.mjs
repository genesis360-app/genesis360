// Postproducción de los videos de onboarding: placas, rótulos, efectos de click y música sobre una
// grabación cruda.
//
//   node scripts/video/postproducir.mjs <guion.json> <video-crudo.mp4> <salida.mp4>
//
// La grabación cruda sale de Playwright (`recordVideo`) convertida a MP4 con ffmpeg. Este script
// le agrega encima lo que la hace mirable: una placa de entrada, rótulos numerados que entran y
// salen con fundido, stickers de historieta y sacudidas en los clicks, una placa de cierre y una
// cama de música sintetizada.
//
// Ver `scripts/video/guion-ejemplo.json` para el formato del guion.
//
// ── Requisitos ───────────────────────────────────────────────────────────────────────────────
// `ffmpeg` y `ffprobe` en el PATH (ya instalados en la máquina de GO, 7.1.1).
//
// ── 🛑 Dos trampas que costaron encontrar ────────────────────────────────────────────────────
// 1. **`-loop 1` en cada PNG de overlay.** Sin eso, el PNG es UN SOLO FOTOGRAMA en t=0, y un
//    `fade=t=in:st=3.5` lo deja en alpha 0 para siempre: los rótulos salen INVISIBLES y el video
//    se ve "bien" salvo que no tiene ningún texto. No da error.
// 2. **Nada de `box-shadow` grande en los rótulos** (ver `overlay.html`): ffmpeg compone la sombra
//    semitransparente como un rectángulo negro duro al costado.
//
// ── ✨ Efectos de click ──────────────────────────────────────────────────────────────────────
// Si el guion trae `clicks` (o `clicksArchivo`, el JSON que escribe `director.mjs` al grabar), cada
// click importante lleva un sticker con onomatopeya y los que cierran algo sacuden la imagen. Toda
// la lógica está en `efectos.mjs`. Opciones del guion:
//   "efectos": false                          → sin stickers ni sacudidas
//   "efectos": { "semilla": 4, "sonido": false, "desfase": 0.1 }
// `desfase` corrige si el video de Playwright arrancó unas décimas antes o después del reloj.
//
// ── ⚠️ Sobre la música ───────────────────────────────────────────────────────────────────────
// La genera `musica.mjs` (sintetizador propio: ADSR, armónicos, detune, reverb Schroeder), no una
// pista bajada — esto se publica y una licencia ajena es un problema esperando.
//
// Parámetros fijados por GO escuchando muestras (2026-09-14): **432 Hz**, densidad actual como cama
// de fondo, y **sin acentos sincronizados** ("distraen, no suman"). Master a **-24 LUFS**: estuvo a
// -14 (lo que normaliza YouTube) y GO lo escuchó "saturando". Todo el detalle y lo que se discutió
// del brief original está en `G360.Wiki/wiki/manuales/plan-audio-videos.md`.
//
// Se puede pisar por guion: `musica` (ruta a un archivo propio) o `audio` (opciones del spec).
//
// 🛑 **Claude no escucha.** Verifica duración y niveles, nada más. El juicio estético es de quien
// escucha — y ya pasó que un oído detectara en 30 s un corte de frase que ninguna medición mostraba.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { construir, escribirWav } from './musica.mjs'
import { filtroSacudida, filtroStickers, pistaSfx, planificar, renderizarStickers } from './efectos.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = resolve(AQUI, 'overlay.html')

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])
const duracion = (f) =>
  parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', f]).toString().trim())

// La cama musical la genera `musica.mjs` (sintetizador propio con ADSR, armónicos, detune y
// reverb). Antes se hacía acá con `sine` de ffmpeg y sonaba a pitido plano.
//
// Parámetros fijados por GO escuchando muestras (2026-09-14):
//   · afinación 432 Hz · densidad actual como cama de fondo · SIN acentos sincronizados
// Ver `G360.Wiki/wiki/manuales/plan-audio-videos.md`.
function musica(dir, segundos, opciones = {}) {
  const salida = join(dir, 'cama.wav')
  escribirWav(construir({
    duracion: segundos,
    bpm: 100, afinacion: 432, intro: 8, outro: 7,
    arpegio: true, pulsoRitmico: true, destino: 'sinVoz', acentos: [],
    ...opciones,
  }), salida)

  // Master a -24 LUFS. Estuvo a -14 (a lo que normaliza YouTube) y GO lo escuchó "saturando": pidió
  // bajarla "por lo menos un 50%" → -10 dB, que es la mitad de volumen PERCIBIDO (-6 dB es la mitad
  // de amplitud, y al oído queda bastante más que la mitad). YouTube no sube lo que está por debajo
  // de -14: aceptado, la música es de fondo. Se puede pisar por guion con `audio.lufs`.
  const master = join(dir, 'cama-master.wav')
  const lufs = opciones.lufs ?? -24
  ff(['-i', salida, '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11`, '-ar', '44100', master])
  return master
}

/** Mezcla los efectos sonoros de los stickers sobre la pista de audio (sin normalizar la suma). */
function mezclarSfx(dir, audio, segundos, eventos) {
  if (!eventos.length) return audio
  const pista = join(dir, 'sfx.wav')
  escribirWav(pistaSfx(segundos, eventos), pista)
  const mezcla = join(dir, 'mezcla.wav')
  ff(['-i', audio, '-i', pista, '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0:duration=first',
    '-ar', '44100', mezcla])
  return mezcla
}

async function overlays(dir, guion) {
  const { chromium } = await import('@playwright/test')
  const ctx = await chromium.launchPersistentContext('', {
    headless: true, viewport: { width: 1280, height: 720 },
  })
  const page = await ctx.newPage()
  const base = 'file:///' + PLANTILLA.replace(/\\/g, '/')
  const hechos = {}
  const todos = [
    ['intro', guion.intro], ['outro', guion.outro],
    ...guion.rotulos.map((r, i) => [`rot${i}`, r]),
  ]
  for (const [nombre, cfg] of todos) {
    if (!cfg) continue
    const { desde, hasta, ...params } = cfg
    const archivo = join(dir, `${nombre}.png`)
    await page.goto(`${base}?${new URLSearchParams(params)}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.screenshot({ path: archivo, omitBackground: true })
    hechos[nombre] = archivo
  }
  await ctx.close()
  return hechos
}

function clicksDelGuion(guion, guionPath) {
  if (guion.efectos === false) return []
  const desfase = guion.efectos?.desfase ?? 0
  let clicks = guion.clicks
  if (!clicks && guion.clicksArchivo) {
    clicks = JSON.parse(readFileSync(resolve(dirname(guionPath), guion.clicksArchivo), 'utf8')).clicks
  }
  return (clicks ?? []).map((c) => ({ ...c, t: c.t + desfase }))
}

const [guionPath, crudo, salida] = process.argv.slice(2)
if (!guionPath || !crudo || !salida) {
  console.error('uso: node scripts/video/postproducir.mjs <guion.json> <crudo.mp4> <salida.mp4>')
  process.exit(1)
}
const guion = JSON.parse(readFileSync(guionPath, 'utf8'))
const dir = mkdtempSync(join(tmpdir(), 'g360video-'))

try {
  const png = await overlays(dir, guion)

  // 1. Placas de entrada y cierre como clips propios, a 25 fps para empalmar sin saltos.
  const clips = []
  const placa = (nombre, seg) => {
    const f = join(dir, `${nombre}.mp4`)
    ff(['-loop', '1', '-i', png[nombre], '-t', String(seg), '-r', '25',
      '-vf', `format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=${seg - 0.6}:d=0.6`,
      '-c:v', 'libx264', '-crf', '20', f])
    return f
  }
  if (png.intro) clips.push(placa('intro', guion.intro.segundos ?? 3))
  clips.push(resolve(crudo))
  if (png.outro) clips.push(placa('outro', guion.outro.segundos ?? 3.5))

  const lista = join(dir, 'clips.txt')
  writeFileSync(lista, clips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'))
  const base = join(dir, 'base.mp4')
  ff(['-f', 'concat', '-safe', '0', '-i', lista, '-r', '25',
    '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', base])

  const total = duracion(base)
  // El desfase de la placa de entrada se suma acá, no en el guion (rótulos, clicks y sonidos).
  const offset = png.intro ? (guion.intro.segundos ?? 3) : 0

  // 2. Efectos de click: qué clicks llevan sticker/sacudida, y los cuadros de cada sticker.
  const plan = planificar(
    clicksDelGuion(guion, guionPath).map((c) => ({ ...c, t: c.t + offset })),
    { semilla: guion.efectos?.semilla ?? 1 },
  )
  const stickers = await renderizarStickers(dir, plan)

  let audio = guion.musica ? resolve(guion.musica) : musica(dir, total, guion.audio ?? {})
  if (guion.efectos?.sonido !== false) audio = mezclarSfx(dir, audio, total, plan)

  // 3. Grafo de video: sacudida → rótulos → stickers (arriba de todo).
  const entradas = []
  const filtros = []
  filtros.push(...filtroSacudida('[0:v]', '[vsq]', plan.filter((s) => s.sacudir).map((s) => s.t)))

  let prev = '[vsq]'
  guion.rotulos.forEach((r, i) => {
    const idx = i + 1
    const d = r.desde + offset, h = r.hasta + offset
    entradas.push('-loop', '1', '-t', String(total + 1), '-i', png[`rot${i}`])
    filtros.push(`[${idx}]format=rgba,fade=t=in:st=${d}:d=0.5:alpha=1,` +
      `fade=t=out:st=${h - 0.5}:d=0.5:alpha=1[o${idx}]`)
    filtros.push(`${prev}[o${idx}]overlay=0:0:enable='between(t,${d},${h})'[v${idx}]`)
    prev = `[v${idx}]`
  })

  const primerSticker = guion.rotulos.length + 1
  for (const s of stickers) entradas.push('-framerate', '25', '-i', s.patron)
  filtros.push(...filtroStickers(prev, '[vout]', stickers, primerSticker))

  const indiceAudio = primerSticker + stickers.length
  ff(['-i', base, ...entradas, '-i', audio,
    '-filter_complex', filtros.join(';'),
    '-map', '[vout]', '-map', `${indiceAudio}:a`,
    '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-t', String(total), '-movflags', '+faststart',
    resolve(salida)])

  console.log(`OK ${salida} — ${duracion(resolve(salida)).toFixed(1)}s` +
    (plan.length ? ` · ${plan.length} stickers (${plan.map((s) => s.palabra).join(' ')}) · ` +
      `${plan.filter((s) => s.sacudir).length} sacudidas` : ''))
  console.log('⚠️  La música es sintetizada. Claude no la escucha: verificala antes de publicar.')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
