-- Migration 071: unique constraints para evitar duplicados en webhooks TN/ML
-- ventas: no puede haber dos ventas del mismo pedido externo para el mismo tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_tracking_unique
  ON ventas(tenant_id, origen, tracking_id)
  WHERE tracking_id IS NOT NULL;

-- clientes: no puede haber dos clientes con el mismo email en el mismo tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email_unique
  ON clientes(tenant_id, email)
  WHERE email IS NOT NULL;
