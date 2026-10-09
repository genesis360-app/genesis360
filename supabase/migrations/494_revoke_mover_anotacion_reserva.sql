-- 494 — fn_venta_reservas_mover_anotacion solo para funciones internas (seguridad multi-tenant, REGLA #0 inventario)
--
-- Hallazgo del code-review de v1.242.0: la función (mig 488) es SECURITY DEFINER, no controla tenant ni sucursal y tenía
-- EXECUTE para `authenticated` → un usuario de OTRO negocio que conociera los UUID podía mover la anotación de reserva de una
-- venta ajena a otro LPN (desalineando venta_item_reservas de cantidad_reservada). Solo la llama fn_unpick_tarea_wms, que es
-- DEFINER desde la mig 491 (corre como owner): no necesita el permiso del usuario.

REVOKE ALL ON FUNCTION public.fn_venta_reservas_mover_anotacion(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_venta_reservas_mover_anotacion(uuid, uuid, uuid, integer) TO service_role;
