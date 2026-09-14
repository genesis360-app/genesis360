-- 417 — Quién puede crear, renombrar y borrar ubicaciones de Recursos
--
-- Decisión de GO (2026-09-14):
--   > "solo dueño o admin o alguien que el dueño le asigne un custom rol que lo permita"
--
-- Hasta acá la policy de escritura del catálogo (mig 407) era un allowlist fijo:
-- DUEÑO / ADMIN / SUPER_USUARIO. Le faltaba la tercera mitad de la regla: un rol custom al que el
-- DUEÑO le habilitó Recursos para editar.
--
-- `auth_puede_editar_modulo('recursos')` ya resuelve EXACTAMENTE eso, con el mismo criterio que la
-- mig 405 usó para Gastos:
--   · rol custom con permiso EXPLÍCITO para 'recursos' → manda ese permiso ('editar'/'supervisa' sí;
--     'ver'/'no_ver' no);
--   · VIEWER → no;
--   · DUEÑO / SUPER_USUARIO / ADMIN → sí;
--   · el resto de los roles fijos → no ('recursos' no está en el allowlist operativo: SUPERVISOR,
--     CAJERO, DEPÓSITO, RRHH y CONTADOR no crean ubicaciones).
-- Verificado leyendo la función (mig 405) antes de escribir esto.
--
-- Esta migración es compatible con el frontend anterior: solo cambia quién puede escribir el
-- catálogo. Lo que lo motiva es el paso siguiente — `RecursosPage` pasa a guardar `ubicacion_id`
-- (y a crear la ubicación en el catálogo cuando se elige "+ Nueva ubicación"), en vez del texto
-- libre de `recursos.ubicacion`, que se dropea en una migración posterior.

DROP POLICY IF EXISTS recurso_ubicaciones_write_gestion ON public.recurso_ubicaciones;

CREATE POLICY recurso_ubicaciones_write_gestion ON public.recurso_ubicaciones
  FOR ALL
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('recursos'))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('recursos'));
