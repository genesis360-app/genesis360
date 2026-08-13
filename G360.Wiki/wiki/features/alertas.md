---
title: Alertas
category: features
tags: [alertas, stock-minimo, lpn-vencidos, reservas, categorias, sucursal, paginacion, deep-links]
sources: [CLAUDE.md]
updated: 2026-08-13
---

# Alertas

**Página:** `src/pages/AlertasPage.tsx` (`/alertas`)  
**Hook:** `src/hooks/useAlertas.ts`  
**Acceso:** Todos los roles

---

## Secciones de AlertasPage

AlertasPage muestra **12 secciones independientes** (creció desde las 4 originales de 2026-05:
stock mínimo, reservas viejas, sin categoría, clientes con deuda, OC vencidas/próximas, LPNs
vencidos, pedidos con entrega vencida/sin avanzar, inventario sin ubicación/sin proveedor,
efectivo en caja sobre umbral). El badge del sidebar suma todas (mode-aware, ver más abajo).

### 1. Alertas de stock (tabla `alertas`)
- Creadas por trigger `check_stock_minimo` AFTER UPDATE en productos
- Trigger usa SECURITY DEFINER para bypasear RLS en contexto de trigger
- Se marcan como "resueltas" manualmente
- Botón **"Resolver"** bloqueado si `stock_actual <= stock_minimo` (el problema sigue existiendo)
- Complementado por trigger `auto_resolver_alerta_stock` (migration 042)

### 2. Reservas viejas (> 5 días)
- Query: ventas en estado `reservada` con `created_at < now() - 5 days`
- Mismo criterio que el monitoring diario y el badge del dashboard
- Botón **"Ver venta"** → navega a `/ventas?id=xxx`

### 3. Productos sin categoría
- Query: `productos WHERE activo=true AND categoria_id IS NULL`
- Sección naranja con icono `Tag`
- Link a `/productos/:id/editar` para asignar categoría

### 4. Clientes con saldo pendiente
- Agrupa ventas por cliente, muestra saldo acumulado y cantidad de ventas
- Botón **"Ver ficha"** → `/clientes?id=xxx`

---

## LPNs vencidos (migration 051)

Desde v0.84.0:
- `fecha_vencimiento < hoy` excluye líneas en ventas (4 puntos de validación)
- Sección roja en AlertasPage con botón "Ver LPN" → `/inventario?search=LPN-XXX`
- Badge `useAlertas` incluye el conteo
- InventarioPage lee `?search=` al montar y pre-filtra

---

## Badge del sidebar vs totalAlertas

| Contexto | Incluye |
|---------|---------|
| Badge sidebar + Dashboard card | alertas DB + reservas_viejas |
| AlertasPage `totalAlertas` | alertas DB + reservas_viejas + sinCategoria + clientesConDeuda + LPN vencidos |

> [!NOTE] La diferencia es intencional: sidebar/dashboard muestran alertas **urgentes**, AlertasPage muestra **todo el detalle**.

---

## Diferencia: Stock Crítico vs Alertas

- **Dashboard "Stock Crítico"** (card) = tiempo real (`stock_actual <= stock_minimo`)
- **AlertasPage sección stock** = tabla `alertas` (trigger-based)

Pueden diferir: el trigger crea la alerta cuando el stock baja, pero no la resuelve automáticamente cuando se repone. Resolución manual requerida.

---

## OC vencidas sin pagar — v1.6.0

Nueva sección **roja** en AlertasPage:
- Query: `ordenes_compra WHERE fecha_vencimiento_pago < hoy AND estado_pago NOT IN ('pagada')`
- Muestra días de mora por cada OC
- Botón **"Regularizar"** → navega a `/gastos` (tab Órdenes de Compra)

## OC próximas a vencer — v1.6.0

Nueva sección **ámbar** en AlertasPage:
- Query: `ordenes_compra WHERE fecha_vencimiento_pago BETWEEN hoy AND hoy+3d`
- Muestra días restantes
- Botón **"Pagar ahora"** → navega a `/gastos`

