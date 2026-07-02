import { BRAND, LEGAL_VERSION } from '@/config/brand'
import { TIPOS_COMERCIO } from '@/config/tiposComercio'
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Package, Building2, Globe, Phone, Mail, Lock, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

const PAISES = [
  { code: 'AR', label: 'Argentina' },
  { code: 'CL', label: 'Chile' },
  { code: 'UY', label: 'Uruguay' },
  { code: 'MX', label: 'México' },
  { code: 'CO', label: 'Colombia' },
  { code: 'PE', label: 'Perú' },
]

export default function OnboardingPage() {
  const [step, setStep] = useState<'account' | 'business'>('account')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { loadUserData } = useAuthStore()

  const [accountData, setAccountData] = useState({ email: '', password: '', name: '' })
  const [bizData, setBizData] = useState({
    nombre: '', tipo_comercio: '', pais: 'AR', telefono: '',
  })
  const [tipoPersonalizado, setTipoPersonalizado] = useState('')
  // Consentimiento en el alta: T&C + Privacidad (REQUERIDO) y marketing (OPCIONAL, opt-in separado).
  const [aceptaTerminos, setAceptaTerminos] = useState(false)
  const [aceptaMarketing, setAceptaMarketing] = useState(false)
  // "Confirm email" ON: tras signUp NO hay sesión → se muestra "revisá tu email" y el negocio
  // se crea al confirmar (el useEffect detecta la sesión + el metadata del alta).
  const [emailEnviado, setEmailEnviado] = useState(false)
  const [emailPendiente, setEmailPendiente] = useState('')

  // Crea el tenant + el usuario DUEÑO. REQUIERE sesión activa (la RLS de tenants exige auth.uid()).
  // `marketingConsent` = opt-in separado y opcional (Ley 25.326); el T&C se acepta siempre (gateado
  // en el submit) → se asienta `terminos_aceptados_at` + la versión legal vigente.
  const provisionNegocio = async (userId: string, email: string, displayName: string, nombre: string, tipo: string, pais: string, marketingConsent: boolean) => {
    const tenantId = crypto.randomUUID()  // UUID en cliente: evita el SELECT post-insert (RLS)
    const { error: tenantError } = await supabase.from('tenants').insert({
      id: tenantId, nombre, tipo_comercio: tipo, pais,
      subscription_status: 'trial', max_users: 2,
      regla_inventario: 'Manual', session_timeout_minutes: null,
      terminos_aceptados_at: new Date().toISOString(),
      terminos_version: LEGAL_VERSION,
      marketing_consent: marketingConsent,
    })
    if (tenantError) throw tenantError
    const { error: userError } = await supabase.from('users').insert({
      id: userId, tenant_id: tenantId, rol: 'DUEÑO', nombre_display: displayName, activo: true,
    })
    if (userError) { await supabase.from('tenants').delete().eq('id', tenantId); throw userError }
    supabase.functions.invoke('send-email', {
      body: { type: 'welcome', to: email, data: { nombre: displayName, negocio: nombre } },
    }).catch(() => {/* el email de bienvenida no es bloqueante */})
  }

  // Si el usuario ya tiene sesión (Google OAuth, o volvió de confirmar su email), continuar el alta
  const [existingAuthUser, setExistingAuthUser] = useState<{ id: string; email: string; name: string } | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return
      const u = session.user
      // Si ya tiene tenant registrado, ir directo al dashboard (evita duplicados)
      const { data: existingUser } = await supabase
        .from('users').select('tenant_id').eq('id', u.id).maybeSingle()
      if (existingUser?.tenant_id) { await loadUserData(u.id); navigate('/dashboard'); return }
      // Volvió de confirmar un signup email/password: los datos del negocio viajaron en el
      // metadata → crear el tenant AHORA (ya hay sesión) sin re-pedir el formulario.
      const md = (u.user_metadata ?? {}) as Record<string, any>
      if (md.ob_nombre && md.ob_pais) {
        try {
          setLoading(true)
          // El consentimiento se capturó al hacer signUp y viajó en el metadata (T&C requerido → siempre
          // aceptado; marketing = opt-in que puede venir true/false).
          await provisionNegocio(u.id, u.email ?? '', md.full_name ?? md.name ?? (u.email ?? ''), md.ob_nombre, md.ob_tipo ?? '', md.ob_pais, md.ob_marketing === true)
          await loadUserData(u.id)
          navigate('/dashboard')
          return
        } catch (e: unknown) {
          toast.error(e instanceof Error ? e.message : 'No se pudo crear el negocio')
          // fallback: mostrar el paso de negocio para reintentar manualmente
        } finally { setLoading(false) }
      }
      setExistingAuthUser({
        id: u.id, email: u.email ?? '',
        name: md.full_name ?? md.name ?? '',
      })
      setStep('business')
    })
  }, [])

  const handleAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (accountData.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setStep('business')
  }

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!aceptaTerminos) {
      toast.error('Para crear tu negocio tenés que aceptar los Términos y Condiciones y la Política de Privacidad')
      return
    }
    setLoading(true)

    try {
      const tipoFinal = bizData.tipo_comercio === 'Otro' && tipoPersonalizado.trim()
        ? tipoPersonalizado.trim()
        : bizData.tipo_comercio
      let provisionedUserId: string | null = null

      if (existingAuthUser) {
        // Ya tiene sesión (Google OAuth, o volvió de confirmar) → crear el negocio ahora
        await provisionNegocio(existingAuthUser.id, existingAuthUser.email, existingAuthUser.name || existingAuthUser.email, bizData.nombre, tipoFinal, bizData.pais, aceptaMarketing)
        provisionedUserId = existingAuthUser.id
      } else {
        // Registro email/password. Los datos del negocio viajan en el metadata para poder crear
        // el tenant al confirmar (la RLS de tenants exige sesión; signUp con "Confirm email" ON
        // no devuelve sesión). emailRedirectTo trae al usuario de vuelta a /onboarding.
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: accountData.email,
          password: accountData.password,
          options: {
            // El consentimiento viaja en el metadata: al confirmar el email todavía no hay sesión,
            // el tenant se crea después en el useEffect y necesita saber qué se aceptó. `ob_terminos`
            // siempre true (gateado arriba); `ob_marketing` = opt-in.
            data: { full_name: accountData.name, ob_nombre: bizData.nombre, ob_tipo: tipoFinal, ob_pais: bizData.pais, ob_terminos: true, ob_marketing: aceptaMarketing },
            emailRedirectTo: `${window.location.origin}/onboarding`,
          },
        })
        if (authError) throw authError
        if (!authData.user) throw new Error('No se pudo crear el usuario')

        if (!authData.session) {
          // "Confirm email" ON → todavía no hay sesión: el negocio se crea cuando confirme
          // (el useEffect lo detecta y provisiona desde el metadata). Mostrar el aviso.
          setEmailPendiente(accountData.email)
          setEmailEnviado(true)
          return
        }
        // "Confirm email" OFF → signUp ya devolvió sesión → crear el negocio ahora
        await provisionNegocio(authData.user.id, accountData.email, accountData.name, bizData.nombre, tipoFinal, bizData.pais, aceptaMarketing)
        provisionedUserId = authData.user.id
      }

      toast.success('¡Negocio creado! Bienvenido.')
      if (provisionedUserId) await loadUserData(provisionedUserId)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message ?? 'Error al registrar'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // "Confirm email" ON: cuenta creada, falta confirmar → el negocio se crea solo al confirmar.
  if (emailEnviado) {
    return (
      <div className="min-h-screen bg-brand-gradient-dark flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
              <img src={BRAND.logo} alt={BRAND.name} className="w-20 h-20 object-contain drop-shadow-lg" />
            </div>
            <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center space-y-3">
            <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto">
              <Mail size={26} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Revisá tu email</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Te enviamos un link de confirmación a <strong className="text-gray-700 dark:text-gray-200">{emailPendiente}</strong>. Confirmá tu cuenta desde ese email y <strong>tu negocio queda creado automáticamente</strong>.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">¿No te llegó? Revisá spam o esperá un minuto.</p>
            <Link to="/login" className="inline-block text-sm font-medium text-accent hover:underline mt-2">Ir a Ingresar</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-gradient-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
            <img src={BRAND.logo} alt={BRAND.name} className="w-20 h-20 object-contain drop-shadow-lg" />
          </div>
          <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
          <p className="text-blue-200 mt-1">Registrá tu negocio — 7 días gratis</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          {/* Steps */}
          <div className="flex items-center gap-2 mb-6">
            {['Cuenta', 'Negocio'].map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${(i === 0 && step === 'account') || (i === 1 && step === 'business')
                    ? 'bg-primary text-white'
                    : i === 0 && step === 'business'
                    ? 'bg-green-50 dark:bg-green-900/200 text-white'
                    : 'bg-gray-200 text-gray-400 dark:text-gray-500'}`}>
                  {i + 1}
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400">{s}</span>
                {i < 1 && <div className="flex-1 h-px bg-gray-200" />}
              </div>
            ))}
          </div>

          {step === 'account' ? (
            <form onSubmit={handleAccountSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Tu cuenta</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre completo</label>
                <input
                  type="text" required value={accountData.name}
                  onChange={e => setAccountData(p => ({ ...p, name: e.target.value }))}
                  placeholder="Juan García"
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input
                    type="email" required value={accountData.email}
                    onChange={e => setAccountData(p => ({ ...p, email: e.target.value }))}
                    placeholder="tu@email.com"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input
                    type="password" required minLength={8} value={accountData.password}
                    onChange={e => setAccountData(p => ({ ...p, password: e.target.value }))}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>

              <button type="submit" className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all">
                Continuar
              </button>
            </form>
          ) : (
            <form onSubmit={handleFinalSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Tu negocio</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre del negocio</label>
                <div className="relative">
                  <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input
                    type="text" required value={bizData.nombre}
                    onChange={e => setBizData(p => ({ ...p, nombre: e.target.value }))}
                    placeholder="Mi Ferretería"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de comercio</label>
                <select
                  required value={bizData.tipo_comercio}
                  onChange={e => setBizData(p => ({ ...p, tipo_comercio: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">Seleccioná...</option>
                  {TIPOS_COMERCIO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {bizData.tipo_comercio === 'Otro' && (
                  <input
                    type="text" value={tipoPersonalizado}
                    onChange={e => setTipoPersonalizado(e.target.value)}
                    placeholder="Describí tu tipo de comercio"
                    className="mt-2 w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">País</label>
                <div className="relative">
                  <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <select
                    value={bizData.pais}
                    onChange={e => setBizData(p => ({ ...p, pais: e.target.value }))}
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent"
                  >
                    {PAISES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teléfono (opcional)</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input
                    type="tel" value={bizData.telefono}
                    onChange={e => setBizData(p => ({ ...p, telefono: e.target.value }))}
                    placeholder="+54 11 1234-5678"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Consentimiento: T&C requerido + marketing opt-in opcional (Ley 25.326) */}
              <div className="space-y-3 pt-1">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox" checked={aceptaTerminos}
                    onChange={e => setAceptaTerminos(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-accent focus:ring-accent/40"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
                    Acepto los{' '}
                    <a href="/terminos" target="_blank" rel="noopener noreferrer" className="text-accent font-medium hover:underline">Términos y Condiciones</a>
                    {' '}y la{' '}
                    <a href="/privacidad" target="_blank" rel="noopener noreferrer" className="text-accent font-medium hover:underline">Política de Privacidad</a>.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox" checked={aceptaMarketing}
                    onChange={e => setAceptaMarketing(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-accent focus:ring-accent/40"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
                    Quiero recibir novedades, promociones y consejos por email <span className="text-gray-400 dark:text-gray-500">(opcional)</span>.
                  </span>
                </label>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep('account')}
                  className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-3 rounded-xl hover:border-gray-300 dark:border-gray-600 transition-all">
                  Atrás
                </button>
                <button type="submit" disabled={loading || !aceptaTerminos}
                  className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                  {loading ? 'Registrando...' : 'Crear negocio'}
                </button>
              </div>
            </form>
          )}

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
            ¿Ya tenés cuenta?{' '}
            <Link to="/login" className="text-accent font-medium hover:underline">Iniciá sesión</Link>
          </p>

          {/* Escape: si hay sesión activa pero quedó atrapado en onboarding */}
          {existingAuthUser && (
            <div className="mt-3 text-center">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                Sesión activa: {existingAuthUser.email}
              </p>
              <button
                onClick={async () => {
                  await supabase.auth.signOut()
                  window.location.href = '/login'
                }}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors underline underline-offset-2"
              >
                <LogOut size={12} /> Cerrar sesión y volver al login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
