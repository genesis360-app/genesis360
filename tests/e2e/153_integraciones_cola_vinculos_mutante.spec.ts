/**
 * 153_integraciones_cola_vinculos_mutante.spec.ts
 * E2E MUTANTE — mig 427 (decisión de GO, 2026-09-15): la cola de sincronización con Mercado Libre / Tienda Nube y los
 * vínculos producto ↔ publicación ya no se escriben desde la app. Antes cualquier usuario del negocio (un CAJERO, por
 * REST) podía encolar un job con cualquier publicación o reescribir un vínculo, y el worker mandaba el stock o el precio
 * de un producto a otra publicación de la misma cuenta.
 *
 * A · Cola: ni el DUEÑO ni el CAJERO insertan, modifican ni borran jobs; el DUEÑO la lee (control positivo).
 * B · Vínculos: el DUEÑO crea y borra un vínculo (control positivo); el CAJERO no crea ni reescribe (la publicación del
 *     vínculo sigue igual) y sí lo lee.
 * C · "Forzar sync de stock": el servidor arma el job desde el vínculo (el payload es el del vínculo) y no lo duplica;
 *     el CAJERO no puede.
 * Mutación: corrido contra DEV ANTES de aplicar la 427, A y B fallan (la cola y los vínculos se escribían) y C no
 * existe.
 *
 * Por API contra DEV, Almacén Jorgito. Los vínculos de prueba apuntan a publicaciones inventadas ("MLA-E2E-153-…"):
 * ningún stock ni precio sale a una publicación real por el vínculo de prueba. PATCH y DELETE de la cola apuntan a un
 * id inexistente: prueban el permiso sin tocar jobs reales aunque corra contra la base vieja. El job que arma C queda
 * en la cola (la app ya no puede borrarlo); si un worker lo toma, falla contra la publicación inventada y, al ser de
 * stock, no genera aviso. Ojo: C es el botón real, así que también encola los vínculos reales del negocio que no
 * tengan ya un job en curso.
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const PREFIJO = 'MLA-E2E-153'
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000153'

async function credenciales(request: APIRequestContext, prefijo: string): Promise<string | null> {
  const email = process.env[`E2E_${prefijo}_EMAIL`], pass = process.env[`E2E_${prefijo}_PASSWORD`]
  return email && pass ? loginToken(request, email, pass) : null
}

async function negocioDe(request: APIRequestContext, token: string): Promise<string> {
  const perfil = (await (await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers: restHeaders(token) })).json()) as { id: string }
  const [fila] = (await (await request.get(`${SUPABASE_URL}/rest/v1/users?select=tenant_id&id=eq.${perfil.id}`, { headers: restHeaders(token) })).json()) as { tenant_id: string }[]
  expect(fila?.tenant_id, '[153] no se pudo resolver el negocio del usuario').toBeTruthy()
  return fila.tenant_id
}

async function unProducto(request: APIRequestContext, token: string): Promise<string> {
  const [prod] = (await (await request.get(`${SUPABASE_URL}/rest/v1/productos?select=id&activo=eq.true&limit=1`, { headers: restHeaders(token) })).json()) as { id: string }[]
  expect(prod, '[153] fixture: el negocio de prueba necesita al menos un producto activo').toBeTruthy()
  return prod.id
}

async function mensajeDeError(r: { json: () => Promise<unknown>; text: () => Promise<string> }): Promise<string> {
  try { return ((await r.json()) as { message?: string }).message ?? '' } catch { return await r.text() }
}

test.describe('Integraciones ML/TN: la cola y los vínculos se escriben solo desde el servidor (mig 427, mutante)', () => {
  test('A · la cola no se escribe desde la app, ni siquiera el DUEÑO', async ({ request }) => {
    const owner = await loginToken(request)
    const cajero = await credenciales(request, 'CAJERO')
    test.skip(!cajero, 'Faltan credenciales de CAJERO en tests/e2e/.env.test.local')
    const tenantId = await negocioDe(request, owner)
    const producto = await unProducto(request, owner)
    const cola = `${SUPABASE_URL}/rest/v1/integration_job_queue`

    for (const [quien, token] of [['DUEÑO', owner], ['CAJERO', cajero!]] as const) {
      const alta = await request.post(cola, {
        headers: restHeaders(token),
        data: {
          tenant_id: tenantId, integracion: 'MercadoLibre', tipo: 'sync_stock', status: 'processing',
          payload: { producto_id: producto, meli_item_id: `${PREFIJO}-COLA` },
        },
      })
      expect(alta.ok(), `[153A] el ${quien} NO encola jobs por REST (${alta.status()})`).toBeFalsy()
      const cambio = await request.patch(`${cola}?id=eq.${ID_INEXISTENTE}`, { headers: restHeaders(token), data: { retries: 0 } })
      expect(cambio.ok(), `[153A] el ${quien} NO modifica jobs por REST (${cambio.status()})`).toBeFalsy()
      const baja = await request.delete(`${cola}?id=eq.${ID_INEXISTENTE}`, { headers: restHeaders(token) })
      expect(baja.ok(), `[153A] el ${quien} NO borra jobs por REST (${baja.status()})`).toBeFalsy()
    }

    const lectura = await request.get(`${cola}?select=id,status&limit=1`, { headers: restHeaders(owner) })
    expect(lectura.status(), '[153A] el DUEÑO sí lee la cola de su negocio').toBe(200)
  })

  test('B · vínculos producto ↔ publicación: el DUEÑO los arma, el CAJERO no', async ({ request }) => {
    const owner = await loginToken(request)
    const cajero = await credenciales(request, 'CAJERO')
    test.skip(!cajero, 'Faltan credenciales de CAJERO en tests/e2e/.env.test.local')
    const tenantId = await negocioDe(request, owner)
    const producto = await unProducto(request, owner)
    const vinculos = `${SUPABASE_URL}/rest/v1/inventario_meli_map`
    const item = `${PREFIJO}-${Date.now()}`

    const alta = await request.post(vinculos, {
      headers: restHeaders(owner),
      data: { tenant_id: tenantId, producto_id: producto, meli_item_id: item, sync_stock: false, sync_precio: false },
    })
    expect(alta.status(), `[153B] el DUEÑO crea un vínculo: ${await alta.text()}`).toBe(201)
    const [vinculo] = (await alta.json()) as { id: string }[]

    try {
      const altaCajero = await request.post(vinculos, {
        headers: restHeaders(cajero!),
        data: { tenant_id: tenantId, producto_id: producto, meli_item_id: `${item}-CAJERO`, sync_stock: true, sync_precio: true },
      })
      expect(altaCajero.ok(), `[153B] el CAJERO NO crea vínculos (${altaCajero.status()})`).toBeFalsy()

      const desvio = await request.patch(`${vinculos}?id=eq.${vinculo.id}`, {
        headers: restHeaders(cajero!), data: { meli_item_id: `${PREFIJO}-DESVIO` },
      })
      const filas = desvio.ok() ? ((await desvio.json()) as unknown[]) : []
      expect(filas, '[153B] el CAJERO NO reescribe un vínculo').toHaveLength(0)

      const leidoCajero = await request.get(`${vinculos}?id=eq.${vinculo.id}&select=meli_item_id`, { headers: restHeaders(cajero!) })
      expect(leidoCajero.status(), '[153B] el CAJERO sí lee los vínculos').toBe(200)
      const [actual] = (await leidoCajero.json()) as { meli_item_id: string }[]
      expect(actual?.meli_item_id, '[153B] el vínculo sigue apuntando a su publicación').toBe(item)

      const altaTn = await request.post(`${SUPABASE_URL}/rest/v1/inventario_tn_map`, {
        headers: restHeaders(cajero!),
        data: { tenant_id: tenantId, producto_id: producto, tn_product_id: 153153153, sync_stock: true },
      })
      expect(altaTn.ok(), `[153B] el CAJERO NO crea vínculos de Tienda Nube (${altaTn.status()})`).toBeFalsy()
    } finally {
      const baja = await request.delete(`${vinculos}?id=eq.${vinculo.id}`, { headers: restHeaders(owner) })
      expect(baja.ok(), `[153B] el DUEÑO borra su vínculo de prueba: ${await baja.text()}`).toBeTruthy()
    }
  })

  test('C · forzar sync: el servidor arma el job desde el vínculo, sin duplicar', async ({ request }) => {
    const owner = await loginToken(request)
    const cajero = await credenciales(request, 'CAJERO')
    test.skip(!cajero, 'Faltan credenciales de CAJERO en tests/e2e/.env.test.local')
    const tenantId = await negocioDe(request, owner)
    const producto = await unProducto(request, owner)
    const item = `${PREFIJO}-SYNC-${Date.now()}`
    const forzar = (token: string) => request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_forzar_sync_stock`, {
      headers: restHeaders(token), data: { p_integracion: 'MercadoLibre' },
    })
    const jobsDelItem = async () => (await (await request.get(
      `${SUPABASE_URL}/rest/v1/integration_job_queue?payload->>meli_item_id=eq.${item}&select=id,tenant_id,tipo,status,payload`,
      { headers: restHeaders(owner) },
    )).json()) as { id: string; tenant_id: string; tipo: string; status: string; payload: Record<string, unknown> }[]

    const alta = await request.post(`${SUPABASE_URL}/rest/v1/inventario_meli_map`, {
      headers: restHeaders(owner),
      data: { tenant_id: tenantId, producto_id: producto, meli_item_id: item, sync_stock: true, sync_precio: false },
    })
    expect(alta.status(), `[153C] fixture: vínculo de prueba: ${await alta.text()}`).toBe(201)
    const [vinculo] = (await alta.json()) as { id: string }[]

    try {
      const intentoCajero = await forzar(cajero!)
      expect(await mensajeDeError(intentoCajero), '[153C] el CAJERO NO puede forzar la sincronización').toContain('No autorizado')

      const primera = await forzar(owner)
      expect(primera.status(), `[153C] el DUEÑO fuerza la sincronización: ${await primera.text()}`).toBe(200)
      expect(Number(await primera.json()), '[153C] encoló al menos el job del vínculo de prueba').toBeGreaterThanOrEqual(1)

      const jobs = await jobsDelItem()
      expect(jobs, '[153C] un job para la publicación del vínculo').toHaveLength(1)
      expect(jobs[0].tenant_id).toBe(tenantId)
      expect(jobs[0].tipo).toBe('sync_stock')
      expect(jobs[0].status).toBe('pending')
      expect(jobs[0].payload.producto_id, '[153C] el payload lo arma el servidor desde el vínculo').toBe(producto)

      const segunda = await forzar(owner)
      expect(segunda.status()).toBe(200)
      expect(await jobsDelItem(), '[153C] volver a forzar no duplica el job en curso').toHaveLength(1)
    } finally {
      await request.delete(`${SUPABASE_URL}/rest/v1/inventario_meli_map?id=eq.${vinculo.id}`, { headers: restHeaders(owner) })
    }
  })
})
