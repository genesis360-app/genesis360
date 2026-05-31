import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Tag, MapPin, Building2, CircleDot, MessageSquare, Search, Gift, Upload, Layers, Star, StarOff, ShoppingCart, Timer, ChevronDown, ChevronUp, ChevronRight, Play, RotateCcw, Ruler, Globe, ShieldCheck, KeyRound, CreditCard, Plug, Store, Wallet, AlertCircle, CheckCircle2, ExternalLink, Unplug, Receipt, Eye, Hash, Key, Copy, RefreshCw, Package, Truck, Users, Bell, UserCog, Navigation, Clock, TrendingDown, ToggleLeft, ToggleRight, DollarSign, Lock, ScanBarcode } from 'lucide-react'
import { MONEDAS_DISPONIBLES } from '@/lib/formato'
import { TIPOS_COMERCIO } from '@/config/tiposComercio'
import { REGLAS_INVENTARIO } from '@/lib/rebajeSort'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { uploadCertificates } from '@/lib/afip'
import type { TenantCertificate } from '@/lib/supabase'
import { CodigoPerfilesPanel } from '@/components/CodigoPerfilesPanel'
import toast from 'react-hot-toast'

type Tab = 'negocio' | 'ventas' | 'caja' | 'clientes' | 'inventario' | 'envios' | 'gastos' | 'facturacion' | 'rrhh' | 'alertas' | 'notificaciones' | 'conectividad'
type VentasSubTab = 'metodos' | 'descuentos' | 'operativa'
type InvSubTab = 'reglas' | 'categorias' | 'ubicaciones' | 'estados' | 'motivos' | 'unidades' | 'codigos'
type ConSubTab = 'integraciones' | 'api'
type EstadosSubTab = 'estados' | 'grupos' | 'progresion'
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
                  {m.es_sistema
                    ? <span className="text-xs text-gray-400 dark:text-gray-500 px-2 py-0.5 bg-gray-100 dark:bg-gray-600 rounded-full">sistema</span>
                    : <>
                        <button onClick={() => { setEditId(m.id); setEditNombre(m.nombre); setEditTipo(m.tipo) }}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg"><Pencil size={15} /></button>
                        <button onClick={() => onDelete(m.id)}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg"><Trash2 size={15} /></button>
                      </>
                  }
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
  const canEdit = user?.rol === 'DUEÑO'
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
  const searchParams = new URLSearchParams(window.location.search)
  const initialTab = searchParams.get('tab') as Tab | null
  const VALID_TABS: Tab[] = ['negocio','ventas','caja','clientes','inventario','envios','gastos','facturacion','rrhh','alertas','notificaciones','conectividad']
  const [tab, setTab] = useState<Tab>(VALID_TABS.includes(initialTab as Tab) ? initialTab as Tab : 'negocio')
  const [estadosSubTab, setEstadosSubTab] = useState<EstadosSubTab>('estados')
  const [ventasSubTab, setVentasSubTab] = useState<VentasSubTab>('metodos')
  const [invSubTab, setInvSubTab] = useState<InvSubTab>('reglas')
  const [conSubTab, setConSubTab] = useState<ConSubTab>('integraciones')
  const { tenant, user, setTenant, sucursales, sucursalId } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = user?.rol === 'DUEÑO'

  // Mostrar resultado de OAuth al volver del redirect
  useState(() => {
    if (searchParams.get('tn') === 'ok') toast.success('TiendaNube conectada correctamente')
    if (searchParams.get('mp') === 'ok') toast.success('MercadoPago conectado correctamente')
    if (searchParams.get('meli') === 'ok') toast.success('MercadoLibre conectado correctamente')
    const err = searchParams.get('error')
    if (err) toast.error(decodeURIComponent(err))
    // Limpiar params de la URL sin recargar
    if (searchParams.has('tn') || searchParams.has('mp') || searchParams.has('meli') || searchParams.has('error')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  })

  const [bizForm, setBizForm] = useState({ nombre: tenant?.nombre ?? '' })
  const [savingBiz, setSavingBiz] = useState(false)

  // Tipo de comercio: select + campo libre si es 'Otro'
  const _currentTipo = tenant?.tipo_comercio ?? ''
  const _enLista = TIPOS_COMERCIO.includes(_currentTipo)
  const [bizTipoSelect, setBizTipoSelect] = useState(_enLista ? _currentTipo : (_currentTipo ? 'Otro' : ''))
  const [bizTipoPersonalizado, setBizTipoPersonalizado] = useState(_enLista ? '' : _currentTipo)
  const [bizRegla, setBizRegla] = useState(tenant?.regla_inventario ?? 'FIFO')
  const [bizOverReceipt, setBizOverReceipt] = useState(tenant?.permite_over_receipt ?? false)
  const [bizTrazaAsignacion, setBizTrazaAsignacion] = useState((tenant as any)?.trazabilidad_asignacion ?? true)
  const [bizTimeout, setBizTimeout] = useState<string>(
    tenant?.session_timeout_minutes != null ? String(tenant.session_timeout_minutes) : 'nunca'
  )
  const [bizPresupuestoValidez, setBizPresupuestoValidez] = useState<string>(
    String((tenant as any)?.presupuesto_validez_dias ?? 30)
  )
  // Reservas (E1/E2/E6)
  const [bizReservaSenaObligatoria, setBizReservaSenaObligatoria] = useState<boolean>((tenant as any)?.reserva_sena_obligatoria ?? true)
  const [bizReservaSenaMinimaPct, setBizReservaSenaMinimaPct] = useState<string>(
    String((tenant as any)?.reserva_sena_minima_pct ?? 0)
  )
  const [bizReservaVencimientoDias, setBizReservaVencimientoDias] = useState<string>(
    (tenant as any)?.reserva_vencimiento_dias != null ? String((tenant as any).reserva_vencimiento_dias) : ''
  )
  const [bizReservaPenalidadPct, setBizReservaPenalidadPct] = useState<string>(
    String((tenant as any)?.reserva_penalidad_pct ?? 0)
  )

  // Facturación electrónica
  const [bizFactHabilitada,  setBizFactHabilitada]  = useState<boolean>((tenant as any)?.facturacion_habilitada ?? false)
  const [bizCuit,            setBizCuit]            = useState<string>((tenant as any)?.cuit ?? '')
  const [bizCondIva,         setBizCondIva]         = useState<string>((tenant as any)?.condicion_iva_emisor ?? '')
  const [bizRazonSocial,     setBizRazonSocial]     = useState<string>((tenant as any)?.razon_social_fiscal ?? '')
  const [bizDomicilioFiscal, setBizDomicilioFiscal] = useState<string>((tenant as any)?.domicilio_fiscal ?? '')
  const [bizUmbralB,         setBizUmbralB]         = useState<string>(String((tenant as any)?.umbral_factura_b ?? '68305.16'))
  const [bizAfipToken,       setBizAfipToken]       = useState<string>((tenant as any)?.afipsdk_token ?? '')
  const [showAfipToken,      setShowAfipToken]      = useState(false)

  // WhatsApp
  const [bizWAPlantilla, setBizWAPlantilla] = useState<string>((tenant as any)?.whatsapp_plantilla ?? '')
  // Envíos
  const [bizCostoKm, setBizCostoKm] = useState<string>(String((tenant as any)?.costo_envio_por_km ?? ''))
  // ISS-178 — Rangos horarios de entrega
  const [bizEnvioRangos, setBizEnvioRangos] = useState<Array<{ desde: string; hasta: string }>>(
    Array.isArray((tenant as any)?.envio_rangos_horarios)
      ? (tenant as any).envio_rangos_horarios.map((r: any) => ({ desde: String(r.desde ?? ''), hasta: String(r.hasta ?? '') }))
      : [{ desde: '08:00', hasta: '13:00' }, { desde: '13:00', hasta: '18:00' }, { desde: '18:00', hasta: '22:00' }]
  )

  // Fase 2 — identidad
  const [bizEmailLegal,      setBizEmailLegal]      = useState<string>(tenant?.email_legal ?? '')
  const [bizPrecioRedondeo,  setBizPrecioRedondeo]  = useState<string>(tenant?.precio_redondeo ?? 'none')
  // Moneda principal (v1.8.44)
  const [bizMoneda,          setBizMoneda]          = useState<string>((tenant as any)?.moneda ?? 'ARS')

  // Fase 3 — cliente en POS
  const [bizClienteObligatorio,     setBizClienteObligatorio]     = useState<string>(tenant?.cliente_obligatorio ?? 'nunca')
  const [bizClienteDatosMinimos,    setBizClienteDatosMinimos]    = useState<string>(tenant?.cliente_datos_minimos ?? 'nombre')
  const [bizClienteConsumidorFinal, setBizClienteConsumidorFinal] = useState<boolean>(tenant?.cliente_consumidor_final ?? true)
  const [bizClienteCreacionInline,  setBizClienteCreacionInline]  = useState<boolean>(tenant?.cliente_creacion_inline ?? true)

  // Fase 4 — descuentos y caja
  const [bizDescuentoMaxCajero,     setBizDescuentoMaxCajero]     = useState<string>(tenant?.descuento_max_cajero_pct != null ? String(tenant.descuento_max_cajero_pct) : '')
  const [bizDescuentoMaxSupervisor, setBizDescuentoMaxSupervisor] = useState<string>(tenant?.descuento_max_supervisor_pct != null ? String(tenant.descuento_max_supervisor_pct) : '')
  const [bizClaveMaestra,           setBizClaveMaestra]           = useState<string>('')
  const [showClaveMaestra,          setShowClaveMaestra]          = useState(false)
  const [bizBovedaUmbral,           setBizBovedaUmbral]           = useState<string>(tenant?.boveda_umbral_caja != null ? String(tenant.boveda_umbral_caja) : '')
  // Fase 2.1 — Diferencia de cierre (B1/B2/B3)
  const [bizDifUmbral, setBizDifUmbral] = useState<string>((tenant as any)?.diferencia_caja_umbral != null ? String((tenant as any).diferencia_caja_umbral) : '')
  const [bizDifRoles, setBizDifRoles] = useState<string[]>((tenant as any)?.diferencia_caja_alerta_roles ?? ['DUEÑO','SUPERVISOR'])
  const [bizDifCanales, setBizDifCanales] = useState<string[]>((tenant as any)?.diferencia_caja_alerta_canales ?? ['inapp','email'])
  // Fase 2.2 — Doble validación cierre (B7) + Editar movimientos (G1) por SUPERVISOR
  const [bizDobleVal, setBizDobleVal] = useState<boolean>(((tenant as any)?.config_caja ?? {}).doble_validacion_cierre === true)
  const [bizSupervisorEdita, setBizSupervisorEdita] = useState<boolean>(((tenant as any)?.config_caja ?? {}).supervisor_puede_editar_movimientos === true)
  const [bizSupervisorBoveda, setBizSupervisorBoveda] = useState<boolean>(((tenant as any)?.config_caja ?? {}).supervisor_puede_ver_boveda === true)
  const [savingConfigCaja, setSavingConfigCaja] = useState(false)
  const handleSaveConfigCaja = async () => {
    setSavingConfigCaja(true)
    const configActual = (tenant as any)?.config_caja ?? {}
    const nueva = {
      ...configActual,
      doble_validacion_cierre: bizDobleVal,
      supervisor_puede_editar_movimientos: bizSupervisorEdita,
      supervisor_puede_ver_boveda: bizSupervisorBoveda,
    }
    const { data, error } = await supabase.from('tenants').update({ config_caja: nueva }).eq('id', tenant!.id).select().single()
    setSavingConfigCaja(false)
    if (error || !data) { toast.error('No se pudo guardar'); return }
    setTenant(data)
    toast.success('Configuración de Caja guardada')
  }
  const [savingDif, setSavingDif] = useState(false)
  const handleSaveDif = async () => {
    setSavingDif(true)
    const { data, error } = await supabase.from('tenants').update({
      diferencia_caja_umbral: bizDifUmbral.trim() ? parseFloat(bizDifUmbral) : null,
      diferencia_caja_alerta_roles: bizDifRoles,
      diferencia_caja_alerta_canales: bizDifCanales,
    }).eq('id', tenant!.id).select().single()
    setSavingDif(false)
    if (error || !data) { toast.error('No se pudo guardar'); return }
    setTenant(data)
    toast.success('Configuración de alertas guardada')
  }

  // Gastos — reglas comprobante + alertas (v1.8.42)
  const t142 = tenant as any
  const [gCompSiIva,           setGCompSiIva]           = useState<boolean>(t142?.gastos_comp_si_iva ?? false)
  const [gCompSiMonto,         setGCompSiMonto]         = useState<boolean>(t142?.gastos_comp_si_monto ?? false)
  const [gCompMontoUmbral,     setGCompMontoUmbral]     = useState<string>(t142?.gastos_comp_monto_umbral != null ? String(t142.gastos_comp_monto_umbral) : '')
  const [gCompSiGanancias,     setGCompSiGanancias]     = useState<boolean>(t142?.gastos_comp_si_deduce_ganancias ?? false)
  const [gCompSiempre,         setGCompSiempre]         = useState<boolean>(t142?.gastos_comp_siempre ?? true)
  const [gDiasAlertaBorrador,  setGDiasAlertaBorrador]  = useState<string>(String(t142?.gastos_dias_alerta_borrador ?? 7))
  const [gDiasAlertaAnticipo,  setGDiasAlertaAnticipo]  = useState<string>(String(t142?.gastos_dias_alerta_anticipo_oc ?? 15))
  const [savingGastosCfg,      setSavingGastosCfg]      = useState(false)
  const [newCategoria,         setNewCategoria]         = useState<{ nombre: string; requiere_sucursal: boolean }>({ nombre: '', requiere_sucursal: false })


  // Puntos de venta AFIP
  const [pvCollapsed,   setPvCollapsed]   = useState(true)
  const [pvForm,        setPvForm]        = useState({ numero: '', nombre: '' })
  const [savingPv,      setSavingPv]      = useState(false)

  // Toggle facturación con auto-guardado y rollback si falla
  const toggleFacturacion = async () => {
    const nuevoValor = !bizFactHabilitada
    setBizFactHabilitada(nuevoValor)
    const { data, error } = await supabase.from('tenants')
      .update({ facturacion_habilitada: nuevoValor })
      .eq('id', tenant!.id).select().single()
    if (error || !data) {
      setBizFactHabilitada(!nuevoValor)
      toast.error('No se pudo guardar el cambio')
      return
    }
    setTenant(data)  // refrescar store para que persista al cambiar de tab/página
    toast.success(nuevoValor ? 'Facturación habilitada' : 'Facturación deshabilitada')
  }

  // Guardar solo los datos fiscales (sin pisar otros campos del state)
  const [savingFact, setSavingFact] = useState(false)
  const handleSaveFacturacion = async () => {
    setSavingFact(true)
    const { data, error } = await supabase.from('tenants').update({
      cuit: bizCuit.trim() || null,
      condicion_iva_emisor: bizCondIva || null,
      razon_social_fiscal: bizRazonSocial.trim() || null,
      domicilio_fiscal: bizDomicilioFiscal.trim() || null,
      umbral_factura_b: parseFloat(bizUmbralB) || 68305.16,
      afipsdk_token: bizAfipToken.trim() || null,
    }).eq('id', tenant!.id).select().single()
    setSavingFact(false)
    if (error || !data) { toast.error('No se pudo guardar'); return }
    setTenant(data)  // refrescar store
    toast.success('Datos fiscales guardados')
  }

  const handleSaveBiz = async () => {
    setSavingBiz(true)
    const tipoFinal = bizTipoSelect === 'Otro' && bizTipoPersonalizado.trim()
      ? bizTipoPersonalizado.trim()
      : bizTipoSelect
    const sessionTimeoutMinutes = bizTimeout === 'nunca' ? null : parseInt(bizTimeout)
    const updatePayload: any = {
      nombre: bizForm.nombre, tipo_comercio: tipoFinal, regla_inventario: bizRegla,
      session_timeout_minutes: sessionTimeoutMinutes, permite_over_receipt: bizOverReceipt,
      trazabilidad_asignacion: bizTrazaAsignacion,
      presupuesto_validez_dias: parseInt(bizPresupuestoValidez) || 30,
      // Reservas (E1/E2/E6)
      reserva_sena_obligatoria: bizReservaSenaObligatoria,
      reserva_sena_minima_pct: parseFloat(bizReservaSenaMinimaPct) || 0,
      reserva_vencimiento_dias: bizReservaVencimientoDias.trim() === '' ? null : (parseInt(bizReservaVencimientoDias) || null),
      reserva_penalidad_pct: parseFloat(bizReservaPenalidadPct) || 0,
      whatsapp_plantilla: bizWAPlantilla.trim() || null,
      costo_envio_por_km: bizCostoKm ? parseFloat(bizCostoKm) : null,
      envio_rangos_horarios: bizEnvioRangos.filter(r => r.desde && r.hasta),
      // Facturación
      facturacion_habilitada: bizFactHabilitada,
      cuit: bizCuit.trim() || null,
      condicion_iva_emisor: bizCondIva || null,
      razon_social_fiscal: bizRazonSocial.trim() || null,
      domicilio_fiscal: bizDomicilioFiscal.trim() || null,
      umbral_factura_b: parseFloat(bizUmbralB) || 68305.16,
      // Fase 2
      email_legal:           bizEmailLegal.trim() || null,
      precio_redondeo:       bizPrecioRedondeo,
      moneda:                bizMoneda,
      // Fase 3 — cliente en POS
      cliente_obligatorio:      bizClienteObligatorio,
      cliente_datos_minimos:    bizClienteDatosMinimos,
      cliente_consumidor_final: bizClienteConsumidorFinal,
      cliente_creacion_inline:  bizClienteCreacionInline,
      // Fase 4 — descuentos y caja
      descuento_max_cajero_pct:     bizDescuentoMaxCajero     ? parseFloat(bizDescuentoMaxCajero)     : null,
      descuento_max_supervisor_pct: bizDescuentoMaxSupervisor ? parseFloat(bizDescuentoMaxSupervisor) : null,
      boveda_umbral_caja:           bizBovedaUmbral           ? parseFloat(bizBovedaUmbral)           : null,
    }
    if (bizAfipToken.trim()) updatePayload.afipsdk_token = bizAfipToken.trim()
    if (bizClaveMaestra.trim()) updatePayload.clave_maestra = bizClaveMaestra.trim()
    const { data, error } = await supabase.from('tenants')
      .update(updatePayload)
      .eq('id', tenant!.id).select().single()
    if (error) toast.error(error.message)
    else { setTenant(data); toast.success('Datos actualizados') }
    setSavingBiz(false)
  }

  // Gastos — categorías + settings (v1.8.42)
  const { data: categoriasGasto = [], isLoading: loadingCatGasto } = useQuery({
    queryKey: ['categorias-gasto-config', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias_gasto')
        .select('id, nombre, requiere_sucursal, activo, predefinida, orden')
        .eq('tenant_id', tenant!.id)
        .order('orden', { ascending: true, nullsFirst: false })
        .order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'gastos',
  })

  const addCategoriaGasto = async () => {
    const nombre = newCategoria.nombre.trim()
    if (!nombre) return toast.error('Nombre vacío')
    const { error } = await supabase.from('categorias_gasto').insert({
      tenant_id: tenant!.id, nombre, requiere_sucursal: newCategoria.requiere_sucursal,
      activo: true, predefinida: false,
    })
    if (error) return toast.error(error.message)
    toast.success('Categoría agregada')
    setNewCategoria({ nombre: '', requiere_sucursal: false })
    qc.invalidateQueries({ queryKey: ['categorias-gasto-config'] })
    qc.invalidateQueries({ queryKey: ['categorias-gasto'] })
  }

  const toggleCategoriaGastoActivo = async (id: string, activo: boolean) => {
    const { error } = await supabase.from('categorias_gasto').update({ activo: !activo }).eq('id', id)
    if (error) return toast.error(error.message)
    qc.invalidateQueries({ queryKey: ['categorias-gasto-config'] })
    qc.invalidateQueries({ queryKey: ['categorias-gasto'] })
  }

  const toggleCategoriaGastoRequiereSucursal = async (id: string, requiere: boolean) => {
    const { error } = await supabase.from('categorias_gasto').update({ requiere_sucursal: !requiere }).eq('id', id)
    if (error) return toast.error(error.message)
    qc.invalidateQueries({ queryKey: ['categorias-gasto-config'] })
  }

  const deleteCategoriaGasto = async (id: string, predefinida: boolean) => {
    if (predefinida) return toast.error('Las categorías predefinidas no se pueden eliminar, solo desactivar')
    if (!confirm('¿Eliminar esta categoría? Los gastos existentes mantendrán el nombre como texto.')) return
    const { error } = await supabase.from('categorias_gasto').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Categoría eliminada')
    qc.invalidateQueries({ queryKey: ['categorias-gasto-config'] })
    qc.invalidateQueries({ queryKey: ['categorias-gasto'] })
  }

  const handleSaveGastosCfg = async () => {
    setSavingGastosCfg(true)
    const payload: any = {
      gastos_comp_si_iva:              gCompSiIva,
      gastos_comp_si_monto:            gCompSiMonto,
      gastos_comp_monto_umbral:        gCompMontoUmbral ? parseFloat(gCompMontoUmbral) : null,
      gastos_comp_si_deduce_ganancias: gCompSiGanancias,
      gastos_comp_siempre:             gCompSiempre,
      gastos_dias_alerta_borrador:     Math.max(1, parseInt(gDiasAlertaBorrador) || 7),
      gastos_dias_alerta_anticipo_oc:  Math.max(1, parseInt(gDiasAlertaAnticipo) || 15),
    }
    const { data, error } = await supabase.from('tenants').update(payload).eq('id', tenant!.id).select('*').single()
    if (error) toast.error(error.message)
    else { setTenant(data); toast.success('Reglas de gastos actualizadas') }
    setSavingGastosCfg(false)
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

  // Ubicaciones
  const { data: ubicaciones = [], isLoading: loadingUbic } = useQuery({
    queryKey: ['ubicaciones', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).order('prioridad').order('nombre')
      // Filtrar por sucursal: mostrar las de la sucursal activa + las globales (sin sucursal)
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })
  const [newUbicNombre, setNewUbicNombre] = useState('')
  const [newUbicDesc, setNewUbicDesc] = useState('')
  const [newUbicPrioridad, setNewUbicPrioridad] = useState('0')
  const [newUbicSucursalId, setNewUbicSucursalId] = useState<string>('')
  const [newUbicMonoSku, setNewUbicMonoSku] = useState(false)
  const [newUbicWmsOpen, setNewUbicWmsOpen] = useState(false)
  const [newUbicTipo, setNewUbicTipo] = useState('')
  const [newUbicAlto, setNewUbicAlto] = useState('')
  const [newUbicAncho, setNewUbicAncho] = useState('')
  const [newUbicLargo, setNewUbicLargo] = useState('')
  const [newUbicPeso, setNewUbicPeso] = useState('')
  const [newUbicPallets, setNewUbicPallets] = useState('')
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
  const [editUbicMonoSku, setEditUbicMonoSku] = useState(false)
  const [editUbicSucursalId, setEditUbicSucursalId] = useState('')
  const [ubicSearch, setUbicSearch] = useState('')

  const addUbicacion = async () => {
    if (!newUbicNombre.trim()) return
    const sucId = newUbicSucursalId || sucursalId || null
    const { error } = await supabase.from('ubicaciones').insert({
      tenant_id: tenant!.id,
      nombre: newUbicNombre.trim(),
      descripcion: newUbicDesc || null,
      prioridad: parseInt(newUbicPrioridad) || 0,
      sucursal_id: sucId,
      mono_sku: newUbicMonoSku,
      tipo_ubicacion: newUbicTipo || null,
      alto_cm: newUbicAlto ? parseFloat(newUbicAlto) : null,
      ancho_cm: newUbicAncho ? parseFloat(newUbicAncho) : null,
      largo_cm: newUbicLargo ? parseFloat(newUbicLargo) : null,
      peso_max_kg: newUbicPeso ? parseFloat(newUbicPeso) : null,
      capacidad_pallets: newUbicPallets ? parseInt(newUbicPallets) : null,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Ubicación agregada')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    logActividad({ entidad: 'ubicacion', entidad_nombre: newUbicNombre.trim(), accion: 'crear', pagina: '/configuracion' })
    setNewUbicNombre(''); setNewUbicDesc(''); setNewUbicPrioridad('0')
    setNewUbicSucursalId(''); setNewUbicMonoSku(false); setNewUbicWmsOpen(false)
    setNewUbicTipo(''); setNewUbicAlto(''); setNewUbicAncho(''); setNewUbicLargo(''); setNewUbicPeso(''); setNewUbicPallets('')
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
    setEditUbicMonoSku(u.mono_sku ?? false)
    setEditUbicSucursalId(u.sucursal_id ?? '')
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
      mono_sku: editUbicMonoSku,
      sucursal_id: editUbicSucursalId || null,
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Actualizada')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    logActividad({ entidad: 'ubicacion', entidad_id: id, entidad_nombre: editUbicNombre, accion: 'editar', campo: 'nombre', valor_anterior: old?.nombre ?? null, valor_nuevo: editUbicNombre, pagina: '/configuracion' })
    setEditUbicId(null)
  }
  const deleteUbicacion = async (id: string) => {
    const old = (ubicaciones as any[]).find(u => u.id === id)

    // 1. Bloquear si tiene inventario activo con stock
    const { count: cntStock } = await supabase.from('inventario_lineas')
      .select('*', { count: 'exact', head: true })
      .eq('ubicacion_id', id)
      .eq('activo', true)
      .gt('cantidad', 0)
    if ((cntStock ?? 0) > 0) {
      toast.error('No se puede eliminar: tiene inventario activo. Vacíala primero.')
      return
    }

    // 2. Verificar referencias sin stock (líneas inactivas + productos)
    const [{ count: cntLineas }, { count: cntProds }] = await Promise.all([
      supabase.from('inventario_lineas').select('*', { count: 'exact', head: true }).eq('ubicacion_id', id),
      supabase.from('productos').select('*', { count: 'exact', head: true }).eq('ubicacion_id', id).eq('tenant_id', tenant!.id),
    ])
    const totalRef = (cntLineas ?? 0) + (cntProds ?? 0)
    const msg = totalRef > 0
      ? `Esta ubicación tiene ${totalRef} referencia(s) sin stock activo que se desvincularán. ¿Confirmar eliminación?`
      : '¿Eliminar esta ubicación?'
    if (!confirm(msg)) return

    // 3. Nullificar referencias antes de borrar
    if ((cntLineas ?? 0) > 0)
      await supabase.from('inventario_lineas').update({ ubicacion_id: null }).eq('ubicacion_id', id)
    if ((cntProds ?? 0) > 0)
      await supabase.from('productos').update({ ubicacion_id: null }).eq('ubicacion_id', id).eq('tenant_id', tenant!.id)

    const { error } = await supabase.from('ubicaciones').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Ubicación eliminada')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    qc.invalidateQueries({ queryKey: ['productos'] })
    logActividad({ entidad: 'ubicacion', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' })
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
  const toggleUbicTN = async (u: any) => {
    const nuevo = !u.disponible_tn
    const { error } = await supabase.from('ubicaciones').update({ disponible_tn: nuevo }).eq('id', u.id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
  }
  const toggleUbicMELI = async (u: any) => {
    const nuevo = !u.disponible_meli
    const { error } = await supabase.from('ubicaciones').update({ disponible_meli: nuevo }).eq('id', u.id)
    if (error) { toast.error(error.message); return }
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
  const toggleDisponibleTN = async (estadoId: string, value: boolean) => {
    const { error } = await supabase.from('estados_inventario').update({ es_disponible_tn: value }).eq('id', estadoId)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['estados_inventario'] })
  }
  const toggleDisponibleVenta = async (estadoId: string, value: boolean) => {
    const { error } = await supabase.from('estados_inventario').update({ es_disponible_venta: value }).eq('id', estadoId)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['estados_inventario'] })
  }
  const toggleDisponibleMELI = async (estadoId: string, value: boolean) => {
    const { error } = await supabase.from('estados_inventario').update({ es_disponible_meli: value }).eq('id', estadoId)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['estados_inventario'] })
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
  const [comboForm, setComboForm] = useState({ nombre: '', descuento_tipo: 'pct', descuento_valor: '0' })
  const [comboItems, setComboItems] = useState<{ producto_id: string; cantidad: string }[]>([{ producto_id: '', cantidad: '1' }])
  const [savingCombo, setSavingCombo] = useState(false)

  const applyComboPreset = (preset: '3x2' | '2x1' | '2da') => {
    if (preset === '3x2') {
      setComboForm(p => ({ ...p, nombre: p.nombre || '3x2', descuento_tipo: 'pct', descuento_valor: '33' }))
      setComboItems(prev => [{ ...prev[0], cantidad: '3' }, ...prev.slice(1)])
    } else if (preset === '2x1') {
      setComboForm(p => ({ ...p, nombre: p.nombre || '2x1', descuento_tipo: 'pct', descuento_valor: '50' }))
      setComboItems(prev => [{ ...prev[0], cantidad: '2' }, ...prev.slice(1)])
    } else {
      const pct = prompt('% de descuento en la 2da unidad (ej: 30):')
      if (!pct || isNaN(parseInt(pct))) return
      const efectivo = Math.round(parseInt(pct) / 2)
      setComboForm(p => ({ ...p, nombre: p.nombre || `2da unidad ${pct}%`, descuento_tipo: 'pct', descuento_valor: String(efectivo) }))
      setComboItems(prev => [{ ...prev[0], cantidad: '2' }, ...prev.slice(1)])
    }
  }

  const { data: productosAll = [] } = useQuery({
    queryKey: ['productos-all', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos').select('id, nombre, sku')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'ventas',
  })

  const { data: combos = [], isLoading: loadingCombos } = useQuery({
    queryKey: ['combos', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('combos')
        .select('*, combo_items(producto_id, cantidad, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .order('created_at', { ascending: false })
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'ventas',
  })

  const addCombo = async () => {
    if (!comboForm.nombre.trim()) { toast.error('Ingresá un nombre'); return }
    if (comboItems.some(i => !i.producto_id)) { toast.error('Seleccioná un producto para cada ítem'); return }
    if (comboItems.some(i => parseInt(i.cantidad) < 1)) { toast.error('La cantidad mínima es 1'); return }
    const valor = parseFloat(comboForm.descuento_valor)
    if (isNaN(valor) || valor < 0) { toast.error('Valor de descuento inválido'); return }
    if (comboForm.descuento_tipo === 'pct' && valor > 100) { toast.error('El porcentaje no puede superar 100'); return }
    const descuento_pct = comboForm.descuento_tipo === 'pct' ? valor : 0
    const descuento_monto = comboForm.descuento_tipo !== 'pct' ? valor : 0
    setSavingCombo(true)
    try {
      const { data: combo, error: eC } = await supabase.from('combos').insert({
        tenant_id: tenant!.id,
        nombre: comboForm.nombre.trim(),
        descuento_pct,
        descuento_tipo: comboForm.descuento_tipo,
        descuento_monto,
        sucursal_id: sucursalId || null,
      }).select('id').single()
      if (eC) throw eC
      const { error: eI } = await supabase.from('combo_items').insert(
        comboItems.map(i => ({ tenant_id: tenant!.id, combo_id: combo.id, producto_id: i.producto_id, cantidad: parseInt(i.cantidad) || 1 }))
      )
      if (eI) throw eI
      toast.success('Combo creado')
      logActividad({ entidad: 'combo', entidad_nombre: comboForm.nombre.trim(), accion: 'crear', pagina: '/configuracion' })
      setComboForm({ nombre: '', descuento_tipo: 'pct', descuento_valor: '0' })
      setComboItems([{ producto_id: '', cantidad: '1' }])
      qc.invalidateQueries({ queryKey: ['combos'] })
    } catch (err: any) { toast.error(err.message ?? 'Error al crear combo') }
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
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'estados' && estadosSubTab === 'grupos',
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
  const [processingAgingId, setProcessingAgingId] = useState<string | null>(null)

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

  const processAgingProfile = async (profileId: string, profileNombre: string) => {
    setProcessingAgingId(profileId)
    try {
      const { data, error } = await supabase.rpc('process_aging_profile_single', { p_profile_id: profileId })
      if (error) throw error
      const cambios = (data as any)?.cambios ?? 0
      toast.success(cambios > 0
        ? `${cambios} estado${cambios !== 1 ? 's' : ''} actualizado${cambios !== 1 ? 's' : ''} en "${profileNombre}"`
        : `Sin cambios en "${profileNombre}"`)
    } catch (e: any) {
      toast.error(e.message ?? 'Error al procesar el perfil')
    } finally {
      setProcessingAgingId(null)
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

  // ── Certificados AFIP ───────────────────────────────────────────────────
  const [certCollapsed, setCertCollapsed] = useState(true)
  const [certCuit, setCertCuit] = useState('')
  const [certValidez, setCertValidez] = useState('')
  const [certCrtFile, setCertCrtFile] = useState<File | null>(null)
  const [certKeyFile, setCertKeyFile] = useState<File | null>(null)
  const [savingCert, setSavingCert] = useState(false)

  const { data: tenantCert, refetch: refetchCert } = useQuery<TenantCertificate | null>({
    queryKey: ['tenant-cert', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('tenant_certificates')
        .select('*').eq('tenant_id', tenant!.id).maybeSingle()
      return data as TenantCertificate | null
    },
    enabled: !!tenant && tab === 'facturacion',
  })

  const { data: puntosVentaAfip = [], refetch: refetchPV } = useQuery({
    queryKey: ['puntos-venta-afip-config', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('puntos_venta_afip')
        .select('*').eq('tenant_id', tenant!.id).order('numero')
      return data ?? []
    },
    enabled: !!tenant && tab === 'facturacion',
  })

  const handleSaveCert = async () => {
    if (!certCrtFile || !certKeyFile) { toast.error('Seleccioná los dos archivos (.crt y .key)'); return }
    if (!certCuit.trim()) { toast.error('El CUIT es obligatorio'); return }
    setSavingCert(true)
    try {
      await uploadCertificates(tenant!.id, certCrtFile, certKeyFile, certCuit, certValidez || null)
      toast.success('Certificados AFIP guardados')
      setCertCrtFile(null); setCertKeyFile(null)
      refetchCert()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar certificados')
    } finally {
      setSavingCert(false)
    }
  }

  // ── Métodos de pago ─────────────────────────────────────────────────────────
  const [nuevoMetodo, setNuevoMetodo] = useState({ nombre: '', color: '#22c55e' })
  const [editMetodoId, setEditMetodoId] = useState<string | null>(null)
  const [editMetodoData, setEditMetodoData] = useState({ nombre: '', color: '', comision_pct: '', cuenta_origen_id: '' as string | null | '' })

  // ISS-086: Cuotas por banco
  type BancoCuota = { id: string; nombre: string; cuotas: { cant: number; sin_interes: boolean; interes: number }[] }
  const [cuotasBancos, setCuotasBancos] = useState<BancoCuota[]>(() =>
    ((tenant as any)?.cuotas_bancos ?? []) as BancoCuota[]
  )
  const [nuevoBancoNombre, setNuevoBancoNombre] = useState('')
  const [editBancoId, setEditBancoId] = useState<string | null>(null)
  const [nuevaCuota, setNuevaCuota] = useState({ cant: '', interes: '', sin_interes: false })

  const saveCuotasBancos = async (bancos: BancoCuota[]) => {
    const { error } = await supabase.from('tenants').update({ cuotas_bancos: bancos }).eq('id', tenant!.id)
    if (error) toast.error('Error al guardar configuración de cuotas')
    else { setCuotasBancos(bancos); toast.success('Cuotas actualizadas') }
  }

  const METODOS_DEFAULTS = [
    { nombre: 'Efectivo',           color: '#22c55e', orden: 1 },
    { nombre: 'Mercado Pago',       color: '#06b6d4', orden: 2 },
    { nombre: 'Tarjeta de débito',  color: '#eab308', orden: 3 },
    { nombre: 'Transferencia',      color: '#8b5cf6', orden: 4 },
    { nombre: 'Tarjeta de crédito', color: '#f97316', orden: 5 },
  ]

  const { data: metodosPago = [], isLoading: loadingMetodos } = useQuery({
    queryKey: ['metodos_pago', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('metodos_pago')
        .select('*').eq('tenant_id', tenant!.id).order('orden').order('nombre')
      if (!data || data.length === 0) {
        const { data: inserted } = await supabase.from('metodos_pago').insert(
          METODOS_DEFAULTS.map(d => ({ ...d, tenant_id: tenant!.id, activo: true, es_sistema: true }))
        ).select()
        return inserted ?? []
      }
      return data
    },
    enabled: !!tenant && tab === 'ventas',
  })

  const addMetodoPago = useMutation({
    mutationFn: async () => {
      if (!nuevoMetodo.nombre.trim()) throw new Error('El nombre es requerido')
      const { error } = await supabase.from('metodos_pago').insert({
        tenant_id: tenant!.id, nombre: nuevoMetodo.nombre.trim(),
        color: nuevoMetodo.color, activo: true, es_sistema: false,
        orden: (metodosPago.length + 1),
      })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Método agregado'); setNuevoMetodo({ nombre: '', color: '#22c55e' }); qc.invalidateQueries({ queryKey: ['metodos_pago'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMetodoPago = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('metodos_pago').update({
        nombre: editMetodoData.nombre.trim(),
        color: editMetodoData.color,
        comision_pct: editMetodoData.comision_pct ? parseFloat(editMetodoData.comision_pct) : 0,
        cuenta_origen_id: editMetodoData.cuenta_origen_id || null,
      }).eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Guardado'); setEditMetodoId(null); qc.invalidateQueries({ queryKey: ['metodos_pago'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleMetodoPago = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from('metodos_pago').update({ activo }).eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metodos_pago'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMetodoPago = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('metodos_pago').delete().eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['metodos_pago'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleMetodoPagoFlag = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: 'habilitado_ventas' | 'habilitado_gastos'; value: boolean }) => {
      const { error } = await supabase.from('metodos_pago').update({ [field]: value }).eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metodos_pago'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  // ─── Cuentas de Origen ────────────────────────────────────────────────────
  const [nuevaCuenta, setNuevaCuenta] = useState({ nombre: '', tipo: 'banco', banco: '', alias: '', numero: '', moneda: '' })
  const [editCuentaId, setEditCuentaId] = useState<string | null>(null)
  const [editCuentaData, setEditCuentaData] = useState({ nombre: '', tipo: 'banco', banco: '', alias: '', numero: '', moneda: '' })

  const { data: cuentasOrigen = [], isLoading: loadingCuentas } = useQuery<any[]>({
    queryKey: ['cuentas_origen', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('cuentas_origen')
        .select('*').eq('tenant_id', tenant!.id).order('activo', { ascending: false }).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && (tab === 'caja' || tab === 'ventas'),
  })

  const addCuentaOrigen = useMutation({
    mutationFn: async () => {
      if (!nuevaCuenta.nombre.trim()) throw new Error('El nombre es requerido')
      const { error } = await supabase.from('cuentas_origen').insert({
        tenant_id: tenant!.id,
        nombre: nuevaCuenta.nombre.trim(),
        tipo: nuevaCuenta.tipo,
        banco: nuevaCuenta.banco.trim() || null,
        alias: nuevaCuenta.alias.trim() || null,
        numero: nuevaCuenta.numero.trim() || null,
        moneda: nuevaCuenta.moneda || (tenant as any)?.moneda || 'ARS',
        activo: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cuenta creada')
      setNuevaCuenta({ nombre: '', tipo: 'banco', banco: '', alias: '', numero: '', moneda: '' })
      qc.invalidateQueries({ queryKey: ['cuentas_origen'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateCuentaOrigen = useMutation({
    mutationFn: async (id: string) => {
      if (!editCuentaData.nombre.trim()) throw new Error('El nombre es requerido')
      const { error } = await supabase.from('cuentas_origen').update({
        nombre: editCuentaData.nombre.trim(),
        tipo: editCuentaData.tipo,
        banco: editCuentaData.banco.trim() || null,
        alias: editCuentaData.alias.trim() || null,
        numero: editCuentaData.numero.trim() || null,
        moneda: editCuentaData.moneda || (tenant as any)?.moneda || 'ARS',
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Guardado'); setEditCuentaId(null); qc.invalidateQueries({ queryKey: ['cuentas_origen'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleCuentaOrigen = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from('cuentas_origen').update({ activo }).eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cuentas_origen'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteCuentaOrigen = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cuentas_origen').delete().eq('id', id).eq('tenant_id', tenant!.id)
      if (error) {
        if ((error as any).code === '23503') throw new Error('No se puede eliminar: tiene movimientos o métodos asociados. Desactivala en su lugar.')
        throw error
      }
    },
    onSuccess: () => { toast.success('Eliminada'); qc.invalidateQueries({ queryKey: ['cuentas_origen'] }); qc.invalidateQueries({ queryKey: ['metodos_pago'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─── Integraciones ────────────────────────────────────────────────────────
  const { data: tnCreds = [], isLoading: tnLoading } = useQuery({
    queryKey: ['tn_credentials', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('tiendanube_credentials')
        .select('id, sucursal_id, store_id, store_name, store_url, conectado, conectado_at')
        .eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant && tab === 'conectividad',
  })

  const { data: mpCreds = [], isLoading: mpLoading } = useQuery({
    queryKey: ['mp_credentials', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('mercadopago_credentials')
        .select('id, sucursal_id, seller_id, seller_email, expires_at, conectado, conectado_at')
        .eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant && tab === 'conectividad',
  })

  // ─── TN product mapping ──────────────────────────────────────────────────
  const [tnMapExpanded, setTnMapExpanded] = useState<string | null>(null)
  const [tnMapForm, setTnMapForm] = useState<{ productoId: string; tnProductId: string; tnVariantId: string; syncStock: boolean } | null>(null)
  const [tnSyncing, setTnSyncing] = useState(false)
  const [tnSearchResults, setTnSearchResults] = useState<any[]>([])
  const [tnSearching, setTnSearching] = useState(false)
  const [meliSyncing, setMeliSyncing] = useState(false)
  const [meliSearchResults, setMeliSearchResults] = useState<any[]>([])
  const [meliSearching, setMeliSearching] = useState(false)

  const forceSyncTN = async () => {
    setTnSyncing(true)
    try {
      const { data: maps, error: mapsErr } = await supabase.from('inventario_tn_map')
        .select('producto_id, tn_product_id, tn_variant_id, sucursal_id')
        .eq('tenant_id', tenant!.id).eq('sync_stock', true)
      if (mapsErr) throw new Error(`Maps: ${mapsErr.message}`)
      if (!maps || maps.length === 0) { toast.error('No hay productos mapeados con sync_stock activo'); setTnSyncing(false); return }

      const { error: insertErr } = await supabase.from('integration_job_queue').insert(
        maps.map(m => ({
          tenant_id: tenant!.id,
          integracion: 'TiendaNube',
          tipo: 'sync_stock',
          payload: { producto_id: m.producto_id, tn_product_id: m.tn_product_id, tn_variant_id: m.tn_variant_id },
          status: 'pending',
          next_attempt_at: new Date().toISOString(),
        }))
      )
      if (insertErr) throw new Error(`Queue: ${insertErr.message}`)

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tn-stock-worker`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`Worker ${res.status}: ${text.substring(0, 200)}`)
      const json = JSON.parse(text)
      toast.success(`Sync TN: ${json.done ?? 0} productos actualizados (${json.processed ?? 0} procesados)`)
    } catch (e: any) { toast.error(`Error: ${e.message}`) }
    setTnSyncing(false)
  }

  const forceSyncMELI = async () => {
    setMeliSyncing(true)
    try {
      const { data: maps, error: mapsErr } = await supabase.from('inventario_meli_map')
        .select('producto_id, meli_item_id, meli_variation_id')
        .eq('tenant_id', tenant!.id).eq('sync_stock', true)
      if (mapsErr) throw new Error(`Maps: ${mapsErr.message}`)
      if (!maps || maps.length === 0) { toast.error('No hay productos mapeados con sync_stock activo'); setMeliSyncing(false); return }

      const { error: insertErr } = await supabase.from('integration_job_queue').insert(
        maps.map(m => ({
          tenant_id: tenant!.id,
          integracion: 'MercadoLibre',
          tipo: 'sync_stock',
          payload: { producto_id: m.producto_id, meli_item_id: m.meli_item_id, meli_variation_id: m.meli_variation_id },
          status: 'pending',
          next_attempt_at: new Date().toISOString(),
        }))
      )
      if (insertErr) throw new Error(`Queue: ${insertErr.message}`)

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meli-stock-worker`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`Worker ${res.status}: ${text.substring(0, 200)}`)
      const json = JSON.parse(text)
      toast.success(`Sync ML: ${json.done ?? 0} productos actualizados (${json.processed ?? 0} procesados)`)
    } catch (e: any) { toast.error(`Error al sincronizar: ${e.message}`) }
    setMeliSyncing(false)
  }

  const searchTNProducts = async (sku: string, sucursalId: string) => {
    if (!sku.trim()) return
    setTnSearching(true)
    setTnSearchResults([])
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tn-search-products?q=${encodeURIComponent(sku)}&sucursal_id=${sucursalId}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      )
      const json = await res.json()
      setTnSearchResults(Array.isArray(json) ? json : [])
    } catch { toast.error('Error al buscar en TN') }
    setTnSearching(false)
  }

  const searchMELIItems = async (sku: string) => {
    if (!sku.trim()) return
    setMeliSearching(true)
    setMeliSearchResults([])
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meli-search-items?q=${encodeURIComponent(sku)}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      )
      const json = await res.json()
      setMeliSearchResults(Array.isArray(json) ? json : [])
    } catch { toast.error('Error al buscar en ML') }
    setMeliSearching(false)
  }

  const { data: tnMap = [] } = useQuery({
    queryKey: ['tn_map', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventario_tn_map')
        .select('id, sucursal_id, producto_id, tn_product_id, tn_variant_id, sync_stock, ultimo_sync_at, productos(nombre, sku)')
        .eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant && tab === 'conectividad',
  })

  const { data: productosMap = [] } = useQuery({
    queryKey: ['productos_for_map', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, sku')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'conectividad',
  })

  const upsertTnMap = useMutation({
    mutationFn: async ({ sucursalId }: { sucursalId: string }) => {
      if (!tnMapForm || !tenant) return
      const { error } = await supabase.from('inventario_tn_map').upsert({
        tenant_id: tenant.id,
        sucursal_id: sucursalId,
        producto_id: tnMapForm.productoId,
        tn_product_id: parseInt(tnMapForm.tnProductId),
        tn_variant_id: parseInt(tnMapForm.tnVariantId),
        sync_stock: tnMapForm.syncStock,
      }, { onConflict: 'tenant_id,sucursal_id,producto_id' })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Mapeo guardado')
      setTnMapForm(null)
      qc.invalidateQueries({ queryKey: ['tn_map'] })
    },
    onError: () => toast.error('Error guardando mapeo'),
  })

  const deleteTnMap = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventario_tn_map').delete().eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Mapeo eliminado'); qc.invalidateQueries({ queryKey: ['tn_map'] }) },
  })

  const desconectarTN = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tiendanube_credentials').delete().eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('TiendaNube desconectada'); qc.invalidateQueries({ queryKey: ['tn_credentials'] }) },
    onError: () => toast.error('Error al desconectar'),
  })

  const desconectarMP = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('mercadopago_credentials').delete().eq('id', id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('MercadoPago desconectado'); qc.invalidateQueries({ queryKey: ['mp_credentials'] }) },
    onError: () => toast.error('Error al desconectar'),
  })

  const getTnOAuthUrl = (sucursalId: string) => {
    const appId = import.meta.env.VITE_TN_APP_ID
    if (!appId || !tenant) return null
    const state = btoa(`${tenant.id}:${sucursalId}`)
    return `https://www.tiendanube.com/apps/${appId}/authorize?state=${state}`
  }

  const getMpOAuthUrl = (sucursalId: string) => {
    const clientId = import.meta.env.VITE_MP_CLIENT_ID
    if (!clientId || !tenant) return null
    const redirectUri = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-oauth-callback`
    const state = btoa(`${tenant.id}:${sucursalId}`)
    return `https://auth.mercadopago.com.ar/authorization?client_id=${clientId}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
  }

  // ─── MELI ────────────────────────────────────────────────────────────────────
  const { data: meliCredentials = [] } = useQuery({
    queryKey: ['meli_credentials', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('meli_credentials')
        .select('id, sucursal_id, seller_id, seller_nickname, seller_email, expires_at, conectado')
        .eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant && tab === 'conectividad',
  })

  const { data: meliMap = [] } = useQuery({
    queryKey: ['meli_map', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventario_meli_map')
        .select('id, producto_id, meli_item_id, meli_variation_id, sync_stock, sync_precio, ultimo_sync_at, productos(nombre, sku)')
        .eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant && tab === 'conectividad',
  })

  const [meliMapExpanded, setMeliMapExpanded] = useState(false)
  const [meliMapForm, setMeliMapForm] = useState<{ productoId: string; meliItemId: string; meliVariationId: string; syncStock: boolean; syncPrecio: boolean } | null>(null)

  // ISS-072: MODO integration
  const { data: modoCred, refetch: refetchModo } = useQuery({
    queryKey: ['modo_credentials', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('modo_credentials')
        .select('id, merchant_id, api_key, ambiente, conectado, conectado_at')
        .eq('tenant_id', tenant!.id).maybeSingle()
      return data
    },
    enabled: !!tenant && tab === 'conectividad',
  })
  const [modoForm, setModoForm] = useState({ merchant_id: '', api_key: '', ambiente: 'test' as 'test' | 'prod' })
  const [savingModo, setSavingModo] = useState(false)

  const conectarModo = async () => {
    if (!modoForm.merchant_id.trim() || !modoForm.api_key.trim()) {
      toast.error('Completá el Merchant ID y la API Key')
      return
    }
    setSavingModo(true)
    try {
      const payload = {
        tenant_id: tenant!.id,
        merchant_id: modoForm.merchant_id.trim(),
        api_key: modoForm.api_key.trim(),
        ambiente: modoForm.ambiente,
        conectado: true,
        conectado_at: new Date().toISOString(),
      }
      if (modoCred?.id) {
        const { error } = await supabase.from('modo_credentials').update(payload).eq('id', modoCred.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('modo_credentials').insert(payload)
        if (error) throw error
      }
      toast.success('MODO configurado correctamente')
      refetchModo()
      setModoForm({ merchant_id: '', api_key: '', ambiente: 'test' })
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar') }
    finally { setSavingModo(false) }
  }

  const desconectarModo = async () => {
    if (!confirm('¿Desconectar MODO?')) return
    await supabase.from('modo_credentials').update({ conectado: false }).eq('tenant_id', tenant!.id)
    toast.success('MODO desconectado')
    refetchModo()
  }

  const upsertMeliMap = useMutation({
    mutationFn: async () => {
      if (!meliMapForm || !tenant) return
      const { error } = await supabase.from('inventario_meli_map').upsert({
        tenant_id: tenant.id,
        producto_id: meliMapForm.productoId,
        meli_item_id: meliMapForm.meliItemId.trim().toUpperCase(),
        meli_variation_id: meliMapForm.meliVariationId ? parseInt(meliMapForm.meliVariationId) : null,
        sync_stock: meliMapForm.syncStock,
        sync_precio: meliMapForm.syncPrecio,
      }, { onConflict: 'tenant_id,producto_id,meli_item_id' })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Mapeo guardado'); qc.invalidateQueries({ queryKey: ['meli_map'] }); setMeliMapForm(null) },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMeliMap = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventario_meli_map').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Mapeo eliminado'); qc.invalidateQueries({ queryKey: ['meli_map'] }) },
  })

  const desconectarMELI = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('meli_credentials').update({ conectado: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('MercadoLibre desconectado'); qc.invalidateQueries({ queryKey: ['meli_credentials'] }) },
  })

  const getMeliOAuthUrl = (sucursalId: string) => {
    const clientId = import.meta.env.VITE_MELI_CLIENT_ID
    if (!clientId || !tenant) return null
    const redirectUri = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meli-oauth-callback`
    const state = btoa(`${tenant.id}:${sucursalId}`)
    return `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
  }

  // ── Unidades de medida ────────────────────────────────────────────────────────
  const [udmNombre, setUdmNombre] = useState('')
  const [udmSimbolo, setUdmSimbolo] = useState('')
  const [udmEditId, setUdmEditId] = useState<string | null>(null)
  const [udmEditNombre, setUdmEditNombre] = useState('')
  const [udmEditSimbolo, setUdmEditSimbolo] = useState('')
  const [udmSaving, setUdmSaving] = useState(false)

  const { data: unidadesMedida = [], isLoading: loadingUdm } = useQuery({
    queryKey: ['unidades_medida', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('unidades_medida').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'inventario',
  })

  const addUdm = async () => {
    if (!udmNombre.trim()) return
    if ((unidadesMedida as any[]).some((u: any) => u.nombre.toLowerCase() === udmNombre.trim().toLowerCase())) {
      toast.error('Ya existe una unidad con ese nombre'); return
    }
    setUdmSaving(true)
    const { error } = await supabase.from('unidades_medida').insert({ tenant_id: tenant!.id, nombre: udmNombre.trim(), simbolo: udmSimbolo.trim() || null, activo: true })
    if (error) toast.error(error.message)
    else { toast.success('Unidad agregada'); setUdmNombre(''); setUdmSimbolo(''); qc.invalidateQueries({ queryKey: ['unidades_medida'] }) }
    setUdmSaving(false)
  }

  const updateUdm = async (id: string) => {
    if (!udmEditNombre.trim()) return
    setUdmSaving(true)
    const { error } = await supabase.from('unidades_medida').update({ nombre: udmEditNombre.trim(), simbolo: udmEditSimbolo.trim() || null }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Unidad actualizada'); setUdmEditId(null); qc.invalidateQueries({ queryKey: ['unidades_medida'] }) }
    setUdmSaving(false)
  }

  const deleteUdm = async (id: string) => {
    if (!confirm('¿Desactivar esta unidad de medida?')) return
    const { error } = await supabase.from('unidades_medida').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Unidad desactivada'); qc.invalidateQueries({ queryKey: ['unidades_medida'] }) }
  }

  const tabGroups: { label: string; items: { id: Tab; label: string; icon: any; placeholder?: boolean }[] }[] = [
    {
      label: 'Negocio',
      items: [
        { id: 'negocio',        label: 'Mi negocio',     icon: Building2 },
        { id: 'ventas',         label: 'Ventas',          icon: ShoppingCart },
        { id: 'caja',           label: 'Caja',            icon: Wallet },
        { id: 'clientes',       label: 'Clientes',        icon: Users },
        { id: 'inventario',     label: 'Inventario',      icon: Package },
        { id: 'envios',         label: 'Envíos',          icon: Truck },
        { id: 'gastos',         label: 'Gastos',          icon: TrendingDown },
        { id: 'facturacion',    label: 'Facturación',     icon: Receipt },
        { id: 'rrhh',           label: 'RRHH',            icon: UserCog, placeholder: true },
      ],
    },
    {
      label: 'Sistema',
      items: [
        { id: 'alertas',        label: 'Alertas',         icon: Bell,      placeholder: true },
        { id: 'notificaciones', label: 'Notificaciones',  icon: Bell,      placeholder: true },
        { id: 'conectividad',   label: 'Conectividad',    icon: Plug },
      ],
    },
  ]
  const allTabs = tabGroups.flatMap(g => g.items)

  const PlaceholderTab = ({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-12 text-center space-y-4">
      <div className="w-14 h-14 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto">
        <Icon size={24} className="text-gray-400 dark:text-gray-500" />
      </div>
      <div>
        <p className="font-semibold text-gray-700 dark:text-gray-300">{title}</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-sm mx-auto">{desc}</p>
      </div>
      <span className="inline-block text-xs bg-accent/10 text-accent px-3 py-1 rounded-full font-medium">Próximamente</span>
    </div>
  )

  const subTabNav = <T extends string>(
    items: { id: T; label: string; icon: any }[],
    active: T,
    setActive: (v: T) => void
  ) => (
    <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => setActive(id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all whitespace-nowrap
            ${active === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
          <Icon size={14} />{label}
        </button>
      ))}
    </div>
  )

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
        <nav className="hidden lg:flex flex-col w-48 flex-shrink-0 bg-white dark:bg-gray-800 rounded-xl p-2 shadow-sm border border-gray-100 dark:border-gray-700 sticky top-4">
          {tabGroups.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <div className="border-t border-gray-100 dark:border-gray-700 my-1.5" />}
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 pt-1.5 pb-1">{group.label}</p>
              {group.items.map(({ id, label, icon: Icon, placeholder }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left
                    ${tab === id ? 'bg-accent/10 text-accent' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'}
                    ${placeholder ? 'opacity-60' : ''}`}>
                  <Icon size={15} className="flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  {placeholder && <span className="text-[9px] bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-400 dark:text-gray-500">pronto</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Content column */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Horizontal tabs — mobile only */}
          <div className="lg:hidden flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl overflow-x-auto">
            {allTabs.map(({ id, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-shrink-0 flex items-center justify-center p-2.5 rounded-lg transition-all
                  ${tab === id ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                <Icon size={16} />
              </button>
            ))}
          </div>

      {/* ── MI NEGOCIO ──────────────────────────────────────────────────────── */}
      {tab === 'negocio' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email legal / facturación</label>
            <input type="email" value={bizEmailLegal} disabled={!canEdit}
              onChange={e => setBizEmailLegal(e.target.value)}
              placeholder="ej. admin@minegocio.com"
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Para notificaciones fiscales y envío de facturas.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
              <DollarSign size={14} className="text-accent" /> Moneda principal del negocio
            </label>
            <select value={bizMoneda} disabled={!canEdit}
              onChange={e => setBizMoneda(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
              {MONEDAS_DISPONIBLES.map(m => (
                <option key={m.code} value={m.code}>{m.simbolo}  {m.code} — {m.nombre}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Define el símbolo y el formato numérico que se usa en toda la app. <strong>No convierte precios existentes</strong> — solo cambia cómo se muestran.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Redondeo de precios de venta</label>
            <select value={bizPrecioRedondeo} disabled={!canEdit}
              onChange={e => setBizPrecioRedondeo(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
              <option value="none">Sin redondeo</option>
              <option value="10">Redondear a $10</option>
              <option value="50">Redondear a $50</option>
              <option value="100">Redondear a $100</option>
              <option value="500">Redondear a $500</option>
              <option value="1000">Redondear a $1.000</option>
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Al calcular precios de venta, redondear al múltiplo más cercano. No afecta precios ya guardados.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plan actual</label>
            <div className="px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl text-sm">
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

      {tab === 'negocio' && <MarketplaceSection />}


      {/* ── VENTAS ───────────────────────────────────────────────────────────── */}
      {tab === 'ventas' && subTabNav(
        [
          { id: 'metodos' as VentasSubTab, label: 'Métodos de pago', icon: CreditCard },
          { id: 'descuentos' as VentasSubTab, label: 'Descuentos y combos', icon: Gift },
          { id: 'operativa' as VentasSubTab, label: 'Operativa', icon: Timer },
        ],
        ventasSubTab,
        setVentasSubTab
      )}

      {/* ── Facturación Electrónica ─────────────────────────────────────────── */}
      {tab === 'facturacion' && canEdit && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-accent" />
              <span className="font-semibold text-gray-700 dark:text-gray-300">Facturación Electrónica (ARCA)</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {bizFactHabilitada ? 'Habilitada' : 'Deshabilitada'}
              </span>
              <button onClick={toggleFacturacion}
                title="Click para habilitar/deshabilitar — se guarda automáticamente"
                className={`relative w-10 h-5 rounded-full transition-colors ${bizFactHabilitada ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${bizFactHabilitada ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </label>
          </div>
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Completá los datos fiscales del negocio para emitir comprobantes electrónicos A, B y C.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">CUIT</label>
                <input type="text" value={bizCuit} onChange={e => setBizCuit(e.target.value)}
                  placeholder="20-12345678-9"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Condición IVA del emisor</label>
                <div className="relative">
                  <select value={bizCondIva} onChange={e => setBizCondIva(e.target.value)}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="">Seleccionar…</option>
                    <option value="RI">Responsable Inscripto (RI)</option>
                    <option value="Monotributista">Monotributista</option>
                    <option value="Exento">Exento</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Razón social fiscal</label>
                <input type="text" value={bizRazonSocial} onChange={e => setBizRazonSocial(e.target.value)}
                  placeholder="Razón social ante AFIP"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Domicilio fiscal</label>
                <input type="text" value={bizDomicilioFiscal} onChange={e => setBizDomicilioFiscal(e.target.value)}
                  placeholder="Calle 123, Ciudad"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Umbral Factura B ($) <span className="text-gray-400 font-normal">— RG 5616</span>
                </label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizUmbralB} onChange={e => setBizUmbralB(e.target.value)} min="0"
                  placeholder="68305.16"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                <p className="text-xs text-gray-400 mt-0.5">Ventas ≥ este monto requieren DNI/CUIT del cliente</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Token AfipSDK</label>
                <div className="relative">
                  <input type={showAfipToken ? 'text' : 'password'} value={bizAfipToken} onChange={e => setBizAfipToken(e.target.value)}
                    placeholder="Token de afipsdk.com"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  <button type="button" onClick={() => setShowAfipToken(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <Eye size={14} />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Obtenelo en afipsdk.com. Se guarda encriptado.</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={handleSaveFacturacion} disabled={savingFact}
                className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                {savingFact ? 'Guardando...' : 'Guardar datos fiscales'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Puntos de venta AFIP ─────────────────────────────────────────────── */}
      {tab === 'facturacion' && canEdit && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <button className="w-full flex items-center gap-3 px-5 py-4 text-left"
            onClick={() => setPvCollapsed(v => !v)}>
            <Hash size={18} className="text-accent" />
            <span className="font-semibold text-gray-700 dark:text-gray-300 flex-1">Puntos de venta AFIP</span>
            <span className="text-xs text-gray-400">{(puntosVentaAfip as any[]).length} configurado{(puntosVentaAfip as any[]).length !== 1 ? 's' : ''}</span>
            {pvCollapsed ? <ChevronRight size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </button>
          {!pvCollapsed && (
            <div className="px-5 pb-5 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-4">
              <p className="text-xs text-gray-400 dark:text-gray-500">Cada punto de venta debe estar habilitado en ARCA antes de usarlo.</p>
              {/* Lista */}
              {(puntosVentaAfip as any[]).map((pv: any) => (
                <div key={pv.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-xl text-sm">
                  <div>
                    <span className="font-mono font-medium text-gray-800 dark:text-gray-100">{String(pv.numero).padStart(4,'0')}</span>
                    {pv.nombre && <span className="ml-2 text-gray-500 dark:text-gray-400">{pv.nombre}</span>}
                  </div>
                  <button onClick={async () => {
                    if (!confirm('¿Eliminar este punto de venta?')) return
                    await supabase.from('puntos_venta_afip').delete().eq('id', pv.id)
                    refetchPV()
                  }} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                </div>
              ))}
              {/* Form agregar */}
              <div className="flex gap-2 items-end">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Número</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={pvForm.numero}
                    onChange={e => setPvForm(f => ({ ...f, numero: e.target.value }))} min="1" max="9998"
                    placeholder="1"
                    className="w-20 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-0.5">Nombre (opcional)</label>
                  <input type="text" value={pvForm.nombre}
                    onChange={e => setPvForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Local principal"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <button disabled={!pvForm.numero || savingPv}
                  onClick={async () => {
                    if (!pvForm.numero) return
                    setSavingPv(true)
                    const { error } = await supabase.from('puntos_venta_afip').insert({
                      tenant_id: tenant!.id, numero: parseInt(pvForm.numero),
                      nombre: pvForm.nombre.trim() || null,
                    })
                    if (error) toast.error(error.message)
                    else { toast.success('Punto de venta agregado'); setPvForm({ numero: '', nombre: '' }); refetchPV() }
                    setSavingPv(false)
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-xl text-sm hover:bg-accent/90 disabled:opacity-50 transition-all">
                  <Plus size={14} /> Agregar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'facturacion' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100">
          {/* Header colapsable */}
          <button
            className="w-full flex items-center gap-3 px-5 py-4 text-left"
            onClick={() => setCertCollapsed(p => !p)}
          >
            <ShieldCheck size={18} className={tenantCert?.activo ? 'text-green-500' : 'text-gray-400 dark:text-gray-500'} />
            <span className="font-semibold text-gray-700 dark:text-gray-300 flex-1">Certificados AFIP</span>
            {tenantCert ? (
              tenantCert.activo ? (
                <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2.5 py-1 rounded-full font-medium">
                  ✅ Activo{tenantCert.fecha_validez_hasta ? ` hasta ${new Date(tenantCert.fecha_validez_hasta).toLocaleDateString('es-AR')}` : ''}
                </span>
              ) : (
                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2.5 py-1 rounded-full">Inactivo</span>
              )
            ) : (
              <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 px-2.5 py-1 rounded-full">❌ No cargado</span>
            )}
            {certCollapsed ? <ChevronRight size={16} className="text-gray-400 dark:text-gray-500 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />}
          </button>

          {!certCollapsed && (
            <div className="px-5 pb-5 space-y-4 border-t border-gray-100 dark:border-gray-700 pt-4">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Requerido para facturación electrónica con ARCA (ex-AFIP). Los archivos se almacenan encriptados y solo son accesibles desde tu cuenta.
              </p>

              {/* Estado actual */}
              {tenantCert && (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-sm space-y-1">
                  <p className="text-gray-600 dark:text-gray-300 font-medium">Certificado actual</p>
                  {tenantCert.cuit && <p className="text-xs text-gray-500 dark:text-gray-400">CUIT: <span className="font-mono">{tenantCert.cuit}</span></p>}
                  {tenantCert.fecha_validez_hasta && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Válido hasta:{' '}
                      <span className={new Date(tenantCert.fecha_validez_hasta) < new Date() ? 'text-red-500 font-medium' : 'text-green-600 dark:text-green-400 font-medium'}>
                        {new Date(tenantCert.fecha_validez_hasta).toLocaleDateString('es-AR')}
                      </span>
                    </p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Cargado el {new Date(tenantCert.created_at).toLocaleDateString('es-AR')}
                  </p>
                </div>
              )}

              {canEdit && (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {tenantCert ? 'Reemplazar certificado' : 'Cargar certificado'}
                  </p>

                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">CUIT *</label>
                    <input type="text" value={certCuit} onChange={e => setCertCuit(e.target.value)}
                      placeholder="20-12345678-9"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white font-mono" />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Fecha de validez (opcional)</label>
                    <input type="date" value={certValidez} onChange={e => setCertValidez(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                        <ShieldCheck size={11} /> Certificado (.crt) *
                      </label>
                      <label className={`flex items-center gap-2 px-3 py-2.5 border-2 border-dashed rounded-lg cursor-pointer transition-colors text-xs
                        ${certCrtFile ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                        <ShieldCheck size={14} />
                        <span className="truncate">{certCrtFile ? certCrtFile.name : 'Seleccionar .crt'}</span>
                        <input type="file" accept=".crt" className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0] ?? null
                            if (f && !f.name.endsWith('.crt')) { toast.error('Solo se aceptan archivos .crt'); return }
                            setCertCrtFile(f)
                          }} />
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                        <KeyRound size={11} /> Clave privada (.key) *
                      </label>
                      <label className={`flex items-center gap-2 px-3 py-2.5 border-2 border-dashed rounded-lg cursor-pointer transition-colors text-xs
                        ${certKeyFile ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                        <KeyRound size={14} />
                        <span className="truncate">{certKeyFile ? certKeyFile.name : 'Seleccionar .key'}</span>
                        <input type="file" accept=".key" className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0] ?? null
                            if (f && !f.name.endsWith('.key')) { toast.error('Solo se aceptan archivos .key'); return }
                            setCertKeyFile(f)
                          }} />
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button onClick={handleSaveCert}
                      disabled={savingCert || !certCrtFile || !certKeyFile || !certCuit.trim()}
                      className="px-5 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-2 transition-all">
                      <ShieldCheck size={14} />
                      {savingCert ? 'Guardando...' : tenantCert ? 'Reemplazar certificado' : 'Guardar certificados'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'inventario' && (
        <div className="space-y-4">
          {/* sub-tab nav */}
          <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
            {([
              { id: 'reglas' as InvSubTab, label: 'Reglas de stock', icon: Timer },
              { id: 'categorias' as InvSubTab, label: 'Categorías', icon: Tag },
              { id: 'ubicaciones' as InvSubTab, label: 'Ubicaciones', icon: MapPin },
              { id: 'estados' as InvSubTab, label: 'Estados', icon: CircleDot },
              { id: 'motivos' as InvSubTab, label: 'Motivos', icon: MessageSquare },
              { id: 'unidades' as InvSubTab, label: 'Unidades', icon: Ruler },
              { id: 'codigos' as InvSubTab, label: 'Códigos', icon: ScanBarcode },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setInvSubTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all whitespace-nowrap
                  ${invSubTab === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                <Icon size={14} />{label}
              </button>
            ))}
          </div>

          {invSubTab === 'codigos' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <CodigoPerfilesPanel />
            </div>
          )}

          {invSubTab === 'reglas' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Reglas de gestión de stock</h2>
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
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Permitir over-receipt</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Al recibir mercadería, permite ingresar más cantidad de la pedida en la OC. Genera alerta de excedente.</p>
                </div>
                <button type="button" disabled={!canEdit} onClick={() => setBizOverReceipt(p => !p)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none
                    ${bizOverReceipt ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'}
                    ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform
                    ${bizOverReceipt ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Trazabilidad de asignación de stock</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Registra de qué LPN/ubicación/serie se surtió cada unidad de cada venta, y si fue selección manual o automática. Permite seguir el rastro completo (recall, auditoría) desde Historial y el detalle de venta.</p>
                </div>
                <button type="button" disabled={!canEdit} onClick={() => setBizTrazaAsignacion((p: boolean) => !p)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none
                    ${bizTrazaAsignacion ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'}
                    ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform
                    ${bizTrazaAsignacion ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {canEdit && (
                <div className="flex justify-end">
                  <button onClick={handleSaveBiz} disabled={savingBiz}
                    className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                    {savingBiz ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              )}
            </div>
          )}

          {invSubTab === 'categorias' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Tag size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Categorías de productos</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{categorias.length} cargadas</span>
          </div>
          <ListaABM items={categorias} loading={loadingCat} withDescription onAdd={addCategoria} onUpdate={updateCategoria} onDelete={deleteCategoria} />
        </div>
          )}

          {invSubTab === 'ubicaciones' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Ubicaciones</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{ubicaciones.length} cargadas</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">La prioridad define el orden de rebaje: menor número = se descuenta primero. <ShoppingCart size={11} className="inline" /> = surtido POS · <span className="text-xs font-bold text-green-600">TN</span> = TiendaNube · <span className="text-xs font-bold text-yellow-500">ML</span> = MercadoLibre · <RotateCcw size={11} className="inline text-orange-500" /> = devoluciones. Cada ubicación puede tener dimensiones y tipo WMS opcionales (editando con <Pencil size={11} className="inline" />).</p>

          {/* Agregar nueva */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              <input type="text" placeholder="Nombre de la ubicación" value={newUbicNombre}
                onChange={e => setNewUbicNombre(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addUbicacion()}
                className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Prioridad" value={newUbicPrioridad}
                onChange={e => setNewUbicPrioridad(e.target.value)}
                title="Prioridad de rebaje (menor = primero)"
                className="w-24 flex-shrink-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              <button onClick={addUbicacion} disabled={!newUbicNombre.trim()}
                className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                <Plus size={15} /> Agregar
              </button>
            </div>
            <input type="text" placeholder="Descripción (opcional)" value={newUbicDesc}
              onChange={e => setNewUbicDesc(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
            {sucursales.length > 1 && (
              <select value={newUbicSucursalId} onChange={e => setNewUbicSucursalId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-primary">
                <option value="">Global (todas las sucursales)</option>
                {(sucursales as any[]).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            )}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400">
                <input type="checkbox" checked={newUbicMonoSku} onChange={e => setNewUbicMonoSku(e.target.checked)} className="w-3.5 h-3.5 rounded accent-accent" />
                <Tag size={11} /> Mono-SKU
              </label>
              <button type="button" onClick={() => setNewUbicWmsOpen(v => !v)}
                className="flex items-center gap-1 text-xs text-purple-500 dark:text-purple-400 hover:text-purple-700">
                <Ruler size={11} /> Dimensiones WMS
                <ChevronRight size={11} className={`transition-transform ${newUbicWmsOpen ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {newUbicWmsOpen && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <select value={newUbicTipo} onChange={e => setNewUbicTipo(e.target.value)}
                  className="col-span-3 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                  <option value="">Tipo de ubicación (opcional)</option>
                  <option value="picking">Picking</option>
                  <option value="bulk">Bulk / Reserva</option>
                  <option value="estiba">Estiba / Pallet rack</option>
                  <option value="camara">Cámara frigorífica</option>
                  <option value="cross_dock">Cross-dock</option>
                </select>
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Alto (cm)" value={newUbicAlto} onChange={e => setNewUbicAlto(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Ancho (cm)" value={newUbicAncho} onChange={e => setNewUbicAncho(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Largo (cm)" value={newUbicLargo} onChange={e => setNewUbicLargo(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Peso máx (kg)" value={newUbicPeso} onChange={e => setNewUbicPeso(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Cap. pallets" value={newUbicPallets} onChange={e => setNewUbicPallets(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent" />
              </div>
            )}
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
                        {/* Sucursal */}
                        {sucursales.length > 1 && (
                          <div className="flex items-center gap-2">
                            <Building2 size={13} className="text-muted flex-shrink-0" />
                            <select
                              value={editUbicSucursalId}
                              onChange={e => setEditUbicSucursalId(e.target.value)}
                              className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-xs focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-primary">
                              <option value="">Global (todas las sucursales)</option>
                              {(sucursales as any[]).map(s => (
                                <option key={s.id} value={s.id}>{s.nombre}</option>
                              ))}
                            </select>
                          </div>
                        )}
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
                        {/* Mono-SKU toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400 pt-1">
                          <input type="checkbox" checked={editUbicMonoSku} onChange={e => setEditUbicMonoSku(e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-accent" />
                          <Tag size={11} />
                          Mono-SKU (un solo producto en esta ubicación)
                        </label>
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
                          {u.mono_sku && (
                            <span className="ml-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded" title="Mono-SKU: solo un producto">
                              <Tag size={9} className="inline mb-0.5 mr-0.5" />Mono-SKU
                            </span>
                          )}
                          {sucursales.length > 1 && (
                            u.sucursal_id
                              ? <span className="ml-2 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1">
                                  <Building2 size={9} />{(sucursales as any[]).find(s => s.id === u.sucursal_id)?.nombre ?? u.sucursal_id}
                                </span>
                              : <span className="ml-2 text-xs bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded flex-shrink-0">Global</span>
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
                          onClick={() => toggleUbicTN(u)}
                          title={u.disponible_tn !== false ? 'Stock sincroniza a TiendaNube — click para excluir' : 'Excluida de TiendaNube — click para incluir'}
                          className={`p-1 transition-colors text-xs font-bold rounded ${u.disponible_tn !== false ? 'text-green-600 hover:text-gray-400' : 'text-gray-300 hover:text-green-600'}`}>
                          TN
                        </button>
                        <button
                          onClick={() => toggleUbicMELI(u)}
                          title={u.disponible_meli !== false ? 'Stock sincroniza a MercadoLibre — click para excluir' : 'Excluida de MercadoLibre — click para incluir'}
                          className={`p-1 transition-colors text-xs font-bold rounded ${u.disponible_meli !== false ? 'text-yellow-500 hover:text-gray-400' : 'text-gray-300 hover:text-yellow-500'}`}>
                          ML
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

          {invSubTab === 'estados' && (
        <div className="space-y-4">
          {/* Sub-tab navigation */}
          <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
            {([
              { id: 'estados' as EstadosSubTab, label: 'Estados', icon: CircleDot },
              { id: 'grupos' as EstadosSubTab, label: 'Grupos de estados', icon: Layers },
              { id: 'progresion' as EstadosSubTab, label: 'Progresión de estado', icon: Timer },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setEstadosSubTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all
                  ${estadosSubTab === id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                <Icon size={14} />{label}
              </button>
            ))}
          </div>

          {/* Sub-tab: Estados */}
          {estadosSubTab === 'estados' && (
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

              {/* Permisos por estado */}
              {estados.length > 0 && (
                <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-0.5">Permisos por estado</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      <ShoppingCart size={11} className="inline mr-0.5" /> = vendible · <Store size={11} className="inline mr-0.5" /> = TiendaNube · <span className="text-xs font-bold text-yellow-500">ML</span> = MercadoLibre · <RotateCcw size={11} className="inline mr-0.5 text-orange-500" /> = devoluciones
                    </p>
                  </div>

                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400">
                      <span>Estado</span>
                      <span className="w-8 text-center" title="Disponible para venta"><ShoppingCart size={13} /></span>
                      <span className="w-8 text-center" title="Sincroniza a TiendaNube"><Store size={13} /></span>
                      <span className="w-8 text-center text-yellow-500 font-bold" title="Sincroniza a MercadoLibre">ML</span>
                      <span className="w-8 text-center" title="Estado para devoluciones"><RotateCcw size={13} className="text-orange-500" /></span>
                    </div>

                    {(estados as any[]).map((e: any, i: number) => (
                      <div key={e.id}
                        className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-2.5 items-center ${i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-700/30'}`}>
                        {/* Nombre con color */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{e.nombre}</span>
                        </div>

                        {/* Toggle venta */}
                        <button
                          onClick={() => toggleDisponibleVenta(e.id, !e.es_disponible_venta)}
                          title={e.es_disponible_venta !== false ? 'Habilitado para venta — click para bloquear' : 'Bloqueado para venta — click para habilitar'}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${e.es_disponible_venta !== false
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200'}`}>
                          <ShoppingCart size={14} />
                        </button>

                        {/* Toggle TN */}
                        <button
                          onClick={() => toggleDisponibleTN(e.id, !e.es_disponible_tn)}
                          title={e.es_disponible_tn !== false ? 'Sincroniza a TN — click para excluir' : 'Excluido de TN — click para incluir'}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${e.es_disponible_tn !== false
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200'}`}>
                          <Store size={14} />
                        </button>

                        {/* Toggle MELI */}
                        <button
                          onClick={() => toggleDisponibleMELI(e.id, !e.es_disponible_meli)}
                          title={e.es_disponible_meli !== false ? 'Sincroniza a ML — click para excluir' : 'Excluido de ML — click para incluir'}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${e.es_disponible_meli !== false
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200'}`}>
                          ML
                        </button>

                        {/* Toggle devolución */}
                        <button
                          onClick={() => setEstadoDevolucion(e.es_devolucion ? '' : e.id)}
                          title={e.es_devolucion ? 'Estado de devolución activo — click para quitar' : 'Marcar como estado de devoluciones'}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${e.es_devolucion
                            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200'}`}>
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sub-tab: Grupos de estados */}
          {estadosSubTab === 'grupos' && (
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

          {/* Sub-tab: Progresión de estado (ex Aging Profiles) */}
          {estadosSubTab === 'progresion' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <Timer size={18} className="text-accent" />
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Progresión de estado</h2>
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{agingProfiles.length} perfiles</span>
                <button onClick={processAging} disabled={processingAging}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs font-medium rounded-lg transition-all disabled:opacity-50">
                  <Play size={12} /> {processingAging ? 'Procesando...' : 'Procesar ahora'}
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
                    placeholder="Nombre del perfil (ej: DISP-365)"
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
                    <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay perfiles. Creá uno para empezar.</p>
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
                              <button
                                onClick={e => { e.stopPropagation(); processAgingProfile(ap.id, ap.nombre) }}
                                disabled={processingAgingId === ap.id || processingAging}
                                title="Procesar solo este perfil ahora"
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 rounded-lg transition-colors disabled:opacity-50 mr-1">
                                <Play size={10} /> {processingAgingId === ap.id ? 'Procesando...' : 'Procesar'}
                              </button>
                              <button onClick={e => { e.stopPropagation(); setEditAgingId(ap.id); setEditAgingNombre(ap.nombre) }} className="text-gray-400 dark:text-gray-500 hover:text-accent p-1"><Pencil size={13} /></button>
                              <button onClick={e => { e.stopPropagation(); deleteAgingProfile(ap.id) }} className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1"><Trash2 size={13} /></button>
                            </>
                          )}
                        </div>

                        {expanded && (
                          <div className="p-4 space-y-3">
                            {reglas.length === 0 && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Sin reglas. Agregá al menos una para activar la progresión.</p>
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
        </div>
          )}

          {invSubTab === 'motivos' && (
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

          {invSubTab === 'unidades' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Ruler size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Unidades de medida personalizadas</h2>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Definí unidades propias de tu negocio para usarlas en productos (además de las estándar).</p>

          {/* Agregar */}
          {canEdit && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-2">
              <div className="flex gap-2">
                <input type="text" placeholder="Nombre *" value={udmNombre} onChange={e => setUdmNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addUdm()}
                  className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
                <input type="text" placeholder="Símbolo (ej: pz)" value={udmSimbolo} onChange={e => setUdmSimbolo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addUdm()}
                  className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
                <button onClick={addUdm} disabled={!udmNombre.trim() || udmSaving}
                  className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                  <Plus size={15} /> Agregar
                </button>
              </div>
            </div>
          )}

          {loadingUdm ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : unidadesMedida.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-8">No hay unidades personalizadas aún</p>
          ) : (
            <div className="space-y-2">
              {(unidadesMedida as any[]).map((u: any) => (
                <div key={u.id} className="bg-white dark:bg-gray-800 border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3">
                  {udmEditId === u.id ? (
                    <>
                      <div className="flex-1 flex gap-2">
                        <input type="text" value={udmEditNombre} onChange={e => setUdmEditNombre(e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-accent rounded-lg text-sm focus:outline-none" />
                        <input type="text" value={udmEditSimbolo} onChange={e => setUdmEditSimbolo(e.target.value)}
                          placeholder="Símbolo"
                          className="w-28 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none" />
                      </div>
                      <button onClick={() => updateUdm(u.id)} disabled={udmSaving}
                        className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:bg-green-900/20 rounded-lg transition-colors">
                        <Check size={16} />
                      </button>
                      <button onClick={() => setUdmEditId(null)}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{u.nombre}</p>
                        {u.simbolo && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Símbolo: {u.simbolo}</p>}
                      </div>
                      {u.predefinida
                        ? <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded" title="Unidad predefinida del sistema — no eliminable"><Lock size={11} />Predefinida</span>
                        : canEdit && (
                          <>
                            <button onClick={() => { setUdmEditId(u.id); setUdmEditNombre(u.nombre); setUdmEditSimbolo(u.simbolo ?? '') }}
                              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors">
                              <Pencil size={15} />
                            </button>
                            <button onClick={() => deleteUdm(u.id)}
                              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg transition-colors">
                              <Trash2 size={15} />
                            </button>
                          </>
                        )
                      }
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
          )}

        </div>
      )}

      {/* ── ENVÍOS ──────────────────────────────────────────────────────────── */}
      {tab === 'envios' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Navigation size={18} className="text-accent" /> Configuración de envíos
            </h2>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">$ por km — valor global (todas las sucursales)</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} value={bizCostoKm}
                onChange={e => setBizCostoKm(e.target.value)} placeholder="Ej: 150" min="0" step="0.01" disabled={!canEdit}
                className="w-36 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              <p className="text-xs text-gray-400 dark:text-gray-500">Default global. Si una sucursal tiene su propio $/km en Sucursales, ese valor predomina.</p>
            </div>
            {canEdit && (
              <div className="flex justify-end">
                <button onClick={handleSaveBiz} disabled={savingBiz}
                  className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                  {savingBiz ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            )}
          </div>

          {/* ISS-178 — Rangos horarios de entrega */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Clock size={18} className="text-accent" /> Rangos horarios para entrega
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
              El operador elige uno de estos rangos al cargar el envío en una venta. Defaults: 8-13 / 13-18 / 18-22. Editables y eliminables.
            </p>
            <div className="space-y-2">
              {bizEnvioRangos.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" value={r.desde} disabled={!canEdit}
                    onChange={e => setBizEnvioRangos(arr => arr.map((x, j) => j === i ? { ...x, desde: e.target.value } : x))}
                    className="w-28 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                  <span className="text-gray-400">a</span>
                  <input type="time" value={r.hasta} disabled={!canEdit}
                    onChange={e => setBizEnvioRangos(arr => arr.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))}
                    className="w-28 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                  <span className="text-xs text-gray-400 ml-1">
                    {r.desde && r.hasta ? `${r.desde} – ${r.hasta}` : 'incompleto'}
                  </span>
                  {canEdit && (
                    <button onClick={() => setBizEnvioRangos(arr => arr.filter((_, j) => j !== i))}
                      className="ml-auto text-red-500 hover:text-red-700 text-xs">
                      Eliminar
                    </button>
                  )}
                </div>
              ))}
              {bizEnvioRangos.length === 0 && (
                <p className="text-xs text-gray-400 italic">Sin rangos cargados. El selector de rango en el modal de envío quedará deshabilitado.</p>
              )}
            </div>
            {canEdit && (
              <div className="flex justify-between items-center pt-1">
                <button
                  onClick={() => setBizEnvioRangos(arr => [...arr, { desde: '', hasta: '' }])}
                  className="text-xs text-accent hover:underline"
                >
                  + Agregar rango
                </button>
                <button onClick={handleSaveBiz} disabled={savingBiz}
                  className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                  {savingBiz ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            )}
          </div>

          {canEdit && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <span className="text-lg">💬</span> Plantilla WhatsApp — Coordinar entregas
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Plantilla para el botón "Coordinar por WhatsApp" en el módulo de Envíos. Variables: <span className="font-mono text-accent">{'{{Nombre_Cliente}}'}</span> <span className="font-mono text-accent">{'{{Nombre_Negocio}}'}</span> <span className="font-mono text-accent">{'{{Numero_Orden}}'}</span> <span className="font-mono text-accent">{'{{Tracking}}'}</span> <span className="font-mono text-accent">{'{{Courier}}'}</span> <span className="font-mono text-accent">{'{{Fecha_Entrega}}'}</span>
              </p>
              <textarea value={bizWAPlantilla} onChange={e => setBizWAPlantilla(e.target.value)}
                rows={5} placeholder={`Hola {{Nombre_Cliente}}! Somos {{Nombre_Negocio}}.\n\nTu pedido #{{Numero_Orden}} está en camino.\n🚚 Courier: {{Courier}}\n📅 Fecha: {{Fecha_Entrega}}`}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-y bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-mono" />
              <div className="flex justify-end">
                <button onClick={handleSaveBiz} disabled={savingBiz}
                  className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                  {savingBiz ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ TAB: GASTOS (v1.8.42) ═══════════ */}
      {tab === 'gastos' && (
        <div className="space-y-4">
          {/* Reglas de comprobante */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Receipt size={18} className="text-accent" /> Cuándo es obligatorio adjuntar comprobante
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">
              Activá <strong>una</strong> regla para exigir comprobante en esos gastos. Sin ninguna regla activa, no se solicitará comprobante obligatorio.
            </p>

            {[
              { v: gCompSiempre,     s: setGCompSiempre,     label: 'Siempre obligatorio',                       desc: 'Todo gasto pide comprobante. Default activo.' },
              { v: gCompSiIva,       s: setGCompSiIva,       label: 'Si el gasto deduce IVA',                    desc: 'iva_deducible o conciliado_iva marcados.' },
              { v: gCompSiGanancias, s: setGCompSiGanancias, label: 'Si deduce ganancias o es gasto del negocio', desc: 'deduce_ganancias o gasto_negocio marcados.' },
              { v: gCompSiMonto,     s: setGCompSiMonto,     label: 'Si supera un monto umbral',                  desc: 'Solo se pide comprobante por arriba del monto definido.' },
            ].map((r, i, arr) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <button onClick={() => { if (!canEdit) return; const newVal = !r.v; arr.forEach((x, j) => x.s(j === i ? newVal : false)) }} disabled={!canEdit} className="flex-shrink-0 mt-0.5">
                  {r.v ? <ToggleRight size={26} className="text-accent" /> : <ToggleLeft size={26} className="text-gray-300 dark:text-gray-600" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-700 dark:text-gray-200 text-sm">{r.label}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{r.desc}</p>
                </div>
              </div>
            ))}

            {gCompSiMonto && (
              <div className="flex items-center gap-3 pl-12">
                <label className="text-sm text-gray-700 dark:text-gray-300">Monto umbral:</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={gCompMontoUmbral}
                  onChange={e => setGCompMontoUmbral(e.target.value)} placeholder="Ej: 50000" min="0" step="0.01" disabled={!canEdit}
                  className="w-40 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                <span className="text-xs text-gray-400">A partir de este monto, se exigirá comprobante</span>
              </div>
            )}
          </div>

          {/* Alertas */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Bell size={18} className="text-accent" /> Alertas
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Días para alertar gastos en Borrador</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={gDiasAlertaBorrador}
                  onChange={e => setGDiasAlertaBorrador(e.target.value)} min="1" max="365" disabled={!canEdit}
                  className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si un gasto sin medio de pago lleva más de N días, alerta al DUEÑO + SUPERVISOR.</p>
              </div>
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Días para alertar Anticipo en OC sin recibir</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={gDiasAlertaAnticipo}
                  onChange={e => setGDiasAlertaAnticipo(e.target.value)} min="1" max="365" disabled={!canEdit}
                  className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si una OC tiene anticipo (pago hecho) y pasaron N días sin recibir mercadería, el badge se pone en rojo.</p>
              </div>
            </div>
            {canEdit && (
              <div className="flex justify-end pt-2">
                <button onClick={handleSaveGastosCfg} disabled={savingGastosCfg}
                  className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                  {savingGastosCfg ? 'Guardando...' : 'Guardar reglas'}
                </button>
              </div>
            )}
          </div>

          {/* Categorías de gasto */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Tag size={18} className="text-accent" /> Categorías de gasto
              <span className="ml-auto text-xs text-gray-400">{(categoriasGasto as any[]).filter((c: any) => c.activo).length} activas / {(categoriasGasto as any[]).length} total</span>
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">
              Las predefinidas no se pueden eliminar (sólo desactivar). Las categorías con <strong>sucursal obligatoria</strong> exigen elegir sucursal al cargar el gasto.
            </p>

            {canEdit && (
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-3 flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nombre de la nueva categoría</label>
                  <input type="text" value={newCategoria.nombre}
                    onChange={e => setNewCategoria(c => ({ ...c, nombre: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addCategoriaGasto() }}
                    placeholder="Ej: Suscripciones de software"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100" />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  <input type="checkbox" checked={newCategoria.requiere_sucursal}
                    onChange={e => setNewCategoria(c => ({ ...c, requiere_sucursal: e.target.checked }))}
                    className="rounded border-gray-300 dark:border-gray-600 text-accent focus:ring-accent" />
                  Sucursal obligatoria
                </label>
                <button onClick={addCategoriaGasto}
                  className="px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-xl flex items-center gap-1 justify-center">
                  <Plus size={14} /> Agregar
                </button>
              </div>
            )}

            {loadingCatGasto ? (
              <p className="text-sm text-gray-400">Cargando…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
                      <th className="py-2 px-2 font-medium">Nombre</th>
                      <th className="py-2 px-2 font-medium text-center">Sucursal oblig.</th>
                      <th className="py-2 px-2 font-medium text-center">Activa</th>
                      <th className="py-2 px-2 font-medium text-center">Origen</th>
                      <th className="py-2 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(categoriasGasto as any[]).map((c: any) => (
                      <tr key={c.id} className={`border-b border-gray-50 dark:border-gray-700/50 ${!c.activo ? 'opacity-50' : ''}`}>
                        <td className="py-2 px-2 text-gray-700 dark:text-gray-200">{c.nombre}</td>
                        <td className="py-2 px-2 text-center">
                          <button onClick={() => canEdit && toggleCategoriaGastoRequiereSucursal(c.id, c.requiere_sucursal)} disabled={!canEdit}
                            title={c.requiere_sucursal ? 'Sucursal obligatoria' : 'Sucursal opcional'}>
                            {c.requiere_sucursal
                              ? <ToggleRight size={22} className="text-accent" />
                              : <ToggleLeft size={22} className="text-gray-300 dark:text-gray-600" />}
                          </button>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button onClick={() => canEdit && toggleCategoriaGastoActivo(c.id, c.activo)} disabled={!canEdit}
                            title={c.activo ? 'Desactivar' : 'Activar'}>
                            {c.activo
                              ? <ToggleRight size={22} className="text-green-500" />
                              : <ToggleLeft size={22} className="text-gray-300 dark:text-gray-600" />}
                          </button>
                        </td>
                        <td className="py-2 px-2 text-center">
                          {c.predefinida
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/20 text-accent">Predefinida</span>
                            : <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">Custom</span>}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {canEdit && !c.predefinida && (
                            <button onClick={() => deleteCategoriaGasto(c.id, c.predefinida)}
                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

          {/* Descuentos y combos */}
          {tab === 'ventas' && ventasSubTab === 'descuentos' && (
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
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Nuevo combo</p>
              <div className="flex gap-1">
                {(['3x2','2x1','2da'] as const).map(p => (
                  <button key={p} onClick={() => applyComboPreset(p)} title={p === '2da' ? '2da unidad X% off' : p}
                    className="px-2 py-0.5 text-xs rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50">
                    {p === '2da' ? '2da ud.' : p}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <input type="text" value={comboForm.nombre} onChange={e => setComboForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Nombre del combo (ej: 3x Coca-Cola 10% off)"
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>

              {/* Productos del combo */}
              <div className="col-span-2 space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">Productos del combo</p>
                {comboItems.map((ci, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select value={ci.producto_id} onChange={e => setComboItems(prev => prev.map((x,i) => i===idx ? {...x, producto_id: e.target.value} : x))}
                      className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                      <option value="">Seleccionar producto...</option>
                  {(productosAll as any[]).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>
                  ))}
                </select>
                <input type="number" onWheel={e => e.currentTarget.blur()} min="1" value={ci.cantidad}
                  onChange={e => setComboItems(prev => prev.map((x,i) => i===idx ? {...x, cantidad: e.target.value} : x))}
                  placeholder="Cant." className="w-16 px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent text-center" />
                {comboItems.length > 1 && (
                  <button onClick={() => setComboItems(prev => prev.filter((_,i) => i!==idx))}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg" title="Quitar">
                    <X size={13} />
                  </button>
                )}
              </div>
              ))}
              <button onClick={() => setComboItems(prev => [...prev, { producto_id: '', cantidad: '1' }])}
                className="text-xs text-accent hover:underline flex items-center gap-1">
                <Plus size={12} /> Agregar producto al combo
              </button>
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
                      {(c.combo_items ?? []).map((ci: any, i: number) => (
                        <span key={i}>{i > 0 ? ' + ' : ''}{ci.productos?.nombre ?? '?'} ×{ci.cantidad}</span>
                      ))} ·{' '}
                      {(c.descuento_tipo ?? 'pct') === 'pct'
                        ? `${c.descuento_pct}% off`
                        : (c.descuento_tipo === 'monto_usd' ? `USD ${c.descuento_monto} off` : `$${c.descuento_monto} off`)}
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
      {tab === 'ventas' && ventasSubTab === 'metodos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Métodos de pago</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{metodosPago.length} método{metodosPago.length !== 1 ? 's' : ''}</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Personalizá los métodos de cobro disponibles en ventas y caja. El color se usa en gráficos del dashboard.
          </p>

          {loadingMetodos ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Cargando...</p>
          ) : (
            <div className="space-y-2">
              {(metodosPago as any[]).map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                  {editMetodoId === m.id ? (
                    <>
                      <input type="color" value={editMetodoData.color}
                        onChange={e => setEditMetodoData(p => ({ ...p, color: e.target.value }))}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0 flex-shrink-0" />
                      <input type="text" value={editMetodoData.nombre}
                        onChange={e => setEditMetodoData(p => ({ ...p, nombre: e.target.value }))}
                        className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                      <div className="flex items-center gap-1 shrink-0">
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="50" step="0.1"
                          value={editMetodoData.comision_pct}
                          onChange={e => setEditMetodoData(p => ({ ...p, comision_pct: e.target.value }))}
                          placeholder="0"
                          className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-center focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                        <span className="text-xs text-gray-400 dark:text-gray-500">%</span>
                      </div>
                      <select
                        value={editMetodoData.cuenta_origen_id || ''}
                        onChange={e => setEditMetodoData(p => ({ ...p, cuenta_origen_id: e.target.value || null }))}
                        title="Cuenta donde se acredita este método"
                        className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white shrink-0">
                        <option value="">— sin cuenta —</option>
                        {(cuentasOrigen as any[]).filter(c => c.activo).map(c => (
                          <option key={c.id} value={c.id}>{c.nombre}</option>
                        ))}
                      </select>
                      <button onClick={() => updateMetodoPago.mutate(m.id)} disabled={updateMetodoPago.isPending}
                        className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors">
                        <Check size={15} />
                      </button>
                      <button onClick={() => setEditMetodoId(null)}
                        className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200 dark:border-gray-600" style={{ backgroundColor: m.color }} />
                      <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-100">{m.nombre}</span>
                      {(m.comision_pct > 0) && (
                        <span className="text-xs px-1.5 py-0.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 rounded font-mono" title="Comisión de la plataforma">
                          {m.comision_pct}%
                        </span>
                      )}
                      {m.cuenta_origen_id && (() => {
                        const co = (cuentasOrigen as any[]).find(c => c.id === m.cuenta_origen_id)
                        return co ? (
                          <span className="text-xs px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded" title={`Acredita en: ${co.nombre}`}>
                            → {co.nombre}
                          </span>
                        ) : null
                      })()}
                      {m.es_sistema && <span className="text-xs text-gray-400 dark:text-gray-500 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">sistema</span>}
                      <button onClick={() => toggleMetodoPago.mutate({ id: m.id, activo: !m.activo })}
                        title={m.activo ? 'Deshabilitar' : 'Habilitar'}
                        className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${m.activo ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                        {m.activo ? 'Activo' : 'Inactivo'}
                      </button>
                      <button onClick={() => canEdit && toggleMetodoPagoFlag.mutate({ id: m.id, field: 'habilitado_ventas', value: !(m.habilitado_ventas ?? true) })}
                        title={(m.habilitado_ventas ?? true) ? 'Quitar del POS' : 'Habilitar en POS'}
                        className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${(m.habilitado_ventas ?? true) ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 hover:bg-blue-100' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                        POS
                      </button>
                      <button onClick={() => canEdit && toggleMetodoPagoFlag.mutate({ id: m.id, field: 'habilitado_gastos', value: !(m.habilitado_gastos ?? true) })}
                        title={(m.habilitado_gastos ?? true) ? 'Quitar de Gastos' : 'Habilitar en Gastos'}
                        className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${(m.habilitado_gastos ?? true) ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 hover:bg-purple-100' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                        Gastos
                      </button>
                      <button onClick={() => { setEditMetodoId(m.id); setEditMetodoData({ nombre: m.nombre, color: m.color, comision_pct: m.comision_pct ? String(m.comision_pct) : '', cuenta_origen_id: m.cuenta_origen_id ?? '' }) }}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors">
                        <Pencil size={14} />
                      </button>
                      {!m.es_sistema && (
                        <button onClick={() => { if (confirm('¿Eliminar este método?')) deleteMetodoPago.mutate(m.id) }}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Agregar método personalizado */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Agregar método personalizado</p>
            <div className="flex gap-2">
              <input type="color" value={nuevoMetodo.color}
                onChange={e => setNuevoMetodo(p => ({ ...p, color: e.target.value }))}
                className="w-10 h-10 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-600 p-0.5 flex-shrink-0" />
              <input type="text" value={nuevoMetodo.nombre}
                onChange={e => setNuevoMetodo(p => ({ ...p, nombre: e.target.value }))}
                placeholder="Ej: Cripto, Cheque..."
                onKeyDown={e => e.key === 'Enter' && addMetodoPago.mutate()}
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
              <button onClick={() => addMetodoPago.mutate()}
                disabled={!nuevoMetodo.nombre.trim() || addMetodoPago.isPending}
                className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-medium disabled:opacity-40 flex items-center gap-1.5">
                <Plus size={14} /> Agregar
              </button>
            </div>
          </div>

          {/* ISS-086: Cuotas por banco — Tarjeta de crédito */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cuotas por banco (Tarjeta de crédito)</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Configurá los planes de cuotas que ofrecés con cada banco. Las cuotas sin interés se muestran en verde al cobrar con tarjeta.</p>

            {cuotasBancos.map((banco) => (
              <div key={banco.id} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50">
                  <span className="font-medium text-sm text-gray-800 dark:text-gray-100 flex-1">{banco.nombre}</span>
                  <button onClick={() => setEditBancoId(editBancoId === banco.id ? null : banco.id)}
                    className="text-xs text-accent hover:underline">
                    {editBancoId === banco.id ? 'Cerrar' : 'Editar cuotas'}
                  </button>
                  <button onClick={() => saveCuotasBancos(cuotasBancos.filter(b => b.id !== banco.id))}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                </div>

                {/* Cuotas del banco */}
                <div className="px-4 py-2 flex flex-wrap gap-2">
                  {banco.cuotas.map((c, ci) => (
                    <span key={ci} className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${c.sin_interes ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                      {c.cant}x {c.sin_interes ? 'sin interés' : `+${c.interes}%`}
                      {editBancoId === banco.id && (
                        <button onClick={() => saveCuotasBancos(cuotasBancos.map(b => b.id === banco.id ? { ...b, cuotas: b.cuotas.filter((_, i) => i !== ci) } : b))}
                          className="ml-0.5 text-gray-400 hover:text-red-500"><X size={10} /></button>
                      )}
                    </span>
                  ))}
                </div>

                {/* Agregar cuota */}
                {editBancoId === banco.id && (
                  <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                    <input type="number" min="1" value={nuevaCuota.cant} onChange={e => setNuevaCuota(p => ({ ...p, cant: e.target.value }))}
                      placeholder="Cuotas" className="w-20 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                    <input type="number" min="0" step="0.1" value={nuevaCuota.interes} onChange={e => setNuevaCuota(p => ({ ...p, interes: e.target.value }))}
                      placeholder="Interés %" className="w-24 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                      <input type="checkbox" checked={nuevaCuota.sin_interes} onChange={e => setNuevaCuota(p => ({ ...p, sin_interes: e.target.checked, interes: e.target.checked ? '0' : p.interes }))}
                        className="accent-green-500" /> Sin interés
                    </label>
                    <button onClick={() => {
                      const cant = parseInt(nuevaCuota.cant)
                      if (!cant || cant < 1) { toast.error('Ingresá la cantidad de cuotas'); return }
                      const interes = parseFloat(nuevaCuota.interes) || 0
                      const updated = cuotasBancos.map(b => b.id === banco.id
                        ? { ...b, cuotas: [...b.cuotas, { cant, sin_interes: nuevaCuota.sin_interes, interes }].sort((a, b) => a.cant - b.cant) }
                        : b)
                      saveCuotasBancos(updated)
                      setNuevaCuota({ cant: '', interes: '', sin_interes: false })
                    }} className="px-3 py-1.5 bg-accent hover:bg-accent/90 text-white rounded-lg text-xs font-medium flex items-center gap-1">
                      <Plus size={12} /> Agregar cuota
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Agregar banco */}
            <div className="flex gap-2">
              <input type="text" value={nuevoBancoNombre} onChange={e => setNuevoBancoNombre(e.target.value)}
                placeholder="Ej: Banco Galicia, Santander..."
                onKeyDown={e => {
                  if (e.key === 'Enter' && nuevoBancoNombre.trim()) {
                    saveCuotasBancos([...cuotasBancos, { id: crypto.randomUUID(), nombre: nuevoBancoNombre.trim(), cuotas: [] }])
                    setNuevoBancoNombre('')
                  }
                }}
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
              <button onClick={() => {
                if (!nuevoBancoNombre.trim()) return
                saveCuotasBancos([...cuotasBancos, { id: crypto.randomUUID(), nombre: nuevoBancoNombre.trim(), cuotas: [] }])
                setNuevoBancoNombre('')
              }} className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-medium flex items-center gap-1.5">
                <Plus size={14} /> Agregar banco
              </button>
            </div>
          </div>
        </div>
      )}

          {/* Operativa sub-tab */}
          {tab === 'ventas' && ventasSubTab === 'operativa' && (
            <div className="space-y-4">
              {/* Presupuesto */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Documentos</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Validez de presupuesto (días)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="365" value={bizPresupuestoValidez} disabled={!canEdit}
                    onChange={e => setBizPresupuestoValidez(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Un presupuesto creado hoy expirará en esta cantidad de días. Se muestra en el ticket de presupuesto.</p>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                )}
              </div>

              {/* Reservas (E1/E2/E6) */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Reservas</h2>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={bizReservaSenaObligatoria} disabled={!canEdit}
                    onChange={e => setBizReservaSenaObligatoria(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-accent" />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Exigir seña para reservar</span>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Si está activo, no se puede crear una reserva sin cobrar una seña.</p>
                  </div>
                </label>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Seña mínima (% del total)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.5"
                    value={bizReservaSenaMinimaPct} disabled={!canEdit || !bizReservaSenaObligatoria}
                    onChange={e => setBizReservaSenaMinimaPct(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">0 = cualquier seña mayor a cero. Ej: 30 exige al menos el 30% del total al reservar.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vencimiento de reserva (días)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="365"
                    value={bizReservaVencimientoDias} disabled={!canEdit} placeholder="Sin vencimiento"
                    onChange={e => setBizReservaVencimientoDias(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Vacío = sin vencimiento. Pasados estos días sin despachar, <span className="font-medium">el inventario reservado se libera automáticamente</span> y la reserva se cancela.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Penalidad al cancelar (% de la seña)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.5"
                    value={bizReservaPenalidadPct} disabled={!canEdit}
                    onChange={e => setBizReservaPenalidadPct(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">0 = sin penalidad (se devuelve la seña completa). Ej: 10 retiene el 10% de la seña al cancelar.</p>
                </div>

                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                )}
              </div>

              {/* Cliente en POS */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Cliente en el punto de venta</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">¿Cuándo se requiere seleccionar cliente?</label>
                  <select value={bizClienteObligatorio} disabled={!canEdit}
                    onChange={e => setBizClienteObligatorio(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="nunca">Nunca (siempre opcional)</option>
                    <option value="reservas">Solo en reservas</option>
                    <option value="siempre">Siempre obligatorio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Datos mínimos requeridos</label>
                  <select value={bizClienteDatosMinimos} disabled={!canEdit}
                    onChange={e => setBizClienteDatosMinimos(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="nombre">Solo nombre</option>
                    <option value="nombre_dni">Nombre + DNI</option>
                    <option value="nombre_dni_email">Nombre + DNI + Email</option>
                    <option value="todos">Todos los datos</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Permitir "Consumidor Final"</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Habilita vender sin identificar al cliente (genérico).</p>
                  </div>
                  <button type="button" disabled={!canEdit} onClick={() => setBizClienteConsumidorFinal(v => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${bizClienteConsumidorFinal ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${bizClienteConsumidorFinal ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Crear cliente inline desde el POS</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Permite agregar un cliente nuevo directamente desde la pantalla de venta.</p>
                  </div>
                  <button type="button" disabled={!canEdit} onClick={() => setBizClienteCreacionInline(v => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${bizClienteCreacionInline ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${bizClienteCreacionInline ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Descuentos sub-tab — descuento máx cajero/supervisor */}
          {tab === 'ventas' && ventasSubTab === 'descuentos' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Límites de descuento por rol</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Define el máximo porcentaje de descuento que cada rol puede aplicar en una venta sin requerir autorización.
                  Si el descuento supera el límite, el POS solicitará aprobación de un supervisor/dueño.
                  Dejá el campo vacío para no poner límite.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descuento máximo — CAJERO (%)</label>
                    <div className="flex items-center gap-2">
                      <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.5"
                        value={bizDescuentoMaxCajero} disabled={!canEdit}
                        onChange={e => setBizDescuentoMaxCajero(e.target.value)}
                        placeholder="Sin límite"
                        className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">%</span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Aplica al rol CAJERO. Superar este % requiere autorización.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descuento máximo — SUPERVISOR (%)</label>
                    <div className="flex items-center gap-2">
                      <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.5"
                        value={bizDescuentoMaxSupervisor} disabled={!canEdit}
                        onChange={e => setBizDescuentoMaxSupervisor(e.target.value)}
                        placeholder="Sin límite"
                        className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">%</span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Aplica al rol SUPERVISOR. El DUEÑO nunca tiene límite.</p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar límites'}
                    </button>
                  </div>
                )}
              </div>

              {/* Combos (existente) — se muestra debajo */}
            </div>
          )}

      {tab === 'conectividad' && (
        <div className="space-y-4">
          <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
            {([
              { id: 'integraciones' as ConSubTab, label: 'Integraciones', icon: Plug },
              { id: 'api' as ConSubTab, label: 'API', icon: Key },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setConSubTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all
                  ${conSubTab === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                <Icon size={14} />{label}
              </button>
            ))}
          </div>

          {conSubTab === 'integraciones' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Plug size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Integraciones externas</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Conectá cada sucursal con sus cuentas externas. Los tokens se guardan de forma segura y nunca son visibles en la interfaz.
          </p>

          {/* ── TiendaNube ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#95BF47]/10 flex items-center justify-center flex-shrink-0">
                <Store size={16} className="text-[#95BF47]" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">TiendaNube</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Sincronización de stock y recepción de órdenes</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={forceSyncTN} disabled={tnSyncing}
                  title="Forzar sync de stock ahora"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#95BF47]/10 hover:bg-[#95BF47]/20 text-[#5a8a1a] dark:text-[#95BF47] rounded-lg font-medium disabled:opacity-50 transition-colors">
                  {tnSyncing ? '...' : '↑ Sync stock'}
                </button>
                <button disabled title="Próximamente: sincronizar catálogo completo a TiendaNube"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-400 rounded-lg font-medium cursor-not-allowed">
                  📦 Sync productos
                </button>
              </div>
            </div>

            {!import.meta.env.VITE_TN_APP_ID && (
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5">
                <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Falta configurar <code className="bg-amber-100 dark:bg-amber-800/40 px-1 rounded">VITE_TN_APP_ID</code> en las variables de entorno.
                </p>
              </div>
            )}

            {tnLoading ? (
              <p className="text-sm text-gray-400 text-center py-2">Cargando...</p>
            ) : sucursales.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">Primero configurá al menos una sucursal</p>
            ) : (
              <div className="space-y-2">
                {sucursales.filter(s => s.activo).map(suc => {
                  const cred = (tnCreds as any[]).find((c: any) => c.sucursal_id === suc.id)
                  return (
                    <div key={suc.id} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                      {/* Fila sucursal */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{suc.nombre}</p>
                          {cred && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                              {cred.store_name || `Store ID: ${cred.store_id}`}
                              {cred.store_url && ` · ${cred.store_url}`}
                            </p>
                          )}
                        </div>
                        {cred?.conectado ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setTnMapExpanded(tnMapExpanded === suc.id ? null : suc.id)}
                              className="flex items-center gap-1 text-xs text-[#95BF47] hover:text-[#7ea83a] font-medium transition-colors">
                              Productos {tnMapExpanded === suc.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                              <CheckCircle2 size={13} /> Conectada
                            </span>
                            <button
                              onClick={() => { if (confirm(`¿Desconectar TiendaNube de ${suc.nombre}?`)) desconectarTN.mutate(cred.id) }}
                              disabled={desconectarTN.isPending}
                              title="Desconectar"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                              <Unplug size={14} />
                            </button>
                          </div>
                        ) : (
                          (() => {
                            const tnUrl = getTnOAuthUrl(suc.id)
                            return tnUrl ? (
                              <a href={tnUrl}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#95BF47] hover:bg-[#7ea83a] text-white rounded-lg font-medium transition-colors">
                                <Plug size={12} /> Conectar
                              </a>
                            ) : (
                              <span className="text-xs text-gray-400 dark:text-gray-500 italic">Falta VITE_TN_APP_ID</span>
                            )
                          })()
                        )}
                      </div>

                      {/* Mapeo de productos — colapsable */}
                      {cred?.conectado && tnMapExpanded === suc.id && (
                        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 space-y-3">
                          {/* Mappings existentes */}
                          {(tnMap as any[]).filter((m: any) => m.sucursal_id === suc.id).map((m: any) => (
                            <div key={m.id} className="flex items-center gap-2 text-xs">
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-gray-700 dark:text-gray-300">{m.productos?.nombre ?? m.producto_id}</span>
                                <span className="text-gray-400 dark:text-gray-500 ml-1">({m.productos?.sku})</span>
                                <span className="text-gray-400 dark:text-gray-500 ml-1">→ TN {m.tn_product_id}/{m.tn_variant_id}</span>
                                {m.sync_stock && <span className="ml-1 text-green-500">● sync</span>}
                                {m.ultimo_sync_at && <span className="text-gray-400 dark:text-gray-500 ml-1">· {new Date(m.ultimo_sync_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                              </div>
                              <button onClick={() => deleteTnMap.mutate(m.id)} title="Eliminar" className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}

                          {/* Formulario nuevo mapeo */}
                          {tnMapForm ? (
                            <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                              <select value={tnMapForm.productoId}
                                onChange={e => {
                                  const prod = (productosMap as any[]).find(p => p.id === e.target.value)
                                  setTnMapForm({ ...tnMapForm, productoId: e.target.value, tnProductId: '', tnVariantId: '' })
                                  setTnSearchResults([])
                                  if (prod?.sku) searchTNProducts(prod.sku, suc.id)
                                }}
                                className="w-full text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                                <option value="">Seleccionar producto Genesis360</option>
                                {(productosMap as any[]).map((p: any) => (
                                  <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>
                                ))}
                              </select>

                              {/* Auto-complete resultados TN */}
                              {tnSearching && <p className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Buscando en TiendaNube...</p>}
                              {tnSearchResults.length > 0 && (
                                <div className="border border-[#95BF47]/40 rounded-lg overflow-hidden">
                                  <p className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 bg-[#95BF47]/10">Seleccioná el producto en TN:</p>
                                  {tnSearchResults.map((r, i) => (
                                    <button key={i} type="button"
                                      onClick={() => {
                                        setTnMapForm({ ...tnMapForm, tnProductId: String(r.product_id), tnVariantId: r.variant_id ? String(r.variant_id) : '' })
                                        setTnSearchResults([])
                                      }}
                                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#95BF47]/10 border-b border-gray-100 dark:border-gray-700 last:border-0">
                                      <span className="font-medium text-gray-700 dark:text-gray-300">{r.title}</span>
                                      <span className="ml-2 text-gray-400 dark:text-gray-500">ID:{r.product_id}{r.variant_id ? `/var:${r.variant_id}` : ''} {r.sku ? `· SKU:${r.sku}` : ''}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              <div className="flex gap-2">
                                <input type="number" placeholder="TN Product ID" value={tnMapForm.tnProductId}
                                  onChange={e => setTnMapForm({ ...tnMapForm, tnProductId: e.target.value })}
                                  className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                                  onWheel={e => e.currentTarget.blur()} />
                                <input type="number" placeholder="TN Variant ID (opcional)" value={tnMapForm.tnVariantId}
                                  onChange={e => setTnMapForm({ ...tnMapForm, tnVariantId: e.target.value })}
                                  className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                                  onWheel={e => e.currentTarget.blur()} />
                              </div>
                              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                                <input type="checkbox" checked={tnMapForm.syncStock} onChange={e => setTnMapForm({ ...tnMapForm, syncStock: e.target.checked })} />
                                Sincronizar stock automáticamente
                              </label>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => upsertTnMap.mutate({ sucursalId: suc.id })}
                                  disabled={!tnMapForm.productoId || !tnMapForm.tnProductId || !tnMapForm.tnVariantId || upsertTnMap.isPending}
                                  className="flex-1 text-xs bg-[#95BF47] hover:bg-[#7ea83a] text-white py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors">
                                  Guardar
                                </button>
                                <button onClick={() => setTnMapForm(null)} className="flex-1 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-1.5 rounded-lg transition-colors">
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setTnMapForm({ productoId: '', tnProductId: '', tnVariantId: '', syncStock: true })}
                              className="flex items-center gap-1 text-xs text-[#95BF47] hover:text-[#7ea83a] font-medium transition-colors">
                              <Plus size={12} /> Agregar mapeo de producto
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

          {/* ── MercadoPago ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#009EE3]/10 flex items-center justify-center flex-shrink-0">
                <Wallet size={16} className="text-[#009EE3]" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">MercadoPago</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Notificaciones de pagos recibidos (IPN)</p>
              </div>
            </div>

            {!import.meta.env.VITE_MP_CLIENT_ID && (
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5">
                <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Falta configurar <code className="bg-amber-100 dark:bg-amber-800/40 px-1 rounded">VITE_MP_CLIENT_ID</code> en las variables de entorno.
                  Obtenelo en{' '}
                  <a href="https://developers.mercadopago.com" target="_blank" rel="noopener noreferrer"
                    className="underline font-medium inline-flex items-center gap-0.5">
                    developers.mercadopago.com <ExternalLink size={10} />
                  </a>
                </p>
              </div>
            )}

            {mpLoading ? (
              <p className="text-sm text-gray-400 text-center py-2">Cargando...</p>
            ) : sucursales.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">Primero configurá al menos una sucursal</p>
            ) : (
              <div className="space-y-2">
                {sucursales.filter(s => s.activo).map(suc => {
                  const cred = (mpCreds as any[]).find((c: any) => c.sucursal_id === suc.id)
                  const oauthUrl = getMpOAuthUrl(suc.id)
                  const vencido = cred?.expires_at && new Date(cred.expires_at) < new Date()
                  return (
                    <div key={suc.id} className="flex items-center gap-3 px-4 py-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{suc.nombre}</p>
                        {cred && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {cred.seller_email || `Seller ID: ${cred.seller_id}`}
                            {cred.expires_at && (
                              <span className={vencido ? 'text-red-500 ml-1' : 'ml-1'}>
                                · Token {vencido ? 'vencido' : `vence ${new Date(cred.expires_at).toLocaleDateString('es-AR')}`}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      {cred?.conectado ? (
                        <div className="flex items-center gap-2">
                          <span className={`flex items-center gap-1 text-xs font-medium ${vencido ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                            {vencido ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
                            {vencido ? 'Vencido' : 'Conectado'}
                          </span>
                          {oauthUrl && (
                            <a href={oauthUrl}
                              title="Reconectar"
                              className="p-1.5 text-gray-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors">
                              <Plug size={14} />
                            </a>
                          )}
                          <button
                            onClick={() => { if (confirm(`¿Desconectar MercadoPago de ${suc.nombre}?`)) desconectarMP.mutate(cred.id) }}
                            disabled={desconectarMP.isPending}
                            title="Desconectar"
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                            <Unplug size={14} />
                          </button>
                        </div>
                      ) : (
                        oauthUrl ? (
                          <a href={oauthUrl}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#009EE3] hover:bg-[#0088cc] text-white rounded-lg font-medium transition-colors">
                            <Plug size={12} /> Conectar
                          </a>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500 italic">Falta VITE_MP_CLIENT_ID</span>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {/* ── MercadoLibre ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FFE600' }}>
                <span className="text-lg font-black" style={{ color: '#333' }}>ML</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">MercadoLibre</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500">Órdenes → ventas · Sync stock y precio</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={forceSyncMELI} disabled={meliSyncing}
                  title="Forzar sync de stock ahora"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: '#FFF8CC', color: '#856404' }}>
                  {meliSyncing ? '...' : '↑ Sync stock'}
                </button>
                <button disabled title="Próximamente: sincronizar catálogo completo a MercadoLibre"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-400 rounded-lg font-medium cursor-not-allowed">
                  📦 Sync productos
                </button>
              </div>
              {!import.meta.env.VITE_MELI_CLIENT_ID && (
                <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 px-2 py-1 rounded-lg">
                  <AlertCircle size={12} /> Falta VITE_MELI_CLIENT_ID
                </div>
              )}
            </div>

            {(sucursales.length === 0 ? [{ id: 'default', nombre: 'Principal' }] : sucursales).map((suc: any) => {
              const cred = (meliCredentials as any[]).find(c => (c.sucursal_id ?? 'default') === suc.id)
              const oauthUrl = getMeliOAuthUrl(suc.id)
              const vencido = cred && new Date(cred.expires_at) < new Date()
              return (
                <div key={suc.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 dark:border-gray-700 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{suc.nombre}</p>
                    {cred?.conectado && !vencido ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {cred.seller_nickname ?? `Seller ${cred.seller_id}`}
                        {cred.seller_email && ` · ${cred.seller_email}`}
                      </p>
                    ) : cred && vencido ? (
                      <p className="text-xs text-red-500">Token vencido — reconectá</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {cred?.conectado && !vencido ? (
                      <>
                        <span className="flex items-center gap-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                          <CheckCircle2 size={11} /> Conectada
                        </span>
                        <button onClick={() => { if (confirm(`¿Desconectar MercadoLibre de ${suc.nombre}?`)) desconectarMELI.mutate(cred.id) }}
                          title="Desconectar"
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                          <Unplug size={14} />
                        </button>
                      </>
                    ) : oauthUrl ? (
                      <a href={oauthUrl}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white transition-colors"
                        style={{ backgroundColor: '#FFE600', color: '#333' }}>
                        <Plug size={12} /> Conectar
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500 italic">Falta VITE_MELI_CLIENT_ID</span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Mapeo de productos */}
            {(meliCredentials as any[]).some(c => c.conectado) && (
              <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                <button onClick={() => setMeliMapExpanded(v => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 w-full">
                  <Layers size={14} className="text-accent" />
                  Productos mapeados ({(meliMap as any[]).length})
                  {meliMapExpanded ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
                </button>
                {meliMapExpanded && (
                  <div className="mt-3 space-y-2">
                    {/* Formulario nuevo mapeo */}
                    {meliMapForm ? (
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-2">
                        <select value={meliMapForm.productoId}
                          onChange={e => {
                            const prod = (productosMap as any[]).find(p => p.id === e.target.value)
                            setMeliMapForm(p => p ? { ...p, productoId: e.target.value, meliItemId: '', meliVariationId: '' } : p)
                            setMeliSearchResults([])
                            if (prod?.sku) searchMELIItems(prod.sku)
                          }}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent">
                          <option value="">— Producto G360 —</option>
                          {(productosMap as any[]).map((p: any) => (
                            <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>
                          ))}
                        </select>

                        {/* Auto-complete resultados ML */}
                        {meliSearching && <p className="text-xs text-yellow-600 dark:text-yellow-400 animate-pulse">Buscando en MercadoLibre...</p>}
                        {meliSearchResults.length > 0 && (
                          <div className="border border-yellow-300/50 rounded-lg overflow-hidden">
                            <p className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 bg-yellow-50 dark:bg-yellow-900/20">Seleccioná el item en ML:</p>
                            {meliSearchResults.map((r, i) => (
                              <button key={i} type="button"
                                onClick={() => {
                                  setMeliMapForm(p => p ? { ...p, meliItemId: r.item_id, meliVariationId: r.variation_id ? String(r.variation_id) : '' } : p)
                                  setMeliSearchResults([])
                                }}
                                className="w-full text-left px-2 py-1.5 text-xs hover:bg-yellow-50 dark:hover:bg-yellow-900/20 border-b border-gray-100 dark:border-gray-600 last:border-0">
                                <span className="font-medium text-gray-700 dark:text-gray-300">{r.title}</span>
                                <span className="ml-2 text-gray-400 dark:text-gray-500">{r.item_id}{r.variation_id ? `/var:${r.variation_id}` : ''}{r.sku ? ` · SKU:${r.sku}` : ''}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        <input type="text" value={meliMapForm.meliItemId}
                          onChange={e => setMeliMapForm(p => p ? { ...p, meliItemId: e.target.value } : p)}
                          placeholder="ML Item ID (ej: MLA1234567890)"
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent" />
                        <input type="text" value={meliMapForm.meliVariationId}
                          onChange={e => setMeliMapForm(p => p ? { ...p, meliVariationId: e.target.value } : p)}
                          placeholder="Variation ID (opcional)"
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent" />
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={meliMapForm.syncStock}
                              onChange={e => setMeliMapForm(p => p ? { ...p, syncStock: e.target.checked } : p)} />
                            Sync stock
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={meliMapForm.syncPrecio}
                              onChange={e => setMeliMapForm(p => p ? { ...p, syncPrecio: e.target.checked } : p)} />
                            Sync precio
                          </label>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setMeliMapForm(null)}
                            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">Cancelar</button>
                          <button onClick={() => upsertMeliMap.mutate()} disabled={!meliMapForm.productoId || !meliMapForm.meliItemId || upsertMeliMap.isPending}
                            className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg disabled:opacity-50">Guardar</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setMeliMapForm({ productoId: '', meliItemId: '', meliVariationId: '', syncStock: true, syncPrecio: true })}
                        className="flex items-center gap-1.5 text-xs text-accent hover:underline">
                        <Plus size={12} /> Agregar mapeo
                      </button>
                    )}

                    {(meliMap as any[]).map((m: any) => (
                      <div key={m.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-700 dark:text-gray-300 truncate">{m.productos?.nombre ?? '—'} <span className="text-gray-400">({m.productos?.sku})</span></p>
                          <p className="text-gray-400 dark:text-gray-500">{m.meli_item_id}{m.meli_variation_id ? ` · var ${m.meli_variation_id}` : ''}</p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {m.sync_stock && <span className="text-green-600 dark:text-green-400" title="Sync stock">📦</span>}
                          {m.sync_precio && <span className="text-blue-500" title="Sync precio">💲</span>}
                        </div>
                        <button onClick={() => { if (confirm('¿Eliminar mapeo?')) deleteMeliMap.mutate(m.id) }}
                          className="p-1 text-gray-400 hover:text-red-500 rounded">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    {(meliMap as any[]).length === 0 && !meliMapForm && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Sin productos mapeados</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ISS-072: MODO — cobro QR interoperable */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">MODO — QR Interoperable</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">Cobros QR con todos los bancos argentinos · QR en POS + link de pago</p>
            </div>
            {modoCred?.conectado && (
              <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium flex-shrink-0">
                ✓ Conectado
              </span>
            )}
          </div>

          {modoCred?.conectado ? (
            <div className="space-y-3">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-3 space-y-1 text-sm">
                <p className="text-gray-600 dark:text-gray-300"><span className="text-gray-400 dark:text-gray-500">Merchant ID:</span> {modoCred.merchant_id}</p>
                <p className="text-gray-600 dark:text-gray-300"><span className="text-gray-400 dark:text-gray-500">Ambiente:</span> {modoCred.ambiente === 'prod' ? '🟢 Producción' : '🟡 Sandbox/Test'}</p>
                {modoCred.conectado_at && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">Configurado: {new Date(modoCred.conectado_at).toLocaleDateString('es-AR')}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setModoForm({ merchant_id: modoCred.merchant_id, api_key: '', ambiente: modoCred.ambiente as 'test' | 'prod' })}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:border-accent hover:text-accent transition-colors">
                  <Pencil size={12} /> Editar credenciales
                </button>
                <button onClick={desconectarModo}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-red-200 dark:border-red-700 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Unplug size={12} /> Desconectar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-3 text-xs text-blue-700 dark:text-blue-300">
                Para obtener las credenciales, solicitá acceso al programa de merchants en <strong>modo.com.ar</strong>. Te proveerán un Merchant ID y API Key.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Merchant ID *</label>
                  <input type="text" value={modoForm.merchant_id}
                    onChange={e => setModoForm(f => ({ ...f, merchant_id: e.target.value }))}
                    placeholder="Tu Merchant ID de MODO"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Key *</label>
                  <input type="password" value={modoForm.api_key}
                    onChange={e => setModoForm(f => ({ ...f, api_key: e.target.value }))}
                    placeholder="Tu API Key de MODO"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ambiente</label>
                <div className="flex gap-2">
                  {(['test', 'prod'] as const).map(a => (
                    <button key={a} onClick={() => setModoForm(f => ({ ...f, ambiente: a }))}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${modoForm.ambiente === a ? 'bg-accent border-accent text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-accent'}`}>
                      {a === 'test' ? '🟡 Sandbox (test)' : '🟢 Producción'}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={conectarModo} disabled={savingModo || !modoForm.merchant_id || !modoForm.api_key}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {savingModo ? 'Guardando...' : 'Conectar MODO'}
              </button>
            </div>
          )}
        </div>
        </div>
          )}

          {conSubTab === 'api' && (
            <ApiTab tenantId={tenant?.id ?? ''} isOwner={user?.rol === 'DUEÑO' || user?.rol === 'SUPER_USUARIO'} />
          )}
        </div>
      )}

          {/* ── CAJA ──────────────────────────────────────────────────────────── */}
          {tab === 'caja' && (
            <div className="space-y-4">
              {/* Contraseña maestra — Solo DUEÑO (B6) */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Clock size={16} className="text-accent" /> Seguridad de Caja
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Contraseña maestra
                    {(tenant as any)?.clave_maestra && <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-normal">✓ Configurada</span>}
                    {user?.rol !== 'DUEÑO' && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 font-normal">🔒 Solo DUEÑO puede modificarla</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showClaveMaestra ? 'text' : 'password'}
                      value={bizClaveMaestra}
                      onChange={e => setBizClaveMaestra(e.target.value)}
                      disabled={user?.rol !== 'DUEÑO'}
                      placeholder={(tenant as any)?.clave_maestra ? '••••••••' : 'Nueva contraseña maestra'}
                      className="w-full px-4 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700"
                    />
                    <button type="button" onClick={() => setShowClaveMaestra(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <Eye size={15} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Requerida para: cerrar caja ajena · abrir con diferencia · anular ventas o movimientos. Si está vacía, ninguna acción la requiere.
                  </p>
                </div>
                {user?.rol === 'DUEÑO' && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                )}
              </div>

              {/* Permisos avanzados de caja (B7/G1/E2) */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <ShieldCheck size={16} className="text-accent" /> Permisos avanzados
                </h2>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizDobleVal} disabled={!canEdit}
                      onChange={e => setBizDobleVal(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent focus:ring-accent disabled:opacity-50" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Doble validación al cerrar caja</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Un 2do usuario (DUEÑO/SUPERVISOR/ADMIN) debe confirmar el cierre con sus credenciales (B7).</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizSupervisorEdita} disabled={!canEdit}
                      onChange={e => setBizSupervisorEdita(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent focus:ring-accent disabled:opacity-50" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">SUPERVISOR puede corregir movimientos manuales</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Permite al SUPERVISOR usar el botón "Corregir" en ingresos manuales (G1).</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizSupervisorBoveda} disabled={!canEdit}
                      onChange={e => setBizSupervisorBoveda(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent focus:ring-accent disabled:opacity-50" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">SUPERVISOR puede ver el saldo de la bóveda</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Por default solo el DUEÑO ve los saldos por cuenta de origen (E2).</p>
                    </div>
                  </label>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveConfigCaja} disabled={savingConfigCaja}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingConfigCaja ? 'Guardando...' : 'Guardar permisos'}
                    </button>
                  </div>
                )}
              </div>

              {/* Bóveda */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Wallet size={16} className="text-accent" /> Bóveda
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto máximo en caja ($)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="100"
                    value={bizBovedaUmbral} disabled={!canEdit}
                    onChange={e => setBizBovedaUmbral(e.target.value)}
                    placeholder="Sin límite"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Cuando el saldo en caja supera este monto, el sistema alerta para transferir el excedente a la bóveda. Dejá vacío para no poner umbral.
                  </p>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                )}
              </div>

              {/* Diferencias de cierre (B1/B2/B3) */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <AlertCircle size={16} className="text-accent" /> Diferencias en cierre de caja
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Umbral mínimo para alertar ($)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="100"
                    value={bizDifUmbral} disabled={!canEdit}
                    onChange={e => setBizDifUmbral(e.target.value)}
                    placeholder="Alertar con cualquier diferencia"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Si la diferencia (sobrante o faltante) supera este monto en valor absoluto, se dispara la alerta. Vacío = alertar siempre con cualquier diferencia ≠ 0.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Roles que reciben la alerta</label>
                  <div className="flex flex-wrap gap-2">
                    {['DUEÑO','SUPERVISOR','ADMIN','CONTADOR'].map(r => {
                      const activo = bizDifRoles.includes(r)
                      return (
                        <button key={r} type="button" disabled={!canEdit}
                          onClick={() => setBizDifRoles(curr => curr.includes(r) ? curr.filter(x => x !== r) : [...curr, r])}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${activo ? 'bg-accent text-white border-accent' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
                          {r}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Canales</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'inapp', label: 'In-app' },
                      { id: 'email', label: 'Email' },
                      { id: 'whatsapp', label: 'WhatsApp (próximamente)' },
                    ].map(c => {
                      const activo = bizDifCanales.includes(c.id)
                      const deshab = c.id === 'whatsapp'
                      return (
                        <button key={c.id} type="button" disabled={!canEdit || deshab}
                          onClick={() => setBizDifCanales(curr => curr.includes(c.id) ? curr.filter(x => x !== c.id) : [...curr, c.id])}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${activo ? 'bg-accent text-white border-accent' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
                          {c.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveDif} disabled={savingDif}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingDif ? 'Guardando...' : 'Guardar alertas'}
                    </button>
                  </div>
                )}
              </div>

              {/* Cuentas de Origen */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <CreditCard size={16} className="text-accent" /> Cuentas de Origen
                  </h2>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{(cuentasOrigen as any[]).filter(c => c.activo).length} activas / {(cuentasOrigen as any[]).length} total</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Cuentas bancarias, billeteras o efectivo donde se acreditan los cobros. Asociá cada método de pago a una cuenta en el tab <strong>Ventas → Métodos de pago</strong> para ver la bóveda discriminada por banco.
                </p>

                {loadingCuentas ? (
                  <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>
                ) : (
                  <div className="space-y-2">
                    {(cuentasOrigen as any[]).map((c: any) => (
                      <div key={c.id} className="flex items-center gap-3 px-4 py-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                        {editCuentaId === c.id ? (
                          <>
                            <input type="text" value={editCuentaData.nombre}
                              onChange={e => setEditCuentaData(p => ({ ...p, nombre: e.target.value }))}
                              placeholder="Nombre"
                              className="flex-1 min-w-0 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                            <select value={editCuentaData.tipo}
                              onChange={e => setEditCuentaData(p => ({ ...p, tipo: e.target.value }))}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white shrink-0">
                              <option value="banco">Banco</option>
                              <option value="billetera">Billetera</option>
                              <option value="efectivo">Efectivo</option>
                              <option value="otro">Otro</option>
                            </select>
                            <input type="text" value={editCuentaData.banco}
                              onChange={e => setEditCuentaData(p => ({ ...p, banco: e.target.value }))}
                              placeholder="Banco / Entidad"
                              className="w-32 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                            <select value={editCuentaData.moneda}
                              onChange={e => setEditCuentaData(p => ({ ...p, moneda: e.target.value }))}
                              className="w-20 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white shrink-0">
                              {MONEDAS_DISPONIBLES.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
                            </select>
                            <button onClick={() => updateCuentaOrigen.mutate(c.id)} disabled={updateCuentaOrigen.isPending}
                              className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors">
                              <Check size={15} />
                            </button>
                            <button onClick={() => setEditCuentaId(null)}
                              className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                              <X size={15} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-100">
                              {c.nombre}
                              {c.banco && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">· {c.banco}</span>}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              c.tipo === 'banco' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' :
                              c.tipo === 'billetera' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400' :
                              c.tipo === 'efectivo' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                              'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}>
                              {c.tipo}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{c.moneda}</span>
                            <button onClick={() => toggleCuentaOrigen.mutate({ id: c.id, activo: !c.activo })}
                              title={c.activo ? 'Desactivar' : 'Activar'}
                              className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${c.activo ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200'}`}>
                              {c.activo ? 'Activa' : 'Inactiva'}
                            </button>
                            <button onClick={() => { setEditCuentaId(c.id); setEditCuentaData({ nombre: c.nombre, tipo: c.tipo, banco: c.banco ?? '', alias: c.alias ?? '', numero: c.numero ?? '', moneda: c.moneda }) }}
                              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => { if (confirm('¿Eliminar esta cuenta? Si tiene movimientos vinculados, mejor desactivarla.')) deleteCuentaOrigen.mutate(c.id) }}
                              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                    {(cuentasOrigen as any[]).length === 0 && (
                      <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Sin cuentas todavía. Agregá la primera abajo.</p>
                    )}
                  </div>
                )}

                {canEdit && (
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Agregar cuenta</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input type="text" value={nuevaCuenta.nombre}
                        onChange={e => setNuevaCuenta(p => ({ ...p, nombre: e.target.value }))}
                        placeholder="Nombre (ej: BBVA Cuenta Corriente)"
                        className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                      <select value={nuevaCuenta.tipo}
                        onChange={e => setNuevaCuenta(p => ({ ...p, tipo: e.target.value }))}
                        className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white">
                        <option value="banco">Banco</option>
                        <option value="billetera">Billetera</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="otro">Otro</option>
                      </select>
                      <input type="text" value={nuevaCuenta.banco}
                        onChange={e => setNuevaCuenta(p => ({ ...p, banco: e.target.value }))}
                        placeholder="Banco / Entidad"
                        className="w-44 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white" />
                      <select value={nuevaCuenta.moneda || (tenant as any)?.moneda || 'ARS'}
                        onChange={e => setNuevaCuenta(p => ({ ...p, moneda: e.target.value }))}
                        className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white">
                        {MONEDAS_DISPONIBLES.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
                      </select>
                      <button onClick={() => addCuentaOrigen.mutate()} disabled={addCuentaOrigen.isPending || !nuevaCuenta.nombre.trim()}
                        className="px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                        <Plus size={14} /> Agregar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Pendientes */}
              <PlaceholderTab icon={Clock} title="Más configuraciones de Caja" desc="Tolerancia de diferencia, doble validación cierre y panel cajero — próximamente." />
            </div>
          )}
          {tab === 'clientes' && <PlaceholderTab icon={Users} title="Configuración de Clientes" desc="Cuenta corriente, segmentación, límites de crédito y políticas de cobranza." />}
          {tab === 'rrhh' && <PlaceholderTab icon={UserCog} title="Configuración de RRHH" desc="Turnos, horarios, liquidación y gestión de personal." />}
          {tab === 'alertas' && <PlaceholderTab icon={Bell} title="Configuración de Alertas" desc="Define qué eventos generan alertas y para qué roles." />}
          {tab === 'notificaciones' && <PlaceholderTab icon={Bell} title="Configuración de Notificaciones" desc="Canales de notificación (in-app, email, WhatsApp) por tipo de evento." />}

        </div>{/* end content column */}
      </div>{/* end flex gap-6 */}
    </div>
  )
}

// ─── Tab API ──────────────────────────────────────────────────────────────────

function ApiTab({ tenantId, isOwner }: { tenantId: string; isOwner: boolean }) {
  const qc = useQueryClient()
  const [newKeyNombre, setNewKeyNombre] = useState('')
  const [nuevaKeyPlain, setNuevaKeyPlain] = useState<string | null>(null)

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['api_keys', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, nombre, key_prefix, permisos, activo, last_used_at, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenantId,
  })

  const crearKey = useMutation({
    mutationFn: async (nombre: string) => {
      // Generar clave: g360_ + 32 chars random
      const random = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map(b => b.toString(16).padStart(2, '0')).join('')
      const plainKey = `g360_${random}`
      const prefix = plainKey.slice(0, 8)

      // Hash SHA-256
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plainKey))
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')

      const { error } = await supabase.from('api_keys').insert({
        tenant_id: tenantId, nombre, key_prefix: prefix, key_hash: hash,
      })
      if (error) throw error
      return plainKey
    },
    onSuccess: (plainKey) => {
      setNuevaKeyPlain(plainKey)
      setNewKeyNombre('')
      qc.invalidateQueries({ queryKey: ['api_keys', tenantId] })
    },
    onError: () => toast.error('Error al crear la API key'),
  })

  const revocarKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('api_keys').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Key revocada'); qc.invalidateQueries({ queryKey: ['api_keys', tenantId] }) },
  })

  const DEV_URL  = 'https://gcmhzdedrkmmzfzfveig.supabase.co/functions/v1/data-api'
  const PROD_URL = 'https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/data-api'

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Key size={18} className="text-accent" />
        <h2 className="font-semibold text-gray-700 dark:text-gray-300">API de datos</h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Consultá datos de tu negocio desde sistemas externos. Solo lectura, sin webhooks.
      </p>

      {/* Crear key */}
      {isOwner && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
          <h3 className="font-medium text-gray-700 dark:text-gray-300 text-sm">Nueva API key</h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Nombre de la integración (ej: Sistema ERP)"
              value={newKeyNombre}
              onChange={e => setNewKeyNombre(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newKeyNombre.trim() && crearKey.mutate(newKeyNombre.trim())}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white"
            />
            <button
              onClick={() => newKeyNombre.trim() && crearKey.mutate(newKeyNombre.trim())}
              disabled={!newKeyNombre.trim() || crearKey.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
              <Plus size={14} /> Generar
            </button>
          </div>
        </div>
      )}

      {/* Modal de nueva key generada */}
      {nuevaKeyPlain && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              Copiá la clave ahora — no se volverá a mostrar
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-600 rounded-lg px-3 py-2">
            <code className="flex-1 text-xs font-mono text-gray-800 dark:text-gray-100 break-all">{nuevaKeyPlain}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(nuevaKeyPlain); toast.success('Copiado') }}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-800 flex-shrink-0 ml-2" title="Copiar">
              <Copy size={14} />
            </button>
          </div>
          <button onClick={() => setNuevaKeyPlain(null)}
            className="text-xs text-amber-600 dark:text-amber-400 underline hover:no-underline">
            Ya la copié, cerrar
          </button>
        </div>
      )}

      {/* Listado de keys */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-medium text-gray-700 dark:text-gray-300 text-sm">Mis API keys</h3>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-6">Cargando...</p>
        ) : apiKeys.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Sin API keys generadas</p>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(apiKeys as any[]).map(k => (
              <div key={k.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{k.nombre}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <code className="text-xs text-gray-400 font-mono">{k.key_prefix}•••••••••••••</code>
                    {k.last_used_at ? (
                      <span className="text-xs text-gray-400">Usado {new Date(k.last_used_at).toLocaleDateString('es-AR')}</span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">Nunca usado</span>
                    )}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${k.activo ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                  {k.activo ? 'Activa' : 'Revocada'}
                </span>
                {isOwner && k.activo && (
                  <button onClick={() => revocarKey.mutate(k.id)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Revocar key">
                    Revocar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Documentación */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
        <h3 className="font-medium text-gray-700 dark:text-gray-300 text-sm flex items-center gap-2">
          <Hash size={14} /> Documentación de la API
        </h3>

        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">Base URL</p>
          <code className="block text-xs bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 break-all">{PROD_URL}</code>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">Autenticación</p>
          <code className="block text-xs bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300">X-API-Key: g360_tu_clave_aqui</code>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">Entidades disponibles</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700">
                  <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">entity</th>
                  <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">Campos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {[
                  { e: 'productos',   c: 'id, nombre, sku, precio_venta, precio_costo, stock_actual, unidad_medida, activo, categoria' },
                  { e: 'clientes',    c: 'id, nombre, dni, telefono, email, direccion, cuenta_corriente_habilitada, activo' },
                  { e: 'proveedores', c: 'id, nombre, razon_social, cuit, condicion_iva, plazo_pago_dias, banco, cbu, activo' },
                  { e: 'inventario',  c: 'lpn, producto, sku, cantidad, cantidad_reservada, disponible, ubicacion, estado, nro_lote, fecha_vencimiento' },
                ].map(row => (
                  <tr key={row.e}>
                    <td className="px-3 py-2"><code className="text-accent font-mono">{row.e}</code></td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">Parámetros</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700">
                  <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">Parámetro</th>
                  <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">Descripción</th>
                  <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">Default</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {[
                  { p: 'entity',        d: 'Entidad a consultar (obligatorio)',          def: '—' },
                  { p: 'format',        d: 'Formato de respuesta: json | csv',           def: 'json' },
                  { p: 'limit',         d: 'Registros por página (máx. 1.000)',          def: '100' },
                  { p: 'offset',        d: 'Registros a saltear',                        def: '0' },
                  { p: 'updated_since', d: 'Filtrar por fecha ISO (sync incremental)',   def: '—' },
                  { p: 'sucursal_id',   d: 'UUID de sucursal (clientes / inventario)',   def: '—' },
                ].map(row => (
                  <tr key={row.p}>
                    <td className="px-3 py-2"><code className="text-gray-700 dark:text-gray-300 font-mono">{row.p}</code></td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.d}</td>
                    <td className="px-3 py-2 text-gray-400 dark:text-gray-500">{row.def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">Ejemplo curl</p>
          <pre className="text-xs bg-gray-900 text-green-400 rounded-lg px-3 py-3 overflow-x-auto leading-relaxed">{`curl "${PROD_URL}?entity=productos&limit=50" \\
  -H "X-API-Key: g360_tu_clave_aqui"`}</pre>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500">
          Límite: 120 req/min por key. Solo lectura. Para integraciones de escritura, contactá soporte.
        </p>
      </div>
    </div>
  )
}
