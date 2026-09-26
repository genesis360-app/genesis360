-- 436 — Ampliar el tope del margen de producto: numeric(5,2) → numeric(8,2)
--
-- Hallazgo D-2 del importador de productos. Decidido por GO el 2026-09-25.
--
-- `productos.margen_ganancia` es una columna GENERATED ALWAYS
-- (`round((precio_venta - precio_costo) / precio_costo * 100, 2)`) declarada `numeric(5,2)`: techo
-- 999,99 %, es decir, vender a más de ~11× el costo. Al pasarse, el producto NO SE PUEDE GUARDAR
-- ("numeric field overflow") — la app rechaza un precio legítimo, no es un número mal mostrado.
-- El caso es cotidiano: un café de $30 vendido a $1.500 da 4.900 %.
--
-- Medido antes de escribir esto: máximo real 200 % en PROD y 400 % en DEV. Nadie cerca del techo,
-- así que el cambio no altera ningún dato existente.
--
-- · Las DOS columnas: `margen_objetivo` es manual y tenía el mismo techo, así que un objetivo de
--   markup alto fallaba igual.
-- · numeric(8,2) → hasta 999.999,99 % (vender a 10.000× el costo). Un margen por encima de eso es
--   un error de carga, no un precio: ahí el guard de la app sigue frenando (`MARGEN_MAX_PCT`).
-- · 🛑 NO se tocan las demás `numeric(5,2)` (`descuento_pct`, `comision_pct`, `repricing_tope_pct`,
--   `reserva_*_pct`, `precio_ajuste_meli_pct`/`_tn_pct`): son descuentos y comisiones, ahí 100 %
--   es un techo legítimo.
--
-- El ALTER funciona aun siendo columna generada (verificado en DEV en una transacción descartada).
-- Ninguna vista depende de estas columnas y las funciones que las leen (`fn_precio_para_margen`,
-- `fn_evaluar_repricing_margen`) toman `numeric` sin precisión.

ALTER TABLE public.productos ALTER COLUMN margen_ganancia TYPE numeric(8,2);
ALTER TABLE public.productos ALTER COLUMN margen_objetivo  TYPE numeric(8,2);
