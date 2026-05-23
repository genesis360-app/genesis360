import { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Package, CheckCircle, RotateCcw, Truck, Clock, Camera, Loader2, Send, Warehouse, AlertTriangle, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import toast, { Toaster } from 'react-hot-toast'
import { BRAND } from '@/config/brand'

type EstadoEnvio = 'pendiente' | 'despachado' | 'en_camino' | 'en_bodega' | 'entregado' | 'devolucion' | 'cancelado'

const ESTADOS_DISPONIBLES: { estado: EstadoEnvio; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
  { estado: 'en_camino',  label: 'En camino',    icon: <Truck size={22} />,        color: 'text-indigo-700', bg: 'bg-indigo-600 hover:bg-indigo-700' },
  { estado: 'en_bodega',  label: 'En bodega',     icon: <Warehouse size={22} />,    color: 'text-purple-700', bg: 'bg-purple-600 hover:bg-purple-700' },
  { estado: 'entregado',  label: 'Entregado',     icon: <CheckCircle size={22} />,  color: 'text-green-700',  bg: 'bg-green-600 hover:bg-green-700' },
  { estado: 'devolucion', label: 'No entregado',  icon: <RotateCcw size={22} />,    color: 'text-orange-700', bg: 'bg-orange-500 hover:bg-orange-600' },
]

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente despacho', despachado: 'Despachado',
  en_camino: 'En camino', en_bodega: 'En bodega',
  entregado: 'Entregado', devolucion: 'En devolución', cancelado: 'Cancelado',
}
const ESTADO_COLOR: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-700', despachado: 'bg-blue-100 text-blue-700',
  en_camino: 'bg-indigo-100 text-indigo-700', en_bodega: 'bg-purple-100 text-purple-700',
  entregado: 'bg-green-100 text-green-700', devolucion: 'bg-orange-100 text-orange-700',
  cancelado: 'bg-red-100 text-red-700',
}

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })
}

