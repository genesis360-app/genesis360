-- ============================================================
-- 315_pedidos_desde_ventas.sql
-- Pedido automático a partir de una VENTA, para los canales que el tenant elija.
--
-- Pedido de GO (2026-07-28):
--   · "Pedidos deben crearse desde la creación de ventas, sólo para ciertos canales."
--   · "Las reservas creadas en mod Ventas deben crearse como un pedido siempre y cuando estén
--      al 100% pagadas."
--   · Regla elegida por GO: **canal configurado**; y si la venta es una RESERVA, además
--     `monto_pagado >= total`. Una reserva de un canal NO configurado no genera nada.
--
-- 🛑 ESTO INVIERTE EL SENTIDO DEL FLUJO ORIGINAL (F4). Hasta hoy Pedidos era 100% separado de
-- Ventas y el único puente era Pedido → venta (`fn_pedido_generar_venta`, mig 295). Ahora existe
-- también Venta → Pedido. Los dos NO pueden convivir sobre el mismo documento:
--   · un pedido nacido de una venta YA TIENE su venta, su plata y su stock resueltos;
--   · entregarlo por el camino de PED4 generaría una SEGUNDA venta, un SEGUNDO rebaje de stock y
--     un SEGUNDO asiento de caja.
-- Por eso `pedidos.venta_origen_id` marca explícitamente a estos pedidos, y la mig 316 pone los
-- guards server-side que lo hacen imposible. Ver también el guard anti-loop de esta migración
-- (una venta nacida de un pedido nunca genera otro pedido).
--
-- Alcance de ESTA migración: columnas + config + resolución de canal + trigger de creación.
-- Los guards de Regla #0 y la entrega en mostrador van en la mig 316.
-- ============================================================

-- ── 1) Config del tenant: qué canales generan pedido ────────────────────────────────────
-- Array de UUIDs de `canales_venta` (no nombres: sobrevive a que renombren el canal).
-- Default '[]' = feature APAGADA. Ningún tenant existente cambia de comportamiento.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pedido_canales_auto jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN tenants.pedido_canales_auto IS
  'Canales de venta (array de canales_venta.id) cuyas ventas generan automáticamente un Pedido de preparación (mig 315). [] = apagado. Si la venta es una reserva, además exige monto_pagado >= total.';

-- ── 2) pedidos.venta_origen_id — el pedido que nace de una venta ────────────────────────
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS venta_origen_id uuid REFERENCES ventas(id) ON DELETE SET NULL;

COMMENT ON COLUMN pedidos.venta_origen_id IS
  '🛑 Venta que ORIGINÓ este pedido (mig 315). Si está seteado, el pedido YA tiene su venta: no debe generar otra (guard en fn_pedido_generar_venta) ni volver a reservar stock al lanzarlo (la venta ya lo comprometió). Es el sentido INVERSO de ventas.pedido_id, que marca la venta nacida DE un pedido (PED4).';

-- Una venta genera a lo sumo UN pedido (hace idempotente al trigger, incluso concurrente).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_venta_origen_unico
  ON pedidos (venta_origen_id) WHERE venta_origen_id IS NOT NULL;

-- ── 3) envios.tipo = 'retiro_local' ─────────────────────────────────────────────────────
-- Decisión de GO: Envíos es la tabla ÚNICA de trazabilidad de entregas, se retiren o se
-- despachen. `tipo` no tiene CHECK (hoy convive 'venta' y 'traslado_interno') y no se le agrega
-- uno acá para no romper valores existentes en PROD.
COMMENT ON COLUMN envios.tipo IS
  'venta | traslado_interno | retiro_local (mig 315: el cliente retira en el local; se crea igual para que Envíos sea la única tabla de trazabilidad de entregas).';

