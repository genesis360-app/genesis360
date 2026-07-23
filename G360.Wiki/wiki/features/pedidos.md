---
title: Módulo Pedidos (logística, separado de Ventas)
category: features
tags: [pedidos, logistica, picking, wms, reabastecimiento, tipos-pedido, cliente-suelto]
sources: [migrations 292, 294, 295, 296, 297, relevamiento_pedidos_respuestas.md, src/pages/PedidosPage.tsx, src/pages/ConfigPage.tsx]
updated: 2026-07-23
---

# Módulo Pedidos

> **🚧 Módulo NUEVO, arrancado 2026-07-22, EN DEV — SIN deploy a PROD.** El ciclo de vida completo
> está construido y verificado con un e2e real contra DEV: **PED1 (schema) + PED2 (UI armar) + PED3
> (lanzar) + PED4 (entregar/generar venta) + PED5 (cancelar/deslanzar/des-pickeo) + PED7 (Config) +
> PED8 parcial (alertas)**. Quedan diferidos a propósito: **PED6** completo (bolsa de pedidos batch +
> staging + listas imprimibles), K3 de PED8 (exportes), y varios gaps puntuales documentados más
> abajo (devolución automática al cancelar con venta real, des-pickeo de tareas encadenadas a un
> reabastecimiento, CC sin validar morosidad, editor granular de roles por transición). Nada de esto
> pasó por PR/commit todavía — verificar `git status` antes de asumir que algo llegó a `dev`.

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

## PED1 — Schema (mig 292, EN DEV, NO en PROD)

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
  - Fecha de entrega solicitada (date picker).
  - Flag `requiere_envio` (checkbox) — "si no, es retiro en local, no se toca el módulo Envíos".
  - Buscador de productos por nombre/SKU (catálogo, no LPN — eso se resuelve al lanzar, PED3) → agrega
    líneas con cantidad, estado de inventario opcional (`estado_id`, si el tenant tiene alguno
    configurado) y atributos opcionales (talle/color/"otro atributo").
  - Notas de cabecera.
  - "Guardar borrador" → inserta `pedidos` + `pedido_items` en una transacción del cliente (dos
    inserts secuenciales), `logActividad` entidad `'pedido'`.
- **Confirmar** (borrador→confirmado) y **Cancelar** (con `window.confirm`) — ambas mutaciones
  `logActividad` con `accion: 'cambio_estado'`.

**Probado en vivo** contra el navegador real (Playwright): un pedido real creado y confirmado en el
tenant "Almacén Jorgito" (DEV), datos de prueba limpiados después.

`logActividad` — entidad nueva **`'pedido'`** sumada a `src/lib/actividadLog.ts` (`EntidadLog`) y a
los mapas de íconos/labels de `HistorialPage.tsx`, para que el historial pueda mostrar altas y cambios
de estado de Pedidos igual que cualquier otro documento.

---

## PED3 — "Lanzar" (mig 294, EN DEV, NO en PROD)

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

## PED4 — "Entregar" genera la venta real (migs 295 + 297, EN DEV, NO en PROD)

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
cualquier estado no terminal salvo `entregado_parcial` (con `window.confirm`); en el detalle
expandido de un pedido lanzado, cada tarea de picking `completada` DIRECTA (sin
`tarea_precedente_id`) tiene un link "Deshacer" que abre un modal para elegir la ubicación destino.

---

## PED7 — Config (`src/pages/ConfigPage.tsx`, sin migración nueva, EN DEV)

Tab nuevo **"Pedidos"** gateado por modo avanzado (mismo criterio que "Envíos"), con:

- **Numeración**: tenant vs. sucursal (`tenants.pedido_numeracion`, radio buttons).
- **Cierre automático**: toggle `tenants.pedido_cierre_automatico`.
- **CRUD de `tipos_pedido`**: nombre, momento de factura (al confirmar/al entregar), cliente
  obligatorio, activar/desactivar — mismo patrón visual que "Zonas" (WMS).

**Diferido a propósito:** editor granular de `pedido_transiciones_roles` (E3) — los defaults ya
funcionan (DEPOSITO/SUPERVISOR/OWNER/ADMIN pueden todas las transiciones), es fine-tuning que no
bloquea el uso real del módulo.

---

## PED8 — Alertas (parcial — K2 del relevamiento; K1 cubierto por el filtro existente; K3 diferido)

`src/hooks/useAlertas.ts` (badge del sidebar) y `src/pages/AlertasPage.tsx` (`/alertas`) ganaron 2
fuentes nuevas, solo modo avanzado:

- **Pedidos con entrega vencida** (`fecha_entrega_solicitada` pasada, estado no terminal).
- **Pedidos lanzados sin avanzar** (`en_preparacion` hace más de 24hs).

Ambas suman al conteo del badge y tienen su sección propia en `/alertas` con link directo a
`/pedidos`/`/picking`. **K1** (pedidos pendientes de lanzar agrupados por fecha) se cubre con el
filtro de estado que ya existía en `/pedidos` — no se construyó un dashboard separado. **K3**
(exportar a Excel/PDF/CSV) **queda diferido, no implementado**.

---

## PED6 — Bolsa de pedidos + staging + listas imprimibles — DIFERIDO EN SU TOTALIDAD

Decisión consciente: es la fase más compleja del roadmap (lanzamiento batch de N pedidos con
ubicación de staging elegida + agregar `'staging'` al CHECK de `ubicaciones.tipo_ubicacion`, hoy
`picking/bulk/estiba/camara/cross_dock` + listas de picking imprimibles como fallback de escaneo) y
la de menor urgencia — cada pedido ya se lanza individualmente, que es 100% funcional. Construir
staging/batch a medias, sin la UI de lanzamiento batch que los usaría, hubiera sido superficie sin
valor real. Próxima fase completa cuando GO la priorice.

