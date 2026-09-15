-- 423 — Precio de venta programado, Fases 2-3: la etiqueta de la góndola
--
-- Respuestas de GO al relevamiento `relevamiento-precio-programado-reglas-negocio.html` (log 2026-09-14,
-- "Sesión cont. 68"):
--   · C1/C2 la tarea de cambiar la etiqueta aparece ANTES de la hora (anticipación configurable, 60 minutos
--     por defecto), con el precio NUEVO, y no se puede completar mientras rija el precio viejo: una etiqueta
--     pegada antes de hora hace que la góndola muestre un precio que el sistema todavía no cobra.
--   · C3 aviso al cajero mientras la etiqueta siga pendiente (frontend, lee `tareas_repositor`) + alerta de
--     etiquetas vencidas: tarea ligada a un precio programado cuya hora ya pasó y sigue sin hacerse.
--
-- Piezas:
--   1) `tenants.repositor_anticipacion_min` (0 a 1440; 0 = la tarea aparece a la hora).
--   2) `tareas_repositor.precio_programado_id` + `vigente_desde`.
--   3) `fn_generar_tareas_precio_programado`: la llama el cron de cada minuto antes de aplicar. Crea la tarea
--      en cada sucursal donde el producto tiene góndola. Si ya había una tarea de cartel sin hacer para ese
--      producto, la fusiona: un solo viaje a la góndola, se pone directamente la etiqueta del programado.
--   4) `fn_generar_tarea_repositor_precio` (trigger del cambio de precio): si la tarea activa está ligada a un
--      programado que todavía no rige, un cambio manual no le pisa el precio nuevo — la etiqueta que hay que
--      poner a esa hora es la del programado.
--   5) `fn_aplicar_precios_programados`: genera primero las tareas anticipadas y, al aplicar, liga al
--      programado la tarea activa del producto (cubre anticipación 0 o una tarea nacida recién al aplicar).
--   6) Cancelar, reemplazar o no poder aplicar un programado desarma su tarea: si la góndola ya muestra el
--      precio vigente se cancela; si no (venía fusionada con un cambio anterior sin hacer), vuelve a pedir la
--      etiqueta del precio vigente.
--   7) Guard server-side: no se completa una tarea ligada a un programado pendiente mientras el precio vigente
--      no sea el de la etiqueta nueva.
--   8) Permisos: `authenticated` ya no puede INSERT/DELETE en `tareas_repositor` (las tareas solo nacen de
--      triggers y del cron) y solo actualiza las columnas que usa la pantalla. Sin esto el guard se salteaba
--      reescribiendo `precio_programado_id` o `vigente_desde` por REST.
--   9) `vw_tareas_repositor`: "se vendió con el cartel desactualizado" cuenta desde que rige el precio (antes
--      de la hora la góndola está bien) + al final las 2 columnas nuevas y el precio vigente del producto.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Anticipación configurable por negocio
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS repositor_anticipacion_min integer NOT NULL DEFAULT 60;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_repositor_anticipacion_min_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_repositor_anticipacion_min_check
      CHECK (repositor_anticipacion_min BETWEEN 0 AND 1440);
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.repositor_anticipacion_min IS
  'Cuántos minutos antes de que rija un precio programado aparece la tarea del repositor para cambiar la etiqueta (0 = a la hora). Mig 423.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) La tarea sabe de qué precio programado viene
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tareas_repositor
  ADD COLUMN IF NOT EXISTS precio_programado_id uuid REFERENCES public.precios_programados(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vigente_desde timestamptz;

CREATE INDEX IF NOT EXISTS idx_tareas_repositor_precio_programado
  ON public.tareas_repositor (precio_programado_id) WHERE precio_programado_id IS NOT NULL;

COMMENT ON COLUMN public.tareas_repositor.precio_programado_id IS
  'Precio programado que origina la etiqueta (C1/C2). Mientras esté pendiente y el precio vigente no sea precio_nuevo, la tarea no se puede completar. Mig 423.';
COMMENT ON COLUMN public.tareas_repositor.vigente_desde IS
  'Desde cuándo rige el precio de la etiqueta. Pasada esa hora con la tarea sin hacer = etiqueta vencida (C3). Mig 423.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6) Desarmar la tarea de un programado que ya no se va a aplicar (se define primero: la usan 5, 6b y 6c)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_tareas_precio_programado_desarmar(p_precio_programado_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tr.id, tr.precio_anterior, p.precio_venta AS precio_actual
      FROM public.tareas_repositor tr
      JOIN public.productos p ON p.id = tr.producto_id
     WHERE tr.precio_programado_id = p_precio_programado_id
       AND tr.estado IN ('pendiente', 'en_curso')
     FOR UPDATE OF tr
  LOOP
    IF t.precio_anterior IS NOT DISTINCT FROM t.precio_actual THEN
      -- La góndola ya muestra el precio que rige: la tarea no hace falta.
      UPDATE public.tareas_repositor
         SET estado = 'cancelada', cancelled_at = now(), motivo_cancelacion = p_motivo
       WHERE id = t.id;
    ELSE
      -- Venía fusionada con un cambio anterior que nadie hizo: sigue haciendo falta, con el precio vigente.
      UPDATE public.tareas_repositor
         SET precio_nuevo = t.precio_actual, precio_programado_id = NULL, vigente_desde = NULL
       WHERE id = t.id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tareas_precio_programado_desarmar(uuid, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) Tareas anticipadas (C1/C2)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_generar_tareas_precio_programado()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
       AND pp.vigente_desde > now()
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
$$;

REVOKE ALL ON FUNCTION public.fn_generar_tareas_precio_programado() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Trigger del cambio de precio (fuente real de DEV, mig 354) + no pisar la etiqueta programada
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_generar_tarea_repositor_precio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_avanzado boolean;
BEGIN
  IF NEW.precio_venta IS NOT DISTINCT FROM OLD.precio_venta THEN RETURN NEW; END IF;

  SELECT (modo_operacion = 'avanzado') INTO v_avanzado FROM tenants WHERE id = NEW.tenant_id;
  IF NOT COALESCE(v_avanzado, false) THEN RETURN NEW; END IF;

  FOR r IN
    SELECT pus.sucursal_id
    FROM producto_ubicacion_sucursal pus
    JOIN ubicaciones u ON u.id = pus.ubicacion_exhibicion_id
    WHERE pus.producto_id = NEW.id AND u.tipo_logico = 'exhibicion'
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
END; $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) Cron de cada minuto (fuente real de DEV, mig 422) + tareas anticipadas + ligar la tarea al aplicar
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_aplicar_precios_programados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r        RECORD;
  v_n      integer := 0;
  v_error  text;
