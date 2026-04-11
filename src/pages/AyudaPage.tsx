import { LifeBuoy, BookOpen, MessageCircle, FileText, AlertCircle, GraduationCap } from 'lucide-react'
import { BRAND } from '@/config/brand'

const secciones = [
  { icon: BookOpen,       titulo: 'Preguntas frecuentes',   desc: 'Respuestas a las dudas más comunes por módulo.',           estado: 'próximamente' },
  { icon: MessageCircle,  titulo: 'Chat de soporte',         desc: 'Contacto directo con el equipo de ' + BRAND.name + '.',    estado: 'próximamente' },
  { icon: FileText,       titulo: 'Buenas prácticas',        desc: 'Guías de uso recomendado para sacar el máximo provecho.', estado: 'próximamente' },
  { icon: AlertCircle,    titulo: 'Reportar un problema',    desc: 'Enviar un ticket con descripción, urgencia y adjunto.',   estado: 'próximamente' },
  { icon: BookOpen,       titulo: 'Guías interactivas',      desc: 'Tutoriales paso a paso para cada flujo principal.',       estado: 'próximamente' },
  { icon: GraduationCap,  titulo: 'Cursos y recursos',       desc: 'Videos, documentación y materiales de aprendizaje.',      estado: 'próximamente' },
]

export default function AyudaPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <LifeBuoy size={32} className="text-accent" />
          Centro de Soporte
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Todo lo que necesitás para sacar el máximo de {BRAND.name}.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {secciones.map(({ icon: Icon, titulo, desc, estado }) => (
          <div key={titulo} className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 opacity-70 cursor-not-allowed">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                <Icon size={18} className="text-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{titulo}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{desc}</p>
              </div>
            </div>
            <span className="absolute top-3 right-3 text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
              {estado}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8 p-5 bg-accent/5 border border-accent/20 rounded-xl">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          ¿Necesitás ayuda urgente? Escribinos a{' '}
          <a href={`mailto:soporte@genesis360.pro`} className="text-accent font-medium hover:underline">
            soporte@genesis360.pro
          </a>
        </p>
      </div>
    </div>
  )
}
