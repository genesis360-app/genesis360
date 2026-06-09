import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  FileSpreadsheet, FileDown, FileText, Truck, Clock, DollarSign, MapPin, Users, AlertTriangle, Package,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import {
  pendientesAtrasados, cumplimientoPorCourier, pagosCourierPorMes,
  margenLogistico, distribucionPorZona, alertasEnvios,
  type EnvioReporte,
} from '@/lib/enviosReportes'
import { productividadRepartidor } from '@/lib/enviosReparto'

type Col = { key: string; label: string }
type ExportFmt = 'excel' | 'csv' | 'pdf'

function exportar(fmt: ExportFmt, titulo: string, cols: Col[], rows: any[]) {
  if (!rows.length) { toast.error('No hay datos para exportar'); return }
  const fecha = new Date().toISOString().split('T')[0]
  const fname = `envios_${titulo.toLowerCase().replace(/\s+/g, '_')}_${fecha}`
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
const card = 'bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4'

export default function EnviosReportesPanel({ tenant, sucursalId }: { tenant: any; sucursalId?: string | null }) {
  const [seccion, setSeccion] = useState<'alertas' | 'pendientes' | 'couriers' | 'pagos' | 'margen' | 'zonas' | 'repartidores'>('alertas')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['envios-reportes', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('envios')
        .select('id, numero, estado, courier, repartidor_id, zona_entrega, costo_cotizado, costo_real, costo_pagado, fecha_pago_courier, pod_fecha, diferencia_tipo, diferencia_monto, created_at, ventas(costo_envio), cliente_domicilios:destino_id(codigo_postal)')
        .eq('tenant_id', tenant!.id)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: repartidores = [] } = useQuery({
    queryKey: ['repartidores-reportes', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('repartidores').select('id, nombre').eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const envios = useMemo<EnvioReporte[]>(() => (rows as any[]).map(e => ({
    id: e.id, numero: e.numero, estado: e.estado, courier: e.courier, repartidor_id: e.repartidor_id,
    zona_entrega: e.zona_entrega, codigo_postal: e.cliente_domicilios?.codigo_postal,
    costo_cotizado: e.costo_cotizado, costo_real: e.costo_real, costo_pagado: e.costo_pagado,
    fecha_pago_courier: e.fecha_pago_courier, venta_costo_envio: e.ventas?.costo_envio,
    pod_fecha: e.pod_fecha, diferencia_tipo: e.diferencia_tipo, diferencia_monto: e.diferencia_monto,
    created_at: e.created_at,
  })), [rows])

  const repNombre = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of repartidores as any[]) m.set(r.id, r.nombre)
    return m
  }, [repartidores])

  const cfg = {
    sinDespachoHoras: Number((tenant as any)?.envio_alerta_sin_despacho_horas ?? 24),
    podPendienteDias: Number((tenant as any)?.envio_alerta_pod_pendiente_dias ?? 3),
    pagoCourierDias: Number((tenant as any)?.envio_alerta_pago_courier_dias ?? 7),
    diferenciaPct: Number((tenant as any)?.envio_alerta_diferencia_pct ?? 15),
  }

  const pend = useMemo(() => pendientesAtrasados(envios, cfg.sinDespachoHoras), [envios, cfg.sinDespachoHoras])
  const couriers = useMemo(() => cumplimientoPorCourier(envios), [envios])
  const pagos = useMemo(() => pagosCourierPorMes(envios), [envios])
  const margen = useMemo(() => margenLogistico(envios), [envios])
  const zonas = useMemo(() => distribucionPorZona(envios), [envios])
  const alertas = useMemo(() => alertasEnvios(envios, cfg), [envios, cfg])
  const prod = useMemo(() => productividadRepartidor(envios.map(e => ({ id: e.id, repartidor_id: e.repartidor_id, estado: e.estado }))), [envios])

  const SECCIONES = [
    { id: 'alertas' as const, label: 'Alertas', icon: <AlertTriangle size={13} />, badge: alertas.total || undefined },
    { id: 'pendientes' as const, label: 'Pendientes', icon: <Clock size={13} />, badge: pend.atrasados || undefined },
    { id: 'couriers' as const, label: 'Por courier', icon: <Truck size={13} /> },
    { id: 'pagos' as const, label: 'Pagos courier', icon: <DollarSign size={13} /> },
    { id: 'margen' as const, label: 'Margen logístico', icon: <DollarSign size={13} /> },
    { id: 'zonas' as const, label: 'Por zona', icon: <MapPin size={13} /> },
    { id: 'repartidores' as const, label: 'Repartidores', icon: <Users size={13} /> },
  ]

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" /></div>

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {SECCIONES.map(s => (
          <button key={s.id} onClick={() => setSeccion(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${seccion === s.id ? 'bg-accent text-white border-accent' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {s.icon}{s.label}
            {s.badge ? <span className={`ml-1 text-xs px-1.5 rounded-full ${seccion === s.id ? 'bg-white/25' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300'}`}>{s.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* H2 — Alertas */}
      {seccion === 'alertas' && (
        <div className="space-y-3">
          {alertas.total === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin alertas de envíos 🎉</p> : null}
          {([
            ['Sin despachar', alertas.sinDespachar, `+${cfg.sinDespachoHoras}h`],
            ['POD pendiente', alertas.podPendiente, `+${cfg.podPendienteDias}d`],
            ['Pago a courier pendiente', alertas.pagoCourierPendiente, `+${cfg.pagoCourierDias}d`],
            ['Diferencia cotizado vs real', alertas.diferenciaImportante, `≥${cfg.diferenciaPct}%`],
          ] as const).map(([titulo, items, umbral]) => items.length > 0 && (
            <div key={titulo} className={card}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-primary dark:text-white flex items-center gap-2"><AlertTriangle size={14} className="text-amber-500" />{titulo}</h3>
                <span className="text-xs text-gray-400">{items.length} · umbral {umbral}</span>
              </div>
              <div className="space-y-1">
                {items.map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm bg-amber-50 dark:bg-amber-900/15 rounded-lg px-3 py-1.5">
                    <span className="text-primary dark:text-gray-200">Envío #{a.numero ?? a.id.slice(-6)}</span>
                    <span className="text-xs text-amber-700 dark:text-amber-300">{a.detalle}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* H1-a — Pendientes / atrasados */}
      {seccion === 'pendientes' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Pendientes de despacho ({pend.atrasados} atrasados +{cfg.sinDespachoHoras}h)</h3>
            <ExportBtns titulo="Pendientes" rows={pend.lista.map(r => ({ envio: `#${r.numero ?? r.id.slice(-6)}`, horas: r.horas }))}
              cols={[{ key: 'envio', label: 'Envío' }, { key: 'horas', label: 'Horas en espera' }]} />
          </div>
          {pend.lista.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">No hay envíos pendientes 🎉</p> : (
            <div className="space-y-1.5">
              {pend.lista.map(r => {
                const atrasado = cfg.sinDespachoHoras > 0 && r.horas >= cfg.sinDespachoHoras
                return (
                  <div key={r.id} className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${atrasado ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
                    <span className="text-primary dark:text-gray-200">Envío #{r.numero ?? r.id.slice(-6)}</span>
                    <span className={`text-xs ${atrasado ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-400'}`}>{r.horas}h{atrasado ? ' · atrasado' : ''}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* H1-b — Cumplimiento por courier */}
      {seccion === 'couriers' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Cumplimiento por courier</h3>
            <ExportBtns titulo="Por courier" rows={couriers.map(c => ({ ...c, tiempoMedioDias: c.tiempoMedioDias ?? '—' }))}
              cols={[{ key: 'courier', label: 'Courier' }, { key: 'total', label: 'Envíos' }, { key: 'entregados', label: 'Entregados' }, { key: 'pctEntregados', label: '% entregados' }, { key: 'tiempoMedioDias', label: 'Días promedio' }]} />
          </div>
          {couriers.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin datos</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Courier</th><th>Envíos</th><th>Entreg.</th><th>%</th><th>Días prom.</th></tr></thead>
                <tbody>
                  {couriers.map(c => (
                    <tr key={c.courier} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="py-2 text-primary dark:text-gray-200 flex items-center gap-1.5"><Truck size={12} className="text-gray-400" />{c.courier}</td>
                      <td>{c.total}</td><td>{c.entregados}</td>
                      <td className={c.pctEntregados >= 80 ? 'text-green-600' : c.pctEntregados >= 50 ? 'text-amber-600' : 'text-red-500'}>{c.pctEntregados}%</td>
                      <td>{c.tiempoMedioDias ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* H1-c — Pagos a courier por mes */}
      {seccion === 'pagos' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Pagos a courier acumulados (por mes)</h3>
            <ExportBtns titulo="Pagos courier" rows={pagos}
              cols={[{ key: 'mes', label: 'Mes' }, { key: 'courier', label: 'Courier' }, { key: 'cantidad', label: 'Envíos' }, { key: 'total', label: 'Total' }]} />
          </div>
          {pagos.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">No hay pagos a courier registrados</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Mes</th><th>Courier</th><th>Envíos</th><th>Total</th></tr></thead>
                <tbody>
                  {pagos.map((p, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="py-2 text-primary dark:text-gray-200">{p.mes}</td><td>{p.courier}</td><td>{p.cantidad}</td><td className="font-medium">{fmt$(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* H1-d — Margen logístico */}
      {seccion === 'margen' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Margen logístico (ingreso cobrado − costo real)</h3>
            <ExportBtns titulo="Margen logistico" rows={margen.lista.map(r => ({ envio: `#${r.numero ?? r.id.slice(-6)}`, ingreso: r.ingreso, costo: r.costo, margen: r.margen }))}
              cols={[{ key: 'envio', label: 'Envío' }, { key: 'ingreso', label: 'Ingreso' }, { key: 'costo', label: 'Costo real' }, { key: 'margen', label: 'Margen' }]} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {[['Ingreso', margen.ingresoTotal, false], ['Costo real', margen.costoTotal, false], ['Margen', margen.margenTotal, margen.margenTotal < 0], ['Subsidiados', margen.subsidiados, margen.subsidiados > 0]].map(([label, val, alerta], i) => (
              <div key={i} className={`rounded-xl p-3 ${alerta ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label as string}</p>
                <p className={`text-lg font-bold ${alerta ? 'text-red-600 dark:text-red-400' : 'text-primary dark:text-white'}`}>{i === 3 ? (val as number) : fmt$(val as number)}</p>
              </div>
            ))}
          </div>
          {margen.lista.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin envíos con costo/ingreso registrado</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Envío</th><th>Ingreso</th><th>Costo real</th><th>Margen</th></tr></thead>
                <tbody>
                  {margen.lista.slice(0, 50).map(r => (
                    <tr key={r.id} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="py-2 text-primary dark:text-gray-200">#{r.numero ?? r.id.slice(-6)}</td>
                      <td>{fmt$(r.ingreso)}</td><td>{fmt$(r.costo)}</td>
                      <td className={r.margen < 0 ? 'text-red-500 font-medium' : 'text-green-600 font-medium'}>{fmt$(r.margen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* H1-e — Distribución por zona/CP */}
      {seccion === 'zonas' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Distribución de envíos por zona / CP</h3>
            <ExportBtns titulo="Por zona" rows={zonas}
              cols={[{ key: 'zona', label: 'Zona/CP' }, { key: 'total', label: 'Envíos' }, { key: 'entregados', label: 'Entregados' }, { key: 'pctEntregados', label: '% entregados' }]} />
          </div>
          {zonas.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin datos</p> : (
            <div className="space-y-1.5">
              {zonas.map(z => (
                <div key={z.zona} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate text-primary dark:text-gray-200 flex items-center gap-1.5"><MapPin size={12} className="text-gray-400" />{z.zona}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                    <div className="bg-accent h-full rounded-full" style={{ width: `${Math.min(100, (z.total / zonas[0].total) * 100)}%` }} />
                  </div>
                  <span className="w-24 text-right text-xs text-gray-500">{z.total} · {z.pctEntregados}% ✓</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* H1-f — Productividad de repartidores */}
      {seccion === 'repartidores' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Productividad de repartidores</h3>
            <ExportBtns titulo="Repartidores" rows={prod.map(p => ({ repartidor: p.repartidorId ? (repNombre.get(p.repartidorId) ?? '—') : 'Sin asignar', asignados: p.asignados, entregados: p.entregados, devueltos: p.devueltos, pendientes: p.pendientes, pct: p.pctCumplimiento }))}
              cols={[{ key: 'repartidor', label: 'Repartidor' }, { key: 'asignados', label: 'Asignados' }, { key: 'entregados', label: 'Entregados' }, { key: 'devueltos', label: 'Devueltos' }, { key: 'pendientes', label: 'Pendientes' }, { key: 'pct', label: '% cumplimiento' }]} />
          </div>
          {prod.length === 0 ? <p className="text-center text-gray-400 text-sm py-6"><Package size={20} className="inline mr-2 text-gray-300" />Sin envíos asignados a repartidores</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Repartidor</th><th>Asign.</th><th>Entreg.</th><th>Devuel.</th><th>Pend.</th><th>%</th></tr></thead>
                <tbody>
                  {prod.map((p, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="py-2 text-primary dark:text-gray-200">{p.repartidorId ? (repNombre.get(p.repartidorId) ?? '—') : <span className="text-gray-400">Sin asignar</span>}</td>
                      <td>{p.asignados}</td><td>{p.entregados}</td><td>{p.devueltos}</td><td>{p.pendientes}</td>
                      <td className={p.pctCumplimiento >= 80 ? 'text-green-600' : p.pctCumplimiento >= 50 ? 'text-amber-600' : 'text-red-500'}>{p.pctCumplimiento}%</td>
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
