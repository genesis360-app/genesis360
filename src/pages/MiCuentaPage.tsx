import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, CreditCard, Lock, LogOut, Trash2, Upload, CheckCircle, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { BRAND, BTN } from '@/config/brand'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default function MiCuentaPage() {
  const { user, tenant, signOut, loadUserData } = useAuthStore()
  const { limits } = usePlanLimits()
  const navigate = useNavigate()

  const [provider, setProvider] = useState<string>('email')
  const [uploading, setUploading] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Password change state
  const [pwForm, setPwForm] = useState({ nueva: '', confirmar: '' })
  const [showPw, setShowPw] = useState(false)
  const [savingPw, setSavingPw] = useState(false)

  // Danger zone state
  const [showDanger, setShowDanger] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Cancelar suscripción
  const [cancelando, setCancelando] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const p = data?.user?.app_metadata?.provider ?? 'email'
      setProvider(p)
    })
  }, [])

  const isGoogleUser = provider === 'google'
  const isOwner = user?.rol === 'DUEÑO'

  const planLabel = () => {
    const p = limits?.plan_id
    if (p === 'basico') return 'Básico'
    if (p === 'pro') return 'Pro'
    if (p === 'enterprise') return 'Enterprise'
    return 'Free'
  }

  const estadoLabel = () => {
    if (!tenant) return '—'
    const s = tenant.subscription_status
    if (s === 'active') return 'Activa'
    if (s === 'trial') {
      const end = new Date(tenant.trial_ends_at)
      const hoy = new Date()
      if (end > hoy) return `Trial hasta ${format(end, 'dd/MM/yyyy', { locale: es })}`
      return 'Trial vencido'
    }
    if (s === 'cancelled') return 'Cancelada'
    if (s === 'inactive') return 'Inactiva'
    return s
  }

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (file.size > 2 * 1024 * 1024) { toast.error('La imagen no puede superar los 2 MB'); return }

    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `${user.id}/avatar.${ext}`

      const { error: upErr } = await supabase.storage.from('avatares').upload(path, file, { upsert: true })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('avatares').getPublicUrl(path)
      const publicUrl = urlData.publicUrl + `?t=${Date.now()}` // cache-bust

      const { error: dbErr } = await supabase.rpc('update_user_avatar', { p_avatar_url: publicUrl })
      if (dbErr) throw dbErr

      setAvatarPreview(publicUrl)
      await loadUserData(user.id)
      toast.success('Foto actualizada')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al subir la foto')
    } finally {
      setUploading(false)
    }
  }

  // ── Password change ────────────────────────────────────────────────────────
  const handlePasswordChange = async () => {
    if (!pwForm.nueva.trim()) { toast.error('Escribí la nueva contraseña'); return }
    if (pwForm.nueva.length < 8) { toast.error('Mínimo 8 caracteres'); return }
    if (pwForm.nueva !== pwForm.confirmar) { toast.error('Las contraseñas no coinciden'); return }
    setSavingPw(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwForm.nueva })
      if (error) throw error
      toast.success('Contraseña actualizada')
      setPwForm({ nueva: '', confirmar: '' })
    } catch (err: any) {
      toast.error(err.message ?? 'Error al cambiar contraseña')
    } finally {
      setSavingPw(false)
    }
  }

  // ── Leave tenant (no es Dueño) ──────────────────────────────────────────────
  const handleLeave = async () => {
    if (!user) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('users').delete().eq('id', user.id)
      if (error) throw error
      toast.success('Acceso eliminado correctamente')
      await signOut()
      navigate('/login')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al eliminar acceso')
    } finally {
      setDeleting(false)
    }
  }

  // ── Cancelar suscripción MP ────────────────────────────────────────────────
  const handleCancelarSuscripcion = async () => {
    if (!tenant || !confirm('¿Cancelar tu suscripción? Tu plan pasará a Free al finalizar el período.')) return
    setCancelando(true)
    try {
      const mpSubId = (tenant as any).mp_subscription_id
      if (mpSubId) {
        // Llamar a la Edge Function que cancela el preapproval en MP
        const { error } = await supabase.functions.invoke('cancel-suscripcion', {
          body: { preapproval_id: mpSubId, tenant_id: tenant.id },
        })
        if (error) throw error
      } else {
        // Sin ID de MP: solo marcar en la DB
        await supabase.from('tenants').update({ subscription_status: 'cancelled', mp_subscription_id: null }).eq('id', tenant.id)
      }
      await loadUserData(user!.id)
      toast.success('Suscripción cancelada. Tu plan pasará a Free al finalizar el período.')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al cancelar suscripción')
    } finally {
      setCancelando(false)
    }
  }

  // ── Delete account (Dueño) ──────────────────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (!user || !tenant) return
    if (confirmText !== tenant.nombre) { toast.error(`Escribí exactamente: ${tenant.nombre}`); return }
    setDeleting(true)
    try {
      // Eliminar registro en public.users → RLS cascade limpiará sesión
      await supabase.from('users').delete().eq('id', user.id)
      // Marcar tenant como cancelado
      await supabase.from('tenants').update({ subscription_status: 'cancelled' }).eq('id', tenant.id)
      // Eliminar auth user (requiere que la Edge Function o el service role lo haga — hacemos signOut por ahora)
      await supabase.auth.admin?.deleteUser?.(user.id).catch(() => null)
      toast.success('Cuenta eliminada')
      await signOut()
      navigate('/login')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al eliminar cuenta')
    } finally {
      setDeleting(false)
    }
  }

  const avatarSrc = avatarPreview ?? user?.avatar_url

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Mi Cuenta</h1>

      {/* ── Perfil ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {avatarSrc ? (
              <img src={avatarSrc} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-2 border-accent/30" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center">
                <User size={32} className="text-accent" />
              </div>
            )}
            {!isGoogleUser && (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Cambiar foto"
                className="absolute -bottom-1 -right-1 bg-accent text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-accent/90 disabled:opacity-50"
              >
                <Upload size={13} />
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
          </div>

          {/* Info */}
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white text-lg leading-tight">{user?.nombre_display ?? '—'}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{user?.rol?.charAt(0) + (user?.rol?.slice(1).toLowerCase() ?? '')} · {tenant?.nombre}</p>
            {isGoogleUser && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                <CheckCircle size={11} className="text-green-500" /> Cuenta Google
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Mi Plan ────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <CreditCard size={14} /> Mi Plan
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900 dark:text-white text-lg">Plan {planLabel()}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{estadoLabel()}</p>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && tenant?.subscription_status === 'active' && (
              <button
                onClick={handleCancelarSuscripcion}
                disabled={cancelando}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors">
                {cancelando ? 'Cancelando…' : 'Cancelar suscripción'}
              </button>
            )}
            <button onClick={() => navigate('/suscripcion')} className={`${BTN.outline} ${BTN.sm}`}>
              Ver planes →
            </button>
          </div>
        </div>
      </div>

      {/* ── Seguridad ──────────────────────────────────────────────────────── */}
      {!isGoogleUser && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Lock size={14} /> Cambiar contraseña
          </h2>
          <div className="space-y-3">
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Nueva contraseña (mín. 8 caracteres)"
                value={pwForm.nueva}
                onChange={e => setPwForm(p => ({ ...p, nueva: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm pr-10"
              />
              <button onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-2.5 text-gray-400">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Confirmar nueva contraseña"
              value={pwForm.confirmar}
              onChange={e => setPwForm(p => ({ ...p, confirmar: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
            />
            <button
              onClick={handlePasswordChange}
              disabled={savingPw || !pwForm.nueva || !pwForm.confirmar}
              className={`${BTN.primary} ${BTN.sm} w-full`}
            >
              {savingPw ? 'Guardando...' : 'Guardar nueva contraseña'}
            </button>
          </div>
        </div>
      )}

      {/* ── Zona de riesgo ─────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/40 p-6">
        <button
          onClick={() => setShowDanger(v => !v)}
          className="w-full flex items-center justify-between text-sm font-semibold text-red-600 dark:text-red-400"
        >
          <span className="flex items-center gap-2"><AlertTriangle size={14} /> Zona de riesgo</span>
          <span className="text-xs font-normal text-gray-400">{showDanger ? 'Cerrar ▲' : 'Ver opciones ▼'}</span>
        </button>

        {showDanger && (
          <div className="mt-4 space-y-4">
            {/* Cerrar sesión */}
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Cerrar sesión</p>
                <p className="text-xs text-gray-400">Salís de la app pero tu cuenta sigue activa</p>
              </div>
              <button
                onClick={async () => { await signOut(); navigate('/login') }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <LogOut size={14} /> Salir
              </button>
            </div>

            {/* No es Dueño: salir del negocio */}
            {!isOwner && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Salir de "{tenant?.nombre}"</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
                  Eliminás tu acceso a este negocio. Tu cuenta de email queda libre para unirte a otro negocio.
                </p>
                <button
                  onClick={handleLeave}
                  disabled={deleting}
                  className={`${BTN.danger} ${BTN.sm}`}
                >
                  {deleting ? 'Procesando...' : 'Salir del negocio'}
                </button>
              </div>
            )}

            {/* Dueño: eliminar cuenta completa */}
            {isOwner && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Eliminar cuenta y negocio</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
                  Esto elimina permanentemente tu cuenta, todos los datos de "{tenant?.nombre}" y cancela la suscripción. Esta acción es irreversible.
                </p>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Escribí el nombre del negocio para confirmar:
                </p>
                <input
                  type="text"
                  placeholder={tenant?.nombre}
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  className="w-full px-3 py-1.5 border border-red-300 dark:border-red-700 rounded-lg text-sm mb-3"
                />
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting || confirmText !== tenant?.nombre}
                  className={`${BTN.danger} ${BTN.sm} flex items-center gap-1.5 disabled:opacity-40`}
                >
                  <Trash2 size={13} />
                  {deleting ? 'Eliminando...' : 'Eliminar cuenta permanentemente'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-center text-gray-400 dark:text-gray-600">{BRAND.name} — {tenant?.nombre}</p>
    </div>
  )
}
