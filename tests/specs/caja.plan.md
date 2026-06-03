# Plan de escenarios testeables — Módulo Caja

> Generado a partir del código real (`src/lib/cajaPermisos.ts`, `src/pages/CajaPage.tsx`
> arqueo/cierre/apertura/traspaso, `src/hooks/useCierreContable.ts`) + comentarios del
> relevamiento Caja (2026-05-25, B1-B7/J1-J3 referenciados en el código). Cada escenario está
> **confirmado contra el código** (no inventado).
>
> Estilo de molde: `tests/unit/ccLogic.test.ts` y `tests/unit/cajaSeña.test.ts` (Given/When/Then
> numéricos, lógica pura, `.toEqual`).
>
> **Estado actual de cobertura:** `cajaSeña.test.ts` solo cubre el cálculo de seña en ventas; la
> matriz de permisos J3 (`cajaPermisos.ts`) y TODA la lógica de arqueo (diferencia de cierre/
> apertura, umbral de alerta, clasificación de ajuste, acumulación por método, propagación de
> diferencia en traspaso) están **sin cubrir** y hoy viven inline en `CajaPage.tsx`.
>
> **Prioridad por riesgo:** 🔴 alta = mueve plata / decide alerta de descuadre · 🟡 media =
> governance/permiso · 🟢 baja = parsing/cosmético.

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Escenarios totales | 38 |
| `unit` | 38 |
| Ya cubiertos | 0 |
| Faltan | 38 |

### Candidatos a extracción a `src/lib/cajaArqueo.ts` (priorizados por ROI/riesgo)

| Prioridad | Lógica inline | Ubicación actual | Función pura sugerida | Ítem |
|---|---|---|---|---|
| 🔴 1 | Diferencia al cierre | `CajaPage.tsx:491` | `calcularDiferenciaCierre(montoRealStr, saldoSistema)` → `number\|null` | arqueo |
| 🔴 2 | ¿Supera umbral de alerta? | `CajaPage.tsx:743` | `superaUmbralDiferencia(dif, umbral)` → `boolean` | B1/B2/B3 |
| 🔴 3 | Clasificar ajuste de diferencia | `CajaPage.tsx:694-699` | `clasificarAjusteDiferencia(dif)` → `{tipo, etiqueta}` | B4 |
| 🔴 4 | Diferencia al abrir | `CajaPage.tsx:536` | `calcularDiferenciaApertura(montoReal, montoSugerido)` → `number\|null` | apertura |
| 🔴 5 | Saldo de sesión | `CajaPage.tsx:475` | `saldoSesion({apertura, ingresos, egresos})` → `number` | arqueo |
| 🔴 6 | Acumular totales por método | `CajaPage.tsx:480-487 / 643-654` | `acumularTotalesPorMetodo(movs)` → `Record<string,number>` | cierre |
| 🔴 7 | Tipo de ajuste en traspaso | `CajaPage.tsx:880-886` | `tipoAjusteTraspaso(direccion, dif)` → `'ingreso'\|'egreso'` | ISS-193 |
| 🟡 8 | Signo de movimiento | `CajaPage.tsx:483/645` | `signoMovimiento(tipo)` → `1\|-1` | cierre |
| 🟢 9 | Parsing medio de pago / nro venta | `CajaPage.tsx:41-59` | `extraerMedioPago` / `extraerNumeroVenta` | display |
| 🟡 10 | Matriz de permisos J3 | `cajaPermisos.ts` (ya pura) | `puede` / `requiereClaveMaestra` (test directo) | J3/B5/B6 |

> Las funciones 1-7 deciden plata o el descuadre de caja y hoy NO se pueden testear sin montar
> `CajaPage`. Extraerlas a `cajaArqueo.ts` (behavior-preserving) es el mayor ROI de testing del
> módulo. La 10 ya es pura: test directo sin refactor (riesgo cero).

---

## Sección 1 — Arqueo: diferencia al cierre (🔴)

**Fuente:** `CajaPage.tsx:490-491`. `montoRealNum = parseFloat(montoRealCierre) || 0`;
`diferencia = montoRealCierre !== '' ? montoRealNum - saldoActual : null`. Positivo = sobrante,
negativo = faltante, `null` = aún no contó.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-ARQ-01 | saldo sistema 10000, conteo `''` (vacío) | `calcularDiferenciaCierre('', 10000)` | `null` (no contó todavía) | unit |
| CAJA-ARQ-02 | saldo 10000, conteo `'10000'` | idem | `0` (cuadra) | unit |
| CAJA-ARQ-03 | saldo 10000, conteo `'10500'` | idem | `500` (sobrante) | unit |
| CAJA-ARQ-04 | saldo 10000, conteo `'9700'` | idem | `-300` (faltante) | unit |
| CAJA-ARQ-05 | saldo 10000, conteo `'0'` (contó cero, no vacío) | idem | `-10000` (no es null) | unit |
| CAJA-ARQ-06 | saldo 10000, conteo `'abc'` (no numérico) | idem | `-10000` (`parseFloat`→NaN→0) | unit |

