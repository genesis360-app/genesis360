import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Receipt, TrendingDown, Calendar, Filter, X,
  ChevronDown, Paperclip, ExternalLink, Repeat, Play, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { logActividad } from '@/lib/actividadLog'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import toast from 'react-hot-toast'

const CATEGORIAS_GASTO = [
  'Alquiler', 'Servicios (luz/gas/agua/internet)',
  'Compras de mercadería', 'Transporte y logística', 'Mantenimiento y reparaciones',
  'Marketing y publicidad', 'Impuestos y tasas', 'Seguros', 'Insumos y descartables',
  'Honorarios profesionales', 'Otro',
]
const MEDIOS_PAGO = ['Efectivo', 'Tarjeta débito', 'Tarjeta crédito', 'Transferencia', 'Mercado Pago', 'Otro']
const FRECUENCIAS = [
  { value: 'mensual', label: 'Mensual' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'semanal', label: 'Semanal' },
]

interface FormGasto {
  descripcion: string; monto: string; iva_monto: string
  categoria: string; medio_pago: string; fecha: string; notas: string
}
interface FormFijo {
  descripcion: string; monto: string; iva_monto: string
  categoria: string; medio_pago: string; frecuencia: string
  dia_vencimiento: string; notas: string; activo: boolean
}

