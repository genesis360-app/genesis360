/**
 * 187_ubicacion_global_mutante.spec.ts
 * E2E MUTANTE — Config → Inventario → Ubicaciones: elegir "Global (todas las sucursales)" tiene que guardar la ubicación
 * SIN sucursal (`sucursal_id = null`). Bug real (2026-10-06): la opción "Global" valía '' y `newUbicSucursalId ||
 * sucursalId` la convertía en la sucursal ACTIVA — se guardaba en otra sucursal y no aparecía en la que se esperaba
 * (un cliente no podía recibir un traslado porque la sucursal destino seguía sin ubicaciones).
 *
 * También cubre el otro lado: por defecto el selector muestra la sucursal activa y se guarda en ESA sucursal.
 * Genera sus propias ubicaciones (nombres únicos) y las borra al final por REST, con la identidad del test.
 * Necesita un tenant con 2+ sucursales (el selector solo aparece así): Almacén Jorgito en DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'
import { SUPABASE_URL, tokenDesdeBrowser, restHeaders } from './helpers/fixtures'

test.describe('Ubicación "Global" se guarda sin sucursal (mutante)', () => {
  test('Global → sucursal_id null; por defecto → la sucursal activa', async ({ page, request }) => {
    test.setTimeout(90000)
    const nombreGlobal = uniqueName('E2EGlobal')
    const nombreDefecto = uniqueName('E2EDefecto')

    await goto(page, '/configuracion?tab=inventario&sub=ubicaciones')
    await waitForApp(page)
    // El deep link nuevo abre directo la sub-pestaña Ubicaciones.
    const nombreInput = page.getByPlaceholder('Nombre de la ubicación')
    await expect(nombreInput).toBeVisible({ timeout: 10000 })

    const selectorSucursal = page.getByLabel('Sucursal de la ubicación')
    test.skip(!(await selectorSucursal.isVisible().catch(() => false)), 'el tenant de prueba tiene una sola sucursal: no hay selector')

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const leer = async (nombre: string) => {
      const r = await request.get(`${SUPABASE_URL}/rest/v1/ubicaciones?nombre=eq.${encodeURIComponent(nombre)}&select=id,sucursal_id`, { headers })
      expect(r.ok()).toBeTruthy()
      return (await r.json()) as { id: string; sucursal_id: string | null }[]
    }

    try {
      // 1) Por defecto el selector muestra la sucursal activa (no "Global").
      const valorInicial = await selectorSucursal.inputValue()
      expect(valorInicial, '[187] por defecto tiene que mostrar una sucursal, no Global').not.toBe('__global__')

      await nombreInput.fill(nombreDefecto)
      await page.getByRole('button', { name: /^Agregar$/ }).click()
      // El tenant de prueba tiene cientos de ubicaciones: se confirma en la base, no en la lista.
      await expect.poll(async () => (await leer(nombreDefecto)).length, { timeout: 10000 }).toBe(1)
      const [defecto] = await leer(nombreDefecto)
      expect(defecto.sucursal_id, '[187] sin tocar el selector se guarda en la sucursal que mostraba').toBe(valorInicial)

      // 2) Eligiendo "Global" → sucursal_id null (antes quedaba en la sucursal activa).
      await nombreInput.fill(nombreGlobal)
      await selectorSucursal.selectOption({ label: 'Global (todas las sucursales)' })
      await page.getByRole('button', { name: /^Agregar$/ }).click()
      // El tenant de prueba tiene cientos de ubicaciones: se confirma en la base, no en la lista.
      await expect.poll(async () => (await leer(nombreGlobal)).length, { timeout: 10000 }).toBe(1)
      const [global] = await leer(nombreGlobal)
      expect(global.sucursal_id, '[187] "Global" tiene que guardarse sin sucursal').toBeNull()
    } finally {
      // Por nombre (únicos de esta corrida): limpia aunque el test haya fallado antes de leer el id.
      for (const nombre of [nombreDefecto, nombreGlobal]) {
        await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?nombre=eq.${encodeURIComponent(nombre)}`, { headers })
      }
    }
  })
})
