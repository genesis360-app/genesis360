---
title: Emails Transaccionales — Resend
category: integrations
tags: [resend, email, transaccional, edge-function, notificaciones]
sources: [CLAUDE.md]
updated: 2026-09-15
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
| `bug_report` | **Ticket de soporte** — del Asistente IA (`AiAssistant`). Va a `soporte@genesis360.pro` (v1.100.0) |
| `soporte_consulta` | 🆕 **2026-09-15 (mig 426).** Consulta de soporte creada o respondida desde **Ayuda → Mis consultas** (`/ayuda/consultas`, "Reportar un problema"). Siempre a `soporte@genesis360.pro`, con link directo al ticket en el panel; el asunto distingue "Nueva consulta" de "Respuesta del cliente" (`es_respuesta`). Invocación **fire-and-forget** desde `src/lib/soporteApi.ts` (el ticket ya quedó guardado por la RPC antes de mandar el mail: si el mail falla, el panel lo marca "pendiente" igual) |

> **Adjuntos:** la función soporta `attachments: [{ filename, content (base64) }]` (Resend). Usado por el email de OC; reutilizable para factura/estado de cuenta.

> **⚠️ El campo del payload es `type` (NO `tipo`).** Bug histórico (v1.100.0): `AiAssistant` mandaba `tipo` → la EF (`const { type } = await req.json()`) no matcheaba → `throw 'Tipo de email desconocido: undefined'` (500) → el mail nunca se enviaba, pero el `catch{}` del cliente igual marcaba "enviado" (falla silenciosa). Arreglado.

### Soporte — tickets server-side (v1.100.0)
El "Reportar un problema" del Asistente IA (`AiAssistant`) **ya NO usa `mailto:`** (dependía del cliente de correo local del usuario → poco confiable). Invoca `send-email` `type:'bug_report'` a **`soporte@genesis360.pro`**, tomando user/tenant de `useAuthStore`, con botón "Enviando…" y toast de error si falla.

> **🆕 2026-09-15 (mig 426): el "Reportar un problema" del Centro de Ayuda (`AyudaModal`) migró de `bug_report` a un ticket real.** Ya no es solo un mail: crea una fila en `support_tickets` (RPC `fn_soporte_crear_consulta`) que el cliente puede seguir y responder desde `/ayuda/consultas` — el mail (`type:'soporte_consulta'`, arriba) es un aviso al equipo, no el registro. `bugReportTemplate` sigue siendo el único consumidor del Asistente IA; `soporteConsultaTemplate` es el de Ayuda. Detalle completo del flujo en [[wiki/support/plataforma-soporte]] → sección 10.

---

## Configuración

**Secret:** `RESEND_API_KEY` en Supabase EF secrets (DEV + PROD). **Es la pieza crítica** — si la key está vencida/revocada, Resend devuelve **401 "API key is invalid"** y falla TODO el correo (el front muestra "Edge Function returned a non-2xx status code").

**FROM:** `Genesis360 <noreply@genesis360.pro>` — dominio **verificado** en Resend (DKIM + SPF, Cloudflare DNS). Definido en `supabase/functions/send-email/index.ts`. `send-email` desplegada en DEV y PROD (`verify_jwt` ON, PROD en v30 desde el hardening de abajo).

> [!CAUTION] **🔒 2026-09-15: `send-email` YA NO se puede usar como relay de mail — fix deployado en DEV Y PROD (commit `6dbaf377`).** Tener `verify_jwt` encendido no alcanzaba: la clave **anon** pública de la app ya es un JWT válido, así que **cualquiera** podía invocar la EF y mandar mail con el remitente de Genesis360, al destinatario que quisiera, con HTML propio en `data` (phishing con el dominio propio + consumo de la cuota de Resend). Ahora (`supabase/functions/send-email/seguridad.ts`):
> - Solo entran un usuario con **sesión real** y fila en `users`, o el **servidor** (la clave de servicio que usan las otras Edge Functions para reportes/notificaciones/OC).
> - **Destinatario acotado por tipo**: `bug_report`/`soporte_consulta` siempre a `soporte@genesis360.pro` (nunca a un `to` arbitrario), `welcome` solo al mail del propio usuario que llama, `invitacion_proveedor` solo invocable desde el servidor.
> - **Negocio y usuario salen de la base** (`users`/`tenants`), no del payload del pedido — no se puede falsear "de parte de quién" sale el mail.
> - Todo lo que viene en `data` se **escapa** antes de inyectarse en el HTML; los links internos tienen que ser rutas de la propia app (`//evil.com` y `@evil.com` se rechazan, típicos de un bypass de validación de URL).
> - Tope de cantidad de destinatarios y de adjuntos.
> - 12 unit tests (`tests/unit/sendEmailSeguridad.test.ts`). De paso: el embed `tenants(nombre)` desde `users` es ambiguo (PGRST201, 2 relaciones) — se consulta por separado.
>
> Verificado en DEV (anon 401, tipo reservado 403, link externo 400, servicio 400 por validación, reporte con destinatario ajeno → forzado a `soporte@`) y en PROD sin mandar mails reales (anon 401, servicio 400, tipo inexistente 400).

