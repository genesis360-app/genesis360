---
name: preguntas_pendientes_2026-09-28
description: TODAS las preguntas abiertas para GO y Fede al 2026-09-28, en un solo lugar (DL-1..DL-5, D3-a/D3-b, PL-1..PL-7). Cada una con contexto, opciones y propuesta. Reemplaza tener que buscarlas en pendientes, el plan y el archivo de respuestas.
type: relevamiento
---

# Preguntas pendientes para GO y Fede — 2026-09-28

> **Por qué hay preguntas nuevas si el 25/09 se respondieron los 30 puntos.** Las 30 del 25/09 están todas
> respondidas y no se reabre ninguna. Estas 14 son **nuevas** y salieron de tres lados:
> 1. **La revisión legal que pidió GO el 26/09** sobre la tasa del dólar (DL-1..DL-5): la tasa elegida está bien,
>    pero aparecieron efectos en góndola, en la captura "al cierre" y en la valuación de los dólares.
> 2. **Construir D-3** (desplegables del importador): dos detalles de comportamiento (D3-a, D3-b).
> 3. **Cruzar las respuestas con el código al planificar** Categorías + Precio programado (PL-1..PL-7): algunas
>    respuestas mencionan cosas que el sistema no tiene (ventas en espera, ventas recurrentes, pedidos desde el
>    portal) o se contradicen entre sí (el tope del dueño).
>
> Las 3 preguntas de cuenta corriente del 26/09 (vencimiento, valores de fábrica, CC habilitada) **ya las respondió
> GO** y están implementadas en DEV (mig 442).

> **Actualizado 2026-09-28 (tarde):** se suman **EC-1..EC-8** (sección D) del plan "Empezar de cero".

**Qué frena cada una:** DL-5 frena el deploy · PL-5 frena la Fase 3 (motor único de precio) · PL-1..PL-3 frenan la
Fase 4 (precio por categoría) · PL-4 frena C-2 · el resto se puede decidir sin apuro.

Para responder: alcanza con la letra de cada una ("DL-1 A, PL-1 propuesta…"). Donde dice **(propuesta)** es lo que
recomiendo.

---

## A · Revisión legal de la tasa del dólar (26/09)

Contexto: la tasa elegida (vendedor divisa BNA, cierre del día hábil anterior) **coincide** con la RG ARCA 5616/2024 y
con el art. 49 del Dto. 692/98 (IVA). Detalle y fuentes: `respuestas_puntos_abiertos_2026-09-25.md` → "Segunda revisión
legal".

**DL-1 · El precio de la góndola puede no coincidir con el que se cobra** (Res. SIC 4/2025, art. 2 g: tienen que
coincidir). Las etiquetas de precio, Tienda Nube y Mercado Libre usan el precio en pesos guardado del producto, que
queda fijo el día que se editó; el POS cobra `precio en USD × dólar del día`. En un producto en USD se separan apenas
se mueve el dólar. Hoy PROD tiene 0 productos en USD.
- **A (propuesta)**: cada vez que entra una cotización nueva, recalcular el precio en pesos guardado de los productos
  en USD → TN/ML se actualizan solos y Repositores avisa "N etiquetas para reimprimir".
- B: no recalcular; solo avisar que hay etiquetas desactualizadas.
- C: góndola solo en USD con la leyenda "se cobra al dólar BNA del día" (no cumple sola: la ley exige el precio en pesos).

**DL-2 · "Al cierre" no está garantizado.** Durante el día el BNA muestra el valor del momento con la fecha de hoy.
Si falla la captura de las 03:10 y nadie entra entre el cierre (~15 h) y la apertura siguiente, al otro día se usaría
un valor de media jornada como "de cierre". Todavía no pasó.
- **A (propuesta)**: marcar cada cotización como "de cierre" solo si se capturó después del cierre; si la vigente no
  lo es, usarla igual con aviso ámbar en el menú.
- B: no usarla y seguir con la última de cierre confirmada (puede quedar 2 días atrás).

**DL-3 · Cuánto valen los dólares que tiene el negocio.** Para Ganancias y Bienes Personales se valúan al
**comprador** BNA; la app usa el vendedor para todo ("una sola tasa").
- **A (propuesta)**: operar al vendedor y mostrar además, solo informativo, "valuado al comprador: $X" donde se
  informa el saldo en dólares. No mueve plata.
- B: dejar todo al vendedor (el balance lo arma el contador aparte).

**DL-4 · Para el contador, no para ustedes**: ¿un producto con precio en USD facturado en pesos queda alcanzado por el
art. 49 del Dto. 692/98? Ya está en la lista del contador (C-16; valuación en C-08).

**DL-5 · ¿Se sube a PROD lo que está en DEV?** Hay 3 migraciones listas (440 dólar BNA, 441 precio programado,
442 categorías + cuenta corriente) y la API de datos corregida.
- **A (propuesta)**: subir ya. En PROD hay 0 productos en USD y 0 deudas en cuenta corriente, así que DL-1/DL-2 no
  afectan a nadie hoy; los arreglos van en la versión siguiente.
- B: esperar a resolver DL-1/DL-2 y subir todo junto.

