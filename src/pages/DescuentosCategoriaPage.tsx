// Lista de descuentos de una categoría de clientes (mig 466; se aplica al vender desde la 468).
// Un % por producto (B5). "Sin cargar" = el producto no está en la lista; 0 % = está, sin descuento a propósito (C4).
//
// Rediseño 2026-10-05 (pedido de GO): cards (productos, con descuento, clientes asignados, descuento promedio en % y en
// $); buscador + Filtros (marca, categoría, margen / costo / precio / descuento con >, <, =, ≥, ≤; combinables, en
// pastillas que se editan o se quitan) + Acciones (aplicar un % o quitar el descuento a los seleccionados); tabla con
// las categorías de producto colapsadas: checkbox (producto, categoría, todos), nombre, marca, costo + IVA, precio de
// venta y margen (los dos ya con el descuento; en la fila de la categoría, promedios) y el %. El % de la fila de una
// categoría se aplica a todos sus productos que se ven con los filtros. Los números se recalculan al terminar de
// escribir (al salir del campo o con Enter), no en cada tecla. Cálculos en src/lib/listaDescuentos.ts.
import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Percent, Search, Upload, Download, Info, Sparkles, RefreshCw, ChevronRight, SlidersHorizontal, X, Wand2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useConfirm } from '@/hooks/useConfirm'
import { useCotizacion } from '@/hooks/useCotizacion'
import { traerTodoConError } from '@/lib/traerTodo'
import { descargarExcel, nombreConFecha } from '@/lib/exportarArchivo'
import { formatMoneda } from '@/lib/formato'
import { useCategoriasCliente, useClientesCC, puedeGestionarCategorias, CATEGORIAS_QUERY_KEY } from '@/hooks/useCategoriasCliente'
import { pedirRedaccionCartel } from '@/lib/cartelCategoriaIA'
import { PLANTILLAS, completarFrase, validarTextosCartel } from '@/lib/cartelCategoria'
import { leerPorcentaje, porcentajeLegible } from '@/lib/categoriaDescuentos'
import {
  costoConIva, precioConDescuento, margenDe, pasaFiltros, agruparPorCategoria, resumenLista, etiquetaFiltro,
  type ProductoLista, type FiltroLista, type OperadorFiltro, type CampoNumerico,
} from '@/lib/listaDescuentos'

const MAX_FILAS_POR_CATEGORIA = 300
// Enter termina de escribir (sale del campo). preventDefault: si no, el resto de ese mismo Enter cae sobre el botón del
// diálogo de confirmación que se abre en ese instante y lo acepta solo (lo encontró el e2e 178).
const enterConfirma = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
}
const pctTexto = (v: number | null) => (v === null ? '' : String(v).replace('.', ','))
const margenTexto = (m: number | null) => (m === null ? '—' : `${m.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`)

