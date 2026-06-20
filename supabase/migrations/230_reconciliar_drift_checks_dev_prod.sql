-- Migration 230: reconciliar el DRIFT de CHECK constraints DEV↔PROD (auditoría de paridad)
-- Tras el bug de caja_movimientos (mig 229) se comparó pg_constraint DEV vs PROD: PROD tenía 99
-- CHECKs y DEV 94 → 5 constraints existían en PROD y NO en DEV (los tests en DEV no los veían).
-- Dos eran LANDMINES (rompían en PROD para un usuario real):
--   1. ventas_estado_check: a PROD le faltaba 'devuelta' → una DEVOLUCIÓN total rompía en PROD.
--   2. notificaciones_tipo_check: solo permitía info/warning/danger/success, pero la app usa
--      claves de EVENTO (diferencia_apertura_caja, diferencia_cierre_caja, …) → abrir/cerrar caja
--      con diferencia rompía en PROD.
-- Esta migración deja DEV == PROD con la definición correcta (cierra PAR-01 del plan uat-primer-uso).
-- Idempotente (DROP IF EXISTS + ADD); los datos existentes en ambos pasan.

-- 1) ventas.estado — set completo (la app usa: pendiente/reservada/despachada/facturada/cancelada/devuelta)
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_estado_check;
ALTER TABLE ventas ADD CONSTRAINT ventas_estado_check
  CHECK (estado = ANY (ARRAY['pendiente','reservada','despachada','facturada','cancelada','devuelta']));

-- 2) notificaciones.tipo es una CLAVE DE EVENTO, no un enum → eliminar el CHECK viejo (DEV no lo tenía)
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;

-- 3) caja_sesiones.estado — agregar el CHECK que faltaba en DEV (PROD ya lo tenía, correcto)
ALTER TABLE caja_sesiones DROP CONSTRAINT IF EXISTS caja_sesiones_estado_check;
ALTER TABLE caja_sesiones ADD CONSTRAINT caja_sesiones_estado_check
  CHECK (estado = ANY (ARRAY['abierta','cerrada']));

-- 4) motivos_movimiento.tipo — agregar el CHECK que faltaba en DEV (PROD ya lo tenía, correcto)
ALTER TABLE motivos_movimiento DROP CONSTRAINT IF EXISTS motivos_movimiento_tipo_check;
ALTER TABLE motivos_movimiento ADD CONSTRAINT motivos_movimiento_tipo_check
  CHECK (tipo = ANY (ARRAY['ingreso','rebaje','ambos','caja']));

-- 5) inventario_lineas_cantidad_check — redundante con chk_cantidad_no_negativa (que está en ambos) → eliminar
ALTER TABLE inventario_lineas DROP CONSTRAINT IF EXISTS inventario_lineas_cantidad_check;
