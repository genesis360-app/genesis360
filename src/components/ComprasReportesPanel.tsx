import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { FileSpreadsheet, FileDown, FileText, Star, TrendingUp, Clock, AlertTriangle, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import {
  comprasPorProveedor, topProductosComprados, agingPagos, ocsVencidas, evolucionCostos,
  type OCReporte, type OCItemReporte,
} from '@/lib/comprasReportes'

type Col = { key: string; label: string }
type ExportFmt = 'excel' | 'csv' | 'pdf'

function exportar(fmt: ExportFmt, titulo: string, cols: Col[], rows: any[]) {
  if (!rows.length) { toast.error('No hay datos para exportar'); return }
  const fecha = new Date().toISOString().split('T')[0]
  const fname = `compras_${titulo.toLowerCase().replace(/\s+/g, '_')}_${fecha}`
  if (fmt === 'excel') {
    const data = rows.map(r => Object.fromEntries(cols.map(c => [c.label, r[c.key]])))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Datos')
    XLSX.writeFile(wb, `${fname}.xlsx`)
  } else if (fmt === 'csv') {
    const header = cols.map(c => `"${c.label}"`).join(';')
    const body = rows.map(r => cols.map(c => `"${String(r[c.key] ?? '')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${fname}.csv`; a.click()
  } else {
    const doc = new jsPDF({ orientation: cols.length > 5 ? 'landscape' : 'portrait' })
    doc.setFontSize(13); doc.text(titulo, 14, 16)
    autoTable(doc, {
      startY: 22, head: [cols.map(c => c.label)], body: rows.map(r => cols.map(c => String(r[c.key] ?? ''))),
      theme: 'striped', headStyles: { fillColor: [30, 58, 95] }, styles: { fontSize: 8 },
    })
    doc.save(`${fname}.pdf`)
  }
}

function ExportBtns({ titulo, cols, rows }: { titulo: string; cols: Col[]; rows: any[] }) {
  return (
    <div className="flex gap-1">
      <button onClick={() => exportar('excel', titulo, cols, rows)} title="Excel" className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"><FileSpreadsheet size={14} /></button>
      <button onClick={() => exportar('csv', titulo, cols, rows)} title="CSV" className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"><FileText size={14} /></button>
      <button onClick={() => exportar('pdf', titulo, cols, rows)} title="PDF" className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><FileDown size={14} /></button>
    </div>
  )
}

const fmt$ = (n: number) => `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
const SCORE_CLS: Record<string, string> = {
  A: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  B: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  C: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  '—': 'bg-gray-100 dark:bg-gray-700 text-gray-500',
}

export default function ComprasReportesPanel({ tenant }: { tenant: any }) {
  const hoyISO = new Date().toISOString().split('T')[0]
  const [seccion, setSeccion] = useState<'proveedores' | 'productos' | 'aging' | 'vencidas' | 'costos'>('proveedores')

  const { data: ocs = [], isLoading } = useQuery({
    queryKey: ['compras-reportes', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ordenes_compra')
        .select('id, proveedor_id, estado, estado_pago, monto_total, monto_pagado, monto_descuento, fecha_esperada, fecha_vencimiento_pago, created_at, proveedores:proveedor_id(nombre), orden_compra_items(producto_id, cantidad, precio_unitario, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const ocsRep = useMemo<OCReporte[]>(() => (ocs as any[]).map(o => ({
    id: o.id, proveedor_id: o.proveedor_id, proveedor_nombre: o.proveedores?.nombre,
    estado: o.estado, estado_pago: o.estado_pago, monto_total: o.monto_total, monto_pagado: o.monto_pagado,
    monto_descuento: o.monto_descuento, fecha_esperada: o.fecha_esperada, fecha_vencimiento_pago: o.fecha_vencimiento_pago,
    created_at: o.created_at,
  })), [ocs])

  const items = useMemo<OCItemReporte[]>(() => {
    const out: OCItemReporte[] = []
    for (const o of ocs as any[]) {
      if (o.estado === 'cancelada') continue
      for (const it of (o.orden_compra_items ?? [])) {
        if (!it.producto_id) continue
        out.push({ producto_id: it.producto_id, producto_nombre: it.productos?.nombre, sku: it.productos?.sku, cantidad: it.cantidad, precio_unitario: it.precio_unitario, fecha: o.created_at?.split('T')[0] })
      }
    }
    return out
  }, [ocs])

  const porProveedor = useMemo(() => comprasPorProveedor(ocsRep), [ocsRep])
  const topProductos = useMemo(() => topProductosComprados(items), [items])
  const aging = useMemo(() => agingPagos(ocsRep, hoyISO), [ocsRep, hoyISO])
  const vencidas = useMemo(() => ocsVencidas(ocsRep, hoyISO), [ocsRep, hoyISO])
  const costos = useMemo(() => evolucionCostos(items), [items])

  const SECCIONES = [
    { id: 'proveedores' as const, label: 'Por proveedor', icon: <Star size={13} /> },
    { id: 'productos' as const, label: 'Top productos', icon: <Package size={13} /> },
    { id: 'aging' as const, label: 'Pagos pendientes', icon: <Clock size={13} /> },
    { id: 'vencidas' as const, label: 'OCs vencidas', icon: <AlertTriangle size={13} /> },
    { id: 'costos' as const, label: 'Evolución de costos', icon: <TrendingUp size={13} /> },
  ]

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-text" /></div>

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {SECCIONES.map(s => (
          <button key={s.id} onClick={() => setSeccion(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${seccion === s.id ? 'bg-accent text-white border-accent-text' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      {/* Por proveedor + calificación (G1/E4) */}
      {seccion === 'proveedores' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Compras por proveedor · calificación</h3>
            <ExportBtns titulo="Por proveedor" rows={porProveedor}
              cols={[{ key: 'proveedor_nombre', label: 'Proveedor' }, { key: 'cantidadOCs', label: 'OCs' }, { key: 'montoTotal', label: 'Monto' }, { key: 'recibidas', label: 'Recibidas' }, { key: 'cumplimientoPct', label: 'Cumplimiento %' }, { key: 'score', label: 'Score' }, { key: 'saldoPendiente', label: 'Saldo' }]} />
          </div>
          {porProveedor.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin datos</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2">Proveedor</th><th>OCs</th><th>Monto</th><th>Cumpl.</th><th>Score</th><th>Saldo</th>
                </tr></thead>
                <tbody>
                  {porProveedor.map(r => (
                    <tr key={r.proveedor_id} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="py-2 text-primary dark:text-gray-200">{r.proveedor_nombre}</td>
                      <td>{r.cantidadOCs}</td>
                      <td className="font-medium">{fmt$(r.montoTotal)}</td>
                      <td>{r.cumplimientoPct}%</td>
                      <td><span className={`text-xs px-2 py-0.5 rounded-full font-bold ${SCORE_CLS[r.score]}`}>{r.score}</span></td>
                      <td className={r.saldoPendiente > 0 ? 'text-red-500' : 'text-gray-400'}>{fmt$(r.saldoPendiente)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Top productos (G1) */}
      {seccion === 'productos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Top productos comprados</h3>
            <ExportBtns titulo="Top productos" rows={topProductos}
              cols={[{ key: 'producto_nombre', label: 'Producto' }, { key: 'sku', label: 'SKU' }, { key: 'cantidad', label: 'Cantidad' }, { key: 'monto', label: 'Monto' }]} />
          </div>
          {topProductos.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin datos</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Producto</th><th>SKU</th><th>Cant.</th><th>Monto</th></tr></thead>
                <tbody>
                  {topProductos.map(r => (
                    <tr key={r.producto_id} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="py-2 text-primary dark:text-gray-200">{r.producto_nombre}</td>
                      <td className="text-gray-400">{r.sku}</td><td>{r.cantidad}</td><td className="font-medium">{fmt$(r.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Aging pagos (G1) */}
      {seccion === 'aging' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-primary dark:text-white mb-3">Pagos pendientes por antigüedad (aging)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['0–30 días', aging.bucket_0_30], ['31–60 días', aging.bucket_31_60], ['61–90 días', aging.bucket_61_90], ['+90 días', aging.bucket_91_mas]].map(([label, val], i) => (
              <div key={i} className={`rounded-xl p-3 ${i === 3 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label as string}</p>
                <p className={`text-lg font-bold ${i === 3 ? 'text-red-600 dark:text-red-400' : 'text-primary dark:text-white'}`}>{fmt$(val as number)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 text-right text-sm font-semibold text-primary dark:text-white">Total pendiente: {fmt$(aging.total)}</div>
        </div>
      )}

      {/* OCs vencidas (G1) */}
      {seccion === 'vencidas' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">OCs vencidas (entrega esperada pasada, sin recibir)</h3>
            <ExportBtns titulo="OCs vencidas" rows={vencidas.map(o => ({ proveedor: o.proveedor_nombre, esperada: o.fecha_esperada, monto: o.monto_total }))}
              cols={[{ key: 'proveedor', label: 'Proveedor' }, { key: 'esperada', label: 'Entrega esperada' }, { key: 'monto', label: 'Monto' }]} />
          </div>
          {vencidas.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">No hay OCs vencidas 🎉</p> : (
            <div className="space-y-1.5">
              {vencidas.map(o => (
                <div key={o.id} className="flex items-center justify-between text-sm bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  <span className="text-primary dark:text-gray-200">{o.proveedor_nombre}</span>
                  <span className="text-xs text-red-600 dark:text-red-400">Esperada: {o.fecha_esperada} · {fmt$(o.monto_total || 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Evolución de costos (G1) */}
      {seccion === 'costos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Evolución de costos por producto</h3>
            <ExportBtns titulo="Evolución de costos" rows={costos}
              cols={[{ key: 'producto_nombre', label: 'Producto' }, { key: 'sku', label: 'SKU' }, { key: 'primerPrecio', label: 'Primer precio' }, { key: 'ultimoPrecio', label: 'Último precio' }, { key: 'variacionPct', label: 'Variación %' }, { key: 'compras', label: 'Compras' }]} />
          </div>
          {costos.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Se necesitan al menos 2 compras de un producto para ver su evolución.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Producto</th><th>1er precio</th><th>Último</th><th>Variación</th></tr></thead>
                <tbody>
                  {costos.map(r => (
                    <tr key={r.producto_id} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="py-2 text-primary dark:text-gray-200">{r.producto_nombre}</td>
                      <td>{fmt$(r.primerPrecio)}</td><td>{fmt$(r.ultimoPrecio)}</td>
                      <td className={r.variacionPct > 0 ? 'text-red-500 font-medium' : r.variacionPct < 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                        {r.variacionPct > 0 ? '+' : ''}{r.variacionPct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
