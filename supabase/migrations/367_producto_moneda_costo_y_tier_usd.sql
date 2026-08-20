-- Migration 367: fix bugs reales de moneda en ficha de Producto (reportados por Fede, 2026-08-18)
--
-- Bug 1: los tiers de precio mayorista (producto_precios_mayorista.tipo_valor) solo admiten
--   'precio_fijo' (siempre pesos) o 'pct' (relativo, ya funciona en cualquier moneda). Falta 'usd'
--   para que un tier pueda fijarse en dólares y convertirse a la cotización vigente, igual que ya
--   hace precio_usd/moneda_venta (mig 161) para el precio de lista.
--
-- Bug 2 (🛑 más grave — pérdida real de datos): la ficha de producto tenía un toggle "Ingresar en
--   USD" para costo Y venta que convertía a pesos al tipear pero nunca persistía que el origen era
--   USD — al reabrir el producto, el monto USD original se perdía para siempre, solo sobrevivía el
--   peso congelado a la cotización del momento de carga. Ya existe el mecanismo correcto para venta
--   (precio_usd/moneda_venta, mig 161) — falta el equivalente para costo. Se agrega
--   moneda_costo/precio_costo_usd, mismo patrón exacto.
--
-- Nota: las columnas precio_costo_moneda/precio_venta_moneda (mig 007) NO se tocan acá — son un
-- mecanismo distinto y hoy huérfano (solo las escribe/lee el importador CSV, ningún otro consumidor
-- de precio_costo/precio_venta las respeta) — queda señalado aparte para GO, no se mezcla con este fix.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS moneda_costo     TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS precio_costo_usd DECIMAL(12,2);

-- Tiers mayoristas en USD
ALTER TABLE producto_precios_mayorista DROP CONSTRAINT IF EXISTS producto_precios_mayorista_tipo_valor_chk;
ALTER TABLE producto_precios_mayorista ADD CONSTRAINT producto_precios_mayorista_tipo_valor_chk
  CHECK (tipo_valor = ANY (ARRAY['precio_fijo'::text, 'pct'::text, 'usd'::text]));

