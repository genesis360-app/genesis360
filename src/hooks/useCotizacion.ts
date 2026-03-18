import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

export const TIPOS_DOLAR = [
  { casa: 'blue',    label: 'Dólar Blue' },
  { casa: 'oficial', label: 'Dólar Oficial' },
  { casa: 'bolsa',   label: 'MEP / Bolsa' },
  { casa: 'cripto',  label: 'Cripto' },
]

export function useCotizacion() {
  const { tenant, setTenant } = useAuthStore()
  const [loadingApi, setLoadingApi] = useState(false)

  const cotizacion = tenant?.cotizacion_usd ?? 0
  const updatedAt  = tenant?.cotizacion_usd_updated_at

  const guardar = async (valor: number): Promise<boolean> => {
    if (!tenant) return false
    const cotizacion_usd            = valor > 0 ? valor : null
    const cotizacion_usd_updated_at = valor > 0 ? new Date().toISOString() : null
    const { error } = await supabase
      .from('tenants')
      .update({ cotizacion_usd, cotizacion_usd_updated_at })
      .eq('id', tenant.id)
    if (error) { toast.error('Error al guardar cotización'); return false }
    setTenant({ ...tenant, cotizacion_usd: cotizacion_usd ?? undefined, cotizacion_usd_updated_at: cotizacion_usd_updated_at ?? undefined })
    return true
  }

  const fetchDesdeApi = async (casa: string = 'blue') => {
    setLoadingApi(true)
    try {
      const res = await fetch(`https://dolarapi.com/v1/dolares/${casa}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (!data?.venta) throw new Error()
      await guardar(data.venta)
      toast.success(`Cotización ${TIPOS_DOLAR.find(t => t.casa === casa)?.label ?? casa}: $${data.venta.toLocaleString('es-AR')}`)
    } catch {
      toast.error('No se pudo obtener la cotización. Ingresala manualmente.')
    } finally {
      setLoadingApi(false)
    }
  }

  return { cotizacion, updatedAt, guardar, fetchDesdeApi, loadingApi }
}
