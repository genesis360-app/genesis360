-- 261: Facturación automática de la PLATAFORMA (no de un tenant) — Factura C de Federico
-- Messina (monotributista, CUIT 20-42237416-8) por los cobros de suscripción que le entran
-- a su cuenta de Mercado Pago / banco. Diseño: plan aprobado 2026-07-08 (facturación de Fede).
--
--   • platform_billers: config AFIP de quien factura ingresos de PLATAFORMA. NO es un tenant
--     (no tiene inventario/ventas/usuarios) — meterlo en `tenants` ensuciaría customers.list,
--     metrics.overview y cualquier sweep pensado para negocios reales. RLS solo service_role.
--   • platform_facturas: comprobantes emitidos por ese circuito (Factura C, Consumidor Final
--     — un emisor Monotributista SIEMPRE factura C sin importar el receptor, y la C no exige
--     identificar al comprador, confirmado en src/lib/facturacionLogic.ts). tenant_origen_id
--     es solo trazabilidad informativa de qué tenant generó el cobro, no dato fiscal.
--
-- Reutiliza el transporte AfipSDK ya probado (supabase/functions/emitir-factura/providers.ts,
-- makeAfipProvider) vía una EF nueva (emitir-factura-plataforma) — NO se toca emitir-factura
-- ni su flujo de ventas de tenants.

CREATE TABLE IF NOT EXISTS public.platform_billers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre               TEXT NOT NULL,                 -- interno ('Federico Messina'), no fiscal
  cuit                 BIGINT NOT NULL,
  razon_social_fiscal  TEXT NOT NULL,
  domicilio_fiscal     TEXT NOT NULL,
  condicion_iva_emisor TEXT NOT NULL DEFAULT 'Monotributista'
    CHECK (condicion_iva_emisor IN ('Monotributista','Exento','RI')),
  punto_venta          INT NOT NULL,
  afip_provider        TEXT NOT NULL DEFAULT 'afipsdk' CHECK (afip_provider IN ('afipsdk','propio')),
  afipsdk_token        TEXT,
  afip_produccion      BOOLEAN NOT NULL DEFAULT FALSE,  -- arranca en homologación
  cert_crt_path        TEXT,
  cert_key_path        TEXT,                            -- mismo bucket certificados-afip
  umbral_facturacion_anual NUMERIC(14,2),                -- techo de categoría monotributo (aviso, no bloqueo)
  activo               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_billers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_billers FROM PUBLIC;
REVOKE ALL ON public.platform_billers FROM anon;
REVOKE ALL ON public.platform_billers FROM authenticated;
GRANT ALL ON public.platform_billers TO service_role;

CREATE TABLE IF NOT EXISTS public.platform_facturas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  biller_id           UUID NOT NULL REFERENCES public.platform_billers(id) ON DELETE RESTRICT,
  tenant_origen_id    UUID REFERENCES public.tenants(id) ON DELETE SET NULL,  -- trazabilidad, no fiscal
  monto               NUMERIC(12,2) NOT NULL,
  concepto            TEXT NOT NULL,
  punto_venta         INT NOT NULL,
  numero_comprobante  INT NOT NULL,
  tipo_comprobante    TEXT NOT NULL DEFAULT 'C',
  cae                 TEXT NOT NULL,
  cae_vencimiento     TEXT NOT NULL,
  afip_provider_usado TEXT NOT NULL,
  origen_pago         TEXT NOT NULL CHECK (origen_pago IN ('mp_recurrente','mp_manual','manual_staff')),
  payment_ref         TEXT,   -- id del pago de origen (payment id de MP, o billing_manual_pagos.id) — dedup
  error_detalle       TEXT,   -- si el intento falló antes del CAE, se loguea por soporte (fail-open)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_facturas_biller_fecha
  ON public.platform_facturas(biller_id, created_at DESC);
ALTER TABLE public.platform_facturas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_facturas FROM PUBLIC;
REVOKE ALL ON public.platform_facturas FROM anon;
REVOKE ALL ON public.platform_facturas FROM authenticated;
GRANT ALL ON public.platform_facturas TO service_role;

-- Idempotencia PREVIA a llamar a AFIP (no solo al persistir): reclamar el payment_ref antes
-- de emitir. Si dos invocaciones llegan para el mismo pago (reintento de webhook, doble
-- corrida del sweep), la segunda pierde el claim y NO llama a AFIP → nunca se emite el mismo
-- cobro dos veces (REGLA #0 — un CAE duplicado no se puede anular sin nota de crédito).
CREATE TABLE IF NOT EXISTS public.platform_facturas_claims (
  payment_ref TEXT PRIMARY KEY,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_facturas_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_facturas_claims FROM PUBLIC;
REVOKE ALL ON public.platform_facturas_claims FROM anon;
REVOKE ALL ON public.platform_facturas_claims FROM authenticated;
GRANT ALL ON public.platform_facturas_claims TO service_role;
