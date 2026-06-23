/**
 * 53_credito_a_favor_excede_mutante.spec.ts
 * E2E MUTANTE — Crédito a favor del cliente: no se puede aplicar más que el disponible (REGLA #0, plata).
 *
 * Guard L28 (`VentasPage.registrarVenta`, ~2451): si se aplica un pago "Crédito a favor" por un monto
 * mayor al saldo disponible del cliente (`cliente_creditos`), la venta se BLOQUEA y NO se crea. Aplicar
 * crédito inexistente sería "pagar" con plata que el cliente no tiene a favor → descuadre contable.
 *
 * Fixture SQL (DEV, Almacén Jorgito): cliente "ZZZ Credito Test" con $1 de crédito a favor
 * (cliente_creditos). En el POS se selecciona ese cliente, se agrega un producto y se intenta pagar
 * $100 con "Crédito a favor" (> $1 disponible).
 *
 * Aserción POSITIVA del bloqueo (toast "…No podés aplicar más que eso."); que NO se creó venta se
 * evidencia porque el carrito NO se limpia (registrarVenta corta antes de crear la venta). El CTA
 * "Venta directa" solo está disabled por `saving`, y el check de crédito corre ANTES que el de
 * cobertura de pago → alcanza el guard sin completar el cobro. Corre con OWNER (chromium) contra DEV.
 *
 * Re-ejecutable: el fixture queda intacto (el guard bloquea, no consume crédito). Skip-guard si ausente.
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

/** Setea un <input type=number> controlado por React (native value-setter + evento input burbujeante). */
async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Crédito a favor no supera el disponible (mutante)', () => {
  test('aplicar $100 de crédito con solo $1 disponible → bloquea, no crea venta', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto vendible (cualquiera) — patrón de la spec 19
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    if (!(await primerProducto.isVisible().catch(() => false))) {
      test.skip(true, 'No hay productos vendibles en el tenant de prueba')
    }
    await primerProducto.click()
    await page.waitForTimeout(500)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Seleccionar el cliente fixture (crédito $1)
    const cliInput = page.getByPlaceholder(/Buscar por nombre o DNI/i)
    await expect(cliInput).toBeVisible({ timeout: 5000 })
    await cliInput.fill('ZZZ Credito Test')
    await page.waitForTimeout(900)
    const cliOpt = page.getByRole('button', { name: /ZZZ Credito Test/ }).first()
    if (!(await cliOpt.isVisible().catch(() => false))) {
      test.skip(true, 'Cliente fixture "ZZZ Credito Test" no encontrado (re-sembrar el SQL de fixture).')
    }
    await cliOpt.click()
    await page.waitForTimeout(900)   // cargar clienteCredito (efecto async) → habilita la opción

    // 3) Medio de pago = Crédito a favor, monto $100 (> $1 disponible)
    const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Crédito a favor/ }) }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Crédito a favor')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await setReactNumber(montoInput, '100')

    // 4) Venta directa → guard L28 bloquea (.last() = el CTA, no el toggle de modo)
    await page.locator('button', { hasText: /^Venta directa$/ }).last().click()

    // POSITIVO: el guard bloquea con el mensaje del disponible
    await expect(page.getByText(/No podés aplicar más que eso/i)).toBeVisible({ timeout: 8000 })
    // No mutación: el carrito sigue con el producto (la venta NO se creó → no se limpió)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
