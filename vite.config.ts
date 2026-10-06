import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import wasm from 'vite-plugin-wasm'

// Identificador del build (revisión de app.html en el service worker, ver workbox abajo).
const BUILD_ID = Date.now().toString(36)

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'favicon-16x16.png', 'favicon-32x32.png'],
      manifest: {
        name: 'Genesis360',
        short_name: 'Genesis360',
        description: 'El cerebro del negocio físico',
        theme_color: '#7B00FF',
        background_color: '#F5F0FF',
        display: 'standalone',
        icons: [
          { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'android-chrome-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Pre-render (scripts/prerender.mjs, corre después de este build): dist/index.html pasa a ser la landing armada
        // para buscadores y el armazón de la app se copia a app.html. El service worker tiene que servir app.html en
        // cualquier navegación, nunca la landing; app.html se escribe después, por eso va como entrada adicional con una
        // revisión nueva en cada build.
        globIgnores: ['index.html'],
        navigateFallback: '/app.html',
        additionalManifestEntries: [{ url: '/app.html', revision: BUILD_ID }],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // scripts/prerender.mjs lee el manifest para enlazar en el <head> el CSS de cada página pre-renderizada (si no, el HTML
  // estático llega sin sus estilos hasta que baja todo el JavaScript) y después lo borra de dist.
  build: { manifest: true },
})
