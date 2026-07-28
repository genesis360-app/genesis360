---
name: relevamiento_pedidos_respuestas
description: Respuestas de GO al relevamiento del módulo NUEVO Pedidos + diseño consolidado, hallazgos nuevos (des-pickeo, staging, bolsa de pedidos, roles configurables) y plan por fases (PED1-PED8)
type: project
---

# Relevamiento Pedidos (módulo NUEVO) — respuestas + diseño

> Relevado con GO (HTML `relevamiento-pedidos-reglas-negocio.html`, secciones A-L).
> Respuestas crudas pasadas por GO el 2026-07-22, en la misma sesión donde se depuró el WMS de
> picking/reabastecimiento (v1.143.0, migs 289-291). Origen: GO probando el módulo a mano encontró un bug real
> (LPN fantasma al reabastecer sobre una venta ya despachada, fix mig 291) y eso disparó la pregunta de fondo:
> "¿por qué el picking depende de una venta de mostrador ya rebajada?". De ahí nace Pedidos como documento
> propio. **Todavía no hay una sola línea de código de este módulo — es 100% diseño.**

## Estado actual (código real, para no reinventar)

- `VentasPage.tsx → registrarVenta(estado)`: único camino a `ventas`/rebaje/factura hoy. `despachada` rebaja
  stock real de forma síncrona + crea `envío` + factura en el mismo insert. `reservada` solo incrementa
  `cantidad_reservada` (sin tocar stock real, sin facturar), y no vence ni se conecta con el depósito salvo
  despacho manual.
- WMS (migs 289-291, `wms_tareas`): `fn_generar_tareas_picking_envio(envio_id)` genera tareas desde
  `venta_item_despachos` (venta ya despachada — nunca reabastece, fix del LPN fantasma) o
  `venta_items.lpn_plan` (reserva pendiente — sí reabastece). **Hoy no está conectada a ningún botón/trigger
  del frontend.** `fn_cancelar_tarea_wms` cancela en cascada reabastecimiento→picking dependiente.
- Precedentes de diseño reusados en las respuestas: Traslados (`traslados`/`traslado_items`, estado
  `en_transito`), OC+Recepciones (`ordenes_compra`/`recepcion_items`, recepción parcial), `canales_venta`
  (catálogo configurable por tenant).

## Leyenda

**Resp GO** = lo elegido (letra de opción, o texto libre si no encajaba en ninguna). **Diseño** = cómo se
traduce a implementación. **💡** = recomendación mía donde GO pidió mi opinión o dejó la puerta abierta.

---

## A — Relación con Ventas y el motor de rebaje

| # | Resp GO | Diseño |
|---|---|---|
| A1 | **B** | Pedidos **no** pasa por `registrarVenta()`/POS. Función propia (`fn_pedido_generar_venta` o similar) que reusa **solo** la lógica de rebaje/movimientos (misma mecánica de `inventario_lineas`/`movimientos_stock` que ya usa Ventas), para no arrastrar UI/estado de POS que no aplica. |
| A2 | **A + B** | "Venta directa"/"Reservar stock" del POS quedan **intactos, sin tocar**. Se suma un botón **"Convertir a Pedido"** desde una reserva existente de Ventas, para el caso borde de alguien que empezó por el camino equivocado. |
| A3 | **A** | Coexisten sin regla dura — el operador elige "Reservar" (mostrador, corto plazo) o "Pedido" (logística, mayor plazo) a criterio. No se fuerza ninguna migración de uno a otro. |
| A4 | **C** | Ambos: `ventas.pedido_id` (cabecera) **y** `venta_items.pedido_item_id` (línea) — necesario igual por G2 (un Pedido puede generar N ventas si hay entregas parciales). |
| A5 | **B** | Pedidos tiene su propio "Cancelar Pedido", que por debajo dispara la devolución de la(s) venta(s) asociada(s) (reusa el flujo de devoluciones ya existente en `VentasPage.tsx`, sin UI propia duplicada). |

## B — Momento de facturación

| # | Resp GO | Diseño |
|---|---|---|
| B1 | **C** | Configurable **por tipo de Pedido** (`tipos_pedido.factura_momento`: `al_confirmar` \| `al_entregar`). Mayorista puede facturar al confirmar, retiro en local recién al entregar. |
| B2 | **A + B** | Anticipo/seña: ingreso en caja **sin comprobante fiscal** (igual que hoy) **+ recibo interno PDF** opcional (no AFIP) como respaldo para el cliente. |
| B3 | **A + B** | Si el Pedido ya facturó (venta real emitida): NC como cualquier venta facturada. Si es **solo el anticipo** (sin entrega todavía, nada facturado): se anula con un simple egreso de caja, sin NC. |
| B4 | **A** | Sin cambios respecto a Ventas — el tipo de comprobante (A/B/C) lo decide únicamente la condición IVA del emisor/receptor, el tipo de Pedido no lo fuerza. |

