---
title: Reglas de Negocio Relevadas
category: development
tags: [reglas-negocio, caja, ventas, inventario, clientes, gastos, uat]
sources: [reglas_negocio.md, uat.md]
updated: 2026-05-24
---

# Reglas de Negocio Relevadas

> Documento vivo. Relevado con Gastón Otranto (GO). Fuente: `docs/reglas_negocio.md`.

---

## Módulo: Caja

> Relevamiento 2026-05-25 con socio (PDF `relevamiento-caja-reglas-negocio.pdf` · respuestas A-I en `sources/relevamientos/caja_2026-05-25.md`). Tanda 1 implementada en v1.9.1 — pendientes J-N + features ya respondidas pero no implementadas (detalle en `project_pendientes.md`).

### Estructura
- Múltiples cajas por sucursal
- Límites por plan: Free=1, Básico=2, Pro=3, Premium=5, Enterprise=10 cajas por sucursal
- **Una caja = una moneda fija** (implementado v1.9.1 — `cajas.moneda`). Para manejar varias monedas, crear cajas separadas.
- **Bóveda**: discriminada por **Cuentas de Origen** (implementado v1.9.1) — cada cuenta bancaria/billetera/efectivo tiene su saldo independiente

### Apertura
- El saldo sugerido al abrir = **monto de cierre de esa misma caja específica** (no el cierre más reciente de cualquier caja)

### Cierre
- CAJERO solo puede cerrar su propia caja
- OWNER/SUPERVISOR pueden cerrar cualquier caja
- **Contraseña maestra** requerida para cerrar caja ajena: campo `clave_maestra` en `tenants` — pendiente implementar
- Al cerrar: diferencia (saldo sistema ≠ conteo real) solo se **registra** — no hay bloqueo
- **Alerta automática** a OWNER y SUPERVISOR si hay diferencia — pendiente implementar

### Ticket de cierre
- PDF imprimible al cerrar con: apertura/cierre, cajero, saldo inicial, ingresos, egresos, diferencia
- **Reimprimible** desde historial de sesiones — pendiente implementar

### Bóveda (pendiente implementar)
- Saldo visible + historial de movimientos
- Transferencia Caja → Bóveda: egreso en caja + ingreso en bóveda (dos movimientos vinculados)
- Transferencia Bóveda → Caja: egreso en bóveda + ingreso en caja
- Acceso: OWNER por defecto, SUPERVISOR con permiso habilitado

### Integración con otros módulos
- Solo **Efectivo** genera movimiento real en caja (afecta saldo)
- Tarjeta / Transferencia / MP → `ingreso_informativo` (solo registro)
- Sin caja abierta = no se puede despachar venta en efectivo ni registrar gasto en efectivo

---

## Módulo: Ventas

### Estados y requisitos

| Estado | Cliente | Pago |
|--------|---------|------|
| `pendiente` | ✅ obligatorio | No requerido |
| `reservada` | ✅ obligatorio | Parcial o total |
| `despachada` | ❌ opcional | Total (100%) |

### Reglas específicas
- Una venta = **un cliente únicamente**
- Venta pendiente: editable (ítems, cantidades, precios)
- Venta reservada: editable. Pago puede ser parcial al reservar; al despachar debe cubrirse el resto
- Venta despachada: **no editable**
- Las ventas pendientes **no vencen automáticamente** → aparecen en Alertas
- Registro inline de cliente: nombre + DNI + teléfono obligatorios; email opcional
- DNI = campo único de identificación (evita duplicados)

### Pago parcial en reservas
- El pago entra a la caja inmediatamente con motivo "Pago de reserva de venta #X"
- El dinero no queda retenido; puede usarse para otras operaciones
- Al despachar: solo se pide el **saldo pendiente** (total − ya pagado)

---

## Módulo: Clientes

### Cuenta corriente
- Cliente puede llevarse mercadería con pago parcial o sin pagar → deuda registrada
- La deuda **no tiene vencimiento ni interés** (por ahora)
- El saldo se salda desde la **ficha del cliente** (no desde una nueva venta)

### Dashboard CC pendiente
- Total de deuda pendiente (plata a cobrar)
- % de ventas pagadas vs. en deuda

---

## Módulo: Inventario (relevado 2026-04-19)

### Roles y permisos

