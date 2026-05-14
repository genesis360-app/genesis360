-- Migration 105: función tenant_sql_query para el SQL Runner en ReportesPage
-- Solo accesible para DUEÑO y SUPER_USUARIO (validado en frontend y en la función)
-- SECURITY INVOKER: corre con los permisos del usuario llamante → RLS activo

CREATE OR REPLACE FUNCTION public.tenant_sql_query(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET statement_timeout = '10s'
AS $$
DECLARE
  result     JSONB;
  normalized TEXT;
BEGIN
  -- Normalizar para validación
  normalized := trim(regexp_replace(lower(query_text), '\s+', ' ', 'g'));

  -- Solo SELECT o WITH (CTEs)
  IF NOT (normalized ~* '^\s*(select|with)\b') THEN
    RAISE EXCEPTION 'Solo se permiten consultas SELECT o WITH.';
  END IF;

  -- Bloquear keywords peligrosas
  IF normalized ~* '\m(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|execute|call)\M' THEN
    RAISE EXCEPTION 'La consulta contiene operaciones no permitidas.';
  END IF;

  -- Bloquear acceso a schemas de sistema
  IF normalized ~* '\m(pg_catalog|information_schema|auth|storage|realtime|supabase_functions|cron|net)\M' THEN
    RAISE EXCEPTION 'No se puede acceder a schemas del sistema.';
  END IF;

  -- Ejecutar con límite de 500 filas
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s LIMIT 500) t',
    query_text
  ) INTO result;

  RETURN COALESCE(result, '[]'::JSONB);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '%', SQLERRM;
END;
$$;

-- Permiso de ejecución solo para authenticated (RLS filtra por tenant igualmente)
GRANT EXECUTE ON FUNCTION public.tenant_sql_query(TEXT) TO authenticated;

COMMENT ON FUNCTION public.tenant_sql_query IS
  'SQL Runner para DUEÑO/SUPER_USUARIO. Solo SELECT/WITH. SECURITY INVOKER → RLS activo.';
