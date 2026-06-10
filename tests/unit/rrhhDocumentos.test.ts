import { describe, it, expect } from 'vitest'
import { documentosFaltantes, documentosPorVencer } from '@/lib/rrhhDocumentos'

// RRHH RH7 — documentos

const CAT = [
  { id: 'c1', nombre: 'Contrato', obligatorio: true, activo: true },
  { id: 'c2', nombre: 'DNI', obligatorio: true, activo: true },
  { id: 'c3', nombre: 'CV', obligatorio: false, activo: true },
]

describe('documentosFaltantes (E1)', () => {
  it('lista los obligatorios que el empleado no tiene', () => {
    const r = documentosFaltantes(CAT, [{ catalogo_id: 'c1' }])
    expect(r.map(c => c.id)).toEqual(['c2'])
  })
  it('matchea por nombre como fallback', () => {
    const r = documentosFaltantes(CAT, [{ nombre: 'dni' }, { nombre: 'Contrato' }])
    expect(r.length).toBe(0)
  })
  it('ignora los no obligatorios', () => {
    const r = documentosFaltantes(CAT, [{ catalogo_id: 'c1' }, { catalogo_id: 'c2' }])
    expect(r.length).toBe(0) // CV no es obligatorio
  })
})

describe('documentosPorVencer (E2)', () => {
  it('incluye vencidos y próximos dentro del umbral, ordenados', () => {
    const docs = [
      { id: '1', fecha_vencimiento: '2026-06-20' }, // +11
      { id: '2', fecha_vencimiento: '2026-06-05' }, // -4 vencido
      { id: '3', fecha_vencimiento: '2026-09-01' }, // +84 fuera
    ]
    const r = documentosPorVencer(docs, '2026-06-09', 30)
    expect(r.map(d => d.id)).toEqual(['2', '1'])
    expect(r[0].diasRestantes).toBe(-4)
  })
})
