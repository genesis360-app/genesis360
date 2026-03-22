import { Link } from 'react-router-dom'
import { X, TrendingUp, Users, Package } from 'lucide-react'
import type { PlanLimits } from '@/hooks/usePlanLimits'

interface Props {
  tipo: 'usuario' | 'producto'
  limits: PlanLimits
  onClose: () => void
}

export function PlanLimitModal({ tipo, limits, onClose }: Props) {
  const esUsuario = tipo === 'usuario'
  const actual = esUsuario ? limits.usuarios_actuales : limits.productos_actuales
  const maximo = esUsuario ? limits.max_usuarios : limits.max_productos
  const pct = esUsuario ? limits.pct_usuarios : limits.pct_productos
  const Icon = esUsuario ? Users : Package

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
            <Icon size={20} className="text-orange-600" />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <h2 className="text-lg font-bold text-gray-800 mb-1">
          Límite de {esUsuario ? 'usuarios' : 'productos'} alcanzado
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Tu plan actual permite hasta <strong>{maximo === 999 ? 'ilimitados' : maximo}</strong> {esUsuario ? 'usuarios' : 'productos'}.
          Ya tenés <strong>{actual}</strong> activos.
        </p>

        {/* Barra de progreso */}
        <div className="mb-5">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{actual} usados</span>
            <span>{maximo === 999 ? '∞' : maximo} máximo</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Link
            to="/suscripcion"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all text-sm"
          >
            <TrendingUp size={16} /> Ver planes disponibles
          </Link>
          <button
            onClick={onClose}
            className="w-full border-2 border-gray-200 text-gray-600 font-semibold py-2.5 rounded-xl hover:border-gray-300 transition-all text-sm"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