> [!NOTE] El badge del sidebar ahora incluye el conteo de OC vencidas + próximas a vencer (v1.6.0).

---

## Badge del sidebar vs totalAlertas — mode-aware (v1.67.0)

Desde **v1.67.0** el badge del sidebar (`useAlertas`) y `AlertasPage.totalAlertas` cuentan **las mismas fuentes** y se **gatean por modo de operación** (`useModoOperacion().avanzado`). Antes, el badge sumaba fuentes de WMS/compras que la página no mostraba en básico → aparecía un "1" fantasma sin nada visible.

| Fuente | Básico | Avanzado |
|--------|:------:|:--------:|
| Stock bajo mínimo (tabla `alertas`) | ✅ | ✅ |
| Reservas viejas (>3d) | ✅ | ✅ |
| Productos sin categoría | ✅ | ✅ |
| Clientes con deuda CC | ✅ | ✅ |
| **Efectivo en caja sobre el umbral de bóveda** (H4) | ✅ | ✅ |
| **LPN vencidos** (vencimiento de lote, WMS) | — | ✅ |
| **OC vencidas / próximas ≤3d** (compras) | — | ✅ |
| Inventario sin ubicación / sin proveedor (WMS) | — | ✅ |

> [!IMPORTANT] Si tocás una de las fuentes avanzado-only, gateála en **ambos** lados (hook + página) o el badge vuelve a desincronizarse. Ver memoria `reference_alertas_badge_mode_aware`.

## Efectivo en caja sobre el umbral de bóveda — H4 (2026-06-22)

Sección **ámbar** en AlertasPage (ambos modos). Si una caja operativa **abierta** (excluye la Caja Fuerte permanente) tiene efectivo sobre `tenants.boveda_umbral_caja` → alerta "conviene depositar el excedente a la Caja Fuerte". Botón **"Ir a Caja"**.
- Solo se evalúa si el tenant configuró el umbral (>0); si no, no toca la DB.
- Lógica pura compartida: `cajasSobreUmbralBoveda` (`lib/cajaSaldo.ts`, mismo cálculo de efectivo que CajaPage) + helper `cajasSobreUmbralBovedaDelTenant` (`hooks/useAlertas.ts`) usado por el badge **y** la página → no divergen.
- No muta plata (fire-and-forget, solo avisa).

---

## Monitoring diario

La EF `monitoring-check` incluye stock crítico y reservas viejas en el email diario a las 9 AM AR. Ver [[wiki/development/supabase-dev-vs-prod]].

---

---

## Filtrado por sucursal (v1.8.19 · 2026-05-13)

`AlertasPage` ahora usa `useSucursalFilter` y aplica `applyFilter` a las queries que tienen `sucursal_id`:

| Query | Filtro |
|---|---|
| Reservas viejas (`ventas`) | ✅ `applyFilter` |
| LPNs sin ubicación (`inventario_lineas`) | ✅ `applyFilter` |
| LPNs sin proveedor (`inventario_lineas`) | ✅ `applyFilter` |
| OCs vencidas (`ordenes_compra`) | ✅ `applyFilter` |
| OCs próximas a vencer (`ordenes_compra`) | ✅ `applyFilter` |
| LPNs vencidos (`inventario_lineas`) | ✅ `applyFilter` |
| Clientes con deuda (`ventas`) | ✅ `applyFilter` |
| Alertas de stock (`alertas`) | ✅ Cruce client-side por sucursal (ISS-080) |
| Productos sin categoría (`productos`) | ✅ Cruce client-side por sucursal (ISS-080) |

### ISS-080 — Filtrado por sucursal de tablas sin `sucursal_id` (2026-05-28)

Las tablas `alertas` y `productos` no tienen `sucursal_id` (alertas viene del trigger global, productos es catálogo del tenant). Cuando hay sucursal activa, `AlertasPage` ahora:

