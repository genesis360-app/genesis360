// Tests de la lógica pura del wizard de CERTIFICADO AFIP (primer certificado + multi-CUIT).
// 🛑 REGLA #0 (fiscal): un CSR con CUIT mal armado = ARCA rechaza el cert / cert que no
// corresponde. Estos tests lockean el subject del CSR (espejo de la EF generar-csr) y el
// recorrido del usuario que recién arranca. Plan: tests/specs/facturacion.plan.md §11 (CERT).
import { describe, it, expect } from 'vitest'
import {
  construirSubjectCsr, pasoWizardCert, esArchivoCrt, esArchivoKey, nombreArchivoCsr,
} from '@/lib/csrCert'

describe('construirSubjectCsr (espejo de la EF generar-csr — subject del CSR)', () => {
  it('CERT-SUBJ-01 CUIT con guiones → 11 dígitos limpios y subject OK', () => {
    const r = construirSubjectCsr('30-71234567-8', 'Otranto SA')
    expect(r.ok).toBe(true)
    expect(r.cuitDigits).toBe('30712345678')
    expect(r.serialNumber).toBe('CUIT 30712345678')
    expect(r.razon).toBe('Otranto SA')
    expect(r.error).toBeUndefined()
  })

  it('CERT-SUBJ-02 🛑 CUIT con menos de 11 dígitos → rechazado (no se genera)', () => {
    const r = construirSubjectCsr('30-123-4', 'Otranto SA')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/11 d[ií]gitos/i)
  })

  it('CERT-SUBJ-03 🛑 CUIT con MÁS de 11 dígitos → rechazado', () => {
    expect(construirSubjectCsr('301234567890123', 'X').ok).toBe(false)
  })

  it('CERT-SUBJ-04 CUIT vacío/null → rechazado con mensaje claro', () => {
    expect(construirSubjectCsr('', 'X').ok).toBe(false)
    expect(construirSubjectCsr(null, 'X').ok).toBe(false)
    expect(construirSubjectCsr(undefined, undefined).ok).toBe(false)
  })

  it('CERT-SUBJ-05 razón social vacía → fallback "Razón social" (nunca subject vacío)', () => {
    const r = construirSubjectCsr('30712345678', '   ')
    expect(r.ok).toBe(true)
    expect(r.razon).toBe('Razón social')
    expect(r.commonName).toBe('Razón social')
  })

  it('CERT-SUBJ-06 CN se trunca a 50 chars (límite del campo commonName)', () => {
    const larga = 'A'.repeat(80)
    const r = construirSubjectCsr('30712345678', larga)
    expect(r.commonName).toHaveLength(50)
    expect(r.razon).toBe(larga) // O= conserva la razón completa
  })
})

describe('pasoWizardCert (recorrido del que recién arranca y carga su 1er cert)', () => {
  it('CERT-STEP-01 sin nada → paso 1: generar el CSR', () => {
    expect(pasoWizardCert({ tieneCertActivo: false, csrKeyPath: null, csrGeneradoEnSesion: false }))
      .toBe('generar')
  })

  it('CERT-STEP-02 recién generó el CSR en esta sesión → subir el .crt de ARCA', () => {
    expect(pasoWizardCert({ tieneCertActivo: false, csrKeyPath: 'tenant/csr_x.key', csrGeneradoEnSesion: true }))
      .toBe('subir-crt')
  })

  it('CERT-STEP-03 generó el CSR en una sesión anterior (key pendiente) → retomar subiendo el .crt', () => {
    expect(pasoWizardCert({ tieneCertActivo: false, csrKeyPath: 'tenant/csr_x.key', csrGeneradoEnSesion: false }))
      .toBe('pendiente-crt')
  })

  it('CERT-STEP-04 ya tiene cert activo (y no está generando) → estado activo', () => {
    expect(pasoWizardCert({ tieneCertActivo: true, csrKeyPath: null, csrGeneradoEnSesion: false }))
      .toBe('activo')
    // el cert activo manda sobre una key pendiente vieja mientras no genere uno nuevo
    expect(pasoWizardCert({ tieneCertActivo: true, csrKeyPath: 'x', csrGeneradoEnSesion: false }))
      .toBe('activo')
  })

  it('CERT-STEP-05 🔁 reemplazo: con cert activo, generar un CSR nuevo → vuelve a subir-crt', () => {
    // Renovación/vencimiento: aunque haya cert activo, si generó un CSR nuevo en la sesión debe
    // poder terminar de subir el .crt nuevo (si no, quedaría atascado en "activo").
    expect(pasoWizardCert({ tieneCertActivo: true, csrKeyPath: 'x', csrGeneradoEnSesion: true }))
      .toBe('subir-crt')
  })
})

describe('validación de archivos (extensiones que acepta cada paso)', () => {
  it('CERT-FILE-01 .crt es cert válido; .pem solo si se permite (finalizar acepta ambos)', () => {
    expect(esArchivoCrt('cuit.crt')).toBe(true)
    expect(esArchivoCrt('CUIT.CRT')).toBe(true)     // case-insensitive
    expect(esArchivoCrt('cert.pem')).toBe(false)     // upload manual estricto: solo .crt
    expect(esArchivoCrt('cert.pem', { permitirPem: true })).toBe(true)
    expect(esArchivoCrt('cert.key', { permitirPem: true })).toBe(false)
  })

  it('CERT-FILE-02 .key es clave válida', () => {
    expect(esArchivoKey('clave.key')).toBe(true)
    expect(esArchivoKey('clave.KEY')).toBe(true)
    expect(esArchivoKey('clave.crt')).toBe(false)
    expect(esArchivoKey(null)).toBe(false)
  })

  it('CERT-FILE-03 el .csr descargado se nombra con los dígitos del CUIT', () => {
    expect(nombreArchivoCsr('30-71234567-8')).toBe('30712345678.csr')
  })
})
