-- Migration 051: Sprint A Inventario
-- Over-receipt configurable en tenants

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS permite_over_receipt BOOLEAN NOT NULL DEFAULT FALSE;
