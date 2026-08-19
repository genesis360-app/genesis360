import { describe, it, expect } from 'vitest'
import { validarMediosPago, validarDescuentosPorRol, descuentoEfectivoPct, calcularVuelto, calcularEfectivoCaja, calcularEfectivoPorMoneda, carritoAceptaUsd, type ValidarDescuentosArgs } from '@/lib/ventasValidation'

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
// Fase 1 Caja USD (G5, mig 368, A3): 'Efectivo' hardcodeado → lista `mediosEfectivo` por tenant. El
// default preserva el comportamiento de siempre (solo 'Efectivo'); un tenant real pasa el set de
// metodos_pago.es_efectivo (podría incluir "Efectivo USD" el día que exista).
describe('calcularVuelto / calcularEfectivoCaja — mediosEfectivo (mig 368)', () => {
  it('sin 2do parámetro: se comporta igual que siempre (solo "Efectivo" da vuelto)', () => {
    const medios = [{ tipo: 'Efectivo', monto: '1500' }]
    expect(calcularVuelto(medios, 1000)).toBe(500)
    expect(calcularEfectivoCaja(medios, 1000)).toBe(1000)
  })

  it('un medio que NO está en mediosEfectivo no da vuelto ni cuenta como efectivo en caja', () => {
    const medios = [{ tipo: 'Efectivo USD', monto: '1500' }]
    expect(calcularVuelto(medios, 1000)).toBe(0) // 'Efectivo USD' no está en el set default → no reconocido
    expect(calcularEfectivoCaja(medios, 1000)).toBe(0)
  })

  it('con el set real del tenant, "Efectivo USD" se reconoce igual que "Efectivo"', () => {
    const mediosEfectivo = new Set(['Efectivo', 'Efectivo USD'])
    const medios = [{ tipo: 'Efectivo USD', monto: '1500' }]
    expect(calcularVuelto(medios, 1000, mediosEfectivo)).toBe(500)
    expect(calcularEfectivoCaja(medios, 1000, mediosEfectivo)).toBe(1000)
  })

  it('mezcla: efectivo real + otro medio no-efectivo, con set custom', () => {
    const mediosEfectivo = new Set(['Efectivo USD'])
    const medios = [{ tipo: 'Efectivo USD', monto: '800' }, { tipo: 'Tarjeta débito', monto: '200' }]
    expect(calcularVuelto(medios, 1000, mediosEfectivo)).toBe(0) // cubre justo, sin vuelto
    expect(calcularEfectivoCaja(medios, 1000, mediosEfectivo)).toBe(800)
  })
})

describe('validarMediosPago — mediosEfectivo (mig 368)', () => {
  it('excedente cubierto por un medio del set custom se permite (vuelto)', () => {
    const mediosEfectivo = new Set(['Efectivo USD'])
    expect(validarMediosPago('despachada', [{ tipo: 'Efectivo USD', monto: '1500' }], 1000, mediosEfectivo)).toBeNull()
  })
  it('excedente de un medio FUERA del set custom se rechaza', () => {
    const mediosEfectivo = new Set(['Efectivo USD'])
    expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '1500' }], 1000, mediosEfectivo)).not.toBeNull()
  })
})

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

