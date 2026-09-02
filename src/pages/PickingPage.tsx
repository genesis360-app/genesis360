import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ScanBarcode, PackageCheck, RefreshCw, CheckCircle2, AlertTriangle, MapPin, ArrowRight, Truck, XCircle, ClipboardList, Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { BuscadorPildoras, pildoraConCampoNuevo } from '@/components/BuscadorPildoras'
import { logActividad } from '@/lib/actividadLog'
import { useConfirm } from '@/hooks/useConfirm'
import {
  parsearPildora, evaluarPildora, evaluarPildoras, CAMPOS_FILTRO, esCampoNumerico,
  type Pildora, type Combinador,
} from '@/lib/pickingFiltro'
import toast from 'react-hot-toast'

// `BuscadorPildoras` es genérico (lo reusan /productos e /inventario) y espera el flag
// `numerico` por campo — acá ya vivía aparte, en `esCampoNumerico`.
const CAMPOS_FILTRO_UI = CAMPOS_FILTRO.map(c => ({ ...c, numerico: esCampoNumerico(c.campo) }))

interface TareaWMS {
  id: string
  tipo: 'picking' | 'replenishment' | 'putaway' | 'conteo' | 'armado'
  estado: 'pendiente' | 'en_curso' | 'completada' | 'cancelada'
  prioridad: number
  producto_id: string | null
  sucursal_id: string | null
  cantidad: number
  lpn_origen: string | null
  notas: string | null
  tarea_precedente_id: string | null
  envio_id: string | null
  created_at: string
  usuario_asignado_id: string | null
  usuario_asignado: { nombre_display: string | null } | null
  productos: { nombre: string; sku: string } | null
  ubicacion_origen: { nombre: string } | null
  ubicacion_destino: { nombre: string } | null
  envios: { numero: number | null; venta_id: string | null } | null
  pedido_id: string | null
  pedidos: { numero: number | null; venta_origen_id: string | null } | null
}

// La venta de una tarea se resuelve por DOS caminos: pedidos.venta_origen_id (viene de Pedidos)
// o envios.venta_id (envío armado directo desde una venta, sin pasar por Pedidos — el caso más
// común, ver test "Fuente 1" del spec 106). Sin esto, buscar/mostrar la venta fallaba en silencio
// para toda tarea que no vino de un pedido.
const ventaIdDe = (t: TareaWMS) => t.pedidos?.venta_origen_id ?? t.envios?.venta_id ?? null

