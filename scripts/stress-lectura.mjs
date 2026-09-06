#!/usr/bin/env node
/**
 * Sonda de carga de LECTURA — Tanda E (E1 concurrencia · E2 techo de la instancia).
 *
 * Por qué existe: nunca se midió cuántos usuarios concurrentes aguanta Genesis360, con qué tamaño
 * de instancia, ni qué se rompe primero. Con el primer cliente real a la vuelta, eso deja de ser
 * teórico — y ya tenemos el antecedente de la base de DEV cayéndose sola.
 *
 * Qué hace: simula N sesiones concurrentes haciendo el mix de LECTURAS que hace la app al navegar
 * (dashboard, catálogo, ventas, caja, clientes, movimientos), durante S segundos, y reporta
 * p50/p95/p99, RPS y errores por status.
 *
 * 🔒 SOLO GET. No escribe nada. Aun así **agrega carga real** a la instancia que apuntes: corrélo
 * a conciencia y nunca contra PROD con un cliente trabajando.
 *
 * Uso:
 *   node scripts/stress-lectura.mjs                      # 5 usuarios, 20 s (conservador)
 *   node scripts/stress-lectura.mjs --usuarios 20 --segundos 30
 *   node scripts/stress-lectura.mjs --usuarios 50 --segundos 60 --si-se-que-hago   # buscar el techo (E2)
 *
 * Credenciales: `.env.local` (VITE_SUPABASE_URL/ANON_KEY) + `tests/e2e/.env.test.local` (E2E_*).
 */
import fs from 'node:fs'

const TOPE_SIN_CONFIRMAR = 20

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
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def
}

const USUARIOS = arg('usuarios', 5)
const SEGUNDOS = arg('segundos', 20)
const CONFIRMADO = process.argv.includes('--si-se-que-hago')

const app = loadEnv('.env.local')
const e2e = loadEnv('tests/e2e/.env.test.local')
const URL = app.VITE_SUPABASE_URL
const ANON = app.VITE_SUPABASE_ANON_KEY
if (!URL || !ANON) {
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env.local')
  process.exit(1)
}
if (USUARIOS > TOPE_SIN_CONFIRMAR && !CONFIRMADO) {
  console.error(`Más de ${TOPE_SIN_CONFIRMAR} usuarios concurrentes puede saturar la instancia.`)
  console.error('Si es lo que buscás (E2 — techo), volvé a correrlo con --si-se-que-hago')
  process.exit(1)
}
if (/jjffnbrdjchquexdfgwq/.test(URL) && !CONFIRMADO) {
  console.error('🛑 Estás apuntando a PROD. Si de verdad querés, agregá --si-se-que-hago')
  process.exit(1)
}

// Mix de lecturas que hace la app al navegar entre pantallas.
const CONSULTAS = [
  ['catálogo', 'productos?select=id,nombre,sku,precio_venta,stock_actual&activo=eq.true&order=nombre&limit=50'],
  ['ventas recientes', 'ventas?select=id,numero,total,monto_pagado,created_at&order=created_at.desc&limit=20'],
  ['ítems de venta', 'venta_items?select=id,cantidad,precio_unitario,producto_id&limit=50'],
  ['caja', 'caja_sesiones?select=id,estado,monto_apertura&order=created_at.desc&limit=5'],
  ['clientes', 'clientes?select=id,nombre,telefono&order=nombre&limit=50'],
  ['movimientos', 'movimientos_stock?select=id,tipo,cantidad,created_at&order=created_at.desc&limit=50'],
]

async function login(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`)
  return (await r.json()).access_token
}

const CUENTAS = [
  [e2e.E2E_EMAIL, e2e.E2E_PASSWORD],
  [e2e.E2E_SUPERVISOR_EMAIL, e2e.E2E_SUPERVISOR_PASSWORD],
  [e2e.E2E_CAJERO_EMAIL, e2e.E2E_CAJERO_PASSWORD],
  [e2e.E2E_DEPOSITO_EMAIL, e2e.E2E_DEPOSITO_PASSWORD],
  [e2e.E2E_CONTADOR_EMAIL, e2e.E2E_CONTADOR_PASSWORD],
].filter(([e, p]) => e && p)

if (!CUENTAS.length) {
  console.error('No hay credenciales E2E_* en tests/e2e/.env.test.local')
  process.exit(1)
}

// UN login por cuenta y se reusa el token — igual que la app real. Loguear por request
// mediría el rate limit de auth, no la capacidad de la base.
console.log(`Autenticando ${CUENTAS.length} cuenta(s)…`)
const tokens = []
for (const [email, password] of CUENTAS) {
  try { tokens.push(await login(email, password)) } catch (e) { console.error(`  ⚠ ${e.message}`) }
}
if (!tokens.length) { console.error('Ningún login funcionó.'); process.exit(1) }

const muestras = []
const errores = new Map()
let corriendo = true

async function sesion(i) {
  const token = tokens[i % tokens.length]
  const headers = { Authorization: `Bearer ${token}`, apikey: ANON }
  let n = i
  while (corriendo) {
    const [nombre, path] = CONSULTAS[n++ % CONSULTAS.length]
    const t0 = performance.now()
    try {
      const r = await fetch(`${URL}/rest/v1/${path}`, { headers })
      await r.arrayBuffer()
      const ms = performance.now() - t0
      muestras.push({ nombre, ms, ok: r.ok })
      if (!r.ok) errores.set(r.status, (errores.get(r.status) ?? 0) + 1)
    } catch (e) {
      muestras.push({ nombre, ms: performance.now() - t0, ok: false })
      const k = e.cause?.code ?? e.name
      errores.set(k, (errores.get(k) ?? 0) + 1)
    }
  }
}

console.log(`\n▶ ${USUARIOS} sesiones concurrentes · ${SEGUNDOS} s · ${URL.replace(/^https:\/\//, '')}\n`)
const t0 = performance.now()
const sesiones = Array.from({ length: USUARIOS }, (_, i) => sesion(i))
setTimeout(() => { corriendo = false }, SEGUNDOS * 1000)
await Promise.all(sesiones)
const duracion = (performance.now() - t0) / 1000

const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((arr.length * p) / 100))] : 0)
const todas = muestras.map((m) => m.ms).sort((a, b) => a - b)
const fallidas = muestras.filter((m) => !m.ok).length

console.log(`Requests          ${muestras.length}  (${(muestras.length / duracion).toFixed(1)} req/s)`)
console.log(`Errores           ${fallidas}  (${((100 * fallidas) / (muestras.length || 1)).toFixed(2)} %)`)
console.log(`Latencia p50      ${pct(todas, 50).toFixed(0)} ms`)
console.log(`Latencia p95      ${pct(todas, 95).toFixed(0)} ms`)
console.log(`Latencia p99      ${pct(todas, 99).toFixed(0)} ms`)
console.log(`Latencia máx      ${todas.length ? todas[todas.length - 1].toFixed(0) : 0} ms`)

console.log('\nPor consulta (p95):')
for (const [nombre] of CONSULTAS) {
  const l = muestras.filter((m) => m.nombre === nombre).map((m) => m.ms).sort((a, b) => a - b)
  if (l.length) console.log(`  ${nombre.padEnd(18)} n=${String(l.length).padStart(4)}  p50 ${pct(l, 50).toFixed(0).padStart(5)} ms   p95 ${pct(l, 95).toFixed(0).padStart(5)} ms`)
}

if (errores.size) {
  console.log('\nErrores por tipo:')
  for (const [k, v] of [...errores].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
} else {
  console.log('\n✅ Sin errores.')
}
