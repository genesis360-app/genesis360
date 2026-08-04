/**
 * 122_cupon_canje_pos_mutante.spec.ts
 * E2E MUTANTE — CUPON-04, 05: canje real del cupón en el carrito del POS (`VentasPage.tsx`).
 *
 * CUPON-04 — orden aritmético (no solo el total final): el cupón ($ fijo) se resta ANTES del
 *   descuento por método de pago (Promo). Se siembra un "Descuento general" del 10% + una promo
 *   del 10% en Efectivo (mismo mecanismo que ya prueba el spec 98, acá combinado con el cupón) y
 *   se verifica que el total sea `(subtotal − desc.general − cupón) × (1 − promo%)`, no
 *   `(subtotal − desc.general) × (1 − promo%) − cupón` (que daría un número distinto — si el
 *   código hubiera invertido el orden, este test lo detecta).
 * CUPON-05 — código inexistente / ya usado / inactivo / vencido: los 4 rechazan con un toast
 *   específico y ninguno queda aplicado al carrito (el input sigue mostrando "Aplicar", nunca la
 *   caja violeta del cupón aplicado).
 *
 * Restaura la config de "Efectivo" en `finally` (mismo patrón que el spec 98) — es un método de
 * pago COMPARTIDO por toda la suite (specs 115/116 cobran en Efectivo asumiendo CERO descuento),
 * así que dejarlo sin revertir rompería specs de otros lotes en la corrida masiva.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta,
  ingresoRealPorUI, irAlPOS, agregarPrimerProductoAlCarrito, totalDelCarrito,
} from './helpers/fixtures'

async function tenantId(request: any, token: string): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/users?select=tenant_id&id=eq.${JSON.parse(atob(token.split('.')[1])).sub}`,
    { headers: restHeaders(token) },
  )
  const rows = await res.json()
  expect(rows.length, '[122] no se pudo resolver el tenant del usuario e2e').toBeGreaterThan(0)
  return rows[0].tenant_id
}

/** Intenta canjear un código que debe RECHAZARSE — verifica el toast y que sigue sin aplicarse. */
async function intentarCuponRechazado(page: any, codigo: string, mensajeEsperado: RegExp, contexto: string) {
  const cuponInput = page.getByPlaceholder('Código de cupón')
  await expect(cuponInput).toBeVisible({ timeout: 8000 })
  await cuponInput.fill(codigo)
  await page.getByRole('button', { name: 'Aplicar' }).click()

  const toastMsg = page.getByText(mensajeEsperado).last()
  await expect(toastMsg, `[122] ${contexto}: se esperaba el toast "${mensajeEsperado}"`).toBeVisible({ timeout: 6000 })
  // Nunca quedó aplicado: el input de código sigue visible (no la caja violeta del cupón aplicado)
  await expect(page.getByPlaceholder('Código de cupón'), `[122] ${contexto}: el cupón NO debe quedar aplicado`).toBeVisible()
  // Esperar a que el toast se retire antes del siguiente intento (evita choques de texto duplicado)
  await expect(toastMsg).not.toBeVisible({ timeout: 8000 }).catch(() => {})
}

