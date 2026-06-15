-- Migration 213: Ventas/facturas recurrentes (plantillas)
--
-- Plantilla de una venta que se repite (ej. abono/mantenimiento mensual). Guarda un
-- snapshot de los ítems + frecuencia + próxima fecha. La generación es ASISTIDA: cuando
-- una plantilla vence, el frontend precarga el carrito desde el snapshot y reusa el flujo
-- de venta ya testeado (no se crean ventas por SQL → no toca stock/caja a ciegas).
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS ventas_recurrentes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  cliente_id      UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nombre  TEXT,                       -- snapshot del nombre (por si se borra el cliente)
  nombre          TEXT NOT NULL,              -- ej. "Abono mantenimiento mensual"
  frecuencia_dias INTEGER NOT NULL DEFAULT 30 CHECK (frecuencia_dias > 0),
  proximo_at      DATE NOT NULL,              -- próxima fecha en que corresponde generarla
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  items           JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{producto_id, nombre, sku, cantidad, precio_unitario, descuento, alicuota_iva}]
  notas           TEXT,
  ultima_generada_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ventas_rec_tenant ON ventas_recurrentes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ventas_rec_due    ON ventas_recurrentes(tenant_id, activo, proximo_at);

ALTER TABLE ventas_recurrentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ventas_rec_tenant ON ventas_recurrentes;
CREATE POLICY ventas_rec_tenant ON ventas_recurrentes
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
