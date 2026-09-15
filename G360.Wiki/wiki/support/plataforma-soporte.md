---
title: Plataforma de Soporte (admin.genesis360.pro)
category: support
tags: [soporte, admin, panel, genesis360-admin, baja-tenant, auditoria, 2fa, billing]
sources: [genesis360-admin (repo aparte), supabase/functions/admin-api, migration 221, migration 410, migration 411, migration 425, migration 426]
updated: 2026-09-15
---

# Plataforma de Soporte (admin.genesis360.pro)

Panel interno de soporte/staff, **repo separado** (`genesis360-admin`, rama `dev`). El frontend nunca
usa `service_role` directo: todo pasa por `callAdminApi('modulo.accion')` contra la Edge Function
**`admin-api`**, que vive en el repo de **Genesis360** (`supabase/functions/admin-api/index.ts`), no
en el del panel. La EF valida al agente (`support_agents`, staff interno — **no** un usuario de
tenant), autoriza por rol (`admin` vs `support`) y **audita cada acceso** en `admin_audit_log`
(cimientos: mig 221, ver [[wiki/database/migraciones]]).

**Estado al 2026-09-15.** El panel **ya está en PROD** (`admin.genesis360.pro`) desde antes, con
dashboard, clientes, CRM, soporte y facturación. Lo que está **solo en DEV** es todo lo que se sumó
desde el 2026-09-12: la baja de tenant, la búsqueda por mail, la ficha ampliada, las notas internas, la
auditoría, la búsqueda global, Analytics, el 2FA, y —más nuevo— que la respuesta de un ticket le llegue
al cliente (mig 425, sección 9) y que el cliente pueda seguir y responder su consulta desde la app (mig
426, sección 10). Va junto con el resto del batch acumulado (migs 407-426 + código hasta `v1.226.0` +
EFs `admin-api`/`billing-manual-avisar-pago` + el panel), a la espera del OK de GO — detalle del deploy
en `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ").

Para probarlo contra DEV sin deployar: `npm run dev` en `genesis360-admin` (su `.env.local` ya
apunta a DEV) e ingresar con un agente de rol `admin`.

---

## 1. Búsqueda y listado de tenants

Antes solo se podía filtrar por nombre de negocio. Ahora (2026-09-12):

- Búsqueda por **negocio**, **mail del dueño**, mail de **cualquier usuario** del tenant, o **id del
  tenant**.
- La lista muestra dueño + mail, **estado REAL** (una prueba vencida ya no cuenta como "en trial" —
  mismo criterio de `estadoTrial.ts` que corrigió la pantalla de planes, ver
  [[wiki/features/suscripciones-planes]]), cantidad de usuarios, último acceso y marca de **baja
  programada**.
- Filtros por estado + **export CSV**.
- **Búsqueda global Ctrl/⌘+K**.

---

## 2. Ficha del cliente (`CustomerDetailPage`)

- **Cuentas de acceso**: mail, rol, último acceso de cada usuario del tenant, con botón para
  **resetear contraseña**. ⚠ `generateLink` de Supabase **NO manda el mail** — el envío real va por
  la Edge Function `send-email`, mismo patrón que `invitar-proveedor` (ver
  [[wiki/features/portal-proveedores]]).
- **Ficha comercial + estado fiscal** del tenant.
- **Uso vs. límites del plan**, vía `fn_tenant_limite` — la MISMA función que usa el trigger que
  bloquea el `INSERT` cuando el tenant se pasa de su límite (no una copia que pueda divergir).
- **Tickets del cliente** y **actividad reciente**.
- 🛑 **Notas de crédito sin emitir en AFIP**: filas de `nc_afip_pendientes` con
  `requiere_reconciliacion_manual=true` — antes solo se veían por SQL directo. Ver
  [[wiki/features/facturacion-afip]] → "NC electrónica AFIP automática".
- **Extender la prueba** desde el panel — antes se hacía a mano con SQL contra PROD.
- **Notas internas** sobre el cliente (mig 411, tabla `admin_customer_notes`) — RLS encendida **sin
  policies** + `REVOKE` a `anon`/`authenticated` (nadie del lado tenant las ve). **Sin FK a
  `tenants`**, a propósito: si tuviera `ON DELETE CASCADE`, purgar el tenant borraría la nota que
  explica por qué se lo purgó.
- **Teléfono** (`tenants.telefono`, mig 412) como link `tel:` — ver
  [[wiki/features/autenticacion-onboarding]] → "`tenants.telefono`".

---

## 3. Baja de tenant — COMPLETA en DEV, probada 12/12

Cuatro acciones en `admin-api`: `customers.delete_preview` / `schedule_delete` / `cancel_delete` /
`purge_now`, con UI (`BajaTenantPanel.tsx`) que pide escribir el nombre exacto del negocio para
confirmar. Probada end-to-end contra DEV.

Antes de deployar se cerraron **3 agujeros de REGLA #0**:

1. **Purgar no cancelaba el preapproval de Mercado Pago** — se le seguía cobrando a un negocio ya
   borrado, y tras el `CASCADE` no queda ni el `mp_subscription_id` para encontrarlo después. Ahora
   **cancela ANTES de purgar**, fail-closed (si no puede cancelar, no purga).
2. **La cancelación estaba gateada por "¿parece que tiene un cobro?"** — ese gate salteaba
   exactamente al tenant que **nunca se linkeó** (hallazgo histórico H8/MP-C7, ver
   [[wiki/integrations/mercado-pago]]), que es el caso que `cancelarSubMP` sabe resolver buscando por
   el mail del dueño. Ahora se llama **siempre**, sin gate.
3. **Las cuentas de `auth` a borrar llegaban como una lista de UUIDs enviada DESDE el panel** — un
   payload manipulado (o un bug de UI) podía borrar la cuenta de auth de **otro** tenant. Ahora la EF
   **resuelve la lista ella misma** antes del `DELETE`, nunca toca a un agente de soporte
   (`support_agents`), y saltea a cualquier mail que siga teniendo una fila en `users` de otro tenant.

Ver también [[wiki/features/autenticacion-onboarding]] → "Mi Cuenta" (el camino del CLIENTE,
`schedule_delete` desde `/mi-cuenta`, que dependía de sacar esa ruta del `SubscriptionGuard`).

---

## 4. Auditoría (`admin_audit_log`)

La tabla se escribe desde la mig 221, pero no había pantalla para leerla — cada acceso del staff
quedaba en un ledger sin ventana. Ahora hay una pantalla de Auditoría en el panel.

⚠ El nombre del negocio se resuelve **aparte** (una consulta adicional), **NO con un embed
PostgREST**: `admin_audit_log` no tiene ni debe tener FK a `tenants`. Con `ON DELETE CASCADE`, purgar
un tenant borraría el propio registro de auditoría de su baja — el ledger tiene que sobrevivir al
borrado que audita.

**Hardening de la mig 411**: la mig 221 había dejado `admin_audit_log` con GRANT completo a
`anon`/`authenticated`, confiando solo en "RLS sin policies" como defensa. Es el mismo patrón de
fondo que corrigió la mig 272 para funciones de trigger — hay un `ALTER DEFAULT PRIVILEGES` en este
proyecto que le da `EXECUTE`/acceso a `anon`/`authenticated` sobre TODO objeto nuevo de `public` si no
se lo revoca explícitamente. La 411 agrega el mismo `REVOKE` a `admin_audit_log`.

---

## 5. Dashboard

Bloque nuevo **"Requiere atención"**: pruebas por vencer, pruebas vencidas sin convertir a plan pago,
tenants sin entrar hace +30 días, y bajas programadas.

---

## 6. Analytics

Datos reales (no mockeados). El **CAC no se muestra**: necesitaría la inversión publicitaria, que hoy
no está cargada en ningún lado.

---

## 7. Seguridad de agentes: 2FA (TOTP)

Opt-in para agentes de soporte — no obligatorio todavía.

---

## 8. Facturación (pagos manuales)

Los pagos manuales se listan ordenados por **vencimiento**, con un contador de cuántos están
vencidos. Ver [[wiki/features/pago-manual]] para el flujo completo de carga manual de staff.

---

## 9. Tickets: la respuesta le llega al cliente (mig 425, 2026-09-15, EN DEV)

**Antes:** el cliente avisaba "Ya transferí" desde Mi Cuenta (`billing-manual-avisar-pago` crea un ticket `in_app` con
un mensaje `cliente`), el equipo respondía desde el panel y **la respuesta no le llegaba a nadie**:
`support.tickets.reply` solo guarda el mensaje, y la app no tiene pantalla de tickets.

**Ahora:** el trigger `trg_notificar_respuesta_soporte` (AFTER INSERT en `support_messages`, solo mensajes de agente)
manda una notificación a la campanita del usuario que abrió el ticket: "Soporte respondió: {asunto}" con el texto
(hasta 500 caracteres). Costo: un INSERT por respuesta; la campanita ya consulta cada 30 segundos.

| Ticket | ¿Le llega al cliente? | Qué muestra el panel |
|---|---|---|
| Abierto por el cliente desde la app (tiene mensaje `cliente`) | Sí, cada respuesta | "Al cliente le llega como notificación…" · botón "Responder al cliente" |
| Abierto por el equipo desde el panel | No: es un hilo interno | "El cliente no ve estos mensajes" · botón "Guardar nota" |

⚠️ En un ticket del cliente **todo lo que escribe un agente le llega**: las notas internas van en las notas del
cliente (mig 411), no en el hilo.

De paso, `support_tickets` y `support_messages` quedaron sin privilegios para `anon`/`authenticated` (solo las frenaba la
RLS sin policies). Verificación: UAT §61.

---

## 10. El cliente responde desde la app: Ayuda → Mis consultas (mig 426, 2026-09-15, EN DEV)

Pedido de GO, evaluado y cerrado en la misma sesión que la 425 (ver "Pendiente" de esa sección, ahora resuelto). El
"Reportar un problema" de Ayuda **ya no es un mail suelto**: crea un ticket real que el cliente puede seguir y
responder desde `/ayuda/consultas`, fuera del `SubscriptionGuard` (como Mi Cuenta — con la suscripción vencida es
justo cuando más hace falta hablar con soporte).

**Quién ve qué** (decisión de GO): cada usuario ve las consultas que abrió; **DUEÑO y SUPER_USUARIO** ven **todas**
las del negocio (el rol **ADMIN = staff NO entra**, mismo criterio que el resto de la app). El equipo se entera por
**mail** (`send-email` tipo nuevo `soporte_consulta`, siempre a `soporte@genesis360.pro`, con link directo al ticket
en `https://admin.genesis360.pro/support?ticket=<id>` — ver [[wiki/integrations/resend-email]]) y por una **marca en
el panel** (`pendiente_equipo`, filtro "Solo los que esperan respuesta del equipo" + orden pendientes primero).