## C — Cabecera del Pedido

| # | Resp GO | Diseño |
|---|---|---|
| C1 | **B** | Correlativo **por sucursal**, configurable como en OC (`tenants.pedido_numeracion`: `tenant` \| `sucursal`). |
| C2 | **B** | Catálogo `tipos_pedido` configurable por tenant, mismo patrón que `canales_venta` (CRUD en Config). |
| C3 | **C** | Cliente obligatorio **depende del tipo de Pedido** — flag `tipos_pedido.cliente_obligatorio`, tildable por tipo (ej. Mayorista sí, Encargo telefónico no). |
| C4 | **A** | Cabecera lleva solo **fecha de entrega solicitada** (por el cliente). No hay campo separado "comprometida" — 💡 ver nota en F4: si más adelante se necesita priorizar por SLA propio del negocio (distinto de lo que pidió el cliente), agregar `fecha_comprometida` es aditivo y no bloquea el arranque. |
| C5 | **A** | Una sola sucursal (origen = donde se prepara/despacha), igual que Ventas. Sin traslado entre sucursales dentro de un mismo Pedido. |
| C6 | **C** | No aplica catálogo de canal aparte — el "tipo de pedido" (C2) ya cumple ese rol. |

## D — Líneas del Pedido

| # | Resp GO | Diseño |
|---|---|---|
| D1 | **B + estado** | `pedido_items`: producto/SKU, cantidad, **estado de línea** (ver E2), atributos opcionales (talle/color/lote si el cliente los pide) — mismo espíritu que `traslado_items`. **Sin precio** (ver H1). |
| D2 | **B** | Serie/lote específico es **opcional** al armar — si el cliente lo pide, queda anotado como preferencia pero **no bloquea stock** hasta que se lanza (ahí sí se resuelve el LPN real, igual que `lpn_plan` hoy). |
| D3 | **A** | KITs se admiten igual que en Ventas — se abren en sus componentes al lanzar (reusa la lógica de kitting existente). |
| D4 | **A** | Editable libremente en borrador. Una vez lanzado (tareas WMS generadas) **no se edita** — se cancela (F5) y se rehace. |

## E — Estados del ciclo de vida

| # | Resp GO | Diseño |
|---|---|---|
| E1 | **A** | `borrador → confirmado → en_preparacion → listo_para_entrega → entregado → cancelado`. |
| E2 | **A** | Línea: `pendiente / en_preparacion / preparado / faltante / cancelada`. |
| E3 | **Configurable por rol, DEPOSITO puede hacer todas las transiciones** | No es ni (a) ni (b) tal cual — nueva tabla `tenants.pedido_transiciones_roles` (jsonb, mismo patrón que `ajuste_autorizacion_roles`, mig 228) mapeando transición→roles permitidos. Default: DEPOSITO puede ejecutar **cualquier** transición (crear→confirmar→lanzar→preparar→entregar), SUPERVISOR/OWNER también; el resto configurable por tenant. |
| E4 | **A + B + "des-pickeo" (NUEVO, no estaba en las opciones)** | Cancelar solo lo que está **pendiente** (a). Lo que ya se pickeó (en_curso/completado) **no se cancela directo** — requiere un flujo nuevo de **"un-pick"**: 1) el operador escanea el LPN que se había pickeado, 2) el sistema lo identifica y lo desvincula del Pedido/línea (esa cantidad vuelve a figurar **pendiente** en la línea), 3) el operador elige una ubicación destino para reubicar ese LPN físicamente, 4) el inventario deja de estar "reservado para este pedido". Requiere: nueva RPC `fn_unpick_tarea_wms(p_tarea_id, p_ubicacion_destino_id)` (inversa de `fn_completar_tarea_picking`, mueve el LPN igual que `fn_completar_tarea_reabastecimiento` pero en sentido reverso) + UI de escaneo en `/picking` o pantalla dedicada. **Va a Fase PED6** (no bloquea el arranque). |
| E5 | **A** | Sin vencimiento — quedan en borrador indefinidamente hasta confirmar/borrar a mano. |

## F — "Lanzar" el Pedido → generación de tareas

