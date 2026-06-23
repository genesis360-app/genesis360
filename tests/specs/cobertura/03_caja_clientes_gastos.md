# Cobertura — Caja / Bóveda + Clientes / Cuenta Corriente + Gastos

> Auditoría de cobertura de testing (F1 de `uat-cobertura.plan.md`). Grupo 3.
> **Zona REGLA #0 (contable/fiscal).** Solo lectura — no se escribió código ni tests.
> Fecha: 2026-06-21 · Repo @ dev (migs 001-233).
>
> **▶ Progreso del barrido (2026-06-23):** **Caja/Bóveda — gaps REGLA #0 contables CERRADOS por e2e:** cierre con diferencia (spec **64**, ajuste `ingreso` en DB), cierre **ajeno** con clave maestra (spec **65**, server-side mala/correcta), **extracción de Bóveda** (spec **66**, guard saldo insuficiente → no-negativo), **doble validación B7** (spec **67**, sin/invalid 2º usuario bloquea). `diferencia_caja_umbral` queda **cubierto por unit** (`superaUmbralDiferencia`, umbral 0 vs >0) — es ruteo de alerta, no integridad de plata. Varios gaps YA cerrados antes por hardening + Ventas: **G1** (límite CC + morosidad) por mig 234 + e2e **46/49**; parte de **G2/G3** por **40/41/45/48**.
>
> **✅ GASTOS — gaps REGLA #0 fiscal/contable CERRADOS:** comprobante obligatorio (spec **68**, `gastos_comp_siempre` → bloquea sin adjunto; las 4 reglas comparten el OR), **guard fiscal IVA crédito** (`fn_gastos_iva_guard` mig 227, **DB-validated**: Mono+FacturaA→IVA NULL; RI+FacturaA→conserva $21+ganancias; RI+FacturaB→IVA NULL), **período contable cerrado** (`trg_gastos_periodo_cerrado` mig 135, **DB-validated**: UPDATE en período cerrado → P0001). Gasto efectivo→caja ya en spec 27; umbral por rol en unit (`evaluarUmbralGasto`); pago OC doble firma en unit (`comprasPago`) + RPC mig 237. Residual menor: eliminar→reversión en caja (simétrico a 27), gasto en cuotas. **▶ Siguiente: Clientes/CC residual** (revertir condonación, incobrable SIN clave, vencimiento CC, crédito a favor positivo).
> Leyenda cobertura: ✅e2e (spec NN) · ✅unit (archivo) · ✅UAT(§) · 🟡parcial · 🔴gap · 🧠code-audit.
> Convención de flags: **CON** = flag activo/valor distinto del default · **SIN** = ausente/default/null.

---

## 1) Tabla de Lógicas

### Caja / Bóveda

