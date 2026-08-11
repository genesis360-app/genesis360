-- ============================================================
-- 354_repositores_fase2_asignacion.sql
-- Repositores — Fase 2: asignación automática + reasignación manual (E2/E4 del relevamiento,
-- G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md). GO eligió esta fase (de 3 candidatas:
-- reposición física/I3, asignación/reasignación, etiquetas+impresión) por reusar infraestructura ya
-- construida (patrón de permiso `supervisa`, mig 347) y ser la de alcance más acotado.
--
-- E2: "Mixto: asignación automática inteligente por defecto (reparto equilibrado entre repositores
-- disponibles de la sucursal), con reasignación manual de supervisor/dueño". NO se construye "regla de
-- enrutamiento fija" (a diferencia de A2 de Supervisor/mig 348) porque el relevamiento de Repositores
-- no la pidió — solo reparto por carga + reasignación manual.
--
-- 🛑 Nota de diseño IMPORTANTE (ver wiki/features/supervision.md, sección "Pendiente real"): el patrón
-- `autorizaciones`/`SupervisionPanel` (mig 347/348) es para SOLICITUDES DE APROBACIÓN, un concepto
-- DISTINTO de `tareas_repositor` (trabajo operativo, como `wms_tareas`). A propósito NO se reusa esa
-- tabla ni ese componente acá — se construye assignment específico sobre `tareas_repositor.
-- usuario_asignado_id` (columna que ya existía desde mig 352, sin usar todavía), mirando el MECANISMO
-- de reparto-por-carga de mig 348 (fn_usuarios_supervisan_modulo → fn_autorizaciones_auto_asignar)
-- pero aplicado a un pool distinto: acá el pool es "quién HACE trabajo de repositor" (puede editar el
-- módulo), no "quién SUPERVISA" (aprueba/reasigna).
--
-- Todas las filas de tareas_repositor nacen ÚNICAMENTE de fn_generar_tarea_repositor_precio/estado
-- (mig 352) — a diferencia de `autorizaciones` (múltiples call sites en todo el proyecto), acá no hace
-- falta un trigger BEFORE INSERT genérico aparte: se inlinea la asignación directo en el INSERT de esas
-- 2 funciones (CREATE OR REPLACE, mismo cuerpo que mig 352 + la asignación). En el ON CONFLICT DO
-- UPDATE (dedupe de mig 352) NO se toca usuario_asignado_id a propósito — un cambio de precio repetido
-- sobre una tarea ya asignada no le "roba" la tarea a quien ya la tiene.
-- ============================================================

-- ── 1) Pool de elegibles — espejo SQL de "puede editar el módulo repositores" ──────────────────────
-- Mismo criterio de acceso real que ya usa el nav (navVisibility.ts: cajeroVisible+depositoVisible+
-- avanzadoOnly) + los roles que siempre pasan (DUEÑO/SUPER_USUARIO/SUPERVISOR, sin restricción de
-- módulo para ellos) + rol custom con 'editar'/'supervisa' explícito. A propósito NO incluye ADMIN
-- (rol fijo = staff de soporte cross-tenant, ver reference_rol_admin_staff_aislamiento en memoria) —
-- alguien de soporte no tiene que terminar con un cartel de góndola asignado a su nombre; sí puede
-- seguir REASIGNANDO tareas (puedeSupervisarModulo ya lo permite, sin cambios acá).
-- Alcance por sucursal: mismo criterio que auth_ve_todas_sucursales()/auth_user_sucursal() (mig 216)
-- pero evaluado POR FILA de usuario candidato (esas 2 funciones solo resuelven auth.uid(), no sirven
-- para "¿esta OTRA persona ve todas las sucursales?").
CREATE OR REPLACE FUNCTION public.fn_usuarios_hacen_repositor(p_tenant_id uuid, p_sucursal_id uuid)
RETURNS TABLE (usuario_id uuid, nombre text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT u.id, u.nombre_display
  FROM users u
  LEFT JOIN roles_custom rc ON rc.id = u.rol_custom_id AND rc.activo = true
  WHERE u.tenant_id = p_tenant_id AND u.activo = true
    AND (
      u.rol = 'DUEÑO'
      OR (u.rol IN ('SUPERVISOR', 'SUPER_USUARIO') AND u.puede_ver_todas IS NOT FALSE)
      OR u.puede_ver_todas = TRUE
      OR u.sucursal_id = p_sucursal_id
    )
    AND (
      u.rol IN ('DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CAJERO', 'DEPOSITO')
      OR rc.permisos ->> 'repositores' IN ('editar', 'supervisa')
    )
$$;

COMMENT ON FUNCTION public.fn_usuarios_hacen_repositor(uuid, uuid) IS
  'Repositores Fase 2 (mig 354): quién HACE trabajo de repositor en una sucursal (distinto de quién SUPERVISA, fn_usuarios_supervisan_modulo de mig 348) — pool para auto-asignación por carga y para el picker de reasignación manual. Espejo a mano de la combinación real cajeroVisible+depositoVisible+roles siempre-permitidos de navVisibility.ts; excluye ADMIN(staff) a propósito. Mantener sincronizado si cambia esa lista.';

REVOKE ALL ON FUNCTION public.fn_usuarios_hacen_repositor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_usuarios_hacen_repositor(uuid, uuid) TO authenticated, service_role;

-- ── 2) Reparto por carga — a quién le toca la próxima tarea ─────────────────────────────────────────
-- Empate (todos con la misma carga, típico con todos en 0) se desempata al azar, no siempre el mismo
-- UUID — mismo criterio y misma razón que fn_autorizaciones_auto_asignar (mig 348): si no, "el primero
-- alfabético" terminaría concentrando todo en la misma persona.
-- VOLATILE (no STABLE) a propósito: usa random() para el desempate, que por definición no es
-- estable entre llamadas con los mismos argumentos dentro del mismo statement (hallazgo del
-- migration-reviewer — inofensivo con el patrón de uso actual, pero es la clasificación correcta).
CREATE OR REPLACE FUNCTION public.fn_repositor_elegir_asignado(p_tenant_id uuid, p_sucursal_id uuid)
RETURNS uuid
LANGUAGE sql VOLATILE
SET search_path = public
AS $$
  SELECT e.usuario_id
  FROM fn_usuarios_hacen_repositor(p_tenant_id, p_sucursal_id) e
  LEFT JOIN (
    SELECT usuario_asignado_id, count(*) AS n
    FROM tareas_repositor
    WHERE tenant_id = p_tenant_id AND sucursal_id = p_sucursal_id
      AND estado IN ('pendiente', 'en_curso') AND usuario_asignado_id IS NOT NULL
    GROUP BY usuario_asignado_id
  ) carga ON carga.usuario_asignado_id = e.usuario_id
  ORDER BY COALESCE(carga.n, 0) ASC, random()
  LIMIT 1
