import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Unlock, AlertTriangle, Calendar, FileText, ChevronDown, ChevronRight, Loader2, FileDown } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { supabase, CierreContable } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatMoneda as formatMonedaLib } from '@/lib/formato'
import { BTN, BRAND } from '@/config/brand'
import { logActividad } from '@/lib/actividadLog'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function periodoLabel(p: string) {
  const d = new Date(p + 'T00:00:00')
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`
}

function periodosSugeridos(ultimoPeriodo: string | null): string[] {
  // Sugerir desde el siguiente mes después del último cierre, hasta el mes anterior al actual.
  const out: string[] = []
  const hoy = new Date()
  const finMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  let cursor: Date
  if (ultimoPeriodo) {
    const u = new Date(ultimoPeriodo + 'T00:00:00')
    cursor = new Date(u.getFullYear(), u.getMonth() + 1, 1)
  } else {
    // Si no hay cierres: ofrecer últimos 6 meses
    cursor = new Date(hoy.getFullYear(), hoy.getMonth() - 6, 1)
  }
  while (cursor < finMesActual) {
    const p = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`
    out.push(p)
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    if (out.length > 12) break
  }
  return out
}

export default function CierresContablesPanel() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const formatMoneda = (v: number) => formatMonedaLib(v, (tenant as any)?.moneda ?? 'ARS')

  const rolesPermiten = ['DUEÑO','SUPERVISOR','CONTADOR','SUPER_USUARIO','ADMIN']
  const rolesReabren  = ['DUEÑO','SUPER_USUARIO','ADMIN']
  const puedeCerrar  = rolesPermiten.includes(user?.rol ?? '')
  const puedeReabrir = rolesReabren.includes(user?.rol ?? '')

  const [periodoElegido, setPeriodoElegido] = useState('')
  const [observaciones, setObservaciones]   = useState('')
  const [confirmando, setConfirmando]       = useState(false)
  const [expandido, setExpandido]           = useState<string | null>(null)
  const [reabriendo, setReabriendo]         = useState<string | null>(null)

  const { data: cierres = [], isLoading } = useQuery({
    queryKey: ['cierres-contables', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('cierres_contables')
        .select('*, cerrado_por_user:users!cierres_contables_cerrado_por_fkey(nombre_display)')
        .eq('tenant_id', tenant!.id)
        .order('periodo', { ascending: false })
      return (data ?? []) as (CierreContable & { cerrado_por_user?: any })[]
    },
    enabled: !!tenant?.id,
  })

  const ultimo = cierres[0] ?? null
  const sugeridos = useMemo(() => periodosSugeridos(ultimo?.periodo ?? null), [ultimo?.periodo])

  // Snapshot del periodo elegido (preview pre-cierre)
  const { data: preview, isLoading: loadingPreview } = useQuery({
    queryKey: ['cierre-preview', tenant?.id, periodoElegido],
    queryFn: async () => {
      const desde = periodoElegido
      const dIni = new Date(desde + 'T00:00:00')
      const dFin = new Date(dIni.getFullYear(), dIni.getMonth() + 1, 1)
      const hasta = dFin.toISOString().split('T')[0]

      const [gRes, vRes, sRes] = await Promise.all([
        supabase.from('gastos')
          .select('monto, es_correccion', { count: 'exact' })
          .eq('tenant_id', tenant!.id).gte('fecha', desde).lt('fecha', hasta),
        supabase.from('ventas')
          .select('total', { count: 'exact' })
          .eq('tenant_id', tenant!.id).in('estado', ['despachada','facturada'])
          .gte('created_at', desde).lt('created_at', hasta),
        supabase.from('rrhh_salarios')
          .select('neto').eq('tenant_id', tenant!.id).eq('pagado', true)
          .gte('fecha_pago', desde).lt('fecha_pago', hasta),
      ])
      const gastos = (gRes.data ?? []) as any[]
      const totalGastos  = gastos.reduce((a, g) => a + (g.monto ?? 0), 0)
      const correcciones = gastos.filter(g => g.es_correccion).length
      const totalVentas  = (vRes.data ?? []).reduce((a: number, v: any) => a + (v.total ?? 0), 0)
      const totalSueldos = (sRes.data ?? []).reduce((a: number, s: any) => a + (s.neto ?? 0), 0)
      return {
        totalGastos, correcciones,
        totalVentas, countVentas: vRes.count ?? 0,
        totalSueldos, countGastos: gRes.count ?? 0,
      }
    },
    enabled: !!tenant?.id && !!periodoElegido,
  })

  const cerrar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('cerrar_periodo', {
        p_periodo: periodoElegido,
        p_observaciones: observaciones.trim() || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success(`Periodo ${periodoLabel(periodoElegido)} cerrado`)
      logActividad({ entidad: 'cierre_contable', accion: 'cerrar', entidad_nombre: periodoLabel(periodoElegido), pagina: '/gastos' } as any)
      qc.invalidateQueries({ queryKey: ['cierres-contables', tenant?.id] })
      qc.invalidateQueries({ queryKey: ['cierre-ultimo', tenant?.id] })
      setPeriodoElegido(''); setObservaciones(''); setConfirmando(false)
    },
    onError: (e: any) => { toast.error(e.message); setConfirmando(false) },
  })

  function generarPdfCierre(c: any) {
    const t: any = c.totales ?? {}
    const usuario = c.cerrado_por_user?.nombre_display ?? c.cerrado_por?.slice(0, 8) ?? '—'
    const tInfo: any = tenant ?? {}
    const doc = new jsPDF()
    const w = doc.internal.pageSize.width

    doc.setFillColor(30, 58, 95)
    doc.rect(0, 0, w, 28, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(17); doc.setFont('helvetica', 'bold')
    doc.text(BRAND.name, 14, 13)
    doc.setFontSize(12); doc.setFont('helvetica', 'normal')
    doc.text(`Cierre contable · ${periodoLabel(c.periodo)}`, 14, 21)
    doc.setFontSize(9)
    if (tInfo.nombre) doc.text(tInfo.nombre, w - 14, 10, { align: 'right' })
    if (tInfo.cuit) doc.text(`CUIT: ${tInfo.cuit}`, w - 14, 15, { align: 'right' })
    if (tInfo.domicilio_fiscal) doc.text(tInfo.domicilio_fiscal, w - 14, 20, { align: 'right' })

    doc.setTextColor(60, 60, 60)
    doc.setFontSize(10)
    let yh = 38
    doc.text(`Periodo cerrado: ${periodoLabel(c.periodo)}`, 14, yh); yh += 6
    doc.text(`Fecha de cierre: ${new Date(c.fecha_cierre).toLocaleString('es-AR')}`, 14, yh); yh += 6
    doc.text(`Cerrado por: ${usuario} · rol ${c.cerrado_por_rol}`, 14, yh); yh += 6
    if (c.observaciones) {
      const obsLines = doc.splitTextToSize(`Observaciones: ${c.observaciones}`, w - 28)
      doc.text(obsLines, 14, yh); yh += obsLines.length * 5 + 1
    }

    const totalGastos  = Number(t.total_gastos  ?? 0)
    const totalVentas  = Number(t.total_ventas  ?? 0)
    const totalSueldos = Number(t.total_sueldos ?? 0)
    const totalOc      = Number(t.total_oc      ?? 0)
    const countGastos  = Number(t.count_gastos  ?? 0)
    const countVentas  = Number(t.count_ventas  ?? 0)
    const countCorr    = Number(t.count_correcciones ?? 0)
    const egresosTot   = totalGastos + totalSueldos
    const resultadoNet = totalVentas - egresosTot

    autoTable(doc, {
      startY: yh + 2,
      head: [['Concepto', 'Cantidad', 'Monto']],
      body: [
        ['Ventas (despachadas/facturadas)', String(countVentas), formatMoneda(totalVentas)],
        ['Gastos', `${countGastos}${countCorr ? ` (${countCorr} corr.)` : ''}`, formatMoneda(totalGastos)],
        ['Sueldos pagados (RRHH)', '', formatMoneda(totalSueldos)],
        ['Órdenes de compra (total emitido)', '', formatMoneda(totalOc)],
      ],
      styles: { fontSize: 10 },
      headStyles: { fillColor: [30, 58, 95] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    })
    let y2: number = (doc as any).lastAutoTable.finalY + 6

    autoTable(doc, {
      startY: y2,
      body: [
        ['Egresos totales (Gastos + RRHH)', formatMoneda(egresosTot)],
        ['Resultado neto del periodo', formatMoneda(resultadoNet)],
      ],
      styles: { fontSize: 10, fontStyle: 'bold' },
      bodyStyles: { fillColor: [240, 244, 248] },
      columnStyles: { 1: { halign: 'right' } },
    })
    y2 = (doc as any).lastAutoTable.finalY + 8

    doc.setFontSize(8); doc.setTextColor(120, 120, 120)
    doc.text('Los registros del periodo quedan congelados. Correcciones se cargan como notas de corrección vinculadas al gasto original.', 14, y2, { maxWidth: w - 28 })

    doc.setFontSize(8); doc.setTextColor(150, 150, 150)
    doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, w / 2, 290, { align: 'center' })

    const fileName = `cierre_${c.periodo.slice(0, 7)}.pdf`
    doc.save(fileName)
    logActividad({ entidad: 'cierre_contable', accion: 'descargar_pdf', entidad_nombre: periodoLabel(c.periodo), pagina: '/gastos' } as any)
  }

  const reabrir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('reabrir_periodo', { p_cierre_id: id })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cierre revertido')
      qc.invalidateQueries({ queryKey: ['cierres-contables', tenant?.id] })
      qc.invalidateQueries({ queryKey: ['cierre-ultimo', tenant?.id] })
      setReabriendo(null)
    },
    onError: (e: any) => { toast.error(e.message); setReabriendo(null) },
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-surface border border-border-ds rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
            <Lock size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-primary">Cierre contable mensual</h2>
            <p className="text-sm text-muted mt-0.5">
              Al cerrar un periodo se bloquea la edición y eliminación de Gastos, Ventas, Caja y Órdenes de compra con fecha hasta el último día del mes cerrado. Las correcciones se hacen como notas (no se edita el registro original).
            </p>
            {ultimo ? (
              <div className="mt-2 inline-flex items-center gap-2 text-sm bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 rounded-lg">
                <Lock size={13} /> Último cierre: <strong>{periodoLabel(ultimo.periodo)}</strong>
              </div>
            ) : (
              <div className="mt-2 inline-flex items-center gap-2 text-sm bg-gray-100 dark:bg-gray-700 text-muted px-3 py-1.5 rounded-lg">
                <Unlock size={13} /> Sin cierres registrados — todo está editable
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cerrar nuevo periodo */}
      {puedeCerrar && sugeridos.length > 0 && (
        <div className="bg-surface border border-border-ds rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
            <Calendar size={15} className="text-accent" /> Cerrar nuevo periodo
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Periodo a cerrar *</label>
              <div className="relative">
                <select
                  value={periodoElegido}
                  onChange={e => setPeriodoElegido(e.target.value)}
                  className="w-full appearance-none border border-border-ds rounded-lg pl-3 pr-8 py-2 text-sm bg-page text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">Seleccioná un periodo…</option>
                  {sugeridos.map(p => <option key={p} value={p}>{periodoLabel(p)}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Observaciones (opcional)</label>
              <input
                value={observaciones} onChange={e => setObservaciones(e.target.value)}
                placeholder="Ej: cierre conciliado con extracto bancario"
                className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {periodoElegido && (
            <div className="bg-page border border-border-ds rounded-lg p-3">
              <p className="text-xs font-medium text-muted mb-2">Previsualización — {periodoLabel(periodoElegido)}</p>
              {loadingPreview ? (
                <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Calculando…</p>
              ) : preview ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <Stat label="Gastos" value={formatMoneda(preview.totalGastos)} sub={`${preview.countGastos} registros${preview.correcciones > 0 ? ` · ${preview.correcciones} corr.` : ''}`} />
                  <Stat label="Ventas" value={formatMoneda(preview.totalVentas)} sub={`${preview.countVentas} despachadas/facturadas`} />
                  <Stat label="Sueldos pagados" value={formatMoneda(preview.totalSueldos)} sub="rrhh_salarios.pagado" />
                  <Stat label="Egresos totales" value={formatMoneda(preview.totalGastos + preview.totalSueldos)} sub="Gastos + RRHH" />
                </div>
              ) : null}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-500" />
              Acción irreversible para roles distintos a DUEÑO/ADMIN.
            </p>
            <button
              type="button"
              disabled={!periodoElegido || cerrar.isPending}
              onClick={() => setConfirmando(true)}
              className={`${BTN.primary} ${BTN.sm} inline-flex items-center gap-2`}
            >
              <Lock size={14} />
              {cerrar.isPending ? 'Cerrando…' : 'Cerrar periodo'}
            </button>
          </div>
        </div>
      )}

      {/* Listado de cierres */}
      <div className="bg-surface border border-border-ds rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border-ds flex items-center gap-2">
          <FileText size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-primary">Historial de cierres</h3>
          <span className="text-xs text-muted">({cierres.length})</span>
        </div>
        {isLoading ? (
          <p className="p-6 text-sm text-muted text-center">Cargando…</p>
        ) : cierres.length === 0 ? (
          <p className="p-6 text-sm text-muted text-center">Sin cierres registrados todavía.</p>
        ) : (
          <ul className="divide-y divide-border-ds">
            {cierres.map((c, idx) => {
              const esUltimo = idx === 0
              const open = expandido === c.id
              const usuario = (c as any).cerrado_por_user
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setExpandido(open ? null : c.id)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-page transition-colors text-left"
                  >
                    <Lock size={14} className="text-emerald-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary">{periodoLabel(c.periodo)}</p>
                      <p className="text-xs text-muted">
                        Cerrado {new Date(c.fecha_cierre).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        {' '}por {usuario?.nombre_display ?? c.cerrado_por.slice(0, 8)}
                        {' · '}rol {c.cerrado_por_rol}
                      </p>
                    </div>
                    {esUltimo && puedeReabrir && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setReabriendo(c.id) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setReabriendo(c.id) } }}
                        className="text-xs px-2 py-1 rounded-lg border border-border-ds text-muted hover:text-red-600 hover:border-red-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Unlock size={12} /> Reabrir
                      </span>
                    )}
                    {open ? <ChevronDown size={14} className="text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
                  </button>
                  {open && (
                    <div className="px-5 pb-4 bg-page/50">
                      {c.observaciones && (
                        <p className="text-xs italic text-muted mb-2">"{c.observaciones}"</p>
                      )}
                      {c.totales && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <Stat label="Gastos" value={formatMoneda(c.totales.total_gastos)} sub={`${c.totales.count_gastos} reg.${c.totales.count_correcciones ? ` · ${c.totales.count_correcciones} corr.` : ''}`} />
                          <Stat label="Ventas" value={formatMoneda(c.totales.total_ventas)} sub={`${c.totales.count_ventas} despachadas/facturadas`} />
                          <Stat label="Sueldos" value={formatMoneda(c.totales.total_sueldos)} sub="RRHH pagados" />
                          <Stat label="OC" value={formatMoneda(c.totales.total_oc)} sub="Ordenes de compra" />
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); generarPdfCierre(c) }}
                          title="Descargar PDF del cierre con snapshot de totales"
                          className="text-xs px-3 py-1.5 rounded-lg border border-border-ds text-muted hover:text-accent hover:border-accent flex items-center gap-1.5">
                          <FileDown size={12} /> Descargar PDF
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Modal confirmar cierre */}
      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-xl w-full max-w-md shadow-xl p-5 space-y-3">
            <h3 className="font-semibold text-primary flex items-center gap-2">
              <Lock size={16} className="text-accent" /> Confirmar cierre
            </h3>
            <p className="text-sm text-primary">
              ¿Cerrar el periodo <strong>{periodoLabel(periodoElegido)}</strong>?
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-2 flex items-start gap-2">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span>Los registros del periodo quedan congelados. Para correcciones futuras, vas a tener que cargar notas de corrección.</span>
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setConfirmando(false)} className={`${BTN.secondary} ${BTN.sm}`}>Cancelar</button>
              <button type="button" disabled={cerrar.isPending}
                onClick={() => cerrar.mutate()}
                className={`${BTN.primary} ${BTN.sm}`}
              >
                {cerrar.isPending ? 'Cerrando…' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar reabrir */}
      {reabriendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-xl w-full max-w-md shadow-xl p-5 space-y-3">
            <h3 className="font-semibold text-primary flex items-center gap-2">
              <Unlock size={16} className="text-red-500" /> Reabrir cierre
            </h3>
            <p className="text-sm text-primary">
              Esto desbloquea la edición de los registros del último periodo cerrado. ¿Continuar?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setReabriendo(null)} className={`${BTN.secondary} ${BTN.sm}`}>Cancelar</button>
              <button type="button" disabled={reabrir.isPending}
                onClick={() => reabrir.mutate(reabriendo)}
                className={`${BTN.danger} ${BTN.sm}`}
              >
                {reabrir.isPending ? 'Procesando…' : 'Reabrir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface dark:bg-gray-700/30 rounded-lg p-2.5">
      <p className="text-[11px] text-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-primary font-mono tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted mt-0.5">{sub}</p>}
    </div>
  )
}
