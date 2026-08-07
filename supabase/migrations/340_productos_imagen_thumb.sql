-- 340 — Thumbnail de imagen de producto (baja Cached Egress de Supabase Storage)
-- Productos/Inventario/Ventas mostraban la imagen COMPLETA (hasta 1200px/1.5MB, sin resize) como
-- ícono de 32-36px o card de galería — cada vista de lista/POS volvía a bajar el archivo entero.
-- Columna nueva, opcional: el frontend genera un thumbnail chico al subir la imagen y lo guarda acá;
-- los listados usan `imagen_thumb_url` con fallback a `imagen_url` (productos ya existentes sin
-- thumbnail siguen funcionando, solo sin la optimización hasta que se re-suba la imagen).

ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS imagen_thumb_url text;
