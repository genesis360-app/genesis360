import { create } from 'zustand'
import { supabase, type User, type Tenant, type Sucursal } from '@/lib/supabase'

// Solo DUEÑO es siempre global — no se puede restringir a una sucursal
const ROLES_SIEMPRE_GLOBALES = ['DUEÑO']
// Estos roles son globales por defecto, pero pueden restringirse con puede_ver_todas = false en DB
const ROLES_GLOBAL_POR_DEFECTO = ['SUPERVISOR', 'SUPER_USUARIO', 'VIEWER']

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
  /** Igual que `loadUserData` pero NO repite trabajo ya hecho. Solo para el bootstrap de auth. */
  ensureUserData: (authUserId: string) => Promise<void>
}

// Dedupe del bootstrap de auth (medido el 2026-09-17 con `npm run perf:navegacion`): `loadUserData`
// corría ~5 veces por carga de página —4 `GET /auth/v1/user` + 5 `users` + 5 `tenants` +
// 5 `sucursales`, todas devolviendo lo mismo— porque `App.tsx` la dispara desde `getSession()` **y**
// desde `onAuthStateChange`, que se emite varias veces (sesión inicial, token refrescado). Son ~15 de
// las ~64 requests que cuesta abrir una pantalla de cero.
//
// 🛑 El dedupe vive SOLO en `ensureUserData`, el camino del bootstrap. `loadUserData` sigue
// recargando SIEMPRE: las otras llamadas de la app son refrescos deliberados después de una mutación
// (alta de negocio en el onboarding, crear/borrar sucursal, activar la suscripción, cambiar avatar o
// nombre, cancelar la baja) y tienen que seguir trayendo datos frescos.
let cargaEnCurso: { authUserId: string; promesa: Promise<void> } | null = null

export const useAuthStore = create<AuthState>((set, get) => ({
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
    // Seguridad: un usuario sin vista global NO puede cambiar de sucursal — queda fijado
    // a la suya asignada. Evita que vea (o cargue stock en) otra sucursal. Solo DUEÑO y
    // roles habilitados (puedeVerTodas) pueden alternar o elegir "Todas".
    if (!get().puedeVerTodas) return
    localStorage.setItem('sucursal-id', id ?? '__global__')
    set({ sucursalId: id })
  },

  loadUserData: async (authUserId: string) => {
    try {
      const [{ data: userData }, { data: authData }] = await Promise.all([
        supabase.from('users').select('*').eq('id', authUserId).single(),
        supabase.auth.getUser(),
      ])

      if (!userData) {
        // Portal de Proveedores (mig 387/390): una cuenta de proveedor es un auth.users SEPARADO,
        // sin fila en `users` — si esta sesión es la suya, NO es "necesita onboarding" (eso
        // dejaría crear un tenant/users nuevo con su misma identidad, mezclando roles). Se
        // resuelve fuera de este store: PortalProveedoresPage valida su propia sesión.
        const { data: cuentaProveedor } = await supabase.from('proveedor_accounts')
          .select('id').eq('id', authUserId).maybeSingle()
        set({ user: null, tenant: null, loading: false, initialized: true, needsOnboarding: !cuentaProveedor })
        return
      }

      // Resolver avatar: Google OAuth tiene avatar en user_metadata; email/password usa el subido por el usuario
      const googleAvatar = authData?.user?.user_metadata?.avatar_url ?? null
      const resolvedAvatar = userData.avatar_url ?? googleAvatar

      const [{ data: tenantData }, { data: sucursalesData }, { data: rolCustomData }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', userData.tenant_id).single(),
        supabase.from('sucursales').select('*').eq('tenant_id', userData.tenant_id).eq('activo', true).order('created_at'),
        userData.rol_custom_id
          ? supabase.from('roles_custom').select('permisos').eq('id', userData.rol_custom_id).eq('activo', true).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      // Validar/resolver sucursal activa:
      // '__global__'  → explícitamente eligió "Todas" → null
      // id válido     → usar ese id
      // null (nunca eligió) y hay sucursales → auto-seleccionar la más antigua (primera)
      // id inválido (borrada) → auto-seleccionar la primera disponible
      const savedRaw = typeof window !== 'undefined' ? localStorage.getItem('sucursal-id') : null
      const ids = (sucursalesData ?? []).map((s: Sucursal) => s.id)
      const validSucursalId = savedRaw === '__global__' ? null
        : savedRaw && ids.includes(savedRaw) ? savedRaw
        : ids.length > 0 ? ids[0]
        : null

      // DUEÑO: siempre global (hardcoded)
      // SUPERVISOR/SUPER_USUARIO: global por defecto, restringible con puede_ver_todas=false en DB
      // Resto: solo si puede_ver_todas=true explícito en DB
      const puedeVerTodas =
        ROLES_SIEMPRE_GLOBALES.includes(userData.rol) ||
        (ROLES_GLOBAL_POR_DEFECTO.includes(userData.rol) && userData.puede_ver_todas !== false) ||
        !!userData.puede_ver_todas

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

  ensureUserData: async (authUserId: string) => {
    // Misma carga ya en vuelo: `getSession()` y `onAuthStateChange` disparan casi juntos, antes de
    // que el estado esté seteado, así que mirar el store no alcanza — hay que compartir la promesa.
    if (cargaEnCurso?.authUserId === authUserId) return cargaEnCurso.promesa
    // Ya está cargado ESE usuario → no hay nada que pedir. Se mira el store (no un flag aparte) para
    // que sea auto-correctivo: si la sesión se cerró, `user` quedó en null y vuelve a cargar.
    const { user, initialized } = get()
    if (initialized && user?.id === authUserId) return
    const promesa = get().loadUserData(authUserId).finally(() => {
      if (cargaEnCurso?.authUserId === authUserId) cargaEnCurso = null
    })
    cargaEnCurso = { authUserId, promesa }
    return promesa
  },

  signOut: async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('sucursal-id')
    set({ user: null, tenant: null, sucursales: [], sucursalId: null })
  },
}))
