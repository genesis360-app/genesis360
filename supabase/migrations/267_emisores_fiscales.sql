-- 267: Multi-CUIT por tenant — FASE 1: modelo de datos (NEUTRO, sin cambio de comportamiento).
--
-- Un tenant puede tener N identidades FISCALES (razón social + CUIT + condición IVA + cert +
-- puntos de venta), manteniendo stock/clientes/caja/usuarios compartidos. Diseño completo en
-- G360.Wiki/wiki/features/multi-cuit.md (decisiones GO 2026-07-10: emisor por sucursal con
-- override; gastos imputados a emisor; monetización por add-on "CUIT adicional").
--
-- Esta fase SOLO crea la tabla + backfill del emisor default por tenant + FKs en los hijos.
-- Nada la lee todavía: la EF y la UI siguen usando tenants.* (cutover en Fases 2-3). Un trigger
-- transicional mantiene el emisor default sincronizado con tenants.* hasta el cutover.

-- ── Tabla de emisores fiscales ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emisores_fiscales (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre               text NOT NULL,          -- etiqueta interna ("Otranto SA")
  cuit                 text NOT NULL,
  razon_social_fiscal  text,
  condicion_iva_emisor text,                   -- RI / Monotributista / Exento
  domicilio_fiscal     text,
  ingresos_brutos      text,
  inicio_actividades   date,
  umbral_factura_b     numeric,
  afip_produccion      boolean NOT NULL DEFAULT false,
  afip_provider        text NOT NULL DEFAULT 'propio' CHECK (afip_provider IN ('afipsdk','propio')),
  afipsdk_token        text,
  -- Datos que van al PDF del comprobante y son POR razón social:
  banco                text,
  cbu                  text,
  alias_cbu            text,
  leyenda_comprobante  text,
  logo_url             text,
  es_default           boolean NOT NULL DEFAULT false,
  activo               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE emisores_fiscales IS
  'Identidades fiscales del tenant (multi-CUIT, F5). El emisor default espeja los campos fiscales de tenants hasta el cutover de Fase 3. Ver wiki/features/multi-cuit.md';

-- Un solo default por tenant · un CUIT no se repite dentro del tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_emisores_fiscales_default
  ON emisores_fiscales (tenant_id) WHERE es_default;
CREATE UNIQUE INDEX IF NOT EXISTS uq_emisores_fiscales_tenant_cuit
  ON emisores_fiscales (tenant_id, cuit);
CREATE INDEX IF NOT EXISTS idx_emisores_fiscales_tenant_id ON emisores_fiscales (tenant_id);

-- RLS: tenant-scoped (mismo patrón que puntos_venta_afip / tenant_certificates)
ALTER TABLE emisores_fiscales ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'emisores_fiscales' AND policyname = 'emisores_fiscales_tenant') THEN
    CREATE POLICY emisores_fiscales_tenant ON emisores_fiscales FOR ALL
      USING (tenant_id IN (SELECT users.tenant_id FROM users WHERE users.id = (SELECT auth.uid())))
      WITH CHECK (tenant_id IN (SELECT users.tenant_id FROM users WHERE users.id = (SELECT auth.uid())));
  END IF;
END $$;

-- Grants: nunca anon (contiene afipsdk_token). Ver reference_revoke_public_no_anon.
REVOKE ALL ON emisores_fiscales FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON emisores_fiscales TO authenticated;
GRANT ALL ON emisores_fiscales TO service_role;

