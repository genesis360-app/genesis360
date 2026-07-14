import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './index.css'

// ── Actualización FORZADA del service worker ─────────────────────────────────────
// Gotcha real (reference_pwa_cache_post_deploy + caso Fede 2026-07-04): con el registro
// inyectado por defecto, la PWA solo chequea updates al cargar la página → una pestaña/
// PWA abierta se queda con la versión vieja indefinidamente (Fede pagó con el frontend
// viejo y el checkout-return nunca corrió). Con registerType 'autoUpdate', cuando un
// chequeo encuentra SW nuevo se activa y recarga solo. Acá agregamos los chequeos que
// faltaban: cada 30 min + cada vez que la app vuelve a foco (el momento típico en que
// un usuario retoma una PWA dormida con versión vieja).
const SW_CHECK_MS = 30 * 60 * 1000
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const check = () => registration.update().catch(() => { /* offline/transitorio */ })
    setInterval(check, SW_CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

// ⚖️ Sin Session Replay (decisión GO 2026-07-13): NO grabamos la sesión/pantalla del
// usuario. Sentry queda solo para errores + rendimiento (browser tracing), sin capturar
// contenido personal — así el tracking se limita a lo funcional y no requiere banner de
// consentimiento (ver /cookies). No re-agregar `replayIntegration` sin actualizar la
// Política de Cookies + Privacidad y sumar el mecanismo de consentimiento.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
})

// Recuperación ante chunk viejo tras un deploy: cuando el usuario tiene una pestaña
// abierta con un index.html viejo y navega a una ruta lazy cuyo chunk ya no existe
// (hash cambiado por un deploy nuevo), el import dinámico falla. Antes esto dejaba la
// página en un estado roto (parecía "entrar y salir"). Recargamos UNA vez (guardado en
// sessionStorage para no entrar en bucle de recargas si el fallo es real/persistente).
const CHUNK_RELOAD_KEY = 'chunk-reload-attempt'
function handleChunkError() {
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  window.location.reload()
}
// Vite emite este evento cuando falla el preload de un módulo dinámico.
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); handleChunkError() })
// Red de seguridad: errores de carga de chunk que no pasan por vite:preloadError.
window.addEventListener('error', (e) => {
  const msg = String((e as ErrorEvent)?.message ?? '')
  if (/dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch dynamically/i.test(msg)) {
    handleChunkError()
  }
})
// Si la app cargó bien, limpiamos el flag para permitir una futura recuperación.
window.addEventListener('load', () => { setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_KEY), 4000) })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
