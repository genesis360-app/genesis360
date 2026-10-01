-- 441 — Precio programado, C-1: el precio cambia cuando llegó la hora Y el repositor confirmó la etiqueta
--
-- Respuesta de GO (2026-09-25, C-1 de `respuestas_puntos_abiertos_2026-09-25.md`): "el precio cambia cuando llegó
-- la hora y el repositor confirmó. Sin tope de espera; aviso cuando pasan más de X horas". Es OPCIONAL por negocio
-- (relevamiento de Fede, C1): apagado = como hasta hoy, el precio rige a la hora exacta.
--
-- Con el modo prendido (y solo en modo avanzado, que es donde existen las etiquetas):
--  · El cron NO aplica un programado mientras quede abierta alguna tarea de etiqueta ligada a él (una por sucursal
--    con góndola). Sin góndola no hay etiqueta que esperar: se aplica a la hora, como siempre.
--  · La etiqueta se puede confirmar recién cuando llegó la hora (antes, la góndola mostraría un precio que todavía
--    no se cobra). Al confirmarse la ÚLTIMA, el precio se aplica EN EL ACTO — no al minuto siguiente — para que
--    góndola y caja no difieran.
--  · Si pasan más de `precio_programado_aviso_demora_horas` desde la hora sin que se confirme, se avisa UNA vez a
--    DUEÑO y SUPER_USUARIO.
--  · Las tareas se crean aunque la hora ya haya pasado (con anticipación "a la hora del cambio" no existía ninguna
--    ventana previa y no habría nada que confirmar).
--
-- Mecánica:
--  · El cuerpo de "aplicar un programado" pasa a `fn_aplicar_precio_programado(p_id)`, que usan el cron y el
--    trigger de confirmación. Mismo comportamiento que antes (mismo UPDATE, mismo log, misma rama de error).
--  · 🛑 Cuando la aplicación la dispara la confirmación del repositor, corre con SU sesión y `fn_productos_rol_guard`
--    la rechazaría (el repositor no puede cambiar precios). La función marca la operación con la GUC local
--    `g360.pp_aplicando = <id>` y el guard deja pasar SOLO si: hay un programado pendiente con ese id, de ese
--    producto, con exactamente ese precio, y no cambia ninguna otra columna de precio. Es decir: a lo sumo aplica
--    un precio que alguien con permiso ya programó. PostgREST no expone `set_config`.
--  · Con la misma GUC, `fn_generar_tarea_repositor_precio` no le vuelve a pedir la etiqueta a una sucursal que ya
--    la confirmó para este programado (si no, el repositor tendría que ponerla dos veces).
--
-- Definiciones de partida leídas de DEV y verificadas idénticas en PROD (2026-09-26).

-- ── Configuración y estado ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS precio_programado_requiere_repositor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS precio_programado_aviso_demora_horas integer NOT NULL DEFAULT 2;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_pp_aviso_demora_horas_chk') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_pp_aviso_demora_horas_chk
      CHECK (precio_programado_aviso_demora_horas BETWEEN 1 AND 168);
  END IF;
END $$;

-- `tenants` tiene UPDATE por columna para `authenticated`: las columnas nuevas no lo heredan.
GRANT UPDATE (precio_programado_requiere_repositor, precio_programado_aviso_demora_horas) ON public.tenants TO authenticated;

ALTER TABLE public.precios_programados
  ADD COLUMN IF NOT EXISTS aviso_demora_at timestamptz;

COMMENT ON COLUMN public.tenants.precio_programado_requiere_repositor IS
  'C-1 (mig 441): el precio programado rige cuando llegó la hora Y el repositor confirmó la etiqueta (modo avanzado). false = a la hora exacta.';
COMMENT ON COLUMN public.precios_programados.aviso_demora_at IS
  'C-1 (mig 441): cuándo se avisó que la etiqueta lleva más de X horas sin confirmarse. Se avisa una sola vez.';

