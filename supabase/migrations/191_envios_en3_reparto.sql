-- Migration 191 — Envíos EN3: reparto (repartidores + hoja de ruta + transportista + notif)
-- G1 catálogo de repartidores + asignación · G3 hoja de ruta + cumplimiento · E1 token expiración
-- E2 acciones del transportista (incidencias) · E4 identidad · E5 notif "en camino".
-- Todo aditivo / idempotente.

-- ============================================================
-- 1) repartidores (G1)
-- ============================================================
CREATE TABLE IF NOT EXISTS repartidores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  empleado_id UUID REFERENCES empleados(id) ON DELETE SET NULL,
  telefono    TEXT,
  vehiculo    TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repartidores_tenant ON repartidores(tenant_id);
ALTER TABLE repartidores ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='repartidores_tenant' AND tablename='repartidores') THEN
    CREATE POLICY "repartidores_tenant" ON repartidores
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 2) envios — links de reparto + token expiración
-- ============================================================
ALTER TABLE envios ADD COLUMN IF NOT EXISTS repartidor_id   UUID REFERENCES repartidores(id) ON DELETE SET NULL;
ALTER TABLE envios ADD COLUMN IF NOT EXISTS token_expira_at TIMESTAMPTZ;  -- E1
ALTER TABLE envios ADD COLUMN IF NOT EXISTS hoja_ruta_id    UUID;         -- E3 (FK lógica)

-- ============================================================
-- 3) tenants — config de reparto
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_token_politica  TEXT NOT NULL DEFAULT 'al_entregar'; -- E1: al_entregar | dias
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_token_dias      INT  NOT NULL DEFAULT 30;            -- E1
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_identidad_modo  TEXT NOT NULL DEFAULT 'anonimo';     -- E4: anonimo | nombre_dni
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_notif_en_camino TEXT NOT NULL DEFAULT 'wa';          -- E5: no | wa | wa_tracking
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_hoja_ruta_modo  TEXT NOT NULL DEFAULT 'agrupada';    -- E3: por_envio | agrupada | agrupada_proximidad

-- ============================================================
-- 4) hojas_ruta + hoja_ruta_envios (E3/G3)
-- ============================================================
CREATE TABLE IF NOT EXISTS hojas_ruta (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  repartidor_id UUID REFERENCES repartidores(id) ON DELETE SET NULL,
  token         TEXT UNIQUE,
  sucursal_id   UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hojas_ruta_tenant ON hojas_ruta(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hojas_ruta_token  ON hojas_ruta(token) WHERE token IS NOT NULL;
ALTER TABLE hojas_ruta ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='hojas_ruta_tenant' AND tablename='hojas_ruta') THEN
    CREATE POLICY "hojas_ruta_tenant" ON hojas_ruta
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hoja_ruta_envios (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hoja_id   UUID NOT NULL REFERENCES hojas_ruta(id) ON DELETE CASCADE,
  envio_id  UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  orden     INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hoja_ruta_envios_hoja ON hoja_ruta_envios(hoja_id);
ALTER TABLE hoja_ruta_envios ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='hoja_ruta_envios_tenant' AND tablename='hoja_ruta_envios') THEN
    CREATE POLICY "hoja_ruta_envios_tenant" ON hoja_ruta_envios
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 5) envio_incidencias (E2)
-- ============================================================
CREATE TABLE IF NOT EXISTS envio_incidencias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  envio_id     UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,   -- rotura | direccion | cliente | otro
  detalle      TEXT,
  reportado_at TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_envio_incidencias_envio ON envio_incidencias(envio_id);
