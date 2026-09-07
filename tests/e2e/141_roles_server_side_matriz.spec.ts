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
  const [gasto] = await get(`gastos?fecha=gte.${desdeMes}&select=id,monto,descripcion&order=fecha.desc&limit=1`)
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
 * Guards CERRADOS por la mig 396 (antes eran los huecos F1-h2 a h6).
 *
 * Ninguno se pudo cerrar con RLS a secas, y esa es la parte importante: un "CAJERO no escribe
 * `productos`" **rompe ventas legítimas**, porque `VentasPage` actualiza `productos.stock_actual`
 * DESDE EL CLIENTE en devoluciones y anulaciones. Por eso el guard es un trigger que mira **solo las
 * columnas de precio**, y en gastos se enforcea el **umbral** del cajero, no el rol.
 *
 * Por eso el bloque de POSITIVOS de más abajo no es decorativo: es el que detecta que un guard
 * futuro se pasó de estricto.
 */
test.describe('F1 — guards cerrados por la mig 396', () => {
  test('ningún rol operativo puede CAMBIAR el precio de un producto', async ({ request }) => {
    const { producto } = await objetivos(request)
    const original = Number(producto.precio_venta)
    // OJO: hay que mandar un valor DISTINTO. Con el mismo valor el trigger no se dispara (no hay
    // cambio de precio) y la sonda daría un falso verde — pasó en la verificación de la mig 396.
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaEscribir(request, token, `productos?id=eq.${producto.id}`, { precio_venta: original + 7 }),
        `[141] ${rol} NO debería poder cambiar precios por REST directo`,
      ).toBe(false)
    }
    // El precio tiene que haber quedado intacto: si algún rol pasó, además mutó el catálogo.
    const owner = await tokenOwner(request)
    const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}&select=precio_venta`, { headers: restHeaders(owner) })
    const [fila] = (await res.json()) as { precio_venta: number }[]
    expect(Number(fila.precio_venta), '[141] ningún rol operativo debió poder mover el precio').toBe(original)
  })

  test('ningún rol operativo puede dar de alta productos', async ({ request }) => {
    const { producto } = await objetivos(request)
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaInsertar(request, token, 'productos', { tenant_id: TENANT, nombre: 'sonda F1', sku: producto.sku, precio_costo: 1, precio_venta: 1 }),
        `[141] ${rol} NO debería poder crear productos por REST directo`,
      ).toBe(false)
    }
  })

  test('ningún rol operativo puede tocar los medios de pago (config)', async ({ request }) => {
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

  // F1-h6 — el hueco que hacía inútiles a todos los demás: `roles_custom` era escribible por
  // cualquier usuario del tenant, así que alguien con rol custom podía AUTO-OTORGARSE 'editar' y
  // saltear los guards. Un guard que confía en un dato que el atacante controla no es un guard.
  test('ningún rol operativo puede editar los permisos de un rol custom (escalada)', async ({ request }) => {
    const owner = await tokenOwner(request)
    const res = await request.get(`${SUPABASE_URL}/rest/v1/roles_custom?select=id,nombre&limit=1`, { headers: restHeaders(owner) })
    const [rolCustom] = (await res.json()) as { id: string; nombre: string }[]
    test.skip(!rolCustom, '[141] el tenant de prueba no tiene roles custom')
    for (const { rol, email, password } of rolesConCredenciales()) {
      const token = await tokenRol(request, { rol, email, password })
      expect(
        await rlsDejaEscribir(request, token, `roles_custom?id=eq.${rolCustom.id}`, { nombre: rolCustom.nombre }),
        `[141] ${rol} NO debería poder editar un rol custom (escalada de privilegios)`,
      ).toBe(false)
    }
  })

  test('un rol custom en SOLO LECTURA no puede escribir el módulo, aunque su rol base sí pudiera', async ({ request }) => {
    // Foto de datos: `cajero1@local.com` (E2E_CAJERO_*) tiene el rol custom `GO_Cajero` con
    // `gastos: 'ver'` e `inventario: 'ver'`. Cubre la rama de rol custom del guard (F3).
    const { gasto } = await objetivos(request)
    test.skip(!gasto, '[141] no hay gastos del mes en curso en el tenant de prueba')
    const token = await tokenRol(request, ROLES[0])
    expect(
      await rlsDejaEscribir(request, token, `gastos?id=eq.${gasto.id}`, { monto: gasto.monto }),
      '[141] un rol custom con gastos=ver no debe poder escribir gastos',
    ).toBe(false)
  })
})

/**
 * 🔑 POSITIVOS — que los guards NO se hayan pasado de estrictos.
 *
 * Estos son los tests que valen oro: cada uno corresponde a un flujo real que un guard mal hecho
 * rompería en producción, en el hot-path de la plata.
 */
test.describe('F1 — los guards no bloquean lo legítimo', () => {
  test('🔑 el CAJERO sigue pudiendo escribir stock_actual (devolución / anulación de venta)', async ({ request }) => {
    // `VentasPage` hace exactamente este UPDATE desde el cliente al devolver o anular. Si un guard
    // sobre `productos` lo bloqueara, se romperían las devoluciones.
    const { producto } = await objetivos(request)
    const owner = await tokenOwner(request)
    const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}&select=stock_actual`, { headers: restHeaders(owner) })
    const [{ stock_actual }] = (await res.json()) as { stock_actual: number }[]

    for (const rol of ['CAJERO', 'DEPOSITO']) {
      const r = ROLES.find((x) => x.rol === rol)
      if (!r?.email) continue
      const token = await tokenRol(request, r)
      expect(
        await rlsDejaEscribir(request, token, `productos?id=eq.${producto.id}`, { stock_actual }),
        `[141] ${rol} DEBE poder escribir stock_actual — lo hace VentasPage en devoluciones`,
      ).toBe(true)
    }
  })

  test('🔑 un UPDATE que NO cambia el precio pasa (el guard mira las columnas, no la tabla)', async ({ request }) => {
    const { producto } = await objetivos(request)
    const deposito = ROLES.find((x) => x.rol === 'DEPOSITO')
    test.skip(!deposito?.email, '[141] faltan credenciales de DEPOSITO')
    const token = await tokenRol(request, deposito!)
    expect(
      await rlsDejaEscribir(request, token, `productos?id=eq.${producto.id}`, { precio_venta: producto.precio_venta }),
      '[141] mandar el MISMO precio no es un cambio de precio: no debe bloquearse',
    ).toBe(true)
  })

  test('🔑 DUEÑO y SUPERVISOR sí pueden cambiar precios (y el precio queda restaurado)', async ({ request }) => {
    const { producto } = await objetivos(request)
    const original = Number(producto.precio_venta)
    const owner = await tokenOwner(request)
    try {
      const sup = await tokenDe(request, 'SUPERVISOR', process.env.E2E_SUPERVISOR_EMAIL, process.env.E2E_SUPERVISOR_PASSWORD)
      expect(
        await rlsDejaEscribir(request, sup, `productos?id=eq.${producto.id}`, { precio_venta: original + 7 }),
        '[141] el SUPERVISOR DEBE poder cambiar precios',
      ).toBe(true)
    } finally {
      // Pase lo que pase, el catálogo vuelve como estaba.
      await rlsDejaEscribir(request, owner, `productos?id=eq.${producto.id}`, { precio_venta: original })
    }
    const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}&select=precio_venta`, { headers: restHeaders(owner) })
    const [fila] = (await res.json()) as { precio_venta: number }[]
    expect(Number(fila.precio_venta), '[141] el precio debe quedar restaurado').toBe(original)
  })

  // 🛑 REGLA #0 — la RLS de `venta_items` depende de una columna DENORMALIZADA (mig 398/399).
  // Si se desincroniza de `ventas.sucursal_id`, la policy empieza a decidir con un dato viejo. Este
  // test es el control de que la sincronía se mantiene; si se pone rojo, revisar el trigger
  // `trg_venta_items_sucursal` antes que cualquier otra cosa.
  test('🔑 venta_items.sucursal_id sigue sincronizada con ventas.sucursal_id', async ({ request }) => {
    const owner = await tokenOwner(request)
    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?select=id,sucursal_id,ventas(sucursal_id)&order=id&limit=300`,
      { headers: restHeaders(owner) },
    )
    expect(res.ok(), await res.text()).toBeTruthy()
    const filas = (await res.json()) as { id: string; sucursal_id: string | null; ventas: { sucursal_id: string | null } | null }[]
    expect(filas.length, '[141] el tenant de prueba debería tener ítems de venta').toBeGreaterThan(0)

    const desincronizadas = filas.filter((f) => f.ventas && f.sucursal_id !== f.ventas.sucursal_id)
    expect(
      desincronizadas.map((f) => f.id),
      '[141] venta_items.sucursal_id desincronizada — la RLS por sucursal decidiría con un dato viejo',
    ).toEqual([])
  })

  test('🔑 el CONTADOR sigue pudiendo editar campos de un gasto (su tarea fiscal)', async ({ request }) => {
    const { gasto } = await objetivos(request)
    test.skip(!gasto, '[141] no hay gastos del mes en curso en el tenant de prueba')
    const contador = ROLES.find((x) => x.rol === 'CONTADOR')
    test.skip(!contador?.email, '[141] faltan credenciales de CONTADOR')
    const token = await tokenRol(request, contador!)
    expect(
      await rlsDejaEscribir(request, token, `gastos?id=eq.${gasto.id}`, { descripcion: gasto.descripcion }),
      '[141] el CONTADOR edita campos fiscales de gastos ya creados — no debe bloquearse',
    ).toBe(true)
  })
})

