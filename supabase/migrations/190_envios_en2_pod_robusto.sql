-- Migration 190 — Envíos EN2: POD robusto + cierre de entrega (D1-D6)
-- D1 campos POD requeridos configurables · D2 multi-foto mín · D3 firma+DNI+OTP sobre umbral (propio)
-- D4 geoloc con fallback graceful · D5 sub-estados de no-entrega + motivo · D6 reintento + recargo.
-- Todo aditivo / idempotente.

-- ============================================================
-- 1) envios — nuevos campos POD
-- ============================================================
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_firma_url        TEXT;     -- D3 firma del receptor (canvas → storage)
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_dni              TEXT;     -- D3 DNI del receptor
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_lat              NUMERIC;  -- D4 geoloc al entregar
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_lon              NUMERIC;  -- D4
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_geo_estado       TEXT;     -- D4 ok | fuera_rango | no_disponible
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_otp_verificado   BOOLEAN NOT NULL DEFAULT FALSE; -- D3
ALTER TABLE envios ADD COLUMN IF NOT EXISTS intentos             INT NOT NULL DEFAULT 0;          -- D6
ALTER TABLE envios ADD COLUMN IF NOT EXISTS reintento_motivo     TEXT;     -- D6
ALTER TABLE envios ADD COLUMN IF NOT EXISTS subestado_no_entrega TEXT;     -- D5 ausente | rechazado | direccion_incorrecta
ALTER TABLE envios ADD COLUMN IF NOT EXISTS no_entrega_motivo    TEXT;     -- D5

-- ============================================================
-- 2) tenants — config POD (Config → Envíos)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pod_campos_requeridos  JSONB NOT NULL DEFAULT '{"fecha":true,"receptor":true,"foto":false,"firma":false,"dni":false}'::jsonb; -- D1
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pod_foto_min           INT     NOT NULL DEFAULT 0;  -- D2 (0 = sin mínimo)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pod_otp_umbral         NUMERIC NOT NULL DEFAULT 0;  -- D3 (0 = OTP off)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_geoloc_alerta_km NUMERIC NOT NULL DEFAULT 0;  -- D4 (0 = sin alerta)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_reintentos_max   INT     NOT NULL DEFAULT 3;  -- D6
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_reintento_recargo NUMERIC NOT NULL DEFAULT 0; -- D6 recargo $ si supera N intentos

COMMENT ON COLUMN tenants.pod_campos_requeridos  IS 'EN2/D1: campos del POD requeridos para marcar entregado {fecha,receptor,foto,firma,dni}.';
COMMENT ON COLUMN tenants.pod_otp_umbral         IS 'EN2/D3: monto desde el cual el envío PROPIO exige OTP del receptor (0 = off).';
COMMENT ON COLUMN tenants.envio_geoloc_alerta_km IS 'EN2/D4: km de tolerancia geoloc al entregar; supera → fuera_rango (0 = sin alerta).';

-- ============================================================
-- 3) envio_otp (D3) — código de un solo uso para validar entrega
-- ============================================================
CREATE TABLE IF NOT EXISTS envio_otp (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  envio_id      UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  telefono      TEXT,
  enviado_at    TIMESTAMPTZ DEFAULT NOW(),
  verificado_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_envio_otp_envio ON envio_otp(envio_id);
ALTER TABLE envio_otp ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='envio_otp_tenant' AND tablename='envio_otp') THEN
    CREATE POLICY "envio_otp_tenant" ON envio_otp
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 4) RPCs públicas del transportista — ampliadas (POD robusto)
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
         e.tenant_id,
         cd.calle, cd.numero AS dom_numero, cd.ciudad, cd.provincia,
         cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
         tn.nombre AS tenant_nombre,
         tn.pod_campos_requeridos, tn.pod_foto_min, tn.pod_otp_umbral,
         tn.envio_reintentos_max, tn.envio_geoloc_alerta_km
  INTO v_row
  FROM envios e
  LEFT JOIN cliente_domicilios cd ON cd.id = e.destino_id
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  LEFT JOIN tenants tn ON tn.id = e.tenant_id
  WHERE e.token_transportista = p_token;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END;$$;

