import { BRAND, APP_VERSION } from '@/config/brand'
import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Package, Boxes, Bell,
  BarChart2, Users, Briefcase, Shield, Settings, Menu, X,
  ChevronRight, ChevronLeft, ShoppingCart, DollarSign, TrendingDown,
  ClipboardList, Moon, Sun, Lock, Building2, Truck, FolderOpen, Warehouse, Send, Receipt, Landmark,
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
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout'
import { NotificacionesButton } from '@/components/NotificacionesButton'
import { AiAssistant } from '@/components/AiAssistant'
import { AyudaModal } from '@/components/AyudaModal'
import { RefreshButton } from '@/components/RefreshButton'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { ConfigButton } from '@/components/ConfigButton'

// ─── Orden según DS Sprint 2 ──────────────────────────────────────────────────
const navItems = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard',      modulo: 'dashboard',     contadorVisible: true },
  { to: '/ventas',        icon: ShoppingCart,    label: 'Ventas',         modulo: 'ventas',        cajeroVisible: true },
  { to: '/gastos',        icon: TrendingDown,    label: 'Gastos',         modulo: 'gastos',        contadorVisible: true },
  { to: '/caja',          icon: DollarSign,      label: 'Caja',           modulo: 'caja',          cajeroVisible: true },
  { to: '/productos',     icon: Package,         label: 'Productos',      modulo: 'inventario',    depositoVisible: true },
  { to: '/inventario',    icon: Boxes,           label: 'Inventario',     modulo: 'movimientos',   depositoVisible: true },
  { to: '/clientes',      icon: Users,           label: 'Clientes',       modulo: 'clientes',      cajeroVisible: true },
  { to: '/envios',        icon: Send,            label: 'Envíos',         modulo: 'envios',        cajeroVisible: true },
  { to: '/facturacion',   icon: Receipt,         label: 'Facturación',    modulo: 'facturacion',   ownerOnly: true },
  { to: '/proveedores',   icon: Truck,           label: 'Prov./Servicios', modulo: 'proveedores',  ownerOnly: true },
  { to: '/recursos',      icon: Landmark,        label: 'Recursos',       modulo: 'recursos',      ownerOnly: true },
  { to: '/recepciones',   icon: Warehouse,       label: 'Recepciones',    modulo: 'recepciones',   supervisorOnly: true, depositoVisible: true },
  { to: '/biblioteca',    icon: FolderOpen,      label: 'Biblioteca',     modulo: 'biblioteca',    ownerOnly: true },
  { to: '/alertas',       icon: Bell,            label: 'Alertas',        modulo: 'alertas',       badge: true,           depositoVisible: true },
  { to: '/rrhh',          icon: Briefcase,       label: 'RRHH',           modulo: 'rrhh',          ownerOnly: true, planFeature: 'puede_rrhh', rrhhVisible: true },
  { to: '/historial',     icon: ClipboardList,   label: 'Historial',      modulo: 'historial',     supervisorOnly: true, planFeature: 'puede_historial', contadorVisible: true },
  { to: '/reportes',      icon: BarChart2,       label: 'Reportes',       modulo: 'reportes',      planFeature: 'puede_reportes', contadorVisible: true },
  { to: '/sucursales',    icon: Building2,       label: 'Sucursales',     modulo: 'sucursales',    ownerOnly: true },
  { to: '/usuarios',      icon: Shield,          label: 'Usuarios',       modulo: 'usuarios',      ownerOnly: true },
  { to: '/configuracion', icon: Settings,        label: 'Configuración',  modulo: 'configuracion', ownerOnly: true },
]

const PROD_HOSTNAMES = ['app.genesis360.pro', 'genesis360.pro', 'www.genesis360.pro']
const isDevEnv = !PROD_HOSTNAMES.includes(window.location.hostname)

