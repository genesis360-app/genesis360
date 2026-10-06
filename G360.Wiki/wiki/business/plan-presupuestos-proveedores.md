---
title: Plan de implementación — Presupuestos de proveedores
category: business
tags: [proveedores, presupuestos, compras, portal-proveedores, plan]
sources: [plan de Fede 2026-08-27, respuestas de GO A1–I1, relevamiento-presupuestos-proveedores-reglas-negocio.html, src/pages/ProveedoresPage.tsx, src/pages/PortalProveedoresPage.tsx, src/pages/RecepcionesPage.tsx, migraciones 387/390/473]
updated: 2026-10-06
---

# Plan de implementación — Presupuestos de proveedores

**Para:** Fede y GO · **Fecha:** 6 de octubre de 2026 · **Estado:** 🟡 esperando las respuestas del relevamiento
(`relevamiento-presupuestos-proveedores-reglas-negocio.html`, que acompaña este documento).

Este plan junta tu propuesta del 27/08 con las respuestas de GO al cuestionario A1–I1. Los códigos entre
corchetes (por ejemplo **[A1]**) remiten a las preguntas del relevamiento: donde aparecen, el plan sigue la
opción sugerida hasta que ustedes respondan.

---

## 1. Qué hay hoy y qué falta

**Hoy no existe la pestaña Presupuestos.** Lo que sí está funcionando en producción:

| Qué | Dónde | Qué hace |
|---|---|---|
| **Portal de Proveedores** (desde el 01/09) | `/portal-proveedores` | El proveedor entra con su cuenta, elige el negocio, ve las OC que ese negocio le **envió** y propone un precio por ítem. El negocio revisa la propuesta y la aplica a mano: el proveedor nunca puede cambiar un precio por su cuenta. |
| **Cuenta de proveedor para varios negocios** | — | Una misma cuenta sirve para todos los negocios a los que le vende. Hoy se identifica por **email** y **no pide DNI**. Cuando el negocio lo invita, el vínculo queda activo sin que el proveedor acepte. |
| **Comparar presupuestos de servicios** | Proveedores → Servicios | El negocio carga a mano un monto y un archivo por presupuesto, los compara, y al aprobar uno se crea el gasto. No tiene líneas, versiones ni participación del proveedor. |

**Lo que falta es todo el circuito de tu plan:** Solicitud → varias ofertas → versiones → elegir → OC → pago
con comprobantes → recepción → historial.

## 2. Tres choques con reglas que ya funcionan

Encontré tres puntos donde lo pedido choca con cómo funciona hoy la app. Ninguno impide hacer el módulo, pero
hay que resolverlos antes de programar, porque tocan plata y stock.

### 2.1 Cuándo nace la OC [A1] 🔴

El plan dice que el presupuesto *"pagado y validado pasa a ser OC"*, y a la vez permite pagar en partes por
Cuenta Corriente.

Desde el 06/10, la Cuenta Corriente de proveedores funciona así (lo decidió GO y está en producción): **la
deuda con el proveedor nace cuando se recibe la mercadería**, y **cada pago se imputa a una OC**. Si la OC
recién existiera al estar pagada, una seña no tendría a qué OC imputarse y la cuenta del proveedor se
descuadraría.

**Propuesta:** la OC nace **al elegir la oferta**. La seña o el pago total se registran sobre esa OC como pago
adelantado, igual que hoy, y la deuda se arma al recibir. Así no hay que cambiar nada del modelo de Cuenta
Corriente.

### 2.2 "Pagada antes de recibir" [A2]

En el resumen se dijo que *"la OC tiene que estar pagada antes de pasar a Recepción, no es una regla
nueva"*. **Hoy no funciona así:** cada proveedor tiene su modo de pago (contado, anticipo, contra entrega o
cuenta corriente) y Recepción no se bloquea por falta de pago. **Propuesta:** dejarlo como está.

### 2.3 Recepción sin precios [B1]

Hoy la pantalla de Recepción muestra el precio de cada ítem a quien reciba. **Propuesta:** un permiso de rol
nuevo, "Ver costos en recepción" (el Dueño lo tiene siempre), que se aplique a **todas** las OC. Es el mismo
criterio que en Repositores. El costo se sigue calculando igual por detrás, porque de ahí sale el gasto de la
compra.

## 3. Cómo se organiza la información

Respeta tus tres niveles: la Solicitud, una oferta por proveedor, y las versiones de cada oferta.

```
SOLICITUD (la arma el negocio)
  nombre · notas libres · fecha límite (opcional) · estado
  líneas: producto del catálogo o texto libre (mano de obra, colocación…) · cantidad
  │
  ├── OFERTA del Proveedor A  (cargada por él desde el Portal)
  │     ├── versión 1 · 03/10 · proveedor · USD a $1.180 · válida hasta 15/10
  │     ├── versión 2 · 05/10 · negocio   (contrapropuesta)
  │     └── versión 3 · 06/10 · proveedor   ← activa
  │
  ├── OFERTA del Proveedor B  (cargada A MANO por el negocio, porque B no usa el sistema)
  │     └── versión 1
  │
  └── OFERTA del Proveedor C  → ELEGIDA → se convierte en OC
        las demás quedan selladas (en gris, se pueden consultar)
```

Cada línea de una versión guarda **qué cambió respecto de lo pedido** (cantidad ±N, modificada, agregada,
eliminada). Ese cálculo lo hace el sistema, no el proveedor, así que no lo puede ocultar.

**Reglas que cumple el servidor, no solo la pantalla.** La pantalla se puede saltear; estas reglas no:

