-- 442 — Categorías de clientes, etapa 1: la categoría con cuenta corriente (Fase 2 del plan)
--
-- Fuentes: relevamiento de Fede (20/09, `relevamiento_categorias_clientes_respuestas.md`), respuestas de GO a B-1..B-9
-- (25/09) y tres decisiones de GO del 2026-09-26 sobre cuenta corriente (ver "Decisiones" abajo). Plan:
-- `plan_categorias_clientes_y_precio_programado.md`, Fase 2. El PRECIO de categoría es la Fase 4: acá no se toca.
--
-- Qué hace:
--  1. `categorias_cliente`: una por cliente (`clientes.categoria_cliente_id`), activar/desactivar, borrar solo si
--     nunca se usó (C2). Las 5 condiciones de CC son opcionales; NULL = hereda del negocio (D3, D4).
--  2. 🛑 UNA sola resolución de las condiciones de CC: `vw_clientes_cc` (Cliente > Categoría ACTIVA > Negocio, D1) y
--     `fn_cc_condiciones_efectivas(cliente)` que la lee. Antes cada función resolvía por su cuenta y diferían.
--  3. Todos los consumidores pasan a leer de ahí: el guard de ventas, Pedidos → venta, el interés, los avisos de vencido.
--  4. Permisos (E1, E2): gestionar y asignar categorías = DUEÑO + roles habilitables en Config. Los valores PROPIOS de
--     CC de un cliente (override) solo los toca el DUEÑO (E3). Guards en el servidor, no solo en pantalla.
--  5. Auditoría (F1, E2): cambios de la categoría, asignaciones y overrides van a `actividad_log` desde triggers.
--
-- Decisiones de GO del 2026-09-26 (AskUserQuestion, al relevar el código antes de esta migración):
--  · Plazo: UNA regla. Vencimiento de cada venta CC = fecha + plazo efectivo (Cliente > Categoría > Negocio, 30 días si
--    nadie lo define), calculado por el SERVIDOR para POS y Pedidos. Antes el POS vencía a los días del NEGOCIO e
--    ignoraba el plazo del cliente, los avisos usaban el del cliente, y Pedidos no ponía vencimiento (sin interés nunca).
--  · Valores de fábrica → "hereda": plazo 30 y CC habilitada = false pasan a NULL. Sin categoría el resultado es el
--    mismo que hoy (el fallback del negocio es 30 días / no habilitada). Medido: PROD 0 clientes con plazo ≠ 30.
--  · CC habilitada también en el servidor: una venta con parte en CC de un cliente sin CC habilitada se rechaza.
--
-- Exposición medida en PROD (26/09): 0 ventas CC con deuda, 5 clientes con CC habilitada, 1 negocio con interés (y ya
-- tiene 30 días configurados). Efecto de la regla nueva en negocios SIN días configurados: sus ventas CC ahora vencen a
-- los 30 días (antes no vencían nunca → nunca había interés ni morosidad).
--
-- Definiciones de partida leídas de DEV. `fn_notificar_cc_vencidas` y `recalcular_intereses_cc[_all]` idénticas en PROD;
-- `fn_ventas_cc_guard` difiere solo en comentarios; `fn_pedido_generar_venta` difiere por la mig 440 (que va antes).

