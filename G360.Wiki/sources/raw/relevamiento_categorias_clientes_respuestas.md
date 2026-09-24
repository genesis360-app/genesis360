---
name: relevamiento_categorias_clientes_respuestas
description: Respuestas de Fede (2026-09-20) al relevamiento de Categorias de clientes (precios por producto + cuenta corriente). Deja 9 puntos abiertos que decide GO.
type: relevamiento
---

> **Procedencia**: texto extraido con `pdftotext -layout` del PDF que entrego GO el 2026-09-22
> (`respuestas-relevamiento-categorias-clientes.md.pdf`). Se conserva **tal cual**, con la sangria del PDF, a
> proposito: son reglas de negocio que tocan plata y la fidelidad importa mas que el formato.
> El PDF original es la fuente autoritativa ante cualquier duda.

---

Respuestas al relevamiento de reglas de negocio — Categorías
de clientes

Cómo leer este documento

      Cada punto tiene una Decisión (lo que definió Fede) y las Reglas para implementar
      (el detalle práctico que sale de esa decisión).
      (derivada) marca reglas que no se respondieron literalmente, pero salen de combinar
      otras respuestas. Tonga puede cuestionarlas.
      (propuesta) marca reglas que Fede todavía no confirmó y que se incluyen como punto
      de partida.
      (recomendación técnica) marca sugerencias de implementación que no cambian
      ninguna regla de negocio.
      Al final hay una lista de puntos abiertos que las respuestas no cierran.
      Las cuatro conclusiones que Tonga ya resolvió leyendo el código se aceptan tal cual:
      las Etiquetas de cliente siguen como están (marketing) y Categoría es una entidad
      nueva con una sola por cliente; hoy no existe ningún descuento por cliente; los valores
      por defecto de cuenta corriente del negocio ya existen; y el override de cuenta
      corriente por cliente ya está construido.

1. El modelo en resumen

  1. Categoría de cliente es una entidad nueva. Cada cliente tiene una sola. Las Etiquetas
      siguen aparte, para marketing.

  2. La categoría define dos cosas, ambas opcionales: un descuento en % por producto y
      las condiciones de cuenta corriente.

  3. Se asigna por referencia: al editar la categoría, todos los clientes que la tienen cambian
      con ella. El DUEÑO puede pisar valores de un cliente puntual, y en esos valores el
      cliente deja de heredar.

  4. En el precio, la categoría compite con el tier por cantidad: gana el mejor precio para
      el cliente. No se acumulan. El mismo criterio aplica contra el descuento por estado de
      inventario.

  5. Los demás descuentos (manual, general, cupón, promoción por método de pago)
      siguen acumulándose como hoy, pero bajo un tope configurable: por encima del tope
      se necesita autorización de un supervisor o del DUEÑO.

  6. El cajero ve un cartel que le explica qué descuento se aplicó y por qué, para poder
      darle una explicación al cliente.

  7. El precio de categoría aplica en POS, Pedidos, Presupuestos, ventas recurrentes y
      portal de clientes. No aplica en Mercado Libre ni Tienda Nube. Sin cliente identificado
      no hay precio de categoría.

 8. En cuenta corriente, lo más puntual gana: Cliente > Categoría > Negocio.

 9. Todo queda auditado: historial de la categoría y, en cada venta, la categoría, el % y el
     mecanismo que definió el precio.

10. Crear, editar, asignar y pisar categorías es, por defecto, solo del DUEÑO, con
     posibilidad de habilitar otros roles desde configuración.

11. Se entrega en dos etapas: primero la categoría con cuenta corriente, permisos y
     auditoría; después el precio.

2. Tabla resumen de decisiones

Código Decisión

A1  Categoría y tier compiten; gana el precio más bajo para el cliente. No se acumulan

A2  Categoría y descuento por estado tampoco se acumulan (gana el mayor). Cartel en el POS

    para el cajero, con una capa de IA que explica

A3  Un cliente con categoría puede recibir manual, cupón y promo por método de pago, con un

    tope de descuento acumulado

A4  Tope configurable por negocio; por encima requiere autorización de supervisor o DUEÑO

A5  El cajero ve el descuento de categoría en su pantalla; la factura lleva el precio final

B1  Aplica en las cinco pantallas: POS, Pedidos, Presupuestos, ventas recurrentes y portal

B2  Mercado Libre y Tienda Nube no se tocan: precio de lista con su ajuste por canal

B3  El % se aplica sobre el precio final (con IVA)

B4  Sin cliente identificado no hay precio de categoría

