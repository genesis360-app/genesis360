-- 427 — Mercado Libre y Tienda Nube: la cola de sincronización y los vínculos de publicaciones dejan de ser
--       escribibles por cualquier usuario del negocio
--
-- Decisión de GO (2026-09-15): cerrarlo. Hasta acá:
--   · `integration_job_queue` (la cola que leen `meli-stock-worker` y `tn-stock-worker`) tenía una policy FOR ALL con
--     solo el filtro de negocio y todos los privilegios de tabla para `anon` y `authenticated`. Cualquier usuario del
--     negocio (un CAJERO, por REST) podía encolar un job con cualquier `meli_item_id`/`tn_product_id`, y el worker lo
--     publica tal cual: el stock o el precio de un producto terminaba en otra publicación de la misma cuenta.
--   · `inventario_meli_map` e `inventario_tn_map` (qué producto va con qué publicación) tenían la misma policy: aun sin
--     tocar la cola, reescribir un vínculo manda el próximo cambio de precio o de stock a la publicación equivocada.
--   · Config → Conectividad (ownerOnly) arma los vínculos, y "Forzar sync de stock" insertaba los jobs desde el
--     navegador.
--
-- Cambios:
--   1) `fn_enqueue_sync_precio` (trigger de `productos`) pasa a SECURITY DEFINER: corría con los permisos de quien
--      guardaba el producto, así que sin el INSERT directo en la cola un cambio de precio de un producto vinculado
--      fallaría. Las otras funciones que encolan (`fn_enqueue_meli_stock_sync`, `fn_enqueue_tn_stock_sync`,
--      `fn_enqueue_tn_fulfillment_sync`, `fn_tn_sync_heartbeat`) ya lo eran.
--   2) `fn_forzar_sync_stock(p_integracion)`: el servidor arma los jobs desde los vínculos del negocio (no desde lo que
--      manda el navegador), solo para quien puede editar Configuración, y sin duplicar un job que ya está en curso.
--   3) Cola: `anon` sin nada; `authenticated` solo lee la de su negocio.
--   4) Vínculos: los leen todos los del negocio; escribe quien puede editar Configuración (DUEÑO, SUPER_USUARIO, ADMIN
--      o rol custom con ese permiso) — el mismo criterio que ya tenían las credenciales de ML/TN.
-- Los workers, los webhooks y los callbacks de OAuth usan service_role: no cambian.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) El trigger de precio encola con permisos propios (fuente real de DEV = PROD, md5 d56927eb…)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_enqueue_sync_precio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.fn_enqueue_sync_precio() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) "Forzar sync de stock" (Config → Conectividad)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_forzar_sync_stock(p_integracion text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.get_user_tenant_id();
  v_n      integer := 0;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.auth_puede_editar_modulo('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede sincronizar las integraciones.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_integracion = 'MercadoLibre' THEN
    INSERT INTO public.integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, status, next_attempt_at)
    SELECT m.tenant_id, NULL, 'MercadoLibre', 'sync_stock',
           jsonb_build_object('producto_id', m.producto_id, 'meli_item_id', m.meli_item_id,
                              'meli_variation_id', m.meli_variation_id),
           'pending', now()
      FROM public.inventario_meli_map m
     WHERE m.tenant_id = v_tenant
       AND m.sync_stock = true
       -- Un job por publicación: si ya hay uno en curso, no se agrega otro.
       AND NOT EXISTS (
         SELECT 1 FROM public.integration_job_queue q
          WHERE q.tenant_id = v_tenant AND q.integracion = 'MercadoLibre' AND q.tipo = 'sync_stock'
            AND q.status IN ('pending', 'processing')
            AND q.payload->>'producto_id' = m.producto_id::text
            AND q.payload->>'meli_item_id' = m.meli_item_id::text
            AND coalesce(q.payload->>'meli_variation_id', '') = coalesce(m.meli_variation_id::text, ''))
     -- Tope por llamada (migration-reviewer): un catálogo grande no le tira una ráfaga de golpe al worker; el resto
     -- entra en el próximo "Forzar sync" gracias al dedupe.
     LIMIT 500;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_integracion = 'TiendaNube' THEN
    INSERT INTO public.integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, status, next_attempt_at)
    SELECT m.tenant_id, m.sucursal_id, 'TiendaNube', 'sync_stock',
           jsonb_build_object('producto_id', m.producto_id, 'tn_product_id', m.tn_product_id,
                              'tn_variant_id', m.tn_variant_id),
           'pending', now()
      FROM public.inventario_tn_map m
     WHERE m.tenant_id = v_tenant
       AND m.sync_stock = true
       AND NOT EXISTS (
         SELECT 1 FROM public.integration_job_queue q
          WHERE q.tenant_id = v_tenant AND q.integracion = 'TiendaNube' AND q.tipo = 'sync_stock'
            AND q.status IN ('pending', 'processing')
            AND q.payload->>'producto_id' = m.producto_id::text
            AND q.payload->>'tn_product_id' = m.tn_product_id::text
            AND coalesce(q.payload->>'tn_variant_id', '') = coalesce(m.tn_variant_id::text, ''))
     LIMIT 500;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Integración inválida.';
  END IF;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_forzar_sync_stock(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_forzar_sync_stock(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) La cola: solo lectura para los usuarios del negocio
-- ─────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.integration_job_queue FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.integration_job_queue FROM authenticated;
GRANT SELECT ON public.integration_job_queue TO authenticated;

DROP POLICY IF EXISTS job_queue_tenant ON public.integration_job_queue;
DROP POLICY IF EXISTS job_queue_select ON public.integration_job_queue;
CREATE POLICY job_queue_select ON public.integration_job_queue FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Vínculos producto ↔ publicación: escribe quien puede editar Configuración
-- ─────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.inventario_meli_map FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.inventario_meli_map FROM authenticated;

DROP POLICY IF EXISTS meli_map_tenant ON public.inventario_meli_map;
DROP POLICY IF EXISTS meli_map_select ON public.inventario_meli_map;
DROP POLICY IF EXISTS meli_map_write_configuracion ON public.inventario_meli_map;
CREATE POLICY meli_map_select ON public.inventario_meli_map FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY meli_map_write_configuracion ON public.inventario_meli_map FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('configuracion'))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('configuracion'));

REVOKE ALL ON public.inventario_tn_map FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.inventario_tn_map FROM authenticated;

DROP POLICY IF EXISTS tn_map_tenant ON public.inventario_tn_map;
DROP POLICY IF EXISTS tn_map_select ON public.inventario_tn_map;
DROP POLICY IF EXISTS tn_map_write_configuracion ON public.inventario_tn_map;
CREATE POLICY tn_map_select ON public.inventario_tn_map FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY tn_map_write_configuracion ON public.inventario_tn_map FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('configuracion'))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('configuracion'));
