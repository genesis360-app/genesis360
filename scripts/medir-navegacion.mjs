#!/usr/bin/env node
/**
 * Sonda de NAVEGACIÓN — cuántas requests cuesta moverse por la app (palancas 1 y 2 de Capacidad).
 *
 * Por qué existe: el techo de la instancia ya se midió (Tanda E: ~170 req/s, se toca con 20 sesiones,
 * `scripts/stress-lectura.mjs`). Lo que NO existe es un instrumento repetible del otro lado de la
 * ecuación: **cuántas requests consume UN usuario**. El número que hoy cita el wiki (~64 requests por
 * pantalla, 32 `GET /auth/v1/user` en 8 cambios de pantalla) salió de una corrida ad-hoc con Playwright
 * que no quedó guardada, así que no se puede repetir para comparar antes/después de una optimización.
 *
 * Qué mide:
 *   1. NAVEGACIÓN — navega por N pantallas **dentro de la SPA** (clickeando el sidebar, NO recargando
 *      la página: un `goto` re-bootea la app entera y mide otra cosa) y cuenta cada request a Supabase,
 *      agrupada por endpoint. Reporta además los endpoints que se REPITEN entre pantallas, que son
 *      exactamente los que un caché eliminaría.
 *   2. REPOSO — se queda quieto en una pantalla y cuenta el polling (`refetchInterval`), en req/s.
 *
 * 🔒 Solo LECTURA de pantallas: no completa formularios ni confirma nada. Aun así **agrega carga real**
 * a la instancia que apuntes y usa una cuenta real: nunca contra PROD con un cliente trabajando.
 *
 * Uso:
 *   node scripts/medir-navegacion.mjs                          # 8 pantallas + 60 s de reposo en /ventas
 *   node scripts/medir-navegacion.mjs --reposo 120
 *   node scripts/medir-navegacion.mjs --salida antes.json      # guardar para comparar después
 *   node scripts/medir-navegacion.mjs --comparar antes.json    # corre y difea contra una corrida previa
 *
 * Credenciales: `.env.local` (VITE_SUPABASE_URL) + `tests/e2e/.env.test.local` (E2E_EMAIL/E2E_PASSWORD).
 * Reusa la sesión de los e2e (`tests/e2e/.auth/session.json`) y, si venció, vuelve a loguear por UI con
 * el mismo flujo que `auth.setup.ts`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const PROD_REF = 'jjffnbrdjchquexdfgwq'
const SESSION_FILE = 'tests/e2e/.auth/session.json'

function loadEnv(p) {
  const o = {}
  if (!fs.existsSync(p)) return o
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return o
}

function arg(nombre, def) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const app = loadEnv('.env.local')
const e2e = loadEnv('tests/e2e/.env.test.local')
const SUPABASE_URL = app.VITE_SUPABASE_URL
const BASE_URL = process.env.E2E_BASE_URL ?? e2e.E2E_BASE_URL ?? 'http://localhost:5173'
const CONFIRMADO = process.argv.includes('--si-se-que-hago')
const SEGUNDOS_REPOSO = Number(arg('reposo', 60))
// 'spa' = clic en el sidebar, que es lo que hace un usuario · 'recarga' = F5 en cada pantalla, que
// re-bootea la app entera. Dan números MUY distintos y hay que decir con cuál se midió.
const MODO = arg('modo', 'spa')
const SALIDA = arg('salida', null)
const COMPARAR = arg('comparar', null)

if (!SUPABASE_URL) {
  console.error('Falta VITE_SUPABASE_URL en .env.local')
  process.exit(1)
}
if (SUPABASE_URL.includes(PROD_REF) && !CONFIRMADO) {
  console.error('🛑 .env.local apunta a PROD. Si de verdad querés medir ahí, agregá --si-se-que-hago')
  process.exit(1)
}

// Las 8 pantallas del recorrido: las que un dueño/cajero toca en el día, mezclando livianas
// (dashboard) con pesadas (inventario, ventas). El orden importa poco; lo que se mide es el costo
// de CADA cambio de pantalla con la app ya booteada.
const PANTALLAS = [
  ['Dashboard', '/dashboard'],
  ['Productos', '/productos'],
  ['Inventario', '/inventario'],
  ['Ventas (POS)', '/ventas'],
  ['Clientes', '/clientes'],
  ['Caja', '/caja'],
  ['Gastos', '/gastos'],
  ['Reportes', '/reportes'],
]

/** Normaliza una URL de Supabase a un identificador estable para agrupar y comparar corridas. */
function clasificar(url) {
  try {
    const u = new URL(url)
    if (!u.origin.includes(new URL(SUPABASE_URL).host)) return null
    const p = u.pathname
    if (p.startsWith('/auth/v1/')) return p                       // /auth/v1/user, /auth/v1/token
    if (p.startsWith('/rest/v1/rpc/')) return `rpc:${p.slice('/rest/v1/rpc/'.length)}`
    if (p.startsWith('/rest/v1/')) return `rest:${p.slice('/rest/v1/'.length)}`
    if (p.startsWith('/storage/v1/')) return 'storage'
    if (p.startsWith('/functions/v1/')) return `fn:${p.slice('/functions/v1/'.length)}`
    return p
  } catch { return null }
}

