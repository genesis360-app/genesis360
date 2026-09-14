// Sintetizador de la cama musical de los videos de Genesis360.
//
//   node scripts/video/musica.mjs <spec.json> <salida.wav>
//
// ── Por qué un sintetizador propio y no ffmpeg ni una pista comprada ─────────────────────────
// 1. **Licencia**: se publica. Una pista bajada de cualquier lado es un problema legal esperando.
// 2. **Control de envolvente**: los filtros de ffmpeg (`sine` + `tremolo`) dan un pitido plano. Acá
//    hay ADSR, armónicos y detune reales, que es lo que separa "beep" de "instrumento".
// 3. 🔑 **Sincronía con el guion**: los videos se generan con `guion.json`, o sea que se conocen
//    los timestamps EXACTOS de cada momento (el negocio creado, el producto guardado, la caja que
//    cuadra). La música puede RESOLVER justo ahí. Con una pista comprada eso no se puede.
//
// ── ⚠️ Lo que este archivo NO puede hacer ───────────────────────────────────────────────────
// **Claude no escucha.** Verifica duración, LUFS, pico real y espectro — nada más. Todo juicio
// estético es de quien escucha. Por eso el flujo es: generar variantes → que GO elija.
//
// ── Decisiones discutidas con GO (2026-09-14) ───────────────────────────────────────────────
// · **Afinación**: el brief pedía A=432 Hz por ser "más orgánico". Eso no tiene respaldo — es un
//   mito de audio. Pero como acá se sintetiza TODO desde cero, no hay nada con qué desafinar, así
//   que el costo es cero y queda como parámetro (`afinacion`) para decidir con el oído.
// · **Loudness**: el brief pedía -18 LUFS "debajo de la voz". Nuestros videos HOY no tienen voz, y
//   sin voz la música ES el programa. Dos objetivos distintos:
//     - `sinVoz`  → -14 LUFS (lo que normaliza YouTube; si se entrega más bajo, YouTube no lo sube)
//     - `conVoz`  → -26 LUFS (el hueco de 2.5-4 kHz se aplica en el master, no acá).
// · **Hueco para la voz**: NO se hace acá — va en la cadena de master con un biquad. Ver la nota
//   larga más abajo: el primer intento no funcionaba, y además sobre esta cama es casi cosmético.
//   El ducking dinámico (sidechain) recién se puede hacer cuando exista la pista de voz.

import { readFileSync, writeFileSync } from 'node:fs'

const SR = 44100

// ── Notas ────────────────────────────────────────────────────────────────────────────────────
const SEMI = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 }
/** Frecuencia de una nota tipo "F#4" según la afinación de referencia (A4). */
function frec(nota, a4) {
  const m = nota.match(/^([A-G]#?)(-?\d)$/)
  if (!m) throw new Error('nota inválida: ' + nota)
  const [, n, oct] = m
  return a4 * Math.pow(2, SEMI[n] / 12 + (Number(oct) - 4))
}

// ── Envolvente ADSR ──────────────────────────────────────────────────────────────────────────
// Lo que convierte un seno en algo que suena a instrumento. Un ataque de 0 ms es lo que hace que
// un tono sintetizado suene a alarma.
function adsr(i, n, { a = 0.15, d = 0.2, s = 0.7, r = 0.4 }) {
  const t = i / SR, dur = n / SR
  const tr = dur - r
  if (t < a) return t / a
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d)
  if (t < tr) return s
  return Math.max(0, s * (1 - (t - tr) / r))
}

/**
 * Una nota con cuerpo: fundamental + armónicos + un par de voces apenas desafinadas.
 * El detune es lo que da "coro"/calidez; sin él, dos senos suman y suenan a sirena.
 */
function nota(freq, dur, { ganancia = 0.2, env = {}, armonicos = [1, 0.45, 0.22, 0.1], detune = 3 } = {}) {
  const n = Math.floor(dur * SR)
  const buf = new Float32Array(n)
  const voces = [0, -detune, detune]                   // cents
  for (let i = 0; i < n; i++) {
    let v = 0
    for (const cents of voces) {
      const f = freq * Math.pow(2, cents / 1200)
      for (let h = 0; h < armonicos.length; h++) {
        v += armonicos[h] * Math.sin(2 * Math.PI * f * (h + 1) * i / SR)
      }
    }
    buf[i] = (v / (voces.length * armonicos.length)) * ganancia * adsr(i, n, env)
  }
  return buf
}

/** Percusión suave: ruido filtrado con caída rápida. Marca el pulso sin taladrar. */
function pulso(dur, { ganancia = 0.05, corte = 0.35 } = {}) {
  const n = Math.floor(dur * SR)
  const buf = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const ruido = Math.random() * 2 - 1
    prev = prev + corte * (ruido - prev)                // pasa-bajos de 1 polo
    buf[i] = prev * ganancia * Math.exp(-i / (SR * 0.06))
  }
  return buf
}

