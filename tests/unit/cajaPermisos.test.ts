import { describe, it, expect } from 'vitest'
import { puede, requiereClaveMaestra, accedeABoveda } from '@/lib/cajaPermisos'

// Plan: tests/specs/caja.plan.md (sección 10 — matriz J3 / B5 / B6)

describe('puede (matriz J3)', () => {
  it('CAJA-PER-01 rol null → false', () => {
    expect(puede(null, 'abrir_propia')).toBe(false)
  })
  it('CAJA-PER-02 CAJERO puede abrir su propia caja', () => {
    expect(puede('CAJERO', 'abrir_propia')).toBe(true)
  })
  it('CAJA-PER-03 CAJERO NO puede abrir caja ajena', () => {
    expect(puede('CAJERO', 'abrir_ajena')).toBe(false)
  })
  it('CAJA-PER-04 SUPERVISOR no ve bóveda sin config', () => {
    expect(puede('SUPERVISOR', 'ver_boveda_saldo')).toBe(false)
  })
  it('CAJA-PER-05 SUPERVISOR ve bóveda si el dueño lo habilita', () => {
    expect(puede('SUPERVISOR', 'ver_boveda_saldo', { supervisor_puede_ver_boveda: true })).toBe(true)
  })
  it('CAJA-PER-06 cambiar clave maestra es solo DUEÑO (B6 estricto)', () => {
    expect(puede('SUPERVISOR', 'cambiar_clave_maestra')).toBe(false)
    expect(puede('DUEÑO', 'cambiar_clave_maestra')).toBe(true)
  })
  it('CAJA-PER-07 CONTADOR tiene lectura (J1)', () => {
    expect(puede('CONTADOR', 'ver_lectura_solo')).toBe(true)
  })
  it('CAJA-PER-08 CONTADOR no puede operar (ingreso manual)', () => {
    expect(puede('CONTADOR', 'ingreso_manual')).toBe(false)
  })
  it('editar_movimiento: SUPERVISOR solo con config habilitada', () => {
    expect(puede('SUPERVISOR', 'editar_movimiento')).toBe(false)
    expect(puede('SUPERVISOR', 'editar_movimiento', { supervisor_puede_editar_movimientos: true })).toBe(true)
  })
})

describe('requiereClaveMaestra (B5)', () => {
  it('CAJA-PER-09 cerrar_ajena con clave configurada → true', () => {
    expect(requiereClaveMaestra('cerrar_ajena', true)).toBe(true)
  })
  it('CAJA-PER-10 cerrar_ajena sin clave configurada → false', () => {
    expect(requiereClaveMaestra('cerrar_ajena', false)).toBe(false)
  })
  it('CAJA-PER-11 acción fuera de la lista → false aunque haya clave', () => {
    expect(requiereClaveMaestra('abrir_propia', true)).toBe(false)
  })
  it('anular_venta requiere clave si está configurada', () => {
    expect(requiereClaveMaestra('anular_venta', true)).toBe(true)
  })
})

describe('accedeABoveda (E1 — bóveda para roles fijos y custom)', () => {
  it('CAJA-BOV-01 default ([DUEÑO]) — solo el DUEÑO ve la bóveda', () => {
    expect(accedeABoveda('DUEÑO', null, undefined)).toBe(true)
    expect(accedeABoveda('CAJERO', null, undefined)).toBe(false)
  })
  it('CAJA-BOV-02 rol estándar habilitado en caja_fuerte_roles', () => {
    expect(accedeABoveda('SUPERVISOR', null, ['DUEÑO', 'SUPERVISOR'])).toBe(true)
    expect(accedeABoveda('CAJERO', null, ['DUEÑO', 'SUPERVISOR'])).toBe(false)
  })
  it('CAJA-BOV-03 rol custom habilitado como custom:<id>', () => {
    expect(accedeABoveda('CAJERO', 'rc-1', ['DUEÑO', 'custom:rc-1'])).toBe(true)
  })
  it('CAJA-BOV-04 rol custom NO habilitado → false', () => {
    expect(accedeABoveda('CAJERO', 'rc-2', ['DUEÑO', 'custom:rc-1'])).toBe(false)
  })
  it('CAJA-BOV-05 sin rolCustomId no matchea un custom:', () => {
    expect(accedeABoveda('CAJERO', null, ['custom:rc-1'])).toBe(false)
  })
})