- Una versión enviada **no se edita**: para cambiarla se manda una nueva y la anterior queda en el historial.
- El proveedor **nunca ve** ofertas de otros proveedores ni datos internos del negocio. Accede solo a lo suyo,
  igual que en el Portal actual.
- **Elegir una oferta** se hace de una sola vez y sin pasos intermedios: controla el permiso (por defecto solo
  el Dueño), que la versión esté activa, que no esté vencida y que nadie haya elegido otra un segundo antes.
  Recién ahí sella las demás y crea la OC.
- Una oferta con la validez vencida no se puede elegir ni pagar.

## 4. Identidad del proveedor [C1, C2, C3]

Es lo que señalaste como los dos riesgos de la sección 3 de tu plan. La propuesta:

- **La cuenta es del proveedor** (nombre o razón social; CUIT opcional para el monotributista o el informal).
  **El DNI es de la persona que la opera**, es único en todo Genesis360 y se puede reemplazar si cambia el
  vendedor, sin perder los negocios vinculados ni el historial. **[C1]**
- **La invitación es un link y queda pendiente** hasta que el proveedor la acepta. Lo puede aceptar **con su
  cuenta, aunque use otro mail**. Si intenta registrarse con un DNI que ya existe, el sistema le dice "ya tenés
  cuenta, ingresá". **[C2]**
- La invitación sale desde la ficha del proveedor, así que al aceptar se une a esa ficha y no se duplica.
  **[C3]**
- **"Misma cuenta con vistas diferentes"** (tu sección 13): nada de este módulo lo impide, porque la base de
  datos ya permite que la misma persona sea proveedor y también usuario de un negocio. El selector de vista va
  en una fase posterior. **[C4]**

## 5. Fases

Ordenadas de menor a mayor riesgo **[G1]**. Cada fase se puede usar sola, sin esperar a la siguiente.

| # | Fase | Qué se puede usar al terminarla | Riesgo |
|---|---|---|---|
| **1** | **Presupuestos del lado del negocio** | Pestaña **Presupuestos** en Proveedores: armar Solicitudes, cargar ofertas **a mano** por proveedor, versiones, marcas de cambio, lista que se despliega con cada oferta y su precio final, detalle con descarga en PDF, filtros (borrador / activas / finalizadas / canceladas), **elegir → OC** y sellar las demás. | Bajo. No entran terceros y ya sirve sin ningún proveedor registrado. |
| **2** | **Cuenta del proveedor** | Registro propio (nombre, contacto, DNI único), invitación pendiente y aceptación, "ya tengo cuenta", perfil con logo, botón **Compartir** con link de invitación **[E1]**. | Medio. Es el acceso de terceros a datos entre negocios. |
| **3** | **El proveedor cotiza** | Desde el Portal, con el **logo del negocio siempre visible**: recibe Solicitudes, responde línea por línea, agrega o quita líneas, ve el último precio que le pagó ese negocio, pone una validez, cotiza en USD con su cotización, contrapropone dentro del hilo y elige qué versiones quedan activas. El negocio ve la foto o el logo del proveedor. | Alto. Un tercero escribe datos. |
| **4** | **Pago y comprobantes** | Varios comprobantes por oferta u OC y un "lo recibí" del proveedor en cada uno, el estado de pago visible en el Portal, y avisos al proveedor (Solicitud nueva, contrapropuesta, comprobante por confirmar) **[F1]**. | Alto. Hay plata de por medio: los pagos usan los mismos mecanismos que hoy, sin caminos nuevos. |
| **5** | **Recepción e historial** | Recepción sin datos sensibles **[B1]**; historial del proveedor con las OC cerradas, entregas tarde **[D4]** y faltantes; permiso "Elegir presupuesto" delegable por rol. | Medio. |
| **6** | **Futuro (no se construye ahora)** | Misma cuenta como proveedor y como negocio; conexión entre negocios de Genesis360 (stock compartido, pagos enlazados, comprobantes para las dos partes). | — |

**Avisos [F1].** Pediste reutilizar las notificaciones que ya existen, pero esas son para usuarios **de un
negocio** y el proveedor no lo es. Al negocio le llegan los avisos de siempre (oferta nueva, comprobante
confirmado). Al proveedor, un **mail** (con el envío de mails que ya usa la app) y un **aviso dentro del
Portal**.

**Cada fase se cierra igual:** cambios en la base revisados antes de aplicarlos, primero en el entorno de
prueba y después en producción; tests automáticos que verifican en la base de datos que la plata y el stock
quedaron bien, y no solo en la pantalla; el escenario anotado en el checklist de pruebas manuales; y la
documentación actualizada.

## 6. Pendientes fuera del código

- **Legal:** el acuerdo de tratamiento de datos de terceros, que ya estaba pendiente, tiene que cubrir los
  datos de los proveedores, incluido el **DNI**.
- **Proveedor real para probar [G3]:** alguien que hoy mande presupuestos en papel o por WhatsApp, para
  validar las fases 2 y 3 con un caso real.

## 7. Qué necesitamos de ustedes para arrancar

1. **A1, A2 y B1** (cuándo nace la OC, si se exige pago antes de recibir y quién ve los precios en Recepción).
   **Sin estas tres no empieza la Fase 1.**
2. El resto del relevamiento se puede ir respondiendo por fase. Donde no haya respuesta, se sigue la opción
   sugerida solo si ustedes la confirman.

Ver también: [[wiki/features/portal-proveedores]] (lo que ya existe), [[wiki/features/clientes-proveedores]]
(OC, Compras 2.0 y Cuenta Corriente de proveedores), [[wiki/features/gastos]].
