/**
 * 28_cobranza_cc_mutante.spec.ts
 * E2E MUTANTE — Cobranza de cuenta corriente en efectivo (REGLA #0, plata).
 *
 * Cobra una parte de la deuda CC de un cliente en efectivo. La cobranza en efectivo EXIGE
 * caja abierta ANTES de saldar (cobranzaCC.ts `requiereCaja`, v1.69.0) y asienta un `ingreso`
 * en caja. Self-healing: abre Caja1 si está cerrada.
 *
 * Usa el cliente "Gaston Otranto" (CC habilitada en el tenant de prueba DEV). Corre con el
 * usuario OWNER (proyecto chromium).
 *
 * AUTOSUFICIENTE: "Gaston Otranto" es un fixture COMPARTIDO por varios specs CC (28/39/40/46/
 * 49/69/72), que pueden dejarlo sin deuda pendiente (condonada, incobrable o ya cobrada) entre
 * corridas. Por eso este test genera su PROPIA deuda CC fresca (una venta 100% a Cuenta
 * Corriente, monto = total exacto del carrito) antes de cobrar una parte — no depende de que
 * haya quedado deuda de una corrida anterior.
 */
import { test, expect } from '@playwright/test'
import {
  garantizarCajaAbierta,
  irAlPOS,
  agregarPrimerProductoAlCarrito,
  totalDelCarrito,
} from './helpers/fixtures'
import { goto, waitForApp } from './helpers/navigation'

const CLIENTE = 'Gaston Otranto'

test.describe('Cobranza CC efectivo (mutante)', () => {
  test('cobra parte de la deuda CC en efectivo (exige caja → ingreso)', async ({ page }) => {
    // 1) Caja abierta — precondición GARANTIZADA, no asumida (la venta CC y la cobranza en
    // efectivo la exigen: H4/VF1). Antes este bloque abría la caja "si veía el botón" y
    // rellenaba "Monto inicial" a ciegas → en la corrida masiva la caja ya estaba abierta
    // (la dejaba abierta otro spec), el modal nunca aparecía y el fill se colgaba 30s.
    await garantizarCajaAbierta(page)

    // 2) FIXTURE FRESCA: generar una venta 100% Cuenta Corriente para el cliente (nueva deuda CC)
    await irAlPOS(page)
    await agregarPrimerProductoAlCarrito(page)

    const cliInput = page.getByPlaceholder(/Buscar por nombre o DNI/i)
    await expect(cliInput).toBeVisible({ timeout: 5000 })
    await cliInput.fill(CLIENTE)
    await page.waitForTimeout(900)
    const cliOpt = page.getByRole('button', { name: new RegExp(CLIENTE) }).first()
    expect(
      await cliOpt.isVisible().catch(() => false),
      `Cliente "${CLIENTE}" no encontrado en el tenant de prueba — precondición faltante ` +
        `(antes esto se skipeaba en silencio y la suite daba verde).`,
    ).toBeTruthy()
    await cliOpt.click()
    await page.waitForTimeout(400)

    // Monto a Cuenta Corriente = total exacto del carrito (evita dejar una deuda inconsistente
    // con el total de la venta — REGLA #0 contable; nada de montos "overshoot" arbitrarios).
    const totalNum = await totalDelCarrito(page)

    const medioSelect = page.locator('select').filter({ has: page.locator('option[value="Cuenta Corriente"]') }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Cuenta Corriente')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill(String(totalNum))
    await montoInput.blur()
    await page.waitForTimeout(300)

    // Si hay varias cajas abiertas (actividad e2e concurrente), el POS exige elegir una (H4/VF1)
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const vals = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (vals.length) await cajaSelect.selectOption(vals[0])
    }

    const despachar = page.getByRole('button', { name: /Despachar \(cuenta corriente\)/i })
    await expect(despachar).toBeEnabled({ timeout: 5000 })
    await despachar.click()

    // POSITIVO: la venta CC se creó (toast + carrito limpio → queda deuda fresca para cobrar)
    await expect(page.getByText(/Venta finalizada/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 8000 })

    // 3) Clientes → tab Cuenta Corriente
    await goto(page, '/clientes')
    await waitForApp(page)
    await page.getByRole('button', { name: /Cuenta Corriente/i }).first().click()
    await page.waitForTimeout(800)

    // 4) Card del cliente con la deuda recién creada → "Registrar pago" (abre el panel inline)
    const card = page.locator('div').filter({ hasText: new RegExp(CLIENTE) })
      .filter({ has: page.getByRole('button', { name: /Registrar pago/i }) }).last()
    await expect(card).toBeVisible({ timeout: 8000 })
    await card.getByRole('button', { name: /Registrar pago/i }).first().click()

    // El panel se abrió si aparece "Confirmar pago" (aserción positiva, evita falso-verde)
    await expect(page.getByRole('button', { name: /Confirmar pago/i })).toBeVisible({ timeout: 5000 })

    // 5) Monto parcial (mitad de la deuda recién generada) + Efectivo (default) + confirmar
    const parcial = Math.max(1, Math.floor(totalNum / 2))
    const montoPagoInput = page.locator('xpath=//label[contains(.,"Monto")]/following::input[1]')
    await montoPagoInput.fill(String(parcial))
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /Confirmar pago/i }).click()

    // 6) POSITIVO: toast "Pago de $… registrado" + NO error de caja exigida
    await expect(page.getByText(/Pago de .* registrado/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Abrí una caja antes de cobrar/i)).not.toBeVisible()
  })
})
