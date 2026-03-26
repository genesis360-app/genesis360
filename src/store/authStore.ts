import { create } from 'zustand'
import { supabase, type User, type Tenant, type Sucursal } from '@/lib/supabase'

interface AuthState {
  user: User | null
  tenant: Tenant | null
  sucursales: Sucursal[]
  sucursalId: string | null
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
  sucursalId: typeof window !== 'undefined' ? (localStorage.getItem('sucursal-id') || null) : null,
  loading: true,
  initialized: false,
  needsOnboarding: false,

  setUser: (user) => set({ user }),
  setTenant: (tenant) => set({ tenant }),
  setSucursal: (id) => {
    if (id) localStorage.setItem('sucursal-id', id)
    else localStorage.removeItem('sucursal-id')
    set({ sucursalId: id })
  },

	loadUserData: async (authUserId: string) => {
	  console.log('loadUserData llamado con:', authUserId)
	  try {
		const { data: userData, error: userError } = await supabase
		  .from('users')
		  .select('*')
		  .eq('id', authUserId)
		  .single()

		console.log('userData:', userData, 'error:', userError)

		if (!userData) {
		  set({ user: null, tenant: null, loading: false, initialized: true, needsOnboarding: true })
		  return
		}

		const { data: tenantData, error: tenantError } = await supabase
		  .from('tenants')
		  .select('*')
		  .eq('id', userData.tenant_id)
		  .single()

		console.log('tenantData:', tenantData, 'error:', tenantError)

		const { data: sucursalesData } = await supabase
		  .from('sucursales')
		  .select('*')
		  .eq('tenant_id', userData.tenant_id)
		  .eq('activo', true)
		  .order('nombre')

		// Validar que el sucursal_id guardado sigue siendo válido
		const savedId = typeof window !== 'undefined' ? (localStorage.getItem('sucursal-id') || null) : null
		const ids = (sucursalesData ?? []).map((s: Sucursal) => s.id)
		const validSucursalId = savedId && ids.includes(savedId) ? savedId : null

		set({
		  user: userData,
		  tenant: tenantData,
		  sucursales: sucursalesData ?? [],
		  sucursalId: validSucursalId,
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
