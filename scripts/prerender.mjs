// Pre-render de las páginas públicas — corre DESPUÉS de `vite build` (npm run build). Landing 2.0, Fase 1 (SEO/GEO).
//
// 1. dist/index.html (el armazón de la SPA) pasa a dist/app.html con `noindex`: es lo que reciben TODAS las rutas de la app
//    (vercel.json reescribe a /app.html y el service worker lo usa de fallback, ver vite.config.ts).
// 2. Cada página pública (src/entry-prerender.tsx) se renderiza a HTML y se escribe en su ruta (dist/index.html para "/",
//    dist/terminos/index.html…) con título, descripción, canonical, Open Graph y datos estructurados. Vercel sirve primero
//    el archivo real y recién después aplica la reescritura, así que esas rutas llegan con el contenido completo.
// 3. Genera sitemap.xml con esas rutas.
//
// Verificación: `curl -sL https://www.genesis360.pro/ | grep "Vendé, cobrá"` tiene que encontrar el titular SIN JavaScript.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(raiz, 'dist')
const distSsr = path.join(raiz, 'node_modules', '.prerender-ssr')

const plantilla = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
if (!plantilla.includes('<div id="root"></div>')) {
  throw new Error('prerender: dist/index.html no tiene <div id="root"></div> — ¿ya se corrió el pre-render sobre este build?')
}

// 1 — armazón de la app, fuera del índice de buscadores.
fs.writeFileSync(
  path.join(dist, 'app.html'),
  plantilla.replace('</title>', '</title>\n    <meta name="robots" content="noindex" />'),
)

// 2 — build de servidor de la entrada de pre-render (sin el plugin de PWA: no tiene que tocar el service worker).
await build({
  configFile: false,
  root: raiz,
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@': path.join(raiz, 'src') } },
  build: {
    ssr: path.join(raiz, 'src', 'entry-prerender.tsx'),
    outDir: distSsr,
    emptyOutDir: true,
    rollupOptions: { output: { format: 'esm', entryFileNames: 'entry-prerender.mjs' } },
  },
})
const { renderizar, SITIO_URL } = await import(pathToFileURL(path.join(distSsr, 'entry-prerender.mjs')).href)

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Un JSON-LD dentro de <script> no puede contener "</" (cerraría el tag antes de tiempo).
const jsonLdSeguro = obj => JSON.stringify(obj).replace(/</g, '\\u003c')

// CSS de cada página (lazy en el cliente): sin enlazarlo en el <head>, el HTML estático se pintaría sin la tipografía ni
// los estilos propios de la landing hasta que llegue todo el JavaScript.
const manifiesto = JSON.parse(fs.readFileSync(path.join(dist, '.vite', 'manifest.json'), 'utf8'))
function cssDe(fuente, vistos = new Set()) {
  const e = manifiesto[fuente]
  if (!e || vistos.has(fuente)) return []
  vistos.add(fuente)
  return [...(e.css ?? []), ...(e.imports ?? []).flatMap(i => cssDe(i, vistos))]
}
const CSS_POR_RUTA = {
  '/': cssDe('src/pages/LandingPage.tsx'),
  '/para/construccion': cssDe('src/pages/ParaConstruccionPage.tsx'),
  '/para/supermercados': cssDe('src/pages/ParaRubroPage.tsx'),
  '/para/distribuidoras': cssDe('src/pages/ParaRubroPage.tsx'),
  '/para/dieteticas': cssDe('src/pages/ParaRubroPage.tsx'),
  '/terminos': cssDe('src/pages/TerminosPage.tsx'),
  '/privacidad': cssDe('src/pages/PrivacidadPage.tsx'),
  '/cookies': cssDe('src/pages/CookiesPage.tsx'),
}
if (!CSS_POR_RUTA['/'].length) throw new Error('prerender: no encontré el CSS de LandingPage en el manifest')
// Geist (latin) se precarga en la home: es la tipografía de todo lo que se ve arriba.
const geist = fs.readdirSync(path.join(dist, 'assets')).filter(f => /^geist-latin-wght-normal-.*\.woff2$/.test(f))

const paginas = renderizar()
for (const { meta, html } of paginas) {
  if (!html || html.length < 500) throw new Error(`prerender: ${meta.ruta} salió vacío`)
  const url = SITIO_URL + (meta.ruta === '/' ? '/' : meta.ruta)
  const head = [
    `<title>${esc(meta.titulo)}</title>`,
    `<meta name="description" content="${esc(meta.descripcion)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="es_AR" />`,
    `<meta property="og:site_name" content="Genesis360" />`,
    `<meta property="og:title" content="${esc(meta.titulo)}" />`,
    `<meta property="og:description" content="${esc(meta.descripcion)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITIO_URL}/og-genesis360.jpg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(meta.jsonLd ?? []).map(o => `<script type="application/ld+json">${jsonLdSeguro(o)}</script>`),
    ...(meta.ruta === '/'
      ? [
          `<link rel="preload" as="image" type="image/webp" href="/landing/pos-venta.webp" fetchpriority="high" />`,
          ...geist.map(f => `<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/${f}" />`),
        ]
      : []),
    // El #root de React queda escondido hasta que monta la página y saca esta versión (src/lib/prerender.ts).
    `<style>#prerender + #root { display: none; }</style>`,
  ].join('\n    ')
  // Al final del <head>, DESPUÉS del CSS global: el mismo orden en que el cliente carga el CSS de la página (lazy).
  const cssPagina = (CSS_POR_RUTA[meta.ruta] ?? [])
    .filter(f => !plantilla.includes(f))
    .map(f => `  <link rel="stylesheet" crossorigin href="/${f}" />\n  `)
    .join('')

  const salida = plantilla
    .replace(/<title>[^<]*<\/title>/, head)
    .replace('</head>', `${cssPagina}</head>`)
    // La app bloquea el zoom (maximum-scale=1, evita el zoom automático de iOS en los inputs); en las páginas públicas,
    // que son para leer, se deja hacer zoom (accesibilidad).
    .replace(/,\s*maximum-scale=1(\.0)?/, '')
    // Inter (Google Fonts) no bloquea el primer pintado de las páginas públicas: casi todo usa Geist y lleva display=swap.
    .replace(/<link href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)" rel="stylesheet" \/>/,
      `<link href="$1" rel="stylesheet" media="print" onload="this.media='all'" />`)
    .replace('<div id="root"></div>', `<div id="prerender">${html}</div><div id="root"></div>`)

  const archivo = meta.ruta === '/'
    ? path.join(dist, 'index.html')
    : path.join(dist, meta.ruta.replace(/^\//, ''), 'index.html')
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.writeFileSync(archivo, salida)
  console.log(`prerender: ${meta.ruta} → ${path.relative(raiz, archivo)} (${Math.round(salida.length / 1024)} KB)`)
}

// 3 — sitemap con las páginas públicas.
const hoy = new Date().toISOString().slice(0, 10)
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paginas.map(({ meta }) => `  <url><loc>${SITIO_URL}${meta.ruta === '/' ? '/' : meta.ruta}</loc><lastmod>${hoy}</lastmod><priority>${meta.ruta === '/' ? '1.0' : meta.ruta.startsWith('/para/') ? '0.8' : '0.3'}</priority></url>`).join('\n')}
</urlset>
`
fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap)
fs.rmSync(distSsr, { recursive: true, force: true })
fs.rmSync(path.join(dist, '.vite'), { recursive: true, force: true })
console.log(`prerender: sitemap.xml con ${paginas.length} URLs`)
