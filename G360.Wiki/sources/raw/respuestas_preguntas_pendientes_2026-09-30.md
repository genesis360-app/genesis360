---
name: respuestas_preguntas_pendientes_2026-09-30
description: Respuestas de Fede/GO (30/09) a DL-1..5, D3-a/b, PL-1..7, EC-1..8, QR-1..3 de preguntas_pendientes_2026-09-28.md. Manda sobre las propuestas. Quedan abiertas PR-1..PR-8 (pricing v7) y 4 puntos para Tonga (sección 4).
type: relevamiento
---

# Respuestas a las preguntas pendientes — 2026-09-30

---

## Cómo leer este documento

- Cada punto tiene una **Decisión** (lo que definió Fede) y las **Reglas para implementar** (el detalle práctico que sale de esa decisión).  
- **(derivada)** marca reglas que no se respondieron literalmente, pero salen de combinar otras respuestas. Tonga puede cuestionarlas.  
- **(propuesta)** marca reglas que Fede todavía no confirmó y que se incluyen como punto de partida.  
- Al final hay una lista de **puntos abiertos** para que Tonga resuelva o proponga.  
- Ninguna de las 30 preguntas respondidas el 25/09 se reabre.

---

## 1\. Resumen ejecutivo

- **DL-5 (sube el deploy):** sí, subir ya lo que está listo en DEV. Los arreglos de DL-1 y DL-2 van en la versión siguiente.  
- **D3-a / D3-b (importador):** las filas con error se muestran todas antes de cargar nada, con el motivo del error, y recién ahí se confirma con un botón aparte. Las categorías nuevas no se crean desde el importador: deben existir de antes, creadas por el dueño desde Configuración.  
- **PL-1 a PL-4, PL-6 (categorías y precio programado):** se sigue la sugerencia en todos. El único cambio real de comportamiento es PL-4: el precio a la hora exacta se aplica también a los negocios existentes (por ahora son todos de prueba, no hay impacto real).  
- **PL-5 (POS sin internet):** el POS debe poder seguir vendiendo con los últimos precios que tiene guardados, avisando que no hay conexión y que puede haber productos desactualizados. Si la plataforma no puede funcionar sin internet por otro motivo, entonces se define según lo que decida Tonga.  
- **PL-7 (precio por sucursal):** por ahora, un solo precio para todas las sucursales, con la base de datos preparada para poder tener precio por sucursal más adelante sin rehacer el motor.  
- **EC-1 a EC-8 ("Empezar de cero"):** se sigue la sugerencia en todos, con un ajuste en EC-5: solo el superusuario de soporte puede reiniciar un negocio desde el panel, no cualquier persona de soporte.  
- **QR-1 a QR-3 (Mercado Pago):** se sigue la sugerencia en los tres.

---

## 2\. Tabla resumen de decisiones

| Código | Decisión |
| :---- | :---- |
| DL-1 | Recálculo automático del precio en pesos de productos en USD al entrar cada cotización nueva |
| DL-2 | Cotización "de cierre" solo si se capturó después del cierre real; si no, se usa igual con aviso ámbar |
| DL-3 | Operar siempre al vendedor; mostrar el valuado al comprador solo como dato informativo |
| DL-4 | Sin respuesta de Fede: pregunta para el contador |
| DL-5 | Subir ya a producción lo que está en DEV |
| D3-a | Rechazar filas con categoría/proveedor desactivado, con motivo. Vista previa completa de errores antes de cargar, con botón de confirmación aparte |
| D3-b | El importador no crea categorías: deben existir de antes, creadas por el dueño desde Configuración |
| PL-1 | Nadie, ni el dueño, vende por encima del tope en el momento; para vender más barato se sube el tope en Configuración |
| PL-2 | Se saca "ventas recurrentes" del alcance hasta que exista esa función |
| PL-3 | Se deja pendiente la aplicación en el portal de clientes hasta que permita armar pedidos |
| PL-4 | El nuevo default (tarea nace al programar) se aplica también a los negocios existentes |
| PL-5 | El POS vende igual sin conexión, con los últimos precios guardados, avisando falta de conexión y posibles productos desactualizados — salvo que la plataforma no pueda operar sin internet por otro motivo, en cuyo caso decide Tonga |
| PL-6 | Se da por cerrado el caso de "ventas en espera" hasta que esa función exista |
| PL-7 | Por ahora, un precio único para todas las sucursales (se aplica con la primera confirmación). Modelo de datos preparado para precio por sucursal a futuro |
| EC-1 | El dueño elige en el momento del reinicio, con "mantener stock" preseleccionado |
| EC-2 | Se conservan todos los clientes y proveedores cargados durante la prueba |
| EC-3 | Se puede reiniciar las veces que se quiera, mientras no haya ningún CAE real emitido |
| EC-4 | Se borran los datos de RRHH de la prueba; empleados y su configuración se conservan |
| EC-5 | Puede hacerlo el DUEÑO desde la app (con cajas cerradas), o el superusuario de soporte desde el panel, con pedido por escrito |
| EC-6 | Se borra el historial de actividad de la prueba; queda un registro permanente de que el reinicio ocurrió |
| EC-7 | Se conservan los precios programados pendientes; se borra el historial de los ya aplicados |
| EC-8 | La vista previa muestra aparte las ventas de ML/TN de la prueba y pide confirmarlas explícitamente antes de borrar |
| QR-1 | El QR va en la factura (si el negocio lo activa en su configuración) y en el estado de cuenta, arreglando los 5 problemas detectados |
| QR-2 | Un solo link por venta, reutilizado en cada descarga, que se desactiva al saldarse y vence a los 30 días |
| QR-3 | Un pago de más se registra completo como saldo a favor del cliente en su cuenta corriente, con aviso al dueño |

