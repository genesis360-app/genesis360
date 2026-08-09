-- 346_repricing_margen_meli_d3.sql
-- D3 — Repricing automático MELI/TN (relevamiento_ml_tn_combos_repricing_respuestas.md, Bloque 2).
-- Dos mecanismos INDEPENDIENTES definidos por Fede:
--   Mecanismo 1 (B1-B2-B3-B4-B5-B6): ajuste automático por margen objetivo, opt-in por producto
--   (`reajuste_margen_auto`). Si se activa, el ajuste es ÚNICO — toca `productos.precio_venta` (el
--   precio base), igual en Genesis360 y en TODOS los marketplaces — NUNCA un precio por canal.
--   Configurable por tenant: automático siempre / alerta para aprobar / automático desde X$ (B2),
--   con tope de suba y umbral de aviso (B5). El precio base SIEMPRE manda (B3): esto NUNCA se dispara
--   al revés (un cambio en MELI/TN nunca toca `precio_venta`).
--   Mecanismo 2 (independiente del 1): ajuste por diferencial % PROPIO por canal
--   (`precio_ajuste_meli_pct` / `precio_ajuste_tn_pct`) — el precio PUBLICADO en cada canal se deriva
--   del precio base + ese %, sin tocar `precio_venta`. Amortigua la comisión de cada canal.
-- La comisión de MELI (B4) se proyecta informativamente desde la última venta real de ese SKU —
-- NUNCA es un dato certero para calcular un precio (fn_ultima_comision_meli, de solo lectura).

