---
title: Facturación automática de ingresos de PLATAFORMA (Fede, monotributo)
category: features
tags: [afip, facturacion, monotributo, mercadopago, billing]
sources: [supabase/functions/emitir-factura-plataforma, supabase/functions/platform-facturacion-sweep, supabase/migrations/261_platform_billing_fede.sql]
updated: 2026-07-09
---

# 🧾 Facturación automática de plataforma (Fede)

> Estado: **✅ 100% en PROD (mig 261 + EFs `emitir-factura-plataforma`/
> `platform-facturacion-sweep`, release v1.123.0)** — código mergeado a `main` (PR #278 + #279) +
> tag/GitHub release publicados + Vercel `READY` en ambos proyectos, confirmado 2026-07-09. Código
> completo y **validado e2e en DEV el camino `sin_biller`** (ver sección abajo). **Bloqueado en la
> práctica hasta que Fede configure `platform_billers`** — sin eso el sistema alerta a soporte y no
> factura (fail-open, nunca bloquea el cobro). Esto no cambió con el cierre del deploy: la infra ya
> está en PROD esperando esos datos.
>
> **Guía concreta para Fede (confirmado en código 2026-07-09,
> `supabase/functions/emitir-factura/providers.ts:24-31`):** para el provider **AfipSDK** (el que
> usa Fede) el **certificado NO es obligatorio** — solo aplica al circuito "propio" (WSFE
> directo, todavía un stub sin implementar). Solo falta el **token de AfipSDK**. 3 pasos, todos
> fuera de Genesis360: (1) crear cuenta en **afipsdk.com** con el CUIT `20-42237416-8` (ellos
> gestionan la generación/vínculo del certificado ante AFIP en su propio flujo); (2) habilitar un
> **punto de venta para Facturación Electrónica** en AFIP/ARCA (Administrador de Relaciones de
> Clave Fiscal); (3) obtener el **token de API** desde el dashboard de afipsdk.com. Con esos 3
> datos (+ CUIT/razón social/domicilio ya conocidos), Claude carga la fila en `platform_billers`
> directo por SQL — la tabla no tiene UI propia (ni en `genesis360-admin`, cero referencias), es
> `service_role`-only por RLS.

## Por qué existe

El collector de Mercado Pago de la plataforma es la cuenta personal de **Federico Ezequiel
Messina** (CUIT `20-42237416-8`, Monotributo Categoría A, Locaciones de Servicios). Se hizo
monotributista específicamente para poder facturar legalmente el dinero que le entra por
suscripciones — plata que, desde el cambio de cuenta MP (v1.119.0), **ya está entrando en
producción sin facturar**.

## Diseño

**No es un `tenants`.** `emitir-factura` (el motor existente) lee config AFIP de columnas de
`tenants` — meter a Fede ahí lo haría aparecer en `customers.list`/`metrics.overview`/sweeps
pensados para negocios reales. En su lugar, tabla dedicada y liviana:

- **`platform_billers`**: cuit, razón social, domicilio fiscal, `condicion_iva_emisor`
  (`'Monotributista'` por defecto → siempre Factura C), punto de venta, `afipsdk_token`,
  certificado (mismo bucket `certificados-afip`), `afip_provider` (mismo flag dual-provider que
  ya existe — hoy `'afipsdk'`, el motor propio sigue siendo un stub). Solo `service_role`.
- **`platform_facturas`**: comprobantes emitidos (monto, concepto, CAE, `payment_ref` de origen,
  `tenant_origen_id` — solo trazabilidad informativa, no dato fiscal).
- **`platform_facturas_claims`**: idempotencia **antes** de llamar a AFIP (no solo al persistir
  el resultado) — un `payment_ref` ya reclamado no vuelve a pedir CAE. Un reintento de webhook o
  una doble corrida del sweep nunca duplica una factura (irreversible sin nota de crédito).

**EF `emitir-factura-plataforma`** (solo `service_role`, la llaman otras EFs internamente):
reusa el transporte AfipSDK ya probado (`emitir-factura/providers.ts`, `makeAfipProvider`) con
un payload mucho más simple que el de `emitir-factura` — Factura C con Monotributista es
**siempre** Consumidor Final (`DocTipo=99/DocNro=0`), sin excepción y sin exigir identificar al
comprador (confirmado en `src/lib/facturacionLogic.ts`). `Concepto=2` (Servicios, la actividad
real de Fede) con `FchServDesde/Hasta/VtoPago`. **Fail-OPEN ante error de AFIP** — a propósito,
distinto del resto de REGLA #0: el cobro YA se confirmó cuando se llama a esta EF, no hay que
bloquear el pago/webhook si AFIP está caído — se alerta a soporte para facturar a mano.

**Trigger — 3 puntos, todos disparan la factura:**
1. **Sweep `platform-facturacion-sweep`** (cron horario, mismo workflow que
   `mp-reconciliacion`): los webhooks `payment` de una renovación de suscripción MP vienen con
   `external_reference` **vacío** (mismo gotcha MP-W6 documentado para la activación) — en vez de
   adivinar el payload exacto de un evento de renovación, el sweep busca los pagos aprobados
   reales de cada tenant activo en modo auto (`authorized_payments/search`, mismo endpoint que
   `mp-batch-sweep`) y factura los que no estén todavía en `platform_facturas`. Cubre altas
   nuevas y renovaciones mensuales por igual, sin depender de la forma del webhook.
2. Pago único de MP en modo manual (`mp-webhook`, rama `|manualpago|`).
3. Carga manual de staff (`admin-api.billing.manual_record_payment`).

**Vigilancia del techo de categoría:** Monotributo Categoría A tiene un techo de facturación
anual bajo. Contador "Facturado a Fede este año" en `genesis360-admin` (BillingPage) — aviso, no
bloqueo.

## Decisión de arquitectura AFIP

Se usa **AfipSDK** (el circuito que ya funciona en producción) vía el mecanismo dual-provider ya
existente (`afip_provider` en `platform_billers`, mismo patrón que `tenants.afip_provider`). El
motor **propio** (WSAA + WSFEv1 directo, sin AfipSDK) sigue siendo un stub
(`WsfePropioProvider` rechaza todo con `"WSFE propio todavía no está implementado"`) — construirlo
es un proyecto aparte (crypto CMS/PKCS#7 + SOAP), no se hizo ahora. Cuando esté listo, cambiar a
Fede a `'propio'` es solo tocar el flag — cero migración de código.

## Validación e2e (2026-07-08)

**Camino `sin_biller` validado end-to-end en DEV**, con `platform_billers` vacío (0 filas, a
propósito). Flujo real ejecutado desde `genesis360-admin` (rol `admin` en `support_agents`) →
BillingPage → "Registrar pago" sobre el tenant de prueba `ZZZ_VALIDACION_CLAUDE`
(`26fa1644-e03d-4c9f-b8f7-173834cd7b34`, DEV) en `billing_mode='manual'` → `admin-api` acción
`billing.manual_record_payment` → RPC `fn_registrar_pago_manual` → `emitir-factura-plataforma`.
Verificado en DB: `billing_manual_pagos` recibió la fila del pago ($60.000, transferencia) y
`tenants.manual_paid_until` se extendió correctamente **pese a que la factura no se pudo
emitir** — el pago queda en firme (fail-open correcto, cumple REGLA #0: la plata nunca se
pierde). `platform_facturas_claims` recibió el claim del `payment_ref` (formato
`staff-<tenantId>-<timestamp>`) y `platform_facturas` se mantuvo en 0 filas (no se emitió nada,
correcto). Logs de `admin-api` y `emitir-factura-plataforma`: HTTP 200 sin excepciones,
consistente con la rama `reason:'sin_biller'`.

En el camino se encontró y arregló un bug de infraestructura no relacionado con el código de esta
feature: la alerta a soporte (`alertarSoporte()`, patrón "Resend directo sin tabla") no llegaba a
destino por 2 problemas de configuración externa (suppression list de Resend + falta de DMARC) —
ver el gotcha completo en [[wiki/integrations/resend-email]]. Ya corregido, transversal a DEV y
PROD.

## Pendiente

- **Bloqueante operativo (Fede, no código):** completar los 3 pasos de arriba (cuenta afipsdk.com
  → punto de venta AFIP/ARCA → token API) para poder cargar `platform_billers`. Es el único paso
  que falta para validar el camino feliz (con biller configurado, factura real emitida).
- Wording final del `concepto` que aparece en el comprobante — revisar con GO.
