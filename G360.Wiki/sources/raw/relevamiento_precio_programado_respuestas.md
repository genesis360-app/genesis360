---
name: relevamiento_precio_programado_respuestas
description: Respuestas de Fede (2026-09-20) al relevamiento de Precio programado (ya construido, migs 422-424). Deja 7 puntos abiertos que decide GO.
type: relevamiento
---

> **Procedencia**: texto extraido con `pdftotext -layout` del PDF que entrego GO el 2026-09-22
> (`respuestas-relevamiento-precio-programado.md.pdf`). Se conserva **tal cual**, con la sangria del PDF, a
> proposito: son reglas de negocio que tocan plata y la fidelidad importa mas que el formato.
> El PDF original es la fuente autoritativa ante cualquier duda.

> **✅ Los 7 puntos abiertos (C-1..C-7) de este relevamiento fueron RESPONDIDOS por GO el 2026-09-25**:
> ver `sources/raw/respuestas_puntos_abiertos_2026-09-25.md` (sección "C · Precio programado") — todos
> ok con la propuesta. Listo para planificar la implementación por fases.

---

Respuestas al relevamiento de reglas de negocio — Precio de
venta con fecha/hora de vigencia

Genesis360 · Respuestas de Fede · 20 de septiembre de 2026 Relevamiento original:
v1.209.0 (11 de septiembre de 2026).

Cómo leer este documento

      Cada punto tiene una Decisión (lo que definió Fede) y las Reglas para implementar
      (el detalle práctico que sale de esa decisión).
      (derivada) marca reglas que no se respondieron literalmente, pero salen de combinar
      otras respuestas. Tonga puede cuestionarlas.
      (propuesta) marca reglas que Fede todavía no confirmó y que se incluyen para que
      Tonga tenga un punto de partida.
      (recomendación técnica) marca sugerencias de implementación que no cambian
      ninguna regla de negocio.
      Al final hay una lista de puntos abiertos que las respuestas no cierran.

1. La funcionalidad en resumen

  1. La opción de fecha y hora aparece solo cuando se modifica el precio de venta. Si se
      cambia cualquier otra cosa de la ficha sin tocar el precio, no aparece. Si se cambian el
      precio y otras cosas a la vez, lo demás se aplica ya y solo el precio queda programado.

  2. Por defecto es "Ahora" (mismo comportamiento que hoy). Programar es opcional.
  3. El precio programado se guarda aparte. El precio vigente no se toca hasta la hora

      indicada, por lo que el POS sigue cobrando el actual hasta entonces.
  4. Un proceso automático del servidor activa el precio en el momento exacto que se

      programó. Es el comportamiento por defecto.
  5. El dueño puede configurar dos cosas: con cuánta anticipación aparece la tarea de

      etiqueta para el repositor, y si el cambio de precio también depende de la aprobación
      del repositor.
  6. En el POS, el precio queda congelado cuando el producto entra al carrito. Las
      reservas respetan lo pactado y los presupuestos respetan su validez en días.
  7. Etiquetas: se imprime el precio nuevo con su fecha y hora de vigencia. Si el precio
      baja, se puede mostrar el precio anterior tachado.
  8. Mercado Libre y Tienda Nube se publican automáticamente en el momento en que
      el precio pasa a regir, sin ninguna acción manual.
  9. La programación funciona como un lote: una fecha y hora con N productos. Un
      producto suelto es un lote de uno. Esto habilita los cambios masivos.
10. Hay una lista de cambios pendientes, avisos y registro completo de quién programó,
      editó, canceló y cuándo se aplicó.

11. Alcance: todo se hace junto, o por etapas si Tonga lo prefiere.

2. Tabla resumen de decisiones

Código Decisión

A1  El precio programado convive con el vigente: se guarda aparte y el vigente rige hasta su

    fecha

A2  Un solo cambio programado por producto; programar otro pide confirmación para

    reemplazarlo. La tabla queda preparada para varios

A3  Se puede editar, cancelar y "aplicar ahora", con los roles que hoy pueden tocar precios

A4  "Ahora" es el default; programar es opcional, con atajos

A5  Alcance final: minorista, mayorista y combos, en la moneda en que esté cargado el precio. No

    incluye el movimiento diario de la cotización

