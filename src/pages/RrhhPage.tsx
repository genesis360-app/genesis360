import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Edit, Search, Users2,
  Building2, Briefcase, Calendar, ChevronDown, Heart, AlertTriangle,
  DollarSign, CreditCard, ChevronRight, CheckCircle, Clock,
  Plane, ClipboardList, Check, X, LayoutDashboard, FileSpreadsheet,
  UserCheck, UserX, TrendingUp, Download, Paperclip, FolderOpen, File,
  BookOpen, Award, Network, FileText, Star, QrCode, Copy,
} from 'lucide-react'
import { utils as xlsxUtils, writeFile as xlsxWriteFile } from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import { logActividad } from '@/lib/actividadLog'
import { calcularItemsNomina, mejorSueldoSemestre, sacMejorSueldo, type ConceptoNomina } from '@/lib/rrhhNomina'
import { generarReciboSueldoPDF } from '@/lib/reciboSueldoPDF'
import { LICENCIA_TIPOS, montoHorasExtra, sueldoHora, minutosTardeFacturables, descuentoTardanza } from '@/lib/rrhhAsistencia'
import { FRECUENCIAS, basicoProrrateado, anticiposADescontar } from '@/lib/rrhhLiquidacion'
import { diasVacacionesLCT, antiguedadAnios, remanenteSiguiente, solapamientos, evaluarAviso } from '@/lib/rrhhVacaciones'
import { documentosFaltantes, documentosPorVencer, type DocCatalogo } from '@/lib/rrhhDocumentos'
import { liquidacionFinal, generaIndemnizacion } from '@/lib/liquidacionFinal'
import RrhhReportesPanel from '@/components/RrhhReportesPanel'
import toast from 'react-hot-toast'
import { differenceInDays, format } from 'date-fns'
import { es } from 'date-fns/locale'

type Tab = 'dashboard' | 'empleados' | 'puestos' | 'departamentos' | 'cumpleanos' | 'nomina' | 'vacaciones' | 'asistencia' | 'documentos' | 'capacitaciones' | 'equipo' | 'reportes'
type FormMode = 'crear' | 'editar' | null

