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

export type UserRole = 'OWNER' | 'SUPERVISOR' | 'CAJERO' | 'ADMIN' | 'RRHH' | 'CONTADOR' | 'DEPOSITO'
export type SubscriptionStatus = 'trial' | 'active' | 'inactive' | 'cancelled'
export type MovimientoTipo = 'ingreso' | 'rebaje' | 'ajuste' | 'kitting' | 'des_kitting'

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
  regla_inventario: string
  marketplace_activo?: boolean
  marketplace_webhook_url?: string
  session_timeout_minutes?: number | null
  permite_over_receipt?: boolean
  created_at: string
}

export interface User {
  id: string
  tenant_id: string
  rol: UserRole
  nombre_display?: string
  activo: boolean
  avatar_url?: string | null
  rol_custom_id?: string | null
  /** Permisos cargados en runtime desde roles_custom.permisos — no existe en DB directamente */
  permisos_custom?: Record<string, 'no_ver' | 'ver' | 'editar'> | null
  created_at: string
}

export interface Sucursal {
  id: string
  tenant_id: string
  nombre: string
  direccion?: string
  telefono?: string
  activo: boolean
  created_at: string
}

export interface Cliente {
  id: string
  tenant_id: string
  nombre: string
  dni?: string
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
  // Campos extendidos (migration 049)
  razon_social?: string | null
  cuit?: string | null
  domicilio?: string | null
  condicion_iva?: 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final' | null
  plazo_pago_dias?: number | null
  banco?: string | null
  cbu?: string | null
  notas?: string | null
  sucursal_id?: string | null
  created_at?: string
}

export type EstadoOC = 'borrador' | 'enviada' | 'confirmada' | 'cancelada'

export interface OrdenCompra {
  id: string
  tenant_id: string
  proveedor_id: string
  numero: number
  estado: EstadoOC
  fecha_esperada?: string | null
  notas?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
  // joins
  proveedores?: Pick<Proveedor, 'id' | 'nombre'>
}

export interface OrdenCompraItem {
  id: string
  orden_compra_id: string
  producto_id: string
  cantidad: number
  precio_unitario?: number | null
  notas?: string | null
  // joins
  productos?: Pick<Producto, 'id' | 'nombre' | 'sku' | 'unidad_medida' | 'precio_costo'>
}

export interface Ubicacion {
  id: string
  tenant_id: string
  nombre: string
  descripcion?: string
  activo: boolean
  prioridad?: number
  disponible_surtido?: boolean
  es_devolucion?: boolean
  // WMS Fase 2
  tipo_ubicacion?: 'picking' | 'bulk' | 'estiba' | 'camara' | 'cross_dock' | null
  alto_cm?: number | null
  ancho_cm?: number | null
  largo_cm?: number | null
  peso_max_kg?: number | null
  capacidad_pallets?: number | null
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
  precio_costo_moneda: string
  precio_venta: number
  precio_venta_moneda: string
  margen_ganancia: number
  stock_actual: number
  stock_minimo: number
  unidad_medida: string
  codigo_barras?: string
  imagen_url?: string
  tiene_series?: boolean
  tiene_lote?: boolean
  tiene_vencimiento?: boolean
  es_kit?: boolean
  alicuota_iva?: number
  regla_inventario?: string | null
  publicado_marketplace?: boolean
  precio_marketplace?: number | null
  stock_reservado_marketplace?: number
  descripcion_marketplace?: string | null
  activo: boolean
  created_at: string
  updated_at: string
  // Joins
  categorias?: Categoria
  proveedores?: Proveedor
  ubicaciones?: Ubicacion
}

export interface ProductoEstructura {
  id: string
  tenant_id: string
  producto_id: string
  nombre: string
  is_default: boolean
  unidades_por_caja?: number | null
  cajas_por_pallet?: number | null
  peso_unidad?: number | null
  alto_unidad?: number | null
  ancho_unidad?: number | null
  largo_unidad?: number | null
  peso_caja?: number | null
  alto_caja?: number | null
  ancho_caja?: number | null
  largo_caja?: number | null
  peso_pallet?: number | null
  alto_pallet?: number | null
  ancho_pallet?: number | null
  largo_pallet?: number | null
  created_at: string
  updated_at: string
}

export interface InventarioConteo {
  id: string
  tenant_id: string
  tipo: 'ubicacion' | 'producto'
  ubicacion_id?: string | null
  producto_id?: string | null
  estado: 'borrador' | 'finalizado'
  notas?: string | null
  ajuste_aplicado: boolean
  sucursal_id?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
  ubicaciones?: { nombre: string }
  productos?: { nombre: string; sku: string }
  inventario_conteo_items?: InventarioConteoItem[]
}

export interface InventarioConteoItem {
  id: string
  conteo_id: string
  inventario_linea_id?: string | null
  producto_id: string
  lpn?: string | null
  cantidad_esperada: number
  cantidad_contada: number
  productos?: { nombre: string; sku: string; unidad_medida: string }
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

export interface Gasto {
  id: string
  tenant_id: string
  descripcion: string
  monto: number
  categoria?: string
  medio_pago?: string
  fecha: string
  usuario_id?: string
  notas?: string
  created_at: string
}

export interface Plan {
  id: string
  nombre: string
  max_users: number
  precio_mensual: number
  mp_plan_id?: string
  activo: boolean
}

export interface Devolucion {
  id: string
  tenant_id: string
  venta_id: string
  numero_nc?: string | null
  origen: 'despachada' | 'facturada'
  motivo?: string | null
  monto_total: number
  medio_pago?: string | null
  created_by?: string | null
  created_at: string
  devolucion_items?: DevolucionItem[]
}

export interface DevolucionItem {
  id: string
  devolucion_id: string
  producto_id: string
  cantidad: number
  precio_unitario: number
  inventario_linea_nueva_id?: string | null
  productos?: Pick<Producto, 'nombre' | 'sku'>
}

export interface TenantCertificate {
  id: string
  tenant_id: string
  cert_crt_path: string
  cert_key_path: string
  cuit?: string | null
  fecha_validez_hasta?: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface ArchivosBiblioteca {
  id: string
  tenant_id: string
  nombre: string
  tipo: 'certificado_afip_crt' | 'certificado_afip_key' | 'contrato' | 'factura_proveedor' | 'manual' | 'otro'
  descripcion?: string | null
  storage_path: string
  tamanio?: number | null
  mime_type?: string | null
  created_by?: string | null
  created_at: string
}

export interface KitReceta {
  id: string
  tenant_id: string
  kit_producto_id: string
  comp_producto_id: string
  cantidad: number
  created_at: string
  // Joins
  componente?: Pick<Producto, 'id' | 'nombre' | 'sku' | 'stock_actual' | 'unidad_medida'>
}

export interface KittingLog {
  id: string
  tenant_id: string
  kit_producto_id: string
  cantidad_kits: number
  ubicacion_id?: string | null
  usuario_id?: string | null
  notas?: string | null
  created_at: string
  kit?: Pick<Producto, 'nombre' | 'sku'>
}