-- ── 4) Resolver el canal de una venta a partir de ventas.origen ─────────────────────────
-- ⚠ ESPEJO EXACTO de ORIGEN_ALIAS en `src/hooks/useCanalesVenta.ts`. Si se agrega un alias allá,
-- hay que agregarlo acá (mismo criterio que el resto de espejos JS↔SQL del repo). El POS escribe
-- en `ventas.origen` el NOMBRE del canal elegido, pero las integraciones escriben su propio slug.
CREATE OR REPLACE FUNCTION public.fn_canal_de_origen(p_tenant_id uuid, p_origen text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cv.id
  FROM canales_venta cv
  WHERE cv.tenant_id = p_tenant_id
    AND lower(cv.nombre) = lower(
      CASE lower(COALESCE(p_origen, ''))
        WHEN 'pos'           THEN 'Presencial'
        WHEN 'mercadolibre'  THEN 'MercadoLibre'
        WHEN 'meli'          THEN 'MercadoLibre'
        WHEN 'tiendanube'    THEN 'TiendaNube'
        WHEN 'whatsapp'      THEN 'WhatsApp'
        WHEN 'mp'            THEN 'MercadoPago'
        ELSE COALESCE(p_origen, '')
      END)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.fn_canal_de_origen(uuid, text) IS
  'Resuelve ventas.origen → canales_venta.id (mig 315). Espejo SQL de ORIGEN_ALIAS en src/hooks/useCanalesVenta.ts — mantener sincronizados.';

-- ── 5) Sync idempotente de las líneas del pedido desde la venta ─────────────────────────
-- Existe porque `registrarVenta` inserta la venta y sus `venta_items` en llamadas HTTP separadas:
-- cuando corre el AFTER INSERT de `ventas` todavía no hay una sola línea. Se llama desde los dos
-- lados (el trigger de ventas y el de venta_items) y es idempotente.
--
-- Solo toca pedidos en estado 'confirmado' (= todavía sin lanzar). Una vez lanzado hay tareas WMS
-- y stock comprometido colgando de esas líneas: reescribirlas por debajo sería exactamente el tipo
-- de cosa que rompe el inventario, así que a partir de ahí el pedido es inmutable para este camino.
CREATE OR REPLACE FUNCTION public.fn_pedido_sync_items_desde_venta(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido RECORD;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL OR v_pedido.venta_origen_id IS NULL THEN RETURN; END IF;
  IF v_pedido.estado <> 'confirmado' THEN RETURN; END IF;

  DELETE FROM pedido_items WHERE pedido_id = p_pedido_id;

  -- Se agrupa por producto: el carrito del POS puede traer el mismo SKU en varias líneas
  -- (precios/descuentos distintos), pero para PREPARAR el pedido lo que importa es el total de
  -- unidades a juntar de cada producto. El detalle comercial vive en la venta, no acá.
  INSERT INTO pedido_items (tenant_id, pedido_id, producto_id, cantidad, estado)
  SELECT v_pedido.tenant_id, p_pedido_id, vi.producto_id, SUM(vi.cantidad), 'pendiente'
  FROM venta_items vi
  WHERE vi.venta_id = v_pedido.venta_origen_id
    AND vi.producto_id IS NOT NULL
  GROUP BY vi.producto_id
  HAVING SUM(vi.cantidad) > 0;
END;
$$;

COMMENT ON FUNCTION public.fn_pedido_sync_items_desde_venta(uuid) IS
  'Copia las líneas de la venta al pedido que generó (mig 315), agrupadas por producto. Idempotente y solo mientras el pedido sigue en ''confirmado'' — después hay tareas WMS y stock comprometido colgando de esas líneas.';

-- ── 5-bis) El trigger: venta → pedido ───────────────────────────────────────────────────
-- SECURITY DEFINER a propósito: esto es comportamiento del SISTEMA, no una acción del usuario.
-- Corre igual desde el POS (usuario authenticated, quizás restringido a una sucursal), desde un
-- webhook de marketplace (service_role) o desde el importador. Todo se filtra explícitamente por
-- `NEW.tenant_id`, así que saltear la RLS no cruza datos de otro tenant.
CREATE OR REPLACE FUNCTION public.trg_venta_auto_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canal_id   uuid;
  v_canales    jsonb;
  v_tipo_id    uuid;
  v_pedido_id  uuid;
  v_total      numeric;
  v_pagado     numeric;
