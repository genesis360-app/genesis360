-- 407 — Catálogo de ubicaciones de recursos
--
-- Pedido de Fede (2026-09-11):
--
--   > "En el modulo recursos>ubicaciones esa pestaña no es para asignar ubicación a un recurso,
--   >  debería ser para crear ubicaciones y visualizarlas, por lo que el botón asignar ubicación
--   >  debería ser crear ubicación."
--
-- Hoy `recursos.ubicacion` es TEXTO LIBRE y la pestaña agrupa los recursos por ese texto. O sea que
-- una ubicación **no existe hasta que hay un recurso parado en ella**: no hay nada que "crear", y
-- por eso el único botón posible era "asignar". Para que la pestaña sea lo que pide Fede, la
-- ubicación tiene que ser una entidad propia.
--
-- El texto libre además invita al problema clásico de la escritura desprolija: en DEV el mismo
-- lugar aparece como "Deposito" en un tenant y "Depósito" en otro. Todavía no hay un duplicado
-- DENTRO de un mismo tenant (se verificó), pero con texto libre es cuestión de tiempo — y sin
-- catálogo no hay forma de corregirlo sin editar recurso por recurso.
--
-- ── Por qué una tabla NUEVA y no reusar `ubicaciones` ────────────────────────────────────────
-- `ubicaciones` es del WMS: tiene `tipo_logico`, dimensiones, cubicaje, zona y sucursal, y la usan
-- el picking, el stock y los repositores. Una ubicación de RECURSO es otra cosa: "Oficina 2",
-- "Mostrador", "Depósito" — dónde está parada una impresora o un mueble. Mezclarlas contaminaría
-- el árbol del depósito con lugares que no tienen stock y que el picking nunca debe ver.
--
-- ── Compatibilidad ───────────────────────────────────────────────────────────────────────────
-- `recursos.ubicacion` (texto) NO se dropea acá, a propósito: el mismo criterio de la mig 402 con
-- `tenants.afipsdk_token`. Las migraciones llegan a PROD antes o junto con el código, y el frontend
-- viejo todavía lee y escribe esa columna. Se dropea en una migración futura, cuando PROD corra el
-- código que usa `ubicacion_id`. Mientras tanto el trigger mantiene el texto en sincronía, así que
-- las dos vistas coinciden y ninguna pantalla se rompe.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) El catálogo
--    `sucursal_id` es OPCIONAL (NULL = ubicación de todo el negocio): un "Depósito" puede existir
--    en cada sucursal, pero una "Oficina de administración" puede ser única. No se fuerza ninguno
--    de los dos modelos.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recurso_ubicaciones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nombre      text NOT NULL CHECK (btrim(nombre) <> ''),
  descripcion text,
  sucursal_id uuid REFERENCES public.sucursales(id),
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nombre)
);

COMMENT ON TABLE public.recurso_ubicaciones IS
  'Catalogo de lugares donde puede estar un recurso (mig 407). Distinto de `ubicaciones`, que es el '
  'arbol del WMS con stock, cubicaje y picking. Aca son lugares fisicos del negocio: Oficina, '
  'Mostrador, Deposito.';

CREATE INDEX IF NOT EXISTS idx_recurso_ubicaciones_tenant
  ON public.recurso_ubicaciones (tenant_id) WHERE activo;

ALTER TABLE public.recurso_ubicaciones ENABLE ROW LEVEL SECURITY;

