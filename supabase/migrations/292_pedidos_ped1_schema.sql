-- ============================================================
-- 292_pedidos_ped1_schema.sql
-- Módulo NUEVO "Pedidos" — PED1 (schema + cabecera/líneas + numeración + estados +
-- permisos base). Relevado con GO 2026-07-22 (ver
-- G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md para el detalle completo
-- de cada decisión — acá solo el resumen que fundamenta el DDL).
--
-- Decisión de arquitectura clave (F4, confirmada con GO): Pedidos es un documento
-- separado de Ventas — NUNCA pasa por `registrarVenta()`/el POS. Arma cabecera+líneas,
-- se "lanza" (Fase PED3, RPC nueva `fn_generar_tareas_picking_pedido`, todavía NO en esta
-- migración) generando `wms_tareas`, y recién al prepararse físicamente genera la venta
-- real reusando solo la lógica de rebaje (no la UI del POS). Ventas de mostrador
-- (despachada/reservada) quedan 100% intactas y NUNCA generan tareas WMS (eso deroga en
-- la práctica, sin tocar código, el uso de `fn_generar_tareas_picking_envio` desde Ventas
-- — esa RPC de la mig 290/291 sigue existiendo pero no se le agrega ningún gancho nuevo).
--
-- Sin precio en `pedido_items` (H1, decisión de GO): Pedidos es 100% cantidad/logística,
-- el precio se resuelve una sola vez en el POS cuando el Pedido genera la venta real.
--
-- Alcance de ESTA migración: catálogo `tipos_pedido`, tablas `pedidos`/`pedido_items`,
-- numeración (mismo patrón que `ordenes_compra`/`ventas`), trazabilidad Pedido→Venta
-- (`ventas.pedido_id`, `venta_items.pedido_item_id`) y Pedido→Envío (`envios.pedido_id`),
-- RLS (cabecera por sucursal igual que `wms_tareas`/`ventas`; líneas heredan del padre
-- igual que `venta_items`). NO incluye todavía: RPCs de lanzar/cancelar/un-pick (PED3/PED5),
-- UI (PED2), reportes/alertas (PED8). Aditiva, sin DDL destructivo.
-- ============================================================

-- ── 1) Flags de tenant ──────────────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pedido_numeracion TEXT NOT NULL DEFAULT 'sucursal',
  ADD COLUMN IF NOT EXISTS pedido_transiciones_roles JSONB;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tenants_pedido_numeracion_check' AND table_name = 'tenants') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_pedido_numeracion_check
      CHECK (pedido_numeracion IN ('tenant', 'sucursal'));
  END IF;
END $$;

COMMENT ON COLUMN tenants.pedido_numeracion IS
  'Qué número se muestra como principal en la UI: correlativo por tenant o por sucursal (ambos se calculan siempre, igual patrón que tenants.oc_numeracion, mig 182).';
COMMENT ON COLUMN tenants.pedido_transiciones_roles IS
  'Map estado_destino→roles permitidos (jsonb, igual patrón que ajuste_autorizacion_roles, mig 228). NULL o estado ausente → default en código: DEPOSITO/SUPERVISOR/ADMIN/DUEÑO pueden cualquier transición.';

-- ── 2) tipos_pedido — catálogo configurable por tenant (mismo patrón que canales_venta) ─

CREATE TABLE IF NOT EXISTS tipos_pedido (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre              text NOT NULL,
  factura_momento     text NOT NULL DEFAULT 'al_entregar' CHECK (factura_momento IN ('al_confirmar','al_entregar')),
  cliente_obligatorio boolean NOT NULL DEFAULT true,
  activo              boolean NOT NULL DEFAULT true,
  orden               int,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nombre)
);

COMMENT ON TABLE tipos_pedido IS
  'Catálogo de tipos de Pedido por tenant (Mayorista/E-commerce/Encargo telefónico/Retiro en local, etc.). factura_momento (B1) y cliente_obligatorio (C3) son reglas por tipo.';

ALTER TABLE tipos_pedido ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tipos_pedido' AND policyname = 'tipos_pedido_tenant') THEN
    CREATE POLICY tipos_pedido_tenant ON tipos_pedido FOR ALL
      USING (tenant_id = get_user_tenant_id())
      WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

REVOKE ALL ON tipos_pedido FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON tipos_pedido TO authenticated;
GRANT ALL ON tipos_pedido TO service_role;

