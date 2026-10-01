// Reglas puras del importador de inventario (src/lib/importarInventario.ts, mig 449).
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { fechaImportada, MAX_FILAS_INVENTARIO } from '@/lib/importarInventario'

describe('fechaImportada', () => {
  it('vacía → undefined', () => {
    expect(fechaImportada('', XLSX)).toBeUndefined()
    expect(fechaImportada(null, XLSX)).toBeUndefined()
  })
  it('AAAA-MM-DD, DD/MM/AAAA y DD-MM-AAAA', () => {
    expect(fechaImportada('2025-12-31', XLSX)).toBe('2025-12-31')
    expect(fechaImportada('31/12/2025', XLSX)).toBe('2025-12-31')
    expect(fechaImportada('5-3-2026', XLSX)).toBe('2026-03-05')
  })
  it('serial de Excel', () => {
    expect(fechaImportada(46022, XLSX)).toBe('2025-12-31')
  })
  it('fechas que no existen o texto → "invalida" (antes viajaban tal cual y la base rechazaba a mitad de la carga)', () => {
    expect(fechaImportada('31/02/2026', XLSX)).toBe('invalida')
    expect(fechaImportada('2026-13-01', XLSX)).toBe('invalida')
    expect(fechaImportada('mañana', XLSX)).toBe('invalida')
  })
  it('tope igual al de la función de la base (2000)', () => {
    expect(MAX_FILAS_INVENTARIO).toBe(2000)
  })
})
