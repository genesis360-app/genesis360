-- ============================================================
-- Migration 020: Marketplace Integration
-- Agrega campos de marketplace a productos y tenants
-- ============================================================

-- ─── productos: campos marketplace ───────────────────────────────────────────
ALTER TABLE productos ADD COLUMN IF NOT EXISTS publicado_marketplace    BOOLEAN      DEFAULT FALSE;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_marketplace       DECIMAL(12,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_reservado_marketplace INT        DEFAULT 0;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS descripcion_marketplace  TEXT;

-- ─── tenants: configuración marketplace ──────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketplace_activo       BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketplace_webhook_url  TEXT;

-- Índice para consultar rápido los productos publicados por tenant
CREATE INDEX IF NOT EXISTS idx_productos_marketplace
  ON productos(tenant_id, publicado_marketplace)
  WHERE publicado_marketplace = TRUE;
