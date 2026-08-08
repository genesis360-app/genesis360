---
name: relevamiento_ml_tn_combos_repricing_respuestas
description: Respuestas de Fede al relevamiento de reglas de negocio de Combos automáticos en TiendaNube (D2 del roadmap de integraciones) y Repricing automático por margen en MercadoLibre (D3 del roadmap), más una nota operativa sobre Mercado Envíos vs. envío propio.
type: project
status: ✅ RELEVAMIENTO 100% RESPONDIDO (2026-08-08) salvo la nota operativa C1 (dato pendiente de relevar con clientes reales) — LISTO PARA DISEÑAR/CONSTRUIR. Prioridad (D1/D2 del documento original) delegada a criterio de GO ("Tonga"). Nada de código construido todavía — este documento es 100% relevamiento.
source: relevamiento-integraciones-ml-tn-reglas-negocio.html
updated: 2026-08-08
---

# Respuestas — Relevamiento Reglas de Negocio · Integraciones ML/TN (Combos automáticos TN + Repricing automático MELI)

> **Estado:** el documento de preguntas (`relevamiento-integraciones-ml-tn-reglas-negocio.html`, raíz
> del repo) se armó el 2026-08-06, cuando las Fases 1.2 (TiendaNube — BOM combos) y 1.5 (MELI —
> Repricing) del roadmap de integraciones quedaron bloqueadas por falta de definición de negocio. Fede
> respondió por escrito el **2026-08-06**. GO pegó la respuesta completa el **2026-08-08** ("Tonga" es
> GO, no el asistente — ver [[reference_tonga_es_go]]). Con esta respuesta, **ambos bloques quedan 100%
> resueltos salvo la nota operativa C1** (dato, no decisión de diseño), que Fede no puede responder
> porque no opera un negocio real en Genesis360 hoy.

---

## ✅ Resumen ejecutivo

- **Bloque 1 (Combos TN, D2 del roadmap): 100% respondido**, con un modelo de datos claro
  (kit-como-SKU) + una idea nueva no pedida (ficha técnica de armado, opcional).
- **Bloque 2 (Repricing MELI, D3 del roadmap): 100% respondido**, con 2 mecanismos independientes
  definidos (ajuste por margen objetivo opt-in ÚNICO cross-canal, y ajuste por diferencial % PROPIO
  por canal).
- **Nota operativa (C1): NO resuelta** — Fede no tiene el dato real (no opera un negocio real en G360
  hoy); queda como dato a relevar con clientes reales. El DISEÑO de la pantalla (pestaña Envíos → sub-
  pestañas por canal → override por venta) SÍ quedó definido, independientemente del dato.
- **Prioridad (D1/D2 del documento original):** Fede no marcó prioridad — deja a criterio de GO
  ("Tonga") si hace falta ordenar el cierre de los puntos técnicos que quedaron abiertos, o si alcanza
  con lo ya resuelto para arrancar directo.
- **Nada de código construido todavía** — este documento es 100% relevamiento, listo para pasar a
  diseño técnico/construcción en una próxima sesión.

---

## Bloque 1 — Armado automático de kits en TiendaNube (D2 del roadmap)

