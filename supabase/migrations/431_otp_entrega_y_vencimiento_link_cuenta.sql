-- 431 — OTP de entrega con fuente criptográfica + límite de intentos, y vencimiento del link
--       público de estado de cuenta del cliente.
--
-- Segunda tanda de la auditoría de seguridad del 2026-09-20 (la primera fue la mig 430).
--
-- ── 1 · OTP de entrega (`envio_otp`) ──────────────────────────────────────────────────────
-- Antes:
--   · el código salía de `random()` de Postgres, que NO es criptográfico: es un PRNG
--     determinístico sembrado por sesión, o sea predecible por alguien que observe
--     suficientes salidas.
--   · `verificar_otp_envio` tiene GRANT a `anon` y no contaba intentos: 1.000.000 de
--     combinaciones de 6 dígitos son fuerza-brutables sin ningún freno.
--   · cualquier OTP no verificado de las últimas 24 h seguía siendo válido, así que pedir
--     un código nuevo AMPLIABA la cantidad de códigos que abrían la puerta.
-- Ahora:
--   · el código sale de `extensions.gen_random_bytes` (pgcrypto vive en el schema
--     `extensions`, por eso va calificado: estas funciones tienen `search_path = public`).
--   · máximo 5 intentos por código; al sexto se bloquea aunque el código sea correcto.
--   · pedir un código nuevo INVALIDA explícitamente los anteriores (`invalidado_at`), así
--     siempre hay exactamente uno activo por envío.
--
-- Sobre `invalidado_at`: la primera versión no lo tenía y elegía "el OTP más reciente" por
-- `enviado_at DESC`. La prueba en DEV lo tiró abajo: dos OTP creados dentro de la misma
-- transacción comparten `enviado_at` (NOW() es el arranque de la transacción, no el reloj),
-- el desempate queda indefinido y pedir un código nuevo NO desbloqueaba. En producción los
-- dos INSERT caen en transacciones distintas y no se notaría, pero es una fragilidad real
-- esperando a que dos pedidos caigan en el mismo tick. Invalidar explícitamente la elimina.
-- El impacto de este OTP es marcar un envío como POD-verificado (no mueve plata ni stock),
-- pero es el único control que separa "entregado de verdad" de "alguien dijo que sí".

ALTER TABLE public.envio_otp ADD COLUMN IF NOT EXISTS intentos integer NOT NULL DEFAULT 0;
ALTER TABLE public.envio_otp ADD COLUMN IF NOT EXISTS invalidado_at timestamptz;