---

## 3\. Respuestas detalladas

### A · Revisión legal de la tasa del dólar

#### DL-1 · Precio de góndola desincronizado del precio cobrado

**Decisión:** (a) cada vez que entra una cotización nueva, se recalcula el precio en pesos guardado de los productos en USD.

**Reglas para implementar:**

- El recálculo dispara, como cualquier otro cambio de precio, la republicación en Mercado Libre y Tienda Nube (ya definido en Multimoneda) y la tarea de "N etiquetas para reimprimir" en Repositores.  
- Como hoy no hay productos en USD en producción, esto no tiene impacto inmediato: se implementa antes de que el negocio cargue el primer producto en dólares.  
- (derivada) Este recálculo diario **no** es un "cambio de precio programado" en el sentido de Precio programado (A5 de ese relevamiento): no pasa por la lógica de vigencia futura, se aplica directo.

#### DL-2 · La cotización "de cierre" no está garantizada

**Decisión:** (a) se marca como "de cierre" solo si se capturó después del cierre real. Si la vigente no lo es, se usa igual, con aviso ámbar en el menú.

#### DL-3 · Valuación de los dólares en caja/bóveda

**Decisión:** (a) se opera siempre al vendedor (sin cambios en la regla de "una sola tasa"). Se muestra, solo informativo, "valuado al comprador: \$X" donde se informe el saldo en dólares del negocio. No mueve plata ni afecta ningún cálculo operativo.

#### DL-4 · Pregunta para el contador

**Decisión:** no requiere respuesta de Fede. Ya está anotada en la lista de preguntas para el contador (C-16), junto con la valuación (C-08).

#### DL-5 · ¿Subir a producción lo que está en DEV?

**Decisión:** (a) subir ya. En producción hoy hay 0 productos en USD y 0 deudas en cuenta corriente, así que DL-1 y DL-2 no afectan a nadie. Los arreglos van en la versión siguiente.

---

### B · Plantilla del importador

#### D3-a · Categoría o proveedor desactivado escrito a mano

**Decisión:** (a) se rechaza la fila, con el motivo "está desactivada: reactivala o elegí otra". Además, se agrega un requisito nuevo de Fede sobre el flujo completo de importación.

**Reglas para implementar:**

- La importación pasa a tener **dos pasos**: primero una **vista previa completa** de todas las filas del archivo, marcando cuáles tienen error y por qué (categoría/proveedor desactivado, y cualquier otro error de validación que ya exista hoy). En este paso **no se carga nada todavía**.  
- El usuario puede corregir el archivo o los datos y volver a intentar.  
- Recién con un **botón aparte** ("Cargar") se confirma la importación real.  
- Objetivo explícito: que nunca pase que se carguen algunas filas sí y otras no en la misma importación sin que el usuario lo haya visto y decidido antes.  
- (derivada) Esto reemplaza cualquier comportamiento actual de carga parcial silenciosa: la carga es todo-o-nada desde la perspectiva del usuario, con control total antes de confirmar.

#### D3-b · ¿El importador puede crear categorías nuevas?

