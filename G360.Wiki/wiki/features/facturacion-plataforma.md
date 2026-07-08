---
title: Facturación automática de ingresos de PLATAFORMA (Fede, monotributo)
category: features
tags: [afip, facturacion, monotributo, mercadopago, billing]
sources: [supabase/functions/emitir-factura-plataforma, supabase/functions/platform-facturacion-sweep, supabase/migrations/261_platform_billing_fede.sql]
updated: 2026-07-08
---

# 🧾 Facturación automática de plataforma (Fede)

> Estado: **🏗 EN DEV (v1.122.0, 2026-07-08)** — código completo, deployado y smoke-testeado en
> DEV. **Bloqueado en la práctica hasta que Fede configure `platform_billers`** (token AfipSDK +
> certificado + punto de venta) — sin eso el sistema alerta a soporte y no factura (fail-open,
> nunca bloquea el cobro).

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

## Pendiente

- **Bloqueante operativo (Fede/GO, no código):** token AfipSDK + certificado + punto de venta
  para el CUIT de Fede — cargar en `platform_billers`.
- Wording final del `concepto` que aparece en el comprobante — revisar con GO.
- Validación e2e con el biller configurado (hoy solo se probó el camino `sin_biller`).