// El picking guía al depósito hacia LPNs que la venta ya decidió consumir — nunca toca el
// motor de ventas/rebaje. Ver comentario de cabecera de la mig 289.
export default function PickingPage() {
  const navigate = useNavigate()
  const { tenant, user } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const qc = useQueryClient()
  const confirmar = useConfirm()

  const [searchParams] = useSearchParams()
  const [scannerOpen, setScannerOpen] = useState(false)
  // Llegar desde "Ver en Picking" (Pedidos) o cualquier otro link con ?busqueda=(Campo):valor
  // pre-filtra de una — con muchas tareas en cola, aterrizar sin filtro obliga a buscar a mano.
  // Un `?busqueda=` que no matchea ningún campo conocido (ej. un LPN suelto) cae en `entrada`.
  const [pildoras, setPildoras] = useState<Pildora[]>(() => {
    const raw = searchParams.get('busqueda')
    if (!raw) return []
    const parsed = parsearPildora(raw)
    return parsed ? [parsed] : []
  })
  const [entrada, setEntrada] = useState(() => {
    const raw = searchParams.get('busqueda')
    if (!raw) return ''
    return parsearPildora(raw) ? '' : raw
  })
  const [combinador, setCombinador] = useState<Combinador>('Y')
  const [refrescandoUmbral, setRefrescandoUmbral] = useState(false)
  const [completando, setCompletando] = useState<string | null>(null)

  const { data: tareas = [], isLoading } = useQuery({
    queryKey: ['wms_tareas', tenant?.id, sucursalId, user?.id],
    queryFn: async () => {
      let q = supabase.from('wms_tareas')
        .select('*, productos(nombre, sku), ubicacion_origen:ubicaciones!wms_tareas_ubicacion_origen_id_fkey(nombre), ubicacion_destino:ubicaciones!wms_tareas_ubicacion_destino_id_fkey(nombre), envios(numero, venta_id), pedidos(numero, venta_origen_id), usuario_asignado:users!wms_tareas_usuario_asignado_id_fkey(nombre_display)')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['pendiente', 'en_curso'])
        // reposicion_gondola (mig 355) es trabajo del Repositor, vive en /repositores — nunca se mezcla
        // con la cola de depósito de Picking.
        .neq('tipo', 'reposicion_gondola')
        .order('prioridad', { ascending: false })
        .order('created_at')
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      // Cada operario ve las tareas libres (para tomar) + las que le asignaron a él puntualmente
      // — una tarea asignada a OTRO usuario no aparece acá (pedido de GO, 2026-08-08).
      if (user?.id) q = q.or(`usuario_asignado_id.is.null,usuario_asignado_id.eq.${user.id}`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as TareaWMS[]
    },
    enabled: !!tenant,
  })

  // El operario tiene que poder saber de qué pedido y de qué VENTA salió la tarea (pedido de GO):
  // sin eso, un LPN mal pickeado no se puede rastrear hasta el cliente que lo está esperando.
  // Va en query aparte y no anidada: `ventas` y `pedidos` se referencian en las DOS direcciones
  // (`ventas.pedido_id` y `pedidos.venta_origen_id`), así que el embed anidado es ambiguo.
  const ventaIds = [...new Set(tareas.map(ventaIdDe).filter(Boolean))] as string[]
  const { data: ventasPorId = {} } = useQuery({
    queryKey: ['wms-tareas-ventas', ventaIds.join(',')],
    queryFn: async () => {
      const { data } = await supabase.from('ventas').select('id, numero').in('id', ventaIds)
      return Object.fromEntries((data ?? []).map((v: any) => [v.id, v.numero])) as Record<string, number>
    },
    enabled: ventaIds.length > 0,
  })

  const tareasPorId = new Map(tareas.map(t => [t.id, t]))
  const ventaNumeroDe = (t: TareaWMS): number | null => {
    const ventaId = ventaIdDe(t)
    return ventaId ? ventasPorId[ventaId] ?? null : null
  }

  // Lo que todavía se está tipeando (`entrada`) filtra en vivo igual que las píldoras ya
  // confirmadas — así no hace falta apretar Enter para el caso más común (un solo término suelto,
  // igual que antes). Si `entrada` matchea "Campo:valor" se evalúa como esa píldora estructurada
  // (exacto, no ambiguo); si no, como libre (LPN/SKU/producto). Enter la vuelve una píldora fija.
  const entradaTrim = entrada.trim()
  const pildoraDeEntrada: Pildora | null = entradaTrim
    ? (parsearPildora(entradaTrim) ?? { id: '__entrada__', campo: 'libre', operador: 'contiene', valor: entradaTrim })
    : null
  const pildorasEfectivas = pildoraDeEntrada ? [...pildoras, pildoraDeEntrada] : pildoras

  const filtradas = pildorasEfectivas.length === 0
    ? tareas
    : tareas.filter(t => evaluarPildoras(t, pildorasEfectivas, combinador, ventaNumeroDe(t)))

  const commitEntrada = () => {
    if (!entradaTrim) return
    const nueva = parsearPildora(entradaTrim) ?? { id: crypto.randomUUID(), campo: 'libre' as const, operador: 'contiene' as const, valor: entradaTrim }
    setPildoras(ps => [...ps, nueva])
    setEntrada('')
  }

  // Un scan es una acción puntual y completa — REEMPLAZA el filtro entero (mismo criterio que
  // ya tenía `setBusqueda(code)`), no lo acumula: escanear un segundo código es una búsqueda nueva.
  const handleScan = (code: string) => {
    const nueva = parsearPildora(code) ?? { id: crypto.randomUUID(), campo: 'libre' as const, operador: 'contiene' as const, valor: code }
    setPildoras([nueva])
    setEntrada('')
    setScannerOpen(false)
    const match = tareas.some(t => evaluarPildora(t, nueva, ventaNumeroDe(t)))
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
    const esReab = tarea.tipo === 'replenishment'
    const esArmado = tarea.tipo === 'armado'
    setCompletando(tarea.id)
    const rpc = esArmado ? 'fn_completar_tarea_armado' : esReab ? 'fn_completar_tarea_reabastecimiento' : 'fn_completar_tarea_picking'
    const { error } = await supabase.rpc(rpc, { p_tarea_id: tarea.id })
    setCompletando(null)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    logActividad({
      entidad: 'wms_tarea', entidad_id: tarea.id, entidad_nombre: tarea.productos?.nombre ?? tarea.lpn_origen ?? undefined,
      accion: 'cambio_estado', campo: 'estado', valor_anterior: tarea.estado, valor_nuevo: 'completada',
      pagina: '/picking', tipo_transaccion: esReab ? 'traslado' : undefined,
      producto_id: tarea.producto_id, lpn: tarea.lpn_origen, sucursal_id: tarea.sucursal_id,
    })
    toast.success(esArmado ? 'Armado completado — stock del kit ingresado' : esReab ? 'Reabastecimiento completado — stock movido a picking' : 'Picking completado')
  }

  const cancelarTarea = async (tarea: TareaWMS) => {
    const esReab = tarea.tipo === 'replenishment'
    const esArmado = tarea.tipo === 'armado'
    const tieneDependiente = esReab && tareas.some(t => t.tarea_precedente_id === tarea.id)
    const msg = `¿Cancelar esta tarea de ${esArmado ? 'armado' : esReab ? 'reabastecimiento' : 'picking'}?` +
      (esArmado ? ' Se libera la reserva de los componentes.' : '') +
      (tieneDependiente ? ' La tarea de picking que depende de este reabastecimiento también se va a cancelar.' : '')
    if (!(await confirmar(msg, { danger: true }))) return
    setCompletando(tarea.id)
    const { error } = await supabase.rpc('fn_cancelar_tarea_wms', { p_tarea_id: tarea.id })
    setCompletando(null)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    logActividad({
      entidad: 'wms_tarea', entidad_id: tarea.id, entidad_nombre: tarea.productos?.nombre ?? tarea.lpn_origen ?? undefined,
      accion: 'cambio_estado', campo: 'estado', valor_anterior: tarea.estado, valor_nuevo: 'cancelada',
      pagina: '/picking', producto_id: tarea.producto_id, lpn: tarea.lpn_origen, sucursal_id: tarea.sucursal_id,
    })
    toast.success('Tarea cancelada')
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

      {/* Buscador / escaneo — mobile-first. LPN/SKU/producto/etc. sueltos filtran en vivo; escribir
          "Pedido:20" (o elegirlo del desplegable de una píldora ya creada) lo deja exacto a ese
          campo — ver `src/lib/pickingFiltro.ts`. */}
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <BuscadorPildoras
            camposFiltro={CAMPOS_FILTRO_UI}
            pildoras={pildoras}
            entrada={entrada}
            combinador={combinador}
            placeholder="Buscar LPN, SKU, producto... o (Pedido):20"
            onEntradaChange={setEntrada}
            onCommitEntrada={commitEntrada}
            onCampoChange={(id, campo) => setPildoras(ps => ps.map(p => p.id === id ? pildoraConCampoNuevo(p, campo, CAMPOS_FILTRO_UI) : p))}
            onOperadorChange={(id, operador) => setPildoras(ps => ps.map(p => p.id === id ? { ...p, operador } : p))}
            onValorChange={(id, valor) => setPildoras(ps => ps.map(p => p.id === id ? { ...p, valor } : p))}
            onRemove={id => setPildoras(ps => ps.filter(p => p.id !== id))}
            onRemoveLast={() => setPildoras(ps => ps.slice(0, -1))}
            onCombinadorChange={setCombinador}
          />
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
            const esArmado = t.tipo === 'armado'
            return (
              <div key={t.id} data-testid={`tarea-${t.id}`} className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border ${esArmado ? 'border-purple-200 dark:border-purple-900' : esReab ? 'border-orange-200 dark:border-orange-900' : 'border-gray-100 dark:border-gray-700'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${esArmado ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : esReab ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                    {esArmado ? 'Armado' : esReab ? 'Reabastecimiento' : 'Picking'}
                  </span>
                  {t.pedidos?.numero != null && (
                    <button type="button" onClick={() => navigate('/pedidos')}
                      title="Ver el pedido que originó esta tarea"
                      className="text-xs font-medium text-accent-text hover:underline flex items-center gap-1">
                      <ClipboardList size={11} /> Pedido #{t.pedidos.numero}
                    </button>
                  )}
                  {ventaIdDe(t) != null && ventasPorId[ventaIdDe(t)!] != null && (
                    <button type="button"
                      onClick={() => navigate(`/ventas?id=${ventaIdDe(t)}`)}
                      title="Ver la venta del cliente que está esperando esta mercadería"
                      className="text-xs font-medium text-accent-text hover:underline flex items-center gap-1">
                      <Receipt size={11} /> Venta #{ventasPorId[ventaIdDe(t)!]}
                    </button>
                  )}
                  {t.envios?.numero && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1"><Truck size={11} /> Envío #{t.envios.numero}</span>
                  )}
                  {t.usuario_asignado_id === user?.id && (
                    <span className="text-xs font-medium text-accent-text bg-accent/10 px-2 py-0.5 rounded-full">Asignada a mí</span>
                  )}
                </div>
                <p className="font-medium text-gray-800 dark:text-gray-100">{t.productos?.nombre ?? '—'}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t.productos?.sku}{t.lpn_origen ? ` · LPN ${t.lpn_origen}` : ''}</p>
                {t.notas && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t.notas}</p>}
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 mb-3">
                  <MapPin size={13} className="text-gray-400" />
                  {esArmado ? (
                    <span>{t.ubicacion_destino?.nombre ?? 'sin ubicación de destino'}</span>
                  ) : (
                    <>
                      <span>{t.ubicacion_origen?.nombre ?? 'sin ubicación'}</span>
                      {esReab && t.ubicacion_destino && (<><ArrowRight size={13} className="text-gray-400" /><span>{t.ubicacion_destino.nombre}</span></>)}
                    </>
                  )}
                </div>

                {bloqueada && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-2">
                    <AlertTriangle size={13} /> Esperando que se complete el reabastecimiento
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => completarTarea(t)} disabled={bloqueada || completando === t.id}
                    className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    {completando === t.id ? 'Completando...' : <><CheckCircle2 size={16} /> {esArmado ? 'Confirmar armado' : esReab ? 'Confirmar reabastecimiento' : 'Confirmar retiro'}</>}
                  </button>
                  <button onClick={() => cancelarTarea(t)} disabled={completando === t.id}
                    title="Cancelar tarea" aria-label="Cancelar tarea"
                    className="flex-shrink-0 px-3 py-2.5 border border-gray-200 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-900 text-gray-400 hover:text-red-500 rounded-xl disabled:opacity-50">
                    <XCircle size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner
          persistent
          persistentCloseLabel="Terminar de escanear"
          title="Escanear LPN, código de producto, pedido, venta o envío"
          onDetected={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}
