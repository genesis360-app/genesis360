---
name: relevamiento_clientes_respuestas
description: Respuestas consolidadas del relevamiento de reglas de negocio del módulo Clientes (GO + socio). Origen del backlog de implementación por fases CL1-CL6.
type: project
status: COMPLETO — A-H respondidas y resueltas (2026-06-01). Sin Top 3 (GO pidió implementar todo). Plan por fases definido.
source: relevamiento-clientes-reglas-negocio.html
updated: 2026-06-01
---

# Respuestas — Relevamiento Reglas de Negocio · Clientes

> **Estado:** todas las secciones respondidas y cruzadas con `relevamiento_ventas_respuestas.md` (varios ítems de CC clientes comparten definición con Ventas sección D, que estaba respondida pero **sin implementar** — se implementa acá).
> **GO no eligió Top 3: entra todo.** Plan por fases CL1-CL6 abajo.
> **Transversal crítico:** `pg_cron` NO habilitado → todo disparo por tiempo (intereses, recordatorios, escalados) va por **sweep lazy vía RPC** (patrón `liberar_reservas_vencidas`), no job nocturno.

---

## A. Alta y datos del cliente

| # | Respuesta | Resumen para implementación |
|---|---|---|
| A1 | **D** | Distinguir **"Consumidor final" (sin datos) vs "Cliente regular"**. ✅ Coherente y unificado con **Ventas H5**: flag al iniciar la venta, apoyado en Config *"Cliente en el punto de venta"*. Venta a consumidor final queda sin datos pero **distinguida** (filtrable/reportable). Si el negocio factura y NO es consumidor final → cliente obligatorio. |
| A2 | **B (resuelto)** | Permitir el alta con **alerta visual de posible duplicado** (match DNI/teléfono/nombre, "¿es el mismo que X?") en vez del **rechazo duro** actual por UNIQUE(dni). No traba la venta. Se conecta con A5 (import) y G2 (alerta DNI sospechoso). |
| A3 | **A** | CUIT/condición IVA opcionales, solo para facturar. Sin cambios. |
| A4 | **A** | Clientes globales del tenant. Sin cambios. |
| A5 | **B + 3 modos** | Import con detección de duplicados (DNI/tel/email) **+ los 3 modos del importador de productos**: *ignorar existentes / ignorar nuevos / procesar todos*. Permitir etiquetas en el CSV (segmentación rápida). |
| A6 | **C** | Soft delete (`clientes.activo`) + **razón de baja** (mudó / cerró / conflicto). Conserva historial. |

---

## B. Cuenta corriente — clientes

| # | Respuesta | Resumen |
|---|---|---|
| B1 | **D (resuelto)** | Enforcement **configurable por tenant**: `enforce` / `avisar` / `permitir` (default **avisar**). Sobre `clientes.limite_cc` + `tenants.limite_cc_default` (precedencia cliente > tenant > sin límite). = base de **Ventas D1**, pero sin imponer bloqueo duro a quien no lo quiere. |
| B2 | **B** | Solo DUEÑO/SUPERVISOR habilita la CC del cliente; CAJERO solo carga datos básicos. |
| B3 | **C** | Vencimiento por venta + **interés de mora** configurable (% mensual sobre saldo vencido). = **Ventas D2**. `tenants.cc_dias_vencimiento`, `cc_interes_mensual_pct`, `ventas.fecha_vencimiento_cc`. Recalculo por **sweep lazy**. |
| B4 | **A + configurable** | Moroso: **no compra CC pero sí efectivo** (default) + configurable a bloqueo total. = **Ventas D6** (`tenants.cc_morosidad_politica`). |
| B5 | **A+B+C** | Cobranza desde **ficha + POS ("Pago de deuda") + Caja (cobranza masiva)**. = **Ventas D5**. (d) cobranza parcial sobre venta específica = mejora opcional. |
| B6 | **B+D+C** | Incobrables: botón "Dar de baja incobrable" → **gasto automático "Deudores incobrables"** + **clave maestra del DUEÑO** (decisión patrimonial, no supervisor) + **motivo obligatorio** + audit log. = recomendación **Ventas D7**. |
| B7 | **A (backlog)** | Tope de deuda global: **no es necesario por ahora** → diferido. = **Ventas D8**. Si crece la CC en 3-6 meses, pasar a umbral fijo (b). |
| B8 | **D** | Estado de cuenta: vista actual + **PDF descargable** (email/WA) + **portal público con token** (sin login). Reusa patrón `SECURITY DEFINER` para anon. |

