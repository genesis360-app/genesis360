/**
 * 127_comercial_acceso_directo_url.spec.ts
 * E2E — COM-03, 04: guard de rutas de `/comercial` (`AppLayout.tsx`, `useEffect` de restricciones).
 *
 * COM-03: los roles con acceso (DUEÑO/SUPERVISOR/SUPER_USUARIO) navegan DIRECTO a `/comercial` por
 *   URL y entran; CAJERO/CONTADOR/DEPOSITO/RRHH son redirigidos a su ruta permitida por el
 *   blocklist correspondiente de `AppLayout.tsx`.
 *
 * Un solo `test()` con lógica ADAPTATIVA (lee el rol REAL de la sesión vía REST y branchea el
 * `expect` según corresponda) corriendo bajo TODOS los proyectos de rol ya existentes en
 * `playwright.config.ts` — `chromium` (DUEÑO), `chromium-supervisor` (SUPERVISOR),
 * `chromium-cajero`, `chromium-deposito`, `chromium-contador`, `chromium-rrhh`. No hay proyecto
 * dedicado a SUPER_USUARIO (sin credenciales de test para ese rol) — ese caso queda cubierto solo
 * por la fórmula pura de `navVisibility.test.ts`.
 *
 * COM-04 — ⚠ gap real encontrado y ACEPTADO (documentar, no arreglar en este lote, ver el plan):
 *   VIEWER/ADMIN no tienen ninguna rama del `useEffect` de restricciones que los redirija —
 *   `ComercialPage` se renderiza igual para ellos (no es leak cross-tenant, la RLS de
 *   `combos`/`cupones` sigue siendo tenant-scoped, pero SÍ es una fuga de visibilidad dentro del
 *   propio tenant).
 *
 *   Verificado en vivo para VIEWER: el OWNER (única sesión con permiso de `UPDATE` en `public.users`
 *   — policy `users_update_owner`) le pisa TEMPORALMENTE el `rol` a la cuenta de prueba de CONTADOR
 *   (nunca al DUEÑO/OWNER que corre el test: auto-degradarse el propio rol se evaluó y se DESCARTÓ
 *   — `users_update_owner` exige que el ACTOR siga siendo DUEÑO/ADMIN en cada request, así que una
 *   vez perdido ese rol el mismo usuario ya no podría revertirlo con su propio token: auto-lockout
 *   sin recuperación posible en este entorno de test, sin `service_role` disponible). Revertido
 *   SIEMPRE en `finally`.
 *
 *   Para ADMIN NO se reproduce en vivo — ni siquiera el OWNER puede asignarle `rol='ADMIN'` a nadie:
 *   el guard `fn_guard_rol_admin` (mig 254) lo rechaza para cualquier actor que no sea ya
 *   `is_admin()`. Este mismo spec lo verifica como un extra (regresión de ese guard) y documenta que
 *   la mitad "ADMIN" de COM-04 es, por diseño, irreproducible desde una sesión de tenant.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, loginToken } from './helpers/fixtures'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub as string
}

const ROLES_CON_ACCESO = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO']
const REDIRECT_ESPERADO: Record<string, RegExp> = {
  CAJERO: /\/ventas/,
  CONTADOR: /\/dashboard/,
  DEPOSITO: /\/inventario/,
  RRHH: /\/rrhh/,
}

test.describe('Comercial — acceso directo por URL según rol', () => {
  test('DUEÑO/SUPERVISOR entran; CAJERO/CONTADOR/DEPOSITO/RRHH son redirigidos (COM-03)', async ({ page, request }) => {
    test.setTimeout(60000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const userId = decodeJwtSub(token)
    const meRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=rol`, { headers })
    const [me] = (await meRes.json()) as Array<{ rol: string }>
    expect(me, '[127] no se pudo resolver el rol de la sesión actual').toBeTruthy()
    const rol = me.rol

    await goto(page, '/comercial')
    await waitForApp(page)

    if (ROLES_CON_ACCESO.includes(rol)) {
      await expect(page, `[127] "${rol}" tiene acceso — debía quedar en /comercial`).toHaveURL(/\/comercial/, { timeout: 8000 })
      await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible({ timeout: 8000 })
    } else if (REDIRECT_ESPERADO[rol]) {
      await expect(page, `🛑 [127] COM-03: "${rol}" NO tiene acceso — debía ser redirigido lejos de /comercial`)
        .toHaveURL(REDIRECT_ESPERADO[rol], { timeout: 8000 })
      await expect(page).not.toHaveURL(/\/comercial/)
    } else {
      throw new Error(`[127] rol inesperado "${rol}" para este spec — revisar bajo qué proyecto de Playwright corrió (playwright.config.ts)`)
    }
  })

  test('COM-04 (documentado, NO se arregla en este lote): VIEWER entra igual a /comercial; ADMIN no se puede auto-asignar para probarlo', async ({ page, request, browser }) => {
    test.setTimeout(90000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const userId = decodeJwtSub(token)
    const meRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=rol,tenant_id`, { headers })
    const [me] = (await meRes.json()) as Array<{ rol: string; tenant_id: string }>
    test.skip(me?.rol !== 'DUEÑO', '[127] COM-04 se ejercita una sola vez, con la sesión DUEÑO (única con permiso de UPDATE en users)')
    test.skip(!process.env.E2E_CONTADOR_EMAIL || !process.env.E2E_CONTADOR_PASSWORD, 'Faltan E2E_CONTADOR_EMAIL/PASSWORD en .env.test.local')

    // Usuario "prestado" para la prueba de VIEWER — NUNCA el propio DUEÑO (ver nota de auto-lockout
    // arriba). Se resuelve por su propio login (no adivinar la fila en `users`).
    const contadorToken = await loginToken(request, process.env.E2E_CONTADOR_EMAIL, process.env.E2E_CONTADOR_PASSWORD)
    const contadorUserId = decodeJwtSub(contadorToken)
    const contadorRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${contadorUserId}&select=rol`, { headers })
    const [contador] = (await contadorRes.json()) as Array<{ rol: string }>
    expect(contador?.rol, '[127] la cuenta de prueba de CONTADOR no tenía el rol esperado').toBe('CONTADOR')

    let contexto: any = null
    try {
      const patchViewer = await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${contadorUserId}`, { headers, data: { rol: 'VIEWER' } })
      expect(patchViewer.ok(), `[127] no se pudo pisar temporalmente el rol a VIEWER: ${await patchViewer.text()}`).toBe(true)

      contexto = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } })
      const pg = await contexto.newPage()
      await pg.goto('/login')
      await pg.getByLabel(/email/i).fill(process.env.E2E_CONTADOR_EMAIL!)
      await pg.getByLabel(/contraseña|password/i).fill(process.env.E2E_CONTADOR_PASSWORD!)
      await pg.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()
      await pg.waitForURL((url: URL) => !url.pathname.startsWith('/login'), { timeout: 15000 })
      await pg.evaluate(() => localStorage.setItem('genesis360_walkthrough_v1', 'seen'))

      await goto(pg, '/comercial')
      await waitForApp(pg)

      // 🛑 GAP documentado (aceptado en el plan, NO arreglar acá): VIEWER entra igual, sin redirect.
      await expect(pg, '[127] COM-04: comportamiento actual — VIEWER se queda en /comercial (gap real, aceptado por ahora)')
        .toHaveURL(/\/comercial/, { timeout: 8000 })
      await expect(pg.getByRole('heading', { name: 'Comercial' })).toBeVisible({ timeout: 8000 })
    } finally {
      if (contexto) await contexto.close()
      const revert = await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${contadorUserId}`, { headers, data: { rol: 'CONTADOR' } })
      expect(revert.ok(), `🛑 [127] CRÍTICO: no se pudo revertir el rol de la cuenta de CONTADOR — revisar manualmente: ${await revert.text()}`).toBe(true)
    }

    const verifRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${contadorUserId}&select=rol`, { headers })
    const [verif] = (await verifRes.json()) as Array<{ rol: string }>
    expect(verif.rol, '🛑 [127] CRÍTICO: la cuenta de CONTADOR compartida no volvió a su rol original').toBe('CONTADOR')

    // ADMIN: ni el propio OWNER puede reproducir la otra mitad del gap — el guard `fn_guard_rol_admin`
    // (mig 254) bloquea asignar 'ADMIN' a CUALQUIER usuario cuando el actor no es ya `is_admin()`.
    // Regresión de ese guard + documentación de por qué esta mitad de COM-04 queda sin e2e en vivo.
    try {
      const patchAdmin = await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${contadorUserId}`, { headers, data: { rol: 'ADMIN' } })
      expect(patchAdmin.ok(), '🛑 [127] el guard fn_guard_rol_admin (mig 254) debe rechazar la auto-escalada a ADMIN incluso para el DUEÑO de un tenant').toBe(false)
    } finally {
      // Red de seguridad: si por una regresión el PATCH de arriba llegara a pasar, no dejar a la
      // cuenta compartida de CONTADOR con rol='ADMIN' (staff de plataforma cross-tenant, REGLA #0).
      const finalRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${contadorUserId}&select=rol`, { headers })
      const [final] = (await finalRes.json()) as Array<{ rol: string }>
      if (final?.rol !== 'CONTADOR') {
        const forzarRevert = await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${contadorUserId}`, { headers, data: { rol: 'CONTADOR' } })
        expect(forzarRevert.ok(), '🛑 [127] CRÍTICO: la cuenta de CONTADOR quedó escalada y no se pudo revertir — intervenir manualmente YA').toBe(true)
      }
    }
  })
})
