import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { BRAND, LEGAL_VERSION } from '@/config/brand'

// Layout común de las páginas legales públicas (/terminos, /privacidad).
// Prosa legible sobre fondo claro; header con logo + volver al inicio; pie con contacto.
export default function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={BRAND.logo} alt={BRAND.name} className="w-8 h-8 object-contain" />
            <span className="font-bold text-gray-800 dark:text-gray-100">{BRAND.name}</span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline">
            <ArrowLeft size={16} /> Volver al inicio
          </Link>
        </div>
      </header>

      {/* Contenido */}
      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 sm:p-10">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-50">{title}</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2 mb-8">
            Última actualización: {LEGAL_VERSION}
          </p>
          <div className="legal-prose space-y-5 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {children}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 mt-8 text-sm">
          <Link to="/terminos" className="text-gray-500 dark:text-gray-400 hover:text-accent-text">Términos y Condiciones</Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <Link to="/privacidad" className="text-gray-500 dark:text-gray-400 hover:text-accent-text">Política de Privacidad</Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <Link to="/cookies" className="text-gray-500 dark:text-gray-400 hover:text-accent-text">Cookies</Link>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor" target="_blank" rel="noopener noreferrer" className="text-gray-500 dark:text-gray-400 hover:text-accent-text">Defensa del Consumidor</a>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <a href={`mailto:${BRAND.email}`} className="text-gray-500 dark:text-gray-400 hover:text-accent-text">Contacto</a>
        </div>
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-4">
          © {new Date().getFullYear()} {BRAND.name}. Todos los derechos reservados.
        </p>
      </main>
    </div>
  )
}

// Encabezado de sección reutilizable dentro de la prosa legal.
export function LegalSection({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mt-6 mb-2">{n}. {title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}
