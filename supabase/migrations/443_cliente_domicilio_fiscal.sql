-- 443 — Domicilio fiscal / comercial del cliente (receptor del comprobante)
--
-- Contador de El Tilo (2026-09-30): la Factura A debe llevar el domicilio comercial del RECEPTOR (normativa).
-- Hasta ahora el único domicilio del cliente era la lista de `cliente_domicilios` (pensada para envíos, escondida en
-- la fila expandida del cliente) y la factura imprimía el "principal". Decisión de GO: un campo propio, en los datos
-- fiscales del cliente, separado de los domicilios de entrega.
--
-- La factura usa `domicilio_fiscal`; si está vacío, cae al domicilio principal (clientes ya cargados así siguen
-- saliendo igual). La Factura A se BLOQUEA sin ninguno de los dos (POS + EF `emitir-factura`).
--
-- Aditiva e idempotente. Los permisos de `clientes` son a nivel tabla → la columna nueva los hereda; RLS no cambia.

ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS domicilio_fiscal text;

COMMENT ON COLUMN public.clientes.domicilio_fiscal IS
  'Domicilio fiscal/comercial del cliente como receptor del comprobante (obligatorio en Factura A). Distinto de cliente_domicilios (entregas).';
