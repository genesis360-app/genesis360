---
title: Descuentos por empaque/pallet + backlog Comercial (Fede 25/7)
category: features
tags: [precios, tiers, mayorista, empaque, descuentos, comercial, repositores, cupones, aprobacion-foto, anti-fraude]
sources: [migrations 328, 329, 330, 331, 332, src/lib/tiers.ts, src/lib/presentaciones.ts, src/lib/cupones.ts, src/pages/ProductoFormPage.tsx, src/pages/VentasPage.tsx, src/pages/ConfigPage.tsx, src/components/PresentacionesEditor.tsx, src/components/LpnAccionesModal.tsx, src/pages/InventarioPage.tsx]
updated: 2026-08-04
---

# Descuentos por empaque/pallet + backlog Comercial (Fede 25/7)

> 🟢 **INICIATIVA EN CURSO, EN DEV, SIN deploy a PROD — el gap de e2e/UAT que pausaba el deploy YA SE
> CERRÓ (2026-08-04).** Esta página documenta las **Fases F y A** (pricing/empaque) y **C** (cupones),
> ya construidas y verificadas; la **Fase B** (aprobación con foto) también se completó, pero su
> detalle técnico vive en [[wiki/features/inventario-stock]] → "Aprobación de cambio de estado con
> foto" por ser un feature 100% de Inventario, sin relación con precios. **Fase D** (módulo Comercial)
> también se completó — detalle en [[wiki/features/comercial]]. **Solo Fase E (módulo Repositores)
> sigue por delante**, con el relevamiento ya generado (ver más abajo), pendiente de que GO/Fede lo
> respondan.
> **e2e/UAT (sesión 2026-08-04):** 14 specs nuevos (`tests/e2e/115..128*.spec.ts`), todos verdes,
> registrados en `tests/specs/uat-modo-basico.md` §49 — plan completo en
> `tests/specs/comercial-fede-abcd.plan.md`. Encontró y cerró un hallazgo real de Regla de Oro #0
> (mig 333, guard server-side de Fase B) — ver [[wiki/database/migraciones]] mig 333.
> **Estado git:** el código de F/A/B/C/D está commiteado en `dev` (sesión 2026-07-30/08-03). Los
> tests + mig 333 + el rewire que cierra el hallazgo (sesión 2026-08-04) siguen SIN COMMITEAR —
> pendiente de autorización explícita del usuario (verificar `git status` antes de asumir).

## El pedido de Fede (25/7/2026)

Fede (socio, cofundador) mandó un documento con **6 decisiones de negocio** + **1 regla
transversal**:

1. **Descuentos por empaque/pallet** — "el caso del pallet": vender 1, 2 o 3 pallets debería aplicar
   el precio mayorista automáticamente para cualquier múltiplo exacto, sin cargar un tier distinto
   por cada uno.
2. **Módulo Comercial**, con **cupones** y **descuentos por estado de inventario con aprobación por
   foto** (control de fraude interno).
3. **Módulo Repositores** (nuevo).
4. **Agrupación visual de Estructura** — ver las líneas del árbol de empaque agrupadas por nivel.
5. **Color de las unidades de medida BASE** en Config → Inventario → Unidades (se leían como
   deshabilitadas cuando en realidad son fijas/protegidas).
6. **Tipo de empaque** — categoría informativa (Unidad/Caja/Pallet/Bolsa/Bulto...) separada del
   nombre libre por SKU.

**Regla transversal** (sin fase asignada, diferida a propósito — ver más abajo): tier, empaque,
combo y descuento por estado de inventario deberían **competir** entre sí, calculados cada uno
independiente desde el precio de lista, y ganar el mejor precio — **nunca acumularse**.

**Plan de fases acordado:** **F** (quick wins) → **A** (motor de precio de tiers) → **B**
(aprobación con foto) → **C** (cupones) → **D** (módulo Comercial) → **E** (módulo Repositores).

---

## ✅ Fase F — 3 quick wins (sin Regla #0, puro UI/informativo)

