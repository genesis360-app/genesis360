-- Migration 155: Trazabilidad-extendida — convertir actividad_log en ledger trazable
--
-- Objetivo (pedido GO 2026-05-30): que /historial sea el hub único de
-- trazabilidad completa, grado WMS (Manhattan / Blue Yonder). Dos carencias:
--
--   1. Una sola acción del usuario (ej: editar un LPN cambiando lote +
--      vencimiento + ubicación) hoy genera N filas sueltas — una por campo.
--      En /historial se ven como N eventos separados. Falta una "cabecera"
--      lógica que las agrupe: el transaccion_id.
--
--   2. No se puede reconstruir la historia de una unidad puntual (LPN / lote /
--      serie) para un recall: el log no guarda esos identificadores como
--      columnas filtrables, solo el nombre del producto.
--
-- Esta migration es ADITIVA (columnas nullables). Filas viejas quedan con
-- transaccion_id = NULL → cada una sigue siendo su propio evento (1 fila = 1
-- tarjeta), sin backfill. Los campos de texto (lpn, nro_serie, lote) son
-- SNAPSHOTS: si después se edita/borra el LPN, la traza queda intacta — mismo
-- criterio que venta_item_despachos (mig 153).

ALTER TABLE actividad_log
  ADD COLUMN IF NOT EXISTS transaccion_id    UUID,   -- cabecera lógica: agrupa las filas de UNA acción
  ADD COLUMN IF NOT EXISTS tipo_transaccion  TEXT,   -- 'ingreso' | 'rebaje' | 'traslado' | 'ajuste' | 'edicion' | 'venta' | 'devolucion' | 'eliminacion'
  ADD COLUMN IF NOT EXISTS producto_id       UUID,   -- referencia (puede quedar huérfana ante borrado)
  ADD COLUMN IF NOT EXISTS lpn               TEXT,   -- snapshot del LPN afectado
  ADD COLUMN IF NOT EXISTS nro_serie         TEXT,   -- snapshot de la serie afectada (items serializados)
  ADD COLUMN IF NOT EXISTS lote              TEXT,   -- snapshot del lote afectado
  ADD COLUMN IF NOT EXISTS sucursal_id       UUID;   -- sucursal donde ocurrió (filtro + aislamiento)

-- Índice para colapsar por transacción al leer /historial
CREATE INDEX IF NOT EXISTS actividad_log_transaccion_idx ON actividad_log (transaccion_id);

-- Índices de trazabilidad por unidad (recall): reconstruir la historia de un
-- producto / LPN / serie puntual sin scan completo
CREATE INDEX IF NOT EXISTS actividad_log_producto_idx ON actividad_log (tenant_id, producto_id);
CREATE INDEX IF NOT EXISTS actividad_log_lpn_idx       ON actividad_log (tenant_id, lpn);
CREATE INDEX IF NOT EXISTS actividad_log_serie_idx     ON actividad_log (tenant_id, nro_serie);

COMMENT ON COLUMN actividad_log.transaccion_id IS
  'Cabecera lógica: todas las filas de una misma acción del usuario comparten este UUID. NULL en filas legacy (pre-mig 155) → cada una es su propio evento.';
COMMENT ON COLUMN actividad_log.tipo_transaccion IS
  'Clasificación WMS de la transacción: ingreso/rebaje/traslado/ajuste/edicion/venta/devolucion/eliminacion.';
COMMENT ON COLUMN actividad_log.lpn IS
  'Snapshot del LPN afectado — intacto ante edición/borrado posterior del LPN. Para trazabilidad/recall por unidad.';