B1  El precio se congela cuando el producto entra al carrito

B2  La reserva respeta el precio de cuando se tomó

B3  El presupuesto respeta su precio dentro de la validez en días (configuración que ya existe)

C1  Dos configuraciones del dueño: anticipación de la tarea de etiqueta y aprobación del

    repositor. Default: precio a la hora exacta

C2  La etiqueta lleva el precio nuevo con su vigencia. Opción de mostrar el anterior tachado solo

    si el precio baja

C3  Alerta al dueño, aviso al cajero y precio de góndola autorizado por un supervisor con motivo

D1  ML/TN se publican al entrar en vigencia, de forma automática

D2  Reintento y aviso al dueño si no sale en X minutos

D3  La vigencia online es la misma que la del local

E1  Cambios masivos: sí, con el modelo de lote desde el diseño

E2  Lista de pendientes, indicador en la ficha y avisos

E3  Proceso automático del servidor, aunque el local esté cerrado

E4  Registro completo de programación, edición, cancelación y aplicación

F1  Todo junto o por etapas, a criterio de Tonga. ML/TN es lo menos prioritario

3. Configuraciones nuevas para el dueño

Configuración Dónde                     Valores                             Default

Anticipación de la Configuración del    Cuánto tiempo antes de la           (propuesta) apenas
tarea de etiqueta negocio               vigencia aparece la tarea para      se programa el
                                        el repositor, en horas y minutos    cambio

Aprobación del   Configuración del      Activada o desactivada: si el       Desactivada: el
repositor        negocio                cambio de precio también            precio rige a la hora
                                        depende de que el repositor         exacta programada
                                        apruebe el cambio de etiqueta

Precio anterior  Al programar el        Sí o no. Solo aparece si el precio  (derivada)
tachado          cambio (no es una      nuevo es más barato que el          desmarcado
                 configuración global)  actual

Validez del      Ya existe              Sin cambios                         Sin cambios
presupuesto
(días)

4. Respuestas detalladas

A · Qué se programa y cómo se guarda

A1 · ¿El precio programado reemplaza al actual o conviven?

Decisión: (a) conviven. El precio actual sigue rigiendo y el nuevo queda agendado hasta su
fecha.

Reglas para implementar:

      El precio programado se guarda en una tabla aparte, con una fila por cambio
      programado, sin tocar productos.precio_venta .
       precio_venta sigue siendo el precio vigente. A la hora de vigencia, un proceso lo
      reemplaza por el programado.
      Cuando el precio programado pasa a regir, se dispara lo que hoy reacciona a un cambio
      de precio (la republicación en ML/TN). La tarea del repositor tiene lógica propia (ver
      C1).
      Cada cambio programado guarda: producto, precio nuevo, moneda, fecha y hora de
      vigencia, estado (pendiente / aplicado / cancelado), quién lo programó y cuándo,
      precio anterior y la marca de precio tachado (C2).
      Mientras un cambio está pendiente, ni el POS, ni los reportes, ni el importador, ni la
      sincronización online ven el precio futuro.

A2 · ¿Más de un cambio programado por producto?
Decisión: un solo cambio programado por producto. Programar otro reemplaza al anterior.

Reglas para implementar:

      Al programar un cambio sobre un producto que ya tiene uno pendiente, el sistema
      avisa y pide confirmación: "ya había un cambio programado para el lunes, ¿lo
      reemplazás?".
      (recomendación técnica) La tabla se diseña para poder tener varios cambios por
      producto (una fila por cambio), aunque la pantalla permita solo uno. Así se puede
      pasar a varios en cola más adelante sin rehacer nada.

A3 · ¿Se puede cancelar o editar un cambio programado?
Decisión: sí, se pueden cancelar y editar, y también se puede "aplicar ahora".

Reglas para implementar:

      Pueden hacerlo los mismos roles que hoy pueden tocar precios (DUEÑO,
      SUPERVISOR y ADMIN).
      Mientras el cambio está pendiente se puede editar (precio o fecha), cancelar o
      adelantar con "aplicar ahora".
      Una vez que el precio rigió, es un cambio de precio normal: para modificarlo hay que
      programar otro.
      Todo queda registrado (ver E4).

A4 · ¿La fecha/hora es obligatoria?
Decisión: (a) el default es "ahora" y programar es opcional.

