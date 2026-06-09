-- Migration 197 — RRHH RH3: Nómina contable + recibo + integración Gastos (B6/B7/B8)
-- B6 recibo PDF + comprobante firmado · B7 pagar nómina genera gasto en Gastos (pendiente)
-- B8 doble validación configurable. Todo aditivo / idempotente.

-- ============================================================
-- 1) rrhh_salarios — link al gasto generado (B7) + comprobante firmado (B6)
-- ============================================================
ALTER TABLE rrhh_salarios ADD COLUMN IF NOT EXISTS gasto_id                UUID REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE rrhh_salarios ADD COLUMN IF NOT EXISTS comprobante_firmado_url TEXT;

COMMENT ON COLUMN rrhh_salarios.gasto_id IS 'RH3/B7: gasto (pendiente) generado en el módulo Gastos al liquidar.';
COMMENT ON COLUMN rrhh_salarios.comprobante_firmado_url IS 'RH3/B6: comprobante firmado (empleado+empleador) de recepción del pago, opcional.';

-- ============================================================
-- 2) tenants — doble validación de nómina (B8)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_nomina_doble_validacion BOOLEAN NOT NULL DEFAULT FALSE;  -- B8
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_nomina_supervisor_aprueba BOOLEAN NOT NULL DEFAULT FALSE; -- B8 (SUPERVISOR con permiso firma)

COMMENT ON COLUMN tenants.rrhh_nomina_doble_validacion IS 'RH3/B8: si true, RRHH prepara pero solo DUEÑO/ADMIN (o SUPERVISOR si rrhh_nomina_supervisor_aprueba) genera el gasto/paga.';

-- ============================================================
-- 3) Categorías de gasto predefinidas para nómina (B7) — idempotente
-- ============================================================
INSERT INTO categorias_gasto (tenant_id, nombre, requiere_sucursal, predefinida, orden)
SELECT t.id, v.nombre, FALSE, TRUE, v.orden
FROM tenants t
CROSS JOIN (VALUES
  ('Sueldos',        15),
  ('Cargas sociales', 16)
) AS v(nombre, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM categorias_gasto cg WHERE cg.tenant_id = t.id AND cg.nombre = v.nombre
);
