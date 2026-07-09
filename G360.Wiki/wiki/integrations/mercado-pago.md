---
title: Integración Mercado Pago
category: integrations
tags: [mercado-pago, pagos, suscripciones, webhook, qr, addon, argentina]
sources: [CLAUDE.md]
updated: 2026-07-09
---

# Integración Mercado Pago

Mercado Pago se usa para dos fines distintos en Genesis360:
1. **Suscripciones** de la plataforma (tenants pagan su plan)
2. **Pagos de ventas** (clientes del tenant pagan con MP QR)

---

## 1. Suscripciones de la plataforma

### Modelo: preapproval (suscripción recurrente)

```
Usuario hace clic en "Suscribirse"
  → Frontend construye init_point DIRECTAMENTE:
    https://www.mercadopago.com.ar/subscriptions/checkout
      ?preapproval_plan_id={id}
      &external_reference={tenant_id}
      &back_url={appUrl}/suscripcion
  → Usuario paga en MP
  → MP envía webhook a mp-webhook
  → EF actualiza tabla subscriptions
```

> [!WARNING] **No usar** `POST /preapproval` vía Edge Function — MP requiere `card_token_id` que no tenemos en este flujo. El `init_point` se construye en el frontend directo.

> [!CAUTION] **🔴 CRÍTICO (confirmado 2026-07-03 en PROD): MP NO persiste `external_reference` NI `payer_email` en los checkout por PLAN** (`preapproval_plan_id`). El preapproval queda con "Código de referencia" y email de pagador VACÍOS (verificado: 10/10 preapprovals reales). Por eso el linkeo preapproval↔tenant **no puede** hacerse por esos campos — el ÚNICO link confiable es el **`preapproval_id`** que MP devuelve en el redirect (`/suscripcion?status=approved&preapproval_id=...`).
>
> **Estado (v1.107.0, Fase 1):** ✅ **Cancelación** arreglada + validada e2e en PROD (linkeo por `mp_subscription_id` guardado + **fail-closed**: la DB solo pasa a `cancelled` si MP confirmó). ❌ **Activación por UI ROTA** — el fix por `payer_email` no sirve (email vacío), y el retorno del checkout falla: **(a)** 401 de sesión (verify se llama antes de que la sesión esté lista en el redirect); **(b)** `handleVerificarPago` hace `if (!tenant) return` y el `useEffect [status]` no reintenta si el tenant no cargó; **(c)** la pantalla "¡Pago aprobado! se activó correctamente" es ESTÁTICA (se muestra por `status=approved`, no refleja el estado real → MIENTE). Neto: el cliente paga, MP lo registra, pero la app nunca linkea. **FASE 2 pendiente = rework de `SuscripcionPage`:** esperar sesión+`tenant` + **reintentar** el verify con el `preapproval_id`; pantalla que refleje el estado REAL; **quitar el botón "Verificar/Ya pagué"** (email-search, inútil sin `payer_email`). El EF `mp-verificar-suscripcion` YA activa bien dado un `preapproval_id`; el problema es 100% frontend.

### IDs de planes PROD

> **💳 CAMBIO DE CUENTA (v1.119.0, 2026-07-07):** los cobros pasaron a la cuenta MP de **Fede Messina**
> (collector `478332282`, app `2672033309404649`). Los planes viejos (`836c7829…`/`cb3bcdaa…`, cuenta
> `2118612146`) quedaron huérfanos con la cuenta anterior. DEV y PROD usan el MISMO token nuevo.
> ⚠ Gotchas: el JSON de `POST /preapproval_plan` con tildes devuelve 400 (mandar ASCII) · Fede NO puede
> suscribirse desde su propia cuenta (pagador=cobrador) · `/preapproval/search` con este token también
> lista las subs donde Fede es PAGADOR (filtrar por `collector_id`).

```
Básico: 142aefe11ad64fb887b5949db005f8f8  ($54.000 ARS/mes — lista $60k con −10% débito automático)
Pro:    f06b269057254b9da0e4a60cb89d1544  ($90.000 ARS/mes — lista $100k con −10% débito automático)
```

