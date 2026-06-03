import { describe, it, expect } from 'vitest'
import { puedeVerCosto } from '@/lib/permisosCosto'

// Plan: tests/specs/ventas.plan.md (sección 2 — VEN-COSTO, G4)

describe('puedeVerCosto (G4)', () => {
  it('VEN-COSTO-01 null → false', () => expect(puedeVerCosto(null)).toBe(false))
  it('VEN-COSTO-02 DUEÑO ve costo', () => expect(puedeVerCosto('DUEÑO')).toBe(true))
  it('VEN-COSTO-03 CONTADOR ve costo', () => expect(puedeVerCosto('CONTADOR')).toBe(true))
  it('VEN-COSTO-04 CAJERO NO ve costo', () => expect(puedeVerCosto('CAJERO')).toBe(false))
  it('VEN-COSTO-05 DEPOSITO NO ve costo', () => expect(puedeVerCosto('DEPOSITO')).toBe(false))
  it('VEN-COSTO-06 RRHH NO ve costo', () => expect(puedeVerCosto('RRHH')).toBe(false))
  it('SUPERVISOR y ADMIN ven costo', () => {
    expect(puedeVerCosto('SUPERVISOR')).toBe(true)
    expect(puedeVerCosto('ADMIN')).toBe(true)
    expect(puedeVerCosto('SUPER_USUARIO')).toBe(true)
  })
})
