-- 337_meli_rentabilidad_neta.sql
-- Fase D1 del roadmap de integraciones (rentabilidad neta real MELI). Guarda la comisión de
-- MELI por ítem y el costo de envío/impuestos retenidos por el marketplace a nivel de venta,
-- para poder calcular ganancia_neta = total - costo_producto - comisión - envío - impuestos.
-- Nombres genéricos (no "meli_...") porque costo_envio_logistica ya se reusa entre TN/MELI/POS
-- y comision_marketplace/impuestos_marketplace podrían aplicar a otras integraciones futuras.
-- OJO: impuestos_marketplace NO es el IVA fiscal de la factura (columna iva_monto, ya usada
-- para AFIP/CAE) — es la retención que hace el marketplace sobre el pago, un concepto distinto.
ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS comision_marketplace numeric(12,2);
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS impuestos_marketplace numeric(12,2);
