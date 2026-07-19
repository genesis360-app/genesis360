import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, AlertTriangle, Clock, LogIn, LogOut, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/config/brand'

// RH6 — Fichado por QR público (kiosco). El empleado abre /fichar/:token, toca su nombre
// y queda registrada la entrada/salida (origen 'qr'). Sin auth: RPCs SECURITY DEFINER
// get_fichado_info / fichar_qr expuestas a anon. El token es el secreto.

interface EmpleadoFichado {
  id: string
  nombre: string | null
  apellido: string | null
  ultimo_tipo_hoy: 'entrada' | 'salida' | null
}

export default function FicharPage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<{ tenant_nombre: string; empleados: EmpleadoFichado[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [fichando, setFichando] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<{ nombre: string; tipo: string; hora: string } | null>(null)
  const [ahora, setAhora] = useState(new Date())

  const cargar = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_fichado_info', { p_token: token })
    if (!data) { setNotFound(true); setLoading(false); return }
    setInfo(data as any); setLoading(false)
  }, [token])

  useEffect(() => { cargar() }, [cargar])
  // Reloj en vivo
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 1000); return () => clearInterval(t) }, [])

  const fichar = async (emp: EmpleadoFichado) => {
    setFichando(emp.id)
    const { data, error } = await supabase.rpc('fichar_qr', { p_token: token, p_empleado_id: emp.id })
    setFichando(null)
    const res = data as any
    if (error || !res?.ok) { alert(res?.error ?? 'No se pudo registrar el fichaje'); return }
    setUltimo({
      nombre: [emp.nombre, emp.apellido].filter(Boolean).join(' '),
      tipo: res.tipo,
      hora: new Date(res.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    })
    cargar()
    setTimeout(() => setUltimo(null), 6000)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center"><Loader2 size={36} className="animate-spin text-accent-text" /></div>
  )
  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
      <AlertTriangle size={48} className="text-amber-500 mb-4" />
      <h1 className="text-xl font-bold text-gray-800 mb-2">Enlace de fichado no válido</h1>
      <p className="text-gray-500 text-sm">Este QR no existe o fue regenerado. Pedile el nuevo al encargado.</p>
      <p className="text-xs text-gray-400 mt-4">{BRAND.name}</p>
    </div>
  )

  const empleados = info?.empleados ?? []

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-5 py-4 text-center">
        <p className="font-bold text-lg text-primary">{info?.tenant_nombre}</p>
        <p className="text-sm text-gray-500 flex items-center justify-center gap-1.5 mt-0.5">
          <Clock size={14} /> {ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · {ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </header>

      {ultimo && (
        <div className="mx-4 mt-4 rounded-2xl bg-green-50 border border-green-200 px-5 py-4 flex items-center gap-3">
          <CheckCircle2 size={26} className="text-green-600 shrink-0" />
          <div>
            <p className="font-semibold text-green-800">{ultimo.tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada — {ultimo.hora}</p>
            <p className="text-sm text-green-700">{ultimo.nombre}</p>
          </div>
        </div>
      )}

      <main className="flex-1 p-4">
        <p className="text-sm text-gray-500 mb-3 text-center">Tocá tu nombre para fichar</p>
        {empleados.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-10">No hay empleados activos cargados.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
            {empleados.map(emp => {
              const entrada = emp.ultimo_tipo_hoy !== 'entrada'  // si su último de hoy NO es entrada → próximo es entrada
              const nombre = [emp.nombre, emp.apellido].filter(Boolean).join(' ') || 'Empleado'
              return (
                <button
                  key={emp.id}
                  onClick={() => fichar(emp)}
                  disabled={fichando === emp.id}
                  className={`flex items-center justify-between gap-3 rounded-2xl px-5 py-5 text-left shadow-sm transition-all active:scale-[0.98] disabled:opacity-50 ${entrada
                    ? 'bg-white border-2 border-gray-200 hover:border-accent-text text-gray-800'
                    : 'bg-amber-50 border-2 border-amber-200 hover:border-amber-400 text-amber-900'}`}>
                  <span className="font-semibold text-lg truncate">{nombre}</span>
                  <span className={`flex items-center gap-1.5 text-sm font-bold shrink-0 ${entrada ? 'text-accent-text' : 'text-amber-600'}`}>
                    {fichando === emp.id
                      ? <Loader2 size={20} className="animate-spin" />
                      : entrada ? <><LogIn size={20} /> Entrada</> : <><LogOut size={20} /> Salida</>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </main>

      <footer className="text-center py-4 text-xs text-gray-400">{BRAND.name} · Fichado</footer>
    </div>
  )
}