export default function DescuentosCategoriaPage() {
  const { id: categoriaId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirmar = useConfirm()
  const { tenant, user } = useAuthStore()
  const redondeo = (tenant as any)?.precio_redondeo as string | null | undefined
  const puedeGestionar = puedeGestionarCategorias(user as any, tenant)
  const { cotizacionUsdAArs } = useCotizacion()
  const { data: categorias = [] } = useCategoriasCliente()
  const { data: ccEfectivo } = useClientesCC()
  const categoria = categorias.find(c => c.id === categoriaId)

  const [busqueda, setBusqueda] = useState('')
  const [filtros, setFiltros] = useState<FiltroLista[]>([])
  const [editandoFiltro, setEditandoFiltro] = useState<{ idx: number | null } | null>(null)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [accionesAbierto, setAccionesAbierto] = useState(false)
  const [pctMasivo, setPctMasivo] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  // ── Datos ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const { data: productosBase = [], isLoading: cargandoProd } = useQuery({
    queryKey: ['lista-desc-productos', tenant?.id],
    queryFn: async () => {
      const { data, error } = await traerTodoConError<any>((d, h) => supabase.from('productos')
        .select('id, nombre, sku, marca, categoria_id, categorias(nombre), precio_costo, precio_venta, alicuota_iva, moneda_venta, precio_usd')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre').range(d, h))
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })
  const keyDesc = ['categoria-descuentos', categoriaId]
  const { data: descuentos = new Map<string, number>(), isLoading: cargandoDesc } = useQuery({
    queryKey: keyDesc,
    queryFn: async () => {
      const { data, error } = await traerTodoConError<any>((d, h) => supabase.from('categoria_cliente_descuentos')
        .select('producto_id, descuento_pct').eq('categoria_id', categoriaId!).range(d, h))
      if (error) throw error
      return new Map<string, number>((data ?? []).map((r: any) => [r.producto_id, parseFloat(String(r.descuento_pct))]))
    },
    enabled: !!categoriaId,
  })

  const productos: ProductoLista[] = useMemo(() => productosBase.map((p: any) => {
    const usd = p.moneda_venta === 'usd' && Number(p.precio_usd) > 0 && cotizacionUsdAArs > 0
    return {
      id: p.id, nombre: p.nombre, sku: p.sku, marca: p.marca ?? null,
      categoriaId: p.categoria_id ?? null, categoriaNombre: p.categorias?.nombre ?? 'Sin categoría',
      costo: Number(p.precio_costo) || 0,
      precioLista: usd ? Math.round(Number(p.precio_usd) * cotizacionUsdAArs * 100) / 100 : Number(p.precio_venta) || 0,
      iva: Number.isFinite(parseFloat(p.alicuota_iva)) ? parseFloat(p.alicuota_iva) : 21,
      pct: descuentos.has(p.id) ? (descuentos.get(p.id) as number) : null,
    }
  }), [productosBase, descuentos, cotizacionUsdAArs])

  const filtrados = useMemo(() => productos.filter(p => pasaFiltros(p, filtros, busqueda, redondeo)), [productos, filtros, busqueda, redondeo])
  const grupos = useMemo(() => agruparPorCategoria(filtrados, redondeo), [filtrados, redondeo])
  const resumen = useMemo(() => resumenLista(productos), [productos])
  const clientesAsignados = useMemo(() => [...(ccEfectivo?.values() ?? [])].filter(c => c.categoria_cliente_id === categoriaId).length, [ccEfectivo, categoriaId])
  const marcas = useMemo(() => [...new Set(productos.map(p => p.marca ?? ''))].sort((a, b) => a.localeCompare(b, 'es')), [productos])
  const catsProducto = useMemo(() => new Map(productos.map(p => [p.categoriaId ?? '', p.categoriaNombre])), [productos])
  const hayFiltro = filtros.length > 0 || busqueda.trim() !== ''
  const estaAbierta = (k: string) => hayFiltro || abiertas.has(k)

  // ── Cartel (mig 469) ─────────────────────────────────────────────────────────────────────────────────────────────
  const [redactando, setRedactando] = useState(false)
  const redactarCartel = async (mostrar: boolean) => {
    if (!categoriaId) return
    if (mostrar) setRedactando(true)
    try {
      const r = await pedirRedaccionCartel(categoriaId)
      qc.invalidateQueries({ queryKey: [CATEGORIAS_QUERY_KEY] })
      if (mostrar) {
        if (r.origen === 'ia') toast.success('Cartel redactado')
        else toast(`Se usa el texto estándar${r.motivo ? ` (${r.motivo})` : ''}`, { icon: 'ℹ️' })
      }
    } finally {
      if (mostrar) setRedactando(false)
    }
  }
  const textosCartel = validarTextosCartel(categoria?.cartel_textos) ?? PLANTILLAS
  const ejemploCartel = productos.find(p => (p.pct ?? 0) > 0)
  const redactarSiFalta = () => { if (!categoria?.cartel_generado_at) void redactarCartel(false) }

  // ── Escritura ────────────────────────────────────────────────────────────────────────────────────────────────────
  const refrescar = () => qc.invalidateQueries({ queryKey: keyDesc })
  const optimista = (cambios: Map<string, number | null>) => qc.setQueryData(keyDesc, (prev: Map<string, number> | undefined) => {
    const n = new Map(prev ?? [])
    cambios.forEach((v, k) => (v === null ? n.delete(k) : n.set(k, v)))
    return n
  })

  const guardarProducto = async (p: ProductoLista) => {
    const texto = borrador[p.id]
    if (texto === undefined) return
    setBorrador(b => { const n = { ...b }; delete n[p.id]; return n })
    const pct = leerPorcentaje(texto)
    if (pct === 'invalido') { toast.error('El descuento va de 0 a 100, con hasta 2 decimales'); return }
    if (pct === p.pct) return
    optimista(new Map([[p.id, pct]]))
    const { error } = pct === null
      ? await supabase.from('categoria_cliente_descuentos').delete().eq('categoria_id', categoriaId!).eq('producto_id', p.id)
      : await supabase.from('categoria_cliente_descuentos').upsert(
          { tenant_id: tenant!.id, categoria_id: categoriaId, producto_id: p.id, descuento_pct: pct }, { onConflict: 'categoria_id,producto_id' })
    if (error) toast.error(`No se guardó el descuento de ${p.nombre}: ${error.message}`)
    else if (pct !== null && pct > 0) redactarSiFalta()
    refrescar()
  }

  const aplicarMasivo = async (ids: string[], pct: number | null, detalle: string) => {
    if (ids.length === 0) return
    setTrabajando(true)
    optimista(new Map(ids.map(id => [id, pct])))
    const { error } = await supabase.rpc('fn_descuentos_categoria_masivo', {
      p_categoria_id: categoriaId, p_producto_ids: ids, p_pct: pct, p_detalle: detalle,
    })
    setTrabajando(false)
    if (error) toast.error(`No se aplicó: ${error.message}`)
    else {
      toast.success(pct === null ? `${ids.length} producto${ids.length === 1 ? '' : 's'} sin descuento` : `${porcentajeLegible(pct)} a ${ids.length} producto${ids.length === 1 ? '' : 's'}`)
      if (pct !== null && pct > 0) redactarSiFalta()
    }
    refrescar()
  }

  const guardarCategoria = async (k: string, nombre: string, ids: string[]) => {
    const texto = borrador[`cat:${k}`]
    if (texto === undefined) return
    setBorrador(b => { const n = { ...b }; delete n[`cat:${k}`]; return n })
    if (texto.trim() === '') return
    const pct = leerPorcentaje(texto)
    if (pct === 'invalido' || pct === null) { toast.error('El descuento va de 0 a 100, con hasta 2 decimales'); return }
    if (!(await confirmar(
      `¿Aplicar ${porcentajeLegible(pct)} a los ${ids.length} producto${ids.length === 1 ? '' : 's'} de "${nombre}"${hayFiltro ? ' que se ven con los filtros y la búsqueda' : ''}?`,
      { titulo: 'Descuento para toda la categoría' },
    ))) return
    await aplicarMasivo(ids, pct, `categoría ${nombre}`)
  }

  const accionSeleccion = async (quitar: boolean) => {
    const ids = [...seleccion]
    if (quitar) {
      if (!(await confirmar(`¿Quitar el descuento a ${ids.length} producto${ids.length === 1 ? '' : 's'}? Quedan "sin cargar".`))) return
      await aplicarMasivo(ids, null, 'selección')
    } else {
      const pct = leerPorcentaje(pctMasivo)
      if (pct === 'invalido' || pct === null) { toast.error('Escribí un descuento de 0 a 100'); return }
      if (!(await confirmar(`¿Aplicar ${porcentajeLegible(pct)} a ${ids.length} producto${ids.length === 1 ? '' : 's'} seleccionado${ids.length === 1 ? '' : 's'}?`))) return
      await aplicarMasivo(ids, pct, 'selección')
    }
    setAccionesAbierto(false); setPctMasivo(''); setSeleccion(new Set())
  }

  // ── Selección ────────────────────────────────────────────────────────────────────────────────────────────────────
  const alternar = (ids: string[]) => setSeleccion(s => {
    const n = new Set(s)
    const todos = ids.every(id => n.has(id))
    ids.forEach(id => (todos ? n.delete(id) : n.add(id)))
    return n
  })
  const estadoCheck = (ids: string[]) => {
    const n = ids.filter(id => seleccion.has(id)).length
    return { checked: ids.length > 0 && n === ids.length, indeterminate: n > 0 && n < ids.length }
  }
  const idsFiltrados = filtrados.map(p => p.id)

  const exportar = () => {
    void descargarExcel({
      nombre: 'Descuentos',
      filas: productos.filter(p => p.pct !== null).map(p => ({ sku: p.sku ?? '', nombre: p.nombre, descuento_pct: p.pct as number })),
    }, nombreConFecha(`descuentos_${(categoria?.nombre ?? 'categoria').replace(/\s+/g, '_')}`))
  }

  const inputPct = 'w-20 text-right border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text disabled:bg-transparent disabled:border-transparent'
  const cargando = cargandoProd || cargandoDesc

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate('/clientes?tab=categorias')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" title="Volver">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-primary dark:text-white flex items-center gap-2"><Percent size={18} /> Lista de descuentos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">Categoría: <strong>{categoria?.nombre ?? '…'}</strong></p>
        </div>
        <button onClick={exportar} disabled={resumen.conDescuento === 0 && descuentos.size === 0}
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

      {/* Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="lista-cards">
        <Card titulo="Productos" valor={resumen.totalProductos.toLocaleString('es-AR')} />
        <Card titulo="Con descuento" valor={resumen.conDescuento.toLocaleString('es-AR')}
          detalle={resumen.totalProductos ? `${Math.round((resumen.conDescuento / resumen.totalProductos) * 100)} % del total` : undefined} />
        <Card titulo="Clientes asignados" valor={clientesAsignados.toLocaleString('es-AR')} />
        <Card titulo="Descuento promedio" valor={resumen.pctPromedio === null ? '—' : porcentajeLegible(resumen.pctPromedio)}
          detalle={resumen.pesosPromedio === null ? 'sin productos con descuento' : `${formatMoneda(resumen.pesosPromedio)} por unidad`} />
      </div>

      {/* Buscador + filtros + acciones */}
      <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
        <div className="p-3 flex flex-wrap gap-2 items-center border-b border-gray-100 dark:border-gray-700">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre, SKU o marca…"
              className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text" />
          </div>
          <div className="relative">
            <button onClick={() => setEditandoFiltro({ idx: null })} data-testid="btn-filtros"
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
              <SlidersHorizontal size={14} /> Filtros{filtros.length ? ` (${filtros.length})` : ''}
            </button>
            {editandoFiltro && (
              <EditorFiltro
                inicial={editandoFiltro.idx === null ? null : filtros[editandoFiltro.idx]}
                marcas={marcas} categorias={catsProducto}
                onCancelar={() => setEditandoFiltro(null)}
                onGuardar={f => {
                  setFiltros(fs => editandoFiltro.idx === null ? [...fs, f] : fs.map((x, i) => (i === editandoFiltro.idx ? f : x)))
                  setEditandoFiltro(null)
                }} />
            )}
          </div>
          {puedeGestionar && (
            <div className="relative">
              <button onClick={() => setAccionesAbierto(a => !a)} disabled={seleccion.size === 0} data-testid="btn-acciones"
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-accent text-white hover:bg-accent/90 disabled:opacity-40">
                <Wand2 size={14} /> Acciones{seleccion.size ? ` (${seleccion.size})` : ''}
              </button>
              {accionesAbierto && seleccion.size > 0 && (
                <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-3 space-y-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{seleccion.size} producto{seleccion.size === 1 ? '' : 's'} seleccionado{seleccion.size === 1 ? '' : 's'}</p>
                  <div className="flex gap-2">
                    <input value={pctMasivo} onChange={e => setPctMasivo(e.target.value)} placeholder="% (ej. 12,5)" aria-label="Descuento para los seleccionados"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void accionSeleccion(false) } }}
                      className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100" />
                    <button disabled={trabajando} onClick={() => void accionSeleccion(false)} className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white disabled:opacity-50">Aplicar</button>
                  </div>
                  <button disabled={trabajando} onClick={() => void accionSeleccion(true)} className="w-full text-left text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">
                    Quitar el descuento (quedan sin cargar)
                  </button>
                  <button onClick={() => setSeleccion(new Set())} className="w-full text-left text-xs text-gray-500 hover:underline">Limpiar la selección</button>
                </div>
              )}
            </div>
          )}
        </div>

        {filtros.length > 0 && (
          <div className="px-3 py-2 flex flex-wrap gap-2 border-b border-gray-100 dark:border-gray-700" data-testid="pastillas-filtros">
            {filtros.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-accent/10 text-accent-text text-xs font-medium pl-3 pr-1 py-1">
                <button onClick={() => setEditandoFiltro({ idx: i })} title="Editar el filtro">{etiquetaFiltro(f, catsProducto)}</button>
                <button onClick={() => setFiltros(fs => fs.filter((_, j) => j !== i))} className="p-0.5 rounded-full hover:bg-accent/20" aria-label="Quitar el filtro">
                  <X size={12} />
                </button>
              </span>
            ))}
            <button onClick={() => setFiltros([])} className="text-xs text-gray-500 hover:underline">Quitar todos</button>
          </div>
        )}

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="tabla-descuentos">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <CheckTri {...estadoCheck(idsFiltrados)} onChange={() => alternar(idsFiltrados)} label={`Seleccionar los ${idsFiltrados.length} productos`} />
                </th>
                <th className="px-2 py-2 text-left font-medium">Producto</th>
                <th className="px-2 py-2 text-left font-medium">Marca</th>
                <th className="px-2 py-2 text-right font-medium">Costo + IVA</th>
                <th className="px-2 py-2 text-right font-medium">Precio de venta</th>
                <th className="px-2 py-2 text-right font-medium">Margen</th>
                <th className="px-3 py-2 text-right font-medium">Descuento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {cargando ? (
                <tr><td colSpan={7} className="p-4 text-gray-400">Cargando…</td></tr>
              ) : grupos.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-gray-400">{productos.length === 0 ? 'No hay productos activos.' : 'Ningún producto cumple los filtros.'}</td></tr>
              ) : grupos.map(g => {
                const k = g.categoriaId ?? ''
                const ids = g.productos.map(p => p.id)
                const abierta = estaAbierta(k)
                return (
                  <Fragment key={k || 'sin'}>
                    <tr className="bg-gray-50/60 dark:bg-gray-900/40" data-categoria-producto={g.nombre}>
                      <td className="px-3 py-2"><CheckTri {...estadoCheck(ids)} onChange={() => alternar(ids)} label={`Seleccionar la categoría ${g.nombre}`} /></td>
                      <td className="px-2 py-2" colSpan={2}>
                        <button onClick={() => setAbiertas(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })}
                          className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100" aria-expanded={abierta}>
                          <ChevronRight size={15} className={`transition-transform ${abierta ? 'rotate-90' : ''}`} />
                          {g.nombre} <span className="text-xs font-normal text-gray-400">({g.productos.length})</span>
                        </button>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{g.costoPromedio === null ? '—' : formatMoneda(g.costoPromedio)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{g.precioPromedio === null ? '—' : formatMoneda(g.precioPromedio)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${g.margenPromedio !== null && g.margenPromedio < 0 ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}`}>{margenTexto(g.margenPromedio)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <input value={borrador[`cat:${k}`] ?? pctTexto(g.pctComun)} disabled={!puedeGestionar || trabajando}
                          placeholder={g.pctMixto ? 'varios' : '—'}
                          onChange={e => setBorrador(b => ({ ...b, [`cat:${k}`]: e.target.value }))}
                          onBlur={() => void guardarCategoria(k, g.nombre, ids)}
                          onKeyDown={enterConfirma}
                          aria-label={`Descuento para toda la categoría ${g.nombre}`} className={inputPct} />
                        <span className="ml-1 text-gray-400">%</span>
                      </td>
                    </tr>
                    {abierta && g.productos.slice(0, MAX_FILAS_POR_CATEGORIA).map(p => {
                      const precio = precioConDescuento(p, redondeo)
                      const margen = margenDe(p, redondeo)
                      return (
                        <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30" data-producto-descuento={p.sku ?? p.id}>
                          <td className="px-3 py-2 pl-6"><CheckTri checked={seleccion.has(p.id)} onChange={() => alternar([p.id])} label={`Seleccionar ${p.nombre}`} /></td>
                          <td className="px-2 py-2">
                            <p className="text-gray-800 dark:text-gray-100">{p.nombre}</p>
                            {p.sku && <p className="text-xs text-gray-400">{p.sku}</p>}
                          </td>
                          <td className="px-2 py-2 text-gray-600 dark:text-gray-300">{p.marca || '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{formatMoneda(costoConIva(p))}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            <span className="text-gray-800 dark:text-gray-100">{formatMoneda(precio)}</span>
                            {precio !== p.precioLista && <span className="block text-xs text-gray-400 line-through">{formatMoneda(p.precioLista)}</span>}
                          </td>
                          <td className={`px-2 py-2 text-right tabular-nums ${margen !== null && margen < 0 ? 'text-red-600 font-medium' : 'text-gray-600 dark:text-gray-300'}`}
                            title={margen !== null && margen < 0 ? 'Con este descuento se vende por debajo del costo' : undefined}>
                            {margenTexto(margen)}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <input value={borrador[p.id] ?? pctTexto(p.pct)} disabled={!puedeGestionar} placeholder="—"
                              onChange={e => setBorrador(b => ({ ...b, [p.id]: e.target.value }))}
                              onBlur={() => void guardarProducto(p)}
                              onKeyDown={enterConfirma}
                              aria-label={`Descuento de ${p.nombre}`} className={inputPct} />
                            <span className="ml-1 text-gray-400">%</span>
                          </td>
                        </tr>
                      )
                    })}
                    {abierta && g.productos.length > MAX_FILAS_POR_CATEGORIA && (
                      <tr><td colSpan={7} className="px-6 py-2 text-xs text-gray-400">
                        Se muestran {MAX_FILAS_POR_CATEGORIA} de {g.productos.length}. Usá la búsqueda o los filtros para encontrar el resto; el % de la categoría se aplica a los {g.productos.length}.
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 dark:border-gray-700">
          Vacío = sin cargar (no tiene descuento de la categoría). 0 = sin descuento a propósito. Precio y margen ya incluyen
          el descuento; el margen se calcula como en la ficha del producto (sobre el costo, sin IVA).
        </p>
      </div>

      {/* Mig 469 (B-4): el cartel que ve el cajero cuando compiten descuentos. Lo redacta la IA; los números, el motor. */}
      <div data-testid="cartel-categoria" className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles size={15} className="text-accent-text" />
          <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-200">Cartel para el cajero</h2>
          <span data-testid="cartel-origen" className={`text-xs px-2 py-0.5 rounded-full ${categoria?.cartel_origen === 'ia' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
            {categoria?.cartel_origen === 'ia' ? 'Redactado con IA' : 'Texto estándar'}
          </span>
          {puedeGestionar && (
            <button onClick={() => void redactarCartel(true)} disabled={redactando}
              className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
              <RefreshCw size={12} className={redactando ? 'animate-spin' : ''} /> {redactando ? 'Redactando…' : 'Volver a redactar'}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Aparece solo en la pantalla del punto de venta (no en el ticket ni en la factura) cuando en un producto compitieron
          descuentos. La IA solo redacta: recibe el nombre de la categoría y algunos productos con su %, nunca datos de
          clientes, costos ni márgenes. Los precios los completa el sistema en cada venta. Ejemplo:
        </p>
        <p className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          ℹ️ {completarFrase(textosCartel.categoria_gana, {
            producto: ejemploCartel?.nombre ?? 'Producto de ejemplo',
            pct: porcentajeLegible(ejemploCartel?.pct ?? 20),
            categoria: categoria?.nombre ?? '', precio: '$80', otro: 'precio por cantidad', otro_precio: '$85',
          })}
        </p>
      </div>
    </div>
  )
}

function Card({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{titulo}</p>
      <p className="text-xl font-bold text-gray-800 dark:text-gray-100 tabular-nums">{valor}</p>
      {detalle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{detalle}</p>}
    </div>
  )
}

function CheckTri({ checked, indeterminate = false, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return <input ref={el => { if (el) el.indeterminate = indeterminate }} type="checkbox"
    checked={checked} onChange={onChange} aria-label={label} className="accent-accent" />
}

const CAMPOS: { valor: FiltroLista['tipo']; nombre: string }[] = [
  { valor: 'marca', nombre: 'Marca' },
  { valor: 'categoria', nombre: 'Categoría' },
  { valor: 'margen', nombre: 'Margen (%)' },
  { valor: 'costo', nombre: 'Costo + IVA ($)' },
  { valor: 'precio', nombre: 'Precio de venta ($)' },
  { valor: 'descuento', nombre: 'Descuento (%)' },
]
const OPERADORES: { valor: OperadorFiltro; nombre: string }[] = [
  { valor: '>', nombre: 'mayor que' }, { valor: '>=', nombre: 'mayor o igual que' }, { valor: '=', nombre: 'igual a' },
  { valor: '<=', nombre: 'menor o igual que' }, { valor: '<', nombre: 'menor que' },
]

function EditorFiltro({ inicial, marcas, categorias, onGuardar, onCancelar }: {
  inicial: FiltroLista | null
  marcas: string[]
  categorias: Map<string, string>
  onGuardar: (f: FiltroLista) => void
  onCancelar: () => void
}) {
  const [tipo, setTipo] = useState<FiltroLista['tipo']>(inicial?.tipo ?? 'marca')
  const [valores, setValores] = useState<string[]>(inicial && 'valores' in inicial ? inicial.valores : [])
  const [op, setOp] = useState<OperadorFiltro>(inicial && 'op' in inicial ? inicial.op : '>=')
  const [valor, setValor] = useState(inicial && 'valor' in inicial ? String(inicial.valor).replace('.', ',') : '')
  const esLista = tipo === 'marca' || tipo === 'categoria'
  const opciones: [string, string][] = tipo === 'marca'
    ? marcas.map(m => [m, m || 'Sin marca'])
    : [...categorias.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))

  const guardar = () => {
    if (esLista) {
      if (valores.length === 0) { toast.error('Elegí al menos una opción'); return }
      onGuardar({ tipo: tipo as 'marca' | 'categoria', valores })
    } else {
      const n = parseFloat(valor.replace(/\./g, '').replace(',', '.'))
      if (!Number.isFinite(n)) { toast.error('Escribí un número'); return }
      onGuardar({ tipo: tipo as CampoNumerico, op, valor: n })
    }
  }

  return (
    <div className="absolute left-0 z-30 mt-2 w-80 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-3 space-y-3" data-testid="editor-filtro">
      <select value={tipo} onChange={e => { setTipo(e.target.value as FiltroLista['tipo']); setValores([]) }} aria-label="Campo del filtro"
        className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100">
        {CAMPOS.map(c => <option key={c.valor} value={c.valor}>{c.nombre}</option>)}
      </select>
      {esLista ? (
        <ul className="max-h-48 overflow-y-auto space-y-1">
          {opciones.map(([v, nombre]) => (
            <li key={v || 'vacio'}>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-accent" checked={valores.includes(v)}
                  onChange={() => setValores(vs => (vs.includes(v) ? vs.filter(x => x !== v) : [...vs, v]))} />
                {nombre}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex gap-2">
          <select value={op} onChange={e => setOp(e.target.value as OperadorFiltro)} aria-label="Operador"
            className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100">
            {OPERADORES.map(o => <option key={o.valor} value={o.valor}>{o.nombre}</option>)}
          </select>
          <input value={valor} onChange={e => setValor(e.target.value)} placeholder="Valor" aria-label="Valor del filtro" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') guardar() }}
            className="w-24 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100" />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancelar} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700">Cancelar</button>
        <button onClick={guardar} className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white">{inicial ? 'Guardar' : 'Agregar filtro'}</button>
      </div>
    </div>
  )
}
