import { useQuery } from '@tanstack/react-query'
import { Package, AlertTriangle, ArrowDown, ArrowUp, TrendingUp, ShoppingCart, DollarSign } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Link } from 'react-router-dom'

export default function DashboardPage() {
  const { tenant } = useAuthStore()

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', tenant?.id],
    queryFn: async () => {
      const hoy = new Date()
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()
      const hace7dias = new Date(Date.now() - 7 * 86400000).toISOString()

      const [productos, alertas, movimientos, ventasMes] = await Promise.all([
        supabase.from('productos').select('id, stock_actual, stock_minimo, precio_venta, precio_costo').eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('alertas').select('id').eq('tenant_id', tenant!.id).eq('resuelta', false),
        supabase.from('movimientos_stock').select('tipo, cantidad, created_at').eq('tenant_id', tenant!.id).gte('created_at', hace7dias),
        supabase.from('ventas').select('total, estado').eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes),
      ])

      const prods = productos.data ?? []
      const totalProductos = prods.length
      const stockCritico = prods.filter(p => p.stock_actual <= p.stock_minimo).length
      const valorInventario = prods.reduce((acc, p) => acc + p.precio_costo * p.stock_actual, 0)
      const alertasActivas = alertas.data?.length ?? 0
      const movs = movimientos.data ?? []
      const ingresosHoy = movs.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + m.cantidad, 0)
      const rebajesHoy = movs.filter(m => m.tipo === 'rebaje').reduce((a, m) => a + m.cantidad, 0)
      const ventas = ventasMes.data ?? []
      const totalVentasMes = ventas.reduce((a, v) => a + (v.total ?? 0), 0)
      const cantVentasMes = ventas.length

      return { totalProductos, stockCritico, valorInventario, alertasActivas, ingresosHoy, rebajesHoy, totalVentasMes, cantVentasMes }
    },
    enabled: !!tenant,
  })

  const { data: movRecientes = [] } = useQuery({
    queryKey: ['movimientos-recientes', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('movimientos_stock')
        .select('*, productos(nombre,sku)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(5)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: topProductos = [] } = useQuery({
    queryKey: ['dashboard-top-productos', tenant?.id],
    queryFn: async () => {
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const { data: ventas } = await supabase.from('ventas')
        .select('venta_items(cantidad, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', inicioMes)

      const ranking: Record<string, { nombre: string; cantidad: number }> = {}
      ;(ventas ?? []).forEach((v: any) => {
        ;(v.venta_items ?? []).forEach((item: any) => {
          const nombre = item.productos?.nombre ?? ''
          if (!ranking[nombre]) ranking[nombre] = { nombre, cantidad: 0 }
          ranking[nombre].cantidad += item.cantidad ?? 0
        })
      })
      return Object.values(ranking).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5)
    },
    enabled: !!tenant,
  })

  const cards = [
    { label: 'Total productos', value: stats?.totalProductos ?? 0, icon: Package, color: 'bg-blue-50 text-blue-600', link: '/inventario' },
    { label: 'Alertas activas', value: stats?.alertasActivas ?? 0, icon: AlertTriangle, color: 'bg-red-50 text-red-500', link: '/alertas' },
    { label: 'Ingresos (7d)', value: stats?.ingresosHoy ?? 0, icon: ArrowDown, color: 'bg-green-50 text-green-600', link: '/movimientos' },
    { label: 'Rebajes (7d)', value: stats?.rebajesHoy ?? 0, icon: ArrowUp, color: 'bg-purple-50 text-purple-600', link: '/movimientos' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-0.5">Bienvenido a {tenant?.nombre}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color, link }) => (
          <Link key={label} to={link}
            className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all">
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 ${color}`}>
              <Icon size={20} />
            </div>
            <p className="text-2xl font-bold text-gray-800">{value.toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-0.5">{label}</p>
          </Link>
        ))}
      </div>

      {/* Ventas del mes */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-[#1E3A5F] to-[#2E75B6] rounded-xl p-5 text-white">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={18} className="text-blue-200" />
            <span className="text-blue-200 text-sm">Ventas este mes</span>
          </div>
          <p className="text-3xl font-bold">
            ${(stats?.totalVentasMes ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-blue-200 text-xs mt-1">{stats?.cantVentasMes ?? 0} ventas despachadas</p>
          <Link to="/metricas" className="inline-block mt-3 text-xs text-blue-300 hover:text-white transition-colors">
            Ver métricas completas →
          </Link>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-[#2E75B6]" />
            <h2 className="font-semibold text-gray-700">Valor del inventario</h2>
          </div>
          <p className="text-3xl font-bold text-[#1E3A5F]">
            ${(stats?.valorInventario ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-400 mt-1">Precio costo × stock actual</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top productos del mes */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <ShoppingCart size={16} className="text-[#2E75B6]" /> Top productos este mes
            </h2>
            <Link to="/metricas" className="text-xs text-[#2E75B6] hover:underline">Ver más →</Link>
          </div>
          {topProductos.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Sin ventas este mes</p>
          ) : (
            <div className="space-y-2">
              {topProductos.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                      ${i === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-500'}`}>
                      {i + 1}
                    </span>
                    <span className="text-gray-700 truncate max-w-[160px]">{p.nombre}</span>
                  </div>
                  <span className="font-semibold text-[#1E3A5F]">{p.cantidad} u.</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Movimientos recientes */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700">Movimientos recientes</h2>
            <Link to="/movimientos" className="text-xs text-[#2E75B6] hover:underline">Ver todos →</Link>
          </div>
          {movRecientes.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Sin movimientos aún</p>
          ) : (
            <div className="space-y-2">
              {movRecientes.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${m.tipo === 'ingreso' ? 'bg-green-500' : 'bg-blue-500'}`} />
                    <span className="text-gray-700 truncate max-w-[160px]">{m.productos?.nombre}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <span className={`font-medium ${m.tipo === 'ingreso' ? 'text-green-600' : 'text-blue-600'}`}>
                      {m.tipo === 'ingreso' ? '+' : '-'}{m.cantidad}
                    </span>
                    <span className="text-xs">{new Date(m.created_at).toLocaleDateString('es-AR')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
