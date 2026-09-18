/**
 * 155 — UAT 55.5: un rol custom con Recursos en `editar`/`supervisa` SÍ crea ubicaciones del
 * catálogo; con `ver` no (mutante).
 *
 * Cierra el hueco que dejó el spec 147, que probó los dos extremos por ROL FIJO (DUEÑO 201,
 * SUPERVISOR 403) pero nunca el camino del rol custom — el escenario figuraba como "✅ unit · e2e
 * con usuario de rol custom pendiente".
 *
 * Qué gobierna esto (`auth_puede_editar_modulo`, mig 417 + la policy de `recurso_ubicaciones`):
 *   1. Si el rol custom trae permiso EXPLÍCITO para el módulo, **ese permiso manda** y solo
 *      `'editar'`/`'supervisa'` habilitan (`'supervisa'` es superset de `'editar'`).
 *   2. Recién si no hay permiso explícito se mira el rol base, y `recursos` NO está en la allowlist
 *      de roles fijos → por eso el SUPERVISOR pelado da 403.
 *
 * 🛑 Ojo con la asimetría respecto del spec 125: allá se prueba que un rol custom NO puede AMPLIAR
 * lo que el rol base niega… pero eso vale para la NAVEGACIÓN (`navVisibility`/`AppLayout`). Acá, del
 * lado del servidor, el permiso explícito del rol custom sí habilita. No es una contradicción: son
 * dos capas distintas, y esta es la que protege los datos.
 *
 * Mutante: contra la policy vieja (sin `auth_puede_editar_modulo('recursos')`) el caso `'editar'`
 * seguiría dando 403 y el test falla donde debe.
 *
 * Todo el setup/teardown de `rol_custom_id` corre con el token del OWNER: la policy `users_update_owner`
 * no deja que un SUPERVISOR se toque a sí mismo. El usuario SUPERVISOR es COMPARTIDO por la suite, así
 * que se revierte sí o sí en `finally` y se verifica que haya vuelto a su valor original.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub as string
}

test.describe('Recursos — ubicaciones del catálogo por rol custom (mutante)', () => {
  test('rol custom recursos=editar/supervisa crea ubicaciones; recursos=ver no (55.5)', async ({ page, request }) => {
    test.setTimeout(120000)
    const supEmail = process.env.E2E_SUPERVISOR_EMAIL
    const supPass = process.env.E2E_SUPERVISOR_PASSWORD
    test.skip(!supEmail || !supPass, 'Faltan E2E_SUPERVISOR_EMAIL/PASSWORD en .env.test.local')

    const sello = Date.now()

    // ── Contexto del OWNER (único que puede tocar users.rol_custom_id) ──
    await goto(page, '/dashboard')
    await waitForApp(page)
    const ownerToken = await tokenDesdeBrowser(page)
    const owner = restHeaders(ownerToken)
    const ownerId = decodeJwtSub(ownerToken)
    const meRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${ownerId}&select=tenant_id,rol`, { headers: owner })
    const [me] = (await meRes.json()) as Array<{ tenant_id: string; rol: string }>
    expect(me, '[155] no se pudo resolver el usuario logueado').toBeTruthy()
    expect(me.rol, '[155] este spec necesita el token del DUEÑO (único con UPDATE sobre users)').toBe('DUEÑO')
    const tenantId = me.tenant_id

    // ── El SUPERVISOR real, y su rol_custom_id ACTUAL (para devolvérselo intacto) ──
    const supToken = await loginToken(request, supEmail, supPass)
    const supId = decodeJwtSub(supToken)
    const supRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${supId}&select=id,rol,rol_custom_id`, { headers: owner })
    const [sup] = (await supRes.json()) as Array<{ id: string; rol: string; rol_custom_id: string | null }>
    expect(sup, `[155] no se pudo resolver "${supEmail}" desde la sesión del DUEÑO`).toBeTruthy()
    expect(sup.rol, '[155] el usuario de prueba debía tener rol base SUPERVISOR').toBe('SUPERVISOR')

    // Un solo rol custom: entre casos se le cambia el permiso del módulo, así no queda basura.
    const rolRes = await request.post(`${SUPABASE_URL}/rest/v1/roles_custom`, {
      headers: owner,
      data: { tenant_id: tenantId, nombre: `E2E Rol Recursos 155 ${sello}`, permisos: { recursos: 'editar' }, activo: true },
    })
    expect(rolRes.ok(), `[155] no se pudo crear el rol custom: ${await rolRes.text()}`).toBe(true)
    const rolCustom = ((await rolRes.json()) as Array<{ id: string }>)[0]

    const creadas: string[] = []

    /** Intenta crear una ubicación CON EL TOKEN DEL SUPERVISOR y devuelve el status. */
    const intentarCrear = async (etiqueta: string): Promise<number> => {
      // El id se genera en el cliente: con RLS, un SELECT del registro recién insertado puede no volver.
      const id = crypto.randomUUID()
      const res = await request.post(`${SUPABASE_URL}/rest/v1/recurso_ubicaciones`, {
        headers: restHeaders(supToken),
        data: { id, tenant_id: tenantId, nombre: `E2E RolCustom ${etiqueta} ${sello}` },
      })
      if (res.status() === 201) creadas.push(id)
      return res.status()
    }

    try {
      // ── Control NEGATIVO de partida: sin permiso explícito, el rol base SUPERVISOR no puede.
      await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${sup.id}`, { headers: owner, data: { rol_custom_id: null } })
      expect(
        await intentarCrear('base'),
        '[155] control de partida: el SUPERVISOR sin rol custom NO debe poder crear ubicaciones',
      ).toBe(403)

      // ── recursos: 'editar' → SÍ puede (es la rama que la mig 417 vino a habilitar).
      await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${sup.id}`, { headers: owner, data: { rol_custom_id: rolCustom.id } })
      expect(
        await intentarCrear('editar'),
        '[155] con el rol custom en recursos=editar el SUPERVISOR TIENE que poder crear (mutante: con la policy vieja da 403)',
      ).toBe(201)

      // ── recursos: 'supervisa' → también (superset de 'editar').
      await request.patch(`${SUPABASE_URL}/rest/v1/roles_custom?id=eq.${rolCustom.id}`, {
        headers: owner, data: { permisos: { recursos: 'supervisa' } },
      })
      expect(
        await intentarCrear('supervisa'),
        "[155] 'supervisa' es superset de 'editar': también tiene que poder crear",
      ).toBe(201)

      // ── recursos: 'ver' → NO (solo lectura, aunque el rol custom nombre el módulo).
      await request.patch(`${SUPABASE_URL}/rest/v1/roles_custom?id=eq.${rolCustom.id}`, {
        headers: owner, data: { permisos: { recursos: 'ver' } },
      })
      expect(
        await intentarCrear('ver'),
        "[155] 'ver' es solo lectura: nombrar el módulo en el rol custom NO puede alcanzar para escribir",
      ).toBe(403)
    } finally {
      // Revertir SIEMPRE: el SUPERVISOR lo comparte toda la suite (specs 15/45/47/147 lo asumen limpio).
      await request.patch(`${SUPABASE_URL}/rest/v1/users?id=eq.${sup.id}`, {
        headers: owner, data: { rol_custom_id: sup.rol_custom_id },
      })
      await request.patch(`${SUPABASE_URL}/rest/v1/roles_custom?id=eq.${rolCustom.id}`, { headers: owner, data: { activo: false } })
      for (const id of creadas) {
        await request.delete(`${SUPABASE_URL}/rest/v1/recurso_ubicaciones?id=eq.${id}`, { headers: owner })
      }
    }

    // POSITIVO tras revertir: el usuario compartido quedó exactamente como estaba.
    const verifRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${sup.id}&select=rol_custom_id`, { headers: owner })
    const [verif] = (await verifRes.json()) as Array<{ rol_custom_id: string | null }>
    expect(
      verif.rol_custom_id,
      '🛑 [155] CRÍTICO: el rol_custom_id del SUPERVISOR compartido no volvió a su valor original',
    ).toBe(sup.rol_custom_id)

    // Y no quedó ninguna ubicación de prueba viva en el catálogo.
    const sobras = await request.get(
      `${SUPABASE_URL}/rest/v1/recurso_ubicaciones?nombre=like.*${sello}*&select=id`,
      { headers: owner },
    )
    expect(((await sobras.json()) as unknown[]).length, '[155] quedaron ubicaciones de prueba sin borrar').toBe(0)
  })
})
