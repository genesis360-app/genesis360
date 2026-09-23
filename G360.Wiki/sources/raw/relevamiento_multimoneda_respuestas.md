---
name: relevamiento_multimoneda_respuestas
description: Respuestas de Fede (2026-09-20) al relevamiento de Multimoneda. Incluye A0 (arreglar YA el importador, por separado) y 11 puntos abiertos que decide GO.
type: relevamiento
---

> **Procedencia**: texto extraido con `pdftotext -layout` del PDF que entrego GO el 2026-09-22
> (`respuestas-relevamiento-multimoneda.md.pdf`). Se conserva **tal cual**, con la sangria del PDF, a
> proposito: son reglas de negocio que tocan plata y la fidelidad importa mas que el formato.
> El PDF original es la fuente autoritativa ante cualquier duda.

---

Respuestas al relevamiento de reglas de negocio —
Multimoneda

Genesis360 · Respuestas de Fede · 20 de septiembre de 2026 Relevamiento original:
v1.227.1 (16 de septiembre de 2026). Pedido de GO: "moneda principal configurable +
cotización por moneda + alcance total".

Cómo leer este documento

      Cada punto tiene una Decisión (lo que definió Fede) y las Reglas para implementar
      (el detalle práctico que sale de esa decisión).
      (derivada) marca reglas que no se respondieron literalmente, pero salen de combinar
      otras respuestas. Tonga puede cuestionarlas.
      (recomendación técnica) marca sugerencias de implementación que no cambian
      ninguna regla de negocio.
      Al final hay una lista de puntos abiertos que las respuestas no cierran y que Tonga
      debe proponer.
      Todo lo listado como "ya definido" en el relevamiento original sigue vigente, salvo lo
      que este documento cambia de forma explícita (ver "Qué cambia respecto de lo ya
      definido").

1. El modelo en resumen

  1. Monedas habilitadas. En Configuración hay una lista con las 11 monedas (ARS, USD,
      CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR). El negocio elige cuáles usa. Por
      defecto solo están habilitadas ARS y USD.

  2. Principal y secundaria. En esa misma lista se marca una moneda principal y una
      secundaria. Siempre son exactamente dos, distintas entre sí, y siempre están
      habilitadas. Por defecto en Argentina: ARS principal y USD secundaria.

  3. La moneda principal es solo el valor por defecto. No limita nada: cualquier precio,
      costo, gasto, venta, etc. se puede cargar en cualquier moneda habilitada. La principal
      es lo que aparece preseleccionado.

  4. Todos los módulos operan en todas las monedas habilitadas: venta, caja, cuenta
      corriente, precios, costos, compras, gastos, sueldos, envíos y caja fuerte.

  5. Los medios de pago no tienen moneda. "Efectivo", "Transferencia", "Mercado Pago" o
      "Tarjeta" existen una sola vez. La moneda se elige al registrar cada pago o movimiento.

  6. La venta guarda la moneda real de cada pago. Máximo 2 monedas por venta. El
      vuelto siempre es en moneda principal.

  7. Cotización por negocio, con historial auditable en una pestaña nueva del módulo
      Historial.

  8. Reportes por pestañas de moneda, sin mezclar ni convertir.

 9. La conversión de dinero entre monedas se hace solo desde la Caja Fuerte (Bóveda)
     y solo la puede hacer el DUEÑO.

10. Fiscal: la factura siempre se emite en pesos. La cotización fiscal (día hábil anterior) es
     un concepto separado de la cotización operativa.

2. Tabla resumen de decisiones

Código Decisión

A0  Arreglar ya el problema de las columnas de moneda del importador, por separado del

    proyecto

A1  La moneda principal solo define el valor por defecto; no restringe el uso de otras monedas

A2  Se puede cambiar en cualquier momento; solo cambia los valores por defecto (requiere

    guardar monedas de forma explícita, ver A2)

A3  Todas las monedas que el negocio quiera, sin límite. Por defecto solo ARS y USD habilitadas

A4  Las 11 actuales, todas con cotización automática vía API (mismo funcionamiento que el USD

    hoy)

A5  Siempre una principal y una secundaria, configurables. Por defecto ARS y USD

B1  Por ahora dolarapi; se revisa por país cuando se lance afuera

B2  Guardar compra y venta, pero la pantalla pide un solo valor (con opción de separarlos)

B3  Actualizar la cotización al iniciar el día; avisar si está vieja. Fiscal: día hábil anterior

B4  Cotización por negocio

B5  Sí, historial completo en pestaña nueva "Cotizaciones" del módulo Historial

B6  Manda la cotización cargada hasta ese instante (con aviso si toca actualizar)

B7  Mismo criterio de permisos; además, cotización manual para monedas que no sean principal

    ni secundaria

C   Todos los módulos, en todas las monedas habilitadas (mínimo principal y secundaria)

C11 La venta guarda su moneda y su monto real en esa moneda (derivada de D1 y D2)

D1  Reporte completo dividido en pestañas por moneda

D2  Máximo 2 monedas por venta, con selector de moneda en cada pago

D3  Vuelto siempre en moneda principal

D4  Conversión solo desde la Bóveda y solo el DUEÑO

D5  Sin cotización: error, nunca se inventa una tasa

E1  Indistinto: son datos de prueba

Código Decisión

E2  Los registros viejos quedan como nacieron

E3  La Caja Fuerte se guía por las monedas elegidas (principal y secundaria)

E4  Una moneda solo se puede desactivar cuando no queda nada en esa moneda

F1  Factura siempre en pesos, aunque se pague en dólares

F2  Mantener lo actual (Libro IVA Compras deja afuera esos gastos con aviso)

F3  Día previo, a verificar. Verificado en este documento (sección 5)

G1  Se salda a la cotización del día

G2  Se puede devolver en la otra moneda, convirtiendo a la cotización del día

G3  Se publica el precio convertido a moneda principal

G4  Se define más adelante

H1  Todo es prioridad

H2  Por ahora todo Argentina; preparar la app para lanzar en otros países (derivada)

3. Respuestas detalladas

A0 · Hallazgo de integridad (columnas de moneda de productos)

Decisión: arreglarlo ya, por separado, sin esperar al proyecto multimoneda.

Reglas para implementar:

  1. Consulta de solo lectura a la base para contar cuántos productos se importaron por
      CSV con moneda USD y en qué negocios. Como hoy no hay negocios reales, se espera
      que sean de prueba.

  2. Corregir el importador para que escriba las columnas vivas ( moneda_venta /
       moneda_costo ) según la moneda del CSV.

  3. Si hubiera productos afectados en negocios reales: armar una lista para que el dueño
      la revise. No corregir automáticamente.

  4. Las columnas muertas ( precio_venta_moneda / precio_costo_moneda ) se eliminan
      dentro del rediseño multimoneda.

Notas para Tonga:

      El fix debe ser mínimo y no complicar la migración posterior (ver A2: las monedas
      pasarán a guardarse con código explícito).

      Ya en el rediseño, el importador debe aceptar todas las monedas habilitadas del
      negocio, no solo ARS y USD.

A · La moneda principal del negocio

A1 · ¿Qué significa "moneda principal configurable"?

Decisión: la moneda principal es únicamente el valor por defecto de la moneda que el
negocio suele usar. No implica que no se puedan usar otras monedas.

Reglas para implementar:

      Se elige en Configuración el día 1.
      Siempre que se define algo relacionado con una moneda (precio de venta, costo, gasto,
      sueldo, tarifa de envío, pago en una venta, caja nueva, etc.), el selector de moneda
      viene preseleccionado con la principal.
      Ese valor se puede cambiar en cada caso puntual. Ejemplo: un negocio con principal
      ARS carga un gasto en USD. El selector viene en ARS y el usuario lo cambia.
      La moneda principal es la misma cosa que la moneda del negocio ( tenants.moneda ): si
      se modifica una, se modifica la otra.
      Ya no es solo un símbolo visual (como hoy): pasa a ser el valor por defecto real de todo
      el sistema.

A2 · ¿Puede cambiarse la moneda principal después de haber operado?

Decisión: sí, en cualquier momento. Como la principal solo define valores por defecto, no
afecta lo que ya se cargó en otra moneda. Lo único que cambia es que, desde ese momento,
todo lo relacionado con precios toma como default la nueva moneda.

Requisito técnico para que esto sea cierto (importante): Hoy varias cosas guardan la
moneda de forma relativa, no explícita. Los productos guardan moneda_venta /
moneda_costo como 'local' o 'usd' , y ventas.total está "siempre en pesos" de forma
implícita. Si un negocio pasa de ARS a CLP, todo lo que dice 'local' empezaría a leerse
como CLP: precios reinterpretados sin que nadie los haya tocado.

Para cumplir esta decisión hace falta:

  1. Guardar siempre un código de moneda explícito (ARS, USD, CLP…) en productos,
      ventas, pagos, gastos, compras, cajas, etc. Nunca 'local' .

  2. Migrar los valores 'local' existentes al código de la moneda principal actual de cada
      negocio.

  3. Que ventas.total lleve su moneda explícita.
  4. Que el historial de cotizaciones guarde pares explícitos (moneda origen → moneda

      destino) y no "contra la principal", para que no se invalide si cambia la principal.
  5. Registrar en un log quién cambió la moneda principal y cuándo (recomendación

      técnica).

A3 · ¿Cuántas monedas puede operar un mismo negocio a la vez?

Decisión: todas las que quiera.

Reglas para implementar:

      Crear en Configuración (si no existe todavía) una sección con la lista de monedas
      donde el negocio marca cuáles tiene habilitadas.
      Por defecto solo aparecen seleccionadas ARS y USD. Las otras 9 aparecen con el
      casillero sin marcar. El negocio puede activar las que quiera.
      No hay límite de monedas habilitadas (hasta las 11).
      Para poder operar cada moneda hay que resolver de dónde sale su cotización real (ver
      A4, B1 y B7).
      Esto es distinto del límite por venta: máximo 2 monedas en una misma venta (D2).
      La lógica de caja, bóveda, pago combinado y conversión, hoy escrita para dos
      monedas, debe pasar a funcionar con N monedas.
      (recomendación técnica) Guardar los montos como "monto + código de moneda" en
      lugar de columnas separadas por moneda.

A4 · ¿Las 11 monedas actuales son las que quieren?

Decisión: sí, esas 11: ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP y EUR. Todas
conectadas por API para traer su cotización en tiempo real, con el mismo funcionamiento
que tiene hoy el USD.

Notas para Tonga:

      La cobertura real de la fuente para las 11 monedas está por verificar (ver B1 y puntos
      abiertos).
      Cada moneda tiene su propio formato de decimales (por ejemplo, el peso chileno y el
      guaraní no usan centavos). Definir cómo convive eso con la regla "sin redondeo,
      decimales exactos".

A5 · ¿El dólar sigue teniendo un lugar especial?

Decisión: en la misma lista de Configuración debe haber un selector para indicar cuál es la
moneda principal y cuál la secundaria. Siempre son 2, y no puede haber más de una de
cada tipo. Por ahora, como todo será Argentina, el default es ARS principal y USD
secundaria. Más adelante se ajusta según el país.

Reglas para implementar:

      Principal y secundaria son siempre distintas y siempre están habilitadas (no se
      pueden desmarcar).
      El dólar deja de estar "cableado" como la otra moneda: donde hoy dice USD (Caja USD,
      Bóveda USD, pago combinado, cotización), pasa a leerse la moneda secundaria
      configurada.

      Principal y secundaria son las dos monedas mínimas garantizadas en todos los
      módulos (ver C).

B · Cotizaciones
B1 · ¿De dónde sale la cotización de una moneda que no sea el dólar?
Decisión: por ahora se usa dolarapi. Cuando se lance en otros países se verá si se cambia,
según la lógica que corresponda a cada país.

Notas para Tonga: ver la sección 6 (puntos abiertos): hay que verificar qué pares de
monedas cubre realmente dolarapi y qué hacer donde no haya fuente.

B2 · ¿Compra y venta para cada moneda?
Decisión: se sigue la sugerencia hecha en el relevamiento.

Reglas para implementar:

      Para el dólar queda como hoy: dos valores (compra y venta).
      Para el resto, el sistema guarda siempre los dos valores, pero la pantalla de carga pide
      uno solo y lo copia a ambos (compra = venta).
      Si el negocio quiere, puede cargar compra y venta por separado.
      (derivada) La regla de dirección ya definida para el dólar se aplica igual a cualquier
      moneda: convertir hacia la principal usa la cotización de compra; convertir desde la
      principal usa la de venta.

B3 · ¿Con qué frecuencia se actualiza y qué pasa si está vieja?
Decisión: se hace una actualización siempre al iniciar el día. Para la facturación se usa la
cotización del día previo (ver sección 5, verificación legal).

Reglas para implementar:

      Actualización diaria al inicio del día: automática para las monedas que tengan fuente;
      para las manuales, el sistema avisa que hay que cargarla.
      Si la cotización no está al día, la pantalla avisa (ver también B6). No se bloquea la
      operación por este motivo.
      La cotización fiscal es un concepto distinto de la operativa (ver F3): se guarda en cada
      comprobante la cotización fiscal usada. La columna gastos.cotizacion_fiscal ya
      existe.

B4 · ¿Por negocio o por sucursal?
Decisión: la cotización es por negocio.

B5 · ¿Se guarda historial de cotizaciones?
Decisión: sí, sobre todo para poder auditar.

Reglas para implementar:

      En el módulo Historial se crea una pestaña nueva llamada "Cotizaciones".
      La pestaña actual de Historial pasa a llamarse "Movimientos".
      La pestaña Cotizaciones muestra todas las cotizaciones con su historial.
      Filtros: por moneda y por rango de fechas.
      Cada registro muestra quién la actualizó (usuario o "automático"), cuándo, si fue
      manual o automática y los valores cargados (compra y venta).
      El historial solo agrega registros: nunca se editan ni se pisan.

B6 · ¿Manda la cotización del momento o una fija del día?

Decisión: por ahora manda la cotización cargada hasta ese instante, y el sistema avisa si
debe o no actualizarse. La regla de cómo se aplica la cotización en la facturación tiene que
respetar lo que dice la ley (ver sección 5). Falta terminar de chequear si para la actualización
realmente corresponde usar la del día anterior.

B7 · ¿Quién puede cargar la cotización de las monedas nuevas?

Decisión: mismo criterio que el dólar (DUEÑO siempre + roles habilitados; el resto solo
refresca). Además, se puede usar una cotización manual para las monedas que no sean la
principal ni la secundaria.

C · Alcance: en qué módulos

Decisión general: en todos los módulos deben estar habilitadas, como mínimo, la principal
y la secundaria (la principal como default). La moneda principal está directamente
relacionada con la moneda del negocio: si se modifica una, se modifica la otra.

Además, la lista de monedas habilitadas de Configuración es la que habilita todas las
monedas en todos los módulos. Esto corrige el problema de Gastos: hoy se puede cargar un
gasto en una moneda que el negocio no cobra ni genera, y ese gasto termina descontándose
de algo que no existe.

Reglas para implementar, módulo por módulo:

Módulo                             Regla
C1 · Precios de producto           El precio de venta se puede definir en cualquier moneda
                                   habilitada. Default: principal
C2 · Venta (POS)                   Se puede cobrar en cualquier moneda habilitada (ver D2)
C3 · Caja                          Se necesita caja en cada moneda en la que se quiera cobrar
C4 · Caja Fuerte (Bóveda)          Incluye todas las monedas habilitadas (ver detalle abajo)
C5 · Gastos                        Solo se puede cargar un gasto en una moneda habilitada.
                                   Default: principal
C6 · Compras / OC y costos de      El costo de producto y la OC pueden estar en cualquier
producto                           moneda habilitada
C7 · Cuenta corriente (clientes y  Con moneda propia, en cualquier moneda habilitada
proveedores)
C8 · Sueldos / RRHH                En cualquier moneda habilitada. Default: principal
C9 · Envíos / tarifas              En cualquier moneda habilitada. Default: principal
C10 · Facturación AFIP             Siempre en pesos (ver F)

Medios de pago y Caja Fuerte (aclaración importante):

      Los medios de pago no tienen moneda. Los medios son efectivo, transferencia,
      Mercado Pago, tarjeta de crédito, etc. No debe haber "efectivo $" y "efectivo USD"
      como medios distintos: existe "efectivo", y después se indica en qué moneda se paga.
      Esto afecta principalmente a la venta: al elegir el medio de pago se indica la moneda
      del pago.
      Lo mismo aplica a los métodos donde se tiene el dinero (los que aparecen en la Caja
      Fuerte y de donde se descuentan los gastos): funcionan igual, sin moneda propia. Hoy
       metodos_pago y cuentas_origen tienen moneda propia: hay que quitársela.
      En la Caja Fuerte hoy los montos por método de pago solo se ven en pesos. Deben
      pasar a verse en cada moneda habilitada, dentro de la card de cada medio de pago.
      El total de la Caja Fuerte debe indicar cuánto hay en cada moneda.

C11 · La venta no guarda en qué moneda se hizo

Decisión (derivada de D1 y D2): sí, hay que cambiarlo. La venta debe guardar su moneda y
su monto real en esa moneda.

Reglas para implementar:

      Cada pago de la venta guarda: medio de pago, moneda, monto real en esa moneda y
      cotización usada (si hubo conversión).
      La venta guarda su moneda explícita (ver A2).
      Las ventas viejas quedan como están, marcadas como "sin detalle de moneda". No se
      reescriben (ver E2).

D · Totales, conversión y reportes
D1 · ¿Qué muestra un total con 3 o más monedas?
Decisión: un reporte completo dividido en pestañas por moneda. Es lo mismo que si
hubiera una sola moneda, multiplicado por el resto de monedas, tomando la data de cada
una por separado.

Reglas para implementar:

      Cada pestaña muestra el reporte completo usando únicamente los datos de esa
      moneda.
      No se mezclan ni se convierten monedas entre pestañas.
      (derivada) La misma lógica aplica al Dashboard, reemplazando los modos ARS / USD /
      REAL actuales.

D2 · ¿Se puede cobrar una venta en tres monedas?
Decisión: máximo 2 monedas por venta.

Reglas para implementar:

      En el módulo Ventas, cada vez que se agrega un método de pago, al poner el monto hay
      un selector de moneda que indica en qué moneda se paga ese medio de pago. Default:
      la moneda del negocio.
      Una venta puede tener varios pagos, pero como máximo 2 monedas distintas en total.

D3 · Vuelto
Decisión: el vuelto siempre en moneda principal.

D4 · Conversión de dinero
Decisión: sí, se mantiene. La conversión interna de dinero solo la puede hacer el dueño
desde la Bóveda. (derivada) Con N monedas habilitadas, la Bóveda permite convertir entre
cualquier par de monedas habilitadas, siempre solo el DUEÑO.

D5 · Falta la cotización de una moneda
Decisión: nunca se inventa una tasa. Si no hay cotización para una moneda, debe saltar un
error indicando que no hay cotización para esa moneda. El usuario debe pagar con otra
moneda o actualizar la cotización para poder finalizar la venta.

E · Registros históricos
E1 · Negocio de GO en CLP con gastos guardados como ARS
Decisión: es indistinto, porque todo es testing (todavía no hay negocios reales). No hace
falta corregir esos datos. Regla derivada de A1: el valor por defecto de gastos.moneda deja
de ser 'ARS' fijo y pasa a tomar la moneda principal del negocio, para que no se repita.

E2 · Registros viejos: ¿se migran o quedan como nacieron?
Decisión: quedan como nacieron.

E3 · La Caja Fuerte nace siempre en ARS
Decisión: la Caja Fuerte, al igual que todo, se guía por las monedas elegidas por el negocio,
tomando la principal y la secundaria como tales. Se corrige el ARS fijo.

E4 · Desactivar una moneda
Decisión: antes de desactivar una moneda no puede quedar nada asociado a ella. No se
puede desactivar si hay:

      productos con esa moneda,
      dinero en caja,
      dinero en Caja Fuerte,
      cajas creadas en esa moneda,
      saldos en esa moneda,
      gastos pendientes en esa moneda,
      cuentas corrientes activas en esa moneda (propias o de clientes).

Para poder desactivarla hay que sacar todo eso: eliminar las cajas en esa moneda, sacar el
dinero, etc.

Reglas para implementar:

      (derivada) La moneda principal y la secundaria no se pueden desactivar.
      (recomendación técnica) Al intentar desactivar, mostrar una lista de lo que lo bloquea,
      con cantidades y acceso directo.
      "Eliminar cajas" debe entenderse como archivar o cerrar sin borrar el histórico (ver
      E2).

F · Fiscal
F1 · ¿La factura electrónica sigue siempre en pesos?
Decisión: sí, seguir en pesos. Si se paga en dólares, igualmente la factura se emite en pesos,
convirtiendo los USD a pesos.

F2 · Gasto en moneda extranjera con IVA

Decisión: mantener lo actual. El Libro IVA Compras deja esos gastos afuera y avisa en
pantalla.

F3 · ¿Qué cotización oficial corresponde para lo fiscal?
Decisión: verificar, pero según lo entendido por Fede, la del día previo. Verificado en la
sección 5 con matices importantes.

G · Casos límite
G1 · Cliente que debe en una moneda y paga en otra
Decisión: se salda a la cotización del día. Regla para implementar: guardar la cotización
usada en el pago, para poder auditar.

G2 · Devoluciones
Decisión: no necesariamente en la moneda del pago original. Se puede devolver en la otra
moneda, convirtiendo a la cotización del día. Regla para implementar: guardar la
cotización usada en la devolución.

G3 · Mercado Libre y Tienda Nube
Decisión: publicar el precio convertido a moneda principal, como se sugirió en el
relevamiento.

Reglas para implementar:

      Se usa la misma cotización que usa el POS, para que el precio publicado coincida con
      el del mostrador.
      Si la cotización cambia de golpe más de un umbral (a definir), pedir confirmación
      antes de re-sincronizar los precios publicados, para evitar que una cotización mal
      cargada mande precios erróneos a todas las publicaciones.
      Tonga define cada cuánto se re-sincroniza.

G4 · Planes y facturación de Genesis360
Decisión: se define más adelante.

H · Prioridad
H1 · ¿Qué va primero?
Decisión: todo es prioridad. El alcance completo es lo que se necesita. A0 se ejecuta ya y por
separado. Pedido a Tonga: proponer el orden interno de implementación, qué se puede
entregar por etapas para reducir riesgo, y una estimación. Es un pedido de planificación, no
un recorte de alcance.

H2 · ¿Cliente concreto o vender afuera?
Decisión (derivada de A5, B1, E1 y G4): hoy no hay negocios reales ni un cliente concreto
fuera de Argentina. El lanzamiento inicial es solo Argentina, y el objetivo es dejar la app

preparada para lanzar en otros países más adelante. La lógica por país se ajusta cuando
llegue ese momento.

4. Qué cambia respecto de lo ya definido

      Vuelto: antes "siempre en pesos". Ahora "siempre en moneda principal" (D3).
      Reportes y Dashboard: antes modos ARS / USD / REAL. Ahora pestañas por moneda
      (D1). Sigue sin mezclarse ni convertirse nada.
      Dólar cableado: antes el dólar era "la otra moneda" en todos lados. Ahora es la moneda
      secundaria configurable, con USD por defecto en Argentina (A5).
      Dirección de conversión compra/venta: antes definida solo para USD. Ahora se aplica
      a cualquier moneda (B2).
      Sigue igual: solo cotización oficial BNA para el dólar, conversión solo desde la Bóveda
      y solo el DUEÑO, sin redondeo, facturación AFIP 100 % en pesos, permisos para
      cargar cotización manual.

5. Verificación legal realizada (facturación y cotización)

Esta sección es información recopilada, no asesoramiento legal ni contable. Lo fiscal lo
confirma el contador.

Norma encontrada: Resolución General ARCA 5616/2024. Está vigente desde diciembre de
2024, y para quienes facturan por web service es obligatoria desde el 15 de abril de 2025.
Notas de prensa y de cámaras empresarias de 2026 la siguen citando como vigente.

Qué dice: cuando un comprobante se emite en moneda extranjera y la operación se cancela
en esa misma moneda, se usa el tipo de cambio vendedor divisa del Banco de la Nación
Argentina, al cierre del día hábil cambiario anterior al de la emisión. En comprobantes
electrónicos, el sistema de ARCA consigna ese tipo de cambio de forma automática.
Alcanza a los comprobantes clase A, B, C, E y T. Para monedas sin cotización en el BNA, el
emisor informa el tipo de cambio que usó.

Qué confirma: la idea de "usar la cotización del día previo" es correcta, con estos matices:

  1. Es el día hábil anterior, no "ayer" (un lunes corresponde el viernes; también cuentan
      los feriados).

  2. Es el tipo de cambio vendedor divisa, no el comprador. La app hoy usa el dólar
      compra para pasar de USD a pesos. Si se quisiera usar ese valor a nivel fiscal, hay que
      revisar esto.

  3. Aplica a comprobantes emitidos en moneda extranjera.

Qué no se encontró: una norma que fije lo mismo para el caso elegido en F1 (factura emitida
en pesos de una venta cobrada en dólares).

Consecuencia de diseño: la cotización operativa (la del momento, con la que se opera) y la
fiscal (la que exige la norma cuando corresponda) son conceptos distintos y conviene

guardarlas por separado. La cotización fiscal se guarda en cada comprobante.

Preguntas para el contador:

  1. Si una venta se cobra en dólares y la factura se emite en pesos, ¿qué cotización se usa
      para pasar los dólares a pesos: la que usó el negocio en el mostrador o la del BNA del
      día hábil anterior? ¿Comprador o vendedor?

  2. Para un gasto en moneda extranjera con IVA, ¿genera crédito fiscal y a qué cotización
      (fecha de la factura del proveedor o fecha de pago)?

  3. ¿Qué cotización oficial corresponde usar para lo fiscal en general (tipo, banco, día)?

6. Puntos abiertos para que Tonga proponga o resuelva

  1. Cobertura de cotizaciones. dolarapi ofrece APIs por país (según su repositorio:
      Argentina, Chile, Brasil, Bolivia, Colombia, Uruguay, México y Venezuela), y para
      Argentina publica además del dólar, según lo hallado, euro, real, peso chileno y peso
      uruguayo. No se pudo confirmar que cubra todos los pares necesarios para un negocio
      argentino con las 11 monedas (por ejemplo PYG, PEN, BOB, MXN, COP). Verificar par
      por par y proponer: automático donde haya fuente, manual (B7) donde no. Definir
      además si una cotización derivada de dos pares (por ejemplo, vía USD) se considera
      válida, dado que la regla es "nunca inventar una tasa".

  2. Mecánica del "inicio del día". Horario, zona horaria y qué hace el sistema si falla la
      actualización automática.

  3. Fuente de la cotización fiscal. Necesita el tipo de cambio vendedor divisa del BNA al
      cierre del día hábil anterior. Revisar si la fuente actual ofrece histórico por fecha o si
      conviene usar otra (incluyendo el servicio de ARCA).

  4. Cambio de moneda principal. Qué pasa si la nueva principal es la actual secundaria
      (¿se intercambian o se exige elegir una nueva secundaria?).

  5. Reportes por moneda. Cómo se reparte una venta con dos monedas entre pestañas
      (propuesta: por el monto cobrado en cada moneda). Y cómo se calcula la rentabilidad
      cuando la venta y el costo están en monedas distintas, sin inventar cotizaciones
      (propuesta: usar la cotización guardada en la venta).

  6. Monedas desactivadas con histórico. Si sus datos históricos siguen apareciendo en
      los reportes.

  7. Gasto con saldo insuficiente. Qué pasa si se paga un gasto en una moneda y el medio
      de pago no tiene saldo en esa moneda.

  8. Medios de pago y cuentas existentes con moneda propia. Cómo se consolidan al
      quitarles la moneda.

  9. Dashboard. Cómo reemplaza los modos ARS / USD / REAL por pestañas.
10. Diferencia de cambio en cuenta corriente (G1). Si se registra aparte o no.
11. Orden y estimación de implementación (H1).

7. Fuentes consultadas

      Argentina.gob.ar — "Se facilita la emisión de facturas en moneda extranjera":
      https://www.argentina.gob.ar/noticias/se-facilita-la-emision-de-facturas-en-moneda-
      extranjera

      Sovos — "Se establece el tipo de cambio a consignar cuando el comprobante
      electrónico se emita en moneda extranjera": https://sovos.com/es/cambios-
      regulatorios/iva/argentina-se-establece-el-tipo-de-cambio-a-consignar-cuando-el-
      comprobante-electronico-se-emita-en-moneda-extranjera/

      Cámara Argentina de Comercio y Servicios (CEMARA) — "Facturación electrónica
      en moneda extranjera": https://www.cemara.org.ar/blog/novedades-2/facturacion-
      electronica-en-moneda-extranjera-85

      FIECE — "ARCA cambia las facturas electrónicas y hay plazo hasta noviembre para
      evitar rechazos": https://www.fiece.org.ar/arca-cambia-las-facturas-electronicas-y-
      hay-plazo-hasta-noviembre-para-evitar-rechazos/

      dolarapi.com (repositorio): https://github.com/enzonotario/dolarapi.com

      dolarapi.com (documentación Chile): https://dolarapi.com/docs/chile/

