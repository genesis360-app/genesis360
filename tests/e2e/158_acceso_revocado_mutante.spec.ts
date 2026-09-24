/**
 * 158_acceso_revocado_mutante.spec.ts
 *
 * UAT §67 (mig 433) — "Desactivar" un usuario le corta el acceso DE VERDAD.
 *
 * Hasta la mig 433 dar de baja a alguien era cosmético: `get_user_tenant_id()` no miraba `activo`,
 * así que el usuario dado de baja seguía viendo todo. Este spec recorre el camino real completo,
 * con DOS usuarios reales:
 *
 *   1. El DUEÑO da de baja al contador desde /usuarios.
 *   2. El contador entra con su usuario y contraseña (sesión NUEVA, la baja no cierra las abiertas)
 *      y ve la pantalla "Tu acceso fue dado de baja" — NO el formulario de crear un negocio, que
 *      era lo que pasaba antes de la mitad de frontend de la 433.
 *   3. El DUEÑO lo reactiva con el botón "Reactivar" y el contador vuelve a entrar normal.
 *
 * El paso 3 no es decorativo: desde que la baja corta el acceso de verdad, sin "Reactivar" una baja
 * por error queda como un candado sin llave (la app no tiene "eliminar usuario" ni ninguna otra
 * acción sobre un usuario inactivo).
 *
 * ⚠️ MUTANTE: da de baja a un usuario REAL de Almacén Jorgito. El `finally` lo reactiva, pero si el
 * test se pasa del timeout Playwright cierra el contexto antes (gotcha 17) — si este spec falla,
 * verificar a mano que `contador1` quedó `activo = true`.
 */
import { test, expect, type Page } from '@playwright/test'

const CONTADOR_EMAIL    = process.env.E2E_CONTADOR_EMAIL
const CONTADOR_PASSWORD = process.env.E2E_CONTADOR_PASSWORD
const BASE_URL          = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

/** La fila del usuario en /usuarios. `div.group` es la clase exacta de la fila: un `div` genérico
 *  filtrado por texto matchea el contenedor envolvente de TODA la lista (gotcha 10). */
function filaUsuario(page: Page, nombre: string) {
  return page.locator('div.group').filter({ hasText: nombre })
}

async function confirmarModal(page: Page) {
  const modal = page.getByRole('alertdialog')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Confirmar' }).click()
}

test('dar de baja corta el acceso de verdad, y "Reactivar" lo devuelve', async ({ page, browser }) => {
  test.skip(!CONTADOR_EMAIL || !CONTADOR_PASSWORD,
    'Faltan E2E_CONTADOR_EMAIL / E2E_CONTADOR_PASSWORD en .env.test.local')

  let dadoDeBaja = false

  try {
    // ── 1 · El DUEÑO da de baja al contador ──────────────────────────────────
    await page.goto('/usuarios')
    const fila = filaUsuario(page, 'contador1')
    await expect(fila).toHaveCount(1)          // que no matchee un contenedor de más
    await expect(fila).not.toContainText('Inactivo')

    await fila.getByTitle(/^Desactivar/).click()
    await confirmarModal(page)
    await expect(page.getByText('Usuario desactivado')).toBeVisible({ timeout: 10000 })
    dadoDeBaja = true

    await expect(filaUsuario(page, 'contador1')).toContainText('Inactivo')

    // ── 2 · El contador entra y ve que lo dieron de baja ─────────────────────
    // `storageState` vacío explícito: un contexto nuevo HEREDA el del proyecto (gotcha 8), o sea
    // que sin esto seguiríamos logueados como el DUEÑO.
    const ctxContador = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: BASE_URL })
    try {
      const pageContador = await ctxContador.newPage()
      await pageContador.goto('/login')
      await pageContador.getByLabel(/email/i).fill(CONTADOR_EMAIL!)
      await pageContador.getByLabel(/contraseña|password/i).fill(CONTADOR_PASSWORD!)
      await pageContador.getByRole('button', { name: 'Ingresar', exact: true }).click()

      // Aserción POSITIVA: la pantalla que explica qué pasó.
      await expect(pageContador.getByRole('heading', { name: 'Tu acceso fue dado de baja' }))
        .toBeVisible({ timeout: 20000 })
      // 🛑 Lo que pasaba sin la mitad de frontend de la 433: se lo mandaba a crear un negocio nuevo
      // con su misma identidad, y el insert moría contra su fila vieja con un error crudo de SQL.
      await expect(pageContador).not.toHaveURL(/onboarding/)
      await expect(pageContador.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
    } finally {
      await ctxContador.close()
    }

    // ── 3 · El DUEÑO lo reactiva ─────────────────────────────────────────────
    await page.reload()
    const filaInactiva = filaUsuario(page, 'contador1')
    await filaInactiva.getByRole('button', { name: 'Reactivar' }).click()
    await confirmarModal(page)
    await expect(page.getByText('Usuario reactivado')).toBeVisible({ timeout: 10000 })
    dadoDeBaja = false

    await expect(filaUsuario(page, 'contador1')).not.toContainText('Inactivo')

    // ── 4 · Y vuelve a entrar normal ─────────────────────────────────────────
    const ctxVuelta = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: BASE_URL })
    try {
      const pageVuelta = await ctxVuelta.newPage()
      await pageVuelta.goto('/login')
      await pageVuelta.getByLabel(/email/i).fill(CONTADOR_EMAIL!)
      await pageVuelta.getByLabel(/contraseña|password/i).fill(CONTADOR_PASSWORD!)
      await pageVuelta.getByRole('button', { name: 'Ingresar', exact: true }).click()
      await pageVuelta.waitForURL('**/dashboard', { timeout: 20000 })
      await expect(pageVuelta.getByRole('heading', { name: 'Tu acceso fue dado de baja' })).toHaveCount(0)
    } finally {
      await ctxVuelta.close()
    }
  } finally {
    // Red de contención: si el test murió con el contador dado de baja, devolverle el acceso.
    if (dadoDeBaja) {
      await page.goto('/usuarios')
      const fila = filaUsuario(page, 'contador1')
      await fila.getByRole('button', { name: 'Reactivar' }).click()
      await confirmarModal(page)
      await expect(page.getByText('Usuario reactivado')).toBeVisible({ timeout: 10000 })
    }
  }
})