BEGIN
  -- Mig 423 (C1/C2): primero las etiquetas que tienen que aparecer antes de la hora. Si falla, se aplica igual.
  BEGIN
    PERFORM public.fn_generar_tareas_precio_programado();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fn_aplicar_precios_programados] no se pudieron generar las tareas anticipadas: %', SQLERRM;
  END;

  FOR r IN
    SELECT pp.id, pp.tenant_id, pp.producto_id, pp.precio_venta, pp.creado_por, pp.vigente_desde,
           p.precio_venta AS precio_actual, p.nombre AS producto_nombre
      FROM public.precios_programados pp
      JOIN public.productos p ON p.id = pp.producto_id
     WHERE pp.estado = 'pendiente' AND pp.vigente_desde <= now()
     ORDER BY pp.vigente_desde
     LIMIT 500
     FOR UPDATE OF pp SKIP LOCKED
  LOOP
    BEGIN
      -- El mismo UPDATE que un cambio manual: dispara la tarea del repositor y la publicación en ML/TN.
      UPDATE public.productos SET precio_venta = r.precio_venta WHERE id = r.producto_id;

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

      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Nunca en silencio: queda marcado y se avisa al dueño.
      v_error := SQLERRM;
      -- Mig 423 (migration-reviewer): con su propia subtransacción. Sin esto, un error acá (p. ej. al insertar el
      -- aviso) se escapaba del loop y revertía TODOS los precios ya aplicados en este minuto.
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
        RAISE WARNING '[fn_aplicar_precios_programados] no se pudo marcar ni avisar el fallo del programado %: %', r.id, SQLERRM;
      END;
      -- Mig 423: la etiqueta anticipada de un precio que no se aplicó no se tiene que poner.
      BEGIN
        PERFORM public.fn_tareas_precio_programado_desarmar(r.id, 'No se pudo aplicar el precio programado');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[fn_aplicar_precios_programados] programado % fallido, no se pudo desarmar su tarea: %', r.id, SQLERRM;
      END;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6b) Programar (fuente real de DEV, mig 422): reemplazar desarma la tarea del programado anterior
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_programar_precio(
  p_producto_id   uuid,
  p_precio_venta  numeric,
  p_vigente_desde timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant    uuid := public.get_user_tenant_id();
  v_prod      RECORD;
  v_id        uuid;
  v_nombre_us text;
  v_viejo     RECORD;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.auth_puede_editar_modulo('inventario') THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede cambiar precios de productos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id, tenant_id, nombre, precio_venta INTO v_prod
    FROM public.productos WHERE id = p_producto_id;
  IF NOT FOUND OR v_prod.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'Producto no encontrado.';
  END IF;

  IF p_precio_venta IS NULL OR p_precio_venta < 0 THEN
    RAISE EXCEPTION 'El precio programado tiene que ser un número mayor o igual a cero.';
  END IF;
  IF p_vigente_desde IS NULL OR p_vigente_desde < now() + interval '1 minute' THEN
    RAISE EXCEPTION 'La fecha y hora tienen que ser futuras. Para que el precio rija ya, guardá sin programar.';
  END IF;
  IF p_vigente_desde > now() + interval '366 days' THEN
    RAISE EXCEPTION 'No se puede programar un precio a más de un año.';
  END IF;

  -- A2: programar otro reemplaza al pendiente. Mig 423: y desarma la etiqueta que ya hubiera generado.
  FOR v_viejo IN
    SELECT id FROM public.precios_programados
     WHERE producto_id = p_producto_id AND estado = 'pendiente'
     FOR UPDATE
  LOOP
    PERFORM public.fn_tareas_precio_programado_desarmar(v_viejo.id, 'Se reemplazó el cambio de precio programado');
  END LOOP;

  UPDATE public.precios_programados
     SET estado = 'cancelado', cancelado_por = v_uid, cancelado_at = now(),
         error = 'Reemplazado por un cambio programado nuevo'
   WHERE producto_id = p_producto_id AND estado = 'pendiente';

  INSERT INTO public.precios_programados (tenant_id, producto_id, precio_venta, vigente_desde, creado_por)
  VALUES (v_tenant, p_producto_id, round(p_precio_venta, 2), p_vigente_desde, v_uid)
  RETURNING id INTO v_id;

  -- E4: quién lo programó.
  SELECT nombre_display INTO v_nombre_us FROM public.users WHERE id = v_uid;
  INSERT INTO public.actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id, entidad_nombre,
                                    accion, campo, valor_anterior, valor_nuevo, pagina, producto_id)
  VALUES (v_tenant, v_uid, v_nombre_us, 'producto', p_producto_id::text, v_prod.nombre,
          'programar_precio', 'precio de venta', v_prod.precio_venta::text,
          round(p_precio_venta, 2)::text || ' desde ' ||
            to_char(p_vigente_desde AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
          '/productos', p_producto_id);

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6c) Cancelar (fuente real de DEV, mig 422): desarma la etiqueta
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancelar_precio_programado(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant    uuid := public.get_user_tenant_id();
  v_pp        RECORD;
  v_nombre_us text;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.auth_puede_editar_modulo('inventario') THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede cambiar precios de productos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT pp.id, pp.tenant_id, pp.estado, pp.producto_id, pp.precio_venta, pp.vigente_desde, p.nombre AS producto_nombre
    INTO v_pp
    FROM public.precios_programados pp JOIN public.productos p ON p.id = pp.producto_id
   WHERE pp.id = p_id
   FOR UPDATE OF pp;
  IF NOT FOUND OR v_pp.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'Cambio programado no encontrado.';
  END IF;
  IF v_pp.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Este cambio ya no está pendiente (estado: %).', v_pp.estado;
  END IF;

  UPDATE public.precios_programados
     SET estado = 'cancelado', cancelado_por = v_uid, cancelado_at = now()
   WHERE id = p_id;

  -- Mig 423: la etiqueta anticipada ya no se tiene que poner.
  PERFORM public.fn_tareas_precio_programado_desarmar(p_id, 'Se canceló el cambio de precio programado');

  SELECT nombre_display INTO v_nombre_us FROM public.users WHERE id = v_uid;
  INSERT INTO public.actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id, entidad_nombre,
                                    accion, campo, valor_anterior, pagina, producto_id)
  VALUES (v_tenant, v_uid, v_nombre_us, 'producto', v_pp.producto_id::text, v_pp.producto_nombre,
          'cancelar_precio_programado', 'precio de venta',
          v_pp.precio_venta::text || ' desde ' ||
            to_char(v_pp.vigente_desde AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
          '/productos', v_pp.producto_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 7) Guard: la etiqueta del precio programado no se da por puesta antes de que rija
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_tarea_repositor_guard_completar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pp_estado     text;
  v_precio_actual numeric;
BEGIN
  IF NEW.estado = 'completada' AND OLD.estado IN ('pendiente', 'en_curso') AND OLD.precio_programado_id IS NOT NULL THEN
    SELECT estado INTO v_pp_estado FROM public.precios_programados WHERE id = OLD.precio_programado_id;
    SELECT precio_venta INTO v_precio_actual FROM public.productos WHERE id = OLD.producto_id;
    -- Si el precio vigente ya es el de la etiqueta, se puede poner (lo aplicó el cron o alguien lo cambió a mano).
    IF v_precio_actual IS DISTINCT FROM OLD.precio_nuevo AND v_pp_estado IS DISTINCT FROM 'aplicado' THEN
      IF v_pp_estado = 'pendiente' THEN
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
$$;

REVOKE ALL ON FUNCTION public.fn_tarea_repositor_guard_completar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tarea_repositor_guard_completar ON public.tareas_repositor;
CREATE TRIGGER trg_tarea_repositor_guard_completar
  BEFORE UPDATE OF estado ON public.tareas_repositor
  FOR EACH ROW EXECUTE FUNCTION public.fn_tarea_repositor_guard_completar();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 8) Permisos de escritura de tareas_repositor
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- La pantalla solo completa, cancela y reasigna (RepositoresPage). Las tareas nacen de triggers y del cron,
-- que son SECURITY DEFINER.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tareas_repositor FROM authenticated;
GRANT UPDATE (estado, completed_at, cancelled_at, motivo_cancelacion, usuario_asignado_id, notas)
  ON public.tareas_repositor TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 9) Vista (columnas explícitas: `tr.*` metería las nuevas en el medio y CREATE OR REPLACE lo rechaza)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.vw_tareas_repositor
