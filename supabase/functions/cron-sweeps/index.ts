import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Sweeps periódicos para todos los tenants (issue #7). pg_cron no está habilitado, así que
// los dispara GitHub Actions a diario. Usa service_role para barrer todos los tenants.
// Solo sweeps idempotentes y no-financieros: intereses CC + reservas vencidas.
// (Los servicios recurrentes se dejan asistidos a propósito — generan gastos.)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: reservas, error: e1 } = await supabase.rpc('liberar_reservas_vencidas_all')
    if (e1) throw new Error(`liberar_reservas_vencidas_all: ${e1.message}`)

    const { data: intereses, error: e2 } = await supabase.rpc('recalcular_intereses_cc_all')
    if (e2) throw new Error(`recalcular_intereses_cc_all: ${e2.message}`)

    return new Response(
      JSON.stringify({
        ok: true,
        reservas_liberadas: reservas ?? 0,
        ventas_con_interes_recalculado: intereses ?? 0,
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