Cierra los puntos 4, 5 y 6 del pedido. Sin impacto en plata, stock ni fiscal.

- **Punto 5 — color cian para las unidades BASE.** En Config → Inventario → Unidades las unidades
  base de cada familia (`es_base_familia`) se leían con el mismo gris que una unidad
  deshabilitada, pese a ser fijas/protegidas (no se pueden desactivar, son el ancla de conversión
  de su familia). Ahora tienen texto e indicador cian propios (`ConfigPage.tsx`).
- **Punto 6 — tipo de empaque (mig 328).** `unidades_medida.tipo_empaque` (texto libre, **sin CHECK
  a propósito** — mismo criterio que `combos.descuento_tipo`: lista abierta que puede crecer sin
  migración, la UI valida contra una constante fija). Backfill de las predefinidas que sobrevivieron
  a la limpieza de la mig 327 (Caja→"Caja", Pallet→"Pallet", Unidad→"Unidad"). Selector nuevo en el
  alta/edición de Config → Inventario → Empaque.
  ⚠ **Puramente informativo/reportes, sin función técnica** — no se cruza con el enlace
  tier↔empaque de la Fase A, que usa `producto_presentaciones.id` (identidad de línea de un
  producto puntual), una tabla completamente distinta.
- **Punto 4 — agrupación visual de Estructura por nivel.** `PresentacionesEditor.tsx` (pestaña
  Estructura de Productos) agrupa las líneas del árbol de empaque en "burbujas" visuales por
  **profundidad respecto de la base**: nivel 0 se etiqueta "NB · Nivel Base", el resto "Nivel 1",
  "Nivel 2"... Dentro de cada burbuja las hermanas se ordenan de **menor a mayor** cantidad de
  unidades base (pedido explícito de Fede), no por orden de creación. Al elegir para una línea
  nueva el mismo tipo de empaque que una ya cargada (ej. agregar "Caja-15" cuando ya existe
  "Caja-10"), el sistema la ubica automático como **hermana** (mismo padre) en vez de dejarla
  colgando de donde la ponía el default viejo.
  - Lógica pura nueva en `src/lib/presentaciones.ts`: `profundidadDe(row, rows)` (sube la cadena de
    padres contando saltos, defensivo contra ciclos) y `agruparPorNivel(rows)` (agrupa + ordena
    hermanas). Tests nuevos en `tests/unit/presentaciones.test.ts`.
  - **100% visual, sin cambio de modelo de datos** — no toca `fn_presentaciones_guardar` ni el árbol
    persistido, solo cómo se agrupan las filas en pantalla.

## ✅ Fase A — motor de precio de tiers (INCREMENTAL) — 🛑 PLATA

Resuelve el **punto 1** (el caso del pallet), decisión explícita de GO de hacerlo **incremental**:
se mantiene el modelo de capas actual del POS (el tier fija un precio, y combo / descuento por
estado siguen restando **encima** de ese precio como hoy — eso NO se tocó). La regla transversal
completa queda diferida a un paso aparte (ver abajo).

### Modelo de datos (migs 329/330)

- **Mig 329** (`producto_precios_mayorista`): dos columnas nuevas.
  - **`tipo_valor`** ('precio_fijo', default/legacy | 'pct'): un tier puede ser un **% de
    descuento** en vez de un precio fijo. El % siempre se aplica sobre el precio de **LISTA**
    (`productos.precio_venta`), **nunca** sobre un precio ya rebajado por otra capa — CHECK
    `producto_precios_mayorista_precio_pct_chk` (0-100) valida el rango cuando `tipo_valor='pct'`.
  - **`presentacion_id`** (FK nullable → `producto_presentaciones(id)`, `ON DELETE SET NULL`):
    enlace **opcional** a una línea puntual del árbol de empaque. Si está seteado, el tier se
    evalúa contra la cantidad de **MÚLTIPLOS COMPLETOS** de esa presentación
    (`cantidad_total_sku / factor_base`), no contra unidades sueltas — así el descuento se
    multiplica automático para 1, 2, 3... pallets sin cargar un tier por cada múltiplo.
  - **Trigger `trg_ppm_presentacion_mismo_producto`** (hallazgo del subagente `migration-reviewer`
    antes de aplicar): el FK por sí solo no impide enlazar la presentación de **OTRO producto** (o,
    ya que los checks de FK no pasan por RLS, hasta de otro tenant) — sin este guard, un tier de
    "Producto A" podría apuntar a la presentación de "Producto B" y el multiplicador de cantidad
    quedaría calculado contra el `factor_base` equivocado.
  - Sigue alineado con la mig 307 (el empaque no tiene precio propio): esto no le agrega precio a
    `producto_presentaciones`, solo la referencia desde el tier.
