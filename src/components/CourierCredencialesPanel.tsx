import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Save, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { COURIERS_API, camposCredencialesDe } from '@/lib/couriers/catalogo'
import toast from 'react-hot-toast'

// ISS-174 F1 — carga de credenciales de API de courier por tenant.
// Owner-only. Las credenciales se guardan en courier_credenciales (JSONB) y todavía
// no se usan: las consumirán las Edge Functions de cotización/generación (F2+).

interface CredRow {
  id: string
  courier: string
  credenciales: Record<string, string>
  activo: boolean
}

export function CourierCredencialesPanel() {
  const { user, tenant } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = user?.rol === 'DUEÑO'
  const tenantId = tenant?.id

  const { data: rows = [] } = useQuery({
    queryKey: ['courier-credenciales', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('courier_credenciales')
        .select('id, courier, credenciales, activo')
        .eq('tenant_id', tenantId)
      if (error) throw error
      return (data ?? []) as CredRow[]
    },
  })

  const rowByCourier = (c: string) => rows.find(r => r.courier === c)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
      <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Truck size={18} className="text-accent" /> Credenciales de courier (cotización por API)
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
        Cargá las credenciales de API de cada courier con el que tengas contrato. Se usan para cotizar y generar envíos automáticamente. Cada negocio usa su propia cuenta.
      </p>
      <div className="space-y-2">
        {COURIERS_API.map(courier => (
          <CourierItem
            key={courier}
            courier={courier}
            row={rowByCourier(courier)}
            canEdit={canEdit}
            tenantId={tenantId}
            onSaved={() => qc.invalidateQueries({ queryKey: ['courier-credenciales', tenantId] })}
          />
        ))}
      </div>
    </div>
  )
}

function CourierItem({ courier, row, canEdit, tenantId, onSaved }: {
  courier: string
  row?: CredRow
  canEdit: boolean
  tenantId?: string
  onSaved: () => void
}) {
  const campos = camposCredencialesDe(courier)
  const [open, setOpen] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [activo, setActivo] = useState(true)

  // Sincroniza el form con la fila al cargar/cambiar
  useEffect(() => {
    setVals(row?.credenciales ?? {})
    setActivo(row?.activo ?? true)
  }, [row])

  const configurado = !!row && campos.some(c => (row.credenciales?.[c.key] ?? '').trim() !== '')

  const guardar = useMutation({
    mutationFn: async () => {
      const credenciales: Record<string, string> = {}
      campos.forEach(c => { const v = (vals[c.key] ?? '').trim(); if (v) credenciales[c.key] = v })
      const payload = {
        id: row?.id ?? crypto.randomUUID(),
        tenant_id: tenantId,
        courier,
        credenciales,
        activo,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('courier_credenciales')
        .upsert(payload, { onConflict: 'tenant_id,courier' })
      if (error) throw error
    },
    onSuccess: () => { toast.success(`Credenciales de ${courier} guardadas`); onSaved() },
    onError: (e: any) => toast.error(e?.message ?? 'Error al guardar'),
  })

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
        {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        <span className="font-medium text-gray-700 dark:text-gray-300">{courier}</span>
        {configurado
          ? <span className="ml-auto flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><CheckCircle2 size={13} /> Configurado</span>
          : <span className="ml-auto text-xs text-gray-400">Sin configurar</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100 dark:border-gray-700">
          {campos.map(c => (
            <div key={c.key}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{c.label}</label>
              <input
                type={c.secreto ? 'password' : 'text'}
                value={vals[c.key] ?? ''}
                disabled={!canEdit}
                autoComplete="off"
                onChange={e => setVals(v => ({ ...v, [c.key]: e.target.value }))}
                placeholder={c.placeholder}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 pt-1">
            <input type="checkbox" checked={activo} disabled={!canEdit}
              onChange={e => setActivo(e.target.checked)} className="accent-accent" />
            Activo (usar este courier para cotizar)
          </label>
          {canEdit && (
            <div className="flex justify-end pt-1">
              <button onClick={() => guardar.mutate()} disabled={guardar.isPending}
                className="px-4 py-1.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-lg transition-all disabled:opacity-60 text-xs flex items-center gap-1.5">
                <Save size={13} /> {guardar.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
