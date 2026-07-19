-- Migration 281 (backlog Config Ventas/Envíos, punto 1 — pedido Fede/GO 2026-07-19):
-- Trazabilidad del DESCUENTO POR MÉTODO DE PAGO en la venta (REGLA #0: todo descuento que
-- reduce el total cobrado tiene que quedar registrado en el documento de la venta, no solo
-- implícito en el total).
--
-- La config del descuento vive en `metodos_pago.config` (jsonb ya existente, reservado sin
-- uso desde su creación) bajo la clave `descuento`:
--   {"descuento": {"pct": 10, "tope": 5000, "dias": [1,3], "desde": "2026-07-01", "hasta": null}}
--   · pct: % de descuento al cliente (distinto de comision_pct, que es el costo del tenant)
--   · tope: tope en $ por venta (null = sin tope) · dias: días de semana 0=Dom..6=Sáb
--   · desde/hasta: vigencia por fecha (YYYY-MM-DD, inclusive)
-- Lógica pura en src/lib/promosPago.ts (unit-testeada).
--
-- ventas.promo_pago guarda el DETALLE aplicado: [{"metodo":"Efectivo","pct":10,"monto":1500}]
-- NULL = venta sin descuento por método de pago.

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS promo_pago jsonb;

COMMENT ON COLUMN public.ventas.promo_pago IS
  'Descuentos por método de pago aplicados en esta venta: [{metodo, pct, monto}]. El total de la venta ya los tiene restados. NULL = sin promo de pago. Ver mig 281 / src/lib/promosPago.ts.';
