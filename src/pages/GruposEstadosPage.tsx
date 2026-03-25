import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Star, StarOff, Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface Estado { id: string; nombre: string; color: string }
interface GrupoItem { estado_id: string }
interface Grupo {
  id: string
  nombre: string
  descripcion?: string
  es_default: boolean
  activo: boolean
  grupo_estado_items: GrupoItem[]
}

export default function GruposEstadosPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ nombre: '', descripcion: '', es_default: false, estados: [] as string[] })

  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario').select('*')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return (data ?? []) as Estado[]
    },
    enabled: !!tenant,
  })

  const { data: grupos = [], isLoading } = useQuery({
    queryKey: ['grupos_estados', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('grupos_estados')
        .select('*, grupo_estado_items(estado_id)')
        .eq('tenant_id', tenant!.id)
        .order('es_default', { ascending: false })
        .order('nombre')
      if (error) throw error
      return (data ?? []) as Grupo[]
    },
    enabled: !!tenant,
  })

  const resetForm = () => {
    setForm({ nombre: '', descripcion: '', es_default: false, estados: [] })
    setEditId(null)
    setShowForm(false)
  }

  const startEdit = (grupo: Grupo) => {
    setForm({
      nombre: grupo.nombre,
      descripcion: grupo.descripcion ?? '',
      es_default: grupo.es_default,
      estados: grupo.grupo_estado_items.map(i => i.estado_id),
    })
    setEditId(grupo.id)
    setShowForm(true)
  }

  const toggleEstado = (estadoId: string) => {
    setForm(p => ({
      ...p,
      estados: p.estados.includes(estadoId)
        ? p.estados.filter(id => id !== estadoId)
        : [...p.estados, estadoId],
    }))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.nombre.trim()) throw new Error('El nombre es obligatorio')
      if (form.estados.length === 0) throw new Error('Seleccioná al menos un estado')

      // Si se marca como default, quitar default de los otros
      if (form.es_default) {
        await supabase.from('grupos_estados')
          .update({ es_default: false })
          .eq('tenant_id', tenant!.id)
      }

      if (editId) {
        // Actualizar grupo
        const { error } = await supabase.from('grupos_estados')
          .update({ nombre: form.nombre.trim(), descripcion: form.descripcion || null, es_default: form.es_default })
          .eq('id', editId)
        if (error) throw error

        // Reemplazar items
        await supabase.from('grupo_estado_items').delete().eq('grupo_id', editId)
        await supabase.from('grupo_estado_items').insert(
          form.estados.map(eid => ({ grupo_id: editId, estado_id: eid }))
        )
      } else {
        // Crear grupo
        const { data: grupo, error } = await supabase.from('grupos_estados')
          .insert({ tenant_id: tenant!.id, nombre: form.nombre.trim(), descripcion: form.descripcion || null, es_default: form.es_default })
          .select().single()
        if (error) throw error

        await supabase.from('grupo_estado_items').insert(
          form.estados.map(eid => ({ grupo_id: grupo.id, estado_id: eid }))
        )
      }
    },
    onSuccess: () => {
      toast.success(editId ? 'Grupo actualizado' : 'Grupo creado')
      qc.invalidateQueries({ queryKey: ['grupos_estados'] })
      resetForm()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setDefault = useMutation({
    mutationFn: async (grupoId: string) => {
      await supabase.from('grupos_estados').update({ es_default: false }).eq('tenant_id', tenant!.id)
      await supabase.from('grupos_estados').update({ es_default: true }).eq('id', grupoId)
    },
    onSuccess: () => { toast.success('Grupo default actualizado'); qc.invalidateQueries({ queryKey: ['grupos_estados'] }) },
  })

  const deleteMutation = useMutation({
    mutationFn: async (grupoId: string) => {
      const { error } = await supabase.from('grupos_estados').delete().eq('id', grupoId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Grupo eliminado'); qc.invalidateQueries({ queryKey: ['grupos_estados'] }) },
    onError: () => toast.error('Error al eliminar'),
  })

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Grupos de estados</h1>
          <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm mt-0.5">
            Agrupá estados para usarlos como filtros rápidos en Rebaje y Ventas
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <Plus size={16} /> Nuevo grupo
          </button>
        )}
      </div>

      {/* Aviso si no hay estados */}
      {estados.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          ⚠️ Primero creá estados en <strong>Configuración → Estados</strong> para poder armar grupos.
        </div>
      )}

      {/* Formulario */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-accent/30 space-y-4">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">{editId ? 'Editar grupo' : 'Nuevo grupo'}</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre del grupo *</label>
              <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder="Ej: Disponible para venta"
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción (opcional)</label>
              <input type="text" value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Ej: Estados disponibles para vender"
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
            </div>
          </div>

          {/* Selección de estados */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Estados incluidos en este grupo *
              <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">({form.estados.length} seleccionado{form.estados.length !== 1 ? 's' : ''})</span>
            </label>
            {estados.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No hay estados creados aún</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {estados.map(e => {
                  const selected = form.estados.includes(e.id)
                  return (
                    <button key={e.id} type="button" onClick={() => toggleEstado(e.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all
                        ${selected ? 'border-accent bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:border-gray-600'}`}>
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                      <span className="truncate">{e.nombre}</span>
                      {selected && <Check size={13} className="text-accent ml-auto flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Default toggle */}
          <label className="flex items-center gap-3 cursor-pointer p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl">
            <div className="relative">
              <input type="checkbox" checked={form.es_default}
                onChange={e => setForm(p => ({ ...p, es_default: e.target.checked }))} className="sr-only" />
              <div className={`w-10 h-5 rounded-full transition-colors ${form.es_default ? 'bg-amber-50 dark:bg-amber-900/200' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white dark:bg-gray-800 rounded-full shadow transition-transform ${form.es_default ? 'translate-x-5' : ''}`} />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Marcar como filtro por defecto</p>
              <p className="text-xs text-amber-600 dark:text-amber-400">Este grupo aparecerá preseleccionado en Rebaje y Ventas</p>
            </div>
          </label>

          <div className="flex gap-3 justify-end">
            <button onClick={resetForm}
              className="px-5 py-2.5 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500 font-semibold rounded-xl hover:border-gray-300 dark:border-gray-600 text-sm">
              Cancelar
            </button>
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50">
              {saveMutation.isPending ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear grupo'}
            </button>
          </div>
        </div>
      )}

      {/* Lista de grupos */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : grupos.length === 0 && !showForm ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-100 text-center text-gray-400 dark:text-gray-500">
          <Layers size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay grupos creados aún</p>
          <p className="text-sm mt-1">Creá un grupo para usarlo como filtro rápido</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(grupo => {
            const estadosGrupo = grupo.grupo_estado_items
              .map(i => estados.find(e => e.id === i.estado_id))
              .filter(Boolean) as Estado[]

            return (
              <div key={grupo.id} className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border transition-all
                ${grupo.es_default ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20/30' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800 dark:text-gray-100">{grupo.nombre}</h3>
                      {grupo.es_default && (
                        <span className="flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                          <Star size={10} /> Default
                        </span>
                      )}
                    </div>
                    {grupo.descripcion && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{grupo.descripcion}</p>
                    )}
                    {/* Estados del grupo */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {estadosGrupo.length === 0 ? (
                        <span className="text-xs text-gray-400 dark:text-gray-500 italic">Sin estados asignados</span>
                      ) : estadosGrupo.map(e => (
                        <span key={e.id} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium text-white"
                          style={{ backgroundColor: e.color }}>
                          {e.nombre}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!grupo.es_default && (
                      <button onClick={() => setDefault.mutate(grupo.id)} title="Marcar como default"
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-amber-500 hover:bg-amber-50 dark:bg-amber-900/20 rounded-lg transition-colors">
                        <StarOff size={15} />
                      </button>
                    )}
                    <button onClick={() => startEdit(grupo)}
                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => { if (confirm('¿Eliminar este grupo?')) deleteMutation.mutate(grupo.id) }}
                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
