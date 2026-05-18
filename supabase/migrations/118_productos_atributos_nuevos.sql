-- Migration 118: ISS-113/115/119/121 — Nuevos campos en productos e inventario_lineas

-- ── productos ──────────────────────────────────────────────────────────────────
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS marca            TEXT,
  ADD COLUMN IF NOT EXISTS shelf_life_dias  INT,
  ADD COLUMN IF NOT EXISTS tiene_pais_origen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tiene_talle      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tiene_color      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tiene_encaje     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tiene_formato    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tiene_sabor_aroma BOOLEAN NOT NULL DEFAULT FALSE;

-- ── inventario_lineas ──────────────────────────────────────────────────────────
ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS pais_origen  TEXT,
  ADD COLUMN IF NOT EXISTS talle        TEXT,
  ADD COLUMN IF NOT EXISTS color        TEXT,
  ADD COLUMN IF NOT EXISTS encaje       TEXT,
  ADD COLUMN IF NOT EXISTS formato      TEXT,
  ADD COLUMN IF NOT EXISTS sabor_aroma  TEXT;
