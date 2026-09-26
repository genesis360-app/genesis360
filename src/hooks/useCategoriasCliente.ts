import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { traerTodo } from '@/lib/traerTodo'
import { rolEnLista } from '@/lib/cajaPermisos'
import type { CondicionesCategoria, OrigenCC, PoliticaExceso } from '@/lib/ccCategorias'

// Categorías de clientes (mig 442). Los permisos espejan los guards del servidor (`fn_usuario_en_roles_categoria`,
// `fn_clientes_categoria_guard`): la pantalla solo evita ofrecer lo que el servidor va a rechazar igual.

export interface CategoriaCliente extends CondicionesCategoria {
  id: string
  nombre: string
  descripcion: string | null
  usada: boolean
  created_at: string
}

/** Una fila de `vw_clientes_cc`: condiciones EFECTIVAS del cliente y de dónde sale cada una. */
export interface ClienteCC {
  cliente_id: string
  categoria_cliente_id: string | null
  categoria_nombre: string | null
  cc_habilitada: boolean
  cc_limite: number | null
  cc_plazo_dias: number
  cc_interes_mensual_pct: number
  cc_enforcement_politica: PoliticaExceso
  origen_habilitada: OrigenCC
  origen_limite: OrigenCC
  origen_plazo: OrigenCC
  origen_interes: OrigenCC
  origen_enforcement: OrigenCC
}

export const CATEGORIAS_QUERY_KEY = 'categorias-cliente'
export const CLIENTES_CC_QUERY_KEY = 'clientes-cc-efectivo'

export function useCategoriasCliente() {
  const { tenant } = useAuthStore()
  return useQuery({
    queryKey: [CATEGORIAS_QUERY_KEY, tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias_cliente').select('*').eq('tenant_id', tenant!.id).order('nombre')
      if (error) throw error
      return (data ?? []) as CategoriaCliente[]
    },
    enabled: !!tenant,
  })
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** Condiciones efectivas de TODOS los clientes del negocio, por id. */
export function useClientesCC(enabled = true) {
  const { tenant } = useAuthStore()
  return useQuery({
    queryKey: [CLIENTES_CC_QUERY_KEY, tenant?.id],
    queryFn: async () => {
      // Sin tope: PostgREST corta en 1000 filas sin avisar.
      const filas = await traerTodo<any>((desde, hasta) => supabase.from('vw_clientes_cc')
        .select('*').eq('tenant_id', tenant!.id).range(desde, hasta))
      const mapa = new Map<string, ClienteCC>()
      for (const f of filas) {
        mapa.set(f.cliente_id, {
          ...f,
          cc_limite: n(f.cc_limite),
          cc_plazo_dias: Number(f.cc_plazo_dias),
          cc_interes_mensual_pct: Number(f.cc_interes_mensual_pct),
        })
      }
      return mapa
    },
    enabled: !!tenant && enabled,
  })
}

type UsuarioPermisos = { rol?: string | null; rol_custom_id?: string | null } | null | undefined

const esDuenoOAdmin = (u: UsuarioPermisos) => u?.rol === 'DUEÑO' || u?.rol === 'ADMIN'

/** E1 — crear/editar categorías: DUEÑO (y ADMIN) + roles habilitados en Config. */
export function puedeGestionarCategorias(u: UsuarioPermisos, tenant: any): boolean {
  return esDuenoOAdmin(u) || rolEnLista(u?.rol as any, u?.rol_custom_id, tenant?.categorias_cliente_roles ?? [])
}

/** E2 — asignar una categoría a un cliente. */
export function puedeAsignarCategoria(u: UsuarioPermisos, tenant: any): boolean {
  return esDuenoOAdmin(u) || rolEnLista(u?.rol as any, u?.rol_custom_id, tenant?.categorias_cliente_asignar_roles ?? [])
}

/** E3 — valores PROPIOS de cuenta corriente de un cliente: solo el DUEÑO (y el staff ADMIN). */
export function puedeEditarCCPropia(u: UsuarioPermisos): boolean {
  return esDuenoOAdmin(u)
}