| Lógica | file:función | REGLA #0 | Cobertura |
|---|---|---|---|
| Saldo efectivo de sesión (apertura + ingresos − egresos efectivo) | `src/lib/cajaSaldo.ts:calcularSaldoEfectivo` / `saldoEfectivoSesion` | ✅ | ✅unit (cajaSaldo) |
| Clasificación tipos ingreso/egreso EFECTIVO (informativos no cuentan) | `cajaSaldo.ts:TIPOS_INGRESO_EFECTIVO/TIPOS_EGRESO_EFECTIVO` | ✅ | ✅unit |
| Saldo de sesión (signo por tipo) + totales por método | `src/lib/cajaArqueo.ts:saldoSesion`/`signoMovimiento`/`acumularTotalesPorMetodo` | ✅ | ✅unit (cajaArqueo) |
| Diferencia al cierre / apertura (sobrante/faltante) | `cajaArqueo.ts:calcularDiferenciaCierre`/`calcularDiferenciaApertura`/`clasificarAjusteDiferencia` | ✅ | ✅unit |
| ¿Diferencia supera umbral de alerta? | `cajaArqueo.ts:superaUmbralDiferencia` | ✅ | ✅unit (umbral 0 vs >0) |
| Ajuste contraparte de traspaso al corregir | `cajaArqueo.ts:tipoAjusteTraspaso` | ✅ | ✅unit |
| Apertura de caja (propia/ajena) + dif. apertura + notif | `src/pages/CajaPage.tsx` abrirCaja (≈600-647) | ✅ | ✅e2e 20 (propia, happy) · 🔴 ajena |
| Cierre con arqueo obligatorio + snapshot K2 + ajuste de diferencia | `CajaPage.tsx` cerrarCaja:650-765 | ✅ | ✅e2e 20 (sin dif) · ✅e2e 64 (sobrante $100 → ajuste `ingreso` en DB) |
| Cierre AJENO exige clave maestra (si configurada) | `CajaPage.tsx:656-665` | ✅ | ✅e2e 65 (clave mala bloquea / correcta cierra, server-side) |
| Doble validación al cierre (B7, 2º usuario) | `CajaPage.tsx:666-698` + `cajaPermisos.ts:ConfigCaja.doble_validacion_cierre` | ✅ | ✅e2e 67 (sin/invalid 2º usuario → bloquea) |
| Alerta de diferencia a roles/canales (in-app + email) | `CajaPage.tsx:801-834` | ✅ | 🧠code-audit · 🔴 e2e |
| Egreso no deja caja negativa (gastos/devolución) | `cajaSaldo.ts:saldoEfectivoSesion` usado en GastosPage:1225-1227 | ✅ | ✅unit (saldo) · ✅e2e 27 (happy) |
| Depósito a Bóveda (2 patas: egreso_traspaso + ingreso_traspaso) | `CajaPage.tsx` traspasoBoveda:1022-1102 | ✅ | ✅e2e 32 |
| Extracción de Bóveda (egreso real, no traspaso) | `CajaPage.tsx:extraerDeBoveda:306-360` | ✅ | ✅e2e 66 (guard saldo insuficiente → no negativo) |
| Caja Fuerte como sesión permanente (`es_caja_fuerte`, excluida de operativas) | `CajaPage.tsx:152-153,179-180` | ✅ | 🧠code-audit |
| Matriz de permisos por rol (abrir/cerrar/ingreso/traspaso/bóveda/anular) | `src/lib/cajaPermisos.ts:puede` + `MATRIZ` | ✅ | ✅unit (cajaPermisos) |
| ¿Acción requiere clave maestra? (cerrar_ajena, anular_venta) | `cajaPermisos.ts:requiereClaveMaestra`/`ACCIONES_CON_CLAVE_MAESTRA` | ✅ | ✅unit |
| ¿Rol accede a la Bóveda? (roles fijos + custom) | `cajaPermisos.ts:accedeABoveda` | ✅ | ✅unit |
| Verificación de clave maestra (hash bcrypt) | RPC `verificar_clave_maestra` (mig 233) consumida en CajaPage/Clientes/Gastos/Ventas/Envios/Inventario | ✅ | ✅e2e 41 (set) · 🟡 verificar runtime |
| Setear clave maestra hasheada (RPC, solo DUEÑO, mín 6) | RPC `set_clave_maestra` ← `ConfigPage.tsx:1043` | ✅ | ✅e2e 41 |
| Cobranza CC desde Caja (tab Cobranzas) | `CajaPage.tsx` tab cobranzas → `cobrarDeudaCCFIFO` | ✅ | ✅e2e 28 (vía Clientes) · 🟡 desde Caja |

### Clientes / Cuenta Corriente

