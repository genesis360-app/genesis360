-- ============================================================
-- 311_limpieza_grupos_deprecados.sql
-- FASE 5 del rediseño UoM/Empaque/Variantes — chunk C (limpieza).
--
-- Da de baja el modelo VIEJO de variantes (`producto_grupos` + `productos.grupo_id` +
-- `productos.variante_valores`, mig 120), ya reemplazado por la auto-referencia madre/hijo
-- `productos.producto_padre_id` + `variante_diferenciador` (mig 305).
--
-- ⚠ NO confundir con el "Eje A" (atributos de variante a nivel LPN: talle/color/formato en
-- `inventario_lineas` + la tabla `atributos_variante_valores`). Eso COEXISTE por decisión de GO
-- y NO se toca acá.
--
-- Antes de dropear `variante_valores` se PRESERVA el dato de los productos que quedaron sin
-- migrar: en DEV es uno solo (un grupo de 1 producto, que la mig 305 dejó standalone a propósito
-- porque un grupo de un solo producto no es una variante real). Su talle/color se vuelca a
-- `notas` para no perderlo en silencio.
--
-- También se cierra la última puerta de escritura al modelo lineal de empaque: se revoca
-- `fn_estructura_guardar_niveles` de `authenticated`. Desde la mig 310 la fuente de verdad es
-- `producto_presentaciones` y el frontend ya escribe por `fn_presentaciones_guardar`; dejar viva
-- la RPC vieja permitiría "guardar bien" una conversión que nadie leería → drift silencioso.
-- ============================================================

-- ── 1) Preservar lo que no se migró ──────────────────────────────────────────────────────
UPDATE productos p
SET notas = btrim(
      COALESCE(NULLIF(btrim(p.notas), '') || E'\n', '') ||
      'Variante (dato histórico, mig 311): ' || (
        SELECT string_agg(kv.key || ': ' || kv.value, ' / ' ORDER BY kv.key)
        FROM jsonb_each_text(p.variante_valores) kv
        WHERE btrim(kv.value) <> ''
      )
    )
WHERE p.variante_valores IS NOT NULL
  -- `jsonb_each_text` explota con un escalar/array. En DEV todos son objetos, pero en PROD la
  -- forma del dato no está verificada y un error acá abortaría una migración destructiva a medias.
  AND jsonb_typeof(p.variante_valores) = 'object'
  AND p.variante_valores::text <> '{}'
  AND p.producto_padre_id IS NULL            -- los hijos ya tienen `variante_diferenciador`
  AND (p.notas IS NULL OR p.notas NOT LIKE '%mig 311%')   -- no duplicar la nota en un reintento
  AND EXISTS (                                -- y solo si queda algún valor no vacío que preservar
    SELECT 1 FROM jsonb_each_text(p.variante_valores) kv WHERE btrim(kv.value) <> ''
  );

-- ── 2) Dropear el modelo viejo ───────────────────────────────────────────────────────────
-- `productos.grupo_id` tiene FK a producto_grupos: hay que sacarla antes de dropear la tabla.
ALTER TABLE productos DROP COLUMN IF EXISTS grupo_id;
ALTER TABLE productos DROP COLUMN IF EXISTS variante_valores;
DROP TABLE IF EXISTS producto_grupos;

-- ── 3) Cerrar la escritura al modelo de empaque lineal (deprecado en mig 310) ────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_estructura_guardar_niveles'
  ) THEN
    REVOKE ALL ON FUNCTION public.fn_estructura_guardar_niveles(uuid, jsonb) FROM authenticated;
    REVOKE ALL ON FUNCTION public.fn_estructura_guardar_niveles(uuid, jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public.fn_estructura_guardar_niveles(uuid, jsonb) FROM PUBLIC;
    COMMENT ON FUNCTION public.fn_estructura_guardar_niveles(uuid, jsonb) IS
      'DEPRECADA (mig 310/311) — escribía la cadena lineal producto_estructura_niveles, que ya no es la fuente de verdad del empaque. Reemplazada por fn_presentaciones_guardar. Sin GRANT a authenticated para que ninguna pantalla vieja pueda guardar una conversión que nadie lee.';
  END IF;
END $$;

COMMENT ON COLUMN productos.producto_padre_id IS
  'Variante madre/hijo (rediseño UoM Fase 3): NULL = madre o producto standalone; con valor = hijo de esa madre. Único modelo de variantes desde la mig 311 (producto_grupos/grupo_id/variante_valores fueron dropeadas).';
