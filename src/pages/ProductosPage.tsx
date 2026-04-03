import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Package, AlertTriangle, Camera, ChevronDown, ChevronRight, Edit2, Layers } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useCotizacion } from '@/hooks/useCotizacion'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { BarcodeScanner } from '@/components/BarcodeScanner'

type Tab = 'productos' | 'estructura'

export default function ProductosPage() {
  const { tenant } = useAuthStore()
  const navigate = useNavigate()
  const { limits } = usePlanLimits()
  const { cotizacion } = useCotizacion()
  const [tab, setTab] = useState<Tab>('productos')
  const [search, setSearch] = useState('')
  const [filterAlerta, setFilterAlerta] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const { data: productos = [], isLoading } = useQuery({
    queryKey: ['productos', tenant?.id, search],
    queryFn: async () => {
      let q = supabase
        .from('productos')
        .select('*, categorias(nombre), proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (search) q = q.or(`nombre.ilike.%${search}%,sku.ilike.%${search}%,codigo_barras.eq.${search}`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const filtered = productos.filter(p => {
    if (filterAlerta && (p as any).stock_actual > (p as any).stock_minimo) return false
    return true
  })

  const stockCritico = productos.filter(p => (p as any).stock_actual <= (p as any).stock_minimo).length

  return (
    <div className="space-y-6">
      {showLimitModal && limits && (
        <PlanLimitModal tipo="producto" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Productos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{productos.length} productos registrados</p>
        </div>
        <div className="flex gap-2">
          <Link to="/productos/importar"
            className="flex items-center gap-2 border border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all">
            Importar
          </Link>
          <button
            onClick={() => {
              if (limits && !limits.puede_crear_producto) {
                setShowLimitModal(true)
              } else {
                navigate('/productos/nuevo')
              }
            }}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <Plus size={16} /> Nuevo producto
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl w-fit">
        {([
          { id: 'productos' as const, label: 'Productos', icon: Package },
          { id: 'estructura' as const, label: 'Estructura', icon: Layers },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === id
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {tab === 'estructura' ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-12 text-center">
          <Layers size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">Estructuras de producto</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
            Próximamente — definí unidades por caja, cajas por pallet, pesos y dimensiones para cada producto.
          </p>
        </div>
      ) : (
        <>
          {/* Barra de uso del plan */}
          {limits && limits.max_productos < 9999 && (
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm
              ${limits.pct_productos >= 90 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-700'}`}>
              <Package size={15} className={limits.pct_productos >= 90 ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'} />
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                  <span className={limits.pct_productos >= 90 ? 'text-orange-700 font-medium' : 'text-gray-500 dark:text-gray-400'}>
                    {limits.productos_actuales} de {limits.max_productos} productos
                  </span>
                  <span className={limits.pct_productos >= 90 ? 'text-orange-600' : 'text-gray-400 dark:text-gray-500'}>
                    {limits.pct_productos}%
                  </span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${limits.pct_productos >= 90 ? 'bg-orange-500' : 'bg-accent'}`}
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
            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
              onClick={() => setFilterAlerta(!filterAlerta)}>
              <AlertTriangle size={18} className="text-red-500" />
              <p className="text-red-700 dark:text-red-400 text-sm font-medium">
                {stockCritico} producto{stockCritico !== 1 ? 's' : ''} con stock crítico
                {filterAlerta ? ' — click para ver todos' : ' — click para filtrar'}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU o código..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
            </div>
            <button onClick={() => setScannerOpen(true)}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent transition-colors bg-white dark:bg-gray-800"
              title="Escanear código de barras">
              <Camera size={17} />
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <Package size={40} className="mb-3 opacity-50" />
                <p className="font-medium">{search ? 'No se encontraron productos' : 'No hay productos aún'}</p>
                {!search && <Link to="/productos/nuevo" className="mt-3 text-accent text-sm hover:underline">Agregá tu primer producto →</Link>}
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {filtered.map(p => {
                  const stock = (p as any).stock_actual ?? 0
                  const critico = stock <= (p as any).stock_minimo
                  const expanded = expandedId === p.id

                  return (
                    <div key={p.id}>
                      <div
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${expanded ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : p.id)}
                      >
                        <div className="w-5 flex-shrink-0 text-gray-400 dark:text-gray-500">
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>

                        {(p as any).imagen_url ? (
                          <img src={(p as any).imagen_url} alt={p.nombre} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Package size={16} className="text-gray-400 dark:text-gray-500" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{(p as any).sku}</p>
                        </div>

                        <div className="hidden md:block text-xs text-gray-400 dark:text-gray-500">
                          {(p as any).categorias?.nombre ?? '—'}
                        </div>

                        <div className="hidden sm:block text-right flex-shrink-0">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            ${((p as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </p>
                          {cotizacion > 0 && (p as any).precio_venta > 0 && (
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              USD {((p as any).precio_venta / cotizacion).toFixed(2)}
                            </p>
                          )}
                        </div>

                        <div className="text-right flex-shrink-0">
                          <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-lg text-xs
                            ${critico ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                            {critico && <AlertTriangle size={11} />}
                            {stock} {(p as any).unidad_medida}
                          </span>
                        </div>

                        <Link to={`/productos/${p.id}/editar`}
                          onClick={e => e.stopPropagation()}
                          className="text-xs text-accent hover:underline flex-shrink-0 hidden sm:block">
                          Editar
                        </Link>
                      </div>

                      {/* Panel de resumen del producto */}
                      {expanded && (
                        <div className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-600 px-6 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Stock actual</p>
                              <p className={`font-semibold ${critico ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
                                {stock} {(p as any).unidad_medida}
                              </p>
                              {(p as any).stock_minimo != null && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">Mín: {(p as any).stock_minimo}</p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Precio venta</p>
                              <p className="font-semibold text-gray-800 dark:text-gray-100">
                                ${((p as any).precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                              </p>
                              {cotizacion > 0 && (p as any).precio_venta > 0 && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                  USD {((p as any).precio_venta / cotizacion).toFixed(2)}
                                </p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Costo</p>
                              <p className="font-semibold text-gray-800 dark:text-gray-100">
                                ${((p as any).precio_costo ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Categoría</p>
                              <p className="text-gray-700 dark:text-gray-300">{(p as any).categorias?.nombre ?? '—'}</p>
                            </div>
                            {(p as any).proveedores?.nombre && (
                              <div>
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Proveedor</p>
                                <p className="text-gray-700 dark:text-gray-300">{(p as any).proveedores.nombre}</p>
                              </div>
                            )}
                            {(p as any).codigo_barras && (
                              <div>
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Código de barras</p>
                                <p className="text-gray-700 dark:text-gray-300 font-mono text-xs">{(p as any).codigo_barras}</p>
                              </div>
                            )}
                            {(p as any).notas && (
                              <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Notas</p>
                                <p className="text-gray-600 dark:text-gray-300 text-xs">{(p as any).notas}</p>
                              </div>
                            )}
                          </div>
                          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                            <Link to={`/productos/${p.id}/editar`}
                              className="flex items-center gap-1.5 text-sm text-accent hover:underline font-medium w-fit">
                              <Edit2 size={13} /> Editar producto
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

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
