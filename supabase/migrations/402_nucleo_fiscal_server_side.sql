-- 402 — El NÚCLEO FISCAL deja de ser escribible por cualquier rol (y el token, legible) — Tanda F, cierre
--
-- 🛑 REGLA #0. La mig 400 cerró los access_token de MP/TiendaNube/WhatsApp y dejó anotado un hueco:
-- `emisores_fiscales.afipsdk_token`, que no se pudo cerrar ahí porque el panel hacía `select('*')`.
-- Al ir a cerrarlo apareció algo bastante peor, midiendo `pg_policies` con datos reales de DEV:
-- **las tres tablas del núcleo fiscal tienen UNA sola policy `FOR ALL` que filtra por tenant y nada
-- más**. Con el access_token de CUALQUIER rol del tenant (CAJERO, DEPÓSITO, RRHH, CONTADOR, LECTOR)
-- y un `curl`, hoy se puede:
--
--   • `PATCH /emisores_fiscales` → cambiar el **CUIT**, la **condición de IVA frente al IVA**, el
--     **umbral de Factura B** y prender **`afip_produccion`**. Traducción fiscal: facturas emitidas
--     con un CUIT que no es el del negocio, con la LETRA equivocada (A donde va B), o un tenant
--     pasado a **producción AFIP real** por un cajero — CAE irreversible.
--   • `DELETE /tenant_certificates` → borrar el certificado del tenant y voltear la facturación.
--   • `POST/DELETE /puntos_venta_afip` → tocar la numeración fiscal.
--   • `GET /storage/v1/object/certificados-afip/<tenant>/<ts>.key` → **descargarse la CLAVE PRIVADA
--     AFIP** del negocio. Con cert + key se firma el WSAA y se factura como ese CUIT desde afuera de
--     Genesis360. Es estrictamente peor que el token de AfipSDK. El código lo daba por cerrado: el
--     comentario de `generar-csr/index.ts` dice "bucket certificados-afip, service_role-only" — y no
--     lo era. Ese bucket además aceptaba INSERT con `auth.uid() IS NOT NULL` a secas (mig 043), o
--     sea que un usuario de un tenant podía escribir en la carpeta de OTRO tenant.
--
-- Verificado ANTES de aplicar (por qué esto no rompe nada):
--   • Las tres tablas se ESCRIBEN solo desde `ConfigPage` (tab Facturación) y `EmisoresFiscalesPanel`,
--     y ambos están detrás de `canEdit = user?.rol === 'DUEÑO'`. La UI ya era más estricta que lo que
--     queda acá; esto solo hace que la base sostenga lo mismo.
--   • El SELECT queda ABIERTO a todo el tenant en las tres: el POS y `camposEmisorPDF` necesitan leer
--     el emisor y sus puntos de venta para facturar. Lo que se cierra es la ESCRITURA.
--   • Ninguna función de DB escribe estas tablas (verificado con `pg_get_functiondef`), así que no hay
--     un trigger que se quede sin permiso.
--   • `service_role` no se toca → las Edge Functions (`emitir-factura`, `generar-csr`,
--     `finalizar-certificado`) siguen igual: todas usan SUPABASE_SERVICE_ROLE_KEY y bypassean RLS.
--
-- Roles de gestión = los mismos de la mig 396 (`roles_custom_write_gestion`): DUEÑO + ADMIN (staff de
-- soporte cross-tenant) + SUPER_USUARIO. La identidad fiscal es administración, no operación.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) `emisores_fiscales` — leer sí, escribir solo gestión
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS emisores_fiscales_tenant ON public.emisores_fiscales;

CREATE POLICY emisores_fiscales_select ON public.emisores_fiscales
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY emisores_fiscales_write_gestion ON public.emisores_fiscales
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) `emisores_fiscales.afipsdk_token` — el hueco que dejó abierto la mig 400
--
-- Privilegios a nivel COLUMNA, igual que MP/TN. El token es un SECRETO DE ESCRITURA: se carga y se
-- reemplaza, nunca se relee desde el browser. Para que la pantalla siga pudiendo decir "hay uno
-- guardado" sin exponerlo, se agrega una columna GENERADA con el booleano.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.emisores_fiscales
  ADD COLUMN IF NOT EXISTS afipsdk_token_configurado boolean
  GENERATED ALWAYS AS (afipsdk_token IS NOT NULL AND afipsdk_token <> '') STORED;

