-- ============================================================
-- 298_pedidos_ped6_bolsa_staging.sql
-- Módulo Pedidos — PED6 (bolsa de pedidos + ubicaciones de staging). Ver
-- G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md, hallazgo L2-3.
--
-- Alcance elegido (más seguro que forzar un cambio de destino físico del picking):
-- `pedido_lanzamientos` agrupa N pedidos + la ubicación de staging elegida como METADATO
-- organizativo — para filtrar/agrupar en `/picking` y para la lista imprimible (L2-2) — sin
-- tocar el mecanismo de reserva/generación de tareas ya probado. La RPC nueva
-- `fn_lanzar_bolsa_pedidos` NO reimplementa esa lógica: llama, pedido por pedido, a la RPC ya
-- existente `fn_generar_tareas_picking_pedido` (mig 294, sin cambios) y solo etiqueta las
-- tareas resultantes con `lanzamiento_id`. Si algún pedido de la bolsa no está `confirmado`
-- (o cualquier otra validación de esa RPC falla), la excepción aborta la función ENTERA — no
-- hay bolsas parciales.
--
-- 'staging' se agrega al CHECK de `ubicaciones.tipo_ubicacion` (antes
-- picking/bulk/estiba/camara/cross_dock, mig 032) — son las ubicaciones que se ofrecen al
-- elegir dónde converge la mercadería de una bolsa antes de despacharse.
--
-- Revisado por el subagente migration-reviewer — 1 hallazgo bloqueante corregido antes de
-- aplicar: 🔴 sin un guard explícito, un pedido YA lanzado (con `wms_tareas` existentes)
-- incluido por error en una bolsa nueva no generaba nada (`fn_generar_tareas_picking_pedido`
-- es idempotente por diseño) pero el `UPDATE wms_tareas SET lanzamiento_id` de todos modos
-- le reescribía la bolsa a esas tareas viejas en silencio — "robándoselas" a la bolsa/
-- lanzamiento al que realmente pertenecían (rompe trazabilidad write-time). Se agregó un
-- chequeo `EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = ...)` que rechaza la bolsa
-- ENTERA si cualquier pedido ya fue lanzado. También se agregó, como defensa en profundidad
-- (Regla #0 — la función se concede a `service_role`, que tiene BYPASSRLS): validar que
-- TODOS los pedidos del array sean del mismo tenant que el primero (antes solo se validaba
-- el primero), y que la ubicación de staging esté activa.
-- ============================================================

-- ── 1) 'staging' como tipo de ubicación nuevo ──────────────────────────────────────────
ALTER TABLE ubicaciones DROP CONSTRAINT IF EXISTS ubicaciones_tipo_ubicacion_check;
ALTER TABLE ubicaciones ADD CONSTRAINT ubicaciones_tipo_ubicacion_check
  CHECK (tipo_ubicacion IN ('picking','bulk','estiba','camara','cross_dock','staging'));

-- ── 2) pedido_lanzamientos — agrupa N pedidos + la ubicación de staging elegida ────────
CREATE TABLE IF NOT EXISTS pedido_lanzamientos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id           uuid REFERENCES sucursales(id) ON DELETE SET NULL,
  ubicacion_staging_id  uuid NOT NULL REFERENCES ubicaciones(id),
  creado_por            uuid REFERENCES users(id) ON DELETE SET NULL,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE pedido_lanzamientos IS
  'Bolsa de pedidos (PED6): agrupa N pedidos lanzados juntos + la ubicación de staging elegida como punto de convergencia. Metadato organizativo — no cambia cómo fn_generar_tareas_picking_pedido reserva/genera tareas.';

CREATE INDEX IF NOT EXISTS idx_pedido_lanzamientos_tenant ON pedido_lanzamientos (tenant_id);

ALTER TABLE pedido_lanzamientos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pedido_lanzamientos' AND policyname = 'pedido_lanzamientos_tenant') THEN
    CREATE POLICY pedido_lanzamientos_tenant ON pedido_lanzamientos FOR ALL
      USING (
        tenant_id = get_user_tenant_id()
        AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
      )
      WITH CHECK ( tenant_id = get_user_tenant_id() );
  END IF;
END $$;

REVOKE ALL ON pedido_lanzamientos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON pedido_lanzamientos TO authenticated;
GRANT ALL ON pedido_lanzamientos TO service_role;

-- ── 3) wms_tareas.lanzamiento_id — qué tareas pertenecen a qué bolsa ───────────────────
ALTER TABLE wms_tareas
  ADD COLUMN IF NOT EXISTS lanzamiento_id uuid REFERENCES pedido_lanzamientos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wms_tareas_lanzamiento ON wms_tareas (lanzamiento_id);

