import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save, Layers, CornerDownRight, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import {
  filasAForm, validarPresentaciones, construirPayload, factorBaseDe, filaBase, resumenArbol,
  type PresentacionRow, type PresentacionFila,
} from '@/lib/presentaciones'
import toast from 'react-hot-toast'

interface Props {
  productoId: string
  productoNombre: string
  /** Nombres de empaque del tenant (unidades_medida): Caja, Pallet, Bulto… */
  empaques: { id: string; nombre: string; simbolo?: string | null }[]
  canEdit?: boolean
}

/**
 * Editor del ÁRBOL de presentaciones de un producto (Fase 5, mig 310).
 *
 * Reemplaza al viejo CRUD de "Estructuras" (cadena lineal, mig 282): ahora hay UN árbol por
 * producto y cada línea declara de cuál CUELGA y cuántas contiene ("Pallet = 18 × Caja").
 * Eso habilita HERMANAS — "Caja-12" y "Caja-10" del mismo producto, ambas colgando de la unidad.
 *
 * El empaque es logística pura: acá no se carga ningún precio (mig 307). El precio vive en la
 * unidad base + los tiers por cantidad.
 */
export function PresentacionesEditor({ productoId, productoNombre, empaques, canEdit = true }: Props) {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [rows, setRows] = useState<PresentacionRow[]>([])
  const [cargado, setCargado] = useState(false)

  const { data: filas = [], isLoading } = useQuery({
    queryKey: ['producto-presentaciones', productoId],
    queryFn: async () => {
      const { data, error } = await supabase.from('producto_presentaciones')
        .select('id, etiqueta, nombre_empaque_id, factor_base, es_base, padre_linea_id, orden, peso_kg, alto_cm, ancho_cm, largo_cm')
        .eq('tenant_id', tenant!.id).eq('producto_id', productoId).order('orden')
      if (error) throw error
      return (data ?? []) as PresentacionFila[]
    },
    enabled: !!tenant && !!productoId,
  })

  // Sembrar el form una sola vez por producto (si no, se pisa lo que el usuario está tipeando).
  useEffect(() => { setCargado(false) }, [productoId])
  useEffect(() => {
    if (cargado || isLoading) return
    setRows(filasAForm(filas))
    setCargado(true)
  }, [filas, isLoading, cargado])

  const base = filaBase(rows)
  const error = useMemo(() => (rows.length ? validarPresentaciones(rows) : null), [rows])

  const set = (key: string, campo: keyof PresentacionRow, valor: string) =>
    setRows(prev => prev.map(r => (r.key === key ? { ...r, [campo]: valor } : r)))

  const agregar = () => {
    if (!base) return
    // Cuelga por default de la presentación más grande ya cargada (el caso típico: unidad → caja → pallet)
    const masGrande = rows.reduce((a, r) => {
      const fa = factorBaseDe(a, rows) ?? 0
      const fr = factorBaseDe(r, rows) ?? 0
      return fr > fa ? r : a
    }, base)
    setRows(prev => [...prev, {
      key: crypto.randomUUID(), etiqueta: '', nombre_empaque_id: '',
      padre_key: masGrande.key, cantidad_padre: '', peso: '', alto: '', ancho: '', largo: '',
    }])
  }

  const quitar = (key: string) => {
    if (rows.some(r => r.padre_key === key)) {
      toast.error('Sacá primero las presentaciones que cuelgan de esta.')
      return
    }
    setRows(prev => prev.filter(r => r.key !== key))
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const err = validarPresentaciones(rows)
      if (err) throw new Error(err)
      const payload = construirPayload(rows)
      if (!payload) throw new Error('El árbol de empaque no es válido.')
      const { error: rpcErr } = await supabase.rpc('fn_presentaciones_guardar', {
        p_producto_id: productoId, p_lineas: payload,
      })
      if (rpcErr) throw rpcErr
    },
    onSuccess: () => {
      toast.success('Estructura guardada')
      logActividad({
        entidad: 'producto', entidad_id: productoId, entidad_nombre: productoNombre,
        accion: 'editar', pagina: '/productos', campo: 'presentaciones',
        valor_nuevo: resumenArbol(rows), producto_id: productoId,
      })
      setCargado(false)
      qc.invalidateQueries({ queryKey: ['producto-presentaciones', productoId] })
      qc.invalidateQueries({ queryKey: ['presentaciones'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Candidatos a padre de una fila: cualquier otra que no cuelgue (directa o indirectamente) de ella.
  const posiblesPadres = (row: PresentacionRow) => {
    const descendientes = new Set<string>([row.key])
    let cambio = true
    while (cambio) {
      cambio = false
      for (const r of rows) {
        if (!descendientes.has(r.key) && r.padre_key && descendientes.has(r.padre_key)) {
          descendientes.add(r.key); cambio = true
        }
      }
    }
    return rows.filter(r => !descendientes.has(r.key))
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-10">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent-text" />
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
        <Info size={16} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800 dark:text-blue-300">
          Cada presentación declara <strong>de cuál cuelga</strong> y <strong>cuántas contiene</strong>
          {' '}(&quot;Pallet = 18 × Caja&quot;). Podés tener <strong>hermanas</strong>: Caja-12 y Caja-10 del
          mismo producto. El empaque es solo logística — <strong>no lleva precio</strong>: el precio se
          carga por unidad y los descuentos por volumen se hacen con los tramos de cantidad.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map(row => {
          const esBase = row.padre_key === null
          const factor = factorBaseDe(row, rows)
          return (
            <div key={row.key}
              className={`border rounded-xl p-3 ${esBase
                ? 'border-accent-text/30 bg-accent/5'
                : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex flex-wrap items-end gap-2">
                {!esBase && <CornerDownRight size={14} className="text-gray-300 dark:text-gray-600 mb-2.5" />}

                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Nombre {esBase && <span className="text-gray-400">(unidad de la ficha)</span>}
                  </label>
                  <input type="text" value={row.etiqueta} disabled={esBase || !canEdit}
                    onChange={e => set(row.key, 'etiqueta', e.target.value)}
                    placeholder="Caja-12"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-500 focus:outline-none focus:border-accent-text" />
                </div>

                {!esBase && (
                  <>
                    <div className="w-32">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo de empaque</label>
                      <select value={row.nombre_empaque_id} disabled={!canEdit}
                        onChange={e => {
                          const em = empaques.find(x => x.id === e.target.value)
                          setRows(prev => prev.map(r => r.key === row.key
                            ? { ...r, nombre_empaque_id: e.target.value, etiqueta: r.etiqueta.trim() || (em?.nombre ?? '') }
                            : r))
                        }}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                        <option value="">—</option>
                        {empaques.map(em => <option key={em.id} value={em.id}>{em.nombre}</option>)}
                      </select>
                    </div>

                    <div className="w-20">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Contiene</label>
                      <input type="text" inputMode="numeric" value={row.cantidad_padre} disabled={!canEdit}
                        onChange={e => set(row.key, 'cantidad_padre', e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="12"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-right bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text" />
                    </div>

                    <div className="w-40">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">de</label>
                      <select value={row.padre_key ?? ''} disabled={!canEdit}
                        onChange={e => set(row.key, 'padre_key', e.target.value)}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text">
                        {posiblesPadres(row).map(p => (
                          <option key={p.key} value={p.key}>{p.etiqueta || '(sin nombre)'}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    = <strong className="text-gray-700 dark:text-gray-200">{factor ?? '?'}</strong> {base?.etiqueta || 'u'}
                  </span>
                  {!esBase && canEdit && (
                    <button type="button" onClick={() => quitar(row.key)}
                      className="text-gray-300 hover:text-red-500 transition-colors" title="Quitar">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {canEdit && (
        <button type="button" onClick={agregar} disabled={!base}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-accent-text/40 text-accent-text py-2.5 rounded-xl text-sm hover:bg-accent/5 transition-colors disabled:opacity-50">
          <Plus size={15} /> Agregar presentación
        </button>
      )}

      {error && rows.length > 1 && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {rows.length > 1 && !error && (
        <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Layers size={13} className="shrink-0 mt-0.5" /> {resumenArbol(rows)}
        </p>
      )}

      {canEdit && (
        <button type="button" onClick={() => guardar.mutate()} disabled={!!error || guardar.isPending}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50">
          <Save size={15} /> {guardar.isPending ? 'Guardando…' : 'Guardar empaque'}
        </button>
      )}
    </div>
  )
}
