---
title: Motor de pago MANUAL (billing_mode) — transferencia/efectivo/MP sin auto-débito
category: features
tags: [billing, mercadopago, pago-manual, precio-dual]
sources: [supabase/migrations/262_billing_manual.sql, supabase/functions/billing-manual-pagar, supabase/functions/billing-manual-avisar-pago, supabase/functions/billing-manual-sweep, src/lib/facturacionManual.ts]
updated: 2026-09-15
---

# 💳 Pago manual (`billing_mode`)

> Estado: **✅ 100% en PROD (mig 262 + EFs `billing-manual-pagar`/`billing-manual-avisar-pago`/
> `billing-manual-sweep`, release v1.123.0)** — código mergeado a `main` (PR #278 + #279) +
> tag/GitHub release publicados + Vercel `READY` en ambos proyectos, confirmado 2026-07-09. Ningún
> tenant real está en modo manual todavía. 🆕 **Mig 428 (2026-09-15, DEV, sin PROD): el cliente se
> entera cuando el equipo registra su pago** — ver más abajo.

## Qué es

Alternativa a la suscripción automática de MP (`billing_mode='auto'`, -10% de descuento): un
tenant puede pagar **mes a mes, a precio de lista**, por transferencia, efectivo, o un pago único
de MP sin comprometerse al auto-débito. GO lo pidió para dar flexibilidad de medios de pago sin
depender de que MP soporte todo (transferencia bancaria directa no pasa por MP en absoluto).

## Modelo

- `tenants.billing_mode` (`'auto'`|`'manual'`) + `manual_monto_mensual` (precio de LISTA
  congelado al momento del switch — $60k Básico/$100k Pro, `PRECIO_LISTA` en `brand.ts`) +
  `manual_paid_until` (hasta cuándo está pago).
- **El único gate de acceso sigue siendo `subscription_status`** (`active`/`inactive`) —
  `src/lib/accesoSuscripcion.ts` y `SubscriptionGuard` **no se tocaron**. El sweep de vencimiento
  flipea el status igual que ya hace `mp-webhook` para el modo auto — mismo mecanismo, otra
  fuente.
- **El monto nunca sale del cliente.** `fn_activar_billing_manual(tenant_id)` (SECURITY DEFINER)
  deriva el precio de lista server-side del `plan_tier` actual — ni siquiera al PASAR a modo
  manual el cliente puede mandar un monto arbitrario (cerraría un hueco real: `billing-manual-pagar`
  cobra `manual_monto_mensual` tal cual está en DB).
- `billing_manual_pagos`: historial de pagos. Única puerta de escritura:
  `fn_registrar_pago_manual` (SECURITY DEFINER) — extiende `manual_paid_until` desde el mayor
  entre "ahora" y el vencimiento actual (pagar antes de vencer no pierde días) y reactiva
  `subscription_status` si estaba `inactive`.

## Tres formas de pagar

1. **"Pagar ahora" (MP, pago único)** — EF `billing-manual-pagar`: preference de MP por
   `manual_monto_mensual`, **no** una suscripción recurrente — el cliente vuelve a pagar el mes
   que viene. Confirmado por la rama nueva `|manualpago|` en `mp-webhook`, idempotente por
   `mp_payment_id` (índice único parcial).
2. **Transferencia directa + "Avisé que ya pagué"** — datos fijos en `brand.ts`
   (`DATOS_TRANSFERENCIA`: alias `DIA.SIGNO.CHASIS`, CBU de Fede, Banco Galicia), mostrados en Mi
   Cuenta. El botón llama a `billing-manual-avisar-pago`, que **NO extiende el acceso por sí
   solo** (fail-closed: nadie se auto-activa) — crea un ticket en `support_tickets`
   (`creado_por=NULL`, es el cliente quien avisa, no un agente) que aparece directo en la cola de
   soporte de `genesis360-admin`.
3. **Carga manual de staff** — 3 acciones nuevas en `admin-api`: `billing.manual_tenants_list`,
   `billing.manual_history`, `billing.manual_record_payment` (esta última sí extiende el acceso,
   vía `fn_registrar_pago_manual`). UI en `genesis360-admin/src/pages/BillingPage.tsx`.

Las 3 formas, al confirmar un pago, disparan `emitir-factura-plataforma` (ver
[[facturacion-plataforma]]) — Fede factura automáticamente cada cobro.

## 💬 El cliente se entera cuando el equipo registra su pago (mig 428, 2026-09-15, **DEV**, sin PROD)

Antes, `fn_registrar_pago_manual` extendía el acceso pero no avisaba a nadie: el cliente se enteraba de casualidad
(entrando a `/mi-cuenta`) o si alguien del equipo le escribía a mano. Decisión de GO: avisar siempre.

Después de registrar el pago, **en una subtransacción** (si el aviso falla, el pago igual queda registrado —
nunca al revés):
1. Cada consulta tipo `pago` que estuviera abierta ("Ya transferí", creada por `billing-manual-avisar-pago`)
   recibe un mensaje del equipo — *"Registramos tu pago. Tu acceso quedó activo hasta el DD/MM/AAAA. ¡Gracias!"*
   — y queda `resuelto`. A quien avisó le llega por el mismo trigger que ya avisaba respuestas de soporte
   (migs 425/426), con link a la consulta.
2. Campanita **"Recibimos tu pago"** (link a `/mi-cuenta`) a **todos** los DUEÑO y SUPER_USUARIO activos del
   tenant que no se enteraron por la consulta (para que no dependa de que haya sido justo quien avisó).
3. `admin-api` (`billing.manual_record_payment`) manda además un **mail** (`send-email` tipo `notificacion`) al
   dueño, al super usuario y a quien avisó — deployada en **DEV**, redeploy a **PROD pendiente**. El mail no se
   probó de punta a punta porque requiere un agente real operando el panel.

Verificado por SQL en DEV (todo revertido después): pago registrado y `manual_paid_until` extendido; reintento
del mismo `mp_payment_id` sigue fallando por `unique_violation` (la idempotencia de `mp-webhook` no se tocó);
consulta "Ya transferí" pasa a `resuelto` con `pendiente_equipo=false`; aviso a quien avisó con link a la
consulta; 2 DUEÑO reciben "Recibimos tu pago"; el cajero que avisó no recibe el aviso duplicado (solo el mensaje
de la consulta). `migration-reviewer`: **APTA**.

## Sweep de vencimiento

`billing-manual-sweep` (cron horario, mismo workflow que `mp-reconciliacion`). Lógica pura
testeada en `src/lib/facturacionManual.ts` (`decidirSweepManual`, 12 unit tests):
- Recordatorio por email **5 días y 1 día** antes de `manual_paid_until` (dedupe por
  `manual_ultimo_recordatorio_tipo` — el sweep corre cada hora, no puede spamear).
- **Gracia de 5 días** tras el vencimiento sin pago nuevo.
- Pasada la gracia → `subscription_status='inactive'` + email de suspensión.

**Bug real encontrado y corregido durante el desarrollo:** el dedupe por tipo exacto de
recordatorio podía hacer que el de "5 días" **reviviera** después de mandado el de "1 día" (ambos
umbrales se cruzan a la vez cerca del vencimiento, y el loop original devolvía el primero que
matcheaba en vez del más urgente). Fix: se queda con el tier **más urgente** ya alcanzado, no el
primero del array — cubierto por un test específico.

## Precio dual (relacionado)

`PLANES[].precio` (con -10%, el número destacado) + `precioManual` (lista) en `brand.ts` —
Landing, tarjetas de `/suscripcion` y el estimador "Armá tu plan" muestran ambos números. El modo
`app` del configurador (Fase 2 del batch, que usa precios reales de MP) no se tocó.

## Pendiente

- Botón de cancelación específico para modo manual (hoy solo se puede dejar de pagar y que
  lapsee naturalmente, o volver a `auto` y cancelar desde ahí).
- Conciliación de extracto bancario (Parte 4 del plan) — documentada, no implementada, falta un
  export real de Banco Galicia para confirmar el formato de columnas.
