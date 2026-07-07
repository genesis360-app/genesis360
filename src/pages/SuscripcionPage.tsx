import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { BRAND, PLANES, MP_PLAN_IDS, ADDON_FIJO_ENABLED } from '@/config/brand'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { type AddonRow } from '@/lib/addons'
import { selDesdeAddons, type PackSel, type BatchBloqueo } from '@/lib/mpAddonBatch'
import { clasificarVerificacion, mensajeErrorVerif, mensajeErrorEF } from '@/lib/suscripcionActivacion'
import PricingConfigurator from '@/components/PricingConfigurator'
import {
  Check, X, CheckCircle, XCircle, Clock,
  ArrowRight, ArrowLeft, Shield, RefreshCw, AlertTriangle, LogOut,
} from 'lucide-react'
import toast from 'react-hot-toast'

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

  const esActivo = tenant?.subscription_status === 'active'
  const tieneSubMP = esActivo && !!tenant?.mp_subscription_id

  // Add-ons FIJOS activos del tenant → estado inicial del panel batch (packs tildados).
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
  const packsActuales: PackSel = selDesdeAddons(addonsFijos)

  // Monto recurrente REAL del preapproval (preview del EF — preserva descuentos). Es la
  // base del total del panel batch: total = montoActual − precio(actuales) + precio(elegidos).
  const { data: batchPreview = null } = useQuery<{ monto_actual: number; next_payment_date: string | null } | null>({
    queryKey: ['batch-preview', tenant?.id, addonsFijos.length],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('mp-addon-batch', {
        body: { action: 'preview', packs_objetivo: Object.entries(packsActuales).map(([dimension, cantidad]) => ({ dimension, cantidad })) },
      })
      if (error || data?.error) return null
      return { monto_actual: Number(data?.monto_actual ?? 0), next_payment_date: data?.next_payment_date ?? null }
    },
    enabled: !!tenant && tieneSubMP && ADDON_FIJO_ENABLED,
    staleTime: 60000,
  })

  const [confirmandoBatch, setConfirmandoBatch] = useState(false)
  // Guard de baja del batch: dimensiones donde el uso activo excede el límite resultante.
  const [bloqueos, setBloqueos] = useState<BatchBloqueo[] | null>(null)

  const refetchAddons = async () => {
    await queryClient.invalidateQueries({ queryKey: ['addons-fijos', tenant?.id] })
    await queryClient.invalidateQueries({ queryKey: ['plan-limits', tenant?.id] })
    await queryClient.invalidateQueries({ queryKey: ['batch-preview', tenant?.id] })
  }

  // ── Confirmar el BATCH (diseño configurador-addons-batch.md) ─────────────────────
  // delta > 0 → redirect al checkout del delta (el webhook aplica al pagar).
  // delta ≤ 0 → se aplica ya (PUT fail-closed) y avisamos con la fecha de la próxima factura.
  const handleConfirmarBatch = async (packsObjetivo: PackSel) => {
    setConfirmandoBatch(true)
    try {
      const { data, error } = await supabase.functions.invoke('mp-addon-batch', {
        body: {
          action: 'confirmar',
          packs_objetivo: Object.entries(packsObjetivo)
            .filter(([, cantidad]) => (cantidad ?? 0) > 0)
            .map(([dimension, cantidad]) => ({ dimension, cantidad })),
        },
      })
      if (data?.blocked && Array.isArray(data?.bloqueos)) {
        setBloqueos(data.bloqueos.map((b: any) => ({
          dimension: b.dimension, nuevoLimite: b.nuevo_limite, uso: b.uso, excedente: b.excedente,
        })))
        return
      }
      if (error || data?.error) throw new Error(await mensajeErrorEF(error, data, 'No se pudo aplicar el cambio'))
      if (data?.init_point) {
        // Suba: pagar la diferencia en MP (el cambio se aplica al confirmarse el pago).
        window.location.href = data.init_point
        return
      }
      // Baja/neutro: aplicado ya. Confirmar el monto y la fecha de la próxima factura.
      const hasta = data?.next_payment_date ? new Date(data.next_payment_date).toLocaleDateString('es-AR') : null
      toast.success(hasta
        ? `Listo. Tu factura del ${hasta} llega por $${Number(data?.recurrente_nuevo ?? 0).toLocaleString('es-AR')}.`
        : `Listo. Tu suscripción pasa a $${Number(data?.recurrente_nuevo ?? 0).toLocaleString('es-AR')}/mes.`)
      await refetchAddons()
    } catch (e: any) {
      toast.error(e.message ?? 'Error al aplicar el cambio')
    } finally {
      setConfirmandoBatch(false)
    }
  }

  // Resultado de pago redirigido desde MP
  const status = searchParams.get('status')
  const paymentType = searchParams.get('type') // 'addon' | 'addonbatch' | null (suscripción)
  const preapprovalId = searchParams.get('preapproval_id')
  const changeId = searchParams.get('change_id')
  const esAddon = paymentType === 'addon'
  const esAddonBatch = paymentType === 'addonbatch'

  // ── Retorno del checkout del BATCH: poll del estado del change (lo aplica el webhook) ──
  const [batchState, setBatchState] = useState<'verificando' | 'ok' | 'pendiente' | 'error'>('verificando')
  const [batchMonto, setBatchMonto] = useState<number | null>(null)
  useEffect(() => {
    if (status !== 'approved' || !esAddonBatch || !changeId) return
    let cancelado = false
    ;(async () => {
      setBatchState('verificando')
      await supabase.auth.getSession()
      for (let intento = 0; intento < 6 && !cancelado; intento++) {
        const { data } = await supabase.from('addon_batch_changes')
          .select('estado, monto_recurrente_nuevo').eq('id', changeId).maybeSingle()
        if (cancelado) return
        if (data?.estado === 'aplicado') {
          setBatchMonto(Number(data.monto_recurrente_nuevo))
          setBatchState('ok')
          await refetchAddons()
          return
        }
        if (data?.estado === 'fallido') { setBatchState('error'); return }
        if (intento < 5) await new Promise(r => setTimeout(r, 2500)) // el webhook puede tardar
      }
      if (!cancelado) setBatchState('pendiente')
    })()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, esAddonBatch, changeId])

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
    if (status !== 'approved' || esAddon || esAddonBatch) return
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
        body: { dimension: 'comprobantes', cantidad },
      })
      if (error || !data?.init_point) throw new Error(error?.message ?? 'No se obtuvo link de pago')
      window.location.href = data.init_point
    } catch (e: any) {
      toast.error(e.message ?? 'Error al iniciar el pago')
      setLoadingAddon(null)
    }
  }

  const planesConPago = PLANES.filter(p => p.precio !== null && p.precio > 0)

  // Pack TEMPORAL de comprobantes integrado a la tarjeta del configurador (toggle "30 días").
  // Sin sección propia: mismo catálogo que el fijo pero pago único vía mp-addon.
  const temporalProps = limits && limits.max_comprobantes !== -1
    ? {
        usoMes: limits.comprobantes_mes,
        maxMes: limits.max_comprobantes,
        comprando: loadingAddon,
        onComprar: handleComprarAddon,
      }
    : undefined

  // Pantalla de resultado de pago
  if (status) {
    return (
      <div className="min-h-screen bg-brand-gradient-dark flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          {status === 'approved' ? (
            esAddonBatch ? (
              batchState === 'ok' ? (
                <>
                  <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                  <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">¡Tu plan quedó actualizado!</h1>
                  <p className="text-gray-500 dark:text-gray-400 mb-6">
                    Se aplicaron tus add-ons. Tu suscripción pasa a{' '}
                    <strong>${(batchMonto ?? 0).toLocaleString('es-AR')}/mes</strong> desde el próximo ciclo.
                  </p>
                  <Link to="/suscripcion"
                    className="w-full block text-center bg-accent hover:bg-accent/90 text-white font-bold py-3 rounded-xl transition-all">
                    Ver mi plan
                  </Link>
                </>
              ) : batchState === 'error' ? (
                <>
                  <XCircle size={48} className="text-red-500 mx-auto mb-4" />
                  <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Tu pago se acreditó pero el cambio no se aplicó</h1>
                  <p className="text-gray-500 dark:text-gray-400 mb-8">
                    Ya avisamos a soporte y lo estamos resolviendo — no hace falta que pagues de nuevo.
                  </p>
                  <a href={`mailto:${BRAND.email}?subject=${encodeURIComponent('Cambio de plan pagado sin aplicar')}`}
                    className="w-full block text-center bg-primary text-white font-bold py-3 rounded-xl hover:bg-accent transition-all">
                    Contactar soporte
                  </a>
                </>
              ) : batchState === 'pendiente' ? (
                <>
                  <Clock size={48} className="text-yellow-500 mx-auto mb-4" />
                  <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Estamos confirmando tu pago</h1>
                  <p className="text-gray-500 dark:text-gray-400 mb-8">
                    Mercado Pago todavía no nos confirmó el pago de la diferencia. Suele tardar menos de un minuto.
                    <strong> No hace falta que pagues de nuevo.</strong>
                  </p>
                  <Link to="/suscripcion"
                    className="w-full block text-center bg-primary text-white font-bold py-3 rounded-xl hover:bg-accent transition-all">
                    Volver a mi plan
                  </Link>
                </>
              ) : (
                <>
                  <RefreshCw size={48} className="text-accent mx-auto mb-4 animate-spin" />
                  <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Aplicando tu cambio de plan…</h1>
                  <p className="text-gray-500 dark:text-gray-400 mb-6">
                    Confirmamos tu pago con Mercado Pago y actualizamos tu suscripción. Unos segundos…
                  </p>
                </>
              )
            ) : esAddon ? (
              <>
                <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">¡Add-on activado!</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  Se agregaron tus <strong>comprobantes extra</strong> a la cuenta (válidos por 30 días). Ya podés usarlos.
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
            : 'Todos los planes incluyen 30 días de prueba gratuita'}
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
                      ${plan.destacado ? 'bg-primary text-white hover:bg-accent' : 'bg-white dark:bg-gray-800 text-primary dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                    Contactar
                  </a>
                ) : (
                  <button
                    onClick={() => handleSuscribir(plan.id, mpPlanId)}
                    disabled={!!loading}
                    className={`w-full font-semibold py-3 rounded-xl transition-all text-sm disabled:opacity-60 flex items-center justify-center gap-2
                      ${plan.destacado ? 'bg-primary text-white hover:bg-accent' : 'bg-white dark:bg-gray-800 text-primary dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                    {loading === plan.id
                      ? <><RefreshCw size={15} className="animate-spin" /> Redirigiendo...</>
                      : <><ArrowRight size={15} /> Suscribirme</>}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Panel ÚNICO "Armá tu plan" (diseño configurador-addons-batch.md):
            • Suscripto con sub MP real → modo BATCH: arranca con su plan + packs tildados,
              el total muestra el recurrente nuevo, y NADA se aplica hasta "Confirmar"
              (suba → paga la diferencia hoy; baja → próxima factura menor).
            • Sin suscripción → estimador con CTA que suscribe al plan base elegido. */}
        <div className="mt-12 relative left-1/2 -translate-x-1/2 w-[94vw] lg:w-[80vw] max-w-[1600px]">
          {ADDON_FIJO_ENABLED && tieneSubMP && batchPreview && batchPreview.monto_actual > 0 ? (
            <PricingConfigurator
              key={`batch-${JSON.stringify(packsActuales)}-${batchPreview.monto_actual}`}
              app={{
                planNombre: PLANES.find(p => p.id === limits?.plan_id)?.nombre ?? 'actual',
                montoActualMP: batchPreview.monto_actual,
                initialSel: packsActuales,
                confirmando: confirmandoBatch,
                onConfirm: handleConfirmarBatch,
              }}
              temporal={temporalProps}
            />
          ) : (
            <PricingConfigurator
              ctaLabel={esActivo ? 'Cambiar a este plan' : 'Suscribirme a este plan'}
              ctaLoading={loading !== null}
              onCta={(planId) => handleSuscribir(planId, MP_PLAN_IDS[planId] ?? '')}
              temporal={temporalProps}
            />
          )}
        </div>

        {/* Modal de baja bloqueada del BATCH (REGLA #0: desactivar, no eliminar). Lista TODAS
            las dimensiones donde el uso activo excede el límite resultante del batch. */}
        {bloqueos && bloqueos.length > 0 && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setBloqueos(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={22} className="text-amber-500" />
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-lg">Todavía no podés aplicar este cambio</h3>
              </div>
              {bloqueos.map(b => (
                <p key={b.dimension} className="text-gray-600 dark:text-gray-400 text-sm mb-3">
                  Tenés <strong>{b.excedente}</strong> {labelDim(b.dimension)} activos de más para el nuevo límite
                  (<strong>{b.nuevoLimite}</strong>, usás {b.uso}). Desactivá {b.excedente} para poder confirmar.
                </p>
              ))}
              {bloqueos.some(b => b.dimension === 'sku') && (
                <p className="text-amber-600 dark:text-amber-400 text-xs bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 mb-4">
                  ⚠️ Desactivá los productos (no los elimines) para conservar su historial y trazabilidad.
                </p>
              )}
              <button onClick={() => setBloqueos(null)} className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm">
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
