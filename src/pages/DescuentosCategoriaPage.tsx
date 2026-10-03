// Lista de descuentos de una categoría de clientes (mig 466 — Categorías, Fase 4 parte A, GO 2026-10-02).
// Un % por producto (B5). "Sin cargar" = el producto no está en la lista; 0 % = está, sin descuento a propósito (C4).
// Se aplica al vender desde la mig 468 (B2 / Fase 4): el motor único de precio la usa en el POS, presupuestos y Pedidos
// para clientes con esta categoría; compite con el mayorista y el estado y gana el precio más bajo (no se suman).
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Percent, Search, Trash2, Upload, Download, Info, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useConfirm } from '@/hooks/useConfirm'
import { traerTodoConError } from '@/lib/traerTodo'
import { descargarExcel, nombreConFecha } from '@/lib/exportarArchivo'
import { usePaginacionLista } from '@/hooks/usePaginacionLista'
import { useCategoriasCliente, puedeGestionarCategorias } from '@/hooks/useCategoriasCliente'
import { leerPorcentaje, porcentajeLegible } from '@/lib/categoriaDescuentos'

interface FilaDescuento {
  id: string
  producto_id: string
  descuento_pct: string | number
  updated_at: string
  productos: { nombre: string; sku: string | null; precio_venta: number | string | null } | null
}

const inputCls = 'w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text'

