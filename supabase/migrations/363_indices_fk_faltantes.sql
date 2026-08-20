-- ============================================================
-- 363_indices_fk_faltantes.sql
-- Auditoría de performance/calidad (2026-08-14), ítem #3 del top 5 backend — índices FK
-- faltantes en rutas calientes de uso diario (Picking, Repositores, Pedidos).
--
-- P1 (wms_tareas / tareas_repositor): la query de "mis tareas" en Picking/Repositores filtra
-- siempre por `tenant_id` + `estado` + `usuario_asignado_id` (ver PickingPage.tsx:83-95: tenant
-- + estado IN (...) + OR usuario_asignado_id IS NULL/=user.id) — hoy resuelve el último filtro
-- sin índice dedicado, con seq scan sobre lo que ya filtró tenant+estado. Compuesto (no columna
-- suelta) porque tenant_id/estado siempre están presentes en la query real — un índice que
-- matchee el shape completo sirve más que tres índices sueltos.
--
-- P2 (pedido_items / zonas): pedido_items tenía índice en pedido_id/producto_id/estado (texto)
-- pero no en tenant_id (toda policy RLS lo filtra) ni estado_id (FK a estados_inventario, modo
-- avanzado). zonas no tenía NINGÚN índice más allá de la PK pese a 2 FKs.
--
-- Todo aditivo, sin riesgo — solo CREATE INDEX, nada que pueda romper una query existente.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_wms_tareas_tenant_estado_usuario
  ON public.wms_tareas USING btree (tenant_id, estado, usuario_asignado_id);

CREATE INDEX IF NOT EXISTS idx_tareas_repositor_tenant_estado_usuario
  ON public.tareas_repositor USING btree (tenant_id, estado, usuario_asignado_id);

CREATE INDEX IF NOT EXISTS idx_pedido_items_tenant
  ON public.pedido_items USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_pedido_items_estado_id
  ON public.pedido_items USING btree (estado_id)
  WHERE estado_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zonas_tenant
  ON public.zonas USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_zonas_sucursal
  ON public.zonas USING btree (sucursal_id)
  WHERE sucursal_id IS NOT NULL;
