import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Edit, Search, Users2,
  Building2, Briefcase, Calendar, ChevronDown, Heart, AlertTriangle,
  DollarSign, CreditCard, ChevronRight, CheckCircle, Clock,
  Plane, ClipboardList, Check, X, LayoutDashboard, FileSpreadsheet,
  UserCheck, UserX, TrendingUp, Download, Paperclip, FolderOpen, File,
  BookOpen, Award, Network,
} from 'lucide-react'
import { utils as xlsxUtils, writeFile as xlsxWriteFile } from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'
import { differenceInDays, format } from 'date-fns'
import { es } from 'date-fns/locale'

type Tab = 'dashboard' | 'empleados' | 'puestos' | 'departamentos' | 'cumpleanos' | 'nomina' | 'vacaciones' | 'asistencia' | 'documentos' | 'capacitaciones' | 'equipo'
type FormMode = 'crear' | 'editar' | null

interface Concepto {
  id: string
  tenant_id: string
  nombre: string
  tipo: 'HABER' | 'DESCUENTO'
  activo: boolean
}

interface Salario {
  id: string
  tenant_id: string
  empleado_id: string
  periodo: string
  basico: number
  total_haberes: number
  total_descuentos: number
  neto: number
  pagado: boolean
  fecha_pago: string | null
  caja_movimiento_id: string | null
  medio_pago: 'efectivo' | 'transferencia_banco' | 'mp' | null
  notas: string | null
  empleado?: Empleado
}

interface SalarioItem {
  id: string
  tenant_id: string
  salario_id: string
  concepto_id: string | null
  descripcion: string
  tipo: 'HABER' | 'DESCUENTO'
  monto: number
}

interface VacacionSolicitud {
  id: string
  tenant_id: string
  empleado_id: string
  desde: string
  hasta: string
  dias_habiles: number
  estado: 'pendiente' | 'aprobada' | 'rechazada'
  notas: string | null
  aprobado_por: string | null
  aprobado_at: string | null
  created_at: string
  empleado?: Empleado
}

interface VacacionSaldo {
  id: string
  tenant_id: string
  empleado_id: string
  anio: number
  dias_totales: number
  dias_usados: number
  remanente_anterior: number
  empleado?: Empleado
}

interface Asistencia {
  id: string
  tenant_id: string
  empleado_id: string
  fecha: string
  hora_entrada: string | null
  hora_salida: string | null
  estado: 'presente' | 'ausente' | 'tardanza' | 'licencia'
  motivo: string | null
  empleado?: Empleado
}

