import { Link } from 'react-router-dom'
import { LifeBuoy, BookOpen, MessageCircle, FileText, AlertCircle, GraduationCap, MessageSquare } from 'lucide-react'
import { BRAND } from '@/config/brand'

type Seccion = {
  icon: typeof LifeBuoy
  titulo: string
  desc: string
  /** Ruta si la sección ya está disponible; sin ruta, "próximamente". */
  to?: string
}

const secciones: Seccion[] = [
  { icon: AlertCircle,    titulo: 'Reportar un problema',   desc: 'Contanos qué pasa, con una captura si hace falta. Te respondemos acá.', to: '/ayuda/consultas?nueva=1' },
  { icon: MessageSquare,  titulo: 'Mis consultas',          desc: 'Seguí tus consultas con el equipo y respondé desde la app.',            to: '/ayuda/consultas' },
  { icon: BookOpen,       titulo: 'Preguntas frecuentes',   desc: 'Respuestas a las dudas más comunes por módulo.' },
  { icon: MessageCircle,  titulo: 'Chat de soporte',        desc: 'Contacto directo con el equipo de ' + BRAND.name + '.' },
  { icon: FileText,       titulo: 'Buenas prácticas',       desc: 'Guías de uso recomendado para sacar el máximo provecho.' },
  { icon: GraduationCap,  titulo: 'Cursos y recursos',      desc: 'Videos, documentación y materiales de aprendizaje.' },
]

export default function AyudaPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <LifeBuoy size={32} className="text-accent-text" />
          Centro de Soporte
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Todo lo que necesitás para sacar el máximo de {BRAND.name}.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {secciones.map(({ icon: Icon, titulo, desc, to }) => {
          const contenido = (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                <Icon size={18} className="text-accent-text" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{titulo}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{desc}</p>
              </div>
            </div>
          )
          return to ? (
            <Link
              key={titulo}
              to={to}
              className="block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:border-accent-text hover:shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
            >
              {contenido}
            </Link>
          ) : (
            <div key={titulo} className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 opacity-70 cursor-not-allowed">
              {contenido}
              <span className="absolute top-3 right-3 text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                próximamente
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-8 p-5 bg-accent/5 border border-accent-text/20 rounded-xl">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          ¿Necesitás ayuda urgente? Escribinos a{' '}
          <a href={`mailto:soporte@genesis360.pro`} className="text-accent-text font-medium hover:underline">
            soporte@genesis360.pro
          </a>
        </p>
      </div>
    </div>
  )
}
