---
title: Módulo Gastos
category: features
tags: [gastos, egresos, iva, comprobantes, gastos-fijos]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
---

# Módulo Gastos

**Página:** `src/pages/GastosPage.tsx` (`/gastos`)  
**Acceso:** OWNER · SUPERVISOR · ADMIN · CONTADOR

> [!NOTE] La categoría "Sueldos y cargas sociales" fue eliminada de Gastos (v0.72.0). Los sueldos se registran desde RRHH → Nómina.

---

## Tabs

1. **Gastos variables** — registro de gastos individuales
2. **Gastos fijos** — templates recurrentes con botón "Generar hoy"

---

## Gasto variable

### Campos

```
descripcion, monto, categoria, medio_pago (múltiples, mismo sistema que Ventas),
fecha, comprobante_url (PDF/imagen)
tipo_iva, iva_deducible BOOLEAN, iva_monto  ← desglose IVA (v1.3.0)
deduce_ganancias BOOLEAN, gasto_negocio BOOLEAN ← para contaduría
conciliado_iva BOOLEAN  ← para libro IVA
```

### IVA deducible

- Campo `iva_monto` junto al monto total
- Columna IVA en tabla + total en footer
- Card de stats "IVA deducible" del período
- Impacta en "Posición IVA" del Dashboard (KPI)

### Comprobantes adjuntos

- Upload de archivo (PDF o imagen) al crear el gasto
- Bucket privado `comprobantes-gastos` (10 MB, img + PDF)
- Ícono 📎 en lista → abre URL firmada (300s)
- Al eliminar el gasto: también elimina el archivo en Storage

### Integración con Caja

- Medio de pago **Efectivo** → INSERT `egreso` automático en `caja_movimientos`
- Otro medio → INSERT `egreso_informativo` (registro solo, no afecta saldo)
- Bloquea nuevo gasto en efectivo si **no hay sesión de caja abierta**

### Historial separado (v1.3.0 · migration 072)

- Tab "Historial" con filtros: fecha / categoría / monto / operador

---

## Gastos fijos (migration 048)

Templates que se aplican periódicamente:

```sql
gastos_fijos(
  descripcion, monto, iva_monto, categoria,
  medio_pago, frecuencia CHECK(mensual|quincenal|semanal),
  dia_vencimiento INT,
  activo BOOLEAN
)
```

### Funcionalidades

- CRUD completo
- Toggle activo/inactivo
- Total mensual estimado en footer
- **Botón "Generar hoy"** → crea gastos variables para el día actual desde todos los fijos activos
- Alerta días antes del vencimiento (v1.3.0)

---

## Integración con Facturación AFIP

- `gastos.conciliado_iva BOOLEAN` → para el Libro IVA Compras en FacturacionPage
- Los gastos aparecen en el módulo de facturación como crédito fiscal

---

## Múltiples medios de pago (v1.3.0)

Mismo sistema que Ventas: JSON array de `{tipo, monto}`. Permite registrar un gasto pagado en parte con efectivo y en parte con transferencia.

---

## Presupuestos de servicios (migration 073/080)

En ProveedoresPage — tab Servicios:
- Presupuestos con estados: `pendiente | aprobado | rechazado | convertido`
- **"Aprobar → Crear gasto"**: crea automáticamente en módulo Gastos + vincula `presupuesto.gasto_id`
- Adjuntar PDF/imagen
- Edit/delete de presupuestos en estado `pendiente`

---

## Tab "Órdenes de Compra" — v1.6.0

Nueva tab en GastosPage que centraliza el seguimiento de pagos pendientes a proveedores.

### Campos nuevos en `ordenes_compra` (migration 085)

```sql
estado_pago CHECK(pendiente_pago | pago_parcial | pagada | cuenta_corriente)
monto_total DECIMAL
monto_pagado DECIMAL
fecha_vencimiento_pago DATE
dias_plazo_pago INT
condiciones_pago TEXT
```
OC nuevas arrancan con `estado_pago = 'pendiente_pago'` por defecto.

### Listado

- Filtrable por `estado_pago` y proveedor
- Badge contextual:
  - 🔴 Vencida (mora — `fecha_vencimiento_pago < hoy`)
  - ⏰ Próxima (≤ 3 días)
  - Normal (estado sin urgencia)

### Modal "Pagar / CC"

**Modo Registrar pago:**
- Monto + medio de pago
- Si es Efectivo y hay caja abierta → egreso automático en `caja_movimientos`
- INSERT en `proveedor_cc_movimientos` tipo `pago` (monto negativo = cancela deuda)

**Modo Cuenta Corriente:**
- Selector plazo: 30 / 60 / 90 días o personalizado
- Fecha vencimiento calculada automáticamente
- Campo condiciones libre
- INSERT en `proveedor_cc_movimientos` tipo `oc` (monto positivo = nueva deuda)

> [!NOTE] El botón **"Confirmar"** en ProveedoresPage queda deshabilitado cuando `estado_pago = 'pendiente_pago'`. El flujo correcto es ir a Gastos → Órdenes de Compra para gestionar el pago primero.

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/alertas]]
