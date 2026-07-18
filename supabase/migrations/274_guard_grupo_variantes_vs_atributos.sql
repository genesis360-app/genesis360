-- 274: Guard server-side — un producto NO puede pertenecer a un "Grupo de variantes"
-- (grupo_id) Y tener "Atributos de variante" (tiene_talle/color/encaje/formato/sabor_aroma)
-- activos al mismo tiempo. REGLA #0: son dos modelos de stock incompatibles —
--   · Grupo de variantes: cada valor (talle/color) es un SKU/producto SEPARADO con su propio
--     stock_actual.
--   · Atributos de variante: UN SOLO SKU cuyas líneas de inventario (inventario_lineas)
--     llevan el atributo — el stock se banca junto y se distingue en el depósito.
-- Combinarlos generó datos inconsistentes en la práctica (producto "Variante1", tenant Almacén
-- Jorgito DEV, 2026-07-18): quedó vinculado a un grupo Y con tiene_talle=true, y el ingreso de
-- stock no pedía el talle porque la UI de "Grupo de variantes" no lo exige de esa forma.
-- La UI (ProductoFormPage) ya bloquea combinar ambos; esto es el guard de DB para que tampoco
-- pase por API/import masivo/SQL directo.

-- Verificado ANTES de esta mig (2026-07-18, por query): 1 fila violaba la condición
-- ("Variante1", tenant 3769b1db-10f4-46a6-bc7f-eb669307730d) — corregida a mano (tiene_talle
-- → false, queda solo como miembro del grupo) antes de aplicar el CHECK.

ALTER TABLE productos DROP CONSTRAINT IF EXISTS chk_productos_grupo_sin_atributos_variante;
ALTER TABLE productos ADD CONSTRAINT chk_productos_grupo_sin_atributos_variante
  CHECK (NOT (
    grupo_id IS NOT NULL
    AND (tiene_talle OR tiene_color OR tiene_encaje OR tiene_formato OR tiene_sabor_aroma)
  ));

COMMENT ON CONSTRAINT chk_productos_grupo_sin_atributos_variante ON productos IS
  'Un producto no puede ser miembro de un Grupo de variantes Y tener Atributos de variante activos — son dos modelos de stock incompatibles. Ver mig 274 / wiki/features/atributos-variante.md.';