**Decisión:** no. Las categorías deben estar creadas de antes en el sistema, por el dueño, desde el módulo de Configuración. El importador exige elegir una categoría existente, igual que hoy exige con los proveedores.

---

### C · Categorías de clientes \+ Precio programado

#### PL-1 · El tope de descuento cuando vende el dueño

**Decisión:** (a) nadie puede vender por encima del tope, ni el dueño. Para vender más barato, se sube el tope en Configuración, y ese cambio queda registrado.

**Reglas para implementar:** (derivada) esto reemplaza lo dicho en A4 del relevamiento de Categorías ("por encima del tope autoriza un supervisor o el dueño"). Ya no hay autorización puntual por venta: el único camino es cambiar el tope general.

#### PL-2 · "Ventas recurrentes" no existen

**Decisión:** (a) se sacan del alcance del precio de categoría por ahora. El día que se construyan, nacen usando el precio de categoría de forma nativa.

#### PL-3 · El portal de clientes no arma pedidos

**Decisión:** (a) se deja pendiente la aplicación del precio de categoría en el portal, para cuando el portal permita armar pedidos (seguramente un proyecto aparte).

#### PL-4 · Nuevo valor por defecto de la tarea de etiqueta vs. negocios que ya usan "1 hora antes"

**Decisión:** aplicarlo igual a los negocios existentes. Por ahora todos los negocios que usan esta función son de prueba, así que no hay impacto real.

**Reglas para implementar:** (derivada) esto reemplaza la propuesta A de Tonga (nuevo default solo para negocios nuevos). El valor por defecto pasa a ser "se crea al programar" para todos los negocios, existentes y nuevos, salvo que cada uno lo cambie desde la configuración ya disponible.

#### PL-5 · El POS sin conexión, con el motor de precio único en el servidor

**Decisión:** el POS debe poder seguir vendiendo igual, con los **últimos precios que tiene guardados**, mostrando un aviso de que no hay conexión y de que podría haber productos sin actualizar.

**Contexto de la decisión:** los cortes de internet no son muy frecuentes, pero un negocio no puede quedar con las manos atadas y sin poder vender por un problema de conexión. La única excepción: si la plataforma hoy **ya depende de internet para funcionar por otro motivo** (por ejemplo, porque corre completamente en la nube y sin conexión no carga ni siquiera la pantalla), entonces esta pregunta no aplica de la misma forma, y en ese caso se sigue la opción A original de Tonga (sin respuesta del servidor, el producto no entra al carrito) porque ya sería una limitación existente del sistema y no una nueva.

**Reglas para implementar:**

- Tonga debe confirmar primero cómo funciona hoy el POS sin conexión a internet (si hoy ya puede vender sin internet o no), y a partir de esa realidad aplicar el criterio que corresponda.  
- Si el POS puede operar sin internet: usa el último precio que tiene disponible localmente (de lista, tier, categoría, etc., según lo que haya podido sincronizar), con el aviso correspondiente.  
- La venta hecha sin conexión debe quedar marcada como tal, para poder auditar después si algún precio quedó desactualizado.

#### PL-6 · "Ventas en espera" no existen

**Decisión:** (b) se da por cerrado el punto C-4 de Precio programado hasta que "poner en espera / retomar" exista como función en el POS.

#### PL-7 · Precio programado esperando la etiqueta, con varias sucursales

**Decisión:** por ahora (b), aplicar el precio cuando confirma la **primera** sucursal, no esperar a todas. Pero se deja anotado como necesidad futura real: puede haber que tener precios y aprobaciones de reposición distintos por sucursal, y Fede quiere que la base quede preparada para no tener que rehacer la lógica más adelante, cuando ya haya clientes reales.

**Reglas para implementar:**

- El precio programado sigue siendo **uno solo por producto**, válido para todas las sucursales, como hoy.  
- (propuesta) La tabla donde se guarda el precio programado (y, a futuro, el precio vigente) incluye desde ya una columna para identificar la sucursal, que por ahora queda siempre vacía (significa "aplica a todas las sucursales"). No se construye ninguna pantalla ni lógica para usarla todavía: es solo preparación de la estructura de datos.  
- La aprobación del repositor sigue siendo por sucursal, como ya está. El cambio de comportamiento es que ya no espera a que todas confirmen: con la primera, se activa el precio para todas.  
- El día que se necesite precio real por sucursal, la idea es habilitar que esa columna se pueda completar con una sucursal específica, y que recién ahí la aprobación de esa sucursal sea la que activa el precio de esa sucursal en particular — sin tener que rediseñar la tabla ni el motor de precios desde cero.  
- Tonga debe confirmar si esta preparación es tan simple como parece o si el diseño real necesita algo distinto. Es un punto abierto (ver sección 5).

