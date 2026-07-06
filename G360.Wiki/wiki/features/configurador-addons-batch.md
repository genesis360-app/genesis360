---
title: Configurador de add-ons BATCH con cobro por delta (diseño)
category: features
tags: [billing, addons, mercadopago, pricing, comprobantes, delta]
sources: [src/pages/SuscripcionPage.tsx, src/components/PricingConfigurator.tsx, supabase/functions/mp-addon-fijo, supabase/functions/mp-webhook, tests/specs/mp-suscripciones-pagos.plan.md]
updated: 2026-07-06
---

# 🧩 Configurador de add-ons BATCH + cobro por delta

> Estado: **✅ FASE 1 EN PROD (v1.115.0, 2026-07-06)** — migs 258-259 + EFs `mp-addon-batch`/
> `mp-addon`/`mp-webhook` deployadas DEV+PROD, PR #272 mergeado + release + Vercel OK. Reemplaza
> el flujo v1.106-v1.114 de add-ons fijos "un click = un cobro" (`mp-addon-fijo`), validado e2e
> el 2026-07-05 pero descartado por decisión de producto. Decisiones ya tomadas por GO: **(1)**
> cobro del delta HOY como pago único + recurrente nuevo desde el próximo ciclo; **(2)** metering
> por **COMPROBANTES** (reemplaza movimientos): Básico 6.000/mes · Pro 14.000/mes · packs
> +1.000=$10.000 · +5.000=$30.000 · +10.000=$50.000; **(3)** el toggle de PLAN queda para
> Fase 2 (hoy el cambio de plan sigue por las tarjetas de planes/checkout). **🟠 Pendiente:**
> test e2e GO+Fede del batch (suba con delta + baja + guard); deprecación efectiva de
> `mp-addon-fijo`; Fase 2 (cambio de plan por el toggle). El detalle de implementación de las
> secciones de abajo (diseño pre-implementación) se mantiene como referencia técnica — el
> comportamiento real vigente está resumido en `wiki/integrations/mercado-pago.md` §3.i.

## 1. Experiencia (lo que pidió GO)

