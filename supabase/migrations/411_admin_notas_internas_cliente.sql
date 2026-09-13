-- 411 — Notas internas del equipo sobre un cliente
--
-- ── Por qué ──────────────────────────────────────────────────────────────────────────────────
-- En el panel de soporte no hay dónde anotar nada sobre un cliente. Lo que se conversa ("llamó,
-- dice que no le anda la impresora fiscal", "pidió que lo llamemos el lunes", "se queja del
-- precio") vive en la cabeza del que atendió y se pierde cuando atiende otro. Los tickets no
-- sirven para eso: un ticket es un problema con estado y ciclo de vida, una nota es contexto.
--
-- ── Sin FK a `tenants`, a propósito ──────────────────────────────────────────────────────────
-- Mismo criterio que `admin_audit_log` (mig 221): la nota tiene que SOBREVIVIR al borrado del
-- negocio. Justamente la nota más valiosa es la que explica POR QUÉ se fue un cliente, y con un
-- `ON DELETE CASCADE` se borraría en el mismo momento en que pasa a ser útil.
--
-- ── 🛑 Quién la ve ───────────────────────────────────────────────────────────────────────────
-- NADIE del lado del cliente. La tabla vive en `public` (PostgREST la expone), así que se enciende
-- RLS y NO se crea ninguna policy: sin policy, `anon` y `authenticated` no leen ni escriben nada.
-- La EF `admin-api` entra con `service_role`, que bypassa RLS, y ya valida agente + rol + audita.
-- Es el mismo patrón exacto de `admin_audit_log`.
--
-- Vale subrayarlo porque acá el riesgo es concreto: son notas INTERNAS sobre el cliente, escritas
-- sin filtro. Que un cliente pudiera leer lo que el equipo anotó sobre él sería mucho peor que una
-- filtración de datos técnicos.

CREATE TABLE IF NOT EXISTS public.admin_customer_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sin FK: ver arriba. Se guarda además el nombre del negocio al momento de escribir la nota,
  -- para que siga siendo legible cuando el tenant ya no exista.
  tenant_id    uuid NOT NULL,
  tenant_nombre text,
  agent_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_email  text,
  cuerpo       text NOT NULL CHECK (btrim(cuerpo) <> ''),
  -- Para separar "recordatorio" de "dato duro" sin inventar un flujo con estados.
  fijada       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notes_tenant ON public.admin_customer_notes(tenant_id, created_at DESC);

ALTER TABLE public.admin_customer_notes ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito: solo `service_role` (que bypassa RLS) puede leer y escribir.

-- Cinturón además de los tirantes: aunque alguien agregue una policy por error más adelante,
-- sin privilegio de tabla `anon`/`authenticated` siguen sin poder tocarla.
REVOKE ALL ON TABLE public.admin_customer_notes FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_customer_notes TO service_role;

COMMENT ON TABLE public.admin_customer_notes IS
  'Panel de soporte: notas internas del equipo sobre un cliente. Invisibles para el cliente '
  '(RLS sin policies + sin GRANT a anon/authenticated). Sin FK a tenants: sobreviven a la baja.';

-- ── Hardening de `admin_audit_log` (hallazgo al revisar esta migración) ──────────────────────
-- La mig 221 creó el log de auditoría confiando SOLO en "RLS habilitada + cero policies". Eso
-- funciona —Postgres deniega por defecto— pero deja el GRANT de tabla completo vivo para `anon` y
-- `authenticated`: el día que alguien agregue una policy permisiva sin querer, o apague RLS "para
-- probar algo", la exposición es inmediata y total, sin ningún privilegio que haga falta agregar.
-- Se le aplica el mismo cinturón que a la tabla nueva. No cambia nada del funcionamiento actual:
-- la EF entra con `service_role`, que conserva todos los privilegios.
REVOKE ALL ON TABLE public.admin_audit_log FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;
