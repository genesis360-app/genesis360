import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Store, Plus, Trash2, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

// VF2 (I1+I2) — CRUD de canales de venta + reglas online/presencial. Owner-only.

interface CanalRow {
  id: string
  nombre: string
  clasificacion: 'online' | 'presencial'
  icono: string | null
  activo: boolean
  predefinido: boolean
  orden: number | null
}

type Reglas = { devolucion_dias: string; descuento_max_pct: string; lista_precio: string; requiere_cliente: boolean }

const reglaVacia = (r: any = {}): Reglas => ({
  devolucion_dias: r?.devolucion_dias != null ? String(r.devolucion_dias) : '',
  descuento_max_pct: r?.descuento_max_pct != null ? String(r.descuento_max_pct) : '',
  lista_precio: r?.lista_precio ?? '',
  requiere_cliente: !!r?.requiere_cliente,
})

export function CanalesVentaPanel() {
  const { user, tenant, setTenant } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = user?.rol === 'DUEÑO'
  const tenantId = tenant?.id

  const { data: canales = [] } = useQuery({
    queryKey: ['canales-venta', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('canales_venta')
        .select('id, nombre, clasificacion, icono, activo, predefinido, orden')
        .eq('tenant_id', tenantId).order('orden', { ascending: true, nullsFirst: false }).order('nombre')
      if (error) throw error
      return (data ?? []) as CanalRow[]
    },
  })

  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevaClasif, setNuevaClasif] = useState<'online' | 'presencial'>('presencial')
  const [online, setOnline] = useState<Reglas>(reglaVacia((tenant as any)?.reglas_canal?.online))
  const [presencial, setPresencial] = useState<Reglas>(reglaVacia((tenant as any)?.reglas_canal?.presencial))
  const [savingReglas, setSavingReglas] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['canales-venta', tenantId] })

  const agregar = async () => {
    const nombre = nuevoNombre.trim()
    if (!nombre) return
    const { error } = await supabase.from('canales_venta').insert({
      id: crypto.randomUUID(), tenant_id: tenantId, nombre, clasificacion: nuevaClasif, predefinido: false,
      orden: (canales.reduce((m, c) => Math.max(m, c.orden ?? 0), 0)) + 1,
    })
    if (error) { toast.error(error.message.includes('duplicate') ? 'Ya existe un canal con ese nombre' : error.message); return }
    setNuevoNombre(''); refresh(); toast.success('Canal agregado')
  }

  const actualizar = async (id: string, patch: Partial<CanalRow>) => {
    const { error } = await supabase.from('canales_venta').update(patch).eq('id', id)
    if (error) { toast.error(error.message); return }
    refresh()
  }

  const eliminar = async (c: CanalRow) => {
    if (c.predefinido) { toast.error('Los canales predefinidos no se eliminan; podés desactivarlos'); return }
    const { error } = await supabase.from('canales_venta').delete().eq('id', c.id)
    if (error) { toast.error(error.message); return }
    refresh(); toast.success('Canal eliminado')
  }

  const guardarReglas = async () => {
    setSavingReglas(true)
    const pack = (r: Reglas) => ({
      devolucion_dias: r.devolucion_dias !== '' ? parseInt(r.devolucion_dias) : null,
      descuento_max_pct: r.descuento_max_pct !== '' ? parseFloat(r.descuento_max_pct) : null,
      lista_precio: r.lista_precio || null,
      requiere_cliente: r.requiere_cliente,
    })
    const reglas_canal = { online: pack(online), presencial: pack(presencial) }
    const { data, error } = await supabase.from('tenants').update({ reglas_canal }).eq('id', tenantId).select().single()
    setSavingReglas(false)
    if (error) { toast.error(error.message); return }
    if (data) setTenant(data as any)   // sincroniza el store (evita valores viejos al re-mount)
    toast.success('Reglas por canal guardadas')
  }

  return (
    <div className="space-y-4">
      {/* Catálogo de canales */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Store size={18} className="text-accent" /> Canales de venta
        </h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
          Definí los canales que aparecen en el POS y clasificá cada uno como <strong>online</strong> o <strong>presencial</strong> (las reglas de abajo se aplican según esa clasificación). MercadoPago no es un canal: es un medio de pago.
        </p>
        <div className="space-y-2">
          {canales.map(c => (
            <div key={c.id} className="flex items-center gap-2 flex-wrap">
              <span className="w-6 text-center">{c.icono ?? '•'}</span>
              <span className="flex-1 min-w-[120px] text-sm text-gray-700 dark:text-gray-200">{c.nombre}</span>
              <select value={c.clasificacion} disabled={!canEdit}
                onChange={e => actualizar(c.id, { clasificacion: e.target.value as any })}
                className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                <option value="presencial">Presencial</option>
                <option value="online">Online</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-gray-500">
                <input type="checkbox" checked={c.activo} disabled={!canEdit}
                  onChange={e => actualizar(c.id, { activo: e.target.checked })} className="accent-accent" />
                Activo
              </label>
              {canEdit && !c.predefinido && (
                <button onClick={() => eliminar(c)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} placeholder="Nuevo canal (ej: Showroom)"
              className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            <select value={nuevaClasif} onChange={e => setNuevaClasif(e.target.value as any)}
              className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
              <option value="presencial">Presencial</option>
              <option value="online">Online</option>
            </select>
            <button onClick={agregar} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium flex items-center gap-1"><Plus size={14} /> Agregar</button>
          </div>
        )}
      </div>

      {/* Reglas por clasificación (I2) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
        <h3 className="font-semibold text-gray-700 dark:text-gray-300">Reglas por tipo de canal (online vs presencial)</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">Vacío = usa la regla general del negocio. Se aplican según la clasificación del canal de cada venta.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {([['online', online, setOnline], ['presencial', presencial, setPresencial]] as const).map(([key, r, setR]) => (
            <div key={key} className="rounded-xl border border-gray-200 dark:border-gray-600 p-3 space-y-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 capitalize">{key}</p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Plazo de devolución (días)</label>
                <input type="number" min="0" value={r.devolucion_dias} disabled={!canEdit}
                  onChange={e => setR(p => ({ ...p, devolucion_dias: e.target.value }))} placeholder="Sin límite"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descuento máximo (%)</label>
                <input type="number" min="0" max="100" value={r.descuento_max_pct} disabled={!canEdit}
                  onChange={e => setR(p => ({ ...p, descuento_max_pct: e.target.value }))} placeholder="Sin tope extra"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Lista de precios por defecto</label>
                <select value={r.lista_precio} disabled={!canEdit}
                  onChange={e => setR(p => ({ ...p, lista_precio: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                  <option value="">Por cantidad (default)</option>
                  <option value="minorista">Siempre minorista</option>
                  <option value="mayorista">Siempre mayorista</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 pt-1">
                <input type="checkbox" checked={r.requiere_cliente} disabled={!canEdit}
                  onChange={e => setR(p => ({ ...p, requiere_cliente: e.target.checked }))} className="accent-accent" />
                Cliente obligatorio en este tipo de canal
              </label>
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <button onClick={guardarReglas} disabled={savingReglas}
              className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60 text-sm flex items-center gap-2">
              <Save size={15} /> {savingReglas ? 'Guardando…' : 'Guardar reglas'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