- **Stock mínimo**: para cada alerta, suma `inventario_lineas.cantidad` del producto en la sucursal activa (JOIN a `ubicaciones.sucursal_id`) y compara con `producto_stock_minimo_sucursal` (PSMSS — override por sucursal, mig 052) o con `productos.stock_minimo` como fallback. La alerta solo aparece si el stock en esa sucursal está al o bajo el mínimo.
- **Sin categoría**: filtra los productos sin categoría que tengan al menos una `inventario_lineas` activa con cantidad > 0 en la sucursal activa.

Si no hay sucursal seleccionada (vista global con `puede_ver_todas`), se muestran todas las alertas como antes.

> [!NOTE] Esto evita el ruido de ver alertas de stock crítico de otra sucursal. Como solución pragmática sin schema change. Pendiente futuro: agregar `sucursal_id` a `alertas` + reescribir trigger `check_stock_minimo` para disparar por sucursal+producto.

---

## Tope de renderizado por sección — `ALERTAS_DISPLAY_LIMIT` (2026-08-12, ✅ EN PROD desde v1.169.0)

GO pidió (2026-08-11) agregar a Alertas y Supervisión el mismo footer "Mostrando X de Y" de
`HistorialPage.tsx`, porque secciones con muchos registros no tenían tope (scrollbar diminuto,
sospecha de que también pesaba en el tiempo de carga). Al investigar se confirmó que AlertasPage
**no es una lista única** como Historial sino 12 secciones independientes — replicar un footer de
paginación completo en cada una saturaría la pantalla. Se le presentó la disyuntiva a GO, que eligió
el enfoque adaptado (no el literal):

- Cada sección topea su renderizado a `ALERTAS_DISPLAY_LIMIT = 15` (ordenado por relevancia) y
  muestra un link **"Ver todas/todos →"** al módulo correspondiente cuando hay más.
- **8 secciones "simples"** (sin agregación cliente-side: OC vencidas/próximas, LPNs vencidos,
  pedidos vencidos/sin avanzar, reservas viejas, inventario sin ubicación/sin proveedor) — el
  `.limit(15)` se aplica en la query de Supabase junto con `{ count: 'exact' }`, que devuelve el
  total REAL (ignora el límite) en una sola llamada — mismo mecanismo que ya usa `HistorialPage`.
- **3 secciones que agregan/filtran client-side** (stock mínimo, sin categoría — filtran por stock
  real en la sucursal activa vía ISS-080 — y clientes con deuda — suma saldo por cliente) **traen el
  set completo de la DB sin límite**, y el tope se aplica solo al RENDERIZADO (`.slice(0, 15)`)
  después de calcular el resultado real. Limitar la query ahí habría dado conteos/saldos falsos
  (REGLA #0 — un "$X pendiente" o un "bajo mínimo" mal calculado es un error de plata/stock real, no
  cosmético). `generarOCsSugeridas` (botón "Generar OC sugerida") sigue leyendo el array completo de
  `alertas`, nunca el recortado — la sugerencia de compra debe considerar TODOS los productos bajo
  mínimo, no solo los primeros 15 visibles.
- Verificado en navegador real contra el tenant "Almacén Jorgito" (654 alertas activas reales):
  "Inventario sin proveedor (339 LPNs)" con 15 tarjetas renderizadas + link "Ver todo →" a
  `/inventario`; mismo patrón confirmado en sin ubicación (118), stock mínimo (36) y sin categoría
  (135). Secciones bajo el tope (ej. "LPNs vencidos (2)") no muestran el link. Sin errores de consola.

**Estado real: ✅ EN PROD desde v1.169.0** (deploy real 2026-08-13, PR #329; construido y verificado en
DEV el 2026-08-12). Ver [[wiki/features/supervision]] para el mismo pedido aplicado a la lista de
Aprobaciones (esa sí es homogénea, ahí se replicó el footer literal de Historial).

## Deep-links específicos por sección (2026-08-12, ronda 2 de feedback, ✅ EN PROD desde v1.169.0)

