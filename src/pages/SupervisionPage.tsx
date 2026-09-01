import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { UserCog, ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { puedeSupervisarModulo } from '@/lib/permisosModulo'

// Vista agregada cross-módulo del patrón de Supervisor (mig 347, relevamiento derivado #2 hacia
// Repositores, decisión B1) — "¿qué tengo pendiente en TODO el negocio?" de un vistazo, sin entrar
// módulo por módulo. La acción real (aprobar/rechazar/reasignar) vive en la pestaña "Supervisión" de
// cada módulo — esta página solo agrega y linkea. Extender MODULOS al retrofitear un módulo nuevo.
const MODULOS: { key: string; label: string; ruta: string }[] = [
  { key: 'inventario', label: 'Inventario', ruta: '/inventario?tab=autorizaciones' },
  { key: 'productos', label: 'Productos', ruta: '/productos?tab=autorizaciones' },
  { key: 'clientes', label: 'Clientes', ruta: '/clientes?tab=autorizaciones' },
  { key: 'envios', label: 'Envíos', ruta: '/envios?tab=autorizaciones' },
  { key: 'proveedores', label: 'Proveedores', ruta: '/proveedores?tab=autorizaciones' },
  { key: 'pedidos', label: 'Pedidos', ruta: '/pedidos?tab=autorizaciones' },
  { key: 'rrhh', label: 'RRHH', ruta: '/rrhh?tab=autorizaciones' },
]

// GO (2026-08-12): la lista cruda de 5 solicitudes al azar ("¿por qué esas 5?") no agregaba valor —
// solo confirmaba que había más sin decir qué. Reemplazado por un desglose por tipo (cuántas de cada
// categoría), que es la pregunta real que alguien se hace al abrir esta página. Mismos `tipo` que usa
// `resumenDeAutorizacion` en InventarioPage.tsx — si se agrega un tipo nuevo ahí, sumarlo acá también.
const TIPO_LABELS: Record<string, string> = {
  ajuste_cantidad:   'Ajuste de cantidad',
  ajuste_conteo:     'Diferencia de conteo',
  bulk_edit:         'Edición masiva',
  eliminar_serie:    'Eliminar serie',
  cambio_estado:     'Cambio de estado',
  kit_precio:        'Precio de KIT',
  repricing_margen:  'Repricing por margen',
  eliminar_lpn:      'Eliminar LPN',
  eliminar:          'Eliminar', // genérico: Clientes/Envíos/Proveedores/Pedidos/RRHH (mig 386, Nivel 1)
}

export default function SupervisionPage() {
  const { tenant, user } = useAuthStore()
  const modulosPermitidos = MODULOS.filter(m => puedeSupervisarModulo(user, m.key))

  const { data: pendientes = [], isLoading } = useQuery({
    queryKey: ['supervision-pendientes', tenant?.id, modulosPermitidos.map(m => m.key).join(',')],
    queryFn: async () => {
      if (modulosPermitidos.length === 0) return []
      const { data } = await supabase.from('autorizaciones')
        .select('id, modulo, tipo, notas, created_at')
        .eq('tenant_id', tenant!.id).eq('estado', 'pendiente')
        .in('modulo', modulosPermitidos.map(m => m.key))
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && modulosPermitidos.length > 0,
  })

  const porModulo = modulosPermitidos.map(m => {
    const items = pendientes.filter((p: any) => p.modulo === m.key)
    const porTipo: Record<string, number> = {}
    for (const it of items) porTipo[it.tipo] = (porTipo[it.tipo] ?? 0) + 1
    const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1])
    return { ...m, items, tipos }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
          <UserCog size={22} className="text-accent-text" /> Supervisión
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
          Todo lo pendiente de tu aprobación, en todos los módulos, en un solo lugar
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : pendientes.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-400 dark:text-gray-500">
          <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
          <p>No hay nada pendiente de tu aprobación</p>
        </div>
      ) : (
        <div className="space-y-4">
          {porModulo.filter(m => m.items.length > 0).map(m => (
            <div key={m.key} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                <span className="font-semibold text-gray-800 dark:text-gray-100">{m.label}</span>
                <span className="text-xs bg-accent/10 text-accent-text px-2 py-0.5 rounded-full font-medium">{m.items.length} pendiente{m.items.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {m.tipos.map(([tipo, count]) => (
                  <div key={tipo} className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 flex items-center justify-between gap-3">
                    <span className="truncate">{TIPO_LABELS[tipo] ?? tipo}</span>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-0.5 flex-shrink-0">{count}</span>
                  </div>
                ))}
              </div>
              <Link to={m.ruta} className="block px-4 py-2.5 text-sm font-medium text-accent-text hover:bg-accent/5 border-t border-gray-100 dark:border-gray-700">
                Ver y resolver en {m.label} →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
