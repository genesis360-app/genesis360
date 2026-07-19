import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FileText, Plane, FolderOpen, Download, Loader2, UserCircle2, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { generarReciboSueldoPDF } from '@/lib/reciboSueldoPDF'
import { formatMoneda as formatMonedaLib } from '@/lib/formato'
import toast from 'react-hot-toast'

// RH7/F2 — Portal del empleado. El usuario logueado que está vinculado a un empleado
// (empleados.user_id) ve SUS propios recibos / vacaciones / documentos, según las
// capacidades habilitadas por el negocio (tenants.rrhh_portal_capacidades).
// Solo lectura. El scoping es client-side por empleado_id (consistente con el modelo
// actual de RLS tenant-wide; el aislamiento server-side es la deuda técnica de RLS).

interface Capacidades { vacaciones?: boolean; recibos?: boolean; documentos?: boolean; firma?: boolean }

export default function MiPortalPage() {
  const { tenant, user } = useAuthStore()
  const formatMoneda = (v: number) => formatMonedaLib(v, (tenant as any)?.moneda ?? 'ARS')
  const portalActivo = !!(tenant as any)?.rrhh_portal_empleado
  const cap = ((tenant as any)?.rrhh_portal_capacidades ?? {}) as Capacidades
  const [bajando, setBajando] = useState<string | null>(null)

  // Empleado vinculado al usuario logueado
  const { data: emp, isLoading: cargandoEmp } = useQuery({
    queryKey: ['mi-portal-empleado', tenant?.id, user?.id],
    enabled: !!tenant && !!user,
    queryFn: async () => {
      const { data } = await supabase.from('empleados')
        .select('id, nombre, apellido, dni_rut, puesto:rrhh_puestos(nombre)')
        .eq('tenant_id', tenant!.id).eq('user_id', user!.id).maybeSingle()
      return data
    },
  })

  const { data: recibos = [] } = useQuery({
    queryKey: ['mi-portal-recibos', emp?.id],
    enabled: !!emp && !!cap.recibos,
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_salarios')
        .select('id, periodo, basico, total_haberes, total_descuentos, neto')
        .eq('empleado_id', (emp as any).id).order('periodo', { ascending: false })
      return data ?? []
    },
  })

  const { data: vacaciones = [] } = useQuery({
    queryKey: ['mi-portal-vacaciones', emp?.id],
    enabled: !!emp && !!cap.vacaciones,
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_vacaciones_solicitud')
        .select('id, desde, hasta, dias_habiles, estado, notas')
        .eq('empleado_id', (emp as any).id).order('desde', { ascending: false })
      return data ?? []
    },
  })

  const { data: documentos = [] } = useQuery({
    queryKey: ['mi-portal-documentos', emp?.id],
    enabled: !!emp && !!cap.documentos,
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_documentos')
        .select('id, nombre, tipo, storage_path, fecha_vencimiento, created_at')
        .eq('empleado_id', (emp as any).id).order('created_at', { ascending: false })
      return data ?? []
    },
  })

  const descargarRecibo = async (sal: any) => {
    setBajando(sal.id)
    try {
      const { data: items } = await supabase.from('rrhh_salario_items')
        .select('descripcion, tipo, monto').eq('salario_id', sal.id).order('tipo')
      generarReciboSueldoPDF({
        negocio: tenant?.nombre ?? 'Recibo', cuit: (tenant as any)?.cuit ?? null,
        empleado: [(emp as any)?.nombre, (emp as any)?.apellido].filter(Boolean).join(' '),
        dni: (emp as any)?.dni_rut ?? null, puesto: (emp as any)?.puesto?.nombre ?? null,
        periodo: sal.periodo, basico: sal.basico, items: (items ?? []) as any[],
        totalHaberes: sal.total_haberes, totalDescuentos: sal.total_descuentos, neto: sal.neto,
        moneda: (tenant as any)?.moneda ?? 'ARS',
      })
    } finally { setBajando(null) }
  }

  const verDocumento = async (path: string) => {
    const { data } = await supabase.storage.from('empleados').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('No se pudo abrir el documento')
  }

  if (cargandoEmp) return <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-accent-text" /></div>

  if (!portalActivo || !emp) return (
    <div className="max-w-xl mx-auto mt-10 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6 flex items-start gap-3">
      <Info size={20} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
      <div className="text-sm text-blue-800 dark:text-blue-300">
        <p className="font-semibold mb-1">Portal del empleado no disponible</p>
        <p>{!portalActivo ? 'El negocio todavía no habilitó el portal del empleado.' : 'Tu usuario no está vinculado a un legajo de empleado. Pedile a RRHH que lo vincule.'}</p>
      </div>
    </div>
  )

  const ESTADO_BADGE: Record<string, string> = {
    pendiente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    aprobada: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    rechazada: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  }
  const diasAprobados = (vacaciones as any[]).filter(v => v.estado === 'aprobada').reduce((a, v) => a + (Number(v.dias_habiles) || 0), 0)

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center">
          <UserCircle2 size={22} className="text-accent-text" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-primary">Mi Portal</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{[(emp as any).nombre, (emp as any).apellido].filter(Boolean).join(' ')}{(emp as any).puesto?.nombre ? ` · ${(emp as any).puesto.nombre}` : ''}</p>
        </div>
      </div>

      {/* Recibos */}
      {cap.recibos && (
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <FileText size={15} className="text-accent-text" /><h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Mis recibos de sueldo</h2>
          </div>
          {(recibos as any[]).length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Todavía no tenés recibos.</p>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {(recibos as any[]).map(r => (
                <div key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{String(r.periodo).slice(0, 7)}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Neto: {formatMoneda(Number(r.neto))}</p>
                  </div>
                  <button onClick={() => descargarRecibo(r)} disabled={bajando === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                    {bajando === r.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Recibo PDF
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Vacaciones */}
      {cap.vacaciones && (
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2"><Plane size={15} className="text-accent-text" /><h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Mis vacaciones</h2></div>
            <span className="text-xs text-gray-400 dark:text-gray-500">{diasAprobados} días aprobados</span>
          </div>
          {(vacaciones as any[]).length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Sin solicitudes de vacaciones.</p>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {(vacaciones as any[]).map(v => (
                <div key={v.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      {new Date(v.desde + 'T00:00:00').toLocaleDateString('es-AR')} → {new Date(v.hasta + 'T00:00:00').toLocaleDateString('es-AR')}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{v.dias_habiles} días hábiles{v.notas ? ` · ${v.notas}` : ''}</p>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${ESTADO_BADGE[v.estado] ?? 'bg-gray-100 text-gray-600'}`}>{v.estado}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Documentos */}
      {cap.documentos && (
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <FolderOpen size={15} className="text-accent-text" /><h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Mis documentos</h2>
          </div>
          {(documentos as any[]).length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Sin documentos cargados.</p>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {(documentos as any[]).map(d => (
                <div key={d.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{d.nombre}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{d.tipo}{d.fecha_vencimiento ? ` · vence ${new Date(d.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-AR')}` : ''}</p>
                  </div>
                  {d.storage_path && (
                    <button onClick={() => verDocumento(d.storage_path)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700">
                      <Download size={13} /> Ver
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
