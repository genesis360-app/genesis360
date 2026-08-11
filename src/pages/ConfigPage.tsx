import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Tag, MapPin, Building2, CircleDot, MessageSquare, Search, Gift, Upload, Layers, Star, StarOff, ShoppingCart, Timer, ChevronDown, ChevronUp, ChevronRight, Play, RotateCcw, Ruler, Globe, ShieldCheck, KeyRound, CreditCard, Plug, Store, Wallet, AlertCircle, CheckCircle2, ExternalLink, Unplug, Receipt, Eye, Hash, Key, Copy, RefreshCw, Package, Truck, Users, Bell, UserCog, Navigation, Clock, TrendingDown, TrendingUp, ToggleLeft, ToggleRight, DollarSign, Lock, ScanBarcode, ClipboardCheck, Settings, Wand2, Shirt, Percent, ListOrdered, Box, Recycle } from 'lucide-react'
import { MONEDAS_DISPONIBLES } from '@/lib/formato'
import { TIPOS_COMERCIO } from '@/config/tiposComercio'
import { REGLAS_INVENTARIO } from '@/lib/rebajeSort'
import { estadoVigenciaCombo, hoyLocalISO } from '@/lib/ventasValidation'
import { descuentoDeConfig, etiquetaPromo, DIAS_SEMANA_CORTOS, type DescuentoMetodoPago } from '@/lib/promosPago'
import { normalizarReglasGratis, describirReglaGratis, type ReglaGratis } from '@/lib/enviosTarifas'
import { camposRequeridosCliente, enumLegacyDeCampos } from '@/lib/clienteCampos'
import { supabase } from '@/lib/supabase'
import { PageTabs } from '@/components/PageTabs'
import { InfoTip } from '@/components/InfoTip'
import { Toggle } from '@/components/Toggle'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { uploadCertificates } from '@/lib/afip'
import type { TenantCertificate, UbicacionTipoLogico, UbicacionSubtipoAlmacenamiento } from '@/lib/supabase'
import { CodigoPerfilesPanel } from '@/components/CodigoPerfilesPanel'
import { CourierCredencialesPanel } from '@/components/CourierCredencialesPanel'
import RepartidoresPanel from '@/components/RepartidoresPanel'
import { CanalesVentaPanel } from '@/components/CanalesVentaPanel'
import { EmisoresFiscalesPanel, type EmisoresFiscalesPanelHandle } from '@/components/EmisoresFiscalesPanel'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { MODO_BASICO_ENABLED } from '@/config/brand'
import { motivoBasico } from '@/lib/modoOperacion'
import { PEDIDO_TRANSICIONES, PEDIDO_ROLES_CONFIGURABLES, PEDIDO_TRANSICION_ROLES_DEFAULT, puedeTransicionPedido, type PedidoTransicionesConfig } from '@/lib/pedidoTransiciones'
import { canalesExcluidosValidos } from '@/lib/pedidoVenta'
import { puedeSupervisarModulo } from '@/lib/permisosModulo'
import { useConfirm, usePrompt } from '@/hooks/useConfirm'
import { estadoCapacidadUbicacion, estadoCargaUbicacion, etiquetaOcupacion, volumenUbicacionM3, capacidadUtilM3, estadoVolumenUbicacion, FACTOR_APROVECHAMIENTO_DEFAULT } from '@/lib/medidasLogistica'
import { agruparPorFamilia, ETIQUETA_FAMILIA, FAMILIAS_FISICAS, PRESETS_RUBRO, type UnidadFisica } from '@/lib/unidadMedidaFisica'
import { breadcrumbUbicacion, descendientesDeUbicacion, ordenarArbolUbicaciones } from '@/lib/ubicacionesArbol'
import toast from 'react-hot-toast'

type Tab = 'negocio' | 'ventas' | 'caja' | 'clientes' | 'inventario' | 'envios' | 'pedidos' | 'gastos' | 'facturacion' | 'rrhh' | 'alertas' | 'notificaciones' | 'conectividad'
type VentasSubTab = 'metodos' | 'descuentos' | 'operativa'
type InvSubTab = 'reglas' | 'rotacion' | 'categorias' | 'ubicaciones' | 'estados' | 'motivos' | 'unidades' | 'empaque' | 'atributos' | 'codigos' | 'zonas'
type AtributoVariante = 'talle' | 'color' | 'encaje' | 'formato' | 'sabor_aroma'
// Fede 25/7, punto 6: categoría informativa del empaque (solo reportes — sin función técnica).
// Lista abierta a propósito (sin CHECK en DB, ver mig 328): agregar un valor acá alcanza, no hace falta migración.
const TIPOS_EMPAQUE = ['Unidad', 'Caja', 'Pallet', 'Bolsa', 'Bulto']