B5  Solo producto por producto, tomado de la lista que ya armó el dueño del negocio para cada

    categoría

C1  Ventas no se tocan; pedidos y presupuestos ya armados conservan su precio

C2  Se puede desactivar, no borrar

C3  Override por producto (y por campo en cuenta corriente), con atajo para volver a la categoría

C4  Un producto nuevo entra sin descuento, y aparece en Alertas como pendiente de cargar

C5  Una sola categoría por cliente

D1  Cuenta corriente: Cliente > Categoría > Negocio

D2  El cliente conserva sus valores propios. En asignaciones masivas se muestra la lista de

    quiénes los conservaron y se pueden modificar uno por uno

D3  La categoría define las cinco condiciones, todas opcionales

D4  Descuento y cuenta corriente son independientes: una categoría puede tener solo una de las

    dos partes

E1  Solo el DUEÑO crea y edita categorías, con roles habilitables desde configuración

Código Decisión

E2  Igual que E1 para asignar categorías

E3  Solo el DUEÑO puede pisar valores de un cliente puntual

F1  Historial completo de cambios de la categoría

F2  Cada venta guarda la categoría, el % y el mecanismo que definió el precio

F3  Reporte de lo no facturado por descuentos de categoría, por período, categoría y cliente

G1  Primero la categoría con cuenta corriente; después el precio

G2  Sin datos de volumen: un solo negocio lo va a usar y todavía no tiene productos cargados

3. Respuestas detalladas

A · Cómo se combina con lo que ya existe

A1 · El colocador lleva 12 bidones. ¿Cuánto paga cada uno?

Decisión: (b) categoría y tier compiten, y gana el más barato para el cliente. No se
acumulan.

Reglas para implementar:

      La categoría define, por producto, un precio de categoría = precio de lista vigente × (1
      − %).
      Para un cliente con categoría, el precio unitario de la línea es el más bajo entre el
      precio del tier (si aplica) y el precio de categoría.
      El precio de categoría se calcula en la misma etapa que el tier, antes del redondeo. De
      ahí sale el "precio unitario efectivo", y de ese número deriva todo lo demás (subtotal,
      IVA, factura) sin cambios.
      El descuento de categoría es un % sobre el precio de lista vigente: si el precio de lista
      cambia (o se programa un cambio), el precio de categoría lo sigue solo.

Casos de referencia (criterios de aceptación). Bidón de 20 litros, precio de lista $100, tier
"10 o más a $80":

Caso                                            Precio por bidón esperado
Categoría 20 %, 12 unidades                     $80 (tier $80, categoría $80: empatan)
Categoría 30 %, 12 unidades                     $70 (gana la categoría)
Categoría 20 %, 5 unidades (no aplica el tier)  $80 (categoría)
Categoría 20 %, tier $60 con 12 unidades        $60 (gana el tier)

A2 · Mismo caso, con 4 bidones de un lote "Próximo a vencer" con 15 %

Decisión: se aplica el mayor de los dos descuentos, nunca los dos juntos. Además, el POS
debe explicarle al cajero, en un cartel, qué descuento se aplicó y por qué, con una capa de
inteligencia (IA) que interprete y ayude a explicar estas situaciones.

Reglas para implementar (precio):

      (derivada) Para un cliente con categoría, en las unidades del lote con descuento por
      estado compiten tres precios, todos medidos contra el precio de lista: el del tier, el de
      categoría y el de estado. Gana el más bajo.
      Caso de referencia (lista $100, tier $80 a partir de 10, categoría 20 %, 12 bidones de los
      cuales 4 son de un lote con 15 %): esos 4 bidones salen a $80 (gana la categoría; el
      estado no se aplica). Si el lote tuviera 25 %, esos 4 saldrían a $75.
      Para clientes sin categoría, el descuento por estado sigue acumulándose con el tier
      como hoy. Esa asimetría se resuelve recién cuando se haga la regla transversal
      diferida.

Reglas para implementar (cartel en el POS):

      El cartel se muestra solo a la persona que está manejando el POS. No aparece en
      pantallas orientadas al cliente, ni en el ticket, ni en la factura.
      Aparece cuando, en una línea, compitieron dos o más descuentos y uno no se aplicó.
      Explica cuál se aplicó, con qué % y en qué producto, y por qué no se acumulan.
      Ejemplo de texto: "En Bidón 20 L se aplica el 20 % de la categoría Colocadores ($80).

       No se suma al precio por cantidad ($80) porque los descuentos no se acumulan: se
       toma el mejor para el cliente."

      El objetivo es evitar malentendidos entre el cajero y el cliente cuando este pide una
      explicación.
      La explicación se genera con una capa de IA, según lo pedido por Fede.
      (recomendación técnica) La IA explica, no calcula. Los números y el mecanismo
      ganador los produce siempre el motor de precios (ver F2), que entrega los datos
      estructurados (qué mecanismos competían, cuál ganó, %, producto). La IA solo
      redacta la explicación a partir de esos datos.

      (recomendación técnica) Debe existir un texto de respaldo por plantilla, sin IA, que
      se muestra si la IA no responde. La venta nunca se frena por esto.

