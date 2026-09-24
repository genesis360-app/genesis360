/**
 * 159_usuario_sin_correo_mutante.spec.ts
 *
 * Mig 434 — empleados que entran con NOMBRE y CONTRASEÑA, sin correo.
 *
 * Recorre el camino real completo, con dos usuarios y dos contraseñas distintas:
 *
 *   1. El DUEÑO crea al empleado desde /usuarios → "Sin email". No se manda ningún mail.
 *   2. El empleado entra en una sesión limpia con el CÓDIGO DEL NEGOCIO + su usuario + la
 *      contraseña que le pasó el dueño.
 *   3. Lo primero que ve es "Elegí tu contraseña": la del dueño es de un solo uso y no lo deja
 *      pasar a ningún lado hasta cambiarla.
 *   4. Con la contraseña NUEVA entra normal y ya no se la vuelven a pedir.
 *   5. La VIEJA ya no sirve — que es el punto de todo el ejercicio.
 *
 * ⚠️ MUTANTE: crea un usuario REAL en Almacén Jorgito. La app no tiene "eliminar usuario" (solo
 * desactivar), así que el spec no puede limpiarlo solo: usa un nombre único por corrida
 * (`e2e<timestamp>`) y la limpieza se hace por SQL con service_role. Si se corre muchas veces,
 * borrar los `users` con `usuario LIKE 'e2e%'` de ese tenant.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

const SUFIJO = Date.now().toString().slice(-9)
const USUARIO = `e2e${SUFIJO}`            // cumple ^[a-z0-9][a-z0-9_-]{2,29}$
const NOMBRE = `E2E Sin Correo ${SUFIJO}`
const PASS_INICIAL = 'Inicial-12345'
const PASS_NUEVA = 'Elegida-98765'

/** Entra con el código del negocio + usuario, en un contexto que nunca vio la app. */
async function ingresarConUsuario(page: Page, codigo: string, usuario: string, password: string) {
  await page.goto('/login')
  await page.getByRole('button', { name: /No tengo email/i }).click()
  await page.getByLabel('Código del negocio').fill(codigo)
  await page.getByLabel('Usuario').fill(usuario)
  await page.getByLabel(/contraseña/i).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
}

// Cuatro ingresos completos en un solo test (el del dueño, el del empleado con la contraseña
// inicial, el de la nueva y el del intento con la vieja): no entra en los 30 s por defecto.
test.setTimeout(180_000)

test('un empleado sin correo entra con usuario y está obligado a cambiar la contraseña', async ({ page, browser }) => {
  // ── 1 · El DUEÑO lo crea ────────────────────────────────────────────────────
  await page.goto('/usuarios')
  await page.getByRole('button', { name: 'Agregar usuario' }).click()

  await page.getByRole('button', { name: /Sin email/ }).click()

  // El código del negocio lo muestra el propio formulario: es lo que el dueño tiene que dictarle.
  const aviso = page.getByText(/Para entrar necesita dos cosas/)
  await expect(aviso).toBeVisible()
  const codigoNegocio = (await aviso.locator('strong').innerText()).trim()
  expect(codigoNegocio).toMatch(/^[a-z0-9]{3,20}$/)

  await page.getByPlaceholder('Juan Pérez').fill(NOMBRE)
  await page.getByPlaceholder('juan', { exact: true }).fill(USUARIO)
  await page.getByPlaceholder('mínimo 8 caracteres').fill(PASS_INICIAL)
  await page.getByRole('button', { name: 'Crear usuario' }).click()

  await expect(page.getByText(`Usuario "${USUARIO}" creado`, { exact: false })).toBeVisible({ timeout: 20000 })

  // Aparece en la lista, con su usuario y la marca de que todavía no estrenó la contraseña.
  const fila = page.locator('div.group').filter({ hasText: USUARIO })
  await expect(fila).toHaveCount(1)
  await expect(fila).toContainText('Contraseña sin estrenar')

  // ── 2 y 3 · El empleado entra y lo primero que ve es el cambio obligatorio ───
  // `storageState` vacío explícito: un contexto nuevo hereda el del proyecto (el del DUEÑO).
  const ctxEmpleado = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: BASE_URL })
  try {
    const pageEmp = await ctxEmpleado.newPage()
    await ingresarConUsuario(pageEmp, codigoNegocio, USUARIO, PASS_INICIAL)

    await expect(pageEmp.getByRole('heading', { name: 'Elegí tu contraseña' })).toBeVisible({ timeout: 20000 })
    // No entró a ningún lado: el guard va antes que cualquier ruta.
    await expect(pageEmp.locator('aside')).toHaveCount(0)

    await pageEmp.getByLabel('Contraseña nueva').fill(PASS_NUEVA)
    await pageEmp.getByLabel('Repetila').fill(PASS_NUEVA)
    await pageEmp.getByRole('button', { name: /Guardar y entrar/ }).click()

    // Aserción POSITIVA del efecto: el toast del cambio real y, detrás, la app ya cargada.
    await expect(pageEmp.getByText('Listo, tu contraseña quedó cambiada')).toBeVisible({ timeout: 20000 })
    await expect(pageEmp.locator('aside').first()).toBeVisible({ timeout: 20000 })
  } finally {
    await ctxEmpleado.close()
  }

  // ── 4 · Con la nueva entra normal, sin que se la vuelvan a pedir ────────────
  const ctxVuelta = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: BASE_URL })
  try {
    const pageVuelta = await ctxVuelta.newPage()
    await ingresarConUsuario(pageVuelta, codigoNegocio, USUARIO, PASS_NUEVA)
    await expect(pageVuelta.locator('aside').first()).toBeVisible({ timeout: 20000 })
    await expect(pageVuelta.getByRole('heading', { name: 'Elegí tu contraseña' })).toHaveCount(0)
  } finally {
    await ctxVuelta.close()
  }

  // ── 5 · Y la vieja dejó de servir ───────────────────────────────────────────
  const ctxVieja = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: BASE_URL })
  try {
    const pageVieja = await ctxVieja.newPage()
    await ingresarConUsuario(pageVieja, codigoNegocio, USUARIO, PASS_INICIAL)
    await expect(pageVieja.getByText('Negocio, usuario o contraseña incorrectos')).toBeVisible({ timeout: 20000 })
  } finally {
    await ctxVieja.close()
  }
})
