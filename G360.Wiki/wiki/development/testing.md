---
title: Testing — Unit + E2E
category: development
tags: [testing, vitest, playwright, e2e, unit-tests]
sources: [CLAUDE.md]
updated: 2026-06-11
---

# Testing

Genesis360 tiene cobertura con **Vitest** (unit tests) + **Playwright** (E2E).  
Total al 2026-06-12 (v1.54.0): **665 unit tests** (45 archivos) · **130 E2E** en **16 archivos spec** (roles OWNER/CAJERO/SUPERVISOR/RRHH).

> **Tests agregados en la tanda de auditoría de procesos (v1.52-v1.54):** `cobranzaCaja.test.ts` (7 — `movimientoCajaCobranza`: efectivo→ingreso real / otro→informativo), `trasladoLogic.test.ts` (22 — permisos/validaciones/recepción de traslados entre sucursales) y +11 en `comprasCheques.test.ts` (`montoChequeDeMedios` + reversiones de pago por cheque rechazado). E2e: +1 smoke del tab Traslados en `02_inventario.spec.ts`.

> **v1.51.1 — sesión de testing e2e (reparación + gobernanza):** 11 smoke tests E2E se habían "podrido" tras ~50 versiones de evolución de UI (selectores/rutas viejos) → reescritos contra la UI real. Se agregaron tests E2E de **gobernanza de caja** (A2 apertura ajena, traspaso entre cajas ISS-193) tomados del plan `caja.plan.md` (escenarios fuera de alcance unit). Suite: **unit 625/625 · e2e 129/129**.
>
> ⚠ **Unit suite — `fileParallelism: false`:** correr los 43 archivos en paralelo levanta un entorno jsdom por worker, agota la RAM (12 cores) y mata **toda** la suite con un error genérico (`Cannot read properties of undefined (reading 'config')`) — falla aunque los tests estén bien. La config fuerza ejecución secuencial (~90 s) y es 100% estable. Si en el futuro se reactiva el paralelismo, capar `maxWorkers` no alcanza: hay que dejarlo secuencial o aumentar la RAM disponible.

