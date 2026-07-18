-- 276: traslado_items gana ubicacion_sugerida_id — cuando un traslado nace desde "Mover" del
-- LpnAccionesModal (envío parcial de un LPN a otra sucursal), el usuario ya eligió una ubicación
-- destino ahí mismo (filtrada por la sucursal elegida). Sin esta columna esa elección se perdía:
-- "Confirmar recepción" en TrasladosPanel siempre arrancaba en "Sin ubicación" sin importar lo
-- que el usuario ya había seleccionado al despachar.
-- No cambia el comportamiento de los traslados armados desde el tab Traslados (quedan con esta
-- columna en NULL, igual que hoy) — TrasladosPanel solo la usa como DEFAULT sugerido al abrir la
-- recepción, el destino sigue pudiendo elegir otra ubicación antes de confirmar.

ALTER TABLE traslado_items ADD COLUMN IF NOT EXISTS ubicacion_sugerida_id uuid REFERENCES ubicaciones(id) ON DELETE SET NULL;

COMMENT ON COLUMN traslado_items.ubicacion_sugerida_id IS 'Ubicación elegida por quien despachó (hoy solo desde el movimiento parcial de LpnAccionesModal) — TrasladosPanel la usa como default sugerido al confirmar recepción, no es vinculante.';