Definidos en `brand.ts` → `MP_PLAN_IDS` + secrets `MP_PLAN_BASICO`/`MP_PLAN_PRO` (tier en EFs).

### `external_reference` = `tenant_id`

El campo `external_reference` identifica al tenant en el webhook. Al recibir un evento de pago de suscripción, el webhook busca el tenant por este campo.

### Estados mapeados

| Estado MP | Estado en Genesis360 |
|-----------|---------------------|
| `authorized` | `active` |
| `pending` | `trial` (mantiene acceso) |
| `cancelled` | `cancelled` |
| `paused` | `inactive` |

---

## 2. Pagos de ventas con QR

### EF `mp-crear-link-pago`

- Crea una `preference` de MP con `external_reference = venta.id` (UUID)
- Para ventas directas: `preVentaId` UUID pre-generado
- Retorna URL de QR/link de pago

### Flujo en VentasPage

1. Cajero hace clic en botón QR en checkout
2. Se genera link de pago via EF
3. Cliente escanea el QR o abre el link
4. Polling cada 4s en el frontend
5. Cuando llega el pago → pantalla "¡Pago recibido!" → botón Finalizar

### Toast global en AppLayout

Cada 30s consulta `ventas_externas_logs` (MercadoPago, últimos 5 min) y, por cada log con
`payload_raw.monto`, muestra un toast `💳 monto · fecha · hora`.

### Conciliación del cobro (REGLA #0, v1.90.0)

> Auditoría completa en `tests/specs/cobertura/06_integraciones_cobro.md`. El módulo nunca se ejerció en
> PROD (0 credenciales MP conectadas) ⇒ los bugs eran latentes; se arreglaron antes de habilitar cobro real.

**Tabla de idempotencia/conciliación:** `ventas_externas_logs` — columna de datos = **`payload_raw`** (JSONB),
NO `payload`. Clave `webhook_external_id`: `mp-payment-{id}` (venta existente) o `mp-preventa-{id}` (pre-venta).
`UNIQUE(tenant_id, integracion, webhook_external_id)` da la idempotencia ante reintentos de MP.

**Dos flujos, dos puntos de asiento de caja (sin doble conteo):**

1. **Venta directa (pre-venta):** el webhook llega antes de crear la venta → guarda `mp-preventa-{preVentaId}`
   en `payload_raw`; `registrarVenta` lo lee y aplica `monto_pagado`. **La caja la asienta `registrarVenta`**
   según el medio del carrito (el webhook NO toca caja).
2. **Venta existente (saldo de reserva / CC por QR):** el **webhook es autoritativo** → setea
   `id_pago_externo`/`money_release_date`, suma `monto_pagado` (cap al total) y asienta **un**
   `ingreso_informativo [Mercado Pago] Venta #N` contra una sesión de caja **operativa** abierta de la sucursal
   (excluye Bóveda; sin caja abierta → no asienta + warn, el saldo igual queda conciliado). El "Finalizar" del
   modal QR solo flipea el estado (`saldoMediosPago: []`).

`mp-webhook` y `mp-ipn` quedaron **espejadas** (misma conciliación + `payload_raw` normalizado). La registrada
en el dashboard es `mp-webhook` (es la `notification_url` de `mp-crear-link-pago`).

---

## 3. Add-ons (Pricing 2026)

### 3.a Add-on TEMPORAL de movimientos (Fase 2, 2026-07-02) — histórico, ver 3.i

> [!NOTE] **Superseded v1.115.0 (2026-07-06):** el mismo mecanismo (misma EF `mp-addon`, mismo
> patrón de ref+webhook) hoy vende el temporal de **comprobantes**, no de movimientos (pricing
> v2, packs 1.000/5.000/10.000 → $10k/$30k/$50k). El flujo de abajo queda documentado tal cual
> corrió para movimientos (histórico/idempotencia); ver §3.i para el catálogo vigente.

```
Usuario elige pack 1.000 / 5.000 / 20.000 movimientos
  → EF mp-addon (revalida el precio contra el catálogo server-side)
    crea preference de PAGO ÚNICO
    external_reference = `${tenant}|addon|movimientos|${cantidad}|temporal`
  → mp-webhook parsea la ref (parseAddonRef)
    INSERT tenant_addons (dimension='movimientos', tipo='temporal', vence_at = pago+30d,
                          mp_payment_id=<paymentId>)
  → idempotente por uq_tenant_addons_mp_payment (mig 253): reintento de MP = 23505 ignorado
```

