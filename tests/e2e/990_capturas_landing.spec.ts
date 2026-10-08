/**
 * 990_capturas_landing.spec.ts — HERRAMIENTA, no test. Saca las capturas REALES de la app que usa la landing
 * (pedido de GO 2026-10-08: tenant de DEV "Almacén Jorgito", Sucursal Norte). No finaliza ninguna venta: solo arma el
 * carrito y mira pantallas.
 *
 *   CAPTURAS_LANDING=1 npm run test:e2e -- 990_capturas_landing.spec.ts --project=chromium
 *
 * Salida: test-results/landing/*.png (después se convierten a webp/jpg en public/landing/).
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const SALIDA = 'test-results/landing'

test.skip(process.env.CAPTURAS_LANDING !== '1', 'Herramienta de capturas de la landing: correr con CAPTURAS_LANDING=1')

async function prepararSesion(page: Page) {
  await goto(page, '/dashboard')
  await waitForApp(page)
  await page.evaluate((id) => {
    localStorage.setItem('sucursal-id', id)
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
    // Carrito limpio: el POS guarda un borrador por sucursal.
    for (const k of Object.keys(localStorage)) if (/cart|carrito/i.test(k)) localStorage.removeItem(k)
  }, NORTE)
}

/** La franja amarilla "Ambiente DEV — localhost" no existe en PROD: no va en una captura de la landing. */
async function ocultarFranjaDev(page: Page) {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('div'))) {
      if (/^⚠?\s*Ambiente DEV/.test((el.textContent ?? '').trim()) && el.children.length === 0) (el as HTMLElement).style.display = 'none'
    }
  })
}

async function agregarAlCarrito(page: Page, busqueda: string, nombre: RegExp) {
  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  // Como un usuario: foco + tecla por tecla (después de agregar uno, un `fill` solo no reabre la lista de resultados).
  // La lista se abre con el foco y se cierra 150 ms DESPUÉS del blur (setTimeout en VentasPage): si se vuelve a enfocar
  // antes, ese timeout la cierra igual. Se espera a que termine antes de volver al buscador.
  await buscador.evaluate((el: HTMLElement) => el.blur())
  await page.waitForTimeout(400)
  await buscador.click()
  await buscador.fill('')
  await buscador.pressSequentially(busqueda, { delay: 40 })
  const prod = page.locator('div.absolute.top-full button').filter({ hasText: nombre }).first()
  await expect(prod, `no apareció ${nombre} en el buscador del POS`).toBeVisible({ timeout: 15000 })
  await prod.click()
  await buscador.fill('')
}

