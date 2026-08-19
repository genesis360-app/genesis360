-- Migration 373: Fase 5 (Bóveda ARS/USD) del plan "Caja en USD" (relevamiento G5).
-- Continúa la Fase 4 (mig 372, pago combinado). Ver G360.Wiki/wiki/development/reglas-negocio.md
-- (tabla de decisiones F2/F3) y el Artifact de la sesión (plan de 8 fases).
--
-- F2: sembrar cuenta "Efectivo USD" en cuentas_origen (para TODO tenant, igual que "Efectivo") +
--     una 2da fila `cajas.es_caja_fuerte=true, moneda='USD'` ("Caja Fuerte USD") — hasta ahora el
--     código entero asumía una única fila es_caja_fuerte=true por tenant (`.find`/`.single()` sin
--     filtrar moneda). F3: retiro de Caja USD sin destino requiere clave maestra (código, no DB).

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) fn_seed_tenant_defaults — agrega "Efectivo USD" a la siembra de un tenant nuevo, junto a
--    "Efectivo" (ARS). CREATE OR REPLACE completo (no se puede alterar solo una parte del body).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_seed_tenant_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sucursal_id UUID;
  v_efectivo_cuenta_id UUID;
BEGIN
  v_sucursal_id := gen_random_uuid();

  INSERT INTO sucursales (id, tenant_id, nombre, activo)
  VALUES (v_sucursal_id, NEW.id, 'Sucursal 1', true);

  INSERT INTO cajas (tenant_id, nombre, sucursal_id)
  VALUES (NEW.id, 'Caja Principal', v_sucursal_id);

  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    (NEW.id, 'Compra a proveedor',     'ingreso', true),
    (NEW.id, 'Ingreso inicial',         'ingreso', true),
    (NEW.id, 'Devolución de cliente',   'ingreso', true),
    (NEW.id, 'Venta',                   'rebaje', true),
    (NEW.id, 'Merma / Rotura',          'rebaje', true),
    (NEW.id, 'Consumo interno',         'rebaje', true),
    (NEW.id, 'Vencimiento',             'rebaje', true),
    (NEW.id, 'Ingreso de efectivo',     'caja',   true),
    (NEW.id, 'Extracción / Retiro',     'caja',   true),
    (NEW.id, 'Gastos varios',           'caja',   true),
    (NEW.id, 'Ajuste de inventario',    'ambos',  true);

  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  -- 🧹 mig 327: solo nombres de EMPAQUE real (Unidad = base sin envase, Caja, Pallet). Kilogramo/
  -- Gramo/Litro/Metro eran unidades FÍSICAS coladas acá antes del rediseño (mig 148) — hoy viven
  -- en unidades_medida_fisicas (mig 303, seed paralelo trg_seed_umf_new_tenant).
  INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida) VALUES
    (NEW.id, 'Unidad',     'u',      true, true),
    (NEW.id, 'Caja',       'caja',   true, true),
    (NEW.id, 'Pallet',     'pallet', true, true)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo', 'efectivo', COALESCE(NEW.moneda, 'ARS'), true)
  RETURNING id INTO v_efectivo_cuenta_id;

  -- G5 Fase 5 (F2) — "Efectivo USD" se siembra SIEMPRE, igual que "Efectivo", sin importar si el
  -- tenant termina usando Caja USD. Es la cuenta donde la Bóveda recibe dólares directo (K1: hoy
  -- los tenants ya cobran en USD "a mano" y lo llevan a la caja fuerte). Dormida en $0 no cuesta
  -- nada y evita un 2do seed condicional más adelante.
  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo USD', 'efectivo', 'USD', true)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  INSERT INTO metodos_pago (tenant_id, nombre, color, orden, activo, es_sistema, cuenta_origen_id, es_efectivo, moneda) VALUES
    (NEW.id, 'Efectivo',           '#22c55e', 1, true, true, v_efectivo_cuenta_id, true,  COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Mercado Pago',       '#06b6d4', 2, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Tarjeta de débito',  '#eab308', 3, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Transferencia',      '#8b5cf6', 4, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Tarjeta de crédito', '#f97316', 5, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS'))
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) fn_crear_caja_fuerte — agrega la 2da fila "Caja Fuerte USD" a la siembra de un tenant nuevo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_crear_caja_fuerte()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte, activo, moneda)
  VALUES (NEW.id, 'Caja Fuerte / Bóveda', true, true, 'ARS')
  ON CONFLICT DO NOTHING;
  -- G5 Fase 5 (F2) — misma razón que "Efectivo USD" arriba: existe siempre, dormida, para que la
  -- Bóveda tenga dónde acreditar dólares en cuanto haga falta sin un paso de alta manual.
  INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte, activo, moneda)
  VALUES (NEW.id, 'Caja Fuerte USD', true, true, 'USD')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2.5) uq_cuentas_origen_efectivo_por_tenant (mig 137) garantizaba 1 sola cuenta tipo='efectivo'