El límite EFECTIVO lo calcula `fn_tenant_limite` (base + Σ add-ons activos, temporales no vencidos).
`usePlanLimits` lo espeja en el cliente. **El add-on temporal ya NO usa `tenants.addon_movimientos`**
(esa columna legacy queda solo para packs viejos de 500; back-compat en el webhook).

### 3.b Add-ons FIJOS (recurrentes) + downgrade guiado (Fase 3, 2026-07-02 · deployado, oculto por kill-switch)

```
Alta:  EF mp-addon-fijo (action='agregar', dimension sku/sucursales/usuarios, cantidad)
  → lee el transaction_amount ACTUAL del preapproval (GET /preapproval/{id})
  → PUT /preapproval/{id} auto_recurring.transaction_amount = actual + precio_pack  (DELTA)
  → fail-closed: si el PUT falla, NO se otorga el add-on
  → INSERT tenant_addons (tipo='fijo', vence_at=NULL)
Baja:  EF mp-addon-fijo (action='quitar', addon_id)
  → downgrade GUIADO server-side: fn_tenant_limite(dim) − cantidad vs uso activo;
    si uso > nuevo límite → 200 {blocked:true, excedente, ...} (el usuario desactiva recursos primero)
  → PUT transaction_amount = actual − precio_pack ; DELETE tenant_addons
```

