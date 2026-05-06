---
title: Edge Functions
category: architecture
tags: [edge-functions, deno, serverless, supabase]
sources: []
updated: 2026-04-30
---

# Edge Functions (26 funciones Deno)

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
| `scan-product` | Imagen → detección de barcode con IA (Claude Haiku) |
| `meli-oauth-callback` | Callback OAuth para conectar cuenta Mercado Libre |
| `meli-webhook` | Procesa webhooks de Mercado Libre (cambios de stock) |
| `meli-search-items` | Busca productos en Mercado Libre |
| `tn-oauth-callback` | Callback OAuth para conectar cuenta Tienda Nube |
| `tn-webhook` | Procesa webhooks de Tienda Nube (stock sync) |
| `marketplace-webhook` | Webhook del marketplace interno |
| `generate-types` | Genera TypeScript types desde el schema de Supabase |
| *(~11 más)* | Monitoreo, aging de stock, workers, etc. |

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

> [!NOTE] Esta es la única función que usa la API de Anthropic directamente.

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
