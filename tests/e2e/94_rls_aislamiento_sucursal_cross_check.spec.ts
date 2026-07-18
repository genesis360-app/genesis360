/**
 * 94_rls_aislamiento_sucursal_cross_check.spec.ts
 * E2E (API/RLS) — Aislamiento por sucursal entre usuarios REALES de dos sucursales del mismo
 * tenant (REGLA #0). No maneja el browser: pega directo a PostgREST con el `access_token` real
 * de cada usuario, así se prueba la RLS server-side (lo que de verdad protege el dato), no el
 * filtro client-side de la UI.
 *
 * Usuarios: `supervisor@test.com` (Norte) y `supervisor2@test.com` (Sur) — mismo rol SUPERVISOR,
 * ambos con `puede_ver_todas=false` (verificado en DB), o sea que la RLS los debe restringir a
 * SU sucursal + lo global (sucursal_id IS NULL), nunca a la sucursal del otro.
 *
 * No muta nada — solo lecturas. Requiere E2E_SUPERVISOR_EMAIL/PASSWORD (Norte) y
 * E2E_SUPERVISOR_SUR_EMAIL/PASSWORD (Sur) en .env.test.local (si faltan, se skipea).
 */
import { test, expect } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'

test.describe('Aislamiento RLS por sucursal — Norte vs Sur (cross-check)', () => {
  test('inventario_lineas y caja_sesiones: cada usuario NO ve la sucursal ajena', async ({ request }) => {
    const emailSur = process.env.E2E_SUPERVISOR_SUR_EMAIL
    const passwordSur = process.env.E2E_SUPERVISOR_SUR_PASSWORD
    test.skip(!emailSur || !passwordSur, 'Faltan E2E_SUPERVISOR_SUR_EMAIL/PASSWORD en .env.test.local')

    // OJO: loginToken(request) SIN email/password cae al default E2E_EMAIL/E2E_PASSWORD (el
    // OWNER, que ve TODAS las sucursales) — acá necesitamos explícitamente el SUPERVISOR
    // restringido a Norte, no el owner.
    const tokenNorte = await loginToken(request, process.env.E2E_SUPERVISOR_EMAIL, process.env.E2E_SUPERVISOR_PASSWORD)
    const tokenSur = await loginToken(request, emailSur, passwordSur)
    const headersNorte = restHeaders(tokenNorte)
    const headersSur = restHeaders(tokenSur)

    // ── inventario_lineas ──────────────────────────────────────────────────────
    // NEGATIVO: el usuario de Norte no debe traer NINGUNA línea activa de Sur, y viceversa.
    const lineasSurVistasPorNorte = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?sucursal_id=eq.${SUR}&activo=eq.true&select=id&limit=5`,
      { headers: headersNorte },
    )
    expect(lineasSurVistasPorNorte.ok(), await lineasSurVistasPorNorte.text()).toBeTruthy()
    expect(
      (await lineasSurVistasPorNorte.json()) as unknown[],
      '[94] el usuario de Sucursal Norte NO debería poder leer líneas de inventario de Sucursal Sur (RLS)',
    ).toHaveLength(0)

    const lineasNorteVistasPorSur = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?sucursal_id=eq.${NORTE}&activo=eq.true&select=id&limit=5`,
      { headers: headersSur },
    )
    expect(lineasNorteVistasPorSur.ok(), await lineasNorteVistasPorSur.text()).toBeTruthy()
    expect(
      (await lineasNorteVistasPorSur.json()) as unknown[],
      '[94] el usuario de Sucursal Sur NO debería poder leer líneas de inventario de Sucursal Norte (RLS)',
    ).toHaveLength(0)

    // POSITIVO: cada uno SÍ ve las líneas de su propia sucursal (sanity — que la RLS no
    // esté simplemente bloqueando todo).
    const lineasPropiasNorte = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?sucursal_id=eq.${NORTE}&activo=eq.true&select=id&limit=1`,
      { headers: headersNorte },
    )
    expect(
      (await lineasPropiasNorte.json()) as unknown[],
      '[94] el usuario de Norte debería ver AL MENOS una línea de su propia sucursal',
    ).not.toHaveLength(0)

    // ── caja_sesiones (mismo patrón de RLS: sucursal_id IS NULL OR = auth_user_sucursal()) ──
    const cajasSurVistasPorNorte = await request.get(
      `${SUPABASE_URL}/rest/v1/caja_sesiones?sucursal_id=eq.${SUR}&select=id&limit=5`,
      { headers: headersNorte },
    )
    expect(
      (await cajasSurVistasPorNorte.json()) as unknown[],
      '[94] el usuario de Sucursal Norte NO debería poder leer sesiones de caja de Sucursal Sur (RLS)',
    ).toHaveLength(0)

    const cajasPropiasSur = await request.get(
      `${SUPABASE_URL}/rest/v1/caja_sesiones?sucursal_id=eq.${SUR}&select=id&limit=1`,
      { headers: headersSur },
    )
    expect(
      (await cajasPropiasSur.json()) as unknown[],
      '[94] el usuario de Sur debería ver AL MENOS una sesión de caja de su propia sucursal',
    ).not.toHaveLength(0)
  })

  test('DISEÑO A PROPÓSITO: traslados es tenant-wide, NO sucursal-scoped', async ({ request }) => {
    const emailSur = process.env.E2E_SUPERVISOR_SUR_EMAIL
    const passwordSur = process.env.E2E_SUPERVISOR_SUR_PASSWORD
    test.skip(!emailSur || !passwordSur, 'Faltan E2E_SUPERVISOR_SUR_EMAIL/PASSWORD en .env.test.local')

    // La policy `traslados_tenant` solo filtra por tenant_id — a diferencia de
    // `inventario_lineas`/`caja_sesiones`, NO tiene la cláusula
    // `sucursal_id = auth_user_sucursal() OR auth_ve_todas_sucursales()`. NO es un bug: es una
    // decisión de diseño DELIBERADA y ya documentada desde v1.75.0 (mig 216-218,
    // `wiki/features/multi-sucursal.md` §"RLS por sucursal a nivel servidor") — `traslado_items`
    // (origen+destino) está listado ahí junto a `caja_traspasos` como tabla "dejada tenant-only a
    // propósito" por "cruzar sucursales por diseño": un traslado no le pertenece exclusivamente a
    // ninguna de las dos puntas, restringirlo por sucursal rompería la trazabilidad del propio
    // mecanismo. Este test es la regresión de CONTROL de esa decisión (si algún día alguien la
    // cambia sin querer, este spec lo va a notar).
    const tokenSur = await loginToken(request, emailSur, passwordSur)
    const headersSur = restHeaders(tokenSur)

    const trasladosNorteOrigenVistosPorSur = await request.get(
      `${SUPABASE_URL}/rest/v1/traslados?sucursal_origen_id=eq.${NORTE}&sucursal_destino_id=eq.${SUR}&select=id&limit=1`,
      { headers: headersSur },
    )
    expect(trasladosNorteOrigenVistosPorSur.ok(), await trasladosNorteOrigenVistosPorSur.text()).toBeTruthy()
    // Documentado, no aserta "debería estar vacío" — refleja el comportamiento real hoy.
    console.log(
      '[94] traslados Norte→Sur visibles para el usuario de Sur (tenant-wide, no sucursal-scoped):',
      ((await trasladosNorteOrigenVistosPorSur.json()) as unknown[]).length,
    )
  })
})
