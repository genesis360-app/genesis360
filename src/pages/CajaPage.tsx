import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BRAND } from '@/config/brand'
import { logActividad } from '@/lib/actividadLog'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import {
  DollarSign, Plus, Minus, Lock, Unlock, History,
  Printer, X, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Clock, Info
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'

type Tab = 'caja' | 'historial' | 'configuracion'

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`
}

export default function CajaPage() {
  const { tenant, user } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('caja')
  const [cajaSeleccionada, setCajaSeleccionada] = useState<string | null>(null)
  const [showApertura, setShowApertura] = useState(false)
  const [showCierre, setShowCierre] = useState(false)
  const [showMovimiento, setShowMovimiento] = useState(false)
  const [showNuevaCaja, setShowNuevaCaja] = useState(false)
  const [sesionExpandida, setSesionExpandida] = useState<string | null>(null)

  // Forms
  const [montoApertura, setMontoApertura] = useState('')
  const [notasCierre, setNotasCierre] = useState('')
  const [montoRealCierre, setMontoRealCierre] = useState('')
  const [movTipo, setMovTipo] = useState<'ingreso' | 'egreso'>('ingreso')
  const [movConcepto, setMovConcepto] = useState('')
  const [movMonto, setMovMonto] = useState('')
  const [nuevaCajaNombre, setNuevaCajaNombre] = useState('')

  // Queries
  const { data: cajas = [] } = useQuery({
    queryKey: ['cajas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('cajas').select('*')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const cajaActual = cajas.find((c: any) => c.id === cajaSeleccionada) ?? cajas[0] ?? null
  const cajaId = cajaActual?.id ?? null

  const { data: sesionActiva } = useQuery({
    queryKey: ['sesion-activa', cajaId],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('*, abrio:usuario_id(nombre_display)')
        .eq('caja_id', cajaId!).eq('estado', 'abierta')
        .order('abierta_at', { ascending: false }).limit(1).single()
      return data ?? null
    },
    enabled: !!cajaId,
  })

  const { data: movimientos = [] } = useQuery({
    queryKey: ['caja-movimientos', sesionActiva?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_movimientos')
        .select('*, users(nombre_display)')
        .eq('sesion_id', sesionActiva!.id)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!sesionActiva?.id,
  })

  const { data: historialSesiones = [] } = useQuery({
    queryKey: ['historial-sesiones', cajaId],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('*, cajas(nombre), abrio:usuario_id(nombre_display), cerrado_por:cerrado_por_id(nombre_display)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'cerrada')
        .order('cerrada_at', { ascending: false })
        .limit(30)
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

  const { data: movimientosDetalle = [] } = useQuery({
    queryKey: ['caja-movimientos-historial', sesionExpandida],
    queryFn: async () => {
      const { data } = await supabase.from('caja_movimientos')
        .select('*, users(nombre_display)')
        .eq('sesion_id', sesionExpandida!)
        .order('created_at', { ascending: true })
      return data ?? []
    },
    enabled: !!sesionExpandida,
  })

  const { data: motivosCaja = [] } = useQuery({
    queryKey: ['motivos-caja', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('motivos_movimiento')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('tipo', 'caja').eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Calcular totales de la sesión actual
  const totalIngresos = movimientos.filter((m: any) => m.tipo === 'ingreso').reduce((a: number, m: any) => a + m.monto, 0)
  const totalEgresos = movimientos.filter((m: any) => m.tipo === 'egreso').reduce((a: number, m: any) => a + m.monto, 0)
  const saldoActual = sesionActiva ? (sesionActiva.monto_apertura + totalIngresos - totalEgresos) : 0

  // Diferencia al cierre
  const montoRealNum = parseFloat(montoRealCierre) || 0
  const diferencia = montoRealCierre !== '' ? montoRealNum - saldoActual : null

  // Multi-usuario: quién abrió la sesión
  const abrioNombre = (sesionActiva as any)?.abrio?.nombre_display ?? null
  const esOtroUsuario = !!sesionActiva && sesionActiva.usuario_id !== user?.id
  const puedeAdministrarCaja = user?.rol === 'OWNER' || user?.rol === 'SUPERVISOR' || user?.rol === 'ADMIN'

  // Mutations
  const abrirCaja = useMutation({
    mutationFn: async () => {
      if (!cajaId) throw new Error('Seleccioná una caja')
      // Verificar que no haya otra sesión abierta por otro usuario
      const { data: existente } = await supabase.from('caja_sesiones')
        .select('id, usuario_id, abrio:usuario_id(nombre_display)')
        .eq('caja_id', cajaId).eq('estado', 'abierta')
        .maybeSingle()
      if (existente && existente.usuario_id !== user?.id) {
        const nombre = (existente as any).abrio?.nombre_display ?? 'otro usuario'
        throw new Error(`Esta caja ya está abierta por ${nombre}`)
      }
      const { error } = await supabase.from('caja_sesiones').insert({
        tenant_id: tenant!.id,
        caja_id: cajaId,
        usuario_id: user?.id,
        monto_apertura: parseFloat(montoApertura) || 0,
        estado: 'abierta',
        sucursal_id: sucursalId || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Caja abierta')
      qc.invalidateQueries({ queryKey: ['sesion-activa'] })
      setShowApertura(false); setMontoApertura('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cerrarCaja = useMutation({
    mutationFn: async () => {
      if (!sesionActiva) throw new Error('No hay caja abierta')
      const payload: any = {
        estado: 'cerrada',
        monto_cierre: saldoActual,
        total_ingresos: totalIngresos,
        total_egresos: totalEgresos,
        notas_cierre: notasCierre || null,
        cerrado_por_id: user?.id,
        cerrada_at: new Date().toISOString(),
      }
      if (montoRealCierre !== '') {
        payload.monto_real_cierre = montoRealNum
        payload.diferencia_cierre = diferencia
      }
      const { error } = await supabase.from('caja_sesiones').update(payload).eq('id', sesionActiva.id)
      if (error) throw error
    },
    onSuccess: () => {
      logActividad({
        entidad: 'caja', entidad_id: sesionActiva?.id,
        entidad_nombre: cajaActual?.nombre ?? 'Caja',
        accion: 'cerrar',
        valor_nuevo: `Saldo: ${formatMoneda(saldoActual)}${diferencia !== null ? ` | Diferencia: ${formatMoneda(diferencia)}` : ''}`,
        pagina: '/caja',
      })
      toast.success('Caja cerrada')
      qc.invalidateQueries({ queryKey: ['sesion-activa'] })
      qc.invalidateQueries({ queryKey: ['historial-sesiones'] })
      setShowCierre(false); setNotasCierre(''); setMontoRealCierre('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const agregarMovimiento = useMutation({
    mutationFn: async () => {
      if (!sesionActiva) throw new Error('No hay caja abierta')
      if (!movConcepto.trim()) throw new Error('Ingresá un concepto')
      const monto = parseFloat(movMonto)
      if (!monto || monto <= 0) throw new Error('Ingresá un monto válido')
      if (movTipo === 'egreso' && monto > saldoActual) throw new Error(`Saldo insuficiente. Saldo actual: $${saldoActual.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)
      const { error } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id,
        sesion_id: sesionActiva.id,
        tipo: movTipo,
        concepto: movConcepto.trim(),
        monto,
        usuario_id: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`${movTipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado`)
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      setShowMovimiento(false); setMovConcepto(''); setMovMonto('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const crearCaja = useMutation({
    mutationFn: async () => {
      if (!nuevaCajaNombre.trim()) throw new Error('Ingresá un nombre')
      const { error } = await supabase.from('cajas').insert({
        tenant_id: tenant!.id, nombre: nuevaCajaNombre.trim()
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Caja creada')
      qc.invalidateQueries({ queryKey: ['cajas'] })
      setShowNuevaCaja(false); setNuevaCajaNombre('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Keyboard shortcuts para modales
  useModalKeyboard({ isOpen: showMovimiento, onClose: () => { setShowMovimiento(false); setMovConcepto(''); setMovMonto('') }, onConfirm: () => { if (!agregarMovimiento.isPending) agregarMovimiento.mutate() } })
  useModalKeyboard({ isOpen: showCierre, onClose: () => { setShowCierre(false); setMontoRealCierre('') }, onConfirm: () => { if (!cerrarCaja.isPending) cerrarCaja.mutate() } })
  useModalKeyboard({ isOpen: showApertura, onClose: () => setShowApertura(false), onConfirm: () => { if (!abrirCaja.isPending) abrirCaja.mutate() } })
  useModalKeyboard({ isOpen: showNuevaCaja, onClose: () => setShowNuevaCaja(false), onConfirm: () => { if (!crearCaja.isPending) crearCaja.mutate() } })

  // Atajos de teclado de página: Shift+I = ingreso, Shift+O = egreso (solo con caja abierta)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!sesionActiva || tab !== 'caja') return
      if (e.shiftKey && e.key === 'I') { e.preventDefault(); setMovTipo('ingreso'); setShowMovimiento(true) }
      if (e.shiftKey && e.key === 'O') { e.preventDefault(); setMovTipo('egreso'); setShowMovimiento(true) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [sesionActiva, tab])

  const imprimirCierre = (sesion: any) => {
    const doc = new jsPDF()
    doc.setFillColor(30, 58, 95)
    doc.rect(0, 0, doc.internal.pageSize.width, 25, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(16); doc.setFont('helvetica', 'bold')
    doc.text(BRAND.name, 14, 12)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    doc.text('Resumen de cierre de caja', 14, 20)

    doc.setTextColor(60, 60, 60)
    doc.setFontSize(10)
    doc.text(`Caja: ${sesion.cajas?.nombre ?? '—'}`, 14, 35)
    doc.text(`Negocio: ${tenant?.nombre}`, 14, 42)
    doc.text(`Apertura: ${new Date(sesion.abierta_at).toLocaleString('es-AR')}`, 14, 49)
    doc.text(`Cierre: ${new Date(sesion.cerrada_at).toLocaleString('es-AR')}`, 14, 56)
    const abrioNombre = sesion.abrio?.nombre_display ?? '—'
    const cerroNombre = sesion.cerrado_por?.nombre_display ?? abrioNombre
    doc.text(`Abrió: ${abrioNombre}`, 14, 63)
    doc.text(`Cerró: ${cerroNombre}`, 14, 70)

    const rows: any[] = [
      ['Monto de apertura', formatMoneda(sesion.monto_apertura)],
      ['Total ingresos', formatMoneda(sesion.total_ingresos)],
      ['Total egresos', formatMoneda(sesion.total_egresos)],
      ['Saldo calculado', formatMoneda(sesion.monto_cierre)],
    ]
    if (sesion.monto_real_cierre != null) {
      rows.push(['Conteo real', formatMoneda(sesion.monto_real_cierre)])
      const dif = sesion.diferencia_cierre ?? 0
      rows.push([dif >= 0 ? 'Sobrante' : 'Faltante', formatMoneda(Math.abs(dif))])
    }

    autoTable(doc, {
      startY: 78,
      head: [['Concepto', 'Monto']],
      body: rows,
      styles: { fontSize: 10 },
      headStyles: { fillColor: [30, 58, 95] },
      columnStyles: { 1: { halign: 'right' } },
    })

    if (sesion.notas_cierre) {
      const finalY = (doc as any).lastAutoTable.finalY + 10
      doc.text(`Notas: ${sesion.notas_cierre}`, 14, finalY)
    }

    doc.save(`cierre_caja_${new Date(sesion.cerrada_at).toISOString().split('T')[0]}.pdf`)
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Caja</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Gestioná la caja de tu negocio</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl w-fit">
        {[
          { id: 'caja', label: 'Caja actual' },
          { id: 'historial', label: 'Historial' },
          { id: 'configuracion', label: 'Configuración' },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`py-2 px-4 rounded-lg text-sm font-medium transition-all
              ${tab === id ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── CAJA ACTUAL ── */}
      {tab === 'caja' && (
        <div className="space-y-4">
          {/* Selector de caja */}
          {cajas.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Caja:</span>
              <select value={cajaId ?? ''} onChange={e => setCajaSeleccionada(e.target.value)}
                className="border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent">
                {cajas.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}

          {cajas.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center shadow-sm border border-gray-100">
              <DollarSign size={36} className="text-gray-300 mx-auto mb-3" />
              <p className="font-medium text-gray-600 dark:text-gray-400">No hay cajas configuradas</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Creá una caja en la pestaña Configuración</p>
              <button onClick={() => setTab('configuracion')}
                className="mt-4 text-sm text-accent hover:underline">
                Ir a configuración →
              </button>
            </div>
          ) : !sesionActiva ? (
            /* Caja cerrada */
            <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center shadow-sm border border-gray-100">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock size={28} className="text-gray-400 dark:text-gray-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300 mb-1">Caja cerrada</h2>
              <p className="text-gray-400 dark:text-gray-500 text-sm mb-6">
                {cajaActual?.nombre} — Abrí la caja para comenzar a registrar movimientos
              </p>
              {showApertura ? (
                <div className="max-w-xs mx-auto space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 text-left">Monto inicial en caja</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">$</span>
                      <input type="number" min="0" value={montoApertura} onChange={e => setMontoApertura(e.target.value)}
                        placeholder="0" autoFocus
                        className="w-full pl-7 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowApertura(false)}
                      className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                      Cancelar
                    </button>
                    <button onClick={() => abrirCaja.mutate()} disabled={abrirCaja.isPending}
                      className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm">
                      {abrirCaja.isPending ? 'Abriendo...' : 'Confirmar apertura'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowApertura(true)}
                  className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold px-6 py-3 rounded-xl transition-all mx-auto">
                  <Unlock size={18} /> Abrir caja
                </button>
              )}
            </div>
          ) : (
            /* Caja abierta */
            <div className="space-y-4">
              {/* Resumen */}
              <div className="bg-primary rounded-2xl p-5 text-white">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-blue-200 text-sm">{cajaActual?.nombre}</p>
                    <p className="text-xs text-blue-300">
                      Abierta: {new Date(sesionActiva.abierta_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                      {abrioNombre && ` · ${abrioNombre}`}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-white dark:bg-gray-800/10 rounded-xl flex items-center justify-center">
                    <Unlock size={18} className="text-green-400" />
                  </div>
                </div>
                {esOtroUsuario && (
                  <div className="bg-amber-500/20 border border-amber-400/30 rounded-xl px-3 py-2 flex items-center gap-2 mb-3">
                    <AlertTriangle size={13} className="text-amber-300 flex-shrink-0" />
                    <p className="text-amber-200 text-xs">
                      Sesión abierta por {abrioNombre ?? 'otro usuario'}. Podés registrar movimientos pero {puedeAdministrarCaja ? 'sos supervisor/dueño y podés cerrarla' : 'no podés cerrar la caja'}.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white dark:bg-gray-800/10 rounded-xl p-3 text-center">
                    <p className="text-blue-200 text-xs">Apertura</p>
                    <p className="font-bold text-lg">{formatMoneda(sesionActiva.monto_apertura)}</p>
                  </div>
                  <div className="bg-green-400/20 rounded-xl p-3 text-center">
                    <p className="text-green-200 text-xs">Ingresos</p>
                    <p className="font-bold text-lg text-green-100">{formatMoneda(totalIngresos)}</p>
                  </div>
                  <div className="bg-red-400/20 rounded-xl p-3 text-center">
                    <p className="text-red-200 text-xs">Egresos</p>
                    <p className="font-bold text-lg text-red-100">{formatMoneda(totalEgresos)}</p>
                  </div>
                </div>
                <div className="mt-3 bg-white dark:bg-gray-800/10 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-blue-200">Saldo actual</span>
                  <span className="text-2xl font-bold">{formatMoneda(saldoActual)}</span>
                </div>
              </div>

              {/* Acciones */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setMovTipo('ingreso'); setShowMovimiento(true) }}
                  className="flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all">
                  <Plus size={18} /> Ingreso
                </button>
                <button onClick={() => { setMovTipo('egreso'); setShowMovimiento(true) }}
                  className="flex items-center justify-center gap-2 bg-red-500 dark:bg-red-600 hover:bg-red-600 dark:hover:bg-red-500 text-white font-semibold py-3 rounded-xl transition-all">
                  <Minus size={18} /> Egreso
                </button>
              </div>

              {/* Movimientos */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Movimientos de la sesión</h3>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{movimientos.length} registros</span>
                </div>
                {movimientos.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin movimientos aún</p>
                ) : (
                  <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                    {movimientos.map((m: any) => (
                      <div key={m.id} className={`px-4 py-3 flex items-center justify-between ${m.tipo === 'ingreso_informativo' ? 'opacity-60' : ''}`}>
                        <div className="flex items-start gap-2 min-w-0">
                          {m.tipo === 'ingreso_informativo' && <Info size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{m.concepto}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                              {m.users?.nombre_display && ` · ${m.users.nombre_display}`}
                            </p>
                          </div>
                        </div>
                        <span className={`font-bold text-sm flex-shrink-0 ml-3 ${m.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : m.tipo === 'egreso' ? 'text-red-500' : 'text-blue-400'}`}>
                          {m.tipo === 'ingreso' ? '+' : m.tipo === 'egreso' ? '-' : '~'}{formatMoneda(m.monto)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cerrar caja */}
              {esOtroUsuario && !puedeAdministrarCaja ? (
                <div className="w-full flex items-center justify-center gap-2 border-2 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 font-semibold py-3 rounded-xl cursor-not-allowed">
                  <Lock size={18} /> Solo {abrioNombre ?? 'quien abrió'} puede cerrar esta caja
                </div>
              ) : (
                <button onClick={() => setShowCierre(true)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 dark:text-red-400 font-semibold py-3 rounded-xl hover:bg-red-50 dark:bg-red-900/20 transition-all">
                  <Lock size={18} /> Cerrar caja
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {tab === 'historial' && (
        <div className="space-y-3">
          {historialSesiones.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center text-gray-400 dark:text-gray-500 shadow-sm border border-gray-100">
              <History size={36} className="mx-auto mb-3 opacity-30" />
              <p>No hay cierres de caja registrados</p>
            </div>
          ) : historialSesiones.map((s: any) => {
            const isExpanded = sesionExpandida === s.id
            const dif = s.diferencia_cierre
            const cerroNombre = s.cerrado_por?.nombre_display ?? s.abrio?.nombre_display ?? '—'
            return (
              <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-100">{s.cajas?.nombre}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        <Clock size={11} className="inline mr-1" />
                        {new Date(s.abierta_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} →&nbsp;
                        {new Date(s.cerrada_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Cerró: {cerroNombre}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {dif != null && (
                        <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                          dif > 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                          dif < 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                          'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          {dif > 0 ? `+${formatMoneda(dif)}` : dif < 0 ? `-${formatMoneda(Math.abs(dif))}` : 'Sin diferencia'}
                        </span>
                      )}
                      <button onClick={() => imprimirCierre(s)}
                        className="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <Printer size={13} /> PDF
                      </button>
                    </div>
                  </div>

                  {/* Grilla de montos */}
                  <div className={`grid gap-2 text-center text-xs ${s.monto_real_cierre != null ? 'grid-cols-5' : 'grid-cols-4'}`}>
                    {[
                      { label: 'Apertura', val: s.monto_apertura, color: 'text-gray-700 dark:text-gray-300' },
                      { label: 'Ingresos', val: s.total_ingresos, color: 'text-green-600 dark:text-green-400' },
                      { label: 'Egresos', val: s.total_egresos, color: 'text-red-500' },
                      { label: 'Calculado', val: s.monto_cierre, color: 'text-primary' },
                      ...(s.monto_real_cierre != null ? [{ label: 'Conteo real', val: s.monto_real_cierre, color: 'font-bold text-primary' }] : []),
                    ].map(({ label, val, color }) => (
                      <div key={label} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-2">
                        <p className="text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
                        <p className={`text-sm ${color}`}>{formatMoneda(val ?? 0)}</p>
                      </div>
                    ))}
                  </div>

                  {s.notas_cierre && <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 italic">"{s.notas_cierre}"</p>}

                  {/* Toggle detalle */}
                  <button
                    onClick={() => setSesionExpandida(isExpanded ? null : s.id)}
                    className="mt-3 flex items-center gap-1 text-xs text-accent hover:underline">
                    {isExpanded ? <><ChevronUp size={13} /> Ocultar detalle</> : <><ChevronDown size={13} /> Ver movimientos</>}
                  </button>
                </div>

                {/* Detalle expandido */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {movimientosDetalle.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">Sin movimientos registrados en esta sesión</p>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {movimientosDetalle.map((m: any) => (
                          <div key={m.id} className={`px-4 py-2.5 flex items-center justify-between ${m.tipo === 'ingreso_informativo' ? 'opacity-60' : ''}`}>
                            <div className="flex items-start gap-2 min-w-0">
                              {m.tipo === 'ingreso_informativo' && <Info size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />}
                              <div className="min-w-0">
                                <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{m.concepto}</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                  {new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                                  {m.users?.nombre_display && ` · ${m.users.nombre_display}`}
                                </p>
                              </div>
                            </div>
                            <span className={`font-bold text-sm flex-shrink-0 ml-3 ${m.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : m.tipo === 'egreso' ? 'text-red-500' : 'text-blue-400'}`}>
                              {m.tipo === 'ingreso' ? '+' : m.tipo === 'egreso' ? '-' : '~'}{formatMoneda(m.monto)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── CONFIGURACIÓN ── */}
      {tab === 'configuracion' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Cajas del negocio</h2>
              <button onClick={() => setShowNuevaCaja(true)}
                className="flex items-center gap-1.5 text-sm bg-accent hover:bg-accent/90 text-white px-3 py-2 rounded-xl transition-all">
                <Plus size={15} /> Nueva caja
              </button>
            </div>

            {showNuevaCaja && (
              <div className="flex gap-2 mb-4">
                <input type="text" value={nuevaCajaNombre} onChange={e => setNuevaCajaNombre(e.target.value)}
                  placeholder="Nombre de la caja (ej: Caja 1, Caja Principal)"
                  className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                <button onClick={() => crearCaja.mutate()} disabled={crearCaja.isPending}
                  className="px-4 py-2 bg-primary text-white rounded-xl text-sm disabled:opacity-50">
                  Crear
                </button>
                <button onClick={() => setShowNuevaCaja(false)} className="px-3 py-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400">
                  <X size={18} />
                </button>
              </div>
            )}

            {cajas.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No hay cajas creadas</p>
            ) : (
              <div className="space-y-2">
                {cajas.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                        <DollarSign size={15} className="text-primary" />
                      </div>
                      <span className="font-medium text-gray-800 dark:text-gray-100">{c.nombre}</span>
                    </div>
                    <CheckCircle size={16} className="text-green-500" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal movimiento */}
      {showMovimiento && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                {movTipo === 'ingreso'
                  ? <><Plus size={18} className="text-green-600 dark:text-green-400" /> Ingreso de caja</>
                  : <><Minus size={18} className="text-orange-500" /> Egreso de caja</>}
              </h2>
              <button onClick={() => setShowMovimiento(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Concepto</label>
                <input type="text" value={movConcepto} onChange={e => setMovConcepto(e.target.value)} autoFocus
                  placeholder="Ej: Pago a proveedor, Cobro efectivo..."
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                {(motivosCaja as any[]).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(motivosCaja as any[]).map((m: any) => (
                      <button key={m.id} type="button"
                        onClick={() => setMovConcepto(m.nombre)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all
                          ${movConcepto === m.nombre
                            ? 'bg-accent text-white border-accent'
                            : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-accent hover:text-accent'}`}>
                        {m.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">$</span>
                  <input type="number" min="0" value={movMonto} onChange={e => setMovMonto(e.target.value)}
                    placeholder="0"
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowMovimiento(false)}
                className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={() => agregarMovimiento.mutate()} disabled={agregarMovimiento.isPending}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
                {agregarMovimiento.isPending ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cierre */}
      {showCierre && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary">Cerrar caja</h2>
              <button onClick={() => { setShowCierre(false); setMontoRealCierre('') }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>

            {/* Resumen calculado */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Apertura</span><span className="font-medium">{formatMoneda(sesionActiva?.monto_apertura ?? 0)}</span></div>
              <div className="flex justify-between text-green-600 dark:text-green-400"><span>+ Ingresos</span><span className="font-medium">{formatMoneda(totalIngresos)}</span></div>
              <div className="flex justify-between text-red-500"><span>− Egresos</span><span className="font-medium">{formatMoneda(totalEgresos)}</span></div>
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2 font-bold text-primary">
                <span>Saldo calculado</span><span>{formatMoneda(saldoActual)}</span>
              </div>
            </div>

            {/* Conteo real */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Conteo real en caja <span className="text-gray-400 dark:text-gray-500 font-normal">(opcional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">$</span>
                <input type="number" min="0" value={montoRealCierre}
                  onChange={e => setMontoRealCierre(e.target.value)}
                  placeholder={formatMoneda(saldoActual).replace('$', '')}
                  className="w-full pl-7 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
              {diferencia !== null && (
                <div className={`mt-2 flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg ${
                  diferencia > 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                  diferencia < 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                  'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {diferencia > 0
                    ? <><CheckCircle size={15} /> Sobran {formatMoneda(diferencia)}</>
                    : diferencia < 0
                    ? <><AlertTriangle size={15} /> Faltan {formatMoneda(Math.abs(diferencia))}</>
                    : 'Sin diferencia'}
                </div>
              )}
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas de cierre <span className="text-gray-400 dark:text-gray-500 font-normal">(opcional)</span></label>
              <textarea value={notasCierre} onChange={e => setNotasCierre(e.target.value)} rows={2}
                placeholder="Observaciones del cierre..."
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent resize-none" />
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setShowCierre(false); setMontoRealCierre('') }}
                className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={() => cerrarCaja.mutate()} disabled={cerrarCaja.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
                {cerrarCaja.isPending ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