-- ── Aplicar UN programado (cuerpo que antes vivía dentro del loop del cron) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_aplicar_precio_programado(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r        RECORD;
  v_error  text;
BEGIN
  SELECT pp.id, pp.tenant_id, pp.producto_id, pp.precio_venta, pp.creado_por, pp.vigente_desde,
         p.precio_venta AS precio_actual, p.nombre AS producto_nombre
    INTO r
    FROM public.precios_programados pp
    JOIN public.productos p ON p.id = pp.producto_id
   WHERE pp.id = p_id AND pp.estado = 'pendiente' AND pp.vigente_desde <= now()
     FOR UPDATE OF pp SKIP LOCKED;
  IF NOT FOUND THEN RETURN false; END IF;

  BEGIN
    -- Mig 441: marca de "esto lo aplica el programado" para el guard de productos y el trigger de etiquetas.
    PERFORM set_config('g360.pp_aplicando', r.id::text, true);
    -- El mismo UPDATE que un cambio manual: dispara la tarea del repositor y la publicación en ML/TN.
    UPDATE public.productos SET precio_venta = r.precio_venta WHERE id = r.producto_id;
    PERFORM set_config('g360.pp_aplicando', '', true);

    UPDATE public.precios_programados
       SET estado = 'aplicado', aplicado_at = now(), precio_anterior = r.precio_actual, error = NULL
     WHERE id = r.id;

    -- Mig 423 (C3): la etiqueta sin hacer de este producto queda ligada al programado. Si sigue sin hacerse
    -- pasada la hora, es una "etiqueta vencida".
    UPDATE public.tareas_repositor
       SET precio_programado_id = r.id, vigente_desde = r.vigente_desde
     WHERE producto_id = r.producto_id
       AND tipo = 'cambio_precio'
       AND estado IN ('pendiente', 'en_curso')
       AND precio_programado_id IS DISTINCT FROM r.id;

    INSERT INTO public.actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id, entidad_nombre,
                                      accion, campo, valor_anterior, valor_nuevo, pagina, producto_id)
    VALUES (r.tenant_id, r.creado_por, 'Cambio de precio programado', 'producto', r.producto_id::text,
            r.producto_nombre, 'editar', 'precio de venta (programado)', r.precio_actual::text,
            r.precio_venta::text, '/productos', r.producto_id);

    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca en silencio: queda marcado y se avisa al dueño.
    v_error := SQLERRM;
    -- Mig 423 (migration-reviewer): con su propia subtransacción. Sin esto, un error acá (p. ej. al insertar el
    -- aviso) se escapaba y revertía los precios ya aplicados en este minuto.
    BEGIN
      UPDATE public.precios_programados SET estado = 'fallido', error = v_error WHERE id = r.id;
      INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      SELECT r.tenant_id, u.id, 'danger',
             'No se pudo aplicar un precio programado',
             r.producto_nombre || ': ' || v_error || '. El precio anterior sigue vigente.',
             '/productos?tab=programados'
        FROM public.users u
       WHERE u.tenant_id = r.tenant_id AND u.rol IN ('DUEÑO', 'SUPER_USUARIO');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[fn_aplicar_precio_programado] no se pudo marcar ni avisar el fallo del programado %: %', r.id, SQLERRM;
    END;
    -- Mig 423: la etiqueta anticipada de un precio que no se aplicó no se tiene que poner.
    BEGIN
      PERFORM public.fn_tareas_precio_programado_desarmar(r.id, 'No se pudo aplicar el precio programado');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[fn_aplicar_precio_programado] programado % fallido, no se pudo desarmar su tarea: %', r.id, SQLERRM;
    END;
    RETURN false;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_aplicar_precio_programado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_precio_programado(uuid) TO service_role;

-- ── Cron de cada minuto ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_aplicar_precios_programados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r        RECORD;
  d        RECORD;
  v_n      integer := 0;