> **Pipeline de QA con agentes (v1.23.1):** el ciclo `relevamiento → spec-extractor → test-author → test-runner → bug-fixer` está soportado por subagentes de proyecto (ver [[wiki/development/agentes-claude-code]]). El plan de escenarios por módulo vive en `tests/specs/<modulo>.plan.md`.
>
> **v1.23.2 — extensión del QA a Caja / Inventario / Ventas (+101 tests):** se extrajo la lógica de arqueo de `CajaPage.tsx` a `src/lib/cajaArqueo.ts` (refactor behavior-preserving) y se cubrieron los gaps de lógica pura sin tocar comportamiento ni DB.

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
| `tests/unit/cajaArqueo.test.ts` | **Arqueo de Caja (v1.23.2)**: diferencia cierre/apertura, umbral de alerta, clasificación de ajuste, saldo de sesión, acumulado por método, ajuste de traspaso (ISS-193), parsing medio/nro venta | 38 |
| `tests/unit/cajaPermisos.test.ts` | **Matriz J3 (v1.23.2)**: `puede` (roles × acción + config opcional SUPERVISOR), `requiereClaveMaestra` (B5/B6) | 19 |
| `tests/unit/unidades.test.ts` | **Inventario (v1.23.2)**: convertirUnidad (kg↔gr/lt↔ml), unidadesCompatibles, tieneConversion, formatUnidad | 17 |
| `tests/unit/ventasDescuentoCombo.test.ts` | **Ventas (v1.23.2)**: calcularDescuentoComboMulti (pct/monto/monto_usd) | 7 |
| `tests/unit/permisosCosto.test.ts` | **Ventas G4 (v1.23.2)**: puedeVerCosto (costo/margen oculto a CAJERO/DEPOSITO/RRHH) | 8 |
| `tests/unit/umbralGasto.test.ts` | **Gastos (v1.23.2)**: evaluarUmbralGasto (umbral por rol/sucursal), puedeAprobar (cadena de aprobación) | 13 |
| `tests/unit/conteoAjuste.test.ts` | **Conteos 2.0 F3 (v1.27.0)**: superaUmbral (combinado u/%/$), requiereAutorizacion (gate D1), requiereReconteo (C1), reconciliarDelta (G1) | 16 |
| `tests/unit/conteoAbc.test.ts` | **Conteos 2.0 F4 (v1.29.0)**: clasificarABC (Pareto 80/95), sugerirConteoCiclico, reporteExactitud (exactitud %/valorización) | 16 |
| `tests/unit/comprasPermisos.test.ts` | **Compras CO1 (v1.31.0)**: capacidadCrearOC, ocRequiereAprobacion, puedeEnviarOC, puedeRegistrarPagoOC, requiereDobleFirmaPago | 14 |
| `tests/unit/recepcionLogic.test.ts` | **Compras CO2 (v1.32.0)**: estadoOCdesdeRecibido (acumulado B5), superaOverReceipt (B3), tieneFaltante (B4), esAjusteCantidad (B1c) | 13 |
| `tests/unit/comprasCostos.test.ts` | **Compras CO3 (v1.33.0)**: cambioCostoPct, superaAlertaCosto (E1), totalOCconAccesorios (E2) | 10 |
| `tests/unit/devolucionProveedor.test.ts` | **Compras CO4 (v1.34.0)**: montoDevolucion, validarDevolucion (stock disponible/forma/motivo) | 9 |
| `tests/unit/comprasPago.test.ts` | **Compras CO5 (v1.35.0)**: labelModoPago, defaultAnticipoOC, montoAnticipo (D1), scheduleValido/totalPctSchedule/montoCuota (D2) | 16 |
| `tests/unit/comprasCheques.test.ts` | **Compras CO6 (v1.36.0)**: estadosSiguientes/puedeTransicionar/puedeEndosar, chequeProximoACobrar/chequeVencido, validarChequeAlta, totalPendiente | 19 |
| `tests/unit/ocPDF.test.ts` | **Compras CO7a (v1.37.0)**: subtotalItems/totalOC, textoOC (A6), waLinkOC | 6 |
| `tests/unit/serviciosRecurrentes.test.ts` | **Compras CO7b (v1.38.0)**: proximoVencimiento/servicioVencido/periodosVencidos (F1), normalizarNombre/compararPresupuestos (F3) | 11 |
| `tests/unit/comprasReportes.test.ts` | **Compras CO8 (v1.39.0)**: comprasPorProveedor/calificarProveedor (E4), topProductosComprados, agingPagos, ocsVencidas, evolucionCostos | 10 |
| `tests/unit/ccLogic.test.ts` (ISS-151) | + PSEUDO_METODOS_PAGO / esMetodoRealPago (excluir Incobrable del dashboard) | +4 |

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
| `01_dashboard.spec.ts` | Dashboard (chips de área, sub-tabs, menú de avatar) | ✅ |
| `02_inventario.spec.ts` | Inventario (líneas de stock) + Productos (CRUD en `/productos`) | ✅ |
| `03_movimientos.spec.ts` | Movimientos de stock (`/movimientos`→`/inventario` + tabs Agregar/Quitar) | ✅ |
| `04_ventas.spec.ts` | Ventas / POS | ✅ |
| `05_caja.spec.ts` | Caja + **gobernanza** (U2 arqueo, A2 apertura ajena, traspaso ISS-193) | ✅ |
| `06_gastos.spec.ts` | Gastos | ✅ |
| `07_alertas.spec.ts` | Alertas | ✅ |
| `08_clientes.spec.ts` | Clientes (alta con DNI/tel oblig. + baja A6) | ✅ |
| `09_suscripcion_plan.spec.ts` | Suscripción / Mi Plan | ✅ |
| `10_configuracion.spec.ts` | Configuración | ✅ |
| `11_reportes_historial.spec.ts` | Reportes / Historial / Recomendaciones | ✅ |
| `12_navegacion_sidebar.spec.ts` | Navegación (smoke todas las rutas) | ✅ |
| `13_rol_cajero.spec.ts` | Rol CAJERO | ✅ |
| `14_coherencia_numeros.spec.ts` | Coherencia KPIs (badge alertas capea en "9+") | ✅ |
| `15_rol_supervisor.spec.ts` | Rol SUPERVISOR | ✅ |
| `16_rol_rrhh.spec.ts` | Rol RRHH | ✅ |
| `63_multicuit_emisor_guards.spec.ts` | **Multi-CUIT — el EMISOR (no el tenant) gobierna la letra.** Corre contra "Kiosco Buildi" (DEV), único tenant con 2 identidades fiscales conviviendo (RI default + Monotributista adicional, ambas con cert). Cubre la rama **"RI rechaza C"** que el 56 no podía (exigía flipear la condición del tenant) + Mono rechaza A/B + combos válidos pasan (aserción positiva) + emisor cross-tenant → 403. **No muta** (venta dummy: los guards corren antes de buscar la venta) → repetible. Requiere `E2E_MULTICUIT_*` (usuario `e2e-multicuit@genesis360.test`, solo DEV). ⚠ El `#` en un password rompe el parseo del `.env` | ✅ |
| `88_mobile_responsive.spec.ts` | **Barrido responsive mobile** — 10 pantallas × 2 viewports (375/360px), assertea sin overflow horizontal en el **contenido (`<main>`) Y el `<header>`**. Project `chromium-mobile` (`isMobile`+`hasTouch`, sesión owner). Helper `detectarOverflowHorizontal(page, { selector })` mide dentro del contenedor (el root `AppLayout` clippea con `overflow-hidden`) tanto rect como overflow de texto, ignorando scroll intencional | ✅ |
| `129_pildoras_filtro_productos_inventario_mutante.spec.ts` | **Filtro de píldoras en Productos e Inventario (2026-08-06, ✅ PROD desde v1.158.0)** — siembra su propio producto único, prueba texto libre / campo explícito / combinador Y exige ambos / combinador O alcanza con uno, en las dos páginas. 2/2 verde, corrido dos veces. Ver [[wiki/features/filtro-pildoras]] | ✅ |
| `130_ubicaciones_arbol_mutante.spec.ts` | **Rediseño de Ubicaciones en árbol (2026-08-06, ✅ PROD desde v1.158.0)** — crear hijo con código autogenerado jerárquico, guard tipo_logico con hijos, guard borrado con niveles adentro, breadcrumb en selector operativo real (encontró y sirvió para corregir 4 gaps reales, ver [[wiki/features/ubicaciones]]). 2/2 verde | ✅ |