> [!WARNING] **EF deployada DEV+PROD, pero `PUT transaction_amount` NUNCA validado e2e en sandbox.**
> El configurador in-app de add-ons fijos está **oculto detrás del kill-switch `ADDON_FIJO_ENABLED=false`**
> (`brand.ts`, v1.111.0) hasta que GO valide el cobro real (ver sección 3.g y el runbook §11 del UAT).
> **H7 (hallazgo 2026-07-04): el kill-switch es frontend-only** — el EF sigue invocable server-side
> (riesgo aceptado, documentado, mientras dure la validación). El estimador público del Landing y el
> add-on temporal de movimientos NO dependen del flag. El precio SIEMPRE sale del catálogo server-side
> (REGLA #0). Los planes base de MP ya están en $60k/$100k (RIESGO #1 resuelto 2026-07-02).

### 3.c EFs tier-aware (Fase 3a)

`mp-webhook` y `mp-verificar-suscripcion` ahora setean **`tenants.plan_tier`** (mapeo
`preapproval_plan_id`→`basico`/`pro`, env `MP_PLAN_BASICO`/`MP_PLAN_PRO`) al activar, en vez de los
`max_users`/`max_productos` viejos (que `usePlanLimits` ya no lee). Cierra medio RIESGO #1.

### 3.d Cancelación de suscripción (v1.104.0 / v1.106.0)

```
Usuario (Mi Cuenta) o AdminPage → EF cancel-suscripcion (deriva tenant del JWT;
  admin puede pasar { tenant_id })
Panel admin.genesis360.pro → EF admin-api acción billing.cancel_subscription
  → ambos: buscar preapproval(s) del tenant (mp_subscription_id + /preapproval/search
    por external_reference, filtrado client-side) → verificar external_reference===tenant
    → PUT /preapproval/{id} { status: 'cancelled' }
  → FAIL-CLOSED: solo marca subscription_status='cancelled' si MP confirmó
```

**Bug histórico (Fede Messina, 2026-07-02):** el EF `cancel-suscripcion` NO existía → `MiCuentaPage`
fallaba (con id) o hacía un UPDATE local a ciegas (sin id) → MP seguía cobrando. Fix: EF nuevo +
`MiCuentaPage`/`AdminPage`/panel siempre pasan por un EF.

> [!TIP] **H8 RESUELTO (v1.112.0):** `admin-api.cancelarSubMP` (panel `genesis360-admin`) tenía el mismo
> circuito pero **sin** el fallback por `payer_email` de `cancel-suscripcion` (drift entre las 2 copias,
> hallazgo del UAT 2026-07-04) → cancelar desde el panel un tenant nunca-linkeado (`mp_subscription_id`
> NULL) fail-abría. Ahora `admin-api` busca el owner en `users` (rol='DUEÑO') → `auth.admin.getUserById` →
> search en MP por `payer_email`, unificado con `cancel-suscripcion`.

> [!TIP] **Grace period también al cancelar DESDE EL PANEL DE MP (v1.112.0):** hasta v1.110.0 el grace
> period (`subscription_period_end`) solo se guardaba cuando la cancelación pasaba por `cancel-suscripcion`
> o `admin-api` — si el cliente cancelaba **directo en el panel de Mercado Pago** (sin pasar por la app), el
> `mp-webhook` marcaba `cancelled` pero **cortaba el acceso al instante** (sin grace). Ahora `mp-webhook`
> también captura el `next_payment_date` del preapproval y setea `subscription_period_end` (fallback +30d
> solo si no había valor — no extiende en re-entregas del webhook). La **activación** limpia
> `subscription_period_end` en los 3 caminos (`mp-verificar-suscripcion`, `admin-api.link_subscription`,
> `mp-webhook`) para no dejar un valor viejo inerte.

> [!WARNING] **`/preapproval/search?external_reference=X` NO filtra** (devuelve todos, 200) → se filtra
> client-side por el `external_reference` que trae cada resultado + se pagina. El `PUT cancel` sí es fiable.

> [!WARNING] **No se puede sandbox-testear el ALTA del app en vivo.** Los planes `836c…`/`cb3b…` viven en
> la cuenta REAL de GO → pagar con un *Buyer Test User* da **"una de las partes es de prueba"** (test+prod).
> Test real: bajar el plan a un monto chico, que un TERCERO real pague desde la app, cancelar, devolver, y
> volver el plan a $60k (y **vos como vendedor no podés pagarte a vos mismo**).

### 3.e Flujo de activación al volver del checkout (Fase 2, v1.108.0)

```
Checkout MP → back_url /suscripcion?status=approved&preapproval_id=XXX
SuscripcionPage useEffect([status, esAddon, preapprovalId]):
  await supabase.auth.getSession()          # el redirect recarga la app → el JWT puede no estar listo (401)
  loop 4× (cada 2,5s):
    invoke mp-verificar-suscripcion { preapproval_id }   # la EF deriva el tenant del JWT
      200 { activated:true }        → 'ok'  → loadUserData(uid) ANTES de navigate('/dashboard')
      200 { activated:false, reason } (no_encontrado/no_autorizado) → 'pendiente' → reintentar
      4xx/5xx (owner_mismatch/ya_reclamada/plan_desconocido/500)    → 'error' (mensaje por reason)
  agotados los reintentos sin 'ok'/'error' → 'pendiente'
```

**Bug histórico (v1.108.0, revenue):** un cliente pagaba y **no se activaba solo**. Tres causas, todas en
`SuscripcionPage` (el EF ya activaba bien): (1) invocaba la EF con el JWT sin restaurar (401) y `if (!tenant)
return` con `useEffect` en `[status]` → **no reintentaba**; (2) la pantalla de resultado era **estática y
mentía** ("se activó") sin verificar; (3) el botón email-search era inútil (MP manda `payer_email` **vacío**
en checkout por plan). Fix: esperar la sesión + no depender del `tenant` del store + reintentos + pantalla
por estado real + `loadUserData` antes de navegar (evita rebote de `SubscriptionGuard`) + se quitó el botón.

> [!IMPORTANT] La activación **solo se valida en PROD con un pago real** — el token MP de DEV es de otra
> cuenta y no ve las subs reales. Con `payer_email` vacío la EF activa por `preapproval_id` + claim exclusivo.

### 3.f Recuperar una suscripción HUÉRFANA (soporte, panel admin)

Si una suscripción quedó **activa en MP pero sin linkear** en la app (el checkout-return falló, o el
cliente cerró la pestaña), **no se puede autorrecuperar** desde la app: MP manda `payer_email` y
`external_reference` **vacíos** en checkout por plan → no hay por dónde buscarla salvo el `preapproval_id`.

**Herramienta de soporte:** en `admin.genesis360.pro` → ficha del cliente → **"Linkear suscripción"**: se
pega el `preapproval_id` (del panel de MP → Suscriptores → Ver detalles) y se invoca `admin-api` acción
**`billing.link_subscription`** (módulo `billing`). La EF **verifica contra MP** (`status:'authorized'` +
`preapproval_plan_id` de un plan nuestro + **no reclamada** por otro tenant), **cancela una suscripción
anterior distinta** para evitar doble cobro, y recién ahí activa (`subscription_status='active'` +
`mp_subscription_id` + `plan_tier`). Mismo criterio de pertenencia que `mp-verificar-suscripcion`.

> [!TIP] Alternativa sin panel: que el cliente (logueado, con v1.108.0) abra
> `/suscripcion?status=approved&preapproval_id=<ID>` → dispara el mismo camino verificado.

### 3.g UAT re-auditado + espejos de test (2026-07-04, test-only, sin deploy)

A pedido de GO ("revisar el UAT de cobros MP, complementarlo para que sea robusto y testear todo"),
se releyó `tests/specs/mp-suscripciones-pagos.plan.md` contra el código real v1.108→v1.111 (los EFs
de arriba + `SuscripcionPage`/`MiCuentaPage`/`AuthGuard`). Pasó de **43 a 48 escenarios**:

- **Nuevos:** MP-A12 (checkout-return v1.108), MP-A13 (`billing.link_subscription` v1.109, e2e ✅
  PROD), MP-C11 (eliminar cuenta cancela MP fail-closed antes de borrar, v1.110), MP-AD9 (kill-switch
  `ADDON_FIJO_ENABLED` v1.111), MP-AD10 (`mensajeErrorEF`).
- **Actualizados:** MP-C7 (MITIGADO en `cancel-suscripcion` por `payer_email`; `admin-api` sin ese
  fallback → hallazgo **H8**), MP-C9 (✅ IMPLEMENTADO v1.110 + sub-escenarios grace period).
- **Hallazgos nuevos:** **H7** (`ADDON_FIJO_ENABLED` es frontend-only — el EF `mp-addon-fijo` sigue
  invocable server-side; riesgo aceptado documentado) y **H8** (drift entre `cancel-suscripcion` y
  `admin-api.cancelarSubMP`: solo el primero tiene el fallback por `payer_email`).
- **Sección 11 nueva:** RUNBOOK de validaciones e2e con plata real en PROD (checkout-return fresco →
  add-on fijo sobre esa sub → cancelación real → cierre/refund/volver plan a $60k).

**Espejos de test agregados** (patrón ccLogic, lógica pura + vitest, sin cambiar el EF):
- `src/lib/mpAddonFijo.ts` — espejo de `mp-addon-fijo` (alta fail-closed, revert si insert falla, baja
  con downgrade guiado, delta de precio, race documentada) + 18 tests.
- `src/lib/accesoSuscripcion.ts` — `tieneAccesoVigente()` extraída del `SubscriptionGuard`; **el propio
  `AuthGuard.tsx` la importa** (lo testeado es lo que corre) + 10 tests (bordes de grace MP-C9).
- `mensajeErrorEF` (parsea `error.context` de un `FunctionsHttpError`) exportado desde
  `src/lib/suscripcionActivacion.ts` + 4 tests.

Suite: **904 unit tests** (antes 873). Detalle completo del plan en `tests/specs/mp-suscripciones-pagos.plan.md`.

### 3.h Sweep de reconciliación (`mp-reconciliacion`, v1.112.0)

El test real con Fede (§3.e/§3.f) mostró que un preapproval puede quedar **`authorized` en MP pero sin
linkear** en la app durante horas si el checkout-return no dispara (PWA cacheada, pestaña cerrada, red) —
nadie se entera hasta que el cliente reclama. **Sweep automático que cierra ese blind spot:**

```
Cron horario (.github/workflows/mp-reconciliacion.yml, :17 + dispatch manual)
  → EF mp-reconciliacion (service_role, --no-verify-jwt)
    1. Lista preapprovals recientes vía /preapproval/search (paginado, filtra client-side)
    2. Para cada uno, cruza contra tenants (mp_subscription_id / subscription_status)
    3. Clasifica 3 tipos de hallazgo:
       - huerfana:            preapproval authorized SIN tenant linkeado (caso Fede)
       - drift_mp_cobra:       MP cobra (authorized) pero el tenant NO está 'active' en DB
       - drift_acceso_gratis:  tenant 'active' en DB pero el preapproval está muerto en MP
    4. INSERT en mp_billing_alertas (mig 256) — UNIQUE(tipo, preapproval_id) dedupe
       (si ya existe sin resolver, NO reenvía el mail; si el hallazgo desaparece, marca resuelto_at)
    5. Email a soporte@genesis360.pro (Resend) por cada hallazgo NUEVO
```

> [!CAUTION] **🛑 REGLA #0 — el sweep SOLO detecta y alerta, NUNCA activa ni linkea automáticamente.**
> Sin `payer_email` confiable (§ arriba: MP no lo persiste en checkout por plan) no hay matching seguro
> para decidir a qué tenant pertenece una huérfana → la resolución sigue siendo **humana**, vía el panel
> (`billing.link_subscription`, §3.f). Espejo puro testeado en `src/lib/mpReconciliacion.ts` +
> `tests/unit/mpReconciliacion.test.ts` (8 tests). **Smoke real en PROD (2026-07-05):** 12 preapprovals
> revisados, 0 hallazgos (DB↔MP consistente en ese momento).
>
> **🛑 Gotcha (hallado 2026-07-08, validando la alerta análoga de `emitir-factura-plataforma`):** este
> email a `soporte@` es "Resend directo sin tabla" — el mismo patrón silencioso frágil documentado en
> [[wiki/integrations/resend-email]] (suppression list de Resend + DMARC + moderación/spam del Google
> Group). Nunca se había disparado una alerta real de este sweep (siempre "0 hallazgos" en los smokes),
> así que no había evidencia de que efectivamente llegara — ya corregido a nivel infraestructura
> (transversal, no específico de este sweep).

### 3.i Batch de add-ons con cobro por delta (`mp-addon-batch`, v1.115.0, 2026-07-06)

**Reemplaza** el flujo "un click = un cobro" de `mp-addon-fijo` (§3.b) — validado e2e el
2026-07-05 pero **descartado por decisión de producto** (GO). Diseño completo + decisiones
Q1-Q4 en `wiki/features/configurador-addons-batch.md`.

```
Panel único "Armá tu plan" (SuscripcionPage + PricingConfigurator modo `app`)
  → usuario arma el batch (plan+packs objetivo; UN pack fijo por dimensión, mig 258)
  → EF mp-addon-batch action:'preview' (recalcula todo server-side: delta, recurrente_nuevo,
      next_payment_date, guard de baja por dimensión)
  → Confirmar → EF mp-addon-batch action:'confirmar'
      delta > 0 (sube el recurrente): preference de PAGO ÚNICO por el DELTA,
        external_reference = "{tenant}|addonbatch|{change_id}", fila addon_batch_changes
        'pendiente_pago' (mig 258) → el webhook aplica el batch RECIÉN AL PAGAR (fail-closed)
      delta ≤ 0 (baja o neutro): SIN cobro — PUT transaction_amount inmediato (fail-closed) →
        fn_aplicar_addon_batch → "tu próxima factura del DD/MM llega por $X"
  → mp-webhook rama |addonbatch| (idempotente por mp_payment_id): pago aprobado →
      PUT transaction_amount → fn_aplicar_addon_batch (sync tenant_addons ATÓMICO, mig 258)
      si el PUT falla DESPUÉS del pago → change → 'fallido' + mp_billing_alertas
      (tipo nuevo batch_pagado_sin_aplicar) + email a soporte (el cliente YA PAGÓ, prioridad
      máxima de conciliación)
```

**Guard de baja a nivel BATCH:** antes de aplicar cualquier baja se compara el uso activo real
(SKU/usuarios/sucursales) contra el límite resultante (`base(plan) + pack_objetivo`); si el uso
excede, bloquea con el detalle de cuánto desactivar (para SKU: "desactivar ≠ eliminar").

**`mp-addon` ahora vende el add-on TEMPORAL de COMPROBANTES** (reemplaza el temporal de
movimientos — pricing v2, mig 259 — packs +1.000=$10k · +5.000=$30k · +10.000=$50k, vence a 30
días del pago).

> [!WARNING] **`mp-addon-fijo` (§3.b) queda DEPRECADO** — sigue deployada (código intacto, por
> histórico/idempotencia de add-ons fijos ya otorgados) pero **la UI ya no la invoca**; se borra
> en una limpieza futura (Fase 3 del diseño).

**Deploy:** migs 258-259 + EFs `mp-addon-batch` (nueva) / `mp-addon` / `mp-webhook` — DEV+PROD,
PR #272 mergeado + release v1.115.0. Espejo de test `src/lib/mpAddonBatch.ts` + UAT §10.b
(`mp-suscripciones-pagos.plan.md`, MP-B1..B8). **🟠 Pendiente:** test e2e GO+Fede (suba con delta
real cobrado + baja sin cobro + guard de baja); Fase 2 = cambio de PLAN por el mismo toggle.

---

## Edge Functions

| Función | JWT | Propósito |
|---------|-----|-----------|
| ~~`crear-suscripcion`~~ | — | **ELIMINADA (2026-07-09)** — huérfana, cero referencias en `src/` ni en otras EFs (`SuscripcionPage.tsx` arma el checkout de MP directo en el cliente desde hace tiempo). Borrada de Supabase DEV + carpeta local eliminada del repo (commit `85646408`), con OK de GO. |
| `mp-webhook` | No | Eventos de pagos Y suscripciones (setea `plan_tier`; add-on temporal → `tenant_addons`) |
| `mp-ipn` | No | IPN alternativo para pagos de ventas |
| `mp-crear-link-pago` | Sí | Genera preference de pago por venta |
| `mp-addon` | Sí | Add-on TEMPORAL de **comprobantes** (pago único, packs 1.000/5.000/10.000 — reemplaza el temporal de movimientos, v1.115.0) |
| `mp-addon-batch` | Sí | **v1.115.0** — Batch de add-ons con cobro por delta (`preview`/`confirmar`): suba → preference por el delta (aplica al pagar vía `mp-webhook`); baja → `PUT` inmediato sin cobro; guard de baja batch server-side. Reemplaza `mp-addon-fijo` (ver 3.i) |
| ~~`mp-addon-fijo`~~ | Sí | **DEPRECADA (v1.115.0)** — sigue deployada (histórico/idempotencia de add-ons ya otorgados) pero la UI ya no la invoca; reemplazada por `mp-addon-batch`. Antes: Add-on FIJO (alta/baja + `PUT transaction_amount` del preapproval), oculta por kill-switch `ADDON_FIJO_ENABLED` (ver 3.g, H7) |
| `mp-verificar-suscripcion` | Sí | Verifica el preapproval server-side y activa (setea `plan_tier`) |
| `cancel-suscripcion` | Sí | **Cancela** el/los preapproval(s) en MP (`PUT status:'cancelled'`) + marca la cuenta cancelada. Robusto al drift: si falta `mp_subscription_id`, busca por `external_reference` en `/preapproval/search`. Fail-closed. (v1.104.0) |
| `mp-reconciliacion` | No (`--no-verify-jwt`, service_role) | Sweep de reconciliación cron (huérfanas / drift_mp_cobra / drift_acceso_gratis) — **solo detecta y alerta a soporte@, nunca activa/linkea sola** (v1.112.0, ver 3.h) |
| `mp-oauth-callback` | No | OAuth de la cuenta del seller |

### Routing en `mp-webhook`

```
Recibe payload de MP
  → Extrae user_id (seller_id)
  → Si coincide con mercadopago_credentials.seller_id
      → Pago de VENTA (usa access_token del seller, actualiza venta)
  → Si no coincide
      → Pago de PLATAFORMA (addon/suscripción, comportamiento anterior)
```

> [!WARNING] **WH-LEGACY/H1 — pendiente sin resolver (investigado 2026-07-09, no tocado):** la
> rama `else` final del routing de PLATAFORMA activa `subscription_status='active'` sin validar
> monto ni idempotencia. `SuscripcionPage.tsx:278` arma `external_reference=${tenant.id}` igual
> que hacía la EF `crear-suscripcion` (ya eliminada, ver tabla arriba), lo que sugiere que esta
> rama sigue siendo parte del camino ACTIVO de alta de suscripción — pero la documentación
> existente (H5) también dice que MP no persiste `external_reference` en checkouts por plan. Es
> ambiguo sin evidencia de logs reales de un webhook real; no se tocó código. Pendiente: revisar
> logs de un alta real antes de decidir si hay que endurecer esta rama.

### `mp-ipn`

Alternativa independiente:
- Recibe notificación → verifica en MP API → busca venta por `external_reference` (= `venta_id` UUID)
- Actualiza `id_pago_externo` + `money_release_date`
- Idempotencia via `ventas_externas_logs` con clave `mp-preventa-{id}`

---

## OAuth para sellers (Integraciones)

`mp-oauth-callback` (sin JWT):
- Recibe `?code&state`
- Intercambia code → calcula `expires_at` (180 días)
- Obtiene seller email
- Upsert en `mercadopago_credentials`

**Credenciales por sucursal:**
```sql
mercadopago_credentials(
  tenant_id, sucursal_id, seller_id, seller_email,
  access_token, refresh_token, public_key, expires_at,
  conectado, UNIQUE(tenant_id, sucursal_id)
)
```

Token expira en 180 días. Badge "Vencido" en UI si `expires_at < now()`.

**Client ID:** `7675256842462289`  
**Secrets:** `MP_CLIENT_SECRET`, `MP_ACCESS_TOKEN` en Supabase EF secrets

---

## Variables de entorno

```env
# Frontend (Vercel)
VITE_MP_PUBLIC_KEY=           # Clave pública para SDK frontend
VITE_MP_CLIENT_ID=7675256842462289

# Edge Functions (Supabase secrets)
MP_ACCESS_TOKEN=              # Token de la cuenta de Genesis360
MP_WEBHOOK_SECRET=            # HMAC para validar webhooks
MP_CLIENT_SECRET=             # OAuth secret
```

### Webhook registrado en MP Dashboard

```
URL: https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-webhook
Eventos: Pagos ✅ + Planes y suscripciones ✅
```

---

## Validación de webhooks

> [!NOTE] **WH-SIG — validación HMAC de firma, modo LOG-ONLY (2026-07-08).** `mp-webhook` ahora
> tiene `verificarFirmaMp()`: HMAC-SHA256 sobre el manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`
> (formato oficial de MP, header `x-signature`/`x-request-id`) comparado contra `MP_WEBHOOK_SECRET`.
> **Hoy es LOG-ONLY**: si el secret está seteado, loguea `OK`/`INVALIDA` pero **nunca bloquea** el
> webhook — la garantía de autenticidad real sigue siendo el **re-fetch a la API de MP**
> (`GET /v1/payments/{id}`) con el `access_token` del seller: un payload falso con un `payment_id`
> inválido devuelve no-aprobado/404 y no toca la DB. **`MP_WEBHOOK_SECRET` todavía NO está cargado
> como secret real en Supabase DEV ni PROD** (solo existe vacío, sin usar, en `.env.local` local)
> → el log-only hoy no produce nada observable, pero el código queda listo. **Para activar de
> verdad:** cargar el secret real (panel developers de MP, sección firma del webhook — DISTINTO de
> `MP_ACCESS_TOKEN`/`MP_CLIENT_SECRET`) en Supabase DEV y PROD, dejarlo correr en log-only contra
> tráfico real un tiempo, y recién con logs `OK` consistentes agregar el early-return 401 si
> `!valid` (hoy el código ya calcula el resultado pero no lo usa para bloquear).

---

## Consideraciones Argentina

- Precios en ARS
- Modelo preapproval (suscripción mensual automática)
- Para planes Enterprise: pago fuera de la plataforma
- MP requiere cuenta vendedor verificada para cobrar

---

## Links relacionados

- [[wiki/features/suscripciones-planes]]
- [[wiki/integrations/mercado-libre]]
- [[wiki/architecture/edge-functions]]
