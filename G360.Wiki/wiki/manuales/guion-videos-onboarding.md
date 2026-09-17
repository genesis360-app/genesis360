---
name: guion_videos_onboarding
description: Guion de pasos obligatorios para grabar los videos de onboarding de Genesis360, sacado del flujo real del código (no de la memoria).
type: manual
---

# Guion de los videos de onboarding

> ✅ **LISTA PARA GRABAR desde el 2026-09-13.** Se escribió el 12/09, cuando el panel de soporte
> todavía **no estaba en PROD** — y el paso de "liberar el mail entre tomas" dependía justamente de
> eso. Con el deploy de `v1.218.0` quedó operativo: `admin.genesis360.pro` está en producción y la
> EF `admin-api` en v11, así que **los dos caminos de baja funcionan en PROD** (soporte y cliente).
> También entró la mig 412, así que el **Teléfono del alta ahora se guarda de verdad** (antes se
> pedía y se descartaba).
>
> Verificado el 13/09 contra PROD: sigue pidiendo **confirmación de mail** (3 usuarios sin confirmar
> y 7 que confirmaron después del alta), que es el paso que el video 1 no puede saltearse.

Pedido de GO (2026-09-12): una serie de videos que arranca en `genesis360.pro` y termina con el
negocio funcionando, y después uno por funcionalidad.

Lo que aporta este documento son los **pasos obligatorios** de cada video, verificados contra el
código que realmente corre — qué pantalla, qué campo, qué pasa después de cada click y dónde el
flujo se bifurca. Los textos hablados quedan a criterio de quien graba.

### ✋ Qué puede y qué no puede grabar Claude (corregido el 2026-09-13)

Hasta acá este documento decía *"Claude no puede grabar video ni capturar pantalla"*. **Es falso** —
se dio por bueno sin probarlo. Verificado con una grabación real de `app.genesis360.pro`:

| | |
|---|---|
| ✅ **Grabar video de un navegador que maneja Claude** | Playwright graba WebM y `ffmpeg` (ya instalado) lo pasa a **MP4 h264 720p**. |
| ✅ **Capturar pantalla** — y **verla** | `page.screenshot()`; Claude lee el PNG y puede revisar que la toma haya salido bien. |
| ❌ **Grabar LA pantalla de quien opera** | No hay acceso al escritorio. Solo el navegador que Claude conduce. |
| ❌ **Narración** | Sin audio. La voz la pone quien graba. |
| ❌ **Puntero del mouse** | Playwright no dibuja cursor: se ve el efecto del click, no el movimiento. El tipeo sale parejo, sin ritmo humano. |
| ❌ **Confirmar el mail del alta** | El link llega a una casilla a la que Claude no entra (el conector de Gmail no está autorizado). |

**Lo que esto habilita en la práctica:** los videos **3 a 9** (productos, ventas, caja, gastos,
clientes, stock, métricas) se pueden grabar contra **DEV** con datos sembrados y quedar como *B-roll*
limpio y repetible, para narrar encima. **El video 1 no**: se corta justo en la confirmación del
mail, que es el paso que en PROD no se puede saltear.

⚠️ Grabar contra **PROD** crea cuentas reales y manda mails reales — no se hace sin decisión
explícita de GO.

---

## 🔴 Antes de grabar — tres cosas que cambian lo que se ve

### 1. Grabar contra PROD (`genesis360.pro`), no contra DEV

**En DEV el alta NO pide confirmar el mail y en PROD SÍ.** Es una diferencia de configuración de
Supabase Auth, verificada hoy:

| | `mailer_autoconfirm` | Qué ve el usuario |
|---|---|---|
| **DEV** | `true` | Se registra y entra directo al dashboard |
| **PROD** | `false` | Pantalla *"Revisá tu correo"* → confirma → recién ahí se crea el negocio |

Grabar en DEV produciría un video que **se saltea un paso entero** del flujo real. El video 1 va
sí o sí contra `genesis360.pro`.

