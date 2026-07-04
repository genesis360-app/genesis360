import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PLANES, BRAND } from '@/config/brand'
import { packsDe, precioMensualAddonsFijos, type AddonDimension, type AddonRow } from '@/lib/addons'
import { Check, Box, Building2, User, Shield, Rocket, Headphones, Lock, type LucideIcon } from 'lucide-react'

// Configurador de precios PÚBLICO (Landing) — Pricing 2026, Fase 4.
// Solo estima: plan base + add-ons FIJOS (recurrentes) → total mensual en vivo.
// Los movimientos extra (add-on temporal) se muestran aparte porque son pago único.
// Reusa el catálogo y la suma de src/lib/addons.ts (mismo precio que cobra el server).
//
// Diseño "Armá tu plan": panel oscuro + degradé de marca violeta→cian (mismos tokens
// que el resto de la app: .bg-accent / --color-accent / --color-accent-2).

const DIMS: Array<{ dim: AddonDimension; label: string; unidad: string; sub: string; Icon: LucideIcon }> = [
  { dim: 'sku',        label: 'Productos',  unidad: 'productos',  sub: 'Sumá más productos a tu plan',  Icon: Box },
  { dim: 'sucursales', label: 'Sucursales', unidad: 'sucursales', sub: 'Sumá más sucursales a tu plan', Icon: Building2 },
  { dim: 'usuarios',   label: 'Usuarios',   unidad: 'usuarios',   sub: 'Sumá más usuarios a tu plan',   Icon: User },
]

const BENEFICIOS: Array<{ Icon: LucideIcon; titulo: string; sub: string }> = [
  { Icon: Shield,     titulo: '7 días gratis',        sub: 'Sin tarjeta de crédito' },
  { Icon: Rocket,     titulo: 'Activación inmediata', sub: 'Comenzá a usarlo hoy' },
  { Icon: Headphones, titulo: 'Soporte cercano',      sub: 'Siempre estamos para ayudarte' },
  { Icon: Lock,       titulo: 'Tus datos seguros',    sub: 'Encriptados y respaldados' },
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
    <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b14] p-6 sm:p-10 md:p-14 shadow-2xl">
      {/* Glow de marca (violeta) detrás del encabezado */}
      <div className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-accent opacity-25 blur-[110px]" />

      {/* Encabezado */}
      <div className="relative text-center">
        <img src={BRAND.logo} alt={BRAND.name} className="mx-auto h-12 w-12 mb-4" />
        <h3 className="text-3xl font-bold text-white">Armá tu plan</h3>
        <p className="mt-2 text-sm text-gray-400">Elegí el plan que mejor se adapta a tu negocio y sumá los add-ons que necesités.</p>
      </div>

      {/* Toggle de plan base */}
      <div className="relative mt-7 flex justify-center">
        <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
          {planes.map(p => (
            <button key={p.id} onClick={() => setPlanId(p.id)}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all
                ${planId === p.id ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'text-gray-300 hover:text-white'}`}>
              {p.nombre} · ${(p.precio ?? 0).toLocaleString('es-AR')}
            </button>
          ))}
        </div>
      </div>

      <div className="relative my-8 border-t border-white/10" />

      <p className="relative text-center text-sm font-semibold text-white mb-5">Personalizá tu plan con add-ons</p>

      {/* Add-ons fijos por dimensión */}
      <div className="relative grid gap-4 md:grid-cols-3">
        {DIMS.map(({ dim, label, unidad, sub, Icon }) => (
          <div key={dim} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/40 bg-accent/10">
                <Icon size={20} className="text-accent" />
              </div>
              <div>
                <p className="font-semibold text-white leading-tight">{label}</p>
                <p className="text-xs text-gray-400 leading-tight">{sub}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {packsDe(dim).map(pack => {
                const activo = sel[dim] === pack.cantidad
                return (
                  <button key={pack.cantidad} onClick={() => setPack(dim, pack.cantidad)}
                    className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition-all
                      ${activo
                        ? 'border-transparent bg-accent text-white shadow-lg shadow-accent/30'
                        : 'border-white/10 bg-white/[0.02] text-gray-300 hover:border-accent/60'}`}>
                    {activo && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-accent shadow">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                    <Icon size={18} className={activo ? 'text-white/90' : 'text-gray-500'} />
                    <span className={`text-[11px] leading-tight ${activo ? 'text-white' : 'text-gray-300'}`}>
                      +{pack.cantidad.toLocaleString('es-AR')} {unidad}
                    </span>
                    <span className="text-sm font-bold">${pack.precio.toLocaleString('es-AR')}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Total + CTA */}
      <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-gray-400">Plan {plan.nombre} (${base.toLocaleString('es-AR')}) + add-ons (${precioAddons.toLocaleString('es-AR')})</p>
          <p className="text-4xl font-bold text-white">
            ${total.toLocaleString('es-AR')}<span className="text-base font-medium text-gray-500">/mes</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">¿Necesitás más movimientos puntuales? Se compran por 30 días desde la app.</p>
        </div>
        <Link to="/onboarding"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition-all hover:opacity-90 shrink-0">
          <Check size={18} /> Probar 7 días gratis
        </Link>
      </div>

      {/* Beneficios */}
      <div className="relative mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {BENEFICIOS.map(({ Icon, titulo, sub }) => (
          <div key={titulo} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/10">
              <Icon size={18} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white leading-tight">{titulo}</p>
              <p className="text-xs text-gray-400 leading-tight truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
