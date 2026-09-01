import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// invitar-proveedor — Portal de Proveedores (Fede, sección H; ver mig 387/390). El staff carga el
// email desde la ficha del proveedor (ProveedoresPage.tsx) → esta función crea/reusa la cuenta
// externa (`proveedor_accounts`, identidad separada de `users`, ver mig 387) y la vincula al
// tenant+proveedor. La invocación va con verify_jwt (usuario logueado de Genesis360), mismo guard
// de identidad que generar-csr/wa-embedded-signup-exchange: valida que el caller pertenezca al
// tenant_id recibido, ADEMÁS acá exige rol DUEÑO/SUPERVISOR/ADMIN/SUPER_USUARIO (gestionar
// proveedores es más sensible que solo pertenecer al tenant).
//
// Se usa `admin.generateLink({ type: 'magiclink' })` en vez de `type: 'invite'` a propósito: crea
// el usuario si no existe (igual que 'invite') PERO también funciona si ya existe — una misma
// cuenta de proveedor puede estar vinculada a varios negocios (decisión de negocio confirmada,
// mig 387), así que "ya existe" es un caso normal y frecuente, no un error. Nunca se manda el
// email default de Supabase: el link se manda por el `send-email` propio (Resend), mismo patrón ya
// usado por repositores-cierre-dia-sweep/billing-manual-sweep para llamar a otra Edge Function.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const APP_URL = 'https://genesis360.pro'
const ROLES_PERMITIDOS = ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tenant_id, proveedor_id, email } = await req.json()
    if (!tenant_id || !proveedor_id || !email) {
      return json({ error: 'Faltan datos (tenant_id, proveedor_id, email).' }, 400)
    }
    const emailNorm = String(email).trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return json({ error: 'Email inválido.' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Guard de identidad — mismo patrón que wa-embedded-signup-exchange/generar-csr.
    const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: authData, error: authErr } = await supabase.auth.getUser(authToken)
    if (authErr || !authData?.user) return json({ error: 'No autorizado: se requiere un usuario autenticado.' }, 401)
    const { data: membership } = await supabase.from('users')
      .select('rol').eq('id', authData.user.id).eq('tenant_id', tenant_id).maybeSingle()
    if (!membership) return json({ error: 'No autorizado: el usuario no pertenece al negocio indicado.' }, 403)
    if (!ROLES_PERMITIDOS.includes(membership.rol)) {
      return json({ error: 'No autorizado: tu rol no puede invitar proveedores al portal.' }, 403)
    }

    const { data: proveedor } = await supabase.from('proveedores')
      .select('id, nombre, email').eq('id', proveedor_id).eq('tenant_id', tenant_id).maybeSingle()
    if (!proveedor) return json({ error: 'El proveedor no pertenece a este negocio.' }, 404)

    const { data: tenantData } = await supabase.from('tenants').select('nombre').eq('id', tenant_id).single()
    const negocioNombre = tenantData?.nombre ?? 'tu negocio'

    // Crea el usuario si no existe, reusa si ya existe — cubre el caso normal de "proveedor que ya
    // trabaja con otro negocio en Genesis360" sin tratarlo como error.
    const { data: linkData, error: linkGenErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: emailNorm,
      options: { redirectTo: `${APP_URL}/portal-proveedores` },
    })
    if (linkGenErr || !linkData?.user) {
      return json({ error: `No se pudo generar el acceso: ${linkGenErr?.message ?? 'error desconocido'}` }, 500)
    }
    const accountId = linkData.user.id
    const actionLink = linkData.properties?.action_link ?? null

    const { error: accErr } = await supabase.from('proveedor_accounts')
      .upsert({ id: accountId, email: emailNorm, nombre: proveedor.nombre ?? null }, { onConflict: 'id' })
    if (accErr) return json({ error: `No se pudo guardar la cuenta de proveedor: ${accErr.message}` }, 500)

    const { data: yaVinculado } = await supabase.from('proveedor_account_tenants')
      .select('id').eq('tenant_id', tenant_id).eq('proveedor_id', proveedor_id).maybeSingle()

    if (!yaVinculado) {
      const { error: linkErr } = await supabase.from('proveedor_account_tenants')
        .insert({ tenant_id, proveedor_id, proveedor_account_id: accountId })
      if (linkErr) return json({ error: `No se pudo vincular al proveedor: ${linkErr.message}` }, 500)
    }

    // Mantener proveedores.email al día — no bloqueante si falla.
    if (proveedor.email !== emailNorm) {
      await supabase.from('proveedores').update({ email: emailNorm }).eq('id', proveedor_id)
        .then(() => {}, () => {})
    }

    if (actionLink) {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'invitacion_proveedor',
          to: emailNorm,
          data: { negocio: negocioNombre, actionLink },
        }),
      }).catch((e) => console.error('send-email falló:', e))
    }

    return json({ ok: true, ya_vinculado: !!yaVinculado })
  } catch (err: any) {
    console.error('invitar-proveedor error:', err.message)
    return json({ error: err.message }, 500)
  }
})
