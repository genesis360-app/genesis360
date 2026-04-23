import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Search, Package, AlertTriangle, Camera, ChevronDown, ChevronRight,
  Edit2, Layers, X, Star, Trash2, ChevronUp, Ruler, ShoppingCart,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import { useCotizacion } from '@/hooks/useCotizacion'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { PlanProgressBar } from '@/components/PlanProgressBar'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import type { ProductoEstructura } from '@/lib/supabase'

type Tab = 'productos' | 'estructura'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nivelActivo(e: ProductoEstructura, nivel: 'unidad' | 'caja' | 'pallet'): boolean {
  if (nivel === 'unidad') return e.peso_unidad != null && e.alto_unidad != null
  if (nivel === 'caja')   return e.peso_caja   != null && e.alto_caja   != null
  return e.peso_pallet != null && e.alto_pallet != null
}

function fmt(v: number | null | undefined, unit: string) {
  if (v == null) return null
  return `${v} ${unit}`
}

// ─── Tipos del formulario ────────────────────────────────────────────────────

type NivelForm = {
  activo: boolean
  peso: string; alto: string; ancho: string; largo: string
}
type CajaForm  = NivelForm & { unidades_por_caja: string }
type PalletForm = NivelForm & { cajas_por_pallet: string }

type EstrForm = {
  nombre: string
  unidad: NivelForm
  caja: CajaForm
  pallet: PalletForm
}

const nivelVacio = (): NivelForm => ({ activo: false, peso: '', alto: '', ancho: '', largo: '' })
const formVacio = (): EstrForm => ({
  nombre: '',
  unidad: nivelVacio(),
  caja:   { ...nivelVacio(), unidades_por_caja: '' },
  pallet: { ...nivelVacio(), cajas_por_pallet: '' },
})

function formDesdeEstructura(e: ProductoEstructura): EstrForm {
  return {
    nombre: e.nombre,
    unidad: {
      activo: nivelActivo(e, 'unidad'),
      peso:  String(e.peso_unidad  ?? ''),
      alto:  String(e.alto_unidad  ?? ''),
      ancho: String(e.ancho_unidad ?? ''),
      largo: String(e.largo_unidad ?? ''),
    },
    caja: {
      activo: nivelActivo(e, 'caja'),
      unidades_por_caja: String(e.unidades_por_caja ?? ''),
      peso:  String(e.peso_caja  ?? ''),
      alto:  String(e.alto_caja  ?? ''),
      ancho: String(e.ancho_caja ?? ''),
      largo: String(e.largo_caja ?? ''),
    },
    pallet: {
      activo: nivelActivo(e, 'pallet'),
      cajas_por_pallet: String(e.cajas_por_pallet ?? ''),
      peso:  String(e.peso_pallet  ?? ''),
      alto:  String(e.alto_pallet  ?? ''),
      ancho: String(e.ancho_pallet ?? ''),
      largo: String(e.largo_pallet ?? ''),
    },
  }
}

function validarForm(f: EstrForm): string | null {
  if (!f.nombre.trim()) return 'El nombre es obligatorio.'
  const activados = [f.unidad.activo, f.caja.activo, f.pallet.activo].filter(Boolean).length
  if (activados < 2) return 'Debés activar al menos 2 niveles (Unidad, Caja o Pallet).'

  const checkNivel = (n: NivelForm, label: string): string | null => {
    if (!n.activo) return null
    if (!n.peso  || +n.peso  <= 0) return `${label}: ingresá el peso.`
    if (!n.alto  || +n.alto  <= 0) return `${label}: ingresá el alto.`
    if (!n.ancho || +n.ancho <= 0) return `${label}: ingresá el ancho.`
    if (!n.largo || +n.largo <= 0) return `${label}: ingresá el largo.`
    return null
  }

  if (f.caja.activo && (!f.caja.unidades_por_caja || +f.caja.unidades_por_caja <= 0))
    return 'Caja: ingresá las unidades por caja.'
  if (f.pallet.activo && (!f.pallet.cajas_por_pallet || +f.pallet.cajas_por_pallet <= 0))
    return 'Pallet: ingresá las cajas por pallet.'

  return (
    checkNivel(f.unidad, 'Unidad') ||
    checkNivel(f.caja,   'Caja')   ||
    checkNivel(f.pallet, 'Pallet')
  )
}

