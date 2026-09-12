---
title: Plataforma de Soporte (admin.genesis360.pro)
category: support
tags: [soporte, admin, panel, genesis360-admin, baja-tenant, auditoria, 2fa, billing]
sources: [genesis360-admin (repo aparte), supabase/functions/admin-api, migration 221, migration 410, migration 411]
updated: 2026-09-12
---

# Plataforma de Soporte (admin.genesis360.pro)

Panel interno de soporte/staff, **repo separado** (`genesis360-admin`, rama `dev`). El frontend nunca
usa `service_role` directo: todo pasa por `callAdminApi('modulo.accion')` contra la Edge Function
**`admin-api`**, que vive en el repo de **Genesis360** (`supabase/functions/admin-api/index.ts`), no
en el del panel. La EF valida al agente (`support_agents`, staff interno — **no** un usuario de
tenant), autoriza por rol (`admin` vs `support`) y **audita cada acceso** en `admin_audit_log`
(cimientos: mig 221, ver [[wiki/database/migraciones]]).

**Estado al 2026-09-12.** El panel **ya está en PROD** (`admin.genesis360.pro`) desde antes, con
dashboard, clientes, CRM, soporte y facturación. Lo que está **solo en DEV** es todo lo que se sumó
esta jornada: la baja de tenant, la búsqueda por mail, la ficha ampliada, las notas internas, la
auditoría, la búsqueda global, Analytics y el 2FA. Va junto con el resto del batch (migs 407-412 +
código `v1.209.0`→`v1.214.0` + EF `admin-api` + el panel), a la espera del OK de GO.

Para probarlo contra DEV sin deployar: `npm run dev` en `genesis360-admin` (su `.env.local` ya
apunta a DEV) e ingresar con un agente de rol `admin`.

---

## 1. Búsqueda y listado de tenants

Antes solo se podía filtrar por nombre de negocio. Ahora (2026-09-12):

- Búsqueda por **negocio**, **mail del dueño**, mail de **cualquier usuario** del tenant, o **id del
  tenant**.
- La lista muestra dueño + mail, **estado REAL** (una prueba vencida ya no cuenta como "en trial" —
  mismo criterio de `estadoTrial.ts` que corrigió la pantalla de planes, ver
  [[wiki/features/suscripciones-planes]]), cantidad de usuarios, último acceso y marca de **baja
  programada**.
- Filtros por estado + **export CSV**.
- **Búsqueda global Ctrl/⌘+K**.

---

## 2. Ficha del cliente (`CustomerDetailPage`)

- **Cuentas de acceso**: mail, rol, último acceso de cada usuario del tenant, con botón para
  **resetear contraseña**. ⚠ `generateLink` de Supabase **NO manda el mail** — el envío real va por
  la Edge Function `send-email`, mismo patrón que `invitar-proveedor` (ver
  [[wiki/features/portal-proveedores]]).
- **Ficha comercial + estado fiscal** del tenant.
- **Uso vs. límites del plan**, vía `fn_tenant_limite` — la MISMA función que usa el trigger que
  bloquea el `INSERT` cuando el tenant se pasa de su límite (no una copia que pueda divergir).
- **Tickets del cliente** y **actividad reciente**.
- 🛑 **Notas de crédito sin emitir en AFIP**: filas de `nc_afip_pendientes` con
  `requiere_reconciliacion_manual=true` — antes solo se veían por SQL directo. Ver
  [[wiki/features/facturacion-afip]] → "NC electrónica AFIP automática".
- **Extender la prueba** desde el panel — antes se hacía a mano con SQL contra PROD.
- **Notas internas** sobre el cliente (mig 411, tabla `admin_customer_notes`) — RLS encendida **sin
  policies** + `REVOKE` a `anon`/`authenticated` (nadie del lado tenant las ve). **Sin FK a
  `tenants`**, a propósito: si tuviera `ON DELETE CASCADE`, purgar el tenant borraría la nota que
  explica por qué se lo purgó.
- **Teléfono** (`tenants.telefono`, mig 412) como link `tel:` — ver
  [[wiki/features/autenticacion-onboarding]] → "`tenants.telefono`".

---

## 3. Baja de tenant — COMPLETA en DEV, probada 12/12

Cuatro acciones en `admin-api`: `customers.delete_preview` / `schedule_delete` / `cancel_delete` /
`purge_now`, con UI (`BajaTenantPanel.tsx`) que pide escribir el nombre exacto del negocio para
confirmar. Probada end-to-end contra DEV.

Antes de deployar se cerraron **3 agujeros de REGLA #0**:

1. **Purgar no cancelaba el preapproval de Mercado Pago** — se le seguía cobrando a un negocio ya
   borrado, y tras el `CASCADE` no queda ni el `mp_subscription_id` para encontrarlo después. Ahora
   **cancela ANTES de purgar**, fail-closed (si no puede cancelar, no purga).
