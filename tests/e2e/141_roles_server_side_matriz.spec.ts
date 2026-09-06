/**
 * 141_roles_server_side_matriz.spec.ts
 * E2E (API/RLS) — **Tanda F1**: ¿la DB rechaza por REST/RPC directo lo que la UI esconde por rol?
 *
 * Por qué existe: las specs por rol que ya había (13/15/16/17/18) validan **todo por UI** — qué
 * rutas entran, cuáles redirigen, qué links del sidebar no se ven. Eso choca de frente con el
 * hallazgo **H1** del propio UAT ("controles financieros SOLO client-side") y con la obligación #3
 * de la REGLA #0: los guards tienen que estar server-side ADEMÁS de en la UI, porque la UI se
 * cachea y se bypassea. Un usuario con su token real y `curl` no pasa por ningún componente React.
 *
 * No maneja browser: pega directo a PostgREST con el `access_token` real de cada rol.
 *
 * 🔒 TODAS las sondas son NO MUTANTES, a propósito (esta spec corre contra un tenant compartido):
 *   • UPDATE → PATCH con el MISMO valor que ya tiene la fila. Si RLS deja pasar, PostgREST
 *     devuelve la fila; si bloquea, devuelve `[]`. El dato no cambia.
 *   • INSERT → POST con una clave única DUPLICADA. `42501` = RLS lo frenó · `23505` = RLS lo dejó
 *     pasar y lo frenó el UNIQUE. En los dos casos no se inserta nada.
 *   • RPC de cierre → se pide el MES EN CURSO, que la regla de negocio rechaza siempre. Así se ve
 *     si el rechazo vino del guard de ROL o de la regla, sin cerrar ningún período de verdad.
 *
 * Foto de datos: tenant "Almacén Jorgito" (DEV) con los usuarios por rol de `.env.test.local`. La
 * spec busca sus propios objetivos (producto/gasto/método de pago) en vez de hardcodear ids.
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const TENANT = '3769b1db-10f4-46a6-bc7f-eb669307730d'
/** Los 4 usuarios por rol de `.env.test.local` están fijados a Norte con `puede_ver_todas=false`. */
const SUCURSAL_SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'

interface RolProbado { rol: string; email?: string; password?: string }

const ROLES: RolProbado[] = [
  { rol: 'CAJERO', email: process.env.E2E_CAJERO_EMAIL, password: process.env.E2E_CAJERO_PASSWORD },
  { rol: 'DEPOSITO', email: process.env.E2E_DEPOSITO_EMAIL, password: process.env.E2E_DEPOSITO_PASSWORD },
  { rol: 'RRHH', email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD },
  { rol: 'CONTADOR', email: process.env.E2E_CONTADOR_EMAIL, password: process.env.E2E_CONTADOR_PASSWORD },
]

const rolesConCredenciales = () => ROLES.filter((r) => r.email && r.password)

/**
 * Un login por rol para TODA la spec. Sin esto son ~50 logins en 20 s y Supabase empieza a
 * rechazarlos por rate limit — un falso rojo que además es justo el patrón que la Tanda D vino a
 * corregir en la app: no martillar el endpoint de auth.
 */
const cacheTokens = new Map<string, Promise<string>>()
function tokenDe(request: APIRequestContext, clave: string, email?: string, password?: string): Promise<string> {
  const cacheado = cacheTokens.get(clave)
  if (cacheado) return cacheado
  const p = loginToken(request, email, password)
  cacheTokens.set(clave, p)
  return p
}
const tokenRol = (request: APIRequestContext, r: RolProbado) => tokenDe(request, r.rol, r.email, r.password)
const tokenOwner = (request: APIRequestContext) => tokenDe(request, '__owner__')

/** PATCH con el mismo valor. `true` = la RLS dejó escribir (devolvió la fila). */
async function rlsDejaEscribir(request: APIRequestContext, token: string, path: string, body: object): Promise<boolean> {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(token), data: body })
  if (!res.ok()) return false
  return ((await res.json()) as unknown[]).length > 0
}

/** POST con clave única duplicada. `true` = la RLS dejó pasar (llegó al UNIQUE, 23505). */
async function rlsDejaInsertar(request: APIRequestContext, token: string, path: string, body: object): Promise<boolean> {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(token), data: body })
  if (res.ok()) return true
  const j = (await res.json().catch(() => ({}))) as { code?: string }
  if (j.code === '42501') return false
  if (j.code === '23505') return true
  throw new Error(`[141] sonda de INSERT sobre ${path} no concluyente: ${res.status()} ${JSON.stringify(j)}`)
}

