---
title: Recursos
category: features
tags: [recursos, patrimonio, ubicaciones, recurrentes, gastos, capitalizacion]
sources: [CLAUDE.md]
updated: 2026-05-25
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
| Valor patrimonial | Suma de `valor` de activos + en reparación + capitalizaciones (v1.8.45) |
| Mantenimiento acumulado | Suma de `gastos.monto` vinculados a recursos con `capitaliza_recurso=false` (v1.8.45) |
| Por adquirir | Count + presupuesto estimado |

---

## Capitalización en recursos (v1.8.45 · migration 134)

Cada `RecursoCard` agrega:
- Valor base + `+ $X cap.` cuando hay gastos capitalizables vinculados
- Chip "🔧 Mantto $Y" + "📈 Cap. $Z" con cantidad de gastos asociados
- Click → navega a `/gastos?tab=recursos` para ver el detalle

Detalle: ver [[wiki/features/gastos]] sección "Capitalización en recursos".

---

## Fixes v1.8.32 (ISS-111/112/114)

### ISS-111 — Columnas de recurrencia faltaban en DEV
- Migration 102 (`es_recurrente`, `frecuencia_valor`, `frecuencia_unidad`, `proximo_vencimiento`) no estaba aplicada en DEV
- Fix: migration aplicada + schema cache de PostgREST recargado

### ISS-112 — Checkbox "Registrar como gasto"
- Al agregar un recurso activo con valor de compra, aparece checkbox **"Registrar como gasto"** (activado por default)
- Desactivarlo permite cargar el recurso como patrimonio sin generar egreso en Gastos → Recursos
- Caso de uso: recursos viejos, donados, prestados, etc.

### ISS-114 — Botón Agregar en tab Ubicaciones
- Antes: abría el modal de crear recurso
- Ahora: abre modal **"Asignar ubicación"** con selector de recurso (sin ubicación priorizado) + campo de ubicación

---

## Links relacionados

- [[wiki/features/gastos]]
- [[wiki/features/multi-sucursal]]
- [[wiki/features/alertas]]
- [[wiki/development/cierre-contable]]
