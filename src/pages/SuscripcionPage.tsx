import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BRAND, PLANES } from '@/config/brand'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import {
  Package, Check, X, CheckCircle, XCircle, Clock,
  ArrowRight, Shield, RefreshCw
} from 'lucide-react'
import toast from 'react-hot-toast'

const MP_PLAN_IDS: Record<string, string> = {
  basico: import.meta.env.VITE_MP_PLAN_BASICO ?? '',
  pro:    import.meta.env.VITE_MP_PLAN_PRO ?? '',
}

export default function SuscripcionPage() {
  const { tenant, loadUserData } = useAuthStore()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)

  // Resultado de pago redirigido desde MP
  const status = searchParams.get('status')
  const preapprovalId = searchParams.get('preapproval_id')

  const handleSuscribir = async (planId: string, mpPlanId: string) => {
    if (!mpPlanId) { toast.error('Plan no configurado'); return }
    setLoading(planId)
    try {
      const { data, error } = await supabase.functions.invoke('crear-suscripcion', {
        body: { plan_id: mpPlanId },
      })
      if (error || !data?.init_point) throw new Error(error?.message ?? 'No se obtuvo link de pago')
      window.location.href = data.init_point
    } catch (e: any) {
      toast.error(e.message ?? 'Error al iniciar el pago')
      setLoading(null)
    }
  }

  const handleVerificarPago = async () => {
    if (!tenant) return
    setLoading('verificando')
    try {
      // El webhook de MP debería haber activado el tenant automáticamente via external_reference.
      // Recargamos los datos del usuario para reflejar el estado actualizado.
      await loadUserData(tenant.id)
      // Si el webhook ya actuó, el status será 'active'
      const { data } = await supabase.from('tenants').select('subscription_status').eq('id', tenant.id).single()
      if (data?.subscription_status === 'active') {
        toast.success('¡Suscripción activada!')
        window.location.href = '/dashboard'
        return
      }
      // Fallback: activar manualmente con el preapproval_id del redirect
      if (preapprovalId) {
        await supabase.from('tenants').update({
          subscription_status: 'active',
          mp_subscription_id: preapprovalId,
        }).eq('id', tenant.id)
        await loadUserData(tenant.id)
        toast.success('¡Suscripción activada!')
        window.location.href = '/dashboard'
      } else {
        toast('Tu pago está siendo procesado. En breve recibirás confirmación.', { icon: '⏳' })
        window.location.href = '/dashboard'
      }
    } catch {
      toast.error('Error al verificar el pago. Contactá soporte.')
    } finally {
      setLoading(null)
    }
  }

  const planesConPago = PLANES.filter(p => p.precio !== null && p.precio > 0)

  // Pantalla de resultado de pago
  if (status) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary to-accent flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          {status === 'approved' ? (
            <>
              <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">¡Pago aprobado!</h1>
              <p className="text-gray-500 dark:text-gray-400 mb-6">Tu suscripción está siendo procesada. En unos segundos tu cuenta quedará activa.</p>
              <button onClick={handleVerificarPago} disabled={loading === 'verificando'}
                className="w-full bg-accent hover:bg-accent/90 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {loading === 'verificando'
                  ? <><RefreshCw size={16} className="animate-spin" /> Verificando...</>
                  : <><CheckCircle size={16} /> Ir al dashboard</>}
              </button>
            </>
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
    <div className="min-h-screen bg-gradient-to-br from-primary via-primary to-accent">
      {/* Header */}
      <div className="text-center pt-12 pb-8 px-4">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-white dark:bg-gray-800/10 rounded-2xl mb-4">
          <Package size={28} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          {tenant?.subscription_status === 'trial'
            ? '¡Tu prueba gratuita está por vencer!'
            : 'Elegí tu plan'}
        </h1>
        <p className="text-blue-200">
          {tenant?.subscription_status === 'trial'
            ? 'Activá tu suscripción para seguir usando Stokio sin interrupciones'
            : 'Todos los planes incluyen 7 días de prueba gratuita'}
        </p>
      </div>

      {/* Planes */}
      <div className="max-w-5xl mx-auto px-4 pb-12">
        <div className="grid md:grid-cols-3 gap-6">
          {planesConPago.map(plan => {
            const mpPlanId = MP_PLAN_IDS[plan.id] ?? ''
            const esActual = tenant?.mp_subscription_id?.includes(plan.id)

            return (
              <div key={plan.id}
                className={`rounded-2xl p-6 flex flex-col relative
                  ${plan.destacado
                    ? 'bg-white dark:bg-gray-800 shadow-2xl scale-105'
                    : 'bg-white dark:bg-gray-800/10 border border-white/20'}`}>

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

        {/* Garantías */}
        <div className="mt-10 flex flex-wrap justify-center gap-6 text-blue-200 text-sm">
          <span className="flex items-center gap-2"><Shield size={16} /> Pago seguro con Mercado Pago</span>
          <span className="flex items-center gap-2"><RefreshCw size={16} /> Cancelá cuando quieras</span>
          <span className="flex items-center gap-2"><Check size={16} /> Sin costos ocultos</span>
        </div>

        {tenant && (
          <div className="text-center mt-6">
            <Link to="/dashboard" className="text-blue-300 text-sm hover:text-white transition-colors">
              Volver al dashboard →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
