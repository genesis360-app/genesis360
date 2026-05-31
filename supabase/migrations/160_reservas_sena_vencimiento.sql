-- Migration 160: Bloque Reservas (E1/E2/E6) — relevamiento Ventas (2026-05-31)
-- E6: seña obligatoria + mínima %.
-- E1: vencimiento configurable + liberación automática de stock al vencer (sweep lazy).
-- E2: penalidad % al cancelar + crédito a favor del cliente (reusa la CC).

-- ─── Config del tenant ──────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS reserva_sena_obligatoria BOOLEAN NOT NULL DEFAULT TRUE,  -- E6: sin seña no hay reserva
  ADD COLUMN IF NOT EXISTS reserva_sena_minima_pct  DECIMAL(5,2) NOT NULL DEFAULT 0, -- E6: % mínimo del total (0 = cualquier seña > 0)
  ADD COLUMN IF NOT EXISTS reserva_vencimiento_dias INTEGER,                          -- E1: NULL = sin vencimiento (default)
  ADD COLUMN IF NOT EXISTS reserva_penalidad_pct    DECIMAL(5,2) NOT NULL DEFAULT 0;  -- E2: % de seña retenido al cancelar

-- ─── Marca de reserva: referencia estable para calcular el vencimiento ──────
-- (updated_at cambia con cualquier edición; reservado_at se fija al pasar a 'reservada')
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS reservado_at TIMESTAMPTZ;

-- ─── Crédito a favor del cliente (E2: reusar CC como saldo a favor) ─────────
-- Ledger simple: cada fila es un movimiento. monto>0 = crédito a favor;
-- monto<0 = consumo en una venta futura. Saldo = SUM(monto) por cliente.
CREATE TABLE IF NOT EXISTS cliente_creditos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  monto       DECIMAL(12,2) NOT NULL,           -- + a favor / - consumo
  origen      TEXT NOT NULL,                     -- 'cancelacion_reserva' | 'consumo_venta' | 'ajuste'
  venta_id    UUID REFERENCES ventas(id) ON DELETE SET NULL,
  nota        TEXT,
  usuario_id  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cliente_creditos_cliente ON cliente_creditos(tenant_id, cliente_id);

ALTER TABLE cliente_creditos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='cliente_creditos_tenant' AND tablename='cliente_creditos') THEN
    CREATE POLICY "cliente_creditos_tenant" ON cliente_creditos FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE cliente_creditos IS
  'E2 reservas: saldo a favor del cliente (reusa la CC). monto>0 crédito, monto<0 consumo. Saldo = SUM(monto).';

-- ─── Liberación de reservas vencidas (E1) — sweep lazy, NO toca dinero ──────
-- Se invoca por RPC al cargar Ventas/reservas. Libera el stock reservado y marca
-- la reserva como cancelada con nota. La seña queda para resolución manual.
CREATE OR REPLACE FUNCTION liberar_reservas_vencidas(p_tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_dias     INTEGER;
  v_count    INTEGER := 0;
  r          RECORD;
  it         RECORD;
  ln         RECORD;
  v_restante NUMERIC;
  v_lib      NUMERIC;
BEGIN
  SELECT reserva_vencimiento_dias INTO v_dias FROM tenants WHERE id = p_tenant_id;
  IF v_dias IS NULL OR v_dias <= 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT id FROM ventas
    WHERE tenant_id = p_tenant_id
      AND estado = 'reservada'
      AND COALESCE(reservado_at, updated_at) < NOW() - (v_dias * INTERVAL '1 day')
  LOOP
    -- Cada reserva es atómica: si el período contable está cerrado (u otro error),
    -- se saltea sin romper el sweep ni dejar stock liberado a medias.
    BEGIN
      FOR it IN
        SELECT vi.id AS item_id, vi.producto_id, vi.cantidad, p.tiene_series
        FROM venta_items vi
        JOIN productos p ON p.id = vi.producto_id
        WHERE vi.venta_id = r.id
      LOOP
        IF it.tiene_series THEN
          UPDATE inventario_series
            SET reservado = false
            WHERE id IN (SELECT serie_id FROM venta_series WHERE venta_item_id = it.item_id);
        ELSE
          v_restante := it.cantidad;
          FOR ln IN
            SELECT id, cantidad_reservada FROM inventario_lineas
            WHERE producto_id = it.producto_id AND activo = true AND cantidad_reservada > 0
            ORDER BY created_at
          LOOP
            EXIT WHEN v_restante <= 0;
            v_lib := LEAST(ln.cantidad_reservada, v_restante);
            UPDATE inventario_lineas
              SET cantidad_reservada = cantidad_reservada - v_lib
              WHERE id = ln.id;
            v_restante := v_restante - v_lib;
          END LOOP;
        END IF;
      END LOOP;

      UPDATE ventas
        SET estado = 'cancelada',
            cancelado_at = NOW(),
            notas = COALESCE(notas, '') || ' · [Reserva vencida: stock liberado automáticamente el ' || to_char(NOW(), 'DD/MM/YYYY') || ']'
        WHERE id = r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;  -- período cerrado u otro: saltar esta reserva
    END;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION liberar_reservas_vencidas(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION liberar_reservas_vencidas(UUID) TO authenticated;