/**
 * F2 — matriz de LECTURA. La otra mitad de la Tanda F: no alcanza con qué puede ESCRIBIR cada rol,
 * también importa qué puede LEER. Acá aparecieron los hallazgos más serios de toda la tanda.
 */
test.describe('F2 — qué puede LEER cada rol', () => {
  const SECRETOS: Array<[string, string]> = [
    ['mercadopago_credentials', 'access_token'],
    ['mercadopago_credentials', 'refresh_token'],
    ['tiendanube_credentials', 'access_token'],
    ['whatsapp_credentials', 'access_token'],
    // mig 403 — los tres que la 400 dejó afuera. Mercado Libre es el que más dolía: con ese token
    // se opera la cuenta de ML del comercio (publicaciones, preguntas, órdenes) desde afuera.
    ['meli_credentials', 'access_token'],
    ['meli_credentials', 'refresh_token'],
    ['modo_credentials', 'api_key'],
    ['courier_credenciales', 'credenciales'],
  ]

  // 🔴 Hallazgo (mig 400): CUALQUIER rol del tenant podía leer el access_token de Mercado Pago y
  // Tienda Nube en claro. Con ese token se opera la cuenta de MP del comercio desde afuera de
  // Genesis360. El comentario del código decía "nunca expuesto al frontend" — y era cierto en la
  // interfaz TypeScript, que no es un control de acceso.
  test('ningún rol puede leer los access_token de las integraciones (migs 400 y 403)', async ({ request }) => {
    const owner = await tokenOwner(request)
    for (const [tabla, col] of SECRETOS) {
      for (const r of [...rolesConCredenciales(), { rol: 'DUEÑO', email: undefined, password: undefined }]) {
        const token = r.rol === 'DUEÑO' ? owner : await tokenRol(request, r)
        const res = await request.get(`${SUPABASE_URL}/rest/v1/${tabla}?select=id,${col}&limit=1`, { headers: restHeaders(token) })
        expect(res.status(), `[141/F2] ${r.rol} NO debe poder leer ${tabla}.${col}`).toBe(403)
      }
    }
  })

  test('tampoco con select=* (PostgREST lo expande a todas las columnas)', async ({ request }) => {
    const token = await tokenRol(request, ROLES[0])
    const res = await request.get(`${SUPABASE_URL}/rest/v1/mercadopago_credentials?select=*&limit=1`, { headers: restHeaders(token) })
    expect(res.status(), '[141/F2] select=* sobre una tabla de credenciales debe dar 403').toBe(403)
  })

  // 🔑 POSITIVO: el guard de columna no puede romper la pantalla de Configuración. Estas son las
  // consultas EXACTAS que hace `ConfigPage.tsx` (listas explícitas, sin el token).
  test('🔑 las consultas reales de ConfigPage siguen funcionando', async ({ request }) => {
    const consultas: Array<[string, string]> = [
      ['tiendanube_credentials', 'id,sucursal_id,store_id,store_name,store_url,conectado,conectado_at'],
      ['mercadopago_credentials', 'id,sucursal_id,seller_id,seller_email,expires_at,conectado,conectado_at'],
      ['whatsapp_credentials', 'id,numero_whatsapp,conectado,conectado_at'],
    ]
    const owner = await tokenOwner(request)
    for (const [tabla, select] of consultas) {
      const res = await request.get(`${SUPABASE_URL}/rest/v1/${tabla}?select=${select}&limit=3`, { headers: restHeaders(owner) })
      expect(res.status(), `[141/F2] la consulta real de ConfigPage sobre ${tabla} debe seguir andando: ${await res.text()}`).toBe(200)
    }
  })

  // ✅ CERRADO por la mig 402 (era F2-h1). El token de AfipSDK pasó a ser un secreto de
  // SOLO ESCRITURA: no lo lee NADIE desde el browser, ni siquiera el DUEÑO. Lo usa `emitir-factura`
  // con service_role. Para saber si hay uno cargado está la columna generada `afipsdk_token_configurado`.
  test('el afipsdk_token no lo lee ningún rol, tampoco el DUEÑO (mig 402)', async ({ request }) => {
    const owner = await tokenOwner(request)
    for (const r of [...rolesConCredenciales(), { rol: 'DUEÑO' } as RolProbado]) {
      const token = r.rol === 'DUEÑO' ? owner : await tokenRol(request, r)
      for (const select of ['id,afipsdk_token', '*']) {
        const res = await request.get(
          `${SUPABASE_URL}/rest/v1/emisores_fiscales?select=${encodeURIComponent(select)}&limit=1`,
          { headers: restHeaders(token) },
        )
        expect(res.status(), `[141/F2] ${r.rol} NO debe poder leer el afipsdk_token (select=${select})`).toBe(403)
      }
    }
  })

  test('🔑 la consulta real del panel de Emisores (columnas explícitas) sigue andando', async ({ request }) => {
    const cols = 'id,nombre,cuit,razon_social_fiscal,condicion_iva_emisor,domicilio_fiscal,' +
      'ingresos_brutos,inicio_actividades,umbral_factura_b,afip_produccion,afip_provider,' +
      'afipsdk_token_configurado,banco,cbu,alias_cbu,leyenda_comprobante,es_default,activo,csr_key_path'
    const owner = await tokenOwner(request)
    const res = await request.get(`${SUPABASE_URL}/rest/v1/emisores_fiscales?select=${cols}`, { headers: restHeaders(owner) })
    expect(res.status(), `[141/F2] la consulta real de EmisoresFiscalesPanel debe seguir andando: ${await res.text()}`).toBe(200)
    const filas = (await res.json()) as Record<string, unknown>[]
    expect(filas.length, '[141/F2] fixture vacío: el tenant de prueba debería tener al menos un emisor').toBeGreaterThan(0)
    expect(Object.keys(filas[0]), '[141/F2] el booleano reemplaza al token').toContain('afipsdk_token_configurado')
  })

  // La copia legacy del mismo secreto. `tenants` se lee con select('*') desde todo el frontend, así
  // que no se puede cerrar por columna: se vació y un trigger la fuerza a NULL (mig 402).
  test('la copia legacy tenants.afipsdk_token quedó vacía (mig 402)', async ({ request }) => {
    const token = await tokenRol(request, rolesConCredenciales()[0])
    const res = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id,afipsdk_token`, { headers: restHeaders(token) })
    expect(res.ok(), await res.text()).toBeTruthy()
    const filas = (await res.json()) as { afipsdk_token: string | null }[]
    expect(filas.length, '[141/F2] fixture vacío: el rol debería ver al menos su tenant').toBeGreaterThan(0)
    for (const f of filas) expect(f.afipsdk_token, '[141/F2] tenants.afipsdk_token debe estar siempre en NULL').toBeNull()
  })

  /**
   * Visibilidad de RRHH — regla aprobada por GO (mig 401):
   *   DUEÑO/ADMIN/SUPER_USUARIO/RRHH ven todo · SUPERVISOR su equipo · cada empleado lo suyo ·
   *   las pantallas de costos leen AGREGADOS.
   * Antes de la 401, un CAJERO leía el sueldo, el CBU y el DNI de todos los empleados.
   */
  test('sueldos, CBU y DNI: los roles operativos no los ven (mig 401)', async ({ request }) => {
    // RRHH queda afuera A PROPÓSITO: administra el módulo, así que DEBE ver todo (regla de GO).
    // Se verifica en el test de abajo, no acá.
    for (const r of rolesConCredenciales().filter((x) => x.rol !== 'RRHH')) {
      const token = await tokenRol(request, r)
      // `rrhh_salario_items` y `rrhh_anticipos` los cerró la mig 403: con la cabecera cerrada y el
      // detalle abierto, el sueldo se reconstruía sumando los conceptos.
      for (const q of ['empleados?select=id,salario_bruto,cbu,dni_rut&limit=5', 'rrhh_salarios?select=id,neto&limit=5',
                       'rrhh_salario_items?select=id,monto&limit=5', 'rrhh_anticipos?select=id,monto&limit=5']) {
        const res = await request.get(`${SUPABASE_URL}/rest/v1/${q}`, { headers: restHeaders(token) })
        expect(res.ok(), await res.text()).toBeTruthy()
        expect((await res.json()) as unknown[], `[141/F2] ${r.rol} NO debería ver ${q.split('?')[0]}`).toHaveLength(0)
      }
    }
  })

  test('🔑 quienes SÍ administran RRHH (DUEÑO y RRHH) siguen viendo todo', async ({ request }) => {
    const rrhh = ROLES.find((x) => x.rol === 'RRHH')
    const quienes: Array<[string, string]> = [['DUEÑO', await tokenOwner(request)]]
    if (rrhh?.email) quienes.push(['RRHH', await tokenRol(request, rrhh)])

    for (const [rol, token] of quienes) {
      for (const q of ['empleados?select=id,salario_bruto&limit=3', 'rrhh_salarios?select=id,neto&limit=3',
                       'rrhh_salario_items?select=id,monto&limit=3']) {
        const res = await request.get(`${SUPABASE_URL}/rest/v1/${q}`, { headers: restHeaders(token) })
        expect((await res.json()) as unknown[], `[141/F2] ${rol} DEBE seguir viendo ${q.split('?')[0]}`).not.toHaveLength(0)
      }
    }
  })

  test('🔑 las pantallas que se migraron a RPC siguen andando y no filtran datos sensibles', async ({ request }) => {
    // `fn_empleados_basico` — repartidores y recordatorios de cumpleaños. Todos los roles pueden,
    // porque no expone nada sensible; eso último es lo que se afirma acá.
    for (const r of rolesConCredenciales()) {
      const token = await tokenRol(request, r)
      const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_empleados_basico`, { headers: restHeaders(token), data: {} })
      expect(res.ok(), `[141/F2] ${r.rol} debería poder listar empleados básicos: ${await res.text()}`).toBeTruthy()
      const filas = (await res.json()) as Record<string, unknown>[]
      if (filas.length) {
        const cols = Object.keys(filas[0])
        for (const prohibida of ['salario_bruto', 'cbu', 'dni_rut', 'email_personal', 'direccion']) {
          expect(cols, `[141/F2] fn_empleados_basico NO debe exponer ${prohibida}`).not.toContain(prohibida)
        }
      }
    }
  })

  test('🔑 el costo laboral agregado: lo ven los roles de reportes, no los operativos', async ({ request }) => {
    const rango = { p_desde: '2026-01-01', p_hasta: '2026-12-31' }
    const owner = await tokenOwner(request)
    const okOwner = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_sueldos_agregado`, { headers: restHeaders(owner), data: rango })
    expect(okOwner.ok(), `[141/F2] el DUEÑO debe poder leer el costo laboral agregado: ${await okOwner.text()}`).toBeTruthy()

    for (const r of rolesConCredenciales()) {
      const token = await tokenRol(request, r)
      const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_sueldos_agregado`, { headers: restHeaders(token), data: rango })
      // CONTADOR y RRHH ven reportes de plata; CAJERO y DEPÓSITO no. (SUPERVISOR también puede,
      // pero no está en ROLES porque su usuario se usa como control positivo en otros tests.)
      const permitido = ['CONTADOR', 'RRHH'].includes(r.rol)
      expect(res.ok(), `[141/F2] ${r.rol} ${permitido ? 'DEBERÍA' : 'NO debería'} poder ver el costo laboral`).toBe(permitido)
    }
  })
})

