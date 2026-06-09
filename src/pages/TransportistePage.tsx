import { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Package, CheckCircle, RotateCcw, Truck, Clock, Camera, Loader2, Warehouse, AlertTriangle, User, PenLine, Navigation, ShieldCheck, MessageCircle, Phone, Flag } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import toast, { Toaster } from 'react-hot-toast'
import { BRAND } from '@/config/brand'
import SignaturePad from '@/components/SignaturePad'
import { podFaltantes, requiereOtp, SUBESTADOS_NO_ENTREGA, type SubestadoNoEntrega } from '@/lib/enviosPod'
import { INCIDENCIA_TIPOS } from '@/lib/enviosReparto'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

type EstadoEnvio = 'pendiente' | 'despachado' | 'en_camino' | 'en_bodega' | 'entregado' | 'devolucion' | 'cancelado'

const ESTADOS_AVANCE: { estado: EstadoEnvio; label: string; icon: React.ReactNode; bg: string }[] = [
  { estado: 'en_camino',  label: 'En camino',    icon: <Truck size={22} />,       bg: 'bg-indigo-600 hover:bg-indigo-700' },
  { estado: 'en_bodega',  label: 'En bodega',     icon: <Warehouse size={22} />,   bg: 'bg-purple-600 hover:bg-purple-700' },
  { estado: 'entregado',  label: 'Entregado',     icon: <CheckCircle size={22} />, bg: 'bg-green-600 hover:bg-green-700' },
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
  const [podDni,      setPodDni]      = useState('')
  const [podFirma,    setPodFirma]    = useState<string | null>(null)  // dataURL

  // EN2/D3 — OTP
  const [otpEnviado,    setOtpEnviado]    = useState(false)
  const [otpInput,      setOtpInput]      = useState('')
  const [otpVerificado, setOtpVerificado] = useState(false)
  const [otpBusy,       setOtpBusy]       = useState(false)

  // EN2/D5 — no entregado
  const [showNoEntrega,   setShowNoEntrega]   = useState(false)
  const [noEntregaSub,    setNoEntregaSub]    = useState<SubestadoNoEntrega>('ausente')
  const [noEntregaMotivo, setNoEntregaMotivo] = useState('')

  // EN3/E2 — incidencia
  const [showIncidencia, setShowIncidencia] = useState(false)
  const [incTipo, setIncTipo] = useState<string>('rotura')
  const [incDetalle, setIncDetalle] = useState('')
  // EN3/E4 — identidad del transportista (gate nombre+DNI)
  const [identNombre, setIdentNombre] = useState('')
  const [identDni, setIdentDni] = useState('')
  const [identificado, setIdentificado] = useState(false)

  const [saving,        setSaving]       = useState(false)
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)

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
      if (e.pod_dni)      setPodDni(e.pod_dni)
      if (e.pod_otp_verificado) setOtpVerificado(true)
      setLoading(false)
    }
    load()
  }, [token])

  const pagoPendiente = !!envio && Number(envio.costo_cotizado ?? 0) > 0 && !envio.costo_pagado

  // Config POD del tenant (vienen en el RPC)
  const requeridos = (envio?.pod_campos_requeridos ?? { fecha: true, receptor: true }) as Record<string, boolean>
  const fotoMin = Number(envio?.pod_foto_min ?? 0)
  const otpNecesario = !!envio && requiereOtp(!!envio.es_propio, Number(envio.costo_cotizado ?? 0), Number(envio.pod_otp_umbral ?? 0))

  // EN2/D4 — captura de geoloc con fallback graceful
  const capturarGeo = (): Promise<{ lat: number | null; lon: number | null }> =>
    new Promise(resolve => {
      if (!('geolocation' in navigator)) { resolve({ lat: null, lon: null }); return }
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => resolve({ lat: null, lon: null }),
        { timeout: 8000, enableHighAccuracy: true },
      )
    })

  const subirFirma = async (): Promise<string | null> => {
    if (!podFirma || !envio) return envio?.pod_firma_url ?? null
    try {
      const blob = await (await fetch(podFirma)).blob()
      const path = `pod/${envio.id}/firma_${Date.now()}.png`
      const { error } = await supabase.storage.from('etiquetas-envios').upload(path, blob, { upsert: true, contentType: 'image/png' })
      if (error) return envio.pod_firma_url ?? null
      const { data } = await supabase.storage.from('etiquetas-envios').createSignedUrl(path, 60 * 60 * 24 * 365)
      return data?.signedUrl ?? null
    } catch { return envio.pod_firma_url ?? null }
  }

  const avanzarEstado = async (nuevoEstado: EstadoEnvio) => {
    if (!token || !envio) return
    if (pagoPendiente) { toast.error('Este envío tiene un pago pendiente. Contactá al local antes de actualizar.'); return }

    if (nuevoEstado === 'entregado') {
      // D1/D2 — validar requeridos
      const faltan = podFaltantes(
        { fecha: podFecha, receptor: podReceptor, dni: podDni, firma_url: podFirma ?? envio.pod_firma_url, fotos: podUrl ? 1 : 0 },
        requeridos, fotoMin,
      )
      if (faltan.length > 0) { toast.error(`Faltan datos: ${faltan.join(', ')}`); return }
      // D3 — OTP
      if (otpNecesario && !otpVerificado) { toast.error('Verificá el código de entrega del cliente antes de confirmar.'); return }
    }

    setSaving(true)
    let geoData: { lat: number | null; lon: number | null } = { lat: null, lon: null }
    let firmaUrl: string | null = null
    if (nuevoEstado === 'entregado') {
      geoData = await capturarGeo()
      firmaUrl = await subirFirma()
    }
    const podData = nuevoEstado === 'entregado' ? {
      p_pod_fecha: podFecha || null,
      p_pod_receptor: podReceptor.trim() || null,
      p_pod_notas: podNotas.trim() || null,
      p_pod_dni: podDni.trim() || null,
      p_pod_firma_url: firmaUrl,
      p_pod_lat: geoData.lat,
      p_pod_lon: geoData.lon,
      p_pod_geo_estado: geoData.lat != null ? 'ok' : 'no_disponible',
    } : {}

    const { data: ok, error } = await supabase.rpc('update_envio_by_token', {
      p_token: token, p_estado: nuevoEstado, ...podData,
    })
    setSaving(false)
    if (error || !ok) {
      toast.error(otpNecesario && nuevoEstado === 'entregado'
        ? 'No se pudo confirmar. Verificá el código de entrega.'
        : 'No se pudo actualizar. El envío puede estar finalizado.')
      return
    }
    setEnvio((prev: any) => ({ ...prev, estado: nuevoEstado, ...(nuevoEstado === 'entregado' ? { pod_fecha: podFecha, pod_receptor: podReceptor, pod_geo_estado: podData.p_pod_geo_estado } : {}) }))
    toast.success(`Estado actualizado: ${ESTADO_LABEL[nuevoEstado]}`)
  }

  // EN2/D5 — registrar no entregado
  const registrarNoEntrega = async () => {
    if (!token) return
    if (!noEntregaMotivo.trim()) { toast.error('Indicá el detalle'); return }
    setSaving(true)
    const { data: ok, error } = await supabase.rpc('update_envio_by_token', {
      p_token: token, p_estado: envio.estado,
      p_subestado: noEntregaSub, p_no_entrega_motivo: noEntregaMotivo.trim(),
    })
    setSaving(false)
    if (error || !ok) { toast.error('No se pudo registrar.'); return }
    setShowNoEntrega(false)
    // recargar para reflejar el nuevo estado/intentos
    const { data: e } = await supabase.rpc('get_envio_by_token', { p_token: token })
    if (e) setEnvio(e)
    toast.success('Registrado')
  }

  // EN3/E2 — reportar incidencia
  const reportarIncidencia = async () => {
    if (!token) return
    if (!incDetalle.trim()) { toast.error('Contanos qué pasó'); return }
    const { data: ok, error } = await supabase.rpc('reportar_incidencia_envio', { p_token: token, p_tipo: incTipo, p_detalle: incDetalle.trim() })
    if (error || !ok) { toast.error('No se pudo reportar'); return }
    toast.success('Incidencia reportada al local')
    setShowIncidencia(false); setIncDetalle(''); setIncTipo('rotura')
  }

  // EN2/D3 — generar + enviar OTP al cliente por WhatsApp
  const enviarOtp = async () => {
    if (!token) return
    setOtpBusy(true)
    const { data, error } = await supabase.rpc('generar_otp_envio', { p_token: token })
    setOtpBusy(false)
    if (error || !data?.ok) { toast.error('No se pudo generar el código.'); return }
    setOtpEnviado(true)
    const tel = data.telefono
    if (tel) {
      const url = buildWhatsAppUrl(tel, `Tu código de entrega es: ${data.codigo}. Dáselo al transportista para confirmar la recepción.`)
      if (url) window.open(url, '_blank', 'noopener')
      toast.success('Código generado — enviáselo al cliente por WhatsApp')
    } else {
      toast(`Código de entrega: ${data.codigo} (el cliente no tiene teléfono cargado)`, { duration: 8000 })
    }
  }
  const verificarOtp = async () => {
    if (!token || !otpInput.trim()) return
    setOtpBusy(true)
    const { data: ok, error } = await supabase.rpc('verificar_otp_envio', { p_token: token, p_codigo: otpInput.trim() })
    setOtpBusy(false)
    if (error || !ok) { toast.error('Código incorrecto o vencido'); return }
    setOtpVerificado(true)
    toast.success('Código verificado ✓')
  }

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

  // EN3/E4 — gate de identidad (nombre + DNI) antes de operar
  if (envio.envio_identidad_modo === 'nombre_dni' && !identificado && !terminado) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <Toaster position="top-center" />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-sm w-full space-y-3">
          <p className="text-xs font-medium text-gray-400">{envio.tenant_nombre ?? BRAND.name}</p>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><User size={18} className="text-violet-600" /> Identificate</h1>
          <p className="text-sm text-gray-500">Para gestionar el envío #{envio.numero}, ingresá tu nombre y DNI.</p>
          <input value={identNombre} onChange={e => setIdentNombre(e.target.value)} placeholder="Nombre y apellido"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
          <input value={identDni} onChange={e => setIdentDni(e.target.value)} inputMode="numeric" placeholder="DNI"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
          <button onClick={() => { if (identNombre.trim() && identDni.trim()) setIdentificado(true); else toast.error('Completá nombre y DNI') }}
            className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm">Continuar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <Toaster position="top-center" />

      <div className="bg-violet-600 text-white px-5 py-5 shadow-lg">
        <p className="text-xs font-medium opacity-75 mb-0.5">{envio.tenant_nombre ?? BRAND.name}</p>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Package size={22} /> Envío #{envio.numero ?? '—'}
        </h1>
        <span className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-semibold ${ESTADO_COLOR[envio.estado] ?? 'bg-gray-100 text-gray-700'}`}>
          {ESTADO_LABEL[envio.estado] ?? envio.estado}
        </span>
        {envio.intentos > 0 && (
          <span className="inline-flex items-center gap-1 mt-2 ml-2 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
            Intento {envio.intentos}
          </span>
        )}
      </div>

      <div className="px-4 py-5 space-y-4 max-w-lg mx-auto">

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><MapPin size={13} /> Destino</p>
          <p className="font-semibold text-gray-800 text-lg">{envio.cliente_nombre ?? envio.destino_descripcion ?? '—'}</p>
          {envio.calle && (
            <p className="text-gray-600 text-sm mt-0.5">
              {envio.calle}{envio.dom_numero ? ` ${envio.dom_numero}` : ''}
              {envio.ciudad ? `, ${envio.ciudad}` : ''}{envio.provincia ? ` (${envio.provincia})` : ''}
            </p>
          )}
          {!envio.calle && envio.destino_descripcion && <p className="text-gray-600 text-sm mt-0.5">{envio.destino_descripcion}</p>}
          {envio.fecha_entrega_acordada && (
            <p className="mt-2 text-sm flex items-center gap-1.5 text-violet-700 font-medium">
              <Clock size={14} /> Entrega acordada: {fmt(envio.fecha_entrega_acordada)}
              {envio.hora_entrega_acordada && ` a las ${envio.hora_entrega_acordada.slice(0,5)}`}
            </p>
          )}
        </div>

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

        {(envio.courier || envio.tracking_number) && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Truck size={13} /> Courier</p>
            {envio.courier && <p className="text-gray-800 font-medium">{envio.courier}{envio.servicio ? ` — ${envio.servicio}` : ''}</p>}
            {envio.tracking_number && <p className="text-gray-500 text-sm font-mono mt-0.5">Tracking: {envio.tracking_number}</p>}
          </div>
        )}

        {envio.notas && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-amber-700 uppercase mb-1">Notas</p>
            <p className="text-amber-800 text-sm">{envio.notas}</p>
          </div>
        )}

        {!terminado && pagoPendiente && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 text-sm">Envío pendiente de pago</p>
              <p className="text-red-700 text-xs mt-0.5">No se puede actualizar el estado hasta que el local registre el pago. Contactalos antes de continuar.</p>
            </div>
          </div>
        )}

        {!terminado ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase">Actualizar estado</p>
            <div className="grid grid-cols-3 gap-2">
              {ESTADOS_AVANCE.map(cfg => (
                <button key={cfg.estado} onClick={() => avanzarEstado(cfg.estado)}
                  disabled={saving || envio.estado === cfg.estado || pagoPendiente}
                  className={`flex flex-col items-center gap-1.5 py-4 rounded-xl text-white font-semibold text-xs transition-all ${cfg.bg} disabled:opacity-40`}>
                  {cfg.icon}{cfg.label}
                </button>
              ))}
            </div>
            <button onClick={() => setShowNoEntrega(v => !v)} disabled={saving || pagoPendiente}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-40">
              <RotateCcw size={18} /> No entregado
            </button>

            {/* EN3/E2 — contactar al cliente + reportar incidencia */}
            <div className="grid grid-cols-3 gap-2">
              <a href={envio.cliente_telefono ? `tel:${envio.cliente_telefono}` : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium ${envio.cliente_telefono ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-gray-50 text-gray-300 pointer-events-none'}`}>
                <Phone size={16} /> Llamar
              </a>
              <button onClick={() => {
                  const url = envio.cliente_telefono ? buildWhatsAppUrl(envio.cliente_telefono, `Hola, soy el transportista de tu pedido #${envio.numero}.`) : null
                  if (url) window.open(url, '_blank', 'noopener'); else toast.error('Sin teléfono del cliente')
                }}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200">
                <MessageCircle size={16} /> WhatsApp
              </button>
              <button onClick={() => setShowIncidencia(v => !v)}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200">
                <Flag size={16} /> Incidencia
              </button>
            </div>

            {showIncidencia && (
              <div className="border border-amber-200 rounded-xl p-3 space-y-2 bg-amber-50/50">
                <select value={incTipo} onChange={e => setIncTipo(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500">
                  {INCIDENCIA_TIPOS.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
                </select>
                <textarea value={incDetalle} onChange={e => setIncDetalle(e.target.value)} rows={2}
                  placeholder="Contanos qué pasó…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500 resize-none" />
                <button onClick={reportarIncidencia}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm">Reportar incidencia</button>
              </div>
            )}

            {showNoEntrega && (
              <div className="border border-orange-200 rounded-xl p-3 space-y-2 bg-orange-50/50">
                <select value={noEntregaSub} onChange={e => setNoEntregaSub(e.target.value as SubestadoNoEntrega)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500">
                  {SUBESTADOS_NO_ENTREGA.map(s => <option key={s.v} value={s.v}>{s.t}</option>)}
                </select>
                <p className="text-xs text-gray-500">
                  {noEntregaSub === 'ausente' ? `Si quedan intentos volvés a "En camino" (máx. ${Number(envio.envio_reintentos_max ?? 3)}).` : 'Pasa a Devolución.'}
                </p>
                <textarea value={noEntregaMotivo} onChange={e => setNoEntregaMotivo(e.target.value)} rows={2}
                  placeholder="Detalle (timbre sin respuesta, dirección inexistente…)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500 resize-none" />
                <button onClick={registrarNoEntrega} disabled={saving}
                  className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-50">
                  Registrar no entregado
                </button>
              </div>
            )}

            {/* POD */}
            <div className="border-t border-gray-100 pt-3 mt-3 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                <CheckCircle size={13} className="text-green-500" /> Comprobante de entrega (POD)
              </p>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Fecha de entrega {requeridos.fecha && <span className="text-red-500">*</span>}</label>
                <input type="date" value={podFecha} onChange={e => setPodFecha(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 flex items-center gap-1"><User size={11} /> Nombre de quien recibió {requeridos.receptor && <span className="text-red-500">*</span>}</label>
                <input type="text" value={podReceptor} onChange={e => setPodReceptor(e.target.value)} placeholder="Ej: Juan García"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
              </div>
              {(requeridos.dni || podDni) && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">DNI del receptor {requeridos.dni && <span className="text-red-500">*</span>}</label>
                  <input type="text" inputMode="numeric" value={podDni} onChange={e => setPodDni(e.target.value)} placeholder="Ej: 30111222"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Observaciones</label>
                <textarea value={podNotas} onChange={e => setPodNotas(e.target.value)} placeholder="Estado del paquete, incidencias, etc."
                  rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500 resize-none" />
              </div>

              {/* Foto */}
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />
              <button onClick={() => cameraRef.current?.click()} disabled={uploadingFoto}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-violet-300 text-violet-600 rounded-xl font-medium text-sm hover:bg-violet-50 transition-colors disabled:opacity-50">
                {uploadingFoto ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                {uploadingFoto ? 'Subiendo foto…' : podUrl ? '📷 Cambiar foto' : `📷 Tomar foto del paquete${requeridos.foto || fotoMin > 0 ? ' *' : ''}`}
              </button>
              {podUrl && <a href={podUrl} target="_blank" rel="noreferrer" className="block text-center text-xs text-violet-600 underline">Ver foto subida</a>}

              {/* Firma */}
              {(requeridos.firma || podFirma) && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center gap-1"><PenLine size={11} /> Firma del receptor {requeridos.firma && <span className="text-red-500">*</span>}</label>
                  <SignaturePad initialUrl={envio.pod_firma_url} onChange={setPodFirma} />
                </div>
              )}

              {/* OTP */}
              {otpNecesario && (
                <div className={`rounded-xl p-3 border ${otpVerificado ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                  <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5 mb-2">
                    <ShieldCheck size={13} className={otpVerificado ? 'text-green-600' : 'text-blue-600'} />
                    Código de entrega {otpVerificado ? '— verificado ✓' : '(requerido por monto)'}
                  </p>
                  {otpVerificado ? (
                    <p className="text-xs text-green-700">El cliente confirmó la recepción con el código.</p>
                  ) : (
                    <div className="space-y-2">
                      <button onClick={enviarOtp} disabled={otpBusy}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
                        <MessageCircle size={15} /> {otpEnviado ? 'Reenviar código al cliente (WhatsApp)' : 'Enviar código al cliente (WhatsApp)'}
                      </button>
                      <div className="flex gap-2">
                        <input value={otpInput} onChange={e => setOtpInput(e.target.value)} inputMode="numeric" maxLength={6}
                          placeholder="Código de 6 dígitos"
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm tracking-widest text-center focus:outline-none focus:border-blue-500" />
                        <button onClick={verificarOtp} disabled={otpBusy || otpInput.trim().length < 4}
                          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
                          Verificar
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-500">Pedile el código al cliente (se lo enviamos por WhatsApp).</p>
                    </div>
                  )}
                </div>
              )}

              <p className="text-[11px] text-gray-400 flex items-center gap-1">
                <Navigation size={11} /> Al confirmar la entrega se registra tu ubicación (si el celular lo permite).
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
            <CheckCircle size={40} className="text-green-500 mx-auto mb-2" />
            <p className="font-bold text-green-800 text-lg">{envio.estado === 'entregado' ? '¡Envío entregado!' : 'Envío cancelado'}</p>
            {envio.pod_fecha && <p className="text-green-700 text-sm mt-1">Fecha: {fmt(envio.pod_fecha)}</p>}
            {envio.pod_receptor && <p className="text-green-700 text-sm">Recibido por: {envio.pod_receptor}</p>}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-300 mt-6">{BRAND.name} — Módulo de envíos</p>
    </div>
  )
}
