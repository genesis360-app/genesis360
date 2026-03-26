import { Link } from 'react-router-dom'
import { Lock, ArrowRight, Zap } from 'lucide-react'
import { PLANES, PLAN_REQUERIDO } from '@/config/brand'

interface UpgradePromptProps {
  feature: keyof typeof PLAN_REQUERIDO
  titulo?: string
  descripcion?: string
}

export function UpgradePrompt({ feature, titulo, descripcion }: UpgradePromptProps) {
  const planId = PLAN_REQUERIDO[feature] ?? 'basico'
  const plan = PLANES.find(p => p.id === planId)
  const planNombre = plan?.nombre ?? 'superior'

  const defaultTitulos: Record<string, string> = {
    reportes:   'Reportes disponibles en plan Básico',
    historial:  'Historial de actividad disponible en plan Básico',
    metricas:   'Métricas avanzadas disponibles en plan Básico',
    importar:   'Importación masiva disponible en plan Pro',
    rrhh:       'Módulo RRHH disponible en plan Pro',
    aging:      'Aging profiles disponible en plan Pro',
    marketplace: 'Marketplace disponible en plan Pro',
  }

  const defaultDescripciones: Record<string, string> = {
    reportes:   'Generá reportes de stock, movimientos, ventas y más en Excel o PDF.',
    historial:  'Auditá cada acción realizada en tu negocio con el historial completo.',
    metricas:   'Analizá tendencias, márgenes, rotación y el rendimiento de tu negocio.',
    importar:   'Importá cientos de productos desde un archivo CSV o Excel en segundos.',
    rrhh:       'Gestioná empleados, nómina, vacaciones y asistencia de tu equipo.',
    aging:      'Automatizá el cambio de estados según días de permanencia en stock.',
    marketplace: 'Publicá tus productos en marketplaces externos y sincronizá el stock.',
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-accent/10 rounded-2xl mb-4">
          <Lock size={28} className="text-accent" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
          {titulo ?? defaultTitulos[feature] ?? `Disponible en plan ${planNombre}`}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
          {descripcion ?? defaultDescripciones[feature] ?? `Esta función requiere el plan ${planNombre} o superior.`}
        </p>
        <div className="bg-accent/5 dark:bg-accent/10 rounded-xl p-4 mb-6 text-left">
          <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Zap size={12} /> Plan {planNombre}
          </p>
          {plan && plan.features.slice(0, 4).map(f => (
            <p key={f} className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2 mb-1">
              <span className="text-green-500">✓</span> {f}
            </p>
          ))}
        </div>
        <Link
          to="/suscripcion"
          className="flex items-center justify-center gap-2 w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all text-sm"
        >
          <ArrowRight size={16} /> Ver planes y mejorar
        </Link>
      </div>
    </div>
  )
}
