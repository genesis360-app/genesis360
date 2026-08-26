---
name: asistente-whatsapp
description: Asistente de WhatsApp con IA para el DUEÑO de cada negocio — consultas de stock/precio vía Meta Cloud API + Claude Sonnet 5. Fase 1 de un plan de 4 fases (propuesta de Fede, 25/8/2026). Construida y verificada en DEV el 2026-08-26, sin deploy a PROD.
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

## Estado (2026-08-26)

**Fase 1 (cimientos) construida y verificada en DEV, código sin commitear/bumpear todavía, SIN deploy a
PROD.** Bloqueada para pasar a uso real por 3 pendientes de GO — ver más abajo.

## Arquitectura

```
Meta WhatsApp Cloud API
  └─ webhook (mensaje entrante) ──▶ EF wa-webhook (--no-verify-jwt)
       1. valida X-Hub-Signature-256 (BLOQUEANTE desde el día 1)
       2. resuelve tenant por phone_number_id (whatsapp_credentials)
       3. chequea idempotencia por message_id (whatsapp_mensajes_log)
       4. arma tool-calling con Claude Sonnet 5 (consultar_stock_precio → tabla productos)
       5. responde al usuario por la API de WhatsApp + loguea tokens in/out
```

## Tablas (migración 382, `382_whatsapp_asistente_fase1.sql`)

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

## Edge Function `wa-webhook`

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

### Secrets nuevos en DEV

- `META_VERIFY_TOKEN` — para el handshake GET de verificación del webhook.
- `META_APP_SECRET` — **TEMPORAL**, generado para poder probar antes de tener el valor real de la app de
  Meta. Hay que reemplazarlo cuando GO tenga el App Secret real (Settings → Basic del dashboard de Meta).

## Verificación end-to-end en DEV

Con credenciales de prueba (tenant "Familia Otranto De Porto", fila ficticia en `whatsapp_credentials`):

1. Payload sintético de WhatsApp firmado con HMAC real → **200 OK** → la tool se ejecutó → Claude respondió
   correctamente con datos reales de un producto de prueba (coincidió exacto con precio/stock real de la
   DB).
2. Reenviar el mismo mensaje (mismo `message_id`) → **NO se reprocesó** (idempotencia OK).
3. Firma inválida o ausente → **403** (rechazado).
4. Handshake GET de verificación de Meta con token correcto → **200 + eco del challenge**; con token
   incorrecto → **403**.

Los 4 checks de seguridad pasaron.

## Alcance

**Fase 1 (esta): SOLO LECTURA** — consultas de stock/precio del dueño por WhatsApp.

Fuera de alcance, fases futuras ya conversadas con Fede pero sin empezar:
- **Fase 2** — cargar gastos con confirmación humana (mismo patrón Confirmar/Rechazar que ya usa el Plan
  IA para propuestas de config y memoria, ver [[wiki/features/asistente-ia]]).
- **Fase 3** — fotos/audio (transcripción de audio vía Speech-to-Text, ej. Whisper).
- **Fase 4** — briefing diario proactivo (apertura/cierre) por plantilla pre-aprobada de Meta.
- Medición de uso y facturación completa por tenant (Sección G de la propuesta de Fede) — `tokens in/out`
  ya se loguea desde esta Fase 1 pensando en esto.

**Portal de Proveedores** (la otra mitad de la propuesta de Fede) sigue sin empezar — proyecto aparte, con
un problema arquitectónico cross-tenant real sin resolver: `users.tenant_id` es columna única en todo el
sistema, y la decisión de negocio de "una sola cuenta de proveedor usable en varios negocios" rompe ese
supuesto de raíz. Necesita un modelo de identidad cross-tenant nuevo y un relevamiento técnico propio.

## Pendiente de GO para continuar (bloqueante para pasar de pruebas a real)

1. **Completar el trámite de Meta Business Verification** + alta de WABA + número dedicado + System User
   token (guía paso a paso ya compartida). Cuando lo tenga, pasar: `phone_number_id`, `waba_id`,
   `numero_whatsapp`, el access token del system user, y el **App Secret** real de la app de Meta (Settings
   → Basic) para reemplazar el `META_APP_SECRET` temporal.
2. **Conectar el webhook real** en el dashboard de Meta (en conjunto con Claude una vez haya credenciales
   reales) usando el `META_VERIFY_TOKEN` ya cargado en DEV.
3. 🔴 Sigue sin resolver (recurrente hace varias sesiones, no específico de esta feature): rotar el
   `SUPABASE_ACCESS_TOKEN` filtrado (`sbp_60df…`, desde 2026-07-09). Bloqueó de paso `npm run schema:dump`
   en esta sesión — **`schema_full.sql` quedó DESACTUALIZADO, no incluye la migración 382 todavía.**

## Referencias

- [[wiki/features/asistente-ia]] — motor del chat web del Plan IA (patrón reusado, código separado).
- [[wiki/integrations/roadmap-apis]] §6.2 — visión original de WhatsApp Cloud API (notificaciones/carritos
  abandonados/CC), corregida para reflejar el esquema real de `whatsapp_credentials`.
- [[wiki/architecture/edge-functions]] — lista de Edge Functions, incluye `wa-webhook`.
- `wiki/database/migraciones.md` — migración 382.
- `sources/raw/project_pendientes.md` (cont. 26, "ARRANCÁ ACÁ") — detalle completo de la sesión.
- `log.md` (2026-08-26) — entrada completa.
