-- 416 — Dropear `tenants.afipsdk_token`, la copia legacy del token de AfipSDK
--
-- Historia:
--   · El token de AfipSDK es un SECRETO. Vivía en `tenants.afipsdk_token`, que todo el frontend lee
--     con `select('*')` → lo veía cualquier usuario del tenant.
--   · Mig 402: el token pasó a `emisores_fiscales.afipsdk_token` con privilegio a nivel COLUMNA (no lo
--     lee nadie desde el browser, ni el DUEÑO), y la copia de `tenants` se vació y quedó forzada a
--     NULL por el trigger `trg_tenants_afipsdk_token_deprecado`. No se dropeó en ese momento a
--     propósito: PROD todavía corría código que la leía.
--   · PROD corre el código nuevo desde el deploy del 13/09 (v1.218.0).
--
-- Verificado el 2026-09-14 antes de escribir esto:
--   · 0 filas con `afipsdk_token` no nulo, en DEV y en PROD.
--   · Sin vistas ni policies que dependan de la columna.
--   · Único lector: la EF `emitir-factura` (fallback legacy del emisor), que se cambió para no
--     pedirla. 🛑 ORDEN DE DEPLOY: esa EF va a DEV y a PROD ANTES de esta migración — si no, el
--     `select` de la EF pide una columna inexistente y la facturación falla con 400.
--   · El panel de soporte (`genesis360-admin`) no la usa.
--
-- `emisores_fiscales.afipsdk_token` y `platform_billers.afipsdk_token` NO se tocan: son los
-- lugares donde el token vive de verdad.

-- Guard: si por algún camino alguien cargó un token, frenar en vez de perderlo en silencio.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE afipsdk_token IS NOT NULL) THEN
    RAISE EXCEPTION 'tenants.afipsdk_token tiene datos: revisar antes de dropear (mig 416)';
  END IF;
END $$;

-- El trigger escribe `NEW.afipsdk_token`: dropear la columna sin él haría fallar TODO insert/update
-- sobre `tenants` en tiempo de ejecución.
DROP TRIGGER IF EXISTS trg_tenants_afipsdk_token_deprecado ON public.tenants;
DROP FUNCTION IF EXISTS public.fn_tenants_afipsdk_token_deprecado();

ALTER TABLE public.tenants DROP COLUMN IF EXISTS afipsdk_token;