2. **La cancelación estaba gateada por "¿parece que tiene un cobro?"** — ese gate salteaba
   exactamente al tenant que **nunca se linkeó** (hallazgo histórico H8/MP-C7, ver
   [[wiki/integrations/mercado-pago]]), que es el caso que `cancelarSubMP` sabe resolver buscando por
   el mail del dueño. Ahora se llama **siempre**, sin gate.
3. **Las cuentas de `auth` a borrar llegaban como una lista de UUIDs enviada DESDE el panel** — un
   payload manipulado (o un bug de UI) podía borrar la cuenta de auth de **otro** tenant. Ahora la EF
   **resuelve la lista ella misma** antes del `DELETE`, nunca toca a un agente de soporte
   (`support_agents`), y saltea a cualquier mail que siga teniendo una fila en `users` de otro tenant.

Ver también [[wiki/features/autenticacion-onboarding]] → "Mi Cuenta" (el camino del CLIENTE,
`schedule_delete` desde `/mi-cuenta`, que dependía de sacar esa ruta del `SubscriptionGuard`).

---

## 4. Auditoría (`admin_audit_log`)

La tabla se escribe desde la mig 221, pero no había pantalla para leerla — cada acceso del staff
quedaba en un ledger sin ventana. Ahora hay una pantalla de Auditoría en el panel.

⚠ El nombre del negocio se resuelve **aparte** (una consulta adicional), **NO con un embed
PostgREST**: `admin_audit_log` no tiene ni debe tener FK a `tenants`. Con `ON DELETE CASCADE`, purgar
un tenant borraría el propio registro de auditoría de su baja — el ledger tiene que sobrevivir al
borrado que audita.

**Hardening de la mig 411**: la mig 221 había dejado `admin_audit_log` con GRANT completo a
`anon`/`authenticated`, confiando solo en "RLS sin policies" como defensa. Es el mismo patrón de
fondo que corrigió la mig 272 para funciones de trigger — hay un `ALTER DEFAULT PRIVILEGES` en este
proyecto que le da `EXECUTE`/acceso a `anon`/`authenticated` sobre TODO objeto nuevo de `public` si no
se lo revoca explícitamente. La 411 agrega el mismo `REVOKE` a `admin_audit_log`.

---

## 5. Dashboard

Bloque nuevo **"Requiere atención"**: pruebas por vencer, pruebas vencidas sin convertir a plan pago,
tenants sin entrar hace +30 días, y bajas programadas.

---

## 6. Analytics

Datos reales (no mockeados). El **CAC no se muestra**: necesitaría la inversión publicitaria, que hoy
no está cargada en ningún lado.

---

## 7. Seguridad de agentes: 2FA (TOTP)

Opt-in para agentes de soporte — no obligatorio todavía.

---

## 8. Facturación (pagos manuales)

Los pagos manuales se listan ordenados por **vencimiento**, con un contador de cuántos están
vencidos. Ver [[wiki/features/pago-manual]] para el flujo completo de carga manual de staff.

---

## Testing

**18/18 e2e contra DEV**, incluidos **tests de fuga**: el RPC que devuelve mails de usuarios y las
notas internas (`admin_customer_notes`) **NO son accesibles** ni con la `anon key` ni con el token de
un usuario real de la app — solo vía `admin-api` con un agente de soporte autenticado.

---

## Pendiente

- **Login-as read-only** — sigue **501 (Not Implemented)**. Requiere un modo read-only real +
  token efímero en la app principal; queda fuera de esta tanda, merece su propio diseño.

---

## Migraciones relacionadas

| # | Qué agrega |
|---|---|
| 221 | Cimientos: `support_agents` + `admin_audit_log` + `is_staff()` |
| 410 | `fn_admin_tenants_overview(p_q, p_limit)` y `fn_admin_tenant_cuentas(p_tenant_id)` — SECURITY DEFINER, `REVOKE` de `anon`/`authenticated` + `GRANT` solo a `service_role` |
| 411 | `admin_customer_notes` (RLS sin policies, sin FK a `tenants`) + hardening de `admin_audit_log` (mismo `REVOKE` que faltaba desde la 221) |
| 412 | `tenants.telefono` |

Detalle completo de cada una en [[wiki/database/migraciones]].

---

## Links relacionados

- [[wiki/integrations/mercado-pago]] — cancelación/linkeo de suscripciones desde el panel
- [[wiki/features/pago-manual]] — carga manual de pagos por staff
- [[wiki/features/facturacion-plataforma]]
- [[wiki/features/suscripciones-planes]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/autenticacion-onboarding]]
- [[wiki/features/portal-proveedores]] — mismo patrón de envío de mail vía `send-email`
- [[wiki/database/migraciones]]
- [[wiki/architecture/guards-server-side]]
