import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Tag, MapPin, Building2, CircleDot, MessageSquare, Search, Gift, Upload, Layers, Star, StarOff, ShoppingCart, Timer, ChevronDown, ChevronUp, ChevronRight, Play, RotateCcw, Ruler, Globe, ShieldCheck, KeyRound, CreditCard, Plug, Store, Wallet, AlertCircle, CheckCircle2, ExternalLink, Unplug, Receipt, Eye, Hash, Key, Copy, RefreshCw } from 'lucide-react'
import { TIPOS_COMERCIO } from '@/config/tiposComercio'
import { REGLAS_INVENTARIO } from '@/lib/rebajeSort'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { uploadCertificates } from '@/lib/afip'
import type { TenantCertificate } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Tab = 'negocio' | 'categorias' | 'ubicaciones' | 'estados' | 'motivos' | 'combos' | 'metodos_pago' | 'integraciones' | 'api'
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
  const searchParams = new URLSearchParams(window.location.search)
  const initialTab = searchParams.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(initialTab ?? 'negocio')
  const [estadosSubTab, setEstadosSubTab] = useState<EstadosSubTab>('estados')
  const { tenant, user, setTenant, sucursales } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = user?.rol === 'OWNER'

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
  const [bizTimeout, setBizTimeout] = useState<string>(
    tenant?.session_timeout_minutes != null ? String(tenant.session_timeout_minutes) : 'nunca'
  )
  const [bizPresupuestoValidez, setBizPresupuestoValidez] = useState<string>(
    String((tenant as any)?.presupuesto_validez_dias ?? 30)
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

  // Puntos de venta AFIP
  const [pvCollapsed,   setPvCollapsed]   = useState(true)
  const [pvForm,        setPvForm]        = useState({ numero: '', nombre: '' })
  const [savingPv,      setSavingPv]      = useState(false)

  const handleSaveBiz = async () => {
    setSavingBiz(true)
    const tipoFinal = bizTipoSelect === 'Otro' && bizTipoPersonalizado.trim()
      ? bizTipoPersonalizado.trim()
      : bizTipoSelect
    const sessionTimeoutMinutes = bizTimeout === 'nunca' ? null : parseInt(bizTimeout)
    const updatePayload: any = {
      nombre: bizForm.nombre, tipo_comercio: tipoFinal, regla_inventario: bizRegla,
      session_timeout_minutes: sessionTimeoutMinutes, permite_over_receipt: bizOverReceipt,
      presupuesto_validez_dias: parseInt(bizPresupuestoValidez) || 30,
      whatsapp_plantilla: bizWAPlantilla.trim() || null,
      costo_envio_por_km: bizCostoKm ? parseFloat(bizCostoKm) : null,
      // Facturación
      facturacion_habilitada: bizFactHabilitada,
      cuit: bizCuit.trim() || null,
      condicion_iva_emisor: bizCondIva || null,
      razon_social_fiscal: bizRazonSocial.trim() || null,
      domicilio_fiscal: bizDomicilioFiscal.trim() || null,
      umbral_factura_b: parseFloat(bizUmbralB) || 68305.16,
    }
    if (bizAfipToken.trim()) updatePayload.afipsdk_token = bizAfipToken.trim()
    const { data, error } = await supabase.from('tenants')
      .update(updatePayload)
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
  const [editUbicMonoSku, setEditUbicMonoSku] = useState(false)
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
    setEditUbicMonoSku(u.mono_sku ?? false)
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
    enabled: !!tenant && tab === 'combos',
  })

  const { data: combos = [], isLoading: loadingCombos } = useQuery({
    queryKey: ['combos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('combos')
        .select('*, combo_items(producto_id, cantidad, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'combos',
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
    enabled: !!tenant && tab === 'estados' && estadosSubTab === 'grupos',
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
    enabled: !!tenant && tab === 'negocio',
  })

  const { data: puntosVentaAfip = [], refetch: refetchPV } = useQuery({
    queryKey: ['puntos-venta-afip-config', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('puntos_venta_afip')
        .select('*').eq('tenant_id', tenant!.id).order('numero')
      return data ?? []
    },
    enabled: !!tenant && tab === 'negocio',
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
  const [editMetodoData, setEditMetodoData] = useState({ nombre: '', color: '' })

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
    enabled: !!tenant && tab === 'metodos_pago',
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
        nombre: editMetodoData.nombre.trim(), color: editMetodoData.color,
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
    enabled: !!tenant && tab === 'integraciones',
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
    enabled: !!tenant && tab === 'integraciones',
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
    enabled: !!tenant && tab === 'integraciones',
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
    enabled: !!tenant && tab === 'integraciones',
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
    enabled: !!tenant && tab === 'integraciones',
  })

  const { data: meliMap = [] } = useQuery({
    queryKey: ['meli_map', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventario_meli_map')
        .select('id, producto_id, meli_item_id, meli_variation_id, sync_stock, sync_precio, ultimo_sync_at, productos(nombre, sku)')
        .eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant && tab === 'integraciones',
  })

  const [meliMapExpanded, setMeliMapExpanded] = useState(false)
  const [meliMapForm, setMeliMapForm] = useState<{ productoId: string; meliItemId: string; meliVariationId: string; syncStock: boolean; syncPrecio: boolean } | null>(null)

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

  const tabs = [
    { id: 'negocio' as Tab, label: 'Mi negocio', icon: Building2 },
    { id: 'categorias' as Tab, label: 'Categorías', icon: Tag },
    { id: 'ubicaciones' as Tab, label: 'Ubicaciones', icon: MapPin },
    { id: 'estados' as Tab, label: 'Estados', icon: CircleDot },
    { id: 'motivos' as Tab, label: 'Motivos', icon: MessageSquare },
    { id: 'combos' as Tab, label: 'Combos', icon: Gift },
    { id: 'metodos_pago' as Tab, label: 'Métodos de pago', icon: CreditCard },
    { id: 'integraciones' as Tab, label: 'Integraciones', icon: Plug },
    { id: 'api' as Tab, label: 'API', icon: Key },
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Validez de presupuesto (días)</label>
            <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="365" value={bizPresupuestoValidez} disabled={!canEdit}
              onChange={e => setBizPresupuestoValidez(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Un presupuesto creado hoy expirará en esta cantidad de días. Se muestra en el ticket de presupuesto.</p>
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

      {/* ── WhatsApp — Coordinar entregas ──────────────────────────────────── */}
      {tab === 'negocio' && canEdit && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <span className="font-semibold text-gray-700 dark:text-gray-300">WhatsApp — Coordinar entregas</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Plantilla para el botón "Coordinar por WhatsApp" en el módulo de Envíos.
            Variables disponibles: <span className="font-mono text-accent">{'{{Nombre_Cliente}}'}</span> <span className="font-mono text-accent">{'{{Nombre_Negocio}}'}</span> <span className="font-mono text-accent">{'{{Numero_Orden}}'}</span> <span className="font-mono text-accent">{'{{Tracking}}'}</span> <span className="font-mono text-accent">{'{{Courier}}'}</span> <span className="font-mono text-accent">{'{{Fecha_Entrega}}'}</span>
          </p>
          <textarea value={bizWAPlantilla} onChange={e => setBizWAPlantilla(e.target.value)}
            rows={6} placeholder={`Hola {{Nombre_Cliente}}! 🎉 Somos {{Nombre_Negocio}}.\n\nTu pedido #{{Numero_Orden}} está listo para ser enviado. 📦\n\n🚚 Courier: {{Courier}}\n📍 Tracking: {{Tracking}}\n📅 Fecha estimada: {{Fecha_Entrega}}\n\n¿Hay alguien para recibirlo? ¡Gracias!`}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-y bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-mono" />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Si no configurás una plantilla, se usa el texto por defecto. El número se normaliza automáticamente al formato de Argentina (54 9 + área sin 0 + número sin 15).
          </p>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">$ por km (envío propio)</label>
            <input type="number" onWheel={e => e.currentTarget.blur()} value={bizCostoKm}
              onChange={e => setBizCostoKm(e.target.value)} placeholder="Ej: 150" min="0" step="0.01"
              className="w-36 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            <p className="text-xs text-gray-400 dark:text-gray-500">Para calcular el costo de delivery propio en el módulo de Envíos.</p>
          </div>
        </div>
      )}

      {/* ── Facturación Electrónica ─────────────────────────────────────────── */}
      {tab === 'negocio' && canEdit && (
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
              <button onClick={() => setBizFactHabilitada(v => !v)}
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
          </div>
        </div>
      )}

      {/* ── Puntos de venta AFIP ─────────────────────────────────────────────── */}
      {tab === 'negocio' && canEdit && (
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

      {tab === 'negocio' && (
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

      {tab === 'ubicaciones' && (
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
                className="w-24 flex-shrink-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              <button onClick={addUbicacion} disabled={!newUbicNombre.trim()}
                className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
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

      {tab === 'estados' && (
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
      {tab === 'metodos_pago' && (
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
                      {m.es_sistema && <span className="text-xs text-gray-400 dark:text-gray-500 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">sistema</span>}
                      <button onClick={() => toggleMetodoPago.mutate({ id: m.id, activo: !m.activo })}
                        title={m.activo ? 'Deshabilitar' : 'Habilitar'}
                        className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${m.activo ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                        {m.activo ? 'Activo' : 'Inactivo'}
                      </button>
                      <button onClick={() => { setEditMetodoId(m.id); setEditMetodoData({ nombre: m.nombre, color: m.color }) }}
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
        </div>
      )}

      {tab === 'integraciones' && (
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
        </div>
      )}

      {tab === 'api' && (
        <ApiTab tenantId={tenant?.id ?? ''} isOwner={user?.rol === 'OWNER' || user?.rol === 'ADMIN'} />
      )}

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