| Acción | OWNER | SUPERVISOR | DEPOSITO | CAJERO |
|--------|-------|-----------|---------|--------|
| Ver inventario | ✅ | ✅ | ✅ | ❌ |
| Ingresar stock | ✅ | ✅ | ✅ | ❌ |
| Rebajar stock | ✅ | ✅ | ✅ | ❌ |
| Acciones LPN | ✅ | ✅ | ⚠️ pendiente aprobación | ❌ |
| Eliminar LPN | ✅ | ✅ | ❌ requiere autorización | ❌ |
| Aprobar autorizaciones | ✅ | ✅ | ❌ | ❌ |
| Conteo | ✅ | ✅ | ✅ | ❌ |
| Finalizar ajuste conteo | ✅ | ✅ | ❌ requiere aprobación | ❌ |

### Ingresos
- Precio de costo no obligatorio → alerta si queda en $0
- Producto inactivo: bloqueado para ingreso
- Ubicación DEV: se puede ingresar manualmente pero excluida de venta
- LPN: auto-generado si no se ingresa. Invariante: toda línea debe tener LPN

### LPNs
- **Mover LPN**: todo el LPN o cantidad parcial; a otra sucursal; DEPOSITO → pendiente aprobación
- **LPN multi-SKU (LPN Madre)**: campo `parent_lpn_id` — implementado desde migration 057
- **Combinar**: deben compartir mismo producto (lote y vencimiento no requerido)
- **Dividir**: cubierto por el flujo de "mover parcial"

### Conteo
- Sin límite de frecuencia
- Historial muestra quién hizo el último conteo y cuándo
- Movimientos de ajuste aparecen en historial con etiqueta "Conteo"
- DEPOSITO: los ajustes quedan pendientes de aprobación

### Vencimientos
- `fecha_vencimiento < hoy` → LPN **bloqueado para venta** + alerta automática ✅ implementado

### Lotes y restricciones por ubicación
- Múltiples lotes del mismo producto en la misma ubicación (en distintos LPNs) permitido
- `ubicaciones.mono_sku BOOLEAN` ✅ implementado (migration 052)

### Series
- Una serie puede transferirse entre LPNs sin pasar por venta/devolución
- Al cancelar reserva: series con `reservado=true` se liberan automáticamente ✅

### Stock mínimo
- Configurable por sucursal: `producto_stock_minimo_sucursal` ✅ implementado (migration 052)
- Al superar el mínimo: alerta se auto-resuelve ✅

### Recepciones / ASN
- Una recepción puede vincular ítems de más de una OC
- Over-receipt configurable: `tenants.permite_over_receipt` ✅ implementado (migration 051)

### Kitting
- Al iniciar armado → componentes pasan a "En Armado" (comprometidos sin consumir) ✅ implementado
- KITs pueden tener como componente otros KITs (anidados) — pendiente validar

---

## Módulo: Gastos (relevado 2026-05-24)

### Roles y permisos

| Acción | DUEÑO | ADMIN | SUPERVISOR | CONTADOR | CAJERO |
|--------|-------|-------|-----------|----------|--------|
| Ver gastos | ✅ | ✅ | ✅ | ✅ (incluye comprobante) | ✅ (solo su caja) |
| Crear gasto | ✅ | ✅ | ✅ (hasta umbral) | ❌ | ✅ (hasta umbral, en su caja abierta) |
| Editar gasto completo | ✅ | ✅ | ✅ (hasta umbral) | ❌ | ⚠ con autorización SUPERVISOR+ |
| Editar solo IVA del gasto | ✅ | ✅ | ✅ | ✅ | ❌ |
| Eliminar gasto | ✅ | ✅ | ✅ (hasta umbral) | ❌ | ⚠ con autorización SUPERVISOR+ |

- **Umbrales por sucursal** (configurables):
  - `sucursales.umbral_gasto_supervisor`: máximo sin autorización del DUEÑO
  - `sucursales.umbral_gasto_cajero`: máximo sin autorización del SUPERVISOR
- Aplica tanto al **crear** como al **editar** (si el nuevo monto cruza el umbral)
- RRHH queda **explícitamente fuera** del módulo Gastos
- CONTADOR ve el gasto completo (read-only resto) pero edita solo: `iva_deducible`, `conciliado_iva`, `iva_monto`, `tipo_iva`

### Ciclo de vida y cierre contable

- CAJERO puede crear/editar gastos **solo mientras su caja esté abierta** y **solo en su caja**
- Una vez asignado `medio_pago` y registrado en caja: monto y método quedan bloqueados (ya implementado v1.8.37)
- **Cierre contable mensual** (hito v1.9.0 — feature nueva transversal):
  - Lo dispara DUEÑO / SUPERVISOR / CONTADOR según permisos del rol
  - Aplica a **Gastos + Ventas + Caja + Órdenes de Compra**
  - Bloquea UPDATE/DELETE de registros con `fecha ≤ último cierre`
  - Solo se permite **"Nota de corrección"**: nuevo gasto vinculado al original (`gasto_padre_id` + `es_correccion=true`) con monto invertido
  - Reportes ofrecen vista con/sin correcciones aplicadas

