import { create } from 'zustand'
import { supabase, type User, type Tenant } from '@/lib/supabase'

interface AuthState {
  user: User | null
  tenant: Tenant | null
  loading: boolean
  initialized: boolean
  needsOnboarding: boolean
  setUser: (user: User | null) => void
  setTenant: (tenant: Tenant | null) => void
  signOut: () => Promise<void>
  loadUserData: (authUserId: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  loading: true,
  initialized: false,
  needsOnboarding: false,

  setUser: (user) => set({ user }),
  setTenant: (tenant) => set({ tenant }),

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

		set({
		  user: userData,
		  tenant: tenantData,
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
    set({ user: null, tenant: null })
  },
}))
