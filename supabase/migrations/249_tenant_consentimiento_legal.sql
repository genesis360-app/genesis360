-- Migration 249 — Consentimiento legal en el alta (T&C/Privacidad + marketing opt-in).
-- Hasta ahora el registro NO capturaba aceptación de Términos y Condiciones / Política de
-- Privacidad ni consentimiento de marketing. Se agregan 3 columnas al tenant que se setean
-- en `provisionNegocio` (OnboardingPage) al crear el negocio:
--   • terminos_aceptados_at → timestamp de aceptación de T&C + Privacidad (NULL = alta previa
--     a esta feature; el T&C es requerido para altas nuevas, gateado en el frontend).
--   • terminos_version      → versión del texto legal aceptado (BRAND LEGAL_VERSION), para
--     trazabilidad si el texto cambia y hay que re-pedir aceptación.
--   • marketing_consent     → opt-in SEPARADO y OPCIONAL (Ley 25.326 AR: consentimiento libre,
--     informado y revocable). Default FALSE = sin consentimiento salvo tilde explícita.
-- Aditiva e idempotente. NO reescribe tenants existentes (quedan con NULL/FALSE, correcto:
-- no consintieron algo que no se les mostró).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS terminos_aceptados_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminos_version      TEXT,
  ADD COLUMN IF NOT EXISTS marketing_consent     BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tenants.terminos_aceptados_at IS 'Fecha/hora de aceptación de T&C + Política de Privacidad en el alta (mig 249).';
COMMENT ON COLUMN public.tenants.terminos_version      IS 'Versión del texto legal aceptado (BRAND.LEGAL_VERSION) al momento del alta (mig 249).';
COMMENT ON COLUMN public.tenants.marketing_consent     IS 'Opt-in de marketing, separado y opcional (Ley 25.326). Default FALSE (mig 249).';
