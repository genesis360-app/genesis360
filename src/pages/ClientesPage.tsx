import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Search, Phone, Mail, FileText, X, ChevronDown, ChevronUp, ShoppingCart } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function formatFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

interface ClienteForm {
  nombre: string
  telefono: string
  email: string
  notas: string
}

const emptyForm: ClienteForm = { nombre: '', telefono: '', email: '', notas: '' }

export default function ClientesPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ClienteForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes', tenant?.id, search],
    queryFn: async () => {
      let q = supabase.from('clientes')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .order('nombre')
      if (search) q = q.ilike('nombre', `%${search}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Estadísticas de compras por cliente
  const { data: statsMap = {} } = useQuery({
    queryKey: ['clientes-stats', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas')
        .select('cliente_id, total, created_at, estado')
        .eq('tenant_id', tenant!.id)
        .not('cliente_id', 'is', null)
        .eq('estado', 'despachada')
      if (error) throw error
      const map: Record<string, { total: number; count: number; ultima: string }> = {}
      for (const v of data ?? []) {
        if (!v.cliente_id) continue
        if (!map[v.cliente_id]) map[v.cliente_id] = { total: 0, count: 0, ultima: '' }
        map[v.cliente_id].total += v.total ?? 0
        map[v.cliente_id].count += 1
        if (!map[v.cliente_id].ultima || v.created_at > map[v.cliente_id].ultima)
          map[v.cliente_id].ultima = v.created_at
      }
      return map
    },
    enabled: !!tenant,
  })

  // Historial de ventas del cliente expandido
  const { data: historial = [] } = useQuery({
    queryKey: ['cliente-historial', expandedId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas')
        .select('id, numero, total, estado, created_at, venta_items(cantidad, precio_unitario, productos(nombre))')
        .eq('tenant_id', tenant!.id)
        .eq('cliente_id', expandedId!)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    },
    enabled: !!expandedId,
  })

  const abrirModal = (cliente?: any) => {
    if (cliente) {
      setEditId(cliente.id)
      setForm({ nombre: cliente.nombre, telefono: cliente.telefono ?? '', email: cliente.email ?? '', notas: cliente.notas ?? '' })
    } else {
      setEditId(null)
      setForm(emptyForm)
    }
    setModalOpen(true)
  }

  const guardar = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    setSaving(true)
    try {
      if (editId) {
        const { error } = await supabase.from('clientes').update({
          nombre: form.nombre.trim(),
          telefono: form.telefono || null,
          email: form.email || null,
          notas: form.notas || null,
        }).eq('id', editId)
        if (error) throw error
        toast.success('Cliente actualizado')
      } else {
        const { error } = await supabase.from('clientes').insert({
          tenant_id: tenant!.id,
          nombre: form.nombre.trim(),
          telefono: form.telefono || null,
          email: form.email || null,
          notas: form.notas || null,
        })
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

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('clientes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cliente eliminado')
      qc.invalidateQueries({ queryKey: ['clientes'] })
      qc.invalidateQueries({ queryKey: ['clientes-stats'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al eliminar'),
  })

  const ESTADOS: Record<string, { label: string; color: string }> = {
    pendiente:  { label: 'Pendiente',  color: 'bg-yellow-100 text-yellow-700' },
    reservada:  { label: 'Reservada',  color: 'bg-blue-100 text-blue-700' },
    despachada: { label: 'Despachada', color: 'bg-green-100 text-green-700' },
    cancelada:  { label: 'Cancelada',  color: 'bg-red-100 text-red-700' },
    facturada:  { label: 'Facturada',  color: 'bg-purple-100 text-purple-700' },
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
            <p className="text-sm text-gray-500">{clientes.length} registrados</p>
          </div>
        </div>
        <button
          onClick={() => abrirModal()}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} /> Nuevo cliente
        </button>
      </div>

      {/* Buscador */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre..."
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Lista */}
      {isLoading ? (
        <p className="text-center text-gray-400 py-12">Cargando...</p>
      ) : clientes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay clientes aún</p>
          <p className="text-sm mt-1">Creá el primero con el botón de arriba</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clientes.map((c: any) => {
            const stats = statsMap[c.id]
            const isExpanded = expandedId === c.id
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 text-gray-600 font-semibold text-sm">
                    {c.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{c.nombre}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {c.telefono && (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <Phone size={11} /> {c.telefono}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <Mail size={11} /> {c.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 mr-2">
                    {stats ? (
                      <>
                        <p className="font-semibold text-gray-800 text-sm">{formatMoneda(stats.total)}</p>
                        <p className="text-xs text-gray-400">{stats.count} {stats.count === 1 ? 'compra' : 'compras'}</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">Sin compras</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                      title="Ver historial"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      onClick={() => abrirModal(c)}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 text-xs font-medium"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`¿Eliminar a ${c.nombre}?`)) eliminar.mutate(c.id)
                      }}
                      className="p-2 hover:bg-red-50 rounded-lg text-red-400 text-xs"
                    >
                      Borrar
                    </button>
                  </div>
                </div>

                {/* Historial expandido */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1">
                      <ShoppingCart size={12} /> Historial de compras
                    </p>
                    {historial.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-2">Sin ventas registradas</p>
                    ) : (
                      <div className="space-y-2">
                        {historial.map((v: any) => {
                          const est = ESTADOS[v.estado] ?? { label: v.estado, color: 'bg-gray-100 text-gray-600' }
                          return (
                            <div key={v.id} className="bg-white rounded-lg p-3 border border-gray-100 flex items-center justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm text-gray-800">#{v.numero ?? v.id.slice(-6)}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${est.color}`}>{est.label}</span>
                                </div>
                                <p className="text-xs text-gray-400 mt-0.5">{formatFecha(v.created_at)}</p>
                              </div>
                              <p className="font-semibold text-gray-800 text-sm">{formatMoneda(v.total ?? 0)}</p>
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

      {/* Modal crear/editar */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-bold text-gray-800">{editId ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre completo o razón social"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block flex items-center gap-1"><Phone size={12} /> Teléfono</label>
                  <input
                    value={form.telefono}
                    onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    placeholder="Opcional"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block flex items-center gap-1"><Mail size={12} /> Email</label>
                  <input
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="Opcional"
                    type="email"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block flex items-center gap-1"><FileText size={12} /> Notas</label>
                <textarea
                  value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Observaciones internas..."
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t">
              <button onClick={() => setModalOpen(false)} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