-- ── 1) productos: interruptor del mecanismo 1 (B6) + los 2 campos del mecanismo 2 ──────────────────
ALTER TABLE productos ADD COLUMN IF NOT EXISTS reajuste_margen_auto BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN productos.reajuste_margen_auto IS
  'D3, mecanismo 1 (B6): opt-in por producto en la ficha. Si true, el sweep de repricing puede ajustar precio_venta para volver al margen_objetivo (según tenants.repricing_modo) — el mismo precio para TODOS los canales, nunca un ajuste por canal.';

ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_ajuste_meli_pct NUMERIC(5,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_ajuste_tn_pct NUMERIC(5,2);
COMMENT ON COLUMN productos.precio_ajuste_meli_pct IS
  'D3, mecanismo 2: % de diferencia respecto a precio_venta para el precio PUBLICADO en MercadoLibre (positivo = más caro que el precio base, negativo = más barato). NULL = publica el precio base tal cual. Independiente del mecanismo 1 — nunca toca precio_venta.';
COMMENT ON COLUMN productos.precio_ajuste_tn_pct IS
  'D3, mecanismo 2: mismo criterio que precio_ajuste_meli_pct, para el precio PUBLICADO en TiendaNube.';

-- ── 2) tenants: config del mecanismo 1 (B2 + B5), en Config → Mercado Libre / TiendaNube ────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS repricing_modo TEXT NOT NULL DEFAULT 'alerta'
  CHECK (repricing_modo IN ('automatico', 'alerta', 'automatico_desde_monto'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS repricing_automatico_desde_monto NUMERIC(12,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS repricing_tope_pct NUMERIC(5,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS repricing_umbral_aviso_monto NUMERIC(12,2);
COMMENT ON COLUMN tenants.repricing_modo IS
  'D3 (B2): cómo se aplica el ajuste del mecanismo 1 (margen objetivo). automatico = siempre directo; alerta = siempre pide aprobación (autorizaciones_inventario); automatico_desde_monto = directo si la diferencia >= repricing_automatico_desde_monto, si no pide aprobación.';
COMMENT ON COLUMN tenants.repricing_tope_pct IS
  'D3 (B5): tope de suba por ajuste automático — el sweep nunca mueve precio_venta más de este % de una sola vez, sin default único (NULL = sin tope).';
COMMENT ON COLUMN tenants.repricing_umbral_aviso_monto IS
  'D3 (B5): en modo alerta/automatico_desde_monto, solo se notifica a DUEÑO/SUPERVISOR si la diferencia en $ alcanza este umbral (NULL = siempre notifica).';

-- ── 3) autorizaciones_inventario: nuevo tipo 'repricing_margen' (reusa la pantalla existente, ────────
--    mismo patrón que 'kit_precio' de la mig 343 — sin linea_id, detalle en datos_cambio) ───────────
ALTER TABLE public.autorizaciones_inventario DROP CONSTRAINT IF EXISTS autorizaciones_inventario_tipo_check;
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_tipo_check
  CHECK (tipo = ANY (ARRAY['ajuste_cantidad'::text, 'eliminar_serie'::text, 'eliminar_lpn'::text, 'bulk_edit'::text, 'ajuste_conteo'::text, 'cambio_estado'::text, 'kit_precio'::text, 'repricing_margen'::text]));

-- ── 4) fn_precio_para_margen — fórmula única, reusable (hoy vive duplicada en JSX en ────────────────
--    ProductoFormPage.tsx y MetricasPage.tsx). Pura, sin acceso a tablas.
CREATE OR REPLACE FUNCTION public.fn_precio_para_margen(p_costo numeric, p_margen_objetivo numeric, p_alicuota_iva numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_costo IS NULL OR p_margen_objetivo IS NULL THEN NULL
    ELSE ROUND(p_costo * (1 + p_margen_objetivo / 100) * (1 + COALESCE(p_alicuota_iva, 0) / 100), 2)
  END
$$;

COMMENT ON FUNCTION public.fn_precio_para_margen(numeric, numeric, numeric) IS
  'D3 — precio de venta (con IVA) necesario para lograr p_margen_objetivo de margen sobre p_costo. Misma fórmula que ya usan ProductoFormPage.tsx y MetricasPage.tsx en JSX — esta es la versión SQL reusable desde el sweep de repricing.';

REVOKE ALL ON FUNCTION public.fn_precio_para_margen(numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_precio_para_margen(numeric, numeric, numeric) TO authenticated, service_role;

-- ── 5) fn_evaluar_repricing_margen — el sweep, mecanismo 1. Sin auth.uid(): recibe p_tenant_id ──────
--    explícito, pensada para invocarse con service_role desde un Edge Function con cron (GH Actions,
--    mismo molde que cron-sweeps/meli-stock-worker — no hay pg_cron habilitado).
CREATE OR REPLACE FUNCTION public.fn_evaluar_repricing_margen(p_tenant_id uuid)
RETURNS TABLE (producto_id uuid, accion text, precio_anterior numeric, precio_nuevo numeric)
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
      SELECT 1 FROM autorizaciones_inventario
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
      INSERT INTO autorizaciones_inventario (tenant_id, tipo, datos_cambio, estado, solicitado_por, notas)
      VALUES (p_tenant_id, 'repricing_margen',
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
               '/inventario?tab=autorizaciones'
        FROM users u WHERE u.tenant_id = p_tenant_id AND u.rol IN ('DUEÑO','SUPERVISOR','SUPER_USUARIO') AND u.activo = true;
      END IF;

      producto_id := rec.id; accion := 'pendiente_aprobacion'; precio_anterior := rec.precio_venta; precio_nuevo := v_sugerido;
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$;

COMMENT ON FUNCTION public.fn_evaluar_repricing_margen(uuid) IS
  'D3, mecanismo 1 — sweep de repricing por margen objetivo. Sin auth.uid(): p_tenant_id explícito, invocable con service_role desde un Edge Function con cron. NO otorgar a authenticated (mismo razonamiento que fn_iniciar_armado_kit_auto, mig 345): un tenant_id arbitrario sería cross-tenant si alguna tabla no tuviera RLS bien puesta.';

REVOKE ALL ON FUNCTION public.fn_evaluar_repricing_margen(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_evaluar_repricing_margen(uuid) TO service_role;

-- ── 6) fn_ultima_comision_meli — B4, informativo, NUNCA usar para calcular un precio ────────────────
CREATE OR REPLACE FUNCTION public.fn_ultima_comision_meli(p_producto_id uuid)
RETURNS TABLE (comision_marketplace numeric, precio_unitario numeric, fecha timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT vi.comision_marketplace, vi.precio_unitario, v.created_at
  FROM venta_items vi
  JOIN ventas v ON v.id = vi.venta_id
  WHERE vi.producto_id = p_producto_id AND v.origen = 'MELI' AND vi.comision_marketplace IS NOT NULL
  ORDER BY v.created_at DESC
  LIMIT 1
$$;

COMMENT ON FUNCTION public.fn_ultima_comision_meli(uuid) IS
  'D3 (B4) — proyecta la comisión de MELI a modo INFORMATIVO desde la venta real más reciente de ese SKU. Nunca usar este valor como dato certero para fijar un precio (la comisión real y definitiva solo se conoce después de concretada cada venta puntual).';

REVOKE ALL ON FUNCTION public.fn_ultima_comision_meli(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ultima_comision_meli(uuid) TO authenticated, service_role;

-- ── 7) Trigger: encolar sync_precio — SOLO para productos que participan de D3 ─────────────────────
--    (`reajuste_margen_auto=true` o alguno de los 2 % de ajuste seteado). `inventario_meli_map.
--    sync_precio` viene DEFAULT true desde la mig 065 y hoy ya hay productos reales (incluso en DEV,
--    con una cuenta de MercadoLibre real conectada) con ese flag prendido sin que nadie lo haya
--    pedido explícitamente — el checkbox "Sync precio" de Config nunca tuvo nada que lo disparara
--    (dormido). Si este trigger reaccionara a CUALQUIER cambio de precio, "despertaría" ese checkbox
--    para TODO producto ya mapeado, no solo para los que entran a D3 — efecto colateral fuera de
--    alcance y no verificable en este entorno (empujaría precio real a una cuenta ML real conectada).
--    Por eso el gate: solo dispara si el producto tiene algo de D3 configurado.
CREATE OR REPLACE FUNCTION public.fn_enqueue_sync_precio() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.reajuste_margen_auto = false AND NEW.precio_ajuste_meli_pct IS NULL AND NEW.precio_ajuste_tn_pct IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.precio_venta IS DISTINCT FROM OLD.precio_venta) OR (NEW.precio_ajuste_meli_pct IS DISTINCT FROM OLD.precio_ajuste_meli_pct) THEN
    INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, status)
    SELECT m.tenant_id, NULL, 'MercadoLibre', 'sync_precio',
           jsonb_build_object('producto_id', NEW.id, 'meli_item_id', m.meli_item_id, 'meli_variation_id', m.meli_variation_id),
           'pending'
    FROM inventario_meli_map m WHERE m.producto_id = NEW.id AND m.sync_precio = true;
  END IF;

  IF (NEW.precio_venta IS DISTINCT FROM OLD.precio_venta) OR (NEW.precio_ajuste_tn_pct IS DISTINCT FROM OLD.precio_ajuste_tn_pct) THEN
    INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, status)
    SELECT m.tenant_id, m.sucursal_id, 'TiendaNube', 'sync_precio',
           jsonb_build_object('producto_id', NEW.id, 'tn_product_id', m.tn_product_id, 'tn_variant_id', m.tn_variant_id),
           'pending'
    FROM inventario_tn_map m WHERE m.producto_id = NEW.id AND m.sync_precio = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_sync_precio ON productos;
CREATE TRIGGER trg_enqueue_sync_precio
  AFTER UPDATE OF precio_venta, precio_ajuste_meli_pct, precio_ajuste_tn_pct ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_sync_precio();

COMMENT ON FUNCTION public.fn_enqueue_sync_precio() IS
  'D3 — dispara sync_precio hacia MELI/TN cuando cambia el precio base o el % de ajuste por canal de un producto mapeado con sync_precio=true. meli-stock-worker ya sabía procesar sync_precio (dormido, sin nada que lo disparara); tn-stock-worker se extiende en el mismo commit de código (fuera de esta migración) para soportarlo por primera vez.';
