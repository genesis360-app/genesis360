-- ============================================================
-- 306_tiers_mayorista_operador.sql
-- FASE 2-bis del rediseño UoM/Empaque/Variantes (respuestas finales de Fede, 2026-07-24).
--
-- 🛑 TOCA PLATA (Regla #0). Los tiers de precio mayorista (producto_precios_mayorista, mig 092)
-- eran solo umbral abierto (precio si cantidad >= cantidad_minima). Fede pidió un campo OPERADOR
-- por regla ('>','<','=','>=','<=') para poder expresar reglas cerradas como "= 800 unidades =
-- un pallet completo", no solo umbrales. Regla de resolución: se evalúan en el ORDEN que el
-- usuario las carga (orden asc), gana la primera que matchea; si ninguna aplica, precio base por
-- unidad. La cantidad que se compara es el TOTAL del SKU en el carrito (agregación por SKU, no por
-- línea) — eso lo resuelve el POS (precioTier en src/lib/tiers.ts).
--
-- ES ADITIVA: operador default '>=' + orden backfilleado por cantidad_minima → el comportamiento
-- de los tiers existentes NO cambia (>= era exactamente lo que hacían). `cantidad_minima` conserva
-- el nombre legacy pero ahora es el VALOR de comparación (el operador decide la comparación).
-- ============================================================

ALTER TABLE producto_precios_mayorista
  ADD COLUMN IF NOT EXISTS operador text NOT NULL DEFAULT '>=',
  ADD COLUMN IF NOT EXISTS orden    int  NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'producto_precios_mayorista_operador_chk') THEN
    ALTER TABLE producto_precios_mayorista
      ADD CONSTRAINT producto_precios_mayorista_operador_chk
      CHECK (operador IN ('>','<','=','>=','<='));
  END IF;
END $$;

COMMENT ON COLUMN producto_precios_mayorista.cantidad_minima IS
  'Valor de cantidad (en unidades BASE) con el que se compara según `operador`. Nombre legacy (antes solo umbral >=). Ver mig 306.';
COMMENT ON COLUMN producto_precios_mayorista.operador IS
  'Comparación de la regla contra la cantidad total del SKU en el carrito: >, <, =, >=, <= (default >=). Ver mig 306.';
COMMENT ON COLUMN producto_precios_mayorista.orden IS
  'Orden de evaluación (asc). Gana el PRIMER tier que matchea; si ninguno, precio base por unidad. Ver mig 306.';

-- Backfill: el POS viejo (VentasPage) iteraba los tiers asc y PISABA sin cortar → ganaba el tier
-- de MAYOR cantidad_minima que la cantidad satisfacía (descuento por volumen). El algoritmo nuevo
-- (precioTier en src/lib/tiers.ts) es "gana el PRIMER match en `orden` asc". Para reproducir el
-- resultado viejo con operador '>=', el tier de MAYOR cantidad_minima debe evaluarse PRIMERO →
-- se asigna `orden` por cantidad_minima DESC (mayor umbral = orden 0). 🛑 (bug de plata que
-- encontró el migration-reviewer: con orden ASC, comprar 60 con tiers 10→$90 y 50→$80 cobraba $90).
WITH ordenados AS (
  SELECT id, row_number() OVER (PARTITION BY producto_id ORDER BY cantidad_minima DESC) - 1 AS n
  FROM producto_precios_mayorista
)
UPDATE producto_precios_mayorista p
SET orden = o.n
FROM ordenados o
WHERE o.id = p.id AND p.orden = 0;

-- La UNIQUE(producto_id, cantidad_minima) de mig 092 impide dos reglas con la misma cantidad y
-- distinto operador (ej. '= 100' y '>= 100'), que ahora son válidas. Se relaja a incluir el
-- operador (sigue evitando reglas idénticas duplicadas).
DO $$
DECLARE v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'producto_precios_mayorista'::regclass AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%cantidad_minima%' AND pg_get_constraintdef(oid) NOT LIKE '%operador%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE producto_precios_mayorista DROP CONSTRAINT %I', v_conname);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'producto_precios_mayorista_regla_unica'
  ) THEN
    ALTER TABLE producto_precios_mayorista
      ADD CONSTRAINT producto_precios_mayorista_regla_unica
      UNIQUE (producto_id, cantidad_minima, operador);
  END IF;
END $$;