| Lógica | file:función | REGLA #0 | Cobertura |
|---|---|---|---|
| Alta/edición de cliente (nombre+DNI+tel obligatorios, notas, fiscal, CC) | `src/pages/ClientesPage.tsx:guardar:414-477` | parcial | ✅e2e 08/26 (alta) |
| Alta inline desde POS | `src/pages/VentasPage.tsx:registrarClienteInline:837-855` | parcial | 🟡 |
| Soft delete + reactivar cliente | `ClientesPage.tsx:confirmarBaja:631-655` | — | 🔴gap |
| Enforcement límite CC (permitir/avisar/bloquear) | `src/lib/ccLogic.ts:evaluarLimiteCC` ← `VentasPage.tsx:2426-2435` | ✅ | ✅unit (ccLogic) · 🔴 e2e |
| Morosidad (permitir/bloqueo_cc/bloqueo_total) | `ccLogic.ts:evaluarMorosidad` ← `VentasPage.tsx:2412-2424` | ✅ | ✅unit · 🔴 e2e |
| Interés de mora sobre saldo vencido | `ccLogic.ts:calcularInteresMora` (espejo `recalcular_intereses_cc_all`) | ✅ | ✅unit · 🔴 e2e/sweep |
| Estado de CC del cliente (deuda total/vencida/interés) | `ccLogic.ts:calcularEstadoCC` (espejo RPC `cliente_cc_estado`) | ✅ | ✅unit |
| Cobranza FIFO (más antigua primero) | `ccLogic.ts:planificarCobranzaFIFO` + `src/lib/cobranzaCC.ts:cobrarDeudaCCFIFO` | ✅ | ✅unit · ✅e2e 28 |
| Cobranza EFECTIVO exige caja imputable (sino requiereCaja, no salda) | `cobranzaCC.ts:57-81` + `resolverSesionCajaCobranza:40-55` | ✅ | ✅unit (cobranzaCaja) · 🟡 e2e (happy) · 🔴 negativo |
| Movimiento de caja por cobranza (efectivo=ingreso, otro=informativo) | `cobranzaCC.ts:movimientoCajaCobranza:27-33` | ✅ | ✅unit |
| Aging de deuda por antigüedad (buckets) | `ccLogic.ts:agruparAgingCC` | ✅ | ✅unit |
| Pseudo-métodos de pago (CC/condonación/incobrable excluidos de métricas) | `ccLogic.ts:PSEUDO_METODOS_PAGO`/`esMetodoRealPago` | ✅ | ✅unit |
| Condonar deuda CC (write-off) | `ClientesPage.tsx:condonarDeudaCC:509-528` | ✅ | ✅e2e 39 |
| Revertir condonación (restaurar deuda) | `ClientesPage.tsx:revertirDeudaCC:530-554` | ✅ | 🔴gap |
| Dar de baja INCOBRABLE (condona todo + gasto pérdida + clave maestra) | `ClientesPage.tsx:confirmarIncobrable:558-599` | ✅ | ✅e2e 40 (CON clave) · 🔴 SIN clave |
| Estado de cuenta PDF + link público con token | `ClientesPage.tsx:descargarEstadoCuenta`/`generarLinkCuenta:609-628` | — | 🔴gap (capa C) |
| Vencimiento de venta CC = hoy + cc_dias_vencimiento | `VentasPage.tsx:2523-2526` | ✅ | 🔴gap |
| Crédito a favor del cliente (E2) | `VentasPage.tsx:2437-2444` | ✅ | 🔴gap |
| Notif CC al cliente (registro deuda / pago) por email | `src/lib/notificacionesCC.ts:notificarRegistroDeudaCC`/`notificarPagoCC` | — | 🔴gap |
| Bloqueo CC con PROVEEDOR (OC vencida / límite) | `src/lib/ccProveedor.ts:chequearBloqueoCC` | ✅ | 🔴gap (no unit) |

### Gastos

| Lógica | file:función | REGLA #0 | Cobertura |
|---|---|---|---|
| Alta de gasto + medios de pago suman el monto | `src/pages/GastosPage.tsx:guardar` (≈1080-1311) | ✅ | ✅e2e 27 (efectivo) |
| Gasto efectivo → egreso en caja (await + aviso si falla, no negativo) | `GastosPage.tsx:1225-1265` | ✅ | ✅e2e 27 |
| Comprobante obligatorio (4 reglas OR: siempre/iva/ganancias/monto) | `GastosPage.tsx:1092-1112` (alta) + `1505-1525` (otra vía) | ✅ | ✅e2e 68 (`gastos_comp_siempre` → bloquea sin adjunto; las 4 reglas comparten el OR) |
| Guard fiscal IVA crédito server-side (RI + Factura A) | trigger `fn_gastos_iva_guard` (mig 227) | ✅ | ✅DB-validated (Mono+A→IVA NULL; RI+A→conserva $21+ganancias; RI+B→IVA NULL, ganancias ok) |
| Umbral de gasto por rol (solicitud de autorización) | `src/lib/umbralGasto.ts:evaluarUmbralGasto` ← `GastosPage.tsx:1164-1178` | ✅ | ✅unit (umbralGasto) |
| Eliminar gasto → reversión en caja (ingreso de corrección) | `GastosPage.tsx:eliminar:1314-1354` | ✅ | 🔴gap |
| Edición que agrega medio de pago → asienta en caja | `GastosPage.tsx:1197-1214` | ✅ | 🔴gap |
| Período contable cerrado bloquea edición/eliminación | `GastosPage.tsx:1184-1187,1317-1319` (`isPeriodoCerrado`) + trigger `trg_gastos_periodo_cerrado` (mig 135) | ✅ | ✅DB-validated (UPDATE gasto en período cerrado → P0001 "Periodo contable cerrado") |
| Gasto en cuotas (genera gasto_cuotas) | `GastosPage.tsx:1268-1293` | ✅ | 🔴gap |
| Pago de OC: doble firma por umbral exige clave maestra | `GastosPage.tsx:719-727` (`requiereDobleFirmaPago`) | ✅ | ✅unit (comprasPago) · 🔴 e2e clave |
| Pago de OC con cheque → crea cheque vinculado + fecha cobro | `GastosPage.tsx:734-739` | ✅ | ✅unit (comprasCheques) · ✅e2e 31 (gasto) |
| Bloqueo CC proveedor al pagar OC (autorización DUEÑO) | `GastosPage.tsx:741-744` (`existeAutorizacionCCAprobada`) | ✅ | 🔴gap |
| Alerta de cheques próximos a vencer | `GastosPage.tsx:528` + `ChequesPanel.tsx:44` | — | 🔴gap |

