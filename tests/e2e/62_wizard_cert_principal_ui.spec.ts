/**
 * 62_wizard_cert_principal_ui.spec.ts
 * E2E (UI clickthrough) — El wizard de certificado AFIP también para el emisor PRINCIPAL (v1.129.0).
 *
 * Hallazgo de GO: el asistente self-service (Generar CSR → ARCA → subir .crt) estaba SÓLO en los
 * emisores adicionales; el emisor principal (el del que recién arranca) no lo tenía. Este spec
 * abre la app real (Config → Facturación → Emisores fiscales), expande el emisor principal (⭐) y
 * verifica que ahora tiene el botón "Certificado" → modo Asistente con la generación de CSR.
 *
 * CERT-UI-02 además genera el CSR de verdad por la UI (mismo efecto que la EF del spec 61) y
 * verifica que aparece el bloque PEM PKCS#10. Limpia el `csr_key_path` (artefacto transitorio) al
 * final — no toca el certificado activo ni nada fiscal.
 *
 * Corre contra localhost:5173 (dev server que Playwright levanta solo, apuntando a Supabase DEV) y
 * reusa la sesión del owner (storageState). Requiere E2E_EMAIL/E2E_PASSWORD + VITE_SUPABASE_* para
 * el cleanup del CERT-UI-02.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD
const TENANT_JORGITO = '3769b1db-10f4-46a6-bc7f-eb669307730d'

/** Abre Config → Facturación → panel de Emisores fiscales expandido. */
async function abrirPanelEmisores(page: import('@playwright/test').Page) {
  await goto(page, '/configuracion')
  await waitForApp(page)
  await page.getByRole('button', { name: /facturaci/i }).first().click()
  const panel = page.getByRole('button', { name: /emisores fiscales/i }).first()
  await expect(panel).toBeVisible({ timeout: 8000 })
  await panel.click()
}

test.describe('Wizard de certificado — emisor PRINCIPAL (UI clickthrough, fix v1.129.0)', () => {
  test('CERT-UI-01: el emisor principal (⭐) tiene el asistente de certificado', async ({ page }) => {
    await abrirPanelEmisores(page)

    // El botón "Certificado" (exacto) es exclusivo del emisor principal; los adicionales dicen
    // "Cert / PV". Antes del fix el principal sólo mostraba "se edita arriba ↑" (sin acceso al wizard).
    const btnCert = page.getByRole('button', { name: /^Certificado$/ }).first()
    await expect(btnCert, 'el emisor principal debe exponer el botón "Certificado" (fix v1.129.0)')
      .toBeVisible({ timeout: 8000 })
    await btnCert.click()

    // Se abre el asistente: toggle "Asistente" + "Ya tengo .crt + .key" y un botón de generar CSR
    // (el texto varía según el estado: generar / pendiente-crt / activo-reemplazar).
    await expect(page.getByRole('button', { name: /^Asistente$/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /ya tengo \.crt/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /generar.*csr/i }).first())
      .toBeVisible({ timeout: 5000 })
  })

  test('CERT-UI-02: generar el CSR desde la UI del principal → aparece el PEM PKCS#10', async ({ page, request }) => {
    test.skip(!SUPABASE_URL || !ANON || !E2E_EMAIL || !E2E_PASSWORD, 'Faltan env para el cleanup.')
    await abrirPanelEmisores(page)
    await page.getByRole('button', { name: /^Certificado$/ }).first().click()

    // Asegurar modo Asistente y disparar la generación.
    await page.getByRole('button', { name: /^Asistente$/ }).first().click()
    await page.getByRole('button', { name: /generar.*csr/i }).first().click()

    // La EF (node-forge) tarda ~1-2s; aparece el textarea readonly con el CSR PKCS#10.
    const csrArea = page.locator('textarea[readonly]').first()
    await expect(csrArea).toBeVisible({ timeout: 20000 })
    await expect(csrArea).toHaveValue(/-----BEGIN CERTIFICATE REQUEST-----/)
    // Los botones del paso 2/3 (pegar en ARCA + subir el .crt).
    await expect(page.getByRole('button', { name: /copiar/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /ir a arca/i }).first()).toBeVisible()

    // Cleanup: limpiar el csr_key_path (puntero transitorio; no toca el cert activo).
    try {
      const login = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        headers: { apikey: ANON!, 'Content-Type': 'application/json' },
        data: { email: E2E_EMAIL, password: E2E_PASSWORD },
      })
      const token = (await login.json()).access_token
      await request.patch(
        `${SUPABASE_URL}/rest/v1/emisores_fiscales?tenant_id=eq.${TENANT_JORGITO}&es_default=is.true`,
        {
          headers: {
            Authorization: `Bearer ${token}`, apikey: ANON!,
            'Content-Type': 'application/json', Prefer: 'return=minimal',
          },
          data: { csr_key_path: null },
        },
      )
    } catch { /* best-effort */ }
  })
})
