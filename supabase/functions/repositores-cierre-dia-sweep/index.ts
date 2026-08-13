import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// J1/J2 del relevamiento de Repositores (quedaron fuera del alcance del módulo original,
// retomados 2026-08-12 a pedido de GO). pg_cron no está habilitado en el proyecto — este sweep lo
// dispara GitHub Actions cada 15 minutos (mismo molde que repricing-sweep/billing-manual-sweep).
//
// J1: notificación DENTRO del sistema únicamente (tabla `notificaciones`, sin push a dispositivo —
// eso queda para cuando exista app móvil, fuera de alcance).
// J2: si quedan tareas de Repositores sin completar al "cierre del día", alerta directa a
// supervisor/dueño con el conteo, por notificación interna Y mail (ya existe la infra — `send-email`
// vía Resend, mismo patrón que `billing-manual-sweep`: resolver el email real por
// `auth.admin.getUserById`, nunca hardcodeado).
//
// "Cierre del día" es CONFIGURABLE POR SUCURSAL (decisión de GO, 2026-08-12) — reusa
// `sucursales.horario_cierre`, que YA EXISTÍA (SucursalesPage.tsx, mig 124), sin migración nueva.
// Default 21:00 si una sucursal no lo configuró. Corre cada 15 min y compara contra la hora
// Argentina real (America/Argentina/Buenos_Aires) — evalúa "¿ya pasamos el horario de cierre de
// HOY?", no dispara al segundo exacto (no hay cron por-fila en este proyecto).
//
// Dedupe: no agrega ninguna columna nueva — reusa `notificaciones` mismo (busca si ya existe una
// fila de tipo 'repositor_cierre_dia' para esa sucursal con created_at de HOY antes de mandar otra).
// Cubre AMBOS tipos de trabajo del módulo (decisión de GO): cambio de precio/etiqueta
// (`tareas_repositor`) y reposición física a góndola (`wms_tareas` tipo='reposicion_gondola').

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const HORARIO_CIERRE_DEFAULT = '21:00:00'
const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires'

function horaArgentinaActual(): { hhmm: string; fechaISO: string } {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const partes = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  return { hhmm: `${partes.hour}:${partes.minute}`, fechaISO: `${partes.year}-${partes.month}-${partes.day}` }
}

async function emailUsuario(admin: any, userId: string, titulo: string, mensaje: string, actionUrl: string) {
  const { data: au } = await admin.auth.admin.getUserById(userId)
  const email = au?.user?.email
  if (!email) return
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'notificacion', to: email, data: { titulo, mensaje, action_url: actionUrl } }),
  }).catch(() => {})
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { hhmm: horaActual, fechaISO: hoy } = horaArgentinaActual()

    const { data: sucursales, error: sErr } = await admin.from('sucursales')
      .select('id, tenant_id, nombre, horario_cierre, tenants!inner(modo_operacion)')
      .eq('activo', true)
      .eq('tenants.modo_operacion', 'avanzado')
    if (sErr) throw new Error(`sucursales: ${sErr.message}`)

    let sucursalesProcesadas = 0
    let sucursalesNotificadas = 0
    const errores: string[] = []

    for (const s of sucursales ?? []) {
      const horarioCierre = (s.horario_cierre ?? HORARIO_CIERRE_DEFAULT) as string
      // horario_cierre viene "HH:MM:SS" — comparar solo HH:MM contra la hora Argentina actual.
      if (horaActual < horarioCierre.slice(0, 5)) continue
      sucursalesProcesadas++

      // Dedupe: ¿ya se avisó esta sucursal hoy?
      const inicioHoyUTC = new Date(`${hoy}T00:00:00-03:00`).toISOString()
      const { data: yaAvisado } = await admin.from('notificaciones')
        .select('id').eq('tenant_id', s.tenant_id).eq('tipo', 'repositor_cierre_dia')
        .contains('metadata', { sucursal_id: s.id })
        .gte('created_at', inicioHoyUTC).limit(1).maybeSingle()
      if (yaAvisado) continue

      const [{ count: countCarteles }, { count: countReposicion }] = await Promise.all([
        admin.from('tareas_repositor').select('id', { count: 'exact', head: true })
          .eq('tenant_id', s.tenant_id).eq('sucursal_id', s.id).in('estado', ['pendiente', 'en_curso']),
        admin.from('wms_tareas').select('id', { count: 'exact', head: true })
          .eq('tenant_id', s.tenant_id).eq('sucursal_id', s.id).eq('tipo', 'reposicion_gondola')
          .in('estado', ['pendiente', 'en_curso']),
      ])
      const totalPendientes = (countCarteles ?? 0) + (countReposicion ?? 0)
      if (totalPendientes === 0) continue

      const { data: supervisores, error: supErr } = await admin
        .rpc('fn_usuarios_supervisan_modulo', { p_tenant_id: s.tenant_id, p_modulo: 'repositores' })
      if (supErr) { errores.push(`${s.id}: ${supErr.message}`); continue }
      if (!supervisores || supervisores.length === 0) continue

      const titulo = `Repositores — ${totalPendientes} tarea${totalPendientes === 1 ? '' : 's'} sin completar al cierre`
      const detalle: string[] = []
      if (countCarteles) detalle.push(`${countCarteles} cartel${countCarteles === 1 ? '' : 'es'} de precio`)
      if (countReposicion) detalle.push(`${countReposicion} reposición${countReposicion === 1 ? '' : 'es'} física`)
      const mensaje = `En "${s.nombre}" quedaron ${detalle.join(' y ')} sin completar al cierre del día de hoy.`

      for (const sup of supervisores) {
        await admin.from('notificaciones').insert({
          tenant_id: s.tenant_id, user_id: sup.usuario_id, tipo: 'repositor_cierre_dia',
          titulo, mensaje, action_url: '/repositores',
          metadata: { sucursal_id: s.id, sucursal_nombre: s.nombre, carteles: countCarteles ?? 0, reposicion: countReposicion ?? 0 },
        })
        await emailUsuario(admin, sup.usuario_id, titulo, mensaje, '/repositores')
      }
      sucursalesNotificadas++
    }

    return json({
      ok: true, hora_argentina: horaActual, sucursales_evaluadas: (sucursales ?? []).length,
      sucursales_en_horario_cierre: sucursalesProcesadas, sucursales_notificadas: sucursalesNotificadas,
      errores, ran_at: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('repositores-cierre-dia-sweep error:', err)
    return json({ ok: false, error: err.message }, 500)
  }
})
