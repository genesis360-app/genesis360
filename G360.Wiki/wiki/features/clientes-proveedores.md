---
title: Clientes y Proveedores
category: features
tags: [clientes, proveedores, crm, cuenta-corriente, ordenes-compra]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
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

## Relevamiento Clientes — CL1 (v1.18.0) + CL2 (v1.19.0) · mig 171/172

Backlog del relevamiento de Clientes (ver `sources/raw/relevamiento_clientes_respuestas.md`). DEV adelantado, no deployado a PROD.

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

---

## Mejoras v1.8.21

### ISS-102 — Clientes y proveedores globales entre sucursales
- Clientes y proveedores son compartidos por todas las sucursales del tenant
- El selector de sucursal se ocultó en `/clientes` y `/proveedores` (en `AppLayout.tsx`)
- La query de clientes ya no aplica `applyFilter()` (no filtra por `sucursal_id`)
- Al crear un nuevo cliente ya no se asigna `sucursal_id`
- **Motivación**: la base de clientes y proveedores es del negocio completo, no de cada sucursal
