/**
 * 56_guard_emisor_letra_ef.spec.ts
 * E2E (API) — Guards server-side de la EF `emitir-factura` (REGLA #0, fiscal).
 *
 * 1) Guard de IDENTIDAD (v1.125.0): emitir un comprobante fiscal ya NO puede hacerse con el
 *    anon key solo (es público, viaja en el frontend). La EF exige un usuario autenticado
 *    que PERTENEZCA al tenant del body (o service_role para flujos internos):
 *      - anon key pelado → 401.
 *      - usuario válido de OTRO tenant → 403.
 * 2) Guard fiscal emisor↔letra (`emitir-factura/index.ts`): Monotributista/Exento → SOLO C;
 *    RI → nunca C. Con usuario válido del tenant, pedir A o B siendo Monotributista → 400
 *    ANTES de tocar AFIP. (La rama "RI rechaza C" se validó por flip reversible de
 *    `condicion_iva_emisor` — exige mutar la condición fiscal del tenant, no va en spec.)
 *
 * El `venta_id` es dummy: los guards corren ANTES de buscar la venta.
 *
 * Requiere VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + E2E_EMAIL/E2E_PASSWORD (owner del
 * tenant Jorgito). Correr con ambos env:
 * `npx dotenv -e .env.local -e tests/e2e/.env.test.local -- playwright test 56_guard ...`.
 * Skip-guard si faltan. No muta nada (siempre 4xx).
 */
import { test, expect } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const TENANT_JORGITO = '3769b1db-10f4-46a6-bc7f-eb669307730d'   // Monotributista (DEV) — tenant del owner e2e
const TENANT_AJENO = '4cf85bbb-22b3-4760-91ee-15a24d9e4713'     // Familia Otranto DEV — el owner e2e NO pertenece
const DUMMY_VENTA = '00000000-0000-0000-0000-000000000001'      // los guards corren antes de buscar la venta

// Token de usuario real vía password grant (no debilita nada: son las credenciales e2e de siempre).
async function loginToken(request: any): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  })
  expect(res.ok(), 'login e2e falló (revisar E2E_EMAIL/E2E_PASSWORD)').toBeTruthy()
  const body = await res.json()
  return body.access_token as string
}

function post(request: any, token: string, data: Record<string, unknown>) {
  return request.post(`${SUPABASE_URL}/functions/v1/emitir-factura`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON!, 'Content-Type': 'application/json' },
    data,
  })
}

test.describe('Guards server-side de emitir-factura (identidad + emisor↔letra)', () => {
  test.skip(!SUPABASE_URL || !ANON || !E2E_EMAIL || !E2E_PASSWORD,
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / E2E_EMAIL / E2E_PASSWORD en el entorno.')

  test('anon key pelado (sin usuario) → 401', async ({ request }) => {
    const res = await post(request, ANON!, { venta_id: DUMMY_VENTA, tenant_id: TENANT_JORGITO, tipo_comprobante: 'C' })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/usuario autenticado/i)
  })

  test('usuario válido pero de OTRO tenant → 403', async ({ request }) => {
    const token = await loginToken(request)
    const res = await post(request, token, { venta_id: DUMMY_VENTA, tenant_id: TENANT_AJENO, tipo_comprobante: 'C' })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/no pertenece al tenant/i)
  })

  for (const tipo of ['A', 'B'] as const) {
    test(`Monotributista no puede emitir ${tipo} → 400 (con usuario del tenant)`, async ({ request }) => {
      const token = await loginToken(request)
      const res = await post(request, token, { venta_id: DUMMY_VENTA, tenant_id: TENANT_JORGITO, tipo_comprobante: tipo })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/solo puede emitir comprobantes tipo C/i)
      expect(body.error).toContain(tipo)
    })
  }
})
