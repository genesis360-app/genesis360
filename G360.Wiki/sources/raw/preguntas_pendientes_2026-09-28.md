---
name: preguntas_pendientes_2026-09-28
description: TODAS las preguntas abiertas para GO y Fede al 2026-09-28, en un solo lugar (DL-1..DL-5, D3-a/D3-b, PL-1..PL-7). Cada una con contexto, opciones y propuesta. Reemplaza tener que buscarlas en pendientes, el plan y el archivo de respuestas.
type: relevamiento
---

# Preguntas pendientes para GO y Fede — 2026-09-28

> ✅ **2026-10-01: RESPONDIDAS DL-1..5, D3-a/b, PL-1..7, EC-1..8 y QR-1..3** → `respuestas_preguntas_pendientes_2026-09-30.md`
> (manda sobre las propuestas de acá). **Siguen abiertas: PR-1..PR-8 (pricing v7, sección F).**

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
>
> **Actualizado 2026-09-29:** se suman **QR-1..QR-3** (sección E): el QR de Mercado Pago en la factura.
>
> **Actualizado 2026-09-30:** se suman **PR-1..PR-8** (sección F): pricing v7 (documento "06 - Cambios de Pricing v6 a v7").

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

---

## E · QR de Mercado Pago en la factura (29/09)

**Cómo funciona hoy.** El PDF de la factura lleva un QR de pago de MP cuando, **al generar el PDF**, la venta tiene
**saldo pendiente** (> $0,50: cuenta corriente, seña, pago parcial) y el negocio tiene MP conectado. **No** depende de
que el medio de pago sea MP: una venta pagada completa sale sin QR. Código: `crearPagoMpQR` en `VentasPage.tsx` y
`FacturacionPage.tsx` → EF `mp-crear-link-pago` (preferencia con `external_reference = venta_id`) → el pago entra por
`mp-ipn`, que suma a `ventas.monto_pagado` **con tope en `ventas.total`** y asienta un ingreso informativo en caja.

