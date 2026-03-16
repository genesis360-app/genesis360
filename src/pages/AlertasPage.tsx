// ─── AlertasPage ──────────────────────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import type { Alerta } from '@/lib/supabase'

export default function AlertasPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()

  const { data: alertas = [], isLoading } = useQuery({
    queryKey: ['alertas-page', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alertas')
        .select('*, productos(nombre,sku,stock_actual,stock_minimo)')
        .eq('tenant_id', tenant!.id)
        .eq('resuelta', false)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Alerta[]
    },
    enabled: !!tenant,
  })

  const resolver = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alertas').update({ resuelta: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertas'] })
      qc.invalidateQueries({ queryKey: ['alertas-page'] })
      toast.success('Alerta marcada como resuelta')
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Alertas de Stock</h1>
        <p className="text-gray-500 text-sm mt-0.5">{alertas.length} alertas activas</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1E3A5F]" />
        </div>
      ) : alertas.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
          <CheckCircle size={40} className="text-green-400 mx-auto mb-3" />
          <p className="text-gray-500">¡Todo en orden! No hay alertas activas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alertas.map(a => (
            <div key={a.id} className="bg-white rounded-xl p-4 shadow-sm border border-red-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                  <AlertTriangle size={18} className="text-red-500" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800">{(a as any).productos?.nombre}</p>
                  <p className="text-xs text-gray-500">
                    SKU: {(a as any).productos?.sku} •
                    Stock actual: <span className="text-red-600 font-medium">{(a as any).productos?.stock_actual}</span> •
                    Mínimo: {(a as any).productos?.stock_minimo}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/movimientos"
                  className="text-xs bg-[#1E3A5F] text-white px-3 py-1.5 rounded-lg hover:bg-[#2E75B6] transition-all"
                >
                  Ingresar stock
                </Link>
                <button
                  onClick={() => resolver.mutate(a.id)}
                  className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                >
                  Resolver
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
