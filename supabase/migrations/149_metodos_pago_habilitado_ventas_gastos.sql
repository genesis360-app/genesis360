-- Migration 149: ISS-135 — Métodos de pago: toggles habilitado para Ventas y Gastos

ALTER TABLE metodos_pago
  ADD COLUMN IF NOT EXISTS habilitado_ventas BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS habilitado_gastos BOOLEAN NOT NULL DEFAULT true;
