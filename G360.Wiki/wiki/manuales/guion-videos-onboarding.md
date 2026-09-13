---
name: guion_videos_onboarding
description: Guion de pasos obligatorios para grabar los videos de onboarding de Genesis360, sacado del flujo real del código (no de la memoria).
type: manual
---

# Guion de los videos de onboarding

Pedido de GO (2026-09-12): una serie de videos que arranca en `genesis360.pro` y termina con el
negocio funcionando, y después uno por funcionalidad.

**Claude no puede grabar video ni capturar pantalla.** Lo que aporta es esto: los **pasos
obligatorios** de cada video, verificados contra el código que realmente corre — qué pantalla,
qué campo, qué pasa después de cada click y dónde el flujo se bifurca. Los textos hablados quedan
a criterio de quien graba.

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

Si el mail ya es dueño de un negocio, el onboarding **no repite el formulario**: detecta que ya
tiene tenant y lo manda al dashboard (así evita duplicados). Es exactamente lo que le pasó a GO
con `genesis360.ar@gmail.com` el 12/09.

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

## 🎬 Video 1 — De la web a tu negocio creado

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

## 🎬 Video 2 — Configuración inicial (modo Básico)

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

El orden sale del recorrido que ya hace el tour de bienvenida, que está pensado como camino de
menor fricción: **primero cargar, después vender, después medir.**

| # | Video | Pantalla | Qué tiene que quedar demostrado |
|---|---|---|---|
| 3 | **Cargar productos** | `/productos/nuevo` | Alta manual (costo, precio, stock mínimo, categoría), alta **desde una foto**, e importación por Excel |
| 4 | **Vender** | `/ventas` | Buscar, agregar al carrito, descuento, **varios medios de pago** en una venta, y que el stock baja solo |
| 5 | **Caja** | `/caja` | Abrir la caja, ingresos y egresos de efectivo, arqueo y cierre del día |
| 6 | **Gastos** | `/gastos` | Registrar un gasto, categorizarlo, y que impacta en la ganancia |
| 7 | **Clientes y cuenta corriente** | `/clientes` | Alta de cliente, venta en cuenta corriente y cobranza |
| 8 | **Stock** | `/inventario` | Entradas, salidas, ajustes, y el stock mínimo disparando alertas |
| 9 | **Métricas** | `/dashboard` → Métricas | Ventas, margen, rotación, productos sin movimiento |
| 10 | **Facturar (AFIP)** | Configuración → Facturación | El video más delicado: ver abajo |

### ⚠️ Video 10 (facturación) — las dos trabas reales

1. **No se puede habilitar la facturación sin CUIT y sin condición de IVA guardados.** La app lo
   bloquea a propósito: la condición de IVA del emisor es la que decide si el comprobante sale
   **A, B o C**, y un monotributista sin setearla emitiría B en lugar de C.
2. El certificado se saca con un **asistente** (se genera un CSR, se sube a AFIP y se vuelve con el
   certificado). Es el tramo más largo y conviene que sea un video propio, no un pedazo de otro.

Para grabarlo hace falta un CUIT de prueba en homologación. **Nunca en cámara un CUIT real ni el
certificado.**

---

## Qué NO prometer en los videos

- **Facturación electrónica en el alta**: no viene lista, hay que configurarla.
- **Trazabilidad (lotes, series, vencimientos)**: es del modo Avanzado. En Básico no está.
- **Marketplaces (Mercado Libre / Tienda Nube)**: se conectan aparte, no es parte del alta.

---

## Relacionado

- [Autenticación y onboarding](../features/autenticacion-onboarding.md) — el flujo técnico completo.
- [Modo Básico / Avanzado](../features/modo-basico-avanzado.md) — qué gatea cada modo.
- [Configuración](../features/configuracion.md) — todas las pestañas del módulo.
- [Facturación AFIP](../features/facturacion-afip.md) — el circuito fiscal.
- [Suscripciones y planes](../features/suscripciones-planes.md) — trial, límites y planes.
- [Plataforma de soporte](../support/plataforma-soporte.md) — la baja de un negocio para liberar un
  mail entre tomas.
