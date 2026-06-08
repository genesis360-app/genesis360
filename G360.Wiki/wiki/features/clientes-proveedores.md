---
title: Clientes y Proveedores
category: features
tags: [clientes, proveedores, crm, cuenta-corriente, ordenes-compra]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-06-03
---

# Clientes y Proveedores

---

## Módulo Clientes

**Página:** `src/pages/ClientesPage.tsx` (`/clientes`)  
**Acceso:** OWNER · SUPERVISOR · CAJERO

### Campos principales

```
nombre, dni (UNIQUE por tenant WHERE NOT NULL), teléfono (obligatorio),
email, dirección
cuit_receptor, condicion_iva_receptor    ← para facturación AFIP
cuenta_corriente_habilitada, limite_credito, plazo_pago_dias  ← v1.4.0
fecha_nacimiento, etiquetas TEXT[], codigo_fiscal, regimen_fiscal  ← v1.3.0
```

### Búsqueda

- Por nombre o por DNI (`.or('nombre.ilike.%X%,dni.ilike.%X%')`)
- Filtro por etiquetas (badges violeta)

### Sub-tabs en ficha del cliente

1. **Historial** — todas las ventas del cliente con link directo
2. **Domicilios** — `cliente_domicilios` (alias, referencias, es_principal ⭐)
3. **Notas** — historial append-only (texto + usuario_id + created_at)

### Cuenta Corriente (v1.4.0 · migration 083)

- Toggle CC habilitada + límite de crédito + plazo de pago
- Badge verde "CC" en card del cliente
- Tab "Cuenta Corriente" en ClientesPage: KPIs, lista por cliente con deuda/fecha vencimiento/estado
- Botón WA pre-armado para recordatorios

**En VentasPage:** botón "Despachar a cuenta corriente" (solo si cliente tiene CC habilitada).  
Bypasa validación de pago/caja. Inserta con `monto_pagado=0`, `es_cuenta_corriente=true`.

### Pago inline CC — v1.5.0

`registrarPagoCC(clienteId)`:
1. Distribuye el pago **FIFO** (by `created_at`) sobre las ventas en CC del cliente
2. `min(restante, saldo_pendiente)` por venta
3. Acumula `medio_pago` JSON
4. Marca `despachada` cuando el saldo llega a 0
5. Panel inline en tab CC de ClientesPage (sin navegar a otra pantalla)

### Registro inline desde checkout

Mini-form nombre + DNI + teléfono directamente en el carrito de ventas, sin salir de la venta.

### Validaciones

- `validarDNI()`: 7-8 dígitos (strip puntos/guiones)
- `validarTelefono()`: strip +54/0/9 → 8-11 dígitos

### Cumpleaños de clientes

Badge 🎂 en card. Rojo/rosa si es hoy el cumpleaños.

### Apertura por URL

`/clientes?id=XXX` expande la ficha automáticamente (limpia el param después).

---

## Módulo Proveedores

**Página:** `src/pages/ProveedoresPage.tsx` (`/proveedores`)  
**Acceso:** OWNER (ownerOnly)  
**Migration:** 049 (v0.76.0)

### Campos

```
nombre, razon_social, cuit, condicion_iva (RI/Mono/Exento/CF),
plazo_pago_dias INT, banco, cbu, domicilio, notas, activo, sucursal_id
etiquetas TEXT[]   ← v1.3.0
```

### Tabs

1. **Proveedores** — CRUD con modal form 12+ campos, toggle activo
2. **Órdenes de Compra** — lifecycle completo
3. **Servicios** (v1.3.0) — tipo='servicio', gestión completa

---

## Órdenes de Compra (migration 049)

**Lifecycle:** `borrador → enviada → confirmada → cancelada`  
Extensión post-v0.88.0: `recibida_parcial` / `recibida` (cuando se usa módulo Recepciones)

### Schema

```sql
ordenes_compra(
  tenant_id, proveedor_id, 
  numero INT  -- auto per tenant (trigger)
  estado CHECK(borrador/enviada/confirmada/cancelada/recibida_parcial/recibida)
  fecha_esperada, notas, created_by
)
orden_compra_items(orden_compra_id, producto_id, cantidad, precio_unitario, notas)
```

### Botón OC rápida en ProductosPage

Modal rápido: proveedor + cantidad + precio opcional → crea o agrega a OC en borrador.

### Vínculo OC → Recepciones

OC confirmada → botón "Recibir mercadería" → `/recepciones/nuevo?oc_id=XXX` pre-popula ítems.