---

## Roadmap por fases (PED1-PED8) — todo excepto PED6/K3 construido y verificado

Mismo criterio que Envíos 2.0 (EN1-EN7) / RRHH 2.0 (RH1-8) / Compras (CO1-CO8): cada fase se
construye, se prueba contra datos reales en DEV y se versiona por separado — no se deploya nada a
PROD hasta que GO lo pida (mismo criterio que el resto del WMS, feature sobre movimiento real de
stock).

| Fase | Qué | Estado |
|---|---|---|
| **PED1** | Schema: `pedidos`/`pedido_items`/`tipos_pedido`, numeración, estados, permisos base | ✅ mig 292 |
| **PED2** | UI armar Pedido: carrito sin precio, cliente, fechas, tipo, sucursal, atributos/estado de inventario por línea, KITs | ✅ (PedidosPage.tsx) |
| **PED3** | **"Lanzar"**: `fn_generar_tareas_picking_pedido`, reserva de stock real (`inventario_lineas.cantidad_reservada`), validación bloqueante ("no hay stock — faltan N unidades"), envío condicional (`requiere_envio` → `envios.pedido_id`) | ✅ mig 294 |
| **PED4** | Cumplimiento parcial: entregas en tandas (línea "parcial" con `cantidad − cantidad_entregada` visible, mismo patrón que `recepcion_items`), N ventas por Pedido, cierre automático/manual (`tenants.pedido_cierre_automatico`) | ✅ migs 295+297 |
| **PED5** | Cancelación y des-pickeo: `fn_pedido_deslanzar`/`fn_cancelar_pedido` a nivel Pedido, flujo de **un-pick** (RPC `fn_unpick_tarea_wms`, inversa de `fn_completar_tarea_reabastecimiento`) — solo picking DIRECTO, encadenado a reabastecimiento queda pendiente | ✅ mig 296 (parcial, ver gaps) |
| **PED6** | Operación avanzada de depósito: **bolsa de pedidos** (lanzamiento batch de N pedidos con ubicación de staging elegida) + listas de picking imprimibles (PDF/HTML fallback) | ⬜ **diferido a propósito** |
| **PED7** | Config: tab "Pedidos" en Configuración (numeración, tipos, cierre automático) — falta `pedido_transiciones_roles` (E3, diferido) | ✅ (ConfigPage.tsx, parcial) |
| **PED8** | Reportes y alertas: K1 (cubierto por filtro existente) + K2 (entrega vencida + sin avanzar 24h) ✅ · K3 (exportes) ⬜ diferido | 🟡 parcial |
| *(fuera de Pedidos)* | Roles configurables por tenant (Picker/Auditor/Gruero) — iniciativa aparte, sin arrancar | ⬜ |

### Gaps documentados (no bloquean el uso real, pendientes para retomar)

- **Devolución automática al cancelar un pedido con venta real (A5)**: hoy `fn_cancelar_pedido`
  BLOQUEA si el pedido ya generó una venta (en vez de dispararle la devolución automáticamente) —
  hay que devolver la venta a mano desde Ventas → Historial primero.
- **Des-pickeo de una tarea encadenada a un reabastecimiento**: `fn_unpick_tarea_wms` solo funciona
  para picking DIRECTO (sin `tarea_precedente_id`); la UI oculta "Deshacer" para el resto.
- **Cuenta Corriente en Pedidos sin validar morosidad/límite de crédito** (Ventas sí lo hace, client-side).
- **`pedido_transiciones_roles` (E3)** sin editor — los defaults (DEPOSITO/SUPERVISOR/OWNER/ADMIN
  pueden todo) ya funcionan.
- **K3 (exportar a Excel/PDF/CSV)** no implementado.
- **PED6 completo** (bolsa de pedidos + staging + listas imprimibles) diferido.

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

## Links relacionados

- [[wiki/features/wms]] — schema/RPCs de `wms_tareas` que Pedidos reusa desde PED3; `fn_completar_tarea_reabastecimiento`
  (mig 290) recibió un fix compartido en la mig 297 encontrado al construir PED4 (ver ahí)
- [[wiki/features/estructuras-udm]] — roadmap del que nació la discusión de picking; Fase 2 (UdM al
  ingresar/rebajar, mig 293) es un feature paralelo de la misma sesión, sin relación directa con Pedidos
- [[wiki/features/ventas-pos]] — Pedidos nunca pasa por `registrarVenta()`; el precio se resuelve
  directo en `fn_pedido_generar_venta` (PED4) sin usar el sistema de precio por nivel/lista de Ventas
  (gap documentado arriba); la factura AFIP se emite manualmente desde ahí (Historial → Facturar)
- [[wiki/features/clientes-proveedores]] — cliente existente o "nombre suelto" (I2)
- [[wiki/features/configuracion]] — tab "Pedidos" (PED7): numeración, cierre automático, tipos de pedido
- [[wiki/database/migraciones]] — migs 292, 294, 295, 296, 297
- `G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md` — las 45 preguntas + respuestas + diseño
  completo, fuente de esta página
- `G360.Wiki/sources/raw/relevamiento_descuentos_respuestas.md` — relevamiento nuevo capturado de
  paso durante esta sesión (Descuentos), sin relación con Pedidos, sin implementar todavía
- `tests/e2e/107_pedidos_ciclo_completo_mutante.spec.ts` — e2e del ciclo completo (lanzar con
  reabastecimiento → completar → entregar; deslanzar), verifica explícitamente el fix de la mig 297
