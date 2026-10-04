/**
 * 181_categoria_cartel_ia.spec.ts
 * E2E — B2 / Fase 5 (mig 469, EF `categoria-cartel-ia`): la IA redacta el cartel del POS de una categoría (B-4).
 *
 * En la lista de descuentos se ve "Cartel para el cajero" con un ejemplo ya completado (sin marcadores sueltos).
 * "Volver a redactar" llama a la EF: queda guardado con fecha y origen ('ia' o, si la IA falló, 'plantilla'). La IA es
 * un servicio externo: el test acepta los dos orígenes, pero exige que el ejemplo nunca muestre un {marcador}.
 * La EF sin sesión responde 401. Corre con OWNER (chromium).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, ANON } from './helpers/fixtures'

test('cartel de la categoría: se redacta al pedirlo y el ejemplo sale completo', async ({ page, request }) => {
  test.setTimeout(90000)
  const ts = Date.now()
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [suc] = await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()
  const tenantId = suc.tenant_id
  const [cat] = await (await request.post(`${SUPABASE_URL}/rest/v1/categorias_cliente`, {
    headers, data: { tenant_id: tenantId, nombre: `Gastronómicos 181 ${ts}`, activo: true },
  })).json()
  const [prod] = await (await request.get(`${SUPABASE_URL}/rest/v1/productos?select=id,nombre&tenant_id=eq.${tenantId}&activo=eq.true&limit=1`, { headers })).json()
  const d = await request.post(`${SUPABASE_URL}/rest/v1/categoria_cliente_descuentos`, {
    headers, data: { tenant_id: tenantId, categoria_id: cat.id, producto_id: prod.id, descuento_pct: 15 },
  })
  expect(d.ok(), `descuento: ${await d.text()}`).toBe(true)

  try {
    // Sin sesión, la EF no redacta nada.
    const anon = await request.post(`${SUPABASE_URL}/functions/v1/categoria-cartel-ia`, {
      headers: { apikey: ANON!, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, data: { categoria_id: cat.id },
    })
    expect(anon.status()).toBe(401)

    await goto(page, `/clientes/categorias/${cat.id}/descuentos`)
    await waitForApp(page)
    const panel = page.getByTestId('cartel-categoria')
    await expect(panel).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('cartel-origen')).toHaveText('Texto estándar')
    await expect(panel).toContainText(prod.nombre)

    await panel.getByRole('button', { name: /Volver a redactar/ }).click()
    await expect(page.getByText(/Cartel redactado|Se usa el texto estándar/).first()).toBeVisible({ timeout: 30000 })

    const [g] = await (await request.get(`${SUPABASE_URL}/rest/v1/categorias_cliente?id=eq.${cat.id}&select=cartel_origen,cartel_generado_at,cartel_textos`, { headers })).json()
    expect(g.cartel_generado_at, 'quedó registrada la redacción').toBeTruthy()
    expect(['ia', 'plantilla']).toContain(g.cartel_origen)
    if (g.cartel_origen === 'ia') {
      expect(Object.keys(g.cartel_textos).sort()).toEqual(['categoria_gana', 'estado_no_suma', 'otro_gana'])
      await expect(page.getByTestId('cartel-origen')).toHaveText('Redactado con IA', { timeout: 10000 })
    } else {
      expect(g.cartel_textos).toBeNull()
    }
    // Nunca un marcador sin completar ni un número inventado por la IA fuera de los del ejemplo.
    await expect(panel).not.toContainText(/\{[a-z_]+\}/)
  } finally {
    await request.delete(`${SUPABASE_URL}/rest/v1/categoria_cliente_descuentos?categoria_id=eq.${cat.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/categorias_cliente?id=eq.${cat.id}`, { headers })
  }
})
