---
title: Estructuras de producto + Unidades de Medida (footprints)
category: features
tags: [estructuras, unidades-medida, footprint, wms, picking, almacenaje, udm, precio-por-uom]
sources: [migrations 031, 119, 148, 282, 283, 286, 287, src/lib/estructuras.ts]
updated: 2026-07-21
---

# Estructuras de producto con niveles dinámicos por UdM

Modelo estilo **pack structure / footprint de Blue Yonder** (pedido GO 2026-07-19): por cada SKU
puede haber **varias estructuras** (una default), y cada estructura tiene **N niveles dinámicos**
donde cada nivel es una **unidad de medida del tenant** con factor de conversión, peso y
dimensiones. Reemplaza el modelo viejo de 3 niveles hardcodeados (unidad/caja/pallet como
columnas fijas, mig 031).

---

## Modelo de datos (migs 282-283)

```
producto_estructuras            (cabecera — YA EXISTÍA, mig 031)
  id, tenant_id, producto_id, nombre, is_default
  · varias por SKU, UNA default (UNIQUE INDEX WHERE is_default)
  · columnas fijas viejas (peso_unidad…largo_pallet, unidades_por_caja,
    cajas_por_pallet) = DEPRECADAS, drop pendiente post-verificación PROD

producto_estructura_niveles     (NUEVA, mig 282)
  estructura_id → producto_estructuras (CASCADE)
  unidad_medida_id → unidades_medida (RESTRICT)
  orden      (1 = nivel base)
  factor     INT ≥ 1 — cuántos del nivel ANTERIOR contiene (base = 1)
  unidades_base BIGINT — equivalencia total en la UdM base (producto acumulado
             de factores; la calcula el SERVER, nunca el cliente)
  peso_kg, alto_cm, ancho_cm, largo_cm (opcionales, > 0 si se cargan)
  UNIQUE (estructura_id, orden) · UNIQUE (estructura_id, unidad_medida_id)
  RLS tenant-scoped (política pen_tenant)
```

**Ejemplo:** estructura "Footprint estándar" del SKU Yerba 1kg →
`Unidad (base) · Caja = 12 × Unidad · Pallet = 40 × Caja (= 480 × Unidad)`.

### RPC transaccional `fn_estructura_guardar_niveles(p_estructura_id, p_niveles jsonb)`

Único camino de escritura de niveles (la UI nunca inserta directo):