/** Objetivos reales del tenant, buscados con el token del DUEÑO (no hardcodeados). */
async function objetivos(request: APIRequestContext) {
  const owner = await tokenOwner(request)
  const h = restHeaders(owner)
  const get = async (path: string) => (await (await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: h })).json()) as Record<string, unknown>[]

  const [producto] = await get('productos?activo=eq.true&select=id,sku,precio_venta&limit=1')
  const [metodo] = await get('metodos_pago?select=id,nombre&limit=1')
  // Gasto del mes en curso: uno de un período ya cerrado lo frenaría el trigger de cierre
  // contable, no la RLS — y la sonda mediría otra cosa.
  const desdeMes = new Date().toISOString().slice(0, 8) + '01'
  const [gasto] = await get(`gastos?fecha=gte.${desdeMes}&select=id,monto&order=fecha.desc&limit=1`)
  const [ownerRow] = await get('users?rol=eq.DUEÑO&select=id&limit=1')

  expect(producto, '[141] el tenant de prueba necesita al menos un producto activo').toBeTruthy()
  expect(metodo, '[141] el tenant de prueba necesita al menos un método de pago').toBeTruthy()
  expect(ownerRow, '[141] el tenant de prueba necesita un usuario DUEÑO').toBeTruthy()
  return { producto, metodo, gasto, ownerId: ownerRow.id as string }
}

test.describe('F1 — guards server-side que SÍ funcionan (regresión)', () => {
  test('ningún rol operativo puede tocar la configuración del negocio (tenants)', async ({ request }) => {
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaEscribir(request, token, `tenants?id=eq.${TENANT}`, { cotizacion_usd: null }),
        `[141] ${rol} NO debería poder escribir en tenants por REST directo`,
      ).toBe(false)
    }
  })

  test('ningún rol operativo puede escalar privilegios editando users', async ({ request }) => {
    const { ownerId } = await objetivos(request)
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaEscribir(request, token, `users?id=eq.${ownerId}`, { rol: 'DUEÑO' }),
        `[141] ${rol} NO debería poder editar la fila del DUEÑO (escalada de privilegios)`,
      ).toBe(false)
    }
  })

  test('ningún rol operativo ve los movimientos de la Caja Fuerte', async ({ request }) => {
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      const res = await request.get(`${SUPABASE_URL}/rest/v1/boveda_retiros?select=id&limit=3`, { headers: restHeaders(token) })
      expect((await res.json()) as unknown[], `[141] ${rol} NO debería leer boveda_retiros`).toHaveLength(0)
    }
  })

  test('ningún rol operativo puede cambiar la clave maestra ni dar de baja un incobrable', async ({ request }) => {
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      const clave = await request.post(`${SUPABASE_URL}/rest/v1/rpc/set_clave_maestra`, {
        headers: restHeaders(token), data: { p_clave: 'noDeberiaFuncionar' },
      })
      expect(clave.ok(), `[141] ${rol} NO debería poder ejecutar set_clave_maestra`).toBeFalsy()

      const incobrable = await request.post(`${SUPABASE_URL}/rest/v1/rpc/marcar_incobrable`, {
        headers: restHeaders(token), data: { p_cliente_id: '00000000-0000-0000-0000-000000000000', p_clave: 'x' },
      })
      expect(incobrable.ok(), `[141] ${rol} NO debería poder ejecutar marcar_incobrable`).toBeFalsy()
    }
  })

  test('cerrar período contable: el RPC filtra por rol (CONTADOR sí, operativos no)', async ({ request }) => {
    // Mes EN CURSO: la regla de negocio lo rechaza siempre ("no podés cerrar un período en curso"),
    // así que la sonda distingue quién fue frenado por el ROL sin cerrar nada de verdad.
    const mesEnCurso = new Date().toISOString().slice(0, 8) + '01'
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/cerrar_periodo`, {
        headers: restHeaders(token), data: { p_periodo: mesEnCurso },
      })
      expect(res.ok(), `[141] cerrar_periodo del mes en curso debe fallar siempre (${rol})`).toBeFalsy()
      const msg = await res.text()
      if (rol === 'CONTADOR') {
        // CONTADOR está autorizado A PROPÓSITO (cerrar_periodo lo incluye) → el rechazo tiene que
        // venir de la regla de negocio, no del guard de rol.
        expect(msg, '[141] CONTADOR debería pasar el guard de ROL de cerrar_periodo').not.toContain('no puede cerrar periodos contables')
      } else {
        expect(msg, `[141] ${rol} debería ser frenado por el guard de ROL de cerrar_periodo`).toContain('no puede cerrar periodos contables')
      }
    }
  })

  // mig 394 — cerró el hueco F1-h1: el guard de rol vivía SOLO en el RPC y se esquivaba
  // escribiendo la tabla directo. La tabla es ahora solo-lectura vía RLS.
  test('cerrar período contable: tampoco se puede saltear el RPC escribiendo la tabla (mig 394)', async ({ request }) => {
    const { ownerId } = await objetivos(request)
    const fila = { tenant_id: TENANT, periodo: '2026-04-01', fecha_cierre: '2026-09-06', cerrado_por: ownerId, cerrado_por_rol: 'DUEÑO' }
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaInsertar(request, token, 'cierres_contables', fila),
        `[141] ${rol} NO debería poder insertar en cierres_contables directo (saltearía cerrar_periodo)`,
      ).toBe(false)
    }
    // Y el DUEÑO tampoco: esta tabla se escribe SOLO por RPC, para que los totales congelados
    // y el orden de períodos los calcule siempre la función.
    const owner = await tokenOwner(request)
    expect(
      await rlsDejaInsertar(request, owner, 'cierres_contables', fila),
      '[141] ni el DUEÑO escribe cierres_contables a mano — solo por cerrar_periodo()',
    ).toBe(false)
  })

  // F4 — aislamiento por sucursal CRUZADO CON ROL. La spec 94 ya cubría esto para SUPERVISOR;
  // acá se verifica que el aislamiento no dependa del rol (los 4 usuarios de prueba están fijados
  // a Sucursal Norte con `puede_ver_todas=false`).
  test('ningún rol operativo de Sucursal Norte ve datos de Sucursal Sur', async ({ request }) => {
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      for (const tabla of ['ventas', 'caja_sesiones', 'gastos']) {
        const res = await request.get(
          `${SUPABASE_URL}/rest/v1/${tabla}?sucursal_id=eq.${SUCURSAL_SUR}&select=id&limit=5`,
          { headers: restHeaders(token) },
        )
        expect(res.ok(), await res.text()).toBeTruthy()
        expect(
          (await res.json()) as unknown[],
          `[141] ${rol} (Sucursal Norte) NO debería leer ${tabla} de Sucursal Sur`,
        ).toHaveLength(0)
      }
    }
  })

  test('el rol operativo SÍ puede leer lo suyo (control de que la RLS no bloquea todo)', async ({ request }) => {
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?select=id&limit=1`, { headers: restHeaders(token) })
      expect((await res.json()) as unknown[], `[141] ${rol} debería poder leer el catálogo`).not.toHaveLength(0)
    }
  })
})

