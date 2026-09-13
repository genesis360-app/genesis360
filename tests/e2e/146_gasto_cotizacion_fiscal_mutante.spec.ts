/**
 * 146_gasto_cotizacion_fiscal_mutante.spec.ts
 * E2E MUTANTE — 🛑 REGLA #0 (fiscal). Cubre la mig 414 + v1.218.0: el gasto en moneda extranjera
 * entra al Libro IVA convertido, y el crédito fiscal del Panel deja de sumar dólares como pesos.
 *
 * ⚠️ CRITERIO CONTABLE PENDIENTE DE VALIDAR CON UN CONTADOR MATRICULADO — ver
 * `G360.Wiki/wiki/business/consultas-contador.md` (C-01 … C-06). Este spec fija el comportamiento
 * acordado mientras tanto; si el contador dice otra cosa, cambia el spec junto con el código.
 *
 * 🛑 POR QUÉ CORRE EN OTRO TENANT (project `chromium-ri`):
 * el tenant principal de e2e ("Almacén Jorgito") es **Monotributista** y NO discrimina IVA crédito
 * — el bloque de alícuota solo existe con `esRI && tipo_comprobante === 'Factura A'`. Con el usuario
 * de siempre, este circuito entero es **inalcanzable por UI**: el Libro IVA Compras queda vacío y el
 * KPI de crédito siempre en cero. Por eso se agregó `auth.ri.setup.ts` ("Kiosco Buildi", RI).
 *
 * Las dos mitades que hacen que la feature sirva:
 *   1. El formulario PIDE la cotización solo cuando corresponde, y guarda la tasa fiscal — que NO
 *      es la cotización operativa del sistema (esa va al dólar comprador).
 *   2. El Libro y el KPI del Panel lo cuentan CONVERTIDO. El bug real que esto ataja: ambos sumaban
 *      `iva_monto` crudo, así que un IVA de US$210 entraba a la posición de IVA como $210.
 *
 *   npx dotenv -e tests/e2e/.env.test.local -- playwright test 146 --project=chromium-ri
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const TASA_FISCAL = 1500        // ARS por 1 USD, "BNA vendedor" ficticio pero verificable
const MONTO_USD = 1000

// 🛑 El campo se llama "Monto total" y es **IVA INCLUIDO**: `calcularIVA` extrae el IVA CONTENIDO
// (`monto - monto / 1.21`), no le suma 21% encima. Sobre 1000 da 173,55 — no 210. Escribir 210 acá
// fue el primer error de este spec, y es exactamente el malentendido que un test así tiene que
// dejar fijado: quien cargue el gasto pone el total del comprobante, no el neto.
const IVA_USD = 173.55

/** El número que muestra la UI ("$ 1.234,56") como float. */
const aNumero = (txt: string) => parseFloat(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))

/** El primer importe de una línea tipo "Deducible: $315.000 · 0/1 conciliados". */
const primerMonto = (txt: string) => {
  const m = txt.match(/\$\s?[\d.]+(?:,\d+)?/)
  return m ? aNumero(m[0]) : NaN
}

// Los labels de GastosPage no están asociados a sus inputs (sin htmlFor/id), así que `getByLabel`
// no los encuentra: se localizan por XPath desde el texto del label, como el resto de los specs.
const porLabel = (etiqueta: string) =>
  `xpath=//label[contains(.,"${etiqueta}")]/following::input[1]`

