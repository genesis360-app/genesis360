import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Search, Package, AlertTriangle, Camera, ChevronDown, ChevronRight,
  Edit2, Layers, X, Star, Trash2, ChevronUp, Ruler, ShoppingCart,
  CheckSquare, Square, Tag, RotateCcw, Clock, Settings2, Check, Zap, Download,
  DollarSign, Percent, Truck, ToggleRight, Boxes, Loader2, CheckCircle, Upload,
} from 'lucide-react'
import { ActionMenu } from '@/components/ActionMenu'
import { PageTabs } from '@/components/PageTabs'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { puedeVerCosto } from '@/lib/permisosCosto'
import { Toggle } from '@/components/Toggle'
import toast from 'react-hot-toast'
import { useCotizacion } from '@/hooks/useCotizacion'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { PlanProgressBar } from '@/components/PlanProgressBar'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import type { ProductoEstructura } from '@/lib/supabase'
import {
  validarNiveles, nivelesAPayload, calcularUnidadesBase, cadenaConversion, nombreUdm,
  type NivelForm,
} from '@/lib/estructuras'
import ProductoGrupoModal, { type ProductoGrupo } from '@/components/ProductoGrupoModal'

type Tab = 'productos' | 'estructura'

// ─── Helpers / tipos del formulario de estructura (niveles dinámicos, mig 282) ──

type UdmOption = { id: string; nombre: string; simbolo: string | null }

type EstrForm = {
  nombre: string
  niveles: NivelForm[]
}

const nivelFormVacio = (udmId = ''): NivelForm =>
  ({ unidad_medida_id: udmId, factor: '', peso: '', alto: '', ancho: '', largo: '' })

function formDesdeEstructura(e: ProductoEstructura): EstrForm {
  const niveles = nivelesOrdenados(e).map(n => ({
    unidad_medida_id: n.unidad_medida_id,
    factor: String(n.factor),
    peso:  n.peso_kg  != null ? String(n.peso_kg)  : '',
    alto:  n.alto_cm  != null ? String(n.alto_cm)  : '',
    ancho: n.ancho_cm != null ? String(n.ancho_cm) : '',
    largo: n.largo_cm != null ? String(n.largo_cm) : '',
  }))
  return { nombre: e.nombre, niveles: niveles.length ? niveles : [nivelFormVacio()] }
}

function nivelesOrdenados(e: ProductoEstructura) {
  return [...(e.producto_estructura_niveles ?? [])].sort((a, b) => a.orden - b.orden)
}

function validarForm(f: EstrForm): string | null {
  if (!f.nombre.trim()) return 'El nombre es obligatorio.'
  return validarNiveles(f.niveles)
}

// ─── Modal de formulario (niveles dinámicos por UdM) ─────────────────────────

