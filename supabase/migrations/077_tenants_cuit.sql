-- Migration 077: CUIT en tenants (faltaba en 076)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cuit TEXT;
