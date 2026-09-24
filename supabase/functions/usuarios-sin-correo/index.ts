// usuarios-sin-correo — crear y administrar empleados que entran con NOMBRE y CONTRASEÑA (mig 434)
//
// Por qué no alcanza con `invite-user`: esa función usa `inviteUserByEmail`, que manda un magic link
// a una casilla real. En un negocio chico los empleados no tienen mail propio, así que el dueño
// terminaba inventando direcciones o usando la suya para todos.
//
// Acá el dueño pone un usuario y una contraseña, y la cuenta se crea con `admin.createUser`, sin
// invitación y sin mandar un solo correo. La identidad de Auth es una dirección que nunca recibe
// nada: `<usuario>.<codigo del negocio>@u.genesis360.pro`.
//
// 🛑 La dirección se compone SIEMPRE con el `codigo` que sale de la base, nunca con uno que mande el
// cliente: si no, un dueño podría crear usuarios dentro del negocio de otro.
//
// ⚠️ Las reglas de formato y el dominio están duplicados en `src/lib/usuarioLocal.ts` (Deno no puede
// importar de `src/`). Si cambian de un lado, cambian del otro. Manda este lado.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { consumirRateLimit, ipDelCliente, respuesta429 } from '../_shared/rateLimit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 🛑 REGLA #0 (aislamiento multi-tenant): mismo whitelist que `invite-user`. ADMIN NO está — es rol
// de STAFF de Genesis360 (`is_admin()` ve TODOS los negocios). Reforzado por trigger en DB (mig 254).
const ROLES_ASIGNABLES = ['DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CAJERO', 'RRHH', 'CONTADOR', 'DEPOSITO', 'VIEWER']