Al revisar en el navegador la paginación de arriba, GO encontró que **todos** los links de AlertasPage
(el botón de cada ítem individual y los nuevos "Ver todo/todas →" de sección) llevaban a la página
general del módulo destino **sin filtrar** — ej. "Ver en Picking" de un pedido puntual llevaba a
`/picking` a secas en vez de filtrar por ESE pedido; el "Ver todas" de "Reservas sin despachar" llevaba
a `/ventas` (que abre en "Nueva venta") en vez de al Historial filtrado por reservas. Pidió revisar y
corregir **todos** los botones de la página, no solo los ejemplos que dio.

Investigando cada página destino se encontró que la mayoría ya tenía un mecanismo de filtro por query
param sin reusar — se conectó ahí en vez de reinventar. Patrón por sección (ítem individual → "Ver
todo/todas" de sección):

| Sección | Ítem individual | "Ver todo/todas" de sección |
|---|---|---|
| Stock bajo mínimo | `/inventario?search=<SKU>` | `/inventario?filterAlerta=1` (reusa el toggle existente) |
| Pedidos sin avanzar +24h | `/picking?busqueda=Pedido:<numero>` (mismo patrón que ya usaba `PedidosPage` internamente) | `/pedidos?estado=en_preparacion` |
| Pedidos con entrega vencida | `/pedidos?busqueda=<numero>` | `/pedidos?vencidos=1` (flag nuevo, replica el criterio exacto de la alerta) |
| OC vencidas / próximas | `/gastos?tab=oc&oc=<numero>` (⚠ ronda 3: pasa el **número**, no el id — ver abajo) | `/gastos?tab=oc&ocVencidas=1` / `ocProximas=1` (flags nuevos) |
| Reservas sin despachar | `/ventas?id=<id>` (preexistente) | `/ventas?tab=historial&estado=reservada` |
| Clientes con saldo pendiente | `/clientes?id=<id>` (preexistente) | `/clientes?tab=cc` (la tab Cuenta Corriente ya lista exactamente eso) |
| Inventario sin ubicación / sin proveedor | `/inventario?search=<lpn>` | `/inventario?filterUbic=__sin__` / `filterProv=__sin__` (reusa los sentinels existentes) |
| Productos sin categoría | `/productos/:id/editar` (preexistente) | `/productos?filterCat=__sin__` (reusa el sentinel existente) |
| LPNs vencidos | `/inventario?search=<lpn>` (preexistente) | sin cambios — ver límite abajo |

Donde no existía ningún mecanismo se agregaron 3 flags booleanos nuevos + chips visuales
(`?vencidos=1` en `PedidosPage.tsx`, `?ocVencidas=1`/`?ocProximas=1` en `GastosPage.tsx`), todos de
bajo riesgo (solo agregan un filtro de lectura, no tocan lógica de negocio).

**2 límites aceptados, avisados a GO (no corregidos esta ronda)**:
- **Efectivo en caja sobre el umbral de bóveda**: sigue a `/caja` genérico — `CajaPage.tsx` no tiene
  ningún mecanismo de deep-link y es código sensible de plata (REGLA #0); decisión consciente de no
  tocarlo a la ligera en esta ronda.
- **LPNs vencidos, "Ver todos" de sección**: no existe un toggle "vencidos" a nivel LÍNEA en
  Inventario (solo a nivel producto), así que el link de sección sigue sin filtro específico — el
  ítem individual ya filtraba bien desde antes (`/inventario?search=<lpn>`).

**Rediseño relacionado**: `/supervision` (agregador cross-módulo, ver [[wiki/features/supervision]])
también se rediseñó en esta misma ronda para mostrar un desglose por tipo en vez de una lista cruda, y
se corrigió un bug real donde el tab de Inventario al que apuntaba no leía el `?tab=` de la URL.

**Verificación**: typecheck + build verdes. Verificado EN EL NAVEGADOR (Playwright ad-hoc) contra el
tenant real "Almacén Jorgito" en DEV — se navegó a cada uno de los 8 destinos con parámetros reales y
se confirmó visualmente que el filtro/tab correcto queda activo. Sin errores de consola nuevos.

**Estado real: ✅ EN PROD desde v1.169.0** (deploy real 2026-08-13, PR #329; mismo commit que el tope de
renderizado de arriba).

## Ronda 3 — fix de aislamiento por sucursal + deep-links más exactos (2026-08-12, ✅ EN PROD desde v1.169.0)

GO probó en el navegador los deep-links de la ronda anterior y encontró 2 problemas reales más.

**Bug de aislamiento por sucursal — único caso de las 12 secciones que nunca había filtrado por
sucursal.** Con "Sucursal Norte" seleccionada en el header, "Efectivo en caja sobre el umbral"
mostraba la Caja S2, que pertenece a Sucursal Sur. Causa raíz: el helper
`cajasSobreUmbralBovedaDelTenant()` (`src/hooks/useAlertas.ts`) nunca recibía el `sucursalId` actual.
**Fix**: parámetro nuevo, opcional y retrocompatible (sin él, "Todas las sucursales" sigue igual),
propagado a los **dos** call sites — el hook del badge del sidebar (`useAlertas()`) **y** la query
propia de `AlertasPage.tsx` (el primer intento solo corrigió el hook del badge y se olvidó de la
query de la página, así que el bug seguía visible hasta corregir ambos). Confirmado con SQL real
contra Supabase: `caja_sesiones.sucursal_id` de la sesión abierta de "Caja S2" efectivamente pertenece
a Sucursal Sur.

**"Ver todo/todas" no siempre alcanzaba para encontrar el registro exacto entre varios similares** —
3 casos concretos que GO probó a mano:

- **OC vencidas/próximas**: el link de ítem individual ahora pasa el **número** de OC
  (`/gastos?tab=oc&oc=<numero>`, antes el id interno) porque `GastosPage.tsx` ganó un buscador real
  por número/proveedor (`ocBusqueda`, tab OC) — antes esa pestaña no tenía NINGÚN buscador, así que
  entre varias OC en pantalla había que encontrarla a simple vista igual. Ver [[wiki/features/gastos]].
- **Pedidos sin avanzar / entrega vencida** y **Reservas sin despachar**: los links "Ver
  pedido"/"Ver en Picking"/"Ver venta" ahora arman directamente la píldora exacta
  (`Pedido:N` / `Venta:N`) del nuevo buscador de píldoras de Pedidos y Ventas → Historial — ver
  [[wiki/features/filtro-pildoras]] (sección "Extensión a Pedidos y Ventas"), [[wiki/features/pedidos]]
  y [[wiki/features/ventas-pos]]. Antes esos buscadores eran de texto plano y un número corto
  (ej. "2") también traía cualquier otro que lo "contuviera" (82, 102...).
- **Clientes con saldo pendiente**: "Ver ficha" ya expandía la ficha correcta desde antes, pero en una
  lista de varios clientes no había señal visual de cuál era. `ClientesPage.tsx` ahora hace scroll
  automático + resalta (borde/anillo) la tarjeta del cliente del deep-link — ver
  [[wiki/features/clientes-proveedores]].

**Verificado en el navegador (Playwright ad-hoc) contra "Almacén Jorgito" en DEV**: OC #7 encontrada
exacta (no trae la #17 ni la #27), Pedido #2 exacto con la píldora visible en pantalla, Venta #238 con
la lista filtrada y el modal de detalle abiertos simultáneamente, ficha de "Fede Messina" resaltada
tras scroll automático. Tests unitarios nuevos: `pedidosFiltro.test.ts` (9/9) y `ventasFiltro.test.ts`
(6/6). Typecheck + build verdes. **✅ EN PROD desde v1.169.0** (deploy real 2026-08-13, PR #329). Ver
`log.md` (2026-08-13, entrada al principio) y `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ").

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/gastos]]
- [[wiki/features/multi-sucursal]]
- [[wiki/features/pedidos]]
- [[wiki/features/filtro-pildoras]]
