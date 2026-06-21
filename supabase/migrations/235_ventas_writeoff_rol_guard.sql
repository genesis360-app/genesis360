-- 235 — Guard server-side de ROL para write-offs de deuda CC (REGLA #0 obligación #3).
--
-- Condonación (per-venta) e Incobrable (toda la deuda) se gateaban SOLO en el frontend (rol en la UI +
-- clave maestra en el caso incobrable). Por API / bundle cacheado, un rol no autorizado (CAJERO, etc.)
-- podía dar por perdida deuda real (UPDATE directo a ventas.medio_pago). Este trigger exige rol autorizado
-- server-side cuando se AGREGA un tag de write-off ('Condonación CC' / 'Incobrable') que antes no estaba.
--
-- Decisiones:
--   - Preciso: solo dispara cuando el tag aparece NUEVO (compara OLD vs NEW). No afecta cobranza normal
--     (agrega 'Efectivo'/etc.), ni 'Revertir' (QUITA el tag), ni 'Cancelación CC' (cancelación de reserva,
--     no es decisión de write-off → no se gatea acá).
--   - Roles permitidos = unión de puedeGestionarCC + puedeIncobrable (ClientesPage):
--     DUEÑO / SUPERVISOR / SUPER_USUARIO / ADMIN.
--   - get_user_role() lee auth.uid()→users.rol. Sin contexto de sesión (service-role/batch) devuelve NULL
--     → bloquea (no existe flujo legítimo de write-off sin usuario).
--   - La CLAVE maestra del incobrable se sigue verificando client-side (un trigger no puede validar una
--     clave chequeada antes). Cerrar ese hueco (la clave se omite si no está configurada) requeriría
--     refactor de condonar/incobrable a RPC SECURITY DEFINER — anotado en tests/specs/uat-app.md (H1).
--   - Defensivo: si medio_pago no es JSON válido, no bloquea (no romper updates legítimos).
--
-- Verificado en DEV con impersonación (W1-W4): DUEÑO condona→ok, CAJERO condona→bloquea, CAJERO cobranza
-- normal→ok, CAJERO incobrable→bloquea.

CREATE OR REPLACE FUNCTION public.fn_ventas_writeoff_rol_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_new_writeoff boolean := false;
  v_rol text;
BEGIN
  BEGIN
    v_new_writeoff :=
      EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.medio_pago,'[]')::jsonb) e
              WHERE e->>'tipo' IN ('Condonación CC','Incobrable'))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(OLD.medio_pago,'[]')::jsonb) e
              WHERE e->>'tipo' IN ('Condonación CC','Incobrable'));
  EXCEPTION WHEN others THEN
    v_new_writeoff := false;
  END;

  IF v_new_writeoff THEN
    v_rol := public.get_user_role();
    IF v_rol IS DISTINCT FROM 'DUEÑO'
       AND v_rol IS DISTINCT FROM 'SUPERVISOR'
       AND v_rol IS DISTINCT FROM 'SUPER_USUARIO'
       AND v_rol IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'No autorizado: dar por perdida (condonar/incobrable) deuda de cuenta corriente requiere rol DUEÑO/SUPERVISOR/ADMIN.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_ventas_writeoff_rol_guard ON public.ventas;
CREATE TRIGGER trg_ventas_writeoff_rol_guard
  BEFORE UPDATE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.fn_ventas_writeoff_rol_guard();
