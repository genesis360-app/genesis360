/**
 * 44_presupuesto_convertir_mutante.spec.ts
 * E2E MUTANTE — Presupuesto: crear → convertir a venta (REGLA #0 stock).
 *
 * Cadena completa por UI:
 *   1) En el POS, en modo "Presupuesto", con un cliente registrado (cliente obligatorio),
 *      guardar un presupuesto. Crea una venta estado='pendiente' que NO toca stock ni caja.
 *   2) Desde el Historial, abrir el presupuesto y "Finalizar (rebaja stock)": el modal de
 *      saldo cobra el total (medio NO efectivo → sin caja) y `cambiarEstado` despacha la
 *      venta re-validando el stock (PRES-08) y rebajándolo.
 * Aserciones POSITIVAS (toasts "Presupuesto guardado" + "Venta finalizada"); el efecto en
 * DB (venta despachada + movimiento de stock 'rebaje' + baja de inventario) se verifica
 * aparte con execute_sql.
 *
 * Producto pineado a uno con stock holgado en la sucursal activa (Coca Cola 1.5L en
 * Sucursal Norte, fijada vía localStorage('sucursal-id')) para que el convert (PRES-08)
 * tenga stock que rebajar. Mutante: rebaja 1 unidad real en DEV por corrida.
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e' // sucursal con stock de Coca Cola
const PRODUCTO = 'Coca Cola 1.5'

test.describe('Presupuesto crear → convertir (mutante)', () => {
  test('guarda un presupuesto y lo convierte a venta finalizada (rebaja stock)', async ({ page }) => {
    // Fijar la sucursal activa = Norte (donde hay stock del producto pineado)
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar el producto pineado al carrito
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill(PRODUCTO)
    await page.waitForTimeout(1000)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await primerProducto.isVisible().catch(() => false)), 'No se encontró el producto pineado en el POS')
    await primerProducto.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 1b) Elegir caja (el tenant tiene 2 cajas abiertas → el despacho posterior exige una
    //     caja elegida; `cajaSeleccionadaId` se setea acá y persiste al convertir). El selector
    //     solo está visible en modo no-presupuesto, por eso se hace antes de cambiar el modo.
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // 2) Modo "Presupuesto"
    await page.getByRole('button', { name: 'Presupuesto', exact: true }).first().click()

    // 3) Seleccionar un cliente registrado (cliente obligatorio para presupuesto)
    const clienteInput = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
    await clienteInput.fill('a')
    await page.waitForTimeout(800)
    const primerCliente = page.locator('div.absolute.z-20 button').first()
    test.skip(!(await primerCliente.isVisible().catch(() => false)), 'No hay clientes registrados para seleccionar')
    await primerCliente.click()
    await page.waitForTimeout(300)

    // 4) Guardar presupuesto → POSITIVO
    await page.getByRole('button', { name: /^Guardar presupuesto$/ }).last().click()
    await expect(page.getByText(/Presupuesto guardado/i)).toBeVisible({ timeout: 10000 })

    // 5) Historial → filtrar presupuestos y abrir el más reciente (el recién creado)
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.waitForTimeout(500)
    await page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los estados/ }) }).first()
      .selectOption('pendiente')
    await page.waitForTimeout(700)
    const fila = page.locator('div.divide-y > div').filter({ hasText: /\$/ }).first()
    await expect(fila).toBeVisible({ timeout: 8000 })
    await fila.click()
    await page.waitForTimeout(800)

    // 6) "Finalizar (rebaja stock)" → abre el modal de saldo
    await page.getByRole('button', { name: /Finalizar \(rebaja stock\)/ }).click()
    await expect(page.getByRole('heading', { name: /Cobrar saldo y finalizar/ })).toBeVisible({ timeout: 6000 })

    // 7) Cobrar el saldo con un medio NO efectivo (Transferencia → sin caja). El monto ya
    //    viene precargado con el saldo completo; solo elegimos el tipo.
    const medioSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Medio de pago/ }) }).first()
    await medioSel.selectOption({ label: 'Transferencia' })
    await page.waitForTimeout(300)

    // 8) Finalizar venta → POSITIVO. El convert desde el historial usa `cambiarEstado`,
    //    cuyo toast de éxito es "Estado actualizado" (no "Venta finalizada", que es el del
    //    POS directo). La venta pasa a despachada y se rebaja el stock (PRES-08).
    await page.getByRole('button', { name: /^Finalizar venta$/ }).click()
    await expect(page.getByText(/Estado actualizado/i)).toBeVisible({ timeout: 12000 })
  })
})
