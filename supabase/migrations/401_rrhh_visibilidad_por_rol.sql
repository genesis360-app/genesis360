-- 401 — Sueldos, CBU y DNI dejan de ser visibles para cualquier rol (Tanda F2)
--
-- 🔴 HALLAZGO (verificado con tokens reales de 6 roles el 2026-09-06): `rrhh_salarios` y `empleados`
-- tenían RLS **solo por tenant**, así que un CAJERO podía leer el **sueldo, el CBU y el DNI de todos
-- los empleados** con un `GET /rest/v1/empleados?select=salario_bruto,cbu,dni_rut`.
--
-- REGLA APROBADA POR GO (2026-09-07):
--   • DUEÑO / ADMIN / SUPER_USUARIO / RRHH → ven todo.
--   • SUPERVISOR → solo su equipo (`empleados.supervisor_id`).
--   • Cada empleado → solo lo suyo (su ficha y sus liquidaciones) — es lo que usa "Mi Portal".
--   • Las pantallas de COSTOS pasan a leer **agregados**, no filas de empleados.
--
-- Por qué NO alcanzaba con revocar columnas (como en la mig 400): los privilegios de columna son por
-- rol de BASE DE DATOS (`authenticated`), no por rol de la app — revocar `salario_bruto` se lo
-- sacaría también a RRHH, que lo necesita. Acá el gate correcto es RLS por fila.
--
-- Riesgo verificado ANTES de aplicar — quién lee hoy estas tablas y qué necesita:
--   `rrhh_salarios`
--     · RrhhReportesPanel  → detalle completo  → sigue por acceso directo (rol RRHH).
--     · MiPortalPage       → sus propias liquidaciones → rama "cada empleado ve lo suyo".
--     · DashGastosArea · RentabilidadPage · CierresContablesPanel → **solo suman** `neto` y cuentan
--       empleados distintos → pasan a `fn_sueldos_agregado()`.
--   `empleados`
--     · RrhhPage           → módulo completo   → rol RRHH.
--     · MiPortalPage       → su propia ficha   → rama "lo suyo".
--     · RepartidoresPanel · useRecomendaciones → solo nombre/apellido/teléfono/cumpleaños →
--       pasan a `fn_empleados_basico()`, que NO expone sueldo, CBU ni DNI.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Helper: ¿el usuario de la sesión administra RRHH?
--    (`is_rrhh()` ya existía pero solo contempla RRHH y DUEÑO; falta ADMIN/SUPER_USUARIO.)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_administra_rrhh()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = (SELECT auth.uid())
       AND rol = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO','RRHH'])
  )
$$;

COMMENT ON FUNCTION public.auth_administra_rrhh() IS
  'DUEÑO/ADMIN/SUPER_USUARIO/RRHH. Regla de visibilidad de RRHH aprobada por GO (mig 401).';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) `empleados`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS empleados_tenant ON public.empleados;
DROP POLICY IF EXISTS empleados_supervisor ON public.empleados;

CREATE POLICY empleados_select ON public.empleados
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.auth_administra_rrhh()
      OR user_id = (SELECT auth.uid())          -- su propia ficha (Mi Portal)
      OR supervisor_id = (SELECT auth.uid())    -- su equipo (conserva la policy vieja)
    )
  );

CREATE POLICY empleados_write ON public.empleados
  FOR ALL
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh())
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh());

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) `rrhh_salarios`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rrhh_salarios_tenant ON public.rrhh_salarios;

CREATE POLICY rrhh_salarios_select ON public.rrhh_salarios
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.auth_administra_rrhh()
      OR empleado_id IN (SELECT e.id FROM public.empleados e WHERE e.user_id = (SELECT auth.uid()))
    )
  );

CREATE POLICY rrhh_salarios_write ON public.rrhh_salarios
  FOR ALL
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh())
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh());

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Los dos accesos que quedan para el resto de la app, sin datos sensibles.
--    SECURITY DEFINER (no vistas) para no disparar el advisor de "SECURITY DEFINER view" y para
--    seguir el patrón que ya usa el proyecto (`fn_usuarios_supervisan_modulo`, etc.).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Listado básico: nombre, apellido, teléfono y cumpleaños. SIN sueldo, CBU ni DNI.
CREATE OR REPLACE FUNCTION public.fn_empleados_basico()
RETURNS TABLE (id uuid, nombre text, apellido text, tel_personal text, fecha_nacimiento date, activo boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id, e.nombre, e.apellido, e.tel_personal, e.fecha_nacimiento, e.activo
    FROM public.empleados e
   WHERE e.tenant_id = public.get_user_tenant_id()
$$;

COMMENT ON FUNCTION public.fn_empleados_basico() IS
  'Empleados SIN datos sensibles (mig 401) — para el panel de repartidores y los recordatorios de '
  'cumpleaños, que no deben ver sueldo/CBU/DNI. El detalle vive en `empleados`, gateada por rol.';

-- Costo laboral AGREGADO: lo único que necesitan Dashboard, Rentabilidad y Cierres contables.
-- Devuelve totales, nunca filas por empleado.
CREATE OR REPLACE FUNCTION public.fn_sueldos_agregado(
  p_desde date,
  p_hasta date,
  p_hasta_exclusivo boolean DEFAULT false
)
RETURNS TABLE (total_neto numeric, empleados integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rol text := public.get_user_role();
BEGIN
  -- El costo laboral es información de plata del negocio: la ven los roles que ya ven reportes de
  -- plata, no un cajero ni un repositor.
  IF v_rol IS NULL OR v_rol <> ALL (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO','SUPERVISOR','CONTADOR','RRHH']) THEN
    RAISE EXCEPTION 'No autorizado: tu rol (%) no puede ver el costo laboral.', coalesce(v_rol, 'sin rol')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT COALESCE(SUM(s.neto), 0)::numeric,
         COUNT(DISTINCT s.empleado_id)::integer
    FROM public.rrhh_salarios s
   WHERE s.tenant_id = public.get_user_tenant_id()
     AND s.pagado = true
     AND s.fecha_pago >= p_desde
     AND (CASE WHEN p_hasta_exclusivo THEN s.fecha_pago < p_hasta ELSE s.fecha_pago <= p_hasta END);
END $$;

COMMENT ON FUNCTION public.fn_sueldos_agregado(date, date, boolean) IS
  'Costo laboral AGREGADO (mig 401): total neto pagado + cantidad de empleados liquidados. Reemplaza '
  'la lectura fila por fila de rrhh_salarios en Dashboard/Rentabilidad/Cierres, que solo sumaban.';

COMMIT;
