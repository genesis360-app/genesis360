---
name: asistente-whatsapp
description: Asistente de WhatsApp con IA para el DUEÑO de cada negocio — consultas de stock/precio (Fase 1) + carga de gastos como borrador con doble confirmación, ahora también por FOTO o AUDIO además de texto (Fases 2+3), vía Meta Cloud API + Claude Sonnet 5 (+ Groq Whisper para audio). Plan de 4 fases (propuesta de Fede, 25/8/2026). Fases 1+2+3 construidas y COMMITEADAS/PUSHEADAS a origin/dev (v1.181.0/v1.182.0/v1.183.0), SIN deploy a PROD. Fase 3 verificada solo PARCIALMENTE en DEV (el ruteo/seguridad sí, el happy path real de audio/foto todavía no — requiere un mensaje entrante real). Trámite real de Meta (número de prueba) conectado por GO el 2026-08-26 — sigue bloqueado para mensajes ENTRANTES reales por falta de un chip dedicado para registrar el número.
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
> deep-link `wa.me`, no un canal conversacional con IA. Este documento es sobre el canal ENTRANTE nuevo
> (Meta Cloud API + webhook + IA).

## Estado (2026-08-27)

**Fases 1 (cimientos, solo lectura), 2 (cargar gastos como borrador) y 3 (fotos y audio) construidas y
COMMITEADAS Y PUSHEADAS a `origin/dev`** (Fase 1: commit `8b297b32`, `APP_VERSION` `v1.181.0`; Fase 2:
commit `9029f24b`, `APP_VERSION` `v1.182.0`; Fase 3: commit `0364447a`, `APP_VERSION` `v1.183.0`; tag +
GitHub release publicados para las 3), **SIN deploy a PROD todavía** (sin PR a `main`).

**Fases 1 y 2 verificadas end-to-end en DEV al 100%.** La **Fase 3 (fotos/audio) está verificada solo
PARCIALMENTE**: el ruteo por tipo de mensaje, la seguridad (firma HMAC) y la integración real con la API de
Meta (con el token real, solo con `media_id` sintéticos) sí se confirmaron con logs reales de la Edge
Function — pero el "happy path" completo (transcribir un audio real, extraer un gasto de una foto real) NO
se pudo probar de punta a punta porque requiere un mensaje entrante real de WhatsApp, y eso sigue bloqueado
por el mismo pendiente operativo de siempre (chip prepago dedicado) — ver "Fase 3" y "Pendiente de GO" más
abajo.

Además, en la sesión del 2026-08-26 GO hizo el **trámite real de Meta** (número de prueba, no Business
Verification completa) y conectó el webhook de verdad — ver "Trámite real de Meta" más abajo. Sigue
bloqueado para recibir mensajes ENTRANTES reales por un pendiente operativo de GO (conseguir un chip
prepago dedicado), no por nada de código — ver "Pendiente de GO" al final.

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

## Fase 1 — Tablas (migración 382, `382_whatsapp_asistente_fase1.sql`)

Aplicada y verificada **solo en DEV** (`gcmhzdedrkmmzfzfveig`).

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

## Embedded Signup — esto NO se repite por cada cliente nuevo

GO preguntó explícitamente si cada negocio nuevo que se sume a Genesis360 va a tener que repetir todo el
trámite manual de arriba. Investigado y confirmado contra la documentación oficial de Meta
(developers.facebook.com): **NO** — existe el flujo oficial **"Embedded Signup"**, diseñado para
plataformas SaaS como Genesis360.

- El cliente conecta su WhatsApp desde DENTRO de la app de Genesis360 (popup de Meta embebido), sin pisar
  developers.facebook.com ni repetir nada de lo que hizo GO manualmente.
- Lo único que el cliente siempre va a necesitar (esto no lo elimina Embedded Signup, es restricción de
  WhatsApp en sí): un número de teléfono real DEDICADO — mismo motivo por el que se frenó a GO recién.
- Para habilitarlo, **Genesis360 como plataforma (una sola vez)** tiene que convertirse en **"Proveedor de
  tecnología"** ante Meta — esto SÍ exige que Genesis360 complete su propia Business Verification con
  documentos (el CUIT/monotributo de Fede, el mismo que ya usa la empresa para todo lo demás — no hace
  falta uno nuevo).
- **Límite real con impacto de negocio**: sin esa verificación de plataforma, se pueden onboardear hasta
  **10 negocios nuevos por semana**; verificada, sube a **200/semana**.
- Es trabajo NUEVO, identificado como el paso lógico después de terminar de validar el asistente con este
  primer negocio de prueba — **NO construido todavía, no bloquea nada de lo actual**.

## Fase 2 — cargar gastos como borrador (migración 383, `383_whatsapp_gastos_borrador.sql`)

