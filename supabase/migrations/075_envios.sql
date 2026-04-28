-- Migration 075: Módulo Envíos
CREATE TABLE IF NOT EXISTS envios (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID REFERENCES sucursales(id),
  venta_id        UUID REFERENCES ventas(id) ON DELETE SET NULL,
  numero          INT,

  -- Courier
  courier         TEXT,  -- OCA, CorreoAR, Andreani, DHL, Otro
  servicio        TEXT,  -- ej: Estandar, Urgente
  tracking_number TEXT,
  tracking_url    TEXT,

  -- Estado
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'despachado', 'en_camino', 'entregado', 'devolucion', 'cancelado'
  )),

  -- Canal de origen
  canal TEXT,  -- POS, MELI, TiendaNube, MP

  -- Destino
  destino_id           UUID REFERENCES cliente_domicilios(id) ON DELETE SET NULL,
  destino_descripcion  TEXT,  -- snapshot o domicilio manual

  -- Dimensiones del paquete
  peso_kg   DECIMAL(8,3),
  largo_cm  DECIMAL(8,2),
  ancho_cm  DECIMAL(8,2),
  alto_cm   DECIMAL(8,2),

  -- Costos
  costo_cotizado DECIMAL(12,2),
  costo_real     DECIMAL(12,2),

  -- Entrega acordada
  fecha_entrega_acordada DATE,
  hora_entrega_acordada  TIME,
  zona_entrega           TEXT,

  -- Label
  etiqueta_url TEXT,  -- path en storage bucket etiquetas-envios

  -- Meta
  notas      TEXT,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_envios_tenant  ON envios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_envios_venta   ON envios(venta_id);
CREATE INDEX IF NOT EXISTS idx_envios_estado  ON envios(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_envios_fecha   ON envios(tenant_id, created_at);

-- Número auto-incremental por tenant
CREATE OR REPLACE FUNCTION set_envio_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.numero := COALESCE((SELECT MAX(numero) FROM envios WHERE tenant_id = NEW.tenant_id), 0) + 1;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_set_envio_numero ON envios;
CREATE TRIGGER trg_set_envio_numero
  BEFORE INSERT ON envios
  FOR EACH ROW EXECUTE FUNCTION set_envio_numero();

-- Trigger updated_at
CREATE OR REPLACE FUNCTION fn_envios_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;$$;
CREATE TRIGGER trg_envios_updated_at BEFORE UPDATE ON envios
  FOR EACH ROW EXECUTE FUNCTION fn_envios_updated_at();

ALTER TABLE envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY envios_tenant ON envios
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Bucket privado para etiquetas de courier
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('etiquetas-envios', 'etiquetas-envios', false, 5242880,
  ARRAY['application/pdf','image/png','image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='etiq_envio_read') THEN
    CREATE POLICY etiq_envio_read ON storage.objects FOR SELECT
      USING (bucket_id = 'etiquetas-envios' AND auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='etiq_envio_insert') THEN
    CREATE POLICY etiq_envio_insert ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'etiquetas-envios' AND auth.uid() IS NOT NULL);
  END IF;
END $$;