$$;

COMMENT ON FUNCTION public.fn_repositor_elegir_asignado(uuid, uuid) IS
  'Repositores Fase 2 (mig 354): elige quién recibe la próxima tarea nueva — el elegible (fn_usuarios_hacen_repositor) con MENOS tareas pendientes/en_curso asignadas ahora mismo en esa sucursal, empate al azar. NULL si no hay nadie elegible (la tarea queda sin asignar, disponible para cualquiera con acceso — mismo comportamiento que tenía toda tarea hasta esta migración). Uso interno de los triggers de mig 352, no expuesto por RPC.';

REVOKE ALL ON FUNCTION public.fn_repositor_elegir_asignado(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_repositor_elegir_asignado(uuid, uuid) TO service_role;

-- ── 3) Guard: usuario_asignado_id tiene que pertenecer al mismo tenant ──────────────────────────────
-- Mismo gap y mismo fix que fn_regla_enrutamiento_valida_tenant (mig 348): la FK a users(id) por sí
-- sola no exige mismo tenant — sin este guard, un PATCH directo a la REST API (bypaseando el picker
-- del frontend, que sólo ofrece usuarios del propio tenant) podría asignar una tarea a un usuario de
-- OTRO tenant, invisible en la UI de Repositores.
CREATE OR REPLACE FUNCTION public.fn_tarea_repositor_asignado_valido_tenant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.usuario_asignado_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.usuario_asignado_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'El usuario asignado debe pertenecer al mismo negocio.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tarea_repositor_asignado_valido_tenant ON public.tareas_repositor;
CREATE TRIGGER trg_tarea_repositor_asignado_valido_tenant
  BEFORE INSERT OR UPDATE OF usuario_asignado_id ON public.tareas_repositor
  FOR EACH ROW EXECUTE FUNCTION public.fn_tarea_repositor_asignado_valido_tenant();

COMMENT ON FUNCTION public.fn_tarea_repositor_asignado_valido_tenant() IS
  'Guard de tareas_repositor.usuario_asignado_id: rechaza si no pertenece al mismo tenant_id de la tarea — la FK a users(id) por sí sola no lo exige. Mismo patrón que fn_regla_enrutamiento_valida_tenant (mig 348).';

-- No es invocable fuera de un trigger (RETURNS trigger), pero se revoca igual para no generar ruido
-- en el Security Advisor — mismo criterio que mig 353 aplicó a los triggers de Fase 1.
REVOKE ALL ON FUNCTION public.fn_tarea_repositor_asignado_valido_tenant() FROM PUBLIC, anon, authenticated;

