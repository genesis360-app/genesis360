import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Navigation, Loader2, AlertTriangle, MapPin, Phone, CheckCircle, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/config/brand'

// EN3/E3 — Hoja de ruta pública para el chofer (token agrupador). Lista los envíos de la ruta
// en orden, con link a cada página de transportista. Sin auth (SECURITY DEFINER get_hoja_ruta_by_token).

const ESTADO_COLOR: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-700', despachado: 'bg-blue-100 text-blue-700',
  en_camino: 'bg-indigo-100 text-indigo-700', en_bodega: 'bg-purple-100 text-purple-700',
  entregado: 'bg-green-100 text-green-700', devolucion: 'bg-orange-100 text-orange-700',
  cancelado: 'bg-red-100 text-red-700',
}

export default function HojaRutaPage() {
  const { token } = useParams<{ token: string }>()
  const [hoja, setHoja] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.rpc('get_hoja_ruta_by_token', { p_token: token })
      if (!data) { setNotFound(true); setLoading(false); return }
      setHoja(data); setLoading(false)
    })()
  }, [token])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center"><Loader2 size={36} className="animate-spin text-violet-600" /></div>
  )
  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
      <AlertTriangle size={48} className="text-amber-500 mb-4" />
      <h1 className="text-xl font-bold text-gray-800 mb-2">Hoja de ruta no válida</h1>
      <p className="text-gray-500 text-sm">Este enlace no existe o expiró.</p>
      <p className="text-xs text-gray-400 mt-4">{BRAND.name}</p>
    </div>
  )

  const envios: any[] = hoja.envios ?? []
  const entregados = envios.filter(e => e.estado === 'entregado').length
  const fecha = hoja.fecha ? new Date(hoja.fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }) : ''

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="bg-violet-600 text-white px-5 py-5 shadow-lg">
        <p className="text-xs font-medium opacity-75 mb-0.5">{hoja.tenant_nombre ?? BRAND.name}</p>
        <h1 className="text-xl font-bold flex items-center gap-2"><Navigation size={22} /> Hoja de ruta</h1>
        <p className="text-sm opacity-90 mt-1">{fecha}{hoja.repartidor_nombre ? ` · ${hoja.repartidor_nombre}` : ''}</p>
        <p className="text-sm mt-2"><strong>{entregados}</strong>/{envios.length} entregados</p>
      </div>

      <div className="px-4 py-5 space-y-3 max-w-lg mx-auto">
        {envios.map((e, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-sm font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-gray-800">{e.cliente ?? '—'} <span className="text-gray-400 font-normal text-sm">#{e.numero}</span></p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_COLOR[e.estado] ?? 'bg-gray-100 text-gray-700'}`}>{e.estado}</span>
                </div>
                {e.direccion && <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1"><MapPin size={12} className="text-gray-400" /> {e.direccion}{e.ciudad ? `, ${e.ciudad}` : ''}</p>}
                {(e.zona || e.hora) && <p className="text-xs text-gray-400 mt-0.5">{[e.zona, e.hora ? e.hora.slice(0,5) : null].filter(Boolean).join(' · ')}</p>}
                <div className="flex gap-2 mt-2">
                  {e.telefono && (
                    <a href={`tel:${e.telefono}`} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700"><Phone size={12} /> Llamar</a>
                  )}
                  {e.token && (
                    <a href={`${import.meta.env.VITE_APP_URL || window.location.origin}/transporte/${e.token}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-violet-100 text-violet-700">
                      <ExternalLink size={12} /> Gestionar entrega
                    </a>
                  )}
                  {e.estado === 'entregado' && <span className="flex items-center gap-1 text-xs text-green-600 px-2 py-1.5"><CheckCircle size={13} /> Entregado</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
        {envios.length === 0 && <p className="text-center text-sm text-gray-400 py-10">Esta hoja de ruta no tiene envíos.</p>}
      </div>
      <p className="text-center text-xs text-gray-300 mt-6">{BRAND.name} — Hoja de ruta</p>
    </div>
  )
}