### Multi-sucursal por categoría

- `categorias_gasto.requiere_sucursal BOOLEAN` define si el gasto obliga `sucursal_id`
- Categorías operativas (Alquiler, Servicios, Mercadería): requieren sucursal
- Categorías globales (Impuestos nacionales, SaaS, plataformas): opcional → reporte muestra "Tenant / Global"
- Si el tenant tiene **1 sola sucursal**: autocompletar siempre

### Borradores (gastos sin medio_pago)

- Sin límite de tiempo, badge ámbar "Borrador" (ya implementado v1.8.36)
- Alerta automática tras `dias_alerta_borrador` (configurable en Config → Gastos)
- Notificación al **creador + DUEÑO + SUPERVISOR**

### Comprobante adjunto (4 reglas combinables OR)

Configurables en Config → Gastos. Si **cualquier** regla activa aplica → comprobante obligatorio:

1. Si `iva_deducible` o `conciliado_iva` están marcados
2. Si monto > X (X configurable)
3. Si `deduce_ganancias` o `gasto_negocio` están marcados
4. Siempre obligatorio (sin condiciones)

**Default**: regla 4 activa (siempre obligatorio).

### Gastos en cuotas

- **Un gasto madre + N filas en `gasto_cuotas`** (estructura migration 097)
- El gasto madre **no toca caja** al crearse
- Cada cuota dispara movimiento al pagarse:
  - Efectivo → `egreso` con motivo "Cuota X/N de gasto #Y"
  - Otros → `egreso_informativo`
- Reportes mensuales muestran solo las cuotas devengadas del mes, no el total

### Gastos fijos (recurrentes)

- Generación **manual** con botón "Generar hoy" (no auto-cron)
- Indicadores visuales por estado:
  - 🟢 **Dentro de fecha** (día del mes ≥ hoy, sin generar)
  - 🟡 **Pendiente este mes** (ya pasó el `dia_vencimiento`, sin generar)
  - 🔴 **Atrasado** (más de N días sin generar — N configurable)
  - ✅ **Generado** (ya creado el del mes)
- Notificación in-app + email diario al DUEÑO mientras no se genere

### IVA

- Auto-calculado según tipo de comprobante:
  - **A**: 21% desglosado (default)
  - **B**: 21% incluido (default)
  - **C**: 0% (monotributo, sin IVA)
  - **Otros** (M, E, ticket fiscal): manual
- Selector de alícuota visible siempre (21 / 10.5 / 27 / 0 / custom)
- Override manual disponible para casos especiales (comprobante con monto fijo)

### Categorías de gasto

- Catálogo base predefinido (~15-20 categorías seed: Alquiler, Servicios, Mercadería, Marketing, Impuestos, Combustible, Mantenimiento, etc.)
- Tabla `categorias_gasto(tenant_id, nombre, requiere_sucursal, activo, predefinida)`
- Predefinidas: solo se pueden **desactivar** (no eliminar)
- Custom: el tenant agrega/edita/elimina libremente

### Sueldos / Nómina

**Decisión: NO migrar a Gastos.** Se gestionan en Módulo RRHH → Nómina (ya existente desde v0.32.0).

Razones:
- Sueldo tiene haberes + descuentos variables cada mes (no es gasto fijo plano)
- Cargas sociales patronales ≠ neto pagado al empleado
- `pagar_nomina_empleado()` ya inserta el egreso en `caja_movimientos`

**Integración con Gastos**:
- Vista `vw_egresos_consolidados` une `gastos` + `rrhh_salarios.pagado=true`
- Dashboard Gastos: card "Costo laboral del mes" leyendo de `rrhh_salarios`
- P&L con línea separada "Sueldos pagados (RRHH)" con link a `/rrhh?tab=nomina`

### Recursos asociados a gastos

- Default: `gastos.recurso_id` suma al **costo de mantenimiento acumulado** del recurso (ficha del recurso muestra "Gastado en mantenimiento: $X")
- Checkbox **"Sumar al valor del recurso"** (opt-in, default OFF) → `gastos.capitaliza_recurso BOOLEAN`. Capitaliza mejoras estructurales (GPS, alarma, accesorios fijos)
- **Depreciación automática**: diferida a fase fiscal posterior (requiere relevamiento con contador)