BEGIN
  -- Mig 423 (C1/C2): primero las etiquetas que tienen que aparecer antes de la hora. Si falla, se aplica igual.
  BEGIN
    PERFORM public.fn_generar_tareas_precio_programado();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fn_aplicar_precios_programados] no se pudieron generar las tareas anticipadas: %', SQLERRM;
  END;

  -- Mig 441 (C-1): aviso, una sola vez, de la etiqueta que lleva más de X horas sin confirmarse.
  FOR d IN
    SELECT pp.id, pp.tenant_id, pp.vigente_desde, p.nombre AS producto_nombre, t.precio_programado_aviso_demora_horas AS horas
      FROM public.precios_programados pp
      JOIN public.productos p ON p.id = pp.producto_id
      JOIN public.tenants t ON t.id = pp.tenant_id
     WHERE pp.estado = 'pendiente'
       AND pp.aviso_demora_at IS NULL
       AND t.precio_programado_requiere_repositor
       AND t.modo_operacion = 'avanzado'
       AND pp.vigente_desde + make_interval(hours => t.precio_programado_aviso_demora_horas) <= now()
       AND EXISTS (SELECT 1 FROM public.tareas_repositor tr
                    WHERE tr.precio_programado_id = pp.id AND tr.estado IN ('pendiente', 'en_curso'))
  LOOP
    BEGIN
      INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      SELECT d.tenant_id, u.id, 'warning',
             'Un precio programado espera la etiqueta',
             d.producto_nombre || ': el precio nuevo tenía que regir desde el ' ||
               to_char(d.vigente_desde AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI') ||
               ' y sigue sin confirmarse la etiqueta (más de ' || d.horas || ' h). Hasta que se confirme, se cobra el precio anterior.',
             '/repositores'
        FROM public.users u
       WHERE u.tenant_id = d.tenant_id AND u.rol IN ('DUEÑO', 'SUPER_USUARIO');
      UPDATE public.precios_programados SET aviso_demora_at = now() WHERE id = d.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[fn_aplicar_precios_programados] no se pudo avisar la demora del programado %: %', d.id, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT pp.id
      FROM public.precios_programados pp
      JOIN public.tenants t ON t.id = pp.tenant_id
     WHERE pp.estado = 'pendiente' AND pp.vigente_desde <= now()
       -- Mig 441 (C-1): en modo "requiere repositor" espera a que no quede ninguna etiqueta ligada abierta.
       AND NOT (t.precio_programado_requiere_repositor AND t.modo_operacion = 'avanzado'
                AND EXISTS (SELECT 1 FROM public.tareas_repositor tr
                             WHERE tr.precio_programado_id = pp.id AND tr.estado IN ('pendiente', 'en_curso')))
     ORDER BY pp.vigente_desde
     LIMIT 500
  LOOP
    IF public.fn_aplicar_precio_programado(r.id) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ── Tareas anticipadas: en modo "requiere repositor" también después de la hora ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_generar_tareas_precio_programado()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r   RECORD;
  s   RECORD;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT pp.id, pp.tenant_id, pp.producto_id, pp.precio_venta, pp.vigente_desde,
           p.precio_venta AS precio_actual
      FROM public.precios_programados pp
      JOIN public.productos p ON p.id = pp.producto_id
      JOIN public.tenants t ON t.id = pp.tenant_id
     WHERE pp.estado = 'pendiente'
       AND t.modo_operacion = 'avanzado'
       -- Mig 441 (C-1): con "requiere repositor" la tarea tiene que existir aunque la hora ya haya pasado (con
       -- anticipación 0 no hay ventana previa), porque el precio la espera.
       AND (pp.vigente_desde > now() OR t.precio_programado_requiere_repositor)
       AND pp.vigente_desde - make_interval(mins => t.repositor_anticipacion_min) <= now()
       AND pp.precio_venta IS DISTINCT FROM p.precio_venta
  LOOP
    FOR s IN
      SELECT pus.sucursal_id
        FROM public.producto_ubicacion_sucursal pus
        JOIN public.ubicaciones u ON u.id = pus.ubicacion_exhibicion_id
       WHERE pus.producto_id = r.producto_id
         AND u.tipo_logico = 'exhibicion'
         -- Una sola vez por programado y sucursal: si alguien la canceló a mano, no se vuelve a crear.
         AND NOT EXISTS (SELECT 1 FROM public.tareas_repositor tr
                          WHERE tr.precio_programado_id = r.id AND tr.sucursal_id = pus.sucursal_id)
    LOOP
      BEGIN
        INSERT INTO public.tareas_repositor (tenant_id, sucursal_id, producto_id, tipo, precio_anterior, precio_nuevo,
                                             usuario_asignado_id, precio_programado_id, vigente_desde)
        VALUES (r.tenant_id, s.sucursal_id, r.producto_id, 'cambio_precio', r.precio_actual, r.precio_venta,
                public.fn_repositor_elegir_asignado(r.tenant_id, s.sucursal_id), r.id, r.vigente_desde)
        ON CONFLICT (producto_id, sucursal_id, tipo) WHERE estado IN ('pendiente', 'en_curso')
        -- Fusión con la tarea sin hacer: precio_anterior (lo que muestra la góndola) no se toca.
        DO UPDATE SET precio_nuevo         = EXCLUDED.precio_nuevo,
                      precio_programado_id = EXCLUDED.precio_programado_id,
                      vigente_desde        = EXCLUDED.vigente_desde;
        v_n := v_n + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Una etiqueta que no se pudo generar no frena al resto ni a la aplicación de precios.
        RAISE WARNING '[fn_generar_tareas_precio_programado] programado % sucursal %: %', r.id, s.sucursal_id, SQLERRM;
      END;
    END LOOP;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ── Guard de completar: en modo "requiere repositor", pasada la hora, confirmar ES la aprobación ─────────
CREATE OR REPLACE FUNCTION public.fn_tarea_repositor_guard_completar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pp_estado     text;
  v_precio_actual numeric;
  v_requiere      boolean;
BEGIN
  IF NEW.estado = 'completada' AND OLD.estado IN ('pendiente', 'en_curso') AND OLD.precio_programado_id IS NOT NULL THEN
    SELECT estado INTO v_pp_estado FROM public.precios_programados WHERE id = OLD.precio_programado_id;
    SELECT precio_venta INTO v_precio_actual FROM public.productos WHERE id = OLD.producto_id;
    -- Si el precio vigente ya es el de la etiqueta, se puede poner (lo aplicó el cron o alguien lo cambió a mano).
    IF v_precio_actual IS DISTINCT FROM OLD.precio_nuevo AND v_pp_estado IS DISTINCT FROM 'aplicado' THEN
      IF v_pp_estado = 'pendiente' THEN
        -- Mig 441 (C-1): con "requiere repositor", pasada la hora la confirmación es justamente lo que hace regir
        -- el precio (lo aplica `fn_tarea_repositor_aplicar_programado`, después de este UPDATE).
        SELECT (t.precio_programado_requiere_repositor AND t.modo_operacion = 'avanzado') INTO v_requiere
          FROM public.tenants t WHERE t.id = OLD.tenant_id;
        IF COALESCE(v_requiere, false) AND OLD.vigente_desde <= now() THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Todavía no: el precio nuevo rige desde el %. Si la etiqueta se pone antes, la góndola muestra un precio que el sistema todavía no cobra.',
          to_char(OLD.vigente_desde AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY "a las" HH24:MI')
          USING ERRCODE = 'check_violation';
      END IF;
      -- Fallido o cancelado sin que se haya podido desarmar la tarea (doble falla, migration-reviewer): esa etiqueta
      -- tiene un precio que nunca rigió.
      RAISE EXCEPTION 'Esta etiqueta es de un precio programado que no se aplicó (%). Cancelá la tarea: la góndola tiene que mostrar el precio vigente.',
        coalesce(v_pp_estado, 'sin datos')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Al confirmar la última etiqueta, el precio rige en el acto ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_tarea_repositor_aplicar_programado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_requiere boolean;
BEGIN
  IF NEW.estado = 'completada' AND OLD.estado IN ('pendiente', 'en_curso') AND NEW.precio_programado_id IS NOT NULL THEN
    SELECT (t.precio_programado_requiere_repositor AND t.modo_operacion = 'avanzado') INTO v_requiere
      FROM public.tenants t WHERE t.id = NEW.tenant_id;
    IF COALESCE(v_requiere, false)
       AND EXISTS (SELECT 1 FROM public.precios_programados pp
                    WHERE pp.id = NEW.precio_programado_id AND pp.estado = 'pendiente' AND pp.vigente_desde <= now())
       AND NOT EXISTS (SELECT 1 FROM public.tareas_repositor tr
                        WHERE tr.precio_programado_id = NEW.precio_programado_id AND tr.id <> NEW.id
                          AND tr.estado IN ('pendiente', 'en_curso')) THEN
      -- Nunca frena la confirmación: si no se puede aplicar, `fn_aplicar_precio_programado` lo marca fallido y avisa.
      BEGIN
        PERFORM public.fn_aplicar_precio_programado(NEW.precio_programado_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[fn_tarea_repositor_aplicar_programado] tarea % programado %: %', NEW.id, NEW.precio_programado_id, SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_tarea_repositor_aplicar_programado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tarea_repositor_aplicar_programado ON public.tareas_repositor;
CREATE TRIGGER trg_tarea_repositor_aplicar_programado
  AFTER UPDATE OF estado ON public.tareas_repositor
  FOR EACH ROW EXECUTE FUNCTION public.fn_tarea_repositor_aplicar_programado();

-- ── Guard de productos: deja pasar SOLO la aplicación de un programado ya autorizado ────────────────────
CREATE OR REPLACE FUNCTION public.fn_productos_rol_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pp text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.auth_puede_editar_modulo('inventario') THEN
      RAISE EXCEPTION 'No autorizado: tu rol no puede dar de alta productos.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.precio_venta       IS DISTINCT FROM OLD.precio_venta
  OR NEW.precio_costo       IS DISTINCT FROM OLD.precio_costo
  OR NEW.precio_marketplace IS DISTINCT FROM OLD.precio_marketplace
  OR NEW.precio_usd         IS DISTINCT FROM OLD.precio_usd
  OR NEW.precio_costo_usd   IS DISTINCT FROM OLD.precio_costo_usd
  OR NEW.margen_objetivo    IS DISTINCT FROM OLD.margen_objetivo THEN
    -- Mig 441 (C-1): la aplicación de un precio programado que dispara la confirmación del repositor corre con la
    -- sesión del repositor. Se deja pasar SOLO eso: programado pendiente de este producto, exactamente ese precio,
    -- y ninguna otra columna de precio tocada.
    v_pp := current_setting('g360.pp_aplicando', true);
    IF v_pp IS NOT NULL AND v_pp <> ''
       AND NEW.precio_costo       IS NOT DISTINCT FROM OLD.precio_costo
       AND NEW.precio_marketplace IS NOT DISTINCT FROM OLD.precio_marketplace
       AND NEW.precio_usd         IS NOT DISTINCT FROM OLD.precio_usd
       AND NEW.precio_costo_usd   IS NOT DISTINCT FROM OLD.precio_costo_usd
       AND NEW.margen_objetivo    IS NOT DISTINCT FROM OLD.margen_objetivo
       AND EXISTS (SELECT 1 FROM public.precios_programados pp
                    WHERE pp.id::text = v_pp AND pp.producto_id = NEW.id AND pp.estado = 'pendiente'
                      AND pp.precio_venta = NEW.precio_venta) THEN
      RETURN NEW;
    END IF;
    IF NOT public.auth_puede_editar_modulo('inventario') THEN
      RAISE EXCEPTION 'No autorizado: tu rol no puede cambiar precios de productos.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- ── Etiqueta del cambio de precio: no se la vuelve a pedir a la sucursal que ya la confirmó ─────────────
CREATE OR REPLACE FUNCTION public.fn_generar_tarea_repositor_precio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD; v_avanzado boolean; v_pp text;
BEGIN
  IF NEW.precio_venta IS NOT DISTINCT FROM OLD.precio_venta THEN RETURN NEW; END IF;

  SELECT (modo_operacion = 'avanzado') INTO v_avanzado FROM tenants WHERE id = NEW.tenant_id;
  IF NOT COALESCE(v_avanzado, false) THEN RETURN NEW; END IF;

  v_pp := COALESCE(current_setting('g360.pp_aplicando', true), '');

  FOR r IN
    SELECT pus.sucursal_id
    FROM producto_ubicacion_sucursal pus
    JOIN ubicaciones u ON u.id = pus.ubicacion_exhibicion_id
    WHERE pus.producto_id = NEW.id AND u.tipo_logico = 'exhibicion'
      -- Mig 441 (C-1): si este cambio es la aplicación de un programado cuya etiqueta esta sucursal YA confirmó
      -- (modo "requiere repositor"), no hay nada más que pedirle.
      AND NOT (v_pp <> '' AND EXISTS (SELECT 1 FROM tareas_repositor tr
                                       WHERE tr.precio_programado_id::text = v_pp AND tr.sucursal_id = pus.sucursal_id
                                         AND tr.estado = 'completada'))
  LOOP
    INSERT INTO tareas_repositor (tenant_id, sucursal_id, producto_id, tipo, precio_anterior, precio_nuevo, usuario_asignado_id)
    VALUES (NEW.tenant_id, r.sucursal_id, NEW.id, 'cambio_precio', OLD.precio_venta, NEW.precio_venta,
            fn_repositor_elegir_asignado(NEW.tenant_id, r.sucursal_id))
    ON CONFLICT (producto_id, sucursal_id, tipo) WHERE estado IN ('pendiente', 'en_curso')
    -- Mig 423: la tarea ligada a un precio programado que todavía no rige conserva la etiqueta del programado.
    DO UPDATE SET precio_nuevo = CASE
      WHEN tareas_repositor.precio_programado_id IS NOT NULL AND tareas_repositor.vigente_desde > now()
        THEN tareas_repositor.precio_nuevo
      ELSE EXCLUDED.precio_nuevo
    END;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[fn_generar_tarea_repositor_precio] producto % : %', NEW.id, SQLERRM;
  RETURN NEW;
END; $function$;