- **Mig 330**: reescribe `fn_precio_venta_efectivo` (usada por Pedidos, `fn_pedido_generar_venta`,
  mig 317/319) con el **mismo algoritmo** que el frontend — ver "Cómo se resuelve el precio" abajo.
  **Verificado con datos REALES de DEV**: para todos los tiers existentes (ninguno tiene
  `presentacion_id` todavía) el resultado es **matemáticamente idéntico** al de antes de esta
  migración — 100% compatible, sin re-facturar nada distinto.

### Cómo se resuelve el precio (`src/lib/tiers.ts` + espejo SQL en `fn_precio_venta_efectivo`)

- **`precioUnitarioDeTier(tier, precioLista)`** — precio por unidad de un tier individual
  ($/unidad si `precio_fijo`, `precioLista × (1 - pct/100)` si `pct`).
- **`resolverBloquesTier(tiers, cantidadTotal, precioLista)`** — separa la cantidad total del SKU en
  el carrito en **bloques**: si hay un tier enlazado a una presentación cuyos múltiplos completos
  matchean su regla (ej. "≥ 1 pallet"), ese bloque compite contra el **mejor tier normal** que
  también aplique a esa misma cantidad (gana el mejor precio, no se acumulan) — y el **resto**
  (unidades que no llegan a completar otro múltiplo) se evalúa aparte contra los tiers normales.
  Entre varios tiers enlazados que matcheen a la vez (ej. uno por Caja y otro por Pallet), gana el
  de mejor precio unitario. Si ningún tier enlazado matchea, devuelve un único bloque —
  comportamiento IDÉNTICO al de siempre.
- **`precioBlendedTier(tiers, cantidadTotal, precioLista)`** — precio unitario ÚNICO "equivalente" a
  los bloques: el **promedio ponderado por cantidad**. Existe para integrarse sin romper
  `getItemSubtotal` (que multiplica "un precio × la cantidad de la línea"): aplicado a
  **cualquier** reparto de la misma cantidad total entre varias líneas/entregas del carrito,
  `Σ cantidad_línea × este precio` da **exacto** lo mismo que sumar los bloques reales — la plata
  TOTAL nunca cambia aunque la UI no muestre las líneas separadas por bloque. Es la propiedad
  matemática clave que evitó tener que reestructurar el modelo de filas del carrito.
  Para un tier sin enlace a empaque da lo mismo que el `precioTier` de siempre (mig 306).
- **28 tests nuevos** (`tests/unit/tiers.test.ts`), incluido el caso exacto del pedido de Fede:
  1 pallet de 2000 unidades + 500 sueltas = **$230.000 total**, precio blended **$92/u**.

### Wireado en frontend

- **`ProductoFormPage.tsx`** (accordion "Precios mayoristas"): selector **$/%** por tier + selector
  **"enlazar a empaque"** (solo visible si el producto tiene presentaciones más allá de la base;
  placeholder distinto en el campo de cantidad — "Múltiplos" si está enlazado, "Cant." si no).
