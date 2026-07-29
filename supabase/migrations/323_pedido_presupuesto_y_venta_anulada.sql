-- ============================================================
-- 323_pedido_presupuesto_y_venta_anulada.sql
-- 🐛 Dos huecos que encontró GO usando el flujo real: una venta recurrente generó un
-- **PRESUPUESTO**, el presupuesto generó un **PEDIDO**, y después el presupuesto se canceló —
-- dejando un pedido vivo que cualquiera podía lanzar, generando tareas de picking para preparar
-- mercadería de una venta que ya no existe.
--
-- 1) 🛑 **UN PRESUPUESTO NO GENERA PEDIDO.** Error de criterio de la mig 318: incluí `'pendiente'`
--    entre los estados que generan pedido razonando "la mercadería no salió, hay que prepararla".
--    Pero en esta app `ventas.estado = 'pendiente'` **ES UN PRESUPUESTO** — el ticket dice
--    literalmente "★ PRESUPUESTO ★". Un presupuesto no es un compromiso: el cliente no aceptó, no
--    pagó, y puede no convertirse nunca. Comprometer trabajo de depósito con eso está mal.
--    El pedido nace cuando el presupuesto **se convierte** en venta (reserva o despacho): el
--    trigger ya escucha `UPDATE OF estado`, así que se genera solo en ese momento.
--    Se agrega `'facturada'` a los estados vivos (una venta despachada que se facturó sigue viva y
--    puede necesitar preparación); la regla de entrega directa la sigue dejando afuera si aplica.
--
-- 2) 🛑 **ANULAR LA VENTA ANULA SU PEDIDO.** Faltaba por completo: cancelar o devolver la venta
--    dejaba el pedido en pie. Ahora se cancela solo, junto con sus tareas de picking pendientes.
--    ⚠ **NO se toca `cantidad_reservada`**: en un venta-pedido el picking NUNCA reserva (mig 316)
--    — la reserva es de la VENTA, y liberarla acá sería liberarla dos veces cuando la venta haga su
--    propia anulación. Por eso las tareas se cancelan con un UPDATE directo y no con
--    `fn_cancelar_tarea_wms`, que sí libera reservas (correcto para un pedido de logística,
--    incorrecto acá).
--
-- 3) Guard extra: no se puede **LANZAR** un pedido cuya venta ya no está viva (o sigue siendo un
--    presupuesto). Se engancha al dispatcher en la mig 324.
--
-- Limpieza incluida: los pedidos que ya habían quedado mal se cancelan (menos los entregados, que
-- son historia y no se reescriben). Al aplicar en DEV había 1.
-- ============================================================

-- ── 1) La regla, sin presupuestos ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venta_requiere_pedido(p_venta_id uuid, p_con_envio boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_venta RECORD; v_canal_id uuid; v_clasif text; v_excluidos jsonb;
BEGIN
  SELECT * INTO v_venta FROM ventas WHERE id = p_venta_id;
  IF v_venta IS NULL THEN RETURN false; END IF;
  IF v_venta.pedido_id IS NOT NULL THEN RETURN false; END IF;

  -- 'pendiente' = PRESUPUESTO: no hay compromiso todavía, no se prepara nada.
  -- Cuando se convierta (reservada/despachada) el trigger de UPDATE genera el pedido.
  IF v_venta.estado NOT IN ('reservada', 'despachada', 'facturada') THEN RETURN false; END IF;

  v_canal_id := fn_canal_de_origen(v_venta.tenant_id, v_venta.origen);
  SELECT COALESCE(pedido_canales_excluidos, '[]'::jsonb) INTO v_excluidos
  FROM tenants WHERE id = v_venta.tenant_id;
  IF v_canal_id IS NOT NULL AND v_excluidos ? v_canal_id::text THEN RETURN false; END IF;

  IF p_con_envio OR EXISTS (SELECT 1 FROM envios WHERE venta_id = p_venta_id) THEN RETURN true; END IF;
  IF v_venta.estado = 'reservada' THEN RETURN true; END IF;

  SELECT clasificacion INTO v_clasif FROM canales_venta WHERE id = v_canal_id;
  RETURN COALESCE(v_clasif, 'presencial') = 'online';
END; $$;
COMMENT ON FUNCTION public.fn_venta_requiere_pedido(uuid, boolean) IS
  'Regla única (migs 318/323): toda venta VIVA genera Pedido MENOS la entrega directa. Un PRESUPUESTO (estado pendiente) NO genera: no hay compromiso todavía — el pedido nace cuando se convierte en venta.';

-- ── 2) La venta anulada cancela su pedido ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_venta_anulada_cancela_pedido()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pedido RECORD;
BEGIN
  IF NEW.estado NOT IN ('cancelada', 'devuelta') THEN RETURN NULL; END IF;
  IF OLD.estado = NEW.estado THEN RETURN NULL; END IF;

  SELECT * INTO v_pedido FROM pedidos WHERE venta_origen_id = NEW.id FOR UPDATE;
  IF v_pedido IS NULL THEN RETURN NULL; END IF;

  -- Un pedido ya ENTREGADO no se toca: la mercadería salió físicamente y eso es historia. Que la
  -- venta se devuelva después es el flujo de Devolución, que reingresa el stock por su lado.
  IF v_pedido.estado IN ('entregado', 'entregado_parcial', 'cancelado') THEN RETURN NULL; END IF;

  -- Tareas de picking pendientes: se cancelan con UPDATE directo A PROPÓSITO.
  -- `fn_cancelar_tarea_wms` libera `cantidad_reservada`, que es lo correcto para un pedido de
  -- logística — pero en un venta-pedido el picking nunca reservó (mig 316): la reserva es de la
  -- VENTA. Liberarla acá la liberaría DOS veces cuando la venta haga su propia anulación.
  UPDATE wms_tareas SET estado = 'cancelada'
   WHERE pedido_id = v_pedido.id AND estado IN ('pendiente', 'en_curso');

  UPDATE pedidos
     SET estado = 'cancelado', cancelado_at = now(),
         notas = COALESCE(notas || ' · ', '') || 'Cancelado automáticamente: la venta #'
                 || COALESCE(NEW.numero::text, '?') || ' se ' || NEW.estado
   WHERE id = v_pedido.id;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Igual que el resto: una operación de VENTA no se cae por un documento de logística.
  RAISE WARNING '[trg_venta_anulada_cancela_pedido] venta % : %', NEW.id, SQLERRM;
  RETURN NULL;
