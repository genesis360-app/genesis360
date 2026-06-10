import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, Wallet, ArrowLeft, Volume2, VolumeX, CheckCircle2, Circle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { getSonidoCobro, setSonidoCobro } from '@/lib/sonidoCobro'
import { BRAND } from '@/config/brand'

// M3 (relevamiento Caja) — Panel de cajero simplificado para tablets / touch.
// Vista de botones grandes que lanza los flujos existentes (no duplica lógica de caja).
// Incluye el toggle de sonido al cobrar (M4).

export default function PanelCajeroPage() {
  const navigate = useNavigate()
  const { tenant, user } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const [sonido, setSonidoState] = useState(getSonidoCobro())

  // Sesiones de caja abiertas del usuario en la sucursal activa
  const { data: sesiones = [] } = useQuery({
    queryKey: ['panel-cajero-sesiones', tenant?.id, user?.id, sucursalId],
    enabled: !!tenant && !!user,
    refetchInterval: 20_000,
    queryFn: async () => {
      let q = supabase.from('caja_sesiones')
        .select('id, abierta_at, cajas(nombre)')
        .eq('tenant_id', tenant!.id).eq('usuario_id', user!.id).eq('estado', 'abierta')
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q.order('abierta_at', { ascending: false })
      return data ?? []
    },
  })

  const tieneCajaAbierta = sesiones.length > 0

  const toggleSonido = () => {
    const next = !sonido
    setSonidoState(next)
    setSonidoCobro(next)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/caja')}
            className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0">
            <p className="font-bold text-lg text-primary dark:text-white truncate">Modo Cajero</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{BRAND.name} · {user?.nombre_display ?? ''}</p>
          </div>
        </div>
        <button onClick={toggleSonido}
          title={sonido ? 'Sonido al cobrar: activado' : 'Sonido al cobrar: desactivado'}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${sonido ? 'bg-accent/10 text-accent' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
          {sonido ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span className="hidden sm:inline">{sonido ? 'Sonido ON' : 'Sonido OFF'}</span>
        </button>
      </header>

      {/* Estado de caja */}
      <div className="px-4 sm:px-6 pt-5">
        <div className={`rounded-2xl px-5 py-4 flex items-center gap-3 ${tieneCajaAbierta
          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
          : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'}`}>
          {tieneCajaAbierta ? <CheckCircle2 size={22} /> : <Circle size={22} />}
          <div className="min-w-0">
            {tieneCajaAbierta ? (
              <>
                <p className="font-semibold">Caja abierta</p>
                <p className="text-sm opacity-80 truncate">
                  {sesiones.map((s: any) => s.cajas?.nombre ?? 'Caja').join(' · ')}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">No tenés una caja abierta</p>
                <p className="text-sm opacity-80">Abrí una caja antes de cobrar.</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Botones grandes */}
      <main className="flex-1 px-4 sm:px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
        <button onClick={() => navigate('/ventas')}
          className="flex flex-col items-center justify-center gap-3 bg-accent hover:bg-accent/90 text-white rounded-3xl py-12 shadow-sm transition-all active:scale-[0.98]">
          <ShoppingCart size={56} />
          <span className="text-2xl font-bold">Cobrar</span>
          <span className="text-sm opacity-80">Punto de venta</span>
        </button>

        <button onClick={() => navigate('/caja')}
          className="flex flex-col items-center justify-center gap-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-accent rounded-3xl py-12 shadow-sm transition-all active:scale-[0.98]">
          <Wallet size={56} className="text-accent" />
          <span className="text-2xl font-bold">{tieneCajaAbierta ? 'Operar caja' : 'Abrir caja'}</span>
          <span className="text-sm text-gray-400 dark:text-gray-500">Ingreso · arqueo · cierre</span>
        </button>
      </main>
    </div>
  )
}
