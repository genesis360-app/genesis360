import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Edit, Search, Mail, Phone, MapPin, Users2,
  Building2, Briefcase, Calendar, ChevronDown, Heart, AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'
import { differenceInDays, format } from 'date-fns'
import { es } from 'date-fns/locale'

type Tab = 'empleados' | 'puestos' | 'departamentos' | 'cumpleanos'
type FormMode = 'crear' | 'editar' | null

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
      <div className="p-8 text-center text-gray-500">
        No tienes permisos para acceder a este módulo
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
          <Users2 size={32} className="text-blue-600" />
          Gestión de Empleados
        </h1>
        <p className="text-gray-600 mt-2">Administra tu equipo de trabajo</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 border-b border-gray-200">
        {(['empleados', 'puestos', 'departamentos', 'cumpleanos'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab)
              resetForm()
            }}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-800'
            }`}
          >
            {tab === 'empleados' && 'Empleados'}
            {tab === 'puestos' && 'Puestos'}
            {tab === 'departamentos' && 'Departamentos'}
            {tab === 'cumpleanos' && '🎂 Cumpleaños'}
          </button>
        ))}
      </div>

      {/* EMPLEADOS TAB */}
      {activeTab === 'empleados' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3 flex-1">
              <Search size={20} className="text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por DNI o estado..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg flex-1"
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
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <h2 className="text-2xl font-bold mb-6">
                  {formMode === 'crear' ? 'Nuevo Empleado' : 'Editar Empleado'}
                </h2>

                <div className="grid grid-cols-2 gap-4">
                  {/* DNI */}
                  <input
                    type="text"
                    placeholder="DNI/RUT *"
                    value={formData.dni_rut ?? ''}
                    onChange={(e) => setFormData({ ...formData, dni_rut: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <select
                    value={formData.tipo_doc ?? 'DNI'}
                    onChange={(e) => setFormData({ ...formData, tipo_doc: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
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
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <input
                    type="email"
                    placeholder="Email personal"
                    value={formData.email_personal ?? ''}
                    onChange={(e) => setFormData({ ...formData, email_personal: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                  />

                  {/* Personales */}
                  <select
                    value={formData.genero ?? 'OTRO'}
                    onChange={(e) => setFormData({ ...formData, genero: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
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
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                  />

                  <input
                    type="text"
                    placeholder="Dirección"
                    value={formData.direccion ?? ''}
                    onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg col-span-2"
                  />

                  <input
                    type="tel"
                    placeholder="Teléfono emergencia (FON)"
                    value={formData.fon ?? ''}
                    onChange={(e) => setFormData({ ...formData, fon: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg col-span-2"
                  />

                  {/* Laboral */}
                  <input
                    type="date"
                    placeholder="Fecha ingreso *"
                    value={formData.fecha_ingreso ?? ''}
                    onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <input
                    type="date"
                    placeholder="Fecha egreso"
                    value={formData.fecha_egreso ?? ''}
                    onChange={(e) => setFormData({ ...formData, fecha_egreso: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                  />

                  <select
                    value={formData.puesto_id ?? ''}
                    onChange={(e) => setFormData({ ...formData, puesto_id: e.target.value || null })}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
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
                    className="px-4 py-2 border border-gray-300 rounded-lg"
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
                    className="px-4 py-2 border border-gray-300 rounded-lg col-span-2"
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
                    className="px-4 py-2 border border-gray-300 rounded-lg"
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
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                {/* Buttons */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleGuardarEmpleado}
                    disabled={saveEmpleado.isPending}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saveEmpleado.isPending ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    onClick={resetForm}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
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
            <div className="text-center py-8 text-gray-500">No hay empleados registrados</div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">DNI</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Teléfono</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Puesto</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Departamento</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Ingreso</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Estado</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredEmpleados.map((emp) => (
                    <tr key={emp.id} className={!emp.activo ? 'bg-gray-50 opacity-60' : ''}>
                      <td className="px-4 py-3 text-sm font-medium">{emp.dni_rut}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{emp.tel_personal || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{emp.puesto?.nombre || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{emp.departamento?.nombre || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(emp.fecha_ingreso), 'dd/MM/yyyy', { locale: es })}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${emp.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {emp.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm flex gap-2">
                        <button
                          onClick={() => handleEditEmpleado(emp)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => toggleEmpleadoActivo.mutate(emp.id)}
                          className={`${emp.activo ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}`}
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
            <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
              <h3 className="text-lg font-semibold mb-4">{editingPuesto ? 'Editar Puesto' : 'Crear Puesto'}</h3>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Nombre del puesto"
                  value={puestoForm.nombre ?? ''}
                  onChange={(e) => setPuestoForm({ ...puestoForm, nombre: e.target.value })}
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="number"
                  placeholder="Salario sugerido"
                  value={puestoForm.salario_base_sugerido ?? ''}
                  onChange={(e) =>
                    setPuestoForm({ ...puestoForm, salario_base_sugerido: e.target.value ? parseFloat(e.target.value) : null })
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Descripción"
                  value={puestoForm.descripcion ?? ''}
                  onChange={(e) => setPuestoForm({ ...puestoForm, descripcion: e.target.value })}
                  className="px-4 py-2 border border-gray-300 rounded-lg col-span-2"
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
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de puestos */}
          <div className="grid gap-4">
            {puestos.map((p) => (
              <div key={p.id} className={`p-4 border rounded-lg ${!p.activo ? 'bg-gray-50' : 'bg-white'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900">{p.nombre}</h4>
                    {p.descripcion && <p className="text-sm text-gray-600">{p.descripcion}</p>}
                    {p.salario_base_sugerido && <p className="text-sm text-gray-500">Salario sugerido: ${p.salario_base_sugerido}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingPuesto(p)
                        setPuestoForm(p)
                      }}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('¿Estás seguro?')) deletePuesto.mutate(p.id)
                      }}
                      className="text-red-600 hover:text-red-800"
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
            <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
              <h3 className="text-lg font-semibold mb-4">{editingDepartamento ? 'Editar Departamento' : 'Crear Departamento'}</h3>
              <div className="grid grid-cols-1 gap-4">
                <input
                  type="text"
                  placeholder="Nombre del departamento"
                  value={deptForm.nombre ?? ''}
                  onChange={(e) => setDeptForm({ ...deptForm, nombre: e.target.value })}
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Descripción"
                  value={deptForm.descripcion ?? ''}
                  onChange={(e) => setDeptForm({ ...deptForm, descripcion: e.target.value })}
                  className="px-4 py-2 border border-gray-300 rounded-lg"
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
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de departamentos */}
          <div className="grid gap-4">
            {departamentos.map((d) => (
              <div key={d.id} className={`p-4 border rounded-lg ${!d.activo ? 'bg-gray-50' : 'bg-white'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900">{d.nombre}</h4>
                    {d.descripcion && <p className="text-sm text-gray-600">{d.descripcion}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingDepartamento(d)
                        setDeptForm(d)
                      }}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('¿Estás seguro?')) deleteDepartamento.mutate(d.id)
                      }}
                      className="text-red-600 hover:text-red-800"
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

      {/* CUMPLEANOS TAB */}
      {activeTab === 'cumpleanos' && (
        <div>
          <div className="grid gap-4">
            {cumpleanosMes.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No hay cumpleaños este mes</div>
            ) : (
              cumpleanosMes.map((emp) => {
                const today = new Date()
                const birthDate = new Date(emp.fecha_nacimiento!)
                const daysToNext = differenceInDays(
                  new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate()),
                  today
                )
                let badgeColor = 'bg-gray-100 text-gray-700'
                if (daysToNext === 0) badgeColor = 'bg-red-100 text-red-700'
                else if (daysToNext <= 7) badgeColor = 'bg-yellow-100 text-yellow-700'

                return (
                  <div key={emp.id} className="p-6 border border-gray-200 rounded-lg bg-white hover:shadow-md transition">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <Heart className="text-red-500" size={24} />
                          <div>
                            <h3 className="font-semibold text-lg text-gray-900">{emp.dni_rut}</h3>
                            <p className="text-sm text-gray-600">{emp.departamento?.nombre || 'Sin departamento'}</p>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Próximo cumpleaños:</p>
                        <p className="font-semibold text-gray-900">
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