## B · Plantilla del importador (D-3, 26/09)

**D3-a · Categoría o proveedor desactivado escrito a mano.** El desplegable ya no los ofrece, pero si alguien escribe
el nombre de uno desactivado, el importador hoy lo acepta.
- **A (propuesta)**: rechazar la fila con "está desactivada: reactivala o elegí otra".
- B: aceptarla como hoy.

**D3-b · ¿El importador puede crear categorías nuevas?** Hoy exige crearlas antes.
- **A (propuesta)**: sí, solo categorías, con aviso en la vista previa ("se van a crear N categorías"). Un proveedor
  no (lleva CUIT y condición de IVA).
- B: no, seguir exigiendo crearlas antes.

## C · Plan de Categorías de clientes + Precio programado (26/09)

Detalle: `plan_categorias_clientes_y_precio_programado.md`. Fases 1 (C-1, C-3) y 2 (categoría + cuenta corriente) ya
están hechas en DEV.

**PL-1 · El tope de descuento cuando vende el dueño.** A4 dice "por encima del tope autoriza un supervisor o el dueño";
B-5 dice "el dueño también tiene tope, sin excepción". Juntas no cierran.
- **A (propuesta)**: nadie puede vender por encima del tope; para vender más barato se sube el tope en Configuración
  (queda registrado).
- B: el dueño necesita que un supervisor lo autorice.

**PL-2 · "Ventas recurrentes" no existen en el sistema.** La respuesta B1 las lista como una de las 5 pantallas.
- **A (propuesta)**: sacarlas del alcance; si algún día se construyen, nacen usando el precio de categoría.

**PL-3 · El portal de clientes no arma pedidos** (solo consulta). B-8 no tiene dónde aplicarse.
- **A (propuesta)**: dejar B-8 para cuando el portal permita pedir (sería un proyecto aparte).

**PL-4 · C-2 "la tarea de etiqueta se crea al programar" para negocios que ya usan otra anticipación.** Hoy el valor
por defecto es "1 hora antes" y está en PROD.
- **A (propuesta)**: el nuevo valor por defecto solo para negocios nuevos; la opción queda disponible para todos.
- B: cambiarlo también a los que tienen "1 hora".

**PL-5 · El POS sin conexión, con el precio calculado en el servidor (Fase 3).** Hoy el POS calcula en el navegador.
- **A (propuesta)**: sin respuesta del servidor, el producto no entra al carrito (mismo criterio que D5: no se inventa
  un precio), con reintento.
- B: modo degradado a precio de lista, con aviso.

**PL-6 · C-4 "ventas en espera" no existen.** El POS no tiene "poner en espera / retomar".
- A: construir "venta en espera" (función nueva).
- **B (propuesta)**: dar C-4 por cerrado hasta que exista esa función.

**PL-7 · Precio programado que espera la etiqueta, con varias sucursales con góndola.** Implementado: espera a que se
confirme en **todas**. Mientras tanto, en la que ya la puso, la góndola muestra el precio nuevo y se cobra el viejo
(el POS avisa, como con cualquier etiqueta desactualizada).
- **A (propuesta)**: dejarlo así (todas).
- B: aplicar el precio cuando se confirma la primera.

## D · "Empezar de cero" conservando los datos maestros (28/09)

Contexto y diseño: `plan_empezar_de_cero.md`. Hoy no existe nada intermedio entre anular venta por venta y dar de baja
el negocio. Estas 8 definen la Fase 2 del plan (las Fases 0 y 1 no dependen de ellas).

**EC-1 · Stock al reiniciar.** A: siempre a 0. B: siempre mantener lo que hay como stock inicial.
- **C (propuesta)**: que lo elija el dueño en el momento, con B marcado por defecto.

**EC-2 · Clientes y proveedores cargados durante la prueba.**
- **A (propuesta)**: se conservan todos (suelen ser reales). B: se borran los que no tengan datos fiscales. C: elige el dueño.

**EC-3 · Cuántas veces se puede reiniciar.**
- **A (propuesta)**: las que quieran, mientras no exista ningún CAE real. B: una sola vez.

**EC-4 · RRHH** (fichadas, liquidaciones, vacaciones, anticipos del período de prueba).
- **A (propuesta)**: se borran junto con lo demás; empleados y su configuración se conservan. B: RRHH no se toca.

**EC-5 · Quién puede hacerlo.**
- **A (propuesta)**: el DUEÑO desde la app, con las cajas cerradas; y soporte desde el panel, siempre con el pedido del
  cliente por escrito. B: solo el dueño.

**EC-6 · Historial de actividad.**
- **A (propuesta)**: se borra lo del período de prueba y queda un registro permanente del reinicio. B: se conserva todo.

**EC-7 · Precios programados.**
- **A (propuesta)**: se conservan los pendientes y se borra el historial de los ya aplicados.

**EC-8 · Ventas que entraron desde Mercado Libre / Tienda Nube durante la prueba** (borrarlas de Genesis360 no las
borra del canal).
- **A (propuesta)**: la vista previa las muestra aparte y pide confirmarlas explícitamente. B: si hay, se bloquea.

