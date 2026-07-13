/**
 * 61_generar_csr_ef.spec.ts
 * E2E (API) — Wizard de certificado AFIP self-service: EF `generar-csr` (REGLA #0, fiscal).
 *
 * Es "como lo haría una persona que recién arranca y va a cargar su primer certificado":
 * el asistente genera server-side la clave privada (.key) + el CSR (PKCS#10) que el usuario
 * pega en ARCA. Acá se valida el CONTRATO de esa EF:
 *
 *  1) Guard de IDENTIDAD (REGLA #0): la EF genera y guarda material criptográfico en el bucket
 *     del tenant → NO puede llamarse con el anon key pelado (es público).
 *       - anon key sin usuario → 401.
 *       - usuario válido pero de OTRO tenant → 403.
 *  2) Guard de datos: CUIT que no tenga 11 dígitos → 400 (un subject mal armado = ARCA rechaza
 *     el cert / cert que no corresponde).
 *  3) Happy path: usuario dueño del tenant + su emisor principal → CSR PKCS#10 válido
 *     (-----BEGIN CERTIFICATE REQUEST-----). La .key queda server-side (nunca vuelve al cliente).
 *     Efecto en DB: setea emisores_fiscales.csr_key_path (se limpia en el afterAll — es un puntero
 *     transitorio, NO toca el certificado activo ni nada fiscal).
 *
 * Requiere VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + E2E_EMAIL/E2E_PASSWORD (owner del
 * tenant Jorgito, DEV). Correr con ambos env:
 * `npx dotenv -e .env.local -e tests/e2e/.env.test.local -- playwright test 61_generar_csr ...`.
 * Skip-guard si faltan.
 */
import { test, expect } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const TENANT_JORGITO = '3769b1db-10f4-46a6-bc7f-eb669307730d'   // tenant del owner e2e (DEV)
const TENANT_AJENO = '4cf85bbb-22b3-4760-91ee-15a24d9e4713'     // Familia Otranto DEV — el owner e2e NO pertenece
const DUMMY_EMISOR = '00000000-0000-0000-0000-000000000009'    // los guards de identidad corren antes de buscar el emisor
const CUIT_VALIDO = '30712345678'                               // 11 dígitos (subject bien armado)

async function loginToken(request: any): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  })
  expect(res.ok(), 'login e2e falló (revisar E2E_EMAIL/E2E_PASSWORD)').toBeTruthy()
  return (await res.json()).access_token as string
}

function generarCsr(request: any, token: string, data: Record<string, unknown>) {
  return request.post(`${SUPABASE_URL}/functions/v1/generar-csr`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON!, 'Content-Type': 'application/json' },
    data,
  })
}

test.describe('EF generar-csr (wizard de certificado self-service)', () => {
  test.skip(!SUPABASE_URL || !ANON || !E2E_EMAIL || !E2E_PASSWORD,
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / E2E_EMAIL / E2E_PASSWORD en el entorno.')

  test('anon key pelado (sin usuario) → 401', async ({ request }) => {
    const res = await generarCsr(request, ANON!, {
      tenant_id: TENANT_JORGITO, emisor_id: DUMMY_EMISOR, cuit: CUIT_VALIDO, razon_social: 'X SA',
    })
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toMatch(/usuario autenticado/i)
  })

  test('usuario válido pero de OTRO tenant → 403', async ({ request }) => {
    const token = await loginToken(request)
    const res = await generarCsr(request, token, {
      tenant_id: TENANT_AJENO, emisor_id: DUMMY_EMISOR, cuit: CUIT_VALIDO, razon_social: 'X SA',
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toMatch(/no pertenece al tenant/i)
  })

  test('🛑 CUIT con menos de 11 dígitos → 400 (no genera un CSR con subject inválido)', async ({ request }) => {
    const token = await loginToken(request)
    const res = await generarCsr(request, token, {
      tenant_id: TENANT_JORGITO, emisor_id: DUMMY_EMISOR, cuit: '30-123', razon_social: 'X SA',
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toMatch(/11 d[ií]gitos/i)
  })

  test('happy path: dueño + su emisor principal → CSR PKCS#10 válido', async ({ request }) => {
    const token = await loginToken(request)

    // Emisor principal real del tenant (backfill mig 267). Si no existe, no hay nada que probar.
    const emRes = await request.get(
      `${SUPABASE_URL}/rest/v1/emisores_fiscales?tenant_id=eq.${TENANT_JORGITO}&es_default=is.true&select=id,cuit,razon_social_fiscal,nombre`,
      { headers: { Authorization: `Bearer ${token}`, apikey: ANON! } },
    )
    expect(emRes.ok(), 'no se pudo leer el emisor principal').toBeTruthy()
    const emisores = await emRes.json()
    test.skip(!Array.isArray(emisores) || emisores.length === 0,
      'El tenant de prueba no tiene emisor principal (sin datos fiscales) — nada que generar.')
    const emisor = emisores[0]

    const res = await generarCsr(request, token, {
      tenant_id: TENANT_JORGITO,
      emisor_id: emisor.id,
      cuit: emisor.cuit || CUIT_VALIDO,
      razon_social: emisor.razon_social_fiscal || emisor.nombre || 'Emisor',
    })
    expect(res.status(), await res.text()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // CSR válido: bloque PEM PKCS#10 completo. La .key NO viaja al cliente.
    expect(body.csr).toContain('-----BEGIN CERTIFICATE REQUEST-----')
    expect(body.csr).toContain('-----END CERTIFICATE REQUEST-----')
    expect(JSON.stringify(body)).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/)

    // Cleanup: el puntero csr_key_path es un artefacto transitorio del test (no toca el cert
    // activo ni datos fiscales). Lo limpiamos best-effort para no dejar una key pendiente falsa.
    await request.patch(
      `${SUPABASE_URL}/rest/v1/emisores_fiscales?id=eq.${emisor.id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`, apikey: ANON!,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        data: { csr_key_path: null },
      },
    )
  })
})
