-- ============================================================
-- 352_repositores_fase1_nucleo.sql
-- Módulo nuevo "Repositores" (Fase E del backlog Comercial de Fede, 25/7/2026) — Fase 1: núcleo +
-- disparadores automáticos + prioridad. Relevamiento completo en
-- G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md — las 3 ambigüedades de negocio que
-- quedaban (A1 rol custom, A2/B3 acceso default solo Reposición, H1 impresión PDF+Zebra) las cerró
-- GO el 2026-08-11. I3 (¿reusar `wms_tareas.tipo='replenishment'` o tipo nuevo?) se resolvió por
-- investigación de código: NO reusar — queda para una fase posterior (reposición física a góndola),
-- fuera de esta Fase 1.
--
-- Fase 1 = SOLO las tareas de "cambiar el cartel de precio en la góndola": (B1) cambio manual de
-- precio y entrada a un estado con descuento — incluye edición MASIVA de estado, 1 tarea por SKU
-- (dedupe por producto+sucursal+tipo, no por línea/lote) — y (C1-C3) la prioridad automática que
-- definió Fede. NO incluye: reposición física de stock a góndola (D/I3, fase futura), asignación/
-- reasignación vía Pestaña de Supervisor (E2, fase futura — por ahora es una cola compartida sin
-- asignar, mismo punto de partida que tuvo wms_tareas antes de asignación), etiquetas/impresión
-- (G/H), notificaciones (J), reportes (K).
--
-- 🛑 Escritura write-time, nunca heurística de lectura (mismo criterio que actividad_log/mig 155):
-- los triggers generan la tarea EN EL MOMENTO del cambio real (UPDATE de productos.precio_venta o
-- inventario_lineas.estado_id), capturando TODOS los puntos de entrada existentes (edición
-- individual, importador CSV, repricing automático por margen — mig 346/347 — para precio; edición
-- individual con/sin aprobación y edición masiva — InventarioPage bulkCambiarEstado — para estado)
-- sin depender de que cada uno acuerde loguearlo por su cuenta.
-- ============================================================

-- ── 1) Tabla ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tareas_repositor (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id           uuid NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  producto_id           uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tipo                  text NOT NULL CHECK (tipo IN ('cambio_precio', 'cambio_estado')),
  estado                text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','completada','cancelada')),
  precio_anterior       numeric(12,2),
  precio_nuevo          numeric(12,2),
  estado_inventario_id  uuid REFERENCES estados_inventario(id) ON DELETE SET NULL,
  inventario_linea_id   uuid REFERENCES inventario_lineas(id) ON DELETE SET NULL,
  usuario_asignado_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  creado_por            uuid REFERENCES users(id) ON DELETE SET NULL, -- NULL = generada por trigger automático
  motivo_cancelacion    text,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  cancelled_at          timestamptz
);

COMMENT ON TABLE tareas_repositor IS
  'Tareas del módulo Repositores (Fase 1, mig 352): cambiar el cartel de precio en la góndola tras un cambio manual de precio o la entrada a un estado con descuento. Una fila = un producto+sucursal+tipo pendiente (dedupe: cambios repetidos actualizan la fila existente, no duplican).';
COMMENT ON COLUMN tareas_repositor.precio_anterior IS 'El precio que SIGUE impreso en la góndola (el de antes del primer cambio sin atender) — no se pisa en cambios repetidos mientras la tarea sigue pendiente.';
COMMENT ON COLUMN tareas_repositor.creado_por IS 'NULL cuando la generó un trigger automático (caso normal) — solo tiene valor si en una fase futura se permite crear tareas a mano.';

