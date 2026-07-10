-- 264: Cache del Ticket de Acceso (TA) de WSAA para el circuito WSFE propio
-- (dual-provider AFIP, fase 3 — ver wiki/features/facturacion-afip.md).
--
-- El TA de WSAA dura ~12h y AFIP RECHAZA un nuevo LoginCms mientras exista un TA
-- vigente para el mismo certificado (coe.alreadyAuthenticated) → el TA DEBE
-- persistirse entre invocaciones de la Edge Function (las instancias son efímeras;
-- un cache en memoria provocaría fallas en la segunda emisión dentro de las 12h).
--
-- Clave por (cuit, service, environment) y NO por tenant: el TA es del certificado/CUIT
-- ante AFIP, no del tenant (si dos tenants compartieran CUIT, comparten TA; y deja
-- listo el terreno para multi-CUIT). Contiene credenciales (token+sign) → SOLO
-- service_role, sin policies: la lee/escribe únicamente la EF emitir-factura.

CREATE TABLE IF NOT EXISTS public.afip_wsaa_ta (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuit            BIGINT NOT NULL,
  service         TEXT NOT NULL DEFAULT 'wsfe',
  environment     TEXT NOT NULL CHECK (environment IN ('homologacion','produccion')),
  token           TEXT NOT NULL,
  sign            TEXT NOT NULL,
  expiration_time TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cuit, service, environment)
);

ALTER TABLE public.afip_wsaa_ta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.afip_wsaa_ta FROM PUBLIC;
REVOKE ALL ON public.afip_wsaa_ta FROM anon;
REVOKE ALL ON public.afip_wsaa_ta FROM authenticated;
GRANT ALL ON public.afip_wsaa_ta TO service_role;