---

## 2) Matriz de flags

> `uso file:line` apunta al **punto de consumo en runtime** (no solo al setter de ConfigPage).
> Setter de todos: `ConfigPage.tsx` (líneas indicadas como `cfg:NNN`).

### 🔴 Caja / Bóveda (REGLA #0 contable)

| flag | default | uso file:line | comportamiento CON | comportamiento SIN / por-valor | cobertura |
|---|---|---|---|---|---|
| `clave_maestra` (hash) | null | CajaPage:656; Clientes:560; Gastos:722; Ventas:345,2378; Envios:788; Inventario:1862 | gatea cierre ajeno, anular venta, incobrable, override descuento, doble-firma OC/envío | **null → ninguna acción pide clave** (todas pasan sin verificación) | ✅e2e 41 (set) · 🔴 **e2e CON vs SIN de cada gate** |
| `caja_fuerte_roles` | `['DUEÑO']` | CajaPage:1455-1456 (`accedeABoveda`); 2821-2828 (editar) | roles listados (fijos + `custom:<id>`) ven/operan la Bóveda | default → solo DUEÑO; tab Caja Fuerte oculto al resto | ✅unit (accedeABoveda) · 🔴 e2e |
| `config_caja.doble_validacion_cierre` | false | CajaPage:667-698 | cerrar pide email+password de 2º usuario (DUEÑO/SUP/ADMIN, distinto) | false → cierre sin 2ª firma | 🔴gap |
| `config_caja.supervisor_puede_ver_boveda` | false | `cajaPermisos.ts:69` (SUPERVISOR_OPCIONAL) | SUPERVISOR ve saldo de bóveda | false → SUPERVISOR no ve bóveda | ✅unit (CAJA-PER-04/05) |
| `config_caja.supervisor_puede_editar_movimientos` | false | `cajaPermisos.ts:69` | SUPERVISOR puede "Corregir" movimientos | false → no puede | ✅unit (editar_movimiento) |
| `diferencia_caja_umbral` | null/0 | CajaPage:803 (`superaUmbralDiferencia`) | umbral>0 → alerta si \|dif\| ≥ umbral | **0/null → alerta ante CUALQUIER diferencia ≠ 0** | ✅unit (superaUmbral) · 🔴 e2e |
| `diferencia_caja_alerta_roles` | `['DUEÑO','SUPERVISOR']` | CajaPage:805 | notifica a esos roles cuando hay dif sobre umbral | default → DUEÑO+SUPERVISOR | 🔴gap |
| `diferencia_caja_alerta_canales` | `['inapp','email']` | CajaPage:806,813,824 | crea notificación in-app y/o email | default → ambos; whatsapp pendiente | 🔴gap |
| `boveda_umbral_caja` | null | **solo ConfigPage:710,1024 + supabase.ts** | (intención: avisar cuando la caja supera X y debe depositar) | **🔴 NO se consume en runtime — flag huérfano** | 🔴gap (sin uso) |
| `descuento_max_cajero_pct` | null | VentasPage:4487,4510 (solo UI title/border) | (intención: tope de % para CAJERO) | **🔴 nunca se enforza: CAJERO está 100% bloqueado de descuentos (`descuentoBloqueadoCajero`, VentasPage:2288); el flag no cambia nada** | 🔴gap (no enforzado) |
| `descuento_max_supervisor_pct` | null | VentasPage:2360,2366-2370 | SUPERVISOR bloqueado si descuento (línea o global) > tope; override con clave maestra | null → SUPERVISOR sin tope (solo regla de canal aplica) | 🟡unit indirecto · 🔴 e2e CON/SIN |