// Árbol de Ubicaciones (mig 334, relevamiento 2026-08-02) — contenedora/nivel self-FK.
const CODIGO_UBICACION_REGEX = /^[A-Z0-9]+(-[A-Z0-9]+)*$/
const TIPO_LOGICO_OPCIONES: { value: UbicacionTipoLogico; label: string }[] = [
  { value: 'exhibicion', label: 'Exhibición (góndola — autoservicio)' },
  { value: 'mostrador', label: 'Mostrador (lo busca un empleado)' },
  { value: 'picking', label: 'Picking' },
  { value: 'almacenamiento', label: 'Almacenamiento' },
]
const TIPO_LOGICO_LABELS: Record<UbicacionTipoLogico, string> = {
  exhibicion: 'Exhibición', mostrador: 'Mostrador', picking: 'Picking', almacenamiento: 'Almacenamiento',
}
const SUBTIPO_ALMACENAMIENTO_OPCIONES: { value: UbicacionSubtipoAlmacenamiento; label: string }[] = [
  { value: 'bulk', label: 'Bulk / Reserva' },
  { value: 'estiba', label: 'Estiba / Pallet rack' },
  { value: 'camara', label: 'Cámara frigorífica' },
  { value: 'cross_dock', label: 'Cross-dock' },
  { value: 'staging', label: 'Staging (convergencia de bolsas de Pedidos)' },
]
const SUBTIPO_ALMACENAMIENTO_LABELS: Record<UbicacionSubtipoAlmacenamiento, string> = {
  bulk: 'Bulk', estiba: 'Estiba', camara: 'Cámara', cross_dock: 'Cross-dock', staging: 'Staging',
}
const TIPO_LOGICO_TOOLTIP =
  'Fase venta directa — Exhibición: góndola de autoservicio, el cliente la ve y se sirve solo (necesita cartel de precio). Mostrador: la busca un empleado. ' +
  'Fase reabastecimiento — Picking: posición desde la que se pickea para reponer o despachar. Almacenamiento: stock guardado de difícil alcance (bulk, estiba, cámara, cross-dock, staging).'
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
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
          <button onClick={handleAdd} disabled={saving || !newNombre.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
            <Plus size={15} /> Agregar
          </button>
        </div>
        {withDescription && (
          <input type="text" value={newExtra} onChange={e => setNewExtra(e.target.value)}
            placeholder="Descripción (opcional)..."
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
        )}
      </div>

      {items.length > 4 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
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
                      className="w-full px-3 py-1.5 border border-accent-text rounded-lg text-sm focus:outline-none" />
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
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors">
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
          className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
        <select value={newTipo} onChange={e => setNewTipo(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text">
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
            className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
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
                    className="flex-1 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
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
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text hover:bg-accent/10 rounded-lg"><Pencil size={15} /></button>
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

// ─── Catálogo de "Atributos de variante" (talle/color/encaje/formato/sabor·aroma) ────────────
// Mismo patrón que MotivosList: catálogo por tenant, soft-delete (activo=false). A diferencia
// de Motivos, acá el "tipo" (atributo) es un filtro de pestaña, no un campo por fila — cada
// fila es un VALOR de ESE atributo (ej. con la pestaña "Talle" activa: S, M, L, XL).
const ATRIBUTOS_VARIANTE: { value: AtributoVariante; label: string }[] = [
  { value: 'talle', label: 'Talle' },
  { value: 'color', label: 'Color' },
  { value: 'encaje', label: 'Encaje' },
  { value: 'formato', label: 'Formato' },
  { value: 'sabor_aroma', label: 'Sabor / Aroma' },
]

function AtributoValoresList({ valores, loading, onAdd, onRename, onDelete }: {
  valores: { id: string; valor: string }[]; loading: boolean
  onAdd: (valor: string) => Promise<void>
  onRename: (id: string, valor: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [nuevo, setNuevo] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editValor, setEditValor] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAdd = async () => {
    if (!nuevo.trim()) return
    setSaving(true)
    await onAdd(nuevo.trim())
    setNuevo(''); setSaving(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input type="text" value={nuevo} onChange={e => setNuevo(e.target.value)}
          placeholder="Nuevo valor... (ej: M, Azul, Extra grande)" onKeyDown={e => e.key === 'Enter' && handleAdd()}
          className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
        <button onClick={handleAdd} disabled={saving || !nuevo.trim()}
          className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm disabled:opacity-50 hover:bg-accent transition-all">
          <Plus size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
      ) : valores.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Sin valores cargados para este atributo</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {valores.map(v => (
            <div key={v.id} className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 bg-gray-50 dark:bg-gray-700 rounded-full">
              {editId === v.id ? (
                <>
                  <input type="text" value={editValor} onChange={e => setEditValor(e.target.value)} autoFocus
                    onKeyDown={e => e.key === 'Enter' && (async () => { setSaving(true); await onRename(v.id, editValor); setEditId(null); setSaving(false) })()}
                    className="w-28 px-2 py-0.5 border border-accent-text rounded-lg text-sm focus:outline-none bg-white dark:bg-gray-800" />
                  <button onClick={async () => { setSaving(true); await onRename(v.id, editValor); setEditId(null); setSaving(false) }}
                    className="p-1 text-green-600 dark:text-green-400 hover:bg-green-50 dark:bg-green-900/20 rounded-full"><Check size={14} /></button>
                  <button onClick={() => setEditId(null)} className="p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"><X size={14} /></button>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{v.valor}</span>
                  <button onClick={() => { setEditId(v.id); setEditValor(v.valor) }}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-accent-text hover:bg-accent/10 rounded-full"><Pencil size={12} /></button>
                  <button onClick={() => onDelete(v.id)}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-full"><Trash2 size={12} /></button>
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
          <Globe size={16} className="text-accent-text" />
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
            <Toggle size="lg" disabled={!canEdit} checked={activo}
              onChange={() => setActivo(a => !a)} aria-label="Activar marketplace" />
          </div>
          {activo && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                URL de webhook externo <span className="text-gray-400 dark:text-gray-500 font-normal">(opcional)</span>
              </label>
              <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
                disabled={!canEdit}
                placeholder="https://mi-sistema.com/webhook/stock"
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Recibís una notificación POST cada vez que cambia el stock de un producto publicado.</p>
            </div>
          )}
          {activo && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Endpoint público de tu catálogo:</p>
              <p className="text-xs font-mono text-accent-text break-all">
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

// ─── Modo de operación: Básico vs Avanzado (WMS) — mig 207 ───────────────────
function ModoOperacionSection() {
  const { tenant, user, setTenant } = useAuthStore()
  const { limits } = usePlanLimits()
  const confirmar = useConfirm()
  const canEdit = user?.rol === 'DUEÑO'
  const [saving, setSaving] = useState(false)

  const modoActual: 'basico' | 'avanzado' = tenant?.modo_operacion === 'avanzado' ? 'avanzado' : 'basico'
  const puedeWms = limits?.puede_wms ?? false
  const motivo = motivoBasico(tenant?.modo_operacion, puedeWms)

  // Productos con tracking activo: en básico conservan su flujo (regla de integridad)
  const { data: productosConTracking = 0 } = useQuery({
    queryKey: ['productos-con-tracking', tenant?.id],
    queryFn: async () => {
      const { count } = await supabase.from('productos')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .or('tiene_series.eq.true,tiene_lote.eq.true,tiene_vencimiento.eq.true')
      return count ?? 0
    },
    enabled: !!tenant,
  })

  if (!MODO_BASICO_ENABLED) return null

  const cambiar = async (nuevo: 'basico' | 'avanzado') => {
    if (!canEdit || nuevo === modoActual) return
    if (nuevo === 'avanzado' && !puedeWms) return
    if (nuevo === 'basico') {
      const detalle = productosConTracking > 0
        ? `\n\nTenés ${productosConTracking} producto(s) con trazabilidad activa (series/lotes/vencimiento): van a conservar su flujo al mover stock, pero no vas a poder activar trazabilidad en productos nuevos.`
        : ''
      const ok = await confirmar(
        `¿Pasar al modo Básico?\n\nSe ocultan Recepciones/OC, Envíos, Trazabilidad y las opciones WMS (LPN, ubicaciones, lotes, series, vencimientos). Ningún dato se borra: al volver al modo Avanzado todo reaparece intacto.${detalle}`
      )
      if (!ok) return
    }
    setSaving(true)
    const { data, error } = await supabase.from('tenants')
      .update({ modo_operacion: nuevo }).eq('id', tenant!.id).select().single()
    if (error) toast.error(error.message)
    else {
      setTenant(data)
      logActividad({ entidad: 'tenant', entidad_id: tenant!.id, accion: 'editar', campo: 'modo_operacion', valor_anterior: modoActual, valor_nuevo: nuevo, pagina: '/configuracion' })
      toast.success(nuevo === 'avanzado' ? 'Modo avanzado activado' : 'Modo básico activado')
    }
    setSaving(false)
  }

  const opciones: { id: 'basico' | 'avanzado'; titulo: string; desc: string }[] = [
    { id: 'basico', titulo: 'Básico', desc: 'Para kioscos, almacenes y pymes chicas. Ventas, caja, clientes, gastos y stock simple — sin trazabilidad ni depósito formal.' },
    { id: 'avanzado', titulo: 'Avanzado (WMS)', desc: 'Trazabilidad completa: lotes, series, vencimientos, FIFO/FEFO, ubicaciones, LPN, órdenes de compra, recepciones y envíos.' },
  ]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-accent-text" />
        <h2 className="font-semibold text-gray-700 dark:text-gray-300">Modo de operación</h2>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Define qué módulos y opciones muestra la app. Cambiar de modo no borra ningún dato.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {opciones.map(op => {
          const activa = modoActual === op.id
          const bloqueada = op.id === 'avanzado' && !puedeWms
          return (
            <button key={op.id} type="button" disabled={!canEdit || saving || bloqueada}
              onClick={() => cambiar(op.id)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${activa
                ? 'border-accent-text bg-accent/5'
                : 'border-gray-200 dark:border-gray-700 hover:border-accent-text/40'} ${(!canEdit || bloqueada) ? 'opacity-60 cursor-not-allowed' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{op.titulo}</span>
                {activa && <span className="text-xs bg-accent/10 text-accent-text px-2 py-0.5 rounded-full font-medium">Activo</span>}
                {bloqueada && <Lock size={14} className="text-gray-400" />}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{op.desc}</p>
            </button>
          )
        })}
      </div>
      {motivo === 'plan_insuficiente' && (
        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            El modo avanzado está activado pero tu plan actual no lo incluye, así que la app opera en modo básico.
            Tus datos WMS siguen intactos. <Link to="/suscripcion" className="underline font-medium">Mejorá tu plan</Link> para reactivarlo.
          </p>
        </div>
      )}
      {modoActual === 'basico' && !puedeWms && motivo !== 'plan_insuficiente' && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          El modo avanzado requiere plan <strong>Pro</strong>. <Link to="/suscripcion" className="text-accent-text underline">Ver planes</Link>
        </p>
      )}
    </div>
  )
}

const CONDICION_IVA_LABEL: Record<string, string> = {
  RI: 'Responsable Inscripto (RI)',
  Monotributista: 'Monotributista',
  Exento: 'Exento',
}

/** Fila de solo-lectura del resumen de identidad fiscal (F3b: la edición vive en Emisores fiscales). */
function CampoResumenFiscal({ label, value, mono, className }: { label: string; value?: string | null; mono?: boolean; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`text-sm ${mono ? 'font-mono' : ''} ${value ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 italic'}`}>
        {value || 'Sin cargar'}
      </p>
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
  const confirmar = useConfirm()
  const preguntar = usePrompt()
  const canEdit = user?.rol === 'DUEÑO'
  const { avanzado: modoAvanzado } = useModoOperacion()

  // En básico no existen el tab Envíos ni los sub-tabs WMS de Inventario (deep-links incluidos)
  // ni el sub-tab "API" de Conectividad (API pública del marketplace = avanzado; las
  // integraciones TiendaNube/MeLi sí quedan disponibles).
  useEffect(() => {
    if (modoAvanzado) return
    if (tab === 'envios' || tab === 'pedidos') setTab('negocio')
    if (['reglas', 'rotacion', 'ubicaciones', 'estados', 'codigos'].includes(invSubTab)) setInvSubTab('categorias')
    if (conSubTab === 'api') setConSubTab('integraciones')
  }, [modoAvanzado, tab, invSubTab, conSubTab])

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
  const [bizConteoModo, setBizConteoModo] = useState<'rapido' | 'guiado' | 'elegir'>((tenant as any)?.conteo_modo ?? 'rapido')
  // Cubicaje volumétrico opt-in (mig 322)
  const [bizCubicaje, setBizCubicaje] = useState(!!tenant?.cubicaje_habilitado)
  const [bizCubicajeFactor, setBizCubicajeFactor] = useState(
    String(Math.round((Number(tenant?.cubicaje_factor_aprovechamiento ?? FACTOR_APROVECHAMIENTO_DEFAULT)) * 100))
  )
  // Motor de Rotación (A1-A3) — default a nivel tenant
  const [bizRotacionAgotar, setBizRotacionAgotar] = useState(!!(tenant as any)?.rotacion_agotar_antes_reponer)
  const [bizRotacionEnvios, setBizRotacionEnvios] = useState(!!(tenant as any)?.rotacion_prioridad_envios)
  const [bizRotacionKits, setBizRotacionKits] = useState(!!(tenant as any)?.rotacion_armar_kits)
  const [bizRotacionUbicacionExcepcion, setBizRotacionUbicacionExcepcion] = useState((tenant as any)?.rotacion_ubicacion_excepcion_id ?? '')
  // F3 — gate de ajustes de conteo + umbrales de doble conteo
  const num = (v: any) => v != null ? String(v) : ''
  const [bizConteoGate, setBizConteoGate] = useState({
    activo: !!(tenant as any)?.conteo_gate_activo,
    gateU: num((tenant as any)?.conteo_gate_umbral_u), gatePct: num((tenant as any)?.conteo_gate_umbral_pct), gateValor: num((tenant as any)?.conteo_gate_umbral_valor),
    recU: num((tenant as any)?.conteo_reconteo_umbral_u), recPct: num((tenant as any)?.conteo_reconteo_umbral_pct), recValor: num((tenant as any)?.conteo_reconteo_umbral_valor),
  })
  // mig 228 — autorización de ajustes de inventario POR ROL (directo|umbral|siempre).
  // Default en código: DUEÑO directo, resto siempre. Acá se guardan los overrides por rol.
  const [bizAjusteRoles, setBizAjusteRoles] = useState<Record<string, string>>(
    ((tenant as any)?.ajuste_autorizacion_roles ?? {}) as Record<string, string>
  )
  // F4 — días de ciclo de conteo por clase ABC (sugerencia cíclica)
  const [bizConteoCiclo, setBizConteoCiclo] = useState({
    a: num((tenant as any)?.conteo_ciclico_dias_a ?? 30),
    b: num((tenant as any)?.conteo_ciclico_dias_b ?? 90),
    c: num((tenant as any)?.conteo_ciclico_dias_c ?? 180),
  })
  // A2 — wall-to-wall bloquea ventas/movimientos de la sucursal hasta cerrar el conteo
  const [bizConteoWtwBloquea, setBizConteoWtwBloquea] = useState(!!(tenant as any)?.conteo_wall_to_wall_bloquea)
  const [bizTimeout, setBizTimeout] = useState<string>(
    tenant?.session_timeout_minutes != null ? String(tenant.session_timeout_minutes) : 'nunca'
  )
  const [bizPresupuestoValidez, setBizPresupuestoValidez] = useState<string>(
    String((tenant as any)?.presupuesto_validez_dias ?? 30)
  )
  // VF4/K2 — alertas de ventas
  const [bizAlertaMargenNeg, setBizAlertaMargenNeg] = useState<boolean>((tenant as any)?.alerta_margen_negativo ?? true)
  const [bizAlertaDevN, setBizAlertaDevN] = useState<string>((tenant as any)?.alerta_devoluciones_n != null ? String((tenant as any).alerta_devoluciones_n) : '')
  const [bizAlertaDevDias, setBizAlertaDevDias] = useState<string>(String((tenant as any)?.alerta_devoluciones_dias ?? 30))
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
  // Cuenta Corriente clientes (CL2 · B1/B3/B4)
  const [bizCCEnforcement, setBizCCEnforcement] = useState<string>((tenant as any)?.cc_enforcement_politica ?? 'avisar')
  const [bizCCMorosidad, setBizCCMorosidad] = useState<string>((tenant as any)?.cc_morosidad_politica ?? 'bloqueo_cc')
  const [bizCCLimiteDefault, setBizCCLimiteDefault] = useState<string>(
    (tenant as any)?.limite_cc_default != null ? String((tenant as any).limite_cc_default) : ''
  )
  const [bizCCDiasVenc, setBizCCDiasVenc] = useState<string>(
    (tenant as any)?.cc_dias_vencimiento != null ? String((tenant as any).cc_dias_vencimiento) : ''
  )
  const [bizCCInteresMensual, setBizCCInteresMensual] = useState<string>(String((tenant as any)?.cc_interes_mensual_pct ?? 0))
  // Notificaciones de CC (CL4 · C1-C5)
  const [bizCCNotifCanales, setBizCCNotifCanales] = useState<string[]>((tenant as any)?.cc_notif_canales ?? ['whatsapp'])
  const [bizCCNotifRegistroDeuda, setBizCCNotifRegistroDeuda] = useState<boolean>((tenant as any)?.cc_notif_registro_deuda ?? false)
  const [bizCCNotifPago, setBizCCNotifPago] = useState<boolean>((tenant as any)?.cc_notif_pago ?? false)
  const [bizCCPreVencDias, setBizCCPreVencDias] = useState<string>((tenant as any)?.cc_notif_pre_venc_dias != null ? String((tenant as any).cc_notif_pre_venc_dias) : '')
  const [bizCumpleCliente, setBizCumpleCliente] = useState<boolean>((tenant as any)?.cumple_notif_cliente ?? false)
  const [bizCumpleDuenio, setBizCumpleDuenio] = useState<boolean>((tenant as any)?.cumple_notif_duenio ?? false)

  // F3b: pointer desde la tarjeta ARCA a la edición del emisor principal en el panel de abajo
  const emisoresPanelRef = useRef<EmisoresFiscalesPanelHandle>(null)

  // Facturación electrónica
  const [bizFactHabilitada,  setBizFactHabilitada]  = useState<boolean>((tenant as any)?.facturacion_habilitada ?? false)
  const [bizCuit,            setBizCuit]            = useState<string>((tenant as any)?.cuit ?? '')
  const [bizCondIva,         setBizCondIva]         = useState<string>((tenant as any)?.condicion_iva_emisor ?? '')
  const [bizRazonSocial,     setBizRazonSocial]     = useState<string>((tenant as any)?.razon_social_fiscal ?? '')
  const [bizDomicilioFiscal, setBizDomicilioFiscal] = useState<string>((tenant as any)?.domicilio_fiscal ?? '')
  const [bizUmbralB,         setBizUmbralB]         = useState<string>(String((tenant as any)?.umbral_factura_b ?? '68305.16'))
  const [bizAfipToken,       setBizAfipToken]       = useState<string>((tenant as any)?.afipsdk_token ?? '')
  const [showAfipToken,      setShowAfipToken]      = useState(false)
  // Logo del negocio (sale en factura + presupuesto) — bucket `logos`
  const [bizLogoUrl,         setBizLogoUrl]         = useState<string>((tenant as any)?.logo_url ?? '')
  const [uploadingLogo,      setUploadingLogo]      = useState(false)
  // Datos del emisor para comprobantes (mig 212)
  const [bizIngBrutos,       setBizIngBrutos]       = useState<string>((tenant as any)?.ingresos_brutos ?? '')
  const [bizInicioAct,       setBizInicioAct]       = useState<string>(((tenant as any)?.inicio_actividades ?? '').slice(0, 10))
  const [bizSitioWeb,        setBizSitioWeb]        = useState<string>((tenant as any)?.sitio_web ?? '')
  const [bizBanco,           setBizBanco]           = useState<string>((tenant as any)?.banco ?? '')
  const [bizCbu,             setBizCbu]             = useState<string>((tenant as any)?.cbu ?? '')
  const [bizAliasCbu,        setBizAliasCbu]        = useState<string>((tenant as any)?.alias_cbu ?? '')
  const [bizLeyenda,         setBizLeyenda]         = useState<string>((tenant as any)?.leyenda_comprobante ?? '')
  // Modo de emisión: homologación (sandbox) vs producción (CAE fiscal real)
  const [bizAfipProduccion,  setBizAfipProduccion]  = useState<boolean>((tenant as any)?.afip_produccion ?? false)
  const [showProdConfirm,    setShowProdConfirm]    = useState(false)
  const [prodAck,            setProdAck]            = useState(false)

  // 🔄 Re-sincronizar el form fiscal cuando la identidad cambia en el store. Desde el cutover a
  // fuente única (mig 271) hay DOS editores del mismo registro (esta sección y el panel de
  // Emisores fiscales): sin esto, editar desde el panel dejaba este form con valores stale y un
  // "Guardar" posterior PISABA la identidad con datos viejos. Ambos escriben el mismo registro,
  // así que el re-sync solo refleja — no puede divergir. (Los deps son los VALORES fiscales: el
  // efecto no dispara por cambios no-fiscales del tenant.)
  const tAny = tenant as any
  useEffect(() => {
    if (!tAny) return
    setBizCuit(tAny.cuit ?? '')
    setBizCondIva(tAny.condicion_iva_emisor ?? '')
    setBizRazonSocial(tAny.razon_social_fiscal ?? '')
    setBizDomicilioFiscal(tAny.domicilio_fiscal ?? '')
    setBizUmbralB(String(tAny.umbral_factura_b ?? '68305.16'))
    setBizAfipToken(tAny.afipsdk_token ?? '')
    setBizLogoUrl(tAny.logo_url ?? '')
    setBizIngBrutos(tAny.ingresos_brutos ?? '')
    setBizInicioAct((tAny.inicio_actividades ?? '').slice(0, 10))
    setBizSitioWeb(tAny.sitio_web ?? '')
    setBizBanco(tAny.banco ?? '')
    setBizCbu(tAny.cbu ?? '')
    setBizAliasCbu(tAny.alias_cbu ?? '')
    setBizLeyenda(tAny.leyenda_comprobante ?? '')
    setBizAfipProduccion(tAny.afip_produccion ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tAny?.cuit, tAny?.condicion_iva_emisor, tAny?.razon_social_fiscal, tAny?.domicilio_fiscal,
    tAny?.umbral_factura_b, tAny?.afipsdk_token, tAny?.logo_url, tAny?.ingresos_brutos,
    tAny?.inicio_actividades, tAny?.sitio_web, tAny?.banco, tAny?.cbu, tAny?.alias_cbu,
    tAny?.leyenda_comprobante, tAny?.afip_produccion,
  ])
  const [savingProd,         setSavingProd]         = useState(false)

  // WhatsApp
  const [bizWAPlantilla, setBizWAPlantilla] = useState<string>((tenant as any)?.whatsapp_plantilla ?? '')
  const waTextareaRef = useRef<HTMLTextAreaElement>(null)
  // Envíos
  const [bizCostoKm, setBizCostoKm] = useState<string>(String((tenant as any)?.costo_envio_por_km ?? ''))
  // ISS-174 — fuente del peso/medidas para cotizar (manual por envío | dato maestro del producto)
  const [bizPesoFuente, setBizPesoFuente] = useState<'manual' | 'producto'>(
    (tenant as any)?.envio_peso_fuente === 'producto' ? 'producto' : 'manual'
  )
  // ISS-178 — Rangos horarios de entrega
  const [bizEnvioRangos, setBizEnvioRangos] = useState<Array<{ desde: string; hasta: string }>>(
    Array.isArray((tenant as any)?.envio_rangos_horarios)
      ? (tenant as any).envio_rangos_horarios.map((r: any) => ({ desde: String(r.desde ?? ''), hasta: String(r.hasta ?? '') }))
      : [{ desde: '08:00', hasta: '13:00' }, { desde: '13:00', hasta: '18:00' }, { desde: '18:00', hasta: '22:00' }]
  )
  // EN1 — pagos a courier contables
  const [bizCourierGeneraGasto, setBizCourierGeneraGasto] = useState<boolean>((tenant as any)?.envio_courier_genera_gasto !== false)
  const [bizCourierIvaPct, setBizCourierIvaPct] = useState<string>(String((tenant as any)?.envio_courier_iva_pct ?? 21))
  const [bizEnvioDobleFirma, setBizEnvioDobleFirma] = useState<string>(String((tenant as any)?.envio_pago_doble_firma_umbral ?? 0))
  // EN2 — POD robusto
  const [bizPodReq, setBizPodReq] = useState<Record<string, boolean>>(() => {
    const d = (tenant as any)?.pod_campos_requeridos
    return (d && typeof d === 'object') ? d : { fecha: true, receptor: true, foto: false, firma: false, dni: false }
  })
  const [bizPodFotoMin, setBizPodFotoMin] = useState<string>(String((tenant as any)?.pod_foto_min ?? 0))
  const [bizPodOtpUmbral, setBizPodOtpUmbral] = useState<string>(String((tenant as any)?.pod_otp_umbral ?? 0))
  const [bizGeolocAlertaKm, setBizGeolocAlertaKm] = useState<string>(String((tenant as any)?.envio_geoloc_alerta_km ?? 0))
  const [bizReintentosMax, setBizReintentosMax] = useState<string>(String((tenant as any)?.envio_reintentos_max ?? 3))
  const [bizReintentoRecargo, setBizReintentoRecargo] = useState<string>(String((tenant as any)?.envio_reintento_recargo ?? 0))
  // EN3 — reparto
  const [bizTokenPolitica, setBizTokenPolitica] = useState<string>((tenant as any)?.envio_token_politica ?? 'al_entregar')
  const [bizTokenDias, setBizTokenDias] = useState<string>(String((tenant as any)?.envio_token_dias ?? 30))
  const [bizIdentidadModo, setBizIdentidadModo] = useState<string>((tenant as any)?.envio_identidad_modo ?? 'anonimo')
  const [bizNotifEnCamino, setBizNotifEnCamino] = useState<string>((tenant as any)?.envio_notif_en_camino ?? 'wa')
  const [bizHojaRutaModo, setBizHojaRutaModo] = useState<string>((tenant as any)?.envio_hoja_ruta_modo ?? 'agrupada')
  // EN4 — costos y tarifas
  const [bizFactorKm, setBizFactorKm] = useState<string>(String((tenant as any)?.envio_factor_km ?? 1.35))
  const [bizCostoMinimo, setBizCostoMinimo] = useState<string>(String((tenant as any)?.envio_costo_minimo ?? 0))
  const [bizTramos, setBizTramos] = useState<Array<{ hasta: string; precio: string }>>(
    Array.isArray((tenant as any)?.envio_tramos) ? (tenant as any).envio_tramos.map((t: any) => ({ hasta: String(t.hasta ?? ''), precio: String(t.precio ?? '') })) : []
  )
  const [bizRecargoHorario, setBizRecargoHorario] = useState<Array<{ desde: string; hasta: string; recargo: string }>>(
    Array.isArray((tenant as any)?.envio_recargo_horario) ? (tenant as any).envio_recargo_horario.map((r: any) => ({ desde: String(r.desde ?? ''), hasta: String(r.hasta ?? ''), recargo: String(r.recargo ?? '') })) : []
  )
  const [bizCobroPolitica, setBizCobroPolitica] = useState<string>((tenant as any)?.envio_cobro_politica ?? 'cliente_100')
  const [bizCobroMargen, setBizCobroMargen] = useState<string>(String((tenant as any)?.envio_cobro_margen_pct ?? 0))
  const [bizSubsidioUmbral, setBizSubsidioUmbral] = useState<string>(String((tenant as any)?.envio_subsidio_umbral ?? 0))
  // Envío gratis condicional v2 (multi-regla + tope de km — backlog Fede/GO punto 7).
  // normalizarReglasGratis migra el shape legacy {montoMinimo, etiquetas, promoDesde/Hasta}.
  const [bizGratisReglas, setBizGratisReglas] = useState<Array<{ montoMinimo: string; etiquetas: string; desde: string; hasta: string; maxKm: string }>>(
    () => normalizarReglasGratis((tenant as any)?.envio_gratis_reglas).map((r: ReglaGratis) => ({
      montoMinimo: r.montoMinimo != null ? String(r.montoMinimo) : '',
      etiquetas: (r.etiquetas ?? []).join(', '),
      desde: r.desde ?? '',
      hasta: r.hasta ?? '',
      maxKm: r.maxKm != null ? String(r.maxKm) : '',
    }))
  )
  // EN5 — creación/alcance
  const _pd = ((tenant as any)?.envio_plazo_despacho ?? {}) as any
  const [bizPlazoPresencial, setBizPlazoPresencial] = useState<string>(String(_pd.presencial ?? ''))
  const [bizPlazoOnline, setBizPlazoOnline] = useState<string>(String(_pd.online ?? ''))
  const [bizPlazoMayorista, setBizPlazoMayorista] = useState<string>(String(_pd.mayorista ?? ''))
  const [bizCpCourier, setBizCpCourier] = useState<Array<{ desde: string; hasta: string; courier: string }>>(
    Array.isArray((tenant as any)?.cp_courier_preferido) ? (tenant as any).cp_courier_preferido.map((r: any) => ({ desde: String(r.desde ?? r.cp ?? ''), hasta: String(r.hasta ?? r.cp ?? ''), courier: String(r.courier ?? '') })) : []
  )
  // EN7 — envío propio (combustible) + umbrales de alertas
  const [bizCombustiblePrecio, setBizCombustiblePrecio] = useState<string>(String((tenant as any)?.envio_combustible_precio_litro ?? 0))
  const [bizAlertaSinDespacho, setBizAlertaSinDespacho] = useState<string>(String((tenant as any)?.envio_alerta_sin_despacho_horas ?? 24))
  const [bizAlertaPodDias, setBizAlertaPodDias] = useState<string>(String((tenant as any)?.envio_alerta_pod_pendiente_dias ?? 3))
  const [bizAlertaPagoDias, setBizAlertaPagoDias] = useState<string>(String((tenant as any)?.envio_alerta_pago_courier_dias ?? 7))
  const [bizAlertaDifPct, setBizAlertaDifPct] = useState<string>(String((tenant as any)?.envio_alerta_diferencia_pct ?? 15))

  // Fase 2 — identidad
  const [bizPrecioRedondeo,  setBizPrecioRedondeo]  = useState<string>(tenant?.precio_redondeo ?? 'none')
  // Moneda principal (v1.8.44)
  const [bizMoneda,          setBizMoneda]          = useState<string>((tenant as any)?.moneda ?? 'ARS')

  // Fase 3 — cliente en POS
  const [bizClienteObligatorio,     setBizClienteObligatorio]     = useState<string>(tenant?.cliente_obligatorio ?? 'nunca')
  // Campos requeridos por checkbox (mig 280) — reemplaza el enum legacy cliente_datos_minimos
  const [bizClienteCampos, setBizClienteCampos] = useState(() => camposRequeridosCliente(tenant as any))
  const [bizClienteConsumidorFinal, setBizClienteConsumidorFinal] = useState<boolean>(tenant?.cliente_consumidor_final ?? true)
  const [bizClienteCreacionInline,  setBizClienteCreacionInline]  = useState<boolean>(tenant?.cliente_creacion_inline ?? true)

  // Fase 4 — descuentos y caja
  // (descuento_max_cajero_pct se quitó: el CAJERO está siempre bloqueado de descuentos — H4)
  const [bizDescuentoMaxSupervisor, setBizDescuentoMaxSupervisor] = useState<string>(tenant?.descuento_max_supervisor_pct != null ? String(tenant.descuento_max_supervisor_pct) : '')
  const [bizClaveMaestra,           setBizClaveMaestra]           = useState<string>('')
  const [bizClaveMaestraConfirm,    setBizClaveMaestraConfirm]    = useState<string>('')
  const [showClaveMaestra,          setShowClaveMaestra]          = useState(false)
  const [bizBovedaUmbral,           setBizBovedaUmbral]           = useState<string>(tenant?.boveda_umbral_caja != null ? String(tenant.boveda_umbral_caja) : '')
  // RRHH (H4) — flags leídos en RrhhPage que antes no tenían UI de configuración
  const [bizRrhhTardanzaModo,       setBizRrhhTardanzaModo]       = useState<'registrar' | 'proporcional' | 'umbral'>((tenant as any)?.rrhh_tardanza_modo ?? 'registrar')
  const [bizRrhhTardanzaTol,        setBizRrhhTardanzaTol]        = useState<string>(String((tenant as any)?.rrhh_tardanza_tolerancia_min ?? 0))
  const [bizRrhhHorasMesBase,       setBizRrhhHorasMesBase]       = useState<string>(String((tenant as any)?.rrhh_horas_mes_base ?? 200))
  const [bizRrhhHorasExtraAprob,    setBizRrhhHorasExtraAprob]    = useState<boolean>(!!(tenant as any)?.rrhh_horas_extra_requiere_aprobacion)
  const [bizRrhhDocAlertaDias,      setBizRrhhDocAlertaDias]      = useState<string>(String((tenant as any)?.rrhh_doc_alerta_dias ?? 30))
  const [bizRrhhNominaSupAprueba,   setBizRrhhNominaSupAprueba]   = useState<boolean>(!!(tenant as any)?.rrhh_nomina_supervisor_aprueba)
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
  // CO1 — gobierno de OC (Compras)
  const [ocAprobActiva,        setOcAprobActiva]        = useState<boolean>((t142 as any)?.oc_aprobacion_activa ?? false)
  const [ocAprobUmbral,        setOcAprobUmbral]        = useState<string>((t142 as any)?.oc_aprobacion_umbral != null ? String((t142 as any).oc_aprobacion_umbral) : '')
  const [ocNumeracion,         setOcNumeracion]         = useState<string>((t142 as any)?.oc_numeracion ?? 'sucursal')
  const [ocDobleFirmaUmbral,   setOcDobleFirmaUmbral]   = useState<string>((t142 as any)?.oc_pago_doble_firma_umbral != null ? String((t142 as any).oc_pago_doble_firma_umbral) : '')
  // CO3 — costos
  const [ocCostoAlertaPct,     setOcCostoAlertaPct]     = useState<string>(String((t142 as any)?.compras_costo_alerta_pct ?? 10))
  const [ocRemitoObligatorio,  setOcRemitoObligatorio]  = useState<boolean>(!!(t142 as any)?.recepcion_remito_obligatorio)
  const [ocFaltanteAlertaDias, setOcFaltanteAlertaDias] = useState<string>(String((t142 as any)?.recepcion_alerta_faltante_dias ?? 7))
  const [ocOverReceiptPct,     setOcOverReceiptPct]     = useState<string>((t142 as any)?.over_receipt_pct_max != null ? String((t142 as any).over_receipt_pct_max) : '')
  // CO6 — cheques
  const [chequesAlertaDias,    setChequesAlertaDias]    = useState<string>(String((t142 as any)?.cheques_alerta_dias ?? 7))
  const [newCategoria,         setNewCategoria]         = useState<{ nombre: string; requiere_sucursal: boolean }>({ nombre: '', requiere_sucursal: false })


  // Puntos de venta AFIP
  const [pvCollapsed,   setPvCollapsed]   = useState(true)
  const [pvForm,        setPvForm]        = useState({ numero: '', nombre: '' })
  const [savingPv,      setSavingPv]      = useState(false)

  // Toggle facturación con auto-guardado y rollback si falla
  const toggleFacturacion = async () => {
    const nuevoValor = !bizFactHabilitada
    // Guard: no habilitar facturación sin los datos fiscales mínimos GUARDADOS. La condición
    // IVA del emisor gobierna A/B/C (un Monotributista sin setearla emitiría B en vez de C) y
    // el CUIT es imprescindible para AFIP. Forzar a completarlos antes evita comprobantes mal tipados.
    if (nuevoValor) {
      const faltan: string[] = []
      if (!(tenant as any)?.condicion_iva_emisor) faltan.push('Condición IVA del emisor')
      if (!(tenant as any)?.cuit) faltan.push('CUIT')
      if (faltan.length) {
        toast.error(`Antes de habilitar la facturación, completá y guardá: ${faltan.join(' y ')} (en "Datos para los comprobantes").`, { duration: 8000 })
        return
      }
    }
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

  // ── Cutover mig 271 (v1.133.0): la identidad fiscal se ESCRIBE en `emisores_fiscales`
  // (fuente única). El trigger `trg_espejo_emisor_default_a_tenant` espeja el default a
  // `tenants.*` (solo-lectura legacy) — por eso tras cada save se RELEE tenants para el store.
  // La duplicación con doble escritura fue la causa raíz del CUIT vacío (v1.62→v1.131).

  /** id del emisor default del tenant, o null si aún no existe (tenant sin CUIT cargado). */
  const emisorDefaultId = async (): Promise<string | null> => {
    const { data, error } = await supabase.from('emisores_fiscales')
      .select('id').eq('tenant_id', tenant!.id).eq('es_default', true).maybeSingle()
    if (error) throw error
    return data?.id ?? null
  }

  /** Relee el tenant YA espejado por el trigger de DB y refresca el store Zustand. */
  const refrescarTenant = async () => {
    const { data, error } = await supabase.from('tenants').select('*').eq('id', tenant!.id).single()
    if (error || !data) throw (error ?? new Error('No se pudo releer la configuración'))
    setTenant(data)
    return data
  }

  /** Escribe el logo en la identidad fiscal si existe (espejo → tenants); si no, en tenants. */
  const persistirLogo = async (url: string | null) => {
    const defId = await emisorDefaultId()
    if (defId) {
      const { error } = await supabase.from('emisores_fiscales')
        .update({ logo_url: url, updated_at: new Date().toISOString() }).eq('id', defId)
      if (error) throw error
    } else {
      const { error } = await supabase.from('tenants').update({ logo_url: url }).eq('id', tenant!.id)
      if (error) throw error
    }
    return refrescarTenant()
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !tenant) return
    if (!file.type.startsWith('image/')) { toast.error('Subí una imagen (PNG/JPG)'); return }
    if (file.size > 2 * 1024 * 1024) { toast.error('La imagen no puede superar los 2 MB'); return }
    setUploadingLogo(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
      const path = `${tenant.id}/logo.${ext}`
      const { error: upErr } = await supabase.storage.from('logos').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path)
      const publicUrl = urlData.publicUrl + `?t=${Date.now()}` // cache-bust
      await persistirLogo(publicUrl)
      setBizLogoUrl(publicUrl)
      toast.success('Logo actualizado')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al subir el logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleQuitarLogo = async () => {
    if (!tenant) return
    setUploadingLogo(true)
    try {
      await persistirLogo(null)
      setBizLogoUrl('')
      toast.success('Logo quitado')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al quitar el logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleSaveFacturacion = async () => {
    setSavingFact(true)
    try {
      const cuit = bizCuit.trim() || null
      const identidad = {
        cuit,
        condicion_iva_emisor: bizCondIva || null,
        razon_social_fiscal: bizRazonSocial.trim() || null,
        domicilio_fiscal: bizDomicilioFiscal.trim() || null,
        umbral_factura_b: parseFloat(bizUmbralB) || 68305.16,
        afipsdk_token: bizAfipToken.trim() || null,
        ingresos_brutos: bizIngBrutos.trim() || null,
        inicio_actividades: bizInicioAct || null,
        banco: bizBanco.trim() || null,
        cbu: bizCbu.trim() || null,
        alias_cbu: bizAliasCbu.trim() || null,
        leyenda_comprobante: bizLeyenda.trim() || null,
      }
      if (cuit) {
        // Fuente única: la identidad va a emisores_fiscales (el espejo DB actualiza tenants.*)
        const defId = await emisorDefaultId()
        const { error } = defId
          ? await supabase.from('emisores_fiscales')
              .update({ ...identidad, updated_at: new Date().toISOString() }).eq('id', defId)
          : await supabase.from('emisores_fiscales').insert({
              ...identidad,
              tenant_id: tenant!.id,
              nombre: identidad.razon_social_fiscal ?? tenant?.nombre ?? 'Emisor principal',
              es_default: true, activo: true,
            })
        if (error) throw error
        // sitio_web es contacto del NEGOCIO (no identidad fiscal) → sigue en tenants
        const { error: tErr } = await supabase.from('tenants')
          .update({ sitio_web: bizSitioWeb.trim() || null }).eq('id', tenant!.id)
        if (tErr) throw tErr
      } else {
        // Sin CUIT no hay identidad fiscal que representar → legacy: solo tenants
        // (cuando cargue el CUIT, el save crea el emisor default con TODO el form)
        const { error } = await supabase.from('tenants').update({
          ...identidad, sitio_web: bizSitioWeb.trim() || null,
        }).eq('id', tenant!.id)
        if (error) throw error
      }
      const data = await refrescarTenant()
      setBizAfipProduccion(data.afip_produccion ?? bizAfipProduccion)
      toast.success('Datos fiscales guardados')
    } catch (err: any) {
      // El PostgrestError NO es instanceof Error → leer .message directo (lección del alta de
      // emisor de Fede). P.ej.: CUIT duplicado con un emisor adicional → unique(tenant_id,cuit).
      toast.error(err?.message ?? 'No se pudo guardar')
    } finally {
      setSavingFact(false)
    }
  }

  // Modo de emisión: pasar a producción exige CUIT + token GUARDADOS (no solo tipeados)
  const afipDatosListos = !!(tenant as any)?.cuit && !!(tenant as any)?.afipsdk_token
  const persistAfipProduccion = async (nuevoValor: boolean) => {
    setSavingProd(true)
    try {
      // 🛑 afip_produccion es POR EMISOR (fuente única, mig 271). El toggle de esta sección
      // gobierna al emisor PRINCIPAL; el espejo DB propaga a tenants.* para lectores legacy.
      const defId = await emisorDefaultId()
      if (defId) {
        const { error } = await supabase.from('emisores_fiscales')
          .update({ afip_produccion: nuevoValor, updated_at: new Date().toISOString() })
          .eq('id', defId)
        if (error) throw error
      } else {
        // Tenant sin identidad fiscal todavía (sin CUIT): legacy — no debería pasar porque
        // afipDatosListos exige CUIT guardado, pero no rompemos si pasa.
        const { error } = await supabase.from('tenants')
          .update({ afip_produccion: nuevoValor }).eq('id', tenant!.id)
        if (error) throw error
      }
      await refrescarTenant()
      setBizAfipProduccion(nuevoValor)
      return true
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo cambiar el modo de emisión')
      return false
    } finally {
      setSavingProd(false)
    }
  }
  const toggleAfipProduccion = async () => {
    if (bizAfipProduccion) {
      // Volver a homologación es seguro → directo
      const ok = await persistAfipProduccion(false)
      if (ok) toast.success('Modo de emisión: HOMOLOGACIÓN (sin valor fiscal)')
      return
    }
    // Pasar a PRODUCCIÓN → confirmación explícita
    if (!afipDatosListos) {
      toast.error('Primero guardá CUIT y Token AfipSDK antes de pasar a producción')
      return
    }
    setProdAck(false)
    setShowProdConfirm(true)
  }
  const confirmActivarProduccion = async () => {
    if (!prodAck) return
    const ok = await persistAfipProduccion(true)
    if (ok) {
      setShowProdConfirm(false)
      toast.success('Modo de emisión: PRODUCCIÓN — se emitirán comprobantes fiscales REALES')
    }
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
      // Cubicaje (mig 322). El factor se guarda como fracción; la UI lo muestra en %.
      // Se acota a (0, 1] acá además del CHECK de la tabla: si el input queda vacío o en 0, un
      // factor 0 dejaría la capacidad útil en 0 m³ y toda ubicación aparecería excedida.
      cubicaje_habilitado: bizCubicaje,
      cubicaje_factor_aprovechamiento: (() => {
        const pct = Number(bizCubicajeFactor)
        return Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct / 100 : FACTOR_APROVECHAMIENTO_DEFAULT
      })(),
      // Motor de Rotación de productos con descuento (A1/A2/A3) — default a nivel tenant, cae en
      // cascada desde categoría/producto vía fn_rotacion_reglas_efectivas. Matriz de compatibilidad
      // (1+3 bloqueado) la hace cumplir el CHECK de la tabla — acá solo se evita mandar un combo que
      // el usuario ya vio bloqueado en la UI.
      rotacion_agotar_antes_reponer: bizRotacionAgotar,
      rotacion_prioridad_envios: bizRotacionEnvios,
      rotacion_armar_kits: bizRotacionKits,
      rotacion_ubicacion_excepcion_id: bizRotacionUbicacionExcepcion || null,
      conteo_modo: bizConteoModo,
      ajuste_autorizacion_roles: Object.keys(bizAjusteRoles).length ? bizAjusteRoles : null,
      conteo_gate_activo: bizConteoGate.activo,
      conteo_gate_umbral_u: bizConteoGate.gateU !== '' ? Number(bizConteoGate.gateU) : null,
      conteo_gate_umbral_pct: bizConteoGate.gatePct !== '' ? Number(bizConteoGate.gatePct) : null,
      conteo_gate_umbral_valor: bizConteoGate.gateValor !== '' ? Number(bizConteoGate.gateValor) : null,
      conteo_reconteo_umbral_u: bizConteoGate.recU !== '' ? Number(bizConteoGate.recU) : null,
      conteo_reconteo_umbral_pct: bizConteoGate.recPct !== '' ? Number(bizConteoGate.recPct) : null,
      conteo_reconteo_umbral_valor: bizConteoGate.recValor !== '' ? Number(bizConteoGate.recValor) : null,
      conteo_ciclico_dias_a: parseInt(bizConteoCiclo.a) || 30,
      conteo_ciclico_dias_b: parseInt(bizConteoCiclo.b) || 90,
      conteo_ciclico_dias_c: parseInt(bizConteoCiclo.c) || 180,
      conteo_wall_to_wall_bloquea: bizConteoWtwBloquea,
      presupuesto_validez_dias: parseInt(bizPresupuestoValidez) || 30,
      alerta_margen_negativo: bizAlertaMargenNeg,
      alerta_devoluciones_n: bizAlertaDevN !== '' ? parseInt(bizAlertaDevN) : null,
      alerta_devoluciones_dias: parseInt(bizAlertaDevDias) || 30,
      // Reservas (E1/E2/E6)
      reserva_sena_obligatoria: bizReservaSenaObligatoria,
      reserva_sena_minima_pct: parseFloat(bizReservaSenaMinimaPct) || 0,
      reserva_vencimiento_dias: bizReservaVencimientoDias.trim() === '' ? null : (parseInt(bizReservaVencimientoDias) || null),
      reserva_penalidad_pct: parseFloat(bizReservaPenalidadPct) || 0,
      // Cuenta Corriente clientes (CL2 · B1/B3/B4)
      cc_enforcement_politica: bizCCEnforcement,
      cc_morosidad_politica: bizCCMorosidad,
      limite_cc_default: bizCCLimiteDefault.trim() === '' ? null : (parseFloat(bizCCLimiteDefault) || null),
      cc_dias_vencimiento: bizCCDiasVenc.trim() === '' ? null : (parseInt(bizCCDiasVenc) || null),
      cc_interes_mensual_pct: parseFloat(bizCCInteresMensual) || 0,
      // Notificaciones de CC (CL4)
      cc_notif_canales: bizCCNotifCanales,
      cc_notif_registro_deuda: bizCCNotifRegistroDeuda,
      cc_notif_pago: bizCCNotifPago,
      cc_notif_pre_venc_dias: bizCCPreVencDias.trim() === '' ? null : (parseInt(bizCCPreVencDias) || null),
      cumple_notif_cliente: bizCumpleCliente,
      cumple_notif_duenio: bizCumpleDuenio,
      whatsapp_plantilla: bizWAPlantilla.trim() || null,
      costo_envio_por_km: bizCostoKm ? parseFloat(bizCostoKm) : null,
      envio_peso_fuente: bizPesoFuente,
      envio_rangos_horarios: bizEnvioRangos.filter(r => r.desde && r.hasta),
      // EN1 — pagos a courier contables
      envio_courier_genera_gasto: bizCourierGeneraGasto,
      envio_courier_iva_pct: parseFloat(bizCourierIvaPct) || 0,
      envio_pago_doble_firma_umbral: parseFloat(bizEnvioDobleFirma) || 0,
      // EN2 — POD robusto
      pod_campos_requeridos: bizPodReq,
      pod_foto_min: parseInt(bizPodFotoMin) || 0,
      pod_otp_umbral: parseFloat(bizPodOtpUmbral) || 0,
      envio_geoloc_alerta_km: parseFloat(bizGeolocAlertaKm) || 0,
      envio_reintentos_max: parseInt(bizReintentosMax) || 3,
      envio_reintento_recargo: parseFloat(bizReintentoRecargo) || 0,
      // EN3 — reparto
      envio_token_politica: bizTokenPolitica,
      envio_token_dias: parseInt(bizTokenDias) || 30,
      envio_identidad_modo: bizIdentidadModo,
      envio_notif_en_camino: bizNotifEnCamino,
      envio_hoja_ruta_modo: bizHojaRutaModo,
      // EN4 — costos y tarifas
      envio_factor_km: parseFloat(bizFactorKm) || 1.35,
      envio_costo_minimo: parseFloat(bizCostoMinimo) || 0,
      envio_tramos: bizTramos.filter(t => t.hasta && t.precio).map(t => ({ hasta: parseFloat(t.hasta), precio: parseFloat(t.precio) })),
      envio_recargo_horario: bizRecargoHorario.filter(r => r.desde && r.hasta && r.recargo).map(r => ({ desde: r.desde, hasta: r.hasta, recargo: parseFloat(r.recargo) })),
      envio_cobro_politica: bizCobroPolitica,
      envio_cobro_margen_pct: parseFloat(bizCobroMargen) || 0,
      envio_subsidio_umbral: parseFloat(bizSubsidioUmbral) || 0,
      // v2 multi-regla (punto 7): shape { reglas: [...] } — el POS la lee vía normalizarReglasGratis
      envio_gratis_reglas: {
        reglas: bizGratisReglas
          .map(r => ({
            montoMinimo: r.montoMinimo ? parseFloat(r.montoMinimo) : null,
            etiquetas: r.etiquetas.split(',').map(s => s.trim()).filter(Boolean),
            desde: r.desde || null,
            hasta: r.hasta || null,
            maxKm: r.maxKm ? parseFloat(r.maxKm) : null,
          }))
          .filter(r => r.montoMinimo || r.etiquetas.length > 0 || (r.desde && r.hasta) || r.maxKm),
      },
      // EN5 — creación/alcance
      envio_plazo_despacho: {
        presencial: parseFloat(bizPlazoPresencial) || 0,
        online: parseFloat(bizPlazoOnline) || 0,
        mayorista: parseFloat(bizPlazoMayorista) || 0,
      },
      cp_courier_preferido: bizCpCourier.filter(r => r.courier && (r.desde || r.hasta)).map(r => ({ desde: r.desde, hasta: r.hasta || r.desde, courier: r.courier })),
      // EN7 — envío propio (combustible) + umbrales de alertas
      envio_combustible_precio_litro: parseFloat(bizCombustiblePrecio) || 0,
      envio_alerta_sin_despacho_horas: parseInt(bizAlertaSinDespacho) || 24,
      envio_alerta_pod_pendiente_dias: parseInt(bizAlertaPodDias) || 3,
      envio_alerta_pago_courier_dias: parseInt(bizAlertaPagoDias) || 7,
      envio_alerta_diferencia_pct: parseFloat(bizAlertaDifPct) || 15,
      // Facturación — SOLO el switch on/off (tenant-level). La identidad fiscal (CUIT, razón
      // social, condición IVA, domicilio, umbral B, token) se escribe EXCLUSIVAMENTE vía
      // emisores_fiscales (handleSaveFacturacion / EmisoresFiscalesPanel) — cutover mig 271.
      // Escribirla acá reabriría el drift que causó el bug del CUIT vacío (v1.62→v1.131).
      facturacion_habilitada: bizFactHabilitada,
      // Fase 2
      precio_redondeo:       bizPrecioRedondeo,
      moneda:                bizMoneda,
      // Fase 3 — cliente en POS. El jsonb (mig 280) manda; el enum legacy se sincroniza al
      // valor más cercano para no romper lectores viejos.
      cliente_obligatorio:      bizClienteObligatorio,
      cliente_campos_requeridos: bizClienteCampos,
      cliente_datos_minimos:    enumLegacyDeCampos(bizClienteCampos),
      cliente_consumidor_final: bizClienteConsumidorFinal,
      cliente_creacion_inline:  bizClienteCreacionInline,
      // Fase 4 — descuentos y caja
      descuento_max_supervisor_pct: bizDescuentoMaxSupervisor ? parseFloat(bizDescuentoMaxSupervisor) : null,
      boveda_umbral_caja:           bizBovedaUmbral           ? parseFloat(bizBovedaUmbral)           : null,
      // RRHH (H4)
      rrhh_tardanza_modo:                  bizRrhhTardanzaModo,
      rrhh_tardanza_tolerancia_min:        Math.max(0, parseInt(bizRrhhTardanzaTol) || 0),
      rrhh_horas_mes_base:                 Math.max(1, parseInt(bizRrhhHorasMesBase) || 200),
      rrhh_horas_extra_requiere_aprobacion: bizRrhhHorasExtraAprob,
      rrhh_doc_alerta_dias:                Math.max(1, parseInt(bizRrhhDocAlertaDias) || 30),
      rrhh_nomina_supervisor_aprueba:      bizRrhhNominaSupAprueba,
    }

    // Clave maestra — se guarda HASHEADA vía RPC `set_clave_maestra` (NO en texto plano).
    // Validación anti-error: si se ingresó una clave nueva, debe repetirse igual y tener ≥6 chars.
    const claveNueva = bizClaveMaestra.trim()
    if (claveNueva) {
      if (claveNueva.length < 6) { toast.error('La clave maestra debe tener al menos 6 caracteres'); setSavingBiz(false); return }
      if (claveNueva !== bizClaveMaestraConfirm.trim()) { toast.error('Las claves maestras no coinciden — repetila igual'); setSavingBiz(false); return }
    }

    const { data, error } = await supabase.from('tenants')
      .update(updatePayload)
      .eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); setSavingBiz(false); return }

    let tenantData = data
    if (claveNueva) {
      const { error: claveErr } = await supabase.rpc('set_clave_maestra', { p_clave: claveNueva })
      if (claveErr) { toast.error(`Datos guardados, pero la clave maestra no se actualizó: ${claveErr.message}`); setSavingBiz(false); return }
      // Releer el tenant para reflejar la clave (hash) recién seteada + limpiar los campos.
      const { data: refreshed } = await supabase.from('tenants').select().eq('id', tenant!.id).single()
      if (refreshed) tenantData = refreshed
      setBizClaveMaestra(''); setBizClaveMaestraConfirm('')
    }
    setTenant(tenantData)
    toast.success(claveNueva ? 'Datos y clave maestra actualizados' : 'Datos actualizados')
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
    if (!(await confirmar('¿Eliminar esta categoría? Los gastos existentes mantendrán el nombre como texto.', { danger: true }))) return
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
      // CO1 — gobierno de OC
      oc_aprobacion_activa:            ocAprobActiva,
      oc_aprobacion_umbral:            ocAprobUmbral !== '' ? parseFloat(ocAprobUmbral) : null,
      oc_numeracion:                   ocNumeracion,
      oc_pago_doble_firma_umbral:      ocDobleFirmaUmbral !== '' ? parseFloat(ocDobleFirmaUmbral) : null,
      // CO3 — costos + recepción
      compras_costo_alerta_pct:        parseFloat(ocCostoAlertaPct) || 10,
      recepcion_remito_obligatorio:    ocRemitoObligatorio,
      recepcion_alerta_faltante_dias:  Math.max(1, parseInt(ocFaltanteAlertaDias) || 7),
      over_receipt_pct_max:            ocOverReceiptPct !== '' ? parseFloat(ocOverReceiptPct) : null,
      // CO6 — cheques
      cheques_alerta_dias:             Math.max(1, parseInt(chequesAlertaDias) || 7),
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
    if (!(await confirmar('¿Eliminar esta categoría?', { danger: true }))) return
    const old = (categorias as Item[]).find(c => c.id === id)
    const { error } = await supabase.from('categorias').delete().eq('id', id)
    if (error) toast.error('No se puede eliminar, tiene productos asociados'); else { toast.success('Eliminada'); qc.invalidateQueries({ queryKey: ['categorias'] }); logActividad({ entidad: 'categoria', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }
  // Motor de Rotación (A3) — override por categoría. `valor` en null = "usa el default del tenant"
  // (cae en cascada vía fn_rotacion_reglas_efectivas). El CHECK de la tabla bloquea 1+3 en la
  // misma fila; acá además se evita mandar el combo si la UI ya lo tiene deshabilitado.
  const updateCategoriaRotacion = async (id: string, campo: 'rotacion_agotar_antes_reponer' | 'rotacion_prioridad_envios' | 'rotacion_armar_kits' | 'rotacion_ubicacion_excepcion_id', valor: any) => {
    const { error } = await supabase.from('categorias').update({ [campo]: valor }).eq('id', id)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['categorias'] })
  }

  // Ubicaciones
  // Ocupación real por ubicación (mig 321). Los campos de capacidad de `ubicaciones` existían desde
  // la mig 032 y no los leía ningún cálculo: se cargaban y no servían para nada.
  const { data: ocupacionUbic = {} } = useQuery({
    queryKey: ['ubicacion-ocupacion', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('vw_ubicacion_ocupacion')
        .select('ubicacion_id, lpn_activos, peso_kg, lineas_con_peso, lineas_total, volumen_m3, lineas_con_volumen')
        .eq('tenant_id', tenant!.id)
      return Object.fromEntries((data ?? []).map((r: any) => [r.ubicacion_id, r])) as Record<string, any>
    },
    enabled: !!tenant && tab === 'inventario',
  })

  // Cobertura de medición del catálogo (mig 322). Activar el cubicaje NO completa los SKU que ya
  // existen: sin este número el volumen ocupado parecería completo cuando no lo está.
  const { data: cubicajeCobertura } = useQuery({
    queryKey: ['cubicaje-cobertura', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_cubicaje_cobertura', { p_tenant_id: tenant!.id })
      if (error) throw error
      return (Array.isArray(data) ? data[0] : data) as
        { productos_total: number; productos_medidos: number; presentaciones_sin_medir: number } | null
    },
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'reglas',
  })

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
  const [newUbicSecuencia, setNewUbicSecuencia] = useState('')
  const [newUbicSucursalId, setNewUbicSucursalId] = useState<string>('')
  const [newUbicMonoSku, setNewUbicMonoSku] = useState(false)
  const [newUbicWmsOpen, setNewUbicWmsOpen] = useState(false)
  const [newUbicPadreId, setNewUbicPadreId] = useState('')
  const [newUbicCodigo, setNewUbicCodigo] = useState('')
  const [newUbicTipoLogico, setNewUbicTipoLogico] = useState<UbicacionTipoLogico | ''>('')
  const [newUbicSubtipo, setNewUbicSubtipo] = useState<UbicacionSubtipoAlmacenamiento | ''>('')
  const [newUbicAlto, setNewUbicAlto] = useState('')
  const [newUbicAncho, setNewUbicAncho] = useState('')
  const [newUbicLargo, setNewUbicLargo] = useState('')
  const [newUbicPeso, setNewUbicPeso] = useState('')
  const [newUbicPallets, setNewUbicPallets] = useState('')
  const [newUbicZonaId, setNewUbicZonaId] = useState('')
  const [editUbicId, setEditUbicId] = useState<string | null>(null)
  const [editUbicNombre, setEditUbicNombre] = useState('')
  const [editUbicDesc, setEditUbicDesc] = useState('')
  const [editUbicPrioridad, setEditUbicPrioridad] = useState('0')
  const [editUbicSecuencia, setEditUbicSecuencia] = useState('')
  const [editUbicPadreId, setEditUbicPadreId] = useState('')
  const [editUbicCodigo, setEditUbicCodigo] = useState('')
  const [editUbicTipoLogico, setEditUbicTipoLogico] = useState<UbicacionTipoLogico | ''>('')
  const [editUbicSubtipo, setEditUbicSubtipo] = useState<UbicacionSubtipoAlmacenamiento | ''>('')
  const [editUbicAlto, setEditUbicAlto] = useState('')
  const [editUbicAncho, setEditUbicAncho] = useState('')
  const [editUbicLargo, setEditUbicLargo] = useState('')
  const [editUbicPeso, setEditUbicPeso] = useState('')
  const [editUbicPallets, setEditUbicPallets] = useState('')
  const [editUbicWmsOpen, setEditUbicWmsOpen] = useState(false)
  const [editUbicMonoSku, setEditUbicMonoSku] = useState(false)
  const [editUbicSucursalId, setEditUbicSucursalId] = useState('')
  const [editUbicZonaId, setEditUbicZonaId] = useState('')
  const [ubicSearch, setUbicSearch] = useState('')

  const ubicacionesPorId = useMemo(() => new Map((ubicaciones as any[]).map(u => [u.id, u])), [ubicaciones])
  const ubicacionesOrdenadas = useMemo(() => ordenarArbolUbicaciones(ubicaciones as any[]), [ubicaciones])
  const opcionesPadreNuevo = useMemo(() =>
    (ubicaciones as any[])
      .map(u => ({ id: u.id, label: breadcrumbUbicacion(u.id, ubicacionesPorId) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [ubicaciones, ubicacionesPorId])
  const opcionesPadreEdit = useMemo(() => {
    if (!editUbicId) return opcionesPadreNuevo
    const excluir = new Set([editUbicId, ...descendientesDeUbicacion(editUbicId, ubicaciones as any[])])
    return opcionesPadreNuevo.filter(o => !excluir.has(o.id))
  }, [opcionesPadreNuevo, editUbicId, ubicaciones])

  const addUbicacion = async () => {
    if (!newUbicNombre.trim()) return
    const codigoLimpio = newUbicCodigo.trim().toUpperCase()
    if (codigoLimpio && !CODIGO_UBICACION_REGEX.test(codigoLimpio)) {
      toast.error('Código inválido — usá letras/números en mayúscula separados por guiones (ej. A-03-02), o dejalo vacío para autogenerarlo')
      return
    }
    const sucId = newUbicSucursalId || sucursalId || null
    const { error } = await supabase.from('ubicaciones').insert({
      tenant_id: tenant!.id,
      nombre: newUbicNombre.trim(),
      descripcion: newUbicDesc || null,
      prioridad: parseInt(newUbicPrioridad) || 0,
      secuencia: newUbicSecuencia !== '' ? parseInt(newUbicSecuencia) : null,
      sucursal_id: sucId,
      mono_sku: newUbicMonoSku,
      padre_ubicacion_id: newUbicPadreId || null,
      codigo: codigoLimpio || undefined,
      tipo_logico: newUbicTipoLogico || null,
      subtipo_almacenamiento: newUbicTipoLogico === 'almacenamiento' ? (newUbicSubtipo || null) : null,
      alto_cm: newUbicAlto ? parseFloat(newUbicAlto) : null,
      ancho_cm: newUbicAncho ? parseFloat(newUbicAncho) : null,
      largo_cm: newUbicLargo ? parseFloat(newUbicLargo) : null,
      peso_max_kg: newUbicPeso ? parseFloat(newUbicPeso) : null,
      capacidad_pallets: newUbicPallets ? parseInt(newUbicPallets) : null,
      zona_id: newUbicZonaId || null,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Ubicación agregada')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    logActividad({ entidad: 'ubicacion', entidad_nombre: newUbicNombre.trim(), accion: 'crear', pagina: '/configuracion' })
    setNewUbicNombre(''); setNewUbicDesc(''); setNewUbicPrioridad('0'); setNewUbicSecuencia('')
    setNewUbicSucursalId(''); setNewUbicMonoSku(false); setNewUbicWmsOpen(false)
    setNewUbicPadreId(''); setNewUbicCodigo(''); setNewUbicTipoLogico(''); setNewUbicSubtipo('')
    setNewUbicAlto(''); setNewUbicAncho(''); setNewUbicLargo(''); setNewUbicPeso(''); setNewUbicPallets(''); setNewUbicZonaId('')
  }
  const startEditUbic = (u: any) => {
    setEditUbicId(u.id)
    setEditUbicNombre(u.nombre)
    setEditUbicDesc(u.descripcion ?? '')
    setEditUbicPrioridad(String(u.prioridad ?? 0))
    setEditUbicSecuencia(u.secuencia != null ? String(u.secuencia) : '')
    setEditUbicPadreId(u.padre_ubicacion_id ?? '')
    setEditUbicCodigo(u.codigo ?? '')
    setEditUbicTipoLogico(u.tipo_logico ?? '')
    setEditUbicSubtipo(u.subtipo_almacenamiento ?? '')
    setEditUbicAlto(u.alto_cm != null ? String(u.alto_cm) : '')
    setEditUbicAncho(u.ancho_cm != null ? String(u.ancho_cm) : '')
    setEditUbicLargo(u.largo_cm != null ? String(u.largo_cm) : '')
    setEditUbicPeso(u.peso_max_kg != null ? String(u.peso_max_kg) : '')
    setEditUbicPallets(u.capacidad_pallets != null ? String(u.capacidad_pallets) : '')
    setEditUbicWmsOpen(!!(u.tipo_logico || u.alto_cm || u.ancho_cm || u.largo_cm || u.peso_max_kg || u.capacidad_pallets))
    setEditUbicMonoSku(u.mono_sku ?? false)
    setEditUbicSucursalId(u.sucursal_id ?? '')
    setEditUbicZonaId(u.zona_id ?? '')
  }
  const saveUbicacion = async (id: string) => {
    const old = (ubicaciones as any[]).find(u => u.id === id)
    const codigoLimpio = editUbicCodigo.trim().toUpperCase()
    if (!codigoLimpio) { toast.error('El código no puede quedar vacío'); return }
    if (!CODIGO_UBICACION_REGEX.test(codigoLimpio)) {
      toast.error('Código inválido — usá letras/números en mayúscula separados por guiones (ej. A-03-02)')
      return
    }
    const { error } = await supabase.from('ubicaciones').update({
      nombre: editUbicNombre.trim(),
      descripcion: editUbicDesc || null,
      prioridad: parseInt(editUbicPrioridad) || 0,
      secuencia: editUbicSecuencia !== '' ? parseInt(editUbicSecuencia) : null,
      padre_ubicacion_id: editUbicPadreId || null,
      codigo: codigoLimpio,
      tipo_logico: editUbicTipoLogico || null,
      subtipo_almacenamiento: editUbicTipoLogico === 'almacenamiento' ? (editUbicSubtipo || null) : null,
      alto_cm: editUbicAlto ? parseFloat(editUbicAlto) : null,
      ancho_cm: editUbicAncho ? parseFloat(editUbicAncho) : null,
      largo_cm: editUbicLargo ? parseFloat(editUbicLargo) : null,
      peso_max_kg: editUbicPeso ? parseFloat(editUbicPeso) : null,
      capacidad_pallets: editUbicPallets ? parseInt(editUbicPallets) : null,
      mono_sku: editUbicMonoSku,
      sucursal_id: editUbicSucursalId || null,
      zona_id: editUbicZonaId || null,
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Actualizada')
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    logActividad({ entidad: 'ubicacion', entidad_id: id, entidad_nombre: editUbicNombre, accion: 'editar', campo: 'nombre', valor_anterior: old?.nombre ?? null, valor_nuevo: editUbicNombre, pagina: '/configuracion' })
    setEditUbicId(null)
  }
  const deleteUbicacion = async (id: string) => {
    const old = (ubicaciones as any[]).find(u => u.id === id)

    // 0. Bloquear si tiene niveles hijos (padre_ubicacion_id es RESTRICT, mig 334) — mensaje
    // claro en vez del error genérico de FK que tiraría Postgres.
    if ((ubicaciones as any[]).some(u => u.padre_ubicacion_id === id)) {
      toast.error('No se puede eliminar: tiene niveles adentro. Eliminá o reasigná sus niveles primero.')
      return
    }

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
    if (!(await confirmar(msg, { danger: true }))) return

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

  // ── Zonas + reglas de almacenaje + reabastecimiento (WMS Fase 3-5) ────────────────────
  const { data: zonas = [], isLoading: loadingZonas } = useQuery({
    queryKey: ['zonas', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('zonas').select('*').eq('tenant_id', tenant!.id).order('nombre'); return data ?? [] },
    enabled: !!tenant && tab === 'inventario',
  })
  const [newZonaNombre, setNewZonaNombre] = useState('')
  const [newZonaDesc, setNewZonaDesc] = useState('')
  const [newZonaSucursalId, setNewZonaSucursalId] = useState('')
  const [editZonaId, setEditZonaId] = useState<string | null>(null)
  const [editZonaNombre, setEditZonaNombre] = useState('')
  const [editZonaDesc, setEditZonaDesc] = useState('')
  const [editZonaSucursalId, setEditZonaSucursalId] = useState('')

  const addZona = async () => {
    if (!newZonaNombre.trim()) return
    const { error } = await supabase.from('zonas').insert({
      tenant_id: tenant!.id, nombre: newZonaNombre.trim(), descripcion: newZonaDesc || null,
      sucursal_id: newZonaSucursalId || sucursalId || null,
    })
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['zonas'] })
    logActividad({ entidad: 'zona', entidad_nombre: newZonaNombre.trim(), accion: 'crear', pagina: '/configuracion' })
    setNewZonaNombre(''); setNewZonaDesc(''); setNewZonaSucursalId('')
    toast.success('Zona creada')
  }
  const startEditZona = (z: any) => {
    setEditZonaId(z.id); setEditZonaNombre(z.nombre); setEditZonaDesc(z.descripcion ?? ''); setEditZonaSucursalId(z.sucursal_id ?? '')
  }
  const saveZona = async (id: string) => {
    if (!editZonaNombre.trim()) return
    const { error } = await supabase.from('zonas').update({
      nombre: editZonaNombre.trim(), descripcion: editZonaDesc || null, sucursal_id: editZonaSucursalId || null,
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['zonas'] })
    setEditZonaId(null)
    toast.success('Zona actualizada')
  }
  const deleteZona = async (id: string) => {
    const z = (zonas as any[]).find(x => x.id === id)
    if (!(await confirmar(`¿Eliminar la zona "${z?.nombre}"? Las ubicaciones que la usen quedarán sin zona.`, { danger: true }))) return
    const { error } = await supabase.from('zonas').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['zonas'] })
    qc.invalidateQueries({ queryKey: ['ubicaciones'] })
    toast.success('Zona eliminada')
  }

  // Reglas de almacenaje: UdM → zona sugerida (sugerencia editable, nunca bloquea)
  const { data: reglasAlmacenaje = [] } = useQuery({
    queryKey: ['reglas_almacenaje', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('reglas_almacenaje').select('*').eq('tenant_id', tenant!.id); return data ?? [] },
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'zonas',
  })
  const setReglaAlmacenaje = async (unidadMedidaId: string, zonaId: string) => {
    if (!zonaId) {
      const { error } = await supabase.from('reglas_almacenaje').delete().eq('tenant_id', tenant!.id).eq('unidad_medida_id', unidadMedidaId)
      if (error) { toast.error(error.message); return }
    } else {
      const { error } = await supabase.from('reglas_almacenaje')
        .upsert({ tenant_id: tenant!.id, unidad_medida_id: unidadMedidaId, zona_id: zonaId }, { onConflict: 'tenant_id,unidad_medida_id' })
      if (error) { toast.error(error.message); return }
    }
    qc.invalidateQueries({ queryKey: ['reglas_almacenaje'] })
  }

  // Reabastecimiento: 2 flags independientes + umbrales por producto+ubicación
  const t289 = tenant as any
  const toggleReabOnDemand = async () => {
    const nuevo = !t289?.wms_reabastecimiento_on_demand
    const { data, error } = await supabase.from('tenants').update({ wms_reabastecimiento_on_demand: nuevo }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    toast.success(nuevo ? 'Reabastecimiento on-demand habilitado' : 'Reabastecimiento on-demand deshabilitado')
  }
  const toggleReabUmbral = async () => {
    const nuevo = !t289?.wms_reabastecimiento_umbral
    const { data, error } = await supabase.from('tenants').update({ wms_reabastecimiento_umbral: nuevo }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    toast.success(nuevo ? 'Reabastecimiento por umbral habilitado' : 'Reabastecimiento por umbral deshabilitado')
  }

  // Armado automático (D2): operario al que nace pre-asignada la tarea de armado que genera
  // solo una orden de TN/MELI (sin operario logueado que la tome a mano en el momento).
  const { data: usuariosArmado = [] } = useQuery({
    queryKey: ['usuarios-armado-default', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, nombre_display, rol').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre_display')
      return data ?? []
    },
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'zonas',
  })
  const actualizarOperarioArmadoDefault = async (usuarioId: string) => {
    const { data, error } = await supabase.from('tenants').update({ wms_armado_operario_default_id: usuarioId || null }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    toast.success(usuarioId ? 'Operario por defecto actualizado' : 'Armado automático queda sin operario por defecto')
  }

  // A2 del relevamiento de Supervisor (mig 348): reglas de enrutamiento "tipo X -> Usuario A" para
  // la auto-asignación de autorizaciones al crearse (si no hay regla, el trigger reparte por carga).
  const SUPERVISION_TIPOS_INVENTARIO: { key: string; label: string }[] = [
    { key: 'ajuste_cantidad', label: 'Ajuste de cantidad' },
    { key: 'ajuste_conteo', label: 'Diferencia de conteo' },
    { key: 'bulk_edit', label: 'Edición masiva' },
    { key: 'eliminar_serie', label: 'Eliminar serie' },
    { key: 'eliminar_lpn', label: 'Eliminar LPN' },
    { key: 'cambio_estado', label: 'Cambio de estado' },
    { key: 'kit_precio', label: 'Precio de KIT' },
    { key: 'repricing_margen', label: 'Repricing por margen' },
  ]
  const { data: usuariosSupervisanInventario = [] } = useQuery({
    queryKey: ['usuarios-supervisan-inventario', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, nombre_display, rol, rol_custom_id, roles_custom(permisos)')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return (data ?? [])
        .map((u: any) => ({ ...u, permisos_custom: u.roles_custom?.permisos ?? null }))
        .filter((u: any) => puedeSupervisarModulo(u, 'inventario'))
    },
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'zonas',
  })
  const { data: reglasEnrutamiento = [], refetch: refetchReglasEnrutamiento } = useQuery({
    queryKey: ['reglas-enrutamiento', tenant?.id, 'inventario'],
    queryFn: async () => {
      const { data } = await supabase.from('autorizaciones_reglas_enrutamiento')
        .select('id, tipo, usuario_id').eq('tenant_id', tenant!.id).eq('modulo', 'inventario')
      return data ?? []
    },
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'zonas',
  })
  const actualizarReglaEnrutamiento = async (tipo: string, usuarioId: string) => {
    if (!usuarioId) {
      const { error } = await supabase.from('autorizaciones_reglas_enrutamiento')
        .delete().eq('tenant_id', tenant!.id).eq('modulo', 'inventario').eq('tipo', tipo)
      if (error) { toast.error(error.message); return }
    } else {
      const { error } = await supabase.from('autorizaciones_reglas_enrutamiento')
        .upsert({ tenant_id: tenant!.id, modulo: 'inventario', tipo, usuario_id: usuarioId }, { onConflict: 'tenant_id,modulo,tipo' })
      if (error) { toast.error(error.message); return }
    }
    toast.success('Regla de asignación actualizada')
    refetchReglasEnrutamiento()
  }

  // D3 — Repricing automático por margen objetivo (mecanismo 1). Config a nivel tenant (B2/B5):
  // el ajuste es único, igual en G360 y todos los canales — no hay nada "por canal" acá (eso es
  // el mecanismo 2, que vive en la ficha del producto).
  const actualizarRepricingConfig = async (campos: Record<string, unknown>) => {
    const { data, error } = await supabase.from('tenants').update(campos).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    toast.success('Configuración de repricing actualizada')
  }

  const { data: umbrales = [], isLoading: loadingUmbrales } = useQuery({
    queryKey: ['producto_ubicacion_umbrales', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('producto_ubicacion_umbrales')
        .select('*, productos(nombre, sku), ubicaciones(nombre)').eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'zonas',
  })
  const ubicacionesPicking = (ubicaciones as any[]).filter(u => u.tipo_logico === 'picking')
  const [umbralProdBusqueda, setUmbralProdBusqueda] = useState('')
  const { data: umbralProdResultados = [] } = useQuery({
    queryKey: ['productos-busqueda-umbral', tenant?.id, umbralProdBusqueda],
    queryFn: async () => {
      const { data } = await supabase.from('productos').select('id, nombre, sku').eq('tenant_id', tenant!.id).eq('activo', true)
        .ilike('nombre', `%${umbralProdBusqueda}%`).limit(8)
      return data ?? []
    },
    enabled: !!tenant && umbralProdBusqueda.trim().length >= 2,
  })
  const [umbralProdSel, setUmbralProdSel] = useState<{ id: string; nombre: string } | null>(null)
  const [umbralUbicId, setUmbralUbicId] = useState('')
  const [umbralMin, setUmbralMin] = useState('')
  const [umbralMax, setUmbralMax] = useState('')

  const addUmbral = async () => {
    if (!umbralProdSel || !umbralUbicId || !umbralMin.trim()) return
    const { error } = await supabase.from('producto_ubicacion_umbrales').upsert({
      tenant_id: tenant!.id, producto_id: umbralProdSel.id, ubicacion_id: umbralUbicId,
      stock_minimo: parseInt(umbralMin) || 0, stock_maximo: umbralMax.trim() ? parseInt(umbralMax) : null,
    }, { onConflict: 'tenant_id,producto_id,ubicacion_id' })
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['producto_ubicacion_umbrales'] })
    setUmbralProdSel(null); setUmbralProdBusqueda(''); setUmbralUbicId(''); setUmbralMin(''); setUmbralMax('')
    toast.success('Umbral guardado')
  }
  const deleteUmbral = async (id: string) => {
    const { error } = await supabase.from('producto_ubicacion_umbrales').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['producto_ubicacion_umbrales'] })
  }

  // ── Pedidos (PED7): numeración, tipos de pedido, cierre automático ────────────────────
  const { data: tiposPedidoCfg = [], isLoading: loadingTiposPedido } = useQuery({
    queryKey: ['tipos_pedido_cfg', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('tipos_pedido').select('*').eq('tenant_id', tenant!.id).order('orden')
      return data ?? []
    },
    enabled: !!tenant && tab === 'pedidos',
  })
  const [newTipoPedidoNombre, setNewTipoPedidoNombre] = useState('')
  const [newTipoPedidoFactura, setNewTipoPedidoFactura] = useState<'al_confirmar' | 'al_entregar'>('al_entregar')
  const [newTipoPedidoClienteOblig, setNewTipoPedidoClienteOblig] = useState(true)
  const [editTipoPedidoId, setEditTipoPedidoId] = useState<string | null>(null)
  const [editTipoPedidoNombre, setEditTipoPedidoNombre] = useState('')
  const [editTipoPedidoFactura, setEditTipoPedidoFactura] = useState<'al_confirmar' | 'al_entregar'>('al_entregar')
  const [editTipoPedidoClienteOblig, setEditTipoPedidoClienteOblig] = useState(true)

  const addTipoPedido = async () => {
    if (!newTipoPedidoNombre.trim()) return
    const orden = ((tiposPedidoCfg as any[])[tiposPedidoCfg.length - 1]?.orden ?? 0) + 10
    const { error } = await supabase.from('tipos_pedido').insert({
      tenant_id: tenant!.id, nombre: newTipoPedidoNombre.trim(),
      factura_momento: newTipoPedidoFactura, cliente_obligatorio: newTipoPedidoClienteOblig, orden,
    })
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['tipos_pedido_cfg'] })
    qc.invalidateQueries({ queryKey: ['tipos_pedido'] })
    logActividad({ entidad: 'pedido', entidad_nombre: `Tipo: ${newTipoPedidoNombre.trim()}`, accion: 'crear', pagina: '/configuracion' })
    setNewTipoPedidoNombre(''); setNewTipoPedidoFactura('al_entregar'); setNewTipoPedidoClienteOblig(true)
    toast.success('Tipo de pedido creado')
  }
  const startEditTipoPedido = (t: any) => {
    setEditTipoPedidoId(t.id); setEditTipoPedidoNombre(t.nombre)
    setEditTipoPedidoFactura(t.factura_momento); setEditTipoPedidoClienteOblig(t.cliente_obligatorio)
  }
  const saveTipoPedido = async (id: string) => {
    if (!editTipoPedidoNombre.trim()) return
    const { error } = await supabase.from('tipos_pedido').update({
      nombre: editTipoPedidoNombre.trim(), factura_momento: editTipoPedidoFactura, cliente_obligatorio: editTipoPedidoClienteOblig,
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['tipos_pedido_cfg'] })
    qc.invalidateQueries({ queryKey: ['tipos_pedido'] })
    setEditTipoPedidoId(null)
    toast.success('Tipo de pedido actualizado')
  }
  const toggleActivoTipoPedido = async (t: any) => {
    const { error } = await supabase.from('tipos_pedido').update({ activo: !t.activo }).eq('id', t.id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['tipos_pedido_cfg'] })
    qc.invalidateQueries({ queryKey: ['tipos_pedido'] })
  }

  const setPedidoNumeracion = async (valor: 'tenant' | 'sucursal') => {
    const { data, error } = await supabase.from('tenants').update({ pedido_numeracion: valor }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    toast.success('Numeración de pedidos actualizada')
  }
  const togglePedidoManual = async () => {
    const nuevo = !(tenant as any)?.pedido_manual_habilitado
    const { data, error } = await supabase.from('tenants').update({ pedido_manual_habilitado: nuevo }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    toast.success(nuevo ? 'Ya podés crear pedidos a mano' : 'Los pedidos se generan solo desde las ventas')
  }
  const togglePedidoCierreAutomatico = async () => {
    const nuevo = !(tenant as any)?.pedido_cierre_automatico
    const { data, error } = await supabase.from('tenants').update({ pedido_cierre_automatico: nuevo }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    toast.success(nuevo ? 'Cierre automático habilitado' : 'Cierre automático deshabilitado — habrá que cerrar el pedido a mano al llegar al 100%')
  }

  // Canales que auto-generan pedido (mig 315). Se listan los canales de venta activos del tenant;
  // la config guarda ids, así que renombrar un canal no rompe la selección.
  const { data: canalesPedido = [] } = useQuery({
    queryKey: ['canales_venta_cfg_pedidos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('canales_venta')
        .select('id, nombre, activo').eq('tenant_id', tenant!.id).eq('activo', true)
        .order('orden', { ascending: true, nullsFirst: false }).order('nombre')
      return (data ?? []) as { id: string; nombre: string; activo: boolean }[]
    },
    enabled: !!tenant && tab === 'pedidos',
  })
  // Se sanea contra los canales vivos: un canal borrado/desactivado que quedó en la config no se
  // pinta como seleccionado ni se vuelve a guardar.
  const canalesAutoSel = canalesExcluidosValidos((tenant as any)?.pedido_canales_excluidos, canalesPedido)

  const togglePedidoCanalAuto = async (canalId: string) => {
    const nuevo = canalesAutoSel.includes(canalId)
      ? canalesAutoSel.filter(id => id !== canalId)
      : [...canalesAutoSel, canalId]
    const { data, error } = await supabase.from('tenants')
      .update({ pedido_canales_excluidos: nuevo }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
    const nombre = canalesPedido.find(c => c.id === canalId)?.nombre ?? 'El canal'
    toast.success(nuevo.includes(canalId)
      ? `Las ventas de ${nombre} ya NO van a generar pedido`
      : `${nombre} vuelve a generar pedido`)
  }

  // E3 — pedido_transiciones_roles: quién puede ejecutar cada transición. Ausente en la config
  // → default de código (puedeTransicionPedido); acá se materializa el default recién al primer
  // toggle de esa transición, para no escribir de más si nunca se tocó.
  const togglePedidoTransicionRol = async (transicion: typeof PEDIDO_TRANSICIONES[number]['key'], rol: string) => {
    const config = ((tenant as any)?.pedido_transiciones_roles ?? null) as PedidoTransicionesConfig
    const base = config?.[transicion] ?? PEDIDO_TRANSICION_ROLES_DEFAULT
    const nuevosRoles = base.includes(rol) ? base.filter(r => r !== rol) : [...base, rol]
    const nuevaConfig = { ...(config ?? {}), [transicion]: nuevosRoles }
    const { data, error } = await supabase.from('tenants').update({ pedido_transiciones_roles: nuevaConfig }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
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
    if (!(await confirmar('¿Eliminar este estado?', { danger: true }))) return
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
  // Descuento automático por estado (backlog Fede, punto 3) — se aplica solo, sin clave, al
  // vender stock que esté en este estado; se apila con otros descuentos de la venta.
  const updateEstadoDescuento = async (estadoId: string, pctStr: string) => {
    const trimmed = pctStr.trim()
    const pct = trimmed === '' ? null : parseFloat(trimmed.replace(',', '.'))
    if (pct !== null && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) {
      toast.error('El descuento debe ser mayor a 0 y hasta 100')
      qc.invalidateQueries({ queryKey: ['estados_inventario'] })
      return
    }
    const { error } = await supabase.from('estados_inventario').update({ descuento_pct: pct }).eq('id', estadoId)
    if (error) toast.error(error.message)
    else {
      toast.success(pct ? `Descuento automático ${pct}% asignado` : 'Descuento automático quitado')
      qc.invalidateQueries({ queryKey: ['estados_inventario'] })
    }
  }
  // Fede 25/7, punto 2: estados con "impacto económico" (Dañado, Vencido, Eliminado…) — cambiar
  // un lote a este estado va a requerir aprobación del supervisor + foto tomada en el momento.
  // Independiente de `descuento_pct`: un estado puede requerir aprobación sin tener descuento
  // (ej. "Eliminado" da de baja stock pero no tiene % de descuento asociado).
  const toggleRequiereAprobacion = async (estadoId: string, value: boolean) => {
    const { error } = await supabase.from('estados_inventario').update({ requiere_aprobacion: value }).eq('id', estadoId)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['estados_inventario'] })
  }
  // B2 (Motor de Rotación) — switch aparte de `descuento_pct`: un estado con descuento puede NO
  // disparar las reglas de Rotación (agotar antes de reponer / prioridad envíos / armar kits).
  const toggleDisparaRotacion = async (estadoId: string, value: boolean) => {
    const { error } = await supabase.from('estados_inventario').update({ dispara_rotacion: value }).eq('id', estadoId)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['estados_inventario'] })
  }
  // C3 (Motor de Rotación) — de las reglas que disparan Rotación, la Opción 1 (agotar antes de
  // reponer) SOLO cuenta motivo vencimiento, nunca otros motivos (ej. "Dañado"). Sin este flag no
  // hay forma de distinguir un estado del otro — son solo nombres libres por tenant.
  const toggleMotivoVencimiento = async (estadoId: string, value: boolean) => {
    const { error } = await supabase.from('estados_inventario').update({ motivo_vencimiento: value }).eq('id', estadoId)
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
    if (!(await confirmar('¿Eliminar este motivo?', { danger: true }))) return
    const old = (motivos as any[]).find(m => m.id === id)
    const { error } = await supabase.from('motivos_movimiento').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['motivos'] }); logActividad({ entidad: 'motivo', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/configuracion' }) }
  }

  // Atributos de variante (talle/color/encaje/formato/sabor·aroma) — catálogo por atributo
  const [atribVarianteTipo, setAtribVarianteTipo] = useState<AtributoVariante>('talle')
  const { data: atributoValores = [], isLoading: loadingAtributoValores } = useQuery({
    queryKey: ['atributo-variante-valores', tenant?.id, atribVarianteTipo],
    queryFn: async () => {
      const { data } = await supabase.from('atributos_variante_valores')
        .select('id, valor').eq('tenant_id', tenant!.id).eq('atributo', atribVarianteTipo).eq('activo', true)
        .order('orden').order('valor')
      return data ?? []
    },
    enabled: !!tenant,
  })
  const addAtributoValor = async (valor: string) => {
    const { error } = await supabase.from('atributos_variante_valores')
      .insert({ tenant_id: tenant!.id, atributo: atribVarianteTipo, valor })
    if (error) toast.error(/duplicate key|unique/i.test(error.message) ? 'Ese valor ya existe' : error.message)
    else { toast.success('Valor agregado'); qc.invalidateQueries({ queryKey: ['atributo-variante-valores'] }); logActividad({ entidad: 'atributo_variante', entidad_nombre: `${atribVarianteTipo}: ${valor}`, accion: 'crear', pagina: '/configuracion' }) }
  }
  const renameAtributoValor = async (id: string, valor: string) => {
    if (!valor.trim()) return
    const { error } = await supabase.from('atributos_variante_valores').update({ valor: valor.trim() }).eq('id', id)
    if (error) toast.error(/duplicate key|unique/i.test(error.message) ? 'Ese valor ya existe' : error.message)
    else { toast.success('Actualizado'); qc.invalidateQueries({ queryKey: ['atributo-variante-valores'] }) }
  }
  const deleteAtributoValor = async (id: string) => {
    const old = (atributoValores as any[]).find(v => v.id === id)
    if (!(await confirmar(`¿Eliminar "${old?.valor}"? Los ingresos de inventario que ya usaron este valor no se modifican.`, { danger: true }))) return
    const { error } = await supabase.from('atributos_variante_valores').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['atributo-variante-valores'] }); logActividad({ entidad: 'atributo_variante', entidad_id: id, entidad_nombre: old?.valor, accion: 'eliminar', pagina: '/configuracion' }) }
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
    if (!(await confirmar('¿Eliminar este aging profile? También se eliminarán sus reglas.', { danger: true }))) return
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

  // Multi-CUIT (F5): el emisor PRINCIPAL del tenant (es_default). Las secciones de
  // certificado y puntos de venta de este tab operan sobre ÉL; los emisores adicionales
  // se gestionan en EmisoresFiscalesPanel (cert y PV propios por emisor).
  const { data: emisorDefault } = useQuery({
    queryKey: ['emisor-fiscal-default', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('emisores_fiscales')
        .select('id').eq('tenant_id', tenant!.id).eq('es_default', true).maybeSingle()
      return data as { id: string } | null
    },
    enabled: !!tenant && tab === 'facturacion',
  })

  const { data: tenantCert, refetch: refetchCert } = useQuery<TenantCertificate | null>({
    queryKey: ['tenant-cert', tenant?.id, emisorDefault?.id],
    queryFn: async () => {
      // Puede haber un cert POR EMISOR (mig 268): esta sección muestra el del principal
      // (o la fila legacy sin emisor).
      const { data } = await supabase.from('tenant_certificates')
        .select('*').eq('tenant_id', tenant!.id)
      const rows = (data ?? []) as TenantCertificate[]
      return rows.find(c => !!emisorDefault?.id && c.emisor_id === emisorDefault.id)
        ?? rows.find(c => !c.emisor_id)
        ?? null
    },
    enabled: !!tenant && tab === 'facturacion',
  })

  const { data: puntosVentaAfipTodos = [], refetch: refetchPV } = useQuery({
    queryKey: ['puntos-venta-afip-config', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('puntos_venta_afip')
        .select('*').eq('tenant_id', tenant!.id).order('numero')
      return data ?? []
    },
    enabled: !!tenant && tab === 'facturacion',
  })
  // Esta sección lista solo los PV del emisor principal (los de emisores adicionales
  // viven en su panel; los legacy sin emisor cuentan como del principal).
  const puntosVentaAfip = (puntosVentaAfipTodos as { emisor_id?: string | null }[]).filter(
    pv => !pv.emisor_id || pv.emisor_id === emisorDefault?.id,
  )

  const handleSaveCert = async () => {
    if (!certCrtFile || !certKeyFile) { toast.error('Seleccioná los dos archivos (.crt y .key)'); return }
    if (!certCuit.trim()) { toast.error('El CUIT es obligatorio'); return }
    setSavingCert(true)
    try {
      await uploadCertificates(tenant!.id, certCrtFile, certKeyFile, certCuit, certValidez || null, emisorDefault?.id ?? null)
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
        // Fallback de seed. Lo normal es que el trigger de alta de tenant (migración 225)
        // ya cree estos métodos + la cuenta de origen Efectivo vinculada. Esto solo corre
        // en tenants viejos sin métodos: aseguramos la cuenta Efectivo y vinculamos el
        // método Efectivo a ella (el resto queda sin cuenta hasta que se configure).
        const { data: efCuenta } = await supabase.from('cuentas_origen')
          .select('id').eq('tenant_id', tenant!.id).ilike('nombre', 'efectivo').limit(1).maybeSingle()
        let efectivoCuentaId = efCuenta?.id ?? null
        if (!efectivoCuentaId) {
          const { data: nueva } = await supabase.from('cuentas_origen')
            .insert({ tenant_id: tenant!.id, nombre: 'Efectivo', tipo: 'efectivo', moneda: (tenant as any)?.moneda ?? 'ARS', activo: true })
            .select('id').single()
          efectivoCuentaId = nueva?.id ?? null
        }
        const { data: inserted } = await supabase.from('metodos_pago').insert(
          METODOS_DEFAULTS.map(d => ({ ...d, tenant_id: tenant!.id, activo: true, es_sistema: true,
            cuenta_origen_id: d.nombre === 'Efectivo' ? efectivoCuentaId : null }))
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

  // ── Descuento al cliente por método de pago (punto 1 Fede/GO, mig 281) ────────────────
  // Vive en metodos_pago.config.descuento — panel expandible por método.
  const [promoMetodoId, setPromoMetodoId] = useState<string | null>(null)
  const [promoForm, setPromoForm] = useState({ pct: '', tope: '', dias: [] as number[], desde: '', hasta: '' })
  const abrirPromoMetodo = (m: any) => {
    const d = descuentoDeConfig(m.config)
    setPromoForm({
      pct: d?.pct != null ? String(d.pct) : '',
      tope: d?.tope != null ? String(d.tope) : '',
      dias: d?.dias ?? [],
      desde: d?.desde ?? '',
      hasta: d?.hasta ?? '',
    })
    setPromoMetodoId(m.id)
  }
  const savePromoMetodo = useMutation({
    mutationFn: async (m: any) => {
      const pct = parseFloat(promoForm.pct)
      const descuento = Number.isFinite(pct) && pct > 0 ? {
        pct: Math.min(pct, 100),
        tope: promoForm.tope ? parseFloat(promoForm.tope) : null,
        dias: promoForm.dias.length > 0 && promoForm.dias.length < 7 ? promoForm.dias : null,
        desde: promoForm.desde || null,
        hasta: promoForm.hasta || null,
      } : null
      // Merge sobre el config existente: no pisar otras claves que pueda tener el jsonb
      const configNuevo = { ...(m.config && typeof m.config === 'object' ? m.config : {}), descuento }
      const { error } = await supabase.from('metodos_pago').update({ config: configNuevo })
        .eq('id', m.id).eq('tenant_id', tenant!.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Promo guardada')
      setPromoMetodoId(null)
      qc.invalidateQueries({ queryKey: ['metodos_pago'] })
      qc.invalidateQueries({ queryKey: ['metodos_pago_cfg'] })  // el POS la lee de acá
    },
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
    if (!(await confirmar('¿Desconectar MODO?', { danger: true }))) return
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
  const [udmTipoEmpaque, setUdmTipoEmpaque] = useState('')
  const [udmEditId, setUdmEditId] = useState<string | null>(null)
  const [udmEditNombre, setUdmEditNombre] = useState('')
  const [udmEditSimbolo, setUdmEditSimbolo] = useState('')
  const [udmEditTipoEmpaque, setUdmEditTipoEmpaque] = useState('')
  const [udmSaving, setUdmSaving] = useState(false)

  const { data: unidadesMedida = [], isLoading: loadingUdm } = useQuery({
    queryKey: ['unidades_medida', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('unidades_medida').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'inventario',
  })

  // Fase 1-bis UoM: catálogo COMPLETO de unidades físicas (mig 303/308). Trae TODAS (activas e
  // inactivas) para gestionarlas — queryKey propio, distinto del de la ficha de producto (que
  // solo quiere las activas). El tenant prende/apaga cada una (enable/disable).
  const { data: unidadesFisicasCfg = [] } = useQuery<UnidadFisica[]>({
    queryKey: ['unidades_medida_fisicas_all', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('unidades_medida_fisicas')
        .select('id, familia, nombre, simbolo, factor_base_familia, es_base_familia, permite_decimales, activo')
        .eq('tenant_id', tenant!.id).order('orden')
      return (data ?? []) as UnidadFisica[]
    },
    enabled: !!tenant && tab === 'inventario' && invSubTab === 'unidades',
  })

  // Enable/disable de una unidad física (Fase 1-bis). La base de familia no se puede apagar (es
  // el ancla de conversión). Invalida ambos queryKeys (config + ficha de producto).
  const toggleUnidadFisica = async (u: UnidadFisica, activo: boolean) => {
    if (u.es_base_familia && !activo) { toast.error('La unidad base de la familia no se puede desactivar.'); return }
    const { error } = await supabase.from('unidades_medida_fisicas')
      .update({ activo }).eq('id', u.id).eq('tenant_id', tenant!.id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['unidades_medida_fisicas_all'] })
    qc.invalidateQueries({ queryKey: ['unidades_medida_fisicas'] })
  }

  // Preset por rubro (Fase 1-bis): ACTIVA (aditivo) las unidades del rubro elegido.
  const aplicarPresetRubro = async (nombres: string[]) => {
    const { error } = await supabase.from('unidades_medida_fisicas')
      .update({ activo: true }).eq('tenant_id', tenant!.id).in('nombre', nombres)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['unidades_medida_fisicas_all'] })
    qc.invalidateQueries({ queryKey: ['unidades_medida_fisicas'] })
    toast.success('Unidades del rubro activadas')
  }

  const addUdm = async () => {
    if (!udmNombre.trim()) return
    if ((unidadesMedida as any[]).some((u: any) => u.nombre.toLowerCase() === udmNombre.trim().toLowerCase())) {
      toast.error('Ya existe una unidad con ese nombre'); return
    }
    setUdmSaving(true)
    const { error } = await supabase.from('unidades_medida').insert({ tenant_id: tenant!.id, nombre: udmNombre.trim(), simbolo: udmSimbolo.trim() || null, tipo_empaque: udmTipoEmpaque || null, activo: true })
    if (error) toast.error(error.message)
    else { toast.success('Unidad agregada'); setUdmNombre(''); setUdmSimbolo(''); setUdmTipoEmpaque(''); qc.invalidateQueries({ queryKey: ['unidades_medida'] }) }
    setUdmSaving(false)
  }

  const updateUdm = async (id: string) => {
    if (!udmEditNombre.trim()) return
    setUdmSaving(true)
    const { error } = await supabase.from('unidades_medida').update({ nombre: udmEditNombre.trim(), simbolo: udmEditSimbolo.trim() || null, tipo_empaque: udmEditTipoEmpaque || null }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Unidad actualizada'); setUdmEditId(null); qc.invalidateQueries({ queryKey: ['unidades_medida'] }) }
    setUdmSaving(false)
  }

  const deleteUdm = async (id: string) => {
    if (!(await confirmar('¿Desactivar esta unidad de medida?', { danger: true }))) return
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
        // Envíos y Pedidos son módulos del modo avanzado
        ...(modoAvanzado ? [{ id: 'envios' as Tab, label: 'Envíos', icon: Truck }] : []),
        ...(modoAvanzado ? [{ id: 'pedidos' as Tab, label: 'Pedidos', icon: ListOrdered }] : []),
        { id: 'gastos',         label: 'Gastos',          icon: TrendingDown },
        { id: 'facturacion',    label: 'Facturación',     icon: Receipt },
        { id: 'rrhh',           label: 'RRHH',            icon: UserCog },
      ],
    },
    {
      label: 'Sistema',
      items: [
        { id: 'alertas',        label: 'Alertas',         icon: Bell },
        { id: 'notificaciones', label: 'Notificaciones',  icon: Bell },
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
      <span className="inline-block text-xs bg-accent/10 text-accent-text px-3 py-1 rounded-full font-medium">Próximamente</span>
    </div>
  )

  const subTabNav = <T extends string>(
    items: { id: T; label: string; icon: any }[],
    active: T,
    setActive: (v: T) => void
  ) => (
    <PageTabs
      tabs={items.map(i => ({ id: i.id, label: i.label, icon: i.icon }))}
      active={active}
      onChange={(id) => setActive(id as T)}
    />
  )

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Settings size={22} className="text-accent-text" /> Configuración
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Administrá los datos de tu negocio</p>
        </div>
        <Link to="/configuracion/importar"
          className="flex items-center gap-2 border border-accent-text text-accent-text px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all">
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
                    ${tab === id ? 'bg-accent text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-accent/10 hover:text-accent-text dark:hover:text-accent-text'}
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
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de comercio</label>
            <select value={bizTipoSelect} disabled={!canEdit}
              onChange={e => setBizTipoSelect(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
              <option value="">Seleccioná...</option>
              {TIPOS_COMERCIO.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {bizTipoSelect === 'Otro' && canEdit && (
              <input type="text" value={bizTipoPersonalizado}
                onChange={e => setBizTipoPersonalizado(e.target.value)}
                placeholder="Describí tu tipo de comercio"
                className="mt-2 w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
            )}
            {bizTipoSelect === 'Otro' && !canEdit && bizTipoPersonalizado && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 px-1">{bizTipoPersonalizado}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cierre de sesión por inactividad</label>
            <select value={bizTimeout} disabled={!canEdit}
              onChange={e => setBizTimeout(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
              <option value="nunca">Nunca</option>
              <option value="5">5 minutos</option>
              <option value="15">15 minutos</option>
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si el usuario no tiene actividad por este tiempo, la sesión se cierra automáticamente.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
              <DollarSign size={14} className="text-accent-text" /> Moneda principal del negocio
            </label>
            <select value={bizMoneda} disabled={!canEdit}
              onChange={e => setBizMoneda(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
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
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
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

      {tab === 'negocio' && <ModoOperacionSection />}

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
              <Receipt size={18} className="text-accent-text" />
              <span className="font-semibold text-gray-700 dark:text-gray-300">Facturación Electrónica (ARCA)</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {bizFactHabilitada ? 'Habilitada' : 'Deshabilitada'}
              </span>
              <Toggle
                checked={bizFactHabilitada}
                onChange={toggleFacturacion}
                aria-label="Habilitar facturación electrónica (ARCA)"
                title="Click para habilitar/deshabilitar — se guarda automáticamente"
              />
            </label>
          </div>
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {tAny?.cuit
                ? 'Identidad fiscal del emisor principal. Se edita desde "Emisores fiscales" (más abajo) — un único lugar para no divergir.'
                : 'Completá los datos fiscales del negocio para emitir comprobantes electrónicos A, B y C.'}
            </p>
            {/* Logo del negocio — sale en la factura y el presupuesto */}
            <div className="flex items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <div className="w-20 h-20 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-center overflow-hidden shrink-0">
                {bizLogoUrl
                  ? <img src={bizLogoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                  : <span className="text-[10px] text-gray-400 text-center px-1">Sin logo</span>}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Logo del negocio</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Sale en la factura y el presupuesto. PNG/JPG, máx. 2 MB.</p>
                <div className="flex gap-2">
                  <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-all ${uploadingLogo ? 'opacity-60 pointer-events-none' : ''} border border-accent-text text-accent-text hover:bg-accent/10`}>
                    {uploadingLogo ? 'Subiendo…' : (bizLogoUrl ? 'Cambiar logo' : 'Subir logo')}
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} disabled={uploadingLogo} />
                  </label>
                  {bizLogoUrl && (
                    <button type="button" onClick={handleQuitarLogo} disabled={uploadingLogo}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60">
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            </div>
            {!tAny?.cuit ? (
              <>
                {/* F3b: este bloque editable SOLO existe para el alta inicial (todavía no hay
                    emisor principal). Una vez creado, la edición pasa a "Emisores fiscales" —
                    dejar de ser un 2º editor era el pedido de GO tras el cutover mig 271. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">CUIT</label>
                    <input type="text" value={bizCuit} onChange={e => setBizCuit(e.target.value)}
                      placeholder="20-12345678-9"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Condición IVA del emisor</label>
                    <div className="relative">
                      <select value={bizCondIva} onChange={e => setBizCondIva(e.target.value)}
                        className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
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
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Domicilio fiscal</label>
                    <input type="text" value={bizDomicilioFiscal} onChange={e => setBizDomicilioFiscal(e.target.value)}
                      placeholder="Calle 123, Ciudad"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Umbral Factura B ($) <span className="text-gray-400 font-normal">— RG 5616</span>
                    </label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={bizUmbralB} onChange={e => setBizUmbralB(e.target.value)} min="0"
                      placeholder="68305.16"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    <p className="text-xs text-gray-400 mt-0.5">Ventas ≥ este monto requieren DNI/CUIT del cliente</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Token AfipSDK</label>
                    <div className="relative">
                      <input type={showAfipToken ? 'text' : 'password'} value={bizAfipToken} onChange={e => setBizAfipToken(e.target.value)}
                        placeholder="Token de afipsdk.com"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      <button type="button" onClick={() => setShowAfipToken(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <Eye size={14} />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Obtenelo en afipsdk.com. Se guarda encriptado.</p>
                  </div>
                </div>
                {/* Datos que salen en factura / presupuesto / remito (mig 212) */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Datos para los comprobantes (factura / presupuesto / remito)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Ingresos Brutos</label>
                      <input type="text" value={bizIngBrutos} onChange={e => setBizIngBrutos(e.target.value)}
                        placeholder="N° de Ingresos Brutos / Convenio"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Inicio de Actividades</label>
                      <input type="date" value={bizInicioAct} onChange={e => setBizInicioAct(e.target.value)}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sitio web</label>
                      <input type="text" value={bizSitioWeb} onChange={e => setBizSitioWeb(e.target.value)}
                        placeholder="www.minegocio.com"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Banco</label>
                      <input type="text" value={bizBanco} onChange={e => setBizBanco(e.target.value)}
                        placeholder="Banco (para transferencias)"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">CBU</label>
                      <input type="text" value={bizCbu} onChange={e => setBizCbu(e.target.value)}
                        placeholder="0000000000000000000000"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Alias CBU</label>
                      <input type="text" value={bizAliasCbu} onChange={e => setBizAliasCbu(e.target.value)}
                        placeholder="mi.alias.cbu"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Leyenda / nota del comprobante</label>
                      <textarea value={bizLeyenda} onChange={e => setBizLeyenda(e.target.value)} rows={2}
                        placeholder="Ej.: ¡Gracias por su compra! · Seguinos en @minegocio"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={handleSaveFacturacion} disabled={savingFact}
                    className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                    {savingFact ? 'Guardando...' : 'Guardar datos fiscales'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* F3b: resumen de solo lectura — la edición vive en "Emisores fiscales" (abajo),
                    que desde el cutover mig 271 escribe el MISMO registro (emisores_fiscales). */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Identidad fiscal del emisor principal</p>
                    <button type="button" onClick={() => emisoresPanelRef.current?.editarPrincipal()}
                      className="text-xs text-accent-text hover:underline flex items-center gap-1 shrink-0">
                      <Pencil size={12} /> Editar en Emisores fiscales
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2.5">
                    <CampoResumenFiscal label="CUIT" value={tAny.cuit} mono />
                    <CampoResumenFiscal label="Razón social fiscal" value={tAny.razon_social_fiscal} />
                    <CampoResumenFiscal label="Condición IVA" value={tAny.condicion_iva_emisor ? (CONDICION_IVA_LABEL[tAny.condicion_iva_emisor] ?? tAny.condicion_iva_emisor) : null} />
                    <CampoResumenFiscal label="Domicilio fiscal" value={tAny.domicilio_fiscal} />
                    <CampoResumenFiscal label="Umbral Factura B" value={tAny.umbral_factura_b ? `$${Number(tAny.umbral_factura_b).toLocaleString('es-AR')}` : null} />
                    <CampoResumenFiscal label="Token AfipSDK" value={tAny.afipsdk_token ? 'Configurado' : null} />
                    <CampoResumenFiscal label="Ingresos Brutos" value={tAny.ingresos_brutos} />
                    <CampoResumenFiscal label="Inicio de actividades" value={tAny.inicio_actividades ? new Date(tAny.inicio_actividades).toLocaleDateString('es-AR') : null} />
                    <CampoResumenFiscal label="Banco" value={tAny.banco} />
                    <CampoResumenFiscal label="CBU" value={tAny.cbu} mono />
                    <CampoResumenFiscal label="Alias CBU" value={tAny.alias_cbu} />
                    <CampoResumenFiscal label="Leyenda del comprobante" value={tAny.leyenda_comprobante} className="md:col-span-2" />
                  </div>
                </div>
                {/* Sitio web: dato de contacto del negocio (no es identidad fiscal per-CUIT) —
                    sin equivalente en Emisores fiscales, sigue editable acá. */}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sitio web</label>
                    <input type="text" value={bizSitioWeb} onChange={e => setBizSitioWeb(e.target.value)}
                      placeholder="www.minegocio.com"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <button onClick={handleSaveFacturacion} disabled={savingFact}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 text-white font-medium rounded-xl transition-all disabled:opacity-60 text-sm shrink-0">
                    {savingFact ? 'Guardando…' : 'Guardar sitio web'}
                  </button>
                </div>
              </>
            )}
            {/* Modo de emisión: homologación (prueba) vs producción (CAE fiscal real) */}
            <div className={`rounded-xl border p-3 ${bizAfipProduccion ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-900/20' : 'border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-900/20'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  {bizAfipProduccion
                    ? <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    : <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />}
                  <div>
                    <p className={`text-sm font-semibold ${bizAfipProduccion ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>
                      {bizAfipProduccion ? 'Modo PRODUCCIÓN — comprobantes fiscales REALES' : 'Modo PRUEBA (homologación) — sin valor fiscal'}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      {bizAfipProduccion
                        ? 'Cada emisión genera un CAE válido ante AFIP, con numeración correlativa oficial.'
                        : 'Los CAE emitidos son de prueba y no tienen validez fiscal. Pasá a producción solo cuando completes el onboarding AFIP (CUIT activo + certificado + token de producción).'}
                    </p>
                  </div>
                </div>
                {/* 🛑 Este switch decide homologación ↔ AFIP PRODUCCIÓN REAL: su estado no puede
                    leerse ambiguo (REGLA #0). Por eso va por el componente estándar. */}
                <Toggle
                  checked={bizAfipProduccion}
                  onChange={toggleAfipProduccion}
                  disabled={savingProd}
                  colorOn="bg-emerald-500"
                  aria-label="Emitir contra AFIP producción real"
                  title={bizAfipProduccion ? 'Volver a modo prueba (homologación)' : 'Pasar a producción real'}
                />
              </div>
              {!afipDatosListos && !bizAfipProduccion && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">Cargá y guardá CUIT + Token AfipSDK para poder pasar a producción.</p>
              )}
            </div>
          </div>

          {/* Confirmación para pasar a PRODUCCIÓN (CAE fiscal real) */}
          {showProdConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowProdConfirm(false)}>
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle size={22} className="text-red-500" />
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Pasar a PRODUCCIÓN AFIP</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  A partir de ahora, cada factura emitida generará un <strong>CAE fiscal real e irreversible</strong> ante AFIP, con numeración correlativa oficial. Esto no es una prueba.
                </p>
                <ul className="text-xs text-gray-500 dark:text-gray-400 mt-3 space-y-1 list-disc pl-5">
                  <li>El CUIT debe estar <strong>activo</strong> y habilitado para Facturación Electrónica.</li>
                  <li>El certificado de producción debe estar autorizado en AFIP (Administrador de Relaciones).</li>
                  <li>El Token AfipSDK debe ser de <strong>producción</strong>.</li>
                </ul>
                <label className="flex items-start gap-2 mt-4 cursor-pointer">
                  <input type="checkbox" checked={prodAck} onChange={e => setProdAck(e.target.checked)} className="mt-0.5" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Entiendo que se emitirán comprobantes fiscales reales con valor legal.</span>
                </label>
                <div className="flex justify-end gap-2 mt-5">
                  <button onClick={() => setShowProdConfirm(false)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl">Cancelar</button>
                  <button onClick={confirmActivarProduccion} disabled={!prodAck || savingProd}
                    className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50">
                    {savingProd ? 'Activando…' : 'Activar producción'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Puntos de venta AFIP ─────────────────────────────────────────────── */}
      {tab === 'facturacion' && canEdit && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <button className="w-full flex items-center gap-3 px-5 py-4 text-left"
            onClick={() => setPvCollapsed(v => !v)}>
            <Hash size={18} className="text-accent-text" />
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
                    if (!(await confirmar('¿Eliminar este punto de venta?', { danger: true }))) return
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
                    className="w-20 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-0.5">Nombre (opcional)</label>
                  <input type="text" value={pvForm.nombre}
                    onChange={e => setPvForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Local principal"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <button disabled={!pvForm.numero || savingPv}
                  onClick={async () => {
                    if (!pvForm.numero) return
                    setSavingPv(true)
                    const { error } = await supabase.from('puntos_venta_afip').insert({
                      tenant_id: tenant!.id, numero: parseInt(pvForm.numero),
                      nombre: pvForm.nombre.trim() || null,
                      // Multi-CUIT: los PV de esta sección son del emisor principal
                      emisor_id: emisorDefault?.id ?? null,
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

              {/* Pointer al asistente self-service para quien recién arranca (no tiene la .key/.crt todavía). */}
              {!tenantCert && (
                <div className="flex items-start gap-2 bg-accent/5 border border-accent-text/20 rounded-xl px-3 py-2.5 text-xs text-gray-600 dark:text-gray-300">
                  <Wand2 size={15} className="text-accent-text shrink-0 mt-0.5" />
                  <span>
                    ¿Todavía no tenés el certificado? No hace falta que sepas usar <span className="font-mono">openssl</span>: generamos la clave y el pedido (CSR) por vos.
                    Andá a <strong>Emisores fiscales</strong> (más abajo ↓), abrí tu CUIT principal → <strong>Certificado</strong> → <strong>Asistente</strong> y seguí los pasos.
                    Acá arriba subís el <span className="font-mono">.crt</span> + <span className="font-mono">.key</span> solo si ya los tenés.
                  </span>
                </div>
              )}

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
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white font-mono" />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Fecha de validez (opcional)</label>
                    <input type="date" value={certValidez} onChange={e => setCertValidez(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
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

      {/* ── Emisores fiscales (multi-CUIT, F5) ─────────────────────────────── */}
      {tab === 'facturacion' && canEdit && <EmisoresFiscalesPanel ref={emisoresPanelRef} />}

      {tab === 'inventario' && (
        <div className="space-y-4">
          {/* sub-tab nav */}
          <PageTabs
            tabs={([
              { id: 'reglas' as InvSubTab, label: 'Reglas de stock', icon: Timer },
              { id: 'rotacion' as InvSubTab, label: 'Rotación', icon: Recycle },
              { id: 'categorias' as InvSubTab, label: 'Categorías', icon: Tag },
              { id: 'ubicaciones' as InvSubTab, label: 'Ubicaciones', icon: MapPin },
              { id: 'estados' as InvSubTab, label: 'Estados', icon: CircleDot },
              { id: 'motivos' as InvSubTab, label: 'Motivos', icon: MessageSquare },
              { id: 'unidades' as InvSubTab, label: 'Unidades', icon: Ruler },
              { id: 'empaque' as InvSubTab, label: 'Empaque', icon: Package },
              { id: 'atributos' as InvSubTab, label: 'Atributos', icon: Shirt },
              { id: 'codigos' as InvSubTab, label: 'Códigos', icon: ScanBarcode },
              { id: 'zonas' as InvSubTab, label: 'Zonas y picking', icon: Navigation },
              // Reglas (FIFO/conteos), Ubicaciones, Estados, Códigos GS1 y Zonas/picking son WMS → solo avanzado
            ] as const).filter(({ id }) => modoAvanzado || !['reglas', 'rotacion', 'ubicaciones', 'estados', 'codigos', 'zonas'].includes(id)).map(({ id, label, icon }) => ({ id, label, icon }))}
            active={invSubTab}
            onChange={(id) => setInvSubTab(id as InvSubTab)}
          />

          {invSubTab === 'codigos' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <CodigoPerfilesPanel />
            </div>
          )}

          {invSubTab === 'reglas' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Reglas de gestión de stock</h2>
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Permitir over-receipt</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Al recibir mercadería, permite ingresar más cantidad de la pedida en la OC. Genera alerta de excedente.</p>
                </div>
                <Toggle size="lg" disabled={!canEdit} checked={bizOverReceipt}
                  onChange={() => setBizOverReceipt(p => !p)} aria-label="Permitir over-receipt" />
              </div>
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Trazabilidad de asignación de stock</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Registra de qué LPN/ubicación/serie se surtió cada unidad de cada venta, y si fue selección manual o automática. Permite seguir el rastro completo (recall, auditoría) desde Historial y el detalle de venta.</p>
                </div>
                <Toggle size="lg" disabled={!canEdit} checked={bizTrazaAsignacion}
                  onChange={() => setBizTrazaAsignacion((p: boolean) => !p)} aria-label="Trazabilidad de asignación de stock" />
              </div>
              {/* F2a — Modo de conteo de inventario */}
              <div className="py-1">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Modo de conteo de inventario</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-2">El modo <strong>Guiado</strong> es "a ciegas": el operador cuenta sin ver el stock del sistema (evita que confirme el número sin contar). El <strong>Rápido</strong> precarga la cantidad esperada (como hasta ahora). <strong>Elegir</strong> deja decidir al crear cada conteo.</p>
                <div className="flex gap-2 flex-wrap">
                  {([['rapido', '⚡ Rápido', 'Precarga la cantidad del sistema (informado)'], ['guiado', '🙈 Guiado (a ciegas)', 'El operador cuenta sin ver el sistema'], ['elegir', '🔀 Elegir al crear', 'Se elige rápido/guiado en cada conteo']] as const).map(([m, label, desc]) => (
                    <button key={m} type="button" disabled={!canEdit} title={desc}
                      onClick={() => setBizConteoModo(m)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors border-2 disabled:opacity-50
                        ${bizConteoModo === m ? 'border-accent-text text-accent-text bg-accent/5' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* F3 — Aprobación de ajustes de conteo */}
              <div className="py-1 border-t border-gray-100 dark:border-gray-700 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Aprobación de ajustes de conteo</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Las diferencias de un conteo no tocan el stock hasta que un DUEÑO/SUPERVISOR las aprueba en <strong>Inventario → Autorizaciones</strong>. Si el gate está <strong>desactivado</strong>, TODA diferencia requiere aprobación. Si lo <strong>activás</strong>, solo las que superen algún umbral (lo menor que pongas) van a aprobación; el resto se aplica directo.</p>
                  </div>
                  <div className="ml-3"><Toggle size="lg" disabled={!canEdit} checked={bizConteoGate.activo}
                    onChange={() => setBizConteoGate(g => ({ ...g, activo: !g.activo }))} aria-label="Aprobación de ajustes de conteo" /></div>
                </div>
                {bizConteoGate.activo && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <input type="number" disabled={!canEdit} placeholder="Umbral unidades" value={bizConteoGate.gateU} onChange={e => setBizConteoGate(g => ({ ...g, gateU: e.target.value }))} title="Diferencia en unidades que dispara aprobación" className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                    <input type="number" disabled={!canEdit} placeholder="Umbral %" value={bizConteoGate.gatePct} onChange={e => setBizConteoGate(g => ({ ...g, gatePct: e.target.value }))} title="Diferencia en % sobre lo esperado" className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                    <input type="number" disabled={!canEdit} placeholder="Umbral $ valor" value={bizConteoGate.gateValor} onChange={e => setBizConteoGate(g => ({ ...g, gateValor: e.target.value }))} title="Valor $ de la diferencia (cantidad × costo)" className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                  </div>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 mb-1">Umbral de <strong>doble conteo</strong>: diferencias que lo superen avisan al operador para recontar antes de finalizar (en blanco = no avisa).</p>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" disabled={!canEdit} placeholder="Reconteo unidades" value={bizConteoGate.recU} onChange={e => setBizConteoGate(g => ({ ...g, recU: e.target.value }))} className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                  <input type="number" disabled={!canEdit} placeholder="Reconteo %" value={bizConteoGate.recPct} onChange={e => setBizConteoGate(g => ({ ...g, recPct: e.target.value }))} className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                  <input type="number" disabled={!canEdit} placeholder="Reconteo $ valor" value={bizConteoGate.recValor} onChange={e => setBizConteoGate(g => ({ ...g, recValor: e.target.value }))} className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 mb-1"><strong>Conteo cíclico</strong>: cada cuántos días conviene recontar según la clase ABC del producto (mayor valor = más seguido). El sistema sugiere qué contar; no cuenta solo.</p>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" min="1" disabled={!canEdit} placeholder="Clase A (días)" value={bizConteoCiclo.a} onChange={e => setBizConteoCiclo(c => ({ ...c, a: e.target.value }))} title="Cada cuántos días recontar productos clase A (alto valor)" className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                  <input type="number" min="1" disabled={!canEdit} placeholder="Clase B (días)" value={bizConteoCiclo.b} onChange={e => setBizConteoCiclo(c => ({ ...c, b: e.target.value }))} title="Cada cuántos días recontar productos clase B (valor medio)" className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                  <input type="number" min="1" disabled={!canEdit} placeholder="Clase C (días)" value={bizConteoCiclo.c} onChange={e => setBizConteoCiclo(c => ({ ...c, c: e.target.value }))} title="Cada cuántos días recontar productos clase C (bajo valor)" className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                </div>
                <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" disabled={!canEdit} checked={bizConteoWtwBloquea} onChange={e => setBizConteoWtwBloquea(e.target.checked)} className="rounded" />
                  <span><strong>Wall-to-wall bloquea la sucursal</strong> — al iniciar un conteo de sucursal completa, se bloquean ventas (reserva/despacho) y movimientos de stock hasta finalizarlo o eliminarlo (requiere confirmación de DUEÑO/SUPERVISOR al iniciar).</span>
                </label>
              </div>
              {/* mig 228 — Autorización de ajustes de inventario POR ROL */}
              <div className="py-1 border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">¿Quién puede ajustar stock sin autorización?</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-2">
                  Por rol: <strong>Directo</strong> = ajusta sin aprobación · <strong>Por umbral</strong> = solo lo que supere el umbral de arriba va a aprobación · <strong>Siempre</strong> = toda diferencia requiere aprobación. Aplica a diferencias de conteo y a ajustes de cantidad. El DUEÑO va directo por default; podés dejar a otro rol igual (ej. SUPERVISOR). Aprueban DUEÑO/SUPERVISOR en <strong>Inventario → Autorizaciones</strong>.
                </p>
                <div className="space-y-1.5">
                  {(['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO', 'CAJERO', 'DEPOSITO'] as const).map(rol => {
                    const val = bizAjusteRoles[rol] ?? (rol === 'DUEÑO' ? 'directo' : 'siempre')
                    return (
                      <div key={rol} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-600 dark:text-gray-300">{rol}</span>
                        <select disabled={!canEdit} value={val}
                          onChange={e => setBizAjusteRoles(prev => ({ ...prev, [rol]: e.target.value }))}
                          className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-700 dark:text-white disabled:opacity-50">
                          <option value="directo">Directo (sin autorización)</option>
                          <option value="umbral">Por umbral</option>
                          <option value="siempre">Siempre requiere</option>
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* mig 322 — Cubicaje volumétrico opt-in */}
              <div className="py-1 border-t border-gray-100 dark:border-gray-700 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                      <Box size={14} /> Cubicaje volumétrico
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      Calcula cuánto <strong>espacio</strong> ocupa lo guardado en cada ubicación, no solo cuántos LPN.
                      Al activarlo, el <strong>peso y las tres medidas pasan a ser obligatorios</strong> en cada nivel
                      de la estructura de un producto (Productos → detalle → Empaque). Es la única forma de que el
                      número no mienta: un nivel sin medir ocupa 0 m³ para el cálculo, y el error empuja hacia
                      &quot;parece que hay lugar&quot; justo cuando la posición podría estar pasada.
                    </p>
                  </div>
                  <div className="ml-3"><Toggle size="lg" disabled={!canEdit} checked={bizCubicaje}
                    onChange={() => setBizCubicaje(p => !p)} aria-label="Cubicaje volumétrico" /></div>
                </div>

                {bizCubicaje && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Aprovechamiento de la ubicación (%)
                      </label>
                      <div className="flex items-center gap-2">
                        <input type="number" min="1" max="100" step="1" disabled={!canEdit}
                          onWheel={e => e.currentTarget.blur()}
                          value={bizCubicajeFactor} onChange={e => setBizCubicajeFactor(e.target.value)}
                          className="w-24 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Ninguna posición real se llena al 100% geométrico (pasillos, forma irregular,
                          mercadería que no apila). Con {Number(bizCubicajeFactor) || 70}%, un rack de 1 m³
                          se considera lleno con {((Number(bizCubicajeFactor) || 70) / 100).toFixed(2)} m³.
                        </span>
                      </div>
                    </div>

                    {/* Cobertura del catálogo: prender el toggle NO completa lo que ya está cargado. */}
                    {cubicajeCobertura && (() => {
                      const { productos_total: total, productos_medidos: medidos, presentaciones_sin_medir: sinMedir } = cubicajeCobertura
                      const completo = total > 0 && medidos >= total
                      return (
                        <div className={`rounded-xl p-3 text-xs border ${completo
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
                          : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'}`}>
                          <p className="font-semibold">
                            {completo
                              ? `✅ Catálogo medido: ${medidos} de ${total} productos.`
                              : `⚠ ${medidos} de ${total} productos medidos · ${sinMedir} presentaciones sin medir.`}
                          </p>
                          {!completo && (
                            <p className="mt-1">
                              Activar el cubicaje <strong>no completa los productos que ya estaban cargados</strong>:
                              exige las medidas de acá en adelante. Hasta que termines de medirlos, el espacio ocupado
                              que se muestra en cada ubicación queda <strong>por debajo del real</strong> — por eso
                              aparece con ⚠ y nunca como un verde limpio. Se cargan en Productos → detalle → Empaque.
                            </p>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
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

          {/* ── Motor de Rotación de productos con descuento (relevamiento 2026-08-07) ────── */}
          {invSubTab === 'rotacion' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <div className="flex items-center gap-2">
                  <Recycle size={18} className="text-accent-text" />
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300">Motor de Rotación de productos con descuento</h2>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Define qué pasa con el stock que entra a un estado con descuento (ej. "Próximo a Vencer").
                  Marcá en <strong>Inventario → Estados</strong> (ícono <RefreshCw size={11} className="inline" />)
                  qué estados disparan estas reglas. Acá definís el default del negocio; más abajo podés poner
                  una excepción por categoría (una categoría sin elegir usa este default).
                </p>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Regla de inventario (FIFO/FEFO)</label>
                  <select value={bizRegla} disabled={!canEdit}
                    onChange={e => setBizRegla(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                    {REGLAS_INVENTARIO.map(r => (
                      <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Define cómo se selecciona el stock al rebajar. Se puede sobreescribir por producto.</p>
                </div>

                <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1">
                  <label className={`flex items-start gap-3 py-1 ${(!canEdit || bizRotacionKits) ? 'opacity-60' : 'cursor-pointer'}`}>
                    <div className="mt-0.5"><Toggle size="lg" disabled={!canEdit || bizRotacionKits} checked={bizRotacionAgotar}
                      onChange={() => setBizRotacionAgotar(v => !v)} aria-label="Terminar stock para reponer" /></div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">1 — Terminar stock para reponer</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">No sugiere reponer con vencimiento más lejano mientras quede stock en un estado con descuento por vencimiento (sí se puede sumar más con la misma fecha).</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 py-1 ${!canEdit ? 'opacity-60' : 'cursor-pointer'}`}>
                    <div className="mt-0.5"><Toggle size="lg" disabled={!canEdit} checked={bizRotacionEnvios}
                      onChange={() => setBizRotacionEnvios(v => !v)} aria-label="Prioridad en envíos y reservas" /></div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">2 — Prioridad en envíos y reservas</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Ese stock se toma primero para pedidos con envío/reserva. El mostrador pierde prioridad (no queda excluido) salvo venta directa presencial.</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 py-1 ${(!canEdit || bizRotacionAgotar) ? 'opacity-60' : 'cursor-pointer'}`}>
                    <div className="mt-0.5"><Toggle size="lg" disabled={!canEdit || bizRotacionAgotar} checked={bizRotacionKits}
                      onChange={() => setBizRotacionKits(v => !v)} aria-label="Armar kits con descuento" /></div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">3 — Armar kits con descuento</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Habilita re-empaquetar el stock en descuento como kit (nombre/precio/código autogenerados, editable).</p>
                    </div>
                  </label>
                  {(bizRotacionAgotar || bizRotacionKits) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 pl-11">
                      <AlertCircle size={12} /> "Terminar stock para reponer" y "Armar kits" no se pueden combinar — la matriz de compatibilidad los bloquea.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ubicación de excepción (opcional)</label>
                  <select value={bizRotacionUbicacionExcepcion} disabled={!canEdit}
                    onChange={e => setBizRotacionUbicacionExcepcion(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700 bg-white dark:bg-gray-800">
                    <option value="">— Sin ubicación de excepción (queda donde está) —</option>
                    {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Solo aplica a las reglas 1 y 2 — un kit armado (regla 3) es un producto distinto, puede estar en cualquier lado.</p>
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

              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Excepciones por categoría</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Jerarquía: producto (a futuro) → categoría → negocio. "Usa default" cae en el nivel de arriba.</p>
                {categorias.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500">No hay categorías cargadas — creá alguna en la sub-pestaña "Categorías".</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                          <th className="py-2 pr-2 font-medium">Categoría</th>
                          <th className="py-2 px-2 font-medium">1 — Agotar antes</th>
                          <th className="py-2 px-2 font-medium">2 — Envíos</th>
                          <th className="py-2 px-2 font-medium">3 — Kits</th>
                          <th className="py-2 pl-2 font-medium">Ubicación excepción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(categorias as any[]).map(c => {
                          const kitsBloqueado = c.rotacion_agotar_antes_reponer === true
                          const agotarBloqueado = c.rotacion_armar_kits === true
                          const selectCls = "px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs dark:bg-gray-700 dark:text-white disabled:opacity-50 w-full"
                          return (
                            <tr key={c.id} className="border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                              <td className="py-2 pr-2 font-medium text-gray-700 dark:text-gray-300">{c.nombre}</td>
                              <td className="py-2 px-2">
                                <select disabled={!canEdit || agotarBloqueado} value={c.rotacion_agotar_antes_reponer === null || c.rotacion_agotar_antes_reponer === undefined ? '' : String(c.rotacion_agotar_antes_reponer)}
                                  onChange={e => updateCategoriaRotacion(c.id, 'rotacion_agotar_antes_reponer', e.target.value === '' ? null : e.target.value === 'true')}
                                  className={selectCls}>
                                  <option value="">Usa default</option>
                                  <option value="true">Sí</option>
                                  <option value="false">No</option>
                                </select>
                              </td>
                              <td className="py-2 px-2">
                                <select disabled={!canEdit} value={c.rotacion_prioridad_envios === null || c.rotacion_prioridad_envios === undefined ? '' : String(c.rotacion_prioridad_envios)}
                                  onChange={e => updateCategoriaRotacion(c.id, 'rotacion_prioridad_envios', e.target.value === '' ? null : e.target.value === 'true')}
                                  className={selectCls}>
                                  <option value="">Usa default</option>
                                  <option value="true">Sí</option>
                                  <option value="false">No</option>
                                </select>
                              </td>
                              <td className="py-2 px-2">
                                <select disabled={!canEdit || kitsBloqueado} value={c.rotacion_armar_kits === null || c.rotacion_armar_kits === undefined ? '' : String(c.rotacion_armar_kits)}
                                  onChange={e => updateCategoriaRotacion(c.id, 'rotacion_armar_kits', e.target.value === '' ? null : e.target.value === 'true')}
                                  className={selectCls}>
                                  <option value="">Usa default</option>
                                  <option value="true">Sí</option>
                                  <option value="false">No</option>
                                </select>
                              </td>
                              <td className="py-2 pl-2">
                                <select disabled={!canEdit} value={c.rotacion_ubicacion_excepcion_id ?? ''}
                                  onChange={e => updateCategoriaRotacion(c.id, 'rotacion_ubicacion_excepcion_id', e.target.value || null)}
                                  className={selectCls}>
                                  <option value="">Usa default</option>
                                  {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {invSubTab === 'categorias' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Tag size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Categorías de productos</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{categorias.length} cargadas</span>
          </div>
          <ListaABM items={categorias} loading={loadingCat} withDescription onAdd={addCategoria} onUpdate={updateCategoria} onDelete={deleteCategoria} />
        </div>
          )}

          {invSubTab === 'ubicaciones' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Ubicaciones</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{ubicaciones.length} cargadas</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">La prioridad define el orden de rebaje: menor número = se descuenta primero. <ShoppingCart size={11} className="inline" /> = surtido POS · <span className="text-xs font-bold text-green-600">TN</span> = TiendaNube · <span className="text-xs font-bold text-yellow-500">ML</span> = MercadoLibre · <RotateCcw size={11} className="inline text-orange-500" /> = devoluciones. Cada ubicación puede tener niveles adentro (árbol), un tipo lógico, dimensiones y código — todo opcional, editando con <Pencil size={11} className="inline" />.</p>

          {/* Agregar nueva */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              <input type="text" placeholder="Nombre de la ubicación" value={newUbicNombre}
                onChange={e => setNewUbicNombre(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addUbicacion()}
                className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Prioridad" value={newUbicPrioridad}
                onChange={e => setNewUbicPrioridad(e.target.value)}
                title="Prioridad de rebaje (menor = primero)"
                className="w-24 flex-shrink-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Secuencia" value={newUbicSecuencia}
                onChange={e => setNewUbicSecuencia(e.target.value)}
                title="Secuencia de recorrido para conteo y picking (menor = primero)"
                className="w-24 flex-shrink-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
              <button onClick={addUbicacion} disabled={!newUbicNombre.trim()}
                className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                <Plus size={15} /> Agregar
              </button>
            </div>
            <input type="text" placeholder="Descripción (opcional)" value={newUbicDesc}
              onChange={e => setNewUbicDesc(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
            <div className="flex flex-wrap gap-2">
              <select value={newUbicPadreId} onChange={e => setNewUbicPadreId(e.target.value)}
                title="Árbol de ubicaciones: si elegís una, esta queda como nivel adentro de esa contenedora"
                className="flex-1 min-w-[160px] px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
                <option value="">— Ninguna (contenedora nueva) —</option>
                {opcionesPadreNuevo.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <input type="text" placeholder="Código (autogenerado si se deja vacío)" value={newUbicCodigo}
                onChange={e => setNewUbicCodigo(e.target.value)}
                title="Identificador técnico estructurado (ej. A-03-02). Se autogenera si se deja vacío."
                className="w-56 flex-shrink-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:border-accent-text" />
            </div>
            {sucursales.length > 1 && (
              <select value={newUbicSucursalId} onChange={e => setNewUbicSucursalId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
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
                <Ruler size={11} /> Tipo lógico y dimensiones
                <ChevronRight size={11} className={`transition-transform ${newUbicWmsOpen ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {newUbicWmsOpen && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="col-span-3 flex items-center gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Tipo lógico</span>
                  <InfoTip text={TIPO_LOGICO_TOOLTIP} />
                </div>
                <select value={newUbicTipoLogico}
                  onChange={e => { const v = e.target.value as UbicacionTipoLogico | ''; setNewUbicTipoLogico(v); if (v !== 'almacenamiento') setNewUbicSubtipo('') }}
                  className={`${newUbicTipoLogico === 'almacenamiento' ? 'col-span-2' : 'col-span-3'} px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800`}>
                  <option value="">Sin clasificar</option>
                  {TIPO_LOGICO_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {newUbicTipoLogico === 'almacenamiento' && (
                  <select value={newUbicSubtipo} onChange={e => setNewUbicSubtipo(e.target.value as UbicacionSubtipoAlmacenamiento | '')}
                    className="col-span-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800">
                    <option value="">Sub-tipo (opcional)</option>
                    {SUBTIPO_ALMACENAMIENTO_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {zonas.length > 0 && (
                  <select value={newUbicZonaId} onChange={e => setNewUbicZonaId(e.target.value)}
                    className="col-span-3 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800">
                    <option value="">Sin zona</option>
                    {(zonas as any[]).map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                  </select>
                )}
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Alto (cm)" value={newUbicAlto} onChange={e => setNewUbicAlto(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Ancho (cm)" value={newUbicAncho} onChange={e => setNewUbicAncho(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Largo (cm)" value={newUbicLargo} onChange={e => setNewUbicLargo(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Peso máx (kg)" value={newUbicPeso} onChange={e => setNewUbicPeso(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Cap. pallets" value={newUbicPallets} onChange={e => setNewUbicPallets(e.target.value)} className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
              </div>
            )}
          </div>

          {/* Buscador */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Buscar ubicación..." value={ubicSearch}
              onChange={e => setUbicSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
          </div>

          {/* Lista */}
          {loadingUbic ? <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Cargando...</p> : (
            <div className="space-y-2">
              {/* Con búsqueda activa: lista plana (encontrar puntual importa más que ver el árbol).
                  Sin búsqueda: orden jerárquico con indentación por profundidad. */}
              {(ubicSearch.trim()
                ? (ubicaciones as any[])
                    .filter(u => u.nombre.toLowerCase().includes(ubicSearch.toLowerCase()) || (u.codigo ?? '').toLowerCase().includes(ubicSearch.toLowerCase()))
                    .map(u => ({ ...u, _depth: 0 }))
                : ubicacionesOrdenadas
              ).map((u: any) => (
                  <div key={u.id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2.5" style={{ marginLeft: u._depth * 20 }}>
                    {editUbicId === u.id ? (
                      <div className="flex-1 space-y-2">
                        {/* Fila principal */}
                        <div className="flex gap-2 items-center">
                          <input type="text" value={editUbicNombre} onChange={e => setEditUbicNombre(e.target.value)}
                            className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                          <input type="text" value={editUbicDesc} onChange={e => setEditUbicDesc(e.target.value)}
                            placeholder="Descripción" className="w-32 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={editUbicPrioridad} onChange={e => setEditUbicPrioridad(e.target.value)}
                            className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm text-center focus:outline-none focus:border-accent-text" title="Prioridad de rebaje" />
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={editUbicSecuencia} onChange={e => setEditUbicSecuencia(e.target.value)}
                            placeholder="Sec." className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm text-center focus:outline-none focus:border-accent-text" title="Secuencia de recorrido (conteo/picking)" />
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
                              className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-xs focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
                              <option value="">Global (todas las sucursales)</option>
                              {(sucursales as any[]).map(s => (
                                <option key={s.id} value={s.id}>{s.nombre}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {/* Árbol (padre) + código */}
                        <div className="flex gap-2 items-center">
                          <select value={editUbicPadreId} onChange={e => setEditUbicPadreId(e.target.value)}
                            title="Árbol de ubicaciones: si elegís una, esta queda como nivel adentro de esa contenedora"
                            className="flex-1 min-w-0 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-xs focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
                            <option value="">— Ninguna (contenedora raíz) —</option>
                            {opcionesPadreEdit.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                          <input type="text" value={editUbicCodigo} onChange={e => setEditUbicCodigo(e.target.value)}
                            placeholder="Código" title="Identificador técnico estructurado (ej. A-03-02)"
                            className="w-40 flex-shrink-0 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-xs font-mono focus:outline-none focus:border-accent-text" />
                        </div>
                        {/* Tipo lógico y dimensiones (colapsable) */}
                        <button
                          type="button"
                          onClick={() => setEditUbicWmsOpen(v => !v)}
                          className="flex items-center gap-1 text-xs text-purple-500 dark:text-purple-400 hover:text-purple-700">
                          <Ruler size={11} />
                          <span>Tipo lógico y dimensiones (opcional)</span>
                          <ChevronRight size={11} className={`transition-transform ${editUbicWmsOpen ? 'rotate-90' : ''}`} />
                        </button>
                        {editUbicWmsOpen && (
                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <div className="col-span-3 flex items-center gap-1">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Tipo lógico</span>
                              <InfoTip text={TIPO_LOGICO_TOOLTIP} />
                            </div>
                            <select value={editUbicTipoLogico}
                              onChange={e => { const v = e.target.value as UbicacionTipoLogico | ''; setEditUbicTipoLogico(v); if (v !== 'almacenamiento') setEditUbicSubtipo('') }}
                              className={`${editUbicTipoLogico === 'almacenamiento' ? 'col-span-2' : 'col-span-3'} px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800`}>
                              <option value="">Sin clasificar</option>
                              {TIPO_LOGICO_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            {editUbicTipoLogico === 'almacenamiento' && (
                              <select value={editUbicSubtipo} onChange={e => setEditUbicSubtipo(e.target.value as UbicacionSubtipoAlmacenamiento | '')}
                                className="col-span-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800">
                                <option value="">Sub-tipo (opcional)</option>
                                {SUBTIPO_ALMACENAMIENTO_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            )}
                            {zonas.length > 0 && (
                              <select value={editUbicZonaId} onChange={e => setEditUbicZonaId(e.target.value)}
                                className="col-span-3 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800">
                                <option value="">Sin zona</option>
                                {(zonas as any[]).map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                              </select>
                            )}
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Alto (cm)" value={editUbicAlto} onChange={e => setEditUbicAlto(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Ancho (cm)" value={editUbicAncho} onChange={e => setEditUbicAncho(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Largo (cm)" value={editUbicLargo} onChange={e => setEditUbicLargo(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.1" placeholder="Peso máx (kg)" value={editUbicPeso} onChange={e => setEditUbicPeso(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Cap. pallets" value={editUbicPallets} onChange={e => setEditUbicPallets(e.target.value)}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
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
                          {u._depth > 0 && <span className="text-gray-300 dark:text-gray-600 mr-1">└</span>}
                          <span className={`text-sm font-medium ${u.disponible_surtido ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{u.nombre}</span>
                          {u.codigo && <span className="ml-2 text-xs font-mono text-gray-400 dark:text-gray-500" title="Código">{u.codigo}</span>}
                          {u.descripcion && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{u.descripcion}</span>}
                          {!u.disponible_surtido && <span className="ml-2 text-xs text-red-400">No disponible para surtido</span>}
                          {u.tipo_logico && (
                            <span className="ml-2 text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded" title={TIPO_LOGICO_TOOLTIP}>
                              {TIPO_LOGICO_LABELS[u.tipo_logico as UbicacionTipoLogico]}
                              {u.subtipo_almacenamiento && ` · ${SUBTIPO_ALMACENAMIENTO_LABELS[u.subtipo_almacenamiento as UbicacionSubtipoAlmacenamiento]}`}
                            </span>
                          )}
                          {(u.alto_cm || u.ancho_cm || u.largo_cm) && (() => {
                            const m3 = volumenUbicacionM3(u.largo_cm, u.ancho_cm, u.alto_cm)
                            return (
                              <span className="ml-1 text-xs text-gray-400 dark:text-gray-500"
                                title={`Dimensiones alto × ancho × largo${m3 != null ? ` — ${m3} m³ geométricos` : ''}`}>
                                <Ruler size={10} className="inline mb-0.5" /> {[u.alto_cm, u.ancho_cm, u.largo_cm].filter(Boolean).join('×')} cm
                                {m3 != null && <span className="ml-1">· {m3} m³</span>}
                              </span>
                            )
                          })()}
                          {/* Ocupación real (mig 321): LPN contra `capacidad_pallets` y carga
                              contra `peso_max_kg`. Aviso, nunca bloqueo. */}
                          {(() => {
                            const oc = (ocupacionUbic as any)[u.id]
                            const cap = estadoCapacidadUbicacion(u.capacidad_pallets, oc?.lpn_activos ?? 0)
                            const carga = estadoCargaUbicacion(u.peso_max_kg, oc?.peso_kg ?? 0, oc?.lineas_con_peso ?? 0, oc?.lineas_total ?? 0)
                            const cls = (e: string) => e === 'excedido'
                              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                              : e === 'lleno'
                                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            return (
                              <>
                                {u.capacidad_pallets > 0 && (
                                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${cls(cap.estado)}`}
                                    title={cap.mensaje ?? 'LPN guardados en esta ubicación'}>
                                    <Package size={9} className="inline mb-0.5 mr-0.5" />{etiquetaOcupacion(cap)} LPN
                                  </span>
                                )}
                                {carga.pesoMaxKg != null && (
                                  <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${cls(carga.estado)}`}
                                    title={[carga.mensaje, carga.avisoCobertura].filter(Boolean).join(' ') || 'Carga sobre el máximo configurado'}>
                                    {Math.round(carga.pesoKg)} de {carga.pesoMaxKg} kg
                                    {carga.avisoCobertura && ' ⚠'}
                                  </span>
                                )}
                                {/* Cubicaje (mig 322): espacio ocupado contra la capacidad ÚTIL
                                    (geométrico × factor). Solo si el tenant lo activó Y la ubicación
                                    está medida — sin las dos cosas el número no significa nada. */}
                                {tenant?.cubicaje_habilitado && (() => {
                                  const util = capacidadUtilM3(
                                    volumenUbicacionM3(u.largo_cm, u.ancho_cm, u.alto_cm),
                                    tenant?.cubicaje_factor_aprovechamiento,
                                  )
                                  if (util == null) return null
                                  const vol = estadoVolumenUbicacion(
                                    util, oc?.volumen_m3 ?? 0, oc?.lineas_con_volumen ?? 0, oc?.lineas_total ?? 0,
                                  )
                                  return (
                                    <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${cls(vol.estado)}`}
                                      title={[
                                        vol.mensaje,
                                        vol.avisoCobertura,
                                        `Capacidad útil = ${util} m³ (volumen geométrico × ${Math.round((Number(tenant?.cubicaje_factor_aprovechamiento) || FACTOR_APROVECHAMIENTO_DEFAULT) * 100)}% de aprovechamiento).`,
                                      ].filter(Boolean).join(' ')}>
                                      <Box size={9} className="inline mb-0.5 mr-0.5" />
                                      {vol.volumenM3} de {util} m³
                                      {vol.avisoCobertura && ' ⚠'}
                                    </span>
                                  )
                                })()}
                              </>
                            )
                          })()}
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
                        <button onClick={() => startEditUbic(u)} className="text-gray-400 dark:text-gray-500 hover:text-accent-text p-1"><Pencil size={14} /></button>
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

          {invSubTab === 'zonas' && (
        <div className="space-y-4">
          {/* Reabastecimiento — 2 triggers independientes */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
            <div className="flex items-center gap-2">
              <Navigation size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Reabastecimiento</h2>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Mueve stock de zonas de reserva (bulk/estiba/cámara) a zonas de picking. Se pueden habilitar por separado, juntos o ninguno.</p>
            <label className="flex items-center gap-3 cursor-pointer py-1">
              <Toggle checked={!!t289?.wms_reabastecimiento_on_demand} onChange={toggleReabOnDemand} />
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">On-demand</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Al preparar un picking que no encuentra stock en la zona de picking, se genera automáticamente una tarea de reabastecimiento desde bulk/reserva (pallet completo o cajas sueltas, según la estructura del producto).</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer py-1">
              <Toggle checked={!!t289?.wms_reabastecimiento_umbral} onChange={toggleReabUmbral} />
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Por umbral (mín/máx)</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Genera tareas proactivas cuando el stock de un producto en una ubicación de picking cae por debajo del mínimo configurado abajo.</p>
              </div>
            </label>
          </div>

          {/* Armado automático (D2) — operario por defecto */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
            <div className="flex items-center gap-2">
              <Layers size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Armado automático de kits</h2>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Cuando una orden de TiendaNube o MercadoLibre vende un KIT y alcanza el stock de sus
              componentes, se genera sola una tarea de armado en Pedidos → Tareas WMS (nunca arma en
              silencio). Elegí a quién nace asignada esa tarea — si no elegís a nadie, queda sin
              asignar y la puede tomar cualquiera del depósito, igual que hoy con picking/reabastecimiento.
            </p>
            <select value={t289?.wms_armado_operario_default_id ?? ''} onChange={e => actualizarOperarioArmadoDefault(e.target.value)}
              className="w-full max-w-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200">
              <option value="">Sin operario por defecto — nace sin asignar</option>
              {(usuariosArmado as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre_display ?? u.rol}</option>)}
            </select>
          </div>

          {/* A2 (relevamiento Supervisor, mig 348): reglas de enrutamiento por tipo de autorización */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
            <div className="flex items-center gap-2">
              <UserCog size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Reglas de asignación — Supervisión</h2>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Al crearse una autorización pendiente (tab Supervisión de Inventario), se asigna sola.
              Elegí acá quién se hace cargo de cada tipo — el que no tenga regla se reparte
              automáticamente entre quienes pueden supervisar, priorizando a quien tenga menos
              pendientes asignadas en este momento.
            </p>
            <div className="space-y-2">
              {SUPERVISION_TIPOS_INVENTARIO.map(t => {
                const regla = (reglasEnrutamiento as any[]).find(r => r.tipo === t.key)
                return (
                  <div key={t.key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{t.label}</span>
                    <select value={regla?.usuario_id ?? ''} onChange={e => actualizarReglaEnrutamiento(t.key, e.target.value)}
                      className="w-full max-w-[220px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-800 dark:text-gray-200">
                      <option value="">Reparto automático por carga</option>
                      {(usuariosSupervisanInventario as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre_display ?? u.rol}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Zonas */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <MapPin size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Zonas</h2>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{zonas.length} cargadas</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Áreas del depósito que agrupan ubicaciones (ej. "Zona Picking A", "Bulk Norte"). Asigná cada ubicación a una zona desde el tab Ubicaciones.</p>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex flex-wrap gap-2">
                <input type="text" placeholder="Nombre de la zona" value={newZonaNombre}
                  onChange={e => setNewZonaNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addZona()}
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
                <button onClick={addZona} disabled={!newZonaNombre.trim()}
                  className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                  <Plus size={15} /> Agregar
                </button>
              </div>
              <input type="text" placeholder="Descripción (opcional)" value={newZonaDesc}
                onChange={e => setNewZonaDesc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
              {sucursales.length > 1 && (
                <select value={newZonaSucursalId} onChange={e => setNewZonaSucursalId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
                  <option value="">Global (todas las sucursales)</option>
                  {(sucursales as any[]).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              )}
            </div>

            {loadingZonas ? <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Cargando...</p> : (
              <div className="space-y-2">
                {(zonas as any[]).map(z => (
                  <div key={z.id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2.5">
                    {editZonaId === z.id ? (
                      <div className="flex-1 flex flex-wrap gap-2 items-center">
                        <input type="text" value={editZonaNombre} onChange={e => setEditZonaNombre(e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                        <input type="text" value={editZonaDesc} onChange={e => setEditZonaDesc(e.target.value)}
                          placeholder="Descripción" className="w-40 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                        {sucursales.length > 1 && (
                          <select value={editZonaSucursalId} onChange={e => setEditZonaSucursalId(e.target.value)}
                            className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-xs focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
                            <option value="">Global</option>
                            {(sucursales as any[]).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>
                        )}
                        <button onClick={() => saveZona(z.id)} className="text-green-600 dark:text-green-400 hover:text-green-700 p-1"><Check size={15} /></button>
                        <button onClick={() => setEditZonaId(null)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 p-1"><X size={15} /></button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{z.nombre}</span>
                          {z.descripcion && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{z.descripcion}</span>}
                          {z.sucursal_id && <span className="ml-2 text-xs text-blue-500">{(sucursales as any[]).find(s => s.id === z.sucursal_id)?.nombre}</span>}
                        </div>
                        <button onClick={() => startEditZona(z)} className="text-gray-400 dark:text-gray-500 hover:text-accent-text p-1"><Pencil size={14} /></button>
                        <button onClick={() => deleteZona(z.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                ))}
                {zonas.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay zonas cargadas.</p>}
              </div>
            )}
          </div>

          {/* Reglas de almacenaje */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <Ruler size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Reglas de almacenaje</h2>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Sugerencia (no bloqueante) de a qué zona llevar el stock que ingresa en cada Unidad de Medida — ej. "Pallet → Zona Bulk". Se puede elegir otra ubicación al ingresar igual.</p>
            {zonas.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">Creá al menos una zona arriba para poder configurar reglas.</p>
            ) : (
              <div className="space-y-2">
                {(unidadesMedida as any[]).map(um => {
                  const regla = (reglasAlmacenaje as any[]).find(r => r.unidad_medida_id === um.id)
                  return (
                    <div key={um.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{um.nombre}</span>
                      <select value={regla?.zona_id ?? ''} onChange={e => setReglaAlmacenaje(um.id, e.target.value)}
                        className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
                        <option value="">Sin sugerencia</option>
                        {(zonas as any[]).map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Umbrales de reabastecimiento */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Umbrales de reabastecimiento</h2>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{umbrales.length} cargados</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Mín/máx de stock (unidades base) por producto en una ubicación de picking. Solo tiene efecto si "Por umbral" está habilitado arriba.</p>

            {ubicacionesPicking.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No hay ninguna ubicación marcada como tipo "Picking" todavía — configurala en el tab Ubicaciones.</p>
            ) : (
              <>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                    <input type="text" placeholder="Buscar producto..." value={umbralProdSel ? umbralProdSel.nombre : umbralProdBusqueda}
                      onChange={e => { setUmbralProdBusqueda(e.target.value); setUmbralProdSel(null) }}
                      className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
                    {!umbralProdSel && umbralProdBusqueda.trim().length >= 2 && (umbralProdResultados as any[]).length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {(umbralProdResultados as any[]).map(p => (
                          <button key={p.id} type="button" onClick={() => { setUmbralProdSel({ id: p.id, nombre: p.nombre }); setUmbralProdBusqueda('') }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between">
                            <span>{p.nombre}</span><span className="text-xs text-gray-400">{p.sku}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select value={umbralUbicId} onChange={e => setUmbralUbicId(e.target.value)}
                      className="flex-1 min-w-[10rem] px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-primary">
                      <option value="">Ubicación de picking...</option>
                      {ubicacionesPicking.map(u => <option key={u.id} value={u.id}>{breadcrumbUbicacion(u.id, ubicacionesPorId)}</option>)}
                    </select>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Mínimo" value={umbralMin}
                      onChange={e => setUmbralMin(e.target.value)}
                      className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" placeholder="Máximo (opc.)" value={umbralMax}
                      onChange={e => setUmbralMax(e.target.value)}
                      className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
                    <button onClick={addUmbral} disabled={!umbralProdSel || !umbralUbicId || !umbralMin.trim()}
                      className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                      <Plus size={15} /> Agregar
                    </button>
                  </div>
                </div>

                {loadingUmbrales ? <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Cargando...</p> : (
                  <div className="space-y-2">
                    {(umbrales as any[]).map(u => (
                      <div key={u.id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2.5 text-sm">
                        <span className="flex-1 font-medium text-gray-800 dark:text-gray-100">{u.productos?.nombre ?? '—'}</span>
                        <span className="text-gray-400 dark:text-gray-500">{u.ubicaciones?.nombre ?? '—'}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">mín {u.stock_minimo}{u.stock_maximo != null ? ` · máx ${u.stock_maximo}` : ''}</span>
                        <button onClick={() => deleteUmbral(u.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    {umbrales.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay umbrales configurados.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
          )}

          {invSubTab === 'estados' && (
        <div className="space-y-4">
          {/* Sub-tab navigation */}
          <PageTabs
            tabs={[
              { id: 'estados', label: 'Estados', icon: CircleDot },
              { id: 'grupos', label: 'Grupos de estados', icon: Layers },
              { id: 'progresion', label: 'Progresión de estado', icon: Timer },
            ]}
            active={estadosSubTab}
            onChange={(id) => setEstadosSubTab(id as EstadosSubTab)}
          />

          {/* Sub-tab: Estados */}
          {estadosSubTab === 'estados' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <CircleDot size={18} className="text-accent-text" />
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
                      <ShoppingCart size={11} className="inline mr-0.5" /> = vendible · <Store size={11} className="inline mr-0.5" /> = TiendaNube · <span className="text-xs font-bold text-yellow-500">ML</span> = MercadoLibre · <RotateCcw size={11} className="inline mr-0.5 text-orange-500" /> = devoluciones · <Percent size={11} className="inline mr-0.5 text-emerald-500" /> = descuento automático en venta · <ShieldCheck size={11} className="inline mr-0.5 text-red-500" /> = requiere aprobación + foto al cambiar a este estado
                    </p>
                  </div>

                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400">
                      <span>Estado</span>
                      <span className="w-8 text-center" title="Disponible para venta"><ShoppingCart size={13} /></span>
                      <span className="w-8 text-center" title="Sincroniza a TiendaNube"><Store size={13} /></span>
                      <span className="w-8 text-center text-yellow-500 font-bold" title="Sincroniza a MercadoLibre">ML</span>
                      <span className="w-8 text-center" title="Estado para devoluciones"><RotateCcw size={13} className="text-orange-500" /></span>
                      <span className="w-20 text-center" title="Descuento automático en venta"><Percent size={13} className="inline text-emerald-500" /></span>
                      <span className="w-8 text-center" title="Requiere aprobación + foto al cambiar a este estado"><ShieldCheck size={13} className="text-red-500" /></span>
                    </div>

                    {(estados as any[]).map((e: any, i: number) => (
                      <div key={e.id}
                        className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-2 px-3 py-2.5 items-center ${i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-700/30'}`}>
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

                        {/* % Descuento automático (punto 3 backlog Fede) */}
                        <div className="w-20 flex items-center justify-center gap-0.5">
                          <input
                            type="number" min="0.01" max="100" step="0.5"
                            key={`${e.id}-${e.descuento_pct ?? ''}`}
                            defaultValue={e.descuento_pct ?? ''}
                            onWheel={ev => ev.currentTarget.blur()}
                            onBlur={ev => updateEstadoDescuento(e.id, ev.target.value)}
                            onKeyDown={ev => ev.key === 'Enter' && ev.currentTarget.blur()}
                            placeholder="—"
                            title="% de descuento automático al vender stock en este estado"
                            className={`w-14 px-1.5 py-1 text-xs text-center border rounded-lg focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800
                              ${e.descuento_pct ? 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 font-medium' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`} />
                        </div>

                        {/* Toggle requiere aprobación + foto (Fede 25/7, punto 2 — fraude interno) */}
                        <button
                          onClick={() => toggleRequiereAprobacion(e.id, !e.requiere_aprobacion)}
                          title={e.requiere_aprobacion ? 'Cambiar a este estado requiere aprobación del supervisor + foto — click para quitar' : 'Marcar: cambiar a este estado va a requerir aprobación del supervisor + foto tomada en el momento'}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${e.requiere_aprobacion
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200'}`}>
                          <ShieldCheck size={14} />
                        </button>

                        {/* Toggle dispara Rotación (B2) — independiente de descuento_pct: un estado
                            puede tener descuento sin activar agotar-antes/prioridad-envíos/armar-kits */}
                        <button
                          onClick={() => toggleDisparaRotacion(e.id, !e.dispara_rotacion)}
                          title={e.dispara_rotacion ? 'Este estado dispara las reglas de Rotación (Config → Inventario → Rotación) — click para quitar' : 'Marcar: este estado va a disparar las reglas de Rotación configuradas por categoría/producto'}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${e.dispara_rotacion
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200'}`}>
                          <RefreshCw size={14} />
                        </button>

                        {/* Toggle motivo vencimiento (C3) — solo relevante junto con dispara_rotacion,
                            pero se deja marcar siempre para no forzar un orden de carga */}
                        <button
                          onClick={() => toggleMotivoVencimiento(e.id, !e.motivo_vencimiento)}
                          title={e.motivo_vencimiento ? 'Motivo: vencimiento — cuenta para "Terminar stock para reponer" (Rotación) — click para quitar' : 'Marcar si este estado representa stock por VENCER (no dañado/otro motivo) — la regla "Terminar stock para reponer" de Rotación solo cuenta estados marcados así'}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${e.motivo_vencimiento
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200'}`}>
                          <Clock size={14} />
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
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-accent-text/30 space-y-4">
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300">{grupoEditId ? 'Editar grupo' : 'Nuevo grupo'}</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre *</label>
                      <input type="text" value={grupoForm.nombre} onChange={e => setGrupoForm(p => ({ ...p, nombre: e.target.value }))}
                        placeholder="Ej: Disponible para venta"
                        className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción (opcional)</label>
                      <input type="text" value={grupoForm.descripcion} onChange={e => setGrupoForm(p => ({ ...p, descripcion: e.target.value }))}
                        placeholder="Ej: Estados vendibles"
                        className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
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
                              ${selected ? 'border-accent-text bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:border-gray-600'}`}>
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                            <span className="truncate">{e.nombre}</span>
                            {selected && <Check size={13} className="text-accent-text ml-auto flex-shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl">
                    <Toggle checked={grupoForm.es_default} colorOn="bg-amber-500"
                      onChange={v => setGrupoForm(p => ({ ...p, es_default: v }))}
                      aria-label="Grupo por defecto" />
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
                            <button onClick={() => startEditGrupo(grupo)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors"><Pencil size={15} /></button>
                            <button onClick={async () => { if (await confirmar('¿Eliminar este grupo?', { danger: true })) deleteGrupo.mutate(grupo.id) }} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg transition-colors"><Trash2 size={15} /></button>
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
                <Timer size={18} className="text-accent-text" />
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Progresión de estado</h2>
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{agingProfiles.length} perfiles</span>
                <button onClick={processAging} disabled={processingAging}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent-text text-xs font-medium rounded-lg transition-all disabled:opacity-50">
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
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
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
                                className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
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
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-accent-text bg-accent/10 hover:bg-accent/20 rounded-lg transition-colors disabled:opacity-50 mr-1">
                                <Play size={10} /> {processingAgingId === ap.id ? 'Procesando...' : 'Procesar'}
                              </button>
                              <button onClick={e => { e.stopPropagation(); setEditAgingId(ap.id); setEditAgingNombre(ap.nombre) }} className="text-gray-400 dark:text-gray-500 hover:text-accent-text p-1"><Pencil size={13} /></button>
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
                                  className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text">
                                  <option value="">— Estado —</option>
                                  {(estados as any[]).map((e: any) => (
                                    <option key={e.id} value={e.id}>{e.nombre}</option>
                                  ))}
                                </select>
                                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={addRuleDias} onChange={e => setAddRuleDias(e.target.value)}
                                  placeholder="Días" className="w-24 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center focus:outline-none focus:border-accent-text" />
                                <button onClick={() => addAgingRegla(ap.id)} disabled={!addRuleEstadoId || addRuleDias === ''}
                                  className="p-1.5 bg-accent text-white rounded-lg disabled:opacity-40"><Check size={14} /></button>
                                <button onClick={() => { setAddRuleProfileId(null); setAddRuleEstadoId(''); setAddRuleDias('') }}
                                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 rounded-lg"><X size={14} /></button>
                              </div>
                            ) : (
                              <button onClick={() => { setAddRuleProfileId(ap.id); setAddRuleEstadoId(''); setAddRuleDias('') }}
                                className="flex items-center gap-1.5 text-xs text-accent-text hover:text-accent-text/80 font-medium mt-1">
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
            <MessageSquare size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Motivos de movimiento</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{motivos.length} cargados</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Motivos predefinidos que aparecen al registrar ingresos y rebajes de stock.</p>
          <MotivosList motivos={motivos} loading={loadingMotivos} onAdd={addMotivo} onUpdate={updateMotivo} onDelete={deleteMotivo} />
        </div>
          )}

          {invSubTab === 'unidades' && (
        <div className="space-y-4">
        {/* Fase 1-bis UoM: catálogo COMPLETO de Unidades FÍSICAS con enable/disable + presets — migs 303/308 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Ruler size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Unidades de Medida</h2>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Cómo se <strong>mide o cuenta</strong> un producto. La conversión dentro de una familia es fija y universal
            (1&nbsp;kg = 1000&nbsp;g siempre). <strong>Activá</strong> las que uses para que aparezcan al cargar productos;
            las demás quedan ocultas. La unidad <em>base</em> de cada familia no se puede apagar. Los <em>nombres de
            empaque</em> (Caja/Pallet) están en la pestaña Empaque.
          </p>

          {canEdit && (
            <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-3">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">Activar unidades típicas de tu rubro:</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS_RUBRO.map(preset => (
                  <button key={preset.label} onClick={() => aplicarPresetRubro(preset.unidades)}
                    className="px-2.5 py-1 text-xs rounded-full border border-accent-text/30 text-accent-text hover:bg-accent/10 transition-colors">
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            {FAMILIAS_FISICAS.map(fam => {
              const us = agruparPorFamilia(unidadesFisicasCfg)[fam]
              if (us.length === 0) return null
              const base = us.find(x => x.es_base_familia)
              return (
                <div key={fam} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                  <p className="text-xs font-semibold text-accent-text mb-1.5">{ETIQUETA_FAMILIA[fam]}{fam === 'conteo' ? ' · sin decimales' : ' · admite decimales'}</p>
                  <div className="space-y-0.5">
                    {us.map(u => (
                      <label key={u.id} className={`flex items-center justify-between text-sm gap-2 py-0.5 ${canEdit && !u.es_base_familia ? 'cursor-pointer' : ''}`}>
                        <span className="flex items-center gap-2 min-w-0">
                          <input type="checkbox" checked={u.activo !== false}
                            disabled={!canEdit || u.es_base_familia}
                            onChange={e => toggleUnidadFisica(u, e.target.checked)}
                            className={u.es_base_familia ? 'accent-cyan-600 dark:accent-cyan-400 flex-shrink-0' : 'accent-accent-text disabled:opacity-40 flex-shrink-0'} />
                          <span className={`truncate ${u.es_base_familia ? 'text-cyan-700 dark:text-cyan-400 font-medium' : u.activo !== false ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                            {u.nombre} {u.simbolo && <span className={u.es_base_familia ? 'text-cyan-600/70 dark:text-cyan-400/70' : 'text-gray-400'}>({u.simbolo})</span>}
                          </span>
                        </span>
                        <span className={`text-xs flex-shrink-0 ${u.es_base_familia ? 'text-cyan-600 dark:text-cyan-400 font-medium' : 'text-gray-400'}`}>{u.es_base_familia ? 'base' : `= ${u.factor_base_familia.toLocaleString('es-AR')} ${base?.simbolo ?? 'base'}`}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        </div>
          )}

          {invSubTab === 'empaque' && (
        <div className="space-y-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Ruler size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Nombres de empaque personalizados</h2>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Nombres de bultos propios de tu negocio (además de Caja/Pallet) para armar las presentaciones de un producto. Distinto de las <em>unidades de medida</em> físicas (Peso/Volumen/…), que están en la pestaña Unidades.</p>

          {/* Agregar */}
          {canEdit && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-2">
              <div className="flex gap-2">
                <input type="text" placeholder="Nombre *" value={udmNombre} onChange={e => setUdmNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addUdm()}
                  className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                <input type="text" placeholder="Símbolo (ej: pz)" value={udmSimbolo} onChange={e => setUdmSimbolo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addUdm()}
                  className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                <select value={udmTipoEmpaque} onChange={e => setUdmTipoEmpaque(e.target.value)}
                  title="Tipo de empaque (informativo, para reportes)"
                  className="w-36 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800">
                  <option value="">Tipo (opcional)</option>
                  {TIPOS_EMPAQUE.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
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
                          className="flex-1 px-3 py-1.5 border border-accent-text rounded-lg text-sm focus:outline-none" />
                        <input type="text" value={udmEditSimbolo} onChange={e => setUdmEditSimbolo(e.target.value)}
                          placeholder="Símbolo"
                          className="w-28 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none" />
                        <select value={udmEditTipoEmpaque} onChange={e => setUdmEditTipoEmpaque(e.target.value)}
                          className="w-36 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none">
                          <option value="">Tipo (opcional)</option>
                          {TIPOS_EMPAQUE.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
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
                        {(u.simbolo || u.tipo_empaque) && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {u.simbolo && <>Símbolo: {u.simbolo}</>}
                            {u.simbolo && u.tipo_empaque && ' · '}
                            {u.tipo_empaque && <>Tipo: {u.tipo_empaque}</>}
                          </p>
                        )}
                      </div>
                      {u.predefinida
                        ? <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded" title="Unidad predefinida del sistema — no eliminable"><Lock size={11} />Predefinida</span>
                        : canEdit && (
                          <>
                            <button onClick={() => { setUdmEditId(u.id); setUdmEditNombre(u.nombre); setUdmEditSimbolo(u.simbolo ?? ''); setUdmEditTipoEmpaque(u.tipo_empaque ?? '') }}
                              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors">
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
        </div>
          )}

          {invSubTab === 'atributos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Shirt size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Atributos de variante</h2>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Valores válidos para talle, color, encaje, formato y sabor/aroma. Se usan al recibir stock y al elegir qué variante vender —
            evitan que "M" y "Mediana" terminen siendo dos cosas distintas sin que te des cuenta. Activá el atributo que corresponda en la ficha del producto (pestaña Trazabilidad).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ATRIBUTOS_VARIANTE.map(a => (
              <button key={a.value} onClick={() => setAtribVarianteTipo(a.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${atribVarianteTipo === a.value ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {a.label}
              </button>
            ))}
          </div>
          {canEdit ? (
            <AtributoValoresList valores={atributoValores as any[]} loading={loadingAtributoValores}
              onAdd={addAtributoValor} onRename={renameAtributoValor} onDelete={deleteAtributoValor} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {(atributoValores as any[]).map(v => (
                <span key={v.id} className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700 rounded-full text-sm text-gray-800 dark:text-gray-100">{v.valor}</span>
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
              <Navigation size={18} className="text-accent-text" /> Configuración de envíos
            </h2>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">$ por km — valor global (todas las sucursales)</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} value={bizCostoKm}
                onChange={e => setBizCostoKm(e.target.value)} placeholder="Ej: 150" min="0" step="0.01" disabled={!canEdit}
                className="w-36 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              <p className="text-xs text-gray-400 dark:text-gray-500">Default global. Si una sucursal tiene su propio $/km en Sucursales, ese valor predomina.</p>
            </div>
          </div>

          {/* EN4 — costos y tarifas (envío propio) */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <DollarSign size={18} className="text-accent-text" /> Tarifas y cobro del envío propio
            </h3>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Factor KM</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizFactorKm} onChange={e => setBizFactorKm(e.target.value)}
                  min="1" step="0.05" disabled={!canEdit}
                  className="w-24 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Costo mínimo ($)</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizCostoMinimo} onChange={e => setBizCostoMinimo(e.target.value)}
                  min="0" step="1" disabled={!canEdit}
                  className="w-28 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
            </div>
            {/* Tramos escalonados (B3) */}
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Costo escalonado por km (opcional, pisa el $/km)</p>
              <div className="space-y-1.5">
                {bizTramos.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">hasta</span>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={t.hasta} disabled={!canEdit}
                      onChange={e => setBizTramos(arr => arr.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))}
                      placeholder="km" className="w-20 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    <span className="text-xs text-gray-400">km =</span>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={t.precio} disabled={!canEdit}
                      onChange={e => setBizTramos(arr => arr.map((x, j) => j === i ? { ...x, precio: e.target.value } : x))}
                      placeholder="$" className="w-24 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    {canEdit && <button onClick={() => setBizTramos(arr => arr.filter((_, j) => j !== i))} className="text-red-500 text-xs">Quitar</button>}
                  </div>
                ))}
              </div>
              {canEdit && <button onClick={() => setBizTramos(arr => [...arr, { hasta: '', precio: '' }])} className="text-xs text-accent-text hover:underline mt-1">+ Agregar tramo</button>}
            </div>
            {/* Recargo horario (B1) */}
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recargo por franja horaria (opcional)</p>
              <div className="space-y-1.5">
                {bizRecargoHorario.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="time" value={r.desde} disabled={!canEdit}
                      onChange={e => setBizRecargoHorario(arr => arr.map((x, j) => j === i ? { ...x, desde: e.target.value } : x))}
                      className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    <span className="text-xs text-gray-400">a</span>
                    <input type="time" value={r.hasta} disabled={!canEdit}
                      onChange={e => setBizRecargoHorario(arr => arr.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))}
                      className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    <span className="text-xs text-gray-400">+$</span>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={r.recargo} disabled={!canEdit}
                      onChange={e => setBizRecargoHorario(arr => arr.map((x, j) => j === i ? { ...x, recargo: e.target.value } : x))}
                      placeholder="recargo" className="w-24 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    {canEdit && <button onClick={() => setBizRecargoHorario(arr => arr.filter((_, j) => j !== i))} className="text-red-500 text-xs">Quitar</button>}
                  </div>
                ))}
              </div>
              {canEdit && <button onClick={() => setBizRecargoHorario(arr => [...arr, { desde: '', hasta: '', recargo: '' }])} className="text-xs text-accent-text hover:underline mt-1">+ Agregar recargo</button>}
            </div>
            {/* Cobro al cliente (B4) */}
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cómo cobra el envío al cliente</label>
                <select value={bizCobroPolitica} onChange={e => setBizCobroPolitica(e.target.value)} disabled={!canEdit}
                  className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800">
                  <option value="cliente_100">Cliente paga 100%</option>
                  <option value="cliente_margen">Cliente + margen %</option>
                  <option value="subsidio">Subsidio (gratis sobre umbral)</option>
                </select>
              </div>
              {bizCobroPolitica === 'cliente_margen' && (
                <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Margen %</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={bizCobroMargen} onChange={e => setBizCobroMargen(e.target.value)} min="0" step="1" disabled={!canEdit}
                    className="w-24 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" /></div>
              )}
              {bizCobroPolitica === 'subsidio' && (
                <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Gratis si venta &gt; $</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={bizSubsidioUmbral} onChange={e => setBizSubsidioUmbral(e.target.value)} min="0" step="1" disabled={!canEdit}
                    className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" /></div>
              )}
            </div>
            {/* Envío gratis condicional (B5 v2 — multi-regla, punto 7 Fede/GO) */}
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Envío gratis condicional
                {' '}<InfoTip text="Cada regla combina condiciones con Y: todas las que completes deben cumplirse (monto mínimo de la venta, etiqueta del cliente, fechas, distancia máxima). Entre reglas alcanza con que UNA aplique. Cuando una regla aplica, el POS pone el costo de envío en $0 automáticamente (editable)." />
              </p>
              {bizGratisReglas.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Sin reglas — el envío nunca es gratis automáticamente.</p>
              )}
              <div className="space-y-2">
                {bizGratisReglas.map((r, idx) => (
                  <div key={idx} className="border border-gray-200 dark:border-gray-600 rounded-xl p-3 space-y-2 bg-gray-50 dark:bg-gray-700/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Regla {idx + 1}</span>
                      {canEdit && (
                        <button type="button" onClick={() => setBizGratisReglas(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="Quitar regla">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input type="number" onWheel={e => e.currentTarget.blur()} value={r.montoMinimo} disabled={!canEdit}
                        onChange={e => setBizGratisReglas(prev => prev.map((x, i) => i === idx ? { ...x, montoMinimo: e.target.value } : x))}
                        placeholder="Compra mínima ($) — vacío = sin mínimo"
                        className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      <input type="text" value={r.etiquetas} disabled={!canEdit}
                        onChange={e => setBizGratisReglas(prev => prev.map((x, i) => i === idx ? { ...x, etiquetas: e.target.value } : x))}
                        placeholder="Etiquetas de cliente (Mayorista, VIP)"
                        className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 whitespace-nowrap">Vigencia</span>
                        <input type="date" value={r.desde} disabled={!canEdit}
                          onChange={e => setBizGratisReglas(prev => prev.map((x, i) => i === idx ? { ...x, desde: e.target.value } : x))}
                          className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 rounded-xl px-2 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <span className="text-xs text-gray-400">a</span>
                        <input type="date" value={r.hasta} disabled={!canEdit}
                          onChange={e => setBizGratisReglas(prev => prev.map((x, i) => i === idx ? { ...x, hasta: e.target.value } : x))}
                          className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 rounded-xl px-2 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.5" value={r.maxKm} disabled={!canEdit}
                          onChange={e => setBizGratisReglas(prev => prev.map((x, i) => i === idx ? { ...x, maxKm: e.target.value } : x))}
                          placeholder="Distancia máx. (km)"
                          className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <InfoTip text="Tope de distancia del envío para que la regla aplique. Si el envío no tiene distancia calculada (costo por monto fijo), una regla con tope de km NO aplica — nunca se regala un envío fuera de radio." />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {describirReglaGratis({
                        montoMinimo: r.montoMinimo ? parseFloat(r.montoMinimo) : null,
                        etiquetas: r.etiquetas.split(',').map(s => s.trim()).filter(Boolean),
                        desde: r.desde || null, hasta: r.hasta || null,
                        maxKm: r.maxKm ? parseFloat(r.maxKm) : null,
                      })}
                    </p>
                  </div>
                ))}
              </div>
              {canEdit && (
                <button type="button"
                  onClick={() => setBizGratisReglas(prev => [...prev, { montoMinimo: '', etiquetas: '', desde: '', hasta: '', maxKm: '' }])}
                  className="mt-2 text-xs text-accent-text hover:underline flex items-center gap-1">
                  <Plus size={12} /> Agregar regla de envío gratis
                </button>
              )}
            </div>
          </div>

          {/* ISS-178 — Rangos horarios de entrega */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Clock size={18} className="text-accent-text" /> Rangos horarios para entrega
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
              El operador elige uno de estos rangos al cargar el envío en una venta. Defaults: 8-13 / 13-18 / 18-22. Editables y eliminables.
            </p>
            <div className="space-y-2">
              {bizEnvioRangos.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" value={r.desde} disabled={!canEdit}
                    onChange={e => setBizEnvioRangos(arr => arr.map((x, j) => j === i ? { ...x, desde: e.target.value } : x))}
                    className="w-28 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                  <span className="text-gray-400">a</span>
                  <input type="time" value={r.hasta} disabled={!canEdit}
                    onChange={e => setBizEnvioRangos(arr => arr.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))}
                    className="w-28 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
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
                  className="text-xs text-accent-text hover:underline"
                >
                  + Agregar rango
                </button>
              </div>
            )}
          </div>

          {/* ISS-174 — fuente del peso/medidas para cotizar */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Package size={18} className="text-accent-text" /> Peso y medidas para cotizar envíos
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
              Define de dónde sale el peso y las dimensiones al cotizar un envío por courier.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                { v: 'manual',   t: 'Manual por envío',     d: 'El operador carga peso y medidas del bulto al cotizar cada envío.' },
                { v: 'producto', t: 'Dato maestro del producto', d: 'Se toma el peso y las medidas de cada producto y se suma el carrito.' },
              ] as const).map(opt => (
                <button key={opt.v} type="button" disabled={!canEdit}
                  onClick={() => setBizPesoFuente(opt.v)}
                  className={`text-left p-3 rounded-xl border transition-colors disabled:opacity-60
                    ${bizPesoFuente === opt.v
                      ? 'border-accent-text bg-accent/5'
                      : 'border-gray-200 dark:border-gray-600 hover:border-accent-text/40'}`}>
                  <p className={`text-sm font-medium ${bizPesoFuente === opt.v ? 'text-accent-text' : 'text-gray-700 dark:text-gray-300'}`}>{opt.t}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{opt.d}</p>
                </button>
              ))}
            </div>
          </div>

          {/* EN1 — pagos a courier contables */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <CreditCard size={18} className="text-accent-text" /> Pagos a courier (contabilidad)
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
              Al marcar pagado un envío de courier tercero en la pestaña "Pagos Courier", se puede generar un gasto contable automático.
            </p>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={bizCourierGeneraGasto} disabled={!canEdit}
                onChange={e => setBizCourierGeneraGasto(e.target.checked)} className="accent-accent mt-0.5" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Generar gasto automático <span className="text-gray-400">(categoría "Transporte y fletes", proveedor = courier, IVA crédito fiscal; egreso de caja si el medio es efectivo)</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Alícuota IVA del flete (%)</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizCourierIvaPct}
                  onChange={e => setBizCourierIvaPct(e.target.value)} min="0" step="0.5" disabled={!canEdit || !bizCourierGeneraGasto}
                  className="w-28 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Umbral doble firma ($, 0 = sin)</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizEnvioDobleFirma}
                  onChange={e => setBizEnvioDobleFirma(e.target.value)} min="0" step="1" disabled={!canEdit}
                  className="w-40 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 flex-1 min-w-[180px]">Pagos a courier por encima del umbral exigen la clave maestra del dueño.</p>
            </div>
          </div>

          {/* EN2 — POD robusto */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <ClipboardCheck size={18} className="text-accent-text" /> Prueba de entrega (POD)
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
              Definí qué datos exige el comprobante de entrega y las reglas de no-entrega / reintento.
            </p>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Campos requeridos para marcar "Entregado"</p>
              <div className="flex flex-wrap gap-3">
                {([
                  { k: 'fecha', t: 'Fecha' }, { k: 'receptor', t: 'Receptor' }, { k: 'foto', t: 'Foto' },
                  { k: 'firma', t: 'Firma' }, { k: 'dni', t: 'DNI' },
                ] as const).map(c => (
                  <label key={c.k} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={!!bizPodReq[c.k]} disabled={!canEdit}
                      onChange={e => setBizPodReq(p => ({ ...p, [c.k]: e.target.checked }))} className="accent-accent" />
                    {c.t}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Mín. de fotos</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizPodFotoMin} onChange={e => setBizPodFotoMin(e.target.value)}
                  min="0" step="1" disabled={!canEdit}
                  className="w-24 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">OTP sobre monto ($, 0 = off)</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizPodOtpUmbral} onChange={e => setBizPodOtpUmbral(e.target.value)}
                  min="0" step="1" disabled={!canEdit}
                  className="w-36 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Geoloc alerta (km, 0 = off)</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizGeolocAlertaKm} onChange={e => setBizGeolocAlertaKm(e.target.value)}
                  min="0" step="0.5" disabled={!canEdit}
                  className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Máx. reintentos</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizReintentosMax} onChange={e => setBizReintentosMax(e.target.value)}
                  min="1" step="1" disabled={!canEdit}
                  className="w-24 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Recargo tras máx. ($)</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={bizReintentoRecargo} onChange={e => setBizReintentoRecargo(e.target.value)}
                  min="0" step="1" disabled={!canEdit}
                  className="w-28 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">El OTP solo aplica a envíos propios sobre el monto indicado. La geoloc tiene fallback: si no se puede capturar, igual permite confirmar.</p>
          </div>

          {/* EN3 — reparto (repartidores + reglas del transportista) */}
          <RepartidoresPanel canEdit={canEdit} />
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Navigation size={18} className="text-accent-text" /> Reparto y página del transportista
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notificación "en camino"</label>
                <select value={bizNotifEnCamino} onChange={e => setBizNotifEnCamino(e.target.value)} disabled={!canEdit}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800">
                  <option value="no">No notificar</option>
                  <option value="wa">WhatsApp "en camino" (recomendado)</option>
                  <option value="wa_tracking">WhatsApp + link de seguimiento</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Identidad del transportista</label>
                <select value={bizIdentidadModo} onChange={e => setBizIdentidadModo(e.target.value)} disabled={!canEdit}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800">
                  <option value="anonimo">Anónimo por link (default)</option>
                  <option value="nombre_dni">Pedir nombre + DNI al abrir</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Hoja de ruta</label>
                <select value={bizHojaRutaModo} onChange={e => setBizHojaRutaModo(e.target.value)} disabled={!canEdit}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800">
                  <option value="por_envio">Un link por envío</option>
                  <option value="agrupada">Hoja agrupada por chofer</option>
                  <option value="agrupada_proximidad">Hoja agrupada + orden por proximidad</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Expiración del link del transportista</label>
                <div className="flex gap-2">
                  <select value={bizTokenPolitica} onChange={e => setBizTokenPolitica(e.target.value)} disabled={!canEdit}
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800">
                    <option value="al_entregar">Al entregar / cancelar</option>
                    <option value="dias">A los N días</option>
                  </select>
                  {bizTokenPolitica === 'dias' && (
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={bizTokenDias} onChange={e => setBizTokenDias(e.target.value)}
                      min="1" step="1" disabled={!canEdit}
                      className="w-20 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* EN5 — creación y alcance */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Clock size={18} className="text-accent-text" /> Plazo de despacho y sugerencia de courier
            </h3>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plazo de despacho por canal (horas, 0 = sin alerta)</p>
              <div className="flex flex-wrap gap-3">
                {([['Presencial', bizPlazoPresencial, setBizPlazoPresencial], ['Online', bizPlazoOnline, setBizPlazoOnline], ['Mayorista', bizPlazoMayorista, setBizPlazoMayorista]] as const).map(([label, val, setter]) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={val} onChange={e => (setter as any)(e.target.value)} min="0" step="1" disabled={!canEdit}
                      className="w-24 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Courier sugerido por rango de CP (opcional)</p>
              <div className="space-y-1.5">
                {bizCpCourier.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">CP</span>
                    <input value={r.desde} onChange={e => setBizCpCourier(arr => arr.map((x, j) => j === i ? { ...x, desde: e.target.value } : x))} placeholder="desde" disabled={!canEdit}
                      className="w-24 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    <span className="text-xs text-gray-400">a</span>
                    <input value={r.hasta} onChange={e => setBizCpCourier(arr => arr.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))} placeholder="hasta" disabled={!canEdit}
                      className="w-24 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    <span className="text-xs text-gray-400">→</span>
                    <input value={r.courier} onChange={e => setBizCpCourier(arr => arr.map((x, j) => j === i ? { ...x, courier: e.target.value } : x))} placeholder="Courier" disabled={!canEdit}
                      className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    {canEdit && <button onClick={() => setBizCpCourier(arr => arr.filter((_, j) => j !== i))} className="text-red-500 text-xs">Quitar</button>}
                  </div>
                ))}
              </div>
              {canEdit && <button onClick={() => setBizCpCourier(arr => [...arr, { desde: '', hasta: '', courier: '' }])} className="text-xs text-accent-text hover:underline mt-1">+ Agregar regla</button>}
            </div>
          </div>

          {/* EN7 — envío propio (combustible) + alertas de envíos */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Truck size={18} className="text-accent-text" /> Envío propio y alertas
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Precio del litro de combustible</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} value={bizCombustiblePrecio} onChange={e => setBizCombustiblePrecio(e.target.value)} min="0" step="0.01" disabled={!canEdit}
                className="w-40 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
              <p className="text-xs text-gray-400 mt-1">Estima el gasto de combustible por envío (KM × consumo del vehículo × precio). El consumo se carga por vehículo en Recursos.</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Umbrales de alertas (Reportes → Alertas)</p>
              <div className="flex flex-wrap gap-3">
                {([
                  ['Sin despachar (horas)', bizAlertaSinDespacho, setBizAlertaSinDespacho],
                  ['POD pendiente (días)', bizAlertaPodDias, setBizAlertaPodDias],
                  ['Pago courier (días)', bizAlertaPagoDias, setBizAlertaPagoDias],
                  ['Diferencia cot. vs real (%)', bizAlertaDifPct, setBizAlertaDifPct],
                ] as const).map(([label, val, setter]) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={val} onChange={e => (setter as any)(e.target.value)} min="0" step="1" disabled={!canEdit}
                      className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ISS-174 — credenciales de courier (owner-only) */}
          {canEdit && <CourierCredencialesPanel />}

          {canEdit && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <span className="text-lg">💬</span> Plantilla WhatsApp — Coordinar entregas
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Plantilla para el botón "Coordinar por WhatsApp" en el módulo de Envíos.
                Tocá una variable para insertarla donde esté el cursor:
              </p>
              {/* Punto 9 Fede/GO: variables como chips clickeables (antes eran texto plano) */}
              <div className="flex flex-wrap gap-1.5">
                {['Nombre_Cliente', 'Nombre_Negocio', 'Numero_Orden', 'Tracking', 'Courier', 'Fecha_Entrega'].map(v => (
                  <button key={v} type="button"
                    onClick={() => {
                      const ta = waTextareaRef.current
                      const token = `{{${v}}}`
                      if (!ta) { setBizWAPlantilla(p => p + token); return }
                      const start = ta.selectionStart ?? bizWAPlantilla.length
                      const end = ta.selectionEnd ?? start
                      const nuevo = bizWAPlantilla.slice(0, start) + token + bizWAPlantilla.slice(end)
                      setBizWAPlantilla(nuevo)
                      // devolver el foco y dejar el cursor después del token insertado
                      requestAnimationFrame(() => {
                        ta.focus()
                        const pos = start + token.length
                        ta.setSelectionRange(pos, pos)
                      })
                    }}
                    className="px-2.5 py-1 text-xs font-mono rounded-full border border-accent-text/40 text-accent-text hover:bg-accent/10 transition-colors cursor-pointer">
                    + {`{{${v}}}`}
                  </button>
                ))}
              </div>
              <textarea ref={waTextareaRef} value={bizWAPlantilla} onChange={e => setBizWAPlantilla(e.target.value)}
                rows={5} placeholder={`Hola {{Nombre_Cliente}}! Somos {{Nombre_Negocio}}.\n\nTu pedido #{{Numero_Orden}} está en camino.\n🚚 Courier: {{Courier}}\n📅 Fecha: {{Fecha_Entrega}}`}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent-text resize-y bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-mono" />
            </div>
          )}

          {/* Un solo botón guarda toda la configuración de Envíos */}
          {canEdit && (
            <div className="flex justify-end pt-1">
              <button onClick={handleSaveBiz} disabled={savingBiz}
                className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                {savingBiz ? 'Guardando...' : 'Guardar configuración de Envíos'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ TAB: PEDIDOS (PED7) ═══════════ */}
      {tab === 'pedidos' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <ListOrdered size={18} className="text-accent-text" /> Numeración
            </h2>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="radio" checked={((tenant as any)?.pedido_numeracion ?? 'sucursal') === 'sucursal'}
                  onChange={() => setPedidoNumeracion('sucursal')} disabled={!canEdit} />
                Correlativo por sucursal
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="radio" checked={(tenant as any)?.pedido_numeracion === 'tenant'}
                  onChange={() => setPedidoNumeracion('tenant')} disabled={!canEdit} />
                Correlativo único (todo el negocio)
              </label>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Ambos números se calculan siempre — esto solo decide cuál se muestra como principal en la pantalla de Pedidos.</p>
          </div>

          {/* Canales que generan pedido automáticamente (mig 315) */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Layers size={18} className="text-accent-text" /> Canales que NO generan pedido
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Por default <strong>toda venta genera un Pedido de preparación</strong> para que el depósito la arme, salvo la{' '}
              <strong>entrega directa</strong> (mostrador, cobrada y sin envío: el cliente se lleva la mercadería en el momento).
              Marcá acá los canales que querés dejar <strong>afuera</strong> de esa regla. Normalmente no hace falta marcar ninguno.
            </p>
            {canalesPedido.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No hay canales de venta activos. Configuralos en Ventas → Canales.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {canalesPedido.map(c => {
                  const activo = canalesAutoSel.includes(c.id)
                  return (
                    <button key={c.id} type="button" disabled={!canEdit}
                      onClick={() => togglePedidoCanalAuto(c.id)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                        ${activo
                          ? 'bg-accent/10 border-accent-text text-accent-text font-medium'
                          : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                      {activo && <Check size={13} className="inline mr-1 -mt-0.5" />}{c.nombre}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Los pedidos de retiro en local aparecen en <strong>Ventas → Pedidos</strong> una vez que el depósito
              termina el picking, para entregarlos en el mostrador.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Crear pedidos a mano</h2>
            <label className="flex items-start gap-3 cursor-pointer py-1">
              <div className="mt-0.5"><Toggle checked={(tenant as any)?.pedido_manual_habilitado ?? false} onChange={togglePedidoManual} disabled={!canEdit} /></div>
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Botón "Nuevo pedido" en el módulo Pedidos</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Normalmente no hace falta: el pedido lo genera la venta. Prendelo solo si necesitás armar pedidos
                  sin una venta detrás — el caso típico es el <strong>mayorista con entregas parciales</strong>,
                  que el mostrador no sabe hacer.
                </p>
              </div>
            </label>
            {((tenant as any)?.pedido_manual_habilitado ?? false) && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>Cómo factura un pedido armado a mano:</strong> precio de lista del producto + descuentos
                  por volumen (tiers mayoristas) + descuento por estado de inventario. <strong>No aplica combos
                  ni la lista de precios por canal</strong> — esas son reglas del mostrador y un pedido no tiene
                  canal de venta. Si tu negocio depende de alguna de las dos, cargá la venta por el POS y dejá que
                  ella genere el pedido.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Cierre del pedido</h2>
            <label className="flex items-center gap-3 cursor-pointer py-1">
              <Toggle checked={(tenant as any)?.pedido_cierre_automatico ?? true} onChange={togglePedidoCierreAutomatico} disabled={!canEdit} />
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Cierre automático al 100%</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Si está habilitado, el pedido pasa solo a "Entregado" al completar todas sus líneas. Si lo desactivás, queda en "Entregado parcial" hasta que alguien lo cierre a mano.</p>
              </div>
            </label>
          </div>

          {/* E3 — pedido_transiciones_roles: quién puede hacer cada transición */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <UserCog size={18} className="text-accent-text" /> Quién puede hacer cada transición
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-3">
              Por default DUEÑO/SUPERVISOR/SUPER_USUARIO/DEPOSITO pueden todas las transiciones. Marcá o desmarcá roles por transición para ajustarlo — ADMIN (soporte) siempre puede, no se lista.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 dark:text-gray-500">
                    <th className="font-medium pb-2 pr-3">Transición</th>
                    {PEDIDO_ROLES_CONFIGURABLES.map(rol => (
                      <th key={rol} className="font-medium pb-2 px-2 text-center whitespace-nowrap">{rol}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PEDIDO_TRANSICIONES.map(({ key, label }) => (
                    <tr key={key} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{label}</td>
                      {PEDIDO_ROLES_CONFIGURABLES.map(rol => (
                        <td key={rol} className="text-center px-2">
                          <input type="checkbox" disabled={!canEdit}
                            checked={puedeTransicionPedido(rol, key, ((tenant as any)?.pedido_transiciones_roles ?? null) as PedidoTransicionesConfig)}
                            onChange={() => togglePedidoTransicionRol(key, rol)}
                            className="rounded disabled:opacity-50" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-1">
              <Tag size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Tipos de pedido</h2>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{(tiposPedidoCfg as any[]).length} cargados</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Cada tipo define si el cliente identificado es obligatorio y en qué momento se factura.</p>

            {canEdit && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input type="text" placeholder="Nombre del tipo (ej: Mayorista)" value={newTipoPedidoNombre}
                    onChange={e => setNewTipoPedidoNombre(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTipoPedido()}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                  <button onClick={addTipoPedido} disabled={!newTipoPedidoNombre.trim()}
                    className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1">
                    <Plus size={15} /> Agregar
                  </button>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                  <select value={newTipoPedidoFactura} onChange={e => setNewTipoPedidoFactura(e.target.value as any)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-primary">
                    <option value="al_confirmar">Factura al confirmar</option>
                    <option value="al_entregar">Factura al entregar</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={newTipoPedidoClienteOblig} onChange={e => setNewTipoPedidoClienteOblig(e.target.checked)} className="rounded" />
                    Cliente obligatorio
                  </label>
                </div>
              </div>
            )}

            {loadingTiposPedido ? <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Cargando...</p> : (
              <div className="space-y-2">
                {(tiposPedidoCfg as any[]).map(t => (
                  <div key={t.id} className={`flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2.5 ${!t.activo ? 'opacity-50' : ''}`}>
                    {editTipoPedidoId === t.id ? (
                      <div className="flex-1 flex flex-wrap gap-2 items-center">
                        <input type="text" value={editTipoPedidoNombre} onChange={e => setEditTipoPedidoNombre(e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-accent-text" />
                        <select value={editTipoPedidoFactura} onChange={e => setEditTipoPedidoFactura(e.target.value as any)}
                          className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-xs bg-white dark:bg-gray-800 text-primary">
                          <option value="al_confirmar">Al confirmar</option>
                          <option value="al_entregar">Al entregar</option>
                        </select>
                        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                          <input type="checkbox" checked={editTipoPedidoClienteOblig} onChange={e => setEditTipoPedidoClienteOblig(e.target.checked)} className="rounded" />
                          Cliente oblig.
                        </label>
                        <button onClick={() => saveTipoPedido(t.id)} className="text-green-600 dark:text-green-400 hover:text-green-700 p-1"><Check size={15} /></button>
                        <button onClick={() => setEditTipoPedidoId(null)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 p-1"><X size={15} /></button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{t.nombre}</span>
                          <span className="ml-2 text-xs text-gray-400">{t.factura_momento === 'al_confirmar' ? 'Factura al confirmar' : 'Factura al entregar'}</span>
                          {t.cliente_obligatorio && <span className="ml-2 text-xs text-blue-500">Cliente obligatorio</span>}
                        </div>
                        {canEdit && (
                          <>
                            <button onClick={() => toggleActivoTipoPedido(t)} className="text-xs text-gray-400 hover:text-accent-text px-2">
                              {t.activo ? 'Desactivar' : 'Activar'}
                            </button>
                            <button onClick={() => startEditTipoPedido(t)} className="text-gray-400 dark:text-gray-500 hover:text-accent-text p-1"><Pencil size={14} /></button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {(tiposPedidoCfg as any[]).length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay tipos de pedido cargados.</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ TAB: GASTOS (v1.8.42) ═══════════ */}
      {tab === 'gastos' && (
        <div className="space-y-4">
          {/* Reglas de comprobante */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Receipt size={18} className="text-accent-text" /> Cuándo es obligatorio adjuntar comprobante
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
                  {r.v ? <ToggleRight size={26} className="text-accent-text" /> : <ToggleLeft size={26} className="text-gray-300 dark:text-gray-600" />}
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
                  className="w-40 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                <span className="text-xs text-gray-400">A partir de este monto, se exigirá comprobante</span>
              </div>
            )}
          </div>

          {/* Alertas */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Bell size={18} className="text-accent-text" /> Alertas
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Días para alertar gastos en Borrador</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={gDiasAlertaBorrador}
                  onChange={e => setGDiasAlertaBorrador(e.target.value)} min="1" max="365" disabled={!canEdit}
                  className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si un gasto sin medio de pago lleva más de N días, alerta al DUEÑO + SUPERVISOR.</p>
              </div>
              {modoAvanzado && (
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Días para alertar Anticipo en OC sin recibir</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={gDiasAlertaAnticipo}
                  onChange={e => setGDiasAlertaAnticipo(e.target.value)} min="1" max="365" disabled={!canEdit}
                  className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si una OC tiene anticipo (pago hecho) y pasaron N días sin recibir mercadería, el badge se pone en rojo.</p>
              </div>
              )}
              {/* CO6 — alerta de cheques */}
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Días para alertar Cheques próximos a cobrar</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={chequesAlertaDias}
                  onChange={e => setChequesAlertaDias(e.target.value)} min="1" max="365" disabled={!canEdit}
                  className="w-32 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Cheques pendientes (Gastos → Cheques) cuya fecha de cobro está dentro de N días (o vencida) se marcan como alerta.</p>
              </div>
            </div>

            {/* CO1 — Gobierno de Órdenes de Compra (modo avanzado) */}
            {modoAvanzado && (
            <div className="pt-4 mt-2 border-t border-gray-100 dark:border-gray-700 space-y-4">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Órdenes de compra (OC)</h3>
              <div className="flex items-start gap-3">
                <button onClick={() => canEdit && setOcAprobActiva(v => !v)} disabled={!canEdit} className="flex-shrink-0 mt-0.5">
                  {ocAprobActiva ? <ToggleRight size={26} className="text-accent-text" /> : <ToggleLeft size={26} className="text-gray-300 dark:text-gray-600" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-700 dark:text-gray-200 text-sm">Requerir aprobación antes de enviar al proveedor</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">La OC que supere el umbral debe ser aprobada por DUEÑO/SUPERVISOR antes de enviarse. Sin umbral = todas requieren aprobación.</p>
                  {ocAprobActiva && (
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={ocAprobUmbral} disabled={!canEdit}
                      onChange={e => setOcAprobUmbral(e.target.value)} placeholder="Umbral $ (vacío = siempre)" min="0" step="0.01"
                      className="mt-2 w-48 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700" />
                  )}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Numeración de OC</label>
                  <select value={ocNumeracion} onChange={e => setOcNumeracion(e.target.value)} disabled={!canEdit}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700">
                    <option value="sucursal">Por sucursal (S1-OC-0001)</option>
                    <option value="tenant">Única por negocio</option>
                    <option value="proveedor">Por proveedor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Doble firma de pago — umbral $</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={ocDobleFirmaUmbral} disabled={!canEdit}
                    onChange={e => setOcDobleFirmaUmbral(e.target.value)} placeholder="Vacío = sin doble firma" min="0" step="0.01"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Pagos de OC sobre este monto piden la clave maestra. (El CONTADOR nunca registra pagos.)</p>
                </div>
              </div>
              {/* CO3 — costos + recepción */}
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Alerta de cambio de costo (%)</label>
                  <input type="number" min="0" onWheel={e => e.currentTarget.blur()} value={ocCostoAlertaPct} disabled={!canEdit}
                    onChange={e => setOcCostoAlertaPct(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Al recibir, si el costo varía más que este %, se avisa y el operador decide actualizarlo.</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Over-receipt máximo (%)</label>
                  <input type="number" min="0" onWheel={e => e.currentTarget.blur()} value={ocOverReceiptPct} disabled={!canEdit}
                    onChange={e => setOcOverReceiptPct(e.target.value)} placeholder="Vacío = sin tope"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Tope para recibir más de lo pedido (requiere "permitir over-receipt" activo en Inventario).</p>
                </div>
                <div className="flex items-start gap-2 pt-6">
                  <button onClick={() => canEdit && setOcRemitoObligatorio(v => !v)} disabled={!canEdit} className="flex-shrink-0">
                    {ocRemitoObligatorio ? <ToggleRight size={26} className="text-accent-text" /> : <ToggleLeft size={26} className="text-gray-300 dark:text-gray-600" />}
                  </button>
                  <div>
                    <p className="font-medium text-gray-700 dark:text-gray-200 text-sm">Remito obligatorio</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Exige adjuntar el remito del proveedor al confirmar una recepción.</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Alerta de faltante de recepción (días)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="365" value={ocFaltanteAlertaDias} disabled={!canEdit}
                    onChange={e => setOcFaltanteAlertaDias(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si una OC queda con recepción parcial (faltante) y pasan N días sin actividad, el badge 📦 se pone en rojo.</p>
                </div>
              </div>
            </div>
            )}

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
              <Tag size={18} className="text-accent-text" /> Categorías de gasto
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
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100" />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  <input type="checkbox" checked={newCategoria.requiere_sucursal}
                    onChange={e => setNewCategoria(c => ({ ...c, requiere_sucursal: e.target.checked }))}
                    className="rounded border-gray-300 dark:border-gray-600 text-accent-text focus:ring-accent-text" />
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
                              ? <ToggleRight size={22} className="text-accent-text" />
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
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/20 text-accent-text">Predefinida</span>
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

          {/* Métodos de pago sub-tab — REGLA #0: bug real encontrado 2026-08-08 (GO) — este bloque
              quedó borrado por completo en el refactor de tabs del backlog Comercial (commit
              6661d5c6) sin que nadie lo notara; la pestaña existía pero no renderizaba nada. El
              estado/mutations (nuevoMetodo, metodosPago, cuotasBancos, etc.) nunca se tocaron —
              solo faltaba este JSX. Restaurado sin cambios de comportamiento. */}
          {tab === 'ventas' && ventasSubTab === 'metodos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={18} className="text-accent-text" />
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
                <div key={m.id} className="border border-gray-100 dark:border-gray-700 rounded-xl">
                <div className="flex items-center gap-3 px-4 py-3">
                  {editMetodoId === m.id ? (
                    <>
                      <input type="color" value={editMetodoData.color}
                        onChange={e => setEditMetodoData(p => ({ ...p, color: e.target.value }))}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0 flex-shrink-0" />
                      <input type="text" value={editMetodoData.nombre}
                        onChange={e => setEditMetodoData(p => ({ ...p, nombre: e.target.value }))}
                        className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                      <div className="flex items-center gap-1 shrink-0">
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="50" step="0.1"
                          value={editMetodoData.comision_pct}
                          onChange={e => setEditMetodoData(p => ({ ...p, comision_pct: e.target.value }))}
                          placeholder="0"
                          className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-center focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                        <span className="text-xs text-gray-400 dark:text-gray-500">%</span>
                      </div>
                      <select
                        value={editMetodoData.cuenta_origen_id || ''}
                        onChange={e => setEditMetodoData(p => ({ ...p, cuenta_origen_id: e.target.value || null }))}
                        title="Cuenta donde se acredita este método"
                        className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white shrink-0">
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
                        <span className="text-xs px-1.5 py-0.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 rounded font-mono" title="Comisión que te cobra la plataforma (costo tuyo, no descuento al cliente)">
                          {m.comision_pct}%
                        </span>
                      )}
                      {(() => {
                        const d = descuentoDeConfig(m.config)
                        return d ? (
                          <span className="text-xs px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded font-medium" title="Descuento al cliente por pagar con este método">
                            🏷 {etiquetaPromo(d)}
                          </span>
                        ) : null
                      })()}
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
                      {canEdit && (
                        <button onClick={() => promoMetodoId === m.id ? setPromoMetodoId(null) : abrirPromoMetodo(m)}
                          title="Descuento al cliente por pagar con este método"
                          className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${descuentoDeConfig(m.config) ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200'}`}>
                          Promo
                        </button>
                      )}
                      <button onClick={() => { setEditMetodoId(m.id); setEditMetodoData({ nombre: m.nombre, color: m.color, comision_pct: m.comision_pct ? String(m.comision_pct) : '', cuenta_origen_id: m.cuenta_origen_id ?? '' }) }}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors">
                        <Pencil size={14} />
                      </button>
                      {!m.es_sistema && (
                        <button onClick={async () => { if (await confirmar('¿Eliminar este método?', { danger: true })) deleteMetodoPago.mutate(m.id) }}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Panel de promo por método (punto 1 Fede/GO): % + tope + días + vigencia */}
                {promoMetodoId === m.id && (
                  <div className="px-4 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Descuento que se le hace <strong>al cliente</strong> por pagar con {m.nombre}.
                      {' '}<InfoTip text="Distinto de la comisión (naranja), que es lo que la plataforma te cobra a vos. El descuento se aplica solo en el POS al cobrar con este método, respetando días y vigencia. Con pago mixto, descuenta sobre lo abonado con este método. Dejá el % vacío para quitar la promo." />
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Descuento (%)</label>
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.5" value={promoForm.pct}
                          onChange={e => setPromoForm(p => ({ ...p, pct: e.target.value }))} placeholder="0"
                          className="w-20 px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-center focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tope ($, opcional)</label>
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={promoForm.tope}
                          onChange={e => setPromoForm(p => ({ ...p, tope: e.target.value }))} placeholder="Sin tope"
                          className="w-28 px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Vigencia (opcional)</label>
                        <div className="flex items-center gap-1.5">
                          <input type="date" value={promoForm.desde} onChange={e => setPromoForm(p => ({ ...p, desde: e.target.value }))}
                            className="px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                          <span className="text-xs text-gray-400">a</span>
                          <input type="date" value={promoForm.hasta} onChange={e => setPromoForm(p => ({ ...p, hasta: e.target.value }))}
                            className="px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Días de la semana (ninguno marcado = todos)</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {DIAS_SEMANA_CORTOS.map((dia, i) => (
                          <button key={dia} type="button"
                            onClick={() => setPromoForm(p => ({ ...p, dias: p.dias.includes(i) ? p.dias.filter(x => x !== i) : [...p.dias, i].sort() }))}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                              ${promoForm.dias.includes(i)
                                ? 'border-accent-text bg-accent/10 text-accent-text font-medium'
                                : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
                            {dia}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setPromoMetodoId(null)}
                        className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        Cancelar
                      </button>
                      <button onClick={() => savePromoMetodo.mutate(m)} disabled={savePromoMetodo.isPending}
                        className="px-3 py-1.5 bg-accent hover:bg-accent/90 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-60">
                        {savePromoMetodo.isPending ? 'Guardando…' : 'Guardar promo'}
                      </button>
                    </div>
                  </div>
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
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
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
                    className="text-xs text-accent-text hover:underline">
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
                      placeholder="Cuotas" className="w-20 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                    <input type="number" min="0" step="0.1" value={nuevaCuota.interes} onChange={e => setNuevaCuota(p => ({ ...p, interes: e.target.value }))}
                      placeholder="Interés %" className="w-24 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
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
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
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

          {/* Operativa sub-tab — REGLA #0: mismo bug/mismo fix que "Métodos de pago" arriba. De lo
              que había acá antes del borrado accidental, "Alertas de ventas" y "Cuenta corriente de
              clientes" YA se reconstruyeron en su propio lugar (tabs Alertas/Clientes/Notificaciones,
              sesión 2026-08-06) — restaurar esos paneles ACÁ TAMBIÉN duplicaría la edición del mismo
              dato en 2 pantallas distintas. Lo que sigue es SOLO lo que quedó huérfano de verdad:
              CanalesVentaPanel, validez de presupuesto, Reservas, y Cliente en el punto de venta —
              confirmado grepeando el archivo entero: ningún otro JSX referencia estos estados. */}
          {tab === 'ventas' && ventasSubTab === 'operativa' && (
            <div className="space-y-4">
              {/* VF2 — Canales de venta + reglas online/presencial */}
              <CanalesVentaPanel />

              {/* Presupuesto */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Documentos</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Validez de presupuesto (días)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="365" value={bizPresupuestoValidez} disabled={!canEdit}
                    onChange={e => setBizPresupuestoValidez(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Un presupuesto creado hoy expirará en esta cantidad de días. Se muestra en el ticket de presupuesto.</p>
                </div>
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
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">0 = cualquier seña mayor a cero. Ej: 30 exige al menos el 30% del total al reservar.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vencimiento de reserva (días)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="365"
                    value={bizReservaVencimientoDias} disabled={!canEdit} placeholder="Sin vencimiento"
                    onChange={e => setBizReservaVencimientoDias(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Vacío = sin vencimiento. Pasados estos días sin despachar, <span className="font-medium">el inventario reservado se libera automáticamente</span> y la reserva se cancela.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Penalidad al cancelar (% de la seña)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.5"
                    value={bizReservaPenalidadPct} disabled={!canEdit}
                    onChange={e => setBizReservaPenalidadPct(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">0 = sin penalidad (se devuelve la seña completa). Ej: 10 retiene el 10% de la seña al cancelar.</p>
                </div>
              </div>

              {/* Cliente en POS */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Cliente en el punto de venta</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">¿Cuándo se requiere seleccionar cliente?</label>
                  <select value={bizClienteObligatorio} disabled={!canEdit}
                    onChange={e => setBizClienteObligatorio(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="nunca">Nunca (siempre opcional)</option>
                    <option value="reservas">Solo en reservas</option>
                    <option value="siempre">Siempre obligatorio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Datos requeridos al crear un cliente
                    {' '}<InfoTip text="Aplica al alta rápida de cliente desde el POS. El nombre es siempre obligatorio; marcá qué otros datos no pueden faltar." />
                  </label>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                    <label className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                      <input type="checkbox" checked disabled className="w-4 h-4 accent-accent opacity-60" />
                      Nombre (siempre)
                    </label>
                    {([['dni', 'DNI'], ['telefono', 'Teléfono'], ['email', 'Email']] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                        <input type="checkbox" disabled={!canEdit} checked={bizClienteCampos[key]}
                          onChange={e => setBizClienteCampos(p => ({ ...p, [key]: e.target.checked }))}
                          className="w-4 h-4 accent-accent" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Permitir "Consumidor Final"</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Habilita vender sin identificar al cliente (genérico).</p>
                  </div>
                  <Toggle size="lg" disabled={!canEdit} checked={bizClienteConsumidorFinal}
                    onChange={setBizClienteConsumidorFinal}
                    aria-label='Permitir "Consumidor Final"' />
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Crear cliente inline desde el POS</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Permite agregar un cliente nuevo directamente desde la pantalla de venta.</p>
                  </div>
                  <Toggle size="lg" disabled={!canEdit} checked={bizClienteCreacionInline}
                    onChange={setBizClienteCreacionInline}
                    aria-label="Crear cliente inline desde el POS" />
                </div>
              </div>

              {/* Un solo botón guarda toda la configuración operativa de Ventas */}
              {canEdit && (
                <div className="flex justify-end pt-1">
                  <button onClick={handleSaveBiz} disabled={savingBiz}
                    className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                    {savingBiz ? 'Guardando...' : 'Guardar configuración de Ventas'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Descuentos sub-tab — descuento máx cajero/supervisor */}
          {tab === 'ventas' && ventasSubTab === 'descuentos' && (
            <div className="space-y-4">
              <Link to="/comercial"
                className="flex items-center gap-2 bg-accent/5 hover:bg-accent/10 border border-accent-text/20 rounded-xl px-4 py-3 text-sm text-accent-text font-medium transition-colors">
                <Gift size={16} /> Combos y Cupones se movieron al módulo Comercial →
              </Link>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Límites de descuento por rol</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Solo <span className="font-medium">DUEÑO, SUPERVISOR y ADMIN</span> pueden aplicar descuentos en una venta.
                  El resto de los roles (CAJERO, DEPÓSITO, etc.) los tiene bloqueados. El DUEÑO/ADMIN no tienen tope;
                  el SUPERVISOR está limitado al porcentaje de abajo (vacío = sin límite).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                    🔒 CAJERO y demás roles operativos no pueden aplicar descuentos. Si necesitan uno, lo autoriza un DUEÑO/SUPERVISOR/ADMIN.
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descuento máximo — SUPERVISOR (%)</label>
                    <div className="flex items-center gap-2">
                      <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.5"
                        value={bizDescuentoMaxSupervisor} disabled={!canEdit}
                        onChange={e => setBizDescuentoMaxSupervisor(e.target.value)}
                        placeholder="Sin límite"
                        className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
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
          <PageTabs
            tabs={[
              { id: 'integraciones', label: 'Integraciones', icon: Plug },
              // API pública del marketplace: solo en modo avanzado
              ...(modoAvanzado ? [{ id: 'api', label: 'API', icon: Key }] : []),
            ]}
            active={conSubTab}
            onChange={(id) => setConSubTab(id as ConSubTab)}
          />

          {conSubTab === 'integraciones' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Plug size={18} className="text-accent-text" />
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
                              onClick={async () => { if (await confirmar(`¿Desconectar TiendaNube de ${suc.nombre}?`, { danger: true })) desconectarTN.mutate(cred.id) }}
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
                              className="p-1.5 text-gray-400 hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors">
                              <Plug size={14} />
                            </a>
                          )}
                          <button
                            onClick={async () => { if (await confirmar(`¿Desconectar MercadoPago de ${suc.nombre}?`, { danger: true })) desconectarMP.mutate(cred.id) }}
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
                        <button onClick={async () => { if (await confirmar(`¿Desconectar MercadoLibre de ${suc.nombre}?`, { danger: true })) desconectarMELI.mutate(cred.id) }}
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
                  <Layers size={14} className="text-accent-text" />
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
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text">
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
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
                        <input type="text" value={meliMapForm.meliVariationId}
                          onChange={e => setMeliMapForm(p => p ? { ...p, meliVariationId: e.target.value } : p)}
                          placeholder="Variation ID (opcional)"
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
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
                        className="flex items-center gap-1.5 text-xs text-accent-text hover:underline">
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
                        <button onClick={async () => { if (await confirmar('¿Eliminar mapeo?', { danger: true })) deleteMeliMap.mutate(m.id) }}
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

          {/* D3 — Repricing automático por margen objetivo (mecanismo 1, config a nivel tenant).
              El interruptor por producto vive en la ficha (B6); acá solo el CÓMO se aplica. */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-accent-text" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Repricing automático por margen</h2>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Para los productos con "Reajuste automático por margen" activado en su ficha, define
              CÓMO se aplica el ajuste cuando el precio se desvía del margen objetivo. El ajuste es
              único — el mismo precio para Genesis360 y todos los canales conectados.
            </p>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Modo</label>
              <select value={(tenant as any)?.repricing_modo ?? 'alerta'}
                onChange={e => actualizarRepricingConfig({ repricing_modo: e.target.value })}
                className="w-full max-w-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200">
                <option value="alerta">Alerta — siempre pide mi aprobación</option>
                <option value="automatico">Automático — siempre aplica directo</option>
                <option value="automatico_desde_monto">Automático desde un monto — si no, pide aprobación</option>
              </select>
            </div>
            {(tenant as any)?.repricing_modo === 'automatico_desde_monto' && (
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Aplicar directo si la diferencia es mayor o igual a ($)</label>
                <input type="number" min="0" step="0.01" defaultValue={(tenant as any)?.repricing_automatico_desde_monto ?? ''}
                  onBlur={e => actualizarRepricingConfig({ repricing_automatico_desde_monto: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full max-w-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200" />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Tope de suba por ajuste (%, opcional)</label>
                <input type="number" min="0" step="0.1" defaultValue={(tenant as any)?.repricing_tope_pct ?? ''}
                  onBlur={e => actualizarRepricingConfig({ repricing_tope_pct: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="Sin tope"
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200" />
                <p className="text-[11px] text-gray-400 mt-1">El ajuste automático nunca mueve el precio más de este % de una sola vez.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Umbral de aviso ($, opcional)</label>
                <input type="number" min="0" step="0.01" defaultValue={(tenant as any)?.repricing_umbral_aviso_monto ?? ''}
                  onBlur={e => actualizarRepricingConfig({ repricing_umbral_aviso_monto: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="Siempre avisa"
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-200" />
                <p className="text-[11px] text-gray-400 mt-1">Solo notifica a Dueño/Supervisor si la diferencia alcanza este monto.</p>
              </div>
            </div>
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
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:border-accent-text hover:text-accent-text transition-colors">
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
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Key *</label>
                  <input type="password" value={modoForm.api_key}
                    onChange={e => setModoForm(f => ({ ...f, api_key: e.target.value }))}
                    placeholder="Tu API Key de MODO"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ambiente</label>
                <div className="flex gap-2">
                  {(['test', 'prod'] as const).map(a => (
                    <button key={a} onClick={() => setModoForm(f => ({ ...f, ambiente: a }))}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${modoForm.ambiente === a ? 'bg-accent border-accent-text text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-accent-text'}`}>
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
                  <Clock size={16} className="text-accent-text" /> Seguridad de Caja
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Contraseña maestra
                    {(tenant as any)?.clave_maestra
                      ? <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-normal">✓ Configurada</span>
                      : <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-normal">○ Sin configurar — acciones sensibles autorizadas solo por rol</span>}
                    {user?.rol !== 'DUEÑO' && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 font-normal">🔒 Solo DUEÑO puede modificarla</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showClaveMaestra ? 'text' : 'password'}
                      value={bizClaveMaestra}
                      onChange={e => setBizClaveMaestra(e.target.value)}
                      disabled={user?.rol !== 'DUEÑO'}
                      placeholder={(tenant as any)?.clave_maestra ? '••••••••' : 'Nueva contraseña maestra'}
                      className="w-full px-4 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700"
                    />
                    <button type="button" onClick={() => setShowClaveMaestra(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <Eye size={15} />
                    </button>
                  </div>
                  {/* Confirmación (anti-error): solo cuando se está ingresando una clave nueva */}
                  {user?.rol === 'DUEÑO' && bizClaveMaestra.length > 0 && (
                    <input
                      type={showClaveMaestra ? 'text' : 'password'}
                      value={bizClaveMaestraConfirm}
                      onChange={e => setBizClaveMaestraConfirm(e.target.value)}
                      placeholder="Repetí la clave maestra"
                      className={`w-full mt-2 px-4 py-2.5 border rounded-xl text-sm focus:outline-none dark:bg-gray-700
                        ${bizClaveMaestraConfirm.length === 0
                          ? 'border-gray-200 dark:border-gray-700 focus:border-accent-text'
                          : bizClaveMaestra.trim() === bizClaveMaestraConfirm.trim()
                            ? 'border-green-400 focus:border-green-500'
                            : 'border-red-400 focus:border-red-500'}`}
                    />
                  )}
                  {bizClaveMaestra.length > 0 && bizClaveMaestra.trim().length < 6 && (
                    <p className="text-xs text-red-500 mt-1">Mínimo 6 caracteres.</p>
                  )}
                  {bizClaveMaestra.length > 0 && bizClaveMaestraConfirm.length > 0 && bizClaveMaestra.trim() !== bizClaveMaestraConfirm.trim() && (
                    <p className="text-xs text-red-500 mt-1">Las claves no coinciden.</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Requerida para: cerrar caja ajena · abrir con diferencia · anular ventas o movimientos · dar de baja deuda incobrable. Si está vacía, ninguna acción la requiere. Se guarda <strong>encriptada</strong> (no en texto plano).
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
                  <ShieldCheck size={16} className="text-accent-text" /> Permisos avanzados
                </h2>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizDobleVal} disabled={!canEdit}
                      onChange={e => setBizDobleVal(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Doble validación al cerrar caja</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Un 2do usuario (DUEÑO/SUPERVISOR/ADMIN) debe confirmar el cierre con sus credenciales (B7).</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizSupervisorEdita} disabled={!canEdit}
                      onChange={e => setBizSupervisorEdita(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">SUPERVISOR puede corregir movimientos manuales</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Permite al SUPERVISOR usar el botón "Corregir" en ingresos manuales (G1).</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizSupervisorBoveda} disabled={!canEdit}
                      onChange={e => setBizSupervisorBoveda(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
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
                  <Wallet size={16} className="text-accent-text" /> Bóveda
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto máximo en caja ($)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="100"
                    value={bizBovedaUmbral} disabled={!canEdit}
                    onChange={e => setBizBovedaUmbral(e.target.value)}
                    placeholder="Sin límite"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Cuando el saldo en caja supera este monto, el sistema alerta para transferir el excedente a la bóveda. Dejá vacío para no poner umbral.
                  </p>
                </div>
              </div>

              {/* Diferencias de cierre (B1/B2/B3) */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <AlertCircle size={16} className="text-accent-text" /> Diferencias en cierre de caja
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Umbral mínimo para alertar ($)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="100"
                    value={bizDifUmbral} disabled={!canEdit}
                    onChange={e => setBizDifUmbral(e.target.value)}
                    placeholder="Alertar con cualquier diferencia"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
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
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${activo ? 'bg-accent text-white border-accent-text' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
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
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${activo ? 'bg-accent text-white border-accent-text' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
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
                    <CreditCard size={16} className="text-accent-text" /> Cuentas de Origen
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
                              className="flex-1 min-w-0 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                            <select value={editCuentaData.tipo}
                              onChange={e => setEditCuentaData(p => ({ ...p, tipo: e.target.value }))}
                              className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white shrink-0">
                              <option value="banco">Banco</option>
                              <option value="billetera">Billetera</option>
                              <option value="efectivo">Efectivo</option>
                              <option value="otro">Otro</option>
                            </select>
                            <input type="text" value={editCuentaData.banco}
                              onChange={e => setEditCuentaData(p => ({ ...p, banco: e.target.value }))}
                              placeholder="Banco / Entidad"
                              className="w-32 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                            <select value={editCuentaData.moneda}
                              onChange={e => setEditCuentaData(p => ({ ...p, moneda: e.target.value }))}
                              className="w-20 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white shrink-0">
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
                              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button onClick={async () => { if (await confirmar('¿Eliminar esta cuenta? Si tiene movimientos vinculados, mejor desactivarla.', { danger: true })) deleteCuentaOrigen.mutate(c.id) }}
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
                        className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                      <select value={nuevaCuenta.tipo}
                        onChange={e => setNuevaCuenta(p => ({ ...p, tipo: e.target.value }))}
                        className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white">
                        <option value="banco">Banco</option>
                        <option value="billetera">Billetera</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="otro">Otro</option>
                      </select>
                      <input type="text" value={nuevaCuenta.banco}
                        onChange={e => setNuevaCuenta(p => ({ ...p, banco: e.target.value }))}
                        placeholder="Banco / Entidad"
                        className="w-44 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white" />
                      <select value={nuevaCuenta.moneda || (tenant as any)?.moneda || 'ARS'}
                        onChange={e => setNuevaCuenta(p => ({ ...p, moneda: e.target.value }))}
                        className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white">
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
              <PlaceholderTab icon={Clock} title="Más configuraciones de Caja" desc="Tolerancia de diferencia en arqueo y panel cajero — próximamente." />
            </div>
          )}
          {tab === 'clientes' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Wallet size={16} className="text-accent-text" /> Cuenta corriente — políticas
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Al superar el límite de CC</label>
                    <select value={bizCCEnforcement} disabled={!canEdit}
                      onChange={e => setBizCCEnforcement(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                      <option value="permitir">Permitir igual</option>
                      <option value="avisar">Avisar pero permitir</option>
                      <option value="bloquear">Bloquear la venta a CC</option>
                    </select>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Qué hacer cuando una venta a cuenta corriente deja al cliente por encima de su límite.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cliente con deuda vencida</label>
                    <select value={bizCCMorosidad} disabled={!canEdit}
                      onChange={e => setBizCCMorosidad(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                      <option value="permitir">Permitir vender igual</option>
                      <option value="bloqueo_cc">Bloquear solo la parte a CC (puede pagar por otro medio)</option>
                      <option value="bloqueo_total">Bloquear cualquier venta</option>
                    </select>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Qué hacer cuando el cliente ya tiene deuda vencida (fecha de vencimiento CC pasada).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Límite de CC por defecto ($)</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="1000"
                      value={bizCCLimiteDefault} disabled={!canEdit}
                      onChange={e => setBizCCLimiteDefault(e.target.value)}
                      placeholder="Sin límite"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Se usa para los clientes que no tienen un límite propio cargado en su ficha.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vencimiento de venta a CC (días)</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="1"
                      value={bizCCDiasVenc} disabled={!canEdit}
                      onChange={e => setBizCCDiasVenc(e.target.value)}
                      placeholder="Sin vencimiento"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Días desde la venta hasta que se considera vencida. Vacío = nunca vencen.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Interés mensual por mora (%)</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.5"
                      value={bizCCInteresMensual} disabled={!canEdit}
                      onChange={e => setBizCCInteresMensual(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Se calcula sobre el saldo vencido, proporcional a los días de atraso. 0 = sin interés.</p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar configuración de Clientes'}
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 px-1">
                Segmentación y límite de crédito por cliente se manejan desde la ficha de cada cliente en <strong>Clientes</strong>. Los avisos de deuda/pago y saludo de cumpleaños se configuran en <strong>Notificaciones</strong>.
              </p>
            </div>
          )}
          {tab === 'rrhh' && (
            <div className="space-y-4">
              {/* Asistencia / Tardanzas — afecta la liquidación de sueldos */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <div>
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300">Asistencia y tardanzas</h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Cómo se tratan las llegadas tarde al liquidar la nómina (usa las fichadas de entrada vs el horario del empleado).</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tratamiento de la tardanza</label>
                    <select value={bizRrhhTardanzaModo} disabled={!canEdit}
                      onChange={e => setBizRrhhTardanzaModo(e.target.value as any)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                      <option value="registrar">Solo registrar (no descuenta del sueldo)</option>
                      <option value="proporcional">Descontar proporcional (todos los minutos tarde)</option>
                      <option value="umbral">Descontar pasada la tolerancia (solo lo que excede)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tolerancia (min)</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="1"
                      value={bizRrhhTardanzaTol} disabled={!canEdit || bizRrhhTardanzaModo !== 'umbral'}
                      onChange={e => setBizRrhhTardanzaTol(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700 disabled:opacity-60" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Minutos que no se descuentan. Solo aplica al modo "pasada la tolerancia".</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Horas/mes base</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="1" step="1"
                      value={bizRrhhHorasMesBase} disabled={!canEdit}
                      onChange={e => setBizRrhhHorasMesBase(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Divisor para calcular el valor hora a partir del sueldo bruto (default 200).</p>
                  </div>
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={bizRrhhHorasExtraAprob} disabled={!canEdit}
                    onChange={e => setBizRrhhHorasExtraAprob(e.target.checked)}
                    className="w-4 h-4 rounded accent-accent" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Las horas extra requieren aprobación antes de liquidarse</span>
                </label>
              </div>

              {/* Nómina */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Nómina</h2>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={bizRrhhNominaSupAprueba} disabled={!canEdit}
                    onChange={e => setBizRrhhNominaSupAprueba(e.target.checked)}
                    className="w-4 h-4 rounded accent-accent" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">El SUPERVISOR puede aprobar la nómina (cuenta como 2ª validación)</span>
                </label>
                <p className="text-xs text-gray-400 dark:text-gray-500">Aplica solo si la doble validación de nómina está activada (se configura en RRHH → Nómina).</p>
              </div>

              {/* Documentos */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Documentos del personal</h2>
                <div className="sm:max-w-xs">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Avisar vencimientos con (días) de anticipación</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" step="1"
                    value={bizRrhhDocAlertaDias} disabled={!canEdit}
                    onChange={e => setBizRrhhDocAlertaDias(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Cuántos días antes del vencimiento se muestra el documento como "por vencer" (default 30).</p>
                </div>
              </div>

              {canEdit && (
                <div className="flex justify-end">
                  <button onClick={handleSaveBiz} disabled={savingBiz}
                    className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                    {savingBiz ? 'Guardando...' : 'Guardar configuración de RRHH'}
                  </button>
                </div>
              )}

              <p className="text-xs text-gray-400 dark:text-gray-500 px-1">
                Las políticas de vacaciones, portal del empleado y notificaciones se configuran en su sección dentro de <strong>RRHH</strong>.
              </p>
            </div>
          )}
          {tab === 'alertas' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <AlertCircle size={16} className="text-accent-text" /> Márgenes y devoluciones
                </h2>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={bizAlertaMargenNeg} disabled={!canEdit}
                    onChange={e => setBizAlertaMargenNeg(e.target.checked)}
                    className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Alertar venta con margen negativo</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Genera una alerta cuando una venta despachada se vendió por debajo del costo.</p>
                  </div>
                </label>
                <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Alertar devoluciones repetidas — cantidad</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="1" step="1"
                      value={bizAlertaDevN} disabled={!canEdit}
                      onChange={e => setBizAlertaDevN(e.target.value)}
                      placeholder="Sin alertar"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Devoluciones del mismo cliente/producto que disparan la alerta. Vacío = desactivado.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">...en los últimos (días)</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="1" step="1"
                      value={bizAlertaDevDias} disabled={!canEdit}
                      onChange={e => setBizAlertaDevDias(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  </div>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar configuración de Alertas'}
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 px-1">
                El resto de las alertas (reservas vencidas, OC por vencer, stock sin categoría, deuda de clientes, umbral de bóveda, vencimiento de lote, pedidos atrasados) se generan con reglas fijas del sistema — el umbral de bóveda se define en <strong>Caja</strong>.
              </p>
            </div>
          )}
          {tab === 'notificaciones' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Wallet size={16} className="text-accent-text" /> Cuenta corriente
                </h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Canales</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={bizCCNotifCanales.includes('email')} disabled={!canEdit}
                        onChange={e => setBizCCNotifCanales(cs => e.target.checked ? [...cs, 'email'] : cs.filter(c => c !== 'email'))}
                        className="rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                      Email
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={bizCCNotifCanales.includes('whatsapp')} disabled={!canEdit}
                        onChange={e => setBizCCNotifCanales(cs => e.target.checked ? [...cs, 'whatsapp'] : cs.filter(c => c !== 'whatsapp'))}
                        className="rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                      WhatsApp
                    </label>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">WhatsApp es siempre a demanda (botón manual). Email se envía solo si está marcado.</p>
                </div>
                <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizCCNotifRegistroDeuda} disabled={!canEdit}
                      onChange={e => setBizCCNotifRegistroDeuda(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Avisar al registrar una compra a cuenta corriente</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Le llega un email al cliente confirmando el monto que quedó a su cuenta.</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bizCCNotifPago} disabled={!canEdit}
                      onChange={e => setBizCCNotifPago(e.target.checked)}
                      className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Avisar al recibir un pago de cuenta corriente</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Le llega un email al cliente confirmando el pago recibido.</p>
                    </div>
                  </label>
                </div>
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aviso de pre-vencimiento (días antes)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="1"
                    value={bizCCPreVencDias} disabled={!canEdit}
                    onChange={e => setBizCCPreVencDias(e.target.value)}
                    placeholder="Sin recordatorio"
                    className="sm:max-w-xs w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Cuántos días antes del vencimiento se resalta la deuda como "por vencer" en el tab de Cuenta Corriente del cliente.</p>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Gift size={16} className="text-accent-text" /> Cumpleaños de clientes
                </h2>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={bizCumpleCliente} disabled={!canEdit}
                    onChange={e => setBizCumpleCliente(e.target.checked)}
                    className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Habilitar saludo por WhatsApp al cliente</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Muestra el botón de saludo manual por WhatsApp en la lista de clientes que cumplen años hoy.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={bizCumpleDuenio} disabled={!canEdit}
                    onChange={e => setBizCumpleDuenio(e.target.checked)}
                    className="mt-1 rounded border-gray-300 text-accent-text focus:ring-accent-text disabled:opacity-50" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Mostrarme la lista de cumpleaños del día</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Aparece arriba de la lista de clientes cuando alguien cumple años hoy.</p>
                  </div>
                </label>
                {canEdit && (
                  <div className="flex justify-end pt-1">
                    <button onClick={handleSaveBiz} disabled={savingBiz}
                      className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm">
                      {savingBiz ? 'Guardando...' : 'Guardar configuración de Notificaciones'}
                    </button>
                  </div>
                )}
              </div>
            </div>
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
        <Key size={18} className="text-accent-text" />
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
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700 dark:text-white"
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
                    <td className="px-3 py-2"><code className="text-accent-text font-mono">{row.e}</code></td>
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