**🛑 Problemas de plata detectados (REGLA #0, latentes — no vistos en datos reales):**
1. **El link no vence nunca** (la preferencia se crea sin expiración) y queda impreso. Si el cliente salda la deuda por
   otro medio, el QR sigue vivo y puede volver a pagar.
2. **Cada descarga/impresión crea un link NUEVO**: 3 descargas = 3 QR vivos para la misma venta.
3. **Lo cobrado de más no queda registrado**: por el tope de `mp-ipn`, un pago doble (casos 1 y 2) entra a la cuenta
   MP del negocio pero lo que excede el total no aparece ni en la venta ni en la cuenta corriente.
4. **Envío fuera del tope**: el monto del QR es `total + costo_envio − monto_pagado`, pero el tope usa `ventas.total`
   (sin envío) → pagar el QR completo deja la parte del envío sin registrar.
5. **Intereses de CC fuera del QR**: el monto no incluye `interes_cc` → el cliente paga creyendo que saldó todo y le
   sigue quedando deuda.

**QR-1 · ¿Dónde va el QR de pago?**
- A: se mantiene en la factura (arreglando 1-5).
- B: se saca de la factura y va al **estado de cuenta** del cliente (muestra la deuda real a la fecha, con intereses).
- **C (propuesta)**: en los dos, arreglando 1-5; en la factura, solo si el negocio lo activa en su configuración.

**QR-2 · Vida del link.**
- **A (propuesta)**: UN link por venta, reusado en cada descarga, que se **desactiva al quedar saldada** la venta y
  además vence a los N días (definir N; propuesta 30).
- B: link nuevo en cada descarga pero con vencimiento corto (7 días).

**QR-3 · Si igual entra un pago de más** (p. ej. un QR viejo impreso).
- **A (propuesta)**: se registra completo como **saldo a favor** del cliente en su cuenta corriente + aviso al dueño.
- B: no se registra el excedente en CC; solo se avisa al dueño para que lo devuelva por MP.

Los puntos 4 y 5 no requieren decisión: se arreglan alineando el monto del QR con lo que registra `mp-ipn`.

---

## F · Pricing v7 (30/09)

> ✅ **Respuestas de GO (2026-10-01):**
> - **PR-1:** el pago anual es un pago único por 1 año, **sin renovación automática** (al terminar el año no se vuelve a
>   cobrar solo). La duda "acumula o no con el débito" no aplica: es un camino aparte. *(Falta definir sobre qué precio se
>   aplica el −20 %: ver pregunta al final de esta sección.)*
> - **PR-4:** **el plan Free deja de existir.** Si conviene (sobre todo con los primeros clientes), el equipo regala meses
>   después de las reuniones, para que se vea como un regalo y no como algo que ya estaba (herramienta: "Extender
>   prueba"/regalar desde el panel interno).
> - **PR-5:** **Enterprise se contrata y se cobra igual que cualquier otro plan** (online, $200.000 con débito). Requiere
>   crear el plan en Mercado Pago (GO) y pasar el id.
> - Siguen abiertas: PR-2, PR-3, PR-6, PR-7, PR-8 y la base del anual.

Fuente: "06 - Cambios de Pricing v6 a v7 - Para Tonga" (Fede). Lo que el documento define se ejecuta tal cual (precios
Básico $54.000/$60.000 y Pro $100.000/$117.600, límites, descuento por débito escalonado, RRHH y marketplace pasan a
Enterprise). Contexto PROD al 30/09: 0 negocios en Pro o Enterprise, 2 add-ons activos. Estas 8 frenan la ejecución:

**PR-1 · Pago anual.** El doc dice −20 % "adicional sobre el valor con débito" pero pide confirmarlo con Fede. Hoy la app
dice −30 %. A: −20 % sobre el precio CON débito (acumula: Básico $43.200/mes). B: −20 % sobre el precio de lista, como vía
alternativa al débito (Básico $48.000/mes).

**PR-2 · Agente de WhatsApp ($50.000).** El doc lo marca como no confirmado.
- **A (propuesta)**: no se publica el precio; figura en Enterprise sin monto hasta correr el cálculo de costo.

**PR-3 · Prueba de 15 días.**
- **A (propuesta)**: solo para las altas nuevas; las pruebas en curso conservan su fecha. B: se recortan también las vigentes.

**PR-4 · Plan Free.** La app tiene un plan gratis permanente (50 productos, 200 comprobantes, 1 usuario); v7 no lo menciona.
A: se elimina (después de la prueba hay que elegir plan). B: se mantiene como está.

**PR-5 · Enterprise contratable online a $200.000.** Hoy es "a consultar". Para cobrarlo por débito hay que crear el plan
en Mercado Pago (lo hacés vos en el panel de MP y me pasás el id), y actualizar Básico a $54.000 y Pro a $100.000 allá.
A: se contrata online. B: sigue "a consultar" con el precio publicado.

**PR-6 · Add-on de sucursales sube** ($15k/$35k/$55k → $35k/$55k/$70k).
- **A (propuesta)**: el precio nuevo rige para compras nuevas; quien ya lo tiene sigue pagando el anterior.

**PR-7 · Límites que bajan.** Comprobantes Básico 6.000 → 5.000, Pro 14.000 → 13.000; usuarios Básico 5 → 3, Pro 15 → 7;
sucursales Pro 4 → 2; Enterprise deja de ser ilimitado (20 usuarios, 18.000 productos, 30.000 comprobantes, 4 sucursales).
Un negocio que hoy está por encima del nuevo límite no pierde nada, pero no puede sumar más. ¿Confirmado?

**PR-8 · Módulos sin equivalente claro.** "Logística inteligente" (Pro), "soporte prioritario" (Enterprise) y el add-on
"Marketplace $35.000": ¿a qué parte de la app corresponde la logística inteligente, y el add-on de marketplace se le vende
a Básico y Pro (que no lo incluyen)?

Fuera de la app: la Landing 2.0 (documentos de Fede) dice 30 días de prueba en 3 lugares.