- Reemplaza TODOS los niveles en una transacción — si falla, los anteriores quedan intactos.
- Valida server-side (REGLA #0: la UI se cachea/bypassea): estructura visible por el caller
  (SECURITY **INVOKER** → aplica RLS), ≥ 1 nivel, factores enteros ≥ 1, UdM sin repetir y del
  mismo tenant.
- **Recalcula `unidades_base`** (producto acumulado) — no confía en lo que mande el cliente.
- El factor del primer nivel se fuerza a 1.

### Unidades de medida (mig 119 + 148 + 282)

- ABM en **Configuración → Unidades** (`unidades_medida`, tenant-scoped, soft-delete `activo`).
- Predefinidas (seed `fn_seed_tenant_defaults`, SECURITY DEFINER por gotcha mig 166):
  Unidad, Kilogramo, Gramo, Litro, Metro, Caja y **Pallet (nueva en 282, backfilleada a todos
  los tenants)**.
- **Toda UdM del tenant (predefinida o propia) es elegible como nivel de estructura** — ese era
  el gap: antes las UdM eran solo una etiqueta de texto en `productos.unidad_medida`.

---

## UI (Fase 1, v1.137.0)

- **Productos → tab Estructura** (solo modo Avanzado): buscador de producto → cards de sus
  estructuras con la cadena de conversión → modal con niveles dinámicos:
  - Agregar / quitar / reordenar (↑↓) niveles; el primero es la BASE (preseleccionada con la
    UdM del producto, case-insensitive, fallback "Unidad"); al agregar sugiere Caja → Pallet →
    primera UdM libre.
  - Factor "Contiene N × <UdM anterior>" + equivalencia viva "= N × base".
  - Peso/dims **opcionales** por nivel (antes eran obligatorios por nivel activo).
  - Validación espejo de la RPC en `src/lib/estructuras.ts` (`validarNiveles`).
- **Panel expandible del producto** (tab Productos): muestra los niveles de la default.
- **LpnAccionesModal → tab Estructura**: cards con la cadena + chips de peso/dims por nivel.
- **Recepciones / Inventario (ingreso)**: selector de estructura sin cambios (usa id/nombre/default).
- **Importador CSV**: mismas columnas `estr_*` de siempre; ahora escribe niveles vía RPC
  (Unidad base siempre; Caja/Pallet si el CSV trae conversión o dims).
- **Filtro "Con/Sin estructura" en `ProductosPage` → tab Productos (v1.138.0, 2026-07-21)**: panel
  de filtros pill+popover permite filtrar el listado por productos con al menos una
  `producto_estructuras` cargada o sin ninguna — ver [[wiki/features/productos]].

### Lógica pura — `src/lib/estructuras.ts`

`calcularUnidadesBase` · `validarNiveles` · `nivelesAPayload` · `cadenaConversion` ·
`convertirABase` (lista para Fase 2). Unit tests: `tests/unit/estructuras.test.ts` (22).
E2E: `tests/e2e/99_estructura_niveles_dinamicos_mutante.spec.ts` (UI + verificación en DB del
cálculo server-side + RPC directa con factor 0 → 400 y niveles intactos). UAT §39.

---

## Gotchas

- **`unidades_base` NUNCA se manda desde el cliente** — la calcula la RPC. Si aparece un nivel
  con `unidades_base` inconsistente, algo escribió directo a la tabla (mal).
- Los inputs `type="number" step="1"` bloquean no-enteros con validación NATIVA del browser
  antes del submit — el mensaje custom de `validarNiveles` solo se ve con factor vacío/inválido
  que pase la nativa. (Cazado escribiendo el e2e 99.)
- Backfill 282 usaba el criterio "peso+alto NOT NULL" del frontend viejo → **perdía la
  conversión de estructuras creadas por el importador CSV** (conversión sin dims). Mig **283**
  las reconstruye (criterio ampliado: conversión O dims). En PROD ambas son no-op (0 estructuras).
- Borrar una UdM usada por un nivel: FK `ON DELETE RESTRICT` (el soft-delete `activo=false` no
  rompe nada, el nivel sigue mostrando el nombre).
- `productos.unidad_medida` sigue siendo TEXTO (la UdM base se matchea por nombre al crear la
  estructura) — migrarlo a FK es limpieza pendiente, no bloquea.

---

## Precio por Unidad de Medida — Fase 1: modelo (migs 286-287, backlog Fede 4/6/7)

Relevamiento a fondo de los puntos 4/6/7 del backlog de Fede (2026-07-21) antes de codear: hoy
**no existe ningún camino de venta o rebaje de stock en una UoM distinta a la base** del producto
— `convertirABase()` (ver arriba) es código MUERTO, escrito de antemano para una fase futura y
todavía sin ningún invocador. Por el tamaño del cambio se decidió fasear: **esta entrega (v1.140.0)
es SOLO el modelo de datos + la carga de precio por nivel + el "ancla de precio", sin tocar
todavía POS/facturación/combos.**

### Modelo (mig 286)

- `producto_estructura_niveles.precio_venta` / `.precio_costo` — **opcionales, propios de cada
  nivel** (`CHECK ≥ 0`). Persistidos por `fn_estructura_guardar_niveles` (extendida en mig 287,
  mismo camino único de escritura que factor/peso/dims — ver arriba).
- Si un nivel no tiene precio propio, el precio **EFECTIVO** se calcula PROPORCIONAL al nivel
  "anclado" por relación de `unidades_base` (`precioEfectivoNivel()` en `src/lib/estructuras.ts`)
  — **nunca encadenando por niveles intermedios**: un precio "raro" cargado a mitad de camino no
  afecta el cálculo de ningún otro nivel.
- `productos.nivel_precio_orden` — la **"ancla de precio"**: a qué nivel de la estructura DEFAULT
  corresponden los `precio_venta`/`precio_costo` de la hoja de producto (default `NULL` = nivel
  base/orden 1; se puede anclar a cualquier nivel, ej. "Caja"). Selector nuevo **"Estos precios
  corresponden a"** en `ProductoFormPage` (ver [[wiki/features/productos]] → Card 3: Precios).
  - **Es por ORDEN (posición), no por id.** `fn_estructura_guardar_niveles` borra y reinserta
    TODOS los niveles en cada guardado (ids nuevos siempre) — un FK a id se invalidaría en cada
    resave trivial. El orden es estable mientras no se achique la estructura por debajo de esa
    posición.
  - Si eso pasa, la RPC invalida el ancla **server-side** sola (vuelve a `NULL` = nivel base,
    `ordenAnclaEfectivo()` con fallback seguro que nunca explota) y `ProductosPage` avisa ANTES de
    dejar borrar un nivel anclado.
- `venta_items.unidad_medida_id` / `.cantidad_uom` y `combos.unidad_medida_id` — migrados en la
  mig 286 para dejar el terreno listo para la Fase 2, **sin ningún código que los use todavía.**

### 🛑 Qué NO hace esta Fase 1

**Todavía no se puede vender por una UoM distinta a la base en el POS.** El precio por nivel que
carga esta Fase 1 es solo dato de catálogo — el POS, la facturación y los combos siguen operando
100% en la UdM base del producto (`venta_items.cantidad` sigue en unidades base). La **Fase 2**
(diseño ya cerrado con GO, sin código todavía) es la que conecta ese precio con una venta real.

UAT §42 · e2e 102.

### Roadmap de precio por UoM (backlog Fede 4/6/7 — numeración propia, distinta del roadmap de fases de abajo)

| Fase | Qué | Estado |
|---|---|---|
| **1** | Modelo: precio propio por nivel + ancla de precio (`nivel_precio_orden`) | ✅ v1.140.0 (migs 286-287) |
| **2** | Vender por UoM en el POS (elegir "Caja" en el carrito → precio del nivel, rebaje siempre en unidad base) + facturación + combos por UoM | ⬜ diseño cerrado, sin código |

---

## Roadmap del plan (acordado con GO 2026-07-19)

| Fase | Qué | Estado |
|---|---|---|
| **1** | Niveles dinámicos por UdM (modelo + RPC + UI + backfill) | ✅ v1.137.0 (migs 282-283) |
| **2** | Operar por UdM al ingresar stock (recibir "5 cajas" → 60 unidades; UdM trazada en el LPN; stock SIEMPRE en unidad base) | ⬜ |
| **3** | **Zonas** (nueva entidad que agrupa ubicaciones) + **reglas de almacenaje** por UdM → zona/ubicación, con **sugerencia editable** al ingresar (no bloquea) | ⬜ |
| **4** | Tareas WMS (`wms_tareas`) + **picking por UdM** (listas que respetan FIFO/FEFO de `rebajeSort` y sugieren "2 cajas" en vez de "24 unidades") | ⬜ |
| **5** | **Reabastecimiento** reserva → posición de surtido/picking (mín/máx por producto+ubicación con UdM de reposición; generación on-demand + al confirmar picking — sin pg_cron) | ⬜ |

Decisiones ya tomadas por GO: factor **vs nivel anterior** (estilo BY) · crear **Zonas/Áreas** ·
reglas de almacenaje **sugieren** (no bloquean) · reabastecimiento incluido en el paquete.
Abiertas: picking ¿solo envíos/preparación o también mostrador? (recomendado: solo envíos) ·
¿OC por UdM? · factores siempre enteros (confirmar si aparece un caso real de fracción).

---

## Links relacionados

- [[wiki/features/wms]] — visión general WMS y fases históricas
- [[wiki/features/productos]] — tab Estructura + UdM personalizables + Card 3 (ancla de precio)
- [[wiki/features/inventario-stock]] — asignación de estructura a LPNs
- [[wiki/features/configuracion]] — ABM Unidades de medida
- [[wiki/features/ventas-pos]] — Fase 2 (pendiente) conecta el precio por nivel con la venta real
- [[wiki/database/migraciones]] — migs 282, 283, 286, 287
