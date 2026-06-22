-- 239 — Caja preferida POR USUARIO (persistencia server-side)
-- Hasta ahora la "caja predeterminada" vivía solo en localStorage (por dispositivo) → se perdía al
-- cambiar de equipo/navegador o al actualizar la PWA, y por eso "no aparecía" la auto-selección.
-- Se persiste por usuario en la DB para que SIEMPRE auto-seleccione su caja en todos los selectores
-- (POS, Caja, traspasos). Aditivo y nullable → seguro. ON DELETE SET NULL: si se borra la caja, queda sin preferida.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS caja_preferida_id uuid REFERENCES public.cajas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.users.caja_preferida_id IS
  'Caja predeterminada del usuario: se auto-selecciona en POS/Caja/traspasos. NULL = sin preferida.';