---

## Módulo Compras 2.0 (relevado 2026-06-05 — plan CO1-CO8)

Relevamiento completo + diseño + plan por fases en `sources/raw/relevamiento_compras_respuestas.md`. **CO1-CO6 + CO7a en PROD (v1.31.0-v1.37.0, mig 182-187).** Filosofía: simple para el usuario PyME, robusto por dentro.

### CO1 — Gobierno de OC (v1.31.0, mig 182)
- **A1 creación por rol** (`src/lib/comprasPermisos.ts` → `capacidadCrearOC`): DUEÑO/ADMIN/SUPERVISOR completa · **DEPOSITO solo borradores** ("Nueva OC (borrador)") · CAJERO/CONTADOR sin acceso.
- **A2 aprobación por umbral:** la OC que supera `tenants.oc_aprobacion_umbral` queda `requiere_aprobacion`; solo un rol aprobador la envía ("Aprobar y enviar" → `aprobada_por`/`aprobada_at`). `puedeEnviarOC`.
- **A4 sucursal obligatoria** en la OC.
- **A5 numeración configurable** `tenants.oc_numeracion` (default `sucursal`; `set_oc_numero` asigna `numero_sucursal`; etiqueta `S-OC-0001`).
- **D5 pago:** CONTADOR read-only (`puedeRegistrarPagoOC`) + **doble firma por umbral** (`oc_pago_doble_firma_umbral`) con clave maestra en el modal de pago de Gastos.
- Config en **Config → Gastos → Órdenes de compra**.

### CO2 — Recepción robusta (v1.32.0, mig 183)
- **B5 (fix):** el estado de la OC se recalcula desde el **acumulado de TODAS las recepciones confirmadas** (`src/lib/recepcionLogic.ts` → `estadoOCdesdeRecibido`), no solo la actual → una OC completada en parciales llega bien a `recibida`.
- **B3 over-receipt** con umbral % acumulado (`tenants.over_receipt_pct_max`). **B4 motivo de faltante** obligatorio en under-receipt (catálogo) + `recepcion_alerta_faltante_dias`. **B1c** over/under requiere SUPERVISOR+. **B7 remito** adjunto (bucket privado `remitos` scoped por tenant, `recepcion_remito_obligatorio`). **B2** recepción sin OC exige proveedor.

### CO3 — Costos (v1.33.0, mig 184)
- **E1 alerta de cambio de costo** al recibir (`tenants.compras_costo_alerta_pct`, default 10%) → checkbox por línea para actualizar el `precio_costo` (`src/lib/comprasCostos.ts`).
- **E2 costos accesorios** sueltos en la OC (`costo_aduana/comision/otros`).
- **B6 editar precio** en recepción con audit (`actividad_log`).
- **E3 alta rápida de producto** desde la recepción (DUEÑO/SUPERVISOR → `productos.pendiente_revision`).

### CO4 — Devolución a proveedor (v1.34.0, mig 185)
- Entidad separada **`devoluciones_proveedor`** + `devolucion_proveedor_items` (RLS + trigger correlativo). Desde el detalle de una OC recibida → **"Devolver a proveedor"**: ítems + cantidades, motivo (catálogo) + obs opcional, y **forma del reembolso** (`src/lib/devolucionProveedor.ts`):
  - **crédito_cc** → nota de crédito en `proveedor_cc_movimientos` (reduce deuda)
  - **efectivo** → ingreso a la caja abierta
  - **reposicion** → OC nueva (borrador) por los mismos ítems
- Al confirmar **rebaja stock FIFO** por producto en la sucursal + movimiento `ajuste_rebaje`; valida stock disponible. Reemplaza el flujo huérfano `tiene_reembolso_pendiente`.

### CO5 — Pago: anticipo + contra-entrega + schedule (v1.35.0, mig 186 · PROD ✅)
Lógica pura en `src/lib/comprasPago.ts`.
- **D1 — modo de pago por proveedor:** `proveedores.modo_pago` (`contado | anticipo | contra_entrega | cuenta_corriente`, CHECK) + `anticipo_pct`. En el form de proveedor: select de modo + % de anticipo (visible solo si modo = anticipo). Al elegir el proveedor en una OC, `defaultAnticipoOC` propone **"paga con anticipo" + %**; se puede destildar u override del % por OC. Snapshot en `ordenes_compra.paga_con_anticipo` + `anticipo_pct`. El badge **💰 Anticipo** + alerta por días sin recepción ya vive en **Gastos → OC** (escalado D1b).
- **D2 — plan de pagos opcional por OC:** `ordenes_compra.pago_schedule JSONB` = `[{etiqueta, base 'confirmacion'|'recepcion'|'dias', dias?, pct}]`. Editor de cuotas en el form de OC; `scheduleValido` exige que sumen 100%. Es **opcional** (plantilla, no obligatorio) y se muestra como **guía** en el modal de pago.
- **D3 — comprobante de transferencia:** reusa `ordenes_compra.comprobante_url` (ISS-096). En el modal de pago, cuando hay un medio **Transferencia** con monto, aparece **"Adjuntar comprobante"** (o "Ver" si ya está) — bucket `comprobantes-gastos`, path `<tenant>/oc/<ocId>.<ext>`.

