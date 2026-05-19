---
title: Módulo Gastos
category: features
tags: [gastos, egresos, iva, comprobantes, gastos-fijos, caja, ordenes-compra]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-05-19
---

# Módulo Gastos

**Página:** `src/pages/GastosPage.tsx` (`/gastos`)  
**Acceso:** DUEÑO · SUPERVISOR · ADMIN · CONTADOR

> [!NOTE] La categoría "Sueldos y cargas sociales" fue eliminada de Gastos (v0.72.0). Los sueldos se registran desde RRHH → Nómina.

---

## Tabs

1. **Gastos variables** — registro de gastos individuales
2. **Gastos fijos** — templates recurrentes con botón "Generar hoy"
3. **Historial** — todos los gastos con filtros avanzados
4. **Órdenes de Compra** — seguimiento de pagos a proveedores
5. **Recursos** — gastos vinculados a activos del negocio

---

## Gasto variable

### Campos

```
descripcion, monto, categoria, medio_pago (múltiples, JSON array {tipo, monto}),
fecha, comprobante_url (PDF/imagen), comprobante_titulo
tipo_iva, iva_deducible BOOLEAN, iva_monto  ← desglose IVA
deduce_ganancias BOOLEAN, gasto_negocio BOOLEAN ← para contaduría
conciliado_iva BOOLEAN  ← para libro IVA
```

### Badge "Borrador" (ISS-138 · v1.8.36)

Los gastos sin `medio_pago` muestran un badge amber **"Borrador"** en la tabla y en el historial. Indica que el egreso fue registrado pero aún no se sabe cómo fue pagado.

### Bloqueo de edición cuando ya fue a caja (v1.8.37)

Si un gasto ya tiene `medio_pago` asignado (fue registrado en caja):
- El campo **monto** y los **medios de pago** quedan **deshabilitados** en el modal de edición
- Se muestra aviso 🔒: "Monto y método de pago bloqueados — ya fue registrado en caja"
- Todavía se puede editar: descripción, categoría, fecha, notas, comprobante

### IVA deducible

- Campo `iva_monto` junto al monto total
- Columna IVA en tabla + total en footer
- Card de stats "IVA deducible" del período
- Impacta en "Posición IVA" del Dashboard (KPI)

### Comprobantes adjuntos

- Upload de archivo (PDF o imagen) al crear o editar el gasto
- Bucket privado `comprobantes-gastos` (10 MB, img + PDF)
- Ícono 📎 en lista → abre URL firmada (300s)
- Al eliminar el gasto: también elimina el archivo en Storage

---

## Integración con Caja (ISS-084 + ISS-136 · v1.8.22/v1.8.37)

### Flujo completo al crear o editar un gasto

1. **Al crear un gasto nuevo con medio de pago**: se registra automáticamente en la sesión de caja activa
2. **Al editar un gasto borrador para agregarle el pago**: también registra en caja (antes solo lo hacía en el INSERT, no en el UPDATE — fix v1.8.37)
3. **Gastos Fijos → Generar**: mismo comportamiento

### Reglas por tipo de pago

| Medio de pago | Movimiento en caja | Efecto en saldo |
|---|---|---|
| Efectivo | `egreso` | Descuenta del saldo real |
| Cualquier otro | `egreso_informativo` | Aparece como "No efectivo", **no descuenta** |

### Selector de caja

- Aparece cuando hay algún medio de pago con monto > 0 (no solo con efectivo)
- Con 1 caja: badge verde automático con ★
- Con múltiples cajas: dropdown que **pre-selecciona la sesión propia del usuario** (★ mía)
- Prioridad: selección explícita > sesión propia > única disponible

### Reversión al eliminar (v1.8.37)

Si el gasto tenía `medio_pago` (estaba en caja):
- El `confirm` advierte que se creará un movimiento de corrección
- Al confirmar: se crean movimientos inversos en la sesión activa
  - Efectivo → `ingreso` "[Corrección] Gasto eliminado: {descripcion}"
  - Otros → `ingreso_informativo` "[Tipo][Corrección] Gasto eliminado: ..."
- Toast diferenciado: "Gasto eliminado · Corrección registrada en caja"

---

## Métodos de pago dinámicos (ISS-133 · v1.8.36)

Los medios de pago disponibles en el formulario de gasto se cargan desde la tabla `metodos_pago` de Config (no están hardcodeados). Si el tenant agrega "Tarjeta crédito" en Config → aparece en Gastos automáticamente.

---

## Múltiples medios de pago

Mismo sistema que Ventas: JSON array de `{tipo, monto}`. Permite registrar un gasto pagado en parte con efectivo y en parte con transferencia.

---

## Gastos fijos (migration 048)

Templates recurrentes:

```sql
gastos_fijos(
  descripcion, monto, iva_monto, categoria,
  medio_pago, frecuencia CHECK(mensual|quincenal|semanal),
  dia_vencimiento INT, activo BOOLEAN
)
```

### Generar gasto desde fijo (v1.8.37)

El modal "Registrar gasto" ahora incluye:
- **Selector de caja**: igual que gastos variables (badge ★ si hay default claro, dropdown si múltiples)
- Al registrar: crea `egreso` (efectivo) o `egreso_informativo` (no-efectivo) en la caja seleccionada

---

## Historial separado (v1.3.0 · migration 072)

- Tab "Historial" con filtros: fecha / categoría / monto / operador
- Badge "Borrador" también visible aquí

---

## Tab "Órdenes de Compra" — v1.6.0+

### Campos en `ordenes_compra`

```sql
estado_pago CHECK(pendiente_pago|pago_parcial|pagada|cuenta_corriente)
monto_total DECIMAL
monto_pagado DECIMAL
monto_descuento DECIMAL DEFAULT 0  ← migration 126 (ISS-132)
fecha_vencimiento_pago DATE
dias_plazo_pago INT
condiciones_pago TEXT
comprobante_url TEXT   ← migration 108
comprobante_titulo TEXT
```

### Modal "Confirmar pago" (v1.8.36)

**Descuento del proveedor (ISS-132)**:
- Campo `Descuento ($)` que reduce el saldo sin requerir un medio de pago
- Se acumula en `ordenes_compra.monto_descuento`
- Se muestra en el resumen del modal como "Descuento nuevo / Descuento previo"

**Métodos de pago (ISS-133)**:
- Los medios disponibles vienen de `metodos_pago` de Config (no hardcodeados)
- "Cuenta Corriente" siempre disponible en OC

**Integración con Caja (ISS-136 · v1.8.36)**:
- **Selector de caja** en el modal (badge ★ o dropdown)
- Efectivo → `egreso` en caja
- Transferencia/Tarjeta/etc. → `egreso_informativo` en caja
- Todos los medios quedan registrados en el historial de caja

**ISS-095 — CC como método parcial**:
- Pago mixto: ej. 30% Transferencia + 70% Cuenta Corriente
- Días de plazo CC aparecen solo cuando hay CC en los medios

### Listado

- Filtrable por `estado_pago` y proveedor
- Badge contextual:
  - 🔴 Vencida (mora)
  - ⏰ Próxima (≤ 3 días)

---

## Integración con Facturación AFIP

- `gastos.conciliado_iva BOOLEAN` → para el Libro IVA Compras en FacturacionPage
- Los gastos aparecen en el módulo de facturación como crédito fiscal

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/alertas]]
- [[wiki/features/recursos]]
