-- 271: Identidad fiscal — CUTOVER a FUENTE ÚNICA DE VERDAD (emisores_fiscales). REGLA #0.
--
-- Contexto (pedido GO 2026-07-16, "resolver de raíz"): la identidad fiscal del negocio vivía
-- DUPLICADA en `tenants.*` y en la fila `es_default` de `emisores_fiscales`, sincronizada por un
-- trigger TRANSICIONAL tenants→emisores (mig 267, que decía textualmente "se elimina en el
-- cutover de Fase 3"). Esta migración ES ese cutover. La duplicación ya causó un bug fiscal real:
-- los PDFs leían el lado equivocado (tenants) → CUIT vacío un mes en PROD (v1.62.0→v1.131.0) y,
-- con multi-CUIT, un papel que no coincide con AFIP.
--
-- Diseño post-cutover:
--   · `emisores_fiscales` = LA fuente de verdad de toda identidad fiscal (default y adicionales).
--   · `tenants.*` fiscal queda como ESPEJO DE SOLO-LECTURA para los lectores legacy, mantenido
--     por un trigger emisores(default)→tenants (dirección INVERTIDA respecto de mig 267).
--     Las columnas se dropean en la fase final (criterios: grep lectores = 0 + drift 0 + soak).
--   · La app escribe SIEMPRE en emisores_fiscales (ConfigPage cutover en v1.133.0, mismo release).
--
-- Verificado ANTES de esta mig (2026-07-16, por query): backfill pendiente = 0 en DEV y 0 en PROD
-- (todo tenant con CUIT ya tiene su fila default). El backfill de abajo queda por idempotencia.
--
-- ⚠ Sin loops: el trigger viejo tenants→emisores se DROPEA acá mismo, antes de crear el inverso.

-- ── 1. DROP del espejo viejo (tenants → emisores), primero para que no haya loop ──────────
DROP TRIGGER IF EXISTS trg_sync_emisor_fiscal_default ON tenants;
DROP FUNCTION IF EXISTS fn_sync_emisor_fiscal_default();

-- ── 2. Backfill idempotente (hoy 0 filas; seguridad ante tenants creados entre chequeo y mig) ──
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
  AND NOT EXISTS (SELECT 1 FROM emisores_fiscales e WHERE e.tenant_id = t.id AND e.es_default)
ON CONFLICT (tenant_id, cuit) DO NOTHING;

-- ── 3. Guards: el emisor DEFAULT es la identidad fiscal del negocio — no se borra ni apaga ──
-- El DELETE del default solo se permite dentro del CASCADE de borrar el tenant completo
-- (en el cascade la fila de tenants ya no existe cuando se borran los hijos; en un DELETE
-- directo el tenant sigue existiendo → se bloquea).
CREATE OR REPLACE FUNCTION fn_guard_emisor_default()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.es_default AND EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
      RAISE EXCEPTION 'El emisor fiscal principal no se puede eliminar: es la identidad fiscal del negocio. Corregí sus datos en su lugar.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.es_default AND NOT NEW.es_default THEN
    RAISE EXCEPTION 'No se puede quitar la marca de principal al emisor default. Cambiar el emisor principal requiere una operación explícita (no implementada).'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.es_default AND NOT NEW.activo THEN
    RAISE EXCEPTION 'El emisor fiscal principal no se puede desactivar.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_emisor_default ON emisores_fiscales;
CREATE TRIGGER trg_guard_emisor_default
  BEFORE UPDATE OR DELETE ON emisores_fiscales
  FOR EACH ROW EXECUTE FUNCTION fn_guard_emisor_default();

-- ── 4. Espejo INVERTIDO: emisores_fiscales(default) → tenants (solo-lectura legacy) ────────
-- SECURITY DEFINER: mismo motivo que mig 267 (el RLS del contexto llamador no debe frenar el
-- espejo). El WHERE con IS DISTINCT FROM evita updates no-op sobre tenants en cada save.
CREATE OR REPLACE FUNCTION fn_espejo_emisor_default_a_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.es_default THEN
    RETURN NEW;  -- los emisores adicionales no espejan a tenants
  END IF;

  UPDATE tenants t SET
    cuit                 = NEW.cuit,
    razon_social_fiscal  = NEW.razon_social_fiscal,
    condicion_iva_emisor = NEW.condicion_iva_emisor,
    domicilio_fiscal     = NEW.domicilio_fiscal,
    ingresos_brutos      = NEW.ingresos_brutos,
    inicio_actividades   = NEW.inicio_actividades,
    umbral_factura_b     = NEW.umbral_factura_b,
    afip_produccion      = NEW.afip_produccion,
    afip_provider        = NEW.afip_provider,
    afipsdk_token        = NEW.afipsdk_token,
    banco                = NEW.banco,
    cbu                  = NEW.cbu,
    alias_cbu            = NEW.alias_cbu,
    leyenda_comprobante  = NEW.leyenda_comprobante,
    logo_url             = NEW.logo_url
  WHERE t.id = NEW.tenant_id
    AND (t.cuit, t.razon_social_fiscal, t.condicion_iva_emisor, t.domicilio_fiscal,
         t.ingresos_brutos, t.inicio_actividades, t.umbral_factura_b, t.afip_produccion,
         t.afip_provider, t.afipsdk_token, t.banco, t.cbu, t.alias_cbu,
         t.leyenda_comprobante, t.logo_url)
        IS DISTINCT FROM
        (NEW.cuit, NEW.razon_social_fiscal, NEW.condicion_iva_emisor, NEW.domicilio_fiscal,
         NEW.ingresos_brutos, NEW.inicio_actividades, NEW.umbral_factura_b, NEW.afip_produccion,
         NEW.afip_provider, NEW.afipsdk_token, NEW.banco, NEW.cbu, NEW.alias_cbu,
         NEW.leyenda_comprobante, NEW.logo_url);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_espejo_emisor_default_a_tenant ON emisores_fiscales;
CREATE TRIGGER trg_espejo_emisor_default_a_tenant
  AFTER INSERT OR UPDATE ON emisores_fiscales
  FOR EACH ROW EXECUTE FUNCTION fn_espejo_emisor_default_a_tenant();

COMMENT ON TABLE emisores_fiscales IS
  'FUENTE ÚNICA de las identidades fiscales del tenant (multi-CUIT, F5; cutover mig 271). El default se espeja a tenants.* (solo-lectura legacy) vía trg_espejo_emisor_default_a_tenant hasta el drop final de esas columnas. Ver wiki/features/multi-cuit.md';

-- ── Auditoría de drift (correr periódicamente en DEV y PROD; debe dar 0 filas) ─────────────
-- SELECT t.id, t.nombre FROM tenants t
-- JOIN emisores_fiscales e ON e.tenant_id = t.id AND e.es_default
-- WHERE (t.cuit, t.razon_social_fiscal, t.condicion_iva_emisor, t.domicilio_fiscal,
--        t.ingresos_brutos, t.inicio_actividades, t.umbral_factura_b, t.afip_produccion,
--        t.afip_provider, t.afipsdk_token, t.banco, t.cbu, t.alias_cbu,
--        t.leyenda_comprobante, t.logo_url)
--       IS DISTINCT FROM
--       (e.cuit, e.razon_social_fiscal, e.condicion_iva_emisor, e.domicilio_fiscal,
--        e.ingresos_brutos, e.inicio_actividades, e.umbral_factura_b, e.afip_produccion,
--        e.afip_provider, e.afipsdk_token, e.banco, e.cbu, e.alias_cbu,
--        e.leyenda_comprobante, e.logo_url);