const FORM_VACIO: FormGasto = {
  descripcion: '', monto: '', iva_monto: '', categoria: '', medio_pago: '',
  fecha: new Date().toISOString().split('T')[0], notas: '',
}
const FORM_FIJO_VACIO: FormFijo = {
  descripcion: '', monto: '', iva_monto: '', categoria: '', medio_pago: '',
  frecuencia: 'mensual', dia_vencimiento: '', notas: '', activo: true,
}

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function formatFecha(f: string) {
  return new Date(f + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function GastosPage() {
  const { tenant, user } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'gastos' | 'fijos'>('gastos')

  // ── Gastos variables — state ─────────────────────────────────────────────
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState<FormGasto>(FORM_VACIO)
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null)
  const [comprobanteExistente, setComprobanteExistente] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [cajaSeleccionadaId, setCajaSeleccionadaId] = useState<string | null>(null)

  // ── Gastos fijos — state ─────────────────────────────────────────────────
  const [modalFijoAbierto, setModalFijoAbierto] = useState(false)
  const [editandoFijoId, setEditandoFijoId] = useState<string | null>(null)
  const [formFijo, setFormFijo] = useState<FormFijo>(FORM_FIJO_VACIO)
  const [guardandoFijo, setGuardandoFijo] = useState(false)
  const [generandoMes, setGenerandoMes] = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: sesionesAbiertas = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, caja_id, cajas(nombre)').eq('tenant_id', tenant!.id).eq('estado', 'abierta')
      return data ?? []
    },
    enabled: !!tenant, refetchInterval: 60_000,
  })
  const sesionCajaId = cajaSeleccionadaId ?? (sesionesAbiertas.length === 1 ? (sesionesAbiertas[0] as any).id : null)

  const { data: gastos = [], isLoading } = useQuery({
    queryKey: ['gastos', tenant?.id, fechaDesde, fechaHasta, sucursalId],
    queryFn: async () => {
      let q = supabase.from('gastos').select('*').eq('tenant_id', tenant!.id)
        .gte('fecha', fechaDesde).lte('fecha', fechaHasta)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false })
      q = applyFilter(q)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: gastosFijos = [], isLoading: loadingFijos } = useQuery({
    queryKey: ['gastos-fijos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('gastos_fijos').select('*')
        .eq('tenant_id', tenant!.id).order('descripcion')
      return data ?? []
    },
    enabled: !!tenant && tab === 'fijos',
  })

  // ── Stats ────────────────────────────────────────────────────────────────
  const gastosFiltrados = filtroCategoria
    ? gastos.filter((g: any) => g.categoria === filtroCategoria)
    : gastos
  const totalPeriodo = gastosFiltrados.reduce((a: number, g: any) => a + Number(g.monto), 0)
  const totalIVA = gastosFiltrados.reduce((a: number, g: any) => a + Number(g.iva_monto ?? 0), 0)
  const cantPeriodo = gastosFiltrados.length
  const mayorGasto = gastosFiltrados.reduce((max: any, g: any) =>
    (!max || Number(g.monto) > Number(max.monto)) ? g : max, null)
  const categoriasTotales: Record<string, number> = {}
  gastosFiltrados.forEach((g: any) => {
    const cat = g.categoria || 'Sin categoría'
    categoriasTotales[cat] = (categoriasTotales[cat] || 0) + Number(g.monto)
  })
  const categoriasOrdenadas = Object.entries(categoriasTotales).sort((a, b) => b[1] - a[1])
  const categoriasUnicas = [...new Set(gastos.map((g: any) => g.categoria).filter(Boolean))] as string[]

  // ── Modales helpers ──────────────────────────────────────────────────────
  const abrirNuevo = () => {
    setEditandoId(null); setForm(FORM_VACIO)
    setComprobanteFile(null); setComprobanteExistente(null)
    setModalAbierto(true)
  }
  const abrirEdicion = (g: any) => {
    setEditandoId(g.id)
    setForm({
      descripcion: g.descripcion, monto: String(g.monto),
      iva_monto: g.iva_monto ? String(g.iva_monto) : '',
      categoria: g.categoria ?? '', medio_pago: g.medio_pago ?? '',
      fecha: g.fecha, notas: g.notas ?? '',
    })
    setComprobanteFile(null); setComprobanteExistente(g.comprobante_url ?? null)
    setModalAbierto(true)
  }
  const cerrarModal = () => {
    setModalAbierto(false); setEditandoId(null); setForm(FORM_VACIO)
    setComprobanteFile(null); setComprobanteExistente(null); setCajaSeleccionadaId(null)
  }
  useModalKeyboard({ isOpen: modalAbierto, onClose: cerrarModal, onConfirm: () => { if (!guardando) guardar() } })

  const abrirNuevoFijo = () => {
    setEditandoFijoId(null); setFormFijo(FORM_FIJO_VACIO); setModalFijoAbierto(true)
  }
  const abrirEdicionFijo = (f: any) => {
    setEditandoFijoId(f.id)
    setFormFijo({
      descripcion: f.descripcion, monto: String(f.monto),
      iva_monto: f.iva_monto ? String(f.iva_monto) : '',
      categoria: f.categoria ?? '', medio_pago: f.medio_pago ?? '',
      frecuencia: f.frecuencia, dia_vencimiento: f.dia_vencimiento ? String(f.dia_vencimiento) : '',
      notas: f.notas ?? '', activo: f.activo,
    })
    setModalFijoAbierto(true)
  }
  const cerrarModalFijo = () => { setModalFijoAbierto(false); setEditandoFijoId(null); setFormFijo(FORM_FIJO_VACIO) }
  useModalKeyboard({ isOpen: modalFijoAbierto, onClose: cerrarModalFijo, onConfirm: () => { if (!guardandoFijo) guardarFijo() } })

  // ── Ver comprobante ──────────────────────────────────────────────────────
  const verComprobante = async (path: string) => {
    const { data } = await supabase.storage.from('comprobantes-gastos').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('No se pudo abrir el comprobante')
  }

  // ── Guardar gasto ────────────────────────────────────────────────────────
  const guardar = async () => {
    if (!form.descripcion.trim()) { toast.error('La descripción es requerida'); return }
    const monto = parseFloat(form.monto.replace(',', '.'))
    if (!monto || monto <= 0) { toast.error('Ingresá un monto válido'); return }
    if (!editandoId && form.medio_pago === 'Efectivo' && !sesionCajaId) {
      toast.error('No hay caja abierta. Abrí una caja antes de registrar gastos en efectivo.'); return
    }
    setGuardando(true)
    try {
      const ivaMonto = form.iva_monto ? parseFloat(form.iva_monto.replace(',', '.')) : null
      let comprobanteUrl = comprobanteExistente ?? null

      const payload: any = {
        tenant_id: tenant!.id,
        descripcion: form.descripcion.trim(), monto,
        iva_monto: ivaMonto && ivaMonto > 0 ? ivaMonto : null,
        categoria: form.categoria || null, medio_pago: form.medio_pago || null,
        fecha: form.fecha, notas: form.notas.trim() || null,
        sucursal_id: sucursalId || null,
      }

      let gastoId = editandoId
      if (editandoId) {
        payload.comprobante_url = comprobanteUrl
        const { error } = await supabase.from('gastos').update(payload).eq('id', editandoId)
        if (error) throw error
        toast.success('Gasto actualizado')
        logActividad({ entidad: 'gasto', entidad_id: editandoId, entidad_nombre: form.descripcion.trim(), accion: 'editar', pagina: '/gastos' })
      } else {
        const { data: inserted, error } = await supabase.from('gastos').insert(payload).select('id').single()
        if (error) throw error
        gastoId = inserted.id
        toast.success('Gasto registrado')
        logActividad({ entidad: 'gasto', entidad_nombre: form.descripcion.trim(), accion: 'crear', valor_nuevo: `$${monto}`, pagina: '/gastos' })
        if (sesionCajaId) {
          if (form.medio_pago === 'Efectivo') {
            void supabase.from('caja_movimientos').insert({
              tenant_id: tenant!.id, sesion_id: sesionCajaId, tipo: 'egreso',
              concepto: `Gasto: ${form.descripcion.trim()}`, monto, usuario_id: user?.id,
            }).then(() => qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] }))
          } else if (form.medio_pago) {
            void supabase.from('caja_movimientos').insert({
              tenant_id: tenant!.id, sesion_id: sesionCajaId, tipo: 'egreso_informativo',
              concepto: `[${form.medio_pago}] Gasto: ${form.descripcion.trim()}`, monto, usuario_id: user?.id,
            })
          }
        }
      }

      // Subir comprobante si hay archivo nuevo
      if (comprobanteFile && gastoId) {
        const ext = comprobanteFile.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        const path = `${tenant!.id}/${gastoId}.${ext}`
        const { error: upErr } = await supabase.storage.from('comprobantes-gastos').upload(path, comprobanteFile, { upsert: true })
        if (!upErr) {
          await supabase.from('gastos').update({ comprobante_url: path }).eq('id', gastoId)
        }
      }

      qc.invalidateQueries({ queryKey: ['gastos'] })
      cerrarModal()
    } catch (e: any) {
      toast.error(e.message ?? 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  // ── Eliminar gasto ───────────────────────────────────────────────────────
  const eliminar = async (id: string) => {
    if (!confirm('¿Eliminar este gasto?')) return
    const g = (gastos as any[]).find(x => x.id === id)
    if (g?.comprobante_url) {
      void supabase.storage.from('comprobantes-gastos').remove([g.comprobante_url])
    }
    const { error } = await supabase.from('gastos').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    qc.invalidateQueries({ queryKey: ['gastos'] })
    toast.success('Gasto eliminado')
    logActividad({ entidad: 'gasto', entidad_id: id, entidad_nombre: g?.descripcion, accion: 'eliminar', pagina: '/gastos' })
  }

  // ── Guardar gasto fijo ───────────────────────────────────────────────────
  const guardarFijo = async () => {
    if (!formFijo.descripcion.trim()) { toast.error('La descripción es requerida'); return }
    const monto = parseFloat(formFijo.monto.replace(',', '.'))
    if (!monto || monto <= 0) { toast.error('Ingresá un monto válido'); return }
    setGuardandoFijo(true)
    try {
      const payload: any = {
        tenant_id: tenant!.id,
        descripcion: formFijo.descripcion.trim(), monto,
        iva_monto: formFijo.iva_monto ? parseFloat(formFijo.iva_monto) || null : null,
        categoria: formFijo.categoria || null, medio_pago: formFijo.medio_pago || null,
        frecuencia: formFijo.frecuencia,
        dia_vencimiento: formFijo.dia_vencimiento ? parseInt(formFijo.dia_vencimiento) : null,
        notas: formFijo.notas.trim() || null, activo: formFijo.activo,
        sucursal_id: sucursalId || null,
      }
      if (editandoFijoId) {
        const { error } = await supabase.from('gastos_fijos').update(payload).eq('id', editandoFijoId)
        if (error) throw error
        toast.success('Gasto fijo actualizado')
      } else {
        const { error } = await supabase.from('gastos_fijos').insert(payload)
        if (error) throw error
        toast.success('Gasto fijo creado')
      }
      qc.invalidateQueries({ queryKey: ['gastos-fijos'] })
      cerrarModalFijo()
    } catch (e: any) {
      toast.error(e.message ?? 'Error al guardar')
    } finally {
      setGuardandoFijo(false)
    }
  }

  const eliminarFijo = async (id: string) => {
    if (!confirm('¿Eliminar este gasto fijo?')) return
    const { error } = await supabase.from('gastos_fijos').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    qc.invalidateQueries({ queryKey: ['gastos-fijos'] })
    toast.success('Gasto fijo eliminado')
  }

  const toggleActivoFijo = async (id: string, activo: boolean) => {
    await supabase.from('gastos_fijos').update({ activo: !activo }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['gastos-fijos'] })
  }

  // ── Generar gastos del mes desde fijos ──────────────────────────────────
  const generarMes = async () => {
    const activos = (gastosFijos as any[]).filter(f => f.activo)
    if (activos.length === 0) { toast.error('No hay gastos fijos activos'); return }
    setGenerandoMes(true)
    try {
      const hoy = new Date()
      const fecha = hoy.toISOString().split('T')[0]
      const inserts = activos.map((f: any) => ({
        tenant_id: tenant!.id, descripcion: f.descripcion, monto: f.monto,
        iva_monto: f.iva_monto ?? null, categoria: f.categoria ?? null,
        medio_pago: f.medio_pago ?? null, fecha,
        notas: `Generado desde gasto fijo — ${f.frecuencia}`,
        sucursal_id: f.sucursal_id ?? null,
      }))
      const { error } = await supabase.from('gastos').insert(inserts)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['gastos'] })
      toast.success(`${activos.length} gasto${activos.length !== 1 ? 's' : ''} generado${activos.length !== 1 ? 's' : ''} para hoy`)
    } catch (e: any) {
      toast.error(e.message ?? 'Error al generar')
    } finally {
      setGenerandoMes(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Gastos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            {tab === 'gastos' ? 'Registrá los egresos de tu negocio' : 'Gastos recurrentes automáticos'}
          </p>
        </div>
        {tab === 'gastos' ? (
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
            <Plus size={18} /> Nuevo gasto
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={generarMes} disabled={generandoMes}
              className="flex items-center gap-2 border-2 border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all disabled:opacity-50">
              <Play size={15} /> {generandoMes ? 'Generando...' : 'Generar hoy'}
            </button>
            <button onClick={abrirNuevoFijo}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
              <Plus size={18} /> Nuevo fijo
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'gastos' as const, label: 'Gastos variables', icon: <Receipt size={14} /> },
          { id: 'fijos' as const, label: 'Gastos fijos', icon: <Repeat size={14} /> },
        ].map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════ TAB: GASTOS VARIABLES ══════════════════ */}
      {tab === 'gastos' && (
        <>
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm">
              <Calendar size={15} className="text-gray-400" />
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                className="outline-none text-gray-700 dark:text-gray-300 bg-transparent" />
              <span className="text-gray-400">→</span>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                className="outline-none text-gray-700 dark:text-gray-300 bg-transparent" />
            </div>
            {categoriasUnicas.length > 0 && (
              <div className="relative">
                <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
                  className="appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-8 py-2 text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent cursor-pointer">
                  <option value="">Todas las categorías</option>
                  {categoriasUnicas.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            )}
            {filtroCategoria && (
              <button onClick={() => setFiltroCategoria('')}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                <X size={14} /> Limpiar
              </button>
            )}
          </div>

          {/* Stats */}
          <div className="grid sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                  <TrendingDown size={18} className="text-red-500" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total período</p>
              </div>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(totalPeriodo)}</p>
              <p className="text-xs text-gray-400 mt-1">{cantPeriodo} gasto{cantPeriodo !== 1 ? 's' : ''}</p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <Receipt size={18} className="text-blue-500" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">IVA deducible</p>
              </div>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {totalIVA > 0 ? formatMoneda(totalIVA) : <span className="text-gray-300 dark:text-gray-600">—</span>}
              </p>
              {totalIVA > 0 && totalPeriodo > 0 && (
                <p className="text-xs text-gray-400 mt-1">{((totalIVA / totalPeriodo) * 100).toFixed(1)}% del total</p>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-amber-900/20 flex items-center justify-center">
                  <TrendingDown size={18} className="text-orange-500" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Mayor gasto</p>
              </div>
              {mayorGasto ? (
                <>
                  <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(Number(mayorGasto.monto))}</p>
                  <p className="text-xs text-gray-400 mt-1 truncate">{mayorGasto.descripcion}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-gray-300 dark:text-gray-600">—</p>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                  <Filter size={18} className="text-accent" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Mayor categoría</p>
              </div>
              {categoriasOrdenadas.length > 0 ? (
                <>
                  <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(categoriasOrdenadas[0][1])}</p>
                  <p className="text-xs text-gray-400 mt-1 truncate">{categoriasOrdenadas[0][0]}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-gray-300 dark:text-gray-600">—</p>
              )}
            </div>
          </div>

          {/* Desglose por categoría */}
          {categoriasOrdenadas.length > 1 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 text-sm">Por categoría</h2>
              <div className="space-y-3">
                {categoriasOrdenadas.map(([cat, total]) => {
                  const pct = totalPeriodo > 0 ? (total / totalPeriodo) * 100 : 0
                  return (
                    <div key={cat}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700 dark:text-gray-300 truncate max-w-xs">{cat}</span>
                        <span className="font-medium text-gray-800 dark:text-gray-100 ml-2">{formatMoneda(total)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-accent/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Lista */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
              </div>
            ) : gastosFiltrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-gray-400">
                <Receipt size={36} className="mb-3 opacity-30" />
                <p className="font-medium text-sm">No hay gastos en este período</p>
                <button onClick={abrirNuevo} className="mt-3 text-accent text-sm font-medium hover:underline">
                  Registrar el primero
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Fecha</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Descripción</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Categoría</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Medio</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Monto</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden md:table-cell">IVA</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {gastosFiltrados.map((g: any) => (
                      <tr key={g.id} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatFecha(g.fecha)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-gray-800 dark:text-gray-100">{g.descripcion}</p>
                            {g.comprobante_url && (
                              <button onClick={() => verComprobante(g.comprobante_url)}
                                title="Ver comprobante" className="text-blue-400 hover:text-blue-600 transition-colors">
                                <Paperclip size={13} />
                              </button>
                            )}
                          </div>
                          {g.notas && <p className="text-xs text-gray-400 mt-0.5">{g.notas}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {g.categoria ? (
                            <span className="inline-block px-2 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-accent text-xs rounded-lg font-medium">
                              {g.categoria}
                            </span>
                          ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">{g.medio_pago ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400">{formatMoneda(Number(g.monto))}</td>
                        <td className="px-4 py-3 text-right text-xs text-blue-500 dark:text-blue-400 hidden md:table-cell">
                          {g.iva_monto > 0 ? formatMoneda(Number(g.iva_monto)) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => abrirEdicion(g)}
                              className="p-1.5 text-gray-400 hover:text-accent hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => eliminar(g.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">Total</td>
                      <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">{formatMoneda(totalPeriodo)}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-500 dark:text-blue-400 hidden md:table-cell">
                        {totalIVA > 0 ? formatMoneda(totalIVA) : '—'}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════════════════ TAB: GASTOS FIJOS ══════════════════════ */}
      {tab === 'fijos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          {loadingFijos ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
            </div>
          ) : (gastosFijos as any[]).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-gray-400">
              <Repeat size={36} className="mb-3 opacity-30" />
              <p className="font-medium text-sm">No hay gastos fijos configurados</p>
              <button onClick={abrirNuevoFijo} className="mt-3 text-accent text-sm font-medium hover:underline">
                Crear el primero
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Descripción</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden sm:table-cell">Categoría</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Frecuencia</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Monto</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Activo</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {(gastosFijos as any[]).map((f: any) => (
                    <tr key={f.id} className={`border-b border-gray-50 dark:border-gray-700 transition-colors ${f.activo ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50' : 'opacity-50'}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800 dark:text-gray-100">{f.descripcion}</p>
                        {f.dia_vencimiento && <p className="text-xs text-gray-400">Día {f.dia_vencimiento} de cada mes</p>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {f.categoria ? (
                          <span className="inline-block px-2 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-accent text-xs rounded-lg font-medium">{f.categoria}</span>
                        ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">{f.frecuencia}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400">{formatMoneda(Number(f.monto))}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleActivoFijo(f.id, f.activo)} title={f.activo ? 'Desactivar' : 'Activar'}>
                          {f.activo
                            ? <ToggleRight size={22} className="text-green-500" />
                            : <ToggleLeft size={22} className="text-gray-400" />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => abrirEdicionFijo(f)}
                            className="p-1.5 text-gray-400 hover:text-accent hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => eliminarFijo(f.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
                      Total mensual estimado
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">
                      {formatMoneda((gastosFijos as any[]).filter(f => f.activo && f.frecuencia === 'mensual').reduce((a: number, f: any) => a + Number(f.monto), 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ MODAL: NUEVO / EDITAR GASTO ════════════════════ */}
      {modalAbierto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editandoId ? 'Editar gasto' : 'Nuevo gasto'}</h2>
              <button onClick={cerrarModal} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción *</label>
                <input type="text" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: Pago de alquiler enero" autoFocus
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto ($) *</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={form.monto}
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                    placeholder="0" min="0" step="0.01"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IVA deducible ($)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={form.iva_monto}
                    onChange={e => setForm(f => ({ ...f, iva_monto: e.target.value }))}
                    placeholder="0" min="0" step="0.01"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha</label>
                <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría</label>
                <div className="relative">
                  <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="">Sin categoría</option>
                    {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Medio de pago</label>
                <div className="relative">
                  <select value={form.medio_pago} onChange={e => setForm(f => ({ ...f, medio_pago: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="">Elegir método…</option>
                    {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Comprobante */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comprobante (foto / PDF)</label>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden" onChange={e => setComprobanteFile(e.target.files?.[0] ?? null)} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <Paperclip size={14} />
                    {comprobanteFile ? comprobanteFile.name : comprobanteExistente ? 'Reemplazar archivo' : 'Adjuntar archivo'}
                  </button>
                  {comprobanteExistente && !comprobanteFile && (
                    <button type="button" onClick={() => verComprobante(comprobanteExistente)}
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors">
                      <ExternalLink size={12} /> Ver actual
                    </button>
                  )}
                  {(comprobanteFile || comprobanteExistente) && (
                    <button type="button" onClick={() => { setComprobanteFile(null); setComprobanteExistente(null) }}
                      className="text-gray-400 hover:text-red-500 transition-colors">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
                <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Detalles adicionales..." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>

            {!editandoId && form.medio_pago === 'Efectivo' && (
              <div className="px-5 pb-3">
                {sesionesAbiertas.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5">
                    <span>⚠️</span><span>Sin caja abierta — el egreso no se registrará en caja</span>
                  </div>
                ) : sesionesAbiertas.length > 1 ? (
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Registrar egreso en caja:</label>
                    <select value={cajaSeleccionadaId ?? ''} onChange={e => setCajaSeleccionadaId(e.target.value || null)}
                      className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700">
                      <option value="">— Seleccioná una caja —</option>
                      {(sesionesAbiertas as any[]).map(s => (
                        <option key={s.id} value={s.id}>{(s as any).cajas?.nombre ?? 'Caja'}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg px-3 py-2.5">
                    <span>✓</span><span>Egreso en efectivo → {(sesionesAbiertas[0] as any).cajas?.nombre ?? 'Caja'}</span>
                  </div>
                )}
              </div>
            )}

            <div className="px-5 pb-5 flex gap-3 flex-shrink-0">
              <button onClick={cerrarModal}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Registrar gasto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ MODAL: NUEVO / EDITAR GASTO FIJO ═══════════════ */}
      {modalFijoAbierto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editandoFijoId ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}</h2>
              <button onClick={cerrarModalFijo} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción *</label>
                <input type="text" value={formFijo.descripcion} onChange={e => setFormFijo(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: Alquiler local" autoFocus
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto ($) *</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={formFijo.monto}
                    onChange={e => setFormFijo(f => ({ ...f, monto: e.target.value }))}
                    placeholder="0" min="0" step="0.01"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IVA deducible ($)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={formFijo.iva_monto}
                    onChange={e => setFormFijo(f => ({ ...f, iva_monto: e.target.value }))}
                    placeholder="0" min="0" step="0.01"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Frecuencia</label>
                  <div className="relative">
                    <select value={formFijo.frecuencia} onChange={e => setFormFijo(f => ({ ...f, frecuencia: e.target.value }))}
                      className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                      {FRECUENCIAS.map(fr => <option key={fr.value} value={fr.value}>{fr.label}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Día del mes</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={formFijo.dia_vencimiento}
                    onChange={e => setFormFijo(f => ({ ...f, dia_vencimiento: e.target.value }))}
                    placeholder="Ej: 10" min="1" max="31"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría</label>
                <div className="relative">
                  <select value={formFijo.categoria} onChange={e => setFormFijo(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="">Sin categoría</option>
                    {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Medio de pago</label>
                <div className="relative">
                  <select value={formFijo.medio_pago} onChange={e => setFormFijo(f => ({ ...f, medio_pago: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="">Elegir método…</option>
                    {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
                <textarea value={formFijo.notas} onChange={e => setFormFijo(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Detalles adicionales..." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setFormFijo(f => ({ ...f, activo: !f.activo }))}
                  className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  {formFijo.activo
                    ? <ToggleRight size={22} className="text-green-500" />
                    : <ToggleLeft size={22} className="text-gray-400" />}
                  {formFijo.activo ? 'Activo' : 'Inactivo'}
                </button>
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-3 flex-shrink-0">
              <button onClick={cerrarModalFijo}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={guardarFijo} disabled={guardandoFijo}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {guardandoFijo ? 'Guardando...' : editandoFijoId ? 'Guardar cambios' : 'Crear gasto fijo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