export default function TransportistePage() {
  const { token } = useParams<{ token: string }>()

  const [envio, setEnvio]   = useState<any | null>(null)
  const [items, setItems]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [podFecha,    setPodFecha]    = useState(new Date().toISOString().split('T')[0])
  const [podReceptor, setPodReceptor] = useState('')
  const [podNotas,    setPodNotas]    = useState('')
  const [podUrl,      setPodUrl]      = useState('')

  const [saving,        setSaving]       = useState(false)
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)

  // Cargar envío por token
  useEffect(() => {
    if (!token) return
    const load = async () => {
      setLoading(true)
      const [{ data: e }, { data: its }] = await Promise.all([
        supabase.rpc('get_envio_by_token', { p_token: token }),
        supabase.rpc('get_envio_items_by_token', { p_token: token }),
      ])
      if (!e) { setNotFound(true); setLoading(false); return }
      setEnvio(e)
      setItems(its ?? [])
      if (e.pod_fecha)    setPodFecha(e.pod_fecha)
      if (e.pod_receptor) setPodReceptor(e.pod_receptor)
      if (e.pod_notas)    setPodNotas(e.pod_notas)
      if (e.pod_url)      setPodUrl(e.pod_url)
      setLoading(false)
    }
    load()
  }, [token])

  const avanzarEstado = async (nuevoEstado: EstadoEnvio) => {
    if (!token) return
    setSaving(true)
    const podData = nuevoEstado === 'entregado' ? {
      p_pod_fecha: podFecha || null,
      p_pod_receptor: podReceptor.trim() || null,
      p_pod_notas: podNotas.trim() || null,
    } : {}
    const { data: ok, error } = await supabase.rpc('update_envio_by_token', {
      p_token: token, p_estado: nuevoEstado, ...podData,
    })
    setSaving(false)
    if (error || !ok) {
      toast.error('No se pudo actualizar el estado. El envío ya puede estar finalizado.')
      return
    }
    setEnvio((prev: any) => ({ ...prev, estado: nuevoEstado, pod_fecha: podData.p_pod_fecha, pod_receptor: podData.p_pod_receptor, pod_notas: podData.p_pod_notas }))
    toast.success(`Estado actualizado: ${ESTADO_LABEL[nuevoEstado]}`)
  }

  // Foto POD desde cámara — sube a storage usando la anon key pública del bucket
  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !envio) return
    setUploadingFoto(true)
    try {
      const path = `pod/${envio.id}/${Date.now()}.${file.name.split('.').pop() ?? 'jpg'}`
      const { error } = await supabase.storage.from('etiquetas-envios').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = await supabase.storage.from('etiquetas-envios').createSignedUrl(path, 60 * 60 * 24 * 365)
      if (data?.signedUrl) { setPodUrl(data.signedUrl); toast.success('Foto subida') }
    } catch { toast.error('Error al subir la foto') }
    finally { setUploadingFoto(false) }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 size={36} className="animate-spin text-violet-600" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
      <AlertTriangle size={48} className="text-amber-500 mb-4" />
      <h1 className="text-xl font-bold text-gray-800 mb-2">Enlace no válido</h1>
      <p className="text-gray-500 text-sm">Este enlace de envío no existe o ya expiró.</p>
      <p className="text-xs text-gray-400 mt-4">{BRAND.name}</p>
    </div>
  )

  const terminado = envio.estado === 'entregado' || envio.estado === 'cancelado'

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <Toaster position="top-center" />

      {/* Header */}
      <div className="bg-violet-600 text-white px-5 py-5 shadow-lg">
        <p className="text-xs font-medium opacity-75 mb-0.5">{envio.tenant_nombre ?? BRAND.name}</p>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Package size={22} /> Envío #{envio.numero ?? '—'}
        </h1>
        <span className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-semibold ${ESTADO_COLOR[envio.estado] ?? 'bg-gray-100 text-gray-700'}`}>
          {ESTADO_LABEL[envio.estado] ?? envio.estado}
        </span>
      </div>

      <div className="px-4 py-5 space-y-4 max-w-lg mx-auto">

        {/* Destino */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><MapPin size={13} /> Destino</p>
          <p className="font-semibold text-gray-800 text-lg">{envio.cliente_nombre ?? envio.destino_descripcion ?? '—'}</p>
          {envio.calle && (
            <p className="text-gray-600 text-sm mt-0.5">
              {envio.calle}{envio.dom_numero ? ` ${envio.dom_numero}` : ''}
              {envio.ciudad ? `, ${envio.ciudad}` : ''}
              {envio.provincia ? ` (${envio.provincia})` : ''}
            </p>
          )}
          {!envio.calle && envio.destino_descripcion && (
            <p className="text-gray-600 text-sm mt-0.5">{envio.destino_descripcion}</p>
          )}
          {envio.fecha_entrega_acordada && (
            <p className="mt-2 text-sm flex items-center gap-1.5 text-violet-700 font-medium">
              <Clock size={14} /> Entrega acordada: {fmt(envio.fecha_entrega_acordada)}
              {envio.hora_entrega_acordada && ` a las ${envio.hora_entrega_acordada.slice(0,5)}`}
            </p>
          )}
        </div>

        {/* Productos */}
        {items.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Productos a entregar</p>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-800 text-sm">{it.nombre}</span>
                  <span className="text-gray-500 text-sm font-medium">×{it.cantidad}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Courier */}
        {(envio.courier || envio.tracking_number) && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Truck size={13} /> Courier</p>
            {envio.courier && <p className="text-gray-800 font-medium">{envio.courier}{envio.servicio ? ` — ${envio.servicio}` : ''}</p>}
            {envio.tracking_number && <p className="text-gray-500 text-sm font-mono mt-0.5">Tracking: {envio.tracking_number}</p>}
          </div>
        )}

        {/* Notas */}
        {envio.notas && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-amber-700 uppercase mb-1">Notas</p>
            <p className="text-amber-800 text-sm">{envio.notas}</p>
          </div>
        )}

        {/* Sección de acciones */}
        {!terminado ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase">Actualizar estado</p>

            <div className="grid grid-cols-2 gap-2">
              {ESTADOS_DISPONIBLES.map(cfg => (
                <button key={cfg.estado} onClick={() => avanzarEstado(cfg.estado)}
                  disabled={saving || envio.estado === cfg.estado}
                  className={`flex flex-col items-center gap-1.5 py-4 rounded-xl text-white font-semibold text-sm transition-all ${cfg.bg} disabled:opacity-40`}>
                  {cfg.icon}
                  {cfg.label}
                </button>
              ))}
            </div>

            {/* POD — datos de entrega */}
            <div className="border-t border-gray-100 pt-3 mt-3 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                <CheckCircle size={13} className="text-green-500" /> Comprobante de entrega (POD)
              </p>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Fecha de entrega</label>
                <input type="date" value={podFecha} onChange={e => setPodFecha(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block flex items-center gap-1"><User size={11} /> Nombre de quien recibió</label>
                <input type="text" value={podReceptor} onChange={e => setPodReceptor(e.target.value)}
                  placeholder="Ej: Juan García"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Observaciones</label>
                <textarea value={podNotas} onChange={e => setPodNotas(e.target.value)}
                  placeholder="Estado del paquete, incidencias, etc."
                  rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500 resize-none" />
              </div>

              {/* Foto */}
              <input ref={cameraRef} type="file" accept="image/*" capture="environment"
                onChange={handleFoto} className="hidden" />
              <button onClick={() => cameraRef.current?.click()} disabled={uploadingFoto}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-violet-300 text-violet-600 rounded-xl font-medium text-sm hover:bg-violet-50 transition-colors disabled:opacity-50">
                {uploadingFoto ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                {uploadingFoto ? 'Subiendo foto…' : podUrl ? '📷 Cambiar foto' : '📷 Tomar foto del paquete'}
              </button>
              {podUrl && (
                <a href={podUrl} target="_blank" rel="noreferrer"
                  className="block text-center text-xs text-violet-600 underline">Ver foto subida</a>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
            <CheckCircle size={40} className="text-green-500 mx-auto mb-2" />
            <p className="font-bold text-green-800 text-lg">
              {envio.estado === 'entregado' ? '¡Envío entregado!' : 'Envío cancelado'}
            </p>
            {envio.pod_fecha && <p className="text-green-700 text-sm mt-1">Fecha: {fmt(envio.pod_fecha)}</p>}
            {envio.pod_receptor && <p className="text-green-700 text-sm">Recibido por: {envio.pod_receptor}</p>}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-300 mt-6">{BRAND.name} — Módulo de envíos</p>
    </div>
  )
}
