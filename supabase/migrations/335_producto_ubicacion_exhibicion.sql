-- ============================================================
-- 335_producto_ubicacion_exhibicion.sql
-- FASE U2 del rediseño de Ubicaciones (relevamiento 2026-08-02, respuestas de Fede+GO
-- 2026-08-05, sección C — ubicación única y obligatoria de exhibición por SKU).
--
-- ── Columna NUEVA, no se reinterpreta la que ya existe ──────────────────────────────────
-- El relevamiento (C1) pedía reusar producto_ubicacion_sucursal, dejando a criterio técnico
-- si conviene. La columna actual `ubicacion_id` es hoy un DEFAULT de PUTAWAY (dónde guardar
-- al recibir, cualquier tipo de ubicación) leído por 3 pantallas (ProductoFormPage,
-- InventarioPage/resolverUbicacionDefault, RecepcionesPage) — nunca obligatorio, nunca
-- ligado a exhibición. La ubicación de EXHIBICIÓN (dónde el cliente ve/busca el producto,
-- que Repositores va a necesitar) es una pregunta de negocio distinta que puede
-- legítimamente responderse distinto (ej. el default de recepción es un estante de
-- depósito, la exhibición es una góndola distinta) — pisar `ubicacion_id` con ese segundo
-- significado rompería el uso actual de los 3 archivos que ya la leen. Se reusa la TABLA
-- (no se crea una nueva), se agrega una columna.
--
-- C2 (¿apunta a la contenedora o a un nivel específico?) queda resuelto sin columna extra:
-- es "configurable" por construcción, porque ubicacion_exhibicion_id es un FK plano a
-- ubicaciones.id — con el árbol de la mig 334, esa fila puede ser tanto una contenedora
-- (padre_ubicacion_id NULL) como un nivel específico, según qué tan preciso quiera ser cada
-- usuario. No hace falta modelar los dos casos por separado.
--
-- Sin obligatoriedad a nivel DB: "obligatorio para productos de Góndola" es una regla de
-- negocio CONDICIONAL (solo aplica si el producto se vende por exhibición), no un NOT NULL
-- de la tabla — queda para un guard de UI/RPC en la fase que construya el flujo de
-- Repositores, no bloqueante acá.
-- ============================================================

ALTER TABLE producto_ubicacion_sucursal
  ADD COLUMN IF NOT EXISTS ubicacion_exhibicion_id uuid REFERENCES ubicaciones(id) ON DELETE SET NULL;

COMMENT ON COLUMN producto_ubicacion_sucursal.ubicacion_exhibicion_id IS
  'Ubicación de EXHIBICIÓN del SKU en esta sucursal (mig 335, relevamiento Ubicaciones sección C) — de cara al cliente, la usa Repositores. Distinta de ubicacion_id (default de PUTAWAY al recibir, sin relación con exhibición). Puede apuntar a una contenedora o a un nivel específico del árbol (mig 334) — configurable por el usuario, sin obligatoriedad a nivel DB (la obligatoriedad para productos de Góndola es una regla condicional de UI/RPC, no de esquema).';
