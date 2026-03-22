import { BRAND } from '@/config/brand'
import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, ArrowLeftRight, Bell,
  BarChart2, Users, Settings, LogOut, Menu, X, ChevronRight, ShoppingCart, Layers, DollarSign, Zap, TrendingDown, ClipboardList
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useAlertas } from '@/hooks/useAlertas'
import { CotizacionWidget } from '@/components/CotizacionWidget'
import { differenceInDays } from 'date-fns'

const navItems = [
  { to: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/ventas',          icon: ShoppingCart,    label: 'Ventas' },
  { to: '/caja',            icon: DollarSign,      label: 'Caja' },
  { to: '/inventario',      icon: Package,         label: 'Inventario' },
  { to: '/movimientos',     icon: ArrowLeftRight,  label: 'Movimientos' },
  { to: '/alertas',         icon: Bell,            label: 'Alertas', badge: true },
  { to: '/gastos',          icon: TrendingDown,    label: 'Gastos' },
  { to: '/clientes',        icon: Users,           label: 'Clientes' },
  { to: '/reportes',        icon: BarChart2,       label: 'Reportes' },
  { to: '/rentabilidad',    icon: BarChart2,       label: 'Rentabilidad' },
  { to: '/recomendaciones', icon: Zap,             label: 'Recomendaciones' },
  { to: '/historial',       icon: ClipboardList,   label: 'Historial',      supervisorOnly: true },
  { to: '/usuarios',        icon: Users,           label: 'Usuarios',       ownerOnly: true },
  { to: '/configuracion',   icon: Settings,        label: 'Configuración',  ownerOnly: true },
  { to: '/grupos-estados',  icon: Layers,          label: 'Grupos estados', ownerOnly: true },
]

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, tenant, signOut } = useAuthStore()
  const { count: alertCount } = useAlertas()
  const navigate = useNavigate()

  const trialDaysLeft = tenant
    ? differenceInDays(new Date(tenant.trial_ends_at), new Date())
    : 0
  const showTrialBanner = tenant?.subscription_status === 'trial' && trialDaysLeft >= 0

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-accent/20">
        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
          <Package size={18} className="text-white" />
        </div>
        <span className="text-white font-bold text-xl tracking-tight">{BRAND.name}</span>
      </div>

      {/* Nombre del negocio */}
      <div className="px-6 py-3 border-b border-accent/20">
        <p className="text-accent text-xs font-medium uppercase tracking-wider">Negocio</p>
        <p className="text-white text-sm font-semibold truncate">{tenant?.nombre}</p>
      </div>

      {/* Navegación */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label, badge, ownerOnly, supervisorOnly }: any) => {
          if (ownerOnly && user?.rol !== 'OWNER' && user?.rol !== 'ADMIN') return null
          if (supervisorOnly && user?.rol !== 'OWNER' && user?.rol !== 'SUPERVISOR' && user?.rol !== 'ADMIN') return null
          return (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-accent text-white'
                  : 'text-blue-100 hover:bg-accent/30 hover:text-white'}`
              }
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {badge && alertCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Cotización USD */}
      <CotizacionWidget />

      {/* Usuario y logout */}
      <div className="px-3 py-3 border-t border-accent/20 space-y-1">
        <div className="px-3 py-2">
          <p className="text-white text-sm font-medium truncate">{user?.nombre_display}</p>
          <p className="text-blue-300 text-xs capitalize">{user?.rol?.toLowerCase()}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-blue-100 hover:bg-red-500/20 hover:text-red-300 transition-all w-full"
        >
          <LogOut size={18} />
          Cerrar sesión
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-brand-bg overflow-hidden">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-64 flex-col bg-primary flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Sidebar mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-primary z-50">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 text-white"
            >
              <X size={20} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar mobile */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
          <button onClick={() => setSidebarOpen(true)} className="text-primary">
            <Menu size={22} />
          </button>
          <span className="font-bold text-primary">{BRAND.name}</span>
        </header>

        {/* Trial banner */}
        {showTrialBanner && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
            <p className="text-amber-800 text-sm">
              <span className="font-semibold">Período de prueba:</span>{' '}
              {trialDaysLeft === 0
                ? 'Vence hoy'
                : `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restante${trialDaysLeft !== 1 ? 's' : ''}`}
            </p>
            <NavLink
              to="/suscripcion"
              className="flex items-center gap-1 text-amber-700 text-sm font-medium hover:text-amber-900"
            >
              Activar plan <ChevronRight size={14} />
            </NavLink>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