/**
 * F1 (cierre) — el NÚCLEO FISCAL, que es lo que la REGLA #0 pone primero.
 *
 * 🔴 Hallazgo que abrió la mig 402: `emisores_fiscales`, `tenant_certificates` y `puntos_venta_afip`
 * tenían UNA policy `FOR ALL` que solo miraba el tenant. Con el token de cualquier rol se podía
 * cambiar el CUIT o la condición de IVA del emisor, prender `afip_produccion` (CAE fiscal REAL) o
 * borrar el certificado AFIP. Y del bucket `certificados-afip` se bajaba la CLAVE PRIVADA.
 *
 * 🔒 Sondas NO MUTANTES, igual que el resto de la spec: PATCH con el MISMO valor que ya tiene la
 * fila, y `?select=id` para que la representación no expanda a `*` (el token no tiene SELECT).
 */
test.describe('F1 — el núcleo fiscal no lo escribe cualquier rol (mig 402)', () => {
  /** Fila objetivo + el PATCH que no cambia nada, buscados con el token del DUEÑO. */
  async function objetivosFiscales(request: APIRequestContext) {
    const h = restHeaders(await tokenOwner(request))
    const uno = async (path: string) =>
      ((await (await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: h })).json()) as Record<string, unknown>[])[0]

    const emisor = await uno(`emisores_fiscales?tenant_id=eq.${TENANT}&select=id,afip_produccion&limit=1`)
    const cert = await uno(`tenant_certificates?tenant_id=eq.${TENANT}&select=id,activo&limit=1`)
    const pv = await uno(`puntos_venta_afip?tenant_id=eq.${TENANT}&select=id,numero&limit=1`)
    const objetivos: Array<[string, string, object]> = []
    if (emisor) objetivos.push(['emisores_fiscales', emisor.id as string, { afip_produccion: emisor.afip_produccion }])
    if (cert) objetivos.push(['tenant_certificates', cert.id as string, { activo: cert.activo }])
    if (pv) objetivos.push(['puntos_venta_afip', pv.id as string, { numero: pv.numero }])
    expect(objetivos.length, '[141/F1] fixture vacío: el tenant de prueba no tiene emisor/cert/PV que sondear').toBe(3)
    return objetivos
  }

  test('ningún rol operativo escribe la identidad fiscal, el certificado ni los puntos de venta', async ({ request }) => {
    const objetivos = await objetivosFiscales(request)
    for (const r of rolesConCredenciales()) {
      const token = await tokenRol(request, r)
      for (const [tabla, id, body] of objetivos) {
        const escribio = await rlsDejaEscribir(request, token, `${tabla}?id=eq.${id}&select=id`, body)
        expect(escribio, `[141/F1] ${r.rol} NO debe poder escribir ${tabla}`).toBe(false)
      }
    }
  })

  test('🔑 el DUEÑO sí — la pantalla de Configuración tiene que seguir funcionando', async ({ request }) => {
    const objetivos = await objetivosFiscales(request)
    const owner = await tokenOwner(request)
    for (const [tabla, id, body] of objetivos) {
      const escribio = await rlsDejaEscribir(request, owner, `${tabla}?id=eq.${id}&select=id`, body)
      expect(escribio, `[141/F1] el DUEÑO DEBE poder escribir ${tabla}`).toBe(true)
    }
  })

  // La clave privada AFIP: con cert + key se firma el WSAA y se factura como ese CUIT desde afuera
  // de Genesis360. Se lista el bucket en vez de descargar, para no traer material de clave al test.
  test('el bucket de certificados AFIP no lo lee ningún rol operativo', async ({ request }) => {
    const listar = async (token: string) => {
      const res = await request.post(`${SUPABASE_URL}/storage/v1/object/list/certificados-afip`, {
        headers: restHeaders(token),
        data: { prefix: `${TENANT}/`, limit: 100 },
      })
      return res.ok() ? ((await res.json()) as unknown[]) : []
    }

    const delDueno = await listar(await tokenOwner(request))
    expect(delDueno.length, '[141/F1] fixture vacío: el tenant de prueba no tiene certificado subido').toBeGreaterThan(0)

    for (const r of rolesConCredenciales()) {
      const token = await tokenRol(request, r)
      expect(await listar(token), `[141/F1] ${r.rol} NO debe ver los archivos del certificado AFIP`).toHaveLength(0)
    }
  })
})