function EstrModal({
  editando,
  unidades,
  baseUdmNombre,
  onClose,
  onSave,
  saving,
}: {
  editando: ProductoEstructura | null
  unidades: UdmOption[]
  /** productos.unidad_medida del SKU — preselecciona la UdM base al crear */
  baseUdmNombre?: string | null
  onClose: () => void
  onSave: (form: EstrForm) => void
  saving: boolean
}) {
  const [form, setForm] = useState<EstrForm>(() => {
    if (editando) return formDesdeEstructura(editando)
    const base =
      unidades.find(u => u.nombre.toLowerCase() === (baseUdmNombre ?? '').toLowerCase()) ??
      unidades.find(u => u.nombre === 'Unidad') ?? unidades[0]
    return { nombre: '', niveles: [nivelFormVacio(base?.id)] }
  })
  const [error, setError] = useState<string | null>(null)

  const inp = 'w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text'

  const udmNombreDe = (id: string) => unidades.find(u => u.id === id)?.nombre ?? '—'
  const usadas = new Set(form.niveles.map(n => n.unidad_medida_id))
  // Equivalencia acumulada en vivo (null si algún factor todavía es inválido)
  const equivalencias = calcularUnidadesBase(form.niveles.map((n, i) => (i === 0 ? 1 : Number(n.factor))))

  const updNivel = (i: number, v: Partial<NivelForm>) =>
    setForm(f => ({ ...f, niveles: f.niveles.map((n, j) => (j === i ? { ...n, ...v } : n)) }))

  const agregarNivel = () => {
    // Preselecciona la siguiente UdM "natural" que no esté usada (Caja → Pallet → primera libre)
    const sugerida =
      unidades.find(u => u.nombre === 'Caja' && !usadas.has(u.id)) ??
      unidades.find(u => u.nombre === 'Pallet' && !usadas.has(u.id)) ??
      unidades.find(u => !usadas.has(u.id))
    setForm(f => ({ ...f, niveles: [...f.niveles, nivelFormVacio(sugerida?.id)] }))
  }

  const quitarNivel = (i: number) =>
    setForm(f => ({ ...f, niveles: f.niveles.filter((_, j) => j !== i) }))

  const moverNivel = (i: number, dir: -1 | 1) =>
    setForm(f => {
      const niveles = [...f.niveles]
      const j = i + dir
      if (j < 0 || j >= niveles.length) return f
      ;[niveles[i], niveles[j]] = [niveles[j], niveles[i]]
      return { ...f, niveles }
    })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validarForm(form)
    if (err) { setError(err); return }
    setError(null)
    onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-bold text-primary">
            {editando ? 'Editar estructura' : 'Nueva estructura'}
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input type="text" value={form.nombre}
              onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              className={inp} placeholder='Ej: "Footprint estándar", "Pack mayorista"' />
          </div>

          {/* Niveles dinámicos */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Niveles <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">(el primero es la unidad base)</span>
              </p>
              <button type="button" onClick={agregarNivel}
                disabled={usadas.size >= unidades.length}
                className="flex items-center gap-1 text-xs font-semibold text-accent-text hover:underline disabled:opacity-40 disabled:no-underline">
                <Plus size={13} /> Agregar nivel
              </button>
            </div>

            {form.niveles.map((n, i) => (
              <div key={i} className="rounded-xl border-2 border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-12 flex-shrink-0">
                    {i === 0 ? 'BASE' : `Nivel ${i + 1}`}
                  </span>
                  <select value={n.unidad_medida_id}
                    onChange={e => updNivel(i, { unidad_medida_id: e.target.value })}
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                    <option value="">Unidad de medida…</option>
                    {unidades.map(u => (
                      <option key={u.id} value={u.id}
                        disabled={u.id !== n.unidad_medida_id && usadas.has(u.id)}>
                        {u.nombre}{u.simbolo ? ` (${u.simbolo})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button type="button" onClick={() => moverNivel(i, -1)} disabled={i === 0}
                      className="p-1 text-gray-400 hover:text-accent-text disabled:opacity-30 transition-colors" title="Subir">
                      <ChevronUp size={15} />
                    </button>
                    <button type="button" onClick={() => moverNivel(i, 1)} disabled={i === form.niveles.length - 1}
                      className="p-1 text-gray-400 hover:text-accent-text disabled:opacity-30 transition-colors" title="Bajar">
                      <ChevronDown size={15} />
                    </button>
                    <button type="button" onClick={() => quitarNivel(i)} disabled={form.niveles.length === 1}
                      className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30 transition-colors" title="Quitar nivel">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {i > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Contiene</span>
                    <input type="number" step="1" min="1" value={n.factor}
                      onChange={e => updNivel(i, { factor: e.target.value })}
                      onWheel={e => e.currentTarget.blur()}
                      className="w-20 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text"
                      placeholder="12" />
                    <span className="text-gray-500 dark:text-gray-400">
                      × {udmNombreDe(form.niveles[i - 1].unidad_medida_id)}
                    </span>
                    {equivalencias && i > 1 && (
                      <span className="text-xs text-accent-text font-medium ml-auto">
                        = {equivalencias[i]} × {udmNombreDe(form.niveles[0].unidad_medida_id)}
                      </span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {([['peso', 'Peso (kg)', '0.001'], ['alto', 'Alto (cm)', '0.01'],
                     ['ancho', 'Ancho (cm)', '0.01'], ['largo', 'Largo (cm)', '0.01']] as const).map(([campo, label, step]) => (
                    <div key={campo}>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                      <input type="number" step={step} min="0" value={n[campo]}
                        onChange={e => updNivel(i, { [campo]: e.target.value })}
                        onWheel={e => e.currentTarget.blur()}
                        className={inp} placeholder="—" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-2.5 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold rounded-xl py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl py-2.5 text-sm transition-all disabled:opacity-50">
              {saving ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear estructura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Tarjeta de estructura ────────────────────────────────────────────────────

function EstrCard({
  e,
  onEdit,
  onDelete,
  onSetDefault,
  solo,
}: {
  e: ProductoEstructura
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
  solo: boolean
}) {
  const niveles = nivelesOrdenados(e)

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border-2 transition-colors
      ${e.is_default ? 'border-accent-text/40' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{e.nombre}</p>
            {e.is_default && (
              <span className="inline-flex items-center gap-1 text-xs bg-accent/10 text-accent-text px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                <Star size={10} fill="currentColor" /> Default
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {cadenaConversion(niveles)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!e.is_default && !solo && (
            <button onClick={onSetDefault} title="Marcar como default"
              className="p-1.5 text-gray-400 hover:text-accent-text transition-colors">
              <Star size={15} />
            </button>
          )}
          <button onClick={onEdit} title="Editar"
            className="p-1.5 text-gray-400 hover:text-accent-text transition-colors">
            <Edit2 size={15} />
          </button>
          {!solo && (
            <button onClick={onDelete} title="Eliminar"
              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Detalle de niveles */}
      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {niveles.map(n => (
          <div key={n.id}>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
              {nombreUdm(n)}{n.orden === 1 && <span className="normal-case text-gray-400 dark:text-gray-500"> · base</span>}
            </p>
            <div className="space-y-0.5 text-xs text-gray-700 dark:text-gray-300">
              {n.orden > 1 && <p>{n.factor} × nivel anterior · = {n.unidades_base} × base</p>}
              {n.peso_kg != null && <p>Peso: {n.peso_kg} kg</p>}
              {n.alto_cm != null && <p>{n.alto_cm}×{n.ancho_cm ?? '—'}×{n.largo_cm ?? '—'} cm</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

type TicketScanItem = {
  _key: string
  barcode: string | null
  nombre_scan: string
  precio_unitario: number
  match: { id: string; nombre: string; sku: string; precio_costo: number } | null
  accion: 'none' | 'actualizar_precio' | 'crear' | 'skip'
  nombre_editable: string
  precio_costo_editable: string
  precio_venta_nuevo: string
}

export default function ProductosPage() {
  const { tenant, user } = useAuthStore()
  const { avanzado: modoAvanzado } = useModoOperacion()
  const verCosto = puedeVerCosto(user?.rol)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { limits } = usePlanLimits()
  const { cotizacion } = useCotizacion()
  const { applyFilter, sucursalId } = useSucursalFilter()

  const [tab, setTab] = useState<Tab>('productos')

  // Tab Productos
  const [search, setSearch] = useState('')
  const [filterAlerta, setFilterAlerta] = useState(false)
  const [showInactivos, setShowInactivos] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat')

  // Grupos
  const [gruposPanel, setGruposPanel] = useState(false)
  const [grupoModal, setGrupoModal] = useState<{ open: boolean; grupo: ProductoGrupo | null }>({ open: false, grupo: null })
  const [expandedGrupos, setExpandedGrupos] = useState<Set<string>>(new Set())
  const [grupoEliminarConfirm, setGrupoEliminarConfirm] = useState<ProductoGrupo | null>(null)

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  type BulkAction = 'categoria' | 'regla' | 'aging' | 'atributos' | 'activar' | 'desactivar' | 'eliminar' | 'precio_venta' | 'proveedor' | null
  const [bulkModal, setBulkModal] = useState<BulkAction>(null)
  const [bulkValue, setBulkValue] = useState('')
  const [bulkAtributos, setBulkAtributos] = useState({ tiene_series: false, tiene_lote: false, tiene_vencimiento: false })
  const [bulkPrecioTipo, setBulkPrecioTipo] = useState<'pct' | 'fijo'>('pct')
  const [bulkPrecioValor, setBulkPrecioValor] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // OC rápida
  const [ocModal, setOcModal] = useState<{ productoId: string; nombre: string; sku: string; proveedorId: string } | null>(null)
  const [ocProveedor, setOcProveedor] = useState('')
  const [ocCantidad, setOcCantidad] = useState('1')
  const [ocPrecio, setOcPrecio] = useState('')

  // Tab Estructura
  const [estrSearch, setEstrSearch] = useState('')
  const [estrProductoId, setEstrProductoId] = useState<string | null>(null)
  const [estrProductoNombre, setEstrProductoNombre] = useState('')
  const [estrDropdown, setEstrDropdown] = useState(false)
  const [estrModal, setEstrModal] = useState<{ open: boolean; editando: ProductoEstructura | null }>({ open: false, editando: null })
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Scan ticket
  const [showScanTicket, setShowScanTicket] = useState(false)
  const [scanTicketStep, setScanTicketStep] = useState<'upload' | 'scanning' | 'results'>('upload')
  const [scanTicketItems, setScanTicketItems] = useState<TicketScanItem[]>([])
  const [scanTicketPreview, setScanTicketPreview] = useState<string | null>(null)
  const [applyingScan, setApplyingScan] = useState(false)
  const scanTicketRef = useRef<HTMLInputElement>(null)

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setEstrDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // En modo básico la pestaña Estructura (jerarquía de empaque unidad/caja/pallet =
  // WMS) no existe; resetear si se llega por deep-link o al cambiar de modo.
  useEffect(() => {
    if (!modoAvanzado && tab === 'estructura') setTab('productos')
  }, [modoAvanzado, tab])

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: productos = [], isLoading } = useQuery({
    queryKey: ['productos', tenant?.id, search],
    queryFn: async () => {
      let q = supabase
        .from('productos')
        .select('*, categorias(nombre), proveedores(nombre), estados_inventario(nombre), ubicaciones(nombre)')
        .eq('tenant_id', tenant!.id)
        .order('nombre')
      if (search) q = q.or(`nombre.ilike.%${search}%,sku.ilike.%${search}%,codigo_barras.eq.${search}`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Stock disponible para venta (solo líneas en estados con es_disponible_venta = true).
  // En básico el stock no tiene estado (estado_id NULL) → NO filtrar por estado o el
  // "disponible" saldría 0 para todos los productos. Ver [[reference_basico_stock_null_ubicacion_estado]].
  const { data: stockDisponibleMap = {} } = useQuery({
    queryKey: ['stock-disponible-map', tenant?.id, sucursalId, modoAvanzado],
    queryFn: async () => {
      let evIds: string[] = []
      if (modoAvanzado) {
        const { data: evData } = await supabase
          .from('estados_inventario').select('id')
          .eq('tenant_id', tenant!.id).eq('es_disponible_venta', true)
        evIds = (evData ?? []).map((e: any) => e.id)
        if (evIds.length === 0) return {}   // avanzado sin estados vendibles = nada disponible
      }
      let q = supabase
        .from('inventario_lineas')
        .select('producto_id, cantidad, cantidad_reservada, inventario_series(id, activo)')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      if (evIds.length > 0) q = q.in('estado_id', evIds)
      const { data: lineas } = await applyFilter(q)
      const map: Record<string, number> = {}
      for (const l of lineas ?? []) {
        const pid = (l as any).producto_id
        if (!map[pid]) map[pid] = 0
        const tieneSeries = ((l as any).inventario_series ?? []).length > 0
        if (tieneSeries) {
          map[pid] += ((l as any).inventario_series ?? []).filter((s: any) => s.activo).length
        } else {
          map[pid] += Math.max(0, (l as any).cantidad - ((l as any).cantidad_reservada ?? 0))
        }
      }
      return map
    },
    enabled: !!tenant,
  })

  const { data: estructuraDefault } = useQuery({
    queryKey: ['estructura-default', tenant?.id, expandedId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('producto_estructuras')
        .select('*, producto_estructura_niveles(*, unidades_medida(nombre, simbolo))')
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', expandedId!)
        .eq('is_default', true)
        .maybeSingle()
      if (error) throw error
      return data as ProductoEstructura | null
    },
    enabled: !!tenant && !!expandedId,
  })

  const { data: productosEstr = [] } = useQuery({
    queryKey: ['productos-estr-list', tenant?.id, estrSearch],
    queryFn: async () => {
      let q = supabase.from('productos')
        .select('id, nombre, sku, unidad_medida')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (estrSearch) q = q.ilike('nombre', `%${estrSearch}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && tab === 'estructura',
  })

  const { data: estructuras = [], isLoading: estrLoading } = useQuery({
    queryKey: ['producto-estructuras', tenant?.id, estrProductoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('producto_estructuras')
        .select('*, producto_estructura_niveles(*, unidades_medida(nombre, simbolo))')
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', estrProductoId!)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as ProductoEstructura[]
    },
    enabled: !!tenant && !!estrProductoId,
  })

  // UdM del tenant — niveles de estructura (predefinidas + personalizadas, mig 282)
  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidades_medida', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('unidades_medida')
        .select('id, nombre, simbolo')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return (data ?? []) as UdmOption[]
    },
    enabled: !!tenant && tab === 'estructura',
  })

  const { data: proveedoresOC = [] } = useQuery({
    queryKey: ['proveedores-oc', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && !!ocModal,
  })

  const { data: categoriasAll = [] } = useQuery({
    queryKey: ['categorias-bulk', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias').select('id, nombre').eq('tenant_id', tenant!.id).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && bulkModal === 'categoria',
  })

  const { data: agingProfilesAll = [] } = useQuery({
    queryKey: ['aging-profiles-bulk', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('aging_profiles').select('id, nombre').eq('tenant_id', tenant!.id).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && bulkModal === 'aging',
  })

  const { data: proveedoresAll = [] } = useQuery({
    queryKey: ['proveedores-bulk', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && bulkModal === 'proveedor',
  })

  const { data: productosGrupos = [] } = useQuery({
    queryKey: ['producto-grupos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('producto_grupos')
        .select('*, categorias(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      return (data ?? []) as ProductoGrupo[]
    },
    enabled: !!tenant,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['producto-estructuras', tenant?.id, estrProductoId] })
    if (expandedId) qc.invalidateQueries({ queryKey: ['estructura-default', tenant?.id, expandedId] })
  }

  const aplicarBulk = async () => {
    if (selectedIds.size === 0 || !bulkModal) return
    setBulkSaving(true)
    try {
      const ids = Array.from(selectedIds)
      const n = ids.length
      const s = n !== 1

      // Precio de venta — lógica especial
      if (bulkModal === 'precio_venta') {
        const valor = parseFloat(bulkPrecioValor)
        if (isNaN(valor)) { toast.error('Ingresá un valor válido'); return }
        if (bulkPrecioTipo === 'fijo') {
          if (valor <= 0) { toast.error('El precio debe ser mayor a 0'); return }
          const { error } = await supabase.from('productos').update({ precio_venta: valor }).in('id', ids)
          if (error) throw error
        } else {
          // % de ajuste: fetch → calculate → upsert
          const { data: prods, error: fetchErr } = await supabase.from('productos').select('id, precio_venta').in('id', ids)
          if (fetchErr) throw fetchErr
          const nuevos = (prods ?? []).map((p: any) => ({ id: p.id, precio_venta: Math.max(0.01, parseFloat((p.precio_venta * (1 + valor / 100)).toFixed(2))) }))
          if (nuevos.some((p: any) => p.precio_venta <= 0)) { toast.error('El ajuste dejaría algún precio en $0. Revisá el porcentaje.'); return }
          const { error } = await supabase.from('productos').upsert(nuevos, { onConflict: 'id' })
          if (error) throw error
        }
        toast.success(`Precio actualizado en ${n} producto${s ? 's' : ''}`)
        setSelectedIds(new Set()); setBulkModal(null); setBulkPrecioValor('')
        qc.invalidateQueries({ queryKey: ['productos', tenant?.id] })
        return
      }

      // Eliminar (hard delete real) — lógica especial, vía RPC con guard server-side
      if (bulkModal === 'eliminar') {
        const { data, error } = await supabase.rpc('eliminar_productos_fisico', { p_ids: ids })
        if (error) throw error
        const eliminados = (data ?? []).filter((r: any) => r.eliminado).length
        const bloqueados = n - eliminados
        if (eliminados > 0 && bloqueados > 0) {
          toast.success(`${eliminados} eliminado${eliminados !== 1 ? 's' : ''} · ${bloqueados} bloqueado${bloqueados !== 1 ? 's' : ''} por tener actividad registrada (ventas, movimientos, etc.)`, { duration: 7000 })
        } else if (eliminados > 0) {
          toast.success(`${eliminados} producto${eliminados !== 1 ? 's' : ''} eliminado${eliminados !== 1 ? 's' : ''}`)
        } else {
          toast.error('Ninguno se pudo eliminar: todos tienen actividad registrada (ventas, movimientos, compras, etc.). Usá "Desactivar" en su lugar.', { duration: 7000 })
        }
        setSelectedIds(new Set()); setBulkModal(null)
        qc.invalidateQueries({ queryKey: ['productos', tenant?.id] })
        return
      }

      let update: Record<string, unknown> = {}
      if (bulkModal === 'categoria')   update = { categoria_id: bulkValue || null }
      if (bulkModal === 'regla')       update = { regla_inventario: bulkValue || null }
      if (bulkModal === 'aging')       update = { aging_profile_id: bulkValue || null }
      if (bulkModal === 'atributos')   update = bulkAtributos
      if (bulkModal === 'activar')     update = { activo: true }
      if (bulkModal === 'desactivar')  update = { activo: false }
      if (bulkModal === 'proveedor')   update = { proveedor_id: bulkValue || null }
      const { error } = await supabase.from('productos').update(update).in('id', ids)
      if (error) throw error
      toast.success(`${n} producto${s ? 's' : ''} actualizado${s ? 's' : ''}`)
      setSelectedIds(new Set())
      setBulkModal(null)
      qc.invalidateQueries({ queryKey: ['productos', tenant?.id] })
    } catch (e: any) {
      toast.error('Error: ' + (e.message ?? 'No se pudo aplicar el cambio'))
    } finally {
      setBulkSaving(false)
    }
  }

  const agregarAOC = useMutation({
    mutationFn: async ({ productoId, proveedorId, cantidad, precio }: { productoId: string; proveedorId: string; cantidad: number; precio: number | null }) => {
      // Buscar OC borrador del mismo proveedor Y misma sucursal activa
      let ocQuery = supabase
        .from('ordenes_compra')
        .select('id, numero')
        .eq('tenant_id', tenant!.id)
        .eq('proveedor_id', proveedorId)
        .eq('estado', 'borrador')
        .order('created_at', { ascending: false })
        .limit(1)
      if (sucursalId) ocQuery = ocQuery.eq('sucursal_id', sucursalId)
      else ocQuery = ocQuery.is('sucursal_id', null)
      const { data: existingOC } = await ocQuery.maybeSingle()

      let ocId = existingOC?.id ?? null
      let ocNumero = existingOC?.numero ?? null

      if (!ocId) {
        const { data: newOC, error } = await supabase
          .from('ordenes_compra')
          .insert({ tenant_id: tenant!.id, proveedor_id: proveedorId, estado: 'borrador', sucursal_id: sucursalId || null, created_by: user!.id })
          .select('id, numero')
          .single()
        if (error) throw error
        ocId = newOC.id
        ocNumero = newOC.numero
      }

      const { error: itemError } = await supabase.from('orden_compra_items').insert({
        orden_compra_id: ocId,
        producto_id: productoId,
        cantidad,
        precio_unitario: precio,
      })
      if (itemError) throw itemError
      return ocNumero
    },
    onSuccess: (ocNumero) => {
      const prov = proveedoresOC.find((p: any) => p.id === ocProveedor)
      toast.success(`Agregado a OC #${ocNumero}${prov ? ` — ${prov.nombre}` : ''}`)
      setOcModal(null)
    },
    onError: () => toast.error('No se pudo agregar a la OC'),
  })

  const crearMut = useMutation({
    mutationFn: async (form: EstrForm) => {
      const esDefault = estructuras.length === 0
      // UUID en cliente: evita SELECT-after-INSERT bajo RLS
      const id = crypto.randomUUID()
      const { error } = await supabase.from('producto_estructuras').insert({
        id, tenant_id: tenant!.id, producto_id: estrProductoId!,
        nombre: form.nombre.trim(), is_default: esDefault,
      })
      if (error) throw error
      // Niveles vía RPC transaccional (valida y calcula unidades_base server-side)
      const { error: eNiveles } = await supabase.rpc('fn_estructura_guardar_niveles', {
        p_estructura_id: id, p_niveles: nivelesAPayload(form.niveles),
      })
      if (eNiveles) {
        // Sin niveles la estructura queda inservible: rollback best-effort del header
        await supabase.from('producto_estructuras').delete().eq('id', id)
        throw eNiveles
      }
    },
    onSuccess: () => { invalidar(); setEstrModal({ open: false, editando: null }) },
    onError: (e: Error) => toast.error(e.message || 'No se pudo crear la estructura'),
  })

  const editarMut = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: EstrForm }) => {
      // Primero los niveles (transaccional: si falla, los anteriores quedan intactos)
      const { error: eNiveles } = await supabase.rpc('fn_estructura_guardar_niveles', {
        p_estructura_id: id, p_niveles: nivelesAPayload(form.niveles),
      })
      if (eNiveles) throw eNiveles
      const { error } = await supabase.from('producto_estructuras')
        .update({ nombre: form.nombre.trim() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidar(); setEstrModal({ open: false, editando: null }) },
    onError: (e: Error) => toast.error(e.message || 'No se pudo guardar la estructura'),
  })

  const eliminarMut = useMutation({
    mutationFn: async (est: ProductoEstructura) => {
      const { error } = await supabase.from('producto_estructuras').delete().eq('id', est.id)
      if (error) throw error
      if (est.is_default) {
        const siguiente = estructuras.find(e => e.id !== est.id)
        if (siguiente) {
          await supabase.from('producto_estructuras').update({ is_default: true }).eq('id', siguiente.id)
        }
      }
    },
    onSuccess: invalidar,
  })

  // Eliminar grupo de variantes: soft-delete (activo=false, mismo patrón que Motivos/Estados).
  // NO borra ni desvincula los productos — quedan como productos sueltos (con su grupo_id
  // apuntando a un grupo inactivo), simplemente dejan de listarse agrupados acá.
  const eliminarGrupoMut = useMutation({
    mutationFn: async (grupoId: string) => {
      const { error } = await supabase.from('producto_grupos').update({ activo: false }).eq('id', grupoId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Grupo eliminado')
      qc.invalidateQueries({ queryKey: ['producto-grupos', tenant?.id] })
      setGrupoEliminarConfirm(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setDefaultMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('producto_estructuras')
        .update({ is_default: false })
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', estrProductoId!)
      const { error } = await supabase.from('producto_estructuras')
        .update({ is_default: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidar,
  })

  // ── Helpers UI ─────────────────────────────────────────────────────────────

  const filtered = productos.filter(p => {
    if (!showInactivos && !(p as any).activo) return false
    if (filterAlerta && (p as any).stock_actual > (p as any).stock_minimo) return false
    return true
  })
  const stockCritico = productos.filter(p => (p as any).stock_actual <= (p as any).stock_minimo).length

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)))
    }
  }

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < filtered.length

  // ── Scan ticket ─────────────────────────────────────────────────────────────

  const comprimirImagenScan = (file: File, maxWidth = 1200, quality = 0.82): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1])
      }
      img.onerror = reject
      img.src = url
    })

  const procesarTicketProductos = async (file: File) => {
    setScanTicketPreview(URL.createObjectURL(file))
    setScanTicketStep('scanning')
    try {
      const base64 = await comprimirImagenScan(file)
      const { data, error } = await supabase.functions.invoke('scan-ticket', {
        body: { image: base64, media_type: 'image/jpeg' },
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      const rawItems: Array<{ barcode: string | null; nombre: string; cantidad: number; precio_unitario: number }> = data?.items ?? []
      if (rawItems.length === 0) { toast.error('No se detectaron productos en el ticket'); setScanTicketStep('upload'); return }

      const matched = await Promise.all(rawItems.map(async (item) => {
        let prod: any = null
        if (item.barcode) {
          const { data: d } = await supabase.from('productos')
            .select('id, nombre, sku, precio_costo')
            .eq('tenant_id', tenant!.id).eq('activo', true).eq('sku', item.barcode).maybeSingle()
          prod = d
        }
        if (!prod) {
          const palabras = item.nombre.split(/\s+/).slice(0, 2).join(' ')
          const { data: d } = await supabase.from('productos')
            .select('id, nombre, sku, precio_costo')
            .eq('tenant_id', tenant!.id).eq('activo', true).ilike('nombre', `%${palabras}%`).limit(1).maybeSingle()
          prod = d
        }
        const precioDif = prod && Math.abs((prod.precio_costo ?? 0) - item.precio_unitario) > 0.5
        const accion: TicketScanItem['accion'] = !prod ? 'crear' : precioDif ? 'actualizar_precio' : 'none'
        return {
          _key: crypto.randomUUID(),
          barcode: item.barcode,
          nombre_scan: item.nombre,
          precio_unitario: item.precio_unitario,
          match: prod ? { id: prod.id, nombre: prod.nombre, sku: prod.sku, precio_costo: prod.precio_costo ?? 0 } : null,
          accion,
          nombre_editable: item.nombre,
          precio_costo_editable: String(item.precio_unitario),
          precio_venta_nuevo: '',
        } as TicketScanItem
      }))
      setScanTicketItems(matched)
      setScanTicketStep('results')
    } catch (e: any) {
      toast.error('Error al procesar el ticket: ' + (e.message ?? 'Error desconocido'))
      setScanTicketStep('upload')
    }
  }

  const aplicarCambiosScan = async () => {
    setApplyingScan(true)
    try {
      const aActualizar = scanTicketItems.filter(i => i.accion === 'actualizar_precio')
      const aCrear = scanTicketItems.filter(i => i.accion === 'crear')
      await Promise.all(aActualizar.map(i =>
        supabase.from('productos').update({ precio_costo: parseFloat(i.precio_costo_editable) || i.precio_unitario }).eq('id', i.match!.id)
      ))
      if (aCrear.length > 0) {
        const ts = Date.now().toString().slice(-5)
        const { error } = await supabase.from('productos').insert(aCrear.map((i, idx) => ({
          tenant_id: tenant!.id,
          nombre: i.nombre_editable,
          sku: i.barcode
            ? i.barcode.slice(0, 20)
            : i.nombre_editable.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) + '-' + ts + idx,
          precio_costo: parseFloat(i.precio_costo_editable) || 0,
          precio_venta: parseFloat(i.precio_venta_nuevo) || 0,
          stock_minimo: 0,
          unidad_medida: 'unidad',
          activo: true,
        })))
        if (error) throw new Error(error.message)
      }
      qc.invalidateQueries({ queryKey: ['productos', tenant?.id] })
      setShowScanTicket(false)
      setScanTicketItems([])
      setScanTicketStep('upload')
      setScanTicketPreview(null)
      const partes = []
      if (aActualizar.length) partes.push(`${aActualizar.length} precio${aActualizar.length !== 1 ? 's' : ''} actualizado${aActualizar.length !== 1 ? 's' : ''}`)
      if (aCrear.length) partes.push(`${aCrear.length} producto${aCrear.length !== 1 ? 's' : ''} creado${aCrear.length !== 1 ? 's' : ''}`)
      toast.success(partes.join(' · '))
    } catch (e: any) {
      toast.error(e.message ?? 'Error al aplicar cambios')
    } finally {
      setApplyingScan(false)
    }
  }

  const exportarProductos = (format: 'json' | 'csv') => {
    const rows = filtered.map(p => ({
      id: p.id, nombre: p.nombre, sku: p.sku,
      precio_venta: p.precio_venta, precio_costo: p.precio_costo,
      stock_actual: p.stock_actual, stock_minimo: p.stock_minimo,
      unidad_medida: p.unidad_medida, activo: p.activo,
      categoria: (p as any).categorias?.nombre ?? '',
    }))
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `productos_${new Date().toISOString().slice(0,10)}.json`; a.click()
    } else {
      const headers = Object.keys(rows[0] ?? {})
      const lines = rows.map(r => headers.map(h => {
        const v = String((r as any)[h] ?? '')
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v
      }).join(','))
      const csv = '﻿' + [headers.join(','), ...lines].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `productos_${new Date().toISOString().slice(0,10)}.csv`; a.click()
    }
  }

  function handleSaveModal(form: EstrForm) {
    if (estrModal.editando) {
      editarMut.mutate({ id: estrModal.editando.id, form })
    } else {
      crearMut.mutate(form)
    }
  }

  const saving = crearMut.isPending || editarMut.isPending

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {showLimitModal && limits && (
        <PlanLimitModal tipo="producto" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Package size={22} className="text-accent-text" /> Productos
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{productos.length} productos registrados</p>
        </div>
        <div className="flex gap-2">
          <ActionMenu
            items={[
              { label: 'Exportar JSON', icon: Download, onClick: () => exportarProductos('json') },
              { label: 'Exportar CSV',  icon: Download, onClick: () => exportarProductos('csv') },
              { label: 'Grupos',        icon: Boxes,    onClick: () => setGruposPanel(true) },
              { label: 'Importar',      icon: Upload,   onClick: () => navigate('/productos/importar') },
              { label: 'Escanear ticket', icon: Camera, onClick: () => { setScanTicketStep('upload'); setScanTicketItems([]); setScanTicketPreview(null); setShowScanTicket(true) } },
            ]}
          />
          <button
            onClick={() => {
              if (limits && !limits.puede_crear_producto) setShowLimitModal(true)
              else navigate('/productos/nuevo')
            }}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <Plus size={16} /> Nuevo producto
          </button>
        </div>
      </div>
      <input ref={scanTicketRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) procesarTicketProductos(f); e.target.value = '' }} />

      {/* Tabs */}
      <PageTabs
        tabs={[
          { id: 'productos', label: 'Productos', icon: Package },
          // Estructura (empaque unidad/caja/pallet) = WMS → solo modo avanzado
          ...(modoAvanzado ? [{ id: 'estructura', label: 'Estructura', icon: Layers }] : []),
        ]}
        active={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {/* ════════════════════ TAB ESTRUCTURA ════════════════════ */}
      {tab === 'estructura' ? (
        <div className="space-y-5">
          {/* Selector de producto */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Seleccioná un producto para gestionar sus estructuras
            </p>
            <div className="relative" ref={dropdownRef}>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                <input
                  type="text"
                  value={estrProductoId ? estrProductoNombre : estrSearch}
                  onChange={e => {
                    if (estrProductoId) {
                      setEstrProductoId(null)
                      setEstrProductoNombre('')
                    }
                    setEstrSearch(e.target.value)
                    setEstrDropdown(true)
                  }}
                  onFocus={() => setEstrDropdown(true)}
                  placeholder="Buscar producto por nombre..."
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800"
                />
                {estrProductoId && (
                  <button
                    onClick={() => { setEstrProductoId(null); setEstrProductoNombre(''); setEstrSearch('') }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="Limpiar selección">
                    <X size={15} />
                  </button>
                )}
              </div>
              {estrDropdown && !estrProductoId && productosEstr.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  {productosEstr.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => {
                        setEstrProductoId(p.id)
                        setEstrProductoNombre(p.nombre)
                        setEstrSearch('')
                        setEstrDropdown(false)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left transition-colors">
                      <div className="w-7 h-7 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package size={14} className="text-gray-400 dark:text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{(p as any).sku}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Lista de estructuras del producto seleccionado */}
          {estrProductoId ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Estructuras de <span className="font-semibold text-gray-800 dark:text-gray-200">{estrProductoNombre}</span>
                  {!estrLoading && (
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                      ({estructuras.length} {estructuras.length === 1 ? 'estructura' : 'estructuras'})
                    </span>
                  )}
                </p>
                <button
                  onClick={() => setEstrModal({ open: true, editando: null })}
                  className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all">
                  <Plus size={15} /> Nueva estructura
                </button>
              </div>

              {estrLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-accent-text" />
                </div>
              ) : estructuras.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-12 text-center">
                  <Ruler size={36} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                  <p className="text-gray-500 dark:text-gray-400 font-medium">Sin estructuras aún</p>
                  <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
                    Creá la primera para este producto.
                  </p>
                  <button
                    onClick={() => setEstrModal({ open: true, editando: null })}
                    className="mt-4 flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all mx-auto">
                    <Plus size={15} /> Nueva estructura
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {estructuras.map(e => (
                    <EstrCard
                      key={e.id}
                      e={e}
                      solo={estructuras.length === 1}
                      onEdit={() => setEstrModal({ open: true, editando: e })}
                      onDelete={() => eliminarMut.mutate(e)}
                      onSetDefault={() => setDefaultMut.mutate(e.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
              <Layers size={36} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-gray-400 dark:text-gray-500 text-sm">
                Buscá un producto arriba para ver y gestionar sus estructuras.
              </p>
            </div>
          )}
        </div>
      ) : (
      /* ════════════════════ TAB PRODUCTOS ════════════════════ */
        <>
          {/* Barra de uso del plan */}
          {limits && (
            limits.max_productos === -1 ? (
              <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 border border-border-ds bg-surface text-sm">
                <span className="text-muted font-medium">
                  {limits.productos_actuales.toLocaleString()} producto{limits.productos_actuales !== 1 ? 's' : ''}
                </span>
                <span className="text-xs text-green-600 dark:text-green-400">· Sin límite en tu plan</span>
              </div>
            ) : (
              <PlanProgressBar
                actual={limits.productos_actuales}
                max={limits.max_productos}
                label="productos"
              />
            )
          )}

          {stockCritico > 0 && (
            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
              onClick={() => setFilterAlerta(!filterAlerta)}>
              <AlertTriangle size={18} className="text-red-500" />
              <p className="text-red-700 dark:text-red-400 text-sm font-medium">
                {stockCritico} producto{stockCritico !== 1 ? 's' : ''} con stock crítico
                {filterAlerta ? ' — click para ver todos' : ' — click para filtrar'}
              </p>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU o código..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
            </div>
            <button
              onClick={() => setViewMode(v => v === 'flat' ? 'grouped' : 'flat')}
              title={viewMode === 'flat' ? 'Agrupar variantes' : 'Vista plana'}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm transition-all shrink-0
                ${viewMode === 'grouped'
                  ? 'bg-accent text-white border-accent-text'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 hover:text-accent-text hover:border-accent-text'}`}>
              <Layers size={15} />
              <span className="hidden sm:inline whitespace-nowrap">Agrupar variantes</span>
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
              <Toggle size="sm" checked={showInactivos} onChange={setShowInactivos}
                aria-label="Ver inactivos" />
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Ver inactivos</span>
            </label>
            <button onClick={() => setScannerOpen(true)}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent-text transition-colors bg-white dark:bg-gray-800"
              title="Escanear código de barras">
              <Camera size={17} />
            </button>
          </div>

          {/* ════════ VISTA AGRUPADA ════════ */}
          {viewMode === 'grouped' && (
            <div className="space-y-4">
              {/* Productos sin grupo */}
              {(() => {
                const sinGrupo = filtered.filter(p => !(p as any).grupo_id)
                if (sinGrupo.length === 0) return null
                return (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedGrupos(prev => {
                        const n = new Set(prev)
                        n.has('__sin_grupo__') ? n.delete('__sin_grupo__') : n.add('__sin_grupo__')
                        return n
                      })}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Package size={15} className="text-gray-400" />
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Productos individuales</span>
                        <span className="px-1.5 py-0.5 rounded-full text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300">{sinGrupo.length}</span>
                      </div>
                      {expandedGrupos.has('__sin_grupo__') ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </button>
                    {expandedGrupos.has('__sin_grupo__') && (
                      <div className="divide-y divide-gray-50 dark:divide-gray-700">
                        {sinGrupo.map(p => {
                          const disponible = stockDisponibleMap[p.id] ?? 0
                          const critDisp = disponible <= (p as any).stock_minimo
                          const inactivo = !(p as any).activo
                          return (
                            <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${inactivo ? 'opacity-60' : ''}`}>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{(p as any).sku}</p>
                              </div>
                              <p className="text-sm text-gray-600 dark:text-gray-300 flex-shrink-0 hidden sm:block">
                                ${((p as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                              </p>
                              <span className={`flex-shrink-0 px-2 py-0.5 rounded-lg text-xs font-semibold
                                ${critDisp ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                                {disponible} {(p as any).unidad_medida}
                              </span>
                              <Link to={`/productos/${p.id}/editar`} className="text-xs text-accent-text hover:underline flex-shrink-0">
                                Editar
                              </Link>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Grupos */}
              {productosGrupos.map(grupo => {
                const variantes = filtered.filter(p => (p as any).grupo_id === grupo.id)
                const isOpen = expandedGrupos.has(grupo.id)
                return (
                  <div key={grupo.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                      <button
                        type="button"
                        onClick={() => setExpandedGrupos(prev => {
                          const n = new Set(prev)
                          n.has(grupo.id) ? n.delete(grupo.id) : n.add(grupo.id)
                          return n
                        })}
                        className="flex-1 flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition-opacity"
                      >
                        <Boxes size={15} className="text-accent-text flex-shrink-0" />
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">{grupo.nombre}</span>
                        <span className="px-1.5 py-0.5 rounded-full text-xs bg-accent/10 text-accent-text flex-shrink-0">{variantes.length} variantes</span>
                        {grupo.precio_base != null && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                            Base: ${grupo.precio_base.toLocaleString('es-AR')}
                          </span>
                        )}
                        {isOpen ? <ChevronUp size={14} className="text-gray-400 ml-auto flex-shrink-0" /> : <ChevronDown size={14} className="text-gray-400 ml-auto flex-shrink-0" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setGrupoModal({ open: true, grupo })}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-accent-text transition-colors flex-shrink-0 px-2 py-1 rounded-lg hover:bg-accent/10"
                      >
                        <Edit2 size={12} /> Editar grupo
                      </button>
                      <button
                        type="button"
                        onClick={() => setGrupoEliminarConfirm(grupo)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 size={12} /> Eliminar
                      </button>
                    </div>
                    {isOpen && (
                      variantes.length === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Sin variantes. Generá combinaciones en &quot;Editar grupo&quot;.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                                <th className="text-left px-4 py-2 font-medium">Nombre / SKU</th>
                                <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Variante</th>
                                <th className="text-right px-4 py-2 font-medium">Precio</th>
                                <th className="text-right px-4 py-2 font-medium">Stock</th>
                                <th className="px-4 py-2" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                              {variantes.map(v => {
                                const disponible = stockDisponibleMap[v.id] ?? 0
                                const critDisp = disponible <= (v as any).stock_minimo
                                const inactivo = !(v as any).activo
                                return (
                                  <tr key={v.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${inactivo ? 'opacity-60' : ''}`}>
                                    <td className="px-4 py-2.5">
                                      <p className="font-medium text-gray-800 dark:text-gray-100 truncate max-w-[200px]">{v.nombre}</p>
                                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{(v as any).sku}</p>
                                    </td>
                                    <td className="px-4 py-2.5 hidden sm:table-cell">
                                      <div className="flex flex-wrap gap-1">
                                        {(v as any).variante_valores && Object.entries((v as any).variante_valores as Record<string, string>).map(([k, val]) => (
                                          <span key={k} className="px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                            {k}: {val}
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                                      ${((v as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                      <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold
                                        ${critDisp ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                                        {disponible} {(v as any).unidad_medida}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                      <Link to={`/productos/${v.id}/editar`} className="text-xs text-accent-text hover:underline">
                                        Editar
                                      </Link>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    )}
                  </div>
                )
              })}

              {productosGrupos.length === 0 && filtered.every(p => !(p as any).grupo_id) && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
                  <Boxes size={36} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                  <p className="text-gray-500 dark:text-gray-400 font-medium">Sin grupos de variantes</p>
                  <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Creá un grupo en el botón &quot;Grupos&quot; de arriba.</p>
                </div>
              )}
            </div>
          )}

          {/* ════════ VISTA PLANA ════════ */}
          {viewMode === 'flat' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <Package size={40} className="mb-3 opacity-50" />
                <p className="font-medium">{search ? 'No se encontraron productos' : 'No hay productos aún'}</p>
                {!search && <Link to="/productos/nuevo" className="mt-3 text-accent-text text-sm hover:underline">Agregá tu primer producto →</Link>}
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {/* Header select-all */}
                <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-1 flex-shrink-0 cursor-pointer" onClick={toggleSelectAll}>
                    {allSelected
                      ? <CheckSquare size={16} className="text-accent-text" />
                      : someSelected
                        ? <CheckSquare size={16} className="text-accent-text/50" />
                        : <Square size={16} className="text-gray-400 dark:text-gray-500" />
                    }
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedIds.size > 0 ? `${selectedIds.size} seleccionado${selectedIds.size !== 1 ? 's' : ''}` : 'Seleccionar todos'}
                  </span>
                  {selectedIds.size > 0 && (
                    <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline ml-1">
                      Limpiar
                    </button>
                  )}
                </div>
                {filtered.map(p => {
                  const stock      = (p as any).stock_actual ?? 0
                  const disponible = stockDisponibleMap[p.id] ?? 0
                  const critDisp   = disponible <= (p as any).stock_minimo
                  const expanded   = expandedId === p.id
                  const inactivo   = !(p as any).activo

                  return (
                    <div key={p.id} className={inactivo ? 'opacity-60' : ''}>
                      <div
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors
                          ${expanded ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}
                          ${selectedIds.has(p.id) ? 'bg-accent/5 dark:bg-accent/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : p.id)}
                      >
                        <div className="flex items-center gap-1 flex-shrink-0"
                          onClick={e => toggleSelect(p.id, e)}>
                          {selectedIds.has(p.id)
                            ? <CheckSquare size={16} className="text-accent-text" />
                            : <Square size={16} className="text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-500" />
                          }
                        </div>

                        {(p as any).imagen_url ? (
                          <img src={(p as any).imagen_url} alt={p.nombre} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Package size={16} className="text-gray-400 dark:text-gray-500" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                            {inactivo && (
                              <span className="flex-shrink-0 px-1.5 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">Inactivo</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{(p as any).sku}</p>
                          {(p as any).codigo_barras && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{(p as any).codigo_barras}</p>
                          )}
                          {((p as any).categorias?.nombre || (p as any).estados_inventario?.nombre || (p as any).ubicaciones?.nombre) && (
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              {(p as any).categorias?.nombre && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                  {(p as any).categorias.nombre}
                                </span>
                              )}
                              {(p as any).estados_inventario?.nombre && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                                  {(p as any).estados_inventario.nombre}
                                </span>
                              )}
                              {(p as any).ubicaciones?.nombre && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
                                  {(p as any).ubicaciones.nombre}
                                </span>
                              )}
                            </div>
                          )}
                          {(p as any).grupo_id && (() => {
                            const g = productosGrupos.find(gr => gr.id === (p as any).grupo_id)
                            return g ? (
                              <p className="text-xs text-accent-text/70 dark:text-accent-text/60 mt-0.5">
                                • Parte de &quot;{g.nombre}&quot;
                              </p>
                            ) : null
                          })()}
                        </div>

                        <div className="hidden sm:block text-right flex-shrink-0">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            ${((p as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </p>
                          {verCosto && (p as any).precio_costo > 0 && (
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              costo ${((p as any).precio_costo ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                            </p>
                          )}
                        </div>

                        <div className="text-right flex-shrink-0 space-y-0.5">
                          {/* Stock disponible para venta */}
                          <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-lg text-xs
                            ${critDisp ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                            {critDisp && <AlertTriangle size={11} />}
                            {disponible} {(p as any).unidad_medida}
                          </span>
                          {/* Stock total */}
                          {stock !== (stockDisponibleMap[p.id] ?? 0) && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-lg">
                              {stock} total
                            </p>
                          )}
                        </div>

                        {verCosto && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setOcModal({ productoId: p.id, nombre: p.nombre, sku: (p as any).sku, proveedorId: (p as any).proveedor_id ?? '' })
                            setOcProveedor((p as any).proveedor_id ?? '')
                            setOcCantidad('1')
                            setOcPrecio(String((p as any).precio_costo ?? ''))
                          }}
                          title="Agregar a Orden de Compra"
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text dark:hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors flex-shrink-0">
                          <ShoppingCart size={15} />
                        </button>
                        )}
                        <Link to={`/productos/${p.id}/editar`}
                          onClick={e => e.stopPropagation()}
                          className="text-xs text-accent-text hover:underline flex-shrink-0 hidden sm:block">
                          Editar
                        </Link>
                      </div>

                      {/* Panel de resumen del producto */}
                      {expanded && (
                        <div className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-600 px-6 py-4 space-y-4">
                          {/* Datos del producto */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Stock disponible</p>
                              <p className={`font-semibold ${critDisp ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
                                {disponible} {(p as any).unidad_medida}
                              </p>
                              {(p as any).stock_minimo != null && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">Mín: {(p as any).stock_minimo}</p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Precio venta</p>
                              <p className="font-semibold text-gray-800 dark:text-gray-100">
                                ${((p as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                              </p>
                              {cotizacion > 0 && (p as any).precio_venta > 0 && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                  USD {((p as any).precio_venta / cotizacion).toFixed(2)}
                                </p>
                              )}
                            </div>
                            {verCosto && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Costo</p>
                              <p className="font-semibold text-gray-800 dark:text-gray-100">
                                ${((p as any).precio_costo ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                              </p>
                            </div>
                            )}
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Categoría</p>
                              <p className="text-gray-700 dark:text-gray-300">{(p as any).categorias?.nombre ?? '—'}</p>
                            </div>
                            {(p as any).estados_inventario?.nombre && (
                              <div>
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Estado predeterminado</p>
                                <p className="text-gray-700 dark:text-gray-300">{(p as any).estados_inventario.nombre}</p>
                              </div>
                            )}
                            {(p as any).ubicaciones?.nombre && (
                              <div>
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Ubicación predeterminada</p>
                                <p className="text-gray-700 dark:text-gray-300">{(p as any).ubicaciones.nombre}</p>
                              </div>
                            )}
                            {(p as any).proveedores?.nombre && (
                              <div>
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Proveedor</p>
                                <p className="text-gray-700 dark:text-gray-300">{(p as any).proveedores.nombre}</p>
                              </div>
                            )}
                            {(p as any).codigo_barras && (
                              <div className="col-span-2 sm:col-span-1">
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Código de barras</p>
                                <p className="text-gray-700 dark:text-gray-300 font-mono text-xs break-all">{(p as any).codigo_barras}</p>
                              </div>
                            )}
                            {(p as any).notas && (
                              <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Notas</p>
                                <p className="text-gray-600 dark:text-gray-300 text-xs">{(p as any).notas}</p>
                              </div>
                            )}
                          </div>

                          {/* Estructura default */}
                          {estructuraDefault && (
                            <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide flex items-center gap-1">
                                  <Layers size={12} /> Estructura default
                                </p>
                                <button
                                  onClick={e => { e.stopPropagation(); setTab('estructura'); setEstrProductoId(p.id); setEstrProductoNombre(p.nombre) }}
                                  className="text-xs text-accent-text hover:underline">
                                  Gestionar →
                                </button>
                              </div>
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{estructuraDefault.nombre}</p>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                {nivelesOrdenados(estructuraDefault).map(n => (
                                  <div key={n.id} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                    <p className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 text-xs">
                                      {nombreUdm(n)}{n.orden === 1 ? ' · base' : ''}
                                    </p>
                                    {n.orden > 1 && (
                                      <p className="text-gray-600 dark:text-gray-300">= {n.unidades_base} × base</p>
                                    )}
                                    {n.peso_kg != null && <p className="text-gray-600 dark:text-gray-300">Peso: {n.peso_kg} kg</p>}
                                    {n.alto_cm != null && (
                                      <p className="text-gray-600 dark:text-gray-300">{n.alto_cm}×{n.ancho_cm ?? '—'}×{n.largo_cm ?? '—'} cm</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-1 border-t border-gray-200 dark:border-gray-600 flex items-center gap-4">
                            <Link to={`/productos/${p.id}/editar`}
                              className="flex items-center gap-1.5 text-sm text-accent-text hover:underline font-medium">
                              <Edit2 size={13} /> Editar producto
                            </Link>
                            {!estructuraDefault && (
                              <button
                                onClick={e => { e.stopPropagation(); setTab('estructura'); setEstrProductoId(p.id); setEstrProductoNombre(p.nombre) }}
                                className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-accent-text transition-colors">
                                <Layers size={13} /> Agregar estructura
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )}
        </>
      )}

      {/* ── Panel lateral: Grupos ─────────────────────────────────────────────── */}
      {gruposPanel && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/40" onClick={() => setGruposPanel(false)} />
          <div className="w-full max-w-sm bg-white dark:bg-gray-800 shadow-2xl flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Boxes size={18} className="text-accent-text" />
                <h2 className="text-base font-bold text-primary">Grupos de variantes</h2>
              </div>
              <button onClick={() => setGruposPanel(false)} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {productosGrupos.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <Boxes size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Sin grupos aún. Creá el primero.</p>
                </div>
              ) : (
                productosGrupos.map(g => (
                  <div key={g.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 hover:border-accent-text/40 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{g.nombre}</p>
                        {(g.categorias as any)?.nombre && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">{(g.categorias as any).nombre}</p>
                        )}
                        {g.precio_base != null && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">Base: ${g.precio_base.toLocaleString('es-AR')}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setGrupoModal({ open: true, grupo: g }); setGruposPanel(false) }}
                        className="p-1.5 text-gray-400 hover:text-accent-text transition-colors flex-shrink-0"
                        title="Editar grupo"
                      >
                        <Edit2 size={15} />
                      </button>
                    </div>
                    {g.atributos && g.atributos.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {g.atributos.map((a, i) => (
                          <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                            {a.nombre} ({a.valores.length})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700">
              <button
                type="button"
                onClick={() => { setGrupoModal({ open: true, grupo: null }); setGruposPanel(false) }}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm transition-all"
              >
                <Plus size={15} /> Nuevo grupo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de grupo ──────────────────────────────────────────────────── */}
      {grupoModal.open && (
        <ProductoGrupoModal
          grupo={grupoModal.grupo}
          onClose={() => setGrupoModal({ open: false, grupo: null })}
        />
      )}

      {/* ── Confirmar eliminar grupo de variantes ───────────────────────────── */}
      {grupoEliminarConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Eliminar grupo de variantes</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              ¿Eliminar <strong>{grupoEliminarConfirm.nombre}</strong>?
              {(() => {
                const n = filtered.filter(p => (p as any).grupo_id === grupoEliminarConfirm.id).length
                return n > 0
                  ? ` Tiene ${n} variante${n !== 1 ? 's' : ''} — no se borran, quedan como productos sueltos (dejan de listarse agrupadas acá).`
                  : ' No tiene variantes generadas.'
              })()}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setGrupoEliminarConfirm(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <button onClick={() => eliminarGrupoMut.mutate(grupoEliminarConfirm.id)} disabled={eliminarGrupoMut.isPending}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60">
                {eliminarGrupoMut.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Barra flotante de acciones bulk ─────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900 dark:bg-gray-800 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 flex-wrap max-w-[90vw]">
          <span className="text-sm font-semibold shrink-0">
            {selectedIds.size} producto{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="w-px h-5 bg-gray-600 shrink-0" />
          <button onClick={() => { setBulkValue(''); setBulkModal('categoria') }}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Tag size={13} /> Categoría
          </button>
          <button onClick={() => { setBulkValue(''); setBulkModal('regla') }}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <RotateCcw size={13} /> Regla inventario
          </button>
          <button onClick={() => { setBulkValue(''); setBulkModal('aging') }}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Clock size={13} /> Aging profile
          </button>
          <button onClick={() => { setBulkAtributos({ tiene_series: false, tiene_lote: false, tiene_vencimiento: false }); setBulkModal('atributos') }}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Settings2 size={13} /> Atributos
          </button>
          <button onClick={() => { setBulkValue(''); setBulkModal('proveedor') }}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Truck size={13} /> Proveedor
          </button>
          <button onClick={() => { setBulkPrecioTipo('pct'); setBulkPrecioValor(''); setBulkModal('precio_venta') }}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <DollarSign size={13} /> Precio
          </button>
          {(() => {
            const seleccionados = filtered.filter(p => selectedIds.has(p.id))
            const activosCount = seleccionados.filter(p => (p as any).activo).length
            const mayoriaActivos = activosCount >= seleccionados.length / 2
            return mayoriaActivos ? (
              <button onClick={() => setBulkModal('desactivar')}
                className="flex items-center gap-1.5 text-xs bg-red-700 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                <X size={13} /> Desactivar
              </button>
            ) : (
              <button onClick={() => setBulkModal('activar')}
                className="flex items-center gap-1.5 text-xs bg-green-700 hover:bg-green-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                <ToggleRight size={13} /> Reactivar
              </button>
            )
          })()}
          <button onClick={() => setBulkModal('eliminar')}
            className="flex items-center gap-1.5 text-xs bg-red-900 hover:bg-red-800 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Trash2 size={13} /> Eliminar
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            title="Limpiar selección"
            className="ml-1 text-gray-400 hover:text-white transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Modal de acción bulk ─────────────────────────────────────────────── */}
      {bulkModal && bulkModal !== 'activar' && bulkModal !== 'desactivar' && bulkModal !== 'precio_venta' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">
                {bulkModal === 'categoria'  && 'Cambiar categoría'}
                {bulkModal === 'regla'      && 'Cambiar regla de inventario'}
                {bulkModal === 'aging'      && 'Cambiar aging profile'}
                {bulkModal === 'atributos'  && 'Cambiar atributos de control'}
                {bulkModal === 'proveedor'  && 'Cambiar proveedor'}
              </h3>
              <button onClick={() => setBulkModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Se aplicará a <strong>{selectedIds.size}</strong> producto{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}.
            </p>

            {bulkModal === 'categoria' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="">Sin categoría</option>
                {(categoriasAll as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            )}

            {bulkModal === 'regla' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="">Usar regla del negocio</option>
                {['FIFO','FEFO','LEFO','LIFO','Manual'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}

            {bulkModal === 'aging' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="">Sin aging profile</option>
                {(agingProfilesAll as any[]).map((a: any) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            )}

            {bulkModal === 'proveedor' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="">Sin proveedor</option>
                {(proveedoresAll as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}

            {bulkModal === 'atributos' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Seleccioná los atributos que querés activar en los productos seleccionados:</p>
                {[
                  { key: 'tiene_series',     label: 'Control por N° de serie' },
                  { key: 'tiene_lote',       label: 'Control por lote' },
                  { key: 'tiene_vencimiento',label: 'Control de vencimiento' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                        ${(bulkAtributos as any)[key] ? 'bg-accent border-accent-text' : 'border-gray-300 dark:border-gray-600'}`}
                      onClick={() => setBulkAtributos(prev => ({ ...prev, [key]: !(prev as any)[key] }))}>
                      {(bulkAtributos as any)[key] && <Check size={12} className="text-white" />}
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setBulkModal(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <button onClick={aplicarBulk} disabled={bulkSaving}
                className="flex-1 bg-accent hover:bg-accent/90 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                <Zap size={14} />
                {bulkSaving ? 'Aplicando...' : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal precio de venta */}
      {bulkModal === 'precio_venta' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">Actualizar precio de venta</h3>
              <button onClick={() => setBulkModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Se aplicará a <strong>{selectedIds.size}</strong> producto{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}.
            </p>
            <div className="flex rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden text-sm">
              <button type="button"
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${bulkPrecioTipo === 'pct' ? 'bg-accent text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                onClick={() => setBulkPrecioTipo('pct')}>
                <Percent size={13} /> % de ajuste
              </button>
              <button type="button"
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${bulkPrecioTipo === 'fijo' ? 'bg-accent text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                onClick={() => setBulkPrecioTipo('fijo')}>
                <DollarSign size={13} /> Precio fijo
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                {bulkPrecioTipo === 'pct' ? '%' : '$'}
              </span>
              <input type="number" step={bulkPrecioTipo === 'pct' ? '0.1' : '0.01'}
                onWheel={e => e.currentTarget.blur()}
                value={bulkPrecioValor}
                onChange={e => setBulkPrecioValor(e.target.value)}
                placeholder={bulkPrecioTipo === 'pct' ? 'Ej: 15 (aumento) o -10 (descuento)' : 'Precio exacto'}
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text" />
            </div>
            {bulkPrecioTipo === 'pct' && bulkPrecioValor && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {parseFloat(bulkPrecioValor) > 0 ? `Aumento del ${bulkPrecioValor}%` : `Descuento del ${Math.abs(parseFloat(bulkPrecioValor))}%`}
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setBulkModal(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <button onClick={aplicarBulk} disabled={bulkSaving || !bulkPrecioValor}
                className="flex-1 bg-accent hover:bg-accent/90 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                <Zap size={14} />
                {bulkSaving ? 'Aplicando...' : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirm desactivar */}
      {(bulkModal === 'activar' || bulkModal === 'desactivar') && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900 dark:text-white">
              {bulkModal === 'desactivar' ? 'Desactivar productos' : 'Activar productos'}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              ¿{bulkModal === 'desactivar' ? 'Desactivar' : 'Activar'} <strong>{selectedIds.size}</strong> producto{selectedIds.size !== 1 ? 's' : ''}?
              {bulkModal === 'desactivar' && ' Los productos desactivados no aparecen en ventas ni en el listado.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setBulkModal(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <button onClick={aplicarBulk} disabled={bulkSaving}
                className={`flex-1 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60
                  ${bulkModal === 'desactivar' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
                {bulkSaving ? 'Procesando...' : bulkModal === 'desactivar' ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirm eliminar (hard delete real) */}
      {bulkModal === 'eliminar' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Eliminar productos</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              ¿Eliminar definitivamente <strong>{selectedIds.size}</strong> producto{selectedIds.size !== 1 ? 's' : ''}? Esta acción NO se puede deshacer.
              Solo se borran los que no tengan actividad registrada (ventas, movimientos, compras, etc.) — el resto queda como está y te avisamos cuáles.
              Si preferís ocultarlos sin perder el historial, usá &quot;Desactivar&quot; en su lugar.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setBulkModal(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <button onClick={aplicarBulk} disabled={bulkSaving}
                className="flex-1 bg-red-700 hover:bg-red-800 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60">
                {bulkSaving ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de estructura */}
      {estrModal.open && (
        <EstrModal
          editando={estrModal.editando}
          unidades={unidadesMedida}
          baseUdmNombre={(productosEstr as any[]).find(p => p.id === estrProductoId)?.unidad_medida ?? null}
          onClose={() => setEstrModal({ open: false, editando: null })}
          onSave={handleSaveModal}
          saving={saving}
        />
      )}

      {scannerOpen && (
        <BarcodeScanner
          title="Buscar producto"
          onDetected={code => { setSearch(code); setScannerOpen(false) }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Modal OC rápida */}
      {ocModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">Agregar a Orden de Compra</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{ocModal.sku} — {ocModal.nombre}</p>
              </div>
              <button onClick={() => setOcModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Proveedor <span className="text-red-500">*</span></label>
                <select value={ocProveedor} onChange={e => setOcProveedor(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700">
                  <option value="">Seleccionar proveedor...</option>
                  {(proveedoresOC as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cantidad</label>
                  <input type="number" min="1" value={ocCantidad} onChange={e => setOcCantidad(e.target.value)}
                    onWheel={e => e.currentTarget.blur()}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Precio unitario <span className="text-gray-400 text-xs">(basado en costo del producto)</span></label>
                  <input type="number" min="0" value={ocPrecio} readOnly
                    onWheel={e => e.currentTarget.blur()}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-default" />
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Se agrega a la OC borrador del proveedor, o crea una nueva si no existe.</p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setOcModal(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  Cancelar
                </button>
                <button
                  disabled={!ocProveedor || !ocCantidad || Number(ocCantidad) <= 0 || agregarAOC.isPending}
                  onClick={() => agregarAOC.mutate({
                    productoId: ocModal.productoId,
                    proveedorId: ocProveedor,
                    cantidad: Number(ocCantidad),
                    precio: ocPrecio ? Number(ocPrecio) : null,
                  })}
                  className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {agregarAOC.isPending ? 'Agregando...' : 'Agregar a OC'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal scan ticket ─────────────────────────────────────────────── */}
      {showScanTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Camera size={18} className="text-accent-text" />
                <h2 className="font-semibold text-primary">Escanear ticket — validar catálogo</h2>
              </div>
              <button onClick={() => { setShowScanTicket(false); setScanTicketItems([]); setScanTicketStep('upload') }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {scanTicketStep === 'upload' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted">Fotografiá un ticket de supermercado. Genesis360 va a comparar los productos contra tu catálogo y te va a avisar si hay precios distintos o productos nuevos.</p>
                  <div onClick={() => scanTicketRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-3 h-48 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl cursor-pointer hover:border-accent-text hover:bg-accent/5 transition-all">
                    <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center">
                      <Camera size={22} className="text-accent-text" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-primary">Tocá para seleccionar imagen</p>
                      <p className="text-xs text-muted mt-0.5">Foto del ticket o galería</p>
                    </div>
                  </div>
                </div>
              )}

              {scanTicketStep === 'scanning' && (
                <div className="space-y-4">
                  {scanTicketPreview && <img src={scanTicketPreview} alt="Ticket" className="w-full max-h-48 object-contain rounded-xl border border-gray-200 dark:border-gray-700" />}
                  <div className="flex flex-col items-center gap-3 py-6">
                    <Loader2 size={32} className="text-accent-text animate-spin" />
                    <p className="text-sm font-medium text-primary">Analizando ticket y comparando con tu catálogo...</p>
                  </div>
                </div>
              )}

              {scanTicketStep === 'results' && scanTicketItems.length > 0 && (() => {
                const sinCambios = scanTicketItems.filter(i => i.accion === 'none').length
                const aActualizar = scanTicketItems.filter(i => i.accion === 'actualizar_precio').length
                const aCrear = scanTicketItems.filter(i => i.accion === 'crear').length
                return (
                  <div className="space-y-4">
                    {scanTicketPreview && <img src={scanTicketPreview} alt="Ticket" className="w-full max-h-28 object-contain rounded-xl border border-gray-200 dark:border-gray-700" />}
                    <div className="flex items-center gap-2 flex-wrap">
                      {sinCambios > 0 && <span className="text-xs px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-medium">✓ {sinCambios} sin cambios</span>}
                      {aActualizar > 0 && <span className="text-xs px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full font-medium">⚠ {aActualizar} precio{aActualizar !== 1 ? 's' : ''} diferente{aActualizar !== 1 ? 's' : ''}</span>}
                      {aCrear > 0 && <span className="text-xs px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full font-medium">+ {aCrear} nuevo{aCrear !== 1 ? 's' : ''} en ticket</span>}
                    </div>
                    <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 w-6"></th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Producto</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-500 w-28">Costo (ticket)</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-500 w-28">P. venta (nuevo)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                          {scanTicketItems.map(item => (
                            <tr key={item._key} className={item.accion === 'skip' ? 'opacity-40' : ''}>
                              <td className="px-3 py-2.5">
                                {item.accion === 'none' && <CheckCircle size={14} className="text-green-500" />}
                                {item.accion === 'actualizar_precio' && <AlertTriangle size={14} className="text-amber-500" />}
                                {item.accion === 'crear' && <Plus size={14} className="text-blue-500" />}
                                {item.accion === 'skip' && <X size={14} className="text-gray-300" />}
                              </td>
                              <td className="px-3 py-2.5">
                                {item.accion === 'crear' ? (
                                  <input value={item.nombre_editable}
                                    onChange={e => setScanTicketItems(prev => prev.map(i => i._key === item._key ? { ...i, nombre_editable: e.target.value } : i))}
                                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-0.5 bg-transparent focus:outline-none focus:border-accent-text text-primary" />
                                ) : (
                                  <div>
                                    <p className="font-medium text-primary leading-tight">{item.match?.nombre ?? item.nombre_scan}</p>
                                    {item.accion === 'actualizar_precio' && (
                                      <p className="text-amber-500 dark:text-amber-400 leading-tight">
                                        BD: ${(item.match!.precio_costo).toLocaleString('es-AR', { maximumFractionDigits: 0 })} → Ticket: ${item.precio_unitario.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                                      </p>
                                    )}
                                    {item.accion === 'none' && <p className="text-muted leading-tight">Precio sin cambios</p>}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <input type="number" min="0" step="0.01" value={item.precio_costo_editable}
                                  onChange={e => setScanTicketItems(prev => prev.map(i => i._key === item._key ? { ...i, precio_costo_editable: e.target.value } : i))}
                                  disabled={item.accion === 'none' || item.accion === 'skip'}
                                  className="w-24 text-right border border-gray-200 dark:border-gray-600 rounded-lg px-1 py-0.5 bg-transparent focus:outline-none focus:border-accent-text disabled:opacity-50" />
                              </td>
                              <td className="px-3 py-2.5 text-right flex items-center justify-end gap-1">
                                {item.accion === 'crear' && (
                                  <input type="number" min="0" step="0.01" value={item.precio_venta_nuevo}
                                    onChange={e => setScanTicketItems(prev => prev.map(i => i._key === item._key ? { ...i, precio_venta_nuevo: e.target.value } : i))}
                                    placeholder="Precio venta"
                                    className="w-24 text-right border border-gray-200 dark:border-gray-600 rounded-lg px-1 py-0.5 bg-transparent focus:outline-none focus:border-accent-text" />
                                )}
                                {(item.accion === 'actualizar_precio' || item.accion === 'crear' || item.accion === 'skip') && (
                                  <button
                                    onClick={() => setScanTicketItems(prev => prev.map(i => i._key === item._key
                                      ? { ...i, accion: i.accion === 'skip' ? (i.match ? 'actualizar_precio' : 'crear') : 'skip' }
                                      : i))}
                                    className="ml-1 text-gray-400 hover:text-red-400 transition-colors" title={item.accion === 'skip' ? 'Incluir' : 'Omitir'}>
                                    <X size={12} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => { setShowScanTicket(false); setScanTicketItems([]); setScanTicketStep('upload') }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              {scanTicketStep === 'results' && (() => {
                const activos = scanTicketItems.filter(i => i.accion === 'actualizar_precio' || i.accion === 'crear')
                const hayCambios = activos.length > 0
                const labelParts = [
                  scanTicketItems.filter(i => i.accion === 'actualizar_precio').length > 0
                    && `Actualizar ${scanTicketItems.filter(i => i.accion === 'actualizar_precio').length} precio${scanTicketItems.filter(i => i.accion === 'actualizar_precio').length !== 1 ? 's' : ''}`,
                  scanTicketItems.filter(i => i.accion === 'crear').length > 0
                    && `Crear ${scanTicketItems.filter(i => i.accion === 'crear').length} producto${scanTicketItems.filter(i => i.accion === 'crear').length !== 1 ? 's' : ''}`,
                ].filter(Boolean)
                return (
                  <button onClick={aplicarCambiosScan} disabled={!hayCambios || applyingScan}
                    className="flex items-center gap-2 px-5 py-2 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent/90 disabled:opacity-50 transition-colors">
                    {applyingScan ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                    {hayCambios ? labelParts.join(' · ') : 'Sin cambios a aplicar'}
                  </button>
                )
              })()}
              {scanTicketStep === 'upload' && (
                <button onClick={() => scanTicketRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-2 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent/90 transition-colors">
                  <Camera size={15} /> Seleccionar imagen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
