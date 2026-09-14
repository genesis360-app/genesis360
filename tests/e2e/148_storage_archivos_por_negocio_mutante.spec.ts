/**
 * 148 — Archivos de RRHH, Envíos y presupuestos de servicios: cada negocio ve lo suyo, RRHH lo ve
 * quien lo maneja (y el propio empleado), y el transportista sube por token (mutante, por API).
 *
 * Contexto (mig 419): PROD no tenía políticas para estos 3 buckets (todo fallaba) y las de DEV eran
 * cross-tenant (`auth.uid() IS NOT NULL`) o no cubrían `prestamos/` y `recibos/`. Decisiones de GO
 * (2026-09-14): RRHH = quien lo maneja + dueño + rol custom que lo permita + el propio empleado desde
 * Mi Portal; el transportista sube foto y firma desde su link (EF `transportista-subir-archivo`).
 *
 * Mutante: con las políticas viejas de DEV, "otro negocio" podía subir/leer (las aserciones de 403
 * fallan) y `recibos/<empleado>/…` no se podía subir (la de RRHH falla).
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL, ANON } from './helpers/fixtures'

const PDF = Buffer.from('%PDF-1.4\n%e2e\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, apikey: ANON! })

async function subir(request: APIRequestContext, token: string, bucket: string, path: string, cuerpo: Buffer, tipo: string) {
  return request.post(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: { ...auth(token), 'Content-Type': tipo },
    data: cuerpo,
  })
}
async function leer(request: APIRequestContext, token: string, bucket: string, path: string) {
  return request.get(`${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${path}`, { headers: auth(token) })
}
async function borrar(request: APIRequestContext, token: string, bucket: string, paths: string[]) {
  await request.delete(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    data: { prefixes: paths },
  })
}

async function credenciales(request: APIRequestContext, prefijo: string): Promise<string | null> {
  const email = process.env[`E2E_${prefijo}_EMAIL`], pass = process.env[`E2E_${prefijo}_PASSWORD`]
  return email && pass ? loginToken(request, email, pass) : null
}

test.describe('Storage por negocio (mig 419, mutante)', () => {
  test('presupuestos-servicios y etiquetas-envios: solo rutas del propio negocio', async ({ request }) => {
    const owner = await loginToken(request)
    const sello = Date.now()
    const [yo] = (await (await request.get(`${SUPABASE_URL}/rest/v1/users?select=tenant_id&limit=1`, { headers: restHeaders(owner) })).json()) as { tenant_id: string }[]
    const ajeno = crypto.randomUUID()
    const [envio] = (await (await request.get(`${SUPABASE_URL}/rest/v1/envios?select=id&tenant_id=eq.${yo.tenant_id}&limit=1`, { headers: restHeaders(owner) })).json()) as { id: string }[]
    expect(envio, 'fixture: el tenant de prueba necesita al menos un envío').toBeTruthy()

    const propios = {
      presup: `${yo.tenant_id}/e2e_${sello}.pdf`,
      pod: `pod/${envio.id}/e2e_${sello}.png`,
      factura: `facturas-courier/${yo.tenant_id}/e2e_${sello}.pdf`,
    }
    try {
      expect((await subir(request, owner, 'presupuestos-servicios', propios.presup, PDF, 'application/pdf')).status(), '[148] presupuesto propio').toBe(200)
      expect((await subir(request, owner, 'etiquetas-envios', propios.pod, PNG, 'image/png')).status(), '[148] POD de un envío propio').toBe(200)
      expect((await subir(request, owner, 'etiquetas-envios', propios.factura, PDF, 'application/pdf')).status(), '[148] factura de courier propia').toBe(200)
      expect((await leer(request, owner, 'etiquetas-envios', propios.pod)).status(), '[148] leer el POD propio').toBe(200)

      const noPresup = await subir(request, owner, 'presupuestos-servicios', `${ajeno}/e2e_${sello}.pdf`, PDF, 'application/pdf')
      expect(noPresup.ok(), '[148] NO se sube a la carpeta de otro negocio (presupuestos)').toBeFalsy()
      const noPod = await subir(request, owner, 'etiquetas-envios', `pod/${ajeno}/e2e_${sello}.png`, PNG, 'image/png')
      expect(noPod.ok(), '[148] NO se sube el POD de un envío que no es del negocio').toBeFalsy()
      const noFactura = await subir(request, owner, 'etiquetas-envios', `facturas-courier/${ajeno}/e2e_${sello}.pdf`, PDF, 'application/pdf')
      expect(noFactura.ok(), '[148] NO se sube a la carpeta de facturas de otro negocio').toBeFalsy()
    } finally {
      await borrar(request, owner, 'presupuestos-servicios', [propios.presup])
      await borrar(request, owner, 'etiquetas-envios', [propios.pod, propios.factura])
    }
  })

  test('empleados: RRHH sube recibos; supervisor y cajero no leen; el empleado ve lo suyo', async ({ request }) => {
    const owner = await loginToken(request)
    const rrhh = await credenciales(request, 'RRHH')
    const supervisor = await credenciales(request, 'SUPERVISOR')
    const cajero = await credenciales(request, 'CAJERO')
    test.skip(!rrhh || !supervisor || !cajero, 'Faltan credenciales de RRHH/SUPERVISOR/CAJERO en .env.test.local')

    const empleados = (await (await request.get(`${SUPABASE_URL}/rest/v1/empleados?select=id&user_id=is.null&activo=eq.true&limit=2`, { headers: restHeaders(owner) })).json()) as { id: string }[]
    expect(empleados.length, 'fixture: hacen falta 2 empleados activos sin usuario').toBeGreaterThanOrEqual(2)
    const [emp, otro] = empleados
    const sello = Date.now()
    const recibo = `recibos/${emp.id}/e2e_${sello}.pdf`
    const reciboOtro = `recibos/${otro.id}/e2e_${sello}.pdf`

    // id del usuario cajero, para vincularlo como empleado
    const perfilCajero = await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers: auth(cajero!) })
    const cajeroId = ((await perfilCajero.json()) as { id: string }).id

    try {
      // RRHH sube (antes `recibos/…` fallaba hasta en DEV)
      expect((await subir(request, rrhh!, 'empleados', recibo, PDF, 'application/pdf')).status(), '[148] RRHH sube un recibo').toBe(200)
      expect((await subir(request, rrhh!, 'empleados', reciboOtro, PDF, 'application/pdf')).status(), '[148] RRHH sube otro recibo').toBe(200)
      expect((await leer(request, owner, 'empleados', recibo)).status(), '[148] el DUEÑO lo lee').toBe(200)

      expect((await leer(request, supervisor!, 'empleados', recibo)).ok(), '[148] el SUPERVISOR NO lee archivos de RRHH').toBeFalsy()
      expect((await leer(request, cajero!, 'empleados', recibo)).ok(), '[148] el CAJERO (rol custom sin RRHH) NO los lee').toBeFalsy()
      expect((await subir(request, supervisor!, 'empleados', `recibos/${emp.id}/e2e_sup_${sello}.pdf`, PDF, 'application/pdf')).ok(),
        '[148] el SUPERVISOR NO sube').toBeFalsy()

      // Mi Portal: el cajero pasa a ser ese empleado → ve SU recibo, no el de otro, y no sube
      const vincular = await request.patch(`${SUPABASE_URL}/rest/v1/empleados?id=eq.${emp.id}`, { headers: restHeaders(owner), data: { user_id: cajeroId } })
      expect(vincular.ok(), `vincular empleado al cajero: ${await vincular.text()}`).toBeTruthy()
      expect((await leer(request, cajero!, 'empleados', recibo)).status(), '[148] el empleado ve SU recibo').toBe(200)
      expect((await leer(request, cajero!, 'empleados', reciboOtro)).ok(), '[148] el empleado NO ve el de otro').toBeFalsy()
      expect((await subir(request, cajero!, 'empleados', `recibos/${emp.id}/e2e_propio_${sello}.pdf`, PDF, 'application/pdf')).ok(),
        '[148] el empleado NO sube').toBeFalsy()
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/empleados?id=eq.${emp.id}`, { headers: restHeaders(owner), data: { user_id: null } })
      await borrar(request, owner, 'empleados', [recibo, reciboOtro])
    }
  })

  test('transportista: sube la foto con su token; con un token inválido no', async ({ request }) => {
    const owner = await loginToken(request)
    const [envio] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/envios?select=id,token_transportista&token_transportista=not.is.null&estado=in.(pendiente,en_camino)&limit=1`,
      { headers: restHeaders(owner) },
    )).json()) as { id: string; token_transportista: string }[]
    expect(envio, 'fixture: hace falta un envío abierto con token de transportista').toBeTruthy()

    const url = `${SUPABASE_URL}/functions/v1/transportista-subir-archivo`
    const malo = await request.post(url, {
      headers: { apikey: ANON! },
      multipart: { token: 'no-existe', tipo: 'foto', archivo: { name: 'x.png', mimeType: 'image/png', buffer: PNG } },
    })
    expect(malo.status(), '[148] token inválido → 404').toBe(404)

    const bien = await request.post(url, {
      headers: { apikey: ANON! },
      multipart: { token: envio.token_transportista, tipo: 'foto', archivo: { name: 'x.png', mimeType: 'image/png', buffer: PNG } },
    })
    expect(bien.status(), `[148] el transportista sube con su token: ${await bien.text()}`).toBe(200)
    const { path, url: firmada } = (await bien.json()) as { path: string; url: string }
    try {
      expect(path.startsWith(`pod/${envio.id}/`), '[148] la ruta la arma el servidor, dentro del envío').toBeTruthy()
      expect(firmada).toContain('/storage/v1/object/sign/')
      expect((await leer(request, owner, 'etiquetas-envios', path)).status(), '[148] el negocio ve la foto subida').toBe(200)
    } finally {
      await borrar(request, owner, 'etiquetas-envios', [path])
    }
  })

  test('transportista por la PANTALLA: la foto de entrega se sube desde /transporte/:token', async ({ browser, request }) => {
    // 🛑 Contexto SIN sesión: el proyecto `chromium` trae el storageState del DUEÑO, y con esa sesión la
    // página vieja (que subía directo a storage) pasaba igual — un falso verde. El transportista real
    // entra sin login.
    const contexto = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    })
    const page = await contexto.newPage()
    const owner = await loginToken(request)
    const [envio] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/envios?select=id,token_transportista&token_transportista=not.is.null&estado=in.(pendiente,en_camino)&limit=1`,
      { headers: restHeaders(owner) },
    )).json()) as { id: string; token_transportista: string }[]
    expect(envio, 'fixture: hace falta un envío abierto con token de transportista').toBeTruthy()
    const inicio = new Date(Date.now() - 5_000).toISOString()

    try {
      await page.goto(`/transporte/${envio.token_transportista}`)
      await expect(page.getByText('Comprobante de entrega (POD)')).toBeVisible({ timeout: 15000 })
      // Con la página vieja subía directo a storage sin sesión → "Error al subir la foto".
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'entrega.png', mimeType: 'image/png', buffer: PNG })
      // El toast (role=status), no el texto del botón, que también dice "Foto subida".
      await expect(page.getByRole('status').filter({ hasText: 'Foto subida' })).toBeVisible({ timeout: 15000 })
    } finally {
      const lista = await request.post(`${SUPABASE_URL}/storage/v1/object/list/etiquetas-envios`, {
        headers: { ...auth(owner), 'Content-Type': 'application/json' },
        data: { prefix: `pod/${envio.id}`, limit: 100, sortBy: { column: 'created_at', order: 'desc' } },
      })
      const archivos = lista.ok() ? ((await lista.json()) as { name: string; created_at: string }[]) : []
      const nuevos = archivos.filter(a => a.created_at >= inicio).map(a => `pod/${envio.id}/${a.name}`)
      if (nuevos.length) await borrar(request, owner, 'etiquetas-envios', nuevos)
      await contexto.close()
    }
  })
})
