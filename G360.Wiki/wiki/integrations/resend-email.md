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
| `bug_report` | **Ticket de soporte** — del Centro de Ayuda (`AyudaModal`) Y del Asistente IA (`AiAssistant`). Va a `soporte@genesis360.pro` (v1.100.0) |

> **Adjuntos:** la función soporta `attachments: [{ filename, content (base64) }]` (Resend). Usado por el email de OC; reutilizable para factura/estado de cuenta.

> **⚠️ El campo del payload es `type` (NO `tipo`).** Bug histórico (v1.100.0): `AiAssistant` mandaba `tipo` → la EF (`const { type } = await req.json()`) no matcheaba → `throw 'Tipo de email desconocido: undefined'` (500) → el mail nunca se enviaba, pero el `catch{}` del cliente igual marcaba "enviado" (falla silenciosa). Arreglado.

### Soporte — tickets server-side (v1.100.0)
El "Reportar un problema" del Centro de Ayuda **ya NO usa `mailto:`** (dependía del cliente de correo local del usuario → poco confiable). Ahora invoca `send-email` `type:'bug_report'` a **`soporte@genesis360.pro`**, tomando user/tenant de `useAuthStore`, con botón "Enviando…" y toast de error si falla. `bugReportTemplate` es genérico (Centro de Ayuda + IA).

---

## Configuración

**Secret:** `RESEND_API_KEY` en Supabase EF secrets (DEV + PROD). **Es la pieza crítica** — si la key está vencida/revocada, Resend devuelve **401 "API key is invalid"** y falla TODO el correo (el front muestra "Edge Function returned a non-2xx status code").

**FROM:** `Genesis360 <noreply@genesis360.pro>` — dominio **verificado** en Resend (DKIM + SPF, Cloudflare DNS). Definido en `supabase/functions/send-email/index.ts`. `send-email` desplegada **DEV v23 / PROD v26** (`verify_jwt` ON).

### 📧 Direcciones del proyecto (recepción = Cloudflare Email Routing)
| Dirección | Rol | Recepción |
|---|---|---|
| `noreply@genesis360.pro` | **FROM** de TODOS los emails (Resend) | no recibe (solo envío) |
| `soporte@genesis360.pro` | **Soporte** (tickets + contacto) | Cloudflare → **Google Group `genesis360-soporte@googlegroups.com`** → GO + socio |
| `hola@genesis360.pro` | `BRAND.email` — contacto del Landing | Cloudflare → gmail de GO (ACTIVE) |

> **Fan-out a varios destinatarios:** Cloudflare Email Routing reenvía **1 regla → 1 destino**. Para que `soporte@` llegue a **varias** personas se usa un **Google Group** como destino (membresía manejada en groups.google.com, **fuera del código** — el código siempre manda a `soporte@`). El grupo debe tener "Quiénes pueden publicar = Cualquier usuario en la Web" para aceptar el correo externo (de `noreply@` / reenvíos). Cuando el equipo de soporte crezca/cambie, se edita el grupo, no el código.

### 🎨 Branding del email (v1.100.0)
`templateBase` usa el **degradé de marca violeta→cian** en el header (`background:#7B00FF; background-image:linear-gradient(135deg,#7B00FF,#06B6D4)` — el `background` sólido es el fallback para Outlook, que no renderiza gradientes) + **logo** (`https://www.genesis360.pro/android-chrome-192x192.png` — URL directa 200; `genesis360.pro` da 308) + tagline **"El inventario inteligente para tu negocio"**. `.btn`/`.tag`/`.total-row` en violeta `#7B00FF`. Antes era navy `#1E3A5F` + tagline "El cerebro de tu negocio". **Encoding:** `<meta charset="UTF-8">` + source UTF-8 → acentos/emojis OK (los `�` que aparecían en tests por `curl -d` inline eran mangling del shell de Windows, no bug del app).

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
