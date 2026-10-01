-- 446 — Cache de consultas al padrón de ARCA (autocompletar por CUIT)
--
-- La EF `consultar-cuit` consulta `ws_sr_constancia_inscripcion` (getPersona_v2) con el certificado de
-- PLATAFORMA de Genesis360 (no el del negocio) para traer razón social, condición IVA y domicilio fiscal al
-- cargar un CUIT en clientes, proveedores, emisor fiscal y alta rápida del POS.
--
-- El dato es público y el mismo para todos los negocios → la clave es (cuit, environment), sin tenant_id. El
-- cache ahorra viajes a ARCA cuando varios negocios cargan el mismo CUIT o se reabre la ficha; la EF decide la
-- vigencia (`consultado_at`). Nada se escribe solo en la ficha: el usuario acepta la vista previa.
--
-- Solo service_role (la EF). RLS sin policies + REVOKE explícito a anon/authenticated.

CREATE TABLE IF NOT EXISTS public.padron_arca_cache (
  cuit          text        NOT NULL CHECK (cuit ~ '^\d{11}$'),
  environment   text        NOT NULL CHECK (environment IN ('homologacion', 'produccion')),
  resultado     jsonb       NOT NULL,
  consultado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cuit, environment)
);

COMMENT ON TABLE public.padron_arca_cache IS
  'Respuestas del padrón de ARCA (getPersona_v2) ya parseadas. Lo escribe y lee solo la EF consultar-cuit.';

ALTER TABLE public.padron_arca_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.padron_arca_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.padron_arca_cache TO service_role;