### CO6 — Cheques diferidos (v1.36.0, mig 187 · PROD ✅)
Lógica pura en `src/lib/comprasCheques.ts`. Tab **Cheques** en Gastos (`src/components/ChequesPanel.tsx`).
- **Tabla `cheques`** (RLS por tenant + correlativo): `tipo` propio (emitido a un proveedor) / tercero (recibido de un cliente), `nro_cheque`, `banco`, `monto`, `fecha_emision`, `fecha_cobro` (diferida), `estado`, `proveedor_id`, `endosado_a_proveedor_id`, `cliente_origen`, `oc_id`, `sucursal_id`.
- **Estados + transiciones guiadas por tipo** (`estadosSiguientes`): propio `en_cartera→entregado→cobrado|rechazado|anulado`; tercero `en_cartera→endosado|depositado→cobrado|rechazado|anulado`.
- **Endoso** (`puedeEndosar`): un cheque de tercero en cartera se endosa a un proveedor (queda `endosado`).
- **Alerta de cobro** (`chequeProximoACobrar`): cheques pendientes con `fecha_cobro` dentro de `tenants.cheques_alerta_dias` (o vencidos) → badge en el tab + resaltado. Total pendiente sumando los no terminales.

### CO7a — OC inteligente (v1.37.0 · PROD ✅)
Lógica pura en `src/lib/ocPDF.ts`.
- **A6 — enviar OC al proveedor:** desde el detalle de OC, botones **PDF** (`generarOCPDF`, jsPDF/autotable), **Email** (`send-email` con el resumen `textoOC`) y **WhatsApp** (link `wa.me` con plantilla, `waLinkOC`). La OC trae email/teléfono/CUIT/condiciones del proveedor.
- **A3 — auto-draft desde stock bajo:** en Alertas, **"Generar OC sugerida"** consolida los productos bajo mínimo por proveedor (vía `proveedor_productos`) y crea OCs borrador con la cantidad faltante sugerida. Gateado por `capacidadCrearOC`; exige sucursal.

### Pendiente (CO7b-CO8)
- **CO7b** servicios: F1 recurrentes (sweep lazy) + F2 catálogo genérico del tenant + F3 comparar presupuestos lado a lado.
- **CO8** reportes/alertas/export + reporte de diferencias OC vs recepción (E4) + calificación de proveedor (G1/G2/G3).

---

## Proveedor Productos y Servicios (v1.3.0 · migration 073)

```sql
proveedor_productos(proveedor_id, producto_id, precio_compra, cantidad_minima, costos)
servicio_items(proveedor_id, nombre, descripcion, forma_pago)
servicio_presupuestos(
  proveedor_id, estado pendiente|aprobado|rechazado|convertido,
  adjunto (PDF/imagen), gasto_id FK gastos(id)
)
```

**Aprobar presupuesto:** crea gasto automáticamente en módulo Gastos y vincula `gasto_id`.

---

## Domicilios de clientes (migration 074)

```sql
cliente_domicilios(
  cliente_id, alias, calle, numero, piso, ciudad, provincia, cp,
  referencias, es_principal BOOLEAN
)
```

Prerequisito para módulo Envíos (selector de domicilio al crear envío).

---

## Cuenta Corriente con Proveedores — v1.6.0 (migration 085)

### Campos en `proveedores`
```sql
cuenta_corriente_habilitada BOOLEAN
limite_credito_proveedor DECIMAL
```

### Tabla `proveedor_cc_movimientos`
```sql
tipo CHECK(oc | pago | nota_credito | ajuste)
monto DECIMAL    -- positivo = nueva deuda · negativo = cancela deuda
fecha_vencimiento DATE
medio_pago TEXT
```