test.describe('Gasto en moneda extranjera → Libro IVA (mutante)', () => {

  test('el formulario pide la cotización fiscal SOLO cuando corresponde, y la guarda', async ({ page, request }) => {
    test.setTimeout(120_000)

    await goto(page, '/gastos')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))

    const descripcion = `E2E CotizFiscal ${Date.now()}`
    let gastoId: string | null = null

    try {
      await page.getByRole('button', { name: /Nuevo gasto$/ }).click()

      await page.locator(porLabel('Descripción')).fill(descripcion)
      await page.locator(porLabel('Monto total')).fill(String(MONTO_USD))

      // Factura A habilita el IVA crédito (21% por default). Recién acá el gasto es "deducible".
      await page.locator('select').filter({ has: page.locator('option', { hasText: /^Factura A$/ }) })
        .first().selectOption('Factura A')
      await expect(page.getByText('Alícuota de IVA')).toBeVisible()

      // ── CONTROL ANTI-VACÍO ───────────────────────────────────────────────────────────────
      // En la moneda del NEGOCIO no hay nada que convertir: el bloque NO debe aparecer. Sin esta
      // aserción, un campo que se mostrara SIEMPRE pasaría el resto del test igual.
      await expect(
        page.getByText(/Cotización para IVA/),
        'el bloque de cotización fiscal aparece con un gasto en la moneda del negocio: no hay nada ' +
        'que convertir y pedir una tasa ahí invita a cargar una que después convierta de más',
      ).toHaveCount(0)

      // ── Recién al pasar a USD tiene que aparecer ──────────────────────────────────────────
      await page.locator('select[title="Moneda del gasto"]').selectOption('USD')
      await expect(
        page.getByText(/Cotización para IVA/),
        'REGRESIÓN: un gasto en USD con IVA crédito NO pidió la cotización fiscal. Sin ella el ' +
        'gasto queda fuera del Libro IVA Compras y el crédito nunca se declara.',
      ).toBeVisible()

      // La fecha viene propuesta (día hábil anterior) — no vacía, para no obligar a tipearla.
      const fechaCotiz = page.locator(porLabel('Fecha de la cotización'))
      await expect(fechaCotiz, 'la fecha de la cotización no vino prefijada').not.toHaveValue('')

      await page.getByPlaceholder('0,0000').fill(String(TASA_FISCAL))

      // La vista previa muestra lo que va a entrar al libro, ya convertido.
      await expect(page.getByText('IVA crédito al libro')).toBeVisible()

      // `gastos_comp_si_iva` está en true para este tenant: con IVA deducible el comprobante es
      // obligatorio. Adjuntarlo es parte del camino real, no un atajo del test.
      await page.locator('input[type="file"]').first().setInputFiles({
        name: 'comprobante-e2e.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      })

      await page.getByRole('button', { name: /^Registrar gasto$/ }).click()

      // ── Lo que quedó en la base ──────────────────────────────────────────────────────────
      await expect(async () => {
        const res = await request.get(
          `${SUPABASE_URL}/rest/v1/gastos?descripcion=eq.${encodeURIComponent(descripcion)}` +
          '&select=id,moneda,monto,iva_monto,iva_deducible,cotizacion_fiscal,cotizacion_fiscal_fecha,cotizacion_fiscal_fuente',
          { headers },
        )
        expect(res.ok()).toBeTruthy()
        const filas = await res.json()
        expect(filas.length, 'el gasto no se guardó').toBe(1)
        gastoId = filas[0].id

        const g = filas[0]
        expect(g.moneda).toBe('USD')
        expect(
          parseFloat(g.cotizacion_fiscal),
          'REGRESIÓN: la cotización fiscal no se guardó. Las 3 columnas de la mig 414 existen pero ' +
          'el formulario volvió a no escribirlas — el gasto no puede entrar al libro.',
        ).toBe(TASA_FISCAL)
        expect(g.cotizacion_fiscal_fecha, 'se guardó la tasa sin la fecha: no se puede auditar cuál se usó').toBeTruthy()
        expect(g.cotizacion_fiscal_fuente).toBeTruthy()
        // El IVA se guarda en la moneda DEL GASTO, no convertido: la conversión es del libro.
        expect(parseFloat(g.iva_monto)).toBeCloseTo(IVA_USD, 1)
      }).toPass({ timeout: 20_000 })
    } finally {
      if (gastoId) await request.delete(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${gastoId}`, { headers })
    }
  })

  test('🛑 el crédito fiscal cuenta el IVA CONVERTIDO, no los dólares como pesos', async ({ page, request }) => {
    test.setTimeout(120_000)

    await goto(page, '/facturacion')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))

    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id,moneda&limit=1`, { headers })
    const tenant = (await tRes.json())[0]
    expect(tenant?.id, 'no resolví el tenant').toBeTruthy()
    expect(tenant.moneda, 'este spec asume un tenant en pesos').toBe('ARS')

    const hoy = new Date().toISOString().split('T')[0]
    const marca = `E2E LibroIVA ${Date.now()}`
    let sembradoId: string | null = null

    try {
      // Un gasto en USD con IVA crédito y su tasa fiscal congelada.
      const insRes = await request.post(`${SUPABASE_URL}/rest/v1/gastos`, {
        headers,
        data: {
          tenant_id: tenant.id,
          descripcion: marca,
          monto: MONTO_USD,
          moneda: 'USD',
          iva_monto: IVA_USD,
          iva_deducible: true,
          tipo_iva: '21',
          tipo_comprobante: 'Factura A',
          cotizacion_fiscal: TASA_FISCAL,
          cotizacion_fiscal_fecha: hoy,
          cotizacion_fiscal_fuente: 'BNA vendedor',
          fecha: hoy,
        },
      })
      expect(insRes.ok(), `no pude sembrar el gasto: ${await insRes.text()}`).toBeTruthy()
      sembradoId = (await insRes.json())[0]?.id

      // ── La foto de datos: qué debería dar el crédito del período, y qué daba el cálculo viejo ──
      // (Se calcula desde la DB en vez de asumir que el tenant está vacío — la lección del spec 143.)
      const inicioMes = hoy.slice(0, 8) + '01'
      const gRes = await request.get(
        `${SUPABASE_URL}/rest/v1/gastos?select=iva_monto,moneda,cotizacion_fiscal` +
        `&iva_deducible=eq.true&iva_monto=gt.0&fecha=gte.${inicioMes}&fecha=lte.${hoy}`,
        { headers },
      )
      const gastos = (await gRes.json()) as any[]

      const correcto = gastos.reduce((s, g) => {
        const iva = parseFloat(g.iva_monto) || 0
        const suya = String(g.moneda ?? 'ARS').toUpperCase()
        if (suya === 'ARS') return s + iva
        const tasa = parseFloat(g.cotizacion_fiscal) || 0
        return tasa > 0 ? s + iva * tasa : s          // sin tasa: NO entra
      }, 0)
      // El cálculo que tenía el bug: sumar `iva_monto` crudo, sin mirar la moneda.
      const crudo = gastos.reduce((s, g) => s + (parseFloat(g.iva_monto) || 0), 0)

      expect(
        correcto,
        'CONTROL ANTI-VACÍO: el cálculo correcto y el viejo dan lo mismo, así que este test no ' +
        'probaría nada. Debería haber al menos un gasto en otra moneda con cotización en el período.',
      ).not.toBeCloseTo(crudo, 0)

      // ── 1) El KPI del Panel ───────────────────────────────────────────────────────────────
      await goto(page, '/facturacion')
      await waitForApp(page)
      await expect(page.getByText('IVA Crédito (Compras)')).toBeVisible({ timeout: 15_000 })

      const kpiCredito = page.locator('div.rounded-xl')
        .filter({ hasText: 'IVA Crédito (Compras)' })
        .locator('p.text-3xl').first()
      await expect(kpiCredito).toBeVisible({ timeout: 15_000 })

      await expect(async () => {
        const valor = aNumero(await kpiCredito.innerText())
        expect(
          valor,
          `REGRESIÓN 🛑: el KPI de IVA Crédito mostró ${valor}, que es la suma CRUDA (${crudo.toFixed(2)}). ` +
          `Está contando el IVA de un gasto en dólares como si fueran pesos — US$${IVA_USD} entrando ` +
          `como $${IVA_USD}. Debería ser ${correcto.toFixed(2)}.`,
        ).toBeCloseTo(correcto, 0)
      }).toPass({ timeout: 20_000 })

      // ── 2) El Libro IVA Compras: la fila entra, con su importe original y la tasa a la vista ──
      await page.getByRole('button', { name: /Libros IVA/ }).click()
      await page.getByRole('button', { name: /IVA Compras/ }).click()

      const fila = page.locator('tr', { hasText: marca })
      await expect(
        fila,
        'REGRESIÓN: el gasto en moneda extranjera NO aparece en el Libro IVA Compras. Con ' +
        'cotización cargada tiene que entrar convertido, no quedar excluido.',
      ).toBeVisible({ timeout: 15_000 })

      // La trazabilidad del número: sin el importe original y la tasa, la fila es inauditable.
      // ⚠ La tasa se renderiza con formato es-AR ("1.500"), no "1500". Buscar el número crudo no
      //   matchearía nunca — y como la aserción es sobre algo que no existe, el test habría fallado
      //   siempre (o, con la polaridad invertida, habría pasado sin mirar nada).
      const tasaRenderizada = TASA_FISCAL.toLocaleString('es-AR', { maximumFractionDigits: 4 })
      await expect(
        fila.getByText(tasaRenderizada, { exact: false }),
        'la fila no muestra la tasa usada: el importe convertido queda sin respaldo',
      ).toBeVisible()

      // El total "Deducible" del libro también va convertido. Se localiza por su TEXTO y no por la
      // clase de Tailwind del <strong>: un cambio de color lo dejaría apuntando a otro número.
      const lineaDeducible = page.locator('span').filter({ hasText: /^Deducible:/ }).first()
      await expect(async () => {
        expect(primerMonto(await lineaDeducible.innerText())).toBeCloseTo(correcto, 0)
      }).toPass({ timeout: 15_000 })
    } finally {
      if (sembradoId) await request.delete(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${sembradoId}`, { headers })
    }
  })

  test('sin cotización, el gasto queda FUERA del libro y se avisa cuánto crédito no entró', async ({ page, request }) => {
    test.setTimeout(120_000)

    await goto(page, '/facturacion')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))

    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`, { headers })
    const tenant = (await tRes.json())[0]

    const hoy = new Date().toISOString().split('T')[0]
    const marca = `E2E SinCotiz ${Date.now()}`
    let sembradoId: string | null = null

    try {
      // Mismo gasto, pero SIN tasa: no se le puede inventar una.
      const insRes = await request.post(`${SUPABASE_URL}/rest/v1/gastos`, {
        headers,
        data: {
          tenant_id: tenant.id,
          descripcion: marca,
          monto: MONTO_USD,
          moneda: 'USD',
          iva_monto: IVA_USD,
          iva_deducible: true,
          tipo_iva: '21',
          tipo_comprobante: 'Factura A',
          fecha: hoy,
        },
      })
      expect(insRes.ok(), `no pude sembrar: ${await insRes.text()}`).toBeTruthy()
      sembradoId = (await insRes.json())[0]?.id

      await goto(page, '/facturacion')
      await waitForApp(page)
      await page.getByRole('button', { name: /Libros IVA/ }).click()
      await page.getByRole('button', { name: /IVA Compras/ }).click()

      await expect(
        page.locator('tr', { hasText: marca }),
        'REGRESIÓN 🛑: un gasto SIN cotización fiscal entró igual al Libro IVA. O se le inventó una ' +
        'tasa, o se sumaron dólares como pesos. Las dos cosas falsean la posición de IVA.',
      ).toHaveCount(0, { timeout: 15_000 })

      // Pero no desaparece en silencio: el aviso dice cuánto crédito quedó sin declarar.
      await expect(
        page.getByText(/sin cotización fiscal cargada/i),
        'el gasto quedó fuera del libro SIN avisar. Un crédito fiscal que no entra tiene que verse.',
      ).toBeVisible({ timeout: 15_000 })

      // Y el aviso también está en el Panel: la posición de arriba se lee como si estuviera completa.
      await page.getByRole('button', { name: /Panel de control/ }).click()
      await expect(
        page.getByText(/fuera de esta posición/i),
        'el Panel muestra la posición sin avisar que hay crédito afuera: quien la mira cree que está completa.',
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      if (sembradoId) await request.delete(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${sembradoId}`, { headers })
    }
  })
})
