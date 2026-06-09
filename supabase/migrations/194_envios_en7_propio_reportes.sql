-- Migration 194 — Envíos EN7: envío propio + recursos + reportes/alertas (G2 + H1/H2/H3)
-- G2: asociar envío a un recurso (vehículo), sumar KM al recurso y auto-generar gasto de combustible.
-- H2: umbrales configurables de las alertas operativas de envíos.
-- H1/H3 (reportes + export + etiquetas A4) son solo frontend, sin DDL.
-- Todo aditivo / idempotente.

-- ============================================================
-- 1) envios — vínculo con recurso (vehículo) + KM + gasto de combustible (G2)
-- ============================================================
ALTER TABLE envios ADD COLUMN IF NOT EXISTS recurso_id           UUID REFERENCES recursos(id) ON DELETE SET NULL;
ALTER TABLE envios ADD COLUMN IF NOT EXISTS km_recorridos        NUMERIC;  -- G2 km del envío (auto desde Distance Matrix o manual)
ALTER TABLE envios ADD COLUMN IF NOT EXISTS gasto_combustible_id UUID REFERENCES gastos(id) ON DELETE SET NULL; -- G2 link al gasto de combustible generado

COMMENT ON COLUMN envios.recurso_id IS 'EN7/G2: vehículo (módulo Recursos) usado para el envío propio.';
COMMENT ON COLUMN envios.gasto_combustible_id IS 'EN7/G2: gasto de combustible auto-generado para este envío.';

-- ============================================================
-- 2) recursos — odómetro + rendimiento (G2). Solo relevante para vehículos.
-- ============================================================
ALTER TABLE recursos ADD COLUMN IF NOT EXISTS km_acumulado         NUMERIC NOT NULL DEFAULT 0; -- G2 odómetro: suma de KM de los envíos
ALTER TABLE recursos ADD COLUMN IF NOT EXISTS consumo_litros_100km NUMERIC;                    -- G2 rendimiento (L/100km), nullable

COMMENT ON COLUMN recursos.km_acumulado IS 'EN7/G2: KM acumulados por envíos propios asignados a este recurso.';
COMMENT ON COLUMN recursos.consumo_litros_100km IS 'EN7/G2: consumo de combustible en litros por 100 km (para estimar el gasto).';

-- ============================================================
-- 3) tenants — config combustible (G2) + umbrales de alertas de envíos (H2)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_combustible_precio_litro NUMERIC NOT NULL DEFAULT 0;  -- G2 precio del litro
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_sin_despacho_horas INT NOT NULL DEFAULT 24;    -- H2-a
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_pod_pendiente_dias INT NOT NULL DEFAULT 3;     -- H2-b
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_pago_courier_dias  INT NOT NULL DEFAULT 7;     -- H2-c
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_diferencia_pct     NUMERIC NOT NULL DEFAULT 15; -- H2-d (umbral % cotizado vs real)

COMMENT ON COLUMN tenants.envio_combustible_precio_litro IS 'EN7/G2: precio del litro de combustible para estimar el gasto del envío propio.';
COMMENT ON COLUMN tenants.envio_alerta_diferencia_pct IS 'EN7/H2-d: % de diferencia cotizado vs real que dispara la alerta.';

-- ============================================================
-- 4) Categoría de gasto "Combustible" (predefinida, seed mig 130 orden 90).
--    Garantizar que exista para tenants viejos (idempotente).
-- ============================================================
INSERT INTO categorias_gasto (tenant_id, nombre, requiere_sucursal, predefinida, orden)
SELECT t.id, 'Combustible', FALSE, TRUE, 90
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM categorias_gasto cg WHERE cg.tenant_id = t.id AND cg.nombre = 'Combustible'
);