// ── Mezcla ───────────────────────────────────────────────────────────────────────────────────
function mezclar(destino, fuente, offsetSeg) {
  const off = Math.floor(offsetSeg * SR)
  for (let i = 0; i < fuente.length; i++) {
    const j = off + i
    if (j >= 0 && j < destino.length) destino[j] += fuente[i]
  }
}

/** Reverb Schroeder: 4 peines + 2 pasa-todo. Da el "aire premium" que pide el brief. */
function reverb(buf, { mezcla = 0.28, tam = 1 } = {}) {
  const combs = [1557, 1617, 1491, 1422].map(d => Math.floor(d * tam))
  const allp = [225, 556].map(d => Math.floor(d * tam))
  const out = new Float32Array(buf.length)
  for (const d of combs) {
    const linea = new Float32Array(d)
    let idx = 0
    for (let i = 0; i < buf.length; i++) {
      const y = linea[idx]
      linea[idx] = buf[i] + y * 0.78
      out[i] += y / combs.length
      idx = (idx + 1) % d
    }
  }
  for (const d of allp) {
    const linea = new Float32Array(d)
    let idx = 0
    for (let i = 0; i < out.length; i++) {
      const y = linea[idx]
      const x = out[i]
      linea[idx] = x + y * 0.5
      out[i] = y - x * 0.5
      idx = (idx + 1) % d
    }
  }
  const res = new Float32Array(buf.length)
  for (let i = 0; i < buf.length; i++) res[i] = buf[i] * (1 - mezcla) + out[i] * mezcla
  return res
}

// ── 🛑 Sobre el "hueco para la voz" (2.5–4 kHz) ─────────────────────────────────────────────
// El brief pedía cavarlo acá. Se intentó con filtros de un polo y **no funcionaba**: 0,4 dB de
// cavado medido, contra los ~8 dB que el comentario afirmaba. Un polo tiene faldas de 6 dB/oct:
// demasiado suave para abrir un pocket.
//
// Va en la **cadena de master**, con un biquad de verdad, y no acá:
//     equalizer=f=3250:width_type=o:width=0.9:g=-9     → 4,3 dB reales en la banda aislada
//
// ⚠️ **Y sobre esta cama concreta, es casi cosmético.** Medido: la banda 2.5-4 kHz está **36 dB por
// debajo** del total de la mezcla. Los pads viven abajo y el arpegio (D5-A5) apenas roza esa zona.
// El consejo del brief es correcto pero está pensado para una mezcla DENSA (cuerdas, piano
// brillante, batería). Acá el problema de inteligibilidad no existe todavía.
//
// ⚠️ **Ojo al medir**: `bandpass` de ffmpeg es de 2 polos y deja pasar los graves, que están 25 dB
// más arriba y tapan la lectura. Para medir una banda hay que aislarla en serio (4 polos por falda).

// ── Armonía ──────────────────────────────────────────────────────────────────────────────────
const ACORDES = {
  D:     ['D3', 'F#3', 'A3', 'D4'],
  A:     ['A2', 'C#3', 'E3', 'A3'],
  Bm:    ['B2', 'D3', 'F#3', 'B3'],
  G:     ['G2', 'B2', 'D3', 'G3'],
  Dsus4: ['D3', 'G3', 'A3', 'D4'],
}
const ARPEGIOS = {
  D:     ['D5', 'F#5', 'A5', 'F#5'],
  A:     ['E5', 'A5', 'C#6', 'A5'],
  Bm:    ['F#5', 'B5', 'D6', 'B5'],
  G:     ['D5', 'G5', 'B5', 'G5'],
  Dsus4: ['G5', 'A5', 'D6', 'A5'],
}

