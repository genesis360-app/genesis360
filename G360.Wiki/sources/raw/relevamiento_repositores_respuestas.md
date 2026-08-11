---
name: relevamiento_repositores_respuestas
description: Respuestas de Fede al relevamiento del módulo Repositores (Fase E del backlog Comercial 25/7) + revisión de Claude + clarificaciones de GO. Reveló que "Fase E" son 4 proyectos con dependencias reales, no una sola fase.
type: project
status: 🟢 DESBLOQUEADO — los 3 relevamientos derivados (Ubicaciones v1.157.0, Pestaña de Supervisor v1.163/164.0, Motor de Rotación) y las 3 ambigüedades de negocio (A1/A2-B3/H1) ya están cerrados. Falta escribir el relevamiento final (paso 4 del orden acordado) y recién ahí diseñar/construir. Ver "Cierre de ambigüedades" al final.
source: relevamiento-repositores-reglas-negocio.html
updated: 2026-08-11
---

# Respuestas — Relevamiento Reglas de Negocio · Repositores

> **Estado:** Fede respondió las 35 preguntas completas (30/7/2026). Al revisarlas contra el código
> real, se detectó que el alcance real son **4 proyectos con dependencias entre sí**, no una fase —
> ver "Orden de trabajo acordado" al final. **No diseñar ni implementar Repositores todavía**: faltan
> las respuestas de los 3 relevamientos derivados.

---

## A. Qué es un "Repositor" (rol y acceso)

| # | Respuesta de Fede | Resumen para implementación |
|---|---|---|
| A1 | **Rol nuevo (Repositor)**, no reutiliza ninguno existente | ⚠ **Duda de Claude sin cerrar**: el enum de roles es fijo en el código (`CHECK` de `users.rol`) — agregar un valor literal implica migrar ese campo + auditar toda RLS/helper que enumera roles. El patrón ya probado en Comercial (Fase D) — rol base + `roles_custom` — logra el mismo resultado percibido sin ese costo. Falta que GO/Fede confirmen si "rol nuevo" es un requisito literal o alcanza con el patrón custom. |
| A2 / B3 (unificadas) | Acceso default: **Reposición + Inventario**. El dueño ajusta permisos libremente después desde Usuarios/Roles. Nota de Fede: hoy el acceso es por módulo completo — falta granularidad por acción/vista, pendiente para fases futuras | 🟠 **Riesgo marcado por Claude**: Inventario completo expone `precio_costo` y ajustes de stock más allá de lo que un repositor necesita. Recomendación: acceso default SOLO a Reposición, sin Inventario completo — el dueño lo suma a mano si quiere. Sin decisión final todavía. |
| A3 | Mismo criterio que el resto de los roles: fijo a la sucursal donde se asigna. El dueño puede sumarle sucursales adicionales puntuales desde Usuarios | Sin cambios sobre el patrón RLS por sucursal ya existente. |

## B. Qué dispara una tarea

