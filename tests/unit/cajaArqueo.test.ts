import { describe, it, expect } from 'vitest'
import {
  signoMovimiento,
  saldoSesion,
  calcularDiferenciaCierre,
  calcularDiferenciaApertura,
  superaUmbralDiferencia,
  clasificarAjusteDiferencia,
  tipoAjusteTraspaso,
  extraerNumeroVenta,
  extraerMedioPago,
  acumularTotalesPorMetodo,
} from '@/lib/cajaArqueo'

// Plan: tests/specs/caja.plan.md (secciones 1-9)

// ─────────────────────────────────────────────────────────────────────────────
// Sección 1 — Diferencia al cierre (CAJA-ARQ)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcularDiferenciaCierre', () => {
  it('CAJA-ARQ-01 conteo vacío → null (no contó)', () => {
    expect(calcularDiferenciaCierre('', 10000)).toBeNull()
  })
  it('CAJA-ARQ-02 cuadra → 0', () => {
    expect(calcularDiferenciaCierre('10000', 10000)).toBe(0)
  })
  it('CAJA-ARQ-03 sobrante → positivo', () => {
    expect(calcularDiferenciaCierre('10500', 10000)).toBe(500)
  })
  it('CAJA-ARQ-04 faltante → negativo', () => {
    expect(calcularDiferenciaCierre('9700', 10000)).toBe(-300)
  })
  it('CAJA-ARQ-05 conteo "0" no es vacío → -saldo', () => {
    expect(calcularDiferenciaCierre('0', 10000)).toBe(-10000)
  })
  it('CAJA-ARQ-06 conteo no numérico → parseFloat NaN→0', () => {
    expect(calcularDiferenciaCierre('abc', 10000)).toBe(-10000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 2 — Umbral de alerta (CAJA-UMB)
// ─────────────────────────────────────────────────────────────────────────────
describe('superaUmbralDiferencia', () => {
  it('CAJA-UMB-01 dif 0, umbral 0 → false', () => {
    expect(superaUmbralDiferencia(0, 0)).toBe(false)
  })
  it('CAJA-UMB-02 dif 50, umbral 0 → true (cualquier dif alerta)', () => {
    expect(superaUmbralDiferencia(50, 0)).toBe(true)
  })
  it('CAJA-UMB-03 dif -50, umbral 0 → true (faltante)', () => {
    expect(superaUmbralDiferencia(-50, 0)).toBe(true)
  })
  it('CAJA-UMB-04 dif 100, umbral 500 → false', () => {
    expect(superaUmbralDiferencia(100, 500)).toBe(false)
  })
  it('CAJA-UMB-05 dif 500, umbral 500 → true (borde >=)', () => {
    expect(superaUmbralDiferencia(500, 500)).toBe(true)
  })
  it('CAJA-UMB-06 dif -600, umbral 500 → true (abs)', () => {
    expect(superaUmbralDiferencia(-600, 500)).toBe(true)
  })
  it('CAJA-UMB-07 dif 0, umbral 500 → false', () => {
    expect(superaUmbralDiferencia(0, 500)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 3 — Clasificación del ajuste (CAJA-AJU)
// ─────────────────────────────────────────────────────────────────────────────
describe('clasificarAjusteDiferencia', () => {
  it('CAJA-AJU-01 dif 0 → sin movimiento', () => {
    expect(clasificarAjusteDiferencia(0)).toEqual({ tipo: null, etiqueta: 'exacto' })
  })
  it('CAJA-AJU-02 dif 500 → ingreso sobrante', () => {
    expect(clasificarAjusteDiferencia(500)).toEqual({ tipo: 'ingreso', etiqueta: 'sobrante' })
  })
  it('CAJA-AJU-03 dif -300 → egreso faltante', () => {
    expect(clasificarAjusteDiferencia(-300)).toEqual({ tipo: 'egreso', etiqueta: 'faltante' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 4 — Diferencia al abrir (CAJA-APE)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcularDiferenciaApertura', () => {
  it('CAJA-APE-01 sin sugerido → null', () => {
    expect(calcularDiferenciaApertura(5000, null)).toBeNull()
  })
  it('CAJA-APE-02 coincide → 0', () => {
    expect(calcularDiferenciaApertura(5000, 5000)).toBe(0)
  })
  it('CAJA-APE-03 ingresó de más → positivo', () => {
    expect(calcularDiferenciaApertura(5200, 5000)).toBe(200)
  })
  it('CAJA-APE-04 ingresó de menos → negativo', () => {
    expect(calcularDiferenciaApertura(4800, 5000)).toBe(-200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 5 — Saldo de sesión (CAJA-SAL)
// ─────────────────────────────────────────────────────────────────────────────
describe('saldoSesion', () => {
  it('CAJA-SAL-01 apertura + ingresos - egresos', () => {
    expect(saldoSesion({ apertura: 1000, ingresos: 5000, egresos: 2000 })).toBe(4000)
  })
  it('CAJA-SAL-02 todo cero → 0', () => {
    expect(saldoSesion({ apertura: 0, ingresos: 0, egresos: 0 })).toBe(0)
  })
  it('CAJA-SAL-03 puede quedar negativo', () => {
    expect(saldoSesion({ apertura: 1000, ingresos: 0, egresos: 1500 })).toBe(-500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 6 — Acumulación por método (CAJA-MET)
// ─────────────────────────────────────────────────────────────────────────────
describe('acumularTotalesPorMetodo', () => {
  it('CAJA-MET-01 ingreso y egreso de Efectivo se netean', () => {
    expect(acumularTotalesPorMetodo([
      { tipo: 'ingreso', concepto: 'Venta #1', monto: 1000 },
      { tipo: 'egreso', concepto: 'Retiro', monto: 300 },
    ])).toEqual({ Efectivo: 700 })
  })
  it('CAJA-MET-02 informativo lee medio entre corchetes', () => {
    expect(acumularTotalesPorMetodo([
      { tipo: 'ingreso_informativo', concepto: '[Tarjeta] venta', monto: 2000 },
    ])).toEqual({ Tarjeta: 2000 })
  })
  it('CAJA-MET-03 medio vacío se ignora', () => {
    expect(acumularTotalesPorMetodo([
      { tipo: 'tipo_desconocido', concepto: 'x', monto: 999 },
    ])).toEqual({})
  })
  it('CAJA-MET-04 traspasos se netean bajo Traspaso', () => {
    expect(acumularTotalesPorMetodo([
      { tipo: 'ingreso_traspaso', concepto: 't', monto: 500 },
      { tipo: 'egreso_traspaso', concepto: 't', monto: 200 },
    ])).toEqual({ Traspaso: 300 })
  })
  it('CAJA-MET-05 lista vacía → {}', () => {
    expect(acumularTotalesPorMetodo([])).toEqual({})
  })
  it('CAJA-MET-06 egreso_informativo netea negativo bajo su medio (review v1.23.2)', () => {
    expect(acumularTotalesPorMetodo([
      { tipo: 'ingreso_informativo', concepto: '[Tarjeta] venta', monto: 2000 },
      { tipo: 'egreso_informativo', concepto: '[Tarjeta] devolución', monto: 500 },
    ])).toEqual({ Tarjeta: 1500 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 7 — Signo de movimiento (CAJA-SGN)
// ─────────────────────────────────────────────────────────────────────────────
describe('signoMovimiento', () => {
  it('CAJA-SGN-01 ingreso → +1', () => expect(signoMovimiento('ingreso')).toBe(1))
  it('CAJA-SGN-02 egreso → -1', () => expect(signoMovimiento('egreso')).toBe(-1))
  it('CAJA-SGN-03 egreso_traspaso → -1', () => expect(signoMovimiento('egreso_traspaso')).toBe(-1))
  it('CAJA-SGN-04 ingreso_traspaso → +1', () => expect(signoMovimiento('ingreso_traspaso')).toBe(1))
  it('CAJA-SGN-05 egreso_devolucion_sena → -1', () => expect(signoMovimiento('egreso_devolucion_sena')).toBe(-1))
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 8 — Ajuste de traspaso (CAJA-TRA)
// ─────────────────────────────────────────────────────────────────────────────
describe('tipoAjusteTraspaso', () => {
  it('CAJA-TRA-01 a_origen, dif<0 → ingreso (origen recupera)', () => {
    expect(tipoAjusteTraspaso('a_origen', -100)).toBe('ingreso')
  })
  it('CAJA-TRA-02 a_origen, dif>0 → egreso (origen pone extra)', () => {
    expect(tipoAjusteTraspaso('a_origen', 100)).toBe('egreso')
  })
  it('CAJA-TRA-03 a_destino, dif<0 → egreso (destino recibe menos)', () => {
    expect(tipoAjusteTraspaso('a_destino', -100)).toBe('egreso')
  })
  it('CAJA-TRA-04 a_destino, dif>0 → ingreso', () => {
    expect(tipoAjusteTraspaso('a_destino', 100)).toBe('ingreso')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 9 — Parsing de display (CAJA-PAR)
// ─────────────────────────────────────────────────────────────────────────────
describe('extraerNumeroVenta', () => {
  it('CAJA-PAR-01 extrae el número', () => expect(extraerNumeroVenta('Venta #198')).toBe('198'))
  it('CAJA-PAR-02 sin # → null', () => expect(extraerNumeroVenta('Ingreso manual')).toBeNull())
})

describe('extraerMedioPago', () => {
  it('CAJA-PAR-03 informativo con corchetes → el medio', () => {
    expect(extraerMedioPago('ingreso_informativo', '[Tarjeta] x')).toBe('Tarjeta')
  })
  it('CAJA-PAR-04 informativo sin corchetes → No efectivo', () => {
    expect(extraerMedioPago('ingreso_informativo', 'sin marca')).toBe('No efectivo')
  })
  it('CAJA-PAR-05 ingreso → Efectivo', () => {
    expect(extraerMedioPago('ingreso', 'Venta #1')).toBe('Efectivo')
  })
  it('CAJA-PAR-06 egreso_traspaso → Traspaso', () => {
    expect(extraerMedioPago('egreso_traspaso', 't')).toBe('Traspaso')
  })
  it('CAJA-PAR-07 tipo desconocido → vacío', () => {
    expect(extraerMedioPago('foo', 'bar')).toBe('')
  })
})
