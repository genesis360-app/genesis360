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

export type UserRole = 'DUEÑO' | 'SUPER_USUARIO' | 'SUPERVISOR' | 'CAJERO' | 'RRHH' | 'CONTADOR' | 'DEPOSITO' | 'ADMIN'
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
  sucursal_id?: string | null
  puede_ver_todas?: boolean
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

export type EstadoOC = 'borrador' | 'enviada' | 'confirmada' | 'cancelada' | 'recibida_parcial' | 'recibida'
export type EstadoPagoOC = 'pendiente_pago' | 'pago_parcial' | 'pagada' | 'cuenta_corriente'

export type EstadoRecepcion = 'borrador' | 'confirmada' | 'cancelada'

export interface Recepcion {
  id: string
  tenant_id: string
  numero: number
  oc_id?: string | null
  proveedor_id?: string | null
  estado: EstadoRecepcion
  notas?: string | null
  sucursal_id?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
  // joins
  proveedores?: { nombre: string } | null
  ordenes_compra?: { numero: number } | null
}

export interface RecepcionItem {
  id: string
  recepcion_id: string
  producto_id: string
  oc_item_id?: string | null
  cantidad_esperada: number
  cantidad_recibida: number
  estado_id?: string | null
  ubicacion_id?: string | null
  nro_lote?: string | null
  fecha_vencimiento?: string | null
  lpn?: string | null
  series_txt?: string | null
  inventario_linea_id?: string | null
  precio_costo?: number | null
  // joins
  productos?: Pick<Producto, 'id' | 'nombre' | 'sku' | 'unidad_medida'>
}

export interface OrdenCompra {
  id: string
  tenant_id: string
  proveedor_id: string
  numero: number
  estado: EstadoOC
  // Pago (migration 085)
  estado_pago: EstadoPagoOC
  monto_total?: number | null
  monto_pagado: number
  fecha_vencimiento_pago?: string | null
  dias_plazo_pago?: number | null
  condiciones_pago?: string | null
  fecha_esperada?: string | null
  notas?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
  // Migration 095
  oc_padre_id?: string | null
  es_derivada?: boolean
  tiene_reembolso_pendiente?: boolean
  // joins
  proveedores?: Pick<Proveedor, 'id' | 'nombre'>
  orden_compra_items?: OrdenCompraItem[]
}

export interface ProveedorCCMovimiento {
  id: string
  tenant_id: string
  proveedor_id: string
  oc_id?: string | null
  tipo: 'oc' | 'pago' | 'nota_credito' | 'ajuste'
  monto: number
  fecha: string
  fecha_vencimiento?: string | null
  medio_pago?: string | null
  descripcion?: string | null
  caja_sesion_id?: string | null
  created_by?: string | null
  created_at: string
  // joins
  ordenes_compra?: Pick<OrdenCompra, 'numero'> | null
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
  // Sprint B
  mono_sku?: boolean
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
  tipo?: 'armado' | 'desarmado'
  estado?: 'en_armado' | 'completado' | 'cancelado'
  componentes_reservados?: { linea_id: string; comp_producto_id: string; cantidad: number }[] | null
  created_at: string
  kit?: Pick<Producto, 'nombre' | 'sku'>
}

export interface ProductoStockMinimoSucursal {
  id: string
  tenant_id: string
  producto_id: string
  sucursal_id: string
  stock_minimo: number
  created_at: string
  sucursales?: Pick<Sucursal, 'nombre'>
}

// ─── Integraciones externas ───────────────────────────────────────────────────

export type IntegracionTipo = 'meli' | 'tiendanube' | 'mp' | 'andreani' | 'correo_argentino' | 'shopify' | 'woocommerce'
export type OrigenVenta = 'POS' | 'MELI' | 'TiendaNube' | 'Shopify' | 'WooCommerce' | 'MP'
export type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface IntegrationJobQueue {
  id: string
  tenant_id: string
  sucursal_id?: string | null
  integracion: IntegracionTipo
  tipo: string
  payload: Record<string, unknown>
  endpoint?: string | null
  status: JobStatus
  retries: number
  max_retries: number
  next_attempt_at: string
  error_last?: string | null
  created_at: string
  updated_at: string
}

export interface VentaExternaLog {
  id: string
  tenant_id: string
  integracion: IntegracionTipo
  webhook_external_id: string
  venta_id?: string | null
  payload_raw?: Record<string, unknown> | null
  procesado_at: string
}

export interface TiendanubeCredentials {
  id: string
  tenant_id: string
  sucursal_id: string
  store_id: number
  store_name?: string | null
  store_url?: string | null
  /** access_token nunca expuesto al frontend — solo estado de conexión */
  conectado: boolean
  conectado_at: string
  created_at: string
  updated_at: string
}

export interface MercadopagoCredentials {
  id: string
  tenant_id: string
  sucursal_id: string
  seller_id: number
  seller_email?: string | null
  /** access_token nunca expuesto al frontend */
  expires_at?: string | null
  conectado: boolean
  conectado_at: string
  created_at: string
  updated_at: string
}

export interface InventarioTnMap {
  id: string
  tenant_id: string
  sucursal_id: string
  producto_id: string
  tn_product_id: number
  tn_variant_id?: number | null
  sync_stock: boolean
  sync_precio: boolean
  ultimo_sync_at?: string | null
  created_at: string
  productos?: Pick<Producto, 'nombre' | 'sku'>
}

export interface Recurso {
  id: string
  tenant_id: string
  nombre: string
  descripcion?: string | null
  categoria: string
  estado: 'activo' | 'en_reparacion' | 'dado_de_baja' | 'pendiente_adquisicion'
  valor?: number | null
  fecha_adquisicion?: string | null
  proveedor_id?: string | null
  ubicacion?: string | null
  numero_serie?: string | null
  garantia_hasta?: string | null
  notas?: string | null
  sucursal_id?: string | null
  es_recurrente?: boolean
  frecuencia_valor?: number | null
  frecuencia_unidad?: 'dia' | 'semana' | 'mes' | 'año' | null
  proximo_vencimiento?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
  proveedores?: Pick<Proveedor, 'id' | 'nombre'> | null
}
