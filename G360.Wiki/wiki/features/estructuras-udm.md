---
title: Estructuras de producto + Unidades de Medida (footprints)
category: features
tags: [estructuras, unidades-medida, footprint, wms, picking, almacenaje, zonas, reabastecimiento, udm, precio-por-uom, importador, ingreso-rebaje-uom]
sources: [migrations 031, 119, 148, 282, 283, 286, 287, 288, 289, 290, 291, 293, 303, 304, 305, 306, 307, 308, 309, 310, 311, 328, 329, 330, src/lib/estructuras.ts, src/lib/presentaciones.ts, src/lib/reasignacionVariante.ts, src/lib/unidadMedidaFisica.ts, src/components/PresentacionesEditor.tsx, src/components/ReasignarStockVarianteModal.tsx, src/pages/ImportarProductosPage.tsx, src/pages/InventarioPage.tsx, src/components/MasivoModal.tsx]
updated: 2026-07-30
---

> **🏗️ Rediseño en curso (2026-07-23) — UoM / Empaque / Variantes.** Tras una auditoría, GO decidió
> separar tres ejes que hoy estaban mezclados: **Unidad de Medida física** (kg/g/L, conversión
> universal fija), **Nivel de Empaque** (Caja/Pallet, factor por producto — hoy "Estructura") y
> **Variantes** (SKU madre/hijo). El diseño completo + las decisiones cerradas están en
> `diseño-uom-empaque-variantes.html` (raíz del repo) y el relevamiento en
> `relevamiento-unidades-medida-empaque-reglas-negocio.html`. **✅ TODAS las fases están construidas
> y EN PROD (1, 1-bis, 2, 2-bis chunks 1 y 2, 3, 4 y 5 — migs 303-311, deploy real v1.144.0 el 2026-07-28).** El "ancla de
> precio" (`nivel_precio_orden`, bug por POSICIÓN) se eliminó en la Fase 2, y en el chunk 2 (mig 307)
> se sacaron también los overrides de precio de presentación: el empaque es **logística pura, sin
> precio propio** (el precio por volumen es un TIER, mig 306). Desde la **Fase 5** (mig 310)
> `producto_presentaciones` es la **fuente de verdad** del empaque y admite **hermanas**;
> `producto_estructuras`/`_niveles` quedaron deprecadas (solo lectura histórica).
>
> **🆕 Sobre este rediseño (ya completo) se construyó una iniciativa NUEVA y DISTINTA, ✅ AHORA 100%
> COMPLETA Y EN PROD:** el backlog de 6 puntos que mandó Fede el 25/7/2026 (descuentos por
> empaque/pallet, módulo Comercial con cupones y aprobación por foto, módulo Repositores, agrupación
> visual de Estructura, color de unidades base, tipo de empaque). Las 6 fases (F/A/B/C/D/E) están
> construidas y deployadas — la última, **Fase E (módulo Repositores), deployada a PROD el 2026-08-12
> (v1.168.0, PR #328)**. Ver [[wiki/features/precios-tiers-empaque]] — no confundir con las fases del
> rediseño de arriba, que son un roadmap distinto (también cerrado).

## 🆕 Rediseño UoM — Fase 1: Unidad de Medida física (mig 303, EN PROD)

Tabla nueva **`unidades_medida_fisicas`** (por tenant, RLS), separada del catálogo de empaque
(`unidades_medida`) — decisión G1 de GO: tablas separadas. Modela las unidades con **conversión
universal fija**, agrupadas en **familias**:

| Familia | Unidades (base en negrita) | Decimales |
|---|---|---|
| Conteo | **Unidad** | ❌ (entero) |
| Peso | Miligramo · **Gramo** · Kilogramo · Tonelada | ✅ |
| Volumen | **Mililitro** · Litro | ✅ |
| Longitud | Milímetro · Centímetro · **Metro** · Kilómetro | ✅ |

`factor_base_familia` = cuántas unidades base atómicas equivale (Kg=1000 sobre Gramo). La conversión
entre dos unidades de la misma familia es `cantidad × factor(desde)/factor(hacia)` — exacta,
universal, para cualquier producto/tenant. `permite_decimales` = (familia≠conteo) — reemplaza al
`esDecimal` hardcodeado de `ventasValidation.ts`.

- **Lógica pura:** `src/lib/unidadMedidaFisica.ts` (`convertirFisica`, `familiaPermiteDecimales`,
  `unidadBaseDeFamilia`, `agruparPorFamilia`, `mapearLegacyAFisica` — espejo del backfill SQL). 12
  tests unitarios (`tests/unit/unidadMedidaFisica.test.ts`).
- **`productos.unidad_medida_base_id`** (FK nueva, nullable, aditiva) reemplaza gradualmente al texto
  legacy `productos.unidad_medida` (que se mantiene en sincronía desde el frontend por compatibilidad
  — los consumidores viejos siguen leyendo el texto hasta la limpieza de una fase posterior).
- **UI:** el selector "Unidad de medida" de `ProductoFormPage` ahora lista las físicas agrupadas por
  familia (optgroups) y persiste el FK + el texto en sincronía; preselecciona del texto legacy si el
  producto no tiene FK todavía. Config → Inventario → "Unidades" muestra las físicas por familia con
  su factor de conversión, y la sección de personalizadas pasó a llamarse "Nombres de empaque".
- **Migración:** seed por trigger de alta de tenant + backfill de existentes; backfill best-effort de
  `unidad_medida_base_id` desde el texto legacy (en el tenant dev, 25/25 productos mapeados).
- **Verificado:** `migration-reviewer` (APTA) · tsc · build · 12 unit · e2e `108_unidad_medida_fisica_mutante` (2/2 verde, DB real).

## 🆕 Rediseño UoM — Fase 2: precio canónico en la unidad BASE + presentaciones (mig 304, EN PROD) — 🛑 TOCA PLATA

Dos cambios acoplados (decisiones C5/C6 + F1/F3 de GO):

**(A) Precio canónico en la unidad base.** Se **eliminó `productos.nivel_precio_orden`** (el "ancla por
posición", bug F3: no se revalidaba al reordenar niveles / cambiar la estructura default → podía apuntar
en silencio a otra unidad). A partir de acá `productos.precio_venta/costo` es **SIEMPRE el precio por
unidad base**. El precio efectivo de una presentación = `override propio ?? precio_base × factor_base`
(nueva función pura `precioPresentacion` en `src/lib/estructuras.ts`, reemplaza `precioEfectivoNivel`/
`ordenAnclaEfectivo`). **Back-calc de plata** de los productos anclados: exacto contra los 6 de DEV
(Coca 3500/6=583.33, con la Caja guardando override 3500 exacto para no driftear; drift ≤ centavos solo
en niveles derivados altos como el Pallet). `fn_estructura_guardar_niveles` reescrita SIN el bloque que
seteaba `nivel_precio_orden` (habría roto todo guardado tras el DROP).

**(B) Tabla `producto_presentaciones`** (modelo PLANO: cada presentación con `factor_base` DIRECTO a la
base — soporta hermanas Caja-6/Caja-9 a futuro). En esta fase se puebla **1:1** desde
`producto_estructura_niveles` y se mantiene sincronizada por trigger (`fn_rebuild_presentaciones` +
`trg_pp_sync_niveles`/`trg_pp_sync_estructura`). `niveles` **sigue siendo la fuente de CONVERSIÓN**
(Recepciones/Inventario/WMS/`fn_wms_describir_cantidad`) hasta la Fase 5. GRANT solo SELECT a
authenticated (tabla 100% derivada). Hermanas bloqueadas hasta Fase 5 por `UNIQUE(producto,nombre_empaque)`.

- **Rewire de precio:** `ProductoFormPage` (label "por [unidad base]", sin selector de ancla),
  `VentasPage`/POS (lee presentaciones + base), `ProductosPage`, `ImportarProductosPage` (sacada la
  columna `estr_precio_ancla`; los precios por caja/pallet siguen como overrides de nivel).
- **Verificado:** `migration-reviewer` (GRANT solo-SELECT + guard de idempotencia aplicados) · tsc ·
  build · 37 unit (nuevos de `precioPresentacion`) · e2e `102`/`105` (3/3, DB real).

## 🆕 Rediseño UoM — Fase 3: variantes madre/hijo (mig 305, EN PROD) — reemplaza `producto_grupos`

Auto-referencia en `productos` (estilo Shopify: el producto ES el padre):
- **`producto_padre_id`** (NULL=madre/standalone · con valor=hijo) + **`variante_diferenciador`**
  (valor que distingue al hijo, ej. "Rojo / M", único entre hermanos).
- **Nombre:** vive en la madre. El hijo lleva `madre.nombre — diferenciador`, compuesto por trigger
  BEFORE `trg_variante_compose_nombre` y propagado por trigger AFTER `trg_variante_propagar_nombre` al
  renombrar la madre — así todo consumidor sigue leyendo `productos.nombre` sin cambios.
- **Guards:** solo 2 niveles (un hijo no puede ser padre); no self-parent; chequeo explícito de tenant
  (defensa service_role además del RLS). Una madre CON hijos = **agrupador no vendible** (se DERIVA
  `EXISTS hijos`, sin flag): el POS la excluye (`.not('id','in',madreIds)` + guard en el scan).
- **Migración:** grupos con ≥2 productos → una madre (agrupador, precio 0, sku `VAR-*`) + los productos
  pasan a hijos con diferenciador (de `variante_valores` o del nombre). Idempotente (`producto_padre_id
  IS NULL`). Grupos de 1 producto → standalone. `producto_grupos`/`grupo_id`/`variante_valores`
  DEPRECADOS (no dropeados). "Atributos de variante" (talle/color a nivel LPN) COEXISTE (decisión Eje A).
- **UI:** `ProductosPage` vista agrupada por `producto_padre_id` (sacado el panel "Grupos" +
  `ProductoGrupoModal`, ahora código muerto); `ProductoFormPage` sección "Variantes" (madre→hijos,
  hijo→madre+hermanos, "Crear variante" que agrega un hijo — bloquea si el standalone tiene stock,
  esa reasignación es Fase 4).
- **Verificado:** `migration-reviewer` (encontró bug bloqueante de idempotencia + cerró guard de 3
  niveles + tenant, corregidos) · tsc · build · e2e `109` (2/2: composición + propagación + guards).

## 🆕 Rediseño UoM — Fase 2-bis: tiers de precio mayorista con operador (mig 306, EN PROD) — 🛑 PLATA

Tras las **respuestas finales de Fede (2026-07-24)** el eje precio/venta se reencauzó: el precio vive
**solo a nivel de unidad + tiers de cantidad** (sin overrides por presentación — la Estructura es
logística pura), y para "vender un pallet" se usa un tier de cantidad, no un precio de bulto.

- **`producto_precios_mayorista` (mig 306)** gana **`operador`** ('>','<','=','>=','<=', default '>=')
  + **`orden`**. Resolución: se evalúan en `orden` asc, gana el **primer match**; si ninguno, precio
  base por unidad. La cantidad comparada es el **TOTAL del SKU en el carrito** (agregación por SKU, no
  por línea — el precio mayorista es por volumen). Permite reglas cerradas como "= 800 (un pallet)".
- 🛑 **Bug de plata que encontró el `migration-reviewer`:** el POS viejo resolvía "gana el de MAYOR
  cantidad_minima satisfecho" (last-match); con el algoritmo nuevo de first-match, el backfill de `orden`
  se hace **DESC** por cantidad_minima para reproducirlo (si no, comprar 60 con tiers 10→$90/50→$80
  cobraría $90 en vez de $80).
- Lógica pura `src/lib/tiers.ts` (`precioTier`/`matchTier`/`mejorPrecioMayorista`, 10 unit tests). POS
  (`VentasPage`): `precioTierBase` suma la cantidad del SKU en todo el carrito + resuelve por operador;
  **`descEstadoDe`** recalcula el descuento por estado con el precio vigente (fuente única para plata +
  venta_items + ticket — Regla #0). Ficha: dropdown de operador + persiste `orden`=índice.
- **Verificado:** `migration-reviewer` (fix del backfill DESC) · tsc · build · 10 unit · e2e `110`
  (persistencia de operador+orden desde la ficha, DB real).

> **🆕 Extendido en migs 329/330 (EN DEV, sin deploy):** `producto_precios_mayorista` gana
> `tipo_valor` ('precio_fijo'|'pct') + enlace opcional `presentacion_id` a una línea del árbol de
> empaque, para el "caso del pallet" del backlog de Fede 25/7 — ver
> [[wiki/features/precios-tiers-empaque]].

---

## 🆕 Rediseño UoM — Fase 2-bis chunk 2: empaque sin precio + árbol genealógico (mig 307, EN PROD) — 🛑 PLATA

Reencauza la Fase 2 (mig 304) con el modelo final de Fede: **el empaque es logística pura, sin precio
propio**. Vender "2 cajas" en el POS queda como **conversión de cantidad** (2 × factor_base unidades base);
el precio sale siempre de la unidad base + tiers.

- **DROP de overrides:** se eliminan `precio_venta`/`precio_costo` de `producto_presentaciones` Y de
  `producto_estructura_niveles`. El precio de una presentación es SIEMPRE `productos.precio_venta` (unidad
  base) × `factor_base`. El "precio por bulto/volumen" es un TIER (mig 306), no un override de presentación.
- **Árbol genealógico:** `producto_presentaciones` gana `padre_linea_id` (self-FK **NO ACTION** = guard de
  borrado-con-hijos que igual deja pasar el wipe del rebuild en 1 statement) + trigger `trg_pp_no_ciclo`
  (ciclo + mismo-producto + self-parent) + `UNIQUE(producto_id, orden)`. En Fase 2-bis los niveles siguen
  siendo cadena lineal (hermanas bloqueadas hasta Fase 5): el padre = la presentación de orden inmediatamente
  menor; la base tiene padre NULL.
- **H2:** `fn_rebuild_presentaciones` setea la etiqueta de la presentación base = `productos.unidad_medida`
  (el nivel base de la Estructura deriva de la UdM de la ficha, una dirección).
- **Frontend:** `precioPresentacion(base, factor)` sin override (estructuras.ts); POS (`VentasPage`)
  `seleccionarNivelUom` NO toca `precio_unitario`, solo la cantidad; editor de estructura (ProductosPage) sin
  inputs de precio por nivel; ProductoFormPage + Importador sin columnas `estr_precio_*`.
- **Verificado:** `migration-reviewer` (FK NO ACTION vs wipe del rebuild, ciclo en el UPDATE multi-fila,
  linkeo del padre, idempotencia) · DB real (de 22 productos con override, 20 eran E2E/Test; los reales ±2¢
  por redondeo del precio/unidad) · tsc · build · unit `estructurasPrecio`/`estructuras` reescritos · e2e
  `102`/`103`/`104`/`105` reescritos al nuevo modelo + `110`.

## 🆕 Rediseño UoM — Fase 1-bis: catálogo completo de unidades físicas + enable/disable + presets (mig 308, EN PROD)

Decisión B2/H1 de Fede: Config→Inventario→"Unidades" = catálogo COMPLETO de físicas con enable/disable por
tenant + presets por rubro; los nombres de empaque salen de esa pantalla.

- **Catálogo (mig 308):** de 11 a **27 unidades** — métrico + imperial (onza, libra, galón US, pulgada, pie,
  yarda, milla) + **familia nueva 'area'** (m²/cm²/ha/km²; se relaja el CHECK de `familia`) + docena/millar.
  Comunes activas, imperial/raras inactivas por default. El seed setea `activo` explícito y se re-corre con
  `ON CONFLICT DO NOTHING` → no pisa el `activo` toggleado por el tenant.
- **enable/disable por tenant:** toggle `activo` por unidad en la config (la **base de familia no se apaga**
  — es el ancla de conversión). El selector de la ficha y el POS solo muestran las activas.
- **Presets por rubro:** `PRESETS_RUBRO` (8 rubros, dato de UI puro — el rubro no es campo del tenant); el
  botón ACTIVA (aditivo) las unidades del rubro.
- **"Nombres de empaque" → pestaña nueva "Empaque"** (invSubTab); "Unidades" queda solo con físicas.
- **Frontend:** lib `FamiliaFisica`+'area', `FAMILIAS_FISICAS`, `PRESETS_RUBRO`, `UnidadFisica.activo`.
- **Verificado:** `migration-reviewer` (cazó que el mirror `FamiliaFisica` sin 'area' crasheaba el form de
  producto → corregido antes de aplicar; idempotencia, CHECK, factores exactos) · DB real (27 unidades, 1
  base por familia, sin colisiones custom) · tsc · build · 15 unit · e2e `111`.

**▶ Falta (Fase 4 + 5):** Fase 4 = stock decimal en **unidad atómica entera** (gramos/mL/mm, sin migrar
columnas — decisión Fede) + E3 (cambio de UdM: same-family gratis, cross-family bloqueado con stock) +
stock "sin variante asignada" + guards de borrado multi-sucursal (lo más Regla #0). Fase 5 = operar por
presentación (recibir eligiendo línea del árbol, habilitar hermanas) + limpieza de tablas deprecadas.

**🛑 Al deployar a PROD:** verificar back-calc/deltas de override contra datos REALES de PROD (mig 307) +
frontend en el mismo deploy + regenerar `schema_full.sql` (needs `SUPABASE_ACCESS_TOKEN`) + query de
colisión de nombres custom (mig 308).

## 🆕 Rediseño UoM — Fase 4: stock "sin variante asignada" + borrado multi-sucursal + E3 (mig 309, EN PROD) — 🛑 MUEVE STOCK

Cuando a un producto standalone **con stock** se le crea la primera variante, ese producto pasa a
ser **madre agrupadora**: deja de ser vendible (el POS excluye a las madres desde la Fase 3) pero su
stock **sigue existiendo y contando en inventario**. Ese es el stock **"sin variante asignada"**:
visible y contable, pero **no vendible** hasta repartirlo. Hasta la Fase 4 la UI directamente
**bloqueaba** crear la primera variante si había stock; ahora se permite, avisando.

**`fn_reasignar_stock_variante(madre, jsonb)`** reparte ese stock entre los hijos:

- Todo en **UNA transacción**, con las líneas bloqueadas `FOR UPDATE` en orden determinístico
  (dos usuarios reasignando el mismo LPN hacen cola, no deadlock).
- **Línea entera a un solo hijo** → se **RE-APUNTA** el `producto_id` de la línea: es la misma caja
  física, conserva su LPN y su etiqueta (no hay que re-etiquetar nada).
- **Parcial** (o repartida entre varios hijos) → se descuenta del origen y nace una línea nueva
  heredando ubicación / estado / lote / vencimiento / costo / `parent_lpn_id`; si el origen queda
  en 0 se **desactiva** (que ningún picker lo ofrezca como disponible).
- **Par de `movimientos_stock` por asignación** (salida de la madre + entrada del hijo) → **neto
  CERO**, todo trazado.
- **Guards:** serializados (hay que elegir QUÉ serie va a cada hijo → fase futura), líneas con
  unidades reservadas para un pedido, LPN contenedor con hijos, sobre-asignación, y destino que no
  es hijo de esa madre.

**Tipo de movimiento nuevo: `reasignacion_variante`.** ⚠ **No se reusó `ajuste_rebaje` a propósito:**
el Dashboard de Inventario cuenta los `ajuste_rebaje` del mes como **MERMAS**, así que reasignar
habría inflado la merma con una pérdida que no existió. El tipo nuevo no matchea ningún filtro de
KPI (merma / rotación / runway) — correcto, porque el neto de la operación es cero. Aparece en el
Historial con el badge **"Reasignación"**.

**🛑 Bug latente que destapó la reasignación (sync de marketplaces).** Cambiar el `producto_id` de
una línea nunca había pasado en la práctica, y los dos triggers de sync estaban mal preparados:

- **TiendaNube**: `trg_tn_stock_sync` escuchaba solo `UPDATE OF cantidad, cantidad_reservada,
  activo` → el re-apuntado **no disparaba el trigger**, ni para la madre ni para el hijo.
- **MercadoLibre**: el trigger sí disparaba, pero `fn_enqueue_meli_stock_sync` solo encolaba
  `NEW.producto_id` → el lado de la **madre** (que bajó a 0) nunca se sincronizaba.

En ambos casos el listado publicado quedaba con stock viejo → **riesgo de sobreventa**. Las dos
funciones encolan ahora **los dos productos** cuando `producto_id` cambia, y el trigger de TN suma
`producto_id` a su lista de columnas.

**Guard de borrado multi-sucursal.** El bloqueo server-side ya existía (`fn_producto_tiene_actividad`
chequea `inventario_lineas`); lo que faltaba era **explicarlo**. `fn_stock_por_sucursal(uuid[])`
devuelve el desglose y el cartel pasa de un genérico *"tiene actividad"* a **nombrar la sucursal**:
estar parado en la Sucursal A con 0 no alcanza si la B todavía tiene 5.

**E3 — cambio de unidad de medida física.** Dentro de la **misma familia** (kg ↔ g) es **libre**: el
stock se guarda en la unidad atómica de la familia, así que cambiar la unidad de la ficha solo cambia
cómo se MUESTRA. **Cruzar de familia** (kg → litros) **con stock ≠ 0 se bloquea** por trigger
(`trg_productos_udm_familia`): no existe conversión universal peso↔volumen, las cantidades guardadas
pasarían a significar otra cosa.

- **🔢 Serializados: SOPORTADOS (mig 313, v1.145.0).** En un producto con número de serie el reparto se
  hace eligiendo **a qué variante va cada serie**, no por cantidad: cada unidad ES una serie concreta y
  su historial (garantía, RMA, recall) tiene que quedar bajo el SKU correcto. Las series **ya vendidas
  no se tocan** — quedan con el producto con el que se vendieron. En serializados nunca se re-apunta el
  LPN: nace uno nuevo (si se re-apuntara, las series vendidas quedarían colgando de un LPN de otro
  producto). El guard de la mig 312 se levantó al quedar resuelto el caso.
- **Lógica pura:** `src/lib/reasignacionVariante.ts` (16 unit). **UI:** `ReasignarStockVarianteModal`
  + aviso en la ficha del agrupador + badge *"N sin variante asignada"* en la lista de productos.
- **e2e `112`**: verifica que 17 unidades entran y 17 salen (6+4 partiendo un LPN, 7 re-apuntando
  otro), que el LPN entero conserva su etiqueta, que el partido queda desactivado en 0, el par de
  movimientos, y los 3 rechazos server-side.

## 🆕 Rediseño UoM — Fase 5: presentaciones = FUENTE DE VERDAD + hermanas + limpieza (migs 310/311, EN PROD)

Se **invierte la fuente de verdad del empaque**: `producto_presentaciones` deja de ser un espejo
derivado por trigger de `producto_estructura_niveles` y pasa a ser la **tabla que manda**.

**Por qué:** la cadena lineal no puede expresar **HERMANAS** — dos presentaciones del mismo tipo de
empaque con factores distintos, *"Caja-12"* y *"Caja-10"* del mismo producto (pedido explícito de
Fede). Lo impedía `UNIQUE (producto_id, nombre_empaque_id)`, que se levanta. Sigue vigente
`UNIQUE(producto_id, etiqueta)`: lo que tiene que ser único es el **nombre visible**.

**Backfill (mig 310), verificado contra datos reales de DEV:**

- **0 conversiones perdidas** · **314/314 productos** con su presentación base · 0 árboles
  incoherentes. `unidades_base` del nivel ES el `factor_base` de la presentación (mismo número).
- Se **RECUPERARON** las estructuras no-default, que hasta hoy eran letra muerta (el rebuild solo
  miraba la default): *Leche La Serenísima 1L* quedó con **Caja-12 → Pallet-216** y su hermana
  **Caja-10 → Pallet-360**; *Cellulse Rolling Paper* con **Caja-20** y **Caja-15**.
- Las etiquetas se desambiguan solas con el factor cuando colisionan (`Caja` → `Caja-10`).

**`fn_presentaciones_guardar(producto, jsonb)`** reemplaza a `fn_estructura_guardar_niveles`. El
padre se referencia por **índice ANTERIOR del array** → el árbol **no puede tener ciclos por
construcción**. Valida: una sola base con factor 1, etiquetas únicas, y que cada hijo sea **más
grande que su padre** y un **múltiplo entero** de él (un empaque contiene un número entero de su
empaque hijo; 3 cajas y media no existe).

**`trg_productos_presentacion_base`** siembra la presentación base de todo producto nuevo y mantiene
**H2** (la etiqueta de la base sigue al campo "Unidad de medida" de la ficha).

**UI:** el CRUD de "Estructuras" (varias por SKU, cada una con su cadena) se reemplaza por el
**`PresentacionesEditor`**: UN árbol por producto, donde cada línea declara **de cuál cuelga** y
**cuántas contiene** ("Pallet = 18 × Caja"). Inventario (ingreso/rebaje/masivo), Recepciones, el
modal de LPN y el Importador leen las presentaciones vía el adaptador `presentacionesComoNiveles`,
que mapea `factor_base → unidades_base` sin tocar la aritmética ya probada.

**📐 Medidas por nivel (v1.150.0, ✅ PROD desde 2026-07-29).** Cada línea del árbol tiene además **peso / alto /
ancho / largo**, y el editor muestra el volumen que sale de ellas. ⚠ Esas columnas existen desde la
mig 310 y el pipe de datos estaba **completo** (la RPC `fn_presentaciones_guardar` las acepta,
`presentaciones.ts` las lee y las valida) — pero **el editor no tenía los `<input>`**, así que
estuvieron siempre vacías. Se cargan del **bulto cerrado**, no de su contenido: una caja de 12 pesa
más que 12 unidades sueltas porque incluye su embalaje, y ocupa lo que ocupa la caja. Con el
**cubicaje** activo (`tenants.cubicaje_habilitado`) dejan de ser opcionales:
`validarPresentaciones(rows, exigirMedidas)` las exige en la UI y el trigger
`trg_presentaciones_exige_medidas` las exige en la DB. Ver [[wiki/features/wms]] → "Cubicaje
volumétrico opt-in".

**Limpieza (mig 311):**

- Se **dropean** `producto_grupos`, `productos.grupo_id` y `productos.variante_valores` (modelo viejo
  de variantes, mig 120 — reemplazado por madre/hijo en la mig 305). El único producto que no se
  había migrado (un grupo de 1 producto) conserva su dato en `notas`. Se borra `ProductoGrupoModal.tsx`.
- Se **revoca** `fn_estructura_guardar_niveles` de `authenticated`: dejarla viva permitiría "guardar
  bien" una conversión que ya nadie lee → drift silencioso.
- **`producto_estructuras` / `producto_estructura_niveles` NO se dropean**: `inventario_lineas.estructura_id`
  las referencia como **histórico de recepción**; borrarlas sería perder trazabilidad (Regla #0).
  Quedan solo-lectura, marcadas como deprecadas.

**🛑 Bug de plata que cazó el e2e al migrar.** El POS decidía si una línea se vendía "en unidad
suelta" comparando `nivelSeleccionadoOrden === 1`. Eso era cierto mientras la base venía de
`producto_estructura_niveles` (siempre orden 1); con el árbol la base es **orden 0** y el orden 1 es
la primera **Caja** → vender "1 Caja" se registraba como venta en UoM base y **se le aplicaban los
combos configurados solo para la unidad suelta**. Se reemplazó por el flag `es_base`
(`vendiendoEnBase()`): un ordinal nunca debería gobernar una decisión de plata.

- **Lógica pura:** `src/lib/presentaciones.ts` (23 unit). **e2e `99`** (reescrito): hermanas
  conviven, el árbol resuelve factores, y **5 negativos server-side** (hijo más chico que el padre,
  no-múltiplo, dos bases, etiquetas repetidas, base con factor ≠ 1) dejan el árbol intacto.

**🆕 Agrupación visual por nivel + tipo de empaque (migs 328, EN DEV, sin deploy — backlog Fede
25/7, puntos 4 y 6, puro UI/informativo, sin Regla #0).** `PresentacionesEditor` agrupa las líneas en
burbujas por **profundidad** respecto de la base ("NB · Nivel Base" / "Nivel 1" / "Nivel 2"...),
hermanas ordenadas de menor a mayor cantidad de unidades base; una línea nueva con el mismo tipo de
empaque que otra ya cargada se ubica automático como hermana. `unidades_medida.tipo_empaque`
(texto libre, sin CHECK) es una categoría puramente informativa/reportes que **no** se cruza con el
enlace tier↔empaque (ese usa `producto_presentaciones.id`). Detalle completo, y el resto de la
iniciativa (Fases A y B ya construidas, C/D/E pendientes) en
[[wiki/features/precios-tiers-empaque]].

---

# Estructuras de producto con niveles dinámicos por UdM (⚠ DEPRECADO en la Fase 5 — solo lectura histórica)

> **⚠ Deprecado (mig 310/311).** Lo que sigue describe el modelo de **estructuras con cadena lineal**
> (migs 282-283), que dejó de ser la fuente de verdad del empaque: ahora manda
> `producto_presentaciones` (árbol genealógico, ver Fase 5 arriba). Las tablas se conservan porque
> `inventario_lineas.estructura_id` las referencia como histórico de recepción, pero la app ya no las
> escribe y `fn_estructura_guardar_niveles` no tiene GRANT a `authenticated`. Se mantiene esta
> sección como referencia de lo que hay en los datos viejos.

Modelo estilo **pack structure / footprint de Blue Yonder** (pedido GO 2026-07-19): por cada SKU
podía haber **varias estructuras** (una default), y cada estructura tenía **N niveles dinámicos**
⚠ *(en la Fase 5 esto se unificó en UN árbol por producto con hermanas, ver arriba)*, donde cada nivel
era una **unidad de medida del tenant** con factor de conversión, peso y
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

## Precio por Unidad de Medida (backlog Fede 4/6/7) — Fase 1 modelo + Fase 2 venta + Fase 3 importador, TODAS EN PROD (deploy real 2026-07-22, PR #297)

### ✅ Fase 1: modelo (migs 286-287)

Relevamiento a fondo de los puntos 4/6/7 del backlog de Fede (2026-07-21) antes de codear: hoy
**no existe ningún camino de venta o rebaje de stock en una UoM distinta a la base** del producto
— `convertirABase()` (ver arriba) es código MUERTO, escrito de antemano para una fase futura y
todavía sin ningún invocador. Por el tamaño del cambio se decidió fasear: **esta entrega (v1.140.0)
es SOLO el modelo de datos + la carga de precio por nivel + el "ancla de precio", sin tocar
todavía POS/facturación/combos.**

### Modelo (mig 286) — ⚠ SUPERADO

> **⚠ Histórico.** Todo lo que sigue en esta subsección (precio propio por nivel + "ancla de precio"
> `nivel_precio_orden`) **ya no existe**: la Fase 2 (mig 304) eliminó el ancla y el chunk 2 (mig 307)
> dropeó los overrides de precio de nivel/presentación. Hoy el precio vive **solo en la unidad base +
> tiers de cantidad** (mig 306) y el empaque es logística pura. Se conserva para entender los datos y
> las decisiones viejas.

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

UAT §42 · e2e 102.

### ✅ Fase 2: vender por UoM en el POS (v1.141.0, misma sesión)

La Fase 2 se implementó en la misma sesión, inmediatamente después de la Fase 1 — el carrito del
POS **ya puede vender "por Caja"** usando el precio de ese nivel. `venta_items.cantidad` sigue
siempre en unidades base (stock/rebaje/margen sin cambios); `unidad_medida_id`/`cantidad_uom`
trazan qué UoM se vendió. Detalle completo (selector, precedencia sobre tier mayorista, fix de un
bug real en el agrupador de combos, UoM en el ticket/factura) en
[[wiki/features/ventas-pos]] → "Venta por Unidad de Medida". UAT §43 · e2e 103, 104.

### ✅ Importador de productos con precio por nivel (v1.142.0) — CIERRA el pendiente

Continuación de la sesión anterior: `ImportarProductosPage.tsx` gana columnas opcionales en la
plantilla Excel:

> **⚠ Histórico (mig 307).** Las columnas de precio del importador (`estr_precio_ancla`,
> `estr_precio_venta_caja`, `estr_precio_costo_caja`, `estr_precio_venta_pallet`,
> `estr_precio_costo_pallet`) **fueron ELIMINADAS**: el empaque no lleva precio. Hoy el importador
> solo acepta `estr_unidades_por_caja` / `estr_cajas_por_pallet` + peso/dimensiones, y desde la Fase 5
> (mig 310) escribe directo en `producto_presentaciones` vía `fn_presentaciones_guardar`.

- **`estr_precio_ancla`** (`Unidad`/`Caja`/`Pallet`, case-insensitive) — setea
  `productos.nivel_precio_orden` buscando el nivel por NOMBRE en la estructura que la fila termina
  generando (se resuelve al ORDEN real, no al nombre — mismo motivo por el que el ancla es por
  orden y no por FK, ver arriba).
- **`estr_precio_venta_caja`** / **`estr_precio_costo_caja`** / **`estr_precio_venta_pallet`** /
  **`estr_precio_costo_pallet`** — precio propio opcional por nivel; si no se carga, se calcula
  proporcional al ancla (mismo `precioEfectivoNivel()` de la Fase 1, sin cálculo nuevo).
- El nivel **BASE (Unidad)** nunca recibe precio propio desde el importador — siempre deriva de
  `precio_venta`/`precio_costo` de cabecera del producto, igual que la ficha manual
  (`ProductoFormPage`/`ProductosPage`).
- **Validación en la previsualización**: una fila con `estr_precio_ancla=Caja` pero SIN ningún dato
  de estructura de Caja en esa misma fila se marca como error y **nunca se intenta importar** (se
  descarta antes de tocar la DB).

**🛑 Bug crítico encontrado y arreglado en la misma sesión, NO relacionado con el pedido — el
importador de productos NUNCA funcionó.** Escribiendo el e2e de verificación (spec 105, con chequeo
REAL en DB en vez de solo UI) se descubrió que el payload de insert/update de `productos` siempre
mandaba un campo `notas` que **no existía como columna** (ninguna migración la había creado nunca).
PostgREST rechazaba el INSERT/UPDATE **COMPLETO** (`PGRST204: Could not find the 'notas' column`),
pero el código nunca revisaba el `error` de la respuesta — solo desestructuraba `data` — así que el
importador reportaba "X creados" mientras la tabla de productos quedaba en **CERO filas nuevas**.
Confirmado con inserts directos por REST (con `notas`→400; sin `notas`→201 OK) y con SQL directo
contra DEV (cero filas de los productos de prueba tras varias corridas "exitosas" según la UI).

**Fix:** mig **288** agrega `productos.notas` (columna que la plantilla/UI ya pedían — era la
intención original, nunca se creó) + el importador ahora revisa el `error` real de cada
insert/update (ya no infla `creados`/`actualizados` a ciegas) y muestra el detalle de las filas
fallidas (`erroresDetalle`) en el banner de resultado. **Mismo patrón de riesgo** (ignorar `error`)
se encontró y corrigió por prevención en `ImportarMasterPage.tsx` (combos, reglas de aging, grupos
de estados, categorías/proveedores/ubicaciones/estados/motivos) — ahí NO había una falla activa
confirmada (se verificó por SQL que todas sus columnas usadas sí existen), pero el mismo
código-olor estaba presente en las 4 ramas.

Verde: tsc · build · **e2e 105 nuevo** (`105_importador_precio_uom_mutante.spec.ts`) contra DEV real
con verificación POSITIVA en DB: precio propio por nivel persiste tal cual (sin recalcular), ancla
por nombre persiste `nivel_precio_orden`, fila con ancla inválida se rechaza y nunca se crea. Sin
este spec el bug de `notas` no se hubiera detectado — la UI mentía "2 creados" de forma consistente
y convincente. `APP_VERSION` = v1.142.0 (commit `ae5f63b1`). **EN PROD desde el 2026-07-22** (PR
#297 mergeado a `main`, mig 288 aplicada en PROD, Vercel confirmado con curl sirviendo v1.142.0).

### Roadmap de precio por UoM (backlog Fede 4/6/7 — numeración propia, distinta del roadmap de fases de abajo)

| Fase | Qué | Estado |
|---|---|---|
| **1** | Modelo: precio propio por nivel + ancla de precio (`nivel_precio_orden`) | ✅ v1.140.0 (migs 286-287) |
| **2** | Vender por UoM en el POS + combos por UoM + UoM en factura/ticket | ✅ v1.141.0 |
| **3** | Importador de productos con precio por nivel + fix crítico (`notas`) | ✅ v1.142.0 (mig 288) |

**Con esto los 7 puntos del backlog de Fede quedan 100% completos a nivel código** (puntos 3, 4, 6
y 7 de punta a punta; puntos 1/2 en pausa esperando que GO confirme con Fede; punto 5 cerrado sin
código). **Las 4 entregas de la sesión (v1.139/140/141/142) llegaron a PROD el 2026-07-22** (PR
#297, migs 284-288 aplicadas, ver [[wiki/business/roadmap]] y [[wiki/database/migraciones]]).

---

## Fase 2: Operar por UdM al ingresar y rebajar stock (✅ v1.143.0, mig 293 — EN DEV, sin deploy a PROD)

GO pidió cerrar el único pendiente que quedaba del roadmap (2026-07-22, misma sesión de "Pedidos" y
de los fixes de picking mig 291), y también **extenderlo a rebajes** (no solo ingreso) — simple y
masivo, para ambos.

### Modelo (mig 293)

- `inventario_lineas.unidad_medida_id` (FK `unidades_medida`) + `.cantidad_uom` (numeric) — UdM en la
  que se **recibió** ese LPN puntual (permanente, se fija al ingresar). `cantidad` de la línea sigue
  SIEMPRE en unidades base.
- `movimientos_stock.unidad_medida_id` + `.cantidad_uom` — UdM de la **operación puntual** (ingreso o
  rebaje). Necesita ser una columna aparte de la de arriba porque un rebaje puede consumir de varios
  LPNs con distinta UdM de origen — acá se traza en qué UdM lo tecleó el usuario para ESA operación,
  no depende de una sola línea.
- Ambas nullable (NULL cuando el producto no tiene estructura multi-nivel, sigue operando en unidad
  base sin cambio de comportamiento), con `CHECK (cantidad_uom IS NULL OR cantidad_uom > 0)` — el
  subagente `migration-reviewer` marcó que faltaba (mismo patrón que `venta_items.cantidad_uom` de la
  mig 286) antes de aplicar.
- **`convertirABase()` en `src/lib/estructuras.ts` YA EXISTÍA desde Fase 1** ("lista para Fase 2",
  comentario en las migs 282/283, código muerto hasta esta sesión) — el cálculo no es nuevo, esta
  migración solo agrega DÓNDE trazar qué UdM se usó.
- Helper nuevo **`nivelDefaultParaProducto()`** en `src/lib/estructuras.ts` — matchea
  `productos.unidad_medida` (texto libre, mismo gotcha ya conocido de la sección de arriba) contra el
  nombre de un nivel de la estructura para preseleccionar el default (pedido explícito de GO: "toma
  como default la UdM cargada en el producto"). 3 tests nuevos, 25 tests totales en
  `tests/unit/estructuras.test.ts`.

### UI — wireado en 4 superficies

- **Ingreso simple y Rebaje simple** (`InventarioPage.tsx`, modal clásico "Ingreso"/"Rebaje"):
  selector "Cargar en: / Rebajar en:" (pill buttons) que aparece cuando el producto tiene una
  estructura default con más de 1 nivel — tiene **precedencia sobre el toggle genérico kg/g** que ya
  existía (mecanismo distinto y previo, sin relación con las estructuras del producto — no confundir
  los dos).
- **Ingreso masivo** (`InventarioPage.tsx`, flujo INLINE `masivoInline`/`masivoRows`): selector
  compacto (`<select>`) por fila. **Dato no obvio a recordar:** este flujo INLINE es un componente
  separado y más nuevo que reemplazó al uso de `MasivoModal.tsx` para ingreso — **`MasivoModal.tsx`
  hoy solo se usa para Rebaje masivo.**
- **Rebaje masivo** (`src/components/MasivoModal.tsx`): mismo patrón de pills que los simples.
- `inventario_lineas.estructura_id` (de Fase 1) se usa para saber con qué estructura se ingresó CADA
  LPN puntual — el selector de rebaje usa la **estructura del LPN específico elegido**, no la default
  genérica del producto (más preciso que asumir siempre la misma estructura).

**🐛 Bug real encontrado y arreglado durante las pruebas:** el texto de ayuda ("= 18 caja") mostraba
mal el nombre de la unidad porque usaba `productos.unidad_medida` (campo de texto libre — puede no
matchear el nivel real de la estructura) en vez del nombre real del nivel base de la estructura. En
el producto real de prueba, `unidad_medida` literalmente decía "caja" aunque la estructura tiene
"Unidad" como base — mostraba "= 18 caja" en vez de "= 18 Unidad". Corregido en las 3 superficies que
ya estaban wireadas cuando se encontró (ingreso simple, rebaje simple, rebaje masivo vía
`MasivoModal.tsx`), usando el nombre real del nivel[0] de la estructura.

**Verificación:** build + tsc + **1180 tests unitarios** (80 archivos) verdes. Probado en vivo en
navegador (Playwright contra dev server real) para **ingreso simple y rebaje simple**, contra el
producto real de GO (Bebida Coca Cola 2.5L, Almacén Jorgito) — verificado en base de datos real:
`cantidad_uom`, `unidad_medida_id`, `cantidad` (unidades base correctas), `movimientos_stock` con la
misma traza, `productos.stock_actual` recalculado bien por el trigger existente. Datos de prueba
limpiados, stock devuelto a su valor original (114) después de cada prueba. **Ingreso y rebaje masivo
NO se probaron clickeando en el navegador** (sí typecheck+build) — queda pendiente que GO los pruebe o
pedirlo en la próxima sesión. `APP_VERSION` sigue v1.143.0 (sin bump, sin release). Mig 293 aplicada
solo en DEV, **sin commitear al cierre de la sesión.**

---

## Roadmap del plan (acordado con GO 2026-07-19)

| Fase | Qué | Estado |
|---|---|---|
| **1** | Niveles dinámicos por UdM (modelo + RPC + UI + backfill) | ✅ v1.137.0 (migs 282-283) |
| **2** | Operar por UdM al ingresar stock (recibir "5 cajas" → 60 unidades; UdM trazada en el LPN; stock SIEMPRE en unidad base) — extendido también a REBAJES (simple y masivo), pedido explícito de GO | ✅ v1.143.0 (mig 293) |
| **3** | **Zonas** (nueva entidad que agrupa ubicaciones) + **reglas de almacenaje** por UdM → zona/ubicación, con **sugerencia editable** al ingresar (no bloquea) | ✅ v1.143.0 (mig 289) |
| **4** | Tareas WMS (`wms_tareas`) + **picking por UdM** (listas que respetan FIFO/FEFO de `rebajeSort` y sugieren "2 cajas" en vez de "24 unidades") | ✅ v1.143.0 (migs 289-290) |
| **5** | **Reabastecimiento** reserva → posición de surtido/picking (mín/máx por producto+ubicación con UdM de reposición; generación on-demand + al confirmar picking — sin pg_cron) | ✅ v1.143.0 (migs 289-290) |

**Las 5 fases del roadmap quedan ✅ completas a nivel código y ✅ EN PROD desde v1.144.0** (migs
289-290, 293). Detalle completo del
schema/RPCs/UI implementado de Fases 3-4 (bastante fiel al sketch original de `wms_tareas`, con 2
columnas agregadas para el encadenamiento real — `envio_id` y `tarea_precedente_id`, que no estaban
en el sketch): [[wiki/features/wms]] → "Fase 3" y "Fase 4". Detalle de Fase 2: ver arriba.

**🛑 Pivote de arquitectura (2026-07-22, mismo día, ver [[wiki/features/pedidos]]):** el picking/
reabastecimiento de Fases 3-5 (`fn_generar_tareas_picking_envio`) fue diseñado para nacer desde
Ventas/Envíos (venta despachada → tareas WMS) — GO **revirtió esa decisión** el mismo día: "Ventas no
tiene que generar tareas... las tareas deben ser solo para los pedidos." La RPC sigue existiendo
(sería correcta si alguien la invocara a mano) pero **nunca se le agrega ningún gancho desde
`VentasPage.tsx`/`EnviosPage.tsx`** — de acá en más, todo el picking/reabastecimiento nace
**exclusivamente** desde el módulo NUEVO **Pedidos** (`fn_generar_tareas_picking_pedido`, todavía sin
construir, Fase PED3 de [[wiki/features/pedidos]]). No confundir con una reversión del trabajo de
Fases 3-5 — el schema (`zonas`/`wms_tareas`/RPCs de completar tarea) sigue siendo la base que Pedidos
va a usar, solo cambia **quién genera las tareas**.

**🐛 2026-07-22 (mismo día): GO probó el picking/reabastecimiento a mano y encontró 3 bugs reales +
2 gaps de UX**, corregidos vía mig **291** (✅ PROD desde v1.144.0) — detalle completo en [[wiki/features/wms]] → "Fixes de la primera ronda de pruebas
manuales de GO". Eso disparó la discusión de arquitectura sobre si el picking debería depender de una
venta ya despachada o de un futuro módulo "Pedidos" separado — **✅ resuelta la misma sesión, más
tarde ese mismo día**: nace el módulo Pedidos y el pivote F4 (ver arriba, "Pivote de arquitectura").

Decisiones ya tomadas por GO: factor **vs nivel anterior** (estilo BY) · crear **Zonas/Áreas** ·
reglas de almacenaje **sugieren** (no bloquean) · reabastecimiento incluido en el paquete · **picking
es una capa de logística pura, nunca decide qué LPN consume una venta** (sin cambios) · **el picking
ahora nace exclusivamente desde Pedidos, no desde Ventas/Envíos** (pivote F4, ver arriba — supera la
formulación anterior "solo para envíos/despachos, nunca mostrador": ahora ni siquiera los
envíos/despachos de Ventas lo disparan). Abiertas: ¿OC por UdM? · factores siempre enteros (confirmar
si aparece un caso real de fracción).

---

## Links relacionados

- [[wiki/features/wms]] — visión general WMS y fases históricas
- [[wiki/features/pedidos]] — módulo NUEVO que desde el pivote F4 (2026-07-22) es el único origen de
  tareas de picking/reabastecimiento
- [[wiki/features/productos]] — tab Estructura + UdM personalizables + Card 3 (ancla de precio)
- [[wiki/features/inventario-stock]] — asignación de estructura a LPNs · ingreso/rebaje por UdM (Fase 2)
- [[wiki/features/configuracion]] — ABM Unidades de medida
- [[wiki/features/ventas-pos]] — Fase 2 de precio por UoM (✅ v1.141.0) conecta el precio por nivel con
  la venta real
- [[wiki/features/precios-tiers-empaque]] — iniciativa NUEVA (backlog Fede 25/7, EN CURSO) que
  enlaza los tiers mayoristas a `producto_presentaciones` ("el caso del pallet") y agrupa
  visualmente el editor por nivel
- [[wiki/database/migraciones]] — migs 282, 283, 286, 287, 288, 289, 290, 291, 292, 293