BEGIN
  -- 🛑 Guard anti-loop: una venta que NACIÓ de un pedido (PED4) jamás genera otro pedido.
  -- Sin esto, Pedido → venta → Pedido → … se realimenta solo.
  IF NEW.pedido_id IS NOT NULL THEN RETURN NULL; END IF;

  -- Solo ventas vivas. Una venta anulada/devuelta no tiene nada que preparar.
  IF NEW.estado NOT IN ('pendiente', 'reservada', 'despachada') THEN RETURN NULL; END IF;

  -- Idempotencia barata antes de tocar nada más (el UNIQUE index es la garantía real).
  IF EXISTS (SELECT 1 FROM pedidos WHERE venta_origen_id = NEW.id) THEN RETURN NULL; END IF;

  SELECT COALESCE(pedido_canales_auto, '[]'::jsonb) INTO v_canales
  FROM tenants WHERE id = NEW.tenant_id;
  IF v_canales IS NULL OR jsonb_array_length(v_canales) = 0 THEN RETURN NULL; END IF;

  v_canal_id := fn_canal_de_origen(NEW.tenant_id, NEW.origen);
  IF v_canal_id IS NULL THEN RETURN NULL; END IF;
  IF NOT (v_canales ? v_canal_id::text) THEN RETURN NULL; END IF;

  -- 💵 Regla de GO para las RESERVAS: solo si están 100% pagadas. `numeric` de PG puede llegar
  -- como NULL en ventas viejas → COALESCE. Se compara con >= y no con =: una seña de más
  -- (redondeo, propina, cobro duplicado) no puede dejar el pedido sin crear.
  IF NEW.estado = 'reservada' THEN
    v_total  := COALESCE(NEW.total, 0) + COALESCE(NEW.costo_envio, 0);
    v_pagado := COALESCE(NEW.monto_pagado, 0);
    IF v_total <= 0 OR v_pagado < v_total THEN RETURN NULL; END IF;
  END IF;

  -- Tipo de pedido: se prefiere "Retiro en local" (el caso que atiende el mostrador), y si el
  -- tenant lo borró/renombró se cae al primer tipo activo. tipos_pedido.tipo_pedido_id es NOT NULL.
  SELECT id INTO v_tipo_id FROM tipos_pedido
  WHERE tenant_id = NEW.tenant_id AND activo = true AND lower(nombre) = 'retiro en local'
  LIMIT 1;
  IF v_tipo_id IS NULL THEN
    SELECT id INTO v_tipo_id FROM tipos_pedido
    WHERE tenant_id = NEW.tenant_id AND activo = true
    ORDER BY orden NULLS LAST, nombre LIMIT 1;
  END IF;
  IF v_tipo_id IS NULL THEN RETURN NULL; END IF;  -- tenant sin tipos: no se inventa uno

  -- `requiere_envio` nace en false (= retiro en local) a propósito: el envío, cuando existe, lo
  -- crea VentasPage DESPUÉS del INSERT de la venta, así que acá todavía no se puede saber. El
  -- trigger de `envios` de más abajo lo corrige en cuanto aparece.
  INSERT INTO pedidos (
    tenant_id, sucursal_id, tipo_pedido_id, cliente_id, cliente_nombre, cliente_telefono,
    estado, requiere_envio, creado_por, confirmado_at, venta_origen_id, notas
  ) VALUES (
    NEW.tenant_id, NEW.sucursal_id, v_tipo_id, NEW.cliente_id,
    CASE WHEN NEW.cliente_id IS NULL THEN NEW.cliente_nombre END,
    CASE WHEN NEW.cliente_id IS NULL THEN NEW.cliente_telefono END,
    'confirmado', false, NEW.usuario_id, now(), NEW.id,
    'Generado automáticamente desde la venta #' || COALESCE(NEW.numero::text, '?')
  )
  ON CONFLICT (venta_origen_id) WHERE venta_origen_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_pedido_id;

  IF v_pedido_id IS NULL THEN RETURN NULL; END IF;  -- otra transacción ganó la carrera

  -- ⚠ En el camino AFTER INSERT esto normalmente copia CERO líneas, y está bien: `registrarVenta`
  -- inserta la venta y los `venta_items` en llamadas HTTP SEPARADAS, así que acá todavía no
  -- existen. El trigger de `venta_items` de más abajo completa el pedido cuando llegan.
  -- En el camino AFTER UPDATE (la reserva que se termina de pagar) los ítems ya están, y los copia
  -- de una. Por eso el sync es idempotente y sirve para los dos casos.
  PERFORM fn_pedido_sync_items_desde_venta(v_pedido_id);

  RETURN NULL;

