import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ScanBarcode, PackageCheck, PackageSearch, RefreshCw, CheckCircle2, AlertTriangle, MapPin, ArrowRight, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import toast from 'react-hot-toast'

interface TareaWMS {
  id: string
  tipo: 'picking' | 'replenishment' | 'putaway' | 'conteo'
  estado: 'pendiente' | 'en_curso' | 'completada' | 'cancelada'
  prioridad: number
  cantidad: number
  lpn_origen: string | null
  notas: string | null
  tarea_precedente_id: string | null
  envio_id: string | null
  created_at: string
  productos: { nombre: string; sku: string } | null
  ubicacion_origen: { nombre: string } | null
  ubicacion_destino: { nombre: string } | null
  envios: { numero: number | null } | null
}

// El picking guía al depósito hacia LPNs que la venta ya decidió consumir — nunca toca el
// motor de ventas/rebaje. Ver comentario de cabecera de la mig 289.
export default function PickingPage() {
  const navigate = useNavigate()
  const { tenant } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const qc = useQueryClient()

  const [scannerOpen, setScannerOpen] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [refrescandoUmbral, setRefrescandoUmbral] = useState(false)
  const [completando, setCompletando] = useState<string | null>(null)

  const { data: tareas = [], isLoading } = useQuery({
    queryKey: ['wms_tareas', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('wms_tareas')
        .select('*, productos(nombre, sku), ubicacion_origen:ubicaciones!wms_tareas_ubicacion_origen_id_fkey(nombre), ubicacion_destino:ubicaciones!wms_tareas_ubicacion_destino_id_fkey(nombre), envios(numero)')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['pendiente', 'en_curso'])
        .order('prioridad', { ascending: false })
        .order('created_at')
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as TareaWMS[]
    },
    enabled: !!tenant,
  })

  const tareasPorId = new Map(tareas.map(t => [t.id, t]))
  const filtradas = busqueda.trim()
    ? tareas.filter(t =>
        t.lpn_origen?.toLowerCase().includes(busqueda.toLowerCase()) ||
        t.productos?.sku?.toLowerCase().includes(busqueda.toLowerCase()) ||
        t.productos?.nombre?.toLowerCase().includes(busqueda.toLowerCase()))
    : tareas

  const handleScan = (code: string) => {
    setBusqueda(code)
    setScannerOpen(false)
    const match = tareas.some(t => t.lpn_origen === code || t.productos?.sku === code)
    if (!match) toast.error(`No se encontró ninguna tarea pendiente para "${code}"`)
  }

  const revisarUmbral = async () => {
    setRefrescandoUmbral(true)
    const { data, error } = await supabase.rpc('fn_generar_tareas_reabastecimiento_umbral', { p_tenant_id: tenant!.id })
    setRefrescandoUmbral(false)
    if (error) { toast.error(error.message); return }
    const n = (data ?? []).length
    qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    toast.success(n > 0 ? `${n} tarea(s) de reabastecimiento generada(s)` : 'Todo por encima del mínimo configurado')
  }

  const completarTarea = async (tarea: TareaWMS) => {
    if (tarea.tarea_precedente_id) {
      const prec = tareasPorId.get(tarea.tarea_precedente_id)
      if (prec && prec.estado !== 'completada') {
        toast.error('Primero hay que completar el reabastecimiento de esta tarea')
        return
      }
    }
    setCompletando(tarea.id)
    const rpc = tarea.tipo === 'replenishment' ? 'fn_completar_tarea_reabastecimiento' : 'fn_completar_tarea_picking'
    const { error } = await supabase.rpc(rpc, { p_tarea_id: tarea.id })
    setCompletando(null)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    toast.success(tarea.tipo === 'replenishment' ? 'Reabastecimiento completado — stock movido a picking' : 'Picking completado')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-primary">Picking</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Tareas de retiro y reabastecimiento pendientes</p>
        </div>
        <button onClick={revisarUmbral} disabled={refrescandoUmbral}
          title="Revisar reabastecimiento por umbral"
          className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
          <RefreshCw size={18} className={`text-gray-500 dark:text-gray-400 ${refrescandoUmbral ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Buscador / escaneo — mobile-first */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <PackageSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Buscar por LPN, SKU o producto..." value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
        </div>
        <button onClick={() => setScannerOpen(true)}
          className="flex-shrink-0 px-4 py-3 bg-accent hover:bg-accent/90 text-white rounded-xl flex items-center gap-2 text-sm font-medium">
          <ScanBarcode size={18} /> Escanear
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Cargando tareas...</p>
      ) : filtradas.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 shadow-sm border border-gray-100 text-center text-gray-400 dark:text-gray-500">
          <PackageCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">{tareas.length === 0 ? 'No hay tareas pendientes' : 'Ninguna tarea coincide con la búsqueda'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtradas.map(t => {
            const precedente = t.tarea_precedente_id ? tareasPorId.get(t.tarea_precedente_id) : null
            const bloqueada = !!precedente && precedente.estado !== 'completada'
            const esReab = t.tipo === 'replenishment'
            return (
              <div key={t.id} data-testid={`tarea-${t.id}`} className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border ${esReab ? 'border-orange-200 dark:border-orange-900' : 'border-gray-100 dark:border-gray-700'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${esReab ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                    {esReab ? 'Reabastecimiento' : 'Picking'}
                  </span>
                  {t.envios?.numero && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1"><Truck size={11} /> Envío #{t.envios.numero}</span>
                  )}
                </div>
                <p className="font-medium text-gray-800 dark:text-gray-100">{t.productos?.nombre ?? '—'}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t.productos?.sku}{t.lpn_origen ? ` · LPN ${t.lpn_origen}` : ''}</p>
                {t.notas && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t.notas}</p>}
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 mb-3">
                  <MapPin size={13} className="text-gray-400" />
                  <span>{t.ubicacion_origen?.nombre ?? 'sin ubicación'}</span>
                  {esReab && t.ubicacion_destino && (<><ArrowRight size={13} className="text-gray-400" /><span>{t.ubicacion_destino.nombre}</span></>)}
                </div>

                {bloqueada && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-2">
                    <AlertTriangle size={13} /> Esperando que se complete el reabastecimiento
                  </div>
                )}
                <button onClick={() => completarTarea(t)} disabled={bloqueada || completando === t.id}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {completando === t.id ? 'Completando...' : <><CheckCircle2 size={16} /> {esReab ? 'Confirmar reabastecimiento' : 'Confirmar retiro'}</>}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner
          persistent
          persistentCloseLabel="Terminar de escanear"
          title="Escanear LPN o código de producto"
          onDetected={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}