Aplicada y verificada **solo en DEV**. Código commiteado y pusheado (commit `9029f24b`, `APP_VERSION`
`v1.182.0`, tag + release publicados).

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

## Alcance

**Fase 1: SOLO LECTURA** (consultas de stock/precio) — ✅ construida y verificada end-to-end.
**Fase 2: cargar gastos como borrador con doble confirmación (texto)** — ✅ construida y verificada end-to-end.
**Fase 3: fotos y audio** — ✅ construida, ⚠ verificada solo PARCIALMENTE (ver sección dedicada arriba —
falta el happy path real, bloqueado por el chip prepago dedicado).

Fases futuras ya conversadas con Fede pero sin empezar:
- **Fase 4** — briefing diario proactivo (apertura/cierre) por plantilla pre-aprobada de Meta.
- Medición de uso y facturación completa por tenant (Sección G de la propuesta de Fede) — `tokens in/out`
  ya se loguea desde la Fase 1 pensando en esto.
- **Embedded Signup** para que futuros clientes conecten su WhatsApp sin repetir el trámite manual de GO
  — ver sección dedicada arriba. Requiere que Genesis360 complete su propia Business Verification como
  plataforma. Identificado como próximo paso lógico, sin empezar.

**Portal de Proveedores** (la otra mitad de la propuesta de Fede) sigue sin empezar — proyecto aparte, con
un problema arquitectónico cross-tenant real sin resolver: `users.tenant_id` es columna única en todo el
sistema, y la decisión de negocio de "una sola cuenta de proveedor usable en varios negocios" rompe ese
supuesto de raíz. Necesita un modelo de identidad cross-tenant nuevo y un relevamiento técnico propio.

## Pendiente de GO para continuar (bloqueante para pasar de pruebas a real)

1. **Conseguir un chip prepago barato DEDICADO** (no la línea personal de GO) para completar el registro
   del número de test de Meta y poder probar mensajes ENTRANTES reales de punta a punta — ver "Trámite
   real de Meta" arriba. Ahora también es lo único que falta para cerrar la verificación end-to-end de la
   **Fase 3** (audio/foto) — no bloquea seguir construyendo (Fase 4), solo bloquea la prueba real con el
   celular de un usuario.
2. **Token de acceso permanente**: el actual es TEMPORAL (24hs) — se refrescó de nuevo en la sesión de la
   Fase 3 (2026-08-27) — hace falta dar de alta un **System User** en el Business Portfolio de Meta para
   obtener un token permanente. Aclaración confirmada en la sesión de la Fase 3: refrescar el token NO
   destraba el chip dedicado — son 2 pendientes independientes (el token autentica lo que Genesis360 le
   pide a Meta; el chip es lo que hace falta para que Meta ACEPTE entregarnos un mensaje entrante real).
3. 🔴 Sigue sin resolver (recurrente hace varias sesiones, no específico de esta feature): rotar el
   `SUPABASE_ACCESS_TOKEN` filtrado (`sbp_60df…`, desde 2026-07-09). Sigue bloqueando `npm run schema:dump`
   — **`schema_full.sql` sigue DESACTUALIZADO, no incluye las migraciones 382/383/384.**
4. **Fase 4** (briefing diario) — sin empezar, sin diseño. Sección G (medición/facturación de uso): el
   costo de Groq Whisper por audio queda sin trackear por ahora (prácticamente gratis), decisión consciente
   de no sumar esa granularidad todavía.
5. **Embedded Signup** — próximo paso lógico para escalar a futuros clientes sin repetir el trámite
   manual, sin empezar (requiere Business Verification de Genesis360 como plataforma).
6. **Portal de Proveedores** — sigue sin empezar, ver "Alcance" arriba.

## Referencias

- [[wiki/features/asistente-ia]] — motor del chat web del Plan IA (patrón reusado, código separado); usa
  Groq para el chat (no para transcripción de audio, que es lo nuevo de la Fase 3 acá).
- [[wiki/integrations/roadmap-apis]] §6.2 — visión original de WhatsApp Cloud API (notificaciones/carritos
  abandonados/CC), corregida para reflejar el esquema real de `whatsapp_credentials`.
- [[wiki/architecture/edge-functions]] — lista de Edge Functions, incluye `wa-webhook`.
- `wiki/database/migraciones.md` — migraciones 382, 383 y 384.
- `sources/raw/project_pendientes.md` (cont. 28, "ARRANCÁ ACÁ") — detalle completo de la sesión de la Fase 3.
- `log.md` (2026-08-27) — entrada completa de la Fase 3; (2026-08-26) — Fase 1, Fase 2, trámite real de
  Meta y Embedded Signup.
