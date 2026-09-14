// Postproducción de los videos de onboarding: placas, rótulos y música sobre una grabación cruda.
//
//   node scripts/video/postproducir.mjs <guion.json> <video-crudo.mp4> <salida.mp4>
//
// La grabación cruda sale de Playwright (`recordVideo`) convertida a MP4 con ffmpeg. Este script
// le agrega encima lo que la hace mirable: una placa de entrada, rótulos numerados que entran y
// salen con fundido, una placa de cierre y una cama de música sintetizada.
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
// ── ⚠️ Sobre la música ───────────────────────────────────────────────────────────────────────
// Se SINTETIZA acá (senos + tremolo + pasa-bajos) en vez de bajar una pista, para que no haya
// ningún problema de licencia en un video que se va a publicar. Queda a −18 dB de pico para que
// una voz encima no tenga que pelear.
//
// 🛑 **Claude no puede escuchar el resultado.** Verifica duración y niveles, nada más. Si suena
// mal, hay que reemplazarla: poner un `.wav`/`.mp3` propio y pasarlo en `guion.musica`.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = resolve(AQUI, 'overlay.html')

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])
const duracion = (f) =>
  parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', f]).toString().trim())

/** Acordes de la cama musical: Am – F – C – G. La 4ª nota va apenas desafinada: da calidez y le
 *  saca el "pitido" de un seno puro. */
const ACORDES = [
  [220, 261.63, 329.63, 440.7],
  [174.61, 220, 261.63, 349.9],
  [130.81, 164.81, 196.0, 262.1],
  [196.0, 246.94, 293.66, 392.8],
]

function musica(dir, segundos) {
  const partes = ACORDES.map((notas, i) => {
    const salida = join(dir, `acorde${i}.wav`)
    const entradas = notas.flatMap((f) => ['-f', 'lavfi', '-i', `sine=frequency=${f}:duration=8`])
    ff([...entradas,
      '-filter_complex',
      '[0][1][2][3]amix=inputs=4:duration=longest:normalize=0,volume=0.25,lowpass=f=1400,' +
      'tremolo=f=0.45:d=0.22,afade=t=in:st=0:d=1.2,afade=t=out:st=6.6:d=1.4',
      '-ar', '44100', salida])
    return salida
  })
  const lista = join(dir, 'acordes.txt')
  writeFileSync(lista, partes.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'))
  const loop = join(dir, 'loop32.wav')
  ff(['-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', loop])

  const salida = join(dir, 'musica.wav')
  const vueltas = Math.ceil(segundos / 32)
  ff(['-stream_loop', String(vueltas), '-i', loop, '-t', String(segundos),
    '-af', `afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, segundos - 3.5)}:d=3.5`, salida])
  return salida
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
  const audio = guion.musica ? resolve(guion.musica) : musica(dir, total)

  // 2. Rótulos. El desfase de la placa de entrada se suma acá, no en el guion.
  const offset = png.intro ? (guion.intro.segundos ?? 3) : 0
  const entradas = []
  const filtros = []
  let prev = '[0]'
  guion.rotulos.forEach((r, i) => {
    const idx = i + 1
    const d = r.desde + offset, h = r.hasta + offset
    entradas.push('-loop', '1', '-t', String(total + 1), '-i', png[`rot${i}`])
    filtros.push(`[${idx}]format=rgba,fade=t=in:st=${d}:d=0.5:alpha=1,` +
      `fade=t=out:st=${h - 0.5}:d=0.5:alpha=1[o${idx}]`)
    const out = i === guion.rotulos.length - 1 ? '[vout]' : `[v${idx}]`
    filtros.push(`${prev}[o${idx}]overlay=0:0:enable='between(t,${d},${h})'${out}`)
    prev = `[v${idx}]`
  })

  ff(['-i', base, ...entradas, '-i', audio,
    '-filter_complex', filtros.join(';'),
    '-map', '[vout]', '-map', `${guion.rotulos.length + 1}:a`,
    '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
    resolve(salida)])

  console.log(`OK ${salida} — ${duracion(resolve(salida)).toFixed(1)}s`)
  console.log('⚠️  La música es sintetizada y NO fue escuchada por nadie. Verificala antes de publicar.')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
