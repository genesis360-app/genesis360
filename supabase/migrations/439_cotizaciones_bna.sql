-- 439 — Historial diario de la cotización DIVISA del Banco Nación (D-1, fase 1)
--
-- Decidido por GO el 2026-09-25: el POS convierte USD→ARS al tipo de cambio VENDEDOR DIVISA del BNA
-- del DÍA HÁBIL ANTERIOR, y esa es la UNA sola tasa de todo el sistema (reemplaza la regla "USD→ARS a
-- compra" de v1.207.0). Es la misma tasa que exige la RG ARCA 5616/2024 para los comprobantes en
-- moneda extranjera, así que el precio del POS y el de la factura en dólares coinciden.
--
-- Esta fase SOLO junta el dato (sin cambio visible): un registro por día y por moneda, capturado de la
-- tabla pública de divisas de bna.com.ar por la EF `cotizacion-bna`. dolarapi no sirve: da el valor de
-- hoy, sin histórico, y su "oficial" es el BNA BILLETE, no DIVISA.
--
-- · `fecha` es la que publica el BNA en la tabla (el día de esa cotización), NO el día de captura.
--   A la madrugada la página todavía muestra el cierre del día anterior con SU fecha, que es lo que
--   se necesita.
-- · Tabla global (no por negocio): es un dato público. Lectura para `authenticated`; escritura solo
--   service_role (la EF).
-- · `fn_cotizacion_bna_vigente` = la del día hábil anterior: la última fecha ESTRICTAMENTE anterior a
--   hoy en Argentina. Fines de semana y feriados salen solos (el BNA no publica). Devuelve la fecha
--   para que la app la muestre: si la captura falló, se ve que es vieja (A-2: se sigue con la anterior
--   y se avisa; nunca se inventa una tasa).

CREATE TABLE IF NOT EXISTS public.cotizaciones_bna (
  fecha         date          NOT NULL,
  moneda        text          NOT NULL CHECK (moneda ~ '^[A-Z]{3}$'),
  compra        numeric(14,4) NOT NULL CHECK (compra > 0),
  venta         numeric(14,4) NOT NULL CHECK (venta > 0),
  fuente        text          NOT NULL DEFAULT 'bna.com.ar/Personas#divisas',
  capturada_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, moneda)
);

COMMENT ON TABLE public.cotizaciones_bna IS
  'Cotización DIVISA del Banco Nación, un registro por día publicado. La tasa vigente de un día es la del día hábil anterior (RG ARCA 5616/2024). Mig 439.';

ALTER TABLE public.cotizaciones_bna ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cotizaciones_bna' AND policyname = 'cotizaciones_bna_select') THEN
    CREATE POLICY cotizaciones_bna_select ON public.cotizaciones_bna FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

REVOKE ALL ON public.cotizaciones_bna FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cotizaciones_bna TO authenticated;
GRANT ALL ON public.cotizaciones_bna TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cotizacion_bna_vigente(p_moneda text DEFAULT 'USD')
RETURNS TABLE (fecha date, compra numeric, venta numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.fecha, c.compra, c.venta
  FROM cotizaciones_bna c
  WHERE c.moneda = p_moneda
    AND c.fecha < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  ORDER BY c.fecha DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.fn_cotizacion_bna_vigente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cotizacion_bna_vigente(text) TO authenticated, service_role;