-- Actualizar estado/POD por token (firma, DNI, geoloc, sub-estado, reintento)
DROP FUNCTION IF EXISTS update_envio_by_token(TEXT,TEXT,DATE,TEXT,TEXT);
CREATE OR REPLACE FUNCTION update_envio_by_token(
  p_token             TEXT,
  p_estado            TEXT,
  p_pod_fecha         DATE    DEFAULT NULL,
  p_pod_receptor      TEXT    DEFAULT NULL,
  p_pod_notas         TEXT    DEFAULT NULL,
  p_pod_dni           TEXT    DEFAULT NULL,
  p_pod_firma_url     TEXT    DEFAULT NULL,
  p_pod_lat           NUMERIC DEFAULT NULL,
  p_pod_lon           NUMERIC DEFAULT NULL,
  p_pod_geo_estado    TEXT    DEFAULT NULL,
  p_subestado         TEXT    DEFAULT NULL,
  p_no_entrega_motivo TEXT    DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_otp_ok BOOLEAN; v_umbral NUMERIC; v_total NUMERIC;
  v_propio BOOLEAN; v_max INT; v_intentos INT;
BEGIN
  SELECT e.pod_otp_verificado, COALESCE(t.pod_otp_umbral,0), COALESCE(e.costo_cotizado,0),
         (e.courier = 'Envío propio'), COALESCE(t.envio_reintentos_max,3), COALESCE(e.intentos,0)
    INTO v_otp_ok, v_umbral, v_total, v_propio, v_max, v_intentos
  FROM envios e JOIN tenants t ON t.id = e.tenant_id
  WHERE e.token_transportista = p_token;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- D5/D6 — no entregado: sub-estado + reintento (ausente reintenta hasta el máximo)
  IF p_subestado IS NOT NULL AND p_subestado <> '' THEN
    IF p_subestado = 'ausente' AND (v_intentos + 1) < v_max THEN
      UPDATE envios SET estado='en_camino', intentos = intentos + 1,
        subestado_no_entrega = p_subestado,
        no_entrega_motivo = COALESCE(NULLIF(p_no_entrega_motivo,''), no_entrega_motivo),
        updated_at = NOW()
      WHERE token_transportista = p_token AND estado NOT IN ('entregado','cancelado');
    ELSE
      UPDATE envios SET estado='devolucion', intentos = intentos + 1,
        subestado_no_entrega = p_subestado,
        no_entrega_motivo = COALESCE(NULLIF(p_no_entrega_motivo,''), no_entrega_motivo),
        updated_at = NOW()
      WHERE token_transportista = p_token AND estado NOT IN ('entregado','cancelado');
    END IF;
    RETURN FOUND;
  END IF;

  -- D3 — OTP requerido y no verificado bloquea el "entregado"
  IF p_estado = 'entregado' AND v_propio AND v_umbral > 0 AND v_total >= v_umbral AND NOT COALESCE(v_otp_ok,false) THEN
    RETURN FALSE;
  END IF;

  UPDATE envios SET
    estado         = p_estado,
    pod_fecha      = COALESCE(p_pod_fecha, pod_fecha),
    pod_receptor   = COALESCE(NULLIF(p_pod_receptor,''), pod_receptor),
    pod_notas      = COALESCE(NULLIF(p_pod_notas,''), pod_notas),
    pod_dni        = COALESCE(NULLIF(p_pod_dni,''), pod_dni),
    pod_firma_url  = COALESCE(NULLIF(p_pod_firma_url,''), pod_firma_url),
    pod_lat        = COALESCE(p_pod_lat, pod_lat),
    pod_lon        = COALESCE(p_pod_lon, pod_lon),
    pod_geo_estado = COALESCE(NULLIF(p_pod_geo_estado,''), pod_geo_estado),
    updated_at     = NOW()
  WHERE token_transportista = p_token AND estado NOT IN ('entregado','cancelado');
  RETURN FOUND;
END;$$;

-- D3 — generar OTP (devuelve el código + teléfono para enviarlo al cliente por WA)
CREATE OR REPLACE FUNCTION generar_otp_envio(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID; v_tenant UUID; v_tel TEXT; v_cod TEXT; BEGIN
  SELECT e.id, e.tenant_id, cl.telefono INTO v_id, v_tenant, v_tel
  FROM envios e
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  WHERE e.token_transportista = p_token;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  v_cod := lpad((floor(random()*1000000))::int::text, 6, '0');
  INSERT INTO envio_otp(tenant_id, envio_id, codigo, telefono, enviado_at)
    VALUES (v_tenant, v_id, v_cod, v_tel, NOW());
  UPDATE envios SET pod_otp_verificado = false WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'codigo', v_cod, 'telefono', v_tel);
END;$$;

-- D3 — verificar OTP que el cliente le dictó al transportista
CREATE OR REPLACE FUNCTION verificar_otp_envio(p_token TEXT, p_codigo TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok BOOLEAN; BEGIN
  SELECT EXISTS(
    SELECT 1 FROM envio_otp o JOIN envios e ON e.id = o.envio_id
    WHERE e.token_transportista = p_token AND o.codigo = p_codigo
      AND o.verificado_at IS NULL AND o.enviado_at > NOW() - INTERVAL '24 hours'
  ) INTO v_ok;
  IF v_ok THEN
    UPDATE envio_otp o SET verificado_at = NOW()
      FROM envios e
      WHERE e.id = o.envio_id AND e.token_transportista = p_token
        AND o.codigo = p_codigo AND o.verificado_at IS NULL;
    UPDATE envios SET pod_otp_verificado = true WHERE token_transportista = p_token;
  END IF;
  RETURN v_ok;
END;$$;

GRANT EXECUTE ON FUNCTION get_envio_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_envio_by_token(TEXT,TEXT,DATE,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION generar_otp_envio(TEXT)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verificar_otp_envio(TEXT,TEXT) TO anon, authenticated;
