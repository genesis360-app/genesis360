-- 270: Multi-CUIT — wizard de certificado self-service (generación de key + CSR).
--
-- El .crt de AFIP NO se puede emitir desatendido (ARCA exige clave fiscal del contribuyente),
-- pero SÍ podemos generar por él la clave privada (.key) y el CSR (el pedido con el CUIT). El
-- wizard (EF generar-csr) genera el par, guarda la .key en el bucket certificados-afip y deja
-- acá el path para poder APAREARLA con el .crt cuando el cliente lo suba (puede pasar días entre
-- generar el CSR y volver con el .crt de ARCA → el path debe sobrevivir recargas/sesiones).
--
-- La .key en sí NUNCA se guarda en la DB (solo en el bucket, service_role-only, igual que hoy);
-- esta columna es solo el PUNTERO al archivo pendiente. Se limpia al finalizar el certificado.

ALTER TABLE emisores_fiscales ADD COLUMN IF NOT EXISTS csr_key_path text;

COMMENT ON COLUMN emisores_fiscales.csr_key_path IS
  'Path en el bucket certificados-afip de la .key generada por el wizard (EF generar-csr), pendiente de aparear con el .crt que baje el cliente de ARCA. NULL una vez finalizado el certificado.';
