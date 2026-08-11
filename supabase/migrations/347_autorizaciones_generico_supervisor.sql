-- 347 — Generaliza autorizaciones_inventario → autorizaciones (patrón "Pestaña de Supervisor"
-- reusable, 2º de 4 relevamientos derivados hacia el módulo Repositores — ver
-- relevamiento_supervisor_tab_respuestas.md, decisiones A1/A3/B1/C2 cerradas con GO 2026-08-09).
--
-- A1: en vez de que cada módulo arme su propia tabla de autorizaciones, se GENERALIZA la que ya
-- existe (evita duplicar tabla+pantalla en cada módulo nuevo — mismo criterio de reuso que ya usaron
-- 'kit_precio'/mig 343 y 'repricing_margen'/mig 346 para no crear una tabla nueva). Es un RENAME, no
-- una tabla nueva + migración de datos: preserva PK/FKs/RLS/índices/trigger existentes intactos (todo
-- eso queda atado a la tabla por OID, sobrevive el rename automáticamente — solo el texto de
-- funciones plpgsql que la referencian por nombre necesita redefinirse, ver abajo).
--
-- E1 (relevamiento): "cualquier tarea asignada tiene que poder reasignarse... cubre tanto tareas
-- operativas (WMS) como solicitudes de aprobación" → se suma `asignado_a`, nullable (NULL = disponible
-- para cualquiera con permiso 'supervisa' en ese módulo).
--
-- `modulo` con CHECK acotado a 'inventario' (único valor real hoy — el retrofit de esta migración es
-- SOLO Inventario) siguiendo el mismo patrón incremental que ya usa `tipo` en esta tabla: se extiende
-- vía ALTER en una migración futura el día que otro módulo (Pedidos, Gastos...) empiece a escribir acá.

ALTER TABLE public.autorizaciones_inventario RENAME TO autorizaciones;

ALTER TABLE public.autorizaciones ADD COLUMN modulo TEXT NOT NULL DEFAULT 'inventario';
ALTER TABLE public.autorizaciones ALTER COLUMN modulo DROP DEFAULT;
ALTER TABLE public.autorizaciones ADD CONSTRAINT autorizaciones_modulo_check CHECK (modulo IN ('inventario'));

ALTER TABLE public.autorizaciones ADD COLUMN asignado_a UUID REFERENCES public.users(id);

-- El hook nuevo (useSupervisorAutorizaciones) filtra SIEMPRE por (tenant_id, modulo, estado), y
-- reasignar/el badge cross-módulo filtran por asignado_a — el índice viejo (tenant_id, estado) no
-- cubre ninguno de los dos (hallazgo del migration-reviewer).
CREATE INDEX IF NOT EXISTS idx_autorizaciones_tenant_modulo_estado ON public.autorizaciones(tenant_id, modulo, estado);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_asignado_a ON public.autorizaciones(asignado_a);

COMMENT ON TABLE public.autorizaciones IS
  'Generalizada desde autorizaciones_inventario (mig 347) para el patrón "Pestaña de Supervisor" reusable — columna modulo discrimina el módulo dueño de cada fila (hoy solo inventario). asignado_a (E1): reasignar una solicitud a un aprobador puntual, NULL = disponible para cualquiera con permiso supervisa en ese módulo.';
COMMENT ON COLUMN public.autorizaciones.modulo IS
  'Módulo dueño de la solicitud. CHECK acotado al set real de módulos que ya escriben acá — extender con ALTER TABLE al retrofitear un módulo nuevo (mismo patrón que la columna tipo de esta tabla).';
COMMENT ON COLUMN public.autorizaciones.asignado_a IS
  'Reasignación puntual (E1 del relevamiento de Supervisor): a qué usuario quedó dirigida esta solicitud. NULL = cualquier usuario con permiso supervisa en el módulo puede tomarla.';

-- ── Redefinir las 2 únicas funciones que referencian la tabla por nombre en su cuerpo plpgsql ──────
-- (RENAME TABLE no actualiza el texto de una función — el catálogo solo trackea dependencias vía
-- pg_depend para objetos con árbol de parseo persistido como las VIEW, no para el texto de una
-- función; sin este paso ambas fallarían en la próxima ejecución con "relation does not exist").