-- Seed idempotente (SECURITY DEFINER: el trigger de alta de tenant corre antes de que
-- exista la fila en users, mismo criterio que seed_canales_venta, mig 168/166).
CREATE OR REPLACE FUNCTION seed_tipos_pedido(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tipos_pedido (tenant_id, nombre, factura_momento, cliente_obligatorio, orden) VALUES
    (p_tenant_id, 'Mayorista',           'al_confirmar', true,  10),
    (p_tenant_id, 'E-commerce',          'al_entregar',  true,  20),
    (p_tenant_id, 'Encargo telefónico',  'al_entregar',  false, 30),
    (p_tenant_id, 'Retiro en local',     'al_entregar',  false, 40)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

-- SECURITY DEFINER bypassea RLS a propósito (necesita sembrar antes de que exista la fila
-- en `users` en el alta de un tenant, mig 166) — por eso el EXECUTE se revoca de PUBLIC y
-- se deja implícito solo para el owner/DO block/trigger de esta migración, nunca invocable
-- por un usuario autenticado con un tenant_id ajeno.
REVOKE EXECUTE ON FUNCTION seed_tipos_pedido(uuid) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE t_id uuid; BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP PERFORM seed_tipos_pedido(t_id); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION fn_seed_tipos_pedido_new_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM seed_tipos_pedido(NEW.id); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_seed_tipos_pedido_new_tenant ON tenants;
CREATE TRIGGER trg_seed_tipos_pedido_new_tenant
  AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION fn_seed_tipos_pedido_new_tenant();

-- ── 3) pedidos — cabecera (operativa, RLS por sucursal igual que ventas/wms_tareas) ────