REVOKE SELECT ON public.emisores_fiscales FROM authenticated, anon;
GRANT SELECT (
  id, tenant_id, nombre, cuit, razon_social_fiscal, condicion_iva_emisor, domicilio_fiscal,
  ingresos_brutos, inicio_actividades, umbral_factura_b, afip_produccion, afip_provider,
  afipsdk_token_configurado, banco, cbu, alias_cbu, leyenda_comprobante, logo_url,
  es_default, activo, created_at, updated_at, csr_key_path
) ON public.emisores_fiscales TO authenticated;

COMMENT ON COLUMN public.emisores_fiscales.afipsdk_token IS
  'SECRETO de solo-escritura. Sin SELECT para authenticated/anon (mig 402) — solo service_role, que es '
  'quien lo usa en emitir-factura. Para saber si hay uno cargado, leer afipsdk_token_configurado.';
COMMENT ON COLUMN public.emisores_fiscales.afipsdk_token_configurado IS
  '¿Hay token de AfipSDK cargado? Columna generada, legible por el frontend (mig 402) — reemplaza a '
  'leer el token para mostrar "Configurado".';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) `tenants.afipsdk_token` — la COPIA del secreto que dejó el espejo legacy
--
-- No se puede cerrar por columna: `tenants` se lee con `select('*')` desde ~40 lugares del frontend
-- (incluido el `loadUserData` que corre para TODOS los usuarios) y revocar la columna los rompería a
-- todos con 403. La salida correcta es que la copia deje de existir: `emisores_fiscales` es la fuente
-- única desde el cutover de la mig 271, y estas columnas de `tenants` son un espejo de solo-lectura.
--
--   a) el espejo deja de copiar el token,
--   b) se vacían los que ya estaban copiados (DEV tenía 2; PROD, 0 — medido),
--   c) un trigger BEFORE fuerza NULL, así ningún camino legacy vuelve a depositar un secreto ahí.
--
-- La columna NO se dropea todavía A PROPÓSITO: las migraciones van a PROD ANTES del merge del código
-- (regla de deploy), y el frontend v1.195.4 que está vivo en PROD todavía la escribe en el camino
-- legacy "tenant sin CUIT". Un DROP la haría fallar con 42703. Se dropea en una migración futura,
-- cuando PROD ya corra el código de esta tanda.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- (a) espejo sin el token — misma función de la mig 271, con `afipsdk_token` fuera del SET y de la
--     comparación anti-loop. El resto queda idéntico.
CREATE OR REPLACE FUNCTION public.fn_espejo_emisor_default_a_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT NEW.es_default THEN
    RETURN NEW;
  END IF;

  UPDATE tenants t SET
    cuit                 = NEW.cuit,
    razon_social_fiscal  = NEW.razon_social_fiscal,
    condicion_iva_emisor = NEW.condicion_iva_emisor,
    domicilio_fiscal     = NEW.domicilio_fiscal,
    ingresos_brutos      = NEW.ingresos_brutos,
    inicio_actividades   = NEW.inicio_actividades,
    umbral_factura_b     = NEW.umbral_factura_b,
    afip_produccion      = NEW.afip_produccion,
    afip_provider        = NEW.afip_provider,
    banco                = NEW.banco,
    cbu                  = NEW.cbu,
    alias_cbu            = NEW.alias_cbu,
    leyenda_comprobante  = NEW.leyenda_comprobante,
    logo_url             = NEW.logo_url
  WHERE t.id = NEW.tenant_id
    AND (t.cuit, t.razon_social_fiscal, t.condicion_iva_emisor, t.domicilio_fiscal,
         t.ingresos_brutos, t.inicio_actividades, t.umbral_factura_b, t.afip_produccion,
         t.afip_provider, t.banco, t.cbu, t.alias_cbu,
         t.leyenda_comprobante, t.logo_url)
        IS DISTINCT FROM
        (NEW.cuit, NEW.razon_social_fiscal, NEW.condicion_iva_emisor, NEW.domicilio_fiscal,
         NEW.ingresos_brutos, NEW.inicio_actividades, NEW.umbral_factura_b, NEW.afip_produccion,
         NEW.afip_provider, NEW.banco, NEW.cbu, NEW.alias_cbu,
         NEW.leyenda_comprobante, NEW.logo_url);

  RETURN NEW;