Panel ÚNICO **"Armá tu plan"** en `/suscripcion` (se elimina el segundo panel "Ampliá tu plan
con add-ons" para no duplicar):

1. Al entrar, si el tenant tiene plan activo: **toggle preseleccionado en SU plan** + sus
   add-ons activos **tildados** + total = lo que viene pagando por mes.
2. El usuario selecciona/deselecciona packs libremente (radio POR DIMENSIÓN: un pack de SKU,
   uno de sucursales, uno de usuarios, uno de comprobantes — cambiar de pack lo reemplaza,
   no se acumulan). El total en vivo SIEMPRE muestra **el nuevo recurrente mensual**.
3. **Nada se aplica hasta el botón** ("Cambiar a este plan" / "Confirmar cambios"). Es un
   BATCH: puede agregar uno, quitar otro y cambiar un tercero en una sola confirmación.
4. Al confirmar:
   - **Delta > 0 (sube el recurrente):** checkout de MP por el **delta como pago único**
     (ej: +$5.000 hoy). Recién cuando MP confirma el pago (webhook) se aplica el batch:
     recurrente nuevo + add-ons sincronizados. Ejemplos GO: Básico $60k + agrega SKU+500
     ($5k) → paga $5.000 hoy, total mensual $65.000. Venía pagando $65k (Básico+SKU 5k) y
     cambia el pack de SKU de $5k a $10k → paga $5.000 hoy (la diferencia), total $70.000.
   - **Delta ≤ 0 (baja o neutro):** sin cobro ni reembolso. Se valida el guard, se ajusta el
     recurrente en MP y se confirma: *"Tu próxima factura del DD/MM llega por $X"* (fecha =
     `next_payment_date` real del preapproval, validado e2e 2026-07-04).
5. Al volver a la página, el panel refleja el estado nuevo (plan + packs tildados).

### Guard de baja a nivel BATCH (incluye el caso GO)
Antes de confirmar cualquier batch se calcula, POR DIMENSIÓN de estado (sku/usuarios/
sucursales): `límite_resultante = base(plan) + pack_objetivo(dim)` y se compara contra el
**uso activo real** del tenant. Si `uso > límite_resultante` → **bloqueado** con detalle:
*"Desactivá N {sku|usuarios|sucursales} sobrantes para poder hacer este cambio"* (para SKU:
desactivar ≠ eliminar). Ejemplo GO: 2.001 SKUs activos, Básico(2.000)+pack(+2.000): quitar el
pack → límite 2.000 < 2.001 → bloqueado; cambiarlo por +500 → límite 2.500 ≥ 2.001 → permitido.
Comprobantes es dimensión de FLUJO (se resetea por mes) → sin guard de baja.
**Bonus:** este guard es la base para cerrar MP-P2 (downgrade de plan sin control) en Fase 2.

## 2. Modelo de pricing v2 (decisión GO 2026-07-05)

| Dimensión | Tipo | Básico | Pro | Packs (fijos/mes) | Enforcement |
|---|---|---|---|---|---|
| SKU (productos activos) | estado | 2.000 | 8.000 | +500=$5k · +2.000=$10k · +8.000=$25k | duro (trigger mig 252) ✅ ya existe |
| Usuarios | estado | 5 | 15 | +1=$5k · +3=$10k · +5=$15k | duro ✅ ya existe |
| Sucursales | estado | 1 | 4 | +1=$15k · +3=$35k · +5=$55k | duro ✅ ya existe |
| **Comprobantes/mes** 🆕 | flujo | **6.000** | **14.000** | **+1.000=$10k · +5.000=$30k · +10.000=$50k** | ⚠ a definir (pregunta Q2) |
| ~~Movimientos/mes~~ | — | ∞ | ∞ | ~~se eliminan los packs~~ | queda solo como telemetría |

- **Métrica "comprobante" (propuesta, confirmar Q1):** toda **venta finalizada** del mes
  calendario = 1 comprobante (con o sin factura AFIP — el ticket interno también cuenta).
  NO cuentan: presupuestos, ventas canceladas. ⚠ `ventas.estado` es TEXT configurable por
  tenant (sin CHECK, mig 174) → el contador NO puede depender de un string exacto: se cuenta
  `ventas` del mes con `cancelado_at IS NULL` y que no sean presupuesto (predicado robusto a
  estados custom; el detalle exacto se cierra en implementación con test).
- **Add-on temporal de movimientos:** se elimina del producto (era el único temporal). El
  código del webhook queda (histórico/idempotencia) pero la UI y el catálogo lo dejan de
  ofrecer. ⚠ Confirmar Q3.
- **Efecto marketing:** el Landing/planes hoy dicen "5.000/20.000 movimientos" → pasan a
  "6.000/14.000 comprobantes". Se pierde el claim "comprobantes ilimitados" del análisis
  competitivo (Netegia corta a 4.000; nosotros 6.000 en Básico sigue siendo 1,5x el suyo a
  62% del precio). `planes-pricing.md` se actualiza al implementar.

## 3. Arquitectura técnica

### 3.1 Datos (mig 258)
```sql
-- Un batch pendiente por tenant (lock natural → mata el race MP-AD7 de raíz)
CREATE TABLE addon_batch_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estado         TEXT NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado IN ('pendiente_pago','aplicado','cancelado','fallido')),
  -- Estado FINAL deseado de packs: [{dimension, cantidad}] (un pack por dimensión, cantidad
  -- del catálogo). El precio NUNCA viaja acá: se recalcula server-side al aplicar.
  packs_objetivo JSONB NOT NULL,
  monto_delta        NUMERIC(12,2) NOT NULL,  -- lo que paga hoy (0 si baja)
  monto_recurrente_nuevo NUMERIC(12,2) NOT NULL,
  mp_preference_id   TEXT,
  mp_payment_id      TEXT,                    -- idempotencia (uq parcial)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at     TIMESTAMPTZ,
  error_detalle  TEXT
);
CREATE UNIQUE INDEX uq_addon_batch_pendiente ON addon_batch_changes(tenant_id)
  WHERE estado = 'pendiente_pago';
CREATE UNIQUE INDEX uq_addon_batch_mp_payment ON addon_batch_changes(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
-- tenant_addons: pasa a UN pack por dimensión (uq parcial tipo='fijo'); hoy no hay filas
-- fijas en PROD → sin migración de datos.
CREATE UNIQUE INDEX uq_tenant_addons_fijo_dim ON tenant_addons(tenant_id, dimension)
  WHERE tipo = 'fijo';
```
RLS: `addon_batch_changes` solo service_role (como `mp_billing_alertas`) + SELECT del propio
tenant para que la UI muestre "tenés un cambio pendiente de pago".

### 3.2 Función SQL atómica (mig 258)
`fn_aplicar_addon_batch(p_tenant, p_change_id)` SECURITY DEFINER: en UNA transacción
sincroniza `tenant_addons` (delete fijos + insert desde `packs_objetivo`) y marca el change
`aplicado`. El EF nunca hace el sync en 2 pasos (evita estados a medias).

### 3.3 EF nueva `mp-addon-batch` (deprecia `mp-addon-fijo`)
- **`action:'preview'`** → recalcula server-side (catálogo espejo): `{ delta,
  recurrente_nuevo, next_payment_date, blocked: [{dimension, excedente, nuevo_limite, uso}] }`.
  El frontend lo llama antes de habilitar el botón (y muestra el guard como en el diseño).
- **`action:'confirmar'`** (JWT → tenant; requiere `active` + `mp_subscription_id`):
  1. Re-valida guard + recomputa TODO server-side (REGLA #0: nada de montos del cliente).
  2. **Cálculo del recurrente nuevo preservando descuentos:**
     `nuevo = monto_actual_MP − precio(packs_actuales) + precio(packs_objetivo)`
     (delta relativo sobre el monto real del preapproval → un plan con descuento no se pisa).
  3. **delta > 0:** crea preference de pago único por el delta con `external_reference =
     "{tenant}|addonbatch|{change_id}"` + fila `pendiente_pago` → devuelve `init_point`.
     El cobro y la aplicación ocurren DESPUÉS, vía webhook (fail-closed: si no paga, no
     cambia nada; el pending expira/cancela si crea otro batch).
  4. **delta ≤ 0:** sin pago: `PUT` del recurrente (fail-closed: si MP no confirma → 502 y
     nada se toca) → `fn_aplicar_addon_batch` → responde `{ok, recurrente_nuevo,
     next_payment_date}` para el mensaje "tu factura del DD/MM llega por $X".
- **`mp-webhook` (rama nueva, patrón del add-on temporal):** `payment` aprobado con ref
  `|addonbatch|` → idempotente por `uq_addon_batch_mp_payment` → lee el change →
  `PUT` recurrente (si MP falla acá: change → `fallido` + fila en `mp_billing_alertas`
  tipo nuevo `batch_pagado_sin_aplicar` + email a soporte — el cliente PAGÓ, prioridad
  máxima de conciliación; reintento manual/automático) → `fn_aplicar_addon_batch`.
- **Checkout-return del batch:** `/suscripcion?type=addonbatch&status=approved` → la página
  pollea el estado del change (patrón `verifState`, reintentos) → "¡Listo! Tu plan quedó en
  $X/mes" o "estamos confirmando tu pago". El sweep `mp-reconciliacion` NO cubre esto (es de
  suscripciones) — la red del batch es el webhook + la alerta `batch_pagado_sin_aplicar`.

### 3.4 Límites (comprobantes)
- `fn_tenant_limite` (mig 259): dimensión `comprobantes` → base por tier + pack fijo activo.
- Contador mensual: `count(ventas)` del mes con predicado robusto (no-presupuesto,
  no-cancelada). `usePlanLimits` expone `comprobantes_mes / max_comprobantes` (reemplaza la
  barra de movimientos en `/suscripcion` y las alertas).
- `brand.ts`: `ADDON_PACKS.comprobantes` + límites base + textos de PLANES (landing) +
  `MAX_MOVIMIENTOS_POR_PLAN` → deprecado.
- Enforcement: **según Q2** (recomendación: soft con upsell — nunca frenar un cobro en el
  mostrador; coherente con la decisión F3b de GO del 2026-07-02 "nunca se corta una venta").

### 3.5 Qué se toca / qué NO
| Componente | Acción |
|---|---|
| `SuscripcionPage` | quitar panel "Ampliá tu plan" + packs de movimientos; el `PricingConfigurator` pasa a modo batch (estado inicial = plan+packs actuales; botón = preview/confirmar) |
| `PricingConfigurator` | props nuevos: `initialPlan`, `initialPacks`, `onConfirm(batch)`, `preview` (delta/guard); Landing sigue como estimador puro |
| `mp-addon-fijo` (EF) | queda deployada pero la UI deja de llamarla (deprecación; se borra en una limpieza futura) |
| `mp-addon` (EF temporal) | ídem — la UI deja de ofrecer packs de movimientos (Q3) |
| `ADDON_FIJO_ENABLED` | se reusa como kill-switch del panel batch (mismo criterio) |
| Espejos/tests | `mpAddonBatch.ts` NUEVO (cálculo delta batch + guard batch + decisiones webhook) + actualizar `addons.ts` (catálogo comprobantes, un-pack-por-dimensión) + UAT `mp-suscripciones-pagos.plan.md` sección nueva |

## 4. Fases
1. **Fase 1 (esta):** todo lo de arriba con el PLAN FIJO (el toggle muestra el plan actual
   deshabilitado o navega a las tarjetas). Migs 258-259 + EF + webhook + UI + tests.
2. **Fase 2:** cambio de PLAN desde el toggle con el mismo modelo de delta. Requiere decidir
   cómo derivar el tier cuando `preapproval_plan_id` ya no matchea el tier real (hoy 3 EFs
   mapean tier desde el plan de MP — cambiarlo tiene riesgo REGLA #0 y va con diseño propio).
3. **Fase 3 (limpieza):** borrar `mp-addon-fijo`/packs de movimientos del código + wiki.

## 5. ✅ Decisiones GO (2026-07-05 — diseño CERRADO, en implementación)
- **Q1 — Métrica:** toda **venta finalizada** = 1 comprobante (ticket interno o factura AFIP,
  da igual). Presupuestos y canceladas NO cuentan.
- **Q2 — Enforcement: SOFT** — al 80% banner de upsell, al 100% aviso fuerte + email, pero la
  venta SIEMPRE sale (coherente con F3b: nunca frenar un cobro en el mostrador).
- **Q3 — El add-on temporal pasa a ser DE COMPROBANTES** (reemplaza al de movimientos): mismos
  packs +1.000=$10k · +5.000=$30k · +10.000=$50k, pago único, vence a 30 días — para picos
  puntuales de un mes. Comprobantes queda con AMBOS tipos (fijo en el panel batch + temporal).
- **Q4 — UN pack FIJO por dimensión** (elegir otro pack reemplaza al anterior). Los temporales
  de comprobantes sí pueden acumularse (compras puntuales, como eran los de movimientos).
