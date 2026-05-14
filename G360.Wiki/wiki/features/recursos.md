---
title: Recursos
category: features
tags: [recursos, patrimonio, ubicaciones, recurrentes, gastos]
sources: [CLAUDE.md]
updated: 2026-05-13
---

# Recursos

Módulo de patrimonio e inventario del negocio (activos no destinados a la venta).

**Página:** `src/pages/RecursosPage.tsx` (`/recursos`)  
**Acceso:** DUEÑO only (`ownerOnly: true`)  
**Migration inicial:** 089

---

## Concepto

"Recursos" = todo lo que el negocio posee para operar (notebooks, mobiliario, vehículos, herramientas, café, papel, etc.) pero que no se vende a clientes.

A diferencia del inventario de productos, los recursos son activos propios con:
- Valor patrimonial
- Estado de vida (activo, en reparación, dado de baja, pendiente de adquisición)
- Garantía, número de serie, proveedor, ubicación física

---

## Schema (migration 089 + 102)

```sql
recursos(
  id, tenant_id, nombre, descripcion, categoria, estado,
  valor, fecha_adquisicion, proveedor_id, ubicacion,
  numero_serie, garantia_hasta, notas, sucursal_id,
  -- Migration 102: recurrencia
  es_recurrente BOOLEAN DEFAULT false,
  frecuencia_valor INT,          -- 1, 2, 6...
  frecuencia_unidad TEXT,        -- 'dia' | 'semana' | 'mes' | 'año'
  proximo_vencimiento DATE,
  created_by, created_at, updated_at
)
```

---

## Estados

| Estado | Descripción |
|---|---|
| `activo` | En uso |
| `en_reparacion` | Temporalmente fuera de servicio |
| `dado_de_baja` | Descartado |
| `pendiente_adquisicion` | En lista de compra, aún no adquirido |

---

## Tabs de RecursosPage

### 1. Recursos activos

Lista todos los recursos que no están en `pendiente_adquisicion`. Muestra estado, categoría, valor, ubicación, proveedor, garantía.

Badges adicionales:
- 🔄 Violeta: recurso recurrente con su frecuencia
- 🔄 Ámbar: próxima compra ≤ 7 días
- 🔄 Rojo: próxima compra vencida
- ⚠ Rojo: garantía vencida
- ⚠ Ámbar: garantía por vencer (≤ 30 días)

### 2. Recursos pendientes

Recursos con estado `pendiente_adquisicion`. Incluye botón "Marcar como adquirido" y CTA para solicitar presupuesto al proveedor.

### 3. Ubicaciones (2026-05-13)

Vista de todos los recursos activos/pendientes **agrupados por su campo `ubicacion`**:
- Grupos ordenados A-Z, "Sin ubicación" al final
- Cada recurso muestra nombre, categoría, estado, badge recurrente
- Edición inline de la ubicación (lápiz → input → Enter/Escape)
- Banner ámbar si hay recurrentes vencidos/próximos en la sucursal

---

## Recursos recurrentes (migration 102 · 2026-05-13)

Para recursos que se compran/renuevan periódicamente (jabón, café, papel, tóner, etc.):

**Configuración en modal:** checkbox "Recurso recurrente" → despliega:
- Frecuencia: número + unidad (día/semana/mes/año)
- Fecha próxima compra (auto-calculada si se deja vacía = hoy + frecuencia)

**Cálculo automático de fecha:**
```
proximo_vencimiento = hoy + frecuencia_valor × unidad
```

**Preview en el modal** muestra la fecha calculada antes de guardar.

**Flujo de renovación:**
1. GastosPage → tab Recursos muestra sección "Renovaciones pendientes"
2. Aparecen recursos con `es_recurrente=true` y `proximo_vencimiento ≤ hoy+7d`
3. Botón "Registrar compra" → crea gasto pendiente + avanza `proximo_vencimiento` al siguiente ciclo

---

## Integración con Gastos

### Al crear un recurso (no pendiente, con valor)
- Se crea automáticamente un gasto en `gastos` con `recurso_id`, `categoria='Recurso'`, `fecha=fecha_adquisicion`
- Toast: "Gasto pendiente creado en Gastos → Recursos"

### Tab Recursos en GastosPage
- Lista gastos con `recurso_id IS NOT NULL`
- Botón "Marcar como recibido" → pone el recurso en `activo`
- **Sección Renovaciones pendientes** (2026-05-13): recursos recurrentes próximos/vencidos con botón "Registrar compra"

---

## Categorías

`Tecnología` · `Mobiliario` · `Vehículo` · `Herramienta` · `Electrodoméstico` · `Seguridad` · `Otro`

---

## Stats en header

| Stat | Valor |
|---|---|
| Activos | Recursos en estado `activo` |
| Valor patrimonial | Suma de `valor` de activos + en reparación |
| En reparación | Count |
| Por adquirir | Count + presupuesto estimado |

---

## Links relacionados

- [[wiki/features/gastos]]
- [[wiki/features/multi-sucursal]]
- [[wiki/features/alertas]]
