/**
 * 109_variantes_madre_hijo_mutante.spec.ts
 * E2E MUTANTE — Fase 3 del rediseño UoM/Empaque/Variantes (mig 305): variantes madre/hijo con
 * auto-referencia productos.producto_padre_id + variante_diferenciador. El nombre del hijo lo
 * compone un trigger de DB (madre.nombre — diferenciador) y se propaga al renombrar la madre.
 *
 * Aserciones POSITIVAS + verificación en DB (genera su propia precondición, nombres únicos):
 *  1) crear un hijo (REST) compone su nombre = "madre — diferenciador".
 *  2) renombrar la madre propaga el nombre a todos los hijos.
 *  3) GUARD: no se puede colgar una variante de otra variante (3 niveles) — la DB lo rechaza.
 *  4) GUARD: dos hermanos no pueden tener el mismo diferenciador (unique parcial).
 *  5-9) GUARD (mig 314): los dos modelos de variante no conviven en el mismo SKU — un hijo no
 *       puede tener Atributos de variante, una madre agrupadora tampoco, y a un producto con
 *       atributos no se le puede crear la primera variante… pero apagándolos sí (hay salida).
 *       Un standalone con atributos sigue siendo perfectamente válido.
 *
 * La exclusión de la madre agrupadora en el POS (Regla #0: no se vende un agrupador) es filtrado
 * client-side en VentasPage (`.not('id','in', madreIds)`) — no se testea acá por UI porque la
 * visibilidad de un producto en el POS depende del stock (mode-aware) y daría un pase vacuo.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Variantes madre/hijo (mutante)', () => {
  test('nombre compuesto + propagación + guards de nivel/unicidad', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const madreNombre = `E2E Remera ${ts}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ tenant_id: string }>
    const tenantId = suc.tenant_id

    // Madre (agrupador) por REST
    const madreRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: madreNombre, sku: `E2E-MADRE-${ts}`, precio_venta: 0, precio_costo: 0, unidad_medida: 'unidad', activo: true },
    })
    expect(madreRes.ok(), `[109] no se pudo crear la madre: ${await madreRes.text()}`).toBe(true)
    const [madre] = (await madreRes.json()) as Array<{ id: string }>

    // 1) Hijo → el trigger compone el nombre "madre — diferenciador"
    const hijo1Res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: 'placeholder', sku: `E2E-HIJO1-${ts}`, producto_padre_id: madre.id, variante_diferenciador: 'Rojo / M', precio_venta: 5000, precio_costo: 2000, unidad_medida: 'unidad', activo: true },
    })
    expect(hijo1Res.ok(), `[109] no se pudo crear el hijo 1: ${await hijo1Res.text()}`).toBe(true)
    const [hijo1] = (await hijo1Res.json()) as Array<{ id: string; nombre: string }>
    expect(hijo1.nombre, '[109] el trigger debe componer el nombre del hijo').toBe(`${madreNombre} — Rojo / M`)

    const hijo2Res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: 'placeholder', sku: `E2E-HIJO2-${ts}`, producto_padre_id: madre.id, variante_diferenciador: 'Azul / L', precio_venta: 5000, precio_costo: 2000, unidad_medida: 'unidad', activo: true },
    })
    expect(hijo2Res.ok()).toBe(true)
    const [hijo2] = (await hijo2Res.json()) as Array<{ id: string; nombre: string }>
    expect(hijo2.nombre).toBe(`${madreNombre} — Azul / L`)

    // 2) Renombrar la madre → propaga a los hijos
    const nuevoNombre = `E2E Remera Premium ${ts}`
    const renameRes = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${madre.id}`, {
      headers, data: { nombre: nuevoNombre },
    })
    expect(renameRes.ok()).toBe(true)
    const hijosRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?producto_padre_id=eq.${madre.id}&order=variante_diferenciador&select=nombre,variante_diferenciador`, { headers },
    )
    const hijos = (await hijosRes.json()) as Array<{ nombre: string; variante_diferenciador: string }>
    expect(hijos, '[109] la madre debe seguir teniendo 2 hijos').toHaveLength(2)
    for (const h of hijos) {
      expect(h.nombre, '[109] el nombre del hijo debe reflejar el nuevo nombre de la madre').toBe(`${nuevoNombre} — ${h.variante_diferenciador}`)
    }

    // 3) GUARD: colgar una variante de otra variante (3 niveles) → la DB lo rechaza
    const nietoRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: 'x', sku: `E2E-NIETO-${ts}`, producto_padre_id: hijo1.id, variante_diferenciador: 'XS', precio_venta: 1, precio_costo: 0, unidad_medida: 'unidad', activo: true },
    })
    expect(nietoRes.ok(), '[109] la DB NO debe permitir 3 niveles (variante de variante)').toBe(false)

    // 4) GUARD: dos hermanos con el mismo diferenciador → unique parcial lo rechaza
    const dupRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: 'x', sku: `E2E-DUP-${ts}`, producto_padre_id: madre.id, variante_diferenciador: 'Rojo / M', precio_venta: 1, precio_costo: 0, unidad_medida: 'unidad', activo: true },
    })
    expect(dupRes.ok(), '[109] no debe permitir dos hermanos con el mismo diferenciador').toBe(false)

    // ── Un producto usa UN modelo de variante, no dos (mig 314) ──────────────────────────
    // Los dos sistemas coexisten en la app pero no dentro del mismo SKU. Se prueba por REST
    // a propósito: la UI se cachea y el importador/EFs escriben con service_role sin pasarle
    // por al lado, así que lo que importa es que el SERVIDOR lo rechace.

    // 5) GUARD: un hijo no puede tener Atributos de variante propios (CHECK)
    const hijoAtribRes = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${hijo1.id}`, {
      headers, data: { tiene_talle: true },
    })
    expect(hijoAtribRes.ok(), '[109] una variante hijo NO puede tener Atributos de variante encima').toBe(false)

    // 6) GUARD: encender un Atributo de variante en una MADRE que ya tiene hijos
    const madreAtribRes = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${madre.id}`, {
      headers, data: { tiene_color: true },
    })
    expect(madreAtribRes.ok(), '[109] una madre agrupadora NO puede tener Atributos de variante').toBe(false)

    // 7) Un producto standalone SÍ puede tener atributos — el modelo de atributos sigue vivo.
    const soloAtribRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: `E2E SoloAtributos ${ts}`, sku: `E2E-ATRIB-${ts}`, tiene_talle: true, precio_venta: 100, precio_costo: 50, unidad_medida: 'unidad', activo: true },
    })
    expect(soloAtribRes.ok(), `[109] un standalone con atributos debe poder crearse: ${await soloAtribRes.text()}`).toBe(true)
    const [soloAtrib] = (await soloAtribRes.json()) as Array<{ id: string }>

    // 8) GUARD: pero crearle la PRIMERA variante lo convertiría en agrupador con atributos
    const varDeAtribRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: 'x', sku: `E2E-VARATRIB-${ts}`, producto_padre_id: soloAtrib.id, variante_diferenciador: 'Rojo', precio_venta: 1, precio_costo: 0, unidad_medida: 'unidad', activo: true },
    })
    expect(varDeAtribRes.ok(), '[109] no se le puede crear una variante a un producto con Atributos de variante').toBe(false)

    // 9) …y apagando los atributos, el mismo producto SÍ acepta la variante (hay salida).
    const apagarRes = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${soloAtrib.id}`, {
      headers, data: { tiene_talle: false },
    })
    expect(apagarRes.ok(), '[109] apagar los atributos de un standalone debe permitirse').toBe(true)
    const varOkRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tenantId, nombre: 'x', sku: `E2E-VAROK-${ts}`, producto_padre_id: soloAtrib.id, variante_diferenciador: 'Rojo', precio_venta: 1, precio_costo: 0, unidad_medida: 'unidad', activo: true },
    })
    expect(varOkRes.ok(), `[109] con los atributos apagados la variante debe crearse: ${await varOkRes.text()}`).toBe(true)
  })
})