A3 · ¿Descuento manual, cupón y promoción por método de pago sobre un cliente con
categoría?
Decisión: sí, con un tope máximo de descuento acumulado por venta (ver A4).

Reglas para implementar:

      El descuento manual sigue siendo, como hoy, solo de DUEÑO, SUPERVISOR y ADMIN
      (el SUPERVISOR con su tope de %). El cajero lo tiene bloqueado.
      El cupón y la promoción por método de pago siguen aplicándose como hoy.

A4 · ¿Tope máximo de descuento acumulado por venta?
Decisión: sí. Por encima del tope se pide autorización de supervisor.

Reglas para implementar:

      El tope es un % configurable por negocio.
      Se mide contra el precio de lista de la venta, sumando todo lo que descuenta: tier,
      categoría, estado, manual, general, cupón y promoción por método de pago.
      El cajero no puede vender por encima del tope. Un SUPERVISOR o el DUEÑO puede
      autorizarlo.
      (derivada) Hasta que el negocio defina un tope, no rige ninguno (como hoy).

A5 · ¿Cómo se ve el descuento de categoría en pantalla y ticket?
Decisión: (c) visible en la pantalla del cajero, plegado en la factura.

Reglas para implementar:

      La factura lleva el precio unitario efectivo, igual que hoy con el precio mayorista.
      El cajero ve, por ejemplo, "Categoría Colocadores: −20 % sobre lista".
      En documentos que no son factura (presupuesto, ticket interno) se puede mostrar el
      ahorro del cliente.

B · Dónde aplica el precio de categoría
B1 · ¿En qué pantallas?
Decisión: en las cinco: POS, Pedidos, Presupuestos, ventas recurrentes y portal de clientes /
pedidos que arma el cliente.

Reglas para implementar:

      Si se implementa por etapas, el orden es: POS, Pedidos, Presupuestos, ventas
      recurrentes y portal.

      Cualquier canal que todavía no esté cubierto no debe aplicar ni prometer el precio de
      categoría.
      El precio se calcula hoy en dos motores (mostrador y servidor, este último para
      Pedidos) que tienen que dar el mismo número, y ninguno sabe quién es el cliente. Ese
      es el trabajo técnico grande de esta función.
      (recomendación técnica) Una sola lógica de cálculo o, si no se puede, una batería de
      casos de prueba compartida que ambos motores tengan que pasar, empezando por
      los casos de referencia de A1 y A2.

B2 · Mercado Libre y Tienda Nube
Decisión: (a) se sigue publicando el precio de lista con su ajuste por canal. La categoría no
toca los canales.

B3 · ¿Sobre precio con IVA o sin IVA?
Decisión: (a) sobre el precio final, como se ve en la góndola. Un % sobre el precio final y el
mismo % sobre el neto dan el mismo resultado, y el desglose de IVA y factura sale del precio
unitario efectivo. Conviene que el contador confirme cómo se ve en la factura.

B4 · Venta sin cliente identificado
Decisión: (a) sin cliente cargado no hay precio de categoría.

Reglas para implementar:

      El POS debe tener búsqueda rápida de cliente (por nombre, CUIT o teléfono) y alta
      rápida en el mismo lugar, para no frenar al mayorista apurado.
      Si en el uso real aparece fricción, se agrega la opción de autorización de supervisor.

B5 · ¿Descuento general para toda la categoría, además del producto por producto?
Decisión: solo producto por producto. Los descuentos ya están armados por lista: el dueño
del negocio armó, para cada categoría, una lista con cuánto descuento tiene cada producto
(puede haber puesto el mismo % a todos, pero es decisión suya). El descuento ya está
definido ahí.

Reglas para implementar:

      No hay % general por categoría ni por rubro.
      (derivada) Como las listas ya existen, hace falta una forma de importarlas a cada
      categoría (ver puntos abiertos), además de poder editarlas a mano.
      (derivada) Como las listas se cargan producto por producto, los productos deben
      existir en el sistema antes de importar la lista.

