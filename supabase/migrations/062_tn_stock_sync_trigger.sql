-- ─── Migration 062: Trigger sync de stock → TiendaNube ────────────────────────
-- Cuando cambia cantidad/activo en inventario_lineas y el producto está mapeado
-- en inventario_tn_map (sync_stock=true), encola un job en integration_job_queue.
-- El worker EF tn-stock-worker procesa la cola y actualiza el stock en TN.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_enqueue_tn_stock_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_producto_id UUID;
  v_tenant_id   UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_producto_id := OLD.producto_id;
    v_tenant_id   := OLD.tenant_id;
  ELSE
    v_producto_id := NEW.producto_id;
    v_tenant_id   := NEW.tenant_id;
  END IF;

  -- Insertar job para cada mapeo activo del producto (sync_stock=true)
  -- Si ya hay un job pendiente para este producto, no duplicar
  INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, next_attempt_at)
  SELECT
    itm.tenant_id,
    itm.sucursal_id,
    'TiendaNube',
    'sync_stock',
    jsonb_build_object(
      'producto_id',   v_producto_id::text,
      'tn_product_id', itm.tn_product_id,
      'tn_variant_id', itm.tn_variant_id
    ),
    NOW()
  FROM inventario_tn_map itm
  WHERE itm.producto_id = v_producto_id
    AND itm.tenant_id   = v_tenant_id
    AND itm.sync_stock  = true
    AND NOT EXISTS (
      SELECT 1 FROM integration_job_queue q
      WHERE q.tenant_id   = itm.tenant_id
        AND q.integracion  = 'TiendaNube'
        AND q.tipo         = 'sync_stock'
        AND q.status       = 'pending'
        AND q.payload->>'producto_id' = v_producto_id::text
    );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_tn_stock_sync ON inventario_lineas;
CREATE TRIGGER trg_tn_stock_sync
  AFTER INSERT OR UPDATE OF cantidad, cantidad_reservada, activo OR DELETE
  ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_tn_stock_sync();
