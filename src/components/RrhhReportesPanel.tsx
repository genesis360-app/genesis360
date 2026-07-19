import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { FileSpreadsheet, FileDown, FileText, DollarSign, CalendarCheck, Plane, Users2, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import {
  costoLaboralPorDepto, asistenciaConsolidada, vacacionesResumen,
  antiguedadRotacion, recibosResumen,
} from '@/lib/rrhhReportes'

type Col = { key: string; label: string }
type ExportFmt = 'excel' | 'csv' | 'pdf'

function exportar(fmt: ExportFmt, titulo: string, cols: Col[], rows: any[]) {
  if (!rows.length) { toast.error('No hay datos para exportar'); return }
  const fecha = new Date().toISOString().split('T')[0]
  const fname = `rrhh_${titulo.toLowerCase().replace(/\s+/g, '_')}_${fecha}`
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
    autoTable(doc, { startY: 22, head: [cols.map(c => c.label)], body: rows.map(r => cols.map(c => String(r[c.key] ?? ''))), theme: 'striped', headStyles: { fillColor: [30, 58, 95] }, styles: { fontSize: 8 } })
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

export default function RrhhReportesPanel({ tenant }: { tenant: any }) {
  const hoyISO = new Date().toISOString().split('T')[0]
  const periodoMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
  const [seccion, setSeccion] = useState<'costo' | 'asistencia' | 'vacaciones' | 'rotacion' | 'recibos'>('costo')

  const { data: salarios = [] } = useQuery({
    queryKey: ['rrhh-rep-salarios', tenant?.id, periodoMes],
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_salarios')
        .select('empleado_id, periodo, neto, total_haberes, pagado, empleado:empleados(departamento:rrhh_departamentos(nombre))')
        .eq('tenant_id', tenant!.id).eq('periodo', periodoMes)
      return (data ?? []).map((s: any) => ({ empleado_id: s.empleado_id, periodo: s.periodo, neto: s.neto, bruto: s.total_haberes, pagado: s.pagado, departamento: s.empleado?.departamento?.nombre }))
    },
    enabled: !!tenant,
  })

  const { data: asistencias = [] } = useQuery({
    queryKey: ['rrhh-rep-asist', tenant?.id],
    queryFn: async () => {
      const desde = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
      const { data } = await supabase.from('rrhh_asistencia')
        .select('empleado_id, estado, empleado:empleados(nombre, apellido)')
        .eq('tenant_id', tenant!.id).gte('fecha', desde)
      return (data ?? []).map((a: any) => ({ empleado_id: a.empleado_id, estado: a.estado, empleado: [a.empleado?.nombre, a.empleado?.apellido].filter(Boolean).join(' ') }))
    },
    enabled: !!tenant,
  })

  const { data: vacSaldos = [] } = useQuery({
    queryKey: ['rrhh-rep-vac', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_vacaciones_saldo')
        .select('dias_totales, dias_usados, remanente_anterior, empleado:empleados(nombre, apellido)')
        .eq('tenant_id', tenant!.id).eq('anio', new Date().getFullYear())
      return (data ?? []).map((s: any) => ({ dias_totales: s.dias_totales, dias_usados: s.dias_usados, remanente_anterior: s.remanente_anterior, empleado: [s.empleado?.nombre, s.empleado?.apellido].filter(Boolean).join(' ') }))
    },
    enabled: !!tenant,
  })

  const { data: empleados = [] } = useQuery({
    queryKey: ['rrhh-rep-emp', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('empleados').select('id, nombre, fecha_ingreso, fecha_egreso, activo').eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const costo = useMemo(() => costoLaboralPorDepto(salarios as any), [salarios])
  const asist = useMemo(() => asistenciaConsolidada(asistencias as any), [asistencias])
  const vac = useMemo(() => vacacionesResumen(vacSaldos as any), [vacSaldos])
  const rot = useMemo(() => antiguedadRotacion(empleados as any, hoyISO), [empleados, hoyISO])
  const recibos = useMemo(() => recibosResumen(salarios as any), [salarios])

  const SECCIONES = [
    { id: 'costo' as const, label: 'Costo laboral', icon: <DollarSign size={13} /> },
    { id: 'asistencia' as const, label: 'Asistencia', icon: <CalendarCheck size={13} /> },
    { id: 'vacaciones' as const, label: 'Vacaciones', icon: <Plane size={13} /> },
    { id: 'rotacion' as const, label: 'Antigüedad/rotación', icon: <Users2 size={13} /> },
    { id: 'recibos' as const, label: 'Recibos', icon: <Clock size={13} /> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {SECCIONES.map(s => (
          <button key={s.id} onClick={() => setSeccion(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${seccion === s.id ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      {seccion === 'costo' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Costo laboral por departamento (mes actual)</h3>
            <ExportBtns titulo="Costo laboral" rows={costo} cols={[{ key: 'departamento', label: 'Departamento' }, { key: 'cantidad', label: 'Empleados' }, { key: 'total', label: 'Bruto' }]} />
          </div>
          {costo.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin liquidaciones este mes</p> : (
            <>
            <table className="w-full text-sm"><tbody>
              {costo.map(c => (
                <tr key={c.departamento} className="border-b border-gray-50 dark:border-gray-700/50">
                  <td className="py-2 text-gray-700 dark:text-gray-200">{c.departamento}</td>
                  <td className="text-gray-400">{c.cantidad}</td>
                  <td className="text-right font-medium">{fmt$(c.total)}</td>
                </tr>
              ))}
              <tr className="font-bold text-primary dark:text-white"><td className="py-2">Total bruto</td><td></td><td className="text-right">{fmt$(costo.reduce((s, c) => s + c.total, 0))}</td></tr>
            </tbody></table>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">Haberes <strong>brutos</strong> liquidados (lo que paga la empresa en sueldos). No incluye las <strong>cargas patronales</strong>, que se imputan como gasto en Gastos.</p>
            </>
          )}
        </div>
      )}

      {seccion === 'asistencia' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Asistencia consolidada (mes actual)</h3>
            <ExportBtns titulo="Asistencia" rows={asist} cols={[{ key: 'empleado', label: 'Empleado' }, { key: 'presente', label: 'Presente' }, { key: 'tardanza', label: 'Tardanza' }, { key: 'ausente', label: 'Ausente' }, { key: 'licencia', label: 'Licencia' }]} />
          </div>
          {asist.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin registros de asistencia</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Empleado</th><th>Pres.</th><th>Tard.</th><th>Aus.</th><th>Lic.</th></tr></thead>
              <tbody>{asist.map(a => (
                <tr key={a.empleado_id} className="border-b border-gray-50 dark:border-gray-700/50">
                  <td className="py-2 text-gray-700 dark:text-gray-200">{a.empleado}</td>
                  <td className="text-green-600">{a.presente}</td><td className="text-amber-600">{a.tardanza}</td><td className="text-red-500">{a.ausente}</td><td className="text-blue-500">{a.licencia}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {seccion === 'vacaciones' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Vacaciones — gozadas / pendientes ({new Date().getFullYear()})</h3>
            <ExportBtns titulo="Vacaciones" rows={vac} cols={[{ key: 'empleado', label: 'Empleado' }, { key: 'asignados', label: 'Asignados' }, { key: 'usados', label: 'Usados' }, { key: 'disponibles', label: 'Disponibles' }]} />
          </div>
          {vac.length === 0 ? <p className="text-center text-gray-400 text-sm py-6">Sin saldos cargados</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700"><th className="py-2">Empleado</th><th>Asign.</th><th>Usados</th><th>Disp.</th></tr></thead>
              <tbody>{vac.map((v, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50">
                  <td className="py-2 text-gray-700 dark:text-gray-200">{v.empleado}</td><td>{v.asignados}</td><td>{v.usados}</td>
                  <td className={v.disponibles > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{v.disponibles}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {seccion === 'rotacion' && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-primary dark:text-white mb-3">Antigüedad y rotación</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-3 text-center"><p className="text-2xl font-bold text-primary dark:text-white">{rot.activos}</p><p className="text-xs text-gray-400">Activos</p></div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-3 text-center"><p className="text-2xl font-bold text-red-500">{rot.bajas}</p><p className="text-xs text-gray-400">Bajas</p></div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-3 text-center"><p className="text-2xl font-bold text-accent-text">{rot.permanenciaPromedioAnios}</p><p className="text-xs text-gray-400">Años promedio</p></div>
          </div>
        </div>
      )}

      {seccion === 'recibos' && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-primary dark:text-white mb-3">Recibos del mes</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-green-50 dark:bg-green-900/20 p-3"><p className="text-xs text-gray-500 dark:text-gray-400">Pagados</p><p className="text-lg font-bold text-green-600 dark:text-green-400">{recibos.pagadosCant}</p></div>
            <div className="rounded-xl bg-green-50 dark:bg-green-900/20 p-3"><p className="text-xs text-gray-500 dark:text-gray-400">Monto pagado</p><p className="text-lg font-bold text-green-600 dark:text-green-400">{fmt$(recibos.pagadosMonto)}</p></div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3"><p className="text-xs text-gray-500 dark:text-gray-400">Pendientes</p><p className="text-lg font-bold text-amber-600 dark:text-amber-400">{recibos.pendientesCant}</p></div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3"><p className="text-xs text-gray-500 dark:text-gray-400">Monto pendiente</p><p className="text-lg font-bold text-amber-600 dark:text-amber-400">{fmt$(recibos.pendientesMonto)}</p></div>
          </div>
        </div>
      )}
    </div>
  )
}