export default function DescuentosCategoriaPage() {
  const { id: categoriaId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirmar = useConfirm()
  const { tenant, user } = useAuthStore()
  const puedeGestionar = puedeGestionarCategorias(user as any, tenant)
  const { data: categorias = [] } = useCategoriasCliente()
  const categoria = categorias.find(c => c.id === categoriaId)

  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<Record<string, string>>({})
  const [buscarProd, setBuscarProd] = useState('')
  const [nuevoPct, setNuevoPct] = useState('')
  const [elegido, setElegido] = useState<{ id: string; nombre: string; sku: string | null } | null>(null)

  const keyLista = ['categoria-descuentos', categoriaId]
  const { data: filas = [], isLoading } = useQuery({
    queryKey: keyLista,
    queryFn: async () => {
      const { data, error } = await traerTodoConError<any>((d, h) => supabase.from('categoria_cliente_descuentos')
        .select('id, producto_id, descuento_pct, updated_at, productos(nombre, sku, precio_venta)')
        .eq('categoria_id', categoriaId!).order('updated_at', { ascending: false }).range(d, h))
      if (error) throw error
      return (data ?? []) as FilaDescuento[]
    },
    enabled: !!categoriaId,
  })

  const { data: totalProductos = 0 } = useQuery({
    queryKey: ['productos-activos-count', tenant?.id],
    queryFn: async () => {
      const { count } = await supabase.from('productos').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return count ?? 0
    },
    enabled: !!tenant,
  })

  const { data: sugerencias = [] } = useQuery({
    queryKey: ['cat-desc-buscar-prod', tenant?.id, buscarProd],
    queryFn: async () => {
      const t = buscarProd.trim().replace(/[%,()]/g, ' ')
      const { data } = await supabase.from('productos').select('id, nombre, sku')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .or(`nombre.ilike.%${t}%,sku.ilike.%${t}%`).order('nombre').limit(15)
      return data ?? []
    },
    enabled: !!tenant && buscarProd.trim().length >= 2 && !elegido,
  })

  const yaCargados = useMemo(() => new Set(filas.map(f => f.producto_id)), [filas])
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return filas
    return filas.filter(f => (f.productos?.nombre ?? '').toLowerCase().includes(q) || (f.productos?.sku ?? '').toLowerCase().includes(q))
  }, [filas, busqueda])
  const visibles = usePaginacionLista(filtradas, 'producto', { total: filas.length, claveFiltros: busqueda })
  const conDescuento = filas.filter(f => parseFloat(String(f.descuento_pct)) > 0).length

  const invalidar = () => qc.invalidateQueries({ queryKey: keyLista })

  const guardarPct = async (f: FilaDescuento) => {
    const texto = editando[f.id]
    if (texto === undefined) return
    const pct = leerPorcentaje(texto)
    if (pct === 'invalido' || pct === null) {
      toast.error('El descuento va de 0 a 100, con hasta 2 decimales. Para sacar el producto de la lista usá el tachito.')
      return
    }
    if (pct === parseFloat(String(f.descuento_pct))) { setEditando(e => { const n = { ...e }; delete n[f.id]; return n }); return }
    const { error } = await supabase.from('categoria_cliente_descuentos').update({ descuento_pct: pct }).eq('id', f.id)
    if (error) { toast.error(error.message); return }
    setEditando(e => { const n = { ...e }; delete n[f.id]; return n })
    invalidar()
  }

  const quitar = async (f: FilaDescuento) => {
    if (!(await confirmar(`¿Sacar "${f.productos?.nombre ?? 'el producto'}" de la lista? Queda "sin cargar" (no es lo mismo que 0 %).`))) return
    const { error } = await supabase.from('categoria_cliente_descuentos').delete().eq('id', f.id)
    if (error) { toast.error(error.message); return }
    invalidar()
  }

  const agregar = async () => {
    if (!elegido) { toast.error('Elegí un producto de la lista'); return }
    const pct = leerPorcentaje(nuevoPct)
    if (pct === 'invalido' || pct === null) { toast.error('El descuento va de 0 a 100, con hasta 2 decimales'); return }
    const { error } = await supabase.from('categoria_cliente_descuentos').upsert({
      tenant_id: tenant!.id, categoria_id: categoriaId, producto_id: elegido.id, descuento_pct: pct,
    }, { onConflict: 'categoria_id,producto_id' })
    if (error) { toast.error(error.message); return }
    toast.success(`${elegido.nombre}: ${porcentajeLegible(pct)}`)
    setElegido(null); setBuscarProd(''); setNuevoPct('')
    invalidar()
  }

  const exportar = () => {
    void descargarExcel({
      nombre: 'Descuentos',
      filas: filas.map(f => ({ sku: f.productos?.sku ?? '', nombre: f.productos?.nombre ?? '', descuento_pct: parseFloat(String(f.descuento_pct)) })),
    }, nombreConFecha(`descuentos_${(categoria?.nombre ?? 'categoria').replace(/\s+/g, '_')}`))
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/clientes?tab=categorias')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" title="Volver">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-primary dark:text-white flex items-center gap-2"><Percent size={18} /> Lista de descuentos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">Categoría: <strong>{categoria?.nombre ?? '…'}</strong></p>
        </div>
        <button onClick={exportar} disabled={filas.length === 0}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
          <Download size={14} /> Exportar
        </button>
        {puedeGestionar && (
          <button onClick={() => navigate(`/clientes/categorias/${categoriaId}/descuentos/importar`)}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-accent text-white hover:bg-accent/90">
            <Upload size={14} /> Importar Excel
          </button>
        )}
      </div>

      <div className="flex gap-2 items-start rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
        <Info size={16} className="flex-shrink-0 mt-0.5" />
        <p>
          <strong>Se aplica al vender</strong> (punto de venta, presupuestos y pedidos) a los clientes de esta categoría. El
          descuento compite con el precio mayorista y el descuento por estado: <strong>gana el precio más bajo</strong>, no
          se suman. Sin cliente cargado en la venta no se aplica.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ['En la lista', filas.length],
          ['Con descuento (> 0 %)', conDescuento],
          ['Sin cargar', Math.max(0, totalProductos - filas.length)],
        ].map(([t, v]) => (
          <div key={t as string} className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t}</p>
            <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{(v as number).toLocaleString('es-AR')}</p>
          </div>
        ))}
      </div>

      {puedeGestionar && (
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3 space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Agregar un producto</p>
          <div className="flex flex-wrap gap-2 items-start">
            <div className="relative flex-1 min-w-[220px]">
              <input value={elegido ? `${elegido.sku ? elegido.sku + ' · ' : ''}${elegido.nombre}` : buscarProd}
                onChange={e => { setElegido(null); setBuscarProd(e.target.value) }}
                placeholder="Buscar producto por nombre o SKU…" className={inputCls} aria-label="Producto a agregar" />
              {!elegido && sugerencias.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                  {(sugerencias as any[]).map(p => (
                    <button key={p.id} type="button" onClick={() => setElegido(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex justify-between gap-2">
                      <span className="truncate">{p.nombre} <span className="text-gray-400">{p.sku}</span></span>
                      {yaCargados.has(p.id) && <span className="text-[11px] text-amber-600 whitespace-nowrap">ya está (se reemplaza)</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input value={nuevoPct} onChange={e => setNuevoPct(e.target.value)} placeholder="% (ej. 12,5)"
              className={`${inputCls} w-32`} aria-label="Porcentaje de descuento" onKeyDown={e => { if (e.key === 'Enter') void agregar() }} />
            <button onClick={() => void agregar()} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-accent text-white hover:bg-accent/90">
              <Plus size={14} /> Agregar
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
        <div className="p-3 border-b border-gray-100 dark:border-gray-700 relative">
          <Search size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar en la lista…" className={`${inputCls} pl-8`} />
        </div>
        {isLoading ? (
          <p className="p-4 text-sm text-gray-400">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="p-6 text-sm text-gray-400 text-center">La lista está vacía. Agregá productos de a uno o importá un Excel.</p>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {visibles.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5" data-producto-descuento={f.productos?.sku ?? f.producto_id}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{f.productos?.nombre ?? '—'}</p>
                  <p className="text-xs text-gray-400">{f.productos?.sku}</p>
                </div>
                {puedeGestionar ? (
                  <input value={editando[f.id] ?? String(parseFloat(String(f.descuento_pct))).replace('.', ',')}
                    onChange={e => setEditando(s => ({ ...s, [f.id]: e.target.value }))}
                    onBlur={() => void guardarPct(f)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    aria-label={`Descuento de ${f.productos?.nombre ?? ''}`}
                    className="w-24 text-right border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text" />
                ) : (
                  <span className="text-sm font-semibold">{porcentajeLegible(f.descuento_pct)}</span>
                )}
                <span className="text-sm text-gray-400 w-4">%</span>
                {puedeGestionar && (
                  <button onClick={() => void quitar(f)} title="Sacar de la lista (queda sin cargar)"
                    className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
