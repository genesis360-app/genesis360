-- 483 · El rate limit acepta ventanas de hasta 1 día (los topes diarios no se estaban aplicando)
--
-- Bug: `consultar-cuit` (500/día por negocio, 5000/día de la plataforma) y `categoria-cartel-ia`
-- (200/día por negocio) llaman a `fn_rate_limit_consumir` con ventana de 86 400 s, pero la función
-- rechazaba todo lo que pasara de 3600 s. La excepción llegaba al helper `consumirRateLimit`, que
-- por diseño deja pasar si la base falla (fail-open) → los topes DIARIOS nunca se aplicaron;
-- solo funcionaba el tope por minuto de cada usuario. Visto en los logs del gateway de PROD
-- (400 en /rpc/fn_rate_limit_consumir de a pares, uno por cada tope diario).
--
-- Arreglo: tope de la ventana en 86 400 s, y el margen del cron de limpieza sube EN LA MISMA
-- migración a 2 días (regla de la 432: el margen tiene que ser mayor que la ventana más larga,
-- si no el cleanup borra contadores de ventanas abiertas y el límite se reinicia solo).
-- Las filas son pocas (una por bucket/identidad/ventana), así que guardar 2 días no pesa.

CREATE OR REPLACE FUNCTION public.fn_rate_limit_consumir(p_bucket text, p_identidad text, p_limite integer, p_ventana_seg integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Tope de 1 día, atado al margen del cron de limpieza (2 días, mig 483): si se permitieran
  -- ventanas más largas, el cleanup borraría el contador de una ventana TODAVÍA ABIERTA y el
  -- límite se reiniciaría solo, en silencio.
  IF p_ventana_seg IS NULL OR p_ventana_seg < 1 OR p_ventana_seg > 86400 THEN
    RAISE EXCEPTION 'ventana inválida: % segundos (máximo 86400)', p_ventana_seg;
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
$function$;

-- Mismo nombre de job → pg_cron lo actualiza en lugar de crear otro.
SELECT cron.schedule(
  'cleanup_rate_limit_contadores',
  '17 * * * *',
  $$ DELETE FROM public.rate_limit_contadores WHERE ventana_inicio < NOW() - INTERVAL '2 days' $$
);
