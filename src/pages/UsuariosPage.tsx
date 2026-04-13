import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, Trash2, Shield, User, Mail, AlertTriangle,
  ChevronDown, ChevronUp, Check, X as XIcon, Plus, Edit, Sliders,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import toast from 'react-hot-toast'

type UserRole = 'OWNER' | 'SUPERVISOR' | 'CAJERO' | 'RRHH' | 'CONTADOR' | 'DEPOSITO'
const ROLES: Record<UserRole, { label: string; desc: string; color: string }> = {
  OWNER:      { label: 'Dueño',      desc: 'Acceso completo',                    color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
  SUPERVISOR: { label: 'Supervisor', desc: 'Inventario y movimientos',           color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'        },
  CAJERO:     { label: 'Cajero',     desc: 'Solo ventas y caja',                 color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'     },
  RRHH:       { label: 'RRHH',       desc: 'Gestión de empleados',               color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'     },
  CONTADOR:   { label: 'Contador',   desc: 'Dashboard, gastos y reportes',       color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400'         },
  DEPOSITO:   { label: 'Depósito',   desc: 'Productos e inventario',             color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
}

type Permiso = 'no_ver' | 'ver' | 'editar'
interface RolCustom {
  id: string
  tenant_id: string
  nombre: string
  permisos: Record<string, Permiso>
  activo: boolean
  created_at: string
}

const MODULOS: { key: string; label: string }[] = [
  { key: 'ventas',        label: 'Ventas' },
  { key: 'caja',          label: 'Caja' },
  { key: 'gastos',        label: 'Gastos' },
  { key: 'clientes',      label: 'Clientes' },
  { key: 'inventario',    label: 'Inventario' },
  { key: 'movimientos',   label: 'Movimientos stock' },
  { key: 'alertas',       label: 'Alertas' },
  { key: 'reportes',      label: 'Reportes' },
  { key: 'historial',     label: 'Historial actividad' },
  { key: 'metricas',      label: 'Métricas' },
  { key: 'importar',      label: 'Importar datos' },
  { key: 'rrhh',          label: 'RRHH' },
  { key: 'configuracion', label: 'Configuración' },
  { key: 'usuarios',      label: 'Usuarios' },
  { key: 'sucursales',    label: 'Sucursales' },
]

const PERMISO_LABELS: Record<Permiso, string> = { no_ver: 'No ver', ver: 'Ver', editar: 'Editar' }
const PERMISO_COLORS: Record<Permiso, string> = {
  no_ver: 'bg-gray-100 dark:bg-gray-700 text-gray-400',
  ver:    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  editar: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
}

function defaultPermisos(): Record<string, Permiso> {
  return Object.fromEntries(MODULOS.map(m => [m.key, 'no_ver' as Permiso]))
}

export default function UsuariosPage() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const { limits } = usePlanLimits()
  const [showInvitar, setShowInvitar] = useState(false)
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [invEmail, setInvEmail] = useState('')
  const [invRol, setInvRol] = useState<UserRole>('CAJERO')
  const [saving, setSaving] = useState(false)
  const [filterRol, setFilterRol] = useState<UserRole | 'TODOS'>('TODOS')
  const [showPermisos, setShowPermisos] = useState(false)

  // Roles custom state
  const [showRolesSection, setShowRolesSection] = useState(false)
  const [showRolForm, setShowRolForm] = useState(false)
  const [editingRol, setEditingRol] = useState<RolCustom | null>(null)
  const [rolNombre, setRolNombre] = useState('')
  const [rolPermisos, setRolPermisos] = useState<Record<string, Permiso>>(defaultPermisos)
  const [expandedRolId, setExpandedRolId] = useState<string | null>(null)

  // Per-user permisos modal
  const [userPermisosTarget, setUserPermisosTarget] = useState<any | null>(null)
  const [userPermisosData, setUserPermisosData] = useState<Record<string, Permiso>>(defaultPermisos)

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['usuarios', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('users')
        .select('*').eq('tenant_id', tenant!.id).order('created_at')
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: rolesCustom = [], refetch: refetchRoles } = useQuery({
    queryKey: ['roles_custom', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles_custom')
        .select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      if (error) throw error
      return (data ?? []) as RolCustom[]
    },
    enabled: !!tenant,
  })

  const handleInvitar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invEmail.trim()) { toast.error('Ingresá el email del usuario'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email: invEmail.trim(), rol: invRol, tenant_id: tenant!.id },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast.success(`Invitación enviada a ${invEmail}. El usuario recibirá un link para crear su contraseña.`)
      logActividad({ entidad: 'usuario', entidad_nombre: invEmail.split('@')[0], accion: 'crear', valor_nuevo: invRol, pagina: '/usuarios' })
      setInvEmail(''); setShowInvitar(false)
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      qc.invalidateQueries({ queryKey: ['plan-limits'] })
    } catch (err: any) {
      toast.error(err.message ?? 'Error al enviar la invitación')
    } finally {
      setSaving(false)
    }
  }

  useModalKeyboard({
    isOpen: showInvitar,
    onClose: () => setShowInvitar(false),
    onConfirm: () => { if (!saving) handleInvitar({ preventDefault: () => {} } as React.FormEvent) },
  })

  const updateRol = useMutation({
    mutationFn: async ({ userId, rol, rolAnterior, nombreUsuario }: { userId: string; rol: UserRole; rolAnterior?: string; nombreUsuario?: string }) => {
      const { error } = await supabase.from('users').update({ rol, rol_custom_id: null }).eq('id', userId)
      if (error) throw error
      logActividad({ entidad: 'usuario', entidad_id: userId, entidad_nombre: nombreUsuario, accion: 'editar', campo: 'rol', valor_anterior: rolAnterior ?? null, valor_nuevo: rol, pagina: '/usuarios' })
    },
    onSuccess: () => { toast.success('Rol actualizado'); qc.invalidateQueries({ queryKey: ['usuarios'] }) },
    onError: () => toast.error('Error al actualizar rol'),
  })

  const assignRolCustom = useMutation({
    mutationFn: async ({ userId, rolCustomId, nombreUsuario }: { userId: string; rolCustomId: string | null; nombreUsuario?: string }) => {
      const { error } = await supabase.from('users').update({ rol_custom_id: rolCustomId }).eq('id', userId)
      if (error) throw error
      logActividad({ entidad: 'usuario', entidad_id: userId, entidad_nombre: nombreUsuario, accion: 'editar', campo: 'rol_custom_id', valor_nuevo: rolCustomId ?? 'ninguno', pagina: '/usuarios' })
    },
    onSuccess: () => { toast.success('Rol personalizado asignado'); qc.invalidateQueries({ queryKey: ['usuarios'] }) },
    onError: () => toast.error('Error al asignar rol'),
  })

  const desactivar = useMutation({
    mutationFn: async (userId: string) => {
      if (userId === user?.id) throw new Error('No podés desactivar tu propio usuario')
      const u = (usuarios as any[]).find(x => x.id === userId)
      const { error } = await supabase.from('users').update({ activo: false }).eq('id', userId)
      if (error) throw error
      logActividad({ entidad: 'usuario', entidad_id: userId, entidad_nombre: u?.nombre_display, accion: 'eliminar', pagina: '/usuarios' })
    },
    onSuccess: () => {
      toast.success('Usuario desactivado')
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      qc.invalidateQueries({ queryKey: ['plan-limits'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const saveRolCustom = useMutation({
    mutationFn: async () => {
      if (!rolNombre.trim()) throw new Error('Ingresá el nombre del rol')
      const payload = { tenant_id: tenant!.id, nombre: rolNombre.trim(), permisos: rolPermisos, activo: true }
      if (editingRol) {
        const { error } = await supabase.from('roles_custom').update(payload).eq('id', editingRol.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('roles_custom').insert({ id: crypto.randomUUID(), ...payload })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingRol ? 'Rol actualizado' : 'Rol creado')
      setShowRolForm(false); setEditingRol(null)
      setRolNombre(''); setRolPermisos(defaultPermisos())
      refetchRoles()
    },
    onError: (err: any) => toast.error(err.message ?? 'Error'),
  })

  const deleteRolCustom = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('roles_custom').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Rol eliminado'); refetchRoles() },
    onError: () => toast.error('Error al eliminar'),
  })

  const saveUserPermisos = useMutation({
    mutationFn: async () => {
      if (!userPermisosTarget) return
      const u = userPermisosTarget
      if (u.rol_custom_id) {
        const { error } = await supabase.from('roles_custom').update({ permisos: userPermisosData }).eq('id', u.rol_custom_id)
        if (error) throw error
      } else {
        const newId = crypto.randomUUID()
        const { error: insErr } = await supabase.from('roles_custom').insert({
          id: newId, tenant_id: tenant!.id,
          nombre: `${u.nombre_display ?? u.id.slice(0,6)} (custom)`,
          permisos: userPermisosData, activo: true,
        })
        if (insErr) throw insErr
        const { error: updErr } = await supabase.from('users').update({ rol_custom_id: newId }).eq('id', u.id)
        if (updErr) throw updErr
      }
      logActividad({ entidad: 'usuario', entidad_id: u.id, entidad_nombre: u.nombre_display, accion: 'editar', campo: 'permisos_custom', pagina: '/usuarios' })
    },
    onSuccess: () => {
      toast.success('Permisos actualizados')
      setUserPermisosTarget(null)
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      refetchRoles()
    },
    onError: (e: any) => toast.error(e.message ?? 'Error'),
  })

  function openUserPermisos(u: any) {
    const rolCustom = rolesCustom.find(r => r.id === u.rol_custom_id)
    setUserPermisosData({ ...defaultPermisos(), ...(rolCustom?.permisos ?? {}) })
    setUserPermisosTarget(u)
  }

  const canManage = user?.rol === 'OWNER'

  const usuariosFiltrados = filterRol === 'TODOS'
    ? (usuarios as any[])
    : (usuarios as any[]).filter(u => u.rol === filterRol)

  const PERMISOS: Record<string, Partial<Record<UserRole, boolean>>> = {
    'Ver inventario':       { OWNER: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: true  },
    'Movimientos de stock': { OWNER: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: true  },
    'Ventas y caja':        { OWNER: true,  SUPERVISOR: true,  CAJERO: true,  RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Gastos':               { OWNER: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: true,  DEPOSITO: false },
    'Clientes':             { OWNER: true,  SUPERVISOR: true,  CAJERO: true,  RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Reportes e historial': { OWNER: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: true,  DEPOSITO: false },
    'Métricas e insights':  { OWNER: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: true,  DEPOSITO: false },
    'Importar datos':       { OWNER: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Configuración':        { OWNER: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Usuarios':             { OWNER: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
    'RRHH (empleados)':     { OWNER: true,  SUPERVISOR: false, CAJERO: false, RRHH: true,  CONTADOR: false, DEPOSITO: false },
    'Sucursales':           { OWNER: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
  }

  function formatFechaCorta(iso: string) {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const cyclePermiso = (modulo: string) => {
    const order: Permiso[] = ['no_ver', 'ver', 'editar']
    const current = rolPermisos[modulo] ?? 'no_ver'
    const next = order[(order.indexOf(current) + 1) % order.length]
    setRolPermisos(prev => ({ ...prev, [modulo]: next }))
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {showLimitModal && limits && (
        <PlanLimitModal tipo="usuario" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Usuarios</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Gestioná el equipo de tu negocio</p>
        </div>
        {canManage && !showInvitar && (
          <button
            onClick={() => {
              if (limits && !limits.puede_crear_usuario) {
                setShowLimitModal(true)
              } else {
                setShowInvitar(true)
              }
            }}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <UserPlus size={16} /> Agregar usuario
          </button>
        )}
      </div>

      {/* Barra de uso */}
      {limits && limits.max_usuarios < 999 && (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm
          ${limits.pct_usuarios >= 90 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'}`}>
          <User size={15} className={limits.pct_usuarios >= 90 ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'} />
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className={limits.pct_usuarios >= 90 ? 'text-orange-700 font-medium' : 'text-gray-500 dark:text-gray-400'}>
                {limits.usuarios_actuales} de {limits.max_usuarios} usuarios
              </span>
              <span className={limits.pct_usuarios >= 90 ? 'text-orange-600' : 'text-gray-400 dark:text-gray-400'}>
                {limits.pct_usuarios}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${limits.pct_usuarios >= 90 ? 'bg-orange-500' : 'bg-accent'}`}
                style={{ width: `${Math.min(limits.pct_usuarios, 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Formulario nuevo usuario */}
      {showInvitar && (
        <form onSubmit={handleInvitar} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-accent/30 space-y-4">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Nuevo usuario</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email *</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400" />
              <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)}
                placeholder="usuario@email.com" required
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Rol</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(ROLES) as [UserRole, any][])
                .filter(([r]) => r !== 'OWNER')
                .map(([rol, cfg]) => (
                  <button key={rol} type="button" onClick={() => setInvRol(rol)}
                    className={`px-3 py-2.5 rounded-xl border-2 text-left transition-all
                      ${invRol === rol ? 'border-accent bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{cfg.label}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{cfg.desc}</p>
                  </button>
                ))}
            </div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
            <Mail size={13} className="mt-0.5 flex-shrink-0" />
            El usuario recibirá un email con un link para crear su contraseña.
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowInvitar(false)}
              className="px-5 py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-semibold rounded-xl text-sm hover:border-gray-300 dark:hover:border-gray-500">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
              {saving ? 'Enviando...' : 'Enviar invitación'}
            </button>
          </div>
        </form>
      )}

      {/* Filtros por rol */}
      <div className="flex gap-2 flex-wrap">
        {(['TODOS', ...Object.keys(ROLES)] as (UserRole | 'TODOS')[]).map(r => {
          const cfg = r === 'TODOS' ? null : ROLES[r as UserRole]
          const count = r === 'TODOS' ? (usuarios as any[]).length : (usuarios as any[]).filter((u: any) => u.rol === r).length
          return (
            <button key={r} onClick={() => setFilterRol(r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-all
                ${filterRol === r
                  ? 'border-accent bg-blue-50 dark:bg-blue-900/20 text-accent'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                }`}>
              {r === 'TODOS' ? 'Todos' : cfg!.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Lista de usuarios */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {usuariosFiltrados.map((u: any) => {
              const rolCustomAsignado = rolesCustom.find(r => r.id === u.rol_custom_id)
              const rolCfg = ROLES[u.rol as UserRole] ?? ROLES.CAJERO
              const esMiUsuario = u.id === user?.id
              return (
                <div key={u.id} className={`px-4 py-4 flex items-center gap-4 ${!u.activo ? 'opacity-50' : ''}`}>
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <User size={18} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{u.nombre_display ?? u.id.slice(0, 8)}</p>
                      {esMiUsuario && <span className="text-xs text-gray-400 dark:text-gray-400">(vos)</span>}
                      {!u.activo && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">Inactivo</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${rolCfg.color}`}>
                        {rolCfg.label}
                      </span>
                      {rolCustomAsignado && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                          <Sliders size={10} className="inline mr-1" />{rolCustomAsignado.nombre}
                        </span>
                      )}
                      {!rolCustomAsignado && <span className="text-xs text-gray-400 dark:text-gray-500">{rolCfg.desc}</span>}
                    </div>
                    {u.created_at && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Desde {formatFechaCorta(u.created_at)}</p>
                    )}
                  </div>

                  {canManage && u.activo && (
                    <div className="flex items-center gap-2">
                      <select value={u.rol}
                        onChange={e => updateRol.mutate({ userId: u.id, rol: e.target.value as UserRole, rolAnterior: u.rol, nombreUsuario: u.nombre_display })}
                        className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white">
                        {(Object.entries(ROLES) as [UserRole, any][])
                          .filter(([r]) => r !== 'OWNER')
                          .map(([r, cfg]) => (
                            <option key={r} value={r}>{cfg.label}</option>
                          ))}
                      </select>
                      <button onClick={() => openUserPermisos(u)} title="Editar permisos del módulo por usuario"
                        className="p-1.5 text-gray-400 dark:text-gray-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors">
                        <Sliders size={15} />
                      </button>
                      {!esMiUsuario && (
                        <button onClick={() => { if (confirm(`¿Desactivar a ${u.nombre_display}?`)) desactivar.mutate(u.id) }}
                          className="p-1.5 text-gray-400 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {usuariosFiltrados.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                No hay usuarios con el rol seleccionado
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Roles personalizados (OWNER only) ─────────────────────────────────── */}
      {canManage && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <button onClick={() => setShowRolesSection(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <div className="flex items-center gap-2">
              <Sliders size={15} className="text-accent" />
              Roles personalizados
              {rolesCustom.length > 0 && (
                <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">{rolesCustom.length}</span>
              )}
            </div>
            {showRolesSection ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
          </button>

          {showRolesSection && (
            <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Creá roles con permisos a medida. Asignálos a usuarios como capa adicional sobre su rol base.
              </p>

              {/* Lista de roles custom */}
              <div className="space-y-2">
                {rolesCustom.map(rol => (
                  <div key={rol.id} className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 dark:bg-gray-700/50">
                      <button onClick={() => setExpandedRolId(expandedRolId === rol.id ? null : rol.id)}
                        className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200 flex-1 text-left">
                        <Sliders size={14} className="text-accent" />
                        {rol.nombre}
                        <span className="text-xs text-gray-400 ml-1">
                          ({Object.values(rol.permisos).filter(p => p !== 'no_ver').length} módulos activos)
                        </span>
                      </button>
                      <div className="flex items-center gap-1">
                        <button title="Editar" onClick={() => {
                          setEditingRol(rol)
                          setRolNombre(rol.nombre)
                          setRolPermisos({ ...defaultPermisos(), ...rol.permisos })
                          setShowRolForm(true)
                        }} className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded">
                          <Edit size={13} />
                        </button>
                        <button title="Eliminar" onClick={() => { if (confirm(`¿Eliminar el rol "${rol.nombre}"?`)) deleteRolCustom.mutate(rol.id) }}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                          <Trash2 size={13} />
                        </button>
                        {expandedRolId === rol.id
                          ? <ChevronUp size={14} className="text-gray-400" />
                          : <ChevronDown size={14} className="text-gray-400" />}
                      </div>
                    </div>
                    {expandedRolId === rol.id && (
                      <div className="px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {MODULOS.map(m => {
                          const p: Permiso = rol.permisos[m.key] ?? 'no_ver'
                          return (
                            <div key={m.key} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-gray-600 dark:text-gray-400 truncate">{m.label}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${PERMISO_COLORS[p]}`}>
                                {PERMISO_LABELS[p]}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
                {rolesCustom.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">Sin roles personalizados aún</p>
                )}
              </div>

              <button onClick={() => { setEditingRol(null); setRolNombre(''); setRolPermisos(defaultPermisos()); setShowRolForm(true) }}
                className="flex items-center gap-2 text-sm text-accent hover:text-accent/80 font-medium">
                <Plus size={14} /> Nuevo rol personalizado
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal editor de rol custom */}
      {showRolForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingRol ? `Editar rol: ${editingRol.nombre}` : 'Nuevo rol personalizado'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Nombre del rol *</label>
                <input type="text" value={rolNombre} onChange={e => setRolNombre(e.target.value)}
                  placeholder="Ej: Vendedor, Repositor, Encargado..."
                  className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Permisos por módulo <span className="text-xs font-normal text-gray-400">(click para cambiar)</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {MODULOS.map(m => {
                    const p = rolPermisos[m.key] ?? 'no_ver'
                    return (
                      <button key={m.key} type="button" onClick={() => cyclePermiso(m.key)}
                        className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-accent/50 transition-colors text-sm">
                        <span className="text-gray-700 dark:text-gray-300">{m.label}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${PERMISO_COLORS[p]}`}>
                          {PERMISO_LABELS[p]}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => { setShowRolForm(false); setEditingRol(null) }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                Cancelar
              </button>
              <button onClick={() => saveRolCustom.mutate()} disabled={saveRolCustom.isPending}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/90 disabled:opacity-50">
                {editingRol ? 'Actualizar' : 'Crear rol'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal permisos por usuario */}
      {userPermisosTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              Permisos: {userPermisosTarget.nombre_display}
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Rol base: <span className="font-medium">{ROLES[userPermisosTarget.rol as UserRole]?.label ?? userPermisosTarget.rol}</span>
              {' · '}Estos permisos sobreescriben el rol para módulos específicos
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {MODULOS.map(m => {
                const p = userPermisosData[m.key] ?? 'no_ver'
                return (
                  <button key={m.key} type="button"
                    onClick={() => {
                      const order: Permiso[] = ['no_ver', 'ver', 'editar']
                      const next = order[(order.indexOf(p) + 1) % order.length]
                      setUserPermisosData(prev => ({ ...prev, [m.key]: next }))
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-accent/50 transition-colors text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{m.label}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${PERMISO_COLORS[p]}`}>
                      {PERMISO_LABELS[p]}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Click en cada módulo para cambiar. "No ver" = oculta el módulo.</p>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setUserPermisosTarget(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                Cancelar
              </button>
              <button onClick={() => saveUserPermisos.mutate()} disabled={saveUserPermisos.isPending}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/90 disabled:opacity-50">
                {saveUserPermisos.isPending ? 'Guardando...' : 'Guardar permisos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Matriz de permisos por rol fijo */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <button onClick={() => setShowPermisos(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
          <div className="flex items-center gap-2">
            <Shield size={15} className="text-accent" />
            Permisos por rol
          </div>
          {showPermisos ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {showPermisos && (
          <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-300 min-w-40">Función</th>
                  {(Object.entries(ROLES) as [UserRole, any][]).map(([rol, cfg]) => (
                    <th key={rol} className="px-3 py-2.5 text-center">
                      <span className={`font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(PERMISOS).map(([funcion, roles]) => (
                  <tr key={funcion} className="border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{funcion}</td>
                    {(Object.keys(ROLES) as UserRole[]).map(rol => (
                      <td key={rol} className="px-3 py-2 text-center">
                        {roles[rol]
                          ? <Check size={13} className="text-green-500 mx-auto" />
                          : <XIcon size={13} className="text-gray-300 dark:text-gray-600 mx-auto" />
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
