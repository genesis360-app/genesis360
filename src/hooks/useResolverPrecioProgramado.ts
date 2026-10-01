import { supabase } from '@/lib/supabase'
import { useElegir } from '@/hooks/useConfirm'
import { fmtPesos } from '@/lib/formato'
import { formatearVigencia } from '@/lib/precioProgramado'
import { enTandas, mensajeConflicto, type DecisionProgramado, type ProgramadoPendiente } from '@/lib/precioProgramadoConflicto'
import toast from 'react-hot-toast'

/**
 * C-3 — antes de cambiar `precio_venta` "ahora", preguntar qué hacer con los precios programados pendientes de esos
 * productos (ver `src/lib/precioProgramadoConflicto.ts`).
 *
 * Devuelve `true` si se puede seguir guardando, `false` si hay que frenar (eligió "Volver", o falló la
 * cancelación: guardar igual dejaría el programado vivo para pisar el precio nuevo, justo lo que se quiere evitar).
 */
/**
 * Busca los precios programados pendientes de esos productos y, si hay, pregunta qué hacer. NO cancela nada.
 * `'sin'` = no había pendientes; `null` = eligió "Volver" o no se pudo revisar.
 */
function usePreguntarPendientes() {
  const elegir = useElegir()
  return async (productoIds: string[], nombres: Record<string, string> = {}): Promise<{ decision: DecisionProgramado | 'sin' | null; pendientes: ProgramadoPendiente[] }> => {
    const ids = [...new Set(productoIds.filter(Boolean))]
    if (ids.length === 0) return { decision: 'sin', pendientes: [] }

    const pendientes: ProgramadoPendiente[] = []
    for (const tanda of enTandas(ids)) {
      const { data, error } = await supabase.from('precios_programados')
        .select('id, producto_id, precio_venta, vigente_desde')
        .eq('estado', 'pendiente').in('producto_id', tanda)
      if (error) { toast.error('No se pudo revisar si hay precios programados. Intentá de nuevo.'); return { decision: null, pendientes: [] } }
      pendientes.push(...((data ?? []) as ProgramadoPendiente[]))
    }
    if (pendientes.length === 0) return { decision: 'sin', pendientes }

    const decision = await elegir<DecisionProgramado>(
      mensajeConflicto(pendientes, fmtPesos, formatearVigencia, nombres),
      {
        titulo: pendientes.length === 1 ? 'Hay un precio programado' : 'Hay precios programados',
        opciones: [
          { valor: 'cancelar', texto: pendientes.length === 1 ? 'Cancelar el programado y guardar' : 'Cancelar los programados y guardar', primario: true },
          { valor: 'mantener', texto: pendientes.length === 1 ? 'Guardar y mantener el programado' : 'Guardar y mantenerlos' },
        ],
      },
    )
    return { decision, pendientes }
  }
}

/**
 * Solo PREGUNTA (para cargas que cancelan dentro de su propia transacción, como el importador — mig 447).
 * Devuelve `'cancelar'`, `'mantener'`, `'sin'` (no hay programados) o `null` (frenar).
 */
export function usePreguntarPrecioProgramado() {
  const preguntar = usePreguntarPendientes()
  return async (productoIds: string[], nombres: Record<string, string> = {}) => (await preguntar(productoIds, nombres)).decision
}

export function useResolverPrecioProgramado() {
  const preguntar = usePreguntarPendientes()

  return async (productoIds: string[], nombres: Record<string, string> = {}): Promise<boolean> => {
    const { decision, pendientes } = await preguntar(productoIds, nombres)
    if (decision === 'sin') return true
    if (decision === null) return false
    if (decision === 'mantener') return true

    for (const p of pendientes) {
      const { error } = await supabase.rpc('fn_cancelar_precio_programado', { p_id: p.id })
      if (error) {
        toast.error(`No se pudo cancelar el precio programado: ${error.message}. No se guardó el cambio.`)
        return false
      }
    }
    toast.success(pendientes.length === 1 ? 'Precio programado cancelado' : `${pendientes.length} precios programados cancelados`)
    return true
  }
}
