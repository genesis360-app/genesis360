// Exploración de Config → Facturación en el negocio de prueba (SOLO LECTURA), antes de grabar el video y armar la guía
// de activación de facturación. No guarda nada: abre la pestaña, despliega secciones y saca capturas + el texto visible.
//
//   MAIL=… PW=… node scripts/video/grabaciones/explorar-facturacion.mjs <carpeta-salida>
//
// Lo único que clickea son encabezados de sección (despliegan/pliegan) y, si existe, el botón que abre el panel del
// certificado de un emisor y el "Asistente" (abren UI). Nunca "Generar", "Guardar", "Agregar" ni toggles.

import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = process.argv[2]
if (!OUT || !process.env.MAIL || !process.env.PW) {
  console.error('uso: MAIL=… PW=… node scripts/video/grabaciones/explorar-facturacion.mjs <carpeta-salida>')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
const APP = 'https://app.genesis360.pro'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const p = (ms) => page.waitForTimeout(ms)
const foto = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {})
const textos = []
const guardarTexto = async (etiqueta) => {
  const t = await page.locator('main').innerText().catch(() => '')
  textos.push(`===== ${etiqueta} =====\n${t}`)
}

try {
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(process.env.MAIL)
  await page.locator('input[type="password"]').fill(process.env.PW)
  await page.getByRole('button', { name: /Ingresar/i }).click(); await p(7000)
  const om = page.getByRole('button', { name: /Omitir tour/i }).first()
  if (await om.count().catch(() => 0)) { await om.click().catch(() => {}); await p(1200) }

  await page.goto(`${APP}/configuracion?tab=facturacion`, { waitUntil: 'networkidle' }); await p(4500)
  await foto('01-arriba')
  await guardarTexto('pestaña Facturación (inicial)')

  for (let i = 1; i <= 5; i++) {
    await page.mouse.wheel(0, 620); await p(700)
    await foto(`02-scroll-${i}`)
  }

  for (const [n, titulo] of [['03', 'Puntos de venta AFIP'], ['04', 'Certificados AFIP'], ['05', 'Emisores fiscales (multi-CUIT)']]) {
    const encabezado = page.getByText(titulo, { exact: true }).first()
    if (await encabezado.count().catch(() => 0)) {
      await encabezado.scrollIntoViewIfNeeded().catch(() => {})
      await encabezado.click().catch(() => {}); await p(1200)
      await encabezado.evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {})
      await page.mouse.wheel(0, -80); await p(600)
      await foto(`${n}-${titulo.replace(/[^A-Za-z]+/g, '-').toLowerCase()}`)
    }
  }
  await guardarTexto('secciones desplegadas')

  // Panel del certificado de un emisor y el asistente (solo abrir)
  const botonCert = page.getByRole('button', { name: /^(Certificado|Cert \/ PV)$/ }).first()
  if (await botonCert.count().catch(() => 0)) {
    await botonCert.scrollIntoViewIfNeeded().catch(() => {})
    await botonCert.click().catch(() => {}); await p(1500)
    await foto('06-panel-certificado')
    const asistente = page.getByRole('button', { name: /Asistente/ }).first()
    if (await asistente.count().catch(() => 0)) {
      await asistente.click().catch(() => {}); await p(1500)
      await foto('07-asistente')
      const dialogo = await page.locator('[role="dialog"]').last().innerText().catch(() => '')
      textos.push(`===== asistente =====\n${dialogo}`)
    }
  } else {
    textos.push('===== sin emisor: no hay botón de certificado =====')
  }
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 300)); await foto('z-error')
} finally {
  writeFileSync(`${OUT}/textos.txt`, textos.join('\n\n'))
  await browser.close()
}
