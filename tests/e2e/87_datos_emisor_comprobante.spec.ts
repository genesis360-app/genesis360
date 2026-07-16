/**
 * 87_datos_emisor_comprobante.spec.ts
 * E2E GUARD — Los comprobantes NO pueden salir con la identidad fiscal vacía (REGLA #0 fiscal).
 *
 * 🛑 REGRESIÓN REAL QUE ESTE SPEC HABRÍA CAZADO (estuvo EN PROD un mes, 2026-06-14 → 2026-07-16,
 * v1.62.0 commit `c35450e8`; lo encontró GO usando la app, no la suite):
 * la `.select()` de los datos del emisor pedía `telefono, email` — dos columnas que NO EXISTEN en
 * `tenants` → PostgREST devolvía **400** (`column tenants.telefono does not exist`) → el código
 * descartaba el `error` → `cfgTenant = null` → cada `?? ''` convertía el fallo en un dato fiscal
 * falso: **CUIT vacío**, razón social vacía y `condicion_iva_emisor ?? 'responsable_inscripto'`,
 * que hacía que el comprobante de un **Monotributista declarara ser Responsable Inscripto**.
 *
 * POR QUÉ NINGÚN TEST LO AGARRÓ (la lección, más importante que el spec):
 *  - La suite verificaba la **transacción** fiscal (que AFIP devolviera CAE) y paraba ahí. El CAE
 *    SIEMPRE estuvo bien —la EF resuelve el emisor server-side—; lo que estaba roto era el
 *    **documento**, que es lo único que ve el cliente. El spec 21 emite con CAE real y sólo
 *    assertea el toast "Factura C emitida — CAE:".
 *  - Los unit tests no podían: `facturasPDF.ts` **recibe** `emisor_cuit` por parámetro, así que un
 *    unit test le pasa un CUIT válido y pasa. El bug vivía en el LLAMADOR, en una query que sólo
 *    falla contra la DB real.
 *  → Moraleja: una `.select()` con una columna inexistente es un fallo de RUNTIME que ni TypeScript
 *    ni un unit test ven. Hay que ejecutarla contra la DB. Eso es lo que hace este spec.
 *
 * Qué valida: corre las selects REALES que usan los comprobantes y exige (a) que no fallen y
 * (b) que los campos fiscales vengan con contenido. Read-only: no muta nada, es repetible.
 */
import { test, expect } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL, ANON } from './helpers/fixtures'

// Las selects EXACTAS del código. Si alguien agrega una columna que no existe, esto se pone rojo
// en vez de dejar que la app emita un comprobante con el CUIT vacío.
const SELECT_VENTAS =
  'razon_social_fiscal,cuit,domicilio_fiscal,condicion_iva_emisor,logo_url,ingresos_brutos,' +
  'inicio_actividades,sitio_web,banco,cbu,alias_cbu,leyenda_comprobante'
const SELECT_FACTURACION =
  'facturacion_habilitada,condicion_iva_emisor,razon_social_fiscal,cuit,umbral_factura_b,logo_url,' +
  'domicilio_fiscal,ingresos_brutos,inicio_actividades,sitio_web,banco,cbu,alias_cbu,leyenda_comprobante'

test.describe('Datos del emisor en los comprobantes (guard fiscal)', () => {
  test.skip(!SUPABASE_URL || !ANON, 'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el entorno.')

  test('las selects de los comprobantes NO fallan (columnas inexistentes → 400 → CUIT vacío)', async ({ request }) => {
    const headers = restHeaders(await loginToken(request))

    for (const [nombre, sel] of [['VentasPage', SELECT_VENTAS], ['FacturacionPage', SELECT_FACTURACION]] as const) {
      const res = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=${sel}&limit=1`, { headers })
      expect(
        res.status(),
        `La select de los datos del emisor de ${nombre} devolvió ${res.status()}: ${await res.text()}\n` +
          `Una columna inexistente hace fallar la query ENTERA → la app emite el comprobante con ` +
          `el CUIT VACÍO y la condición de IVA falseada. Es exactamente el bug de v1.62.0.`,
      ).toBe(200)
    }
  })

  test('el tenant de prueba tiene identidad fiscal completa y NO se cae a un default inventado', async ({ request }) => {
    const headers = restHeaders(await loginToken(request))
    const res = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=${SELECT_VENTAS}&limit=1`, { headers })
    expect(res.ok()).toBeTruthy()
    const [cfg] = (await res.json()) as Array<Record<string, unknown>>

    expect(cfg, 'no se pudo leer la config fiscal del tenant').toBeTruthy()
    // El síntoma exacto que reportó GO: el CUIT llegaba vacío al PDF.
    expect(cfg.cuit, 'el CUIT del emisor llega VACÍO → el comprobante saldría sin CUIT').toBeTruthy()
    expect(cfg.razon_social_fiscal, 'la razón social del emisor llega vacía').toBeTruthy()
    // 🛑 `condicion_iva_emisor` gobierna A/B/C. El código la defaultea a 'responsable_inscripto'
    // si no la lee: si llegara null, un Monotributista emitiría declarándose RI.
    expect(
      cfg.condicion_iva_emisor,
      'la condición de IVA del emisor llega vacía → el PDF la defaultearía a "responsable_inscripto" ' +
        'y un Monotributista declararía ser Responsable Inscripto',
    ).toBeTruthy()
  })
})
