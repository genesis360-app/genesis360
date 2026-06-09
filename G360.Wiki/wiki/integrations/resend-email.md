---
title: Emails Transaccionales — Resend
category: integrations
tags: [resend, email, transaccional, edge-function, notificaciones]
sources: [CLAUDE.md]
updated: 2026-06-09
---

# Emails Transaccionales — Resend

Todos los emails transaccionales de Genesis360 se envían via **Resend** desde la Edge Function `send-email`.

---

## Edge Function `send-email`

- Tipo de invocación: **fire-and-forget** (nunca `await` en el frontend)
- No lanza errores al llamante aunque falle

### Tipos de email soportados

| Tipo | Cuándo se envía |
|------|----------------|
| `welcome` | Nuevo usuario registrado |
| `venta_confirmada` | Al despachar una venta / ticket por email (H2) |
| `alerta_stock` | Cuando se dispara alerta de stock mínimo |
| `factura_emitida` | Factura AFIP emitida (con CAE) |
| `notificacion` | Notificación genérica (título + mensaje + action_url) |
| `oc` | Orden de compra al proveedor (HTML + **PDF adjunto** vía `attachments`) |
| `bug_report` | Reporte del asistente IA |

> **Adjuntos:** la función soporta `attachments: [{ filename, content (base64) }]` (Resend). Usado por el email de OC; reutilizable para factura/estado de cuenta.

---

## Configuración

**Secret:** `RESEND_API_KEY` en Supabase EF secrets (DEV + PROD). **Es la pieza crítica** — si la key está vencida/revocada, Resend devuelve **401 "API key is invalid"** y falla TODO el correo (el front muestra "Edge Function returned a non-2xx status code").

**FROM:** `Genesis360 <noreply@genesis360.pro>` — dominio **verificado** en Resend (DKIM + SPF, Cloudflare DNS). Definido en `supabase/functions/send-email/index.ts`. `send-email` desplegada **DEV v21 / PROD v24** (`verify_jwt` ON).

> [!NOTE] **Troubleshooting (2026-06-09):** si `send-email` da non-2xx, la causa #1 es un `RESEND_API_KEY` vencido en el secret de Supabase → regenerar la key en Resend (permiso *Sending access*) y actualizar el secret en **ambos** proyectos (DEV + PROD); no requiere redeploy (la key se lee en runtime con `Deno.env`). El dominio ya está verificado, no es eso. El front (`enviarOCEmail`, ticket de venta) ahora muestra el mensaje real de Resend.

---

## Monitoring diario

La EF `monitoring-check` también usa Resend para enviar el email diario de KPIs a las 9 AM Argentina:
- Subject: `✅ Todo en orden` (sin alertas) o `⚠️ N alerta(s)` (con alertas)
- Destinatario: `gaston.otranto@gmail.com`
- Contenido: reservas viejas, stock crítico, cajas abiertas > 16h, ventas del día

---

## Invitación de usuarios

**EF `invite-user`:** usa `admin.inviteUserByEmail()` de Supabase + pre-crea el registro en `users`. No requiere que el usuario tenga contraseña previa.

---

## Links relacionados

- [[wiki/architecture/edge-functions]]
- [[wiki/features/autenticacion-onboarding]]
- [[wiki/development/supabase-dev-vs-prod]]