interface Concepto {
  id: string
  tenant_id: string
  nombre: string
  tipo: 'HABER' | 'DESCUENTO'
  activo: boolean
  // RH2/B4
  tipo_calculo?: 'fijo' | 'porcentaje' | 'sobre_bruto'
  default_pct?: number | null
  default_monto?: number | null
  es_aporte?: boolean
  predefinido?: boolean
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
  // RH3/B6+B7
  gasto_id: string | null
  comprobante_firmado_url: string | null
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
  // RH1/A2 + A4
  motivo_egreso: string | null
  cbu: string | null
  alias_cbu: string | null
  banco: string | null
  tipo_cuenta: string | null
  titular_cuenta: string | null
  // RH2/B4
  config_aportes?: string[]
  beneficios_extra?: { nombre: string; tipo: 'monto' | 'porcentaje'; valor: number }[]
  // RH6/D2
  horario_entrada?: string | null
  horario_salida?: string | null
  // RH4/B1
  frecuencia_liquidacion?: string
  frecuencia_dias?: number | null
  created_at: string
  updated_at: string
  // Joins
  puesto?: { id: string; nombre: string }
  departamento?: { id: string; nombre: string }
  supervisor?: { id: string; nombre: string; apellido: string | null }
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
  const { tenant, user, setTenant } = useAuthStore()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>(() => user?.rol === 'SUPERVISOR' ? 'equipo' : 'empleados')
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [selectedEmpleado, setSelectedEmpleado] = useState<Empleado | null>(null)
  // RH6 — fichado por QR público
  const fichadoToken = (tenant as any)?.fichado_token as string | null | undefined
  const fichadoLink = fichadoToken ? `${(import.meta as any).env?.VITE_APP_URL ?? window.location.origin}/fichar/${fichadoToken}` : ''
  const [fichadoQr, setFichadoQr] = useState('')
  const esDuenoRrhh = user?.rol === 'DUEÑO' || user?.rol === 'ADMIN' || user?.rol === 'SUPER_USUARIO'
  useEffect(() => {
    if (!fichadoLink) { setFichadoQr(''); return }
    QRCode.toDataURL(fichadoLink, { width: 240, margin: 1 }).then(setFichadoQr).catch(() => setFichadoQr(''))
  }, [fichadoLink])
  const generarFichadoToken = async (rotar = false) => {
    if (fichadoToken && !rotar) return
    const nuevo = crypto.randomUUID()
    const { data } = await supabase.from('tenants').update({ fichado_token: nuevo }).eq('id', tenant!.id).select().single()
    if (data) setTenant(data as any)
  }
  // RH1/A2 — modal de baja con motivo
  const [bajaEmpleado, setBajaEmpleado] = useState<{ id: string; nombre: string; motivo: string; fecha: string } | null>(null)
  // RH8/A2-c — liquidación final
  const [liqFinal, setLiqFinal] = useState<any | null>(null)
  const [liqForm, setLiqForm] = useState({ mejorSueldo: '', antiguedadAnios: '', mesesFraccion: '', mejorSueldoSemestre: '', diasTrabajadosSemestre: '', diasVacacionesPendientes: '', sueldoMensual: '', conIndemnizacion: true })
  const [savingLiq, setSavingLiq] = useState(false)
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
    tipo_contrato: '',
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
  const [conceptoForm, setConceptoForm] = useState<{ nombre: string; tipo: 'HABER' | 'DESCUENTO'; tipo_calculo: 'fijo' | 'porcentaje' | 'sobre_bruto'; default_pct: string; default_monto: string; es_aporte: boolean }>({ nombre: '', tipo: 'HABER', tipo_calculo: 'fijo', default_pct: '', default_monto: '', es_aporte: false })
  const [newItem, setNewItem] = useState<{ descripcion: string; tipo: 'HABER' | 'DESCUENTO'; monto: string; concepto_id: string }>({ descripcion: '', tipo: 'HABER', monto: '', concepto_id: '' })
  const [cajaSessionId, setCajaSessionId] = useState<string>('')
  const [medioPagoNomina, setMedioPagoNomina] = useState<'efectivo' | 'transferencia_banco' | 'mp'>('efectivo')
  const [historialEmpleadoId, setHistorialEmpleadoId] = useState<string>('')
  const [showHistorialSueldos, setShowHistorialSueldos] = useState(false)
  // RH4/B10 — anticipos
  const [anticipoForm, setAnticipoForm] = useState<{ empleado_id: string; monto: string; motivo: string; generaGasto: boolean; esPrestamo: boolean; documento: File | null }>({ empleado_id: '', monto: '', motivo: '', generaGasto: true, esPrestamo: false, documento: null })
  const [showAnticipos, setShowAnticipos] = useState(false)

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
  const [asistForm, setAsistForm] = useState<{ empleado_id: string; fecha: string; hora_entrada: string; hora_salida: string; estado: string; motivo: string; tipo_licencia: string }>({
    empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), hora_entrada: '', hora_salida: '', estado: 'presente', motivo: '', tipo_licencia: '',
  })
  const [asistFiltroEmpleado, setAsistFiltroEmpleado] = useState('')
  // RH6/D5 — horas extra
  const [horaExtraForm, setHoraExtraForm] = useState({ empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), horas: '', multiplicador: '50' })

  // Check-in rápido state
  const [checkinEmpleadoId, setCheckinEmpleadoId] = useState('')

  // Feriados state
  const [showFeriadoForm, setShowFeriadoForm] = useState(false)
  const [editingFeriado, setEditingFeriado] = useState<Feriado | null>(null)
  const [feriadoForm, setFeriadoForm] = useState<{ nombre: string; fecha: string; tipo: string; regla_pago: string }>({
    nombre: '', fecha: format(new Date(), 'yyyy-MM-dd'), tipo: 'nacional', regla_pago: 'doble',
  })

  // Documentos state
  const [docEmpleadoFiltro, setDocEmpleadoFiltro] = useState('')
  const [docUploading, setDocUploading] = useState(false)
  const [docForm, setDocForm] = useState<{ empleado_id: string; nombre: string; descripcion: string; tipo: string; file: File | null; fecha_vencimiento: string }>({
    empleado_id: '', nombre: '', descripcion: '', tipo: 'otro', file: null, fecha_vencimiento: '',
  })
  const [showDocForm, setShowDocForm] = useState(false)
  // RH7/E1 — catálogo de documentos obligatorios
  const [catDocForm, setCatDocForm] = useState({ nombre: '', obligatorio: true })

  // Capacitaciones state
  const [capFiltroEmpleado, setCapFiltroEmpleado] = useState('')
  const [capFiltroEstado, setCapFiltroEstado] = useState('')
  const [showCapForm, setShowCapForm] = useState(false)
  const [editingCap, setEditingCap] = useState<Capacitacion | null>(null)
  const [capUploading, setCapUploading] = useState(false)
  const [capForm, setCapForm] = useState<{
    empleado_id: string; nombre: string; descripcion: string
    fecha_inicio: string; fecha_fin: string; horas: string
    proveedor: string; estado: string; resultado: string; certFile: File | null; obligatoria: boolean
  }>({
    empleado_id: '', nombre: '', descripcion: '', fecha_inicio: '', fecha_fin: '',
    horas: '', proveedor: '', estado: 'planificada', resultado: '', certFile: null, obligatoria: false,
  })
  // RH7/F4 — evaluaciones de desempeño
  const [evalForm, setEvalForm] = useState({ empleado_id: '', periodo: '', tipo: 'supervisor', puntaje: '', comentarios: '' })

  // Queries
  const { data: empleados = [], isLoading: loadingEmpleados } = useQuery({
    queryKey: ['empleados', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados')
        .select('*, puesto:rrhh_puestos(id, nombre), departamento:rrhh_departamentos(id, nombre), supervisor:empleados!supervisor_id(id, nombre, apellido)')
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

  // RH1/A3 — catálogo configurable de tipos de contrato
  const { data: tiposContrato = [] } = useQuery({
    queryKey: ['rrhh-tipos-contrato', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('rrhh_tipos_contrato')
        .select('*').eq('tenant_id', tenant!.id).order('nombre')
      if (error) throw error
      return (data ?? []) as { id: string; nombre: string; es_relacion_dependencia: boolean; activo: boolean; predefinido: boolean }[]
    },
    enabled: !!tenant,
  })

  const agregarTipoContrato = async () => {
    const nombre = window.prompt('Nombre del nuevo tipo de contrato:')?.trim()
    if (!nombre) return
    const relDep = window.confirm('¿Es "relación de dependencia"? (Aceptar = sí → aplica auto-aportes)')
    const { error } = await supabase.from('rrhh_tipos_contrato')
      .insert({ tenant_id: tenant!.id, nombre, es_relacion_dependencia: relDep })
    if (error) { toast.error(error.message); return }
    toast.success('Tipo de contrato agregado')
    qc.invalidateQueries({ queryKey: ['rrhh-tipos-contrato'] })
    setFormData(f => ({ ...f, tipo_contrato: nombre }))
  }

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

  // ISS-185: el supervisor de un empleado es OTRO EMPLEADO (no un user del sistema).
  // El organigrama se arma con empleados de RRHH.
  const { data: supervisores = [] } = useQuery({
    queryKey: ['empleados-supervisores', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados')
        .select('id, nombre, apellido')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return (data ?? []) as Array<{ id: string; nombre: string; apellido: string | null }>
    },
    enabled: !!tenant,
  })

  // RRHH-A5: usuarios del sistema disponibles para vincular a un empleado.
  // Habilita "Mi Equipo" del SUPERVISOR (get_supervisor_team_ids mapea auth.uid()
  // → empleados.user_id → supervisor_id). Migration 151 garantiza unicidad.
  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['tenant-users-link', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('users')
        .select('id, nombre_display, email, rol')
        .eq('tenant_id', tenant!.id)
        .order('nombre_display')
      if (error) throw error
      return (data ?? []) as Array<{ id: string; nombre_display: string | null; email: string; rol: string }>
    },
    enabled: !!tenant && (activeTab === 'empleados' || activeTab === 'equipo'),
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { puesto, departamento, supervisor, ...campos } = data as any
      if (formMode === 'crear') {
        // ISS-184: usar .select() + relaciones para que el row recién creado se inyecte
        // en el cache via setQueryData en onSuccess (evita el caso "lista vacía hasta F5").
        const { data: inserted, error } = await supabase.from('empleados')
          .insert({ tenant_id: tenant!.id, ...campos })
          .select('*, puesto:rrhh_puestos(id, nombre), departamento:rrhh_departamentos(id, nombre), supervisor:empleados!supervisor_id(id, nombre, apellido)')
          .single()
        if (error) throw error
        logActividad({
          entidad: 'empleado',
          entidad_id: inserted?.id ?? '',
          entidad_nombre: nombreEmpleado(data) || 'Nuevo empleado',
          accion: 'crear',
          pagina: '/rrhh',
        })
        return { mode: 'crear' as const, row: inserted as Empleado }
      } else if (selectedEmpleado) {
        const { data: updated, error } = await supabase
          .from('empleados')
          .update(campos)
          .eq('id', selectedEmpleado.id)
          .select('*, puesto:rrhh_puestos(id, nombre), departamento:rrhh_departamentos(id, nombre), supervisor:empleados!supervisor_id(id, nombre, apellido)')
          .single()
        if (error) throw error
        logActividad({
          entidad: 'empleado',
          entidad_id: selectedEmpleado.id,
          entidad_nombre: nombreEmpleado(selectedEmpleado),
          accion: 'editar',
          pagina: '/rrhh',
        })
        return { mode: 'editar' as const, row: updated as Empleado }
      }
    },
    onSuccess: (result) => {
      toast.success(result?.mode === 'crear' ? 'Empleado creado' : 'Empleado actualizado')
      // ISS-184: optimistic update — inyectar el row en la cache para que la tabla se
      // actualice de inmediato. El invalidate posterior trae los joins frescos del server.
      if (result?.row) {
        qc.setQueryData<Empleado[]>(['empleados', tenant?.id], (prev) => {
          const lista = prev ?? []
          if (result.mode === 'crear') return [result.row, ...lista]
          return lista.map(e => e.id === result.row.id ? result.row : e)
        })
      }
      qc.invalidateQueries({ queryKey: ['empleados'] })
      resetForm()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error al guardar'),
  })

  const toggleEmpleadoActivo = useMutation({
    mutationFn: async ({ empId, motivo, fecha }: { empId: string; motivo?: string; fecha?: string }) => {
      const emp = empleados.find((e) => e.id === empId)
      if (!emp) return
      // RH1/A2 — baja captura motivo+fecha de egreso; reactivar los limpia
      const payload = emp.activo
        ? { activo: false, motivo_egreso: motivo ?? null, fecha_egreso: fecha ?? format(new Date(), 'yyyy-MM-dd') }
        : { activo: true, motivo_egreso: null, fecha_egreso: null }
      const { error } = await supabase
        .from('empleados')
        .update(payload)
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
    mutationFn: async (data: typeof conceptoForm) => {
      const payload = {
        nombre: data.nombre.trim(),
        tipo: data.tipo,
        tipo_calculo: data.tipo_calculo,
        default_pct: data.tipo_calculo !== 'fijo' && data.default_pct ? parseFloat(data.default_pct) : null,
        default_monto: data.tipo_calculo === 'fijo' && data.default_monto ? parseFloat(data.default_monto) : null,
        es_aporte: data.es_aporte,
      }
      if (editingConcepto) {
        const { error } = await supabase.from('rrhh_conceptos').update(payload).eq('id', editingConcepto.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('rrhh_conceptos').insert({ tenant_id: tenant!.id, ...payload })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingConcepto ? 'Concepto actualizado' : 'Concepto creado')
      qc.invalidateQueries({ queryKey: ['rrhh_conceptos'] })
      setShowConceptoForm(false)
      setEditingConcepto(null)
      setConceptoForm({ nombre: '', tipo: 'HABER', tipo_calculo: 'fijo', default_pct: '', default_monto: '', es_aporte: false })
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

  // RH2/B4 — conceptos que son aporte (para inyectar en la liquidación)
  const conceptosAporte = (conceptos as Concepto[]).filter(c => c.es_aporte).map<ConceptoNomina>(c => ({
    id: c.id, nombre: c.nombre, tipo: c.tipo, tipo_calculo: c.tipo_calculo ?? 'sobre_bruto',
    default_pct: c.default_pct, default_monto: c.default_monto, es_aporte: c.es_aporte,
  }))

  const crearLiquidacion = useMutation({
    mutationFn: async (emp: Empleado) => {
      const id = crypto.randomUUID()
      // RH4/B1 — prorratea el básico mensual según la frecuencia del empleado
      const basico = basicoProrrateado(emp.salario_bruto ?? 0, emp.frecuencia_liquidacion ?? 'mensual', emp.frecuencia_dias)
      // RH2/B4 — inyecta sueldo básico + beneficios extra (HABER) + aportes activos del empleado (DESCUENTO)
      const calc = calcularItemsNomina(basico, conceptosAporte, emp.config_aportes ?? [], emp.beneficios_extra ?? [])
      const items = [...calc.items]
      let totalDescuentos = calc.totalDescuentos
      // RH6/D3 — descuento por tardanza: suma las fichadas de entrada del período vs el horario del empleado
      const tardModo = ((tenant as any)?.rrhh_tardanza_modo ?? 'registrar') as 'registrar' | 'proporcional' | 'umbral'
      if (tardModo !== 'registrar' && emp.horario_entrada) {
        const [py, pm] = nominaPeriodo.split('-')
        const ultimoDia = new Date(Number(py), Number(pm), 0).getDate()
        const { data: fichEntradas } = await supabase.from('rrhh_fichadas')
          .select('ts').eq('tenant_id', tenant!.id).eq('empleado_id', emp.id).eq('tipo', 'entrada')
          .gte('ts', `${py}-${pm}-01T00:00:00`).lte('ts', `${py}-${pm}-${String(ultimoDia).padStart(2, '0')}T23:59:59`)
        const cfgTard = { modo: tardModo, toleranciaMin: (tenant as any)?.rrhh_tardanza_tolerancia_min ?? 0 }
        const minTarde = minutosTardeFacturables((fichEntradas ?? []) as any[], emp.horario_entrada, cfgTard)
        const sh = sueldoHora(emp.salario_bruto ?? 0, (tenant as any)?.rrhh_horas_mes_base ?? 200)
        const descTard = descuentoTardanza(minTarde, sh, { modo: 'proporcional' })
        if (descTard > 0) {
          items.push({ concepto_id: null, descripcion: `Descuento por tardanza (${minTarde} min)`, tipo: 'DESCUENTO', monto: descTard })
          totalDescuentos = Math.round((totalDescuentos + descTard) * 100) / 100
        }
      }
      // RH4/B10 — descuenta anticipos pendientes del empleado (sin dejar neto negativo)
      const { data: anticipos } = await supabase.from('rrhh_anticipos')
        .select('id, monto').eq('tenant_id', tenant!.id).eq('empleado_id', emp.id).eq('saldado', false)
      const netoSinAnticipo = calc.totalHaberes - calc.totalDescuentos
      const desc = anticiposADescontar((anticipos ?? []) as any[], netoSinAnticipo)
      if (desc.monto > 0) {
        items.push({ concepto_id: null, descripcion: 'Descuento de anticipo', tipo: 'DESCUENTO', monto: desc.monto })
        totalDescuentos = Math.round((totalDescuentos + desc.monto) * 100) / 100
      }
      const neto = Math.round((calc.totalHaberes - totalDescuentos) * 100) / 100
      const { error } = await supabase.from('rrhh_salarios').insert({
        id, tenant_id: tenant!.id, empleado_id: emp.id, periodo: nominaPeriodo,
        basico, total_haberes: calc.totalHaberes, total_descuentos: totalDescuentos, neto,
      })
      if (error) throw error
      if (items.length > 0) {
        await supabase.from('rrhh_salario_items').insert(
          items.map(it => ({ tenant_id: tenant!.id, salario_id: id, concepto_id: it.concepto_id, descripcion: it.descripcion, tipo: it.tipo, monto: it.monto })),
        )
      }
      // marcar los anticipos saldados completos
      if (desc.saldadosIds.length > 0) {
        await supabase.from('rrhh_anticipos').update({ saldado: true, descontado_en_salario_id: id }).in('id', desc.saldadosIds)
      }
      logActividad({ entidad: 'nomina', entidad_id: id, entidad_nombre: nombreEmpleado(emp), accion: 'crear', pagina: '/rrhh' })
    },
    onSuccess: () => { toast.success('Liquidación creada'); refetchSalarios(); qc.invalidateQueries({ queryKey: ['rrhh-anticipos'] }) },
    onError: (err: any) => toast.error(err.message ?? 'Error al crear liquidación'),
  })

  // RH2/B5 — generar aguinaldo (SAC) del semestre: 50% del mejor sueldo del semestre
  const generarSAC = useMutation({
    mutationFn: async (semestre: 1 | 2) => {
      const anio = Number(nominaAnio)
      const desde = `${anio}-${semestre === 1 ? '01' : '07'}-01`
      const hasta = `${anio}-${semestre === 1 ? '06' : '12'}-01`
      const periodoSAC = `${anio}-${semestre === 1 ? '06' : '12'}-01`
      const activos = empleados.filter(e => e.activo)
      let creados = 0
      for (const emp of activos) {
        // mejor básico del semestre (de los salarios del empleado)
        const { data: sems } = await supabase.from('rrhh_salarios')
          .select('basico').eq('tenant_id', tenant!.id).eq('empleado_id', emp.id)
          .gte('periodo', desde).lte('periodo', hasta)
        const basicos = (sems ?? []).map((s: any) => Number(s.basico) || 0)
        const mejor = mejorSueldoSemestre(basicos.length ? basicos : [emp.salario_bruto ?? 0])
        const sac = sacMejorSueldo(mejor)
        if (sac <= 0) continue
        const id = crypto.randomUUID()
        const { error } = await supabase.from('rrhh_salarios').insert({
          id, tenant_id: tenant!.id, empleado_id: emp.id, periodo: periodoSAC,
          basico: 0, total_haberes: sac, total_descuentos: 0, neto: sac,
          notas: `SAC ${semestre === 1 ? '1er' : '2do'} semestre ${anio} (50% mejor sueldo)`,
        })
        if (error) continue // ya existe liquidación de ese período (UNIQUE) → saltear
        await supabase.from('rrhh_salario_items').insert({
          tenant_id: tenant!.id, salario_id: id, descripcion: `Aguinaldo (SAC) ${semestre}° sem.`, tipo: 'HABER', monto: sac,
        })
        creados++
      }
      return creados
    },
    onSuccess: (n) => { toast.success(`${n} liquidaciones de SAC generadas`); refetchSalarios() },
    onError: (err: any) => toast.error(err.message ?? 'Error al generar SAC'),
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

  // RH3/B8 — gate de doble validación: quién puede generar el gasto / pagar la nómina
  const puedeAprobarNomina = (() => {
    if (!(tenant as any)?.rrhh_nomina_doble_validacion) return true
    if (user?.rol === 'DUEÑO' || user?.rol === 'ADMIN') return true
    if ((tenant as any)?.rrhh_nomina_supervisor_aprueba && user?.rol === 'SUPERVISOR') return true
    return false
  })()

  // RH3/B7 — generar el gasto de la nómina en el módulo Gastos (estado pendiente)
  const generarGastoNomina = useMutation({
    mutationFn: async (salario: Salario) => {
      if (!puedeAprobarNomina) throw new Error('Requiere aprobación de DUEÑO/ADMIN (doble validación activada)')
      if (salario.gasto_id) throw new Error('Ya tiene un gasto generado')
      const catSueldos = (await supabase.from('categorias_gasto').select('id').eq('tenant_id', tenant!.id).eq('nombre', 'Sueldos').maybeSingle()).data?.id ?? null
      const { data: gasto, error } = await supabase.from('gastos').insert({
        tenant_id: tenant!.id,
        descripcion: `Sueldo ${nombreEmpleado(salario.empleado)} — ${salario.periodo.slice(0, 7)}`,
        monto: salario.neto,
        categoria: 'Sueldos',
        categoria_id: catSueldos,
        fecha: new Date().toISOString().split('T')[0],
        usuario_id: user?.id ?? null,
        gasto_negocio: true,
        deduce_ganancias: true,
        monto_pagado: 0,
        estado_pago: 'pendiente',
        notas: `Nómina RRHH (pendiente de pago en Gastos)`,
      }).select('id').single()
      if (error) throw error
      await supabase.from('rrhh_salarios').update({ gasto_id: gasto.id }).eq('id', salario.id)
      logActividad({ entidad: 'nomina', entidad_id: salario.id, entidad_nombre: nombreEmpleado(salario.empleado), accion: 'editar', campo: 'gasto', pagina: '/rrhh' })
    },
    onSuccess: () => { toast.success('Gasto generado en Gastos (pendiente de pago)'); refetchSalarios(); qc.invalidateQueries({ queryKey: ['gastos'] }) },
    onError: (err: any) => toast.error(err.message ?? 'Error al generar el gasto'),
  })

  // RH3/B7 — acumular las cargas sociales (aportes) del período en gastos por concepto
  const generarCargasSociales = useMutation({
    mutationFn: async () => {
      if (!puedeAprobarNomina) throw new Error('Requiere aprobación de DUEÑO/ADMIN (doble validación activada)')
      // sumar los ítems de aporte (DESCUENTO) de todas las liquidaciones del período
      const salarioIds = salarios.map(s => s.id)
      if (salarioIds.length === 0) throw new Error('No hay liquidaciones en el período')
      const { data: items } = await supabase.from('rrhh_salario_items')
        .select('descripcion, tipo, monto, concepto_id').in('salario_id', salarioIds).eq('tipo', 'DESCUENTO')
      const aporteConceptIds = new Set(conceptosAporte.map(c => c.id))
      const porConcepto = new Map<string, number>()
      for (const it of (items ?? []) as any[]) {
        if (!it.concepto_id || !aporteConceptIds.has(it.concepto_id)) continue
        porConcepto.set(it.descripcion, (porConcepto.get(it.descripcion) ?? 0) + Number(it.monto || 0))
      }
      if (porConcepto.size === 0) throw new Error('No hay aportes en las liquidaciones del período')
      const catCargas = (await supabase.from('categorias_gasto').select('id').eq('tenant_id', tenant!.id).eq('nombre', 'Cargas sociales').maybeSingle()).data?.id ?? null
      let n = 0
      for (const [concepto, monto] of porConcepto) {
        if (monto <= 0) continue
        await supabase.from('gastos').insert({
          tenant_id: tenant!.id,
          descripcion: `${concepto} — ${nominaPeriodo.slice(0, 7)}`,
          monto: Math.round(monto * 100) / 100,
          categoria: 'Cargas sociales', categoria_id: catCargas,
          fecha: new Date().toISOString().split('T')[0], usuario_id: user?.id ?? null,
          gasto_negocio: true, deduce_ganancias: true, monto_pagado: 0, estado_pago: 'pendiente',
          notas: `Aporte acumulado de nómina ${nominaPeriodo.slice(0, 7)}`,
        })
        n++
      }
      return n
    },
    onSuccess: (n) => { toast.success(`${n} gasto(s) de cargas sociales generados (pendientes)`); qc.invalidateQueries({ queryKey: ['gastos'] }) },
    onError: (err: any) => toast.error(err.message ?? 'Error al generar cargas sociales'),
  })

  // RH4/B10 — anticipos pendientes (se descuentan en la próxima liquidación)
  const { data: anticiposPend = [], refetch: refetchAnticipos } = useQuery({
    queryKey: ['rrhh-anticipos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_anticipos')
        .select('*, empleado:empleados(nombre, apellido, dni_rut)')
        .eq('tenant_id', tenant!.id).eq('saldado', false).order('fecha', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'nomina',
  })

  const registrarAnticipo = useMutation({
    mutationFn: async (f: { empleado_id: string; monto: string; motivo: string; generaGasto: boolean; esPrestamo: boolean; documento: File | null }) => {
      if (!f.empleado_id) throw new Error('Seleccioná un empleado')
      const monto = parseFloat(f.monto) || 0
      if (monto <= 0) throw new Error('Indicá el monto')
      const emp = empleados.find(e => e.id === f.empleado_id)
      const etiqueta = f.esPrestamo ? 'Préstamo' : 'Anticipo'
      // L3 — préstamo: subir la nota/documentación firmada al bucket empleados
      let documentoUrl: string | null = null
      if (f.documento) {
        const ext = f.documento.name.split('.').pop()
        const path = `prestamos/${f.empleado_id}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('empleados').upload(path, f.documento, { upsert: true })
        if (upErr) throw upErr
        const { data: signed } = await supabase.storage.from('empleados').createSignedUrl(path, 60 * 60 * 24 * 365)
        documentoUrl = signed?.signedUrl ?? path
      }
      let gastoId: string | null = null
      if (f.generaGasto) {
        const catId = (await supabase.from('categorias_gasto').select('id').eq('tenant_id', tenant!.id).eq('nombre', 'Adelantos al personal').maybeSingle()).data?.id ?? null
        const { data: gasto } = await supabase.from('gastos').insert({
          tenant_id: tenant!.id, descripcion: `${etiqueta} ${nombreEmpleado(emp)}`, monto,
          categoria: 'Adelantos al personal', categoria_id: catId,
          fecha: new Date().toISOString().split('T')[0], usuario_id: user?.id ?? null,
          gasto_negocio: true, deduce_ganancias: false, monto_pagado: 0, estado_pago: 'pendiente',
          notas: f.motivo || `${etiqueta} a empleado (se descuenta de la próxima liquidación)`,
        }).select('id').single()
        gastoId = gasto?.id ?? null
      }
      const { error } = await supabase.from('rrhh_anticipos').insert({
        tenant_id: tenant!.id, empleado_id: f.empleado_id, monto, motivo: f.motivo || null,
        gasto_id: gastoId, created_by: user?.id ?? null,
        es_prestamo: f.esPrestamo, documento_url: documentoUrl,
      })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Registrado'); refetchAnticipos(); qc.invalidateQueries({ queryKey: ['gastos'] }) },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  // RH3/B6 — recibo de sueldo PDF
  const descargarRecibo = async (salario: Salario) => {
    const { data: items } = await supabase.from('rrhh_salario_items')
      .select('descripcion, tipo, monto').eq('salario_id', salario.id).order('tipo')
    const emp = salario.empleado
    const puesto = puestos.find(p => p.id === emp?.puesto_id)?.nombre ?? null
    generarReciboSueldoPDF({
      negocio: tenant?.nombre ?? 'Recibo',
      cuit: (tenant as any)?.cuit ?? null,
      empleado: nombreEmpleado(emp),
      dni: emp?.dni_rut ?? null,
      puesto,
      periodo: salario.periodo,
      basico: salario.basico,
      items: (items ?? []) as any[],
      totalHaberes: salario.total_haberes,
      totalDescuentos: salario.total_descuentos,
      neto: salario.neto,
      moneda: (tenant as any)?.moneda ?? 'ARS',
    })
  }

  // RH3/B6 — subir comprobante firmado de recepción del pago
  const subirComprobanteFirmado = async (salario: Salario, file: File) => {
    try {
      const ext = file.name.split('.').pop()
      const path = `recibos/${salario.empleado_id}/${salario.id}_${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('empleados').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: signed } = await supabase.storage.from('empleados').createSignedUrl(path, 60 * 60 * 24 * 365)
      await supabase.from('rrhh_salarios').update({ comprobante_firmado_url: signed?.signedUrl ?? path }).eq('id', salario.id)
      toast.success('Comprobante firmado adjuntado')
      refetchSalarios()
    } catch (err: any) { toast.error(err.message ?? 'Error al subir comprobante') }
  }

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
      // RH5/C3+C4 — chequear plazo de aviso y solapamiento antes de aprobar (alerta, no bloqueo duro)
      const sol = (vacSolicitudes as any[]).find(s => s.id === solicitudId)
      if (sol) {
        const aviso = (tenant as any)?.rrhh_vacaciones_aviso ?? { modo: 'alerta', dias: 30 }
        const ev = evaluarAviso(new Date().toISOString().split('T')[0], sol.desde, aviso)
        if (!ev.ok) throw new Error(`Plazo de aviso insuficiente (${ev.diasAnticipacion}d, se piden ${aviso.dias}d)`)
        if (ev.aviso && !window.confirm(`Aviso: la solicitud se pidió con ${ev.diasAnticipacion} días (mín. recomendado ${aviso.dias}). ¿Aprobar igual?`)) {
          throw new Error('__cancelado__')
        }
        const otras = (vacSolicitudes as any[]).filter(s => s.id !== solicitudId && s.estado === 'aprobada')
        const solap = solapamientos({ desde: sol.desde, hasta: sol.hasta }, otras)
        if (solap.length > 0 && !window.confirm(`Hay ${solap.length} empleado(s) ya aprobado(s) en ese período. ¿Aprobar igual?`)) {
          throw new Error('__cancelado__')
        }
      }
      const { error } = await supabase.rpc('aprobar_vacacion', { p_solicitud_id: solicitudId, p_user_id: user!.id })
      if (error) throw error
      logActividad({ entidad: 'vacacion', entidad_id: solicitudId, accion: 'cambio_estado', valor_nuevo: 'aprobada', pagina: '/rrhh' })
    },
    onSuccess: () => { toast.success('Vacación aprobada'); refetchVacSolicitudes(); refetchVacSaldos() },
    onError: (err: any) => { if (err.message !== '__cancelado__') toast.error(err.message ?? 'Error al aprobar') },
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
        tipo_licencia: form.estado === 'licencia' ? (form.tipo_licencia || null) : null,
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
      setAsistForm({ empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), hora_entrada: '', hora_salida: '', estado: 'presente', motivo: '', tipo_licencia: '' })
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

  // RH6/D5 — horas extra del mes
  const { data: horasExtra = [], refetch: refetchHorasExtra } = useQuery({
    queryKey: ['rrhh-horas-extra', tenant?.id, asistFecha],
    queryFn: async () => {
      const desde = `${asistFecha}-01`
      const hasta = `${asistFecha}-31`
      const { data, error } = await supabase.from('rrhh_horas_extra')
        .select('*, empleado:empleados(nombre, apellido, dni_rut, salario_bruto)')
        .eq('tenant_id', tenant!.id).gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'asistencia',
  })

  const registrarHoraExtra = useMutation({
    mutationFn: async (f: typeof horaExtraForm) => {
      if (!f.empleado_id) throw new Error('Seleccioná un empleado')
      if (!f.horas || parseFloat(f.horas) <= 0) throw new Error('Indicá las horas')
      const requiereAprob = !!(tenant as any)?.rrhh_horas_extra_requiere_aprobacion
      const { error } = await supabase.from('rrhh_horas_extra').insert({
        tenant_id: tenant!.id, empleado_id: f.empleado_id, fecha: f.fecha,
        horas: parseFloat(f.horas), multiplicador: parseInt(f.multiplicador) || 50,
        aprobada: !requiereAprob,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Horas extra registradas')
      setHoraExtraForm({ empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), horas: '', multiplicador: '50' })
      refetchHorasExtra()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const aprobarHoraExtra = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rrhh_horas_extra').update({ aprobada: true, aprobada_por: user?.id ?? null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Horas extra aprobadas'); refetchHorasExtra() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  // ─── Check-in rápido ────────────────────────────────────────────────────────
  const checkinRapido = useMutation({
    mutationFn: async ({ tipo, origen = 'manual' }: { tipo: 'entrada' | 'salida'; origen?: 'manual' | 'celular' | 'qr' }) => {
      if (!checkinEmpleadoId) throw new Error('Seleccioná un empleado')
      const hoy = format(new Date(), 'yyyy-MM-dd')
      const hora = format(new Date(), 'HH:mm')
      // RH6/D1 — registrar la fichada en el ledger
      const empSuc = empleados.find(e => e.id === checkinEmpleadoId)
      await supabase.from('rrhh_fichadas').insert({
        tenant_id: tenant!.id, empleado_id: checkinEmpleadoId,
        sucursal_id: (empSuc as any)?.sucursal_id ?? null, tipo, origen,
      })
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
    mutationFn: async (form: { nombre: string; fecha: string; tipo: string; regla_pago: string }) => {
      if (!form.nombre.trim()) throw new Error('Ingresá el nombre del feriado')
      if (!form.fecha) throw new Error('Indicá la fecha')
      const payload = {
        tenant_id: tenant!.id,
        nombre: form.nombre.trim(),
        fecha: form.fecha,
        tipo: form.tipo,
        regla_pago: form.regla_pago,
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
      setFeriadoForm({ nombre: '', fecha: format(new Date(), 'yyyy-MM-dd'), tipo: 'nacional', regla_pago: 'doble' })
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
    // RH1/A1 — obligatorios adicionales
    if (!formData.email_personal?.trim()) { toast.error('Email es requerido'); return }
    if (!formData.tel_personal?.trim()) { toast.error('Teléfono es requerido'); return }
    if (!formData.puesto_id) { toast.error('Puesto es requerido'); return }
    if (!formData.departamento_id) { toast.error('Departamento es requerido'); return }
    if (formData.user_id) {
      const yaVinculado = empleados.find(e => e.user_id === formData.user_id && e.id !== selectedEmpleado?.id)
      if (yaVinculado) {
        toast.error(`Ese usuario ya está vinculado a ${nombreEmpleado(yaVinculado)}`)
        return
      }
    }
    saveEmpleado.mutate(formData)
  }

  const nombreEmpleado = (emp: Partial<Empleado> | null | undefined) => {
    if (!emp) return ''
    return [emp.nombre, emp.apellido].filter(Boolean).join(' ') || emp.dni_rut || ''
  }

  // RH8/A2-c — abrir liquidación final (precarga desde el empleado)
  const abrirLiqFinal = async (emp: Empleado) => {
    const refEgreso = emp.fecha_egreso ?? new Date().toISOString().split('T')[0]
    const aniosT = antiguedadAnios(emp.fecha_ingreso, refEgreso)
    const bruto = emp.salario_bruto ?? 0
    // días de vacaciones pendientes del año (si hay saldo cargado)
    const { data: saldo } = await supabase.from('rrhh_vacaciones_saldo')
      .select('dias_totales, dias_usados, remanente_anterior').eq('tenant_id', tenant!.id).eq('empleado_id', emp.id).eq('anio', new Date().getFullYear()).maybeSingle()
    const vacPend = saldo ? Math.max(0, (saldo.dias_totales + saldo.remanente_anterior) - saldo.dias_usados) : 0
    setLiqFinal(emp)
    setLiqForm({
      mejorSueldo: String(bruto), antiguedadAnios: String(aniosT), mesesFraccion: '0',
      mejorSueldoSemestre: String(bruto), diasTrabajadosSemestre: '0',
      diasVacacionesPendientes: String(vacPend), sueldoMensual: String(bruto),
      conIndemnizacion: generaIndemnizacion(emp.motivo_egreso),
    })
  }

  const guardarLiqFinal = async () => {
    if (!liqFinal) return
    const r = liquidacionFinal({
      mejorSueldo: parseFloat(liqForm.mejorSueldo) || 0,
      antiguedadAnios: parseFloat(liqForm.antiguedadAnios) || 0,
      mesesFraccion: parseFloat(liqForm.mesesFraccion) || 0,
      mejorSueldoSemestre: parseFloat(liqForm.mejorSueldoSemestre) || 0,
      diasTrabajadosSemestre: parseFloat(liqForm.diasTrabajadosSemestre) || 0,
      diasVacacionesPendientes: parseFloat(liqForm.diasVacacionesPendientes) || 0,
      sueldoMensual: parseFloat(liqForm.sueldoMensual) || 0,
      conIndemnizacion: liqForm.conIndemnizacion,
    })
    setSavingLiq(true)
    try {
      // genera gasto en Gastos (categoría Sueldos, pendiente)
      const catSueldos = (await supabase.from('categorias_gasto').select('id').eq('tenant_id', tenant!.id).eq('nombre', 'Sueldos').maybeSingle()).data?.id ?? null
      const { data: gasto } = await supabase.from('gastos').insert({
        tenant_id: tenant!.id, descripcion: `Liquidación final ${nombreEmpleado(liqFinal)}`, monto: r.total,
        categoria: 'Sueldos', categoria_id: catSueldos, fecha: new Date().toISOString().split('T')[0],
        usuario_id: user?.id ?? null, gasto_negocio: true, deduce_ganancias: true, monto_pagado: 0, estado_pago: 'pendiente',
        notas: `Liquidación final (indemnización ${r.indemnizacion} + SAC ${r.sacProporcional} + vacaciones ${r.vacacionesNoGozadas})`,
      }).select('id').single()
      await supabase.from('rrhh_liquidaciones_finales').insert({
        tenant_id: tenant!.id, empleado_id: liqFinal.id, fecha_egreso: liqFinal.fecha_egreso ?? null, motivo_egreso: liqFinal.motivo_egreso ?? null,
        antiguedad_anios: parseInt(liqForm.antiguedadAnios) || 0, mejor_sueldo: parseFloat(liqForm.mejorSueldo) || 0,
        indemnizacion: r.indemnizacion, sac_proporcional: r.sacProporcional, vacaciones_no_gozadas: r.vacacionesNoGozadas, total: r.total,
        gasto_id: gasto?.id ?? null, created_by: user?.id ?? null,
      })
      toast.success('Liquidación final registrada + gasto generado')
      qc.invalidateQueries({ queryKey: ['gastos'] })
      setLiqFinal(null)
    } catch (e: any) { toast.error(e.message ?? 'Error') }
    finally { setSavingLiq(false) }
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

  // RH7/E1 — catálogo de documentos obligatorios
  const { data: docCatalogo = [], refetch: refetchDocCatalogo } = useQuery({
    queryKey: ['rrhh-doc-catalogo', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_documentos_catalogo').select('*').eq('tenant_id', tenant!.id).order('nombre')
      return (data ?? []) as DocCatalogo[]
    },
    enabled: !!tenant && activeTab === 'documentos',
  })

  // RH7/F4 — evaluaciones de desempeño
  const { data: evaluaciones = [], refetch: refetchEvaluaciones } = useQuery({
    queryKey: ['rrhh-evaluaciones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('rrhh_evaluaciones')
        .select('*, empleado:empleados(nombre, apellido, dni_rut)')
        .eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(50)
      return data ?? []
    },
    enabled: !!tenant && activeTab === 'reportes',
  })

  const saveEvaluacion = useMutation({
    mutationFn: async (f: typeof evalForm) => {
      if (!f.empleado_id) throw new Error('Seleccioná un empleado')
      if (!f.periodo.trim()) throw new Error('Indicá el período')
      const p = parseInt(f.puntaje)
      if (f.puntaje && (p < 1 || p > 10)) throw new Error('El puntaje va de 1 a 10')
      const { error } = await supabase.from('rrhh_evaluaciones').insert({
        tenant_id: tenant!.id, empleado_id: f.empleado_id, periodo: f.periodo.trim(),
        tipo: f.tipo, evaluador_id: user?.id ?? null, puntaje: f.puntaje ? p : null, comentarios: f.comentarios || null,
      })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Evaluación guardada'); setEvalForm({ empleado_id: '', periodo: '', tipo: 'supervisor', puntaje: '', comentarios: '' }); refetchEvaluaciones() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const saveCatDoc = useMutation({
    mutationFn: async (f: typeof catDocForm) => {
      if (!f.nombre.trim()) throw new Error('Nombre requerido')
      const { error } = await supabase.from('rrhh_documentos_catalogo').insert({ tenant_id: tenant!.id, nombre: f.nombre.trim(), obligatorio: f.obligatorio })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Documento agregado al catálogo'); setCatDocForm({ nombre: '', obligatorio: true }); refetchDocCatalogo() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const deleteCatDoc = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('rrhh_documentos_catalogo').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { refetchDocCatalogo() },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
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
        fecha_vencimiento: docForm.fecha_vencimiento || null,
        created_by: user?.id ?? null,
      })
      if (dbErr) throw dbErr
      toast.success('Documento subido')
      setShowDocForm(false)
      setDocForm({ empleado_id: '', nombre: '', descripcion: '', tipo: 'otro', file: null, fecha_vencimiento: '' })
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
        obligatoria: capForm.obligatoria,
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
      setCapForm({ empleado_id: '', nombre: '', descripcion: '', fecha_inicio: '', fecha_fin: '', horas: '', proveedor: '', estado: 'planificada', resultado: '', certFile: null, obligatoria: false })
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
      obligatoria: (cap as any).obligatoria ?? false,
    })
    setShowCapForm(true)
  }

  // Equipo (Phase 5): equipo del supervisor actual.
  // ISS-185: supervisor_id ahora apunta a empleados.id, así que mapeamos el user
  // actual a su empleado (empleados.user_id = user.id) y filtramos por ese id.
  const miEmpleadoId = empleados.find((e) => e.user_id === user?.id)?.id ?? null
  const teamEmpleados = empleados.filter((e) => miEmpleadoId && e.supervisor_id === miEmpleadoId && e.activo)

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
  const esRrhhAdmin = user?.rol === 'DUEÑO' || user?.rol === 'RRHH'

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
          : (['dashboard', 'empleados', 'puestos', 'departamentos', 'cumpleanos', 'nomina', 'vacaciones', 'asistencia', 'capacitaciones', 'documentos', 'reportes', 'equipo'] as Tab[])
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
            {tab === 'reportes'       && <span className="flex items-center gap-1"><TrendingUp size={14}/>Reportes</span>}
            {tab === 'equipo'         && <span className="flex items-center gap-1"><Network size={14}/>Mi Equipo</span>}
          </button>
        ))}
      </div>

      {/* RH8 — REPORTES TAB (+ RH7 F4 evaluaciones + F2/F3 config) */}
      {activeTab === 'reportes' && (
        <div className="space-y-6">
          <RrhhReportesPanel tenant={tenant} />

          {/* RH7/F4 — evaluaciones de desempeño */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><Star size={15}/> Evaluaciones de desempeño</h3>
            <div className="flex flex-wrap gap-2 items-end mb-3">
              <select value={evalForm.empleado_id} onChange={e => setEvalForm({ ...evalForm, empleado_id: e.target.value })}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
                <option value="">Empleado...</option>
                {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>)}
              </select>
              <input type="text" placeholder="Período (2026-S1)" value={evalForm.periodo} onChange={e => setEvalForm({ ...evalForm, periodo: e.target.value })}
                className="w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <select value={evalForm.tipo} onChange={e => setEvalForm({ ...evalForm, tipo: e.target.value })}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
                <option value="supervisor">Supervisor</option>
                <option value="auto">Auto-evaluación</option>
                <option value="par">Par (360°)</option>
              </select>
              <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max="10" placeholder="1-10" value={evalForm.puntaje} onChange={e => setEvalForm({ ...evalForm, puntaje: e.target.value })}
                className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <input type="text" placeholder="Comentarios" value={evalForm.comentarios} onChange={e => setEvalForm({ ...evalForm, comentarios: e.target.value })}
                className="flex-1 min-w-[140px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <button onClick={() => saveEvaluacion.mutate(evalForm)} disabled={saveEvaluacion.isPending} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">Guardar</button>
            </div>
            {(evaluaciones as any[]).length === 0 ? <p className="text-xs text-gray-400 italic">Sin evaluaciones cargadas.</p> : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {(evaluaciones as any[]).map(ev => (
                  <div key={ev.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1 text-gray-700 dark:text-gray-300">{[ev.empleado?.nombre, ev.empleado?.apellido].filter(Boolean).join(' ') || ev.empleado?.dni_rut}</span>
                    <span className="text-xs text-gray-400">{ev.periodo} · {ev.tipo}</span>
                    {ev.puntaje != null && <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ev.puntaje >= 7 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : ev.puntaje >= 4 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>{ev.puntaje}/10</span>}
                    {ev.comentarios && <span className="text-xs text-gray-400 truncate max-w-[200px]">{ev.comentarios}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RH7/F2+F3 — config portal del empleado + notificaciones (DUEÑO/ADMIN/RRHH) */}
          {(user?.rol === 'DUEÑO' || user?.rol === 'ADMIN' || user?.rol === 'RRHH') && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3 text-sm">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2"><Users2 size={15}/> Portal del empleado y notificaciones</h3>
              <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={!!(tenant as any)?.rrhh_portal_empleado}
                  onChange={async e => { const { data } = await supabase.from('tenants').update({ rrhh_portal_empleado: e.target.checked }).eq('id', tenant!.id).select().single(); if (data) setTenant(data as any) }} />
                Activar portal del empleado (auto-servicio: solicitar vacaciones + descargar recibos)
              </label>
              <div>
                <p className="text-xs text-gray-400 mb-1">Notificaciones del ciclo del empleado</p>
                <div className="flex flex-wrap gap-3">
                  {([['cumpleanos','Cumpleaños'],['aniversario','Aniversario'],['vacaciones_proximas','Vacaciones próximas'],['doc_vencer','Documento por vencer'],['contrato_vencer','Contrato por vencer']] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                      <input type="checkbox" checked={((tenant as any)?.rrhh_notif_config ?? {})[k] !== false}
                        onChange={async e => {
                          const cfg = { ...((tenant as any)?.rrhh_notif_config ?? {}), [k]: e.target.checked }
                          const { data } = await supabase.from('tenants').update({ rrhh_notif_config: cfg }).eq('id', tenant!.id).select().single()
                          if (data) setTenant(data as any)
                        }} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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
                    {supervisores
                      .filter((s) => s.id !== selectedEmpleado?.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {[s.nombre, s.apellido].filter(Boolean).join(' ')}
                        </option>
                      ))}
                  </select>

                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                      Usuario del sistema (opcional)
                      <span className="ml-1 text-gray-400 dark:text-gray-500">— vincular para habilitar "Mi Equipo" si es SUPERVISOR</span>
                    </label>
                    <select
                      value={formData.user_id ?? ''}
                      onChange={(e) => setFormData({ ...formData, user_id: e.target.value || null })}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg w-full"
                    >
                      <option value="">Sin vincular</option>
                      {tenantUsers.map((u) => {
                        const vinculadoOtro = empleados.find(e => e.user_id === u.id && e.id !== selectedEmpleado?.id)
                        const label = `${u.nombre_display || u.email} — ${u.rol}${vinculadoOtro ? ` · ya vinculado a ${nombreEmpleado(vinculadoOtro)}` : ''}`
                        return (
                          <option key={u.id} value={u.id} disabled={!!vinculadoOtro}>
                            {label}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  {/* RH1/A3 — tipo de contrato desde catálogo configurable */}
                  <div className="flex gap-1.5">
                    <select
                      value={formData.tipo_contrato ?? ''}
                      onChange={(e) => setFormData({ ...formData, tipo_contrato: e.target.value })}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                    >
                      <option value="">Tipo de contrato...</option>
                      {tiposContrato.filter(t => t.activo).map(t => (
                        <option key={t.id} value={t.nombre}>{t.nombre}</option>
                      ))}
                      {/* compat: tipos legacy del enum viejo */}
                      {formData.tipo_contrato && !tiposContrato.some(t => t.nombre === formData.tipo_contrato) && (
                        <option value={formData.tipo_contrato}>{formData.tipo_contrato}</option>
                      )}
                    </select>
                    <button type="button" onClick={agregarTipoContrato} title="Agregar tipo de contrato"
                      className="px-3 border border-gray-300 dark:border-gray-600 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20">+</button>
                  </div>

                  <input
                    type="number" onWheel={e => e.currentTarget.blur()}
                    placeholder="Salario bruto"
                    value={formData.salario_bruto ?? ''}
                    onChange={(e) => setFormData({ ...formData, salario_bruto: e.target.value ? parseFloat(e.target.value) : null })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />

                  {/* RH4/B1 — frecuencia de liquidación (prorratea el básico) */}
                  <div className="flex gap-1.5">
                    <select value={formData.frecuencia_liquidacion ?? 'mensual'} onChange={(e) => setFormData({ ...formData, frecuencia_liquidacion: e.target.value })}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg">
                      {FRECUENCIAS.map(f => <option key={f.v} value={f.v}>{f.t}</option>)}
                    </select>
                    {formData.frecuencia_liquidacion === 'personalizado' && (
                      <input type="number" onWheel={e => e.currentTarget.blur()} placeholder="días" value={formData.frecuencia_dias ?? ''}
                        onChange={(e) => setFormData({ ...formData, frecuencia_dias: e.target.value ? parseInt(e.target.value) : null })}
                        className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg" />
                    )}
                  </div>

                  {/* RH1/A4 — datos bancarios (opcionales) */}
                  <div className="col-span-2 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
                    <p className="col-span-2 text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><CreditCard size={13} /> Datos bancarios (opcional)</p>
                    <input type="text" placeholder="CBU" value={formData.cbu ?? ''}
                      onChange={(e) => setFormData({ ...formData, cbu: e.target.value })}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg" />
                    <input type="text" placeholder="Alias CBU" value={formData.alias_cbu ?? ''}
                      onChange={(e) => setFormData({ ...formData, alias_cbu: e.target.value })}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg" />
                    <input type="text" placeholder="Banco" value={formData.banco ?? ''}
                      onChange={(e) => setFormData({ ...formData, banco: e.target.value })}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg" />
                    <select value={formData.tipo_cuenta ?? ''}
                      onChange={(e) => setFormData({ ...formData, tipo_cuenta: e.target.value || null })}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg">
                      <option value="">Tipo de cuenta...</option>
                      <option value="caja_ahorro">Caja de ahorro</option>
                      <option value="cuenta_corriente">Cuenta corriente</option>
                    </select>
                    <input type="text" placeholder="Titular de la cuenta" value={formData.titular_cuenta ?? ''}
                      onChange={(e) => setFormData({ ...formData, titular_cuenta: e.target.value })}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg col-span-2" />
                  </div>

                  {/* RH6/D2 — horario de trabajo */}
                  <div className="col-span-2 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
                    <p className="col-span-2 text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><Clock size={13} /> Horario de trabajo (opcional)</p>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">Entrada</label>
                      <input type="time" value={formData.horario_entrada ?? ''} onChange={(e) => setFormData({ ...formData, horario_entrada: e.target.value || null })}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">Salida</label>
                      <input type="time" value={formData.horario_salida ?? ''} onChange={(e) => setFormData({ ...formData, horario_salida: e.target.value || null })}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg" />
                    </div>
                  </div>

                  {/* RH2/B4 — aportes activos del empleado + beneficios extra */}
                  <div className="col-span-2 border-t border-gray-100 dark:border-gray-700 pt-3 mt-1 space-y-2">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><DollarSign size={13} /> Aportes y beneficios (nómina)</p>
                    {conceptosAporte.length === 0 ? (
                      <p className="text-[11px] text-gray-400">No hay conceptos marcados como "aporte". Configurá los % en Nómina → Catálogo de conceptos.</p>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        {conceptosAporte.map(c => {
                          const activo = (formData.config_aportes ?? []).includes(c.id)
                          return (
                            <label key={c.id} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                              <input type="checkbox" checked={activo}
                                onChange={(e) => {
                                  const set = new Set(formData.config_aportes ?? [])
                                  if (e.target.checked) set.add(c.id); else set.delete(c.id)
                                  setFormData({ ...formData, config_aportes: [...set] })
                                }} />
                              {c.nombre}{c.default_pct ? ` (${c.default_pct}%)` : ''}
                            </label>
                          )
                        })}
                      </div>
                    )}
                    {/* Beneficios extra */}
                    <div className="space-y-1.5">
                      {(formData.beneficios_extra ?? []).map((b, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input type="text" placeholder="Beneficio" value={b.nombre}
                            onChange={(e) => setFormData({ ...formData, beneficios_extra: (formData.beneficios_extra ?? []).map((x, j) => j === i ? { ...x, nombre: e.target.value } : x) })}
                            className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs" />
                          <select value={b.tipo} onChange={(e) => setFormData({ ...formData, beneficios_extra: (formData.beneficios_extra ?? []).map((x, j) => j === i ? { ...x, tipo: e.target.value as 'monto' | 'porcentaje' } : x) })}
                            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs">
                            <option value="monto">$</option>
                            <option value="porcentaje">%</option>
                          </select>
                          <input type="number" onWheel={e => e.currentTarget.blur()} placeholder="Valor" value={b.valor}
                            onChange={(e) => setFormData({ ...formData, beneficios_extra: (formData.beneficios_extra ?? []).map((x, j) => j === i ? { ...x, valor: parseFloat(e.target.value) || 0 } : x) })}
                            className="w-24 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs" />
                          <button type="button" onClick={() => setFormData({ ...formData, beneficios_extra: (formData.beneficios_extra ?? []).filter((_, j) => j !== i) })}
                            className="text-red-500 text-xs">✕</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setFormData({ ...formData, beneficios_extra: [...(formData.beneficios_extra ?? []), { nombre: '', tipo: 'monto', valor: 0 }] })}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Beneficio extra</button>
                    </div>
                  </div>
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
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Usuario</th>
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
                      <td className="px-4 py-3 text-sm">
                        {(() => {
                          if (!emp.user_id) return <span className="text-gray-400 dark:text-gray-500">-</span>
                          const u = tenantUsers.find(x => x.id === emp.user_id)
                          const label = u ? (u.nombre_display || u.email) : 'Usuario'
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                              <UserCheck size={11} /> {label}
                            </span>
                          )
                        })()}
                      </td>
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
                          onClick={() => emp.activo
                            ? setBajaEmpleado({ id: emp.id, nombre: nombreEmpleado(emp), motivo: 'renuncia', fecha: format(new Date(), 'yyyy-MM-dd') })
                            : toggleEmpleadoActivo.mutate({ empId: emp.id })}
                          title={emp.activo ? 'Dar de baja' : 'Reactivar'}
                          className={`${emp.activo ? 'text-red-600 dark:text-red-400 hover:text-red-800 dark:text-red-400' : 'text-green-600 dark:text-green-400 hover:text-green-800 dark:text-green-400'}`}
                        >
                          {emp.activo ? <Trash2 size={16} /> : '✓'}
                        </button>
                        {/* RH8/A2-c — liquidación final (empleados dados de baja) */}
                        {!emp.activo && (
                          <button onClick={() => abrirLiqFinal(emp)} title="Liquidación final"
                            className="text-purple-600 dark:text-purple-400 hover:text-purple-800">
                            <FileText size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* RH1/A2 — Modal de baja con motivo */}
          {bajaEmpleado && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2"><UserX size={18} className="text-red-500" /> Dar de baja — {bajaEmpleado.nombre}</h3>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Motivo de egreso</label>
                  <select value={bajaEmpleado.motivo} onChange={e => setBajaEmpleado({ ...bajaEmpleado, motivo: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    <option value="renuncia">Renuncia</option>
                    <option value="despido_con_causa">Despido con causa</option>
                    <option value="despido_sin_causa">Despido sin causa</option>
                    <option value="fin_contrato">Fin de contrato</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Fecha de egreso</label>
                  <input type="date" value={bajaEmpleado.fecha} onChange={e => setBajaEmpleado({ ...bajaEmpleado, fecha: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <p className="text-[11px] text-gray-400">El empleado queda inactivo (soft delete). Se puede reactivar después. La liquidación final se calcula en Reportes (RH8).</p>
                <div className="flex gap-3">
                  <button onClick={() => setBajaEmpleado(null)}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:text-gray-300 text-sm">Cancelar</button>
                  <button onClick={() => { toggleEmpleadoActivo.mutate({ empId: bajaEmpleado.id, motivo: bajaEmpleado.motivo, fecha: bajaEmpleado.fecha }); setBajaEmpleado(null) }}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium">Dar de baja</button>
                </div>
              </div>
            </div>
          )}

          {/* RH8/A2-c — Modal de liquidación final */}
          {liqFinal && (() => {
            const r = liquidacionFinal({
              mejorSueldo: parseFloat(liqForm.mejorSueldo) || 0, antiguedadAnios: parseFloat(liqForm.antiguedadAnios) || 0,
              mesesFraccion: parseFloat(liqForm.mesesFraccion) || 0, mejorSueldoSemestre: parseFloat(liqForm.mejorSueldoSemestre) || 0,
              diasTrabajadosSemestre: parseFloat(liqForm.diasTrabajadosSemestre) || 0, diasVacacionesPendientes: parseFloat(liqForm.diasVacacionesPendientes) || 0,
              sueldoMensual: parseFloat(liqForm.sueldoMensual) || 0, conIndemnizacion: liqForm.conIndemnizacion,
            })
            const f$ = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
            return (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2"><FileText size={18} className="text-purple-500" /> Liquidación final — {nombreEmpleado(liqFinal)}</h3>
                  <p className="text-[11px] text-gray-400">Fórmula LCT (editable). Genera un gasto en Gastos (categoría Sueldos, pendiente).</p>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={liqForm.conIndemnizacion} onChange={e => setLiqForm({ ...liqForm, conIndemnizacion: e.target.checked })} />
                    Corresponde indemnización (despido sin causa / fin de contrato)
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      ['Mejor sueldo', 'mejorSueldo'], ['Antigüedad (años)', 'antiguedadAnios'], ['Meses fracción', 'mesesFraccion'],
                      ['Mejor sueldo semestre', 'mejorSueldoSemestre'], ['Días trab. en semestre', 'diasTrabajadosSemestre'],
                      ['Días vac. pendientes', 'diasVacacionesPendientes'], ['Sueldo mensual', 'sueldoMensual'],
                    ] as const).map(([label, key]) => (
                      <div key={key}>
                        <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
                        <input type="number" onWheel={e => e.currentTarget.blur()} value={(liqForm as any)[key]}
                          onChange={e => setLiqForm({ ...liqForm, [key]: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl bg-gray-50 dark:bg-gray-700/50 p-3 text-sm space-y-1">
                    <div className="flex justify-between"><span>Indemnización</span><span className="font-medium">{f$(r.indemnizacion)}</span></div>
                    <div className="flex justify-between"><span>SAC proporcional</span><span className="font-medium">{f$(r.sacProporcional)}</span></div>
                    <div className="flex justify-between"><span>Vacaciones no gozadas</span><span className="font-medium">{f$(r.vacacionesNoGozadas)}</span></div>
                    <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-1 mt-1 font-bold text-primary dark:text-white"><span>Total</span><span>{f$(r.total)}</span></div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setLiqFinal(null)} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300">Cancelar</button>
                    <button onClick={guardarLiqFinal} disabled={savingLiq} className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">{savingLiq ? 'Guardando…' : 'Registrar + generar gasto'}</button>
                  </div>
                </div>
              </div>
            )
          })()}
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
            {/* RH2/B5 — aguinaldo (SAC) */}
            <button onClick={() => generarSAC.mutate(1)} disabled={generarSAC.isPending}
              title="SAC 1er semestre (jun) = 50% del mejor sueldo"
              className="flex items-center gap-2 px-3 py-2 border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 text-sm">
              <DollarSign size={15} /> SAC 1° sem
            </button>
            <button onClick={() => generarSAC.mutate(2)} disabled={generarSAC.isPending}
              title="SAC 2do semestre (dic) = 50% del mejor sueldo"
              className="flex items-center gap-2 px-3 py-2 border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 text-sm">
              <DollarSign size={15} /> SAC 2° sem
            </button>
            {/* RH3/B7 — acumular cargas sociales del período en Gastos */}
            <button onClick={() => generarCargasSociales.mutate()} disabled={generarCargasSociales.isPending || salarios.length === 0}
              title="Acumular los aportes del período como gastos en Gastos (pendientes)"
              className="flex items-center gap-2 px-3 py-2 border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50 text-sm">
              <FileSpreadsheet size={15} /> Cargas sociales → Gastos
            </button>
            {/* RH3/B8 — doble validación (solo DUEÑO/ADMIN configura) */}
            {(user?.rol === 'DUEÑO' || user?.rol === 'ADMIN') && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 px-2" title="Si está activo, solo DUEÑO/ADMIN puede generar el gasto/pagar la nómina">
                <input type="checkbox" checked={!!(tenant as any)?.rrhh_nomina_doble_validacion}
                  onChange={async (e) => {
                    const v = e.target.checked
                    const { data } = await supabase.from('tenants').update({ rrhh_nomina_doble_validacion: v }).eq('id', tenant!.id).select().single()
                    if (data) setTenant(data as any)
                  }} />
                Doble validación
              </label>
            )}

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
                      {/* RH3 — recibo PDF + generar gasto (B6/B7) */}
                      <button onClick={() => descargarRecibo(sal)} title="Recibo de sueldo PDF"
                        className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <Download size={13}/> Recibo
                      </button>
                      {sal.gasto_id ? (
                        <span className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg text-xs font-medium" title="Gasto generado en módulo Gastos">
                          <FileSpreadsheet size={12}/> En Gastos
                        </span>
                      ) : (
                        <button onClick={() => generarGastoNomina.mutate(sal)} disabled={generarGastoNomina.isPending}
                          title="Generar el gasto en el módulo Gastos (pendiente de pago)"
                          className="flex items-center gap-1 px-2.5 py-1.5 border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 rounded-lg text-xs hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50">
                          <FileSpreadsheet size={12}/> Generar gasto
                        </button>
                      )}
                      {/* RH3/B6 — comprobante firmado (opcional) */}
                      <label title={sal.comprobante_firmado_url ? 'Comprobante firmado adjunto' : 'Adjuntar comprobante firmado'}
                        className={`flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs cursor-pointer ${sal.comprobante_firmado_url ? 'border-green-300 dark:border-green-700 text-green-600 dark:text-green-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                        <Paperclip size={12}/> {sal.comprobante_firmado_url ? 'Firmado ✓' : 'Firma'}
                        <input type="file" accept="image/*,application/pdf" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) subirComprobanteFirmado(sal, f); e.currentTarget.value = '' }} />
                      </label>
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
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                  <input type="text" placeholder="Nombre del concepto"
                    value={conceptoForm.nombre} onChange={(e) => setConceptoForm({ ...conceptoForm, nombre: e.target.value })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm col-span-2" />
                  <select value={conceptoForm.tipo} onChange={(e) => setConceptoForm({ ...conceptoForm, tipo: e.target.value as 'HABER' | 'DESCUENTO' })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                    <option value="HABER">Haber</option>
                    <option value="DESCUENTO">Descuento</option>
                  </select>
                  <select value={conceptoForm.tipo_calculo} onChange={(e) => setConceptoForm({ ...conceptoForm, tipo_calculo: e.target.value as any })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                    <option value="fijo">Monto fijo</option>
                    <option value="porcentaje">% del básico</option>
                    <option value="sobre_bruto">% sobre bruto</option>
                  </select>
                  {conceptoForm.tipo_calculo === 'fijo' ? (
                    <input type="number" onWheel={e => e.currentTarget.blur()} placeholder="Monto" value={conceptoForm.default_monto}
                      onChange={(e) => setConceptoForm({ ...conceptoForm, default_monto: e.target.value })}
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  ) : (
                    <input type="number" onWheel={e => e.currentTarget.blur()} placeholder="%" value={conceptoForm.default_pct}
                      onChange={(e) => setConceptoForm({ ...conceptoForm, default_pct: e.target.value })}
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={conceptoForm.es_aporte} onChange={(e) => setConceptoForm({ ...conceptoForm, es_aporte: e.target.checked })} />
                    Aporte (por empleado)
                  </label>
                  <div className="col-span-2 md:col-span-6 flex gap-2">
                    <button onClick={() => saveConcepto.mutate(conceptoForm)} disabled={saveConcepto.isPending || !conceptoForm.nombre.trim()}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {editingConcepto ? 'Actualizar' : 'Agregar'}
                    </button>
                    {editingConcepto && (
                      <button onClick={() => { setEditingConcepto(null); setConceptoForm({ nombre: '', tipo: 'HABER', tipo_calculo: 'fijo', default_pct: '', default_monto: '', es_aporte: false }) }}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
                {/* Lista */}
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {conceptos.map(c => (
                    <div key={c.id} className="flex items-center gap-3 py-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.tipo === 'HABER' ? 'bg-green-400' : 'bg-red-400'}`}/>
                      <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{c.nombre}
                        {c.es_aporte && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">aporte</span>}
                        {(c.default_pct || c.default_monto) && <span className="ml-1.5 text-xs text-gray-400">{c.default_pct ? `${c.default_pct}%` : `$${c.default_monto}`}</span>}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.tipo === 'HABER' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                        {c.tipo}
                      </span>
                      <button onClick={() => { setEditingConcepto(c); setConceptoForm({ nombre: c.nombre, tipo: c.tipo, tipo_calculo: c.tipo_calculo ?? 'fijo', default_pct: c.default_pct != null ? String(c.default_pct) : '', default_monto: c.default_monto != null ? String(c.default_monto) : '', es_aporte: !!c.es_aporte }) }}
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

          {/* RH4/B10 — Anticipos a empleados */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setShowAnticipos(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <span className="flex items-center gap-2"><DollarSign size={15}/> Anticipos / adelantos {(anticiposPend as any[]).length > 0 && <span className="text-xs px-1.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{(anticiposPend as any[]).length} pend.</span>}</span>
              <ChevronDown size={14} className={`transition-transform ${showAnticipos ? 'rotate-180' : ''}`} />
            </button>
            {showAnticipos && (
              <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <select value={anticipoForm.empleado_id} onChange={e => setAnticipoForm({ ...anticipoForm, empleado_id: e.target.value })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                    <option value="">Empleado...</option>
                    {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>)}
                  </select>
                  <input type="number" onWheel={e => e.currentTarget.blur()} placeholder="Monto" value={anticipoForm.monto} onChange={e => setAnticipoForm({ ...anticipoForm, monto: e.target.value })}
                    className="w-28 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  <input type="text" placeholder="Motivo (opcional)" value={anticipoForm.motivo} onChange={e => setAnticipoForm({ ...anticipoForm, motivo: e.target.value })}
                    className="flex-1 min-w-[140px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={anticipoForm.generaGasto} onChange={e => setAnticipoForm({ ...anticipoForm, generaGasto: e.target.checked })} /> Genera gasto
                  </label>
                  {/* L3 — préstamo formal con nota firmada */}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={anticipoForm.esPrestamo} onChange={e => setAnticipoForm({ ...anticipoForm, esPrestamo: e.target.checked, documento: e.target.checked ? anticipoForm.documento : null })} /> Es préstamo
                  </label>
                  <button onClick={() => registrarAnticipo.mutate(anticipoForm, { onSuccess: () => setAnticipoForm({ empleado_id: '', monto: '', motivo: '', generaGasto: true, esPrestamo: false, documento: null }) })} disabled={registrarAnticipo.isPending}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">Registrar</button>
                </div>
                {/* L3 — adjuntar la nota de préstamo firmada (colaborador + RRHH) */}
                {anticipoForm.esPrestamo && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                    <span className="font-medium">Préstamo:</span>
                    <span>se descuenta del próximo sueldo. Adjuntá la nota firmada por el colaborador y RRHH.</span>
                    <label className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 border border-amber-300 dark:border-amber-700 rounded-lg cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40">
                      <Paperclip size={12}/> {anticipoForm.documento ? anticipoForm.documento.name : 'Adjuntar nota firmada'}
                      <input type="file" accept="image/*,application/pdf" className="hidden"
                        onChange={e => setAnticipoForm({ ...anticipoForm, documento: e.target.files?.[0] ?? null })} />
                    </label>
                  </div>
                )}
                {(anticiposPend as any[]).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Sin anticipos pendientes. Se descuentan automáticamente al generar la próxima liquidación.</p>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {(anticiposPend as any[]).map(a => (
                      <div key={a.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="flex-1 text-gray-700 dark:text-gray-300">{[a.empleado?.nombre, a.empleado?.apellido].filter(Boolean).join(' ') || a.empleado?.dni_rut}</span>
                        {a.es_prestamo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium">Préstamo</span>}
                        {a.documento_url && <a href={a.documento_url} target="_blank" rel="noreferrer" title="Ver nota firmada" className="text-blue-500 hover:text-blue-600"><Paperclip size={13}/></a>}
                        <span className="text-gray-400 text-xs">{format(new Date(a.fecha + 'T00:00:00'), 'dd/MM')}</span>
                        {a.motivo && <span className="text-xs text-gray-400 truncate max-w-[160px]">{a.motivo}</span>}
                        <span className="font-medium text-amber-600 dark:text-amber-400">${Number(a.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                    ))}
                  </div>
                )}
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

          {/* RH5/C3+C6 — config de vacaciones (DUEÑO/RRHH) */}
          {(user?.rol === 'DUEÑO' || user?.rol === 'ADMIN' || user?.rol === 'RRHH') && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 flex flex-wrap items-end gap-4 text-sm">
              <span className="font-semibold text-gray-700 dark:text-gray-300">Reglas:</span>
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Plazo de aviso</label>
                <div className="flex gap-1.5">
                  <select value={(tenant as any)?.rrhh_vacaciones_aviso?.modo ?? 'alerta'}
                    onChange={async (e) => {
                      const aviso = { ...((tenant as any)?.rrhh_vacaciones_aviso ?? { dias: 30 }), modo: e.target.value }
                      const { data } = await supabase.from('tenants').update({ rrhh_vacaciones_aviso: aviso }).eq('id', tenant!.id).select().single()
                      if (data) setTenant(data as any)
                    }}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm">
                    <option value="sin">Sin plazo</option>
                    <option value="alerta">Solo alerta</option>
                    <option value="fijo">Bloquear</option>
                  </select>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={(tenant as any)?.rrhh_vacaciones_aviso?.dias ?? 30}
                    onChange={async (e) => {
                      const aviso = { ...((tenant as any)?.rrhh_vacaciones_aviso ?? { modo: 'alerta' }), dias: parseInt(e.target.value) || 0 }
                      const { data } = await supabase.from('tenants').update({ rrhh_vacaciones_aviso: aviso }).eq('id', tenant!.id).select().single()
                      if (data) setTenant(data as any)
                    }}
                    className="w-16 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm" title="días" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Remanente máx. arrastrable</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={(tenant as any)?.rrhh_vacaciones_remanente_max ?? 0}
                  onChange={async (e) => {
                    const { data } = await supabase.from('tenants').update({ rrhh_vacaciones_remanente_max: parseInt(e.target.value) || 0 }).eq('id', tenant!.id).select().single()
                    if (data) setTenant(data as any)
                  }}
                  className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm" title="0 = sin límite" />
              </div>
              <span className="text-[11px] text-gray-400">0 = sin límite. Las vacaciones se pagan dentro del sueldo del mes (C7).</span>
            </div>
          )}

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
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center justify-between">
                            Días totales asignados
                            {/* RH5/C1 — sugerencia por antigüedad LCT */}
                            {(() => {
                              const emp = editingSaldo.empleado ?? empleados.find(e => e.id === editingSaldo.empleado_id)
                              const ing = (emp as any)?.fecha_ingreso
                              if (!ing) return null
                              const sug = diasVacacionesLCT(antiguedadAnios(ing, `${vacAnio}-12-31`))
                              return <button type="button" onClick={() => setSaldoForm({ ...saldoForm, dias_totales: String(sug) })}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Sugerir LCT: {sug}d</button>
                            })()}
                          </label>
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={saldoForm.dias_totales}
                            onChange={(e) => setSaldoForm({ ...saldoForm, dias_totales: e.target.value })}
                            className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center justify-between">
                            Remanente del año anterior
                            {/* RH5/C6 — auto-calcular desde el saldo del año anterior */}
                            {(() => {
                              const prev = (vacSaldos as any[]).find(s => s.empleado_id === editingSaldo.empleado_id && s.anio === vacAnio - 1)
                              if (!prev) return null
                              const max = Number((tenant as any)?.rrhh_vacaciones_remanente_max ?? 0)
                              const rem = remanenteSiguiente(prev.dias_totales, prev.dias_usados, prev.remanente_anterior, max)
                              return <button type="button" onClick={() => setSaldoForm({ ...saldoForm, remanente_anterior: String(rem) })}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Auto: {rem}d{max > 0 ? ` (máx ${max})` : ''}</button>
                            })()}
                          </label>
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

          {/* RH6 — Fichado por QR público (kiosco). Solo DUEÑO/ADMIN/SUPER_USUARIO genera/rota el token. */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
              <QrCode size={15} className="text-accent" /> Fichado por QR (kiosco)
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              Imprimí el QR y dejalo en la entrada. Cada empleado lo escanea, toca su nombre y queda registrada la entrada/salida (sin login).
            </p>
            {!fichadoToken ? (
              esDuenoRrhh ? (
                <button onClick={() => generarFichadoToken()}
                  className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-semibold">
                  <QrCode size={16}/> Generar QR de fichado
                </button>
              ) : <p className="text-xs text-gray-400 italic">El QR lo genera el dueño.</p>
            ) : (
              <div className="flex flex-col sm:flex-row gap-5 items-start">
                {fichadoQr && (
                  <div className="text-center shrink-0">
                    <img src={fichadoQr} alt="QR de fichado" className="w-40 h-40 border border-gray-200 dark:border-gray-700 rounded-lg" />
                    <a href={fichadoQr} download="qr-fichado.png" className="text-xs text-accent hover:underline mt-1 inline-block">Descargar PNG</a>
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Link público del fichado</label>
                  <div className="flex gap-2">
                    <input readOnly value={fichadoLink}
                      className="flex-1 min-w-0 border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-2.5 py-1.5 text-xs" />
                    <button onClick={() => { navigator.clipboard.writeText(fichadoLink); toast.success('Link copiado') }}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700">
                      <Copy size={13}/> Copiar
                    </button>
                  </div>
                  {esDuenoRrhh && (
                    <button onClick={() => { if (confirm('¿Regenerar el QR? El QR actual dejará de funcionar.')) generarFichadoToken(true) }}
                      className="text-xs text-red-500 hover:text-red-600 hover:underline">
                      Regenerar QR (invalida el anterior)
                    </button>
                  )}
                </div>
              </div>
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
              setAsistForm({ empleado_id: '', fecha: format(new Date(), 'yyyy-MM-dd'), hora_entrada: '', hora_salida: '', estado: 'presente', motivo: '', tipo_licencia: '' })
              setShowAsistForm(true)
            }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
              <Plus size={16}/> Registrar asistencia
            </button>
          </div>

          {/* RH6/D5 — Horas extra */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><Clock size={15}/> Horas extra del mes</h3>
            <div className="flex flex-wrap gap-2 items-end mb-3">
              <select value={horaExtraForm.empleado_id} onChange={e => setHoraExtraForm({ ...horaExtraForm, empleado_id: e.target.value })}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                <option value="">Empleado...</option>
                {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{nombreEmpleado(e)}</option>)}
              </select>
              <input type="date" value={horaExtraForm.fecha} onChange={e => setHoraExtraForm({ ...horaExtraForm, fecha: e.target.value })}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm" />
              <input type="number" onWheel={e => e.currentTarget.blur()} placeholder="Horas" value={horaExtraForm.horas} onChange={e => setHoraExtraForm({ ...horaExtraForm, horas: e.target.value })}
                className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm" />
              <select value={horaExtraForm.multiplicador} onChange={e => setHoraExtraForm({ ...horaExtraForm, multiplicador: e.target.value })}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                <option value="50">+50%</option>
                <option value="100">+100%</option>
              </select>
              <button onClick={() => registrarHoraExtra.mutate(horaExtraForm)} disabled={registrarHoraExtra.isPending}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">Registrar</button>
            </div>
            {(horasExtra as any[]).length === 0 ? (
              <p className="text-xs text-gray-400 italic">Sin horas extra registradas este mes.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {(horasExtra as any[]).map(h => {
                  const sh = sueldoHora(Number(h.empleado?.salario_bruto) || 0, Number((tenant as any)?.rrhh_horas_mes_base ?? 200))
                  const monto = montoHorasExtra(Number(h.horas), sh, Number(h.multiplicador))
                  return (
                    <div key={h.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="flex-1 text-gray-700 dark:text-gray-300">{[h.empleado?.nombre, h.empleado?.apellido].filter(Boolean).join(' ') || h.empleado?.dni_rut}</span>
                      <span className="text-gray-400 text-xs">{format(new Date(h.fecha + 'T00:00:00'), 'dd/MM')}</span>
                      <span className="text-xs">{h.horas}h +{h.multiplicador}%</span>
                      <span className="font-medium text-gray-700 dark:text-gray-200">${monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      {h.aprobada ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Aprobada</span>
                      ) : (
                        <button onClick={() => aprobarHoraExtra.mutate(h.id)} className="text-xs px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20">Aprobar</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
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
                  {/* RH6/D4 — tipo de licencia */}
                  {asistForm.estado === 'licencia' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de licencia</label>
                      <select value={asistForm.tipo_licencia} onChange={(e) => setAsistForm({ ...asistForm, tipo_licencia: e.target.value })}
                        className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                        <option value="">Sin especificar</option>
                        {LICENCIA_TIPOS.map(l => <option key={l.v} value={l.v}>{l.t}</option>)}
                      </select>
                    </div>
                  )}
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
                                  setAsistForm({ empleado_id: a.empleado_id, fecha: a.fecha, hora_entrada: a.hora_entrada ?? '', hora_salida: a.hora_salida ?? '', estado: a.estado, motivo: a.motivo ?? '', tipo_licencia: (a as any).tipo_licencia ?? '' })
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
                  <button onClick={() => { setEditingFeriado(null); setFeriadoForm({ nombre: '', fecha: format(new Date(), 'yyyy-MM-dd'), tipo: 'nacional', regla_pago: 'doble' }); setShowFeriadoForm(true) }}
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
                      {/* RH6/D6 — regla de pago del feriado trabajado */}
                      <div className="col-span-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Pago si se trabaja</label>
                        <select value={feriadoForm.regla_pago} onChange={e => setFeriadoForm({ ...feriadoForm, regla_pago: e.target.value })}
                          className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white text-sm">
                          <option value="simple">Simple (x1)</option>
                          <option value="doble">Doble (x2)</option>
                          <option value="triple">Triple (x3)</option>
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
                            <button title="Editar" onClick={() => { setEditingFeriado(f); setFeriadoForm({ nombre: f.nombre, fecha: f.fecha, tipo: f.tipo, regla_pago: (f as any).regla_pago ?? 'doble' }); setShowFeriadoForm(true) }}
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
          {/* RH7/E1+E2 — catálogo de obligatorios + alerta de vencimiento */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5"><Star size={14}/> Documentos obligatorios (catálogo)</h3>
              <div className="flex gap-2 mb-2">
                <input type="text" placeholder="Ej. Contrato, DNI, Libreta..." value={catDocForm.nombre} onChange={e => setCatDocForm({ ...catDocForm, nombre: e.target.value })}
                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm dark:bg-gray-700 dark:text-white" />
                <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" checked={catDocForm.obligatorio} onChange={e => setCatDocForm({ ...catDocForm, obligatorio: e.target.checked })} /> Oblig.</label>
                <button onClick={() => saveCatDoc.mutate(catDocForm)} disabled={saveCatDoc.isPending} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">+</button>
              </div>
              {(docCatalogo as DocCatalogo[]).length === 0 ? <p className="text-xs text-gray-400 italic">Sin documentos requeridos definidos.</p> : (
                <div className="flex flex-wrap gap-1.5">
                  {(docCatalogo as DocCatalogo[]).map(c => (
                    <span key={c.id} className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${c.obligatorio ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                      {c.nombre}<button onClick={() => deleteCatDoc.mutate(c.id)} className="ml-0.5 hover:text-red-500">✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-500"/> Documentos por vencer</h3>
              {(() => {
                const docs = (documentos as Documento[]).map(d => ({ id: d.id, nombre: d.nombre, fecha_vencimiento: (d as any).fecha_vencimiento, empleado: [d.empleado?.nombre, d.empleado?.apellido].filter(Boolean).join(' ') }))
                const porVencer = documentosPorVencer(docs, new Date().toISOString().split('T')[0], Number((tenant as any)?.rrhh_doc_alerta_dias ?? 30))
                if (porVencer.length === 0) return <p className="text-xs text-gray-400 italic">Nada por vencer en los próximos {(tenant as any)?.rrhh_doc_alerta_dias ?? 30} días 🎉</p>
                return (
                  <div className="space-y-1">
                    {porVencer.map(d => (
                      <div key={d.id} className={`flex items-center justify-between text-xs rounded-lg px-2 py-1.5 ${d.diasRestantes < 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300' : 'bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-300'}`}>
                        <span>{d.empleado} · {d.nombre}</span>
                        <span>{d.diasRestantes < 0 ? `vencido hace ${-d.diasRestantes}d` : `en ${d.diasRestantes}d`}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>

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
                {/* RH7/E2 — fecha de vencimiento */}
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Vencimiento (opcional — libreta sanitaria, ART, contrato...)</label>
                  <input type="date" value={docForm.fecha_vencimiento} onChange={(e) => setDocForm({ ...docForm, fecha_vencimiento: e.target.value })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white w-full sm:w-auto" />
                </div>
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
                  onClick={() => { setShowDocForm(false); setDocForm({ empleado_id: '', nombre: '', descripcion: '', tipo: 'otro', file: null, fecha_vencimiento: '' }) }}
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
              onClick={() => { setEditingCap(null); setCapForm({ empleado_id: '', nombre: '', descripcion: '', fecha_inicio: '', fecha_fin: '', horas: '', proveedor: '', estado: 'planificada', resultado: '', certFile: null, obligatoria: false }); setShowCapForm(true) }}
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
                {/* RH7/E3 — obligatoria por puesto */}
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 px-1">
                  <input type="checkbox" checked={capForm.obligatoria} onChange={(e) => setCapForm({ ...capForm, obligatoria: e.target.checked })} />
                  Obligatoria (alerta si falta)
                </label>
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
                if (e.supervisor_id && e.supervisor) {
                  supNombres[e.supervisor_id] = [e.supervisor.nombre, e.supervisor.apellido].filter(Boolean).join(' ')
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
