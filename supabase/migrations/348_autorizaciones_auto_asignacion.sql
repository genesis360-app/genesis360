-- 348 — A2 del relevamiento de Supervisor: "asignación automática por prioridad como default" +
-- "reglas predefinidas de enrutamiento (todas las tareas de tipo X las hace el Usuario A) que la
-- asignación automática debe respetar". Requisito de negocio cerrado en el relevamiento original;
-- la implementación concreta se definió recién ahora con GO (2026-08-11):
--   1) Si existe una regla de enrutamiento (tenant+modulo+tipo → usuario), se respeta siempre.
--   2) Si no hay regla, reparto por CARGA: se asigna a quien, entre los que pueden supervisar ese
--      módulo, tenga MENOS autorizaciones pendientes asignadas ahora mismo en ese módulo (evita que
--      una sola persona se ahogue). Config de reglas vive en Configuración del tenant.

CREATE TABLE IF NOT EXISTS public.autorizaciones_reglas_enrutamiento (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  modulo       TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  usuario_id   UUID NOT NULL REFERENCES public.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, modulo, tipo)
);

ALTER TABLE public.autorizaciones_reglas_enrutamiento ENABLE ROW LEVEL SECURITY;

-- SELECT tenant-wide (NO restringido a DUEÑO/ADMIN a propósito): el trigger de auto-asignación de
-- abajo corre SECURITY INVOKER, bajo el RLS de QUIEN crea la autorización (puede ser cualquier rol,
-- ej. DEPOSITO cargando un ajuste) — si el SELECT quedara restringido a DUEÑO/ADMIN, ese usuario no
-- podría leer la regla al insertar y la auto-asignación se rompería para todos los roles operativos.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'autorizaciones_reglas_enrutamiento' AND policyname = 'autorizaciones_reglas_enrutamiento_select'
  ) THEN
    CREATE POLICY autorizaciones_reglas_enrutamiento_select ON public.autorizaciones_reglas_enrutamiento
      FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));
  END IF;
END $$;

-- Escribir la CONFIGURACIÓN de reglas sí queda acotado a DUEÑO/ADMIN (mismo criterio que el resto de
-- Configuración, ownerOnly) — cualquier otro rol autenticado del tenant podría, si no, reescribir a
-- quién se le enruta cada tipo de autorización vía REST directo.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'autorizaciones_reglas_enrutamiento' AND policyname = 'autorizaciones_reglas_enrutamiento_write'
  ) THEN
    CREATE POLICY autorizaciones_reglas_enrutamiento_write ON public.autorizaciones_reglas_enrutamiento
      FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()) AND public.get_user_role() IN ('DUEÑO', 'ADMIN'))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()) AND public.get_user_role() IN ('DUEÑO', 'ADMIN'));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.autorizaciones_reglas_enrutamiento TO authenticated;
GRANT SELECT ON public.autorizaciones_reglas_enrutamiento TO service_role;

COMMENT ON TABLE public.autorizaciones_reglas_enrutamiento IS
  'A2 del relevamiento de Supervisor: regla fija "toda autorización de tipo X en el módulo Y se asigna sola al Usuario Z" al crearse. UNIQUE(tenant_id, modulo, tipo) — una sola regla por tipo. SELECT tenant-wide (lo necesita el trigger bajo cualquier rol), escritura acotada a DUEÑO/ADMIN. Configurable desde Configuración del tenant.';

-- Guard: usuario_id de la regla tiene que pertenecer al mismo tenant (la FK a users(id) por sí sola
-- no lo exige — podría apuntar a un usuario de OTRO tenant y la autorización quedaría "asignada" a
-- alguien invisible en el tab Reasignar).
CREATE OR REPLACE FUNCTION public.fn_regla_enrutamiento_valida_tenant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.usuario_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'El usuario de la regla debe pertenecer al mismo negocio.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_regla_enrutamiento_valida_tenant ON public.autorizaciones_reglas_enrutamiento;
CREATE TRIGGER trg_regla_enrutamiento_valida_tenant
  BEFORE INSERT OR UPDATE ON public.autorizaciones_reglas_enrutamiento
  FOR EACH ROW EXECUTE FUNCTION public.fn_regla_enrutamiento_valida_tenant();