| # | Resp GO | Diseño |
|---|---|---|
| F1 | **A** | Nueva RPC `fn_generar_tareas_picking_pedido(pedido_id)` (análoga a `fn_generar_tareas_picking_envio` pero arranca desde `pedido_items`, no desde un envío/venta existente). |
| F2 | **C + flag "con envío"/"sin envío"** | Cabecera del Pedido lleva `requiere_envio boolean`. Si `true`: al lanzar se auto-crea un `envío` vinculado al Pedido (**`envios.pedido_id` nuevo**, nullable, coexiste con `envios.venta_id` que se completa recién cuando exista la venta real). Si `false` (retiro en local): el módulo Envíos ni se toca. |
| F3 | **A** | Mismos flags `wms_reabastecimiento_on_demand`/`_umbral` que hoy — Pedidos es solo otro `origen` en `wms_tareas` (`'pedido'`, se suma a `'envio'`/`'manual'`/`'umbral'`), sin comportamiento nuevo de reabastecimiento. |
| F4 | **🛑 D — pivote de arquitectura, no una opción de la lista** | GO fue explícito: **"Ventas no tiene que generar tareas... las tareas (picking y replen) deben ser solo para los pedidos."** Esto es un cambio de alcance importante respecto a lo que se construyó esta semana: `fn_generar_tareas_picking_envio` (Fuente 1/Fuente 2, migs 290-291) queda como **código muerto en la práctica** — nunca se la va a llamar desde el flujo de Ventas normal (ya era coherente con que hoy no está conectada a ningún botón). Ventas (mostrador/kiosco) vuelve a ser 100% lo que siempre fue: rebaje inmediato, sin picking. Todo el picking/reabastecimiento pasa a nacer **exclusivamente** desde Pedidos (`fn_generar_tareas_picking_pedido`, F1). 💡 No hace falta revertir el fix de la mig 291 — sigue siendo correcto para el caso hipotético de que alguien la invoque a mano — pero no hay que construir ningún botón en `EnviosPage.tsx`/`VentasPage.tsx` que la dispare. Prioridad de la cola (la pregunta original de F4) deja de tener sentido: si Ventas no genera tareas, no hay competencia entre orígenes. |
| F5 | **A** | Se puede volver a borrador cancelando todas las tareas WMS generadas (mismo criterio que `fn_cancelar_tarea_wms`), solo si ninguna está `en_curso`/`completada` (si ya hay algo pickeado, pasa por el flujo de un-pick de E4 primero). |

## G — Cumplimiento parcial / entregas en varias tandas

| # | Resp GO | Diseño |
|---|---|---|
| G1 | **A** | Sí — mismo espíritu que Recepciones de OC: cada entrega registra cuánto se cumplió por línea, el Pedido queda "parcial" hasta completarse. |
| G2 | **C — Pedidos trabaja autónomo, vínculo a venta opcional** | No es ni (a) ni (b) tal cual: Pedidos **no depende** de generar una venta para funcionar (podría, en teoría, operar sin nunca facturar si el tenant así lo configura), pero **si** genera venta(s), cada entrega parcial que active envío genera su propio envío independiente (`envios.pedido_id` + `pedido_id` repetido en `ventas` agrupa todo — confirma A4=C). |
| G3 | **GO pidió mi recomendación explícitamente** | 💡 **Recomiendo (a) del cuestionario original**: la línea queda "parcial" con cantidad pendiente visible (`cantidad_pedida − cantidad_entregada`), igual que `recepcion_items` — es el patrón que ya está probado y en producción (Compras/Recepciones), no rompe nada nuevo, y es el más flexible para el cliente/operador (no obliga a decidir de antemano en cuántas tandas se va a entregar). Evitar la opción (b) ("línea nueva por el saldo") porque duplica filas y complica el reporte de cumplimiento (K1-c) sin necesidad. |
| G4 | **C — configurable ambas** | `tenants.pedido_cierre_automatico boolean` (default true = cierra solo al llegar a 100%; false = requiere confirmación manual). **+ requerimiento nuevo de UI**: agregar tab **"Pedidos"** en Config (junto a "Zonas y picking" de Inventario), que centralice `pedido_numeracion` (C1), `tipos_pedido` (C2), `pedido_transiciones_roles` (E3), `pedido_cierre_automatico` (G4) y los flags de reabastecimiento que hoy viven en Inventario → Zonas y picking (evaluar si se mudan o se linkean desde ahí). |

## H — Precios y stock: al crear vs. al lanzar/entregar

