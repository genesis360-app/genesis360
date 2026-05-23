-- Migration 129: token público para página del transportista (ISS-165)

ALTER TABLE envios ADD COLUMN IF NOT EXISTS token_transportista TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_envios_token ON envios(token_transportista) WHERE token_transportista IS NOT NULL;

-- Obtener envío por token (sin auth — para el transportista)
CREATE OR REPLACE FUNCTION get_envio_by_token(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row RECORD; BEGIN
  SELECT e.id, e.numero, e.estado, e.courier, e.servicio, e.tracking_number,
         e.destino_descripcion, e.fecha_entrega_acordada, e.hora_entrega_acordada,
         e.notas, e.costo_cotizado, e.costo_pagado,
         e.pod_fecha, e.pod_receptor, e.pod_notas, e.pod_url,
         e.tenant_id,
         cd.calle, cd.numero AS dom_numero, cd.ciudad, cd.provincia,
         cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
         tn.nombre AS tenant_nombre
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

-- Obtener ítems de la venta vinculada al envío por token
CREATE OR REPLACE FUNCTION get_envio_items_by_token(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_items JSONB; BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'nombre', p.nombre,
    'sku', p.sku,
    'cantidad', vi.cantidad
  )) INTO v_items
  FROM envios e
  JOIN ventas v ON v.id = e.venta_id
  JOIN venta_items vi ON vi.venta_id = v.id
  JOIN productos p ON p.id = vi.producto_id
  WHERE e.token_transportista = p_token;
  RETURN COALESCE(v_items, '[]'::jsonb);
END;$$;

-- Actualizar estado del envío por token
CREATE OR REPLACE FUNCTION update_envio_by_token(
  p_token    TEXT,
  p_estado   TEXT,
  p_pod_fecha     DATE    DEFAULT NULL,
  p_pod_receptor  TEXT    DEFAULT NULL,
  p_pod_notas     TEXT    DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE envios SET
    estado        = p_estado,
    pod_fecha     = COALESCE(p_pod_fecha, pod_fecha),
    pod_receptor  = COALESCE(NULLIF(p_pod_receptor,''), pod_receptor),
    pod_notas     = COALESCE(NULLIF(p_pod_notas,''), pod_notas),
    updated_at    = NOW()
  WHERE token_transportista = p_token
    AND estado NOT IN ('entregado','cancelado');
  RETURN FOUND;
END;$$;

-- Permisos: anon y authenticated pueden llamar estas funciones
GRANT EXECUTE ON FUNCTION get_envio_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_envio_items_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_envio_by_token(TEXT,TEXT,DATE,TEXT,TEXT) TO anon, authenticated;
