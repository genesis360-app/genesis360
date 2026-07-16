/**
 * 55_venta_usd_conversion_mutante.spec.ts
 * E2E — Producto en USD se convierte a moneda local a la cotización vigente (REGLA #0, plata).
 *
 * Lógica L41 (`VentasPage` ~1281-1292): si el producto tiene `moneda_venta='usd'` + `precio_usd>0`
 * y el tenant tiene `cotizacion_usd>0`, al agregarlo al carrito su `precio_unitario` se calcula como
 * `round(precio_usd × cotizacion_usd)` (moneda local) y guarda `precio_usd_origen`. Ese precio_unitario
 * alimenta subtotal/IVA/`venta_items` → si la conversión está mal, se vende a un precio equivocado.
 *
 * Valida por UI (sin mutar): al agregar el producto USD, el carrito muestra
 * "Precio USD {origen} · convertido a ${local}". Con `precio_usd=10` y `cotizacion_usd=1430` → $14.300.
 *
 * Fixture SQL (DEV, Almacén Jorgito): se marca temporalmente "Coca Cola 1.5L Original" (CON stock, así
 * aparece en el buscador) como `moneda_venta='usd'` + `precio_usd=10` (se restaura a 'local'/NULL tras
 * correr). La `cotizacion_usd=1430` ya estaba seteada.
 *
 * Re-ejecutable y sin efectos (no completa la venta). Skip-guard si el producto no aparece o el fixture
 * USD no está aplicado. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { irAlPOS } from './helpers/fixtures'

test.describe('Venta de producto en USD — conversión a la cotización vigente', () => {
  test('agregar producto USD → precio convertido a moneda local', async ({ page }) => {
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
    // POSITIVO: 10 USD × 1430 = $14.300 (conversión a moneda local en el carrito)
    await expect(page.getByText(/Precio USD\s*10.*convertido a \$14[.,]300/i)).toBeVisible({ timeout: 6000 })
  })
})
