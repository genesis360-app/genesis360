/**
 * 63_multicuit_emisor_guards.spec.ts
 * E2E (API) — MULTI-CUIT: el EMISOR (no el tenant) gobierna la identidad fiscal. REGLA #0.
 *
 * Corre contra el ÚNICO tenant con dos identidades fiscales reales conviviendo
 * ("Kiosco Buildi" DEV, ambas con certificado propio):
 *   • emisor DEFAULT     → RI            (CUIT 23-32031506-9)
 *   • emisor ADICIONAL   → Monotributista (CUIT 20422374168)
 *
 * Eso permite probar, en un mismo tenant y sin mutar nada, que el guard de letra usa la
 * condición del EMISOR RESUELTO y no la del tenant:
 *   - RI + C            → 400  ← rama que el spec 56 NO podía cubrir (exigía flipear la
 *                                condición fiscal del tenant; acá conviven las dos).
 *   - Monotributista + A/B → 400
 *   - las combinaciones VÁLIDAS (RI+B, Mono+C) pasan el guard de letra (fallan después por
 *     la venta dummy) → aserción positiva: el guard no rechaza lo que corresponde.
 *   - emisor de OTRO tenant → 403 (aislamiento).
 *
 * El `venta_id` es dummy a propósito: estos guards corren ANTES de buscar la venta, así que
 * el spec NO emite ningún comprobante (siempre 4xx) y es repetible sin consumir fixtures.
 *
 * La emisión real con los 2 CUITs está validada con datos reales (Factura B del RI nº3-30 y
 * Factura C del Monotributo nº1, secuencias independientes) — ver log 2026-07-15.
 *
 * Requiere VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + E2E_MULTICUIT_* . Skip-guard si faltan.
 * `npx dotenv -e .env.local -e tests/e2e/.env.test.local -- playwright test 63 --project=chromium`
 */
import { test, expect } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const EMAIL = process.env.E2E_MULTICUIT_EMAIL
const PASSWORD = process.env.E2E_MULTICUIT_PASSWORD
const TENANT = process.env.E2E_MULTICUIT_TENANT
const EMISOR_RI = process.env.E2E_MULTICUIT_EMISOR_RI
const EMISOR_MONO = process.env.E2E_MULTICUIT_EMISOR_MONO

// Emisor default de "Almacén Jorgito" (DEV) — otro tenant: debe dar 403.
const EMISOR_AJENO = 'bf86dcf3-c2a4-4dd7-bd20-8eadc3bda68c'
const DUMMY_VENTA = '00000000-0000-0000-0000-000000000001'

async function loginToken(request: any): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    data: { email: EMAIL, password: PASSWORD },
  })
  expect(res.ok(), 'login del usuario multi-CUIT falló (revisar E2E_MULTICUIT_EMAIL/PASSWORD)').toBeTruthy()
  return (await res.json()).access_token as string
}

function emitir(request: any, token: string, data: Record<string, unknown>) {
  return request.post(`${SUPABASE_URL}/functions/v1/emitir-factura`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON!, 'Content-Type': 'application/json' },
    data,
  })
}

test.describe('Multi-CUIT — el emisor gobierna la letra (mismo tenant, 2 identidades fiscales)', () => {
  test.skip(!SUPABASE_URL || !ANON || !EMAIL || !PASSWORD || !TENANT || !EMISOR_RI || !EMISOR_MONO,
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / E2E_MULTICUIT_* en el entorno.')

  test('🛑 emisor RI del tenant NO puede emitir C (aunque el tenant tenga un emisor Monotributista)', async ({ request }) => {
    const token = await loginToken(request)
    const res = await emitir(request, token, {
      venta_id: DUMMY_VENTA, tenant_id: TENANT, emisor_id: EMISOR_RI, tipo_comprobante: 'C',
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toMatch(/Responsable Inscripto no puede emitir comprobantes tipo C/i)
  })

  for (const tipo of ['A', 'B'] as const) {
    test(`🛑 emisor Monotributista del tenant NO puede emitir ${tipo} (aunque el default sea RI)`, async ({ request }) => {
      const token = await loginToken(request)
      const res = await emitir(request, token, {
        venta_id: DUMMY_VENTA, tenant_id: TENANT, emisor_id: EMISOR_MONO, tipo_comprobante: tipo,
      })
      expect(res.status()).toBe(400)
      const err = (await res.json()).error as string
      expect(err).toMatch(/solo puede emitir comprobantes tipo C/i)
      expect(err).toContain(tipo)
    })
  }

  // Aserción POSITIVA: las combinaciones válidas PASAN el guard de letra. Como la venta es
  // dummy, la EF falla después (al buscarla) — lo que importa es que el error ya NO sea el
  // de letra, o sea: el guard aceptó la combinación emisor↔letra correcta.
  for (const [nombre, emisor, tipo] of [
    ['RI → B', EMISOR_RI, 'B'],
    ['Monotributista → C', EMISOR_MONO, 'C'],
  ] as const) {
    test(`✅ ${nombre} pasa el guard de letra (falla después por la venta dummy)`, async ({ request }) => {
      const token = await loginToken(request)
      const res = await emitir(request, token, {
        venta_id: DUMMY_VENTA, tenant_id: TENANT, emisor_id: emisor, tipo_comprobante: tipo,
      })
      const err = ((await res.json()).error ?? '') as string
      expect(err, `el guard de letra rechazó una combinación VÁLIDA (${nombre})`)
        .not.toMatch(/comprobantes tipo C/i)
    })
  }

  test('🛑 emisor de OTRO tenant → 403 (aislamiento entre tenants)', async ({ request }) => {
    const token = await loginToken(request)
    const res = await emitir(request, token, {
      venta_id: DUMMY_VENTA, tenant_id: TENANT, emisor_id: EMISOR_AJENO, tipo_comprobante: 'C',
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toMatch(/no pertenece al tenant/i)
  })
})
