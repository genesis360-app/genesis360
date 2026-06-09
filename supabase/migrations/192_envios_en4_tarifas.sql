-- Migration 192 — Envíos EN4: costos y tarifas avanzados (B1-B6)
-- B1 recargo horario · B2 factor KM · B3 costo mínimo/escalonado · B4 política de cobro
-- B5 envío gratis condicional · B6 diferencia real vs cotizado a-favor/pérdida con motivo.
-- Todo aditivo / idempotente.

-- ============================================================
-- 1) tenants — config de tarifas y cobro (Config → Envíos)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_factor_km        NUMERIC NOT NULL DEFAULT 1.35;  -- B2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_costo_minimo     NUMERIC NOT NULL DEFAULT 0;     -- B3
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_tramos           JSONB   NOT NULL DEFAULT '[]'::jsonb;  -- B3 [{hasta,precio}]
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_recargo_horario  JSONB   NOT NULL DEFAULT '[]'::jsonb;  -- B1 [{desde,hasta,recargo}]
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_cobro_politica   TEXT    NOT NULL DEFAULT 'cliente_100'; -- B4 cliente_100|cliente_margen|subsidio
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_cobro_margen_pct NUMERIC NOT NULL DEFAULT 0;     -- B4
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_subsidio_umbral  NUMERIC NOT NULL DEFAULT 0;     -- B4
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_gratis_reglas    JSONB   NOT NULL DEFAULT '{}'::jsonb;  -- B5 {montoMinimo,etiquetas,promoDesde,promoHasta}

COMMENT ON COLUMN tenants.envio_factor_km      IS 'EN4/B2: factor que penaliza la distancia real (default 1.35).';
COMMENT ON COLUMN tenants.envio_tramos         IS 'EN4/B3: costo escalonado [{hasta_km, precio}] (envío propio).';
COMMENT ON COLUMN tenants.envio_cobro_politica IS 'EN4/B4: qué paga el cliente — cliente_100 | cliente_margen | subsidio.';
COMMENT ON COLUMN tenants.envio_gratis_reglas  IS 'EN4/B5: envío gratis condicional {montoMinimo, etiquetas[], promoDesde, promoHasta}.';

-- ============================================================
-- 2) envios — B6 diferencia real vs cotizado (precio al cliente inmutable post-pago)
-- ============================================================
ALTER TABLE envios ADD COLUMN IF NOT EXISTS diferencia_tipo   TEXT;     -- a_favor | perdida | neutro
ALTER TABLE envios ADD COLUMN IF NOT EXISTS diferencia_monto  NUMERIC;  -- |costo_real - costo_cotizado|
ALTER TABLE envios ADD COLUMN IF NOT EXISTS diferencia_motivo TEXT;     -- catálogo DIFERENCIA_MOTIVOS

COMMENT ON COLUMN envios.diferencia_tipo IS 'EN4/B6: a_favor (real<cotizado) | perdida (real>cotizado). El precio al cliente NO se modifica.';
