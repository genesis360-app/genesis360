import { create } from 'zustand'
import { supabase, type User, type Tenant, type Sucursal } from '@/lib/supabase'

// Roles que pueden ver y cambiar entre sucursales (visión multi-sucursal)
const ROLES_SIEMPRE_GLOBALES = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO']

interface AuthState {
  user: User | null
  tenant: Tenant | null
  sucursales: Sucursal[]
  sucursalId: string | null
  puedeVerTodas: boolean
  loading: boolean
  initialized: boolean
  needsOnboarding: boolean
  setUser: (user: User | null) => void
  setTenant: (tenant: Tenant | null) => void
  setSucursal: (id: string | null) => void
  signOut: () => Promise<void>
  loadUserData: (authUserId: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  sucursales: [],
  sucursalId: typeof window !== 'undefined'
    ? (v => v === '__global__' ? null : (v || null))(localStorage.getItem('sucursal-id'))
    : null,
  puedeVerTodas: true,
  loading: true,
  initialized: false,
  needsOnboarding: false,

  setUser: (user) => set({ user }),
  setTenant: (tenant) => set({ tenant }),
  setSucursal: (id) => {
    localStorage.setItem('sucursal-id', id ?? '__global__')
    set({ sucursalId: id })
  },

	loadUserData: async (authUserId: string) => {
	  console.log('loadUserData llamado con:', authUserId)
	  try {
		const [{ data: userData, error: userError }, { data: authData }] = await Promise.all([
		  supabase.from('users').select('*').eq('id', authUserId).single(),
		  supabase.auth.getUser(),
		])

		console.log('userData:', userData, 'error:', userError)

		if (!userData) {
		  set({ user: null, tenant: null, loading: false, initialized: true, needsOnboarding: true })
		  return
		}

		// Resolver avatar: Google OAuth tiene avatar en user_metadata; email/password usa el subido por el usuario
		const googleAvatar = authData?.user?.user_metadata?.avatar_url ?? null
		const resolvedAvatar = userData.avatar_url ?? googleAvatar

		const [{ data: tenantData, error: tenantError }, { data: sucursalesData }, { data: rolCustomData }] = await Promise.all([
		  supabase.from('tenants').select('*').eq('id', userData.tenant_id).single(),
		  supabase.from('sucursales').select('*').eq('tenant_id', userData.tenant_id).eq('activo', true).order('nombre'),
		  userData.rol_custom_id
		    ? supabase.from('roles_custom').select('permisos').eq('id', userData.rol_custom_id).eq('activo', true).maybeSingle()
		    : Promise.resolve({ data: null }),
		])

		console.log('tenantData:', tenantData, 'error:', tenantError)

		// Validar que el sucursal_id guardado sigue siendo válido
		const savedRaw = typeof window !== 'undefined' ? localStorage.getItem('sucursal-id') : null
		const ids = (sucursalesData ?? []).map((s: Sucursal) => s.id)
		const validSucursalId = savedRaw === '__global__' ? null
		  : (savedRaw && ids.includes(savedRaw) ? savedRaw : null)

		// Permisos de vista global: DUEÑO y ADMIN siempre, resto según DB
		const puedeVerTodas = ROLES_SIEMPRE_GLOBALES.includes(userData.rol) || !!userData.puede_ver_todas

		// Usuarios sin vista global quedan bloqueados a su sucursal asignada (ignora localStorage)
		const effectiveSucursalId = puedeVerTodas ? validSucursalId : (userData.sucursal_id ?? null)

		const permisosCustom = (rolCustomData?.permisos ?? null) as Record<string, 'no_ver' | 'ver' | 'editar'> | null

		set({
		  user: { ...userData, avatar_url: resolvedAvatar, permisos_custom: permisosCustom },
		  tenant: tenantData,
		  sucursales: sucursalesData ?? [],
		  sucursalId: effectiveSucursalId,
		  puedeVerTodas,
		  loading: false,
		  initialized: true,
		})
	  } catch (err) {
		console.error('Error en loadUserData:', err)
		set({ user: null, tenant: null, loading: false, initialized: true, needsOnboarding: false })
	  }
	},

  signOut: async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('sucursal-id')
    set({ user: null, tenant: null, sucursales: [], sucursalId: null })
  },
}))
