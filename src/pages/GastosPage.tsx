import { useRef, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Receipt, TrendingDown, Calendar, Filter, X,
  ChevronDown, ChevronUp, Paperclip, ExternalLink, Repeat, ToggleLeft, ToggleRight,
  Info, ChevronRight, User, Bell, History, ShoppingCart, AlertCircle,
  Clock, CheckCircle, CreditCard, DollarSign, Landmark,
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

const TIPOS_COMPROBANTE = [
  'Factura A', 'Nota de Crédito A', 'Nota de Débito A',
  'Factura B', 'Factura C', 'Factura de Importación',
  'Ticket / Factura de Servicios', 'Ticket', 'Factura',
  'Recibo Profesional (Recibo C)', 'Comprobante de bienes usados',
]

const TASAS_IVA = [
  { value: '21',    label: '21%' },
  { value: '10.5',  label: '10,5%' },
  { value: 'exento',label: 'Exento' },
  { value: 'sin_iva',label: 'Sin IVA' },
]

const MEDIOS_PAGO = ['Efectivo', 'Tarjeta débito', 'Tarjeta crédito', 'Transferencia', 'Mercado Pago', 'Otro']

interface MedioPagoItem { tipo: string; monto: string }

function formatMediosPago(raw: string | null | undefined): string {
  if (!raw) return '—'
  try {
    const arr = JSON.parse(raw) as { tipo: string; monto: number }[]
    if (Array.isArray(arr) && arr.length > 0)
      return arr.map(m => `${m.tipo} $${Number(m.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`).join(' + ')
  } catch {}
  return raw
}
const FRECUENCIAS = [
  { value: 'mensual',   label: 'Mensual' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'semanal',   label: 'Semanal' },
]

function calcularIVA(monto: number, tipoIva: string): number {
  if (tipoIva === '21')   return monto - monto / 1.21
  if (tipoIva === '10.5') return monto - monto / 1.105
  return 0
}

interface FormGasto {
  descripcion: string; monto: string
  tipo_iva: string; iva_deducible: boolean
  deduce_ganancias: boolean; gasto_negocio: string
  categoria: string; fecha: string; notas: string
}
interface FormFijo {
  descripcion: string; monto: string
  tipo_iva: string; iva_deducible: boolean
  deduce_ganancias: boolean; gasto_negocio: string
  categoria: string; medio_pago: string
  frecuencia: string; dia_vencimiento: string; alerta_dias_antes: string
  notas: string; activo: boolean
}

const FORM_VACIO: FormGasto = {
  descripcion: '', monto: '', tipo_iva: '', iva_deducible: false,
  deduce_ganancias: false, gasto_negocio: '',
  categoria: '', fecha: new Date().toISOString().split('T')[0], notas: '',
}
const FORM_FIJO_VACIO: FormFijo = {
  descripcion: '', monto: '', tipo_iva: '', iva_deducible: false,
  deduce_ganancias: false, gasto_negocio: '',
  categoria: '', medio_pago: '', frecuencia: 'mensual',
  dia_vencimiento: '', alerta_dias_antes: '3', notas: '', activo: true,
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
  const puedeAdministrarCaja = ['OWNER', 'SUPERVISOR', 'SUPER_USUARIO'].includes(user?.rol ?? '')
  const esCajero = user?.rol === 'CAJERO'
  const esSoloFijos = !['OWNER', 'SUPERVISOR', 'SUPER_USUARIO'].includes(user?.rol ?? '')

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'gastos' | 'historial' | 'fijos' | 'oc' | 'recursos'>('gastos')

  // Cuotas state (para gastos con tarjeta de crédito)
  const [esCuota, setEsCuota] = useState(false)
  const [cuotasTotal, setCuotasTotal] = useState('12')
  const [tasaInteres, setTasaInteres] = useState('0')

  // ── Gastos variables — state ─────────────────────────────────────────────
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState<FormGasto>(FORM_VACIO)
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null)
  const [comprobanteExistente, setComprobanteExistente] = useState<string | null>(null)
  const [comprobanteNombre, setComprobanteNombre] = useState('')
  const [tipoComprobanteSelect, setTipoComprobanteSelect] = useState('')
  const [usarPrefixCategoria, setUsarPrefixCategoria] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [cajaSeleccionadaId, setCajaSeleccionadaId] = useState<string | null>(null)
  const [filtroCategoria, setFiltroCategoria] = useState('')

  // ── Historial — state ────────────────────────────────────────────────────
  const [histFechaDesde, setHistFechaDesde] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().split('T')[0]
  })
  const [histFechaHasta, setHistFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [histCategoria, setHistCategoria] = useState('')
  const [histMontoOp, setHistMontoOp] = useState('')
  const [histMontoVal, setHistMontoVal] = useState('')
  const [gastoExpandidoId, setGastoExpandidoId] = useState<string | null>(null)

  // ── Gastos fijos — state ─────────────────────────────────────────────────
  const [modalFijoAbierto, setModalFijoAbierto] = useState(false)
  const [editandoFijoId, setEditandoFijoId] = useState<string | null>(null)
  const [formFijo, setFormFijo] = useState<FormFijo>(FORM_FIJO_VACIO)
  const [guardandoFijo, setGuardandoFijo] = useState(false)
  const [modalGenerarFijo, setModalGenerarFijo] = useState<any | null>(null)
  const [formGenerar, setFormGenerar] = useState<{ fecha: string; notas: string }>({
    fecha: new Date().toISOString().split('T')[0], notas: '',
  })
  const [mediosPagoGenerar, setMediosPagoGenerar] = useState<MedioPagoItem[]>([{ tipo: '', monto: '' }])
  const [generandoFijo, setGenerandoFijo] = useState(false)
  const [generarFile, setGenerarFile] = useState<File | null>(null)
  const [generarTipoComp, setGenerarTipoComp] = useState('')
  const [generarCompNombre, setGenerarCompNombre] = useState('')
  const [generarUsaPrefix, setGenerarUsaPrefix] = useState(false)
  const generarFileRef = useRef<HTMLInputElement>(null)

  // Múltiples medios de pago para gastos variables
  const [mediosPago, setMediosPago] = useState<MedioPagoItem[]>([{ tipo: '', monto: '' }])

  // ── Tab OC — estado ──────────────────────────────────────────────────────
  const [ocFiltroEstadoPago, setOcFiltroEstadoPago] = useState('')
  const [ocFiltroProveedor, setOcFiltroProveedor]   = useState('')
  const [ocModalId, setOcModalId]                   = useState<string | null>(null)
  const [ocMediosPago, setOcMediosPago]             = useState<{tipo: string; monto: string}[]>([{tipo: 'Transferencia', monto: ''}])
  const [ocPagoTipo, setOcPagoTipo]                 = useState<'pago' | 'cc'>('pago')
  const [ocPagoDias, setOcPagoDias]                 = useState('30')
  const [ocPagoCondiciones, setOcPagoCondiciones]   = useState('')
  const [ocGuardando, setOcGuardando]               = useState(false)
  const [ocExpandedId, setOcExpandedId]             = useState<string | null>(null)

  const MEDIOS_OC = ['Efectivo','Transferencia','Tarjeta de débito','Cheque','Otro']

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: sesionesAbiertas = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, caja_id, usuario_id, cajas(nombre), abrio:usuario_id(nombre_display)')
        .eq('tenant_id', tenant!.id).eq('estado', 'abierta')
      return data ?? []
    },
    enabled: !!tenant, refetchInterval: 60_000,
  })

  const sesionCajaId = cajaSeleccionadaId ?? (sesionesAbiertas.length === 1 ? (sesionesAbiertas[0] as any).id : null)

  // Gastos últimos 30 días (tab gastos)
  const fechaDesde30 = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  }, [])
  const fechaHasta30 = useMemo(() => new Date().toISOString().split('T')[0], [])

  const { data: gastos = [], isLoading } = useQuery({
    queryKey: ['gastos', tenant?.id, fechaDesde30, fechaHasta30, sucursalId],
    queryFn: async () => {
      let q = supabase.from('gastos').select('*').eq('tenant_id', tenant!.id)
        .gte('fecha', fechaDesde30).lte('fecha', fechaHasta30)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false })
      q = applyFilter(q)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'gastos',
  })

  // Historial (tab historial — rango libre)
  const { data: historialGastos = [], isLoading: loadingHistorial } = useQuery({
    queryKey: ['gastos-historial', tenant?.id, histFechaDesde, histFechaHasta, sucursalId],
    queryFn: async () => {
      let q = supabase.from('gastos').select('*').eq('tenant_id', tenant!.id)
        .gte('fecha', histFechaDesde).lte('fecha', histFechaHasta)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false })
      q = applyFilter(q)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
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

  // ── Tab OC — queries ─────────────────────────────────────────────────────
  const { data: ocs = [], isLoading: loadingOcs, refetch: refetchOcs } = useQuery({
    queryKey: ['oc-gastos', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(
        supabase.from('ordenes_compra')
          .select('*, proveedores(id,nombre), orden_compra_items(cantidad, precio_unitario, productos(nombre))')
          .eq('tenant_id', tenant!.id)
          .not('estado', 'eq', 'cancelada')
          .order('created_at', { ascending: false })
      )
      return (data ?? []) as any[]
    },
    enabled: !!tenant && tab === 'oc',
  })

  const { data: proveedoresOC = [] } = useQuery({
    queryKey: ['proveedores-simple', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'oc',
  })

  const { data: cajasAbiertasOC = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, cajas(nombre)').eq('tenant_id', tenant!.id).is('cerrada_at', null)
      return data ?? []
    },
    enabled: !!tenant && tab === 'oc',
  })

  // ── Tab Recursos — gastos vinculados a recursos ───────────────────────────
  const { data: gastosRecursos = [], refetch: refetchGastosRecursos } = useQuery({
    queryKey: ['gastos-recursos', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(
        supabase.from('gastos')
          .select('*, recursos(id, nombre, categoria, estado)')
          .eq('tenant_id', tenant!.id)
          .not('recurso_id', 'is', null)
          .order('fecha', { ascending: false })
      )
      return data ?? []
    },
    enabled: !!tenant && tab === 'recursos',
  })

  const marcarRecursoRecibido = useMutation({
    mutationFn: async ({ gastoId, recursoId }: { gastoId: string; recursoId: string }) => {
      await supabase.from('recursos').update({ estado: 'activo' }).eq('id', recursoId)
      await supabase.from('gastos').update({ notas: 'Pago confirmado — recurso recibido' }).eq('id', gastoId)
    },
    onSuccess: () => {
      toast.success('Recurso marcado como recibido')
      qc.invalidateQueries({ queryKey: ['gastos-recursos', tenant?.id] })
      qc.invalidateQueries({ queryKey: ['recursos'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const ocSeleccionada = ocs.find((o: any) => o.id === ocModalId) ?? null

  const ocsFiltradas = useMemo(() => {
    const filtradas = ocs.filter((o: any) => {
      if (ocFiltroEstadoPago && o.estado_pago !== ocFiltroEstadoPago) return false
      if (ocFiltroProveedor && o.proveedor_id !== ocFiltroProveedor) return false
      return true
    })
    // Pagadas siempre al fondo
    return [...filtradas].sort((a, b) => {
      const aPagada = a.estado_pago === 'pagada' ? 1 : 0
      const bPagada = b.estado_pago === 'pagada' ? 1 : 0
      return aPagada - bPagada
    })
  }, [ocs, ocFiltroEstadoPago, ocFiltroProveedor])

  const hoy = new Date().toISOString().split('T')[0]

  function calcMontoTotalOC(oc: any): number {
    if (oc.monto_total) return Number(oc.monto_total)
    return (oc.orden_compra_items ?? []).reduce((s: number, i: any) =>
      s + Number(i.cantidad ?? 0) * Number(i.precio_unitario ?? 0), 0)
  }

  function estadoPagoBadge(oc: any) {
    const venc = oc.fecha_vencimiento_pago
    const esVencida = venc && venc < hoy
    const esProxima = venc && !esVencida && (() => {
      const d = new Date(venc + 'T00:00:00'); d.setDate(d.getDate() + 1)
      return (d.getTime() - Date.now()) / 86400000 <= 3
    })()

    const base: Record<string, { label: string; cls: string }> = {
      pendiente_pago:   { label: 'Pendiente', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
      pago_parcial:     { label: 'Pago parcial', cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
      pagada:           { label: 'Pagada', cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
      cuenta_corriente: { label: 'Cuenta Corriente', cls: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
    }
    const b = base[oc.estado_pago] ?? base.pendiente_pago
    if (esVencida) return { label: `⚠ Vencida`, cls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' }
    if (esProxima) return { label: `⏰ ${b.label}`, cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' }
    return b
  }

  const registrarPagoOC = async () => {
    if (!ocSeleccionada) return
    setOcGuardando(true)
    try {
      const total = calcMontoTotalOC(ocSeleccionada)
      const saldo = total - Number(ocSeleccionada.monto_pagado ?? 0)

      let nuevoEstadoPago: string
      let fechaVenc: string | null = ocSeleccionada.fecha_vencimiento_pago ?? null
      let diasPlazo: number | null = ocSeleccionada.dias_plazo_pago ?? null
      const sesionId = (cajasAbiertasOC as any[])[0]?.id ?? null

      if (ocPagoTipo === 'cc') {
        // CC: registrar el saldo restante como deuda — no se necesita monto
        const dias = parseInt(ocPagoDias) || 30
        const fv = new Date(); fv.setDate(fv.getDate() + dias)
        fechaVenc = fv.toISOString().split('T')[0]
        diasPlazo = dias
        nuevoEstadoPago = 'cuenta_corriente'

        await supabase.from('ordenes_compra').update({
          estado_pago: nuevoEstadoPago,
          monto_total: total,
          fecha_vencimiento_pago: fechaVenc,
          dias_plazo_pago: diasPlazo,
          condiciones_pago: ocPagoCondiciones || null,
        }).eq('id', ocSeleccionada.id)

        // CC movement por el saldo pendiente (positivo = deuda)
        await supabase.from('proveedor_cc_movimientos').insert({
          tenant_id: tenant!.id, proveedor_id: ocSeleccionada.proveedor_id,
          oc_id: ocSeleccionada.id, tipo: 'oc',
          monto: saldo, fecha: hoy,
          fecha_vencimiento: fechaVenc, medio_pago: null,
          descripcion: `CC OC #${ocSeleccionada.numero} — ${diasPlazo}d`,
          created_by: user!.id,
        })

      } else {
        // Pago: sumar todos los medios
        const mediosValidos = ocMediosPago
          .map(m => ({ tipo: m.tipo, monto: parseFloat(m.monto.replace(',', '.')) }))
          .filter(m => !isNaN(m.monto) && m.monto > 0)

        if (!mediosValidos.length) { toast.error('Ingresá al menos un monto válido'); return }
        const montoTotal = mediosValidos.reduce((s, m) => s + m.monto, 0)
        if (montoTotal > saldo + 0.5) { toast.error(`El monto $${montoTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })} supera el saldo de $${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`); return }

        const nuevoMontoPagado = Number(ocSeleccionada.monto_pagado ?? 0) + montoTotal
        nuevoEstadoPago = nuevoMontoPagado >= total - 0.5 ? 'pagada' : 'pago_parcial'

        await supabase.from('ordenes_compra').update({
          estado_pago: nuevoEstadoPago,
          monto_pagado: nuevoMontoPagado,
          monto_total: total,
        }).eq('id', ocSeleccionada.id)

        // CC movement por el pago (negativo = cancela deuda)
        await supabase.from('proveedor_cc_movimientos').insert({
          tenant_id: tenant!.id, proveedor_id: ocSeleccionada.proveedor_id,
          oc_id: ocSeleccionada.id, tipo: 'pago',
          monto: -montoTotal, fecha: hoy,
          medio_pago: JSON.stringify(mediosValidos.map(m => ({ tipo: m.tipo, monto: m.monto }))),
          descripcion: `Pago OC #${ocSeleccionada.numero}`,
          caja_sesion_id: sesionId, created_by: user!.id,
        })

        // Caja: egreso por cada medio Efectivo
        for (const m of mediosValidos.filter(m => m.tipo === 'Efectivo')) {
          if (!sesionId) { toast(`⚠ Sin caja abierta — egreso de $${m.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })} no registrado en caja`, { icon: '⚠' }); continue }
          await supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id, sesion_id: sesionId, tipo: 'egreso',
            monto: m.monto,
            concepto: `Pago OC #${ocSeleccionada.numero} — ${ocSeleccionada.proveedores?.nombre}`,
            created_by: user!.id,
          })
        }
      }

      toast.success(ocPagoTipo === 'cc' ? 'OC asignada a cuenta corriente' : 'Pago registrado')
      setOcModalId(null)
      setOcMediosPago([{ tipo: 'Transferencia', monto: '' }])
      setOcPagoCondiciones('')
      qc.invalidateQueries({ queryKey: ['oc-gastos', tenant?.id] })
      qc.invalidateQueries({ queryKey: ['proveedor-cc', ocSeleccionada.proveedor_id] })
    } catch (e: any) {
      toast.error(e.message ?? 'Error al registrar')
    } finally {
      setOcGuardando(false)
    }
  }

  // ── Stats (tab gastos) ────────────────────────────────────────────────────
  const gastosFiltrados = filtroCategoria
    ? gastos.filter((g: any) => g.categoria === filtroCategoria)
    : gastos
  const totalPeriodo  = gastosFiltrados.reduce((a: number, g: any) => a + Number(g.monto), 0)
  const totalIVA      = gastosFiltrados.filter((g: any) => g.iva_deducible).reduce((a: number, g: any) => a + Number(g.iva_monto ?? 0), 0)
  const cantPeriodo   = gastosFiltrados.length
  const mayorGasto    = gastosFiltrados.reduce((max: any, g: any) =>
    (!max || Number(g.monto) > Number(max.monto)) ? g : max, null)
  const categoriasTotales: Record<string, number> = {}
  gastosFiltrados.forEach((g: any) => {
    const cat = g.categoria || 'Sin categoría'
    categoriasTotales[cat] = (categoriasTotales[cat] || 0) + Number(g.monto)
  })
  const categoriasOrdenadas = Object.entries(categoriasTotales).sort((a, b) => b[1] - a[1])
  const categoriasUnicas = [...new Set(gastos.map((g: any) => g.categoria).filter(Boolean))] as string[]

  // ── Historial filtros ─────────────────────────────────────────────────────
  const histFiltrados = useMemo(() => {
    return (historialGastos as any[]).filter((g: any) => {
      if (histCategoria && g.categoria !== histCategoria) return false
      if (histMontoOp && histMontoVal) {
        const val = parseFloat(histMontoVal)
        if (!isNaN(val)) {
          if (histMontoOp === 'mayor' && Number(g.monto) <= val) return false
          if (histMontoOp === 'menor' && Number(g.monto) >= val) return false
          if (histMontoOp === 'igual' && Math.abs(Number(g.monto) - val) > 0.01) return false
        }
      }
      return true
    })
  }, [historialGastos, histCategoria, histMontoOp, histMontoVal])

  const histCategoriasUnicas = [...new Set(historialGastos.map((g: any) => g.categoria).filter(Boolean))] as string[]

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const parseMediosPago = (raw: string | null | undefined): MedioPagoItem[] => {
    if (!raw) return [{ tipo: '', monto: '' }]
    try {
      const arr = JSON.parse(raw) as { tipo: string; monto: number }[]
      if (Array.isArray(arr) && arr.length > 0)
        return arr.map(m => ({ tipo: m.tipo, monto: String(m.monto) }))
    } catch {}
    // backward compat: old single string value
    return [{ tipo: raw, monto: '' }]
  }

  const abrirNuevo = () => {
    setEditandoId(null); setForm(FORM_VACIO)
    setMediosPago([{ tipo: '', monto: '' }])
    setComprobanteFile(null); setComprobanteExistente(null)
    setComprobanteNombre(''); setTipoComprobanteSelect(''); setUsarPrefixCategoria(false)
    setModalAbierto(true)
  }
  const abrirEdicion = (g: any) => {
    setEditandoId(g.id)
    setForm({
      descripcion: g.descripcion, monto: String(g.monto),
      tipo_iva: g.tipo_iva ?? '', iva_deducible: g.iva_deducible ?? false,
      deduce_ganancias: g.deduce_ganancias ?? false,
      gasto_negocio: g.gasto_negocio === true ? 'negocio' : g.gasto_negocio === false ? 'personal' : '',
      categoria: g.categoria ?? '', fecha: g.fecha, notas: g.notas ?? '',
    })
    setMediosPago(parseMediosPago(g.medio_pago))
    setComprobanteFile(null); setComprobanteExistente(g.comprobante_url ?? null)
    setComprobanteNombre(g.comprobante_titulo ?? '')
    setTipoComprobanteSelect(''); setUsarPrefixCategoria(false)
    setModalAbierto(true)
  }
  const cerrarModal = () => {
    setModalAbierto(false); setEditandoId(null); setForm(FORM_VACIO)
    setMediosPago([{ tipo: '', monto: '' }])
    setComprobanteFile(null); setComprobanteExistente(null)
    setComprobanteNombre(''); setTipoComprobanteSelect(''); setUsarPrefixCategoria(false)
    setCajaSeleccionadaId(null)
    setEsCuota(false); setCuotasTotal('12'); setTasaInteres('0')
  }
  useModalKeyboard({ isOpen: modalAbierto, onClose: cerrarModal, onConfirm: () => { if (!guardando) guardar() } })

  const abrirNuevoFijo = () => { setEditandoFijoId(null); setFormFijo(FORM_FIJO_VACIO); setModalFijoAbierto(true) }
  const abrirEdicionFijo = (f: any) => {
    setEditandoFijoId(f.id)
    setFormFijo({
      descripcion: f.descripcion, monto: String(f.monto),
      tipo_iva: f.tipo_iva ?? '', iva_deducible: f.iva_deducible ?? false,
      deduce_ganancias: f.deduce_ganancias ?? false,
      gasto_negocio: f.gasto_negocio === true ? 'negocio' : f.gasto_negocio === false ? 'personal' : '',
      categoria: f.categoria ?? '', medio_pago: f.medio_pago ?? '',
      frecuencia: f.frecuencia, dia_vencimiento: f.dia_vencimiento ? String(f.dia_vencimiento) : '',
      alerta_dias_antes: f.alerta_dias_antes ? String(f.alerta_dias_antes) : '3',
      notas: f.notas ?? '', activo: f.activo,
    })
    setModalFijoAbierto(true)
  }
  const cerrarModalFijo = () => { setModalFijoAbierto(false); setEditandoFijoId(null); setFormFijo(FORM_FIJO_VACIO) }
  useModalKeyboard({ isOpen: modalFijoAbierto, onClose: cerrarModalFijo, onConfirm: () => { if (!guardandoFijo) guardarFijo() } })

  // ── Ver comprobante ───────────────────────────────────────────────────────
  const verComprobante = async (path: string) => {
    const { data } = await supabase.storage.from('comprobantes-gastos').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('No se pudo abrir el comprobante')
  }

  // ── Título del comprobante ─────────────────────────────────────────────────
  const getTituloFinal = () => {
    const base = tipoComprobanteSelect || comprobanteNombre.trim()
    if (!base) return ''
    if (usarPrefixCategoria && form.categoria) return `${form.categoria}_${base}`
    return base
  }

  // ── Guardar gasto ─────────────────────────────────────────────────────────
  const guardar = async () => {
    if (!form.descripcion.trim()) { toast.error('La descripción es requerida'); return }
    const monto = parseFloat(form.monto.replace(',', '.'))
    if (!monto || monto <= 0) { toast.error('Ingresá un monto válido'); return }

    // Validación de caja (solo en creación nueva)
    if (!editandoId) {
      if (sesionesAbiertas.length === 0) {
        toast.error('No hay ninguna caja abierta. Abrí una caja antes de registrar gastos.')
        return
      }
      if (esCajero) {
        const misSesiones = (sesionesAbiertas as any[]).filter(s => s.usuario_id === user?.id)
        if (misSesiones.length === 0) {
          toast.error('No tenés caja abierta. Pedile a tu supervisor que abra una para vos.')
          return
        }
      }
      // Aviso si Owner/Supervisor usa la caja de otro usuario
      const sesionAUsar = (sesionesAbiertas as any[]).find(s => s.id === sesionCajaId) ?? (sesionesAbiertas as any[])[0]
      if (sesionAUsar && puedeAdministrarCaja && sesionAUsar.usuario_id !== user?.id) {
        const nombreAbridor = (sesionAUsar as any).abrio?.nombre_display ?? 'otro usuario'
        toast(`⚠️ Gasto en caja de ${nombreAbridor}. Quedarás registrado como quien lo agregó.`, { duration: 6000, icon: '⚠️' })
      }
    }

    setGuardando(true)
    try {
      const ivaMonto = form.tipo_iva && form.iva_deducible ? calcularIVA(monto, form.tipo_iva) : null

      const mediosValidos = mediosPago.filter(m => m.tipo && parseFloat(m.monto) > 0)
      const mediosPagoJson = mediosValidos.length > 0
        ? JSON.stringify(mediosValidos.map(m => ({ tipo: m.tipo, monto: parseFloat(m.monto) })))
        : null

      const payload: any = {
        tenant_id: tenant!.id,
        descripcion: form.descripcion.trim(), monto,
        tipo_iva: form.tipo_iva || null,
        iva_monto: ivaMonto && ivaMonto > 0 ? parseFloat(ivaMonto.toFixed(2)) : null,
        iva_deducible: form.iva_deducible,
        deduce_ganancias: form.deduce_ganancias,
        gasto_negocio: form.deduce_ganancias
          ? (form.gasto_negocio === 'negocio' ? true : form.gasto_negocio === 'personal' ? false : null)
          : null,
        categoria: form.categoria || null,
        medio_pago: mediosPagoJson,
        fecha: form.fecha, notas: form.notas.trim() || null,
        sucursal_id: sucursalId || null,
        usuario_id: user?.id ?? null,
      }

      const titulo = getTituloFinal()
      if (titulo) payload.comprobante_titulo = titulo

      let gastoId = editandoId
      if (editandoId) {
        payload.comprobante_url = comprobanteExistente ?? null
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

        // Registrar en caja — un movimiento por cada medio de pago
        const sesionUsar = sesionCajaId ?? (sesionesAbiertas as any[])[0]?.id
        if (sesionUsar && mediosValidos.length > 0) {
          const concepto = `Gasto: ${form.descripcion.trim()}`
          for (const mp of mediosValidos) {
            const montoMp = parseFloat(mp.monto)
            void supabase.from('caja_movimientos').insert({
              tenant_id: tenant!.id, sesion_id: sesionUsar,
              tipo: mp.tipo === 'Efectivo' ? 'egreso' : 'egreso_informativo',
              concepto: mp.tipo === 'Efectivo' ? concepto : `[${mp.tipo}] ${concepto}`,
              monto: montoMp, usuario_id: user?.id,
            })
          }
          qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] })
        }
      }

      // Generar cuotas si aplica (solo creación, no edición)
      if (!editandoId && esCuota && gastoId) {
        const nCuotas = parseInt(cuotasTotal) || 1
        const tasa = parseFloat(tasaInteres) || 0
        const montoConInteres = monto * (1 + tasa / 100)
        const montoPorCuota = montoConInteres / nCuotas
        const cuotasArr = Array.from({ length: nCuotas }, (_, i) => {
          const fecha = new Date()
          fecha.setMonth(fecha.getMonth() + i + 1)
          return {
            tenant_id: tenant!.id,
            gasto_id: gastoId!,
            numero: i + 1,
            monto: parseFloat(montoPorCuota.toFixed(2)),
            fecha_vencimiento: fecha.toISOString().split('T')[0],
            estado: 'pendiente' as const,
          }
        })
        await supabase.from('gasto_cuotas').insert(cuotasArr)
        await supabase.from('gastos').update({
          es_cuota: true,
          cuotas_total: nCuotas,
          monto_cuota: parseFloat(montoPorCuota.toFixed(2)),
          tasa_interes: tasa,
        }).eq('id', gastoId)
      }

      // Subir comprobante
      if (comprobanteFile && gastoId) {
        const ext = comprobanteFile.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        const path = `${tenant!.id}/${gastoId}.${ext}`
        const { error: upErr } = await supabase.storage.from('comprobantes-gastos').upload(path, comprobanteFile, { upsert: true })
        if (!upErr) await supabase.from('gastos').update({ comprobante_url: path }).eq('id', gastoId)
      }

      qc.invalidateQueries({ queryKey: ['gastos'] })
      qc.invalidateQueries({ queryKey: ['gastos-historial'] })
      cerrarModal()
    } catch (e: any) {
      toast.error(e.message ?? 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  // ── Eliminar gasto ────────────────────────────────────────────────────────
  const eliminar = async (id: string) => {
    if (!confirm('¿Eliminar este gasto?')) return
    const g = ([...gastos, ...historialGastos] as any[]).find(x => x.id === id)
    if (g?.comprobante_url) void supabase.storage.from('comprobantes-gastos').remove([g.comprobante_url])
    const { error } = await supabase.from('gastos').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    qc.invalidateQueries({ queryKey: ['gastos'] })
    qc.invalidateQueries({ queryKey: ['gastos-historial'] })
    toast.success('Gasto eliminado')
    logActividad({ entidad: 'gasto', entidad_id: id, entidad_nombre: g?.descripcion, accion: 'eliminar', pagina: '/gastos' })
  }

  // ── Guardar gasto fijo ────────────────────────────────────────────────────
  const guardarFijo = async () => {
    if (!formFijo.descripcion.trim()) { toast.error('La descripción es requerida'); return }
    const monto = parseFloat(formFijo.monto.replace(',', '.'))
    if (!monto || monto <= 0) { toast.error('Ingresá un monto válido'); return }
    setGuardandoFijo(true)
    try {
      const ivaMonto = formFijo.tipo_iva && formFijo.iva_deducible ? calcularIVA(monto, formFijo.tipo_iva) : null
      const payload: any = {
        tenant_id: tenant!.id,
        descripcion: formFijo.descripcion.trim(), monto,
        tipo_iva: formFijo.tipo_iva || null,
        iva_monto: ivaMonto && ivaMonto > 0 ? parseFloat(ivaMonto.toFixed(2)) : null,
        iva_deducible: formFijo.iva_deducible,
        deduce_ganancias: formFijo.deduce_ganancias,
        gasto_negocio: formFijo.deduce_ganancias
          ? (formFijo.gasto_negocio === 'negocio' ? true : formFijo.gasto_negocio === 'personal' ? false : null)
          : null,
        categoria: formFijo.categoria || null, medio_pago: formFijo.medio_pago || null,
        frecuencia: formFijo.frecuencia,
        dia_vencimiento: formFijo.dia_vencimiento ? parseInt(formFijo.dia_vencimiento) : null,
        alerta_dias_antes: formFijo.alerta_dias_antes ? parseInt(formFijo.alerta_dias_antes) : 3,
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
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar') }
    finally { setGuardandoFijo(false) }
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

  // ── Generar gasto desde fijo ──────────────────────────────────────────────
  const abrirGenerarFijo = (f: any) => {
    setModalGenerarFijo(f)
    setFormGenerar({ fecha: new Date().toISOString().split('T')[0], notas: '' })
    setMediosPagoGenerar(f.medio_pago ? [{ tipo: f.medio_pago, monto: String(f.monto) }] : [{ tipo: '', monto: String(f.monto) }])
    setGenerarFile(null); setGenerarTipoComp(''); setGenerarCompNombre(''); setGenerarUsaPrefix(false)
  }
  const confirmarGenerarFijo = async () => {
    if (!modalGenerarFijo) return
    setGenerandoFijo(true)
    try {
      const f = modalGenerarFijo
      const mediosValGen = mediosPagoGenerar.filter(m => m.tipo && parseFloat(m.monto) > 0)
      const medioJson = mediosValGen.length > 0
        ? JSON.stringify(mediosValGen.map(m => ({ tipo: m.tipo, monto: parseFloat(m.monto) })))
        : null
      const tituloFinal = (() => {
        const base = generarTipoComp || generarCompNombre.trim()
        if (!base) return null
        if (generarUsaPrefix && f.categoria) return `${f.categoria}_${base}`
        return base
      })()
      const { data: inserted, error } = await supabase.from('gastos').insert({
        tenant_id: tenant!.id,
        descripcion: f.descripcion, monto: f.monto,
        tipo_iva: f.tipo_iva ?? null,
        iva_monto: f.iva_monto ?? null, iva_deducible: f.iva_deducible ?? false,
        deduce_ganancias: f.deduce_ganancias ?? false, gasto_negocio: f.gasto_negocio ?? null,
        categoria: f.categoria ?? null, medio_pago: medioJson,
        fecha: formGenerar.fecha,
        notas: formGenerar.notas.trim() || `Generado desde gasto fijo — ${f.frecuencia}`,
        sucursal_id: f.sucursal_id ?? null, usuario_id: user?.id ?? null,
        comprobante_titulo: tituloFinal,
      }).select('id').single()
      if (error) throw error
      // Subir comprobante si lo adjuntó
      if (generarFile && inserted) {
        const ext = generarFile.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        const path = `${tenant!.id}/${inserted.id}.${ext}`
        const { error: upErr } = await supabase.storage.from('comprobantes-gastos').upload(path, generarFile, { upsert: true })
        if (!upErr) await supabase.from('gastos').update({ comprobante_url: path }).eq('id', inserted.id)
      }
      // Registrar en caja
      const sesionUsar = sesionesAbiertas.length > 0 ? (sesionesAbiertas[0] as any).id : null
      if (sesionUsar && mediosValGen.length > 0) {
        for (const mp of mediosValGen) {
          void supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id, sesion_id: sesionUsar,
            tipo: mp.tipo === 'Efectivo' ? 'egreso' : 'egreso_informativo',
            concepto: mp.tipo === 'Efectivo' ? `Gasto: ${f.descripcion}` : `[${mp.tipo}] Gasto: ${f.descripcion}`,
            monto: parseFloat(mp.monto), usuario_id: user?.id,
          })
        }
      }
      qc.invalidateQueries({ queryKey: ['gastos'] })
      qc.invalidateQueries({ queryKey: ['gastos-historial'] })
      toast.success(`Gasto "${f.descripcion}" registrado`)
      setModalGenerarFijo(null)
    } catch (e: any) { toast.error(e.message ?? 'Error al generar') }
    finally { setGenerandoFijo(false) }
  }

  // ── IVA preview ───────────────────────────────────────────────────────────
  const montoNum = parseFloat(form.monto.replace(',', '.')) || 0
  const ivaPreview = montoNum > 0 && form.tipo_iva && form.iva_deducible ? calcularIVA(montoNum, form.tipo_iva) : 0
  const netoPreview = montoNum - ivaPreview

  const montoFijoNum = parseFloat(formFijo.monto.replace(',', '.')) || 0
  const ivaFijoPreview = montoFijoNum > 0 && formFijo.tipo_iva && formFijo.iva_deducible ? calcularIVA(montoFijoNum, formFijo.tipo_iva) : 0

  // ── Sección IVA + Ganancias (reutilizable en ambos modales) ───────────────
  const renderFiscal = (
    vals: { tipo_iva: string; iva_deducible: boolean; deduce_ganancias: boolean; gasto_negocio: string; monto: string },
    setVals: (u: any) => void,
    ivaCalc: number, netoCalc: number
  ) => (
    <div className="space-y-3 border border-blue-100 dark:border-blue-900/30 rounded-xl p-3 bg-blue-50/50 dark:bg-blue-900/10">
      <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Información fiscal</p>

      {/* IVA */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tasa de IVA</label>
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <select value={vals.tipo_iva} onChange={e => setVals((f: any) => ({ ...f, tipo_iva: e.target.value }))}
              className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
              <option value="">Sin IVA / No aplica</option>
              {TASAS_IVA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          {vals.tipo_iva && vals.tipo_iva !== 'exento' && vals.tipo_iva !== 'sin_iva' && (
            <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={vals.iva_deducible}
                onChange={e => setVals((f: any) => ({ ...f, iva_deducible: e.target.checked }))}
                className="accent-accent" />
              ¿Es deducible?
            </label>
          )}
        </div>
        {vals.tipo_iva && vals.iva_deducible && ivaCalc > 0 && (
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
            <div className="bg-white dark:bg-gray-700 rounded-lg px-2 py-1.5 text-center">
              <p className="text-gray-500 dark:text-gray-400">Neto</p>
              <p className="font-semibold text-gray-800 dark:text-gray-100">{formatMoneda(netoCalc)}</p>
            </div>
            <div className="bg-white dark:bg-gray-700 rounded-lg px-2 py-1.5 text-center">
              <p className="text-blue-500">IVA a favor</p>
              <p className="font-semibold text-blue-600 dark:text-blue-400">{formatMoneda(ivaCalc)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Ganancias */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={vals.deduce_ganancias}
            onChange={e => setVals((f: any) => ({ ...f, deduce_ganancias: e.target.checked, gasto_negocio: '' }))}
            className="accent-accent" />
          Deducir de Impuesto a las Ganancias
        </label>
        {vals.deduce_ganancias && (
          <div className="mt-2 space-y-2">
            <label className="flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors
              border-green-200 dark:border-green-800 bg-white dark:bg-gray-700 hover:bg-green-50 dark:hover:bg-green-900/20">
              <input type="radio" name={`gasto_negocio_${editandoId ?? 'nuevo'}`}
                checked={vals.gasto_negocio === 'negocio'}
                onChange={() => setVals((f: any) => ({ ...f, gasto_negocio: 'negocio' }))}
                className="accent-green-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Gasto pertenece al negocio</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Si el gasto pertenece al negocio y tenés la factura correspondiente, podría deducirse de Ganancias.</p>
              </div>
            </label>
            <label className="flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors
              border-orange-200 dark:border-orange-800 bg-white dark:bg-gray-700 hover:bg-orange-50 dark:hover:bg-orange-900/20">
              <input type="radio" name={`gasto_negocio_${editandoId ?? 'nuevo'}`}
                checked={vals.gasto_negocio === 'personal'}
                onChange={() => setVals((f: any) => ({ ...f, gasto_negocio: 'personal' }))}
                className="accent-orange-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Gasto no pertenece al negocio</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Si el gasto no pertenece al negocio, no podría deducirse de Ganancias.</p>
              </div>
            </label>
          </div>
        )}
      </div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Gastos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            {tab === 'gastos' ? 'Últimos 30 días' : tab === 'historial' ? 'Historial completo con filtros' : 'Gastos estimados recurrentes'}
          </p>
        </div>
        {tab === 'gastos' && (
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
            <Plus size={18} /> Nuevo gasto
          </button>
        )}
        {tab === 'fijos' && (puedeAdministrarCaja || !esSoloFijos) && (
          <button onClick={abrirNuevoFijo}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
            <Plus size={18} /> Nuevo gasto fijo
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'gastos'   as const, label: 'Gastos variables', icon: <Receipt size={14} /> },
          { id: 'historial'as const, label: 'Historial',        icon: <History size={14} /> },
          { id: 'fijos'    as const, label: 'Gastos fijos',     icon: <Repeat size={14} /> },
          { id: 'oc'       as const, label: 'Órdenes de Compra',icon: <ShoppingCart size={14} /> },
          { id: 'recursos' as const, label: 'Recursos',         icon: <Landmark size={14} /> },
        ].map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ══ TAB: GASTOS VARIABLES (últimos 30 días) ══ */}
      {tab === 'gastos' && (
        <>
          {/* Filtro categoría */}
          <div className="flex flex-wrap gap-3 items-center">
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
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
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
                <p className="text-sm text-gray-500 dark:text-gray-400">Total 30 días</p>
              </div>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(totalPeriodo)}</p>
              <p className="text-xs text-gray-400 mt-1">{cantPeriodo} gasto{cantPeriodo !== 1 ? 's' : ''}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <Receipt size={18} className="text-blue-500" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">IVA a favor</p>
              </div>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {totalIVA > 0 ? formatMoneda(totalIVA) : <span className="text-gray-300 dark:text-gray-600">—</span>}
              </p>
              {totalIVA > 0 && <p className="text-xs text-gray-400 mt-1">Solo gastos deducibles</p>}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-amber-900/20 flex items-center justify-center">
                  <TrendingDown size={18} className="text-orange-500" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Mayor gasto</p>
              </div>
              {mayorGasto ? (
                <><p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(Number(mayorGasto.monto))}</p>
                <p className="text-xs text-gray-400 mt-1 truncate">{mayorGasto.descripcion}</p></>
              ) : <p className="text-2xl font-bold text-gray-300 dark:text-gray-600">—</p>}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                  <Filter size={18} className="text-accent" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Mayor categoría</p>
              </div>
              {categoriasOrdenadas.length > 0 ? (
                <><p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(categoriasOrdenadas[0][1])}</p>
                <p className="text-xs text-gray-400 mt-1 truncate">{categoriasOrdenadas[0][0]}</p></>
              ) : <p className="text-2xl font-bold text-gray-300 dark:text-gray-600">—</p>}
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
                <p className="font-medium text-sm">No hay gastos en los últimos 30 días</p>
                <button onClick={abrirNuevo} className="mt-3 text-accent text-sm font-medium hover:underline">Registrar el primero</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Fecha</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Descripción</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Categoría</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden md:table-cell">Medio</th>
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
                              <button onClick={() => verComprobante(g.comprobante_url)} title={g.comprobante_titulo ?? 'Ver comprobante'} className="text-blue-400 hover:text-blue-600">
                                <Paperclip size={13} />
                              </button>
                            )}
                            {g.deduce_ganancias && <span className="text-xs text-green-600 dark:text-green-400" title="Deduce Ganancias">G</span>}
                          </div>
                          {g.notas && <p className="text-xs text-gray-400 mt-0.5">{g.notas}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {g.categoria ? (
                            <span className="inline-block px-2 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-accent text-xs rounded-lg font-medium">{g.categoria}</span>
                          ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm hidden md:table-cell">{formatMediosPago(g.medio_pago)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400">{formatMoneda(Number(g.monto))}</td>
                        <td className="px-4 py-3 text-right text-xs hidden md:table-cell">
                          {g.iva_deducible && g.iva_monto > 0
                            ? <span className="text-blue-500 dark:text-blue-400">{formatMoneda(Number(g.iva_monto))}</span>
                            : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => abrirEdicion(g)} className="p-1.5 text-gray-400 hover:text-accent hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"><Pencil size={14} /></button>
                            <button onClick={() => eliminar(g.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">Total</td>
                      <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">{formatMoneda(totalPeriodo)}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-500 dark:text-blue-400 hidden md:table-cell">{totalIVA > 0 ? formatMoneda(totalIVA) : '—'}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ TAB: HISTORIAL ══ */}
      {tab === 'historial' && (
        <div className="space-y-4">
          {/* Filtros historial */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Rango de fechas */}
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Desde</p>
                <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm">
                  <Calendar size={13} className="text-gray-400" />
                  <input type="date" value={histFechaDesde} onChange={e => setHistFechaDesde(e.target.value)}
                    className="outline-none text-gray-700 dark:text-gray-300 bg-transparent" />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Hasta</p>
                <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm">
                  <Calendar size={13} className="text-gray-400" />
                  <input type="date" value={histFechaHasta} onChange={e => setHistFechaHasta(e.target.value)}
                    className="outline-none text-gray-700 dark:text-gray-300 bg-transparent" />
                </div>
              </div>
              {/* Categoría */}
              {histCategoriasUnicas.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Categoría</p>
                  <div className="relative">
                    <select value={histCategoria} onChange={e => setHistCategoria(e.target.value)}
                      className="appearance-none bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent">
                      <option value="">Todas</option>
                      {histCategoriasUnicas.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              )}
              {/* Filtro monto */}
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Monto</p>
                <div className="flex gap-1">
                  <div className="relative">
                    <select value={histMontoOp} onChange={e => setHistMontoOp(e.target.value)}
                      className="appearance-none bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-7 py-2 text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent">
                      <option value="">—</option>
                      <option value="mayor">Mayor a</option>
                      <option value="menor">Menor a</option>
                      <option value="igual">Igual a</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  {histMontoOp && (
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={histMontoVal}
                      onChange={e => setHistMontoVal(e.target.value)} placeholder="$0"
                      className="w-24 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent" />
                  )}
                </div>
              </div>
              {/* Limpiar */}
              {(histCategoria || histMontoOp) && (
                <button onClick={() => { setHistCategoria(''); setHistMontoOp(''); setHistMontoVal('') }}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-4">
                  <X size={14} /> Limpiar filtros
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {histFiltrados.length} resultado{histFiltrados.length !== 1 ? 's' : ''} · Total {formatMoneda(histFiltrados.reduce((a: number, g: any) => a + Number(g.monto), 0))}
            </p>
          </div>

          {/* Lista historial */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {loadingHistorial ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
              </div>
            ) : histFiltrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-gray-400">
                <History size={36} className="mb-3 opacity-30" />
                <p className="font-medium text-sm">Sin gastos en el período seleccionado</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {histFiltrados.map((g: any) => (
                  <div key={g.id}>
                    <button onClick={() => setGastoExpandidoId(gastoExpandidoId === g.id ? null : g.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-800 dark:text-gray-100 text-sm truncate">{g.descripcion}</p>
                          {g.categoria && (
                            <span className="inline-block px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-accent text-xs rounded font-medium flex-shrink-0">{g.categoria}</span>
                          )}
                          {g.comprobante_url && <Paperclip size={12} className="text-blue-400 flex-shrink-0" />}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-gray-400">{formatFecha(g.fecha)}</span>
                          {g.medio_pago && <span className="text-xs text-gray-400">{g.medio_pago}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-semibold text-red-600 dark:text-red-400 text-sm">{formatMoneda(Number(g.monto))}</p>
                        {g.iva_deducible && g.iva_monto > 0 && (
                          <p className="text-xs text-blue-500 dark:text-blue-400">IVA {formatMoneda(Number(g.iva_monto))}</p>
                        )}
                      </div>
                      <ChevronRight size={14} className={`text-gray-400 transition-transform flex-shrink-0 ${gastoExpandidoId === g.id ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Detalle expandido */}
                    {gastoExpandidoId === g.id && (
                      <div className="px-4 pb-4 bg-gray-50 dark:bg-gray-700/30 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          {g.tipo_iva && (
                            <div><p className="text-xs text-gray-400 dark:text-gray-500">IVA</p><p className="font-medium text-gray-700 dark:text-gray-300">{TASAS_IVA.find(t => t.value === g.tipo_iva)?.label ?? g.tipo_iva}</p></div>
                          )}
                          {g.iva_deducible && g.iva_monto > 0 && (
                            <div><p className="text-xs text-gray-400 dark:text-gray-500">IVA a favor</p><p className="font-medium text-blue-600 dark:text-blue-400">{formatMoneda(Number(g.iva_monto))}</p></div>
                          )}
                          {g.iva_deducible && g.iva_monto > 0 && (
                            <div><p className="text-xs text-gray-400 dark:text-gray-500">Neto</p><p className="font-medium text-gray-700 dark:text-gray-300">{formatMoneda(Number(g.monto) - Number(g.iva_monto))}</p></div>
                          )}
                          {g.deduce_ganancias !== null && g.deduce_ganancias !== undefined && (
                            <div><p className="text-xs text-gray-400 dark:text-gray-500">Ganancias</p>
                              <p className="font-medium text-gray-700 dark:text-gray-300">
                                {g.deduce_ganancias ? `Sí${g.gasto_negocio === true ? ' — del negocio' : g.gasto_negocio === false ? ' — personal' : ''}` : 'No'}
                              </p>
                            </div>
                          )}
                          {g.notas && (
                            <div className="col-span-2 sm:col-span-3"><p className="text-xs text-gray-400 dark:text-gray-500">Notas</p><p className="text-gray-700 dark:text-gray-300">{g.notas}</p></div>
                          )}
                        </div>

                        {g.comprobante_url && (
                          <div className="flex items-center gap-3">
                            <button onClick={() => verComprobante(g.comprobante_url)}
                              className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg transition-colors">
                              <ExternalLink size={12} /> {g.comprobante_titulo ?? 'Ver comprobante'}
                            </button>
                            <Paperclip size={12} className="text-gray-400" />
                            {g.comprobante_titulo && <span className="text-xs text-gray-400">{g.comprobante_titulo}</span>}
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <button onClick={() => abrirEdicion(g)} className="flex items-center gap-1 text-xs text-accent hover:underline"><Pencil size={12} /> Editar</button>
                          <span className="text-gray-200 dark:text-gray-700">|</span>
                          <button onClick={() => eliminar(g.id)} className="flex items-center gap-1 text-xs text-red-500 hover:underline"><Trash2 size={12} /> Eliminar</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: GASTOS FIJOS ══ */}
      {tab === 'fijos' && (
        <div className="space-y-4">
          {/* Aviso estimación */}
          <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <Info size={15} className="flex-shrink-0 mt-0.5" />
            <p><strong>Estos gastos son solo estimaciones.</strong> No se registran automáticamente ni aparecen en el historial. Sirven para anticipar el gasto mensual esperado y calcular el punto de equilibrio del negocio. Para registrar el gasto, usá el botón <strong>Generar</strong> en cada fila.</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {loadingFijos ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
              </div>
            ) : (gastosFijos as any[]).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-gray-400">
                <Repeat size={36} className="mb-3 opacity-30" />
                <p className="font-medium text-sm">No hay gastos fijos configurados</p>
                <button onClick={abrirNuevoFijo} className="mt-3 text-accent text-sm font-medium hover:underline">Crear el primero</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Descripción</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden sm:table-cell">Categoría</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Frecuencia</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Monto est.</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Activo</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(gastosFijos as any[]).map((f: any) => {
                      // Calcular si está próximo (por vencimiento y alerta_dias_antes)
                      const hoy = new Date()
                      const diaHoy = hoy.getDate()
                      const diasAlerta = f.alerta_dias_antes ?? 3
                      const estaProximo = f.dia_vencimiento && f.activo &&
                        Math.abs(f.dia_vencimiento - diaHoy) <= diasAlerta
                      return (
                        <tr key={f.id} className={`border-b border-gray-50 dark:border-gray-700 transition-colors ${f.activo ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50' : 'opacity-50'}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-gray-800 dark:text-gray-100">{f.descripcion}</p>
                              {estaProximo && (
                                <span title={`Vence en los próximos ${diasAlerta} días`}>
                                  <Bell size={13} className="text-amber-500" />
                                </span>
                              )}
                            </div>
                            {f.dia_vencimiento && <p className="text-xs text-gray-400">Día {f.dia_vencimiento} · alerta {diasAlerta}d antes</p>}
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            {f.categoria ? (
                              <span className="inline-block px-2 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-accent text-xs rounded-lg font-medium">{f.categoria}</span>
                            ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">{f.frecuencia}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">{formatMoneda(Number(f.monto))}</td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => toggleActivoFijo(f.id, f.activo)} title={f.activo ? 'Desactivar' : 'Activar'}>
                              {f.activo ? <ToggleRight size={22} className="text-green-500" /> : <ToggleLeft size={22} className="text-gray-400" />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              {f.activo && (
                                <button onClick={() => abrirGenerarFijo(f)} title="Registrar este gasto"
                                  className="flex items-center gap-1 px-2 py-1 text-xs text-accent border border-accent/30 hover:bg-accent/10 rounded-lg transition-colors">
                                  Generar
                                </button>
                              )}
                              <button onClick={() => abrirEdicionFijo(f)} className="p-1.5 text-gray-400 hover:text-accent hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><Pencil size={14} /></button>
                              <button onClick={() => eliminarFijo(f.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">Total mensual estimado (activos)</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">
                        {formatMoneda((gastosFijos as any[]).filter(f => f.activo && f.frecuencia === 'mensual').reduce((a: number, f: any) => a + Number(f.monto), 0))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: RECURSOS ══ */}
      {tab === 'recursos' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Gastos generados por la adquisición de recursos. Marcalos como pagados para activar el recurso.
            </p>
          </div>
          {gastosRecursos.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-10 text-center">
              <Landmark size={32} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400 dark:text-gray-500">Sin gastos de recursos registrados</p>
            </div>
          ) : gastosRecursos.map((g: any) => {
            const recurso = g.recursos
            const yaPagado = recurso?.estado === 'activo'
            return (
              <div key={g.id} className={`bg-white dark:bg-gray-800 rounded-xl border p-4 flex items-center gap-4
                ${yaPagado ? 'border-green-200 dark:border-green-700' : 'border-amber-200 dark:border-amber-700'}`}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-gray-700">
                  <Landmark size={18} className="text-gray-500 dark:text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{recurso?.nombre ?? '—'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{recurso?.categoria} · {g.fecha}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{g.descripcion}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-800 dark:text-gray-100">${Number(g.monto).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${yaPagado ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                    {yaPagado ? 'Pagado · Activo' : 'Pago pendiente'}
                  </span>
                </div>
                {!yaPagado && (
                  <button
                    onClick={() => marcarRecursoRecibido.mutate({ gastoId: g.id, recursoId: recurso.id })}
                    disabled={marcarRecursoRecibido.isPending}
                    className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold border-2 border-violet-500 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50 transition-colors">
                    Marcar como recibido
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ══ MODAL: NUEVO / EDITAR GASTO ══ */}
      {modalAbierto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editandoId ? 'Editar gasto' : 'Nuevo gasto'}</h2>
              <button onClick={cerrarModal} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción *</label>
                <input type="text" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: Pago de alquiler enero" autoFocus
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto total ($) *</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={form.monto}
                  onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="0" min="0" step="0.01"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              {/* Información fiscal */}
              {renderFiscal(form, setForm, ivaPreview, netoPreview)}

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

              {/* Medios de pago múltiples */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Medios de pago</label>
                  {mediosPago.length < MEDIOS_PAGO.length && (
                    <button type="button" onClick={() => setMediosPago(p => [...p, { tipo: '', monto: '' }])}
                      className="text-xs text-accent hover:underline flex items-center gap-1">
                      <Plus size={12} /> Agregar método
                    </button>
                  )}
                </div>
                {mediosPago.map((mp, idx) => {
                  const montoTotal = parseFloat(form.monto.replace(',', '.')) || 0
                  const asignado = mediosPago.reduce((s, m, i) => i !== idx ? s + (parseFloat(m.monto) || 0) : s, 0)
                  const restante = Math.max(0, montoTotal - asignado)
                  return (
                    <div key={idx} className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <select value={mp.tipo}
                          onChange={e => setMediosPago(p => p.map((m, i) => i === idx ? { ...m, tipo: e.target.value } : m))}
                          className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-7 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                          <option value="">Elegir…</option>
                          {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                      <div className="relative w-28">
                        <input type="number" onWheel={e => e.currentTarget.blur()}
                          value={mp.monto}
                          onChange={e => setMediosPago(p => p.map((m, i) => i === idx ? { ...m, monto: e.target.value } : m))}
                          placeholder={restante > 0 ? String(restante.toFixed(0)) : '0'}
                          min="0" step="0.01"
                          className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      {mediosPago.length > 1 && (
                        <button type="button" onClick={() => setMediosPago(p => p.filter((_, i) => i !== idx))}
                          className="text-gray-400 hover:text-red-500 flex-shrink-0"><X size={14} /></button>
                      )}
                    </div>
                  )
                })}
                {/* Indicador de diferencia */}
                {(() => {
                  const total = parseFloat(form.monto.replace(',', '.')) || 0
                  const asignado = mediosPago.reduce((s, m) => s + (parseFloat(m.monto) || 0), 0)
                  const diff = total - asignado
                  if (Math.abs(diff) < 0.01 || total === 0) return null
                  return (
                    <p className={`text-xs ${diff > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}`}>
                      {diff > 0 ? `Falta asignar $${diff.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : `Excede por $${Math.abs(diff).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
                    </p>
                  )
                })()}
              </div>

              {/* Cuotas — solo si medio de pago es Tarjeta crédito y es creación */}
              {!editandoId && mediosPago.some(m => m.tipo === 'Tarjeta crédito') && (
                <div className={`border-2 rounded-xl p-3 space-y-3 ${esCuota ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-600'}`}>
                  <div
                    onClick={() => setEsCuota(v => !v)}
                    className="flex items-center gap-3 cursor-pointer select-none">
                    <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${esCuota ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${esCuota ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                      <CreditCard size={14} /> Pago en cuotas (tarjeta de crédito)
                    </span>
                  </div>
                  {esCuota && (() => {
                    const monto = parseFloat(form.monto.replace(',', '.')) || 0
                    const n = parseInt(cuotasTotal) || 1
                    const tasa = parseFloat(tasaInteres) || 0
                    const totalConInteres = monto * (1 + tasa / 100)
                    const montoCuota = n > 0 ? totalConInteres / n : 0
                    return (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cantidad de cuotas</label>
                          <select value={cuotasTotal} onChange={e => setCuotasTotal(e.target.value)}
                            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                            {[2,3,6,9,12,18,24].map(n => <option key={n} value={n}>{n} cuotas</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Interés mensual (%)</label>
                          <input type="number" min="0" step="0.1" onWheel={e => e.currentTarget.blur()}
                            value={tasaInteres} onChange={e => setTasaInteres(e.target.value)}
                            placeholder="0"
                            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Valor por cuota</label>
                          <p className="text-sm font-semibold text-accent px-2.5 py-1.5 bg-accent/10 rounded-lg">
                            ${montoCuota.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                        {tasa > 0 && (
                          <p className="col-span-3 text-xs text-gray-500 dark:text-gray-400">
                            Total con interés: ${totalConInteres.toLocaleString('es-AR', { minimumFractionDigits: 2 })} · Vencimientos el día {new Date().getDate()} de cada mes
                          </p>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Comprobante */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Comprobante (foto / PDF)</label>
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
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700">
                      <ExternalLink size={12} /> Ver actual
                    </button>
                  )}
                  {(comprobanteFile || comprobanteExistente) && (
                    <button type="button" onClick={() => { setComprobanteFile(null); setComprobanteExistente(null) }}
                      className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  )}
                </div>

                {/* Título del comprobante */}
                {(comprobanteFile || comprobanteExistente) && (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <select value={tipoComprobanteSelect}
                        onChange={e => { setTipoComprobanteSelect(e.target.value); if (e.target.value) setComprobanteNombre('') }}
                        className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        <option value="">Seleccionar tipo de comprobante…</option>
                        {TIPOS_COMPROBANTE.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    {!tipoComprobanteSelect && (
                      <input type="text" value={comprobanteNombre} onChange={e => setComprobanteNombre(e.target.value)}
                        placeholder="O escribí un título personalizado (opcional)"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    )}
                    <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                      <input type="checkbox" checked={usarPrefixCategoria}
                        onChange={e => setUsarPrefixCategoria(e.target.checked)} className="accent-accent" />
                      Agregar categoría como prefijo
                      {usarPrefixCategoria && form.categoria && (
                        <span className="text-accent font-medium">{form.categoria}_{tipoComprobanteSelect || comprobanteNombre || '…'}</span>
                      )}
                    </label>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
                <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Detalles adicionales..." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>

            {/* Selector de caja */}
            {!editandoId && (
              <div className="px-5 pb-3">
                {sesionesAbiertas.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2.5">
                    <span>⚠️</span><span>No hay caja abierta. Debés abrir una caja antes de registrar gastos.</span>
                  </div>
                ) : sesionesAbiertas.length > 1 ? (
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Registrar en caja:</label>
                    <select value={cajaSeleccionadaId ?? ''} onChange={e => setCajaSeleccionadaId(e.target.value || null)}
                      className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                      <option value="">— Seleccioná una caja —</option>
                      {(sesionesAbiertas as any[]).map(s => {
                        const esPropia = s.usuario_id === user?.id
                        return (
                          <option key={s.id} value={s.id}>
                            {(s as any).cajas?.nombre ?? 'Caja'}{esPropia ? ' (mía)' : ` — de ${(s as any).abrio?.nombre_display ?? 'otro usuario'}`}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg px-3 py-2.5">
                    <span>✓</span>
                    <span>
                      {(sesionesAbiertas[0] as any).cajas?.nombre ?? 'Caja'}
                      {(sesionesAbiertas[0] as any).usuario_id !== user?.id && (
                        <span className="text-amber-600 dark:text-amber-400"> · Caja de {(sesionesAbiertas[0] as any).abrio?.nombre_display ?? 'otro usuario'}</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="px-5 pb-5 flex gap-3 flex-shrink-0">
              <button onClick={cerrarModal}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando || (!editandoId && sesionesAbiertas.length === 0)}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Registrar gasto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: NUEVO / EDITAR GASTO FIJO ══ */}
      {modalFijoAbierto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editandoFijoId ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}</h2>
              <button onClick={cerrarModalFijo} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción *</label>
                <input type="text" value={formFijo.descripcion} onChange={e => setFormFijo(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Ej: Alquiler local" autoFocus
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto estimado ($) *</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={formFijo.monto}
                  onChange={e => setFormFijo(f => ({ ...f, monto: e.target.value }))}
                  placeholder="0" min="0" step="0.01"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              {/* Información fiscal */}
              {renderFiscal(formFijo, setFormFijo, ivaFijoPreview, montoFijoNum - ivaFijoPreview)}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Frecuencia</label>
                  <div className="relative">
                    <select value={formFijo.frecuencia} onChange={e => setFormFijo(f => ({ ...f, frecuencia: e.target.value }))}
                      className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                      {FRECUENCIAS.map(fr => <option key={fr.value} value={fr.value}>{fr.label}</option>)}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Día del mes</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="31" value={formFijo.dia_vencimiento}
                    onChange={e => setFormFijo(f => ({ ...f, dia_vencimiento: e.target.value }))} placeholder="Ej: 10"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>

              {formFijo.dia_vencimiento && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Alertar X días antes</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="30" value={formFijo.alerta_dias_antes}
                    onChange={e => setFormFijo(f => ({ ...f, alerta_dias_antes: e.target.value }))} placeholder="3"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  <p className="text-xs text-gray-400 mt-1">Aparecerá un ícono 🔔 en la lista cuando falten {formFijo.alerta_dias_antes || 3} días o menos</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría</label>
                <div className="relative">
                  <select value={formFijo.categoria} onChange={e => setFormFijo(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="">Sin categoría</option>
                    {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Medio de pago habitual</label>
                <div className="relative">
                  <select value={formFijo.medio_pago} onChange={e => setFormFijo(f => ({ ...f, medio_pago: e.target.value }))}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="">Elegir método…</option>
                    {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
                <textarea value={formFijo.notas} onChange={e => setFormFijo(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Detalles adicionales..." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
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

      {/* ══ MODAL: GENERAR DESDE FIJO ══ */}
      {modalGenerarFijo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div>
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">Registrar gasto</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{modalGenerarFijo.descripcion} — {formatMoneda(Number(modalGenerarFijo.monto))}</p>
              </div>
              <button onClick={() => setModalGenerarFijo(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha</label>
                <input type="date" value={formGenerar.fecha} onChange={e => setFormGenerar(f => ({ ...f, fecha: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Medios de pago</label>
                  <button type="button" onClick={() => setMediosPagoGenerar(p => [...p, { tipo: '', monto: '' }])}
                    className="text-xs text-accent hover:underline flex items-center gap-1">
                    <Plus size={12} /> Agregar
                  </button>
                </div>
                {mediosPagoGenerar.map((mp, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <select value={mp.tipo}
                        onChange={e => setMediosPagoGenerar(p => p.map((m, i) => i === idx ? { ...m, tipo: e.target.value } : m))}
                        className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-7 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        <option value="">Elegir…</option>
                        {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={mp.monto}
                      onChange={e => setMediosPagoGenerar(p => p.map((m, i) => i === idx ? { ...m, monto: e.target.value } : m))}
                      placeholder="0" min="0" step="0.01" className="w-24 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    {mediosPagoGenerar.length > 1 && (
                      <button type="button" onClick={() => setMediosPagoGenerar(p => p.filter((_, i) => i !== idx))}
                        className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
              {/* Comprobante */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Comprobante (opcional)</label>
                <input ref={generarFileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden" onChange={e => setGenerarFile(e.target.files?.[0] ?? null)} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => generarFileRef.current?.click()}
                    className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <Paperclip size={13} />
                    {generarFile ? generarFile.name : 'Adjuntar archivo'}
                  </button>
                  {generarFile && (
                    <button type="button" onClick={() => setGenerarFile(null)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  )}
                </div>
                {generarFile && (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <select value={generarTipoComp}
                        onChange={e => { setGenerarTipoComp(e.target.value); if (e.target.value) setGenerarCompNombre('') }}
                        className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        <option value="">Tipo de comprobante…</option>
                        {TIPOS_COMPROBANTE.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    {!generarTipoComp && (
                      <input type="text" value={generarCompNombre} onChange={e => setGenerarCompNombre(e.target.value)}
                        placeholder="O escribí un título personalizado"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    )}
                    {modalGenerarFijo?.categoria && (
                      <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={generarUsaPrefix} onChange={e => setGenerarUsaPrefix(e.target.checked)} className="accent-accent" />
                        Agregar categoría como prefijo
                        {generarUsaPrefix && <span className="text-accent font-medium">{modalGenerarFijo.categoria}_{generarTipoComp || generarCompNombre || '…'}</span>}
                      </label>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
                <input type="text" value={formGenerar.notas} onChange={e => setFormGenerar(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Ej: Factura N° 0001-00001234"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setModalGenerarFijo(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={confirmarGenerarFijo} disabled={generandoFijo}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {generandoFijo ? 'Registrando...' : 'Registrar gasto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: ÓRDENES DE COMPRA ══ */}
      {tab === 'oc' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 items-center">
            <select value={ocFiltroEstadoPago} onChange={e => setOcFiltroEstadoPago(e.target.value)}
              className="appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-8 py-2 text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent">
              <option value="">Todos los estados</option>
              <option value="pendiente_pago">Pendiente de pago</option>
              <option value="pago_parcial">Pago parcial</option>
              <option value="cuenta_corriente">Cuenta corriente</option>
              <option value="pagada">Pagada</option>
            </select>
            <select value={ocFiltroProveedor} onChange={e => setOcFiltroProveedor(e.target.value)}
              className="appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-8 py-2 text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent">
              <option value="">Todos los proveedores</option>
              {(proveedoresOC as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {(ocFiltroEstadoPago || ocFiltroProveedor) && (
              <button onClick={() => { setOcFiltroEstadoPago(''); setOcFiltroProveedor('') }}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={14} /> Limpiar
              </button>
            )}
            <span className="ml-auto text-xs text-gray-400">{ocsFiltradas.length} OC</span>
          </div>

          {/* Lista */}
          {loadingOcs ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" /></div>
          ) : ocsFiltradas.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-gray-400">
              <ShoppingCart size={36} className="mb-3 opacity-30" />
              <p className="text-sm">No hay órdenes de compra{ocFiltroEstadoPago || ocFiltroProveedor ? ' con esos filtros' : ''}</p>
              <p className="text-xs mt-1">Creá OCs desde el módulo Proveedores</p>
            </div>
          ) : (
            <div className="space-y-2">
              {ocsFiltradas.map((oc: any) => {
                const total = calcMontoTotalOC(oc)
                const saldo = total - Number(oc.monto_pagado ?? 0)
                const badge = estadoPagoBadge(oc)
                const venc = oc.fecha_vencimiento_pago
                const esVencida = venc && venc < hoy

                const expanded = ocExpandedId === oc.id
                return (
                  <div key={oc.id} className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border transition-all ${esVencida ? 'border-red-300 dark:border-red-700' : oc.estado_pago === 'pagada' ? 'border-gray-100 dark:border-gray-700 opacity-70' : 'border-gray-100 dark:border-gray-700'}`}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button onClick={() => setOcExpandedId(expanded ? null : oc.id)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-primary dark:text-white">OC #{oc.numero}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                          {(oc as any).tiene_reembolso_pendiente && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-medium">
                              Reembolso pendiente
                            </span>
                          )}
                          {(oc as any).es_derivada && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">
                              OC derivada
                            </span>
                          )}
                          {oc.estado !== 'confirmada' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                              {oc.estado === 'borrador' ? 'Borrador' : oc.estado === 'enviada' ? 'Enviada' : oc.estado}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{oc.proveedores?.nombre ?? '—'}</p>
                        <div className="flex gap-4 mt-1 text-xs text-gray-400 flex-wrap">
                          <span>Total: <strong className="text-gray-700 dark:text-gray-200">${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong></span>
                          {Number(oc.monto_pagado) > 0 && <span>Pagado: <strong className="text-green-600">${Number(oc.monto_pagado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong></span>}
                          {saldo > 0.5 && <span>Saldo: <strong className="text-red-500">${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong></span>}
                          {venc && <span className={esVencida ? 'text-red-500 font-medium' : 'text-gray-400'}>Vence: {new Date(venc + 'T00:00:00').toLocaleDateString('es-AR')}</span>}
                        </div>
                      </div>
                      {oc.estado_pago !== 'pagada' && (
                        <button onClick={() => { setOcModalId(oc.id); setOcPagoTipo('pago'); setOcMediosPago([{tipo:'Transferencia',monto:''}]); setOcPagoDias('30'); setOcPagoCondiciones('') }}
                          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 transition-all">
                          <DollarSign size={12} /> Pagar / CC
                        </button>
                      )}
                    </div>

                    {/* Ítems expandibles */}
                    {expanded && (
                      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-1">
                        {(oc.orden_compra_items ?? []).length === 0 ? (
                          <p className="text-xs text-gray-400">Sin ítems cargados</p>
                        ) : (
                          <>
                            {(oc.orden_compra_items as any[]).map((it: any, idx: number) => (
                              <div key={idx} className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                                <span>{it.productos?.nombre ?? '—'}</span>
                                <span className="text-gray-400">{it.cantidad} × ${Number(it.precio_unitario).toLocaleString('es-AR', { maximumFractionDigits: 0 })} = <strong className="text-gray-700 dark:text-gray-200">${(it.cantidad * it.precio_unitario).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong></span>
                              </div>
                            ))}
                            <div className="flex justify-between text-xs font-semibold border-t border-gray-100 dark:border-gray-600 pt-1 mt-1">
                              <span className="text-gray-700 dark:text-gray-200">Total</span>
                              <span>${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Modal pago / CC */}
          {ocModalId && ocSeleccionada && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <h3 className="font-semibold text-primary dark:text-white">OC #{ocSeleccionada.numero} — {ocSeleccionada.proveedores?.nombre}</h3>
                  <button onClick={() => setOcModalId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>
                <div className="p-5 space-y-4">
                  {/* Resumen */}
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-3 text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total OC</span><span className="font-semibold">${calcMontoTotalOC(ocSeleccionada).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>
                    {Number(ocSeleccionada.monto_pagado) > 0 && <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Ya pagado</span><span className="text-green-600">${Number(ocSeleccionada.monto_pagado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>}
                    <div className="flex justify-between font-semibold border-t border-gray-200 dark:border-gray-600 pt-1 mt-1"><span>Saldo pendiente</span><span className="text-red-500">${(calcMontoTotalOC(ocSeleccionada) - Number(ocSeleccionada.monto_pagado ?? 0)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>
                  </div>

                  {/* Tipo de operación */}
                  <div className="flex gap-2">
                    <button onClick={() => setOcPagoTipo('pago')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium transition-all ${ocPagoTipo === 'pago' ? 'bg-accent text-white border-accent' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-accent'}`}>
                      <CheckCircle size={14} /> Registrar pago
                    </button>
                    <button onClick={() => setOcPagoTipo('cc')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium transition-all ${ocPagoTipo === 'cc' ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400'}`}>
                      <CreditCard size={14} /> Cuenta corriente
                    </button>
                  </div>

                  {ocPagoTipo === 'pago' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Medios de pago</label>
                        <div className="space-y-2">
                          {ocMediosPago.map((m, i) => (
                            <div key={i} className="flex gap-2 items-center">
                              <select value={m.tipo}
                                onChange={e => setOcMediosPago(prev => prev.map((x, j) => j === i ? { ...x, tipo: e.target.value } : x))}
                                className="flex-1 px-2 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                                {MEDIOS_OC.map(t => <option key={t}>{t}</option>)}
                              </select>
                              <input type="number" onWheel={e => e.currentTarget.blur()}
                                value={m.monto} onChange={e => setOcMediosPago(prev => prev.map((x, j) => j === i ? { ...x, monto: e.target.value } : x))}
                                placeholder="$0"
                                className="w-28 px-2 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              {ocMediosPago.length > 1 && (
                                <button onClick={() => setOcMediosPago(prev => prev.filter((_, j) => j !== i))}
                                  className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                              )}
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setOcMediosPago(prev => [...prev, { tipo: 'Transferencia', monto: '' }])}
                          className="mt-2 flex items-center gap-1 text-xs text-accent hover:underline">
                          <Plus size={12} /> Agregar medio
                        </button>
                      </div>
                      {(() => {
                        const total = ocMediosPago.reduce((s, m) => s + (parseFloat(m.monto.replace(',', '.')) || 0), 0)
                        const saldo = calcMontoTotalOC(ocSeleccionada) - Number(ocSeleccionada.monto_pagado ?? 0)
                        return (
                          <>
                            {total > 0 && (
                              <div className="flex justify-between text-sm font-semibold">
                                <span className="text-gray-600 dark:text-gray-400">Total a pagar</span>
                                <span className={total > saldo + 0.5 ? 'text-red-500' : 'text-accent'}>${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                              </div>
                            )}
                            {ocMediosPago.some(m => m.tipo === 'Efectivo') && (cajasAbiertasOC as any[]).length === 0 && (
                              <p className="text-xs text-amber-600 dark:text-amber-400">⚠ No hay caja abierta. El egreso en efectivo no se registrará en caja.</p>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Días de plazo</label>
                        <div className="flex gap-2">
                          {['30','60','90'].map(d => (
                            <button key={d} onClick={() => setOcPagoDias(d)}
                              className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${ocPagoDias === d ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400'}`}>
                              {d}d
                            </button>
                          ))}
                          <input type="number" onWheel={e => e.currentTarget.blur()} value={ocPagoDias} onChange={e => setOcPagoDias(e.target.value)}
                            className="w-20 px-2 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-center focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        </div>
                        {ocPagoDias && (
                          <p className="text-xs text-gray-400 mt-1">
                            Vence: {(() => { const d = new Date(); d.setDate(d.getDate() + (parseInt(ocPagoDias) || 30)); return d.toLocaleDateString('es-AR') })()}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Condiciones (opcional)</label>
                        <input type="text" value={ocPagoCondiciones} onChange={e => setOcPagoCondiciones(e.target.value)}
                          placeholder="Ej: 50% a 30d + 50% a 60d"
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 px-5 pb-5">
                  <button onClick={() => setOcModalId(null)} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Cancelar</button>
                  <button onClick={registrarPagoOC}
                    disabled={ocGuardando || (ocPagoTipo === 'pago' && !ocMediosPago.some(m => parseFloat(m.monto.replace(',','.')) > 0))}
                    className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent/90 disabled:opacity-50">
                    {ocGuardando ? 'Guardando…' : ocPagoTipo === 'pago' ? 'Confirmar pago' : 'Asignar a CC'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
