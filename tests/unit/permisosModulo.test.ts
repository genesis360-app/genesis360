import { describe, it, expect } from 'vitest'
import { moduloSoloLectura, moduloOculto, puedeEditarModulo, puedeSupervisarModulo } from '@/lib/permisosModulo'

// Enforcement de rol custom en mutaciones (gap cerrado v1.57.0): 'ver' = solo lectura.

describe('moduloSoloLectura', () => {
  it("true solo si el rol custom marca el módulo como 'ver'", () => {
    expect(moduloSoloLectura({ permisos_custom: { ventas: 'ver' } }, 'ventas')).toBe(true)
    expect(moduloSoloLectura({ permisos_custom: { ventas: 'editar' } }, 'ventas')).toBe(false)
    expect(moduloSoloLectura({ permisos_custom: { ventas: 'no_ver' } }, 'ventas')).toBe(false)
  })
  it('roles fijos (sin permisos_custom) nunca quedan en solo lectura por acá', () => {
    expect(moduloSoloLectura({ permisos_custom: null }, 'ventas')).toBe(false)
    expect(moduloSoloLectura({}, 'ventas')).toBe(false)
    expect(moduloSoloLectura(null, 'ventas')).toBe(false)
    expect(moduloSoloLectura(undefined, 'ventas')).toBe(false)
  })
  it('módulo no listado en el rol custom no bloquea', () => {
    expect(moduloSoloLectura({ permisos_custom: { caja: 'ver' } }, 'ventas')).toBe(false)
  })
})

describe('moduloOculto', () => {
  it("true solo con 'no_ver'", () => {
    expect(moduloOculto({ permisos_custom: { gastos: 'no_ver' } }, 'gastos')).toBe(true)
    expect(moduloOculto({ permisos_custom: { gastos: 'ver' } }, 'gastos')).toBe(false)
  })
})

describe('puedeEditarModulo', () => {
  it('editar cuando es editar, no listado, o sin rol custom', () => {
    expect(puedeEditarModulo({ permisos_custom: { ventas: 'editar' } }, 'ventas')).toBe(true)
    expect(puedeEditarModulo({ permisos_custom: { caja: 'ver' } }, 'ventas')).toBe(true) // otro módulo
    expect(puedeEditarModulo(null, 'ventas')).toBe(true)
  })
  it('no editar cuando es ver o no_ver', () => {
    expect(puedeEditarModulo({ permisos_custom: { ventas: 'ver' } }, 'ventas')).toBe(false)
    expect(puedeEditarModulo({ permisos_custom: { ventas: 'no_ver' } }, 'ventas')).toBe(false)
  })
})

describe('puedeSupervisarModulo (patrón de Supervisor reusable, mig 347)', () => {
  it('DUEÑO/SUPER_USUARIO/ADMIN: siempre, en cualquier módulo, sin permisos_custom', () => {
    for (const rol of ['DUEÑO', 'SUPER_USUARIO', 'ADMIN']) {
      expect(puedeSupervisarModulo({ rol }, 'inventario')).toBe(true)
      expect(puedeSupervisarModulo({ rol }, 'configuracion')).toBe(true)
      expect(puedeSupervisarModulo({ rol, permisos_custom: null }, 'inventario')).toBe(true)
    }
  })
  it('SUPERVISOR: heredado en módulos operativos, NO en los ownerOnly', () => {
    expect(puedeSupervisarModulo({ rol: 'SUPERVISOR' }, 'inventario')).toBe(true)
    expect(puedeSupervisarModulo({ rol: 'SUPERVISOR' }, 'pedidos')).toBe(true)
    for (const m of ['configuracion', 'usuarios', 'sucursales', 'rrhh', 'facturacion', 'proveedores', 'recursos', 'biblioteca']) {
      expect(puedeSupervisarModulo({ rol: 'SUPERVISOR' }, m), `SUPERVISOR no debería supervisar ${m}`).toBe(false)
    }
  })
  it('rol custom: solo con supervisa explícito en permisos_custom', () => {
    expect(puedeSupervisarModulo({ rol: 'CAJERO', permisos_custom: { inventario: 'supervisa' } }, 'inventario')).toBe(true)
    expect(puedeSupervisarModulo({ rol: 'CAJERO', permisos_custom: { inventario: 'editar' } }, 'inventario')).toBe(false)
    expect(puedeSupervisarModulo({ rol: 'CAJERO', permisos_custom: null }, 'inventario')).toBe(false)
    expect(puedeSupervisarModulo({ rol: 'DEPOSITO' }, 'inventario')).toBe(false)
  })
  it('otro módulo no listado en permisos_custom no supervisa', () => {
    expect(puedeSupervisarModulo({ rol: 'CAJERO', permisos_custom: { caja: 'supervisa' } }, 'inventario')).toBe(false)
  })
})

describe("puedeEditarModulo: 'supervisa' es superset de 'editar'", () => {
  it("un rol custom con 'supervisa' también puede editar el módulo normalmente", () => {
    expect(puedeEditarModulo({ permisos_custom: { inventario: 'supervisa' } }, 'inventario')).toBe(true)
  })
})

describe('rol LECTOR (VIEWER) — solo lectura en TODOS los módulos', () => {
  const lector = { rol: 'VIEWER' as const }
  it('solo-lectura en cualquier módulo (sin importar permisos_custom)', () => {
    for (const m of ['ventas', 'caja', 'inventario', 'productos', 'gastos', 'clientes']) {
      expect(moduloSoloLectura(lector, m)).toBe(true)
      expect(puedeEditarModulo(lector, m)).toBe(false)
    }
  })
  it('no oculta módulos por sí solo (la visibilidad la maneja navVisibility)', () => {
    expect(moduloOculto(lector, 'ventas')).toBe(false)
  })
})