// ─────────────────────────────────────────────────────────────────────────────
// G5 Fase 4 — pago combinado ARS+USD (D2/D3)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcularEfectivoPorMoneda', () => {
  const efectivo = new Set(['Efectivo'])
  const efectivoConUsd = new Set(['Efectivo', 'Efectivo USD'])
  const soloUsd = new Set(['Efectivo USD'])

  it('sin USD: se comporta igual que calcularEfectivoCaja (arsNeto = neto, usdIngreso = 0)', () => {
    const medios = [{ tipo: 'Efectivo', monto: '1200' }]
    const r = calcularEfectivoPorMoneda(medios, 1000, efectivo, new Set())
    expect(r.arsNeto).toBe(1000)   // 1200 recibidos - 200 de vuelto
    expect(r.usdIngreso).toBe(0)
    expect(r.vueltoArs).toBe(200)
  })

  it('mixto ARS+USD exacto, sin vuelto: cada sesión recibe justo lo suyo', () => {
    // Total $1300. Paga $500 ARS efectivo + USD 50 (equivalente $800 a cotización 16) = $1300 exacto.
    const medios = [
      { tipo: 'Efectivo', monto: '500' },
      { tipo: 'Efectivo USD', monto: '800', montoUsd: '50' },
    ]
    const r = calcularEfectivoPorMoneda(medios, 1300, efectivoConUsd, soloUsd)
    expect(r.arsNeto).toBe(500)
    expect(r.usdIngreso).toBe(50)
    expect(r.vueltoArs).toBe(0)
  })

  it('sobrepago viene del lado ARS: el vuelto sale de la sesión ARS, USD no se toca', () => {
    // Total $1000. Paga $700 ARS + USD 20 ($320 equiv) = $1020 → $20 de vuelto.
    const medios = [
      { tipo: 'Efectivo', monto: '700' },
      { tipo: 'Efectivo USD', monto: '320', montoUsd: '20' },
    ]
    const r = calcularEfectivoPorMoneda(medios, 1000, efectivoConUsd, soloUsd)
    expect(r.vueltoArs).toBe(20)
    expect(r.arsNeto).toBe(680)   // 700 - 20 de vuelto
    expect(r.usdIngreso).toBe(20) // dólares completos, sin netear
  })

  it('🔴 CLAVE (D1+D3): sobrepago viene ENTERO del lado USD → vuelto en pesos deja la sesión ARS en negativo (egreso), USD se acredita completo igual', () => {
    // Total $100. Solo paga USD 20 ($200 equiv, cotización 10) → sobra $100 de vuelto en pesos.
    const medios = [{ tipo: 'Efectivo USD', monto: '200', montoUsd: '20' }]
    const r = calcularEfectivoPorMoneda(medios, 100, soloUsd, soloUsd)
    expect(r.vueltoArs).toBe(100)
    expect(r.arsNeto).toBe(-100)  // egreso: hay que sacar $100 pesos de la caja ARS para el vuelto
    expect(r.usdIngreso).toBe(20) // los 20 dólares reales entran completos a la Caja USD
  })

  it('solo USD, exacto: arsNeto en 0, usdIngreso el total', () => {
    const medios = [{ tipo: 'Efectivo USD', monto: '500', montoUsd: '50' }]
    const r = calcularEfectivoPorMoneda(medios, 500, soloUsd, soloUsd)
    expect(r.arsNeto).toBe(0)
    expect(r.usdIngreso).toBe(50)
  })

  it('sin mediosEfectivoUsd (default): nunca separa USD, todo cae como ARS', () => {
    const medios = [{ tipo: 'Efectivo USD', monto: '500', montoUsd: '50' }]
    const r = calcularEfectivoPorMoneda(medios, 500, new Set(['Efectivo USD']))
    expect(r.usdIngreso).toBe(0)
  })

  it('🔴 CLAVE: montoUsd ausente en un medio USD-efectivo — la función NO inventa un ingreso ARS con ese monto (queda en 0 en ambos lados; el guard real que evita perder la plata vive en VentasPage.tsx: updateMedioPago resetea monto al cambiar tipo + registrarVenta bloquea si detecta este estado)', () => {
    const medios = [{ tipo: 'Efectivo USD', monto: '500' }]
    const r = calcularEfectivoPorMoneda(medios, 500, soloUsd, soloUsd)
    expect(r.usdIngreso).toBe(0)
    expect(r.arsNeto).toBe(0)
  })
})

describe('carritoAceptaUsd', () => {
  it('carrito vacío → false (nada que validar, más seguro bloquear)', () => {
    expect(carritoAceptaUsd([])).toBe(false)
  })
  it('todos los ítems ya priceados en USD → true', () => {
    expect(carritoAceptaUsd([{ moneda_venta: 'usd' }, { moneda_venta: 'usd' }])).toBe(true)
  })
  it('todos con acepta_cualquier_moneda → true', () => {
    expect(carritoAceptaUsd([{ moneda_venta: 'local', acepta_cualquier_moneda: true }])).toBe(true)
  })
  it('mezcla válida (uno en USD, otro con el flag) → true', () => {
    expect(carritoAceptaUsd([{ moneda_venta: 'usd' }, { moneda_venta: 'local', acepta_cualquier_moneda: true }])).toBe(true)
  })
  it('🔴 CLAVE: un solo ítem sin ninguna de las 2 condiciones bloquea TODA la venta en USD', () => {
    expect(carritoAceptaUsd([
      { moneda_venta: 'usd' },
      { moneda_venta: 'local', acepta_cualquier_moneda: false },
    ])).toBe(false)
  })
  it('producto local sin flag (default) → false', () => {
    expect(carritoAceptaUsd([{ moneda_venta: 'local' }])).toBe(false)
  })
})
