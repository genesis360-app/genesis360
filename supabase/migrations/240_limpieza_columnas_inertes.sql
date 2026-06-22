-- 240 — Limpieza de columnas inertes de `tenants` (decisión GO)
-- Columnas sin lector ni escritor real (verificado: 0 referencias en frontend, edge functions,
-- funciones/triggers de DB). Se quitaron del frontend en H4 (v1.82.0) y nunca tuvieron efecto:
--   · descuento_max_cajero_pct — el CAJERO está SIEMPRE bloqueado de descuentos (regla C3/G3); el flag era ilusorio.
--   · email_legal — `tenants.email` ya cubre comprobantes y correos salientes; sin caso de uso.
--   · recepcion_alerta_faltante_dias — nunca se leyó ni escribió.
-- DROP idempotente. No afecta datos operativos.

ALTER TABLE public.tenants DROP COLUMN IF EXISTS descuento_max_cajero_pct;
ALTER TABLE public.tenants DROP COLUMN IF EXISTS email_legal;
ALTER TABLE public.tenants DROP COLUMN IF EXISTS recepcion_alerta_faltante_dias;
