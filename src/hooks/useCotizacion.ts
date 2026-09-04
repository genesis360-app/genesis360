import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { rolEnLista } from '@/lib/cajaPermisos'
import toast from 'react-hot-toast'

// Pedido de Fede (relevamiento Compras/Gastos USD, 2026-09-04): dejar de ofrecer Blue/MEP/Cripto
// como referencia — el sistema usa SIEMPRE el dólar Oficial de Banco Nación (compra y venta), sin
// elección posible. Se mantiene la columna `tenants.cotizacion_usd_casa` en el schema (guarda
// siempre 'oficial' de ahora en más) para no forzar una migración sobre datos históricos.
const CASA_UNICA = 'oficial'

// G5 Fase 2 — antes cualquier usuario con sidebar podía editar la cotización manualmente. Ahora solo
// el DUEÑO (siempre) + los roles habilitados en tenants.cotizacion_usd_roles_permitidos pueden cargar
// un valor manual; el resto solo puede "refrescar" desde la API (siempre Oficial BNA).
export function useCotizacion() {
  const { tenant, user, setTenant } = useAuthStore()
  const [loadingApi, setLoadingApi] = useState(false)

  const cotizacion         = tenant?.cotizacion_usd ?? 0
  const cotizacionCompra   = (tenant as any)?.cotizacion_usd_compra ?? 0
  const updatedAt          = tenant?.cotizacion_usd_updated_at
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

  const fetchDesdeApi = async () => {
    if (!tenant) return
    setLoadingApi(true)
    try {
      const res = await fetch(`https://dolarapi.com/v1/dolares/${CASA_UNICA}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (!data?.venta) throw new Error()
      const { data: updated, error } = await supabase
        .from('tenants')
        .update({
          cotizacion_usd: data.venta,
          cotizacion_usd_compra: data.compra ?? null,
          cotizacion_usd_casa: CASA_UNICA,
          cotizacion_usd_updated_at: new Date().toISOString(),
        })
        .eq('id', tenant.id)
        .select().single()
      if (error || !updated) throw error ?? new Error()
      setTenant(updated)
      toast.success(`Cotización Oficial BNA: $${data.venta.toLocaleString('es-AR')}`)
    } catch {
      toast.error('No se pudo obtener la cotización. Ingresala manualmente.')
    } finally {
      setLoadingApi(false)
    }
  }

  return { cotizacion, cotizacionCompra, updatedAt, puedeElegirTipo, guardar, fetchDesdeApi, loadingApi }
}
