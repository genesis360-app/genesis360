-- Migration 152: ISS-178 — Rangos horarios de entrega configurables por tenant
--
-- Permite que el operador en VentasPage elija un rango horario predefinido
-- (ej: 8-13, 13-18, 18-22) para la entrega del envío, en lugar de tipear
-- una hora exacta. Los rangos se configuran en Config → Envíos.
--
-- Modelo:
--   tenants.envio_rangos_horarios JSONB
--     Array de objetos {desde:"HH:MM", hasta:"HH:MM"} ordenados.
--     Default seedeado con los 3 rangos típicos (mañana / tarde / noche).
--
--   envios.rango_horario_desde / rango_horario_hasta TIME
--     Snapshot al momento del envío. Si después se borra el rango de la
--     configuración, el envío conserva intacto el rango acordado.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS envio_rangos_horarios JSONB
  NOT NULL
  DEFAULT '[
    {"desde":"08:00","hasta":"13:00"},
    {"desde":"13:00","hasta":"18:00"},
    {"desde":"18:00","hasta":"22:00"}
  ]'::jsonb;

ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS rango_horario_desde TIME,
  ADD COLUMN IF NOT EXISTS rango_horario_hasta TIME;

COMMENT ON COLUMN tenants.envio_rangos_horarios IS
  'ISS-178: rangos horarios disponibles para la entrega. Array JSONB de {desde,hasta}. Configurables en Config → Envíos.';
COMMENT ON COLUMN envios.rango_horario_desde IS
  'ISS-178: snapshot del inicio del rango horario acordado para la entrega.';
COMMENT ON COLUMN envios.rango_horario_hasta IS
  'ISS-178: snapshot del fin del rango horario acordado para la entrega.';