-- ── FKs nuevas en los hijos (nullable; con 1 emisor todo sigue igual) ─────────────
-- ON DELETE SET NULL: borrar un emisor con comprobantes se previene a nivel app
-- (desactivar en vez de borrar); el SET NULL evita bloquear el hard-delete en cascada
-- de un tenant completo. La trazabilidad fiscal del comprobante vive en sus campos
-- propios (cae/tipo/numero), no solo en la FK.
ALTER TABLE tenant_certificates ADD COLUMN IF NOT EXISTS emisor_id uuid REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE puntos_venta_afip   ADD COLUMN IF NOT EXISTS emisor_id uuid REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE sucursales          ADD COLUMN IF NOT EXISTS emisor_fiscal_id uuid REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE ventas              ADD COLUMN IF NOT EXISTS emisor_id uuid REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE gastos              ADD COLUMN IF NOT EXISTS emisor_id uuid REFERENCES emisores_fiscales(id) ON DELETE SET NULL;

COMMENT ON COLUMN puntos_venta_afip.emisor_id IS 'Los PV de AFIP son POR CUIT: el PV 1 del CUIT A no es el PV 1 del CUIT B.';
COMMENT ON COLUMN sucursales.emisor_fiscal_id IS 'Emisor fiscal default de la sucursal (regla: emisor de la venta = override ?? sucursal ?? default del tenant).';
COMMENT ON COLUMN ventas.emisor_id IS 'Emisor con el que se emitió el comprobante (lo setea la EF al persistir el CAE, Fase 2). La NC SIEMPRE hereda este emisor.';
COMMENT ON COLUMN gastos.emisor_id IS 'CUIT al que se imputa el IVA crédito del gasto (Fase 5).';

CREATE INDEX IF NOT EXISTS idx_tenant_certificates_emisor_id ON tenant_certificates (emisor_id);
CREATE INDEX IF NOT EXISTS idx_puntos_venta_afip_emisor_id   ON puntos_venta_afip (emisor_id);
CREATE INDEX IF NOT EXISTS idx_sucursales_emisor_fiscal_id   ON sucursales (emisor_fiscal_id);
CREATE INDEX IF NOT EXISTS idx_ventas_emisor_id              ON ventas (emisor_id);
CREATE INDEX IF NOT EXISTS idx_gastos_emisor_id              ON gastos (emisor_id);

-- ── Backfill neutro: 1 emisor default por tenant con CUIT ─────────────────────────
INSERT INTO emisores_fiscales (
  tenant_id, nombre, cuit, razon_social_fiscal, condicion_iva_emisor, domicilio_fiscal,
  ingresos_brutos, inicio_actividades, umbral_factura_b, afip_produccion, afip_provider,
  afipsdk_token, banco, cbu, alias_cbu, leyenda_comprobante, logo_url, es_default, activo
)
SELECT
  t.id, COALESCE(t.razon_social_fiscal, t.nombre, 'Emisor principal'), t.cuit,
  t.razon_social_fiscal, t.condicion_iva_emisor, t.domicilio_fiscal,
  t.ingresos_brutos, t.inicio_actividades, t.umbral_factura_b,
  COALESCE(t.afip_produccion, false), COALESCE(t.afip_provider, 'propio'),
  t.afipsdk_token, t.banco, t.cbu, t.alias_cbu, t.leyenda_comprobante, t.logo_url,
  true, true
FROM tenants t
WHERE t.cuit IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM emisores_fiscales e WHERE e.tenant_id = t.id);

-- Hijos existentes → linkear al emisor default del tenant
UPDATE tenant_certificates tc SET emisor_id = e.id
FROM emisores_fiscales e
WHERE e.tenant_id = tc.tenant_id AND e.es_default AND tc.emisor_id IS NULL;

UPDATE puntos_venta_afip pv SET emisor_id = e.id
FROM emisores_fiscales e
WHERE e.tenant_id = pv.tenant_id AND e.es_default AND pv.emisor_id IS NULL;

UPDATE sucursales s SET emisor_fiscal_id = e.id
FROM emisores_fiscales e
WHERE e.tenant_id = s.tenant_id AND e.es_default AND s.emisor_fiscal_id IS NULL;