---

### D · "Empezar de cero" conservando los datos maestros

#### EC-1 · Stock al reiniciar

**Decisión:** (c) lo elige el dueño en el momento del reinicio, con "mantener el stock actual" preseleccionado por defecto.

#### EC-2 · Clientes y proveedores de la prueba

**Decisión:** (a) se conservan todos.

#### EC-3 · Cuántas veces se puede reiniciar

**Decisión:** (a) las que quiera, mientras no exista ningún CAE real emitido por ese negocio.

#### EC-4 · Datos de RRHH de la prueba

**Decisión:** (a) se borran junto con lo demás (fichadas, liquidaciones, vacaciones, anticipos del período de prueba). Los empleados y su configuración (sueldo, rol, etc.) se conservan.

#### EC-5 · Quién puede hacerlo

**Decisión:** el DUEÑO desde la app (con las cajas cerradas), o soporte desde el panel — pero **solo el superusuario de soporte**, no cualquier persona de soporte —, siempre con el pedido del cliente por escrito.

**Reglas para implementar:** (derivada) esto ajusta la propuesta A de Tonga, que decía "soporte" en general. Hay que verificar que el sistema de roles internos de Genesis360 ya distinga un nivel de "superusuario de soporte" o si hay que crear ese nivel.

#### EC-6 · Historial de actividad

**Decisión:** (a) se borra el historial de actividad del período de prueba. Queda un registro permanente de que el reinicio ocurrió (con fecha y quién lo hizo).

#### EC-7 · Precios programados

**Decisión:** (a) se conservan los pendientes; se borra el historial de los que ya se aplicaron durante la prueba.

#### EC-8 · Ventas de Mercado Libre / Tienda Nube durante la prueba

**Decisión:** (a) la vista previa del reinicio las muestra aparte y pide confirmarlas explícitamente antes de borrar, ya que borrarlas de Genesis360 no las borra del canal.

---

### E · QR de Mercado Pago en la factura

#### QR-1 · ¿Dónde va el QR?

**Decisión:** (c) en los dos lugares: en la factura (solo si el negocio lo activa en su configuración) y en el estado de cuenta del cliente. En ambos casos, arreglando los 5 problemas de plata detectados.

#### QR-2 · Vida del link

**Decisión:** (a) un solo link por venta, reutilizado en cada descarga, que se desactiva automáticamente al quedar saldada la venta y además vence a los 30 días.

#### QR-3 · Si igual entra un pago de más

**Decisión:** (a) se registra completo como saldo a favor del cliente en su cuenta corriente, con aviso al dueño.

**Nota:** los problemas 4 (envío fuera del tope) y 5 (intereses de cuenta corriente fuera del QR) no requieren decisión: se arreglan alineando el monto del QR con lo que efectivamente registra `mp-ipn`.

---

## 4\. Puntos abiertos para que Tonga proponga o resuelva

1. **PL-5.** Confirmar primero cómo funciona hoy el POS sin conexión a internet, y a partir de eso aplicar el criterio definido (vender con últimos precios y aviso, salvo que ya exista una dependencia total de internet, en cuyo caso aplica el criterio de "no inventar precio").  
2. **PL-7.** Confirmar si preparar la tabla de precio programado con una columna de sucursal (vacía por ahora) es suficiente preparación para el futuro, o si hace falta algo más en el diseño para no tener que rehacer el motor de precios el día que se necesite precio real por sucursal.  
3. **EC-5.** Verificar si el sistema de roles de soporte de Genesis360 ya distingue un nivel de "superusuario de soporte", o si hay que crearlo para este caso.  
4. ✅ **D3-a — RESUELTO por GO (2026-10-01): se RE-SUBE el archivo** (corregir en Excel y volver a subir; la vista
   previa se recalcula). Sin edición fila por fila en pantalla. Se puede ofrecer bajar las filas con error + motivo.
   Texto original: Confirmar el detalle de UX del flujo de dos pasos (vista previa con errores → botón de carga), y qué pasa si el usuario corrige el archivo: si hay que volver a subirlo entero o se puede editar fila por fila en la misma pantalla de vista previa.