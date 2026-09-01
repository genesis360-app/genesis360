---
title: Edge Functions
category: architecture
tags: [edge-functions, deno, serverless, supabase]
sources: []
updated: 2026-08-27
---

# Edge Functions (30 funciones Deno)

Todas las Edge Functions corren en Deno/TypeScript en Supabase. Se autentican validando el JWT de Supabase en cada request.

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
| `scan-ticket` | Foto de ticket de supermercado → lista de productos `[{barcode, nombre, cantidad, precio_unitario}]` (Claude Sonnet 4.6 vision). Usado en RecepcionesPage y ProductosPage. Retorna siempre HTTP 200 con `{ items: [] }` o `{ error: '...' }` |
| `meli-oauth-callback` | Callback OAuth para conectar cuenta Mercado Libre |
| `meli-webhook` | Procesa webhooks de Mercado Libre (cambios de stock) |
| `meli-search-items` | Busca productos en Mercado Libre |
| `tn-oauth-callback` | Callback OAuth para conectar cuenta Tienda Nube |
| `tn-webhook` | Procesa webhooks de Tienda Nube (stock sync) |
| `marketplace-webhook` | Webhook del marketplace interno |
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

---

## Links relacionados

- [[wiki/architecture/backend-supabase]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/integrations/mercado-libre]]
- [[wiki/integrations/tienda-nube]]
- [[wiki/integrations/afip]]
- [[wiki/features/escaneo-barcode]]
