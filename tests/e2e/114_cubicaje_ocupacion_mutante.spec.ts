/**
 * 114_cubicaje_ocupacion_mutante.spec.ts
 * E2E MUTANTE — `vw_ubicacion_ocupacion`: LPN, peso y volumen de una ubicación (migs 321/322/325).
 *
 * 🛑 REGLA #0 (inventario). Este spec existe porque la mig 322 salió con la vista **rota de una
 * forma que no se ve**: unía `producto_presentaciones.id` con `inventario_lineas.unidad_medida_id`,
 * que referencia `unidades_medida` (el catálogo de EMPAQUES). Nunca matcheaba → las líneas que
 * entraron EN BULTO, las que más volumen ocupan, aportaban **0 m³**. Una vista que devuelve números
 * plausibles pero mal no se delata sola: hay que asertar contra el valor calculado a mano.
 *
 * Los tres modos de falla que protege, todos silenciosos:
 *   1. **No encontrar la presentación** → volumen/peso en 0 y "parece que hay lugar".
 *   2. **Encontrar más de una** (presentaciones HERMANAS del mismo empaque: "Caja-12" y "Caja-10"
 *      cuelgan las dos del empaque "Caja") → la línea se duplica y una posición con 3 LPN dice 6.
 *   3. **Truncar la división** (`cantidad` integer / `factor_base` bigint en Postgres) → 48 unidades
 *      en cajas de 10 dan 4 bultos en vez de 4,8 y el peso sale ~17% corto, en el dato que decide si
 *      un rack está sobrecargado.
 *
 * Todo por REST contra la DB: lo que se protege es la VISTA, no la pantalla que la dibuja.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type Ctx = { headers: Record<string, string>; J: Record<string, string>; tenantId: string; sucId: string }

async function ctx(page: any, request: any): Promise<Ctx> {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const J = { ...headers, Prefer: 'return=representation' }
  const [suc] = (await (await request.get(
    `${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })).json()) as any[]
  return { headers, J, tenantId: suc.tenant_id, sucId: suc.id }
}

const post = async (c: Ctx, request: any, tabla: string, data: any) => {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/${tabla}`, { headers: c.J, data })
  expect(res.ok(), `[114] no se pudo insertar en ${tabla}: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

const get = async (c: Ctx, request: any, q: string) =>
  (await (await request.get(`${SUPABASE_URL}/rest/v1/${q}`, { headers: c.headers })).json()) as any[]

const patch = async (c: Ctx, request: any, q: string, data: any) => {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: c.J, data })
  expect(res.ok(), `[114] no se pudo actualizar ${q}: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

/**
 * La presentación BASE de un producto **ya existe**: la siembra el trigger
 * `trg_productos_presentacion_base` al crearlo (y `idx_pp_una_base` impide una segunda). Así que
 * acá se la busca y se la completa, nunca se la inserta.
 */
async function completarBase(c: Ctx, request: any, productoId: string, medidas: any) {
  const [base] = await get(c, request,
    `producto_presentaciones?select=id&producto_id=eq.${productoId}&es_base=is.true&limit=1`)
  expect(base, '[114] el trigger tendría que haber sembrado la presentación base').toBeTruthy()
  return patch(c, request, `producto_presentaciones?id=eq.${base.id}`, medidas)
}

/** Empaque del tenant por nombre; lo crea si no existe (el catálogo lo siembra la mig 308). */
async function empaque(c: Ctx, request: any, nombre: string): Promise<string> {
  const ya = await get(c, request,
    `unidades_medida?select=id&tenant_id=eq.${c.tenantId}&nombre=eq.${encodeURIComponent(nombre)}&limit=1`)
  if (ya[0]) return ya[0].id
  return (await post(c, request, 'unidades_medida', { tenant_id: c.tenantId, nombre, simbolo: nombre })).id
}