export function construir(spec) {
  const {
    duracion, bpm = 100, afinacion = 440,
    intro = 10, outro = 6,
    arpegio = true, pulsoRitmico = true,
    destino = 'sinVoz',
    acentos = [],                                       // segundos donde marcar un momento clave
  } = spec

  const compas = (60 / bpm) * 4                         // 4/4
  const n = Math.floor(duracion * SR)
  const mono = new Float32Array(n)
  const f = (x) => frec(x, afinacion)

  // ── Sección 1 · Introducción: I – IV, solo pads. Baja la resistencia, no invade.
  let t = 0
  const introAcordes = ['D', 'G']
  let k = 0
  while (t < intro) {
    const ac = introAcordes[k++ % introAcordes.length]
    for (const nn of ACORDES[ac]) {
      mezclar(mono, nota(f(nn), compas * 1.15, {
        ganancia: 0.16, env: { a: 0.8, d: 0.5, s: 0.72, r: 1.1 }, armonicos: [1, 0.3, 0.12],
      }), t)
    }
    t += compas
  }

  // ── Sección 2 · Cuerpo: I – V – vi – IV. Entra el arpegio y el pulso. Genera dinamismo.
  const finCuerpo = Math.max(intro, duracion - outro)
  const prog = ['D', 'A', 'Bm', 'G']
  k = 0
  while (t < finCuerpo) {
    const ac = prog[k++ % prog.length]
    for (const nn of ACORDES[ac]) {
      mezclar(mono, nota(f(nn), compas * 1.15, {
        ganancia: 0.15, env: { a: 0.5, d: 0.4, s: 0.7, r: 0.9 }, armonicos: [1, 0.35, 0.15, 0.06],
      }), t)
    }
    if (arpegio) {
      const paso = compas / 4
      ARPEGIOS[ac].forEach((nn, i) => {
        mezclar(mono, nota(f(nn), paso * 0.9, {
          ganancia: 0.075, env: { a: 0.01, d: 0.25, s: 0.25, r: 0.3 }, armonicos: [1, 0.18], detune: 1.5,
        }), t + i * paso)
      })
    }
    if (pulsoRitmico) {
      for (let b = 0; b < 4; b++) if (b % 2 === 1) mezclar(mono, pulso(0.25), t + b * (compas / 4))
    }
    t += compas
  }

  // ── Sección 3 · Cierre: Dsus4 → D. La resolución cae con el logo.
  const mitad = outro / 2
  for (const nn of ACORDES.Dsus4) {
    mezclar(mono, nota(f(nn), mitad * 1.1, {
      ganancia: 0.17, env: { a: 0.35, d: 0.3, s: 0.75, r: 0.8 }, armonicos: [1, 0.32, 0.14],
    }), finCuerpo)
  }
  for (const nn of [...ACORDES.D, 'F#4', 'A4']) {
    mezclar(mono, nota(f(nn), mitad * 1.6, {
      ganancia: 0.16, env: { a: 0.25, d: 0.6, s: 0.6, r: Math.max(1.2, mitad) }, armonicos: [1, 0.3, 0.13, 0.05],
    }), finCuerpo + mitad)
  }

  // ── Acentos: un brillo suave en los momentos clave del guion ────────────────────────────────
  for (const seg of acentos) {
    for (const nn of ['D5', 'A5', 'D6']) {
      mezclar(mono, nota(f(nn), 1.4, {
        ganancia: 0.05, env: { a: 0.005, d: 0.5, s: 0.12, r: 0.8 }, armonicos: [1, 0.25, 0.08], detune: 1,
      }), seg)
    }
  }

  // ── Tratamiento ──────────────────────────────────────────────────────────────────────────────
  // El pocket para la voz NO se hace acá (ver la nota de arriba): va en el master.
  const mezcla = reverb(mono, { mezcla: 0.3 })

  // Fundidos de entrada y salida
  const fin = Math.floor(2.5 * SR), fout = Math.floor(3.5 * SR)
  for (let i = 0; i < fin && i < n; i++) mezcla[i] *= i / fin
  for (let i = 0; i < fout && i < n; i++) mezcla[n - 1 - i] *= i / fout

  return mezcla
}

/** WAV 16 bits estéreo. El estéreo es leve y los graves quedan al centro (se ve en celular). */
export function escribirWav(mono, ruta) {
  const n = mono.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28)
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)

  // Ensanchado leve por retardo (Haas) solo en el canal derecho.
  const retardo = Math.floor(0.012 * SR)
  for (let i = 0; i < n; i++) {
    const L = mono[i]
    const R = mono[i] * 0.82 + (mono[Math.max(0, i - retardo)] ?? 0) * 0.18
    const cl = (x) => Math.max(-1, Math.min(1, x))
    buf.writeInt16LE(Math.round(cl(L) * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(cl(R) * 32767), 46 + i * 4)
  }
  writeFileSync(ruta, buf)
}

if (process.argv[1] && process.argv[1].endsWith('musica.mjs')) {
  const [specPath, salida] = process.argv.slice(2)
  if (!specPath || !salida) {
    console.error('uso: node scripts/video/musica.mjs <spec.json> <salida.wav>')
    process.exit(1)
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  escribirWav(construir(spec), salida)
  console.log(`OK ${salida} — ${spec.duracion}s · ${spec.bpm ?? 100} BPM · A=${spec.afinacion ?? 440} Hz · ${spec.destino ?? 'sinVoz'}`)
  console.log('⚠️  Nadie escuchó esto todavía. Verificalo antes de publicar.')
}
