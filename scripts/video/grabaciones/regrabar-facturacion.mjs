// Regrabación de tramos del video "Activá la facturación electrónica".
//
//   MAIL=… PW=… TRAMO=A|B|PV node scripts/video/grabaciones/regrabar-facturacion.mjs <carpeta-salida>
//
// Las credenciales se pueden exportar a mano o dejarlas en `scripts/video/.env.video` (en .gitignore,
// plantilla en `.env.video.example`).
//
// ⚠️ Es el complemento de `video-facturacion.mjs`, que NO sirve para esto: sus dos modos abortan a
// propósito si el negocio ya tiene datos fiscales (`DESDE=datos`) o puntos de venta
// (`DESDE=punto-venta`), y "Genesis360 Onboarding" quedó con las dos cosas cargadas.
//
// ── Los tramos ───────────────────────────────────────────────────────────────────────────────────
//   TRAMO=PV  (el bueno, 2026-09-16) — resumen fiscal + alta del punto de venta, de una sola toma.
//     Reemplaza 16,83 → 34,63 s del crudo original (rótulos 2 y 3).
//     🛑 Por qué reemplaza TODO ese bloque y no solo el resumen: el resumen fiscal **queda en pantalla
//     mientras se carga el punto de venta**, así que regrabar solo 16,83→24,12 dejaba la fecha vieja
//     (29/2/2024, v1.227.0) visible ~8 s en el medio del video. Se verificó extrayendo cuadros del
//     render, no leyendo el log.
//     ⚠️ ESCRIBE: da de alta el punto de venta. Exige que NO haya ninguno cargado (hay que borrarlo
//     antes), porque si ya existe el alta falla y la toma se quema.
//
//   TRAMO=A   — solo el resumen fiscal (sin escribir). Quedó corto: el rótulo 2 tapa justo la línea
//     "Inicio de actividades", así que el dato corregido casi no se luce. Se conserva por si hace
//     falta un complemento, pero para el arreglo real usar PV.
//
//   TRAMO=B   — el cierre, encuadrando completo el recuadro "Modo PRUEBA". Reemplaza 65,13 → 70,97 s.
//     No escribió nada: el recuadro se muestra aun con la facturación deshabilitada, así que el
//     `if (!yaVisible)` no llegó a encender el toggle. Si alguna vez lo enciende, lo apaga en `finally`.
//
// Deja el .webm y `clicks.json` con las marcas `inicio`/`fin` para cortar:
//   ffmpeg -ss <corte+inicio> -t <fin> -i <video.webm> -r 25 -c:v libx264 -crf 18 -pix_fmt yuv420p x.mp4

import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { crearDirector, prepararContexto } from '../director.mjs'

