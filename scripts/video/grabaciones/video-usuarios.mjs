// Video "Crear un usuario y su primer ingreso" (pedido de GO 2026-10-06). Guardado para poder repetir la toma.
//
//   node scripts/video/grabaciones/video-usuarios.mjs <carpeta-salida> [<url-app>]
//
// Lee DEV_USUARIOS_MAIL / DEV_USUARIOS_PW de scripts/video/.env.video (negocio "Almacén La Esquina" en Supabase DEV).
// Graba contra la app LOCAL (default http://localhost:5173), que es la que tiene la pantalla de Usuarios nueva.
//
// Dos tomas, cada una en su contexto (la del empleado no puede compartir sesión con la de la dueña):
//   A · la dueña crea a "Lucía Gómez" (usuario lucia, sin email, Cajero), ve la tarjeta con los datos y su panel.
//   B · Lucía entra con código + usuario + contraseña, elige la suya y queda adentro.
// Deja A.webm/B.webm + marcas-A.json/marcas-B.json (corte + marcas) para armar el guion.
//
// ⚠️ ESCRIBE DATOS: crea el usuario "lucia". Para repetir la toma hay que borrarlo antes (o cambiar USUARIO).
// Sin stickers ni sacudidas (GO 06/10): solo cursor dibujado, rótulos y la música.

import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { crearDirector, prepararContexto } from '../director.mjs'

const OUT = process.argv[2]
const APP = process.argv[3] ?? 'http://localhost:5173'
if (!OUT) { console.error('uso: node scripts/video/grabaciones/video-usuarios.mjs <carpeta-salida> [<url-app>]'); process.exit(1) }
const env = readFileSync('scripts/video/.env.video', 'utf8')
const leer = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
const MAIL = leer('DEV_USUARIOS_MAIL'), PW = leer('DEV_USUARIOS_PW')
const CODIGO = 'almacenlaesqui', USUARIO = 'lucia', NOMBRE = 'Lucía Gómez'
const PASS_INICIAL = 'Bienvenida-2026', PASS_NUEVA = 'Lucia-Esquina-77'

// La franja amarilla "Ambiente DEV" no va en un video para clientes.
const SIN_FRANJA = `div.fixed.top-0.bg-amber-400 { display: none !important }`

const b = await chromium.launch({ headless: true })
async function toma(nombre, fn) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: join(OUT, nombre), size: { width: 1280, height: 720 } } })
  await prepararContexto(ctx)
  await ctx.addInitScript((css) => {
    const poner = () => { const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st) }
    if (document.documentElement) poner(); else document.addEventListener('DOMContentLoaded', poner)
  }, SIN_FRANJA)
  const page = await ctx.newPage()
  const dir = crearDirector(page)
  const p = (ms) => page.waitForTimeout(ms)
  try {
    await fn(page, dir, p)
  } finally {
    writeFileSync(join(OUT, `marcas-${nombre}.json`), JSON.stringify(dir.datos(), null, 2))
    await page.screenshot({ path: join(OUT, `fin-${nombre}.png`) }).catch(() => {})
    await ctx.close()
    const webm = readdirSync(join(OUT, nombre)).find(f => f.endsWith('.webm'))
    renameSync(join(OUT, nombre, webm), join(OUT, `${nombre}.webm`))
  }
}
const escribir = async (dir, loc, texto, delay = 95) => {
  await dir.click(loc, { pausa: 200 })
  await loc.first().press('Control+a')
  await loc.first().pressSequentially(texto, { delay })
}

// ── A · la dueña ────────────────────────────────────────────────────────────────────────────────
await toma('A', async (page, dir, p) => {
  // Fuera de cámara: login + tour
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(MAIL)
  await page.locator('input[type="password"]').fill(PW)
  await page.getByRole('button', { name: 'Ingresar' }).click(); await p(6000)
  for (let i = 0; i < 2; i++) {
    const om = page.getByRole('button', { name: /Omitir tour/i }).first()
    if (await om.count().catch(() => 0)) { await om.click().catch(() => {}); await p(800) }
  }
  await page.goto(`${APP}/usuarios`, { waitUntil: 'networkidle' }); await p(3500)
  await dir.mover(900, 380, 6)

  dir.empezar(); dir.marca('inicio'); await p(4200)
  await dir.click(page.getByRole('button', { name: 'Agregar usuario' })); await p(1200)
  dir.marca('alta')
  await dir.click(page.getByRole('button', { name: /Sin email/ })); await p(900)
  await escribir(dir, page.getByPlaceholder('Juan Pérez'), NOMBRE); await p(400)
  await escribir(dir, page.getByPlaceholder('juan', { exact: true }), USUARIO); await p(400)
  await escribir(dir, page.getByPlaceholder(/mínimo \d+ caracteres/), PASS_INICIAL); await p(700)
  dir.marca('rol')
  await dir.click(page.getByRole('button', { name: /^Cajero/ })); await p(1600)
  await dir.click(page.getByRole('button', { name: 'Crear usuario' })); await p(2600)
  dir.marca('tarjeta'); await p(5200)
  await dir.click(page.getByRole('button', { name: 'Listo' })); await p(1800)
  dir.marca('panel')
  const fila = page.locator('div.group').filter({ hasText: NOMBRE }).first()
  await dir.click(fila.getByRole('button', { name: /Editar acceso/ })); await p(1200)
  await page.mouse.wheel(0, 260); await p(3800)
  await dir.click(fila.getByRole('button', { name: 'Cancelar' })); await p(1500)
  dir.marca('finA')
})

// ── B · la empleada ─────────────────────────────────────────────────────────────────────────────
await toma('B', async (page, dir, p) => {
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' }); await p(1500)
  await dir.mover(640, 520, 6)
  dir.empezar(); dir.marca('login'); await p(1600)
  await dir.click(page.getByRole('button', { name: /entrar con usuario/i })); await p(900)
  await escribir(dir, page.getByLabel('Código del negocio'), CODIGO); await p(300)
  await escribir(dir, page.getByLabel('Usuario'), USUARIO); await p(300)
  await escribir(dir, page.getByLabel(/contraseña/i), PASS_INICIAL); await p(600)
  await dir.click(page.getByRole('button', { name: 'Ingresar' })); await p(4200)
  dir.marca('elegir')
  await escribir(dir, page.getByLabel('Contraseña nueva'), PASS_NUEVA); await p(300)
  await escribir(dir, page.getByLabel('Repetila'), PASS_NUEVA); await p(700)
  await dir.click(page.getByRole('button', { name: 'Guardar y entrar' })); await p(5000)
  dir.marca('adentro')
  const om = page.getByRole('button', { name: /Omitir tour/i }).first()
  if (await om.count().catch(() => 0)) { await dir.click(om); await p(1200) }
  await p(4500)
  dir.marca('finB')
})
await b.close()
console.log('ok')
