import { useQuery } from '@tanstack/react-query'
import { Download, BarChart3 } from 'lucide-react'
// xlsx se importa dinámicamente en exportar() (auditoría perf 2026-08-14, P5).
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'

// K1/K2 del relevamiento de Repositores (quedaron fuera del alcance del módulo original, retomados
// 2026-08-12 a pedido de GO). Objetivo explícito de GO en el relevamiento: "entender demoras, no
// presionar al empleado" — por eso el tab que renderiza este componente está gateado a quien
// supervisa el módulo (RepositoresPage.tsx ya lo resuelve antes de montar este componente), un
// repositor no ve el comparativo de sus compañeros.
//
// Cubre AMBOS tipos de trabajo del módulo (decisión de GO, 2026-08-12): cambio de precio/etiqueta
// (`tareas_repositor`) y reposición física a góndola (`wms_tareas` tipo='reposicion_gondola',
// agregada en la Fase 3, posterior al relevamiento original) — sin esto, un repositor que hace
// mucha reposición física y pocos cambios de precio se vería "poco productivo" sin serlo.
//
// Ventana fija de 30 días (mismo criterio ya usado en el KPIs de SupervisionPanel.tsx — sin selector
// de rango, no se pidió). RLS de ambas tablas es por tenant+sucursal (no por usuario_asignado_id),
// así que un supervisor ya ve las tareas de TODOS los repositores de su sucursal sin RPC extra.

const DIAS_VENTANA = 30

interface FilaReporte {
  usuarioId: string
  nombre: string
  carteles: number
  reposicion: number
  sumaMsCarteles: number
  sumaMsReposicion: number
}

function formatDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const minutos = Math.round(ms / 60000)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const minRestantes = minutos % 60
  if (horas < 24) return minRestantes > 0 ? `${horas}h ${minRestantes}m` : `${horas}h`
  const dias = Math.floor(horas / 24)
  const horasRestantes = horas % 24
  return horasRestantes > 0 ? `${dias}d ${horasRestantes}h` : `${dias}d`
}

export function RepositoresReportes() {
  const { tenant } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const [exportando, setExportando] = useState(false)

  const { data: filas = [], isLoading } = useQuery({
    queryKey: ['repositores-reportes', tenant?.id, sucursalId],
    queryFn: async () => {
      const desde = new Date(Date.now() - DIAS_VENTANA * 86400_000).toISOString()

      const [{ data: carteles, error: e1 }, { data: reposicion, error: e2 }] = await Promise.all([
        applyFilter(
          supabase.from('tareas_repositor')
            .select('usuario_asignado_id, created_at, completed_at')
            .eq('tenant_id', tenant!.id).eq('estado', 'completada')
            .gte('completed_at', desde).not('usuario_asignado_id', 'is', null),
        ),
        applyFilter(
          supabase.from('wms_tareas')
            .select('usuario_asignado_id, created_at, completed_at')
            .eq('tenant_id', tenant!.id).eq('tipo', 'reposicion_gondola').eq('estado', 'completada')
            .gte('completed_at', desde).not('usuario_asignado_id', 'is', null),
        ),
      ])
      if (e1) throw e1
      if (e2) throw e2

      const porUsuario = new Map<string, FilaReporte>()
      const acumular = (rows: any[], campo: 'carteles' | 'reposicion') => {
        for (const r of rows) {
          const uid = r.usuario_asignado_id as string
          if (!uid || !r.completed_at) continue
          const ms = new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()
          const actual = porUsuario.get(uid) ?? { usuarioId: uid, nombre: '', carteles: 0, reposicion: 0, sumaMsCarteles: 0, sumaMsReposicion: 0 }
          if (campo === 'carteles') { actual.carteles += 1; actual.sumaMsCarteles += ms }
          else { actual.reposicion += 1; actual.sumaMsReposicion += ms }
          porUsuario.set(uid, actual)
        }
      }
      acumular(carteles ?? [], 'carteles')
      acumular(reposicion ?? [], 'reposicion')

      if (porUsuario.size === 0) return []

      const { data: usuarios } = await supabase.from('users')
        .select('id, nombre_display').in('id', Array.from(porUsuario.keys()))
      const nombreDe = new Map((usuarios ?? []).map((u: any) => [u.id, u.nombre_display]))

      return Array.from(porUsuario.values())
        .map(f => ({ ...f, nombre: nombreDe.get(f.usuarioId) ?? 'Usuario eliminado' }))
        .sort((a, b) => (b.carteles + b.reposicion) - (a.carteles + a.reposicion))
    },
    enabled: !!tenant,
  })

  const exportar = async () => {
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const filasExport = (filas as FilaReporte[]).map(f => ({
        Repositor: f.nombre,
        'Carteles completados': f.carteles,
        'Tiempo promedio (carteles)': f.carteles > 0 ? formatDuracion(f.sumaMsCarteles / f.carteles) : '—',
        'Reposición completada': f.reposicion,
        'Tiempo promedio (reposición)': f.reposicion > 0 ? formatDuracion(f.sumaMsReposicion / f.reposicion) : '—',
        Total: f.carteles + f.reposicion,
      }))
      const ws = XLSX.utils.json_to_sheet(filasExport)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Repositores')
      XLSX.writeFile(wb, `repositores_${new Date().toISOString().split('T')[0]}.xlsx`)
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Últimos {DIAS_VENTANA} días · cantidad de tareas completadas y tiempo promedio desde que se
          disparó la tarea hasta que se completó. Para entender demoras, no para comparar rendimiento.
        </p>
        <button onClick={exportar} disabled={exportando || (filas as FilaReporte[]).length === 0}
          className="flex-shrink-0 flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <Download size={14} /> {exportando ? 'Generando…' : 'Exportar Excel'}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">Cargando…</div>
      ) : (filas as FilaReporte[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          <BarChart3 size={40} className="mb-3 text-gray-200 dark:text-gray-700" />
          <p className="font-medium">Sin tareas completadas en los últimos {DIAS_VENTANA} días</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                <th className="text-left px-4 py-2.5 font-medium">Repositor</th>
                <th className="text-right px-4 py-2.5 font-medium">Carteles</th>
                <th className="text-right px-4 py-2.5 font-medium">Tiempo prom.</th>
                <th className="text-right px-4 py-2.5 font-medium">Reposición</th>
                <th className="text-right px-4 py-2.5 font-medium">Tiempo prom.</th>
                <th className="text-right px-4 py-2.5 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {(filas as FilaReporte[]).map(f => (
                <tr key={f.usuarioId} className="border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                  <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100 font-medium">{f.nombre}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{f.carteles}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 dark:text-gray-500">{f.carteles > 0 ? formatDuracion(f.sumaMsCarteles / f.carteles) : '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{f.reposicion}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 dark:text-gray-500">{f.reposicion > 0 ? formatDuracion(f.sumaMsReposicion / f.reposicion) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-800 dark:text-gray-100">{f.carteles + f.reposicion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
