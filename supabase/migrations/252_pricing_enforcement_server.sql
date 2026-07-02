-- Migration 252 — Pricing 2026 · FASE 1: enforcement server-side de límites (REGLA #0 de ingresos).
-- Hasta ahora los límites eran solo client-side (usePlanLimits) → bypasseables por API.
-- Este trigger valida contra el LÍMITE EFECTIVO (base + add-ons activos, fn_tenant_limite, mig 251).
--
-- Alcance: dimensiones de ESTADO (productos=sku, users=usuarios, sucursales) — inserts poco
-- frecuentes y baratos de contar. MOVIMIENTOS (flujo, hot-path) se difiere: contar en cada
-- inserción de movimientos_stock degradaría el path más caliente; se hará con contador/RPC aparte.
--
-- Seguridad de compatibilidad: los límites base nuevos son >= a los viejos y el trial da límites
-- de Pro → ningún tenant existente queda bloqueado en su operación normal. Solo se bloquea CREAR
-- por encima del límite efectivo (los recursos existentes NO se tocan). El seed de alta entra
-- (trial → Pro → 4 sucursales / 15 users, alcanza para 1 sucursal + el DUEÑO).

CREATE OR REPLACE FUNCTION public.fn_enforce_limite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dim    TEXT := TG_ARGV[0];
  v_limite INT;
  v_count  INT;
BEGIN
  -- Solo consume cupo si la fila queda ACTIVA.
  IF NEW.activo IS DISTINCT FROM TRUE THEN RETURN NEW; END IF;
  -- En UPDATE, solo si REACTIVA (activo pasó de false/null a true); update normal no consume.
  IF TG_OP = 'UPDATE' AND OLD.activo IS TRUE THEN RETURN NEW; END IF;

  v_limite := public.fn_tenant_limite(NEW.tenant_id, v_dim);
  IF v_limite = -1 THEN RETURN NEW; END IF;   -- ilimitado (Enterprise)

  EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1 AND activo = true', TG_TABLE_NAME)
    INTO v_count USING NEW.tenant_id;

  IF v_count >= v_limite THEN
    RAISE EXCEPTION 'Límite del plan alcanzado: % (tenés % de % permitidos). Subí de plan o agregá un add-on.',
      v_dim, v_count, v_limite USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.fn_enforce_limite() FROM PUBLIC, anon;

-- Triggers BEFORE INSERT OR UPDATE OF activo (el "OF activo" hace que en UPDATE solo dispare
-- cuando se toca esa columna → reactivaciones; los updates normales no pagan el costo del count).
DROP TRIGGER IF EXISTS trg_enforce_sku ON public.productos;
CREATE TRIGGER trg_enforce_sku
  BEFORE INSERT OR UPDATE OF activo ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_limite('sku');

DROP TRIGGER IF EXISTS trg_enforce_usuarios ON public.users;
CREATE TRIGGER trg_enforce_usuarios
  BEFORE INSERT OR UPDATE OF activo ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_limite('usuarios');

DROP TRIGGER IF EXISTS trg_enforce_sucursales ON public.sucursales;
CREATE TRIGGER trg_enforce_sucursales
  BEFORE INSERT OR UPDATE OF activo ON public.sucursales
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_limite('sucursales');