-- 1) aprobar_cambio_estado_inventario (mig 333, REGLA #0 — única vía sancionada para aplicar un
--    cambio de estado que pasó por aprobación real). Idéntica salvo el nombre de tabla.
CREATE OR REPLACE FUNCTION public.aprobar_cambio_estado_inventario(p_autorizacion_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_aut       public.autorizaciones;
  v_rol       text := public.get_user_role();
  v_tenant    uuid := public.get_user_tenant_id();
  v_estado_id uuid;
  v_linea_ids uuid[];
  v_count     integer;
BEGIN
  IF v_rol IS DISTINCT FROM 'DUEÑO' AND v_rol IS DISTINCT FROM 'SUPERVISOR'
     AND v_rol IS DISTINCT FROM 'SUPER_USUARIO' AND v_rol IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'No autorizado: aprobar un cambio de estado requiere rol DUEÑO/SUPERVISOR/SUPER_USUARIO.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_aut FROM public.autorizaciones
    WHERE id = p_autorizacion_id AND tenant_id = v_tenant
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Autorización no encontrada.';
  END IF;
  IF v_aut.tipo <> 'cambio_estado' THEN
    RAISE EXCEPTION 'Esta función solo aplica autorizaciones de tipo cambio_estado (recibido: %).', v_aut.tipo;
  END IF;
  IF v_aut.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Esta autorización ya fue % — no se puede volver a aplicar.', v_aut.estado;
  END IF;

  v_estado_id := NULLIF(v_aut.datos_cambio->>'estado_nuevo_id', '')::uuid;
  IF v_estado_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.estados_inventario WHERE id = v_estado_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'El estado destino no pertenece a este negocio.';
  END IF;
  IF v_aut.datos_cambio ? 'linea_ids' THEN
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_aut.datos_cambio->'linea_ids'))::uuid[]
      INTO v_linea_ids;
  END IF;

  -- Marca la transacción para que el guard de fn_inventario_estado_aprobacion_guard() deje pasar el UPDATE de abajo.
  PERFORM set_config('genesis360.aprobando_estado_inventario', 'on', true);

  IF v_linea_ids IS NOT NULL AND array_length(v_linea_ids, 1) > 0 THEN
    UPDATE public.inventario_lineas SET estado_id = v_estado_id
      WHERE id = ANY(v_linea_ids) AND tenant_id = v_tenant;
  ELSE
    UPDATE public.inventario_lineas SET estado_id = v_estado_id
      WHERE id = v_aut.linea_id AND tenant_id = v_tenant;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.autorizaciones
    SET estado = 'aprobada', aprobado_por = auth.uid()
    WHERE id = p_autorizacion_id;

  RETURN v_count;
END $function$;

COMMENT ON FUNCTION public.aprobar_cambio_estado_inventario(uuid) IS
  'Única vía sancionada para aplicar un cambio de estado_id que quedó pendiente de aprobación (Fase B backlog Fede, mig 331). SECURITY DEFINER: valida rol aprobador + tenant, aplica el estado_id real y marca la autorización aprobada, todo atómico. Redefinida en mig 347 solo por el rename de autorizaciones_inventario → autorizaciones, lógica idéntica.';

-- 2) fn_evaluar_repricing_margen (mig 346, D3 — sweep de repricing). Idéntica salvo nombre de tabla
--    y el nuevo campo modulo obligatorio en el INSERT.
CREATE OR REPLACE FUNCTION public.fn_evaluar_repricing_margen(p_tenant_id uuid)
RETURNS TABLE (producto_id uuid, accion text, precio_anterior numeric, precio_nuevo numeric)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  v_modo text; v_tope_pct numeric; v_umbral_aviso numeric; v_desde_monto numeric;
  v_sugerido numeric; v_diferencia numeric; v_maximo_variacion numeric; v_final numeric;
  v_aplicar_directo boolean;
