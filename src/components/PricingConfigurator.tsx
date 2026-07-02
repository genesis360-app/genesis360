import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PLANES } from '@/config/brand'
import { packsDe, precioMensualAddonsFijos, type AddonDimension, type AddonRow } from '@/lib/addons'
import { Check, Sparkles } from 'lucide-react'

// Configurador de precios PÚBLICO (Landing) — Pricing 2026, Fase 4.
// Solo estima: plan base + add-ons FIJOS (recurrentes) → total mensual en vivo.
// Los movimientos extra (add-on temporal) se muestran aparte porque son pago único.
// Reusa el catálogo y la suma de src/lib/addons.ts (mismo precio que cobra el server).

const DIMS: Array<{ dim: AddonDimension; label: string; unidad: string }> = [
  { dim: 'sku',        label: 'Productos', unidad: 'productos' },
  { dim: 'sucursales', label: 'Sucursales', unidad: 'sucursales' },
  { dim: 'usuarios',   label: 'Usuarios', unidad: 'usuarios' },
]

export default function PricingConfigurator() {
  const planes = PLANES.filter(p => p.id === 'basico' || p.id === 'pro')
  const [planId, setPlanId] = useState('pro')
  const [sel, setSel] = useState<Record<string, number>>({})  // dimension → cantidad elegida (0 = ninguno)

  const plan = planes.find(p => p.id === planId) ?? planes[0]
  const base = plan.precio ?? 0

  const addonsFijos: AddonRow[] = Object.entries(sel)
    .filter(([, cant]) => cant > 0)
    .map(([dim, cant]) => ({ dimension: dim as AddonDimension, cantidad: cant, tipo: 'fijo' }))
  const precioAddons = precioMensualAddonsFijos(addonsFijos)
  const total = base + precioAddons

  const setPack = (dim: string, cant: number) =>
    setSel(prev => ({ ...prev, [dim]: prev[dim] === cant ? 0 : cant }))

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-2xl border-2 border-gray-100 shadow-sm p-6 md:p-8">
      <div className="flex items-center justify-center gap-2 mb-1">
        <Sparkles size={18} className="text-accent" />
        <h3 className="font-bold text-primary text-xl">Armá tu plan</h3>
      </div>
      <p className="text-gray-500 text-sm text-center mb-6">Estimá tu precio mensual sumando lo que necesites.</p>

      {/* Plan base */}
      <div className="flex justify-center gap-2 mb-6">
        {planes.map(p => (
          <button key={p.id} onClick={() => setPlanId(p.id)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold border-2 transition-all
              ${planId === p.id ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {p.nombre} · ${(p.precio ?? 0).toLocaleString('es-AR')}
          </button>
        ))}
      </div>

      {/* Add-ons fijos por dimensión */}
      <div className="space-y-4">
        {DIMS.map(({ dim, label, unidad }) => (
          <div key={dim} className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm font-semibold text-gray-700 w-28 shrink-0">+ {label}</span>
            <div className="flex flex-wrap gap-2">
              {packsDe(dim).map(pack => (
                <button key={pack.cantidad} onClick={() => setPack(dim, pack.cantidad)}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors
                    ${sel[dim] === pack.cantidad
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-gray-200 text-gray-600 hover:border-accent'}`}>
                  +{pack.cantidad.toLocaleString('es-AR')} {unidad} · ${pack.precio.toLocaleString('es-AR')}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="mt-6 pt-5 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-gray-500 text-xs">Plan {plan.nombre} (${base.toLocaleString('es-AR')}) + add-ons (${precioAddons.toLocaleString('es-AR')})</p>
          <p className="text-3xl font-bold text-primary">
            ${total.toLocaleString('es-AR')}<span className="text-base text-gray-400 font-medium">/mes</span>
          </p>
          <p className="text-gray-400 text-xs mt-1">¿Necesitás más movimientos puntuales? Se compran por 30 días desde la app.</p>
        </div>
        <Link to="/onboarding"
          className="inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-accent transition-all text-sm shrink-0">
          <Check size={16} /> Probar 7 días gratis
        </Link>
      </div>
    </div>
  )
}
