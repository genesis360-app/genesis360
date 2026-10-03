/**
 * pedidoPrioridad.ts — Prioridad de preparación por fecha de entrega (pedido de GO 2026-10-02).
 *
 * La fecha de entrega acordada en la venta con envío llega al pedido (mig 465). Con esto el equipo de preparación ve
 * qué pedidos van primero: atrasados, los de hoy, los de mañana, el resto por fecha y al final los que no tienen fecha.
 * La priorización real de tareas (cola WMS, asignación automática) queda para más adelante.
 *
 * Las fechas son `date` de Postgres ('2026-10-05'): se comparan como texto contra el día LOCAL. Nunca `new Date(fecha)`
 * para mostrarla: lo toma como medianoche UTC y en Argentina se ve el día anterior.
 */

export type UrgenciaEntrega = 'atrasado' | 'hoy' | 'manana' | 'proximo'

const ESTADOS_CERRADOS = ['entregado', 'entregado_parcial', 'cancelado']

/** Día siguiente de una fecha 'YYYY-MM-DD' (sin pasar por UTC). */
function diaSiguiente(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Urgencia de un pedido abierto según su fecha de entrega; null si no tiene fecha o ya está cerrado. */
export function urgenciaEntrega(fecha: string | null | undefined, estado: string, hoy: string): UrgenciaEntrega | null {
  if (!fecha || ESTADOS_CERRADOS.includes(estado)) return null
  const f = fecha.slice(0, 10)
  if (f < hoy) return 'atrasado'
  if (f === hoy) return 'hoy'
  if (f === diaSiguiente(hoy)) return 'manana'
  return 'proximo'
}

/**
 * Orden para preparar: abiertos con fecha primero (la más cercana arriba; los atrasados quedan primeros solos),
 * después abiertos sin fecha, al final los cerrados. Dentro de cada grupo, el más nuevo primero.
 */
export function ordenarPorEntrega<P extends { fecha_entrega_solicitada?: string | null; estado: string; created_at: string }>(
  pedidos: ReadonlyArray<P>,
): P[] {
  const grupo = (p: P) => ESTADOS_CERRADOS.includes(p.estado) ? 2 : (p.fecha_entrega_solicitada ? 0 : 1)
  return [...pedidos].sort((a, b) => {
    const ga = grupo(a), gb = grupo(b)
    if (ga !== gb) return ga - gb
    if (ga === 0) {
      const fa = a.fecha_entrega_solicitada!.slice(0, 10), fb = b.fecha_entrega_solicitada!.slice(0, 10)
      if (fa !== fb) return fa < fb ? -1 : 1
    }
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  })
}

/** '2026-10-05' → '5/10/2026' (sin corrimiento de zona horaria). */
export function fechaEntregaLegible(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}
