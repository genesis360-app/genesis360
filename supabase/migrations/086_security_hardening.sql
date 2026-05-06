-- migration 086: security hardening
-- Resuelve ~77 de los 80 warnings del Security Advisor
-- Los 3 restantes son por diseño (planes sin RLS policy = datos públicos de referencia;
-- pg_net en public schema = gestionado por Supabase, no modificable;
-- authenticated_security_definer en is_admin/is_rrhh = llamadas válidas desde RLS policies)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. REVOKE EXECUTE FROM anon — funciones de trigger e internas
--    Solo deben ser invocadas por triggers o pg_cron, nunca vía REST /rpc/
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.trigger_recalcular_stock()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_resolver_alerta_stock()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_stock_minimo()          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_enqueue_tn_stock_sync()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_enqueue_meli_stock_sync()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gen_venta_numero()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_tn_sync_heartbeat()        FROM anon, authenticated;
-- Nota: pg_cron corre como superuser → estas revocaciones no afectan su ejecución

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVOKE EXECUTE FROM anon — lógica de negocio sensible
--    Solo usuarios autenticados deben poder llamar estas funciones
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.aprobar_vacacion(uuid, uuid)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.rechazar_vacacion(uuid, uuid)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.pagar_nomina_empleado(uuid, uuid)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.pagar_nomina_empleado(uuid, uuid, text)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_aging_profiles(uuid)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.stock_disponible_producto(uuid, uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_saldo_proveedor_cc(uuid)                FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_user_avatar(text)                   FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SET search_path = public — todas las funciones
--    Previene ataques de inyección via search_path mutable
-- ─────────────────────────────────────────────────────────────────────────────

-- Triggers updated_at
ALTER FUNCTION public.update_metodos_pago_updated_at()  SET search_path = public;
ALTER FUNCTION public.update_empleados_timestamp()      SET search_path = public;
ALTER FUNCTION public.update_rrhh_timestamp()           SET search_path = public;
ALTER FUNCTION public.update_updated_at_column()        SET search_path = public;
ALTER FUNCTION public.update_updated_at()               SET search_path = public;
ALTER FUNCTION public.set_updated_at_oc()               SET search_path = public;
ALTER FUNCTION public.fn_updated_at_job_queue()         SET search_path = public;
ALTER FUNCTION public.fn_updated_at_tn_creds()          SET search_path = public;
ALTER FUNCTION public.fn_updated_at_mp_creds()          SET search_path = public;
ALTER FUNCTION public.fn_envios_updated_at()            SET search_path = public;

-- Auth helpers (usados en RLS policies — se mantiene EXECUTE para authenticated)
ALTER FUNCTION public.is_admin()                        SET search_path = public;
ALTER FUNCTION public.is_rrhh()                         SET search_path = public;
ALTER FUNCTION public.get_user_role()                   SET search_path = public;
ALTER FUNCTION public.get_user_tenant_id()              SET search_path = public;
ALTER FUNCTION public.get_supervisor_team_ids()         SET search_path = public;

-- Stock y ventas
ALTER FUNCTION public.trigger_recalcular_stock()        SET search_path = public;
ALTER FUNCTION public.recalcular_stock()                SET search_path = public;
ALTER FUNCTION public.auto_resolver_alerta_stock()      SET search_path = public;
ALTER FUNCTION public.check_stock_minimo()              SET search_path = public;
ALTER FUNCTION public.gen_venta_numero()                SET search_path = public;
ALTER FUNCTION public.generate_lpn()                    SET search_path = public;
ALTER FUNCTION public.stock_disponible_producto(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.fn_recalcular_salario()           SET search_path = public;

-- Integraciones TN/MELI
ALTER FUNCTION public.fn_enqueue_tn_stock_sync()        SET search_path = public;
ALTER FUNCTION public.fn_tn_sync_heartbeat()            SET search_path = public;
ALTER FUNCTION public.fn_enqueue_meli_stock_sync()      SET search_path = public;

-- Compras / OC
ALTER FUNCTION public.set_oc_numero()                   SET search_path = public;

-- RRHH
ALTER FUNCTION public.pagar_nomina_empleado(uuid, uuid)       SET search_path = public;
ALTER FUNCTION public.pagar_nomina_empleado(uuid, uuid, text) SET search_path = public;
ALTER FUNCTION public.calcular_dias_habiles(date, date)       SET search_path = public;
ALTER FUNCTION public.aprobar_vacacion(uuid, uuid)            SET search_path = public;
ALTER FUNCTION public.rechazar_vacacion(uuid, uuid)           SET search_path = public;
ALTER FUNCTION public.process_aging_profiles(uuid)            SET search_path = public;

-- Proveedores CC
ALTER FUNCTION public.fn_saldo_proveedor_cc(uuid)       SET search_path = public;

-- Otros
ALTER FUNCTION public.fn_crear_caja_fuerte()            SET search_path = public;
ALTER FUNCTION public.trg_fn_set_recepcion_numero()     SET search_path = public;
ALTER FUNCTION public.set_envio_numero()                SET search_path = public;
ALTER FUNCTION public.update_user_avatar(text)          SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Buckets storage — restringir listing a usuarios autenticados
--    Elimina la política SELECT abierta que permite enumerar todos los archivos
-- ─────────────────────────────────────────────────────────────────────────────

-- Bucket avatares: imágenes de perfil — solo usuarios autenticados
DROP POLICY IF EXISTS "avatares_public_read" ON storage.objects;
CREATE POLICY "avatares_authenticated_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatares');

-- Bucket productos: imágenes de productos — solo usuarios autenticados
-- (la app siempre requiere login para mostrar imágenes)
DROP POLICY IF EXISTS "read_productos" ON storage.objects;
CREATE POLICY "productos_authenticated_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'productos');
