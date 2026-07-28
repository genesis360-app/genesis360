-- ============================================================
-- 289_wms_zonas_tareas_reabastecimiento.sql
-- Módulo WMS: Zonas + reglas de almacenaje + tareas (picking/reabastecimiento/putaway/
-- conteo) + umbrales de reabastecimiento. Fases 3-5 del roadmap acordado con GO
-- 2026-07-19 (ver wiki/features/estructuras-udm.md "Roadmap del plan").
--
-- Decisión de arquitectura (confirmada con GO 2026-07-22): el picking es una capa de
-- LOGÍSTICA PURA — NO cambia cuándo ni cómo se rebaja stock en una venta. El motor de
-- ventas/rebaje (VentasPage.tsx, rebajeSort.ts) sigue exactamente igual. Las tareas de
-- picking solo guían al depósito hacia el LPN que la venta YA decidió consumir
-- (venta_item_despachos si está despachada, venta_items.lpn_plan si es una reserva
-- todavía no despachada). Si ese LPN vive en una ubicación que no es tipo 'picking', se
-- encadena antes una tarea de reabastecimiento que ejecuta la MISMA operación que ya
-- existe hoy en LpnAccionesModal → tab Mover (reduce el LPN origen, crea un LPN nuevo en
-- destino) — no se inventa un mecanismo nuevo de movimiento de stock.
--
-- RLS: zonas/reglas_almacenaje/producto_ubicacion_umbrales son CATÁLOGO/CONFIG — mismo
-- criterio que `ubicaciones` (excluida a propósito de la RLS por sucursal, ver comentario
-- de la mig 217): tenant-only. `wms_tareas` es OPERATIVA (impacta stock real) — sigue el
-- patrón sucursal-scoped de las migs 216-218 (USING con auth_ve_todas_sucursales()/
-- auth_user_sucursal(), WITH CHECK tenant-only para no romper escrituras cross-sucursal).
-- ============================================================

-- ── 1) Zonas — agrupan ubicaciones (catálogo, igual que ubicaciones) ───────────────────

CREATE TABLE IF NOT EXISTS zonas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id  uuid REFERENCES sucursales(id) ON DELETE SET NULL,
  nombre       text NOT NULL,
  descripcion  text,
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sucursal_id, nombre)
);

COMMENT ON TABLE zonas IS
  'Área lógica del depósito que agrupa ubicaciones (ej. "Zona Picking A", "Bulk Norte"). sucursal_id NULL = zona global (mismo criterio que ubicaciones.sucursal_id).';

ALTER TABLE zonas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zonas' AND policyname = 'zonas_tenant') THEN
    CREATE POLICY zonas_tenant ON zonas FOR ALL
      USING (tenant_id = get_user_tenant_id())
      WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

REVOKE ALL ON zonas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON zonas TO authenticated;
GRANT ALL ON zonas TO service_role;

-- ── 2) ubicaciones.zona_id — cada ubicación pertenece opcionalmente a una zona ─────────

ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS zona_id uuid REFERENCES zonas(id) ON DELETE SET NULL;

COMMENT ON COLUMN ubicaciones.zona_id IS
  'Zona a la que pertenece esta ubicación (opcional). Ver tabla zonas.';

-- ── 3) Reglas de almacenaje — UdM → zona sugerida (sugerencia editable, NUNCA bloquea) ─

CREATE TABLE IF NOT EXISTS reglas_almacenaje (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unidad_medida_id  uuid NOT NULL REFERENCES unidades_medida(id) ON DELETE CASCADE,
  zona_id           uuid NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, unidad_medida_id)
);

COMMENT ON TABLE reglas_almacenaje IS
  'Sugerencia (no bloqueante) de a qué zona llevar el stock que ingresa en una Unidad de Medida dada (ej. nivel Pallet → Zona Bulk). El usuario puede elegir otra ubicación al ingresar; esto solo pre-completa el selector.';

ALTER TABLE reglas_almacenaje ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reglas_almacenaje' AND policyname = 'reglas_almacenaje_tenant') THEN
    CREATE POLICY reglas_almacenaje_tenant ON reglas_almacenaje FOR ALL
      USING (tenant_id = get_user_tenant_id())
      WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

REVOKE ALL ON reglas_almacenaje FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON reglas_almacenaje TO authenticated;
GRANT ALL ON reglas_almacenaje TO service_role;

-- ── 4) Umbrales de reabastecimiento por producto + ubicación de picking ────────────────

CREATE TABLE IF NOT EXISTS producto_ubicacion_umbrales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id   uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  ubicacion_id  uuid NOT NULL REFERENCES ubicaciones(id) ON DELETE CASCADE,
  stock_minimo  integer NOT NULL CHECK (stock_minimo >= 0),
  stock_maximo  integer CHECK (stock_maximo IS NULL OR stock_maximo >= stock_minimo),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, producto_id, ubicacion_id)
);

