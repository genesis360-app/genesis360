/**
 * Escapa texto para interpolarlo dentro de HTML.
 *
 * Por qué existe (auditoría de seguridad 2026-09-20): las pantallas de impresión de etiquetas
 * y QR arman su HTML con `win.document.write(\`...\`)` interpolando nombre de producto, SKU y
 * LPN que vienen de la base. `window.open('')` crea un `about:blank` que **hereda el origin de
 * la app**, así que un `<script>` inyectado en uno de esos campos correría con acceso al
 * `localStorage` donde vive la sesión de Supabase.
 *
 * Y esos nombres no son todos de gente de confianza del propio negocio: entran por el
 * importador de CSV y por la sincronización desde MercadoLibre / TiendaNube.
 */
export function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