-- ── 4) Auto-asignación inline en los 2 triggers de mig 352 (CREATE OR REPLACE, mismo cuerpo + esto) ─
CREATE OR REPLACE FUNCTION public.fn_generar_tarea_repositor_precio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_avanzado boolean;
BEGIN
  IF NEW.precio_venta IS NOT DISTINCT FROM OLD.precio_venta THEN RETURN NEW; END IF;

  SELECT (modo_operacion = 'avanzado') INTO v_avanzado FROM tenants WHERE id = NEW.tenant_id;
  IF NOT COALESCE(v_avanzado, false) THEN RETURN NEW; END IF;

  FOR r IN
    SELECT pus.sucursal_id
    FROM producto_ubicacion_sucursal pus
    JOIN ubicaciones u ON u.id = pus.ubicacion_exhibicion_id
    WHERE pus.producto_id = NEW.id AND u.tipo_logico = 'exhibicion'
  LOOP
    INSERT INTO tareas_repositor (tenant_id, sucursal_id, producto_id, tipo, precio_anterior, precio_nuevo, usuario_asignado_id)
    VALUES (NEW.tenant_id, r.sucursal_id, NEW.id, 'cambio_precio', OLD.precio_venta, NEW.precio_venta,
            fn_repositor_elegir_asignado(NEW.tenant_id, r.sucursal_id))
    ON CONFLICT (producto_id, sucursal_id, tipo) WHERE estado IN ('pendiente', 'en_curso')
    DO UPDATE SET precio_nuevo = EXCLUDED.precio_nuevo;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[fn_generar_tarea_repositor_precio] producto % : %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_generar_tarea_repositor_estado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_descuento numeric; v_avanzado boolean; v_tiene_exhibicion boolean;
BEGIN
  IF NEW.estado_id IS NOT DISTINCT FROM OLD.estado_id THEN RETURN NEW; END IF;
  IF NEW.estado_id IS NULL OR NEW.sucursal_id IS NULL THEN RETURN NEW; END IF;

  SELECT (modo_operacion = 'avanzado') INTO v_avanzado FROM tenants WHERE id = NEW.tenant_id;
  IF NOT COALESCE(v_avanzado, false) THEN RETURN NEW; END IF;

  SELECT descuento_pct INTO v_descuento FROM estados_inventario WHERE id = NEW.estado_id;
  IF COALESCE(v_descuento, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT true INTO v_tiene_exhibicion
  FROM producto_ubicacion_sucursal pus
  JOIN ubicaciones u ON u.id = pus.ubicacion_exhibicion_id
  WHERE pus.producto_id = NEW.producto_id AND pus.sucursal_id = NEW.sucursal_id AND u.tipo_logico = 'exhibicion';
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO tareas_repositor (tenant_id, sucursal_id, producto_id, tipo, estado_inventario_id, inventario_linea_id, usuario_asignado_id)
  VALUES (NEW.tenant_id, NEW.sucursal_id, NEW.producto_id, 'cambio_estado', NEW.estado_id, NEW.id,
          fn_repositor_elegir_asignado(NEW.tenant_id, NEW.sucursal_id))
  ON CONFLICT (producto_id, sucursal_id, tipo) WHERE estado IN ('pendiente', 'en_curso')
  DO UPDATE SET estado_inventario_id = EXCLUDED.estado_inventario_id, inventario_linea_id = EXCLUDED.inventario_linea_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[fn_generar_tarea_repositor_estado] linea % : %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

-- ── 5) Vista: suma el nombre del asignado (para la card + el badge) ────────────────────────────────
CREATE OR REPLACE VIEW public.vw_tareas_repositor
WITH (security_invoker = true)
AS
-- 🛑 usuario_asignado_nombre va AL FINAL del SELECT a propósito: CREATE OR REPLACE VIEW no permite
-- insertar una columna nueva en el medio de las ya existentes (falla con "cannot change name of view
-- column" porque reordena/renombra las columnas de más abajo) — solo permite AGREGAR al final.
SELECT
  tr.*,
  p.nombre AS producto_nombre,
  p.sku AS producto_sku,
  ei.nombre AS estado_nombre,
  ei.descuento_pct,
  il.fecha_vencimiento,
  EXISTS (
    SELECT 1 FROM venta_items vi
    JOIN ventas v ON v.id = vi.venta_id
    WHERE vi.producto_id = tr.producto_id
      AND v.sucursal_id = tr.sucursal_id
      AND v.created_at > tr.created_at
      AND v.estado NOT IN ('cancelada', 'pendiente')
  ) AS vendido_con_tag_desactualizado,
  (tr.tipo = 'cambio_precio' AND tr.precio_nuevo IS NOT NULL AND tr.precio_anterior IS NOT NULL
   AND tr.precio_nuevo > tr.precio_anterior) AS precio_subio,
  ua.nombre_display AS usuario_asignado_nombre
FROM tareas_repositor tr
JOIN productos p ON p.id = tr.producto_id
LEFT JOIN estados_inventario ei ON ei.id = tr.estado_inventario_id
LEFT JOIN inventario_lineas il ON il.id = tr.inventario_linea_id
LEFT JOIN users ua ON ua.id = tr.usuario_asignado_id;

COMMENT ON VIEW public.vw_tareas_repositor IS
  'tareas_repositor + datos de prioridad C1-C3 (mig 352) + nombre del asignado (mig 354, Fase 2). WITH (security_invoker = true) desde mig 353 (fix de seguridad, ver esa migración). Mig 352/353/354.';