test.describe('Ocupación de ubicación: LPN, peso y volumen (mutante)', () => {

  test('la vista encuentra la presentación del BULTO, no la duplica con hermanas y no trunca la fracción', async ({ page, request }) => {
    const c = await ctx(page, request)
    const sello = Date.now().toString(36).toUpperCase()
    const cajaId = await empaque(c, request, 'Caja')

    // ── Precondición propia: ubicación vacía + producto con DOS hermanas del mismo empaque ──
    // Hermanas = el caso que hace duplicar un JOIN ingenuo. Se siembran a propósito.
    const ubic = await post(c, request, 'ubicaciones', {
      tenant_id: c.tenantId, sucursal_id: c.sucId, nombre: `CUB-${sello}`,
      // 100×100×100 cm = 1 m³ geométrico. Tope de peso alto para que no interfiera.
      alto_cm: 100, ancho_cm: 100, largo_cm: 100, peso_max_kg: 9999, capacidad_pallets: 99,
    })
    const prod = await post(c, request, 'productos', {
      tenant_id: c.tenantId, nombre: `Cubicaje ${sello}`, sku: `CUB-${sello}`,
      precio_venta: 100, peso_kg: 0.1,
    })

    const base = await completarBase(c, request, prod.id,
      { peso_kg: 0.5, alto_cm: 10, ancho_cm: 10, largo_cm: 10 })
    // Caja-10: 40×30×20 cm = 0.024 m³, pesa 6 kg (más que 10 unidades sueltas: incluye el embalaje).
    await post(c, request, 'producto_presentaciones', {
      tenant_id: c.tenantId, producto_id: prod.id, etiqueta: 'Caja-10', factor_base: 10,
      nombre_empaque_id: cajaId, padre_linea_id: base.id, orden: 1,
      peso_kg: 6, alto_cm: 20, ancho_cm: 30, largo_cm: 40,
    })
    // HERMANA: mismo empaque "Caja", otro factor. Con un JOIN por empaque a secas, cada línea de
    // este producto matchearía DOS presentaciones y se contaría dos veces.
    await post(c, request, 'producto_presentaciones', {
      tenant_id: c.tenantId, producto_id: prod.id, etiqueta: 'Caja-12', factor_base: 12,
      nombre_empaque_id: cajaId, padre_linea_id: base.id, orden: 2,
      peso_kg: 7, alto_cm: 20, ancho_cm: 30, largo_cm: 48,
    })

    // ── Dos LPN en la misma ubicación ────────────────────────────────────────────────────
    // (a) 48 unidades ingresadas en Cajas: NO es múltiplo de ninguna hermana → destapa el truncado.
    await post(c, request, 'inventario_lineas', {
      tenant_id: c.tenantId, producto_id: prod.id, sucursal_id: c.sucId, ubicacion_id: ubic.id,
      lpn: `LPN-CUB-A-${sello}`, cantidad: 48, unidad_medida_id: cajaId, cantidad_uom: 4.8, activo: true,
    })
    // (b) 5 unidades sueltas (sin UoM) → tiene que caer a la presentación BASE.
    await post(c, request, 'inventario_lineas', {
      tenant_id: c.tenantId, producto_id: prod.id, sucursal_id: c.sucId, ubicacion_id: ubic.id,
      lpn: `LPN-CUB-B-${sello}`, cantidad: 5, activo: true,
    })

    const [oc] = await get(c, request,
      `vw_ubicacion_ocupacion?select=*&ubicacion_id=eq.${ubic.id}`)
    expect(oc, '[114] la ubicación sembrada tiene que aparecer en la vista').toBeTruthy()

    // 1️⃣ NO duplica: 2 líneas → 2 LPN, aunque el producto tenga hermanas del mismo empaque.
    expect(oc.lpn_activos, '[114] hermanas del mismo empaque duplicaron la línea').toBe(2)
    expect(oc.lineas_total).toBe(2)

    // 2️⃣ Encuentra la presentación de las DOS líneas (la del bulto y la base).
    expect(oc.lineas_con_volumen, '[114] alguna línea no encontró su presentación → aportaría 0 m³').toBe(2)
    expect(oc.lineas_con_peso).toBe(2)

    // 3️⃣ Volumen exacto, sin truncar:
    //    (a) 48 u ÷ 10 = 4,8 cajas × 0,024 m³ = 0,1152   ← si truncara a 4 daría 0,096
    //    (b) 5 u ÷ 1  = 5 unidades × 0,001 m³ = 0,005
    expect(Number(oc.volumen_m3)).toBeCloseTo(0.1152 + 0.005, 6)

    // 4️⃣ Peso por NIVEL (incluye embalaje), tampoco truncado:
    //    (a) 4,8 × 6 kg = 28,8   ← truncando serían 24 kg: 17% menos en un dato de seguridad física
    //    (b) 5 × 0,5 kg = 2,5
    expect(Number(oc.peso_kg)).toBeCloseTo(28.8 + 2.5, 6)

    // Limpieza: este spec siembra su propia precondición, así que se la lleva.
    for (const t of [
      `inventario_lineas?producto_id=eq.${prod.id}`,
      `producto_presentaciones?producto_id=eq.${prod.id}`,
      `productos?id=eq.${prod.id}`,
      `ubicaciones?id=eq.${ubic.id}`,
    ]) await request.delete(`${SUPABASE_URL}/rest/v1/${t}`, { headers: c.headers })
  })

  test('con el cubicaje activo, la DB rechaza una presentación sin medir (la UI se cachea)', async ({ page, request }) => {
    const c = await ctx(page, request)
    const sello = Date.now().toString(36).toUpperCase()

    const prod = await post(c, request, 'productos', {
      tenant_id: c.tenantId, nombre: `Guard cubicaje ${sello}`, sku: `GCB-${sello}`, precio_venta: 100,
    })
    const restaurar = async (v: boolean) => {
      await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${c.tenantId}`,
        { headers: c.headers, data: { cubicaje_habilitado: v } })
    }
    const [{ cubicaje_habilitado: previo }] = await get(c, request,
      `tenants?select=cubicaje_habilitado&id=eq.${c.tenantId}`)

    try {
      // Apagado: la base sembrada por el trigger existe SIN medidas y nadie se queja — el que no
      // usa el cubicaje no paga el costo de cargarlas.
      const [base] = await get(c, request,
        `producto_presentaciones?select=id,peso_kg&producto_id=eq.${prod.id}&es_base=is.true`)
      expect(base, '[114] el trigger tendría que haber sembrado la base').toBeTruthy()
      expect(base.peso_kg, '[114] con el cubicaje apagado la base nace sin medir').toBeNull()

      await restaurar(true)
      const res = await request.post(`${SUPABASE_URL}/rest/v1/producto_presentaciones`, {
        headers: c.J,
        data: {
          tenant_id: c.tenantId, producto_id: prod.id, etiqueta: 'Caja sin medir', factor_base: 6,
          orden: 1,
        },
      })
      expect(res.ok(), '[114] con el cubicaje activo la DB aceptó una presentación sin medidas').toBe(false)
      expect(await res.text()).toContain('cubicaje')
    } finally {
      await restaurar(previo)
      await request.delete(`${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${prod.id}`, { headers: c.headers })
      await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, { headers: c.headers })
    }
  })
})
