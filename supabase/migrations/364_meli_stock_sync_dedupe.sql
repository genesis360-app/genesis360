-- ============================================================
-- 364_meli_stock_sync_dedupe.sql
-- Auditoría de performance/calidad (2026-08-14), ítem #4 del top 5 backend — igualar
-- `fn_enqueue_meli_stock_sync` a su gemelo `fn_enqueue_tn_stock_sync`, que ya está bien hecho.
--
-- Dos gaps reales encontrados comparando ambas funciones/triggers:
-- 1. `trg_meli_stock_sync` es `AFTER INSERT OR DELETE OR UPDATE` SIN acotar columnas — dispara
--    en CUALQUIER update de `inventario_lineas` (mover de ubicación, cambiar una nota, etc.),
--    no solo cambios que afecten el stock disponible real. `trg_tn_stock_sync` sí está acotado
--    (`UPDATE OF cantidad, cantidad_reservada, activo, producto_id`).
-- 2. `fn_enqueue_meli_stock_sync` intenta dedupe con `ON CONFLICT DO NOTHING`, pero
--    `integration_job_queue` no tiene ningún constraint UNIQUE que lo respalde — nunca
--    conflictúa, así que nunca dedupea de verdad. `fn_enqueue_tn_stock_sync` dedupea de verdad
--    con un `NOT EXISTS` contra jobs `pending` ya encolados para el mismo producto.
--
-- Consecuencia real en tenants con integración MELI activa y alto movimiento de líneas: una
-- ráfaga de cambios sobre la misma línea (sin relación con stock real) encola N jobs
-- redundantes, y el worker termina llamando N veces a la API de MercadoLibre para lo mismo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_enqueue_meli_stock_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id   uuid;
  v_ids         uuid[];
  v_producto_id uuid;
BEGIN
  v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  IF v_tenant_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_ids := ARRAY[COALESCE(NEW.producto_id, OLD.producto_id)];
  IF TG_OP = 'UPDATE' AND OLD.producto_id IS DISTINCT FROM NEW.producto_id
     AND OLD.producto_id IS NOT NULL THEN
    v_ids := v_ids || OLD.producto_id;
  END IF;

  FOREACH v_producto_id IN ARRAY v_ids LOOP
    CONTINUE WHEN v_producto_id IS NULL;
    -- Dedupe real (antes era `ON CONFLICT DO NOTHING` sin constraint UNIQUE detrás — nunca
    -- conflictuaba). Mismo criterio que fn_enqueue_tn_stock_sync.
    INSERT INTO integration_job_queue (tenant_id, integracion, tipo, payload, status, next_attempt_at)
    SELECT v_tenant_id, 'MercadoLibre', 'sync_stock',
           jsonb_build_object('producto_id', v_producto_id, 'meli_item_id', meli_item_id, 'meli_variation_id', meli_variation_id),
           'pending', NOW()
    FROM inventario_meli_map
    WHERE tenant_id = v_tenant_id AND producto_id = v_producto_id AND sync_stock = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM integration_job_queue q
        WHERE q.tenant_id   = v_tenant_id
          AND q.integracion = 'MercadoLibre'
          AND q.tipo        = 'sync_stock'
          AND q.status      = 'pending'
          AND q.payload->>'producto_id' = v_producto_id::text
      );
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_meli_stock_sync ON public.inventario_lineas;
CREATE TRIGGER trg_meli_stock_sync
  AFTER INSERT OR DELETE OR UPDATE OF cantidad, cantidad_reservada, activo, producto_id
  ON public.inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION public.fn_enqueue_meli_stock_sync();
