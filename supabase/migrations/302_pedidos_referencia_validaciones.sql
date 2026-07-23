-- ============================================================
-- 302_pedidos_referencia_validaciones.sql
-- Módulo Pedidos — ronda de validaciones de creación pedida por GO (2026-07-23):
--
-- 1) `pedidos.referencia` — Nº externo / referencia del cliente (texto libre, ej. la OC del
--    comprador "OC-ACME-123"). Decisión de diseño explícita de GO: el correlativo interno
--    (`numero`/`numero_sucursal`, trigger `set_pedido_numero`) queda INTOCABLE y siempre
--    automático; el número "manual" vive en este campo aparte. Evita los dos problemas del
--    número manual en el mismo campo: huecos en la secuencia y colisiones (hoy `numero` no
--    tiene constraint de unicidad — un manual duplicado entraría en silencio).
--
-- 2) Seed de `tipos_pedido`: GO pidió que el default de los tipos venga en "cliente
--    obligatorio" — se actualiza la función de seed para tenants NUEVOS (los 4 tipos nacen
--    con cliente_obligatorio=true). Los tenants existentes conservan su configuración actual
--    (es config por tenant desde C3 — editable en Config → Pedidos, no se pisa retroactivamente).
--
-- El resto de las validaciones de esta ronda (estado de inventario obligatorio si el tenant
-- usa estados + precarga del default del producto, fecha de entrega obligatoria, cantidad
-- entera según UoM vía `esDecimal` compartido con Ventas, líneas duplicadas diferenciadas,
-- aviso no bloqueante de stock al armar — H2 del relevamiento) son client-side en
-- `PedidosPage.tsx`: ninguna mueve stock/plata al crear (el borrador es solo intención;
-- los guards duros server-side siguen en `fn_generar_tareas_picking_pedido` al Lanzar).
-- ============================================================

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS referencia text;

COMMENT ON COLUMN pedidos.referencia IS
  'Nº externo / referencia del cliente (texto libre, ej. su OC de compra). El correlativo interno es numero/numero_sucursal (trigger) y nunca se pisa manualmente.';

-- Seed de tipos para tenants nuevos: todos nacen con cliente obligatorio (decisión GO
-- 2026-07-23). Sigue siendo editable por tipo en Config → Pedidos (C3).
CREATE OR REPLACE FUNCTION seed_tipos_pedido(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tipos_pedido (tenant_id, nombre, factura_momento, cliente_obligatorio, orden) VALUES
    (p_tenant_id, 'Mayorista',           'al_confirmar', true, 10),
    (p_tenant_id, 'E-commerce',          'al_entregar',  true, 20),
    (p_tenant_id, 'Encargo telefónico',  'al_entregar',  true, 30),
    (p_tenant_id, 'Retiro en local',     'al_entregar',  true, 40)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

-- Defensa en profundidad: CREATE OR REPLACE preserva el ACL previo (la función ya venía
-- revocada desde la mig 292), pero se repite el REVOKE para que el archivo quede autocontenido
-- — es SECURITY DEFINER y bypassea RLS, no debe ser invocable por un usuario autenticado.
REVOKE EXECUTE ON FUNCTION seed_tipos_pedido(uuid) FROM PUBLIC, anon, authenticated;
