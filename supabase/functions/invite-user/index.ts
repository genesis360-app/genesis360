import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_URL = 'https://stokio-tau.vercel.app'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, rol, tenant_id } = await req.json()
    if (!email || !rol || !tenant_id) {
      throw new Error('Faltan parámetros: email, rol, tenant_id')
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

    // Verificar que el llamador es OWNER o ADMIN del mismo tenant
    const { data: callerProfile } = await supabaseAdmin
      .from('users')
      .select('rol, tenant_id')
      .eq('id', caller.id)
      .single()

    if (
      !callerProfile ||
      callerProfile.tenant_id !== tenant_id ||
      !['OWNER', 'ADMIN'].includes(callerProfile.rol)
    ) {
      throw new Error('No tenés permisos para invitar usuarios a este negocio')
    }

    // Invitar via Supabase Admin API (envía el email con magic link)
    const { data: invData, error: invError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${APP_URL}/dashboard`,
        data: { tenant_id, rol },
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