function calcularDiasHabilesFrontend(desde: string, hasta: string): number {
  let count = 0
  const h = new Date(hasta)
  const cur = new Date(desde)
  while (cur <= h) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

interface Empleado {
  id: string
  tenant_id: string
  user_id: string | null
  nombre: string
  apellido: string | null
  dni_rut: string
  tipo_doc: string
  tel_personal: string | null
  email_personal: string | null
  genero: string
  direccion: string | null
  fon: string | null
  fecha_nacimiento: string | null
  fecha_ingreso: string
  fecha_egreso: string | null
  puesto_id: string | null
  departamento_id: string | null
  supervisor_id: string | null
  tipo_contrato: string
  salario_bruto: number | null
  activo: boolean
  created_at: string
  updated_at: string
  // Joins
  puesto?: { id: string; nombre: string }
  departamento?: { id: string; nombre: string }
  supervisor?: { id: string; nombre_display: string }
}

interface Puesto {
  id: string
  tenant_id: string
  nombre: string
  descripcion: string | null
  salario_base_sugerido: number | null
  activo: boolean
  created_at: string
  updated_at: string
}

interface Departamento {
  id: string
  tenant_id: string
  nombre: string
  descripcion: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

interface Documento {
  id: string
  tenant_id: string
  empleado_id: string
  nombre: string
  descripcion: string | null
  tipo: 'contrato' | 'certificado' | 'cv' | 'foto' | 'otro'
  storage_path: string
  tamanio: number | null
  mime_type: string | null
  created_at: string
  empleado?: { nombre: string; apellido: string | null; dni_rut: string }
}

interface Capacitacion {
  id: string
  tenant_id: string
  empleado_id: string
  nombre: string
  descripcion: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  horas: number | null
  proveedor: string | null
  estado: 'planificada' | 'en_curso' | 'completada' | 'cancelada'
  resultado: string | null
  certificado_path: string | null
  created_at: string
  empleado?: { nombre: string; apellido: string | null; dni_rut: string }
}

interface Feriado {
  id: string
  tenant_id: string
  nombre: string
  fecha: string
  tipo: 'nacional' | 'provincial' | 'personalizado' | 'no_laborable'
  created_at: string
}

export default function RrhhPage() {
  const { limits } = usePlanLimits()
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>(() => user?.rol === 'SUPERVISOR' ? 'equipo' : 'empleados')
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [selectedEmpleado, setSelectedEmpleado] = useState<Empleado | null>(null)
  const [editingPuesto, setEditingPuesto] = useState<Puesto | null>(null)
  const [editingDepartamento, setEditingDepartamento] = useState<Departamento | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Form state
  const [formData, setFormData] = useState<Partial<Empleado>>({
    nombre: '',
    apellido: '',
    dni_rut: '',
    tipo_doc: 'DNI',
    genero: 'OTRO',
    fecha_ingreso: format(new Date(), 'yyyy-MM-dd'),
    tipo_contrato: 'INDEFINIDO',
    activo: true,
  })
  const [puestoForm, setPuestoForm] = useState<Partial<Puesto>>({ nombre: '', activo: true })
  const [showPuestoForm, setShowPuestoForm] = useState(false)
  const [deptForm, setDeptForm] = useState<Partial<Departamento>>({ nombre: '', activo: true })
  const [showDeptForm, setShowDeptForm] = useState(false)

  // Nómina state
  const [nominaMes, setNominaMes] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
  const [nominaAnio, setNominaAnio] = useState(() => String(new Date().getFullYear()))
  const [expandedSalario, setExpandedSalario] = useState<string | null>(null)
  const [showConceptoForm, setShowConceptoForm] = useState(false)
  const [editingConcepto, setEditingConcepto] = useState<Concepto | null>(null)
  const [conceptoForm, setConceptoForm] = useState<{ nombre: string; tipo: 'HABER' | 'DESCUENTO' }>({ nombre: '', tipo: 'HABER' })
  const [newItem, setNewItem] = useState<{ descripcion: string; tipo: 'HABER' | 'DESCUENTO'; monto: string; concepto_id: string }>({ descripcion: '', tipo: 'HABER', monto: '', concepto_id: '' })
  const [cajaSessionId, setCajaSessionId] = useState<string>('')
  const [medioPagoNomina, setMedioPagoNomina] = useState<'efectivo' | 'transferencia_banco' | 'mp'>('efectivo')
  const [historialEmpleadoId, setHistorialEmpleadoId] = useState<string>('')
  const [showHistorialSueldos, setShowHistorialSueldos] = useState(false)

  // Dashboard state
  const [dashMes, setDashMes] = useState(() => format(new Date(), 'yyyy-MM'))

  // Vacaciones state
  const [vacAnio, setVacAnio] = useState(() => new Date().getFullYear())
  const [showVacForm, setShowVacForm] = useState(false)
  const [vacForm, setVacForm] = useState<{ empleado_id: string; desde: string; hasta: string; notas: string }>({ empleado_id: '', desde: '', hasta: '', notas: '' })
  const [showSaldosVac, setShowSaldosVac] = useState(false)
  const [editingSaldo, setEditingSaldo] = useState<VacacionSaldo | null>(null)
  const [saldoForm, setSaldoForm] = useState<{ dias_totales: string; remanente_anterior: string }>({ dias_totales: '', remanente_anterior: '' })

  // Asistencia state
  const [asistFecha, setAsistFecha] = useState(() => format(new Date(), 'yyyy-MM'))
  const [showAsistForm, setShowAsistForm] = useState(false)
  const [editingAsistencia, setEditingAsistencia] = useState<Asistencia | null>(null)
  const [asistForm, setAsistForm] = useState<{ empleado_id: string; fecha: string; hora_entrada: string; hora_salida: string; estado: string; motivo: string }>({
    empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), hora_entrada: '', hora_salida: '', estado: 'presente', motivo: '',
  })
  const [asistFiltroEmpleado, setAsistFiltroEmpleado] = useState('')

  // Check-in rápido state
  const [checkinEmpleadoId, setCheckinEmpleadoId] = useState('')

  // Feriados state
  const [showFeriadoForm, setShowFeriadoForm] = useState(false)
  const [editingFeriado, setEditingFeriado] = useState<Feriado | null>(null)
  const [feriadoForm, setFeriadoForm] = useState<{ nombre: string; fecha: string; tipo: string }>({
    nombre: '', fecha: format(new Date(), 'yyyy-MM-dd'), tipo: 'nacional',
  })

  // Documentos state
  const [docEmpleadoFiltro, setDocEmpleadoFiltro] = useState('')
  const [docUploading, setDocUploading] = useState(false)
  const [docForm, setDocForm] = useState<{ empleado_id: string; nombre: string; descripcion: string; tipo: string; file: File | null }>({
    empleado_id: '', nombre: '', descripcion: '', tipo: 'otro', file: null,
  })
  const [showDocForm, setShowDocForm] = useState(false)

  // Capacitaciones state
  const [capFiltroEmpleado, setCapFiltroEmpleado] = useState('')
  const [capFiltroEstado, setCapFiltroEstado] = useState('')
  const [showCapForm, setShowCapForm] = useState(false)
  const [editingCap, setEditingCap] = useState<Capacitacion | null>(null)
  const [capUploading, setCapUploading] = useState(false)
  const [capForm, setCapForm] = useState<{
    empleado_id: string; nombre: string; descripcion: string
    fecha_inicio: string; fecha_fin: string; horas: string
    proveedor: string; estado: string; resultado: string; certFile: File | null
  }>({
    empleado_id: '', nombre: '', descripcion: '', fecha_inicio: '', fecha_fin: '',
    horas: '', proveedor: '', estado: 'planificada', resultado: '', certFile: null,
  })

  // Queries
  const { data: empleados = [], isLoading: loadingEmpleados } = useQuery({
    queryKey: ['empleados', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados')
        .select('*, puesto:rrhh_puestos(id, nombre), departamento:rrhh_departamentos(id, nombre), supervisor:users!supervisor_id(id, nombre_display)')
        .eq('tenant_id', tenant!.id)
        .order('fecha_ingreso', { ascending: false })
      if (error) throw error
      return (data ?? []) as Empleado[]
    },
    enabled: !!tenant,
  })

  const { data: puestos = [] } = useQuery({
    queryKey: ['puestos', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_puestos')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .order('nombre')
      if (error) throw error
      return (data ?? []) as Puesto[]
    },
    enabled: !!tenant,
  })

  const { data: departamentos = [] } = useQuery({
    queryKey: ['departamentos', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_departamentos')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .order('nombre')
      if (error) throw error
      return (data ?? []) as Departamento[]
    },
    enabled: !!tenant,
  })

  // Nómina queries
  const nominaPeriodo = `${nominaAnio}-${nominaMes}-01`

  const { data: conceptos = [] } = useQuery({
    queryKey: ['rrhh_conceptos', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_conceptos')
        .select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('tipo').order('nombre')
      if (error) throw error
      return (data ?? []) as Concepto[]
    },
    enabled: !!tenant,
  })

  const { data: salarios = [], isLoading: loadingSalarios, refetch: refetchSalarios } = useQuery({
    queryKey: ['rrhh_salarios', tenant?.id, nominaPeriodo],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_salarios')
        .select('*, empleado:empleados(*)')
        .eq('tenant_id', tenant!.id)
        .eq('periodo', nominaPeriodo)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as Salario[]
    },
    enabled: !!tenant && activeTab === 'nomina',
  })

  const { data: salarioItems = [], refetch: refetchItems } = useQuery({
    queryKey: ['rrhh_salario_items', expandedSalario],
    queryFn: async () => {
      if (!expandedSalario) return []
      const { data, error } = await supabase.from('rrhh_salario_items')
        .select('*').eq('salario_id', expandedSalario).order('tipo').order('descripcion')
      if (error) throw error
      return (data ?? []) as SalarioItem[]
    },
    enabled: !!expandedSalario,
  })

  const { data: historialSueldos = [] } = useQuery({
    queryKey: ['rrhh_historial_sueldos', tenant?.id, historialEmpleadoId],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_salarios')
        .select('id, periodo, basico, total_haberes, total_descuentos, neto, pagado, fecha_pago, medio_pago')
        .eq('tenant_id', tenant!.id)
        .eq('empleado_id', historialEmpleadoId)
        .order('periodo', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && !!historialEmpleadoId && showHistorialSueldos,
  })

  const { data: cajaSesiones = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('caja_sesiones')
        .select('id, caja_id, abierta_at, cajas(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'abierta')
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'nomina',
  })

  // Dashboard queries
  const { data: dashAsist = [] } = useQuery({
    queryKey: ['rrhh_dash_asist', tenant?.id, dashMes],
    queryFn: async () => {
      const [y, m] = dashMes.split('-').map(Number)
      const { data, error } = await supabase.from('rrhh_asistencia')
        .select('estado, empleado_id')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', `${dashMes}-01`)
        .lte('fecha', format(new Date(y, m, 0), 'yyyy-MM-dd'))
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'dashboard',
  })

  const { data: dashVac = [] } = useQuery({
    queryKey: ['rrhh_dash_vac', tenant?.id, new Date().getFullYear()],
    queryFn: async () => {
      const anio = new Date().getFullYear()
      const { data, error } = await supabase.from('rrhh_vacaciones_solicitud')
        .select('estado, dias_habiles, empleado_id')
        .eq('tenant_id', tenant!.id)
        .gte('desde', `${anio}-01-01`)
        .lte('desde', `${anio}-12-31`)
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'dashboard',
  })

  const { data: dashNomina = [] } = useQuery({
    queryKey: ['rrhh_dash_nomina', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_salarios')
        .select('periodo, neto, pagado, empleado_id')
        .eq('tenant_id', tenant!.id)
        .order('periodo', { ascending: false })
        .limit(200)
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'dashboard',
  })

  // Vacaciones queries
  const { data: vacSolicitudes = [], refetch: refetchVacSolicitudes } = useQuery({
    queryKey: ['rrhh_vacaciones_solicitudes', tenant?.id, vacAnio],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_vacaciones_solicitud')
        .select('*, empleado:empleados(id, dni_rut)')
        .eq('tenant_id', tenant!.id)
        .gte('desde', `${vacAnio}-01-01`)
        .lte('desde', `${vacAnio}-12-31`)
        .order('desde', { ascending: false })
      if (error) throw error
      return (data ?? []) as VacacionSolicitud[]
    },
    enabled: !!tenant && activeTab === 'vacaciones',
  })

  const { data: vacSaldos = [], refetch: refetchVacSaldos } = useQuery({
    queryKey: ['rrhh_vacaciones_saldos', tenant?.id, vacAnio],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_vacaciones_saldo')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .eq('anio', vacAnio)
      if (error) throw error
      return (data ?? []) as VacacionSaldo[]
    },
    enabled: !!tenant && activeTab === 'vacaciones',
  })

  // Asistencia queries
  const { data: asistencias = [], refetch: refetchAsistencias } = useQuery({
    queryKey: ['rrhh_asistencia', tenant?.id, asistFecha],
    queryFn: async () => {
      const [y, m] = asistFecha.split('-').map(Number)
      const desde = `${asistFecha}-01`
      const hasta = format(new Date(y, m, 0), 'yyyy-MM-dd')
      const { data, error } = await supabase.from('rrhh_asistencia')
        .select('*, empleado:empleados(id, dni_rut)')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
      if (error) throw error
      return (data ?? []) as Asistencia[]
    },
    enabled: !!tenant && activeTab === 'asistencia',
  })

  const { data: supervisores = [] } = useQuery({
    queryKey: ['usuarios-supervisores', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('users')
        .select('id, nombre_display')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
      if (error) throw error
      return (data ?? []) as Array<{ id: string; nombre_display: string }>
    },
    enabled: !!tenant,
  })

  // Feriados query
  const { data: feriados = [], refetch: refetchFeriados } = useQuery({
    queryKey: ['rrhh_feriados', tenant?.id],
    queryFn: async () => {
      const hoy = format(new Date(), 'yyyy-MM-dd')
      const en60 = format(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
      const { data, error } = await supabase.from('rrhh_feriados')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', hoy)
        .lte('fecha', en60)
        .order('fecha')
      if (error) throw error
      return (data ?? []) as Feriado[]
    },
    enabled: !!tenant && (activeTab === 'cumpleanos' || activeTab === 'dashboard'),
  })

  // Asistencia hoy del empleado seleccionado para check-in
  const { data: asistenciaHoy, refetch: refetchAsistenciaHoy } = useQuery({
    queryKey: ['rrhh_asistencia_hoy', tenant?.id, checkinEmpleadoId],
    queryFn: async () => {
      const hoy = format(new Date(), 'yyyy-MM-dd')
      const { data } = await supabase.from('rrhh_asistencia')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .eq('empleado_id', checkinEmpleadoId)
        .eq('fecha', hoy)
        .maybeSingle()
      return data as Asistencia | null
    },
    enabled: !!tenant && !!checkinEmpleadoId && activeTab === 'asistencia',
  })

  // Mutations
  const saveEmpleado = useMutation({
    mutationFn: async (data: Partial<Empleado>) => {
      if (formMode === 'crear') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { puesto, departamento, supervisor, ...campos } = data as any
        const { error } = await supabase.from('empleados').insert({
          tenant_id: tenant!.id,
          ...campos,
        })
        if (error) throw error
        logActividad({
          entidad: 'empleado',
          entidad_id: '',
          entidad_nombre: nombreEmpleado(data) || 'Nuevo empleado',
          accion: 'crear',
          pagina: '/rrhh',
        })
      } else if (selectedEmpleado) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { puesto, departamento, supervisor, ...campos } = data as any
        const { error } = await supabase
          .from('empleados')
          .update(campos)
          .eq('id', selectedEmpleado.id)
        if (error) throw error
        logActividad({
          entidad: 'empleado',
          entidad_id: selectedEmpleado.id,
          entidad_nombre: nombreEmpleado(selectedEmpleado),
          accion: 'editar',
          pagina: '/rrhh',
        })
      }
    },
    onSuccess: () => {
      toast.success(formMode === 'crear' ? 'Empleado creado' : 'Empleado actualizado')
      qc.invalidateQueries({ queryKey: ['empleados'] })
      resetForm()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al guardar'),
  })

  const toggleEmpleadoActivo = useMutation({
    mutationFn: async (empId: string) => {
      const emp = empleados.find((e) => e.id === empId)
      if (!emp) return
      const { error } = await supabase
        .from('empleados')
        .update({ activo: !emp.activo })
        .eq('id', empId)
      if (error) throw error
      logActividad({
        entidad: 'empleado',
        entidad_id: empId,
        entidad_nombre: nombreEmpleado(emp),
        accion: 'editar',
        campo: 'activo',
        valor_nuevo: !emp.activo ? 'Activo' : 'Inactivo',
        pagina: '/rrhh',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['empleados'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const savePuesto = useMutation({
    mutationFn: async (data: Partial<Puesto>) => {
      if (!editingPuesto) {
        const { error } = await supabase.from('rrhh_puestos').insert({
          tenant_id: tenant!.id,
          ...data,
        })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('rrhh_puestos')
          .update(data)
          .eq('id', editingPuesto.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('Puesto guardado')
      qc.invalidateQueries({ queryKey: ['puestos'] })
      setEditingPuesto(null)
      setPuestoForm({ nombre: '', activo: true })
      setShowPuestoForm(false)
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const saveDepartamento = useMutation({
    mutationFn: async (data: Partial<Departamento>) => {
      if (!editingDepartamento) {
        const { error } = await supabase.from('rrhh_departamentos').insert({
          tenant_id: tenant!.id,
          ...data,
        })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('rrhh_departamentos')
          .update(data)
          .eq('id', editingDepartamento.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('Departamento guardado')
      qc.invalidateQueries({ queryKey: ['departamentos'] })
      setEditingDepartamento(null)
      setDeptForm({ nombre: '', activo: true })
      setShowDeptForm(false)
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const deletePuesto = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rrhh_puestos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Puesto eliminado')
      qc.invalidateQueries({ queryKey: ['puestos'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const deleteDepartamento = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rrhh_departamentos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Departamento eliminado')
      qc.invalidateQueries({ queryKey: ['departamentos'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  // ─── Nómina mutations ───────────────────────────────────────────────────────
  const saveConcepto = useMutation({
    mutationFn: async (data: { nombre: string; tipo: 'HABER' | 'DESCUENTO' }) => {
      if (editingConcepto) {
        const { error } = await supabase.from('rrhh_conceptos').update(data).eq('id', editingConcepto.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('rrhh_conceptos').insert({ tenant_id: tenant!.id, ...data })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingConcepto ? 'Concepto actualizado' : 'Concepto creado')
      qc.invalidateQueries({ queryKey: ['rrhh_conceptos'] })
      setShowConceptoForm(false)
      setEditingConcepto(null)
      setConceptoForm({ nombre: '', tipo: 'HABER' })
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al guardar concepto'),
  })

  const deleteConcepto = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rrhh_conceptos').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Concepto eliminado'); qc.invalidateQueries({ queryKey: ['rrhh_conceptos'] }) },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const crearLiquidacion = useMutation({
    mutationFn: async (emp: Empleado) => {
      const id = crypto.randomUUID()
      const basico = emp.salario_bruto ?? 0
      const { error } = await supabase.from('rrhh_salarios').insert({
        id,
        tenant_id: tenant!.id,
        empleado_id: emp.id,
        periodo: nominaPeriodo,
        basico,
        total_haberes: basico,
        total_descuentos: 0,
        neto: basico,
      })
      if (error) throw error
      // Insert item de sueldo base
      if (basico > 0) {
        await supabase.from('rrhh_salario_items').insert({
          tenant_id: tenant!.id,
          salario_id: id,
          descripcion: 'Sueldo básico',
          tipo: 'HABER',
          monto: basico,
        })
      }
      logActividad({ entidad: 'nomina', entidad_id: id, entidad_nombre: nombreEmpleado(emp), accion: 'crear', pagina: '/rrhh' })
    },
    onSuccess: () => { toast.success('Liquidación creada'); refetchSalarios() },
    onError: (err: any) => toast.error(err.message ?? 'Error al crear liquidación'),
  })

  const generarNominaMes = useMutation({
    mutationFn: async () => {
      const activos = empleados.filter((e) => e.activo)
      const yaExisten = new Set(salarios.map((s) => s.empleado_id))
      const faltantes = activos.filter((e) => !yaExisten.has(e.id))
      for (const emp of faltantes) {
        await crearLiquidacion.mutateAsync(emp)
      }
      return faltantes.length
    },
    onSuccess: (n) => toast.success(`${n} liquidaciones generadas`),
    onError: (err: any) => toast.error(err.message ?? 'Error al generar nómina'),
  })

  const addSalarioItem = useMutation({
    mutationFn: async ({ salarioId, item }: { salarioId: string; item: typeof newItem }) => {
      if (!item.descripcion.trim() || !item.monto) throw new Error('Descripción y monto son requeridos')
      const { error } = await supabase.from('rrhh_salario_items').insert({
        tenant_id: tenant!.id,
        salario_id: salarioId,
        concepto_id: item.concepto_id || null,
        descripcion: item.descripcion,
        tipo: item.tipo,
        monto: parseFloat(item.monto),
      })
      if (error) throw error
    },
    onSuccess: () => {
      setNewItem({ descripcion: '', tipo: 'HABER', monto: '', concepto_id: '' })
      refetchItems()
      refetchSalarios()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al agregar concepto'),
  })

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from('rrhh_salario_items').delete().eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => { refetchItems(); refetchSalarios() },
    onError: (err: any) => toast.error(err.message ?? 'Error al eliminar'),
  })

  const pagarNomina = useMutation({
    mutationFn: async (salarioId: string) => {
      if (!cajaSessionId) throw new Error('Seleccioná una sesión de caja')
      const { data, error } = await supabase.rpc('pagar_nomina_empleado', {
        p_salario_id: salarioId,
        p_sesion_id: cajaSessionId,
        p_medio_pago: medioPagoNomina,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_, salarioId) => {
      toast.success('Nómina pagada')
      const sal = salarios.find((s) => s.id === salarioId)
      logActividad({ entidad: 'nomina', entidad_id: salarioId, entidad_nombre: nombreEmpleado(sal?.empleado), accion: 'pagar', pagina: '/rrhh' })
      refetchSalarios()
      qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al pagar nómina'),
  })

  // ─── Vacaciones mutations ────────────────────────────────────────────────────
  const crearSolicitudVac = useMutation({
    mutationFn: async (form: typeof vacForm) => {
      if (!form.empleado_id) throw new Error('Seleccioná un empleado')
      if (!form.desde || !form.hasta) throw new Error('Indicá fechas desde y hasta')
      if (form.desde > form.hasta) throw new Error('La fecha "hasta" debe ser posterior a "desde"')
      const diasHabiles = calcularDiasHabilesFrontend(form.desde, form.hasta)
      const { error } = await supabase.from('rrhh_vacaciones_solicitud').insert({
        tenant_id: tenant!.id,
        empleado_id: form.empleado_id,
        desde: form.desde,
        hasta: form.hasta,
        dias_habiles: diasHabiles,
        notas: form.notas || null,
      })
      if (error) throw error
      const emp = empleados.find(e => e.id === form.empleado_id)
      logActividad({ entidad: 'vacacion', entidad_nombre: nombreEmpleado(emp), accion: 'crear', pagina: '/rrhh' })
    },
    onSuccess: () => {
      toast.success('Solicitud creada')
      setShowVacForm(false)
      setVacForm({ empleado_id: '', desde: '', hasta: '', notas: '' })
      refetchVacSolicitudes()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al crear solicitud'),
  })

  const aprobarVacacion = useMutation({
    mutationFn: async (solicitudId: string) => {
      const { error } = await supabase.rpc('aprobar_vacacion', { p_solicitud_id: solicitudId, p_user_id: user!.id })
      if (error) throw error
      logActividad({ entidad: 'vacacion', entidad_id: solicitudId, accion: 'cambio_estado', valor_nuevo: 'aprobada', pagina: '/rrhh' })
    },
    onSuccess: () => { toast.success('Vacación aprobada'); refetchVacSolicitudes(); refetchVacSaldos() },
    onError: (err: any) => toast.error(err.message ?? 'Error al aprobar'),
  })

  const rechazarVacacion = useMutation({
    mutationFn: async (solicitudId: string) => {
      const { error } = await supabase.rpc('rechazar_vacacion', { p_solicitud_id: solicitudId, p_user_id: user!.id })
      if (error) throw error
      logActividad({ entidad: 'vacacion', entidad_id: solicitudId, accion: 'cambio_estado', valor_nuevo: 'rechazada', pagina: '/rrhh' })
    },
    onSuccess: () => { toast.success('Solicitud rechazada'); refetchVacSolicitudes() },
    onError: (err: any) => toast.error(err.message ?? 'Error al rechazar'),
  })

  const deleteSolicitudVac = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rrhh_vacaciones_solicitud').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Solicitud eliminada'); refetchVacSolicitudes() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const saveSaldoVac = useMutation({
    mutationFn: async ({ empleadoId, data }: { empleadoId: string; data: typeof saldoForm }) => {
      const { error } = await supabase.from('rrhh_vacaciones_saldo').upsert({
        tenant_id: tenant!.id,
        empleado_id: empleadoId,
        anio: vacAnio,
        dias_totales: parseInt(data.dias_totales) || 0,
        remanente_anterior: parseInt(data.remanente_anterior) || 0,
      }, { onConflict: 'tenant_id,empleado_id,anio' })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Saldo actualizado'); setEditingSaldo(null); refetchVacSaldos() },
    onError: (err: any) => toast.error(err.message ?? 'Error al guardar saldo'),
  })

  // ─── Asistencia mutations ────────────────────────────────────────────────────
  const saveAsistencia = useMutation({
    mutationFn: async (form: typeof asistForm) => {
      if (!form.empleado_id && !editingAsistencia) throw new Error('Seleccioná un empleado')
      if (!form.fecha) throw new Error('Indicá la fecha')
      const payload = {
        tenant_id: tenant!.id,
        empleado_id: editingAsistencia ? editingAsistencia.empleado_id : form.empleado_id,
        fecha: form.fecha,
        hora_entrada: form.hora_entrada || null,
        hora_salida: form.hora_salida || null,
        estado: form.estado,
        motivo: form.motivo || null,
      }
      if (editingAsistencia) {
        const { error } = await supabase.from('rrhh_asistencia').update(payload).eq('id', editingAsistencia.id)
        if (error) throw error
        logActividad({ entidad: 'asistencia', entidad_id: editingAsistencia.id, accion: 'editar', pagina: '/rrhh' })
      } else {
        const id = crypto.randomUUID()
        const { error } = await supabase.from('rrhh_asistencia').insert({ id, ...payload })
        if (error) throw error
        logActividad({ entidad: 'asistencia', entidad_id: id, accion: 'crear', pagina: '/rrhh' })
      }
    },
    onSuccess: () => {
      toast.success(editingAsistencia ? 'Asistencia actualizada' : 'Asistencia registrada')
      setShowAsistForm(false)
      setEditingAsistencia(null)
      setAsistForm({ empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), hora_entrada: '', hora_salida: '', estado: 'presente', motivo: '' })
      refetchAsistencias()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al guardar'),
  })

  const deleteAsistencia = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rrhh_asistencia').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Registro eliminado'); refetchAsistencias() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  // ─── Check-in rápido ────────────────────────────────────────────────────────
  const checkinRapido = useMutation({
    mutationFn: async ({ tipo }: { tipo: 'entrada' | 'salida' }) => {
      if (!checkinEmpleadoId) throw new Error('Seleccioná un empleado')
      const hoy = format(new Date(), 'yyyy-MM-dd')
      const hora = format(new Date(), 'HH:mm')
      if (asistenciaHoy) {
        const patch = tipo === 'entrada' ? { hora_entrada: hora, estado: 'presente' } : { hora_salida: hora }
        const { error } = await supabase.from('rrhh_asistencia').update(patch).eq('id', asistenciaHoy.id)
        if (error) throw error
        logActividad({ entidad: 'asistencia', entidad_id: asistenciaHoy.id, accion: 'editar', pagina: '/rrhh' })
      } else {
        const id = crypto.randomUUID()
        const { error } = await supabase.from('rrhh_asistencia').insert({
          id,
          tenant_id: tenant!.id,
          empleado_id: checkinEmpleadoId,
          fecha: hoy,
          hora_entrada: tipo === 'entrada' ? hora : null,
          hora_salida: tipo === 'salida' ? hora : null,
          estado: 'presente',
          motivo: null,
        })
        if (error) throw error
        logActividad({ entidad: 'asistencia', entidad_id: id, accion: 'crear', pagina: '/rrhh' })
      }
    },
    onSuccess: (_, { tipo }) => {
      toast.success(tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada')
      refetchAsistenciaHoy()
      refetchAsistencias()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  // ─── Feriados nacionales Argentina 2026 ────────────────────────────────────
  const FERIADOS_AR_2026 = [
    { fecha: '2026-01-01', nombre: 'Año Nuevo' },
    { fecha: '2026-02-16', nombre: 'Carnaval (lunes)' },
    { fecha: '2026-02-17', nombre: 'Carnaval (martes)' },
    { fecha: '2026-03-24', nombre: 'Día Nacional de la Memoria' },
    { fecha: '2026-04-02', nombre: 'Día del Veterano de Malvinas' },
    { fecha: '2026-04-03', nombre: 'Viernes Santo' },
    { fecha: '2026-05-01', nombre: 'Día del Trabajador' },
    { fecha: '2026-05-25', nombre: 'Día de la Revolución de Mayo' },
    { fecha: '2026-06-15', nombre: 'Paso a la Inmortalidad del Gral. Güemes' },
    { fecha: '2026-06-20', nombre: 'Paso a la Inmortalidad del Gral. Belgrano' },
    { fecha: '2026-07-09', nombre: 'Día de la Independencia' },
    { fecha: '2026-08-17', nombre: 'Paso a la Inmortalidad del Gral. San Martín' },
    { fecha: '2026-10-12', nombre: 'Día del Respeto a la Diversidad Cultural' },
    { fecha: '2026-11-20', nombre: 'Día de la Soberanía Nacional' },
    { fecha: '2026-12-08', nombre: 'Inmaculada Concepción de María' },
    { fecha: '2026-12-25', nombre: 'Navidad' },
  ]

  const cargarFeriadosNacionales = useMutation({
    mutationFn: async () => {
      // Solo insertar los que no existen (por fecha + tenant)
      const { data: existentes } = await supabase.from('rrhh_feriados')
        .select('fecha').eq('tenant_id', tenant!.id)
        .in('fecha', FERIADOS_AR_2026.map(f => f.fecha))
      const existentesFechas = new Set((existentes ?? []).map((e: any) => e.fecha))
      const nuevos = FERIADOS_AR_2026.filter(f => !existentesFechas.has(f.fecha))
      if (nuevos.length === 0) throw new Error('Todos los feriados 2026 ya están cargados')
      const { error } = await supabase.from('rrhh_feriados').insert(
        nuevos.map(f => ({ id: crypto.randomUUID(), tenant_id: tenant!.id, nombre: f.nombre, fecha: f.fecha, tipo: 'nacional', created_by: user!.id }))
      )
      if (error) throw error
      return nuevos.length
    },
    onSuccess: (n) => { toast.success(`${n} feriado${n !== 1 ? 's' : ''} nacionales 2026 cargados`); refetchFeriados() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  // ─── Feriados mutations ──────────────────────────────────────────────────────
  const saveFeriado = useMutation({
    mutationFn: async (form: { nombre: string; fecha: string; tipo: string }) => {
      if (!form.nombre.trim()) throw new Error('Ingresá el nombre del feriado')
      if (!form.fecha) throw new Error('Indicá la fecha')
      const payload = {
        tenant_id: tenant!.id,
        nombre: form.nombre.trim(),
        fecha: form.fecha,
        tipo: form.tipo,
        created_by: user!.id,
      }
      if (editingFeriado) {
        const { error } = await supabase.from('rrhh_feriados').update(payload).eq('id', editingFeriado.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('rrhh_feriados').insert({ id: crypto.randomUUID(), ...payload })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingFeriado ? 'Feriado actualizado' : 'Feriado agregado')
      setShowFeriadoForm(false)
      setEditingFeriado(null)
      setFeriadoForm({ nombre: '', fecha: format(new Date(), 'yyyy-MM-dd'), tipo: 'nacional' })
      refetchFeriados()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const deleteFeriado = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rrhh_feriados').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Feriado eliminado'); refetchFeriados() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  // ─── Exports ─────────────────────────────────────────────────────────────────
  const exportAsistenciaMes = async () => {
    const [y, m] = dashMes.split('-').map(Number)
    const desde = `${dashMes}-01`
    const hasta = format(new Date(y, m, 0), 'yyyy-MM-dd')
    const { data, error } = await supabase.from('rrhh_asistencia')
      .select('fecha, estado, hora_entrada, hora_salida, motivo, empleado:empleados(nombre, apellido, dni_rut)')
      .eq('tenant_id', tenant!.id)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
    if (error) { toast.error('Error al exportar'); return }
    const rows = (data ?? []).map((a: any) => ({
      Fecha: a.fecha,
      Empleado: ([a.empleado?.nombre, a.empleado?.apellido].filter(Boolean).join(' ') || a.empleado?.dni_rut) ?? '',
      Estado: a.estado,
      'Hora entrada': a.hora_entrada ?? '',
      'Hora salida': a.hora_salida ?? '',
      Motivo: a.motivo ?? '',
    }))
    const ws = xlsxUtils.json_to_sheet(rows)
    const wb = xlsxUtils.book_new()
    xlsxUtils.book_append_sheet(wb, ws, 'Asistencia')
    xlsxWriteFile(wb, `asistencia_${dashMes}.xlsx`)
    toast.success('Excel descargado')
  }

  const exportNominaHistorica = async () => {
    const { data, error } = await supabase.from('rrhh_salarios')
      .select('periodo, basico, total_haberes, total_descuentos, neto, pagado, fecha_pago, empleado:empleados(nombre, apellido, dni_rut)')
      .eq('tenant_id', tenant!.id)
      .order('periodo', { ascending: false })
    if (error) { toast.error('Error al exportar'); return }
    const rows = (data ?? []).map((s: any) => ({
      Período: s.periodo?.slice(0, 7) ?? '',
      Empleado: ([s.empleado?.nombre, s.empleado?.apellido].filter(Boolean).join(' ') || s.empleado?.dni_rut) ?? '',
      Básico: s.basico,
      'Total haberes': s.total_haberes,
      'Total descuentos': s.total_descuentos,
      Neto: s.neto,
      Estado: s.pagado ? 'Pagado' : 'Pendiente',
      'Fecha pago': s.fecha_pago ? format(new Date(s.fecha_pago), 'dd/MM/yyyy HH:mm', { locale: es }) : '',
    }))
    const ws = xlsxUtils.json_to_sheet(rows)
    const wb = xlsxUtils.book_new()
    xlsxUtils.book_append_sheet(wb, ws, 'Nómina')
    xlsxWriteFile(wb, `nomina_historica.xlsx`)
    toast.success('Excel descargado')
  }

  const resetForm = () => {
    setFormMode(null)
    setSelectedEmpleado(null)
    setFormData({
      dni_rut: '',
      tipo_doc: 'DNI',
      genero: 'OTRO',
      fecha_ingreso: format(new Date(), 'yyyy-MM-dd'),
      tipo_contrato: 'INDEFINIDO',
      activo: true,
    })
  }

  const handleEditEmpleado = (emp: Empleado) => {
    setSelectedEmpleado(emp)
    setFormData(emp)
    setFormMode('editar')
  }

  const handleGuardarEmpleado = async () => {
    if (!formData.nombre?.trim()) {
      toast.error('Nombre es requerido')
      return
    }
    if (!formData.dni_rut?.trim()) {
      toast.error('DNI/RUT es requerido')
      return
    }
    if (!formData.fecha_ingreso) {
      toast.error('Fecha de ingreso es requerida')
      return
    }
    saveEmpleado.mutate(formData)
  }

  const nombreEmpleado = (emp: Partial<Empleado> | null | undefined) => {
    if (!emp) return ''
    return [emp.nombre, emp.apellido].filter(Boolean).join(' ') || emp.dni_rut || ''
  }

  // Documentos queries & mutations
  const { data: documentos = [], refetch: refetchDocumentos } = useQuery({
    queryKey: ['rrhh-documentos', tenant?.id, docEmpleadoFiltro],
    queryFn: async () => {
      let q = supabase.from('rrhh_documentos')
        .select('*, empleado:empleados(nombre, apellido, dni_rut)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
      if (docEmpleadoFiltro) q = q.eq('empleado_id', docEmpleadoFiltro)
      const { data, error } = await q
      if (error) throw error
      return data as Documento[]
    },
    enabled: !!tenant && activeTab === 'documentos',
  })

  const uploadDocumento = async () => {
    if (!docForm.file || !docForm.empleado_id || !docForm.nombre.trim()) {
      toast.error('Completá empleado, nombre y archivo')
      return
    }
    setDocUploading(true)
    try {
      const ext = docForm.file.name.split('.').pop()
      const path = `${docForm.empleado_id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('empleados').upload(path, docForm.file)
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('rrhh_documentos').insert({
        tenant_id: tenant!.id,
        empleado_id: docForm.empleado_id,
        nombre: docForm.nombre.trim(),
        descripcion: docForm.descripcion || null,
        tipo: docForm.tipo,
        storage_path: path,
        tamanio: docForm.file.size,
        mime_type: docForm.file.type,
        created_by: user?.id ?? null,
      })
      if (dbErr) throw dbErr
      toast.success('Documento subido')
      setShowDocForm(false)
      setDocForm({ empleado_id: '', nombre: '', descripcion: '', tipo: 'otro', file: null })
      refetchDocumentos()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDocUploading(false)
    }
  }

  const deleteDocumento = useMutation({
    mutationFn: async (doc: Documento) => {
      await supabase.storage.from('empleados').remove([doc.storage_path])
      const { error } = await supabase.from('rrhh_documentos').delete().eq('id', doc.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Documento eliminado'); refetchDocumentos() },
    onError: (err: any) => toast.error(err.message),
  })

  const getDocUrl = async (path: string) => {
    const { data } = await supabase.storage.from('empleados').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('No se pudo obtener el link')
  }

  // Capacitaciones queries & mutations
  const { data: capacitaciones = [], refetch: refetchCapacitaciones } = useQuery({
    queryKey: ['rrhh-capacitaciones', tenant?.id, capFiltroEmpleado, capFiltroEstado],
    queryFn: async () => {
      let q = supabase.from('rrhh_capacitaciones')
        .select('*, empleado:empleados(nombre, apellido, dni_rut)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
      if (capFiltroEmpleado) q = q.eq('empleado_id', capFiltroEmpleado)
      if (capFiltroEstado) q = q.eq('estado', capFiltroEstado)
      const { data, error } = await q
      if (error) throw error
      return data as Capacitacion[]
    },
    enabled: !!tenant && activeTab === 'capacitaciones',
  })

  const saveCapacitacion = async () => {
    if (!capForm.empleado_id || !capForm.nombre.trim()) {
      toast.error('Seleccioná empleado y completá el nombre')
      return
    }
    setCapUploading(true)
    try {
      let certPath: string | null = editingCap?.certificado_path ?? null
      if (capForm.certFile) {
        const ext = capForm.certFile.name.split('.').pop()
        certPath = `${capForm.empleado_id}/cap_${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('empleados').upload(certPath, capForm.certFile)
        if (upErr) throw upErr
      }
      const payload = {
        tenant_id: tenant!.id,
        empleado_id: capForm.empleado_id,
        nombre: capForm.nombre.trim(),
        descripcion: capForm.descripcion || null,
        fecha_inicio: capForm.fecha_inicio || null,
        fecha_fin: capForm.fecha_fin || null,
        horas: capForm.horas ? parseFloat(capForm.horas) : null,
        proveedor: capForm.proveedor || null,
        estado: capForm.estado,
        resultado: capForm.resultado || null,
        certificado_path: certPath,
        created_by: user?.id ?? null,
      }
      if (editingCap) {
        const { error } = await supabase.from('rrhh_capacitaciones').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingCap.id)
        if (error) throw error
        toast.success('Capacitación actualizada')
      } else {
        const { error } = await supabase.from('rrhh_capacitaciones').insert(payload)
        if (error) throw error
        toast.success('Capacitación guardada')
      }
      setShowCapForm(false)
      setEditingCap(null)
      setCapForm({ empleado_id: '', nombre: '', descripcion: '', fecha_inicio: '', fecha_fin: '', horas: '', proveedor: '', estado: 'planificada', resultado: '', certFile: null })
      refetchCapacitaciones()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setCapUploading(false)
    }
  }

  const deleteCapacitacion = useMutation({
    mutationFn: async (cap: Capacitacion) => {
      if (cap.certificado_path) await supabase.storage.from('empleados').remove([cap.certificado_path])
      const { error } = await supabase.from('rrhh_capacitaciones').delete().eq('id', cap.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Capacitación eliminada'); refetchCapacitaciones() },
    onError: (err: any) => toast.error(err.message),
  })

  const startEditCap = (cap: Capacitacion) => {
    setEditingCap(cap)
    setCapForm({
      empleado_id: cap.empleado_id,
      nombre: cap.nombre,
      descripcion: cap.descripcion ?? '',
      fecha_inicio: cap.fecha_inicio ?? '',
      fecha_fin: cap.fecha_fin ?? '',
      horas: cap.horas != null ? String(cap.horas) : '',
      proveedor: cap.proveedor ?? '',
      estado: cap.estado,
      resultado: cap.resultado ?? '',
      certFile: null,
    })
    setShowCapForm(true)
  }

  // Equipo (Phase 5): equipo del supervisor actual
  const teamEmpleados = empleados.filter((e) => e.supervisor_id === user?.id && e.activo)

  // Query: asistencia hoy del equipo (para tab equipo)
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const { data: teamAsistHoy = [] } = useQuery({
    queryKey: ['rrhh-team-asist-hoy', tenant?.id, user?.id, todayStr],
    queryFn: async () => {
      if (!teamEmpleados.length) return []
      const ids = teamEmpleados.map((e) => e.id)
      const { data, error } = await supabase.from('rrhh_asistencia')
        .select('empleado_id, estado')
        .eq('tenant_id', tenant!.id)
        .eq('fecha', todayStr)
        .in('empleado_id', ids)
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'equipo' && teamEmpleados.length > 0,
  })

  const { data: teamVacPendientes = [] } = useQuery({
    queryKey: ['rrhh-team-vac-pendientes', tenant?.id, user?.id],
    queryFn: async () => {
      if (!teamEmpleados.length) return []
      const ids = teamEmpleados.map((e) => e.id)
      const { data, error } = await supabase.from('rrhh_vacaciones_solicitud')
        .select('*, empleado:empleados(nombre, apellido, dni_rut)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'pendiente')
        .in('empleado_id', ids)
        .order('desde')
      if (error) throw error
      return (data ?? []) as VacacionSolicitud[]
    },
    enabled: !!tenant && activeTab === 'equipo' && teamEmpleados.length > 0,
  })

  const aprobarVacEquipo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('aprobar_vacacion', { p_solicitud_id: id, p_user_id: user!.id })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Vacación aprobada'); qc.invalidateQueries({ queryKey: ['rrhh-team-vac-pendientes'] }) },
    onError: (err: any) => toast.error(err.message),
  })

  const rechazarVacEquipo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('rechazar_vacacion', { p_solicitud_id: id, p_user_id: user!.id })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Vacación rechazada'); qc.invalidateQueries({ queryKey: ['rrhh-team-vac-pendientes'] }) },
    onError: (err: any) => toast.error(err.message),
  })

  const proximoCumpleanos = (fechaNacimiento: string) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const birth = new Date(fechaNacimiento)
    const next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate())
    if (next < today) next.setFullYear(today.getFullYear() + 1)
    return { days: differenceInDays(next, today), date: next }
  }

  // Cumpleaños - empleados activos con cumpleaños en los próximos 30 días
  const cumpleanosMes = empleados
    .filter((e) => {
      if (!e.fecha_nacimiento || !e.activo) return false
      const { days } = proximoCumpleanos(e.fecha_nacimiento)
      return days <= 30
    })
    .sort((a, b) => {
      const { days: dA } = proximoCumpleanos(a.fecha_nacimiento!)
      const { days: dB } = proximoCumpleanos(b.fecha_nacimiento!)
      return dA - dB
    })

  const filteredEmpleados = empleados.filter((e) => {
    const term = searchTerm.toLowerCase()
    return (
      e.dni_rut.toLowerCase().includes(term) ||
      e.nombre.toLowerCase().includes(term) ||
      (e.apellido ?? '').toLowerCase().includes(term) ||
      (e.email_personal ?? '').toLowerCase().includes(term)
    )
  })

  if (limits && !limits.puede_rrhh) return <UpgradePrompt feature="rrhh" />

  const esSupervisor = user?.rol === 'SUPERVISOR'
  const esRrhhAdmin = user?.rol === 'OWNER' || user?.rol === 'RRHH'

  if (!esRrhhAdmin && !esSupervisor) {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        No tienes permisos para acceder a este módulo
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <Users2 size={32} className="text-blue-600 dark:text-blue-400" />
          Gestión de Empleados
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Administra tu equipo de trabajo</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 border-b border-gray-200 dark:border-gray-700 flex-wrap">
        {(esSupervisor
          ? (['equipo', 'asistencia', 'vacaciones', 'cumpleanos'] as Tab[])
          : (['dashboard', 'empleados', 'puestos', 'departamentos', 'cumpleanos', 'nomina', 'vacaciones', 'asistencia', 'capacitaciones', 'documentos', 'equipo'] as Tab[])
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); resetForm() }}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'dashboard'      && <span className="flex items-center gap-1"><LayoutDashboard size={14}/>Dashboard</span>}
            {tab === 'empleados'      && 'Empleados'}
            {tab === 'puestos'        && 'Puestos'}
            {tab === 'departamentos'  && 'Departamentos'}
            {tab === 'cumpleanos'     && '🎂 Cumpleaños'}
            {tab === 'nomina'         && <span className="flex items-center gap-1"><DollarSign size={14}/>Nómina</span>}
            {tab === 'vacaciones'     && <span className="flex items-center gap-1"><Plane size={14}/>Vacaciones</span>}
            {tab === 'asistencia'     && <span className="flex items-center gap-1"><ClipboardList size={14}/>Asistencia</span>}
            {tab === 'documentos'     && <span className="flex items-center gap-1"><Paperclip size={14}/>Documentos</span>}
            {tab === 'capacitaciones' && <span className="flex items-center gap-1"><BookOpen size={14}/>Capacitaciones</span>}
            {tab === 'equipo'         && <span className="flex items-center gap-1"><Network size={14}/>Mi Equipo</span>}
          </button>
        ))}
      </div>

      {/* EMPLEADOS TAB */}
      {activeTab === 'empleados' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3 flex-1">
              <Search size={20} className="text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder="Buscar por DNI o estado..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg flex-1"
              />
            </div>
            <button
              onClick={() => {
                resetForm()
                setFormMode('crear')
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={18} />
              Nuevo Empleado
            </button>
          </div>

          {/* Form Modal - Crear/Editar Empleado */}
          {formMode && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <h2 className="text-2xl font-bold dark:text-white mb-6">
                  {formMode === 'crear' ? 'Nuevo Empleado' : 'Editar Empleado'}
                </h2>

                <div className="grid grid-cols-2 gap-4">
                  {/* Nombre y Apellido */}
                  <input
                    type="text"
                    placeholder="Nombre *"
                    value={formData.nombre ?? ''}
                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                  <input
                    type="text"
                    placeholder="Apellido"
                    value={formData.apellido ?? ''}
                    onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />

                  {/* DNI */}
                  <input
                    type="text"
                    placeholder="DNI/RUT *"
                    value={formData.dni_rut ?? ''}
                    onChange={(e) => setFormData({ ...formData, dni_rut: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                  <select
                    value={formData.tipo_doc ?? 'DNI'}
                    onChange={(e) => setFormData({ ...formData, tipo_doc: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="DNI">DNI</option>
                    <option value="RUT">RUT</option>
                    <option value="PASAPORTE">Pasaporte</option>
                    <option value="OTRO">Otro</option>
                  </select>

                  {/* Contacto */}
                  <input
                    type="tel"
                    placeholder="Teléfono personal"
                    value={formData.tel_personal ?? ''}
                    onChange={(e) => setFormData({ ...formData, tel_personal: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                  <input
                    type="email"
                    placeholder="Email personal"
                    value={formData.email_personal ?? ''}
                    onChange={(e) => setFormData({ ...formData, email_personal: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />

                  {/* Personales */}
                  <select
                    value={formData.genero ?? 'OTRO'}
                    onChange={(e) => setFormData({ ...formData, genero: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="OTRO">Género - Prefiero no especificar</option>
                    <option value="M">Masculino</option>
                    <option value="F">Femenino</option>
                  </select>
                  <input
                    type="date"
                    placeholder="Fecha de nacimiento"
                    value={formData.fecha_nacimiento ?? ''}
                    onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />

                  <input
                    type="text"
                    placeholder="Dirección"
                    value={formData.direccion ?? ''}
                    onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg col-span-2"
                  />

                  <input
                    type="tel"
                    placeholder="Teléfono emergencia (FON)"
                    value={formData.fon ?? ''}
                    onChange={(e) => setFormData({ ...formData, fon: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg col-span-2"
                  />

                  {/* Laboral */}
                  <input
                    type="date"
                    placeholder="Fecha ingreso *"
                    value={formData.fecha_ingreso ?? ''}
                    onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                  <input
                    type="date"
                    placeholder="Fecha egreso"
                    value={formData.fecha_egreso ?? ''}
                    onChange={(e) => setFormData({ ...formData, fecha_egreso: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />

                  <select
                    value={formData.puesto_id ?? ''}
                    onChange={(e) => {
                      const puestoId = e.target.value || null
                      const puestoSel = puestos.find(p => p.id === puestoId)
                      const updates: Partial<typeof formData> = { puesto_id: puestoId }
                      if (puestoSel?.salario_base_sugerido && !formData.salario_bruto) {
                        updates.salario_bruto = puestoSel.salario_base_sugerido
                      }
                      setFormData({ ...formData, ...updates })
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="">Selecciona puesto...</option>
                    {puestos.filter((p) => p.activo).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}{p.salario_base_sugerido ? ` — $${p.salario_base_sugerido.toLocaleString('es-AR')}` : ''}
                      </option>
                    ))}
                  </select>

                  <select
                    value={formData.departamento_id ?? ''}
                    onChange={(e) => setFormData({ ...formData, departamento_id: e.target.value || null })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="">Selecciona departamento...</option>
                    {departamentos.filter((d) => d.activo).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre}
                      </option>
                    ))}
                  </select>

                  <select
                    value={formData.supervisor_id ?? ''}
                    onChange={(e) => setFormData({ ...formData, supervisor_id: e.target.value || null })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg col-span-2"
                  >
                    <option value="">Selecciona supervisor...</option>
                    {supervisores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre_display}
                      </option>
                    ))}
                  </select>

                  <select
                    value={formData.tipo_contrato ?? 'INDEFINIDO'}
                    onChange={(e) => setFormData({ ...formData, tipo_contrato: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="INDEFINIDO">Indefinido</option>
                    <option value="PLAZO_FIJO">Plazo fijo</option>
                    <option value="FREELANCE">Freelance</option>
                    <option value="TEMPORAL">Temporal</option>
                  </select>

                  <input
                    type="number" onWheel={e => e.currentTarget.blur()}
                    placeholder="Salario bruto"
                    value={formData.salario_bruto ?? ''}
                    onChange={(e) => setFormData({ ...formData, salario_bruto: e.target.value ? parseFloat(e.target.value) : null })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                </div>

                {/* Buttons */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleGuardarEmpleado}
                    disabled={saveEmpleado.isPending}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
                  >
                    {saveEmpleado.isPending ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    onClick={resetForm}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:text-gray-300"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tabla de empleados */}
          {loadingEmpleados ? (
            <div className="text-center py-8">Cargando...</div>
          ) : filteredEmpleados.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">No hay empleados registrados</div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Nombre</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">DNI</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Teléfono</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Puesto</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Departamento</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Ingreso</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Estado</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredEmpleados.map((emp) => (
                    <tr key={emp.id} className={!emp.activo ? 'bg-gray-50 dark:bg-gray-700 opacity-60' : ''}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{nombreEmpleado(emp)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{emp.dni_rut}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{emp.tel_personal || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{emp.puesto?.nombre || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{emp.departamento?.nombre || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{format(new Date(emp.fecha_ingreso), 'dd/MM/yyyy', { locale: es })}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${emp.activo ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                          {emp.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm flex gap-2">
                        <button
                          onClick={() => handleEditEmpleado(emp)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:text-blue-400"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => toggleEmpleadoActivo.mutate(emp.id)}
                          className={`${emp.activo ? 'text-red-600 dark:text-red-400 hover:text-red-800 dark:text-red-400' : 'text-green-600 dark:text-green-400 hover:text-green-800 dark:text-green-400'}`}
                        >
                          {emp.activo ? <Trash2 size={16} /> : '✓'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PUESTOS TAB */}
      {activeTab === 'puestos' && (
        <div>
          <div className="mb-6">
            <button
              onClick={() => {
                setEditingPuesto(null)
                setPuestoForm({ nombre: '', activo: true })
                setShowPuestoForm(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={18} />
              Nuevo Puesto
            </button>
          </div>

          {/* Form inline */}
          {(showPuestoForm || editingPuesto !== null) && (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 mb-6">
              <h3 className="text-lg font-semibold mb-4">{editingPuesto ? 'Editar Puesto' : 'Crear Puesto'}</h3>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Nombre del puesto"
                  value={puestoForm.nombre ?? ''}
                  onChange={(e) => setPuestoForm({ ...puestoForm, nombre: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
                <input
                  type="number" onWheel={e => e.currentTarget.blur()}
                  placeholder="Salario sugerido"
                  value={puestoForm.salario_base_sugerido ?? ''}
                  onChange={(e) =>
                    setPuestoForm({ ...puestoForm, salario_base_sugerido: e.target.value ? parseFloat(e.target.value) : null })
                  }
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Descripción"
                  value={puestoForm.descripcion ?? ''}
                  onChange={(e) => setPuestoForm({ ...puestoForm, descripcion: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg col-span-2"
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={puestoForm.activo ?? true}
                    onChange={(e) => setPuestoForm({ ...puestoForm, activo: e.target.checked })}
                  />
                  Activo
                </label>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => savePuesto.mutate(puestoForm)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Guardar
                </button>
                <button
                  onClick={() => {
                    setEditingPuesto(null)
                    setPuestoForm({ nombre: '', activo: true })
                    setShowPuestoForm(false)
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de puestos */}
          <div className="grid gap-4">
            {puestos.map((p) => (
              <div key={p.id} className={`p-4 border rounded-lg ${!p.activo ? 'bg-gray-50 dark:bg-gray-700' : 'bg-white dark:bg-gray-800'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">{p.nombre}</h4>
                    {p.descripcion && <p className="text-sm text-gray-600 dark:text-gray-400">{p.descripcion}</p>}
                    {p.salario_base_sugerido && <p className="text-sm text-gray-500 dark:text-gray-400">Salario sugerido: ${p.salario_base_sugerido}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingPuesto(p)
                        setPuestoForm(p)
                        setShowPuestoForm(true)
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:text-blue-400"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('¿Estás seguro?')) deletePuesto.mutate(p.id)
                      }}
                      className="text-red-600 dark:text-red-400 hover:text-red-800 dark:text-red-400"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DEPARTAMENTOS TAB */}
      {activeTab === 'departamentos' && (
        <div>
          <div className="mb-6">
            <button
              onClick={() => {
                setEditingDepartamento(null)
                setDeptForm({ nombre: '', activo: true })
                setShowDeptForm(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={18} />
              Nuevo Departamento
            </button>
          </div>

          {/* Form inline */}
          {(showDeptForm || editingDepartamento !== null) && (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 mb-6">
              <h3 className="text-lg font-semibold mb-4">{editingDepartamento ? 'Editar Departamento' : 'Crear Departamento'}</h3>
              <div className="grid grid-cols-1 gap-4">
                <input
                  type="text"
                  placeholder="Nombre del departamento"
                  value={deptForm.nombre ?? ''}
                  onChange={(e) => setDeptForm({ ...deptForm, nombre: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Descripción"
                  value={deptForm.descripcion ?? ''}
                  onChange={(e) => setDeptForm({ ...deptForm, descripcion: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={deptForm.activo ?? true}
                    onChange={(e) => setDeptForm({ ...deptForm, activo: e.target.checked })}
                  />
                  Activo
                </label>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => saveDepartamento.mutate(deptForm)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Guardar
                </button>
                <button
                  onClick={() => {
                    setEditingDepartamento(null)
                    setDeptForm({ nombre: '', activo: true })
                    setShowDeptForm(false)
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de departamentos */}
          <div className="grid gap-4">
            {departamentos.map((d) => (
              <div key={d.id} className={`p-4 border rounded-lg ${!d.activo ? 'bg-gray-50 dark:bg-gray-700' : 'bg-white dark:bg-gray-800'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">{d.nombre}</h4>
                    {d.descripcion && <p className="text-sm text-gray-600 dark:text-gray-400">{d.descripcion}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingDepartamento(d)
                        setDeptForm(d)
                        setShowDeptForm(true)
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:text-blue-400"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('¿Estás seguro?')) deleteDepartamento.mutate(d.id)
                      }}
                      className="text-red-600 dark:text-red-400 hover:text-red-800 dark:text-red-400"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NÓMINA TAB */}
      {activeTab === 'nomina' && (
        <div className="space-y-6">

          {/* Selector de período */}
          <div className="flex flex-wrap items-center gap-3">
            <select value={nominaMes} onChange={(e) => setNominaMes(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
              {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m, i) => (
                <option key={m} value={m}>
                  {new Date(2000, i).toLocaleString('es', { month: 'long' }).charAt(0).toUpperCase() +
                   new Date(2000, i).toLocaleString('es', { month: 'long' }).slice(1)}
                </option>
              ))}
            </select>
            <input type="number" onWheel={e => e.currentTarget.blur()} value={nominaAnio} onChange={(e) => setNominaAnio(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm w-24" />
            <button
              onClick={() => generarNominaMes.mutate()}
              disabled={generarNominaMes.isPending || empleados.filter(e => e.activo).length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <Plus size={16} /> Generar nómina del mes
            </button>

            {/* Selector caja + método de pago */}
            {cajaSesiones.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <CreditCard size={16} className="text-gray-500 dark:text-gray-400" />
                <select value={cajaSessionId} onChange={(e) => setCajaSessionId(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800">
                  <option value="">Seleccionar caja...</option>
                  {cajaSesiones.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.cajas?.nombre ?? 'Caja'}</option>
                  ))}
                </select>
                <select value={medioPagoNomina} onChange={(e) => setMedioPagoNomina(e.target.value as typeof medioPagoNomina)}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800">
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia_banco">Transferencia bancaria</option>
                  <option value="mp">Mercado Pago</option>
                </select>
              </div>
            )}
            {cajaSesiones.length === 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle size={14}/> Sin caja abierta — no se podrá pagar
              </span>
            )}
          </div>

          {/* Resumen del período */}
          {salarios.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Total haberes', val: salarios.reduce((a, s) => a + s.total_haberes, 0), color: 'text-green-600 dark:text-green-400' },
                { label: 'Total descuentos', val: salarios.reduce((a, s) => a + s.total_descuentos, 0), color: 'text-red-600 dark:text-red-400' },
                { label: 'Total neto', val: salarios.reduce((a, s) => a + s.neto, 0), color: 'text-blue-600 dark:text-blue-400' },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                  <p className={`text-xl font-bold ${color}`}>${val.toLocaleString('es-AR')}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tabla de liquidaciones */}
          {loadingSalarios ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">Cargando...</div>
          ) : salarios.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <DollarSign size={40} className="mx-auto mb-3 opacity-40" />
              <p>No hay liquidaciones para este período.</p>
              <p className="text-sm mt-1">Hacé clic en "Generar nómina del mes" para crear una por cada empleado activo.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {salarios.map((sal) => {
                const isExpanded = expandedSalario === sal.id
                return (
                  <div key={sal.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    {/* Fila resumen */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button onClick={() => setExpandedSalario(isExpanded ? null : sal.id)}
                        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                        {isExpanded ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{nombreEmpleado(sal.empleado) || sal.empleado_id}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{sal.empleado?.puesto?.nombre ?? ''}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Haberes</p>
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">${sal.total_haberes.toLocaleString('es-AR')}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Descuentos</p>
                        <p className="text-sm font-medium text-red-600 dark:text-red-400">${sal.total_descuentos.toLocaleString('es-AR')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Neto</p>
                        <p className="text-base font-bold text-gray-900 dark:text-white">${sal.neto.toLocaleString('es-AR')}</p>
                      </div>
                      <div className="ml-2 flex flex-col items-end gap-1">
                        {sal.pagado ? (
                          <>
                            <span className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-xs font-medium">
                              <CheckCircle size={12}/> Pagado
                            </span>
                            {sal.medio_pago && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">
                                {sal.medio_pago === 'efectivo' ? 'Efectivo' : sal.medio_pago === 'transferencia_banco' ? 'Transferencia' : 'Mercado Pago'}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full text-xs font-medium">
                            <Clock size={12}/> Pendiente
                          </span>
                        )}
                      </div>
                      {!sal.pagado && (
                        <button
                          onClick={() => { if (!cajaSessionId) { toast.error('Seleccioná una sesión de caja'); return; } pagarNomina.mutate(sal.id) }}
                          disabled={pagarNomina.isPending || !cajaSesiones.length}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          <DollarSign size={13}/> Pagar
                        </button>
                      )}
                    </div>

                    {/* Items expandidos */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 px-4 py-4">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Conceptos</p>

                        {/* Lista items */}
                        <div className="space-y-1.5 mb-4">
                          {salarioItems.filter(i => i.salario_id === sal.id).map((item) => (
                            <div key={item.id} className="flex items-center gap-2 text-sm">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.tipo === 'HABER' ? 'bg-green-400' : 'bg-red-400'}`}/>
                              <span className="flex-1 text-gray-700 dark:text-gray-300">{item.descripcion}</span>
                              <span className={`font-medium ${item.tipo === 'HABER' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {item.tipo === 'DESCUENTO' ? '-' : '+'}${item.monto.toLocaleString('es-AR')}
                              </span>
                              {!sal.pagado && (
                                <button onClick={() => removeItem.mutate(item.id)}
                                  className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400">
                                  <Trash2 size={13}/>
                                </button>
                              )}
                            </div>
                          ))}
                          {salarioItems.filter(i => i.salario_id === sal.id).length === 0 && (
                            <p className="text-sm text-gray-400 dark:text-gray-500 italic">Sin conceptos. Agregá sueldo básico u otros conceptos.</p>
                          )}
                        </div>

                        {/* Agregar item (solo si no pagado) */}
                        {!sal.pagado && (
                          <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200 dark:border-gray-600">
                            <select value={newItem.concepto_id}
                              onChange={(e) => {
                                const c = conceptos.find(c => c.id === e.target.value)
                                setNewItem({ ...newItem, concepto_id: e.target.value, descripcion: c?.nombre ?? newItem.descripcion, tipo: c?.tipo ?? newItem.tipo })
                              }}
                              className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-32">
                              <option value="">Concepto libre...</option>
                              {conceptos.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.tipo})</option>)}
                            </select>
                            <input type="text" placeholder="Descripción" value={newItem.descripcion}
                              onChange={(e) => setNewItem({ ...newItem, descripcion: e.target.value })}
                              className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-32" />
                            <select value={newItem.tipo} onChange={(e) => setNewItem({ ...newItem, tipo: e.target.value as 'HABER' | 'DESCUENTO' })}
                              className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm">
                              <option value="HABER">Haber</option>
                              <option value="DESCUENTO">Descuento</option>
                            </select>
                            <input type="number" onWheel={e => e.currentTarget.blur()} placeholder="Monto" value={newItem.monto}
                              onChange={(e) => setNewItem({ ...newItem, monto: e.target.value })}
                              className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm w-28" />
                            <button
                              onClick={() => addSalarioItem.mutate({ salarioId: sal.id, item: newItem })}
                              disabled={addSalarioItem.isPending}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                              Agregar
                            </button>
                          </div>
                        )}

                        {sal.pagado && sal.fecha_pago && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
                            Pagado el {format(new Date(sal.fecha_pago), "dd/MM/yyyy HH:mm", { locale: es })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Empleados sin liquidación */}
          {(() => {
            const conLiq = new Set(salarios.map(s => s.empleado_id))
            const sinLiq = empleados.filter(e => e.activo && !conLiq.has(e.id))
            if (sinLiq.length === 0) return null
            return (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Sin liquidación este mes ({sinLiq.length})</p>
                <div className="flex flex-wrap gap-2">
                  {sinLiq.map(emp => (
                    <button key={emp.id}
                      onClick={() => crearLiquidacion.mutate(emp)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <Plus size={13}/> {nombreEmpleado(emp)}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Catálogo de conceptos */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setShowConceptoForm(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <span className="flex items-center gap-2"><Briefcase size={15}/> Catálogo de conceptos</span>
              <ChevronDown size={16} className={showConceptoForm ? 'rotate-180' : ''} />
            </button>
            {showConceptoForm && (
              <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-4">
                {/* Form */}
                <div className="flex gap-2">
                  <input type="text" placeholder="Nombre del concepto"
                    value={conceptoForm.nombre} onChange={(e) => setConceptoForm({ ...conceptoForm, nombre: e.target.value })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm flex-1" />
                  <select value={conceptoForm.tipo} onChange={(e) => setConceptoForm({ ...conceptoForm, tipo: e.target.value as 'HABER' | 'DESCUENTO' })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                    <option value="HABER">Haber</option>
                    <option value="DESCUENTO">Descuento</option>
                  </select>
                  <button onClick={() => saveConcepto.mutate(conceptoForm)} disabled={saveConcepto.isPending || !conceptoForm.nombre.trim()}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                    {editingConcepto ? 'Actualizar' : 'Agregar'}
                  </button>
                  {editingConcepto && (
                    <button onClick={() => { setEditingConcepto(null); setConceptoForm({ nombre: '', tipo: 'HABER' }) }}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      Cancelar
                    </button>
                  )}
                </div>
                {/* Lista */}
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {conceptos.map(c => (
                    <div key={c.id} className="flex items-center gap-3 py-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.tipo === 'HABER' ? 'bg-green-400' : 'bg-red-400'}`}/>
                      <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{c.nombre}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.tipo === 'HABER' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                        {c.tipo}
                      </span>
                      <button onClick={() => { setEditingConcepto(c); setConceptoForm({ nombre: c.nombre, tipo: c.tipo }) }}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"><Edit size={14}/></button>
                      <button onClick={() => { if (confirm('¿Eliminar concepto?')) deleteConcepto.mutate(c.id) }}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
                  ))}
                  {conceptos.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 py-2 italic">Sin conceptos. Agregá haberes o descuentos frecuentes.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Historial de sueldos por empleado */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setShowHistorialSueldos(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <span className="flex items-center gap-2"><TrendingUp size={15}/> Historial de sueldos por empleado</span>
              <ChevronDown size={14} className={`transition-transform ${showHistorialSueldos ? 'rotate-180' : ''}`} />
            </button>
            {showHistorialSueldos && (
              <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                <select value={historialEmpleadoId} onChange={e => setHistorialEmpleadoId(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 w-full max-w-xs">
                  <option value="">Seleccioná un empleado...</option>
                  {empleados.filter(e => e.activo).map(e => (
                    <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>
                  ))}
                </select>

                {historialEmpleadoId && historialSueldos.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">Sin liquidaciones registradas para este empleado.</p>
                )}

                {historialSueldos.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">
                          <th className="text-left pb-2 pr-4">Período</th>
                          <th className="text-right pb-2 pr-4">Básico</th>
                          <th className="text-right pb-2 pr-4">Haberes</th>
                          <th className="text-right pb-2 pr-4">Descuentos</th>
                          <th className="text-right pb-2 pr-4 font-bold">Neto</th>
                          <th className="text-center pb-2 pr-4">Estado</th>
                          <th className="text-left pb-2">Medio de pago</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {historialSueldos.map((s: any) => (
                          <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="py-2 pr-4 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                              {new Date(s.periodo + 'T12:00:00').toLocaleString('es-AR', { month: 'long', year: 'numeric' })}
                            </td>
                            <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-400">${s.basico.toLocaleString('es-AR')}</td>
                            <td className="py-2 pr-4 text-right text-green-600 dark:text-green-400">${s.total_haberes.toLocaleString('es-AR')}</td>
                            <td className="py-2 pr-4 text-right text-red-600 dark:text-red-400">${s.total_descuentos.toLocaleString('es-AR')}</td>
                            <td className="py-2 pr-4 text-right font-bold text-gray-900 dark:text-white">${s.neto.toLocaleString('es-AR')}</td>
                            <td className="py-2 pr-4 text-center">
                              {s.pagado
                                ? <span className="text-xs text-green-600 dark:text-green-400 font-medium">Pagado</span>
                                : <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Pendiente</span>
                              }
                            </td>
                            <td className="py-2 text-xs text-gray-500 dark:text-gray-400">
                              {s.medio_pago === 'efectivo' ? 'Efectivo' : s.medio_pago === 'transferencia_banco' ? 'Transferencia' : s.medio_pago === 'mp' ? 'Mercado Pago' : '—'}
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

        </div>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === 'dashboard' && (() => {
        const activos = empleados.filter(e => e.activo)
        const hoy = new Date()
        const nuevosEsteMes = activos.filter(e => {
          const fi = new Date(e.fecha_ingreso)
          return fi.getMonth() === hoy.getMonth() && fi.getFullYear() === hoy.getFullYear()
        })

        // Asistencia del mes seleccionado
        const totalAsist = dashAsist.length
        const presentes  = dashAsist.filter(a => a.estado === 'presente').length
        const tardanzas  = dashAsist.filter(a => a.estado === 'tardanza').length
        const ausentes   = dashAsist.filter(a => a.estado === 'ausente').length
        const licencias  = dashAsist.filter(a => a.estado === 'licencia').length
        const pctPresencia = totalAsist > 0 ? Math.round(((presentes + tardanzas) / totalAsist) * 100) : null

        // Vacaciones año actual
        const vacPendientes = dashVac.filter(v => v.estado === 'pendiente').length
        const vacAprobadas  = dashVac.filter(v => v.estado === 'aprobada').length
        const diasVacUsados = dashVac.filter(v => v.estado === 'aprobada').reduce((s, v) => s + (v.dias_habiles ?? 0), 0)

        // Nómina
        const periodos = [...new Set(dashNomina.map(s => s.periodo?.slice(0, 7)))].sort().reverse()
        const ultimoPeriodo = periodos[0]
        const nominaUltimo  = dashNomina.filter(s => s.periodo?.slice(0, 7) === ultimoPeriodo)
        const nominaPendiente = nominaUltimo.filter(s => !s.pagado).length
        const nominaNetoPendiente = nominaUltimo.filter(s => !s.pagado).reduce((sum, s) => sum + (s.neto ?? 0), 0)

        // Breakdown por departamento
        const deptMap: Record<string, number> = {}
        activos.forEach(e => {
          const nombre = e.departamento?.nombre ?? 'Sin departamento'
          deptMap[nombre] = (deptMap[nombre] ?? 0) + 1
        })

        return (
          <div className="space-y-6">
            {/* Selector mes */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mes de referencia (asistencia):</label>
              <input type="month" value={dashMes} onChange={e => setDashMes(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm" />
            </div>

            {/* KPIs Empleados */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Empleados</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
                    <Users2 size={18}/><span className="text-xs font-medium uppercase">Activos</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{activos.length}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-1">
                    <UserCheck size={18}/><span className="text-xs font-medium uppercase">Nuevos este mes</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{nuevosEsteMes.length}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 text-red-500 dark:text-red-400 mb-1">
                    <Heart size={18}/><span className="text-xs font-medium uppercase">Cumpleaños este mes</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{cumpleanosMes.length}</p>
                  {cumpleanosMes.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                      {cumpleanosMes.map(e => nombreEmpleado(e)).join(', ')}
                    </p>
                  )}
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-1">
                    <Building2 size={18}/><span className="text-xs font-medium uppercase">Departamentos</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{departamentos.filter(d => d.activo).length}</p>
                </div>
              </div>
            </div>

            {/* KPIs Asistencia */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Asistencia — {dashMes}
              </h3>
              {totalAsist === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">Sin registros para este mes</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 md:col-span-1">
                    <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
                      <TrendingUp size={18}/><span className="text-xs font-medium uppercase">Presencia</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">
                      {pctPresencia !== null ? `${pctPresencia}%` : '—'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{totalAsist} registros</p>
                  </div>
                  {([
                    { label: 'Presentes', count: presentes, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
                    { label: 'Tardanzas', count: tardanzas, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
                    { label: 'Ausentes',  count: ausentes,  color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-50 dark:bg-red-900/20' },
                    { label: 'Licencias', count: licencias, color: 'text-blue-600 dark:text-blue-400',  bg: 'bg-blue-50 dark:bg-blue-900/20' },
                  ] as const).map(item => (
                    <div key={item.label} className={`rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${item.bg}`}>
                      <p className={`text-xs font-medium uppercase mb-1 ${item.color}`}>{item.label}</p>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">{item.count}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* KPIs Vacaciones */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Vacaciones — {new Date().getFullYear()}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <p className="text-xs font-medium uppercase text-yellow-600 dark:text-yellow-400 mb-1">Pendientes aprobación</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{vacPendientes}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <p className="text-xs font-medium uppercase text-green-600 dark:text-green-400 mb-1">Aprobadas</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{vacAprobadas}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <p className="text-xs font-medium uppercase text-blue-600 dark:text-blue-400 mb-1">Días hábiles usados</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{diasVacUsados}</p>
                </div>
              </div>
            </div>

            {/* KPIs Nómina */}
            {ultimoPeriodo && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                  Nómina — último período ({ultimoPeriodo})
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">Liquidaciones</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{nominaUltimo.length}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{nominaUltimo.filter(s => s.pagado).length} pagadas</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-xs font-medium uppercase text-orange-600 dark:text-orange-400 mb-1">Pendientes de pago</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{nominaPendiente}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-xs font-medium uppercase text-orange-600 dark:text-orange-400 mb-1">Monto pendiente</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {nominaNetoPendiente.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Breakdown por departamento */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Empleados por departamento</h3>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {Object.entries(deptMap).sort((a, b) => b[1] - a[1]).map(([nombre, count]) => (
                    <div key={nombre} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{nombre}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-blue-500 dark:bg-blue-400" style={{ width: `${Math.max(20, (count / activos.length) * 120)}px` }}/>
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                  {activos.length === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500 italic">Sin empleados activos</p>
                  )}
                </div>
              </div>
            </div>

            {/* Próximos feriados */}
            {feriados.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Próximos feriados (60 días)</h3>
                <div className="flex flex-wrap gap-2">
                  {feriados.slice(0, 6).map(f => {
                    const dias = differenceInDays(new Date(f.fecha + 'T00:00:00'), new Date(new Date().toDateString()))
                    return (
                      <div key={f.id} className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
                        <span className="font-medium text-blue-800 dark:text-blue-300">{f.nombre}</span>
                        <span className="text-blue-500 dark:text-blue-400 text-xs">{dias === 0 ? '¡Hoy!' : `en ${dias}d`}</span>
                      </div>
                    )
                  })}
                  {feriados.length > 6 && (
                    <button onClick={() => setActiveTab('cumpleanos')} className="px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                      +{feriados.length - 6} más →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Exportar reportes */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Exportar reportes</h3>
              <div className="flex flex-wrap gap-3">
                <button onClick={exportAsistenciaMes}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <FileSpreadsheet size={16} className="text-green-600 dark:text-green-400"/>
                  Asistencia {dashMes}
                  <Download size={14} className="text-gray-400"/>
                </button>
                <button onClick={exportNominaHistorica}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <FileSpreadsheet size={16} className="text-green-600 dark:text-green-400"/>
                  Nómina histórica
                  <Download size={14} className="text-gray-400"/>
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* VACACIONES TAB */}
      {activeTab === 'vacaciones' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Año:</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} value={vacAnio} onChange={(e) => setVacAnio(parseInt(e.target.value))}
                className="w-24 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <button onClick={() => setShowVacForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
              <Plus size={16}/> Nueva solicitud
            </button>
          </div>

          {/* Modal nueva solicitud */}
          {showVacForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Nueva solicitud de vacaciones</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Empleado *</label>
                    <select value={vacForm.empleado_id} onChange={(e) => setVacForm({ ...vacForm, empleado_id: e.target.value })}
                      className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2">
                      <option value="">Seleccioná...</option>
                      {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Desde *</label>
                      <input type="date" value={vacForm.desde} onChange={(e) => setVacForm({ ...vacForm, desde: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Hasta *</label>
                      <input type="date" value={vacForm.hasta} onChange={(e) => setVacForm({ ...vacForm, hasta: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                    </div>
                  </div>
                  {vacForm.desde && vacForm.hasta && vacForm.desde <= vacForm.hasta && (
                    <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                      {calcularDiasHabilesFrontend(vacForm.desde, vacForm.hasta)} días hábiles
                    </p>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Notas</label>
                    <textarea value={vacForm.notas} onChange={(e) => setVacForm({ ...vacForm, notas: e.target.value })}
                      rows={2} className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm resize-none" />
                  </div>
                </div>
                <div className="flex gap-2 mt-4 justify-end">
                  <button onClick={() => { setShowVacForm(false); setVacForm({ empleado_id: '', desde: '', hasta: '', notas: '' }) }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                    Cancelar
                  </button>
                  <button onClick={() => crearSolicitudVac.mutate(vacForm)} disabled={crearSolicitudVac.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                    Crear solicitud
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Lista solicitudes */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-medium text-gray-900 dark:text-white">Solicitudes {vacAnio}</h3>
            </div>
            {vacSolicitudes.length === 0 ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">Sin solicitudes este año</div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {vacSolicitudes.map(sol => {
                  const estadoBadge = {
                    pendiente: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
                    aprobada:  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                    rechazada: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
                  }[sol.estado]
                  return (
                    <div key={sol.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 dark:text-white">{nombreEmpleado(sol.empleado)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {format(new Date(sol.desde + 'T00:00:00'), 'dd/MM/yyyy')} → {format(new Date(sol.hasta + 'T00:00:00'), 'dd/MM/yyyy')} · {sol.dias_habiles} días hábiles
                        </p>
                        {sol.notas && <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-0.5">{sol.notas}</p>}
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${estadoBadge}`}>{sol.estado}</span>
                      {sol.estado === 'pendiente' && (
                        <div className="flex gap-1">
                          <button onClick={() => aprobarVacacion.mutate(sol.id)} title="Aprobar"
                            className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                            <Check size={15}/>
                          </button>
                          <button onClick={() => rechazarVacacion.mutate(sol.id)} title="Rechazar"
                            className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                            <X size={15}/>
                          </button>
                        </div>
                      )}
                      {sol.estado === 'pendiente' && (
                        <button onClick={() => { if (confirm('¿Eliminar solicitud?')) deleteSolicitudVac.mutate(sol.id) }}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 rounded">
                          <Trash2 size={14}/>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Saldos */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setShowSaldosVac(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <span>Saldos de vacaciones {vacAnio}</span>
              <ChevronDown size={16} className={showSaldosVac ? 'rotate-180' : ''}/>
            </button>
            {showSaldosVac && (
              <div className="border-t border-gray-200 dark:border-gray-700">
                {editingSaldo && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6">
                      <h3 className="font-bold text-gray-900 dark:text-white mb-4">
                        Saldo {vacAnio} — {nombreEmpleado(editingSaldo.empleado ?? empleados.find(e => e.id === editingSaldo.empleado_id))}
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Días totales asignados</label>
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={saldoForm.dias_totales}
                            onChange={(e) => setSaldoForm({ ...saldoForm, dias_totales: e.target.value })}
                            className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Remanente del año anterior</label>
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={saldoForm.remanente_anterior}
                            onChange={(e) => setSaldoForm({ ...saldoForm, remanente_anterior: e.target.value })}
                            className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4 justify-end">
                        <button onClick={() => setEditingSaldo(null)}
                          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                          Cancelar
                        </button>
                        <button onClick={() => saveSaldoVac.mutate({ empleadoId: editingSaldo.empleado_id, data: saldoForm })}
                          disabled={saveSaldoVac.isPending}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                          Guardar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs">
                        <th className="text-left px-4 py-2">Empleado</th>
                        <th className="text-center px-3 py-2">Asignados</th>
                        <th className="text-center px-3 py-2">Remanente ant.</th>
                        <th className="text-center px-3 py-2">Usados</th>
                        <th className="text-center px-3 py-2">Disponible</th>
                        <th className="px-3 py-2"/>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {empleados.filter(e => e.activo).map(emp => {
                        const saldo = vacSaldos.find(s => s.empleado_id === emp.id)
                        const totales = saldo?.dias_totales ?? 0
                        const remanente = saldo?.remanente_anterior ?? 0
                        const usados = saldo?.dias_usados ?? 0
                        const disponible = totales + remanente - usados
                        return (
                          <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-4 py-2 text-gray-900 dark:text-white font-medium">{nombreEmpleado(emp)}</td>
                            <td className="px-3 py-2 text-center text-gray-700 dark:text-gray-300">{totales}</td>
                            <td className="px-3 py-2 text-center text-gray-700 dark:text-gray-300">{remanente}</td>
                            <td className="px-3 py-2 text-center text-gray-700 dark:text-gray-300">{usados}</td>
                            <td className={`px-3 py-2 text-center font-semibold ${disponible < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                              {disponible}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => {
                                const s = saldo ?? { empleado_id: emp.id, anio: vacAnio, dias_totales: 0, remanente_anterior: 0, dias_usados: 0 } as VacacionSaldo
                                setEditingSaldo(s)
                                setSaldoForm({ dias_totales: String(s.dias_totales), remanente_anterior: String(s.remanente_anterior) })
                              }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
                                <Edit size={14}/>
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
        </div>
      )}

      {/* ASISTENCIA TAB */}
      {activeTab === 'asistencia' && (
        <div className="space-y-6">

          {/* Check-in rápido */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <Clock size={15} className="text-accent" /> Check-in rápido — {format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <select value={checkinEmpleadoId} onChange={e => setCheckinEmpleadoId(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white flex-1 min-w-[180px]">
                <option value="">Seleccioná empleado...</option>
                {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>)}
              </select>
              <button
                disabled={!checkinEmpleadoId || checkinRapido.isPending}
                onClick={() => checkinRapido.mutate({ tipo: 'entrada' })}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 text-sm font-medium"
                title="Registrar entrada con hora actual">
                <UserCheck size={16}/> Entrada {format(new Date(), 'HH:mm')}
              </button>
              <button
                disabled={!checkinEmpleadoId || checkinRapido.isPending}
                onClick={() => checkinRapido.mutate({ tipo: 'salida' })}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-40 text-sm font-medium"
                title="Registrar salida con hora actual">
                <UserX size={16}/> Salida {format(new Date(), 'HH:mm')}
              </button>
            </div>
            {checkinEmpleadoId && asistenciaHoy && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Hoy: <span className="font-medium text-gray-700 dark:text-gray-300">
                  {asistenciaHoy.hora_entrada ? `Entrada ${asistenciaHoy.hora_entrada}` : 'Sin entrada'}
                  {asistenciaHoy.hora_salida ? ` · Salida ${asistenciaHoy.hora_salida}` : ''}
                </span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mes:</label>
              <input type="month" value={asistFecha} onChange={(e) => setAsistFecha(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm" />
              <select value={asistFiltroEmpleado} onChange={(e) => setAsistFiltroEmpleado(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm">
                <option value="">Todos los empleados</option>
                {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>)}
              </select>
            </div>
            <button onClick={() => {
              setEditingAsistencia(null)
              setAsistForm({ empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), hora_entrada: '', hora_salida: '', estado: 'presente', motivo: '' })
              setShowAsistForm(true)
            }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
              <Plus size={16}/> Registrar asistencia
            </button>
          </div>

          {/* Modal crear/editar */}
          {showAsistForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  {editingAsistencia ? 'Editar asistencia' : 'Registrar asistencia'}
                </h2>
                <div className="space-y-3">
                  {!editingAsistencia && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Empleado *</label>
                      <select value={asistForm.empleado_id} onChange={(e) => setAsistForm({ ...asistForm, empleado_id: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2">
                        <option value="">Seleccioná...</option>
                        {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Fecha *</label>
                      <input type="date" value={asistForm.fecha} onChange={(e) => setAsistForm({ ...asistForm, fecha: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2"
                        disabled={!!editingAsistencia} />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Estado</label>
                      <select value={asistForm.estado} onChange={(e) => setAsistForm({ ...asistForm, estado: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2">
                        <option value="presente">Presente</option>
                        <option value="ausente">Ausente</option>
                        <option value="tardanza">Tardanza</option>
                        <option value="licencia">Licencia</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Hora entrada</label>
                      <input type="time" value={asistForm.hora_entrada} onChange={(e) => setAsistForm({ ...asistForm, hora_entrada: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Hora salida</label>
                      <input type="time" value={asistForm.hora_salida} onChange={(e) => setAsistForm({ ...asistForm, hora_salida: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Motivo</label>
                    <input type="text" value={asistForm.motivo} onChange={(e) => setAsistForm({ ...asistForm, motivo: e.target.value })}
                      placeholder="Ej: día libre, enfermedad..."
                      className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 mt-4 justify-end">
                  <button onClick={() => { setShowAsistForm(false); setEditingAsistencia(null) }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                    Cancelar
                  </button>
                  <button onClick={() => saveAsistencia.mutate(asistForm)} disabled={saveAsistencia.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                    {editingAsistencia ? 'Actualizar' : 'Registrar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tabla */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {(() => {
              const filtered = asistFiltroEmpleado
                ? asistencias.filter(a => a.empleado_id === asistFiltroEmpleado)
                : asistencias
              if (filtered.length === 0) return (
                <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">Sin registros para el período seleccionado</div>
              )
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs">
                        <th className="text-left px-4 py-2">Fecha</th>
                        <th className="text-left px-4 py-2">Empleado</th>
                        <th className="text-center px-3 py-2">Estado</th>
                        <th className="text-center px-3 py-2">Entrada</th>
                        <th className="text-center px-3 py-2">Salida</th>
                        <th className="text-left px-3 py-2">Motivo</th>
                        <th className="px-3 py-2"/>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filtered.map(a => {
                        const estadoColor = {
                          presente:  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                          ausente:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
                          tardanza:  'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
                          licencia:  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
                        }[a.estado]
                        return (
                          <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                              {format(new Date(a.fecha + 'T00:00:00'), 'dd/MM/yyyy')}
                            </td>
                            <td className="px-4 py-2 text-gray-900 dark:text-white font-medium">{nombreEmpleado(a.empleado)}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${estadoColor}`}>{a.estado}</span>
                            </td>
                            <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{a.hora_entrada ?? '—'}</td>
                            <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{a.hora_salida ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{a.motivo ?? ''}</td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <button onClick={() => {
                                  setEditingAsistencia(a)
                                  setAsistForm({ empleado_id: a.empleado_id, fecha: a.fecha, hora_entrada: a.hora_entrada ?? '', hora_salida: a.hora_salida ?? '', estado: a.estado, motivo: a.motivo ?? '' })
                                  setShowAsistForm(true)
                                }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
                                  <Edit size={14}/>
                                </button>
                                <button onClick={() => { if (confirm('¿Eliminar registro?')) deleteAsistencia.mutate(a.id) }}
                                  className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300">
                                  <Trash2 size={14}/>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* CUMPLEANOS TAB */}
      {activeTab === 'cumpleanos' && (
        <div className="space-y-8">
          {/* Cumpleaños próximos 30 días */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Heart size={18} className="text-red-400" /> Cumpleaños — próximos 30 días
            </h2>
            <div className="grid gap-4">
              {cumpleanosMes.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">Sin cumpleaños en los próximos 30 días</div>
              ) : (
                cumpleanosMes.map((emp) => {
                  const { days: daysToNext } = proximoCumpleanos(emp.fecha_nacimiento!)
                  const birth = new Date(emp.fecha_nacimiento!)
                  const age = new Date().getFullYear() - birth.getFullYear()
                  let badgeColor = 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  if (daysToNext === 0) badgeColor = 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                  else if (daysToNext <= 7) badgeColor = 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                  return (
                    <div key={emp.id} className={`p-5 border rounded-lg bg-white dark:bg-gray-800 hover:shadow-md transition ${daysToNext === 0 ? 'border-red-300 dark:border-red-700 ring-1 ring-red-200 dark:ring-red-900' : 'border-gray-200 dark:border-gray-700'}`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <Heart className={daysToNext === 0 ? 'text-red-500 animate-pulse' : 'text-red-400'} size={20} />
                          <div>
                            <h3 className="font-semibold text-gray-900 dark:text-white">{nombreEmpleado(emp)}</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{emp.departamento?.nombre || 'Sin departamento'} · {emp.puesto?.nombre || 'Sin puesto'}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-500 dark:text-gray-400">{format(birth, 'dd MMMM', { locale: es })} · {age} años</p>
                          <span className={`inline-block mt-1 px-3 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
                            {daysToNext === 0 ? '🎂 ¡Hoy!' : `En ${daysToNext} día${daysToNext !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Feriados próximos 60 días */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Calendar size={18} className="text-blue-500" /> Feriados — próximos 60 días
              </h2>
              {esRrhhAdmin && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { if (confirm('¿Cargar los feriados nacionales de Argentina 2026? Solo se agregarán los que no existan.')) cargarFeriadosNacionales.mutate() }}
                    disabled={cargarFeriadosNacionales.isPending}
                    title="Carga automáticamente los 16 feriados nacionales de Argentina 2026"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
                    🇦🇷 AR 2026
                  </button>
                  <button onClick={() => { setEditingFeriado(null); setFeriadoForm({ nombre: '', fecha: format(new Date(), 'yyyy-MM-dd'), tipo: 'nacional' }); setShowFeriadoForm(true) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                    <Plus size={14}/> Agregar feriado
                  </button>
                </div>
              )}
            </div>

            {/* Modal feriado */}
            {showFeriadoForm && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                    {editingFeriado ? 'Editar feriado' : 'Nuevo feriado'}
                  </h2>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Nombre *</label>
                      <input type="text" value={feriadoForm.nombre} onChange={e => setFeriadoForm({ ...feriadoForm, nombre: e.target.value })}
                        placeholder="Ej: Día del trabajador"
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Fecha *</label>
                        <input type="date" value={feriadoForm.fecha} onChange={e => setFeriadoForm({ ...feriadoForm, fecha: e.target.value })}
                          className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white text-sm" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                        <select value={feriadoForm.tipo} onChange={e => setFeriadoForm({ ...feriadoForm, tipo: e.target.value })}
                          className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white text-sm">
                          <option value="nacional">Nacional</option>
                          <option value="provincial">Provincial</option>
                          <option value="personalizado">Personalizado</option>
                          <option value="no_laborable">No laborable</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4 justify-end">
                    <button onClick={() => { setShowFeriadoForm(false); setEditingFeriado(null) }}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                      Cancelar
                    </button>
                    <button onClick={() => saveFeriado.mutate(feriadoForm)} disabled={saveFeriado.isPending}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {editingFeriado ? 'Actualizar' : 'Agregar'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {feriados.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                  Sin feriados cargados para los próximos 60 días
                  {esRrhhAdmin && <span className="block mt-1 text-xs">Usá "Agregar feriado" para registrar días no laborables</span>}
                </div>
              ) : (
                feriados.map((f) => {
                  const diasRestantes = differenceInDays(new Date(f.fecha + 'T00:00:00'), new Date(new Date().toDateString()))
                  const tipoBadge: Record<string, string> = {
                    nacional:      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
                    provincial:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                    personalizado: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
                    no_laborable:  'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
                  }
                  return (
                    <div key={f.id} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
                      <div className="flex items-center gap-3">
                        <Calendar size={16} className="text-blue-400 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white text-sm">{f.nombre}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {format(new Date(f.fecha + 'T00:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                            {' · '}{diasRestantes === 0 ? '¡Hoy!' : `en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tipoBadge[f.tipo] ?? tipoBadge.personalizado}`}>{f.tipo}</span>
                        {esRrhhAdmin && (
                          <>
                            <button title="Editar" onClick={() => { setEditingFeriado(f); setFeriadoForm({ nombre: f.nombre, fecha: f.fecha, tipo: f.tipo }); setShowFeriadoForm(true) }}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800"><Edit size={14}/></button>
                            <button title="Eliminar" onClick={() => { if (confirm('¿Eliminar feriado?')) deleteFeriado.mutate(f.id) }}
                              className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
      {/* DOCUMENTOS TAB */}
      {activeTab === 'documentos' && (
        <div>
          {/* Header + filtro */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <select
              value={docEmpleadoFiltro}
              onChange={(e) => setDocEmpleadoFiltro(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
            >
              <option value="">Todos los empleados</option>
              {empleados.filter(e => e.activo).map(e => (
                <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>
              ))}
            </select>
            <button
              onClick={() => setShowDocForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <Plus size={16} /> Subir documento
            </button>
          </div>

          {/* Formulario upload */}
          {showDocForm && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Subir documento</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <select
                  value={docForm.empleado_id}
                  onChange={(e) => setDocForm({ ...docForm, empleado_id: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Seleccionar empleado *</option>
                  {empleados.filter(e => e.activo).map(e => (
                    <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>
                  ))}
                </select>
                <select
                  value={docForm.tipo}
                  onChange={(e) => setDocForm({ ...docForm, tipo: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  <option value="contrato">Contrato</option>
                  <option value="certificado">Certificado</option>
                  <option value="cv">CV / Currículum</option>
                  <option value="foto">Foto</option>
                  <option value="otro">Otro</option>
                </select>
                <input
                  type="text"
                  placeholder="Nombre del documento *"
                  value={docForm.nombre}
                  onChange={(e) => setDocForm({ ...docForm, nombre: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <input
                  type="text"
                  placeholder="Descripción (opcional)"
                  value={docForm.descripcion}
                  onChange={(e) => setDocForm({ ...docForm, descripcion: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <div className="sm:col-span-2">
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                    onChange={(e) => setDocForm({ ...docForm, file: e.target.files?.[0] ?? null })}
                    className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
                  />
                  <p className="text-xs text-gray-400 mt-1">PDF, Word, Excel, JPG, PNG — máx. 10 MB</p>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={uploadDocumento}
                  disabled={docUploading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {docUploading ? 'Subiendo...' : 'Guardar'}
                </button>
                <button
                  onClick={() => { setShowDocForm(false); setDocForm({ empleado_id: '', nombre: '', descripcion: '', tipo: 'otro', file: null }) }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de documentos */}
          {documentos.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <FolderOpen size={40} className="mx-auto mb-3 opacity-40" />
              <p>No hay documentos subidos aún</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {documentos.map((doc) => (
                <div key={doc.id} className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <File size={24} className="text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{doc.nombre}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {nombreEmpleado(doc.empleado)} · <span className="capitalize">{doc.tipo}</span>
                      {doc.tamanio ? ` · ${(doc.tamanio / 1024).toFixed(0)} KB` : ''}
                    </p>
                    {doc.descripcion && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{doc.descripcion}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => getDocUrl(doc.storage_path)}
                      className="px-3 py-1.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50"
                    >
                      Ver
                    </button>
                    <button
                      onClick={() => { if (confirm('¿Eliminar este documento?')) deleteDocumento.mutate(doc) }}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CAPACITACIONES TAB */}
      {activeTab === 'capacitaciones' && (
        <div>
          <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
            <div className="flex flex-wrap gap-3">
              <select
                value={capFiltroEmpleado}
                onChange={(e) => setCapFiltroEmpleado(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              >
                <option value="">Todos los empleados</option>
                {empleados.filter((e) => e.activo).map((e) => (
                  <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>
                ))}
              </select>
              <select
                value={capFiltroEstado}
                onChange={(e) => setCapFiltroEstado(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              >
                <option value="">Todos los estados</option>
                <option value="planificada">Planificada</option>
                <option value="en_curso">En curso</option>
                <option value="completada">Completada</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
            <button
              onClick={() => { setEditingCap(null); setCapForm({ empleado_id: '', nombre: '', descripcion: '', fecha_inicio: '', fecha_fin: '', horas: '', proveedor: '', estado: 'planificada', resultado: '', certFile: null }); setShowCapForm(true) }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <Plus size={16} /> Nueva capacitación
            </button>
          </div>

          {showCapForm && (
            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 mb-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                {editingCap ? 'Editar capacitación' : 'Nueva capacitación'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <select
                    value={capForm.empleado_id}
                    onChange={(e) => setCapForm({ ...capForm, empleado_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Seleccioná empleado *</option>
                    {empleados.filter((e) => e.activo).map((e) => (
                      <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    placeholder="Nombre de la capacitación *"
                    value={capForm.nombre}
                    onChange={(e) => setCapForm({ ...capForm, nombre: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <input
                  type="date"
                  placeholder="Fecha inicio"
                  value={capForm.fecha_inicio}
                  onChange={(e) => setCapForm({ ...capForm, fecha_inicio: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <input
                  type="date"
                  placeholder="Fecha fin"
                  value={capForm.fecha_fin}
                  onChange={(e) => setCapForm({ ...capForm, fecha_fin: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <input
                  type="number" onWheel={e => e.currentTarget.blur()}
                  placeholder="Horas (ej: 8)"
                  value={capForm.horas}
                  onChange={(e) => setCapForm({ ...capForm, horas: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <input
                  type="text"
                  placeholder="Proveedor / institución"
                  value={capForm.proveedor}
                  onChange={(e) => setCapForm({ ...capForm, proveedor: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <select
                  value={capForm.estado}
                  onChange={(e) => setCapForm({ ...capForm, estado: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  <option value="planificada">Planificada</option>
                  <option value="en_curso">En curso</option>
                  <option value="completada">Completada</option>
                  <option value="cancelada">Cancelada</option>
                </select>
                <input
                  type="text"
                  placeholder="Resultado / calificación"
                  value={capForm.resultado}
                  onChange={(e) => setCapForm({ ...capForm, resultado: e.target.value })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <div className="sm:col-span-2">
                  <textarea
                    placeholder="Descripción (opcional)"
                    value={capForm.descripcion}
                    onChange={(e) => setCapForm({ ...capForm, descripcion: e.target.value })}
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white resize-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                    <Award size={14} /> Certificado (PDF/imagen)
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setCapForm({ ...capForm, certFile: e.target.files?.[0] ?? null })}
                    className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
                  />
                  {editingCap?.certificado_path && !capForm.certFile && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ Certificado ya cargado</p>
                  )}
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={saveCapacitacion}
                  disabled={capUploading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {capUploading ? 'Guardando...' : 'Guardar'}
                </button>
                <button
                  onClick={() => { setShowCapForm(false); setEditingCap(null) }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {capacitaciones.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
              <p>No hay capacitaciones registradas</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {capacitaciones.map((cap) => {
                const badgeColor =
                  cap.estado === 'completada' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  cap.estado === 'en_curso'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                  cap.estado === 'cancelada'  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                const estadoLabel =
                  cap.estado === 'completada' ? 'Completada' :
                  cap.estado === 'en_curso'   ? 'En curso' :
                  cap.estado === 'cancelada'  ? 'Cancelada' : 'Planificada'
                return (
                  <div key={cap.id} className="flex items-start gap-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <BookOpen size={22} className="text-blue-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{cap.nombre}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{estadoLabel}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {nombreEmpleado(cap.empleado)}
                        {cap.proveedor && ` · ${cap.proveedor}`}
                        {cap.horas && ` · ${cap.horas}h`}
                        {cap.fecha_inicio && ` · ${format(new Date(cap.fecha_inicio + 'T00:00:00'), 'dd/MM/yyyy')}`}
                        {cap.fecha_fin && ` → ${format(new Date(cap.fecha_fin + 'T00:00:00'), 'dd/MM/yyyy')}`}
                      </p>
                      {cap.resultado && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Resultado: {cap.resultado}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {cap.certificado_path && (
                        <button
                          onClick={() => getDocUrl(cap.certificado_path!)}
                          className="px-3 py-1.5 text-xs bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 flex items-center gap-1"
                        >
                          <Award size={12} /> Cert.
                        </button>
                      )}
                      <button
                        onClick={() => startEditCap(cap)}
                        className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                      >
                        <Edit size={15} />
                      </button>
                      <button
                        onClick={() => { if (confirm('¿Eliminar esta capacitación?')) deleteCapacitacion.mutate(cap) }}
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* EQUIPO TAB — Supervisor Self-Service + Org Tree */}
      {activeTab === 'equipo' && (
        <div className="space-y-8">
          {/* Vista SUPERVISOR: Mi Equipo */}
          {esSupervisor && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Network size={20} className="text-blue-500" /> Mi Equipo
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({teamEmpleados.length} personas)</span>
              </h2>

              {/* KPIs rápidos */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {(() => {
                  const asistHoyMap = Object.fromEntries(teamAsistHoy.map((a: any) => [a.empleado_id, a.estado]))
                  const presentes = teamEmpleados.filter((e) => asistHoyMap[e.id] === 'presente' || asistHoyMap[e.id] === 'tardanza').length
                  const ausentes  = teamEmpleados.filter((e) => asistHoyMap[e.id] === 'ausente' || asistHoyMap[e.id] === 'licencia').length
                  const sinReg    = teamEmpleados.filter((e) => !asistHoyMap[e.id]).length
                  return (
                    <>
                      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">{presentes}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Presentes hoy</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">{ausentes}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ausentes/Licencia</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-gray-500 dark:text-gray-400">{sinReg}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Sin registrar</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{teamVacPendientes.length}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Vacaciones pendientes</p>
                      </div>
                    </>
                  )
                })()}
              </div>

              {/* Tabla de equipo */}
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Empleado</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Puesto</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Asistencia hoy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamEmpleados.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No tenés empleados asignados</td></tr>
                    ) : (
                      teamEmpleados.map((emp) => {
                        const asistHoyMap = Object.fromEntries(teamAsistHoy.map((a: any) => [a.empleado_id, a.estado]))
                        const estadoAsist = asistHoyMap[emp.id]
                        const asistBadge =
                          estadoAsist === 'presente'  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          estadoAsist === 'tardanza'  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                          estadoAsist === 'ausente'   ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          estadoAsist === 'licencia'  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                                                       'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        const asistLabel = estadoAsist ? estadoAsist.charAt(0).toUpperCase() + estadoAsist.slice(1) : 'Sin registrar'
                        return (
                          <tr key={emp.id} className="border-t border-gray-100 dark:border-gray-700">
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900 dark:text-white">{nombreEmpleado(emp)}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{emp.dni_rut}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">
                              {emp.puesto?.nombre ?? '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${asistBadge}`}>{asistLabel}</span>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Vacaciones pendientes del equipo */}
              {teamVacPendientes.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                    Solicitudes de vacaciones pendientes
                  </h3>
                  <div className="grid gap-3">
                    {teamVacPendientes.map((v) => (
                      <div key={v.id} className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                        <Plane size={18} className="text-yellow-500 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{nombreEmpleado(v.empleado)}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {format(new Date(v.desde + 'T00:00:00'), 'dd/MM/yyyy')} → {format(new Date(v.hasta + 'T00:00:00'), 'dd/MM/yyyy')} · {v.dias_habiles} días hábiles
                          </p>
                          {v.notas && <p className="text-xs text-gray-400 dark:text-gray-500">{v.notas}</p>}
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => aprobarVacEquipo.mutate(v.id)}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 flex items-center gap-1"
                          >
                            <Check size={12} /> Aprobar
                          </button>
                          <button
                            onClick={() => rechazarVacEquipo.mutate(v.id)}
                            className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 flex items-center gap-1"
                          >
                            <X size={12} /> Rechazar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Árbol organizacional genealógico */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <Network size={20} className="text-purple-500" /> Árbol Organizacional
            </h2>
            {(() => {
              const activos = empleados.filter((e) => e.activo)
              if (activos.length === 0) return (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <Users2 size={40} className="mx-auto mb-3 opacity-40" />
                  <p>No hay empleados activos</p>
                </div>
              )

              const bySup: Record<string, typeof activos> = {}
              const supNombres: Record<string, string> = {}
              activos.forEach((e) => {
                const key = e.supervisor_id ?? '__root__'
                if (!bySup[key]) bySup[key] = []
                bySup[key].push(e)
                if (e.supervisor_id && e.supervisor?.nombre_display) {
                  supNombres[e.supervisor_id] = e.supervisor.nombre_display
                }
              })

              const EmpNode = ({ emp }: { emp: typeof activos[0] }) => (
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 shadow-sm min-w-[160px] max-w-[200px] hover:shadow-md transition-shadow">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center font-bold text-blue-600 dark:text-blue-400 text-xs flex-shrink-0">
                    {(emp.nombre || emp.dni_rut)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white truncate leading-tight">{nombreEmpleado(emp)}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{emp.puesto?.nombre ?? emp.departamento?.nombre ?? emp.dni_rut}</p>
                  </div>
                </div>
              )

              const supervisorIds = Object.keys(bySup).filter(k => k !== '__root__')

              return (
                <div className="space-y-8 overflow-x-auto pb-4">
                  {/* Grupos con supervisor */}
                  {supervisorIds.map((supId) => (
                    <div key={supId} className="flex flex-col items-start">
                      {/* Nodo supervisor */}
                      <div className="flex items-center gap-3 bg-accent/5 dark:bg-accent/10 border-2 border-accent/30 rounded-xl px-4 py-3 shadow-sm ml-4">
                        <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center font-bold text-accent text-sm flex-shrink-0">
                          {supNombres[supId]?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{supNombres[supId] ?? 'Supervisor'}</p>
                          <p className="text-[11px] text-accent font-medium flex items-center gap-1"><UserCheck size={10}/>Supervisor</p>
                        </div>
                      </div>

                      {/* Línea vertical desde supervisor */}
                      <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 ml-9" />

                      {/* Fila de empleados con conector */}
                      <div className="relative flex flex-wrap gap-4 pt-0">
                        {/* Línea horizontal superior (bracket) */}
                        {bySup[supId].length > 1 && (
                          <div className="absolute top-0 left-9 right-0 h-px bg-gray-300 dark:bg-gray-600" style={{ width: `calc(100% - 36px)` }} />
                        )}
                        {bySup[supId].map((emp) => (
                          <div key={emp.id} className="flex flex-col items-center">
                            {/* Línea vertical conectora hacia la barra horizontal */}
                            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />
                            <EmpNode emp={emp} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Sin supervisor */}
                  {bySup['__root__']?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
                        <Users2 size={12} /> Sin supervisor asignado
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {bySup['__root__'].map((emp) => (
                          <EmpNode key={emp.id} emp={emp} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
