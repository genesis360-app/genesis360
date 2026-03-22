import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { AuthGuard, SubscriptionGuard } from '@/components/AuthGuard'
import { AppLayout } from '@/components/layout/AppLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// Lazy loading de módulos
const LoginPage        = lazy(() => import('@/pages/LoginPage'))
const LandingPage      = lazy(() => import('@/pages/LandingPage'))
const OnboardingPage   = lazy(() => import('@/pages/OnboardingPage'))
const DashboardPage    = lazy(() => import('@/pages/DashboardPage'))
const InventarioPage   = lazy(() => import('@/pages/InventarioPage'))
const ProductoFormPage = lazy(() => import('@/pages/ProductoFormPage'))
const ImportarProductosPage = lazy(() => import('@/pages/ImportarProductosPage'))
const GruposEstadosPage    = lazy(() => import('@/pages/GruposEstadosPage'))
const CajaPage             = lazy(() => import('@/pages/CajaPage'))
const MetricasPage         = lazy(() => import('@/pages/MetricasPage'))
const MovimientosPage  = lazy(() => import('@/pages/MovimientosPage'))
const VentasPage       = lazy(() => import('@/pages/VentasPage'))
const AlertasPage      = lazy(() => import('@/pages/AlertasPage'))
const ReportesPage     = lazy(() => import('@/pages/ReportesPage'))
const UsuariosPage     = lazy(() => import('@/pages/UsuariosPage'))
const ConfigPage       = lazy(() => import('@/pages/ConfigPage'))
const SuscripcionPage  = lazy(() => import('@/pages/SuscripcionPage'))
const AdminPage        = lazy(() => import('@/pages/AdminPage'))
const ClientesPage        = lazy(() => import('@/pages/ClientesPage'))
const RentabilidadPage    = lazy(() => import('@/pages/RentabilidadPage'))
const RecomendacionesPage = lazy(() => import('@/pages/RecomendacionesPage'))
const GastosPage          = lazy(() => import('@/pages/GastosPage'))
const HistorialPage       = lazy(() => import('@/pages/HistorialPage'))
const ImportarMasterPage  = lazy(() => import('@/pages/ImportarMasterPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
})

function App() {
  const { loadUserData, setUser, initialized } = useAuthStore()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadUserData(session.user.id)
      } else {
        useAuthStore.setState({ loading: false, initialized: true })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUserData(session.user.id)
      } else {
        setUser(null)
        useAuthStore.setState({ tenant: null })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!initialized) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={
          <div className="min-h-screen bg-brand-bg flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        }>
          <Routes>
            {/* Rutas públicas */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/suscripcion" element={<SuscripcionPage />} />

            {/* Rutas protegidas */}
            <Route element={<AuthGuard />}>
              <Route element={<SubscriptionGuard />}>
                <Route element={<AppLayout />}>
                  <Route path="/app" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/inventario" element={<InventarioPage />} />
                  <Route path="/inventario/nuevo" element={<ProductoFormPage />} />
                  <Route path="/inventario/importar" element={<ImportarProductosPage />} />
                  <Route path="/inventario/:id/editar" element={<ProductoFormPage />} />
                  <Route path="/movimientos" element={<MovimientosPage />} />
                  <Route path="/ventas" element={<VentasPage />} />
                  <Route path="/alertas" element={<AlertasPage />} />
                  <Route path="/reportes" element={<ReportesPage />} />
                  <Route path="/usuarios" element={<UsuariosPage />} />
                  <Route path="/configuracion" element={<ConfigPage />} />
                  <Route path="/grupos-estados" element={<GruposEstadosPage />} />
                  <Route path="/caja" element={<CajaPage />} />
                  <Route path="/metricas" element={<MetricasPage />} />
                  <Route path="/clientes" element={<ClientesPage />} />
                  <Route path="/rentabilidad" element={<RentabilidadPage />} />
                  <Route path="/recomendaciones" element={<RecomendacionesPage />} />
                  <Route path="/gastos" element={<GastosPage />} />
                  <Route path="/historial" element={<HistorialPage />} />
                  <Route path="/configuracion/importar" element={<ImportarMasterPage />} />
                </Route>
              </Route>
            </Route>

            {/* Admin */}
            <Route element={<AuthGuard requireRole="ADMIN" />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-right" />
    </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