### Órdenes de Compra (OC)

**Pago antes de recepción (anticipo a proveedor)**:
- **Permitido** — mismo flujo que `pago_parcial` actual
- Mitigación de bajo costo (sin nuevo estado):
  - Badge naranja **💰 Anticipo** en listado OC cuando `monto_pagado > 0 AND recepcion_estado='pendiente'`
  - Alerta automática si pasan N días sin recibir (N configurable, default 15)

**Cuenta corriente con proveedores**:
- **Límite por proveedor** (`proveedores.limite_cc DECIMAL`): al alcanzarlo, bloquea OC nueva con CC
- **Vencimiento por OC** (`ordenes_compra.dias_plazo_pago` ya existe): genera fecha de vencimiento
- **Bloqueo solo CC** al vencer: el proveedor no puede recibir OC nuevas con método CC. OC con efectivo/transferencia siguen disponibles
- OC en curso (ya creadas pero impagas) **continúan**: se entrega mercadería pendiente
- **Override DUEÑO**: puede autorizar saltar el bloqueo una vez por excepción, registrado en tabla `autorizaciones_cc`

### Plan de implementación (5 fases)

| Release | Migrations | Contenido |
|---------|-----------|-----------|
| **v1.8.42** | 130, 131 | Quick wins: categorías + seed, config comprobante (4 reglas), indicadores fijos, OC anticipo |
| **v1.8.43** | 132 | Permisos: umbrales por sucursal, autorizaciones, RLS por rol, notificación borrador |
| **v1.8.44** | 133 | IVA auto + selector alícuota, multi-sucursal por categoría, CC proveedor (límite/vencimiento/override) |
| **v1.8.45** | 134 | Recursos↔Gastos (mantenimiento + capitalización), Dashboard consolidado, vista `vw_egresos_consolidados` |
| **v1.9.0** | 135 | **HITO**: Cierre contable mensual (Gastos + Ventas + Caja + OC), notas de corrección |

---

## UAT — Casos de prueba documentados

> Fuente: `docs/uat.md` — Actualizado 2026-04-17

| ID | Módulo | Caso | Estado |
|----|--------|------|--------|
| UAT-INV-01 | Inventario | Eliminar LPN actualiza stock_actual en ProductosPage | ✅ Fix + E2E |
| UAT-INV-02 | Inventario | Rebaje masivo descuenta stock correctamente | ✅ Fix + E2E |
| UAT-INV-03 | Inventario | Rebaje masivo respeta `cantidad_reservada` | ✅ Fix (manual) |
| UAT-GAS-01 | Gastos | Formulario abre sin medio de pago pre-seleccionado | ✅ Fix + E2E |
| UAT-GAS-02 | Gastos | Gasto sin medio de pago guarda con `medio_pago=null` | ✅ Fix + E2E |
| UAT-CFG-01 | Config | No se puede eliminar ubicación con inventario activo | ✅ Fix + E2E |
| UAT-CFG-02 | Config | Eliminar ubicación sin stock desvincula referencias | ✅ Fix (manual) |
| UAT-CFG-03 | Config | Eliminar ubicación libre: confirmación simple | ✅ Fix (manual) |
| UAT-CLI-01 | Clientes | Plantilla descargada incluye columna DNI | ✅ Fix + E2E |
| UAT-CLI-02 | Clientes | Importar archivo con DNI funciona correctamente | ✅ Fix (manual) |
| UAT-CLI-03 | Clientes | Importar sin DNI → `dni=null` (retrocompatibilidad) | ✅ Fix (manual) |

### Usuarios de prueba DEV

| Rol | Email | Contraseña |
|-----|-------|-----------|
| OWNER | `e2e@genesis360.test` | en `.env.test.local` |
| CAJERO | `cajero1@local.com` | `123` |
| RRHH | `rrhh1@local.com` | `123` |
| SUPERVISOR | `supervisor@test.com` | `1234` |

---

## Pendientes de relevar

- Módulo: RRHH (detalle completo)
- Devoluciones: ¿se puede re-abrir una venta despachada?
- Ventas: ¿hay límite de ítems por venta?
- Clientes: ¿límite de deuda por cliente configurable?
- Clientes: ¿notificación al cliente cuando se registra su deuda?
- Compras / OC: derivadas con reembolso, recepciones over-receipt, contactos proveedor
- Envíos: reglas pendientes (más allá de lo implementado)

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/gastos]]
- [[wiki/features/recursos]]
- [[wiki/features/rrhh]]
- [[wiki/development/testing]]
