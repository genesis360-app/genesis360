import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Tag, Truck, MapPin, Building2, CircleDot, MessageSquare, Search, Gift, Upload, Layers, Star, StarOff, ShoppingCart, Timer, ChevronDown, ChevronUp, ChevronRight, Play, RotateCcw, Ruler, Globe } from 'lucide-react'
import { TIPOS_COMERCIO } from '@/config/tiposComercio'
import { REGLAS_INVENTARIO } from '@/lib/rebajeSort'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'

type Tab = 'negocio' | 'categorias' | 'proveedores' | 'ubicaciones' | 'estados' | 'motivos' | 'combos' | 'grupos' | 'aging'
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
      <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-2">
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
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
          <button onClick={handleAdd} disabled={saving || !newNombre.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
            <Plus size={15} /> Agregar
          </button>
        </div>
        {withDescription && (
          <input type="text" value={newExtra} onChange={e => setNewExtra(e.target.value)}
            placeholder="Descripción (opcional)..."
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
        )}
      </div>

      {items.length > 4 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      ) : itemsFiltrados.length === 0 ? (
        <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-8">{items.length === 0 ? 'No hay elementos cargados aún' : 'Sin resultados para esa búsqueda'}</p>
      ) : (
        <div className="space-y-2">
          {itemsFiltrados.map(item => (
            <div key={item.id} className="bg-white dark:bg-gray-800 border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3">
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
                        className="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none" />
                    )}
                  </div>
                  <button onClick={() => handleUpdate(item.id)} disabled={saving}
                    className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:bg-green-900/20 rounded-lg transition-colors">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditId(null)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  {withColor && item.color && (
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{item.nombre}</p>
                    {(item.descripcion || item.contacto) && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.descripcion ?? item.contacto}</p>
                    )}
                  </div>
                  <button onClick={() => startEdit(item)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => onDelete(item.id)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg transition-colors">
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
  const [filterTipo, setFilterTipo] = useState<'todos' | 'ingreso' | 'rebaje' | 'ambos' | 'caja'>('todos')
  const [search, setSearch] = useState('')

  const TIPOS = [
    { value: 'ingreso', label: 'Solo ingreso' },
    { value: 'rebaje', label: 'Solo rebaje' },
    { value: 'ambos', label: 'Ambos' },
    { value: 'caja', label: 'Caja' },
  ]
  const tipoLabel = (tipo: string) => TIPOS.find(t => t.value === tipo)?.label ?? tipo
  const tipoColor = (tipo: string) =>
    tipo === 'ingreso' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
    tipo === 'rebaje'  ? 'bg-orange-100 text-orange-700' :
    tipo === 'caja'    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700' :
                         'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'

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
          className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
        <select value={newTipo} onChange={e => setNewTipo(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
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
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar motivo..."
            className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
        </div>
      )}

      {/* Filtro por tipo */}
      <div className="flex gap-1">
        {(['todos', 'ingreso', 'rebaje', 'ambos', 'caja'] as const).map(t => (
          <button key={t} onClick={() => setFilterTipo(t)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize
              ${filterTipo === t ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200'}`}>
            {t === 'todos' ? 'Todos' : t === 'ingreso' ? 'Solo ingreso' : t === 'rebaje' ? 'Solo rebaje' : t === 'caja' ? 'Caja' : 'Ambos'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
      ) : motivosFiltrados.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
          {motivos.length === 0 ? 'No hay motivos cargados' : 'Sin resultados'}
        </p>
      ) : (
        <div className="space-y-2">
          {motivosFiltrados.map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
              {editId === m.id ? (
                <>
                  <input type="text" value={editNombre} onChange={e => setEditNombre(e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
                  <select value={editTipo} onChange={e => setEditTipo(e.target.value)}
                    className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none">
                    {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <button onClick={async () => { setSaving(true); await onUpdate(m.id, editNombre, editTipo); setEditId(null); setSaving(false) }}
                    className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:bg-green-900/20 rounded-lg"><Check size={15} /></button>
                  <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={15} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-100">{m.nombre}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tipoColor(m.tipo)}`}>{tipoLabel(m.tipo)}</span>
                  <button onClick={() => { setEditId(m.id); setEditNombre(m.nombre); setEditTipo(m.tipo) }}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg"><Pencil size={15} /></button>
                  <button onClick={() => onDelete(m.id)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MarketplaceSection() {
  const { tenant, user, setTenant } = useAuthStore()
  const canEdit = user?.rol === 'OWNER'
  const [activo, setActivo] = useState(tenant?.marketplace_activo ?? false)
  const [webhookUrl, setWebhookUrl] = useState(tenant?.marketplace_webhook_url ?? '')
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState(!tenant?.marketplace_activo)

  const save = async () => {
    setSaving(true)
    const { data, error } = await supabase.from('tenants')
      .update({ marketplace_activo: activo, marketplace_webhook_url: webhookUrl.trim() || null })
      .eq('id', tenant!.id).select().single()
    if (error) toast.error(error.message)
    else { setTenant(data); toast.success('Marketplace actualizado') }
    setSaving(false)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <button onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-accent" />
          <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Marketplace</span>
          {activo && <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">Activo</span>}
        </div>
        {collapsed ? <ChevronDown size={16} className="text-gray-400 dark:text-gray-500" /> : <ChevronUp size={16} className="text-gray-400 dark:text-gray-500" />}
      </button>
      {!collapsed && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 dark:border-gray-700 pt-4">
          <p className="text-xs text-gray-400 dark:text-gray-500">Exponé tu catálogo a sistemas externos mediante la API pública del marketplace.</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Activar marketplace</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Habilita la API pública y la sección en cada producto</p>
            </div>
            <button
              disabled={!canEdit}
              onClick={() => setActivo(a => !a)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activo ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'} disabled:opacity-50`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {activo && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                URL de webhook externo <span className="text-gray-400 dark:text-gray-500 font-normal">(opcional)</span>
              </label>
              <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
                disabled={!canEdit}
                placeholder="https://mi-sistema.com/webhook/stock"
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Recibís una notificación POST cada vez que cambia el stock de un producto publicado.</p>
            </div>
          )}
          {activo && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Endpoint público de tu catálogo:</p>
              <p className="text-xs font-mono text-accent break-all">
                {import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketplace-api?tenant_id={tenant?.id}
              </p>
            </div>
          )}
          {canEdit && (
            <div className="flex justify-end">
              <button onClick={save} disabled={saving}
                className="px-5 py-2 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          )}
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

  const [bizForm, setBizForm] = useState({ nombre: tenant?.nombre ?? '' })
  const [savingBiz, setSavingBiz] = useState(false)

  // Tipo de comercio: select + campo libre si es 'Otro'
  const _currentTipo = tenant?.tipo_comercio ?? ''
  const _enLista = TIPOS_COMERCIO.includes(_currentTipo)
  const [bizTipoSelect, setBizTipoSelect] = useState(_enLista ? _currentTipo : (_currentTipo ? 'Otro' : ''))
  const [bizTipoPersonalizado, setBizTipoPersonalizado] = useState(_enLista ? '' : _currentTipo)
  const [bizRegla, setBizRegla] = useState(tenant?.regla_inventario ?? 'FIFO')
  const [bizTimeout, setBizTimeout] = useState<string>(
    tenant?.session_timeout_minutes != null ? String(tenant.session_timeout_minutes) : 'nunca'
  )

  const handleSaveBiz = async () => {
    setSavingBiz(true)
    const tipoFinal = bizTipoSelect === 'Otro' && bizTipoPersonalizado.trim()
      ? bizTipoPersonalizado.trim()
      : bizTipoSelect
    const sessionTimeoutMinutes = bizTimeout === 'nunca' ? null : parseInt(bizTimeout)
    const { data, error } = await supabase.from('tenants')
      .update({ nombre: bizForm.nombre, tipo_comercio: tipoFinal, regla_inventario: bizRegla, session_timeout_minutes: sessionTimeoutMinutes })
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
    if (error) toast.error(error.message); else { toast.success('Categoría agregada'); qc.invalidateQueries({ queryKey: ['categorias'] }); logActividad({ entidad: 'categoria', entidad_nombre: nombre, accion: 'crear', pagina: '/configuracion' }) }
  }
  const updateCategoria = async (id: string, nombre: string, descripcion?: string) => {
    const old = (categorias as Item[]).find(c => c.id === id)
    const { error } = await supabase.from('categorias').update({ nombre, descripcion }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizada'); qc.invalidateQueries({ queryKey: ['categorias'] }); logActividad({ entidad: 'categoria', entidad_id: id, entidad_nombre: nombre, accion: 'editar', campo: 'nombre', valor_anterior: old?.nombre ?? null, valor_nuevo: nombre, pagina: '/configuracion' }) }
  }
  const deleteCategoria = async (id: string) => {
    if (!confirm('¿Eliminar esta categoría?')) return
    const old = (categorias as Item[]).find(c => c.id === id)
    const { error } = await supabase.from('categorias').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminada'); qc.invalidateQueries({ queryKey: ['categorias'] }); logActividad({ entidad: 'categoria', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }

  // Proveedores
  const { data: proveedores = [], isLoading: loadingProv } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('proveedores').select('*').eq('tenant_id', tenant!.id).order('nombre'); return (data ?? []) as Item[] },
    enabled: !!tenant,
  })
  const addProveedor = async (nombre: string, contacto?: string) => {
    const { error } = await supabase.from('proveedores').insert({ tenant_id: tenant!.id, nombre, contacto })
    if (error) toast.error(error.message); else { toast.success('Proveedor agregado'); qc.invalidateQueries({ queryKey: ['proveedores'] }); logActividad({ entidad: 'proveedor', entidad_nombre: nombre, accion: 'crear', pagina: '/configuracion' }) }
  }
  const updateProveedor = async (id: string, nombre: string, contacto?: string) => {
    const old = (proveedores as Item[]).find(p => p.id === id)
    const { error } = await supabase.from('proveedores').update({ nombre, contacto }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['proveedores'] }); logActividad({ entidad: 'proveedor', entidad_id: id, entidad_nombre: nombre, accion: 'editar', campo: 'nombre', valor_anterior: old?.nombre ?? null, valor_nuevo: nombre, pagina: '/configuracion' }) }
  }
  const deleteProveedor = async (id: string) => {
    if (!confirm('¿Eliminar este proveedor?')) return
    const old = (proveedores as Item[]).find(p => p.id === id)
    const { error } = await supabase.from('proveedores').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['proveedores'] }); logActividad({ entidad: 'proveedor', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }

  // Ubicaciones
  const { data: ubicaciones = [], isLoading: loadingUbic } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).order('prioridad').order('nombre'); return (data ?? []) },
    enabled: !!tenant,
  })
  const [newUbicNombre, setNewUbicNombre] = useState('')
  const [newUbicDesc, setNewUbicDesc] = useState('')
  const [newUbicPrioridad, setNewUbicPrioridad] = useState('0')
  const [editUbicId, setEditUbicId] = useState<string | null>(null)
  const [editUbicNombre, setEditUbicNombre] = useState('')
  const [editUbicDesc, setEditUbicDesc] = useState('')
  const [editUbicPrioridad, setEditUbicPrioridad] = useState('0')
  const [editUbicTipo, setEditUbicTipo] = useState('')
  const [editUbicAlto, setEditUbicAlto] = useState('')
  const [editUbicAncho, setEditUbicAncho] = useState('')
  const [editUbicLargo, setEditUbicLargo] = useState('')
  const [editUbicPeso, setEditUbicPeso] = useState('')
  const [editUbicPallets, setEditUbicPallets] = useState('')
  const [editUbicWmsOpen, setEditUbicWmsOpen] = useState(false)
  const [ubicSearch, setUbicSearch] = useState('')

  const addUbicacion = async () => {
    if (!newUbicNombre.trim()) return
    const { error } = await supabase.from('ubicaciones').insert({ tenant_id: tenant!.id, nombre: newUbicNombre.trim(), descripcion: newUbicDesc || null, prioridad: parseInt(newUbicPrioridad) || 0 })
    if (error) { toast.error(error.message); return }
    toast.success('Ubicación agregada')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    logActividad({ entidad: 'ubicacion', entidad_nombre: newUbicNombre.trim(), accion: 'crear', pagina: '/configuracion' })
    setNewUbicNombre(''); setNewUbicDesc(''); setNewUbicPrioridad('0')
  }
  const startEditUbic = (u: any) => {
    setEditUbicId(u.id)
    setEditUbicNombre(u.nombre)
    setEditUbicDesc(u.descripcion ?? '')
    setEditUbicPrioridad(String(u.prioridad ?? 0))
    setEditUbicTipo(u.tipo_ubicacion ?? '')
    setEditUbicAlto(u.alto_cm != null ? String(u.alto_cm) : '')
    setEditUbicAncho(u.ancho_cm != null ? String(u.ancho_cm) : '')
    setEditUbicLargo(u.largo_cm != null ? String(u.largo_cm) : '')
    setEditUbicPeso(u.peso_max_kg != null ? String(u.peso_max_kg) : '')
    setEditUbicPallets(u.capacidad_pallets != null ? String(u.capacidad_pallets) : '')
    setEditUbicWmsOpen(!!(u.tipo_ubicacion || u.alto_cm || u.ancho_cm || u.largo_cm || u.peso_max_kg || u.capacidad_pallets))
  }
  const saveUbicacion = async (id: string) => {
    const old = (ubicaciones as any[]).find(u => u.id === id)
    const { error } = await supabase.from('ubicaciones').update({
      nombre: editUbicNombre.trim(),
      descripcion: editUbicDesc || null,
      prioridad: parseInt(editUbicPrioridad) || 0,
      tipo_ubicacion: editUbicTipo || null,
      alto_cm: editUbicAlto ? parseFloat(editUbicAlto) : null,
      ancho_cm: editUbicAncho ? parseFloat(editUbicAncho) : null,
      largo_cm: editUbicLargo ? parseFloat(editUbicLargo) : null,
      peso_max_kg: editUbicPeso ? parseFloat(editUbicPeso) : null,
      capacidad_pallets: editUbicPallets ? parseInt(editUbicPallets) : null,
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Actualizada')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    logActividad({ entidad: 'ubicacion', entidad_id: id, entidad_nombre: editUbicNombre, accion: 'editar', campo: 'nombre', valor_anterior: old?.nombre ?? null, valor_nuevo: editUbicNombre, pagina: '/configuracion' })
    setEditUbicId(null)
  }
  const deleteUbicacion = async (id: string) => {
    if (!confirm('¿Eliminar esta ubicación?')) return
    const old = (ubicaciones as any[]).find(u => u.id === id)
    const { error } = await supabase.from('ubicaciones').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminada'); qc.invalidateQueries({ queryKey: ['ubicaciones'] }); logActividad({ entidad: 'ubicacion', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }
  const toggleUbicSurtido = async (u: any) => {
    const nuevo = !u.disponible_surtido
    const { error } = await supabase.from('ubicaciones').update({ disponible_surtido: nuevo }).eq('id', u.id)
    if (error) { toast.error(error.message); return }
    toast.success(nuevo ? 'Disponible para surtido' : 'Excluida del surtido')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    logActividad({ entidad: 'ubicacion', entidad_id: u.id, entidad_nombre: u.nombre, accion: 'editar', campo: 'disponible_surtido', valor_anterior: String(u.disponible_surtido), valor_nuevo: String(nuevo), pagina: '/configuracion' })
  }
  const toggleUbicDevolucion = async (u: any) => {
    const nuevo = !u.es_devolucion
    const { error } = await supabase.from('ubicaciones').update({ es_devolucion: nuevo }).eq('id', u.id)
    if (error) { toast.error(error.message); return }
    toast.success(nuevo ? 'Marcada como ubicación de devolución' : 'Desmarcada como devolución')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
  }

  // Estados de inventario
  const { data: estados = [], isLoading: loadingEstados } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).order('nombre'); return (data ?? []) as Item[] },
    enabled: !!tenant,
  })
  const addEstado = async (nombre: string, color?: string) => {
    const { error } = await supabase.from('estados_inventario').insert({ tenant_id: tenant!.id, nombre, color: color ?? '#22c55e' })
    if (error) toast.error(error.message); else { toast.success('Estado agregado'); qc.invalidateQueries({ queryKey: ['estados_inventario'] }); logActividad({ entidad: 'estado', entidad_nombre: nombre, accion: 'crear', pagina: '/configuracion' }) }
  }
  const updateEstado = async (id: string, nombre: string, color?: string) => {
    const old = (estados as Item[]).find(e => e.id === id)
    const { error } = await supabase.from('estados_inventario').update({ nombre, color }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['estados_inventario'] }); logActividad({ entidad: 'estado', entidad_id: id, entidad_nombre: nombre, accion: 'editar', campo: 'nombre', valor_anterior: old?.nombre ?? null, valor_nuevo: nombre, pagina: '/configuracion' }) }
  }
  const deleteEstado = async (id: string) => {
    if (!confirm('¿Eliminar este estado?')) return
    const old = (estados as Item[]).find(e => e.id === id)
    const { error } = await supabase.from('estados_inventario').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['estados_inventario'] }); logActividad({ entidad: 'estado', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }
  const setEstadoDevolucion = async (estadoId: string) => {
    // Desmarcar todos primero, luego marcar el elegido
    const { error: e1 } = await supabase.from('estados_inventario').update({ es_devolucion: false }).eq('tenant_id', tenant!.id)
    if (e1) { toast.error(e1.message); return }
    if (estadoId) {
      const { error: e2 } = await supabase.from('estados_inventario').update({ es_devolucion: true }).eq('id', estadoId)
      if (e2) { toast.error(e2.message); return }
    }
    toast.success(estadoId ? 'Estado de devolución configurado' : 'Estado de devolución desasignado')
    qc.invalidateQueries({ queryKey: ['estados_inventario'] })
  }

  // Motivos
  const { data: motivos = [], isLoading: loadingMotivos } = useQuery({
    queryKey: ['motivos', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('motivos_movimiento').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const addMotivo = async (nombre: string, tipo?: string) => {
    const { error } = await supabase.from('motivos_movimiento').insert({ tenant_id: tenant!.id, nombre, tipo: tipo || 'ambos' })
    if (error) toast.error(error.message); else { toast.success('Motivo agregado'); qc.invalidateQueries({ queryKey: ['motivos'] }); logActividad({ entidad: 'motivo', entidad_nombre: nombre, accion: 'crear', pagina: '/configuracion' }) }
  }
  const updateMotivo = async (id: string, nombre: string, tipo?: string) => {
    const old = (motivos as any[]).find(m => m.id === id)
    const { error } = await supabase.from('motivos_movimiento').update({ nombre, tipo: tipo || 'ambos' }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['motivos'] }); logActividad({ entidad: 'motivo', entidad_id: id, entidad_nombre: nombre, accion: 'editar', campo: 'nombre', valor_anterior: old?.nombre ?? null, valor_nuevo: nombre, pagina: '/configuracion' }) }
  }
  const deleteMotivo = async (id: string) => {
    if (!confirm('¿Eliminar este motivo?')) return
    const old = (motivos as any[]).find(m => m.id === id)
    const { error } = await supabase.from('motivos_movimiento').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['motivos'] }); logActividad({ entidad: 'motivo', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }

  // Combos
  const [comboForm, setComboForm] = useState({ nombre: '', producto_id: '', cantidad: '2', descuento_tipo: 'pct', descuento_valor: '0' })
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
    if (!comboForm.nombre.trim()) { toast.error('Ingresá un nombre'); return }
    if (!comboForm.producto_id) { toast.error('Seleccioná un producto'); return }
    const cantidad = parseInt(comboForm.cantidad)
    if (!cantidad || cantidad < 2) { toast.error('La cantidad mínima es 2'); return }
    const valor = parseFloat(comboForm.descuento_valor)
    if (isNaN(valor) || valor < 0) { toast.error('Valor de descuento inválido'); return }
    if (comboForm.descuento_tipo === 'pct' && valor > 100) { toast.error('El porcentaje no puede superar 100'); return }
    const descuento_pct = comboForm.descuento_tipo === 'pct' ? valor : 0
    const descuento_monto = comboForm.descuento_tipo !== 'pct' ? valor : 0
    setSavingCombo(true)
    const { error } = await supabase.from('combos').insert({
      tenant_id: tenant!.id,
      nombre: comboForm.nombre.trim(),
      producto_id: comboForm.producto_id,
      cantidad,
      descuento_pct,
      descuento_tipo: comboForm.descuento_tipo,
      descuento_monto,
    })
    if (error) toast.error(error.message)
    else {
      toast.success('Combo creado')
      logActividad({ entidad: 'combo', entidad_nombre: comboForm.nombre.trim(), accion: 'crear', pagina: '/configuracion' })
      setComboForm({ nombre: '', producto_id: '', cantidad: '2', descuento_tipo: 'pct', descuento_valor: '0' })
      qc.invalidateQueries({ queryKey: ['combos'] })
    }
    setSavingCombo(false)
  }

  const deleteCombo = async (id: string) => {
    if (!confirm('¿Eliminar este combo?')) return
    const old = (combos as any[]).find(c => c.id === id)
    const { error } = await supabase.from('combos').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Combo eliminado'); qc.invalidateQueries({ queryKey: ['combos'] }); logActividad({ entidad: 'combo', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }

  // Grupos de estados
  interface GrupoItem { estado_id: string }
  interface Grupo { id: string; nombre: string; descripcion?: string; es_default: boolean; activo: boolean; grupo_estado_items: GrupoItem[] }
  interface EstadoSimple { id: string; nombre: string; color: string }

  const [grupoEditId, setGrupoEditId] = useState<string | null>(null)
  const [grupoShowForm, setGrupoShowForm] = useState(false)
  const [grupoForm, setGrupoForm] = useState({ nombre: '', descripcion: '', es_default: false, estadosIds: [] as string[] })

  const { data: grupos = [], isLoading: loadingGrupos } = useQuery({
    queryKey: ['grupos_estados', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('grupos_estados')
        .select('*, grupo_estado_items(estado_id)')
        .eq('tenant_id', tenant!.id)
        .order('es_default', { ascending: false }).order('nombre')
      if (error) throw error
      return (data ?? []) as Grupo[]
    },
    enabled: !!tenant && tab === 'grupos',
  })

  const resetGrupoForm = () => {
    setGrupoForm({ nombre: '', descripcion: '', es_default: false, estadosIds: [] })
    setGrupoEditId(null); setGrupoShowForm(false)
  }
  const startEditGrupo = (g: Grupo) => {
    setGrupoForm({ nombre: g.nombre, descripcion: g.descripcion ?? '', es_default: g.es_default, estadosIds: g.grupo_estado_items.map(i => i.estado_id) })
    setGrupoEditId(g.id); setGrupoShowForm(true)
  }
  const toggleGrupoEstado = (eid: string) =>
    setGrupoForm(p => ({ ...p, estadosIds: p.estadosIds.includes(eid) ? p.estadosIds.filter(id => id !== eid) : [...p.estadosIds, eid] }))

  const saveGrupo = useMutation({
    mutationFn: async () => {
      if (!grupoForm.nombre.trim()) throw new Error('El nombre es obligatorio')
      if (grupoForm.estadosIds.length === 0) throw new Error('Seleccioná al menos un estado')
      if (grupoForm.es_default) await supabase.from('grupos_estados').update({ es_default: false }).eq('tenant_id', tenant!.id)
      if (grupoEditId) {
        const { error } = await supabase.from('grupos_estados').update({ nombre: grupoForm.nombre.trim(), descripcion: grupoForm.descripcion || null, es_default: grupoForm.es_default }).eq('id', grupoEditId)
        if (error) throw error
        await supabase.from('grupo_estado_items').delete().eq('grupo_id', grupoEditId)
        await supabase.from('grupo_estado_items').insert(grupoForm.estadosIds.map(eid => ({ grupo_id: grupoEditId, estado_id: eid })))
      } else {
        const { data: g, error } = await supabase.from('grupos_estados').insert({ tenant_id: tenant!.id, nombre: grupoForm.nombre.trim(), descripcion: grupoForm.descripcion || null, es_default: grupoForm.es_default }).select().single()
        if (error) throw error
        await supabase.from('grupo_estado_items').insert(grupoForm.estadosIds.map(eid => ({ grupo_id: g.id, estado_id: eid })))
      }
    },
    onSuccess: () => { toast.success(grupoEditId ? 'Grupo actualizado' : 'Grupo creado'); qc.invalidateQueries({ queryKey: ['grupos_estados'] }); resetGrupoForm() },
    onError: (e: Error) => toast.error(e.message),
  })

  // Aging Profiles
  const { data: agingProfiles = [], isLoading: loadingAging } = useQuery({
    queryKey: ['aging_profiles', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('aging_profiles').select('*').eq('tenant_id', tenant!.id).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: agingReglas = [] } = useQuery({
    queryKey: ['aging_profile_reglas', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('aging_profile_reglas').select('*, estados_inventario(nombre,color)').eq('tenant_id', tenant!.id).order('dias'); return data ?? [] },
    enabled: !!tenant,
  })
  const [agingExpanded, setAgingExpanded] = useState<Set<string>>(new Set())
  const [newAgingNombre, setNewAgingNombre] = useState('')
  const [editAgingId, setEditAgingId] = useState<string | null>(null)
  const [editAgingNombre, setEditAgingNombre] = useState('')
  const [addRuleProfileId, setAddRuleProfileId] = useState<string | null>(null)
  const [addRuleEstadoId, setAddRuleEstadoId] = useState('')
  const [addRuleDias, setAddRuleDias] = useState('')
  const [processingAging, setProcessingAging] = useState(false)

  const toggleAgingExpand = (id: string) => setAgingExpanded(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const addAgingProfile = async () => {
    if (!newAgingNombre.trim()) return
    const { error } = await supabase.from('aging_profiles').insert({ tenant_id: tenant!.id, nombre: newAgingNombre.trim() })
    if (error) { toast.error(error.message); return }
    toast.success('Aging profile creado'); qc.invalidateQueries({ queryKey: ['aging_profiles'] }); setNewAgingNombre('')
  }
  const saveAgingProfile = async (id: string) => {
    if (!editAgingNombre.trim()) return
    const { error } = await supabase.from('aging_profiles').update({ nombre: editAgingNombre.trim() }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['aging_profiles'] }); setEditAgingId(null)
  }
  const deleteAgingProfile = async (id: string) => {
    if (!confirm('¿Eliminar este aging profile? También se eliminarán sus reglas.')) return
    const { error } = await supabase.from('aging_profiles').delete().eq('id', id)
    if (error) { toast.error('No se puede eliminar, tiene productos asociados'); return }
    toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['aging_profiles'] }); qc.invalidateQueries({ queryKey: ['aging_profile_reglas'] })
  }
  const addAgingRegla = async (profileId: string) => {
    if (!addRuleEstadoId || addRuleDias === '') return
    const { error } = await supabase.from('aging_profile_reglas').insert({ profile_id: profileId, tenant_id: tenant!.id, estado_id: addRuleEstadoId, dias: parseInt(addRuleDias) })
    if (error) { toast.error(error.message); return }
    toast.success('Regla agregada'); qc.invalidateQueries({ queryKey: ['aging_profile_reglas'] }); setAddRuleProfileId(null); setAddRuleEstadoId(''); setAddRuleDias('')
  }
  const deleteAgingRegla = async (id: string) => {
    const { error } = await supabase.from('aging_profile_reglas').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['aging_profile_reglas'] })
  }
  const processAging = async () => {
    setProcessingAging(true)
    try {
      const { data, error } = await supabase.rpc('process_aging_profiles')
      if (error) throw error
      const cambios = (data as any)?.cambios ?? 0
      toast.success(cambios > 0 ? `${cambios} estado${cambios !== 1 ? 's' : ''} actualizado${cambios !== 1 ? 's' : ''} automáticamente` : 'Sin cambios pendientes')
    } catch (e: any) {
      toast.error(e.message ?? 'Error al procesar aging')
    } finally {
      setProcessingAging(false)
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
    }
  }

  const setGrupoDefault = useMutation({
    mutationFn: async (gid: string) => {
      await supabase.from('grupos_estados').update({ es_default: false }).eq('tenant_id', tenant!.id)
      await supabase.from('grupos_estados').update({ es_default: true }).eq('id', gid)
    },
    onSuccess: () => { toast.success('Grupo default actualizado'); qc.invalidateQueries({ queryKey: ['grupos_estados'] }) },
  })

  const deleteGrupo = useMutation({
    mutationFn: async (gid: string) => {
      const { error } = await supabase.from('grupos_estados').delete().eq('id', gid)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Grupo eliminado'); qc.invalidateQueries({ queryKey: ['grupos_estados'] }) },
    onError: () => toast.error('Error al eliminar'),
  })

  const tabs = [
    { id: 'negocio' as Tab, label: 'Mi negocio', icon: Building2 },
    { id: 'categorias' as Tab, label: 'Categorías', icon: Tag },
    { id: 'proveedores' as Tab, label: 'Proveedores', icon: Truck },
    { id: 'ubicaciones' as Tab, label: 'Ubicaciones', icon: MapPin },
    { id: 'estados' as Tab, label: 'Estados', icon: CircleDot },
    { id: 'motivos' as Tab, label: 'Motivos', icon: MessageSquare },
    { id: 'combos' as Tab, label: 'Combos', icon: Gift },
    { id: 'grupos' as Tab, label: 'Grupos de estados', icon: Layers },
    { id: 'aging' as Tab, label: 'Aging Profiles', icon: Timer },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Configuración</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Administrá los datos de tu negocio</p>
        </div>
        <Link to="/configuracion/importar"
          className="flex items-center gap-2 border border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all">
          <Upload size={15} /> Importar
        </Link>
      </div>

      <div className="flex gap-6 items-start">
        {/* Sidebar nav — desktop only */}
        <nav className="hidden lg:flex flex-col w-44 flex-shrink-0 bg-white dark:bg-gray-800 rounded-xl p-2 shadow-sm border border-gray-100 sticky top-4">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left
                ${tab === id ? 'bg-accent/10 text-accent' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'}`}>
              <Icon size={15} className="flex-shrink-0" />{label}
            </button>
          ))}
        </nav>

        {/* Content column */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Horizontal tabs — mobile only */}
          <div className="lg:hidden flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl overflow-x-auto">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-shrink-0 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all
                  ${tab === id ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300'}`}>
                <Icon size={15} /><span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

      {tab === 'negocio' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Datos del negocio</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre</label>
            <input type="text" value={bizForm.nombre} disabled={!canEdit}
              onChange={e => setBizForm(p => ({ ...p, nombre: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de comercio</label>
            <select value={bizTipoSelect} disabled={!canEdit}
              onChange={e => setBizTipoSelect(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
              <option value="">Seleccioná...</option>
              {TIPOS_COMERCIO.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {bizTipoSelect === 'Otro' && canEdit && (
              <input type="text" value={bizTipoPersonalizado}
                onChange={e => setBizTipoPersonalizado(e.target.value)}
                placeholder="Describí tu tipo de comercio"
                className="mt-2 w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
            )}
            {bizTipoSelect === 'Otro' && !canEdit && bizTipoPersonalizado && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 px-1">{bizTipoPersonalizado}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Regla de inventario</label>
            <select value={bizRegla} disabled={!canEdit}
              onChange={e => setBizRegla(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
              {REGLAS_INVENTARIO.map(r => (
                <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Define cómo se selecciona el stock al rebajar. Se puede sobreescribir por producto.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cierre de sesión por inactividad</label>
            <select value={bizTimeout} disabled={!canEdit}
              onChange={e => setBizTimeout(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
              <option value="nunca">Nunca</option>
              <option value="5">5 minutos</option>
              <option value="15">15 minutos</option>
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si el usuario no tiene actividad por este tiempo, la sesión se cierra automáticamente.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plan actual</label>
            <div className="px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 rounded-xl text-sm">
              <span className="font-medium text-primary capitalize">{tenant?.subscription_status}</span>
              {tenant?.subscription_status === 'trial' && (
                <span className="text-gray-500 dark:text-gray-400 ml-2">— vence {new Date(tenant.trial_ends_at).toLocaleDateString('es-AR')}</span>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex justify-end">
              <button onClick={handleSaveBiz} disabled={savingBiz}
                className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                {savingBiz ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'negocio' && (
        <MarketplaceSection />
      )}

      {tab === 'categorias' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Tag size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Categorías de productos</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{categorias.length} cargadas</span>
          </div>
          <ListaABM items={categorias} loading={loadingCat} withDescription onAdd={addCategoria} onUpdate={updateCategoria} onDelete={deleteCategoria} />
        </div>
      )}

      {tab === 'proveedores' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Truck size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Proveedores</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{proveedores.length} cargados</span>
          </div>
          <ListaABM items={proveedores} loading={loadingProv} withDescription onAdd={addProveedor} onUpdate={updateProveedor} onDelete={deleteProveedor} />
        </div>
      )}

      {tab === 'ubicaciones' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Ubicaciones</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{ubicaciones.length} cargadas</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">La prioridad define el orden de rebaje: menor número = se descuenta primero. <ShoppingCart size={11} className="inline" /> = elegible para surtir ventas. <RotateCcw size={11} className="inline text-orange-500" /> = destino de stock devuelto (solo una). Cada ubicación puede tener dimensiones y tipo WMS opcionales (editando con <Pencil size={11} className="inline" />).</p>

          {/* Agregar nueva */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2">
            <div className="flex gap-2">
              <input type="text" placeholder="Nombre de la ubicación" value={newUbicNombre}
                onChange={e => setNewUbicNombre(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addUbicacion()}
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Prioridad" value={newUbicPrioridad}
                onChange={e => setNewUbicPrioridad(e.target.value)}
                className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              <button onClick={addUbicacion} disabled={!newUbicNombre.trim()}
                className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                <Plus size={15} /> Agregar
              </button>
            </div>
            <input type="text" placeholder="Descripción (opcional)" value={newUbicDesc}
              onChange={e => setNewUbicDesc(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
          </div>

          {/* Buscador */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Buscar ubicación..." value={ubicSearch}
              onChange={e => setUbicSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
          </div>

          {/* Lista */}
          {loadingUbic ? <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Cargando...</p> : (
            <div className="space-y-2">
              {(ubicaciones as any[])
                .filter(u => !ubicSearch.trim() || u.nombre.toLowerCase().includes(ubicSearch.toLowerCase()))
                .map((u: any) => (
                  <div key={u.id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2.5">
                    {editUbicId === u.id ? (
                      <div className="flex-1 space-y-2">
                        {/* Fila principal */}
                        <div className="flex gap-2 items-center">
                          <input type="text" value={editUbicNombre} onChange={e => setEditUbicNombre(e.target.value)}
                            className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                          <input type="text" value={editUbicDesc} onChange={e => setEditUbicDesc(e.target.value)}
                            placeholder="Descripción" className="w-32 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={editUbicPrioridad} onChange={e => setEditUbicPrioridad(e.target.value)}
                            className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm text-center focus:outline-none focus:border-accent" title="Prioridad" />
                          <button onClick={() => saveUbicacion(u.id)} className="text-green-600 dark:text-green-400 hover:text-green-700 p-1"><Check size={15} /></button>
                          <button onClick={() => setEditUbicId(null)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 p-1"><X size={15} /></button>
                        </div>
                        {/* Dimensiones WMS (colapsable) */}
                        <button
                          type="button"
                          onClick={() => setEditUbicWmsOpen(v => !v)}
                          className="flex items-center gap-1 text-xs text-purple-500 dark:text-purple-400 hover:text-purple-700">
                          <Ruler size={11} />
                          <span>Dimensiones WMS (opcional)</span>
                          <ChevronRight size={11} className={`transition-transform ${editUbicWmsOpen ? 'rotate-90' : ''}`} />
                        </button>
                        {editUbicWmsOpen && (
                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <select value={editUbicTipo} onChange={e => setEditUbicTipo(e.target.value)}
                              className="col-span-3 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                              <option value="">Tipo de ubicación (opcional)</option>
                              <option value="picking">Picking</option>
                              <option value="bulk">Bulk / Reserva</option>
                              <option value="estiba">Estiba / Pallet rack</option>
                              <option value="camara">Cámara frigorífica</option>
                              <option value="cross_dock">Cross-dock</option>
                            </select>
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Alto (cm)" value={editUbicAlto} onChange={e => setEditUbicAlto(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Ancho (cm)" value={editUbicAncho} onChange={e => setEditUbicAncho(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Largo (cm)" value={editUbicLargo} onChange={e => setEditUbicLargo(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Peso máx (kg)" value={editUbicPeso} onChange={e => setEditUbicPeso(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Cap. pallets" value={editUbicPallets} onChange={e => setEditUbicPallets(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium ${u.disponible_surtido ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{u.nombre}</span>
                          {u.descripcion && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{u.descripcion}</span>}
                          {!u.disponible_surtido && <span className="ml-2 text-xs text-red-400">No disponible para surtido</span>}
                          {u.tipo_ubicacion && (
                            <span className="ml-2 text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded font-mono">{u.tipo_ubicacion}</span>
                          )}
                          {(u.alto_cm || u.ancho_cm || u.largo_cm) && (
                            <span className="ml-1 text-xs text-gray-400 dark:text-gray-500" title="Dimensiones alto × ancho × largo">
                              <Ruler size={10} className="inline mb-0.5" /> {[u.alto_cm, u.ancho_cm, u.largo_cm].filter(Boolean).join('×')} cm
                            </span>
                          )}
                        </div>
                        {(u.prioridad ?? 0) > 0 && (
                          <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded font-mono" title="Prioridad de rebaje">P{u.prioridad}</span>
                        )}
                        <button
                          onClick={() => toggleUbicSurtido(u)}
                          title={u.disponible_surtido ? 'Habilitada para surtido — click para deshabilitar' : 'Excluida del surtido — click para habilitar'}
                          className={`p-1 transition-colors ${u.disponible_surtido ? 'text-green-500 hover:text-gray-400 dark:text-gray-500' : 'text-gray-300 hover:text-green-500'}`}>
                          <ShoppingCart size={14} />
                        </button>
                        <button
                          onClick={() => toggleUbicDevolucion(u)}
                          title={u.es_devolucion ? 'Ubicación de devolución activa — click para desmarcar' : 'Marcar como ubicación para devoluciones'}
                          className={`p-1 transition-colors ${u.es_devolucion ? 'text-orange-500 hover:text-gray-400' : 'text-gray-300 hover:text-orange-500'}`}>
                          <RotateCcw size={14} />
                        </button>
                        <button onClick={() => startEditUbic(u)} className="text-gray-400 dark:text-gray-500 hover:text-accent p-1"><Pencil size={14} /></button>
                        <button onClick={() => deleteUbicacion(u.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                ))}
              {ubicaciones.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay ubicaciones cargadas.</p>}
            </div>
          )}
        </div>
      )}

      {tab === 'estados' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CircleDot size={18} className="text-accent" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Estados de inventario</h2>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{estados.length} cargados</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Definen la condición del producto: Disponible, Dañado, Reservado, En tránsito, etc.</p>
            <ListaABM items={estados} loading={loadingEstados} withColor onAdd={addEstado} onUpdate={updateEstado} onDelete={deleteEstado} />
          </div>

          {/* Estado para devoluciones */}
          {estados.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw size={15} className="text-orange-500" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Estado para ítems devueltos</p>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">El stock devuelto ingresará con este estado. Solo uno puede estar activo.</p>
              <select
                value={(estados as any[]).find(e => e.es_devolucion)?.id ?? ''}
                onChange={e => setEstadoDevolucion(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                <option value="">Sin configurar</option>
                {(estados as any[]).map((e: any) => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {tab === 'motivos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Motivos de movimiento</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{motivos.length} cargados</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Motivos predefinidos que aparecen al registrar ingresos y rebajes de stock.</p>
          <MotivosList motivos={motivos} loading={loadingMotivos} onAdd={addMotivo} onUpdate={updateMotivo} onDelete={deleteMotivo} />
        </div>
      )}

      {tab === 'combos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-5">
          <div className="flex items-center gap-2">
            <Gift size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Combos de productos</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{combos.length} activos</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">
            Definí reglas de precio por volumen. Cuando se alcanza la cantidad en el carrito, aparece una sugerencia para aplicar el descuento.
          </p>

          {/* Formulario nuevo combo */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Nuevo combo</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <input type="text" value={comboForm.nombre} onChange={e => setComboForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Nombre del combo (ej: 3x Coca-Cola 10% off)"
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
              <div className="col-span-2">
                <select value={comboForm.producto_id} onChange={e => setComboForm(p => ({ ...p, producto_id: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                  <option value="">Seleccionar producto...</option>
                  {(productosAll as any[]).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cantidad mínima</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} min="2" value={comboForm.cantidad}
                  onChange={e => setComboForm(p => ({ ...p, cantidad: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo de descuento</label>
                <select value={comboForm.descuento_tipo} onChange={e => setComboForm(p => ({ ...p, descuento_tipo: e.target.value, descuento_valor: '0' }))}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                  <option value="pct">Porcentaje (%)</option>
                  <option value="monto_ars">Monto fijo ($)</option>
                  <option value="monto_usd">Monto fijo (USD)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {comboForm.descuento_tipo === 'pct' ? 'Descuento (%)' : comboForm.descuento_tipo === 'monto_usd' ? 'Descuento (USD)' : 'Descuento ($)'}
                </label>
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max={comboForm.descuento_tipo === 'pct' ? '100' : undefined} step={comboForm.descuento_tipo === 'pct' ? '0.5' : '1'}
                  value={comboForm.descuento_valor}
                  onChange={e => setComboForm(p => ({ ...p, descuento_valor: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
            </div>
            <button onClick={addCombo} disabled={savingCombo}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
              <Plus size={15} /> {savingCombo ? 'Creando...' : 'Crear combo'}
            </button>
          </div>

          {/* Lista de combos */}
          {loadingCombos ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
          ) : combos.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay combos definidos</p>
          ) : (
            <div className="space-y-2">
              {(combos as any[]).map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                  <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Gift size={15} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.nombre}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {c.productos?.nombre} · {c.cantidad} uds ·{' '}
                      {(c.descuento_tipo ?? 'pct') === 'pct'
                        ? `${c.descuento_pct}% off`
                        : (c.descuento_tipo === 'monto_usd'
                          ? `USD ${c.descuento_monto} off`
                          : `$${c.descuento_monto} off`)}
                    </p>
                  </div>
                  <button onClick={() => deleteCombo(c.id)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'grupos' && (
        <div className="space-y-4">
          {(estados as EstadoSimple[]).length === 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              ⚠️ Primero creá estados en la pestaña <strong>Estados</strong> para poder armar grupos.
            </div>
          )}

          {!grupoShowForm && (
            <div className="flex justify-end">
              <button onClick={() => setGrupoShowForm(true)}
                className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
                <Plus size={16} /> Nuevo grupo
              </button>
            </div>
          )}

          {grupoShowForm && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-accent/30 space-y-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">{grupoEditId ? 'Editar grupo' : 'Nuevo grupo'}</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre *</label>
                  <input type="text" value={grupoForm.nombre} onChange={e => setGrupoForm(p => ({ ...p, nombre: e.target.value }))}
                    placeholder="Ej: Disponible para venta"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción (opcional)</label>
                  <input type="text" value={grupoForm.descripcion} onChange={e => setGrupoForm(p => ({ ...p, descripcion: e.target.value }))}
                    placeholder="Ej: Estados vendibles"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Estados incluidos *
                  <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">({grupoForm.estadosIds.length} seleccionado{grupoForm.estadosIds.length !== 1 ? 's' : ''})</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(estados as EstadoSimple[]).map(e => {
                    const selected = grupoForm.estadosIds.includes(e.id)
                    return (
                      <button key={e.id} type="button" onClick={() => toggleGrupoEstado(e.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all
                          ${selected ? 'border-accent bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:border-gray-600'}`}>
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                        <span className="truncate">{e.nombre}</span>
                        {selected && <Check size={13} className="text-accent ml-auto flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl">
                <div className="relative">
                  <input type="checkbox" checked={grupoForm.es_default} onChange={e => setGrupoForm(p => ({ ...p, es_default: e.target.checked }))} className="sr-only" />
                  <div className={`w-10 h-5 rounded-full transition-colors ${grupoForm.es_default ? 'bg-amber-50 dark:bg-amber-900/200' : 'bg-gray-300'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white dark:bg-gray-800 rounded-full shadow transition-transform ${grupoForm.es_default ? 'translate-x-5' : ''}`} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Filtro por defecto</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">Aparecerá preseleccionado en Rebaje y Ventas</p>
                </div>
              </label>
              <div className="flex gap-3 justify-end">
                <button onClick={resetGrupoForm} className="px-5 py-2.5 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold rounded-xl hover:border-gray-300 dark:border-gray-600 text-sm">Cancelar</button>
                <button onClick={() => saveGrupo.mutate()} disabled={saveGrupo.isPending}
                  className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50">
                  {saveGrupo.isPending ? 'Guardando...' : grupoEditId ? 'Guardar cambios' : 'Crear grupo'}
                </button>
              </div>
            </div>
          )}

          {loadingGrupos ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
          ) : grupos.length === 0 && !grupoShowForm ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-10 shadow-sm border border-gray-100 text-center text-gray-400 dark:text-gray-500">
              <Layers size={36} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay grupos creados</p>
              <p className="text-sm mt-1">Creá un grupo para usarlo como filtro rápido en Rebaje y Ventas</p>
            </div>
          ) : (
            <div className="space-y-3">
              {grupos.map(grupo => {
                const estadosGrupo = grupo.grupo_estado_items
                  .map(i => (estados as EstadoSimple[]).find(e => e.id === i.estado_id))
                  .filter(Boolean) as EstadoSimple[]
                return (
                  <div key={grupo.id} className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border transition-all ${grupo.es_default ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20/30' : 'border-gray-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{grupo.nombre}</h3>
                          {grupo.es_default && <span className="flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium"><Star size={10} /> Default</span>}
                        </div>
                        {grupo.descripcion && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{grupo.descripcion}</p>}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {estadosGrupo.length === 0
                            ? <span className="text-xs text-gray-400 dark:text-gray-500 italic">Sin estados asignados</span>
                            : estadosGrupo.map(e => (
                              <span key={e.id} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: e.color }}>{e.nombre}</span>
                            ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!grupo.es_default && (
                          <button onClick={() => setGrupoDefault.mutate(grupo.id)} title="Marcar como default" className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-amber-500 hover:bg-amber-50 dark:bg-amber-900/20 rounded-lg transition-colors"><StarOff size={15} /></button>
                        )}
                        <button onClick={() => startEditGrupo(grupo)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"><Pencil size={15} /></button>
                        <button onClick={() => { if (confirm('¿Eliminar este grupo?')) deleteGrupo.mutate(grupo.id) }} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg transition-colors"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'aging' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Timer size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Aging Profiles</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{agingProfiles.length} perfiles</span>
            <button onClick={processAging} disabled={processingAging}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs font-medium rounded-lg transition-all disabled:opacity-50">
              <Play size={12} /> {processingAging ? 'Procesando...' : 'Procesar aging ahora'}
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Define reglas automáticas de cambio de estado según los días restantes hasta vencimiento.
            La regla con el menor umbral que cubra los días restantes es la que se aplica.
            Ej: con DISPONIBLE/365, PRÓX. VENCER/90, VENCIDO/0 → ítem con 50 días → "PRÓX. VENCER".
          </p>

          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4">
            <div className="flex gap-2">
              <input type="text" value={newAgingNombre} onChange={e => setNewAgingNombre(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addAgingProfile()}
                placeholder="Nombre del aging profile (ej: DISP-365)"
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              <button onClick={addAgingProfile} disabled={!newAgingNombre.trim()}
                className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                <Plus size={15} /> Agregar
              </button>
            </div>
          </div>

          {loadingAging ? <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Cargando...</p> : (
            <div className="space-y-3">
              {agingProfiles.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay aging profiles. Creá uno para empezar.</p>
              )}
              {(agingProfiles as any[]).map((ap: any) => {
                const reglas = (agingReglas as any[]).filter((r: any) => r.profile_id === ap.id).sort((a: any, b: any) => b.dias - a.dias)
                const expanded = agingExpanded.has(ap.id)
                return (
                  <div key={ap.id} className="border border-gray-100 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-700 cursor-pointer select-none"
                      onClick={() => { if (editAgingId !== ap.id) toggleAgingExpand(ap.id) }}>
                      <span className="text-gray-400 dark:text-gray-500">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                      {editAgingId === ap.id ? (
                        <>
                          <input type="text" value={editAgingNombre} onChange={e => setEditAgingNombre(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                          <button onClick={e => { e.stopPropagation(); saveAgingProfile(ap.id) }} className="text-green-600 dark:text-green-400 hover:text-green-700 dark:text-green-400 p-1"><Check size={14} /></button>
                          <button onClick={e => { e.stopPropagation(); setEditAgingId(null) }} className="text-gray-400 dark:text-gray-500 p-1"><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{ap.nombre}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">{reglas.length} regla{reglas.length !== 1 ? 's' : ''}</span>
                          <button onClick={e => { e.stopPropagation(); setEditAgingId(ap.id); setEditAgingNombre(ap.nombre) }} className="text-gray-400 dark:text-gray-500 hover:text-accent p-1"><Pencil size={13} /></button>
                          <button onClick={e => { e.stopPropagation(); deleteAgingProfile(ap.id) }} className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>

                    {expanded && (
                      <div className="p-4 space-y-3">
                        {reglas.length === 0 && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Sin reglas. Agregá al menos una para activar el aging.</p>
                        )}
                        {reglas.length > 0 && (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100">
                                <th className="text-left pb-2 font-medium">Estado de inventario</th>
                                <th className="text-center pb-2 font-medium w-36">Días hasta vencimiento ≤</th>
                                <th className="w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {reglas.map((r: any) => (
                                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                                  <td className="py-2 pr-4">
                                    <span className="inline-flex items-center gap-1.5">
                                      {r.estados_inventario?.color && (
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.estados_inventario.color }} />
                                      )}
                                      <span className="text-gray-700 dark:text-gray-300">{r.estados_inventario?.nombre ?? '—'}</span>
                                    </span>
                                  </td>
                                  <td className="py-2 text-center font-mono text-gray-600 dark:text-gray-400">{r.dias}</td>
                                  <td className="py-2 text-right">
                                    <button onClick={() => deleteAgingRegla(r.id)} className="text-gray-300 hover:text-red-500 p-1 transition-colors"><Trash2 size={13} /></button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {addRuleProfileId === ap.id ? (
                          <div className="flex gap-2 mt-1 items-center">
                            <select value={addRuleEstadoId} onChange={e => setAddRuleEstadoId(e.target.value)}
                              className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                              <option value="">— Estado —</option>
                              {(estados as any[]).map((e: any) => (
                                <option key={e.id} value={e.id}>{e.nombre}</option>
                              ))}
                            </select>
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={addRuleDias} onChange={e => setAddRuleDias(e.target.value)}
                              placeholder="Días" className="w-24 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center focus:outline-none focus:border-accent" />
                            <button onClick={() => addAgingRegla(ap.id)} disabled={!addRuleEstadoId || addRuleDias === ''}
                              className="p-1.5 bg-accent text-white rounded-lg disabled:opacity-40"><Check size={14} /></button>
                            <button onClick={() => { setAddRuleProfileId(null); setAddRuleEstadoId(''); setAddRuleDias('') }}
                              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 rounded-lg"><X size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={() => { setAddRuleProfileId(ap.id); setAddRuleEstadoId(''); setAddRuleDias('') }}
                            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 font-medium mt-1">
                            <Plus size={13} /> Agregar regla
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
        </div>{/* end content column */}
      </div>{/* end flex gap-6 */}
    </div>
  )
}