---

## C. Notificaciones al cliente

> Todas **configurables por tenant** (canales) para no contradecir **Ventas D3** (`cc_notificacion_canales`). Infra de email/WA reusada de Ventas A9/F4. Disparos por fecha = **sweep lazy**.

| # | Respuesta | Resumen |
|---|---|---|
| C1 | **D → configurable (default ambos)** | Notificar al registrar deuda nueva: email + WhatsApp, configurable por tenant (default ambos). |
| C2 | **B+C+D** | Recordatorio pre-vencimiento: **N días antes** (configurable) + **canal preferido del cliente** + **plantilla configurable**. |
| C3 | **B+C** | Aviso al vencer + recordatorio cada 7 días si sigue impaga + **escalado interno al DUEÑO/SUPERVISOR** si pasa X días vencido. Ambos configurables. |
| C4 | **B+C → configurable** | Confirmación de pago: comprobante por email (b) + agradecimiento WA (c). Hereda el default configurable de C1. |
| C5 | **B (default ON) + C (opcional OFF)** | Cumpleaños: saludo automático con cupón configurable (default ON) + lista de cumpleañeros al DUEÑO (opcional, OFF por default). |
| C6 | **D** | Marketing: solo **segmentación + export** para enviar desde otra herramienta. Sin bulk-sender nativo. → backlog. |

---

## D. Cuenta corriente con proveedores

| # | Respuesta | Resumen |
|---|---|---|
| D1 | **A** | Mantener como está (mig v1.8.44: límite + bloqueo OC + override DUEÑO). |
| D2 | **D** | (b)+(c): notificar al DUEÑO N días antes del vencimiento + bloqueo automático de nuevas OC CC con deuda vencida. |
| D3 | **B+C (resuelto)** | PDF estado de cuenta proveedor (b) + **reporte consolidado de todas las CC con vencimientos próximos** (c). Espeja B8 de clientes. |
| D4 | **B+C (resuelto)** | NC automática al registrar **devolución a proveedor** (b) + **correlativo + comprobante adjunto** PDF/imagen (c). |
| D5 | **C (resuelto)** | Pago parcial: **ambos modos** (FIFO o asignación manual a OC, elige el operador). Coherente con B5 clientes. |
| D6 | **B (resuelto)** | **Múltiples cuentas bancarias por proveedor** (CBU + alias + banco + titular). Encaja con decoupling de "Cuentas de Origen". No obligatorio para no trabar el alta. |

---

## E. Productos y servicios del proveedor

| # | Respuesta | Resumen |
|---|---|---|
| E1 | **A** | Varios proveedores por producto con precios distintos. Sin cambios. (E1b "proveedor principal sugerido en OC" = mejora opcional barata, anotada.) |
| E2 | **A** | Presupuesto manual + aprobación + creación de gasto. Sin cambios. |
| E3 | **A** | Contactos múltiples por proveedor. Sin cambios. |
| E4 | **A** | Sin evaluación de proveedores. → backlog. |

---

## F. Segmentación y fidelización

| # | Respuesta | Resumen |
|---|---|---|
| F1 | **B** | Catálogo de etiquetas predefinidas + libres con autocomplete. |
| F2 | **D** | Fidelización por puntos → diferido/backlog. |
| F3 | **DESCARTADO** | 🔴 Contradecía **Ventas G2**. **Resuelto por GO (2026-06-01): solo precio por cantidad por producto** (`producto_precios_mayorista`, ya en PROD). **NO** se crea `cliente.lista_id` ni tabla de listas. El "cliente mayorista" paga mayorista por volumen, no por flag. |
| F4 | **B** | Audit log de cambios de datos del cliente (quién cambió tel/dirección/CC/etc.). |

---

## G. Reportes y alertas