### 🔴 Clientes / CC (REGLA #0 contable)

| flag | default | uso file:line | comportamiento CON | comportamiento SIN / por-valor | cobertura |
|---|---|---|---|---|---|
| `cliente_obligatorio` | `'reservas'` (POS) / `'nunca'` (cfg) | VentasPage:144,2394-2403 | `siempre`→toda venta exige cliente; `reservas`→solo presup/reserva | `nunca` → no exige (salvo factura no-CF / canal) | 🔴gap (e2e por valor) |
| `cliente_datos_minimos` | `'nombre'` | VentasPage:147,840 (inline) | `≠nombre`→DNI obligatorio en alta inline | `nombre`→solo nombre. **🔴 No distingue `nombre_dni_email`/`todos`; y `ClientesPage.guardar` IGNORA el flag (hardcodea nombre+DNI+tel obligatorios:416-418)** | 🔴gap (parcial) |
| `cliente_consumidor_final` | true | VentasPage:146,2393,2504 | permite vender como Consumidor Final (sin cliente) | false → cliente siempre obligatorio (no hay CF) | 🔴gap |
| `cliente_creacion_inline` | true | VentasPage:145 (gatea botón "+ nuevo cliente" en POS) | muestra alta rápida en POS | false → no se puede crear cliente desde POS | 🔴gap |
| `cliente_etiquetas_catalogo` | `[]` | ClientesPage:189 | sugiere etiquetas predefinidas en alta | vacío → sin sugerencias | 🔴gap |
| `limite_cc_default` | null | VentasPage:2428 (fallback de `clientes.limite_credito`) | tope general si el cliente no tiene límite propio | null → sin tope por default | ✅unit (evaluarLimiteCC) · 🔴 e2e |
| `cc_enforcement_politica` | `'avisar'` | VentasPage:2429-2433 (`evaluarLimiteCC`) | `bloquear`→corta la venta CC sobre tope; `avisar`→confirm; `permitir`→pasa | default `avisar` → solo confirma | ✅unit (todos los valores) · 🔴 **e2e bloquear** |
| `cc_morosidad_politica` | `'bloqueo_cc'` | VentasPage:2412-2424 (`evaluarMorosidad`) | `bloqueo_total`→corta cualquier venta con deuda vencida; `bloqueo_cc`→solo corta sumar a CC | `permitir` → no corta | ✅unit (todos) · 🔴 e2e |
| `cc_interes_mensual_pct` | 0 | sweep `recalcular_intereses_cc_all` (mig 215) + `ccLogic:calcularInteresMora` | >0 → el sweep aplica interés sobre saldo vencido | 0 → interés=0 (y el sweep limpia interes_cc) | ✅unit (calcularInteresMora) · 🔴 e2e sweep |
| `cc_dias_vencimiento` | null | VentasPage:2523-2526 | setea `fecha_vencimiento_cc` = hoy + N en la venta CC | null → venta CC sin vencimiento (no entra a "vencida") | 🔴gap |
| `cc_notif_canales` | `['whatsapp']` | notificacionesCC.ts:10 | incluye `email` → habilita auto-email de CC | sin email → no auto-envía (whatsapp es manual) | 🔴gap |
| `cc_notif_registro_deuda` | false | notificacionesCC.ts:24 | email al cliente al registrar venta CC | false → no notifica | 🔴gap |
| `cc_notif_pago` | false | notificacionesCC.ts:40; Clientes:497 | email al cliente al cobrar CC | false → no notifica | 🔴gap |
| `cc_notif_pre_venc_dias` | 5 | ClientesPage:900 | badge "por vencer" N días antes del vencimiento | default 5 | 🔴gap |
| `alerta_devoluciones_n` | null | VentasPage:3586-3598 | N≠null → alerta a roles ventas si cliente/producto supera N devoluciones | **null → no alerta** | 🔴gap |
| `alerta_devoluciones_dias` | 30 | VentasPage:3588 | ventana de días para contar devoluciones | default 30 | 🔴gap |

### 🔴 Gastos (REGLA #0 fiscal/contable)

