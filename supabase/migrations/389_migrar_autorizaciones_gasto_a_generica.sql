-- 389: C1 del relevamiento de Supervisión (Fede 2026-08-20) — migrar `autorizaciones_gasto`
-- (tabla separada, propia de Gastos desde v1.8.43) a la tabla genérica `autorizaciones`
-- (modulo='gastos'), consolidando en un solo lugar todas las colas de aprobación del proyecto.
--
-- A diferencia de Clientes/Envíos/Proveedores/Pedidos/RRHH (Nivel 1, "modelo genérico estándar"
-- con permiso `supervisa` fijo), Gastos usa un modelo de APROBACIÓN POR JERARQUÍA DE ROL
-- (CAJERO → aprueba SUPERVISOR/DUEÑO/ADMIN; SUPERVISOR → aprueba DUEÑO/ADMIN — `puedeAprobar()` en
-- `src/lib/umbralGasto.ts`), completamente distinto del permiso `supervisa` — NO se migra a
-- `useSupervisorAutorizaciones`/`SupervisionPanel` (esos asumen el modelo de permiso fijo). Gastos
-- conserva sus componentes propios (`SolicitarAutorizacionGastoModal.tsx`,
-- `BandejaAutorizacionesGasto.tsx`, ya con su propio tab "Autorizaciones" dentro de GastosPage)
-- — solo cambia la TABLA que usan, de `autorizaciones_gasto` a `autorizaciones`.
--
-- Sin datos que migrar: `autorizaciones_gasto` tiene 0 filas en DEV al momento de esta migración
-- (verificado). Los campos específicos de gasto (monto, descripcion, payload, sucursal_id,
-- gasto_id, solicitante_rol) pasan a vivir dentro de `datos_cambio` jsonb — mismo criterio ya
-- usado para Clientes/Envíos/Proveedores/Pedidos/RRHH. `motivo`→`notas` y `motivo_rechazo` ya
-- existen como columnas de primer nivel en `autorizaciones`, se reusan tal cual.
-- `aprobador_rol`/`resolved_at` no hacen falta como columnas propias: el rol del aprobador se
-- puede leer en vivo desde el JOIN a `users` (aprobado_por), y `updated_at` (ya tiene trigger)
-- cumple el rol de `resolved_at` porque una fila de autorizacion solo se actualiza una vez, al
-- resolverse.

ALTER TABLE public.autorizaciones DROP CONSTRAINT IF EXISTS autorizaciones_modulo_check;
ALTER TABLE public.autorizaciones ADD CONSTRAINT autorizaciones_modulo_check
  CHECK (modulo = ANY (ARRAY[
    'inventario'::text, 'productos'::text, 'ventas'::text, 'clientes'::text,
    'envios'::text, 'proveedores'::text, 'pedidos'::text, 'rrhh'::text, 'gastos'::text
  ]));

DROP TABLE IF EXISTS public.autorizaciones_gasto;
