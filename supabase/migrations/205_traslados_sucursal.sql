-- Migration 205: Traslados de stock entre sucursales (auditoría de procesos 2026-06-11, ítem #4)
--
-- Hasta ahora NO existía forma formal de mover stock entre sucursales: el envío
-- `traslado_interno` (EN5) es solo logístico y el mover-LPN de LpnAccionesModal es un
-- movimiento instantáneo de bajo nivel sin documento/confirmación. Esta migración crea
-- el proceso formal con tránsito:
--   despachar (origen, DEPOSITO+) → stock sale de origen, traslado "en_transito"
--   → confirmar recepción (destino) → stock entra a destino; parciales auditados.
--
-- Decisiones relevadas con GO (2026-06-11): tránsito + confirmación · detalle por
-- LPN/línea (lote/vencimiento/series viajan con la línea) · DEPOSITO+ crea, el destino
-- confirma · recepción parcial con faltante auditado.

-- ============================================================
-- 1) traslados — cabecera del documento de traslado
-- ============================================================
CREATE TABLE IF NOT EXISTS traslados (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero              INTEGER,                                   -- correlativo por tenant (trigger)
  sucursal_origen_id  UUID NOT NULL REFERENCES sucursales(id),
  sucursal_destino_id UUID NOT NULL REFERENCES sucursales(id),
  estado              TEXT NOT NULL DEFAULT 'en_transito'
                      CHECK (estado IN ('en_transito','recibido','recibido_parcial','cancelado')),
  notas               TEXT,
  envio_id            UUID REFERENCES envios(id) ON DELETE SET NULL,  -- link opcional al envío logístico (futuro)
  despachado_por      UUID REFERENCES users(id),
  despachado_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recibido_por        UUID REFERENCES users(id),
  recibido_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sucursal_origen_id <> sucursal_destino_id)
);

CREATE INDEX IF NOT EXISTS idx_traslados_tenant   ON traslados(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traslados_destino  ON traslados(sucursal_destino_id) WHERE estado = 'en_transito';

ALTER TABLE traslados ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='traslados_tenant' AND tablename='traslados') THEN
    CREATE POLICY "traslados_tenant" ON traslados FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Correlativo por tenant (patrón set_devprov_numero, mig 185)
CREATE OR REPLACE FUNCTION set_traslado_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM traslados WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.set_traslado_numero() SET search_path = public;
DROP TRIGGER IF EXISTS trg_set_traslado_numero ON traslados;
CREATE TRIGGER trg_set_traslado_numero
  BEFORE INSERT ON traslados
  FOR EACH ROW EXECUTE FUNCTION set_traslado_numero();

-- ============================================================
-- 2) traslado_items — qué línea/LPN viaja (snapshot completo para trazabilidad)
-- ============================================================
CREATE TABLE IF NOT EXISTS traslado_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  traslado_id           UUID NOT NULL REFERENCES traslados(id) ON DELETE CASCADE,
  producto_id           UUID NOT NULL REFERENCES productos(id),
  linea_origen_id       UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,
  linea_destino_id      UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,  -- creada al recibir
  lpn                   TEXT,
  nro_lote              TEXT,
  fecha_vencimiento     DATE,
  estado_id             UUID REFERENCES estados_inventario(id),
  precio_costo_snapshot DECIMAL(14,2),
  series                JSONB,                                   -- [{serie_id, nro_serie}] si serializado
  cantidad              DECIMAL(14,4) NOT NULL CHECK (cantidad > 0),
  cantidad_recibida     DECIMAL(14,4),                            -- NULL = sin confirmar; < cantidad = faltante
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traslado_items_traslado ON traslado_items(traslado_id);
CREATE INDEX IF NOT EXISTS idx_traslado_items_producto ON traslado_items(producto_id);

ALTER TABLE traslado_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='traslado_items_tenant' AND tablename='traslado_items') THEN
    CREATE POLICY "traslado_items_tenant" ON traslado_items FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
