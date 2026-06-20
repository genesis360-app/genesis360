-- Migration 231: reconciliar drift DEV↔PROD de COLUMNAS, constraint y objetos (PAR-03 / PAR-04)
-- =============================================================================================
-- Detectado por la auditoría de paridad del UAT de primer uso
-- (tests/specs/uat-primer-uso.plan.md, capas A · PAR-03 columnas / PAR-04 funciones).
--
-- CAUSA RAÍZ: cambios DDL fuera de banda (SQL suelto / dashboard, NO versionados) que dejaron
-- las dos DBs divergidas. La app v1.80.1 es idéntica en DEV y PROD, así que lo que en DEV anda
-- (porque la columna existe) en PROD ROMPE (column does not exist). No se notó porque esos
-- flujos no se habían ejercitado en PROD todavía (app pre-primer-cliente).
--
-- DRIFT ENCONTRADO:
--   (DEV tenía, PROD NO — la app las usa → rompía en PROD):
--     1) ventas.costo_envio        🔴 FISCAL/CONTABLE — costo de envío cobrado en la factura/ticket
--        (v1.78.0). VentasPage la escribe cuando costoEnvioNum>0 y la pide en el SELECT del PDF.
--     2) movimientos_stock.linea_id 🟠 trazabilidad WMS (FK a inventario_lineas; 327 filas en DEV).
--     3) clientes.notas             🔴 alta/edición de clientes (ClientesPage la manda SIEMPRE en
--        el payload de insert/update → en PROD rompía TODO el módulo Clientes).
--   (DEV tenía el drift, PROD correcto):
--     4) autorizaciones_inventario.linea_id quedó NOT NULL en DEV; la mig 103 la dejó nullable
--        (bulk_edit no tiene una sola línea). DEV rechazaría una autorización bulk. PROD ya OK.
--   (PROD tenía, DEV NO — paridad de seguridad):
--     5) event trigger ensure_rls (fn rls_auto_enable) que auto-habilita RLS en tablas nuevas de
--        public. Se agrega a DEV (best-effort) para que se comporte igual que PROD.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS / DROP NOT NULL / guardas). Se aplica en DEV y PROD.

-- 1) ventas.costo_envio (numeric, nullable) — 🔴 fiscal/contable
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS costo_envio NUMERIC;

-- 2) movimientos_stock.linea_id (uuid, nullable, FK inventario_lineas) — trazabilidad
ALTER TABLE public.movimientos_stock
  ADD COLUMN IF NOT EXISTS linea_id UUID REFERENCES inventario_lineas(id);

-- 3) clientes.notas (text, nullable)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS notas TEXT;

-- 4) autorizaciones_inventario.linea_id → nullable (revertir drift de DEV; alinea con mig 103)
ALTER TABLE public.autorizaciones_inventario
  ALTER COLUMN linea_id DROP NOT NULL;

-- 5) event trigger ensure_rls / rls_auto_enable — paridad DEV←PROD (auto-enable RLS en tablas nuevas)
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    BEGIN
      EXECUTE $ddl$
        CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
          WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
          EXECUTE FUNCTION public.rls_auto_enable()
      $ddl$;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'ensure_rls no creado por privilegios — reconciliar manualmente si se requiere';
    END;
  END IF;
END $$;
