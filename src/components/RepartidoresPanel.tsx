import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// EN3/G1 — Catálogo de repartidores (envío propio). CRUD en Config → Envíos.

interface Repartidor {
  id: string; nombre: string; telefono: string | null; vehiculo: string | null
  empleado_id: string | null; activo: boolean
}
const VACIO = { nombre: '', telefono: '', vehiculo: '', empleado_id: '' }

export default function RepartidoresPanel({ canEdit }: { canEdit: boolean }) {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [form, setForm] = useState(VACIO)
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: repartidores = [] } = useQuery({
    queryKey: ['repartidores', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('repartidores')
        .select('id, nombre, telefono, vehiculo, empleado_id, activo')
        .eq('tenant_id', tenant!.id).order('nombre')
      return (data ?? []) as Repartidor[]
    },
    enabled: !!tenant,
  })

  const { data: empleados = [] } = useQuery({
    queryKey: ['empleados-repartidor', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('empleados')
        .select('id, nombre, apellido, tel_personal').eq('tenant_id', tenant!.id).eq('activo', true)
      return data ?? []
    },
    enabled: !!tenant && showForm,
  })

  const guardar = async () => {
    if (!form.nombre.trim()) { toast.error('Indicá el nombre'); return }
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenant!.id, nombre: form.nombre.trim(),
        telefono: form.telefono.trim() || null, vehiculo: form.vehiculo.trim() || null,
        empleado_id: form.empleado_id || null,
      }
      if (editId) {
        const { error } = await supabase.from('repartidores').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('repartidores').insert(payload)
        if (error) throw error
      }
      toast.success(editId ? 'Repartidor actualizado' : 'Repartidor agregado')
      qc.invalidateQueries({ queryKey: ['repartidores'] })
      setForm(VACIO); setEditId(null); setShowForm(false)
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar') }
    finally { setSaving(false) }
  }

  const toggleActivo = async (r: Repartidor) => {
    await supabase.from('repartidores').update({ activo: !r.activo }).eq('id', r.id)
    qc.invalidateQueries({ queryKey: ['repartidores'] })
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Bike size={18} className="text-accent" /> Repartidores (envío propio)
        </h3>
        {canEdit && !showForm && (
          <button onClick={() => { setForm(VACIO); setEditId(null); setShowForm(true) }}
            className="text-xs flex items-center gap-1 text-accent hover:underline"><Plus size={13} /> Agregar</button>
        )}
      </div>

      {showForm && canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
          <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre *"
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Teléfono"
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          <input value={form.vehiculo} onChange={e => setForm(f => ({ ...f, vehiculo: e.target.value }))} placeholder="Vehículo (moto/auto)"
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          <select value={form.empleado_id} onChange={e => {
              const emp = (empleados as any[]).find(x => x.id === e.target.value)
              setForm(f => ({ ...f, empleado_id: e.target.value, nombre: f.nombre || (emp ? `${emp.nombre} ${emp.apellido ?? ''}`.trim() : ''), telefono: f.telefono || (emp?.tel_personal ?? '') }))
            }}
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
            <option value="">Empleado RRHH (opcional)</option>
            {(empleados as any[]).map(e2 => <option key={e2.id} value={e2.id}>{e2.nombre} {e2.apellido ?? ''}</option>)}
          </select>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setEditId(null); setForm(VACIO) }}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500"><X size={13} /></button>
            <button onClick={guardar} disabled={saving}
              className="px-4 py-1.5 text-xs bg-accent text-white rounded-lg flex items-center gap-1 disabled:opacity-50"><Check size={13} /> {saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {repartidores.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Sin repartidores cargados.</p>
      ) : (
        <div className="space-y-1.5">
          {repartidores.map(r => (
            <div key={r.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${r.activo ? 'border-gray-100 dark:border-gray-700' : 'border-gray-100 dark:border-gray-700 opacity-50'}`}>
              <Bike size={15} className="text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{r.nombre}</p>
                <p className="text-xs text-gray-400">{[r.vehiculo, r.telefono].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              {canEdit && (
                <>
                  <button onClick={() => toggleActivo(r)} className="text-xs text-gray-400 hover:text-accent">{r.activo ? 'Activo' : 'Inactivo'}</button>
                  <button onClick={() => { setForm({ nombre: r.nombre, telefono: r.telefono ?? '', vehiculo: r.vehiculo ?? '', empleado_id: r.empleado_id ?? '' }); setEditId(r.id); setShowForm(true) }}
                    className="p-1 text-gray-400 hover:text-accent"><Pencil size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
