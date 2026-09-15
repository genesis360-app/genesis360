-- 422 — Precio de venta con fecha/hora de vigencia (Fase 1: el núcleo)
--
-- Pedido de Fede; relevamiento `relevamiento-precio-programado-reglas-negocio.html`, respondido por GO el
-- 2026-09-14 (ver log). Esta migración cubre el núcleo de la v1:
--   · A1 el precio vigente sigue rigiendo y el nuevo queda agendado · A2 uno por producto (programar otro
--     reemplaza al anterior) · A3 se cancela antes de la fecha, lo pueden hacer los mismos roles que hoy
--     cambian precios · A5 solo el precio de venta minorista.
--   · E3 lo aplica el SERVIDOR (pg_cron cada minuto), aunque nadie tenga la app abierta.
--   · E4 queda registrado quién lo programó y cuándo se aplicó (`actividad_log`).
--   · D1 al aplicarse se hace el MISMO `UPDATE OF precio_venta` que un cambio manual, así que los triggers
--     existentes disparan solos en el momento justo: la tarea del repositor
--     (`fn_generar_tarea_repositor_precio`) y la publicación en ML/TN (`fn_enqueue_sync_precio`).
--     `fn_productos_rol_guard` lo deja pasar porque `auth_puede_editar_modulo` devuelve true sin sesión
--     (migs 396/404/405) — por eso el permiso se valida al PROGRAMAR, en `fn_programar_precio`.
--   · E2 aviso el día anterior, y aviso al dueño si un cambio no se pudo aplicar.
-- La tarea anticipada del repositor (C1/C2) y el aviso al cajero (C3) van en migraciones aparte.
--
-- Escritura SOLO por las funciones SECURITY DEFINER: la tabla no tiene policies de INSERT/UPDATE/DELETE,
-- así que el guard de permisos no se puede saltear escribiendo directo por PostgREST.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) La tabla
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.precios_programados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  producto_id     uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  -- Mismo tipo que productos.precio_venta.
  precio_venta    numeric(12,2) NOT NULL CHECK (precio_venta >= 0),
  vigente_desde   timestamptz NOT NULL,
  estado          text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'aplicado', 'cancelado', 'fallido')),
  -- El precio que regía en el momento en que se aplicó (no cuando se programó).
  precio_anterior numeric(12,2),
  creado_por      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  aplicado_at     timestamptz,
  cancelado_por   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelado_at    timestamptz,
  error           text
);

-- A2: un solo cambio pendiente por producto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_precios_programados_pendiente
  ON public.precios_programados (producto_id) WHERE estado = 'pendiente';
-- Lo que lee el cron cada minuto.
CREATE INDEX IF NOT EXISTS idx_precios_programados_a_aplicar
  ON public.precios_programados (vigente_desde) WHERE estado = 'pendiente';
-- La lista de la pantalla.
CREATE INDEX IF NOT EXISTS idx_precios_programados_tenant
  ON public.precios_programados (tenant_id, estado, vigente_desde);

ALTER TABLE public.precios_programados ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'precios_programados'
                 AND policyname = 'precios_programados_select') THEN
    CREATE POLICY precios_programados_select ON public.precios_programados
      FOR SELECT USING (tenant_id = public.get_user_tenant_id());
  END IF;
END $$;

REVOKE ALL ON public.precios_programados FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.precios_programados FROM authenticated;
GRANT SELECT ON public.precios_programados TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) Programar (reemplaza el pendiente anterior, A2)
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

  -- A2: programar otro reemplaza al pendiente.
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
-- 3) Cancelar (A3)
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
-- 4) Aplicar lo que ya entró en vigencia (cron cada minuto)
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
  FOR r IN
    SELECT pp.id, pp.tenant_id, pp.producto_id, pp.precio_venta, pp.creado_por,
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

      INSERT INTO public.actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id, entidad_nombre,
                                        accion, campo, valor_anterior, valor_nuevo, pagina, producto_id)
      VALUES (r.tenant_id, r.creado_por, 'Cambio de precio programado', 'producto', r.producto_id::text,
              r.producto_nombre, 'editar', 'precio de venta (programado)', r.precio_actual::text,
              r.precio_venta::text, '/productos', r.producto_id);

      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Nunca en silencio: queda marcado y se avisa al dueño.
      v_error := SQLERRM;
      UPDATE public.precios_programados SET estado = 'fallido', error = v_error WHERE id = r.id;
      INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      SELECT r.tenant_id, u.id, 'danger',
             'No se pudo aplicar un precio programado',
             r.producto_nombre || ': ' || v_error || '. El precio anterior sigue vigente.',
             '/productos?tab=programados'
        FROM public.users u
       WHERE u.tenant_id = r.tenant_id AND u.rol IN ('DUEÑO', 'SUPER_USUARIO');
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) E2 — aviso el día anterior (cron diario, 09:00 hora Argentina)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notificar_precios_programados_manana()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_manana date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1;
BEGIN
  FOR r IN
    SELECT pp.tenant_id, u.id AS user_id, count(*) AS cantidad,
           min(pp.vigente_desde) AS primero
      FROM public.precios_programados pp
      JOIN public.users u ON u.tenant_id = pp.tenant_id AND u.rol IN ('DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR')
     WHERE pp.estado = 'pendiente'
       AND (pp.vigente_desde AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_manana
     GROUP BY pp.tenant_id, u.id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notificaciones
       WHERE user_id = r.user_id
         AND action_url = '/productos?tab=programados'
         AND titulo LIKE 'Mañana cambia%'
         AND created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      VALUES (
        r.tenant_id, r.user_id, 'info',
        CASE WHEN r.cantidad = 1 THEN 'Mañana cambia 1 precio programado'
             ELSE 'Mañana cambian ' || r.cantidad || ' precios programados' END,
        'El primero rige a las ' ||
          to_char(r.primero AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI') ||
          '. Revisalos en Productos → Programados.',
        '/productos?tab=programados'
      );
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6) Permisos de ejecución (REVOKE a anon explícito: el de PUBLIC no alcanza, ver
--    reference_revoke_public_no_anon)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_programar_precio(uuid, numeric, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cancelar_precio_programado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_programar_precio(uuid, numeric, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_precio_programado(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_aplicar_precios_programados() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notificar_precios_programados_manana() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 7) Crons (cron.schedule con el mismo nombre actualiza el job: idempotente)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule('aplicar-precios-programados', '* * * * *', 'SELECT public.fn_aplicar_precios_programados()');
SELECT cron.schedule('notif-precios-programados-manana', '0 12 * * *', 'SELECT public.fn_notificar_precios_programados_manana()');
