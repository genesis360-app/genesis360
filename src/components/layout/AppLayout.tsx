import { BRAND, APP_VERSION } from '@/config/brand'
import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, ArrowLeftRight, Bell,
  BarChart2, Users, Users2, Settings, LogOut, Menu, X, ChevronRight, ChevronLeft,
  ShoppingCart, DollarSign, Zap, TrendingDown, ClipboardList, HelpCircle,
  Moon, Sun, LifeBuoy, Lock, CreditCard, Building2
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useAlertas } from '@/hooks/useAlertas'
import { CotizacionWidget } from '@/components/CotizacionWidget'
import { Walkthrough, useWalkthrough } from '@/components/Walkthrough'
import { differenceInDays } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'

const navItems = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/ventas',        icon: ShoppingCart,    label: 'Ventas' },
  { to: '/gastos',        icon: TrendingDown,    label: 'Gastos' },
  { to: '/caja',          icon: DollarSign,      label: 'Caja' },
  { to: '/productos',     icon: Package,         label: 'Productos' },
  { to: '/inventario',    icon: ArrowLeftRight,  label: 'Inventario' },
  { to: '/clientes',      icon: Users,           label: 'Clientes' },
  { to: '/alertas',       icon: Bell,            label: 'Alertas', badge: true },
  { to: '/reportes',      icon: BarChart2,       label: 'Reportes',   planFeature: 'puede_reportes' },
  { to: '/historial',     icon: ClipboardList,   label: 'Historial',  supervisorOnly: true, planFeature: 'puede_historial' },
  { to: '/rrhh',          icon: Users2,          label: 'RRHH',       ownerOnly: true, planFeature: 'puede_rrhh' },
  { to: '/sucursales',    icon: Building2,       label: 'Sucursales', ownerOnly: true },
  { to: '/usuarios',      icon: Users,           label: 'Usuarios',   ownerOnly: true },
  { to: '/configuracion', icon: Settings,        label: 'Configuración', ownerOnly: true },
]

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('dark-mode') === 'true')

  const toggleCollapse = () => {
    setSidebarCollapsed(v => {
      localStorage.setItem('sidebar-collapsed', String(!v))
      return !v
    })
  }

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [darkMode])

  const toggleDarkMode = () => {
    setDarkMode(v => {
      localStorage.setItem('dark-mode', String(!v))
      return !v
    })
  }

  const { user, tenant, signOut } = useAuthStore()
  const { count: alertCount } = useAlertas()
  const { visto } = useWalkthrough()
  const navigate = useNavigate()
  const { limits } = usePlanLimits()
  const { sucursalId, sucursales, setSucursal } = useSucursalFilter()

  // Abrir automáticamente la primera vez
  useEffect(() => {
    if (!visto) setWalkthroughOpen(true)
  }, [])

  const { data: cajaAbierta = false } = useQuery({
    queryKey: ['caja-status', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id').eq('tenant_id', tenant!.id).eq('estado', 'abierta').limit(1)
      return (data ?? []).length > 0
    },
    enabled: !!tenant,
    refetchInterval: 60000,
    staleTime: 30000,
  })

  const trialDaysLeft = tenant
    ? differenceInDays(new Date(tenant.trial_ends_at), new Date())
    : 0
  const showTrialBanner = tenant?.subscription_status === 'trial' && trialDaysLeft >= 0

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => {
    const collapsed = !mobile && sidebarCollapsed
    return (
      <div className="flex flex-col h-full">
        {/* Logo + toggle */}
        <div className={`flex items-center border-b border-accent/20 ${collapsed ? 'justify-center px-2 py-5' : 'gap-3 px-6 py-5'}`}>
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center flex-shrink-0">
            <Package size={18} className="text-white" />
          </div>
          {!collapsed && (
            <div className="flex flex-col flex-1">
              <span className="text-white font-bold text-xl tracking-tight leading-tight">{BRAND.name}</span>
              <span className="text-blue-300/60 text-[10px] leading-none">{APP_VERSION}</span>
            </div>
          )}
          {!mobile && (
            <button onClick={toggleCollapse} title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
              className="text-blue-300 hover:text-white transition-colors ml-auto">
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          )}
        </div>

        {/* Nombre del negocio */}
        {!collapsed && (
          <div className="px-6 py-3 border-b border-accent/20">
            <p className="text-accent text-xs font-medium uppercase tracking-wider">Negocio</p>
            <p className="text-white text-sm font-semibold truncate">{tenant?.nombre}</p>
          </div>
        )}

        {/* Navegación */}
        <nav className={`flex-1 py-4 space-y-1 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-3'}`}>
          {navItems.map(({ to, icon: Icon, label, badge, ownerOnly, supervisorOnly, planFeature }: any) => {
            if (ownerOnly && user?.rol !== 'OWNER' && user?.rol !== 'ADMIN') return null
            if (supervisorOnly && user?.rol !== 'OWNER' && user?.rol !== 'SUPERVISOR' && user?.rol !== 'ADMIN') return null
            const locked = planFeature && limits != null && !(limits as any)[planFeature]
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => setSidebarOpen(false)}
                title={collapsed ? label : locked ? `${label} — requiere plan superior` : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-lg text-sm font-medium transition-all
                  ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
                  ${locked
                    ? 'text-blue-300/50 hover:bg-accent/10 hover:text-blue-200/60'
                    : isActive
                      ? 'bg-accent text-white'
                      : 'text-blue-100 hover:bg-accent/30 hover:text-white'}`
                }
              >
                <div className="relative flex-shrink-0">
                  <Icon size={18} />
                  {to === '/caja' && collapsed && (
                    <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-primary ${cajaAbierta ? 'bg-green-400' : 'bg-red-400'}`} />
                  )}
                  {badge && alertCount > 0 && collapsed && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none" style={{ fontSize: 9 }}>
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </div>
                {!collapsed && <span className="flex-1">{label}</span>}
                {!collapsed && locked && <Lock size={12} className="text-blue-300/50 flex-shrink-0" />}
                {!collapsed && to === '/caja' && !locked && (
                  <span className={`w-2 h-2 rounded-full ${cajaAbierta ? 'bg-green-400' : 'bg-red-400'}`} title={cajaAbierta ? 'Caja abierta' : 'Caja cerrada'} />
                )}
                {!collapsed && badge && alertCount > 0 && !locked && (
                  <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Mi Plan */}
        <div className={`border-t border-accent/20 ${collapsed ? 'px-1.5 py-2' : 'px-3 py-2'}`}>
          <NavLink
            to="/suscripcion"
            title={collapsed ? `Plan ${limits?.plan_id ?? ''}` : undefined}
            className={({ isActive }) =>
              `flex items-center rounded-lg text-xs font-medium transition-all
              ${collapsed ? 'justify-center px-2 py-2' : 'gap-2 px-3 py-2'}
              ${isActive ? 'bg-accent text-white' : 'text-blue-200 hover:bg-accent/30 hover:text-white'}`
            }
          >
            <CreditCard size={15} className="flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 truncate capitalize">
                  Plan {limits?.plan_id === 'basico' ? 'Básico' : limits?.plan_id === 'pro' ? 'Pro' : limits?.plan_id === 'enterprise' ? 'Enterprise' : 'Free'}
                </span>
                <ChevronRight size={12} className="opacity-60" />
              </>
            )}
          </NavLink>
        </div>

        {/* Cotización USD */}
        {!collapsed && <CotizacionWidget />}
      </div>
    )
  }

  const headerBtnCls = 'p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 transition-all'

  return (
    <div className="flex h-screen bg-brand-bg dark:bg-gray-950 overflow-hidden">
      <Walkthrough open={walkthroughOpen} onClose={() => setWalkthroughOpen(false)} />

      {/* Sidebar desktop */}
      <aside className={`hidden lg:flex flex-col bg-primary flex-shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
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
            <SidebarContent mobile />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Banner DEV — visible solo fuera de dominios de producción */}
        {!['app.genesis360.pro', 'genesis360.pro', 'www.genesis360.pro'].includes(window.location.hostname) && (
          <div className="bg-amber-400 text-amber-900 text-xs font-semibold text-center py-0.5 flex-shrink-0">
            ⚠ Ambiente DEV — {window.location.hostname}
          </div>
        )}
        {/* Top bar — universal (mobile + desktop) */}
        <header className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm flex-shrink-0">
          {/* Hamburger (mobile) */}
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-primary dark:text-blue-400 flex-shrink-0">
            <Menu size={22} />
          </button>

          {/* Sucursal / negocio + user info */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-primary dark:text-blue-400 leading-tight truncate">
              {sucursalId
                ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? tenant?.nombre)
                : (tenant?.nombre ?? BRAND.name)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {user?.nombre_display}{user?.rol ? ` · ${user.rol.charAt(0) + user.rol.slice(1).toLowerCase()}` : ''}
            </p>
          </div>

          {/* Selector de sucursal — oculto en mobile, visible en desktop */}
          {sucursales.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              <Building2 size={15} className="text-gray-400 flex-shrink-0" />
              <select
                value={sucursalId ?? ''}
                onChange={(e) => setSucursal(e.target.value || null)}
                className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary max-w-[140px]"
                title="Filtrar por sucursal"
              >
                <option value="">Todas las sucursales</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-shrink-0 flex items-center gap-0.5">
            {/* Tema oscuro/claro */}
            <button onClick={toggleDarkMode} title={darkMode ? 'Modo claro' : 'Modo oscuro'} className={headerBtnCls}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Ayuda — oculto en mobile */}
            <a href="mailto:soporte@genesis360.pro" title="Soporte / Ayuda" className={`hidden sm:inline-flex ${headerBtnCls}`}>
              <LifeBuoy size={18} />
            </a>

            {/* Tour guiado — oculto en mobile */}
            <button onClick={() => setWalkthroughOpen(true)} title="Tour guiado" className={`hidden sm:inline-flex ${headerBtnCls}`}>
              <HelpCircle size={18} />
            </button>

            {/* Cerrar sesión */}
            <button onClick={handleSignOut} title="Cerrar sesión" className={`${headerBtnCls} hover:!text-red-500 hover:!bg-red-50 dark:hover:!bg-red-900/20`}>
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Trial banner */}
        {showTrialBanner && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
            <p className="text-amber-800 dark:text-amber-400 text-sm">
              <span className="font-semibold">Período de prueba:</span>{' '}
              {trialDaysLeft === 0
                ? 'Vence hoy'
                : `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restante${trialDaysLeft !== 1 ? 's' : ''}`}
            </p>
            <NavLink
              to="/suscripcion"
              className="flex items-center gap-1 text-amber-700 dark:text-amber-400 text-sm font-medium hover:text-amber-900"
            >
              Activar plan <ChevronRight size={14} />
            </NavLink>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 dark:bg-gray-950">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
