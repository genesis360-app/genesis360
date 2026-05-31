-- Migration 156: persistir el plan de LPN elegido en el carrito (reservas)
--
-- Problema: venta_items solo guarda linea_id (el LPN "principal"). Cuando una
-- venta se crea como RESERVA y el operador eligió manualmente de qué LPN sale
-- cada unidad, esa selección se reserva correctamente en cantidad_reservada
-- (registrarVenta Fase A/B) pero NO se persiste. Al despachar la reserva más
-- tarde (cambiarEstado reserva→despacho), el código re-consulta y ordena por el
-- sort automático, despachando de un LPN distinto al elegido.
--
-- Esta columna persiste el plan completo: [{linea_id, lpn, cantidad, manual}].
-- `manual` = el operador eligió ese LPN explícitamente (origen='manual' en el
-- desglose); el resto del plan lo autocompletó la regla de rebaje ('auto').
-- Al despachar se honra este plan (Fase A) y se autocompleta por sort solo si el
-- stock cambió (Fase B) — igual patrón que la venta directa.
--
-- Aditiva/nullable: ventas existentes y venta directa quedan con lpn_plan NULL
-- (despacho cae al sort automático, comportamiento previo). Items serializados
-- siempre NULL (se trazan vía venta_series / inventario_series).

ALTER TABLE venta_items
  ADD COLUMN IF NOT EXISTS lpn_plan JSONB;

COMMENT ON COLUMN venta_items.lpn_plan IS
  'Plan de LPN del carrito para reservas: [{linea_id, lpn, cantidad, manual}]. Se honra al despachar la reserva (Fase A) + autocompleta por sort si cambió el stock (Fase B). NULL = venta directa / items serializados / ventas legacy.';