> **Barrido responsive (2026-07-15):** primera cobertura mobile en e2e. Detecta el patrón "se sale del marco" (contenido más ancho que el `<main>`). Corre en su propio project `chromium-mobile`; el project desktop lo excluye por `testIgnore`. Guard contra regresiones de overflow. Ver log 2026-07-15.

> Las specs E2E son **defensivas**: corren contra el DEV compartido y se omiten (sin fallar) cuando la precondición de estado no está dada (ej. caja sin sesión, <2 cajas para traspaso). Nunca mutan sin limpiar (crear→verificar→baja/eliminar).

> **🌱 Los specs MUTANTES siembran su propia precondición (regla, 2026-07-15).** Depender de un fixture sembrado a mano es una trampa: la PRIMERA corrida lo consume y el spec queda **rojo para siempre**. Le pasó al **42** (la corrida de validación le escribió el `nc_cae` a la última devolución pendiente) → ahora se siembra solo por API con el token del owner (`devoluciones` no tiene triggers → no toca stock ni caja). Si un spec mutante necesita un estado previo, **que lo cree él**. Verificar el fix corriendo el spec **dos veces seguidas**.

> **⚙️ Env de e2e:** `tests/e2e/.env.test.local` incluye `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (la anon key es **pública**, ya viaja en el bundle del frontend). Sin ellas, los specs de API (**42** auto-siembra, **56** guards fiscales, **63** multi-CUIT) se **SKIPEAN en silencio** en `npm run test:e2e` — pasó hasta el 2026-07-15. ⚠ **Un `#` en un password rompe el parseo del `.env`** (lo toma como comentario y trunca el valor) → passwords de test sin `#`.

