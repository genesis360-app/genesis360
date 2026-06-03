---
title: Testing — Unit + E2E
category: development
tags: [testing, vitest, playwright, e2e, unit-tests]
sources: [CLAUDE.md]
updated: 2026-06-03
---

# Testing

Genesis360 tiene cobertura con **Vitest** (unit tests) + **Playwright** (E2E).  
Total al 2026-06-03: **228 unit tests** (12 archivos) · **16 archivos E2E spec** (todos los roles)

> **Pipeline de QA con agentes (v1.23.1):** el ciclo `relevamiento → spec-extractor → test-author → test-runner → bug-fixer` está soportado por subagentes de proyecto (ver [[wiki/development/agentes-claude-code]]). El plan de escenarios por módulo vive en `tests/specs/<modulo>.plan.md`.

---

## Unit Tests (Vitest)

**Comando:** `npm run test:unit`  
**Config:** `vitest.config.ts`

### Archivos de tests

| Archivo | Qué prueba | Tests |
|---------|-----------|-------|
| `tests/unit/rebajeSort.test.ts` | FIFO/LIFO/FEFO/LEFO/Manual, jerarquía, prioridades | ~20 |
| `tests/unit/brand.test.ts` | Planes, features, límites de movimientos, PLAN_REQUERIDO | ~10 |
| `tests/unit/planLimits.test.ts` | Cálculo límites, add-ons, trial activo/vencido | ~10 |
| `tests/unit/insights.rules.test.ts` | Cobertura crítica, margen realizado, días flojos | ~10 |
| `tests/unit/ventasValidation.test.ts` | Medios de pago, validación, 12 casos | 12 |
| `tests/unit/ventasSaldo.test.ts` | calcularSaldoPendiente, validarSaldoMediosPago, validarDespacho, acumularMediosPago | 24 |
| `tests/unit/ventasCaja.test.ts` | calcularVuelto, calcularEfectivoCaja, calcularComboRows, restaurarMediosPago | 24 |
| `tests/unit/cajaSeña.test.ts` | Seña en caja, cancelación, `calcularDevolucion` | 7+ casos |
| `tests/unit/skuAuto.test.ts` | Generación SKU-XXXXX secuencial | 8 |
| `tests/unit/lpnFuentes.test.ts` | calcularLpnFuentes: unitarios + integración sort+fuentes | 21 |
| `tests/unit/ventasCantidad.test.ts` | esDecimal, parseCantidad, cantidades decimales | 24 |
| `tests/unit/ccLogic.test.ts` | **Cuenta corriente clientes (v1.23.1)**: evaluarLimiteCC (B1), evaluarMorosidad (B4), calcularInteresMora (B3), calcularEstadoCC, planificarCobranzaFIFO (B5), agruparAgingCC (G1) | 50 |

### Qué se testea

Solo **funciones puras** sin Supabase:
- Lógica de selección de stock (rebajeSort)
- Validación de ventas (ventasValidation)
- Cálculo de pagos, vuelto, saldo
- Reglas de negocio de insights
- Límites de planes
- Generación de SKU
- Cálculo de LPN fuentes

### Herramientas

```bash
npm run test:unit          # run once
npm run test:unit:watch    # watch mode
npm run test:unit:coverage # coverage report
```

---

## E2E Tests (Playwright)

**Comando:** `npm run test:e2e`  
**Config:** `playwright.config.ts`  
**Requiere:** `tests/e2e/.env.test.local` con `E2E_EMAIL` y `E2E_PASSWORD`

### Usuarios de prueba DEV

| Rol | Email | Contraseña |
|-----|-------|-----------|
| OWNER | `e2e@genesis360.test` | `123` |
| CAJERO | `cajero1@local.com` | `123` |
| RRHH | `rrhh1@local.com` | `123` |
| SUPERVISOR | `supervisor@test.com` | `123` |
| DEPOSITO | *(pendiente)* | — |
| CONTADOR | *(pendiente)* | — |

### Archivos E2E spec

