import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save, Layers, CornerDownRight, Info, Box } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import {
  filasAForm, validarPresentaciones, construirPayload, factorBaseDe, filaBase, resumenArbol,
  agruparPorNivel, type PresentacionRow, type PresentacionFila,
} from '@/lib/presentaciones'
import { volumenUbicacionM3 } from '@/lib/medidasLogistica'
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

  // Cubicaje activo (mig 322) → el peso y las tres medidas dejan de ser opcionales: un nivel sin
  // medir aporta 0 m³ y hace que el volumen ocupado de la ubicación quede corto.
  const cubicaje = !!tenant?.cubicaje_habilitado

  const base = filaBase(rows)
  const error = useMemo(
    () => (rows.length ? validarPresentaciones(rows, cubicaje) : null),
    [rows, cubicaje],
  )

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
      const err = validarPresentaciones(rows, cubicaje)
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

      {cubicaje && (
        <div className="flex gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
          <Box size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            El <strong>cubicaje está activado</strong>: el peso y las tres medidas son obligatorios en
            cada nivel. Cargalos del <strong>bulto cerrado</strong>, no de su contenido — una caja de 12
            pesa más que 12 unidades sueltas y ocupa lo que ocupa la caja. Un nivel sin medir haría que
            el espacio ocupado de las ubicaciones se calcule <strong>de menos</strong>.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {agruparPorNivel(rows).map(grupo => (
          <div key={grupo.nivel} className="rounded-xl border-2 border-violet-200 dark:border-violet-800/60 bg-violet-50/40 dark:bg-violet-950/10 p-2.5 space-y-2">
            <p className="text-xs font-bold text-violet-700 dark:text-violet-400 uppercase tracking-wide px-1">
              {grupo.nivel === 0 ? 'NB · Nivel Base' : `Nivel ${grupo.nivel}`}
            </p>
            {grupo.filas.map(row => {
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
                          const nuevoTipo = e.target.value
                          const em = empaques.find(x => x.id === nuevoTipo)
                          // Si ya hay otra fila del MISMO tipo de empaque (ej. ya existe "Caja-10" y esto
                          // es "Caja-15"), la ubicamos como hermana de esa fila (mismo padre) en vez de
                          // dejarla colgando de donde `agregar()` la puso por default (Fede 25/7, punto 4).
                          const hermana = rows.find(r => r.key !== row.key && r.nombre_empaque_id === nuevoTipo)
                          setRows(prev => prev.map(r => r.key === row.key
                            ? {
                                ...r,
                                nombre_empaque_id: nuevoTipo,
                                etiqueta: r.etiqueta.trim() || (em?.nombre ?? ''),
                                padre_key: hermana ? hermana.padre_key : r.padre_key,
                              }
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

              {/* Medidas físicas POR NIVEL (mig 322). El peso NO se deriva del factor: una caja de
                  12 pesa más que 12 unidades sueltas, porque incluye su embalaje. */}
              <div className="flex flex-wrap items-end gap-2 mt-2 pt-2 border-t border-dashed border-gray-100 dark:border-gray-700">
                {([
                  ['peso', 'Peso (kg)', '0.75'],
                  ['alto', 'Alto (cm)', '20'],
                  ['ancho', 'Ancho (cm)', '30'],
                  ['largo', 'Largo (cm)', '40'],
                ] as const).map(([campo, label, ph]) => {
                  const vacio = cubicaje && String(row[campo] ?? '').trim() === ''
                  return (
                    <div key={campo} className="w-24">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                        {label}{cubicaje && <span className="text-red-500"> *</span>}
                      </label>
                      <input type="number" min="0" step="0.01" inputMode="decimal"
                        value={row[campo]} disabled={!canEdit}
                        onWheel={e => e.currentTarget.blur()}
                        onChange={e => set(row.key, campo, e.target.value)}
                        placeholder={ph}
                        className={`w-full border rounded-lg px-2 py-1.5 text-sm text-right bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text ${
                          vacio ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-600'}`} />
                    </div>
                  )
                })}
                {(() => {
                  const cm = (t: string) => Number(t) || null
                  const m3 = volumenUbicacionM3(cm(row.largo), cm(row.ancho), cm(row.alto))
                  return (
                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap pb-1.5"
                      title="Volumen de esta presentación. Es lo que se usa para calcular cuánto ocupa en una ubicación.">
                      <Box size={11} className="inline mb-0.5 mr-0.5" />
                      {m3 != null ? `${m3} m³` : '— m³'}
                    </span>
                  )
                })()}
              </div>
            </div>
              )
            })}
          </div>
        ))}
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
