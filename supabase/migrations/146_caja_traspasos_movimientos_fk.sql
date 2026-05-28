-- Migration 146: vincular caja_traspasos con sus movimientos contables
-- Fix ISS-193 — necesitamos saber qué movimiento (ingreso) en la caja destino
-- corresponde a un traspaso, para que al corregirlo se ajuste también la
-- caja origen (devuelve/cobra la diferencia).

ALTER TABLE caja_traspasos
  ADD COLUMN IF NOT EXISTS movimiento_origen_id  UUID REFERENCES caja_movimientos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS movimiento_destino_id UUID REFERENCES caja_movimientos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_caja_traspasos_mov_destino ON caja_traspasos(movimiento_destino_id) WHERE movimiento_destino_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_caja_traspasos_mov_origen  ON caja_traspasos(movimiento_origen_id)  WHERE movimiento_origen_id  IS NOT NULL;

COMMENT ON COLUMN caja_traspasos.movimiento_origen_id  IS 'FK al egreso registrado en la caja origen. Permite trazar el traspaso y propagar correcciones (ISS-193).';
COMMENT ON COLUMN caja_traspasos.movimiento_destino_id IS 'FK al ingreso registrado en la caja destino. Permite trazar el traspaso y propagar correcciones (ISS-193).';
