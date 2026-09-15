/**
 * 152_soporte_consultas_mutante.spec.ts
 * E2E MUTANTE — Ayuda: "Reportar un problema" + Mis consultas (mig 426). Decisiones de GO (2026-09-15): cada usuario
 * ve sus consultas y el DUEÑO/SUPER_USUARIO todas las del negocio; el equipo se entera por mail y por una marca en el
 * panel; el cliente responde desde la app.
 *
 * A · Pantalla (DUEÑO): desde Ayuda se crea una consulta con una captura, queda abierta con la captura en el hilo, se
 *     responde desde la app y al equipo le sale el aviso por mail en los dos casos (interceptado: no sale ningún mail).
 *     Mutación: si la consulta se crea sin adjuntos (`p_adjuntos: []` en soporteApi) el hilo no muestra la captura.
 * B · Servidor (API): el CAJERO y el SUPERVISOR ven y responden solo lo suyo; el DUEÑO ve y responde las de los dos y
 *     abre sus adjuntos; nadie adjunta un archivo de otra carpeta, inexistente o con `..`; las tablas no se leen
 *     directo y sin sesión no hay acceso. Cada negativa tiene su control positivo (lo propio sí anda), para que un
 *     4xx por otra causa no dé verde.
 *
 * Corre con el DUEÑO (chromium) contra DEV, Almacén Jorgito. Las consultas llevan el prefijo "E2E-152" y quedan en
 * DEV: las tablas de soporte no tienen privilegios para los usuarios de la app (a propósito), así que el test no las
 * puede borrar. Tope del servidor: 10 consultas por usuario cada 24 h (el DUEÑO crea 1 por corrida y el cajero y el
 * supervisor, 1 cada uno) — si se corre muchas veces seguidas, borrar las "E2E-152" por SQL.
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { loginToken, restHeaders, SUPABASE_URL, ANON } from './helpers/fixtures'

const PREFIJO = 'E2E-152'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const BUCKET = 'soporte-adjuntos'

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, apikey: ANON! })

type Consulta = { id: string; asunto: string; es_mia: boolean; usuario_nombre: string | null; ultimo_autor: string | null; mensajes: number }
type Detalle = { ticket: { id: string; es_mia: boolean }; mensajes: Array<{ autor_tipo: string; cuerpo: string; adjuntos: Array<{ path: string }> }> }

async function credenciales(request: APIRequestContext, prefijo: string): Promise<string | null> {
  const email = process.env[`E2E_${prefijo}_EMAIL`], pass = process.env[`E2E_${prefijo}_PASSWORD`]
  return email && pass ? loginToken(request, email, pass) : null
}

async function yo(request: APIRequestContext, token: string): Promise<{ id: string; tenantId: string }> {
  const perfil = (await (await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers: auth(token) })).json()) as { id: string }
  const [fila] = (await (await request.get(`${SUPABASE_URL}/rest/v1/users?select=tenant_id&id=eq.${perfil.id}`, { headers: restHeaders(token) })).json()) as { tenant_id: string }[]
  expect(fila?.tenant_id, '[152] no se pudo resolver el negocio del usuario').toBeTruthy()
  return { id: perfil.id, tenantId: fila.tenant_id }
}

const rpc = (request: APIRequestContext, token: string, fn: string, body: Record<string, unknown> = {}) =>
  request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers: restHeaders(token), data: body })

async function mensajeDeError(r: { json: () => Promise<unknown>; text: () => Promise<string> }): Promise<string> {
  try { return ((await r.json()) as { message?: string }).message ?? '' } catch { return await r.text() }
}

const subir = (request: APIRequestContext, token: string, path: string) =>
  request.post(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: { ...auth(token), 'Content-Type': 'image/png' }, data: PNG })
const leer = (request: APIRequestContext, token: string, path: string) =>
  request.get(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: auth(token) })

test.describe('Ayuda — consultas de soporte (mig 426, mutante)', () => {
  test('A · Pantalla: crear con captura desde Ayuda, ver el hilo y responder', async ({ page }) => {
    const avisos: Array<{ type?: string; data?: Record<string, unknown> }> = []
    // El aviso al equipo es un mail real: se intercepta y se registra lo que se habría mandado.
    await page.route('**/functions/v1/send-email', async (route) => {
      avisos.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    const sello = Date.now()
    const asunto = `${PREFIJO} pantalla ${sello}`

    await goto(page, '/ayuda')
    await waitForApp(page)
    await page.getByRole('link', { name: /Reportar un problema/ }).click()
    await expect(page).toHaveURL(/\/ayuda\/consultas\?nueva=1/)

    await page.locator('#consulta-asunto').fill(asunto)
    await page.locator('#consulta-cuerpo').fill('El total del carrito no coincide con la suma de los productos.')
    await page.locator('#consulta-adjuntos').setInputFiles({ name: 'captura-carrito.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByText('captura-carrito.png')).toBeVisible()
    await page.getByRole('button', { name: 'Enviar consulta' }).click()

    await expect(page, '[152] al crearla, aterriza en la consulta').toHaveURL(/\/ayuda\/consultas\?ticket=[0-9a-f-]{36}/, { timeout: 15000 })
    const ticketId = new URL(page.url()).searchParams.get('ticket')!
    const delCliente = page.locator('[data-mensaje-autor="cliente"]')
    await expect(delCliente).toHaveCount(1, { timeout: 10000 })
    await expect(delCliente.first()).toContainText('no coincide con la suma')

    const captura = delCliente.first().getByRole('link', { name: /captura-carrito\.png/ })
    await expect(captura, '[152] la captura queda en el hilo').toBeVisible()
    expect(await captura.getAttribute('href'), '[152] con link firmado del bucket privado').toContain(`/storage/v1/object/sign/${BUCKET}/`)
    await expect(page.locator(`[data-consulta="${ticketId}"]`), '[152] aparece en la lista, en revisión').toContainText('En revisión')

    await page.locator('#consulta-respuesta').fill('Pasa también con otro producto.')
    await page.getByRole('button', { name: 'Responder', exact: true }).click()
    await expect(delCliente, '[152] la respuesta del cliente se suma al hilo').toHaveCount(2, { timeout: 10000 })
    await expect(delCliente.nth(1)).toContainText('Pasa también con otro producto.')

    await expect.poll(() => avisos.length, { message: '[152] al equipo le sale un aviso por la consulta y otro por la respuesta' }).toBeGreaterThanOrEqual(2)
    expect(avisos[0]).toMatchObject({ type: 'soporte_consulta', data: { ticket_id: ticketId, es_respuesta: false } })
    expect(avisos[1]).toMatchObject({ type: 'soporte_consulta', data: { ticket_id: ticketId, es_respuesta: true } })
  })

  test('B · Servidor: cada uno lo suyo, el DUEÑO todo el negocio, adjuntos solo propios', async ({ request }) => {
    const owner = await loginToken(request)
    const cajero = await credenciales(request, 'CAJERO')
    const supervisor = await credenciales(request, 'SUPERVISOR')
    test.skip(!cajero || !supervisor, 'Faltan credenciales de CAJERO/SUPERVISOR en tests/e2e/.env.test.local')

    const [dueno, caj, sup] = [await yo(request, owner), await yo(request, cajero!), await yo(request, supervisor!)]
    expect(caj.tenantId, 'fixture: cajero y dueño en el mismo negocio').toBe(dueno.tenantId)
    expect(sup.tenantId, 'fixture: supervisor y dueño en el mismo negocio').toBe(dueno.tenantId)
    const sello = Date.now()

    // ── Adjuntos: se sube a la carpeta propia, no a la de otro
    const capturaCajero = `${caj.tenantId}/${caj.id}/${sello}-e2e152.png`
    expect((await subir(request, cajero!, capturaCajero)).status(), '[152] el cajero sube a su carpeta').toBe(200)
    expect((await subir(request, cajero!, `${caj.tenantId}/${dueno.id}/${sello}-e2e152.png`)).ok(), '[152] NO sube a la carpeta de otro usuario').toBeFalsy()

    // ── Crear: controles de adjuntos y tipo (cada error revierte, no deja consulta a medias)
    const base = { p_asunto: `${PREFIJO} cajero ${sello}`, p_cuerpo: 'No me deja cerrar la caja.', p_tipo: 'problema', p_urgencia: 'baja', p_modulo: '/caja' }
    const ajeno = await rpc(request, cajero!, 'fn_soporte_crear_consulta', { ...base, p_adjuntos: [{ path: `${caj.tenantId}/${dueno.id}/x.png`, nombre: 'x.png', tipo: 'image/png' }] })
    expect(await mensajeDeError(ajeno), '[152] NO adjunta un archivo de la carpeta de otro').toContain('Adjunto inválido')
    const escape = await rpc(request, cajero!, 'fn_soporte_crear_consulta', { ...base, p_adjuntos: [{ path: `${caj.tenantId}/${caj.id}/../${dueno.id}/x.png`, nombre: 'x.png', tipo: 'image/png' }] })
    expect(await mensajeDeError(escape), '[152] NO adjunta con ".." en la ruta').toContain('Adjunto inválido')
    const fantasma = await rpc(request, cajero!, 'fn_soporte_crear_consulta', { ...base, p_adjuntos: [{ path: `${caj.tenantId}/${caj.id}/no-existe-${sello}.png`, nombre: 'x.png', tipo: 'image/png' }] })
    expect(await mensajeDeError(fantasma), '[152] NO adjunta un archivo que no se subió').toContain('No encontramos el archivo')
    const pago = await rpc(request, cajero!, 'fn_soporte_crear_consulta', { ...base, p_tipo: 'pago' })
    expect(await mensajeDeError(pago), '[152] el tipo "pago" lo pone solo el aviso de transferencia').toContain('Tipo de consulta inválido')

    const creaCajero = await rpc(request, cajero!, 'fn_soporte_crear_consulta', { ...base, p_adjuntos: [{ path: capturaCajero, nombre: 'caja.png', tipo: 'image/png' }] })
    expect(creaCajero.status(), `[152] el cajero crea su consulta: ${await creaCajero.text()}`).toBe(200)
    const ticketCajero = (await creaCajero.json()) as string
    const creaSup = await rpc(request, supervisor!, 'fn_soporte_crear_consulta', { p_asunto: `${PREFIJO} supervisor ${sello}`, p_cuerpo: 'Duda con un ajuste de stock.', p_tipo: 'consulta' })
    expect(creaSup.status(), `[152] el supervisor crea la suya: ${await creaSup.text()}`).toBe(200)
    const ticketSup = (await creaSup.json()) as string

    // ── Listas
    const lista = async (token: string) => (await (await rpc(request, token, 'fn_soporte_mis_consultas')).json()) as Consulta[]
    const [deCajero, deSup, deDueno] = [await lista(cajero!), await lista(supervisor!), await lista(owner)]
    expect(deCajero.find(c => c.id === ticketCajero)?.es_mia, '[152] el cajero ve la suya').toBe(true)
    expect(deCajero.some(c => c.id === ticketSup), '[152] el cajero NO ve la del supervisor').toBe(false)
    expect(deSup.find(c => c.id === ticketSup)?.es_mia, '[152] el supervisor ve la suya').toBe(true)
    expect(deSup.some(c => c.id === ticketCajero), '[152] el supervisor NO ve la del cajero').toBe(false)
    const cajeroParaDueno = deDueno.find(c => c.id === ticketCajero)
    expect(cajeroParaDueno, '[152] el DUEÑO ve la del cajero').toBeTruthy()
    expect(cajeroParaDueno!.es_mia, '[152] ...marcada como de otro').toBe(false)
    expect(cajeroParaDueno!.usuario_nombre, '[152] ...con el nombre de quien la abrió').toBeTruthy()
    expect(deDueno.some(c => c.id === ticketSup), '[152] el DUEÑO ve la del supervisor').toBe(true)

    // ── Detalle
    const verCajero = await rpc(request, cajero!, 'fn_soporte_consulta', { p_ticket_id: ticketCajero })
    expect(verCajero.status(), '[152] el cajero abre la suya').toBe(200)
    const detalle = (await verCajero.json()) as Detalle
    expect(detalle.mensajes).toHaveLength(1)
    expect(detalle.mensajes[0].adjuntos[0]?.path, '[152] con el adjunto validado').toBe(capturaCajero)
    expect(await mensajeDeError(await rpc(request, cajero!, 'fn_soporte_consulta', { p_ticket_id: ticketSup })), '[152] el cajero NO abre la del supervisor').toContain('Consulta no encontrada')
    expect((await rpc(request, owner, 'fn_soporte_consulta', { p_ticket_id: ticketCajero })).status(), '[152] el DUEÑO abre la del cajero').toBe(200)

    // ── Responder
    expect(await mensajeDeError(await rpc(request, cajero!, 'fn_soporte_responder', { p_ticket_id: ticketSup, p_cuerpo: 'intruso' })), '[152] el cajero NO responde la del supervisor').toContain('Consulta no encontrada')
    expect((await rpc(request, cajero!, 'fn_soporte_responder', { p_ticket_id: ticketCajero, p_cuerpo: 'Sigue pasando.' })).status(), '[152] el cajero responde la suya').toBe(200)
    expect((await rpc(request, owner, 'fn_soporte_responder', { p_ticket_id: ticketCajero, p_cuerpo: 'Lo veo yo también.' })).status(), '[152] el DUEÑO responde la del cajero').toBe(200)
    const hilo = (await (await rpc(request, cajero!, 'fn_soporte_consulta', { p_ticket_id: ticketCajero })).json()) as Detalle
    expect(hilo.mensajes.map(m => m.cuerpo), '[152] el hilo tiene los 3 mensajes en orden').toEqual(['No me deja cerrar la caja.', 'Sigue pasando.', 'Lo veo yo también.'])

    // ── Archivos del hilo
    expect((await leer(request, cajero!, capturaCajero)).status(), '[152] el cajero abre su captura').toBe(200)
    expect((await leer(request, owner, capturaCajero)).status(), '[152] el DUEÑO abre la captura del cajero').toBe(200)
    expect((await leer(request, supervisor!, capturaCajero)).ok(), '[152] el SUPERVISOR NO abre la captura del cajero').toBeFalsy()

    // ── Sin atajos: ni la tabla directo ni sin sesión
    expect((await request.get(`${SUPABASE_URL}/rest/v1/support_tickets?select=id&limit=1`, { headers: restHeaders(cajero!) })).ok(), '[152] la tabla NO se lee directo').toBeFalsy()
    expect((await request.get(`${SUPABASE_URL}/rest/v1/support_messages?select=id&limit=1`, { headers: restHeaders(owner) })).ok(), '[152] ni siquiera el DUEÑO lee los mensajes directo').toBeFalsy()
    expect((await rpc(request, ANON!, 'fn_soporte_mis_consultas')).ok(), '[152] sin sesión no hay consultas').toBeFalsy()
  })
})
