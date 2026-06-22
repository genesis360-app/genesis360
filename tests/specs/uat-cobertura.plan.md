---
name: uat-cobertura
description: Auditoría de cobertura de testing — inventario de funcionalidades + matriz de configuración/flags vs UAT, y plan para cerrar gaps. Pedido de GO (2026-06-21).
type: project
---

# Auditoría de cobertura de testing — Genesis360

> **Norte (GO, 2026-06-21):** "quiero saber que probamos TODO lo que tenemos para configurar y que
> funciona validado con test". Tener un listado de todas las funcionalidades (lógicas distintas) y
> cruzarlo contra los UAT para asegurar que **nada de la app va a fallar**; y un listado de todo lo
> configurable donde por cada flag se pruebe **con** y **sin** el flag y se valide el comportamiento
> esperado en cada combinación.

Estado del repo al 2026-06-21: **44 e2e** (`tests/e2e/*.spec.ts`) · **52 unit** (`tests/unit/*.test.ts`) ·
**42 páginas** (`src/pages/*.tsx`) · UAT en `tests/specs/` (`uat-modo-basico.md` ~300 escenarios +
`uat-primer-uso.plan.md` + planes por módulo). **~140 columnas de configuración** en `tenants`.

---

## 0) Decisión de estructura UAT (recomendación)

Hoy el UAT vive disperso: `uat-modo-basico.md` (el grande), `uat-primer-uso.plan.md`, y planes por
módulo (`caja/clientes/facturacion/inventario/ventas.plan.md` + `auditoria-basico.plan.md`).

**Recomendación: NO crear un UAT de "modo avanzado" separado.** Renombrar/refactorizar a **un único UAT
maestro** `uat-app.md` con escenarios **etiquetados por modo** y por flag:
- Tag `[BÁSICO]` / `[AVANZADO]` / `[AMBOS]` en cada escenario (el modo gatea UI, no datos).
- Tag `[CFG:<flag>=valor]` cuando el escenario depende de una configuración.
- Mantener `uat-primer-uso.plan.md` aparte (es el smoke de alta + paridad DEV↔PROD, se corre antes de
  cada cliente nuevo).

Motivo: el 90% de las lógicas son las mismas en básico y avanzado (el modo solo oculta/expone UI). Dos
archivos duplicarían escenarios y se desincronizarían. Un archivo + tags es más mantenible y deja ver de
un vistazo qué falta por modo. **Pendiente de OK de GO antes de renombrar.**

---

## 1) Método de validación (el que ya usamos, formalizado)

Cada lógica se valida en al menos una de estas capas, en orden de fuerza:
1. **e2e mutante** (Playwright vs DEV): aserción POSITIVA del resultado (toast/efecto) **+ verificar la
   mutación en DB** con SQL. NUNCA solo `.not.toBeVisible()` (da falso-verde). Es la capa más fuerte.
2. **unit** (vitest): lógica pura (cálculos fiscales, permisos, saldos, autorizaciones).
3. **UAT click-through manual** (`uat-modo-basico.md`): cuando el e2e es frágil (PDFs, impresión, AFIP
   runtime, integraciones reales, concurrencia, visual).
