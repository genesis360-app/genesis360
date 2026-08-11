---
title: Módulo Repositores
category: features
tags: [repositores, precios, etiquetas, gondola, prioridad, roles-custom, modo-avanzado]
sources: [migration 352, relevamiento_repositores_respuestas.md, project_backlog_fede_comercial_25_7.md, src/pages/RepositoresPage.tsx, src/pages/ProductoFormPage.tsx, src/pages/UsuariosPage.tsx, src/components/layout/AppLayout.tsx]
updated: 2026-08-11
---

# Módulo Repositores

> 🟡 **Fase 1 (núcleo + disparadores + prioridad) CONSTRUIDA Y VERIFICADA EN DEV (mig 352,
> 2026-08-11) — NO deployada a PROD todavía.** Es un módulo nuevo, no un fix: se le preguntó a GO si
> deployar ahora o esperar más revisión (de él o de Fede) antes de subirlo — sin respuesta al cierre
> de la sesión que lo construyó. Confirmar el estado real (`gh pr list`, `git log origin/main`) antes
> de asumir que sigue en DEV.

Módulo para que la persona que repone mercadería en el local sepa, sin tener que acordarse ni
recorrer la góndola, **qué cartel de precio hay que cambiar** — cada vez que un precio cambia o un
producto entra en un estado con descuento (ej. "Próximo a vencer -15%"), aparece sola una tarea.

Es la **Fase E** del backlog de reglas de negocio que mandó Fede el 25/7/2026 (ver
[[project_backlog_fede_comercial_25_7]] en memoria) — la última de 5 fases (F/A/B/C/D ya en PROD
desde antes). El relevamiento original tenía 35 preguntas en 12 secciones (A-L); quedó bloqueado
hasta cerrar 3 relevamientos derivados (Ubicaciones, Pestaña de Supervisor, Motor de Rotación — los 3
ya en PROD) y 3 decisiones de negocio (A1/A2-B3/H1, cerradas por GO el 2026-08-11). Con todo eso
resuelto, el módulo es grande de más para construir de una — se partió en **fases**, mismo criterio
que ya usó el backlog de Comercial (F→A→B→C→D):

- **Fase 1 (esta, ✅ construida)**: núcleo del módulo + disparadores automáticos + prioridad.
- **Fases futuras (sin arrancar)**: reposición física de stock a góndola (requiere I3, ver abajo),
  asignación/reasignación de tareas vía la Pestaña de Supervisor (ya existe el patrón genérico, ver
  [[wiki/features/supervision]]), etiquetas + impresión (PDF pensado para servir también en
  impresoras térmicas Zebra, decisión de GO), notificaciones, reportes.

## Qué hace la Fase 1

Dos disparadores automáticos, **write-time vía trigger de DB** (nunca heurística de lectura — mismo
criterio que el resto del ledger de trazabilidad del proyecto, ver mig 155), que generan o actualizan
una tarea en la tabla `tareas_repositor`:

1. **Cambio de precio** — trigger `fn_generar_tarea_repositor_precio`, `AFTER UPDATE OF precio_venta
   ON productos`. Cubre TODOS los puntos de entrada existentes por ser un trigger de DB, no una
   llamada desde el frontend: edición individual (`ProductoFormPage.tsx`), importador CSV
   (`ImportarProductosPage.tsx`), y el repricing automático por margen (D3, mig 346/347) — este
   último no tiene ningún código de frontend, así que un hook a nivel de página nunca lo hubiera
   cubierto.
2. **Entrada a un estado con descuento** — trigger `fn_generar_tarea_repositor_estado`, `AFTER UPDATE
   OF estado_id ON inventario_lineas`, solo si `estados_inventario.descuento_pct > 0`. Cubre por
   igual el camino directo (`LpnAccionesModal.tsx`), la aprobación con foto (mig 331,
   `aprobar_cambio_estado_inventario`) y la edición MASIVA (`InventarioPage.tsx`
   `bulkCambiarEstado`) — **1 sola tarea por SKU** aunque se editen muchas líneas a la vez (B1 del
   relevamiento), gracias al dedupe.

**Ninguno de los dos dispara si**:
- El producto no tiene una ubicación de exhibición asignada en esa sucursal (ver abajo), o esa
  ubicación no es de tipo Góndola.
- El tenant no está en `modo_operacion = 'avanzado'`.

### Ubicación de exhibición — el gap que había que tapar primero

`producto_ubicacion_sucursal.ubicacion_exhibicion_id` existe desde la mig 335 (rediseño de
Ubicaciones, v1.157.0) — se agregó explícitamente como preparación para este módulo. Pero **nunca se
construyó ninguna UI para setearla** — sin eso, los triggers de la Fase 1 no iban a tener nada para
disparar nunca. Se agregó el campo **"Ubicación de exhibición (góndola)"** en `ProductoFormPage.tsx`
→ "Stock e inventario" (modo avanzado, por sucursal activa), mismo patrón que "Ubicación
predeterminada" que ya existía ahí — filtrado a ubicaciones con `tipo_logico = 'exhibicion'`. Sin
asignar esto para un producto, el módulo simplemente no genera tareas para él (no es un error, es el
comportamiento esperado — el producto puede no tener presencia en góndola, ej. si es Mostrador/
Depósito puro).

### Prioridad automática (C1-C3 del relevamiento, definida por Fede)

La lista de tareas se ordena así, siempre, sin que nadie la configure:

1. **Se vendió algo de ese producto en esa sucursal DESPUÉS de que nació la tarea** (el cartel sigue
   desactualizado y ya hubo una venta con el cliente viéndolo mal) — máxima prioridad. Riesgo real de
   reclamo.
