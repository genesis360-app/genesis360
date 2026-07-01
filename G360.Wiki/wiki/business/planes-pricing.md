---
title: Planes y Pricing
category: business
tags: [planes, pricing, free, basic, pro, enterprise, limites]
sources: []
updated: 2026-04-30
---

# Planes y Pricing

---

## Tabla de planes

| Plan | Usuarios | Productos | Sucursales | Precio |
|------|----------|-----------|------------|--------|
| **Free** | 1 | 50 | 1 | $0 ARS/mes |
| **Basic** | 2 | 500 | 1 | $4.900 ARS/mes |
| **Pro** | 10 | 5.000 | Múltiples | $9.900 ARS/mes |
| **Enterprise** | Ilimitado | Ilimitado | Ilimitado | A convenir |

---

## Trial

- **Duración:** 14 días
- **Acceso:** equivalente al plan Pro
- **Sin tarjeta** requerida al inicio

---

## Límites técnicos

Los límites se verifican en el hook `src/hooks/usePlanLimits.ts`. El hook recibe el plan del tenant y retorna los límites aplicables.

El `SubscriptionGuard` en `src/components/AuthGuard.tsx` bloquea acceso a features no incluidas en el plan actual.

---

## Cómo se cuentan los límites (mecánica real, 2026-06-30)

- **Movimiento (`movimientos_mes`):** una fila en **`movimientos_stock`** = **solo movimiento de INVENTARIO** (venta/rebaja, ingreso, ajuste, traslado, devolución, kits). **NO cuentan** facturar ni agregar un gasto. Se cuenta **por tenant** (no por sucursal), del **mes calendario** en curso (se resetea el 1°). **Un ingreso masivo de N productos = N movimientos** (1 fila por SKU); una venta de N ítems ≈ N. Límites: Free **200** · Básico **2.000** · Pro/Enterprise **ilimitado** + `addon_movimientos`. ⚠ Enforce **solo client-side** (`usePlanLimits`) — sin guard server-side, se puede exceder por API (a endurecer si el pricing depende de esto).
- **Producto:** cada fila en `productos` (`activo=true`). **Cada variante (talla/color) cuenta como un producto separado** — "generar combinaciones" 3 talles × 2 colores crea **6 productos**. El grupo de variantes es solo agrupación visual.

## Costo para nosotros (para el margen)

- **Storage: despreciable.** Supabase ~US$0,021/GB/mes. Un tenant Pro al 100% ≈ 1,5-3 GB (imágenes de producto + comprobantes) → ~US$0,06/mes. Las facturas/presupuestos/remitos generados NO se guardan (regenerados on-demand). El costo real no es storage → es egress, Resend, comisión MP y el plan base compartido (Supabase/Vercel).
- **Facturación AFIP: $0 de AFIP/ARCA** (no cobra por CAE). La app usa **AfipSDK** (no WSFE directo — ver `facturacion-afip.md` "⚠ Cómo está implementado HOY"); el `afipsdk_token` es **por tenant** → si cada cliente trae su cuenta, el costo (si supera free tier) es del cliente. GO quiere migrar a WSFE propio ($0 terceros) — backlog.
- **Comisión MP:** ~4,3% de cada cobro de suscripción (4900→4689,16). **Cobro en ARS.**
- **Snapshot (2026-06-30):** solo se paga Claude Code (US$23/mes) + dominio (~US$15/año); resto en free tier; 0 clientes PROD. Umbrales de escalado (sin $) en `sources/raw/reference_escalabilidad.md`.

> [!NOTE] La tabla de arriba (usuarios/productos/precios) y "Features por plan" pueden estar desactualizadas (trial dice 14d, la app usa 7d en el welcome; AFIP no está estrictamente gateada a Pro en el código). Revisar contra `src/config/brand.ts` (`PLANES`, `MAX_MOVIMIENTOS_POR_PLAN`, `FEATURES_POR_PLAN`) al definir el pricing final.

---

## Features por plan

> [!NOTE] Esta tabla debe actualizarse cada vez que se agreguen features gateadas por plan.

| Feature | Free | Basic | Pro | Enterprise |
|---------|------|-------|-----|-----------|
| Inventario | ✓ | ✓ | ✓ | ✓ |
| POS/Ventas | ✓ | ✓ | ✓ | ✓ |
| Caja | ✓ | ✓ | ✓ | ✓ |
| Reportes básicos | ✓ | ✓ | ✓ | ✓ |
| Exportación Excel/PDF | — | ✓ | ✓ | ✓ |
| RRHH | — | — | ✓ | ✓ |
| Marketplace (MeLi/TN) | — | — | ✓ | ✓ |
| Multi-sucursal | — | — | ✓ | ✓ |
| AFIP Facturación | — | — | ✓ | ✓ |
| Auto-reorder | — | — | ✓ | ✓ |
| API acceso | — | — | — | ✓ |

---

## Links relacionados

- [[wiki/features/suscripciones-planes]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/business/modelo-negocio]]
