-- 487 — Caja: un usuario restringido a su sucursal solo ESCRIBE en cajas de su sucursal (REGLA #0, contable)
--
-- Decisión de GO (2026-10-08): quien ve todas las sucursales puede cambiar de sucursal con la caja abierta (antes la
-- pantalla lo bloqueaba, punto L4 del relevamiento de Caja); a cambio, el POS y las demás pantallas ofrecen solo las
-- cajas de la sucursal activa, y la base lo respalda.
--
-- Hueco que cierra: `sesiones_tenant` y `mov_caja_tenant` filtraban la LECTURA por sucursal (USING), pero el WITH CHECK
-- solo pedía el tenant → un usuario restringido a la sucursal A podía insertar un movimiento en la sesión de una caja de
-- la sucursal B (o abrir/actualizar esa sesión) con un sesion_id conocido. Ahora el WITH CHECK repite la condición del
-- USING. Quien ve todas (DUEÑO, SUPERVISOR/SUPER_USUARIO/VIEWER salvo puede_ver_todas = false, o puede_ver_todas = true)
-- no cambia; las sesiones sin sucursal (Caja Fuerte / Bóveda) tampoco.
--
-- Verificado antes de aplicar (DEV y PROD): 0 sesiones abiertas de usuarios restringidos en otra sucursal.
-- Las funciones SECURITY DEFINER y las EFs con service_role no pasan por RLS: sin cambios.

ALTER POLICY sesiones_tenant ON public.caja_sesiones
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal())
  );

ALTER POLICY mov_caja_tenant ON public.caja_movimientos
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (
      auth_ve_todas_sucursales()
      OR sesion_id IS NULL
      OR EXISTS (
        SELECT 1 FROM caja_sesiones s
        WHERE s.id = caja_movimientos.sesion_id
          AND (s.sucursal_id IS NULL OR s.sucursal_id = auth_user_sucursal())
      )
    )
  );