### 📧 Direcciones del proyecto (recepción = Cloudflare Email Routing)
| Dirección | Rol | Recepción |
|---|---|---|
| `noreply@genesis360.pro` | **FROM** de TODOS los emails (Resend) | no recibe (solo envío) |
| `soporte@genesis360.pro` | **Soporte** (tickets + contacto) | Cloudflare → **Google Group `genesis360-soporte@googlegroups.com`** → GO + socio |
| `hola@genesis360.pro` | `BRAND.email` — contacto del Landing | Cloudflare → gmail de GO (ACTIVE) |

> **Fan-out a varios destinatarios:** Cloudflare Email Routing reenvía **1 regla → 1 destino**. Para que `soporte@` llegue a **varias** personas se usa un **Google Group** como destino (membresía manejada en groups.google.com, **fuera del código** — el código siempre manda a `soporte@`). El grupo debe tener "Quiénes pueden publicar = Cualquier usuario en la Web" para aceptar el correo externo (de `noreply@` / reenvíos). Cuando el equipo de soporte crezca/cambie, se edita el grupo, no el código.

> [!CAUTION] **🛑 Gotcha reusable — el circuito Resend → `soporte@` → Google Group puede fallar SILENCIOSAMENTE fuera del código (hallado y arreglado 2026-07-08).** Validando e2e la alerta `sin_biller` de `emitir-factura-plataforma` (patrón "Resend directo sin tabla", el mismo que usan `mp-reconciliacion` §3.h y la alerta inline de `mp-webhook` para batch de add-ons pagado-sin-aplicar) se descubrió que **ninguna alerta de este canal llegaba a nadie** desde que esas features existen (los smokes previos siempre dieron "0 hallazgos", así que nunca se había disparado una alerta real hasta esta sesión). Root cause real, en cadena (Resend responde 200 igual aunque falle más adelante):
> 1. **`soporte@genesis360.pro` estaba en la suppression list de la cuenta de Resend** (se cae ahí solo con un bounce duro anterior) → Resend ni intentaba enviar. **Fix:** sacada de la suppression list desde el dashboard de Resend (Suppressions).
> 2. **Faltaba el registro DMARC** en el DNS del dominio remitente → Resend marcaba el dominio "Needs attention" en Insights y Google desconfiaba del remitente. **Fix:** agregado `_dmarc.genesis360.pro` TXT `v=DMARC1; p=none; rua=mailto:soporte@genesis360.pro` (verificar con `dig`/`nslookup` contra `1.1.1.1`; el caché negativo de `8.8.8.8` puede tardar en expirar, no es indicador confiable). Con (1)+(2) corregidos, el segundo mail de prueba pasó a **"Delivered"** en Resend y **"Forwarded"** en el Activity Log de Cloudflare Email Routing.
> 3. **Aun así, el mensaje quedó retenido en "Pendientes de moderación"** del Google Group destino (`genesis360-soporte@googlegroups.com`) pese a que la política general "Moderación de mensajes" ya estaba en "Sin moderación" (no se tocó, ya estaba así de antes) — la causa más probable es el filtro de SPAM automático de Google ("Tratamiento de mensajes de spam", control separado de la moderación general), típico para un remitente nuevo/sin reputación. No hay una acción de configuración clara para evitarlo; GO aprobó el mensaje a mano desde el panel del grupo. **Puede repetirse en los primeros envíos** hasta que `noreply@genesis360.pro` acumule reputación con Google — no asumir que es un bug si un mail queda pendiente de aprobación las primeras veces.
>
> (1) y (2) ya corregidos en DEV y PROD (dominio de email único, no depende del entorno). Cualquier feature nueva que alerte a soporte por este canal (Resend directo, sin pasar por `send-email`) hereda este gotcha — chequear suppression list + DMARC + moderación/spam del grupo ANTES de asumir que "no llegó nada" significa que el código está mal.

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
