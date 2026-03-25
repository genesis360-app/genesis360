import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Edit, Search, Users2,
  Building2, Briefcase, Calendar, ChevronDown, Heart, AlertTriangle,
  DollarSign, CreditCard, ChevronRight, CheckCircle, Clock,
  Plane, ClipboardList, Check, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'
import { differenceInDays, format } from 'date-fns'
import { es } from 'date-fns/locale'

type Tab = 'empleados' | 'puestos' | 'departamentos' | 'cumpleanos' | 'nomina' | 'vacaciones' | 'asistencia'
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

export default function RrhhPage() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('empleados')
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [selectedEmpleado, setSelectedEmpleado] = useState<Empleado | null>(null)
  const [editingPuesto, setEditingPuesto] = useState<Puesto | null>(null)
  const [editingDepartamento, setEditingDepartamento] = useState<Departamento | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Form state
  const [formData, setFormData] = useState<Partial<Empleado>>({
    dni_rut: '',
    tipo_doc: 'DNI',
    genero: 'OTRO',
    fecha_ingreso: format(new Date(), 'yyyy-MM-dd'),
    tipo_contrato: 'INDEFINIDO',
    activo: true,
  })
  const [puestoForm, setPuestoForm] = useState<Partial<Puesto>>({ nombre: '', activo: true })
  const [deptForm, setDeptForm] = useState<Partial<Departamento>>({ nombre: '', activo: true })

  // Nómina state
  const [nominaMes, setNominaMes] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
  const [nominaAnio, setNominaAnio] = useState(() => String(new Date().getFullYear()))
  const [expandedSalario, setExpandedSalario] = useState<string | null>(null)
  const [showConceptoForm, setShowConceptoForm] = useState(false)
  const [editingConcepto, setEditingConcepto] = useState<Concepto | null>(null)
  const [conceptoForm, setConceptoForm] = useState<{ nombre: string; tipo: 'HABER' | 'DESCUENTO' }>({ nombre: '', tipo: 'HABER' })
  const [newItem, setNewItem] = useState<{ descripcion: string; tipo: 'HABER' | 'DESCUENTO'; monto: string; concepto_id: string }>({ descripcion: '', tipo: 'HABER', monto: '', concepto_id: '' })
  const [cajaSessionId, setCajaSessionId] = useState<string>('')

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

  // Mutations
  const saveEmpleado = useMutation({
    mutationFn: async (data: Partial<Empleado>) => {
      if (formMode === 'crear') {
        const { error } = await supabase.from('empleados').insert({
          tenant_id: tenant!.id,
          ...data,
        })
        if (error) throw error
        logActividad({
          entidad: 'empleado',
          entidad_id: '',
          entidad_nombre: data.dni_rut ?? 'Nuevo empleado',
          accion: 'crear',
          pagina: '/rrhh',
        })
      } else if (selectedEmpleado) {
        const { error } = await supabase
          .from('empleados')
          .update(data)
          .eq('id', selectedEmpleado.id)
        if (error) throw error
        logActividad({
          entidad: 'empleado',
          entidad_id: selectedEmpleado.id,
          entidad_nombre: selectedEmpleado.dni_rut,
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
        entidad_nombre: emp.dni_rut,
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
      logActividad({ entidad: 'nomina', entidad_id: id, entidad_nombre: emp.dni_rut, accion: 'crear', pagina: '/rrhh' })
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
      })
      if (error) throw error
      return data
    },
    onSuccess: (_, salarioId) => {
      toast.success('Nómina pagada')
      const sal = salarios.find((s) => s.id === salarioId)
      logActividad({ entidad: 'nomina', entidad_id: salarioId, entidad_nombre: sal?.empleado?.dni_rut ?? '', accion: 'pagar', pagina: '/rrhh' })
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
      logActividad({ entidad: 'vacacion', entidad_nombre: emp?.dni_rut ?? '', accion: 'crear', pagina: '/rrhh' })
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

  // Cumppleaños - filter empleados de este mes
  const cumpleanosMes = empleados
    .filter((e) => {
      if (!e.fecha_nacimiento || !e.activo) return false
      const today = new Date()
      const birthDate = new Date(e.fecha_nacimiento)
      return (
        birthDate.getMonth() === today.getMonth()
      )
    })
    .sort((a, b) => {
      const today = new Date()
      const daysToA = differenceInDays(
        new Date(a.fecha_nacimiento!),
        today
      )
      const daysToB = differenceInDays(
        new Date(b.fecha_nacimiento!),
        today
      )
      return daysToA - daysToB
    })

  const filteredEmpleados = empleados.filter((e) =>
    e.dni_rut.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.activo.toString().includes(searchTerm.toLowerCase())
  )

  if (user?.rol !== 'OWNER' && user?.rol !== 'RRHH') {
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
        {(['empleados', 'puestos', 'departamentos', 'cumpleanos', 'nomina', 'vacaciones', 'asistencia'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); resetForm() }}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'empleados'    && 'Empleados'}
            {tab === 'puestos'      && 'Puestos'}
            {tab === 'departamentos' && 'Departamentos'}
            {tab === 'cumpleanos'   && '🎂 Cumpleaños'}
            {tab === 'nomina'       && <span className="flex items-center gap-1"><DollarSign size={14}/>Nómina</span>}
            {tab === 'vacaciones'   && <span className="flex items-center gap-1"><Plane size={14}/>Vacaciones</span>}
            {tab === 'asistencia'   && <span className="flex items-center gap-1"><ClipboardList size={14}/>Asistencia</span>}
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
                    onChange={(e) => setFormData({ ...formData, puesto_id: e.target.value || null })}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="">Selecciona puesto...</option>
                    {puestos.filter((p) => p.activo).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
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
                    type="number"
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
                      <td className="px-4 py-3 text-sm font-medium">{emp.dni_rut}</td>
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
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={18} />
              Nuevo Puesto
            </button>
          </div>

          {/* Form modal inline */}
          {editingPuesto === null && puestoForm.nombre === '' ? null : (
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
                  type="number"
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
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={18} />
              Nuevo Departamento
            </button>
          </div>

          {/* Form modal inline */}
          {editingDepartamento === null && deptForm.nombre === '' ? null : (
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
            <input type="number" value={nominaAnio} onChange={(e) => setNominaAnio(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm w-24" />
            <button
              onClick={() => generarNominaMes.mutate()}
              disabled={generarNominaMes.isPending || empleados.filter(e => e.activo).length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <Plus size={16} /> Generar nómina del mes
            </button>

            {/* Selector caja */}
            {cajaSesiones.length > 0 && (
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-gray-500 dark:text-gray-400" />
                <select value={cajaSessionId} onChange={(e) => setCajaSessionId(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm">
                  <option value="">Seleccionar caja...</option>
                  {cajaSesiones.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.cajas?.nombre ?? 'Caja'}</option>
                  ))}
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
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{sal.empleado?.dni_rut ?? sal.empleado_id}</p>
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
                      <div className="ml-2">
                        {sal.pagado ? (
                          <span className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-xs font-medium">
                            <CheckCircle size={12}/> Pagado
                          </span>
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
                            <input type="number" placeholder="Monto" value={newItem.monto}
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
                      <Plus size={13}/> {emp.dni_rut}
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

        </div>
      )}

      {/* VACACIONES TAB */}
      {activeTab === 'vacaciones' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Año:</label>
              <input type="number" value={vacAnio} onChange={(e) => setVacAnio(parseInt(e.target.value))}
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
                      {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.dni_rut}</option>)}
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
                        <p className="font-medium text-sm text-gray-900 dark:text-white">{sol.empleado?.dni_rut}</p>
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
                        Saldo {vacAnio} — {editingSaldo.empleado?.dni_rut ?? empleados.find(e => e.id === editingSaldo.empleado_id)?.dni_rut}
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Días totales asignados</label>
                          <input type="number" min="0" value={saldoForm.dias_totales}
                            onChange={(e) => setSaldoForm({ ...saldoForm, dias_totales: e.target.value })}
                            className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2" />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Remanente del año anterior</label>
                          <input type="number" min="0" value={saldoForm.remanente_anterior}
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
                            <td className="px-4 py-2 text-gray-900 dark:text-white font-medium">{emp.dni_rut}</td>
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
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mes:</label>
              <input type="month" value={asistFecha} onChange={(e) => setAsistFecha(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm" />
              <select value={asistFiltroEmpleado} onChange={(e) => setAsistFiltroEmpleado(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm">
                <option value="">Todos los empleados</option>
                {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.dni_rut}</option>)}
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
                        {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.dni_rut}</option>)}
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
                            <td className="px-4 py-2 text-gray-900 dark:text-white font-medium">{a.empleado?.dni_rut}</td>
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
        <div>
          <div className="grid gap-4">
            {cumpleanosMes.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">No hay cumpleaños este mes</div>
            ) : (
              cumpleanosMes.map((emp) => {
                const today = new Date()
                const birthDate = new Date(emp.fecha_nacimiento!)
                const daysToNext = differenceInDays(
                  new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate()),
                  today
                )
                let badgeColor = 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                if (daysToNext === 0) badgeColor = 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                else if (daysToNext <= 7) badgeColor = 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'

                return (
                  <div key={emp.id} className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 hover:shadow-md transition">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <Heart className="text-red-500" size={24} />
                          <div>
                            <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{emp.dni_rut}</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">{emp.departamento?.nombre || 'Sin departamento'}</p>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Próximo cumpleaños:</p>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {format(new Date(emp.fecha_nacimiento!), 'dd MMMM', { locale: es })}
                        </p>
                        <span className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium ${badgeColor}`}>
                          {daysToNext === 0 ? '¡Hoy!' : `En ${daysToNext} días`}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
