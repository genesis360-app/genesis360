---
name: asistente-whatsapp
description: Asistente de WhatsApp con IA para el DUEÑO de cada negocio — consultas de stock/precio (Fase 1) + carga de gastos como borrador con doble confirmación (Fase 2), vía Meta Cloud API + Claude Sonnet 5. Plan de 4 fases (propuesta de Fede, 25/8/2026). Fases 1+2 construidas, verificadas y COMMITEADAS/PUSHEADAS a origin/dev (v1.181.0/v1.182.0), SIN deploy a PROD. Trámite real de Meta (número de prueba) conectado por GO el 2026-08-26 — bloqueado para mensajes ENTRANTES reales por falta de un chip dedicado para registrar el número.
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

**Fases 1 (cimientos, solo lectura) y 2 (cargar gastos como borrador) construidas, verificadas en DEV,
COMMITEADAS Y PUSHEADAS a `origin/dev`** (Fase 1: commit `8b297b32`, `APP_VERSION` `v1.181.0`; Fase 2:
commit `9029f24b`, `APP_VERSION` `v1.182.0`; tag + GitHub release publicados para ambas), **SIN deploy a
PROD todavía** (sin PR a `main`). Corrige una nota anterior de esta misma página que decía "código sin
commitear/bumpear" — eso ya no es así, quedó desactualizada apenas se escribió (el commit de Fase 1 pasó
en la misma sesión).

Además, en esta misma sesión GO hizo el **trámite real de Meta** (número de prueba, no Business
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
       4a. mensaje de texto → tool-calling con Claude Sonnet 5:
           - consultar_stock_precio (solo lectura, tabla productos) — Fase 1
           - proponer_gasto (arma BORRADOR en whatsapp_gastos_borrador, NUNCA escribe gastos) — Fase 2
       4b. mensaje interactive/button_reply (Confirmar/Cancelar) → resuelve el borrador
           correspondiente (verifica que sea del tenant correcto, nunca confía solo en el id del botón)
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

## Alcance

**Fase 1: SOLO LECTURA** (consultas de stock/precio) — ✅ construida y verificada.
**Fase 2: cargar gastos como borrador con doble confirmación** — ✅ construida y verificada.

Fases futuras ya conversadas con Fede pero sin empezar:
- **Fase 3** — fotos/audio (transcripción de audio vía Speech-to-Text, ej. Whisper).
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
   real de Meta" arriba. No bloquea seguir construyendo (Fases 3/4), solo bloquea la prueba real end-to-end
   con el celular de un usuario.
2. **Token de acceso permanente**: el actual es TEMPORAL (24hs) y ya venció al cierre de esta sesión — hace
   falta dar de alta un **System User** en el Business Portfolio de Meta para obtener un token permanente.
3. 🔴 Sigue sin resolver (recurrente hace varias sesiones, no específico de esta feature): rotar el
   `SUPABASE_ACCESS_TOKEN` filtrado (`sbp_60df…`, desde 2026-07-09). Bloqueó `npm run schema:dump` desde la
   sesión de la Fase 1 — **`schema_full.sql` sigue DESACTUALIZADO, no incluye las migraciones 382/383.**
4. **Fase 3** (fotos/audio) y **Fase 4** (briefing diario) — sin empezar, sin diseño.
5. **Embedded Signup** — próximo paso lógico para escalar a futuros clientes sin repetir el trámite
   manual, sin empezar (requiere Business Verification de Genesis360 como plataforma).
6. **Portal de Proveedores** — sigue sin empezar, ver "Alcance" arriba.

## Referencias

- [[wiki/features/asistente-ia]] — motor del chat web del Plan IA (patrón reusado, código separado).
- [[wiki/integrations/roadmap-apis]] §6.2 — visión original de WhatsApp Cloud API (notificaciones/carritos
  abandonados/CC), corregida para reflejar el esquema real de `whatsapp_credentials`.
- [[wiki/architecture/edge-functions]] — lista de Edge Functions, incluye `wa-webhook`.
- `wiki/database/migraciones.md` — migraciones 382 y 383.
- `sources/raw/project_pendientes.md` (cont. 27, "ARRANCÁ ACÁ") — detalle completo de la sesión.
- `log.md` (2026-08-26) — entradas completas (Fase 1 y Fase 2 + trámite real de Meta + Embedded Signup).
