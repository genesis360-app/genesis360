-- 390: Portal de Proveedores — acceso real a Órdenes de Compra (2ª fase, ver mig 387 que dejó
-- solo el modelo de identidad). Fede (sección H): "negocio pide cotización (pre-cargada con el
-- precio de la última compra) → proveedor responde con presupuesto estructurado (SIN fotos) →
-- sigue el flujo YA EXISTENTE de OC". El ciclo de vida real de `ordenes_compra` (CO1-CO8, ✅ PROD)
-- es borrador→enviada→confirmada→cancelada→recibida_parcial→recibida — SIN inventar un estado
-- nuevo: el proveedor solo interactúa mientras la OC está 'enviada'.
--
-- Decisión confirmada con GO (2026-09-01): la respuesta del proveedor NUNCA confirma la OC sola —
-- un tercero externo no puede disparar un compromiso de pago sin que un DUEÑO/SUPERVISOR lo
-- revise (REGLA #0). Por eso la propuesta de precio del proveedor vive en columnas NUEVAS
-- (`precio_propuesto_proveedor`/`respondido_at`), separadas de `precio_unitario` (la autoridad
-- real la sigue teniendo el staff, que "Aplica" la propuesta a mano desde ProveedoresPage).
--
-- Diseño de acceso: 5 RPC `SECURITY DEFINER` acotadas (mismo patrón que `get_cuenta_cliente_by_token`
-- para el portal público de clientes) en vez de RLS ancha sobre las tablas reales. Se descartó RLS
-- directa sobre `tenants` a propósito: la tabla tiene columnas MUY sensibles (`clave_maestra`,
-- `afipsdk_token`, `cuit`, `cbu`, `fichado_token`, `mp_subscription_id`...) — cualquier policy de
-- fila ahí expondría todo eso al proveedor por accidente. Las RPC devuelven SOLO las columnas
-- necesarias y validan `auth.uid()` contra `proveedor_account_tenants` en cada una — ninguna
-- confía en que el frontend mande el filtro correcto.

ALTER TABLE public.orden_compra_items
  ADD COLUMN IF NOT EXISTS precio_propuesto_proveedor numeric(12,2),
  ADD COLUMN IF NOT EXISTS respondido_at timestamp with time zone;

COMMENT ON COLUMN public.orden_compra_items.precio_propuesto_proveedor IS
  'Precio que el PROVEEDOR propuso desde el Portal de Proveedores (mig 390, vía fn_portal_proveedor_responder_item) — nunca pisa precio_unitario solo. El staff lo revisa y lo "aplica" a mano desde ProveedoresPage (REGLA #0: un tercero externo nunca confirma un precio real sin revisión humana).';
COMMENT ON COLUMN public.orden_compra_items.respondido_at IS
  'Cuándo el proveedor cargó su propuesta de precio — NULL = sin responder todavía.';

-- ── RPC 1: negocios a los que está vinculada la cuenta que llama (selector del portal) ─────────
CREATE OR REPLACE FUNCTION public.fn_portal_proveedor_negocios()
RETURNS TABLE (tenant_id uuid, negocio_nombre text, proveedor_id uuid, proveedor_nombre text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT t.id, t.nombre, pat.proveedor_id, p.nombre
  FROM public.proveedor_account_tenants pat
  JOIN public.tenants t ON t.id = pat.tenant_id
  JOIN public.proveedores p ON p.id = pat.proveedor_id AND p.tenant_id = pat.tenant_id
  WHERE pat.proveedor_account_id = auth.uid() AND pat.activo = true;
$$;

COMMENT ON FUNCTION public.fn_portal_proveedor_negocios() IS
  'Portal de Proveedores (mig 390) — lista los negocios vinculados a la cuenta que llama, con SOLO nombre/id (nunca expone la fila completa de tenants, que tiene columnas sensibles). Filtra por auth.uid() adentro, no confía en ningún parámetro.';

-- ── RPC 2: OC del proveedor en un negocio puntual (ya enviadas, nunca borradores internos) ──────
CREATE OR REPLACE FUNCTION public.fn_portal_proveedor_ocs(p_tenant_id uuid)
RETURNS TABLE (
  id uuid, numero integer, estado text, fecha_esperada date, notas text,
  created_at timestamptz, monto_total numeric, condiciones_pago text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT oc.id, oc.numero, oc.estado, oc.fecha_esperada, oc.notas,
         oc.created_at, oc.monto_total, oc.condiciones_pago
  FROM public.ordenes_compra oc
  JOIN public.proveedor_account_tenants pat
    ON pat.tenant_id = oc.tenant_id AND pat.proveedor_id = oc.proveedor_id
  WHERE pat.proveedor_account_id = auth.uid() AND pat.activo = true
    AND oc.tenant_id = p_tenant_id
    AND oc.estado <> 'borrador'
  ORDER BY oc.created_at DESC;
$$;

COMMENT ON FUNCTION public.fn_portal_proveedor_ocs(uuid) IS
  'Portal de Proveedores (mig 390) — OC visibles para la cuenta que llama en un tenant puntual. p_tenant_id no es un filtro de confianza: el JOIN exige que auth.uid() esté vinculado a ESE tenant+proveedor, así que pedir un tenant ajeno devuelve 0 filas, nunca datos de otro negocio.';

-- ── RPC 3: ítems de UNA OC puntual (con nombre/SKU del producto, sin exponer productos entero) ──
CREATE OR REPLACE FUNCTION public.fn_portal_proveedor_oc_items(p_oc_id uuid)
RETURNS TABLE (
  id uuid, producto_id uuid, producto_nombre text, producto_sku text,
  cantidad numeric, precio_unitario numeric,
  precio_propuesto_proveedor numeric, respondido_at timestamptz,
  oc_estado text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT oci.id, oci.producto_id, pr.nombre, pr.sku,
         oci.cantidad, oci.precio_unitario,
         oci.precio_propuesto_proveedor, oci.respondido_at,
         oc.estado
  FROM public.orden_compra_items oci
  JOIN public.ordenes_compra oc ON oc.id = oci.orden_compra_id
  JOIN public.proveedor_account_tenants pat
    ON pat.tenant_id = oc.tenant_id AND pat.proveedor_id = oc.proveedor_id
  JOIN public.productos pr ON pr.id = oci.producto_id
  WHERE pat.proveedor_account_id = auth.uid() AND pat.activo = true
    AND oc.id = p_oc_id
    AND oc.estado <> 'borrador';
$$;

COMMENT ON FUNCTION public.fn_portal_proveedor_oc_items(uuid) IS
  'Portal de Proveedores (mig 390) — ítems de una OC puntual, ya resuelto el JOIN a productos (nombre/sku) del lado servidor: el proveedor nunca necesita ni recibe acceso directo a la tabla productos.';

-- ── RPC 4: cargar la propuesta de precio (ÚNICO camino de escritura del proveedor) ──────────────
CREATE OR REPLACE FUNCTION public.fn_portal_proveedor_responder_item(p_item_id uuid, p_precio numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_precio IS NULL OR p_precio <= 0 THEN
    RAISE EXCEPTION 'El precio propuesto debe ser mayor a 0.';
  END IF;

  -- UPDATE atómico con el chequeo de pertenencia/estado en el propio WHERE (evita la ventana
  -- TOCTOU de un SELECT de verificación seguido de un UPDATE separado — hallazgo del
  -- migration-reviewer: si el staff confirma/cancela la OC justo entre esos 2 statements, un
  -- UPDATE separado podría escribir igual aunque el estado ya cambió).
  UPDATE public.orden_compra_items oci
    SET precio_propuesto_proveedor = p_precio, respondido_at = now()
    WHERE oci.id = p_item_id
      AND EXISTS (
        SELECT 1 FROM public.ordenes_compra oc
        JOIN public.proveedor_account_tenants pat
          ON pat.tenant_id = oc.tenant_id AND pat.proveedor_id = oc.proveedor_id
        WHERE oc.id = oci.orden_compra_id
          AND pat.proveedor_account_id = auth.uid() AND pat.activo = true
          AND oc.estado = 'enviada'
      );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No se puede proponer un precio para este ítem (la orden ya no está esperando respuesta, o no te pertenece).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_portal_proveedor_responder_item(uuid, numeric) IS
  'Portal de Proveedores (mig 390) — ÚNICO camino de escritura de una cuenta de proveedor: solo puede tocar precio_propuesto_proveedor/respondido_at de un ítem propio, y solo mientras la OC sigue en estado ''enviada''. Nunca toca precio_unitario/cantidad/estado — eso lo revisa y aplica el staff a mano (REGLA #0).';

-- ── RPC 5: lado STAFF — ¿este proveedor de MI tenant ya está vinculado al portal? ───────────────
-- Hallazgo real (encontrado con el e2e, spec 138, antes de aplicar esta migración): mig 387 solo
-- dejó policies de "el proveedor ve SU PROPIA fila" (`proveedor_accounts_self`,
-- `proveedor_account_tenants_self_select`) — el STAFF (que es quien invita y necesita confirmar
-- "¿ya está vinculado, a qué email?") no tenía NINGÚN camino de lectura, ni siquiera indirecto.
-- Mismo criterio que las RPC de arriba: una función angosta en vez de abrir RLS ancha sobre
-- `proveedor_accounts` completa (que igual sería más expuesto de lo necesario).
CREATE OR REPLACE FUNCTION public.fn_proveedor_portal_vinculo(p_proveedor_id uuid)
RETURNS TABLE (email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT pa.email
  FROM public.proveedor_account_tenants pat
  JOIN public.proveedor_accounts pa ON pa.id = pat.proveedor_account_id
  WHERE pat.proveedor_id = p_proveedor_id
    AND pat.activo = true
    AND pat.tenant_id = public.get_user_tenant_id()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.fn_proveedor_portal_vinculo(uuid) IS
  'Portal de Proveedores (mig 390) — lado STAFF: ¿el proveedor p_proveedor_id de MI tenant (get_user_tenant_id()) ya tiene cuenta vinculada, y con qué email? Devuelve 0 filas si no está vinculado o si el proveedor no es de mi tenant — nunca confía en que el frontend mande el tenant correcto.';

-- Ninguna de estas 5 RPC va a `anon` — el portal siempre exige la cuenta de proveedor (o el
-- usuario staff, en la 5ª) autenticada.
REVOKE ALL ON FUNCTION public.fn_portal_proveedor_negocios() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_portal_proveedor_ocs(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_portal_proveedor_oc_items(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_portal_proveedor_responder_item(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_proveedor_portal_vinculo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_portal_proveedor_negocios() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_portal_proveedor_ocs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_portal_proveedor_oc_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_portal_proveedor_responder_item(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proveedor_portal_vinculo(uuid) TO authenticated;

-- ── Hardening (hallazgo real, no introducido por esta migración): `anon` tenía GRANT completo
-- (INSERT/UPDATE/DELETE/SELECT) en `ordenes_compra`/`orden_compra_items` por privilegios default
-- nunca revocados — mismo patrón ya documentado (ver reference_revoke_public_no_anon). No
-- explotable hoy (RLS de esas tablas exige auth.uid() real, anon no tiene ninguno), pero se
-- corrige acá de paso por tocar estas tablas de nuevo. No se agrega NINGUNA policy RLS nueva sobre
-- `ordenes_compra`/`orden_compra_items`/`productos`/`tenants` — el acceso es 100% vía las 5 RPC de
-- arriba, que corren SECURITY DEFINER y no necesitan que la tabla lo permita.
REVOKE ALL ON public.ordenes_compra FROM anon;
REVOKE ALL ON public.orden_compra_items FROM anon;