END; $$;
COMMENT ON FUNCTION public.trg_venta_anulada_cancela_pedido() IS
  'Anular o devolver una venta cancela su Pedido y sus tareas de picking pendientes (mig 323). Sin esto quedaba un pedido vivo que el depósito podía preparar para una venta que ya no existe. NO toca cantidad_reservada: en un venta-pedido la reserva es de la venta.';

DROP TRIGGER IF EXISTS trg_ventas_anulada_cancela_pedido ON ventas;
CREATE TRIGGER trg_ventas_anulada_cancela_pedido
  AFTER UPDATE OF estado ON ventas
  FOR EACH ROW EXECUTE FUNCTION public.trg_venta_anulada_cancela_pedido();

-- ── 3) Guard de lanzamiento (se engancha en la mig 324) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_venta_viva(p_pedido_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_estado text; v_num integer;
BEGIN
  SELECT v.estado, v.numero INTO v_estado, v_num
  FROM pedidos p JOIN ventas v ON v.id = p.venta_origen_id
  WHERE p.id = p_pedido_id;
  IF v_estado IS NULL THEN RETURN; END IF;   -- pedido de logística puro: no aplica
  IF v_estado IN ('cancelada', 'devuelta') THEN
    RAISE EXCEPTION 'La venta #% de este pedido está %: no se puede preparar mercadería para una venta que ya no existe.', v_num, v_estado;
  END IF;
  IF v_estado = 'pendiente' THEN
    RAISE EXCEPTION 'La venta #% todavía es un PRESUPUESTO: confirmala (reserva o despacho) antes de mandar a preparar la mercadería.', v_num;
  END IF;
END; $$;
COMMENT ON FUNCTION public.fn_pedido_venta_viva(uuid) IS
  'Frena el lanzamiento de un pedido cuya venta está anulada, devuelta o todavía es un presupuesto (mig 323).';

REVOKE ALL ON FUNCTION fn_pedido_venta_viva(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_venta_viva(uuid) TO authenticated, service_role;

-- ── 4) Limpieza de lo que ya quedó mal ──────────────────────────────────────────────────
-- Solo los que NO están entregados: lo entregado es historia y no se reescribe.
WITH afectados AS (
  SELECT p.id, v.numero, v.estado AS estado_venta
  FROM pedidos p JOIN ventas v ON v.id = p.venta_origen_id
  WHERE p.estado NOT IN ('entregado', 'entregado_parcial', 'cancelado')
    AND v.estado IN ('cancelada', 'devuelta', 'pendiente')
)
UPDATE wms_tareas w SET estado = 'cancelada'
FROM afectados a
WHERE w.pedido_id = a.id AND w.estado IN ('pendiente', 'en_curso');

WITH afectados AS (
  SELECT p.id, v.numero, v.estado AS estado_venta
  FROM pedidos p JOIN ventas v ON v.id = p.venta_origen_id
  WHERE p.estado NOT IN ('entregado', 'entregado_parcial', 'cancelado')
    AND v.estado IN ('cancelada', 'devuelta', 'pendiente')
)
UPDATE pedidos p
   SET estado = 'cancelado', cancelado_at = now(),
       notas = COALESCE(p.notas || ' · ', '') || 'Cancelado por la mig 323: la venta #'
               || COALESCE(a.numero::text, '?') || ' está ' || a.estado_venta
FROM afectados a
WHERE p.id = a.id;
