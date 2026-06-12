-- Migration 206: Cheques conectados al circuito de pago (auditoría de procesos 2026-06-11, ítem #5)
--
-- `cheques.oc_id` ya existía (mig 187) pero nunca se llenaba. Esta migración agrega el
-- link al gasto para cerrar el circuito: pagar una OC/gasto con medio "Cheque" crea el
-- cheque vinculado, y un cheque propio RECHAZADO revierte el pago que lo originó
-- (OC/gasto vuelven a pendiente + ajuste en proveedor_cc_movimientos). Aditiva.

ALTER TABLE cheques ADD COLUMN IF NOT EXISTS gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cheques_gasto ON cheques(gasto_id) WHERE gasto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cheques_oc    ON cheques(oc_id)    WHERE oc_id    IS NOT NULL;