Reglas para implementar:

      La opción se muestra siempre que se modifica el precio de venta, con "Ahora"
      preseleccionado.
      Atajos: "En 1 hora", "Mañana a primera hora" y "Elegir fecha y hora".
      Si el cambio es "Ahora", funciona exactamente como hoy.

A5 · ¿Aplica al mayorista, los combos y el precio en USD?
Decisión: (b) como meta: minorista, mayorista y combos. Se implementa dentro del alcance
total de F1.

Reglas para implementar:

      Se pueden programar el precio minorista, los tramos mayoristas por cantidad y el
      precio de los combos.
      Se programa el precio base, con su moneda (monto + moneda). Lo que no es un
      cambio programado es el movimiento diario del precio en pesos de un producto en
      dólares por variación de la cotización. Eso no dispara tareas de etiqueta ni se agenda.

      (derivada) Si por decisión de Tonga el mayorista o los combos quedan para una etapa
      posterior, al programar un precio minorista en un producto con tramos mayoristas el
      sistema debe avisar que esos tramos no se programan, para no dejar precios
      inconsistentes entre sí.

B · El POS: qué precio se cobra
B1 · Venta empezada a las 13:59 y cobrada a las 14:01, con el cambio a las 14:00
Decisión: (a) se cobra el precio de las 13:59. El precio se congela cuando el producto entra al
carrito.

Reglas para implementar:

      El precio de cada línea queda fijo desde que el producto se agrega al carrito.
      Las ventas cuyo precio es anterior a un cambio de precio quedan marcadas en el
      registro, para poder auditarlas.
      Tonga debe revisar si existen ventas en espera por mucho tiempo, y proponer qué
      hacer con ellas (por ejemplo, re-preciarlas si pasa un tope de tiempo o un cambio de
      día).

B2 · Reserva con seña
Decisión: (a) se respeta el precio de cuando se tomó la reserva. Hoy la reserva ya guarda el
total al crearse, así que en los hechos ya funciona así. Se confirma como regla.

B3 · Presupuesto emitido antes del cambio
Decisión: el presupuesto ya está atado a una validez en días, y esa es la que debe mandar. Se
usa la configuración que ya existe.

Reglas para implementar:

      Dentro de la validez, el presupuesto respeta el precio presupuestado, aunque el precio
      haya cambiado.
      Vencida la validez, se re-precia con los precios vigentes y se muestra qué cambió.

C · El repositor y las etiquetas
C1 · ¿Cuándo aparece la tarea de cambiar la etiqueta?
Decisión: se aprovecha el sistema de etiquetado para repositores que ya existe, y se enlaza
con la aprobación del cambio de etiqueta por parte del repositor. Como el software es
versátil y editable, esto se configura por el dueño, con dos opciones:

  1. Anticipación: con cuánto tiempo antes de que se apliquen los cambios (en horas y
      minutos) aparece la tarea para el repositor.

  2. Aprobación del repositor: si el cambio de precio además toma como condición la
      aprobación del cambio de etiqueta por parte del repositor.

El objetivo es que el precio cambie justo cuando se modificó la etiqueta, o que se aplique a la
hora exacta programada, según lo que elija el dueño.

Default: el precio se aplica en el momento exacto que se programó.

Criterio sobre el riesgo residual: si alguien agarra el producto justo antes de que el
repositor cambie la etiqueta y el precio ya se aplicó, se resuelve en el momento (ver C3).
Para eso existen las opciones de configuración.

