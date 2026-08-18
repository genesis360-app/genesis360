-- ============================================================
-- 366_rls_auth_uid_select_wrap.sql
-- Auditoría de performance/calidad (2026-08-14), hallazgo BE Q1 — antipattern de RLS
-- documentado oficialmente por Supabase: `auth.uid()` usado directo en vez de
-- `(select auth.uid())` fuerza reevaluación fila por fila del predicado en vez de una sola
-- vez por query (initPlan). Cambio puramente mecánico: mismo predicado, solo envuelto en
-- SELECT — no cambia ningún permiso ni comportamiento.
--
-- Único lugar del schema donde sobrevivía el patrón viejo (el resto de las ~150 policies ya
-- usa `( SELECT auth.uid() AS uid)`, ver pg_policies): 4 policies en 3 tablas.
--
-- DROP + CREATE porque ALTER POLICY no permite reemplazar USING/WITH CHECK.
-- ============================================================

-- autorizaciones_reglas_enrutamiento -----------------------------------------------------
DROP POLICY IF EXISTS autorizaciones_reglas_enrutamiento_select ON public.autorizaciones_reglas_enrutamiento;
CREATE POLICY autorizaciones_reglas_enrutamiento_select ON public.autorizaciones_reglas_enrutamiento
  AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS autorizaciones_reglas_enrutamiento_write ON public.autorizaciones_reglas_enrutamiento;
CREATE POLICY autorizaciones_reglas_enrutamiento_write ON public.autorizaciones_reglas_enrutamiento
  AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = (select auth.uid())))) AND (get_user_role() = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text]))))
  WITH CHECK (((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = (select auth.uid())))) AND (get_user_role() = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text]))));

-- cupones ---------------------------------------------------------------------------------
DROP POLICY IF EXISTS cupones_tenant ON public.cupones;
CREATE POLICY cupones_tenant ON public.cupones
  AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS cupones_codigos_tenant ON public.cupones_codigos;
CREATE POLICY cupones_codigos_tenant ON public.cupones_codigos
  AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = (select auth.uid())))));
