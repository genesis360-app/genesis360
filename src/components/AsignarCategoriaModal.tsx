import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { traerTodoConError } from '@/lib/traerTodo'
import { formatMoneda } from '@/lib/formato'
import { propiosQueCompiten } from '@/lib/ccCategorias'
import { puedeAsignarCategoria, puedeEditarCCPropia, type CategoriaCliente } from '@/hooks/useCategoriasCliente'

// Asignación masiva de una categoría (B-6 de GO + D2 de Fede):
//  1) se eligen los clientes (buscador + filtro por etiqueta),
//  2) resumen previo: cuántos, cuántos cambian de categoría, y la lista de los que tienen condiciones de CC PROPIAS que
//     compiten con las de la categoría — para cada uno: mantener (por defecto), usar la de la categoría o editar,
//  3) "Guardar" = UNA sola operación en el servidor (`fn_asignar_categoria_clientes`): o entra todo o nada.

type Decision = 'mantener' | 'categoria' | 'editar'
interface Fila { id: string; nombre: string; dni: string | null; etiquetas: string[] | null; categoria_cliente_id: string | null
  cuenta_corriente_habilitada: boolean | null; limite_credito: string | null; plazo_pago_dias: number | null }

export function AsignarCategoriaModal({ categoria, onCerrar, onAsignado }: { categoria: CategoriaCliente; onCerrar: () => void; onAsignado: () => void }) {
  const { tenant, user } = useAuthStore()
  const puedeAsignar = puedeAsignarCategoria(user as any, tenant)
  const puedePropios = puedeEditarCCPropia(user as any)
  const [paso, setPaso] = useState<1 | 2>(1)
  const [busqueda, setBusqueda] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [decisiones, setDecisiones] = useState<Record<string, { d: Decision; limite: string; plazo: string; habilitada: '' | 'si' | 'no' }>>({})
  const [guardando, setGuardando] = useState(false)

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['asignar-categoria-clientes', tenant?.id],
    queryFn: async () => {
      const { data, error } = await traerTodoConError<Fila>((desde, hasta) => supabase.from('clientes')
        .select('id, nombre, dni, etiquetas, categoria_cliente_id, cuenta_corriente_habilitada, limite_credito, plazo_pago_dias')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre').range(desde, hasta))
      if (error) throw error
      return data ?? []
    },
  })

  const etiquetas = useMemo(() => [...new Set(clientes.flatMap(c => c.etiquetas ?? []))].sort(), [clientes])
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return clientes.filter(c =>
      (!q || c.nombre.toLowerCase().includes(q) || (c.dni ?? '').includes(q)) &&
      (!etiqueta || (c.etiquetas ?? []).includes(etiqueta)))
  }, [clientes, busqueda, etiqueta])

  const elegidos = clientes.filter(c => seleccion.has(c.id))
  const conConflicto = elegidos
    .map(c => ({ c, compiten: propiosQueCompiten(c, categoria) }))
    .filter(x => x.compiten.length > 0)
  const cambianDeCategoria = elegidos.filter(c => c.categoria_cliente_id && c.categoria_cliente_id !== categoria.id).length
  const yaEstan = elegidos.filter(c => c.categoria_cliente_id === categoria.id).length

  const toggle = (id: string) => setSeleccion(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const todosFiltrados = () => setSeleccion(s => { const n = new Set(s); filtrados.forEach(c => n.add(c.id)); return n })

  const decisionDe = (c: Fila) => decisiones[c.id] ?? {
    d: 'mantener' as Decision,
    limite: c.limite_credito != null ? String(Number(c.limite_credito)) : '',
    plazo: c.plazo_pago_dias != null ? String(c.plazo_pago_dias) : '',
    habilitada: c.cuenta_corriente_habilitada === true ? 'si' as const : c.cuenta_corriente_habilitada === false ? 'no' as const : '' as const,
  }

  const guardar = async () => {
    const items = elegidos.map(c => {
      const dec = decisionDe(c)
      const compite = conConflicto.some(x => x.c.id === c.id)
      if (!compite || dec.d === 'mantener') return { cliente_id: c.id, mantener_propios: true }
      if (dec.d === 'categoria') return { cliente_id: c.id, mantener_propios: false }
      return {
        cliente_id: c.id, editar: true,
        limite: dec.limite.trim() === '' ? null : Number(dec.limite.replace(',', '.')),
        plazo: dec.plazo.trim() === '' ? null : Math.trunc(Number(dec.plazo)),
        habilitada: dec.habilitada === '' ? null : dec.habilitada === 'si',
      }
    })
    setGuardando(true)
    const { data, error } = await supabase.rpc('fn_asignar_categoria_clientes', { p_categoria_id: categoria.id, p_items: items })
    setGuardando(false)
    if (error) { toast.error(`No se asignó nada: ${error.message}`); return }
    toast.success(`Categoría "${categoria.nombre}" asignada a ${data} cliente${data === 1 ? '' : 's'}`)
    onAsignado()
    onCerrar()
  }

  const inputCls = 'border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 dark:text-gray-100'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label="Asignar categoría a clientes"
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Asignar "{categoria.nombre}" a clientes</h3>
          <button onClick={onCerrar} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
        </div>

        {!puedeAsignar ? (
          <p className="p-5 text-sm text-gray-500">Tu rol no puede asignar categorías.</p>
        ) : paso === 1 ? (
          <>
            <div className="p-4 space-y-2 border-b border-gray-100 dark:border-gray-700">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar cliente por nombre o DNI"
                    className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800" />
                </div>
                <select value={etiqueta} onChange={e => setEtiqueta(e.target.value)} className="border border-gray-200 dark:border-gray-700 rounded-xl px-2 text-sm bg-white dark:bg-gray-800">
                  <option value="">Todas las etiquetas</option>
                  {etiquetas.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{seleccion.size} seleccionado{seleccion.size === 1 ? '' : 's'} · {filtrados.length} en la lista</span>
                <span className="flex gap-3">
                  <button onClick={todosFiltrados} className="text-accent-text hover:underline">Seleccionar los {filtrados.length} de la lista</button>
                  {seleccion.size > 0 && <button onClick={() => setSeleccion(new Set())} className="hover:underline">Limpiar</button>}
                </span>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-50 dark:divide-gray-700">
              {isLoading ? <p className="p-4 text-sm text-gray-400">Cargando…</p> : filtrados.slice(0, 500).map(c => (
                <label key={c.id} className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40" data-asignar-cliente={c.nombre}>
                  <input type="checkbox" checked={seleccion.has(c.id)} onChange={() => toggle(c.id)} className="accent-accent" />
                  <span className="flex-1 truncate">{c.nombre}</span>
                  {c.categoria_cliente_id === categoria.id && <span className="text-[11px] text-gray-400">ya está</span>}
                </label>
              ))}
              {filtrados.length > 500 && <p className="p-3 text-xs text-gray-400">Se muestran 500; "Seleccionar los {filtrados.length}" incluye todos.</p>}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex justify-end">
              <button disabled={seleccion.size === 0} onClick={() => setPaso(2)}
                className="px-4 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold disabled:opacity-50">Continuar</button>
            </div>
          </>
        ) : (
          <>
            <div className="overflow-y-auto flex-1 p-4 space-y-3 text-sm">
              <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-3 py-2 text-gray-700 dark:text-gray-200" data-resumen-asignacion>
                Se asigna <strong>"{categoria.nombre}"</strong> a <strong>{elegidos.length}</strong> cliente{elegidos.length === 1 ? '' : 's'}.
                {cambianDeCategoria > 0 && <> {cambianDeCategoria} cambia{cambianDeCategoria === 1 ? '' : 'n'} de otra categoría.</>}
                {yaEstan > 0 && <> {yaEstan} ya la tenía{yaEstan === 1 ? '' : 'n'}.</>}
              </div>
              {conConflicto.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-gray-700 dark:text-gray-200">{conConflicto.length} cliente{conConflicto.length === 1 ? '' : 's'} con condiciones propias distintas de las de la categoría</p>
                  {!puedePropios && <p className="text-xs text-amber-700 dark:text-amber-400">Solo el dueño puede cambiar condiciones propias: se mantienen.</p>}
                  {conConflicto.map(({ c, compiten }) => {
                    const dec = decisionDe(c)
                    const set = (patch: Partial<typeof dec>) => setDecisiones(d => ({ ...d, [c.id]: { ...dec, ...patch } }))
                    return (
                      <div key={c.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 space-y-2" data-conflicto={c.nombre}>
                        <p className="font-medium text-gray-800 dark:text-gray-100">{c.nombre}</p>
                        <p className="text-xs text-gray-500">
                          {compiten.map(x => `${x.campo === 'habilitada' ? 'CC' : x.campo === 'limite' ? 'Límite' : 'Plazo'}: propio ${x.campo === 'limite' ? formatMoneda(Number(x.propio)) : x.propio} / categoría ${x.campo === 'limite' ? formatMoneda(Number(x.categoria)) : x.categoria}`).join(' · ')}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs">
                          {(['mantener', 'categoria', 'editar'] as Decision[]).map(d => (
                            <label key={d} className={`flex items-center gap-1 ${!puedePropios && d !== 'mantener' ? 'opacity-40' : 'cursor-pointer'}`}>
                              <input type="radio" name={`dec-${c.id}`} checked={dec.d === d} disabled={!puedePropios && d !== 'mantener'} onChange={() => set({ d })} />
                              {d === 'mantener' ? 'Mantener los propios' : d === 'categoria' ? 'Usar la categoría' : 'Editar'}
                            </label>
                          ))}
                        </div>
                        {dec.d === 'editar' && (
                          <div className="flex flex-wrap gap-2 items-center text-xs">
                            <select value={dec.habilitada} onChange={e => set({ habilitada: e.target.value as any })} className={inputCls}>
                              <option value="">CC: hereda</option><option value="si">CC: sí</option><option value="no">CC: no</option>
                            </select>
                            <input value={dec.limite} onChange={e => set({ limite: e.target.value })} placeholder="Límite (vacío = hereda)" className={`${inputCls} w-36`} />
                            <input value={dec.plazo} onChange={e => set({ plazo: e.target.value })} placeholder="Plazo (vacío = hereda)" className={`${inputCls} w-36`} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex gap-2">
              <button onClick={() => setPaso(1)} className="flex items-center gap-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm"><ArrowLeft size={14} /> Volver</button>
              <button onClick={guardar} disabled={guardando} className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold disabled:opacity-60">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
