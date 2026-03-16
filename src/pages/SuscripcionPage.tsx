import { Link } from 'react-router-dom'
import { Package, CheckCircle } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

export default function SuscripcionPage() {
  const { tenant } = useAuthStore()
  const mpPublicKey = import.meta.env.VITE_MP_PUBLIC_KEY
  const priceId = import.meta.env.VITE_MP_PRICE_ID

  const handleActivar = async () => {
    const res = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mpPublicKey}`,
      },
      body: JSON.stringify({
        preapproval_plan_id: priceId,
        back_url: window.location.origin + '/dashboard',
        external_reference: tenant?.id,
      }),
    })
    const data = await res.json()
    if (data.init_point) window.location.href = data.init_point
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1E3A5F] to-[#2E75B6] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
        <Package size={40} className="text-[#1E3A5F] mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-[#1E3A5F] mb-2">Tu prueba gratuita venció</h1>
        <p className="text-gray-500 mb-6">Activá tu suscripción para continuar usando StockApp.</p>
        <ul className="text-left space-y-2 mb-6">
          {['Inventario ilimitado','Alertas de stock','Reportes y exportaciones','Soporte por email'].map(f => (
            <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
              <CheckCircle size={16} className="text-green-500" /> {f}
            </li>
          ))}
        </ul>
        <button onClick={handleActivar}
          className="w-full bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-bold py-3 rounded-xl transition-all mb-3">
          Activar suscripción con Mercado Pago
        </button>
        <Link to="/login" className="text-sm text-gray-400 hover:underline">Cerrar sesión</Link>
      </div>
    </div>
  )
}
