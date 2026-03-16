import { useState } from 'react'
import { ArrowDown, ArrowUp, Search, Plus, Hash, X, Info, Layers } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useGruposEstados } from '@/hooks/useGruposEstados'
import toast from 'react-hot-toast'
import type { Producto } from '@/lib/supabase'

type ModalType = 'ingreso' | 'rebaje' | null

const emptyIngreso = {
  productoSearch: '', cantidad: '', motivo: '', ubicacionId: '',
  estadoId: '', proveedorId: '', nroLote: '', fechaVencimiento: '', lpn: '',
}

// Info tooltip component
function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block ml-1">
      <button type="button" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="text-gray-400 hover:text-[#2E75B6] transition-colors align-middle">
        <Info size={14} />
      </button>
      {show && (
        <div className="absolute z-50 left-5 top-0 w-64 bg-[#1E3A5F] text-white text-xs rounded-xl p-3 shadow-xl">
          {text}
        </div>
      )}
    </div>
  )
}

export default function MovimientosPage() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const { grupos, grupoDefault, estadosDefault } = useGruposEstados()
  const [modal, setModal] = useState<ModalType>(null)
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Producto | null>(null)
  const [form, setForm] = useState(emptyIngreso)
  const [series, setSeries] = useState<string[]>([''])

  // Para rebaje
  const [rebajeLpn, setRebajeLpn] = useState('')
  const [rebajeLinea, setRebajeLinea] = useState<any | null>(null)
  const [rebajeCantidad, setRebajeCantidad] = useState('')
  const [rebajeMotivo, setRebajeMotivo] = useState('')
  const [rebajeSeries, setRebajeSeries] = useState<string[]>([])
  const [rebajeSearch, setRebajeSearch] = useState('')
  const [rebajeGrupoId, setRebajeGrupoId] = useState<string | null>(null)

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey: ['movimientos', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimientos_stock')
        .select('*, productos(nombre,sku), users(nombre_display), estados_inventario(nombre,color)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: productosBusqueda = [] } = useQuery({
    queryKey: ['productos-busqueda', tenant?.id, form.productoSearch],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku, stock_actual, unidad_medida, imagen_url, tiene_series, tiene_lote, tiene_vencimiento')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .or(`nombre.ilike.%${form.productoSearch}%,sku.ilike.%${form.productoSearch}%`)
        .limit(8)
      return (data ?? []) as Producto[]
    },
    enabled: !!tenant && form.productoSearch.length > 1,
  })

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })

  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('proveedores').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })

  // Líneas del producto seleccionado (para rebaje)
  const { data: lineasProducto = [] } = useQuery({
    queryKey: ['lineas-producto', selectedProduct?.id],
    queryFn: async () => {
      const tieneSeries = (selectedProduct as any).tiene_series
      let q = supabase.from('inventario_lineas')
        .select('*, estados_inventario(nombre,color), ubicaciones(nombre), inventario_series(id,nro_serie,activo)')
        .eq('producto_id', selectedProduct!.id)
        .eq('activo', true)
        .order('created_at', { ascending: false })

      // Para productos sin series filtramos cantidad > 0
      // Para productos con series no filtramos cantidad porque puede ser 0
      if (!tieneSeries) q = q.gt('cantidad', 0)

      const { data } = await q
      return data ?? []
    },
    enabled: !!selectedProduct && modal === 'rebaje',
  })

  const ingresoMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error('Seleccioná un producto')
      const tieneSeries = (selectedProduct as any).tiene_series
      const cant = tieneSeries
        ? series.filter(s => s.trim()).length
        : parseInt(form.cantidad)

      if (!cant || cant <= 0) throw new Error('Ingresá una cantidad válida')

      // Capturar stock ANTES de insertar (el trigger lo modifica después)
      const { data: prodAntes } = await supabase
        .from('productos').select('stock_actual').eq('id', selectedProduct.id).single()
      const stockAntes = prodAntes?.stock_actual ?? 0

      // 1. Crear línea de inventario
      const { data: linea, error: lineaError } = await supabase
        .from('inventario_lineas')
        .insert({
          tenant_id: tenant!.id,
          producto_id: selectedProduct.id,
          lpn: form.lpn || null,
          cantidad: tieneSeries ? 0 : cant,
          estado_id: form.estadoId || null,
          ubicacion_id: form.ubicacionId || null,
          proveedor_id: form.proveedorId || null,
          nro_lote: form.nroLote || null,
          fecha_vencimiento: form.fechaVencimiento || null,
        })
        .select().single()
      if (lineaError) throw lineaError

      // 2. Si tiene series, insertar cada una
      if (tieneSeries) {
        const seriesValidas = series.filter(s => s.trim())
        if (seriesValidas.length === 0) throw new Error('Ingresá al menos un número de serie')
        const { error: seriesError } = await supabase.from('inventario_series').insert(
          seriesValidas.map(nro => ({
            tenant_id: tenant!.id,
            producto_id: selectedProduct.id,
            linea_id: linea.id,
            nro_serie: nro.trim(),
            estado_id: form.estadoId || null,
          }))
        )
        if (seriesError) {
          if (seriesError.code === '23505') throw new Error('Una o más series ya existen')
          throw seriesError
        }
      }

      // El trigger recalcula stock_actual automáticamente al insertar la línea/series.
      // Registrar movimiento con stock capturado antes
      await supabase.from('movimientos_stock').insert({
        tenant_id: tenant!.id,
        producto_id: selectedProduct.id,
        tipo: 'ingreso',
        cantidad: cant,
        stock_antes: stockAntes,
        stock_despues: stockAntes + cant,
        motivo: form.motivo || null,
        estado_id: form.estadoId || null,
        usuario_id: user?.id,
      })
    },
    onSuccess: () => {
      toast.success('Ingreso registrado')
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      closeModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rebajeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct || !rebajeLinea) throw new Error('Seleccioná producto y línea')
      const tieneSeries = (selectedProduct as any).tiene_series

      // Capturar stock ANTES de modificar (el trigger lo modifica después)
      const { data: prodAntes } = await supabase
        .from('productos').select('stock_actual').eq('id', selectedProduct.id).single()
      const stockAntes = prodAntes?.stock_actual ?? 0

      if (tieneSeries) {
        if (rebajeSeries.length === 0) throw new Error('Seleccioná al menos una serie')
        // Desactivar solo las series seleccionadas
        const { error: seriesError } = await supabase.from('inventario_series')
          .update({ activo: false })
          .in('id', rebajeSeries)
        if (seriesError) throw seriesError

        // Verificar si quedan series activas en la línea
        const { count } = await supabase.from('inventario_series')
          .select('id', { count: 'exact', head: true })
          .eq('linea_id', rebajeLinea.id)
          .eq('activo', true)

        // Desactivar la línea solo si no quedan series
        if (count === 0) {
          await supabase.from('inventario_lineas')
            .update({ activo: false })
            .eq('id', rebajeLinea.id)
        }
      } else {
        const cant = parseInt(rebajeCantidad)
        if (!cant || cant <= 0) throw new Error('Ingresá una cantidad válida')
        if (cant > rebajeLinea.cantidad) throw new Error(`Stock insuficiente en esta línea. Disponible: ${rebajeLinea.cantidad}`)
        const nuevaCant = rebajeLinea.cantidad - cant
        await supabase.from('inventario_lineas')
          .update({ cantidad: nuevaCant, activo: nuevaCant > 0 })
          .eq('id', rebajeLinea.id)
      }

      const cant = tieneSeries ? rebajeSeries.length : parseInt(rebajeCantidad)

      // El trigger recalcula stock_actual automáticamente.
      // Registrar movimiento con stock capturado antes
      await supabase.from('movimientos_stock').insert({
        tenant_id: tenant!.id,
        producto_id: selectedProduct.id,
        tipo: 'rebaje',
        cantidad: cant,
        stock_antes: stockAntes,
        stock_despues: Math.max(0, stockAntes - cant),
        motivo: rebajeMotivo || null,
        usuario_id: user?.id,
      })
    },
    onSuccess: () => {
      toast.success('Rebaje registrado')
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      closeModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const closeModal = () => {
    setModal(null); setSelectedProduct(null)
    setForm(emptyIngreso); setSeries([''])
    setRebajeLpn(''); setRebajeLinea(null)
    setRebajeCantidad(''); setRebajeMotivo(''); setRebajeSeries([])
    setRebajeSearch('')
    setRebajeGrupoId(null)
  }

  const filtered = movimientos.filter(m => {
    if (!search) return true
    const s = search.toLowerCase()
    return (m as any).productos?.nombre?.toLowerCase().includes(s) ||
      (m as any).productos?.sku?.toLowerCase().includes(s)
  })

  const tieneSeries = selectedProduct && (selectedProduct as any).tiene_series

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Movimientos de Stock</h1>
          <p className="text-gray-500 text-sm mt-0.5">Registro de ingresos y rebajes</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal('ingreso')}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <ArrowDown size={16} /> Ingreso
          </button>
          <button onClick={() => setModal('rebaje')}
            className="flex items-center gap-2 bg-[#1E3A5F] hover:bg-[#2E75B6] text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <ArrowUp size={16} /> Rebaje
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por producto o SKU..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] bg-white" />
      </div>

      {/* Tabla movimientos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1E3A5F]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p>No hay movimientos registrados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Fecha</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Producto</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Tipo</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Cantidad</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Stock prev.</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Stock nuevo</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m: any) => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{m.productos?.nombre}</div>
                      <div className="text-xs text-gray-400 font-mono">{m.productos?.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                        ${m.tipo === 'ingreso' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {m.tipo === 'ingreso' ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
                        {m.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">{m.cantidad}</td>
                    <td className="px-4 py-3 text-right text-gray-400 hidden md:table-cell">{m.stock_antes}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700 hidden md:table-cell">{m.stock_despues}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{m.motivo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal INGRESO */}
      {modal === 'ingreso' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2">
                <ArrowDown size={20} className="text-green-600" /> Ingreso de stock
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Buscar producto */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Producto</label>
              {selectedProduct ? (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-800">{selectedProduct.nombre}</p>
                    <p className="text-xs text-gray-500">SKU: {selectedProduct.sku} | Stock: {(selectedProduct as any).stock_actual}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(selectedProduct as any).tiene_series && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">Nº serie</span>}
                      {(selectedProduct as any).tiene_lote && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">Lote</span>}
                      {(selectedProduct as any).tiene_vencimiento && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Vencimiento</span>}
                    </div>
                  </div>
                  <button onClick={() => setSelectedProduct(null)} className="text-gray-400 hover:text-gray-600 text-xs">Cambiar</button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={form.productoSearch}
                    onChange={e => setForm(p => ({ ...p, productoSearch: e.target.value }))}
                    placeholder="Buscar por nombre o SKU..."
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                  {productosBusqueda.length > 0 && (
                    <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
                      {productosBusqueda.map(p => (
                        <button key={p.id} onClick={() => { setSelectedProduct(p); setForm(f => ({ ...f, productoSearch: '' })) }}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                          <span className="font-medium">{p.nombre}</span>
                          <span className="text-gray-400 ml-2 text-xs">{p.sku}</span>
                          {(p as any).tiene_series && <span className="ml-2 text-xs bg-purple-100 text-purple-600 px-1 rounded">series</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedProduct && (
              <>
                {/* LPN personalizado */}
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                    LPN
                    <InfoTip text="LPN (License Plate Number) es el identificador único de cada lote físico de mercadería. Se genera automáticamente si lo dejás vacío. Ejemplo: LPN-20260310-A3F2. Útil para rastrear exactamente dónde está cada grupo de productos." />
                    <span className="ml-1 text-gray-400 font-normal text-xs">(opcional — se genera automático)</span>
                  </label>
                  <input type="text" value={form.lpn} onChange={e => setForm(p => ({ ...p, lpn: e.target.value }))}
                    placeholder="Ej: LPN-20260101-A1"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-[#2E75B6]" />
                </div>

                {/* Cantidad o series */}
                {tieneSeries ? (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Números de serie</label>
                    <div className="space-y-2">
                      {series.map((s, i) => (
                        <div key={i} className="flex gap-2">
                          <div className="relative flex-1">
                            <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input type="text" value={s}
                              onChange={e => { const ns = [...series]; ns[i] = e.target.value; setSeries(ns) }}
                              placeholder={`Serie ${i + 1}`}
                              className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-[#2E75B6]" />
                          </div>
                          {series.length > 1 && (
                            <button onClick={() => setSeries(series.filter((_, j) => j !== i))}
                              className="text-red-400 hover:text-red-600 px-2"><X size={16} /></button>
                          )}
                        </div>
                      ))}
                      <button onClick={() => setSeries([...series, ''])}
                        className="flex items-center gap-1 text-sm text-[#2E75B6] hover:underline">
                        <Plus size={14} /> Agregar serie
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
                    <input type="number" min="1" value={form.cantidad} onChange={e => setForm(p => ({ ...p, cantidad: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" placeholder="0" />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 mb-3">
                  {estados.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                      <select value={form.estadoId} onChange={e => setForm(p => ({ ...p, estadoId: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]">
                        <option value="">Sin estado</option>
                        {(estados as any[]).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                      </select>
                    </div>
                  )}
                  {ubicaciones.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación</label>
                      <select value={form.ubicacionId} onChange={e => setForm(p => ({ ...p, ubicacionId: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]">
                        <option value="">Sin ubicación</option>
                        {(ubicaciones as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  {proveedores.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor</label>
                      <select value={form.proveedorId} onChange={e => setForm(p => ({ ...p, proveedorId: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]">
                        <option value="">Sin proveedor</option>
                        {(proveedores as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </div>
                  )}
                  {(selectedProduct as any).tiene_lote && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nro. de lote</label>
                      <input type="text" value={form.nroLote} onChange={e => setForm(p => ({ ...p, nroLote: e.target.value }))}
                        placeholder="Lote-001"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                    </div>
                  )}
                </div>

                {(selectedProduct as any).tiene_vencimiento && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de vencimiento</label>
                    <input type="date" value={form.fechaVencimiento} onChange={e => setForm(p => ({ ...p, fechaVencimiento: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                  </div>
                )}

                <div className="mb-5">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motivo (opcional)</label>
                  <input type="text" value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))}
                    placeholder="Ej: Compra a proveedor"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 border-2 border-gray-200 text-gray-600 font-semibold py-2.5 rounded-xl hover:border-gray-300">Cancelar</button>
              <button onClick={() => ingresoMutation.mutate()}
                disabled={!selectedProduct || ingresoMutation.isPending}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50">
                {ingresoMutation.isPending ? 'Guardando...' : 'Confirmar ingreso'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal REBAJE */}
      {modal === 'rebaje' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2">
                <ArrowUp size={20} /> Rebaje de stock
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Buscar producto */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Producto</label>
              {selectedProduct ? (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-800">{selectedProduct.nombre}</p>
                    <p className="text-xs text-gray-500">Stock total: {(selectedProduct as any).stock_actual}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(selectedProduct as any).tiene_series && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">Nº serie</span>}
                      {(selectedProduct as any).tiene_lote && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">Lote</span>}
                      {(selectedProduct as any).tiene_vencimiento && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Vencimiento</span>}
                    </div>
                  </div>
                  <button onClick={() => { setSelectedProduct(null); setRebajeLinea(null) }} className="text-gray-400 text-xs">Cambiar</button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={form.productoSearch}
                    onChange={e => setForm(p => ({ ...p, productoSearch: e.target.value }))}
                    placeholder="Buscar por nombre o SKU..."
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                  {productosBusqueda.length > 0 && (
                    <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
                      {productosBusqueda.map(p => (
                        <button key={p.id} onClick={() => { setSelectedProduct(p); setForm(f => ({ ...f, productoSearch: '' })) }}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                          <span className="font-medium">{p.nombre}</span>
                          <span className="text-gray-400 ml-2 text-xs">{p.sku}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Seleccionar línea */}
            {selectedProduct && (
              <>
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center">
                      Seleccioná línea de inventario
                      <InfoTip text="Cada ingreso de stock genera una línea independiente con su propio LPN (License Plate Number — identificador único del lote físico). Ejemplo: LPN-20260310-A3F2. Podés rebajar de una línea específica para tener trazabilidad exacta." />
                    </label>
                  </div>

                  {/* Filtro por grupo de estados */}
                  {grupos.length > 0 && (
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                      <Layers size={13} className="text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-500">Filtrar por grupo:</span>
                      <button
                        onClick={() => setRebajeGrupoId(null)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all
                          ${rebajeGrupoId === null && estadosDefault.length === 0
                            ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        Todos
                      </button>
                      {grupos.map(g => (
                        <button key={g.id}
                          onClick={() => setRebajeGrupoId(rebajeGrupoId === g.id ? null : g.id)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1
                            ${rebajeGrupoId === g.id || (rebajeGrupoId === null && g.es_default)
                              ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                          {g.nombre}
                          {g.es_default && rebajeGrupoId === null && <span className="text-yellow-300">★</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Barra de búsqueda de líneas */}
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={rebajeSearch} onChange={e => setRebajeSearch(e.target.value)}
                      placeholder="Buscar por ubicación, estado o lote..."
                      className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-[#2E75B6]" />
                  </div>
                  {lineasProducto.length === 0 ? (
                    <p className="text-sm text-gray-400 bg-gray-50 rounded-xl p-3 text-center">No hay líneas con stock disponible</p>
                  ) : (
                    <div className="space-y-2">
                      {lineasProducto
                        .filter((l: any) => {
                          if ((selectedProduct as any).tiene_series) {
                            return (l.inventario_series ?? []).filter((s: any) => s.activo).length > 0
                          }
                          return l.cantidad > 0
                        })
                        .filter((l: any) => {
                          if (!rebajeSearch) return true
                          const s = rebajeSearch.toLowerCase()
                          return (
                            (l.ubicaciones?.nombre ?? '').toLowerCase().includes(s) ||
                            (l.estados_inventario?.nombre ?? '').toLowerCase().includes(s) ||
                            (l.nro_lote ?? '').toLowerCase().includes(s) ||
                            (l.lpn ?? '').toLowerCase().includes(s)
                          )
                        })
                        .filter((l: any) => {
                          // Aplicar filtro de grupo (default o seleccionado)
                          const grupoActivo = rebajeGrupoId
                            ? grupos.find(g => g.id === rebajeGrupoId)
                            : grupoDefault
                          if (!grupoActivo || grupoActivo.estado_ids.length === 0) return true
                          if (!l.estado_id) return false
                          return grupoActivo.estado_ids.includes(l.estado_id)
                        })
                        .map((l: any) => (
                        <button key={l.id} onClick={() => { setRebajeLinea(l); setRebajeSeries([]) }}
                          className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all text-sm
                            ${rebajeLinea?.id === l.id ? 'border-[#2E75B6] bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          {/* Fila principal: ubicación y estado prominentes */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {l.estados_inventario && (
                                <span className="font-semibold text-sm" style={{ color: l.estados_inventario.color }}>
                                  ● {l.estados_inventario.nombre}
                                </span>
                              )}
                              {l.ubicaciones && (
                                <span className="text-sm text-gray-700 font-medium">📍 {l.ubicaciones.nombre}</span>
                              )}
                              {!l.estados_inventario && !l.ubicaciones && (
                                <span className="text-sm text-gray-500">Sin estado/ubicación</span>
                              )}
                            </div>
                            <span className="font-bold text-gray-800">
                              {(selectedProduct as any).tiene_series
                                ? `${(l.inventario_series ?? []).filter((s: any) => s.activo).length} u.`
                                : `${l.cantidad} u.`}
                            </span>
                          </div>
                          {/* Fila secundaria: LPN en gris pequeño + lote + vencimiento */}
                          <div className="flex gap-3 mt-1 text-xs text-gray-400">
                            <span className="font-mono">{l.lpn}</span>
                            {l.nro_lote && <span>🏷 {l.nro_lote}</span>}
                            {l.fecha_vencimiento && <span>📅 {new Date(l.fecha_vencimiento).toLocaleDateString('es-AR')}</span>}
                            {(l.cantidad_reservada ?? 0) > 0 && (
                              <span className="text-orange-400">{l.cantidad_reservada} reservada(s)</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {rebajeLinea && (
                  <>
                    {tieneSeries ? (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Seleccioná las series a rebajar</label>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {(rebajeLinea.inventario_series ?? []).filter((s: any) => s.activo).map((s: any) => (
                            <label key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                              <input type="checkbox" checked={rebajeSeries.includes(s.id)}
                                onChange={e => setRebajeSeries(e.target.checked
                                  ? [...rebajeSeries, s.id]
                                  : rebajeSeries.filter(id => id !== s.id))} />
                              <span className="font-mono text-sm">{s.nro_serie}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Cantidad a rebajar (disponible: {rebajeLinea.cantidad})
                        </label>
                        <input type="number" min="1" max={rebajeLinea.cantidad} value={rebajeCantidad}
                          onChange={e => setRebajeCantidad(e.target.value)}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" placeholder="0" />
                      </div>
                    )}

                    <div className="mb-5">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
                      <input type="text" value={rebajeMotivo} onChange={e => setRebajeMotivo(e.target.value)}
                        placeholder="Ej: Venta, pérdida, consumo..."
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                    </div>
                  </>
                )}
              </>
            )}

            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 border-2 border-gray-200 text-gray-600 font-semibold py-2.5 rounded-xl hover:border-gray-300">Cancelar</button>
              <button onClick={() => rebajeMutation.mutate()}
                disabled={!selectedProduct || !rebajeLinea || rebajeMutation.isPending}
                className="flex-1 bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50">
                {rebajeMutation.isPending ? 'Guardando...' : 'Confirmar rebaje'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
