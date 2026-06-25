-- Migration 244 (v1.90.1) — #3: armado/desarmado de KITs ATÓMICO vía RPC.
-- Antes: iniciar/confirmar/cancelar armado eran varios writes sueltos desde el frontend → una falla
-- a mitad podía dejar componentes consumidos sin KIT (o reservas huérfanas). Ahora cada operación es
-- una función = una transacción → o se aplica todo, o nada. REGLA #0 (stock).
--
-- SECURITY INVOKER (default): corren con los privilegios del usuario → la RLS por tenant aísla
-- automáticamente (un usuario solo puede tocar las filas de su tenant; un log de otro tenant no se ve).
-- Espejan la lógica que tenía InventarioPage (iniciarArmado/confirmarArmado/cancelarArmado).

-- ── 1. INICIAR: valida stock, reserva componentes FIFO, crea kitting_log 'en_armado' ───────────────
CREATE OR REPLACE FUNCTION public.iniciar_armado_kit(
  p_kit_producto_id uuid,
  p_cantidad        numeric,
  p_ubicacion_id    uuid,
  p_sucursal_id     uuid,
  p_notas           text
) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     uuid;
  rec          RECORD;
  ln           RECORD;
  v_requerido  numeric;
  v_disponible numeric;
  v_restante   numeric;
  v_reservar   numeric;
  v_reservados jsonb := '[]'::jsonb;
  v_log_id     uuid;
  v_nrecetas   int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;

  SELECT count(*) INTO v_nrecetas FROM kit_recetas
    WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id;
  IF v_nrecetas = 0 THEN RAISE EXCEPTION 'El KIT no tiene receta configurada'; END IF;

  -- 1a. Validar disponible (cantidad − reservada) por componente, en la sucursal si se pasa
  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas
             WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id LOOP
    v_requerido := rec.cantidad * p_cantidad;
    SELECT COALESCE(sum(cantidad - COALESCE(cantidad_reservada, 0)), 0) INTO v_disponible
      FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = rec.comp_producto_id AND activo = true
        AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
    IF v_disponible < v_requerido THEN
      RAISE EXCEPTION 'Stock insuficiente del componente % (necesita %, hay %)',
        rec.comp_producto_id, v_requerido, v_disponible;
    END IF;
  END LOOP;

  -- 1b. Reservar FIFO (cantidad_reservada↑) y guardar el desglose
  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas
             WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id LOOP
    v_restante := rec.cantidad * p_cantidad;
    FOR ln IN
      SELECT id, (cantidad - COALESCE(cantidad_reservada, 0)) AS disp FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = rec.comp_producto_id AND activo = true
        AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id)
        AND (cantidad - COALESCE(cantidad_reservada, 0)) > 0
      ORDER BY created_at
    LOOP
      EXIT WHEN v_restante <= 0;
      v_reservar := LEAST(ln.disp, v_restante);
      UPDATE inventario_lineas SET cantidad_reservada = COALESCE(cantidad_reservada, 0) + v_reservar WHERE id = ln.id;
      v_reservados := v_reservados || jsonb_build_object('linea_id', ln.id, 'comp_producto_id', rec.comp_producto_id, 'cantidad', v_reservar);
      v_restante := v_restante - v_reservar;
    END LOOP;
  END LOOP;

  INSERT INTO kitting_log (tenant_id, kit_producto_id, cantidad_kits, ubicacion_id, usuario_id, notas, tipo, estado, componentes_reservados)
  VALUES (v_tenant, p_kit_producto_id, p_cantidad, p_ubicacion_id, auth.uid(), p_notas, 'armado', 'en_armado', v_reservados)
  RETURNING id INTO v_log_id;
  RETURN v_log_id;
END $function$;