## Sección 2 — Umbral de alerta de descuadre (🔴)

**Fuente:** `CajaPage.tsx:742-743`. `umbral = tenants.diferencia_caja_umbral ?? 0`;
`superaUmbral = umbral > 0 ? abs(dif) >= umbral : dif !== 0`. Umbral 0/NULL = alerta con
cualquier diferencia distinta de 0.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-UMB-01 | dif 0, umbral 0 | `superaUmbralDiferencia(0, 0)` | `false` (cuadra, no alerta) | unit |
| CAJA-UMB-02 | dif 50, umbral 0 | idem | `true` (sin umbral, cualquier dif alerta) | unit |
| CAJA-UMB-03 | dif -50, umbral 0 | idem | `true` (faltante también) | unit |
| CAJA-UMB-04 | dif 100, umbral 500 | idem | `false` (no llega al umbral) | unit |
| CAJA-UMB-05 | dif 500, umbral 500 | idem | `true` (`>=`, borde incluido) | unit |
| CAJA-UMB-06 | dif -600, umbral 500 | idem | `true` (abs supera) | unit |
| CAJA-UMB-07 | dif 0, umbral 500 | idem | `false` | unit |

## Sección 3 — Clasificación del ajuste por diferencia (🔴)

**Fuente:** `CajaPage.tsx:692-699`. Si `dif !== 0` se inserta un movimiento de ajuste:
`tipo = dif > 0 ? 'ingreso' : 'egreso'`; concepto sobrante/faltante. Si `dif === 0` no se inserta.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-AJU-01 | dif 0 | `clasificarAjusteDiferencia(0)` | `{tipo:null, etiqueta:'exacto'}` (sin movimiento) | unit |
| CAJA-AJU-02 | dif 500 | idem | `{tipo:'ingreso', etiqueta:'sobrante'}` | unit |
| CAJA-AJU-03 | dif -300 | idem | `{tipo:'egreso', etiqueta:'faltante'}` | unit |

## Sección 4 — Diferencia al abrir (🔴)

**Fuente:** `CajaPage.tsx:535-536`. `difApertura = montoSugerido !== null ? montoReal -
montoSugerido : null`. El sugerido viene del cierre anterior; si no hay, no se calcula diferencia.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-APE-01 | sugerido null (sin cierre previo) | `calcularDiferenciaApertura(5000, null)` | `null` | unit |
| CAJA-APE-02 | sugerido 5000, real 5000 | idem | `0` | unit |
| CAJA-APE-03 | sugerido 5000, real 5200 | idem | `200` | unit |
| CAJA-APE-04 | sugerido 5000, real 4800 | idem | `-200` | unit |

## Sección 5 — Saldo de sesión (🔴)

**Fuente:** `CajaPage.tsx:475`. `saldoActual = apertura + totalIngresos - totalEgresos`.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-SAL-01 | apertura 1000, ingresos 5000, egresos 2000 | `saldoSesion({apertura:1000, ingresos:5000, egresos:2000})` | `4000` | unit |
| CAJA-SAL-02 | apertura 0, ingresos 0, egresos 0 | idem | `0` | unit |
| CAJA-SAL-03 | apertura 1000, ingresos 0, egresos 1500 | idem | `-500` (puede quedar negativo) | unit |

## Sección 6 — Acumulación de totales por método (🔴)

**Fuente:** `CajaPage.tsx:480-487`. Por cada movimiento: `medio = extraerMedioPago(tipo,
concepto)`; si vacío se ignora; `signo = egreso* ? -1 : 1`; `map[medio] += signo * monto`.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-MET-01 | ingreso Efectivo 1000 + egreso Efectivo 300 | `acumularTotalesPorMetodo([...])` | `{Efectivo: 700}` | unit |
| CAJA-MET-02 | ingreso_informativo `[Tarjeta] venta` 2000 | idem | `{Tarjeta: 2000}` | unit |
| CAJA-MET-03 | mov con medio vacío (tipo desconocido) | idem | se ignora (no entra al map) | unit |
| CAJA-MET-04 | ingreso_traspaso 500 + egreso_traspaso 200 | idem | `{Traspaso: 300}` | unit |
| CAJA-MET-05 | lista vacía | idem | `{}` | unit |

## Sección 7 — Signo de movimiento (🟡)

**Fuente:** `CajaPage.tsx:483/645`. `['egreso','egreso_informativo','egreso_devolucion_sena',
'egreso_traspaso'].includes(tipo) ? -1 : 1`.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-SGN-01 | `'ingreso'` | `signoMovimiento('ingreso')` | `1` | unit |
| CAJA-SGN-02 | `'egreso'` | idem | `-1` | unit |
| CAJA-SGN-03 | `'egreso_traspaso'` | idem | `-1` | unit |
| CAJA-SGN-04 | `'ingreso_traspaso'` | idem | `1` | unit |
| CAJA-SGN-05 | `'egreso_devolucion_sena'` | idem | `-1` | unit |

