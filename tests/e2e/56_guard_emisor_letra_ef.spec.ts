/**
 * 56_guard_emisor_letra_ef.spec.ts
 * E2E (API) — Guard fiscal server-side emisor↔letra de la EF `emitir-factura` (REGLA #0, fiscal).
 *
 * Lógica L3 (`emitir-factura/index.ts:80-91`): última línea de defensa (la restricción del selector
 * del front es solo UI y puede estar cacheada/bypasseada). Monotributista/Exento → SOLO C; cualquier
 * otra condición (RI) → A o B, nunca C. Si la combinación es inválida, la EF responde 400 ANTES de
 * tocar AFIP. Se prueba con un POST directo a la EF (no por UI).
 *
 * Cubre la rama "emisorSoloC rechaza no-C" contra el tenant DEV Almacén Jorgito (Monotributista):
 * pedir A o B → 400. La rama "RI rechaza C" se validó aparte por flip reversible de
 * `condicion_iva_emisor` (RI + C → 400, restaurado a Monotributista) — no va en el spec porque exige
 * mutar la condición fiscal del tenant (ver log/cobertura). El `venta_id` es dummy: el guard corre
 * ANTES de buscar la venta (la EF solo valida que esté presente).
 *
 * Requiere VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY en el entorno (anon key = pública). Correr con
 * ambos env: `npx dotenv -e .env.local -e tests/e2e/.env.test.local -- playwright test 56_guard ...`.
 * Skip-guard si faltan. No muta nada (siempre 400).
 */
import { test, expect } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const TENANT_JORGITO = '3769b1db-10f4-46a6-bc7f-eb669307730d'  // Monotributista (DEV)
const DUMMY_VENTA = '00000000-0000-0000-0000-000000000001'      // el guard corre antes de buscar la venta

test.describe('Guard fiscal emisor↔letra (EF emitir-factura)', () => {
  test.skip(!SUPABASE_URL || !ANON, 'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el entorno (anon pública).')

  for (const tipo of ['A', 'B'] as const) {
    test(`Monotributista no puede emitir ${tipo} → 400`, async ({ request }) => {
      const res = await request.post(`${SUPABASE_URL}/functions/v1/emitir-factura`, {
        headers: { Authorization: `Bearer ${ANON}`, apikey: ANON!, 'Content-Type': 'application/json' },
        data: { venta_id: DUMMY_VENTA, tenant_id: TENANT_JORGITO, tipo_comprobante: tipo },
      })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/solo puede emitir comprobantes tipo C/i)
      expect(body.error).toContain(tipo)
    })
  }
})