-- 🛑 REGLA #0 — una VENTA nunca se cae por culpa de un documento de LOGÍSTICA.
-- El pedido es un derivado; la plata y el stock de la venta ya están decididos cuando esto corre.
-- Si algo acá falla (un tipo de pedido borrado a mitad de camino, un FK inesperado), abortar
-- dejaría al cajero sin poder cobrar. Se traga el error y se deja rastro en el log de Postgres
-- (visible con get_logs / el dashboard), en vez de bloquear el mostrador.
-- El pedido faltante se puede regenerar después; una venta perdida en el mostrador, no.
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_venta_auto_pedido] no se pudo crear el pedido de la venta % (tenant %): %',
    NEW.id, NEW.tenant_id, SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trg_venta_auto_pedido() IS
  'Crea el Pedido de preparación de una venta cuyo canal está en tenants.pedido_canales_auto (mig 315). Reservas: solo si monto_pagado >= total. Nunca para una venta nacida de un pedido (anti-loop).';

-- AFTER INSERT: la venta nace ya cumpliendo la condición (despachada, o reserva cobrada entera).
-- AFTER UPDATE OF estado, monto_pagado: la reserva que se termina de pagar DESPUÉS (seña primero,
-- saldo más tarde) recién ahí genera su pedido. Acotar el UPDATE a esas dos columnas evita que
-- cualquier otro update de la venta despierte el trigger.
DROP TRIGGER IF EXISTS trg_ventas_auto_pedido ON ventas;
CREATE TRIGGER trg_ventas_auto_pedido
  AFTER INSERT OR UPDATE OF estado, monto_pagado ON ventas
  FOR EACH ROW EXECUTE FUNCTION public.trg_venta_auto_pedido();

-- Las líneas de la venta llegan después que la cabecera (llamada HTTP aparte) → acá se completa
-- el pedido. STATEMENT-level con transition table: `registrarVenta` inserta todo el carrito en un
-- solo statement, así que esto corre UNA vez y no una por línea.
CREATE OR REPLACE FUNCTION public.trg_venta_items_sync_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id uuid;
BEGIN
  FOR v_pedido_id IN
    SELECT p.id FROM pedidos p
    WHERE p.venta_origen_id IN (SELECT DISTINCT venta_id FROM nuevas WHERE venta_id IS NOT NULL)
      AND p.estado = 'confirmado'
  LOOP
    PERFORM fn_pedido_sync_items_desde_venta(v_pedido_id);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Misma regla que arriba: la VENTA no se cae por un documento de logística.
  RAISE WARNING '[trg_venta_items_sync_pedido] no se pudieron sincronizar las líneas del pedido: %', SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trg_venta_items_sync_pedido() IS
  'Completa las líneas del Pedido cuando llegan los venta_items (mig 315) — la cabecera se crea en el INSERT de la venta, cuando todavía no hay líneas.';

DROP TRIGGER IF EXISTS trg_venta_items_auto_pedido ON venta_items;
CREATE TRIGGER trg_venta_items_auto_pedido
  AFTER INSERT ON venta_items
  REFERENCING NEW TABLE AS nuevas
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_venta_items_sync_pedido();

-- ── 6) El envío que aparece después marca el pedido como "con envío" ────────────────────
-- VentasPage inserta el envío tras crear la venta, así que el pedido ya existe cuando esto corre.
-- Con esto el pedido deja de ser "retiro en local" y desaparece de la pestaña del mostrador.
CREATE OR REPLACE FUNCTION public.trg_envio_marca_pedido_con_envio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.venta_id IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(NEW.tipo, 'venta') = 'retiro_local' THEN RETURN NULL; END IF;

  UPDATE pedidos p
     SET requiere_envio = true
   WHERE p.venta_origen_id = NEW.venta_id
     AND p.tenant_id = NEW.tenant_id
     AND p.requiere_envio = false
     AND p.estado NOT IN ('entregado', 'entregado_parcial', 'cancelado');

  UPDATE envios SET pedido_id = p.id
  FROM pedidos p
  WHERE envios.id = NEW.id AND envios.pedido_id IS NULL
    AND p.venta_origen_id = NEW.venta_id AND p.tenant_id = NEW.tenant_id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trg_envio_marca_pedido_con_envio() IS
  'Si aparece un envío real para una venta que ya generó pedido (mig 315), el pedido pasa a requiere_envio=true y se vincula envios.pedido_id — deja de ser "retiro en local" y sale de la pestaña del mostrador.';

DROP TRIGGER IF EXISTS trg_envios_marca_pedido ON envios;
CREATE TRIGGER trg_envios_marca_pedido
  AFTER INSERT ON envios
  FOR EACH ROW EXECUTE FUNCTION public.trg_envio_marca_pedido_con_envio();
