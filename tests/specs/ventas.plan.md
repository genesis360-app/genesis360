# Plan de escenarios testeables — Módulo Ventas (gaps de cobertura)

> Generado a partir del código real (`src/lib/ventasValidation.ts`, `src/lib/permisosCosto.ts`,
> `src/lib/umbralGasto.ts`) + `relevamiento_ventas_respuestas.md` (G4). Confirmado contra el código.
>
> Estilo de molde: `tests/unit/ventasValidation.test.ts`, `ventasSaldo.test.ts` (lógica pura).
>
> **Estado actual de cobertura:** la mayoría de `ventasValidation.ts` ya está cubierta
> (`calcularSaldoPendiente`, `validarSaldoMediosPago`, `acumularMediosPago`, `validarDespacho`,
> `calcularVuelto`, `calcularEfectivoCaja`, `calcularComboRows`, `restaurarMediosPago`,
> `calcularLpnFuentes`, `esDecimal`, `parseCantidad`, `validarMediosPago`). **Gaps detectados:**
> - `calcularDescuentoComboMulti` (descuento de combo pct / monto / monto_usd) → **SIN cubrir**.
> - `permisosCosto.ts::puedeVerCosto` (G4 — costo/margen oculto a CAJERO/DEPOSITO) → **sin test**.
> - `umbralGasto.ts::evaluarUmbralGasto` + `puedeAprobar` (autorización de gasto por rol/umbral)
>   → **sin test**.
>
> **Prioridad por riesgo:** 🔴 alta = mueve plata (descuento) / autoriza gasto · 🟡 media =
> visibilidad de dato sensible.

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Escenarios totales | 22 |
| `unit` | 22 |
| Faltan | 22 |

---

## Sección 1 — Descuento de combo multi (🔴 VEN-COMBO)

**Fuente:** `ventasValidation.ts::calcularDescuentoComboMulti`. `descuento_tipo` default `'pct'`.
- `pct`: `subtotalCombo * pct / 100`.
- `monto_usd`: `descuento_monto * cotizacionUSD`.
- otro (monto fijo en moneda local): `descuento_monto`.

| # | Given | When | Then |
|---|---|---|---|
| VEN-COMBO-01 | combo 10% sobre subtotal 1000 | `calcularDescuentoComboMulti({descuento_tipo:'pct',descuento_pct:10},1000)` | `100` |
| VEN-COMBO-02 | sin tipo (default pct) 20% sobre 500 | `({descuento_pct:20},500)` | `100` |
| VEN-COMBO-03 | pct sin valor → 0 | `({descuento_tipo:'pct'},1000)` | `0` |
| VEN-COMBO-04 | monto fijo local 150 | `({descuento_tipo:'monto',descuento_monto:150},1000)` | `150` |
| VEN-COMBO-05 | monto_usd 10 a cotización 1200 | `({descuento_tipo:'monto_usd',descuento_monto:10},1000,1200)` | `12000` |
| VEN-COMBO-06 | monto_usd sin cotización (default 1) | `({descuento_tipo:'monto_usd',descuento_monto:10},1000)` | `10` |
| VEN-COMBO-07 | monto sin valor → 0 | `({descuento_tipo:'monto'},1000)` | `0` |

## Sección 2 — Visibilidad de costo/margen G4 (🟡 VEN-COSTO)

**Fuente:** `permisosCosto.ts::puedeVerCosto`. Ven costo: DUEÑO, SUPERVISOR, ADMIN, CONTADOR,
SUPER_USUARIO. Ocultos: CAJERO, DEPOSITO, RRHH, null.

| # | Given | When | Then |
|---|---|---|---|
| VEN-COSTO-01 | null | `puedeVerCosto(null)` | `false` |
| VEN-COSTO-02 | DUEÑO | `puedeVerCosto('DUEÑO')` | `true` |
| VEN-COSTO-03 | CONTADOR | `puedeVerCosto('CONTADOR')` | `true` |
| VEN-COSTO-04 | CAJERO | `puedeVerCosto('CAJERO')` | `false` |
| VEN-COSTO-05 | DEPOSITO | `puedeVerCosto('DEPOSITO')` | `false` |
| VEN-COSTO-06 | RRHH | `puedeVerCosto('RRHH')` | `false` |

## Sección 3 — Umbral de gasto por rol (🔴 VEN-UMBRAL)

**Fuente:** `umbralGasto.ts::evaluarUmbralGasto`.
- DUEÑO/ADMIN/SUPER_USUARIO → no aplica (libre).
- SUPERVISOR → umbral `umbral_gasto_supervisor`; NULL = libre; supera → aprueba DUEÑO.
- CAJERO → umbral `umbral_gasto_cajero`; NULL = todo requiere autorización; aprueba SUPERVISOR.

| # | Given | When | Then |
|---|---|---|---|
| VEN-UMBRAL-01 | rol null | `evaluarUmbralGasto(null, suc, 100)` | `{aplica:false, umbral:null, superado:false, rolMinimoAprobador:null}` |
| VEN-UMBRAL-02 | DUEÑO | `evaluarUmbralGasto('DUEÑO', suc, 99999)` | no aplica (libre) |
| VEN-UMBRAL-03 | SUPERVISOR, umbral 5000, monto 3000 | dentro del umbral | `{aplica:true, umbral:5000, superado:false, rolMinimoAprobador:'DUEÑO'}` |
| VEN-UMBRAL-04 | SUPERVISOR, umbral 5000, monto 6000 | supera | `superado:true, rolMinimoAprobador:'DUEÑO'` |
| VEN-UMBRAL-05 | SUPERVISOR, umbral NULL | sin restricción | `aplica:false` |
| VEN-UMBRAL-06 | CAJERO, umbral 2000, monto 1500 | dentro | `{aplica:true, umbral:2000, superado:false, rolMinimoAprobador:'SUPERVISOR'}` |
| VEN-UMBRAL-07 | CAJERO, umbral 2000, monto 2500 | supera | `superado:true` |
| VEN-UMBRAL-08 | CAJERO, umbral NULL | todo requiere autorización | `{aplica:true, umbral:null, superado:true, rolMinimoAprobador:'SUPERVISOR'}` |
| VEN-UMBRAL-09 | CONTADOR (no crea gastos) | `evaluarUmbralGasto('CONTADOR', suc, 100)` | no aplica |

## Sección 4 — Cadena de aprobación (🔴 VEN-APROB)

**Fuente:** `umbralGasto.ts::puedeAprobar`.

| # | Given | When | Then |
|---|---|---|---|
| VEN-APROB-01 | solicita CAJERO, aprueba SUPERVISOR | `puedeAprobar('CAJERO','SUPERVISOR')` | `true` |
| VEN-APROB-02 | solicita CAJERO, aprueba otro CAJERO | `puedeAprobar('CAJERO','CAJERO')` | `false` |
| VEN-APROB-03 | solicita SUPERVISOR, aprueba SUPERVISOR | `puedeAprobar('SUPERVISOR','SUPERVISOR')` | `false` (necesita DUEÑO+) |
| VEN-APROB-04 | solicita SUPERVISOR, aprueba DUEÑO | `puedeAprobar('SUPERVISOR','DUEÑO')` | `true` |

---

## Notas

- Las 3 libs ya son lógica pura: solo se agregan tests (sin refactor).
- El resto de `ventasValidation.ts` queda cubierto por los test files de Ventas existentes.