| # | Respuesta de Fede | Resumen |
|---|---|---|
| A1 | Mixto, ni completamente automático ni completamente manual. Cuando hay stock suficiente de los componentes en las ubicaciones habilitadas para venta en ese canal (ej. las habilitadas para TiendaNube), el sistema genera automáticamente la tarea de armado — no arma el kit en silencio sin que nadie se entere (ver A4). En la práctica, además, la mayoría de los kits que se venden ya van a estar armados de antemano. | Combina las opciones (b)/(c) del documento original — no arma solo, genera tarea automática para que alguien confirme el armado. |
| A2 | (a) — mismo criterio todo-o-nada que ya usa el armado manual hoy. No arma nada y avisa si falta cualquier componente. | Confirmado tal cual — sin armado parcial, sin stock negativo (Regla de Oro #0). |
| A3 | Resuelta con un modelo propio, no una de las 3 opciones originales: el kit pasa a ser su propio SKU. Ese SKU de kit tiene su ubicación predefinida en su ficha, igual que cualquier producto. Si no tiene ubicación predefinida, el sistema define automáticamente dónde ubicarlo según su volumen (o da una sugerencia) — con posibilidad de modificarlo a mano en cualquier momento. | Conecta con el cubicaje volumétrico ya parcialmente construido — puede ser el mismo mecanismo, no algo nuevo de cero (nota explícita de Fede). Ver "Confirmación del modelo de datos" abajo. |
| A4 | El armado no es silencioso ni 100% automático — el sistema genera y envía la tarea de armado automáticamente, y la persona asignada (asignación automática del sistema, o preset definido por el supervisor) completa el armado y confirma que está listo. Se entera quien tiene la tarea asignada, más el supervisor y el dueño, que reciben alerta. | Combina (b)/(c)/(d) del documento original — hay tarea asignada + alerta a supervisor/dueño. |
| A5 | Al resolverlo con el modelo de SKU propio para el kit (A3), la solución sirve para MELI y TiendaNube por igual — ambos canales diferencian el kit del producto individual por el SKU, sin necesitar lógica separada por canal. | Equivale a la opción (b) del documento original, resuelta "gratis" por el modelo de A3. |

### Confirmación del modelo de datos (kit-como-SKU)

Cada vez que se arma un kit, el sistema resta las unidades de los productos individuales del
inventario, y suma una unidad al inventario del SKU del kit. Un listing "Combo Pelo" en MELI/TN se
identifica por su propio SKU, distinto del SKU de cada componente suelto.

### 💡 Idea nueva de Fede (fuera del relevamiento original) — ficha técnica de armado

Agregar la posibilidad de que dueño/supervisor cargue una **ficha técnica por kit** — texto, imágenes
y/o video explicando cómo armarlo. **Opcional, no obligatoria.** El botón para verla (del lado del
empleado que arma) solo aparece si existe una ficha técnica cargada para ESE kit específico.

---

## Bloque 2 — Repricing automático por margen en Mercado Libre (D3 del roadmap)

| # | Respuesta de Fede | Resumen |
|---|---|---|
| B1 | El campo de margen objetivo mantiene sus 2 usos actuales, sin volverse automático por sí solo: (1) al crear/editar un producto, si se carga el margen objetivo, el sistema debe ofrecer calcular el precio de venta necesario para lograr ese margen (contemplando IVA); (2) alimenta el dashboard con info de si el producto está por debajo del margen objetivo, con avisos/recomendaciones de acción. Fede agrega, además, 2 mecanismos NUEVOS independientes de este uso (ver abajo). | No es ninguna de las opciones (a)/(b)/(c) tal cual — Fede reinterpreta la pregunta agregando 2 mecanismos nuevos e independientes, ver detalle abajo. |
| B2 | Configurable por el dueño en Configuración → Mercado Libre / TiendaNube — puede elegir entre: ajuste automático siempre, generar alerta/sugerencia para aprobar, o automático solo a partir de una diferencia mayor o igual a X$ definida por el dueño. | Combina las opciones (a)/(b)/(c) del documento original como 3 modos configurables, no una sola opción fija. |
| B3 | Resuelto por B1: el precio base del negocio (ficha de producto) SIEMPRE manda — nunca al revés. El precio mostrado en MELI/TN se deriva del precio base (más el ajuste que corresponda si el mecanismo 2 está activo), pero un cambio en el marketplace NUNCA modifica el precio base del sistema. | Es la opción (a) del documento original — implica separar "precio por canal" del "precio base" en el modelo de datos (hoy no existe). |
| B4 | La comisión de MELI se proyecta a modo informativo, en base a la última comisión real cobrada a ese SKU (se actualiza si la comisión cambia en la venta más reciente) — es solo para referencia/visualización, NUNCA se usa como dato certero para calcular un precio. La comisión real y definitiva solo se toma en cuenta una vez conocida, después de concretada la venta. | Equivale a la opción (a) del documento original, con la aclaración explícita de que nunca es un dato "certero" para fijar precio. |
| B5 | Se agrega como parámetro configurable en Configuración, a criterio de cada dueño — tanto el tope de suba por ajuste como el umbral de aviso quedan disponibles como opciones, sin un default único impuesto por el sistema. | Equivale a la opción (d) del documento original (tope + umbral combinados), sin un default fijo impuesto por el sistema. |
| B6 | Interruptor por producto, ubicado directamente en la ficha de producto (no en una pantalla de configuración aparte). | Equivale a la opción (a) del documento original. |

### Mecanismo nuevo 1 — ajuste automático por margen objetivo (opt-in)

Marcado explícitamente en la ficha del producto. Si se activa, el sistema puede ajustar el precio de
venta para volver al margen objetivo. Al ser una "acción consensuada" marcada explícitamente en la
ficha, el ajuste es **ÚNICO** — se aplica igual en Genesis360 y en TODOS los marketplaces conectados,
no hay precio distinto por canal en este mecanismo.

### Mecanismo nuevo 2 — ajuste por diferencial de % por canal

Independiente del margen objetivo. Campos nuevos en la ficha de producto para definir cuánto subir/
bajar el precio específicamente para MercadoLibre y/o TiendaNube, como % de diferencia respecto al
precio base del sistema — un campo separado para cada marketplace (las comisiones son distintas entre
ellos). Permite amortiguar la comisión de cada canal de forma automática e independiente, sin depender
del margen objetivo — se calcula directo desde el precio de venta base.

---

## Nota operativa — Mercado Envíos vs. envío propio (C1)

| # | Respuesta de Fede | Resumen |
|---|---|---|
| C1 | 🟡 **NO resuelto — dato pendiente.** Fede no opera un negocio real en Genesis360 hoy, así que no tiene el dato real de qué tipo de envío predomina — y va a variar de negocio a negocio entre los futuros clientes de Genesis360. Queda como dato a relevar con **CLIENTES REALES** antes de decidir si la Fase C (avisar a MELI del despacho/entrega, ya diferida) es viable. | Corresponde a la opción (d) del documento original ("no lo sé todavía, hay que relevarlo con clientes reales antes de decidir si la Fase C es viable"). |

**Lo que SÍ quedó definido es el DISEÑO, no el dato** (independiente de si predomina Mercado Envíos o
envío propio):
- Pestaña nueva dentro del módulo Envíos, editable solo por dueño/supervisor, con sub-pestañas por
  canal de venta (MELI, TN, etc.).
- Dentro de cada sub-pestaña de canal: se listan todos los productos y se define, producto por
  producto, un único tipo de envío por defecto para ese canal (propio / Mercado Envíos / tercero /
  EnvíoNube / etc.).
- Override a nivel de venta individual: desde el módulo Envíos, buscando una venta puntual por su
  número, se puede ver el detalle de envío de esa venta y cambiar el tipo de envío ahí mismo si hace
  falta (ej. de "tercero" a "propio") — siempre y cuando el/los productos de esa venta todavía NO se
  hayan despachado.

---

## Prioridad y comentarios (D1/D2 del documento original)

| # | Respuesta de Fede | Resumen |
|---|---|---|
| D1 (top 3 prioritario) | Sin responder. Con todo lo demás ya definido en detalle, Fede deja en manos de "Tonga" (= GO, ver [[reference_tonga_es_go]]) decidir si hace falta que él marque una prioridad de cierre entre los puntos técnicos que quedaron abiertos (ej. la separación de "precio por canal" en el modelo de datos), o si alcanza con lo ya resuelto para arrancar directo. | 🟡 Delegado a GO — no bloquea arrancar el diseño técnico. |
| D2 (comentarios libres) | Sin responder. | — |

---

## Decisiones técnicas que quedan pendientes de discutir con GO antes de codear

No son gaps de Fede (todo lo que se le preguntó quedó resuelto, salvo C1) — son consecuencias de
diseño que su respuesta habilita pero no especifica en el detalle de implementación. A definir en la
sesión de diseño técnico:

- **Modelo de datos "precio por canal"** (B3 + mecanismo 2 de repricing): hoy `productos.precio_venta`
  es un único precio para todos los canales — el mecanismo 2 (diferencial % por canal) requiere 2
  campos nuevos (ej. `precio_ajuste_meli_pct`, `precio_ajuste_tn_pct`) y derivar el precio publicado
  sin tocar `precio_venta`.
- **Armado automático de kit desde webhook server-side** (Bloque 1): `iniciar_armado_kit`/
  `confirmar_armado_kit` dependen de `auth.uid()` — necesitan una variante invocable con `service_role`
  (o un parámetro de tenant explícito) para poder correr desde `tn-webhook`/`meli-webhook`.
- **Tarea automática de armado con asignación + alerta**: no existe hoy infraestructura de "tarea
  asignada a una persona con alerta a supervisor/dueño" fuera del módulo WMS de picking — a evaluar si
  se reusa esa infraestructura o se arma una nueva acotada a kits.
- **Comisión MELI "última venta real" (B4)**: requiere una función que lea
  `venta_items.comision_marketplace` de la venta MELI más reciente de ese SKU — no existe hoy.

---

## Orden de trabajo

Combos TN (D2) y Repricing MELI (D3) — relevamiento **CERRADO** (salvo C1, dato). Listo para pasar a
diseño técnico + construcción en una próxima sesión, ya no bloqueado por falta de respuesta de Fede.
C1 **no bloquea** el arranque de ninguno de los 2 bloques (ninguno depende de saber si predomina
Mercado Envíos o envío propio) — solo bloquea decidir si la Fase C (aviso de despacho a MELI, ya
diferida) es viable.
