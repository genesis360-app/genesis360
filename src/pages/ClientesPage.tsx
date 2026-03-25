import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Users, Plus, Search, Phone, Mail, FileText, X,
  ChevronDown, ChevronUp, ShoppingCart, TrendingUp, Clock, Pencil, Trash2, Award,
  Upload, Download, CheckCircle, XCircle, FileSpreadsheet,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface FilaCliente {
  idx: number
  nombre: string
  telefono?: string
  email?: string
  notas?: string
  estado: 'nuevo' | 'duplicado' | 'error'
  errores: string[]
}

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
  pendiente:  { label: 'Pendiente',  color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  reservada:  { label: 'Reservada',  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  despachada: { label: 'Despachada', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  cancelada:  { label: 'Cancelada',  color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
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

  // Import state
  const fileRefImport = useRef<HTMLInputElement>(null)
  const [showImport, setShowImport] = useState(false)
  const [filasImport, setFilasImport] = useState<FilaCliente[]>([])
  const [importando, setImportando] = useState(false)
  const [resultadoImport, setResultadoImport] = useState<{ creados: number; errores: number } | null>(null)

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

  // ── Importación masiva ───────────────────────────────────────────────────
  const descargarPlantilla = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['nombre', 'telefono', 'email', 'notas'],
      ['Juan Pérez', '+54 11 1234-5678', 'juan@email.com', 'Cliente frecuente'],
      ['María García', '', 'maria@empresa.com', ''],
    ])
    const hdr = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
    ;['A', 'B', 'C', 'D'].forEach(c => { if (ws[`${c}1`]) ws[`${c}1`].s = hdr })
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 28 }, { wch: 35 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
    XLSX.writeFile(wb, 'plantilla_clientes.xlsx')
  }

  const procesarArchivo = (file: File) => {
    setResultadoImport(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        if (!rows.length) { toast.error('El archivo está vacío'); return }

        const nombresActuales = new Set((clientes as any[]).map(c => c.nombre.toLowerCase()))

        const filas: FilaCliente[] = rows.map((row, idx) => {
          const errores: string[] = []
          const nombre = String(row.nombre || '').trim()
          if (!nombre) errores.push('Nombre requerido')
          const isDuplicado = nombresActuales.has(nombre.toLowerCase())
          return {
            idx,
            nombre,
            telefono: String(row.telefono || '').trim() || undefined,
            email: String(row.email || '').trim() || undefined,
            notas: String(row.notas || '').trim() || undefined,
            estado: errores.length > 0 ? 'error' : isDuplicado ? 'duplicado' : 'nuevo',
            errores,
          }
        })
        setFilasImport(filas)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmarImport = async () => {
    setImportando(true)
    let creados = 0, errores = 0
    for (const fila of filasImport.filter(f => f.estado === 'nuevo')) {
      try {
        const { error } = await supabase.from('clientes').insert({
          tenant_id: tenant!.id,
          nombre: fila.nombre,
          telefono: fila.telefono ?? null,
          email: fila.email ?? null,
          notas: fila.notas ?? null,
        })
        if (error) throw error
        creados++
      } catch { errores++ }
    }
    qc.invalidateQueries({ queryKey: ['clientes'] })
    setResultadoImport({ creados, errores })
    setImportando(false)
    toast.success(`${creados} clientes importados`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Clientes</h1>
          <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm mt-0.5">{clientes.length} registrado{clientes.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowImport(true); setFilasImport([]); setResultadoImport(null) }}
            className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500 font-medium px-4 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all">
            <Upload size={16} /> Importar
          </button>
          <button onClick={() => abrirModal()}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
            <Plus size={18} /> Nuevo cliente
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {clientesConCompras > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                <TrendingUp size={18} className="text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Total facturado</p>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(totalFacturado)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{clientesConCompras} cliente{clientesConCompras !== 1 ? 's' : ''} con compras</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                <ShoppingCart size={18} className="text-accent" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Ticket promedio</p>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(ticketGlobal)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{totalCompras} compra{totalCompras !== 1 ? 's' : ''} en total</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 flex items-center justify-center">
                <Award size={18} className="text-yellow-600" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Mejor cliente</p>
            </div>
            {topCliente ? (
              <>
                <p className="text-base font-bold text-gray-800 dark:text-gray-100 truncate">{topCliente.nombre}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatMoneda(statsMap[topCliente.id]?.total ?? 0)} en total</p>
              </>
            ) : <p className="text-2xl font-bold text-gray-300">—</p>}
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
        </div>
      ) : clientes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-gray-400 dark:text-gray-500">
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
              <div key={c.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center flex-shrink-0 text-accent font-bold text-sm">
                    {c.nombre.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{c.nombre}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {c.telefono && <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500"><Phone size={11} /> {c.telefono}</span>}
                      {c.email && <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500"><Mail size={11} /> {c.email}</span>}
                    </div>
                  </div>

                  {/* Stats inline */}
                  <div className="text-right flex-shrink-0 hidden sm:block mr-2">
                    {stats ? (
                      <>
                        <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{formatMoneda(stats.total)}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
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
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 dark:text-gray-500 transition-colors" title="Ver historial">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button onClick={() => abrirModal(c)}
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 dark:text-gray-500 transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => eliminar(c.id, c.nombre)}
                      className="p-1.5 hover:bg-red-50 dark:bg-red-900/20 rounded-lg text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Historial expandido */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 dark:bg-gray-700 px-4 py-4">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                      <ShoppingCart size={12} /> Historial de compras
                    </p>
                    {/* Mini stats del cliente */}
                    {stats && (
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800 dark:text-gray-100">{stats.count}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">compras</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800 dark:text-gray-100">{formatMoneda(stats.ticket)}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">ticket prom.</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800 dark:text-gray-100">{formatMoneda(stats.total)}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">total gastado</p>
                        </div>
                      </div>
                    )}
                    {historial.length === 0 ? (
                      <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">Sin ventas registradas</p>
                    ) : (
                      <div className="space-y-2">
                        {historial.map((v: any) => {
                          const est = ESTADOS[v.estado] ?? { label: v.estado, color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500' }
                          const items = v.venta_items ?? []
                          return (
                            <div key={v.id} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">#{v.numero ?? v.id.slice(-6)}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${est.color}`}>{est.label}</span>
                                </div>
                                <div className="text-right">
                                  <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{formatMoneda(v.total ?? 0)}</p>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">{formatFecha(v.created_at)}</p>
                                </div>
                              </div>
                              {items.length > 0 && (
                                <div className="mt-2 space-y-0.5">
                                  {items.slice(0, 3).map((item: any, i: number) => (
                                    <p key={i} className="text-xs text-gray-400 dark:text-gray-500">
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
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editId ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 dark:text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre completo o razón social" autoFocus
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teléfono</label>
                  <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    placeholder="Opcional"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                  <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="Opcional" type="email"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
                <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Observaciones internas..." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setModalOpen(false)}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm">
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

      {/* Modal importación masiva */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <FileSpreadsheet size={18} className="text-accent" /> Importar clientes
              </h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:text-gray-500"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Resultado */}
              {resultadoImport && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle size={18} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-green-800 dark:text-green-400">Importación completada</p>
                    <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">{resultadoImport.creados} creados · {resultadoImport.errores} errores</p>
                    <button onClick={() => setShowImport(false)} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Cerrar →</button>
                  </div>
                </div>
              )}

              {/* Acciones */}
              {!resultadoImport && (
                <div className="flex gap-3 flex-wrap">
                  <button onClick={descargarPlantilla}
                    className="flex items-center gap-2 border border-accent text-accent font-medium px-4 py-2 rounded-xl hover:bg-accent/5 text-sm transition-all">
                    <Download size={14} /> Descargar plantilla
                  </button>
                  <button onClick={() => fileRefImport.current?.click()}
                    className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2 rounded-xl text-sm transition-all">
                    <Upload size={14} /> Cargar archivo
                  </button>
                  <input ref={fileRefImport} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivo(f); e.target.value = '' }} />
                </div>
              )}

              {/* Vista previa */}
              {filasImport.length > 0 && !resultadoImport && (
                <>
                  <div className="flex items-center gap-3 text-sm flex-wrap">
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                      <CheckCircle size={14} /> {filasImport.filter(f => f.estado === 'nuevo').length} nuevos
                    </span>
                    {filasImport.filter(f => f.estado === 'duplicado').length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        ⚠ {filasImport.filter(f => f.estado === 'duplicado').length} duplicados (se omitirán)
                      </span>
                    )}
                    {filasImport.filter(f => f.estado === 'error').length > 0 && (
                      <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                        <XCircle size={14} /> {filasImport.filter(f => f.estado === 'error').length} con errores
                      </span>
                    )}
                  </div>

                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                          <th className="px-3 py-2 text-left">Nombre</th>
                          <th className="px-3 py-2 text-left hidden sm:table-cell">Teléfono</th>
                          <th className="px-3 py-2 text-left hidden sm:table-cell">Email</th>
                          <th className="px-3 py-2 text-left">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filasImport.slice(0, 50).map(f => (
                          <tr key={f.idx} className={f.estado === 'error' ? 'bg-red-50 dark:bg-red-900/20' : f.estado === 'duplicado' ? 'bg-amber-50 dark:bg-amber-900/20/50' : ''}>
                            <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{f.nombre || <span className="text-gray-400 dark:text-gray-500 italic">—</span>}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 dark:text-gray-500 hidden sm:table-cell">{f.telefono ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 dark:text-gray-500 hidden sm:table-cell">{f.email ?? '—'}</td>
                            <td className="px-3 py-2">
                              {f.estado === 'nuevo' && <span className="text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded-full">Nuevo</span>}
                              {f.estado === 'duplicado' && <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">Existe</span>}
                              {f.estado === 'error' && <span className="text-xs text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">{f.errores[0]}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filasImport.length > 50 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Mostrando 50 de {filasImport.length} filas</p>
                    )}
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setFilasImport([])}
                      className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500 font-medium px-4 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                      Limpiar
                    </button>
                    <button onClick={confirmarImport} disabled={importando || filasImport.filter(f => f.estado === 'nuevo').length === 0}
                      className="bg-accent hover:bg-accent/90 text-white font-semibold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 transition-all">
                      {importando ? 'Importando...' : `Importar ${filasImport.filter(f => f.estado === 'nuevo').length} clientes`}
                    </button>
                  </div>
                </>
              )}

              {filasImport.length === 0 && !resultadoImport && (
                <div
                  className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all"
                  onClick={() => fileRefImport.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f) }}>
                  <FileSpreadsheet size={32} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Arrastrá o hacé click para subir tu Excel</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Columnas: nombre, telefono, email, notas</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
