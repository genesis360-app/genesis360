-- ============================================================
-- 325_fix_ocupacion_presentacion_join.sql
-- 🐛 FIX de la mig 322: `vw_ubicacion_ocupacion` NUNCA encontraba la presentación de una línea.
--
-- 🛑 Regla #0 (inventario). Tres defectos, encontrados al construir el frontend del cubicaje:
--
-- 1) **El JOIN comparaba dos tipos de ID distintos.** La 322 unía
--    `producto_presentaciones.id = inventario_lineas.unidad_medida_id`, pero esa columna referencia
--    `unidades_medida(id)` (el catálogo de EMPAQUES: "Caja", "Pallet"), no una presentación
--    (mig 293: `... REFERENCES unidades_medida(id)`). Verificado en DEV: de las líneas activas con
--    `unidad_medida_id`, **0 matchean por `pp.id` y todas por `unidades_medida.id`**. Como además la
--    columna NO es NULL en esas filas, tampoco entraba el fallback a la base → esas líneas aportaban
--    **0 m³**. O sea: justo las que entraron en bulto —las que más volumen ocupan— quedaban en cero,
--    y el error empuja hacia "parece que hay lugar", que es exactamente lo que el diseño del
--    cubicaje quería evitar.
--
-- 2) **El arreglo obvio duplicaba filas.** Unir por `pp.nombre_empaque_id = il.unidad_medida_id` a
--    secas multiplica la línea cuando hay HERMANAS con el mismo empaque ("Caja-12" y "Caja-10"
--    cuelgan las dos del empaque "Caja"; en DEV hay 8 grupos así, uno con 3). Eso inflaría
--    `lpn_activos` y `peso_kg` ×2 o ×3 → una ubicación con 3 LPN diría "6 de 4". Por eso acá va un
--    **LEFT JOIN LATERAL … LIMIT 1**: estructuralmente no puede duplicar.
--
-- 3) **`cantidad_uom` es un snapshot de INGRESO y se pone viejo.** La 322 lo usaba como primera
--    fuente de la cantidad. `cantidad` cambia con cada venta/ajuste y `cantidad_uom` no: en DEV hay
--    líneas con `cantidad = 48` y `cantidad_uom = 60`. Usarlo daría el volumen de 60 bultos para 48
--    unidades reales. Acá la cantidad se **deriva del stock actual** (`cantidad / factor_base`), que
--    no puede quedar desfasado, y `cantidad_uom` se degrada a **desempate** entre hermanas.
--
-- Se aprovecha para corregir el peso: con el cubicaje, GO decidió que el peso se carga
-- **por nivel** justamente porque un bulto incluye su embalaje (una caja de 12 pesa más que 12
-- unidades sueltas). La 321 lo calculaba siempre como `productos.peso_kg × cantidad`, que ignora ese
-- embalaje y vuelve a quedar CORTO — en un dato que decide si un rack está sobrecargado, o sea
-- seguridad física. Ahora se prefiere el peso de la presentación y se cae a `productos.peso_kg`.
-- ============================================================