**Notas internas vs. respuesta al cliente**: `support_messages.interno` — una nota interna no le llega al cliente,
no aparece en su hilo y no le cambia el estado ni la marca de "pendiente". Solo una respuesta sin `interno` avisa a
la campanita (reusa el trigger de la mig 425) y saca la marca de pendiente. El agente firma siempre "Soporte
Genesis360" (el hilo no expone qué agente puntual respondió).

**Ciclo de vida del ticket**: el cliente escribe en una consulta `esperando`/`resuelto` → se reabre (`abierto`) y
vuelve a quedar pendiente del equipo; en una `cerrado` el servidor lo rechaza ("Esta consulta está cerrada, abrí una
nueva"). Backfill de la 426: a los tickets existentes se les asigna `usuario_id` a partir del primer mensaje
`cliente` que siga en el negocio — el ticket que ya existía de "Ya transferí" (Facturación → pago manual) pasó a
aparecer en Mis consultas de quien avisó, coherente con lo que pidió GO.

**Formulario** (`NuevaConsultaForm.tsx`, desde `AyudaModal` o `/ayuda/consultas?nueva=1`): tipo ("Algo no
funciona"/"Tengo una duda"/"Quiero sugerir algo"), urgencia (baja/media/alta), asunto (3-120 caracteres), detalle
(hasta 4000) y hasta **3 adjuntos** (imagen PNG/JPG/WEBP o PDF, **5 MB** cada uno) al bucket privado
**`soporte-adjuntos`** (`<tenant>/<usuario>/<id>-<nombre>`, sin tildes ni `..`). El equipo los lee desde el panel con
un **link firmado de 1 hora** (`admin-api`, `service_role`); el propio cliente y el DUEÑO/SUPER_USUARIO del negocio
los leen directo por policy de storage.

**Guards server-side** (RPC SECURITY DEFINER, las tablas siguen sin privilegios para `authenticated` desde la mig
425): `fn_soporte_crear_consulta`, `fn_soporte_responder` (rechaza en `cerrado`), `fn_soporte_mis_consultas`,
`fn_soporte_consulta` (nunca devuelve notas internas). **Topes anti-spam**: 10 consultas por usuario cada 24 h y 30
mensajes por hora, contados de a un pedido por usuario (`pg_advisory_xact_lock`, para que una ráfaga concurrente no
se cuele antes del `COUNT`).

**Panel (`genesis360-admin`, rama `dev`, sin commitear todavía)**: filtro "Solo los que esperan respuesta del
equipo", marca "● Respuesta del cliente", quién abrió cada consulta, notas internas resaltadas en ámbar, adjuntos
con link, casilla "Nota interna" junto al botón de responder.

**EFs**: `admin-api` (`support.tickets.list` con `pendiente_equipo`/`usuario_id`/orden pendientes primero,
`support.tickets.detail` con `interno`/adjuntos firmados/`reportante`, `support.tickets.reply` acepta `interno` y lo
audita; `soporte-adjuntos` sumado a `BUCKETS_POR_TENANT` de la baja de tenant) y `billing-manual-avisar-pago`
("Ya transferí" ahora crea el ticket con `usuario_id` del que avisó y `tipo: 'pago'`).

Verificación: **e2e 152** (3/3, mutante) contra DEV — pantalla (crear con captura, hilo, responder, mails
interceptados) y servidor (cajero/supervisor solo lo suyo, DUEÑO todo el negocio, adjuntos solo propios, tablas no
legibles directo, anon 401). SQL en DEV con los triggers reales, impersonando al cajero, cubre nota interna/reabrir/
cerrada. UAT §62.

---

## Testing

**18/18 e2e contra DEV**, incluidos **tests de fuga**: el RPC que devuelve mails de usuarios y las
notas internas (`admin_customer_notes`) **NO son accesibles** ni con la `anon key` ni con el token de
un usuario real de la app — solo vía `admin-api` con un agente de soporte autenticado.

---

## Pendiente

- **Login-as read-only** — sigue **501 (Not Implemented)**. Requiere un modo read-only real +
  token efímero en la app principal; queda fuera de esta tanda, merece su propio diseño.
- ✅ **Responder desde la app ("Mis consultas")** — CERRADO 2026-09-15 (mig 426, ver sección 10 arriba).
- **Avisar al cliente cuando se registra su pago manual** — `fn_registrar_pago_manual` no notifica: el cliente que
  avisó "Ya transferí" no se entera de que se le extendió el acceso salvo que el agente responda el ticket. Sigue
  pendiente de decisión de GO.
- **Ayuda, Fase 2** ("Cursos y recursos") — videos servidos desde un bucket público de Storage que GO sube a mano;
  no toca este panel, ver [[wiki/overview/app-reference]] → "Ayuda" y `sources/raw/project_pendientes.md`.

---

## Migraciones relacionadas

| # | Qué agrega |
|---|---|
| 221 | Cimientos: `support_agents` + `admin_audit_log` + `is_staff()` |
| 410 | `fn_admin_tenants_overview(p_q, p_limit)` y `fn_admin_tenant_cuentas(p_tenant_id)` — SECURITY DEFINER, `REVOKE` de `anon`/`authenticated` + `GRANT` solo a `service_role` |
| 411 | `admin_customer_notes` (RLS sin policies, sin FK a `tenants`) + hardening de `admin_audit_log` (mismo `REVOKE` que faltaba desde la 221) |
| 412 | `tenants.telefono` |
| 425 | Trigger `trg_notificar_respuesta_soporte` — avisa a la campanita del cliente cuando responde un agente; `REVOKE` de `anon`/`authenticated` en `support_tickets`/`support_messages` |
| 426 | Consultas de soporte desde la app: `usuario_id`/`tipo`/`modulo`/`pendiente_equipo` en `support_tickets`, `interno`/`adjuntos` en `support_messages`, 4 RPC con guard, bucket `soporte-adjuntos` — ver sección 10 arriba |

Detalle completo de cada una en [[wiki/database/migraciones]].

---

## 🖥️ Verificado RENDERIZADO, no solo compilado (2026-09-12)

Se levantó el panel contra DEV y se recorrieron las **10 pantallas** con capturas, atrapando errores
de consola y requests fallidos. Las 10 cargan con datos reales y sin errores — pero el recorrido
destapó **dos bugs que ni el typecheck ni los tests de API veían**:

1. **Clave duplicada de React en el sidebar.** "Usuarios" y "Auditoría" comparten el módulo `users`
   (las dos son solo-admin) y el menú keyeaba por módulo. Ahora keyea por ruta.
2. 🛑 **"Extender prueba" podía ACORTAR el acceso.** Un tenant `cancelled` conserva acceso hasta
   `subscription_period_end` — el período que YA pagó (MP-C9) — y la fecha nueva se calculaba solo
   sobre `trial_ends_at`. A uno con dos meses por delante, "extenderle 15 días" lo dejaba con 15
   días: extender restando, desde el botón que promete lo contrario. Ahora la base es la fecha de
   acceso **más lejana** de las vigentes (hoy, el trial o el período pagado), así que sumar nunca
   puede restar.

**Moraleja para el próximo cambio de UI acá: que compile no prueba que no explote al montarse.** El
recorrido con capturas cuesta un minuto y encontró en una pasada lo que 18 tests de API no podían
ver.

### Cómo repetirlo

```bash
cd D:/Dev/genesis360-admin && npm run dev     # su .env.local ya apunta a DEV
```

Entrar con un agente de rol `admin` (en DEV, `soporte@genesis360.pro` quedó con ese rol — en PROD ya
lo era). Recorrer Dashboard → Clientes → ficha de un cliente → Auditoría → Analytics → Facturación, y
probar `Ctrl/⌘+K`.


## 🗑️ La baja real (verificada el 2026-09-13 con "Ferretería Tongas" en DEV)

GO purgó un tenant desde el panel. **Salió bien**: barrido de las **151 tablas con `tenant_id` → 0
filas huérfanas**, ninguna fila colgando de la sucursal borrada (41 tablas con `sucursal_id`
revisadas), y la auditoría completa — con la **foto del inventario tomada ANTES del DELETE**, que es
justamente lo que después ya no se puede reconstruir. La entrada de `admin_audit_log` **sobrevivió
al borrado del tenant**, como se había diseñado (sin FK a `tenants`).

### 🛑 Pero faltaba algo: los archivos de Storage

Ese tenant estaba vacío, y por eso no se notaba. **El CASCADE es de Postgres; Storage es otro
sistema y no se entera.** Un negocio con archivos dejaba huérfano, entre otras cosas, **su
certificado de AFIP** — una credencial fiscal viva colgada de un negocio que ya no existe (hoy hay
35 de un solo tenant en DEV). Más los comprobantes que el cliente subió, fotos de productos,
remitos, logo, documentación de empleados y facturas de courier. Además de la factura de storage que
nunca baja, es un borrado **incompleto** frente al derecho de supresión.

Cerrado: `purge_now` ahora borra los archivos, juntando los ids **antes** del DELETE (después del
CASCADE no hay de dónde sacarlos). Los prefijos no son todos iguales:

| Esquema | Buckets |
|---|---|
| `<tenant_id>/` | archivos-biblioteca, autorizaciones-fotos, certificados-afip, comprobantes-gastos, logos, presupuestos-servicios, productos, remitos |
| `<user_id>/` | avatares |
| `<empleado_id>/` y `prestamos/<empleado_id>/` | empleados |
| `pod/<envio_id>/` y `facturas-courier/<tenant_id>/` | etiquetas-envios |

Fail-soft: cuando corre, el negocio ya está borrado, así que un error no aborta nada — se devuelve
al panel y queda en la auditoría (`storage_borrados`, `storage_errores`). Probado con archivos en
los 4 esquemas: **8 subidos → 8 borrados → 0 restos**.

⚠️ **Si se agrega un bucket nuevo, hay que sumarlo a `BUCKETS_POR_TENANT`** en la EF — si no, sus
archivos vuelven a quedar huérfanos en silencio.


## Links relacionados

- [[wiki/integrations/mercado-pago]] — cancelación/linkeo de suscripciones desde el panel
- [[wiki/features/pago-manual]] — carga manual de pagos por staff
- [[wiki/features/facturacion-plataforma]]
- [[wiki/features/suscripciones-planes]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/autenticacion-onboarding]]
- [[wiki/features/portal-proveedores]] — mismo patrón de envío de mail vía `send-email`
- [[wiki/integrations/resend-email]] — tipo `soporte_consulta` + hardening anti-relay de `send-email` (2026-09-15)
- [[wiki/overview/app-reference]] — "Ayuda" (`/ayuda`, `/ayuda/consultas`)
- [[wiki/database/migraciones]]
- [[wiki/architecture/guards-server-side]]