| # | Resp GO | Diseño |
|---|---|---|
| H1 | **GO pidió mi opinión: "los precios es mejor que los manejen en el POS... ¿te parece?"** | 💡 **De acuerdo, y lo simplifica más de lo que parece**: si `pedido_items` **no lleva precio en absoluto** (ni snapshot ni recálculo), la pregunta original de H1 (fijo vs. recalcula) directamente deja de aplicar — el precio se resuelve una sola vez, en el POS, en el momento en que el Pedido genera la venta real (A1). Pedidos queda como documento 100% de **cantidad/logística**, Ventas sigue siendo dueña exclusiva de precio/descuento/impuesto — separación limpia, menos superficie de bugs fiscales (Regla de oro #0: un solo lugar calcula plata). |
| H2 | **B + detalle** | Se valida en ambos momentos: al **armar**, alerta no bloqueante si no alcanza (es una intención de compra, puede que llegue stock después). Al **lanzar**, bloqueo duro con mensaje específico por línea: *"No hay stock para [producto] SKU [xx] — faltan N unidades"*. |
| H3 | **A** | Sin plazo — el Pedido en borrador queda válido hasta que se lance o cancele explícitamente (consistente con E5). |
| H4 | **A** | "Lanzar" reserva stock real (`inventario_lineas.cantidad_reservada`) igual que "Reservar stock" hoy — así dos Pedidos (o un Pedido y una venta de mostrador) no compiten por el mismo LPN sin que el sistema lo sepa. |

## I — Cliente y condición de venta

| # | Resp GO | Diseño |
|---|---|---|
| I1 | **B** | Pedidos con cuenta corriente requieren aprobación adicional del SUPERVISOR (monto/plazo típicamente mayor que venta de mostrador). |
| I2 | **B** | Se admite nombre/teléfono suelto sin alta formal de cliente, igual que venta directa hoy (dato: contradice parcialmente C3 si el tipo de pedido exige cliente obligatorio — a resolver en diseño de detalle: "cliente obligatorio" puede cumplirse con nombre/teléfono suelto, no necesariamente alta formal). |
| I3 | **A** | Reusa `cliente_domicilios` igual que Envíos hoy, más la opción "Retiro en sucursal". |

## J — Permisos y roles

| # | Resp GO | Diseño |
|---|---|---|
| J1 | **Depósito, Supervisor y Dueño** (no coincide exacto con ninguna opción — excluye CAJERO explícitamente) | Crear Pedidos: **DEPOSITO + SUPERVISOR + OWNER (+ADMIN)**. A diferencia de Ventas, CAJERO **no** participa — Pedidos se trata como operación logística desde el vamos, no comercial de mostrador. |
| J2 | **Depósito, Supervisor y Dueño** | Mismos roles que J1 pueden lanzar, sin aprobación adicional separada (no hay una capa extra tipo `oc_aprobacion_activa`). |
| J3 | **Depósito, o roles NUEVOS configurables a demanda (Picker, Auditor, Gruero, etc.) — pedido fuera del alcance original** | 🛑 Esto excede Pedidos: pide **roles custom por tenant** (más allá del enum fijo OWNER/ADMIN/SUPERVISOR/DEPOSITO/CAJERO/CONTADOR). Es una iniciativa propia — sistema de permisos granular/configurable — que Pedidos usaría pero no debería bloquear su arranque. 💡 Recomendación: Fase 1 de Pedidos usa los roles existentes (DEPOSITO hace el picking, igual que hoy); "roles configurables" queda como iniciativa aparte a relevar cuando haya prioridad, documentada acá para no perderla. |
| J4 | **Resuelto por GO**: "cancelar/editar el pedido lo puede hacer el mismo que lo hizo y también el supervisor, admin y dueño" | Cancelar/editar un Pedido ya lanzado: **quien lo creó/lanzó** (autor de la acción) **+ SUPERVISOR/OWNER/ADMIN siempre**, con audit log. No es una restricción cerrada a un rol fijo — se calcula contra `creado_por`/`lanzado_por` de ese Pedido en particular, más el piso de SUPERVISOR+. |

## K — Reportes y alertas

| # | Resp GO | Diseño |
|---|---|---|
| K1 | **Todos** | Pedidos pendientes de lanzar (agrupados por fecha de entrega) + Pedidos con entrega vencida + Cumplimiento por tipo de Pedido (% a tiempo vs. tarde). |
| K2 | **Todos** | Pedido lanzado sin avanzar hace más de N horas + Pedido con fecha de entrega vencida sin completar. Badge de Alertas (ya mode-aware) suma estos casos. |
| K3 | **A** | Excel + PDF + CSV, consistente con el resto de los módulos. |

## L — Prioridad y hallazgos nuevos

| # | Resp GO |
|---|---|
| L1 | **"Indistinto, quiero todo implementado"** — no prioriza un top-3. 💡 Esto define el **alcance final** (todo lo relevado, sin recortes), no el **orden de entrega** — igual conviene fasear la construcción (ver plan abajo) para poder probar y deployar cada pieza contra datos reales, como se hizo con Envíos 2.0/RRHH 2.0/Compras. No implica sacar nada de la lista, solo secuenciarla. |

### Hallazgos nuevos de L2 (comentarios libres) — no estaban en el cuestionario original

1. **FIFO/FEFO + estado de inventario por línea**: cada línea de Pedido debe poder indicar de qué **estado de inventario** (catálogo de Config/Inventario/Estados, ej. "Disponible", "Próximo a vencer") hay que pickear, además de SKU/cantidad/atributos — el picking tiene que respetar FIFO/FEFO igual que hoy lo hace `rebajeSort.ts`/reabastecimiento. Se suma `pedido_items.estado_inventario_id` (FK a `estados_inventario`, opcional — si no se especifica, aplica FEFO/FIFO estándar).
2. **Listas de picking imprimibles**: fallback para cuando el escaneo mobile/RF falla — un PDF/HTML imprimible por Pedido (o por bolsa, ver #3) que liste qué pickear, desde dónde, hacia dónde. Mismo espíritu que el remito PDF que ya existe en Envíos.
3. **Lanzamiento en "bolsa de pedidos" (batch) + ubicaciones de staging (NUEVO)**: "lanzar" no es necesariamente 1 Pedido a la vez — se puede seleccionar un **grupo de Pedidos** ("bolsa"), generar las tareas de todos juntos, y en ese momento elegir la **ubicación de destino** (staging) donde va a converger la mercadería antes de despacharse. Requiere: (a) agregar `'staging'` al CHECK de `ubicaciones.tipo_ubicacion` (hoy `picking/bulk/estiba/camara/cross_dock`, migration 032) — las ubicaciones tipo staging son las que se ofrecen al lanzar; (b) tabla `pedido_lanzamientos` (o `wms_bolsas`) que agrupa N `pedido_id` + la ubicación de staging elegida, de la que cuelgan las `wms_tareas` generadas (probablemente `wms_tareas.bolsa_id` nuevo, o reusar `origen='pedido'` + un `lanzamiento_id`).

---

## Plan por fases (propuesto, a confirmar con GO antes de arrancar)

Mismo criterio que Envíos 2.0 (EN1-EN7)/RRHH 2.0 (RH1-8)/Compras (CO1-CO8): cada fase se construye, prueba
contra datos reales en DEV y se versiona por separado — no se deploya nada a PROD hasta que GO lo pida
(mismo criterio que el resto del WMS, movimiento real de stock).

- **PED1 — Schema + cabecera/líneas**: tablas `pedidos`/`pedido_items`/`tipos_pedido`, numeración (C1),
  estados (E1/E2), permisos base de creación (J1, sin roles configurables — eso es J3, aparte).
- **PED2 — UI armar Pedido**: pantalla tipo carrito (sin precio, ver H1), cliente (I1-I3), fechas, tipo,
  sucursal, atributos/estado de inventario por línea (hallazgo L2-1), KITs (D3).
- **PED3 — "Lanzar"**: `fn_generar_tareas_picking_pedido` (F1), reserva de stock real (H4), validación
  bloqueante (H2), envío condicional (F2, `envios.pedido_id`).
- **PED4 — Cumplimiento parcial**: entregas en tandas (G1-G3), N ventas por Pedido (A4, G2), cierre
  automático/manual (G4).
- **PED5 — Cancelación y des-pickeo**: `fn_cancelar_tarea_wms` a nivel Pedido (F5), flujo completo de
  un-pick con escaneo (E4).
- **PED6 — Operación avanzada de depósito**: bolsa de pedidos + ubicaciones de staging (L2-3), listas de
  picking imprimibles (L2-2).
- **PED7 — Config**: tab "Pedidos" en Configuración (G4), consolidando numeración/tipos/roles/cierre.
- **PED8 — Reportes y alertas**: K1/K2/K3.
- *(Fuera de Pedidos, iniciativa aparte si GO la prioriza más adelante)*: roles configurables por tenant
  (J3 — Picker/Auditor/Gruero).
