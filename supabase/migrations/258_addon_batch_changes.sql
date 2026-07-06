-- 258: Configurador de add-ons BATCH con cobro por delta (diseño: wiki/features/
-- configurador-addons-batch.md, decisión GO 2026-07-05). Aditiva.
--
--   • addon_batch_changes: un cambio de plan/add-ons PENDIENTE de pago por tenant. El EF
--     mp-addon-batch lo crea con el estado FINAL deseado de packs (packs_objetivo); si el
--     batch SUBE el recurrente, el cliente paga el delta como pago único (checkout MP) y el
--     webhook lo aplica al confirmar el pago (fail-closed: sin pago no cambia nada).
--   • fn_aplicar_addon_batch: aplica el batch de forma ATÓMICA (sync de tenant_addons +
--     marca aplicado) — el EF nunca sincroniza en dos pasos.
--   • uq parcial en tenant_addons: UN pack FIJO por dimensión (el batch reemplaza, no acumula
--     — decisión GO Q4). Los temporales siguen acumulándose.
--   • tenant_addons.dimension: se agrega 'comprobantes' (pricing v2 — reemplaza a movimientos
--     como dimensión de flujo; las filas históricas de movimientos no se tocan).

-- 1) Dimensión nueva en tenant_addons
ALTER TABLE public.tenant_addons DROP CONSTRAINT IF EXISTS tenant_addons_dimension_check;
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_dimension_check
  CHECK (dimension IN ('sku','movimientos','comprobantes','sucursales','usuarios'));

-- 2) Un pack FIJO por dimensión (hoy no hay filas fijas → sin conflicto al crear)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_addons_fijo_dim
  ON public.tenant_addons(tenant_id, dimension) WHERE tipo = 'fijo';

-- 3) Batches
CREATE TABLE IF NOT EXISTS public.addon_batch_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  estado         TEXT NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado IN ('pendiente_pago','aplicado','cancelado','fallido')),
  -- Estado FINAL deseado de packs fijos: [{"dimension":"sku","cantidad":500}, ...].
  -- El precio NUNCA viaja acá: el EF/webhook lo recalcula del catálogo server-side.
  packs_objetivo JSONB NOT NULL,
  monto_delta            NUMERIC(12,2) NOT NULL, -- lo que paga hoy (0 = baja/neutro)
  monto_recurrente_nuevo NUMERIC(12,2) NOT NULL,
  mp_preference_id TEXT,
  mp_payment_id    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at     TIMESTAMPTZ,
  error_detalle  TEXT
);
-- Un solo batch pendiente por tenant (lock natural → sin dobles cobros por concurrencia)
CREATE UNIQUE INDEX IF NOT EXISTS uq_addon_batch_pendiente
  ON public.addon_batch_changes(tenant_id) WHERE estado = 'pendiente_pago';
-- Idempotencia del webhook (reintentos de MP no aplican dos veces)
CREATE UNIQUE INDEX IF NOT EXISTS uq_addon_batch_mp_payment
  ON public.addon_batch_changes(mp_payment_id) WHERE mp_payment_id IS NOT NULL;

ALTER TABLE public.addon_batch_changes ENABLE ROW LEVEL SECURITY;
-- El tenant VE sus batches (para el "estamos confirmando tu pago" del checkout-return);
-- la escritura es SOLO service_role (EF/webhook).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='addon_batch_changes' AND policyname='addon_batch_select') THEN
    CREATE POLICY addon_batch_select ON public.addon_batch_changes FOR SELECT
      USING (tenant_id = public.get_user_tenant_id() OR public.is_admin());
  END IF;
END $$;
REVOKE ALL ON public.addon_batch_changes FROM PUBLIC;
REVOKE ALL ON public.addon_batch_changes FROM anon;
GRANT SELECT ON public.addon_batch_changes TO authenticated;
GRANT ALL   ON public.addon_batch_changes TO service_role;

-- 4) Aplicación ATÓMICA del batch: sincroniza los packs FIJOS al estado objetivo y marca
--    el change como aplicado. Idempotente: si ya está aplicado, no hace nada.
CREATE OR REPLACE FUNCTION public.fn_aplicar_addon_batch(p_tenant_id UUID, p_change_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_estado TEXT;
  v_packs JSONB;
BEGIN
  SELECT estado, packs_objetivo INTO v_estado, v_packs
    FROM public.addon_batch_changes
    WHERE id = p_change_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF v_estado IS NULL THEN RETURN FALSE; END IF;          -- no existe / de otro tenant
  IF v_estado = 'aplicado' THEN RETURN TRUE; END IF;      -- idempotente
  IF v_estado NOT IN ('pendiente_pago') THEN RETURN FALSE; END IF;

  -- Estado objetivo reemplaza a los fijos actuales (un pack por dimensión).
  DELETE FROM public.tenant_addons WHERE tenant_id = p_tenant_id AND tipo = 'fijo';
  INSERT INTO public.tenant_addons (tenant_id, dimension, cantidad, tipo, vence_at)
  SELECT p_tenant_id, x.dimension, x.cantidad, 'fijo', NULL
  FROM jsonb_to_recordset(v_packs) AS x(dimension TEXT, cantidad INT)
  WHERE x.cantidad > 0;

  UPDATE public.addon_batch_changes
    SET estado = 'aplicado', applied_at = now()
    WHERE id = p_change_id;
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.fn_aplicar_addon_batch(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_addon_batch(UUID, UUID) TO service_role;
