import { useState } from 'react'
import { Building2, Plus, Pencil, Trash2, MapPin, Phone, Truck, Navigation, Check, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface SucursalForm {
  nombre: string
  direccion: string
  telefono: string
  costo_km_envio: string
  codigo: string
}

const EMPTY: SucursalForm = { nombre: '', direccion: '', telefono: '', costo_km_envio: '', codigo: '' }

const COURIERS_DEFAULT = ['OCA', 'Correo Argentino', 'Andreani', 'DHL Express', 'FedEx', 'Otro']

export default function SucursalesPage() {
  const { tenant, loadUserData } = useAuthStore()
  const qc = useQueryClient()
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<SucursalForm>(EMPTY)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Courier tarifas inline edit
  const [courierEdit, setCourierEdit] = useState<{ courier: string; precio: string } | null>(null)

  const { data: sucursales = [], isLoading } = useQuery({
    queryKey: ['sucursales', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sucursales').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: courierTarifas = [] } = useQuery({
    queryKey: ['courier_tarifas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('courier_tarifas')
        .select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('courier')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const openCreate = () => { setEditId(null); setForm(EMPTY); setModal(true) }
  const openEdit = (s: any) => {
    setEditId(s.id)
    setForm({
      nombre: s.nombre,
      direccion: s.direccion ?? '',
      telefono: s.telefono ?? '',
      costo_km_envio: s.costo_km_envio != null ? String(s.costo_km_envio) : '',
      codigo: s.codigo ?? '',
    })
    setModal(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form.nombre.trim()) throw new Error('El nombre es obligatorio')
      if (!form.direccion.trim()) throw new Error('La dirección es obligatoria para calcular distancias de envío')
      const payload = {
        nombre: form.nombre.trim(),
        direccion: form.direccion.trim(),
        telefono: form.telefono.trim() || null,
        costo_km_envio: form.costo_km_envio ? parseFloat(form.costo_km_envio) : 0,
        codigo: form.codigo.trim().toUpperCase() || null,
      }
      if (editId) {
        const { error } = await supabase.from('sucursales').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('sucursales').insert({ tenant_id: tenant!.id, ...payload })
        if (error) throw error
      }
    },
    onSuccess: async () => {
      toast.success(editId ? 'Sucursal actualizada' : 'Sucursal creada')
      setModal(false)
      qc.invalidateQueries({ queryKey: ['sucursales', tenant?.id] })
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

  const saveCourierTarifa = async (sucursalId: string, courier: string, precio: string) => {
    const precioNum = parseFloat(precio) || 0
    const { error } = await supabase.from('courier_tarifas').upsert(
      { tenant_id: tenant!.id, sucursal_id: sucursalId, courier, precio: precioNum, activo: true },
      { onConflict: 'tenant_id,sucursal_id,courier' }
    )
    if (error) { toast.error(error.message); return }
    toast.success(`Tarifa de ${courier} actualizada`)
    qc.invalidateQueries({ queryKey: ['courier_tarifas', tenant?.id] })
    setCourierEdit(null)
  }

  const getTarifa = (sucursalId: string, courier: string) =>
    (courierTarifas as any[]).find(t => t.sucursal_id === sucursalId && t.courier === courier)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={24} className="text-primary dark:text-blue-400" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Sucursales</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gestioná las sucursales y tarifas de envío</p>
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
          <button onClick={openCreate}
            className="mt-4 flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors mx-auto">
            <Plus size={16} /> Nueva sucursal
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sucursales.map((s: any) => (
            <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              {/* Header de la sucursal */}
              <div className="flex items-center gap-4 px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <Building2 size={18} className="text-primary dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-white">{s.nombre}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
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
                    {s.costo_km_envio > 0 && (
                      <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                        <Navigation size={11} /> ${Number(s.costo_km_envio).toLocaleString('es-AR')}/km
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-accent px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <Truck size={13} /> Couriers
                  </button>
                  <button onClick={() => openEdit(s)}
                    className="p-2 text-gray-400 hover:text-primary dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => { if (confirm(`¿Eliminar "${s.nombre}"?`)) remove.mutate(s.id) }}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Panel de tarifas de couriers (expandible) */}
              {expandedId === s.id && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-700/40">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <Truck size={11} /> Tarifas de couriers para {s.nombre}
                  </p>
                  <div className="space-y-1.5">
                    {COURIERS_DEFAULT.map(courier => {
                      const tarifa = getTarifa(s.id, courier)
                      const isEditing = courierEdit?.courier === `${s.id}:${courier}`
                      return (
                        <div key={courier} className="flex items-center gap-2">
                          <span className="text-xs text-gray-700 dark:text-gray-300 w-36 flex-shrink-0">{courier}</span>
                          {isEditing ? (
                            <>
                              <input
                                autoFocus
                                type="number"
                                min="0"
                                step="0.01"
                                value={courierEdit!.precio}
                                onChange={e => setCourierEdit(c => c ? { ...c, precio: e.target.value } : c)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveCourierTarifa(s.id, courier, courierEdit!.precio)
                                  if (e.key === 'Escape') setCourierEdit(null)
                                }}
                                placeholder="0.00"
                                className="w-28 px-2 py-1 border border-accent rounded-lg text-xs text-right bg-white dark:bg-gray-700 text-primary focus:outline-none"
                              />
                              <button onClick={() => saveCourierTarifa(s.id, courier, courierEdit!.precio)}
                                className="text-green-600 p-0.5"><Check size={13} /></button>
                              <button onClick={() => setCourierEdit(null)}
                                className="text-gray-400 p-0.5"><X size={13} /></button>
                            </>
                          ) : (
                            <button
                              onClick={() => setCourierEdit({ courier: `${s.id}:${courier}`, precio: tarifa ? String(tarifa.precio) : '' })}
                              className="text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-accent hover:text-accent transition-colors min-w-[72px] text-right">
                              {tarifa ? `$${Number(tarifa.precio).toLocaleString('es-AR')}` : '— sin precio —'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">Click en el precio para editar. ENTER para guardar.</p>
                </div>
              )}
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
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nombre <span className="text-red-500">*</span>
                  </label>
                  <input autoFocus value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Casa Central, Sucursal Norte"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Código ticket
                  </label>
                  <input value={form.codigo}
                    onChange={e => setForm(f => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                    placeholder="S1"
                    maxLength={5}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
                  <p className="text-xs text-gray-400 mt-1">Prefijo del # de venta</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Dirección <span className="text-red-500">*</span>
                  <span className="text-xs text-gray-400 ml-1 font-normal">(necesaria para calcular distancias de envío)</span>
                </label>
                <input value={form.direccion}
                  onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Ej: Av. Corrientes 1234, Buenos Aires"
                  className={`w-full border rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary
                    ${!form.direccion.trim() ? 'border-amber-300 dark:border-amber-600' : 'border-gray-200 dark:border-gray-600'}`} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teléfono</label>
                <input value={form.telefono}
                  onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="Ej: +54 11 1234-5678"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <Navigation size={13} className="inline mr-1" />
                  Costo por km (envío propio) <span className="text-xs text-gray-400 font-normal">— varía por sucursal</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={form.costo_km_envio}
                    onChange={e => setForm(f => ({ ...f, costo_km_envio: e.target.value }))}
                    placeholder="0.00"
                    onWheel={e => e.currentTarget.blur()}
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
                  <span className="text-xs text-gray-400">/ km</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Se usa para calcular el costo automáticamente al crear un envío propio.</p>
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