/** Espera a que la pantalla deje de pedir: red quieta + un colchón para los refetch tardíos. */
async function asentar(page, colchonMs = 2500) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(colchonMs)
}

const contador = new Map()
let capturando = null   // etiqueta de la fase actual; null = no contar

function contar(url) {
  const clave = clasificar(url)
  if (!clave || !capturando) return
  const porFase = contador.get(capturando) ?? new Map()
  porFase.set(clave, (porFase.get(clave) ?? 0) + 1)
  contador.set(capturando, porFase)
}

const navegador = await chromium.launch()
const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined
const contexto = await navegador.newContext({ baseURL: BASE_URL, storageState })
const page = await contexto.newPage()
page.on('request', r => contar(r.url()))

console.log(`Midiendo contra ${BASE_URL} → ${new URL(SUPABASE_URL).host}`)

// ── Arranque: la sesión guardada de los e2e puede haber vencido ──────────────────────────────
await page.goto('/dashboard')
await asentar(page)

if (new URL(page.url()).pathname.startsWith('/login')) {
  const email = e2e.E2E_EMAIL, password = e2e.E2E_PASSWORD
  if (!email || !password) {
    console.error('La sesión guardada venció y faltan E2E_EMAIL/E2E_PASSWORD en tests/e2e/.env.test.local')
    process.exit(1)
  }
  console.log('Sesión vencida — logueando de nuevo…')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.evaluate(() => localStorage.setItem('genesis360_walkthrough_v1', 'seen'))
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true })
  await contexto.storageState({ path: SESSION_FILE })
  await asentar(page)
}

// El tour de bienvenida tapa la pantalla y frena los clicks del sidebar.
await page.evaluate(() => localStorage.setItem('genesis360_walkthrough_v1', 'seen'))

/**
 * Navega DENTRO de la SPA. Clickear el link real del sidebar es lo que hace un usuario; si el link
 * no está (permisos, menú colapsado) cae a la API de history, que React Router escucha por `popstate`.
 * Nunca usa `page.goto`: eso recarga la app entera y mediría el arranque, no el cambio de pantalla.
 */
