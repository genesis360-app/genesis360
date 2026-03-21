import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Package, AlertTriangle, ChevronDown, ChevronRight, MapPin, Tag, Hash, Settings2, Camera } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useCotizacion } from '@/hooks/useCotizacion'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { LpnAccionesModal } from '@/components/LpnAccionesModal'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import toast from 'react-hot-toast'

export default function InventarioPage() {
  const { tenant } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { limits } = usePlanLimits()
  const { cotizacion } = useCotizacion()
  const [search, setSearch] = useState('')
  const [filterAlerta, setFilterAlerta] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [lpnAcciones, setLpnAcciones] = useState<{ linea: any; producto: any } | null>(null)

  const { data: productos = [], isLoading } = useQuery({
    queryKey: ['productos', tenant?.id, search],
    queryFn: async () => {
      let q = supabase
        .from('productos')
        .select('*, categorias(nombre), proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (search) q = q.or(`nombre.ilike.%${search}%,sku.ilike.%${search}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: lineasMap = {} } = useQuery({
    queryKey: ['inventario_lineas_all', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventario_lineas')
        .select('*, estados_inventario(nombre,color), ubicaciones(nombre), proveedores(nombre), inventario_series(id, nro_serie, activo, reservado)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('created_at', { ascending: false })
      if (error) throw error
      const map: Record<string, any[]> = {}
      for (const l of data ?? []) {
        if (!map[l.producto_id]) map[l.producto_id] = []
        map[l.producto_id].push(l)
      }
      return map
    },
    enabled: !!tenant,
  })

  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const cambiarEstadoLinea = useMutation({
    mutationFn: async ({ lineaId, estadoId }: { lineaId: string; estadoId: string }) => {
      const { error } = await supabase.from('inventario_lineas').update({ estado_id: estadoId || null }).eq('id', lineaId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Estado actualizado'); qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] }) },
    onError: () => toast.error('Error al actualizar'),
  })

  const getStockTotal = (producto: any) => {
    const lineas = lineasMap[producto.id] ?? []
    if (producto.tiene_series) {
      return lineas.reduce((acc: number, l: any) =>
        acc + (l.inventario_series ?? []).filter((s: any) => s.activo).length, 0)
    }
    return lineas.reduce((acc: number, l: any) => acc + (l.cantidad || 0), 0)
  }

  const filtered = productos.filter(p => {
    const stock = getStockTotal(p)
    if (filterAlerta && stock > (p as any).stock_minimo) return false
    return true
  })

  const stockCritico = productos.filter(p => getStockTotal(p) <= (p as any).stock_minimo).length

  return (
    <div className="space-y-6">
      {/* Modal límite */}
      {showLimitModal && limits && (
        <PlanLimitModal tipo="producto" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}

      {/* Modal acciones LPN */}
      {lpnAcciones && (
        <LpnAccionesModal
          linea={lpnAcciones.linea}
          producto={lpnAcciones.producto}
          onClose={() => setLpnAcciones(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Inventario</h1>
          <p className="text-gray-500 text-sm mt-0.5">{productos.length} productos registrados</p>
        </div>
        <div className="flex gap-2">
          <Link to="/inventario/importar"
            className="flex items-center gap-2 border border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-50 transition-all">
            Importar
          </Link>
          <button
            onClick={() => {
              if (limits && !limits.puede_crear_producto) {
                setShowLimitModal(true)
              } else {
                navigate('/inventario/nuevo')
              }
            }}
            className="flex items-center gap-2 bg-primary hover:bg-accent text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <Plus size={16} /> Nuevo producto
          </button>
        </div>
      </div>

      {/* Barra de uso del plan */}
      {limits && limits.max_productos < 9999 && (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm
          ${limits.pct_productos >= 90 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
          <Package size={15} className={limits.pct_productos >= 90 ? 'text-orange-500' : 'text-gray-400'} />
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className={limits.pct_productos >= 90 ? 'text-orange-700 font-medium' : 'text-gray-500'}>
                {limits.productos_actuales} de {limits.max_productos} productos
              </span>
              <span className={limits.pct_productos >= 90 ? 'text-orange-600' : 'text-gray-400'}>
                {limits.pct_productos}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all
                ${limits.pct_productos >= 90 ? 'bg-orange-500' : 'bg-accent'}`}
                style={{ width: `${Math.min(limits.pct_productos, 100)}%` }} />
            </div>
          </div>
          {limits.pct_productos >= 90 && (
            <Link to="/suscripcion" className="text-xs text-orange-600 font-medium hover:underline whitespace-nowrap">
              Mejorar plan →
            </Link>
          )}
        </div>
      )}

      {stockCritico > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-red-100 transition-all"
          onClick={() => setFilterAlerta(!filterAlerta)}>
          <AlertTriangle size={18} className="text-red-500" />
          <p className="text-red-700 text-sm font-medium">
            {stockCritico} producto{stockCritico !== 1 ? 's' : ''} con stock crítico
            {filterAlerta ? ' — click para ver todos' : ' — click para filtrar'}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU o código..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent bg-white" />
        </div>
        <button
          onClick={() => setScannerOpen(true)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 hover:text-accent transition-colors bg-white"
          title="Escanear código de barras"
        >
          <Camera size={17} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Package size={40} className="mb-3 opacity-50" />
            <p className="font-medium">{search ? 'No se encontraron productos' : 'No hay productos aún'}</p>
            {!search && <Link to="/inventario/nuevo" className="mt-3 text-accent text-sm hover:underline">Agregá tu primer producto →</Link>}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(p => {
              const lineas = lineasMap[p.id] ?? []
              const stockTotal = getStockTotal(p)
              const critico = stockTotal <= (p as any).stock_minimo
              const expanded = expandedId === p.id
              const tieneSeries = (p as any).tiene_series

              return (
                <div key={p.id}>
                  {/* Fila del producto */}
                  <div
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${expanded ? 'bg-blue-50/50' : ''}`}
                    onClick={() => setExpandedId(expanded ? null : p.id)}
                  >
                    <div className="w-5 flex-shrink-0 text-gray-400">
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>

                    {(p as any).imagen_url ? (
                      <img src={(p as any).imagen_url} alt={p.nombre} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package size={16} className="text-gray-400" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{p.nombre}</p>
                      <p className="text-xs text-gray-400 font-mono">{(p as any).sku}</p>
                    </div>

                    <div className="hidden md:block text-xs text-gray-400">
                      {(p as any).categorias?.nombre ?? '—'}
                    </div>

                    <div className="hidden sm:block text-right flex-shrink-0">
                      <p className="text-sm font-medium text-gray-700">
                        ${((p as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </p>
                      {cotizacion > 0 && (p as any).precio_venta > 0 && (
                        <p className="text-xs text-gray-400">
                          USD {((p as any).precio_venta / cotizacion).toFixed(2)}
                        </p>
                      )}
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-lg text-xs
                        ${critico ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                        {critico && <AlertTriangle size={11} />}
                        {stockTotal} {(p as any).unidad_medida}
                      </span>
                      <p className="text-xs text-gray-400 mt-0.5">{lineas.length} línea{lineas.length !== 1 ? 's' : ''}</p>
                    </div>

                    <Link to={`/inventario/${p.id}/editar`}
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-accent hover:underline flex-shrink-0 hidden sm:block">
                      Editar
                    </Link>
                  </div>

                  {/* Líneas expandidas */}
                  {expanded && (
                    <div className="bg-gray-50 border-t border-gray-100 px-4 py-3">
                      {lineas.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-2">Sin líneas de inventario. Registrá un ingreso para este producto.</p>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-gray-500 px-3 mb-1">
                            <span className="col-span-1">LPN</span>
                            <span className="col-span-1 text-right">Cantidad</span>
                            <span className="col-span-1">Estado</span>
                            <span className="col-span-1">Ubicación</span>
                            <span className="col-span-1">Lote / Venc.</span>
                            <span className="col-span-1">Series</span>
                            <span className="col-span-1 text-center">Acciones</span>
                          </div>
                          {lineas.map((l: any) => (
                            <div key={l.id} className="bg-white rounded-xl border border-gray-100 px-3 py-2.5 grid grid-cols-7 gap-2 items-center text-sm">
                              {/* LPN */}
                              <div className="col-span-1">
                                <span className="font-mono text-xs text-primary font-semibold">{l.lpn}</span>
                                {l.proveedor_id && <p className="text-xs text-gray-400 truncate">{l.proveedores?.nombre}</p>}
                              </div>

                              {/* Cantidad */}
                              <div className="col-span-1 text-right">
                                {tieneSeries ? (
                                  <div>
                                    <span className="font-semibold text-gray-800">
                                      {(l.inventario_series ?? []).filter((s: any) => s.activo).length} u.
                                    </span>
                                    {(l.inventario_series ?? []).filter((s: any) => s.activo && s.reservado).length > 0 && (
                                      <p className="text-xs text-orange-500 font-medium">
                                        {(l.inventario_series ?? []).filter((s: any) => s.activo && s.reservado).length} reservada(s)
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <span className="font-semibold text-gray-800">{l.cantidad} {(p as any).unidad_medida}</span>
                                    {(l.cantidad_reservada ?? 0) > 0 && (
                                      <p className="text-xs text-orange-500 font-medium">
                                        {l.cantidad_reservada} reservada(s)
                                      </p>
                                    )}
                                    {(l.cantidad_reservada ?? 0) > 0 && (
                                      <p className="text-xs text-green-600">
                                        {l.cantidad - l.cantidad_reservada} disponible(s)
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Estado - dropdown rápido */}
                              <div className="col-span-1">
                                <select
                                  value={l.estado_id ?? ''}
                                  onChange={e => cambiarEstadoLinea.mutate({ lineaId: l.id, estadoId: e.target.value })}
                                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-full focus:outline-none focus:border-accent bg-white"
                                  style={{ color: l.estados_inventario?.color ?? '#6b7280', fontWeight: 500 }}
                                >
                                  <option value="">Sin estado</option>
                                  {(estados as any[]).map(e => (
                                    <option key={e.id} value={e.id}>{e.nombre}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Ubicación */}
                              <div className="col-span-1">
                                {l.ubicaciones?.nombre ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                                    <MapPin size={11} /> {l.ubicaciones.nombre}
                                  </span>
                                ) : <span className="text-xs text-gray-300">—</span>}
                              </div>

                              {/* Lote / Vencimiento */}
                              <div className="col-span-1">
                                {l.nro_lote && (
                                  <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                                    <Tag size={11} /> {l.nro_lote}
                                  </span>
                                )}
                                {l.fecha_vencimiento && (
                                  <p className="text-xs text-gray-400">{new Date(l.fecha_vencimiento).toLocaleDateString('es-AR')}</p>
                                )}
                                {!l.nro_lote && !l.fecha_vencimiento && <span className="text-xs text-gray-300">—</span>}
                              </div>

                              {/* Series */}
                              <div className="col-span-1">
                                {tieneSeries ? (
                                  <div className="space-y-0.5">
                                    {(l.inventario_series ?? []).filter((s: any) => s.activo).map((s: any) => (
                                      <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono block">
                                        <Hash size={9} />{s.nro_serie}
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="text-xs text-gray-300">—</span>}
                              </div>

                              {/* Acciones */}
                              <div className="col-span-1 flex justify-center">
                                <button
                                  onClick={e => { e.stopPropagation(); setLpnAcciones({ linea: l, producto: p }) }}
                                  className="p-1.5 text-gray-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Acciones sobre este LPN">
                                  <Settings2 size={15} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {scannerOpen && (
        <BarcodeScanner
          title="Buscar producto"
          onDetected={code => { setSearch(code); setScannerOpen(false) }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}
