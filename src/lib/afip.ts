import { supabase } from '@/lib/supabase'

export interface TenantCertificate {
  id: string
  tenant_id: string
  cert_crt_path: string
  cert_key_path: string
  cuit?: string | null
  fecha_validez_hasta?: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export async function uploadCertificates(
  tenantId: string,
  crtFile: File,
  keyFile: File,
  cuit: string,
  validezHasta?: string | null
): Promise<void> {
  if (!crtFile.name.endsWith('.crt')) throw new Error('El archivo de certificado debe tener extensión .crt')
  if (!keyFile.name.endsWith('.key')) throw new Error('La clave privada debe tener extensión .key')

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

  const { error: dbErr } = await supabase.from('tenant_certificates').upsert({
    tenant_id: tenantId,
    cert_crt_path: crtPath,
    cert_key_path: keyPath,
    cuit: cuit.trim() || null,
    fecha_validez_hasta: validezHasta || null,
    activo: true,
  }, { onConflict: 'tenant_id' })

  if (dbErr) {
    await supabase.storage.from('certificados-afip').remove([crtPath, keyPath])
    throw new Error(`Error guardando en base de datos: ${dbErr.message}`)
  }
}
