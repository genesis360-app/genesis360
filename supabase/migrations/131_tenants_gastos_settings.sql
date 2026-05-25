-- Migration 131: settings de Gastos en tenants
-- Reglas de negocio Gastos · Fase 1 (v1.8.42)
-- 4 reglas combinables OR para obligatoriedad de comprobante + días de alerta borrador + alerta anticipo OC

ALTER TABLE tenants
  -- Regla 1: comprobante obligatorio si iva_deducible o conciliado_iva están marcados
  ADD COLUMN IF NOT EXISTS gastos_comp_si_iva                    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Regla 2: comprobante obligatorio si monto > umbral
  ADD COLUMN IF NOT EXISTS gastos_comp_si_monto                  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gastos_comp_monto_umbral              DECIMAL(12,2),
  -- Regla 3: comprobante obligatorio si deduce_ganancias o gasto_negocio están marcados
  ADD COLUMN IF NOT EXISTS gastos_comp_si_deduce_ganancias       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Regla 4: comprobante siempre obligatorio (DEFAULT activo)
  ADD COLUMN IF NOT EXISTS gastos_comp_siempre                   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Alertas
  ADD COLUMN IF NOT EXISTS gastos_dias_alerta_borrador           INT     NOT NULL DEFAULT 7
    CHECK (gastos_dias_alerta_borrador BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS gastos_dias_alerta_anticipo_oc        INT     NOT NULL DEFAULT 15
    CHECK (gastos_dias_alerta_anticipo_oc BETWEEN 1 AND 365);

COMMENT ON COLUMN tenants.gastos_comp_si_iva              IS 'Comprobante obligatorio si iva_deducible o conciliado_iva del gasto = true';
COMMENT ON COLUMN tenants.gastos_comp_si_monto            IS 'Comprobante obligatorio si gasto.monto > gastos_comp_monto_umbral';
COMMENT ON COLUMN tenants.gastos_comp_monto_umbral        IS 'Umbral de monto para regla gastos_comp_si_monto';
COMMENT ON COLUMN tenants.gastos_comp_si_deduce_ganancias IS 'Comprobante obligatorio si deduce_ganancias o gasto_negocio del gasto = true';
COMMENT ON COLUMN tenants.gastos_comp_siempre             IS 'Comprobante obligatorio siempre (regla por defecto activa)';
COMMENT ON COLUMN tenants.gastos_dias_alerta_borrador     IS 'Días sin medio_pago antes de generar alerta de borrador (default 7)';
COMMENT ON COLUMN tenants.gastos_dias_alerta_anticipo_oc  IS 'Días desde anticipo a OC sin recibir mercadería antes de alerta (default 15)';