COMMENT ON FUNCTION public.fn_regla_enrutamiento_valida_tenant() IS
  'Guard de la tabla autorizaciones_reglas_enrutamiento: rechaza si usuario_id no pertenece al mismo tenant_id de la regla — la FK a users(id) por sí sola no lo exige.';

-- ── fn_usuarios_supervisan_modulo — espejo SQL de puedeSupervisarModulo (permisosModulo.ts) ────────
-- Necesario porque el trigger de abajo corre en la DB y no puede llamar a la lógica de TypeScript.
-- 🛑 Mantener sincronizado a mano con permisosModulo.ts y navVisibility.ts (SUPERVISOR_MODULOS_PROHIBIDOS)
-- si alguna vez cambia esa lista — mismo riesgo de duplicación que ya existe entre esos 2 archivos.
CREATE OR REPLACE FUNCTION public.fn_usuarios_supervisan_modulo(p_tenant_id uuid, p_modulo text)
RETURNS TABLE (usuario_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT u.id
  FROM users u
  LEFT JOIN roles_custom rc ON rc.id = u.rol_custom_id AND rc.activo = true
  WHERE u.tenant_id = p_tenant_id AND u.activo = true
    AND (
      u.rol IN ('DUEÑO', 'SUPER_USUARIO', 'ADMIN')
      OR (u.rol = 'SUPERVISOR' AND p_modulo NOT IN
          ('configuracion','usuarios','sucursales','rrhh','facturacion','proveedores','recursos','biblioteca'))
      OR (rc.permisos ->> p_modulo = 'supervisa')
    )
$$;

COMMENT ON FUNCTION public.fn_usuarios_supervisan_modulo(uuid, text) IS
  'Espejo SQL de puedeSupervisarModulo (src/lib/permisosModulo.ts) — quién puede supervisar (aprobar/reasignar) un módulo. Usado por el trigger de auto-asignación (mig 348). Mantener sincronizado a mano si cambia la lógica del lado TS.';

REVOKE ALL ON FUNCTION public.fn_usuarios_supervisan_modulo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_usuarios_supervisan_modulo(uuid, text) TO authenticated, service_role;

-- ── Trigger: auto-asignar al crear una autorización (si nadie la asignó explícito) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_autorizaciones_auto_asignar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_regla    uuid;
  v_elegido  uuid;
BEGIN
  IF NEW.asignado_a IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1) Regla de enrutamiento explícita.
  SELECT usuario_id INTO v_regla
    FROM autorizaciones_reglas_enrutamiento
    WHERE tenant_id = NEW.tenant_id AND modulo = NEW.modulo AND tipo = NEW.tipo;
  IF v_regla IS NOT NULL THEN
    NEW.asignado_a := v_regla;
    RETURN NEW;
  END IF;

  -- 2) Reparto por carga: el elegible con menos pendientes asignadas hoy en este módulo. Empate
  --    (típico con todos en 0) se desempata al azar, no siempre por el mismo UUID — si no, la
  --    "prioridad por default" terminaría concentrando todo en la misma persona.
  SELECT e.usuario_id INTO v_elegido
  FROM fn_usuarios_supervisan_modulo(NEW.tenant_id, NEW.modulo) e
  LEFT JOIN (
    SELECT asignado_a, count(*) AS n
    FROM autorizaciones
    WHERE tenant_id = NEW.tenant_id AND modulo = NEW.modulo AND estado = 'pendiente' AND asignado_a IS NOT NULL
    GROUP BY asignado_a
  ) carga ON carga.asignado_a = e.usuario_id
  ORDER BY COALESCE(carga.n, 0) ASC, random()
  LIMIT 1;

  NEW.asignado_a := v_elegido; -- NULL si no hay nadie elegible (degrada a "disponible para cualquiera")
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_autorizaciones_auto_asignar ON public.autorizaciones;
CREATE TRIGGER trg_autorizaciones_auto_asignar
  BEFORE INSERT ON public.autorizaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_autorizaciones_auto_asignar();

COMMENT ON FUNCTION public.fn_autorizaciones_auto_asignar() IS
  'A2 del relevamiento de Supervisor: auto-asigna asignado_a al crear una autorización — regla de enrutamiento explícita si existe, si no reparto por carga (empate al azar) entre quienes pueden supervisar el módulo. No restringe QUIÉN puede aprobar (eso lo sigue permitiendo cualquiera con supervisa) — solo enruta la cola por default.';
