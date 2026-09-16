// Regrabación de los 2 tramos del video "Activá la facturación electrónica" que salieron con defectos.
//
//   MAIL=… PW=… TRAMO=A node scripts/video/grabaciones/regrabar-facturacion.mjs <carpeta-salida>
//   MAIL=… PW=… TRAMO=B node scripts/video/grabaciones/regrabar-facturacion.mjs <carpeta-salida>
//
// ⚠️ Es el complemento de `video-facturacion.mjs`, que NO sirve para esto: sus dos modos abortan a
// propósito si el negocio ya tiene datos fiscales (`DESDE=datos`) o puntos de venta
// (`DESDE=punto-venta`), y "Genesis360 Onboarding" quedó justamente con las dos cosas cargadas.
// Este script hace lo contrario: **exige** que ya estén cargados y NO escribe ninguno de esos datos.
//
// Qué se regraba y por qué (defectos del render del 2026-09-15):
//   · TRAMO A — el resumen "Identidad fiscal del emisor principal" mostraba el inicio de actividades
//     un día antes (01/03/2024 → 29/2/2024). Lo arregla `v1.227.1`, EN PROD desde el 2026-09-16, así
//     que ahora la misma pantalla se ve bien. Reemplaza 16,83 s → 24,12 s del crudo (rótulo 2).
//   · TRAMO B — el cierre no encuadraba el recuadro "Modo PRUEBA (homologación)".
//     Reemplaza 65,13 s → 70,97 s del crudo (rótulo 8).
//
// 🛑 Lo único que este script puede escribir es el toggle "Habilitar facturación electrónica", y solo
// en el TRAMO B: el recuadro de modo no se muestra con la facturación apagada. Replica el criterio de
// la toma original — se prende para la toma y **se vuelve a apagar fuera de cámara**, en `finally`,
// aunque la grabación falle. Si al llegar el recuadro ya estuviera visible, no toca nada.
// NO sube ningún .crt, NO genera CSR y NO toca el switch de producción.
//
// Deja el .webm y `clicks.json` con las marcas `inicio`/`fin` para cortar:
//   ffmpeg -ss <inicio> -to <fin> -i <video.webm> -r 25 -c:v libx264 -crf 18 -pix_fmt yuv420p tramoX.mp4

import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { crearDirector, prepararContexto } from '../director.mjs'

// Credenciales: se pueden exportar a mano (MAIL=… PW=…) o dejarlas en `scripts/video/.env.video`,
// que está en .gitignore y nunca llega al repo. Formato del archivo, dos líneas:
//   MAIL=cuenta@ejemplo.com
//   PW=la-contraseña
const ENV_VIDEO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.video')
if (existsSync(ENV_VIDEO)) {
  for (const linea of readFileSync(ENV_VIDEO, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    // Lo exportado a mano gana sobre el archivo.
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const OUT = process.argv[2]
const TRAMO = (process.env.TRAMO ?? '').toUpperCase()
if (!OUT || !process.env.MAIL || !process.env.PW || !['A', 'B'].includes(TRAMO)) {
  console.error('uso: MAIL=… PW=… TRAMO=A|B node scripts/video/grabaciones/regrabar-facturacion.mjs <carpeta-salida>')
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

const resumenFiscal = page.getByText('Identidad fiscal del emisor principal', { exact: true }).first()
const habilitar = page.getByLabel('Habilitar facturación electrónica (ARCA)')
const recuadroModo = page.getByText('Modo PRUEBA (homologación)', { exact: false }).first()
let prendimosNosotros = false

try {
  // ── Fuera de cámara: login y verificación de que el negocio ya está configurado
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(process.env.MAIL)
  await page.locator('input[type="password"]').fill(process.env.PW)
  await page.getByRole('button', { name: /Ingresar/i }).click(); await p(7000)
  const om = page.getByRole('button', { name: /Omitir tour/i }).first()
  if (await om.count().catch(() => 0)) { await om.click().catch(() => {}); await p(1200) }
  await page.goto(`${APP}/configuracion?tab=facturacion`, { waitUntil: 'networkidle' }); await p(4500)

  // Al revés que `video-facturacion.mjs`: acá los datos TIENEN que estar. Si no, este script no
  // aplica (habría que grabar la toma completa, no un tramo).
  if (!(await resumenFiscal.count())) {
    throw new Error('el negocio NO tiene datos fiscales cargados: esto regraba tramos de una toma ya hecha')
  }

  if (TRAMO === 'A') {
    // ── TRAMO A · el resumen fiscal, ahora con la fecha correcta
    await alBorde(resumenFiscal, 150); await p(600)
    dir.empezar(); dir.marca('inicio')
    await p(2500)
    // Un paseo suave del cursor por el bloque para que la vista se sienta viva, sin clickear nada.
    await dir.mover(760, 300, 18); await p(1400)
    await foto('A-01-resumen-fiscal')
    await dir.mover(760, 380, 14); await p(2600)
    await foto('A-02-inicio-actividades')
    dir.marca('fin'); await p(800)
    console.log('TRAMO A grabado. Verificá en A-02 que el inicio de actividades diga 01/03/2024.')
  } else {
    // ── TRAMO B · el cierre, encuadrando bien el recuadro de modo
    const yaVisible = await recuadroModo.count().catch(() => 0)
    if (!yaVisible) {
      // Fuera de cámara: prender para que exista el recuadro. Se apaga sí o sí en `finally`.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await p(1200)
      await habilitar.click()
      prendimosNosotros = true
      await page.getByText('Habilitada', { exact: true }).first().waitFor({ timeout: 15000 }); await p(2000)
    }
    await alBorde(recuadroModo, 200); await p(900)
    dir.empezar(); dir.marca('inicio'); await p(2000)
    await foto('B-01-modo-prueba')
    // El defecto del render anterior fue el encuadre: se centra el recuadro en pantalla antes de
    // acercar el cursor al switch de producción, y se le da aire para que se lea completo.
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
  console.log('ERROR:', e.message.slice(0, 300))
  await foto('z-error'); dir.marca('error')
} finally {
  // Dejar el negocio como estaba: si lo prendimos nosotros, se apaga aunque la toma haya fallado.
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