### Función `fn_saldo_proveedor_cc(proveedor_id)` SECURITY DEFINER
- Retorna `SUM(monto)` de todos los movimientos del proveedor
- Saldo positivo = deuda pendiente con el proveedor

### Modal CC en ProveedoresPage

Botón CreditCard por proveedor → modal con:
1. **Saldo adeudado total** (via `fn_saldo_proveedor_cc`)
2. **Panel "Registrar pago"**: monto + medio de pago → egreso automático a caja si Efectivo
3. **Historial cronológico** de movimientos con fecha vencimiento y medio de pago

### OC y CC Proveedores

- OC confirmada: genera `proveedor_cc_movimientos` tipo `oc` (positivo = nueva deuda)
- Pago de OC desde GastosPage: genera tipo `pago` (negativo = cancela deuda)
- Bloqueo en ProveedoresPage: botón "Confirmar OC" deshabilitado si `estado_pago='pendiente_pago'`

---

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/envios]]
- [[wiki/features/gastos]]
- [[wiki/features/alertas]]
- [[wiki/database/schema-overview]]

---

## Mejoras v1.8.23–v1.8.26

### ISS-107 — Cancelar deuda CC por venta (v1.8.23)
- **Acceso:** DUEÑO y SUPERVISOR únicamente
- En la ficha del cliente → tab Cuenta Corriente → por cada venta con saldo pendiente: botón "Cancelar deuda"
- Registra `monto_pagado = total` sin generar movimiento en caja (es una condonación)
- El saldo de la cuenta corriente se actualiza inmediatamente
- Útil para casos de gestión de incobrables o acuerdos comerciales

---

## Relevamiento Clientes — CL1–CL6 ✅ COMPLETO en PROD (mig 171-176)

Backlog del relevamiento de Clientes (ver `sources/raw/relevamiento_clientes_respuestas.md`). **Las 6 fases deployadas a PROD**: v1.19.0 (CL1+CL2), v1.20.0 (CL3), v1.23.0 (CL4+CL5+CL6).

### CL1 — Fundación de datos + permisos (mig 171)
- **Baja = soft delete (A6):** botón "Dar de baja" + modal con razón (`clientes.motivo_baja/baja_at/baja_por`). Badge "Baja" en la card, toggle "Ver inactivos", botón reactivar. Conserva historial. (Antes había un hard-delete que era código muerto.)
- **Alerta de duplicado (A2):** al crear, avisa por DNI/teléfono/nombre similar (no traba). El DNI idéntico lo sigue bloqueando el índice único.
- **Import 3 modos (A5):** detecta duplicados contra toda la base (DNI/tel/nombre) + ignorar existentes / ignorar nuevos / procesar todos (UPDATE de existentes). Columna `etiquetas` en la plantilla.
- **Catálogo de etiquetas (F1):** autocomplete (`<datalist>`) = `tenants.cliente_etiquetas_catalogo` ∪ etiquetas usadas.
- **Permisos:** habilitar CC solo DUEÑO/SUPERVISOR (B2). CONTADOR read-only en `/clientes` (H2).

### CL2 — Cuenta corriente: límite/vencimiento/interés/morosidad (mig 172)
- **Enforcement de límite (B1):** `tenants.cc_enforcement_politica` (permitir/avisar/bloquear). Límite por cliente = `clientes.limite_credito`, fallback `tenants.limite_cc_default`. El POS controla al despachar a CC.
- **Vencimiento + interés (B3):** `ventas.fecha_vencimiento_cc` (= hoy + `tenants.cc_dias_vencimiento`). Interés de mora `tenants.cc_interes_mensual_pct` → `ventas.interes_cc`, recalculado por **`recalcular_intereses_cc(tenant)`** (sweep-lazy; pg_cron no habilitado). El tab CC muestra interés + vencimiento real.
- **Morosidad (B4):** `tenants.cc_morosidad_politica` (permitir/bloqueo_cc/bloqueo_total). RPC **`cliente_cc_estado(cliente)`** (deuda_total/deuda_vencida/interes_total).
- **Cobranza (B5):** FIFO desde las 3 vías — ficha del cliente, **POS** (botón "Deuda CC" en el chip del cliente) y **Caja** (tab "Cobranzas CC" masivo). Helper `src/lib/cobranzaCC.ts`. No genera movimiento de caja (comportamiento histórico).