test.describe('Cupón — canje real en el carrito del POS (mutante)', () => {
  test('el cupón se resta ANTES del descuento por método de pago — orden aritmético (CUPON-04)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const nombreProducto = `E2E Cupon122 ${ts}`
    const PRECIO = 5000
    const DESC_GENERAL_PCT = 10
    const MONTO_CUPON = 500
    const PROMO_EFECTIVO_PCT = 10
    const CODIGO = `E2E122${ts}`.slice(0, 16).toUpperCase()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const tid = await tenantId(request, token)

    // Estado NUEVO propio del spec — es_disponible_venta=true, sin descuento_pct (aislar el efecto
    // del cupón/promo, igual criterio que los specs 115/116 del lote anterior).
    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers, data: { tenant_id: tid, nombre: `E2E Disponible122 ${ts}`, es_disponible_venta: true },
    })
    expect(estadoRes.ok(), `[122] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoVenta] = (await estadoRes.json()) as Array<{ nombre: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tid, nombre: nombreProducto, sku: `E2E-122-${ts}`,
        precio_costo: PRECIO * 0.6, precio_venta: PRECIO, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[122] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const cuponRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones`, {
      headers, data: {
        tenant_id: tid, nombre: `E2E Cupón 122 ${ts}`, monto: MONTO_CUPON,
        vigencia_desde: '2020-01-01', vigencia_hasta: '2099-12-31', activo: true,
      },
    })
    expect(cuponRes.ok(), `[122] no se pudo crear el cupón: ${await cuponRes.text()}`).toBe(true)
    const [cupon] = (await cuponRes.json()) as Array<{ id: string }>
    const codigoRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones_codigos`, {
      headers, data: { tenant_id: tid, cupon_id: cupon.id, codigo: CODIGO },
    })
    expect(codigoRes.ok(), `[122] no se pudo crear el código: ${await codigoRes.text()}`).toBe(true)

    await ingresoRealPorUI(page, { nombreProducto, cantidad: 5, estadoNombre: estadoVenta.nombre })

    // Promo 10% en Efectivo — mismo mecanismo que el spec 98, guardando el config previo para restaurar
    const metodoRes = await request.get(
      `${SUPABASE_URL}/rest/v1/metodos_pago?select=id,config&tenant_id=eq.${tid}&nombre=eq.Efectivo&limit=1`,
      { headers },
    )
    const metodos = await metodoRes.json()
    expect(metodos.length, '[122] el tenant e2e no tiene método "Efectivo" — precondición de infraestructura').toBeGreaterThan(0)
    const configPrevio = metodos[0].config
    const patchConfig = async (config: any) => {
      const r = await request.patch(`${SUPABASE_URL}/rest/v1/metodos_pago?id=eq.${metodos[0].id}`, { headers, data: { config } })
      expect(r.ok(), `[122] no se pudo patchear metodos_pago.config: ${await r.text()}`).toBeTruthy()
    }
    await patchConfig({ ...(configPrevio ?? {}), descuento: { pct: PROMO_EFECTIVO_PCT, tope: null, dias: null, desde: null, hasta: null } })

    try {
      await garantizarCajaAbierta(page)
      await irAlPOS(page)
      const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
      if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
      await agregarPrimerProductoAlCarrito(page, nombreProducto)

      // "Descuento general" 10% (con descuento ya aplicado, como pide el escenario del plan)
      const descGeneralInput = page.locator('xpath=//label[contains(.,"Descuento general")]/following::input[1]')
      await expect(descGeneralInput).toBeVisible({ timeout: 8000 })
      await descGeneralInput.fill(String(DESC_GENERAL_PCT))
      await descGeneralInput.blur()
      await expect(page.getByText(new RegExp(`Desc\\. general \\(${DESC_GENERAL_PCT}%\\)`))).toBeVisible({ timeout: 5000 })

      // Cupón
      const cuponInput = page.getByPlaceholder('Código de cupón')
      await expect(cuponInput).toBeVisible({ timeout: 8000 })
      await cuponInput.fill(CODIGO)
      await page.getByRole('button', { name: 'Aplicar' }).click()
      await expect(page.getByText(new RegExp(`\\(${CODIGO}\\)`))).toBeVisible({ timeout: 6000 })
      await expect(page.getByText(/🎟 Cupón/)).toBeVisible({ timeout: 6000 })

      // Efectivo — dispara la promo por método de pago (calculada sobre el total YA con cupón restado).
      // 🛑 SIN anclas ^$: al tener promo configurada, la opción se etiqueta "Efectivo · 🏷 10% off"
      // (VentasPage.tsx) — un regex exacto no matchea y cuelga el .selectOption() (mismo criterio
      // que usa el spec 98, que ya siembra esta misma promo).
      const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Efectivo/ }) }).first()
      await tipoSelect.selectOption('Efectivo')
      await expect(page.getByText(new RegExp(`🏷 Promo Efectivo \\(${PROMO_EFECTIVO_PCT}%\\)`))).toBeVisible({ timeout: 5000 })

      // 🛑 El orden importa: (subtotal − desc.general − cupón) × (1 − promo%), NO al revés
      const descGeneralMonto = PRECIO * DESC_GENERAL_PCT / 100
      const totalPrePromoPago = PRECIO - descGeneralMonto
      const totalPostCupon = totalPrePromoPago - MONTO_CUPON
      const totalEsperado = Math.round(totalPostCupon * (1 - PROMO_EFECTIVO_PCT / 100) * 100) / 100
      const totalInvertidoBug = Math.round((totalPrePromoPago * (1 - PROMO_EFECTIVO_PCT / 100) - MONTO_CUPON) * 100) / 100
      expect(totalEsperado, '[122] fixture inválido: el escenario debe distinguir el orden correcto del invertido').not.toBeCloseTo(totalInvertidoBug, 1)

      const total = await totalDelCarrito(page)
      expect(total, `[122] total esperado con el orden correcto (cupón ANTES de la promo): $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)

      const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
      if (await cajaSelect.isVisible().catch(() => false)) {
        const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
        if (values.length > 0) await cajaSelect.selectOption(values[0])
      }
      const montoInput = page.getByPlaceholder(/^Monto$/i).first()
      await montoInput.fill(String(Math.ceil(totalEsperado) + 1000))
      await montoInput.blur()
      await page.waitForTimeout(300)

      const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
      await expect(finalizar).toBeEnabled({ timeout: 5000 })
      await finalizar.click()
      await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

      // POSITIVO en DB: el total persistido honra el mismo orden, y venta_items suma exacto
      const itemsRes = await request.get(
        `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${producto.id}&select=subtotal,ventas(total,cupon_monto,promo_pago)&order=created_at.desc&limit=1`,
        { headers })
      expect(itemsRes.ok(), `[122] no se pudo leer venta_items: ${await itemsRes.text()}`).toBe(true)
      const [item] = (await itemsRes.json()) as Array<{
        subtotal: number
        ventas: { total: number; cupon_monto: number | null; promo_pago: Array<{ metodo: string; pct: number; monto: number }> | null }
      }>
      expect(item, '[122] no se encontró el venta_item recién creado').toBeTruthy()
      expect(item.ventas.total, `[122] ventas.total esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
      expect(item.ventas.cupon_monto, '[122] ventas.cupon_monto debe ser el snapshot del cupón').toBeCloseTo(MONTO_CUPON, 1)
      expect(item.ventas.promo_pago?.[0]?.metodo).toBe('Efectivo')
      expect(item.ventas.promo_pago?.[0]?.pct).toBe(PROMO_EFECTIVO_PCT)
      expect(item.subtotal, `[122] venta_items.subtotal debe sumar EXACTO ventas.total (${totalEsperado})`).toBeCloseTo(totalEsperado, 1)
    } finally {
      await patchConfig(configPrevio ?? {})
    }
  })

  test('código inexistente / ya usado / inactivo / vencido: los 4 rechazan y ninguno queda aplicado (CUPON-05)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const nombreProducto = `E2E Cupon122B ${ts}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const tid = await tenantId(request, token)

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers, data: { tenant_id: tid, nombre: `E2E Disponible122B ${ts}`, es_disponible_venta: true },
    })
    expect(estadoRes.ok(), `[122] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoVenta] = (await estadoRes.json()) as Array<{ nombre: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tid, nombre: nombreProducto, sku: `E2E-122B-${ts}`,
        precio_costo: 600, precio_venta: 1000, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[122] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)

    await ingresoRealPorUI(page, { nombreProducto, cantidad: 3, estadoNombre: estadoVenta.nombre })

    // Una venta REAL cualquiera del tenant, para simular "ya usado en otra venta" (solo hace falta
    // un id válido de ventas — el contenido de esa venta es irrelevante para este escenario).
    const ventaExistenteRes = await request.get(
      `${SUPABASE_URL}/rest/v1/ventas?select=id&tenant_id=eq.${tid}&order=created_at.desc&limit=1`, { headers })
    const [ventaExistente] = (await ventaExistenteRes.json()) as Array<{ id: string }>
    expect(ventaExistente, '[122] el tenant e2e no tiene ninguna venta previa para simular "ya usado" — precondición de infraestructura').toBeTruthy()

    const crearCupon = async (nombre: string, opts: { activo?: boolean; desde?: string; hasta?: string }) => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/cupones`, {
        headers, data: {
          tenant_id: tid, nombre, monto: 300,
          vigencia_desde: opts.desde ?? '2020-01-01', vigencia_hasta: opts.hasta ?? '2099-12-31',
          activo: opts.activo ?? true,
        },
      })
      expect(res.ok(), `[122] no se pudo crear el cupón "${nombre}": ${await res.text()}`).toBe(true)
      return ((await res.json()) as any[])[0]
    }
    const crearCodigo = async (cuponId: string, codigo: string, usadoEnVentaId: string | null = null) => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/cupones_codigos`, {
        headers, data: { tenant_id: tid, cupon_id: cuponId, codigo, usado_en_venta_id: usadoEnVentaId },
      })
      expect(res.ok(), `[122] no se pudo crear el código "${codigo}": ${await res.text()}`).toBe(true)
    }

    const cuponUsado = await crearCupon(`E2E Cupón Usado 122 ${ts}`, {})
    const codUsado = `E2E122U${ts}`.slice(0, 16).toUpperCase()
    await crearCodigo(cuponUsado.id, codUsado, ventaExistente.id)

    const cuponInactivo = await crearCupon(`E2E Cupón Inactivo 122 ${ts}`, { activo: false })
    const codInactivo = `E2E122I${ts}`.slice(0, 16).toUpperCase()
    await crearCodigo(cuponInactivo.id, codInactivo)

    const cuponVencido = await crearCupon(`E2E Cupón Vencido 122 ${ts}`, { desde: '2020-01-01', hasta: '2020-01-31' })
    const codVencido = `E2E122V${ts}`.slice(0, 16).toUpperCase()
    await crearCodigo(cuponVencido.id, codVencido)

    const codInexistente = `E2E122X${ts}`.slice(0, 16).toUpperCase()

    await irAlPOS(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    await agregarPrimerProductoAlCarrito(page, nombreProducto)

    await intentarCuponRechazado(page, codInexistente, /Código de cupón inválido/, 'código inexistente')
    await intentarCuponRechazado(page, codUsado, /Este cupón ya fue usado/, 'código ya usado')
    await intentarCuponRechazado(page, codInactivo, /Este cupón no está vigente/, 'cupón inactivo')
    await intentarCuponRechazado(page, codVencido, /Este cupón no está vigente/, 'cupón vencido')

    // Ningún código quedó marcado como usado (ninguno se aplicó ni se confirmó una venta con ellos)
    const codigosRes = await request.get(
      `${SUPABASE_URL}/rest/v1/cupones_codigos?codigo=in.(${codInactivo},${codVencido})&select=codigo,usado_en_venta_id`, { headers })
    const codigos = (await codigosRes.json()) as Array<{ codigo: string; usado_en_venta_id: string | null }>
    for (const c of codigos) {
      expect(c.usado_en_venta_id, `[122] "${c.codigo}" no debía quedar marcado como usado`).toBeNull()
    }
  })
})