-- ── 4) fn_lanzar_bolsa_pedidos — lanza N pedidos juntos, etiqueta sus tareas ───────────
-- SECURITY INVOKER (mismo criterio que fn_generar_tareas_picking_pedido, a la que llama).
CREATE OR REPLACE FUNCTION public.fn_lanzar_bolsa_pedidos(
  p_pedido_ids           uuid[],
  p_ubicacion_staging_id uuid
)
RETURNS TABLE (pedido_id uuid, tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_primer_pedido   RECORD;
  v_ubicacion       RECORD;
  v_lanzamiento_id  uuid;
  v_pedido_id       uuid;
  v_pedido_tid      uuid;
  v_row             RECORD;
BEGIN
  IF p_pedido_ids IS NULL OR array_length(p_pedido_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Elegí al menos un pedido para lanzar en bolsa';
  END IF;
  IF p_ubicacion_staging_id IS NULL THEN
    RAISE EXCEPTION 'Elegí una ubicación de staging para la bolsa';
  END IF;

  SELECT * INTO v_primer_pedido FROM pedidos WHERE id = p_pedido_ids[1];
  IF v_primer_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;

  SELECT * INTO v_ubicacion FROM ubicaciones
  WHERE id = p_ubicacion_staging_id AND tenant_id = v_primer_pedido.tenant_id;
  IF v_ubicacion IS NULL THEN
    RAISE EXCEPTION 'Ubicación de staging inexistente o de otro tenant';
  END IF;
  IF v_ubicacion.tipo_ubicacion <> 'staging' THEN
    RAISE EXCEPTION 'La ubicación elegida no es de tipo staging';
  END IF;
  IF NOT COALESCE(v_ubicacion.activo, true) THEN
    RAISE EXCEPTION 'La ubicación de staging elegida está desactivada';
  END IF;

  -- Defensa en profundidad (Regla #0: guards server-side además de RLS) — la RLS de
  -- `pedidos`/`wms_tareas` ya bloquea a un usuario `authenticated` normal de colar un
  -- pedido_id de otro tenant, pero esta función también se concede a `service_role`
  -- (BYPASSRLS) — validar explícitamente que TODOS los pedidos del array sean del mismo
  -- tenant que el primero, no confiar solo en la RLS del caller.
  FOREACH v_pedido_id IN ARRAY p_pedido_ids LOOP
    SELECT tenant_id INTO v_pedido_tid FROM pedidos WHERE id = v_pedido_id;
    IF v_pedido_tid IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos: %', v_pedido_id; END IF;
    IF v_pedido_tid IS DISTINCT FROM v_primer_pedido.tenant_id THEN
      RAISE EXCEPTION 'Todos los pedidos de la bolsa tienen que ser del mismo tenant';
    END IF;
    -- No hay bolsas parciales: si CUALQUIER pedido ya fue lanzado (tiene wms_tareas), se
    -- rechaza la bolsa ENTERA — sin este guard, fn_generar_tareas_picking_pedido (idempotente
    -- por diseño) devolvería las tareas YA EXISTENTES de ese pedido sin generar nada nuevo, y
    -- el UPDATE de abajo les reescribiría `lanzamiento_id` a esta bolsa nueva en silencio,
    -- "robándole" esas tareas a la bolsa/lanzamiento individual al que realmente pertenecen.
    -- Nota: `wms_tareas.pedido_id` calificado explícitamente — esta función tiene `pedido_id`
    -- como columna de salida (RETURNS TABLE), que Postgres expone como variable PL/pgSQL en
    -- todo el cuerpo; una referencia sin calificar era ambigua (error real 42702 encontrado
    -- al correr el e2e nuevo, no algo hipotético).
    IF EXISTS (SELECT 1 FROM wms_tareas WHERE wms_tareas.pedido_id = v_pedido_id) THEN
      RAISE EXCEPTION 'El pedido % ya fue lanzado — no se puede incluir en una bolsa nueva', v_pedido_id;
    END IF;
  END LOOP;

  INSERT INTO pedido_lanzamientos (tenant_id, sucursal_id, ubicacion_staging_id, creado_por)
  VALUES (v_primer_pedido.tenant_id, v_primer_pedido.sucursal_id, p_ubicacion_staging_id, auth.uid())
  RETURNING id INTO v_lanzamiento_id;

  FOREACH v_pedido_id IN ARRAY p_pedido_ids LOOP
    FOR v_row IN SELECT * FROM fn_generar_tareas_picking_pedido(v_pedido_id) LOOP
      UPDATE wms_tareas SET lanzamiento_id = v_lanzamiento_id WHERE id = v_row.tarea_id;
      RETURN QUERY SELECT v_pedido_id, v_row.tarea_id, v_row.tipo;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION fn_lanzar_bolsa_pedidos(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_lanzar_bolsa_pedidos(uuid[], uuid) TO authenticated, service_role;