END $$;

-- (b) vaciar las copias existentes. El token real sigue vivo en `emisores_fiscales`, que es quien
--     factura: `emitir-factura` resuelve el emisor y usa SU token.
UPDATE public.tenants SET afipsdk_token = NULL WHERE afipsdk_token IS NOT NULL;

-- (c) candado: nadie deposita un secreto en la copia legacy
CREATE OR REPLACE FUNCTION public.fn_tenants_afipsdk_token_deprecado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- `tenants.afipsdk_token` es legible por todo el tenant (select('*') masivo). Se deja siempre en
  -- NULL para que sea imposible que un secreto viva ahí. El token va a emisores_fiscales.
  NEW.afipsdk_token := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_afipsdk_token_deprecado ON public.tenants;
CREATE TRIGGER trg_tenants_afipsdk_token_deprecado
  BEFORE INSERT OR UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_tenants_afipsdk_token_deprecado();

COMMENT ON COLUMN public.tenants.afipsdk_token IS
  'DEPRECADA (mig 402) — siempre NULL, forzado por trigger. Era una copia legible por todo el tenant '
  'de un secreto. La fuente única es emisores_fiscales.afipsdk_token. Dropear cuando PROD corra el '
  'código de la tanda F (hoy v1.195.4 todavía la escribe en el camino legacy sin CUIT).';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) `tenant_certificates` — leer sí, escribir solo gestión
--    (solo guarda PATHS del bucket; el material sensible vive en Storage, punto 6)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_certificates_tenant ON public.tenant_certificates;

CREATE POLICY tenant_certificates_select ON public.tenant_certificates
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY tenant_certificates_write_gestion ON public.tenant_certificates
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) `puntos_venta_afip` — leer sí (el POS los necesita para facturar), escribir solo gestión
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pv_tenant ON public.puntos_venta_afip;

CREATE POLICY pv_select ON public.puntos_venta_afip
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY pv_write_gestion ON public.puntos_venta_afip
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6) Storage `certificados-afip` — la clave privada AFIP deja de ser descargable
--
-- Reemplaza las 3 policies de la mig 043. Cambios:
--   • SELECT (descarga) y DELETE: además del tenant, exige rol de gestión. Antes, cualquier usuario
--     del tenant se bajaba el `.key` o lo borraba.
--   • INSERT: era `auth.uid() IS NOT NULL` — servía para escribir en la carpeta de CUALQUIER tenant.
--     Ahora exige que la carpeta sea la del propio tenant Y rol de gestión.
-- El SELECT se conserva para gestión (no se cierra del todo) porque `uploadCertificates` hace
-- rollback con `.remove()` y el DUEÑO tiene que poder ejecutarlo. Ningún camino del frontend
-- DESCARGA del bucket (verificado con grep: solo `.upload()` y `.remove()`); quien descarga es
-- `emitir-factura` con service_role, que no pasa por estas policies.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "certs_storage_select" ON storage.objects;
CREATE POLICY "certs_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'certificados-afip'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );

DROP POLICY IF EXISTS "certs_storage_insert" ON storage.objects;
CREATE POLICY "certs_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'certificados-afip'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );

DROP POLICY IF EXISTS "certs_storage_delete" ON storage.objects;
CREATE POLICY "certs_storage_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'certificados-afip'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );
