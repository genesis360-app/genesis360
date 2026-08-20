import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { rolEnLista } from '@/lib/cajaPermisos'
import toast from 'react-hot-toast'

export const TIPOS_DOLAR = [
  { casa: 'blue',    label: 'Dólar Blue' },
  { casa: 'oficial', label: 'Dólar Oficial' },
  { casa: 'bolsa',   label: 'MEP / Bolsa' },
  { casa: 'cripto',  label: 'Cripto' },
]

// G5 Fase 2 — antes cualquier usuario con sidebar podía elegir/editar la cotización. Ahora solo el
// DUEÑO (siempre) + los roles habilitados en tenants.cotizacion_usd_roles_permitidos pueden elegir
// tipo de dólar o cargar un valor manual; el resto solo puede "refrescar" repitiendo la última casa.
export function useCotizacion() {
  const { tenant, user, setTenant } = useAuthStore()
  const [loadingApi, setLoadingApi] = useState(false)

  const cotizacion         = tenant?.cotizacion_usd ?? 0
  const cotizacionCompra   = (tenant as any)?.cotizacion_usd_compra ?? 0
  const updatedAt          = tenant?.cotizacion_usd_updated_at
  const casaActual         = (tenant as any)?.cotizacion_usd_casa || 'blue'
  // DUEÑO siempre puede elegir, sea cual sea lo guardado — cotizacion_usd_roles_permitidos son roles
  // ADICIONALES (nunca reemplaza a DUEÑO), a diferencia de accedeABoveda donde la lista es completa.
  const puedeElegirTipo    = user?.rol === 'DUEÑO' || rolEnLista(
    user?.rol as any, (user as any)?.rol_custom_id,
    (tenant as any)?.cotizacion_usd_roles_permitidos ?? [],
  )

  const guardar = async (valor: number): Promise<boolean> => {
    if (!tenant) return false
    if (!puedeElegirTipo) { toast.error('Tu rol no puede cargar la cotización manualmente'); return false }
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

  // `casa` solo se respeta si el rol puede elegir tipo — de lo contrario siempre refresca con la
  // última casa usada (o 'blue' si el tenant nunca eligió una), nunca con la que pase el caller.
  const fetchDesdeApi = async (casa: string = 'blue') => {
    if (!tenant) return
    const casaEfectiva = puedeElegirTipo ? casa : casaActual
    setLoadingApi(true)
    try {
      const res = await fetch(`https://dolarapi.com/v1/dolares/${casaEfectiva}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (!data?.venta) throw new Error()
      const { data: updated, error } = await supabase
        .from('tenants')
        .update({
          cotizacion_usd: data.venta,
          cotizacion_usd_compra: data.compra ?? null,
          cotizacion_usd_casa: casaEfectiva,
          cotizacion_usd_updated_at: new Date().toISOString(),
        })
        .eq('id', tenant.id)
        .select().single()
      if (error || !updated) throw error ?? new Error()
      setTenant(updated)
      toast.success(`Cotización ${TIPOS_DOLAR.find(t => t.casa === casaEfectiva)?.label ?? casaEfectiva}: $${data.venta.toLocaleString('es-AR')}`)
    } catch {
      toast.error('No se pudo obtener la cotización. Ingresala manualmente.')
    } finally {
      setLoadingApi(false)
    }
  }

  return { cotizacion, cotizacionCompra, updatedAt, casaActual, puedeElegirTipo, guardar, fetchDesdeApi, loadingApi }
}
