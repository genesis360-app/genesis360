-- 387: Modelo de identidad para el Portal de Proveedores (propuesta de Fede, sección H,
-- ver project_whatsapp_ia_portal_proveedores). Decisión de negocio confirmada por GO: UNA sola
-- cuenta de proveedor puede usarse en VARIOS negocios (tenants) distintos.
--
-- Esto rompe el supuesto de raíz de `public.users`: `users.id` (= `auth.users.id`) tiene
-- EXACTAMENTE una fila con UN `tenant_id`, y toda la RLS de la app asume esa relación 1:1.
-- En vez de forzar ese modelo a soportar multi-tenant (alto radio de impacto: tocaría RLS
-- usada en toda la app), se replica el patrón YA EXISTENTE en este proyecto para identidades
-- cross-tenant: `support_agents` (usado por el panel genesis360-admin) — una identidad
-- COMPLETAMENTE separada de `users`, con su propia tabla y su propio login, vinculada a cada
-- tenant vía una tabla puente explícita. Igual que `users`/`support_agents`, lleva FK física a
-- `auth.users`.
--
-- Alcance de ESTA migración: solo el modelo de identidad + el vínculo a qué tenant/proveedor
-- representa cada cuenta. NO incluye todavía las policies sobre `ordenes_compra`/presupuestos
-- (depende de cómo se integre el flujo de "presupuesto estructurado" al state machine real de
-- OC — Fede: "sigue el flujo YA EXISTENTE de OC" — se diseña en una fase siguiente, revisando
-- `ordenes_compra` en detalle). Tampoco incluye el flujo de invitación/alta de cuentas (Edge
-- Function `SECURITY DEFINER` de una fase futura) — por eso ninguna policy de cliente permite
-- INSERT en ninguna de las 2 tablas.

-- Refuerzo de integridad para la fase futura de policies sobre `ordenes_compra`: permite un FK
-- compuesto (tenant_id, proveedor_id) en vez de solo (proveedor_id), para que la DB garantice
-- que el proveedor vinculado pertenece de verdad a ese tenant (no confiar solo en 2 FKs sueltas).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proveedores_tenant_id_id_key'
  ) THEN
    ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.proveedor_accounts (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  nombre text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Único índice de unicidad de email (case-insensitive) — subsume el UNIQUE(email) simple.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedor_accounts_email_lower ON public.proveedor_accounts (lower(email));

CREATE TABLE IF NOT EXISTS public.proveedor_account_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_account_id uuid NOT NULL REFERENCES public.proveedor_accounts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  proveedor_id uuid NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Un proveedor (fila de `proveedores` de un tenant) solo puede estar vinculado a UNA cuenta.
  UNIQUE (tenant_id, proveedor_id),
  -- Una cuenta no puede vincularse 2 veces al mismo tenant.
  UNIQUE (proveedor_account_id, tenant_id),
  -- FK compuesto: garantiza que proveedor_id pertenece de verdad a tenant_id (no 2 FKs sueltas).
  FOREIGN KEY (tenant_id, proveedor_id) REFERENCES public.proveedores(tenant_id, id) ON DELETE CASCADE
);

-- Sin índices extra acá: (tenant_id, proveedor_id) y (proveedor_account_id, tenant_id) ya están
-- cubiertos por los UNIQUE de arriba (btree implícito), incluyendo filtros solo por tenant_id
-- (prefijo del primer UNIQUE).

ALTER TABLE public.proveedor_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_account_tenants ENABLE ROW LEVEL SECURITY;

-- El proveedor solo ve/edita su propia fila de identidad. Sin INSERT/DELETE de cliente a
-- propósito (evita auto-alta con un email arbitrario / squatting sobre el UNIQUE de email) — el
-- alta real la hace la Edge Function de invitación (fase futura) con service_role, que bypassea
-- RLS y no necesita policy de INSERT para funcionar.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'proveedor_accounts' AND policyname = 'proveedor_accounts_self'
  ) THEN
    CREATE POLICY proveedor_accounts_self ON public.proveedor_accounts
      FOR SELECT USING (id = (select auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'proveedor_accounts' AND policyname = 'proveedor_accounts_self_update'
  ) THEN
    CREATE POLICY proveedor_accounts_self_update ON public.proveedor_accounts
      FOR UPDATE USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));
  END IF;
END $$;

-- El proveedor puede ver a qué negocios está vinculado (selector de negocio del portal), pero no
-- puede crear ni borrar vínculos por sí mismo — mismo criterio que arriba.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'proveedor_account_tenants' AND policyname = 'proveedor_account_tenants_self_select'
  ) THEN
    CREATE POLICY proveedor_account_tenants_self_select ON public.proveedor_account_tenants
      FOR SELECT USING (proveedor_account_id = (select auth.uid()));
  END IF;
END $$;

REVOKE ALL ON public.proveedor_accounts FROM anon;
REVOKE ALL ON public.proveedor_account_tenants FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.proveedor_accounts TO authenticated;
GRANT SELECT ON public.proveedor_account_tenants TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_updated_at_proveedor_accounts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_proveedor_accounts ON public.proveedor_accounts;
CREATE TRIGGER trg_updated_at_proveedor_accounts
  BEFORE UPDATE ON public.proveedor_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at_proveedor_accounts();
