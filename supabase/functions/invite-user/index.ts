import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 🛑 REGLA #0 (aislamiento multi-tenant): roles que un tenant PUEDE asignar. ADMIN NO
// está — es rol de STAFF de Genesis360 (is_admin() → ve TODOS los tenants). Sin este
// whitelist, un DUEÑO podía invitar con rol:'ADMIN' por API directa y escalar a admin
// de plataforma. Espejo del selector de UsuariosPage; reforzado por trigger en DB (mig 254).
const ROLES_ASIGNABLES = ['DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CAJERO', 'RRHH', 'CONTADOR', 'DEPOSITO', 'VIEWER']

// Alcance con el que NACE un usuario (2026-10-06). Antes no se seteaba: todo usuario nuevo quedaba restringido y SIN
// sucursal — un Cajero "Sin sucursal asignada" aunque el negocio tuviera una sola, y un Supervisor restringido aunque
// su rol ve todo. Espejo de src/lib/accesoUsuario.ts (ROLES_SIEMPRE_GLOBALES + ROLES_GLOBAL_DEFAULT).
const ROLES_VEN_TODO = ['DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CONTADOR', 'VIEWER']
async function alcanceInicial(
  admin: any, tenantId: string, rol: string, sucursalPedida: unknown,
): Promise<{ puede_ver_todas: boolean; sucursal_id: string | null } | { error: string }> {
  if (ROLES_VEN_TODO.includes(rol)) return { puede_ver_todas: true, sucursal_id: null }
  const { data: sucs } = await admin.from('sucursales').select('id').eq('tenant_id', tenantId).eq('activo', true)
  const ids: string[] = (sucs ?? []).map((s: { id: string }) => s.id)
  if (typeof sucursalPedida === 'string' && sucursalPedida) {
    // La sucursal viene del cliente: tiene que ser de ESTE negocio.
    if (!ids.includes(sucursalPedida)) return { error: 'La sucursal elegida no es de este negocio' }
    return { puede_ver_todas: false, sucursal_id: sucursalPedida }
  }
  if (ids.length === 1) return { puede_ver_todas: false, sucursal_id: ids[0] }
  // Con varias sucursales es obligatoria (GO 06/10): un empleado restringido sin sucursal no ve nada útil.
  if (ids.length > 1) return { error: 'Elegí en qué sucursal trabaja' }
  return { puede_ver_todas: false, sucursal_id: null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { email, rol, tenant_id, redirect_to } = body
    // El frontend envía su propia URL — funciona en localhost, DEV y PROD sin config extra
    const redirectTo = redirect_to ?? 'https://app.genesis360.pro/dashboard'
    if (!email || !rol || !tenant_id) {
      throw new Error('Faltan parámetros: email, rol, tenant_id')
    }
    if (!ROLES_ASIGNABLES.includes(rol)) {
      throw new Error('Rol inválido')  // bloquea ADMIN / cualquier rol no asignable por un tenant
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

    // Verificar que el llamador está autenticado
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No autorizado')

    const supabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller } } = await supabaseClient.auth.getUser()
    if (!caller) throw new Error('No autorizado')

    // Cliente admin con service role
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verificar que el llamador es DUEÑO o ADMIN del mismo tenant
    const { data: callerProfile } = await supabaseAdmin
      .from('users')
      .select('rol, tenant_id')
      .eq('id', caller.id)
      .single()

    if (
      !callerProfile ||
      callerProfile.tenant_id !== tenant_id ||
      !['DUEÑO', 'ADMIN'].includes(callerProfile.rol)
    ) {
      throw new Error('No tenés permisos para invitar usuarios a este negocio')
    }

    // El nombre del negocio va en los datos del usuario para que la plantilla del correo diga a qué lo invitan
    // ({{ .Data.negocio }}, supabase/templates/invite.html).
    const { data: tenantRow } = await supabaseAdmin.from('tenants').select('nombre').eq('id', tenant_id).single()

    // La sucursal se valida ANTES de mandar el correo: si falta, no sale una invitación sin perfil.
    const alcance = await alcanceInicial(supabaseAdmin, tenant_id, rol, body?.sucursal_id)
    if ('error' in alcance) throw new Error(alcance.error)

    // Invitar via Supabase Admin API (envía el email con magic link)
    const { data: invData, error: invError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo,
        data: { tenant_id, rol, negocio: tenantRow?.nombre ?? '' },
      }
    )
    if (invError) throw new Error(invError.message)

    // Pre-crear perfil para que no pase por onboarding al aceptar

    const { error: profileError } = await supabaseAdmin.from('users').upsert(
      {
        id: invData.user.id,
        tenant_id,
        rol,
        nombre_display: email.split('@')[0],
        activo: true,
        // 2026-10-05: el link de invitación inicia sesión UNA vez y nunca pedía contraseña; quien no usa Google
        // (Hotmail, Outlook, correo de empresa) después no podía volver a entrar. Con la marca, el AuthGuard le pide
        // elegir una al entrar por el link (la baja solo la hace la EF usuarios-sin-correo, junto con el cambio).
        debe_cambiar_password: true,
        ...alcance,
      },
      { onConflict: 'id' }
    )
    if (profileError) throw new Error(profileError.message)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Error desconocido' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
