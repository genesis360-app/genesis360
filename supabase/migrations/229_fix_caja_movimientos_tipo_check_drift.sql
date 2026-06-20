-- Migration 229: fix del drift del CHECK de caja_movimientos.tipo
-- BUG (PROD): un alta nueva no podía ingresar a Caja Fuerte →
--   "new row for relation caja_movimientos violates check constraint caja_movimientos_tipo_check".
-- Causa: PROD tenía el CHECK VIEJO `tipo IN ('ingreso','egreso')`, pero la app usa muchos más
-- tipos: ingreso_traspaso, egreso_traspaso (Caja Fuerte/traspasos), ingreso_informativo,
-- egreso_informativo (medios no-efectivo), ingreso_reserva (seña), egreso_devolucion_sena
-- (devolución de seña). DEV había quedado SIN constraint (drift DEV≠PROD) → ahí no fallaba.
-- En PROD esto rompía Caja Fuerte, señas, ventas no-efectivo (informativo) y devoluciones de seña.
--
-- Fix: re-sincronizar ambos con un CHECK por PREFIJO, consistente con el cálculo de saldo
-- (que usa LIKE 'ingreso%' / 'egreso%') y a prueba de nuevos sufijos sin volver a romper.
-- Datos existentes (PROD: ingreso/egreso; DEV: + traspaso/informativo/reserva) pasan todos.

ALTER TABLE caja_movimientos DROP CONSTRAINT IF EXISTS caja_movimientos_tipo_check;

ALTER TABLE caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_check
  CHECK (tipo ~ '^(ingreso|egreso)(_[a-z]+)*$');
