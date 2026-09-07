import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Save, ChevronDown, ChevronRight, CheckCircle2, Plug, XCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { COURIERS_API, camposCredencialesDe } from '@/lib/couriers/catalogo'
import { probarCredencialesCourier } from '@/lib/couriers/api'
import toast from 'react-hot-toast'

// ISS-174 F1 — carga de credenciales de API de courier por tenant.
// Owner-only. Las credenciales se guardan en courier_credenciales (JSONB) y todavía
// no se usan: las consumirán las Edge Functions de cotización/generación (F2+).

interface CredRow {
  id: string
  courier: string
  /** ¿Hay credenciales cargadas? Las credenciales EN SÍ no se pueden leer desde el browser
   *  (mig 403): son un secreto de solo escritura y esta columna generada es lo único que vuelve. */
  credenciales_configuradas: boolean
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
        .select('id, courier, activo, credenciales_configuradas')
        .eq('tenant_id', tenantId)
      if (error) throw error
      return (data ?? []) as CredRow[]
    },
  })

  const rowByCourier = (c: string) => rows.find(r => r.courier === c)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
      <h3 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Truck size={18} className="text-accent-text" /> Credenciales de courier (cotización por API)
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

  // 🔒 Las credenciales son un SECRETO DE SOLO ESCRITURA (mig 403): el browser no puede leerlas, así
  // que el form arranca siempre vacío. Al cambiarlas hay que reingresarlas COMPLETAS — sin poder leer
  // las guardadas no hay forma de hacer un merge parcial, y guardar la mitad borraría la otra mitad.
  useEffect(() => {
    setVals({})
    setActivo(row?.activo ?? true)
    setProbado(null)
  }, [row])

  const [probado, setProbado] = useState<{ ok: boolean; msg: string } | null>(null)

  const configurado = !!row?.credenciales_configuradas
  // Hay algo tipeado sin guardar → probar testearía las claves viejas, no las de la pantalla.
  const dirty = campos.some(c => (vals[c.key] ?? '').trim() !== '')

  const probar = useMutation({
    mutationFn: () => probarCredencialesCourier(courier),
    onMutate: () => setProbado(null),
    onSuccess: (r) => {
      const msg = r.detalle ?? 'Credenciales válidas.'
      setProbado({ ok: true, msg })
      toast.success(`${courier}: ${msg}`)
    },
    onError: (e: any) => {
      const msg = e?.message ?? 'No se pudieron validar las credenciales.'
      setProbado({ ok: false, msg })
      toast.error(`${courier}: ${msg}`)
    },
  })

  const guardar = useMutation({
    mutationFn: async () => {
      // Solo-actividad: si no se tipeó nada, NO se manda `credenciales` — mandar el objeto vacío
      // borraría las guardadas, que el browser ya no puede leer para reconstruirlas (mig 403).
      if (!dirty) {
        if (!row) throw new Error('Cargá las credenciales antes de guardar')
        const { error } = await supabase.from('courier_credenciales')
          .update({ activo, updated_at: new Date().toISOString() }).eq('id', row.id)
        if (error) throw error
        return
      }
      // Se está reemplazando el secreto → tienen que venir TODOS los campos: sin poder leer los
      // guardados no hay merge parcial posible, y guardar la mitad dejaría el courier inutilizable.
      const faltantes = campos.filter(c => (vals[c.key] ?? '').trim() === '').map(c => c.label)
      if (faltantes.length) {
        throw new Error(`Reingresá TODAS las credenciales para reemplazarlas. Falta: ${faltantes.join(', ')}`)
      }
      const credenciales: Record<string, string> = {}
      campos.forEach(c => { credenciales[c.key] = (vals[c.key] ?? '').trim() })
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
                placeholder={configurado ? '•••••••• (guardado)' : c.placeholder}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800" />
            </div>
          ))}
          {configurado && (
            <p className="text-xs text-gray-400">
              Por seguridad no se muestran. Dejalas vacías para conservarlas; para reemplazarlas hay que
              reingresarlas <strong>todas</strong>.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 pt-1">
            <input type="checkbox" checked={activo} disabled={!canEdit}
              onChange={e => setActivo(e.target.checked)} className="accent-accent" />
            Activo (usar este courier para cotizar)
          </label>
          {probado && (
            <div className={`flex items-start gap-1.5 text-xs rounded-lg px-2.5 py-1.5 ${probado.ok
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
              {probado.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <XCircle size={13} className="mt-0.5 shrink-0" />}
              <span>{probado.msg}</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => probar.mutate()}
              disabled={probar.isPending || !configurado || dirty}
              title={!configurado ? 'Guardá las credenciales primero' : dirty ? 'Guardá los cambios antes de probar' : 'Valida las credenciales contra el courier'}
              className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center gap-1.5">
              {probar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
              {probar.isPending ? 'Probando…' : 'Probar credenciales'}
            </button>
            {dirty && canEdit && <span className="text-xs text-amber-600 dark:text-amber-400">Guardá los cambios para probar</span>}
            {canEdit && (
              <button onClick={() => guardar.mutate()} disabled={guardar.isPending}
                className="ml-auto px-4 py-1.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-lg transition-all disabled:opacity-60 text-xs flex items-center gap-1.5">
                <Save size={13} /> {guardar.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