function buildRecord(f: EstrForm, tenantId: string, productoId: string, isDefault: boolean) {
  return {
    tenant_id:  tenantId,
    producto_id: productoId,
    nombre:     f.nombre.trim(),
    is_default: isDefault,
    unidades_por_caja: f.caja.activo   ? +f.caja.unidades_por_caja   : null,
    cajas_por_pallet:  f.pallet.activo ? +f.pallet.cajas_por_pallet  : null,
    peso_unidad:  f.unidad.activo ? +f.unidad.peso  : null,
    alto_unidad:  f.unidad.activo ? +f.unidad.alto  : null,
    ancho_unidad: f.unidad.activo ? +f.unidad.ancho : null,
    largo_unidad: f.unidad.activo ? +f.unidad.largo : null,
    peso_caja:  f.caja.activo ? +f.caja.peso  : null,
    alto_caja:  f.caja.activo ? +f.caja.alto  : null,
    ancho_caja: f.caja.activo ? +f.caja.ancho : null,
    largo_caja: f.caja.activo ? +f.caja.largo : null,
    peso_pallet:  f.pallet.activo ? +f.pallet.peso  : null,
    alto_pallet:  f.pallet.activo ? +f.pallet.alto  : null,
    ancho_pallet: f.pallet.activo ? +f.pallet.ancho : null,
    largo_pallet: f.pallet.activo ? +f.pallet.largo : null,
  }
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function NivelSection({
  label,
  nivel,
  onChange,
  extra,
}: {
  label: string
  nivel: NivelForm
  onChange: (v: Partial<NivelForm>) => void
  extra?: React.ReactNode
}) {
  const inp = 'w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent'

  return (
    <div className={`rounded-xl border-2 transition-colors ${nivel.activo ? 'border-accent/40 bg-accent/5 dark:bg-accent/10' : 'border-gray-200 dark:border-gray-700'}`}>
      <button type="button"
        onClick={() => onChange({ activo: !nivel.activo })}
        className="w-full flex items-center justify-between px-4 py-3">
        <span className={`font-medium text-sm ${nivel.activo ? 'text-accent' : 'text-gray-600 dark:text-gray-400'}`}>
          {label}
        </span>
        <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
          ${nivel.activo ? 'bg-accent border-accent' : 'border-gray-300 dark:border-gray-600'}`}>
          {nivel.activo && <span className="text-white text-xs font-bold">✓</span>}
        </span>
      </button>

      {nivel.activo && (
        <div className="px-4 pb-4 space-y-3">
          {extra}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Peso (kg) *</label>
              <input type="number" step="0.001" min="0" value={nivel.peso}
                onChange={e => onChange({ peso: e.target.value })}
                onWheel={e => e.currentTarget.blur()}
                className={inp} placeholder="0.000" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Alto (cm) *</label>
              <input type="number" step="0.01" min="0" value={nivel.alto}
                onChange={e => onChange({ alto: e.target.value })}
                onWheel={e => e.currentTarget.blur()}
                className={inp} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ancho (cm) *</label>
              <input type="number" step="0.01" min="0" value={nivel.ancho}
                onChange={e => onChange({ ancho: e.target.value })}
                onWheel={e => e.currentTarget.blur()}
                className={inp} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Largo (cm) *</label>
              <input type="number" step="0.01" min="0" value={nivel.largo}
                onChange={e => onChange({ largo: e.target.value })}
                onWheel={e => e.currentTarget.blur()}
                className={inp} placeholder="0.00" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modal de formulario ──────────────────────────────────────────────────────

function EstrModal({
  editando,
  onClose,
  onSave,
  saving,
}: {
  editando: ProductoEstructura | null
  onClose: () => void
  onSave: (form: EstrForm) => void
  saving: boolean
}) {
  const [form, setForm] = useState<EstrForm>(() =>
    editando ? formDesdeEstructura(editando) : formVacio()
  )
  const [error, setError] = useState<string | null>(null)

  const upd = (field: keyof EstrForm, val: any) => setForm(f => ({ ...f, [field]: val }))

  const inp = 'w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validarForm(form)
    if (err) { setError(err); return }
    setError(null)
    onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
              onChange={e => upd('nombre', e.target.value)}
              className={inp} placeholder='Ej: "Caja 12 unidades", "Display 6 cajas"' />
          </div>

          {/* Niveles */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Niveles <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">(mínimo 2 requeridos)</span>
            </p>

            <NivelSection
              label="Unidad"
              nivel={form.unidad}
              onChange={v => upd('unidad', { ...form.unidad, ...v })}
            />

            <NivelSection
              label="Caja"
              nivel={form.caja}
              onChange={v => upd('caja', { ...form.caja, ...v })}
              extra={
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Unidades por caja *</label>
                  <input type="number" step="1" min="1" value={form.caja.unidades_por_caja}
                    onChange={e => upd('caja', { ...form.caja, unidades_por_caja: e.target.value })}
                    onWheel={e => e.currentTarget.blur()}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent"
                    placeholder="12" />
                </div>
              }
            />

            <NivelSection
              label="Pallet"
              nivel={form.pallet}
              onChange={v => upd('pallet', { ...form.pallet, ...v })}
              extra={
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cajas por pallet *</label>
                  <input type="number" step="1" min="1" value={form.pallet.cajas_por_pallet}
                    onChange={e => upd('pallet', { ...form.pallet, cajas_por_pallet: e.target.value })}
                    onWheel={e => e.currentTarget.blur()}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent"
                    placeholder="40" />
                </div>
              }
            />
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
  const niveles: { label: string; n: 'unidad' | 'caja' | 'pallet' }[] = [
    { label: 'Unidad', n: 'unidad' },
    { label: 'Caja',   n: 'caja'   },
    { label: 'Pallet', n: 'pallet' },
  ]

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border-2 transition-colors
      ${e.is_default ? 'border-accent/40' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{e.nombre}</p>
            {e.is_default && (
              <span className="inline-flex items-center gap-1 text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                <Star size={10} fill="currentColor" /> Default
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {[
              e.unidades_por_caja  ? `${e.unidades_por_caja} u/caja`  : null,
              e.cajas_por_pallet   ? `${e.cajas_por_pallet} c/pallet` : null,
            ].filter(Boolean).join(' · ') || 'Sin conversiones'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!e.is_default && !solo && (
            <button onClick={onSetDefault} title="Marcar como default"
              className="p-1.5 text-gray-400 hover:text-accent transition-colors">
              <Star size={15} />
            </button>
          )}
          <button onClick={onEdit} title="Editar"
            className="p-1.5 text-gray-400 hover:text-accent transition-colors">
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
        {niveles.map(({ label, n }) => {
          const activo = nivelActivo(e, n)
          if (!activo) return (
            <div key={n} className="text-xs text-gray-300 dark:text-gray-600 italic">{label}: —</div>
          )
          const peso  = fmt(e[`peso_${n}`  as keyof ProductoEstructura] as number, 'kg')
          const alto  = fmt(e[`alto_${n}`  as keyof ProductoEstructura] as number, 'cm')
          const ancho = fmt(e[`ancho_${n}` as keyof ProductoEstructura] as number, 'cm')
          const largo = fmt(e[`largo_${n}` as keyof ProductoEstructura] as number, 'cm')
          return (
            <div key={n}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              <div className="space-y-0.5 text-xs text-gray-700 dark:text-gray-300">
                {peso  && <p>Peso: {peso}</p>}
                {alto  && <p>Alto: {alto} · Ancho: {ancho} · Largo: {largo}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ProductosPage() {
  const { tenant, user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { limits } = usePlanLimits()
  const { cotizacion } = useCotizacion()

  const [tab, setTab] = useState<Tab>('productos')

  // Tab Productos
  const [search, setSearch] = useState('')
  const [filterAlerta, setFilterAlerta] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

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

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setEstrDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: productos = [], isLoading } = useQuery({
    queryKey: ['productos', tenant?.id, search],
    queryFn: async () => {
      let q = supabase
        .from('productos')
        .select('*, categorias(nombre), proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (search) q = q.or(`nombre.ilike.%${search}%,sku.ilike.%${search}%,codigo_barras.eq.${search}`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: estructuraDefault } = useQuery({
    queryKey: ['estructura-default', tenant?.id, expandedId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('producto_estructuras')
        .select('*')
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
        .select('id, nombre, sku')
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
        .select('*')
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', estrProductoId!)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as ProductoEstructura[]
    },
    enabled: !!tenant && !!estrProductoId,
  })

  const { data: proveedoresOC = [] } = useQuery({
    queryKey: ['proveedores-oc', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && !!ocModal,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['producto-estructuras', tenant?.id, estrProductoId] })
    if (expandedId) qc.invalidateQueries({ queryKey: ['estructura-default', tenant?.id, expandedId] })
  }

  const agregarAOC = useMutation({
    mutationFn: async ({ productoId, proveedorId, cantidad, precio }: { productoId: string; proveedorId: string; cantidad: number; precio: number | null }) => {
      // Find existing borrador OC for this proveedor
      const { data: existingOC } = await supabase
        .from('ordenes_compra')
        .select('id, numero')
        .eq('tenant_id', tenant!.id)
        .eq('proveedor_id', proveedorId)
        .eq('estado', 'borrador')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let ocId = existingOC?.id ?? null
      let ocNumero = existingOC?.numero ?? null

      if (!ocId) {
        const { data: newOC, error } = await supabase
          .from('ordenes_compra')
          .insert({ tenant_id: tenant!.id, proveedor_id: proveedorId, estado: 'borrador', created_by: user!.id })
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
      const { error } = await supabase.from('producto_estructuras')
        .insert(buildRecord(form, tenant!.id, estrProductoId!, esDefault))
      if (error) throw error
    },
    onSuccess: () => { invalidar(); setEstrModal({ open: false, editando: null }) },
  })

  const editarMut = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: EstrForm }) => {
      const { nombre, unidades_por_caja, cajas_por_pallet,
        peso_unidad, alto_unidad, ancho_unidad, largo_unidad,
        peso_caja, alto_caja, ancho_caja, largo_caja,
        peso_pallet, alto_pallet, ancho_pallet, largo_pallet,
      } = buildRecord(form, tenant!.id, estrProductoId!, false)
      const { error } = await supabase.from('producto_estructuras')
        .update({ nombre, unidades_por_caja, cajas_por_pallet,
          peso_unidad, alto_unidad, ancho_unidad, largo_unidad,
          peso_caja, alto_caja, ancho_caja, largo_caja,
          peso_pallet, alto_pallet, ancho_pallet, largo_pallet,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidar(); setEstrModal({ open: false, editando: null }) },
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
    if (filterAlerta && (p as any).stock_actual > (p as any).stock_minimo) return false
    return true
  })
  const stockCritico = productos.filter(p => (p as any).stock_actual <= (p as any).stock_minimo).length

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
          <h1 className="text-2xl font-bold text-primary">Productos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{productos.length} productos registrados</p>
        </div>
        <div className="flex gap-2">
          <Link to="/productos/importar"
            className="flex items-center gap-2 border border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all">
            Importar
          </Link>
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

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl w-fit">
        {([
          { id: 'productos' as const, label: 'Productos', icon: Package },
          { id: 'estructura' as const, label: 'Estructura', icon: Layers },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === id
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

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
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800"
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
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-accent" />
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
            <PlanProgressBar
              actual={limits.productos_actuales}
              max={limits.max_productos}
              label="productos"
            />
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

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU o código..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
            </div>
            <button onClick={() => setScannerOpen(true)}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent transition-colors bg-white dark:bg-gray-800"
              title="Escanear código de barras">
              <Camera size={17} />
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <Package size={40} className="mb-3 opacity-50" />
                <p className="font-medium">{search ? 'No se encontraron productos' : 'No hay productos aún'}</p>
                {!search && <Link to="/productos/nuevo" className="mt-3 text-accent text-sm hover:underline">Agregá tu primer producto →</Link>}
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {filtered.map(p => {
                  const stock   = (p as any).stock_actual ?? 0
                  const critico = stock <= (p as any).stock_minimo
                  const expanded = expandedId === p.id

                  return (
                    <div key={p.id}>
                      <div
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${expanded ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : p.id)}
                      >
                        <div className="w-5 flex-shrink-0 text-gray-400 dark:text-gray-500">
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>

                        {(p as any).imagen_url ? (
                          <img src={(p as any).imagen_url} alt={p.nombre} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Package size={16} className="text-gray-400 dark:text-gray-500" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{(p as any).sku}</p>
                          {(p as any).codigo_barras && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{(p as any).codigo_barras}</p>
                          )}
                        </div>

                        <div className="hidden md:block text-xs text-gray-400 dark:text-gray-500">
                          {(p as any).categorias?.nombre ?? '—'}
                        </div>

                        <div className="hidden sm:block text-right flex-shrink-0">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            ${((p as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </p>
                          {cotizacion > 0 && (p as any).precio_venta > 0 && (
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              USD {((p as any).precio_venta / cotizacion).toFixed(2)}
                            </p>
                          )}
                        </div>

                        <div className="text-right flex-shrink-0">
                          <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-lg text-xs
                            ${critico ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                            {critico && <AlertTriangle size={11} />}
                            {stock} {(p as any).unidad_medida}
                          </span>
                        </div>

                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setOcModal({ productoId: p.id, nombre: p.nombre, sku: (p as any).sku, proveedorId: (p as any).proveedor_id ?? '' })
                            setOcProveedor((p as any).proveedor_id ?? '')
                            setOcCantidad('1')
                            setOcPrecio(String((p as any).precio_costo ?? ''))
                          }}
                          title="Agregar a Orden de Compra"
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent dark:hover:text-accent hover:bg-accent/10 rounded-lg transition-colors flex-shrink-0">
                          <ShoppingCart size={15} />
                        </button>
                        <Link to={`/productos/${p.id}/editar`}
                          onClick={e => e.stopPropagation()}
                          className="text-xs text-accent hover:underline flex-shrink-0 hidden sm:block">
                          Editar
                        </Link>
                      </div>

                      {/* Panel de resumen del producto */}
                      {expanded && (
                        <div className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-600 px-6 py-4 space-y-4">
                          {/* Datos del producto */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Stock actual</p>
                              <p className={`font-semibold ${critico ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
                                {stock} {(p as any).unidad_medida}
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
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Costo</p>
                              <p className="font-semibold text-gray-800 dark:text-gray-100">
                                ${((p as any).precio_costo ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Categoría</p>
                              <p className="text-gray-700 dark:text-gray-300">{(p as any).categorias?.nombre ?? '—'}</p>
                            </div>
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
                                  className="text-xs text-accent hover:underline">
                                  Gestionar →
                                </button>
                              </div>
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{estructuraDefault.nombre}</p>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                {(['unidad', 'caja', 'pallet'] as const).map(n => {
                                  if (!nivelActivo(estructuraDefault, n)) return null
                                  const e = estructuraDefault
                                  return (
                                    <div key={n} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                      <p className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 text-xs">{n}</p>
                                      {n === 'caja'   && e.unidades_por_caja  && <p className="text-gray-600 dark:text-gray-300">{e.unidades_por_caja} u/caja</p>}
                                      {n === 'pallet' && e.cajas_por_pallet   && <p className="text-gray-600 dark:text-gray-300">{e.cajas_por_pallet} c/pallet</p>}
                                      <p className="text-gray-600 dark:text-gray-300">
                                        Peso: {e[`peso_${n}` as keyof ProductoEstructura]} kg
                                      </p>
                                      <p className="text-gray-600 dark:text-gray-300">
                                        {e[`alto_${n}` as keyof ProductoEstructura]}×{e[`ancho_${n}` as keyof ProductoEstructura]}×{e[`largo_${n}` as keyof ProductoEstructura]} cm
                                      </p>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          <div className="pt-1 border-t border-gray-200 dark:border-gray-600 flex items-center gap-4">
                            <Link to={`/productos/${p.id}/editar`}
                              className="flex items-center gap-1.5 text-sm text-accent hover:underline font-medium">
                              <Edit2 size={13} /> Editar producto
                            </Link>
                            {!estructuraDefault && (
                              <button
                                onClick={e => { e.stopPropagation(); setTab('estructura'); setEstrProductoId(p.id); setEstrProductoNombre(p.nombre) }}
                                className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-accent transition-colors">
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
        </>
      )}

      {/* Modal de estructura */}
      {estrModal.open && (
        <EstrModal
          editando={estrModal.editando}
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
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700">
                  <option value="">Seleccionar proveedor...</option>
                  {(proveedoresOC as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cantidad</label>
                  <input type="number" min="1" value={ocCantidad} onChange={e => setOcCantidad(e.target.value)}
                    onWheel={e => e.currentTarget.blur()}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Precio unitario <span className="text-gray-400 text-xs">(opcional)</span></label>
                  <input type="number" min="0" value={ocPrecio} onChange={e => setOcPrecio(e.target.value)}
                    placeholder="0"
                    onWheel={e => e.currentTarget.blur()}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700" />
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
    </div>
  )
}
