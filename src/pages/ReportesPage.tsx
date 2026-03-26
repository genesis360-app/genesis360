import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BRAND } from '@/config/brand'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import {
  BarChart2, Download, FileSpreadsheet, FileText,
  Package, AlertTriangle, ArrowLeftRight, ShoppingCart,
  TrendingUp, DollarSign, Calendar, Tag, Truck, MapPin, Layers, CornerDownRight
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'

type ReporteId = 'stock' | 'movimientos' | 'ventas' | 'criticos' | 'rotacion' | 'valorizado'

interface ReporteConfig {
  id: ReporteId
  titulo: string
  descripcion: string
  icon: any
  color: string
}

const REPORTES: ReporteConfig[] = [
  { id: 'stock',      titulo: 'Stock actual',          descripcion: 'Listado completo de productos con cantidades por línea',  icon: Package,         color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' },
  { id: 'movimientos',titulo: 'Movimientos',            descripcion: 'Ingresos y rebajes de stock en el período seleccionado',  icon: ArrowLeftRight,  color: 'bg-purple-50 text-purple-600' },
  { id: 'ventas',     titulo: 'Ventas',                 descripcion: 'Ventas por período, por producto y por cliente',          icon: ShoppingCart,    color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' },
  { id: 'criticos',   titulo: 'Productos críticos',     descripcion: 'Productos con stock igual o por debajo del mínimo',       icon: AlertTriangle,   color: 'bg-red-50 dark:bg-red-900/20 text-red-500' },
  { id: 'rotacion',   titulo: 'Rotación de stock',      descripcion: 'Cuánto se vendió de cada producto en el período',         icon: TrendingUp,      color: 'bg-orange-50 text-orange-600' },
  { id: 'valorizado', titulo: 'Inventario valorizado',  descripcion: 'Stock actual multiplicado por precio de costo',           icon: DollarSign,      color: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600' },
]

function formatFecha(fecha: string) {
  return new Date(fecha).toLocaleDateString('es-AR')
}

function formatMoneda(valor: number) {
  return `$${valor.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function ReportesPage() {
  const { limits } = usePlanLimits()
  const { tenant } = useAuthStore()

  if (limits && !limits.puede_reportes) return <UpgradePrompt feature="reportes" />
  const [reporteActivo, setReporteActivo] = useState<ReporteId | null>(null)
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [generando, setGenerando] = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: productos = [] } = useQuery({
    queryKey: ['reporte-productos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('*, categorias(nombre), proveedores(nombre), ubicaciones(nombre)')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: lineas = [] } = useQuery({
    queryKey: ['reporte-lineas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventario_lineas')
        .select('*, estados_inventario(nombre), ubicaciones(nombre), productos(nombre, sku, precio_costo, precio_venta, tiene_series), inventario_series(nro_serie, activo)')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: movimientos = [] } = useQuery({
    queryKey: ['reporte-movimientos', tenant?.id, fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data } = await supabase.from('movimientos_stock')
        .select('*, productos(nombre, sku), users(nombre_display)')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', fechaDesde + 'T00:00:00')
        .lte('created_at', fechaHasta + 'T23:59:59')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: masterCategorias = [] } = useQuery({
    queryKey: ['reporte-master-categorias', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('categorias').select('nombre, descripcion').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: masterProveedores = [] } = useQuery({
    queryKey: ['reporte-master-proveedores', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('proveedores').select('nombre, contacto, telefono, email').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: masterUbicaciones = [] } = useQuery({
    queryKey: ['reporte-master-ubicaciones', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('nombre, descripcion').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: masterEstados = [] } = useQuery({
    queryKey: ['reporte-master-estados', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('nombre, color, es_default').eq('tenant_id', tenant!.id).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: masterMotivos = [] } = useQuery({
    queryKey: ['reporte-master-motivos', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('motivos_movimiento').select('nombre, tipo').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })

  const { data: ventas = [] } = useQuery({
    queryKey: ['reporte-ventas', tenant?.id, fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('*, venta_items(*, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', fechaDesde + 'T00:00:00')
        .lte('created_at', fechaHasta + 'T23:59:59')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  // ── Datos procesados ─────────────────────────────────────────────────────────

  const datosPorReporte = {
    stock: lineas.flatMap((l: any) => {
      const series = (l.inventario_series ?? []).filter((s: any) => s.activo !== false)
      const base = {
        Producto: l.productos?.nombre ?? '',
        SKU: l.productos?.sku ?? '',
        LPN: l.lpn ?? '',
        'N° Lote': l.nro_lote ?? '',
        Vencimiento: l.fecha_vencimiento ? formatFecha(l.fecha_vencimiento) : '',
        Estado: l.estados_inventario?.nombre ?? '',
        Ubicación: l.ubicaciones?.nombre ?? '',
        'Precio costo': l.productos?.precio_costo ?? 0,
        'Precio venta': l.productos?.precio_venta ?? 0,
      }
      if (series.length > 0) {
        return series.map((s: any) => ({ ...base, 'N° Serie': s.nro_serie, Cantidad: 1 }))
      }
      return [{ ...base, 'N° Serie': '', Cantidad: l.cantidad }]
    }),

    movimientos: movimientos.map((m: any) => ({
      Fecha: formatFecha(m.created_at),
      Producto: m.productos?.nombre ?? '',
      SKU: m.productos?.sku ?? '',
      Tipo: m.tipo,
      Cantidad: m.cantidad,
      'Stock anterior': m.stock_antes,
      'Stock nuevo': m.stock_despues,
      Motivo: m.motivo ?? '',
      Usuario: m.users?.nombre_display ?? '',
    })),

    ventas: ventas.map((v: any) => ({
      Fecha: formatFecha(v.created_at),
      'N° Venta': v.numero,
      Cliente: v.cliente_nombre ?? '',
      Estado: v.estado,
      Subtotal: v.subtotal,
      Descuento: v.descuento_total,
      Total: v.total,
      'Medio de pago': (() => {
        try {
          const mp = v.medio_pago
          if (!mp) return ''
          const parsed = typeof mp === 'string' ? JSON.parse(mp) : mp
          if (Array.isArray(parsed)) return parsed.map((m: any) => m.tipo || '').filter(Boolean).join(' + ')
          return String(mp)
        } catch { return String(v.medio_pago ?? '') }
      })(),
    })),

    criticos: productos
      .filter((p: any) => p.stock_actual <= p.stock_minimo)
      .map((p: any) => ({
        Producto: p.nombre,
        SKU: p.sku,
        'Stock actual': p.stock_actual,
        'Stock mínimo': p.stock_minimo,
        Diferencia: p.stock_actual - p.stock_minimo,
        Categoría: p.categorias?.nombre ?? '',
        Proveedor: p.proveedores?.nombre ?? '',
      })),

    rotacion: (() => {
      const ventasPorProducto: Record<string, { nombre: string; sku: string; cantidad: number; total: number }> = {}
      ventas.forEach((v: any) => {
        ;(v.venta_items ?? []).forEach((item: any) => {
          const pid = item.producto_id
          if (!ventasPorProducto[pid]) {
            ventasPorProducto[pid] = { nombre: item.productos?.nombre ?? '', sku: item.productos?.sku ?? '', cantidad: 0, total: 0 }
          }
          ventasPorProducto[pid].cantidad += item.cantidad
          ventasPorProducto[pid].total += item.subtotal
        })
      })
      return Object.values(ventasPorProducto)
        .sort((a, b) => b.cantidad - a.cantidad)
        .map(p => ({
          Producto: p.nombre,
          SKU: p.sku,
          'Unidades vendidas': p.cantidad,
          'Total vendido': p.total,
        }))
    })(),

    valorizado: productos.map((p: any) => ({
      Producto: p.nombre,
      SKU: p.sku,
      'Stock actual': p.stock_actual,
      'Precio costo': p.precio_costo,
      'Valor total costo': p.stock_actual * p.precio_costo,
      'Precio venta': p.precio_venta,
      'Valor total venta': p.stock_actual * p.precio_venta,
      Categoría: p.categorias?.nombre ?? '',
    })),
  }

  const totalesReporte = {
    stock: { total: lineas.reduce((a: number, l: any) => a + (l.cantidad || 0), 0) },
    movimientos: { total: movimientos.length },
    ventas: {
      total: ventas.reduce((a: number, v: any) => a + v.total, 0),
      cantidad: ventas.length,
    },
    criticos: { total: datosPorReporte.criticos.length },
    rotacion: { total: datosPorReporte.rotacion.reduce((a, r) => a + r['Unidades vendidas'], 0) },
    valorizado: {
      costo: productos.reduce((a: number, p: any) => a + p.stock_actual * p.precio_costo, 0),
      venta: productos.reduce((a: number, p: any) => a + p.stock_actual * p.precio_venta, 0),
    },
  }

  // ── Exportar Excel ───────────────────────────────────────────────────────────
  const exportarExcel = (id: ReporteId) => {
    setGenerando(true)
    try {
      const datos = datosPorReporte[id]
      if (datos.length === 0) { toast.error('No hay datos para exportar'); return }

      const reporte = REPORTES.find(r => r.id === id)!
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet(datos)

      // Estilo encabezados
      const cols = Object.keys(datos[0])
      ws['!cols'] = cols.map(() => ({ wch: 20 }))

      // Hoja de info
      const wsInfo = XLSX.utils.aoa_to_sheet([
        [BRAND.name],
        [reporte.titulo],
        [`Generado: ${new Date().toLocaleString('es-AR')}`],
        [`Negocio: ${tenant?.nombre}`],
        [''],
      ])

      XLSX.utils.book_append_sheet(wb, wsInfo, 'Info')
      XLSX.utils.book_append_sheet(wb, ws, reporte.titulo)
      XLSX.writeFile(wb, `stokio_${id}_${new Date().toISOString().split('T')[0]}.xlsx`)
      toast.success('Excel descargado')
    } finally {
      setGenerando(false)
    }
  }

  // ── Exportar PDF ─────────────────────────────────────────────────────────────
  const exportarPDF = (id: ReporteId) => {
    setGenerando(true)
    try {
      const datos = datosPorReporte[id]
      if (datos.length === 0) { toast.error('No hay datos para exportar'); return }

      const reporte = REPORTES.find(r => r.id === id)!
      const doc = new jsPDF({ orientation: datos[0] && Object.keys(datos[0]).length > 6 ? 'landscape' : 'portrait' })

      // Header
      doc.setFillColor(30, 58, 95)
      doc.rect(0, 0, doc.internal.pageSize.width, 25, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(BRAND.name, 14, 12)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text(reporte.titulo, 14, 20)

      // Info
      doc.setTextColor(100, 100, 100)
      doc.setFontSize(9)
      doc.text(`Negocio: ${tenant?.nombre}   |   Generado: ${new Date().toLocaleString('es-AR')}`, 14, 32)

      if (id === 'ventas' || id === 'movimientos') {
        doc.text(`Período: ${fechaDesde} al ${fechaHasta}`, 14, 38)
      }

      const cols = Object.keys(datos[0])
      const rows = datos.map(d => cols.map(c => (d as any)[c]?.toString() ?? ''))

      autoTable(doc, {
        head: [cols],
        body: rows,
        startY: id === 'ventas' || id === 'movimientos' ? 42 : 36,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        margin: { left: 14, right: 14 },
      })

      // Footer
      const pages = (doc as any).internal.getNumberOfPages()
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(150)
        doc.text(`Página ${i} de ${pages}`, doc.internal.pageSize.width - 30, doc.internal.pageSize.height - 8)
      }

      doc.save(`stokio_${id}_${new Date().toISOString().split('T')[0]}.pdf`)
      toast.success('PDF descargado')
    } finally {
      setGenerando(false)
    }
  }

  // ── Exportar Data Master ─────────────────────────────────────────────────────
  const MASTER_ITEMS = [
    { id: 'categorias',  label: 'Categorías',   icon: Tag,          datos: masterCategorias,  cols: ['nombre', 'descripcion'] },
    { id: 'proveedores', label: 'Proveedores',   icon: Truck,        datos: masterProveedores, cols: ['nombre', 'contacto', 'telefono', 'email'] },
    { id: 'ubicaciones', label: 'Ubicaciones',   icon: MapPin,       datos: masterUbicaciones, cols: ['nombre', 'descripcion'] },
    { id: 'estados',     label: 'Estados',       icon: Layers,       datos: masterEstados,     cols: ['nombre', 'color', 'es_default'] },
    { id: 'motivos',     label: 'Motivos',       icon: CornerDownRight, datos: masterMotivos,  cols: ['nombre', 'tipo'] },
  ] as const

  const exportarMaster = (id: string) => {
    const item = MASTER_ITEMS.find(m => m.id === id)
    if (!item) return
    const datos = item.datos as any[]
    if (datos.length === 0) { toast.error('No hay datos para exportar'); return }

    const rows = datos.map(d => {
      const row: Record<string, any> = {}
      item.cols.forEach(c => { row[c] = (d as any)[c] ?? '' })
      return row
    })

    const wb = XLSX.utils.book_new()
    const wsInfo = XLSX.utils.aoa_to_sheet([
      [BRAND.name], [item.label], [`Generado: ${new Date().toLocaleString('es-AR')}`], [`Negocio: ${tenant?.nombre}`], [''],
    ])
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = item.cols.map(() => ({ wch: 24 }))
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Info')
    XLSX.utils.book_append_sheet(wb, ws, item.label)
    XLSX.writeFile(wb, `${BRAND.name.toLowerCase()}_${id}_${new Date().toISOString().split('T')[0]}.xlsx`)
    toast.success(`${item.label} exportado`)
  }

  const reporteSeleccionado = REPORTES.find(r => r.id === reporteActivo)
  const datos = reporteActivo ? datosPorReporte[reporteActivo] : []
  const necesitaFechas = reporteActivo && ['movimientos', 'ventas', 'rotacion'].includes(reporteActivo)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Reportes</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Exportá tus datos en Excel o PDF</p>
      </div>

      {/* Grid de reportes */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTES.map(r => {
          const Icon = r.icon
          const activo = reporteActivo === r.id
          return (
            <button key={r.id} onClick={() => setReporteActivo(activo ? null : r.id)}
              className={`text-left p-4 rounded-xl border-2 transition-all
                ${activo ? 'border-accent bg-blue-50 dark:bg-blue-900/20/50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${r.color}`}>
                <Icon size={20} />
              </div>
              <p className="font-semibold text-gray-800 dark:text-gray-100">{r.titulo}</p>
              <p className="text-xs text-gray-400 dark:text-gray-400 mt-1 leading-relaxed">{r.descripcion}</p>
            </button>
          )
        })}
      </div>

      {/* Sección Data Master */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 dark:text-gray-300 mb-3">Exportar datos maestros</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {MASTER_ITEMS.map(m => {
            const Icon = m.icon
            return (
              <button key={m.id} onClick={() => exportarMaster(m.id)}
                className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-accent hover:shadow-sm transition-all text-left">
                <div className="w-8 h-8 rounded-lg bg-purple-50 text-accent flex items-center justify-center flex-shrink-0">
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{m.label}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400">{(m.datos as any[]).length} registros</p>
                </div>
                <Download size={14} className="text-gray-300 dark:text-gray-600 dark:text-gray-400 ml-auto flex-shrink-0" />
              </button>
            )
          })}
        </div>
      </div>

      {/* Panel del reporte seleccionado */}
      {reporteActivo && reporteSeleccionado && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          {/* Header del panel */}
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${reporteSeleccionado.color}`}>
                <reporteSeleccionado.icon size={18} />
              </div>
              <div>
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">{reporteSeleccionado.titulo}</h2>
                <p className="text-xs text-gray-400 dark:text-gray-400">{datos.length} registros</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Filtro de fechas */}
              {necesitaFechas && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar size={14} className="text-gray-400 dark:text-gray-400" />
                  <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent" />
                  <span className="text-gray-400 dark:text-gray-400">→</span>
                  <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent" />
                </div>
              )}

              {/* Botones de exportación */}
              <button onClick={() => exportarExcel(reporteActivo)} disabled={generando || datos.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
                <FileSpreadsheet size={15} /> Excel
              </button>
              <button onClick={() => exportarPDF(reporteActivo)} disabled={generando || datos.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
                <FileText size={15} /> PDF
              </button>
            </div>
          </div>

          {/* Totales / resumen */}
          {reporteActivo === 'valorizado' && (
            <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700 border-b border-gray-100 dark:border-gray-700">
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400 dark:text-gray-400">Valor total a costo</p>
                <p className="text-xl font-bold text-primary">{formatMoneda(totalesReporte.valorizado.costo)}</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400 dark:text-gray-400">Valor total a precio de venta</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">{formatMoneda(totalesReporte.valorizado.venta)}</p>
              </div>
            </div>
          )}
          {reporteActivo === 'ventas' && (
            <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700 border-b border-gray-100 dark:border-gray-700">
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400 dark:text-gray-400">Ventas en el período</p>
                <p className="text-xl font-bold text-primary">{totalesReporte.ventas.cantidad}</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400 dark:text-gray-400">Total facturado</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">{formatMoneda(totalesReporte.ventas.total)}</p>
              </div>
            </div>
          )}

          {/* Tabla preview */}
          {datos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-400">
              <BarChart2 size={36} className="mb-2 opacity-30" />
              <p className="text-sm">No hay datos para este reporte</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
                  <tr className="border-b border-gray-100 dark:border-gray-600">
                    {Object.keys(datos[0]).map(col => (
                      <th key={col} className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {typeof val === 'number' && (String(Object.keys(row)[j]).includes('precio') || String(Object.keys(row)[j]).includes('total') || String(Object.keys(row)[j]).includes('valor') || String(Object.keys(row)[j]).includes('Total') || String(Object.keys(row)[j]).includes('Valor'))
                            ? formatMoneda(val)
                            : String(val ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {datos.length > 50 && (
                <p className="text-xs text-gray-400 dark:text-gray-400 text-center py-2">
                  Mostrando 50 de {datos.length} registros. Exportá para ver todos.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