CREATE INDEX IF NOT EXISTS idx_tareas_repositor_tenant   ON tareas_repositor (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tareas_repositor_sucursal ON tareas_repositor (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_tareas_repositor_estado   ON tareas_repositor (estado);

-- Único ADEMÁS de índice: sin esto, dos UPDATEs concurrentes al mismo producto (ej. una edición
-- manual de precio pisando justo al repricing automático) podían no encontrarse una a la otra
-- (patrón viejo: UPDATE...; IF NOT FOUND THEN INSERT) y terminar creando 2 tareas duplicadas para
-- el mismo producto+sucursal+tipo. Con el UNIQUE parcial, el INSERT de los triggers usa
-- `ON CONFLICT ... DO UPDATE` (ver más abajo), que sí es atómico bajo concurrencia.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_repositor_activa
  ON tareas_repositor (producto_id, sucursal_id, tipo) WHERE estado IN ('pendiente','en_curso');

ALTER TABLE tareas_repositor ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tareas_repositor' AND policyname = 'tareas_repositor_tenant') THEN
    CREATE POLICY tareas_repositor_tenant ON tareas_repositor FOR ALL
      USING (
        tenant_id = get_user_tenant_id()
        AND ( auth_ve_todas_sucursales() OR sucursal_id = auth_user_sucursal() )
      )
      WITH CHECK ( tenant_id = get_user_tenant_id() );
  END IF;
END $$;

-- Sin INSERT para authenticated a propósito: las tareas SOLO nacen de los triggers (SECURITY
-- DEFINER, bypassean RLS como el resto de los triggers del proyecto) — un usuario no puede
-- fabricar una tarea a mano en esta fase.
REVOKE ALL ON tareas_repositor FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON tareas_repositor TO authenticated;
GRANT ALL ON tareas_repositor TO service_role;

-- ── 2) Trigger: cambio de precio → tarea "cambiar cartel" en cada sucursal con exhibición ──────
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
    INSERT INTO tareas_repositor (tenant_id, sucursal_id, producto_id, tipo, precio_anterior, precio_nuevo)
    VALUES (NEW.tenant_id, r.sucursal_id, NEW.id, 'cambio_precio', OLD.precio_venta, NEW.precio_venta)
    ON CONFLICT (producto_id, sucursal_id, tipo) WHERE estado IN ('pendiente', 'en_curso')
    DO UPDATE SET precio_nuevo = EXCLUDED.precio_nuevo;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Igual criterio que el resto de los triggers "de conveniencia" del proyecto: la operación
  -- REAL (guardar el precio) no se cae por un problema al generar la tarea de Repositores.
  RAISE WARNING '[fn_generar_tarea_repositor_precio] producto % : %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_productos_precio_genera_tarea_repositor ON productos;
CREATE TRIGGER trg_productos_precio_genera_tarea_repositor
  AFTER UPDATE OF precio_venta ON productos
  FOR EACH ROW EXECUTE FUNCTION public.fn_generar_tarea_repositor_precio();

COMMENT ON FUNCTION public.fn_generar_tarea_repositor_precio() IS
  'Genera/actualiza la tarea de Repositores "cambiar cartel" al cambiar productos.precio_venta, para cada sucursal donde el producto tiene ubicación de exhibición tipo Góndola. Cubre TODOS los puntos de entrada (edición individual, importador, repricing automático) por ser un trigger de DB, no una llamada desde el frontend. Mig 352.';

REVOKE ALL ON FUNCTION fn_generar_tarea_repositor_precio() FROM PUBLIC, anon;

-- ── 3) Trigger: entrada a un estado con descuento → tarea "cambiar cartel" ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_generar_tarea_repositor_estado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_descuento numeric; v_avanzado boolean; v_tiene_exhibicion boolean;
BEGIN
  IF NEW.estado_id IS NOT DISTINCT FROM OLD.estado_id THEN RETURN NEW; END IF;
  IF NEW.estado_id IS NULL OR NEW.sucursal_id IS NULL THEN RETURN NEW; END IF;

  SELECT (modo_operacion = 'avanzado') INTO v_avanzado FROM tenants WHERE id = NEW.tenant_id;
  IF NOT COALESCE(v_avanzado, false) THEN RETURN NEW; END IF;

  SELECT descuento_pct INTO v_descuento FROM estados_inventario WHERE id = NEW.estado_id;
  IF COALESCE(v_descuento, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT true INTO v_tiene_exhibicion
  FROM producto_ubicacion_sucursal pus
  JOIN ubicaciones u ON u.id = pus.ubicacion_exhibicion_id
  WHERE pus.producto_id = NEW.producto_id AND pus.sucursal_id = NEW.sucursal_id AND u.tipo_logico = 'exhibicion';
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO tareas_repositor (tenant_id, sucursal_id, producto_id, tipo, estado_inventario_id, inventario_linea_id)
  VALUES (NEW.tenant_id, NEW.sucursal_id, NEW.producto_id, 'cambio_estado', NEW.estado_id, NEW.id)
  ON CONFLICT (producto_id, sucursal_id, tipo) WHERE estado IN ('pendiente', 'en_curso')
  DO UPDATE SET estado_inventario_id = EXCLUDED.estado_inventario_id, inventario_linea_id = EXCLUDED.inventario_linea_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[fn_generar_tarea_repositor_estado] linea % : %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_inventario_lineas_estado_genera_tarea_repositor ON inventario_lineas;
CREATE TRIGGER trg_inventario_lineas_estado_genera_tarea_repositor
  AFTER UPDATE OF estado_id ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION public.fn_generar_tarea_repositor_estado();

COMMENT ON FUNCTION public.fn_generar_tarea_repositor_estado() IS
  'Genera/actualiza la tarea de Repositores "cambiar cartel" al entrar una línea a un estado con descuento_pct>0, si el producto tiene ubicación de exhibición tipo Góndola en esa sucursal. Trigger de fila en inventario_lineas: cubre por igual el camino directo (LpnAccionesModal), la aprobación con foto (aprobar_cambio_estado_inventario) y la edición MASIVA (InventarioPage bulkCambiarEstado) — dedupe por producto+sucursal da 1 sola tarea por SKU aunque se editen muchas líneas a la vez (B1 del relevamiento). Mig 352.';

REVOKE ALL ON FUNCTION fn_generar_tarea_repositor_estado() FROM PUBLIC, anon;

-- ── 4) Vista de prioridad (C1-C3) — calculada en cada lectura, nunca cacheada ───────────────────
-- Orden que definió Fede: (1) ya se vendió con el cartel desactualizado → máxima; (2) precio NUEVO
-- más alto que el viejo (cobrar de más es peor que cobrar de menos) → alta; (3) cercanía a
-- vencimiento; (4) tiempo pendiente de la tarea (desempate final, más vieja primero). El criterio
-- (1) es la pieza "backend real" que marcaba el relevamiento (C3): cruza el momento en que nació la
-- tarea contra ventas posteriores de ese producto en esa sucursal — se recalcula en cada consulta a
-- propósito (si hoy no vendió nada pero mañana sí, tiene que escalar de prioridad solo).
CREATE OR REPLACE VIEW public.vw_tareas_repositor AS
SELECT
  tr.*,
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
      AND v.created_at > tr.created_at
      AND v.estado NOT IN ('cancelada', 'pendiente')
  ) AS vendido_con_tag_desactualizado,
  (tr.tipo = 'cambio_precio' AND tr.precio_nuevo IS NOT NULL AND tr.precio_anterior IS NOT NULL
   AND tr.precio_nuevo > tr.precio_anterior) AS precio_subio
FROM tareas_repositor tr
JOIN productos p ON p.id = tr.producto_id
LEFT JOIN estados_inventario ei ON ei.id = tr.estado_inventario_id
LEFT JOIN inventario_lineas il ON il.id = tr.inventario_linea_id;

COMMENT ON VIEW public.vw_tareas_repositor IS
  'tareas_repositor + los datos de prioridad C1-C3 calculados en cada lectura (nunca cacheados) — ver comentario arriba. RLS heredada de las tablas base (mismo patrón que el resto de las vistas del proyecto). Mig 352.';
