-- 435 — Una caja no puede tener DOS sesiones abiertas a la vez
--
-- 🛑 REGLA #0 (caja). El agujero, encontrado el 2026-09-24 persiguiendo una falla de test que estaba
-- archivada como "flakiness": el guard de "Abrir caja" vivía SOLO en el cliente
-- (`CajaPage.tsx`) y además estaba incompleto:
--
--   · Solo bloqueaba si la sesión abierta era de OTRO usuario. El mismo usuario abriendo dos veces
--     no se frenaba: insertaba una segunda sesión.
--   · Usaba `.maybeSingle()`, que FALLA cuando ya hay 2 o más abiertas → el guard no encontraba
--     nada → dejaba abrir una tercera. El problema se agravaba solo.
--   · No había ninguna restricción en la base.
--
-- Por qué importa: los movimientos se cuelgan de una sesión, y la app lee la MÁS RECIENTE
-- (`order('abierta_at', desc).limit(1)`). Con dos abiertas, la plata entra por una mientras el
-- arqueo se cierra sobre la otra.
--
-- Y no era teórico. Medido antes de escribir esto:
--   · PROD: un negocio con 6 sesiones abiertas a la vez en su Caja Fuerte, creadas entre las 05:30
--     y las 05:34 del 2026-06-20 — alguien apretando el botón. Las 6 vacías (apertura 0, 0 movs).
--   · DEV: Caja1 con 2 abiertas, y esta vez CON plata en las dos: la #54 venía usándose hacía un
--     mes (189 movimientos) y una corrida abrió la #56, que se llevó los 17 movimientos
--     siguientes. Se saneó a mano antes de esta migración (cierre con su saldo real, sin mover
--     ningún movimiento de lugar).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Saneamiento de los duplicados que YA existen
--
--     Solo se cierran los duplicados VACÍOS: apertura en cero y sin un solo movimiento. Un
--     duplicado con plata adentro no se toca ni se decide por código — si existiera, el índice de
--     abajo falla a propósito y obliga a resolverlo a mano (que es lo que se hizo en DEV).
--     De cada caja se conserva la sesión que la app está usando hoy: la más reciente.
-- ─────────────────────────────────────────────────────────────────────────────
WITH duplicadas AS (
  SELECT cs.id,
         row_number() OVER (PARTITION BY cs.caja_id ORDER BY cs.abierta_at DESC) AS puesto,
         cs.monto_apertura,
         EXISTS (SELECT 1 FROM public.caja_movimientos m WHERE m.sesion_id = cs.id) AS tiene_movs
    FROM public.caja_sesiones cs
   WHERE cs.estado = 'abierta'
     AND cs.caja_id IN (
       SELECT caja_id FROM public.caja_sesiones WHERE estado = 'abierta'
        GROUP BY caja_id HAVING count(*) > 1
     )
)
UPDATE public.caja_sesiones cs
   SET estado = 'cerrada',
       cerrada_at = now(),
       monto_cierre = 0,
       monto_real_cierre = 0,
       diferencia_cierre = 0,
       notas_cierre = 'Cierre de saneamiento (mig 435): sesion abierta por duplicado sobre una caja que ya tenia otra abierta. Estaba vacia (apertura 0, sin movimientos), asi que no habia plata que arquear.'
  FROM duplicadas d
 WHERE cs.id = d.id
   AND d.puesto > 1                    -- la más reciente se queda abierta
   AND d.monto_apertura = 0
   AND NOT d.tiene_movs;               -- 🛑 con plata adentro, NO se toca

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · El candado de verdad
--
--     El índice único parcial es lo ÚNICO que cierra la carrera: dos clicks simultáneos pasan los
--     dos por cualquier chequeo previo, pero solo uno puede insertar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS caja_sesiones_una_abierta_por_caja
  ON public.caja_sesiones (caja_id) WHERE estado = 'abierta';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Y un mensaje que se entienda
--
--     El índice solo tira "duplicate key value violates unique constraint", que al cajero no le
--     dice nada. Este trigger atrapa el caso normal (no la carrera, para eso está el índice) y
--     explica qué pasó.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_una_sesion_abierta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quien text;
BEGIN
  IF NEW.estado <> 'abierta' THEN RETURN NEW; END IF;

  SELECT coalesce(u.nombre_display, 'otro usuario') INTO v_quien
    FROM caja_sesiones cs
    LEFT JOIN users u ON u.id = cs.usuario_id
   WHERE cs.caja_id = NEW.caja_id
     AND cs.estado = 'abierta'
     AND cs.id <> NEW.id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Esa caja ya tiene una sesión abierta (la abrió %). Cerrala antes de abrir otra.', v_quien
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_una_sesion_abierta ON public.caja_sesiones;
CREATE TRIGGER trg_guard_una_sesion_abierta
  BEFORE INSERT OR UPDATE OF estado ON public.caja_sesiones
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_una_sesion_abierta();

REVOKE ALL ON FUNCTION public.fn_guard_una_sesion_abierta() FROM PUBLIC, anon, authenticated;
