// Grabación del Video 4 — Vender (onboarding). Guardada para poder repetir la toma.
//
//   MAIL=… PW=… node scripts/video/grabaciones/video4-vender.mjs <carpeta-salida>
//
// ⚠️ ESCRIBE DATOS en el negocio donde se loguea: abre una caja y registra UNA venta (6 Gaseosas +
// 2 Yerbas, 5 % de descuento, transferencia $10.000 + efectivo $11.000 → vuelto $290). Necesita la
// caja CERRADA y stock de esos dos productos. Se grabó contra PROD sobre "Genesis360 Onboarding"
// por decisión de GO (continuidad visual con los videos 1-3, 5 y 8).
//
// Deja en la carpeta el .webm, capturas de control y `clicks.json` (corte + clicks + marcas) para
// `postproducir.mjs`. Convertir el crudo cortando desde `corte`:
//   ffmpeg -ss <corte> -i <video.webm> -r 25 -c:v libx264 -crf 18 -pix_fmt yuv420p crudo.mp4
//
// Aprendido en la toma del 2026-09-14 (ya corregido acá):
//   · `getByRole('button', { name: /^(Cerrar|Nueva venta)$/ })` agarró la PESTAÑA "Nueva venta" que
//     está detrás del modal del ticket: el ticket nunca se cerró y el resto de la toma quedó quieto.
//     → nombres exactos y del lado del modal.
//   · El link "Caja" del menú tiene de nombre accesible "Caja" + el punto de estado: `^Caja$` no
//     coincide. → `^\s*Caja\b` y solo dentro del menú lateral.
//   · El primer `input[type=number][placeholder="0"]` es el % del ÍTEM, no "Descuento general".

import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { crearDirector, prepararContexto } from '../director.mjs'

const OUT = process.argv[2]
if (!OUT || !process.env.MAIL || !process.env.PW) {
  console.error('uso: MAIL=… PW=… node scripts/video/grabaciones/video4-vender.mjs <carpeta-salida>')
  process.exit(1)
}
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
const scrollSuave = async (px, pasos = 14) => {
  for (let i = 0; i < pasos; i++) { await page.mouse.wheel(0, px / pasos); await p(28) }
}
const menu = (nombre) => page.locator('aside, nav').getByRole('link', { name: new RegExp(`^\\s*${nombre}\\b`) })
const escribir = async (loc, texto, delay = 150) => {
  await dir.click(loc, { tipo: 'menor' })
  await loc.first().press('Control+a')
  await loc.first().pressSequentially(texto, { delay })
  await loc.first().press('Tab')
}

try {
  // Fuera de cámara: login y tour
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(process.env.MAIL)
  await page.locator('input[type="password"]').fill(process.env.PW)
  await page.getByRole('button', { name: /Ingresar/i }).click(); await p(7000)
  const om = page.getByRole('button', { name: /Omitir tour/i }).first()
  if (await om.count().catch(() => 0)) { await om.click().catch(() => {}); await p(1200) }
  await page.goto(`${APP}/caja`, { waitUntil: 'networkidle' }); await p(4500)
  await dir.mover(1010, 330, 6); await p(600)

  // ── 1. Día siguiente: la caja está cerrada. Abrirla.
  dir.empezar(); dir.marca('caja-cerrada'); await p(2600)
  await dir.click(page.getByRole('button', { name: /Abrir caja/ }), { tipo: 'menor' }); await p(1300)
  await escribir(page.locator('input[type=number]:visible'), '10000', 170); await p(900)
  await dir.click(page.getByRole('button', { name: /Confirmar apertura/ }), { tipo: 'abrir' }); await p(3200)

  // ── 2. A vender: buscar y sumar al carrito
  await dir.click(menu('Ventas'), { tipo: 'navegar' }); await p(3200)
  dir.marca('venta')
  const buscar = page.locator('input[placeholder*="Buscar por nombre, SKU"]')
  await dir.click(buscar, { tipo: 'menor' })
  await buscar.first().pressSequentially('Gase', { delay: 120 }); await p(1500)
  await dir.click(page.getByText(/Gaseosa Cola/), { tipo: 'agregar' }); await p(1500)
  await escribir(page.locator('input[type=text]:visible').nth(1), '6', 160); await p(1300)
  await dir.click(buscar, { tipo: 'menor' })
  await buscar.first().pressSequentially('Yerba', { delay: 120 }); await p(1500)
  await dir.click(page.getByText(/Yerba Mate/), { tipo: 'agregar' }); await p(1400)
  await dir.click(page.getByRole('button', { name: '+', exact: true }).nth(1), { tipo: 'menor' }); await p(1600)

  // ── 3. Descuento general del 5 %
  dir.marca('descuento')
  await escribir(page.getByText('Descuento general', { exact: true }).locator('xpath=following::input[1]'), '5', 180)
  await p(1800)

  // ── 4. Cobro con dos medios, con vuelto
  await scrollSuave(520); await p(900)
  dir.marca('pago')
  const selMedio = page.locator('select:visible').filter({ has: page.locator('option', { hasText: 'Medio de pago...' }) })
  const montos = page.locator('input[placeholder="Monto"]:visible')
  await dir.click(selMedio.first(), { tipo: 'menor' })
  await selMedio.first().selectOption('Transferencia'); await p(700)
  await escribir(montos.first(), '10000', 120); await p(1100)
  await dir.click(page.getByRole('button', { name: /Agregar otro medio/ }), { tipo: 'menor' }); await p(900)
  await dir.click(selMedio.nth(1), { tipo: 'menor' })
  await selMedio.nth(1).selectOption('Efectivo'); await p(700)
  await escribir(montos.nth(1), '11000', 120); await p(2200)
  const estadoPago = await page.getByText(/Falta asignar|Vuelto|Total cubierto|Excede/).allInnerTexts().catch(() => [])
  if (!estadoPago.some((t) => /Vuelto|Total cubierto/.test(t))) throw new Error('el pago no quedó cubierto: ' + estadoPago.join(' | '))

  // ── 5. Venta directa → ticket
  await scrollSuave(360); await p(800)
  dir.marca('vender')
  await dir.click(page.getByRole('button', { name: /^Venta directa$/ }).last(), { tipo: 'cobrar' }); await p(4200)
  dir.marca('ticket'); await foto('ticket'); await p(2600)
  await dir.click(page.getByRole('button', { name: 'Cerrar', exact: true }).last(), { tipo: 'menor' }); await p(1500)

  // ── 6. El stock bajó solo
  await dir.click(menu('Inventario'), { tipo: 'navegar' }); await p(4200)
  dir.marca('inventario'); await foto('inventario'); await p(3800)

  // ── 7. Y la venta entró sola a la caja
  await dir.click(menu('Caja'), { tipo: 'navegar' }); await p(4200)
  dir.marca('caja'); await p(1200)
  await scrollSuave(380); await p(4500)
  await foto('caja')
  dir.marca('fin')
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 300)); await foto('z-error'); dir.marca('error')
} finally {
  const video = page.video()
  await ctx.close()
  writeFileSync(`${OUT}/clicks.json`, JSON.stringify({ ...dir.datos(), video: video ? await video.path() : null }, null, 1))
}
