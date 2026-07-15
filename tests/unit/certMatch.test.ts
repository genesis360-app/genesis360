// Tests del guard crt ↔ clave del wizard de certificado AFIP (REGLA #0).
// Importa DIRECTO el helper que usa la Edge Function `finalizar-certificado` (forge inyectado,
// mismo módulo en Deno y en Node). El escenario que lockea: un .crt de OTRA clave (el bug real
// de Fede, 2026-07-14) debe rechazarse ACÁ, no fallar recién al emitir con `cms.sign.invalid`.
import { describe, it, expect } from 'vitest'
import forge from 'node-forge'
import { certKeyMatch } from '../../supabase/functions/finalizar-certificado/certMatch'

// Genera un par RSA + un certificado self-signed con esa pública (como lo que ARCA devuelve
// para un CSR). 1024 bits: no es seguro para producción, pero acá solo comparamos módulos y
// mantiene el test rápido.
function generarParYCert(): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 1000 * 60 * 60)
  const attrs = [{ name: 'commonName', value: 'test' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  }
}

describe('certKeyMatch — guard crt ↔ clave del wizard AFIP', () => {
  it('aparea cuando el .crt corresponde a la .key (mismo par)', () => {
    const { certPem, keyPem } = generarParYCert()
    expect(certKeyMatch(forge, certPem, keyPem)).toEqual({ ok: true })
  })

  it('🛑 RECHAZA cuando el .crt es de OTRA clave (bug real: .crt viejo sobre clave regenerada)', () => {
    const parA = generarParYCert() // el .crt "equivocado"
    const parB = generarParYCert() // la .key que dejó el wizard
    const r = certKeyMatch(forge, parA.certPem, parB.keyPem)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no corresponde al CSR/i)
  })

  it('rechaza con mensaje claro si el .crt no es un PEM válido', () => {
    const { keyPem } = generarParYCert()
    const r = certKeyMatch(forge, 'no soy un certificado', keyPem)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no es un certificado PEM válido/i)
  })

  it('rechaza si la clave guardada no es un PEM válido', () => {
    const { certPem } = generarParYCert()
    const r = certKeyMatch(forge, certPem, 'clave rota')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/clave privada del CSR guardada no es un PEM válido/i)
  })
})
