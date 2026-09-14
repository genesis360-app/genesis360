---
title: Recursos
category: features
tags: [recursos, patrimonio, ubicaciones, recurrentes, gastos, capitalizacion]
sources: [CLAUDE.md]
updated: 2026-05-28
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
- Edición inline de la ubicación (lápiz → selector → Check/X)
- Banner ámbar si hay recurrentes vencidos/próximos en la sucursal

### ISS-148 — Selector de ubicación (2026-05-28)

`recursos.ubicacion` sigue siendo `TEXT`, pero la UI ya no permite escritura libre. En lugar de un `<input>` se usa el componente `UbicacionPicker` en los 3 puntos donde se elegía ubicación (form crear/editar recurso, modal "Asignar ubicación" del tab Ubicaciones, edit inline del tab Ubicaciones).

- **Opciones**: derivadas del histórico de `recursos.ubicacion` distinct, filtradas por la sucursal activa (la query principal de `recursos` ya aplica `applyFilter`).
- **Crear ubicación nueva**: opción especial `+ Nueva ubicación...` que muestra un input temporal. La ubicación queda disponible para los próximos recursos en cuanto se guarda el primero que la use.
- **Sin ubicación**: opción `— Sin ubicación —` (envía `null` al backend).

> [!NOTE] No se agregó tabla catálogo: el set de ubicaciones es chico en la práctica y se mantiene auto-gestionado por el histórico. Si más adelante hace falta renombrar/limpiar masivo, se vuelve catálogo.

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

## 🔄 Ciclo de vida con el gasto (v1.207.0 + mig 406, 2026-09-08)

Dos bugs que Fede reportó por separado y tenían una sola causa cada uno.

### El recurso desaparecía apenas se creaba

El insert **nunca seteaba `sucursal_id`**, pero la lista filtra con `.eq('sucursal_id', …)` cuando hay
una sucursal elegida. El recurso nacía en NULL y desaparecía al guardarlo. Y como el tab
**Ubicaciones** agrupa esa misma lista, la ubicación tampoco aparecía nunca — los dos síntomas que
reportó Fede eran el mismo bug. Medido: **5 de los 7 recursos de DEV estaban sin sucursal**, o sea
invisibles.

De paso, la `queryKey` era `['recursos', tenant]` mientras la query filtraba por sucursal → al cambiar
de sucursal servía el cache viejo. La sucursal ahora está en la key.

### El gasto del recurso nacía ya pagado

`gastos.estado_pago` tiene default `'pagado'`, así que el gasto de adquisición figuraba como **plata
ya salida sin que nadie la hubiera pagado**. Ahora nace `'pendiente'` con `monto_pagado = 0`, y con
`capitaliza_recurso` tildado: si el gasto viene del módulo de Recursos, por definición suma al valor
del recurso.

### El ciclo completo

| Situación | Estado del recurso |
|---|---|
| Alta que genera un gasto por validar | `pendiente_adquisicion` |
| Se salda ese gasto en Gastos | pasa a `activo` (**trigger**, mig 406) |
| Alta sin gasto que validar | `activo` directo |

La transición va en **trigger** y no en `GastosPage` a propósito: un gasto se salda por varios caminos
(alta del pago, edición, pago de OC, sweep), y si viviera en una sola pantalla cualquier otro camino
dejaría el recurso colgado en "pendientes" para siempre.

Acotado: solo en la transición a `'pagado'`, solo sobre recursos en `pendiente_adquisicion` (uno dado
de baja **no** se revive), y **sin camino inverso** — despagar no devuelve el recurso a pendiente,
porque revertir un estado que alguien pudo tocar a mano es un efecto silencioso que conviene no
inventar.

## 📍 Las ubicaciones son un catálogo (v1.210.0, migs 407-408) — 2026-09-11

Pedido de Fede: *"esa pestaña no es para asignar ubicación a un recurso, debería ser para crear
ubicaciones y visualizarlas"*.

**Por qué no se podía antes**: `recursos.ubicacion` era **texto libre** y la pestaña agrupaba los
recursos por ese texto. Una ubicación **no existía hasta que había un recurso parado en ella**, así
que no había nada que "crear" — el único botón posible era "asignar".

**Qué hay ahora** (mig 407): tabla `recurso_ubicaciones` (nombre único por tenant, descripción,
`sucursal_id` opcional — NULL = de todo el negocio). La pestaña lista el catálogo con cuántos
recursos hay en cada ubicación, y deja crear, renombrar y borrar.