| # | Respuesta | Resumen |
|---|---|---|
| G1 | **B,C,D,E + A (sumado)** | Reportes: **top clientes por volumen** (A, sumado por recomendación), clientes inactivos (B), **deuda vencida aging 0-30/31-60/61-90/+90** (C), cohort nuevos+retención (D), top proveedores + plazo entrega (E). |
| G2 | **A,C,D** | Alertas: deuda vencida (A), DNI duplicado/sospechoso (C), proveedor CC pendiente y vencida (D). |
| G3 | **A** | Export Excel + PDF + CSV (consistente con Caja v1.10.0 y Ventas K3). |

---

## H. Permisos por rol

| # | Respuesta | Resumen |
|---|---|---|
| H1 | **A** | Todos los roles con acceso a Clientes ven todo (incl. CUIT/IVA y deuda). Ocultar límite/deuda al cajero (opción c) queda como **toggle configurable opcional**, no default. |
| H2 | **B** | CONTADOR **read-only**: ve CC, historial, datos fiscales; no edita. = **Ventas J3**. (SU mantiene su acceso amplio aparte.) |

---

## Plan de implementación por fases (GO: "entra todo")

Cada fase es autocontenida y se deploya a PROD con su versión. Orden por dependencia/riesgo.

| Fase | Versión | Alcance | Migrations clave |
|---|---|---|---|
| **CL1 — Fundación datos + permisos** | `v1.18.0` | A2 (alerta duplicado) · A6 (soft delete + razón) · A5 (import 3 modos + etiquetas) · F1 (catálogo etiquetas) · B2 (gate habilitar CC) · H1/H2 (permisos, CONTADOR read-only) | `clientes.activo/motivo_baja`, catálogo etiquetas |
| **CL2 — CC: límite + vencimiento + morosidad** | `v1.19.0` | B1 (enforcement configurable) · B3 (vencimiento + interés mora, sweep lazy) · B4 (morosidad configurable) · B5 (cobranza ficha+POS+caja masiva) | `clientes.limite_cc`, `tenants.limite_cc_default/cc_dias_vencimiento/cc_interes_mensual_pct/cc_morosidad_politica/cc_enforcement_politica`, `ventas.fecha_vencimiento_cc` |
| **CL3 — Incobrables + estado de cuenta** | `v1.20.0` | B6 (incobrables: gasto auto + clave maestra + motivo + audit) · B8 (PDF + portal público token) | token público, categoría gasto reservada |
| **CL4 — Notificaciones al cliente** | `v1.21.0` | C1 · C2 · C3 (escalado) · C4 · C5 (cumpleaños). Configurable por canal, sweep lazy | `tenants.cc_notificacion_canales`, plantillas, config cumpleaños |
| **CL5 — CC proveedores** | `v1.22.0` | D2 (notif+bloqueo) · D3 (PDF+consolidado) · D4 (NC auto+correlativo+adjunto) · D5 (FIFO/manual) · D6 (múltiples cuentas) | `proveedor_cuentas_bancarias`, correlativo NC |
| **CL6 — Reportes, alertas, export** | `v1.23.0` | G1 (top/inactivos/aging/cohort/top prov) · G2 (alertas) · G3 (export) · F4 (audit log cliente) | — (sobre datos existentes) |

**Backlog (no se implementa ahora):** B7 (tope global), C6 (marketing bulk), F2 (fidelización puntos), F3 (descartado), E1-E4 (mantener), E1b proveedor principal (mejora opcional).

**Versionado:** las versiones CL1-CL6 son tentativas; pueden colisionar con releases intermedios (bugfixes). Confirmar el número real en cada deploy contra `brand.ts`.

---

## Estado de implementación (DEV)

### Fase CL1 — `v1.18.0` ✅ Implementado en DEV (2026-06-01) · mig 171