-- Ventas: solo los comprobantes YA emitidos (emisor_id = "quién emitió esto")
UPDATE ventas v SET emisor_id = e.id
FROM emisores_fiscales e
WHERE e.tenant_id = v.tenant_id AND e.es_default AND v.cae IS NOT NULL AND v.emisor_id IS NULL;

-- Gastos: solo los que participan del IVA crédito
UPDATE gastos g SET emisor_id = e.id
FROM emisores_fiscales e
WHERE e.tenant_id = g.tenant_id AND e.es_default AND g.iva_deducible = true AND g.emisor_id IS NULL;

-- ── Sync TRANSICIONAL tenants → emisor default (se elimina en el cutover de Fase 3) ──
-- Mientras Config → Facturación siga escribiendo los campos fiscales en `tenants`, este
-- trigger mantiene el emisor default espejado (evita drift entre Fase 1 y el cutover).
-- SECURITY DEFINER: mismo motivo que los seeds de alta (mig 166) — el trigger puede correr
-- en contextos donde el WITH CHECK de RLS rechazaría el upsert.
CREATE OR REPLACE FUNCTION fn_sync_emisor_fiscal_default()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cuit IS NULL THEN
    RETURN NEW;  -- sin CUIT no hay identidad fiscal que espejar
  END IF;

  UPDATE emisores_fiscales SET
    nombre               = COALESCE(NEW.razon_social_fiscal, NEW.nombre, nombre),
    cuit                 = NEW.cuit,
    razon_social_fiscal  = NEW.razon_social_fiscal,
    condicion_iva_emisor = NEW.condicion_iva_emisor,
    domicilio_fiscal     = NEW.domicilio_fiscal,
    ingresos_brutos      = NEW.ingresos_brutos,
    inicio_actividades   = NEW.inicio_actividades,
    umbral_factura_b     = NEW.umbral_factura_b,
    afip_produccion      = COALESCE(NEW.afip_produccion, false),
    afip_provider        = COALESCE(NEW.afip_provider, 'propio'),
    afipsdk_token        = NEW.afipsdk_token,
    banco                = NEW.banco,
    cbu                  = NEW.cbu,
    alias_cbu            = NEW.alias_cbu,
    leyenda_comprobante  = NEW.leyenda_comprobante,
    logo_url             = NEW.logo_url,
    updated_at           = now()
  WHERE tenant_id = NEW.id AND es_default;

  IF NOT FOUND THEN
    INSERT INTO emisores_fiscales (
      tenant_id, nombre, cuit, razon_social_fiscal, condicion_iva_emisor, domicilio_fiscal,
      ingresos_brutos, inicio_actividades, umbral_factura_b, afip_produccion, afip_provider,
      afipsdk_token, banco, cbu, alias_cbu, leyenda_comprobante, logo_url, es_default, activo
    ) VALUES (
      NEW.id, COALESCE(NEW.razon_social_fiscal, NEW.nombre, 'Emisor principal'), NEW.cuit,
      NEW.razon_social_fiscal, NEW.condicion_iva_emisor, NEW.domicilio_fiscal,
      NEW.ingresos_brutos, NEW.inicio_actividades, NEW.umbral_factura_b,
      COALESCE(NEW.afip_produccion, false), COALESCE(NEW.afip_provider, 'propio'),
      NEW.afipsdk_token, NEW.banco, NEW.cbu, NEW.alias_cbu, NEW.leyenda_comprobante,
      NEW.logo_url, true, true
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_emisor_fiscal_default ON tenants;
CREATE TRIGGER trg_sync_emisor_fiscal_default
  AFTER INSERT OR UPDATE OF cuit, razon_social_fiscal, condicion_iva_emisor, domicilio_fiscal,
    ingresos_brutos, inicio_actividades, umbral_factura_b, afip_produccion, afip_provider,
    afipsdk_token, banco, cbu, alias_cbu, leyenda_comprobante, logo_url
  ON tenants
  FOR EACH ROW EXECUTE FUNCTION fn_sync_emisor_fiscal_default();