| Archivo | Módulo | Estado |
|---------|--------|-------|
| `01_dashboard.spec.ts` | Dashboard | ✅ |
| `02_productos.spec.ts` | Productos | ✅ |
| `03_inventario.spec.ts` | Inventario | ✅ |
| `04_ventas.spec.ts` | Ventas | ✅ |
| `05_caja.spec.ts` | Caja | ✅ |
| `06_gastos.spec.ts` | Gastos | ✅ |
| `07_clientes.spec.ts` | Clientes | ✅ |
| `08_alertas.spec.ts` | Alertas | ✅ |
| `09_reportes.spec.ts` | Reportes | ✅ |
| `10_rrhh.spec.ts` | RRHH | ✅ |
| `13_rol_cajero.spec.ts` | Rol CAJERO | ✅ 20 tests |
| `14_coherencia_numeros.spec.ts` | Coherencia KPIs | ✅ |
| `15_rol_supervisor.spec.ts` | Rol SUPERVISOR | ✅ 23 tests |
| `16_rol_rrhh.spec.ts` | Rol RRHH | ✅ 18 tests |
| `12_navegacion_sidebar.spec.ts` | Navegación | ✅ |

### Configuración Playwright

```typescript
// playwright.config.ts
// Proyectos: setup + chromium (OWNER)
// Proyectos condicionales: setup-rrhh + chromium-rrhh (si RUN_E2E=true)
// testIgnore para archivos de setup
```

### Helpers

- `auth.setup.ts` — autenticación y fixture shared state
- `waitForApp()` — espera `aside` o `networkidle` (flexible)
- **Pre-test:** Walkthrough marcado como visto en localStorage

---

## CI/CD (GitHub Actions)

**Archivo:** `.github/workflows/tests.yml`

- **Unit tests:** Corren en cada push a `dev` (automático)
- **E2E:** Opcional con `vars.RUN_E2E=true`

### Secrets necesarios para E2E en CI

```
E2E_BASE_URL          # URL del ambiente DEV
E2E_EMAIL             # Owner test email
E2E_PASSWORD          # Password
E2E_RRHH_EMAIL        # RRHH test email
E2E_RRHH_PASSWORD
DEV_SUPABASE_URL
DEV_SUPABASE_ANON_KEY
```

---

## Funciones puras en `ventasValidation.ts`

Las siguientes funciones están testeadas y se importan desde la app:

```typescript
validarMediosPago(medios)           // validación general
validarDespacho(carrito, medios)    // despacho con saldo
calcularSaldoPendiente(venta)       // saldo pendiente de cobro
validarSaldoMediosPago(saldo, medios) // cubre el saldo?
acumularMediosPago(anterior, nuevo) // acumula JSON medios
calcularVuelto(medios, total)       // vuelto al cliente
calcularEfectivoCaja(medios, total) // efectivo neto para caja
calcularComboRows(carrito)          // filas con combo aplicado
restaurarMediosPago(json)           // parsea JSON de DB
esDecimal(unidadMedida)            // ¿UOM decimal?
parseCantidad(str)                  // parse con coma/punto
calcularLpnFuentes(lineas, cant)    // qué LPNs cubren la cantidad
```

## Funciones puras en `ccLogic.ts` (cuenta corriente · v1.23.1)

Lógica de plata de CC extraída de los componentes (POS, ClientesPage) para testeo unitario. Single source of truth; los componentes la importan.

```typescript
evaluarLimiteCC({deudaTotal, montoCC, limite, politica})   // B1 enforcement (permitir|avisar|bloquear)
evaluarMorosidad({deudaVencida, politica, modoCC})          // B4 (bloquear_total|bloquear_cc|ok)
calcularInteresMora({saldo, pctMensual, diasVencido})       // B3 — espejo de recalcular_intereses_cc (mig 172)
calcularEstadoCC(ventas, hoyISO)                            // espejo de cliente_cc_estado (mig 172)
planificarCobranzaFIFO(ventasOrdenadas, monto, metodo)      // B5 — reparto FIFO (usado por cobranzaCC.ts)
agruparAgingCC(ventas, ahoraMs)                             // G1 — buckets 0-30/31-60/61-90/+90
```

> Las funciones que terminan en RPC SQL (`calcularInteresMora`, `calcularEstadoCC`) son **espejos JS** de la lógica de la DB para poder testearla sin Supabase. Si se cambia la RPC, actualizar el espejo + sus tests.

---

## Specs de negocio — `tests/specs/`

Plan de escenarios testeables por módulo, generado por el agente `spec-extractor` desde el relevamiento + el código. Formato Given/When/Then con ID ligado al ítem del relevamiento, tipo (unit/e2e) y estado (cubierto/falta).

- `tests/specs/clientes.plan.md` — 41 escenarios de Clientes (CC, cobranza, aging, notificaciones).

---

## Links relacionados

- [[wiki/development/workflow-git]]
- [[wiki/development/agentes-claude-code]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
