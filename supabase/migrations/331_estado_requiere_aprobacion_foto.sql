-- Fede 25/7, punto 2: flujo de aprobación para cambios de estado con impacto económico
-- (dañado, vencido, eliminado…) — anti-fraude interno. Cuando un empleado cambia un lote a un
-- estado marcado `requiere_aprobacion`, el cambio NO se aplica directo: queda pendiente en
-- `autorizaciones_inventario` (tipo nuevo `cambio_estado`) con una foto tomada en el momento,
-- hasta que un supervisor/dueño lo aprueba desde la pestaña Autorizaciones (ya existente).
--
-- Independiente de `descuento_pct` (mig 284): un estado puede requerir aprobación SIN tener
-- descuento asociado (ej. "Eliminado" da de baja stock pero no rebaja precio), y viceversa.

ALTER TABLE public.estados_inventario
  ADD COLUMN IF NOT EXISTS requiere_aprobacion boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.estados_inventario.requiere_aprobacion IS
  'Si es true, cambiar un lote/línea a este estado requiere aprobación de supervisor + foto tomada en el momento (autorizaciones_inventario, tipo cambio_estado). Independiente de descuento_pct.';

-- Nuevo tipo de autorización: `cambio_estado`. `datos_cambio` guarda
-- {estado_anterior_id, estado_nuevo_id, foto_path} (jsonb, sin columnas nuevas — mismo patrón
-- que ajuste_cantidad/ajuste_conteo).
ALTER TABLE public.autorizaciones_inventario DROP CONSTRAINT IF EXISTS autorizaciones_inventario_tipo_check;
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_tipo_check
  CHECK (tipo = ANY (ARRAY['ajuste_cantidad'::text, 'eliminar_serie'::text, 'eliminar_lpn'::text, 'bulk_edit'::text, 'ajuste_conteo'::text, 'cambio_estado'::text]));

-- Bucket privado para las fotos de evidencia. A diferencia de 'etiquetas-envios' (mig 075, sin
-- scoping por tenant), acá SÍ se scopea por carpeta: son fotos de evidencia de fraude interno
-- (mercadería/ubicaciones/empleados de un negocio), más sensibles que una etiqueta de envío —
-- mismo criterio que 'certificados-afip' (mig 043). Convención de path: `${tenant_id}/...`
-- (la aplica el frontend al subir). Solo imágenes, 5MB máx (una foto de celular).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('autorizaciones-fotos', 'autorizaciones-fotos', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='autorizaciones_fotos_read') THEN
    CREATE POLICY autorizaciones_fotos_read ON storage.objects FOR SELECT
      USING (bucket_id = 'autorizaciones-fotos'
        AND (storage.foldername(name))[1] IN (SELECT tenant_id::text FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='autorizaciones_fotos_insert') THEN
    CREATE POLICY autorizaciones_fotos_insert ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'autorizaciones-fotos'
        AND (storage.foldername(name))[1] IN (SELECT tenant_id::text FROM users WHERE id = auth.uid()));
  END IF;
END $$;
