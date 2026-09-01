---
name: asistente-whatsapp
description: Asistente de WhatsApp con IA para el DUEÑO de cada negocio — consultas de stock/precio (Fase 1) + carga de gastos como borrador con doble confirmación, también por FOTO o AUDIO además de texto (Fases 2+3), + briefing diario proactivo de apertura/cierre por plantilla pre-aprobada de Meta (Fase 4), vía Meta Cloud API + Claude Sonnet 5 (+ Groq Whisper para audio). Plan de 4 fases (propuesta de Fede, 25/8/2026) — LAS 4 FASES construidas (v1.181.0/v1.182.0/v1.183.0/v1.184.0) y **✅ EN PROD desde el 2026-08-27** (PR #334, merge commit `867d651a`, migs 382-385 aplicadas y verificadas en PROD), pero **DORMIDA a propósito**: `whatsapp_credentials` en PROD tiene 0 filas, ningún tenant real la tiene activada. Fase 3 verificada solo PARCIALMENTE en DEV (el ruteo/seguridad sí, el happy path real de audio/foto todavía no — requiere un mensaje entrante real). Fase 4 verificada solo PARCIALMENTE en DEV (todo el código confirmado correcto salvo el envío real, bloqueado por la aprobación PENDIENTE de Meta de las 2 plantillas). Trámite real de Meta (número de prueba) conectado por GO el 2026-08-26 — sigue bloqueado para mensajes ENTRANTES reales (Fases 1-3) por falta de un chip dedicado para registrar el número; no aplica a Fase 4, que es 100% saliente. **🆕 2026-08-27 (sesión nueva, post-deploy): Embedded Signup de Meta CONSTRUIDO Y COMMITEADO EN DEV (v1.185.0, commit `7c1e1a45`, SOLO DEV, sin deploy a PROD)** — EF nueva `wa-embedded-signup-exchange` + card "WhatsApp" self-service en ConfigPage, para que cada cliente conecte su propio WhatsApp sin repetir el trámite manual de GO; el token guardado es PROPIO de cada tenant (no compartido, corrige una especulación de la sesión anterior). **🆕 2026-08-28 (misma conversación, sin `/clear`, v1.186.0): CÓDIGO VALIDADO end-to-end con datos reales de Meta (App ID `1059640186689341`, `config_id` `1359336659241551`) — confirmado por 3 caminos distintos que el bloqueo es 100% de Meta: falta la Verificación del Negocio (documentos de Fede: CUIT + comprobante de domicilio), un trámite EXTERNO, NO diferible como se había documentado el 2026-08-27** (corrección explícita de esa entrada). De paso: la Configuration de Meta fuerza el token a 60 días (no existe "Nunca expira" para WhatsApp Embedded Signup), fix defensivo de timeout 3min agregado, y hallazgo de que Chrome bloquea el flujo por FedCM. **🆕 2026-08-31 (v1.187.0 + v1.188.0): Chrome/FedCM investigado a fondo, SIN fix de código posible de nuestro lado** (documentado como comentario en el código, sin workaround especulativo — pendiente que GO reporte el bug a Meta); **Portal de Proveedores arranca con su prerequisito de identidad cross-tenant construido y aplicado en DEV** (`proveedor_accounts`/`proveedor_account_tenants`, migs 387/387b/387c, replica el patrón de `support_agents`) — todavía sin flujo de invitación ni policies de `ordenes_compra`. De paso, prerequisito técnico de Supervisión (mig 386, ver [[wiki/features/supervision]]) y fix de `npm run lint` (roto en todo el repo, 4 bugs reales corregidos al activarlo) en la misma sesión, sin relación directa con WhatsApp.
---

# Asistente de WhatsApp con IA

Canal nuevo, separado del chat web del header (ver [[wiki/features/asistente-ia]]): un número de WhatsApp
por negocio al que el DUEÑO le escribe para consultar stock/precio en lenguaje natural, respondido por
Claude con tool-calling sobre la base real del tenant. Origen: propuesta grande de Fede del 2026-08-25
(secciones A-M, ver `log.md` 2026-08-25/26 y `sources/raw/project_pendientes.md` cont. 25), que también
incluía un Portal de Proveedores — GO decidió arrancar por acá primero (2026-08-26, cont. 26) por reusar el
motor de tool-calling ya probado del "Plan IA" y tener menor riesgo.

> ⚠ No confundir con `src/lib/whatsapp.ts` (normalización y plantillas de link de WhatsApp SALIENTE, usado
> hoy para mandar manualmente un recordatorio de CC o una OC desde `ClientesPage`/`GastosPage`) — eso es un
> deep-link `wa.me`, no un canal conversacional con IA. Este documento es sobre el canal nuevo de Meta
> Cloud API + IA — mayormente ENTRANTE (webhook, Fases 1-3), más un mensaje SALIENTE nuevo desde la Fase 4
> (briefing proactivo por plantilla, no un deep-link `wa.me`).

## Estado (2026-08-31) — 🔴 Chrome/FedCM investigado a fondo, SIN fix de código posible · 🆕 Portal de Proveedores arranca (identidad cross-tenant construida en DEV)

Sesión que se reinició a mitad de tarea (el proceso de Claude Code se cortó) y se retomó con todo el
contexto. Continuación de la sesión de fix de `npm run lint` (`v1.187.0`, ver
[[wiki/development/convenciones-codigo]]) — sin relación directa con WhatsApp esa parte.

**Chrome/FedCM (Hallazgo #1 de la sección de abajo) — investigado a fondo (commit `529a0ea8`)**: confirmado
que Chrome intercepta el popup de `FB.login({config_id, response_type:'code', ...})` vía **FedCM**
(Federated Credential Management) — Meta le pisa `config_id`/`response_type`/
`override_default_response_type` DENTRO del propio popup, del lado de `facebook.com`; en Edge la misma
llamada sí llega con los parámetros correctos. Coincide en el tiempo con que Meta lanzó **"Login with
Facebook" en open beta** (modo one-tap basado en FedCM) el 27/8/2026, 4 días antes de este hallazgo —
sospechoso como causa, pero **sin fuente PRIMARIA de Meta confirmada** (solo 2 medios secundarios citando un
post de developers.meta.com que no se pudo verificar de forma directa). Este código **nunca seteó
`fedCM: true`** ni ningún flag relacionado — la intercepción no depende de nada que Genesis360 controle, y
**no existe (a la fecha) ningún parámetro documentado de `FB.init`/`FB.login` ni un `Permissions-Policy` del
lado del sitio que la evite**. Por eso **no se aplicó ningún workaround especulativo sobre código de
autenticación real** — queda documentado como comentario extenso en `src/lib/metaEmbeddedSignup.ts`, con las
fuentes citadas y la aclaración de que no están confirmadas de forma directa. **🛑 Pendiente real, a cargo de
GO**: reportar el bug a `developers.facebook.com/support/bugs/` (evidencia Chrome vs Edge ya reunida) y
reintentar en Chrome cuando Meta cierre el open beta.

**Portal de Proveedores — arranca con su prerequisito de identidad (migs 387/387b/387c, APLICADAS Y
VERIFICADAS EN DEV, commit `deef2fc2`, `v1.188.0`)**: GO confirmó la decisión de negocio pendiente desde que
se escribió la sección "Alcance" (abajo) — una cuenta de proveedor puede vincularse a **VARIOS negocios
(tenants) distintos**, lo que rompe el supuesto de raíz de `public.users` (relación 1:1 con `tenant_id`).
Se comparó con GO 2 opciones y se eligió **replicar el patrón YA EXISTENTE de identidad cross-tenant del
proyecto** (`support_agents`, usado por el panel genesis360-admin) en vez de forzar el modelo de `users`:
- `proveedor_accounts` (identidad, FK física a `auth.users`, email único case-insensitive) +
  `proveedor_account_tenants` (tabla puente, FK **compuesto** `tenant_id+proveedor_id` contra
  `proveedores(tenant_id, id)` — blinda a nivel DB que el proveedor vinculado pertenece de verdad a ese
  tenant).
- RLS: el proveedor solo ve/edita su propia identidad y sus propios vínculos — **sin INSERT/DELETE de
  cliente** (el alta real es un flujo de invitación server-side `SECURITY DEFINER` de una fase futura, sin
  construir todavía).
- `migration-reviewer` encontró **4 hallazgos bloqueantes reales** en la 1ª pasada de la 387 (FK física
  faltante a `auth.users`, no idempotente, policy de INSERT con squatting de email, `GRANT` a `anon` en vez
  de `REVOKE`) — corregidos y re-verificada APTA en la 2ª pasada.
- **Alcance explícitamente NO incluido todavía**: el flujo de invitación/alta de cuentas, ni las policies
  sobre `ordenes_compra`/presupuestos que le darían al proveedor acceso a sus cotizaciones reales (depende
  de diseñar la integración al state machine real de OC — Fede: "sigue el flujo YA EXISTENTE de OC",
  revisar `ordenes_compra` en detalle en una fase siguiente).

De paso, migración **386** (prerequisito técnico de **Supervisión**, no de WhatsApp) también quedó aplicada
en DEV en la misma sesión — ver [[wiki/features/supervision]] → "Retrofit a más módulos".

**Estado**: commit `deef2fc2`, `origin/dev`, `APP_VERSION` `v1.188.0`, tag+release publicados
(https://github.com/genesis360-app/genesis360/releases/tag/v1.188.0). Build verde. **Sin deploy a PROD** —
PROD sigue en migraciones 001-385; DEV en 001-387c.

> **🆕 2026-09-01 (v1.195.0): Portal de Proveedores se movió a su propia página** —
> [[wiki/features/portal-proveedores]] — al construirse la Fase 2 (invitación real + acceso a OC + UI del
> portal + UI de "aplicar propuesta" del lado staff, mig 390) el tema ya no es "un prerequisito de
> WhatsApp", es una feature completa con entidad propia. Este documento conserva el origen compartido
> (propuesta de Fede) y el historial de la Fase 1 (identidad, mig 387) tal cual — el detalle técnico nuevo
> vive en la página dedicada.

Detalle completo: `log.md` (2026-08-31, tipo `update`, entrada al principio), `sources/raw/
project_pendientes.md` ("ARRANCÁ ACÁ", cont. 34), `wiki/database/migraciones.md` (386-387c).

---

## Estado (2026-08-28, MISMA conversación que la sesión de abajo, sin `/clear`) — 🛑 Embedded Signup: CÓDIGO VALIDADO, bloqueado por Verificación del Negocio de Meta (trámite EXTERNO de Fede)

Continuación DIRECTA de la sesión de abajo (v1.185.0, sin `/clear`) — GO trajo los datos reales de Meta
(App ID, `config_id`) y se probó en vivo durante horas, con screenshots ida y vuelta. **Conclusión
definitiva, corrige lo que la sección de abajo daba como "diferido, no bloqueante"**: la Verificación del
Negocio de Meta SÍ bloquea completamente el registro real de un WABA, incluso con la propia cuenta admin
de GO — no es algo que se resuelva con código.

**Setup real armado en el dashboard de Meta**: App ID `1059640186689341`; Configuration creada con la
plantilla **"Configuración de registro insertado de WhatsApp con un token que caduca en 60 días"** (la
única que ofrece WhatsApp como activo — el wizard en blanco no lo ofrece), `config_id`
`1359336659241551`. **Esto fuerza el token a 60 días** — no existe "Nunca expira" para el sabor WhatsApp de
Configuration (sí para el genérico, que no sirve). Cuando esto funcione, va a hacer falta el mismo patrón
UI que MercadoLibre ("Token vencido — reconectá") en vez de refresh silencioso.

**Hallazgo #1 (pista falsa, DESCARTADA)**: en Chrome, **FedCM** (Federated Credential Management)
interceptaba el popup de `FB.login()` antes de que llegara a Meta, pisando `config_id` y produciendo un
error de permiso `openid` engañoso ("Esta app necesita al menos un supported permission"). Confirmado que
NO era el problema real probando en Microsoft Edge, donde la URL del popup traía todos los parámetros
correctos — el código de Genesis360 estaba bien. **Pendiente real para producción** (la mayoría de usuarios
va a estar en Chrome), no investigado a fondo hoy.

**Hallazgo #2 (LA CAUSA RAÍZ REAL, confirmada por triplicado)**: en Edge, el login llegaba hasta el diálogo
real de Meta pero mostraba "Genesis360 no puede registrar clientes en este momento" — idéntico probando 3
caminos distintos: el popup de nuestro código (JS SDK), el link "Registro insertado alojado por Meta"
(página hosteada por Meta, mismo flujo sin código nuestro), y ambos con/sin "Editar configuración" al
preguntar si continuar con la configuración anterior. Causa raíz literal, en "Estado del negocio y la app"
de Meta: **"Complete business verification to get started. You will not be able to onboard users until
you complete business verification."** Documentos que pide Meta para Argentina: Constancia de Inscripción
Fiscal (CUIT/RUT AFIP actualizada) + comprobante de domicilio del negocio (factura de servicios o extracto
bancario reciente). El panel dice literalmente "Verificar Federico Messina" — el Business Portfolio de
Genesis360 en Meta está atado al nombre de **Fede**, no al de GO. **100% trámite EXTERNO, depende de que
Fede aporte esos documentos — no se resuelve con código ni en esta sesión.**

**Código: sin bugs, un fix defensivo agregado.** El código (EF + frontend) funcionó igual en los 3 caminos
de prueba del Hallazgo #2. Se agregó un **timeout de 3 minutos** en `iniciarConexionWhatsapp`
(`src/lib/metaEmbeddedSignup.ts`): sin Verificación del Negocio, Meta le da a `FB.login()` un `code` válido
(`status:'connected'`) pero JAMÁS manda el postMessage `WA_EMBEDDED_SIGNUP` con `waba_id`/
`phone_number_id` — antes de este fix, el botón "Conectando..." quedaba colgado para siempre sin ningún
error (reproducido y confirmado con logs de diagnóstico temporales, agregados y luego sacados). Ahora
libera solo con un toast: "Meta no completó la conexión — probablemente falta la Verificación del Negocio
en el dashboard de Meta".

**Otros hallazgos operativos** (para no repetir la excavación): la PWA cachea agresivamente el JS con el
Service Worker — fix real: DevTools → "Application" → "Storage" → "Clear site data", recién ahí recargar.
Y se descubrió que **`npm run lint` está roto en TODO el repo** — no existe archivo de configuración de
ESLint (ni `.eslintrc*` ni `eslint.config.*`) pese a tener las dependencias instaladas, preexistente (no
roto hoy); nadie lo había notado porque corridas previas estaban filtradas con grep y ocultaban el fallo.
El gate real que sí funciona es `npm run build`.

**Estado**: commits `395bcde7` → `999dabdd` → `7e564c5e`, `origin/dev`, `APP_VERSION` `v1.186.0`, tag+
release ya publicados (`publishedAt: 2026-08-28T05:34:20Z`), deployado a Supabase Edge Functions de DEV.
Build/typecheck verdes. **Sin deploy a PROD.**

**🛑 Pendiente real y bloqueante**:
1. **Fede tiene que aportar CUIT/monotributo + comprobante de domicilio** para completar la Verificación
   del Negocio en Meta — 100% externo, ya se agotó lo que se podía diagnosticar/codear de nuestro lado.
2. Probablemente también haga falta "Revisión de la app" (App Review, video de evidencia) antes de
   producción real con clientes ajenos — sin confirmar si bloquea también las pruebas con la cuenta admin
   una vez resuelto el punto 1.
3. ~~Fix de Chrome/FedCM (Hallazgo #1) sigue sin resolver.~~ **Investigado a fondo el 2026-08-31 (ver
   sección "Estado (2026-08-31...)" al principio de la página) — sin fix de código posible de nuestro
   lado, pendiente que GO reporte el bug a Meta.**
4. ~~`npm run lint` roto (sin archivo de configuración) — no bloqueante, pendiente de arreglar cuando haya
   tiempo.~~ **✅ Resuelto 2026-08-31 (v1.187.0) — ver [[wiki/development/convenciones-codigo]].**

Detalle completo: `log.md` (2026-08-28, tipo `update`, entrada al principio), `sources/raw/
project_pendientes.md` ("ARRANCÁ ACÁ", cont. 32), `wiki/index.md` (fila + footer), `wiki/business/
roadmap.md` (mención breve).

---

## Estado (2026-08-27, sesión previa, MISMA conversación que la de arriba) — 📱🔌 Embedded Signup de Meta CONSTRUIDO EN DEV (v1.185.0) — ⚠ ver sección de arriba, corrige el punto sobre Business Verification

**Sesión nueva (post-`/clear`)**, separada de la sesión de deploy a PROD de la sección de abajo. Con las 4
fases del asistente ya EN PROD (dormidas), este es el mecanismo pensado justo para destrabar esa siesta:
**Embedded Signup**, el flujo oficial de Meta para que cada dueño de negocio conecte su propio WhatsApp
desde un popup embebido dentro de Genesis360, sin repetir el trámite manual que hizo GO a mano — ver
"Trámite real de Meta hecho por GO" más abajo.

**Código commiteado y pusheado a `origin/dev`** (commit `7c1e1a45`, `APP_VERSION` `v1.185.0`, tag+release
publicados) y **deployado a Supabase Edge Functions de DEV** (`gcmhzdedrkmmzfzfveig`) — **NO a PROD**. Sin
migración nueva (el schema de `whatsapp_credentials`, mig 382, ya alcanzaba). Detalle técnico completo en
"Embedded Signup" más abajo (sección reescrita esta sesión — corrige una especulación de la sesión
anterior sobre el modelo de token).

**🛑 Bloqueado para probar de punta a punta**: falta que GO complete 5 pasos en el dashboard de Meta
(alta del producto "Facebook Login for Business", Configuration con Token Expiration "Never expire",
`config_id` + App ID) — ver "Pendiente de GO para continuar" al final de esta página. typecheck + build +
lint verdes (⚠ corregido en la sesión de arriba: `npm run lint` no tiene config en TODO el repo, ese
"lint verde" nunca corrió de verdad — ver `npm run build` como gate real); sin verificación end-to-end (no
hay `config_id`/App ID reales cargados todavía) — **✅ esto ya se resolvió y se probó en la sesión de
arriba (2026-08-28): el código está validado, lo que falta es 100% externo (Meta).**

Detalle completo: `log.md` (2026-08-27, tipo `update`, entrada al principio), `sources/raw/
project_pendientes.md` ("ARRANCÁ ACÁ", cont. 31, ahora histórico), [[wiki/architecture/edge-functions]] (EF
nueva `wa-embedded-signup-exchange`).

---

## Estado (2026-08-27 — 🚀 DEPLOY REAL A PROD, sesión aparte de la que construyó las 4 fases)

**✅ EN PROD desde el 2026-08-27**, DORMIDA a propósito. El deploy que promovió TODO lo acumulado en `dev`
desde el último release real (`v1.179.2`, 2026-08-24) a `main` incluyó, entre otras cosas, las 4 fases
completas de este Asistente: PR #334 ("v1.184.0 — Compras/Gastos en USD (Fases 1-3) + Asistente WhatsApp IA
(Fases 1-4)"), merge commit `867d651a`, migraciones 382-385 aplicadas y verificadas en PROD
(`jjffnbrdjchquexdfgwq`) una por una con queries reales, Edge Functions `wa-webhook` y `wa-briefing-sweep`
deployadas a PROD (`verify_jwt: false`, mismo código exacto que DEV).

**Verificado que queda DORMIDA, sin activar nada para nadie**: PROD tiene 9 tenants, todos de prueba de GO
(confirmado por query real a `tenants` — ninguno es cliente real pagando; ⚠ "Familia Otranto De Porto" en
PROD es OTRO tenant de prueba de GO, UUID `5f05f3eb-...`, DISTINTO del tenant de DEV con el mismo nombre,
UUID `4cf85bbb-...` — no confundir). `whatsapp_credentials` en PROD tiene **0 filas** — sanity-check real
con curl a `wa-briefing-sweep` en PROD confirmó `{"ok":true,"motivo":"sin tenants con numero_notificaciones
configurado"}`. El cron de GitHub Actions (`wa-briefing-sweep.yml`, ya mergeado a `main`) **SÍ va a empezar
a correr de verdad cada 15 min contra PROD desde ahora** (los sweeps de GitHub Actions de este proyecto
siempre apuntan a PROD), pero sin filas que matcheen no hace nada.

**Pendiente para la próxima sesión, a decidir por GO** (no resuelto acá): con las 4 fases ya en PROD, el
próximo paso lógico es **Embedded Signup** (escalar a futuros clientes sin repetir el trámite manual) o el
**Portal de Proveedores** (la otra mitad de la propuesta de Fede) — ver "Alcance" más abajo.

Detalle completo del evento de deploy: `log.md` (2026-08-27, tipo `deploy`), `sources/raw/
project_pendientes.md` ("ARRANCÁ ACÁ").

---

## Estado de construcción (2026-08-26/27, sesiones previas al deploy)

**Las 4 fases de la propuesta de Fede (25/8/2026) están construidas y COMMITEADAS Y PUSHEADAS a
`origin/dev`** (Fase 1: commit `8b297b32`, `APP_VERSION` `v1.181.0`; Fase 2: commit `9029f24b`,
`APP_VERSION` `v1.182.0`; Fase 3: commit `0364447a`, `APP_VERSION` `v1.183.0`; Fase 4: commit `2e5fbcdb`,
`APP_VERSION` `v1.184.0`; tag + GitHub release publicados para las 4). **✅ Ya EN PROD desde el 2026-08-27**
(ver sección de arriba) — lo que sigue de este bloque describe el estado tal como quedó documentado
mientras todavía vivía solo en DEV.

**Fases 1 y 2 verificadas end-to-end en DEV al 100%.** La **Fase 3 (fotos/audio) está verificada solo
PARCIALMENTE**: el ruteo por tipo de mensaje, la seguridad (firma HMAC) y la integración real con la API de
Meta (con el token real, solo con `media_id` sintéticos) sí se confirmaron con logs reales de la Edge
Function — pero el "happy path" completo (transcribir un audio real, extraer un gasto de una foto real) NO
se pudo probar de punta a punta porque requiere un mensaje entrante real de WhatsApp, y eso sigue bloqueado
por el mismo pendiente operativo de siempre (chip prepago dedicado) — ver "Fase 3" y "Pendiente de GO" más
abajo.

**La Fase 4 (briefing diario proactivo) también está verificada solo PARCIALMENTE**, pero por un motivo
distinto: todo el código (evaluación de horario por sucursal, armado del resumen, autenticación con Meta,
payload del template) se confirmó correcto contra la API real de Meta — lo único que falta es que Meta
apruebe las 2 plantillas nuevas (`briefing_apertura_dia`, `briefing_cierre_dia`), quedaron en estado
`PENDING` al cierre de la sesión, sin ETA — ver "Fase 4" más abajo.

Además, en la sesión del 2026-08-26 GO hizo el **trámite real de Meta** (número de prueba, no Business
Verification completa) y conectó el webhook de verdad — ver "Trámite real de Meta" más abajo. Sigue
bloqueado para recibir mensajes ENTRANTES reales por un pendiente operativo de GO (conseguir un chip
prepago dedicado), no por nada de código — ver "Pendiente de GO" al final. **Esto no aplica a la Fase 4**,
que es 100% saliente (business-initiated), no depende del chip dedicado.

## Arquitectura

```
Meta WhatsApp Cloud API
  └─ webhook (mensaje entrante) ──▶ EF wa-webhook (--no-verify-jwt)
       1. valida X-Hub-Signature-256 (BLOQUEANTE desde el día 1)
       2. resuelve tenant por phone_number_id (whatsapp_credentials)
       3. chequea idempotencia por message_id (whatsapp_mensajes_log)
       4a. mensaje de TEXTO → tool-calling con Claude Sonnet 5:
           - consultar_stock_precio (solo lectura, tabla productos) — Fase 1
           - proponer_gasto (arma BORRADOR en whatsapp_gastos_borrador, NUNCA escribe gastos) — Fase 2
       4b. mensaje de AUDIO (Fase 3) → descargarMediaWhatsapp() + transcribirAudioGroq() (Groq Whisper)
           → el texto transcripto reemplaza msg.text.body → mismo flujo que 4a, sin cambios en llamarClaude
       4c. mensaje de IMAGEN (Fase 3) → descargarMediaWhatsapp() → la imagen (+ caption) se manda como
           bloque de contenido multimodal a Claude Sonnet 5 en el mismo mensaje → mismo tool-calling que 4a
           (Claude decide si es un comprobante de gasto y llama a proponer_gasto con lo que pueda leer) →
           si hay proponer_gasto exitoso, la foto se sube a Storage y se linkea como comprobante_url
       4d. mensaje interactive/button_reply (Confirmar/Cancelar) → resuelve el borrador
           correspondiente (verifica que sea del tenant correcto, nunca confía solo en el id del botón)
       4e. video/documento/otros tipos → no soportado (mensaje explícito, distinto del anterior "no puedo
           leer fotos ni audios" — texto+audio+foto SÍ están soportados desde la Fase 3)
       5. responde al usuario por la API de WhatsApp (texto o botones interactivos) + loguea tokens in/out
```

**Camino aparte, para Fase 4 (business-initiated, sin webhook de entrada)**:

```
GitHub Actions (schedule: */15 * * * *) ──▶ EF wa-briefing-sweep (--no-verify-jwt)
  Por cada sucursal activa de un tenant con WhatsApp conectado + numero_notificaciones configurado:
    1. horaArgentinaActual() (mismo helper que repositores-cierre-dia-sweep)
    2. ¿ya pasó horario_apertura? → arma resumen de AYER (ventas + gastos) → enviarMensajePlantillaWhatsapp()
       con el template briefing_apertura_dia
    3. ¿ya pasó horario_cierre? → arma resumen de HOY (ventas + gastos) → enviarMensajePlantillaWhatsapp()
       con el template briefing_cierre_dia
    4. dedupe por whatsapp_mensajes_log — se escribe SOLO después de un envío exitoso a Meta (nunca antes),
       para que un fallo transitorio (ej. token vencido) permita reintentar en la corrida siguiente
```

## Fase 1 — Tablas (migración 382, `382_whatsapp_asistente_fase1.sql`)

Aplicada y verificada en DEV (`gcmhzdedrkmmzfzfveig`) primero; **✅ EN PROD desde el 2026-08-27** (PR #334,
merge commit `867d651a`), DORMIDA (0 filas en `whatsapp_credentials` en PROD — ver "Estado" arriba).

- **`whatsapp_credentials`** — mapea `phone_number_id` (el ID que Meta asigna al número del negocio) →
  `tenant_id`. **Sin `sucursal_id` a propósito**: el número de WhatsApp representa al negocio completo, no
  una sucursal puntual. Distinto del patrón genérico `(tenant_id, sucursal_id)` UNIQUE que usan las demás
  tablas `{integracion}_credentials` del proyecto (TN/MP/MELI) — ver nota de corrección en
  [[wiki/integrations/roadmap-apis]] §6.2, que había apuntado el diseño original con `sucursal_id`.
- **`whatsapp_mensajes_log`** — idempotencia por `message_id` de Meta (un webhook reentregado no se
  reprocesa) + tokens in/out por mensaje. Instrumentado desde el día 1 a propósito, para no tener que
  reconstruirlo cuando llegue la Sección G de la propuesta de Fede (medición de uso/facturación por tenant).

RLS en ambas tablas. `whatsapp_mensajes_log` **sin policies de usuario**, solo `service_role` — la EF
`wa-webhook` es la única que escribe.

**`migration-reviewer`: APTA, sin hallazgos bloqueantes.** 1 nota 🟡 no bloqueante y **heredada** (no nueva
de esta migración): las 4 tablas `*_credentials` del proyecto (TN/MP/MELI/WhatsApp) no restringen por rol
quién puede leer el `access_token` guardado — pendiente de hardening transversal a futuro, fuera del
alcance de esta fase.

## Fase 1 — Edge Function `wa-webhook` (solo lectura)

Deployada a DEV (`--no-verify-jwt` — WhatsApp no manda JWT de Supabase Auth, la seguridad la da la firma).

- **Valida `X-Hub-Signature-256` de forma BLOQUEANTE desde el día 1** — a diferencia del modo log-only en
  el que arrancó `mp-webhook` (ver [[wiki/integrations/mercado-pago]]), acá se decidió bloquear desde el
  principio porque es un canal nuevo de cara a clientes reales.
- Resuelve el tenant por `phone_number_id` contra `whatsapp_credentials`.
- Responde consultas de stock/precio con **Claude Sonnet 5** (Anthropic), vía una tool de **solo lectura**
  (`consultar_stock_precio` sobre `productos`).
- Handshake GET de verificación de Meta (`hub.verify_token`) contra `META_VERIFY_TOKEN`.

### Por qué Claude y no Groq

El chat web del "Plan IA" (`ai-assistant`) usa Groq gratis. Acá se descartó a propósito: Groq ya sacó
modelos del catálogo sin aviso una vez y rompió `ai-assistant` para TODOS los tenants en PROD (ver
[[wiki/features/asistente-ia]] → "🐛 Modelo Groq roto"). Este es un canal pago de cara a clientes reales
(no un widget de ayuda interna), así que se prefirió un proveedor con SLA/catálogo más estable.
`ANTHROPIC_API_KEY` ya existía como secret del proyecto (la usan `scan-product`/`scan-ticket`, ver
[[wiki/architecture/edge-functions]]) — no hubo que darla de alta.

### Por qué NO comparte código con `ai-assistant`

Decisión de diseño explícita: **no se tocó ni se comparte código** con `supabase/functions/ai-assistant`
(el motor del chat web del Plan IA, que sigue en PROD sin cambios).

- **Prompt distinto**: acá es Q&A de stock/precio; `ai-assistant` guía navegación de la app.
- **Modelo de auth distinto**: WhatsApp no manda JWT de Supabase Auth — la identidad del tenant se resuelve
  por `phone_number_id`, no por sesión de usuario.

La reutilización del Plan IA es de **patrón** (tool-calling + arquitectura defensiva: nunca aplicar
cambios sin confirmación, validar todo server-side, allowlist explícito), no de código literal.

### Secrets en DEV

- `META_VERIFY_TOKEN` — para el handshake GET de verificación del webhook.
- `META_APP_SECRET` — arrancó **TEMPORAL** (generado para poder probar antes de tener el valor real de la
  app de Meta). **Ya reemplazado por el App Secret REAL** (`Configuración de la app → Básica` del
  dashboard de Meta) al completar el trámite real — ver más abajo.
- Token de acceso de la API de WhatsApp: es el **TEMPORAL de 24hs** de la pantalla "Pruébalo" de Meta —
  **ya venció** al cierre de esta sesión. Falta un **System User** para un token permanente (pendiente de
  GO, ver "Pendiente de GO" más abajo).

## Fase 1 — Verificación end-to-end en DEV

Con credenciales de prueba (tenant "Familia Otranto De Porto", fila ficticia en `whatsapp_credentials`):

1. Payload sintético de WhatsApp firmado con HMAC real → **200 OK** → la tool se ejecutó → Claude respondió
   correctamente con datos reales de un producto de prueba (coincidió exacto con precio/stock real de la
   DB).
2. Reenviar el mismo mensaje (mismo `message_id`) → **NO se reprocesó** (idempotencia OK).
3. Firma inválida o ausente → **403** (rechazado).
4. Handshake GET de verificación de Meta con token correcto → **200 + eco del challenge**; con token
   incorrecto → **403**.

Los 4 checks de seguridad pasaron.

## Trámite real de Meta hecho por GO (después de la Fase 1)

GO hizo el alta real en Meta **en vivo, en esta misma sesión** — no fue Business Verification completa
(no tenía documentos de empresa a mano), sino el camino de **"número de prueba" (test number)** de Meta:
gratis, sin documentos, hasta 5 destinatarios verificados.

- **Bache al crear la primera app**: Meta tiró **"Business is not allowed to claim App — Your business is
  prohibited from advertising, including claiming apps"** sobre el Business Portfolio "Genesis360"
  (preexistente, no verificado). La app se creó igual pero quedó rota (sin caso de uso completo, "Tipo:
  Ninguno", WhatsApp no aparecía en su lista de productos). Se resolvió DESDE el **Centro de Seguridad**
  del portfolio en el dashboard de Meta (GO no detalló el paso exacto que lo destrabó). **Lección para el
  futuro**: si esto vuelve a pasar, crear la app de NUEVO desde cero en vez de reciclar una que arrancó
  rota — reintentar sobre la vieja no sirvió.
- Con el portfolio destrabado, se creó una app nueva limpia y el caso de uso "Conectarte con los clientes a
  través de WhatsApp" se completó bien, con el número de prueba de Meta asignado automáticamente.
- **Credenciales reales cargadas** en `whatsapp_credentials` (tenant "Familia Otranto De Porto", el mismo
  de prueba de la Fase 1): `phone_number_id: 1310489345478776`, `waba_id: 1778597536671078`, número de
  test `+1 555 668 2365`.
- **El webhook se conectó de VERDAD** en el dashboard de Meta (Callback URL de `wa-webhook` +
  `META_VERIFY_TOKEN`) — el handshake GET real de Meta llegó y se verificó OK (confirmado con logs de
  Supabase). Campo `messages` suscripto.
- **🛑 Bloqueador real encontrado**: GO mandó un WhatsApp real desde su celular al número de test — Meta lo
  marcó "entregado" pero `wa-webhook` nunca recibió nada (0 requests nuevos, confirmado con logs). Causa:
  el número de test de Meta, mientras no esté **"registrado"** (paso separado en el dashboard, pide un
  número de teléfono real para verificar por SMS/llamada), solo puede ENVIAR — no recibir. GO estuvo a
  punto de usar su celular personal de Chile para ese registro; **se lo frenó a tiempo** porque eso puede
  migrar/desvincular ese número de su uso normal de WhatsApp personal (riesgo real de perder chats/
  contactos). **Pendiente real: GO necesita un chip prepago barato DEDICADO** (no su línea de uso diario)
  para completar el registro y poder probar mensajes entrantes reales de punta a punta.
- Esto **no bloquea seguir construyendo** — todo lo demás (incluida toda la Fase 2, ver abajo) se sigue
  verificando con payloads sintéticos firmados con HMAC real contra `wa-webhook` directo, sin pasar por la
  entrega real de Meta.

## Embedded Signup — CONSTRUIDO EN DEV (2026-08-27, v1.185.0, commit `7c1e1a45`)

GO preguntó explícitamente si cada negocio nuevo que se sume a Genesis360 va a tener que repetir todo el
trámite manual de arriba. Investigado y confirmado contra la documentación oficial de Meta
(developers.facebook.com): **NO** — existe el flujo oficial **"Embedded Signup"**, diseñado para
plataformas SaaS como Genesis360, y esta sesión (nueva, post-`/clear`) lo construyó.

- El cliente conecta su WhatsApp desde DENTRO de la app de Genesis360 (popup de Meta embebido), sin pisar
  developers.facebook.com ni repetir nada de lo que hizo GO manualmente.
- Lo único que el cliente siempre va a necesitar (esto no lo elimina Embedded Signup, es restricción de
  WhatsApp en sí): un número de teléfono real DEDICADO — mismo motivo por el que se frenó a GO recién.

### 🔍 Hallazgo importante ANTES de codear — corrige lo que decía esta sección hasta el 2026-08-27

Se verificó el flujo contra la documentación OFICIAL vigente de Meta (developers.facebook.com, vía
WebFetch — no de memoria) y salieron 2 cosas que no eran obvias, y que cambiaron el diseño esperado
respecto de lo que esta sección decía antes:

1. **El token es PROPIO de cada cliente, no compartido de plataforma.** El que se guarda por tenant en
   `whatsapp_credentials.access_token` es un **"Business Integration System User access token"**, scoped a
   la WABA de ESE cliente — no un token único que Genesis360 comparte entre todos los tenants (como se
   había especulado antes de investigar el flujo real). Buena noticia: encaja perfecto con el schema
   existente (mismo `whatsapp_credentials`, `onConflict: tenant_id`), **sin migración nueva**. Este token
   puede quedar **NO-expirante** si, al crear la Configuration de "Facebook Login for Business" en el
   dashboard de Meta, se elige **"Token Expiration: Never expire"** en vez del default de 60 días — esto
   resuelve de una vez el pendiente recurrente de "token permanente de Meta" que venía arrastrándose desde
   la Fase 1 (ver "Pendiente de GO para continuar" al final).
2. **Genesis360 NO factura centralizado el consumo de Meta de sus clientes.** Al ser "Tech Provider" (no
   "Solution Partner"), cada cliente conectado debe agregar su propio método de pago en WhatsApp Manager
   (`business.facebook.com/wa/manage/home/`) después de conectar — Meta no lo expone por API, no se puede
   automatizar. Importa antes del **1° de octubre de 2026**, cuando Meta empieza a cobrar todo mensaje
   saliente. Quedó como nota fija en la UI de la card "WhatsApp" tras conectar.
3. ~~**La "Proveedor de tecnología" (Business Verification) NO bloquea probar el flujo** — para probar en
   Development Mode alcanza con ser admin/tester de la Meta App existente, no hace falta Business
   Verification; diferido, no bloqueante ahora.~~ **🔴 INCORRECTO — corregido el 2026-08-28 (sesión
   siguiente, misma conversación, sin `/clear`)**: probado en la práctica con datos reales de Meta que SÍ
   bloquea COMPLETAMENTE el registro real de un WABA, incluso con la propia cuenta admin de GO — Meta
   muestra "Genesis360 no puede registrar clientes en este momento" hasta completar la Verificación del
   Negocio (documentos: CUIT/RUT AFIP + comprobante de domicilio, aportados por Fede — 100% externo). Ver
   "Estado (2026-08-28...)" al principio de esta página para el detalle completo (3 caminos de prueba,
   evidencia real).
   - **Límite real con impacto de negocio, una vez verificada la plataforma**: sin Business Verification se
     pueden onboardear hasta **10 negocios nuevos por semana**; verificada, sube a **200/semana**. Este dato
     sigue vigente, pero ya no es el punto relevante hoy — hoy el bloqueo es TOTAL, no un límite de ritmo.

### Código nuevo

1. **`supabase/functions/wa-embedded-signup-exchange/index.ts`** (EF nueva, `verify_jwt: true` — a
   diferencia de `wa-webhook`, que no lleva JWT porque la invoca Meta directamente; esta la invoca un
   usuario logueado de Genesis360 desde el frontend, no Meta). Guard de identidad: JWT → `auth.getUser` →
   verifica que el usuario pertenece al `tenant_id` recibido (mismo patrón que `generar-csr`, ver
   [[wiki/features/multi-cuit]]). Recibe `{tenant_id, code, waba_id, phone_number_id}` del popup de Meta y
   hace, en orden:
   - (a) intercambia el `code` por el "Business Integration System User access token" propio de ESE
     cliente vía `GET /oauth/access_token`;
   - (b) `POST /{phone_number_id}/register` con un PIN random de 6 dígitos (tolera "ya registrado" como
     éxito, para reconexiones);
   - (c) `POST /{waba_id}/subscribed_apps` para que `wa-webhook` reciba los mensajes de ese WABA;
   - (d) upsert en `whatsapp_credentials` (mig 382, `onConflict: tenant_id`) con ese token — **sin
     migración nueva**, el schema ya alcanzaba.
2. **`src/lib/metaEmbeddedSignup.ts`** (helper nuevo): carga perezosa del JS SDK de Facebook + `FB.init` +
   `FB.login()` con `config_id`. Combina 2 fuentes async que Meta no garantiza en el mismo tick: el `code`
   (callback de `FB.login`) y `waba_id`/`phone_number_id` (evento `FINISH` de un postMessage
   `WA_EMBEDDED_SIGNUP`).
3. **Card "WhatsApp" nueva en `src/pages/ConfigPage.tsx`** (tab Conectividad → Integraciones, mismo estilo
   que las cards de TiendaNube/MercadoLibre que ya existían ahí) — a diferencia de esas 2 (que son por
   sucursal, con loop de sucursales), esta es **ÚNICA por tenant**, porque `whatsapp_credentials` es a
   nivel negocio completo, sin `sucursal_id` (mig 382, ver "Fase 1 — Tablas" arriba). Usa 2 env vars nuevas
   del frontend: `VITE_META_APP_ID` y `VITE_META_WA_CONFIG_ID` (mismo aviso ámbar "falta configurar" que ya
   usa TiendaNube cuando falta su App ID). Botón Desconectar hace DELETE de la fila (mismo patrón que
   TiendaNube) — no hizo falta tocar `wa-webhook`/`wa-briefing-sweep`, ya filtran `conectado=true`.

### Setup pendiente en el dashboard de Meta — bloqueante para probar (tarea de GO)

Sobre la MISMA Meta App que ya usa `wa-webhook` (no una app nueva):

1. Agregar el producto **"Facebook Login for Business"** a la app.
2. Facebook Login for Business → Configurations → Create configuration → tipo **WhatsApp Embedded
   Signup**, Business = el Business Portfolio de Genesis360, **Token Expiration → "Never expire"**
   (crítico, no dejar el default de 60 días). Copiar el `config_id` resultante.
3. Copiar el **App ID** (dato público, visible en el dashboard).
4. En esa Configuration → Settings → **"Allowed Domains for the JavaScript SDK"**: agregar `localhost`
   (para probar en DEV) + el dominio de producción/Vercel. No hace falta un OAuth Redirect URI clásico — es
   un flujo de popup vía JS SDK, no un redirect de página completa como usan TiendaNube/MercadoLibre.
5. GO le pasa a Claude el `config_id` + App ID cuando los tenga, para cargarlos como
   `VITE_META_APP_ID`/`VITE_META_WA_CONFIG_ID` (frontend, Vercel env vars) y `META_APP_ID` (secret nuevo en
   Supabase, junto al `META_APP_SECRET` que ya existe de la Fase 1).
6. ~~Diferido, NO bloquea probar en Development Mode: convertirse en "Tech Provider" ante Meta (Business
   Verification con documentos)~~ **🔴 INCORRECTO — corregido el 2026-08-28**: SÍ bloquea, ver punto 3 del
   hallazgo arriba (ya corregido) y "Estado (2026-08-28...)" al principio de la página.

### Estado y verificación

**✅ Actualizado — ver "Estado (2026-08-28...)" al principio de esta página para el detalle completo.**
GO completó los 5 pasos de arriba con datos reales de Meta (App ID `1059640186689341`, `config_id`
`1359336659241551`) y se probó end-to-end: el **código quedó validado como correcto** (confirmado por 3
caminos de prueba distintos), pero el registro real de un WABA sigue bloqueado — no por el código, sino
por la Verificación del Negocio de Meta, pendiente de que Fede aporte documentos. `APP_VERSION` `v1.186.0`.
typecheck + build verdes (⚠ el "lint verde" original quedó cuestionado: `npm run lint` no tiene archivo de
configuración en todo el repo, nunca corrió de verdad).

## Fase 2 — cargar gastos como borrador (migración 383, `383_whatsapp_gastos_borrador.sql`)

Aplicada y verificada en DEV primero. Código commiteado y pusheado (commit `9029f24b`, `APP_VERSION`
`v1.182.0`, tag + release publicados). **✅ EN PROD desde el 2026-08-27** (PR #334, merge commit
`867d651a`), DORMIDA (mismo motivo que la Fase 1 — ver "Estado" arriba).

### Hallazgo clave ANTES de diseñar (evitó un error de REGLA #0)

Investigación real de `src/pages/GastosPage.tsx` (no se asumió nada): crear un gasto real en Genesis360 no
es un INSERT simple — dispara reglas de negocio encadenadas:
- Autorización por umbral de rol (`evaluarUmbralGasto`, bloquea si el monto supera el umbral del rol sin
  aprobación de un rol superior).
- CAJ-18 (bloquea el egreso si deja la caja en negativo).
- Comprobante obligatorio según 4 reglas combinables del tenant.
- Multi-CUIT (a qué emisor fiscal se imputa el IVA crédito).
- Período contable cerrado (bloquea ediciones de gastos viejos).

Reimplementar todo esto dentro del webhook de WhatsApp habría sido reinventar lógica fiscal ya probada, en
un contexto sin sesión de usuario real — justo el tipo de riesgo que la REGLA #0 del proyecto pide evitar.

### Decisión de diseño confirmada explícitamente por GO

El bot de WhatsApp **NUNCA escribe en la tabla `gastos`** — solo arma un BORRADOR, con 2 confirmaciones
separadas:
1. El **REMITENTE de WhatsApp** confirma con **botones interactivos NATIVOS de Meta** (✅ Confirmar /
   ❌ Cancelar — no texto libre tipo "SI", para evitar ambigüedad de interpretación del lenguaje).
2. Un **humano con acceso a Genesis360** (tab nuevo "WhatsApp" dentro del módulo Gastos, visible solo para
   roles DUEÑO/ADMIN/SUPERVISOR/SUPER_USUARIO) aprueba el borrador desde el MISMO modal "Nuevo Gasto" de
   siempre — precargado con lo que capturó el bot (descripción/monto/categoría/fecha), pasando por el
   mismo botón "Guardar" de siempre. **Cero duplicación de lógica fiscal**: la validación y creación real
   es exactamente la de siempre, con todas sus reglas ya probadas.

### Tabla `whatsapp_gastos_borrador`

4 estados:
1. `pendiente_confirmacion` — la IA propuso el gasto, esperando que el remitente toque "Confirmar".
2. `pendiente` — confirmado por WhatsApp, visible en la bandeja de revisión de la app.
3. `aprobado` — un humano lo aprobó desde el modal "Nuevo Gasto"; `gasto_id` linkeado.
4. `descartado` — rechazado en cualquiera de las 2 etapas.

RLS con **policy real de tenant** (`tenant_id IN (SELECT tenant_id FROM users WHERE id = (select
auth.uid()))`) — a diferencia de `whatsapp_mensajes_log` de la Fase 1 (solo `service_role`), esta tabla
**SÍ la toca el frontend con sesión de usuario real** (bandeja de revisión + Aprobar/Descartar). El gating
por rol queda en la UI, mismo criterio que `autorizaciones_gasto` (RLS = borde de tenant, rol = capa de
app).

**`migration-reviewer`: APTA**, con una corrección aplicada **antes** de aplicar (no bloqueante): envolver
`auth.uid()` en `(select auth.uid())` — la convención de performance de RLS que el proyecto ya estandarizó
en 2 migraciones dedicadas anteriores (263 y 366) y que esta migración nueva había reintroducido sin
querer.

### Cambios de código

- `supabase/functions/wa-webhook/index.ts`: nueva tool de IA `proponer_gasto` (arma el borrador, nunca
  escribe `gastos`), nueva función para mandar mensajes interactivos de WhatsApp (botones), y manejo de
  los mensajes entrantes de tipo `interactive`/`button_reply` (confirma o cancela el borrador
  correspondiente, verificando siempre que pertenezca al tenant correcto — nunca confía en el id del botón
  solo).
- `src/pages/GastosPage.tsx`: función nueva `abrirDesdeBorrador()` (calcada de `abrirCorreccion()`, que ya
  existía para precargar el modal desde un gasto existente) precarga el modal "Nuevo Gasto" con los datos
  del borrador. Al guardar con éxito, se agrega un paso adicional (sin tocar ninguna validación existente)
  que linkea el borrador al gasto recién creado y lo marca `aprobado`. Tab nuevo "WhatsApp" con badge de
  cantidad pendiente.
- `src/components/BandejaBorradoresWhatsapp.tsx` (nuevo componente): lista los borradores pendientes de
  revisión, con botones **Aprobar** (abre el modal precargado) y **Descartar** (rechaza directo, sin crear
  nada).

### Verificado end-to-end en DEV

- Por curl con firma HMAC real contra `wa-webhook` directo: mensaje sintético "gasté 5000 en nafta" → la
  IA (Claude Sonnet 5) parseó correctamente descripción="Nafta", monto=5000, categoría="Combustible" →
  borrador creado. Botón "Confirmar" sintético → pasó a estado `pendiente`. Reenviar el mismo botón →
  detectado correctamente como ya resuelto (idempotencia por estado del borrador, no solo por id de
  mensaje de WhatsApp). Segundo borrador + botón "Cancelar" → quedó `descartado`, sin crear nada.
- Del lado del frontend, con un test real de Playwright (no solo curl): se sembró un borrador para el
  tenant que usa la suite de tests automatizados (RLS lo aisló correctamente del tenant de prueba de
  WhatsApp — confirmación extra de que el aislamiento por tenant funciona), se abrió el tab "WhatsApp"
  nuevo, "Aprobar" abrió el modal correctamente precargado, se completó el medio de pago (Efectivo) y al
  guardar se creó el gasto real CON su movimiento de caja correspondiente (egreso $5000, estado de pago
  "pagado"), y el borrador quedó correctamente linkeado al gasto real y marcado como aprobado. Los datos de
  esa prueba se borraron después para no ensuciar el tenant compartido de testing.
- La suite de tests automatizados existente de Gastos se corrió de nuevo después del cambio y no mostró
  ninguna regresión (6 de 6 tests pasaron).

## Fase 3 — fotos y audio (migración 384, `384_whatsapp_borrador_comprobante.sql`)

Sesión nueva (2026-08-27), arrancó directo por pedido explícito de GO al cierre de la sesión anterior.
Código commiteado y pusheado (commit `0364447a`, `APP_VERSION` `v1.183.0`, tag + release publicados).

### Decisión técnica clave

Audio y fotos son solo formas NUEVAS de llegar al **mismo pipeline** ya construido y probado en las Fases
1-2 (`llamarClaude` + tool `proponer_gasto` + doble confirmación) — cero lógica fiscal nueva, mismo
principio de REGLA #0.

### Audio → Groq Whisper

Se descarga el archivo real desde la API de medios de Meta (`GET /{media-id}` → URL temporal → descarga con
el mismo Bearer token) y se transcribe con **Groq Whisper** (`whisper-large-v3-turbo`, endpoint
`https://api.groq.com/openai/v1/audio/transcriptions`, `language: 'es'`) — reusa el secret `GROQ_API_KEY`
que **ya existía** en el proyecto (lo usa `ai-assistant` para el chat web), cero trámite nuevo.

**Decisión tomada con GO en esta sesión**: se prefirió Groq (reutiliza credencial existente, radio de
impacto chico si falla — solo afecta la transcripción, no el "cerebro" que sigue siendo Claude) por sobre
**OpenAI Whisper** (la sugerencia original de Fede del 25/8, que hubiera requerido dar de alta una
cuenta/secret nuevo). El texto transcripto reemplaza a `msg.text.body` — **CERO cambios** en la función
`llamarClaude` para este caso.

> ⚠ Distinto del caso de Fase 1, donde Groq se había descartado A PROPÓSITO para el "cerebro" del asistente
> (ver "Por qué Claude y no Groq" arriba, y el incidente de catálogo de Groq en [[wiki/features/asistente-ia]]).
> Acá el uso es distinto y de menor radio de impacto: Groq solo transcribe texto, nunca decide ni ejecuta
> tools — si Groq fallara o descatalogara el modelo, se rompe solo la transcripción de audio, no las
> consultas de stock ni la carga de gastos por texto/foto.

### Fotos → Claude Sonnet 5 multimodal (sin pipeline nuevo)

En vez de armar una extracción separada (como hace `scan-ticket`), se aprovechó que Claude Sonnet 5 ya es
multimodal — la imagen (+ caption si tiene) se manda como bloque de contenido en el **mismo mensaje** a
Claude, que decide solo si es un comprobante de gasto y llama a `proponer_gasto` con lo que pueda leer
(descripción/monto/categoría/fecha). Esto solo requirió cambiar el tipo del parámetro de `llamarClaude` de
`string` a `string | any[]` — mismo tool, mismo loop, cero pipeline nuevo.

### Comprobante adjunto (columna `comprobante_url`, migración 384)

Cuando la propuesta viene de una FOTO, esa misma foto se sube a Storage (`comprobantes-gastos`, mismo
bucket que usa `GastosPage.tsx`) con path `{tenant_id}/wa-{borrador_id}.{ext}`, y se linkea al borrador vía
la columna nueva `comprobante_url`. Así, cuando un humano aprueba el borrador, el modal "Nuevo Gasto" ya lo
trae **precargado como comprobante** (`GastosPage.tsx` → `abrirDesdeBorrador`), sin pedir la foto de nuevo —
y sin romper la regla de "comprobante obligatorio" del tenant si aplica. Si la subida falla, **nunca
bloquea** el borrador ya creado (queda `NULL`, se puede subir a mano después).

**Migración 384**: `ALTER TABLE whatsapp_gastos_borrador ADD COLUMN IF NOT EXISTS comprobante_url TEXT`.
`migration-reviewer`: **APTA sin correcciones**. ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`)
vía `apply_migration` MCP (confirmado con query real de `information_schema.columns`).

### Cambios de código

- `supabase/functions/wa-webhook/index.ts`:
  - `descargarMediaWhatsapp(mediaId, accessToken)` — helper único para audio e imagen: resuelve el
    media_id de Meta a una URL temporal (`GET /{media-id}` con Bearer token) y descarga los bytes de esa
    URL (mismo token).
  - `transcribirAudioGroq(bytes, mimeType, groqApiKey)` — llama a Groq Whisper, `language: 'es'`.
  - Loop principal: switch sobre `msg.type` (texto/audio/imagen/no-soportado) que converge en el mismo
    `userContent` que alimenta a `llamarClaude`. El fallback de "no soportado" ahora es más específico
    (video/documento/etc.) ya que texto+audio+foto SÍ están soportados.
  - Bloque de éxito de `proponer_gasto`: si la propuesta vino de una foto, sube el archivo a Storage y
    actualiza `comprobante_url` del borrador (nunca bloqueante si falla).
  - System prompt actualizado: ya no dice "no puedo leer fotos ni audios" — ahora explica que puede usar
    `proponer_gasto` con lo que lea de una foto de comprobante, y que si la foto no es un gasto debe
    explicar qué ve.
- `src/pages/GastosPage.tsx` → `abrirDesdeBorrador(b)`: ahora precarga `comprobanteExistente` desde
  `b.comprobante_url` (antes siempre `null`) — mismo mecanismo que ya usaba `abrirCorreccion` para gastos
  existentes.
- `src/components/BandejaBorradoresWhatsapp.tsx`: nuevo indicador "Ver foto" (ícono `Image` de
  lucide-react) cuando el borrador tiene `comprobante_url`, con signed URL — mismo patrón que
  `verComprobante()` de `GastosPage.tsx`.

### Deploy y verificación en DEV (PARCIAL — ver limitación abajo)

`wa-webhook` deployado a DEV vía `deploy_edge_function` MCP (versión 5, `verify_jwt: false`, ACTIVE). GO
refrescó el `access_token` temporal de Meta (pantalla "Pruébalo", dura 24hs) y se cargó en
`whatsapp_credentials` para el tenant de prueba ("Familia Otranto De Porto").

Verificado con requests sintéticos firmados con HMAC real (`X-Hub-Signature-256`) contra `wa-webhook`
directo, con `media_id` inventados para audio/imagen: confirmado en los logs reales de la Edge Function
(`query_logs`) que:
1. La firma se validó.
2. El ruteo por tipo de mensaje funcionó correctamente para los 4 casos (texto/audio/imagen/video-no-soportado).
3. Para audio e imagen, el código llamó de verdad a la API de Meta con el token fresco y recibió el error
   real **"Object with ID ... does not exist"** (NO un error de autenticación) — esto confirma que el
   token refrescado es válido y que el código arma bien la request.
4. El fallback de error se disparó correctamente en cada caso e intentó responder por WhatsApp (rechazado
   por Meta con "Recipient phone number not in allowed list" porque el número de prueba usado en el test
   sintético no está en la lista de destinatarios verificados — resultado esperado, no un bug).

**🛑 Limitación real, IMPORTANTE para la próxima sesión**: a diferencia de Fases 1-2 (que se probaron 100%
sintéticamente porque solo usaban texto), el "happy path" completo de audio/foto (transcripción real de un
audio real, extracción real de un gasto desde una foto real) **no se pudo verificar de punta a punta**
porque requiere un `media_id` REAL de Meta, que solo existe si un mensaje real llegó al número — y eso
sigue bloqueado por el mismo motivo de siempre: el número de test de Meta no está "registrado" para RECIBIR
mensajes (falta el chip prepago dedicado, ver "Pendiente de GO" abajo). **Refrescar el token de acceso NO
destraba esto** — el token solo autentica lo que Genesis360 le pide a Meta (bajar medios, mandar mensajes),
no si Meta nos entrega el webhook de un mensaje entrante real. Esta limitación quedó confirmada
explícitamente en esta sesión (antes no estaba tan claro que fuera un bloqueador distinto del de Fase 1).

Build + typecheck (`npm run build`) limpios. Suite e2e de Gastos sin regresión: `06_gastos.spec.ts` (4/4) +
`68_gasto_comprobante_obligatorio_mutante.spec.ts` (1 skip, no relacionado a este cambio) — 5 passed, 1
skipped.

## Fase 4 — briefing diario proactivo (migración 385, `385_whatsapp_briefing_numero_notificaciones.sql`)

Misma sesión que la Fase 3 (2026-08-27), continuó directo por pedido explícito de GO ("dejar casi todo
listo" del asistente). Código commiteado y pusheado (commit `2e5fbcdb`, `APP_VERSION` `v1.184.0`, tag +
release publicados). **Con esta fase, las 4 fases de la propuesta de Fede (25/8) quedan construidas en
DEV.**

### Contexto de negocio (Sección F de la propuesta de Fede)

Notificaciones proactivas: un briefing diario de apertura y cierre, SOLO al dueño, por plantilla
pre-aprobada de Meta (categoría utilidad) — no es un chat, es un mensaje que Genesis360 inicia sin que el
dueño haya escrito antes.

### Diferencia cualitativa clave con Fases 1-3

En las Fases 1-3 el bot siempre RESPONDÍA dentro de una conversación que el usuario abría primero (texto
libre, ventana de 24hs gratis de Meta). Un mensaje **business-initiated** (nadie escribió primero) exige un
**message template pre-aprobado por Meta** — no se puede mandar texto libre. Esa aprobación es 100% externa
a Genesis360; no se puede acelerar ni controlar desde el código.

### Investigación previa al diseño (evitó reinventar nada)

El proyecto **no tiene pg_cron ni pg_net habilitados**. El patrón real y único para tareas periódicas es
**GitHub Actions con `schedule:`** pegándole por curl a una Edge Function — se clonó casi 1:1 el molde de
`repositores-cierre-dia-sweep` (ver [[wiki/features/repositores]] → "Notificaciones (J)"): mismo criterio
de **cron cada 15 minutos** (el horario es configurable por sucursal, no hay cron por-fila) y misma función
`horaArgentinaActual()` (`Intl.DateTimeFormat` sobre `America/Argentina/Buenos_Aires`). Se reusaron las
columnas `sucursales.horario_apertura`/`horario_cierre` (ya existían desde la mig 124, **sin migración
nueva para esto**) con defaults `09:00`/`21:00`.

### Gap real encontrado — `numero_notificaciones`

No existía ninguna columna para "a qué número mandarle un mensaje proactivo": `whatsapp_credentials.
numero_whatsapp` (mig 382) es el número del NEGOCIO (WABA), documentado explícitamente como
"solo informativo/UI" — no sirve como destinatario de un mensaje al dueño.

### Migración 385

`ALTER TABLE whatsapp_credentials ADD COLUMN IF NOT EXISTS numero_notificaciones TEXT` + `COMMENT ON
COLUMN` documentando que es **PII** (número personal del dueño) y que no debe loguearse en texto plano.
`migration-reviewer`: **APTA**, con 2 notas no bloqueantes ya aplicadas (el `COMMENT ON COLUMN`, y
recordatorio de correr `npm run schema:dump` — no se pudo correr esta sesión, mismo bloqueador de siempre
del `SUPABASE_ACCESS_TOKEN` filtrado sin rotar). ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`)
vía `apply_migration` MCP. Se cargó el número de prueba (`+56975770883`, número real de GO, ya verificado
como destinatario de test en Meta) para el tenant "Familia Otranto De Porto".

### Código nuevo — `supabase/functions/wa-briefing-sweep/index.ts`

Edge Function nueva, autocontenida, sin carpeta `_shared/` (mismo criterio que el resto del proyecto). Por
cada sucursal activa de un tenant con WhatsApp conectado y `numero_notificaciones` configurado, evalúa POR
SEPARADO:
- Si ya pasó `horario_apertura` → arma y manda el resumen de AYER (template `briefing_apertura_dia`).
- Si ya pasó `horario_cierre` → arma y manda el resumen de HOY (template `briefing_cierre_dia`).

El resumen se arma con **queries directas**, NO con las vistas `vw_caja_resumen_diario` (esas solo se
llenan al cerrar una sesión de caja, no sirven para un corte en caliente a mitad de operación): `ventas`
con `estado IN ('despachada','facturada')` filtrado por sucursal y rango UTC del día Argentina, y `gastos`
con `fecha = {fechaISO}` (columna DATE, sin necesidad de ajuste de huso horario). Función nueva
`enviarMensajePlantillaWhatsapp()` (`type: 'template'`), distinta de las 2 funciones que ya tenía
`wa-webhook` para responder dentro de una conversación existente.

### 🛑 Bug de diseño encontrado y corregido EN esta sesión (dedupe insert-primero)

El dedupe vía `whatsapp_mensajes_log` inicialmente se escribía **ANTES** de intentar el envío — mismo
patrón "insert-primero" que usa `wa-webhook` para dedupear reintentos de ENTREGA de Meta. Se detectó como
un bug real al testear: un fallo transitorio (token vencido) dejaba esa sucursal marcada como "ya
procesada" sin haber mandado nada, **bloqueando el reintento** en las corridas siguientes del sweep ese
mismo día. **Corregido**: el registro de dedupe ahora se escribe RECIÉN cuando el envío a Meta sale bien
(chequeo por `SELECT` antes, `INSERT` después del éxito) — así un fallo transitorio permite reintentar en
la corrida de 15 minutos siguiente. El registro de dedupe mal insertado por el diseño viejo se borró a mano
antes de la segunda vuelta de verificación (ver abajo).

### GitHub Actions

`.github/workflows/wa-briefing-sweep.yml`, clon exacto del molde de `repositores-cierre-dia-sweep.yml`
(`schedule: '*/15 * * * *'` + `workflow_dispatch`). Como este trabajo queda en `dev` (sin merge a `main`),
el trigger `schedule:` de GitHub Actions **NO se dispara solo todavía** (esos triggers solo se evalúan
sobre el branch default del repo) — para probar en DEV se invocó la función manualmente por curl, igual
que se hizo con `wa-webhook` en la sesión de la Fase 1.

### Plantillas de Meta dadas de alta EN ESTA SESIÓN, vía API (no por el dashboard)

Usando el `access_token` vigente y el `waba_id` (`1778597536671078`), se creó `briefing_apertura_dia` y
`briefing_cierre_dia` (categoría `UTILITY` en la solicitud, idioma `es_AR`) vía `POST
/{waba_id}/message_templates`. Confirmado con `debug_token` que el token SÍ tenía permiso de gestión de
plantillas (`whatsapp_business_management`) — GO no tuvo que tocar el dashboard de Meta para esto.

**Hallazgo real, no controlado por nosotros**: Meta **reclasificó automáticamente** `briefing_cierre_dia`
de `UTILITY` a `MARKETING` durante su revisión (el clasificador de Meta decidió que el tono/contenido —
emojis, "¡buen descanso!" — encaja más ahí); `briefing_apertura_dia` se mantuvo en `UTILITY`. Esto no rompe
nada funcionalmente, pero cambia el costo por conversación y las reglas de entrega — **dato a sumar cuando
se diseñe la Sección G** de la propuesta de Fede (medición/facturación de uso). Ambas plantillas quedaron
con estado **`PENDING`** al cierre de la sesión (aprobación de Meta, tiempo fuera de nuestro control).

### Verificación real en DEV (2 vueltas, ambas evidencia real de que el código funciona)

1. **Primera invocación manual**: confirmó que la sucursal se evalúa bien y el horario se compara bien
   (hora Argentina real), pero el envío falló con error 401 de Meta — investigado con `debug_token`, causa
   real: el token de acceso temporal de Meta había vencido apenas 8 minutos antes (duró mucho menos que
   las 24hs esperadas). GO pasó un token nuevo.
2. **Con el token nuevo**: el error de autenticación desapareció, pero apareció uno nuevo y esperado —
   `(#132001) Template name does not exist in the translation` —, confirmado que es el comportamiento
   NORMAL de Meta para una plantilla `PENDING` (no aprobada): la API de envío la trata como si no existiera
   hasta que Meta la aprueba. Esto confirma que TODO el código (token, `phone_number_id`, nombre y
   `language` de la plantilla, estructura del payload) está correcto — lo único que falta es la aprobación
   de Meta, fuera de nuestro control.
3. El bug del dedupe (arriba) se corrigió entre la vuelta 1 y la vuelta 2, incluyendo borrar a mano el
   registro que había quedado mal insertado por el diseño viejo.

Build limpio (`npm run build`). Esta fase es 100% backend/infra (Edge Function + migración + GitHub
Actions) — no se tocó nada de `src/` salvo el bump de versión.

**✅ EN PROD desde el 2026-08-27** (PR #334, merge commit `867d651a`) — DORMIDA, sin tenants configurados
(ver "Estado" arriba para el detalle completo del deploy).

## Alcance

**Fase 1: SOLO LECTURA** (consultas de stock/precio) — ✅ construida y verificada end-to-end.
**Fase 2: cargar gastos como borrador con doble confirmación (texto)** — ✅ construida y verificada end-to-end.
**Fase 3: fotos y audio** — ✅ construida, ⚠ verificada solo PARCIALMENTE (ver sección dedicada arriba —
falta el happy path real, bloqueado por el chip prepago dedicado).
**Fase 4: briefing diario proactivo (apertura/cierre)** — ✅ construida, ⚠ verificada solo PARCIALMENTE (ver
sección dedicada arriba — todo el código confirmado correcto contra la API real de Meta, falta la
aprobación PENDIENTE de las 2 plantillas, tiempo fuera de nuestro control).

**Con esto, las 4 fases de la propuesta de Fede (25/8/2026) para el Asistente de WhatsApp quedan
construidas en DEV.** Sigue pendiente, ya conversado con Fede pero sin empezar:
- Medición de uso y facturación completa por tenant (Sección G de la propuesta de Fede) — `tokens in/out`
  ya se loguea desde la Fase 1 pensando en esto; sumar el dato nuevo de la Fase 4 (Meta puede reclasificar
  UTILITY→MARKETING un template ya escrito, afecta el costeo por conversación).
- **Embedded Signup** para que futuros clientes conecten su WhatsApp sin repetir el trámite manual de GO —
  **✅ CONSTRUIDO EN DEV** (2026-08-27, v1.185.0, commit `7c1e1a45`) y **✅ CÓDIGO VALIDADO end-to-end**
  (2026-08-28, v1.186.0, misma conversación sin `/clear`, ver "Estado (2026-08-28...)" al principio de esta
  página). **🛑 Business Verification de Genesis360 como plataforma SÍ bloquea, confirmado en la práctica**
  (corrige lo que decía esta sección hasta el 2026-08-27: NO es diferible, es la causa raíz real del
  bloqueo actual) — depende de que Fede aporte CUIT/monotributo + comprobante de domicilio, 100% trámite
  externo.

**Portal de Proveedores** (la otra mitad de la propuesta de Fede) — **🆕 2026-08-31: arranca con su
prerequisito de identidad construido y APLICADO EN DEV** (migs 387/387b/387c, `v1.188.0`, ver "Estado
(2026-08-31...)" al principio de la página). GO confirmó la decisión de negocio: una cuenta de proveedor
puede vincularse a VARIOS negocios (tenants) distintos — rompía el supuesto de raíz de `public.users`
(`tenant_id` único por fila); resuelto replicando el patrón YA EXISTENTE de identidad cross-tenant del
proyecto (`support_agents`) en vez de forzar el modelo de `users`: `proveedor_accounts` +
`proveedor_account_tenants`. **Todavía sin construir**: el flujo de invitación/alta de cuentas (Edge
Function `SECURITY DEFINER`) y las policies de `ordenes_compra`/presupuestos que le darían al proveedor
acceso a sus cotizaciones reales.

## Pendiente de GO para continuar (bloqueante para pasar de pruebas a real)

1. **Aprobación de Meta** de las 2 plantillas (`briefing_apertura_dia`, `briefing_cierre_dia`) — sin ETA,
   no depende de nosotros. Cuando se aprueben, re-invocar `wa-briefing-sweep` (o esperar la próxima
   corrida si esto llegara a estar en `main`) para confirmar el envío real de punta a punta de la Fase 4.
2. **Conseguir un chip prepago barato DEDICADO** (no la línea personal de GO) para completar el registro
   del número de test de Meta y poder probar mensajes ENTRANTES reales de punta a punta — ver "Trámite
   real de Meta" arriba. Es lo único que falta para cerrar la verificación end-to-end de la **Fase 3**
   (audio/foto) y de la Fase 1 (mensajes entrantes); **no aplica a la Fase 4**, que es 100% saliente.
3. **Token de acceso permanente**: el actual (tenant de prueba, Fases 1-4) es TEMPORAL (24hs) — se
   refrescó de nuevo en la sesión de la Fase 4 (2026-08-27). **Vía Embedded Signup (arriba) esto queda
   resuelto de raíz para clientes futuros**: cada cliente conectado por ese flujo obtiene su propio token,
   NO-expirante si la Configuration de Meta se crea con "Token Expiration: Never expire" — ver pasos 1-5 de
   "Setup pendiente en el dashboard de Meta" arriba. Para el tenant de prueba actual (fuera de Embedded
   Signup) sigue haciendo falta un **System User** si se lo quiere mantener sin refrescar a mano.
4. 🔴 Sigue sin resolver (recurrente hace varias sesiones, no específico de esta feature): rotar el
   `SUPABASE_ACCESS_TOKEN` filtrado (`sbp_60df…`, desde 2026-07-09). Sigue bloqueando el modo API de `npm
   run schema:dump` — **el archivo en sí SÍ está actualizado** (regenerado a mano vía MCP `execute_sql` en
   partes, última vez el 2026-08-31, incluye hasta la migración 387c), solo el comando automatizado sigue
   sin poder correr de punta a punta hasta que se rote el token.
5. **Sección G** (medición/facturación de uso) — sin empezar; sumar el dato nuevo de la sesión de la Fase 4
   (Meta puede reclasificar UTILITY→MARKETING un template ya escrito, afecta el costeo por conversación).
   El costo de Groq Whisper por audio (Fase 3) sigue sin trackear por ahora (prácticamente gratis),
   decisión consciente.
6. **Embedded Signup: código validado end-to-end (2026-08-28, v1.186.0)** — GO ya completó los 5 pasos del
   setup en el dashboard de Meta con datos reales (App ID `1059640186689341`, `config_id`
   `1359336659241551`); el código funciona correcto (confirmado por 3 caminos de prueba distintos). **🛑
   Bloqueante real y actual: la Verificación del Negocio de Meta**, 100% a cargo de Fede (CUIT/monotributo +
   comprobante de domicilio) — sin esto no se puede seguir probando el registro real de un WABA. ~~Además:
   fix de Chrome/FedCM pendiente (se probó en Edge)~~ **investigado a fondo el 2026-08-31, sin fix de código
   posible — ver "Estado (2026-08-31...)" al principio de la página**; y posible "Revisión de la app" (App
   Review) todavía sin confirmar tras resolver la Verificación del Negocio. El **Portal de Proveedores**
   (ver "Alcance" arriba) **arrancó el 2026-08-31** con su prerequisito de identidad construido en DEV
   (migs 387/387b/387c) — todavía sin flujo de invitación ni policies de `ordenes_compra`.

## Referencias

- [[wiki/features/asistente-ia]] — motor del chat web del Plan IA (patrón reusado, código separado); usa
  Groq para el chat (no para transcripción de audio, que es lo nuevo de la Fase 3 acá).
- [[wiki/features/repositores]] → "Notificaciones (J)" — molde real del que se clonó `wa-briefing-sweep`
  (`repositores-cierre-dia-sweep`, mismo patrón GitHub Actions `schedule:` cada 15 min).
- [[wiki/features/supervision]] → "Retrofit a más módulos" — mig 386 (prerequisito técnico, no
  relacionado con WhatsApp, aplicado en DEV la misma sesión del 2026-08-31 que el Portal de Proveedores).
- [[wiki/integrations/roadmap-apis]] §6.2 — visión original de WhatsApp Cloud API (notificaciones/carritos
  abandonados/CC), corregida para reflejar el esquema real de `whatsapp_credentials`.
- [[wiki/architecture/edge-functions]] — lista de Edge Functions, incluye `wa-webhook`, `wa-briefing-sweep`
  y `wa-embedded-signup-exchange` (nueva, 2026-08-27, solo DEV).
- `wiki/database/migraciones.md` — migraciones 382-385 EN PROD desde 2026-08-27; **386-387c APLICADAS Y
  VERIFICADAS EN DEV desde el 2026-08-31 (prerequisito de Supervisión + identidad del Portal de
  Proveedores), sin aplicar a PROD todavía**.
- `sources/raw/project_pendientes.md` (cont. 34, "ARRANCÁ ACÁ") — Chrome/FedCM investigado a fondo +
  identidad del Portal de Proveedores + prerequisito de Supervisión (2026-08-31); (cont. 33, histórico) —
  fix de `npm run lint` (v1.187.0, sin relación directa con WhatsApp); (cont. 32, histórico) — detalle
  completo de la validación end-to-end de Embedded Signup y del bloqueo real por Verificación del Negocio
  (2026-08-28); (cont. 31, histórico, con corrección inline) — construcción del código (2026-08-27); (cont.
  30, histórico) — detalle completo del deploy real a PROD (2026-08-27); (cont. 29) — detalle completo de
  la sesión de construcción de la Fase 4.
- `log.md` (2026-08-31, tipo `update`, entrada al principio) — Chrome/FedCM investigado + Portal de
  Proveedores + prerequisito de Supervisión; (2026-08-31, tipo `lint`) — fix de `npm run lint`; (2026-08-28,
  tipo `update`) — Embedded Signup validado end-to-end, bloqueo real por Verificación del Negocio;
  (2026-08-27, tipo `update`) — Embedded Signup CONSTRUIDO EN DEV; (2026-08-27, tipo `deploy`) — deploy real
  a PROD de las 4 fases; (2026-08-27, tipo `update` anterior) — entrada completa de la Fase 4 y de la Fase 3
  (misma sesión de construcción, sin `/clear`); (2026-08-26) — Fase 1, Fase 2, trámite real de Meta y el
  hallazgo original de Embedded Signup (parcialmente corregido el 2026-08-27, y corregido del todo el
  2026-08-28).
- `wiki/business/roadmap.md` — sección del deploy real a PROD (2026-08-27); footer actualizado con Chrome/
  FedCM investigado + Portal de Proveedores + prerequisito de Supervisión (v1.188.0).