Reglas para implementar:

      Modo por defecto (aprobación desactivada): el precio se activa a la hora exacta
      programada, sin depender del repositor. La tarea de etiqueta aparece según la
      anticipación configurada.
      Modo con aprobación activada: además de la hora, interviene la aprobación del
      repositor en el sistema de etiquetado. Tonga debe ver cómo se llama y qué estado tiene
      hoy esa acción (por ejemplo, tarea realizada).
      Cuando la aprobación está activada, la tarea tiene que existir antes de la vigencia; si
      no, el precio no podría activarse.
      La tarea del repositor se sigue creando solo si el negocio está en modo avanzado y el
      producto tiene góndola asignada. (derivada) Para un producto sin tarea, la aprobación
      no aplica y el precio se activa a la hora exacta.
      (propuesta) Semántica de la aprobación: el precio se activa cuando se cumplen las
      dos condiciones, es decir, cuando llegó la hora programada y el repositor aprobó (lo
      que ocurra último). Así el precio nunca rige antes de la hora, y si el repositor llega
      tarde, el precio espera a la etiqueta.
      (propuesta) Tiempo máximo de espera: si el repositor no aprobó, pasado un tiempo
      máximo configurable el sistema aplica el precio igual y avisa al dueño. Sin esto, un
      aumento podría demorarse indefinidamente por una tarea olvidada.
      (recomendación técnica) En modo con aprobación, el POS no debe activar el precio
      solo por la hora (ver E3).
      (propuesta) Valor por defecto de la anticipación: la tarea aparece apenas se programa
      el cambio, con la fecha de vigencia bien visible y la leyenda "Preparar. Colocar desde
      [fecha/hora]". Al llegar la hora, pasa a "Urgente: colocar ahora".
      Al programar, conviene que el sistema informe cuántas tareas de etiqueta genera el
      cambio (por ejemplo, "esto genera 12 tareas de etiqueta").

C2 · ¿Qué precio se imprime en la etiqueta?

Decisión: el precio nuevo, con la fecha y hora de vigencia visible. Además se da la opción de
marcar el precio anterior como tachado si el precio pasa a ser más barato, para aportar ese
valor extra de descuento. Si el precio cambia a uno más caro, el precio anterior no se
muestra.

Reglas para implementar:

      La tarea del repositor indica con claridad "no colocar antes de [fecha y hora]".
      Si el formato de la etiqueta lo permite, también se muestra la vigencia en la etiqueta.
      La opción de tachado se configura al momento de setear el precio, y solo aparece si el
      precio nuevo es más barato que el actual.
      (derivada) El default es desmarcado.
      El alcance de esta opción es la etiqueta del repositor. Si más adelante se quisiera
      reflejar en la tienda online, se define aparte.

C3 · ¿Qué pasa si el repositor no llegó y el precio ya rige?
Decisión: se sigue la sugerencia, en tres capas.

Reglas para implementar:

  1. Alerta al dueño o supervisor: "el precio de X ya rige y su etiqueta sigue pendiente".
  2. Aviso discreto al cajero al escanear ese producto: "etiqueta desactualizada, el precio

      cambió a $X".
  3. Si el cliente reclama, un supervisor autoriza el precio de la góndola con motivo

      obligatorio. La diferencia queda registrada como "ajuste por etiqueta desactualizada"
      para que el dueño vea cuánto cuesta. Tonga debe ver si se puede reutilizar el
      mecanismo de descuentos.

Es un criterio comercial: en la práctica se entiende que se le respeta al cliente el precio
exhibido. Los aspectos legales conviene confirmarlos con el contador o un abogado.

D · Mercado Libre y Tienda Nube
D1 · La publicación en ML/TN espera a la fecha de vigencia
Decisión: sí. Además, en el horario de vigencia, si el producto está conectado a Mercado
Libre o Tienda Nube, el sistema debe disparar automáticamente el deploy (la publicación
del precio), para que se suba directamente sin que nadie tenga que hacerlo a mano.

Reglas para implementar:

      La publicación se dispara en el momento en que el precio pasa a regir (por hora exacta
      o, si corresponde, tras la aprobación del repositor).
      Solo aplica a productos que tienen publicación conectada en Mercado Libre o Tienda
      Nube.
      Con el diseño de A1, esto puede resultar casi sin desarrollo extra, porque el mecanismo
      que hoy encola la republicación se dispara cuando el precio vigente cambia.

D2 · Si la publicación falla a la hora señalada
Decisión: (b) se reintenta y, si no sale en X minutos, se avisa al dueño.

Reglas para implementar:

      (propuesta) X = 15 minutos como valor inicial.
      Mientras tanto, el producto muestra el estado "pendiente de publicar".

D3 · ¿La vigencia online puede ser distinta a la del local?
Decisión: no en esta versión. La fecha y hora es la misma que la del local. Los ajustes
porcentuales propios de cada canal ( precio_ajuste_meli_pct , precio_ajuste_tn_pct )
siguen funcionando como hoy.

E · Operación y control
E1 · Cambios masivos
Decisión: sí, con el modelo de lote definido desde el diseño.

