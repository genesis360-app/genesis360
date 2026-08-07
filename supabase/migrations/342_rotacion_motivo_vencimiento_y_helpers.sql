-- 342 — Motor de Rotación: ejecución Opción 1 (agotar antes de reponer) — piezas de soporte.
-- Relevamiento cerrado 2026-08-07 (B4/C2/E5 respondidos por GO):
--   B4: el motor actúa recién con el cambio de estado APROBADO — ya lo garantiza la arquitectura
--       existente (LpnAccionesModal NO toca inventario_lineas.estado_id hasta que
--       aprobarAutorizacion corre; ver comentario "sigue siendo el de la línea hasta que un
--       supervisor lo aprueba"). No requiere código nuevo, solo que el motor lea el estado_id
--       REAL de la línea (que ya refleja únicamente cambios aprobados o que no necesitaban
--       aprobación).
--   C2: "agotado" se mide por LOTE/estado — cualquier cantidad > 0 en el estado con descuento de
--       ESE producto bloquea, sin importar cuánto stock sano conviva. Alcance confirmado con GO
--       (2026-08-07, no estaba en el relevamiento original): POR SUCURSAL — el stock por vencer de
--       una sucursal NO bloquea la reposición de otra. `p_sucursal_id` es explícito en vez de
--       depender del RLS del usuario que llama (un DUEÑO con "ver todas las sucursales" necesita
--       el mismo resultado por-sucursal que alguien acotado a una sola).
--   C3 (+ nota bajo "C2" de Fede): la regla 1 SOLO cuenta el motivo VENCIMIENTO, nunca otros
--       motivos (dañado, etc.) — pero `estados_inventario` no distinguía el motivo de un estado.
--       Se agrega `motivo_vencimiento` para que el dueño lo marque explícitamente (mismo patrón
--       que `dispara_rotacion`, mig 341).

ALTER TABLE public.estados_inventario
  ADD COLUMN IF NOT EXISTS motivo_vencimiento boolean NOT NULL DEFAULT false;

-- Devuelve los producto_id del tenant/sucursal bloqueados para reposición por la Opción 1: la regla
-- está activa (jerarquía SKU>categoría>tenant) Y existe stock > 0 EN ESA SUCURSAL en un estado que
-- dispara Rotación por motivo vencimiento (C1+C2+C3 combinados). `p_sucursal_id = NULL` = solo mira
-- líneas globales (sucursal_id IS NULL); pasar la sucursal activa para el caso normal de OC
-- sugerida. Pensada para excluir productos de esa lista en un solo query en vez de llamar la
-- función escalar por producto.
CREATE OR REPLACE FUNCTION public.fn_rotacion_productos_bloqueados_reposicion(p_tenant_id uuid, p_sucursal_id uuid DEFAULT NULL)
RETURNS TABLE (producto_id uuid)
LANGUAGE sql STABLE
SET search_path = 'public'
AS $$
  SELECT DISTINCT il.producto_id
  FROM public.inventario_lineas il
  JOIN public.estados_inventario ei ON ei.id = il.estado_id
  JOIN public.productos p ON p.id = il.producto_id
  CROSS JOIN LATERAL public.fn_rotacion_reglas_efectivas(il.producto_id) r
  WHERE p.tenant_id = p_tenant_id
    AND il.activo = true
    AND il.cantidad > 0
    AND (il.sucursal_id = p_sucursal_id OR (p_sucursal_id IS NULL AND il.sucursal_id IS NULL) OR il.sucursal_id IS NULL)
    AND ei.tenant_id = p_tenant_id
    AND ei.dispara_rotacion = true
    AND ei.motivo_vencimiento = true
    AND r.agotar_antes_reponer = true;
$$;

REVOKE ALL ON FUNCTION public.fn_rotacion_productos_bloqueados_reposicion(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rotacion_productos_bloqueados_reposicion(uuid, uuid) TO authenticated, service_role;

-- Devuelve, para UN producto en UNA sucursal, si tiene stock activo bloqueando reposición por
-- Opción 1 (C1/C2/C3) y la fecha de vencimiento MÁS LEJANA entre esos lotes bloqueantes — para que
-- Recepciones pueda comparar la fecha del ingreso nuevo contra esta y avisar/bloquear solo si es
-- más lejana (C1: sumar más de la MISMA fecha está permitido, mezclar con stock más fresco no).
CREATE OR REPLACE FUNCTION public.fn_rotacion_vencimiento_bloqueante(p_producto_id uuid, p_sucursal_id uuid DEFAULT NULL)
RETURNS TABLE (bloqueado boolean, fecha_vencimiento_max date)
LANGUAGE sql STABLE
SET search_path = 'public'
AS $$
  SELECT
    COALESCE(bool_or(true), false),
    MAX(il.fecha_vencimiento)
  FROM public.inventario_lineas il
  JOIN public.estados_inventario ei ON ei.id = il.estado_id
  CROSS JOIN LATERAL public.fn_rotacion_reglas_efectivas(p_producto_id) r
  WHERE il.producto_id = p_producto_id
    AND il.activo = true
    AND il.cantidad > 0
    AND (il.sucursal_id = p_sucursal_id OR (p_sucursal_id IS NULL AND il.sucursal_id IS NULL) OR il.sucursal_id IS NULL)
    AND ei.dispara_rotacion = true
    AND ei.motivo_vencimiento = true
    AND r.agotar_antes_reponer = true;
$$;

REVOKE ALL ON FUNCTION public.fn_rotacion_vencimiento_bloqueante(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rotacion_vencimiento_bloqueante(uuid, uuid) TO authenticated, service_role;