test.describe('Capturas reales para la landing', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

  test('hero: Ventas con dos productos en el carrito (tablet)', async ({ page }) => {
    await prepararSesion(page)
    await goto(page, '/ventas')
    await waitForApp(page)
    await ocultarFranjaDev(page)
    // "Disponible" es el filtro por defecto del POS; la captura usa "Todos" (como la anterior).
    await page.getByRole('button', { name: /^Todos$/ }).first().click()
    await agregarAlCarrito(page, 'Coca Cola 1.5', /Coca Cola 1\.5L/i)
    // La Coca Cola 2.5L no tiene stock vendible en Norte (todo reservado por los e2e): va la yerba.
    await agregarAlCarrito(page, 'Yerba', /Yerba Mate La Cumbrecita/i)
    await expect(page.getByText(/2\s+productos/).first()).toBeVisible({ timeout: 8000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(800)   // que terminen las transiciones y el motor de precios
    // Mismo encuadre que la captura anterior: el contenido sin la barra lateral, 1184×760 (×2 = 2368×1520).
    const aside = await page.locator('aside').first().boundingBox()
    const x = Math.round(aside?.width ?? 256)
    await page.screenshot({ path: `${SALIDA}/pos-venta.png`, clip: { x, y: 0, width: 1184, height: 760 } })
    // Lo que muestra el carrito, para que el ticket dibujado de la landing coincida.
    const filas = await page.locator('text=/^\\$[\\d.]+$/').allTextContents()
    console.log('[capturas] montos visibles en el POS:', JSON.stringify(filas))
  })
})

test.describe('Capturas reales para la landing (celular)', () => {
  // 375×811 a 1.6 = 600×1298, el tamaño que usa `TelefonoPanel` en la landing.
  test.use({ viewport: { width: 375, height: 811 }, deviceScaleFactor: 1.6, isMobile: true, hasTouch: true })

  test('hero: Panel en el celular (candidatas por pestaña)', async ({ page }) => {
    await prepararSesion(page)
    await goto(page, '/dashboard')
    await page.waitForLoadState('networkidle').catch(() => {})
    await ocultarFranjaDev(page)
    for (const pestana of ['Ventas', 'Gastos', 'Productos']) {
      const btn = page.getByRole('button', { name: new RegExp(`^${pestana}$`) }).first()
      if (!(await btn.isVisible().catch(() => false))) continue
      await btn.click()
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${SALIDA}/panel-${pestana.toLowerCase()}.png` })
      const insights = page.getByRole('button', { name: /^Insights$/ }).first()
      if (await insights.isVisible().catch(() => false)) {
        await insights.click(); await page.waitForTimeout(1500)
        await page.screenshot({ path: `${SALIDA}/panel-${pestana.toLowerCase()}-insights.png` })
        await page.getByRole('button', { name: /^Gráficos$/ }).first().click().catch(() => {})
      }
    }
  })
})

// ── Bento de módulos: recortes de UN componente real por tarjeta (pedido de GO 2026-10-08) ─────────────────────────
/** El elemento más interno que contiene todos los textos (los ancestros vienen antes en el orden del documento). */
function bloqueCon(page: Page, ...textos: (string | RegExp)[]) {
  let loc = page.locator('div')
  for (const t of textos) loc = loc.filter({ has: page.getByText(t, { exact: typeof t === 'string' }) })
  return loc.last()
}

test.describe('Capturas reales para la landing (bento)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

  test('bento: inventario con sus LPN', async ({ page }) => {
    await prepararSesion(page)
    await goto(page, '/inventario')
    await waitForApp(page)
    await ocultarFranjaDev(page)
    await page.getByText('Coca Cola 1.5L Original', { exact: true }).first().click()
    await page.waitForTimeout(1500)
    const bloque = page.locator('div.divide-y > div').filter({ has: page.getByText('Coca Cola 1.5L Original', { exact: true }) }).first()
    await bloque.scrollIntoViewIfNeeded()
    await page.mouse.move(0, 0)
    await bloque.screenshot({ path: `${SALIDA}/bento-inventario.png` })
  })

  test('bento: caja abierta', async ({ page }) => {
    await prepararSesion(page)
    await goto(page, '/caja')
    await waitForApp(page)
    await ocultarFranjaDev(page)
    await page.getByRole('button', { name: /Caja1/ }).first().click()
    await page.waitForTimeout(2000)
    // El usuario de los tests ("E2E Tester") no va en la landing: se saca el nombre, no se inventa otro.
    await page.evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue?.includes('E2E Tester')) n.nodeValue = n.nodeValue.replace(/\s*·\s*E2E Tester/, '')
    })
    const tarjeta = bloqueCon(page, 'Apertura', 'Saldo actual')
    await tarjeta.screenshot({ path: `${SALIDA}/bento-caja.png` })
  })

  test('bento: cobro con dos medios de pago', async ({ page }) => {
    await prepararSesion(page)
    await goto(page, '/ventas')
    await waitForApp(page)
    await ocultarFranjaDev(page)
    await page.getByRole('button', { name: /^Todos$/ }).first().click()
    await agregarAlCarrito(page, 'Coca Cola 1.5', /Coca Cola 1\.5L/i)
    await agregarAlCarrito(page, 'Yerba', /Yerba Mate La Cumbrecita/i)
    const medio1 = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await medio1.selectOption('Efectivo')
    const montos = page.getByPlaceholder(/^Monto$/i)
    await montos.first().fill('2000')
    await page.getByText(/Agregar otro medio/i).first().click()
    const medio2 = page.locator('select').filter({ has: page.locator('option', { hasText: /^Transferencia$/ }) }).nth(1)
    await medio2.selectOption('Transferencia')
    await montos.nth(1).fill('2157')
    await montos.nth(1).blur()
    await page.waitForTimeout(800)
    const cobro = bloqueCon(page, 'Método de pago', /Total cubierto/)
    await cobro.scrollIntoViewIfNeeded()
    await page.mouse.move(0, 0)
    await cobro.screenshot({ path: `${SALIDA}/bento-cobro.png` })
  })
})

test.describe('Capturas reales para la landing (bento, caja en celular)', () => {
  // La tarjeta de Bento "Caja" es angosta: en vista de celular la caja se arma más alta y se lee.
  test.use({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true })

  test('bento: caja abierta (celular)', async ({ page }) => {
    await prepararSesion(page)
    await goto(page, '/caja')
    await page.waitForLoadState('networkidle').catch(() => {})
    await ocultarFranjaDev(page)
    await page.getByRole('button', { name: /Caja1/ }).first().click()
    await page.waitForTimeout(2000)
    await page.evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue?.includes('E2E Tester')) n.nodeValue = n.nodeValue.replace(/\s*·\s*E2E Tester/, '')
    })
    const tarjeta = bloqueCon(page, 'Apertura', 'Saldo actual')
    await tarjeta.scrollIntoViewIfNeeded()
    await tarjeta.screenshot({ path: `${SALIDA}/bento-caja-celular.png` })
  })
})
