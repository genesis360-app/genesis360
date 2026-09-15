---
title: Edge Functions
category: architecture
tags: [edge-functions, deno, serverless, supabase]
sources: []
updated: 2026-09-15
---

# Edge Functions (30 funciones Deno)

Todas las Edge Functions corren en Deno/TypeScript en Supabase. Se autentican validando el JWT de Supabase en cada request.

---

## 🛑 El código desplegado puede no ser el del repo — auditoría 2026-09-14

**Mergear `dev`→`main` despliega el frontend (Vercel) y nada más.** Las Edge Functions se despliegan
a mano, y una migración aplicada no dice nada sobre la función que la usa.

El 2026-09-14, antes de desplegar `emitir-factura`, se bajó el código de PROD y resultó ser **el del
15/07**: le faltaba el lock anti doble emisión que el wiki daba "EN PROD desde 2026-08-20". La
auditoría de todas las funciones encontró además `tn-webhook`/`meli-webhook` sin la reserva atómica
de stock (DEV y PROD), `emitir-factura-plataforma` sin el "NO reintentar" de AfipSDK, `wa-webhook`
de PROD atrasada y **`scan-ticket` sin desplegar en PROD**. Todo realineado ese día (detalle en
`log.md`).

**Regla**: en cada deploy a PROD, y antes de escribir "EN PROD" sobre un cambio de una EF:

```bash
bash scripts/auditar-edge-functions.sh            # todas, DEV y PROD vs HEAD
bash scripts/auditar-edge-functions.sh emitir-factura tn-webhook
```

- Baja el código con `supabase functions download --use-api` (no necesita Docker) y lo compara con
  `git show HEAD:…`. `0` = idéntico.
- 🛑 Al redesplegar, **respetar `verify_jwt`**: los webhooks (`tn-webhook`, `meli-webhook`,
  `wa-webhook`, `modo-*`, `mp-webhook`, `mp-ipn`) van con `--no-verify-jwt`. Verificar con un GET
  sin `Authorization`: el gateway responde `UNAUTHORIZED_NO_AUTH_HEADER` solo donde está activo.
- 🐛 **Gotcha nuevo (2026-09-15):** el deploy por CLI **conserva** el `verify_jwt` que la función ya tenía — no lo
  fuerza al que dice el flag/código nuevo. Pasó con `marketplace-webhook`: quedó en `false` pese a que el código
  nuevo exige un usuario autenticado. Se corrige con un `PATCH` a la Management API (`verify_jwt: true`), no con la
  CLI. Ver [[wiki/development/deploy]].
- Drift de solo comentarios no justifica redesplegar una función de cobros.

🗑️ **Funciones que existían solo en PROD** — GO: *"si no se usan para nada y no se van a usar,
eliminalas"* (2026-09-14). Revisadas una por una (código, workflows, cron, triggers, logs de 24 h):

| Función | Veredicto | Evidencia |
|---|---|---|
| `crear-suscripcion` | 🗑️ borrada | nada la llama; la suscripción MP se arma en el frontend (`init_point`); su carpeta en el repo estaba vacía |
| `smart-endpoint` | 🗑️ borrada | duplicado viejo de `crear-suscripcion`, sin referencias |
| `clever-handler` | 🗑️ borrada | duplicado viejo de `mp-webhook`; todo `notification_url` apunta a `mp-webhook`, y con `verify_jwt` activo rebotaba a MP igual |
| `process-aging` | 🗑️ borrada | el wiki ya la daba por eliminada en v1.54.0 (código muerto: ConfigPage llama la RPC directo), pero seguía desplegada |
| `birthday-notifications` | ✅ se queda | la llama un cron diario de GitHub Actions (corrió el mismo día) |
| `data-api`, `marketplace-api` | ✅ se quedan | Configuración muestra sus endpoints a los usuarios |
| `marketplace-webhook` | 🔌 apagada (2026-09-14), ✅ redesplegada a PROD el 2026-09-15 (v20) | nadie la llamaba; ahora exige usuario autenticado del mismo negocio. `verify_jwt: true` en PROD (requirió un `PATCH` de la Management API — el deploy por CLI lo había conservado en `false`). Sigue sin existir en DEV, a propósito. Ver [[wiki/features/marketplace]] |

Antes de borrar se bajó el código de cada una a `D:/Dev/genesis360-backups/edge-functions-eliminadas-2026-09-14/`.

🟨 **Pendiente menor (auditoría previa al deploy del 2026-09-15):** además de las 4 redesplegadas
(`admin-api`, `billing-manual-avisar-pago`, `marketplace-webhook`, `ai-assistant`), quedan diferencias
**solo de comentarios/formato** (sin cambio de código real, verificado bajando el código de cada una) en
`mp-verificar-suscripcion` (PROD 8 líneas, DEV 4), `mp-ipn` (2/2), `marketplace-api` (PROD 21 líneas, DEV no
desplegada), `birthday-notifications` (PROD 4 líneas, DEV no desplegada) y 2 líneas en
`billing-manual-pagar`/`billing-manual-sweep`/`cancel-suscripcion` (del lado de DEV), `mp-addon-batch`,
`tn-stock-worker`, `wa-briefing-sweep`. Redeploy cosmético cuando se toquen (no urgente). `wa-embedded-signup-exchange`
sigue solo en DEV, a la espera de la App Review de Meta.

