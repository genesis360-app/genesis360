import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { MODO_BASICO_ENABLED } from '@/config/brand'
import { esModoAvanzado, motivoBasico, type MotivoBasico } from '@/lib/modoOperacion'

/**
 * Único punto de consulta del modo de operación para toda la UI.
 * `avanzado` = el tenant activó el modo avanzado Y su plan lo permite (puede_wms).
 * Mientras carga el plan se asume avanzado si el toggle del tenant está ON
 * (evita parpadeo de nav/tabs para los tenants existentes, todos en avanzado).
 */
export function useModoOperacion(): {
  avanzado: boolean
  motivo: MotivoBasico
  loading: boolean
} {
  const { tenant } = useAuthStore()
  const { limits, loading } = usePlanLimits()

  const puedeWms = limits ? limits.puede_wms : tenant?.modo_operacion === 'avanzado'
  const avanzado = esModoAvanzado(tenant?.modo_operacion, puedeWms, MODO_BASICO_ENABLED)
  const motivo = motivoBasico(tenant?.modo_operacion, puedeWms, MODO_BASICO_ENABLED)

  return { avanzado, motivo, loading }
}
