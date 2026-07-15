import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore — npm: import para Deno (parseo de PEM cert/clave)
import forge from 'npm:node-forge@1.4.0'
import { certKeyMatch } from './certMatch.ts'

// ─── Wizard de certificado AFIP: finaliza el certificado de un emisor (sube el .crt) ───────
// Pareja de `generar-csr`: aquel genera la clave privada + el CSR (la .key queda server-side);
// ESTE recibe el .crt que el cliente descargó de ARCA, VALIDA que corresponda a esa clave
// (mismo par RSA) y recién ahí lo activa. La validación es server-side a propósito:
//   • la clave privada NUNCA viaja al browser → el cliente no puede comparar el par,
//   • REGLA #0 exige el guard del lado del servidor (la UI se cachea/bypassea).
// Sin este apareo, un .crt equivocado se aceptaba y fallaba recién al emitir con el error
// críptico `cms.sign.invalid` del WSAA. Requiere un usuario autenticado del tenant (idéntico
// guard que generar-csr / emitir-factura).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tenant_id, emisor_id, crt_pem } = await req.json()
    if (!tenant_id || !emisor_id) return json({ error: 'tenant_id y emisor_id son requeridos' }, 400)
    if (!crt_pem || typeof crt_pem !== 'string') return json({ error: 'Falta el contenido del certificado (.crt).' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Guard de identidad (REGLA #0): activa material fiscal del tenant → exige un usuario real
    // que pertenezca al tenant (o service_role interno). Mismo guard que generar-csr.
    const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const esServiceRole = !!authToken && authToken === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!esServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
      if (userErr || !userData?.user) return json({ error: 'No autorizado: se requiere un usuario autenticado.' }, 401)
      const { data: membership } = await supabase.from('users')
        .select('id').eq('id', userData.user.id).eq('tenant_id', tenant_id).maybeSingle()
      if (!membership) return json({ error: 'No autorizado: el usuario no pertenece al tenant indicado.' }, 403)
    }

    // El emisor debe pertenecer al tenant y tener una clave de CSR pendiente.
    const { data: emisor } = await supabase.from('emisores_fiscales')
      .select('id, tenant_id, csr_key_path').eq('id', emisor_id).maybeSingle()
    if (!emisor || emisor.tenant_id !== tenant_id) return json({ error: 'Emisor no encontrado en el tenant.' }, 403)
    const keyPath = emisor.csr_key_path as string | null
    if (!keyPath) return json({ error: 'Este emisor no tiene una clave pendiente. Generá el CSR primero.' }, 400)

    // Bajar la clave privada que dejó generar-csr para aparearla con el .crt.
    const keyDl = await supabase.storage.from('certificados-afip').download(keyPath)
    if (!keyDl.data) return json({ error: 'No se pudo leer la clave del CSR guardada. Regenerá el CSR e intentá de nuevo.' }, 500)
    const keyPem = await keyDl.data.text()

    // 🛑 Validación crt ↔ clave (el corazón de este endpoint). Si no aparean, se rechaza ACÁ
    // con un mensaje claro — jamás se activa un par que AFIP va a rechazar al emitir.
    const match = certKeyMatch(forge, crt_pem, keyPem)
    if (!match.ok) return json({ error: match.error }, 400)

    // Aprobado: subir el .crt y activar el par. El .crt es público → no hay problema en que
    // lo suba el server (mismo bucket service_role-only que la .key).
    const crtPath = `${tenant_id}/${Date.now()}.crt`
    const { error: upErr } = await supabase.storage.from('certificados-afip')
      .upload(crtPath, new Blob([crt_pem], { type: 'application/x-x509-ca-cert' }), { upsert: true })
    if (upErr) return json({ error: `No se pudo guardar el certificado: ${upErr.message}` }, 500)

    const { error: dbErr } = await supabase.from('tenant_certificates').upsert({
      tenant_id, emisor_id, cert_crt_path: crtPath, cert_key_path: keyPath, activo: true,
    }, { onConflict: 'emisor_id' })
    if (dbErr) {
      await supabase.storage.from('certificados-afip').remove([crtPath])
      return json({ error: `No se pudo guardar el certificado: ${dbErr.message}` }, 500)
    }

    // Ya apareado: limpiar el puntero para que no se reuse la clave.
    await supabase.from('emisores_fiscales')
      .update({ csr_key_path: null }).eq('id', emisor_id).eq('tenant_id', tenant_id)

    return json({ ok: true })
  } catch (e) {
    console.error('finalizar-certificado error', e)
    return json({ error: (e as Error).message ?? 'Error finalizando el certificado' }, 500)
  }
})