BEGIN
  SELECT repricing_modo, repricing_tope_pct, repricing_umbral_aviso_monto, repricing_automatico_desde_monto
    INTO v_modo, v_tope_pct, v_umbral_aviso, v_desde_monto
  FROM tenants WHERE id = p_tenant_id;
  IF v_modo IS NULL THEN RETURN; END IF;

  FOR rec IN
    SELECT p.id, p.nombre, p.precio_venta, p.precio_costo, p.margen_objetivo, p.alicuota_iva
    FROM productos p
    WHERE p.tenant_id = p_tenant_id AND p.activo = true
      AND p.reajuste_margen_auto = true AND p.margen_objetivo IS NOT NULL AND p.precio_costo IS NOT NULL
      AND p.precio_venta IS NOT NULL
  LOOP
    v_sugerido := fn_precio_para_margen(rec.precio_costo, rec.margen_objetivo, rec.alicuota_iva);
    IF v_sugerido IS NULL OR v_sugerido = rec.precio_venta THEN CONTINUE; END IF;

    -- Todo-o-nada por producto: si ya hay una sugerencia pendiente de aprobar para este producto, no
    -- duplicar en cada corrida del sweep (cada 6hs) — se resuelve la que ya existe primero.
    IF EXISTS (
      SELECT 1 FROM autorizaciones
      WHERE tenant_id = p_tenant_id AND tipo = 'repricing_margen' AND estado = 'pendiente'
        AND (datos_cambio->>'producto_id')::uuid = rec.id
    ) THEN CONTINUE; END IF;

    v_diferencia := abs(v_sugerido - rec.precio_venta);

    v_aplicar_directo := (v_modo = 'automatico')
      OR (v_modo = 'automatico_desde_monto' AND v_diferencia >= COALESCE(v_desde_monto, 0));

    IF v_aplicar_directo THEN
      -- B5: tope de suba — el ajuste automático nunca mueve el precio más de X% de una sola vez.
      v_final := v_sugerido;
      IF v_tope_pct IS NOT NULL THEN
        v_maximo_variacion := rec.precio_venta * v_tope_pct / 100;
        IF v_final > rec.precio_venta + v_maximo_variacion THEN v_final := rec.precio_venta + v_maximo_variacion; END IF;
        IF v_final < rec.precio_venta - v_maximo_variacion THEN v_final := rec.precio_venta - v_maximo_variacion; END IF;
        v_final := ROUND(v_final, 2);
      END IF;
      IF v_final = rec.precio_venta THEN CONTINUE; END IF;

      UPDATE productos SET precio_venta = v_final WHERE id = rec.id;

      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      SELECT p_tenant_id, u.id, 'repricing_aplicado',
             'Precio ajustado automáticamente por margen objetivo',
             rec.nombre || ': $' || rec.precio_venta || ' → $' || v_final || ' (margen objetivo ' || rec.margen_objetivo || '%).',
             '/productos/' || rec.id || '/editar'
      FROM users u WHERE u.tenant_id = p_tenant_id AND u.rol IN ('DUEÑO','SUPERVISOR','SUPER_USUARIO') AND u.activo = true;

      producto_id := rec.id; accion := 'aplicado'; precio_anterior := rec.precio_venta; precio_nuevo := v_final;
      RETURN NEXT;
    ELSE
      INSERT INTO autorizaciones (tenant_id, modulo, tipo, datos_cambio, estado, solicitado_por, notas)
      VALUES (p_tenant_id, 'inventario', 'repricing_margen',
              jsonb_build_object('producto_id', rec.id, 'producto_nombre', rec.nombre,
                                  'precio_anterior', rec.precio_venta, 'precio_nuevo', v_sugerido,
                                  'margen_objetivo', rec.margen_objetivo),
              'pendiente', NULL,
              'Sugerido por el sweep de repricing automático (margen objetivo)');

      IF v_diferencia >= COALESCE(v_umbral_aviso, 0) THEN
        INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
        SELECT p_tenant_id, u.id, 'repricing_sugerido',
               'Sugerencia de ajuste de precio por margen objetivo',
               rec.nombre || ': $' || rec.precio_venta || ' → $' || v_sugerido || ' — requiere tu aprobación.',
               '/inventario?tab=autorizaciones'
        FROM users u WHERE u.tenant_id = p_tenant_id AND u.rol IN ('DUEÑO','SUPERVISOR','SUPER_USUARIO') AND u.activo = true;
      END IF;

      producto_id := rec.id; accion := 'pendiente_aprobacion'; precio_anterior := rec.precio_venta; precio_nuevo := v_sugerido;
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$;

COMMENT ON FUNCTION public.fn_evaluar_repricing_margen(uuid) IS
  'D3, mecanismo 1 — sweep de repricing por margen objetivo. Sin auth.uid(): p_tenant_id explícito, invocable con service_role desde un Edge Function con cron. NO otorgar a authenticated (mismo razonamiento que fn_iniciar_armado_kit_auto, mig 345): un tenant_id arbitrario sería cross-tenant si alguna tabla no tuviera RLS bien puesta. Redefinida en mig 347 solo por el rename de autorizaciones_inventario → autorizaciones + modulo obligatorio en el INSERT, lógica idéntica.';

REVOKE ALL ON FUNCTION public.fn_evaluar_repricing_margen(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_evaluar_repricing_margen(uuid) TO service_role;
