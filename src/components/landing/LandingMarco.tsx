// Menú, cierre y pie compartidos por la landing y las páginas por rubro (/para/…). En la home los anclas apuntan a la misma
// página (#funciones); en las demás, a la home (/#funciones), que llega pre-renderizada.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu } from 'lucide-react'
import { BRAND } from '@/config/brand'

const SECCIONES = [
  { ancla: 'funciones', label: 'Funciones' },
  { ancla: 'ia', label: 'Inteligencia artificial' },
  { ancla: 'precios', label: 'Precios' },
  { ancla: 'faq', label: 'Preguntas' },
]

export function LandingNav({ enHome = false }: { enHome?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const href = (ancla: string) => (enHome ? `#${ancla}` : `/#${ancla}`)
  return (
    <nav className="sticky top-0 z-50 bg-[#FAFAFC]/85 backdrop-blur-md border-b border-zinc-200/70">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <a href={enHome ? '#' : '/'} className="flex items-center gap-2" aria-label={`${BRAND.name}, inicio`}>
          <img src={BRAND.logo} alt="" className="w-8 h-8 rounded-lg object-contain" />
          <span className="font-semibold text-xl tracking-tight">{BRAND.name}</span>
        </a>

        <div className="hidden md:flex items-center gap-7 text-sm text-zinc-600">
          {SECCIONES.map(s => (
            <a key={s.ancla} href={href(s.ancla)} className="hover:text-[#0D0D0D] transition-colors">{s.label}</a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-zinc-600 hover:text-[#0D0D0D] transition-colors px-4 py-2">
            Ingresar
          </Link>
          <Link to="/onboarding" className="lp-cta text-sm font-semibold text-white px-5 py-2.5 rounded-xl">
            Probar gratis
          </Link>
        </div>

        <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menú" aria-expanded={menuOpen} className="md:hidden text-zinc-700 p-1">
          <Menu size={22} />
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-zinc-100 bg-white px-4 py-4 space-y-3">
          {SECCIONES.map(s => (
            <a key={s.ancla} href={href(s.ancla)} onClick={() => setMenuOpen(false)} className="block text-zinc-700 py-1">{s.label}</a>
          ))}
          <hr className="border-zinc-100" />
          <Link to="/login" className="block text-zinc-600 py-1">Ingresar</Link>
          <Link to="/onboarding" className="lp-cta block w-full text-center text-white font-semibold py-2.5 rounded-xl">
            Probar gratis
          </Link>
        </div>
      )}
    </nav>
  )
}

/** Cierre de cada página: el mismo CTA del hero, con la misma fuerza (doc 01 §12, doc 04 §3.5). */
export function LandingCierre({ titulo = 'Vendé, cobrá y sabé qué te queda.' }: { titulo?: string }) {
  return (
    <section className="lp-night">
      <div className="max-w-6xl mx-auto px-4 py-28 md:py-36">
        <h2 className="text-[2.4rem] leading-[1.04] sm:text-6xl font-semibold tracking-[-0.035em] text-white max-w-[16ch]">
          {titulo}
        </h2>
        <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-5">
          <Link to="/onboarding" className="lp-cta inline-flex w-fit items-center gap-2 rounded-xl px-7 py-4 text-lg font-semibold text-white">
            Probalo 30 días gratis <ArrowRight size={20} />
          </Link>
          <span className="text-white/60">Sin tarjeta. Sin instalar nada.</span>
        </div>
      </div>
    </section>
  )
}

export function LandingPie({ enHome = false }: { enHome?: boolean }) {
  const href = (ancla: string) => (enHome ? `#${ancla}` : `/#${ancla}`)
  return (
    <footer className="bg-[#0E0B16] border-t border-white/10 text-white/60 py-10">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={BRAND.logo} alt={BRAND.name} className="w-7 h-7 rounded-lg object-contain" />
            <span className="font-semibold text-white tracking-tight">{BRAND.name}</span>
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <a href={href('funciones')} className="hover:text-white transition-colors">Funciones</a>
            <a href={href('precios')} className="hover:text-white transition-colors">Precios</a>
            <a href={href('faq')} className="hover:text-white transition-colors">Preguntas</a>
            <Link to="/para/construccion" className="hover:text-white transition-colors">Construcción</Link>
            <Link to="/terminos" className="hover:text-white transition-colors">Términos</Link>
            <Link to="/privacidad" className="hover:text-white transition-colors">Privacidad</Link>
            <Link to="/cookies" className="hover:text-white transition-colors">Cookies</Link>
            <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Defensa del Consumidor</a>
            <a href={`mailto:${BRAND.email}`} className="hover:text-white transition-colors">Contacto</a>
          </div>
          {/* El año puede diferir entre el build (pre-render) y la visita: se acepta el del servidor. */}
          <p className="text-xs text-white/45" suppressHydrationWarning>© {new Date().getFullYear()} {BRAND.name}. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  )
}
