/**
 * 166_exportar_excel_estandar.spec.ts
 * Exportación estándar (src/lib/exportarArchivo.ts): Productos, Clientes y Proveedores ofrecen Excel; los CSV salen
 * con BOM (acentos bien en Excel). Descarga real del navegador y lectura del archivo igual que los importadores.
 * Solo lectura: no modifica datos.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'

async function descargar(page: Page, ruta: string, opcion: RegExp) {
  await goto(page, ruta)
  await waitForApp(page)
  await page.getByRole('button', { name: /acciones/i }).first().click()
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: opcion }).or(page.getByRole('button', { name: opcion })).first().click(),
  ])
  const ruta_ = await descarga.path()
  return { nombre: descarga.suggestedFilename(), bytes: new Uint8Array(readFileSync(ruta_!)) }
}

const leer = (bytes: Uint8Array) => {
  const wb = XLSX.read(bytes, { type: 'array' })
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
}

test.describe('Exportar — Excel estándar', () => {
  for (const [ruta, prefijo, columna] of [
    ['/productos', 'productos_', 'sku'],
    ['/clientes', 'clientes_', 'nombre'],
    ['/proveedores', 'proveedores_', 'razon_social'],
  ] as const) {
    test(`${ruta}: "Exportar Excel" baja un .xlsx que el importador puede leer`, async ({ page }) => {
      const { nombre, bytes } = await descargar(page, ruta, /^Exportar Excel$/)
      expect(nombre).toMatch(new RegExp(`^${prefijo}\\d{4}-\\d{2}-\\d{2}\\.xlsx$`))
      // Un .xlsx es un ZIP: empieza con "PK".
      expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
      const filas = leer(bytes)
      expect(filas.length).toBeGreaterThan(0)
      expect(Object.keys(filas[0])).toContain(columna)
    })
  }

  test('/productos: el CSV sale con BOM y el importador lo relee con las mismas columnas', async ({ page }) => {
    const { nombre, bytes } = await descargar(page, '/productos', /^Exportar CSV$/)
    expect(nombre).toMatch(/\.csv$/)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const filas = leer(bytes)
    expect(Object.keys(filas[0])[0]).toBe('id')
    expect(Object.keys(filas[0])).toContain('sku')
  })
})
