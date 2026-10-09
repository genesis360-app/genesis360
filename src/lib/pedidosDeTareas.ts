import { supabase } from '@/lib/supabase'

/**
 * Ubicaciones Globales (mig 490, UAT §111): una tarea de picking puede ser de esta sucursal y su pedido de OTRA (el stock
 * de esta sucursal estaba en una ubicación Global y lo vendió otra). La RLS de `pedidos` le oculta ese pedido al usuario
 * restringido, y el embed `pedidos(...)` llega en null → el operario no sabía de qué pedido ni para qué sucursal pickeaba.
 * Completa `t.pedidos` con la función de la base (número, estado, venta, fecha y sucursal DESTINO). Si falla, deja las
 * tareas como venían.
 */
export async function completarPedidosDeTareas<T extends { pedido_id?: string | null; pedidos?: any }>(tareas: T[]): Promise<T[]> {
  const ids = [...new Set(tareas.map(t => t.pedido_id).filter(Boolean))] as string[]
  if (ids.length === 0) return tareas
  const { data, error } = await supabase.rpc('fn_pedidos_de_mis_tareas', { p_pedido_ids: ids })
  if (error) { console.warn('[pedidos de tareas]', error.message); return tareas }
  const porId = new Map(((data ?? []) as any[]).map(p => [p.id, p]))
  return tareas.map(t => {
    const p = t.pedido_id ? porId.get(t.pedido_id) : null
    return p ? { ...t, pedidos: { ...(t.pedidos ?? {}), ...p } } : t
  })
}
