import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// D3 — sweep de repricing automático por margen objetivo (mecanismo 1). pg_cron no está habilitado,
// así que lo dispara GitHub Actions cada 6 horas (mismo molde que cron-sweeps/meli-stock-worker).
// service_role para barrer todos los tenants — fn_evaluar_repricing_margen toma p_tenant_id
// explícito (sin auth.uid()), no hay una variante "_all" porque necesitamos el resultado por tenant
// para el log. Solo afecta productos con reajuste_margen_auto=true (opt-in explícito en la ficha).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: tenants, error: tErr } = await supabase.from('tenants').select('id')
    if (tErr) throw new Error(`tenants: ${tErr.message}`)

    let aplicados = 0
    let pendientesAprobacion = 0
    const errores: string[] = []

    for (const t of tenants ?? []) {
      const { data, error } = await supabase.rpc('fn_evaluar_repricing_margen', { p_tenant_id: t.id })
      if (error) { errores.push(`${t.id}: ${error.message}`); continue }
      for (const row of data ?? []) {
        if (row.accion === 'aplicado') aplicados++
        else if (row.accion === 'pendiente_aprobacion') pendientesAprobacion++
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tenants_procesados: (tenants ?? []).length,
        aplicados,
        pendientes_aprobacion: pendientesAprobacion,
        errores,
        ran_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