COMMENT ON TABLE producto_ubicacion_umbrales IS
  'Mín/máx de stock (unidades base) de un producto en una ubicación de picking, para el reabastecimiento por umbral (tenants.wms_reabastecimiento_umbral). Por debajo de stock_minimo se genera una tarea de reabastecimiento hasta acercarse a stock_maximo.';

ALTER TABLE producto_ubicacion_umbrales ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'producto_ubicacion_umbrales' AND policyname = 'producto_ubicacion_umbrales_tenant') THEN
    CREATE POLICY producto_ubicacion_umbrales_tenant ON producto_ubicacion_umbrales FOR ALL
      USING (tenant_id = get_user_tenant_id())
      WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

REVOKE ALL ON producto_ubicacion_umbrales FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON producto_ubicacion_umbrales TO authenticated;
GRANT ALL ON producto_ubicacion_umbrales TO service_role;

-- ── 5) Flags de reabastecimiento — habilitables por separado (uno, otro, ambos, ninguno)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS wms_reabastecimiento_on_demand boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wms_reabastecimiento_umbral    boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.wms_reabastecimiento_on_demand IS
  'Si está habilitado, al generar tareas de picking que no encuentran stock en la ubicación de picking, se encadena automáticamente una tarea de reabastecimiento desde bulk/reserva.';
COMMENT ON COLUMN tenants.wms_reabastecimiento_umbral IS
  'Si está habilitado, se pueden configurar mín/máx por producto+ubicación (producto_ubicacion_umbrales) que generan tareas de reabastecimiento proactivas (on-demand al abrir la pantalla de tareas — no hay pg_cron).';

-- ── 6) wms_tareas — tabla OPERATIVA, RLS por sucursal (igual que inventario_lineas) ────

CREATE TABLE IF NOT EXISTS wms_tareas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id           uuid REFERENCES sucursales(id) ON DELETE SET NULL,
  tipo                  text NOT NULL CHECK (tipo IN ('picking','replenishment','putaway','conteo')),
  estado                text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','completada','cancelada')),
  prioridad             integer NOT NULL DEFAULT 0,
  producto_id           uuid REFERENCES productos(id) ON DELETE SET NULL,
  cantidad              integer NOT NULL CHECK (cantidad > 0), -- unidades base del producto
  ubicacion_origen_id   uuid REFERENCES ubicaciones(id) ON DELETE SET NULL,
  ubicacion_destino_id  uuid REFERENCES ubicaciones(id) ON DELETE SET NULL,
  lpn_origen            text, -- snapshot del LPN a buscar (igual criterio que venta_item_despachos.lpn)
  origen                text NOT NULL CHECK (origen IN ('envio','manual','umbral')),
  envio_id              uuid REFERENCES envios(id) ON DELETE SET NULL,
  tarea_precedente_id   uuid REFERENCES wms_tareas(id) ON DELETE SET NULL, -- reabastecimiento que debe completarse antes que este picking
  usuario_asignado_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  creado_por            uuid REFERENCES users(id) ON DELETE SET NULL,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

COMMENT ON TABLE wms_tareas IS
  'Tareas de depósito: picking (retirar LPN ya asignado por una venta/envío), replenishment (mover stock bulk→picking), putaway (guardar al recibir) y conteo. Logística pura — no decide qué se vende ni cuándo se rebaja, ver comentario de cabecera de esta migración.';
COMMENT ON COLUMN wms_tareas.cantidad IS 'En unidades BASE del producto (igual criterio que venta_items.cantidad) — la UI la muestra en la UdM más cómoda (ver estructuras.ts).';
COMMENT ON COLUMN wms_tareas.tarea_precedente_id IS 'Si esta es una tarea picking que quedó bloqueada por falta de stock en la ubicación de picking, apunta a la tarea replenishment que hay que completar primero.';

CREATE INDEX IF NOT EXISTS idx_wms_tareas_tenant     ON wms_tareas (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wms_tareas_sucursal    ON wms_tareas (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_wms_tareas_estado      ON wms_tareas (estado);
CREATE INDEX IF NOT EXISTS idx_wms_tareas_envio        ON wms_tareas (envio_id);
CREATE INDEX IF NOT EXISTS idx_wms_tareas_producto     ON wms_tareas (producto_id);

ALTER TABLE wms_tareas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wms_tareas' AND policyname = 'wms_tareas_tenant') THEN
    CREATE POLICY wms_tareas_tenant ON wms_tareas FOR ALL
      USING (
        tenant_id = get_user_tenant_id()
        AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
      )
      WITH CHECK ( tenant_id = get_user_tenant_id() );
  END IF;
END $$;

REVOKE ALL ON wms_tareas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON wms_tareas TO authenticated;
GRANT ALL ON wms_tareas TO service_role;
