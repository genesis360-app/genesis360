-- 336_ubicaciones_defaults_apagados.sql
-- Nuevas ubicaciones deben nacer con TN/MELI/surtido apagados — se activan a demanda.
-- Antes el DEFAULT true exponía la ubicación recién creada a sync de canales online y
-- a picking/venta sin que el usuario lo pidiera. es_devolucion ya nacía en false.
-- Único insert de la app a esta tabla es el alta manual en Configuración/Inventario/
-- Ubicaciones (src/pages/ConfigPage.tsx) — no hay seed de onboarding que dependa de
-- estos defaults, así que el cambio no afecta tenants existentes ni el alta de tenant.
ALTER TABLE ubicaciones ALTER COLUMN disponible_surtido SET DEFAULT false;
ALTER TABLE ubicaciones ALTER COLUMN disponible_tn SET DEFAULT false;
ALTER TABLE ubicaciones ALTER COLUMN disponible_meli SET DEFAULT false;
