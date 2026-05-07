---
title: Reglas de Negocio Relevadas
category: development
tags: [reglas-negocio, caja, ventas, inventario, clientes, uat]
sources: [reglas_negocio.md, uat.md]
updated: 2026-04-30
---

# Reglas de Negocio Relevadas

> Documento vivo. Relevado con Gastón Otranto (GO). Fuente: `docs/reglas_negocio.md`.

---

## Módulo: Caja

### Estructura
- Múltiples cajas por sucursal
- Límites por plan: Free=1, Básico=2, Pro=3, Premium=5, Enterprise=10 cajas por sucursal
- **Bóveda**: concepto de bóveda como destino/origen de efectivo — pendiente implementar

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

- Módulo 4: Gastos (detalle completo)
- Módulo 5: RRHH (detalle completo)
- Devoluciones: ¿se puede re-abrir una venta despachada?
- Ventas: ¿hay límite de ítems por venta?
- Clientes: ¿límite de deuda por cliente configurable?
- Clientes: ¿notificación al cliente cuando se registra su deuda?

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/development/testing]]
