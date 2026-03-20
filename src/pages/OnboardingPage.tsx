import { BRAND } from '@/config/brand'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Package, Building2, Globe, Phone, Mail, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

const TIPOS_COMERCIO = [
  'Ferretería', 'Kiosco', 'Despensa', 'Mini-mercado',
  'Farmacia', 'Librería', 'Almacén', 'Otro',
]

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

  // Si el usuario ya tiene sesión (ej: vino de Google OAuth), saltear paso de cuenta
  const [existingAuthUser, setExistingAuthUser] = useState<{ id: string; email: string; name: string } | null>(null)
  useState(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const u = session.user
        setExistingAuthUser({
          id: u.id,
          email: u.email ?? '',
          name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? '',
        })
        setStep('business')
      }
    })
  })

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
    setLoading(true)

    try {
      let userId: string
      let displayName: string

      if (existingAuthUser) {
        // Vino de Google OAuth — ya tiene sesión, no crear nuevo auth user
        userId = existingAuthUser.id
        displayName = existingAuthUser.name || existingAuthUser.email
      } else {
        // Registro normal con email/password
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: accountData.email,
          password: accountData.password,
          options: { data: { full_name: accountData.name } },
        })
        if (authError) throw authError
        if (!authData.user) throw new Error('No se pudo crear el usuario')
        userId = authData.user.id
        displayName = accountData.name
      }

      // 2. Crear tenant (UUID generado en cliente para evitar problema de RLS en SELECT post-insert)
      const tenantId = crypto.randomUUID()
      const { error: tenantError } = await supabase
        .from('tenants')
        .insert({
          id: tenantId,
          nombre: bizData.nombre,
          tipo_comercio: bizData.tipo_comercio,
          pais: bizData.pais,
          subscription_status: 'trial',
          max_users: 2,
        })
      if (tenantError) throw tenantError

      // 3. Crear perfil de usuario con rol OWNER
      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: userId,
          tenant_id: tenantId,
          rol: 'OWNER',
          nombre_display: displayName,
          activo: true,
        })
      if (userError) throw userError

      // Email de bienvenida (fire-and-forget, no bloquea el flujo)
      const emailTo = existingAuthUser ? existingAuthUser.email : accountData.email
      const emailNombre = existingAuthUser ? (existingAuthUser.name || existingAuthUser.email) : accountData.name
      supabase.functions.invoke('send-email', {
        body: { type: 'welcome', to: emailTo, data: { nombre: emailNombre, negocio: bizData.nombre } },
      }).catch(() => {/* silencioso — el email no es bloqueante */})

      if (existingAuthUser) {
        toast.success('¡Negocio creado! Bienvenido.')
        await loadUserData(existingAuthUser.id)
        navigate('/dashboard')
      } else {
        toast.success('¡Negocio registrado! Revisá tu email para confirmar tu cuenta.')
        navigate('/login')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1E3A5F] to-[#2E75B6] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <Package size={32} className="text-[#1E3A5F]" />
          </div>
          <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
          <p className="text-blue-200 mt-1">Registrá tu negocio — 7 días gratis</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Steps */}
          <div className="flex items-center gap-2 mb-6">
            {['Cuenta', 'Negocio'].map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${(i === 0 && step === 'account') || (i === 1 && step === 'business')
                    ? 'bg-[#1E3A5F] text-white'
                    : i === 0 && step === 'business'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-400'}`}>
                  {i + 1}
                </div>
                <span className="text-sm text-gray-600">{s}</span>
                {i < 1 && <div className="flex-1 h-px bg-gray-200" />}
              </div>
            ))}
          </div>

          {step === 'account' ? (
            <form onSubmit={handleAccountSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Tu cuenta</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo</label>
                <input
                  type="text" required value={accountData.name}
                  onChange={e => setAccountData(p => ({ ...p, name: e.target.value }))}
                  placeholder="Juan García"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] focus:ring-2 focus:ring-[#2E75B6]/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email" required value={accountData.email}
                    onChange={e => setAccountData(p => ({ ...p, email: e.target.value }))}
                    placeholder="tu@email.com"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] focus:ring-2 focus:ring-[#2E75B6]/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password" required minLength={8} value={accountData.password}
                    onChange={e => setAccountData(p => ({ ...p, password: e.target.value }))}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] focus:ring-2 focus:ring-[#2E75B6]/20"
                  />
                </div>
              </div>

              <button type="submit" className="w-full bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-semibold py-3 rounded-xl transition-all">
                Continuar
              </button>
            </form>
          ) : (
            <form onSubmit={handleFinalSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Tu negocio</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del negocio</label>
                <div className="relative">
                  <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text" required value={bizData.nombre}
                    onChange={e => setBizData(p => ({ ...p, nombre: e.target.value }))}
                    placeholder="Mi Ferretería"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] focus:ring-2 focus:ring-[#2E75B6]/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de comercio</label>
                <select
                  required value={bizData.tipo_comercio}
                  onChange={e => setBizData(p => ({ ...p, tipo_comercio: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]"
                >
                  <option value="">Seleccioná...</option>
                  {TIPOS_COMERCIO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">País</label>
                <div className="relative">
                  <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select
                    value={bizData.pais}
                    onChange={e => setBizData(p => ({ ...p, pais: e.target.value }))}
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]"
                  >
                    {PAISES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono (opcional)</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel" value={bizData.telefono}
                    onChange={e => setBizData(p => ({ ...p, telefono: e.target.value }))}
                    placeholder="+54 11 1234-5678"
                    className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep('account')}
                  className="flex-1 border-2 border-gray-200 text-gray-600 font-semibold py-3 rounded-xl hover:border-gray-300 transition-all">
                  Atrás
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-60">
                  {loading ? 'Registrando...' : 'Crear negocio'}
                </button>
              </div>
            </form>
          )}

          <p className="text-center text-sm text-gray-500 mt-4">
            ¿Ya tenés cuenta?{' '}
            <Link to="/login" className="text-[#2E75B6] font-medium hover:underline">Iniciá sesión</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
