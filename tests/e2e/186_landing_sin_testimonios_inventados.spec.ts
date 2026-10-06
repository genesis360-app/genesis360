/**
 * 186_landing_sin_testimonios_inventados.spec.ts
 * 🛑 La landing no muestra testimonios inventados (GO 2026-10-06; Ley 24.240 — doc 00 de Fede). El slot queda oculto
 * hasta que se cargue el primer testimonio REAL. Página pública → contexto SIN sesión.
 */
import { test, expect } from '@playwright/test'
import { goto } from './helpers/navigation'

test('la landing no tiene testimonios inventados', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  try {
    await goto(page, '/')
    await expect(page.getByRole('link', { name: /Probar gratis/ }).first()).toBeVisible({ timeout: 15000 })   // anti-vacío
    await expect(page.getByText('Lo que dicen nuestros clientes')).toHaveCount(0)
    for (const inventado of ['Ferretería El Tornillo', 'Despensa La Esquina', 'Kiosco Central']) {
      await expect(page.getByText(inventado)).toHaveCount(0)
    }
  } finally {
    await ctx.close()
  }
})