/**
 * 🔴 HUECOS ABIERTOS — verificados con sondas REST reales el 2026-09-06 (los 4 roles).
 *
 * Van con `test.fail()`: hoy la aserción correcta FALLA porque el guard no existe. Playwright los
 * reporta en verde mientras siga abierto y **hace fallar la corrida el día que se cierren** — que
 * es cuando hay que sacarles el `test.fail()`. Así el hueco queda medido y no se olvida, sin dejar
 * la suite en rojo permanente ni escribir una aserción que afirme lo incorrecto.
 *
 * NO se cierran acá a propósito: CLAUDE.md pide guard por guard, cada uno probado en DEV, porque
 * es el hot-path de plata (`VentasPage` actualiza `productos.stock_actual` desde el cliente en
 * devoluciones/anulaciones → un guard genérico sobre `productos` rompería ventas legítimas; el
 * correcto es un trigger que mire SOLO las columnas de precio). Decisión pendiente de GO.
 */
test.describe('F1 — huecos abiertos (esperados en rojo hasta que se implemente el guard)', () => {
  test('🔴 F1-h2: ningún rol operativo debería poder cambiar el PRECIO DE VENTA de un producto', async ({ request }) => {
    test.fail()
    const { producto } = await objetivos(request)
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaEscribir(request, token, `productos?id=eq.${producto.id}`, { precio_venta: producto.precio_venta }),
        `[141] ${rol} NO debería poder cambiar precios por REST directo`,
      ).toBe(false)
    }
  })

  test('🔴 F1-h3: ningún rol operativo debería poder editar el MONTO de un gasto', async ({ request }) => {
    test.fail()
    const { gasto } = await objetivos(request)
    test.skip(!gasto, '[141] no hay gastos del mes en curso en el tenant de prueba')
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaEscribir(request, token, `gastos?id=eq.${gasto.id}`, { monto: gasto.monto }),
        `[141] ${rol} NO debería poder editar el monto de un gasto por REST directo`,
      ).toBe(false)
    }
  })

  test('🔴 F1-h4: ningún rol operativo debería poder dar de alta productos', async ({ request }) => {
    test.fail()
    const { producto } = await objetivos(request)
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaInsertar(request, token, 'productos', { tenant_id: TENANT, nombre: 'sonda F1', sku: producto.sku, precio_costo: 1, precio_venta: 1 }),
        `[141] ${rol} NO debería poder crear productos por REST directo`,
      ).toBe(false)
    }
  })

  test('🔴 F1-h5: ningún rol operativo debería poder tocar los medios de pago (config)', async ({ request }) => {
    test.fail()
    const { metodo } = await objetivos(request)
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaEscribir(request, token, `metodos_pago?id=eq.${metodo.id}`, { nombre: metodo.nombre }),
        `[141] ${rol} NO debería poder renombrar un método de pago`,
      ).toBe(false)
      expect(
        await rlsDejaInsertar(request, token, 'metodos_pago', { tenant_id: TENANT, nombre: metodo.nombre }),
        `[141] ${rol} NO debería poder crear métodos de pago`,
      ).toBe(false)
    }
  })
})
