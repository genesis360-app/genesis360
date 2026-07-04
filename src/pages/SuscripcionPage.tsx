import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { BRAND, PLANES, MP_PLAN_IDS, ADDON_FIJO_ENABLED } from '@/config/brand'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { packsDe, precioMensualAddonsFijos, type AddonDimension, type AddonRow } from '@/lib/addons'
import { clasificarVerificacion, mensajeErrorVerif, mensajeErrorEF } from '@/lib/suscripcionActivacion'
import {
  Check, X, CheckCircle, XCircle, Clock,
  ArrowRight, ArrowLeft, Shield, RefreshCw, Zap, AlertTriangle, LogOut, Plus, Trash2, SlidersHorizontal,
  Box, Building2, User, type LucideIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'

// Dimensiones de add-on FIJO expuestas en el configurador (movimientos va por el flujo
// temporal de arriba). Etiquetas + iconos para la UI.
const DIMS_FIJAS: Array<{ dim: AddonDimension; label: string; unidad: string; sub: string; Icon: LucideIcon }> = [
  { dim: 'sku',        label: 'Productos',  unidad: 'productos',  sub: 'Sumá más productos a tu plan',  Icon: Box },
  { dim: 'sucursales', label: 'Sucursales', unidad: 'sucursales', sub: 'Sumá más sucursales a tu plan', Icon: Building2 },
  { dim: 'usuarios',   label: 'Usuarios',   unidad: 'usuarios',   sub: 'Sumá más usuarios a tu plan',   Icon: User },
]

const labelDim = (dim: string) =>
  dim === 'sku' ? 'productos' : dim === 'sucursales' ? 'sucursales' : dim === 'usuarios' ? 'usuarios' : dim

export default function SuscripcionPage() {
  const { tenant, user, loadUserData, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)
  const [loadingAddon, setLoadingAddon] = useState<number | null>(null)
  // Estado REAL de la verificación de activación al volver del checkout de MP.
  const [verifState, setVerifState] = useState<'verificando' | 'ok' | 'pendiente' | 'error'>('verificando')
  const [verifReason, setVerifReason] = useState<string | null>(null)
  const { limits } = usePlanLimits()
  const queryClient = useQueryClient()

  const packsMovimientos = packsDe('movimientos')
  const esActivo = tenant?.subscription_status === 'active'

  // Add-ons FIJOS activos del tenant (configurador — solo con suscripción activa).
  const { data: addonsFijos = [] } = useQuery<Array<AddonRow & { id: string }>>({
    queryKey: ['addons-fijos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('tenant_addons')
        .select('id, dimension, cantidad, tipo')
        .eq('tenant_id', tenant!.id).eq('tipo', 'fijo')
      return (data ?? []) as Array<AddonRow & { id: string }>
    },
    enabled: !!tenant && esActivo,
    staleTime: 30000,
  })

  const [addonBusy, setAddonBusy] = useState(false)
  // Estado del downgrade guiado bloqueado (el usuario debe desactivar recursos primero).
  const [downgrade, setDowngrade] = useState<{ dimension: string; excedente: number; nuevoLimite: number } | null>(null)

  const planActual = PLANES.find(p => p.id === limits?.plan_id)
  const precioBase = planActual?.precio ?? 0
  const precioAddonsFijos = precioMensualAddonsFijos(addonsFijos as any)
  const totalMensual = precioBase + precioAddonsFijos

  const refetchAddons = async () => {
    await queryClient.invalidateQueries({ queryKey: ['addons-fijos', tenant?.id] })
    await queryClient.invalidateQueries({ queryKey: ['plan-limits', tenant?.id] })
  }

  const agregarAddonFijo = async (dimension: AddonDimension, cantidad: number) => {
    setAddonBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('mp-addon-fijo', {
        body: { action: 'agregar', dimension, cantidad },
      })
      if (error || data?.error) throw new Error(await mensajeErrorEF(error, data, 'No se pudo agregar'))
      toast.success('Add-on agregado. Se ajustó tu suscripción mensual.')
      await refetchAddons()
    } catch (e: any) {
      toast.error(e.message ?? 'Error al agregar el add-on')
    } finally {
      setAddonBusy(false)
    }
  }

  const quitarAddonFijo = async (addon: { id: string; dimension: string; cantidad: number }) => {
    setAddonBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('mp-addon-fijo', {
        body: { action: 'quitar', addon_id: addon.id },
      })
      if (data?.blocked) {
        // Downgrade guiado: hay que desactivar recursos antes de poder bajar.
        setDowngrade({ dimension: data.dimension, excedente: data.excedente, nuevoLimite: data.nuevo_limite })
        return
      }
      if (error || data?.error) throw new Error(await mensajeErrorEF(error, data, 'No se pudo quitar'))
      toast.success('Add-on quitado. Se ajustó tu suscripción mensual.')
      await refetchAddons()
    } catch (e: any) {
      toast.error(e.message ?? 'Error al quitar el add-on')
    } finally {
      setAddonBusy(false)
    }
  }

  // Resultado de pago redirigido desde MP
  const status = searchParams.get('status')
  const paymentType = searchParams.get('type') // 'addon' | null (suscripción)
  const preapprovalId = searchParams.get('preapproval_id')
  const esAddon = paymentType === 'addon'

  // ── Verificación REAL de la activación al volver del checkout de MP ────────────
  // Antes esta pantalla MENTÍA: mostraba "tu suscripción se activó" sin verificar nada.
  // Ahora se consulta server-side (EF mp-verificar-suscripcion, que deriva el tenant del
  // JWT y solo activa si el preapproval está 'authorized' y pertenece al usuario) y la UI
  // refleja el estado real. Una pasada de verificación:
  const verificarUnaVez = async (): Promise<{ estado: 'ok' | 'pendiente' | 'error'; reason?: string }> => {
    const { data, error } = await supabase.functions.invoke('mp-verificar-suscripcion', {
      body: preapprovalId ? { preapproval_id: preapprovalId } : {},
    })
    // Si hubo error HTTP (4xx/5xx), intentar leer el `reason` del body para el mensaje.
    let errorReason: string | undefined
    if (error) {
      try {
        const ctx: any = (error as any).context
        const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null
        errorReason = body?.reason
      } catch { /* el body ya se consumió o no es JSON */ }
    }
    return clasificarVerificacion(data, !!error, errorReason)
  }

  // Al volver de MP con status=approved: esperar la sesión (el redirect recarga la app de
  // cero → el JWT puede no estar listo → 401), verificar y reintentar (MP/webhook tarda).
  useEffect(() => {
    if (status !== 'approved' || esAddon) return
    let cancelado = false
    ;(async () => {
      setVerifState('verificando')
      await supabase.auth.getSession()
      for (let intento = 0; intento < 4 && !cancelado; intento++) {
        const { estado, reason } = await verificarUnaVez()
        if (cancelado) return
        if (estado === 'ok') { setVerifState('ok'); return }
        if (estado === 'error') { setVerifReason(reason ?? null); setVerifState('error'); return }
        if (intento < 3) await new Promise(r => setTimeout(r, 2500)) // pendiente → reintentar
      }
      if (!cancelado) setVerifState('pendiente')
    })()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, esAddon, preapprovalId])

  // Activada: refrescar el store (tenant → active, evita que SubscriptionGuard rebote a
  // /suscripcion con datos viejos) y llevar al dashboard tras mostrar el cartel de éxito.
  useEffect(() => {
    if (verifState !== 'ok') return
    const t = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id ?? user?.id
      if (uid) await loadUserData(uid)
      navigate('/dashboard')
    }, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifState])

  const reintentarVerificacion = async () => {
    setVerifReason(null)
    setVerifState('verificando')
    await supabase.auth.getSession()
    const { estado, reason } = await verificarUnaVez()
    if (estado === 'ok') { setVerifState('ok'); return }
    if (estado === 'error') { setVerifReason(reason ?? null); setVerifState('error'); return }
    setVerifState('pendiente')
  }

  const handleSuscribir = (planId: string, mpPlanId: string) => {
    if (!mpPlanId) { toast.error('Plan no configurado'); return }
    if (!tenant?.id) { toast.error('No se encontró el tenant'); return }
    setLoading(planId)
    const appUrl = import.meta.env.VITE_APP_URL ?? 'https://app.genesis360.pro'
    const initPoint = `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${mpPlanId}&external_reference=${tenant.id}&back_url=${encodeURIComponent(appUrl + '/suscripcion')}`
    window.location.href = initPoint
  }

  const handleComprarAddon = async (cantidad: number) => {
    setLoadingAddon(cantidad)
    try {
      const { data, error } = await supabase.functions.invoke('mp-addon', {
        body: { dimension: 'movimientos', cantidad },
      })
      if (error || !data?.init_point) throw new Error(error?.message ?? 'No se obtuvo link de pago')
      window.location.href = data.init_point
    } catch (e: any) {
      toast.error(e.message ?? 'Error al iniciar el pago')
      setLoadingAddon(null)
    }
  }

  const planesConPago = PLANES.filter(p => p.precio !== null && p.precio > 0)

  // Pantalla de resultado de pago
  if (status) {
    return (
      <div className="min-h-screen bg-brand-gradient-dark flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          {status === 'approved' ? (
            esAddon ? (
              <>
                <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">¡Add-on activado!</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  Se agregaron tus <strong>movimientos extra</strong> a la cuenta (válidos por 30 días). Ya podés usarlos.
                </p>
                <Link to="/dashboard"
                  className="w-full block text-center bg-accent hover:bg-accent/90 text-white font-bold py-3 rounded-xl transition-all">
                  Ir al dashboard
                </Link>
              </>
            ) : verifState === 'ok' ? (
              <>
                <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">¡Suscripción activada!</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  Tu plan quedó activo. Ya podés usar {BRAND.name} sin límites de prueba.
                </p>
                <div className="flex items-center justify-center gap-2 text-accent font-medium">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Redirigiendo al dashboard...</span>
                </div>
              </>
            ) : verifState === 'error' ? (
              <>
                <XCircle size={48} className="text-red-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">No pudimos confirmar tu pago</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-8">{mensajeErrorVerif(verifReason)}</p>
                <div className="flex flex-col gap-3 mt-2">
                  <button onClick={reintentarVerificacion}
                    className="w-full bg-primary text-white font-bold py-3 rounded-xl hover:bg-accent transition-all">
                    Reintentar
                  </button>
                  <a href={`mailto:${BRAND.email}?subject=${encodeURIComponent('Problema con mi suscripción')}`}
                    className="w-full block text-center text-gray-500 dark:text-gray-400 font-medium py-2 rounded-xl hover:text-primary transition-all text-sm">
                    Contactar soporte
                  </a>
                </div>
              </>
            ) : verifState === 'pendiente' ? (
              <>
                <Clock size={48} className="text-yellow-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Estamos confirmando tu pago</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-8">
                  Mercado Pago todavía no nos confirmó el pago. Puede tardar unos minutos y te avisaremos por email cuando se active. <strong>No hace falta que pagues de nuevo.</strong>
                </p>
                <div className="flex flex-col gap-3 mt-2">
                  <button onClick={reintentarVerificacion}
                    className="w-full bg-primary text-white font-bold py-3 rounded-xl hover:bg-accent transition-all">
                    Verificar de nuevo
                  </button>
                  <Link to="/dashboard"
                    className="w-full block text-center text-gray-500 dark:text-gray-400 font-medium py-2 rounded-xl hover:text-primary transition-all text-sm">
                    Ir al dashboard
                  </Link>
                </div>
              </>
            ) : (
              <>
                <RefreshCw size={48} className="text-accent mx-auto mb-4 animate-spin" />
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Verificando tu pago…</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  Estamos confirmando tu suscripción con Mercado Pago. Esto puede tardar unos segundos.
                </p>
                <div className="flex items-center justify-center gap-2 text-accent font-medium">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Un momento…</span>
                </div>
              </>
            )
          ) : status === 'pending' ? (
            <>
              <Clock size={48} className="text-yellow-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Pago pendiente</h1>
              <p className="text-gray-500 dark:text-gray-400 mb-6">Tu pago está siendo procesado. Te avisaremos por email cuando se confirme.</p>
              <Link to="/dashboard" className="w-full block text-center bg-primary text-white font-bold py-3 rounded-xl hover:bg-accent transition-all">
                Volver al dashboard
              </Link>
            </>
          ) : (
            <>
              <XCircle size={48} className="text-red-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Pago no completado</h1>
              <p className="text-gray-500 dark:text-gray-400 mb-6">No se procesó el pago. Podés intentarlo de nuevo.</p>
              <button onClick={() => window.location.href = '/suscripcion'}
                className="w-full bg-primary text-white font-bold py-3 rounded-xl hover:bg-accent transition-all">
                Intentar de nuevo
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-gradient-dark">
      {/* Barra superior */}
      <div className="px-4 pt-5 max-w-5xl mx-auto flex items-center justify-between">
        {tenant?.subscription_status === 'cancelled' ? (
          // Negocio cancelado: no hay a dónde "volver" — ofrecer salidas reales
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                // Eliminar users record de DB
                if (user?.id) await supabase.from('users').delete().eq('id', user.id)
                // Limpiar store en memoria para que SubscriptionGuard no siga redirigiendo
                useAuthStore.setState({ user: null, tenant: null, needsOnboarding: true, loading: false })
                navigate('/onboarding')
              }}
              className="flex items-center gap-2 text-blue-300 hover:text-white transition-colors text-sm font-medium"
            >
              <ArrowLeft size={16} /> Registrar nuevo negocio
            </button>
          </div>
        ) : (
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-blue-300 hover:text-white transition-colors text-sm font-medium"
          >
            <ArrowLeft size={16} /> Volver al dashboard
          </button>
        )}
        <button
          onClick={async () => { await signOut(); navigate('/login') }}
          className="flex items-center gap-2 text-blue-300 hover:text-white transition-colors text-sm font-medium"
        >
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>

      {/* Header */}
      <div className="text-center pt-6 pb-8 px-4">
        <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
          <img src={BRAND.logo} alt={BRAND.name} className="w-16 h-16 object-contain drop-shadow-lg" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          {tenant?.subscription_status === 'trial'
            ? '¡Tu prueba gratuita está por vencer!'
            : 'Elegí tu plan'}
        </h1>
        <p className="text-blue-200">
          {tenant?.subscription_status === 'trial'
            ? 'Activá tu suscripción para seguir usando Genesis360 sin interrupciones'
            : 'Todos los planes incluyen 7 días de prueba gratuita'}
        </p>
      </div>

      {/* Planes */}
      <div className="max-w-5xl mx-auto px-4 pb-12">
        <div className="grid md:grid-cols-3 gap-6">
          {planesConPago.map(plan => {
            const mpPlanId = MP_PLAN_IDS[plan.id] ?? ''
            // El plan actual se infiere de los límites (max_users → plan), no del
            // mp_subscription_id (que es el preapproval_id de MP y no contiene la key del plan).
            const esActual = tenant?.subscription_status === 'active' && limits?.plan_id === plan.id

            return (
              <div key={plan.id}
                className={`rounded-2xl p-6 flex flex-col relative
                  ${plan.destacado
                    ? 'bg-white dark:bg-gray-800 shadow-2xl scale-105'
                    : 'bg-white/10 dark:bg-gray-800/10 border border-white/20'}`}>

                {plan.destacado && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-xs font-bold px-3 py-1 rounded-full">
                    MÁS POPULAR
                  </div>
                )}

                <div className="mb-5">
                  <h3 className={`font-bold text-xl ${plan.destacado ? 'text-primary' : 'text-white'}`}>
                    {plan.nombre}
                  </h3>
                  <p className={`text-sm mt-0.5 ${plan.destacado ? 'text-gray-400 dark:text-gray-500' : 'text-blue-200'}`}>
                    {plan.descripcion}
                  </p>
                  <div className="mt-4">
                    {plan.precio === null ? (
                      <span className={`text-2xl font-bold ${plan.destacado ? 'text-primary' : 'text-white'}`}>
                        A consultar
                      </span>
                    ) : (
                      <div>
                        <span className={`text-4xl font-bold ${plan.destacado ? 'text-primary' : 'text-white'}`}>
                          ${plan.precio.toLocaleString('es-AR')}
                        </span>
                        <span className={`text-sm ml-1 ${plan.destacado ? 'text-gray-400 dark:text-gray-500' : 'text-blue-200'}`}>/mes</span>
                      </div>
                    )}
                  </div>
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={15} className={`flex-shrink-0 mt-0.5 ${plan.destacado ? 'text-green-500' : 'text-green-400'}`} />
                      <span className={plan.destacado ? 'text-gray-600 dark:text-gray-400' : 'text-blue-100'}>{f}</span>
                    </li>
                  ))}
                  {plan.noIncluye.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm opacity-40">
                      <X size={15} className="flex-shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" />
                      <span className={plan.destacado ? 'text-gray-400 dark:text-gray-500' : 'text-blue-200'}>{f}</span>
                    </li>
                  ))}
                </ul>

                {esActual ? (
                  // "Plan actual": badge de estado. En la tarjeta destacada (fondo blanco) va verde
                  // sobre claro; en las no destacadas (tarjeta oscura/frosted) NO puede ser blanco
                  // sobre blanco → tinte de marca (accent) con texto blanco, siempre legible.
                  <div className={`text-center py-3 rounded-xl text-sm font-semibold border
                    ${plan.destacado
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-transparent'
                      : 'bg-accent/25 text-white border-accent/50'}`}>
                    ✓ Plan actual
                  </div>
                ) : plan.precio === null ? (
                  <a href={`mailto:${BRAND.email}?subject=Plan Enterprise`}
                    className={`block text-center font-semibold py-3 rounded-xl transition-all text-sm
                      ${plan.destacado ? 'bg-primary text-white hover:bg-accent' : 'bg-white dark:bg-gray-800 text-primary hover:bg-accent/10'}`}>
                    Contactar
                  </a>
                ) : (
                  <button
                    onClick={() => handleSuscribir(plan.id, mpPlanId)}
                    disabled={!!loading}
                    className={`w-full font-semibold py-3 rounded-xl transition-all text-sm disabled:opacity-60 flex items-center justify-center gap-2
                      ${plan.destacado ? 'bg-primary text-white hover:bg-accent' : 'bg-white dark:bg-gray-800 text-primary hover:bg-accent/10'}`}>
                    {loading === plan.id
                      ? <><RefreshCw size={15} className="animate-spin" /> Redirigiendo...</>
                      : <><ArrowRight size={15} /> Suscribirme</>}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Uso actual de movimientos */}
        {limits && limits.max_movimientos !== -1 && (
          <div className="mt-8 bg-white/10 rounded-2xl p-6 max-w-md mx-auto">
            <p className="text-white font-semibold mb-3 text-center">Tu uso este mes</p>
            <div className="flex items-center justify-between text-sm text-blue-200 mb-2">
              <span>Movimientos</span>
              <span className="font-medium text-white">
                {limits.movimientos_mes.toLocaleString()} / {limits.max_movimientos.toLocaleString()}
              </span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${limits.pct_movimientos >= 100 ? 'bg-red-400' : limits.pct_movimientos >= 80 ? 'bg-amber-400' : 'bg-green-400'}`}
                style={{ width: `${Math.min(100, limits.pct_movimientos)}%` }}
              />
            </div>
            {limits.pct_movimientos >= 80 && (
              <p className="text-amber-300 text-xs text-center mt-2 flex items-center justify-center gap-1">
                <AlertTriangle size={12} />
                {limits.pct_movimientos >= 100 ? 'Límite alcanzado — upgrade o comprá extra' : 'Cerca del límite — considerá ampliar'}
              </p>
            )}
            {limits.addon_movimientos > 0 && (
              <p className="text-blue-200 text-xs text-center mt-1">
                Incluye {limits.addon_movimientos} movimientos extra comprados
              </p>
            )}
          </div>
        )}

        {/* Add-ons de movimientos (temporales, pago único, vencen a 30 días) */}
        {limits && limits.max_movimientos !== -1 && (
          <div className="mt-8 max-w-3xl mx-auto">
            <p className="text-white font-semibold text-center mb-1">¿Necesitás más movimientos sin cambiar de plan?</p>
            <p className="text-blue-200 text-xs text-center mb-4">Pago único · se acreditan automáticamente · válidos por 30 días</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {packsMovimientos.map(pack => (
                <div key={pack.cantidad} className="bg-white dark:bg-gray-800 rounded-2xl p-5 text-center flex flex-col">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-accent/10 rounded-xl mb-3 mx-auto">
                    <Zap size={22} className="text-accent" />
                  </div>
                  <p className="font-bold text-gray-800 dark:text-gray-100 text-lg">
                    +{pack.cantidad.toLocaleString('es-AR')}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">movimientos</p>
                  <p className="text-2xl font-bold text-primary dark:text-white mt-2">
                    ${pack.precio.toLocaleString('es-AR')}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">pago único · 30 días</p>
                  <button
                    onClick={() => handleComprarAddon(pack.cantidad)}
                    disabled={loadingAddon !== null}
                    className="mt-auto flex items-center justify-center gap-2 w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all text-sm disabled:opacity-60"
                  >
                    {loadingAddon === pack.cantidad
                      ? <><RefreshCw size={15} className="animate-spin" /> Redirigiendo...</>
                      : <><Zap size={15} /> Comprar</>}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Configurador de add-ons FIJOS (recurrentes) — requiere una suscripción MP REAL.
            Los add-ons fijos modifican el monto del preapproval de MP (`mp_subscription_id`),
            así que NO tiene sentido mostrarlos a tenants activos sin suscripción MP (Enterprise
            "a consultar", cuentas activadas a mano): sin preapproval, la EF fail-closea con 400. */}
        {ADDON_FIJO_ENABLED && esActivo && limits && tenant?.mp_subscription_id && (
          <div className="mt-10 max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 mb-1">
              <SlidersHorizontal size={18} className="text-white" />
              <p className="text-white font-semibold">Ampliá tu plan con add-ons</p>
            </div>
            <p className="text-blue-200 text-xs text-center mb-4">
              Se suman a tu suscripción mensual. Para quitar un add-on, primero desactivá los recursos que sobren.
            </p>

            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b14] p-6 shadow-2xl">
              <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-56 w-56 rounded-full bg-accent opacity-20 blur-[100px]" />

              {/* Resumen de precio en vivo */}
              <div className="relative flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 mb-5">
                <span className="text-sm text-gray-400">
                  Plan {planActual?.nombre} (${precioBase.toLocaleString('es-AR')}) + add-ons (${precioAddonsFijos.toLocaleString('es-AR')})
                </span>
                <span className="text-lg font-bold text-white">
                  ${totalMensual.toLocaleString('es-AR')}<span className="text-sm font-medium text-gray-500">/mes</span>
                </span>
              </div>

              <div className="relative grid gap-4 md:grid-cols-3">
                {DIMS_FIJAS.map(({ dim, label, unidad, sub, Icon }) => {
                  const activos = (addonsFijos as any[]).filter(a => a.dimension === dim)
                  return (
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
                          const activosDePack = activos.filter(a => a.cantidad === pack.cantidad)
                          const count = activosDePack.length
                          const selected = count > 0
                          return (
                            <div key={pack.cantidad}
                              className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition-all
                                ${selected
                                  ? 'border-transparent bg-accent text-white shadow-lg shadow-accent/30'
                                  : 'border-white/10 bg-white/[0.02] text-gray-300 hover:border-accent/60'}`}>
                              {selected && (
                                <button onClick={() => quitarAddonFijo(activosDePack[0])} disabled={addonBusy}
                                  title="Quitar un add-on"
                                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-accent shadow hover:text-red-500 disabled:opacity-50">
                                  <Trash2 size={11} />
                                </button>
                              )}
                              {/* Botón principal: agrega uno más de este pack */}
                              <button onClick={() => agregarAddonFijo(dim, pack.cantidad)} disabled={addonBusy}
                                title={selected ? 'Agregar otro' : 'Agregar add-on'}
                                className="flex w-full flex-col items-center justify-center gap-1.5 disabled:opacity-50">
                                {selected
                                  ? <span className="text-xs font-bold">{count > 1 ? `×${count}` : ''}<Plus size={16} className="inline text-white/90" /></span>
                                  : <Plus size={18} className="text-gray-500" />}
                                <span className={`text-[11px] leading-tight ${selected ? 'text-white' : 'text-gray-300'}`}>
                                  +{pack.cantidad.toLocaleString('es-AR')} {unidad}
                                </span>
                                <span className="text-sm font-bold">${pack.precio.toLocaleString('es-AR')}</span>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="relative mt-5 text-center text-xs text-gray-500">
                ¿Necesitás más movimientos puntuales? Se compran por 30 días desde la app.
              </p>
            </div>
          </div>
        )}

        {/* Modal de downgrade guiado (REGLA #0: desactivar, no eliminar) */}
        {downgrade && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setDowngrade(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={22} className="text-amber-500" />
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-lg">Todavía no podés bajar este add-on</h3>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-3">
                Tenés <strong>{downgrade.excedente}</strong> {labelDim(downgrade.dimension)} activos de más para el nuevo límite
                (<strong>{downgrade.nuevoLimite}</strong>). Desactivá {downgrade.excedente} para poder quitar el add-on.
              </p>
              {downgrade.dimension === 'sku' && (
                <p className="text-amber-600 dark:text-amber-400 text-xs bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 mb-4">
                  ⚠️ Desactivá los productos (no los elimines) para conservar su historial y trazabilidad.
                </p>
              )}
              <button onClick={() => setDowngrade(null)} className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm">
                Entendido
              </button>
            </div>
          </div>
        )}

        {/* Garantías */}
        <div className="mt-10 flex flex-wrap justify-center gap-6 text-blue-200 text-sm">
          <span className="flex items-center gap-2"><Shield size={16} /> Pago seguro con Mercado Pago</span>
          <span className="flex items-center gap-2"><RefreshCw size={16} /> Cancelá cuando quieras</span>
          <span className="flex items-center gap-2"><Check size={16} /> Sin costos ocultos</span>
        </div>

        {/* Escape hatch — usuario autenticado sin suscripción activa */}
        {user && (
          <div className="mt-8 text-center">
            <p className="text-blue-300 text-sm mb-2">
              Sesión activa como <strong>{user.nombre_display ?? user.rol}</strong>
            </p>
            <button
              onClick={async () => {
                const { signOut } = useAuthStore.getState()
                await signOut()
                navigate('/login')
              }}
              className="inline-flex items-center gap-2 text-blue-300 hover:text-white text-sm underline underline-offset-4 transition-colors"
            >
              <LogOut size={14} /> Cerrar sesión
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
