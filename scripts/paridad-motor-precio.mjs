// Paridad del MOTOR ÚNICO de precio (mig 467) contra el motor del POS en TypeScript (src/lib/tiers.ts + precioRedondeo.ts).
//
// Por qué existe (REGLA #0): la Fase 3 de B2 mueve el precio del POS al servidor y tiene que dar EXACTAMENTE lo mismo
// que hoy. Este script trae de la base todos los productos con tiers (más los de precio en USD y una muestra del resto),
// los evalúa con el núcleo SQL (`fn_precio_motor_producto` + `fn_precio_redondear`) para muchas cantidades y las tres
// listas (sin forzar / minorista / mayorista), y los compara contra la lógica de `precioTierBase` del POS.
// Solo lectura. Correrlo de nuevo antes de cada cambio al motor (Fase 4: categoría).
//
// Uso:  node --experimental-strip-types scripts/paridad-motor-precio.mjs [project_ref]   (default: DEV)
// Token: SUPABASE_ACCESS_TOKEN (env o .env.local).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { precioBlendedTier, mejorPrecioMayorista } = await import('../src/lib/tiers.ts')
const { redondearPrecio } = await import('../src/lib/precioRedondeo.ts')

const ref = process.argv[2] || 'gcmhzdedrkmmzfzfveig'
const root = resolve(import.meta.dirname, '..')
const envVal = (key) => {
  try { return readFileSync(resolve(root, '.env.local'), 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'))?.[1].trim() }
  catch { return undefined }
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || envVal('SUPABASE_ACCESS_TOKEN')
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN'); process.exit(1) }

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${txt.slice(0, 2000)}`)
  return JSON.parse(txt)
}

const PRODS = `SELECT DISTINCT p.id FROM productos p
  WHERE p.id IN (SELECT producto_id FROM producto_precios_mayorista) OR p.moneda_venta = 'usd'
     OR p.id IN (SELECT id FROM productos ORDER BY id LIMIT 200)`

const [cot] = await q(`SELECT venta FROM fn_cotizacion_bna_vigente('USD')`)
const cotizacion = Number(cot?.venta ?? 0)

const productos = await q(`SELECT p.id, p.tenant_id, p.precio_venta, p.moneda_venta, p.precio_usd, t.precio_redondeo
  FROM productos p JOIN tenants t ON t.id = p.tenant_id WHERE p.id IN (${PRODS})`)
const tiersRows = await q(`SELECT ppm.producto_id, ppm.cantidad_minima, ppm.precio, ppm.operador, ppm.orden, ppm.tipo_valor,
    pp.factor_base FROM producto_precios_mayorista ppm LEFT JOIN producto_presentaciones pp ON pp.id = ppm.presentacion_id
  WHERE ppm.producto_id IN (${PRODS})`)
const factores = await q(`SELECT producto_id, factor_base FROM producto_presentaciones WHERE factor_base > 1 AND producto_id IN (${PRODS})`)

// Mismo armado que el POS (VentasPage, query 'precios-mayorista').
const tiers = {}
for (const r of tiersRows) {
  (tiers[r.producto_id] ??= []).push({
    cantidad_minima: Number(r.cantidad_minima), precio: Number(r.precio), operador: r.operador ?? '>=', orden: r.orden ?? 0,
    tipo_valor: r.tipo_valor ?? 'precio_fijo', presentacion_factor: r.factor_base != null ? Number(r.factor_base) : null,
  })
}
for (const k in tiers) tiers[k].sort((a, b) => a.orden - b.orden)

const MODOS = ['none', '10', '50', '100', '500', '1000']
const base = [...Array(31).keys(), 0.5, 2.5, 10.5, 40, 50, 60, 75, 99, 100, 101, 150, 200, 250, 499, 500, 501, 1000, 5000]
const cantidadesDe = (pid) => {
  const s = new Set(base)
  for (const f of factores.filter(x => x.producto_id === pid)) {
    const fb = Number(f.factor_base)
    for (let k = 1; k <= 4; k++) for (const d of [-1, 0, 1]) if (k * fb + d >= 0) s.add(k * fb + d)
  }
  return [...s]
}

// Lógica de `precioTierBase` + `precioTierEfectivo` del POS.
function precioPOS(p, cantidad, lista) {
  const esUSD = p.moneda_venta === 'usd' && Number(p.precio_usd ?? 0) > 0 && cotizacion > 0
  const precioLista = esUSD ? Math.round(Number(p.precio_usd) * cotizacion * 100) / 100 : Number(p.precio_venta ?? 0)
  const ts = tiers[p.id]
  let precio
  if (!ts || ts.length === 0) precio = precioLista
  else if (lista === 'minorista') precio = precioLista
  else if (lista === 'mayorista') precio = mejorPrecioMayorista(ts, precioLista, cotizacion) ?? precioLista
  else if (!(cantidad > 0)) precio = precioLista
  else precio = precioBlendedTier(ts, cantidad, precioLista, cotizacion)
  return { precioLista, precio: redondearPrecio(precio, p.precio_redondeo) }
}

let casos = 0, difs = 0
const ejemplos = []
const LOTE = 25
for (let i = 0; i < productos.length; i += LOTE) {
  const lote = productos.slice(i, i + LOTE)
  const valores = []
  // Sin lista forzada se prueban además los 6 modos de redondeo (en DEV todos los negocios están en 'none').
  for (const p of lote) for (const c of cantidadesDe(p.id)) for (const l of ['', 'minorista', 'mayorista'])
    for (const m of l ? [p.precio_redondeo ?? 'none'] : MODOS)
      valores.push(`('${p.tenant_id}'::uuid,'${p.id}'::uuid,${c}::numeric,${l ? `'${l}'` : 'NULL'}::text,'${m}'::text)`)
  const filas = await q(`SELECT v.p::text AS producto_id, v.c::float8 AS cantidad, COALESCE(v.l, '') AS lista, v.m AS modo,
      (r->>'precio_lista')::float8 AS precio_lista,
      fn_precio_redondear((r->>'precio_base')::numeric, v.m)::float8 AS precio, r->>'mecanismo' AS mecanismo
    FROM (VALUES ${valores.join(',')}) v(t, p, c, l, m)
    CROSS JOIN LATERAL (SELECT fn_precio_motor_producto(v.t, v.p, v.c, v.l) AS r) x`)
  const porId = Object.fromEntries(lote.map(p => [p.id, p]))
  for (const f of filas) {
    casos++
    const esperado = precioPOS({ ...porId[f.producto_id], precio_redondeo: f.modo }, f.cantidad, f.lista)
    if (Math.abs(esperado.precio - f.precio) > 0.0001 || Math.abs(esperado.precioLista - f.precio_lista) > 0.0001) {
      difs++
      if (ejemplos.length < 15) ejemplos.push({ ...f, pos: esperado })
    }
  }
}

console.log(JSON.stringify({ proyecto: ref, cotizacion, productos: productos.length, casos, diferencias: difs, ejemplos }, null, 2))
process.exit(difs > 0 ? 1 : 0)
