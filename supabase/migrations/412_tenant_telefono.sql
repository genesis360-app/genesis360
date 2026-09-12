-- 412 — El teléfono que pide el alta se guarda
--
-- ── El bug ───────────────────────────────────────────────────────────────────────────────────
-- El formulario de alta (`OnboardingPage`, paso "Tu negocio") pide **Teléfono (opcional)** y lo
-- guarda en el estado del componente… y ahí muere: `provisionNegocio()` inserta `nombre`,
-- `tipo_comercio`, `pais` y el consentimiento, pero nunca `telefono` — la columna ni siquiera
-- existía. El dato se le pide al usuario, se descarta, y nadie se entera.
--
-- Se nota recién del otro lado: en el panel de soporte no hay un solo teléfono para llamar a
-- nadie. Todo el contacto con el cliente depende del mail.
--
-- Nullable y sin formato impuesto: es opcional en el alta y los formatos varían por país (el alta
-- ofrece AR, CL, UY, MX, CO y PE). Validar acá rechazaría altas por un guion de más.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS telefono text;

COMMENT ON COLUMN public.tenants.telefono IS
  'Teléfono de contacto del negocio, cargado en el alta (opcional) o desde Configuración. '
  'Lo usa el equipo de soporte para llamar al cliente.';
