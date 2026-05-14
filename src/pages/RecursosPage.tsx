import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'
import { Recurso } from '@/lib/supabase'
import {
  Plus, Pencil, Trash2, Landmark, Wrench, CheckCircle,
  ShoppingBag, AlertTriangle, Search, ChevronRight,
  MapPin, RefreshCw, Check, X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { BTN } from '@/config/brand'

// ── Constantes ────────────────────────────────────────────────────────────────
const CATEGORIAS = ['Tecnología', 'Mobiliario', 'Vehículo', 'Herramienta', 'Electrodoméstico', 'Seguridad', 'Otro']
const UNIDADES_FRECUENCIA = [
  { value: 'dia',    label: 'día(s)' },
  { value: 'semana', label: 'semana(s)' },
  { value: 'mes',    label: 'mes(es)' },
  { value: 'año',    label: 'año(s)' },
]

const ESTADO_CFG: Record<Recurso['estado'], { label: string; color: string }> = {
  activo:                 { label: 'Activo',         color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  en_reparacion:         { label: 'En reparación',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  dado_de_baja:          { label: 'Dado de baja',   color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
  pendiente_adquisicion: { label: 'Pendiente',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
}

const FORM_EMPTY = {
  nombre: '', descripcion: '', categoria: 'Tecnología', estado: 'activo' as Recurso['estado'],
  valor: '', fecha_adquisicion: '', proveedor_id: '', ubicacion: '',
  numero_serie: '', garantia_hasta: '', notas: '',
  es_recurrente: false,
  frecuencia_valor: '1',
  frecuencia_unidad: 'semana' as 'dia' | 'semana' | 'mes' | 'año',
  proximo_vencimiento: '',
}

const hoy = new Date().toISOString().split('T')[0]

function calcProximo(valor: number, unidad: string): string {
  const d = new Date()
  if (unidad === 'dia') d.setDate(d.getDate() + valor)
  else if (unidad === 'semana') d.setDate(d.getDate() + valor * 7)
  else if (unidad === 'mes') d.setMonth(d.getMonth() + valor)
  else if (unidad === 'año') d.setFullYear(d.getFullYear() + valor)
  return d.toISOString().split('T')[0]
}

function labelFrecuencia(r: Recurso): string {
  if (!r.frecuencia_valor || !r.frecuencia_unidad) return ''
  const u = UNIDADES_FRECUENCIA.find(x => x.value === r.frecuencia_unidad)?.label ?? r.frecuencia_unidad
  return `Cada ${r.frecuencia_valor} ${u}`
}

function proximoAlerta(r: Recurso): 'vencido' | 'proximo' | null {
  if (!r.proximo_vencimiento) return null
  const diff = Math.ceil((new Date(r.proximo_vencimiento + 'T00:00:00').getTime() - Date.now()) / 86400000)
  if (diff < 0) return 'vencido'
  if (diff <= 7) return 'proximo'
  return null
}

// ── Componente ────────────────────────────────────────────────────────────────
export default function RecursosPage() {
  const { tenant, user } = useAuthStore()
  const { applyFilter, sucursalId } = useSucursalFilter()
  const qc               = useQueryClient()
  const navigate         = useNavigate()

  const [tab, setTab]           = useState<'patrimonio' | 'adquirir' | 'ubicaciones'>('patrimonio')
  const [search, setSearch]     = useState('')
  const [catFiltro, setCatFiltro] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [form, setForm]         = useState({ ...FORM_EMPTY })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Inline edit de ubicación en tab Ubicaciones
  const [editUbic, setEditUbic] = useState<{ id: string; valor: string } | null>(null)

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: recursos = [], isLoading } = useQuery({
    queryKey: ['recursos', tenant?.id],
    queryFn: async () => {
      const q = applyFilter(
        supabase.from('recursos')
          .select('*, proveedores(id, nombre)')
          .eq('tenant_id', tenant!.id)
          .order('nombre')
      )
      const { data, error } = await q
      if (error) throw error
      return data as Recurso[]
    },
    enabled: !!tenant?.id,
  })

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores-select', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant?.id,
  })

  // ── Stats ──────────────────────────────────────────────────────────────────
  const activos      = recursos.filter(r => r.estado === 'activo')
  const enReparacion = recursos.filter(r => r.estado === 'en_reparacion')
  const adquirir     = recursos.filter(r => r.estado === 'pendiente_adquisicion')
  const valorTotal   = activos.concat(enReparacion).reduce((s, r) => s + (r.valor ?? 0), 0)
  const presupuesto  = adquirir.reduce((s, r) => s + (r.valor ?? 0), 0)

  // Recurrentes vencidos o próximos (dentro de 7 días)
  const recurrentesAlerta = recursos.filter(r => r.es_recurrente && proximoAlerta(r) !== null).length

  // ── Filtros ────────────────────────────────────────────────────────────────
  const filtrar = (lista: Recurso[]) => lista.filter(r => {
    if (catFiltro && r.categoria !== catFiltro) return false
    if (search) {
      const s = search.toLowerCase()
      if (!r.nombre.toLowerCase().includes(s) && !(r.ubicacion ?? '').toLowerCase().includes(s) && !(r.numero_serie ?? '').toLowerCase().includes(s)) return false
    }
    return true
  })

  const listaPatrimonio = filtrar(recursos.filter(r => r.estado !== 'pendiente_adquisicion'))
  const listaAdquirir   = filtrar(adquirir)

  // Agrupar por ubicacion para tab Ubicaciones
  const recursosConUbicacion = recursos.filter(r => r.estado !== 'dado_de_baja')
  const gruposUbicacion = recursosConUbicacion.reduce<Record<string, Recurso[]>>((acc, r) => {
    const key = r.ubicacion?.trim() || '—Sin ubicación—'
    ;(acc[key] ??= []).push(r)
    return acc
  }, {})
  // Sin ubicación al final
  const gruposOrdenados = Object.entries(gruposUbicacion).sort(([a], [b]) => {
    if (a === '—Sin ubicación—') return 1
    if (b === '—Sin ubicación—') return -1
    return a.localeCompare(b)
  })

  // ── Mutations ──────────────────────────────────────────────────────────────
  const guardar = useMutation({
    mutationFn: async () => {
      const esPendiente = form.estado === 'pendiente_adquisicion'
      const fv = parseInt(form.frecuencia_valor) || 1
      const proxVenc = form.es_recurrente
        ? (form.proximo_vencimiento || calcProximo(fv, form.frecuencia_unidad))
        : null

      const payload: any = {
        tenant_id:           tenant!.id,
        nombre:              form.nombre.trim(),
        descripcion:         form.descripcion.trim() || null,
        categoria:           form.categoria,
        estado:              form.estado,
        valor:               form.valor ? parseFloat(form.valor) : null,
        fecha_adquisicion:   form.fecha_adquisicion || null,
        proveedor_id:        form.proveedor_id || null,
        ubicacion:           form.ubicacion.trim() || null,
        numero_serie:        form.numero_serie.trim() || null,
        garantia_hasta:      form.garantia_hasta || null,
        notas:               form.notas.trim() || null,
        es_recurrente:       form.es_recurrente,
        frecuencia_valor:    form.es_recurrente ? fv : null,
        frecuencia_unidad:   form.es_recurrente ? form.frecuencia_unidad : null,
        proximo_vencimiento: proxVenc,
        created_by:          user?.id,
      }
      if (editId) {
        const { error } = await supabase.from('recursos').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { data: nuevoRecurso, error } = await supabase
          .from('recursos').insert(payload).select('id').single()
        if (error) throw error

        if (!esPendiente && payload.valor) {
          await supabase.from('gastos').insert({
            tenant_id:   tenant!.id,
            recurso_id:  nuevoRecurso.id,
            descripcion: `Adquisición: ${payload.nombre}`,
            monto:       payload.valor,
            categoria:   'Recurso',
            fecha:       payload.fecha_adquisicion ?? hoy,
            sucursal_id: sucursalId ?? null,
            usuario_id:  user?.id,
            notas:       payload.descripcion ?? null,
          })
          toast('Gasto pendiente creado en Gastos → Recursos', { icon: '💼' })
        }
      }
      logActividad({ entidad: 'recurso', entidad_id: editId ?? '', accion: editId ? 'editar' : 'crear', entidad_nombre: payload.nombre })
    },
    onSuccess: () => {
      toast.success(editId ? 'Recurso actualizado' : 'Recurso agregado')
      qc.invalidateQueries({ queryKey: ['recursos'] })
      cerrarModal()
    },
    onError: (e: any) => toast.error(e.message),
  })

  const cambiarEstado = useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: Recurso['estado'] }) => {
      const { error } = await supabase.from('recursos').update({ estado }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Estado actualizado'); qc.invalidateQueries({ queryKey: ['recursos'] }) },
    onError: (e: any) => toast.error(e.message),
  })

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('recursos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Recurso eliminado'); qc.invalidateQueries({ queryKey: ['recursos'] }); setDeleteConfirm(null) },
    onError: (e: any) => toast.error(e.message),
  })

  const actualizarUbicacion = useMutation({
    mutationFn: async ({ id, ubicacion }: { id: string; ubicacion: string }) => {
      const { error } = await supabase.from('recursos').update({ ubicacion: ubicacion.trim() || null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Ubicación actualizada'); qc.invalidateQueries({ queryKey: ['recursos'] }); setEditUbic(null) },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Helpers ────────────────────────────────────────────────────────────────
  function abrirNuevo(estadoDefault: Recurso['estado'] = 'activo') {
    setEditId(null)
    setForm({ ...FORM_EMPTY, estado: estadoDefault })
    setShowModal(true)
  }

  function abrirEditar(r: Recurso) {
    setEditId(r.id)
    setForm({
      nombre:              r.nombre,
      descripcion:         r.descripcion ?? '',
      categoria:           r.categoria,
      estado:              r.estado,
      valor:               r.valor != null ? String(r.valor) : '',
      fecha_adquisicion:   r.fecha_adquisicion ?? '',
      proveedor_id:        r.proveedor_id ?? '',
      ubicacion:           r.ubicacion ?? '',
      numero_serie:        r.numero_serie ?? '',
      garantia_hasta:      r.garantia_hasta ?? '',
      notas:               r.notas ?? '',
      es_recurrente:       r.es_recurrente ?? false,
      frecuencia_valor:    r.frecuencia_valor != null ? String(r.frecuencia_valor) : '1',
      frecuencia_unidad:   r.frecuencia_unidad ?? 'semana',
      proximo_vencimiento: r.proximo_vencimiento ?? '',
    })
    setShowModal(true)
  }

  function cerrarModal() { setShowModal(false); setEditId(null); setForm({ ...FORM_EMPTY }) }

  function garantiaAlerta(r: Recurso) {
    if (!r.garantia_hasta) return null
    const diff = Math.ceil((new Date(r.garantia_hasta + 'T00:00:00').getTime() - Date.now()) / 86400000)
    if (diff < 0) return 'vencida'
    if (diff <= 30) return 'proxima'
    return null
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const tabBtn = (t: typeof tab, label: string, count?: number, badge?: number) => (
    <button onClick={() => setTab(t)}
      className={`relative px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
        ${tab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-primary'}`}>
      {label}{count !== undefined && <span className="ml-1 text-xs opacity-70">({count})</span>}
      {badge != null && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold">{badge}</span>
      )}
    </button>
  )

  const RecursoCard = ({ r }: { r: Recurso }) => {
    const ga = garantiaAlerta(r)
    const pa = r.es_recurrente ? proximoAlerta(r) : null
    return (
      <div className="flex items-start gap-3 p-3 rounded-lg border border-border-ds hover:bg-page transition-colors">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-primary">{r.nombre}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{r.categoria}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_CFG[r.estado].color}`}>{ESTADO_CFG[r.estado].label}</span>
            {r.es_recurrente && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1
                ${pa === 'vencido' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : pa === 'proximo' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'}`}>
                <RefreshCw className="w-3 h-3" />
                {labelFrecuencia(r)}
                {pa === 'vencido' && ' · ¡Vencido!'}
                {pa === 'proximo' && ' · ¡Próximo!'}
              </span>
            )}
            {ga === 'vencida'  && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Garantía vencida</span>}
            {ga === 'proxima'  && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Garantía por vencer</span>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
            {r.valor != null && <span>{r.estado === 'pendiente_adquisicion' ? 'Est. ' : ''}<span className="font-semibold text-primary">${r.valor.toLocaleString('es-AR')}</span></span>}
            {r.ubicacion && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {r.ubicacion}</span>}
            {(r as any).proveedores?.nombre && <span>🏪 {(r as any).proveedores.nombre}</span>}
            {r.numero_serie && <span>S/N: {r.numero_serie}</span>}
            {r.garantia_hasta && <span>Garantía hasta {new Date(r.garantia_hasta + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>}
            {r.fecha_adquisicion && <span>Adquirido {new Date(r.fecha_adquisicion + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>}
            {r.es_recurrente && r.proximo_vencimiento && (
              <span className={`font-medium ${pa === 'vencido' ? 'text-red-600 dark:text-red-400' : pa === 'proximo' ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                Próxima compra: {new Date(r.proximo_vencimiento + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
              </span>
            )}
          </div>
          {r.notas && <p className="text-xs text-muted italic truncate">{r.notas}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {r.estado === 'pendiente_adquisicion' && (
            <button onClick={() => cambiarEstado.mutate({ id: r.id, estado: 'activo' })}
              title="Marcar como adquirido"
              className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20">
              <CheckCircle className="w-4 h-4" />
            </button>
          )}
          {r.estado === 'activo' && (
            <button onClick={() => cambiarEstado.mutate({ id: r.id, estado: 'en_reparacion' })}
              title="Marcar en reparación"
              className="p-1.5 rounded text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20">
              <Wrench className="w-4 h-4" />
            </button>
          )}
          {r.estado === 'en_reparacion' && (
            <button onClick={() => cambiarEstado.mutate({ id: r.id, estado: 'activo' })}
              title="Marcar como activo"
              className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20">
              <CheckCircle className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => abrirEditar(r)} title="Editar" className="p-1.5 rounded text-muted hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => setDeleteConfirm(r.id)} title="Eliminar" className="p-1.5 rounded text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Landmark className="w-6 h-6 text-accent" />
          <div>
            <h1 className="text-xl font-bold text-primary">Recursos</h1>
            <p className="text-xs text-muted">Patrimonio e inventario del negocio (no para vender)</p>
          </div>
        </div>
        <button onClick={() => abrirNuevo(tab === 'adquirir' ? 'pendiente_adquisicion' : 'activo')}
          className={`${BTN.primary} ${BTN.md} flex items-center gap-2`}>
          <Plus className="w-4 h-4" /> Agregar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Activos',          value: activos.length,      sub: null },
          { label: 'Valor patrimonial',value: valorTotal > 0 ? `$${valorTotal.toLocaleString('es-AR', { minimumFractionDigits: 0 })}` : '—', sub: null },
          { label: 'En reparación',    value: enReparacion.length, sub: null },
          { label: 'Por adquirir',     value: adquirir.length,     sub: presupuesto > 0 ? `~$${presupuesto.toLocaleString('es-AR', { minimumFractionDigits: 0 })} est.` : null },
        ].map(s => (
          <div key={s.label} className="bg-surface rounded-xl p-3 shadow-sm">
            <p className="text-xs text-muted">{s.label}</p>
            <p className="text-lg font-bold text-primary">{s.value}</p>
            {s.sub && <p className="text-xs text-muted">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Tabs + filtros */}
      <div className="bg-surface rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-ds px-4 flex-wrap gap-2">
          <div className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {tabBtn('patrimonio', 'Recursos activos', listaPatrimonio.length)}
            {tabBtn('adquirir',   'Recursos pendientes', listaAdquirir.length)}
            {tabBtn('ubicaciones','Ubicaciones', undefined, recurrentesAlerta)}
          </div>
          {tab !== 'ubicaciones' && (
            <div className="flex items-center gap-2 py-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar..." className="pl-7 pr-3 py-1.5 text-xs bg-page border border-border-ds rounded-lg w-36 text-primary placeholder:text-muted" />
              </div>
              <select value={catFiltro} onChange={e => setCatFiltro(e.target.value)}
                className="text-xs bg-page border border-border-ds rounded-lg px-2 py-1.5 text-primary">
                <option value="">Todas las categorías</option>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* ── LISTA PATRIMONIO ─────────────────────────────────────────────── */}
        {tab !== 'ubicaciones' && (
          <div className="p-4 space-y-2">
            {tab === 'adquirir' && listaAdquirir.length === 0 && !isLoading && (
              <div className="text-center py-10 space-y-3">
                <ShoppingBag className="w-10 h-10 text-muted mx-auto" />
                <p className="text-muted text-sm">No hay ítems en la lista de adquisición</p>
                <button onClick={() => abrirNuevo('pendiente_adquisicion')}
                  className={`${BTN.outline} ${BTN.sm} inline-flex items-center gap-1`}>
                  <Plus className="w-3.5 h-3.5" /> Agregar ítem
                </button>
              </div>
            )}
            {tab === 'patrimonio' && listaPatrimonio.length === 0 && !isLoading && (
              <div className="text-center py-10 space-y-3">
                <Landmark className="w-10 h-10 text-muted mx-auto" />
                <p className="text-muted text-sm">Todavía no hay recursos cargados</p>
                <button onClick={() => abrirNuevo('activo')}
                  className={`${BTN.outline} ${BTN.sm} inline-flex items-center gap-1`}>
                  <Plus className="w-3.5 h-3.5" /> Agregar recurso
                </button>
              </div>
            )}

            {(tab === 'patrimonio' ? listaPatrimonio : listaAdquirir).map(r => (
              <RecursoCard key={r.id} r={r} />
            ))}

            {tab === 'adquirir' && listaAdquirir.length > 0 && (
              <button onClick={() => navigate('/proveedores')}
                className="w-full mt-2 flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-accent/50 text-accent text-sm hover:bg-accent/5 transition-colors">
                <ShoppingBag className="w-4 h-4" />
                Solicitar presupuesto a proveedor
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* ── TAB UBICACIONES ──────────────────────────────────────────────── */}
        {tab === 'ubicaciones' && (
          <div className="p-4 space-y-5">
            {recurrentesAlerta > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span><strong>{recurrentesAlerta}</strong> recurso{recurrentesAlerta > 1 ? 's' : ''} recurrente{recurrentesAlerta > 1 ? 's' : ''} con compra vencida o próxima. Revisalos en Gastos → Recursos.</span>
              </div>
            )}
            {recursosConUbicacion.length === 0 && !isLoading && (
              <div className="text-center py-10">
                <MapPin className="w-10 h-10 text-muted mx-auto mb-3" />
                <p className="text-muted text-sm">No hay recursos activos o pendientes para ubicar</p>
              </div>
            )}
            {gruposOrdenados.map(([grupo, lista]) => (
              <div key={grupo}>
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className={`w-4 h-4 ${grupo === '—Sin ubicación—' ? 'text-muted' : 'text-accent'}`} />
                  <h3 className={`text-sm font-semibold ${grupo === '—Sin ubicación—' ? 'text-muted' : 'text-primary'}`}>
                    {grupo === '—Sin ubicación—' ? 'Sin ubicación asignada' : grupo}
                  </h3>
                  <span className="text-xs text-muted">({lista.length})</span>
                </div>
                <div className="space-y-1.5 pl-6">
                  {lista.map(r => (
                    <div key={r.id} className="flex items-center gap-2 bg-page border border-border-ds rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-primary">{r.nombre}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-muted">{r.categoria}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ESTADO_CFG[r.estado].color}`}>{ESTADO_CFG[r.estado].label}</span>
                          {r.es_recurrente && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1">
                              <RefreshCw className="w-2.5 h-2.5" /> {labelFrecuencia(r)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Inline edit ubicación */}
                      {editUbic?.id === r.id ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            autoFocus
                            value={editUbic.valor}
                            onChange={e => setEditUbic({ id: r.id, valor: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === 'Enter') actualizarUbicacion.mutate({ id: r.id, ubicacion: editUbic.valor })
                              if (e.key === 'Escape') setEditUbic(null)
                            }}
                            placeholder="Ej: Depósito, Oficina..."
                            className="text-xs border border-border-ds rounded px-2 py-1 bg-surface text-primary w-32 focus:outline-none focus:border-accent"
                          />
                          <button onClick={() => actualizarUbicacion.mutate({ id: r.id, ubicacion: editUbic.valor })}
                            className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setEditUbic(null)} className="p-1 text-muted hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setEditUbic({ id: r.id, valor: r.ubicacion ?? '' })}
                          title="Editar ubicación"
                          className="shrink-0 p-1.5 rounded text-muted hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm delete */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <p className="font-semibold text-primary">¿Eliminar este recurso?</p>
            <p className="text-sm text-muted">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className={`${BTN.secondary} ${BTN.sm}`}>Cancelar</button>
              <button onClick={() => eliminar.mutate(deleteConfirm)} className={`${BTN.danger} ${BTN.sm}`}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal crear/editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border-ds">
              <h2 className="font-semibold text-primary">{editId ? 'Editar recurso' : 'Nuevo recurso'}</h2>
              <button onClick={cerrarModal} className="text-muted hover:text-primary">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {/* Nombre */}
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Nombre *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary"
                  placeholder="ej. Notebook Dell, Jabón de tocador..." />
              </div>
              {/* Categoría + Estado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Categoría *</label>
                  <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary">
                    {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Estado *</label>
                  <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value as Recurso['estado'] }))}
                    className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary">
                    {Object.entries(ESTADO_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              {/* Valor */}
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">
                  {form.estado === 'pendiente_adquisicion' ? 'Presupuesto estimado ($)' : 'Valor de compra ($)'}
                </label>
                <input type="number" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                  onWheel={e => e.currentTarget.blur()}
                  className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary"
                  placeholder="0" min={0} />
              </div>
              {/* Proveedor */}
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Proveedor</label>
                <select value={form.proveedor_id} onChange={e => setForm(f => ({ ...f, proveedor_id: e.target.value }))}
                  className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary">
                  <option value="">Sin proveedor</option>
                  {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              {form.estado !== 'pendiente_adquisicion' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted mb-1 block">Fecha de adquisición</label>
                    <input type="date" value={form.fecha_adquisicion} onChange={e => setForm(f => ({ ...f, fecha_adquisicion: e.target.value }))}
                      max={hoy} className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted mb-1 block">Garantía hasta</label>
                    <input type="date" value={form.garantia_hasta} onChange={e => setForm(f => ({ ...f, garantia_hasta: e.target.value }))}
                      className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary" />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Ubicación</label>
                  <input value={form.ubicacion} onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))}
                    className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary"
                    placeholder="ej. Depósito, Oficina..." />
                </div>
                {form.estado !== 'pendiente_adquisicion' && (
                  <div>
                    <label className="text-xs font-medium text-muted mb-1 block">Número de serie</label>
                    <input value={form.numero_serie} onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))}
                      className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary"
                      placeholder="S/N..." />
                  </div>
                )}
              </div>

              {/* ── Sección Recurrencia ─────────────────────────────────── */}
              <div className="border border-border-ds rounded-xl p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={form.es_recurrente}
                    onChange={e => setForm(f => ({ ...f, es_recurrente: e.target.checked }))}
                    className="w-4 h-4 accent-violet-600 rounded" />
                  <div>
                    <span className="text-sm font-medium text-primary flex items-center gap-1">
                      <RefreshCw className="w-3.5 h-3.5 text-violet-500" /> Recurso recurrente
                    </span>
                    <p className="text-xs text-muted">Se comprará o renueva periódicamente (jabón, café, papel, etc.)</p>
                  </div>
                </label>
                {form.es_recurrente && (
                  <div className="space-y-2 pl-6">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted whitespace-nowrap">Frecuencia</label>
                      <input type="number" min={1} max={999}
                        value={form.frecuencia_valor}
                        onChange={e => setForm(f => ({ ...f, frecuencia_valor: e.target.value }))}
                        onWheel={e => e.currentTarget.blur()}
                        className="w-16 border border-border-ds rounded-lg px-2 py-1.5 text-sm bg-page text-primary text-center" />
                      <select value={form.frecuencia_unidad}
                        onChange={e => setForm(f => ({ ...f, frecuencia_unidad: e.target.value as typeof form.frecuencia_unidad }))}
                        className="flex-1 border border-border-ds rounded-lg px-2 py-1.5 text-sm bg-page text-primary">
                        {UNIDADES_FRECUENCIA.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted mb-1 block">Próxima compra (se calcula automáticamente si dejás vacío)</label>
                      <input type="date" value={form.proximo_vencimiento}
                        onChange={e => setForm(f => ({ ...f, proximo_vencimiento: e.target.value }))}
                        className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary" />
                    </div>
                    {!form.proximo_vencimiento && form.frecuencia_valor && (
                      <p className="text-xs text-muted italic">
                        Se calculará como hoy + {form.frecuencia_valor} {UNIDADES_FRECUENCIA.find(u => u.value === form.frecuencia_unidad)?.label}
                        {' '}= <span className="font-medium text-primary">{new Date(calcProximo(parseInt(form.frecuencia_valor) || 1, form.frecuencia_unidad) + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Descripción / Notas</label>
                <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  rows={2} className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary resize-none"
                  placeholder="Observaciones..." />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border-ds">
              <button onClick={cerrarModal} className={`${BTN.secondary} ${BTN.sm}`}>Cancelar</button>
              <button onClick={() => guardar.mutate()} disabled={!form.nombre.trim() || guardar.isPending}
                className={`${BTN.primary} ${BTN.sm}`}>
                {guardar.isPending ? 'Guardando...' : editId ? 'Guardar' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
