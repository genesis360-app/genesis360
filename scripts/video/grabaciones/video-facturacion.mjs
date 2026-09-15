// Grabación del video "Activá la facturación electrónica" (distinto de la serie de onboarding). Guardada para repetir.
//
//   MAIL=… PW=… node scripts/video/grabaciones/video-facturacion.mjs <carpeta-salida>
//
// ⚠️ ESCRIBE DATOS en el negocio donde se loguea. Pensado para PROD, "Genesis360 Onboarding" (decisión de GO), que
// arranca SIN CUIT ni emisores. Carga:
//   · datos fiscales con el CUIT de EJEMPLO 20-12345678-9 (el mismo que muestra la app de placeholder; nunca un CUIT
//     real ni un certificado real en cámara), Monotributista, razón social del negocio de prueba;
//   · el punto de venta 2 "Local principal";
//   · genera el CSR con el asistente (la clave privada queda guardada del lado del servidor para ese emisor);
//   · prende "Habilitada" para mostrar el modo prueba y, FUERA DE CÁMARA, la vuelve a apagar.
// NO sube ningún .crt y NO toca el switch de producción.
//
// Si el negocio ya tiene CUIT cargado, aborta antes de empezar (no escribe dos veces).
//
// Deja el .webm, capturas para la guía y `clicks.json`. Convertir cortando entre `corte` y la marca `fin`:
//   ffmpeg -ss <corte> -to <corte + fin> -i <video.webm> -r 25 -c:v libx264 -crf 18 -pix_fmt yuv420p crudo.mp4

import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { crearDirector, prepararContexto } from '../director.mjs'

const OUT = process.argv[2]
if (!OUT || !process.env.MAIL || !process.env.PW) {
  console.error('uso: MAIL=… PW=… node scripts/video/grabaciones/video-facturacion.mjs <carpeta-salida>')
  process.exit(1)
}
const APP = 'https://app.genesis360.pro'
const CUIT_EJEMPLO = '20-12345678-9'

const ctx = await chromium.launchPersistentContext('', {
  headless: true, viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
})
await prepararContexto(ctx)
const page = await ctx.newPage()
const dir = crearDirector(page)
const p = (ms) => page.waitForTimeout(ms)
const foto = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {})
const scrollSuave = async (px, pasos = 14) => {
  for (let i = 0; i < pasos; i++) { await page.mouse.wheel(0, px / pasos); await p(28) }
}
const escribir = async (loc, texto, delay = 90) => {
  await dir.click(loc, { tipo: 'menor' })
  await loc.first().press('Control+a')
  await loc.first().pressSequentially(texto, { delay })
}
const alBorde = async (loc, margen = 90) => {
  await loc.first().evaluate((el, m) => { window.scrollBy({ top: el.getBoundingClientRect().top - m, behavior: 'smooth' }) }, margen)
  await p(900)
}
let escribio = false
// DESDE=punto-venta retoma una toma cortada después de guardar los datos fiscales (no los vuelve a escribir): se graba
// desde el punto de venta y en post se une a la primera parte con un fundido.
const DESDE = process.env.DESDE ?? 'datos'
const resumenFiscal = page.getByText('Identidad fiscal del emisor principal', { exact: true }).first()

