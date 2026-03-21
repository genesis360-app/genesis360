import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BRAND } from '@/config/brand'
import {
  Users, Package, Building2, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, Clock, Search, RefreshCw, Shield,
  ChevronDown, X, Edit2
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type SubscriptionStatus = 'trial' | 'active' | 'inactive' | 'cancelled'

const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; color: string; bg: string; icon: any }> = {
  trial:     { label: 'Trial',    color: 'text-yellow-700', bg: 'bg-yellow-100', icon: Clock },
  active:    { label: 'Activo',   color: 'text-green-700',  bg: 'bg-green-100',  icon: CheckCircle },
  inactive:  { label: 'Inactivo', color: 'text-red-700',    bg: 'bg-red-100',    icon: XCircle },
  cancelled: { label: 'Cancelado',color: 'text-gray-600',   bg: 'bg-gray-100',   icon: XCircle },
}

interface TenantRow {
  id: string
  nombre: string
  tipo_comercio?: string
  pais: string
  subscription_status: SubscriptionStatus
  trial_ends_at: string
  max_users: number
  created_at: string
  _user_count?: number
  _product_count?: number
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 ${color}`}>
        <Icon size={20} />
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

export default function AdminPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<SubscriptionStatus | ''>('')
  const [editTenant, setEditTenant] = useState<TenantRow | null>(null)
  const [editForm, setEditForm] = useState({ subscription_status: '' as SubscriptionStatus, max_users: 0, trial_days: 0 })

  // Solo ADMIN puede ver esto
  if (user?.rol !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Shield size={48} className="text-red-400" />
        <h1 className="text-xl font-bold text-gray-700">Acceso denegado</h1>
        <p className="text-gray-400">Esta sección es solo para administradores de {BRAND.name}.</p>
      </div>
    )
  }

  const { data: tenants = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error

      // Enriquecer con conteos
      const enriched = await Promise.all((data ?? []).map(async (t: TenantRow) => {
        const [{ count: userCount }, { count: productCount }] = await Promise.all([
          supabase.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabase.from('productos').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('activo', true),
        ])
        return { ...t, _user_count: userCount ?? 0, _product_count: productCount ?? 0 }
      }))
      return enriched as TenantRow[]
    },
  })

  const stats = {
    total: tenants.length,
    activos: tenants.filter(t => t.subscription_status === 'active').length,
    trial: tenants.filter(t => t.subscription_status === 'trial').length,
    inactivos: tenants.filter(t => ['inactive', 'cancelled'].includes(t.subscription_status)).length,
  }

  const updateTenant = useMutation({
    mutationFn: async () => {
      if (!editTenant) return
      const updates: any = {
        subscription_status: editForm.subscription_status,
        max_users: editForm.max_users,
      }
      if (editForm.trial_days > 0) {
        updates.trial_ends_at = new Date(Date.now() + editForm.trial_days * 86400000).toISOString()
      }
      const { error } = await supabase.from('tenants').update(updates).eq('id', editTenant.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Tenant actualizado')
      qc.invalidateQueries({ queryKey: ['admin-tenants'] })
      setEditTenant(null)
    },
    onError: () => toast.error('Error al actualizar'),
  })

  const openEdit = (t: TenantRow) => {
    setEditTenant(t)
    setEditForm({
      subscription_status: t.subscription_status,
      max_users: t.max_users,
      trial_days: 0,
    })
  }

  const filtered = tenants.filter(t => {
    const matchSearch = !search ||
      t.nombre.toLowerCase().includes(search.toLowerCase()) ||
      t.id.includes(search)
    const matchStatus = !filterStatus || t.subscription_status === filterStatus
    return matchSearch && matchStatus
  })

  const trialVencidos = tenants.filter(t =>
    t.subscription_status === 'trial' && new Date(t.trial_ends_at) < new Date()
  ).length

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Shield size={24} /> Panel de Administración
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Vista global de todos los tenants de {BRAND.name}</p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm hover:bg-gray-50 transition-all">
          <RefreshCw size={15} /> Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total tenants" value={stats.total} icon={Building2} color="bg-blue-50 text-blue-600" />
        <StatCard label="Activos (pagos)" value={stats.activos} icon={CheckCircle} color="bg-green-50 text-green-600" />
        <StatCard label="En trial" value={stats.trial} icon={Clock} color="bg-yellow-50 text-yellow-600" />
        <StatCard label="Inactivos" value={stats.inactivos} icon={XCircle} color="bg-red-50 text-red-500" />
      </div>

      {/* Alerta trials vencidos */}
      {trialVencidos > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
          <p className="text-red-700 text-sm font-medium">
            {trialVencidos} tenant{trialVencidos !== 1 ? 's' : ''} con trial vencido sin convertir
          </p>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o ID..."
            className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent bg-white" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none bg-white">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Building2 size={40} className="mb-3 opacity-30" />
            <p>No se encontraron tenants</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Negocio</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Estado</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Usuarios</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Productos</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">Trial / Vence</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Registrado</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const st = STATUS_CONFIG[t.subscription_status]
                  const Icon = st.icon
                  const trialVencido = t.subscription_status === 'trial' && new Date(t.trial_ends_at) < new Date()
                  const diasTrial = Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 86400000)

                  return (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800">{t.nombre}</p>
                        <p className="text-xs text-gray-400">{t.tipo_comercio ?? '—'} · {t.pais}</p>
                        <p className="text-xs text-gray-300 font-mono mt-0.5">{t.id.slice(0, 8)}...</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg} ${st.color}`}>
                          <Icon size={11} /> {st.label}
                        </span>
                        {trialVencido && (
                          <p className="text-xs text-red-500 mt-1 font-medium">⚠ Trial vencido</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-gray-700">{t._user_count}</span>
                        <span className="text-gray-400 text-xs">/{t.max_users === 999 ? '∞' : t.max_users}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-gray-700">{t._product_count}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {t.subscription_status === 'trial' ? (
                          <span className={`text-xs font-medium ${trialVencido ? 'text-red-500' : diasTrial <= 2 ? 'text-orange-500' : 'text-gray-500'}`}>
                            {trialVencido ? `Venció hace ${Math.abs(diasTrial)}d` : `${diasTrial}d restantes`}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">
                            {new Date(t.trial_ends_at).toLocaleDateString('es-AR')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400">
                        {new Date(t.created_at).toLocaleDateString('es-AR')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => openEdit(t)}
                          className="p-1.5 text-gray-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-colors">
                          <Edit2 size={15} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal edición */}
      {editTenant && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-primary">Editar tenant</h2>
                <p className="text-sm text-gray-500 mt-0.5">{editTenant.nombre}</p>
              </div>
              <button onClick={() => setEditTenant(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Estado de suscripción */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado de suscripción</label>
                <select value={editForm.subscription_status}
                  onChange={e => setEditForm(p => ({ ...p, subscription_status: e.target.value as SubscriptionStatus }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>

              {/* Límite de usuarios */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Límite de usuarios</label>
                <div className="flex gap-2">
                  {[1, 2, 5, 10, 999].map(n => (
                    <button key={n} onClick={() => setEditForm(p => ({ ...p, max_users: n }))}
                      className={`flex-1 py-2 rounded-xl border-2 text-sm font-medium transition-all
                        ${editForm.max_users === n ? 'border-accent bg-blue-50 text-primary' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      {n === 999 ? '∞' : n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Extender trial */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Extender trial (días adicionales)
                </label>
                <input type="number" min="0" max="365" value={editForm.trial_days}
                  onChange={e => setEditForm(p => ({ ...p, trial_days: parseInt(e.target.value) || 0 }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent"
                  placeholder="0 = sin cambio" />
                <p className="text-xs text-gray-400 mt-1">
                  Trial actual vence: {new Date(editTenant.trial_ends_at).toLocaleDateString('es-AR')}
                  {editForm.trial_days > 0 && (
                    <span className="text-green-600 ml-1">
                      → nuevo: {new Date(Date.now() + editForm.trial_days * 86400000).toLocaleDateString('es-AR')}
                    </span>
                  )}
                </p>
              </div>

              {/* Info del tenant */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-xs text-gray-500">
                <p>ID: <span className="font-mono">{editTenant.id}</span></p>
                <p>Usuarios activos: <span className="font-semibold">{editTenant._user_count}</span></p>
                <p>Productos activos: <span className="font-semibold">{editTenant._product_count}</span></p>
                <p>Registrado: {new Date(editTenant.created_at).toLocaleDateString('es-AR')}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditTenant(null)}
                className="flex-1 border-2 border-gray-200 text-gray-600 font-semibold py-2.5 rounded-xl hover:border-gray-300 text-sm">
                Cancelar
              </button>
              <button onClick={() => updateTenant.mutate()} disabled={updateTenant.isPending}
                className="flex-1 bg-primary hover:bg-accent text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
                {updateTenant.isPending ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