Reglas para implementar:

      La programación funciona como un lote: una fecha y hora con N productos. Un
      producto suelto es un lote de uno.
      Los cambios masivos son otra forma de armar ese lote: por lista, categoría o proveedor,
      por porcentaje o monto fijo.
      Antes de confirmar, se muestra una vista previa: precio actual, precio nuevo y margen
      resultante.
      En modo con aprobación del repositor (C1), la aprobación se da por producto.

E2 · ¿Dónde se ven los cambios pendientes?
Decisión: se sigue la sugerencia.

Reglas para implementar:

      Una sección en Productos, "Precios programados", con la lista de pendientes y las
      acciones editar, cancelar y aplicar ahora.
      Un indicador en la ficha del producto: "Precio programado: $X desde dd/mm hh:mm".
      Aviso al dueño la víspera y el mismo día ("hoy rigen N cambios de precio").

E3 · ¿Se aplica si el local está cerrado?
Decisión: sí. Se aplica por un proceso automático del servidor, sin depender de que alguien
tenga Genesis360 abierto.

Reglas para implementar:

      El proceso corre cada minuto o menos.
      El POS evalúa además la vigencia al momento de cobrar, como doble seguro por si el
      proceso se demora. (recomendación técnica) Esto no aplica a los cambios en modo
      con aprobación del repositor, donde el POS no debe activar el precio solo por la hora.
      La hora se interpreta en la zona horaria del negocio.

      Si la vigencia cae con el local cerrado, la tarea del repositor figura como urgente al
      abrir.

E4 · ¿Queda registro?
Decisión: sí, registrando todos los momentos.

Reglas para implementar:

      Quién programó el cambio y cuándo.
      Precio anterior y precio nuevo (con su moneda).
      La vigencia elegida.
      Cuándo se aplicó efectivamente.
      Si se editó o canceló, y por quién.
      Este registro permite responder "¿a cuánto se vendía tal día?" ante un reclamo.

F · Alcance
F1 · ¿Qué entra en la primera etapa?
Decisión: todo se debería hacer junto, o que lo decida Tonga si prefiere hacerlo por etapas.
Como consejo de Fede, ML/TN es lo menos prioritario ahora, por lo que si se hace por
etapas iría al final.

Nota para Tonga: con el diseño de A1, la parte de ML/TN podría resultar casi gratis, porque
se apoya en el mecanismo que ya reacciona al cambio del precio vigente. Conviene
verificarlo antes de decidir en qué etapa va.

5. Relación con el relevamiento de Multimoneda

      El precio con su moneda. Ambos proyectos tocan el mismo dato. El precio
      programado se guarda con moneda explícita (código de moneda), igual que lo
      definido en Multimoneda. Conviene que Tonga diseñe los dos juntos.
      Cotización. La variación diaria de la cotización no es un cambio de precio programado
      ni genera tareas de etiqueta.
      Mercado Libre y Tienda Nube. Al activarse el precio, se publica el precio convertido a
      moneda principal con la cotización vigente, según lo definido en Multimoneda (G3).
      Zona horaria. La hora de vigencia usa la zona horaria del negocio (importante para
      negocios de otros países).

6. Puntos abiertos para que Tonga proponga o resuelva

  1. Aprobación del repositor (C1). Confirmar la semántica propuesta (se activa cuando
      llegó la hora y el repositor aprobó), el tiempo máximo de espera antes de aplicar igual,
      y cómo se llama y qué estado tiene hoy la acción de aprobación en el sistema de
      etiquetado.

2. Anticipación de la tarea (C1). Confirmar el valor por defecto propuesto (al
   programar).

3. Cambio inmediato sobre un producto con cambio programado pendiente.
   Propuesta: el sistema avisa y pregunta si se cancela el cambio programado o se
   mantiene.

4. Ventas en espera (B1). Qué hacer con las que quedan abiertas durante un cambio de
   precio.

5. Mayorista y combos (A5). Cómo se programan los tramos por cantidad y el precio de
   los combos.

6. Diseño conjunto con Multimoneda. Orden de implementación y modelo de precio
   con moneda explícita.

7. Etapas y estimación (F1). Tonga decide si el desarrollo se entrega por etapas y
   propone el orden.

