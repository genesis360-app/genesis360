import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Users, Plus, Search, Phone, Mail, FileText, X,
  ChevronDown, ChevronUp, ShoppingCart, TrendingUp, Clock, Pencil, Trash2, Award
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}
function formatFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function diasDesde(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias}d`
  if (dias < 365) return `hace ${Math.floor(dias / 30)}m`
  return `hace ${Math.floor(dias / 365)}a`
}

interface ClienteForm { nombre: string; telefono: string; email: string; notas: string }
const FORM_VACIO: ClienteForm = { nombre: '', telefono: '', email: '', notas: '' }

const ESTADOS: Record<string, { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'bg-yellow-100 text-yellow-700' },
  reservada:  { label: 'Reservada',  color: 'bg-blue-100 text-blue-700' },
  despachada: { label: 'Despachada', color: 'bg-green-100 text-green-700' },
  cancelada:  { label: 'Cancelada',  color: 'bg-red-100 text-red-700' },
  facturada:  { label: 'Facturada',  color: 'bg-purple-100 text-purple-700' },
}

export default function ClientesPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ClienteForm>(FORM_VACIO)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes', tenant?.id, search],
    queryFn: async () => {
      let q = supabase.from('clientes').select('*').eq('tenant_id', tenant!.id).order('nombre')
      if (search) q = q.ilike('nombre', `%${search}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: statsMap = {} } = useQuery({
    queryKey: ['clientes-stats', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('cliente_id, total, created_at')
        .eq('tenant_id', tenant!.id)
        .not('cliente_id', 'is', null)
        .in('estado', ['despachada', 'facturada'])
      const map: Record<string, { total: number; count: number; ultima: string; ticket: number }> = {}
      for (const v of data ?? []) {
        if (!v.cliente_id) continue
        if (!map[v.cliente_id]) map[v.cliente_id] = { total: 0, count: 0, ultima: '', ticket: 0 }
        map[v.cliente_id].total += v.total ?? 0
        map[v.cliente_id].count += 1
        if (!map[v.cliente_id].ultima || v.created_at > map[v.cliente_id].ultima)
          map[v.cliente_id].ultima = v.created_at
      }
      Object.values(map).forEach(s => { s.ticket = s.count > 0 ? s.total / s.count : 0 })
      return map
    },
    enabled: !!tenant,
  })

  const { data: historial = [] } = useQuery({
    queryKey: ['cliente-historial', expandedId],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('id, numero, total, estado, created_at, medio_pago, venta_items(cantidad, precio_unitario, productos(nombre))')
        .eq('tenant_id', tenant!.id)
        .eq('cliente_id', expandedId!)
        .order('created_at', { ascending: false })
        .limit(20)
      return data ?? []
    },
    enabled: !!expandedId,
  })

  // ── Stats globales ────────────────────────────────────────────────────────
  const totalFacturado = Object.values(statsMap).reduce((a, s) => a + s.total, 0)
  const clientesConCompras = Object.keys(statsMap).length
  const totalCompras = Object.values(statsMap).reduce((a, s) => a + s.count, 0)
  const ticketGlobal = totalCompras > 0 ? totalFacturado / totalCompras : 0
  const topCliente = clientes.reduce((top: any, c: any) => {
    const s = statsMap[c.id]
    if (!s) return top
    if (!top || s.total > (statsMap[top.id]?.total ?? 0)) return c
    return top
  }, null)

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const abrirModal = (cliente?: any) => {
    if (cliente) {
      setEditId(cliente.id)
      setForm({ nombre: cliente.nombre, telefono: cliente.telefono ?? '', email: cliente.email ?? '', notas: cliente.notas ?? '' })
    } else {
      setEditId(null)
      setForm(FORM_VACIO)
    }
    setModalOpen(true)
  }

  const guardar = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    setSaving(true)
    try {
      const payload = { nombre: form.nombre.trim(), telefono: form.telefono || null, email: form.email || null, notas: form.notas || null }
      if (editId) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Cliente actualizado')
      } else {
        const { error } = await supabase.from('clientes').insert({ tenant_id: tenant!.id, ...payload })
        if (error) throw error
        toast.success('Cliente creado')
      }
      qc.invalidateQueries({ queryKey: ['clientes'] })
      qc.invalidateQueries({ queryKey: ['clientes-stats'] })
      setModalOpen(false)
    } catch (err: any) {
      toast.error(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const eliminar = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar a ${nombre}?`)) return
    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    toast.success('Cliente eliminado')
    qc.invalidateQueries({ queryKey: ['clientes'] })
    qc.invalidateQueries({ queryKey: ['clientes-stats'] })
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">{clientes.length} registrado{clientes.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => abrirModal()}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
          <Plus size={18} /> Nuevo cliente
        </button>
      </div>

      {/* Stats cards */}
      {clientesConCompras > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                <TrendingUp size={18} className="text-green-600" />
              </div>
              <p className="text-sm text-gray-500">Total facturado</p>
            </div>
            <p className="text-2xl font-bold text-gray-800">{formatMoneda(totalFacturado)}</p>
            <p className="text-xs text-gray-400 mt-1">{clientesConCompras} cliente{clientesConCompras !== 1 ? 's' : ''} con compras</p>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                <ShoppingCart size={18} className="text-accent" />
              </div>
              <p className="text-sm text-gray-500">Ticket promedio</p>
            </div>
            <p className="text-2xl font-bold text-gray-800">{formatMoneda(ticketGlobal)}</p>
            <p className="text-xs text-gray-400 mt-1">{totalCompras} compra{totalCompras !== 1 ? 's' : ''} en total</p>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-yellow-50 flex items-center justify-center">
                <Award size={18} className="text-yellow-600" />
              </div>
              <p className="text-sm text-gray-500">Mejor cliente</p>
            </div>
            {topCliente ? (
              <>
                <p className="text-base font-bold text-gray-800 truncate">{topCliente.nombre}</p>
                <p className="text-xs text-gray-400 mt-1">{formatMoneda(statsMap[topCliente.id]?.total ?? 0)} en total</p>
              </>
            ) : <p className="text-2xl font-bold text-gray-300">—</p>}
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent" />
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
        </div>
      ) : clientes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-gray-400">
          <Users size={36} className="mb-3 opacity-30" />
          <p className="font-medium text-sm">No hay clientes aún</p>
          <button onClick={() => abrirModal()} className="mt-3 text-accent text-sm font-medium hover:underline">Crear el primero</button>
        </div>
      ) : (
        <div className="space-y-2">
          {clientes.map((c: any) => {
            const stats = statsMap[c.id]
            const isExpanded = expandedId === c.id
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center flex-shrink-0 text-accent font-bold text-sm">
                    {c.nombre.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{c.nombre}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {c.telefono && <span className="flex items-center gap-1 text-xs text-gray-400"><Phone size={11} /> {c.telefono}</span>}
                      {c.email && <span className="flex items-center gap-1 text-xs text-gray-400"><Mail size={11} /> {c.email}</span>}
                    </div>
                  </div>

                  {/* Stats inline */}
                  <div className="text-right flex-shrink-0 hidden sm:block mr-2">
                    {stats ? (
                      <>
                        <p className="font-semibold text-gray-800 text-sm">{formatMoneda(stats.total)}</p>
                        <p className="text-xs text-gray-400">
                          {stats.count} compra{stats.count !== 1 ? 's' : ''} · tk {formatMoneda(stats.ticket)}
                        </p>
                        {stats.ultima && (
                          <p className="text-xs text-gray-300 flex items-center gap-1 justify-end mt-0.5">
                            <Clock size={10} /> {diasDesde(stats.ultima)}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-300">Sin compras</p>
                    )}
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors" title="Ver historial">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button onClick={() => abrirModal(c)}
                      className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => eliminar(c.id, c.nombre)}
                      className="p-1.5 hover:bg-red-50 rounded-lg text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Historial expandido */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                      <ShoppingCart size={12} /> Historial de compras
                    </p>
                    {/* Mini stats del cliente */}
                    {stats && (
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-white rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800">{stats.count}</p>
                          <p className="text-xs text-gray-400">compras</p>
                        </div>
                        <div className="bg-white rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800">{formatMoneda(stats.ticket)}</p>
                          <p className="text-xs text-gray-400">ticket prom.</p>
                        </div>
                        <div className="bg-white rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800">{formatMoneda(stats.total)}</p>
                          <p className="text-xs text-gray-400">total gastado</p>
                        </div>
                      </div>
                    )}
                    {historial.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-3">Sin ventas registradas</p>
                    ) : (
                      <div className="space-y-2">
                        {historial.map((v: any) => {
                          const est = ESTADOS[v.estado] ?? { label: v.estado, color: 'bg-gray-100 text-gray-600' }
                          const items = v.venta_items ?? []
                          return (
                            <div key={v.id} className="bg-white rounded-xl p-3 border border-gray-100">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm text-gray-800">#{v.numero ?? v.id.slice(-6)}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${est.color}`}>{est.label}</span>
                                </div>
                                <div className="text-right">
                                  <p className="font-semibold text-gray-800 text-sm">{formatMoneda(v.total ?? 0)}</p>
                                  <p className="text-xs text-gray-400">{formatFecha(v.created_at)}</p>
                                </div>
                              </div>
                              {items.length > 0 && (
                                <div className="mt-2 space-y-0.5">
                                  {items.slice(0, 3).map((item: any, i: number) => (
                                    <p key={i} className="text-xs text-gray-400">
                                      {item.cantidad}× {item.productos?.nombre ?? '—'} — {formatMoneda((item.precio_unitario ?? 0) * item.cantidad)}
                                    </p>
                                  ))}
                                  {items.length > 3 && <p className="text-xs text-gray-300">+{items.length - 3} más...</p>}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{editId ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre completo o razón social" autoFocus
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                  <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    placeholder="Opcional"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="Opcional" type="email"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Observaciones internas..." rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setModalOpen(false)}
                className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={guardar} disabled={saving}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
