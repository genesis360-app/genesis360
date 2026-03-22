import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Tag, Truck, MapPin, Building2, CircleDot, MessageSquare, Search, Gift, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type Tab = 'negocio' | 'categorias' | 'proveedores' | 'ubicaciones' | 'estados' | 'motivos' | 'combos'
interface Item { id: string; nombre: string; descripcion?: string; contacto?: string; color?: string; activo: boolean }

const COLORES = [
  { label: 'Verde', value: '#22c55e' },
  { label: 'Azul', value: '#3b82f6' },
  { label: 'Amarillo', value: '#eab308' },
  { label: 'Rojo', value: '#ef4444' },
  { label: 'Naranja', value: '#f97316' },
  { label: 'Violeta', value: '#8b5cf6' },
  { label: 'Gris', value: '#6b7280' },
  { label: 'Celeste', value: '#06b6d4' },
]

function ListaABM({ items, loading, onAdd, onUpdate, onDelete, withDescription = false, withColor = false }: {
  items: Item[]
  loading: boolean
  onAdd: (nombre: string, extra?: string) => Promise<void>
  onUpdate: (id: string, nombre: string, extra?: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  withDescription?: boolean
  withColor?: boolean
}) {
  const [newNombre, setNewNombre] = useState('')
  const [newExtra, setNewExtra] = useState(withColor ? '#22c55e' : '')
  const [editId, setEditId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editExtra, setEditExtra] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const handleAdd = async () => {
    if (!newNombre.trim()) return
    setSaving(true)
    await onAdd(newNombre.trim(), newExtra || undefined)
    setNewNombre(''); setNewExtra(withColor ? '#22c55e' : '')
    setSaving(false)
  }

  const handleUpdate = async (id: string) => {
    if (!editNombre.trim()) return
    setSaving(true)
    await onUpdate(id, editNombre.trim(), editExtra || undefined)
    setEditId(null)
    setSaving(false)
  }

  const startEdit = (item: Item) => {
    setEditId(item.id); setEditNombre(item.nombre)
    setEditExtra(item.color ?? item.descripcion ?? item.contacto ?? '')
  }

  const itemsFiltrados = search.trim()
    ? items.filter(i => i.nombre.toLowerCase().includes(search.toLowerCase()))
    : items

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <div className="flex gap-2">
          {withColor && (
            <div className="flex gap-1 items-center">
              {COLORES.map(c => (
                <button key={c.value} type="button" onClick={() => setNewExtra(c.value)}
                  title={c.label}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${newExtra === c.value ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c.value }} />
              ))}
            </div>
          )}
          <input type="text" value={newNombre} onChange={e => setNewNombre(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Nombre..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent" />
          <button onClick={handleAdd} disabled={saving || !newNombre.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-accent text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
            <Plus size={15} /> Agregar
          </button>
        </div>
        {withDescription && (
          <input type="text" value={newExtra} onChange={e => setNewExtra(e.target.value)}
            placeholder="Descripción (opcional)..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent" />
        )}
      </div>

      {items.length > 4 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent bg-white" />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      ) : itemsFiltrados.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">{items.length === 0 ? 'No hay elementos cargados aún' : 'Sin resultados para esa búsqueda'}</p>
      ) : (
        <div className="space-y-2">
          {itemsFiltrados.map(item => (
            <div key={item.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3">
              {editId === item.id ? (
                <>
                  <div className="flex-1 space-y-1.5">
                    {withColor && (
                      <div className="flex gap-1">
                        {COLORES.map(c => (
                          <button key={c.value} type="button" onClick={() => setEditExtra(c.value)}
                            className={`w-6 h-6 rounded-full border-2 transition-all ${editExtra === c.value ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: c.value }} />
                        ))}
                      </div>
                    )}
                    <input type="text" value={editNombre} onChange={e => setEditNombre(e.target.value)}
                      className="w-full px-3 py-1.5 border border-accent rounded-lg text-sm focus:outline-none" />
                    {withDescription && (
                      <input type="text" value={editExtra} onChange={e => setEditExtra(e.target.value)}
                        placeholder="Descripción..."
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none" />
                    )}
                  </div>
                  <button onClick={() => handleUpdate(item.id)} disabled={saving}
                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditId(null)}
                    className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors">
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  {withColor && item.color && (
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{item.nombre}</p>
                    {(item.descripcion || item.contacto) && (
                      <p className="text-xs text-gray-400 mt-0.5">{item.descripcion ?? item.contacto}</p>
                    )}
                  </div>
                  <button onClick={() => startEdit(item)}
                    className="p-1.5 text-gray-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-colors">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => onDelete(item.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MotivosList({ motivos, loading, onAdd, onUpdate, onDelete }: {
  motivos: any[]; loading: boolean
  onAdd: (nombre: string, tipo?: string) => Promise<void>
  onUpdate: (id: string, nombre: string, tipo?: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [newNombre, setNewNombre] = useState('')
  const [newTipo, setNewTipo] = useState('ambos')
  const [editId, setEditId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editTipo, setEditTipo] = useState('ambos')
  const [saving, setSaving] = useState(false)
  const [filterTipo, setFilterTipo] = useState<'todos' | 'ingreso' | 'rebaje' | 'ambos'>('todos')
  const [search, setSearch] = useState('')

  const TIPOS = [
    { value: 'ingreso', label: 'Solo ingreso' },
    { value: 'rebaje', label: 'Solo rebaje' },
    { value: 'ambos', label: 'Ambos' },
  ]
  const tipoLabel = (tipo: string) => TIPOS.find(t => t.value === tipo)?.label ?? tipo
  const tipoColor = (tipo: string) => tipo === 'ingreso' ? 'bg-green-100 text-green-700' : tipo === 'rebaje' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'

  const handleAdd = async () => {
    if (!newNombre.trim()) return
    setSaving(true)
    await onAdd(newNombre.trim(), newTipo)
    setNewNombre(''); setNewTipo('ambos'); setSaving(false)
  }

  const motivosFiltrados = motivos
    .filter((m: any) => filterTipo === 'todos' || m.tipo === filterTipo)
    .filter((m: any) => !search.trim() || m.nombre.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input type="text" value={newNombre} onChange={e => setNewNombre(e.target.value)}
          placeholder="Nuevo motivo..." onKeyDown={e => e.key === 'Enter' && handleAdd()}
          className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent" />
        <select value={newTipo} onChange={e => setNewTipo(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent">
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={handleAdd} disabled={saving || !newNombre.trim()}
          className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm disabled:opacity-50 hover:bg-accent transition-all">
          <Plus size={16} />
        </button>
      </div>

      {/* Buscador */}
      {motivos.length > 4 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar motivo..."
            className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent bg-white" />
        </div>
      )}

      {/* Filtro por tipo */}
      <div className="flex gap-1">
        {(['todos', 'ingreso', 'rebaje', 'ambos'] as const).map(t => (
          <button key={t} onClick={() => setFilterTipo(t)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize
              ${filterTipo === t ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {t === 'todos' ? 'Todos' : t === 'ingreso' ? 'Solo ingreso' : t === 'rebaje' ? 'Solo rebaje' : 'Ambos'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
      ) : motivosFiltrados.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          {motivos.length === 0 ? 'No hay motivos cargados' : 'Sin resultados'}
        </p>
      ) : (
        <div className="space-y-2">
          {motivosFiltrados.map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              {editId === m.id ? (
                <>
                  <input type="text" value={editNombre} onChange={e => setEditNombre(e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent" />
                  <select value={editTipo} onChange={e => setEditTipo(e.target.value)}
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none">
                    {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <button onClick={async () => { setSaving(true); await onUpdate(m.id, editNombre, editTipo); setEditId(null); setSaving(false) }}
                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"><Check size={15} /></button>
                  <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={15} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-800">{m.nombre}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tipoColor(m.tipo)}`}>{tipoLabel(m.tipo)}</span>
                  <button onClick={() => { setEditId(m.id); setEditNombre(m.nombre); setEditTipo(m.tipo) }}
                    className="p-1.5 text-gray-400 hover:text-accent hover:bg-blue-50 rounded-lg"><Pencil size={15} /></button>
                  <button onClick={() => onDelete(m.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('negocio')
  const { tenant, user, setTenant } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = user?.rol === 'OWNER'

  const [bizForm, setBizForm] = useState({ nombre: tenant?.nombre ?? '', tipo_comercio: tenant?.tipo_comercio ?? '' })
  const [savingBiz, setSavingBiz] = useState(false)

  const handleSaveBiz = async () => {
    setSavingBiz(true)
    const { data, error } = await supabase.from('tenants')
      .update({ nombre: bizForm.nombre, tipo_comercio: bizForm.tipo_comercio })
      .eq('id', tenant!.id).select().single()
    if (error) toast.error(error.message)
    else { setTenant(data); toast.success('Datos actualizados') }
    setSavingBiz(false)
  }

  // Categorías
  const { data: categorias = [], isLoading: loadingCat } = useQuery({
    queryKey: ['categorias', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('categorias').select('*').eq('tenant_id', tenant!.id).order('nombre'); return (data ?? []) as Item[] },
    enabled: !!tenant,
  })
  const addCategoria = async (nombre: string, descripcion?: string) => {
    const { error } = await supabase.from('categorias').insert({ tenant_id: tenant!.id, nombre, descripcion })
    if (error) toast.error(error.message); else { toast.success('Categoría agregada'); qc.invalidateQueries({ queryKey: ['categorias'] }) }
  }
  const updateCategoria = async (id: string, nombre: string, descripcion?: string) => {
    const { error } = await supabase.from('categorias').update({ nombre, descripcion }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizada'); qc.invalidateQueries({ queryKey: ['categorias'] }) }
  }
  const deleteCategoria = async (id: string) => {
    if (!confirm('¿Eliminar esta categoría?')) return
    const { error } = await supabase.from('categorias').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminada'); qc.invalidateQueries({ queryKey: ['categorias'] }) }
  }

  // Proveedores
  const { data: proveedores = [], isLoading: loadingProv } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('proveedores').select('*').eq('tenant_id', tenant!.id).order('nombre'); return (data ?? []) as Item[] },
    enabled: !!tenant,
  })
  const addProveedor = async (nombre: string, contacto?: string) => {
    const { error } = await supabase.from('proveedores').insert({ tenant_id: tenant!.id, nombre, contacto })
    if (error) toast.error(error.message); else { toast.success('Proveedor agregado'); qc.invalidateQueries({ queryKey: ['proveedores'] }) }
  }
  const updateProveedor = async (id: string, nombre: string, contacto?: string) => {
    const { error } = await supabase.from('proveedores').update({ nombre, contacto }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['proveedores'] }) }
  }
  const deleteProveedor = async (id: string) => {
    if (!confirm('¿Eliminar este proveedor?')) return
    const { error } = await supabase.from('proveedores').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['proveedores'] }) }
  }

  // Ubicaciones
  const { data: ubicaciones = [], isLoading: loadingUbic } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).order('nombre'); return (data ?? []) as Item[] },
    enabled: !!tenant,
  })
  const addUbicacion = async (nombre: string, descripcion?: string) => {
    const { error } = await supabase.from('ubicaciones').insert({ tenant_id: tenant!.id, nombre, descripcion })
    if (error) toast.error(error.message); else { toast.success('Ubicación agregada'); qc.invalidateQueries({ queryKey: ['ubicaciones'] }) }
  }
  const updateUbicacion = async (id: string, nombre: string, descripcion?: string) => {
    const { error } = await supabase.from('ubicaciones').update({ nombre, descripcion }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizada'); qc.invalidateQueries({ queryKey: ['ubicaciones'] }) }
  }
  const deleteUbicacion = async (id: string) => {
    if (!confirm('¿Eliminar esta ubicación?')) return
    const { error } = await supabase.from('ubicaciones').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminada'); qc.invalidateQueries({ queryKey: ['ubicaciones'] }) }
  }

  // Estados de inventario
  const { data: estados = [], isLoading: loadingEstados } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).order('nombre'); return (data ?? []) as Item[] },
    enabled: !!tenant,
  })
  const addEstado = async (nombre: string, color?: string) => {
    const { error } = await supabase.from('estados_inventario').insert({ tenant_id: tenant!.id, nombre, color: color ?? '#22c55e' })
    if (error) toast.error(error.message); else { toast.success('Estado agregado'); qc.invalidateQueries({ queryKey: ['estados_inventario'] }) }
  }
  const updateEstado = async (id: string, nombre: string, color?: string) => {
    const { error } = await supabase.from('estados_inventario').update({ nombre, color }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['estados_inventario'] }) }
  }
  const deleteEstado = async (id: string) => {
    if (!confirm('¿Eliminar este estado?')) return
    const { error } = await supabase.from('estados_inventario').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['estados_inventario'] }) }
  }

  // Motivos
  const { data: motivos = [], isLoading: loadingMotivos } = useQuery({
    queryKey: ['motivos', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('motivos_movimiento').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const addMotivo = async (nombre: string, tipo?: string) => {
    const { error } = await supabase.from('motivos_movimiento').insert({ tenant_id: tenant!.id, nombre, tipo: tipo || 'ambos' })
    if (error) toast.error(error.message); else { toast.success('Motivo agregado'); qc.invalidateQueries({ queryKey: ['motivos'] }) }
  }
  const updateMotivo = async (id: string, nombre: string, tipo?: string) => {
    const { error } = await supabase.from('motivos_movimiento').update({ nombre, tipo: tipo || 'ambos' }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['motivos'] }) }
  }
  const deleteMotivo = async (id: string) => {
    if (!confirm('¿Eliminar este motivo?')) return
    const { error } = await supabase.from('motivos_movimiento').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['motivos'] }) }
  }

  // Combos
  const [comboForm, setComboForm] = useState({ nombre: '', producto_id: '', cantidad: '2', descuento_pct: '0' })
  const [savingCombo, setSavingCombo] = useState(false)

  const { data: productosAll = [] } = useQuery({
    queryKey: ['productos-all', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos').select('id, nombre, sku')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'combos',
  })

  const { data: combos = [], isLoading: loadingCombos } = useQuery({
    queryKey: ['combos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('combos')
        .select('*, productos(nombre, sku)')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'combos',
  })

  const addCombo = async () => {
    if (!comboForm.producto_id) { toast.error('Seleccioná un producto'); return }
    const cantidad = parseInt(comboForm.cantidad)
    if (!cantidad || cantidad < 2) { toast.error('La cantidad mínima es 2'); return }
    const descuento = parseFloat(comboForm.descuento_pct)
    if (isNaN(descuento) || descuento < 0 || descuento > 100) { toast.error('Descuento inválido'); return }
    if (!comboForm.nombre.trim()) { toast.error('Ingresá un nombre'); return }
    setSavingCombo(true)
    const { error } = await supabase.from('combos').insert({
      tenant_id: tenant!.id,
      nombre: comboForm.nombre.trim(),
      producto_id: comboForm.producto_id,
      cantidad,
      descuento_pct: descuento,
    })
    if (error) toast.error(error.message)
    else {
      toast.success('Combo creado')
      setComboForm({ nombre: '', producto_id: '', cantidad: '2', descuento_pct: '0' })
      qc.invalidateQueries({ queryKey: ['combos'] })
    }
    setSavingCombo(false)
  }

  const deleteCombo = async (id: string) => {
    if (!confirm('¿Eliminar este combo?')) return
    const { error } = await supabase.from('combos').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Combo eliminado'); qc.invalidateQueries({ queryKey: ['combos'] }) }
  }

  const tabs = [
    { id: 'negocio' as Tab, label: 'Mi negocio', icon: Building2 },
    { id: 'categorias' as Tab, label: 'Categorías', icon: Tag },
    { id: 'proveedores' as Tab, label: 'Proveedores', icon: Truck },
    { id: 'ubicaciones' as Tab, label: 'Ubicaciones', icon: MapPin },
    { id: 'estados' as Tab, label: 'Estados', icon: CircleDot },
    { id: 'motivos' as Tab, label: 'Motivos', icon: MessageSquare },
    { id: 'combos' as Tab, label: 'Combos', icon: Gift },
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Configuración</h1>
          <p className="text-gray-500 text-sm mt-0.5">Administrá los datos de tu negocio</p>
        </div>
        <Link to="/configuracion/importar"
          className="flex items-center gap-2 border border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-50 transition-all">
          <Upload size={15} /> Importar
        </Link>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-shrink-0 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all
              ${tab === id ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} /><span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'negocio' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
          <h2 className="font-semibold text-gray-700">Datos del negocio</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input type="text" value={bizForm.nombre} disabled={!canEdit}
              onChange={e => setBizForm(p => ({ ...p, nombre: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de comercio</label>
            <input type="text" value={bizForm.tipo_comercio} disabled={!canEdit}
              onChange={e => setBizForm(p => ({ ...p, tipo_comercio: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plan actual</label>
            <div className="px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-xl text-sm">
              <span className="font-medium text-primary capitalize">{tenant?.subscription_status}</span>
              {tenant?.subscription_status === 'trial' && (
                <span className="text-gray-500 ml-2">— vence {new Date(tenant.trial_ends_at).toLocaleDateString('es-AR')}</span>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex justify-end">
              <button onClick={handleSaveBiz} disabled={savingBiz}
                className="px-6 py-2.5 bg-primary hover:bg-accent text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                {savingBiz ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'categorias' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Tag size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700">Categorías de productos</h2>
            <span className="ml-auto text-xs text-gray-400">{categorias.length} cargadas</span>
          </div>
          <ListaABM items={categorias} loading={loadingCat} withDescription onAdd={addCategoria} onUpdate={updateCategoria} onDelete={deleteCategoria} />
        </div>
      )}

      {tab === 'proveedores' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Truck size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700">Proveedores</h2>
            <span className="ml-auto text-xs text-gray-400">{proveedores.length} cargados</span>
          </div>
          <ListaABM items={proveedores} loading={loadingProv} withDescription onAdd={addProveedor} onUpdate={updateProveedor} onDelete={deleteProveedor} />
        </div>
      )}

      {tab === 'ubicaciones' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <MapPin size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700">Ubicaciones</h2>
            <span className="ml-auto text-xs text-gray-400">{ubicaciones.length} cargadas</span>
          </div>
          <ListaABM items={ubicaciones} loading={loadingUbic} withDescription onAdd={addUbicacion} onUpdate={updateUbicacion} onDelete={deleteUbicacion} />
        </div>
      )}

      {tab === 'estados' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <CircleDot size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700">Estados de inventario</h2>
            <span className="ml-auto text-xs text-gray-400">{estados.length} cargados</span>
          </div>
          <p className="text-xs text-gray-400 mb-4">Definen la condición del producto: Disponible, Dañado, Reservado, En tránsito, etc.</p>
          <ListaABM items={estados} loading={loadingEstados} withColor onAdd={addEstado} onUpdate={updateEstado} onDelete={deleteEstado} />
        </div>
      )}

      {tab === 'motivos' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700">Motivos de movimiento</h2>
            <span className="ml-auto text-xs text-gray-400">{motivos.length} cargados</span>
          </div>
          <p className="text-xs text-gray-400 mb-4">Motivos predefinidos que aparecen al registrar ingresos y rebajes de stock.</p>
          <MotivosList motivos={motivos} loading={loadingMotivos} onAdd={addMotivo} onUpdate={updateMotivo} onDelete={deleteMotivo} />
        </div>
      )}

      {tab === 'combos' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-5">
          <div className="flex items-center gap-2">
            <Gift size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700">Combos de productos</h2>
            <span className="ml-auto text-xs text-gray-400">{combos.length} activos</span>
          </div>
          <p className="text-xs text-gray-400 -mt-2">
            Definí reglas de precio por volumen. Cuando se alcanza la cantidad en el carrito, aparece una sugerencia para aplicar el descuento.
          </p>

          {/* Formulario nuevo combo */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Nuevo combo</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <input type="text" value={comboForm.nombre} onChange={e => setComboForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Nombre del combo (ej: 3x Coca-Cola 10% off)"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
              <div className="col-span-2">
                <select value={comboForm.producto_id} onChange={e => setComboForm(p => ({ ...p, producto_id: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent">
                  <option value="">Seleccionar producto...</option>
                  {(productosAll as any[]).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cantidad mínima</label>
                <input type="number" min="2" value={comboForm.cantidad}
                  onChange={e => setComboForm(p => ({ ...p, cantidad: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descuento %</label>
                <input type="number" min="0" max="100" step="0.5" value={comboForm.descuento_pct}
                  onChange={e => setComboForm(p => ({ ...p, descuento_pct: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
            </div>
            <button onClick={addCombo} disabled={savingCombo}
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-accent text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
              <Plus size={15} /> {savingCombo ? 'Creando...' : 'Crear combo'}
            </button>
          </div>

          {/* Lista de combos */}
          {loadingCombos ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
          ) : combos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No hay combos definidos</p>
          ) : (
            <div className="space-y-2">
              {(combos as any[]).map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Gift size={15} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{c.nombre}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {c.productos?.nombre} · {c.cantidad} unidades · {c.descuento_pct}% off
                    </p>
                  </div>
                  <button onClick={() => deleteCombo(c.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
