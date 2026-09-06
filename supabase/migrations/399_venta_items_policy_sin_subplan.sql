-- 399 — `venta_items`: sacar el EXISTS residual de la policy (cierra E4-h2)
--
-- La 398 denormalizó `sucursal_id` y dejó el EXISTS original como red de seguridad para filas sin
-- denormalizar. **Se midió y seguía costando lo mismo (51 ms vs 48 ms)**: el tenant tiene 39 ventas
-- GLOBALES (`ventas.sucursal_id IS NULL`), sus ítems quedan con `sucursal_id IS NULL` — que es el
-- valor correcto, no una falta de backfill— y esas filas entraban a la rama del fallback, forzando
-- a Postgres a construir igual el hashed SubPlan sobre las 558 ventas. La red de seguridad se
-- disparaba en el caso NORMAL.
--
-- Y era redundante, porque con la columna en sincronía las dos ramas dan idéntico resultado:
--   vi.sucursal_id IS NULL  ⟺  v.sucursal_id IS NULL  ⟹ venta global ⟹ visible para todo el tenant
--   vi.sucursal_id = mía                              ⟹ visible
--   cualquier otro caso                               ⟹ no visible
-- Que es exactamente lo que decía `EXISTS (… v.sucursal_id IS NULL OR v.sucursal_id = mía)`.
--
-- Verificado ANTES de simplificar (no asumido):
--   select count(*) from venta_items vi join ventas v on v.id = vi.venta_id
--    where vi.sucursal_id is distinct from v.sucursal_id;   → 0
--
-- Riesgo residual y su control: si el trigger de la 398 fallara, una fila sin denormalizar quedaría
-- con `sucursal_id IS NULL` y se vería como global → fail-open DENTRO del tenant (nunca entre
-- tenants: `tenant_id` se evalúa primero). Se prefiere ese modo de falla al inverso —esconder ítems
-- de una venta es un problema fiscal, mostrar de más a un compañero de otra sucursal no—, y queda
-- cubierto por el chequeo de sincronía en la spec 141.

BEGIN;

DROP POLICY IF EXISTS venta_items_tenant ON public.venta_items;

CREATE POLICY venta_items_tenant ON public.venta_items
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.auth_ve_todas_sucursales()
      OR venta_id IS NULL
      OR sucursal_id IS NULL                          -- venta global: visible para todo el tenant
      OR sucursal_id = public.auth_user_sucursal()
    )
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

COMMIT;