---

## Lista completa

| Función | Propósito |
|---------|-----------|
| `mp-webhook` | Recibe webhooks de Mercado Pago (pagos de suscripción) |
| `mp-ipn` | Mercado Pago IPN (notificación instantánea de pagos) |
| `crear-suscripcion` | Inicia el flow de alta de suscripción en Mercado Pago |
| `invite-user` | Envía invitación por email a nuevo usuario del tenant |
| `emitir-factura` | Emisión de facturas electrónicas vía AFIP |
| `birthday-notifications` | Envía alertas de cumpleaños de empleados |
| `send-email` | Email transaccional genérico (usa Resend) |
| `scan-product` | Imagen → detección de barcode con IA (Claude Haiku) + Open Food Facts |
| `transportista-subir-archivo` | 🆕 2026-09-14 (v1.221.0, DEV y PROD) · `verify_jwt: false` — el transportista sube foto o firma de entrega desde `/transporte/:token` (página pública, sin sesión). Valida el token como `get_envio_by_token`, rechaza envíos entregados/cancelados, acepta PNG/JPEG ≤ 5 MB, arma la ruta `pod/<envio_id>/…` y sube con service_role; devuelve URL firmada. e2e 148 |
| `scan-ticket` | Foto de ticket de supermercado → lista de productos `[{barcode, nombre, cantidad, precio_unitario}]` (Claude Sonnet 4.6 vision). Usado en RecepcionesPage y ProductosPage. Retorna siempre HTTP 200 con `{ items: [] }` o `{ error: '...' }`. **Desplegada en PROD recién el 2026-09-14** — antes no existía ahí y esas dos pantallas fallaban |
| `meli-oauth-callback` | Callback OAuth para conectar cuenta Mercado Libre |
| `meli-webhook` | Procesa webhooks de Mercado Libre (cambios de stock) |
| `meli-search-items` | Busca productos en Mercado Libre |
| `tn-oauth-callback` | Callback OAuth para conectar cuenta Tienda Nube |
| `tn-webhook` | Procesa webhooks de Tienda Nube (stock sync) |
| `marketplace-webhook` | Webhook de stock del marketplace interno — 🔌 apagado (2026-09-14), solo acepta usuarios autenticados, ✅ EN PROD desde el 2026-09-15 (`verify_jwt: true`) |
| `generate-types` | Genera TypeScript types desde el schema de Supabase |
| `modo-crear-pago` | Genera payment intent en MODO — QR + deep link para cobros interoperables (DEV+PROD) |
| `modo-webhook` | Recibe confirmaciones de pago MODO — idempotente via `ventas_externas_logs` (DEV+PROD) |
| `wa-webhook` | `verify_jwt: false` (Meta no manda JWT de Supabase, la seguridad la da la firma HMAC). **✅ EN PROD desde 2026-08-27** (PR #334, merge `867d651a`, DORMIDA — 0 filas en `whatsapp_credentials` en PROD), commiteada v1.181.0/v1.182.0/v1.183.0 — webhook de WhatsApp Cloud API (Meta), responde consultas de stock/precio con Claude Sonnet 5 (Fase 1, tool-calling) + arma borradores de gasto con doble confirmación (Fase 2, `proponer_gasto` + botones interactivos) + acepta FOTOS (Claude Sonnet 5 multimodal) y AUDIO (transcripto con Groq Whisper) como formas nuevas de disparar `proponer_gasto` (Fase 3, verificada solo parcialmente — falta el happy path real, ver la página). Ver [[wiki/features/asistente-whatsapp]] |
| `wa-briefing-sweep` | `verify_jwt: false`. **✅ EN PROD desde 2026-08-27** (PR #334, merge `867d651a`, DORMIDA), commiteada v1.184.0 — disparada por **GitHub Actions** (`.github/workflows/wa-briefing-sweep.yml`, `schedule: '*/15 * * * *'` + `workflow_dispatch`, clon del molde de `repositores-cierre-dia-sweep`), NO por HTTP directo de un cliente; en `main` el trigger `schedule:` corre de verdad cada 15 min contra PROD. Asistente de WhatsApp Fase 4 (briefing diario proactivo): por cada sucursal activa con WhatsApp conectado y `whatsapp_credentials.numero_notificaciones` configurado, evalúa horario de apertura/cierre (`sucursales.horario_apertura`/`horario_cierre`) y manda un mensaje por **plantilla pre-aprobada de Meta** (`briefing_apertura_dia`/`briefing_cierre_dia`, business-initiated, no comparte código con `wa-webhook`) con el resumen de ventas/gastos del día. Verificada solo parcialmente — todo el código confirmado correcto contra la API real de Meta, pero el envío real está bloqueado por la aprobación PENDIENTE de las 2 plantillas. Ver [[wiki/features/asistente-whatsapp]] |
| `wa-embedded-signup-exchange` | 🆕 2026-08-27 (v1.185.0, commit `7c1e1a45`), **CÓDIGO VALIDADO end-to-end 2026-08-28 (v1.186.0, misma conversación sin `/clear`) — solo DEV, sin deploy a PROD** — `verify_jwt: true` (a diferencia de `wa-webhook`, esta la invoca un usuario logueado de Genesis360 desde el frontend, no Meta; guard de identidad JWT→`auth.getUser`→pertenencia al `tenant_id`, mismo patrón que `generar-csr`). Recibe `{tenant_id, code, waba_id, phone_number_id}` del popup de Embedded Signup de Meta: intercambia el `code` por el token propio de ESE cliente, registra el `phone_number_id`, suscribe la WABA a la app y hace upsert en `whatsapp_credentials` (mig 382, sin migración nueva). Confirmado con GO en vivo, probando por 3 caminos distintos con datos reales de Meta, que el código funciona correcto — el `code` de Meta se recibe e intercambia bien. **🛑 Bloqueada para completar el registro real de un WABA**: no por código, sino por la Verificación del Negocio de Meta (pendiente, 100% externo — documentos a cargo de Fede). Fix defensivo agregado: timeout de 3 min en `iniciarConexionWhatsapp` para no dejar el botón colgado sin error cuando Meta no completa el flujo. Ver [[wiki/features/asistente-whatsapp]] → "Embedded Signup" |
| *(~6 más)* | Monitoreo, aging de stock, workers, etc. |

### EFs activas DEV+PROD

| EF | auth | Descripción |
|---|---|---|
| `invite-user` | JWT-less | Invita usuario |
| `ai-assistant` | JWT-less | Groq/`openai/gpt-oss-120b` — chat + bug report + propuesta de config (Plan IA Fase 2) + memoria persistente por tenant (Plan IA Fase 3, mig 377-378) |
| `cancel-suscripcion` | JWT | PATCH preapproval MP |
| `emitir-factura` | JWT | AFIP factura electrónica |
| `crear-suscripcion` | JWT-less | MP preapproval |
| `mp-webhook` | JWT-less | Webhooks MP suscripciones |
| `data-api` | JWT | API pull externa (API keys) |
| `tn-stock-worker` | JWT-less | Sync stock TiendaNube |
| `meli-stock-worker` | JWT-less | Sync stock MercadoLibre |
| `mp-crear-link-pago` | JWT | Link de pago MP para ventas |
| `modo-crear-pago` | JWT-less | Genera payment intent MODO |
| `modo-webhook` | JWT-less | Confirmaciones de pago MODO |

---

## Patrón estándar de una Edge Function

```typescript
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async (req) => {
  // 1. Validar JWT
  const authHeader = req.headers.get("Authorization");
  // ...

  // 2. Crear cliente Supabase con service role (para bypass RLS si necesario)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 3. Lógica de negocio
  // ...

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

---

## Función especial: `scan-product`

Esta función usa **Claude Haiku** para detectar barcodes a partir de imágenes cuando el escáner físico falla. Flujo:

1. Frontend envía imagen base64
2. Edge Function llama a Anthropic API (Claude Haiku)
3. Claude extrae el código de barras de la imagen
4. Se retorna el código al frontend para buscar el producto

> [!NOTE] Junto con `scan-ticket` (Claude Sonnet 4.6 vision) y `wa-webhook` (Claude Sonnet 5, **✅ EN PROD
> desde 2026-08-27**, DORMIDA — ver [[wiki/features/asistente-whatsapp]]), son las funciones que usan la
> API de Anthropic directamente — el asistente del header (`ai-assistant`) usa Groq, no Anthropic. ⚠ Desde
> la Fase 3 (2026-08-27), `wa-webhook` TAMBIÉN llama a Groq — pero solo para transcribir audio (Whisper), no
> para el "cerebro" (que sigue siendo Claude); es la misma `GROQ_API_KEY` que usa `ai-assistant`, radio de
> impacto acotado si Groq fallara. `wa-embedded-signup-exchange` (🆕 2026-08-27, solo DEV) NO usa IA — es
> solo intercambio de OAuth + llamadas REST a la Graph API de Meta.

---

## Deploy

Las Edge Functions se deployean con:
```bash
supabase functions deploy nombre-funcion
```

En DEV primero, PROD después. Ver [[wiki/development/deploy]].

⚠️ **Mergear a `main` no las despliega.** Después de cada deploy: `bash scripts/auditar-edge-functions.sh` (ver la sección de arriba).

---

## Links relacionados

- [[wiki/architecture/backend-supabase]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/integrations/mercado-libre]]
- [[wiki/integrations/tienda-nube]]
- [[wiki/integrations/afip]]
- [[wiki/features/escaneo-barcode]]
