import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { normalizarVigente, tasaUsdAArs, avisoCotizacion, type CotizacionVigente } from '@/lib/cotizacionBna'

// D-1 fase 2 (GO, 2026-09-25) — la cotización del dólar es UNA y sale sola: vendedor divisa del
// Banco Nación del día hábil anterior (`src/lib/cotizacionBna.ts`). Reemplaza a:
//   · dolarapi "oficial" (que es BNA BILLETE) guardado en `tenants.cotizacion_usd/_compra`,
//   · la regla "USD→ARS a COMPRA" (v1.207.0) y
//   · la carga MANUAL del dólar: A-4 — "automática si hay fuente; si no, manual". El dólar tiene
//     fuente. Las columnas de `tenants` quedan en el schema (histórico) pero nadie las lee.
//
// La lectura pasa por la EF `cotizacion-bna`: además de devolver la vigente, captura del BNA si la
// última captura tiene más de 30 min — es el "se actualiza al iniciar sesión" de A-2, de respaldo
// del cron diario. Si la EF no responde, se lee la vigente directo (`fn_cotizacion_bna_vigente`).

interface EstadoCotizacion {
  vigente: CotizacionVigente | null
  capturaFallida: boolean
}

export const COTIZACION_QUERY_KEY = ['cotizacion-bna', 'USD'] as const

async function leerCotizacion(): Promise<EstadoCotizacion> {
  try {
    const { data, error } = await supabase.functions.invoke('cotizacion-bna', { body: {} })
    if (error || !data?.ok) throw error ?? new Error(data?.error ?? 'cotizacion-bna')
    return {
      vigente: normalizarVigente(data.vigente),
      capturaFallida: data.capturo === true && data.captura_ok !== true,
    }
  } catch {
    const { data, error } = await supabase.rpc('fn_cotizacion_bna_vigente', { p_moneda: 'USD' })
    if (error) throw error
    return { vigente: normalizarVigente(data), capturaFallida: true }
  }
}

export function useCotizacion() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: COTIZACION_QUERY_KEY,
    queryFn: leerCotizacion,
    enabled: !!tenant,
    // La tasa es fija durante todo el día; no hace falta pedirla en cada navegación.
    staleTime: 10 * 60 * 1000,
  })

  const vigente = data?.vigente ?? null
  // 🛑 La ÚNICA tasa USD→ARS del sistema. 0 = no hay: el que convierte tiene que frenar (D5).
  const tasa = tasaUsdAArs(vigente)

  return {
    /** Vendedor divisa BNA del día hábil anterior. */
    cotizacion: tasa,
    /** Alias de `cotizacion` — se mantiene para que se lea explícito en los caminos de plata. */
    cotizacionUsdAArs: tasa,
    /** Fecha publicada por el BNA de la tasa en uso (`YYYY-MM-DD`). */
    fecha: vigente?.fecha ?? null,
    aviso: data ? avisoCotizacion(vigente, data.capturaFallida) : null,
    cargando: isLoading,
    actualizando: isFetching,
    refrescar: () => qc.invalidateQueries({ queryKey: COTIZACION_QUERY_KEY }),
  }
}
