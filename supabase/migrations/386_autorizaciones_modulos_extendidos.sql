-- 386: Prerequisito técnico para extender el patrón de Supervisión (cola de aprobación) a más
-- módulos, según relevamiento `relevamiento-supervision-retrofit-reglas-negocio.html` respondido
-- 100% por Fede el 2026-08-20 (A4/A5). Hoy `autorizaciones.modulo` está fijo a 'inventario'
-- (CHECK), lo que bloquea insertar filas para Productos/Ventas/Clientes/Envíos/Proveedores/
-- Pedidos/RRHH. Cambio puramente aditivo: ningún código hoy inserta un modulo distinto de
-- 'inventario', así que esto no altera comportamiento existente.
--
-- De paso se elimina el CHECK rígido de `tipo` (mismo criterio ya usado en el proyecto para
-- enums que crecen por módulo — ver `reference_check_constraint_vs_configurable`): cada módulo va
-- a tener su propio conjunto de `tipo` (ventas: 'eliminar_venta_despachada'; clientes/envíos/
-- proveedores/pedidos/rrhh: 'eliminar'; productos: 'kit_precio'/'repricing_margen', ya existentes)
-- y mantener un solo CHECK gigante por-módulo es más frágil que validar en la app.
--
-- Esta migración NO reclasifica filas existentes de kit_precio/repricing_margen a
-- modulo='productos' (A4) ni migra autorizaciones_gasto a esta tabla genérica (C1) — eso implica
-- mover UI real entre InventarioPage/ProductosPage y GastosPage, queda para una fase dedicada.

ALTER TABLE public.autorizaciones DROP CONSTRAINT IF EXISTS autorizaciones_modulo_check;
ALTER TABLE public.autorizaciones ADD CONSTRAINT autorizaciones_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'inventario'::text, 'productos'::text, 'ventas'::text, 'clientes'::text,
    'envios'::text, 'proveedores'::text, 'pedidos'::text, 'rrhh'::text
  ]));

ALTER TABLE public.autorizaciones DROP CONSTRAINT IF EXISTS autorizaciones_inventario_tipo_check;
