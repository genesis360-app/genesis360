-- 333 — Guard server-side para el cambio de estado con foto/aprobación (Fase B, mig 331).
--
-- Hallazgo H1 (Regla de Oro #0, sesión 2026-08-03 — spec-extractor + revisión manual antes de
-- escribir los e2e de Fase B): el control anti-fraude de la mig 331 vivía 100% en el cliente
-- (LpnAccionesModal.tsx / InventarioPage.tsx) — un PATCH directo por REST a
-- inventario_lineas.estado_id se saltaba foto + autorización + notificación, la MISMA clase de
-- bypass que esta fase ya había cerrado para el cambio masivo, pero ahora a nivel API en vez de
-- nivel botón de la UI. Avisado a GO, que pidió agregar el guard ahora (no diferirlo).
--
-- Server-side mirror de `requiereAuthAjuste` (src/lib/ajusteAutorizacion.ts, mig 228): un UPDATE
-- que mueve inventario_lineas.estado_id hacia un estado con requiere_aprobacion=true se BLOQUEA
-- salvo que:
--   (a) el modo resuelto para el rol del actor (tenants.ajuste_autorizacion_roles) sea 'directo'
--       (DUEÑO por default) — replica el bypass intencional confirmado con GO (hallazgo H2,
--       2026-08-03): el DUEÑO no se autoaprueba un control que él mismo configuró, mismo criterio
--       que ya rige el gate de CANTIDAD (mig 228); o
--   (b) la escritura viene del RPC sancionado `aprobar_cambio_estado_inventario` de abajo, que
--       marca la transacción con un GUC local antes de aplicar un cambio que ya pasó por
--       aprobación real.
--
-- El GUC (`genesis360.aprobando_estado_inventario`) es transaction-local (`set_config(..., true)`)
-- y no es alcanzable por un cliente REST — PostgREST no expone `SET` a llamadas HTTP, solo permite
-- invocar funciones. Mismo patrón de "única vía sancionada" que ya usa `pagar_nomina_empleado`
-- (mig 242), adaptado con GUC porque `estado_id` es una columna de uso general (se escribe desde
-- muchos flujos legítimos no relacionados a este control), a diferencia de `rrhh_salarios.pagado`.

CREATE OR REPLACE FUNCTION public.fn_inventario_estado_aprobacion_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_requiere_aprobacion boolean;
  v_rol    text;
  v_config jsonb;
  v_modo   text;
BEGIN
  IF NEW.estado_id IS DISTINCT FROM OLD.estado_id AND NEW.estado_id IS NOT NULL THEN
    SELECT requiere_aprobacion INTO v_requiere_aprobacion
      FROM public.estados_inventario WHERE id = NEW.estado_id AND tenant_id = NEW.tenant_id;

    IF COALESCE(v_requiere_aprobacion, false) THEN
      -- Exención (b): la escritura viene del RPC de aprobación sancionado, o de un proceso
      -- automatizado ya auditado (Aging — ver process_aging_profile_single/process_aging_profiles).
      IF current_setting('genesis360.aprobando_estado_inventario', true) = 'on' THEN
        RETURN NEW;
      END IF;

      -- Exención (a): modo 'directo' o 'umbral' para el rol del actor — mirror fiel de
      -- requiereAuthAjuste(rol, config, false): el frontend SIEMPRE llama con umbralRequiere=false
      -- para cambio_estado (no hay "monto" contra el cual comparar un umbral), así que solo el modo
      -- 'siempre' bloquea. Default DUEÑO='directo' si no hay override explícito en el tenant.
      v_rol := public.get_user_role();
      SELECT ajuste_autorizacion_roles INTO v_config
        FROM public.tenants WHERE id = NEW.tenant_id;
      v_modo := NULLIF(v_config->>COALESCE(v_rol, ''), '');
      IF v_modo IS NULL THEN
        v_modo := CASE WHEN v_rol = 'DUEÑO' THEN 'directo' ELSE 'siempre' END;
      END IF;

      IF v_modo = 'siempre' THEN
        RAISE EXCEPTION 'Este cambio de estado requiere aprobación (foto + supervisor) — usá el flujo de Autorizaciones (Inventario → tab Autorizaciones).'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_inventario_estado_aprobacion_guard ON public.inventario_lineas;