| Ítem | Estado | Detalle |
|---|---|---|
| **A6** | ✅ | Baja = soft delete con razón. `clientes.motivo_baja/baja_at/baja_por` (mig 171). El botón de papelera (hard delete, era código muerto) se reemplazó por `UserX` "Dar de baja" → modal con razón (Se mudó / Cerró / Conflicto / Duplicado / Otro). Badge "Baja · motivo" en la card. Toggle "Ver inactivos" + `RotateCcw` para reactivar. Query filtra `activo=true` por defecto. |
| **A2** | ✅ | Alerta de posible duplicado al crear (no al editar): chequea DNI / nombre / teléfono normalizado y pide confirmación. El DNI idéntico lo sigue bloqueando el índice único. |
| **A5** | ✅ | Import detecta duplicados contra TODA la base por DNI/teléfono/nombre + selector de 3 modos (ignorar existentes / ignorar nuevos / procesar todos). Actualiza existentes vía UPDATE. Columna `etiquetas` en la plantilla. Resultado: creados/actualizados/ignorados/errores. |
| **F1** | ✅ | Autocomplete de etiquetas vía `<datalist>` = `tenants.cliente_etiquetas_catalogo` (mig 171) ∪ etiquetas ya usadas. |
| **B2** | ✅ | Toggle de habilitar CC deshabilitado salvo `puedeGestionarCC` + nota. |
| **H2** | ✅ | CONTADOR read-only: `/clientes` en `CONTADOR_ALLOWED` + `contadorVisible`. `esContador` oculta crear/editar/baja/importar. |
| **H1** | ✅ | Cajero ve todo (default). Ocultar límite/deuda al cajero = toggle opcional diferido. |

> Build verde (`tsc && vite build`). Migration 171 aplicada en DEV. Falta aplicar en PROD al deployar.

### Fase CL2 — `v1.19.0` ✅ Implementado en DEV (2026-06-01) · mig 172

CC de clientes: límite + vencimiento + interés + morosidad. Reusa `clientes.limite_credito` como límite por cliente. **`pg_cron` no habilitado → intereses por sweep-lazy.**

| Ítem | Estado | Detalle |
|---|---|---|
| **B1** | ✅ | Enforcement configurable `tenants.cc_enforcement_politica` (permitir/avisar/bloquear, default avisar) + `tenants.limite_cc_default` (precedencia cliente `limite_credito` > tenant > sin límite). En el POS (`registrarVenta`): si la parte CC deja la deuda > límite, según política avisa (confirm) o bloquea. |
| **B3** | ✅ | `ventas.fecha_vencimiento_cc` (= hoy + `tenants.cc_dias_vencimiento`) seteado al crear venta CC. Interés de mora `tenants.cc_interes_mensual_pct` acumulado en `ventas.interes_cc`, recalculado por RPC **`recalcular_intereses_cc(tenant)`** (idempotente, sweep-lazy al abrir tab CC de Clientes). Tab CC muestra interés de mora + vencimiento real por venta. |
| **B4** | ✅ | Morosidad `tenants.cc_morosidad_politica` (permitir/bloqueo_cc/bloqueo_total, default bloqueo_cc). En el POS: si hay deuda vencida → bloqueo_cc impide sumar a CC (deja pagar por otro medio), bloqueo_total impide cualquier venta. RPC **`cliente_cc_estado(cliente)`** (deuda_total / deuda_vencida / interes_total, tenant-scoped). |
| **B5** | ✅ | Cobranza FIFO desde **las 3 vías**: ficha del cliente (`registrarPagoCC`), **POS** (botón "Deuda CC $X" en el chip del cliente → modal de cobranza) y **Caja** (tab "💳 Cobranzas CC" masivo, `CajaCobranzasCC`). Helper compartido `src/lib/cobranzaCC.ts` (`cobrarDeudaCCFIFO`). Nota: la cobranza CC no genera movimiento de caja (comportamiento histórico, consistente en las 3 vías) — eventual follow-up si se quiere que impacte el arqueo. |
| **Config** | ✅ | ConfigPage → Ventas → Operativa: nueva sección "Cuenta corriente de clientes" (enforcement, límite general, morosidad, días de vencimiento, interés mensual). |

> Build verde. **Deployado a PROD en v1.19.0** (PR #140) — migrations 171+172 aplicadas en DEV y PROD. **CL1 + CL2 COMPLETOS.**

> **Migrations:** 171 (CL1), 172 (CL2 + RPCs `cliente_cc_estado`, `recalcular_intereses_cc`). En DEV y PROD.