| flag | default | uso file:line | comportamiento CON | comportamiento SIN / por-valor | cobertura |
|---|---|---|---|---|---|
| `gastos_comp_siempre` | true | GastosPage:1099,1103-1104,1514 | true → comprobante obligatorio para TODO gasto (bloquea sin adjunto) | false → solo si aplica otra regla | 🔴gap (CON/SIN) |
| `gastos_comp_si_iva` | false | GastosPage:1100,1515 | obligatorio si el gasto deduce IVA | false → no por esta regla | 🔴gap |
| `gastos_comp_si_deduce_ganancias` | false | GastosPage:1101,1516 | obligatorio si deduce ganancias / es del negocio | false → no por esta regla | 🔴gap |
| `gastos_comp_si_monto` | false | GastosPage:1102,1517 | obligatorio si monto > umbral | false → no por esta regla | 🔴gap |
| `gastos_comp_monto_umbral` | null/0 | GastosPage:1098,1108,1513 | umbral $ para la regla `si_monto` | 0 → la regla si_monto dispara siempre (monto>0) | 🔴gap |
| `gastos_dias_alerta_borrador` | 7 | GastosPage:2181 | días para alertar borradores/gastos atrasados | default 7 | 🔴gap |
| `gastos_dias_alerta_anticipo_oc` | 15 | GastosPage:3040 | días para alertar anticipos de OC | default 15 | 🔴gap |
| `cheques_alerta_dias` | 7 | GastosPage:528; ChequesPanel:44 | ventana de aviso de cheques próximos a vencer | default 7 | 🔴gap |
| `oc_pago_doble_firma_umbral` | (compras) | GastosPage:721-727 | pago OC ≥ umbral exige clave maestra (si configurada) | sin umbral → sin doble firma | ✅unit (comprasPago) · 🔴 e2e |

### Fiscal cruzado (afecta Gastos)

| flag | default | uso | comportamiento CON / por-valor | cobertura |
|---|---|---|---|---|
| `condicion_iva_emisor` | 'Monotributista' (gastos) | trigger `fn_gastos_iva_guard` (mig 227) | `RI` + Factura A → conserva crédito IVA + deduce ganancias; **cualquier otro valor → server BORRA iva_monto/alicuota/deducción** | 🧠code-audit · 🔴 e2e runtime RI/Mono/Exento |

---

## 3) Gaps priorizados — REGLA #0 contable

> Orden por riesgo de plata/fiscal. Cada uno necesita **CON y SIN** (o por valor) con verificación en DB.

