import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan variables de entorno de Supabase. Revisá tu archivo .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// ─── Tipos TypeScript ─────────────────────────────────────────────────────────

export type UserRole = 'OWNER' | 'SUPERVISOR' | 'CAJERO' | 'ADMIN'
export type SubscriptionStatus = 'trial' | 'active' | 'inactive' | 'cancelled'
export type MovimientoTipo = 'ingreso' | 'rebaje' | 'ajuste'

export interface Tenant {
  id: string
  nombre: string
  tipo_comercio?: string
  pais: string
  subscription_status: SubscriptionStatus
  trial_ends_at: string
  plan_id?: string
  max_users: number
  max_productos: number
  mp_subscription_id?: string
  logo_url?: string
  cotizacion_usd?: number
  cotizacion_usd_updated_at?: string
  created_at: string
}

export interface User {
  id: string
  tenant_id: string
  rol: UserRole
  nombre_display?: string
  activo: boolean
  created_at: string
}

export interface Cliente {
  id: string
  tenant_id: string
  nombre: string
  telefono?: string
  email?: string
  notas?: string
  created_at: string
}

export interface Categoria {
  id: string
  tenant_id: string
  nombre: string
  descripcion?: string
  activo: boolean
}

export interface Proveedor {
  id: string
  tenant_id: string
  nombre: string
  contacto?: string
  telefono?: string
  email?: string
  activo: boolean
}

export interface Ubicacion {
  id: string
  tenant_id: string
  nombre: string
  descripcion?: string
  activo: boolean
}

export interface Producto {
  id: string
  tenant_id: string
  nombre: string
  sku: string
  descripcion?: string
  categoria_id?: string
  proveedor_id?: string
  ubicacion_id?: string
  precio_costo: number
  precio_venta: number
  margen_ganancia: number
  stock_actual: number
  stock_minimo: number
  unidad_medida: string
  codigo_barras?: string
  imagen_url?: string
  activo: boolean
  created_at: string
  updated_at: string
  // Joins
  categorias?: Categoria
  proveedores?: Proveedor
  ubicaciones?: Ubicacion
}

export interface MovimientoStock {
  id: string
  tenant_id: string
  producto_id: string
  tipo: MovimientoTipo
  cantidad: number
  stock_antes: number
  stock_despues: number
  motivo?: string
  proveedor_id?: string
  usuario_id?: string
  created_at: string
  // Joins
  productos?: Pick<Producto, 'nombre' | 'sku'>
  users?: Pick<User, 'nombre_display'>
  proveedores?: Pick<Proveedor, 'nombre'>
}

export interface Alerta {
  id: string
  tenant_id: string
  producto_id: string
  tipo: string
  mensaje?: string
  resuelta: boolean
  created_at: string
  productos?: Pick<Producto, 'nombre' | 'sku' | 'stock_actual' | 'stock_minimo'>
}

export interface Plan {
  id: string
  nombre: string
  max_users: number
  precio_mensual: number
  mp_plan_id?: string
  activo: boolean
}
