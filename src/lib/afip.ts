import { supabase } from '@/lib/supabase'
import { esArchivoCrt, esArchivoKey } from '@/lib/csrCert'

export interface TenantCertificate {
  id: string
  tenant_id: string
  cert_crt_path: string
  cert_key_path: string
  cuit?: string | null
  fecha_validez_hasta?: string | null
  /** Emisor fiscal dueño del certificado (multi-CUIT, mig 267). Null = fila legacy. */
  emisor_id?: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

/**
 * Sube el certificado AFIP (.crt + .key) de UN EMISOR fiscal (multi-CUIT: un cert por
 * emisor, mig 268). `emisorId` null solo para el caso legacy de un tenant que todavía no
 * guardó sus datos fiscales (sin fila en emisores_fiscales) — máx. una fila así por tenant.
 */
export async function uploadCertificates(
  tenantId: string,
  crtFile: File,
  keyFile: File,
  cuit: string,
  validezHasta?: string | null,
  emisorId?: string | null,
): Promise<void> {
  if (!esArchivoCrt(crtFile.name)) throw new Error('El archivo de certificado debe tener extensión .crt')
  if (!esArchivoKey(keyFile.name)) throw new Error('La clave privada debe tener extensión .key')

  const ts = Date.now()
  const crtPath = `${tenantId}/${ts}.crt`
  const keyPath = `${tenantId}/${ts}.key`

  const { error: crtErr } = await supabase.storage
    .from('certificados-afip')
    .upload(crtPath, crtFile, { upsert: true })
  if (crtErr) throw new Error(`Error subiendo .crt: ${crtErr.message}`)

  const { error: keyErr } = await supabase.storage
    .from('certificados-afip')
    .upload(keyPath, keyFile, { upsert: true })
  if (keyErr) {
    // Rollback .crt si falla el .key
    await supabase.storage.from('certificados-afip').remove([crtPath])
    throw new Error(`Error subiendo .key: ${keyErr.message}`)
  }

  const row = {
    tenant_id: tenantId,
    cert_crt_path: crtPath,
    cert_key_path: keyPath,
    cuit: cuit.trim() || null,
    fecha_validez_hasta: validezHasta || null,
    activo: true,
  }
  let dbErr: { message: string } | null = null
  if (emisorId) {
    // Un cert por emisor (uq_tenant_certificates_emisor)
    const { error } = await supabase.from('tenant_certificates')
      .upsert({ ...row, emisor_id: emisorId }, { onConflict: 'emisor_id' })
    dbErr = error
  } else {
    // Legacy sin emisor: el UNIQUE(tenant_id) ya no existe (mig 268) → update-or-insert manual
    const { data: existente } = await supabase.from('tenant_certificates')
      .select('id').eq('tenant_id', tenantId).is('emisor_id', null).maybeSingle()
    const { error } = existente
      ? await supabase.from('tenant_certificates').update(row).eq('id', existente.id)
      : await supabase.from('tenant_certificates').insert(row)
    dbErr = error
  }

  if (dbErr) {
    await supabase.storage.from('certificados-afip').remove([crtPath, keyPath])
    throw new Error(`Error guardando en base de datos: ${dbErr.message}`)
  }
}

// ─── Wizard de certificado self-service (mig 270 + EF generar-csr) ────────────────
// Genera server-side la clave privada + el CSR para un emisor. El cliente pega el CSR
// en ARCA, descarga el .crt y lo sube con finalizarCertificadoDesdeCsr(). Devuelve el
// texto del CSR (la .key queda server-side, nunca llega al browser).
export async function generarCsrEmisor(
  tenantId: string, emisorId: string, cuit: string, razonSocial: string,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('generar-csr', {
    body: { tenant_id: tenantId, emisor_id: emisorId, cuit, razon_social: razonSocial },
  })
  if (error) {
    let msg = error.message
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error } catch { /* */ }
    throw new Error(msg || 'No se pudo generar el CSR')
  }
  if (data?.error) throw new Error(data.error)
  if (!data?.csr) throw new Error('El servidor no devolvió el CSR')
  return data.csr as string
}

/**
 * Finaliza el certificado de un emisor que fue generado por el wizard: manda el .crt que el
 * cliente descargó de ARCA a la EF `finalizar-certificado`, que lo VALIDA contra la .key
 * guardada (mismo par RSA), lo activa y limpia el puntero. La validación es server-side a
 * propósito: la .key nunca viaja al browser, así que el cliente no puede aparearla — y REGLA #0
 * exige el guard del lado del servidor. Si el .crt no corresponde al CSR, la EF devuelve 400
 * con un mensaje claro (antes esto fallaba recién al emitir con `cms.sign.invalid` del WSAA).
 */
export async function finalizarCertificadoDesdeCsr(
  tenantId: string, emisorId: string, crtFile: File,
): Promise<void> {
  if (!esArchivoCrt(crtFile.name, { permitirPem: true }))
    throw new Error('El archivo del certificado debe tener extensión .crt (o .pem)')

  const crtPem = await crtFile.text()
  const { data, error } = await supabase.functions.invoke('finalizar-certificado', {
    body: { tenant_id: tenantId, emisor_id: emisorId, crt_pem: crtPem },
  })
  if (error) {
    let msg = error.message
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error } catch { /* */ }
    throw new Error(msg || 'No se pudo finalizar el certificado')
  }
  if (data?.error) throw new Error(data.error)
}