--      POR TENANT — bloquea directamente la 2da cuenta "Efectivo USD" que este archivo necesita
--      sembrar. La intención original (mig 137: evitar ambigüedad en el fallback de
--      vw_boveda_cuentas y en el backfill histórico de esa misma migración) sigue vigente, solo
--      que ahora la unidad de "1 sola cuenta efectivo" pasa a ser por MONEDA, no por tenant — el
--      punto 4 de abajo (vw_boveda_cuentas) ya está actualizado para desambiguar por moneda.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS uq_cuentas_origen_efectivo_por_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuentas_origen_efectivo_por_tenant_moneda
  ON cuentas_origen(tenant_id, moneda)
  WHERE tipo = 'efectivo';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) Backfill para tenants existentes — mismo criterio que la siembra de arriba, WHERE NOT EXISTS
--    (idempotente; `cajas` no tiene ninguna constraint UNIQUE que el ON CONFLICT del trigger de
--    fn_crear_caja_fuerte pueda usar — `cuentas_origen` sí tiene UNIQUE(tenant_id,nombre) pero el
--    backfill igual usa WHERE NOT EXISTS por consistencia con el otro INSERT de este bloque).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
SELECT t.id, 'Efectivo USD', 'efectivo', 'USD', true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM cuentas_origen co WHERE co.tenant_id = t.id AND co.nombre = 'Efectivo USD'
);

INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte, moneda)
SELECT t.id, 'Caja Fuerte USD', true, 'USD'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM cajas c WHERE c.tenant_id = t.id AND c.es_caja_fuerte = true AND c.moneda = 'USD'
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) vw_boveda_cuentas — con 2 cuentas tipo='efectivo' por tenant (ARS y USD) desde ahora, el
--    fallback que atribuye un caja_movimientos.cuenta_origen_id NULL a "la cuenta efectivo" dejó
--    de ser único: hay que cruzar también por moneda (caja_movimientos.moneda, mig 368) o un
--    movimiento en USD sin cuenta explícita podía cachearse en la cuenta Efectivo ARS (o
--    viceversa) según el orden no determinístico de un LIMIT 1 sin ORDER BY.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.vw_boveda_cuentas AS
 SELECT co.tenant_id,
    co.id AS cuenta_origen_id,
    co.nombre,
    co.tipo,
    co.banco,
    co.moneda,
    co.activo,
    (COALESCE(sum(
        CASE
            WHEN (cm.tipo ~~ 'ingreso%'::text) THEN cm.monto
            WHEN (cm.tipo ~~ 'egreso%'::text) THEN (- cm.monto)
            ELSE (0)::numeric
        END), (0)::numeric))::numeric(14,2) AS saldo,
    count(cm.id) AS movimientos_count,
    max(cm.created_at) AS ultimo_movimiento_at
   FROM (cuentas_origen co
     LEFT JOIN caja_movimientos cm ON (((cm.tenant_id = co.tenant_id) AND (COALESCE(cm.cuenta_origen_id,
        CASE
            WHEN (cm.tipo !~~ '%informativo%'::text) THEN ( SELECT e.id
               FROM cuentas_origen e
              WHERE ((e.tenant_id = cm.tenant_id) AND (e.tipo = 'efectivo'::text) AND (e.moneda = COALESCE(cm.moneda, 'ARS')))
             LIMIT 1)
            ELSE NULL::uuid
        END) = co.id))))
  GROUP BY co.id, co.tenant_id, co.nombre, co.tipo, co.banco, co.moneda, co.activo;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) Nuevo trigger — defensa en profundidad complementaria a fn_validar_moneda_coincide_sesion
