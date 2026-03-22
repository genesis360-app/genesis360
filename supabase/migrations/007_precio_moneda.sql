-- Migration 007: columnas de moneda por precio en tabla productos
-- Permite registrar si cada precio está en ARS o USD

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS precio_costo_moneda VARCHAR(3) NOT NULL DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS precio_venta_moneda VARCHAR(3) NOT NULL DEFAULT 'ARS';
