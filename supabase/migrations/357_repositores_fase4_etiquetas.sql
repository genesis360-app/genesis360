-- ============================================================
-- 357_repositores_fase4_etiquetas.sql
-- Repositores — Fase 4 (última fase del módulo): etiquetas de precio + impresión (G/H del
-- relevamiento). Cierra el backlog de Fede — Fase E completa con esta.
--
-- G1: campo nuevo "Contenido" (cantidad + unidad física) para productos de contenido fijo —
-- permite calcular en el frontend "precio por unidad grande" (ej. shampoo 120ml a $3.000 →
-- "Precio por L: $25.000"). La conversión ya existe (`convertirFisica`, src/lib/unidadMedidaFisica.ts)
-- — este campo es lo único que faltaba en el modelo de datos. Distinto de
-- `productos.unidad_medida_base_id` (cómo se vende/cobra el producto, ej. "Unidad"): "Contenido" es
-- cuánto hay físicamente ADENTRO de esa unidad de venta.
--
-- G2/H1: config de impresión (tamaño de hoja default + hora de recordatorio) vive en `tenants`,
-- configurable por el dueño/supervisor desde Config → Inventario → Zonas — mismo lugar que el resto
-- de la config operativa de WMS/Repositores.
-- ============================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS contenido_cantidad numeric
  CHECK (contenido_cantidad IS NULL OR contenido_cantidad > 0);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS contenido_unidad_id uuid REFERENCES unidades_medida_fisicas(id) ON DELETE SET NULL;

COMMENT ON COLUMN productos.contenido_cantidad IS
  'Repositores Fase 4 (mig 357): cuánto contiene físicamente 1 unidad de venta de este producto (ej. 120 para un shampoo de 120ml). NULL = sin definir, la etiqueta no muestra "precio por unidad grande". Distinto de unidad_medida_base_id (cómo se vende, no cuánto contiene).';
COMMENT ON COLUMN productos.contenido_unidad_id IS
  'Repositores Fase 4 (mig 357): unidad física de contenido_cantidad (ej. "ml"). FK a unidades_medida_fisicas, mismo catálogo que unidad_medida_base_id.';

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS repositor_etiquetas_por_hoja integer NOT NULL DEFAULT 12
  CHECK (repositor_etiquetas_por_hoja IN (4, 6, 12));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS repositor_hora_impresion time;

COMMENT ON COLUMN tenants.repositor_etiquetas_por_hoja IS
  'Repositores Fase 4 (mig 357, G2 del relevamiento): tamaño de hoja default para el PDF de etiquetas de precio — 4/6/12 por hoja A4, configurable por el dueño/supervisor. Default 12 (menor cantidad de hojas).';
COMMENT ON COLUMN tenants.repositor_hora_impresion IS
  'Repositores Fase 4 (mig 357, H1 del relevamiento): a partir de esta hora del día, /repositores muestra un aviso de "hay carteles pendientes de imprimir" si quedan tareas activas de cambio_precio/cambio_estado. NULL = sin recordatorio configurado (default). Sin impresión automática — solo un aviso, evaluado client-side (no hay cron en este proyecto).';
