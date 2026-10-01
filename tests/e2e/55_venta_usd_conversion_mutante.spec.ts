/**
 * 55_venta_usd_conversion_mutante.spec.ts
 * E2E — Producto en USD se convierte a moneda local a la cotización vigente (REGLA #0, plata).
 *
 * Lógica L41 (`VentasPage` ~1281-1292): si el producto tiene `moneda_venta='usd'` + `precio_usd>0`
 * y hay cotización del dólar BNA, al agregarlo al carrito su `precio_unitario` se calcula como
 * `round(precio_usd × tasa, 2)` (moneda local) y guarda `precio_usd_origen`. Desde D-1 fase 2
 * (2026-09-26) la tasa es la ÚNICA del sistema: vendedor divisa BNA del día hábil anterior
 * (`fn_cotizacion_bna_vigente`), no `tenants.cotizacion_usd`. Ese precio_unitario
 * alimenta subtotal/IVA/`venta_items` → si la conversión está mal, se vende a un precio equivocado.
 *
 * Valida por UI (sin mutar): al agregar el producto USD, el carrito muestra
 * "Precio USD {origen} · convertido a ${local}". Con `precio_usd=10` → 10 × la tasa vigente, leída en
 * el mismo test (cambia todos los días).
 *
 * Fixture SQL (DEV, Almacén Jorgito): se marca temporalmente "Coca Cola 1.5L Original" (CON stock, así
 * aparece en el buscador) como `moneda_venta='usd'` + `precio_usd=10` (se restaura a 'local'/NULL tras
 * correr).
 *
 * Re-ejecutable y sin efectos (no completa la venta). Skip-guard si el producto no aparece o el fixture
 * USD no está aplicado. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { irAlPOS, tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Venta de producto en USD — conversión a la cotización vigente', () => {
  test('agregar producto USD → precio convertido a moneda local', async ({ page, request }) => {
    // 🔎 `irAlPOS` en vez de goto+waitForApp: en una corrida masiva del 2026-07-15 este spec
    // falló con un críptico "no se encontró el buscador", y el snapshot del fallo mostraba el
    // DASHBOARD renderizado en /ventas (0 señales de POS, 4 de Dashboard: "La Balanza"/"El Mix
    // de Caja"). Aislado llega bien al POS. Causa raíz NO identificada — descartados:
    // permisos_custom (el OWNER e2e tiene rol_custom_id: null), redirects por rol de AppLayout,
    // RUTAS_AVANZADO (/ventas no está), el guard de ruta (/ventas cuelga de un AuthGuard SIN
    // requireRole) y el service worker (los e2e corren contra `npm run dev` y VitePWA no tiene
    // devOptions → SW deshabilitado en dev).
    // Si es real, un DUEÑO que entra directo a /ventas a veces cae en /dashboard = BUG DE
    // PRODUCTO. `irAlPOS` reporta URL + h1 + si renderizó el Dashboard, para cazarlo la próxima
    // vez que aparezca en lugar de dejar un mensaje que no dice nada.
    await irAlPOS(page)

    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await buscador.fill('Coca Cola 1.5L')
    // Sin sleep fijo: esperar el resultado, no el reloj (los 243 waitForTimeout fijos de la
    // suite son la causa raíz de que las fallas se muevan entre corridas).
    const prod = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: /Coca Cola 1\.5L/i }).first()
    const aparecio = await prod.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
    if (!aparecio) {
      test.skip(true, 'Producto "Coca Cola 1.5L Original" no disponible en el tenant.')
    }
    await prod.click()
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 8000 })

    // Si no aparece el indicador USD, el fixture (moneda_venta='usd' + precio_usd) no está aplicado.
    const usdInd = page.getByText(/Precio USD/i).first()
    if (!(await usdInd.isVisible().catch(() => false))) {
      test.skip(true, 'Fixture USD no aplicado (marcar el producto moneda_venta=usd, precio_usd=10) o sin cotización.')
    }
    // La tasa vigente, leída de la misma fuente que la app (cambia todos los días).
    const rpc = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cotizacion_bna_vigente`, {
      headers: restHeaders(await tokenDesdeBrowser(page)), data: { p_moneda: 'USD' },
    })
    expect(rpc.ok(), 'no pude leer la cotización vigente').toBeTruthy()
    const tasa = parseFloat(String((await rpc.json())?.[0]?.venta ?? 0))
    expect(tasa > 1, `sin cotización BNA vigente (${tasa}) — el test no mide nada`).toBeTruthy()
    // POSITIVO: 10 USD × tasa (conversión a moneda local en el carrito; la UI muestra sin decimales)
    const esperado = Math.round(10 * tasa * 100) / 100
    const txt = esperado.toLocaleString('es-AR', { maximumFractionDigits: 0 }).replace(/\./g, '[.,]')
    await expect(page.getByText(new RegExp(`Precio USD\\s*10.*convertido a \\$${txt}(?!\\d)`, 'i'))).toBeVisible({ timeout: 6000 })
  })
})