ALTER TABLE envio_incidencias ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='envio_incidencias_tenant' AND tablename='envio_incidencias') THEN
    CREATE POLICY "envio_incidencias_tenant" ON envio_incidencias
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 6) get_envio_by_token — agrega identidad/repartidor + chequea expiración (E1/E2/E4)
-- ============================================================
CREATE OR REPLACE FUNCTION get_envio_by_token(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row RECORD; BEGIN
  SELECT e.id, e.numero, e.estado, e.courier, e.servicio, e.tracking_number,
         e.destino_descripcion, e.fecha_entrega_acordada, e.hora_entrega_acordada,
         e.notas, e.costo_cotizado, e.costo_pagado,
         e.pod_fecha, e.pod_receptor, e.pod_notas, e.pod_url,
         e.pod_dni, e.pod_firma_url, e.pod_geo_estado, e.pod_otp_verificado,
         e.intentos, e.subestado_no_entrega, e.no_entrega_motivo,
         (e.courier = 'Envío propio') AS es_propio,
         e.tenant_id, e.token_expira_at,
         cd.calle, cd.numero AS dom_numero, cd.ciudad, cd.provincia,
         cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
         rp.nombre AS repartidor_nombre,
         tn.nombre AS tenant_nombre,
         tn.pod_campos_requeridos, tn.pod_foto_min, tn.pod_otp_umbral,
         tn.envio_reintentos_max, tn.envio_geoloc_alerta_km, tn.envio_identidad_modo
  INTO v_row
  FROM envios e
  LEFT JOIN cliente_domicilios cd ON cd.id = e.destino_id
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  LEFT JOIN repartidores rp ON rp.id = e.repartidor_id
  LEFT JOIN tenants tn ON tn.id = e.tenant_id
  WHERE e.token_transportista = p_token;

  IF NOT FOUND THEN RETURN NULL; END IF;
  -- E1 — token expirado por fecha
  IF v_row.token_expira_at IS NOT NULL AND v_row.token_expira_at < NOW() THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END;$$;

-- E2 — reportar incidencia desde la página del transportista
CREATE OR REPLACE FUNCTION reportar_incidencia_envio(p_token TEXT, p_tipo TEXT, p_detalle TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID; v_tenant UUID; BEGIN
  SELECT id, tenant_id INTO v_id, v_tenant FROM envios WHERE token_transportista = p_token;
  IF v_id IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO envio_incidencias(tenant_id, envio_id, tipo, detalle)
    VALUES (v_tenant, v_id, COALESCE(NULLIF(p_tipo,''),'otro'), NULLIF(p_detalle,''));
  RETURN TRUE;
END;$$;

-- E3/G3 — hoja de ruta pública para el chofer (lista de envíos con su token)
CREATE OR REPLACE FUNCTION get_hoja_ruta_by_token(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_hoja RECORD; v_envios JSONB; BEGIN
  SELECT h.id, h.fecha, rp.nombre AS repartidor_nombre, tn.nombre AS tenant_nombre
    INTO v_hoja
  FROM hojas_ruta h
  LEFT JOIN repartidores rp ON rp.id = h.repartidor_id
  LEFT JOIN tenants tn ON tn.id = h.tenant_id
  WHERE h.token = p_token;
  IF v_hoja.id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'orden', hre.orden,
    'numero', e.numero,
    'estado', e.estado,
    'token', e.token_transportista,
    'cliente', cl.nombre,
    'telefono', cl.telefono,
    'direccion', COALESCE(cd.calle || COALESCE(' ' || cd.numero,''), e.destino_descripcion),
    'ciudad', cd.ciudad,
    'zona', e.zona_entrega,
    'hora', e.hora_entrega_acordada
  ) ORDER BY hre.orden) INTO v_envios
  FROM hoja_ruta_envios hre
  JOIN envios e ON e.id = hre.envio_id
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  LEFT JOIN cliente_domicilios cd ON cd.id = e.destino_id
  WHERE hre.hoja_id = v_hoja.id;

  RETURN jsonb_build_object(
    'fecha', v_hoja.fecha, 'repartidor_nombre', v_hoja.repartidor_nombre,
    'tenant_nombre', v_hoja.tenant_nombre, 'envios', COALESCE(v_envios, '[]'::jsonb)
  );
END;$$;

GRANT EXECUTE ON FUNCTION get_envio_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION reportar_incidencia_envio(TEXT,TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_hoja_ruta_by_token(TEXT) TO anon, authenticated;