## Sección 8 — Tipo de ajuste en corrección de traspaso (🔴 ISS-193)

**Fuente:** `CajaPage.tsx:880-886`. Al corregir un movimiento que es parte de un traspaso, la
diferencia `dif = nuevoMonto - montoOriginal` se propaga a la caja contraparte.
- `propagarAOrigen` (corregí el destino): `dif < 0 ? 'ingreso' : 'egreso'`.
- `propagarADestino` (corregí el origen): `dif < 0 ? 'egreso' : 'ingreso'`.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-TRA-01 | a_origen, dif -100 (destino recibió menos) | `tipoAjusteTraspaso('a_origen', -100)` | `'ingreso'` (origen recupera) | unit |
| CAJA-TRA-02 | a_origen, dif 100 (destino recibió más) | idem | `'egreso'` (origen pone extra) | unit |
| CAJA-TRA-03 | a_destino, dif -100 (origen egresó menos) | `tipoAjusteTraspaso('a_destino', -100)` | `'egreso'` (destino recibe menos) | unit |
| CAJA-TRA-04 | a_destino, dif 100 | idem | `'ingreso'` | unit |

## Sección 9 — Parsing de display (🟢)

**Fuente:** `CajaPage.tsx:41-59`.

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-PAR-01 | concepto `'Venta #198'` | `extraerNumeroVenta(c)` | `'198'` | unit |
| CAJA-PAR-02 | concepto sin `#` | idem | `null` | unit |
| CAJA-PAR-03 | tipo `ingreso_informativo`, `'[Tarjeta] x'` | `extraerMedioPago(t,c)` | `'Tarjeta'` | unit |
| CAJA-PAR-04 | tipo `ingreso_informativo`, concepto sin `[..]` | idem | `'No efectivo'` | unit |
| CAJA-PAR-05 | tipo `ingreso` | idem | `'Efectivo'` | unit |
| CAJA-PAR-06 | tipo `egreso_traspaso` | idem | `'Traspaso'` | unit |
| CAJA-PAR-07 | tipo desconocido | idem | `''` | unit |

## Sección 10 — Matriz de permisos J3 (🟡)

**Fuente:** `cajaPermisos.ts` (ya es lógica pura, test directo sin refactor).

| # | Given | When | Then | Tipo |
|---|---|---|---|---|
| CAJA-PER-01 | rol null | `puede(null, 'abrir_propia')` | `false` | unit |
| CAJA-PER-02 | CAJERO, abrir_propia | `puede('CAJERO', 'abrir_propia')` | `true` | unit |
| CAJA-PER-03 | CAJERO, abrir_ajena | idem | `false` (solo DUEÑO/SUPERVISOR/ADMIN) | unit |
| CAJA-PER-04 | SUPERVISOR, ver_boveda_saldo, sin config | `puede('SUPERVISOR','ver_boveda_saldo')` | `false` (opcional, no habilitado) | unit |
| CAJA-PER-05 | SUPERVISOR, ver_boveda_saldo, config `{supervisor_puede_ver_boveda:true}` | idem con config | `true` | unit |
| CAJA-PER-06 | SUPERVISOR, cambiar_clave_maestra | idem | `false` (B6 estricto: solo DUEÑO) | unit |
| CAJA-PER-07 | CONTADOR, ver_lectura_solo | idem | `true` (J1 read-only) | unit |
| CAJA-PER-08 | CONTADOR, ingreso_manual | idem | `false` | unit |
| CAJA-PER-09 | clave maestra configurada, `cerrar_ajena` | `requiereClaveMaestra('cerrar_ajena', true)` | `true` (B5) | unit |
| CAJA-PER-10 | clave NO configurada, `cerrar_ajena` | `requiereClaveMaestra('cerrar_ajena', false)` | `false` | unit |
| CAJA-PER-11 | clave configurada, `abrir_propia` | `requiereClaveMaestra('abrir_propia', true)` | `false` (no está en la lista) | unit |

---

## Notas de implementación

- **`cajaArqueo.ts`** centraliza las funciones puras 1-9. Rewire **behavior-preserving** en
  `CajaPage.tsx`: reemplazar los cálculos inline + las funciones locales `extraerMedioPago`/
  `extraerNumeroVenta`/`signoMovimiento` por imports. Sin cambio de comportamiento ni migración.
- **`cajaPermisos.ts`** no se toca: ya es pura, solo se le agregan tests (sección 10).
- Quedan fuera del alcance unit (requieren Supabase / e2e): apertura de caja ajena (A2),
  bloqueo CAJERO multi-sesión (B2), validación de clave maestra real al cerrar (B5),
  propagación efectiva del ajuste de traspaso a la DB (ISS-193 end-to-end).
