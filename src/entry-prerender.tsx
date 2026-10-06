// Entrada de servidor SOLO para el pre-render del build (scripts/prerender.mjs): renderiza las páginas públicas a HTML
// para que Google y los buscadores con IA lean el contenido sin ejecutar JavaScript (Landing 2.0, Fase 1, doc 03 de Fede).
// No participa del bundle del navegador. Si se agrega una página acá, sumarla también a RUTAS_PRERENDER (src/lib/prerender.ts). Importa las páginas directo (no por App: App depende de la sesión y de window).
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import LandingPage from '@/pages/LandingPage'
import TerminosPage from '@/pages/TerminosPage'
import PrivacidadPage from '@/pages/PrivacidadPage'
import CookiesPage from '@/pages/CookiesPage'
import ParaConstruccionPage from '@/pages/ParaConstruccionPage'
import { metaHome, metaConstruccion, META_LEGALES, SITIO_URL, type MetaPagina } from '@/components/landing/contenido'

const PAGINAS: { meta: MetaPagina; Componente: () => JSX.Element }[] = [
  { meta: metaHome(), Componente: LandingPage },
  { meta: metaConstruccion(), Componente: ParaConstruccionPage },
  { meta: META_LEGALES[0], Componente: TerminosPage },
  { meta: META_LEGALES[1], Componente: PrivacidadPage },
  { meta: META_LEGALES[2], Componente: CookiesPage },
]

export { SITIO_URL }

export function renderizar() {
  return PAGINAS.map(({ meta, Componente }) => ({
    meta,
    html: renderToString(
      <StaticRouter location={meta.ruta}>
        <Componente />
      </StaticRouter>,
    ),
  }))
}
