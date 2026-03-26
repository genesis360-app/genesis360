import { useState } from 'react'
import { Building2, Plus, Pencil, Trash2, MapPin, Phone } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface SucursalForm {
  nombre: string
  direccion: string
  telefono: string
}

const EMPTY: SucursalForm = { nombre: '', direccion: '', telefono: '' }

export default function SucursalesPage() {
  const { tenant, loadUserData } = useAuthStore()
  const qc = useQueryClient()
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<SucursalForm>(EMPTY)

  const { data: sucursales = [], isLoading } = useQuery({
    queryKey: ['sucursales', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sucursales')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const openCreate = () => {
    setEditId(null)
    setForm(EMPTY)
    setModal(true)
  }

  const openEdit = (s: any) => {
    setEditId(s.id)
    setForm({ nombre: s.nombre, direccion: s.direccion ?? '', telefono: s.telefono ?? '' })
    setModal(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form.nombre.trim()) throw new Error('El nombre es obligatorio')
      if (editId) {
        const { error } = await supabase
          .from('sucursales')
          .update({ nombre: form.nombre.trim(), direccion: form.direccion.trim() || null, telefono: form.telefono.trim() || null })
          .eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('sucursales')
          .insert({ tenant_id: tenant!.id, nombre: form.nombre.trim(), direccion: form.direccion.trim() || null, telefono: form.telefono.trim() || null })
        if (error) throw error
      }
    },
    onSuccess: async () => {
      toast.success(editId ? 'Sucursal actualizada' : 'Sucursal creada')
      setModal(false)
      qc.invalidateQueries({ queryKey: ['sucursales', tenant?.id] })
      // Recargar sucursales en authStore para que el selector del header se actualice
      const { data: { user } } = await supabase.auth.getUser()
      if (user) loadUserData(user.id)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sucursales').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: async () => {
      toast.success('Sucursal eliminada')
      qc.invalidateQueries({ queryKey: ['sucursales', tenant?.id] })
      const { data: { user } } = await supabase.auth.getUser()
      if (user) loadUserData(user.id)
    },
    onError: (e: any) => toast.error(e.message),
  })

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={24} className="text-primary dark:text-blue-400" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Sucursales</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gestioná las sucursales de tu negocio</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus size={16} /> Nueva sucursal
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : sucursales.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
          <Building2 size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">Sin sucursales configuradas</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Creá tu primera sucursal para comenzar a filtrar datos por ubicación
          </p>
          <button onClick={openCreate}
            className="mt-4 flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors mx-auto">
            <Plus size={16} /> Nueva sucursal
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sucursales.map((s: any) => (
            <div key={s.id}
              className="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <Building2 size={18} className="text-primary dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white">{s.nombre}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {s.direccion && (
                    <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <MapPin size={11} /> {s.direccion}
                    </span>
                  )}
                  {s.telefono && (
                    <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <Phone size={11} /> {s.telefono}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(s)}
                  className="p-2 text-gray-400 hover:text-primary dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors">
                  <Pencil size={15} />
                </button>
                <button onClick={() => {
                  if (confirm(`¿Eliminar "${s.nombre}"?`)) remove.mutate(s.id)
                }}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {editId ? 'Editar sucursal' : 'Nueva sucursal'}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  value={form.nombre}
                  onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Casa Central, Sucursal Norte"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dirección</label>
                <input
                  value={form.direccion}
                  onChange={(e) => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Ej: Av. Corrientes 1234"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teléfono</label>
                <input
                  value={form.telefono}
                  onChange={(e) => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="Ej: +54 11 1234-5678"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setModal(false)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="flex-1 bg-primary text-white rounded-xl py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">
                {save.isPending ? 'Guardando…' : editId ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
