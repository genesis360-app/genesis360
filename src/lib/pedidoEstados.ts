// Etiqueta y colores de cada estado de pedido (Pedidos y Picking → Tareas).
export const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  borrador:            { label: 'Borrador',            cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
  confirmado:          { label: 'Pendiente',            cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  en_preparacion:      { label: 'En preparación',       cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  listo_para_entrega:  { label: 'Listo para entrega',   cls: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' },
  entregado:           { label: 'Entregado',            cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  entregado_parcial:   { label: 'Entregado parcial',    cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
  cancelado:           { label: 'Cancelado',            cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
}