DROP VIEW IF EXISTS vw_ubicacion_ocupacion;
CREATE VIEW vw_ubicacion_ocupacion
WITH (security_invoker = true)
AS
SELECT
  il.tenant_id,
  il.ubicacion_id,
  count(*)::integer AS lpn_activos,

  -- Peso: el del NIVEL en el que está guardada la mercadería (incluye embalaje) y, si esa
  -- presentación no está medida, el viejo `productos.peso_kg × unidades base`.
  -- ⚠ `il.cantidad` es integer y `factor_base` bigint: sin el cast a numeric Postgres hace
  -- DIVISIÓN ENTERA y trunca. 48 unidades en cajas de 10 darían 4 bultos en vez de 4,8 → el peso
  -- sale ~17% CORTO, en el dato que decide si un rack está sobrecargado. Un stock que no es
  -- múltiplo exacto del bulto es lo normal apenas se pickea una caja.
  COALESCE(SUM(
    CASE WHEN COALESCE(pp.peso_kg, 0) > 0
      THEN (il.cantidad::numeric / NULLIF(pp.factor_base, 0)) * pp.peso_kg
      ELSE il.cantidad * COALESCE(p.peso_kg, 0)
    END
  ), 0)::numeric AS peso_kg,

  count(*) FILTER (
    WHERE COALESCE(pp.peso_kg, 0) > 0 OR COALESCE(p.peso_kg, 0) > 0
  )::integer AS lineas_con_peso,

  count(*)::integer AS lineas_total,

  -- Volumen: "4 cajas" ocupa 4 × el volumen de la caja, no 48 × el de la unidad suelta.
  COALESCE(SUM(
    CASE WHEN COALESCE(pp.alto_cm,0) > 0 AND COALESCE(pp.ancho_cm,0) > 0 AND COALESCE(pp.largo_cm,0) > 0
      THEN (pp.alto_cm * pp.ancho_cm * pp.largo_cm / 1000000.0)
           * (il.cantidad::numeric / NULLIF(pp.factor_base, 0))
      ELSE 0 END
  ), 0)::numeric AS volumen_m3,

  count(*) FILTER (WHERE COALESCE(pp.alto_cm,0) > 0 AND COALESCE(pp.ancho_cm,0) > 0
                     AND COALESCE(pp.largo_cm,0) > 0)::integer AS lineas_con_volumen
FROM inventario_lineas il
JOIN productos p ON p.id = il.producto_id
-- LATERAL + LIMIT 1: como mucho UNA presentación por línea. Con hermanas ("Caja-12"/"Caja-10", mismo
-- empaque "Caja") un JOIN normal devolvería 2 filas y duplicaría el conteo de LPN y el peso.
LEFT JOIN LATERAL (
  SELECT pp2.factor_base, pp2.peso_kg, pp2.alto_cm, pp2.ancho_cm, pp2.largo_cm
  FROM producto_presentaciones pp2
  WHERE pp2.producto_id = il.producto_id
    AND pp2.tenant_id = il.tenant_id   -- defensa en profundidad (la FK del producto ya lo ata)
    AND pp2.activo = true
    AND (pp2.nombre_empaque_id = il.unidad_medida_id OR pp2.es_base)
  ORDER BY
    -- 1º la presentación del empaque en el que entró la línea (la base no tiene empaque: es la
    -- unidad suelta, así que para una línea sin UoM esta condición es falsa en todas y manda el 3º).
    (pp2.nombre_empaque_id IS NOT NULL AND pp2.nombre_empaque_id = il.unidad_medida_id) DESC,
    -- 2º entre HERMANAS del mismo empaque, la que coincide con el factor del ingreso original.
    --    Es solo un desempate: `cantidad_uom` puede haber quedado viejo, por eso nunca decide la
    --    cantidad, y si no coincide con ninguna se sigue de largo al criterio 3º.
    (COALESCE(il.cantidad_uom, 0) > 0
       AND pp2.factor_base = round(il.cantidad / NULLIF(il.cantidad_uom, 0))) DESC,
    pp2.es_base DESC,
    pp2.orden
  LIMIT 1
) pp ON true
WHERE il.activo = true AND il.ubicacion_id IS NOT NULL
GROUP BY il.tenant_id, il.ubicacion_id;

COMMENT ON VIEW vw_ubicacion_ocupacion IS
  'Ocupación real de cada ubicación (migs 321/322/325): LPN activos, peso y VOLUMEN en m³ de lo guardado, sobre la presentación en la que está la mercadería (identificada por el EMPAQUE de la línea, no por un id de presentación — ver mig 325) y con la cantidad derivada del stock ACTUAL, no del snapshot de ingreso. lineas_con_peso/lineas_con_volumen/lineas_total dan la COBERTURA: si faltan medidas el total queda corto y hay que decirlo.';

REVOKE ALL ON vw_ubicacion_ocupacion FROM PUBLIC, anon;
GRANT SELECT ON vw_ubicacion_ocupacion TO authenticated, service_role;
