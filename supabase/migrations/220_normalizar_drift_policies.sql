-- migration 220: normalizar drift cosmético de policies DEV↔PROD (cero cambio de comportamiento)
--
-- CONTEXTO: tras el fix de `notificaciones` (mig 219) se hizo un barrido completo de `pg_policies`
-- comparando DEV vs PROD. Aparecieron 4 tablas con diferencias **cosméticas** acumuladas por tweaks
-- fuera de banda a lo largo del tiempo (nombres distintos, una policy duplicada, helper vs expresión
-- inline equivalente). Ninguna divergía en comportamiento ni seguridad, pero rompían la regla
-- "DEV == PROD == repo". Esta migración las deja idénticas en ambos entornos y alineadas a
-- schema_full.sql. Idempotente (DROP IF EXISTS + CREATE) → segura de correr en cualquier estado.
--
-- Verificado: is_admin() es idéntica en DEV y PROD →
--   SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND rol = 'ADMIN')
-- por lo tanto "OR is_admin()" ≡ "OR EXISTS(... rol='ADMIN')". El cambio es de forma, no de fondo.

-- 1) clientes — canónico = UNA sola policy `clientes_tenant` (repo). PROD tenía además una
--    `tenant_isolation` duplicada (mismo scoping). Quitamos la duplicada y dejamos la canónica.
DROP POLICY IF EXISTS tenant_isolation ON clientes;
DROP POLICY IF EXISTS clientes_tenant  ON clientes;
CREATE POLICY clientes_tenant ON clientes FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 2) gasto_cuotas — la policy NUNCA estuvo en una migración (mig 097 solo hizo ENABLE RLS), así que
--    se creó a mano con nombres distintos: DEV `tenant_isolation`, PROD `gasto_cuotas_tenant`.
--    Canónico = `gasto_cuotas_tenant` (convención `<tabla>_tenant`, como clientes/productos/ventas).
DROP POLICY IF EXISTS tenant_isolation    ON gasto_cuotas;
DROP POLICY IF EXISTS gasto_cuotas_tenant ON gasto_cuotas;
CREATE POLICY gasto_cuotas_tenant ON gasto_cuotas FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 3) productos_select — canónico usa el helper is_admin() (PROD tenía la expresión inline equivalente).
DROP POLICY IF EXISTS productos_select ON productos;
CREATE POLICY productos_select ON productos FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()) OR is_admin());

-- 4) tenants_select — idem, canónico con is_admin().
DROP POLICY IF EXISTS tenants_select ON tenants;
CREATE POLICY tenants_select ON tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM users WHERE id = auth.uid()) OR is_admin());
