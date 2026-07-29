---
title: Módulo Pedidos (logística, separado de Ventas)
category: features
tags: [pedidos, logistica, picking, wms, reabastecimiento, tipos-pedido, cliente-suelto, bolsa, staging]
sources: [migrations 292, 294, 295, 296, 297, 298, 299, 300, 301, 302, relevamiento_pedidos_respuestas.md, src/pages/PedidosPage.tsx, src/pages/ConfigPage.tsx, src/lib/pedidoTransiciones.ts]
updated: 2026-07-28
---

# Módulo Pedidos

> **✅ Módulo COMPLETO y EN PROD desde v1.144.0 (2026-07-28, PR #302, migs 292 + 294-302).** Arrancado el 2026-07-22. El ciclo de vida completo
> está construido y verificado con e2e real contra DEV: **PED1-PED8 completos**, incluida una
> segunda ronda que cerró los 5 gaps que había dejado la primera pasada (ver "Correcciones
> post-relevamiento" más abajo): CC en Pedidos ahora valida límite de crédito, el des-pickeo
> funciona también para tareas encadenadas a un reabastecimiento, un pedido con venta ya devuelta se
> puede cancelar, K3 (exportar a Excel/PDF/CSV) está implementado, y el editor de
> `pedido_transiciones_roles` (E3) vive en Configuración → Pedidos. Nada de esto pasó por PR/commit
> todavía — verificar `git status` antes de asumir que algo llegó a `dev`.

Documento de **logística pura** — deliberadamente separado de Ventas/POS. Nace de una pregunta de GO
el mismo día en que se corrigieron 3 bugs reales de picking (mig 291, ver
[[wiki/features/wms]] → "Fixes de la primera ronda de pruebas manuales de GO"): *¿por qué el picking
depende de una venta de mostrador ya rebajada?* Se hizo un relevamiento completo (documento
`relevamiento-pedidos-reglas-negocio.html`, 12 secciones, 45 preguntas, generado por el subagente
`relevamiento`) y GO respondió todo. Detalle íntegro de las 45 preguntas, respuestas literales y
diseño: `G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md` (no repetido acá).

**Página:** `src/pages/PedidosPage.tsx` (`/pedidos`)
**Acceso:** DEPOSITO + SUPERVISOR + OWNER/ADMIN — **NO CAJERO** (a diferencia de Ventas, se trata como
operación logística desde el vamos, no comercial de mostrador). Gateado por modo Avanzado, mismo
patrón que "Recepciones"/"Picking".

---

## 🛑 Decisión de arquitectura clave (F4) — pivote real, contradice/actualiza el wiki de WMS anterior

Pedidos es un documento **100% separado** de Ventas:

- **Nunca pasa por `registrarVenta()`/el POS** — no arrastra UI/estado del carrito que no aplica.
- **Nunca rebaja stock directo** — arma cabecera+líneas, se "lanza" (Fase PED3, todavía sin construir)
  generando `wms_tareas`, y recién al prepararse físicamente genera la venta real reusando solo la
  lógica de rebaje (no la UI del POS).
- **Crítico, palabras textuales de GO**: *"Ventas no tiene que generar tareas... las tareas (picking y
  replen) deben ser solo para los pedidos."* Esto **deroga en la práctica** el uso de
  `fn_generar_tareas_picking_envio` (migs 290/291) desde el flujo de Ventas — la RPC sigue existiendo
  en la base (sería correcta si alguien la invocara a mano, y ya era coherente con que hoy no estaba
  conectada a ningún botón del frontend), pero **nunca se le agrega ningún gancho nuevo** desde
  `VentasPage.tsx`/`EnviosPage.tsx`. De acá en más, **todo** el picking/reabastecimiento nace
  **exclusivamente** desde Pedidos, vía una RPC nueva **`fn_generar_tareas_picking_pedido`** (Fase
  PED3, todavía **sin construir**).
- **Consecuencia para quien lea el wiki de WMS**: la sección "Fase 3" de [[wiki/features/wms]]
  describe `fn_generar_tareas_picking_envio` como si naciera de envíos/ventas despachadas — eso sigue
  siendo técnicamente correcto (el código no cambió), pero **ya no es el camino real** por el que
  nacen tareas WMS de acá en más. No asumir que Ventas sigue generando tareas.
- Ventas de mostrador (`despachada`/`reservada` del POS) quedan **100% intactas** — sin cambios de
  código, sin nuevos ganchos.

**Sin precio en `pedido_items` (H1, decisión de GO):** Pedidos es 100% cantidad/logística — el precio
se resuelve **una sola vez**, al entregar, en `fn_pedido_generar_venta` (PED4, mig 295, ver abajo).
Esto simplifica el modelo: no hay snapshot de precio ni recálculo que mantener en Pedidos.

**🟡 Simplificación consciente de PED4, no un gap del H1 original:** `fn_pedido_generar_venta` toma
el precio directo de `productos.precio_venta` — **no replica** el sistema de precio por nivel/UdM ni
listas de precios que sí usa el POS (`precioTierEfectivo` en `VentasPage.tsx`, backlog Fede). Un
Pedido de un producto con precio por nivel (ancla Caja/Pallet, etc.) va a facturar al precio base,
no al de la UdM en la que se pidió. No estaba en el alcance de esta sesión — documentado para
cuando corresponda extenderlo.

---

## PED1 — Schema (mig 292, ✅ EN PROD)

`supabase/migrations/292_pedidos_ped1_schema.sql`, aplicada en `gcmhzdedrkmmzfzfveig`:

```sql
tipos_pedido          -- catálogo por tenant, mismo patrón que canales_venta
  nombre, factura_momento ('al_confirmar'|'al_entregar'), cliente_obligatorio, activo, orden
  · seed idempotente (SECURITY DEFINER): Mayorista/E-commerce/Encargo telefónico/Retiro en local
  · trigger AFTER INSERT ON tenants siembra los 4 tipos default a tenants nuevos

pedidos                -- cabecera, operativa, RLS por sucursal (igual patrón que wms_tareas/ventas)
  numero, numero_sucursal     -- ambos siempre calculados, tenants.pedido_numeracion decide cuál se muestra
  tipo_pedido_id, cliente_id | cliente_nombre/cliente_telefono (cliente suelto sin alta formal)
  estado  ENUM: borrador → confirmado → en_preparacion → listo_para_entrega
          → entregado | entregado_parcial → cancelado
  fecha_entrega_solicitada, requiere_envio boolean, notas
  creado_por, lanzado_por     -- gobiernan quién puede cancelar/editar (J4)

pedido_items            -- líneas, heredan RLS del padre (igual que venta_items)
  producto_id, cantidad (unidades base, SIN PRECIO), cantidad_entregada (cumplimiento parcial, PED4)
  estado  ENUM: pendiente | en_preparacion | preparado | faltante | cancelada
  estado_id           → estados_inventario (opcional — de qué estado pickear, respeta FIFO/FEFO)
  talle, color, encaje, formato, sabor_aroma (atributos opcionales)

-- Trazabilidad nueva:
ventas.pedido_id              -- un Pedido puede generar N ventas (entregas parciales, G2)
venta_items.pedido_item_id    -- de qué línea de Pedido nació este ítem de venta
envios.pedido_id              -- envío auto-creado al lanzar un Pedido con requiere_envio=true,
                               --   ANTES de que exista la venta real; coexiste con envios.venta_id
```

**Bug real encontrado por el `migration-reviewer` ANTES de aplicar:** el trigger de numeración de
`pedidos` sin `SECURITY DEFINER` hubiera calculado el correlativo tenant-wide solo sobre las filas
**visibles** para el usuario (su sucursal, por la RLS-por-sucursal de la tabla) en vez de sobre todo
el tenant — duplicando/mal-calculando el número para usuarios sin `auth_ve_todas_sucursales()`.
**Mismo bug ya presente, sin corregir, en `set_oc_numero()`/`ordenes_compra` desde las migs 182+217**
(hallazgo colateral, anotado como pendiente, fuera de alcance de esta sesión, no se tocó). Corregido
en `pedidos` antes de aplicar (`set_pedido_numero()` es `SECURITY DEFINER`).

Alcance de la mig 292: catálogo + tablas + numeración + trazabilidad + RLS. **NO incluye todavía**:
RPCs de lanzar/cancelar/un-pick (PED3/PED5), UI (eso es PED2, ver abajo), reportes/alertas (PED8).
Aditiva, sin DDL destructivo.

---

## PED2 — UI (`src/pages/PedidosPage.tsx`, ruta `/pedidos`)

Ciclo de vida cubierto por ahora: **borrador → confirmado → cancelado** (todo lo que involucra
generar tareas WMS reales — "lanzar" — es la Fase PED3, todavía no existe en esta página).

- **Nav item nuevo** en `AppLayout.tsx` (ícono `ListOrdered`): `supervisorOnly: true` (OWNER+SUPERVISOR
  +ADMIN) + `depositoVisible: true` (suma DEPOSITO) + `avanzadoOnly: true` — **NO CAJERO**. También
  sumado a `DEPOSITO_ALLOWED` (el rol DEPOSITO tiene una whitelist de rutas permitidas aparte del nav).
- **Listado** de pedidos del tenant (RLS ya filtra por sucursal), filtro por estado, expandible por
  fila (muestra las líneas + atributos + notas).
- **"Nuevo pedido" (modal):**
  - Tipo de pedido (obligatorio, catálogo `tipos_pedido`) — determina si el cliente es obligatorio
    (`tipoSel.cliente_obligatorio`).
  - Cliente: buscador de clientes existentes, **o texto libre** ("nombre suelto" sin alta formal) +
    teléfono opcional — mismo criterio que "venta directa" hoy en `VentasPage.tsx`.
  - **Fecha de entrega solicitada — obligatoria** (date picker); habilita las alertas de entrega
    vencida (K2) sin ambigüedad.
  - **Referencia / Nº externo (opcional, texto libre, `pedidos.referencia`, mig 302)** — el número
    propio del cliente (ej. su OC "OC-ACME-123"). El correlativo interno (`numero`) sigue siendo 100%
    automático; este campo es aparte para no meter huecos ni colisiones en la secuencia. Se muestra
    como badge en la lista, es buscable y sale en los exportes.
  - Flag `requiere_envio` (checkbox) — "si no, es retiro en local, no se toca el módulo Envíos".
  - Buscador de productos por nombre/SKU (catálogo, no LPN — eso se resuelve al lanzar, PED3) → agrega
    líneas con cantidad, estado de inventario y atributos opcionales (talle/color/"otro atributo").
  - Notas de cabecera.
  - "Guardar borrador" → inserta `pedidos` + `pedido_items` en una transacción del cliente (dos
    inserts secuenciales), `logActividad` entidad `'pedido'`.
- **Validaciones de creación (ronda 2026-07-23, pedida por GO):**
  - **Estado de inventario obligatorio por línea** cuando el tenant tiene estados activos; se
    **precarga con el default del producto** (`productos.estado_id`, si sigue activo). Si el tenant
    no usa estados, la línea va sin estado (= "cualquiera" al reservar), como antes.
  - **Cantidad entera salvo UoM fraccionaria** — usa el helper central `esDecimal`
    (`ventasValidation.ts`, mismo que el POS): kg/gr/lt/ml/… admiten decimales, unidad/caja/pieza no.
    Cuando cambie el modelo de UoM (ver `relevamiento-unidades-medida-empaque`), se ajusta ese único
    helper y Pedidos lo hereda.
  - **Repetir producto en varias líneas SÍ se permite** (caso legítimo: 3 "Nuevo" + 2 "Outlet" del
    mismo SKU) — solo se bloquean dos líneas 100% idénticas (mismo producto + estado + atributos).
  - **Aviso NO bloqueante de stock** al guardar si la cantidad supera el disponible de hoy (H2 del
    relevamiento) — el bloqueo en firme sigue siendo al Lanzar (server-side).
- **Confirmar** (borrador→confirmado) y **Cancelar** (con `window.confirm`) — ambas mutaciones
  `logActividad` con `accion: 'cambio_estado'`.

**Probado en vivo** contra el navegador real (Playwright): un pedido real creado y confirmado en el
tenant "Almacén Jorgito" (DEV), datos de prueba limpiados después.

`logActividad` — entidad nueva **`'pedido'`** sumada a `src/lib/actividadLog.ts` (`EntidadLog`) y a
los mapas de íconos/labels de `HistorialPage.tsx`, para que el historial pueda mostrar altas y cambios
de estado de Pedidos igual que cualquier otro documento.

---

## PED3 — "Lanzar" (mig 294, ✅ EN PROD)

`supabase/migrations/294_pedidos_ped3_lanzar.sql` — RPC nueva **`fn_generar_tareas_picking_pedido(p_pedido_id)`**,
SECURITY INVOKER (respeta RLS del caller, mismo criterio que el resto de RPCs de `wms_tareas`):

1. Idempotente: si el pedido ya tiene `wms_tareas`, devuelve las existentes sin duplicar.
2. Exige `pedidos.estado = 'confirmado'` (si no, error claro).
3. **H2 — validación bloqueante ANTES de reservar nada**: por cada `pedido_item` no cancelado,
   suma el disponible (`cantidad - cantidad_reservada`) en `inventario_lineas` filtrando por
   `tenant_id`/`sucursal_id`/`estado_id`/**talle/color/encaje/formato/sabor_aroma** de la línea del
   pedido, excluyendo `ubicacion_id IS NULL` y `disponible_surtido=false`. Si falta, `RAISE
   EXCEPTION 'No hay stock para % (SKU %) — faltan % unidades'` — aborta la función entera
   (ninguna línea queda reservada a medias).
4. **H4 — reserva real**: mismo mecanismo que "Reservar stock" del POS — FEFO (`fecha_vencimiento
   NULLS LAST, created_at`), `UPDATE inventario_lineas SET cantidad_reservada = cantidad_reservada
   + v_tomar`.
5. Por cada línea reservada: si su ubicación es tipo `picking` → tarea `picking` directa; si no y
   `wms_reabastecimiento_on_demand` está habilitado → tarea `replenishment` + `picking` encadenada
   (`tarea_precedente_id`); si no → `picking` directa con nota "reabastecimiento deshabilitado".
6. **F2 — envío condicional**: si `pedidos.requiere_envio`, crea un `envios` con `pedido_id`
   (`venta_id` NULL hasta que exista la venta real) usando el domicilio principal del cliente si
   tiene uno.
7. Pasa `pedidos.estado` a `en_preparacion`, setea `lanzado_at`/`lanzado_por = auth.uid()`.

`wms_tareas` ganó columna **`pedido_id`** (FK, análoga a `envio_id`) y su CHECK de `origen` ahora
acepta también `'pedido'` (antes `envio/manual/umbral`).

**Bugs reales encontrados por el `migration-reviewer` y corregidos antes de aplicar:**
- 🔴 Faltaba el filtro por atributo de variante (talle/color/encaje/formato/sabor_aroma) — sin él,
  un pedido de "talle M" podía reservar/pickear "talle S" sin ningún error (a diferencia del POS,
  que tiene un humano frenando la ambigüedad vía `atributoAmbiguoEnStock`).
- 🟡 Faltaba excluir `ubicacion_id IS NULL`/`disponible_surtido=false` — podía generar una tarea de
  reabastecimiento con destino imposible de completar nunca.

**Edge-case aceptado (no es una regresión de Pedidos, ya existía en Fuente 2 de
`fn_generar_tareas_picking_envio`):** si el reabastecimiento consume de una ubicación con VARIAS
líneas del mismo producto, puede tomar un LPN distinto al reservado (fungible por SKU+atributo+
estado — no rompe el total, solo la trazabilidad fina por LPN puntual).

**UI (`PedidosPage.tsx`):** botón "Lanzar" para `estado='confirmado'`; botón "Ver en Picking" para
`en_preparacion`/`listo_para_entrega` (linkea a `/picking`, la página YA EXISTENTE del módulo WMS —
sin cambios ahí). Al expandir un pedido lanzado se ve la lista de sus `wms_tareas` con estado.

---

## PED4 — "Entregar" genera la venta real (migs 295 + 297, ✅ EN PROD)

`supabase/migrations/295_pedidos_ped4_entrega.sql` — RPC nueva **`fn_pedido_generar_venta(p_pedido_id,
p_sesion_caja_id, p_medio_pago, p_entregas DEFAULT NULL, p_idempotency_key DEFAULT NULL)`**, retorna
el `uuid` de la venta creada.

**A1/H1 (decisión ya confirmada, ver arriba):** Pedidos NUNCA pasa por el POS
(`VentasPage.tsx`/`registrarVenta()`). Esta función reusa SOLO la mecánica de rebaje/movimientos que
ya usa Ventas — inserta `ventas` (estado `'despachada'`, `pedido_id` seteado, `origen='Pedidos'`),
`venta_items` (con `pedido_item_id`, precio = `productos.precio_venta` actual — Pedidos no maneja
precio hasta este punto), rebaja `inventario_lineas` (decrementa `cantidad` Y `cantidad_reservada`
juntos, consumiendo de lo YA reservado, filtrando por los mismos atributos que PED3), inserta
`movimientos_stock` (`tipo='rebaje'`) y `venta_item_despachos` (si `tenants.trazabilidad_asignacion`).
**No arrastra promos/combos/series/CC-morosidad/descuentos del POS** — Pedidos no los necesita.

**La factura AFIP NO se emite automáticamente** — queda para el flujo manual "Facturar" ya existente
en Ventas → Historial (`emitirFactura` en `VentasPage.tsx`, EF `emitir-factura`, funciona sobre
cualquier `venta_id` sin importar cómo se creó la venta). Evita reimplementar lógica fiscal (Regla de
oro #0: un solo lugar calcula/emite comprobantes).

**REGLA #0 — efectivo siempre a caja, más estricto que el POS a propósito:** el `INSERT INTO
caja_movimientos` va DENTRO de la misma transacción — si falla, se aborta TODA la operación (venta +
rebaje + reserva liberada), a diferencia de `VentasPage.tsx` que tolera que ese insert falle dejando
la venta igual con un toast de aviso. No hay una UI viva mostrando ese aviso en un flujo de depósito,
así que fallar entero es más seguro que dejar plata sin asentar.

**G1-G3 — cumplimiento parcial:** `p_entregas` (`[{pedido_item_id, cantidad}]`) permite entregar
menos que el total pedido por línea; lo no entregado queda pendiente para una entrega posterior (un
Pedido puede generar N ventas, A4). **G4 — cierre automático/manual:** `tenants.pedido_cierre_automatico`
(columna nueva, default `true`) — si TRUE y se completa el 100%, `pedidos.estado='entregado'` solo;
si FALSE, queda en `'entregado_parcial'` hasta que alguien lo cierre a mano (`fn_pedido_cerrar`, ya
existía desde antes de esta fase, sin cambios).

**Bugs reales encontrados por el `migration-reviewer` y corregidos antes de aplicar:**
1. 🔴 **El guard de estado no incluía `'entregado_parcial'`** — la SEGUNDA entrega de cualquier
   pedido con cumplimiento parcial (el caso central de esta fase) fallaba SIEMPRE. Corregido.
2. 🔴 **Idempotencia de reintentos de red** — al corregir (1) se reabría la ventana de un reintento
   duplicando venta/rebaje/cobro. Se agregó `p_idempotency_key` (columna nueva
   `ventas.pedido_entrega_key` + índice único parcial `(pedido_id, pedido_entrega_key)`): un
   reintento con la misma key devuelve la venta ya generada.
3. 🟡 **Ventana TOCTOU en la sesión de caja** — se agregó `FOR UPDATE` (bloquea la sesión durante
   toda la función) + validación de que la caja sea de la misma sucursal del pedido.

**🔴 El hallazgo MÁS severo — en una función YA EXISTENTE y compartida (`fn_completar_tarea_reabastecimiento`,
mig 290), corregido en `297_wms_reabastecimiento_transferir_reserva.sql`:** al mover stock físico
bulk→picking, esa función decrementaba `cantidad` en el origen pero **nunca transfería
`cantidad_reservada`** al LPN nuevo del destino (nacía con reserva 0 por default). Consecuencia real:
la reserva quedaba "pegada" en un origen que, tras moverse, puede tener menos stock físico del que
aparenta, mientras el LPN de picking recién creado —donde el operario retira físicamente— quedaba
**sin reserva**, vendible a cualquier otro cliente/pedido sin autorización ("stock fantasma"). Fix:
ahora transfiere `LEAST(cantidad_movida, cantidad_reservada_origen)` al crear el LPN nuevo. **Es un
fix general de WMS, no específico de Pedidos** — el mismo gap existía para reservas de Ventas.
Verificado explícitamente contra datos reales en `tests/e2e/107_pedidos_ciclo_completo_mutante.spec.ts`
(antes del fix el LPN nuevo nacía con `cantidad_reservada=0`; después nace con la cantidad correcta).

**🟡 Pendiente no bloqueante, documentado:** Cuenta Corriente como medio de pago en Pedidos no valida
morosidad ni límite de crédito (Ventas sí lo hace, aunque solo client-side vía `evaluarMorosidad`/
`evaluarLimiteCC`).

**UI (`PedidosPage.tsx`):** botón "Entregar" para `en_preparacion`/`listo_para_entrega`/
`entregado_parcial` — modal con cantidad a entregar por línea (precargada con el pendiente, editable
para entrega parcial), selector de caja abierta (si hay más de una), selector de medio de pago
(Efectivo/Tarjeta débito/Tarjeta crédito/Transferencia/Mercado Pago/Cuenta Corriente si hay cliente).
Genera un `crypto.randomUUID()` como `p_idempotency_key` al abrir el modal.

---

## PED5 — Cancelación y des-pickeo (mig 296, EN DEV, NO en PROD)

`supabase/migrations/296_pedidos_ped5_cancelacion_unpick.sql` — 3 RPCs + 1 helper interno:

- **`fn_pedido_deslanzar(p_pedido_id)`** (F5): deshace "lanzar" SIN cancelar el pedido entero —
  libera todas las reservas pendientes/en_curso, cancela esas `wms_tareas`, cancela el envío
  auto-generado si no se despachó, vuelve `pedidos.estado` a `'confirmado'` (limpia
  `lanzado_at`/`lanzado_por`). Solo si NINGUNA tarea del pedido está `completada`. Útil para corregir
  un lanzamiento con datos mal cargados sin tener que cancelar el pedido entero.
- **`fn_cancelar_pedido(p_pedido_id)`**: cancelación completa (cualquier estado no terminal), mismo
  guard + mismo mecanismo de liberación, pasa a `'cancelado'`.
- **`fn_unpick_tarea_wms(p_tarea_id, p_ubicacion_destino_id)`** (E4, "des-pickeo"): para una tarea
  `tipo='picking'` YA `completada` de un Pedido, libera su reserva y reubica físicamente el LPN en
  la ubicación que el operador elija — inverso de `fn_completar_tarea_reabastecimiento` (decrementa
  el origen, crea un LPN nuevo en destino SIN reserva — vuelve a ser stock libre).

**Bugs reales encontrados por el `migration-reviewer` y corregidos antes de aplicar:**
1. 🔴 **`fn_cancelar_pedido` no chequeaba si el pedido ya tenía una venta real generada.** El
   relevamiento (A5) dice que cancelar con entrega real debería disparar la devolución de esa venta
   (reusando el flujo de devoluciones de `VentasPage.tsx`, con NC/CC) — implementar esa devolución
   automática es alcance mayor y **queda diferido a propósito**. Mientras tanto, `fn_cancelar_pedido`
   **BLOQUEA** con una excepción clara si ya existe una venta vinculada (más seguro que dejarla
   huérfana), y la UI ya no ofrece "Cancelar" para pedidos en `entregado_parcial`.
2. 🔴 **`fn_unpick_tarea_wms` nunca puede des-pickear una tarea ENCADENADA a un reabastecimiento** —
   su `lpn_origen` apunta a un texto que nunca existió físicamente en la ubicación destino (el LPN
   real nace con timestamp al completar el reabastecimiento, no reusa el texto viejo). Es el caso
   más común (reabastecimiento on-demand viene habilitado por default). Se agregó un mensaje de
   error específico para ese caso; **la UI oculta el botón "Deshacer" para tareas con
   `tarea_precedente_id` seteado** — arreglarlo de raíz (matchear por producto+ubicación sin
   depender del texto del LPN) **queda pendiente documentado**.

También se cerró una ventana de carrera menor: el guard "¿hay alguna tarea completada?" toma `FOR
UPDATE` sobre TODAS las tareas del pedido antes de evaluarse.

**Nota de diseño importante:** `pedido_items.estado`/`cantidad_entregada` NUNCA se tocan durante el
ciclo picking→completar (PED3/`/picking`) — eso solo pasa en PED4 al entregar de verdad. Por eso
deshacer un picking (des-pickeo) no necesita revertir nada en `pedido_items`, solo la reserva de
`inventario_lineas` y la propia `wms_tareas`.

**UI (`PedidosPage.tsx`):** botón "Deshacer lanzamiento" para `en_preparacion`; botón "Cancelar" para
cualquier estado no terminal salvo `cancelado`; en el detalle expandido de un pedido lanzado, cada
tarea de picking `completada` (directa **o** encadenada a un reabastecimiento, desde la mig 300 —
ver "Correcciones post-relevamiento" más abajo) tiene un link "Deshacer" que abre un modal para
elegir la ubicación destino. Ambos botones, además, respetan el editor de roles por transición
(E3, PED7) — no se muestran si el rol del usuario no tiene permiso para esa transición.

---

## PED7 — Config (`src/pages/ConfigPage.tsx`, sin migración nueva, EN DEV)

Tab nuevo **"Pedidos"** gateado por modo avanzado (mismo criterio que "Envíos"), con:

- **Numeración**: tenant vs. sucursal (`tenants.pedido_numeracion`, radio buttons).
- **Cierre automático**: toggle `tenants.pedido_cierre_automatico`.
- **Quién puede hacer cada transición (E3, cerrado en la ronda de fixes)**: tabla rol×transición
  (confirmar/lanzar/entregar/cancelar/deslanzar) sobre `tenants.pedido_transiciones_roles` (jsonb,
  `Record<transición, roles[]>`). Lógica pura en `src/lib/pedidoTransiciones.ts`
  (`puedeTransicionPedido`, mismo patrón que `ajusteAutorizacion.ts`/`cajaPermisos.ts`): una
  transición **ausente** en la config usa el default de código (DUEÑO/SUPERVISOR/SUPER_USUARIO/
  DEPOSITO pueden); una transición **presente** (incluso como array vacío) es una allow-list
  estricta, sin fallback — permite bloquear una transición a propósito para todos salvo ADMIN.
  `ADMIN` (staff cross-tenant) siempre puede, no aparece en la tabla editable — mismo criterio que
  `is_admin()` a nivel DB, un tenant no puede bloquear al soporte. **Gate 100% client-side** (oculta
  el botón), igual alcance que `ajuste_autorizacion_roles` — no reemplaza los guards server-side de
  cada RPC (stock/caja/CC/idempotencia), que corren siempre sin importar el rol. Cubierto por
  `tests/unit/pedidoTransiciones.test.ts` (8 casos).
- **CRUD de `tipos_pedido`**: nombre, momento de factura (al confirmar/al entregar), cliente
  obligatorio, activar/desactivar — mismo patrón visual que "Zonas" (WMS).

---

## PED8 — Alertas + exportes (completo: K1+K2+K3)

`src/hooks/useAlertas.ts` (badge del sidebar) y `src/pages/AlertasPage.tsx` (`/alertas`) ganaron 2
fuentes nuevas, solo modo avanzado:

- **Pedidos con entrega vencida** (`fecha_entrega_solicitada` pasada, estado no terminal).
- **Pedidos lanzados sin avanzar** (`en_preparacion` hace más de 24hs).

Ambas suman al conteo del badge y tienen su sección propia en `/alertas` con link directo a
`/pedidos`/`/picking`. **K1** (pedidos pendientes de lanzar agrupados por fecha) se cubre con el
filtro de estado que ya existía en `/pedidos` — no se construyó un dashboard separado.

**K3 (cerrado en la ronda de fixes):** menú "Exportar" (`ActionMenu`, click no hover — mismo
componente que Productos/Clientes) en la barra de filtros de `/pedidos`, con 3 salidas sobre la
lista filtrada actual (respeta el filtro de estado activo):

- **Excel** (`XLSX.utils.json_to_sheet` + `writeFile`).
- **CSV** (armado manual, mismo patrón que el resto del código).
- **PDF** (`jsPDF` + `jspdf-autotable`).

Cada fila exportada aplana pedido+línea (número, cliente, tipo, estado, fecha, producto, cantidad
pedida/entregada) — mismo criterio de "aplanar cabecera+líneas" que ya usan los exportes de
Clientes/Caja.

---

## PED6 — Bolsa de pedidos + staging + listas imprimibles (mig 298, EN DEV, NO en PROD)

`supabase/migrations/298_pedidos_ped6_bolsa_staging.sql` — construida en una sesión posterior a
PED3-PED5/PED7/PED8 (GO pidió explícitamente no dejarla diferida). Alcance elegido, más seguro que
forzar un cambio de destino físico del picking: la "bolsa" agrupa N pedidos + la ubicación de
staging elegida como **metadato organizativo** (para filtrar/agrupar en `/picking` y para la lista
imprimible) — **sin tocar el mecanismo de reserva/generación de tareas ya probado**. La RPC nueva
**`fn_lanzar_bolsa_pedidos(p_pedido_ids uuid[], p_ubicacion_staging_id uuid)`** NO reimplementa esa
lógica: llama, pedido por pedido, a `fn_generar_tareas_picking_pedido` (mig 294, sin cambios) y
etiqueta las tareas resultantes con `wms_tareas.lanzamiento_id` (nueva FK a `pedido_lanzamientos`,
tabla nueva). Si algún pedido de la bolsa falla cualquier validación de esa RPC, la excepción aborta
la función ENTERA — no hay bolsas parciales.

`'staging'` se agregó al CHECK de `ubicaciones.tipo_ubicacion` (antes
`picking/bulk/estiba/camara/cross_dock`, mig 032) — son las ubicaciones que se ofrecen al elegir
dónde converge la mercadería de una bolsa.

**Bug real encontrado por el `migration-reviewer` antes de aplicar:** sin un guard explícito, un
pedido YA lanzado (con `wms_tareas` existentes) incluido por error en una bolsa nueva no generaba
nada (`fn_generar_tareas_picking_pedido` es idempotente por diseño), pero el `UPDATE wms_tareas SET
lanzamiento_id` de todos modos le reescribía la bolsa a esas tareas viejas **en silencio** —
"robándoselas" a la bolsa/lanzamiento al que realmente pertenecían (rompe trazabilidad write-time).
Se agregó `EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = ...)` que rechaza la bolsa entera si
cualquier pedido ya fue lanzado. También se agregó, como defensa en profundidad (Regla #0 — la
función se concede a `service_role`, que tiene BYPASSRLS): validar que TODOS los pedidos del array
sean del mismo tenant (antes solo se validaba el primero), y que la ubicación de staging esté activa.

**🐛 Bug real encontrado por el e2e (no por el review — un error `42702` real al correr contra DEV):**
la función tiene `pedido_id` como columna de salida (`RETURNS TABLE`), que Postgres expone como
variable PL/pgSQL en todo el cuerpo — una referencia sin calificar a `wms_tareas.pedido_id` dentro
del `EXISTS` del guard de arriba era **ambigua** (podía referirse a la columna o a la variable de
salida). Fix: calificar explícitamente `wms_tareas.pedido_id`. Corregido y verificado en DEV antes
de darlo por cerrado.

**Listas de picking imprimibles (L2-2):** modal en `PedidosPage.tsx` con una tabla imprimible
(producto/cantidad/LPN/ubicación origen/destino) de las `wms_tareas` de un pedido lanzado — mismo
patrón `window.print()` + `@media print` que ya usan el ticket de venta y el comprobante de
devolución (`index.css`, id nuevo `#pedido-lista-print`). Fallback para cuando falla el escaneo.

**UI (`PedidosPage.tsx`):** checkbox de selección por fila para pedidos `confirmado`; barra
flotante "N seleccionados → Lanzar bolsa" con modal para elegir la ubicación de staging; botón
imprimir (ícono) para cualquier pedido ya lanzado.

**Verificación:** tsc + build + 1180 tests unitarios verdes + e2e nuevo (agregado a
`tests/e2e/107_pedidos_ciclo_completo_mutante.spec.ts`) que crea 2 pedidos, los lanza juntos en
bolsa, verifica que ambos quedan etiquetados con el mismo `lanzamiento_id`, y verifica explícitamente
el guard: un tercer pedido ya lanzado no puede colarse en una bolsa nueva (la función rechaza
entera, sin dejar nada a medias) — 4/4 verde contra datos reales de DEV.

---

## Correcciones post-relevamiento (ronda 2, 2026-07-23) — cierra los 5 gaps de la primera pasada

Tras completar PED1-PED8, GO pidió corregir los 5 gaps que habían quedado documentados. Los 3 que
tocan fiscal/stock pasaron por `migration-reviewer` antes de aplicarse (mig 299 tuvo **2 rondas de
revisión**, ver abajo); los otros 2 (UI de Config + exportes) no.

**1) CC en Pedidos sin validar límite de crédito (B1) — mig 299.** `fn_pedido_generar_venta` no
validaba `limite_credito` cuando el medio de pago incluía Cuenta Corriente. El trigger genérico
`fn_ventas_cc_guard` (mig 234, `BEFORE INSERT ON ventas`) YA cubre B4 (morosidad) para cualquier
venta, incluidas las de Pedidos — por eso esta migración **no duplica** ese chequeo. Pero para B1
(límite) el trigger de la mig 234 tiene un punto ciego real con Pedidos: lee `NEW.medio_pago` al
momento del INSERT, y `fn_pedido_generar_venta` inserta la cabecera con `total=0` (el total recién
se conoce al final, tras sumar líneas) y `monto: null` en el medio de pago (Pedidos siempre manda
"cobra el total, se resuelve después") — el trigger ve `monto_cc=0` siempre y su propio chequeo de
límite nunca dispara para ventas de Pedidos. Fix: se agrega el chequeo de B1 **dentro** de
`fn_pedido_generar_venta`, en el momento en que el total ya se conoce de verdad, calculando la
deuda INLINE escopeada por `tenant_id` (mismo criterio que la mig 234, sin pasar por la RPC
`cliente_cc_estado` que depende de `auth.uid()`).
- **1ra ronda de review:** encontró que la primera versión SÍ duplicaba B4 (vía `cliente_cc_estado`,
  el mismo patrón `auth.uid()` que la propia mig 234 evitó a propósito) y que un monto CC negativo
  neutralizaba el chequeo de límite. Fix: se sacó el duplicado de B4, se clampeó cada monto a
  `GREATEST(x,0)`.
- **2da ronda de review:** encontró que el **gate** de la validación (`IF v_monto_cc > 0.5`) seguía
  dependiendo de un valor controlado por el llamante — una sola entrada CC con `monto` 0 o negativo
  clampeaba a 0 y evadía el chequeo ENTERO, aunque la venta quedara igual marcada
  `es_cuenta_corriente=true` con deuda real sin cubrir. Fix final: el gate usa
  `v_total - v_monto_pagado` (el saldo real sin cubrir, ambos términos ya defendidos —
  `v_total` sale de `productos.precio_venta` en DB, `v_monto_pagado` está clampeado y capado) en vez
  de `v_monto_cc`. Aplicada a DEV recién con este fix.
- Política `'avisar'` se trata como "permitir" acá a propósito (depende de un `confirm()` del
  navegador que no existe server-side); solo se replica el bloqueo duro de `'bloquear'`.
- **e2e:** nuevo test en `107_pedidos_ciclo_completo_mutante.spec.ts` — crea un cliente con
  `limite_credito=100` y un pedido de $500 a CC con `cc_enforcement_politica='bloquear'`, verifica
  que `fn_pedido_generar_venta` se rechaza con "supera el límite" y que el rollback es completo
  (sin venta huérfana, reserva de stock intacta), después levanta el límite y reintenta el mismo
  pedido para confirmar que sí entrega.

**2) Des-pickeo de una tarea encadenada a un reabastecimiento — mig 300.** `fn_unpick_tarea_wms`
(mig 296) solo funcionaba para picking DIRECTO. Causa raíz: para una tarea encadenada,
`ubicacion_origen_id` es el DESTINO del reabastecimiento, pero `lpn_origen` sigue siendo el LPN de
BULK original — ese texto nunca existió físicamente en la ubicación de picking (el reabastecimiento
genera un LPN nuevo al mover el stock), así que el match exacto producto+ubicación+LPN daba `NULL`
siempre. Fix: si el match exacto no encuentra nada Y la tarea está encadenada
(`tarea_precedente_id IS NOT NULL`), un fallback busca cualquier línea reservada del mismo producto
en esa ubicación (FEFO), agregando entre varias si hace falta. **Limitación residual aceptada**
(misma clase de fungibilidad que el resto de WMS): si hubiera otra reserva del mismo producto sin
distinguir atributo en la misma ubicación (de otro Pedido), el fallback podría tocar esa reserva
ajena — el invariante global (total reservado = total real) se mantiene siempre, la trazabilidad
fina puede desalinearse en ese edge case, igual que otros matches "por disponibilidad" del módulo.

**3) Cancelar un pedido cuya venta ya se devolvió a mano — mig 301.** `fn_cancelar_pedido` (mig 296)
bloqueaba para siempre la cancelación de un pedido que alguna vez generó una venta, incluso después
de devolverla desde Ventas → Historial (el guard original no filtraba por estado de la venta). Fix:
el guard ahora solo bloquea si existe una venta **activa** (`estado NOT IN ('cancelada',
'devuelta')`) — una vez devuelta o cancelada a mano, el pedido puede cancelarse. La devolución
automática end-to-end (disparar NC/CC por código) sigue **diferida a propósito**: reimplementaría en
SQL una lógica fiscal compleja que hoy solo vive, testeada, en `VentasPage.tsx` (Regla #0 — un solo
lugar calcula plata/emite comprobantes). La UI (`PedidosPage.tsx`) ahora muestra, en el detalle
expandido, las ventas vinculadas al pedido con un link "Devolver esta venta" a
`/ventas?id=<id>&devolver=1` (mismo patrón que ya usa `EnviosPage.tsx`).

**4) K3 — exportes** y **5) editor E3 de `pedido_transiciones_roles`**: ver PED8 y PED7 arriba
respectivamente (ya integrados a la descripción de esas fases, no se repite acá).

**Verificación de esta ronda:** tsc + build + 1188 tests unitarios verdes (8 nuevos en
`pedidoTransiciones.test.ts`) + 5/5 e2e verdes en `107_pedidos_ciclo_completo_mutante.spec.ts`
(las 3 pruebas de la ronda anterior + un test nuevo del guard de CC).

---

## Roadmap por fases (PED1-PED8) — completo y verificado

Mismo criterio que Envíos 2.0 (EN1-EN7) / RRHH 2.0 (RH1-8) / Compras (CO1-CO8): cada fase se
construye, se prueba contra datos reales en DEV y se versiona por separado — no se deploya nada a
PROD hasta que GO lo pida (mismo criterio que el resto del WMS, feature sobre movimiento real de
stock).

| Fase | Qué | Estado |
|---|---|---|
| **PED1** | Schema: `pedidos`/`pedido_items`/`tipos_pedido`, numeración, estados, permisos base | ✅ mig 292 |
| **PED2** | UI armar Pedido: carrito sin precio, cliente, fecha/tipo, referencia externa (mig 302), atributos/estado por línea (obligatorio+precargado), cantidad entera-según-UoM, aviso de stock, KITs | ✅ (PedidosPage.tsx) |
| **PED3** | **"Lanzar"**: `fn_generar_tareas_picking_pedido`, reserva de stock real (`inventario_lineas.cantidad_reservada`), validación bloqueante ("no hay stock — faltan N unidades"), envío condicional (`requiere_envio` → `envios.pedido_id`) | ✅ mig 294 |
| **PED4** | Cumplimiento parcial: entregas en tandas (línea "parcial" con `cantidad − cantidad_entregada` visible, mismo patrón que `recepcion_items`), N ventas por Pedido, cierre automático/manual (`tenants.pedido_cierre_automatico`) | ✅ migs 295+297 |
| **PED5** | Cancelación y des-pickeo: `fn_pedido_deslanzar`/`fn_cancelar_pedido` a nivel Pedido, flujo de **un-pick** (RPC `fn_unpick_tarea_wms`, inversa de `fn_completar_tarea_reabastecimiento`), incl. encadenado a reabastecimiento y cancelar tras venta devuelta | ✅ mig 296+300+301 |
| **PED6** | Operación avanzada de depósito: **bolsa de pedidos** (`fn_lanzar_bolsa_pedidos`, lanzamiento batch de N pedidos con ubicación de staging elegida) + listas de picking imprimibles (`window.print()`) | ✅ mig 298 |
| **PED7** | Config: tab "Pedidos" en Configuración (numeración, tipos, cierre automático, editor E3 de roles por transición) | ✅ (ConfigPage.tsx, completo) |
| **PED8** | Reportes y alertas: K1 (filtro existente) + K2 (entrega vencida + sin avanzar 24h) + K3 (exportar Excel/PDF/CSV) | ✅ completo |
| *(fuera de Pedidos)* | Roles configurables por tenant (Picker/Auditor/Gruero) — iniciativa aparte, sin arrancar | ⬜ |
| *(fuera de Pedidos)* | CC en Pedidos con validación de **límite** de crédito (B1) | ✅ mig 299 |

### Gaps restantes (no bloquean el uso real — el resto se cerró en la ronda de fixes de arriba)

- **Devolución automática al cancelar un pedido con venta real (A5)**: `fn_cancelar_pedido` ya
  permite cancelar una vez que la venta se devolvió a mano (mig 301), pero no dispara esa devolución
  automáticamente — sigue siendo un paso manual desde Ventas → Historial (diferido a propósito, ver
  "Correcciones post-relevamiento").
- **Roles custom de Depósito** (Picker/Auditor/Gruero, hallazgo J3): excede el alcance de Pedidos,
  iniciativa aparte sin arrancar.

### Resumen ejecutivo de decisiones de diseño (detalle completo en `relevamiento_pedidos_respuestas.md`)

- **Relación con Ventas** (A): documento separado, sin migración forzada entre "Reservar" (mostrador)
  y "Pedido" (logística) — el operador elige a criterio; botón "Convertir a Pedido" desde una reserva
  existente para el caso borde.
- **Facturación** (B): configurable **por tipo de Pedido** (`tipos_pedido.factura_momento`:
  `al_confirmar` | `al_entregar`); anticipo/seña = ingreso de caja sin comprobante fiscal + recibo
  interno PDF opcional.
- **Cabecera** (C): numeración por sucursal configurable (`tenants.pedido_numeracion`); cliente
  obligatorio configurable por tipo; una sola sucursal por Pedido, sin traslado interno.
- **Líneas** (D): sin precio, con estado de inventario opcional, KITs se abren igual que en Ventas al
  lanzar; editable libre en borrador, no editable tras lanzar (se cancela y rehace).
- **Estados** (E): ciclo `borrador→confirmado→en_preparacion→listo_para_entrega→entregado(_parcial)→
  cancelado`; transiciones configurables por rol (`tenants.pedido_transiciones_roles`, default
  DEPOSITO/SUPERVISOR/OWNER pueden todas); **hallazgo nuevo "des-pickeo"**: lo ya pickeado no se
  cancela directo, requiere un flujo de "un-pick" con escaneo (Fase PED5).
  - `tipos_pedido.factura_momento` (B1) y `cliente_obligatorio` (C3) rigen las reglas por tipo.
- **"Lanzar"** (F): `fn_generar_tareas_picking_pedido` análoga a `fn_generar_tareas_picking_envio` pero
  arranca desde `pedido_items`; **F4 = el pivote de arquitectura documentado arriba**; se puede volver
  a borrador cancelando tareas si nada está en curso/completado.
- **Cumplimiento parcial** (G): Pedidos trabaja autónomo del vínculo a venta (podría no facturar
  nunca); recomendado (💡, aceptado): línea "parcial" con cantidad pendiente visible, mismo patrón que
  `recepcion_items`; cierre automático/manual configurable por tenant.
- **Precio y stock** (H): **sin precio en absoluto** en `pedido_items` (H1, ver arriba); validación de
  stock en dos momentos — alerta no bloqueante al armar, bloqueo duro al lanzar; "lanzar" reserva
  stock real.
- **Cliente** (I): CC con Pedido requiere aprobación adicional de SUPERVISOR; nombre/teléfono suelto
  admitido; reusa `cliente_domicilios` + "Retiro en sucursal".
- **Permisos** (J): crear/lanzar = DEPOSITO+SUPERVISOR+OWNER/ADMIN (NO CAJERO); cancelar/editar =
  autor de la acción + SUPERVISOR/OWNER/ADMIN siempre; **hallazgo J3** — GO pidió roles custom
  (Picker/Auditor/Gruero) que exceden el alcance de Pedidos, anotado como iniciativa aparte.
- **Reportes** (K): pendientes de lanzar por fecha, entregas vencidas, cumplimiento por tipo, alertas
  de pedido estancado, export Excel/PDF/CSV.
- **Prioridad** (L): GO — "indistinto, quiero todo implementado" (define alcance final, no orden de
  entrega). **Hallazgos nuevos de L2** (no estaban en el cuestionario original): FIFO/FEFO + estado de
  inventario por línea (ya incorporado a PED1 como `pedido_items.estado_id`) · listas de picking
  imprimibles (PED6) · lanzamiento en "bolsa de pedidos" con ubicaciones de **staging** (PED6, requiere
  agregar `'staging'` al CHECK de `ubicaciones.tipo_ubicacion`, hoy `picking/bulk/estiba/camara/
  cross_dock`, mig 032).

---

## 🧾 Pedido nacido de una VENTA (migs 315-319, v1.148.0, 🟡 EN DEV) — el sentido INVERSO de F4

> 🛑 **Actualiza la "Decisión de arquitectura clave (F4)" de más arriba.** F4 sigue valiendo para el
> sentido Pedido → venta. Lo que se agrega es el **inverso**: una venta genera automáticamente un
> Pedido de preparación. Ya NO es cierto que "Pedidos es 100% separado de Ventas" — hay puente en las
> dos direcciones, y por eso hacen falta los guards de abajo.

### La regla (diagrama de flujo de GO, 2026-07-29)

**Todas las ventas generan Pedido de preparación MENOS la entrega directa.**

```
PRESUPUESTO (estado pendiente)                                -> NO genera  (mig 323)
entrega directa = canal PRESENCIAL + despachada + sin envío   -> NO genera
con envío (propio o de tercero)                               -> genera
reserva (la mercadería no salió y hay compromiso)             -> genera
canal ONLINE sin envío (= retiro en local)                    -> genera
```

> 🐛 **Un PRESUPUESTO no genera pedido (mig 323).** Lo encontró GO: una venta recurrente generó un
> presupuesto, el presupuesto generó un pedido, y al cancelarse quedó el pedido vivo para que el
> depósito lo preparara. Fue un error de criterio de la mig 318 — `ventas.estado = 'pendiente'` **es
> un presupuesto** (el ticket dice "★ PRESUPUESTO ★"): el cliente no aceptó, no pagó y puede no
> convertirse nunca. El pedido nace cuando **se convierte** en venta.
>
> Y en el otro extremo: **anular o devolver la venta cancela su pedido** y sus tareas de picking.
> ⚠ Al cancelar **NO se toca `cantidad_reservada`**: en un venta-pedido el picking nunca reservó
> (mig 316), la reserva es de la VENTA — liberarla acá la liberaría dos veces. Por eso las tareas se
> cancelan con UPDATE directo y no con `fn_cancelar_tarea_wms`, que sí libera. Un pedido ya
> **entregado** no se toca: la mercadería salió y eso es historia.
>
> Tercera barrera: **no se puede lanzar** un pedido cuya venta esté anulada, devuelta o siga siendo
> un presupuesto (mig 324).

Deriva de `canales_venta.clasificacion` (mig 168): **no hay nada que configurar** y es correcto por
default para todos los tenants. `tenants.pedido_canales_excluidos` es solo la excepción (canales que
quedan afuera de la regla); vacío por default.

Se hace con triggers **server-side**, no en el POS: así también entran las ventas de los webhooks de
marketplace y del importador, que nunca pasan por `registrarVenta`.

| Rama del diagrama | Pedido | Envío |
|---|---|---|
| online · retiro local · pago parcial | ✅ | — |
| online · retiro local · pago completo | ✅ | — |
| online · envío propio / de tercero | ✅ | ✅ vinculado |
| mostrador · **entrega directa** | 🛑 **no** | — |
| mostrador · reserva | ✅ | — |
| mostrador · envío propio / de tercero | ✅ (lo crea el trigger de `envios`) | ✅ vinculado |

### 🛑 Por qué un venta-pedido es un documento DISTINTO

Un pedido con `venta_origen_id` **ya tiene su venta, su plata y su stock resueltos**:

| Riesgo | Qué pasaría | Cómo se cierra |
|---|---|---|
| **Doble venta** | `fn_pedido_generar_venta` crearía una venta nueva, con segundo rebaje y segundo asiento de caja | Trigger `BEFORE INSERT ON ventas`. Por trigger y no editando la RPC: cubre **cualquier** camino de escritura |
| **Doble reserva** | El algoritmo de logística reserva `cantidad_reservada`, pero la venta ya comprometió ese stock (o ya lo rebajó, y reservaría líneas ajenas) | Dispatcher → `fn_generar_tareas_picking_pedido_venta`, que arma el picking desde `venta_item_despachos` y **no toca `cantidad_reservada`** |
| **Mercadería sin cobrar** | Una reserva con seña parcial se prepara igual; si se entregara así, sale sin saldar | 💵 Gate en `fn_pedido_entregar_retiro`: rechaza si queda saldo (cuenta corriente sí puede, la deuda es a propósito) |

**Probado por mutación en DEV:** forzando el algoritmo viejo sobre un venta-pedido se reservan
**4 unidades de más**; con el dispatcher queda en 0.

### 🐛 De dónde saca el picking la mercadería (mig 320)

Bug real que encontró GO probando el flujo (venta #448, una reserva): la tarea salía **sin LPN y sin
ubicación**. La función leía solo `venta_item_despachos`, que se escribe al **despachar** — una venta
**reservada** todavía no tiene filas ahí: su plan de LPN vive en `venta_items.lpn_plan` (mig 156).
Como el pedido nace justamente de reservas, era el caso más común.

Ahora es una **cascada**, de la fuente más precisa a la más genérica, y **ninguna reserva stock**
(la venta ya lo comprometió):

| Prioridad | Fuente | Cuándo aplica |
|---|---|---|
| 1 | `venta_item_despachos` | La venta ya despachó — registro definitivo de qué salió y de dónde |
| 2 | `venta_items.lpn_plan` | La venta está **reservada** — el LPN que ya eligió el POS (incluida la elección manual del cajero) |
| 3 | Líneas con `cantidad_reservada > 0`, FEFO | Hay reserva pero sin plan (venta vieja, o el plan quedó corto). Solo lectura |
| 4 | Cualquier línea con stock, FEFO | Último recurso, para no dejar al operario sin una pista |

Si nada matchea, la tarea se emite igual con la nota **"⚠ sin stock ubicado para este producto"** —
el pedido nunca queda sin tarea, y el motivo queda escrito.

### La tarea de picking dice a qué pedido y a qué venta pertenece

Pedido de GO: sin eso, un LPN mal pickeado no se puede rastrear hasta el cliente que está esperando.
`/picking` muestra **Pedido #N** y **Venta #N** como links. Se resuelve en una query aparte, no
anidada: `ventas` y `pedidos` se referencian en las **dos** direcciones (`ventas.pedido_id` y
`pedidos.venta_origen_id`), así que el embed anidado de PostgREST es ambiguo.

### 💵 El ticket dice cuánto falta pagar

El ticket mostraba el TOTAL y, en gris, lo pagado — nunca el **saldo**, que es el número por el que
el cliente vuelve. Y desde la mig 318 el mostrador no entrega sin saldar, así que sin eso el cliente
se enteraba recién al venir a buscar la mercadería. Se agregó (`resumenPagoTicket`, lógica pura):

- Bloque **Pagado / SALDO A PAGAR** destacado. **El envío entra en la cuenta**: `total` no lo incluye
  pero `monto_pagado` sí (ISS-105).
- Un **presupuesto** no reclama saldo — todavía no es una venta.
- Una **reserva** dejó de verse como una venta cerrada: badge **★ RESERVA ★**, encabezado
  "Reserva N°…", leyenda "Tu pedido se entrega al abonar el saldo" y cierre "Guardá este comprobante
  para retirar".

### `listo_para_entrega` dejó de ser un estado muerto

Estaba en el CHECK desde la mig 292, con badge en la UI y leído como precondición por tres RPCs —
pero **ningún código lo seteaba nunca**. Desde la mig 316, completar la **última tarea de picking**
del pedido lo promueve. Es la condición que define la pestaña del mostrador.

### La pestaña Ventas → Pedidos

Muestra **solo** `listo_para_entrega` + **retiro en local** + nacidos de una venta. Búsqueda por
nombre (sin tildes), **DNI** (por dígitos y por **prefijo**, mínimo 3) y **N° de pedido** (exacto).
El prefijo y el match exacto no son cosmética: con "contiene", tipear "5" para el pedido 5 devolvía
además a todo cliente con un 5 en el documento.

El botón **Entregado** llama a `fn_pedido_entregar_retiro`: valida el pago, **no toca plata ni
stock**, deja el rastro en Envíos como `retiro_local`/`entregado` y devuelve el id de la venta para
abrir su detalle y facturar. Facturar es un paso aparte — trabar la entrega esperando a AFIP dejaría
al cliente parado en el mostrador.

### 💵 Cómo factura un Pedido (migs 317/319)

`fn_pedido_generar_venta` facturaba `productos.precio_venta` a secas. Hoy usa el mismo motor que el
POS:

- **Tier mayorista por volumen** (mig 306) vía `fn_precio_venta_efectivo`, resuelto contra el
  **total pedido** del SKU — entregar en dos tandas no hace perder el precio por volumen.
- **Redondeo del tenant** (H4).
- **Descuento por estado de inventario** (migs 284-285), prorrateado **por fuente**: cada unidad
  descuenta según el % del estado de SU línea concreta.

Verificado en DEV: 12 unidades con base $1.000, tier `>=10 -> $700` y estado con 20% pasaron de
facturar **$12.000** a **$6.720**.

#### ⚠ Pendiente conocido, evaluado y DIFERIDO a propósito (2026-07-29)

La **lista de precios por canal** (`reglaDe(canal).lista_precio`) y los **combos** siguen sin
aplicarse. GO pidió evaluar si valía la pena hacerlo; se midió antes de decidir:

- **`fn_pedido_generar_venta` nunca corrió: 0 ventas generadas por un Pedido** en PROD y en DEV.
- PROD: **0 pedidos**, **0 combos activos**, **0 tenants** con `lista_precio` seteada (la clave
  existe pero vale `null`, que es el default "resolver el tier por cantidad").
- Y desde la mig 316 esa función corre **solo para pedidos creados a mano** — un pedido nacido de
  una venta ya trae los precios del POS y su entrega (`fn_pedido_entregar_retiro`) no fija ninguno.
  El botón de crear pedidos a mano quedó **apagado por default** (mig 317).

Costo/beneficio de cada uno:

| | Costo | Decisión |
|---|---|---|
| **Lista por canal** | Bajo (~10 líneas), pero exige decidir **qué lista le toca a un Pedido**, que no tiene canal. Lo defendible sería tratarlo como `online` — es una regla nueva | Diferido |
| **Combos** | Alto: replicar server-side el motor de detección del POS (matchear definiciones contra las líneas, agrupar por producto+UoM, manejar cantidades), sobre código de plata | No se hace. Un combo es una decisión de mostrador, no de depósito |

> ⚠ **La trampa a tener presente:** el único caso que justifica prender los pedidos manuales es el
> **mayorista con entregas parciales** — y "mayorista" es justo el perfil que más probablemente
> configure la lista mayorista por canal. El día que se prenda ese toggle para un mayorista es
> cuando el hueco empieza a morder. Por eso el toggle muestra un **cartel** que dice exactamente con
> qué reglas factura un pedido manual, para que la decisión se tome informada.

### Crear un pedido a mano es opt-in (mig 317)

`tenants.pedido_manual_habilitado`, default **false**. Para una PyME casi todos los casos tienen un
camino mejor: el encargo sin cobrar es una venta `pendiente` (que ya genera el pedido), el armado sin
cliente es un traslado, y el e-commerce cobrado entra por el flujo automático. El único caso que
**solo** resuelve Pedidos es el mayorista con **entregas parciales** — por eso se esconde en vez de
borrarse.

### Detalles que costaron

- **Las líneas de la venta llegan DESPUÉS que la cabecera** (llamadas HTTP separadas) → las completa
  un trigger **statement-level** sobre `venta_items`, idempotente y solo mientras el pedido sigue en
  `confirmado`.
- **El envío también llega después** → el trigger de `envios` crea el pedido si no existía (caso
  "mostrador + envío") o lo marca `requiere_envio` y lo vincula.
- **💵 El costo de envío cuenta para el saldo**: `total` NO lo incluye pero `monto_pagado` SÍ (ISS-105).
- **🛑 Una VENTA nunca se cae por un documento de logística**: los triggers van envueltos en
  `EXCEPTION WHEN OTHERS` + `RAISE WARNING`.
- **Anti-loop**: una venta nacida de un pedido nunca genera otro.

**Cobertura:** 41 unit (`src/lib/pedidoVenta.ts`) · **e2e 113** (8 ramas + ciclo completo + picking de
una reserva + excepción, 5/5, todo por REST) · regresión **107** verde · UAT **§47**.

---

## Links relacionados

- [[wiki/features/wms]] — schema/RPCs de `wms_tareas` que Pedidos reusa desde PED3; `fn_completar_tarea_reabastecimiento`
  (mig 290) recibió un fix compartido en la mig 297 encontrado al construir PED4 (ver ahí)
- [[wiki/features/estructuras-udm]] — roadmap del que nació la discusión de picking; Fase 2 (UdM al
  ingresar/rebajar, mig 293) es un feature paralelo de la misma sesión, sin relación directa con Pedidos
- [[wiki/features/ventas-pos]] — Pedidos nunca pasa por `registrarVenta()`; el precio se resuelve
  directo en `fn_pedido_generar_venta` (PED4) sin usar el sistema de precio por nivel/lista de Ventas
  (gap documentado arriba); la factura AFIP se emite manualmente desde ahí (Historial → Facturar)
- [[wiki/features/clientes-proveedores]] — cliente existente o "nombre suelto" (I2); límite de
  crédito (`clientes.limite_credito`) ahora también lo valida Pedidos (mig 299, ver arriba)
- [[wiki/features/configuracion]] — tab "Pedidos" (PED7): numeración, cierre automático, tipos de
  pedido, editor E3 de roles por transición
- [[wiki/database/migraciones]] — migs 292, 294, 295, 296, 297, 298, 299, 300, 301, 302
- `relevamiento-unidades-medida-empaque-reglas-negocio.html` — relevamiento nuevo (2026-07-23) para
  separar Unidad de Medida física (kg/g/L, conversión universal) de Nivel de Empaque (Caja/Pallet,
  factor por producto); afecta el `esDecimal` que Pedidos usa para validar cantidad — sin implementar
- `G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md` — las 45 preguntas + respuestas + diseño
  completo, fuente de esta página
- `G360.Wiki/sources/raw/relevamiento_descuentos_respuestas.md` — relevamiento nuevo capturado de
  paso durante esta sesión (Descuentos), sin relación con Pedidos, sin implementar todavía
- `tests/e2e/107_pedidos_ciclo_completo_mutante.spec.ts` — e2e del ciclo completo: lanzar con
  reabastecimiento → completar → entregar (verifica el fix de la mig 297); deslanzar; lanzar en
  bolsa (verifica el guard de "pedido ya lanzado" de la mig 298); entregar a Cuenta Corriente sobre
  el límite (verifica el fix de la mig 299) — 5/5 verde contra datos reales de DEV
- `tests/unit/pedidoTransiciones.test.ts` — 8 casos de `puedeTransicionPedido` (defaults, config
  explícita, allow-list vacía, bypass de ADMIN)