**Por qué NO se reusó `ubicaciones`**: esa es la del WMS — tiene `tipo_logico`, dimensiones,
cubicaje y zona, y la usan picking, stock y repositores. Un lugar donde está parada una impresora es
otra cosa; mezclarlas contaminaría el árbol del depósito con lugares sin stock.

**Transición**: `recursos.ubicacion` (texto) **no se dropeó** en ese momento. ⚠️ **Y la pantalla nunca
pasó al catálogo**: siguió guardando el texto y jamás `ubicacion_id` — ver la sección siguiente, que
lo cierra (v1.220.0).

⚠️ **La mig 408 salió de probar el ciclo completo contra datos reales**, no de leer el código: al
borrar una ubicación el recurso perdía la FK (`ON DELETE SET NULL`) pero **conservaba el texto
huérfano**, y como la pantalla suma los textos sueltos a la lista de disponibles, la ubicación
**reaparecía agrupando recursos apenas borrada**. Además el diálogo promete "N recursos quedarán sin
ubicación": la pantalla no puede prometer una cosa y la base hacer otra.

## 📍 La ubicación de un recurso ES el catálogo (v1.220.0, migs 417-418) — 2026-09-14

**Lo que estaba mal**: aunque la mig 407 creó el catálogo y `recursos.ubicacion_id`, `RecursosPage`
**seguía escribiendo solo el texto** `recursos.ubicacion`. El catálogo no gobernaba nada, y había una
inconsistencia latente: editar la ubicación de un recurso que ya tenía FK cambiaba el texto pero no el
id, así que renombrar o borrar la ubicación vieja le pisaba el cambio. Se encontró al ir a dropear la
columna "ahora que PROD corre el código nuevo": el código nuevo no la había dejado de usar.

**Qué hace ahora**:
- El selector de ubicación (ficha del recurso y lápiz de cada fila) elige del **catálogo por id**.
  `+ Nueva ubicación...` crea la ubicación en el catálogo al guardar (o reusa la que ya exista con
  ese nombre, sin distinguir mayúsculas).
- La pestaña agrupa, cuenta y busca por el id; los nombres salen del catálogo.
- `DashInventarioArea` dejó de pedir el texto.

**🔐 Quién crea ubicaciones** — decisión de GO: *"solo dueño o admin o alguien que el dueño le asigne
un custom rol que lo permita"*.
- **Mig 417**: la policy de escritura del catálogo pasa a `auth_puede_editar_modulo('recursos')` —
  rol custom con permiso explícito manda (`editar`/`supervisa` sí); si no, solo DUEÑO /
  SUPER_USUARIO / ADMIN. Antes era un allowlist fijo que no contemplaba el rol custom.
- En la UI, `puedeGestionarUbicacionesRecursos` (`src/lib/permisosModulo.ts`) es el espejo exacto:
  sin permiso no aparece `+ Nueva ubicación...` ni los botones de crear/renombrar/borrar — se elige de
  la lista. El servidor lo exige igual.

**Mig 418**: backfill de textos sueltos al catálogo (con guard), DROP de los 3 triggers que
escribían el texto (`fn_recursos_sync_ubicacion_texto`, `fn_recurso_ubicacion_propagar_nombre`,
`fn_recurso_ubicacion_borrar_limpia_texto`) y de la columna. Va **después** del frontend en PROD.

**Tests**: unit de `puedeGestionarUbicacionesRecursos` (roles fijos, custom con cada nivel, prioridad
del permiso explícito) y **e2e 147** (mutante, verificado contra la pantalla vieja): crear un recurso
con ubicación nueva deja `ubicacion_id` apuntando al catálogo; el SUPERVISOR no puede crear ubicaciones
por API (403) y el DUEÑO sí (control positivo).

## 🛑 Se sacó "Marcar como adquirido" (v1.210.0) — 2026-09-11

Fede: *"esto no se debe poder hacer... sino con esta 'trampa' se puede evitar el gasto y se pueden
crear recursos sin haberlos pagado"*. Tenía razón: el botón hacía `estado: 'activo'` directo, sin
mirar el gasto.

La única vía para que un recurso pase de `pendiente_adquisicion` a `activo` es **saldar su gasto de
adquisición**, y lo hace el trigger `fn_recurso_activar_al_pagar_gasto` (mig 406) — que además cubre
todos los caminos por los que un gasto se salda, no solo la pantalla de Gastos. En su lugar quedó un
indicador con el motivo, para que no parezca que falta un botón.

## Links relacionados

- [[wiki/features/gastos]]
- [[wiki/features/multi-sucursal]]
- [[wiki/features/alertas]]
- [[wiki/development/cierre-contable]]
