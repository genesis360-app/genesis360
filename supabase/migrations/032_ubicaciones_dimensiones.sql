-- Migration 032: Dimensiones en ubicaciones (WMS Fase 2)
--
-- Agrega campos físicos y de capacidad a la tabla ubicaciones.
-- Todos los campos son opcionales para no romper ubicaciones existentes.
-- Base para almacenaje dirigido (putaway): el sistema puede sugerir la ubicación
-- óptima comparando dimensiones del producto vs disponibilidad de la ubicación.

ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS tipo_ubicacion TEXT
    CHECK (tipo_ubicacion IN ('picking','bulk','estiba','camara','cross_dock')),
  ADD COLUMN IF NOT EXISTS alto_cm       DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS ancho_cm      DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS largo_cm      DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS peso_max_kg   DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS capacidad_pallets INT;

COMMENT ON COLUMN ubicaciones.tipo_ubicacion    IS 'Tipo de ubicación WMS: picking/bulk/estiba/camara/cross_dock';
COMMENT ON COLUMN ubicaciones.alto_cm           IS 'Altura del hueco en centímetros';
COMMENT ON COLUMN ubicaciones.ancho_cm          IS 'Ancho del hueco en centímetros';
COMMENT ON COLUMN ubicaciones.largo_cm          IS 'Largo/profundidad del hueco en centímetros';
COMMENT ON COLUMN ubicaciones.peso_max_kg       IS 'Peso máximo soportado en kilogramos';
COMMENT ON COLUMN ubicaciones.capacidad_pallets IS 'Cantidad de pallets que caben (para tipo estiba)';