-- fn_precio_venta_efectivo: espejo SQL de src/lib/tiers.ts (resolverBloquesTier/precioUnitarioDeTier).
-- Agrega la rama 'usd' (t.precio × cotización del tenant) en los 4 lugares que resuelven precio de
-- tier — sin cotización cargada, no se puede convertir con seguridad: el tier no se aplica (precio
-- de lista), mismo criterio defensivo que ya usa la lib TS.
CREATE OR REPLACE FUNCTION public.fn_precio_venta_efectivo(p_tenant_id uuid, p_producto_id uuid, p_cantidad numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_precio_lista       numeric;
  v_cotizacion         numeric;
  v_modo               text;
  v_paso               numeric;
  v_t                  RECORD;
  v_precio_u           numeric;
  v_mejor_ligado_precio numeric;
  v_mejor_ligado_cant  numeric;
  v_n_multiplos        numeric;
  v_resto              numeric;
  v_precio_bloque      numeric;
  v_precio_resto       numeric;
  v_precio_final       numeric;
BEGIN
  SELECT COALESCE(precio_venta, 0) INTO v_precio_lista
  FROM productos WHERE id = p_producto_id AND tenant_id = p_tenant_id;
  IF v_precio_lista IS NULL THEN RETURN 0; END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RETURN v_precio_lista; END IF;

  SELECT cotizacion_usd INTO v_cotizacion FROM tenants WHERE id = p_tenant_id;

  v_mejor_ligado_precio := NULL;

  -- Tiers ENLAZADOS a una presentación de empaque: cantidad_minima se compara contra MÚLTIPLOS
  -- completos (floor(cantidad total / factor_base)), no contra unidades sueltas.
  FOR v_t IN
    SELECT ppm.cantidad_minima, ppm.precio, ppm.operador, ppm.tipo_valor, pp.factor_base
    FROM producto_precios_mayorista ppm
    JOIN producto_presentaciones pp ON pp.id = ppm.presentacion_id
    WHERE ppm.tenant_id = p_tenant_id AND ppm.producto_id = p_producto_id
      AND ppm.presentacion_id IS NOT NULL AND pp.factor_base > 0
  LOOP
    CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
    v_n_multiplos := floor(p_cantidad / v_t.factor_base);
    CONTINUE WHEN v_n_multiplos < 1;
    IF (CASE v_t.operador
          WHEN '>'  THEN v_n_multiplos >  v_t.cantidad_minima
          WHEN '<'  THEN v_n_multiplos <  v_t.cantidad_minima
          WHEN '='  THEN v_n_multiplos =  v_t.cantidad_minima
          WHEN '>=' THEN v_n_multiplos >= v_t.cantidad_minima
          WHEN '<=' THEN v_n_multiplos <= v_t.cantidad_minima
          ELSE false END)
    THEN
      v_precio_u := CASE
        WHEN v_t.tipo_valor = 'pct'
          THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
        WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
          THEN round(v_t.precio * v_cotizacion, 2)
        WHEN v_t.tipo_valor = 'usd'
          THEN v_precio_lista
        ELSE v_t.precio END;
      IF v_mejor_ligado_precio IS NULL OR v_precio_u < v_mejor_ligado_precio THEN
        v_mejor_ligado_precio := v_precio_u;
        v_mejor_ligado_cant := v_n_multiplos * v_t.factor_base;
      END IF;
    END IF;
  END LOOP;

  IF v_mejor_ligado_precio IS NULL THEN
    -- Sin bloque de empaque: comportamiento de SIEMPRE — gana el primer tier normal que matchea.
    v_precio_final := v_precio_lista;
    FOR v_t IN
      SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
      WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
      ORDER BY orden
    LOOP
      CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
      IF (CASE v_t.operador
            WHEN '>'  THEN p_cantidad >  v_t.cantidad_minima
            WHEN '<'  THEN p_cantidad <  v_t.cantidad_minima
            WHEN '='  THEN p_cantidad =  v_t.cantidad_minima
            WHEN '>=' THEN p_cantidad >= v_t.cantidad_minima
            WHEN '<=' THEN p_cantidad <= v_t.cantidad_minima
            ELSE false END)
      THEN
        v_precio_final := CASE
          WHEN v_t.tipo_valor = 'pct'
            THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
          WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
            THEN round(v_t.precio * v_cotizacion, 2)
          WHEN v_t.tipo_valor = 'usd'
            THEN v_precio_lista
          ELSE v_t.precio END;
        EXIT;
      END IF;
    END LOOP;
  ELSE
    -- El bloque de empaque compite contra el mejor tier NORMAL que también matchee esa cantidad.
    v_precio_bloque := v_mejor_ligado_precio;
    FOR v_t IN
      SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
      WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
      ORDER BY orden
    LOOP
      CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
      IF (CASE v_t.operador
            WHEN '>'  THEN v_mejor_ligado_cant >  v_t.cantidad_minima
            WHEN '<'  THEN v_mejor_ligado_cant <  v_t.cantidad_minima
            WHEN '='  THEN v_mejor_ligado_cant =  v_t.cantidad_minima
            WHEN '>=' THEN v_mejor_ligado_cant >= v_t.cantidad_minima
            WHEN '<=' THEN v_mejor_ligado_cant <= v_t.cantidad_minima
            ELSE false END)
      THEN
        v_precio_u := CASE
          WHEN v_t.tipo_valor = 'pct'
            THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
          WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
            THEN round(v_t.precio * v_cotizacion, 2)
          WHEN v_t.tipo_valor = 'usd'
            THEN v_precio_lista
          ELSE v_t.precio END;
        IF v_precio_u < v_precio_bloque THEN v_precio_bloque := v_precio_u; END IF;
        EXIT;
      END IF;
    END LOOP;

    v_resto := p_cantidad - v_mejor_ligado_cant;
    v_precio_resto := v_precio_lista;
    IF v_resto > 0 THEN
      FOR v_t IN
        SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
        WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
        ORDER BY orden
      LOOP
        CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
        IF (CASE v_t.operador
              WHEN '>'  THEN v_resto >  v_t.cantidad_minima
              WHEN '<'  THEN v_resto <  v_t.cantidad_minima
              WHEN '='  THEN v_resto =  v_t.cantidad_minima
              WHEN '>=' THEN v_resto >= v_t.cantidad_minima
              WHEN '<=' THEN v_resto <= v_t.cantidad_minima
              ELSE false END)
        THEN
          v_precio_resto := CASE
            WHEN v_t.tipo_valor = 'pct'
              THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
            WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
              THEN round(v_t.precio * v_cotizacion, 2)
            WHEN v_t.tipo_valor = 'usd'
              THEN v_precio_lista
            ELSE v_t.precio END;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    v_precio_final := round((v_mejor_ligado_cant * v_precio_bloque + GREATEST(v_resto, 0) * v_precio_resto) / p_cantidad, 2);
  END IF;

  SELECT precio_redondeo INTO v_modo FROM tenants WHERE id = p_tenant_id;
  v_paso := CASE v_modo WHEN '10' THEN 10 WHEN '50' THEN 50 WHEN '100' THEN 100
                        WHEN '500' THEN 500 WHEN '1000' THEN 1000 ELSE 0 END;
  IF v_paso > 0 AND v_precio_final > 0 THEN v_precio_final := round(v_precio_final / v_paso) * v_paso; END IF;
  RETURN v_precio_final;
END;
$function$
