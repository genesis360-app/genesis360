import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Receipt, TrendingDown, Calendar, Filter, X, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import toast from 'react-hot-toast'

const CATEGORIAS_GASTO = [
  'Alquiler', 'Servicios (luz/gas/agua/internet)', 'Sueldos y cargas sociales',
  'Compras de mercadería', 'Transporte y logística', 'Mantenimiento y reparaciones',
  'Marketing y publicidad', 'Impuestos y tasas', 'Seguros', 'Insumos y descartables',
  'Honorarios profesionales', 'Otro',
]
const MEDIOS_PAGO = ['Efectivo', 'Tarjeta débito', 'Tarjeta crédito', 'Transferencia', 'Mercado Pago', 'Otro']

interface FormGasto {
  descripcion: string
  monto: string
  categoria: string
  medio_pago: string
  fecha: string
  notas: string
}

const FORM_VACIO: FormGasto = {
  descripcion: '', monto: '', categoria: '', medio_pago: 'Efectivo',
  fecha: new Date().toISOString().split('T')[0], notas: '',
}

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatFecha(f: string) {
  return new Date(f + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function GastosPage() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()

  const [modalAbierto, setModalAbierto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState<FormGasto>(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])

  const { data: sesionesAbiertas = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, caja_id, cajas(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'abierta')
      return data ?? []
    },
    enabled: !!tenant,
    refetchInterval: 60_000,
  })
  const [cajaSeleccionadaId, setCajaSeleccionadaId] = useState<string | null>(null)
  const sesionCajaId = cajaSeleccionadaId ?? (sesionesAbiertas.length === 1 ? (sesionesAbiertas[0] as any).id : null)

  const { data: gastos = [], isLoading } = useQuery({
    queryKey: ['gastos', tenant?.id, fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data } = await supabase.from('gastos')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  // ── Stats ────────────────────────────────────────────────────────────────
  const gastosFiltrados = filtroCategoria
    ? gastos.filter((g: any) => g.categoria === filtroCategoria)
    : gastos

  const totalPeriodo = gastosFiltrados.reduce((a: number, g: any) => a + Number(g.monto), 0)
  const cantPeriodo = gastosFiltrados.length
  const mayorGasto = gastosFiltrados.reduce((max: any, g: any) => (!max || Number(g.monto) > Number(max.monto)) ? g : max, null)

  const categoriasTotales: Record<string, number> = {}
  gastosFiltrados.forEach((g: any) => {
    const cat = g.categoria || 'Sin categoría'
    categoriasTotales[cat] = (categoriasTotales[cat] || 0) + Number(g.monto)
  })
  const categoriasOrdenadas = Object.entries(categoriasTotales).sort((a, b) => b[1] - a[1])

  // ── Categorías únicas para filtro ────────────────────────────────────────
  const categoriasUnicas = [...new Set(gastos.map((g: any) => g.categoria).filter(Boolean))] as string[]

  // ── Modal helpers ────────────────────────────────────────────────────────
  const abrirNuevo = () => {
    setEditandoId(null)
    setForm(FORM_VACIO)
    setModalAbierto(true)
  }

  const abrirEdicion = (g: any) => {
    setEditandoId(g.id)
    setForm({
      descripcion: g.descripcion,
      monto: String(g.monto),
      categoria: g.categoria ?? '',
      medio_pago: g.medio_pago ?? 'Efectivo',
      fecha: g.fecha,
      notas: g.notas ?? '',
    })
    setModalAbierto(true)
  }

  const cerrarModal = () => { setModalAbierto(false); setEditandoId(null); setForm(FORM_VACIO); setCajaSeleccionadaId(null) }

  useModalKeyboard({ isOpen: modalAbierto, onClose: cerrarModal, onConfirm: () => { if (!guardando) guardar() } })

  // ── Guardar ──────────────────────────────────────────────────────────────
  const guardar = async () => {
    if (!form.descripcion.trim()) { toast.error('La descripción es requerida'); return }
    const monto = parseFloat(form.monto.replace(',', '.'))
    if (!monto || monto <= 0) { toast.error('Ingresá un monto válido'); return }
    // Bloquear si efectivo y no hay caja abierta (solo gastos nuevos)
    if (!editandoId && form.medio_pago === 'Efectivo' && !sesionCajaId) {
      toast.error('No hay caja abierta. Abrí una caja antes de registrar gastos en efectivo.')
      return
    }

    setGuardando(true)
    try {
      const payload = {
        tenant_id: tenant!.id,
        descripcion: form.descripcion.trim(),
        monto,
        categoria: form.categoria || null,
        medio_pago: form.medio_pago || null,
        fecha: form.fecha,
        notas: form.notas.trim() || null,
      }

      if (editandoId) {
        const { error } = await supabase.from('gastos').update(payload).eq('id', editandoId)
        if (error) throw error
        toast.success('Gasto actualizado')
        logActividad({ entidad: 'gasto', entidad_id: editandoId, entidad_nombre: form.descripcion.trim(), accion: 'editar', pagina: '/gastos' })
      } else {
        const { error } = await supabase.from('gastos').insert(payload)
        if (error) throw error
        toast.success('Gasto registrado')
        logActividad({ entidad: 'gasto', entidad_nombre: form.descripcion.trim(), accion: 'crear', valor_nuevo: `$${monto}`, pagina: '/gastos' })
        if (form.medio_pago === 'Efectivo' && sesionCajaId) {
          void supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id,
            sesion_id: sesionCajaId,
            tipo: 'egreso',
            concepto: `Gasto: ${form.descripcion.trim()}`,
            monto,
            usuario_id: user?.id,
          }).then(() => qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] }))
        }
      }

      qc.invalidateQueries({ queryKey: ['gastos'] })
      cerrarModal()
    } catch (e: any) {
      toast.error(e.message ?? 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  // ── Eliminar ─────────────────────────────────────────────────────────────
  const eliminar = async (id: string) => {
    if (!confirm('¿Eliminár este gasto?')) return
    const g = (gastos as any[]).find(x => x.id === id)
    const { error } = await supabase.from('gastos').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    qc.invalidateQueries({ queryKey: ['gastos'] })
    toast.success('Gasto eliminado')
    logActividad({ entidad: 'gasto', entidad_id: id, entidad_nombre: g?.descripcion, accion: 'eliminar', pagina: '/gastos' })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Gastos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Registrá los egresos de tu negocio</p>
        </div>
        <button onClick={abrirNuevo}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
          <Plus size={18} /> Nuevo gasto
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm">
          <Calendar size={15} className="text-gray-400" />
          <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
            className="outline-none text-gray-700 bg-transparent" />
          <span className="text-gray-400">→</span>
          <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
            className="outline-none text-gray-700 bg-transparent" />
        </div>

        {categoriasUnicas.length > 0 && (
          <div className="relative">
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
              className="appearance-none bg-white border border-gray-200 rounded-xl pl-3 pr-8 py-2 text-sm text-gray-700 outline-none focus:border-accent cursor-pointer">
              <option value="">Todas las categorías</option>
              {categoriasUnicas.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}

        {filtroCategoria && (
          <button onClick={() => setFiltroCategoria('')}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} /> Limpiar filtro
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
              <TrendingDown size={18} className="text-red-500" />
            </div>
            <p className="text-sm text-gray-500">Total período</p>
          </div>
          <p className="text-2xl font-bold text-gray-800">{formatMoneda(totalPeriodo)}</p>
          <p className="text-xs text-gray-400 mt-1">{cantPeriodo} gasto{cantPeriodo !== 1 ? 's' : ''}</p>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
              <Receipt size={18} className="text-orange-500" />
            </div>
            <p className="text-sm text-gray-500">Mayor gasto</p>
          </div>
          {mayorGasto ? (
            <>
              <p className="text-2xl font-bold text-gray-800">{formatMoneda(Number(mayorGasto.monto))}</p>
              <p className="text-xs text-gray-400 mt-1 truncate">{mayorGasto.descripcion}</p>
            </>
          ) : (
            <p className="text-2xl font-bold text-gray-300">—</p>
          )}
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
              <Filter size={18} className="text-accent" />
            </div>
            <p className="text-sm text-gray-500">Mayor categoría</p>
          </div>
          {categoriasOrdenadas.length > 0 ? (
            <>
              <p className="text-2xl font-bold text-gray-800">{formatMoneda(categoriasOrdenadas[0][1])}</p>
              <p className="text-xs text-gray-400 mt-1 truncate">{categoriasOrdenadas[0][0]}</p>
            </>
          ) : (
            <p className="text-2xl font-bold text-gray-300">—</p>
          )}
        </div>
      </div>

      {/* Desglose por categoría (si hay datos) */}
      {categoriasOrdenadas.length > 1 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-700 mb-4 text-sm">Por categoría</h2>
          <div className="space-y-3">
            {categoriasOrdenadas.map(([cat, total]) => {
              const pct = totalPeriodo > 0 ? (total / totalPeriodo) * 100 : 0
              return (
                <div key={cat}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 truncate max-w-xs">{cat}</span>
                    <span className="font-medium text-gray-800 flex-shrink-0 ml-2">{formatMoneda(total)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-accent/60 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Lista de gastos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
          </div>
        ) : gastosFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-gray-400">
            <Receipt size={36} className="mb-3 opacity-30" />
            <p className="font-medium text-sm">No hay gastos en este período</p>
            <button onClick={abrirNuevo} className="mt-3 text-accent text-sm font-medium hover:underline">
              Registrar el primero
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Fecha</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Descripción</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Categoría</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Medio de pago</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Monto</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {gastosFiltrados.map((g: any) => (
                  <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatFecha(g.fecha)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{g.descripcion}</p>
                      {g.notas && <p className="text-xs text-gray-400 mt-0.5">{g.notas}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {g.categoria ? (
                        <span className="inline-block px-2 py-0.5 bg-purple-50 text-accent text-xs rounded-lg font-medium">
                          {g.categoria}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-sm">{g.medio_pago ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{formatMoneda(Number(g.monto))}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => abrirEdicion(g)}
                          className="p-1.5 text-gray-400 hover:text-accent hover:bg-gray-100 rounded-lg transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => eliminar(g.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-gray-600">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600">{formatMoneda(totalPeriodo)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalAbierto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{editandoId ? 'Editar gasto' : 'Nuevo gasto'}</h2>
              <button onClick={cerrarModal} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Descripción */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción *</label>
                <input
                  type="text"
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: Pago de alquiler enero"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                  autoFocus
                />
              </div>

              {/* Monto y Fecha en fila */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Monto ($) *</label>
                  <input
                    type="number"
                    value={form.monto}
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                    placeholder="0"
                    min="0"
                    step="0.01"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Categoría */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                <div className="relative">
                  <select
                    value={form.categoria}
                    onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    <option value="">Sin categoría</option>
                    {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Medio de pago */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
                <div className="relative">
                  <select
                    value={form.medio_pago}
                    onChange={e => setForm(f => ({ ...f, medio_pago: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
                <textarea
                  value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Detalles adicionales..."
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none"
                />
              </div>
            </div>

            {/* Estado de caja para efectivo (solo gastos nuevos) */}
            {!editandoId && form.medio_pago === 'Efectivo' && (
              <div className="px-5 pb-3">
                {sesionesAbiertas.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <span>⚠️</span><span>Sin caja abierta — el egreso no se registrará en caja</span>
                  </div>
                ) : sesionesAbiertas.length > 1 ? (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Registrar egreso en caja:</label>
                    <select value={cajaSeleccionadaId ?? ''} onChange={e => setCajaSeleccionadaId(e.target.value || null)}
                      className="w-full appearance-none border border-gray-200 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white">
                      <option value="">— Seleccioná una caja —</option>
                      {(sesionesAbiertas as any[]).map(s => (
                        <option key={s.id} value={s.id}>{s.cajas?.nombre ?? 'Caja'}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                    <span>✓</span><span>Egreso en efectivo → {(sesionesAbiertas[0] as any).cajas?.nombre ?? 'Caja'}</span>
                  </div>
                )}
              </div>
            )}
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={cerrarModal}
                className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Registrar gasto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
