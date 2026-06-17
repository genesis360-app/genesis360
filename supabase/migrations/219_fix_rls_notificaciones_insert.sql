-- migration 219: fix RLS de `notificaciones` — permitir INSERT cross-user dentro del MISMO tenant
--
-- CONTEXTO (auditoría UAT modo básico, pase 3 §27):
-- La campana (tabla `notificaciones`) recibe avisos generados por OTROS usuarios, no por el
-- destinatario. Todos los inserts client-side apuntan a user_id != auth.uid():
--   · solicitud de transferencia a Caja Fuerte   (cajero → supervisores)   CajaPage.tsx:1116
--   · diferencia de apertura/cierre de caja       (cajero → supervisores)   CajaPage.tsx:605 / :798
--   · alertas de ventas: margen negativo,
--     cliente/producto con muchas devoluciones    (vendedor → DUEÑO/SUPERVISOR/ADMIN) VentasPage.tsx:240
--
-- Estado roto previo a este fix (PROD y DEV DESINCRONIZADOS, ambos rotos):
--   · PROD: policy `notif_user` FOR ALL USING (user_id = auth.uid()). Como no define WITH CHECK,
--           PostgreSQL usa el USING como WITH CHECK del INSERT → toda fila con user_id != auth.uid()
--           es RECHAZADA → las notificaciones cross-user nunca se crean.
--   · DEV : `notif_select` + `notif_update` (aplicadas fuera de banda, no están en el repo) y
--           NINGUNA policy de INSERT → con RLS activa, TODO insert client-side es rechazado.
-- Consecuencia: las notificaciones in-app nunca llegan; la de Caja Fuerte además hace
-- `if (error) throw error` y ABORTA la solicitud del cajero (flujo de plata bloqueado).
--
-- FIX: normalizar ambos entornos a un set explícito por comando:
--   · SELECT / UPDATE / DELETE → solo las PROPIAS (aislamiento NOT-04 intacto: nadie lee ajenas).
--   · INSERT → cualquier usuario autenticado puede crear notificaciones para usuarios de SU MISMO
--     tenant (así el sistema avisa a supervisores/dueño de eventos generados por un cajero).
-- Idempotente: dropea cualquier variante previa antes de recrear.

DROP POLICY IF EXISTS notif_user   ON notificaciones;
DROP POLICY IF EXISTS notif_select ON notificaciones;
DROP POLICY IF EXISTS notif_update ON notificaciones;
DROP POLICY IF EXISTS notif_delete ON notificaciones;
DROP POLICY IF EXISTS notif_insert ON notificaciones;

-- Lectura: cada usuario ve SOLO sus notificaciones.
CREATE POLICY notif_select ON notificaciones
  FOR SELECT USING (user_id = auth.uid());

-- Marcar leída: solo las propias (no se puede reasignar a otro usuario).
CREATE POLICY notif_update ON notificaciones
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Borrar: solo las propias.
CREATE POLICY notif_delete ON notificaciones
  FOR DELETE USING (user_id = auth.uid());

-- Alta: cualquier usuario autenticado puede crear notificaciones para usuarios de su MISMO tenant.
-- get_user_tenant_id() es STABLE SECURITY DEFINER (search_path=public) y devuelve el tenant del caller.
CREATE POLICY notif_insert ON notificaciones
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