- **`VentasPage.tsx`**:
  - `tiersMayoristaMap` trae `tipo_valor` + el `factor_base` de la presentación enlazada vía un
    **embed de PostgREST** (`producto_presentaciones(factor_base)`) en el mismo roundtrip — no un
    segundo query. Verificado con `curl` contra la API real de DEV que la relación resuelve bien.
  - `precioTierBase` usa **`precioBlendedTier`** en vez del viejo `precioTier` de match único —
    para **cualquier** tier de hoy (sin enlace a empaque) da **exacto** el mismo resultado que
    antes; el cambio es 100% compatible con lo ya cargado.
  - `mejorPrecioMayorista` (usado cuando un canal fuerza lista mayorista sin mirar cantidad) ignora
    a propósito los tiers enlazados a empaque — no tiene sentido forzarlos sin conocer la cantidad.

### Verificación antes de tocar nada

- **0 productos** hoy con combo activo + estado-con-descuento simultáneos (en DEV y PROD).
- En **PROD solo 1 producto** tiene tiers cargados (3 tiers) — el "cambio de modelo" no altera
  ningún comportamiento real hoy.
- Cada migración pasó por el subagente `migration-reviewer` **antes** de aplicarse en DEV.

---

## 🟡 Diferido a propósito — la regla transversal completa