-- ── 1. Tabla de categorías ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.categorias_cliente (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nombre                  text NOT NULL CHECK (btrim(nombre) <> ''),
  descripcion             text,
  activo                  boolean NOT NULL DEFAULT true,
  -- Se prende la primera vez que se asigna a un cliente: desde ahí no se puede borrar, solo desactivar (C2).
  usada                   boolean NOT NULL DEFAULT false,
  -- Condiciones de cuenta corriente (D3). NULL = hereda del negocio.
  cc_habilitada           boolean,
  cc_limite               numeric(14,2) CHECK (cc_limite IS NULL OR cc_limite >= 0),
  cc_plazo_dias           integer CHECK (cc_plazo_dias IS NULL OR cc_plazo_dias BETWEEN 1 AND 365),
  cc_interes_mensual_pct  numeric(6,3) CHECK (cc_interes_mensual_pct IS NULL OR cc_interes_mensual_pct >= 0),
  cc_enforcement_politica text CHECK (cc_enforcement_politica IS NULL OR cc_enforcement_politica IN ('permitir', 'avisar', 'bloquear')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS categorias_cliente_tenant_nombre_key ON public.categorias_cliente (tenant_id, lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS categorias_cliente_tenant_idx ON public.categorias_cliente (tenant_id);

COMMENT ON TABLE public.categorias_cliente IS
  'Categorías de clientes (mig 442). Etapa 1: condiciones de cuenta corriente (NULL = hereda del negocio). El precio por categoría llega en la Fase 4.';

-- ── 2. Permisos configurables (E1, E2) ──────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS categorias_cliente_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS categorias_cliente_asignar_roles jsonb NOT NULL DEFAULT '[]'::jsonb;
GRANT UPDATE (categorias_cliente_roles, categorias_cliente_asignar_roles) ON public.tenants TO authenticated;

COMMENT ON COLUMN public.tenants.categorias_cliente_roles IS
  'Mig 442 (E1): roles ADICIONALES a DUEÑO que crean/editan categorías de clientes. Formato: "SUPERVISOR", "custom:<uuid>".';
COMMENT ON COLUMN public.tenants.categorias_cliente_asignar_roles IS
  'Mig 442 (E2): roles ADICIONALES a DUEÑO que asignan categorías a clientes.';

-- ¿El usuario actual tiene uno de los roles de la lista (DUEÑO y ADMIN siempre)? Sin sesión (cron, service_role) = sí.
CREATE OR REPLACE FUNCTION public.fn_usuario_en_roles_categoria(p_columna text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text; v_custom uuid; v_tenant uuid; v_lista jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN true; END IF;
  SELECT rol, rol_custom_id, tenant_id INTO v_rol, v_custom, v_tenant FROM users WHERE id = auth.uid() AND activo IS NOT FALSE;
  IF v_rol IS NULL THEN RETURN false; END IF;
  IF v_rol IN ('DUEÑO', 'ADMIN') THEN RETURN true; END IF;
  IF p_columna = 'gestionar' THEN
    SELECT categorias_cliente_roles INTO v_lista FROM tenants WHERE id = v_tenant;
  ELSIF p_columna = 'asignar' THEN
    SELECT categorias_cliente_asignar_roles INTO v_lista FROM tenants WHERE id = v_tenant;
  ELSE
    RETURN false;
  END IF;
  RETURN v_lista IS NOT NULL AND (v_lista ? v_rol OR (v_custom IS NOT NULL AND v_lista ? ('custom:' || v_custom::text)));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_usuario_en_roles_categoria(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_usuario_en_roles_categoria(text) TO authenticated, service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.categorias_cliente ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categorias_cliente' AND policyname='categorias_cliente_select') THEN
    CREATE POLICY categorias_cliente_select ON public.categorias_cliente FOR SELECT TO authenticated
      USING (tenant_id = get_user_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categorias_cliente' AND policyname='categorias_cliente_insert') THEN
    CREATE POLICY categorias_cliente_insert ON public.categorias_cliente FOR INSERT TO authenticated
      WITH CHECK (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categorias_cliente' AND policyname='categorias_cliente_update') THEN
    CREATE POLICY categorias_cliente_update ON public.categorias_cliente FOR UPDATE TO authenticated
      USING (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'))
      WITH CHECK (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categorias_cliente' AND policyname='categorias_cliente_delete') THEN
    CREATE POLICY categorias_cliente_delete ON public.categorias_cliente FOR DELETE TO authenticated
      USING (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'));
  END IF;
END $$;

REVOKE ALL ON public.categorias_cliente FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias_cliente TO authenticated;
GRANT ALL ON public.categorias_cliente TO service_role;

-- ── 3. Cliente: categoría + valores de fábrica → "hereda" ───────────────────────────────────────────────
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS categoria_cliente_id uuid REFERENCES public.categorias_cliente(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS clientes_categoria_cliente_idx ON public.clientes (categoria_cliente_id) WHERE categoria_cliente_id IS NOT NULL;
GRANT UPDATE (categoria_cliente_id) ON public.clientes TO authenticated;

-- Decisión de GO: los valores de fábrica pasan a heredar. Con el fallback del negocio (30 días / no habilitada) el
-- resultado efectivo de hoy no cambia para ningún cliente sin categoría.
ALTER TABLE public.clientes ALTER COLUMN cuenta_corriente_habilitada DROP DEFAULT;
ALTER TABLE public.clientes ALTER COLUMN plazo_pago_dias DROP DEFAULT;
UPDATE public.clientes SET cuenta_corriente_habilitada = NULL WHERE cuenta_corriente_habilitada = false;
UPDATE public.clientes SET plazo_pago_dias = NULL WHERE plazo_pago_dias = 30;

COMMENT ON COLUMN public.clientes.cuenta_corriente_habilitada IS 'Valor PROPIO del cliente (mig 442). NULL = hereda de la categoría (o no habilitada). Leer el efectivo de vw_clientes_cc.';
COMMENT ON COLUMN public.clientes.plazo_pago_dias IS 'Valor PROPIO del cliente (mig 442). NULL = hereda (categoría > negocio > 30). Leer el efectivo de vw_clientes_cc.';
COMMENT ON COLUMN public.clientes.limite_credito IS 'Valor PROPIO del cliente. NULL = hereda (categoría > negocio). Leer el efectivo de vw_clientes_cc.';

-- ── 4. 🛑 UNA sola resolución: Cliente > Categoría ACTIVA > Negocio (D1) ─────────────────────────────────
CREATE OR REPLACE VIEW public.vw_clientes_cc
WITH (security_invoker = true) AS
SELECT
  c.id                    AS cliente_id,
  c.tenant_id,
  c.categoria_cliente_id,
  cat.nombre              AS categoria_nombre,
  COALESCE(c.cuenta_corriente_habilitada, cat.cc_habilitada, false)            AS cc_habilitada,
  COALESCE(c.limite_credito, cat.cc_limite, t.limite_cc_default)               AS cc_limite,
  COALESCE(c.plazo_pago_dias, cat.cc_plazo_dias, t.cc_dias_vencimiento, 30)    AS cc_plazo_dias,
  COALESCE(cat.cc_interes_mensual_pct, t.cc_interes_mensual_pct, 0)            AS cc_interes_mensual_pct,
  COALESCE(cat.cc_enforcement_politica, t.cc_enforcement_politica, 'avisar')   AS cc_enforcement_politica,
  -- De dónde sale cada valor (C3: "valor propio" frente a heredado).
  CASE WHEN c.cuenta_corriente_habilitada IS NOT NULL THEN 'cliente' WHEN cat.cc_habilitada IS NOT NULL THEN 'categoria' ELSE 'negocio' END AS origen_habilitada,
  CASE WHEN c.limite_credito IS NOT NULL THEN 'cliente' WHEN cat.cc_limite IS NOT NULL THEN 'categoria' ELSE 'negocio' END AS origen_limite,
  CASE WHEN c.plazo_pago_dias IS NOT NULL THEN 'cliente' WHEN cat.cc_plazo_dias IS NOT NULL THEN 'categoria' ELSE 'negocio' END AS origen_plazo,
  CASE WHEN cat.cc_interes_mensual_pct IS NOT NULL THEN 'categoria' ELSE 'negocio' END AS origen_interes,
  CASE WHEN cat.cc_enforcement_politica IS NOT NULL THEN 'categoria' ELSE 'negocio' END AS origen_enforcement
FROM public.clientes c
JOIN public.tenants t ON t.id = c.tenant_id
-- Una categoría DESACTIVADA deja de aplicar (C2): el cliente pasa a heredar del negocio.
LEFT JOIN public.categorias_cliente cat ON cat.id = c.categoria_cliente_id AND cat.activo;

GRANT SELECT ON public.vw_clientes_cc TO authenticated, service_role;
REVOKE ALL ON public.vw_clientes_cc FROM anon;

COMMENT ON VIEW public.vw_clientes_cc IS
  'Condiciones de cuenta corriente EFECTIVAS por cliente (mig 442): Cliente > Categoría activa > Negocio. Única fuente para POS, Pedidos, interés y avisos.';

CREATE OR REPLACE FUNCTION public.fn_cc_condiciones_efectivas(p_cliente_id uuid)
 RETURNS TABLE (cc_habilitada boolean, cc_limite numeric, cc_plazo_dias integer, cc_interes_mensual_pct numeric, cc_enforcement_politica text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT v.cc_habilitada, v.cc_limite, v.cc_plazo_dias, v.cc_interes_mensual_pct, v.cc_enforcement_politica
    FROM public.vw_clientes_cc v
   WHERE v.cliente_id = p_cliente_id
     -- Con sesión, solo clientes del propio negocio (sin sesión: triggers y crons).
     AND (auth.uid() IS NULL OR v.tenant_id = get_user_tenant_id())
$function$;
REVOKE ALL ON FUNCTION public.fn_cc_condiciones_efectivas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cc_condiciones_efectivas(uuid) TO authenticated, service_role;

-- ── 5. Guards de clientes: asignar categoría (E2) y valores propios de CC (E3) ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_clientes_categoria_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text;
  v_cat RECORD;
BEGIN
  IF NEW.categoria_cliente_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.categoria_cliente_id END) THEN
    IF NEW.categoria_cliente_id IS NOT NULL THEN
      SELECT tenant_id, activo INTO v_cat FROM categorias_cliente WHERE id = NEW.categoria_cliente_id;
      IF v_cat.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'La categoría no es de este negocio' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT v_cat.activo THEN
        RAISE EXCEPTION 'La categoría está desactivada: no se puede asignar' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NOT fn_usuario_en_roles_categoria('asignar') THEN
      RAISE EXCEPTION 'No autorizado: tu rol no puede asignar categorías de clientes.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.categoria_cliente_id IS NOT NULL THEN
      UPDATE categorias_cliente SET usada = true WHERE id = NEW.categoria_cliente_id AND NOT usada;
    END IF;
  END IF;

  -- E3: los valores PROPIOS de cuenta corriente de un cliente los pone solo el DUEÑO (y el staff ADMIN).
  IF auth.uid() IS NOT NULL AND (
       (TG_OP = 'INSERT' AND (NEW.cuenta_corriente_habilitada IS NOT NULL OR NEW.limite_credito IS NOT NULL OR NEW.plazo_pago_dias IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (NEW.cuenta_corriente_habilitada IS DISTINCT FROM OLD.cuenta_corriente_habilitada
                           OR NEW.limite_credito IS DISTINCT FROM OLD.limite_credito
                           OR NEW.plazo_pago_dias IS DISTINCT FROM OLD.plazo_pago_dias))) THEN
    SELECT rol INTO v_rol FROM users WHERE id = auth.uid();
    IF v_rol IS DISTINCT FROM 'DUEÑO' AND v_rol IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'No autorizado: solo el dueño puede darle a un cliente condiciones de cuenta corriente propias.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clientes_categoria_guard ON public.clientes;
CREATE TRIGGER trg_clientes_categoria_guard
  BEFORE INSERT OR UPDATE OF categoria_cliente_id, cuenta_corriente_habilitada, limite_credito, plazo_pago_dias ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_clientes_categoria_guard();

-- Borrar una categoría: solo si nunca se usó (C2). "Usada" = algún cliente la tuvo alguna vez (marca `usada`).
CREATE OR REPLACE FUNCTION public.fn_categorias_cliente_guard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.usada OR EXISTS (SELECT 1 FROM clientes WHERE categoria_cliente_id = OLD.id) THEN
    RAISE EXCEPTION 'La categoría "%" ya se usó: desactivala en lugar de borrarla (se conserva el historial).', OLD.nombre
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_categorias_cliente_guard_delete ON public.categorias_cliente;
CREATE TRIGGER trg_categorias_cliente_guard_delete
  BEFORE DELETE ON public.categorias_cliente
  FOR EACH ROW EXECUTE FUNCTION public.fn_categorias_cliente_guard_delete();

CREATE OR REPLACE FUNCTION public.fn_categorias_cliente_touch()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$;
DROP TRIGGER IF EXISTS trg_categorias_cliente_touch ON public.categorias_cliente;
CREATE TRIGGER trg_categorias_cliente_touch BEFORE UPDATE ON public.categorias_cliente
  FOR EACH ROW EXECUTE FUNCTION public.fn_categorias_cliente_touch();

-- ── 6. Auditoría (F1, E2) en actividad_log, desde el servidor ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_log_categoria(p_tenant uuid, p_entidad text, p_entidad_id uuid, p_nombre text,
                                                   p_accion text, p_campo text, p_ant text, p_nuevo text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id, entidad_nombre, accion, campo,
                             valor_anterior, valor_nuevo, pagina)
  SELECT p_tenant, auth.uid(), COALESCE((SELECT nombre_display FROM users WHERE id = auth.uid()), 'Sistema'),
         p_entidad, p_entidad_id::text, p_nombre, p_accion, p_campo, p_ant, p_nuevo, '/clientes'
$function$;
REVOKE ALL ON FUNCTION public.fn_log_categoria(uuid, text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_categorias_cliente_auditar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f text; v_ant text; v_nue text;
  campos text[] := ARRAY['nombre','descripcion','activo','cc_habilitada','cc_limite','cc_plazo_dias','cc_interes_mensual_pct','cc_enforcement_politica'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_log_categoria(NEW.tenant_id, 'categoria_cliente', NEW.id, NEW.nombre, 'crear', NULL, NULL, NULL);
    RETURN NEW;
  END IF;
  FOREACH f IN ARRAY campos LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', f, f) INTO v_ant, v_nue USING OLD, NEW;
    IF v_ant IS DISTINCT FROM v_nue THEN
      PERFORM fn_log_categoria(NEW.tenant_id, 'categoria_cliente', NEW.id, NEW.nombre,
        CASE WHEN f = 'activo' THEN 'cambio_estado' ELSE 'editar' END, f,
        COALESCE(v_ant, 'hereda'), COALESCE(v_nue, 'hereda'));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_categorias_cliente_auditar ON public.categorias_cliente;
CREATE TRIGGER trg_categorias_cliente_auditar AFTER INSERT OR UPDATE ON public.categorias_cliente
  FOR EACH ROW EXECUTE FUNCTION public.fn_categorias_cliente_auditar();

CREATE OR REPLACE FUNCTION public.fn_clientes_categoria_auditar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ant text; v_nue text;
BEGIN
  IF NEW.categoria_cliente_id IS DISTINCT FROM OLD.categoria_cliente_id THEN
    SELECT nombre INTO v_ant FROM categorias_cliente WHERE id = OLD.categoria_cliente_id;
    SELECT nombre INTO v_nue FROM categorias_cliente WHERE id = NEW.categoria_cliente_id;
    PERFORM fn_log_categoria(NEW.tenant_id, 'cliente', NEW.id, NEW.nombre, 'editar', 'categoría', COALESCE(v_ant, 'sin categoría'), COALESCE(v_nue, 'sin categoría'));
  END IF;
  IF NEW.cuenta_corriente_habilitada IS DISTINCT FROM OLD.cuenta_corriente_habilitada THEN
    PERFORM fn_log_categoria(NEW.tenant_id, 'cliente', NEW.id, NEW.nombre, 'editar', 'CC propia: habilitada', COALESCE(OLD.cuenta_corriente_habilitada::text, 'hereda'), COALESCE(NEW.cuenta_corriente_habilitada::text, 'hereda'));
  END IF;
  IF NEW.limite_credito IS DISTINCT FROM OLD.limite_credito THEN
    PERFORM fn_log_categoria(NEW.tenant_id, 'cliente', NEW.id, NEW.nombre, 'editar', 'CC propia: límite', COALESCE(OLD.limite_credito::text, 'hereda'), COALESCE(NEW.limite_credito::text, 'hereda'));
  END IF;
  IF NEW.plazo_pago_dias IS DISTINCT FROM OLD.plazo_pago_dias THEN
    PERFORM fn_log_categoria(NEW.tenant_id, 'cliente', NEW.id, NEW.nombre, 'editar', 'CC propia: plazo', COALESCE(OLD.plazo_pago_dias::text, 'hereda'), COALESCE(NEW.plazo_pago_dias::text, 'hereda'));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clientes_categoria_auditar ON public.clientes;
CREATE TRIGGER trg_clientes_categoria_auditar
  AFTER UPDATE OF categoria_cliente_id, cuenta_corriente_habilitada, limite_credito, plazo_pago_dias ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_clientes_categoria_auditar();

-- ── 7. Asignación masiva en UNA operación (B-6), con decisión por cliente sobre sus valores propios (D2) ─
-- p_items: [{ "cliente_id": uuid, "mantener_propios": bool, "limite": num|null, "plazo": int|null, "habilitada": bool|null,
--             "editar": bool }] — "editar" = usar los valores de limite/plazo/habilitada que vienen (null = hereda).
-- Sin "editar": mantener_propios=true deja los propios; false los borra (pasa a heredar de la categoría).
CREATE OR REPLACE FUNCTION public.fn_asignar_categoria_clientes(p_categoria_id uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  it jsonb; v_n integer := 0; v_id uuid;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No hay clientes para asignar';
  END IF;
  IF jsonb_array_length(p_items) > 5000 THEN
    RAISE EXCEPTION 'Demasiados clientes en una sola asignación (máximo 5000)';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_id := (it->>'cliente_id')::uuid;
    IF COALESCE((it->>'editar')::boolean, false) THEN
      UPDATE clientes SET categoria_cliente_id = p_categoria_id,
             limite_credito = (it->>'limite')::numeric,
             plazo_pago_dias = (it->>'plazo')::integer,
             cuenta_corriente_habilitada = (it->>'habilitada')::boolean
       WHERE id = v_id;
    ELSIF COALESCE((it->>'mantener_propios')::boolean, true) THEN
      UPDATE clientes SET categoria_cliente_id = p_categoria_id WHERE id = v_id;
    ELSE
      UPDATE clientes SET categoria_cliente_id = p_categoria_id,
             limite_credito = NULL, plazo_pago_dias = NULL, cuenta_corriente_habilitada = NULL
       WHERE id = v_id;
    END IF;
    IF NOT FOUND THEN
      -- RLS: cliente de otro negocio o inexistente → toda la operación se cae (una sola operación, B-6).
      RAISE EXCEPTION 'Cliente % inexistente o de otro negocio', v_id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_asignar_categoria_clientes(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_asignar_categoria_clientes(uuid, jsonb) TO authenticated;

-- ── 8. Vencimiento de cada venta CC: UNA regla, en el servidor ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ventas_cc_vencimiento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plazo integer;
BEGIN
  -- En un UPDATE solo se completa cuando la venta RECIÉN pasa a CC o sale de presupuesto/reserva: una venta vieja sin
  -- fecha no recibe un vencimiento retroactivo porque alguien le cambió el estado (REGLA #0 punto 7).
  IF COALESCE(NEW.es_cuenta_corriente, false) AND NEW.cliente_id IS NOT NULL AND NEW.estado <> 'pendiente'
     AND (TG_OP = 'INSERT'
          OR (NEW.fecha_vencimiento_cc IS NULL
              AND (OLD.es_cuenta_corriente IS DISTINCT FROM NEW.es_cuenta_corriente OR OLD.estado IN ('pendiente', 'reservada')))) THEN
    SELECT cc_plazo_dias INTO v_plazo FROM vw_clientes_cc WHERE cliente_id = NEW.cliente_id;
    NEW.fecha_vencimiento_cc := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + COALESCE(v_plazo, 30);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ventas_cc_vencimiento ON public.ventas;
CREATE TRIGGER trg_ventas_cc_vencimiento
  BEFORE INSERT OR UPDATE OF es_cuenta_corriente, estado ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.fn_ventas_cc_vencimiento();

-- ── 9. Guard de ventas: condiciones efectivas + CC habilitada en el servidor ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ventas_cc_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_eps         numeric := 0.5;
  v_es_cc       boolean := COALESCE(NEW.es_cuenta_corriente, false);
  v_monto_cc    numeric := 0;
  v_deuda_total numeric := 0;
  v_deuda_venc  numeric := 0;
  v_cc          RECORD;
  v_moros       text;
BEGIN
  IF NEW.estado = 'pendiente' OR NEW.cliente_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_moros := COALESCE((SELECT cc_morosidad_politica FROM public.tenants WHERE id = NEW.tenant_id), 'bloqueo_cc');

  IF NOT (v_es_cc OR v_moros = 'bloqueo_total') THEN
    RETURN NEW;
  END IF;

  -- Deuda del cliente ANTES de esta venta (BEFORE INSERT → NEW aún no está en la tabla).
  -- Espeja cliente_cc_estado pero scopeado por NEW.tenant_id (independiente de auth.uid()).
  SELECT
    COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0)), 0),
    COALESCE(SUM(CASE WHEN v.fecha_vencimiento_cc IS NOT NULL AND v.fecha_vencimiento_cc < CURRENT_DATE
                      THEN GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0) ELSE 0 END), 0)
    INTO v_deuda_total, v_deuda_venc
    FROM public.ventas v
    WHERE v.cliente_id = NEW.cliente_id
      AND v.tenant_id = NEW.tenant_id
      AND v.es_cuenta_corriente = TRUE
      AND v.estado <> 'cancelada'
      AND (v.total - v.monto_pagado) > v_eps;

  -- B4 — morosidad (política solo del negocio, D3).
  IF v_deuda_venc > v_eps THEN
    IF v_moros = 'bloqueo_total' THEN
      RAISE EXCEPTION 'Cliente con deuda vencida ($%). No puede comprar hasta saldar.', round(v_deuda_venc)
        USING ERRCODE = 'check_violation';
    ELSIF v_moros = 'bloqueo_cc' AND v_es_cc THEN
      RAISE EXCEPTION 'Cliente con deuda vencida ($%). No puede sumar a cuenta corriente; cobrá por otro medio.', round(v_deuda_venc)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_es_cc THEN
    BEGIN
      IF NEW.medio_pago IS NOT NULL AND btrim(NEW.medio_pago) <> '' THEN
        SELECT COALESCE(SUM((e->>'monto')::numeric), 0) INTO v_monto_cc
          FROM jsonb_array_elements(NEW.medio_pago::jsonb) e
          WHERE e->>'tipo' = 'Cuenta Corriente';
      END IF;
    EXCEPTION WHEN others THEN
      v_monto_cc := 0;
    END;

    IF v_monto_cc > v_eps THEN
      -- Mig 442: condiciones EFECTIVAS (Cliente > Categoría > Negocio).
      SELECT * INTO v_cc FROM public.vw_clientes_cc WHERE cliente_id = NEW.cliente_id;

      -- Mig 442 (decisión de GO): la CC habilitada también la controla el servidor.
      IF NOT COALESCE(v_cc.cc_habilitada, false) THEN
        RAISE EXCEPTION 'El cliente no tiene cuenta corriente habilitada. Cobrá por otro medio.'
          USING ERRCODE = 'check_violation';
      END IF;

      -- B1 — límite (solo si la política efectiva es 'bloquear').
      IF v_cc.cc_enforcement_politica = 'bloquear' AND v_cc.cc_limite IS NOT NULL
         AND (v_deuda_total + v_monto_cc) > v_cc.cc_limite + v_eps THEN
        RAISE EXCEPTION 'La venta deja la cuenta corriente en $% y supera el límite de $%. Operación bloqueada.',
          round(v_deuda_total + v_monto_cc), round(v_cc.cc_limite)
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- ── 10. Interés: el % efectivo de cada cliente (categoría > negocio) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recalcular_intereses_cc_tenant(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE ventas v SET interes_cc = ROUND(
      GREATEST(v.total - v.monto_pagado, 0)
      * (e.cc_interes_mensual_pct / 100.0)
      * (GREATEST(0, (CURRENT_DATE - v.fecha_vencimiento_cc)) / 30.0)
    , 2)
    FROM vw_clientes_cc e
   WHERE e.cliente_id = v.cliente_id
     AND v.tenant_id = p_tenant
     AND e.cc_interes_mensual_pct > 0
     AND v.es_cuenta_corriente = TRUE
     AND v.estado <> 'cancelada'
     AND v.fecha_vencimiento_cc IS NOT NULL
     AND (v.total - v.monto_pagado) > 0.5;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE ventas v SET interes_cc = 0
   WHERE v.tenant_id = p_tenant AND v.es_cuenta_corriente = TRUE AND v.interes_cc <> 0
     AND ((v.total - v.monto_pagado) <= 0.5
          OR v.fecha_vencimiento_cc IS NULL
          OR v.fecha_vencimiento_cc >= CURRENT_DATE
          OR v.cliente_id IS NULL
          OR COALESCE((SELECT e.cc_interes_mensual_pct FROM vw_clientes_cc e WHERE e.cliente_id = v.cliente_id), 0) <= 0);
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_recalcular_intereses_cc_tenant(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recalcular_intereses_cc(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 🔒 mig 437: get_user_tenant_id() mira `activo` (mig 433); el EXISTS sobre users no lo hacía.
  -- Sin usuario sigue devolviendo 0, igual que antes (el sweep usa recalcular_intereses_cc_all()).
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM get_user_tenant_id() THEN
    RETURN 0;
  END IF;
  -- Mig 442: el % sale de cada cliente (categoría > negocio), no solo del negocio.
  RETURN fn_recalcular_intereses_cc_tenant(p_tenant);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_intereses_cc_all()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INT := 0;
  t       RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    v_total := v_total + fn_recalcular_intereses_cc_tenant(t.id);
  END LOOP;
  RETURN v_total;
END;
$function$;

-- ── 11. Avisos de CC vencida: la misma fecha que interés y morosidad ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notificar_cc_vencidas()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
BEGIN

  -- ── 1. CC CLIENTES VENCIDAS ─────────────────────────────────────────────────
  FOR r IN
    SELECT
      v.tenant_id,
      v.cliente_id,
      c.nombre                                                                              AS cliente_nombre,
      ROUND(SUM(GREATEST(v.total - COALESCE(v.monto_pagado, 0), 0) + COALESCE(v.interes_cc, 0))::numeric, 2) AS deuda_total,
      u.id                                                                                   AS user_id
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    -- mig 421: antes ('OWNER','ADMIN'), que no incluía a ningún dueño.
    JOIN users u ON u.tenant_id = v.tenant_id AND u.rol IN ('DUEÑO','SUPER_USUARIO')
    WHERE v.es_cuenta_corriente = true
      AND v.estado IN ('despachada', 'facturada')
      AND (v.total - COALESCE(v.monto_pagado, 0)) > 0.5
      -- Mig 442: UNA regla — la misma fecha que usan interés y morosidad. Las ventas viejas sin fecha, con el plazo
      -- efectivo del cliente (Cliente > Categoría > Negocio > 30).
      AND COALESCE(v.fecha_vencimiento_cc,
                   (v.created_at + ((SELECT e.cc_plazo_dias FROM vw_clientes_cc e WHERE e.cliente_id = v.cliente_id) || ' days')::interval)::date)
          < CURRENT_DATE
    GROUP BY v.tenant_id, v.cliente_id, c.nombre, u.id
    HAVING SUM(GREATEST(v.total - COALESCE(v.monto_pagado, 0), 0) + COALESCE(v.interes_cc, 0)) > 0.5
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notificaciones
      WHERE user_id    = r.user_id
        AND action_url = '/clientes'
        AND titulo     LIKE '%' || r.cliente_nombre || '%'
        AND created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      VALUES (
        r.tenant_id,
        r.user_id,
        'warning',
        'CC vencida: ' || r.cliente_nombre,
        'Deuda vencida de $' || r.deuda_total || ' en cuenta corriente sin cobrar.',
        '/clientes'
      );
    END IF;
  END LOOP;

  -- ── 2. OC VENCIDAS SIN PAGAR ────────────────────────────────────────────────
  FOR r IN
    SELECT
      oc.tenant_id,
      oc.id         AS oc_id,
      oc.numero     AS oc_numero,
      p.nombre      AS proveedor_nombre,
      COALESCE(oc.monto_total, 0) AS monto,
      u.id          AS user_id
    FROM ordenes_compra oc
    JOIN proveedores p ON p.id = oc.proveedor_id
    -- mig 421: antes ('OWNER','ADMIN'), que no incluía a ningún dueño.
    JOIN users u ON u.tenant_id = oc.tenant_id AND u.rol IN ('DUEÑO','SUPER_USUARIO')
    WHERE oc.fecha_vencimiento_pago IS NOT NULL
      AND oc.fecha_vencimiento_pago < CURRENT_DATE
      AND oc.estado_pago NOT IN ('pagada')
      AND oc.estado NOT IN ('cancelada')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notificaciones
      WHERE user_id    = r.user_id
        AND action_url = '/proveedores'
        AND titulo     LIKE '%OC #' || r.oc_numero || '%'
        AND created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      VALUES (
        r.tenant_id,
        r.user_id,
        'danger',
        'OC #' || r.oc_numero || ' vencida — ' || r.proveedor_nombre,
        'Orden de compra por $' || r.monto || ' venció sin pagar.',
        '/proveedores'
      );
    END IF;
  END LOOP;

END;
$function$;

-- ── 12. Pedidos → venta: CC habilitada + condiciones efectivas ────────────────────────────────────────────
-- (parte de la definición con la mig 440 ya aplicada: la 440 va antes en el deploy)
CREATE OR REPLACE FUNCTION public.fn_pedido_generar_venta(p_pedido_id uuid, p_sesion_caja_id uuid, p_medio_pago jsonb, p_entregas jsonb DEFAULT NULL::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido          RECORD;
  v_sesion          RECORD;
  v_venta_existente uuid;
  v_item            RECORD;
  v_cant_entregar    numeric;
  v_cant_override    numeric;
  v_venta_id         uuid;
  v_subtotal         numeric := 0;
  v_total            numeric := 0;
  v_producto         RECORD;
  v_precio           numeric;
  v_cant_sku         numeric;
  v_desc_monto       numeric;
  v_desc_pct         numeric;
  v_desc_pcts        integer;
  v_pct_linea        numeric;
  v_iva_monto        numeric;
  v_item_subtotal    numeric;
  v_venta_item_id    uuid;
  v_linea            RECORD;
  v_restante         numeric;
  v_tomar            numeric;
  v_stock_antes      numeric;
  v_stock_despues    numeric;
  v_todo_entregado   boolean := true;
  v_hubo_entrega     boolean := false;
  v_cierre_auto      boolean;
  v_monto_efectivo   numeric := 0;
  v_monto_pagado     numeric := 0;
  v_monto_cc         numeric := 0;
  v_mp               jsonb;
  v_tiene_cc         boolean := false;
  v_traza_on         boolean;
  v_deuda_total      numeric;
  v_limite_credito   numeric;
  v_enforcement_pol  text;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_venta_existente FROM ventas
    WHERE pedido_id = p_pedido_id AND pedido_entrega_key = p_idempotency_key;
    IF v_venta_existente IS NOT NULL THEN RETURN v_venta_existente; END IF;
  END IF;

  IF v_pedido.estado NOT IN ('en_preparacion', 'listo_para_entrega', 'entregado_parcial') THEN
    RAISE EXCEPTION 'El pedido tiene que estar lanzado (en preparación, listo para entrega, o entregado parcial) para generar la venta';
  END IF;

  SELECT * INTO v_sesion FROM caja_sesiones WHERE id = p_sesion_caja_id FOR UPDATE;
  IF v_sesion IS NULL OR v_sesion.tenant_id <> v_pedido.tenant_id OR v_sesion.estado <> 'abierta' THEN
    RAISE EXCEPTION 'No hay una caja abierta válida para registrar el ingreso — abrí una caja antes de generar la venta';
  END IF;
  IF v_sesion.sucursal_id IS NOT NULL AND v_pedido.sucursal_id IS NOT NULL AND v_sesion.sucursal_id <> v_pedido.sucursal_id THEN
    RAISE EXCEPTION 'La caja elegida es de otra sucursal — elegí una caja abierta de la sucursal del pedido';
  END IF;

  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') = 'Cuenta Corriente' THEN v_tiene_cc := true; END IF;
  END LOOP;
  IF v_tiene_cc AND v_pedido.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente requiere un cliente identificado en el pedido';
  END IF;
  -- Mig 442 (decisión de GO): la CC habilitada también la controla el servidor (condición EFECTIVA).
  IF v_tiene_cc AND NOT COALESCE((SELECT e.cc_habilitada FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id), false) THEN
    RAISE EXCEPTION 'El cliente no tiene cuenta corriente habilitada. Cobrá por otro medio.';
  END IF;

  SELECT trazabilidad_asignacion INTO v_traza_on FROM tenants WHERE id = v_pedido.tenant_id;

  INSERT INTO ventas (
    tenant_id, cliente_id, cliente_nombre, cliente_telefono, consumidor_final, estado,
    subtotal, total, medio_pago, monto_pagado, es_cuenta_corriente, usuario_id, sucursal_id,
    origen, pedido_id, pedido_entrega_key, despachado_at
  ) VALUES (
    v_pedido.tenant_id, v_pedido.cliente_id,
    CASE WHEN v_pedido.cliente_id IS NULL THEN v_pedido.cliente_nombre END,
    CASE WHEN v_pedido.cliente_id IS NULL THEN v_pedido.cliente_telefono END,
    (v_pedido.cliente_id IS NULL), 'despachada', 0, 0, COALESCE(p_medio_pago, '[]'::jsonb)::text, 0,
    v_tiene_cc, auth.uid(), v_pedido.sucursal_id, 'Pedidos', p_pedido_id, p_idempotency_key, now()
  ) RETURNING id INTO v_venta_id;

  FOR v_item IN
    SELECT pi.id, pi.producto_id, pi.estado_id, pi.cantidad, pi.cantidad_entregada,
           (pi.cantidad - pi.cantidad_entregada) AS pendiente,
           pi.talle, pi.color, pi.encaje, pi.formato, pi.sabor_aroma
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
  LOOP
    v_cant_entregar := v_item.pendiente;
    IF p_entregas IS NOT NULL THEN
      v_cant_override := NULL;
      SELECT (e->>'cantidad')::numeric INTO v_cant_override
      FROM jsonb_array_elements(p_entregas) e
      WHERE (e->>'pedido_item_id')::uuid = v_item.id;
      IF v_cant_override IS NOT NULL THEN
        v_cant_entregar := LEAST(v_cant_override, v_item.pendiente);
      ELSE
        v_cant_entregar := 0;
      END IF;
    END IF;

    IF v_cant_entregar IS NULL OR v_cant_entregar <= 0 THEN
      IF v_item.pendiente > 0 THEN v_todo_entregado := false; END IF;
      CONTINUE;
    END IF;

    SELECT nombre, sku, precio_venta, precio_costo, alicuota_iva INTO v_producto
    FROM productos WHERE id = v_item.producto_id;
    SELECT COALESCE(SUM(pi2.cantidad), v_cant_entregar) INTO v_cant_sku
    FROM pedido_items pi2
    WHERE pi2.pedido_id = p_pedido_id AND pi2.producto_id = v_item.producto_id
      AND pi2.estado <> 'cancelada';
    v_precio := fn_precio_venta_efectivo(v_pedido.tenant_id, v_item.producto_id, v_cant_sku);
    v_item_subtotal := ROUND(v_precio * v_cant_entregar, 2);
    v_iva_monto := CASE WHEN COALESCE(v_producto.alicuota_iva, 0) > 0
      THEN ROUND(v_item_subtotal - v_item_subtotal / (1 + v_producto.alicuota_iva / 100), 2)
      ELSE 0 END;

    INSERT INTO venta_items (
      tenant_id, venta_id, producto_id, cantidad, precio_unitario, precio_costo_historico,
      subtotal, alicuota_iva, iva_monto, pedido_item_id
    ) VALUES (
      v_pedido.tenant_id, v_venta_id, v_item.producto_id, v_cant_entregar, v_precio,
      v_producto.precio_costo, v_item_subtotal, COALESCE(v_producto.alicuota_iva, 21), v_iva_monto, v_item.id
    ) RETURNING id INTO v_venta_item_id;

    v_subtotal := v_subtotal + v_item_subtotal;
    v_total := v_total + v_item_subtotal;

    v_desc_monto := 0; v_desc_pct := NULL; v_desc_pcts := 0;
    v_restante := v_cant_entregar;
    FOR v_linea IN
      SELECT il.id, il.cantidad, il.cantidad_reservada, il.ubicacion_id, il.lpn, il.estado_id
      FROM inventario_lineas il
      WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
        AND il.activo = true AND COALESCE(il.cantidad_reservada, 0) > 0
        AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
        AND (v_item.estado_id IS NULL OR il.estado_id = v_item.estado_id)
        AND (v_item.talle IS NULL OR il.talle = v_item.talle)
        AND (v_item.color IS NULL OR il.color = v_item.color)
        AND (v_item.encaje IS NULL OR il.encaje = v_item.encaje)
        AND (v_item.formato IS NULL OR il.formato = v_item.formato)
        AND (v_item.sabor_aroma IS NULL OR il.sabor_aroma = v_item.sabor_aroma)
      ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
      FOR UPDATE OF il SKIP LOCKED
    LOOP
      EXIT WHEN v_restante <= 0;
      v_tomar := LEAST(v_restante, v_linea.cantidad_reservada);
      IF v_tomar <= 0 THEN CONTINUE; END IF;

      SELECT ei.descuento_pct INTO v_pct_linea
      FROM estados_inventario ei WHERE ei.id = v_linea.estado_id;
      IF COALESCE(v_pct_linea, 0) > 0 THEN
        v_desc_monto := v_desc_monto + ROUND(v_precio * v_tomar * v_pct_linea / 100, 2);
        IF v_desc_pct IS NULL THEN
          v_desc_pct := v_pct_linea; v_desc_pcts := 1;
        ELSIF v_desc_pct <> v_pct_linea THEN
          v_desc_pcts := v_desc_pcts + 1;
        END IF;
      END IF;

      SELECT COALESCE(SUM(cantidad), 0) INTO v_stock_antes FROM inventario_lineas
        WHERE tenant_id = v_pedido.tenant_id AND producto_id = v_item.producto_id AND activo = true
          AND (v_pedido.sucursal_id IS NULL OR sucursal_id = v_pedido.sucursal_id);

      UPDATE inventario_lineas
        SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_tomar,
            activo = (cantidad - v_tomar) > 0
        WHERE id = v_linea.id;

      v_stock_despues := v_stock_antes - v_tomar;

      INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, venta_id, sucursal_id, linea_id)
      VALUES (v_pedido.tenant_id, v_item.producto_id, 'rebaje', v_tomar, v_stock_antes, v_stock_despues,
              'Pedido #' || v_pedido.numero, auth.uid(), v_venta_id, v_pedido.sucursal_id, v_linea.id);

      IF COALESCE(v_traza_on, true) THEN
        INSERT INTO venta_item_despachos (tenant_id, venta_id, venta_item_id, producto_id, linea_id, lpn, ubicacion_id, cantidad, origen)
        VALUES (v_pedido.tenant_id, v_venta_id, v_venta_item_id, v_item.producto_id, v_linea.id, v_linea.lpn, v_linea.ubicacion_id, v_tomar, 'auto');
      END IF;

      v_restante := v_restante - v_tomar;
    END LOOP;

    IF v_restante > 0 THEN
      RAISE EXCEPTION 'No hay stock reservado suficiente para entregar % (SKU %) — faltan % unidades. ¿Se lanzó el pedido?',
        v_producto.nombre, v_producto.sku, v_restante;
    END IF;

    IF v_desc_monto > 0 THEN
      v_item_subtotal := GREATEST(v_item_subtotal - v_desc_monto, 0);
      v_iva_monto := CASE WHEN COALESCE(v_producto.alicuota_iva, 0) > 0
        THEN ROUND(v_item_subtotal - v_item_subtotal / (1 + v_producto.alicuota_iva / 100), 2)
        ELSE 0 END;
      UPDATE venta_items
         SET subtotal = v_item_subtotal,
             iva_monto = v_iva_monto,
             descuento_estado_pct = CASE WHEN v_desc_pcts = 1 THEN v_desc_pct ELSE NULL END,
             descuento_estado_monto = v_desc_monto
       WHERE id = v_venta_item_id;
      v_subtotal := v_subtotal - v_desc_monto;
      v_total    := v_total    - v_desc_monto;
    END IF;

    UPDATE pedido_items SET
      cantidad_entregada = cantidad_entregada + v_cant_entregar,
      estado = CASE WHEN (cantidad_entregada + v_cant_entregar) >= cantidad THEN 'preparado' ELSE estado END
    WHERE id = v_item.id;

    v_hubo_entrega := true;
    IF (v_item.cantidad_entregada + v_cant_entregar) < v_item.cantidad THEN v_todo_entregado := false; END IF;
  END LOOP;

  IF NOT v_hubo_entrega THEN
    RAISE EXCEPTION 'No hay nada pendiente de entregar en este pedido';
  END IF;

  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      v_monto_pagado := v_monto_pagado + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      IF EXISTS (SELECT 1 FROM metodos_pago WHERE tenant_id = v_pedido.tenant_id AND nombre = (v_mp->>'tipo') AND es_efectivo = true) THEN
        v_monto_efectivo := v_monto_efectivo + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      END IF;
    ELSE
      v_monto_cc := v_monto_cc + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
    END IF;
  END LOOP;
  v_monto_pagado := LEAST(v_monto_pagado, v_total);
  v_monto_cc := LEAST(v_monto_cc, v_total);

  IF v_tiene_cc AND (v_total - v_monto_pagado) > 0.5 THEN
    -- Mig 442: política y límite EFECTIVOS (Cliente > Categoría > Negocio).
    SELECT e.cc_enforcement_politica INTO v_enforcement_pol FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id;
    IF v_enforcement_pol = 'bloquear' THEN
      SELECT COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0)), 0) INTO v_deuda_total
      FROM ventas v
      WHERE v.cliente_id = v_pedido.cliente_id AND v.tenant_id = v_pedido.tenant_id
        AND v.es_cuenta_corriente = true AND v.estado <> 'cancelada'
        AND (v.total - v.monto_pagado) > 0.5;

      SELECT e.cc_limite INTO v_limite_credito FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id;

      IF v_limite_credito IS NOT NULL AND (v_deuda_total + (v_total - v_monto_pagado)) > v_limite_credito + 0.5 THEN
        RAISE EXCEPTION 'Esta venta deja la cuenta corriente en $% — supera el límite de $%',
          ROUND(v_deuda_total + (v_total - v_monto_pagado), 0), ROUND(v_limite_credito, 0);
      END IF;
    END IF;
  END IF;

  -- D-1 fase 2 (mig 440): igual que el POS, si la venta lleva un producto con precio en dólares se
  -- sella la tasa con la que se convirtió (`ventas.cotizacion_usd`, mig 368). Dashboards y
  -- Rentabilidad separan por esa marca las ventas con componente en USD.
  UPDATE ventas SET subtotal = v_subtotal, total = v_total, monto_pagado = v_monto_pagado,
         cotizacion_usd = CASE WHEN EXISTS (
           SELECT 1 FROM venta_items vi JOIN productos pr ON pr.id = vi.producto_id
           WHERE vi.venta_id = v_venta_id AND pr.moneda_venta = 'usd' AND COALESCE(pr.precio_usd, 0) > 0
         ) THEN (SELECT c.venta FROM fn_cotizacion_bna_vigente('USD') c) END
   WHERE id = v_venta_id;

  IF v_monto_efectivo > 0.005 THEN
    INSERT INTO caja_movimientos (tenant_id, sesion_id, tipo, concepto, monto, usuario_id)
    VALUES (v_pedido.tenant_id, p_sesion_caja_id, 'ingreso', 'Pedido #' || v_pedido.numero, v_monto_efectivo, auth.uid());
  END IF;

  SELECT COALESCE(pedido_cierre_automatico, true) INTO v_cierre_auto FROM tenants WHERE id = v_pedido.tenant_id;
  IF v_todo_entregado AND v_cierre_auto THEN
    UPDATE pedidos SET estado = 'entregado', entregado_at = now() WHERE id = p_pedido_id;
  ELSE
    UPDATE pedidos SET estado = 'entregado_parcial' WHERE id = p_pedido_id;
  END IF;

  RETURN v_venta_id;
END;
$function$;
