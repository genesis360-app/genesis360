import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const today = new Date()
    const month = today.getMonth() + 1  // 1-12
    const day   = today.getDate()

    // Buscar empleados activos cuyo cumpleaños sea hoy (todos los tenants)
    const { data: empleados, error } = await supabase
      .from('empleados')
      .select('id, tenant_id, nombre, apellido, dni_rut, fecha_nacimiento')
      .eq('activo', true)
      .not('fecha_nacimiento', 'is', null)

    if (error) throw error

    const cumpleaneros = (empleados ?? []).filter((e: any) => {
      const birth = new Date(e.fecha_nacimiento)
      return birth.getMonth() + 1 === month && birth.getDate() === day
    })

    if (cumpleaneros.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: 'No hay cumpleaños hoy', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Insertar entrada en actividad_log por cada empleado con cumpleaños
    const logs = cumpleaneros.map((e: any) => {
      const nombre = [e.nombre, e.apellido].filter(Boolean).join(' ') || e.dni_rut
      const age = today.getFullYear() - new Date(e.fecha_nacimiento).getFullYear()
      return {
        tenant_id:      e.tenant_id,
        entidad:        'empleado',
        entidad_id:     e.id,
        entidad_nombre: nombre,
        accion:         'cumpleanos',
        detalle:        `¡${nombre} cumple ${age} años hoy! 🎂`,
        pagina:         '/rrhh',
      }
    })

    const { error: logError } = await supabase.from('actividad_log').insert(logs)
    if (logError) console.error('actividad_log insert error:', logError)

    return new Response(
      JSON.stringify({
        ok: true,
        count: cumpleaneros.length,
        empleados: cumpleaneros.map((e: any) => ({
          id: e.id,
          tenant_id: e.tenant_id,
          nombre: [e.nombre, e.apellido].filter(Boolean).join(' ') || e.dni_rut,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
