import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ScanBarcode, Plus, Trash2, Edit2, X, Save, Power } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { AIS_SOPORTADOS } from '@/lib/gs1'
import toast from 'react-hot-toast'

interface PerfilRow {
  id: string
  nombre: string
  proveedor_id: string | null
  tipo: 'gs1' | 'custom'
  simbologia: 'gs1_128' | 'datamatrix' | 'qr'
  ais: string[]
  custom_format: { separador?: string } | null
  lectura_modo: 'autocompletar' | 'directo'
  activo: boolean
}

interface FormState {
  nombre: string
  proveedor_id: string
  tipo: 'gs1' | 'custom'
  simbologia: 'gs1_128' | 'datamatrix' | 'qr'
  ais: string[]
  separador: string
  lectura_modo: 'autocompletar' | 'directo'
}

const FORM_VACIO: FormState = {
  nombre: '', proveedor_id: '', tipo: 'gs1', simbologia: 'gs1_128',
  ais: ['01', '10', '17', '30'], separador: '|', lectura_modo: 'autocompletar',
}

export function CodigoPerfilesPanel() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<typeof FORM_VACIO>(FORM_VACIO)

  const { data: perfiles = [] } = useQuery({
    queryKey: ['codigo_perfiles', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('codigo_perfiles')
        .select('*').eq('tenant_id', tenant!.id).order('created_at')
      return (data ?? []) as PerfilRow[]
    },
    enabled: !!tenant,
  })

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores_perfiles', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores')
        .select('id, nombre').eq('tenant_id', tenant!.id).order('nombre')
      return (data ?? []) as any[]
    },
    enabled: !!tenant,
  })

  const resetForm = () => { setForm(FORM_VACIO); setEditId(null); setShowForm(false) }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!form.nombre.trim()) throw new Error('Poné un nombre al perfil')
      if (form.tipo === 'gs1' && form.ais.length === 0) throw new Error('Elegí al menos un campo (AI)')
      const payload = {
        tenant_id: tenant!.id,
        nombre: form.nombre.trim(),
        proveedor_id: form.proveedor_id || null,
        tipo: form.tipo,
        simbologia: form.simbologia,
        ais: form.ais,
        custom_format: form.tipo === 'custom' ? { separador: form.separador } : null,
        lectura_modo: form.lectura_modo,
      }
      if (editId) {
        const { error } = await supabase.from('codigo_perfiles').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('codigo_perfiles').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => { toast.success(editId ? 'Perfil actualizado' : 'Perfil creado'); qc.invalidateQueries({ queryKey: ['codigo_perfiles'] }); resetForm() },
    onError: (e: Error) => toast.error(e.message),
  })

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('codigo_perfiles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Perfil eliminado'); qc.invalidateQueries({ queryKey: ['codigo_perfiles'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggle = useMutation({
    mutationFn: async (p: PerfilRow) => {
      const { error } = await supabase.from('codigo_perfiles').update({ activo: !p.activo }).eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['codigo_perfiles'] }),
  })

  const startEdit = (p: PerfilRow) => {
    setEditId(p.id)
    setForm({
      nombre: p.nombre, proveedor_id: p.proveedor_id ?? '', tipo: p.tipo, simbologia: p.simbologia,
      ais: p.ais ?? [], separador: p.custom_format?.separador ?? '|', lectura_modo: p.lectura_modo,
    })
    setShowForm(true)
  }

  const toggleAi = (ai: string) => setForm(f => ({ ...f, ais: f.ais.includes(ai) ? f.ais.filter(x => x !== ai) : [...f.ais, ai] }))
  const provNombre = (id: string | null) => proveedores.find((x: any) => x.id === id)?.nombre

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <ScanBarcode size={16} className="text-accent-text" /> Códigos compuestos (GS1)
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Perfiles para leer/generar códigos con varios campos (SKU, lote, vencimiento, cantidad…).</p>
        </div>
        {!showForm && (
          <button onClick={() => { setForm(FORM_VACIO); setEditId(null); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-accent text-white rounded-xl hover:bg-accent/90">
            <Plus size={15} /> Nuevo perfil
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{editId ? 'Editar perfil' : 'Nuevo perfil'}</p>
            <button onClick={resetForm} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Proveedor X — GS1"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Proveedor (opcional)</label>
              <select value={form.proveedor_id} onChange={e => setForm(f => ({ ...f, proveedor_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="">— Ninguno —</option>
                {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="gs1">GS1 estándar</option>
                <option value="custom">Formato propio (no-GS1)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Simbología</label>
              <select value={form.simbologia} onChange={e => setForm(f => ({ ...f, simbologia: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="gs1_128">GS1-128 (barras 1D)</option>
                <option value="datamatrix">GS1 DataMatrix (2D)</option>
                <option value="qr">GS1 QR Code (2D)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Al escanear (ingreso)</label>
              <select value={form.lectura_modo} onChange={e => setForm(f => ({ ...f, lectura_modo: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                <option value="autocompletar">Autocompletar y confirmar</option>
                <option value="directo">Crear el LPN directo</option>
              </select>
            </div>
            {form.tipo === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Separador (formato propio)</label>
                <input value={form.separador} onChange={e => setForm(f => ({ ...f, separador: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Campos a incluir</label>
            <div className="flex flex-wrap gap-2">
              {AIS_SOPORTADOS.map(a => (
                <button key={a.ai} type="button" onClick={() => toggleAi(a.ai)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${form.ais.includes(a.ai) ? 'bg-accent text-white border-accent-text' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-accent-text'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={resetForm} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button onClick={() => guardar.mutate()} disabled={guardar.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50">
              <Save size={15} /> {editId ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {perfiles.length === 0 && !showForm ? (
        <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
          Sin perfiles. Creá uno para leer/generar códigos compuestos.
        </div>
      ) : (
        <div className="space-y-2">
          {perfiles.map(p => (
            <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border ${p.activo ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800' : 'border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50 opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{p.nombre}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent-text">{p.simbologia === 'datamatrix' ? 'DataMatrix' : p.simbologia === 'qr' ? 'QR' : 'GS1-128'}</span>
                  {p.tipo === 'custom' && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">custom</span>}
                  {p.proveedor_id && <span className="text-[11px] text-gray-400 dark:text-gray-500">· {provNombre(p.proveedor_id) ?? 'proveedor'}</span>}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {(p.ais ?? []).join(' · ') || '—'} · {p.lectura_modo === 'directo' ? 'LPN directo' : 'autocompletar'}
                </p>
              </div>
              <button onClick={() => toggle.mutate(p)} title={p.activo ? 'Desactivar' : 'Activar'}
                className={`p-1.5 rounded-lg ${p.activo ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                <Power size={15} />
              </button>
              <button onClick={() => startEdit(p)} className="p-1.5 text-gray-400 hover:text-accent-text hover:bg-accent/10 rounded-lg"><Edit2 size={15} /></button>
              <button onClick={() => { if (confirm('¿Eliminar este perfil?')) borrar.mutate(p.id) }} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