| # | Respuesta | Resumen |
|---|---|---|
| B1 | Dos disparadores automáticos: **cambio manual de precio** y **entrada a un estado con descuento**. Más una tarea continua/manual: mover stock de depósito a góndola. Módulo opcional (no todo negocio lo necesita) | 🟠 **Pregunta de Claude, respondida por GO (2026-08-01)**: ¿aplica a ediciones MASIVAS (import CSV, `MasivoModal`)? **Sí — una tarea por cada SKU**, confirmación individual obligatoria (requiere reetiquetado físico real). Puede consolidarse la IMPRESIÓN en una tanda (ver H3), pero no la confirmación. |
| B2 | Sí — al **aprobarse** un cambio de estado (Fase B, mig 331) se genera automático la tarea de cambiar el cartel. Conecta con el motor de Rotación (ver más abajo) | Depende del Motor de Rotación (relevamiento derivado #3) para el detalle completo. |
| B3 | Confirmado — reposición física de góndola es tarea del Repositor | — |
| B4 | **Gap real confirmado**: falta agregar a la configuración de Estados una regla para productos vencidos que NO tengan un estado con descuento ya configurado | Pendiente de diseño, se resuelve junto con el Motor de Rotación. |

## C. Contenido de la tarea

| # | Respuesta | Resumen |
|---|---|---|
| C1 | Vista principal con datos mínimos (sucursal implícita, no se muestra). Click → detalle completo. Botón "avisar al supervisor" por cualquier problema → notificación directa (ícono del header) con producto/ubicación/tarea ya identificados | Esta pieza (notificación al supervisor) es candidata a vivir en el patrón de "Pestaña de supervisor reusable" (relevamiento derivado #2), no exclusiva de Repositores. |
| C2 | Resuelto en "Rediseño de Ubicaciones" (ver abajo) | — |
| C3 | **Prioridad automática por sistema**, no manual, en este orden: (1) ya se vendió con precio viejo después del cambio (riesgo de reclamo real) → máxima; (2) precio nuevo MÁS ALTO que el viejo (cobrar de más es más grave frente a Defensa del Consumidor) → alta; (3) cercanía a vencimiento; (4) tiempo pendiente de la tarea | 🟡 **Nota de Claude**: el factor (1) es lógica de backend real (snapshot de precio+timestamp al crear la tarea, cruzado contra ventas posteriores), no una bandera de UI — dimensionar como tal al construir Repositores. |

## D. Ubicación física de destino

| # | Respuesta | Resumen |
|---|---|---|
| D1 | Confirmado: se reinterpreta la lógica actual para reposición inteligente, **aunque implique romper comportamiento existente**. Prioridad: valor agregado por sobre preservar código — "es el momento, antes de tener clientes en producción" | ✅ **Verificado por Claude contra PROD (no asumido)**: de 8 tenants, 1 solo "active" y es la propia cuenta de GO (4 ubicaciones, 31 líneas de stock, 22 ventas) — los 5 en trial están vacíos. La premisa de Fede se sostiene; único costo real es migrar a mano los datos de la cuenta de GO. |
| D2 | **Ubicación única y obligatoria de exhibición por SKU** — necesaria para saber, según lo vendido de esa ubicación puntual, cuándo/cuánto reponer. Aclaración de GO (2026-08-01): es **por SUCURSAL**, y la obligatoriedad de unicidad **solo aplica a SKUs que TIENEN una ubicación de exhibición asignada** — Mostrador/Depósito no tiene esa obligación | Técnicamente viable HOY sin nada nuevo para el cálculo de reposición: `venta_item_despachos.ubicacion_id` ya registra de qué ubicación salió cada venta. El resto (modelo de datos de la ubicación única) se relevó a fondo en el relevamiento derivado #1 (Ubicaciones). |
| D3 | Confirmado: se agrega **"Tipo de exhibición"** por ubicación/nivel — Góndola (autoservicio, necesita cartel) o Mostrador/Depósito (no necesita cartel). Se integra al rediseño de Ubicaciones | — |

## Rotación de productos con descuento (reemplaza la idea de GS1 por lote)

Fede descartó GS1 por lote: los productos usan código de fábrica sin lote/vencimiento, re-etiquetar
todo el stock sería inviable para una pyme. En su lugar, **regla configurable en Config → Inventario**
con 3 opciones:

1. **Terminar stock para reponer** — no se genera la orden de reposición de un producto con descuento
   por vencimiento hasta agotar ese stock (vendido, retirado por venta interna, o eliminado).
2. **Próximo a vencer va a envíos y reservas** — ese stock es prioridad para armar envíos/reservas,
   se toma primero que cualquier otro LPN.
3. **Armar kits con descuento** — re-empaquetado en kits de 2/3/4 unidades ("KIT" en el nombre),
   código y precio propios en la góndola.

**⚠ Punto que Fede dejó explícitamente abierto**: ¿son excluyentes (el negocio elige una) o
combinables (puede activar más de una a la vez, ej. 2+3 juntas)?

**Clarificación de GO (2026-08-01)**: sí, tiene que poder ser **combinable por categoría** —
confirmado técnicamente viable, `productos.categoria_id` ya existe.

➡ **Este tema se convirtió en el relevamiento derivado #3** (`relevamiento-rotacion-descuento-
reglas-negocio.html`, ya generado) — con dos gaps técnicos reales encontrados en el proceso: el FEFO
existente (`getRebajeSort`) no distingue canal de venta, y `iniciar_armado_kit` reserva componentes
sin filtrar por estado (podría armar un kit con stock fresco en vez del lote en descuento).

## Rediseño de Ubicaciones (proyecto propio, con impacto directo en Repositores)

Modelo propuesto: **ubicación contenedora** (lo que ya existe, ej. "Góndola 3") + **niveles internos**
(ej. Estante 1/2/3, cada uno con dimensiones/peso/espacios propios) — mismo patrón de árbol
genealógico ya probado en Empaque/Presentaciones. Suma **Tipo de exhibición** por ubicación/nivel
(Góndola vs. Mostrador/Depósito, ver D3). Conecta con Repositores: la ubicación de exhibición de un
producto apunta a un nivel específico (no solo "está en el depósito"); un lote en descuento con
ubicación de excepción genera además una tarea de moverlo; un producto Mostrador/Depósito no genera
tarea de cartel de góndola.

➡ **Este tema se convirtió en el relevamiento derivado #1** (`relevamiento-ubicaciones-reglas-
negocio.html`, ya generado, 14 preguntas) — es el que más bloquea, porque Repositores y Rotación
dependen de él. Hallazgo real: `producto_ubicacion_sucursal` (mig 121) ya modela casi lo mismo que
se pedía como nuevo; y la capacidad/peso recién conectada (migs 321-326, las últimas de todo WMS)
tensiona con mover esos datos a "nivel interno" — detalle completo en `log.md` (2026-08-03).

## E. Ciclo de vida de la tarea

| # | Respuesta | Resumen |
|---|---|---|
| E1 | Se mantienen los 4 estados existentes (pendiente/en curso/completada/cancelada) — mide tiempos por etapa. Cancelar exige **motivo obligatorio**, visible al supervisor | Mismo patrón que `wms_tareas` ya tiene. |
| E2 | **Mixto**: asignación automática inteligente por defecto (reparto equilibrado entre repositores disponibles de la sucursal), con reasignación manual de supervisor/dueño, o especialización configurable (precios vs. reposición física) | La pieza de "reasignación" no existe hoy en ningún módulo — candidata fuerte para el patrón de "Pestaña de supervisor reusable" (relevamiento derivado #2). `wms_tareas.usuario_asignado_id` existe en el schema pero ningún frontend lo usa. |
| E3 | Configurable por el dueño en Config. Default: botón "Listo" sin evidencia. Opcional: foto de la etiqueta puesta, o escaneo del código de barras | — |
| E4 | Sí, supervisor puede cancelar/reasignar, con motivo obligatorio (ver E1) | Ver nota transversal (pestaña de supervisor). |

## F. Vista informativa e historial

| # | Respuesta | Resumen |
|---|---|---|
| F1 | Vista incluye: pendientes/hechas (hoy y semana), instructivo de reposición/cambio de etiqueta, vencidas resaltadas aparte, próximos vencimientos SIN tarea todavía (alerta temprana), tiempo estimado vs. real, acceso directo a mayor prioridad arriba | — |
| F2 | **Primera pantalla de tareas completadas de todo WMS** — lista con fecha/producto/quién, filtro por fecha/repositor/sucursal, exportable | Dato real: hoy NO existe ninguna vista de tareas completadas en todo WMS (`PickingPage.tsx` siempre filtra `pendiente`/`en_curso`) — es una pieza nueva de punta a punta. |
| F3 | Cada repositor ve su propio historial. Supervisor/dueño ve el de su sucursal (o todas, cambiando entre ellas si es dueño) | — |

## G. Etiquetas de precio

| # | Respuesta | Resumen |
|---|---|---|
| G1 | Etiqueta: nombre + precio nuevo siempre. Con descuento: precio anterior tachado junto al nuevo. Sin descuento: solo el precio, sin tachado. Código de barras + número debajo. **Campo nuevo "Contenido"** (cantidad+unidad: ml/gr/oz/kg, en Identificación) para productos de contenido fijo — la etiqueta muestra en chico el precio por unidad grande (Kg/L/M), ej. shampoo 120ml a $3.000 → "Precio por L: $25.000" | ✅ **Verificado por Claude**: la conversión de unidades física ya existe (`unidades_medida_fisicas`, `familia` + `factor_base_familia`) — no hay que reprogramarla, Fede tenía razón. El campo "Contenido" es nuevo, no colisiona con nada existente en `productos`. |
| G2 | Formato configurable por supervisor/dueño (tamaño, cantidad por hoja). Default: menor cantidad de hojas posible, tamaño estándar de supermercado | — |
| G3 | Una etiqueta por producto, sin depender de la cantidad de niveles de estante | — |

## H. Impresión

| # | Respuesta | Resumen |
|---|---|---|
| H1 | A partir de una hora configurada, aparece notificación/alerta para imprimir. Primera persona disponible dispara la impresión manualmente (config preseleccionada o default). **Sin impresión automática en esta fase** — un agente local queda como proyecto aparte a futuro | Confirma el hallazgo técnico original: no hay integración de impresora física en el código hoy (`etiquetasEnvioPDF.ts`/`CodigoMasivoModal.tsx` son los 2 patrones existentes, ninguno imprime sin un humano). |
| H2 | Se entera por la misma notificación de H1 | — |
| H3 | Se juntan varias etiquetas pendientes en **una sola tanda de impresión** | Coherente con B1: confirmación por tarea individual, pero impresión consolidada. |

## I. Integración con WMS/Picking

| # | Respuesta | Resumen |
|---|---|---|
| I1 | Módulo único de Repositores, con pestañas internas: Precios/Etiquetas y Reposición física | — |
| I2 | Gateado a **Modo Avanzado únicamente** por ahora. Se evalúa después qué partes bajan a Básico | — |
| I3 | Sí — toda la lógica de reabastecimiento hacia góndola vive en Repositores; Inventario se ocupa de otras funciones | ⚠ **Pregunta de Claude sin cerrar del todo**: ya existe un tipo de tarea `replenishment` en WMS (bulk→zona picking, misma operación que "Mover LPN"). Falta decidir si la reposición a góndola de Repositores REUTILIZA ese mecanismo (agregando göndola como destino válido) o es un tercer tramo separado (bulk→picking por WMS, después picking→göndola por Repositores). Se resuelve al armar el relevamiento final de Repositores (punto 4), con las respuestas de Ubicaciones ya cerradas. |

## J. Notificaciones

| # | Respuesta | Resumen |
|---|---|---|
| J1 | Notificación dentro del sistema únicamente por ahora. Cuando exista app móvil descargable, llega al dispositivo | — |
| J2 | Alerta directa a supervisor/dueño si quedan tareas sin completar al cierre del día, con reporte completo. Formato sugerido: mail automático si ya existe esa infra (si no, notificación interna) | ✅ **Verificado por Claude**: sí existe — `send-email` (Resend) ya se usa para tickets/notificaciones. Confirmar directo, no hace falta re-preguntarle a Fede. |

## K. Reportes

| # | Respuesta | Resumen |
|---|---|---|
| K1 | Ambos reportes importan: cantidad de tareas completadas por repositor, y tiempo promedio disparo→completada. Objetivo: entender demoras, no presionar al empleado | — |
| K2 | Alcanza con verlo en pantalla, pero tiene que poder descargarse | — |

## L. Prioridades

| # | Respuesta |
|---|---|
| L1/L2 | Sin comentarios adicionales — cubierto por el resto de las respuestas del documento. |

## Nota transversal — pestaña de supervisor reusable (aplica a TODOS los módulos, no solo Repositores)

Agregar una pestaña exclusiva de supervisor/dueño dentro de cada módulo, con herramientas que solo
ellos puedan usar: asignar/reasignar tareas, aprobar/rechazar cambios, trazabilidad completa de cada
empleado. Construir **una sola vez** como patrón reusable, no repetir módulo por módulo.

➡ **Se convirtió en el relevamiento derivado #2** (`relevamiento-supervisor-tab-reglas-negocio.html`,
ya generado, 16 preguntas). Hallazgo real: hoy hay DOS criterios de acceso sin unificar (Tab
Autorizaciones de Inventario con el rol hardcodeado sin leer `roles_custom`, vs. Comercial que sí
delega vía `roles_custom`) — y `tenants.ajuste_autorizacion_roles` (mig 228) NO configura "quién
aprueba" como se podría asumir, configura otra cosa distinta.

---

## Revisión de Claude — hallazgos y sugerencias (2026-07-30/31, antes de las clarificaciones de GO)

Antes de diseñar nada se revisaron las 35 respuestas contra el código real (no contra supuestos).
Resumen de lo más importante (detalle completo en la conversación, no repetido acá):

- **🟢 Confirmado correcto**: conversión de unidades física ya existe (G1), reposición basada en lo
  vendido por ubicación ya es viable con datos existentes (D2), envío de mails ya existe (J2), patrón
  de árbol genealógico ya probado (Ubicaciones/rediseño).
- **🟡 Ambigüedades cerradas por GO** (2026-08-01): Rotación combinable por categoría · D1/D2 por
  sucursal, obligatoriedad solo si el SKU tiene exhibición asignada · B1 una tarea por SKU aunque sea
  edición masiva, confirmación individual · I3 diferido al relevamiento final de Repositores.
- **🟠 Riesgos sin cerrar todavía**: A1 (rol nuevo vs. patrón custom) · A2 (acceso default a Inventario
  completo, exposición de costos) · C3 (complejidad real de "se vendió con precio viejo", es backend,
  no UI) · tamaño real de "Fase E" (son 4 proyectos, no 1).
- **🔍 Verificado contra PROD, no asumido**: solo 1 tenant "active" (la propia cuenta de GO), los 5 en
  trial están vacíos — la premisa de D1 ("antes de clientes en producción") se sostiene.

## Orden de trabajo acordado con GO+Fede (2026-08-01)

**0)** Confirmar cierre de UoM/Empaque — ✅ verificado contra PROD (2026-08-03), 100% cerrado y
estable, migraciones clave todas aplicadas. Seguro reusar su patrón de árbol.
**1)** Rediseño de Ubicaciones (`relevamiento-ubicaciones-reglas-negocio.html`, ✅ generado) — máxima
prioridad de lo nuevo, bloquea a 3 y 4.
**2)** Pestaña de supervisor reusable (`relevamiento-supervisor-tab-reglas-negocio.html`, ✅ generado)
— en paralelo con 1.
**3)** Motor de Rotación de productos con descuento (`relevamiento-rotacion-descuento-reglas-
negocio.html`, ✅ generado) — en paralelo con 2, depende parcialmente de 1 (ubicación de excepción).
**4)** Repositores — al final, relevamiento final que consume las respuestas de 1-3 + las
ambigüedades de A1/A2/C3/I3 de este documento.

**Próximo paso real**: GO responde los 3 relevamientos derivados offline con Fede →
`relevamiento_ubicaciones_respuestas.md` / `relevamiento_supervisor_tab_respuestas.md` /
`relevamiento_rotacion_descuento_respuestas.md` en `sources/raw/` → recién ahí se arma el
relevamiento final de Repositores (punto 4) y se puede diseñar/implementar. Detalle día a día en
`G360.Wiki/log.md` (entradas 2026-07-30 y 2026-08-03).

## Cierre de ambigüedades (2026-08-11) — de las 4 marcadas arriba, 3 eran decisión de GO/Fede y 1 es una nota técnica

De las 4 ambigüedades que el "Orden de trabajo acordado" (abajo) exigía cerrar antes del relevamiento
final (A1/A2/C3/I3), **A1, A2/B3 y H1 (que no estaba en esa lista original pero se sumó al
presentárselo a GO) ya las resolvió GO** — quedó registrado en la memoria de sesión
`project_backlog_fede_comercial_25_7.md` → "Actualización 2026-08-11":

- **A1** (rol nuevo vs. custom): **rol custom** — reusa el patrón ya construido en Fase D (Comercial),
  sin migrar el enum fijo de `users.rol`.
- **A2/B3** (alcance de acceso default): acceso default **SOLO a Reposición**, sin Inventario
  completo — evita exponer `precio_costo`/ajustes de stock de más. El dueño lo suma a mano si quiere.
- **H1** (impresión): **PDF para imprimir a mano, diseñado para que el mismo layout sirva también en
  una Zebra térmica** si el negocio tiene una — sin integración directa por agente local en esta fase.

**C3 e I3 (las otras 2 de la lista original) NO necesitan una decisión nueva de GO/Fede — son trabajo
de diseño/implementación, no de negocio:**
- **C3** (prioridad de tareas): Fede YA definió el orden completo (vendido a precio viejo > precio
  nuevo más alto > cercanía a vencimiento > tiempo pendiente) — lo que quedó como nota es que el
  criterio #1 requiere backend real (snapshot de precio+timestamp cruzado contra ventas posteriores),
  no una bandera de UI. Se dimensiona como tal al construir, no bloquea el diseño.
- **I3** (reusar `replenishment` de WMS vs. tercer tramo separado): el propio documento decía "se
  resuelve al armar el relevamiento final de Repositores, con las respuestas de Ubicaciones ya
  cerradas" — Ubicaciones (v1.157.0) ya está cerrado, así que esto se resuelve REDACTANDO el
  relevamiento final (punto 4), no preguntándole a Fede de nuevo.

**Conclusión: Repositores está 100% desbloqueado en lo que depende de GO/Fede.** Lo único que falta
antes de diseñar/construir es escribir el **relevamiento final de Repositores** (punto 4 del "Orden de
trabajo acordado" abajo) — que junta las respuestas de los 3 relevamientos derivados + resuelve I3 como
propuesta de diseño + marca C3 como nota de dimensionamiento — y recién ahí arrancar la Fase E en sí.
Ese documento todavía NO se escribió.
