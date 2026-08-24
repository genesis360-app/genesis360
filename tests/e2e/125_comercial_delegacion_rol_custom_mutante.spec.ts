/**
 * 125_comercial_delegacion_rol_custom_mutante.spec.ts
 * E2E MUTANTE — COM-05, 06: el caso de uso real que justifica la Fase D (módulo Comercial
 * delegable) y su blindaje inverso.
 *
 * COM-05: un empleado con rol base SUPERVISOR + un rol custom "Comercial" (`roles_custom`, marca
 *   `no_ver` en TODOS los módulos salvo `comercial`) → el nav SOLO muestra Comercial, y navegar a
 *   cualquier otra ruta (ej. `/dashboard`) redirige de vuelta a `/comercial`.
 * COM-06: blindaje — un usuario CAJERO (sin `supervisorOnly`) al que se le asigna un rol custom con
 *   `comercial: 'editar'` (alguien intentando "regalarle" acceso vía rol custom) SIGUE sin ver
 *   `/comercial`: el rol base gatea ANTES que `permisos_custom` en `navItemVisible` (`navVisibility.ts`)
 *   y en el `useEffect` de restricciones de `AppLayout.tsx` — un rol custom solo puede RESTRINGIR lo
 *   que el rol base ya habilita, nunca ampliarlo.
 *
 * 🛑 Por qué esto usa DOS sesiones reales de rol vía `browser.newContext()` (mismo patrón que el
 * spec 93) en vez de los proyectos `chromium-supervisor`/`chromium-cajero` de `playwright.config.ts`:
 * la policy RLS `users_update_owner` (schema_full.sql) solo permite `UPDATE` sobre `public.users` a
 * `DUEÑO`/`ADMIN` — un SUPERVISOR o CAJERO NO puede auto-asignarse su propio `rol_custom_id` por REST.
 * Todo el setup/teardown de `rol_custom_id` corre con el TOKEN DEL OWNER (que nunca se toca a sí
 * mismo — cero riesgo de auto-lockout), y una sesión nueva logueada como el usuario real de
 * SUPERVISOR/CAJERO confirma el efecto de punta a punta en el navegador.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, loginToken } from './helpers/fixtures'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

// Mirror del `modulo` de CADA nav item real de `AppLayout.tsx` (`navItems`, línea ~33) — para dejar
// SOLO 'comercial' visible hay que marcar `no_ver` explícito en todos los demás (los `ownerOnly`
// como 'configuracion'/'usuarios' ya están bloqueados para SUPERVISOR por el rol base, pero no
// cuesta nada incluirlos también, defensivo ante un futuro cambio de esos flags).
const TODOS_LOS_MODULOS_MENOS_COMERCIAL = [
  'dashboard', 'ventas', 'gastos', 'caja', 'inventario', 'movimientos', 'clientes', 'envios',
  'facturacion', 'proveedores', 'recursos', 'recepciones', 'picking', 'pedidos', 'repositores',
  'biblioteca', 'alertas', 'supervision', 'rrhh', 'historial', 'reportes', 'sucursales', 'usuarios',
  'configuracion', 'mi_portal',
]

function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub as string
}

interface CtxOwner { headers: Record<string, string>; tenantId: string }

async function ctxOwner(page: any, request: any): Promise<CtxOwner> {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)
  const userId = decodeJwtSub(token)
  const meRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=tenant_id,rol`, { headers })
  const [me] = (await meRes.json()) as Array<{ tenant_id: string; rol: string }>
  expect(me, '[125] no se pudo resolver el usuario OWNER logueado').toBeTruthy()
  expect(me.rol, '[125] este spec necesita el token del OWNER (único rol con permiso de UPDATE en users)').toBe('DUEÑO')
  return { headers, tenantId: me.tenant_id }
}

/** Resuelve `users.id` + `rol` + `rol_custom_id` ACTUAL de un usuario de rol fijo vía su propio login. */
async function resolverUsuarioDeRol(request: any, owner: CtxOwner, email: string | undefined, password: string | undefined, rolEsperado: string) {
  const token = await loginToken(request, email, password)
  const userId = decodeJwtSub(token)
  const res = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=id,rol,rol_custom_id`, { headers: owner.headers })
  const [u] = (await res.json()) as Array<{ id: string; rol: string; rol_custom_id: string | null }>
  expect(u, `[125] no se pudo resolver el usuario "${email}" desde la sesión OWNER`).toBeTruthy()
  expect(u.rol, `[125] "${email}" debía tener rol base ${rolEsperado}`).toBe(rolEsperado)
  return u
}

async function crearRolCustom(request: any, owner: CtxOwner, nombre: string, permisos: Record<string, 'no_ver' | 'ver' | 'editar'>) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/roles_custom`, {
    headers: owner.headers, data: { tenant_id: owner.tenantId, nombre, permisos, activo: true },
  })
  expect(res.ok(), `[125] no se pudo crear el rol custom "${nombre}": ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0] as { id: string }
}

async function asignarRolCustom(request: any, owner: CtxOwner, userId: string, rolCustomId: string | null) {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
    headers: owner.headers, data: { rol_custom_id: rolCustomId },
  })
  expect(res.ok(), `[125] no se pudo asignar rol_custom_id=${rolCustomId} al usuario ${userId}: ${await res.text()}`).toBe(true)
}

/** Login REAL por UI en un browser context nuevo (no hereda el storageState del proyecto). */
async function loginContextoNuevo(browser: any, email: string, password: string) {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } })
  const pg = await context.newPage()
  await pg.goto('/login')
  await pg.getByLabel(/email/i).fill(email)
  await pg.getByLabel(/contraseña|password/i).fill(password)
  await pg.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()
  await pg.waitForURL((url: URL) => !url.pathname.startsWith('/login'), { timeout: 15000 })
  // Primer login de este usuario en un contexto nuevo → dispara el tour de bienvenida.
  await pg.evaluate(() => localStorage.setItem('genesis360_walkthrough_v1', 'seen'))
  await pg.reload()
  await waitForApp(pg)
  return { context, page: pg }
}

test.describe('Comercial — delegación por rol custom (mutante)', () => {
  test('SUPERVISOR + rol custom "Comercial" (no_ver todo salvo comercial) → nav SOLO Comercial (COM-05)', async ({ page, request, browser }) => {
    test.setTimeout(150000)
    test.skip(!process.env.E2E_SUPERVISOR_EMAIL || !process.env.E2E_SUPERVISOR_PASSWORD, 'Faltan E2E_SUPERVISOR_EMAIL/PASSWORD en .env.test.local')
    const ts = Date.now()
    const owner = await ctxOwner(page, request)
    const supervisor = await resolverUsuarioDeRol(request, owner, process.env.E2E_SUPERVISOR_EMAIL, process.env.E2E_SUPERVISOR_PASSWORD, 'SUPERVISOR')

    const permisos = Object.fromEntries(TODOS_LOS_MODULOS_MENOS_COMERCIAL.map(m => [m, 'no_ver' as const]))
    const rolCustom = await crearRolCustom(request, owner, `E2E Rol Comercial 125 ${ts}`, permisos)

    let contextoSup: any = null
    try {
      await asignarRolCustom(request, owner, supervisor.id, rolCustom.id)

      const { context, page: pageSup } = await loginContextoNuevo(browser, process.env.E2E_SUPERVISOR_EMAIL!, process.env.E2E_SUPERVISOR_PASSWORD!)
      contextoSup = context

      // 🛑 POSITIVO: el nav del SUPERVISOR delegado queda con UN SOLO link visible, "Comercial".
      const navLinks = pageSup.locator('nav').first().getByRole('link')
      await expect(navLinks).toHaveCount(1, { timeout: 10000 })
      await expect(navLinks.first()).toHaveText(/Comercial/)

      // Y quedó redirigido (o se redirige al navegar) a /comercial — nunca en /dashboard, que
      // está `no_ver`.
      await expect(pageSup).toHaveURL(/\/comercial/, { timeout: 10000 })

      // Ir a mano a otra ruta permitida por el rol base (dashboard) también rebota a /comercial.
      await goto(pageSup, '/dashboard')
      await waitForApp(pageSup)
      await expect(pageSup).toHaveURL(/\/comercial/, { timeout: 10000 })
    } finally {
      if (contextoSup) await contextoSup.close()
      // Revertir SIEMPRE, corra lo que corra arriba — el usuario SUPERVISOR es compartido por
      // toda la suite (specs 15/45/47 asumen sin restricciones de permisos_custom).
      await asignarRolCustom(request, owner, supervisor.id, supervisor.rol_custom_id)
      await request.patch(`${SUPABASE_URL}/rest/v1/roles_custom?id=eq.${rolCustom.id}`, { headers: owner.headers, data: { activo: false } })
    }

    // POSITIVO tras revertir: el usuario quedó exactamente como estaba.
    const verifRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${supervisor.id}&select=rol_custom_id`, { headers: owner.headers })
    const [verif] = (await verifRes.json()) as Array<{ rol_custom_id: string | null }>
    expect(verif.rol_custom_id, '🛑 [125] CRÍTICO: el rol_custom_id del SUPERVISOR compartido no volvió al valor original').toBe(supervisor.rol_custom_id)
  })

  test('CAJERO + rol custom con comercial:editar SIGUE sin ver /comercial — el rol custom no amplía (COM-06)', async ({ page, request, browser }) => {
    test.setTimeout(150000)
    test.skip(!process.env.E2E_CAJERO_EMAIL || !process.env.E2E_CAJERO_PASSWORD, 'Faltan E2E_CAJERO_EMAIL/PASSWORD en .env.test.local')
    const ts = Date.now()
    const owner = await ctxOwner(page, request)
    const cajero = await resolverUsuarioDeRol(request, owner, process.env.E2E_CAJERO_EMAIL, process.env.E2E_CAJERO_PASSWORD, 'CAJERO')

    // "Alguien intentando regalarle acceso": el rol custom otorga EDITAR en comercial explícito.
    const rolCustom = await crearRolCustom(request, owner, `E2E Rol RegaloComercial 125 ${ts}`, { comercial: 'editar' })

    let contextoCaj: any = null
    try {
      await asignarRolCustom(request, owner, cajero.id, rolCustom.id)

      const { context, page: pageCaj } = await loginContextoNuevo(browser, process.env.E2E_CAJERO_EMAIL!, process.env.E2E_CAJERO_PASSWORD!)
      contextoCaj = context

      // El CAJERO aterriza en /ventas (su ruta permitida) pese al "editar" en comercial del rol custom.
      await expect(pageCaj).toHaveURL(/\/ventas/, { timeout: 10000 })

      // 🛑 POSITIVO: el nav NO muestra "Comercial" — `supervisorOnly` se evalúa antes que `permisos_custom`.
      const navLinks = pageCaj.locator('nav').first().getByRole('link')
      await expect(navLinks.filter({ hasText: 'Comercial' })).toHaveCount(0)

      // Y el acceso DIRECTO por URL tampoco cuela — el blocklist de CAJERO (AppLayout.tsx) corre
      // ANTES que la rama de `permisos_custom` en el mismo `useEffect`.
      await goto(pageCaj, '/comercial')
      await waitForApp(pageCaj)
      await expect(pageCaj).toHaveURL(/\/ventas/, { timeout: 10000 })
      await expect(pageCaj).not.toHaveURL(/\/comercial/)
    } finally {
      if (contextoCaj) await contextoCaj.close()
      await asignarRolCustom(request, owner, cajero.id, cajero.rol_custom_id)
      await request.patch(`${SUPABASE_URL}/rest/v1/roles_custom?id=eq.${rolCustom.id}`, { headers: owner.headers, data: { activo: false } })
    }

    const verifRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${cajero.id}&select=rol_custom_id`, { headers: owner.headers })
    const [verif] = (await verifRes.json()) as Array<{ rol_custom_id: string | null }>
    expect(verif.rol_custom_id, '🛑 [125] CRÍTICO: el rol_custom_id del CAJERO compartido no volvió al valor original').toBe(cajero.rol_custom_id)
  })
})