-- Lectura: todo el tenant (el listado de recursos la muestra).
-- Escritura: gestion. `/recursos` es `ownerOnly` en el nav (AppLayout.tsx), asi que la base
-- sostiene lo mismo — criterio de la mig 404 para las tablas de configuracion.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='recurso_ubicaciones'
                    AND policyname='recurso_ubicaciones_select') THEN
    CREATE POLICY recurso_ubicaciones_select ON public.recurso_ubicaciones
      FOR SELECT USING (tenant_id = public.get_user_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='recurso_ubicaciones'
                    AND policyname='recurso_ubicaciones_write_gestion') THEN
    CREATE POLICY recurso_ubicaciones_write_gestion ON public.recurso_ubicaciones
      FOR ALL
      USING (tenant_id = public.get_user_tenant_id()
             AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']))
      WITH CHECK (tenant_id = public.get_user_tenant_id()
             AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']));
  END IF;
END $$;

REVOKE ALL ON public.recurso_ubicaciones FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) El vinculo desde el recurso
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.recursos
  ADD COLUMN IF NOT EXISTS ubicacion_id uuid REFERENCES public.recurso_ubicaciones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recursos_ubicacion_id
  ON public.recursos (ubicacion_id) WHERE ubicacion_id IS NOT NULL;

COMMENT ON COLUMN public.recursos.ubicacion_id IS
  'FK al catalogo (mig 407). `recursos.ubicacion` (texto) queda como espejo de solo lectura, '
  'mantenido por trigger, hasta que PROD corra el codigo que usa esta columna.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) Seed: cada texto distinto que hoy existe pasa a ser una ubicacion del catalogo
--
--    Se normaliza el espaciado pero NO los acentos: unificar "Deposito" con "Deposito" seria
--    decidir por el usuario cual de las dos escrituras es la buena. Se crean las dos y que el
--    dueno las unifique desde la pantalla, que ahora puede.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.recurso_ubicaciones (tenant_id, nombre)
SELECT DISTINCT r.tenant_id, btrim(r.ubicacion)
  FROM public.recursos r
 WHERE r.ubicacion IS NOT NULL AND btrim(r.ubicacion) <> ''
ON CONFLICT (tenant_id, nombre) DO NOTHING;

-- Backfill del vinculo.
UPDATE public.recursos r
   SET ubicacion_id = ru.id
  FROM public.recurso_ubicaciones ru
 WHERE ru.tenant_id = r.tenant_id
   AND ru.nombre = btrim(r.ubicacion)
   AND r.ubicacion_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) El texto queda en sincronia con el catalogo
--    Asi el frontend viejo (que lee `ubicacion`) y el nuevo (que usa `ubicacion_id`) ven lo mismo
--    durante la transicion, y renombrar una ubicacion se refleja en los recursos.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recursos_sync_ubicacion_texto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ubicacion_id IS NULL THEN
    -- Sin catalogo: se respeta lo que venga en el texto (compatibilidad con el form viejo).
    RETURN NEW;
  END IF;
  SELECT ru.nombre INTO NEW.ubicacion
    FROM public.recurso_ubicaciones ru WHERE ru.id = NEW.ubicacion_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_recursos_sync_ubicacion_texto ON public.recursos;
CREATE TRIGGER trg_recursos_sync_ubicacion_texto
  BEFORE INSERT OR UPDATE OF ubicacion_id ON public.recursos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recursos_sync_ubicacion_texto();

-- Renombrar una ubicacion arrastra el texto de todos sus recursos.
CREATE OR REPLACE FUNCTION public.fn_recurso_ubicacion_propagar_nombre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.recursos SET ubicacion = NEW.nombre WHERE ubicacion_id = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recurso_ubicacion_propagar_nombre ON public.recurso_ubicaciones;
CREATE TRIGGER trg_recurso_ubicacion_propagar_nombre
  AFTER UPDATE OF nombre ON public.recurso_ubicaciones
  FOR EACH ROW WHEN (OLD.nombre IS DISTINCT FROM NEW.nombre)
  EXECUTE FUNCTION public.fn_recurso_ubicacion_propagar_nombre();

-- `updated_at`
CREATE OR REPLACE FUNCTION public.fn_updated_at_recurso_ubicaciones()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_updated_at_recurso_ubicaciones ON public.recurso_ubicaciones;
CREATE TRIGGER trg_updated_at_recurso_ubicaciones
  BEFORE UPDATE ON public.recurso_ubicaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at_recurso_ubicaciones();

COMMIT;