-- ── 2. CONFIRMAR: rebaja componentes + ingresa el KIT + movimientos, marca completado ──────────────
CREATE OR REPLACE FUNCTION public.confirmar_armado_kit(
  p_log_id      uuid,
  p_sucursal_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_log    RECORD;
  comp     RECORD;
  ent      RECORD;
  v_antes  numeric;
  v_kantes numeric;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  SELECT * INTO v_log FROM kitting_log WHERE id = p_log_id;
  IF v_log.id IS NULL THEN RAISE EXCEPTION 'Armado no encontrado'; END IF;
  IF v_log.tenant_id <> v_tenant THEN RAISE EXCEPTION 'Armado de otro tenant'; END IF;
  IF v_log.estado <> 'en_armado' THEN RAISE EXCEPTION 'El armado no está en proceso (estado=%)', v_log.estado; END IF;

  -- 1. Rebaja de componentes (cantidad − consumido, libera la reserva) por línea
  FOR ent IN SELECT * FROM jsonb_to_recordset(v_log.componentes_reservados)
             AS x(linea_id uuid, comp_producto_id uuid, cantidad numeric) LOOP
    UPDATE inventario_lineas
      SET cantidad = cantidad - ent.cantidad,
          cantidad_reservada = GREATEST(0, COALESCE(cantidad_reservada, 0) - ent.cantidad)
      WHERE id = ent.linea_id;
  END LOOP;

  -- 1b. movimientos_stock 'rebaje' por componente (snapshot reconstruido tras la rebaja)
  FOR comp IN SELECT comp_producto_id, sum(cantidad) AS cant
              FROM jsonb_to_recordset(v_log.componentes_reservados)
              AS x(linea_id uuid, comp_producto_id uuid, cantidad numeric)
              GROUP BY comp_producto_id LOOP
    SELECT COALESCE(sum(cantidad), 0) INTO v_antes FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = comp.comp_producto_id AND activo = true
        AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
    INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, sucursal_id)
    VALUES (v_tenant, comp.comp_producto_id, 'rebaje', comp.cant, v_antes + comp.cant, v_antes,
            'Kitting x' || v_log.cantidad_kits || ' [' || v_log.kit_producto_id || ']', auth.uid(), p_sucursal_id);
  END LOOP;

  -- 2. Ingreso del KIT
  INSERT INTO inventario_lineas (tenant_id, producto_id, cantidad, ubicacion_id, activo, sucursal_id)
  VALUES (v_tenant, v_log.kit_producto_id, v_log.cantidad_kits, v_log.ubicacion_id, true, p_sucursal_id);
  SELECT COALESCE(sum(cantidad), 0) INTO v_kantes FROM inventario_lineas
    WHERE tenant_id = v_tenant AND producto_id = v_log.kit_producto_id AND activo = true
      AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
  INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, sucursal_id)
  VALUES (v_tenant, v_log.kit_producto_id, 'kitting', v_log.cantidad_kits, v_kantes - v_log.cantidad_kits, v_kantes,
          COALESCE(v_log.notas, 'Kitting x' || v_log.cantidad_kits), auth.uid(), p_sucursal_id);

  UPDATE kitting_log SET estado = 'completado' WHERE id = p_log_id;
END $function$;

-- ── 3. CANCELAR: libera las reservas, marca cancelado ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_armado_kit(p_log_id uuid) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_log    RECORD;
  ent      RECORD;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  SELECT * INTO v_log FROM kitting_log WHERE id = p_log_id;
  IF v_log.id IS NULL THEN RAISE EXCEPTION 'Armado no encontrado'; END IF;
  IF v_log.tenant_id <> v_tenant THEN RAISE EXCEPTION 'Armado de otro tenant'; END IF;
  IF v_log.estado <> 'en_armado' THEN RAISE EXCEPTION 'El armado no está en proceso (estado=%)', v_log.estado; END IF;

  FOR ent IN SELECT * FROM jsonb_to_recordset(v_log.componentes_reservados)
             AS x(linea_id uuid, comp_producto_id uuid, cantidad numeric) LOOP
    UPDATE inventario_lineas
      SET cantidad_reservada = GREATEST(0, COALESCE(cantidad_reservada, 0) - ent.cantidad)
      WHERE id = ent.linea_id;
  END LOOP;
  UPDATE kitting_log SET estado = 'cancelado' WHERE id = p_log_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.iniciar_armado_kit(uuid, numeric, uuid, uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_armado_kit(uuid, uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_armado_kit(uuid)                              TO authenticated;