const ENV_VIDEO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.video')
if (existsSync(ENV_VIDEO)) {
  for (const linea of readFileSync(ENV_VIDEO, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const OUT = process.argv[2]
const TRAMO = (process.env.TRAMO ?? '').toUpperCase()
if (!OUT || !process.env.MAIL || !process.env.PW || !['A', 'B', 'PV'].includes(TRAMO)) {
  console.error('uso: MAIL=… PW=… TRAMO=A|B|PV node scripts/video/grabaciones/regrabar-facturacion.mjs <carpeta-salida>')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
const APP = 'https://app.genesis360.pro'

const ctx = await chromium.launchPersistentContext('', {
  headless: true, viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
})
await prepararContexto(ctx)
const page = await ctx.newPage()
const dir = crearDirector(page)
const p = (ms) => page.waitForTimeout(ms)
const foto = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {})
const alBorde = async (loc, margen = 90) => {
  await loc.first().evaluate((el, m) => { window.scrollBy({ top: el.getBoundingClientRect().top - m, behavior: 'smooth' }) }, margen)
  await p(900)
}
const escribir = async (loc, texto, delay = 90) => {
  await dir.click(loc, { tipo: 'menor' })
  await loc.first().press('Control+a')
  await loc.first().pressSequentially(texto, { delay })
}

const resumenFiscal = page.getByText('Identidad fiscal del emisor principal', { exact: true }).first()
const habilitar = page.getByLabel('Habilitar facturación electrónica (ARCA)')
const recuadroModo = page.getByText('Modo PRUEBA (homologación)', { exact: false }).first()
let prendimosNosotros = false
let escribio = false

try {
  // ── Fuera de cámara: login y verificación del estado
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(process.env.MAIL)
  await page.locator('input[type="password"]').fill(process.env.PW)
  await page.getByRole('button', { name: /Ingresar/i }).click(); await p(7000)
  const om = page.getByRole('button', { name: /Omitir tour/i }).first()
  if (await om.count().catch(() => 0)) { await om.click().catch(() => {}); await p(1200) }
  await page.goto(`${APP}/configuracion?tab=facturacion`, { waitUntil: 'networkidle' }); await p(4500)

  // Los datos fiscales TIENEN que estar (esto regraba tramos de una toma ya hecha).
  if (!(await resumenFiscal.count())) {
    throw new Error('el negocio NO tiene datos fiscales cargados: esto regraba tramos de una toma ya hecha')
  }

  if (TRAMO === 'PV') {
    // ── Resumen fiscal + alta del punto de venta, de una sola toma ──
    if (await page.getByText(/^[1-9]\d* configurados?$/).count()) {
      throw new Error('ya hay un punto de venta cargado: borralo antes de grabar, o el alta falla y se quema la toma')
    }
    await alBorde(resumenFiscal, 150); await p(600)
    dir.empezar(); dir.marca('inicio'); await p(2200)
    // El resumen con la fecha YA corregida (1/3/2024): se le da aire para que se lea.
    await dir.mover(760, 330, 18); await p(2600)
    await foto('PV-01-resumen-fiscal')

    const encabezadoPv = page.getByRole('button', { name: /Puntos de venta AFIP/ })
    await alBorde(encabezadoPv, 160)
    dir.marca('punto-venta')
    await dir.click(encabezadoPv, { tipo: 'abrir' }); await p(1200)
    escribio = true
    await escribir(page.getByPlaceholder('1', { exact: true }).first(), '2', 160); await p(400)
    await escribir(page.getByPlaceholder('Ej: Local principal').first(), 'Local principal', 70); await p(600)
    await dir.click(page.getByRole('button', { name: 'Agregar', exact: true }), { tipo: 'agregar' })
    await page.getByText('0002', { exact: true }).waitFor({ timeout: 15000 }); await p(2000)
    await foto('PV-02-punto-venta')
    dir.marca('fin'); await p(800)
    console.log('TRAMO PV grabado. Verificá en PV-01 que el inicio de actividades diga 1/3/2024, y en PV-02 el 0002.')
  } else if (TRAMO === 'A') {
    await alBorde(resumenFiscal, 150); await p(600)
    dir.empezar(); dir.marca('inicio'); await p(2500)
    await dir.mover(760, 300, 18); await p(1400)
    await foto('A-01-resumen-fiscal')
    await dir.mover(760, 380, 14); await p(2600)
    await foto('A-02-inicio-actividades')
    dir.marca('fin'); await p(800)
    console.log('TRAMO A grabado. Verificá en A-02 que el inicio de actividades diga 1/3/2024.')
  } else {
    // ── TRAMO B · el cierre, encuadrando bien el recuadro de modo
    const yaVisible = await recuadroModo.count().catch(() => 0)
    if (!yaVisible) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await p(1200)
      await habilitar.click()
      prendimosNosotros = true
      await page.getByText('Habilitada', { exact: true }).first().waitFor({ timeout: 15000 }); await p(2000)
    }
    await alBorde(recuadroModo, 200); await p(900)
    dir.empezar(); dir.marca('inicio'); await p(2000)
    await foto('B-01-modo-prueba')
    await recuadroModo.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' })); await p(1400)
    await foto('B-02-encuadrado')
    const sw = page.getByLabel('Emitir contra AFIP producción real')
    const bs = await sw.boundingBox().catch(() => null)
    if (bs) await dir.mover(Math.round(bs.x + bs.width / 2) - 40, Math.round(bs.y + bs.height / 2), 22)
    await p(4200)
    await foto('B-03-switch-produccion')
    dir.marca('fin'); await p(800)
    console.log('TRAMO B grabado. Verificá en B-02 que el recuadro "Modo PRUEBA" entre completo.')
  }
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 300), '· escribió datos:', escribio)
  await foto('z-error'); dir.marca('error')
} finally {
  if (prendimosNosotros) {
    try {
      await page.evaluate(() => window.scrollTo({ top: 0 })); await p(800)
      await habilitar.click(); await p(2500)
      const estado = await page.getByText(/^(Habilitada|Deshabilitada)$/).first().innerText().catch(() => '?')
      console.log('estado final de la facturación (debe decir Deshabilitada):', estado)
    } catch (e) {
      console.log('🛑 NO SE PUDO APAGAR LA FACTURACIÓN — revisar a mano:', e.message.slice(0, 160))
    }
  }
  const video = page.video()
  await ctx.close()
  writeFileSync(`${OUT}/clicks.json`, JSON.stringify({ ...dir.datos(), tramo: TRAMO, video: video ? await video.path() : null }, null, 1))
}
