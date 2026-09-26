import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Power, Trash2, History, Users, X, Tag, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useConfirm } from '@/hooks/useConfirm'
import { formatMoneda } from '@/lib/formato'
import { num, habilitadaAForm, habilitadaDesdeForm, ETIQUETA_POLITICA, type HabilitadaForm, type PoliticaExceso } from '@/lib/ccCategorias'
import {
  useCategoriasCliente, useClientesCC, puedeGestionarCategorias, CATEGORIAS_QUERY_KEY, CLIENTES_CC_QUERY_KEY,
  type CategoriaCliente,
} from '@/hooks/useCategoriasCliente'
import { AsignarCategoriaModal } from '@/components/AsignarCategoriaModal'

// Categorías de clientes, etapa 1 (mig 442): la categoría con cuenta corriente. El precio por categoría es la Fase 4.
// Reglas: una por cliente (C5), desactivar ≠ borrar (C2), cada condición opcional = "hereda del negocio" (D3/D4),
// permisos E1/E2 configurables por el DUEÑO, historial completo (F1) — lo escribe el servidor.

interface FormCategoria {
  nombre: string
  descripcion: string
  cc_habilitada: HabilitadaForm
  cc_limite: string
  cc_plazo_dias: string
  cc_interes_mensual_pct: string
  cc_enforcement_politica: '' | PoliticaExceso
}

const VACIO: FormCategoria = { nombre: '', descripcion: '', cc_habilitada: 'hereda', cc_limite: '', cc_plazo_dias: '', cc_interes_mensual_pct: '', cc_enforcement_politica: '' }
const ROLES_BASE = ['SUPERVISOR', 'SUPER_USUARIO', 'CAJERO', 'CONTADOR']

const inputCls = 'w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text'

function resumenCC(c: CategoriaCliente): string {
  const partes: string[] = []
  if (c.cc_habilitada !== null) partes.push(c.cc_habilitada ? 'CC habilitada' : 'CC no habilitada')
  if (num(c.cc_limite) !== null) partes.push(`límite ${formatMoneda(num(c.cc_limite)!)}`)
  if (num(c.cc_plazo_dias) !== null) partes.push(`${num(c.cc_plazo_dias)} días`)
  if (num(c.cc_interes_mensual_pct) !== null) partes.push(`interés ${num(c.cc_interes_mensual_pct)}%`)
  if (c.cc_enforcement_politica) partes.push(`al pasarse: ${ETIQUETA_POLITICA[c.cc_enforcement_politica].toLowerCase()}`)
  return partes.length ? partes.join(' · ') : 'Hereda todo del negocio'
}

