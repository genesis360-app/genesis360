// Traducción de la condición IVA del padrón al vocabulario de cada ficha (src/lib/padronArca.ts).
// 🛑 REGLA #0: un valor mal traducido rompe un CHECK (proveedores) o cambia la letra de la factura (cliente/emisor).
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { advertenciaEmisor, condicionParaCliente, condicionParaEmisor, condicionParaProveedor } from '@/lib/padronArca'
import { IVA_RECEPTOR_ID } from '@/lib/facturacionLogic'

describe('condición IVA del padrón → ficha', () => {
  it('cliente: valores que entiende facturacionLogic (IVA_RECEPTOR_ID)', () => {
    for (const c of ['RI', 'MONOTRIBUTO', 'EXENTO', 'CF'] as const) {
      expect(IVA_RECEPTOR_ID[condicionParaCliente(c)!]).toBeDefined()
    }
    expect(condicionParaCliente('RI')).toBe('RI')
    expect(condicionParaCliente(null)).toBeNull()
  })

  it('proveedor: valores del CHECK proveedores_condicion_iva_check', () => {
    const permitidos = ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final']
    for (const c of ['RI', 'MONOTRIBUTO', 'EXENTO', 'CF'] as const) expect(permitidos).toContain(condicionParaProveedor(c))
    expect(condicionParaProveedor(null)).toBeNull()
  })

  it('emisor: RI/Monotributista/Exento; sin IVA ni monotributo no se propone y se advierte', () => {
    expect(condicionParaEmisor('RI')).toBe('RI')
    expect(condicionParaEmisor('MONOTRIBUTO')).toBe('Monotributista')
    expect(condicionParaEmisor('EXENTO')).toBe('Exento')
    expect(condicionParaEmisor('CF')).toBeNull()
    expect(condicionParaEmisor(null)).toBeNull()
    const base = { cuit: '20111111112', tipoPersona: null, nombre: 'X', estadoClave: 'ACTIVO', activa: true, domicilio: null, avisos: [] }
    expect(advertenciaEmisor({ ...base, condicionIva: 'CF' })).toMatch(/no se pueden emitir/)
    expect(advertenciaEmisor({ ...base, condicionIva: 'RI' })).toBeNull()
  })
})
