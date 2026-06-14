import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import './index.css'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
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