export function CategoriasClientePanel() {
  const { tenant, user, setTenant } = useAuthStore()
  const qc = useQueryClient()
  const confirmar = useConfirm()
  const { data: categorias = [], isLoading } = useCategoriasCliente()
  const { data: ccEfectivo } = useClientesCC()
  const puedeGestionar = puedeGestionarCategorias(user as any, tenant)
  const esDueno = user?.rol === 'DUEÑO' || user?.rol === 'ADMIN'

  const [editando, setEditando] = useState<CategoriaCliente | 'nueva' | null>(null)
  const [form, setForm] = useState<FormCategoria>(VACIO)
  const [guardando, setGuardando] = useState(false)
  const [historialDe, setHistorialDe] = useState<CategoriaCliente | null>(null)
  const [asignarA, setAsignarA] = useState<CategoriaCliente | null>(null)

  const clientesPorCategoria = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of ccEfectivo?.values() ?? []) if (c.categoria_cliente_id) m.set(c.categoria_cliente_id, (m.get(c.categoria_cliente_id) ?? 0) + 1)
    return m
  }, [ccEfectivo])

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: [CATEGORIAS_QUERY_KEY] })
    qc.invalidateQueries({ queryKey: [CLIENTES_CC_QUERY_KEY] })
    qc.invalidateQueries({ queryKey: ['clientes'] })
    qc.invalidateQueries({ queryKey: ['clientes-cc'] })
  }

  const abrir = (c: CategoriaCliente | 'nueva') => {
    setEditando(c)
    setForm(c === 'nueva' ? VACIO : {
      nombre: c.nombre, descripcion: c.descripcion ?? '',
      cc_habilitada: habilitadaAForm(c.cc_habilitada),
      cc_limite: num(c.cc_limite) !== null ? String(num(c.cc_limite)) : '',
      cc_plazo_dias: num(c.cc_plazo_dias) !== null ? String(num(c.cc_plazo_dias)) : '',
      cc_interes_mensual_pct: num(c.cc_interes_mensual_pct) !== null ? String(num(c.cc_interes_mensual_pct)) : '',
      cc_enforcement_politica: c.cc_enforcement_politica ?? '',
    })
  }

  /** D2 — al bajar el límite: cuántos clientes que HEREDAN el límite de esta categoría quedarían por encima. */
  const clientesSobreLimite = async (categoriaId: string, limite: number): Promise<number> => {
    const heredan = [...(ccEfectivo?.values() ?? [])]
      .filter(c => c.categoria_cliente_id === categoriaId && c.origen_limite !== 'cliente').map(c => c.cliente_id)
    if (heredan.length === 0) return 0
    const deuda = new Map<string, number>()
    for (let i = 0; i < heredan.length; i += 200) {
      const { data, error } = await supabase.from('ventas').select('cliente_id, total, monto_pagado, interes_cc')
        .eq('es_cuenta_corriente', true).neq('estado', 'cancelada').in('cliente_id', heredan.slice(i, i + 200))
      if (error) throw error
      for (const v of data ?? []) {
        const saldo = Math.max(0, Number(v.total) - Number(v.monto_pagado)) + Number(v.interes_cc ?? 0)
        if (saldo > 0.5) deuda.set(v.cliente_id, (deuda.get(v.cliente_id) ?? 0) + saldo)
      }
    }
    return [...deuda.values()].filter(d => d > limite + 0.5).length
  }

  const guardar = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      cc_habilitada: habilitadaDesdeForm(form.cc_habilitada),
      cc_limite: num(form.cc_limite.replace(',', '.')),
      cc_plazo_dias: num(form.cc_plazo_dias) === null ? null : Math.trunc(num(form.cc_plazo_dias)!),
      cc_interes_mensual_pct: num(form.cc_interes_mensual_pct.replace(',', '.')),
      cc_enforcement_politica: form.cc_enforcement_politica || null,
    }
    if (payload.cc_plazo_dias !== null && (payload.cc_plazo_dias < 1 || payload.cc_plazo_dias > 365)) { toast.error('El plazo va de 1 a 365 días'); return }
    if (payload.cc_limite !== null && payload.cc_limite < 0) { toast.error('El límite no puede ser negativo'); return }
    if (payload.cc_interes_mensual_pct !== null && payload.cc_interes_mensual_pct < 0) { toast.error('El interés no puede ser negativo'); return }

    // D2 — aviso de impacto al bajar el límite de una categoría en uso.
    if (editando && editando !== 'nueva' && payload.cc_limite !== null && payload.cc_limite !== num(editando.cc_limite)) {
      try {
        const n = await clientesSobreLimite(editando.id, payload.cc_limite)
        if (n > 0 && !(await confirmar(`Con el límite nuevo de ${formatMoneda(payload.cc_limite)}, ${n} cliente${n === 1 ? '' : 's'} de esta categoría quedaría${n === 1 ? '' : 'n'} por encima de su límite (no se les cobra nada: no van a poder sumar más a la cuenta corriente si la política es "bloquear"). ¿Guardar igual?`))) return
      } catch { toast.error('No se pudo calcular el impacto del límite nuevo. Intentá de nuevo.'); return }
    }

    setGuardando(true)
    try {
      if (editando === 'nueva') {
        const { error } = await supabase.from('categorias_cliente').insert({ tenant_id: tenant!.id, created_by: user!.id, ...payload })
        if (error) throw error
        toast.success('Categoría creada')
      } else if (editando) {
        const { error } = await supabase.from('categorias_cliente').update(payload).eq('id', editando.id)
        if (error) throw error
        toast.success('Categoría actualizada')
      }
      setEditando(null)
      invalidar()
    } catch (e: any) {
      toast.error(e?.code === '23505' ? 'Ya hay una categoría con ese nombre' : (e?.message ?? 'No se pudo guardar'))
    } finally {
      setGuardando(false)
    }
  }

  const cambiarEstado = async (c: CategoriaCliente) => {
    const n = clientesPorCategoria.get(c.id) ?? 0
    if (c.activo && !(await confirmar(
      n > 0
        ? `Al desactivar "${c.nombre}", ${n} cliente${n === 1 ? '' : 's'} pasa${n === 1 ? '' : 'n'} a las condiciones de cuenta corriente del negocio (salvo sus valores propios). El historial se conserva. ¿Desactivar?`
        : `¿Desactivar "${c.nombre}"?`,
      { titulo: 'Desactivar categoría' },
    ))) return
    const { error } = await supabase.from('categorias_cliente').update({ activo: !c.activo }).eq('id', c.id)
    if (error) { toast.error(error.message); return }
    toast.success(c.activo ? 'Categoría desactivada' : 'Categoría activada')
    invalidar()
  }

  const borrar = async (c: CategoriaCliente) => {
    if (!(await confirmar(`¿Borrar "${c.nombre}"? Nunca se usó, así que no deja rastro.`, { danger: true }))) return
    const { error } = await supabase.from('categorias_cliente').delete().eq('id', c.id)
    if (error) { toast.error(error.message); return }
    toast.success('Categoría borrada')
    invalidar()
  }

  const toggleRol = async (columna: 'categorias_cliente_roles' | 'categorias_cliente_asignar_roles', rol: string) => {
    const actual: string[] = ((tenant as any)?.[columna] ?? []) as string[]
    const nuevo = actual.includes(rol) ? actual.filter(r => r !== rol) : [...actual, rol]
    const { data, error } = await supabase.from('tenants').update({ [columna]: nuevo }).eq('id', tenant!.id).select().single()
    if (error) { toast.error(error.message); return }
    setTenant(data)
  }

  return (
    <div className="space-y-4" data-testid="categorias-cliente-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2"><Tag size={16} /> Categorías de clientes</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
            Cada cliente tiene una categoría (o ninguna). Por ahora define las condiciones de cuenta corriente; lo que no
            define la categoría lo toma del negocio, y lo que el dueño le pone a un cliente puntual gana sobre todo.
          </p>
        </div>
        {puedeGestionar && (
          <button onClick={() => abrir('nueva')} className="flex items-center gap-1.5 bg-accent hover:bg-accent/90 text-white text-sm font-semibold px-3 py-2 rounded-xl">
            <Plus size={15} /> Nueva categoría
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {isLoading ? (
          <p className="p-5 text-sm text-gray-400">Cargando…</p>
        ) : categorias.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">Todavía no hay categorías.</p>
        ) : categorias.map(c => (
          <div key={c.id} className={`p-4 flex items-start gap-3 ${c.activo ? '' : 'opacity-60'}`} data-categoria={c.nombre}>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800 dark:text-gray-100 flex items-center gap-2 flex-wrap">
                {c.nombre}
                {!c.activo && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">desactivada</span>}
                <span className="text-xs text-gray-400 flex items-center gap-1"><Users size={11} /> {clientesPorCategoria.get(c.id) ?? 0}</span>
              </p>
              {c.descripcion && <p className="text-xs text-gray-500 dark:text-gray-400">{c.descripcion}</p>}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{resumenCC(c)}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {c.activo && (
                <button title="Asignar a clientes" onClick={() => setAsignarA(c)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><Users size={15} /></button>
              )}
              <button title="Historial" onClick={() => setHistorialDe(c)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><History size={15} /></button>
              {puedeGestionar && <>
                <button title="Editar" onClick={() => abrir(c)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><Pencil size={15} /></button>
                <button title={c.activo ? 'Desactivar' : 'Activar'} onClick={() => cambiarEstado(c)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><Power size={15} /></button>
                {!c.usada && (clientesPorCategoria.get(c.id) ?? 0) === 0 && (
                  <button title="Borrar (nunca se usó)" onClick={() => borrar(c)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
                )}
              </>}
            </div>
          </div>
        ))}
      </div>

      {esDueno && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <p className="font-medium text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2"><ShieldCheck size={15} /> Permisos</p>
          {([
            ['categorias_cliente_roles', 'Quién crea y edita categorías'],
            ['categorias_cliente_asignar_roles', 'Quién asigna categorías a clientes'],
          ] as const).map(([col, label]) => (
            <div key={col}>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{label} — el <strong>DUEÑO</strong> siempre puede.</p>
              <div className="flex flex-wrap gap-2">
                {ROLES_BASE.map(r => {
                  const activo = (((tenant as any)?.[col] ?? []) as string[]).includes(r)
                  return (
                    <button key={r} type="button" onClick={() => toggleRol(col, r)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${activo ? 'bg-accent text-white border-accent-text' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-gray-400">Las condiciones de cuenta corriente PROPIAS de un cliente (las que ganan sobre la categoría) las pone solo el dueño.</p>
        </div>
      )}

      {editando && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditando(null)}>
          <div role="dialog" aria-modal="true" aria-label="Categoría de clientes" className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">{editando === 'nueva' ? 'Nueva categoría' : `Editar "${editando.nombre}"`}</h3>
              <button onClick={() => setEditando(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nombre *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Colocadores" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descripción</label>
                <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">Cuenta corriente — vacío = lo del negocio</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Habilitada</label>
                  <select value={form.cc_habilitada} onChange={e => setForm(f => ({ ...f, cc_habilitada: e.target.value as HabilitadaForm }))} className={inputCls}>
                    <option value="hereda">Lo del negocio (no)</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Límite de crédito ($)</label>
                  <input type="number" min="0" value={form.cc_limite} onWheel={e => e.currentTarget.blur()}
                    onChange={e => setForm(f => ({ ...f, cc_limite: e.target.value }))}
                    placeholder={`Negocio: ${(tenant as any)?.limite_cc_default != null ? formatMoneda(Number((tenant as any).limite_cc_default)) : 'sin límite'}`} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Plazo de pago (días)</label>
                  <input type="number" min="1" max="365" value={form.cc_plazo_dias} onWheel={e => e.currentTarget.blur()}
                    onChange={e => setForm(f => ({ ...f, cc_plazo_dias: e.target.value }))}
                    placeholder={`Negocio: ${(tenant as any)?.cc_dias_vencimiento ?? 30}`} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Interés por mora (% mensual)</label>
                  <input type="number" min="0" step="0.1" value={form.cc_interes_mensual_pct} onWheel={e => e.currentTarget.blur()}
                    onChange={e => setForm(f => ({ ...f, cc_interes_mensual_pct: e.target.value }))}
                    placeholder={`Negocio: ${Number((tenant as any)?.cc_interes_mensual_pct ?? 0)}`} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Al pasarse del límite</label>
                  <select value={form.cc_enforcement_politica} onChange={e => setForm(f => ({ ...f, cc_enforcement_politica: e.target.value as any }))} className={inputCls}>
                    <option value="">Lo del negocio ({ETIQUETA_POLITICA[((tenant as any)?.cc_enforcement_politica ?? 'avisar') as PoliticaExceso].toLowerCase()})</option>
                    <option value="permitir">Permitir</option>
                    <option value="avisar">Avisar</option>
                    <option value="bloquear">Bloquear</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-gray-400">La política de morosidad y los avisos quedan a nivel negocio (Configuración).</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditando(null)} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm">Cancelar</button>
              <button onClick={guardar} disabled={guardando} className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold disabled:opacity-60">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historialDe && <HistorialCategoria categoria={historialDe} onCerrar={() => setHistorialDe(null)} />}
      {asignarA && <AsignarCategoriaModal categoria={asignarA} onCerrar={() => setAsignarA(null)} onAsignado={invalidar} />}
    </div>
  )
}

function HistorialCategoria({ categoria, onCerrar }: { categoria: CategoriaCliente; onCerrar: () => void }) {
  const { tenant } = useAuthStore()
  const { data = [], isLoading } = useQuery({
    queryKey: ['categoria-cliente-historial', categoria.id],
    queryFn: async () => {
      // F1: cambios de la categoría + asignaciones de clientes a ella (por nombre, así aparecen también las viejas).
      const [a, b] = await Promise.all([
        supabase.from('actividad_log').select('id, created_at, usuario_nombre, accion, campo, valor_anterior, valor_nuevo, entidad_nombre')
          .eq('tenant_id', tenant!.id).eq('entidad', 'categoria_cliente').eq('entidad_id', categoria.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('actividad_log').select('id, created_at, usuario_nombre, accion, campo, valor_anterior, valor_nuevo, entidad_nombre')
          .eq('tenant_id', tenant!.id).eq('entidad', 'cliente').eq('campo', 'categoría')
          .or(`valor_nuevo.eq.${JSON.stringify(categoria.nombre)},valor_anterior.eq.${JSON.stringify(categoria.nombre)}`)
          .order('created_at', { ascending: false }).limit(200),
      ])
      if (a.error) throw a.error
      if (b.error) throw b.error
      return [...(a.data ?? []), ...(b.data ?? [])].sort((x, y) => y.created_at.localeCompare(x.created_at))
    },
  })
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label="Historial de la categoría" className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2"><History size={16} /> Historial de "{categoria.nombre}"</h3>
          <button onClick={onCerrar} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-4 text-sm">
          {isLoading ? <p className="text-gray-400">Cargando…</p> : data.length === 0 ? <p className="text-gray-400">Sin movimientos.</p> : (
            <ul className="space-y-2">
              {data.map((r: any) => (
                <li key={r.id} className="text-xs text-gray-600 dark:text-gray-300">
                  <span className="text-gray-400">{new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>{' · '}
                  <strong>{r.usuario_nombre ?? '—'}</strong>{' · '}
                  {r.accion === 'crear' ? 'creó la categoría'
                    : r.campo === 'categoría' ? <>cliente <strong>{r.entidad_nombre}</strong>: {r.valor_anterior} → {r.valor_nuevo}</>
                    : <>{r.campo}: {r.valor_anterior} → {r.valor_nuevo}</>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