try {
  // ── Fuera de cámara: login, tour y chequeo de estado
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(process.env.MAIL)
  await page.locator('input[type="password"]').fill(process.env.PW)
  await page.getByRole('button', { name: /Ingresar/i }).click(); await p(7000)
  const om = page.getByRole('button', { name: /Omitir tour/i }).first()
  if (await om.count().catch(() => 0)) { await om.click().catch(() => {}); await p(1200) }
  await page.goto(`${APP}/configuracion?tab=facturacion`, { waitUntil: 'networkidle' }); await p(4500)
  if (DESDE === 'datos') {
    if (!(await page.getByText('Completá los datos fiscales del negocio', { exact: false }).count())) {
      throw new Error('el negocio ya tiene datos fiscales cargados: no se graba para no escribir dos veces')
    }
  } else {
    if (!(await resumenFiscal.count())) throw new Error('DESDE=punto-venta pide los datos fiscales ya guardados')
    if (await page.getByText(/^[1-9]\d* configurados?$/).count()) {
      throw new Error('ya hay puntos de venta cargados: no se graba para no escribir dos veces')
    }
  }
  await dir.mover(900, 250, 6); await p(600)

  if (DESDE === 'datos') {
    // ── 1. Datos fiscales
    dir.empezar(); dir.marca('datos'); await p(2200)
    await escribir(page.getByPlaceholder(CUIT_EJEMPLO).first(), CUIT_EJEMPLO, 110); await p(500)
    const condicion = page.locator('select').filter({ has: page.locator('option[value="Monotributista"]') }).first()
    await dir.click(condicion, { tipo: 'menor' })
    await condicion.selectOption('Monotributista'); await p(700)
    await escribir(page.getByPlaceholder('Razón social ante AFIP').first(), 'Genesis360 Onboarding', 70); await p(400)
    await escribir(page.getByPlaceholder('Calle 123, Ciudad').first(), 'Av. de Mayo 1234, CABA', 70); await p(700)
    await alBorde(page.getByText('Datos para los comprobantes', { exact: false }), 140)
    const inicio = page.locator('input[type="date"]').first()
    await dir.click(inicio, { tipo: 'menor' })
    await inicio.fill('2024-03-01'); await p(1200)
    await foto('01-datos-fiscales')
    await alBorde(page.getByRole('button', { name: 'Guardar datos fiscales' }), 420)
    dir.marca('guardar')
    escribio = true
    await dir.click(page.getByRole('button', { name: 'Guardar datos fiscales' }), { tipo: 'guardar' })
    await resumenFiscal.waitFor({ timeout: 20000 })
    await p(1500)
  } else {
    // Arranca mostrando el resumen fiscal ya guardado (empalma con el final de la primera parte).
    await alBorde(resumenFiscal, 150)
    dir.empezar(); dir.marca('datos-guardados'); await p(2500)
  }
  await alBorde(resumenFiscal, 150)
  await p(1800); await foto('02-datos-guardados')

  // ── 2. Punto de venta
  const encabezadoPv = page.getByRole('button', { name: /Puntos de venta AFIP/ })
  await alBorde(encabezadoPv, 160)
  dir.marca('punto-venta')
  await dir.click(encabezadoPv, { tipo: 'abrir' }); await p(1200)
  await escribir(page.getByPlaceholder('1', { exact: true }).first(), '2', 160); await p(400)
  await escribir(page.getByPlaceholder('Ej: Local principal').first(), 'Local principal', 70); await p(600)
  await dir.click(page.getByRole('button', { name: 'Agregar', exact: true }), { tipo: 'agregar' })
  await page.getByText('0002', { exact: true }).waitFor({ timeout: 15000 }); await p(1800)
  await foto('03-punto-venta')

  // ── 3. Certificado: el asistente genera la clave y el CSR
  const encabezadoEmisores = page.getByRole('button', { name: /Emisores fiscales \(multi-CUIT\)/ })
  await alBorde(encabezadoEmisores, 120)
  dir.marca('emisores')
  await dir.click(encabezadoEmisores, { tipo: 'abrir' }); await p(1500)
  await dir.click(page.getByRole('button', { name: 'Certificado', exact: true }), { tipo: 'abrir' }); await p(1500)
  await alBorde(page.getByRole('button', { name: /Generar CSR automáticamente/ }), 260)
  await foto('04-asistente'); await p(1200)
  dir.marca('generar-csr')
  await dir.click(page.getByRole('button', { name: /Generar CSR automáticamente/ }), { tipo: 'confirmar' })
  const csr = page.locator('textarea[readonly]').first()
  await csr.waitFor({ timeout: 30000 }); await p(1200)
  await alBorde(page.getByText('Copiá este CSR y pegalo', { exact: false }), 150)
  dir.marca('csr'); await p(1500)
  await dir.mover(...(await (async () => {
    const b = await page.getByRole('button', { name: /Copiar/ }).first().boundingBox()
    return b ? [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] : [700, 400]
  })()), 22)
  await p(2200); await foto('05-csr')
  await scrollSuave(160); await p(1200)
  dir.marca('arca'); await p(4200)
  const cajaCrt = page.getByText('Archivo .crt de ARCA', { exact: true }).first()
  const b = await cajaCrt.boundingBox().catch(() => null)
  if (b) await dir.mover(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), 22)
  dir.marca('subir-crt'); await p(3200)
  await foto('06-subir-crt')

  // ── 4. Habilitar: arranca en modo prueba
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await p(1400)
  dir.marca('habilitar')
  const habilitar = page.getByLabel('Habilitar facturación electrónica (ARCA)')
  await dir.click(habilitar, { tipo: 'confirmar' })
  await page.getByText('Habilitada', { exact: true }).first().waitFor({ timeout: 15000 }); await p(1800)
  await foto('07-habilitada')
  await alBorde(page.getByText('Modo PRUEBA (homologación)', { exact: false }), 260)
  dir.marca('modo-prueba'); await p(1200)
  const sw = page.getByLabel('Emitir contra AFIP producción real')
  const bs = await sw.boundingBox().catch(() => null)
  if (bs) await dir.mover(Math.round(bs.x + bs.width / 2) - 40, Math.round(bs.y + bs.height / 2), 22)
  await p(4200); await foto('08-modo-prueba')
  dir.marca('fin'); await p(800)

  // ── Fuera de cámara: dejar la facturación deshabilitada en el negocio de prueba
  await page.evaluate(() => window.scrollTo({ top: 0 })); await p(800)
  await habilitar.click(); await p(2500)
  const estado = await page.getByText(/^(Habilitada|Deshabilitada)$/).first().innerText().catch(() => '?')
  console.log('estado final de la facturación:', estado)
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 300), '· escribió datos:', escribio)
  await foto('z-error'); dir.marca('error')
} finally {
  const video = page.video()
  await ctx.close()
  writeFileSync(`${OUT}/clicks.json`, JSON.stringify({ ...dir.datos(), video: video ? await video.path() : null }, null, 1))
}
