-- 388: A4 del relevamiento de Supervisión (Fede 2026-08-20) — kit_precio (Motor de Rotación,
-- Opción 3) y repricing_margen (D3, fn_evaluar_repricing_margen) estaban mal clasificados en
-- modulo='inventario' pese a ser cambios de PRECIO de producto, no de inventario. Se reclasifican
-- a modulo='productos' (ya admitido por el CHECK ampliado en mig 386). Sin importar que rompa
-- continuidad de filas históricas — decisión explícita de GO, sin clientes reales todavía.
--
-- El código de aplicación (InventarioPage.tsx: sigue insertando kit_precio, ahora con
-- modulo='productos'; ProductosPage.tsx: tab "Autorizaciones" nueva que aprueba/rechaza/reasigna)
-- se despliega en el mismo commit que esta migración — no dejar esta migración aplicada sin el
-- código, o las filas reclasificadas quedarían invisibles hasta el deploy del frontend.

-- 1) Reclasificar filas EXISTENTES (históricas + las pendientes reales de hoy).
UPDATE public.autorizaciones
SET modulo = 'productos'
WHERE modulo = 'inventario' AND tipo IN ('kit_precio', 'repricing_margen');

-- 2) fn_evaluar_repricing_margen (D3, mig 346): mismo cuerpo, solo cambia el modulo del INSERT y
-- la action_url de la notificación (antes apuntaban a /inventario, ahora a /productos).
CREATE OR REPLACE FUNCTION public.fn_evaluar_repricing_margen(p_tenant_id uuid)
 RETURNS TABLE(producto_id uuid, accion text, precio_anterior numeric, precio_nuevo numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  v_modo text; v_tope_pct numeric; v_umbral_aviso numeric; v_desde_monto numeric;
  v_sugerido numeric; v_diferencia numeric; v_maximo_variacion numeric; v_final numeric;
  v_aplicar_directo boolean;
BEGIN
  SELECT repricing_modo, repricing_tope_pct, repricing_umbral_aviso_monto, repricing_automatico_desde_monto
    INTO v_modo, v_tope_pct, v_umbral_aviso, v_desde_monto
  FROM tenants WHERE id = p_tenant_id;
  IF v_modo IS NULL THEN RETURN; END IF;

  FOR rec IN
    SELECT p.id, p.nombre, p.precio_venta, p.precio_costo, p.margen_objetivo, p.alicuota_iva
    FROM productos p
    WHERE p.tenant_id = p_tenant_id AND p.activo = true
      AND p.reajuste_margen_auto = true AND p.margen_objetivo IS NOT NULL AND p.precio_costo IS NOT NULL
      AND p.precio_venta IS NOT NULL
  LOOP
    v_sugerido := fn_precio_para_margen(rec.precio_costo, rec.margen_objetivo, rec.alicuota_iva);
    IF v_sugerido IS NULL OR v_sugerido = rec.precio_venta THEN CONTINUE; END IF;

    -- Todo-o-nada por producto: si ya hay una sugerencia pendiente de aprobar para este producto, no
    -- duplicar en cada corrida del sweep (cada 6hs) — se resuelve la que ya existe primero.
    IF EXISTS (
      SELECT 1 FROM autorizaciones
      WHERE tenant_id = p_tenant_id AND tipo = 'repricing_margen' AND estado = 'pendiente'
        AND (datos_cambio->>'producto_id')::uuid = rec.id
    ) THEN CONTINUE; END IF;

    v_diferencia := abs(v_sugerido - rec.precio_venta);

    v_aplicar_directo := (v_modo = 'automatico')
      OR (v_modo = 'automatico_desde_monto' AND v_diferencia >= COALESCE(v_desde_monto, 0));

    IF v_aplicar_directo THEN
      -- B5: tope de suba — el ajuste automático nunca mueve el precio más de X% de una sola vez.
      v_final := v_sugerido;
      IF v_tope_pct IS NOT NULL THEN
        v_maximo_variacion := rec.precio_venta * v_tope_pct / 100;
        IF v_final > rec.precio_venta + v_maximo_variacion THEN v_final := rec.precio_venta + v_maximo_variacion; END IF;
        IF v_final < rec.precio_venta - v_maximo_variacion THEN v_final := rec.precio_venta - v_maximo_variacion; END IF;
        v_final := ROUND(v_final, 2);
      END IF;
      IF v_final = rec.precio_venta THEN CONTINUE; END IF;

      UPDATE productos SET precio_venta = v_final WHERE id = rec.id;

      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      SELECT p_tenant_id, u.id, 'repricing_aplicado',
             'Precio ajustado automáticamente por margen objetivo',
             rec.nombre || ': $' || rec.precio_venta || ' → $' || v_final || ' (margen objetivo ' || rec.margen_objetivo || '%).',
             '/productos/' || rec.id || '/editar'
      FROM users u WHERE u.tenant_id = p_tenant_id AND u.rol IN ('DUEÑO','SUPERVISOR','SUPER_USUARIO') AND u.activo = true;

      producto_id := rec.id; accion := 'aplicado'; precio_anterior := rec.precio_venta; precio_nuevo := v_final;
      RETURN NEXT;
    ELSE
      INSERT INTO autorizaciones (tenant_id, modulo, tipo, datos_cambio, estado, solicitado_por, notas)
      VALUES (p_tenant_id, 'productos', 'repricing_margen',
              jsonb_build_object('producto_id', rec.id, 'producto_nombre', rec.nombre,
                                  'precio_anterior', rec.precio_venta, 'precio_nuevo', v_sugerido,
                                  'margen_objetivo', rec.margen_objetivo),
              'pendiente', NULL,
              'Sugerido por el sweep de repricing automático (margen objetivo)');

      IF v_diferencia >= COALESCE(v_umbral_aviso, 0) THEN
        INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
        SELECT p_tenant_id, u.id, 'repricing_sugerido',
               'Sugerencia de ajuste de precio por margen objetivo',
               rec.nombre || ': $' || rec.precio_venta || ' → $' || v_sugerido || ' — requiere tu aprobación.',
               '/productos?tab=autorizaciones'
        FROM users u WHERE u.tenant_id = p_tenant_id AND u.rol IN ('DUEÑO','SUPERVISOR','SUPER_USUARIO') AND u.activo = true;
      END IF;

      producto_id := rec.id; accion := 'pendiente_aprobacion'; precio_anterior := rec.precio_venta; precio_nuevo := v_sugerido;
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$;
