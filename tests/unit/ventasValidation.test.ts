import { describe, it, expect } from 'vitest'
import { validarMediosPago, validarDescuentosPorRol, descuentoEfectivoPct, type ValidarDescuentosArgs } from '@/lib/ventasValidation'

describe('Ventas — validación medios de pago', () => {
  const total = 1000

  describe('estado: pendiente', () => {
    it('permite sin medios de pago', () => {
      expect(validarMediosPago('pendiente', [{ tipo: '', monto: '' }], total)).toBeNull()
    })
    it('permite con efectivo mayor al total (vuelto)', () => {
      expect(validarMediosPago('pendiente', [{ tipo: 'Efectivo', monto: '1500' }], total)).toBeNull()
    })
    it('bloquea si monto excede total sin efectivo', () => {
      expect(validarMediosPago('pendiente', [{ tipo: 'Tarjeta débito', monto: '1500' }], total)).not.toBeNull()
    })
  })

  describe('estado: reservada', () => {
    it('bloquea sin ningún medio de pago ingresado', () => {
      expect(validarMediosPago('reservada', [{ tipo: '', monto: '' }], total))
        .toBe('Ingresá un método de pago y monto para reservar')
    })
    it('bloquea con tipo sin monto', () => {
      expect(validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '' }], total))
        .toBe('Ingresá un método de pago y monto para reservar')
    })
    it('bloquea con monto sin tipo', () => {
      expect(validarMediosPago('reservada', [{ tipo: '', monto: '1000' }], total))
        .toBe('Ingresá un método de pago y monto para reservar')
    })
    it('permite con monto parcial (pago parcial OK en reserva)', () => {
      expect(validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '500' }], total)).toBeNull()
    })
    it('permite con monto exacto', () => {
      expect(validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '1000' }], total)).toBeNull()
    })
    it('permite con múltiples medios que suman el total', () => {
      const medios = [{ tipo: 'Efectivo', monto: '600' }, { tipo: 'Tarjeta', monto: '400' }]
      expect(validarMediosPago('reservada', medios, total)).toBeNull()
    })
    it('bloquea si un medio tiene monto pero sin tipo (mixto sin tipo)', () => {
      const medios = [{ tipo: 'Efectivo', monto: '600' }, { tipo: '', monto: '400' }]
      expect(validarMediosPago('reservada', medios, total))
        .toBe('Seleccioná un método de pago para todos los montos')
    })
  })

  describe('estado: despachada', () => {
    it('bloquea sin ningún medio de pago ingresado', () => {
      expect(validarMediosPago('despachada', [{ tipo: '', monto: '' }], total))
        .toBe('Ingresá un método de pago y monto para despachar')
    })
    it('bloquea con monto insuficiente', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '999' }], total))
        .toContain('Falta asignar')
    })
    it('permite con monto exacto', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '1000' }], total)).toBeNull()
    })
    it('permite con efectivo mayor al total (vuelto)', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '1500' }], total)).toBeNull()
    })
    it('bloquea si monto excede total sin efectivo', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Tarjeta débito', monto: '1500' }], total))
        .toContain('excede el total')
    })
    it('bloquea si un medio tiene monto pero sin tipo (mixto sin tipo)', () => {
      // efectivo $600 cubre parcialmente, pero $400 sin tipo completa el total → debe bloquear
      const medios = [{ tipo: 'Efectivo', monto: '600' }, { tipo: '', monto: '400' }]
      expect(validarMediosPago('despachada', medios, total))
        .toBe('Seleccioná un método de pago para todos los montos')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// descuentoEfectivoPct — % efectivo de un descuento (% o $ sobre una base)
// ─────────────────────────────────────────────────────────────────────────────
describe('descuentoEfectivoPct', () => {
  it('descuento en % devuelve el % crudo', () => {
    expect(descuentoEfectivoPct(10, 'pct', 1000)).toBe(10)
  })
  it('descuento en $ se convierte a % sobre la base', () => {
    expect(descuentoEfectivoPct(300, 'monto', 1000)).toBe(30) // $300 sobre $1000 = 30%
  })
  it('descuento 0 o negativo → 0', () => {
    expect(descuentoEfectivoPct(0, 'pct', 1000)).toBe(0)
    expect(descuentoEfectivoPct(-5, 'monto', 1000)).toBe(0)
  })
  it('monto sobre base 0 → 0 (no descuenta nada real)', () => {
    expect(descuentoEfectivoPct(500, 'monto', 0)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validarDescuentosPorRol (G3 + J2c) — tope por rol y por canal, % EFECTIVO
// ─────────────────────────────────────────────────────────────────────────────
describe('validarDescuentosPorRol', () => {
  const base: ValidarDescuentosArgs = {
    rol: 'DUEÑO',
    bloqueadoTotal: false,
    items: [],
    global: { descuento: 0, descuento_tipo: 'pct', subtotal: 1000 },
    maxSupervisorPct: null,
    maxCanalPct: null,
  }

  it('sin descuentos → null', () => {
    expect(validarDescuentosPorRol(base)).toBeNull()
  })

  it('DUEÑO sin topes puede aplicar cualquier descuento', () => {
    expect(validarDescuentosPorRol({ ...base, global: { descuento: 90, descuento_tipo: 'pct', subtotal: 1000 } })).toBeNull()
  })

  describe('rol bloqueado (CAJERO)', () => {
    it('bloquea cualquier descuento por ítem', () => {
      const r = validarDescuentosPorRol({
        ...base, rol: 'CAJERO', bloqueadoTotal: true,
        items: [{ descuento: 5, descuento_tipo: 'pct', base: 1000 }],
      })
      expect(r).toBe('tu rol no puede aplicar descuentos')
    })
    it('bloquea descuento global', () => {
      const r = validarDescuentosPorRol({
        ...base, rol: 'CAJERO', bloqueadoTotal: true,
        global: { descuento: 100, descuento_tipo: 'monto', subtotal: 1000 },
      })
      expect(r).toBe('tu rol no puede aplicar descuentos')
    })
    it('sin descuentos no bloquea aunque esté bloqueado el rol', () => {
      expect(validarDescuentosPorRol({ ...base, rol: 'CAJERO', bloqueadoTotal: true })).toBeNull()
    })
  })

  describe('tope del SUPERVISOR', () => {
    const sup = { ...base, rol: 'SUPERVISOR', maxSupervisorPct: 10 }
    it('permite descuento por ítem en %  dentro del tope', () => {
      expect(validarDescuentosPorRol({ ...sup, items: [{ descuento: 10, descuento_tipo: 'pct', base: 1000 }] })).toBeNull()
    })
    it('bloquea descuento por ítem en % sobre el tope', () => {
      expect(validarDescuentosPorRol({ ...sup, items: [{ descuento: 15, descuento_tipo: 'pct', base: 1000 }] }))
        .toContain('supera el límite del SUPERVISOR')
    })
    it('🔴 CLAVE: bloquea descuento por MONTO que esquiva el tope %', () => {
      // $300 sobre base $1000 = 30% efectivo > tope 10% → debe bloquear (antes pasaba)
      expect(validarDescuentosPorRol({ ...sup, items: [{ descuento: 300, descuento_tipo: 'monto', base: 1000 }] }))
        .toContain('supera el límite del SUPERVISOR')
    })
    it('permite descuento por MONTO dentro del tope %', () => {
      // $80 sobre $1000 = 8% < 10% → OK
      expect(validarDescuentosPorRol({ ...sup, items: [{ descuento: 80, descuento_tipo: 'monto', base: 1000 }] })).toBeNull()
    })
    it('🔴 CLAVE: bloquea descuento GLOBAL por monto que esquiva el tope %', () => {
      expect(validarDescuentosPorRol({ ...sup, global: { descuento: 250, descuento_tipo: 'monto', subtotal: 1000 } }))
        .toContain('supera el límite del SUPERVISOR')
    })
    it('el tope del SUPERVISOR no aplica a un DUEÑO', () => {
      expect(validarDescuentosPorRol({ ...base, rol: 'DUEÑO', maxSupervisorPct: 10, items: [{ descuento: 50, descuento_tipo: 'pct', base: 1000 }] })).toBeNull()
    })
  })

  describe('tope del CANAL', () => {
    it('aplica a cualquier rol con permiso (DUEÑO incluido)', () => {
      expect(validarDescuentosPorRol({ ...base, rol: 'DUEÑO', maxCanalPct: 15, items: [{ descuento: 20, descuento_tipo: 'pct', base: 1000 }] }))
        .toContain('supera el máximo de este canal')
    })
    it('bloquea descuento por monto que esquiva el tope del canal', () => {
      expect(validarDescuentosPorRol({ ...base, rol: 'DUEÑO', maxCanalPct: 15, global: { descuento: 200, descuento_tipo: 'monto', subtotal: 1000 } }))
        .toContain('supera el máximo de este canal')
    })
    it('permite dentro del tope del canal', () => {
      expect(validarDescuentosPorRol({ ...base, rol: 'DUEÑO', maxCanalPct: 15, items: [{ descuento: 15, descuento_tipo: 'pct', base: 1000 }] })).toBeNull()
    })
  })
})
