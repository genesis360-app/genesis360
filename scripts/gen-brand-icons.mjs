// Genera los iconos de marca de Genesis360 desde brand/logo-source.png.
// Uso: node scripts/gen-brand-icons.mjs
//
// Salidas en public/:
//   favicon-16x16.png, favicon-32x32.png        — transparente
//   favicon.ico                                 — multi-tamaño (16/32/48), transparente
//   android-chrome-192x192.png                  — transparente (también es el logo del sidebar)
//   android-chrome-512x512.png                  — transparente (purpose 'any')
//   apple-touch-icon.png (180)                  — fondo blanco + padding (iOS aplana lo transparente a negro)
//   android-chrome-512x512-maskable.png         — fondo blanco + padding (safe zone de Android)
//
// sharp y png-to-ico son devDependencies (no entran al bundle ni al build de Vercel).
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile, mkdir } from 'node:fs/promises'

const SRC = 'brand/logo-source.png'
const OUT = 'public'
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

// Logo a `size`px con fondo transparente (fit contain, sin recorte).
const transparent = (size) =>
  sharp(SRC).resize(size, size, { fit: 'contain', background: TRANSPARENT }).png()

// Logo con padding sobre fondo sólido (para apple-touch y maskable).
async function solid(size, bg, ratio = 0.8) {
  const inner = Math.round(size * ratio)
  const logo = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: TRANSPARENT }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: 'center' }]).png()
}

async function main() {
  await mkdir(OUT, { recursive: true })

  await transparent(16).toFile(`${OUT}/favicon-16x16.png`)
  await transparent(32).toFile(`${OUT}/favicon-32x32.png`)
  await transparent(192).toFile(`${OUT}/android-chrome-192x192.png`)
  await transparent(512).toFile(`${OUT}/android-chrome-512x512.png`)

  await (await solid(180, WHITE)).toFile(`${OUT}/apple-touch-icon.png`)
  await (await solid(512, WHITE)).toFile(`${OUT}/android-chrome-512x512-maskable.png`)

  // favicon.ico multi-tamaño
  const icoSizes = await Promise.all(
    [16, 32, 48].map((s) => transparent(s).toBuffer()),
  )
  await writeFile(`${OUT}/favicon.ico`, await pngToIco(icoSizes))

  console.log('✓ Iconos de marca generados en public/')
}

main().catch((e) => { console.error(e); process.exit(1) })
