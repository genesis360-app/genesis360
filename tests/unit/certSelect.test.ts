// Tests del apareo emisor↔certificado del multi-CUIT (REGLA #0, fiscal).
// Importa DIRECTO el módulo que usa la Edge Function `emitir-factura` (sin espejo).
// El escenario que lockea: un emisor ADICIONAL (otro CUIT) NUNCA puede tomar prestado el cert
// legacy del tenant — firmaría el WSAA con el CUIT equivocado. Bug latente cazado en la
// auditoría multi-CUIT del 2026-07-15 (inerte: no hay certs legacy en DEV ni PROD).
import { describe, it, expect } from 'vitest'
import { elegirCertificado, type CertRow } from '../../supabase/functions/emitir-factura/certSelect'

const EMISOR_A = 'aaaaaaaa-0000-0000-0000-000000000001'   // default (CUIT original del tenant)
const EMISOR_B = 'bbbbbbbb-0000-0000-0000-000000000002'   // adicional (OTRO CUIT)

const certDe = (emisor_id: string | null, extra: Partial<CertRow> = {}): CertRow => ({
  cert_crt_path: `path/${emisor_id ?? 'legacy'}.crt`,
  cert_key_path: `path/${emisor_id ?? 'legacy'}.key`,
  emisor_id,
  ...extra,
})

describe('elegirCertificado — apareo emisor↔cert (multi-CUIT)', () => {
  it('el emisor usa SU propio certificado', () => {
    const rows = [certDe(EMISOR_A), certDe(EMISOR_B)]
    expect(elegirCertificado(rows, { id: EMISOR_B, es_default: false })?.emisor_id).toBe(EMISOR_B)
    expect(elegirCertificado(rows, { id: EMISOR_A, es_default: true })?.emisor_id).toBe(EMISOR_A)
  })

  it('el cert propio gana aunque exista uno legacy', () => {
    const rows = [certDe(null), certDe(EMISOR_A)]
    expect(elegirCertificado(rows, { id: EMISOR_A, es_default: true })?.emisor_id).toBe(EMISOR_A)
  })

  it('🛑 un emisor ADICIONAL sin cert propio NO toma el legacy (firmaría con otro CUIT)', () => {
    const rows = [certDe(null)]   // solo el legacy, del CUIT original del tenant
    expect(elegirCertificado(rows, { id: EMISOR_B, es_default: false })).toBeNull()
  })

  it('🛑 un emisor ADICIONAL sin cert propio NO toma el cert de OTRO emisor', () => {
    const rows = [certDe(EMISOR_A)]
    expect(elegirCertificado(rows, { id: EMISOR_B, es_default: false })).toBeNull()
  })

  it('el emisor DEFAULT sin cert propio SÍ usa el legacy (es su mismo CUIT, pre mig 267)', () => {
    const rows = [certDe(null)]
    expect(elegirCertificado(rows, { id: EMISOR_A, es_default: true })?.emisor_id).toBeNull()
  })

  it('tenant legacy sin fila de emisores (id null, es_default true) usa el legacy', () => {
    const rows = [certDe(null)]
    expect(elegirCertificado(rows, { id: null, es_default: true })?.cert_crt_path).toContain('legacy')
  })

  it('ignora certificados dados de baja (activo=false)', () => {
    const rows = [certDe(EMISOR_A, { activo: false }), certDe(null, { activo: false })]
    expect(elegirCertificado(rows, { id: EMISOR_A, es_default: true })).toBeNull()
  })

  it('sin certificados devuelve null (el caller decide el error)', () => {
    expect(elegirCertificado([], { id: EMISOR_A, es_default: true })).toBeNull()
    expect(elegirCertificado(null, { id: EMISOR_A, es_default: true })).toBeNull()
    expect(elegirCertificado(undefined, { id: EMISOR_B, es_default: false })).toBeNull()
  })
})