C · Ciclo de vida de la categoría
C1 · Se edita el descuento de una categoría con 40 clientes

Decisión: (b) las ventas no se tocan, y los pedidos y presupuestos ya armados conservan el
precio con el que se armaron.

Reglas para implementar:

      Lo que está en borrador sí se recalcula.
      Al editar la categoría, el sistema muestra el impacto: "esto afecta a N clientes; hay M
      presupuestos y pedidos pendientes que conservarán el precio anterior".

C2 · Borrar una categoría con clientes
Decisión: (b) se puede desactivar, no borrar.

Reglas para implementar:

      Al desactivar, el sistema avisa: "N clientes pasarán a precio de lista". Deja de aplicar y
      se conserva el historial.
      Solo se puede borrar de verdad una categoría que nunca se usó, porque las ventas
      viejas la referencian (ver F2).

C3 · Volver a la categoría después de un override
Decisión: (b) el override es por producto: el cliente sigue heredando todo lo demás y se
quita producto por producto. Más el atajo de (a): un botón "volver a la categoría" que borra
todos los valores propios de golpe.

Reglas para implementar:

      Los valores propios se ven marcados frente a los heredados ("valor propio").
      La misma lógica de herencia por campo aplica a cuenta corriente (ver D1).

C4 · Producto nuevo
Decisión: (a) sin descuento (0 %) hasta que alguien lo cargue, y (c) con una alerta en
Alertas de que hay productos sin cargar en las categorías.

Reglas para implementar:

      (recomendación técnica) Distinguir "sin cargar" de "0 % explícito". La alerta debe
      listar solo los productos sin cargar, no los que el dueño dejó a propósito sin descuento.

C5 · Cantidad de categorías por cliente
Decisión: una sola categoría por cliente. Para segmentar en varios grupos ya existen las
Etiquetas.

D · Cuenta corriente
D1 · Con tres niveles, ¿quién gana?
Decisión: (a) Cliente > Categoría > Negocio. Lo más puntual gana.

D2 · Cliente con límite propio de $500.000 y categoría con límite de $200.000

Decisión: el cliente conserva sus valores propios, con un aviso al asignar. En una asignación
masiva, el sistema debe mostrar cuáles son los clientes que conservaron valores propios y
permitir modificarlos uno por uno en ese mismo momento, en una lista, guardando con el
botón Guardar.

Reglas para implementar:

      Asignación individual: al asignar la categoría, el sistema avisa: "este cliente tiene
      límite propio de $500.000 y la categoría define $200.000. ¿Mantener o usar el de la
      categoría?". Por defecto conserva el propio.
      Asignación masiva: después de asignar, se muestra una lista de los clientes que
      conservaron valores propios (por ejemplo, "12 clientes conservaron valores propios").
      Para cada uno se ve su valor propio frente al de la categoría. Los campos son los que
      hoy tiene el override por cliente: habilitada, límite y plazo.
      En esa lista, para cada cliente se puede mantener el valor propio, usar el de la
      categoría o editar el valor.
      (propuesta) La asignación y los cambios hechos uno por uno se confirman juntos al
      presionar Guardar.
      Al editar el límite de una categoría, el sistema muestra cuántos clientes quedarían por
      encima del nuevo límite.

D3 · Condiciones de cuenta corriente que define la categoría

Decisión: las cinco, todas opcionales: (a) habilitar o no, (b) límite de crédito, (c) plazo de
pago en días, (d) interés por mora y (e) qué hacer al pasarse del límite (permitir, avisar o
bloquear).

Reglas para implementar:

      La política de morosidad y las notificaciones quedan solo a nivel negocio.
      Limitación conocida: el override por cliente sigue cubriendo solo tres campos
      (habilitada, límite y plazo). Para darle a un cliente puntual otro interés o política de
      exceso, hay que ponerlo en una categoría propia o ampliar el override más adelante.

D4 · Categoría con descuento pero sin cuenta corriente, o al revés

Decisión: sí, cada parte es opcional. Una categoría puede tener solo precio, solo cuenta
corriente, o las dos.

Reglas para implementar:

      Cada condición de cuenta corriente tiene tres estados: hereda del negocio, sí o no.
      Una categoría solo de precio no deshabilita la cuenta corriente: la deja como está en el
      negocio.

E · Permisos
E1 · ¿Quién crea y edita categorías?
Decisión: solo el DUEÑO, por defecto. Reglas para implementar: desde configuración, el
DUEÑO puede habilitar a otros roles, como con la cotización manual en Multimoneda.