> **🕐 Deuda de `waitForTimeout` fijos — ✅ CERRADA (2026-08-06, ✅ PROD desde v1.158.0).** La causa raíz
> documentada arriba (nota del 2026-07-15, "el mismo test pasa o falla según cuán ocupada esté la
> máquina") ya no es un problema de fondo: la suite pasó de sleeps fijos por todos lados a esperar
> señales DOM reales. Estado medido: **331/89 (2026-08-04) → 312/79 → 287/77 → 315/80 recontado →
> 8 ocurrencias en 6 archivos (2026-08-06, cierre final, deploy v1.158.0)**. GO pidió explícitamente
> "sigamos con más de wait for timeout hasta finalizarlo" — se cerró de punta a punta en la misma
> sesión, sin dejar resto pendiente.
>
> **Las 8 ocurrencias que quedan son intencionales**, documentadas inline en cada una porque no
> tienen una señal DOM mejor para esperar:
> - `14_coherencia_numeros.spec.ts` y `15_rol_supervisor.spec.ts` — dejar correr el JS de la página
>   para recolectar errores async de consola durante una ventana de tiempo (no hay otra señal
>   posible para "no pasó nada raro en X ms").
> - `88_mobile_responsive.spec.ts` — dejar el rendering async de KPIs/gráficos asentarse antes de
>   medir overflow horizontal.
> - `98_config_ventas_envios_mutante.spec.ts` — dejar asentar geocoding/autocálculo de envío antes
>   de un chequeo NEGATIVO (que NO se pisó un valor en $0) — sin señal positiva disponible para un
>   "no pasó esto".
> - `tests/e2e/helpers/fixtures.ts` (3 menciones) — son comentarios que explican la metodología, no
>   código real.
>
> **71 archivos tocados en 7 tandas** (por cantidad de ocurrencias, de 8 sleeps/archivo bajando hasta
> 1), cada tanda corrida contra DEV real antes de pasar a la siguiente. **6 patrones de reemplazo
> aplicados sistemáticamente — referencia para specs futuros:**
> 1. **Sleep antes de una acción con `expect().toBeVisible()` ya presente en el siguiente paso** →
>    se borra (redundante, el auto-wait de Playwright ya cubre la espera).
> 2. **Sleep antes de `.click()`/`.selectOption()`** → se borra (esos métodos auto-esperan la
>    actionability del elemento, no hace falta dormir antes).
> 3. **Sleep antes de `elemento.isVisible()` sin bound** (usado para decidir un `test.skip`) → se
>    reemplaza por el helper `visible(locator, timeout)` de `fixtures.ts` (espera acotada real en
>    vez de "dormir y mirar el instante").
> 4. **Sleep antes de LEER un valor no re-intentable** (ej. total del carrito tras cambiar de UdM) →
>    se envuelve en `expect.poll(...)` en vez de confiar en que el sleep alcance.
> 5. **Sleep tras un fetch async disparado por una acción** (ej. seleccionar cliente en el POS
>    dispara saldo/crédito a favor, ISS E2) → se reemplaza por
>    `page.waitForLoadState('networkidle', {timeout})`, o se elimina directamente si el siguiente
>    `expect().toBeVisible()` YA exige que exista la opción que depende de ese fetch.
> 6. **Sleep como ÚLTIMO paso del test sin ninguna aserción después** (dejar asentar una mutación
>    antes de cerrar la página) → se reemplaza por `waitForLoadState('networkidle')` acotado.
>
> **Simplificaciones de paso:** `44_presupuesto_convertir_mutante.spec.ts` y
> `38_envio_combustible_gasto_mutante.spec.ts` reusan `agregarPrimerProductoAlCarrito` de
> `fixtures.ts` en vez de duplicar el patrón de búsqueda+click; `27_gasto_efectivo_mutante.spec.ts` y
> `32_caja_fuerte_deposito_mutante.spec.ts` reusan `garantizarCajaAbierta` en vez de un bloque manual
> de apertura de caja. `15_rol_supervisor.spec.ts` tenía un bug real de estructura corregido de paso:
> el listener de `pageerror` se enganchaba DESPUÉS de un sleep de 1.5s, perdiéndose errores del load
> inicial.
>
> **🛑 Un flake real puede ser un bug real — caso `MasivoModal.tsx` (2026-08-06, ✅ PROD desde
> v1.158.0).** Al arreglar el spec 95, se encontró que 2 de 3 corridas fallaban de forma
> intermitente. La tentación fácil hubiera sido "meter un sleep más largo y que pase" — en cambio se
> investigó la causa y resultó ser un **bug de PRODUCCIÓN real** (no del test): `cargarLineasParaRebaje()`
> se llama sin `await` desde `addProduct()`, y la validación de ambigüedad de talle/color se saltaba
> ENTERA si el usuario confirmaba antes de que el fetch resolviera — el rebaje masivo se confirmaba
> por FIFO ciego sin pedir la variante, violando la Regla de Oro #0. Ver detalle completo en
> [[wiki/features/inventario-stock]] → "Rebaje masivo" y `log.md` (2026-08-06). **Lección aplicada al
> resto del barrido:** cuando un spec falla intermitente incluso con esperas "razonables", no asumir
> que es solo timing del test — puede estar exponiendo una carrera real en el código de la app.
>
> **⚠ Deuda técnica separada, NO cerrada por esta ronda — flake conocido en
> `39_cc_condonacion_mutante.spec.ts`.** Durante la verificación final falló una vez con "Deuda Venta
> #N condonada" no encontrado. Confirmado que el código tocado en ese archivo en esta sesión (el paso
> ANTERIOR al click de "Condonar") no toca el punto que falló — es un **race de timing preexistente**
> con el `confirm()` nativo del browser sobre un **fixture compartido no autogenerado** (cliente real
> "Gaston Otranto", en vez de sembrar su propia precondición como manda la regla de specs mutantes,
> ver nota de 2026-07-15 más arriba). No es un bug de la app ni fue causado por esta ronda de
> `waitForTimeout` — queda documentado como deuda técnica para una sesión futura que reescriba ese
> spec para autosembrarse.

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
- `tests/specs/caja.plan.md` — 38 escenarios de Caja (arqueo de cierre/apertura, umbral de alerta, ajuste de traspaso, matriz de permisos J3/B5/B6).
- `tests/specs/inventario.plan.md` — 17 escenarios de conversión de unidades (kg↔gr / lt↔ml).
- `tests/specs/ventas.plan.md` — 22 escenarios de gaps de Ventas (descuento de combo, visibilidad de costo G4, umbral de gasto + cadena de aprobación).
- `tests/specs/asistente-ia.plan.md` — 9 preguntas doradas del Asistente IA (guía dentro del menú del usuario, off-topic, prompt injection, honestidad). Semiautomático: `npm run ai:smoke` contra DEV con login real; criterios evaluados a ojo (respuestas LLM no determinísticas). Ver [[wiki/features/asistente-ia]].

## Funciones puras en `cajaArqueo.ts` (arqueo de Caja · v1.23.2)

Lógica de arqueo extraída de `CajaPage.tsx` (rewire behavior-preserving) para testeo unitario.

```typescript
signoMovimiento(tipo)                       // +1 ingreso / -1 egreso*
saldoSesion({apertura, ingresos, egresos})  // saldo del sistema
calcularDiferenciaCierre(montoRealStr, saldo)  // conteo - sistema (null si no contó)
calcularDiferenciaApertura(real, sugerido)  // real - sugerido (null sin cierre previo)
superaUmbralDiferencia(dif, umbral)         // B1/B2/B3 — alerta de descuadre
clasificarAjusteDiferencia(dif)             // B4 — {tipo, etiqueta} del movimiento de ajuste
tipoAjusteTraspaso(direccion, dif)          // ISS-193 — ajuste en la caja contraparte
acumularTotalesPorMetodo(movimientos)       // neto por medio de pago
extraerMedioPago / extraerNumeroVenta       // parsing de concepto
```

---

## Links relacionados

- [[wiki/development/workflow-git]]
- [[wiki/development/agentes-claude-code]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
