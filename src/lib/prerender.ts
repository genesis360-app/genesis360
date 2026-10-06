// Pre-render de las páginas públicas (Landing 2.0, Fase 1 SEO/GEO — scripts/prerender.mjs, src/entry-prerender.tsx).
//
// El HTML que llega del servidor trae la página ya armada en <div id="prerender"> (lo que leen Google y los buscadores con
// IA, sin JavaScript) y el <div id="root"> de App escondido por CSS (`#prerender + #root`).
//
// En el navegador, src/lib/hidratarPublica.tsx HIDRATA solo esa página en #prerender (React toma el HTML que ya está en
// pantalla, no lo vuelve a dibujar: sin parpadeo y sin un segundo "pintado más grande" que arruine el LCP). App se monta
// aparte en #root, escondida, y no dibuja la página pública mientras exista #prerender. Cuando el visitante sale de la
// página pública (un Link a /onboarding, /login…), o cuando App decide no mostrarla (sesión iniciada, dominio de la app),
// se llama a quitarPrerender(): se desmonta la raíz hidratada, se borra #prerender y aparece #root con App.
// No se hidrata App directo porque muestra un spinner mientras valida la sesión: su primer render nunca coincide.
import type { Root } from 'react-dom/client'

/** Rutas que scripts/prerender.mjs escribe como HTML propio (src/entry-prerender.tsx). */
export const RUTAS_PRERENDER = ['/', '/para/construccion', '/terminos', '/privacidad', '/cookies']

let raiz: Root | null = null

export function registrarRaizPrerender(r: Root) {
  raiz = r
}

/** true mientras la página pública pre-renderizada (hidratada) está en pantalla. */
export function hayPrerender() {
  return typeof document !== 'undefined' && !!document.getElementById('prerender')
}

export function quitarPrerender() {
  if (typeof document === 'undefined') return
  const pre = document.getElementById('prerender')
  if (!pre) return
  // Desmontar fuera del render/effect en curso (React no permite desmontar una raíz mientras está renderizando).
  const r = raiz
  raiz = null
  pre.remove()
  if (r) setTimeout(() => r.unmount(), 0)
}
