# Cobertura — Integraciones de COBRO (Mercado Pago QR/link · MODO) → webhook → conciliación

> Auditoría REGLA #0 del módulo (B) del barrido UAT: **link/QR de cobro → webhook entrante →
> conciliación del saldo de la venta + asiento en caja**. Code-audit + validación DB.
> Convención: `✅e2e(NN)` · `✅unit` · `✅DB` · `🟡parcial` · `🔴gap` · `⛔bloqueado-terceros`.
> REGLA #0 = plata/fiscal (cero errores tolerados).

Archivos núcleo: `supabase/functions/mp-webhook/index.ts`, `mp-ipn/index.ts`, `mp-crear-link-pago/index.ts`,
`modo-webhook/index.ts`, `modo-crear-pago/index.ts`; `src/pages/VentasPage.tsx` (registrarVenta + cambiarEstado
+ modales QR), `src/components/layout/AppLayout.tsx` (toast global). Tablas: `ventas_externas_logs`,
`mercadopago_credentials`, `modo_credentials`, `caja_movimientos`, `caja_sesiones`, `ventas`.

## Estado de uso (DB-verificado 2026-06-24, DEV+PROD)

- **PROD:** `ventas_externas_logs` vacía · `mercadopago_credentials` conectadas = **0** · `modo_credentials` = **0** ·
  `ventas.id_pago_externo IS NOT NULL` = **0**. ⇒ el cobro por QR/link **nunca se ejerció en producción**;
  todos los hallazgos eran **latentes** (rompían el primer cobro real).

---

## 1) Hallazgos de la auditoría (todos DB-verificados)

| # | Hallazgo | REGLA #0 | Estado |
|---|----------|:---:|--------|
| H1 | `mp-webhook` insertaba en columna inexistente `payload` (la tabla tiene `payload_raw`) → insert falla; idempotencia rota; **pago pre-venta no se aplicaba a `monto_pagado`** (plata recibida no reflejada) | 💰 | ✅ **FIX** (v1.90.0, DEV) |
| H2 | El cobro por webhook **no asentaba `ingreso_informativo` en caja** (no hay trigger; los demás no-efectivo sí, spec 83) → no aparecía en el arqueo | 💰 | ✅ **FIX** (webhook autoritativo: asienta contra sesión operativa abierta de la sucursal) |
| H3 | `mp-webhook` vs `mp-ipn` inconsistentes entre sí y con el frontend (columna/clave) | — | ✅ **FIX** (ambas EF normalizadas: `payload_raw{monto,...}` + conciliación idéntica; comparten clave `mp-payment-{id}`) |
| H4 | Toast global "Pago MP confirmado" nunca disparaba (AppLayout lee `payload_raw.monto`, ninguna EF lo escribía) | — | ✅ **FIX** (ambas EF escriben `payload_raw.monto`) |
| H5 | Doc drift: el wiki afirma validación HMAC con `MP_WEBHOOK_SECRET` que el código NO hace (protege el re-fetch a la API de MP) | — | ✅ wiki corregido |
| H6 | MODO es un stub (TODOs "cuando lleguen credenciales", 0 creds; su `modo-webhook` no puede loguear el caso pre-venta porque no conoce el tenant → polling MODO del frontend nunca matchea) | 💰 | 🟡 **documentado** (no tocar hasta tener credenciales reales + verificar endpoints; rework espejando MP) |

## 2) Diseño del fix (REGLA #0)

**Dos flujos de cobro QR/link, dos puntos de asiento (sin doble conteo):**

1. **Venta directa (pre-venta)** — el cajero genera el QR para el carrito actual y finaliza. El webhook llega
   ANTES de que exista la venta → guarda `mp-preventa-{preVentaId}` en `payload_raw`. `registrarVenta` lo lee
   (`VentasPage:2583`, ahora `payload_raw`) y aplica `monto_pagado`; **la caja la asienta `registrarVenta`**
   según el medio del carrito (loop no-efectivo, `VentasPage:2861`). El webhook NO toca caja acá. ✅
2. **Venta ya existente (saldo de reserva / CC cobrado por QR)** — `registrarVenta` no corre de nuevo. El
   **webhook es autoritativo**: setea `id_pago_externo`/`money_release_date`, suma `monto_pagado` (cap al total)
   y asienta **un** `ingreso_informativo [Mercado Pago] Venta #N` contra una **sesión de caja operativa abierta**
   de la sucursal (excluye Bóveda; si no hay caja abierta → no asienta + warn, el saldo igual queda conciliado).
   El POS "Finalizar" del modal QR mantiene `saldoMediosPago: []` (solo flipea estado) → **sin doble conteo**
   (cambiarEstado no re-asienta porque el webhook no toca `medio_pago` y el saldo ya está). ✅

**Idempotencia:** el log `mp-payment-{id}` se inserta PRIMERO; el `UNIQUE(tenant,integracion,external_id)`
bloquea reintentos de MP (que envía varias notificaciones). Error no-duplicado → throw (500) para que MP
reintente sin tocar plata; `23505` → ya procesado.

## 3) Validación

- ✅ **DB (DEV, Jorgito):** demostrado el bug original (`insert ... payload` → `undefined_column`); las dos
  escrituras nuevas del webhook funcionan contra el esquema/trigger reales: resolución de sesión operativa +
  `ingreso_informativo` (trigger período OK) y log con `payload_raw` (`payload_raw->>'monto'`=1234.5 → toast
  lee bien). Filas de prueba limpiadas (0 residual).
- ✅ **Compilación:** `mp-webhook` (v25) + `mp-ipn` (v6) desplegadas a **DEV** (ACTIVE, `verify_jwt=false`).
- ✅ **typecheck + build** del frontend verdes.
- ⛔ **e2e completo del cobro real BLOQUEADO por terceros:** requiere un **seller MP conectado por OAuth +
  un pago real en sandbox** (la EF re-fetchea el pago a la API de MP con el token del seller; no se puede
  simular sin credenciales reales). Mismo tipo de bloqueo que AFIP §29. Cuando GO conecte una cuenta MP de
  prueba: generar QR (`generarLinkMP`) → pagar → verificar `monto_pagado`, `id_pago_externo` y el
  `ingreso_informativo` en caja.

## 4) Residual / pendiente

- **MODO (H6):** no production-ready. Requiere credenciales + verificar endpoints de la API MODO + rework de
  `modo-webhook` espejando MP (acumular+cap `monto_pagado`, asentar caja, y resolver el caso pre-venta — hoy
  no puede loguear sin tenant). No tocar hasta tener cuenta MODO real.
- **Doble validación cross-EF (mp-webhook ↔ mp-ipn):** ambas comparten la clave `mp-payment-{id}`, así que si
  se registraran las dos en el dashboard de MP la idempotencia las deduplica. En la práctica solo se registra
  `mp-webhook` (es la `notification_url` de `mp-crear-link-pago`).
