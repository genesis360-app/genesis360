---
title: Plan — Multimoneda: el medio de pago pierde la moneda (selector de moneda en cada pago)
category: business
tags: [multimoneda, usd, medios-de-pago, pos, caja, plan]
sources: [sources/raw/relevamiento_multimoneda_respuestas.md (sección C "Medios de pago y Caja Fuerte", D2, D3), sources/raw/respuestas_puntos_abiertos_2026-09-25.md (directiva + A-8, A-9), src/pages/VentasPage.tsx (mediosEfectivoUsd), src/lib/ventasValidation.ts, src/pages/ConfigPage.tsx, migraciones 368/473/477]
updated: 2026-10-08
---

# Plan — Multimoneda: el medio de pago pierde la moneda

**Para:** GO · **Fecha:** 8 de octubre de 2026 · **Estado:** 📅 **agendado para la semana del 12/10** (pedido de GO).
Antes de tocar código: confirmar con GO las **preguntas abiertas** de abajo ([[feedback_puntos_abiertos_se_consultan_siempre]]).

## Por qué

En el relevamiento de Multimoneda (Fede, 20/09, sección C) quedó: *"Los medios de pago no tienen moneda. No debe haber
'efectivo $' y 'efectivo USD' como medios distintos: existe 'efectivo', y después se indica en qué moneda se paga. Esto afecta
principalmente a la venta: al elegir el medio de pago se indica la moneda del pago."* + **D2**: *"máximo 2 monedas por venta,
con selector de moneda en cada pago"* + **D3**: *"vuelto siempre en moneda principal"*.

En las respuestas a los 30 puntos (25/09), el **A-8** quedó diferido ("no se ejecuta hasta que haga falta"). El **08/10 GO lo
pidió** al buscar el selector en la venta → **A-8 queda resuelto: se hace.** Se respeta la **directiva de alcance**: estructura
para N monedas pero **visible solo ARS (principal) + USD (secundaria)**.

## Cómo funciona HOY (modelo viejo, G5 de agosto — no tocar sin este plan)

- El cobro en dólares depende de un **medio de pago con moneda propia**: `metodos_pago.moneda = 'USD'` + `es_efectivo = true`
  (p. ej. "Efectivo USD", mig 368). `VentasPage` arma `mediosEfectivoUsd` con esos medios: muestra el input en dólares
  (`montoUsd`), calcula el vuelto en pesos y manda el efectivo a la **sesión de la Caja USD**.
- Lo mismo en devoluciones/anulaciones (reintegro en USD), señas, pagos de OC (`registrar_pago_oc` mira la moneda del medio y
  pide cotización si difiere de la OC) y gastos.
- `cuentas_origen` (Caja Fuerte) también tienen moneda propia; `vw_boveda_cuentas` suma por cuenta.
- Config → Métodos de pago muestra un **cartel + botón "Crear 'Efectivo USD'"** (v1.240.5, en `dev`) cuando hay productos en USD
  y no existe ese medio. **Ese cartel y el botón se eliminan en la Fase 1.**
- Dependen de "Efectivo USD" los e2e **140** (pago de OC en USD), **149** (anulación con reintegro USD) y **157** (seña mixta).

## Fases propuestas

| Fase | Qué cambia | Toca plata (REGLA #0) |
|---|---|---|
| **1 · Venta (POS)** | En cada fila de "Método de pago", **al lado del medio, un selector de moneda** (ARS por defecto; USD; solo las habilitadas). Máximo **2 monedas por venta** (D2). Vuelto **siempre en ARS** (D3). Efectivo en USD → **Caja USD**; efectivo ARS → caja en pesos. Cada pago guarda su **moneda** y su **monto en esa moneda** (+ cotización usada, D-1: vendedor divisa BNA del día hábil anterior). Config: los medios **pierden** la moneda; migración de "Efectivo USD"/"Wallet USD" → su medio base con la moneda en el pago. Se borran el cartel y el botón de "Efectivo USD". | ✅ caja, vuelto, cotización |
| **2 · Cobros posteriores** | Mismo selector en: saldo de reservas, cobranza de cuenta corriente, despacho con seña, cobro por link/QR. | ✅ |
| **3 · Devoluciones y anulaciones** | Reintegro eligiendo medio + moneda (hoy "Efectivo USD"); NC sigue en pesos (C10). | ✅ |
| **4 · Pagos (gastos, OC, proveedores)** | `registrar_pago_oc`, `registrar_pago_proveedor` y gastos reciben la moneda **del pago**, no la del medio. Cheques igual. | ✅ CC proveedores |
| **5 · Caja Fuerte** | Cada medio/cuenta muestra **lo que hay en cada moneda**; total por moneda (sección C). | ✅ saldos |
| **6 · Reportes** | Dashboard con pestañas **ARS / USD** (A-9); reportes por medio sin mezclar monedas ([[reference_totales_en_moneda_del_negocio]]). | — |

Cada fase: migración versionada, guards en la base además de la UI, unit + e2e (adaptar 140/149/157), UAT, y deploy aparte.

## Preguntas abiertas para GO (antes de arrancar)

1. **¿Qué medios aceptan USD?** ¿Cualquiera (efectivo, transferencia, MP, tarjeta…) o se habilita por medio en Config?
   Propuesta: por medio, con un tilde "acepta USD" (el efectivo y las billeteras sí; la tarjeta argentina, en general no).
2. **Cuentas de origen / Caja Fuerte:** Fede dijo que también pierden la moneda (una cuenta muestra saldo por moneda); la
   sugerencia del A-8 era que la **caja/cuenta mantenga** su moneda. ¿Cuál? (Hoy la Caja USD es una caja aparte, y conviene
   mantenerla así para los arqueos.)
3. **Ventas viejas:** se quedan como nacieron (E2), con "Efectivo USD" en su detalle. ¿OK, o se quiere que en reportes se lean
   como "Efectivo · USD"?
4. **Vuelto cuando pagan en USD y el negocio no tiene pesos en caja:** hoy se bloquea si no alcanza; ¿se mantiene?
5. **Monedas "ocultas":** ¿el selector muestra solo ARS/USD aunque la estructura soporte más? (directiva: sí).

## Riesgos

- Es transversal: POS, caja, devoluciones, CC de clientes y proveedores, cheques, Caja Fuerte, dashboard. Por eso va por fases
  y cada una se deploya sola.
- Datos existentes: hay que migrar los medios en USD de cada negocio (en PROD: verificar con query cuántos hay antes).
- Las RPCs de pago (`registrar_pago_oc`, `registrar_pago_proveedor`, `revertir_cheque_propio`) hoy derivan la moneda del medio:
  cambiarlas sin romper el historial de imputaciones.

Relacionado: [[wiki/features/ventas-pos]], [[wiki/features/caja]], [[wiki/features/clientes-proveedores]],
`sources/raw/relevamiento_multimoneda_respuestas.md`, `sources/raw/respuestas_puntos_abiertos_2026-09-25.md`.
