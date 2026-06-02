-- ============================================================
-- Migration 171 — Relevamiento Clientes · Fase CL1
-- Fundación de datos + permisos del módulo Clientes.
--   A6  — Baja de cliente: soft delete + razón de baja (la col `activo` ya existe)
--   F1  — Catálogo de etiquetas predefinidas por tenant (para autocomplete)
-- Aditiva e idempotente. Sin backfill destructivo.
-- ============================================================

-- A6 — Soft delete con trazabilidad de la baja -----------------------------
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS motivo_baja TEXT,                       -- mudó / cerró / conflicto / texto libre
  ADD COLUMN IF NOT EXISTS baja_at     TIMESTAMPTZ,                -- cuándo se dio de baja
  ADD COLUMN IF NOT EXISTS baja_por    UUID REFERENCES users(id); -- quién la dio de baja

-- Índice parcial: las búsquedas por defecto solo traen activos
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(tenant_id) WHERE activo;

-- F1 — Catálogo de etiquetas predefinidas por tenant -----------------------
-- Las etiquetas siguen viviendo como array libre en `clientes.etiquetas`;
-- este catálogo alimenta el autocomplete (predefinidas + libres ya usadas).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cliente_etiquetas_catalogo TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
