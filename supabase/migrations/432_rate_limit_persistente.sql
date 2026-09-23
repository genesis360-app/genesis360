-- 432 — Rate limiting persistente para las Edge Functions públicas
--
-- Hallazgo de la auditoría de seguridad del 2026-09-20 (severidad menor, quedó en el backlog):
-- `marketplace-api` (60 req/min por IP) y `data-api` (120 req/min por API key) llevaban la cuenta
-- en un `Map` en memoria del isolate de Deno. Eso NO limita nada real, por dos razones:
--
--   1) El contador se pierde en cada cold start. Un isolate ocioso se recicla en minutos, así que
--      basta con espaciar las ráfagas para no chocar nunca con el tope.
--   2) Supabase corre VARIOS isolates de la misma función en paralelo. Cada uno tiene su propio
--      `Map`, así que el límite efectivo es 60 × (cantidad de isolates), un número que no controlamos
--      ni conocemos.
--
-- El contador pasa a vivir en la base, que es el único lugar compartido por todos los isolates.
--
-- ⚠ Esta tabla NO tiene `tenant_id` a propósito: es infraestructura del borde, no dato de un negocio.
--   La identidad que limita es una IP o el hash de una API key, que existen antes de saber de qué
--   negocio se trata (y en `marketplace-api` el límite tiene que aplicar ANTES de mirar el tenant,
--   justamente para que enumerar tenants no sea gratis).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · La tabla de contadores
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_contadores (
  bucket          text        NOT NULL,   -- qué límite: 'marketplace-api', 'data-api', …
  identidad       text        NOT NULL,   -- IP del cliente, o hash de la API key
  ventana_inicio  timestamptz NOT NULL,   -- arranque de la ventana, alineado a múltiplos de p_ventana_seg
  contador        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, identidad, ventana_inicio)
);

COMMENT ON TABLE public.rate_limit_contadores IS
  'Contadores de rate limiting de las Edge Functions públicas (mig 432). Infraestructura, sin tenant_id. '
  'Se escribe SOLO desde fn_rate_limit_consumir; las ventanas viejas las borra el cron cleanup_rate_limit_contadores.';

-- Para el borrado por ventana vieja: sin esto el cleanup hace seq scan de toda la tabla cada hora.
CREATE INDEX IF NOT EXISTS idx_rate_limit_contadores_ventana
  ON public.rate_limit_contadores (ventana_inicio);

-- Nadie llega a esta tabla desde el navegador. RLS sin policies = denegado para anon y authenticated;
-- el REVOKE es además del RLS porque revocar de PUBLIC no alcanza para anon (rol propio de Supabase).
ALTER TABLE public.rate_limit_contadores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_contadores FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Consumir una unidad del cubo, atómicamente
--
--     El `INSERT … ON CONFLICT DO UPDATE … RETURNING` toma el lock de la fila y devuelve el valor
--     ya incrementado en UNA sola ida y vuelta: dos isolates que entran a la vez no pueden leer el
--     mismo contador y pisarse (que es lo que pasaría con un SELECT + UPDATE separados).
--
--     Ventana FIJA, no deslizante — mismo criterio que tenía el Map en memoria. En el peor caso
--     admite 2×límite a caballo de dos ventanas; para frenar scraping y fuerza bruta alcanza, y una
--     ventana deslizante costaría una fila por request.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_rate_limit_consumir(
  p_bucket      text,
  p_identidad   text,
  p_limite      integer,
  p_ventana_seg integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ventana   timestamptz;
  v_identidad text;
  v_contador  integer;
BEGIN
  IF p_bucket IS NULL OR p_bucket = '' THEN
    RAISE EXCEPTION 'bucket requerido.';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 THEN
    RAISE EXCEPTION 'limite inválido: %', p_limite;
  END IF;
  -- Tope de 1 hora, atado al margen del cron de limpieza (punto 3): si se permitieran ventanas más
  -- largas, el cleanup borraría el contador de una ventana TODAVÍA ABIERTA y el límite se
  -- reiniciaría solo, en silencio. Esto es rate limiting de borde, no cuotas diarias.
  IF p_ventana_seg IS NULL OR p_ventana_seg < 1 OR p_ventana_seg > 3600 THEN
    RAISE EXCEPTION 'ventana inválida: % segundos (máximo 3600)', p_ventana_seg;
  END IF;

  -- La identidad viene de un header: se recorta para que nadie infle la fila mandando 8 KB de
  -- x-forwarded-for, y un NULL cae en un cubo común en vez de saltearse el límite.
  v_identidad := left(coalesce(nullif(p_identidad, ''), 'desconocido'), 200);

  -- Alineada a múltiplos de la ventana: todos los isolates calculan el mismo arranque.
  v_ventana := to_timestamp(floor(extract(epoch FROM now()) / p_ventana_seg) * p_ventana_seg);

  INSERT INTO public.rate_limit_contadores AS r (bucket, identidad, ventana_inicio, contador)
  VALUES (p_bucket, v_identidad, v_ventana, 1)
  ON CONFLICT (bucket, identidad, ventana_inicio)
  DO UPDATE SET contador = r.contador + 1
  RETURNING r.contador INTO v_contador;

  RETURN jsonb_build_object(
    'permitido',       v_contador <= p_limite,
    'contador',        v_contador,
    'limite',          p_limite,
    'reinicia_en',     v_ventana + make_interval(secs => p_ventana_seg),
    'retry_after_seg', GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_ventana + make_interval(secs => p_ventana_seg)) - now()))::integer
    )
  );
END;
$$;

-- Solo la llaman las Edge Functions, que van con service_role. Desde el navegador no se puede tocar:
-- si `authenticated` pudiera ejecutarla, cualquiera podría quemarle el cupo a otro mandando su IP.
REVOKE ALL ON FUNCTION public.fn_rate_limit_consumir(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rate_limit_consumir(text, text, integer, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Limpieza de ventanas vencidas
--
--     Sin esto la tabla crece sin techo: una IP distinta por request deja una fila por request.
--
--     🛑 El margen se compara contra `ventana_inicio`, que es cuando la ventana ABRIÓ, no cuando
--     cerró. Por eso tiene que ser MAYOR que la ventana más larga que la función acepta (1 hora):
--     con 2 horas, cualquier fila que se borra pertenece a una ventana cerrada hace al menos una.
--     Si alguna vez se sube el tope de `p_ventana_seg`, hay que subir este margen en el mismo
--     commit — si no, el cleanup borra contadores de ventanas abiertas y el límite se reinicia solo.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'cleanup_rate_limit_contadores',
  '17 * * * *',
  $$ DELETE FROM public.rate_limit_contadores WHERE ventana_inicio < NOW() - INTERVAL '2 hours' $$
);