### CL3 — Incobrables + estado de cuenta (mig 173) · v1.20.0
- **Incobrables (B6):** botón "Incobrable" en el tab CC (DUEÑO/ADMIN/SUPER_USUARIO) → modal con motivo + **clave maestra** del dueño (si está configurada). Condona toda la deuda CC del cliente (tag `Incobrable`, excluido de ingresos) + genera **gasto automático "Deudores incobrables"** + audit (`actividad_log`).
- **Estado de cuenta (B8):** **PDF** descargable (`src/lib/estadoCuentaPDF.ts`) desde la ficha + **portal público** `/cuenta/:token` (`CuentaClientePage`, sin login) vía `clientes.cuenta_token` + RPC `get_cuenta_cliente_by_token` (SECURITY DEFINER, anon). Botón "Link cliente" genera/copia el link.

### CL4 — Notificaciones (mig 175) · v1.23.0
- **C1/C4:** email automático al registrar deuda CC y al registrar un pago (las 3 vías) — `src/lib/notificacionesCC.ts`, event-driven vía Edge Function `send-email`.
- **C2:** umbral `cc_notif_pre_venc_dias` (default 3) resalta "próxima a vencer" en el tab CC.
- **C5:** panel "🎂 Cumpleaños de hoy" en Clientes + saludo por WhatsApp.
- Config en Config → Ventas → Operativa → Cuenta corriente (canales email/WhatsApp). **Defaults OFF** (opt-in). WhatsApp manual; sin envío background (no hay pg_cron).

### CL5 — CC proveedores (mig 176) · v1.23.0
- **D6:** cuentas bancarias múltiples por proveedor (tabla `proveedor_cuentas_bancarias`, RLS por tenant) + CRUD en el modal CC.
- **D3:** PDF estado de cuenta del proveedor.
- **D4:** `proveedor_cc_movimientos.nc_numero` + `adjunto_url` (correlativo/comprobante de NC). D2 (bloqueo) y D5 (pago parcial) ya existían.

### CL6 — Reportes + export + audit · v1.23.0 (sin migración)
- **G1:** tab "Reportes" en Clientes — top 10 por volumen, inactivos +60d, aging de deuda CC (0-30/31-60/61-90/+90).
- **G3:** export a Excel de los reportes.
- **F4:** audit log de cambios del cliente (`actividad_log`, entidad `cliente`) + sub-tab "Cambios" en la ficha.
- **G2:** alertas de deuda vencida ya en `DashClientesArea` (dashboard) + el aging report.
- **Config:** ConfigPage → Ventas → Operativa → "Cuenta corriente de clientes".

### Backlog diferido — cerrado en v1.24.0 (sin migración)
- **C6 — Segmentación de clientes (marketing):** en el tab "Reportes" de Clientes, sección "Segmentación de clientes". Filtros: etiqueta · estado CC (habilitada / con deuda / sin deuda) · actividad (compraron alguna vez / nunca / inactivos +60d) · mínimo comprado · con email o teléfono. Export **CSV/Excel** de la lista segmentada (nombre, DNI, teléfono, email, etiquetas, total comprado, compras, última compra, deuda, saldo a favor) para enviar desde una herramienta de mailing/WhatsApp externa. No hay bulk-sender nativo (decisión del relevamiento). Reusa `statsMap`/`ventasCC`/`creditoMap`/`etiquetasCatalogo`.
- **D4 — NC manual de proveedor:** en el modal CC del proveedor, sección "Nota de crédito". Form con monto, nº de NC (correlativo `NC-NNNN` sugerido sobre toda la historia del proveedor, editable), motivo y adjunto opcional (bucket `comprobantes-gastos`). Inserta un movimiento `proveedor_cc_movimientos` con `tipo='nota_credito'` y `monto` negativo (acredita y reduce la deuda), guardando `nc_numero` + `adjunto_url` (columnas de mig 176). El historial muestra un link al comprobante. Completa el ◑ de CL5 (las columnas existían, faltaba la UI).

**Diferidos restantes:** B7 (tope de deuda global, revisar en 3-6 meses) · F2 (fidelización por puntos, requiere relevamiento) · C3 (envío background automático, bloqueado por `pg_cron`).

---

## Mejoras v1.8.21

### ISS-102 — Clientes y proveedores globales entre sucursales
- Clientes y proveedores son compartidos por todas las sucursales del tenant
- El selector de sucursal se ocultó en `/clientes` y `/proveedores` (en `AppLayout.tsx`)
- La query de clientes ya no aplica `applyFilter()` (no filtra por `sucursal_id`)
- Al crear un nuevo cliente ya no se asigna `sucursal_id`
- **Motivación**: la base de clientes y proveedores es del negocio completo, no de cada sucursal