La regla transversal completa del pedido de Fede ("tier / empaque / combo / descuento por estado
compiten, gana el mejor precio, nunca se acumulan") pide que los **4** mecanismos se calculen cada
uno **independiente desde el precio de lista** y compita el mejor. Hoy el POS los apila en
**capas**: el tier fija un precio, y combo / descuento por estado restan **encima** de ese precio ya
ajustado.

**Por qué no se hizo en esta pasada:** es un cambio de arquitectura grande que toca:

- el auto-combo que vive en un `useEffect` que reescribe el carrito,
- el margen de `RentabilidadPage`,
- el prorrateo fiscal,
- y Pedidos (`fn_pedido_generar_venta`).

**Decisión de GO:** se aborda **aparte**, con verificación e2e en navegador, antes de tocar el
modelo completo de composición de precio. No confundir con "no se va a hacer" — sigue en el roadmap
de esta misma iniciativa, sin fecha todavía.

---

## ✅ Fase B — aprobación de cambio de estado con foto (control anti-fraude)

Cierra el **punto 2** del pedido de Fede: cuando un empleado cambia un producto/lote a un estado
con impacto económico (Dañado, Vencido, Eliminado...), el cambio queda **pendiente** hasta que un
supervisor lo aprueba, con una foto tomada en el momento (no de galería) como evidencia.

**Mig 331** (`estados_inventario.requiere_aprobacion`, independiente de `descuento_pct` de la mig
284) + tipo nuevo `cambio_estado` en `autorizaciones_inventario.tipo` + bucket privado
`autorizaciones-fotos` scopeado por tenant. Wireado en `LpnAccionesModal.tsx` (cambio de un LPN) y
`InventarioPage.tsx` (cambio masivo — cerró de paso un **bypass real** que el cambio masivo tenía
del control de aprobación, tanto el nuevo como el de cantidad ya existente).

Alcance: **solo Inventario** — no toca Ventas/POS ni Pedidos. Detalle técnico completo, hallazgo de
seguridad y verificación en [[wiki/features/inventario-stock]] → "Aprobación de cambio de estado con
foto". Ver también [[wiki/database/migraciones]] → mig 331.

---

## ✅ Fase C — cupones (descuento FIJO en $ sobre el TOTAL de la venta)

Cierra el **punto 2** del pedido de Fede (dentro del módulo Comercial): cupones de descuento en **$
fijos — nunca %** — sobre el **TOTAL** de la compra, **independiente** de cualquier descuento de
producto ya aplicado en el carrito (combo, descuento por estado, tier). Se crean con código único
alfanumérico, hasta ~100 códigos por campaña, con vigencia desde/hasta, nombre + motivo/intención.
Historial: cuántos códigos se usaron y cuánto $ generaron.

### Modelo de datos (mig 332)

- **`cupones`** (la campaña): `nombre`, `motivo`, `monto` (fijo en $, CHECK > 0), `vigencia_desde`/
  `vigencia_hasta` (NOT NULL), `activo`, `created_by`.
- **`cupones_codigos`**: un código alfanumérico por fila, **único por tenant**
  (`UNIQUE(tenant_id, codigo)` — no global: dos negocios distintos pueden reusar el mismo texto de
  código sin problema, RLS los aísla), `usado_en_venta_id` (FK nullable a `ventas`,
  `ON DELETE SET NULL`), `usado_at`.
- **`ventas`** gana dos columnas: **`cupon_codigo_id`** (con **`UNIQUE`**, sugerencia del
  `migration-reviewer` para blindar a nivel de CONSTRAINT que un mismo código no quede aplicado a dos
  ventas — no solo a nivel de lógica de aplicación) y **`cupon_monto`** (snapshot del $ descontado: el
  cupón puede cambiar de monto o desactivarse después, y la venta ya facturada tiene que preservar lo
  que realmente se cobró, Regla #0).
- RLS tenant-scoped en ambas tablas nuevas + `REVOKE ALL FROM PUBLIC, anon` (mismo patrón que la
  mig 298, `328_pedidos_ped6_bolsa_staging.sql`).

### 🔒 Decisión de diseño: sin RPC dedicada de canje

Consultada con el `migration-reviewer` **antes** de escribir el código, no descubierta después: no se
construyó una función de canje aparte. El
`UPDATE cupones_codigos SET usado_en_venta_id = X WHERE id = Y AND usado_en_venta_id IS NULL` es
**atómico por sí solo a nivel de FILA** (Postgres serializa el `UPDATE`), así que alcanza con
chequear que el `UPDATE` afectó exactamente 1 fila para saber si el canje fue propio.

Se acepta el trade-off de una ventana **TOCTOU sub-segundo** sobre `activo`/vigencia (entre que el
carrito valida el cupón y confirma la venta, alguien podría desactivarlo) — **irrelevante en un POS
de un cajero por terminal**, no un e-commerce de alta concurrencia — en vez de sumar una función
nueva solo para cerrar un caso borde que no aplica al negocio real. Documentado como decisión
consciente, no como gap.

### Lógica pura (`src/lib/cupones.ts`, 11 tests en `tests/unit/cupones.test.ts`)

- **`cuponVigente`** — mismo criterio de vigencia que `comboVigente` (combos).
- **`montoDescuentoCupon`** — nunca descuenta más que el total de la venta.
- **`generarCodigosCupon`/`generarCodigoCupon`** — alfabeto de 32 símbolos **sin caracteres
  ambiguos** (sin O/0, sin I/1), `crypto.getRandomValues`, clampeado a
  `CUPON_CODIGOS_MAXIMO = 100`.

### UI admin (`ConfigPage.tsx` → Config → Ventas → Descuentos y combos)

Card nueva **"Cupones"**, debajo de Combos — vive ahí **TEMPORALMENTE** (mismo criterio que Combos
hoy) hasta que exista el módulo Comercial dedicado (Fase D, próxima). Formulario de alta (nombre,
motivo, monto, cantidad de códigos, vigencia desde/hasta) genera los N códigos de una. Lista de
campañas con: códigos usados/total, **$ generado** (= usados × monto, cumple el pedido de
"historial"), botón activar/desactivar, botón copiar todos los códigos al portapapeles, panel
expandible que muestra cada código (tachado si ya se usó).

### Canje en el POS (`VentasPage.tsx`)

Input de código en la sección de **Descuento general** del carrito → valida contra
`cupones_codigos` (existe, no usado, cupón activo + vigente) → se aplica como línea propia en el
resumen de totales ("🎟 Cupón X"). El monto se resta del total **ANTES** del descuento por método de
pago (Config → Ventas → Métodos de pago → Promo) — así lo que un medio de pago descuenta (su %) se
calcula sobre lo que el cliente **REALMENTE** va a pagar después del cupón, no sobre el total
original de la mercadería.

Al confirmar la venta: se **re-valida el cupón en fresco** (por si pasó tiempo desde que se aplicó al
carrito, o alguien más lo usó) **ANTES** de crear la venta — si ya no es válido, corta antes de
cobrar. Después de crear la venta se hace el `UPDATE` condicional atómico que marca el código usado;
si por una carrera perdida afecta 0 filas, se avisa con un **toast** en vez de deshacer una venta que
ya quedó asentada en caja.

### 🛑 Prorrateo fiscal (Regla #0)

`hayDescGlobal` — el flag que dispara `prorratearDescuentoGlobal` (reparte el descuento global sobre
`venta_items` para que factura/NC/Libro IVA sumen EXACTO lo que el cliente pagó) — ahora **incluye el
monto del cupón**. Sin este cambio, una venta con SOLO cupón (sin descuento general/combo/promo) se
hubiera facturado por el monto SIN el descuento del cupón — mismo bug que ese código ya previene para
los demás descuentos globales.

### Alcance

Cupones aplican sobre el TOTAL de una venta del **POS**. No se tocó **Pedidos** — su config ya
aclara que no aplica combos ni lista de precios por canal ([[wiki/features/pedidos]] → "Pendiente
conocido, evaluado y DIFERIDO a propósito"); cupones tampoco se extendió ahí, coherente con esa
limitación ya documentada.

**Verde:** tsc · build · suite unit completa. Migración revisada por `migration-reviewer` antes de
aplicarse en DEV.

---

## ✅ Fase D — módulo Comercial (construida, EN DEV) — ver página propia

Consolida B (aprobación con foto no forma parte, es 100% Inventario) + C (cupones) + Combos en una
superficie de gestión nueva, delegable sin darle Config completa a nadie más que el dueño. Detalle
técnico completo: [[wiki/features/comercial]].

## 🔴 Pendiente — Fase E (sin construir, relevamiento generado)

**Fase E** — módulo Repositores (nuevo). El pedido original de Fede fue un único punto sin detalle
("Módulo Repositores (nuevo)"); en vez de inventar alcance se generó
`relevamiento-repositores-reglas-negocio.html` (raíz del repo, 2026-07-30) — 35 preguntas en 12
secciones, 33 `NUEVO` + 2 `CAMBIO` (reinterpretar `disponible_surtido` como destino positivo de una
tarea — hoy es solo un filtro de exclusión en ventas/picking —, y la restricción real de que la
impresión automática de etiquetas no es viable desde una SPA sin un agente local). Queda en blanco
para que GO lo responda offline con Fede; las respuestas van a
`G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md` antes de diseñar/implementar.

**No cerrar este tema como terminado** — F, A, B, C y D ya están, pero Fase E sigue por delante y es
parte de la misma iniciativa de 6 fases.

---

## Links relacionados

- [[wiki/features/estructuras-udm]] — el árbol de `producto_presentaciones` (Fase 5, migs 310/311)
  que la Fase A enlaza desde el tier; también documenta la Fase 2-bis (mig 306, tiers con operador)
  sobre la que se construye este motor.
- [[wiki/features/ventas-pos]] — "Precios mayoristas por cantidad", donde vive `precioTierBase` en
  el carrito real, y "Cupones (descuento fijo en $)" con el canje real en el carrito (Fase C).
- [[wiki/features/pedidos]] — `fn_precio_venta_efectivo` (reescrita en la mig 330 con el mismo
  algoritmo, para que un Pedido facture exactamente igual que la misma venta cargada por el POS); ver
  también "Pendiente conocido, evaluado y DIFERIDO a propósito" (combos/lista por canal sin aplicar
  en Pedidos, mismo criterio con el que cupones tampoco se extendió ahí).
- [[wiki/features/productos]] — Card 3, accordion "Precios mayoristas" (selector $/% + enlace a
  empaque).
- [[wiki/features/inventario-stock]] — "Aprobación de cambio de estado con foto" (Fase B, mig 331,
  detalle técnico completo) y "Autorizaciones DEPOSITO" (el gate de CANTIDAD preexistente, mig 228,
  con el que convive sin conflicto).
- [[wiki/features/configuracion]] — Sub-tab "Descuentos y combos" → card "Cupones" (Fase C, vive ahí
  temporalmente hasta el módulo Comercial de la Fase D).
