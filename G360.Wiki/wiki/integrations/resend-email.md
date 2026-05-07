---
title: Emails Transaccionales — Resend
category: integrations
tags: [resend, email, transaccional, edge-function, notificaciones]
sources: [CLAUDE.md]
updated: 2026-04-30
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
| `venta_confirmada` | Al despachar una venta |
| `alerta_stock` | Cuando se dispara alerta de stock mínimo |

---

## Configuración

**Secret:** `RESEND_API_KEY` en Supabase EF secrets (DEV + PROD)

**FROM actual:** `onboarding@resend.dev` (temporal)

> [!WARNING] Pendiente: cambiar a `noreply@genesis360.pro` cuando se verifique el dominio genesis360.pro en el dashboard de Resend.

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
