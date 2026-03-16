import { useQuery } from '@tanstack/react-query'
import { Package, AlertTriangle, ArrowDown, ArrowUp, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Link } from 'react-router-dom'

export default function DashboardPage() {
  const { tenant } = useAuthStore()

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', tenant?.id],
    queryFn: async () => {
      const [productos, alertas, movimientos] = await Promise.all([
        supabase.from('productos').select('id, stock_actual, stock_minimo, precio_venta, precio_costo').eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('alertas').select('id').eq('tenant_id', tenant!.id).eq('resuelta', false),
        supabase.from('movimientos_stock').select('tipo, cantidad, created_at').eq('tenant_id', tenant!.id)
          .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      ])

      const prods = productos.data ?? []
      const totalProductos = prods.length
      const stockCritico = prods.filter(p => p.stock_actual <= p.stock_minimo).length
      const valorInventario = prods.reduce((acc, p) => acc + p.precio_costo * p.stock_actual, 0)
      const alertasActivas = alertas.data?.length ?? 0

      const movs = movimientos.data ?? []
      const ingresosHoy = movs.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + m.cantidad, 0)
      const rebajesHoy = movs.filter(m => m.tipo === 'rebaje').reduce((a, m) => a + m.cantidad, 0)

      return { totalProductos, stockCritico, valorInventario, alertasActivas, ingresosHoy, rebajesHoy }
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

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Valor inventario */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-[#2E75B6]" />
            <h2 className="font-semibold text-gray-700">Valor del inventario</h2>
          </div>
          <p className="text-3xl font-bold text-[#1E3A5F]">
            ${(stats?.valorInventario ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-400 mt-1">Calculado por precio de costo × stock actual</p>
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
