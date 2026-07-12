import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PLANES, BRAND } from '@/config/brand'
import { packsDe, precioMensualAddonsFijos, type AddonDimension, type AddonRow } from '@/lib/addons'
import { calcularBatch, esUpgradeDePlan, type PackSel } from '@/lib/mpAddonBatch'
import { Check, Box, Building2, User, FileText, Shield, Rocket, Headphones, Lock, RefreshCw, Zap, Landmark, type LucideIcon } from 'lucide-react'

// Configurador de precios PÚBLICO (Landing) — Pricing 2026, Fase 4.
// Solo estima: plan base + add-ons FIJOS (recurrentes) → total mensual en vivo.
// Los movimientos extra (add-on temporal) se muestran aparte porque son pago único.
// Reusa el catálogo y la suma de src/lib/addons.ts (mismo precio que cobra el server).
//
// Diseño "Armá tu plan": panel oscuro + degradé de marca violeta→cian (mismos tokens
// que el resto de la app: .bg-accent / --color-accent / --color-accent-2).

const DIMS: Array<{ dim: AddonDimension; label: string; unidad: string; sub: string; Icon: LucideIcon }> = [
  { dim: 'sku',          label: 'Productos',    unidad: 'productos',    sub: 'Sumá más productos a tu plan',       Icon: Box },
  { dim: 'sucursales',   label: 'Sucursales',   unidad: 'sucursales',   sub: 'Sumá más sucursales a tu plan',      Icon: Building2 },
  { dim: 'usuarios',     label: 'Usuarios',     unidad: 'usuarios',     sub: 'Sumá más usuarios a tu plan',        Icon: User },
  { dim: 'comprobantes', label: 'Comprobantes', unidad: 'comprob./mes', sub: 'Sumá más comprobantes mensuales',    Icon: FileText },
  { dim: 'cuits',        label: 'CUITs',        unidad: 'CUITs extra',  sub: 'Facturá con más de una razón social', Icon: Landmark },
]

const BENEFICIOS: Array<{ Icon: LucideIcon; titulo: string; sub: string }> = [
  { Icon: Shield,     titulo: '30 días gratis',       sub: 'Sin tarjeta de crédito' },
  { Icon: Rocket,     titulo: 'Activación inmediata', sub: 'Comenzá a usarlo hoy' },
  { Icon: Headphones, titulo: 'Soporte dedicado',     sub: 'Siempre estamos para ayudarte' },
  { Icon: Lock,       titulo: 'Tus datos seguros',    sub: 'Encriptados y respaldados' },
]

// Reusable en 3 modos:
//  • Landing (default): estimador puro, CTA → onboarding.
//  • `onCta`: estimador dentro de la app SIN suscripción activa — el CTA suscribe al plan base.
//  • `app`: modo BATCH para suscriptos (diseño configurador-addons-batch.md): arranca con el
//    plan y los packs ACTUALES tildados; el total muestra el recurrente NUEVO (delta sobre el
//    monto real de MP — preserva descuentos); NADA se aplica hasta confirmar. El cobro/guard
//    real lo hace el EF mp-addon-batch (acá solo se estima y se arma el batch).
export interface AppBatchMode {
  planNombre: string
  /** Tier actual del tenant (tenants.plan_tier) — habilita el toggle de UPGRADE (Fase 2). */
  planTier: string
  /** Precios reales de los planes MP (preview del EF) — null si no se pudieron leer. */
  planesMp?: { basico: number | null; pro: number | null } | null
  /** auto_recurring.transaction_amount actual del preapproval (preview del EF). */
  montoActualMP: number
  /** Packs FIJOS actuales (selDesdeAddons de tenant_addons). */
  initialSel: PackSel
  confirmando?: boolean
  /** planObjetivo: 'pro' si el batch incluye el upgrade de plan (E1/E2 lo decide la página). */
  onConfirm: (packsObjetivo: PackSel, planObjetivo: 'pro' | null) => void
}

/** Pack TEMPORAL de comprobantes (pago único, 30 días) integrado a la tarjeta de
 *  Comprobantes vía toggle "Mensual / 30 días" — mismo catálogo, otro producto:
 *  NO toca el recurrente ni participa del batch (compra inmediata vía mp-addon). */
export interface TemporalComprobantes {
  usoMes: number
  maxMes: number                 // -1 = ilimitado → el toggle y la barra no se muestran
  comprando?: number | null      // cantidad en curso de compra (spinner)
  onComprar: (cantidad: number) => void
}

interface PricingConfiguratorProps {
  ctaLabel?: string
  onCta?: (planId: string) => void
  ctaLoading?: boolean
  app?: AppBatchMode
  temporal?: TemporalComprobantes
}

