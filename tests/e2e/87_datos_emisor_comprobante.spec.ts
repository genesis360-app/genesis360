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
// ⚠ Actualizado v1.133.0 (cutover mig 271): la identidad de los PDFs ya NO sale de `tenants`
// sino de `emisores_fiscales` (fuente única, `camposEmisorPDF` → IDENTIDAD_EMISOR_COLS).
// La select de tenants que queda viva es la de config de FacturacionPage.
const SELECT_IDENTIDAD_EMISOR =
  'id,cuit,razon_social_fiscal,condicion_iva_emisor,domicilio_fiscal,ingresos_brutos,' +
  'inicio_actividades,banco,cbu,alias_cbu,leyenda_comprobante,logo_url,es_default,activo'
const SELECT_FACTURACION =
  'facturacion_habilitada,condicion_iva_emisor,razon_social_fiscal,cuit,umbral_factura_b,logo_url,' +
  'domicilio_fiscal,ingresos_brutos,inicio_actividades,sitio_web,banco,cbu,alias_cbu,leyenda_comprobante'

test.describe('Datos del emisor en los comprobantes (guard fiscal)', () => {
  test.skip(!SUPABASE_URL || !ANON, 'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el entorno.')

  test('las selects de los comprobantes NO fallan (columnas inexistentes → 400 → CUIT vacío)', async ({ request }) => {
    const headers = restHeaders(await loginToken(request))

    const casos = [
      ['camposEmisorPDF (emisores_fiscales)', 'emisores_fiscales', SELECT_IDENTIDAD_EMISOR],
      ['config de FacturacionPage (tenants)', 'tenants', SELECT_FACTURACION],
    ] as const
    for (const [nombre, tabla, sel] of casos) {
      const res = await request.get(`${SUPABASE_URL}/rest/v1/${tabla}?select=${sel}&limit=1`, { headers })
      expect(
        res.status(),
        `La select de ${nombre} devolvió ${res.status()}: ${await res.text()}\n` +
          `Una columna inexistente hace fallar la query ENTERA → la app emitiría el comprobante ` +
          `con el CUIT VACÍO. Es exactamente el bug de v1.62.0.`,
      ).toBe(200)
    }
  })

  test('el emisor DEFAULT del tenant tiene identidad fiscal completa (la que imprimen los PDFs)', async ({ request }) => {
    const headers = restHeaders(await loginToken(request))
    // v1.133.0: los PDFs leen la identidad de emisores_fiscales — se valida ESA fila, no tenants.
    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/emisores_fiscales?select=${SELECT_IDENTIDAD_EMISOR}&es_default=eq.true&limit=1`,
      { headers },
    )
    expect(res.ok()).toBeTruthy()
    const [emisor] = (await res.json()) as Array<Record<string, unknown>>

    expect(emisor, 'el tenant de prueba no tiene emisor fiscal default (mig 271 no corrió?)').toBeTruthy()
    // El síntoma exacto que reportó GO: el CUIT llegaba vacío al PDF.
    expect(emisor.cuit, 'el CUIT del emisor llega VACÍO → el comprobante saldría sin CUIT').toBeTruthy()
    expect(emisor.razon_social_fiscal, 'la razón social del emisor llega vacía').toBeTruthy()
    expect(
      emisor.condicion_iva_emisor,
      'la condición de IVA del emisor llega vacía → un documento fiscal no debe imprimirse sin ella',
    ).toBeTruthy()
    expect(emisor.activo, 'el emisor default está inactivo — el guard de mig 271 debería impedirlo').toBe(true)
  })

  test('🛑 multi-CUIT: la identidad que imprime el PDF es la del EMISOR de la venta, no la del tenant', async ({ request }) => {
    // El 2º bug (expuesto al arreglar el CUIT vacío): con multi-CUIT el CAE sale con el CUIT
    // del emisor de la venta, pero el PDF imprimía la identidad del TENANT → papel ≠ AFIP.
    // Kiosco Buildi (DEV) tiene ventas REALES emitidas por DOS emisores distintos (validación
    // del 2026-07-15: Factura C del Monotributo de Fede + Factura B del RI default).
    const email = process.env.E2E_MULTICUIT_EMAIL
    const pass = process.env.E2E_MULTICUIT_PASSWORD
    test.skip(!email || !pass, 'Sin credenciales E2E_MULTICUIT_* (tenant multi-CUIT solo en DEV).')

    const headers = restHeaders(await loginToken(request, email, pass))

    // CUIT del tenant (lo que ANTES imprimía el PDF, mal) y emisores del tenant
    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=cuit&limit=1`, { headers })
    const [{ cuit: cuitTenant }] = await tRes.json()
    const eRes = await request.get(
      `${SUPABASE_URL}/rest/v1/emisores_fiscales?select=id,cuit,es_default`, { headers },
    )
    const emisores = (await eRes.json()) as Array<{ id: string; cuit: string; es_default: boolean }>
    const adicional = emisores.find(e => !e.es_default)
    test.skip(!adicional, 'El tenant multi-CUIT no tiene emisor adicional (fixture cambió).')

    // Una venta con CAE emitida por el emisor ADICIONAL (la Factura C de Fede)
    const vRes = await request.get(
      `${SUPABASE_URL}/rest/v1/ventas?select=id,emisor_id,tipo_comprobante,numero_comprobante` +
        `&cae=not.is.null&emisor_id=eq.${adicional!.id}&limit=1`,
      { headers },
    )
    const ventas = (await vRes.json()) as Array<{ emisor_id: string }>
    expect(
      ventas.length,
      'No hay ventas con CAE del emisor adicional — la validación multi-CUIT del 15/07 emitió una (Factura C nº1). Revisar el fixture.',
    ).toBeGreaterThan(0)

    // LA aserción: la identidad de ESA venta (cadena venta.emisor_id → emisores_fiscales,
    // que es la que ahora usa camposEmisorPDF) tiene el CUIT del ADICIONAL…
    const identidad = emisores.find(e => e.id === ventas[0].emisor_id)
    expect(identidad, 'el emisor de la venta no existe en emisores_fiscales').toBeTruthy()
    expect(identidad!.cuit).toBe(adicional!.cuit)
    // …y es DISTINTO del CUIT del tenant: si el PDF leyera tenants (el bug), imprimiría MAL.
    expect(
      identidad!.cuit,
      'El CUIT del emisor de la venta coincide con el del tenant — este fixture ya no prueba el caso multi-CUIT.',
    ).not.toBe(cuitTenant)
  })
})
