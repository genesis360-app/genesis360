---
title: Cancelación autónoma + botón de arrepentimiento (Ley 24.240 / click-to-cancel)
category: features
tags: [billing, mercadopago, cancelacion, arrepentimiento, refund, legal, hard-delete, grace-period]
sources: [supabase/functions/cancel-suscripcion/index.ts, src/pages/MiCuentaPage.tsx, src/lib/arrepentimiento.ts, supabase/migrations/260_plan_upgrade_batch_arrepentimiento.sql, supabase/migrations/358_hard_delete_grace_period.sql, src/lib/tenantHardDelete.ts, src/components/layout/AppLayout.tsx, supabase/functions/tenant-hard-delete-sweep/index.ts]
updated: 2026-08-13
---

# ⚖️ Cancelación autónoma + Arrepentimiento (refund total ≤10 días)

> Estado: **✅ 100% en PROD (mig 260 + EF `cancel-suscripcion` v2, release v1.123.0)** — código
> mergeado a `main` (PR #278 + #279) + tag/GitHub release publicados + Vercel `READY` en ambos
> proyectos, confirmado 2026-07-09. Pendiente: validación e2e con pago real en PROD (no se hizo
> todavía). Objetivo legal: Ley de Defensa del
> Consumidor 24.240 art. 34 (botón de arrepentimiento, 10 días corridos) + regla "click-to-cancel"
> (baja sin intervención humana). Mercado Pago NO tiene un Customer Portal tipo Stripe para
> preapprovals → todo el flujo va por nuestra UI + API de MP.

## 1. Lógica condicional (Mi Cuenta → Mi Plan)

| Condición | Criterio (server-side) | UI | Efecto al confirmar |
|---|---|---|---|
| **A — Arrepentimiento** | `now ≤ tenants.primera_compra_at + 10 días corridos` | Botón destacado ámbar "Arrepentirse de la compra (reembolso)" (además del estándar) | Refund TOTAL de todos los pagos → cancela preapproval → **acceso revocado YA** (`subscription_period_end = now()`) |
| **B — Estándar** | fuera de la ventana (o nunca pagó) | Botón "Cancelar suscripción" | Sin reembolso; cancela preapproval; acceso hasta la **fecha exacta** del fin de ciclo (grace MP-C9) |

- **`tenants.primera_compra_at`** (mig 260): lo setea el trigger `fn_set_primera_compra` en
  la PRIMERA transición a `active` con `mp_subscription_id` — cubre los 3 caminos de
  activación. Solo si estaba NULL → renovaciones, upgrades o re-suscripciones **NO** re-abren
  la ventana. Tenants activados antes de la mig quedan NULL (no elegibles — no hay ventana
  retroactiva).
- La UI decide qué botón mostrar con `elegibleArrepentimiento(tenant.primera_compra_at)`
  (espejo `src/lib/arrepentimiento.ts`), pero **el EF revalida server-side** (UI cacheada no
  puede forzar un refund fuera de plazo → 400 `fuera_de_plazo`).

## 2. EF `cancel-suscripcion` — acciones

- **`action:'preview'`** (sin efectos): `{ period_end_estimado (next_payment_date real),
  elegible_arrepentimiento, arrepentimiento_hasta }` → los modales muestran la fecha exacta
  del próximo vencimiento (requisito del spec) y la elegibilidad real.
- **`action:'arrepentimiento'`** (solo DUEÑO, solo la propia cuenta):
  1. Revalida la ventana de 10 días.
  2. Junta TODOS los pagos de plataforma del tenant: cuotas del preapproval
     (`GET /authorized_payments/search?preapproval_id=`), deltas de batch
     (`addon_batch_changes.mp_payment_id`) y packs temporales (`tenant_addons.mp_payment_id`).
  3. **Refund total idempotente**: por cada pago hace `GET /v1/payments/{id}` y solo
     reembolsa aprobados con remanente (`POST /v1/payments/{id}/refunds` +
     `X-Idempotency-Key`). Ya-reembolsados se saltean → el retry tras una falla parcial
     nunca devuelve dos veces (🛑 REGLA #0).
  4. **Fail-closed**: si algún refund falla → 502 y NO se cancela nada (los refunds ya
     hechos quedan; reintentar es seguro).
  5. Refunds OK → cancela el/los preapproval(s) (mismo circuito fail-closed de siempre) →
     `subscription_status='cancelled'` + `subscription_period_end=now()` (el
     SubscriptionGuard corta el acceso al instante).
- **default (cancelación estándar)**: flujo MP-C1..C11 intacto (fail-closed + grace MP-C9).

## 3. Log legal — `billing_cancelaciones` (mig 260)

Toda solicitud (ambos tipos) inserta `{tenant_id, user_id, tipo:
'arrepentimiento'|'cancelacion_estandar', detalle: {preapproval_id, mp_cancelled,
period_end, refunds[], monto_reembolsado}, created_at}`. Solo `service_role`. El insert
NO bloquea la baja (si falla → console.error, la baja ya está hecha).

## 4. Pendientes / decisiones

- **PIN de verificación por email/SMS (Disp. 3/2026, opcional en el spec): NO implementado.**
  Guard actual = modal de confirmación + rol DUEÑO + revalidación server-side. Decidir GO.
- Validación e2e con pago real (el refund necesita un pago aprobado de verdad).
- Texto legal de los modales: revisar con el abogado junto con T&C (mig 249).
- UAT: `tests/specs/mp-suscripciones-pagos.plan.md` §10.d (AR-1..AR-7).

## 5. 🆕 Hard delete de tenant con grace period (mig 358, 2026-08-13)

> Estado: **✅ 100% EN PROD (mig 358, release v1.170.0, 2026-08-13)** — construido y verificado en DEV,
> deployado junto con la NC AFIP automática y 10 diagramas de flujo en un solo commit/PR (#330, mergeado
> a `main`). Distinto de la cancelación de arriba: esto es el botón
> "Eliminar cuenta y negocio" de **Mi Cuenta → zona de riesgo**, que borra el TENANT completo (no solo
> la suscripción). Antes hacía un soft delete inmediato (borraba `users` + marcaba
> `subscription_status='cancelled'`) sin ninguna purga real de los datos — pendiente anotado desde el
> 2026-08-04 ("auditoría de FKs hecha... NO se construyó el flujo").

**Flujo (antes vs. ahora):**

| | Antes (soft delete) | Ahora (mig 358) |
|---|---|---|
| `users` | se borraba al instante | **NO se borra** — el dueño sigue pudiendo loguearse |
| Datos del tenant | quedaban en la DB para siempre, sin purga | se borran de verdad a los 30 días (CASCADE) |
| Reactivación | imposible (ya no había `users`) | **self-service**: cancelar la baja iniciando sesión |
| Suscripción MP activa | se cancelaba | sigue igual — se cancela ANTES de programar la baja (fail-closed, REGLA #0) |

**3 decisiones de diseño confirmadas con GO** (reactivación self-service, sin export ZIP automático —
ya existen exports por módulo en Excel, 30 días de gracia).

**Mecanismo:**
- `tenants.delete_scheduled_at timestamptz` (NULL = sin baja programada) — `MiCuentaPage.tsx` lo setea
  a `NOW() + 30 días` en vez de borrar `users`; NO toca `subscription_status` para trial/free (el dueño
  conserva acceso normal durante la ventana).
- Banner global rojo en `AppLayout.tsx` (mismo mecanismo que `showTrialBanner`), visible solo para
  `rol='DUEÑO'`, con días restantes + botón "Cancelar eliminación" desde cualquier página.
- `src/lib/tenantHardDelete.ts` → `cancelarBajaProgramada()`, reusada por el banner y por el panel de
  MiCuentaPage (setea `delete_scheduled_at=null` + email de confirmación).
- Edge Function `tenant-hard-delete-sweep` (deployada a DEV, `verify_jwt: false`) +
  `.github/workflows/tenant-hard-delete-sweep.yml` (cron diario `0 6 * * *`, GitHub Actions — no hay
  pg_cron habilitado, mismo patrón que `repositores-cierre-dia-sweep`): busca tenants con
  `delete_scheduled_at` vencido y hace el `DELETE FROM tenants` real; el `ON DELETE CASCADE` de las
  ~140 FK a `tenant_id` borra todo lo demás (productos, ventas, inventario, cajas, etc.).

**🛑 Bloqueo técnico real encontrado al auditar (REGLA #0):** de las ~140 FK a `tenant_id`, todas
tenían `ON DELETE CASCADE` **excepto `autorizaciones`** (`NO ACTION` — mismo gap ya detectado en la
auditoría del 2026-08-04, entonces la tabla se llamaba `autorizaciones_inventario`; el rename de la
mig 347 no la tocó). Sin el fix, el `DELETE FROM tenants` del sweep habría fallado con cualquier
tenant que tuviera una fila en `autorizaciones`. Corregido en la misma mig 358.

**Decisión consciente de alcance (deuda técnica menor, documentada):** el sweep NO borra las cuentas
de Supabase Auth de los ex-usuarios del tenant (quedan huérfanas, sin acceso a nada) — el riesgo de
borrar por error una cuenta STAFF/ADMIN cross-tenant (`rol='ADMIN'` = staff interno con acceso a
múltiples tenants, aislado desde la mig 254) supera el beneficio de limpieza automática.

**Verificación real contra DEV:** flujo completo con Playwright (programar → banner con fecha exacta
+30 días verificada por SQL → cancelar desde el banner → `delete_scheduled_at` vuelve a NULL,
verificado por SQL; la app permanece 100% funcional durante toda la ventana). Sweep de purga probado
de punta a punta con un tenant descartable (`__TEST_HARD_DELETE_DESCARTABLE__`) + una fila de prueba
en `autorizaciones`: invocado por curl, el tenant y la fila desaparecieron (CASCADE + fix del FK
funcionando); reinvocado, 0 evaluados (no reprocesa lo ya purgado). Typecheck + `vite build` + 1563
tests unitarios verdes.

**Deploy verificado de forma independiente (2026-08-13):** `gh pr view 330` → `MERGED`; `gh release
view v1.170.0` → publicado sobre `main`; migración 358 aplicada en PROD (`jjffnbrdjchquexdfgwq`); Edge
Function `tenant-hard-delete-sweep` deployada a PROD + workflow `.github/workflows/
tenant-hard-delete-sweep.yml` (cron diario) recién ahora activo en `main`. Ver
`sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ") y `wiki/database/migraciones.md` (mig 358) para el
detalle completo.
