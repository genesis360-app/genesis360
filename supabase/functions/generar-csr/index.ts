import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore — npm: import para Deno (generación RSA + CSR PKCS#10, pure-JS)
import forge from 'npm:node-forge@1.4.0'

// ─── Wizard de certificado AFIP: generación de clave privada (.key) + CSR ──────────────────
// El .crt de ARCA NO se puede emitir desatendido (exige clave fiscal del contribuyente), pero
// SÍ podemos generar por el cliente la clave privada RSA 2048 y el CSR (el pedido de certificado,
// que lleva el CUIT en el subject). El cliente pega el CSR en ARCA → Administración de
// Certificados Digitales, descarga el .crt y lo sube; ahí se aparea con la .key que dejamos acá.
//
// La .key se guarda en el bucket certificados-afip (service_role-only, igual que los certs subidos
// a mano) y su path queda en emisores_fiscales.csr_key_path (mig 270) para poder aparearla con el
// .crt aunque el cliente vuelva días después. La .key NUNCA se devuelve al cliente ni viaja al
// browser — se genera y se queda server-side.
//
// Requiere un usuario autenticado que pertenezca al tenant (mismo guard que emitir-factura).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tenant_id, emisor_id, cuit, razon_social } = await req.json()
    if (!tenant_id || !emisor_id) return json({ error: 'tenant_id y emisor_id son requeridos' }, 400)

    const cuitDigits = String(cuit ?? '').replace(/\D/g, '')
    if (cuitDigits.length !== 11) return json({ error: 'El CUIT debe tener 11 dígitos.' }, 400)
    const razon = String(razon_social ?? '').trim() || 'Razón social'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Guard de identidad (REGLA #0): genera y guarda material criptográfico en el bucket
    // del tenant → exige un usuario real que pertenezca al tenant (o service_role interno).
    const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const esServiceRole = !!authToken && authToken === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!esServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
      if (userErr || !userData?.user) return json({ error: 'No autorizado: se requiere un usuario autenticado.' }, 401)
      const { data: membership } = await supabase.from('users')
        .select('id').eq('id', userData.user.id).eq('tenant_id', tenant_id).maybeSingle()
      if (!membership) return json({ error: 'No autorizado: el usuario no pertenece al tenant indicado.' }, 403)
    }

    // El emisor debe pertenecer al tenant.
    const { data: emisor } = await supabase.from('emisores_fiscales')
      .select('id, tenant_id').eq('id', emisor_id).maybeSingle()
    if (!emisor || emisor.tenant_id !== tenant_id) return json({ error: 'Emisor no encontrado en el tenant.' }, 403)

    // 1. Par de claves RSA 2048 (síncrono; ~1-2s, dentro del timeout de la EF).
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })

    // 2. CSR (PKCS#10) firmado con SHA-256 (AFIP exige SHA-256). Subject requerido por ARCA:
    //    C=AR · O=<razón social> · CN=<alias> · serialNumber="CUIT <11 dígitos>".
    const csr = forge.pki.createCertificationRequest()
    csr.publicKey = keys.publicKey
    csr.setSubject([
      { name: 'countryName', value: 'AR' },
      { name: 'organizationName', value: razon },
      { name: 'commonName', value: razon.slice(0, 50) },
      { type: '2.5.4.5', value: `CUIT ${cuitDigits}` }, // serialNumber
    ])
    csr.sign(keys.privateKey, forge.md.sha256.create())

    const csrPem = forge.pki.certificationRequestToPem(csr)
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey)

    // 3. Guardar la .key en el bucket (nunca vuelve al cliente). Path por emisor + timestamp.
    const keyPath = `${tenant_id}/csr_${emisor_id}_${Date.now()}.key`
    const { error: upErr } = await supabase.storage.from('certificados-afip')
      .upload(keyPath, new Blob([keyPem], { type: 'application/x-pem-file' }), { upsert: true })
    if (upErr) return json({ error: `No se pudo guardar la clave: ${upErr.message}` }, 500)

    // 4. Dejar el puntero para aparear con el .crt cuando el cliente lo suba.
    const { error: updErr } = await supabase.from('emisores_fiscales')
      .update({ csr_key_path: keyPath, updated_at: new Date().toISOString() })
      .eq('id', emisor_id).eq('tenant_id', tenant_id)
    if (updErr) {
      await supabase.storage.from('certificados-afip').remove([keyPath])
      return json({ error: `No se pudo asociar la clave al emisor: ${updErr.message}` }, 500)
    }

    // Solo se devuelve el CSR (público) — la .key queda server-side.
    return json({ ok: true, csr: csrPem })
  } catch (e) {
    console.error('generar-csr error', e)
    return json({ error: (e as Error).message ?? 'Error generando el CSR' }, 500)
  }
})
