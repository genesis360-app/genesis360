import { describe, it, expect } from 'vitest'
import { cambiarRol, validarAcceso, parcheAcceso, textoAlcance, type AccesoUsuario } from '@/lib/accesoUsuario'

const cajero: AccesoUsuario = { rol: 'CAJERO', puede_ver_todas: false, sucursal_id: 'norte', rol_custom_id: 'rc1' }

describe('acceso de un usuario — borrador del panel "Editar acceso" (GO 06/10)', () => {
  it('cambiar el rol suelta el rol personalizado y pone el alcance por defecto del rol nuevo', () => {
    expect(cambiarRol(cajero, 'SUPERVISOR')).toEqual({ rol: 'SUPERVISOR', puede_ver_todas: true, sucursal_id: 'norte', rol_custom_id: null })
    expect(cambiarRol(cajero, 'DEPOSITO')).toMatchObject({ puede_ver_todas: false, rol_custom_id: null })
    expect(cambiarRol(cajero, 'CAJERO')).toBe(cajero)   // mismo rol: nada cambia
  })
  it('restringido a una sucursal exige elegirla (si el negocio tiene sucursales)', () => {
    expect(validarAcceso({ ...cajero, sucursal_id: null }, true)).toMatch(/sucursal/)
    expect(validarAcceso({ ...cajero, sucursal_id: null }, false)).toBeNull()
    expect(validarAcceso({ ...cajero, rol: 'SUPER_USUARIO', puede_ver_todas: false, sucursal_id: null }, true)).toBeNull()
  })
  it('el parche lleva solo lo que cambió; sin cambios, null', () => {
    expect(parcheAcceso(cajero, cajero)).toBeNull()
    expect(parcheAcceso(cajero, { ...cajero, sucursal_id: 'sur' })).toEqual({ sucursal_id: 'sur' })
    expect(parcheAcceso(cajero, cambiarRol(cajero, 'SUPERVISOR'))).toEqual({ rol: 'SUPERVISOR', puede_ver_todas: true, rol_custom_id: null })
  })
  it('un rol que ve todo siempre se guarda con todas las sucursales', () => {
    expect(parcheAcceso(cajero, { ...cajero, rol: 'SUPER_USUARIO', puede_ver_todas: false })).toMatchObject({ rol: 'SUPER_USUARIO', puede_ver_todas: true })
  })
  it('texto de la fila', () => {
    const nombre = (id: string) => ({ norte: 'Sucursal Norte' } as Record<string, string>)[id]
    expect(textoAlcance(cajero, nombre)).toBe('Sucursal Norte')
    expect(textoAlcance({ ...cajero, puede_ver_todas: true }, nombre)).toBe('Todas las sucursales')
    expect(textoAlcance({ ...cajero, sucursal_id: null }, nombre)).toBe('Sin sucursal asignada')
    expect(textoAlcance({ rol: 'DUEÑO', puede_ver_todas: false, sucursal_id: null }, nombre)).toBe('Todas las sucursales')
  })
})