2. **El precio NUEVO es más alto que el viejo** — cobrar de más es peor de cara a Defensa del
   Consumidor que cobrar de menos.
3. **Cercanía a vencimiento** (solo aplica a tareas `cambio_estado`, vía `inventario_lineas.
   fecha_vencimiento` de la línea que disparó la tarea).
4. **Más vieja primero** — desempate final por tiempo pendiente.

Esto se calcula en la vista `vw_tareas_repositor`, **en cada lectura, nunca cacheado** — el criterio
#1 en particular es explícitamente dinámico: si hoy la tarea no tiene ninguna venta posterior, pero
mañana sí, escala de prioridad sola sin que nadie la toque. Implementado con un `EXISTS`
correlacionado contra `venta_items`/`ventas` (índices existentes en `producto_id` y `sucursal_id`
la hacen razonablemente eficiente para el volumen que maneja el módulo).

### Dedupe — 1 tarea por SKU, no por evento

Un producto puede cambiar de precio o de estado varias veces mientras la tarea sigue pendiente (ej.
el repricing automático corre de nuevo antes de que alguien atienda el cartel). En vez de crear una
tarea nueva cada vez, se actualiza la existente — dedupe por `(producto_id, sucursal_id, tipo)`,
implementado con un `UNIQUE` índice parcial (`WHERE estado IN ('pendiente','en_curso')`) +
`INSERT ... ON CONFLICT ... DO UPDATE` en ambos triggers.

⚠️ **Nota de diseño**: la primera versión de este dedupe usaba el patrón `UPDATE ...; IF NOT FOUND
THEN INSERT` — se cambió a `ON CONFLICT` porque el patrón viejo tiene una race condition real bajo
concurrencia (dos UPDATEs simultáneos al mismo producto podían no verse entre sí y terminar creando 2
tareas duplicadas). Encontrado en el self-review de la migración (el subagente `migration-reviewer`
falló por el límite de gasto mensual de la cuenta — se revisó a mano contra el mismo checklist).

## Acceso y rol

- **A1 (rol custom, no rol nuevo)**: no hay un rol fijo `REPOSITOR` en el enum de `users.rol` — se
  delega vía `roles_custom` (mismo patrón que ya usa el módulo Comercial), agregando `'repositores'`
  a la lista `MODULOS` de `UsuariosPage.tsx`. El dueño crea un rol custom, elige un rol base (a
  definir cuál usa en la práctica — el nav item de `/repositores` está habilitado para
  `depositoVisible`/`cajeroVisible`, sin `ownerOnly`/`supervisorOnly`, para no cerrarle la puerta a
  ninguno de los dos como base) y oculta todo lo demás salvo Reposición.
- **A2/B3 (acceso default)**: GO delegó en el criterio del asistente — acceso default **SOLO a
  Reposición**, sin Inventario completo (evita exponer `precio_costo`/ajustes de stock de más que un
  repositor no necesita). El dueño lo suma a mano si quiere darle más.
- **I2 (gateo)**: Modo Avanzado únicamente, mismo criterio que Picking/Pedidos/Recepciones/Envíos.

## Lo que NO incluye la Fase 1 (a propósito)

- **Reposición física de stock a góndola** (mover mercadería real de depósito a la góndola) — depende
  de **I3**, ya resuelto por investigación de código pero sin construir: NO reusar
  `wms_tareas.tipo='replenishment'` (la función que elige destino filtra duro por
  `tipo_logico='picking'`, incompatible con góndola) — hace falta un tipo nuevo (ej.
  `reposicion_gondola`), reusando el MECANISMO de movimiento de stock pero no el tag. Mismo
  precedente que ya usó el proyecto al agregar `'armado'` (mig 345) para un caso análogo.
- **Asignación/reasignación de tareas** — hoy es una cola compartida sin asignar (mismo punto de
  partida que tuvo `wms_tareas` antes de tener asignación). La Pestaña de Supervisor reusable (mig
  347/348, [[wiki/features/supervision]]) ya existe como patrón — conectarla es la fase que sigue.
- **Etiquetas + impresión** (G/H del relevamiento) — diseño de etiqueta con precio por unidad grande
  (usa la conversión de `unidades_medida_fisicas` ya existente) + PDF pensado para servir también en
  una impresora térmica Zebra si el negocio tiene una (decisión de GO, sin impresión automática — un
  humano dispara la impresión).
- **Notificaciones** (J) y **reportes** (K).

## Verificación real (2026-08-11, contra DEV)

Con el tenant "Almacén Jorgito": se asignó "Góndola1" como ubicación de exhibición de un producto
real vía la UI → se cambió su precio dos veces por la UI real (`$555 → $777`) → la tarea
`cambio_precio` apareció en `/repositores` con `precio_anterior`/`precio_nuevo` correctos y el badge
"↗ Precio subió" → se cambió el `estado_id` de una línea real a un estado con `descuento_pct=15` →
apareció la tarea `cambio_estado` con el nombre y el % correctos → se completó una tarea desde la UI
y se confirmó el toast + el movimiento a la pestaña "Completadas". Todos los datos de prueba se
limpiaron después (precio, ubicación de exhibición y estado revertidos; tareas de prueba borradas) —
el tenant quedó exactamente como estaba antes de probar.

## Ver también

- [[project_backlog_fede_comercial_25_7]] (memoria) — estado completo del backlog de Fede, las 5
  fases, y el detalle de las decisiones A1/A2-B3/H1 que cerró GO.
- [[wiki/features/supervision]] — el patrón de Pestaña de Supervisor que va a usar la fase de
  asignación/reasignación.
- `G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md` — las 35 preguntas originales y sus
  respuestas completas, incluida la sección "Cierre de ambigüedades" que resolvió A1/A2/H1/C3/I3.
