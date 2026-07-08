---
title: Cancelación autónoma + botón de arrepentimiento (Ley 24.240 / click-to-cancel)
category: features
tags: [billing, mercadopago, cancelacion, arrepentimiento, refund, legal]
sources: [supabase/functions/cancel-suscripcion/index.ts, src/pages/MiCuentaPage.tsx, src/lib/arrepentimiento.ts, supabase/migrations/260_plan_upgrade_batch_arrepentimiento.sql]
updated: 2026-07-07
---

# ⚖️ Cancelación autónoma + Arrepentimiento (refund total ≤10 días)

> Estado: **🏗 EN DEV (v1.121.0, 2026-07-07)** — mig 260 aplicada en DEV, EF
> `cancel-suscripcion` v2 deployada en DEV. Pendiente: validación e2e con pago real +
> deploy PROD. Objetivo legal: Ley de Defensa del Consumidor 24.240 art. 34 (botón de
> arrepentimiento, 10 días corridos) + regla "click-to-cancel" (baja sin intervención
> humana). Mercado Pago NO tiene un Customer Portal tipo Stripe para preapprovals →
> todo el flujo va por nuestra UI + API de MP.

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