CREATE TABLE IF NOT EXISTS pedidos (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id               uuid REFERENCES sucursales(id) ON DELETE SET NULL,
  numero                    integer NOT NULL,
  numero_sucursal           integer,
  tipo_pedido_id            uuid NOT NULL REFERENCES tipos_pedido(id),
  cliente_id                uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nombre            text,
  cliente_telefono          text,
  estado                    text NOT NULL DEFAULT 'borrador'
                              CHECK (estado IN ('borrador','confirmado','en_preparacion','listo_para_entrega','entregado','entregado_parcial','cancelado')),
  fecha_entrega_solicitada  date,
  requiere_envio            boolean NOT NULL DEFAULT false,
  notas                     text,
  creado_por                uuid REFERENCES users(id) ON DELETE SET NULL,
  lanzado_por               uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmado_at             timestamptz,
  lanzado_at                timestamptz,
  entregado_at              timestamptz,
  cancelado_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE pedidos IS
  'Documento de pedido (logística, no mostrador) — cabecera. Separado de ventas: nunca pasa por registrarVenta(). Ver relevamiento_pedidos_respuestas.md.';
COMMENT ON COLUMN pedidos.estado IS
  'borrador→confirmado→en_preparacion→listo_para_entrega→entregado(_parcial)→cancelado (E1). entregado_parcial se usa desde PED4 (cumplimiento parcial).';
COMMENT ON COLUMN pedidos.lanzado_por IS
  'Quién ejecutó "lanzar" (generó las tareas WMS) — junto con creado_por, define quién puede cancelar/editar (J4: autor de la acción + SUPERVISOR/ADMIN/DUEÑO siempre).';
COMMENT ON COLUMN pedidos.requiere_envio IS
  'F2: si true, al lanzar (PED3) se auto-crea un envío vinculado a este pedido (envios.pedido_id). Si false, el módulo Envíos no se toca — retiro en local.';

CREATE INDEX IF NOT EXISTS idx_pedidos_tenant    ON pedidos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_sucursal   ON pedidos (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado     ON pedidos (estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente    ON pedidos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_tipo       ON pedidos (tipo_pedido_id);

ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pedidos' AND policyname = 'pedidos_tenant') THEN
    CREATE POLICY pedidos_tenant ON pedidos FOR ALL
      USING (
        tenant_id = get_user_tenant_id()
        AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
      )
      WITH CHECK ( tenant_id = get_user_tenant_id() );
  END IF;
END $$;

REVOKE ALL ON pedidos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON pedidos TO authenticated;
GRANT ALL ON pedidos TO service_role;

-- Numeración: mismo patrón que ventas/OC — numero (tenant-wide) + numero_sucursal
-- (correlativo por sucursal), ambos siempre calculados; tenants.pedido_numeracion solo
-- decide cuál muestra la UI como principal (no cambia el cálculo).
-- SECURITY DEFINER es obligatorio acá (no cosmético): pedidos tiene RLS por sucursal
-- (USING ... sucursal_id = auth_user_sucursal()), así que un trigger SECURITY INVOKER
-- calcularía MAX(numero) solo sobre las filas visibles para el usuario (su sucursal),
-- no sobre todo el tenant — el correlativo tenant-wide quedaría mal calculado/duplicado
-- para usuarios sin auth_ve_todas_sucursales(). Mismo criterio que gen_venta_numero()
-- (mig 006) — bug real ya presente hoy en set_oc_numero()/ordenes_compra (mig 182, sin
-- SECURITY DEFINER) que NO se replica acá.
CREATE OR REPLACE FUNCTION set_pedido_numero()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM pedidos WHERE tenant_id = NEW.tenant_id;
  END IF;
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
      FROM pedidos WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_pedido_numero ON pedidos;
CREATE TRIGGER trg_set_pedido_numero
  BEFORE INSERT ON pedidos
  FOR EACH ROW EXECUTE FUNCTION set_pedido_numero();

-- ── 4) pedido_items — líneas (heredan RLS del padre, igual que venta_items) ────────────

CREATE TABLE IF NOT EXISTS pedido_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pedido_id           uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id         uuid NOT NULL REFERENCES productos(id),
  cantidad            numeric(14,4) NOT NULL CHECK (cantidad > 0),
  cantidad_entregada  numeric(14,4) NOT NULL DEFAULT 0,
  estado              text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','en_preparacion','preparado','faltante','cancelada')),
  estado_id           uuid REFERENCES estados_inventario(id) ON DELETE SET NULL,
  talle               text,
  color                text,
  encaje              text,
  formato             text,
  sabor_aroma         text,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE pedido_items IS
  'Líneas de un Pedido — SIN precio (H1: el precio lo resuelve el POS cuando el Pedido genera la venta real). cantidad en unidades base, igual criterio que venta_items/wms_tareas.';
COMMENT ON COLUMN pedido_items.estado_id IS
  'Estado de inventario (Config/Inventario/Estados) del que hay que pickear esta línea — hallazgo L2-1 del relevamiento (respeta FIFO/FEFO). Opcional: NULL = criterio estándar.';
COMMENT ON COLUMN pedido_items.cantidad_entregada IS
  'Cumplimiento parcial (G1-G3): cuánto de esta línea ya se entregó. cantidad − cantidad_entregada = pendiente. Se usa desde PED4.';

CREATE INDEX IF NOT EXISTS idx_pedido_items_pedido    ON pedido_items (pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_items_producto   ON pedido_items (producto_id);
CREATE INDEX IF NOT EXISTS idx_pedido_items_estado     ON pedido_items (estado);

ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pedido_items' AND policyname = 'pedido_items_tenant') THEN
    CREATE POLICY pedido_items_tenant ON pedido_items FOR ALL
      USING ( tenant_id = get_user_tenant_id()
        AND ( auth_ve_todas_sucursales()
              OR EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_items.pedido_id
                         AND ( p.sucursal_id IS NULL OR p.sucursal_id = auth_user_sucursal() )) ) )
      WITH CHECK ( tenant_id = get_user_tenant_id() );
  END IF;
END $$;

REVOKE ALL ON pedido_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON pedido_items TO authenticated;
GRANT ALL ON pedido_items TO service_role;

-- ── 5) Trazabilidad Pedido → Venta (A4) y Pedido → Envío (F2) ──────────────────────────

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS pedido_id uuid REFERENCES pedidos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ventas_pedido ON ventas (pedido_id);
COMMENT ON COLUMN ventas.pedido_id IS
  'Si esta venta se generó desde un Pedido (A1/A4). Un Pedido puede generar N ventas si hay entregas parciales (G2).';

ALTER TABLE venta_items
  ADD COLUMN IF NOT EXISTS pedido_item_id uuid REFERENCES pedido_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_venta_items_pedido_item ON venta_items (pedido_item_id);
COMMENT ON COLUMN venta_items.pedido_item_id IS
  'Línea de Pedido de la que nació este ítem de venta (A4), para trazabilidad fina cuando un Pedido se entrega en varias tandas/ventas.';

ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS pedido_id uuid REFERENCES pedidos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_envios_pedido ON envios (pedido_id);
COMMENT ON COLUMN envios.pedido_id IS
  'F2: envío auto-creado al lanzar un Pedido con requiere_envio=true, ANTES de que exista la venta real (envios.venta_id se completa recién cuando el Pedido factura). Coexiste con venta_id.';
