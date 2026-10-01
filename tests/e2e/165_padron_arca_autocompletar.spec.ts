/**
 * 165_padron_arca_autocompletar.spec.ts
 * Autocompletar por CUIT desde el padrón de ARCA (EF consultar-cuit → ws_sr_constancia_inscripcion).
 *
 * Corre contra el padrón de HOMOLOGACIÓN (DEV): datos ficticios de ARCA, no de un cliente real.
 * 30-50001091-2 → persona jurídica, Responsable Inscripto, con domicilio fiscal (verificado 2026-10-01).
 * No guarda nada: valida la vista previa y que "Usar los datos marcados" complete la ficha.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CUIT_RI = '30-50001091-2'

test.describe('Padrón ARCA — autocompletar ficha de cliente', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/clientes')
    await waitForApp(page)
    await page.getByRole('button', { name: /nuevo cliente/i }).click()
  })

  test('CUIT válido → vista previa de ARCA → completa razón social, condición IVA y domicilio', async ({ page }) => {
    const cuit = page.getByPlaceholder(/para Factura A/i)
    await cuit.fill(CUIT_RI)

    const tarjeta = page.getByRole('region', { name: 'Datos en ARCA' })
    await expect(tarjeta).toBeVisible({ timeout: 30_000 })
    await expect(tarjeta.getByText('Responsable Inscripto')).toBeVisible()
    await expect(tarjeta.getByText(/padrón de prueba/i)).toBeVisible()

    await tarjeta.getByRole('button', { name: 'Usar los datos marcados' }).click()
    await expect(tarjeta).toBeHidden()

    // Aserción POSITIVA: la ficha quedó con los datos de ARCA.
    await expect(page.getByPlaceholder(/nombre completo|razón social/i).first()).not.toHaveValue('')
    await expect(page.locator('select').filter({ has: page.locator('option[value="Monotributista"]') }).first()).toHaveValue('RI')
    await expect(page.getByPlaceholder(/calle y número/i)).toHaveValue(/MITRE BARTOLOME 326/)
  })

  test('nombre ya escrito no se pisa por defecto', async ({ page }) => {
    await page.getByPlaceholder(/nombre completo|razón social/i).first().fill('Mi cliente de siempre')
    await page.getByPlaceholder(/para Factura A/i).fill(CUIT_RI)

    await expect(page.getByText('Datos en ARCA', { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Usar los datos marcados' }).click()

    await expect(page.getByPlaceholder(/nombre completo|razón social/i).first()).toHaveValue('Mi cliente de siempre')
    await expect(page.getByPlaceholder(/calle y número/i)).toHaveValue(/MITRE BARTOLOME 326/)
  })

  test('CUIT con dígito verificador inválido → no consulta', async ({ page }) => {
    await page.getByPlaceholder(/para Factura A/i).fill('30-50001091-3')
    await page.waitForTimeout(1500) // necesario: se verifica una AUSENCIA tras el debounce de 500 ms
    await expect(page.getByText(/Consultando ARCA|Datos en ARCA|Consultar en ARCA/)).toHaveCount(0)
  })
})

test.describe('Padrón ARCA — proveedor y alta rápida del POS', () => {
  test('proveedor: completa razón social, condición IVA (vocabulario de proveedores) y domicilio', async ({ page }) => {
    await goto(page, '/proveedores')
    await waitForApp(page)
    await page.getByRole('button', { name: /nuevo proveedor/i }).first().click()
    await page.getByPlaceholder('20-12345678-9').fill(CUIT_RI)

    const tarjeta = page.getByRole('region', { name: 'Datos en ARCA' })
    await expect(tarjeta).toBeVisible({ timeout: 30_000 })
    await tarjeta.getByRole('button', { name: 'Usar los datos marcados' }).click()

    await expect(page.getByPlaceholder('Razón social jurídica')).not.toHaveValue('')
    // proveedores_condicion_iva_check: el valor tiene que ser 'responsable_inscripto', no 'RI'.
    await expect(page.locator('select').filter({ has: page.locator('option[value="responsable_inscripto"]') }).first()).toHaveValue('responsable_inscripto')
  })

  test('POS: alta rápida con CUIT trae condición y domicilio fiscal', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)
    await page.getByRole('button', { name: /cliente registrado/i }).first().click().catch(() => {})
    await page.getByRole('button', { name: /registrar cliente nuevo/i }).first().click()
    await page.getByPlaceholder(/CUIT \(opcional/i).fill(CUIT_RI)

    const tarjeta = page.getByRole('region', { name: 'Datos en ARCA' })
    await expect(tarjeta).toBeVisible({ timeout: 30_000 })
    await tarjeta.getByRole('button', { name: 'Usar los datos marcados' }).click()

    await expect(page.getByPlaceholder(/nombre completo/i)).not.toHaveValue('')
    await expect(page.locator('select').filter({ has: page.locator('option', { hasText: 'Condición IVA…' }) })).toHaveValue('RI')
    await expect(page.getByPlaceholder('Domicilio fiscal')).toHaveValue(/MITRE BARTOLOME 326/)
  })
})