async function navegarSpa(ruta) {
  if (MODO === 'recarga') {
    // Abrir la pantalla DE CERO (F5): re-bootea todo — auth, layout y todas las queries. No es lo
    // que hace un usuario navegando, pero sirve para contrastar contra mediciones viejas.
    await page.goto(ruta)
    await asentar(page)
    return
  }
  const link = page.locator(`aside a[href="${ruta}"]`).first()
  if (await link.isVisible().catch(() => false)) {
    await link.click()
  } else {
    await page.evaluate(r => {
      window.history.pushState({}, '', r)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, ruta)
  }
  await page.waitForFunction(r => window.location.pathname === r, ruta, { timeout: 15000 }).catch(() => {})
  await asentar(page)
}

// ── Fase 1 — navegación ──────────────────────────────────────────────────────────────────────
console.log(`\n① Navegación (${PANTALLAS.length} pantallas, modo ${MODO})\n`)
// Arrancar desde una pantalla que NO esté en la lista: si la primera del recorrido es la que ya
// está abierta, "navegar" a ella no pide nada y se mide un 0 que no es real.
await navegarSpa('/historial')
for (const [nombre, ruta] of PANTALLAS) {
  capturando = nombre
  await navegarSpa(ruta)
  capturando = null
  const total = [...(contador.get(nombre) ?? new Map()).values()].reduce((a, b) => a + b, 0)
  console.log(`  ${nombre.padEnd(14)} ${String(total).padStart(4)} requests`)
}

// ── Fase 2 — reposo ──────────────────────────────────────────────────────────────────────────
console.log(`\n② Reposo en el POS (${SEGUNDOS_REPOSO} s, sin tocar nada)\n`)
await navegarSpa('/ventas')
capturando = 'REPOSO'
const t0 = Date.now()
await page.waitForTimeout(SEGUNDOS_REPOSO * 1000)
const segundosReales = (Date.now() - t0) / 1000
capturando = null

// ── Informe ──────────────────────────────────────────────────────────────────────────────────
const porPantalla = {}
for (const [nombre] of PANTALLAS) {
  porPantalla[nombre] = Object.fromEntries(contador.get(nombre) ?? new Map())
}
const reposo = Object.fromEntries(contador.get('REPOSO') ?? new Map())

const totalNav = Object.values(porPantalla).reduce(
  (s, m) => s + Object.values(m).reduce((a, b) => a + b, 0), 0)
const totalReposo = Object.values(reposo).reduce((a, b) => a + b, 0)

// Lo que un caché eliminaría: el mismo endpoint pedido de nuevo en cada pantalla.
const repetidos = new Map()
for (const m of Object.values(porPantalla)) {
  for (const [k, v] of Object.entries(m)) {
    const r = repetidos.get(k) ?? { pantallas: 0, total: 0 }
    repetidos.set(k, { pantallas: r.pantallas + 1, total: r.total + v })
  }
}
const topRepetidos = [...repetidos.entries()]
  .filter(([, r]) => r.pantallas > 1)
  .sort((a, b) => b[1].total - a[1].total)
  .slice(0, 15)

console.log('\n─────────────────────────────────────────────')
console.log(`Navegación: ${totalNav} requests en ${PANTALLAS.length} pantallas ` +
            `(${(totalNav / PANTALLAS.length).toFixed(1)} por pantalla)`)
console.log(`Reposo:     ${totalReposo} requests en ${segundosReales.toFixed(0)} s ` +
            `(${(totalReposo / segundosReales).toFixed(2)} req/s)`)

console.log('\nEndpoints repetidos entre pantallas (lo que un caché ahorraría):')
console.log('  pantallas  total  endpoint')
for (const [k, r] of topRepetidos) {
  console.log(`  ${String(r.pantallas).padStart(9)}  ${String(r.total).padStart(5)}  ${k}`)
}

console.log('\nPolling en reposo:')
for (const [k, v] of Object.entries(reposo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`)
}

const informe = {
  fecha: new Date().toISOString(),
  base_url: BASE_URL,
  modo: MODO,
  supabase: new URL(SUPABASE_URL).host,
  navegacion: { total: totalNav, por_pantalla: porPantalla, promedio: totalNav / PANTALLAS.length },
  reposo: { segundos: segundosReales, total: totalReposo, req_s: totalReposo / segundosReales, detalle: reposo },
}

if (SALIDA) {
  fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2))
  console.log(`\n💾 Guardado en ${SALIDA}`)
}

if (COMPARAR && fs.existsSync(COMPARAR)) {
  const antes = JSON.parse(fs.readFileSync(COMPARAR, 'utf8'))
  const dNav = totalNav - antes.navegacion.total
  const dRep = informe.reposo.req_s - antes.reposo.req_s
  const pct = antes.navegacion.total ? (dNav / antes.navegacion.total) * 100 : 0
  console.log(`\n📊 Contra ${COMPARAR} (${antes.fecha}):`)
  console.log(`  Navegación: ${antes.navegacion.total} → ${totalNav} (${dNav >= 0 ? '+' : ''}${dNav}, ${pct.toFixed(1)} %)`)
  console.log(`  Reposo:     ${antes.reposo.req_s.toFixed(2)} → ${informe.reposo.req_s.toFixed(2)} req/s (${dRep >= 0 ? '+' : ''}${dRep.toFixed(2)})`)
}

await navegador.close()
