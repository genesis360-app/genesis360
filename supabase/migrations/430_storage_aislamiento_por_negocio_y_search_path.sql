-- 430 — Aislamiento por negocio en Storage + search_path fijo en fn_enqueue_tn_fulfillment_sync
--
-- Hallazgos de la auditoría de seguridad del 2026-09-20, verificados empíricamente en DEV
-- impersonando a un usuario real (SET LOCAL ROLE authenticated + request.jwt.claims):
--
--   1) bucket `archivos-biblioteca` — FUGA DE LECTURA ENTRE NEGOCIOS.
--      Las policies de SELECT y DELETE evaluaban:
--          auth.uid() IN (SELECT u.id FROM users u WHERE u.tenant_id =
--                           (SELECT tenant_id FROM users WHERE id = auth.uid() LIMIT 1))
--      que es SIEMPRE TRUE para cualquier usuario logueado con tenant: nunca mira `name`,
--      así que no filtra por carpeta. Medido: un usuario del negocio A leía un archivo
--      sembrado en la carpeta del negocio B. (En PROD el bucket está vacío al 2026-09-20,
--      así que la fuga es latente: no hubo exposición real de datos de ningún cliente.)
--      La policy de INSERT era directamente `auth.uid() IS NOT NULL`.
--
--   2) bucket `productos` — ESCRITURA CRUZADA.
--      `upload_productos` (INSERT) y `update_productos` (UPDATE) eran `auth.uid() IS NOT NULL`,
--      sin chequear la carpeta. Medido: un usuario del negocio A podía subir —y pisar— archivos
--      en la carpeta del negocio B. SELECT y DELETE ya estaban bien acotadas; fue un descuido
--      puntual de esos dos comandos.
--
-- La convención de ruta es `<tenant_id>/<archivo>` en los dos buckets
-- (src/pages/BibliotecaPage.tsx:60 y el alta de imágenes de producto), así que alcanza con
-- exigir que la primera carpeta sea el tenant del usuario — mismo criterio que ya usaban
-- `delete_productos` y `productos_authenticated_read`.
--
--   3) `fn_enqueue_tn_fulfillment_sync` era SECURITY DEFINER sin `search_path` fijo
--      (lint `function_search_path_mutable` del Security Advisor). Cuerpo idéntico al actual
--      en PROD — solo se agrega `SET search_path`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · archivos-biblioteca: leer / subir / borrar SOLO dentro de la carpeta propia
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS archivos_biblioteca_storage_select ON storage.objects;
CREATE POLICY archivos_biblioteca_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'archivos-biblioteca'
    AND (storage.foldername(name))[1] IN (
      SELECT u.tenant_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS archivos_biblioteca_storage_insert ON storage.objects;
CREATE POLICY archivos_biblioteca_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'archivos-biblioteca'
    AND (storage.foldername(name))[1] IN (
      SELECT u.tenant_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS archivos_biblioteca_storage_delete ON storage.objects;
CREATE POLICY archivos_biblioteca_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'archivos-biblioteca'
    AND (storage.foldername(name))[1] IN (
      SELECT u.tenant_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · productos: subir y modificar SOLO dentro de la carpeta propia
--     (el UPDATE lleva USING *y* WITH CHECK: sin el WITH CHECK se podría renombrar
--      un archivo propio hacia la carpeta de otro negocio)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS upload_productos ON storage.objects;
CREATE POLICY upload_productos ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'productos'
    AND (storage.foldername(name))[1] IN (
      SELECT u.tenant_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS update_productos ON storage.objects;
CREATE POLICY update_productos ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'productos'
    AND (storage.foldername(name))[1] IN (
      SELECT u.tenant_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'productos'
    AND (storage.foldername(name))[1] IN (
      SELECT u.tenant_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · search_path fijo (cuerpo sin cambios, copiado de pg_get_functiondef en PROD)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_enqueue_tn_fulfillment_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tn_order_id bigint;
BEGIN
  IF NEW.canal <> 'TiendaNube' OR NEW.estado NOT IN ('despachado', 'entregado') OR NEW.venta_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tn_order_id INTO v_tn_order_id FROM ventas WHERE id = NEW.venta_id;
  IF v_tn_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, next_attempt_at)
  SELECT
    NEW.tenant_id,
    NEW.sucursal_id,
    'TiendaNube',
    'sync_fulfillment',
    jsonb_build_object(
      'venta_id',       NEW.venta_id::text,
      'envio_id',       NEW.id::text,
      'tn_order_id',    v_tn_order_id,
      'estado_envio',   NEW.estado,
      'tracking_number', NEW.tracking_number
    ),
    NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM integration_job_queue q
    WHERE q.tenant_id = NEW.tenant_id
      AND q.integracion = 'TiendaNube'
      AND q.tipo = 'sync_fulfillment'
      AND q.status = 'pending'
      AND q.payload->>'envio_id' = NEW.id::text
      AND q.payload->>'estado_envio' = NEW.estado
  );

  RETURN NEW;
END;
$function$;
