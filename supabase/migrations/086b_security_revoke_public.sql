-- migration 086b: revocar PUBLIC y re-grant selectivo
-- Complemento de 086 — REVOKE FROM anon no es suficiente cuando el grant viene de PUBLIC

-- ── Funciones solo de trigger/interno — revocar PUBLIC completamente ──────────
REVOKE EXECUTE ON FUNCTION public.trigger_recalcular_stock()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_resolver_alerta_stock()  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_stock_minimo()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_enqueue_tn_stock_sync()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_enqueue_meli_stock_sync()  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gen_venta_numero()            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_tn_sync_heartbeat()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_crear_caja_fuerte()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_saldo_proveedor_cc(uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stock_disponible_producto(uuid, uuid) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rls_auto_enable' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
  END IF;
END $$;

-- ── Lógica de negocio — revocar PUBLIC, re-grant a authenticated ──────────────
REVOKE EXECUTE ON FUNCTION public.aprobar_vacacion(uuid, uuid)               FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.aprobar_vacacion(uuid, uuid)               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.rechazar_vacacion(uuid, uuid)              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rechazar_vacacion(uuid, uuid)              TO authenticated;

REVOKE EXECUTE ON FUNCTION public.pagar_nomina_empleado(uuid, uuid)          FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pagar_nomina_empleado(uuid, uuid)          TO authenticated;

REVOKE EXECUTE ON FUNCTION public.pagar_nomina_empleado(uuid, uuid, text)    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pagar_nomina_empleado(uuid, uuid, text)    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.process_aging_profiles(uuid)               FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.process_aging_profiles(uuid)               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_user_avatar(text)                   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_user_avatar(text)                   TO authenticated;

-- ── Auth helpers usados en RLS — revocar PUBLIC, re-grant a authenticated ─────
REVOKE EXECUTE ON FUNCTION public.is_admin()                     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin()                     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_rrhh()                      FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_rrhh()                      TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_role()                FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_user_role()                TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id()           FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_user_tenant_id()           TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_supervisor_team_ids()      FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_supervisor_team_ids()      TO authenticated;
