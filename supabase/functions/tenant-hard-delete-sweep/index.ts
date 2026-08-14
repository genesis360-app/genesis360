import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Hard delete de tenant con grace period (pedido de GO 2026-08-13, mig 358). pg_cron no está
// habilitado en el proyecto — este sweep lo dispara GitHub Actions una vez por día (mismo molde
// que repositores-cierre-dia-sweep/billing-manual-sweep).
//
// `tenants.delete_scheduled_at` se setea desde MiCuentaPage.tsx al programar la baja (+30 días).
// El dueño puede cancelarla en cualquier momento antes de que se cumpla (self-service, banner en
// AppLayout.tsx) — este sweep solo actúa sobre lo que YA venció.
//
// El DELETE es real y definitivo: ~140 FK a tenant_id tienen ON DELETE CASCADE (incluida
// `autorizaciones`, corregida en la mig 358 — era la única excepción, NO ACTION, y hubiera hecho
// fallar el DELETE). No se borran las cuentas de Supabase Auth de los ex-usuarios del tenant acá
// a propósito — riesgo de borrar por error una cuenta STAFF/ADMIN cross-tenant (ver
// reference_rol_admin_staff_aislamiento) supera el beneficio de limpieza; queda como deuda menor.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: vencidos, error: qErr } = await admin.from('tenants')
      .select('id, nombre, delete_scheduled_at')
      .not('delete_scheduled_at', 'is', null)
      .lt('delete_scheduled_at', new Date().toISOString())
    if (qErr) throw new Error(`tenants: ${qErr.message}`)

    const eliminados: string[] = []
    const errores: string[] = []

    for (const t of vencidos ?? []) {
      const { error: delErr } = await admin.from('tenants').delete().eq('id', t.id)
      if (delErr) {
        errores.push(`${t.id} (${t.nombre}): ${delErr.message}`)
        continue
      }
      eliminados.push(`${t.id} (${t.nombre})`)
      console.log(`Tenant purgado definitivamente: ${t.id} — "${t.nombre}" — vencía ${t.delete_scheduled_at}`)
    }

    return json({
      ok: true, evaluados: (vencidos ?? []).length, eliminados: eliminados.length,
      detalle_eliminados: eliminados, errores, ran_at: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('tenant-hard-delete-sweep error:', err)
    return json({ ok: false, error: err.message }, 500)
  }
})
