-- 438 — El aging de inventario corre solo, una vez por día
--
-- Decidido por GO el 2026-09-25 (ítem 7 del backlog de la auditoría de procesos: "cron para sweeps
-- lazy"). Hasta acá `process_aging_profiles` solo corría cuando alguien apretaba el botón en
-- Configuración: un lote podía llegar a su fecha de vencimiento sin pasar nunca a "Próximo a vencer",
-- aunque el negocio tuviera la regla configurada. Intereses de CC y reservas vencidas ya corrían
-- diario (EF `cron-sweeps`); el aging era el que faltaba.
--
-- Se programa con pg_cron dentro de la base (mismo patrón que los precios programados, mig 422) en
-- vez de sumarlo a la EF: no hay Edge Function que redesplegar y queda todo en esta migración.
--
-- · pg_cron corre sin usuario (auth.uid() NULL) → el guard de la mig 437 deja pasar el p_tenant_id.
-- · Cada negocio en su propio bloque: si uno falla, los demás se procesan igual. El error queda en
--   el resultado (y en `cron.job_run_details`), no se traga en silencio.
-- · Solo negocios con al menos un producto con perfil de aging y vencimiento: no recorre los demás.
-- · Horario: 06:15 UTC = 03:15 Argentina, antes del horario comercial y después de `cron-sweeps`
--   (06:10 UTC). La base está en UTC; a esa hora CURRENT_DATE ya es el día argentino.
-- · Cada cambio queda en `actividad_log` como 'Sistema (Aging)', igual que con el botón.

CREATE OR REPLACE FUNCTION public.process_aging_profiles_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t          RECORD;
  v_res      jsonb;
  v_cambios  INT := 0;
  v_negocios INT := 0;
  v_errores  jsonb := '[]'::jsonb;
BEGIN
  FOR t IN
    SELECT DISTINCT p.tenant_id
    FROM productos p
    WHERE p.aging_profile_id IS NOT NULL
      AND p.tiene_vencimiento = TRUE
  LOOP
    BEGIN
      v_res := process_aging_profiles(t.tenant_id);
      v_cambios := v_cambios + COALESCE((v_res->>'cambios')::int, 0);
      v_negocios := v_negocios + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores || jsonb_build_object('tenant_id', t.tenant_id, 'error', SQLERRM);
    END;
  END LOOP;

  IF jsonb_array_length(v_errores) > 0 THEN
    RAISE WARNING 'process_aging_profiles_all: % negocio(s) con error: %', jsonb_array_length(v_errores), v_errores;
  END IF;

  RETURN jsonb_build_object('negocios', v_negocios, 'cambios', v_cambios, 'errores', v_errores, 'procesado_en', NOW());
END;
$$;

-- Solo el sistema: revocar de PUBLIC no alcanza para anon/authenticated (roles propios de Supabase).
REVOKE ALL ON FUNCTION public.process_aging_profiles_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_aging_profiles_all() TO service_role;

-- cron.schedule con el mismo nombre actualiza el job: idempotente.
SELECT cron.schedule('aging-inventario-diario', '15 6 * * *', 'SELECT public.process_aging_profiles_all()');
