-- ============================================================
-- Migration 021: Límite de movimientos por plan + add-ons
-- ============================================================

-- addon_movimientos: movimientos extra comprados por el tenant (se suman al límite del plan)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS addon_movimientos INT DEFAULT 0;
