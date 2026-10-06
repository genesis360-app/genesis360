// Hidrata la página pública pre-renderizada que vino en el HTML (ver src/lib/prerender.ts). El árbol tiene que ser el mismo
// que arma src/entry-prerender.tsx (router + página, nada más): si difiere, React descarta el HTML y lo vuelve a dibujar.
import { useEffect, useRef } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { quitarPrerender, registrarRaizPrerender } from '@/lib/prerender'

const PAGINAS: Record<string, () => Promise<{ default: () => JSX.Element }>> = {
  '/': () => import('@/pages/LandingPage'),
  '/para/construccion': () => import('@/pages/ParaConstruccionPage'),
  '/para/supermercados': () => import('@/pages/ParaRubroPage'),
  '/para/distribuidoras': () => import('@/pages/ParaRubroPage'),
  '/para/dieteticas': () => import('@/pages/ParaRubroPage'),
  '/terminos': () => import('@/pages/TerminosPage'),
  '/privacidad': () => import('@/pages/PrivacidadPage'),
  '/cookies': () => import('@/pages/CookiesPage'),
}

/** Si el visitante navega a otra ruta desde la página pública, se la pasa a App y se saca la versión hidratada. */
function SalidaHaciaApp() {
  const { pathname } = useLocation()
  const inicial = useRef(pathname)
  useEffect(() => {
    if (pathname === inicial.current) return
    // Primero se saca la versión hidratada: si App se enterara antes, una ruta pública pre-renderizada (/terminos…) vería
    // todavía #prerender y se dibujaría vacía (SinPrerender en App.tsx).
    quitarPrerender()
    // App tiene su propio BrowserRouter: se entera del cambio de URL con un popstate.
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  }, [pathname])
  return null
}

export async function hidratarPaginaPublica(contenedor: HTMLElement) {
  const cargar = PAGINAS[window.location.pathname]
  if (!cargar) return quitarPrerender() // el servidor devolvió una página pública en otra ruta: que la maneje App
  const { default: Pagina } = await cargar()
  if (!document.getElementById('prerender')) return // App ya la sacó (sesión iniciada) mientras bajaba el chunk
  const raiz = hydrateRoot(
    contenedor,
    <BrowserRouter>
      <Pagina />
      <SalidaHaciaApp />
    </BrowserRouter>,
  )
  registrarRaizPrerender(raiz)
}