CREATE OR REPLACE FUNCTION public.generar_otp_envio(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID; v_tenant UUID; v_tel TEXT; v_cod TEXT; BEGIN
  SELECT e.id, e.tenant_id, cl.telefono INTO v_id, v_tenant, v_tel
  FROM envios e
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  WHERE e.token_transportista = p_token;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  -- Un solo codigo activo por envio: pedir uno nuevo invalida los anteriores. Ademas de ser
  -- mas claro, es lo que desbloquea a alguien que agoto los 5 intentos.
  UPDATE envio_otp SET invalidado_at = NOW()
   WHERE envio_id = v_id AND verificado_at IS NULL AND invalidado_at IS NULL;

  -- 4 bytes criptográficos -> entero -> 6 dígitos. `abs` sobre bigint para que el signo del
  -- int4 no rompa el módulo, y no hay overflow porque |int4| entra holgado en bigint.
  v_cod := lpad(
    mod(abs(('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::int::bigint), 1000000)::text,
    6, '0');

  INSERT INTO envio_otp(tenant_id, envio_id, codigo, telefono, enviado_at)
    VALUES (v_tenant, v_id, v_cod, v_tel, NOW());
  UPDATE envios SET pod_otp_verificado = false WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'codigo', v_cod, 'telefono', v_tel);
END;$function$;

CREATE OR REPLACE FUNCTION public.verificar_otp_envio(p_token text, p_codigo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_otp_id   UUID;
  v_codigo   TEXT;
  v_intentos INTEGER;
BEGIN
  -- El único OTP activo del envío (los anteriores los invalida `generar_otp_envio`).
  -- `FOR UPDATE` para que dos intentos en paralelo no se pisen el contador: sin eso, el
  -- límite de 5 se saltea mandando los pedidos de a muchos al mismo tiempo.
  SELECT o.id, o.codigo, o.intentos
    INTO v_otp_id, v_codigo, v_intentos
  FROM envio_otp o
  JOIN envios e ON e.id = o.envio_id
  WHERE e.token_transportista = p_token
    AND o.verificado_at IS NULL
    AND o.invalidado_at IS NULL
    AND o.enviado_at > NOW() - INTERVAL '24 hours'
  ORDER BY o.enviado_at DESC, o.id DESC
  LIMIT 1
  FOR UPDATE OF o;

  IF v_otp_id IS NULL THEN RETURN false; END IF;

  -- Bloqueado: ni siquiera se compara. Para desbloquear hay que pedir un código nuevo.
  IF v_intentos >= 5 THEN RETURN false; END IF;

  UPDATE envio_otp SET intentos = intentos + 1 WHERE id = v_otp_id;

  IF v_codigo IS DISTINCT FROM p_codigo THEN RETURN false; END IF;

  UPDATE envio_otp SET verificado_at = NOW() WHERE id = v_otp_id;
  UPDATE envios SET pod_otp_verificado = true WHERE token_transportista = p_token;
  RETURN true;
END;$function$;

-- ── 2 · Vencimiento del link público de estado de cuenta ──────────────────────────────────
-- `clientes.cuenta_token` es un `crypto.randomUUID()` sólido, pero a diferencia de
-- `token_transportista` (que ya tiene política de expiración + limpieza a 30 días, migs
-- 129/143/191) NO vencía NUNCA y no se podía rotar desde la app. Un link reenviado por
-- WhatsApp quedaba vivo para siempre, y del otro lado `get_cuenta_cliente_by_token` —que es
-- SECURITY DEFINER y tiene GRANT a `anon`— devuelve nombre, teléfono, email y el detalle
-- completo de la cuenta corriente.
--
-- Default 90 días, configurable por negocio. 0 = sin vencimiento (para el que lo prefiera así).
-- Los tokens que ya existen se fechan HOY, no en el pasado: la idea es poner el reloj en hora,
-- no romperle el link a un cliente que lo está usando ahora mismo.

ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cuenta_token_creado_at timestamptz;
ALTER TABLE public.tenants  ADD COLUMN IF NOT EXISTS cuenta_token_dias integer NOT NULL DEFAULT 90;

UPDATE public.clientes
   SET cuenta_token_creado_at = NOW()
 WHERE cuenta_token IS NOT NULL AND cuenta_token_creado_at IS NULL;

-- El fechado NO puede depender de que el front se acuerde de escribir las dos columnas juntas.
-- Si un token nuevo quedara con `cuenta_token_creado_at` en NULL, el chequeo de vencimiento
-- (que exige IS NOT NULL) no se cumpliría nunca y el link volvería a ser eterno — es decir, el
-- bug original intacto y en silencio, justo para los links nuevos. Con el trigger, cualquier
-- lugar que toque `cuenta_token` —hoy o mañana— queda cubierto.
CREATE OR REPLACE FUNCTION public.trg_clientes_cuenta_token_fechado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cuenta_token IS DISTINCT FROM OLD.cuenta_token AND NEW.cuenta_token IS NOT NULL THEN
    NEW.cuenta_token_creado_at := NOW();
  END IF;
  RETURN NEW;
END;$function$;

DROP TRIGGER IF EXISTS clientes_cuenta_token_fechado ON public.clientes;
CREATE TRIGGER clientes_cuenta_token_fechado
  BEFORE UPDATE OF cuenta_token ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.trg_clientes_cuenta_token_fechado();

CREATE OR REPLACE FUNCTION public.get_cuenta_cliente_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cli RECORD; v_ventas JSONB; BEGIN
  SELECT c.id, c.nombre, c.telefono, c.email, c.tenant_id,
         c.cuenta_token_creado_at,
         t.nombre AS tenant_nombre, t.moneda,
         COALESCE(t.cuenta_token_dias, 90) AS token_dias
  INTO v_cli
  FROM clientes c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.cuenta_token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Vencido: se responde igual que un token inexistente, a propósito — no confirmarle a quien
  -- prueba un link viejo que ese token alguna vez existió.
  IF v_cli.token_dias > 0
     AND v_cli.cuenta_token_creado_at IS NOT NULL
     AND v_cli.cuenta_token_creado_at < NOW() - (v_cli.token_dias || ' days')::interval THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'numero',      v.numero,
    'fecha',       v.created_at::date,
    'total',       v.total,
    'pagado',      v.monto_pagado,
    'saldo',       GREATEST(v.total - v.monto_pagado, 0),
    'interes',     v.interes_cc,
    'vencimiento', v.fecha_vencimiento_cc
  ) ORDER BY v.created_at)
  INTO v_ventas
  FROM ventas v
  WHERE v.cliente_id = v_cli.id
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND (v.total - v.monto_pagado) > 0.5;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('nombre', v_cli.nombre, 'telefono', v_cli.telefono, 'email', v_cli.email),
    'negocio', v_cli.tenant_nombre,
    'moneda',  COALESCE(v_cli.moneda, 'ARS'),
    'ventas',  COALESCE(v_ventas, '[]'::jsonb)
  );
END;$function$;
