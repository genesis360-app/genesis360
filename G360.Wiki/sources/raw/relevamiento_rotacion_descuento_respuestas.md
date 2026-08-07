---
name: relevamiento_rotacion_descuento_respuestas
description: Respuestas de Fede (+ decisiones técnicas D2/B4/C2/E5 de GO/Claude) al relevamiento del Motor de Rotación de productos con descuento — 3º de 4 relevamientos derivados hacia el módulo Repositores.
type: project
status: ✅ RELEVAMIENTO 100% RESPONDIDO (2026-08-07) — B4/C2/E5 cerrados por GO el mismo día (ya no son gaps). **Opción 1 (agotar antes de reponer), Opción 2 (prioridad de envíos) y Opción 3 (armar kits, E3+E2/E4) tienen EJECUCIÓN REAL construida** (migs 342/343 + código en `AlertasPage.tsx`/`InventarioPage.tsx`/`rebajeSort.ts`/`VentasPage.tsx`/`kits.ts`), 🟡 SOLO EN DEV, sin commitear. ✅ **Opción 2 VERIFICADA end-to-end** (spec 131, encontró y corrigió un bug real de inventario). ✅ **Opción 3: E3 (gap técnico) VERIFICADA end-to-end** (spec 132) — ⚠️ **E2/E4 (autogenerar nombre/precio con autorización) construidos pero SIN VERIFICAR EN NAVEGADOR** — prioridad real de la próxima sesión. **E5 (desarmado de kit) y lo que depende de la Pestaña de supervisor (disparo automático) siguen sin arrancar, a propósito.**
source: relevamiento-rotacion-descuento-reglas-negocio.html
updated: 2026-08-07
---

# Respuestas — Relevamiento Reglas de Negocio · Motor de Rotación de Productos con Descuento

> **Estado:** Fede respondió por escrito el 2026-08-03 ("De Fede para Tonga"). GO compartió la
> respuesta el 2026-08-07. **"Tonga" es GO, no el asistente** (ver [[reference_tonga_es_go]]).
> 3 preguntas habían quedado con una respuesta que no contestaba lo preguntado (Fede contestó algo
> relacionado pero distinto) — **GO las cerró él mismo el 2026-08-07** (B4/C2/E5, ver tablas B/C/E
> abajo) sin repreguntarle a Fede. Con eso, el relevamiento quedó **100% respondido**. La misma tarde
> se avanzó la lógica de EJECUCIÓN real de las Opciones 1 y 2 (mig 342), y en la sesión siguiente,
> mismo día, se verificó la Opción 2 end-to-end (spec 131) y se avanzó la Opción 3 (kits, mig 343): E3
> (gap técnico) verificado end-to-end (spec 132), E2/E4 (autogenerar nombre/precio) construidos sin
> verificar en navegador — ver sección nueva abajo.

---

## ✅ Ejecución real construida — Opción 1 y Opción 2 (2026-08-07)

Con B4/C2/E5 cerrados, se construyó la lógica de EJECUCIÓN (no solo el esquema de configuración de
la mig 341) de las dos primeras opciones. **Migración 342**
(`342_rotacion_motivo_vencimiento_y_helpers.sql`, aplicada en DEV, revisada por `migration-reviewer`
— encontró y se corrigió un problema real antes de aplicar, ver abajo):