CREATE TRIGGER trg_inventario_estado_aprobacion_guard
  BEFORE UPDATE ON public.inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_estado_aprobacion_guard();

COMMENT ON FUNCTION public.fn_inventario_estado_aprobacion_guard() IS
  'Guard server-side (Regla de Oro #0, hallazgo H1 2026-08-03): bloquea cualquier UPDATE de '
  'inventario_lineas.estado_id hacia un estado con requiere_aprobacion=true, salvo que el rol del '
  'actor esté en modo directo (ajuste_autorizacion_roles) o la escritura venga del RPC '
  'aprobar_cambio_estado_inventario.';

-- RPC sancionado: única vía server-side para aplicar un cambio de estado que quedó pendiente de
-- aprobación. Reemplaza el 2-pasos client-side que hacía `aprobarAutorizacion` en
-- InventarioPage.tsx (update directo de estado_id + update de autorizaciones_inventario.estado),
-- ahora atómico y con el rol del aprobador validado en el servidor (no solo en la UI de la tab
-- Autorizaciones).
CREATE OR REPLACE FUNCTION public.aprobar_cambio_estado_inventario(p_autorizacion_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_aut       public.autorizaciones_inventario;
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

  SELECT * INTO v_aut FROM public.autorizaciones_inventario
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

  -- Marca la transacción para que el guard de arriba deje pasar el UPDATE de abajo.
  PERFORM set_config('genesis360.aprobando_estado_inventario', 'on', true);

  IF v_linea_ids IS NOT NULL AND array_length(v_linea_ids, 1) > 0 THEN
    UPDATE public.inventario_lineas SET estado_id = v_estado_id
      WHERE id = ANY(v_linea_ids) AND tenant_id = v_tenant;
  ELSE
    UPDATE public.inventario_lineas SET estado_id = v_estado_id
      WHERE id = v_aut.linea_id AND tenant_id = v_tenant;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.autorizaciones_inventario
    SET estado = 'aprobada', aprobado_por = auth.uid()
    WHERE id = p_autorizacion_id;

  RETURN v_count;
END $function$;

GRANT EXECUTE ON FUNCTION public.aprobar_cambio_estado_inventario(uuid) TO authenticated;

COMMENT ON FUNCTION public.aprobar_cambio_estado_inventario(uuid) IS
  'Única vía sancionada para aplicar un cambio de estado_id que quedó pendiente de aprobación '
  '(Fase B backlog Fede, mig 331). SECURITY DEFINER: valida rol aprobador + tenant, aplica el '
  'estado_id real (single vía linea_id o batch vía datos_cambio.linea_ids) y marca la autorización '
  'aprobada, todo atómico. Cierra el hallazgo H1 (2026-08-03).';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Exención de Aging (hallazgo del migration-reviewer, bloqueante #2): `process_aging_profile_single`
-- / `process_aging_profiles` (migs 013/106) escriben `inventario_lineas.estado_id` directo, en un
-- loop sin manejo de excepción por fila — si el guard de arriba las frenara en cuanto un tenant
-- mapee una regla de aging hacia un estado `requiere_aprobacion=true`, TODA la corrida de Aging
-- abortaría (ninguna línea se actualizaría, ni las no afectadas por el gate).
--
-- Se las trata como una vía ya controlada/auditada (dejan su propio registro en `actividad_log`,
-- accion 'cambio_estado'/'cambio_estado_auto'), igual que el RPC de aprobación manual — el
-- vencimiento por fecha es una regla determinística que el empleado no puede manipular en el
-- momento (a diferencia de reclasificar un LPN a mano), así que no es el vector de fraude que la
-- Fase B busca cerrar. Único cambio real vs. la versión previa (`schema_full.sql`): una línea
-- `PERFORM set_config(...)` antes de cada `UPDATE inventario_lineas`, el resto es textual idéntico.

CREATE OR REPLACE FUNCTION public.process_aging_profile_single(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_tenant    UUID;
  v_linea            RECORD;
  v_estado_nuevo     UUID;
  v_estado_ant       TEXT;
  v_estado_nuevo_nom TEXT;
  v_cambios          INT := 0;
  v_dias             INT;
BEGIN
  SELECT tenant_id INTO v_target_tenant FROM users WHERE id = auth.uid();
  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aging_profiles WHERE id = p_profile_id AND tenant_id = v_target_tenant) THEN
    RETURN jsonb_build_object('error', 'Perfil no encontrado', 'cambios', 0);
  END IF;
  FOR v_linea IN
    SELECT il.id, il.estado_id, il.fecha_vencimiento, il.tenant_id, il.producto_id, p.aging_profile_id, p.nombre AS prod_nombre
    FROM inventario_lineas il
    JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id = p_profile_id AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;
    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = p_profile_id AND apr.dias >= v_dias
    ORDER BY apr.dias ASC LIMIT 1;
    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nom FROM estados_inventario WHERE id = v_estado_nuevo;
      PERFORM set_config('genesis360.aprobando_estado_inventario', 'on', true);
      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;
      INSERT INTO actividad_log (tenant_id, entidad, entidad_id, entidad_nombre, accion, campo, valor_anterior, valor_nuevo, pagina)
      VALUES (v_linea.tenant_id, 'inventario_linea', v_linea.id, v_linea.prod_nombre, 'cambio_estado', 'estado', COALESCE(v_estado_ant, 'sin estado'), v_estado_nuevo_nom, 'aging_profile_single');
      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('cambios', v_cambios, 'profile_id', p_profile_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_aging_profiles(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_tenant UUID;
  v_linea         RECORD;
  v_estado_nuevo  UUID;
  v_estado_ant    TEXT;
  v_estado_nuevo_nombre TEXT;
  v_cambios       INT := 0;
  v_dias          INT;
BEGIN
  IF p_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_target_tenant FROM users WHERE id = auth.uid();
  ELSE
    v_target_tenant := p_tenant_id;
  END IF;

  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
  END IF;

  FOR v_linea IN
    SELECT
      il.id,
      il.estado_id,
      il.fecha_vencimiento,
      il.tenant_id,
      il.producto_id,
      p.aging_profile_id,
      p.nombre AS prod_nombre
    FROM inventario_lineas il
    JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE
      AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id IS NOT NULL
      AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;

    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = v_linea.aging_profile_id
      AND apr.dias >= v_dias
    ORDER BY apr.dias ASC
    LIMIT 1;

    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant        FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nombre FROM estados_inventario WHERE id = v_estado_nuevo;

      PERFORM set_config('genesis360.aprobando_estado_inventario', 'on', true);
      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;

      INSERT INTO actividad_log (
        tenant_id, usuario_id, usuario_nombre,
        entidad, entidad_id, entidad_nombre,
        accion, campo, valor_anterior, valor_nuevo, pagina
      ) VALUES (
        v_linea.tenant_id,
        NULL, 'Sistema (Aging)',
        'inventario_linea', v_linea.id::TEXT, v_linea.prod_nombre,
        'cambio_estado_auto',
        'estado',
        COALESCE(v_estado_ant, 'Sin estado'),
        COALESCE(v_estado_nuevo_nombre, 'Sin estado'),
        '/aging-auto'
      );

      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'cambios', v_cambios,
    'tenant_id', v_target_tenant,
    'procesado_en', NOW()
  );
END;
$function$;

COMMENT ON FUNCTION public.process_aging_profile_single(uuid) IS
  'Aplica las reglas de un perfil de Aging a las líneas activas del tenant del caller. Exenta del '
  'guard de aprobación de estado (mig 333) — vencimiento por fecha es determinístico, no un vector '
  'de fraude manual.';
COMMENT ON FUNCTION public.process_aging_profiles(uuid) IS
  'Aplica Aging a todas las líneas del tenant (o de p_tenant_id, uso batch/cron). Exenta del guard '
  'de aprobación de estado (mig 333) — mismo criterio que process_aging_profile_single.';
