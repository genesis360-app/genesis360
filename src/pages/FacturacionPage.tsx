import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Receipt, BarChart2, BookOpen, Scale, Plus, Send, CheckCircle,
  AlertTriangle, Download, X, ChevronDown, Filter, RefreshCw,
  FileText, ExternalLink, Info, Building, Calendar,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { generarFacturaPDF, normalizarCondIVA } from '@/lib/facturasPDF'
import toast from 'react-hot-toast'

type Tab = 'panel' | 'emitir' | 'libros' | 'liquidacion'
type LibroSubTab = 'ventas' | 'compras'

const TIPO_COMPROBANTE_OPTS = [
  { value: 'B', label: 'Factura B — Consumidor Final / Monotributista' },
  { value: 'A', label: 'Factura A — Responsable Inscripto' },
  { value: 'C', label: 'Factura C — Emisor Monotributista' },
]

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function mesLabel(m: string) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })
}

const DISCLAIMER = `Los valores de IVA mostrados son de carácter estimado, basados en los datos ingresados por el usuario. Genesis360 no reemplaza la labor de un profesional contable matriculado ni constituye representación contable legal ante ARCA/AFIP. La emisión de comprobantes depende de la disponibilidad de los servicios de ARCA y del proveedor del SDK.`

export default function FacturacionPage() {
  const { tenant, user } = useAuthStore()
  const { limits } = usePlanLimits()
  const qc = useQueryClient()

  const [tab, setTab]               = useState<Tab>('panel')
  const [libroSub, setLibroSub]     = useState<LibroSubTab>('ventas')
  const [periodoDesde, setPeriodoDesde] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [periodoHasta, setPeriodoHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [filtroAlicuota, setFiltroAlicuota] = useState('')
  const [showEmitirModal, setShowEmitirModal] = useState(false)
  const [ventaAFacturar, setVentaAFacturar]   = useState<any | null>(null)
  const [tipoComprobante, setTipoComprobante]  = useState('B')
  const [puntoVenta, setPuntoVenta]            = useState(1)
  const [emitiendo, setEmitiendo]              = useState(false)
  const [descargandoPdf, setDescargandoPdf]    = useState<string | null>(null)

  async function descargarFacturaPDF(facturaId: string) {
    setDescargandoPdf(facturaId)
    try {
      const { data: venta } = await supabase.from('ventas')
        .select('*, clientes(*), venta_items(descripcion, cantidad, precio_unitario, subtotal, alicuota_iva, iva_monto, productos(nombre))')
        .eq('id', facturaId).single()
      if (!venta) throw new Error('Venta no encontrada')

      const { data: pv } = await supabase.from('puntos_venta_afip')
        .select('numero').eq('tenant_id', tenant!.id).eq('activo', true)
        .order('numero').limit(1).maybeSingle()

      await generarFacturaPDF({
        tipo_comprobante:  venta.tipo_comprobante ?? 'B',
        numero_comprobante: venta.numero_comprobante ?? venta.numero,
        punto_venta:       pv?.numero ?? 1,
        fecha:             venta.created_at,
        cae:               venta.cae,
        vencimiento_cae:   venta.vencimiento_cae ?? '',
        emisor_razon_social: (config as any)?.razon_social_fiscal ?? tenant?.nombre ?? '',
        emisor_cuit:       (config as any)?.cuit ?? '',
        emisor_domicilio:  (tenant as any)?.domicilio_fiscal,
        emisor_condicion_iva: (config as any)?.condicion_iva_emisor ?? 'responsable_inscripto',
        receptor_nombre:   venta.clientes?.nombre ?? 'Consumidor Final',
        receptor_cuit_dni: venta.clientes?.cuit_receptor ?? venta.clientes?.dni,
        receptor_condicion_iva: normalizarCondIVA(venta.clientes?.condicion_iva_receptor),
        items: (venta.venta_items ?? []).map((i: any) => ({
          descripcion:    i.descripcion ?? i.productos?.nombre ?? 'Producto',
          cantidad:       Number(i.cantidad),
          precio_unitario: Number(i.precio_unitario),
          alicuota_iva:   Number(i.alicuota_iva ?? 21),
          subtotal:       Number(i.subtotal),
        })),
        total: Number(venta.total),
      })
    } catch (e: any) {
      toast.error(`Error al generar PDF: ${e.message}`)
    } finally {
      setDescargandoPdf(null)
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: config } = useQuery({
    queryKey: ['facturacion-config', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('tenants')
        .select('facturacion_habilitada, condicion_iva_emisor, razon_social_fiscal, cuit, umbral_factura_b')
        .eq('id', tenant!.id).single()
      return data
    },
    enabled: !!tenant,
  })

  const { data: puntosVenta = [] } = useQuery({
    queryKey: ['puntos-venta-afip', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('puntos_venta_afip')
        .select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('numero')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Ventas sin CAE (borradores para Tab 2)
  const { data: borradoresFact = [], isLoading: loadingBorr } = useQuery({
    queryKey: ['ventas-sin-cae', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('id, numero, total, estado, created_at, tipo_comprobante, cae, clientes(nombre,cuit_receptor,condicion_iva_receptor), venta_items(cantidad, precio_unitario, subtotal, alicuota_iva, productos(nombre))')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'despachada')
        .is('cae', null)
        .order('created_at', { ascending: false })
        .limit(50)
      return data ?? []
    },
    enabled: !!tenant && tab === 'emitir',
  })

  // Facturas ya emitidas
  const { data: emitidas = [] } = useQuery({
    queryKey: ['facturas-emitidas', tenant?.id, periodoDesde, periodoHasta],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('id, numero, total, cae, vencimiento_cae, tipo_comprobante, numero_comprobante, created_at, clientes(nombre)')
        .eq('tenant_id', tenant!.id)
        .not('cae', 'is', null)
        .gte('created_at', periodoDesde)
        .lte('created_at', periodoHasta + 'T23:59:59')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'emitir',
  })

  // Datos para Libro IVA Ventas
  const { data: ivaVentas = [] } = useQuery({
    queryKey: ['iva-ventas', tenant?.id, periodoDesde, periodoHasta, filtroAlicuota],
    queryFn: async () => {
      let q = supabase.from('venta_items')
        .select('cantidad, precio_unitario, subtotal, alicuota_iva, iva_monto, ventas!inner(numero, created_at, cae, tipo_comprobante, clientes(nombre))')
        .eq('ventas.tenant_id', tenant!.id)
        .gte('ventas.created_at', periodoDesde)
        .lte('ventas.created_at', periodoHasta + 'T23:59:59')
        .not('ventas.cae', 'is', null)
      if (filtroAlicuota) q = q.eq('alicuota_iva', filtroAlicuota)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'libros' && libroSub === 'ventas',
  })

  // Datos para Libro IVA Compras
  const { data: ivaCompras = [] } = useQuery({
    queryKey: ['iva-compras', tenant?.id, periodoDesde, periodoHasta],
    queryFn: async () => {
      const { data } = await supabase.from('gastos')
        .select('id, descripcion, monto, iva_monto, tipo_iva, iva_deducible, conciliado_iva, fecha, categoria')
        .eq('tenant_id', tenant!.id)
        .eq('iva_deducible', true)
        .gt('iva_monto', 0)
        .gte('fecha', periodoDesde)
        .lte('fecha', periodoHasta)
        .order('fecha', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'libros' && libroSub === 'compras',
  })

  // Historial 12 meses para liquidación
  const { data: historial12 = [] } = useQuery({
    queryKey: ['iva-historial-12', tenant?.id],
    queryFn: async () => {
      const rows = []
      const hoy = new Date()
      for (let i = 11; i >= 0; i--) {
        const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
        const desde = d.toISOString().split('T')[0]
        const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
        const periodo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`

        const [{ data: dVentas }, { data: dGastos }] = await Promise.all([
          supabase.from('venta_items').select('iva_monto, ventas!inner(cae)')
            .eq('ventas.tenant_id', tenant!.id)
            .gte('ventas.created_at', desde).lte('ventas.created_at', hasta + 'T23:59:59')
            .not('ventas.cae', 'is', null),
          supabase.from('gastos').select('iva_monto')
            .eq('tenant_id', tenant!.id).eq('iva_deducible', true).gt('iva_monto', 0)
            .gte('fecha', desde).lte('fecha', hasta),
        ])
        const debito  = (dVentas ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
        const credito = (dGastos ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
        rows.push({ periodo, debito, credito, posicion: debito - credito })
      }
      return rows
    },
    enabled: !!tenant && tab === 'liquidacion',
  })

  const { data: retenciones = [] } = useQuery({
    queryKey: ['retenciones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('retenciones_sufridas')
        .select('*').eq('tenant_id', tenant!.id).order('fecha', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'liquidacion',
  })

  // ── KPIs del Panel ────────────────────────────────────────────────────────────
  const { data: kpis } = useQuery({
    queryKey: ['facturacion-kpis', tenant?.id, periodoDesde, periodoHasta],
    queryFn: async () => {
      const [{ data: dVentas }, { data: dGastos }] = await Promise.all([
        supabase.from('venta_items').select('iva_monto, ventas!inner(cae)')
          .eq('ventas.tenant_id', tenant!.id)
          .gte('ventas.created_at', periodoDesde).lte('ventas.created_at', periodoHasta + 'T23:59:59')
          .not('ventas.cae', 'is', null),
        supabase.from('gastos').select('iva_monto')
          .eq('tenant_id', tenant!.id).eq('iva_deducible', true).gt('iva_monto', 0)
          .gte('fecha', periodoDesde).lte('fecha', periodoHasta),
      ])
      const debito  = (dVentas ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
      const credito = (dGastos ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
      return { debito, credito, posicion: debito - credito }
    },
    enabled: !!tenant && tab === 'panel',
  })

  // ── Emitir factura ────────────────────────────────────────────────────────────
  const emitirFactura = async () => {
    if (!ventaAFacturar) return
    setEmitiendo(true)
    try {
      const { data, error } = await supabase.functions.invoke('emitir-factura', {
        body: {
          venta_id:         ventaAFacturar.id,
          tenant_id:        tenant!.id,
          tipo_comprobante: tipoComprobante,
          punto_venta:      puntoVenta,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)

      toast.success(`✅ Factura ${tipoComprobante} emitida — CAE: ${data.cae}`)
      qc.invalidateQueries({ queryKey: ['ventas-sin-cae'] })
      qc.invalidateQueries({ queryKey: ['facturas-emitidas'] })
      qc.invalidateQueries({ queryKey: ['facturacion-kpis'] })
      setShowEmitirModal(false); setVentaAFacturar(null)
    } catch (e: any) {
      toast.error(e.message ?? 'Error al emitir')
    } finally {
      setEmitiendo(false) }
  }

  // ── Conciliar compra ──────────────────────────────────────────────────────────
  const conciliar = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from('gastos').update({ conciliado_iva: val }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['iva-compras'] }),
    onError: (e: any) => toast.error(e.message),
  })

  // ── Exportar Excel ────────────────────────────────────────────────────────────
  const exportarLibroIVA = (tipo: 'ventas' | 'compras') => {
    const wb = XLSX.utils.book_new()
    if (tipo === 'ventas') {
      const rows = (ivaVentas as any[]).map(r => ({
        'Fecha':       (r.ventas as any)?.created_at?.split('T')[0] ?? '',
        'Comprobante': (r.ventas as any)?.tipo_comprobante ?? '',
        'Número':      (r.ventas as any)?.numero ?? '',
        'CAE':         (r.ventas as any)?.cae ?? '',
        'Cliente':     (r.ventas as any)?.clientes?.nombre ?? '',
        'Neto':        Number(r.subtotal ?? 0) - Number(r.iva_monto ?? 0),
        'Alícuota IVA': r.alicuota_iva ?? '',
        'IVA':         Number(r.iva_monto ?? 0),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'IVA Ventas')
    } else {
      const rows = (ivaCompras as any[]).map(r => ({
        'Fecha':       r.fecha,
        'Descripción': r.descripcion,
        'Categoría':   r.categoria ?? '',
        'Monto Total': Number(r.monto),
        'Tipo IVA':    r.tipo_iva ?? '',
        'IVA':         Number(r.iva_monto ?? 0),
        'Neto':        Number(r.monto) - Number(r.iva_monto ?? 0),
        'Conciliado':  r.conciliado_iva ? 'Sí' : 'No',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'IVA Compras')
    }
    XLSX.writeFile(wb, `libro_iva_${tipo}_${periodoDesde}_${periodoHasta}.xlsx`)
  }

  // ── Cálculos ──────────────────────────────────────────────────────────────────
  const totalIvaVentas  = (ivaVentas as any[]).reduce((s, r) => s + Number(r.iva_monto ?? 0), 0)
  const totalIvaCompras = (ivaCompras as any[]).reduce((s, r) => s + Number(r.iva_monto ?? 0), 0)
  const comprasConciliadas = (ivaCompras as any[]).filter(r => r.conciliado_iva).length

  const inputClass = 'border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent'

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Receipt size={22} className="text-accent" /> Facturación
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Facturación electrónica AFIP · {config?.razon_social_fiscal ?? tenant?.nombre}
          </p>
        </div>
        {/* Período */}
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={14} className="text-gray-400" />
          <input type="date" value={periodoDesde} onChange={e => setPeriodoDesde(e.target.value)}
            className={inputClass} />
          <span className="text-gray-400">—</span>
          <input type="date" value={periodoHasta} onChange={e => setPeriodoHasta(e.target.value)}
            className={inputClass} />
        </div>
      </div>

      {/* Aviso si facturación no está habilitada */}
      {config && !config.facturacion_habilitada && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Facturación no habilitada</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              Activá la facturación electrónica en <strong>Configuración → Negocio</strong> y completá los datos fiscales (CUIT, condición IVA, punto de venta).
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'panel'      as Tab, label: 'Panel de control', icon: <BarChart2 size={14} /> },
          { id: 'emitir'     as Tab, label: 'Facturación',      icon: <Send size={14} /> },
          { id: 'libros'     as Tab, label: 'Libros IVA',       icon: <BookOpen size={14} /> },
          { id: 'liquidacion'as Tab, label: 'Liquidación',      icon: <Scale size={14} /> },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ══ TAB 1: PANEL DE CONTROL ══ */}
      {tab === 'panel' && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { label: 'IVA Débito (Ventas)', value: kpis?.debito ?? 0, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', desc: 'IVA de facturas emitidas' },
              { label: 'IVA Crédito (Compras)', value: kpis?.credito ?? 0, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', desc: 'IVA de gastos deducibles' },
              { label: 'Posición mensual', value: Math.abs(kpis?.posicion ?? 0), color: (kpis?.posicion ?? 0) >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400', bg: (kpis?.posicion ?? 0) >= 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20', desc: (kpis?.posicion ?? 0) >= 0 ? 'A pagar (proyectado)' : 'Saldo a favor' },
            ].map(k => (
              <div key={k.label} className={`${k.bg} rounded-xl p-5 border border-gray-100 dark:border-gray-700`}>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">{k.label}</p>
                <p className={`text-3xl font-bold ${k.color}`}>{formatMoneda(k.value)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{k.desc}</p>
              </div>
            ))}
          </div>

          {/* Info fiscal del negocio */}
          {config?.cuit && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <Building size={15} className="text-accent" /> Datos fiscales del negocio
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><p className="text-xs text-gray-400">CUIT</p><p className="font-medium text-gray-800 dark:text-gray-100">{config.cuit}</p></div>
                <div><p className="text-xs text-gray-400">Condición IVA</p><p className="font-medium text-gray-800 dark:text-gray-100">{config.condicion_iva_emisor ?? '—'}</p></div>
                <div><p className="text-xs text-gray-400">Umbral Fact. B</p><p className="font-medium text-gray-800 dark:text-gray-100">{formatMoneda(Number(config.umbral_factura_b ?? 0))}</p></div>
                <div><p className="text-xs text-gray-400">Facturas emitidas</p><p className="font-medium text-gray-800 dark:text-gray-100">{(emitidas as any[]).length}</p></div>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="flex items-start gap-2.5 bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600 rounded-xl p-4 text-xs text-gray-500 dark:text-gray-400">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <p>{DISCLAIMER}</p>
          </div>
        </div>
      )}

      {/* ══ TAB 2: FACTURACIÓN ELECTRÓNICA ══ */}
      {tab === 'emitir' && (
        <div className="space-y-5">
          {/* Borradores — ventas sin CAE */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                Ventas pendientes de facturar
                <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs px-2 py-0.5 rounded-full">
                  {(borradoresFact as any[]).length}
                </span>
              </h2>
            </div>

            {loadingBorr ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" /></div>
            ) : (borradoresFact as any[]).length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <CheckCircle size={32} className="mx-auto mb-2 text-green-500 opacity-60" />
                <p className="text-sm">Todas las ventas están facturadas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(borradoresFact as any[]).map((v: any) => (
                  <div key={v.id} className="bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-800 p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800 dark:text-gray-100">Venta #{v.numero ?? v.id.slice(-6)}</span>
                        <span className="text-xs text-gray-400">{v.created_at?.split('T')[0]}</span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                        {v.clientes?.nombre ?? 'Sin cliente'} · {formatMoneda(Number(v.total ?? 0))}
                      </p>
                    </div>
                    <button
                      onClick={() => { setVentaAFacturar(v); setTipoComprobante('B'); setShowEmitirModal(true) }}
                      disabled={!config?.facturacion_habilitada}
                      className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-xl disabled:opacity-40 transition-all">
                      <Send size={14} /> Emitir factura
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Facturas emitidas */}
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
              <CheckCircle size={16} className="text-green-500" /> Comprobantes emitidos
            </h2>
            {(emitidas as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Sin comprobantes en el período</p>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Tipo</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">N°</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Cliente</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Total</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">CAE</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(emitidas as any[]).map((f: any) => (
                      <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{f.created_at?.split('T')[0]}</td>
                        <td className="px-4 py-3"><span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded">{f.tipo_comprobante ?? '—'}</span></td>
                        <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">{f.numero_comprobante ?? f.numero}</td>
                        <td className="px-4 py-3 text-gray-800 dark:text-gray-100">{f.clientes?.nombre ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-100">{formatMoneda(Number(f.total ?? 0))}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{f.cae?.slice(0, 12)}…</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => descargarFacturaPDF(f.id)}
                            disabled={descargandoPdf === f.id}
                            title="Descargar PDF"
                            className="text-accent hover:text-accent/80 disabled:opacity-40"
                          >
                            {descargandoPdf === f.id
                              ? <RefreshCw size={14} className="animate-spin" />
                              : <Download size={14} />}
                          </button>
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

      {/* ══ TAB 3: LIBROS IVA ══ */}
      {tab === 'libros' && (
        <div className="space-y-4">
          {/* Sub-tabs */}
          <div className="flex gap-2">
            {[
              { id: 'ventas'  as LibroSubTab, label: `IVA Ventas (Débito)` },
              { id: 'compras' as LibroSubTab, label: `IVA Compras (Crédito)` },
            ].map(s => (
              <button key={s.id} onClick={() => setLibroSub(s.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all
                  ${libroSub === s.id ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2 flex-wrap">
            {libroSub === 'ventas' && (
              <div className="relative">
                <select value={filtroAlicuota} onChange={e => setFiltroAlicuota(e.target.value)}
                  className={`${inputClass} appearance-none pr-8`}>
                  <option value="">Todas las alícuotas</option>
                  <option value="21">21%</option>
                  <option value="10.5">10.5%</option>
                  <option value="27">27%</option>
                  <option value="0">0% / Exento</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            )}
            <button onClick={() => exportarLibroIVA(libroSub)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <Download size={14} /> Exportar Excel
            </button>
            {libroSub === 'ventas' && (
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
                Total IVA período: <strong className="text-red-600 dark:text-red-400">{formatMoneda(totalIvaVentas)}</strong>
              </span>
            )}
            {libroSub === 'compras' && (
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
                Deducible: <strong className="text-green-600 dark:text-green-400">{formatMoneda(totalIvaCompras)}</strong>
                {' · '}{comprasConciliadas}/{(ivaCompras as any[]).length} conciliados
              </span>
            )}
          </div>

          {/* Tabla Ventas */}
          {libroSub === 'ventas' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Comprobante</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Cliente</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Neto</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA %</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA $</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(ivaVentas as any[]).length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin datos en el período</td></tr>
                    ) : (ivaVentas as any[]).map((r: any, i: number) => {
                      const neto = Number(r.subtotal ?? 0) - Number(r.iva_monto ?? 0)
                      return (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{(r.ventas as any)?.created_at?.split('T')[0]}</td>
                          <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 text-xs">{(r.ventas as any)?.tipo_comprobante ?? ''} #{(r.ventas as any)?.numero}</td>
                          <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{(r.ventas as any)?.clientes?.nombre ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{formatMoneda(neto)}</td>
                          <td className="px-4 py-2.5 text-center"><span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 rounded">{r.alicuota_iva ?? '—'}%</span></td>
                          <td className="px-4 py-2.5 text-right font-medium text-red-600 dark:text-red-400">{formatMoneda(Number(r.iva_monto ?? 0))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tabla Compras */}
          {libroSub === 'compras' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Descripción</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Categoría</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Neto</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA $</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Conciliado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(ivaCompras as any[]).length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin compras deducibles en el período</td></tr>
                    ) : (ivaCompras as any[]).map((r: any) => {
                      const neto = Number(r.monto) - Number(r.iva_monto ?? 0)
                      return (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{r.fecha}</td>
                          <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{r.descripcion}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">{r.categoria ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{formatMoneda(neto)}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-green-600 dark:text-green-400">{formatMoneda(Number(r.iva_monto ?? 0))}</td>
                          <td className="px-4 py-2.5 text-center">
                            <button onClick={() => conciliar.mutate({ id: r.id, val: !r.conciliado_iva })}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors
                                ${r.conciliado_iva ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-accent'}`}>
                              {r.conciliado_iva && <CheckCircle size={12} />}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ TAB 4: LIQUIDACIÓN ══ */}
      {tab === 'liquidacion' && (
        <div className="space-y-5">
          {/* Historial 12 meses */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">IVA — Últimos 12 meses</h2>
            {(historial12 as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Período</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA Débito</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA Crédito</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Posición</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(historial12 as any[]).map((r: any) => (
                      <tr key={r.periodo} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2.5 font-medium text-gray-800 dark:text-gray-100 capitalize">{mesLabel(r.periodo)}</td>
                        <td className="py-2.5 text-right text-red-600 dark:text-red-400">{formatMoneda(r.debito)}</td>
                        <td className="py-2.5 text-right text-green-600 dark:text-green-400">{formatMoneda(r.credito)}</td>
                        <td className={`py-2.5 text-right font-semibold ${r.posicion >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                          {r.posicion >= 0 ? `A pagar ${formatMoneda(r.posicion)}` : `A favor ${formatMoneda(Math.abs(r.posicion))}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Retenciones */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Retenciones y percepciones sufridas</h2>
            </div>
            {(retenciones as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Sin retenciones cargadas</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="text-left py-2 text-xs font-semibold text-gray-500">Fecha</th>
                    <th className="text-left py-2 text-xs font-semibold text-gray-500">Tipo</th>
                    <th className="text-left py-2 text-xs font-semibold text-gray-500">Agente</th>
                    <th className="text-right py-2 text-xs font-semibold text-gray-500">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {(retenciones as any[]).map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-2 text-gray-500">{r.fecha}</td>
                      <td className="py-2 text-gray-800 dark:text-gray-100">{r.tipo}</td>
                      <td className="py-2 text-gray-600 dark:text-gray-300">{r.agente}</td>
                      <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-100">{formatMoneda(Number(r.monto ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Disclaimer */}
          <div className="flex items-start gap-2.5 bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600 rounded-xl p-4 text-xs text-gray-500 dark:text-gray-400">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <p>{DISCLAIMER}</p>
          </div>
        </div>
      )}

      {/* ══ MODAL: EMITIR FACTURA ══ */}
      {showEmitirModal && ventaAFacturar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Emitir comprobante</h2>
              <button onClick={() => { setShowEmitirModal(false); setVentaAFacturar(null) }}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Info venta */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-sm">
                <p className="font-medium text-gray-800 dark:text-gray-100">
                  Venta #{ventaAFacturar.numero ?? ventaAFacturar.id.slice(-6)}
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  {ventaAFacturar.clientes?.nombre ?? 'Sin cliente'} · {formatMoneda(Number(ventaAFacturar.total ?? 0))}
                </p>
              </div>

              {/* Tipo de comprobante */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de comprobante</label>
                <div className="relative">
                  <select value={tipoComprobante} onChange={e => setTipoComprobante(e.target.value)}
                    className={`w-full appearance-none ${inputClass} pr-8`}>
                    {TIPO_COMPROBANTE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Punto de venta */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Punto de venta</label>
                {(puntosVenta as any[]).length > 0 ? (
                  <div className="relative">
                    <select value={puntoVenta} onChange={e => setPuntoVenta(parseInt(e.target.value))}
                      className={`w-full appearance-none ${inputClass} pr-8`}>
                      {(puntosVenta as any[]).map((pv: any) => (
                        <option key={pv.id} value={pv.numero}>{pv.numero.toString().padStart(4,'0')} — {pv.nombre ?? 'Punto de venta'}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                ) : (
                  <input type="number" value={puntoVenta} onChange={e => setPuntoVenta(parseInt(e.target.value))}
                    min="1" className={`w-full ${inputClass}`} />
                )}
              </div>

              {/* Advertencia si tipo A y sin CUIT */}
              {tipoComprobante === 'A' && !ventaAFacturar.clientes?.cuit_receptor && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2">
                  <AlertTriangle size={13} />
                  El cliente no tiene CUIT cargado. Actualizá su ficha antes de emitir Factura A.
                </div>
              )}
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => { setShowEmitirModal(false); setVentaAFacturar(null) }}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
                Cancelar
              </button>
              <button onClick={emitirFactura}
                disabled={emitiendo || (tipoComprobante === 'A' && !ventaAFacturar.clientes?.cuit_receptor)}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                {emitiendo ? <><RefreshCw size={14} className="animate-spin" /> Emitiendo…</> : <><Send size={14} /> Emitir y obtener CAE</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
