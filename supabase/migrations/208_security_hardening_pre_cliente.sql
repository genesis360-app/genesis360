-- Migration 208: Endurecimiento de seguridad — auditoría pre-primer-cliente (2026-06-13)
--
-- Remedia hallazgos de get_advisors(security) en PROD/DEV. Idempotente.
-- No altera comportamiento de la app (verificado contra el código):
--   - los sweeps (liberar_reservas_vencidas / recalcular_intereses_cc) los llama el
--     front como authenticated (VentasPage / ClientesPage / CajaCobranzasCC);
--   - los crons de GitHub Actions pegan a Edge Functions (service_role), no a estas RPC;
--   - seed_canales_venta / seed_categorias_gasto NO se llaman desde el front (el alta
--     de tenant usa los triggers fn_seed_*_new_tenant);
--   - las funciones públicas token-gated (envío / fichado / cuenta de cliente) CONSERVAN
--     el grant a anon: son endpoints públicos por diseño.
--
-- Fuera de alcance (follow-ups documentados en project_pendientes.md):
--   - pg_net en schema public → mover a extensions (riesgo de romper referencias).
--   - public_bucket_allows_listing (avatares, productos) → policies de storage.objects.
--   - leaked password protection → toggle de Supabase Auth (no es SQL).
--   - RLS por sucursal (#8) → cambio arquitectónico aparte.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) rls_enabled_no_policy — public.planes
--    Catálogo global de planes con RLS activa pero sin policy (quedaba lockeada).
--    El front no la lee (usa constantes en brand.ts), pero el catálogo de planes es
--    info pública: policy de SOLO LECTURA. Los writes siguen solo por service_role.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'planes' AND policyname = 'planes_select_public'
  ) THEN
    CREATE POLICY planes_select_public ON public.planes
      FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) function_search_path_mutable — fijar search_path = public (25 funciones).
--    Hardening anti search-path-injection. Loop por nombre vía oid::regprocedure
--    (resuelve firmas y overloads automáticamente; idempotente).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
      'cerrar_periodo','fn_notificar_cc_vencidas','fn_set_caja_sesion_numero',
      'gen_venta_numero','generar_otp_envio','get_envio_by_token','get_envio_items_by_token',
      'get_hoja_ruta_by_token','is_rrhh','liberar_reservas_vencidas','periodo_cerrado',
      'puede_aprobar_autorizacion_gasto','reabrir_periodo','reportar_incidencia_envio',
      'requiere_clave_maestra','tenant_sql_query','trg_caja_mov_periodo_cerrado',
      'trg_caja_ses_periodo_cerrado','trg_gastos_periodo_cerrado','trg_oc_periodo_cerrado',
      'trg_ventas_periodo_cerrado','ultimo_cierre_hasta','update_envio_by_token',
      'verificar_clave_maestra','verificar_otp_envio'
    ])
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) SECURITY DEFINER ejecutables por anon → quitarles el acceso a anon.
--    OJO: el EXECUTE de estas funciones viene del grant por defecto a PUBLIC (no
--    de un grant explícito a anon), así que `REVOKE ... FROM anon` es no-op. Hay
--    que REVOKE FROM PUBLIC y re-GRANT a los roles que sí deben ejecutarlas.
--    Las públicas token-gated (envío/fichado/cuenta-cliente) NO se tocan.
--
--    a) Mutaciones / sweeps / lecturas que el front usa SOLO como authenticated:
--       anon no debe cerrar/reabrir períodos, correr sweeps ni leer CC.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
      'cerrar_periodo','reabrir_periodo','liberar_reservas_vencidas',
      'recalcular_intereses_cc','fn_notificar_cc_vencidas','cliente_cc_estado',
      -- clave maestra: SECURITY DEFINER que valida el hash de un tenant; anon podría
      -- usarlas para fuerza bruta. La app solo las llama autenticada.
      'requiere_clave_maestra','verificar_clave_maestra'
    ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

--    b) Seeds / triggers / event-trigger que NO deben invocarse por RPC (ni anon ni
--       authenticated). Los triggers de alta de tenant las ejecutan igual (la
--       ejecución de un trigger no chequea EXECUTE del rol invocante, y los
--       fn_seed_*_new_tenant son SECURITY DEFINER de postgres que llaman a las
--       seed_* standalone con privilegios del owner). service_role queda como
--       escape para backfill manual.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
      'seed_canales_venta','seed_categorias_gasto','rls_auto_enable',
      'fn_crear_caja_fuerte','fn_seed_canales_venta_new_tenant',
      'fn_seed_categorias_gasto_new_tenant','fn_seed_tenant_defaults'
    ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
