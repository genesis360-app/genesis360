-- Fede 25/7, punto 2 (módulo Comercial): cupones — se aplican sobre el TOTAL de la compra
-- (no por producto), en $ FIJOS (no %), con código único alfanumérico. Una campaña puede generar
-- hasta ~100 códigos (`cupones_codigos`). Independientes de los descuentos de producto: el cupón
-- se calcula sobre el total sin importar si algún ítem ya tenía descuento aplicado. Se acumulan
-- con el descuento por método de pago (mig 281) — ambos son descuentos de COMPRA TOTAL, no de
-- producto — pero es un único descuento de producto el que gana entre sí (tier/empaque/combo/
-- estado, eso NO cambia acá).

CREATE TABLE IF NOT EXISTS public.cupones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  motivo text,
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  vigencia_desde date NOT NULL,
  vigencia_hasta date NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  CONSTRAINT cupones_vigencia_chk CHECK (vigencia_hasta >= vigencia_desde)
);

CREATE INDEX IF NOT EXISTS idx_cupones_tenant ON public.cupones(tenant_id);

CREATE TABLE IF NOT EXISTS public.cupones_codigos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cupon_id uuid NOT NULL REFERENCES cupones(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  usado_en_venta_id uuid REFERENCES ventas(id) ON DELETE SET NULL,
  usado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_cupones_codigos_cupon ON public.cupones_codigos(cupon_id);
CREATE INDEX IF NOT EXISTS idx_cupones_codigos_tenant ON public.cupones_codigos(tenant_id);
-- Búsqueda de canje: código + tenant + disponible (partial, solo filas sin usar).
CREATE INDEX IF NOT EXISTS idx_cupones_codigos_disponible ON public.cupones_codigos(tenant_id, codigo) WHERE usado_en_venta_id IS NULL;

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS cupon_codigo_id uuid REFERENCES cupones_codigos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cupon_monto numeric(12,2);

-- Un código no puede quedar aplicado a dos ventas a la vez (Postgres permite múltiples NULL sin
-- conflicto — no afecta a las ventas sin cupón). Defensa extra a nivel constraint, además del
-- UPDATE condicional (`WHERE usado_en_venta_id IS NULL`) que hace el claim atómico en el canje.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ventas_cupon_codigo_id_key') THEN
    ALTER TABLE public.ventas ADD CONSTRAINT ventas_cupon_codigo_id_key UNIQUE (cupon_codigo_id);
  END IF;
END $$;

COMMENT ON TABLE public.cupones IS 'Campaña de cupón (Fede 25/7): $ fijos sobre el total de la venta, independiente de descuentos de producto.';
COMMENT ON TABLE public.cupones_codigos IS 'Códigos únicos de una campaña de cupón. usado_en_venta_id se setea al canjear — un código se usa una sola vez.';
COMMENT ON COLUMN public.ventas.cupon_monto IS 'Snapshot del monto descontado por cupón al momento de la venta (el cupón pudo cambiar/desactivarse después).';

ALTER TABLE public.cupones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupones_codigos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cupones' AND policyname='cupones_tenant') THEN
    CREATE POLICY cupones_tenant ON public.cupones FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cupones_codigos' AND policyname='cupones_codigos_tenant') THEN
    CREATE POLICY cupones_codigos_tenant ON public.cupones_codigos FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

REVOKE ALL ON public.cupones FROM PUBLIC, anon;
REVOKE ALL ON public.cupones_codigos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupones_codigos TO authenticated;
GRANT ALL ON public.cupones TO service_role;
GRANT ALL ON public.cupones_codigos TO service_role;
