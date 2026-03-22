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

const MP_PLAN_LIMITS: Record<string, { max_users: number; max_productos: number }> = {
  [import.meta.env.VITE_MP_PLAN_BASICO ?? '']: { max_users: 2,  max_productos: 500  },
  [import.meta.env.VITE_MP_PLAN_PRO    ?? '']: { max_users: 10, max_productos: 5000 },
}

export default function SuscripcionPage() {
  const { tenant, loadUserData } = useAuthStore()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)

  // Resultado de pago redirigido desde MP
  const status = searchParams.get('status')
  const preapprovalId = searchParams.get('preapproval_id')

  const handleSuscribir = (planId: string, mpPlanId: string) => {
    if (!mpPlanId) { toast.error('Plan no configurado'); return }
    // El init_point de MP es una URL pública — no requiere llamada al backend
    const url = `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${mpPlanId}`
    sessionStorage.setItem('mp_plan_id', mpPlanId)
    window.location.href = url
  }

  const handleVerificarPago = async () => {
    if (!preapprovalId || !tenant) return
    setLoading('verificando')
    try {
      const savedPlanId = sessionStorage.getItem('mp_plan_id') ?? ''
      const planLimits = MP_PLAN_LIMITS[savedPlanId] ?? {}
      sessionStorage.removeItem('mp_plan_id')

      const { error } = await supabase.from('tenants').update({
        subscription_status: 'active',
        mp_subscription_id: preapprovalId,
        ...(planLimits.max_users ? {
          max_users: planLimits.max_users,
          max_productos: planLimits.max_productos,
        } : {}),
      }).eq('id', tenant.id)

      if (error) throw error
      await loadUserData(tenant.id)
      toast.success('¡Suscripción activada!')
      window.location.href = '/dashboard'
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
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          {status === 'approved' ? (
            <>
              <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-800 mb-2">¡Pago aprobado!</h1>
              <p className="text-gray-500 mb-6">Tu suscripción está siendo procesada. En unos segundos tu cuenta quedará activa.</p>
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
              <h1 className="text-2xl font-bold text-gray-800 mb-2">Pago pendiente</h1>
              <p className="text-gray-500 mb-6">Tu pago está siendo procesado. Te avisaremos por email cuando se confirme.</p>
              <Link to="/dashboard" className="w-full block text-center bg-primary text-white font-bold py-3 rounded-xl hover:bg-accent transition-all">
                Volver al dashboard
              </Link>
            </>
          ) : (
            <>
              <XCircle size={48} className="text-red-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-800 mb-2">Pago no completado</h1>
              <p className="text-gray-500 mb-6">No se procesó el pago. Podés intentarlo de nuevo.</p>
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
        <div className="inline-flex items-center justify-center w-14 h-14 bg-white/10 rounded-2xl mb-4">
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
                    ? 'bg-white shadow-2xl scale-105'
                    : 'bg-white/10 border border-white/20'}`}>

                {plan.destacado && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-xs font-bold px-3 py-1 rounded-full">
                    MÁS POPULAR
                  </div>
                )}

                <div className="mb-5">
                  <h3 className={`font-bold text-xl ${plan.destacado ? 'text-primary' : 'text-white'}`}>
                    {plan.nombre}
                  </h3>
                  <p className={`text-sm mt-0.5 ${plan.destacado ? 'text-gray-400' : 'text-blue-200'}`}>
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
                        <span className={`text-sm ml-1 ${plan.destacado ? 'text-gray-400' : 'text-blue-200'}`}>/mes</span>
                      </div>
                    )}
                  </div>
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={15} className={`flex-shrink-0 mt-0.5 ${plan.destacado ? 'text-green-500' : 'text-green-400'}`} />
                      <span className={plan.destacado ? 'text-gray-600' : 'text-blue-100'}>{f}</span>
                    </li>
                  ))}
                  {plan.noIncluye.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm opacity-40">
                      <X size={15} className="flex-shrink-0 mt-0.5 text-gray-400" />
                      <span className={plan.destacado ? 'text-gray-400' : 'text-blue-200'}>{f}</span>
                    </li>
                  ))}
                </ul>

                {esActual ? (
                  <div className={`text-center py-3 rounded-xl text-sm font-semibold
                    ${plan.destacado ? 'bg-green-100 text-green-700' : 'bg-white/20 text-white'}`}>
                    ✓ Plan actual
                  </div>
                ) : plan.precio === null ? (
                  <a href={`mailto:${BRAND.email}?subject=Plan Enterprise`}
                    className={`block text-center font-semibold py-3 rounded-xl transition-all text-sm
                      ${plan.destacado ? 'bg-primary text-white hover:bg-accent' : 'bg-white text-primary hover:bg-accent/10'}`}>
                    Contactar
                  </a>
                ) : (
                  <button
                    onClick={() => handleSuscribir(plan.id, mpPlanId)}
                    disabled={!!loading}
                    className={`w-full font-semibold py-3 rounded-xl transition-all text-sm disabled:opacity-60 flex items-center justify-center gap-2
                      ${plan.destacado ? 'bg-primary text-white hover:bg-accent' : 'bg-white text-primary hover:bg-accent/10'}`}>
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