--    (mig 372, que valida movimiento vs. sesión). Este valida movimiento vs. CUENTA DE ORIGEN:
--    sin esto, sería posible insertar un caja_movimientos con moneda='USD' (sesión USD, pasa el
--    trigger de mig 372) pero cuenta_origen_id apuntando a "Efectivo" (ARS) — vw_boveda_cuentas
--    sumaría dólares dentro del saldo en pesos, mostrado con el símbolo equivocado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_validar_moneda_coincide_cuenta_origen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_moneda_cuenta text;
BEGIN
  IF NEW.cuenta_origen_id IS NOT NULL THEN
    SELECT moneda INTO v_moneda_cuenta FROM cuentas_origen WHERE id = NEW.cuenta_origen_id;
    IF v_moneda_cuenta IS NOT NULL AND COALESCE(NEW.moneda, 'ARS') IS DISTINCT FROM v_moneda_cuenta THEN
      RAISE EXCEPTION 'La moneda del movimiento (%) no coincide con la moneda de la cuenta de origen (%)', COALESCE(NEW.moneda, 'ARS'), v_moneda_cuenta;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_moneda_cuenta_origen ON caja_movimientos;
CREATE TRIGGER trg_validar_moneda_cuenta_origen
  BEFORE INSERT OR UPDATE OF moneda, cuenta_origen_id ON caja_movimientos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_moneda_coincide_cuenta_origen();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6) boveda_conversiones_usd — auditoría de la conversión USD↔$ (F2: único punto de conversión
--    de todo el sistema, solo DUEÑO). No reemplaza los 2 caja_movimientos (egreso en la moneda de
--    origen + ingreso en la de destino, mismo patrón que un traspaso) — los complementa dejando
--    registrada la cotización efectivamente usada, para que el capital total nunca "de dónde
--    salió esa plata" sin rastro.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.boveda_conversiones_usd (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sentido text NOT NULL,
  monto_origen numeric(14,2) NOT NULL,
  monto_destino numeric(14,2) NOT NULL,
  cotizacion_usada numeric(14,4) NOT NULL,
  usuario_id uuid NOT NULL REFERENCES users(id),
  movimiento_origen_id uuid REFERENCES caja_movimientos(id) ON DELETE SET NULL,
  movimiento_destino_id uuid REFERENCES caja_movimientos(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT boveda_conversiones_usd_pkey PRIMARY KEY (id),
  CONSTRAINT boveda_conversiones_usd_sentido_check CHECK (sentido = ANY (ARRAY['usd_a_ars'::text, 'ars_a_usd'::text])),
  CONSTRAINT boveda_conversiones_usd_monto_origen_check CHECK (monto_origen > 0),
  CONSTRAINT boveda_conversiones_usd_monto_destino_check CHECK (monto_destino > 0),
  CONSTRAINT boveda_conversiones_usd_cotizacion_check CHECK (cotizacion_usada > 0)
);

CREATE INDEX IF NOT EXISTS idx_boveda_conversiones_usd_tenant ON public.boveda_conversiones_usd USING btree (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boveda_conversiones_usd_usuario ON public.boveda_conversiones_usd USING btree (usuario_id);
CREATE INDEX IF NOT EXISTS idx_boveda_conversiones_usd_mov_origen ON public.boveda_conversiones_usd USING btree (movimiento_origen_id);
CREATE INDEX IF NOT EXISTS idx_boveda_conversiones_usd_mov_destino ON public.boveda_conversiones_usd USING btree (movimiento_destino_id);

ALTER TABLE public.boveda_conversiones_usd ENABLE ROW LEVEL SECURITY;

-- Mismo universo de roles que boveda_retiros (DUEÑO/ADMIN/SUPER_USUARIO) a nivel DB — ADMIN y
-- SUPER_USUARIO son roles de plataforma con acceso de soporte a toda la Bóveda, igual que en el
-- resto del módulo. La restricción "solo DUEÑO" de F2 es una regla de producto (el botón de
-- convertir en CajaPage.tsx solo se muestra al DUEÑO), no una restricción de aislamiento de datos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'boveda_conversiones_usd' AND policyname = 'boveda_conversiones_usd_solo_dueno'
  ) THEN
    CREATE POLICY boveda_conversiones_usd_solo_dueno ON public.boveda_conversiones_usd AS PERMISSIVE FOR ALL TO authenticated
      USING (((tenant_id IN ( SELECT users.tenant_id
       FROM users
      WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
       FROM users
      WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))))
      WITH CHECK (((tenant_id IN ( SELECT users.tenant_id
       FROM users
      WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
       FROM users
      WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))));
  END IF;
END $$;

-- REVOKE explícito de anon (no heredar el default-privileges de PUBLIC en tablas nuevas) — ver
-- reference_revoke_public_no_anon: los default-privileges le dan acceso a anon salvo que se
-- revoque a mano. RLS ya lo bloquearía igual (auth.uid() es NULL para anon), pero explícito > implícito.
REVOKE ALL ON public.boveda_conversiones_usd FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boveda_conversiones_usd TO authenticated;
GRANT ALL ON public.boveda_conversiones_usd TO service_role;