### 2. El mail tiene que ser realmente nuevo

⚠️ **Corregido el 2026-09-13, probado contra PROD.** Lo que este documento decía —"detecta que ya
tiene tenant y lo manda al dashboard"— **no es lo que pasa en el alta**. Se registró con
`genesis360.ar@gmail.com` (que ya es dueño de "Don Ferretero") y el formulario **corrió entero y
terminó en la pantalla "Revisá tu email"**, igual que con un mail nuevo.

Es el comportamiento anti-enumeración de Supabase: ante un mail ya registrado devuelve un éxito
falso para no revelar quién tiene cuenta. Verificado en la base: **no se creó usuario duplicado, no
se creó tenant, y `confirmation_sent_at` quedó en `null` — no se mandó ningún mail.**

**Para el video eso es bueno y malo a la vez:**
- ✅ Bueno: la pantalla *"Revisá tu email"* se puede grabar con un mail ya existente, **sin crear
  nada en PROD**. Es exactamente lo que se hizo.
- 🛑 Malo: el video **no puede seguir de ahí**. No llega ningún mail, así que no hay link que
  clickear, ni negocio nuevo, ni primera entrada al dashboard, ni tour de bienvenida.

Para grabar el tramo que falta hace falta un mail **realmente nuevo** (un alias `+algo` sirve) y que
una persona abra el correo y confirme.

