import { LogOut, User, ChevronDown, Check, UserPlus } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'

interface AvatarDropdownProps {
  className?: string
}

interface SavedAccount {
  email: string
  nombre_display: string
  tenant_nombre: string
  avatar_url?: string | null
}

const STORAGE_KEY = 'genesis360_saved_accounts'

function loadSavedAccounts(): SavedAccount[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveAccount(account: SavedAccount) {
  const accounts = loadSavedAccounts()
  const idx = accounts.findIndex(a => a.email === account.email)
  if (idx >= 0) {
    accounts[idx] = account
  } else {
    accounts.push(account)
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
}

export function AvatarDropdown({ className = '' }: AvatarDropdownProps) {
  const [open, setOpen] = useState(false)
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user, tenant, signOut } = useAuthStore()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthEmail(data.session?.user?.email ?? null)
    })
  }, [])

  // Al abrir el dropdown: guardar cuenta actual y cargar lista
  useEffect(() => {
    if (!open) return
    if (authEmail && user && tenant) {
      saveAccount({
        email: authEmail,
        nombre_display: user.nombre_display ?? '',
        tenant_nombre: tenant.nombre ?? '',
        avatar_url: user.avatar_url ?? null,
      })
    }
    setSavedAccounts(loadSavedAccounts())
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSignOut = async () => {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  const handleSwitchAccount = async (email: string) => {
    setOpen(false)
    await signOut()
    navigate(`/login?email=${encodeURIComponent(email)}`)
  }

  const handleAddAccount = async () => {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  const rolLabel = user?.rol
    ? user.rol.charAt(0) + user.rol.slice(1).toLowerCase()
    : ''

  // Cuentas guardadas distintas a la actual
  const otherAccounts = savedAccounts.filter(a => a.email !== authEmail)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Mi cuenta"
        className={`flex items-center gap-1.5 ${className}`}
      >
        {user?.avatar_url ? (
          <img
            src={user.avatar_url}
            alt="Avatar"
            className="w-8 h-8 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center border-2 border-gray-200 dark:border-gray-600">
            <User size={15} className="text-accent" />
          </div>
        )}
        <ChevronDown size={13} className="text-gray-400 hidden sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-border-ds rounded-xl shadow-lg z-50 overflow-hidden">

          {/* Info usuario actual */}
          <div className="px-4 py-3 border-b border-border-ds flex items-center gap-3">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="Avatar" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-accent" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-primary dark:text-white truncate">{user?.nombre_display}</p>
              {authEmail && <p className="text-xs text-muted truncate">{authEmail}</p>}
              <p className="text-xs text-muted">{rolLabel} · {tenant?.nombre}</p>
            </div>
            <Check size={14} className="text-accent flex-shrink-0" />
          </div>

          {/* Acciones de cuenta */}
          <div className="py-1">
            <button
              onClick={() => { navigate('/mi-cuenta'); setOpen(false) }}
              className="w-full px-4 py-2 text-sm text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2.5 transition-colors"
            >
              <User size={15} className="text-muted" />
              Perfil
            </button>
            <button
              className="w-full px-4 py-2 text-sm text-left flex items-center gap-2.5 text-gray-400 dark:text-gray-600 cursor-not-allowed"
              disabled
            >
              <span className="w-[15px]" />
              Idioma
              <span className="ml-auto text-xs">Próximamente</span>
            </button>
          </div>

          {/* Gestionar cuentas */}
          <div className="border-t border-border-ds py-1">
            <p className="px-4 py-1.5 text-[11px] font-semibold text-muted uppercase tracking-wide">
              Gestionar cuentas
            </p>

            {/* Otras cuentas guardadas */}
            {otherAccounts.map(acc => (
              <button
                key={acc.email}
                onClick={() => handleSwitchAccount(acc.email)}
                className="w-full px-4 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2.5 transition-colors"
              >
                {acc.avatar_url ? (
                  <img src={acc.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <User size={13} className="text-accent" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-primary dark:text-white text-xs font-medium truncate">{acc.nombre_display || acc.email}</p>
                  <p className="text-muted text-[11px] truncate">{acc.tenant_nombre}</p>
                </div>
              </button>
            ))}

            {/* Agregar otra cuenta */}
            <button
              onClick={handleAddAccount}
              className="w-full px-4 py-2 text-sm text-left text-accent hover:bg-accent/5 flex items-center gap-2.5 transition-colors"
            >
              <UserPlus size={15} className="flex-shrink-0" />
              + Agregar otra cuenta
            </button>
          </div>

          {/* Cerrar sesión */}
          <div className="border-t border-border-ds py-1">
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2 text-sm text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2.5 transition-colors"
            >
              <LogOut size={15} />
              Cerrar sesión
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