**G1 — Límite CC + enforcement bloquea venta CC sobre el tope (CON `bloquear` vs SIN).** `evaluarLimiteCC` está bien probado en unit, pero **no hay e2e** y, más grave, **el enforcement es 100% client-side**: `VentasPage:2426-2435` lee `cliente_cc_estado` y decide en el front; **no existe trigger/guard en DB** (mig 172 solo provee el RPC de lectura). Una venta CC insertada por fuera de la UI (o con bundle cacheado) puede superar el límite sin bloqueo. e2e mínimo: cliente con deuda al tope, política `bloquear` → la venta CC se corta (assert toast + venta NO creada en DB); política `permitir` → pasa. Idem morosidad `bloqueo_total` vs `permitir`. **Evaluar guard server-side** (REGLA #0 obligación #3: guards server además de UI).

**G2 — Clave maestra gatea acciones patrimoniales: CON clave vs SIN clave.** Hoy los e2e corren con clave seteada (40/41) o sin clave (27, "owner sin clave"), pero **nunca contrastan el mismo flujo con y sin la clave**. Si `clave_maestra` es null, TODOS los gates se desactivan silenciosamente: cierre de caja ajena (CajaPage:658), anular venta, incobrable (Clientes:561), doble firma OC (Gastos:722) y envío (Envios:788), override de descuento (Ventas:2378). Falta e2e que pruebe: (a) SIN clave → la acción pasa sin pedir nada; (b) CON clave → pide y rechaza clave incorrecta. Verificación `verificar_clave_maestra` (RPC hash) en runtime aún 🟡.

**G3 — Condonación / incobrable / revertir: write-offs de receivables sin guard server-side ni (condonar) clave maestra.** `condonarDeudaCC` (Clientes:509) y `revertirDeudaCC` (530) están gateadas SOLO por `puedeGestionarCC` en la UI (sin RPC SECURITY DEFINER, sin clave maestra) — un write-off de deuda es patrimonial y debería tener la misma protección que `incobrable` (que sí pide clave). `confirmarIncobrable` pide clave **solo si está configurada**; SIN clave da de baja toda la deuda + crea gasto de pérdida sin segunda barrera. e2e 39/40 cubren el happy-path CON; falta el **SIN clave** y la verificación de que un rol no autorizado no pueda invocarlo por API.

**G4 — Descuento máximo por rol: el flag de CAJERO no se enforza y el de SUPERVISOR no tiene e2e.** `descuento_max_cajero_pct` es **flag huérfano de hecho**: el CAJERO está bloqueado de cualquier descuento (`descuentoBloqueadoCajero`, Ventas:2288), así que el % nunca se aplica — la UI solo lo muestra como title (4487/4510). Riesgo: el cliente cree que configuró un tope para cajeros y en realidad están en 0. `descuento_max_supervisor_pct` sí se enforza (2366-2370) con override por clave, pero **sin e2e CON/SIN**. Documentar/decidir el comportamiento real del flag de cajero (es zona de plata: descuentos = menos ingreso).

**G5 — Comprobante de gasto obligatorio (4 reglas combinables) sin cobertura CON/SIN.** `gastos_comp_*` (Gastos:1092-1112) gobierna si se exige adjunto. Es client-side (no hay guard en DB para "gasto sin comprobante"). Faltan escenarios: `siempre=true` bloquea sin adjunto; `si_iva`/`si_deduce_ganancias`/`si_monto>umbral` cada uno disparando aislado; y el caso `si_monto` con `umbral=0` (dispara siempre, posible sorpresa). Relevante para el contador del cliente (respaldo fiscal de la deducción).

**G6 — Interés de mora CC (sweep) por `cc_interes_mensual_pct`: CON vs SIN, end-to-end.** `calcularInteresMora` (unit ✅) pero el camino real es el sweep server `recalcular_intereses_cc_all` (mig 215, sin pg_cron → cron externo `sweeps.yml`). Falta e2e/integración: con `pct>0` y una venta CC vencida el sweep escribe `interes_cc` y entra a deuda vencida; con `pct=0` limpia `interes_cc` a 0 (mig 215:43-44). Es plata que se le cobra al cliente final.

**G7 (latente, avisar a GO) — `boveda_umbral_caja` configurable pero nunca consumido.** Está en ConfigPage (setter 710/1024) y en el tipo `supabase.ts`, pero **ningún componente lo lee** (grep: 0 usos de runtime). El DUEÑO puede setear "avisar cuando la caja supere $X para depositar en bóveda" y la app no hace nada. No rompe plata, pero es una expectativa de control de efectivo incumplida — candidato a implementar o quitar del Config para no engañar.

---

## Resumen

- **Lógicas relevadas:** ~55 (Caja/Bóveda 21 · Clientes/CC 21 · Gastos 13). La **lógica pura está muy bien cubierta por unit** (ccLogic, cajaSaldo, cajaArqueo, cajaPermisos, cobranzaCaja, umbralGasto, comprasPago/Cheques), y los **happy-paths por e2e** (specs 20, 27, 28, 32, 39, 40, 41 + 31).
- **Flags relevados:** 36 (Caja 11 · Clientes/CC 16 · Gastos 9). **Casi ninguno tiene e2e CON/SIN explícito** — la validación hoy es unit (lógica pura) o code-audit. 2 flags están rotos/huérfanos: `boveda_umbral_caja` (sin uso) y `descuento_max_cajero_pct` (nunca enforzado porque el cajero ya está 100% bloqueado).
- **Guards server-side:** solo el IVA de gastos (`fn_gastos_iva_guard`, mig 227) y el hash de clave (mig 233) viven en DB. **El enforcement de límite CC, morosidad, comprobante obligatorio, condonación/incobrable y descuentos es client-side** — choca con la obligación #3 de la REGLA #0.
- **Top 5 gaps REGLA #0:** (G1) límite/morosidad CC sin e2e y **sin guard server** sobre venta CC al tope; (G2) clave maestra CON vs SIN nunca contrastada (todos los gates se apagan con clave null); (G3) condonar/revertir write-offs sin clave ni guard server; (G4) `descuento_max_cajero_pct` no se enforza; (G5) comprobante de gasto obligatorio sin cobertura por regla.
