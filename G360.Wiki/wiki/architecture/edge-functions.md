---
title: Edge Functions
category: architecture
tags: [edge-functions, deno, serverless, supabase]
sources: []
updated: 2026-08-27
---

# Edge Functions (29 funciones Deno)

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
| `wa-webhook` | 🆕 2026-08-27, **COMMITEADA/PUSHEADA a `origin/dev` (v1.181.0/v1.182.0/v1.183.0), solo DEV, sin deploy a PROD** — webhook de WhatsApp Cloud API (Meta), responde consultas de stock/precio con Claude Sonnet 5 (Fase 1, tool-calling) + arma borradores de gasto con doble confirmación (Fase 2, `proponer_gasto` + botones interactivos) + acepta FOTOS (Claude Sonnet 5 multimodal) y AUDIO (transcripto con Groq Whisper) como formas nuevas de disparar `proponer_gasto` (Fase 3, verificada solo parcialmente — falta el happy path real, ver la página). Ver [[wiki/features/asistente-whatsapp]] |
| `wa-briefing-sweep` | 🆕 2026-08-27, **COMMITEADA/PUSHEADA a `origin/dev` (v1.184.0), solo DEV, sin deploy a PROD** — `verify_jwt: false`, disparada por **GitHub Actions** (`.github/workflows/wa-briefing-sweep.yml`, `schedule: '*/15 * * * *'` + `workflow_dispatch`, clon del molde de `repositores-cierre-dia-sweep`), NO por HTTP directo de un cliente. Asistente de WhatsApp Fase 4 (briefing diario proactivo): por cada sucursal activa con WhatsApp conectado y `whatsapp_credentials.numero_notificaciones` configurado, evalúa horario de apertura/cierre (`sucursales.horario_apertura`/`horario_cierre`) y manda un mensaje por **plantilla pre-aprobada de Meta** (`briefing_apertura_dia`/`briefing_cierre_dia`, business-initiated, no comparte código con `wa-webhook`) con el resumen de ventas/gastos del día. Verificada solo parcialmente — todo el código confirmado correcto contra la API real de Meta, pero el envío real está bloqueado por la aprobación PENDIENTE de las 2 plantillas. Ver [[wiki/features/asistente-whatsapp]] |
| *(~7 más)* | Monitoreo, aging de stock, workers, etc. |

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

> [!NOTE] Junto con `scan-ticket` (Claude Sonnet 4.6 vision) y `wa-webhook` (Claude Sonnet 5, 🆕
> 2026-08-26, solo DEV — ver [[wiki/features/asistente-whatsapp]]), son las funciones que usan la API de
> Anthropic directamente — el asistente del header (`ai-assistant`) usa Groq, no Anthropic. ⚠ Desde la
> Fase 3 (2026-08-27), `wa-webhook` TAMBIÉN llama a Groq — pero solo para transcribir audio (Whisper), no
> para el "cerebro" (que sigue siendo Claude); es la misma `GROQ_API_KEY` que usa `ai-assistant`, radio de
> impacto acotado si Groq fallara.

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