const CAJERO_ALLOWED = ['/ventas', '/caja', '/clientes', '/envios', '/mi-cuenta']
const SUPERVISOR_FORBIDDEN = ['/configuracion', '/usuarios', '/sucursales', '/rrhh']
const CONTADOR_ALLOWED = ['/dashboard', '/gastos', '/reportes', '/historial', '/metricas', '/mi-cuenta', '/suscripcion']
const DEPOSITO_ALLOWED = ['/inventario', '/productos', '/alertas', '/mi-cuenta', '/recepciones']

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen]       = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  const [darkMode, setDarkMode]             = useState(() => localStorage.getItem('dark-mode') === 'true')
  const [ayudaOpen, setAyudaOpen]           = useState(false)

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

  const { user, tenant } = useAuthStore()
  useInactivityTimeout(tenant?.session_timeout_minutes)
  const { count: alertCount } = useAlertas()

  // Notificaciones globales de pagos MP recibidos
  const seenMpLogs = useRef<Set<string>>(new Set())
  // Reset seen logs al cambiar de tenant para evitar contaminación entre cuentas
  useEffect(() => { seenMpLogs.current = new Set() }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    const checkMpPayments = async () => {
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const { data: logs } = await supabase
        .from('ventas_externas_logs')
        .select('id, webhook_external_id, payload_raw, procesado_at')
        .eq('tenant_id', tenant.id)
        .eq('integracion', 'MercadoPago')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10)
      for (const log of logs ?? []) {
        if (seenMpLogs.current.has(log.id)) continue
        seenMpLogs.current.add(log.id)
        const p = (log as any).payload_raw as any
        if (!p?.monto) continue
        const monto = Number(p.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })
        const fecha = new Date((log as any).procesado_at ?? Date.now())
        const hora = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        const dia = fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
        toast.success(`Pago MP confirmado — $${monto}\n${dia} · ${hora} hs`, {
          duration: 8000,
          icon: '💳',
          style: { maxWidth: 320 },
        })
      }
    }
    checkMpPayments()
    const interval = setInterval(checkMpPayments, 30_000)
    return () => clearInterval(interval)
  }, [tenant?.id])
  const { visto } = useWalkthrough()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { limits } = usePlanLimits()

  // Restricciones de rutas por rol
  useEffect(() => {
    if (!user) return
    if (user.rol === 'RRHH' && !pathname.startsWith('/rrhh') && !pathname.startsWith('/mi-cuenta')) {
      navigate('/rrhh', { replace: true })
    } else if (user.rol === 'CAJERO' && !CAJERO_ALLOWED.some(r => pathname.startsWith(r))) {
      navigate('/ventas', { replace: true })
    } else if (user.rol === 'SUPERVISOR' && SUPERVISOR_FORBIDDEN.some(r => pathname.startsWith(r))) {
      navigate('/dashboard', { replace: true })
    } else if (user.rol === 'CONTADOR' && !CONTADOR_ALLOWED.some(r => pathname.startsWith(r))) {
      navigate('/dashboard', { replace: true })
    } else if (user.rol === 'DEPOSITO' && !DEPOSITO_ALLOWED.some(r => pathname.startsWith(r))) {
      navigate('/inventario', { replace: true })
    } else if (user.permisos_custom) {
      const currentItem = navItems.find(item => pathname.startsWith(item.to))
      if (currentItem && user.permisos_custom[currentItem.modulo] === 'no_ver') {
        const firstAllowed = navItems.find(item => user.permisos_custom![item.modulo] !== 'no_ver')
        navigate(firstAllowed?.to ?? '/dashboard', { replace: true })
      }
    }
  }, [pathname, user?.rol, user?.permisos_custom])

  const { sucursalId, sucursales, setSucursal, puedeVerTodas } = useSucursalFilter()

  // Auto-seleccionar la primera sucursal solo si el usuario puede ver todas y nunca configuró una preferencia
  useEffect(() => {
    const saved = localStorage.getItem('sucursal-id')
    if (puedeVerTodas && sucursales.length > 0 && !sucursalId && saved !== '__global__') {
      setSucursal(sucursales[0].id)
    }
  }, [sucursales.length, puedeVerTodas])

  // Abrir walkthrough la primera vez
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
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 8_000,
  })

  const trialDaysLeft = tenant
    ? differenceInDays(new Date(tenant.trial_ends_at), new Date())
    : 0
  const showTrialBanner = tenant?.subscription_status === 'trial' && trialDaysLeft >= 0

  // ─── Sidebar content ────────────────────────────────────────────────────────
  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => {
    const collapsed = !mobile && sidebarCollapsed

    return (
      <div className="flex flex-col h-full">

        {/* Logo + versión + toggle colapsar */}
        <div className={`flex items-center border-b border-border-ds flex-shrink-0 ${collapsed ? 'justify-center px-2 py-4' : 'gap-3 px-4 py-4'}`}>
          <a
            href="https://www.genesis360.pro"
            target="_blank"
            rel="noreferrer"
            title="Ir al sitio de Genesis360"
            className="flex items-center gap-3 flex-1 min-w-0 group"
          >
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-accent/80 transition-colors">
              <Package size={18} className="text-white" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-primary dark:text-white font-bold text-lg tracking-tight leading-tight truncate">
                  {BRAND.name}
                </span>
                <span className="text-muted text-[10px] leading-none">{APP_VERSION}</span>
              </div>
            )}
          </a>
          {!mobile && (
            <button
              onClick={toggleCollapse}
              title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
              className="text-gray-400 hover:text-primary dark:hover:text-white transition-colors ml-auto flex-shrink-0"
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          )}
        </div>

        {/* Navegación */}
        <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-2'}`}>
          {navItems.map(({ to, icon: Icon, label, badge, ownerOnly, supervisorOnly, planFeature, rrhhVisible, cajeroVisible, contadorVisible, depositoVisible, modulo }: any) => {
            if (user?.rol === 'RRHH' && !rrhhVisible) return null
            if (user?.rol === 'CAJERO' && !cajeroVisible) return null
            if (user?.rol === 'CONTADOR' && !contadorVisible) return null
            if (user?.rol === 'DEPOSITO' && !depositoVisible) return null
            if (ownerOnly && user?.rol !== 'DUEÑO' && user?.rol !== 'SUPER_USUARIO' && user?.rol !== 'RRHH') return null
            if (supervisorOnly && user?.rol !== 'DUEÑO' && user?.rol !== 'SUPERVISOR' && user?.rol !== 'SUPER_USUARIO') return null
            if (user?.permisos_custom?.[modulo] === 'no_ver') return null
            const locked = planFeature && limits != null && !(limits as any)[planFeature]
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => setSidebarOpen(false)}
                title={collapsed ? (locked ? `${label} — requiere plan superior` : label) : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-lg text-sm font-medium transition-all
                  ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
                  ${locked
                    ? 'text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-500'
                    : isActive
                      ? 'bg-accent text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-accent/10 hover:text-accent dark:hover:text-accent'
                  }`
                }
              >
                <div className="relative flex-shrink-0">
                  <Icon size={18} />
                  {to === '/caja' && collapsed && (
                    <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-gray-900 ${cajaAbierta ? 'bg-green-400' : 'bg-red-400'}`} />
                  )}
                  {badge && alertCount > 0 && collapsed && (
                    <span
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center border border-white dark:border-gray-900"
                      style={{ fontSize: 9, lineHeight: 1 }}
                    >
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </div>
                {!collapsed && <span className="flex-1">{label}</span>}
                {!collapsed && locked && <Lock size={12} className="text-gray-400 dark:text-gray-600 flex-shrink-0" />}
                {!collapsed && to === '/caja' && !locked && (
                  <span
                    className={`w-2 h-2 rounded-full ${cajaAbierta ? 'bg-green-400' : 'bg-red-400'}`}
                    title={cajaAbierta ? 'Caja abierta' : 'Caja cerrada'}
                  />
                )}
                {!collapsed && badge && alertCount > 0 && !locked && (
                  <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Pie: CotizacionWidget */}
        {!collapsed && (
          <div className="border-t border-border-ds flex-shrink-0">
            <CotizacionWidget />
          </div>
        )}

      </div>
    )
  }

  // Clase base para botones del header
  const hBtn = 'p-2 rounded-lg text-muted hover:text-primary dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-all'

  return (
    <div className={`flex bg-page overflow-hidden ${isDevEnv ? 'h-[calc(100vh-1rem)] mt-4' : 'h-screen'}`}>
      <Walkthrough open={walkthroughOpen} onClose={() => setWalkthroughOpen(false)} />
      <AyudaModal isOpen={ayudaOpen} onClose={() => setAyudaOpen(false)} currentModule={pathname} />

      {/* Sidebar desktop */}
      <aside className={`hidden lg:flex flex-col bg-surface border-r border-border-ds flex-shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
        <SidebarContent />
      </aside>

      {/* Sidebar mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-surface border-r border-border-ds z-50">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 text-muted hover:text-primary dark:hover:text-white"
            >
              <X size={20} />
            </button>
            <SidebarContent mobile />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header universal */}
        <header className="flex items-center gap-2 px-4 py-2.5 bg-surface border-b border-border-ds flex-shrink-0">

          {/* Hamburger (mobile) */}
          <button onClick={() => setSidebarOpen(true)} className={`lg:hidden ${hBtn}`}>
            <Menu size={22} />
          </button>

          <div className="flex-1" />

          {/* Derecha: selector sucursal + acciones */}
          <div className="flex items-center gap-0.5">

            {/* Sucursal — siempre visible. Dueño puede cambiarla solo en rutas operativas */}
            {sucursales.length > 0 && (() => {
              const RUTAS_CON_SELECTOR = ['/inventario', '/productos', '/clientes', '/proveedores', '/configuracion']
              const conSelector = puedeVerTodas && RUTAS_CON_SELECTOR.some(r => pathname.startsWith(r))
              const nombreSucursal = sucursalId
                ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? '—')
                : null
              return (
                <div className="hidden sm:flex items-center gap-1.5 mr-1">
                  <Building2 size={14} className="text-muted flex-shrink-0" />
                  {conSelector ? (
                    <select
                      value={sucursalId ?? ''}
                      onChange={e => setSucursal(e.target.value || null)}
                      className="text-xs border border-border-ds rounded-lg px-2 py-1 bg-surface text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-accent max-w-[140px]"
                      title="Filtrar por sucursal"
                    >
                      <option value="">Todas las sucursales</option>
                      {sucursales.map(s => (
                        <option key={s.id} value={s.id}>{s.nombre}</option>
                      ))}
                    </select>
                  ) : nombreSucursal ? (
                    <span className="text-xs font-medium text-primary dark:text-white truncate max-w-[140px]">
                      {nombreSucursal}
                    </span>
                  ) : puedeVerTodas ? (
                    <span className="text-xs font-medium text-muted truncate max-w-[140px]">Todas las suc.</span>
                  ) : (
                    <span className="text-xs text-orange-500 font-medium">Sin sucursal</span>
                  )}
                </div>
              )
            })()}

            {/* Refresh */}
            <RefreshButton className={hBtn} />

            {/* Notificaciones */}
            <AiAssistant className={hBtn} />
            <NotificacionesButton className={hBtn} />

            {/* Dark / Light */}
            <button
              onClick={toggleDarkMode}
              title={darkMode ? 'Modo claro' : 'Modo oscuro'}
              className={hBtn}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Ayuda */}
            <button
              onClick={() => setAyudaOpen(v => !v)}
              title="Centro de Ayuda"
              className={hBtn}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </button>

            {/* Config */}
            {(user?.rol === 'DUEÑO' || user?.rol === 'SUPER_USUARIO') && (
              <ConfigButton className={hBtn} />
            )}

            {/* Avatar + dropdown */}
            <AvatarDropdown className={hBtn} />

          </div>
        </header>

        {/* Banner trial */}
        {showTrialBanner && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
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

        {/* Contenido */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-page">
          <Outlet />
        </main>

      </div>
    </div>
  )
}
