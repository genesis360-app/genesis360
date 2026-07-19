// Reportes de Caja — Fase 2.4 / HITO v1.10.0 (I1/I2 del relevamiento)
// 4 sub-tabs: Diario por caja · Diario consolidado · Mensual por sucursal · Por cajero
// 3 exports: Excel · PDF · CSV

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { formatMoneda as formatMonedaLib } from '@/lib/formato'
import { BRAND } from '@/config/brand'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { Calendar, FileSpreadsheet, FileText, Download, Building2, Users, BarChart3 } from 'lucide-react'

type SubTab = 'diario_caja' | 'consolidado' | 'mensual' | 'cajero'

export default function CajaReportes() {
  const { tenant } = useAuthStore()
  const { sucursales, sucursalId } = useSucursalFilter()
  const formatMoneda = (v: number) => formatMonedaLib(v, (tenant as any)?.moneda ?? 'ARS')

  const [sub, setSub] = useState<SubTab>('diario_caja')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [filtroSucursalId, setFiltroSucursalId] = useState<string>('')

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: rDiarioCaja = [], isLoading: lDiario } = useQuery<any[]>({
    queryKey: ['rep-caja-diario', tenant?.id, fechaDesde, fechaHasta, filtroSucursalId || sucursalId],
    queryFn: async () => {
      let q = supabase.from('vw_caja_resumen_diario')
        .select('*').eq('tenant_id', tenant!.id)
        .gte('fecha', fechaDesde).lte('fecha', fechaHasta)
        .order('fecha', { ascending: false }).order('caja_nombre')
      const sucFiltro = filtroSucursalId || sucursalId
      if (sucFiltro) q = q.eq('sucursal_id', sucFiltro)
      const { data } = await q.limit(1000)
      return data ?? []
    },
    enabled: !!tenant && sub === 'diario_caja',
  })

  const { data: rConsolidado = [], isLoading: lConsolidado } = useQuery<any[]>({
    queryKey: ['rep-caja-consolidado', tenant?.id, fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data } = await supabase.from('vw_caja_resumen_diario')
        .select('*').eq('tenant_id', tenant!.id)
        .gte('fecha', fechaDesde).lte('fecha', fechaHasta)
        .order('fecha', { ascending: false }).limit(2000)
      // Agregar consolidado por fecha en frontend (suma todas las cajas del día)
      const agg: Record<string, any> = {}
      for (const r of (data ?? [])) {
        const key = r.fecha
        if (!agg[key]) agg[key] = {
          fecha: r.fecha, sesiones: 0, ingresos: 0, egresos: 0, ventas: 0,
          saldo_sistema: 0, conteo_real: 0, diferencia: 0, cajas: 0,
        }
        agg[key].sesiones += r.sesiones_count
        agg[key].ingresos += Number(r.total_ingresos)
        agg[key].egresos  += Number(r.total_egresos)
        agg[key].ventas   += Number(r.total_ventas)
        agg[key].saldo_sistema += Number(r.saldo_sistema)
        agg[key].conteo_real += Number(r.conteo_real)
        agg[key].diferencia += Number(r.diferencia_total)
        agg[key].cajas++
      }
      return Object.values(agg).sort((a: any, b: any) => b.fecha.localeCompare(a.fecha))
    },
    enabled: !!tenant && sub === 'consolidado',
  })

  const { data: rMensual = [], isLoading: lMensual } = useQuery<any[]>({
    queryKey: ['rep-caja-mensual', tenant?.id, fechaDesde, fechaHasta, filtroSucursalId],
    queryFn: async () => {
      let q = supabase.from('vw_caja_mensual_por_sucursal')
        .select('*').eq('tenant_id', tenant!.id)
        .gte('periodo', fechaDesde.substring(0, 7) + '-01')
        .lte('periodo', fechaHasta.substring(0, 7) + '-01')
        .order('periodo', { ascending: false }).order('sucursal_nombre')
      if (filtroSucursalId) q = q.eq('sucursal_id', filtroSucursalId)
      const { data } = await q.limit(500)
      return data ?? []
    },
    enabled: !!tenant && sub === 'mensual',
  })

  const { data: rCajero = [], isLoading: lCajero } = useQuery<any[]>({
    queryKey: ['rep-caja-cajero', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('vw_diferencias_por_cajero')
        .select('*').eq('tenant_id', tenant!.id)
        .order('diferencia_absoluta_acumulada', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && sub === 'cajero',
  })

  // ── Datos del sub-tab activo ─────────────────────────────────────────────
  const { datos, isLoading, columnas, tituloReporte } = useMemo(() => {
    switch (sub) {
      case 'diario_caja':
        return {
          datos: rDiarioCaja,
          isLoading: lDiario,
          columnas: ['fecha','sucursal_nombre','caja_nombre','moneda','sesiones_count','total_ingresos','total_egresos','total_ventas','saldo_sistema','conteo_real','diferencia_total'],
          tituloReporte: 'Diario por caja',
        }
      case 'consolidado':
        return {
          datos: rConsolidado,
          isLoading: lConsolidado,
          columnas: ['fecha','cajas','sesiones','ingresos','egresos','ventas','saldo_sistema','conteo_real','diferencia'],
          tituloReporte: 'Diario consolidado (todas las cajas)',
        }
      case 'mensual':
        return {
          datos: rMensual,
          isLoading: lMensual,
          columnas: ['periodo','sucursal_nombre','sesiones_count','sesiones_cerradas','total_ingresos','total_egresos','total_ventas','diferencia_total','cajas_activas','cajeros_distintos'],
          tituloReporte: 'Mensual por sucursal',
        }
      case 'cajero':
        return {
          datos: rCajero,
          isLoading: lCajero,
          columnas: ['cajero','cierres_count','cierres_con_diferencia','diferencia_neta_acumulada','diferencia_absoluta_acumulada','diferencia_maxima'],
          tituloReporte: 'Por cajero (últimos 30 días)',
        }
    }
  }, [sub, rDiarioCaja, rConsolidado, rMensual, rCajero, lDiario, lConsolidado, lMensual, lCajero])

  const COL_LABELS: Record<string, string> = {
    fecha: 'Fecha', periodo: 'Período', sucursal_nombre: 'Sucursal', caja_nombre: 'Caja', moneda: 'Moneda',
    sesiones_count: 'Sesiones', sesiones_cerradas: 'Cerradas', sesiones: 'Sesiones',
    total_apertura: 'Apertura', total_ingresos: 'Ingresos', total_egresos: 'Egresos',
    total_ventas: 'Ventas', saldo_sistema: 'Saldo sistema', conteo_real: 'Conteo real',
    diferencia_total: 'Diferencia', diferencia_absoluta: 'Dif. absoluta',
    cajas: 'Cajas', cajas_activas: 'Cajas activas', cajeros_distintos: 'Cajeros',
    ingresos: 'Ingresos', egresos: 'Egresos', ventas: 'Ventas', diferencia: 'Diferencia',
    cajero: 'Cajero', cierres_count: 'Cierres', cierres_con_diferencia: 'Con dif',
    diferencia_neta_acumulada: 'Neto 30d', diferencia_absoluta_acumulada: 'Absoluto 30d',
    diferencia_maxima: 'Máx individual',
  }

  const COLS_MONETARIAS = new Set([
    'total_apertura','total_ingresos','total_egresos','total_ventas','saldo_sistema','conteo_real',
    'diferencia_total','diferencia_absoluta','ingresos','egresos','ventas','diferencia',
    'diferencia_neta_acumulada','diferencia_absoluta_acumulada','diferencia_maxima',
  ])

  // Columnas de SALDO puntual / máximo: NO son aditivas entre filas (días, cajeros).
  // Sumarlas en la fila "Totales" daría un número sin sentido (p.ej. sumar el cierre
  // de cada día no es "el efectivo total"). Se muestran en cada fila pero no se totalizan.
  const COLS_NO_ADITIVAS = new Set([
    'total_apertura','saldo_sistema','conteo_real','diferencia_maxima',
  ])

  const fmtCell = (val: any, col: string) => {
    if (val == null) return '—'
    if (COLS_MONETARIAS.has(col)) return formatMoneda(Number(val))
    if (col === 'periodo') return new Date(val).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    if (col === 'fecha') return new Date(val).toLocaleDateString('es-AR')
    return String(val)
  }

  // ── Totales fila inferior ───────────────────────────────────────────────
  const totales = useMemo(() => {
    const t: Record<string, number> = {}
    for (const col of columnas) {
      if (COLS_MONETARIAS.has(col) && !COLS_NO_ADITIVAS.has(col)) {
        t[col] = datos.reduce((acc: number, r: any) => acc + Number(r[col] || 0), 0)
      }
    }
    return t
  }, [datos, columnas])

  // ── Exports ─────────────────────────────────────────────────────────────
  const exportarExcel = () => {
    if (datos.length === 0) { toast.error('No hay datos para exportar'); return }
    const dataExport = datos.map((r: any) => {
      const fila: any = {}
      for (const c of columnas) fila[COL_LABELS[c] ?? c] = r[c]
      return fila
    })
    const wb = XLSX.utils.book_new()
    const wsInfo = XLSX.utils.aoa_to_sheet([
      [BRAND.name],
      [`Reporte: ${tituloReporte}`],
      [`Período: ${fechaDesde} a ${fechaHasta}`],
      [`Generado: ${new Date().toLocaleString('es-AR')}`],
      [`Negocio: ${tenant?.nombre ?? ''}`],
      [''],
    ])
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Info')
    const ws = XLSX.utils.json_to_sheet(dataExport)
    ws['!cols'] = columnas.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Datos')
    XLSX.writeFile(wb, `caja_${sub}_${new Date().toISOString().split('T')[0]}.xlsx`)
    toast.success('Excel descargado')
  }

  const exportarPDF = () => {
    if (datos.length === 0) { toast.error('No hay datos para exportar'); return }
    const doc = new jsPDF({ orientation: columnas.length > 6 ? 'landscape' : 'portrait' })
    doc.setFillColor(30, 58, 95); doc.rect(0, 0, doc.internal.pageSize.width, 25, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont('helvetica', 'bold')
    doc.text(BRAND.name, 14, 12)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    doc.text(`Reporte de Caja: ${tituloReporte}`, 14, 20)
    doc.setTextColor(60, 60, 60); doc.setFontSize(9)
    doc.text(`Período: ${fechaDesde} a ${fechaHasta} · Generado: ${new Date().toLocaleString('es-AR')}`, 14, 32)
    autoTable(doc, {
      startY: 38,
      head: [columnas.map(c => COL_LABELS[c] ?? c)],
      body: datos.map((r: any) => columnas.map(c => fmtCell(r[c], c))),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 58, 95], fontSize: 8 },
    })
    doc.save(`caja_${sub}_${new Date().toISOString().split('T')[0]}.pdf`)
    toast.success('PDF descargado')
  }

  const exportarCSV = () => {
    if (datos.length === 0) { toast.error('No hay datos para exportar'); return }
    const header = columnas.map(c => `"${COL_LABELS[c] ?? c}"`).join(',')
    const rows = datos.map((r: any) =>
      columnas.map(c => {
        const v = r[c]
        if (v == null) return ''
        if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`
        return String(v)
      }).join(',')
    )
    const csv = '﻿' + [header, ...rows].join('\n')  // BOM para Excel ES
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `caja_${sub}_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('CSV descargado')
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const SUBS: { id: SubTab; label: string; icon: any }[] = [
    { id: 'diario_caja', label: 'Diario por caja',   icon: Calendar },
    { id: 'consolidado', label: 'Diario consolidado', icon: BarChart3 },
    { id: 'mensual',     label: 'Mensual por sucursal', icon: Building2 },
    { id: 'cajero',      label: 'Por cajero',         icon: Users },
  ]

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {SUBS.map(s => {
          const Icon = s.icon
          const activo = sub === s.id
          return (
            <button key={s.id} onClick={() => setSub(s.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${activo ? 'border-accent-text text-accent-text' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              <Icon size={14} /> {s.label}
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-wrap items-end gap-3">
        {sub !== 'cajero' && (
          <>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Desde</label>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Hasta</label>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700" />
            </div>
          </>
        )}
        {(sub === 'diario_caja' || sub === 'mensual') && sucursales.length > 1 && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Sucursal</label>
            <select value={filtroSucursalId} onChange={e => setFiltroSucursalId(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700">
              <option value="">Todas</option>
              {sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="flex-1 min-w-[100px]" />
        <div className="flex gap-2">
          <button onClick={exportarExcel} disabled={datos.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40 disabled:cursor-not-allowed">
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button onClick={exportarPDF} disabled={datos.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed">
            <FileText size={13} /> PDF
          </button>
          <button onClick={exportarCSV} disabled={datos.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{tituloReporte}</p>
          <span className="text-xs text-gray-500 dark:text-gray-400">{datos.length} filas</span>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Cargando...</p>
        ) : datos.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin datos en el período seleccionado</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/30 sticky top-0">
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
                  {columnas.map(c => (
                    <th key={c} className={`px-3 py-2 font-medium ${COLS_MONETARIAS.has(c) ? 'text-right' : ''}`}>
                      {COL_LABELS[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {datos.map((r: any, idx: number) => (
                  <tr key={idx} className="text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    {columnas.map(c => {
                      const esDif = c === 'diferencia_total' || c === 'diferencia' || c === 'diferencia_neta_acumulada'
                      const val = Number(r[c] || 0)
                      const colorDif = esDif && val < 0 ? 'text-red-600 dark:text-red-400' : esDif && val > 0 ? 'text-green-600 dark:text-green-400' : ''
                      return (
                        <td key={c} className={`px-3 py-2 ${COLS_MONETARIAS.has(c) ? 'text-right tabular-nums' : ''} ${colorDif}`}>
                          {fmtCell(r[c], c)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              {Object.keys(totales).length > 0 && datos.length > 1 && (
                <tfoot className="bg-gray-50 dark:bg-gray-700/30 font-semibold">
                  <tr>
                    {columnas.map((c, idx) => (
                      <td key={c} className={`px-3 py-2 text-xs text-gray-700 dark:text-gray-200 ${COLS_MONETARIAS.has(c) ? 'text-right tabular-nums' : ''}`}>
                        {idx === 0 ? 'Totales' : (COLS_MONETARIAS.has(c) && !COLS_NO_ADITIVAS.has(c)) ? formatMoneda(totales[c]) : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
