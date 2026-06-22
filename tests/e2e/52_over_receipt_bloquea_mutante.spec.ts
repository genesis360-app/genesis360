/**
 * 52_over_receipt_bloquea_mutante.spec.ts
 * E2E MUTANTE — Over-receipt: recibir MÁS que lo pedido sin tolerancia → BLOQUEA (REGLA #0, stock/costo).
 *
 * Guard B3 (`superaOverReceipt`, `recepcionLogic.ts`) cableado en `RecepcionesPage.guardar(true)`:
 * si el recibido acumulado supera lo permitido sobre lo pedido (con `permite_over_receipt=false`,
 * CUALQUIER exceso lo supera) → la recepción se BLOQUEA y NO se crea. Recibir de más que la OC
 * inflaría stock y costo por encima de lo realmente pedido → integridad de inventario/compras.
 *
 * La MATRIZ de decisión CON/SIN tope ya está cubierta por unit tests (`recepcionLogic.test.ts`:
 * sin exceso / exceso+no-permite / permitido-sin-tope / dentro-vs-fuera-del-pct). El efecto de stock+
 * estado OC del camino de ÉXITO ya está cubierto por la spec 35 (recepción vinculada → stock↑ + OC
 * recibida). Lo que faltaba —y valida este e2e— es el WIRING UI del guard que bloquea el exceso.
 *
 * Fixture SQL (DEV, Almacén Jorgito, `permite_over_receipt=false`): OC #16 confirmada (Mayorista Pepe)
 * con "Bebida Sprite 2.5L" pedido 5, SIN recepciones previas (oc_id 872a9754…). Se intenta recibir 7.
 *
 * Aserción POSITIVA del bloqueo (toast "…supera lo permitido sobre lo pedido (5)"); que NO se creó
 * recepción se verifica aparte con execute_sql. Producto SIMPLE (sin lote/venc/series) para que el
 * flujo llegue al guard B3 (los checks de lote/venc corren antes). Corre con OWNER=DUEÑO (chromium).
 *
 * Re-ejecutable: el fixture (OC sin recepciones) queda intacto porque el guard bloquea (no muta).
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const OC_ID = '872a9754-7523-4cee-bec0-1c499b096807'

/** Setea un <input type=number> controlado por React (native value-setter + evento input burbujeante). */
async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Over-receipt bloquea exceso (mutante)', () => {
  test('recibir 7 con pedido 5 y permite_over_receipt=false → bloquea, no crea recepción', async ({ page }) => {
    await goto(page, `/recepciones?oc_id=${OC_ID}`)
    await waitForApp(page)

    // El form cargó el ítem de la OC con la cantidad esperada precargada (5).
    // getByRole('spinbutton') solo matchea inputs number visibles → el de "Cant:" (precio va en el detalle colapsado).
    const cantInput = page.getByRole('spinbutton').first()
    if (!(await cantInput.isVisible().catch(() => false))) {
      test.skip(true, 'Form de recepción no cargó el ítem de la OC fixture (re-correr el SQL de fixture).')
    }
    await expect(cantInput).toHaveValue('5', { timeout: 10000 })

    // Recibir 7 (> 5). El tenant tiene permite_over_receipt=false → cualquier exceso lo supera.
    await setReactNumber(cantInput, '7')
    await expect(cantInput).toHaveValue('7')

    await page.getByRole('button', { name: /Confirmar recepción/i }).click()

    // POSITIVO: el guard B3 bloquea con el mensaje de exceso sobre lo pedido (5)
    await expect(page.getByText(/supera lo permitido sobre lo pedido/i)).toBeVisible({ timeout: 10000 })
    // No debe haber pasado a la pantalla de resultado de recepción
    await expect(page.getByText(/Recepción registrada|Recepción confirmada/i)).not.toBeVisible()
  })
})
