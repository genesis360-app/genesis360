import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { BRAND, PLANES, MP_PLAN_IDS } from '@/config/brand'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { packsDe, precioMensualAddonsFijos, type AddonDimension, type AddonRow } from '@/lib/addons'
import {
  Check, X, CheckCircle, XCircle, Clock,
  ArrowRight, ArrowLeft, Shield, RefreshCw, Zap, AlertTriangle, LogOut, Plus, Trash2, SlidersHorizontal,
} from 'lucide-react'
import toast from 'react-hot-toast'

// Dimensiones de add-on FIJO expuestas en el configurador (movimientos va por el flujo
// temporal de arriba). Etiquetas para la UI.
const DIMS_FIJAS: Array<{ dim: AddonDimension; label: string }> = [
  { dim: 'sku',        label: 'Productos (SKU)' },
  { dim: 'sucursales', label: 'Sucursales' },
  { dim: 'usuarios',   label: 'Usuarios' },
]

const labelDim = (dim: string) =>
  dim === 'sku' ? 'productos' : dim === 'sucursales' ? 'sucursales' : dim === 'usuarios' ? 'usuarios' : dim


export default function SuscripcionPage() {
  const { tenant, user, loadUserData, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)
  const [loadingAddon, setLoadingAddon] = useState<number | null>(null)
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
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'No se pudo agregar')
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
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'No se pudo quitar')
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

  // Auto-verificar y redirigir al dashboard cuando MP redirige con status=approved
  useEffect(() => {
    if (status === 'approved' && !esAddon) {
      handleVerificarPago()
    }
  }, [status])

  const handleSuscribir = (planId: string, mpPlanId: string) => {
    if (!mpPlanId) { toast.error('Plan no configurado'); return }
    if (!tenant?.id) { toast.error('No se encontró el tenant'); return }
    const appUrl = import.meta.env.VITE_APP_URL ?? 'https://app.genesis360.pro'
    const initPoint = `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${mpPlanId}&external_reference=${tenant.id}&back_url=${encodeURIComponent(appUrl + '/suscripcion')}`
    window.location.href = initPoint
  }

  const handleVerificarPago = async () => {
    if (!tenant) return
    setLoading('verificando')
    try {
      // 1. El webhook MP puede haber activado ya la suscripción.
      const { data } = await supabase.from('tenants').select('subscription_status').eq('id', tenant.id).single()
      if (data?.subscription_status === 'active') {
        toast.success('¡Suscripción activada!')
        if (user?.id) await loadUserData(user.id)
        window.location.href = '/dashboard'
        return
      }
      // 2. Respaldo: verificación SERVER-SIDE contra MP (NO se activa desde el
      //    cliente; la EF consulta el preapproval con el token de la plataforma y
      //    solo activa si está autorizado y pertenece a este tenant).
      if (preapprovalId) {
        const { data: verif } = await supabase.functions.invoke('mp-verificar-suscripcion', {
          body: { preapproval_id: preapprovalId },
        })
        if (verif?.activated) {
          toast.success('¡Suscripción activada!')
          if (user?.id) await loadUserData(user.id)
          window.location.href = '/dashboard'
          return
        }
      }
      // 3. Aún no confirmado por MP → queda procesando (el webhook lo activará).
      toast('Tu pago está siendo procesado. En breve recibirás confirmación.', { icon: '⏳' })
      window.location.href = '/dashboard'
    } catch {
      toast.error('Error al verificar el pago. Contactá soporte.')
      setLoading(null)
    }
  }

  // "Ya pagué" / respaldo: verifica la suscripción SIN preapproval_id (el EF la busca en
  // MP por payer_email del usuario logueado). Cierra el caso "pagó y no se activó" cuando
  // el usuario cerró la pestaña del checkout antes de volver a la app.
  const handleYaPague = async () => {
    setLoading('verificando')
    try {
      const { data } = await supabase.functions.invoke('mp-verificar-suscripcion', { body: {} })
      if (data?.activated) {
        toast.success('¡Suscripción activada!')
        if (user?.id) await loadUserData(user.id)
        window.location.href = '/dashboard'
        return
      }
      toast('No encontramos un pago activo a tu nombre. Si acabás de pagar, esperá unos minutos y reintentá.', { icon: '⏳' })
      setLoading(null)
    } catch {
      toast.error('Error al verificar la suscripción. Contactá soporte.')
      setLoading(null)
    }
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
            ) : (
              <>
                <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">¡Pago aprobado!</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  {loading === 'verificando'
                    ? 'Activando tu cuenta...'
                    : 'Tu suscripción se activó correctamente.'}
                </p>
                <div className="flex items-center justify-center gap-2 text-accent font-medium">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Redirigiendo al dashboard...</span>
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
        <button onClick={handleYaPague} disabled={loading === 'verificando'}
          className="mt-4 text-sm text-blue-200 underline underline-offset-4 hover:text-white disabled:opacity-50">
          {loading === 'verificando' ? 'Verificando…' : '¿Ya pagaste y no se activó? Verificar mi suscripción'}
        </button>
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
                  <div className={`text-center py-3 rounded-xl text-sm font-semibold
                    ${plan.destacado ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-white dark:bg-gray-800/20 text-white'}`}>
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

        {/* Configurador de add-ons FIJOS (recurrentes) — requiere suscripción activa */}
        {esActivo && limits && (
          <div className="mt-10 max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 mb-1">
              <SlidersHorizontal size={18} className="text-white" />
              <p className="text-white font-semibold">Ampliá tu plan con add-ons</p>
            </div>
            <p className="text-blue-200 text-xs text-center mb-4">
              Se suman a tu suscripción mensual. Para quitar un add-on, primero desactivá los recursos que sobren.
            </p>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6">
              {/* Resumen de precio en vivo */}
              <div className="flex items-center justify-between text-sm border-b border-gray-100 dark:border-gray-700 pb-3 mb-4">
                <span className="text-gray-500 dark:text-gray-400">
                  Plan {planActual?.nombre} (${precioBase.toLocaleString('es-AR')}) + add-ons (${precioAddonsFijos.toLocaleString('es-AR')})
                </span>
                <span className="font-bold text-primary dark:text-white text-lg">
                  ${totalMensual.toLocaleString('es-AR')}/mes
                </span>
              </div>

              {DIMS_FIJAS.map(({ dim, label }) => {
                const activos = (addonsFijos as any[]).filter(a => a.dimension === dim)
                return (
                  <div key={dim} className="py-3 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                    <p className="font-semibold text-gray-700 dark:text-gray-200 text-sm mb-2">{label}</p>
                    {activos.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {activos.map(a => (
                          <span key={a.id} className="inline-flex items-center gap-1.5 bg-accent/10 text-accent text-xs font-medium px-2.5 py-1 rounded-full">
                            +{a.cantidad.toLocaleString('es-AR')}
                            <button onClick={() => quitarAddonFijo(a)} disabled={addonBusy} title="Quitar add-on" className="hover:text-red-500 disabled:opacity-50">
                              <Trash2 size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {packsDe(dim).map(pack => (
                        <button key={pack.cantidad} onClick={() => agregarAddonFijo(dim, pack.cantidad)} disabled={addonBusy}
                          className="inline-flex items-center gap-1 border border-gray-200 dark:border-gray-600 hover:border-accent text-gray-600 dark:text-gray-300 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          <Plus size={12} /> {pack.cantidad.toLocaleString('es-AR')} · ${pack.precio.toLocaleString('es-AR')}/mes
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
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
