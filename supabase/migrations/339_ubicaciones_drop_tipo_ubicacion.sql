-- 339 — Fase U5: limpieza de `ubicaciones.tipo_ubicacion` (columna vieja, reemplazada en mig 334)
-- El rediseño de Ubicaciones en árbol (mig 334, v1.157.0) introdujo `tipo_logico` +
-- `subtipo_almacenamiento` como reemplazo semántico de `tipo_ubicacion`. Verificado 0 lectores
-- reales: sin funciones/triggers/vistas en schema_full.sql que lean o escriban la columna (solo
-- su propia definición + CHECK constraint), sin referencias en supabase/functions, y en src/ solo
-- queda el tipo TS deprecated (src/lib/supabase.ts) que se limpia junto con esta migración.
-- DROP idempotente. No afecta datos operativos (nada consume el valor histórico).

ALTER TABLE public.ubicaciones DROP CONSTRAINT IF EXISTS ubicaciones_tipo_ubicacion_check;
ALTER TABLE public.ubicaciones DROP COLUMN IF EXISTS tipo_ubicacion;
