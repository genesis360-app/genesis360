import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Trash2, Shield, User, Mail, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import toast from 'react-hot-toast'

type UserRole = 'OWNER' | 'SUPERVISOR' | 'CAJERO' | 'RRHH'
const ROLES: Record<UserRole, { label: string; desc: string; color: string }> = {
  OWNER:      { label: 'Dueño',      desc: 'Acceso completo',           color: 'bg-purple-100 text-purple-700' },
  SUPERVISOR: { label: 'Supervisor', desc: 'Inventario y movimientos',  color: 'bg-blue-100 text-blue-700'   },
  CAJERO:     { label: 'Cajero',     desc: 'Solo ventas y rebajes',     color: 'bg-green-100 text-green-700' },
  RRHH:       { label: 'RRHH',       desc: 'Gestión de empleados',      color: 'bg-amber-100 text-amber-700' },
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

  const updateRol = useMutation({
    mutationFn: async ({ userId, rol, rolAnterior, nombreUsuario }: { userId: string; rol: UserRole; rolAnterior?: string; nombreUsuario?: string }) => {
      const { error } = await supabase.from('users').update({ rol }).eq('id', userId)
      if (error) throw error
      logActividad({ entidad: 'usuario', entidad_id: userId, entidad_nombre: nombreUsuario, accion: 'editar', campo: 'rol', valor_anterior: rolAnterior ?? null, valor_nuevo: rol, pagina: '/usuarios' })
    },
    onSuccess: () => { toast.success('Rol actualizado'); qc.invalidateQueries({ queryKey: ['usuarios'] }) },
    onError: () => toast.error('Error al actualizar rol'),
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

  const canManage = user?.rol === 'OWNER'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {showLimitModal && limits && (
        <PlanLimitModal tipo="usuario" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Usuarios</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gestioná el equipo de tu negocio</p>
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
          ${limits.pct_usuarios >= 90 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
          <User size={15} className={limits.pct_usuarios >= 90 ? 'text-orange-500' : 'text-gray-400'} />
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className={limits.pct_usuarios >= 90 ? 'text-orange-700 font-medium' : 'text-gray-500'}>
                {limits.usuarios_actuales} de {limits.max_usuarios} usuarios
              </span>
              <span className={limits.pct_usuarios >= 90 ? 'text-orange-600' : 'text-gray-400'}>
                {limits.pct_usuarios}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${limits.pct_usuarios >= 90 ? 'bg-orange-500' : 'bg-accent'}`}
                style={{ width: `${Math.min(limits.pct_usuarios, 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Formulario nuevo usuario */}
      {showInvitar && (
        <form onSubmit={handleInvitar} className="bg-white rounded-xl p-5 shadow-sm border border-accent/30 space-y-4">
          <h2 className="font-semibold text-gray-700">Nuevo usuario</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)}
                placeholder="usuario@email.com" required
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Rol</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(ROLES) as [UserRole, any][])
                .filter(([r]) => r !== 'OWNER')
                .map(([rol, cfg]) => (
                  <button key={rol} type="button" onClick={() => setInvRol(rol)}
                    className={`px-3 py-2.5 rounded-xl border-2 text-left transition-all
                      ${invRol === rol ? 'border-accent bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <p className="text-sm font-medium text-gray-700">{cfg.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{cfg.desc}</p>
                  </button>
                ))}
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700 flex items-start gap-2">
            <Mail size={13} className="mt-0.5 flex-shrink-0" />
            El usuario recibirá un email con un link para crear su contraseña. No necesitás compartirle ninguna contraseña manualmente.
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowInvitar(false)}
              className="px-5 py-2.5 border-2 border-gray-200 text-gray-600 font-semibold rounded-xl text-sm hover:border-gray-300">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
              {saving ? 'Enviando...' : 'Enviar invitación'}
            </button>
          </div>
        </form>
      )}

      {/* Lista de usuarios */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="divide-y divide-gray-50">
            {usuarios.map((u: any) => {
              const rolCfg = ROLES[u.rol as UserRole] ?? ROLES.CAJERO
              const esMiUsuario = u.id === user?.id
              return (
                <div key={u.id} className={`px-4 py-4 flex items-center gap-4 ${!u.activo ? 'opacity-50' : ''}`}>
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <User size={18} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-800 truncate">{u.nombre_display ?? u.id.slice(0, 8)}</p>
                      {esMiUsuario && <span className="text-xs text-gray-400">(vos)</span>}
                      {!u.activo && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Inactivo</span>}
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${rolCfg.color}`}>
                      {rolCfg.label}
                    </span>
                  </div>

                  {canManage && u.activo && (
                    <div className="flex items-center gap-2">
                      <select value={u.rol}
                        onChange={e => updateRol.mutate({ userId: u.id, rol: e.target.value as UserRole, rolAnterior: u.rol, nombreUsuario: u.nombre_display })}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent">
                        {(Object.entries(ROLES) as [UserRole, any][])
                          .filter(([r]) => r !== 'OWNER')
                          .map(([r, cfg]) => (
                            <option key={r} value={r}>{cfg.label}</option>
                          ))}
                      </select>
                      {!esMiUsuario && (
                        <button onClick={() => { if (confirm(`¿Desactivar a ${u.nombre_display}?`)) desactivar.mutate(u.id) }}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