4. **code-audit**: leer el código contra la regla (REGLA #0) — complementa, no reemplaza.

**Para flags:** cada flag/setting necesita **2 escenarios** mínimos — comportamiento **CON** el flag y
**SIN** el flag (o cada valor del enum) — verificando el efecto real. Esto es lo nuevo que pide GO y es
donde está el grueso del gap (ver §3).

---

## 2) Inventario de funcionalidades por módulo + estado de cobertura

> Leyenda cobertura: ✅e2e (spec NN) · ✅unit · ✅UAT(§) · 🟡parcial · 🔴gap. REGLA #0 = plata/stock/fiscal.

### Ventas / POS  (REGLA #0)
- Venta directa (efectivo + vuelto) — ✅e2e 19 · venta no-efectivo (`ingreso_informativo`) — ✅e2e 26.
- Reserva con seña (`ingreso_reserva`) — ✅e2e 26 · Presupuesto crear→convertir (rebaje, PRES-08) — ✅e2e **44**.
- Venta CC (cuenta corriente) + cobranza CC — ✅e2e 28 · Devolución (reintegro stock + caja) — 🟡e2e 22 (reachability) / ✅DB.
- Facturación AFIP (Factura A/B/C, CAE) — ✅e2e 21 · **NC fiscal (CbtesAsoc, CAE)** — ✅e2e **42**.
- Anular venta (con/sin CAE — bloqueo) — 🟡code-audit · Cambiar cliente — 🔴gap e2e.
- Multi-medio de pago, cuotas, descuento por línea/total — 🟡unit (facturacion) · 🔴e2e.
- Canales (POS/MELI/TN/MP) + reglas por canal — 🔴gap · Ventas recurrentes — 🔴gap.
- **GAP UX conocido:** convertir presupuesto desde historial con 2+ cajas abiertas no expone selector de caja.

### Productos / Precios  (REGLA #0 fiscal)
- Alta producto + alícuota IVA (10,5/21/27/exento) — ✅e2e **43** (10,5) · 🟡 resto alícuotas.
- Kits (es_kit) — venta de kit rebaja componentes — 🔴gap e2e (REGLA #0 stock).
- Variantes (grupo_id, variante_valores) — 🔴gap · Precios mayoristas (tiers) — 🔴gap.
- Precio USD + cotización — 🟡 · Margen objetivo / alerta margen negativo — 🟡unit.
- Límite de productos por plan (max_productos) — 🔴gap.

### Inventario / WMS / Conteos  (REGLA #0 stock)
- Ingreso/ajuste de stock (no negativo, mode-aware) — ✅e2e 23 · Recepción→stock — ✅e2e 29.
- Traslado entre sucursales — ✅e2e 30 · Conteo con diferencia→ajuste DUEÑO directo — ✅e2e 36.
- Autorización de ajustes POR ROL (mig 228) — ✅unit (ajusteAutorizacion) · 🔴e2e rol≠DUEÑO (2 actores).
- Doble conteo (umbral reconteo), ABC/cíclico — 🔴gap · Kits/recetas consumo — 🔴gap.
- Trazabilidad write-time (venta_item_despachos) — 🟡code-audit.

### Caja / Bóveda  (REGLA #0 contable)
- Apertura/arqueo/cierre — ✅e2e 20 · Caja Fuerte depósito (2 patas) — ✅e2e 32.
- Cheques (pago con cheque → rechazo revierte) — ✅e2e 31 · Capital por moneda — 🟡code-audit.
- Traspaso entre cajas operativas, préstamo a empleado, panel cajero — 🔴gap.
- Clave maestra (hash, mig 233) setear — ✅e2e 41 · gatea acciones patrimoniales — 🟡.

### Clientes / Cuenta Corriente  (REGLA #0 contable)
- Alta cliente (DNI/tel obligatorios, notas) — ✅e2e 26 · Cobranza CC FIFO — ✅e2e 28.
- Condonación de deuda CC (write-off) — ✅e2e 39 · Incobrable con clave maestra — ✅e2e 40.
- Crédito a favor (cliente_creditos vía devolución) — 🔴gap · Intereses CC (sweep) — 🔴gap.
- Límite CC, morosidad/bloqueo, notificaciones CC — 🔴gap (todos flag-driven, ver §3).

### Compras / OC / Proveedores  (REGLA #0)
- Crear OC — ✅e2e 34 · Recepción vinculada a OC (→stock + OC recibida) — ✅e2e 35.
- Devolución a proveedor (crédito CC) — ✅e2e 33 · formas efectivo/reposición — 🔴gap.
- Gate de pago de OC (borrador→enviar→pagar/CC→confirmar) — 🔴gap · Aprobación OC por umbral — 🔴gap.
- Over/under-receipt (B3/B4) — 🔴gap · Cheques diferidos a proveedor — 🟡unit.

### Gastos  (REGLA #0 fiscal/contable)
- Gasto efectivo → egreso caja — ✅e2e 27 · IVA crédito/Ganancias por condición (mig 227) — ✅unit/code-audit.
- Gasto con cheque — ✅e2e 31 · Gastos fijos/recurrentes — 🔴gap · Umbrales/comprobante obligatorio — 🔴gap (flags).

### Envíos
- Envío propio → combustible → gasto — ✅e2e 38 · Crear envío, POD, hoja de ruta/reparto — 🔴gap.
- Pago a courier (tercero→egreso), tarifas/tramos, cotización API — 🔴gap (mucho flag-driven).

### RRHH
- Nómina → gasto de sueldo — ✅e2e 37 · Pagar nómina (RPC → caja/CC) — 🔴gap.
- Asistencia/fichado, vacaciones, liquidación final, recibo PDF — 🟡unit · 🔴e2e.

### Config / Suscripción / Roles
- Setear clave maestra hash — ✅e2e 41 · Modo básico/avanzado (navVisibility) — ✅unit.
- Matriz rol×modo (permisos) — ✅unit (navVisibility/permisosModulo) · Suscripción/trial/gating Pro — 🔴gap e2e.
- **TODO el módulo Configuración (las ~140 flags) → ver §3.** 🔴 grueso del gap.

---

## 3) Matriz de configuración / flags (lo NUEVO que pide GO)

`tenants` tiene **~140 columnas de configuración**. Por cada una hay que validar el comportamiento **con
y sin** (o por cada valor del enum). Agrupadas por módulo, con prioridad REGLA #0. Hoy **casi ninguna**
tiene un escenario CON/SIN explícito en e2e (la mayoría está solo en code-audit o implícita).

> Notación: `flag` (default) → escenarios a crear.

### 🔴 Fiscal / Facturación (PRIORIDAD MÁXIMA — REGLA #0)
- `condicion_iva_emisor` (RI/Monotributista/Exento) → emite A/B vs solo C; gastos con/sin IVA crédito. **§29 matriz, RUNTIME pendiente.**
- `facturacion_habilitada` (false) → con: aparece "Emitir comprobante"; sin: no.
- `afip_produccion` (false) → homologación vs producción (NO testear en prod real).
- `umbral_factura_b` (68305.16) → Factura B ≥ umbral exige DNI/CUIT (FAC-27, guard server). con/sin ident.
- Datos de comprobante: `razon_social_fiscal`, `domicilio_fiscal`, `ingresos_brutos`, `inicio_actividades`, `leyenda_comprobante`, `cbu/alias_cbu/banco`, `email_legal` → con: salen en el PDF; sin: no rompe.

### 🔴 Caja / Bóveda (REGLA #0 contable)
- `clave_maestra` (null) → con: gatea anular/incobrable/caja-ajena/diferencia; sin: no pide clave.
- `caja_fuerte_roles` → quién opera la bóveda.
- `diferencia_caja_umbral` + `diferencia_caja_alerta_roles/canales` → con umbral: notifica diferencia.
- `descuento_max_cajero_pct` / `descuento_max_supervisor_pct` → con: bloquea descuento sobre el tope.
- `boveda_umbral_caja`, `config_caja` (jsonb).

### 🔴 Clientes / CC (REGLA #0 contable)
- `cliente_obligatorio` (nunca/reservas/siempre) → con: bloquea venta/reserva sin cliente.
- `cliente_datos_minimos` (nombre/…) · `cliente_consumidor_final` · `cliente_creacion_inline`.
- `limite_cc_default` + `cc_enforcement_politica` (avisar/bloquear) + `cc_morosidad_politica` (bloqueo_cc) → con límite: bloquea venta CC sobre el tope.
- `cc_interes_mensual_pct` (0) → con: el sweep aplica intereses. `cc_dias_vencimiento`, `cc_notif_*`.
- `alerta_devoluciones_n` / `_dias` → con N: alerta cliente con > N devoluciones.

### 🔴 Inventario / Conteos (REGLA #0 stock)
- `regla_inventario` (FIFO) → FIFO vs otra → orden de rebaje.
- `ajuste_autorizacion_roles` (jsonb) → DUEÑO directo vs rol→autorización.
- `conteo_gate_activo` + `conteo_gate_umbral_*` → con gate: diferencia sobre umbral va a autorización.
- `conteo_reconteo_umbral_*` → con: fuerza doble conteo. `conteo_modo`, `conteo_wall_to_wall_bloquea`, `conteo_ciclico_dias_*`.
- `trazabilidad_asignacion` (true) → con: persiste venta_item_despachos.

### 🟠 Ventas / Reservas / Presupuestos
- `presupuesto_validez_dias` (30) → con: presupuesto vencido bloquea convertir hasta actualizar precios.
- `reserva_sena_obligatoria` (true) + `reserva_sena_minima_pct` (0) → con %: exige seña mínima.
- `reserva_penalidad_pct` (0) → con: cancelar reserva aplica penalidad. `reserva_vencimiento_dias`.
- `moneda` (ARS) + `cotizacion_usd` · `precio_redondeo` (none) · `cuotas_bancos` · `reglas_canal`.

### 🟠 Compras / Gastos
- `oc_aprobacion_activa` + `_umbral` → con: OC sobre umbral requiere aprobación.
- `permite_over_receipt` + `over_receipt_pct_max` → con: recepción > pedido permitida hasta %.
- `oc_pago_doble_firma_umbral`, `oc_numeracion`, `recepcion_remito_obligatorio`, `compras_costo_alerta_pct`.
- `gastos_comp_*` (comprobante obligatorio: siempre/si_iva/si_monto/si_deduce_ganancias) → con: exige comprobante.

### 🟡 Envíos (mucho flag-driven)
- `envio_cobro_politica` (cliente_100) · `envio_courier_genera_gasto` (true) · `envio_factor_km`/`costo_envio_por_km` · `pod_campos_requeridos`/`pod_otp_umbral`/`pod_foto_min` · `envio_pago_doble_firma_umbral` · `envio_token_*` · `envio_identidad_modo` · `envio_gratis_reglas` · `envio_tramos`/`envio_recargo_horario` · alertas `envio_alerta_*`.

### 🟡 RRHH
- `rrhh_nomina_doble_validacion` / `rrhh_nomina_supervisor_aprueba` → con: nómina requiere 2da firma.
- `rrhh_tardanza_modo` (registrar/descontar) + `rrhh_tardanza_tolerancia_min` → con descontar: descuenta en liquidación.
- `rrhh_horas_extra_requiere_aprobacion`, `rrhh_vacaciones_*`, `rrhh_portal_empleado`/`_capacidades`, `rrhh_doc_alerta_dias`, `rrhh_notif_config`.

### 🟢 Plataforma / Plan / Integraciones
- `modo_operacion` (basico/avanzado) → gatea UI (navVisibility ✅unit; faltan flujos avanzados e2e).
- `subscription_status` (trial/active/…) + `plan_id` + `max_users`/`max_productos`/`addon_movimientos` → gating Pro, límites.
- `session_timeout_minutes` · `marketplace_activo`/`marketplace_webhook_url` · `whatsapp_plantilla` · `cumple_notif_*`.

---

## 4) Gaps priorizados (qué crear, en orden REGLA #0)

**Tanda A — REGLA #0 sin e2e (plata/stock/fiscal):**
1. §29 matriz fiscal RUNTIME: `condicion_iva_emisor` RI/Mono/Exento × emitir CAE real + gastos IVA crédito (requiere AFIP homologación).
2. Kit: venta de kit → rebaja de componentes (stock).
3. Límite CC + enforcement (`limite_cc_default`/`cc_enforcement_politica`): venta CC sobre el tope con/sin bloqueo.
4. Clave maestra gatea: anular/incobrable/caja-ajena CON clave seteada vs sin.
5. Descuento máx por rol (`descuento_max_*`): bloquea sobre el tope.
6. Conteo gate por umbral + reconteo (`conteo_gate_*`/`conteo_reconteo_*`) + autorización por rol≠DUEÑO.
7. Over-receipt (`permite_over_receipt`) + OC aprobación por umbral + gate de pago de OC.
8. Devolución a proveedor formas efectivo/reposición · crédito a favor de cliente · intereses CC (sweep).

**Tanda B — operativo importante:**
9. Reservas: seña mínima/penalidad/vencimiento (flags). Presupuesto vencido bloquea convertir.
10. RRHH: pagar nómina (caja/CC) + doble validación + tardanza descontar. Envíos: crear/POD/reparto/pago courier.
11. Suscripción/trial/gating Pro + límites de plan.

**Tanda C — capa manual (no e2e):** PDFs/impresión (factura/NC/remito/presupuesto/recibo/etiquetas), PWA,
integraciones reales (couriers B2B, MELI/TN), visual PROD, concurrencia.

---

## 5) Recomendación de ENFOQUE (yo vs agentes)

El trabajo tiene 2 naturalezas distintas:

**(a) Enumeración exhaustiva por módulo** (leer cada página + libs + flags y listar TODA lógica y su
comportamiento esperado con/sin cada flag). Es **read-only, paralelizable y voluminoso** → **ideal para
agentes.** Propuesta: lanzar **1 agente `relevamiento`/`Explore` por grupo de módulos** (Ventas+Productos,
Inventario+Conteos, Caja+CC, Compras+Gastos+Envíos, RRHH, Config+Suscripción), cada uno produce su sección
de inventario+matriz de flags. Luego YO consolido en `uat-app.md` y priorizo.

**(b) Autoría + corrida de e2e/UAT** (escribir specs, correr contra DEV, verificar en DB, triagear). Requiere
contexto de convenciones + acceso a DB + iteración → **lo hago yo** (o el agente `test-author` bajo mi
supervisión, spec por spec, porque cada uno necesita verificación en DB que el agente no cierra solo).

**Plan sugerido (por fases, cada una revisable):**
- **F0 (hecho):** este documento — inventario inicial + matriz de flags + estructura.
- **F1:** agentes de enumeración (a) → consolidar `uat-app.md` con TODOS los escenarios etiquetados `[modo]`/`[CFG]`.
- **F2:** Tanda A de gaps (REGLA #0) → e2e mutantes + verificación en DB (yo).
- **F3:** Tandas B/C → e2e donde se pueda + checklist manual para capa C.
- Cada fase cierra con: specs verdes + UAT actualizado + wiki.

**Decisión pendiente de GO:** (1) ¿OK renombrar a `uat-app.md` con tags? (2) ¿Lanzo los agentes de
enumeración de F1 ahora, o lo hago módulo por módulo yo? (3) ¿Priorizamos la Tanda A de gaps antes o
después de la enumeración completa?

---

## 6) Ya validado esta sesión (2026-06-21) — incorporar a `uat-app.md`
- **NC fiscal** (spec 42): devolución facturada → NC electrónica CbtesAsoc → CAE real. `[AMBOS][CFG:facturacion_habilitada=true]`.
- **Alta producto alícuota 10,5%** (spec 43): persiste sin convertir a 21%. `[AMBOS]`.
- **Presupuesto crear→convertir** (spec 44): sin tocar stock/caja → despacho con rebaje (PRES-08). `[AMBOS]`.
- **Gotcha UX:** convertir presupuesto desde historial con 2+ cajas abiertas no expone selector de caja (escenario negativo a documentar + fix sugerido).