- `estados_inventario.motivo_vencimiento boolean NOT NULL DEFAULT false` — distingue estados "por
  vencimiento" de otros motivos (ej. "Dañado"), porque C3 exige que la Opción 1 solo cuente motivo
  vencimiento. Toggle nuevo en Config → Inventario → Estados (ícono reloj ⏰, junto al de "dispara
  Rotación").
- `fn_rotacion_productos_bloqueados_reposicion(p_tenant_id uuid, p_sucursal_id uuid DEFAULT NULL)` —
  devuelve los `producto_id` bloqueados para reposición (regla activa por jerarquía + stock > 0 en
  esa sucursal en un estado que dispara Rotación por motivo vencimiento). Pensada para excluir en un
  solo query, no llamar la función escalar por producto.
- `fn_rotacion_vencimiento_bloqueante(p_producto_id uuid, p_sucursal_id uuid DEFAULT NULL)` — para UN
  producto en UNA sucursal, si está bloqueado y la fecha de vencimiento MÁS LEJANA entre los lotes
  bloqueantes (para comparar contra la fecha del ingreso nuevo).
- **`p_sucursal_id` explícito en ambas** (parámetro, no implícito vía RLS del usuario que llama) —
  GO confirmó (2026-08-07, dato nuevo que no estaba en el relevamiento original) que el bloqueo de
  C2 es **POR SUCURSAL**: el stock por vencer de una sucursal NO bloquea la reposición de otra. Un
  DUEÑO con "ver todas las sucursales" necesita el mismo resultado por-sucursal que alguien acotado a
  una sola.
- 🔒 **Hallazgo real del `migration-reviewer` antes de aplicar:** faltaba `anon` en los `REVOKE` de
  las 2 funciones nuevas — corregido a `REVOKE ALL ... FROM PUBLIC, anon` antes de aplicar, siguiendo
  la convención de hardening del resto del proyecto.

Ambas son de **solo lectura** (`LANGUAGE sql STABLE`), no mueven datos.

### Opción 1 — Terminar stock para reponer (ejecución real)

1. **OC sugerida (`AlertasPage.tsx`)**: los productos con stock por vencer sin agotar **en la
   sucursal activa** se EXCLUYEN de la generación automática de OC (`generarOCsSugeridas`), con badge
   visual "⏳ Rotación: no reponer aún" en la fila de la alerta y el conteo de excluidos en el toast
   de resultado (`... · N con stock por vencer (no repuestos)`).
2. **Ingreso simple (`InventarioPage.tsx`, form "Ingresar stock")**: si se ingresa una fecha de
   vencimiento MÁS LEJANA que la del lote que ya está bloqueando reposición en esa sucursal, se pide
   confirmación explícita vía `confirmar()` (no bloquea duro — puede haber un motivo real para sumar
   stock fresco igual). Sumar MÁS de la MISMA fecha (o antes) no dispara el aviso — coincide con C1.
3. **Pendiente, NO bloqueante para cerrar esto** (decisión consciente de priorizar tiempo, anotado
   como seguimiento): el mismo aviso de fecha **no se extendió todavía** al ingreso MASIVO
   (`MasivoModal`/tab masivo de Inventario) ni a Recepciones (flujo de OC formal).

### Opción 2 — Prioridad en envíos y reservas (ejecución real, ✅ VERIFICADA end-to-end el 2026-08-07)

> **✅ ACTUALIZACIÓN (2026-08-07, sesión siguiente el mismo día):** se verificó en navegador con un
> test e2e permanente (`tests/e2e/131_rotacion_prioridad_envios_mutante.spec.ts`) — **encontró un bug
> real de inventario (Regla de Oro #0)**: la Fase A de `registrarVenta` (`VentasPage.tsx`) consumía el
> plan de LPN precalculado al agregar al carrito (calculado SIN la prioridad de Rotación, porque el
> canal todavía no se conoce en ese momento), sin dejarle nada a la Fase B que sí tenía la lógica
> correcta — la prioridad se calculaba pero nunca se aplicaba. Fix: para productos con la regla activa,
> la Fase A solo respeta lo elegido a mano; el resto queda para la Fase B con el sort correcto. Detalle
> completo en `log.md` (2026-08-07) y `sources/raw/project_pendientes.md` (bloque "ARRANCÁ ACÁ").
>

1. **`src/lib/rebajeSort.ts`**: `getRebajeSort()` suma un 5º parámetro opcional
   `estadoIdsPrioridad?: Set<string> | null` — si se pasa un set no vacío, las líneas cuyo
   `estado_id` esté en ese set se ordenan SIEMPRE primero, antes que cualquier regla
   FIFO/FEFO/LIFO/Manual (que sigue actuando como desempate dentro de cada grupo). 100% compatible
   hacia atrás — sin el parámetro, cero cambio de comportamiento. 4 tests unitarios nuevos en
   `tests/unit/rebajeSort.test.ts`.
2. **`VentasPage.tsx`, dentro de `registrarVenta(estado)`** (el commit real de la venta, no el
   preview del carrito): resuelve si la venta califica como "envío o reserva"
   (`estado === 'reservada' || clasificacionDe(canalPOS) !== 'presencial'`, usando el hook
   `useCanalesVenta` ya existente — más robusto que chequear `origen === 'POS'` a secas, porque
   `ventas.origen` guarda el NOMBRE del canal elegido en el selector del POS, no siempre literal
   "POS"). Si califica, resuelve POR ÍTEM (`fn_rotacion_reglas_efectivas`) si ese producto tiene la
   regla de prioridad de envíos activa, y le pasa el set de estados que disparan Rotación
   (`dispara_rotacion=true` a nivel tenant) a `getRebajeSort`.
3. **⚠️ NO VERIFICADO EN NAVEGADOR en su momento — ✅ COMPLETADO en la sesión siguiente (mismo día),
   ver la nota de actualización arriba.** Se intentó armar una prueba e2e ad-hoc (producto de prueba con 2 lotes — uno
   viejo/normal y otro nuevo pero en un estado de Rotación con prioridad activa —, venta por canal
   "WhatsApp" para calificar como no-presencial) pero se trabó en fricción del arnés de test:
   - el filtro "Ver stock de: Disponible ★" es un GRUPO curado de estados que no incluía el estado de
     prueba nuevo — hay que usar "Todos";
   - hace falta `ubicacion_id` con `disponible_surtido=true` en las líneas de prueba, no alcanza con
     `sucursal_id`;
   - timing raro donde el `<select>` de "Canal de venta" no exponía la opción "WhatsApp" a tiempo
     para `selectOption()`.

   El código está respaldado por: typecheck/build limpios, **1529 tests unitarios verdes** (incluidos
   los 4 nuevos de `rebajeSort`), y composición de piezas ya verificadas por separado
   (`fn_rotacion_reglas_efectivas` probada en vivo, `clasificacionDe` ya en producción) — pero **no
   hay prueba de punta a punta con los propios ojos**. El fixture de prueba se limpió completo (nada
   quedó en DEV).
4. **Sin tocar todavía**: MELI/TiendaNube (los webhooks tienen su PROPIA reserva de stock FIFO plano,
   sin usar `getRebajeSort` en absoluto — necesitarían su propio ajuste en Deno, aparte). Pedidos
   hereda gratis lo que resuelva `registrarVenta` (reusa el mismo LPN, no re-reserva).

### Opción 3 — Armar kits (E3 ✅ VERIFICADA end-to-end, E2/E4 construidos SIN verificar en navegador)

> **✅ ACTUALIZACIÓN (2026-08-07, sesión siguiente el mismo día, cont. 4):** GO ya había decidido el
> enfoque (opción B del menú que se le dio) — construir YA lo que es independiente de tareas/
> reasignación (fix del gap técnico E3 + autogenerar nombre/precio/código del kit, E2/E4), reusando la
> pantalla de Kits existente de forma MANUAL. Esta sesión ES esa construcción. **Migración 343**
> (`343_kits_rotacion_prioridad_y_precio_autorizacion.sql`, aplicada en DEV, revisada por
> `migration-reviewer` — sin hallazgos bloqueantes).

1. **E3** (gap técnico confirmado): `iniciar_armado_kit` consumía FIFO ciego al `estado_id` (reserva
   por `created_at`, ignora si hay stock en descuento). Fix: la RPC resuelve
   `fn_rotacion_reglas_efectivas(comp_producto_id)` por cada componente de la receta y, si
   `armar_kits` está activo, reordena la reserva con
   `ORDER BY CASE WHEN v_armar_kits AND estado_id = ANY(v_estados_rotacion) THEN 0 ELSE 1 END,
   created_at` — el lote en un estado que dispara Rotación se reserva PRIMERO (prioridad, no
   exclusividad, mismo criterio D3 de la Opción 2). Para componentes/tenants sin la regla activa, 0
   cambio de comportamiento. **✅ VERIFICADO end-to-end** con un test e2e PERMANENTE
   (`tests/e2e/132_kit_armado_prioridad_rotacion_mutante.spec.ts`: siembra su propia precondición
   — estado con `dispara_rotacion=true`, componente con `rotacion_armar_kits=true`, KIT con receta
   1:2, dos ingresos reales por UI del componente (uno a "Disponible", uno al estado de Rotación) —,
   dispara el armado desde la UI real (Inventario → Kits → Armar → confirmar), y verifica en la base
   que la reserva salió SOLO de la línea en Rotación (la más nueva), dejando la línea vieja intacta).
   **2 corridas consecutivas verdes contra DEV.**
2. **E2 (parte DB) + E4**: extiende el `CHECK` de `autorizaciones_inventario.tipo` con `'kit_precio'`
   (7mo tipo, reusa la infraestructura existente, mismo patrón que `bulk_edit`, sin RPC
   `SECURITY DEFINER` nueva). Lógica pura nueva `src/lib/kits.ts` (9 tests,
   `tests/unit/kits.test.ts`): `sugerirNombreKit`/`sugerirPrecioKit` (E4: precio de lista × cantidad
   de cada componente, SIN restar descuento — el % de estado lo aplica el mecanismo existente en la
   venta). UI nueva en Inventario → Kits (`InventarioPage.tsx`): bloque "Sugerido según la receta" con
   nombre sugerido (botón "Usar", aplica directo, sin autorización) y precio sugerido
   (DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN aplica directo; otros roles crean una solicitud pendiente en
   `autorizaciones_inventario` tipo `kit_precio`, mismo flujo de aprobar/rechazar que
   `ajuste_cantidad`/`bulk_edit`); `aprobarAutorizacion` extendida para aplicar
   `productos.precio_venta` al aprobar.
   **⚠️ NO VERIFICADO EN NAVEGADOR** — solo unit tests + code review, sin driving real del flujo
   "sugerencia → aprobación → aprobar como supervisor". Si se retoma este módulo, es lo primero a
   probar antes de darlo por cerrado (mismo tipo de gap que tuvo la Opción 2 hasta la sesión pasada).
3. **E5** (desarmado de kit devuelve componentes al mismo estado de descuento) y lo que depende de la
   Pestaña de supervisor (disparo automático de tarea + reasignación) **siguen sin arrancar, a
   propósito** — queda para después de que esa infraestructura exista.

Gotcha de infraestructura, no bloqueante: `npm run schema:dump` volvió a fallar (falta
`SUPABASE_ACCESS_TOKEN`, ver [[reference_supabase_pooler_auth_bug]]); `supabase/schema_full.sql`
parcheado a mano con los mismos 2 cambios de la mig 343.

Verde: tsc · build · **1538 tests unitarios** (97 archivos, 9 nuevos de `kits.ts`).

---

## ✅ Esquema de configuración + UI — CONSTRUIDO EN DEV (2026-08-07)

Con A1-A3/B1-B3/C1/C3/D1-D3/E1-E4/F1-F2/G1-G3 resueltos, se avanzó el esquema de CONFIGURACIÓN y su
UI en paralelo mientras B4/C2/E5 seguían abiertos — a propósito **sin ninguna lógica de EJECUCIÓN**
(nada bloquea reposición, prioriza envíos, ni dispara armado de kits todavía; es solo "guardar la
regla", no "aplicarla").

**Migración 341** (`341_rotacion_descuento_config.sql`, aplicada en DEV, revisada por
`migration-reviewer` — encontró y se corrigió un problema real antes de aplicar, ver abajo):
- Jerarquía de 3 niveles (A3): 4 columnas nuevas (`rotacion_agotar_antes_reponer`,
  `rotacion_prioridad_envios`, `rotacion_armar_kits`, `rotacion_ubicacion_excepcion_id`) en
  `tenants` (default raíz, `NOT NULL`), `categorias` y `productos` (override, `NULL` = usa el nivel
  de arriba).
- Matriz de compatibilidad (A1-c): `CHECK` en las 3 tablas bloquea 1+3 en la misma fila. **Gap real
  que encontró el reviewer**: el `CHECK` por fila NO alcanza a cubrir el conflicto CRUZANDO niveles
  (ej. tenant con regla 1, categoría con regla 3 — cada CHECK individual pasa, pero el resultado
  resuelto por jerarquía da 1+3 activo). Se resolvió con un desempate explícito de solo lectura en
  la función `fn_rotacion_reglas_efectivas` (`agotar_antes_reponer` gana, `armar_kits` se fuerza a
  `false`) — verificado en vivo contra DEV. La validación en ESCRITURA (impedir guardar el conflicto
  cruzando niveles desde el vamos) queda para cuando se construya el flujo de ejecución — revalidar
  todo el árbol de categorías/productos cada vez que cambia el default del tenant es caro/complejo.
- `estados_inventario.dispara_rotacion` (B2) — switch aparte de `descuento_pct`.
- `fn_rotacion_reglas_efectivas(producto_id)` — resuelve la jerarquía SKU→categoría→tenant.
- Guard de mismo-tenant en `rotacion_ubicacion_excepcion_id` (trigger, mismo patrón que
  `padre_ubicacion_id` de Ubicaciones) — verificado que rechaza una ubicación de otro tenant.
- `GRANT`/`REVOKE EXECUTE` explícitos en la función nueva, siguiendo la convención de hardening.

**UI (`ConfigPage.tsx`, Config → Inventario → Rotación, nueva sub-pestaña)**:
- Default a nivel tenant: los 3 toggles (con la matriz de compatibilidad deshabilitando 1↔3 en vivo
  + mensaje de aviso), selector de ubicación de excepción, y el selector de FIFO/FEFO **movido**
  desde la sub-pestaña "Reglas de stock" (G1).
- Tabla de excepciones por categoría: 3 selects (Usa default / Sí / No) + ubicación, por cada
  categoría cargada.
- Toggle `dispara_rotacion` agregado a la sub-pestaña "Estados" (icono 🔄 junto al de aprobación).
- Gateado a `canEdit` (DUEÑO), mismo criterio que el resto de Config → Inventario (G2).
- Probado en navegador real contra DEV (Playwright ad-hoc, no un spec permanente): la pestaña
  renderiza, el toggle de "Armar kits" bloquea visualmente "Terminar stock para reponer" y muestra
  el aviso de la matriz, y se confirmó que el click de prueba no persistió nada en la base (no se
  tocó "Guardar").

Verde: tsc · build · **1525 tests unitarios**.

## A. La pregunta madre

| # | Respuesta de Fede | Resumen |
|---|---|---|
| A1 | (c) — combinables con matriz de compatibilidad fija: **1+2 permitido, 2+3 permitido, 1+3 bloqueado** (no se puede combinar "agotar antes de reponer" con "armar kits" en la misma categoría) | Confirmado. |
| A2 | Orden de aplicación por combinación: **2+3** → primero se arman los kits (el kit conserva la prioridad de envío, misma fecha de vencimiento que el lote original); **1+2** → se aplica 1 primero (no repone mientras queden unidades en descuento) y en paralelo esas unidades se despachan con prioridad por envío/reserva; si no alcanza el stock de depósito para un envío, se toma del stock en góndola próximo a vencer | Confirmado — orden FIJO definido por el sistema (no configurable por tenant), equivale a la opción (a) del documento original. |
| A3 | Jerarquía de especificidad: **SKU → Categoría → Regla general del negocio.** Si el SKU no tiene regla propia, usa la de su categoría; si la categoría tampoco, usa la general | Confirmado — jerarquía de 3 niveles, mismo patrón que `regla_inventario`. |

## B. Qué dispara el motor

| # | Respuesta | Resumen |
|---|---|---|
| B1 | Confirmado — el descuento en la venta sigue igual para (1) y (2). Además: activar la regla (3) debe disparar la tarea correspondiente para quien arma kits en Inventario | Confirmado, conecta con E1. |
| B2 | Confirmado — hace falta un switch aparte de `descuento_pct`: al crear un estado, además del % de descuento, un flag separado para marcar si dispara las reglas automáticas de Rotación | Confirmado — nueva columna en `estados_inventario` (`dispara_rotacion` o similar). |
| B3 | El motor actúa igual sin importar si el estado se activó por el proceso automático de vencimiento (aging) o manualmente | Confirmado, equivale a la opción (a) del documento original. |
| B4 | ⚠️ La respuesta de Fede **no contestaba lo preguntado** (contestó cuáles cambios de estado necesitan aprobación en sí, no cuándo actúa el motor). ✅ **Cerrado por GO el 2026-08-07 (opción a):** el motor actúa recién cuando el cambio de estado queda APROBADO, nunca antes. **Se descubrió que esto YA lo garantiza la arquitectura existente** — `LpnAccionesModal` no toca `inventario_lineas.estado_id` hasta que `aprobarAutorizacion` corre — así que no hizo falta código nuevo, solo que el motor lea el `estado_id` real de la línea (que ya refleja únicamente cambios aprobados o que no necesitaban aprobación) | ✅ **CERRADO.** Ya no bloquea la lógica de EJECUCIÓN. |

## C. Opción 1 — Terminar stock para reponer

| # | Respuesta | Resumen |
|---|---|---|
| C1 | Bloquea específicamente la **sugerencia de reposición** con fecha de vencimiento MÁS LEJANA a la que ya está en descuento. Si hay más inventario disponible con la MISMA fecha (o similar), sí se debe sugerir reponer con eso — no hay problema en sumar más de lo mismo, el problema es mezclar con stock más fresco | Confirmado, con matiz: no es un bloqueo total de la OC sugerida, es condicional a la fecha del inventario a sugerir. |
| C2 | ⚠️ La respuesta de Fede **no contestaba lo preguntado** (aclaró que la sección C aplica solo a VENCIMIENTO, respondiendo el C3 original, no el C2). ✅ **Cerrado por GO el 2026-08-07 (opción a):** "agotado" se mide por LOTE/estado — cualquier cantidad > 0 en el estado con descuento de ESE producto bloquea, sin importar cuánto stock sano conviva en otro estado. Alcance adicional confirmado por GO (no estaba en el relevamiento original): el bloqueo es **POR SUCURSAL**, no a nivel de todo el negocio | ✅ **CERRADO.** Implementado en `fn_rotacion_productos_bloqueados_reposicion`/`fn_rotacion_vencimiento_bloqueante` (mig 342). |
| C3 | El vencimiento manda por sobre todo — productos dañados/reacondicionados no pueden tener prioridad de salida solo porque le conviene al vendedor (riesgo de devolución). El único motivo que prioriza es el vencimiento | Resuelve el C3 original (múltiples estados con descuento simultáneos → solo cuenta el de vencimiento) combinado con la aclaración que Fede puso bajo "C2". |

## D. Opción 2 — Prioridad en envíos y reservas

| # | Respuesta | Resumen |
|---|---|---|
| D1 (+ D2 integrada) | El único canal donde NO aplica: **presencial + venta directa** (cliente se lo lleva ahí mismo). Si es presencial pero es RESERVA (retira después), la regla SÍ corre. Todos los demás canales aplican sin importar venta directa o no. MELI y TiendaNube: **condición extra** — solo cuenta el inventario en ubicaciones habilitadas específicamente para esos canales | Confirmado — regla NUEVA por canal (no es solo FEFO existente), equivale a la opción (b)/(c) combinadas del documento original. |
| D2 (técnica) | **Decisión de diseño de GO/Claude (2026-08-07), sin campo nuevo:** el lote en descuento pierde prioridad SOLO cuando `ventas.origen = 'POS'` Y `estado NOT IN ('reservada','pendiente')` Y sin `pedido_id` Y sin `envios` asociado — venta 100% mostrador-directa sin ningún rastro de reserva/pedido/envío. Todo lo demás prioriza. MELI/TiendaNube además filtran por el flag de ubicación habilitada para ese canal (ya existe en `ubicaciones`, mig 336) | Se descartó agregar `ventas.es_venta_directa boolean` — un campo derivado en el momento evita el riesgo de que quede desactualizado si a una venta se le agrega un envío/pedido DESPUÉS de creada (patrón de bug ya visto varias veces en el proyecto). |
| D3 | El mostrador SOLO PIERDE PRIORIDAD, no queda excluido — no hay forma de controlar qué agarra el cliente de la góndola cuando conviven fechas distintas | Confirmado, equivale a la opción (a) del documento original. Fede planteó una idea nueva conectada a esto (uniformar vencimientos en góndola) — ver "Tema aparte" al final, explícitamente NO para implementar todavía. |

## E. Opción 3 — Armar kits

| # | Respuesta | Resumen |
|---|---|---|
| E1 | Reusa la pantalla de armado de kits existente (con modificaciones pendientes, ver E3). Quien arma el kit NO es el repositor por defecto — es la persona de Inventario, salvo que el supervisor se lo asigne puntualmente a un repositor. Si el kit nace de la regla automática, dispara tarea de PRIORIDAD ALTA | Confirmado — combina las opciones (a) y (c) del documento original. |
| E2 | Se autogenera todo (nombre, precio, código), con opción de editar nombre o código a mano. **Modificar el precio requiere autorización de supervisor** | ✅ **CONSTRUIDO (2026-08-07, mig 343, `src/lib/kits.ts` + `InventarioPage.tsx` + `autorizaciones_inventario` tipo `kit_precio`)** — ⚠️ sin verificar en navegador. Confirmado — combina (a) y (c) del documento original, con el agregado de la autorización sobre precio. |
| E3 | Confirmado el gap técnico — `iniciar_armado_kit` consume FIFO ciego al `estado_id` (reserva por `created_at`, ignora si hay stock en descuento). Hay que modificarlo para que, cuando el armado nace de una regla de Rotación, consuma PRIMERO (o EXCLUSIVAMENTE) del lote en descuento | ✅ **CERRADO Y VERIFICADO end-to-end (2026-08-07, mig 343):** implementado con prioridad (no exclusividad, mismo criterio D3 de la Opción 2), test e2e permanente `132_kit_armado_prioridad_rotacion_mutante.spec.ts`, 2 corridas consecutivas verdes contra DEV. |
| E4 | **(Corregida por Fede — el documento original tenía el riesgo de doble descuento.)** El precio del kit = precio normal × N unidades, **sin restar ningún descuento**. El % de descuento lo aplica el estado en el momento de la venta, con el mismo mecanismo que ya existe para cualquier producto en ese estado — no se resta dos veces | ✅ **CONSTRUIDO (2026-08-07, mig 343, `sugerirPrecioKit`)** — ⚠️ sin verificar en navegador. Fede corrigió la premisa de la pregunta original (que proponía restar el descuento al armar el kit) — la corrección es correcta y evita un bug real de doble descuento. |
| E5 | ⚠️ La respuesta de Fede **no contestaba lo preguntado** (siguió elaborando la lógica de precio de E4 sin mencionar el desarmado). ✅ **Cerrado por GO el 2026-08-07 (opción b):** se puede desarmar un kit de Rotación — los componentes vuelven al MISMO estado con descuento del que salieron (no a "Disponible") | ✅ **CERRADO (decisión de negocio), 🟡 sin construir todavía.** Depende de la Pestaña de supervisor (disparo automático), a propósito — ver "Ejecución real" arriba. |

## F. Ubicación de excepción

| # | Respuesta | Resumen |
|---|---|---|
| F1 | Opcional, configurable por CATEGORÍA o por SKU | Confirmado — extiende la jerarquía de A3 también a esta regla. |
| F2 | No aplica a la opción 3 (kits) — el kit es un producto distinto, puede estar en cualquier ubicación, incluso al lado del SKU original sin descuento | Confirmado, equivale a la opción (a) del documento original. |

## G. Configuración

| # | Respuesta | Resumen |
|---|---|---|
| G1 | Nueva sub-pestaña **"Rotación"** dentro de Configuración → Inventario. **FIFO/FEFO se MUEVE ahí también**, sacándolo de la sub-pestaña "Reglas" actual | Confirmado — implica reorganización de UI existente, no solo agregar contenido nuevo. |
| G2 | Solo Dueño/Admin — Supervisor NO puede configurar esto | Confirmado, equivale a la opción (a) del documento original. |
| G3 | En teoría no debería haber productos sin categoría, pero por la jerarquía de A3, si falta un nivel se cae al siguiente; si ninguno de los tres (SKU/categoría/negocio) tiene regla, no se aplica ninguna | Confirmado, equivale a la opción (b). |

## H. Prioridad y comentarios

| # | Respuesta | Resumen |
|---|---|---|
| H1 | Sin prioridad marcada — Fede dejó a criterio de GO/Claude si hacía falta, dado que casi todo quedó resuelto arriba | ✅ Obsoleto — con el relevamiento 100% cerrado (B4/C2/E5 incluidos), no hace falta priorizar entre lo ya cerrado. |
| H2 | Sin llenar | 🟡 Abierto — GO puede cerrarlo como "sin comentarios" o agregar algo. |

---

## 💬 Tema aparte planteado por Fede — NO implementar todavía, requiere análisis de viabilidad

Conectado a D3. Dos partes, marcadas explícitamente por Fede como para **analizar antes de decidir si
se construye**, no como una decisión de negocio ya tomada:

1. **Tarea de repositor para uniformar vencimientos en góndola:** si un SKU entra en descuento por
   vencimiento y a la vez hay otro inventario del mismo SKU con fecha más de 15 días posterior, se
   generaría una tarea para que el repositor retire las unidades más frescas de la góndola y deje
   expuestas solo las que comparten fecha similar — para que el cliente nunca elija entre una unidad
   próxima a vencer y una más fresca paradas una al lado de la otra.
2. **Regla de reposición que evite tener que retirar lo recién repuesto:** la sugerencia de reponer
   debería considerar la cercanía de fechas de vencimiento — no reponer con stock que tenga más de 60
   días de diferencia respecto al que ya está en góndola, esperar a que quede como máximo 25% del stock
   exhibido, y verificar que al producto en góndola no le falten menos de 5 días para "próximo a
   vencer" antes de sumar más unidades.

Pendiente: análisis de viabilidad técnica (Claude) antes de que GO/Fede decidan si se construye.

## Decisiones técnicas pendientes de discutir con GO (NO decidir unilateralmente)

Ninguna quedó explícitamente delegada "a Tonga" en este documento (a diferencia del de supervisor-tab)
— Fede resolvió casi todo con reglas de negocio concretas. Las decisiones técnicas que aparecieron
fueron **D2** (qué identifica "envío o reserva" a nivel de datos) y los 3 gaps **B4/C2/E5**, todas
resueltas con GO el 2026-08-07 (ver tablas arriba). **Ninguna decisión técnica queda pendiente de
discutir** — lo único abierto es trabajo de construcción: probar E2/E4 (autogenerar/aprobar precio de
kit) en el navegador, y E5 (desarmado) + lo que depende de la Pestaña de supervisor (disparo
automático de la Opción 3), que siguen sin arrancar a propósito.

## Orden de trabajo (secuencia de 4 relevamientos hacia Repositores)

Ubicaciones (✅ EN PROD) → Pestaña de supervisor reusable (✅ respondido completo, diseño/construcción
pendiente) → **Motor de Rotación (este, ✅ relevamiento 100% respondido — ejecución real de Opción 1
✅, Opción 2 ✅ VERIFICADA end-to-end, Opción 3: E3 ✅ VERIFICADA end-to-end / E2-E4 construidos sin
verificar en navegador / E5 sin arrancar)** → Repositores (bloqueado hasta cerrar los 2 anteriores).

**Próximo paso real (orden estricto):**
1. ~~Verificar la Opción 2 en el navegador~~ — ✅ **COMPLETO** (spec 131, encontró y corrigió un bug
   real de inventario).
2. ~~Arrancar la Opción 3 (kits) por el camino B ya decidido por GO~~ — ✅ **E3 COMPLETO Y VERIFICADO**
   (spec 132, mig 343); **E2/E4 construidos, falta probar en el navegador** (prioridad de la próxima
   sesión si se retoma este módulo).
3. **E5 (desarmado de kit) y lo que depende de la Pestaña de supervisor** (disparo automático de tarea
   + reasignación) quedan para después de completar el diseño/construcción real de la Pestaña de
   supervisor reusable (#2).
4. Repositores (relevamiento #4) sigue bloqueado hasta completar el #2 y terminar este #3 por completo
   (E5 incluido).
