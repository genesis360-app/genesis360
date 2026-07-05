-- 256: Tabla de alertas del sweep de reconciliación de billing MP (UAT MP-W6 / DRIFT 1-2).
-- El EF mp-reconciliacion (cron horario vía GitHub Actions) detecta:
--   • 'huerfana'            → preapproval authorized de un plan nuestro SIN tenant linkeado
--                             (pago perdido en silencio — caso real Fede 2026-07-04)
--   • 'drift_mp_cobra'      → preapproval authorized cuyo tenant NO está 'active' (MP cobra, DB no da acceso)
--   • 'drift_acceso_gratis' → tenant 'active' cuyo preapproval linkeado NO está vivo (acceso sin cobro)
-- Solo detecta y alerta a soporte (email) — NUNCA activa/mueve plata solo (REGLA #0):
-- la resolución es humana vía admin-api billing.link_subscription (validado e2e).
-- UNIQUE(tipo, preapproval_id) = dedupe del email (se alerta una vez por hallazgo).

CREATE TABLE IF NOT EXISTS mp_billing_alertas (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo           TEXT NOT NULL CHECK (tipo IN ('huerfana', 'drift_mp_cobra', 'drift_acceso_gratis')),
  preapproval_id TEXT NOT NULL,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE SET NULL,
  detalle        JSONB,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  UNIQUE (tipo, preapproval_id)
);

-- Solo service_role (el EF); ni anon ni authenticated la ven. RLS sin policies = cerrada.
ALTER TABLE mp_billing_alertas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mp_billing_alertas FROM PUBLIC;
REVOKE ALL ON mp_billing_alertas FROM anon;
REVOKE ALL ON mp_billing_alertas FROM authenticated;
GRANT ALL ON mp_billing_alertas TO service_role;