export default function PricingConfigurator({ ctaLabel, onCta, ctaLoading, app, temporal }: PricingConfiguratorProps = {}) {
  const planes = PLANES.filter(p => p.id === 'basico' || p.id === 'pro')
  const [planId, setPlanId] = useState('pro')
  // dimension → cantidad elegida (0 = ninguno). En modo app arranca en los packs ACTUALES.
  const [sel, setSel] = useState<Record<string, number>>(() => (app ? { ...app.initialSel } as Record<string, number> : {}))

  const plan = planes.find(p => p.id === planId) ?? planes[0]
  const base = plan.precio ?? 0

  const addonsFijos: AddonRow[] = Object.entries(sel)
    .filter(([, cant]) => cant > 0)
    .map(([dim, cant]) => ({ dimension: dim as AddonDimension, cantidad: cant, tipo: 'fijo' }))
  const precioAddons = precioMensualAddonsFijos(addonsFijos)

  // Fase 2: upgrade de PLAN dentro del batch (solo Básico→Pro; los precios de plan son
  // los REALES de MP — canal automático — que trae el preview del EF).
  const [planObjetivo, setPlanObjetivo] = useState<'pro' | null>(null)
  const upgradeDisponible = !!app && esUpgradeDePlan(app.planTier, 'pro') &&
    !!app.planesMp?.basico && !!app.planesMp?.pro
  const planCambio = app && upgradeDisponible && planObjetivo
    ? {
        tierActual: app.planTier, tierObjetivo: planObjetivo,
        precioPlanActualMP: app.planesMp!.basico!, precioPlanObjetivoMP: app.planesMp!.pro!,
      }
    : null

  // Modo app: total = recurrente NUEVO por delta (espejo calcularBatch, mismo cálculo del EF).
  const batchApp = app
    ? calcularBatch({ montoActualMP: app.montoActualMP, packsActuales: app.initialSel, packsObjetivo: sel as PackSel, plan: planCambio })
    : null
  const totalApp = batchApp?.recurrenteNuevo ?? 0
  const deltaApp = app ? totalApp - app.montoActualMP : 0
  const sinCambios = batchApp?.sinCambios ?? true
  const total = app ? totalApp : base + precioAddons

  const setPack = (dim: string, cant: number) =>
    setSel(prev => ({ ...prev, [dim]: prev[dim] === cant ? 0 : cant }))

  // Toggle Mensual / Por 30 días en la tarjeta de Comprobantes (solo si hay temporal)
  const temporalVisible = !!temporal && temporal.maxMes !== -1
  const [modoComprobantes, setModoComprobantes] = useState<'mensual' | 'temporal'>('mensual')
  const pctUso = temporalVisible && temporal!.maxMes > 0
    ? Math.min(100, Math.round((temporal!.usoMes / temporal!.maxMes) * 100)) : 0

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

      {/* Toggle de plan base. Landing/estimador: elige el plan a estimar. Modo app (Fase 2):
          si el tenant es Básico, el toggle ofrece el UPGRADE a Pro (el delta usa los precios
          reales de los planes MP); Pro/enterprise ven la píldora de su plan actual. */}
      <div className="relative mt-7 flex justify-center">
        {app ? (
          upgradeDisponible ? (
            <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
              <button onClick={() => setPlanObjetivo(null)}
                className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all
                  ${!planObjetivo ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'text-gray-300 hover:text-white'}`}>
                {app.planNombre} · ${app.montoActualMP.toLocaleString('es-AR')} (tu plan)
              </button>
              <button onClick={() => setPlanObjetivo('pro')}
                className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all
                  ${planObjetivo === 'pro' ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'text-gray-300 hover:text-white'}`}>
                Pro · +${((app.planesMp!.pro! - app.planesMp!.basico!)).toLocaleString('es-AR')}/mes
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-6 py-2.5 text-sm font-semibold text-white">
              <Check size={15} className="text-accent" /> Tu plan: {app.planNombre} · ${app.montoActualMP.toLocaleString('es-AR')}/mes
            </div>
          )
        ) : (
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
            {planes.map(p => (
              <button key={p.id} onClick={() => setPlanId(p.id)}
                className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all
                  ${planId === p.id ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'text-gray-300 hover:text-white'}`}>
                {p.nombre} · ${(p.precio ?? 0).toLocaleString('es-AR')}
              </button>
            ))}
          </div>
        )}
      </div>
      {!app && (
        <p className="relative mt-2 text-center text-[11px] text-gray-500">
          ${(plan.precio ?? 0).toLocaleString('es-AR')} con débito automático (-10%) · ${((plan as any).precioManual ?? plan.precio ?? 0).toLocaleString('es-AR')} con otros medios de pago
        </p>
      )}

      <div className="relative my-8 border-t border-white/10" />

      <p className="relative text-center text-sm font-semibold text-white mb-5">Personalizá tu plan con add-ons</p>

      {/* Add-ons fijos por dimensión. La tarjeta de Comprobantes suma el toggle
          "Mensual / 30 días": mismo catálogo, DOS productos — el fijo entra al batch
          (recurrente), el temporal es pago único inmediato vía mp-addon. */}
      <div className="relative grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DIMS.map(({ dim, label, unidad, sub, Icon }) => {
          const conTemporal = dim === 'comprobantes' && temporalVisible
          const enTemporal = conTemporal && modoComprobantes === 'temporal'
          return (
          <div key={dim} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/40 bg-accent/10">
                <Icon size={20} className="text-accent" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-white leading-tight">{label}</p>
                <p className="text-xs text-gray-400 leading-tight">
                  {enTemporal ? 'Pico puntual: pago único, válidos 30 días' : sub}
                </p>
              </div>
              {conTemporal && (
                <div className="ml-auto inline-flex shrink-0 rounded-full border border-white/10 bg-white/5 p-0.5">
                  {(['mensual', 'temporal'] as const).map(m => (
                    <button key={m} onClick={() => setModoComprobantes(m)}
                      className={`px-2 py-1 rounded-full text-[10px] font-semibold transition-all
                        ${modoComprobantes === m ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'}`}>
                      {m === 'mensual' ? 'Mensual' : '30 días'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {packsDe(dim).map(pack => {
                if (enTemporal) {
                  const comprando = temporal!.comprando === pack.cantidad
                  return (
                    <button key={pack.cantidad} onClick={() => temporal!.onComprar(pack.cantidad)}
                      disabled={temporal!.comprando != null}
                      className="relative flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center text-gray-300 transition-all hover:border-accent/60 disabled:opacity-60">
                      {comprando
                        ? <RefreshCw size={18} className="animate-spin text-accent" />
                        : <Zap size={18} className="text-accent" />}
                      <span className="text-[11px] leading-tight text-gray-300">
                        +{pack.cantidad.toLocaleString('es-AR')} {unidad}
                      </span>
                      <span className="text-sm font-bold">${pack.precio.toLocaleString('es-AR')}</span>
                      <span className="text-[10px] text-gray-500 leading-none">único · 30 días</span>
                    </button>
                  )
                }
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
            {conTemporal && (
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                  <span>Usados este mes</span>
                  <span>{temporal!.usoMes.toLocaleString('es-AR')} / {temporal!.maxMes.toLocaleString('es-AR')}</span>
                </div>
                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${pctUso >= 100 ? 'bg-red-400' : pctUso >= 80 ? 'bg-amber-400' : 'bg-accent'}`}
                    style={{ width: `${pctUso}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )})}
      </div>

      {/* Total + CTA */}
      <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {app ? (
            <p className="text-xs text-gray-400">
              Venís pagando ${app.montoActualMP.toLocaleString('es-AR')}/mes
              {!sinCambios && (batchApp?.cambiaPlan
                ? <> · cambio de plan a <span className="font-semibold text-white">Pro</span>: elegís al confirmar si pagás la diferencia hoy o cambiás en tu próxima fecha de cobro</>
                : deltaApp > 0
                  ? <> · hoy pagás la diferencia: <span className="font-semibold text-white">${deltaApp.toLocaleString('es-AR')}</span></>
                  : <> · sin cargos hoy — tu próxima factura ya llega por el monto nuevo</>)}
            </p>
          ) : (
            <p className="text-xs text-gray-400">Plan {plan.nombre} (${base.toLocaleString('es-AR')}) + add-ons (${precioAddons.toLocaleString('es-AR')})</p>
          )}
          <p className="text-4xl font-bold text-white">
            ${total.toLocaleString('es-AR')}<span className="text-base font-medium text-gray-500">/mes</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {app
              ? `Los cambios se aplican recién al confirmar.${temporalVisible ? ' ¿Un pico puntual? Pasá la tarjeta Comprobantes a «30 días».' : ''}`
              : '¿Un pico puntual de comprobantes? También hay packs por 30 días desde la app.'}
          </p>
        </div>
        {app ? (
          <button onClick={() => app.onConfirm(sel as PackSel, batchApp?.cambiaPlan ? 'pro' : null)}
            disabled={sinCambios || app.confirmando}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition-all hover:opacity-90 shrink-0 disabled:opacity-50">
            {app.confirmando
              ? <><RefreshCw size={16} className="animate-spin" /> Procesando…</>
              : sinCambios
                ? <><Check size={18} /> Sin cambios</>
                : batchApp?.cambiaPlan
                  ? <><Check size={18} /> Cambiar a Pro</>
                  : deltaApp > 0
                    ? <><Check size={18} /> Pagar diferencia ${deltaApp.toLocaleString('es-AR')}</>
                    : <><Check size={18} /> Confirmar cambios</>}
          </button>
        ) : onCta ? (
          <button onClick={() => onCta(planId)} disabled={ctaLoading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition-all hover:opacity-90 shrink-0 disabled:opacity-60">
            <Check size={18} /> {ctaLabel ?? `Suscribirme al plan ${plan.nombre}`}
          </button>
        ) : (
          <Link to="/onboarding"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition-all hover:opacity-90 shrink-0">
            <Check size={18} /> {ctaLabel ?? 'Probar 30 días gratis'}
          </Link>
        )}
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