WITH (security_invoker = true)
AS
SELECT
  tr.id,
  tr.tenant_id,
  tr.sucursal_id,
  tr.producto_id,
  tr.tipo,
  tr.estado,
  tr.precio_anterior,
  tr.precio_nuevo,
  tr.estado_inventario_id,
  tr.inventario_linea_id,
  tr.usuario_asignado_id,
  tr.creado_por,
  tr.motivo_cancelacion,
  tr.notas,
  tr.created_at,
  tr.completed_at,
  tr.cancelled_at,
  p.nombre AS producto_nombre,
  p.sku AS producto_sku,
  ei.nombre AS estado_nombre,
  ei.descuento_pct,
  il.fecha_vencimiento,
  EXISTS (
    SELECT 1 FROM venta_items vi
    JOIN ventas v ON v.id = vi.venta_id
    WHERE vi.producto_id = tr.producto_id
      AND v.sucursal_id = tr.sucursal_id
      -- Mig 423: con un precio programado, antes de la hora la góndola está bien.
      AND v.created_at > GREATEST(tr.created_at, COALESCE(tr.vigente_desde, tr.created_at))
      AND v.estado NOT IN ('cancelada', 'pendiente')
  ) AS vendido_con_tag_desactualizado,
  (tr.tipo = 'cambio_precio' AND tr.precio_nuevo IS NOT NULL AND tr.precio_anterior IS NOT NULL
   AND tr.precio_nuevo > tr.precio_anterior) AS precio_subio,
  ua.nombre_display AS usuario_asignado_nombre,
  tr.precio_programado_id,
  tr.vigente_desde,
  -- El precio que rige hoy: la pantalla lo compara con precio_nuevo para saber si la etiqueta ya se puede poner.
  p.precio_venta AS precio_vigente
FROM tareas_repositor tr
JOIN productos p ON p.id = tr.producto_id
LEFT JOIN estados_inventario ei ON ei.id = tr.estado_inventario_id
LEFT JOIN inventario_lineas il ON il.id = tr.inventario_linea_id
LEFT JOIN users ua ON ua.id = tr.usuario_asignado_id;

COMMENT ON VIEW public.vw_tareas_repositor IS
  'tareas_repositor + datos de prioridad C1-C3 (mig 352) + nombre del asignado (mig 354) + precio programado y desde cuándo rige (mig 423). WITH (security_invoker = true) desde mig 353.';