E2 · ¿Quién asigna una categoría a un cliente?
Decisión: igual que E1: solo el DUEÑO por defecto, con la posibilidad de habilitar otros roles
desde configuración. Reglas para implementar: queda registrado quién asignó qué
categoría a qué cliente y cuándo.

E3 · Override por cliente
Decisión: solo el DUEÑO.

F · Auditoría
F1 · Historial de cambios de la categoría
Decisión: (a) historial completo.

Reglas para implementar: se registran, con quién y cuándo:

      los cambios de % por producto (de cuánto a cuánto),
      las altas y bajas de productos en la categoría,
      los cambios de condiciones de cuenta corriente,
      el alta y la desactivación de la categoría,
      las asignaciones a clientes y los overrides.

F2 · ¿La venta guarda qué categoría y qué % se aplicó?
Decisión: (a) sí.

Reglas para implementar: cada venta guarda, por línea, la categoría aplicada, el % y el
mecanismo que definió el precio (lista, tier, categoría o estado). Esto permite responder
"¿cómo salió esta venta a este precio?" meses después. Las ventas anteriores a esta función
quedan sin ese dato.

F3 · Reporte de lo que se dejó de facturar
Decisión: (b) por período y por categoría, y también por cliente.

Reglas para implementar: solo cuentan las líneas donde el precio de categoría fue el que
ganó, no las del tier. Se calcula con los datos que guarda F2.

G · Prioridad y volumen
G1 · ¿Qué va primero?

Decisión: (a) primero la categoría con las condiciones de cuenta corriente (se puede usar
enseguida), después el precio.

Reglas para implementar:

      Etapa 1: la categoría, la asignación, las condiciones de cuenta corriente, los permisos y
      la auditoría.
      Etapa 2: el precio, que toca los dos motores y concentra todo el riesgo de plata. Incluye
      el cartel del POS y la capa de IA de A2, el tope de A4 y el reporte de F3.
      La etapa 2 debe cerrarse con los casos de prueba de referencia de A1 y A2 pasando en
      ambos motores.

G2 · Cantidades esperadas y listas de precios

Decisión: no se sabe. Las listas y los clientes son del negocio que usa la función, y el equipo
de Genesis360 no los maneja. Hoy hay un solo negocio que lo va a aplicar, y todavía no tiene
productos cargados en el sistema.

Reglas para implementar:

      No hay datos de volumen. Tonga define límites razonables y avisa si la importación
      necesita procesarse por lotes.
      Las listas de descuento por categoría las tiene el negocio ya armadas (ver B5): la
      importación debe estar contemplada, pero no hace falta resolverla para el primer día,
      porque los productos todavía no están cargados.

4. Relación con los otros relevamientos

      Multimoneda. El descuento de categoría es un % y funciona sobre el precio en la
      moneda en que esté cargado el producto. Los montos fijos (por ejemplo, el cupón) se
      expresan en la moneda que corresponda según lo definido en Multimoneda.
      Precio programado. El descuento de categoría se calcula sobre el precio de lista
      vigente, así que cuando un precio programado pasa a regir, el precio de categoría lo
      sigue solo.
      Reservas y presupuestos. La regla de C1 es coherente con lo definido en Precio
      programado: lo ya pactado se respeta.

5. Puntos abiertos para que Tonga proponga o resuelva

  1. Importación de la lista de descuentos por categoría (B5). Formato de archivo, cómo
      se identifican los productos (código o SKU), qué hacer con productos que todavía no
      existen, validaciones y manejo de errores.

  2. Capa de IA del cartel (A2). Alcance exacto (solo redacción), texto de respaldo por
      plantilla, latencia en el POS, y qué datos se le envían.

  3. Regla de comparación (A2). Confirmar que categoría, tier y estado se comparan
      contra el precio de lista para clientes con categoría, y cómo convive con los clientes sin

   categoría, donde estado y tier siguen acumulándose.

4. Motores de precio (B1). Una sola lógica de cálculo o una batería de casos de prueba
   compartida, con los casos de referencia de A1 y A2 como base.

5. Tope de descuento acumulado (A4). Confirmar qué mecanismos cuentan y dónde se
   configura.

6. Asignación masiva (D2). Confirmar si la asignación se persiste antes de Guardar o se
   confirma junto con los cambios uno por uno.

7. Override por cliente (D3). Si más adelante se amplía más allá de habilitada, límite y
   plazo.

8. Portal de clientes (B1). Cómo se identifica al cliente en pedidos que arma él solo, y que
   aplique la misma lógica de precio.

9. Volumen (G2). Sin datos de volumen: definir límites razonables de diseño.

