-- 400 — Los access_token de las integraciones dejan de ser legibles por el frontend (Tanda F2)
--
-- 🔴 HALLAZGO (verificado con tokens reales de 6 roles el 2026-09-06). La matriz de LECTURA por rol
-- mostró que **CUALQUIER usuario del tenant** —CAJERO, DEPÓSITO, RRHH, CONTADOR— podía hacer
--
--     GET /rest/v1/mercadopago_credentials?select=access_token
--
-- y llevarse el token en claro. Lo mismo con Tienda Nube. La RLS de esas tablas es solo por tenant, y
-- el token vive en una columna de texto plano. Con ese token se puede operar la cuenta de Mercado
-- Pago del comercio (cobros, devoluciones) desde afuera de Genesis360.
--
-- El comentario en `src/lib/supabase.ts` decía "access_token nunca expuesto al frontend" — y era
-- cierto **en la interfaz TypeScript**, que no lo declara. Pero la interfaz no es un control de
-- acceso: PostgREST devuelve la columna que le pidas. La protección existía solo en el tipo.
--
-- FIX: privilegios a nivel COLUMNA. Se revoca el SELECT de tabla y se re-otorga columna por columna,
-- salteando los secretos. (En PostgreSQL no se puede "restar" una columna de un grant de tabla: hay
-- que revocar el grant y re-otorgar la lista.)
--
-- Riesgo verificado ANTES de aplicar — por qué esto no rompe nada:
--   • El frontend NUNCA lee esas columnas. Las tres consultas de `ConfigPage.tsx` usan listas
--     EXPLÍCITAS de columnas y ninguna incluye el token (solo estado de conexión e identificadores).
--     Eso importa: con `select('*')` PostgREST expandiría a todas las columnas y daría 403.
--   • `service_role` queda intacto → las Edge Functions (que son las que de verdad usan el token,
--     todas con SUPABASE_SERVICE_ROLE_KEY) siguen funcionando igual.
--   • `anon` pierde el SELECT completo: no tiene ninguna razón para leer credenciales.
--
-- Queda FUERA de esta migración, anotado en la Tanda F2 porque necesita cambios de frontend o una
-- decisión de negocio:
--   • `emisores_fiscales.afipsdk_token` — mismo problema, pero el panel de Emisores hace `select('*')`
--     y además EDITA el token, así que revocar la columna rompe la pantalla. Requiere pasar a listas
--     explícitas de columnas primero.
--   • `rrhh_salarios` / `empleados` — sueldos, CBU y DNI de todos los empleados, hoy visibles para
--     cualquier rol. Es una decisión de negocio (quién puede ver sueldos), no un fix mecánico.

BEGIN;

-- ── Mercado Pago ────────────────────────────────────────────────────────────────────────────
REVOKE SELECT ON public.mercadopago_credentials FROM authenticated, anon;
GRANT SELECT (id, tenant_id, sucursal_id, seller_id, seller_email, public_key,
              expires_at, conectado, conectado_at, created_at, updated_at)
  ON public.mercadopago_credentials TO authenticated;

-- ── Tienda Nube ─────────────────────────────────────────────────────────────────────────────
REVOKE SELECT ON public.tiendanube_credentials FROM authenticated, anon;
GRANT SELECT (id, tenant_id, sucursal_id, store_id, store_name, store_url,
              conectado, conectado_at, created_at, updated_at)
  ON public.tiendanube_credentials TO authenticated;

-- ── WhatsApp ────────────────────────────────────────────────────────────────────────────────
-- El token de WhatsApp es de System User y NO vence nunca (`expires_at: 0`), así que filtrarlo es
-- peor que los otros: no se invalida solo.
REVOKE SELECT ON public.whatsapp_credentials FROM authenticated, anon;
GRANT SELECT (id, tenant_id, phone_number_id, waba_id, numero_whatsapp,
              conectado, conectado_at, created_at, updated_at, numero_notificaciones)
  ON public.whatsapp_credentials TO authenticated;

COMMIT;

COMMENT ON COLUMN public.mercadopago_credentials.access_token IS
  'SECRETO. Sin SELECT para authenticated/anon (mig 400) — solo service_role. No agregarlo a ninguna consulta del frontend.';
COMMENT ON COLUMN public.tiendanube_credentials.access_token IS
  'SECRETO. Sin SELECT para authenticated/anon (mig 400) — solo service_role.';
COMMENT ON COLUMN public.whatsapp_credentials.access_token IS
  'SECRETO (System User, no vence). Sin SELECT para authenticated/anon (mig 400) — solo service_role.';