Para repetir tomas hace falta un mail limpio cada vez. Dos caminos:
- Usar alias (`algo+toma1@gmail.com`) — Gmail los entrega al mismo buzón.
- O **liberar el mail** dando de baja el negocio desde el panel de soporte
  (`admin.genesis360.pro` → cliente → Zona de peligro → *Eliminar ahora* con **"liberar también
  los mails"** tildado). Es el único camino que deja la cuenta de auth realmente libre: el sweep
  programado borra el negocio pero **no** toca `auth.users`.

### 3. Datos del negocio de ejemplo

El negocio se llama **"Genesis360 Onboarding"** (el resto de los datos los define GO). Conviene
fijarlos antes de grabar para que las tomas de todos los videos sean consistentes: tipo de
comercio, país, teléfono, y —si se muestra facturación— un CUIT de prueba.

⚠️ **No mostrar en cámara**: CUIT real, certificado AFIP, tokens, ni el panel de Mercado Pago con
datos reales.

---

## 🎬 Video 1 — De la web a tu negocio creado — ✅ GRABADO (70 s, 2026-09-13)

**Punto de partida:** `genesis360.pro` sin sesión iniciada.
(Ojo: `app.genesis360.pro` es el dominio de la app y redirige directo al login — el landing con el
botón de registro vive en `genesis360.pro`.)

### Pasos obligatorios

1. **Landing → "Empezar gratis".** El botón está en el header, en el hero y en la tabla de planes;
   todos van a la misma pantalla de alta. El cartel *"30 días gratis · Sin tarjeta de crédito"* es
   verdad literal: el alta no pide medio de pago.

2. **Paso 1 de 2 — "Tu cuenta"**, con tres campos:
   - Nombre completo
   - Email
   - Contraseña — **mínimo 8 caracteres** (menos que eso lo rechaza con un aviso)

   Botón **Continuar**. Este paso **no crea nada todavía**: solo avanza el formulario.

3. **Paso 2 de 2 — "Tu negocio"**:
   - Nombre del negocio → **"Genesis360 Onboarding"**
   - Tipo de comercio (lista desplegable; si elige **"Otro"** aparece un campo de texto libre)
   - País (Argentina, Chile, Uruguay, México, Colombia, Perú)
   - Teléfono (**opcional**)
   - ☑️ **Acepto los Términos y Condiciones y la Política de Privacidad** — *obligatorio*: sin
     tildarlo el botón de crear queda deshabilitado.
   - ☐ Quiero recibir novedades por email — *opcional*, es un opt-in separado (Ley 25.326). Vale
     la pena decir en el video que se puede dejar sin tildar.

4. **"Crear negocio"** → en PROD aparece la pantalla **"Revisá tu correo"**. El negocio **todavía
   no existe**: los datos viajan con la invitación y el negocio se crea recién al confirmar.

5. **Ir al correo y confirmar.** El link devuelve a la app y ahí sí: se crea el negocio, se manda
   el mail de bienvenida y entra al dashboard.

6. **Primera entrada al dashboard**: se abre solo el **tour de bienvenida** (11 pantallas, se puede
   cerrar y relanzar desde el menú lateral). Buen cierre del video 1: mostrar que se puede saltear.

### Lo que conviene decir (todo verificado en el código)

- La prueba es de **30 días** y arranca en ese momento.
- El negocio nace en **modo Básico**, en **pesos**, con la **facturación deshabilitada**.
- **Ya viene creado y listo para usar**: Sucursal 1, Caja Principal, los métodos de pago, las
  cuentas de origen (Efectivo y Efectivo USD), las unidades de empaque, los estados de inventario
  y los motivos de movimiento. No hay que crear nada de eso a mano.

### Variante que conviene grabar aparte (30 segundos)

**Entrar con Google.** Salta el paso 1 (ya hay sesión y mail verificado) y va directo al formulario
del negocio. Es el camino más corto y muchos lo van a usar.

---

## 🎬 Video 2 — Configuración inicial (modo Básico) — ✅ GRABADO (59 s, 2026-09-14)

> ✅ **Grabado contra PROD**, sobre el mismo negocio del Video 1 (continuidad visual).
> `D:/Dev/genesis360-videos/video2-configuracion/`.
>
> **Confirmado con datos reales al grabarlo**: el negocio nuevo tenía **0 categorías de producto**
> contra **5 métodos de pago** y **16 categorías de gasto** ya sembrados. O sea que lo que dice el
> Paso 2 —que las categorías de producto son el único paso de configuración realmente obligatorio—
> **es cierto y se puede afirmar en cámara**.

**Punto de partida:** recién creado el negocio, dashboard con el tour cerrado.

La idea del video es separar **lo que ya está hecho** de **lo que falta**, porque lo que ya viene
seedeado es más de lo que la gente espera.

### Paso 0 — Confirmar el modo (Configuración → Mi negocio)

Mostrar que el negocio está en **Básico** y qué significa: *"ventas, caja, clientes, gastos y stock
simple — sin trazabilidad ni depósito formal"*. El modo Avanzado (WMS) suma lotes, series,
vencimientos, FIFO/FEFO, ubicaciones, LPN, órdenes de compra, recepciones y envíos, y **se puede
activar después** — no es una decisión para siempre.

### Paso 1 — Datos del negocio (Configuración → Mi negocio)

Lo mínimo para operar: nombre, logo, moneda. Los **datos fiscales** (razón social, CUIT, condición
de IVA frente al IVA, inicio de actividades) se completan acá pero **recién hacen falta para
facturar** — conviene aclararlo para que nadie se frene en este punto.

### Paso 2 — Categorías de productos (Configuración → Inventario → Categorías)

**Esto sí hay que crearlo**: las categorías de producto no vienen sembradas. Es el único paso de
configuración realmente obligatorio antes de cargar el catálogo.

### Paso 3 — Un vistazo a lo que ya está

Recorrer rápido, sin tocar nada, para que quede claro que ya funciona:
- **Ventas → Métodos de pago**: ya están cargados y se pueden editar.
- **Caja**: ya existe "Caja Principal" en "Sucursal 1".
- **Gastos → Categorías**: ya vienen sembradas.

### Paso 4 — El equipo (Usuarios)

Cómo invitar a alguien y qué hace cada rol. En el plan de prueba el límite arranca en **2 usuarios**.

---

## 🎬 Videos por funcionalidad — orden sugerido

> ✅ **Orden real de grabación** (decisión de GO, 2026-09-14): 1 → 2 → 3 → **5 (caja)** → **8 (inventario)** → 4 (vender)…
> Sigue la rutina real del negocio: abrir la caja y que entre la mercadería **antes** de vender. Los archivos viven en
> `D:/Dev/genesis360-videos/` (fuera del repo) y la música en el [Plan de audio](plan-audio-videos.md).

El orden sale del recorrido que ya hace el tour de bienvenida, que está pensado como camino de
menor fricción: **primero cargar, después vender, después medir.**

| # | Video | Pantalla | Qué tiene que quedar demostrado |
|---|---|---|---|
| 3 | **Cargar productos** ✅ *grabado* | `/productos/nuevo` | Alta manual (costo, precio, stock mínimo, categoría), alta **desde una foto**, e importación por Excel |
| 4 | **Vender** ✅ *grabado (83 s, con efectos de click)* | `/ventas` | Buscar, agregar al carrito, descuento, **varios medios de pago** en una venta, y que el stock baja solo |
| 5 | **Caja** ✅ *grabado* | `/caja` | Abrir la caja, **ingresos** de efectivo, arqueo y cierre del día. ⚠️ **NO “egresos”** — ver la corrección abajo |
| 6 | **Gastos** | `/gastos` | Registrar un gasto, categorizarlo, y que impacta en la ganancia |
| 7 | **Clientes y cuenta corriente** | `/clientes` | Alta de cliente, venta en cuenta corriente y cobranza |
| 8 | **Stock** ✅ *grabado (carga de inventario)* | `/inventario` | Entradas, salidas, ajustes, y el stock mínimo disparando alertas |
| 9 | **Métricas** | `/dashboard` → Métricas | Ventas, margen, rotación, productos sin movimiento |
| 10 | **Facturar (AFIP)** ✅ *grabado (78 s, 2026-09-15)* | Configuración → Facturación | El video más delicado: ver abajo |

### ⚠️ Video 10 (facturación) — las dos trabas reales

1. **No se puede habilitar la facturación sin CUIT y sin condición de IVA guardados.** La app lo
   bloquea a propósito: la condición de IVA del emisor es la que decide si el comprobante sale
   **A, B o C**, y un monotributista sin setearla emitiría B en lugar de C.
2. El certificado se saca con un **asistente** (se genera un CSR, se sube a AFIP y se vuelve con el
   certificado). Es el tramo más largo y conviene que sea un video propio, no un pedazo de otro.

Para grabarlo hace falta un CUIT de prueba en homologación. **Nunca en cámara un CUIT real ni el
certificado.**

### ✅ Video 10 — "Activá la facturación electrónica" — GRABADO (78 s, 2026-09-15)

Aparte de la serie de onboarding (que sigue en pausa) — GO pidió destrabarlo solo. Grabado contra **PROD**, tenant
"Genesis360 Onboarding", con **CUIT de ejemplo 20-12345678-9** (el placeholder de la app; nunca un CUIT ni un
certificado real en cámara). Recorrido: datos fiscales, punto de venta 2 y CSR generado con el asistente (ver
[[wiki/features/multi-cuit]] → "Wizard self-service") — **sin subir ningún `.crt`**, sin tocar producción,
"Habilitada" quedó apagada al terminar.

Salió en 2 tomas unidas con fundido (la primera se cortó justo después de guardar, por un locator del script de
grabación). Archivos: `D:/Dev/genesis360-videos/video-facturacion/video-facturacion-final.mp4` (con placas,
rótulos, efectos de click y música, mismo pipeline que el resto de la serie). Toma guardada en
`scripts/video/grabaciones/video-facturacion.mjs` (`DESDE=punto-venta` retoma sin reescribir datos) +
`scripts/video/grabaciones/explorar-facturacion.mjs` (exploración previa de solo lectura).

✅ **REGRABADO el 2026-09-16 — los 2 defectos están corregidos.** `video-facturacion-final.mp4` pasó a 78,52 s, con el
inicio de actividades en **1/3/2024** y el recuadro "Modo PRUEBA" entrando completo. El render anterior quedó en
`_anteriores/`; se conservan `crudo-v3.mp4` + `guion-v3.json` + `clicks-v3.json` para regenerar sin volver a grabar.

🛑 **Lo que se aprendió: regrabar "los 2 tramos" no alcanzaba.** El resumen fiscal **queda en pantalla mientras se carga
el punto de venta**, así que reemplazar solo 16,83-24,12 dejaba la fecha vieja (29/2/2024, `v1.227.0`) visible ~8 s en
el medio del video. Hubo que reemplazar **16,83-34,63 completo** — resumen + alta del punto de venta — con el modo
`TRAMO=PV` de `scripts/video/grabaciones/regrabar-facturacion.mjs`; para eso se borró el punto de venta 0002 del negocio
de prueba y la propia toma lo volvió a crear (verificado por REST antes y después). Y se detectó **solo extrayendo
cuadros del render**: el log del intento fallido decía "OK, 80.3s, 5 stickers" con el video igualmente mal.

El tenant de prueba queda con el emisor de ejemplo, el punto de venta 2 y la clave del CSR en storage — se limpia
junto con el resto de "Genesis360 Onboarding" cuando se termine la serie completa.

**Guía HTML complementaria publicada** (artifact de Claude, para pasarle al cliente):
https://claude.ai/artifact/WYpzGUG42wPBCv74ya5Jmg — mismo circuito en 10 pasos + 5 problemas comunes. Detalle en
[[wiki/features/facturacion-afip]].

---

## 🎬 Video 4 — Vender — ✅ GRABADO (83 s, 2026-09-14, con efectos de click)

Primer video con **cursor visible y efectos de click**. Archivos en `D:/Dev/genesis360-videos/video4-ventas/`:
`video4-final.mp4` (con sonidos de efectos), `video4-final-sin-sonido-efectos.mp4`, el crudo, `guion.json` y
`clicks.json`. La toma quedó guardada en `scripts/video/grabaciones/video4-vender.mjs`.

**Recorrido**: el día siguiente, caja cerrada → abrir con $10.000 → buscar y sumar 6 Gaseosas + 2 Yerbas →
descuento general 5 % → transferencia $10.000 + efectivo $11.000 → **vuelto $290** → Venta directa → ticket →
el stock bajó solo (48→42, 24→22) → la venta entró sola a la caja (ingreso $10.710 + la transferencia informada).

✅ **Verificado en la DB lo que escribió la toma** (REGLA #0): venta #31 por $20.710, rebajes con "Venta #31",
y en caja el **efectivo neto del vuelto** ($10.710) más un `ingreso_informativo` por la transferencia. "Venta
directa" **no emite factura** (es un botón aparte del ticket): la grabación no toca AFIP.

### 🛑 Lo que hizo tropezar la toma (ya corregido en el script)

- **El ticket nunca se cerró**: `getByRole('button', { name: /^(Cerrar|Nueva venta)$/ })` agarró la **pestaña**
  "Nueva venta" que está detrás del modal. Los últimos 20 s quedaron quietos sobre el ticket. En vez de volver a
  vender en PROD, se grabó un **complemento que solo navega** (Inventario + Caja) y se unió con un fundido.
  → Nombres exactos, y buscar del lado del modal.
- El link **"Caja"** del menú tiene de nombre accesible "Caja" + el punto de estado: `^Caja$` no coincide.
- El primer `input[type=number][placeholder="0"]` del POS es el **% del ítem**, no "Descuento general".

---

## ✨ Efectos de click para los próximos videos (pedido de GO, 2026-09-14)

Playwright no dibuja el puntero, así que en el video **no se ve dónde se hace click**: la pantalla
cambia sola. GO pidió reemplazarlo con efectos tipo cómic, más dinámicos:

- **Sticker de onomatopeya** en el punto del click, estilo historieta (globo con borde grueso,
  tipografía pesada, leve rotación), que entra con *pop* (escala 0 → 1,2 → 1) y sale rápido.
- **Que vibre la imagen** (sacudida corta, ~200 ms) en los clicks que importan: entrar, confirmar,
  guardar, cobrar.
- **Que NO diga siempre "¡Click!"** — variar y ser ocurrente, según lo que hace el botón:

| Acción | Ideas |
|---|---|
| Navegar / entrar | ¡Adentro! · ¡Vamos! · ¡Zas! · ¡Toc! |
| Guardar / crear | ¡Listo! · ¡Hecho! · ¡Pum! · ¡Anotado! |
| Confirmar | ¡Confirmado! · ¡Dale! · ¡Bum! · ¡Eso! |
| Cobrar / vender | ¡Ka-ching! · ¡Vendido! · ¡Cha-chín! |
| Abrir / cerrar caja | ¡Abierta! · ¡Cuadra! · ¡Clack! |
| Tipear / clicks menores | sin palabra: solo un anillo que marca el punto |

### ✅ Construido y usado en el Video 4 (2026-09-14)

| Pieza | Qué hace |
|---|---|
| `scripts/video/director.mjs` | **Cursor dibujado dentro de la página** (Playwright no dibuja puntero) con un anillo en cada click y movimiento con aceleración; registra cada click `{ t, x, y, tipo }` y marcas de escena. |
| `scripts/video/sticker.html` | Estallido de historieta (fuente Bangers, sombra dura) animado con Web Animations y **fotografiado cuadro por cuadro**: determinista. |
| `scripts/video/efectos.mjs` | Palabra (bolsa barajada por tipo, nunca dos iguales seguidas), posición al lado del botón, sacudida (zoom 3 % + temblor 0,32 s) y sonidos: *pop* en cada sticker, campanitas en el cobro, golpe grave en la sacudida. |
| `scripts/video/postproducir.mjs` | Sacudida → rótulos → stickers; sonidos mezclados sobre la música a −24 LUFS. |

Tipos de click: `navegar` · `agregar` · `guardar` · `confirmar` · `cobrar` · `abrir` · `cerrar` · `menor` (solo
el anillo). Una palabra puntual se fija con `"palabra"` en el click (en el Video 4: "¡Al carrito!" para el primer
producto — la bolsa había sacado "¡Uno más!").

Diferencias con el plan de abajo: el **cursor** y el **anillo** van dentro de la página (quedan en el crudo), y
los stickers en post, como estaba previsto — volver a grabar escribe datos en PROD; cambiar una palabra en post
es re-renderizar.

🛑 **Dos trampas que costaron**: (1) la opacidad del sticker tiene que estar en **todos** los cuadros clave — si
solo la define el último, Web Animations la interpola 1→0 durante toda la animación y sale a medio fundir; (2) a
−18 dBFS los sonidos quedaban tapados por la música (el cobro subía el pico 0,9 dB); a −12 se oyen (+3,8 dB).

⚠️ Los videos 1-3, 5 y 8 **no tienen clicks registrados**: ponerles efectos exige regrabar o marcar los clicks a mano.

### El plan original

1. **Registrar los clicks al grabar**, no estimarlos después: un helper `clickConEfecto(locator, tipo)`
   que antes del click toma el `boundingBox()` y el tiempo desde el inicio de la grabación, y lo
   agrega al `guion.json` como `clicks: [{ t, x, y, tipo }]`. La hoja de contacto ya hizo correr
   rótulos 5 s una vez; con el dato grabado la posición es exacta.
2. **Sticker como overlay**, con el mismo mecanismo de los rótulos (HTML → PNG con alpha): plantilla
   `tipo=sticker` en `overlay.html` con palabra, color y rotación. El *pop* con escala animada.
3. **Vibración** con `crop` sobre el cuadro levemente escalado, desplazando x/y con `sin(t)` solo en la
   ventana del click.
4. **Anillo** en el punto para los clicks menores: reemplaza al puntero sin tapar nada.
5. No repetir la misma palabra dos veces seguidas; sorteo con **semilla fija**, para que
   re-renderizar dé siempre el mismo video.
6. Un **"pop" sonoro** muy bajo en sincronía (el diseño de sonido que estaba abierto en el
   [plan de audio](plan-audio-videos.md)) — primero como muestra para que GO lo escuche.

**Regla de mesura**: como mucho un sticker cada ~3 s, y la sacudida solo en los clicks importantes.
El efecto tiene que dar ritmo, no tapar la pantalla que se está explicando.

---

## Qué NO prometer en los videos

- **Facturación electrónica en el alta**: no viene lista, hay que configurarla.
- **Trazabilidad (lotes, series, vencimientos)**: es del modo Avanzado. En Básico no está.
- **Marketplaces (Mercado Libre / Tienda Nube)**: se conectan aparte, no es parte del alta.

---

## Audio

El plan de música y diseño sonoro vive aparte: [Plan de audio de los videos](plan-audio-videos.md).
⚠️ La música de los videos ya producidos es **sintetizada y nadie la escuchó todavía** — verificar
antes de publicar.

## Relacionado

- [Autenticación y onboarding](../features/autenticacion-onboarding.md) — el flujo técnico completo.
- [Modo Básico / Avanzado](../features/modo-basico-avanzado.md) — qué gatea cada modo.
- [Configuración](../features/configuracion.md) — todas las pestañas del módulo.
- [Facturación AFIP](../features/facturacion-afip.md) — el circuito fiscal.
- [Suscripciones y planes](../features/suscripciones-planes.md) — trial, límites y planes.
- [Plataforma de soporte](../support/plataforma-soporte.md) — la baja de un negocio para liberar un
  mail entre tomas.

---

## ⚠️ Corrección al Video 5: la Caja NO registra egresos

Este documento decía que el video 5 debía mostrar *"ingresos y egresos de efectivo"*. **La mitad es
falsa**, y se descubrió grabándolo.

El modal de movimiento se llama **"Ingreso de caja"** y lo dice él mismo:

> *"Para registrar un egreso, creá un **Gasto** con el monto y método de pago. Caja solo registra
> ingresos manuales (aportes, devoluciones, etc.)."*

O sea: **la plata que sale se carga desde el módulo Gastos** (video 6), no desde Caja. El video 5
ahora lo aclara en pantalla en vez de prometer algo que no existe.

### 🛑 El detalle que hizo tropezar la grabación — dos veces

Dentro de ese modal hay tres chips de **motivos**, que el sistema **siembra solo** al crear el
negocio (`motivos_movimiento`, `tipo='caja'`):

| Motivo sembrado | Qué sugiere | Qué hace en realidad |
|---|---|---|
| Ingreso de efectivo | entrada | rellena el concepto |
| **Extracción / Retiro** | **salida** | rellena el concepto |
| **Gastos varios** | **salida** | rellena el concepto |

Los tres solo hacen `setMovConcepto(m.nombre)`: **rellenan el texto del concepto y nada más.** No
cambian el tipo del movimiento — el modal siempre graba un **ingreso**.

Dos de los tres nombran **salidas de plata** y están adentro de un modal que **solo registra
entradas**. Al grabar, se clickeó "Gastos varios", se escribió *"Flete de la mercadería"*, se puso
**$6.200**… y quedó asentado como **+$6.200 de ingreso**. Pasó **dos veces seguidas**, leyendo la
pantalla.

La app no lo esconde —la lista lo muestra en verde con `+$`, y al cerrar detectó el faltante de
$12.400 y lo registró— pero el camino invita al error. **Anotado como hallazgo para GO**; no es un
bug de código, es qué motivos se siembran.

✅ **Resuelto (mig 420, 2026-09-14, decisión de GO):** los chips ahora son "Ingreso de efectivo",
"Aporte del dueño" y "Fondo de cambio". En los negocios existentes se desactivaron "Extracción / Retiro"
y "Gastos varios". ⚠️ **El video 5 grabado muestra los chips viejos**: si se publica, regrabar ese tramo.