const DOMINIO_USUARIOS_INTERNOS = 'u.genesis360.pro'
const RE_USUARIO = /^[a-z0-9][a-z0-9_-]{2,29}$/   // espejo de users_usuario_formato (mig 434)
const PASSWORD_MIN = 8

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Antes de tocar nada: un tope por IP. Todas las acciones piden sesión válida, pero un token
    // robado no debería poder barrer contraseñas a mano alzada.
    const rl = await consumirRateLimit(supabaseAdmin, 'usuarios-sin-correo', ipDelCliente(req), 20, 60)
    if (!rl.permitido) {
      return respuesta429(rl, 'Demasiados intentos. Esperá un minuto y probá de nuevo.', corsHeaders)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const supabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller } } = await supabaseClient.auth.getUser()
    if (!caller) return json({ error: 'No autorizado' }, 401)

    const body = await req.json()
    const accion = body?.accion

    // ═══════════════════════════════════════════════════════════════════════════
    // cambiar-password-propia — el cambio obligatorio del primer ingreso
    //
    // Va primero porque es la única acción que NO exige ser dueño: la hace el propio empleado.
    //
    // 🛑 Cambia la contraseña y baja `debe_cambiar_password` en la MISMA llamada, con service_role.
    // Si fueran dos pasos separados (updateUser del lado del cliente + un RPC que baja la bandera),
    // alcanzaba con llamar al segundo y saltearse el cambio, quedándose con la contraseña que el
    // dueño ya conoce. Por eso `users` no tiene policy de UPDATE para uno mismo.
    // ═══════════════════════════════════════════════════════════════════════════
    if (accion === 'cambiar-password-propia') {
      const password = String(body?.password ?? '')
      if (password.length < PASSWORD_MIN) {
        return json({ error: `La contraseña necesita al menos ${PASSWORD_MIN} caracteres` }, 400)
      }

      const { error: passErr } = await supabaseAdmin.auth.admin.updateUserById(caller.id, { password })
      if (passErr) return json({ error: passErr.message }, 400)

      const { error: flagErr } = await supabaseAdmin
        .from('users').update({ debe_cambiar_password: false }).eq('id', caller.id)
      if (flagErr) return json({ error: flagErr.message }, 400)

      return json({ success: true })
    }

    // ── De acá para abajo hay que ser DUEÑO (o ADMIN) del negocio ──────────────
    const { data: callerProfile } = await supabaseAdmin
      .from('users').select('rol, tenant_id, activo').eq('id', caller.id).single()

    // `activo` es NULLABLE: NULL significa activo (mismo criterio que la mig 433).
    if (!callerProfile || callerProfile.activo === false) return json({ error: 'No autorizado' }, 403)
    if (!['DUEÑO', 'ADMIN'].includes(callerProfile.rol)) {
      return json({ error: 'Solo el dueño del negocio puede administrar usuarios' }, 403)
    }
    const tenantId = callerProfile.tenant_id   // del perfil del llamador, NO del body

    // ═══════════════════════════════════════════════════════════════════════════
    // crear — alta de un empleado sin correo
    // ═══════════════════════════════════════════════════════════════════════════
    if (accion === 'crear') {
      const usuario = String(body?.usuario ?? '').trim().toLowerCase()
      const nombre = String(body?.nombre ?? '').trim()
      const rol = String(body?.rol ?? '')
      const password = String(body?.password ?? '')

      if (!RE_USUARIO.test(usuario)) {
        return json({ error: 'El usuario solo puede tener letras sin tilde, números, guion y guion bajo (3 a 30 caracteres)' }, 400)
      }
      if (!ROLES_ASIGNABLES.includes(rol)) return json({ error: 'Rol inválido' }, 400)
      if (password.length < PASSWORD_MIN) {
        return json({ error: `La contraseña necesita al menos ${PASSWORD_MIN} caracteres` }, 400)
      }

      // El código sale de la base. Es la mitad de la identidad y no se acepta del cliente.
      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from('tenants').select('codigo').eq('id', tenantId).single()
      if (tenantErr || !tenant?.codigo) return json({ error: 'No se pudo resolver el código del negocio' }, 400)

      // El índice único lo atajaría igual, pero con un error de Postgres que el dueño no entiende.
      const { data: yaExiste } = await supabaseAdmin
        .from('users').select('id').eq('tenant_id', tenantId).eq('usuario', usuario).maybeSingle()
      if (yaExiste) return json({ error: `Ya hay un usuario "${usuario}" en este negocio` }, 400)

      const email = `${usuario}.${tenant.codigo}@${DOMINIO_USUARIOS_INTERNOS}`

      const { data: creado, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,           // no hay casilla que confirmar: la dirección no recibe nada
        user_metadata: { tenant_id: tenantId, rol, usuario },
      })
      if (createErr || !creado?.user) {
        return json({ error: createErr?.message ?? 'No se pudo crear la cuenta' }, 400)
      }

      const { error: profileErr } = await supabaseAdmin.from('users').insert({
        id: creado.user.id,
        tenant_id: tenantId,
        rol,
        nombre_display: nombre || usuario,
        usuario,
        activo: true,
        debe_cambiar_password: true,   // la contraseña del dueño es de un solo uso
      })

      if (profileErr) {
        // 🛑 Sin esto queda un usuario huérfano en `auth.users` que se queda con la dirección para
        // siempre: el dueño reintenta con el mismo nombre y le dice "ya existe" sin que aparezca en
        // ningún lado. Pasa de verdad cuando el negocio llegó al límite de usuarios del plan, que
        // es justo el error que el trigger `trg_enforce_usuarios` tira en este INSERT.
        await supabaseAdmin.auth.admin.deleteUser(creado.user.id)
        return json({ error: profileErr.message }, 400)
      }

      return json({ success: true, usuario, codigo_negocio: tenant.codigo })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // resetear-password — el empleado se la olvidó y no hay casilla donde mandarle un link
    // ═══════════════════════════════════════════════════════════════════════════
    if (accion === 'resetear-password') {
      const userId = String(body?.user_id ?? '')
      const password = String(body?.password ?? '')
      if (password.length < PASSWORD_MIN) {
        return json({ error: `La contraseña necesita al menos ${PASSWORD_MIN} caracteres` }, 400)
      }

      const { data: target } = await supabaseAdmin
        .from('users').select('id, tenant_id, usuario').eq('id', userId).maybeSingle()

      if (!target || target.tenant_id !== tenantId) {
        return json({ error: 'Ese usuario no es de este negocio' }, 403)
      }
      // 🛑 Solo las cuentas SIN correo. Una cuenta con casilla real es de una persona que se
      // autentica con su propia dirección (o con Google): dejar que el dueño del negocio le pise la
      // contraseña sería quedarse con su cuenta, no administrar un empleado. Esas se recuperan por
      // "olvidé mi contraseña", que les llega a ellas.
      if (!target.usuario) {
        return json({ error: 'Ese usuario entra con su propio correo: tiene que recuperarla desde "Olvidé mi contraseña"' }, 400)
      }

      const { error: passErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
      if (passErr) return json({ error: passErr.message }, 400)

      // Vuelve a ser una contraseña de un solo uso.
      const { error: flagErr } = await supabaseAdmin
        .from('users').update({ debe_cambiar_password: true }).eq('id', userId)
      if (flagErr) return json({ error: flagErr.message }, 400)

      return json({ success: true })
    }

    return json({ error: 'Acción desconocida' }, 400)
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error desconocido'
    return json({ error: mensaje }, 400)
  }
})
