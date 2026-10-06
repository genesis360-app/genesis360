import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, Trash2, Shield, User, Mail,
  ChevronDown, ChevronUp, Check, X as XIcon, Plus, Edit, Sliders, Globe, Lock, RotateCcw, KeyRound, Copy, Store, MessageCircle, Search,
} from 'lucide-react'
import { normalizarUsuario, validarUsuario, mensajeDatosAcceso } from '@/lib/usuarioLocal'
import { PASSWORD_MIN, traducirErrorPassword } from '@/lib/passwordPolicy'
import { esSiempreGlobal, textoAlcance, cambiarRol, validarAcceso, parcheAcceso, type AccesoUsuario } from '@/lib/accesoUsuario'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import { useConfirm } from '@/hooks/useConfirm'
import toast from 'react-hot-toast'
import { sugerenciaCorreo } from '@/lib/dominioCorreo'

type UserRole = 'DUEÑO' | 'SUPER_USUARIO' | 'SUPERVISOR' | 'CAJERO' | 'RRHH' | 'CONTADOR' | 'DEPOSITO' | 'VIEWER'
const ROLES: Record<UserRole, { label: string; desc: string; color: string }> = {
  DUEÑO:      { label: 'Dueño',         desc: 'Acceso completo',                    color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
  SUPER_USUARIO: { label: 'Super Usuario', desc: 'Admin técnica y configuración (avanzado)', color: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400' },
  SUPERVISOR: { label: 'Supervisor',    desc: 'Encargado: operación, inventario y reportes', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'        },
  CAJERO:     { label: 'Cajero',        desc: 'Solo ventas y caja',                 color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'     },
  RRHH:       { label: 'RRHH',          desc: 'Gestión de empleados',               color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'     },
  CONTADOR:   { label: 'Contador',      desc: 'Dashboard, gastos y reportes',       color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400'         },
  DEPOSITO:   { label: 'Depósito',      desc: 'Productos e inventario',             color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
  VIEWER:     { label: 'Lector',        desc: 'Solo lectura — supervisa, no edita', color: 'bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300'         },
}

type Permiso = 'no_ver' | 'ver' | 'editar' | 'supervisa'
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
  { key: 'comercial',     label: 'Comercial' },
  { key: 'caja',          label: 'Caja' },
  { key: 'gastos',        label: 'Gastos' },
  { key: 'clientes',      label: 'Clientes' },
  { key: 'inventario',    label: 'Inventario' },
  { key: 'productos',     label: 'Productos' },
  { key: 'movimientos',   label: 'Movimientos stock' },
  { key: 'envios',        label: 'Envíos' },
  { key: 'proveedores',   label: 'Proveedores' },
  { key: 'pedidos',       label: 'Pedidos' },
  { key: 'repositores',   label: 'Repositores' },
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

const PERMISO_LABELS: Record<Permiso, string> = { no_ver: 'No ver', ver: 'Ver', editar: 'Editar', supervisa: 'Supervisa' }
const PERMISO_COLORS: Record<Permiso, string> = {
  no_ver:    'bg-gray-100 dark:bg-gray-700 text-gray-400',
  ver:       'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  editar:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  supervisa: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
}

function defaultPermisos(): Record<string, Permiso> {
  return Object.fromEntries(MODULOS.map(m => [m.key, 'no_ver' as Permiso]))
}

// Cuenta del equipo de Genesis360 (rol de plataforma, no asignable por el negocio — ver mig 254). Antes caía en el
// "?? ROLES.CAJERO" y se mostraba como Cajero, con los controles para cambiarle el rol o darla de baja.
const ROL_STAFF = { label: 'Soporte Genesis360', desc: 'Cuenta del equipo de Genesis360', color: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' }

/** "Gaston Otranto" → "GO"; "nicolas.otranto86" → "NO". */
function iniciales(nombre: string | null | undefined): string {
  const partes = (nombre ?? '').replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return ((partes[0][0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] ?? ''))).toUpperCase()
}

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Roles que siempre tienen visión global (no configurables) — viven en src/lib/accesoUsuario.ts

export default function UsuariosPage() {
  const { tenant, user, sucursales } = useAuthStore()
  const qc = useQueryClient()
  const confirmar = useConfirm()
  const { limits } = usePlanLimits()
  // Roles personalizados = feature de modo avanzado (Pro+). En básico se ofrecen solo los roles fijos.
  const { avanzado: modoAvanzado } = useModoOperacion()
  const [showInvitar, setShowInvitar] = useState(false)
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [invEmail, setInvEmail] = useState('')
  const [invRol, setInvRol] = useState<UserRole>('CAJERO')
  // Mig 434: el alta sin correo. El dueño pone usuario + contraseña y no se manda ningún mail.
  const [invModo, setInvModo] = useState<'email' | 'usuario'>('email')
  const [invUsuario, setInvUsuario] = useState('')
  const [invNombre, setInvNombre] = useState('')
  const [invPassword, setInvPassword] = useState('')
  // Reseteo de contraseña de un usuario sin correo (no hay casilla donde mandarle un link).
  const [resetTarget, setResetTarget] = useState<any | null>(null)
  // GO 06/10: el código del negocio solo se veía al crear el usuario. Tras crear (o reponer la contraseña) se muestra
  // una tarjeta con los datos para entrar, lista para copiar o mandar por WhatsApp.
  const [datosAcceso, setDatosAcceso] = useState<{ usuario: string; nombre: string; password: string } | null>(null)
  const urlLogin = `${(import.meta.env.VITE_APP_URL as string | undefined) || window.location.origin}/login`
  const textoAcceso = datosAcceso && tenant?.codigo
    ? mensajeDatosAcceso({ negocio: tenant?.nombre ?? 'el negocio', codigo: tenant.codigo, usuario: datosAcceso.usuario, password: datosAcceso.password, url: urlLogin })
    : ''
  const copiar = async (texto: string, ok: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success(ok) }
    catch { toast.error('No se pudo copiar: seleccioná el texto y copialo a mano') }
  }
  const [resetPassword, setResetPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [filterRol, setFilterRol] = useState<UserRole | 'TODOS'>('TODOS')
  // Panel "Editar acceso" (uno abierto a la vez) con borrador: nada se guarda hasta "Guardar cambios".
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<AccesoUsuario | null>(null)
  const accesoDe = (u: any): AccesoUsuario => ({
    rol: u.rol, puede_ver_todas: !!u.puede_ver_todas, sucursal_id: u.sucursal_id ?? null, rol_custom_id: u.rol_custom_id ?? null,
  })
  const abrirEdicion = (u: any) => {
    if (editandoId === u.id) { setEditandoId(null); setBorrador(null); return }
    setEditandoId(u.id); setBorrador(accesoDe(u))
  }
  const cerrarEdicion = () => { setEditandoId(null); setBorrador(null) }
  const [busqueda, setBusqueda] = useState('')
  const [showPermisos, setShowPermisos] = useState(false)
  const [editingNombreId, setEditingNombreId] = useState<string | null>(null)
  const [editingNombreValue, setEditingNombreValue] = useState('')

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

  // Mig 434: alta de un empleado sin correo. No manda ningún mail: la cuenta nace con la contraseña
  // que pone el dueño, y el empleado está obligado a cambiarla en su primer ingreso.
  const handleCrearSinCorreo = async (e: React.FormEvent) => {
    e.preventDefault()
    const problemaUsuario = validarUsuario(invUsuario)
    if (problemaUsuario) { toast.error(problemaUsuario); return }
    if (invPassword.length < PASSWORD_MIN) { toast.error(`La contraseña necesita al menos ${PASSWORD_MIN} caracteres`); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('usuarios-sin-correo', {
        body: {
          accion: 'crear',
          usuario: invUsuario,
          nombre: invNombre.trim(),
          rol: invRol,
          password: invPassword,
        },
      })
      if (error) {
        const body = await (error as any).context?.json?.().catch(() => null)
        throw new Error(body?.error ?? error.message)
      }
      if (data?.error) throw new Error(data.error)
      toast.success(`Usuario "${invUsuario}" creado.`)
      setDatosAcceso({ usuario: normalizarUsuario(invUsuario), nombre: invNombre.trim() || invUsuario, password: invPassword })
      logActividad({ entidad: 'usuario', entidad_nombre: invNombre.trim() || invUsuario, accion: 'crear', valor_nuevo: invRol, pagina: '/usuarios' })
      setInvUsuario(''); setInvNombre(''); setInvPassword(''); setShowInvitar(false)
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      qc.invalidateQueries({ queryKey: ['plan-limits'] })
    } catch (err: any) {
      toast.error(traducirErrorPassword(err.message ?? 'Error al crear el usuario'))
    } finally {
      setSaving(false)
    }
  }

  // Sin casilla no hay "olvidé mi contraseña" posible: la repone el dueño, y vuelve a ser de un solo uso.
  const handleResetearPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (resetPassword.length < PASSWORD_MIN) { toast.error(`La contraseña necesita al menos ${PASSWORD_MIN} caracteres`); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('usuarios-sin-correo', {
        body: { accion: 'resetear-password', user_id: resetTarget.id, password: resetPassword },
      })
      if (error) {
        const body = await (error as any).context?.json?.().catch(() => null)
        throw new Error(body?.error ?? error.message)
      }
      if (data?.error) throw new Error(data.error)
      toast.success(`Contraseña repuesta. ${resetTarget.nombre_display ?? resetTarget.usuario} la va a tener que cambiar al entrar.`)
      if (resetTarget.usuario) setDatosAcceso({ usuario: resetTarget.usuario, nombre: resetTarget.nombre_display ?? resetTarget.usuario, password: resetPassword })
      logActividad({ entidad: 'usuario', entidad_id: resetTarget.id, entidad_nombre: resetTarget.nombre_display, accion: 'editar', campo: 'password', pagina: '/usuarios' })
      setResetTarget(null); setResetPassword('')
      qc.invalidateQueries({ queryKey: ['usuarios'] })
    } catch (err: any) {
      toast.error(traducirErrorPassword(err.message ?? 'Error al reponer la contraseña'))
    } finally {
      setSaving(false)
    }
  }

  const handleInvitar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invEmail.trim()) { toast.error('Ingresá el email del usuario'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: invEmail.trim(),
          rol: invRol,
          tenant_id: tenant!.id,
          redirect_to: `${window.location.origin}/dashboard`,
        },
      })
      if (error) {
        // Extraer el mensaje real del body de la respuesta (Supabase FunctionsHttpError)
        const body = await (error as any).context?.json?.().catch(() => null)
        throw new Error(body?.error ?? error.message)
      }
      if (data?.error) throw new Error(data.error)
      toast.success(`Invitación enviada a ${invEmail}. Al abrir el link del correo elige su contraseña.`)
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

  const updateNombre = useMutation({
    mutationFn: async ({ userId, nombre }: { userId: string; nombre: string }) => {
      const { error } = await supabase.from('users').update({ nombre_display: nombre }).eq('id', userId)
      if (error) throw error
      logActividad({ entidad: 'usuario', entidad_id: userId, entidad_nombre: nombre, accion: 'editar', campo: 'nombre_display', valor_nuevo: nombre, pagina: '/usuarios' })
    },
    onSuccess: () => { toast.success('Nombre actualizado'); qc.invalidateQueries({ queryKey: ['usuarios'] }); setEditingNombreId(null) },
    onError: () => toast.error('Error al actualizar nombre'),
  })

  // Guarda el borrador del panel en UN update (antes eran 3 controles que guardaban cada uno al tocarlo).
  const guardarAcceso = useMutation({
    mutationFn: async ({ u, d }: { u: any; d: AccesoUsuario }) => {
      const problema = validarAcceso(d, sucursales.length > 0)
      if (problema) throw new Error(problema)
      const parche = parcheAcceso(accesoDe(u), d)
      if (!parche) return false
      const { error } = await supabase.from('users').update(parche).eq('id', u.id)
      if (error) throw error
      const base = { entidad: 'usuario' as const, entidad_id: u.id, entidad_nombre: u.nombre_display, accion: 'editar' as const, pagina: '/usuarios' }
      if ('rol' in parche) logActividad({ ...base, campo: 'rol', valor_anterior: u.rol, valor_nuevo: parche.rol })
      if ('rol_custom_id' in parche) logActividad({ ...base, campo: 'rol_custom_id', valor_nuevo: parche.rol_custom_id ?? 'ninguno' })
      if ('puede_ver_todas' in parche || 'sucursal_id' in parche) {
        logActividad({ ...base, campo: 'sucursal', valor_nuevo: textoAlcance(d, id => sucursales.find(x => x.id === id)?.nombre) })
      }
      return true
    },
    onSuccess: (cambio) => {
      if (cambio) toast.success('Acceso actualizado')
      cerrarEdicion()
      qc.invalidateQueries({ queryKey: ['usuarios'] })
    },
    onError: (e: Error) => toast.error(e.message || 'No se pudo guardar el acceso'),
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

  // Mig 433: desde que dar de baja corta el acceso DE VERDAD, tiene que poder deshacerse desde la
  // app. Sin esto una baja por error es un candado sin llave: el usuario inactivo no renderiza
  // ningún control y no hay otra forma de volver atrás. La policy `users_update_owner` sí lo
  // permite (compara el tenant_id de la FILA, que queda intacto al dar de baja).
  const reactivar = useMutation({
    mutationFn: async (userId: string) => {
      const u = (usuarios as any[]).find(x => x.id === userId)
      const { error } = await supabase.from('users').update({ activo: true }).eq('id', userId)
      if (error) throw error
      logActividad({ entidad: 'usuario', entidad_id: userId, entidad_nombre: u?.nombre_display, accion: 'editar', campo: 'activo', valor_nuevo: 'true', pagina: '/usuarios' })
    },
    onSuccess: () => {
      toast.success('Usuario reactivado')
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      qc.invalidateQueries({ queryKey: ['plan-limits'] })
    },
    // Reactivar vuelve a ocupar un lugar del plan: si ya está en el límite, `trg_enforce_usuarios`
    // lo rechaza y ese mensaje es el que hay que mostrar, no uno genérico.
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

  const canManage = user?.rol === 'DUEÑO'

  const usuariosFiltrados = (usuarios as any[])
    .filter(u => filterRol === 'TODOS' || u.rol === filterRol)
    .filter(u => {
      const q = sinAcentos(busqueda.trim())
      return !q || sinAcentos(`${u.nombre_display ?? ''} ${u.usuario ?? ''}`).includes(q)
    })

  const PERMISOS: Record<string, Partial<Record<UserRole, boolean>>> = {
    'Ver inventario':       { DUEÑO: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: true  },
    'Movimientos de stock': { DUEÑO: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: true  },
    'Ventas y caja':        { DUEÑO: true,  SUPERVISOR: true,  CAJERO: true,  RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Gastos':               { DUEÑO: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: true,  DEPOSITO: false },
    'Clientes':             { DUEÑO: true,  SUPERVISOR: true,  CAJERO: true,  RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Reportes e historial': { DUEÑO: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: true,  DEPOSITO: false },
    'Métricas e insights':  { DUEÑO: true,  SUPERVISOR: true,  CAJERO: false, RRHH: false, CONTADOR: true,  DEPOSITO: false },
    'Importar datos':       { DUEÑO: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Configuración':        { DUEÑO: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
    'Usuarios':             { DUEÑO: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
    'RRHH (empleados)':     { DUEÑO: true,  SUPERVISOR: false, CAJERO: false, RRHH: true,  CONTADOR: false, DEPOSITO: false },
    'Sucursales':           { DUEÑO: true,  SUPERVISOR: false, CAJERO: false, RRHH: false, CONTADOR: false, DEPOSITO: false },
  }

  function formatFechaCorta(iso: string) {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const cyclePermiso = (modulo: string) => {
    const order: Permiso[] = ['no_ver', 'ver', 'editar', 'supervisa']
    const current = rolPermisos[modulo] ?? 'no_ver'
    const next = order[(order.indexOf(current) + 1) % order.length]
    setRolPermisos(prev => ({ ...prev, [modulo]: next }))
  }

  return (
    <div className="space-y-6">
      {showLimitModal && limits && (
        <PlanLimitModal tipo="usuario" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}

      {/* Encabezado — en celular el botón va abajo a lo ancho (antes se apretaba contra el título). */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Shield size={22} className="text-accent-text" /> Usuarios
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Quién entra a tu negocio y qué puede hacer</p>
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
            className="flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium w-full sm:w-auto transition-[background-color,transform] duration-150 active:scale-[0.97]">
            <UserPlus size={16} /> Agregar usuario
          </button>
        )}
      </div>

      {/* Lo que el dueño necesita a mano: el código del negocio (lo piden los empleados sin correo) y cuántos son. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {tenant?.codigo && (
          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-3 pr-1.5 py-1.5" data-testid="codigo-negocio">
            <Store size={14} className="text-gray-400 shrink-0" />
            <span className="text-gray-500 dark:text-gray-400">Código del negocio</span>
            <strong className="font-mono text-primary">{tenant.codigo}</strong>
            <button type="button" onClick={() => copiar(tenant.codigo!, 'Código copiado')} title="Copiar el código"
              aria-label="Copiar el código del negocio"
              className="p-1.5 rounded-lg text-gray-400 hover:text-accent-text hover:bg-accent/10 transition-[color,background-color,transform] duration-150 active:scale-[0.94]">
              <Copy size={14} />
            </button>
          </div>
        )}
        {limits && limits.max_usuarios === -1 && (
          <span className="text-gray-500 dark:text-gray-400">
            <strong className="font-semibold text-primary tabular-nums">{limits.usuarios_actuales}</strong> usuario{limits.usuarios_actuales !== 1 ? 's' : ''}
            <span className="text-gray-400 dark:text-gray-500"> · sin límite en tu plan</span>
          </span>
        )}
      </div>

      {/* Barra de uso.
          `max_usuarios = -1` es el centinela de "sin límite", y `-1 < 999` da true: sin este caso
          aparte, un plan ilimitado mostraba "13 de -1 usuarios · 0%". Mismo tratamiento que ya le
          daba ProductosPage a `max_productos`. */}
      {limits && limits.max_usuarios !== -1 && limits.max_usuarios < 999 && (
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
        <form onSubmit={invModo === 'email' ? handleInvitar : handleCrearSinCorreo}
          className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-accent-text/30 space-y-4">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Nuevo usuario</h2>

          {/* Mig 434: los dos caminos de alta. El de abajo existe porque en un negocio chico los
              empleados no tienen mail propio, y sin él el dueño terminaba inventando casillas. */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { modo: 'email' as const, titulo: 'Con email', desc: 'Le llega una invitación' },
              { modo: 'usuario' as const, titulo: 'Sin email', desc: 'Usuario y contraseña' },
            ]).map(op => (
              <button key={op.modo} type="button" onClick={() => setInvModo(op.modo)}
                className={`px-3 py-2.5 rounded-xl border-2 text-left transition-all
                  ${invModo === op.modo ? 'border-accent-text bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{op.titulo}</p>
                <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{op.desc}</p>
              </button>
            ))}
          </div>

          {invModo === 'email' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email *</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400" />
                <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)}
                  placeholder="usuario@email.com" required
                  className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
              </div>
              {/* 2026-10-05: una invitación de El Tilo fue a "outloock.com" y nunca llegó. */}
              {sugerenciaCorreo(invEmail) && (
                <p data-testid="sugerencia-correo" className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                  ¿Quisiste decir{' '}
                  <button type="button" onClick={() => setInvEmail(sugerenciaCorreo(invEmail)!)} className="font-semibold underline">
                    {sugerenciaCorreo(invEmail)}
                  </button>?
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre y apellido</label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400" />
                  <input type="text" value={invNombre} onChange={e => setInvNombre(e.target.value)}
                    placeholder="Juan Pérez"
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Es el que se ve en la app y en el historial.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usuario *</label>
                <div className="relative">
                  <Shield size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400" />
                  <input type="text" value={invUsuario} autoCapitalize="none" autoCorrect="off"
                    onChange={e => setInvUsuario(normalizarUsuario(e.target.value))}
                    placeholder="juan" required
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Con esto entra a la app. Solo tiene que ser distinto dentro de tu negocio.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña inicial *</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400" />
                  <input type="text" value={invPassword} onChange={e => setInvPassword(e.target.value)}
                    placeholder={`mínimo ${PASSWORD_MIN} caracteres`} required minLength={PASSWORD_MIN}
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Se la pasás vos. La primera vez que entre va a tener que cambiarla.
                </p>
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Rol</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.entries(ROLES) as [UserRole, any][])
                // Dueño no se asigna por invitación. SUPER_USUARIO (admin técnico) se reserva al
                // modo avanzado: una PyME en básico no necesita dos roles "administrador".
                .filter(([r]) => r !== 'DUEÑO' && (modoAvanzado || r !== 'SUPER_USUARIO'))
                .map(([rol, cfg]) => (
                  <button key={rol} type="button" onClick={() => setInvRol(rol)}
                    className={`px-3 py-2.5 rounded-xl border-2 text-left transition-all
                      ${invRol === rol ? 'border-accent-text bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{cfg.label}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{cfg.desc}</p>
                  </button>
                ))}
            </div>
          </div>
          {invModo === 'email' ? (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
              <Mail size={13} className="mt-0.5 flex-shrink-0" />
              Le llega un correo con un link: al abrirlo elige su contraseña y desde ahí entra con su correo. Si no lo
              ve, que revise el correo no deseado. Con una cuenta de Google también puede entrar con "Continuar con Google".
            </div>
          ) : (
            // El código del negocio es la otra mitad de lo que el empleado necesita para entrar.
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
              <Shield size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                Para entrar necesita dos cosas: el código de tu negocio —<strong>{tenant?.codigo}</strong>— y su
                usuario. No se le manda ningún mail.
              </span>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowInvitar(false)}
              className="px-5 py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-semibold rounded-xl text-sm hover:border-gray-300 dark:hover:border-gray-500">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
              {saving ? 'Guardando...' : invModo === 'email' ? 'Enviar invitación' : 'Crear usuario'}
            </button>
          </div>
        </form>
      )}

      {/* Búsqueda + filtros por rol. Los roles sin nadie no se muestran (eran 9 pastillas, varias en 0); en celular
          las pastillas se deslizan en una sola fila en vez de ocupar media pantalla. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72 shrink-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o usuario"
            aria-label="Buscar usuarios"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-primary focus:outline-none focus:border-accent-text" />
        </div>
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0 lg:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(['TODOS', ...Object.keys(ROLES)] as (UserRole | 'TODOS')[]).map(r => {
            const cfg = r === 'TODOS' ? null : ROLES[r as UserRole]
            const count = r === 'TODOS' ? (usuarios as any[]).length : (usuarios as any[]).filter((u: any) => u.rol === r).length
            if (r !== 'TODOS' && count === 0 && filterRol !== r) return null
            const activo = filterRol === r
            return (
              <button key={r} onClick={() => setFilterRol(r)} aria-pressed={activo}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-sm border transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]
                  ${activo
                    ? 'bg-primary text-white border-primary dark:bg-white dark:text-gray-900 dark:border-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}`}>
                {r === 'TODOS' ? 'Todos' : cfg!.label} <span className={`tabular-nums ${activo ? 'opacity-70' : 'text-gray-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Lista de usuarios */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {usuariosFiltrados.map((u: any) => {
              const rolCustomAsignado = rolesCustom.find(r => r.id === u.rol_custom_id)
              const esStaff = u.rol === 'ADMIN'
              const rolCfg = esStaff ? ROL_STAFF : (ROLES[u.rol as UserRole] ?? ROLES.CAJERO)
              const esMiUsuario = u.id === user?.id
              // El staff no se toca desde un negocio; el rol del Dueño tampoco (no es una opción del selector: antes
              // el selector mostraba "Super Usuario" para el Dueño).
              const controlesVisibles = canManage && u.activo && !esStaff
              return (
                <div key={u.id}
                  className={`group px-4 sm:px-5 py-4 grid grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-3 items-center ${!u.activo ? 'opacity-55' : ''}`}>
                  <div aria-hidden className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${rolCfg.color}`}>
                    {iniciales(u.nombre_display ?? u.usuario)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {canManage && editingNombreId === u.id ? (
                        <>
                          <input
                            autoFocus
                            value={editingNombreValue}
                            onChange={e => setEditingNombreValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') updateNombre.mutate({ userId: u.id, nombre: editingNombreValue.trim() })
                              if (e.key === 'Escape') setEditingNombreId(null)
                            }}
                            className="text-sm font-medium px-2 py-0.5 border border-accent-text rounded-lg focus:outline-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 w-40 min-w-0"
                          />
                          <button onClick={() => updateNombre.mutate({ userId: u.id, nombre: editingNombreValue.trim() })} aria-label="Guardar el nombre"
                            className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                            <Check size={13} />
                          </button>
                          <button onClick={() => setEditingNombreId(null)} aria-label="Cancelar"
                            className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                            <XIcon size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{u.nombre_display ?? u.usuario ?? u.id.slice(0, 8)}</p>
                          {esMiUsuario && <span className="text-xs text-gray-400 shrink-0">(vos)</span>}
                          {canManage && u.activo && !esStaff && (
                            // Siempre visible en pantallas táctiles (no hay hover); en escritorio aparece al pasar.
                            <button aria-label="Editar el nombre"
                              onClick={() => { setEditingNombreId(u.id); setEditingNombreValue(u.nombre_display ?? '') }}
                              className="p-0.5 shrink-0 text-gray-300 dark:text-gray-600 hover:text-accent-text rounded sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150">
                              <Edit size={12} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-x-2 gap-y-1 mt-1 flex-wrap text-xs">
                      <span className={`font-medium px-2 py-0.5 rounded-full ${rolCfg.color}`}>{rolCfg.label}</span>
                      {rolCustomAsignado && (
                        <span className="font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent-text">
                          <Sliders size={10} className="inline mr-1" />{rolCustomAsignado.nombre}
                        </span>
                      )}
                      {/* Mig 434: entra sin correo. Se muestra para que el dueño sepa qué usuario dictarle. */}
                      {u.usuario && <span className="font-mono text-gray-500 dark:text-gray-400">@{u.usuario}</span>}
                      {!u.activo && <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">Inactivo</span>}
                      {u.debe_cambiar_password && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">Contraseña sin estrenar</span>
                      )}
                      <span className="text-gray-400 dark:text-gray-500">
                        {rolCustomAsignado ? '' : rolCfg.desc}{u.created_at ? `${rolCustomAsignado ? '' : ' · '}desde ${formatFechaCorta(u.created_at)}` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Resumen de solo lectura: QUÉ es y DÓNDE trabaja. Se cambia desde "Editar acceso". */}
                  <div className="col-span-2 lg:col-span-1 flex items-center gap-2 flex-wrap lg:justify-end">
                    {!esStaff && u.activo && (
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ${
                        !esSiempreGlobal(u.rol) && !u.puede_ver_todas && !u.sucursal_id && sucursales.length > 0
                          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
                        {esSiempreGlobal(u.rol) || u.puede_ver_todas ? <Globe size={12} /> : <Store size={12} />}
                        {textoAlcance(accesoDe(u), id => sucursales.find(x => x.id === id)?.nombre)}
                      </span>
                    )}
                    {controlesVisibles && (
                      <button type="button" onClick={() => abrirEdicion(u)} aria-expanded={editandoId === u.id}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]
                          ${editandoId === u.id
                            ? 'border-accent-text bg-accent/10 text-accent-text'
                            : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                        Editar acceso
                        <ChevronDown size={14} className={`transition-transform duration-200 ${editandoId === u.id ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                    {/* Mig 433: un usuario dado de baja no tiene acceso, así que la única acción que
                      le queda —y que antes no existía— es volver a darle el alta. */}
                  {canManage && !u.activo && (
                    <button
                      title="Reactivar — vuelve a tener acceso a la app"
                      disabled={reactivar.isPending}
                      onClick={async () => { if (await confirmar(`¿Reactivar a ${u.nombre_display ?? 'este usuario'}? Vuelve a tener acceso con el rol que tenía.`)) reactivar.mutate(u.id) }}
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 text-accent-text bg-accent/10 hover:bg-accent/20 rounded-lg transition-colors disabled:opacity-50">
                      <RotateCcw size={13} />
                      Reactivar
                    </button>
                  )}
                  </div>

                  {/* Panel "Editar acceso" — en orden: qué rol, dónde trabaja, permisos finos y, aparte, la cuenta. */}
                  {controlesVisibles && editandoId === u.id && borrador && (() => {
                    const d = borrador
                    const cambios = parcheAcceso(accesoDe(u), d)
                    const problema = validarAcceso(d, sucursales.length > 0)
                    const titulo = (t: string, ayuda?: string) => (
                      <div className="mb-2">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t}</p>
                        {ayuda && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ayuda}</p>}
                      </div>
                    )
                    return (
                      <div className="col-span-2 lg:col-span-3 -mx-4 sm:-mx-5 -mb-4 mt-1 px-4 sm:px-5 py-5 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700 space-y-6"
                        data-testid="panel-acceso">
                        {/* 1 · Rol */}
                        <section>
                          {u.rol === 'DUEÑO' ? (
                            titulo('Rol: Dueño', 'Acceso completo. El rol de Dueño no se cambia desde acá.')
                          ) : (
                            <>
                              {titulo('Rol', 'Define qué partes de la app puede usar.')}
                              <div role="radiogroup" aria-label="Rol" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                {(Object.entries(ROLES) as [UserRole, any][])
                                  .filter(([r]) => r !== 'DUEÑO' && (modoAvanzado || r !== 'SUPER_USUARIO' || u.rol === 'SUPER_USUARIO'))
                                  .map(([r, cfg]) => (
                                    <button key={r} type="button" role="radio" aria-checked={d.rol === r}
                                      onClick={() => setBorrador(cambiarRol(d, r))}
                                      className={`px-3 py-2.5 rounded-xl border-2 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.98]
                                        ${d.rol === r ? 'border-accent-text bg-accent/5' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{cfg.label}</p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{cfg.desc}</p>
                                    </button>
                                  ))}
                              </div>
                            </>
                          )}
                        </section>

                        {/* 2 · Dónde trabaja (reemplaza al ícono del globo) */}
                        {!esSiempreGlobal(d.rol) && sucursales.length > 0 && (
                          <section>
                            {titulo('Dónde trabaja', 'Ve y opera solo lo de su sucursal, o todo el negocio.')}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <div role="radiogroup" aria-label="Sucursales" className="inline-flex p-1 rounded-xl bg-gray-200/70 dark:bg-gray-800 w-full sm:w-auto">
                                {([['todas', 'Todas las sucursales'], ['una', 'Una sucursal']] as const).map(([v, label]) => {
                                  const activo = (v === 'todas') === d.puede_ver_todas
                                  return (
                                    <button key={v} type="button" role="radio" aria-checked={activo}
                                      onClick={() => setBorrador({ ...d, puede_ver_todas: v === 'todas' })}
                                      className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-sm transition-[background-color,color,box-shadow] duration-150
                                        ${activo ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                                      {label}
                                    </button>
                                  )
                                })}
                              </div>
                              {!d.puede_ver_todas && (
                                <select value={d.sucursal_id ?? ''} aria-label="Sucursal" onChange={e => setBorrador({ ...d, sucursal_id: e.target.value || null })}
                                  className="sm:w-56 text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text">
                                  <option value="">Elegí la sucursal</option>
                                  {sucursales.map(sc => <option key={sc.id} value={sc.id}>{sc.nombre}</option>)}
                                </select>
                              )}
                            </div>
                          </section>
                        )}

                        {/* 3 · Permisos finos */}
                        {u.rol !== 'DUEÑO' && (
                          <section>
                            {titulo('Permisos a medida', 'Opcional: ajustá módulo por módulo encima del rol.')}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              {rolesCustom.length > 0 && (
                                <select value={d.rol_custom_id ?? ''} aria-label="Rol personalizado"
                                  onChange={e => setBorrador({ ...d, rol_custom_id: e.target.value || null })}
                                  className="sm:w-56 text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text">
                                  <option value="">Sin rol personalizado</option>
                                  {rolesCustom.map((r: any) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                                </select>
                              )}
                              <button type="button" onClick={() => openUserPermisos(u)}
                                className="inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-gray-300 transition-[border-color,transform] duration-150 active:scale-[0.97]">
                                <Sliders size={14} /> Editar permisos de {u.nombre_display ?? u.usuario ?? 'este usuario'}
                              </button>
                            </div>
                          </section>
                        )}

                        {/* 4 · Cuenta — separada: son acciones que no se deshacen con "Cancelar" */}
                        {(u.usuario || !esMiUsuario) && (
                          <section className="pt-4 border-t border-gray-200 dark:border-gray-700">
                            {titulo('Cuenta')}
                            <div className="flex flex-wrap gap-2">
                              {/* Mig 434: solo las cuentas sin correo (las otras la recuperan ellas por mail). */}
                              {u.usuario && (
                                <button type="button" onClick={() => { setResetTarget(u); setResetPassword('') }}
                                  className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-gray-300 transition-[border-color,transform] duration-150 active:scale-[0.97]">
                                  <KeyRound size={14} /> Reponer contraseña
                                </button>
                              )}
                              {!esMiUsuario && (
                                <button type="button"
                                  onClick={async () => { if (await confirmar(`¿Desactivar a ${u.nombre_display}? Deja de tener acceso a la app hasta que lo reactives.`, { danger: true })) { cerrarEdicion(); desactivar.mutate(u.id) } }}
                                  className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-[background-color,transform] duration-150 active:scale-[0.97]">
                                  <Trash2 size={14} /> Desactivar usuario
                                </button>
                              )}
                            </div>
                          </section>
                        )}

                        {/* Pie: guardar el borrador */}
                        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                          {problema && cambios && <p className="text-sm text-amber-700 dark:text-amber-400 sm:mr-auto">{problema}</p>}
                          <button type="button" onClick={cerrarEdicion}
                            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color,transform] duration-150 active:scale-[0.97]">
                            Cancelar
                          </button>
                          <button type="button" disabled={!cambios || !!problema || guardarAcceso.isPending}
                            onClick={() => guardarAcceso.mutate({ u, d })}
                            className="px-4 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-40 transition-[background-color,opacity,transform] duration-150 active:scale-[0.97]">
                            {guardarAcceso.isPending ? 'Guardando…' : 'Guardar cambios'}
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
            {usuariosFiltrados.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                {busqueda.trim() ? `Nadie coincide con "${busqueda.trim()}"` : 'No hay usuarios con el rol seleccionado'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Roles personalizados (solo Dueño · feature de modo avanzado/Pro) ──── */}
      {canManage && !modoAvanzado && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-start gap-3">
            <div className="bg-accent/10 rounded-lg p-2 flex-shrink-0"><Lock size={16} className="text-accent-text" /></div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                Roles personalizados
                <span className="text-[10px] uppercase tracking-wide bg-accent/10 text-accent-text px-1.5 py-0.5 rounded-full font-bold">Pro</span>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Creá roles con permisos a medida (módulo por módulo). Disponible en el <span className="font-medium">modo avanzado</span>.
                En el plan básico contás con los roles fijos (Dueño, Supervisor, Cajero, Depósito, Contador, Lector).
              </p>
              <a href="/suscripcion" className="inline-flex items-center gap-1 text-xs font-semibold text-accent-text hover:text-accent-text/80 mt-2">
                Ver planes →
              </a>
            </div>
          </div>
        </div>
      )}
      {canManage && modoAvanzado && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <button onClick={() => setShowRolesSection(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <div className="flex items-center gap-2">
              <Sliders size={15} className="text-accent-text" />
              Roles personalizados
              {rolesCustom.length > 0 && (
                <span className="text-xs bg-accent/10 text-accent-text px-2 py-0.5 rounded-full">{rolesCustom.length}</span>
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
                        <Sliders size={14} className="text-accent-text" />
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
                        <button title="Eliminar" onClick={async () => { if (await confirmar(`¿Eliminar el rol "${rol.nombre}"?`, { danger: true })) deleteRolCustom.mutate(rol.id) }}
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
                className="flex items-center gap-2 text-sm text-accent-text hover:text-accent-text/80 font-medium">
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
                        className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-accent-text/50 transition-colors text-sm">
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
                      const order: Permiso[] = ['no_ver', 'ver', 'editar', 'supervisa']
                      const next = order[(order.indexOf(p) + 1) % order.length]
                      setUserPermisosData(prev => ({ ...prev, [m.key]: next }))
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-accent-text/50 transition-colors text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{m.label}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${PERMISO_COLORS[p]}`}>
                      {PERMISO_LABELS[p]}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Click en cada módulo para cambiar. "No ver" = oculta el módulo. "Supervisa" = además de editar, puede aprobar/reasignar en la pestaña Supervisión de ese módulo.</p>
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
            <Shield size={15} className="text-accent-text" />
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

      {/* Mig 434 · Reponer la contraseña de un usuario sin correo.
          No hay link de recuperación posible: la dirección interna no recibe nada. */}
      {datosAcceso && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Datos para entrar">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-primary">Datos para entrar de {datosAcceso.nombre}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Pasáselos ahora: la contraseña no se vuelve a mostrar. La cambia en su primer ingreso.</p>
            </div>
            <pre className="whitespace-pre-wrap break-words text-sm bg-gray-50 dark:bg-gray-700/60 rounded-xl p-3 text-gray-700 dark:text-gray-200 font-sans" data-testid="texto-datos-acceso">{textoAcceso}</pre>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={() => copiar(textoAcceso, 'Datos copiados')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                <Copy size={14} /> Copiar
              </button>
              <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(textoAcceso)}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 text-white text-sm hover:bg-green-700">
                <MessageCircle size={14} /> Enviar por WhatsApp
              </a>
              <button type="button" onClick={() => setDatosAcceso(null)}
                className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90">Listo</button>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setResetTarget(null)}>
          <form onSubmit={handleResetearPassword} onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">
              Reponer la contraseña de {resetTarget.nombre_display ?? resetTarget.usuario}
            </h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña nueva</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400" />
                <input type="text" autoFocus value={resetPassword} onChange={e => setResetPassword(e.target.value)}
                  placeholder={`mínimo ${PASSWORD_MIN} caracteres`} required minLength={PASSWORD_MIN}
                  className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent-text dark:bg-gray-900 dark:text-gray-100" />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Se la pasás vos y la va a tener que cambiar en cuanto entre. Sus sesiones abiertas no se cierran.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setResetTarget(null)}
                className="px-5 py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-semibold rounded-xl text-sm hover:border-gray-300 dark:hover:border-gray-500">
                Cancelar
              </button>
              <button type="submit" disabled={saving}
                className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
                {saving ? 'Guardando...' : 'Reponer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
