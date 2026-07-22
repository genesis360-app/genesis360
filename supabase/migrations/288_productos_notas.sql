-- ============================================================
-- 288_productos_notas.sql
-- Agrega productos.notas — columna que el importador de productos (ImportarProductosPage.tsx)
-- y su plantilla Excel piden desde hace tiempo pero que NUNCA existió en la tabla.
--
-- 🛑 Bug real encontrado 2026-07-21 (spec e2e 105, al validar el nuevo precio por nivel del
-- importador): el payload de INSERT/UPDATE de productos siempre mandó `notas`, PostgREST
-- rechazaba el request ENTERO ("Could not find the 'notas' column of 'productos' in the schema
-- cache"), pero el código solo desestructuraba `data` del insert/update — nunca revisaba `error`
-- — así que el import reportaba "X creados" mientras la tabla quedaba en CERO filas. Es decir:
-- el importador de productos NUNCA funcionó desde que se le agregó este campo (ver historial de
-- ImportarProductosPage.tsx). Esta migración agrega la columna que faltaba; el fix del manejo de
-- errores (para que un fallo real de INSERT/UPDATE se vea, no se trague en silencio) va en el
-- código de la misma sesión.
-- ============================================================

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS notas text;

COMMENT ON COLUMN productos.notas IS
  'Notas internas del producto (no visible en ventas/tickets/facturas). Cargable desde la ficha o el importador masivo.';