/**
 * F2 (cierre) — las credenciales de integración tampoco las ESCRIBE cualquiera (mig 403).
 *
 * La mig 400 cerró la LECTURA de los tokens y dejó la escritura abierta: con la policy por tenant a
 * secas, un CAJERO podía **desconectar las integraciones del comercio** o pisar un token por REST
 * directo. `/configuracion` es `ownerOnly` en el frontend; ahora la base sostiene lo mismo.
 */
test.describe('F2 — las credenciales de integración solo las escribe gestión (mig 403)', () => {
  /** Tablas de credenciales que TIENEN fila en el tenant de prueba, con un PATCH que no cambia nada. */
  async function objetivosCredenciales(request: APIRequestContext) {
    const h = restHeaders(await tokenOwner(request))
    const candidatas: Array<[string, string, object]> = [
      ['mercadopago_credentials', 'id,conectado', { conectado: null }],
      ['tiendanube_credentials', 'id,conectado', { conectado: null }],
      ['whatsapp_credentials', 'id,conectado', { conectado: null }],
      ['meli_credentials', 'id,conectado', { conectado: null }],
    ]
    const objetivos: Array<[string, string, object]> = []
    for (const [tabla, select] of candidatas) {
      const res = await request.get(`${SUPABASE_URL}/rest/v1/${tabla}?select=${select}&limit=1`, { headers: h })
      if (!res.ok()) continue
      const [fila] = (await res.json()) as Array<{ id: string; conectado: boolean | null }>
      if (fila) objetivos.push([tabla, fila.id, { conectado: fila.conectado }])
    }
    expect(objetivos.length, '[141/F2] fixture vacío: el tenant de prueba no tiene ninguna integración conectada').toBeGreaterThan(0)
    return objetivos
  }

  test('ningún rol operativo puede desconectar ni pisar una integración', async ({ request }) => {
    const objetivos = await objetivosCredenciales(request)
    for (const r of rolesConCredenciales()) {
      const token = await tokenRol(request, r)
      for (const [tabla, id, body] of objetivos) {
        const escribio = await rlsDejaEscribir(request, token, `${tabla}?id=eq.${id}&select=id`, body)
        expect(escribio, `[141/F2] ${r.rol} NO debe poder escribir ${tabla}`).toBe(false)
      }
    }
  })

  test('🔑 el DUEÑO sí — el tab Conectividad tiene que seguir funcionando', async ({ request }) => {
    const objetivos = await objetivosCredenciales(request)
    const owner = await tokenOwner(request)
    for (const [tabla, id, body] of objetivos) {
      const escribio = await rlsDejaEscribir(request, owner, `${tabla}?id=eq.${id}&select=id`, body)
      expect(escribio, `[141/F2] el DUEÑO DEBE poder escribir ${tabla}`).toBe(true)
    }
  })

  // Las consultas EXACTAS que quedaron en el frontend después de sacarles los secretos.
  test('🔑 las consultas reales de las pantallas de integración siguen andando', async ({ request }) => {
    const consultas: Array<[string, string]> = [
      ['meli_credentials', 'id,sucursal_id,seller_id,seller_nickname,seller_email,expires_at,conectado'],
      ['modo_credentials', 'id,merchant_id,ambiente,conectado,conectado_at'],
      ['courier_credenciales', 'id,courier,activo,credenciales_configuradas'],
    ]
    const owner = await tokenOwner(request)
    for (const [tabla, select] of consultas) {
      const res = await request.get(`${SUPABASE_URL}/rest/v1/${tabla}?select=${select}&limit=3`, { headers: restHeaders(owner) })
      expect(res.status(), `[141/F2] la consulta real sobre ${tabla} debe seguir andando: ${await res.text()}`).toBe(200)
    }
  })
})
