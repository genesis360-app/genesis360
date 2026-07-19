-- ============================================================
-- Genesis360 — Schema completo del esquema `public`
-- Generado 2026-07-13T22:16:01.492Z desde DEV (gcmhzdedrkmmzfzfveig)
-- Última migración aplicada: 20260712232300 · 139 tablas
--
-- Reconstruido desde el catálogo de Postgres vía la Management API de Supabase
-- (NO es pg_dump byte-a-byte). Regenerar con: node scripts/dump-schema.mjs
-- (necesita conexión al pooler/directo; hoy bloqueada por el bug de Supavisor +
--  falta de egress IPv6, así que este snapshot se generó vía MCP execute_sql).
-- ============================================================

-- ============================================================
-- EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ============================================================
-- TABLAS
-- ============================================================
CREATE TABLE public.actividad_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  usuario_id uuid,
  usuario_nombre text,
  entidad text NOT NULL,
  entidad_id text,
  entidad_nombre text,
  accion text NOT NULL,
  campo text,
  valor_anterior text,
  valor_nuevo text,
  pagina text,
  created_at timestamp with time zone DEFAULT now(),
  transaccion_id uuid,
  tipo_transaccion text,
  producto_id uuid,
  lpn text,
  nro_serie text,
  lote text,
  sucursal_id uuid
);

CREATE TABLE public.addon_batch_changes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente_pago'::text,
  packs_objetivo jsonb NOT NULL,
  monto_delta numeric(12,2) NOT NULL,
  monto_recurrente_nuevo numeric(12,2) NOT NULL,
  mp_preference_id text,
  mp_payment_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  applied_at timestamp with time zone,
  error_detalle text,
  plan_objetivo text,
  programado_para timestamp with time zone
);

CREATE TABLE public.admin_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid,
  agent_email text,
  action text NOT NULL,
  target_tenant_id uuid,
  target_user_id uuid,
  metadata jsonb,
  ip text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.afip_wsaa_ta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cuit bigint NOT NULL,
  service text NOT NULL DEFAULT 'wsfe'::text,
  environment text NOT NULL,
  token text NOT NULL,
  sign text NOT NULL,
  expiration_time timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.aging_profile_reglas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  estado_id uuid NOT NULL,
  dias integer NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.aging_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.alertas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  tipo text NOT NULL DEFAULT 'stock_minimo'::text,
  mensaje text,
  resuelta boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  permisos text[] DEFAULT ARRAY['read'::text],
  activo boolean DEFAULT true,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.archivos_biblioteca (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'otro'::text,
  descripcion text,
  storage_path text NOT NULL,
  tamanio bigint,
  mime_type text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.atributos_variante_valores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  atributo text NOT NULL,
  valor text NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.autorizaciones_cc (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  oc_id uuid,
  motivo_bloqueo text NOT NULL,
  monto numeric(12,2),
  motivo text,
  solicitante_id uuid NOT NULL,
  solicitante_rol text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  aprobador_id uuid,
  aprobador_rol text,
  resolved_at timestamp with time zone,
  motivo_rechazo text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.autorizaciones_gasto (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid,
  gasto_id uuid,
  tipo text NOT NULL,
  monto numeric(12,2),
  descripcion text,
  motivo text,
  payload jsonb,
  solicitante_id uuid NOT NULL,
  solicitante_rol text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  aprobador_id uuid,
  aprobador_rol text,
  resolved_at timestamp with time zone,
  motivo_rechazo text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.autorizaciones_inventario (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tipo text NOT NULL,
  linea_id uuid,
  datos_cambio jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  solicitado_por uuid,
  aprobado_por uuid,
  motivo_rechazo text,
  notas text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.billing_cancelaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  tipo text NOT NULL,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.billing_manual_pagos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  monto numeric(12,2) NOT NULL,
  medio text NOT NULL,
  referencia text,
  periodo_desde timestamp with time zone NOT NULL,
  periodo_hasta timestamp with time zone NOT NULL,
  registrado_por uuid,
  mp_payment_id text,
  notas text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.boveda_arqueos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cuenta_origen_id uuid,
  saldo_sistema numeric(14,2) NOT NULL DEFAULT 0,
  saldo_contado numeric(14,2) NOT NULL DEFAULT 0,
  diferencia numeric(14,2) NOT NULL DEFAULT 0,
  notas text,
  usuario_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.boveda_retiros (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cuenta_origen_id uuid,
  monto numeric(14,2) NOT NULL,
  tipo_retiro text NOT NULL DEFAULT 'otro'::text,
  motivo text NOT NULL,
  notas text,
  usuario_id uuid NOT NULL,
  movimiento_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.caja_arqueos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sesion_id uuid NOT NULL,
  saldo_calculado numeric(12,2) NOT NULL,
  saldo_real numeric(12,2) NOT NULL,
  diferencia numeric(12,2) DEFAULT (saldo_real - saldo_calculado),
  notas text,
  usuario_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.caja_movimientos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sesion_id uuid NOT NULL,
  tipo text NOT NULL,
  concepto text NOT NULL,
  monto numeric(12,2) NOT NULL,
  usuario_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  cuenta_origen_id uuid
);

CREATE TABLE public.caja_sesiones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  caja_id uuid NOT NULL,
  usuario_id uuid,
  monto_apertura numeric(12,2) NOT NULL DEFAULT 0,
  monto_cierre numeric(12,2),
  total_ingresos numeric(12,2) DEFAULT 0,
  total_egresos numeric(12,2) DEFAULT 0,
  total_ventas numeric(12,2) DEFAULT 0,
  estado text NOT NULL DEFAULT 'abierta'::text,
  notas_cierre text,
  abierta_at timestamp with time zone DEFAULT now(),
  cerrada_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  monto_real_cierre numeric(12,2),
  diferencia_cierre numeric(12,2),
  cerrado_por_id uuid,
  sucursal_id uuid,
  es_permanente boolean DEFAULT false,
  monto_sugerido_apertura numeric(12,2),
  diferencia_apertura numeric(12,2),
  abierta_por uuid,
  numero integer,
  snapshot_totales jsonb
);

CREATE TABLE public.caja_traspasos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sesion_origen_id uuid NOT NULL,
  sesion_destino_id uuid NOT NULL,
  monto numeric(12,2) NOT NULL,
  concepto text,
  usuario_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  movimiento_origen_id uuid,
  movimiento_destino_id uuid
);

CREATE TABLE public.cajas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  es_caja_fuerte boolean DEFAULT false,
  sucursal_id uuid,
  moneda text NOT NULL DEFAULT 'ARS'::text
);

CREATE TABLE public.canales_venta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  clasificacion text NOT NULL DEFAULT 'presencial'::text,
  icono text,
  activo boolean NOT NULL DEFAULT true,
  predefinido boolean NOT NULL DEFAULT false,
  orden integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.categorias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.categorias_gasto (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  requiere_sucursal boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  predefinida boolean NOT NULL DEFAULT false,
  orden integer,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.cheques (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  numero_interno integer,
  tipo text NOT NULL DEFAULT 'propio'::text,
  nro_cheque text,
  banco text,
  monto numeric NOT NULL DEFAULT 0,
  fecha_emision date,
  fecha_cobro date,
  estado text NOT NULL DEFAULT 'en_cartera'::text,
  proveedor_id uuid,
  endosado_a_proveedor_id uuid,
  cliente_origen text,
  oc_id uuid,
  sucursal_id uuid,
  notas text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  gasto_id uuid
);

CREATE TABLE public.cierres_contables (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  periodo date NOT NULL,
  fecha_cierre timestamp with time zone NOT NULL DEFAULT now(),
  cerrado_por uuid NOT NULL,
  cerrado_por_rol text NOT NULL,
  observaciones text,
  totales jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.cliente_creditos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  monto numeric(12,2) NOT NULL,
  origen text NOT NULL,
  venta_id uuid,
  nota text,
  usuario_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.cliente_domicilios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  nombre text,
  calle text NOT NULL,
  numero text,
  piso_depto text,
  ciudad text,
  provincia text,
  codigo_postal text,
  referencias text,
  es_principal boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.cliente_notas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  texto text NOT NULL,
  usuario_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.clientes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  telefono text,
  email text,
  notas text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  sucursal_id uuid,
  dni text,
  telefono_normalizado text,
  marketing_optin boolean DEFAULT true,
  cuit_receptor text,
  condicion_iva_receptor text,
  fecha_nacimiento date,
  etiquetas text[],
  codigo_fiscal text,
  regimen_fiscal text,
  cuenta_corriente_habilitada boolean DEFAULT false,
  limite_credito numeric(12,2),
  plazo_pago_dias integer DEFAULT 30,
  motivo_baja text,
  baja_at timestamp with time zone,
  baja_por uuid,
  cuenta_token text
);

CREATE TABLE public.codigo_perfiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  proveedor_id uuid,
  tipo text NOT NULL DEFAULT 'gs1'::text,
  simbologia text NOT NULL DEFAULT 'gs1_128'::text,
  ais jsonb NOT NULL DEFAULT '["01", "10", "17", "30"]'::jsonb,
  custom_format jsonb,
  lectura_modo text NOT NULL DEFAULT 'autocompletar'::text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.combo_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  combo_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  cantidad integer NOT NULL DEFAULT 1
);

CREATE TABLE public.combos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  producto_id uuid,
  cantidad integer DEFAULT 2,
  descuento_pct numeric(5,2) NOT NULL DEFAULT 0,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  descuento_tipo text NOT NULL DEFAULT 'pct'::text,
  descuento_monto numeric(12,2) NOT NULL DEFAULT 0,
  sucursal_id uuid
);

CREATE TABLE public.courier_credenciales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  courier text NOT NULL,
  credenciales jsonb NOT NULL DEFAULT '{}'::jsonb,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.courier_factura_lineas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  factura_id uuid NOT NULL,
  envio_id uuid,
  monto_registrado numeric(12,2) NOT NULL DEFAULT 0,
  monto_facturado numeric(12,2),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.courier_facturas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  courier text NOT NULL,
  nro_factura text,
  periodo_desde date,
  periodo_hasta date,
  total_facturado numeric(12,2) NOT NULL DEFAULT 0,
  total_registrado numeric(12,2) NOT NULL DEFAULT 0,
  diferencia numeric(12,2) NOT NULL DEFAULT 0,
  archivo_url text,
  estado text NOT NULL DEFAULT 'borrador'::text,
  notas text,
  sucursal_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.courier_tarifas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid,
  courier text NOT NULL,
  precio numeric(10,2) NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.cuentas_origen (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'banco'::text,
  banco text,
  numero text,
  alias text,
  moneda text NOT NULL DEFAULT 'ARS'::text,
  activo boolean NOT NULL DEFAULT true,
  notas text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.devolucion_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  devolucion_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  cantidad integer NOT NULL DEFAULT 1,
  precio_unitario numeric(12,2) NOT NULL DEFAULT 0,
  inventario_linea_nueva_id uuid
);

CREATE TABLE public.devolucion_proveedor_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  devolucion_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  cantidad numeric NOT NULL,
  costo_unitario numeric NOT NULL DEFAULT 0,
  lpn text
);

CREATE TABLE public.devoluciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  venta_id uuid NOT NULL,
  numero_nc text,
  origen text NOT NULL,
  motivo text,
  monto_total numeric(12,2) NOT NULL DEFAULT 0,
  medio_pago text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  nc_cae text,
  nc_vencimiento_cae text,
  nc_numero_comprobante integer,
  nc_tipo text,
  nc_punto_venta integer,
  afip_provider_usado text,
  nc_fecha timestamp with time zone
);

CREATE TABLE public.devoluciones_proveedor (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  numero integer,
  proveedor_id uuid NOT NULL,
  oc_id uuid,
  recepcion_id uuid,
  sucursal_id uuid,
  forma text NOT NULL,
  motivo text NOT NULL,
  observacion text,
  monto numeric NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'confirmada'::text,
  caja_sesion_id uuid,
  oc_reposicion_id uuid,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.emisores_fiscales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  cuit text NOT NULL,
  razon_social_fiscal text,
  condicion_iva_emisor text,
  domicilio_fiscal text,
  ingresos_brutos text,
  inicio_actividades date,
  umbral_factura_b numeric,
  afip_produccion boolean NOT NULL DEFAULT false,
  afip_provider text NOT NULL DEFAULT 'propio'::text,
  afipsdk_token text,
  banco text,
  cbu text,
  alias_cbu text,
  leyenda_comprobante text,
  logo_url text,
  es_default boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  csr_key_path text
);

CREATE TABLE public.empleados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  dni_rut text NOT NULL,
  tipo_doc text DEFAULT 'DNI'::text,
  tel_personal text,
  email_personal text,
  genero text DEFAULT 'OTRO'::text,
  direccion text,
  fon text,
  fecha_nacimiento date,
  fecha_ingreso date NOT NULL,
  fecha_egreso date,
  puesto_id uuid,
  departamento_id uuid,
  supervisor_id uuid,
  tipo_contrato text DEFAULT 'INDEFINIDO'::text,
  salario_bruto numeric(12,2),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  nombre text NOT NULL DEFAULT ''::text,
  apellido text,
  motivo_egreso text,
  cbu text,
  alias_cbu text,
  banco text,
  tipo_cuenta text,
  titular_cuenta text,
  config_aportes jsonb NOT NULL DEFAULT '[]'::jsonb,
  beneficios_extra jsonb NOT NULL DEFAULT '[]'::jsonb,
  horario_entrada time without time zone,
  horario_salida time without time zone,
  dias_laborales jsonb NOT NULL DEFAULT '[1, 2, 3, 4, 5]'::jsonb,
  frecuencia_liquidacion text NOT NULL DEFAULT 'mensual'::text,
  frecuencia_dias integer
);

CREATE TABLE public.envio_incidencias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  envio_id uuid NOT NULL,
  tipo text NOT NULL,
  detalle text,
  reportado_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.envio_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  envio_id uuid NOT NULL,
  producto_id uuid,
  cantidad numeric NOT NULL DEFAULT 0,
  lpn text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.envio_otp (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  envio_id uuid NOT NULL,
  codigo text NOT NULL,
  telefono text,
  enviado_at timestamp with time zone DEFAULT now(),
  verificado_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.envio_pod_fotos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  envio_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  url text NOT NULL,
  storage_path text,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.envios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid,
  venta_id uuid,
  numero integer,
  courier text,
  servicio text,
  tracking_number text,
  tracking_url text,
  estado text DEFAULT 'pendiente'::text,
  canal text,
  destino_id uuid,
  destino_descripcion text,
  peso_kg numeric(8,3),
  largo_cm numeric(8,2),
  ancho_cm numeric(8,2),
  alto_cm numeric(8,2),
  costo_cotizado numeric(12,2),
  costo_real numeric(12,2),
  fecha_entrega_acordada date,
  hora_entrega_acordada time without time zone,
  zona_entrega text,
  etiqueta_url text,
  notas text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  pod_url text,
  pod_fecha date,
  pod_receptor text,
  pod_notas text,
  costo_pagado boolean DEFAULT false,
  fecha_pago_courier date,
  medio_pago_courier text,
  token_transportista text,
  rango_horario_desde time without time zone,
  rango_horario_hasta time without time zone,
  cotizacion_json jsonb,
  courier_orden_id text,
  cotizado_api boolean NOT NULL DEFAULT false,
  gasto_id uuid,
  courier_factura_id uuid,
  pod_firma_url text,
  pod_dni text,
  pod_lat numeric,
  pod_lon numeric,
  pod_geo_estado text,
  pod_otp_verificado boolean NOT NULL DEFAULT false,
  intentos integer NOT NULL DEFAULT 0,
  reintento_motivo text,
  subestado_no_entrega text,
  no_entrega_motivo text,
  repartidor_id uuid,
  token_expira_at timestamp with time zone,
  hoja_ruta_id uuid,
  diferencia_tipo text,
  diferencia_monto numeric,
  diferencia_motivo text,
  tipo text NOT NULL DEFAULT 'venta'::text,
  motivo text,
  sucursal_destino_id uuid,
  recurso_id uuid,
  km_recorridos numeric,
  gasto_combustible_id uuid
);

CREATE TABLE public.estados_inventario (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  color text NOT NULL DEFAULT '#6B7280'::text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  es_devolucion boolean NOT NULL DEFAULT false,
  es_disponible_tn boolean NOT NULL DEFAULT true,
  es_disponible_venta boolean NOT NULL DEFAULT true,
  es_disponible_meli boolean NOT NULL DEFAULT true
);

CREATE TABLE public.gasto_cuotas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  gasto_id uuid NOT NULL,
  numero integer NOT NULL,
  monto numeric(12,2) NOT NULL,
  fecha_vencimiento date NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  fecha_pago date,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.gastos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  descripcion text NOT NULL,
  monto numeric(12,2) NOT NULL,
  categoria text,
  medio_pago text,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  usuario_id uuid,
  notas text,
  created_at timestamp with time zone DEFAULT now(),
  sucursal_id uuid,
  iva_monto numeric(12,2),
  comprobante_url text,
  comprobante_titulo text,
  tipo_iva text,
  iva_deducible boolean DEFAULT false,
  deduce_ganancias boolean DEFAULT false,
  gasto_negocio boolean,
  conciliado_iva boolean DEFAULT false,
  recepcion_id uuid,
  recurso_id uuid,
  es_cuota boolean NOT NULL DEFAULT false,
  cuotas_total integer,
  monto_cuota numeric(12,2),
  tasa_interes numeric(5,2) DEFAULT 0,
  categoria_id uuid,
  alicuota_iva numeric(5,2),
  capitaliza_recurso boolean NOT NULL DEFAULT false,
  gasto_padre_id uuid,
  es_correccion boolean NOT NULL DEFAULT false,
  monto_pagado numeric(12,2) NOT NULL DEFAULT 0,
  estado_pago text NOT NULL DEFAULT 'pagado'::text,
  tipo_comprobante text,
  emisor_id uuid
);

CREATE TABLE public.gastos_fijos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  descripcion text NOT NULL,
  monto numeric(12,2) NOT NULL,
  iva_monto numeric(12,2),
  categoria text,
  medio_pago text,
  frecuencia text NOT NULL DEFAULT 'mensual'::text,
  dia_vencimiento integer,
  activo boolean NOT NULL DEFAULT true,
  notas text,
  sucursal_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  alerta_dias_antes integer DEFAULT 3,
  tipo_iva text,
  iva_deducible boolean DEFAULT false,
  deduce_ganancias boolean DEFAULT false,
  gasto_negocio boolean,
  categoria_id uuid,
  alicuota_iva numeric(5,2),
  tipo_comprobante text
);

CREATE TABLE public.grupo_estado_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL,
  estado_id uuid NOT NULL
);

CREATE TABLE public.grupos_estados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  es_default boolean DEFAULT false,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.hoja_ruta_envios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  hoja_id uuid NOT NULL,
  envio_id uuid NOT NULL,
  orden integer NOT NULL DEFAULT 0
);

CREATE TABLE public.hojas_ruta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  repartidor_id uuid,
  token text,
  sucursal_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.integration_job_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid,
  integracion text NOT NULL,
  tipo text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  endpoint text,
  status text NOT NULL DEFAULT 'pending'::text,
  retries integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 5,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  error_last text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.inventario_conteo_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conteo_id uuid NOT NULL,
  inventario_linea_id uuid,
  producto_id uuid NOT NULL,
  lpn text,
  cantidad_esperada numeric(12,3) NOT NULL DEFAULT 0,
  cantidad_contada numeric(12,3) DEFAULT 0,
  contado_por uuid,
  fuera_de_scope boolean NOT NULL DEFAULT false,
  costo_snapshot numeric,
  cantidad_reconteo numeric,
  reconteo_por uuid
);

CREATE TABLE public.inventario_conteos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tipo text NOT NULL DEFAULT 'ubicacion'::text,
  ubicacion_id uuid,
  producto_id uuid,
  estado text NOT NULL DEFAULT 'borrador'::text,
  notas text,
  ajuste_aplicado boolean DEFAULT false,
  sucursal_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  filtros jsonb DEFAULT '{}'::jsonb,
  modo text NOT NULL DEFAULT 'rapido'::text,
  bloquea_movimientos boolean NOT NULL DEFAULT false
);

CREATE TABLE public.inventario_lineas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  lpn text NOT NULL,
  cantidad integer NOT NULL DEFAULT 0,
  cantidad_reservada integer NOT NULL DEFAULT 0,
  estado_id uuid,
  ubicacion_id uuid,
  proveedor_id uuid,
  nro_lote text,
  fecha_vencimiento date,
  precio_costo_snapshot numeric(14,2),
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  sucursal_id uuid,
  notas text,
  precio_venta_snapshot numeric(14,2),
  estructura_id uuid,
  parent_lpn_id text,
  pais_origen text,
  talle text,
  color text,
  encaje text,
  formato text,
  sabor_aroma text
);

CREATE TABLE public.inventario_meli_map (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  meli_item_id text NOT NULL,
  meli_variation_id bigint,
  sync_stock boolean NOT NULL DEFAULT true,
  sync_precio boolean NOT NULL DEFAULT true,
  ultimo_sync_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.inventario_series (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  linea_id uuid NOT NULL,
  nro_serie text NOT NULL,
  estado_id uuid,
  reservado boolean DEFAULT false,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.inventario_tn_map (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  tn_product_id bigint NOT NULL,
  tn_variant_id bigint,
  sync_stock boolean NOT NULL DEFAULT true,
  sync_precio boolean NOT NULL DEFAULT false,
  ultimo_sync_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.kit_recetas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kit_producto_id uuid NOT NULL,
  comp_producto_id uuid NOT NULL,
  cantidad numeric(12,3) NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.kitting_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kit_producto_id uuid NOT NULL,
  cantidad_kits numeric(12,3) NOT NULL,
  ubicacion_id uuid,
  usuario_id uuid,
  notas text,
  created_at timestamp with time zone DEFAULT now(),
  tipo text DEFAULT 'armado'::text,
  estado text DEFAULT 'completado'::text,
  componentes_reservados jsonb
);

CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  empresa text,
  email text,
  telefono text,
  estado text NOT NULL DEFAULT 'lead'::text,
  valor_estimado numeric(12,2),
  origen text,
  notas text,
  asignado_a uuid,
  tenant_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.meli_credentials (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid,
  seller_id bigint NOT NULL,
  seller_nickname text,
  seller_email text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  conectado boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.mercadopago_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  seller_id bigint NOT NULL,
  seller_email text,
  access_token text NOT NULL,
  refresh_token text,
  public_key text,
  expires_at timestamp with time zone,
  conectado boolean NOT NULL DEFAULT true,
  conectado_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.metodos_pago (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280'::text,
  activo boolean NOT NULL DEFAULT true,
  es_sistema boolean NOT NULL DEFAULT false,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  comision_pct numeric(5,2) DEFAULT 0,
  config jsonb,
  cuenta_origen_id uuid,
  habilitado_ventas boolean NOT NULL DEFAULT true,
  habilitado_gastos boolean NOT NULL DEFAULT true
);

CREATE TABLE public.modo_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  merchant_id text NOT NULL,
  api_key text NOT NULL,
  ambiente text NOT NULL DEFAULT 'test'::text,
  conectado boolean NOT NULL DEFAULT false,
  conectado_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.motivos_movimiento (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'ambos'::text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  es_sistema boolean NOT NULL DEFAULT false
);

CREATE TABLE public.movimientos_stock (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  tipo text NOT NULL,
  cantidad numeric(14,4) NOT NULL,
  stock_antes integer NOT NULL,
  stock_despues integer NOT NULL,
  motivo text,
  estado_id uuid,
  proveedor_id uuid,
  usuario_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  linea_id uuid,
  sucursal_id uuid,
  venta_id uuid,
  gasto_id uuid
);

CREATE TABLE public.mp_billing_alertas (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tipo text NOT NULL,
  preapproval_id text NOT NULL,
  tenant_id uuid,
  detalle jsonb,
  first_seen timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone
);

CREATE TABLE public.notificaciones (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tipo text NOT NULL DEFAULT 'info'::text,
  titulo text NOT NULL,
  mensaje text NOT NULL,
  leida boolean NOT NULL DEFAULT false,
  action_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb
);

CREATE TABLE public.orden_compra_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  orden_compra_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  cantidad numeric(12,3) NOT NULL,
  precio_unitario numeric(12,2),
  notas text
);

CREATE TABLE public.ordenes_compra (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  numero integer NOT NULL,
  estado text NOT NULL DEFAULT 'borrador'::text,
  fecha_esperada date,
  notas text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  estado_pago text NOT NULL DEFAULT 'pendiente_pago'::text,
  monto_total numeric(12,2),
  monto_pagado numeric(12,2) NOT NULL DEFAULT 0,
  fecha_vencimiento_pago date,
  dias_plazo_pago integer,
  condiciones_pago text,
  sucursal_id uuid,
  oc_padre_id uuid,
  es_derivada boolean NOT NULL DEFAULT false,
  tiene_reembolso_pendiente boolean NOT NULL DEFAULT false,
  costo_envio numeric(12,2),
  tiene_envio boolean NOT NULL DEFAULT false,
  comprobante_url text,
  comprobante_titulo text,
  monto_descuento numeric(12,2) NOT NULL DEFAULT 0,
  numero_sucursal integer,
  requiere_aprobacion boolean NOT NULL DEFAULT false,
  aprobada_por uuid,
  aprobada_at timestamp with time zone,
  costo_aduana numeric,
  costo_comision numeric,
  costo_otros numeric,
  paga_con_anticipo boolean NOT NULL DEFAULT false,
  anticipo_pct numeric,
  pago_schedule jsonb
);

CREATE TABLE public.planes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  max_users integer NOT NULL DEFAULT 2,
  precio_mensual numeric(10,2) NOT NULL,
  mp_plan_id text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.platform_billers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  cuit bigint NOT NULL,
  razon_social_fiscal text NOT NULL,
  domicilio_fiscal text NOT NULL,
  condicion_iva_emisor text NOT NULL DEFAULT 'Monotributista'::text,
  punto_venta integer NOT NULL,
  afip_provider text NOT NULL DEFAULT 'afipsdk'::text,
  afipsdk_token text,
  afip_produccion boolean NOT NULL DEFAULT false,
  cert_crt_path text,
  cert_key_path text,
  umbral_facturacion_anual numeric(14,2),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_facturas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  biller_id uuid NOT NULL,
  tenant_origen_id uuid,
  monto numeric(12,2) NOT NULL,
  concepto text NOT NULL,
  punto_venta integer NOT NULL,
  numero_comprobante integer NOT NULL,
  tipo_comprobante text NOT NULL DEFAULT 'C'::text,
  cae text NOT NULL,
  cae_vencimiento text NOT NULL,
  afip_provider_usado text NOT NULL,
  origen_pago text NOT NULL,
  payment_ref text,
  error_detalle text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_facturas_claims (
  payment_ref text NOT NULL,
  claimed_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.producto_estructuras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  nombre text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  unidades_por_caja integer,
  cajas_por_pallet integer,
  peso_unidad numeric(10,4),
  alto_unidad numeric(10,2),
  ancho_unidad numeric(10,2),
  largo_unidad numeric(10,2),
  peso_caja numeric(10,4),
  alto_caja numeric(10,2),
  ancho_caja numeric(10,2),
  largo_caja numeric(10,2),
  peso_pallet numeric(10,4),
  alto_pallet numeric(10,2),
  ancho_pallet numeric(10,2),
  largo_pallet numeric(10,2),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.producto_grupos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  imagen_url text,
  precio_base numeric DEFAULT 0,
  categoria_id uuid,
  atributos jsonb NOT NULL DEFAULT '[]'::jsonb,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.producto_precios_mayorista (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  cantidad_minima integer NOT NULL,
  precio numeric(12,2) NOT NULL,
  descripcion text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.producto_stock_minimo_sucursal (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  stock_minimo integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.producto_ubicacion_sucursal (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  ubicacion_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.productos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  sku text NOT NULL,
  descripcion text,
  categoria_id uuid,
  proveedor_id uuid,
  ubicacion_id uuid,
  estado_id uuid,
  precio_costo numeric(12,2) DEFAULT 0,
  precio_venta numeric(12,2) DEFAULT 0,
  margen_ganancia numeric(5,2) DEFAULT 
CASE
    WHEN (precio_costo > (0)::numeric) THEN round((((precio_venta - precio_costo) / precio_costo) * (100)::numeric), 2)
    ELSE (0)::numeric
END,
  stock_actual integer NOT NULL DEFAULT 0,
  stock_minimo integer NOT NULL DEFAULT 0,
  unidad_medida text DEFAULT 'unidad'::text,
  codigo_barras text,
  imagen_url text,
  tiene_series boolean DEFAULT false,
  tiene_lote boolean DEFAULT false,
  tiene_vencimiento boolean DEFAULT false,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  precio_costo_moneda character varying(3) NOT NULL DEFAULT 'ARS'::character varying,
  precio_venta_moneda character varying(3) NOT NULL DEFAULT 'ARS'::character varying,
  regla_inventario text,
  aging_profile_id uuid,
  margen_objetivo numeric(5,2),
  publicado_marketplace boolean DEFAULT false,
  precio_marketplace numeric(12,2),
  stock_reservado_marketplace integer DEFAULT 0,
  descripcion_marketplace text,
  es_kit boolean DEFAULT false,
  alicuota_iva numeric(5,2) NOT NULL DEFAULT 21,
  marca text,
  shelf_life_dias integer,
  tiene_pais_origen boolean NOT NULL DEFAULT false,
  tiene_talle boolean NOT NULL DEFAULT false,
  tiene_color boolean NOT NULL DEFAULT false,
  tiene_encaje boolean NOT NULL DEFAULT false,
  tiene_formato boolean NOT NULL DEFAULT false,
  tiene_sabor_aroma boolean NOT NULL DEFAULT false,
  grupo_id uuid,
  variante_valores jsonb,
  gtin text,
  precio_usd numeric(12,2),
  moneda_venta text NOT NULL DEFAULT 'local'::text,
  peso_kg numeric(10,3),
  largo_cm numeric(10,2),
  ancho_cm numeric(10,2),
  alto_cm numeric(10,2),
  clase_abc text,
  clase_abc_manual boolean NOT NULL DEFAULT false,
  ultimo_conteo_at timestamp with time zone,
  pendiente_revision boolean NOT NULL DEFAULT false
);

CREATE TABLE public.proveedor_cc_movimientos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  oc_id uuid,
  tipo text NOT NULL,
  monto numeric(12,2) NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento date,
  medio_pago text,
  descripcion text,
  caja_sesion_id uuid,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  nc_numero text,
  adjunto_url text
);

CREATE TABLE public.proveedor_contactos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  nombre text NOT NULL,
  puesto text,
  email text,
  telefono text,
  es_principal boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.proveedor_cuentas_bancarias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  banco text,
  titular text,
  cbu text,
  alias text,
  cuenta text,
  es_principal boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.proveedor_productos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  precio_compra numeric(12,2),
  cantidad_minima integer DEFAULT 1,
  costo_envio numeric(12,2),
  costos_extra numeric(12,2),
  notas text
);

CREATE TABLE public.proveedores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  contacto text,
  telefono text,
  email text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  razon_social text,
  cuit text,
  domicilio text,
  condicion_iva text,
  plazo_pago_dias integer,
  banco text,
  cbu text,
  notas text,
  sucursal_id uuid,
  tipo text DEFAULT 'proveedor'::text,
  dni text,
  codigo_fiscal text,
  regimen_fiscal text,
  etiquetas text[],
  cuenta_corriente_habilitada boolean NOT NULL DEFAULT false,
  limite_credito_proveedor numeric(12,2),
  modo_pago text NOT NULL DEFAULT 'contado'::text,
  anticipo_pct numeric
);

CREATE TABLE public.puntos_venta_afip (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid,
  numero integer NOT NULL,
  nombre text,
  activo boolean DEFAULT true,
  emisor_id uuid
);

CREATE TABLE public.recepcion_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recepcion_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  oc_item_id uuid,
  cantidad_esperada numeric(12,3) DEFAULT 0,
  cantidad_recibida numeric(12,3) NOT NULL DEFAULT 0,
  estado_id uuid,
  ubicacion_id uuid,
  nro_lote text,
  fecha_vencimiento date,
  lpn text,
  series_txt text,
  inventario_linea_id uuid,
  precio_costo numeric(14,2),
  motivo_faltante text
);

CREATE TABLE public.recepciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  numero integer NOT NULL DEFAULT 0,
  oc_id uuid,
  proveedor_id uuid,
  estado text NOT NULL DEFAULT 'borrador'::text,
  notas text,
  sucursal_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  remito_url text
);

CREATE TABLE public.recursos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  categoria text NOT NULL DEFAULT 'otro'::text,
  estado text NOT NULL DEFAULT 'activo'::text,
  valor numeric(12,2),
  fecha_adquisicion date,
  proveedor_id uuid,
  ubicacion text,
  numero_serie text,
  garantia_hasta date,
  notas text,
  sucursal_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  es_recurrente boolean NOT NULL DEFAULT false,
  frecuencia_valor integer,
  frecuencia_unidad text,
  proximo_vencimiento date,
  km_acumulado numeric NOT NULL DEFAULT 0,
  consumo_litros_100km numeric
);

CREATE TABLE public.repartidores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  empleado_id uuid,
  telefono text,
  vehiculo text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.retenciones_sufridas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tipo text,
  agente text,
  monto numeric(12,2),
  fecha date DEFAULT CURRENT_DATE,
  periodo text,
  certificado_url text,
  notas text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.roles_custom (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  permisos jsonb NOT NULL DEFAULT '{}'::jsonb,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_anticipos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  monto numeric NOT NULL DEFAULT 0,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  motivo text,
  gasto_id uuid,
  descontado_en_salario_id uuid,
  saldado boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  es_prestamo boolean NOT NULL DEFAULT false,
  documento_url text
);

CREATE TABLE public.rrhh_asistencia (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  fecha date NOT NULL,
  hora_entrada time without time zone,
  hora_salida time without time zone,
  estado text NOT NULL DEFAULT 'presente'::text,
  motivo text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  tipo_licencia text,
  comprobante_url text,
  minutos_tarde integer
);

CREATE TABLE public.rrhh_capacitaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  fecha_inicio date,
  fecha_fin date,
  horas numeric(6,2),
  proveedor text,
  estado text DEFAULT 'planificada'::text,
  resultado text,
  certificado_path text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  obligatoria boolean NOT NULL DEFAULT false
);

CREATE TABLE public.rrhh_conceptos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  pais text,
  predefinido boolean NOT NULL DEFAULT false,
  tipo_calculo text NOT NULL DEFAULT 'fijo'::text,
  default_pct numeric,
  default_monto numeric,
  es_aporte boolean NOT NULL DEFAULT false
);

CREATE TABLE public.rrhh_departamentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_documentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  tipo text DEFAULT 'otro'::text,
  storage_path text NOT NULL,
  tamanio bigint,
  mime_type text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  fecha_vencimiento date,
  catalogo_id uuid
);

CREATE TABLE public.rrhh_documentos_catalogo (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  obligatorio boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_evaluaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  periodo text NOT NULL,
  tipo text NOT NULL DEFAULT 'supervisor'::text,
  evaluador_id uuid,
  puntaje integer,
  comentarios text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_feriados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  fecha date NOT NULL,
  tipo text DEFAULT 'nacional'::text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  regla_pago text NOT NULL DEFAULT 'doble'::text
);

CREATE TABLE public.rrhh_fichadas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  sucursal_id uuid,
  tipo text NOT NULL,
  ts timestamp with time zone NOT NULL DEFAULT now(),
  origen text NOT NULL DEFAULT 'manual'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_horas_extra (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  fecha date NOT NULL,
  horas numeric NOT NULL DEFAULT 0,
  multiplicador integer NOT NULL DEFAULT 50,
  aprobada boolean NOT NULL DEFAULT false,
  aprobada_por uuid,
  notas text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_liquidaciones_finales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  fecha_egreso date,
  motivo_egreso text,
  antiguedad_anios integer,
  mejor_sueldo numeric,
  indemnizacion numeric NOT NULL DEFAULT 0,
  sac_proporcional numeric NOT NULL DEFAULT 0,
  vacaciones_no_gozadas numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  gasto_id uuid,
  notas text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_puestos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  salario_base_sugerido numeric(12,2),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_salario_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  salario_id uuid NOT NULL,
  concepto_id uuid,
  descripcion text NOT NULL,
  tipo text NOT NULL,
  monto numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.rrhh_salarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  periodo date NOT NULL,
  basico numeric(12,2) NOT NULL DEFAULT 0,
  total_haberes numeric(12,2) NOT NULL DEFAULT 0,
  total_descuentos numeric(12,2) NOT NULL DEFAULT 0,
  neto numeric(12,2) NOT NULL DEFAULT 0,
  pagado boolean NOT NULL DEFAULT false,
  fecha_pago timestamp with time zone,
  caja_movimiento_id uuid,
  notas text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  medio_pago text DEFAULT 'efectivo'::text,
  gasto_id uuid,
  comprobante_firmado_url text
);

CREATE TABLE public.rrhh_tipos_contrato (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  es_relacion_dependencia boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  predefinido boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_vacaciones_saldo (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  anio integer NOT NULL,
  dias_totales integer NOT NULL DEFAULT 0,
  dias_usados integer NOT NULL DEFAULT 0,
  remanente_anterior integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rrhh_vacaciones_solicitud (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  desde date NOT NULL,
  hasta date NOT NULL,
  dias_habiles integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  notas text,
  aprobado_por uuid,
  aprobado_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  preaprobado_por uuid,
  preaprobado_at timestamp with time zone
);

CREATE TABLE public.servicio_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid,
  nombre text NOT NULL,
  detalle text,
  costo numeric(12,2),
  forma_pago text,
  hace_factura boolean DEFAULT false,
  notas text,
  created_at timestamp with time zone DEFAULT now(),
  recurrente boolean NOT NULL DEFAULT false,
  frecuencia text,
  proximo_vencimiento date,
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE public.servicio_presupuestos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  servicio_item_id uuid,
  nombre text,
  fecha date DEFAULT CURRENT_DATE,
  monto numeric(12,2),
  archivo_url text,
  notas text,
  created_at timestamp with time zone DEFAULT now(),
  estado text DEFAULT 'pendiente'::text,
  gasto_id uuid
);

CREATE TABLE public.sucursales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  direccion text,
  telefono text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  costo_km_envio numeric(10,2) DEFAULT 0,
  codigo text,
  codigo_postal text,
  email text,
  horario_apertura time without time zone,
  horario_cierre time without time zone,
  punto_venta_afip integer,
  umbral_gasto_supervisor numeric(12,2),
  umbral_gasto_cajero numeric(12,2),
  emisor_fiscal_id uuid
);

CREATE TABLE public.support_agents (
  id uuid NOT NULL,
  email text NOT NULL,
  nombre text,
  rol text NOT NULL DEFAULT 'support'::text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  autor_tipo text NOT NULL DEFAULT 'agente'::text,
  autor_id uuid,
  cuerpo text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.support_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asunto text NOT NULL,
  estado text NOT NULL DEFAULT 'abierto'::text,
  prioridad text NOT NULL DEFAULT 'media'::text,
  canal text NOT NULL DEFAULT 'manual'::text,
  asignado_a uuid,
  creado_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  closed_at timestamp with time zone
);

CREATE TABLE public.tenant_addons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dimension text NOT NULL,
  cantidad integer NOT NULL,
  tipo text NOT NULL,
  vence_at timestamp with time zone,
  mp_payment_id text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.tenant_certificates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cert_crt_path text NOT NULL,
  cert_key_path text NOT NULL,
  cuit text,
  fecha_validez_hasta date,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  emisor_id uuid
);

CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  tipo_comercio text,
  pais text DEFAULT 'AR'::text,
  subscription_status text NOT NULL DEFAULT 'trial'::text,
  trial_ends_at timestamp with time zone NOT NULL DEFAULT (now() + '30 days'::interval),
  plan_id uuid,
  max_users integer NOT NULL DEFAULT 2,
  max_productos integer NOT NULL DEFAULT 50,
  mp_subscription_id text,
  logo_url text,
  cotizacion_usd numeric(14,2),
  cotizacion_usd_updated_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  regla_inventario text NOT NULL DEFAULT 'FIFO'::text,
  marketplace_activo boolean DEFAULT false,
  marketplace_webhook_url text,
  addon_movimientos integer DEFAULT 0,
  session_timeout_minutes integer,
  permite_over_receipt boolean NOT NULL DEFAULT false,
  presupuesto_validez_dias integer DEFAULT 30,
  facturacion_habilitada boolean DEFAULT false,
  condicion_iva_emisor text,
  razon_social_fiscal text,
  domicilio_fiscal text,
  umbral_factura_b numeric(12,2) DEFAULT 68305.16,
  afipsdk_token text,
  cuit text,
  whatsapp_plantilla text,
  costo_envio_por_km numeric(10,2),
  caja_fuerte_roles text[] DEFAULT ARRAY['DUEÑO'::text, 'SUPERVISOR'::text, 'ADMIN'::text],
  cuotas_bancos jsonb,
  precio_redondeo text NOT NULL DEFAULT 'none'::text,
  cliente_obligatorio text NOT NULL DEFAULT 'nunca'::text,
  cliente_datos_minimos text NOT NULL DEFAULT 'nombre'::text,
  cliente_consumidor_final boolean NOT NULL DEFAULT true,
  cliente_creacion_inline boolean NOT NULL DEFAULT true,
  descuento_max_supervisor_pct numeric(5,2),
  clave_maestra text,
  boveda_umbral_caja numeric(12,2),
  gastos_comp_si_iva boolean NOT NULL DEFAULT false,
  gastos_comp_si_monto boolean NOT NULL DEFAULT false,
  gastos_comp_monto_umbral numeric(12,2),
  gastos_comp_si_deduce_ganancias boolean NOT NULL DEFAULT false,
  gastos_comp_siempre boolean NOT NULL DEFAULT true,
  gastos_dias_alerta_borrador integer NOT NULL DEFAULT 7,
  gastos_dias_alerta_anticipo_oc integer NOT NULL DEFAULT 15,
  moneda text NOT NULL DEFAULT 'ARS'::text,
  config_caja jsonb NOT NULL DEFAULT '{}'::jsonb,
  diferencia_caja_umbral numeric(14,2),
  diferencia_caja_alerta_roles text[] DEFAULT ARRAY['DUEÑO'::text, 'SUPERVISOR'::text],
  diferencia_caja_alerta_canales text[] DEFAULT ARRAY['inapp'::text, 'email'::text],
  envio_rangos_horarios jsonb NOT NULL DEFAULT '[{"desde": "08:00", "hasta": "13:00"}, {"desde": "13:00", "hasta": "18:00"}, {"desde": "18:00", "hasta": "22:00"}]'::jsonb,
  trazabilidad_asignacion boolean NOT NULL DEFAULT true,
  reserva_sena_obligatoria boolean NOT NULL DEFAULT true,
  reserva_sena_minima_pct numeric(5,2) NOT NULL DEFAULT 0,
  reserva_vencimiento_dias integer,
  reserva_penalidad_pct numeric(5,2) NOT NULL DEFAULT 0,
  envio_peso_fuente text NOT NULL DEFAULT 'manual'::text,
  reglas_canal jsonb NOT NULL DEFAULT '{}'::jsonb,
  alerta_margen_negativo boolean NOT NULL DEFAULT true,
  alerta_devoluciones_n integer,
  alerta_devoluciones_dias integer NOT NULL DEFAULT 30,
  cliente_etiquetas_catalogo text[] NOT NULL DEFAULT ARRAY[]::text[],
  limite_cc_default numeric(12,2),
  cc_enforcement_politica text NOT NULL DEFAULT 'avisar'::text,
  cc_morosidad_politica text NOT NULL DEFAULT 'bloqueo_cc'::text,
  cc_dias_vencimiento integer,
  cc_interes_mensual_pct numeric(6,3) NOT NULL DEFAULT 0,
  cc_notif_canales text[] NOT NULL DEFAULT ARRAY['whatsapp'::text],
  cc_notif_registro_deuda boolean NOT NULL DEFAULT false,
  cc_notif_pago boolean NOT NULL DEFAULT false,
  cc_notif_pre_venc_dias integer DEFAULT 3,
  cc_notif_escalado_dias integer,
  cumple_notif_cliente boolean NOT NULL DEFAULT false,
  cumple_notif_duenio boolean NOT NULL DEFAULT false,
  conteo_modo text NOT NULL DEFAULT 'rapido'::text,
  conteo_gate_activo boolean NOT NULL DEFAULT false,
  conteo_gate_umbral_u numeric,
  conteo_gate_umbral_pct numeric,
  conteo_gate_umbral_valor numeric,
  conteo_reconteo_umbral_u numeric,
  conteo_reconteo_umbral_pct numeric,
  conteo_reconteo_umbral_valor numeric,
  conteo_ciclico_dias_a integer NOT NULL DEFAULT 30,
  conteo_ciclico_dias_b integer NOT NULL DEFAULT 90,
  conteo_ciclico_dias_c integer NOT NULL DEFAULT 180,
  conteo_wall_to_wall_bloquea boolean NOT NULL DEFAULT false,
  oc_aprobacion_activa boolean NOT NULL DEFAULT false,
  oc_aprobacion_umbral numeric,
  oc_numeracion text NOT NULL DEFAULT 'sucursal'::text,
  oc_pago_doble_firma_umbral numeric,
  over_receipt_pct_max numeric,
  recepcion_remito_obligatorio boolean NOT NULL DEFAULT false,
  compras_costo_alerta_pct numeric NOT NULL DEFAULT 10,
  cheques_alerta_dias integer NOT NULL DEFAULT 7,
  envio_courier_genera_gasto boolean NOT NULL DEFAULT true,
  envio_courier_iva_pct numeric NOT NULL DEFAULT 21,
  envio_pago_doble_firma_umbral numeric NOT NULL DEFAULT 0,
  pod_campos_requeridos jsonb NOT NULL DEFAULT '{"dni": false, "foto": false, "fecha": true, "firma": false, "receptor": true}'::jsonb,
  pod_foto_min integer NOT NULL DEFAULT 0,
  pod_otp_umbral numeric NOT NULL DEFAULT 0,
  envio_geoloc_alerta_km numeric NOT NULL DEFAULT 0,
  envio_reintentos_max integer NOT NULL DEFAULT 3,
  envio_reintento_recargo numeric NOT NULL DEFAULT 0,
  envio_token_politica text NOT NULL DEFAULT 'al_entregar'::text,
  envio_token_dias integer NOT NULL DEFAULT 30,
  envio_identidad_modo text NOT NULL DEFAULT 'anonimo'::text,
  envio_notif_en_camino text NOT NULL DEFAULT 'wa'::text,
  envio_hoja_ruta_modo text NOT NULL DEFAULT 'agrupada'::text,
  envio_factor_km numeric NOT NULL DEFAULT 1.35,
  envio_costo_minimo numeric NOT NULL DEFAULT 0,
  envio_tramos jsonb NOT NULL DEFAULT '[]'::jsonb,
  envio_recargo_horario jsonb NOT NULL DEFAULT '[]'::jsonb,
  envio_cobro_politica text NOT NULL DEFAULT 'cliente_100'::text,
  envio_cobro_margen_pct numeric NOT NULL DEFAULT 0,
  envio_subsidio_umbral numeric NOT NULL DEFAULT 0,
  envio_gratis_reglas jsonb NOT NULL DEFAULT '{}'::jsonb,
  cp_courier_preferido jsonb NOT NULL DEFAULT '[]'::jsonb,
  envio_plazo_despacho jsonb NOT NULL DEFAULT '{}'::jsonb,
  envio_combustible_precio_litro numeric NOT NULL DEFAULT 0,
  envio_alerta_sin_despacho_horas integer NOT NULL DEFAULT 24,
  envio_alerta_pod_pendiente_dias integer NOT NULL DEFAULT 3,
  envio_alerta_pago_courier_dias integer NOT NULL DEFAULT 7,
  envio_alerta_diferencia_pct numeric NOT NULL DEFAULT 15,
  rrhh_nomina_doble_validacion boolean NOT NULL DEFAULT false,
  rrhh_nomina_supervisor_aprueba boolean NOT NULL DEFAULT false,
  rrhh_tardanza_modo text NOT NULL DEFAULT 'registrar'::text,
  rrhh_tardanza_tolerancia_min integer NOT NULL DEFAULT 0,
  rrhh_horas_extra_requiere_aprobacion boolean NOT NULL DEFAULT true,
  rrhh_horas_mes_base integer NOT NULL DEFAULT 200,
  rrhh_vacaciones_flujo jsonb NOT NULL DEFAULT '{"rrhh": "aprueba", "supervisor": "preaprueba"}'::jsonb,
  rrhh_vacaciones_aviso jsonb NOT NULL DEFAULT '{"dias": 30, "modo": "alerta"}'::jsonb,
  rrhh_vacaciones_remanente_max integer NOT NULL DEFAULT 0,
  rrhh_vacaciones_min_bloque integer NOT NULL DEFAULT 0,
  rrhh_vacaciones_max_bloques integer NOT NULL DEFAULT 0,
  rrhh_portal_empleado boolean NOT NULL DEFAULT false,
  rrhh_portal_capacidades jsonb NOT NULL DEFAULT '{"firma": false, "recibos": true, "documentos": false, "vacaciones": true}'::jsonb,
  rrhh_notif_config jsonb NOT NULL DEFAULT '{"cumpleanos": true, "doc_vencer": true, "aniversario": true, "contrato_vencer": true, "vacaciones_proximas": true}'::jsonb,
  rrhh_doc_alerta_dias integer NOT NULL DEFAULT 30,
  fichado_token text,
  modo_operacion text NOT NULL DEFAULT 'basico'::text,
  afip_produccion boolean NOT NULL DEFAULT false,
  ingresos_brutos text,
  inicio_actividades date,
  cbu text,
  alias_cbu text,
  banco text,
  leyenda_comprobante text,
  sitio_web text,
  ajuste_autorizacion_roles jsonb,
  recepcion_alerta_faltante_dias integer NOT NULL DEFAULT 7,
  terminos_aceptados_at timestamp with time zone,
  terminos_version text,
  marketing_consent boolean NOT NULL DEFAULT false,
  afip_provider text NOT NULL DEFAULT 'propio'::text,
  plan_tier text NOT NULL DEFAULT 'free'::text,
  subscription_period_end timestamp with time zone,
  primera_compra_at timestamp with time zone,
  billing_mode text NOT NULL DEFAULT 'auto'::text,
  manual_monto_mensual numeric(12,2),
  manual_paid_until timestamp with time zone,
  manual_ultimo_recordatorio_tipo text,
  manual_ultimo_recordatorio_at timestamp with time zone
);

CREATE TABLE public.tiendanube_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  store_id bigint NOT NULL,
  store_name text,
  store_url text,
  access_token text NOT NULL,
  conectado boolean NOT NULL DEFAULT true,
  conectado_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.traslado_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  traslado_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  linea_origen_id uuid,
  linea_destino_id uuid,
  lpn text,
  nro_lote text,
  fecha_vencimiento date,
  estado_id uuid,
  precio_costo_snapshot numeric(14,2),
  series jsonb,
  cantidad numeric(14,4) NOT NULL,
  cantidad_recibida numeric(14,4),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  talle text,
  color text,
  encaje text,
  formato text,
  sabor_aroma text,
  ubicacion_sugerida_id uuid
);

CREATE TABLE public.traslados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  numero integer,
  sucursal_origen_id uuid NOT NULL,
  sucursal_destino_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'en_transito'::text,
  notas text,
  envio_id uuid,
  despachado_por uuid,
  despachado_at timestamp with time zone NOT NULL DEFAULT now(),
  recibido_por uuid,
  recibido_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.ubicaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  prioridad integer NOT NULL DEFAULT 0,
  disponible_surtido boolean NOT NULL DEFAULT true,
  es_devolucion boolean NOT NULL DEFAULT false,
  tipo_ubicacion text,
  alto_cm numeric(8,2),
  ancho_cm numeric(8,2),
  largo_cm numeric(8,2),
  peso_max_kg numeric(8,2),
  capacidad_pallets integer,
  mono_sku boolean DEFAULT false,
  disponible_tn boolean NOT NULL DEFAULT true,
  disponible_meli boolean NOT NULL DEFAULT true,
  sucursal_id uuid,
  secuencia integer
);

CREATE TABLE public.unidades_medida (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nombre text NOT NULL,
  simbolo text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  predefinida boolean NOT NULL DEFAULT false
);

CREATE TABLE public.users (
  id uuid NOT NULL,
  tenant_id uuid,
  rol text NOT NULL DEFAULT 'CAJERO'::text,
  nombre_display text,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  avatar_url text,
  rol_custom_id uuid,
  sucursal_id uuid,
  puede_ver_todas boolean NOT NULL DEFAULT false,
  caja_preferida_id uuid
);

CREATE TABLE public.venta_auditoria (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  venta_id uuid NOT NULL,
  accion text NOT NULL,
  detalle jsonb,
  usuario_id uuid,
  usuario_nombre text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.venta_item_despachos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  venta_id uuid NOT NULL,
  venta_item_id uuid NOT NULL,
  producto_id uuid,
  linea_id uuid,
  lpn text,
  ubicacion_id uuid,
  ubicacion_nombre text,
  cantidad numeric NOT NULL,
  nro_serie text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  origen text,
  talle text,
  color text,
  encaje text,
  formato text,
  sabor_aroma text
);

CREATE TABLE public.venta_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  venta_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  linea_id uuid,
  cantidad numeric(14,4) NOT NULL DEFAULT 1,
  precio_unitario numeric(12,2) NOT NULL,
  descuento numeric(5,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL,
  precio_costo_historico numeric(14,2),
  created_at timestamp with time zone DEFAULT now(),
  alicuota_iva numeric(5,2),
  iva_monto numeric(12,2),
  lpn_plan jsonb
);

CREATE TABLE public.venta_series (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  venta_id uuid NOT NULL,
  venta_item_id uuid NOT NULL,
  serie_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ventas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  numero integer NOT NULL,
  cliente_id uuid,
  cliente_nombre text,
  cliente_telefono text,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  descuento_total numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  medio_pago text,
  notas text,
  usuario_id uuid,
  despachado_at timestamp with time zone,
  cancelado_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  sucursal_id uuid,
  monto_pagado numeric(12,2) NOT NULL DEFAULT 0,
  origen text DEFAULT 'POS'::text,
  tracking_id text,
  tracking_url text,
  costo_envio_logistica numeric(12,2),
  marketing_metadata jsonb,
  id_pago_externo text,
  money_release_date date,
  cae character varying,
  vencimiento_cae date,
  tipo_comprobante text,
  numero_comprobante text,
  link_factura_pdf text,
  es_cuenta_corriente boolean DEFAULT false,
  costo_envio numeric(12,2),
  numero_sucursal integer,
  cuotas_info jsonb,
  presupuesto_numero integer,
  presupuesto_numero_sucursal integer,
  reservado_at timestamp with time zone,
  consumidor_final boolean NOT NULL DEFAULT true,
  fecha_vencimiento_cc date,
  interes_cc numeric(12,2) NOT NULL DEFAULT 0,
  afip_provider_usado text,
  emisor_id uuid
);

CREATE TABLE public.ventas_externas_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  integracion text NOT NULL,
  webhook_external_id text NOT NULL,
  venta_id uuid,
  payload_raw jsonb,
  procesado_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.ventas_recurrentes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sucursal_id uuid,
  cliente_id uuid,
  cliente_nombre text,
  nombre text NOT NULL,
  frecuencia_dias integer NOT NULL DEFAULT 30,
  proximo_at date NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  notas text,
  ultima_generada_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- ============================================================
-- CONSTRAINTS (PK / UNIQUE / CHECK / FK)
-- ============================================================
ALTER TABLE public.actividad_log ADD CONSTRAINT actividad_log_pkey PRIMARY KEY (id);
ALTER TABLE public.addon_batch_changes ADD CONSTRAINT addon_batch_changes_estado_check CHECK ((estado = ANY (ARRAY['pendiente_pago'::text, 'programado'::text, 'esperando_cobro'::text, 'aplicado'::text, 'cancelado'::text, 'fallido'::text])));
ALTER TABLE public.addon_batch_changes ADD CONSTRAINT addon_batch_changes_pkey PRIMARY KEY (id);
ALTER TABLE public.addon_batch_changes ADD CONSTRAINT addon_batch_changes_plan_objetivo_check CHECK ((plan_objetivo = ANY (ARRAY['basico'::text, 'pro'::text])));
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.afip_wsaa_ta ADD CONSTRAINT afip_wsaa_ta_cuit_service_environment_key UNIQUE (cuit, service, environment);
ALTER TABLE public.afip_wsaa_ta ADD CONSTRAINT afip_wsaa_ta_environment_check CHECK ((environment = ANY (ARRAY['homologacion'::text, 'produccion'::text])));
ALTER TABLE public.afip_wsaa_ta ADD CONSTRAINT afip_wsaa_ta_pkey PRIMARY KEY (id);
ALTER TABLE public.aging_profile_reglas ADD CONSTRAINT aging_profile_reglas_dias_check CHECK ((dias >= 0));
ALTER TABLE public.aging_profile_reglas ADD CONSTRAINT aging_profile_reglas_pkey PRIMARY KEY (id);
ALTER TABLE public.aging_profiles ADD CONSTRAINT aging_profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.alertas ADD CONSTRAINT alertas_pkey PRIMARY KEY (id);
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE public.archivos_biblioteca ADD CONSTRAINT archivos_biblioteca_pkey PRIMARY KEY (id);
ALTER TABLE public.archivos_biblioteca ADD CONSTRAINT archivos_biblioteca_tipo_check CHECK ((tipo = ANY (ARRAY['certificado_afip_crt'::text, 'certificado_afip_key'::text, 'contrato'::text, 'factura_proveedor'::text, 'manual'::text, 'otro'::text])));
ALTER TABLE public.atributos_variante_valores ADD CONSTRAINT atributos_variante_valores_pkey PRIMARY KEY (id);
ALTER TABLE public.atributos_variante_valores ADD CONSTRAINT atributos_variante_valores_atributo_check CHECK ((atributo = ANY (ARRAY['talle'::text, 'color'::text, 'encaje'::text, 'formato'::text, 'sabor_aroma'::text])));
ALTER TABLE public.atributos_variante_valores ADD CONSTRAINT atributos_variante_valores_valor_check CHECK ((btrim(valor) <> ''::text));
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'cancelada'::text])));
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_motivo_bloqueo_check CHECK ((motivo_bloqueo = ANY (ARRAY['limite_excedido'::text, 'oc_vencida'::text])));
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_pkey PRIMARY KEY (id);
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'cancelada'::text])));
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_pkey PRIMARY KEY (id);
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_tipo_check CHECK ((tipo = ANY (ARRAY['crear'::text, 'editar'::text, 'eliminar'::text])));
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text])));
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_pkey PRIMARY KEY (id);
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_tipo_check CHECK ((tipo = ANY (ARRAY['ajuste_cantidad'::text, 'eliminar_serie'::text, 'eliminar_lpn'::text, 'bulk_edit'::text, 'ajuste_conteo'::text])));
ALTER TABLE public.billing_cancelaciones ADD CONSTRAINT billing_cancelaciones_pkey PRIMARY KEY (id);
ALTER TABLE public.billing_cancelaciones ADD CONSTRAINT billing_cancelaciones_tipo_check CHECK ((tipo = ANY (ARRAY['arrepentimiento'::text, 'cancelacion_estandar'::text])));
ALTER TABLE public.billing_manual_pagos ADD CONSTRAINT billing_manual_pagos_medio_check CHECK ((medio = ANY (ARRAY['transferencia'::text, 'efectivo'::text, 'tarjeta_mp'::text, 'otro'::text])));
ALTER TABLE public.billing_manual_pagos ADD CONSTRAINT billing_manual_pagos_pkey PRIMARY KEY (id);
ALTER TABLE public.boveda_arqueos ADD CONSTRAINT boveda_arqueos_pkey PRIMARY KEY (id);
ALTER TABLE public.boveda_retiros ADD CONSTRAINT boveda_retiros_monto_check CHECK ((monto > (0)::numeric));
ALTER TABLE public.boveda_retiros ADD CONSTRAINT boveda_retiros_pkey PRIMARY KEY (id);
ALTER TABLE public.boveda_retiros ADD CONSTRAINT boveda_retiros_tipo_retiro_check CHECK ((tipo_retiro = ANY (ARRAY['banco'::text, 'retiro_personal'::text, 'gasto'::text, 'inversion'::text, 'pago_proveedor'::text, 'otro'::text])));
ALTER TABLE public.caja_arqueos ADD CONSTRAINT caja_arqueos_pkey PRIMARY KEY (id);
ALTER TABLE public.caja_movimientos ADD CONSTRAINT caja_movimientos_pkey PRIMARY KEY (id);
ALTER TABLE public.caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_check CHECK ((tipo ~ '^(ingreso|egreso)(_[a-z]+)*$'::text));
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_estado_check CHECK ((estado = ANY (ARRAY['abierta'::text, 'cerrada'::text])));
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_pkey PRIMARY KEY (id);
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_monto_check CHECK ((monto > (0)::numeric));
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_pkey PRIMARY KEY (id);
ALTER TABLE public.cajas ADD CONSTRAINT cajas_pkey PRIMARY KEY (id);
ALTER TABLE public.canales_venta ADD CONSTRAINT canales_venta_clasificacion_check CHECK ((clasificacion = ANY (ARRAY['online'::text, 'presencial'::text])));
ALTER TABLE public.canales_venta ADD CONSTRAINT canales_venta_pkey PRIMARY KEY (id);
ALTER TABLE public.canales_venta ADD CONSTRAINT canales_venta_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.categorias ADD CONSTRAINT categorias_pkey PRIMARY KEY (id);
ALTER TABLE public.categorias_gasto ADD CONSTRAINT categorias_gasto_pkey PRIMARY KEY (id);
ALTER TABLE public.categorias_gasto ADD CONSTRAINT categorias_gasto_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.cheques ADD CONSTRAINT cheques_estado_check CHECK ((estado = ANY (ARRAY['en_cartera'::text, 'entregado'::text, 'depositado'::text, 'cobrado'::text, 'endosado'::text, 'rechazado'::text, 'anulado'::text])));
ALTER TABLE public.cheques ADD CONSTRAINT cheques_pkey PRIMARY KEY (id);
ALTER TABLE public.cheques ADD CONSTRAINT cheques_tipo_check CHECK ((tipo = ANY (ARRAY['propio'::text, 'tercero'::text])));
ALTER TABLE public.cierres_contables ADD CONSTRAINT cierres_contables_pkey PRIMARY KEY (id);
ALTER TABLE public.cierres_contables ADD CONSTRAINT cierres_contables_tenant_id_periodo_key UNIQUE (tenant_id, periodo);
ALTER TABLE public.cierres_contables ADD CONSTRAINT cierres_periodo_first_day CHECK ((EXTRACT(day FROM periodo) = (1)::numeric));
ALTER TABLE public.cliente_creditos ADD CONSTRAINT cliente_creditos_pkey PRIMARY KEY (id);
ALTER TABLE public.cliente_domicilios ADD CONSTRAINT cliente_domicilios_pkey PRIMARY KEY (id);
ALTER TABLE public.cliente_notas ADD CONSTRAINT cliente_notas_pkey PRIMARY KEY (id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_cuenta_token_key UNIQUE (cuenta_token);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);
ALTER TABLE public.codigo_perfiles ADD CONSTRAINT codigo_perfiles_pkey PRIMARY KEY (id);
ALTER TABLE public.combo_items ADD CONSTRAINT combo_items_pkey PRIMARY KEY (id);
ALTER TABLE public.combos ADD CONSTRAINT combos_cantidad_check CHECK ((cantidad >= 2));
ALTER TABLE public.combos ADD CONSTRAINT combos_descuento_pct_check CHECK (((descuento_pct >= (0)::numeric) AND (descuento_pct <= (100)::numeric)));
ALTER TABLE public.combos ADD CONSTRAINT combos_pkey PRIMARY KEY (id);
ALTER TABLE public.courier_credenciales ADD CONSTRAINT courier_credenciales_pkey PRIMARY KEY (id);
ALTER TABLE public.courier_credenciales ADD CONSTRAINT courier_credenciales_tenant_id_courier_key UNIQUE (tenant_id, courier);
ALTER TABLE public.courier_factura_lineas ADD CONSTRAINT courier_factura_lineas_pkey PRIMARY KEY (id);
ALTER TABLE public.courier_facturas ADD CONSTRAINT courier_facturas_pkey PRIMARY KEY (id);
ALTER TABLE public.courier_tarifas ADD CONSTRAINT courier_tarifas_pkey PRIMARY KEY (id);
ALTER TABLE public.courier_tarifas ADD CONSTRAINT courier_tarifas_tenant_id_sucursal_id_courier_key UNIQUE (tenant_id, sucursal_id, courier);
ALTER TABLE public.cuentas_origen ADD CONSTRAINT cuentas_origen_pkey PRIMARY KEY (id);
ALTER TABLE public.cuentas_origen ADD CONSTRAINT cuentas_origen_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.cuentas_origen ADD CONSTRAINT cuentas_origen_tipo_check CHECK ((tipo = ANY (ARRAY['banco'::text, 'billetera'::text, 'efectivo'::text, 'otro'::text])));
ALTER TABLE public.devolucion_items ADD CONSTRAINT devolucion_items_pkey PRIMARY KEY (id);
ALTER TABLE public.devolucion_proveedor_items ADD CONSTRAINT devolucion_proveedor_items_pkey PRIMARY KEY (id);
ALTER TABLE public.devoluciones ADD CONSTRAINT devoluciones_nc_tipo_check CHECK ((nc_tipo = ANY (ARRAY['NC-A'::text, 'NC-B'::text, 'NC-C'::text])));
ALTER TABLE public.devoluciones ADD CONSTRAINT devoluciones_origen_check CHECK ((origen = ANY (ARRAY['despachada'::text, 'facturada'::text])));
ALTER TABLE public.devoluciones ADD CONSTRAINT devoluciones_pkey PRIMARY KEY (id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_pkey PRIMARY KEY (id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devprov_forma_check CHECK ((forma = ANY (ARRAY['credito_cc'::text, 'efectivo'::text, 'reposicion'::text])));
ALTER TABLE public.emisores_fiscales ADD CONSTRAINT emisores_fiscales_afip_provider_check CHECK ((afip_provider = ANY (ARRAY['afipsdk'::text, 'propio'::text])));
ALTER TABLE public.emisores_fiscales ADD CONSTRAINT emisores_fiscales_pkey PRIMARY KEY (id);
ALTER TABLE public.empleados ADD CONSTRAINT empleados_genero_check CHECK ((genero = ANY (ARRAY['M'::text, 'F'::text, 'OTRO'::text])));
ALTER TABLE public.empleados ADD CONSTRAINT empleados_pkey PRIMARY KEY (id);
ALTER TABLE public.empleados ADD CONSTRAINT empleados_tenant_id_dni_rut_key UNIQUE (tenant_id, dni_rut);
ALTER TABLE public.empleados ADD CONSTRAINT empleados_tipo_doc_check CHECK ((tipo_doc = ANY (ARRAY['DNI'::text, 'RUT'::text, 'PASAPORTE'::text, 'OTRO'::text])));
ALTER TABLE public.envio_incidencias ADD CONSTRAINT envio_incidencias_pkey PRIMARY KEY (id);
ALTER TABLE public.envio_items ADD CONSTRAINT envio_items_pkey PRIMARY KEY (id);
ALTER TABLE public.envio_otp ADD CONSTRAINT envio_otp_pkey PRIMARY KEY (id);
ALTER TABLE public.envio_pod_fotos ADD CONSTRAINT envio_pod_fotos_pkey PRIMARY KEY (id);
ALTER TABLE public.envios ADD CONSTRAINT envios_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'despachado'::text, 'en_camino'::text, 'en_bodega'::text, 'entregado'::text, 'devolucion'::text, 'cancelado'::text])));
ALTER TABLE public.envios ADD CONSTRAINT envios_pkey PRIMARY KEY (id);
ALTER TABLE public.envios ADD CONSTRAINT envios_token_transportista_key UNIQUE (token_transportista);
ALTER TABLE public.estados_inventario ADD CONSTRAINT estados_inventario_pkey PRIMARY KEY (id);
ALTER TABLE public.gasto_cuotas ADD CONSTRAINT gasto_cuotas_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'pagado'::text])));
ALTER TABLE public.gasto_cuotas ADD CONSTRAINT gasto_cuotas_pkey PRIMARY KEY (id);
ALTER TABLE public.gastos ADD CONSTRAINT gastos_capitaliza_requires_recurso CHECK (((capitaliza_recurso = false) OR (recurso_id IS NOT NULL)));
ALTER TABLE public.gastos ADD CONSTRAINT gastos_estado_pago_check CHECK ((estado_pago = ANY (ARRAY['pendiente'::text, 'parcial'::text, 'pagado'::text])));
ALTER TABLE public.gastos ADD CONSTRAINT gastos_pkey PRIMARY KEY (id);
ALTER TABLE public.gastos_fijos ADD CONSTRAINT gastos_fijos_dia_vencimiento_check CHECK (((dia_vencimiento >= 1) AND (dia_vencimiento <= 31)));
ALTER TABLE public.gastos_fijos ADD CONSTRAINT gastos_fijos_frecuencia_check CHECK ((frecuencia = ANY (ARRAY['mensual'::text, 'quincenal'::text, 'semanal'::text])));
ALTER TABLE public.gastos_fijos ADD CONSTRAINT gastos_fijos_pkey PRIMARY KEY (id);
ALTER TABLE public.grupo_estado_items ADD CONSTRAINT grupo_estado_items_grupo_id_estado_id_key UNIQUE (grupo_id, estado_id);
ALTER TABLE public.grupo_estado_items ADD CONSTRAINT grupo_estado_items_pkey PRIMARY KEY (id);
ALTER TABLE public.grupos_estados ADD CONSTRAINT grupos_estados_pkey PRIMARY KEY (id);
ALTER TABLE public.hoja_ruta_envios ADD CONSTRAINT hoja_ruta_envios_pkey PRIMARY KEY (id);
ALTER TABLE public.hojas_ruta ADD CONSTRAINT hojas_ruta_pkey PRIMARY KEY (id);
ALTER TABLE public.hojas_ruta ADD CONSTRAINT hojas_ruta_token_key UNIQUE (token);
ALTER TABLE public.integration_job_queue ADD CONSTRAINT integration_job_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.integration_job_queue ADD CONSTRAINT integration_job_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])));
ALTER TABLE public.inventario_conteo_items ADD CONSTRAINT inventario_conteo_items_pkey PRIMARY KEY (id);
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'finalizado'::text])));
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_modo_check CHECK ((modo = ANY (ARRAY['rapido'::text, 'guiado'::text])));
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_pkey PRIMARY KEY (id);
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_tipo_check CHECK ((tipo = ANY (ARRAY['ubicacion'::text, 'producto'::text, 'marca'::text, 'categoria'::text, 'sucursal'::text])));
ALTER TABLE public.inventario_lineas ADD CONSTRAINT chk_cantidad_mayor_o_igual_reservada CHECK ((cantidad >= cantidad_reservada));
ALTER TABLE public.inventario_lineas ADD CONSTRAINT chk_cantidad_no_negativa CHECK ((cantidad >= 0));
ALTER TABLE public.inventario_lineas ADD CONSTRAINT chk_cantidad_reservada_no_negativa CHECK ((cantidad_reservada >= 0));
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_pkey PRIMARY KEY (id);
ALTER TABLE public.inventario_meli_map ADD CONSTRAINT inventario_meli_map_pkey PRIMARY KEY (id);
ALTER TABLE public.inventario_meli_map ADD CONSTRAINT inventario_meli_map_tenant_id_producto_id_meli_item_id_key UNIQUE (tenant_id, producto_id, meli_item_id);
ALTER TABLE public.inventario_series ADD CONSTRAINT inventario_series_pkey PRIMARY KEY (id);
ALTER TABLE public.inventario_series ADD CONSTRAINT inventario_series_tenant_id_producto_id_nro_serie_key UNIQUE (tenant_id, producto_id, nro_serie);
ALTER TABLE public.inventario_tn_map ADD CONSTRAINT inventario_tn_map_pkey PRIMARY KEY (id);
ALTER TABLE public.inventario_tn_map ADD CONSTRAINT inventario_tn_map_tenant_id_sucursal_id_producto_id_key UNIQUE (tenant_id, sucursal_id, producto_id);
ALTER TABLE public.inventario_tn_map ADD CONSTRAINT inventario_tn_map_tenant_id_sucursal_id_tn_product_id_tn_va_key UNIQUE (tenant_id, sucursal_id, tn_product_id, tn_variant_id);
ALTER TABLE public.kit_recetas ADD CONSTRAINT kit_recetas_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE public.kit_recetas ADD CONSTRAINT kit_recetas_kit_producto_id_comp_producto_id_key UNIQUE (kit_producto_id, comp_producto_id);
ALTER TABLE public.kit_recetas ADD CONSTRAINT kit_recetas_pkey PRIMARY KEY (id);
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_cantidad_kits_check CHECK ((cantidad_kits > (0)::numeric));
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_estado_check CHECK ((estado = ANY (ARRAY['en_armado'::text, 'completado'::text, 'cancelado'::text])));
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_pkey PRIMARY KEY (id);
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_tipo_check CHECK ((tipo = ANY (ARRAY['armado'::text, 'desarmado'::text])));
ALTER TABLE public.leads ADD CONSTRAINT leads_estado_check CHECK ((estado = ANY (ARRAY['lead'::text, 'qualified'::text, 'demo'::text, 'trial'::text, 'won'::text, 'lost'::text])));
ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE public.meli_credentials ADD CONSTRAINT meli_credentials_pkey PRIMARY KEY (id);
ALTER TABLE public.meli_credentials ADD CONSTRAINT meli_credentials_tenant_id_sucursal_id_key UNIQUE (tenant_id, sucursal_id);
ALTER TABLE public.mercadopago_credentials ADD CONSTRAINT mercadopago_credentials_pkey PRIMARY KEY (id);
ALTER TABLE public.mercadopago_credentials ADD CONSTRAINT mercadopago_credentials_tenant_id_sucursal_id_key UNIQUE (tenant_id, sucursal_id);
ALTER TABLE public.metodos_pago ADD CONSTRAINT metodos_pago_pkey PRIMARY KEY (id);
ALTER TABLE public.metodos_pago ADD CONSTRAINT metodos_pago_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.modo_credentials ADD CONSTRAINT modo_credentials_ambiente_check CHECK ((ambiente = ANY (ARRAY['test'::text, 'prod'::text])));
ALTER TABLE public.modo_credentials ADD CONSTRAINT modo_credentials_pkey PRIMARY KEY (id);
ALTER TABLE public.modo_credentials ADD CONSTRAINT modo_credentials_tenant_id_key UNIQUE (tenant_id);
ALTER TABLE public.motivos_movimiento ADD CONSTRAINT motivos_movimiento_pkey PRIMARY KEY (id);
ALTER TABLE public.motivos_movimiento ADD CONSTRAINT motivos_movimiento_tipo_check CHECK ((tipo = ANY (ARRAY['ingreso'::text, 'rebaje'::text, 'ambos'::text, 'caja'::text])));
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_pkey PRIMARY KEY (id);
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check CHECK ((tipo = ANY (ARRAY['ingreso'::text, 'rebaje'::text, 'ajuste'::text, 'kitting'::text, 'des_kitting'::text, 'ajuste_ingreso'::text, 'ajuste_rebaje'::text, 'traslado'::text])));
ALTER TABLE public.mp_billing_alertas ADD CONSTRAINT mp_billing_alertas_pkey PRIMARY KEY (id);
ALTER TABLE public.mp_billing_alertas ADD CONSTRAINT mp_billing_alertas_tipo_check CHECK ((tipo = ANY (ARRAY['huerfana'::text, 'drift_mp_cobra'::text, 'drift_acceso_gratis'::text])));
ALTER TABLE public.mp_billing_alertas ADD CONSTRAINT mp_billing_alertas_tipo_preapproval_id_key UNIQUE (tipo, preapproval_id);
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);
ALTER TABLE public.orden_compra_items ADD CONSTRAINT orden_compra_items_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE public.orden_compra_items ADD CONSTRAINT orden_compra_items_pkey PRIMARY KEY (id);
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'enviada'::text, 'confirmada'::text, 'cancelada'::text, 'recibida_parcial'::text, 'recibida'::text])));
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_estado_pago_check CHECK ((estado_pago = ANY (ARRAY['pendiente_pago'::text, 'pago_parcial'::text, 'pagada'::text, 'cuenta_corriente'::text])));
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_pkey PRIMARY KEY (id);
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_tenant_id_numero_key UNIQUE (tenant_id, numero);
ALTER TABLE public.planes ADD CONSTRAINT planes_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_billers ADD CONSTRAINT platform_billers_afip_provider_check CHECK ((afip_provider = ANY (ARRAY['afipsdk'::text, 'propio'::text])));
ALTER TABLE public.platform_billers ADD CONSTRAINT platform_billers_condicion_iva_emisor_check CHECK ((condicion_iva_emisor = ANY (ARRAY['Monotributista'::text, 'Exento'::text, 'RI'::text])));
ALTER TABLE public.platform_billers ADD CONSTRAINT platform_billers_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_facturas ADD CONSTRAINT platform_facturas_origen_pago_check CHECK ((origen_pago = ANY (ARRAY['mp_recurrente'::text, 'mp_manual'::text, 'manual_staff'::text])));
ALTER TABLE public.platform_facturas ADD CONSTRAINT platform_facturas_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_facturas_claims ADD CONSTRAINT platform_facturas_claims_pkey PRIMARY KEY (payment_ref);
ALTER TABLE public.producto_estructuras ADD CONSTRAINT producto_estructuras_pkey PRIMARY KEY (id);
ALTER TABLE public.producto_grupos ADD CONSTRAINT producto_grupos_pkey PRIMARY KEY (id);
ALTER TABLE public.producto_precios_mayorista ADD CONSTRAINT producto_precios_mayorista_cantidad_minima_check CHECK ((cantidad_minima > 0));
ALTER TABLE public.producto_precios_mayorista ADD CONSTRAINT producto_precios_mayorista_pkey PRIMARY KEY (id);
ALTER TABLE public.producto_precios_mayorista ADD CONSTRAINT producto_precios_mayorista_precio_check CHECK ((precio >= (0)::numeric));
ALTER TABLE public.producto_precios_mayorista ADD CONSTRAINT producto_precios_mayorista_producto_id_cantidad_minima_key UNIQUE (producto_id, cantidad_minima);
ALTER TABLE public.producto_stock_minimo_sucursal ADD CONSTRAINT producto_stock_minimo_sucursa_tenant_id_producto_id_sucursa_key UNIQUE (tenant_id, producto_id, sucursal_id);
ALTER TABLE public.producto_stock_minimo_sucursal ADD CONSTRAINT producto_stock_minimo_sucursal_pkey PRIMARY KEY (id);
ALTER TABLE public.producto_stock_minimo_sucursal ADD CONSTRAINT producto_stock_minimo_sucursal_stock_minimo_check CHECK ((stock_minimo >= 0));
ALTER TABLE public.producto_ubicacion_sucursal ADD CONSTRAINT producto_ubicacion_sucursal_pkey PRIMARY KEY (id);
ALTER TABLE public.producto_ubicacion_sucursal ADD CONSTRAINT producto_ubicacion_sucursal_producto_id_sucursal_id_key UNIQUE (producto_id, sucursal_id);
ALTER TABLE public.productos ADD CONSTRAINT productos_alicuota_iva_check CHECK ((alicuota_iva = ANY (ARRAY[(0)::numeric, 10.5, (21)::numeric, (27)::numeric])));
ALTER TABLE public.productos ADD CONSTRAINT productos_clase_abc_check CHECK (((clase_abc IS NULL) OR (clase_abc = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]))));
ALTER TABLE public.productos ADD CONSTRAINT chk_productos_grupo_sin_atributos_variante CHECK ((NOT ((grupo_id IS NOT NULL) AND (tiene_talle OR tiene_color OR tiene_encaje OR tiene_formato OR tiene_sabor_aroma))));
ALTER TABLE public.productos ADD CONSTRAINT productos_pkey PRIMARY KEY (id);
ALTER TABLE public.productos ADD CONSTRAINT productos_tenant_id_sku_key UNIQUE (tenant_id, sku);
ALTER TABLE public.proveedor_cc_movimientos ADD CONSTRAINT proveedor_cc_movimientos_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedor_cc_movimientos ADD CONSTRAINT proveedor_cc_movimientos_tipo_check CHECK ((tipo = ANY (ARRAY['oc'::text, 'pago'::text, 'nota_credito'::text, 'ajuste'::text])));
ALTER TABLE public.proveedor_contactos ADD CONSTRAINT proveedor_contactos_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedor_cuentas_bancarias ADD CONSTRAINT proveedor_cuentas_bancarias_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedor_productos ADD CONSTRAINT proveedor_productos_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedor_productos ADD CONSTRAINT proveedor_productos_proveedor_id_producto_id_key UNIQUE (proveedor_id, producto_id);
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_condicion_iva_check CHECK ((condicion_iva = ANY (ARRAY['responsable_inscripto'::text, 'monotributo'::text, 'exento'::text, 'consumidor_final'::text])));
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_modo_pago_check CHECK ((modo_pago = ANY (ARRAY['contado'::text, 'anticipo'::text, 'contra_entrega'::text, 'cuenta_corriente'::text])));
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_tipo_check CHECK ((tipo = ANY (ARRAY['proveedor'::text, 'servicio'::text])));
ALTER TABLE public.puntos_venta_afip ADD CONSTRAINT puntos_venta_afip_pkey PRIMARY KEY (id);
ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_pkey PRIMARY KEY (id);
ALTER TABLE public.recepciones ADD CONSTRAINT recepciones_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'confirmada'::text, 'cancelada'::text])));
ALTER TABLE public.recepciones ADD CONSTRAINT recepciones_pkey PRIMARY KEY (id);
ALTER TABLE public.recursos ADD CONSTRAINT recursos_estado_check CHECK ((estado = ANY (ARRAY['activo'::text, 'en_reparacion'::text, 'dado_de_baja'::text, 'pendiente_adquisicion'::text])));
ALTER TABLE public.recursos ADD CONSTRAINT recursos_frecuencia_unidad_check CHECK ((frecuencia_unidad = ANY (ARRAY['dia'::text, 'semana'::text, 'mes'::text, 'año'::text])));
ALTER TABLE public.recursos ADD CONSTRAINT recursos_pkey PRIMARY KEY (id);
ALTER TABLE public.repartidores ADD CONSTRAINT repartidores_pkey PRIMARY KEY (id);
ALTER TABLE public.retenciones_sufridas ADD CONSTRAINT retenciones_sufridas_pkey PRIMARY KEY (id);
ALTER TABLE public.roles_custom ADD CONSTRAINT roles_custom_pkey PRIMARY KEY (id);
ALTER TABLE public.roles_custom ADD CONSTRAINT roles_custom_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.rrhh_anticipos ADD CONSTRAINT rrhh_anticipos_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_asistencia ADD CONSTRAINT rrhh_asistencia_estado_check CHECK ((estado = ANY (ARRAY['presente'::text, 'ausente'::text, 'tardanza'::text, 'licencia'::text])));
ALTER TABLE public.rrhh_asistencia ADD CONSTRAINT rrhh_asistencia_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_asistencia ADD CONSTRAINT rrhh_asistencia_tenant_id_empleado_id_fecha_key UNIQUE (tenant_id, empleado_id, fecha);
ALTER TABLE public.rrhh_capacitaciones ADD CONSTRAINT rrhh_capacitaciones_estado_check CHECK ((estado = ANY (ARRAY['planificada'::text, 'en_curso'::text, 'completada'::text, 'cancelada'::text])));
ALTER TABLE public.rrhh_capacitaciones ADD CONSTRAINT rrhh_capacitaciones_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_conceptos ADD CONSTRAINT rrhh_conceptos_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_conceptos ADD CONSTRAINT rrhh_conceptos_tipo_check CHECK ((tipo = ANY (ARRAY['HABER'::text, 'DESCUENTO'::text])));
ALTER TABLE public.rrhh_departamentos ADD CONSTRAINT rrhh_departamentos_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_documentos ADD CONSTRAINT rrhh_documentos_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_documentos ADD CONSTRAINT rrhh_documentos_tipo_check CHECK ((tipo = ANY (ARRAY['contrato'::text, 'certificado'::text, 'cv'::text, 'foto'::text, 'otro'::text])));
ALTER TABLE public.rrhh_documentos_catalogo ADD CONSTRAINT rrhh_documentos_catalogo_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_documentos_catalogo ADD CONSTRAINT rrhh_documentos_catalogo_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.rrhh_evaluaciones ADD CONSTRAINT rrhh_evaluaciones_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_feriados ADD CONSTRAINT rrhh_feriados_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_feriados ADD CONSTRAINT rrhh_feriados_tipo_check CHECK ((tipo = ANY (ARRAY['nacional'::text, 'provincial'::text, 'personalizado'::text, 'no_laborable'::text])));
ALTER TABLE public.rrhh_fichadas ADD CONSTRAINT rrhh_fichadas_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_fichadas ADD CONSTRAINT rrhh_fichadas_tipo_check CHECK ((tipo = ANY (ARRAY['entrada'::text, 'salida'::text])));
ALTER TABLE public.rrhh_horas_extra ADD CONSTRAINT rrhh_horas_extra_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_liquidaciones_finales ADD CONSTRAINT rrhh_liquidaciones_finales_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_puestos ADD CONSTRAINT rrhh_puestos_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_salario_items ADD CONSTRAINT rrhh_salario_items_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_salario_items ADD CONSTRAINT rrhh_salario_items_tipo_check CHECK ((tipo = ANY (ARRAY['HABER'::text, 'DESCUENTO'::text])));
ALTER TABLE public.rrhh_salarios ADD CONSTRAINT rrhh_salarios_medio_pago_check CHECK ((medio_pago = ANY (ARRAY['efectivo'::text, 'transferencia_banco'::text, 'mp'::text])));
ALTER TABLE public.rrhh_salarios ADD CONSTRAINT rrhh_salarios_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_salarios ADD CONSTRAINT rrhh_salarios_tenant_id_empleado_id_periodo_key UNIQUE (tenant_id, empleado_id, periodo);
ALTER TABLE public.rrhh_tipos_contrato ADD CONSTRAINT rrhh_tipos_contrato_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_tipos_contrato ADD CONSTRAINT rrhh_tipos_contrato_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.rrhh_vacaciones_saldo ADD CONSTRAINT rrhh_vacaciones_saldo_pkey PRIMARY KEY (id);
ALTER TABLE public.rrhh_vacaciones_saldo ADD CONSTRAINT rrhh_vacaciones_saldo_tenant_id_empleado_id_anio_key UNIQUE (tenant_id, empleado_id, anio);
ALTER TABLE public.rrhh_vacaciones_solicitud ADD CONSTRAINT rrhh_vacaciones_solicitud_pkey PRIMARY KEY (id);
ALTER TABLE public.servicio_items ADD CONSTRAINT servicio_items_pkey PRIMARY KEY (id);
ALTER TABLE public.servicio_presupuestos ADD CONSTRAINT servicio_presupuestos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text, 'convertido'::text])));
ALTER TABLE public.servicio_presupuestos ADD CONSTRAINT servicio_presupuestos_pkey PRIMARY KEY (id);
ALTER TABLE public.sucursales ADD CONSTRAINT sucursales_pkey PRIMARY KEY (id);
ALTER TABLE public.support_agents ADD CONSTRAINT support_agents_pkey PRIMARY KEY (id);
ALTER TABLE public.support_agents ADD CONSTRAINT support_agents_rol_check CHECK ((rol = ANY (ARRAY['admin'::text, 'support'::text, 'marketing'::text, 'billing'::text])));
ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_autor_tipo_check CHECK ((autor_tipo = ANY (ARRAY['agente'::text, 'cliente'::text, 'sistema'::text])));
ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_canal_check CHECK ((canal = ANY (ARRAY['manual'::text, 'email'::text, 'in_app'::text])));
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_estado_check CHECK ((estado = ANY (ARRAY['abierto'::text, 'en_progreso'::text, 'esperando'::text, 'resuelto'::text, 'cerrado'::text])));
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_prioridad_check CHECK ((prioridad = ANY (ARRAY['baja'::text, 'media'::text, 'alta'::text, 'urgente'::text])));
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_cantidad_check CHECK ((cantidad > 0));
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_check CHECK (((tipo = 'fijo'::text) OR (vence_at IS NOT NULL)));
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_dimension_check CHECK ((dimension = ANY (ARRAY['sku'::text, 'movimientos'::text, 'comprobantes'::text, 'sucursales'::text, 'usuarios'::text, 'cuits'::text])));
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_pkey PRIMARY KEY (id);
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_tipo_check CHECK ((tipo = ANY (ARRAY['fijo'::text, 'temporal'::text])));
ALTER TABLE public.tenant_certificates ADD CONSTRAINT tenant_certificates_pkey PRIMARY KEY (id);
ALTER TABLE public.tenants ADD CONSTRAINT tenants_afip_provider_check CHECK ((afip_provider = ANY (ARRAY['afipsdk'::text, 'propio'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_billing_mode_check CHECK ((billing_mode = ANY (ARRAY['auto'::text, 'manual'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_cc_enforcement_chk CHECK ((cc_enforcement_politica = ANY (ARRAY['permitir'::text, 'avisar'::text, 'bloquear'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_cc_morosidad_chk CHECK ((cc_morosidad_politica = ANY (ARRAY['permitir'::text, 'bloqueo_cc'::text, 'bloqueo_total'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_cliente_datos_minimos_check CHECK ((cliente_datos_minimos = ANY (ARRAY['nombre'::text, 'nombre_dni'::text, 'nombre_dni_email'::text, 'todos'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_cliente_obligatorio_check CHECK ((cliente_obligatorio = ANY (ARRAY['siempre'::text, 'reservas'::text, 'nunca'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_conteo_modo_check CHECK ((conteo_modo = ANY (ARRAY['rapido'::text, 'guiado'::text, 'elegir'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_envio_peso_fuente_chk CHECK ((envio_peso_fuente = ANY (ARRAY['manual'::text, 'producto'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_gastos_dias_alerta_anticipo_oc_check CHECK (((gastos_dias_alerta_anticipo_oc >= 1) AND (gastos_dias_alerta_anticipo_oc <= 365)));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_gastos_dias_alerta_borrador_check CHECK (((gastos_dias_alerta_borrador >= 1) AND (gastos_dias_alerta_borrador <= 365)));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_modo_operacion_check CHECK ((modo_operacion = ANY (ARRAY['basico'::text, 'avanzado'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_moneda_check CHECK ((moneda = ANY (ARRAY['ARS'::text, 'USD'::text, 'CLP'::text, 'UYU'::text, 'PYG'::text, 'BOB'::text, 'BRL'::text, 'PEN'::text, 'MXN'::text, 'COP'::text, 'EUR'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_oc_numeracion_check CHECK ((oc_numeracion = ANY (ARRAY['tenant'::text, 'sucursal'::text, 'proveedor'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE public.tenants ADD CONSTRAINT tenants_plan_tier_check CHECK ((plan_tier = ANY (ARRAY['free'::text, 'basico'::text, 'pro'::text, 'enterprise'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_precio_redondeo_check CHECK ((precio_redondeo = ANY (ARRAY['none'::text, '10'::text, '50'::text, '100'::text, '500'::text, '1000'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['trial'::text, 'active'::text, 'inactive'::text, 'cancelled'::text])));
ALTER TABLE public.tiendanube_credentials ADD CONSTRAINT tiendanube_credentials_pkey PRIMARY KEY (id);
ALTER TABLE public.tiendanube_credentials ADD CONSTRAINT tiendanube_credentials_tenant_id_sucursal_id_key UNIQUE (tenant_id, sucursal_id);
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_pkey PRIMARY KEY (id);
ALTER TABLE public.traslados ADD CONSTRAINT traslados_check CHECK ((sucursal_origen_id <> sucursal_destino_id));
ALTER TABLE public.traslados ADD CONSTRAINT traslados_estado_check CHECK ((estado = ANY (ARRAY['en_transito'::text, 'recibido'::text, 'recibido_parcial'::text, 'cancelado'::text])));
ALTER TABLE public.traslados ADD CONSTRAINT traslados_pkey PRIMARY KEY (id);
ALTER TABLE public.ubicaciones ADD CONSTRAINT ubicaciones_pkey PRIMARY KEY (id);
ALTER TABLE public.ubicaciones ADD CONSTRAINT ubicaciones_tipo_ubicacion_check CHECK ((tipo_ubicacion = ANY (ARRAY['picking'::text, 'bulk'::text, 'estiba'::text, 'camara'::text, 'cross_dock'::text])));
ALTER TABLE public.unidades_medida ADD CONSTRAINT unidades_medida_pkey PRIMARY KEY (id);
ALTER TABLE public.unidades_medida ADD CONSTRAINT unidades_medida_tenant_id_nombre_key UNIQUE (tenant_id, nombre);
ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE public.users ADD CONSTRAINT users_rol_check CHECK ((rol = ANY (ARRAY['DUEÑO'::text, 'SUPER_USUARIO'::text, 'SUPERVISOR'::text, 'CAJERO'::text, 'ADMIN'::text, 'RRHH'::text, 'DEPOSITO'::text, 'CONTADOR'::text, 'VIEWER'::text])));
ALTER TABLE public.venta_auditoria ADD CONSTRAINT venta_auditoria_pkey PRIMARY KEY (id);
ALTER TABLE public.venta_item_despachos ADD CONSTRAINT venta_item_despachos_pkey PRIMARY KEY (id);
ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_pkey PRIMARY KEY (id);
ALTER TABLE public.venta_series ADD CONSTRAINT venta_series_pkey PRIMARY KEY (id);
ALTER TABLE public.ventas ADD CONSTRAINT ventas_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'reservada'::text, 'despachada'::text, 'facturada'::text, 'cancelada'::text, 'devuelta'::text])));
ALTER TABLE public.ventas ADD CONSTRAINT ventas_pkey PRIMARY KEY (id);
ALTER TABLE public.ventas_externas_logs ADD CONSTRAINT ventas_externas_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.ventas_externas_logs ADD CONSTRAINT ventas_externas_logs_tenant_id_integracion_webhook_external_key UNIQUE (tenant_id, integracion, webhook_external_id);
ALTER TABLE public.ventas_recurrentes ADD CONSTRAINT ventas_recurrentes_frecuencia_dias_check CHECK ((frecuencia_dias > 0));
ALTER TABLE public.ventas_recurrentes ADD CONSTRAINT ventas_recurrentes_pkey PRIMARY KEY (id);
ALTER TABLE public.actividad_log ADD CONSTRAINT actividad_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.actividad_log ADD CONSTRAINT actividad_log_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.addon_batch_changes ADD CONSTRAINT addon_batch_changes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.aging_profile_reglas ADD CONSTRAINT aging_profile_reglas_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id) ON DELETE RESTRICT;
ALTER TABLE public.aging_profile_reglas ADD CONSTRAINT aging_profile_reglas_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES aging_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.aging_profile_reglas ADD CONSTRAINT aging_profile_reglas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.aging_profiles ADD CONSTRAINT aging_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.alertas ADD CONSTRAINT alertas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.alertas ADD CONSTRAINT alertas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.archivos_biblioteca ADD CONSTRAINT archivos_biblioteca_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.archivos_biblioteca ADD CONSTRAINT archivos_biblioteca_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.atributos_variante_valores ADD CONSTRAINT atributos_variante_valores_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES users(id);
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id) ON DELETE SET NULL;
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.autorizaciones_cc ADD CONSTRAINT autorizaciones_cc_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES users(id);
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.autorizaciones_gasto ADD CONSTRAINT autorizaciones_gasto_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES users(id);
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES inventario_lineas(id);
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES users(id);
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE public.billing_cancelaciones ADD CONSTRAINT billing_cancelaciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.billing_manual_pagos ADD CONSTRAINT billing_manual_pagos_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES support_agents(id) ON DELETE SET NULL;
ALTER TABLE public.billing_manual_pagos ADD CONSTRAINT billing_manual_pagos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.boveda_arqueos ADD CONSTRAINT boveda_arqueos_cuenta_origen_id_fkey FOREIGN KEY (cuenta_origen_id) REFERENCES cuentas_origen(id) ON DELETE SET NULL;
ALTER TABLE public.boveda_arqueos ADD CONSTRAINT boveda_arqueos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.boveda_arqueos ADD CONSTRAINT boveda_arqueos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.boveda_retiros ADD CONSTRAINT boveda_retiros_cuenta_origen_id_fkey FOREIGN KEY (cuenta_origen_id) REFERENCES cuentas_origen(id) ON DELETE RESTRICT;
ALTER TABLE public.boveda_retiros ADD CONSTRAINT boveda_retiros_movimiento_id_fkey FOREIGN KEY (movimiento_id) REFERENCES caja_movimientos(id) ON DELETE SET NULL;
ALTER TABLE public.boveda_retiros ADD CONSTRAINT boveda_retiros_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.boveda_retiros ADD CONSTRAINT boveda_retiros_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.caja_arqueos ADD CONSTRAINT caja_arqueos_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES caja_sesiones(id) ON DELETE CASCADE;
ALTER TABLE public.caja_arqueos ADD CONSTRAINT caja_arqueos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.caja_arqueos ADD CONSTRAINT caja_arqueos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.caja_movimientos ADD CONSTRAINT caja_movimientos_cuenta_origen_id_fkey FOREIGN KEY (cuenta_origen_id) REFERENCES cuentas_origen(id) ON DELETE SET NULL;
ALTER TABLE public.caja_movimientos ADD CONSTRAINT caja_movimientos_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES caja_sesiones(id);
ALTER TABLE public.caja_movimientos ADD CONSTRAINT caja_movimientos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.caja_movimientos ADD CONSTRAINT caja_movimientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_abierta_por_fkey FOREIGN KEY (abierta_por) REFERENCES users(id);
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_caja_id_fkey FOREIGN KEY (caja_id) REFERENCES cajas(id);
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_cerrado_por_id_fkey FOREIGN KEY (cerrado_por_id) REFERENCES users(id);
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.caja_sesiones ADD CONSTRAINT caja_sesiones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_movimiento_destino_id_fkey FOREIGN KEY (movimiento_destino_id) REFERENCES caja_movimientos(id) ON DELETE SET NULL;
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_movimiento_origen_id_fkey FOREIGN KEY (movimiento_origen_id) REFERENCES caja_movimientos(id) ON DELETE SET NULL;
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_sesion_destino_id_fkey FOREIGN KEY (sesion_destino_id) REFERENCES caja_sesiones(id);
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_sesion_origen_id_fkey FOREIGN KEY (sesion_origen_id) REFERENCES caja_sesiones(id);
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.caja_traspasos ADD CONSTRAINT caja_traspasos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.cajas ADD CONSTRAINT cajas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.cajas ADD CONSTRAINT cajas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.canales_venta ADD CONSTRAINT canales_venta_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.categorias ADD CONSTRAINT categorias_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.categorias_gasto ADD CONSTRAINT categorias_gasto_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.cheques ADD CONSTRAINT cheques_endosado_a_proveedor_id_fkey FOREIGN KEY (endosado_a_proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id) ON DELETE SET NULL;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.cheques ADD CONSTRAINT cheques_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cierres_contables ADD CONSTRAINT cierres_contables_cerrado_por_fkey FOREIGN KEY (cerrado_por) REFERENCES users(id);
ALTER TABLE public.cierres_contables ADD CONSTRAINT cierres_contables_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_creditos ADD CONSTRAINT cliente_creditos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_creditos ADD CONSTRAINT cliente_creditos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_creditos ADD CONSTRAINT cliente_creditos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.cliente_creditos ADD CONSTRAINT cliente_creditos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE SET NULL;
ALTER TABLE public.cliente_domicilios ADD CONSTRAINT cliente_domicilios_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_domicilios ADD CONSTRAINT cliente_domicilios_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_notas ADD CONSTRAINT cliente_notas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_notas ADD CONSTRAINT cliente_notas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_notas ADD CONSTRAINT cliente_notas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_baja_por_fkey FOREIGN KEY (baja_por) REFERENCES users(id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.codigo_perfiles ADD CONSTRAINT codigo_perfiles_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.codigo_perfiles ADD CONSTRAINT codigo_perfiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.combo_items ADD CONSTRAINT combo_items_combo_id_fkey FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE;
ALTER TABLE public.combo_items ADD CONSTRAINT combo_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.combo_items ADD CONSTRAINT combo_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.combos ADD CONSTRAINT combos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.combos ADD CONSTRAINT combos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.combos ADD CONSTRAINT combos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.courier_credenciales ADD CONSTRAINT courier_credenciales_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.courier_factura_lineas ADD CONSTRAINT courier_factura_lineas_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE SET NULL;
ALTER TABLE public.courier_factura_lineas ADD CONSTRAINT courier_factura_lineas_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES courier_facturas(id) ON DELETE CASCADE;
ALTER TABLE public.courier_factura_lineas ADD CONSTRAINT courier_factura_lineas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.courier_facturas ADD CONSTRAINT courier_facturas_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.courier_facturas ADD CONSTRAINT courier_facturas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.courier_facturas ADD CONSTRAINT courier_facturas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.courier_tarifas ADD CONSTRAINT courier_tarifas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE;
ALTER TABLE public.courier_tarifas ADD CONSTRAINT courier_tarifas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cuentas_origen ADD CONSTRAINT cuentas_origen_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.devolucion_items ADD CONSTRAINT devolucion_items_devolucion_id_fkey FOREIGN KEY (devolucion_id) REFERENCES devoluciones(id) ON DELETE CASCADE;
ALTER TABLE public.devolucion_items ADD CONSTRAINT devolucion_items_inventario_linea_nueva_id_fkey FOREIGN KEY (inventario_linea_nueva_id) REFERENCES inventario_lineas(id);
ALTER TABLE public.devolucion_items ADD CONSTRAINT devolucion_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.devolucion_proveedor_items ADD CONSTRAINT devolucion_proveedor_items_devolucion_id_fkey FOREIGN KEY (devolucion_id) REFERENCES devoluciones_proveedor(id) ON DELETE CASCADE;
ALTER TABLE public.devolucion_proveedor_items ADD CONSTRAINT devolucion_proveedor_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.devoluciones ADD CONSTRAINT devoluciones_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.devoluciones ADD CONSTRAINT devoluciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.devoluciones ADD CONSTRAINT devoluciones_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_caja_sesion_id_fkey FOREIGN KEY (caja_sesion_id) REFERENCES caja_sesiones(id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id) ON DELETE SET NULL;
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_oc_reposicion_id_fkey FOREIGN KEY (oc_reposicion_id) REFERENCES ordenes_compra(id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES recepciones(id) ON DELETE SET NULL;
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.devoluciones_proveedor ADD CONSTRAINT devoluciones_proveedor_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.emisores_fiscales ADD CONSTRAINT emisores_fiscales_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.empleados ADD CONSTRAINT empleados_departamento_id_fkey FOREIGN KEY (departamento_id) REFERENCES rrhh_departamentos(id) ON DELETE SET NULL;
ALTER TABLE public.empleados ADD CONSTRAINT empleados_puesto_id_fkey FOREIGN KEY (puesto_id) REFERENCES rrhh_puestos(id) ON DELETE SET NULL;
ALTER TABLE public.empleados ADD CONSTRAINT empleados_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES empleados(id) ON DELETE SET NULL;
ALTER TABLE public.empleados ADD CONSTRAINT empleados_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.empleados ADD CONSTRAINT empleados_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.envio_incidencias ADD CONSTRAINT envio_incidencias_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE CASCADE;
ALTER TABLE public.envio_incidencias ADD CONSTRAINT envio_incidencias_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.envio_items ADD CONSTRAINT envio_items_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE CASCADE;
ALTER TABLE public.envio_items ADD CONSTRAINT envio_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;
ALTER TABLE public.envio_items ADD CONSTRAINT envio_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.envio_otp ADD CONSTRAINT envio_otp_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE CASCADE;
ALTER TABLE public.envio_otp ADD CONSTRAINT envio_otp_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.envio_pod_fotos ADD CONSTRAINT envio_pod_fotos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.envio_pod_fotos ADD CONSTRAINT envio_pod_fotos_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE CASCADE;
ALTER TABLE public.envio_pod_fotos ADD CONSTRAINT envio_pod_fotos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.envios ADD CONSTRAINT envios_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.envios ADD CONSTRAINT envios_destino_id_fkey FOREIGN KEY (destino_id) REFERENCES cliente_domicilios(id) ON DELETE SET NULL;
ALTER TABLE public.envios ADD CONSTRAINT envios_gasto_combustible_id_fkey FOREIGN KEY (gasto_combustible_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.envios ADD CONSTRAINT envios_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.envios ADD CONSTRAINT envios_recurso_id_fkey FOREIGN KEY (recurso_id) REFERENCES recursos(id) ON DELETE SET NULL;
ALTER TABLE public.envios ADD CONSTRAINT envios_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES repartidores(id) ON DELETE SET NULL;
ALTER TABLE public.envios ADD CONSTRAINT envios_sucursal_destino_id_fkey FOREIGN KEY (sucursal_destino_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.envios ADD CONSTRAINT envios_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.envios ADD CONSTRAINT envios_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.envios ADD CONSTRAINT envios_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE SET NULL;
ALTER TABLE public.estados_inventario ADD CONSTRAINT estados_inventario_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.gasto_cuotas ADD CONSTRAINT gasto_cuotas_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE CASCADE;
ALTER TABLE public.gasto_cuotas ADD CONSTRAINT gasto_cuotas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias_gasto(id) ON DELETE SET NULL;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_emisor_id_fkey FOREIGN KEY (emisor_id) REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_gasto_padre_id_fkey FOREIGN KEY (gasto_padre_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES recepciones(id) ON DELETE SET NULL;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_recurso_id_fkey FOREIGN KEY (recurso_id) REFERENCES recursos(id) ON DELETE SET NULL;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.gastos ADD CONSTRAINT gastos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.gastos_fijos ADD CONSTRAINT gastos_fijos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias_gasto(id) ON DELETE SET NULL;
ALTER TABLE public.gastos_fijos ADD CONSTRAINT gastos_fijos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.gastos_fijos ADD CONSTRAINT gastos_fijos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.grupo_estado_items ADD CONSTRAINT grupo_estado_items_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id) ON DELETE CASCADE;
ALTER TABLE public.grupo_estado_items ADD CONSTRAINT grupo_estado_items_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos_estados(id) ON DELETE CASCADE;
ALTER TABLE public.grupos_estados ADD CONSTRAINT grupos_estados_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.hoja_ruta_envios ADD CONSTRAINT hoja_ruta_envios_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE CASCADE;
ALTER TABLE public.hoja_ruta_envios ADD CONSTRAINT hoja_ruta_envios_hoja_id_fkey FOREIGN KEY (hoja_id) REFERENCES hojas_ruta(id) ON DELETE CASCADE;
ALTER TABLE public.hoja_ruta_envios ADD CONSTRAINT hoja_ruta_envios_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.hojas_ruta ADD CONSTRAINT hojas_ruta_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.hojas_ruta ADD CONSTRAINT hojas_ruta_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES repartidores(id) ON DELETE SET NULL;
ALTER TABLE public.hojas_ruta ADD CONSTRAINT hojas_ruta_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.hojas_ruta ADD CONSTRAINT hojas_ruta_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.integration_job_queue ADD CONSTRAINT integration_job_queue_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.integration_job_queue ADD CONSTRAINT integration_job_queue_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_conteo_items ADD CONSTRAINT inventario_conteo_items_contado_por_fkey FOREIGN KEY (contado_por) REFERENCES users(id);
ALTER TABLE public.inventario_conteo_items ADD CONSTRAINT inventario_conteo_items_conteo_id_fkey FOREIGN KEY (conteo_id) REFERENCES inventario_conteos(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_conteo_items ADD CONSTRAINT inventario_conteo_items_inventario_linea_id_fkey FOREIGN KEY (inventario_linea_id) REFERENCES inventario_lineas(id) ON DELETE SET NULL;
ALTER TABLE public.inventario_conteo_items ADD CONSTRAINT inventario_conteo_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.inventario_conteo_items ADD CONSTRAINT inventario_conteo_items_reconteo_por_fkey FOREIGN KEY (reconteo_por) REFERENCES users(id);
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_conteos ADD CONSTRAINT inventario_conteos_ubicacion_id_fkey FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id);
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_estructura_id_fkey FOREIGN KEY (estructura_id) REFERENCES producto_estructuras(id) ON DELETE SET NULL;
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_ubicacion_id_fkey FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id);
ALTER TABLE public.inventario_meli_map ADD CONSTRAINT inventario_meli_map_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_meli_map ADD CONSTRAINT inventario_meli_map_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_series ADD CONSTRAINT inventario_series_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id);
ALTER TABLE public.inventario_series ADD CONSTRAINT inventario_series_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES inventario_lineas(id);
ALTER TABLE public.inventario_series ADD CONSTRAINT inventario_series_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.inventario_series ADD CONSTRAINT inventario_series_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_tn_map ADD CONSTRAINT inventario_tn_map_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_tn_map ADD CONSTRAINT inventario_tn_map_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE;
ALTER TABLE public.inventario_tn_map ADD CONSTRAINT inventario_tn_map_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.kit_recetas ADD CONSTRAINT kit_recetas_comp_producto_id_fkey FOREIGN KEY (comp_producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.kit_recetas ADD CONSTRAINT kit_recetas_kit_producto_id_fkey FOREIGN KEY (kit_producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.kit_recetas ADD CONSTRAINT kit_recetas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_kit_producto_id_fkey FOREIGN KEY (kit_producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_ubicacion_id_fkey FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE public.kitting_log ADD CONSTRAINT kitting_log_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD CONSTRAINT leads_asignado_a_fkey FOREIGN KEY (asignado_a) REFERENCES support_agents(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD CONSTRAINT leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE public.meli_credentials ADD CONSTRAINT meli_credentials_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.meli_credentials ADD CONSTRAINT meli_credentials_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.mercadopago_credentials ADD CONSTRAINT mercadopago_credentials_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE;
ALTER TABLE public.mercadopago_credentials ADD CONSTRAINT mercadopago_credentials_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.metodos_pago ADD CONSTRAINT metodos_pago_cuenta_origen_id_fkey FOREIGN KEY (cuenta_origen_id) REFERENCES cuentas_origen(id) ON DELETE SET NULL;
ALTER TABLE public.metodos_pago ADD CONSTRAINT metodos_pago_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.modo_credentials ADD CONSTRAINT modo_credentials_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.motivos_movimiento ADD CONSTRAINT motivos_movimiento_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id);
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES inventario_lineas(id);
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.movimientos_stock ADD CONSTRAINT movimientos_stock_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE SET NULL;
ALTER TABLE public.mp_billing_alertas ADD CONSTRAINT mp_billing_alertas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.orden_compra_items ADD CONSTRAINT orden_compra_items_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra(id) ON DELETE CASCADE;
ALTER TABLE public.orden_compra_items ADD CONSTRAINT orden_compra_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_aprobada_por_fkey FOREIGN KEY (aprobada_por) REFERENCES users(id);
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_oc_padre_id_fkey FOREIGN KEY (oc_padre_id) REFERENCES ordenes_compra(id) ON DELETE SET NULL;
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.platform_facturas ADD CONSTRAINT platform_facturas_biller_id_fkey FOREIGN KEY (biller_id) REFERENCES platform_billers(id) ON DELETE RESTRICT;
ALTER TABLE public.platform_facturas ADD CONSTRAINT platform_facturas_tenant_origen_id_fkey FOREIGN KEY (tenant_origen_id) REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE public.producto_estructuras ADD CONSTRAINT producto_estructuras_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.producto_estructuras ADD CONSTRAINT producto_estructuras_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.producto_grupos ADD CONSTRAINT producto_grupos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL;
ALTER TABLE public.producto_grupos ADD CONSTRAINT producto_grupos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.producto_precios_mayorista ADD CONSTRAINT producto_precios_mayorista_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.producto_precios_mayorista ADD CONSTRAINT producto_precios_mayorista_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.producto_stock_minimo_sucursal ADD CONSTRAINT producto_stock_minimo_sucursal_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.producto_stock_minimo_sucursal ADD CONSTRAINT producto_stock_minimo_sucursal_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE;
ALTER TABLE public.producto_stock_minimo_sucursal ADD CONSTRAINT producto_stock_minimo_sucursal_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.producto_ubicacion_sucursal ADD CONSTRAINT producto_ubicacion_sucursal_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.producto_ubicacion_sucursal ADD CONSTRAINT producto_ubicacion_sucursal_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE;
ALTER TABLE public.producto_ubicacion_sucursal ADD CONSTRAINT producto_ubicacion_sucursal_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.producto_ubicacion_sucursal ADD CONSTRAINT producto_ubicacion_sucursal_ubicacion_id_fkey FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE public.productos ADD CONSTRAINT productos_aging_profile_id_fkey FOREIGN KEY (aging_profile_id) REFERENCES aging_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.productos ADD CONSTRAINT productos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias(id);
ALTER TABLE public.productos ADD CONSTRAINT productos_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id);
ALTER TABLE public.productos ADD CONSTRAINT productos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES producto_grupos(id) ON DELETE SET NULL;
ALTER TABLE public.productos ADD CONSTRAINT productos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
ALTER TABLE public.productos ADD CONSTRAINT productos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.productos ADD CONSTRAINT productos_ubicacion_id_fkey FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id);
ALTER TABLE public.proveedor_cc_movimientos ADD CONSTRAINT proveedor_cc_movimientos_caja_sesion_id_fkey FOREIGN KEY (caja_sesion_id) REFERENCES caja_sesiones(id) ON DELETE SET NULL;
ALTER TABLE public.proveedor_cc_movimientos ADD CONSTRAINT proveedor_cc_movimientos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.proveedor_cc_movimientos ADD CONSTRAINT proveedor_cc_movimientos_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id) ON DELETE SET NULL;
ALTER TABLE public.proveedor_cc_movimientos ADD CONSTRAINT proveedor_cc_movimientos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_cc_movimientos ADD CONSTRAINT proveedor_cc_movimientos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_contactos ADD CONSTRAINT proveedor_contactos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_contactos ADD CONSTRAINT proveedor_contactos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_cuentas_bancarias ADD CONSTRAINT proveedor_cuentas_bancarias_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_cuentas_bancarias ADD CONSTRAINT proveedor_cuentas_bancarias_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_productos ADD CONSTRAINT proveedor_productos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_productos ADD CONSTRAINT proveedor_productos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE public.proveedor_productos ADD CONSTRAINT proveedor_productos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.puntos_venta_afip ADD CONSTRAINT puntos_venta_afip_emisor_id_fkey FOREIGN KEY (emisor_id) REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE public.puntos_venta_afip ADD CONSTRAINT puntos_venta_afip_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.puntos_venta_afip ADD CONSTRAINT puntos_venta_afip_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id) ON DELETE SET NULL;
ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_inventario_linea_id_fkey FOREIGN KEY (inventario_linea_id) REFERENCES inventario_lineas(id) ON DELETE SET NULL;
ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_oc_item_id_fkey FOREIGN KEY (oc_item_id) REFERENCES orden_compra_items(id) ON DELETE SET NULL;
ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES recepciones(id) ON DELETE CASCADE;
ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_ubicacion_id_fkey FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE public.recepciones ADD CONSTRAINT recepciones_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.recepciones ADD CONSTRAINT recepciones_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id) ON DELETE SET NULL;
ALTER TABLE public.recepciones ADD CONSTRAINT recepciones_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.recepciones ADD CONSTRAINT recepciones_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.recepciones ADD CONSTRAINT recepciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.recursos ADD CONSTRAINT recursos_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.recursos ADD CONSTRAINT recursos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.recursos ADD CONSTRAINT recursos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.recursos ADD CONSTRAINT recursos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.repartidores ADD CONSTRAINT repartidores_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL;
ALTER TABLE public.repartidores ADD CONSTRAINT repartidores_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.retenciones_sufridas ADD CONSTRAINT retenciones_sufridas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.roles_custom ADD CONSTRAINT roles_custom_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_anticipos ADD CONSTRAINT rrhh_anticipos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_anticipos ADD CONSTRAINT rrhh_anticipos_descontado_en_salario_id_fkey FOREIGN KEY (descontado_en_salario_id) REFERENCES rrhh_salarios(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_anticipos ADD CONSTRAINT rrhh_anticipos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_anticipos ADD CONSTRAINT rrhh_anticipos_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_anticipos ADD CONSTRAINT rrhh_anticipos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_asistencia ADD CONSTRAINT rrhh_asistencia_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
ALTER TABLE public.rrhh_asistencia ADD CONSTRAINT rrhh_asistencia_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_capacitaciones ADD CONSTRAINT rrhh_capacitaciones_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_capacitaciones ADD CONSTRAINT rrhh_capacitaciones_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_capacitaciones ADD CONSTRAINT rrhh_capacitaciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_conceptos ADD CONSTRAINT rrhh_conceptos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_departamentos ADD CONSTRAINT rrhh_departamentos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_documentos ADD CONSTRAINT rrhh_documentos_catalogo_id_fkey FOREIGN KEY (catalogo_id) REFERENCES rrhh_documentos_catalogo(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_documentos ADD CONSTRAINT rrhh_documentos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_documentos ADD CONSTRAINT rrhh_documentos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_documentos ADD CONSTRAINT rrhh_documentos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_documentos_catalogo ADD CONSTRAINT rrhh_documentos_catalogo_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_evaluaciones ADD CONSTRAINT rrhh_evaluaciones_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_evaluaciones ADD CONSTRAINT rrhh_evaluaciones_evaluador_id_fkey FOREIGN KEY (evaluador_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_evaluaciones ADD CONSTRAINT rrhh_evaluaciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_feriados ADD CONSTRAINT rrhh_feriados_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.rrhh_feriados ADD CONSTRAINT rrhh_feriados_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_fichadas ADD CONSTRAINT rrhh_fichadas_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_fichadas ADD CONSTRAINT rrhh_fichadas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_fichadas ADD CONSTRAINT rrhh_fichadas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_horas_extra ADD CONSTRAINT rrhh_horas_extra_aprobada_por_fkey FOREIGN KEY (aprobada_por) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_horas_extra ADD CONSTRAINT rrhh_horas_extra_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_horas_extra ADD CONSTRAINT rrhh_horas_extra_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_liquidaciones_finales ADD CONSTRAINT rrhh_liquidaciones_finales_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_liquidaciones_finales ADD CONSTRAINT rrhh_liquidaciones_finales_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_liquidaciones_finales ADD CONSTRAINT rrhh_liquidaciones_finales_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_liquidaciones_finales ADD CONSTRAINT rrhh_liquidaciones_finales_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_puestos ADD CONSTRAINT rrhh_puestos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_salario_items ADD CONSTRAINT rrhh_salario_items_concepto_id_fkey FOREIGN KEY (concepto_id) REFERENCES rrhh_conceptos(id);
ALTER TABLE public.rrhh_salario_items ADD CONSTRAINT rrhh_salario_items_salario_id_fkey FOREIGN KEY (salario_id) REFERENCES rrhh_salarios(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_salario_items ADD CONSTRAINT rrhh_salario_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_salarios ADD CONSTRAINT rrhh_salarios_caja_movimiento_id_fkey FOREIGN KEY (caja_movimiento_id) REFERENCES caja_movimientos(id);
ALTER TABLE public.rrhh_salarios ADD CONSTRAINT rrhh_salarios_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
ALTER TABLE public.rrhh_salarios ADD CONSTRAINT rrhh_salarios_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_salarios ADD CONSTRAINT rrhh_salarios_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_tipos_contrato ADD CONSTRAINT rrhh_tipos_contrato_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_vacaciones_saldo ADD CONSTRAINT rrhh_vacaciones_saldo_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
ALTER TABLE public.rrhh_vacaciones_saldo ADD CONSTRAINT rrhh_vacaciones_saldo_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.rrhh_vacaciones_solicitud ADD CONSTRAINT rrhh_vacaciones_solicitud_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES users(id);
ALTER TABLE public.rrhh_vacaciones_solicitud ADD CONSTRAINT rrhh_vacaciones_solicitud_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
ALTER TABLE public.rrhh_vacaciones_solicitud ADD CONSTRAINT rrhh_vacaciones_solicitud_preaprobado_por_fkey FOREIGN KEY (preaprobado_por) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rrhh_vacaciones_solicitud ADD CONSTRAINT rrhh_vacaciones_solicitud_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.servicio_items ADD CONSTRAINT servicio_items_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE public.servicio_items ADD CONSTRAINT servicio_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.servicio_presupuestos ADD CONSTRAINT servicio_presupuestos_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE public.servicio_presupuestos ADD CONSTRAINT servicio_presupuestos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE public.servicio_presupuestos ADD CONSTRAINT servicio_presupuestos_servicio_item_id_fkey FOREIGN KEY (servicio_item_id) REFERENCES servicio_items(id) ON DELETE SET NULL;
ALTER TABLE public.servicio_presupuestos ADD CONSTRAINT servicio_presupuestos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.sucursales ADD CONSTRAINT sucursales_emisor_fiscal_id_fkey FOREIGN KEY (emisor_fiscal_id) REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE public.sucursales ADD CONSTRAINT sucursales_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.support_agents ADD CONSTRAINT support_agents_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_asignado_a_fkey FOREIGN KEY (asignado_a) REFERENCES support_agents(id) ON DELETE SET NULL;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES support_agents(id) ON DELETE SET NULL;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.tenant_certificates ADD CONSTRAINT tenant_certificates_emisor_id_fkey FOREIGN KEY (emisor_id) REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE public.tenant_certificates ADD CONSTRAINT tenant_certificates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES planes(id);
ALTER TABLE public.tiendanube_credentials ADD CONSTRAINT tiendanube_credentials_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE;
ALTER TABLE public.tiendanube_credentials ADD CONSTRAINT tiendanube_credentials_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados_inventario(id);
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_linea_destino_id_fkey FOREIGN KEY (linea_destino_id) REFERENCES inventario_lineas(id) ON DELETE SET NULL;
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_linea_origen_id_fkey FOREIGN KEY (linea_origen_id) REFERENCES inventario_lineas(id) ON DELETE SET NULL;
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_traslado_id_fkey FOREIGN KEY (traslado_id) REFERENCES traslados(id) ON DELETE CASCADE;
ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_ubicacion_sugerida_id_fkey FOREIGN KEY (ubicacion_sugerida_id) REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE public.traslados ADD CONSTRAINT traslados_despachado_por_fkey FOREIGN KEY (despachado_por) REFERENCES users(id);
ALTER TABLE public.traslados ADD CONSTRAINT traslados_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE SET NULL;
ALTER TABLE public.traslados ADD CONSTRAINT traslados_recibido_por_fkey FOREIGN KEY (recibido_por) REFERENCES users(id);
ALTER TABLE public.traslados ADD CONSTRAINT traslados_sucursal_destino_id_fkey FOREIGN KEY (sucursal_destino_id) REFERENCES sucursales(id);
ALTER TABLE public.traslados ADD CONSTRAINT traslados_sucursal_origen_id_fkey FOREIGN KEY (sucursal_origen_id) REFERENCES sucursales(id);
ALTER TABLE public.traslados ADD CONSTRAINT traslados_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ubicaciones ADD CONSTRAINT ubicaciones_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.ubicaciones ADD CONSTRAINT ubicaciones_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.unidades_medida ADD CONSTRAINT unidades_medida_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.users ADD CONSTRAINT users_caja_preferida_id_fkey FOREIGN KEY (caja_preferida_id) REFERENCES cajas(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.users ADD CONSTRAINT users_rol_custom_id_fkey FOREIGN KEY (rol_custom_id) REFERENCES roles_custom(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD CONSTRAINT users_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.venta_auditoria ADD CONSTRAINT venta_auditoria_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.venta_auditoria ADD CONSTRAINT venta_auditoria_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE;
ALTER TABLE public.venta_item_despachos ADD CONSTRAINT venta_item_despachos_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES inventario_lineas(id) ON DELETE SET NULL;
ALTER TABLE public.venta_item_despachos ADD CONSTRAINT venta_item_despachos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;
ALTER TABLE public.venta_item_despachos ADD CONSTRAINT venta_item_despachos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.venta_item_despachos ADD CONSTRAINT venta_item_despachos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE;
ALTER TABLE public.venta_item_despachos ADD CONSTRAINT venta_item_despachos_venta_item_id_fkey FOREIGN KEY (venta_item_id) REFERENCES venta_items(id) ON DELETE CASCADE;
ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES inventario_lineas(id);
ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE;
ALTER TABLE public.venta_series ADD CONSTRAINT venta_series_serie_id_fkey FOREIGN KEY (serie_id) REFERENCES inventario_series(id);
ALTER TABLE public.venta_series ADD CONSTRAINT venta_series_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.venta_series ADD CONSTRAINT venta_series_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE;
ALTER TABLE public.venta_series ADD CONSTRAINT venta_series_venta_item_id_fkey FOREIGN KEY (venta_item_id) REFERENCES venta_items(id) ON DELETE CASCADE;
ALTER TABLE public.ventas ADD CONSTRAINT ventas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
ALTER TABLE public.ventas ADD CONSTRAINT ventas_emisor_id_fkey FOREIGN KEY (emisor_id) REFERENCES emisores_fiscales(id) ON DELETE SET NULL;
ALTER TABLE public.ventas ADD CONSTRAINT ventas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
ALTER TABLE public.ventas ADD CONSTRAINT ventas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ventas ADD CONSTRAINT ventas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES users(id);
ALTER TABLE public.ventas_externas_logs ADD CONSTRAINT ventas_externas_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ventas_externas_logs ADD CONSTRAINT ventas_externas_logs_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE SET NULL;
ALTER TABLE public.ventas_recurrentes ADD CONSTRAINT ventas_recurrentes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE public.ventas_recurrentes ADD CONSTRAINT ventas_recurrentes_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;
ALTER TABLE public.ventas_recurrentes ADD CONSTRAINT ventas_recurrentes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ============================================================
-- INDICES
-- ============================================================
CREATE INDEX actividad_log_entidad_idx ON public.actividad_log USING btree (tenant_id, entidad);
CREATE INDEX actividad_log_lpn_idx ON public.actividad_log USING btree (tenant_id, lpn);
CREATE INDEX actividad_log_producto_idx ON public.actividad_log USING btree (tenant_id, producto_id);
CREATE INDEX actividad_log_serie_idx ON public.actividad_log USING btree (tenant_id, nro_serie);
CREATE INDEX actividad_log_tenant_idx ON public.actividad_log USING btree (tenant_id, created_at DESC);
CREATE INDEX actividad_log_transaccion_idx ON public.actividad_log USING btree (transaccion_id);
CREATE INDEX actividad_log_usuario_idx ON public.actividad_log USING btree (tenant_id, usuario_id);
CREATE UNIQUE INDEX clientes_dni_tenant ON public.clientes USING btree (tenant_id, dni) WHERE (dni IS NOT NULL);
CREATE UNIQUE INDEX empleados_tenant_user_unique ON public.empleados USING btree (tenant_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX idx_actividad_log_usuario_id ON public.actividad_log USING btree (usuario_id);
CREATE INDEX idx_admin_audit_agent ON public.admin_audit_log USING btree (agent_id, created_at DESC);
CREATE INDEX idx_admin_audit_tenant ON public.admin_audit_log USING btree (target_tenant_id, created_at DESC);
CREATE INDEX idx_aging_profile_reglas_estado_id ON public.aging_profile_reglas USING btree (estado_id);
CREATE INDEX idx_aging_profile_reglas_profile_id ON public.aging_profile_reglas USING btree (profile_id);
CREATE INDEX idx_aging_profile_reglas_tenant_id ON public.aging_profile_reglas USING btree (tenant_id);
CREATE INDEX idx_aging_profiles_tenant_id ON public.aging_profiles USING btree (tenant_id);
CREATE INDEX idx_alertas_producto_id ON public.alertas USING btree (producto_id);
CREATE INDEX idx_alertas_tenant ON public.alertas USING btree (tenant_id, resuelta);
CREATE INDEX idx_api_keys_activo ON public.api_keys USING btree (tenant_id, activo);
CREATE INDEX idx_api_keys_key_hash ON public.api_keys USING btree (key_hash);
CREATE INDEX idx_api_keys_tenant ON public.api_keys USING btree (tenant_id);
CREATE INDEX idx_archivos_biblioteca_created_by ON public.archivos_biblioteca USING btree (created_by);
CREATE INDEX idx_archivos_biblioteca_tenant ON public.archivos_biblioteca USING btree (tenant_id, tipo);
CREATE UNIQUE INDEX uq_atributos_variante_valores_tenant_atributo_valor ON public.atributos_variante_valores USING btree (tenant_id, atributo, lower(btrim(valor)));
CREATE INDEX idx_atributos_variante_valores_tenant_atributo ON public.atributos_variante_valores USING btree (tenant_id, atributo) WHERE activo;
CREATE INDEX idx_aut_inv_tenant_estado ON public.autorizaciones_inventario USING btree (tenant_id, estado);
CREATE INDEX idx_autoriz_cc_proveedor ON public.autorizaciones_cc USING btree (proveedor_id, estado);
CREATE INDEX idx_autoriz_cc_tenant_estado ON public.autorizaciones_cc USING btree (tenant_id, estado);
CREATE INDEX idx_autoriz_gasto_gasto ON public.autorizaciones_gasto USING btree (gasto_id) WHERE (gasto_id IS NOT NULL);
CREATE INDEX idx_autoriz_gasto_solicitante ON public.autorizaciones_gasto USING btree (solicitante_id);
CREATE INDEX idx_autoriz_gasto_tenant_estado ON public.autorizaciones_gasto USING btree (tenant_id, estado);
CREATE INDEX idx_autorizaciones_cc_aprobador_id ON public.autorizaciones_cc USING btree (aprobador_id);
CREATE INDEX idx_autorizaciones_cc_oc_id ON public.autorizaciones_cc USING btree (oc_id);
CREATE INDEX idx_autorizaciones_cc_solicitante_id ON public.autorizaciones_cc USING btree (solicitante_id);
CREATE INDEX idx_autorizaciones_gasto_aprobador_id ON public.autorizaciones_gasto USING btree (aprobador_id);
CREATE INDEX idx_autorizaciones_gasto_sucursal_id ON public.autorizaciones_gasto USING btree (sucursal_id);
CREATE INDEX idx_autorizaciones_inventario_aprobado_por ON public.autorizaciones_inventario USING btree (aprobado_por);
CREATE INDEX idx_autorizaciones_inventario_linea_id ON public.autorizaciones_inventario USING btree (linea_id);
CREATE INDEX idx_autorizaciones_inventario_solicitado_por ON public.autorizaciones_inventario USING btree (solicitado_por);
CREATE INDEX idx_billing_cancelaciones_tenant ON public.billing_cancelaciones USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_billing_manual_pagos_registrado_por ON public.billing_manual_pagos USING btree (registrado_por);
CREATE INDEX idx_billing_manual_pagos_tenant ON public.billing_manual_pagos USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_boveda_arqueos_cuenta ON public.boveda_arqueos USING btree (cuenta_origen_id) WHERE (cuenta_origen_id IS NOT NULL);
CREATE INDEX idx_boveda_arqueos_tenant ON public.boveda_arqueos USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_boveda_arqueos_usuario_id ON public.boveda_arqueos USING btree (usuario_id);
CREATE INDEX idx_boveda_retiros_cuenta ON public.boveda_retiros USING btree (cuenta_origen_id) WHERE (cuenta_origen_id IS NOT NULL);
CREATE INDEX idx_boveda_retiros_movimiento_id ON public.boveda_retiros USING btree (movimiento_id);
CREATE INDEX idx_boveda_retiros_tenant ON public.boveda_retiros USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_boveda_retiros_usuario ON public.boveda_retiros USING btree (usuario_id);
CREATE INDEX idx_caja_arqueos_sesion ON public.caja_arqueos USING btree (sesion_id);
CREATE INDEX idx_caja_arqueos_tenant ON public.caja_arqueos USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_caja_arqueos_usuario_id ON public.caja_arqueos USING btree (usuario_id);
CREATE INDEX idx_caja_movimientos_cuenta_origen ON public.caja_movimientos USING btree (cuenta_origen_id) WHERE (cuenta_origen_id IS NOT NULL);
CREATE INDEX idx_caja_movimientos_tenant_id ON public.caja_movimientos USING btree (tenant_id);
CREATE INDEX idx_caja_movimientos_usuario_id ON public.caja_movimientos USING btree (usuario_id);
CREATE INDEX idx_caja_sesiones_abierta_por ON public.caja_sesiones USING btree (abierta_por) WHERE (abierta_por IS NOT NULL);
CREATE INDEX idx_caja_sesiones_cerrado_por_id ON public.caja_sesiones USING btree (cerrado_por_id);
CREATE INDEX idx_caja_sesiones_numero ON public.caja_sesiones USING btree (tenant_id, sucursal_id, numero DESC) WHERE (numero IS NOT NULL);
CREATE INDEX idx_caja_sesiones_sucursal ON public.caja_sesiones USING btree (sucursal_id);
CREATE INDEX idx_caja_sesiones_usuario_id ON public.caja_sesiones USING btree (usuario_id);
CREATE INDEX idx_caja_traspasos_mov_destino ON public.caja_traspasos USING btree (movimiento_destino_id) WHERE (movimiento_destino_id IS NOT NULL);
CREATE INDEX idx_caja_traspasos_mov_origen ON public.caja_traspasos USING btree (movimiento_origen_id) WHERE (movimiento_origen_id IS NOT NULL);
CREATE INDEX idx_caja_traspasos_usuario_id ON public.caja_traspasos USING btree (usuario_id);
CREATE INDEX idx_cajas_moneda ON public.cajas USING btree (tenant_id, moneda);
CREATE INDEX idx_cajas_sucursal ON public.cajas USING btree (sucursal_id);
CREATE INDEX idx_cajas_tenant ON public.cajas USING btree (tenant_id);
CREATE INDEX idx_canales_venta_tenant ON public.canales_venta USING btree (tenant_id);
CREATE INDEX idx_categorias_gasto_activo ON public.categorias_gasto USING btree (tenant_id, activo) WHERE activo;
CREATE INDEX idx_categorias_gasto_tenant ON public.categorias_gasto USING btree (tenant_id);
CREATE INDEX idx_categorias_tenant_id ON public.categorias USING btree (tenant_id);
CREATE INDEX idx_cheques_created_by ON public.cheques USING btree (created_by);
CREATE INDEX idx_cheques_endosado_a_proveedor_id ON public.cheques USING btree (endosado_a_proveedor_id);
CREATE INDEX idx_cheques_estado ON public.cheques USING btree (tenant_id, estado);
CREATE INDEX idx_cheques_fecha_cobro ON public.cheques USING btree (tenant_id, fecha_cobro);
CREATE INDEX idx_cheques_gasto ON public.cheques USING btree (gasto_id) WHERE (gasto_id IS NOT NULL);
CREATE INDEX idx_cheques_oc ON public.cheques USING btree (oc_id) WHERE (oc_id IS NOT NULL);
CREATE INDEX idx_cheques_proveedor_id ON public.cheques USING btree (proveedor_id);
CREATE INDEX idx_cheques_sucursal_id ON public.cheques USING btree (sucursal_id);
CREATE INDEX idx_cheques_tenant ON public.cheques USING btree (tenant_id);
CREATE INDEX idx_cierres_contables_cerrado_por ON public.cierres_contables USING btree (cerrado_por);
CREATE INDEX idx_cierres_tenant_periodo ON public.cierres_contables USING btree (tenant_id, periodo DESC);
CREATE INDEX idx_cli_dom_cliente ON public.cliente_domicilios USING btree (cliente_id);
CREATE INDEX idx_cli_dom_tenant ON public.cliente_domicilios USING btree (tenant_id);
CREATE INDEX idx_cli_notas_cliente ON public.cliente_notas USING btree (cliente_id);
CREATE INDEX idx_cliente_creditos_cliente ON public.cliente_creditos USING btree (tenant_id, cliente_id);
CREATE INDEX idx_cliente_creditos_cliente_id ON public.cliente_creditos USING btree (cliente_id);
CREATE INDEX idx_cliente_creditos_usuario_id ON public.cliente_creditos USING btree (usuario_id);
CREATE INDEX idx_cliente_creditos_venta_id ON public.cliente_creditos USING btree (venta_id);
CREATE INDEX idx_cliente_notas_tenant_id ON public.cliente_notas USING btree (tenant_id);
CREATE INDEX idx_cliente_notas_usuario_id ON public.cliente_notas USING btree (usuario_id);
CREATE INDEX idx_clientes_activo ON public.clientes USING btree (tenant_id) WHERE activo;
CREATE INDEX idx_clientes_baja_por ON public.clientes USING btree (baja_por);
CREATE INDEX idx_clientes_cc ON public.clientes USING btree (tenant_id) WHERE (cuenta_corriente_habilitada = true);
CREATE INDEX idx_clientes_cuenta_token ON public.clientes USING btree (cuenta_token) WHERE (cuenta_token IS NOT NULL);
CREATE UNIQUE INDEX idx_clientes_email_unique ON public.clientes USING btree (tenant_id, email) WHERE (email IS NOT NULL);
CREATE INDEX idx_clientes_sucursal ON public.clientes USING btree (sucursal_id);
CREATE INDEX idx_codigo_perfiles_proveedor ON public.codigo_perfiles USING btree (tenant_id, proveedor_id);
CREATE INDEX idx_codigo_perfiles_proveedor_id ON public.codigo_perfiles USING btree (proveedor_id);
CREATE INDEX idx_codigo_perfiles_tenant ON public.codigo_perfiles USING btree (tenant_id);
CREATE INDEX idx_combo_items_combo_id ON public.combo_items USING btree (combo_id);
CREATE INDEX idx_combo_items_producto_id ON public.combo_items USING btree (producto_id);
CREATE INDEX idx_combo_items_tenant_id ON public.combo_items USING btree (tenant_id);
CREATE INDEX idx_combos_producto_id ON public.combos USING btree (producto_id);
CREATE INDEX idx_combos_sucursal ON public.combos USING btree (sucursal_id) WHERE (sucursal_id IS NOT NULL);
CREATE INDEX idx_combos_tenant_id ON public.combos USING btree (tenant_id);
CREATE INDEX idx_conteo_items_conteo ON public.inventario_conteo_items USING btree (conteo_id);
CREATE INDEX idx_conteos_bloqueo ON public.inventario_conteos USING btree (tenant_id, sucursal_id, estado) WHERE (bloquea_movimientos = true);
CREATE INDEX idx_conteos_tenant ON public.inventario_conteos USING btree (tenant_id);
CREATE INDEX idx_courier_credenciales_tenant ON public.courier_credenciales USING btree (tenant_id);
CREATE INDEX idx_courier_factura_lineas_envio_id ON public.courier_factura_lineas USING btree (envio_id);
CREATE INDEX idx_courier_factura_lineas_factura ON public.courier_factura_lineas USING btree (factura_id);
CREATE INDEX idx_courier_factura_lineas_tenant_id ON public.courier_factura_lineas USING btree (tenant_id);
CREATE INDEX idx_courier_facturas_created_by ON public.courier_facturas USING btree (created_by);
CREATE INDEX idx_courier_facturas_sucursal_id ON public.courier_facturas USING btree (sucursal_id);
CREATE INDEX idx_courier_facturas_tenant ON public.courier_facturas USING btree (tenant_id);
CREATE INDEX idx_courier_tarifas_sucursal_id ON public.courier_tarifas USING btree (sucursal_id);
CREATE INDEX idx_courier_tarifas_tenant ON public.courier_tarifas USING btree (tenant_id, sucursal_id);
CREATE INDEX idx_cuentas_origen_activo ON public.cuentas_origen USING btree (tenant_id, activo) WHERE (activo = true);
CREATE INDEX idx_cuentas_origen_tenant ON public.cuentas_origen USING btree (tenant_id);
CREATE INDEX idx_devolucion_items_dev ON public.devolucion_items USING btree (devolucion_id);
CREATE INDEX idx_devolucion_items_inventario_linea_nueva_id ON public.devolucion_items USING btree (inventario_linea_nueva_id);
CREATE INDEX idx_devolucion_items_producto_id ON public.devolucion_items USING btree (producto_id);
CREATE INDEX idx_devolucion_proveedor_items_producto_id ON public.devolucion_proveedor_items USING btree (producto_id);
CREATE INDEX idx_devoluciones_created_by ON public.devoluciones USING btree (created_by);
CREATE INDEX idx_devoluciones_nc_cae ON public.devoluciones USING btree (nc_cae) WHERE (nc_cae IS NOT NULL);
CREATE INDEX idx_devoluciones_proveedor_caja_sesion_id ON public.devoluciones_proveedor USING btree (caja_sesion_id);
CREATE INDEX idx_devoluciones_proveedor_created_by ON public.devoluciones_proveedor USING btree (created_by);
CREATE INDEX idx_devoluciones_proveedor_oc_id ON public.devoluciones_proveedor USING btree (oc_id);
CREATE INDEX idx_devoluciones_proveedor_oc_reposicion_id ON public.devoluciones_proveedor USING btree (oc_reposicion_id);
CREATE INDEX idx_devoluciones_proveedor_recepcion_id ON public.devoluciones_proveedor USING btree (recepcion_id);
CREATE INDEX idx_devoluciones_proveedor_sucursal_id ON public.devoluciones_proveedor USING btree (sucursal_id);
CREATE INDEX idx_devoluciones_tenant ON public.devoluciones USING btree (tenant_id);
CREATE INDEX idx_devoluciones_venta ON public.devoluciones USING btree (venta_id);
CREATE INDEX idx_devprov_items_dev ON public.devolucion_proveedor_items USING btree (devolucion_id);
CREATE INDEX idx_devprov_proveedor ON public.devoluciones_proveedor USING btree (proveedor_id);
CREATE INDEX idx_devprov_tenant ON public.devoluciones_proveedor USING btree (tenant_id);
CREATE INDEX idx_emisores_fiscales_tenant_id ON public.emisores_fiscales USING btree (tenant_id);
CREATE INDEX idx_empleados_activo ON public.empleados USING btree (activo);
CREATE INDEX idx_empleados_departamento ON public.empleados USING btree (departamento_id);
CREATE INDEX idx_empleados_fecha_nacimiento ON public.empleados USING btree (fecha_nacimiento);
CREATE INDEX idx_empleados_puesto ON public.empleados USING btree (puesto_id);
CREATE INDEX idx_empleados_supervisor_id ON public.empleados USING btree (supervisor_id);
CREATE INDEX idx_empleados_tenant ON public.empleados USING btree (tenant_id);
CREATE INDEX idx_empleados_user_id ON public.empleados USING btree (user_id);
CREATE INDEX idx_envio_incidencias_envio ON public.envio_incidencias USING btree (envio_id);
CREATE INDEX idx_envio_incidencias_tenant_id ON public.envio_incidencias USING btree (tenant_id);
CREATE INDEX idx_envio_items_envio ON public.envio_items USING btree (envio_id);
CREATE INDEX idx_envio_items_producto_id ON public.envio_items USING btree (producto_id);
CREATE INDEX idx_envio_items_tenant_id ON public.envio_items USING btree (tenant_id);
CREATE INDEX idx_envio_otp_envio ON public.envio_otp USING btree (envio_id);
CREATE INDEX idx_envio_otp_tenant_id ON public.envio_otp USING btree (tenant_id);
CREATE INDEX idx_envio_pod_fotos_created_by ON public.envio_pod_fotos USING btree (created_by);
CREATE INDEX idx_envio_pod_fotos_envio ON public.envio_pod_fotos USING btree (envio_id, orden);
CREATE INDEX idx_envio_pod_fotos_tenant ON public.envio_pod_fotos USING btree (tenant_id);
CREATE INDEX idx_envios_created_by ON public.envios USING btree (created_by);
CREATE INDEX idx_envios_destino_id ON public.envios USING btree (destino_id);
CREATE INDEX idx_envios_estado ON public.envios USING btree (tenant_id, estado);
CREATE INDEX idx_envios_fecha ON public.envios USING btree (tenant_id, created_at);
CREATE INDEX idx_envios_gasto_combustible_id ON public.envios USING btree (gasto_combustible_id);
CREATE INDEX idx_envios_gasto_id ON public.envios USING btree (gasto_id) WHERE (gasto_id IS NOT NULL);
CREATE INDEX idx_envios_pago ON public.envios USING btree (tenant_id, costo_pagado) WHERE (costo_cotizado > (0)::numeric);
CREATE INDEX idx_envios_recurso_id ON public.envios USING btree (recurso_id);
CREATE INDEX idx_envios_repartidor_id ON public.envios USING btree (repartidor_id);
CREATE INDEX idx_envios_sucursal_destino_id ON public.envios USING btree (sucursal_destino_id);
CREATE INDEX idx_envios_sucursal_id ON public.envios USING btree (sucursal_id);
CREATE INDEX idx_envios_tenant ON public.envios USING btree (tenant_id);
CREATE INDEX idx_envios_token ON public.envios USING btree (token_transportista) WHERE (token_transportista IS NOT NULL);
CREATE INDEX idx_envios_venta ON public.envios USING btree (venta_id);
CREATE INDEX idx_estados_inventario_tenant_id ON public.estados_inventario USING btree (tenant_id);
CREATE INDEX idx_feriados_tenant_fecha ON public.rrhh_feriados USING btree (tenant_id, fecha);
CREATE INDEX idx_gasto_cuotas_gasto ON public.gasto_cuotas USING btree (gasto_id);
CREATE INDEX idx_gasto_cuotas_tenant_id ON public.gasto_cuotas USING btree (tenant_id);
CREATE INDEX idx_gastos_categoria_id ON public.gastos USING btree (categoria_id) WHERE (categoria_id IS NOT NULL);
CREATE INDEX idx_gastos_emisor_id ON public.gastos USING btree (emisor_id);
CREATE INDEX idx_gastos_estado_pago ON public.gastos USING btree (tenant_id, estado_pago);
CREATE INDEX idx_gastos_fijos_categoria_id ON public.gastos_fijos USING btree (categoria_id) WHERE (categoria_id IS NOT NULL);
CREATE INDEX idx_gastos_fijos_sucursal_id ON public.gastos_fijos USING btree (sucursal_id);
CREATE INDEX idx_gastos_fijos_tenant ON public.gastos_fijos USING btree (tenant_id);
CREATE INDEX idx_gastos_padre ON public.gastos USING btree (gasto_padre_id) WHERE (gasto_padre_id IS NOT NULL);
CREATE INDEX idx_gastos_recepcion ON public.gastos USING btree (recepcion_id) WHERE (recepcion_id IS NOT NULL);
CREATE INDEX idx_gastos_recurso ON public.gastos USING btree (recurso_id) WHERE (recurso_id IS NOT NULL);
CREATE INDEX idx_gastos_recurso_capit ON public.gastos USING btree (recurso_id, capitaliza_recurso) WHERE (recurso_id IS NOT NULL);
CREATE INDEX idx_gastos_sucursal ON public.gastos USING btree (sucursal_id);
CREATE INDEX idx_gastos_usuario_id ON public.gastos USING btree (usuario_id);
CREATE INDEX idx_grupo_estado_items_estado_id ON public.grupo_estado_items USING btree (estado_id);
CREATE INDEX idx_grupos_estados_tenant_id ON public.grupos_estados USING btree (tenant_id);
CREATE INDEX idx_hoja_ruta_envios_envio_id ON public.hoja_ruta_envios USING btree (envio_id);
CREATE INDEX idx_hoja_ruta_envios_hoja ON public.hoja_ruta_envios USING btree (hoja_id);
CREATE INDEX idx_hoja_ruta_envios_tenant_id ON public.hoja_ruta_envios USING btree (tenant_id);
CREATE INDEX idx_hojas_ruta_created_by ON public.hojas_ruta USING btree (created_by);
CREATE INDEX idx_hojas_ruta_repartidor_id ON public.hojas_ruta USING btree (repartidor_id);
CREATE INDEX idx_hojas_ruta_sucursal_id ON public.hojas_ruta USING btree (sucursal_id);
CREATE INDEX idx_hojas_ruta_tenant ON public.hojas_ruta USING btree (tenant_id);
CREATE INDEX idx_hojas_ruta_token ON public.hojas_ruta USING btree (token) WHERE (token IS NOT NULL);
CREATE INDEX idx_integration_job_queue_sucursal_id ON public.integration_job_queue USING btree (sucursal_id);
CREATE INDEX idx_inv_lineas_estructura ON public.inventario_lineas USING btree (estructura_id) WHERE (estructura_id IS NOT NULL);
CREATE INDEX idx_inventario_conteo_items_contado_por ON public.inventario_conteo_items USING btree (contado_por);
CREATE INDEX idx_inventario_conteo_items_inventario_linea_id ON public.inventario_conteo_items USING btree (inventario_linea_id);
CREATE INDEX idx_inventario_conteo_items_producto_id ON public.inventario_conteo_items USING btree (producto_id);
CREATE INDEX idx_inventario_conteo_items_reconteo_por ON public.inventario_conteo_items USING btree (reconteo_por);
CREATE INDEX idx_inventario_conteos_created_by ON public.inventario_conteos USING btree (created_by);
CREATE INDEX idx_inventario_conteos_producto_id ON public.inventario_conteos USING btree (producto_id);
CREATE INDEX idx_inventario_conteos_sucursal_id ON public.inventario_conteos USING btree (sucursal_id);
CREATE INDEX idx_inventario_conteos_ubicacion_id ON public.inventario_conteos USING btree (ubicacion_id);
CREATE INDEX idx_inventario_lineas_estado_id ON public.inventario_lineas USING btree (estado_id);
CREATE INDEX idx_inventario_lineas_proveedor_id ON public.inventario_lineas USING btree (proveedor_id);
CREATE INDEX idx_inventario_lineas_sucursal ON public.inventario_lineas USING btree (sucursal_id);
CREATE INDEX idx_inventario_lineas_ubicacion_id ON public.inventario_lineas USING btree (ubicacion_id);
CREATE INDEX idx_inventario_series_estado_id ON public.inventario_series USING btree (estado_id);
CREATE INDEX idx_inventario_tn_map_producto_id ON public.inventario_tn_map USING btree (producto_id);
CREATE INDEX idx_inventario_tn_map_sucursal_id ON public.inventario_tn_map USING btree (sucursal_id);
CREATE INDEX idx_job_queue_pending ON public.integration_job_queue USING btree (tenant_id, integracion, next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE INDEX idx_kit_recetas_comp ON public.kit_recetas USING btree (comp_producto_id);
CREATE INDEX idx_kit_recetas_kit ON public.kit_recetas USING btree (kit_producto_id);
CREATE INDEX idx_kit_recetas_tenant ON public.kit_recetas USING btree (tenant_id);
CREATE INDEX idx_kitting_log_estado ON public.kitting_log USING btree (tenant_id, estado) WHERE (estado = 'en_armado'::text);
CREATE INDEX idx_kitting_log_kit ON public.kitting_log USING btree (kit_producto_id);
CREATE INDEX idx_kitting_log_tenant ON public.kitting_log USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_kitting_log_ubicacion_id ON public.kitting_log USING btree (ubicacion_id);
CREATE INDEX idx_kitting_log_usuario_id ON public.kitting_log USING btree (usuario_id);
CREATE INDEX idx_leads_asignado ON public.leads USING btree (asignado_a);
CREATE INDEX idx_leads_estado ON public.leads USING btree (estado);
CREATE INDEX idx_leads_tenant_id ON public.leads USING btree (tenant_id);
CREATE INDEX idx_lineas_parent_lpn ON public.inventario_lineas USING btree (tenant_id, parent_lpn_id) WHERE (parent_lpn_id IS NOT NULL);
CREATE INDEX idx_lineas_producto ON public.inventario_lineas USING btree (producto_id);
CREATE INDEX idx_lineas_tenant ON public.inventario_lineas USING btree (tenant_id);
CREATE INDEX idx_meli_credentials_expires ON public.meli_credentials USING btree (expires_at) WHERE (conectado = true);
CREATE INDEX idx_meli_credentials_sucursal_id ON public.meli_credentials USING btree (sucursal_id);
CREATE INDEX idx_meli_credentials_tenant ON public.meli_credentials USING btree (tenant_id);
CREATE INDEX idx_meli_map_item ON public.inventario_meli_map USING btree (meli_item_id);
CREATE INDEX idx_meli_map_producto ON public.inventario_meli_map USING btree (producto_id);
CREATE INDEX idx_meli_map_tenant ON public.inventario_meli_map USING btree (tenant_id);
CREATE INDEX idx_mercadopago_credentials_sucursal_id ON public.mercadopago_credentials USING btree (sucursal_id);
CREATE INDEX idx_metodos_pago_cuenta_origen ON public.metodos_pago USING btree (cuenta_origen_id) WHERE (cuenta_origen_id IS NOT NULL);
CREATE INDEX idx_metodos_pago_tenant ON public.metodos_pago USING btree (tenant_id);
CREATE INDEX idx_modo_credentials_tenant ON public.modo_credentials USING btree (tenant_id);
CREATE INDEX idx_motivos_movimiento_tenant_id ON public.motivos_movimiento USING btree (tenant_id);
CREATE INDEX idx_mov_caja_sesion ON public.caja_movimientos USING btree (sesion_id);
CREATE INDEX idx_movimientos_fecha ON public.movimientos_stock USING btree (created_at);
CREATE INDEX idx_movimientos_producto ON public.movimientos_stock USING btree (producto_id);
CREATE INDEX idx_movimientos_stock_estado_id ON public.movimientos_stock USING btree (estado_id);
CREATE INDEX idx_movimientos_stock_gasto_id ON public.movimientos_stock USING btree (gasto_id) WHERE (gasto_id IS NOT NULL);
CREATE INDEX idx_movimientos_stock_linea_id ON public.movimientos_stock USING btree (linea_id);
CREATE INDEX idx_movimientos_stock_proveedor_id ON public.movimientos_stock USING btree (proveedor_id);
CREATE INDEX idx_movimientos_stock_sucursal ON public.movimientos_stock USING btree (sucursal_id);
CREATE INDEX idx_movimientos_stock_usuario_id ON public.movimientos_stock USING btree (usuario_id);
CREATE INDEX idx_movimientos_stock_venta_id ON public.movimientos_stock USING btree (venta_id) WHERE (venta_id IS NOT NULL);
CREATE INDEX idx_movimientos_tenant ON public.movimientos_stock USING btree (tenant_id);
CREATE INDEX idx_mp_billing_alertas_tenant_id ON public.mp_billing_alertas USING btree (tenant_id);
CREATE INDEX idx_mp_creds_expires ON public.mercadopago_credentials USING btree (expires_at) WHERE (conectado = true);
CREATE INDEX idx_mp_creds_tenant ON public.mercadopago_credentials USING btree (tenant_id);
CREATE INDEX idx_notif_user ON public.notificaciones USING btree (user_id, leida, created_at DESC);
CREATE INDEX idx_notificaciones_tenant_id ON public.notificaciones USING btree (tenant_id);
CREATE INDEX idx_oc_estado_pago ON public.ordenes_compra USING btree (tenant_id, estado_pago);
CREATE INDEX idx_oc_items_orden ON public.orden_compra_items USING btree (orden_compra_id);
CREATE INDEX idx_oc_padre ON public.ordenes_compra USING btree (oc_padre_id) WHERE (oc_padre_id IS NOT NULL);
CREATE INDEX idx_oc_vencimiento ON public.ordenes_compra USING btree (tenant_id, fecha_vencimiento_pago) WHERE (fecha_vencimiento_pago IS NOT NULL);
CREATE INDEX idx_orden_compra_items_producto_id ON public.orden_compra_items USING btree (producto_id);
CREATE INDEX idx_ordenes_compra_aprobada_por ON public.ordenes_compra USING btree (aprobada_por);
CREATE INDEX idx_ordenes_compra_created_by ON public.ordenes_compra USING btree (created_by);
CREATE INDEX idx_ordenes_compra_proveedor ON public.ordenes_compra USING btree (proveedor_id);
CREATE INDEX idx_ordenes_compra_sucursal ON public.ordenes_compra USING btree (tenant_id, sucursal_id);
CREATE INDEX idx_ordenes_compra_sucursal_id ON public.ordenes_compra USING btree (sucursal_id);
CREATE INDEX idx_ordenes_compra_tenant ON public.ordenes_compra USING btree (tenant_id);
CREATE INDEX idx_pcc_oc ON public.proveedor_cc_movimientos USING btree (oc_id) WHERE (oc_id IS NOT NULL);
CREATE INDEX idx_pcc_tenant_proveedor ON public.proveedor_cc_movimientos USING btree (tenant_id, proveedor_id);
CREATE INDEX idx_pcc_vencimiento ON public.proveedor_cc_movimientos USING btree (tenant_id, fecha_vencimiento) WHERE (fecha_vencimiento IS NOT NULL);
CREATE INDEX idx_platform_facturas_biller_fecha ON public.platform_facturas USING btree (biller_id, created_at DESC);
CREATE INDEX idx_platform_facturas_tenant_origen_id ON public.platform_facturas USING btree (tenant_origen_id);
CREATE INDEX idx_ppm_producto ON public.producto_precios_mayorista USING btree (producto_id);
CREATE INDEX idx_presup_prov ON public.servicio_presupuestos USING btree (proveedor_id);
CREATE INDEX idx_prod_ubic_suc_producto ON public.producto_ubicacion_sucursal USING btree (producto_id);
CREATE INDEX idx_prod_ubic_suc_tenant ON public.producto_ubicacion_sucursal USING btree (tenant_id);
CREATE UNIQUE INDEX idx_producto_estructuras_default ON public.producto_estructuras USING btree (tenant_id, producto_id) WHERE (is_default = true);
CREATE INDEX idx_producto_estructuras_producto ON public.producto_estructuras USING btree (producto_id);
CREATE INDEX idx_producto_estructuras_tenant ON public.producto_estructuras USING btree (tenant_id);
CREATE INDEX idx_producto_grupos_categoria_id ON public.producto_grupos USING btree (categoria_id);
CREATE INDEX idx_producto_grupos_tenant ON public.producto_grupos USING btree (tenant_id);
CREATE INDEX idx_producto_precios_mayorista_tenant_id ON public.producto_precios_mayorista USING btree (tenant_id);
CREATE INDEX idx_producto_ubicacion_sucursal_sucursal_id ON public.producto_ubicacion_sucursal USING btree (sucursal_id);
CREATE INDEX idx_producto_ubicacion_sucursal_ubicacion_id ON public.producto_ubicacion_sucursal USING btree (ubicacion_id);
CREATE INDEX idx_productos_aging_profile_id ON public.productos USING btree (aging_profile_id);
CREATE INDEX idx_productos_categoria ON public.productos USING btree (categoria_id);
CREATE INDEX idx_productos_clase_abc ON public.productos USING btree (tenant_id, clase_abc, ultimo_conteo_at);
CREATE INDEX idx_productos_estado_id ON public.productos USING btree (estado_id);
CREATE INDEX idx_productos_grupo ON public.productos USING btree (grupo_id);
CREATE INDEX idx_productos_gtin ON public.productos USING btree (tenant_id, gtin);
CREATE INDEX idx_productos_marketplace ON public.productos USING btree (tenant_id, publicado_marketplace) WHERE (publicado_marketplace = true);
CREATE INDEX idx_productos_pendiente_revision ON public.productos USING btree (tenant_id) WHERE (pendiente_revision = true);
CREATE INDEX idx_productos_proveedor_id ON public.productos USING btree (proveedor_id);
CREATE INDEX idx_productos_sku ON public.productos USING btree (tenant_id, sku);
CREATE INDEX idx_productos_tenant ON public.productos USING btree (tenant_id);
CREATE INDEX idx_productos_ubicacion_id ON public.productos USING btree (ubicacion_id);
CREATE INDEX idx_prov_cuentas_proveedor ON public.proveedor_cuentas_bancarias USING btree (proveedor_id);
CREATE INDEX idx_prov_prod_proveedor ON public.proveedor_productos USING btree (proveedor_id);
CREATE INDEX idx_prov_prod_tenant ON public.proveedor_productos USING btree (tenant_id);
CREATE INDEX idx_proveedor_cc_movimientos_caja_sesion_id ON public.proveedor_cc_movimientos USING btree (caja_sesion_id);
CREATE INDEX idx_proveedor_cc_movimientos_created_by ON public.proveedor_cc_movimientos USING btree (created_by);
CREATE INDEX idx_proveedor_cc_movimientos_proveedor_id ON public.proveedor_cc_movimientos USING btree (proveedor_id);
CREATE INDEX idx_proveedor_contactos_prov ON public.proveedor_contactos USING btree (proveedor_id);
CREATE INDEX idx_proveedor_contactos_tenant_id ON public.proveedor_contactos USING btree (tenant_id);
CREATE INDEX idx_proveedor_cuentas_bancarias_tenant_id ON public.proveedor_cuentas_bancarias USING btree (tenant_id);
CREATE INDEX idx_proveedor_productos_producto_id ON public.proveedor_productos USING btree (producto_id);
CREATE INDEX idx_proveedores_sucursal_id ON public.proveedores USING btree (sucursal_id);
CREATE INDEX idx_proveedores_tenant_id ON public.proveedores USING btree (tenant_id);
CREATE INDEX idx_psmss_producto ON public.producto_stock_minimo_sucursal USING btree (producto_id);
CREATE INDEX idx_psmss_sucursal ON public.producto_stock_minimo_sucursal USING btree (sucursal_id);
CREATE INDEX idx_psmss_tenant ON public.producto_stock_minimo_sucursal USING btree (tenant_id);
CREATE INDEX idx_puntos_venta_afip_emisor_id ON public.puntos_venta_afip USING btree (emisor_id);
CREATE INDEX idx_puntos_venta_afip_sucursal_id ON public.puntos_venta_afip USING btree (sucursal_id);
CREATE INDEX idx_pv_afip_tenant ON public.puntos_venta_afip USING btree (tenant_id);
CREATE INDEX idx_recepcion_items_estado_id ON public.recepcion_items USING btree (estado_id);
CREATE INDEX idx_recepcion_items_inventario_linea_id ON public.recepcion_items USING btree (inventario_linea_id);
CREATE INDEX idx_recepcion_items_oc_item_id ON public.recepcion_items USING btree (oc_item_id);
CREATE INDEX idx_recepcion_items_producto_id ON public.recepcion_items USING btree (producto_id);
CREATE INDEX idx_recepcion_items_recepcion ON public.recepcion_items USING btree (recepcion_id);
CREATE INDEX idx_recepcion_items_ubicacion_id ON public.recepcion_items USING btree (ubicacion_id);
CREATE INDEX idx_recepciones_created_by ON public.recepciones USING btree (created_by);
CREATE INDEX idx_recepciones_oc ON public.recepciones USING btree (oc_id) WHERE (oc_id IS NOT NULL);
CREATE INDEX idx_recepciones_proveedor_id ON public.recepciones USING btree (proveedor_id);
CREATE INDEX idx_recepciones_sucursal_id ON public.recepciones USING btree (sucursal_id);
CREATE INDEX idx_recepciones_tenant ON public.recepciones USING btree (tenant_id);
CREATE INDEX idx_recursos_created_by ON public.recursos USING btree (created_by);
CREATE INDEX idx_recursos_proveedor_id ON public.recursos USING btree (proveedor_id);
CREATE INDEX idx_recursos_recurrentes ON public.recursos USING btree (tenant_id, proximo_vencimiento) WHERE (es_recurrente = true);
CREATE INDEX idx_recursos_sucursal_id ON public.recursos USING btree (sucursal_id);
CREATE INDEX idx_recursos_tenant ON public.recursos USING btree (tenant_id);
CREATE INDEX idx_recursos_tenant_estado ON public.recursos USING btree (tenant_id, estado);
CREATE INDEX idx_repartidores_empleado_id ON public.repartidores USING btree (empleado_id);
CREATE INDEX idx_repartidores_tenant ON public.repartidores USING btree (tenant_id);
CREATE INDEX idx_ret_tenant ON public.retenciones_sufridas USING btree (tenant_id);
CREATE INDEX idx_roles_custom_tenant ON public.roles_custom USING btree (tenant_id);
CREATE INDEX idx_rrhh_anticipos_created_by ON public.rrhh_anticipos USING btree (created_by);
CREATE INDEX idx_rrhh_anticipos_descontado_en_salario_id ON public.rrhh_anticipos USING btree (descontado_en_salario_id);
CREATE INDEX idx_rrhh_anticipos_emp ON public.rrhh_anticipos USING btree (tenant_id, empleado_id, saldado);
CREATE INDEX idx_rrhh_anticipos_empleado_id ON public.rrhh_anticipos USING btree (empleado_id);
CREATE INDEX idx_rrhh_anticipos_gasto_id ON public.rrhh_anticipos USING btree (gasto_id);
CREATE INDEX idx_rrhh_asist_empleado ON public.rrhh_asistencia USING btree (empleado_id);
CREATE INDEX idx_rrhh_asist_fecha ON public.rrhh_asistencia USING btree (tenant_id, fecha);
CREATE INDEX idx_rrhh_asist_tenant ON public.rrhh_asistencia USING btree (tenant_id);
CREATE INDEX idx_rrhh_cap_empleado ON public.rrhh_capacitaciones USING btree (empleado_id);
CREATE INDEX idx_rrhh_cap_estado ON public.rrhh_capacitaciones USING btree (estado);
CREATE INDEX idx_rrhh_cap_tenant ON public.rrhh_capacitaciones USING btree (tenant_id);
CREATE INDEX idx_rrhh_capacitaciones_created_by ON public.rrhh_capacitaciones USING btree (created_by);
CREATE INDEX idx_rrhh_conceptos_tenant ON public.rrhh_conceptos USING btree (tenant_id);
CREATE INDEX idx_rrhh_departamentos_activo ON public.rrhh_departamentos USING btree (activo);
CREATE INDEX idx_rrhh_departamentos_tenant ON public.rrhh_departamentos USING btree (tenant_id);
CREATE INDEX idx_rrhh_documentos_catalogo_id ON public.rrhh_documentos USING btree (catalogo_id);
CREATE INDEX idx_rrhh_documentos_created_by ON public.rrhh_documentos USING btree (created_by);
CREATE INDEX idx_rrhh_documentos_empleado ON public.rrhh_documentos USING btree (empleado_id);
CREATE INDEX idx_rrhh_documentos_tenant ON public.rrhh_documentos USING btree (tenant_id);
CREATE INDEX idx_rrhh_evaluaciones_emp ON public.rrhh_evaluaciones USING btree (tenant_id, empleado_id);
CREATE INDEX idx_rrhh_evaluaciones_empleado_id ON public.rrhh_evaluaciones USING btree (empleado_id);
CREATE INDEX idx_rrhh_evaluaciones_evaluador_id ON public.rrhh_evaluaciones USING btree (evaluador_id);
CREATE INDEX idx_rrhh_feriados_created_by ON public.rrhh_feriados USING btree (created_by);
CREATE INDEX idx_rrhh_fichadas_emp ON public.rrhh_fichadas USING btree (tenant_id, empleado_id, ts);
CREATE INDEX idx_rrhh_fichadas_empleado_id ON public.rrhh_fichadas USING btree (empleado_id);
CREATE INDEX idx_rrhh_fichadas_sucursal_id ON public.rrhh_fichadas USING btree (sucursal_id);
CREATE INDEX idx_rrhh_horas_extra_aprobada_por ON public.rrhh_horas_extra USING btree (aprobada_por);
CREATE INDEX idx_rrhh_horas_extra_emp ON public.rrhh_horas_extra USING btree (tenant_id, empleado_id, fecha);
CREATE INDEX idx_rrhh_horas_extra_empleado_id ON public.rrhh_horas_extra USING btree (empleado_id);
CREATE INDEX idx_rrhh_items_salario ON public.rrhh_salario_items USING btree (salario_id);
CREATE INDEX idx_rrhh_items_tenant ON public.rrhh_salario_items USING btree (tenant_id);
CREATE INDEX idx_rrhh_liq_finales_emp ON public.rrhh_liquidaciones_finales USING btree (tenant_id, empleado_id);
CREATE INDEX idx_rrhh_liquidaciones_finales_created_by ON public.rrhh_liquidaciones_finales USING btree (created_by);
CREATE INDEX idx_rrhh_liquidaciones_finales_empleado_id ON public.rrhh_liquidaciones_finales USING btree (empleado_id);
CREATE INDEX idx_rrhh_liquidaciones_finales_gasto_id ON public.rrhh_liquidaciones_finales USING btree (gasto_id);
CREATE INDEX idx_rrhh_puestos_activo ON public.rrhh_puestos USING btree (activo);
CREATE INDEX idx_rrhh_puestos_tenant ON public.rrhh_puestos USING btree (tenant_id);
CREATE INDEX idx_rrhh_salario_items_concepto_id ON public.rrhh_salario_items USING btree (concepto_id);
CREATE INDEX idx_rrhh_salarios_caja_movimiento_id ON public.rrhh_salarios USING btree (caja_movimiento_id);
CREATE INDEX idx_rrhh_salarios_empleado ON public.rrhh_salarios USING btree (empleado_id);
CREATE INDEX idx_rrhh_salarios_gasto_id ON public.rrhh_salarios USING btree (gasto_id);
CREATE INDEX idx_rrhh_salarios_periodo ON public.rrhh_salarios USING btree (tenant_id, periodo);
CREATE INDEX idx_rrhh_salarios_tenant ON public.rrhh_salarios USING btree (tenant_id);
CREATE INDEX idx_rrhh_tipos_contrato_tenant ON public.rrhh_tipos_contrato USING btree (tenant_id);
CREATE INDEX idx_rrhh_vac_sal_empleado ON public.rrhh_vacaciones_saldo USING btree (empleado_id);
CREATE INDEX idx_rrhh_vac_sal_tenant ON public.rrhh_vacaciones_saldo USING btree (tenant_id);
CREATE INDEX idx_rrhh_vac_sol_empleado ON public.rrhh_vacaciones_solicitud USING btree (empleado_id);
CREATE INDEX idx_rrhh_vac_sol_estado ON public.rrhh_vacaciones_solicitud USING btree (tenant_id, estado);
CREATE INDEX idx_rrhh_vac_sol_tenant ON public.rrhh_vacaciones_solicitud USING btree (tenant_id);
CREATE INDEX idx_rrhh_vacaciones_solicitud_aprobado_por ON public.rrhh_vacaciones_solicitud USING btree (aprobado_por);
CREATE INDEX idx_rrhh_vacaciones_solicitud_preaprobado_por ON public.rrhh_vacaciones_solicitud USING btree (preaprobado_por);
CREATE INDEX idx_series_linea ON public.inventario_series USING btree (linea_id);
CREATE INDEX idx_series_producto ON public.inventario_series USING btree (producto_id);
CREATE INDEX idx_serv_items_prov ON public.servicio_items USING btree (proveedor_id);
CREATE INDEX idx_servicio_items_tenant_id ON public.servicio_items USING btree (tenant_id);
CREATE INDEX idx_servicio_presupuestos_gasto_id ON public.servicio_presupuestos USING btree (gasto_id);
CREATE INDEX idx_servicio_presupuestos_servicio_item_id ON public.servicio_presupuestos USING btree (servicio_item_id);
CREATE INDEX idx_servicio_presupuestos_tenant_id ON public.servicio_presupuestos USING btree (tenant_id);
CREATE INDEX idx_sesiones_caja ON public.caja_sesiones USING btree (caja_id);
CREATE INDEX idx_sesiones_tenant ON public.caja_sesiones USING btree (tenant_id, estado);
CREATE INDEX idx_sucursales_emisor_fiscal_id ON public.sucursales USING btree (emisor_fiscal_id);
CREATE INDEX idx_sucursales_tenant ON public.sucursales USING btree (tenant_id);
CREATE INDEX idx_support_agents_activo ON public.support_agents USING btree (activo) WHERE (activo = true);
CREATE INDEX idx_support_messages_ticket ON public.support_messages USING btree (ticket_id, created_at);
CREATE INDEX idx_support_tickets_asignado ON public.support_tickets USING btree (asignado_a);
CREATE INDEX idx_support_tickets_creado_por ON public.support_tickets USING btree (creado_por);
CREATE INDEX idx_support_tickets_estado ON public.support_tickets USING btree (estado) WHERE (estado <> 'cerrado'::text);
CREATE INDEX idx_support_tickets_tenant ON public.support_tickets USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_tenant_addons_tenant ON public.tenant_addons USING btree (tenant_id, dimension);
CREATE INDEX idx_tenant_certificates_emisor_id ON public.tenant_certificates USING btree (emisor_id);
CREATE INDEX idx_tenant_certificates_tenant ON public.tenant_certificates USING btree (tenant_id);
CREATE UNIQUE INDEX idx_tenants_fichado_token ON public.tenants USING btree (fichado_token) WHERE (fichado_token IS NOT NULL);
CREATE INDEX idx_tenants_plan_id ON public.tenants USING btree (plan_id);
CREATE INDEX idx_tiendanube_credentials_sucursal_id ON public.tiendanube_credentials USING btree (sucursal_id);
CREATE INDEX idx_tn_creds_tenant ON public.tiendanube_credentials USING btree (tenant_id);
CREATE INDEX idx_tn_map_producto ON public.inventario_tn_map USING btree (tenant_id, producto_id);
CREATE INDEX idx_tn_map_tn_product ON public.inventario_tn_map USING btree (tenant_id, tn_product_id);
CREATE INDEX idx_traslado_items_estado_id ON public.traslado_items USING btree (estado_id);
CREATE INDEX idx_traslado_items_linea_destino_id ON public.traslado_items USING btree (linea_destino_id);
CREATE INDEX idx_traslado_items_linea_origen_id ON public.traslado_items USING btree (linea_origen_id);
CREATE INDEX idx_traslado_items_producto ON public.traslado_items USING btree (producto_id);
CREATE INDEX idx_traslado_items_tenant_id ON public.traslado_items USING btree (tenant_id);
CREATE INDEX idx_traslado_items_traslado ON public.traslado_items USING btree (traslado_id);
CREATE INDEX idx_traslados_despachado_por ON public.traslados USING btree (despachado_por);
CREATE INDEX idx_traslados_destino ON public.traslados USING btree (sucursal_destino_id) WHERE (estado = 'en_transito'::text);
CREATE INDEX idx_traslados_envio_id ON public.traslados USING btree (envio_id);
CREATE INDEX idx_traslados_recibido_por ON public.traslados USING btree (recibido_por);
CREATE INDEX idx_traslados_sucursal_origen_id ON public.traslados USING btree (sucursal_origen_id);
CREATE INDEX idx_traslados_tenant ON public.traslados USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_traspasos_destino ON public.caja_traspasos USING btree (sesion_destino_id);
CREATE INDEX idx_traspasos_origen ON public.caja_traspasos USING btree (sesion_origen_id);
CREATE INDEX idx_traspasos_tenant ON public.caja_traspasos USING btree (tenant_id);
CREATE INDEX idx_ubicaciones_prioridad ON public.ubicaciones USING btree (tenant_id, prioridad);
CREATE INDEX idx_ubicaciones_sucursal ON public.ubicaciones USING btree (sucursal_id) WHERE (sucursal_id IS NOT NULL);
CREATE INDEX idx_udm_tenant ON public.unidades_medida USING btree (tenant_id);
CREATE INDEX idx_users_caja_preferida_id ON public.users USING btree (caja_preferida_id);
CREATE INDEX idx_users_rol_custom_id ON public.users USING btree (rol_custom_id);
CREATE INDEX idx_users_sucursal ON public.users USING btree (tenant_id, sucursal_id);
CREATE INDEX idx_users_sucursal_id ON public.users USING btree (sucursal_id);
CREATE INDEX idx_venta_auditoria_tenant_id ON public.venta_auditoria USING btree (tenant_id);
CREATE INDEX idx_venta_auditoria_venta ON public.venta_auditoria USING btree (venta_id, created_at);
CREATE INDEX idx_venta_item_despachos_linea_id ON public.venta_item_despachos USING btree (linea_id);
CREATE INDEX idx_venta_item_despachos_producto_id ON public.venta_item_despachos USING btree (producto_id);
CREATE INDEX idx_venta_items_linea_id ON public.venta_items USING btree (linea_id);
CREATE INDEX idx_venta_items_producto_id ON public.venta_items USING btree (producto_id);
CREATE INDEX idx_venta_items_tenant_id ON public.venta_items USING btree (tenant_id);
CREATE INDEX idx_venta_items_venta ON public.venta_items USING btree (venta_id);
CREATE INDEX idx_venta_series_serie_id ON public.venta_series USING btree (serie_id);
CREATE INDEX idx_venta_series_tenant_id ON public.venta_series USING btree (tenant_id);
CREATE INDEX idx_venta_series_venta ON public.venta_series USING btree (venta_id);
CREATE INDEX idx_venta_series_venta_item_id ON public.venta_series USING btree (venta_item_id);
CREATE INDEX idx_ventas_cc ON public.ventas USING btree (tenant_id, es_cuenta_corriente) WHERE (es_cuenta_corriente = true);
CREATE INDEX idx_ventas_cc_venc ON public.ventas USING btree (tenant_id, fecha_vencimiento_cc) WHERE (es_cuenta_corriente = true);
CREATE INDEX idx_ventas_cliente_id ON public.ventas USING btree (cliente_id);
CREATE INDEX idx_ventas_emisor_id ON public.ventas USING btree (emisor_id);
CREATE INDEX idx_ventas_estado ON public.ventas USING btree (tenant_id, estado);
CREATE INDEX idx_ventas_externas_logs_lookup ON public.ventas_externas_logs USING btree (tenant_id, integracion, webhook_external_id);
CREATE INDEX idx_ventas_externas_logs_venta_id ON public.ventas_externas_logs USING btree (venta_id);
CREATE INDEX idx_ventas_rec_due ON public.ventas_recurrentes USING btree (tenant_id, activo, proximo_at);
CREATE INDEX idx_ventas_rec_tenant ON public.ventas_recurrentes USING btree (tenant_id);
CREATE INDEX idx_ventas_recurrentes_cliente_id ON public.ventas_recurrentes USING btree (cliente_id);
CREATE INDEX idx_ventas_recurrentes_sucursal_id ON public.ventas_recurrentes USING btree (sucursal_id);
CREATE INDEX idx_ventas_sucursal ON public.ventas USING btree (sucursal_id);
CREATE INDEX idx_ventas_tenant ON public.ventas USING btree (tenant_id);
CREATE UNIQUE INDEX idx_ventas_tracking_unique ON public.ventas USING btree (tenant_id, origen, tracking_id) WHERE (tracking_id IS NOT NULL);
CREATE INDEX idx_ventas_usuario_id ON public.ventas USING btree (usuario_id);
CREATE INDEX idx_vid_item ON public.venta_item_despachos USING btree (venta_item_id);
CREATE INDEX idx_vid_tenant ON public.venta_item_despachos USING btree (tenant_id);
CREATE INDEX idx_vid_venta ON public.venta_item_despachos USING btree (venta_id);
CREATE UNIQUE INDEX uq_addon_batch_mp_payment ON public.addon_batch_changes USING btree (mp_payment_id) WHERE (mp_payment_id IS NOT NULL);
CREATE UNIQUE INDEX uq_addon_batch_pendiente ON public.addon_batch_changes USING btree (tenant_id) WHERE (estado = 'pendiente_pago'::text);
CREATE UNIQUE INDEX uq_addon_batch_programado ON public.addon_batch_changes USING btree (tenant_id) WHERE (estado = ANY (ARRAY['programado'::text, 'esperando_cobro'::text]));
CREATE UNIQUE INDEX uq_billing_manual_pagos_mp_payment ON public.billing_manual_pagos USING btree (mp_payment_id) WHERE (mp_payment_id IS NOT NULL);
CREATE UNIQUE INDEX uq_cuentas_origen_efectivo_por_tenant ON public.cuentas_origen USING btree (tenant_id) WHERE (tipo = 'efectivo'::text);
CREATE UNIQUE INDEX uq_emisores_fiscales_default ON public.emisores_fiscales USING btree (tenant_id) WHERE es_default;
CREATE UNIQUE INDEX uq_emisores_fiscales_tenant_cuit ON public.emisores_fiscales USING btree (tenant_id, cuit);
CREATE UNIQUE INDEX uq_puntos_venta_afip_emisor_numero ON public.puntos_venta_afip USING btree (tenant_id, COALESCE(emisor_id, '00000000-0000-0000-0000-000000000000'::uuid), numero);
CREATE UNIQUE INDEX uq_tenant_addons_fijo_dim ON public.tenant_addons USING btree (tenant_id, dimension) WHERE (tipo = 'fijo'::text);
CREATE UNIQUE INDEX uq_tenant_addons_mp_payment ON public.tenant_addons USING btree (mp_payment_id) WHERE (mp_payment_id IS NOT NULL);
CREATE UNIQUE INDEX uq_tenant_certificates_emisor ON public.tenant_certificates USING btree (emisor_id);
CREATE UNIQUE INDEX uq_tenant_certificates_tenant_legacy ON public.tenant_certificates USING btree (tenant_id) WHERE (emisor_id IS NULL);


-- ============================================================
-- FUNCIONES
-- ============================================================
CREATE OR REPLACE FUNCTION public.aprobar_vacacion(p_solicitud_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sol rrhh_vacaciones_solicitud;
  v_anio INT;
BEGIN
  SELECT * INTO v_sol FROM rrhh_vacaciones_solicitud WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  IF v_sol.estado != 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud ya fue procesada';
  END IF;

  v_anio := EXTRACT(YEAR FROM v_sol.desde)::INT;

  -- Upsert saldo: incrementar dias_usados
  INSERT INTO rrhh_vacaciones_saldo (tenant_id, empleado_id, anio, dias_totales, dias_usados, remanente_anterior)
  VALUES (v_sol.tenant_id, v_sol.empleado_id, v_anio, 0, v_sol.dias_habiles, 0)
  ON CONFLICT (tenant_id, empleado_id, anio) DO UPDATE
    SET dias_usados = rrhh_vacaciones_saldo.dias_usados + v_sol.dias_habiles,
        updated_at  = NOW();

  -- Marcar como aprobada
  UPDATE rrhh_vacaciones_solicitud SET
    estado       = 'aprobada',
    aprobado_por = p_user_id,
    aprobado_at  = NOW(),
    updated_at   = NOW()
  WHERE id = p_solicitud_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.auth_user_sucursal()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT sucursal_id FROM users WHERE id = auth.uid()
$function$


CREATE OR REPLACE FUNCTION public.auth_ve_todas_sucursales()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid()
      AND (
        u.rol = 'DUEÑO'
        OR (u.rol IN ('SUPERVISOR','SUPER_USUARIO','VIEWER') AND u.puede_ver_todas IS NOT FALSE)
        OR u.puede_ver_todas = TRUE
      )
  )
$function$


CREATE OR REPLACE FUNCTION public.auto_resolver_alerta_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stock_actual > NEW.stock_minimo THEN
    UPDATE alertas
    SET resuelta = TRUE
    WHERE producto_id = NEW.id
      AND tipo       = 'stock_minimo'
      AND resuelta   = FALSE;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.calcular_dias_habiles(p_desde date, p_hasta date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::INT
  FROM generate_series(p_desde, p_hasta, '1 day'::interval) d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);  -- 0=domingo, 6=sábado
$function$


CREATE OR REPLACE FUNCTION public.cancelar_armado_kit(p_log_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_log RECORD; ent RECORD;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  SELECT * INTO v_log FROM kitting_log WHERE id = p_log_id;
  IF v_log.id IS NULL THEN RAISE EXCEPTION 'Armado no encontrado'; END IF;
  IF v_log.tenant_id <> v_tenant THEN RAISE EXCEPTION 'Armado de otro tenant'; END IF;
  IF v_log.estado <> 'en_armado' THEN RAISE EXCEPTION 'El armado no está en proceso (estado=%)', v_log.estado; END IF;
  FOR ent IN SELECT * FROM jsonb_to_recordset(v_log.componentes_reservados) AS x(linea_id uuid, comp_producto_id uuid, cantidad numeric) LOOP
    UPDATE inventario_lineas SET cantidad_reservada = GREATEST(0, COALESCE(cantidad_reservada, 0) - ent.cantidad) WHERE id = ent.linea_id;
  END LOOP;
  UPDATE kitting_log SET estado = 'cancelado' WHERE id = p_log_id;
END $function$


CREATE OR REPLACE FUNCTION public.cerrar_periodo(p_periodo date, p_observaciones text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_rol       TEXT;
  v_periodo   DATE := date_trunc('month', p_periodo)::DATE;
  v_ultimo    DATE;
  v_total_gastos     NUMERIC;
  v_total_ventas     NUMERIC;
  v_total_sueldos    NUMERIC;
  v_total_oc         NUMERIC;
  v_count_gastos     INT;
  v_count_ventas     INT;
  v_count_correcc    INT;
  v_row       cierres_contables;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT tenant_id, rol INTO v_tenant_id, v_rol FROM users WHERE id = v_user_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;

  IF v_rol NOT IN ('DUEÑO','SUPERVISOR','CONTADOR','SUPER_USUARIO','ADMIN') THEN
    RAISE EXCEPTION 'Tu rol (%) no puede cerrar periodos contables', v_rol;
  END IF;

  SELECT MAX(periodo) INTO v_ultimo FROM cierres_contables WHERE tenant_id = v_tenant_id;
  IF v_ultimo IS NOT NULL AND v_periodo <= v_ultimo THEN
    RAISE EXCEPTION 'El periodo % ya está cerrado o es anterior al último cierre (%)', TO_CHAR(v_periodo,'MM/YYYY'), TO_CHAR(v_ultimo,'MM/YYYY');
  END IF;

  IF v_periodo >= date_trunc('month', CURRENT_DATE)::DATE THEN
    RAISE EXCEPTION 'No podés cerrar un periodo en curso o futuro (%)', TO_CHAR(v_periodo,'MM/YYYY');
  END IF;

  SELECT COALESCE(SUM(monto),0), COUNT(*), COUNT(*) FILTER (WHERE es_correccion = TRUE)
    INTO v_total_gastos, v_count_gastos, v_count_correcc
  FROM gastos
  WHERE tenant_id = v_tenant_id
    AND fecha >= v_periodo
    AND fecha <  (v_periodo + INTERVAL '1 month')::DATE;

  SELECT COALESCE(SUM(total),0), COUNT(*) INTO v_total_ventas, v_count_ventas
  FROM ventas
  WHERE tenant_id = v_tenant_id
    AND created_at >= v_periodo
    AND created_at <  (v_periodo + INTERVAL '1 month')::DATE
    AND estado IN ('despachada','facturada');

  SELECT COALESCE(SUM(neto),0) INTO v_total_sueldos
  FROM rrhh_salarios
  WHERE tenant_id = v_tenant_id
    AND pagado = TRUE
    AND fecha_pago >= v_periodo
    AND fecha_pago <  (v_periodo + INTERVAL '1 month')::DATE;

  SELECT COALESCE(SUM(total_oc),0) INTO v_total_oc
  FROM (
    SELECT COALESCE(SUM(oci.cantidad * oci.precio_unitario),0) AS total_oc
    FROM ordenes_compra oc
    LEFT JOIN orden_compra_items oci ON oci.orden_compra_id = oc.id
    WHERE oc.tenant_id = v_tenant_id
      AND oc.created_at >= v_periodo
      AND oc.created_at <  (v_periodo + INTERVAL '1 month')::DATE
    GROUP BY oc.id
  ) sub;

  INSERT INTO cierres_contables(tenant_id, periodo, cerrado_por, cerrado_por_rol, observaciones, totales)
  VALUES (
    v_tenant_id, v_periodo, v_user_id, v_rol, p_observaciones,
    jsonb_build_object(
      'total_gastos',      v_total_gastos,
      'total_ventas',      v_total_ventas,
      'total_sueldos',     v_total_sueldos,
      'total_oc',          v_total_oc,
      'count_gastos',      v_count_gastos,
      'count_ventas',      v_count_ventas,
      'count_correcciones',v_count_correcc
    )
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END $function$


CREATE OR REPLACE FUNCTION public.check_stock_minimo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stock_actual <= NEW.stock_minimo THEN
    INSERT INTO alertas (tenant_id, producto_id, tipo, mensaje)
    VALUES (
      NEW.tenant_id, NEW.id, 'stock_minimo',
      'Stock de ' || NEW.nombre || ' llegó al mínimo (' || NEW.stock_actual || ' unidades)'
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.cliente_cc_estado(p_cliente uuid)
 RETURNS TABLE(deuda_total numeric, deuda_vencida numeric, interes_total numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + v.interes_cc), 0) AS deuda_total,
    COALESCE(SUM(CASE WHEN v.fecha_vencimiento_cc IS NOT NULL
                       AND v.fecha_vencimiento_cc < CURRENT_DATE
                      THEN GREATEST(v.total - v.monto_pagado, 0) + v.interes_cc ELSE 0 END), 0) AS deuda_vencida,
    COALESCE(SUM(v.interes_cc), 0) AS interes_total
  FROM ventas v
  WHERE v.cliente_id = p_cliente
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND v.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (v.total - v.monto_pagado) > 0.5;
$function$


CREATE OR REPLACE FUNCTION public.confirmar_armado_kit(p_log_id uuid, p_sucursal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_log RECORD; comp RECORD; ent RECORD; v_antes numeric; v_kantes numeric;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  SELECT * INTO v_log FROM kitting_log WHERE id = p_log_id;
  IF v_log.id IS NULL THEN RAISE EXCEPTION 'Armado no encontrado'; END IF;
  IF v_log.tenant_id <> v_tenant THEN RAISE EXCEPTION 'Armado de otro tenant'; END IF;
  IF v_log.estado <> 'en_armado' THEN RAISE EXCEPTION 'El armado no está en proceso (estado=%)', v_log.estado; END IF;
  FOR ent IN SELECT * FROM jsonb_to_recordset(v_log.componentes_reservados) AS x(linea_id uuid, comp_producto_id uuid, cantidad numeric) LOOP
    UPDATE inventario_lineas SET cantidad = cantidad - ent.cantidad, cantidad_reservada = GREATEST(0, COALESCE(cantidad_reservada, 0) - ent.cantidad) WHERE id = ent.linea_id;
  END LOOP;
  FOR comp IN SELECT comp_producto_id, sum(cantidad) AS cant FROM jsonb_to_recordset(v_log.componentes_reservados) AS x(linea_id uuid, comp_producto_id uuid, cantidad numeric) GROUP BY comp_producto_id LOOP
    SELECT COALESCE(sum(cantidad), 0) INTO v_antes FROM inventario_lineas WHERE tenant_id = v_tenant AND producto_id = comp.comp_producto_id AND activo = true AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
    INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, sucursal_id)
    VALUES (v_tenant, comp.comp_producto_id, 'rebaje', comp.cant, v_antes + comp.cant, v_antes, 'Kitting x' || v_log.cantidad_kits || ' [' || v_log.kit_producto_id || ']', auth.uid(), p_sucursal_id);
  END LOOP;
  INSERT INTO inventario_lineas (tenant_id, producto_id, cantidad, ubicacion_id, activo, sucursal_id)
  VALUES (v_tenant, v_log.kit_producto_id, v_log.cantidad_kits, v_log.ubicacion_id, true, p_sucursal_id);
  SELECT COALESCE(sum(cantidad), 0) INTO v_kantes FROM inventario_lineas WHERE tenant_id = v_tenant AND producto_id = v_log.kit_producto_id AND activo = true AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
  INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, sucursal_id)
  VALUES (v_tenant, v_log.kit_producto_id, 'kitting', v_log.cantidad_kits, v_kantes - v_log.cantidad_kits, v_kantes, COALESCE(v_log.notas, 'Kitting x' || v_log.cantidad_kits), auth.uid(), p_sucursal_id);
  UPDATE kitting_log SET estado = 'completado' WHERE id = p_log_id;
END $function$


CREATE OR REPLACE FUNCTION public.devolver_saldo_a_favor(p_cliente_id uuid, p_monto numeric, p_sesion_id uuid, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id        uuid;
  v_cliente_nombre   text;
  v_user_id          uuid := auth.uid();
  v_saldo            numeric;
  v_apertura         numeric;
  v_efectivo         numeric;
  v_cuenta_efectivo  uuid;
  v_monto            numeric := round(COALESCE(p_monto, 0), 2);
  v_mov_id           uuid;
BEGIN
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a devolver debe ser mayor a 0.';
  END IF;

  SELECT tenant_id, nombre INTO v_tenant_id, v_cliente_nombre
  FROM clientes WHERE id = p_cliente_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado.';
  END IF;

  SELECT COALESCE(SUM(monto), 0) INTO v_saldo
  FROM cliente_creditos
  WHERE cliente_id = p_cliente_id AND tenant_id = v_tenant_id;

  IF v_saldo < v_monto - 0.005 THEN
    RAISE EXCEPTION 'El saldo a favor disponible es $%, no podes devolver mas que eso.', round(v_saldo, 2);
  END IF;

  SELECT monto_apertura INTO v_apertura
  FROM caja_sesiones
  WHERE id = p_sesion_id AND tenant_id = v_tenant_id AND estado = 'abierta';
  IF v_apertura IS NULL THEN
    RAISE EXCEPTION 'La caja seleccionada no esta abierta.';
  END IF;

  SELECT v_apertura + COALESCE(SUM(
           CASE
             WHEN tipo IN ('ingreso','ingreso_reserva','ingreso_traspaso') THEN monto
             WHEN tipo IN ('egreso','egreso_devolucion_sena','egreso_traspaso') THEN -monto
             ELSE 0
           END), 0)
    INTO v_efectivo
  FROM caja_movimientos
  WHERE sesion_id = p_sesion_id;

  IF v_efectivo < v_monto - 0.005 THEN
    RAISE EXCEPTION 'No hay suficiente efectivo en la caja ($%) para devolver $%. Hace un ingreso a la caja o devolve por otro medio.',
      round(v_efectivo, 2), v_monto;
  END IF;

  SELECT cuenta_origen_id INTO v_cuenta_efectivo
  FROM metodos_pago
  WHERE tenant_id = v_tenant_id AND lower(nombre) = 'efectivo' AND cuenta_origen_id IS NOT NULL
  LIMIT 1;

  INSERT INTO caja_movimientos (tenant_id, sesion_id, tipo, concepto, monto, cuenta_origen_id, usuario_id)
  VALUES (v_tenant_id, p_sesion_id, 'egreso',
          'Devolucion saldo a favor - ' || COALESCE(NULLIF(trim(v_cliente_nombre), ''), 'cliente'),
          v_monto, v_cuenta_efectivo, v_user_id)
  RETURNING id INTO v_mov_id;

  INSERT INTO cliente_creditos (tenant_id, cliente_id, monto, origen, nota, usuario_id)
  VALUES (v_tenant_id, p_cliente_id, -v_monto, 'retiro_efectivo',
          COALESCE(NULLIF(trim(p_nota), ''), 'Devolucion de saldo a favor en efectivo'), v_user_id);

  RETURN jsonb_build_object(
    'ok', true,
    'caja_movimiento_id', v_mov_id,
    'monto', v_monto,
    'saldo_restante', round(v_saldo - v_monto, 2)
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.fichar_qr(p_token text, p_empleado_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant_id UUID; v_ultimo TEXT; v_tipo TEXT; v_ts TIMESTAMPTZ := now();
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE fichado_token = p_token;
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Token inválido'); END IF;

  IF NOT EXISTS (SELECT 1 FROM empleados WHERE id = p_empleado_id AND tenant_id = v_tenant_id AND activo = TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Empleado no válido');
  END IF;

  SELECT tipo INTO v_ultimo FROM rrhh_fichadas
  WHERE empleado_id = p_empleado_id AND ts::date = v_ts::date
  ORDER BY ts DESC LIMIT 1;
  v_tipo := CASE WHEN v_ultimo = 'entrada' THEN 'salida' ELSE 'entrada' END;

  INSERT INTO rrhh_fichadas (tenant_id, empleado_id, tipo, ts, origen)
  VALUES (v_tenant_id, p_empleado_id, v_tipo, v_ts, 'qr');

  RETURN jsonb_build_object('ok', true, 'tipo', v_tipo, 'ts', v_ts);
END;$function$


CREATE OR REPLACE FUNCTION public.fn_activar_billing_manual(p_tenant_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier   TEXT;
  v_precio NUMERIC;
  v_es_dueño BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND tenant_id = p_tenant_id AND rol = 'DUEÑO'
  ) INTO v_es_dueño;
  IF NOT v_es_dueño THEN
    RAISE EXCEPTION 'Solo el dueño puede cambiar el modo de pago';
  END IF;

  SELECT plan_tier INTO v_tier FROM public.tenants WHERE id = p_tenant_id;
  v_precio := CASE v_tier
    WHEN 'basico' THEN 60000
    WHEN 'pro'    THEN 100000
    ELSE NULL
  END;
  IF v_precio IS NULL THEN
    RAISE EXCEPTION 'Plan % no tiene precio de lista para modo manual', v_tier;
  END IF;

  UPDATE public.tenants SET billing_mode = 'manual', manual_monto_mensual = v_precio
    WHERE id = p_tenant_id;
  RETURN v_precio;
END $function$


CREATE OR REPLACE FUNCTION public.fn_aplicar_addon_batch(p_tenant_id uuid, p_change_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_estado TEXT;
  v_packs JSONB;
  v_plan TEXT;
BEGIN
  SELECT estado, packs_objetivo, plan_objetivo INTO v_estado, v_packs, v_plan
    FROM public.addon_batch_changes
    WHERE id = p_change_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF v_estado IS NULL THEN RETURN FALSE; END IF;          -- no existe / de otro tenant
  IF v_estado = 'aplicado' THEN RETURN TRUE; END IF;      -- idempotente
  IF v_estado NOT IN ('pendiente_pago','esperando_cobro') THEN RETURN FALSE; END IF;

  DELETE FROM public.tenant_addons WHERE tenant_id = p_tenant_id AND tipo = 'fijo';
  INSERT INTO public.tenant_addons (tenant_id, dimension, cantidad, tipo, vence_at)
  SELECT p_tenant_id, x.dimension, x.cantidad, 'fijo', NULL
  FROM jsonb_to_recordset(v_packs) AS x(dimension TEXT, cantidad INT)
  WHERE x.cantidad > 0;

  IF v_plan IS NOT NULL THEN
    UPDATE public.tenants SET
      plan_tier     = v_plan,
      max_users     = CASE v_plan WHEN 'pro' THEN 15   ELSE 5    END,
      max_productos = CASE v_plan WHEN 'pro' THEN 8000 ELSE 2000 END
    WHERE id = p_tenant_id;
  END IF;

  UPDATE public.addon_batch_changes
    SET estado = 'aplicado', applied_at = now()
    WHERE id = p_change_id;
  RETURN TRUE;
END $function$


CREATE OR REPLACE FUNCTION public.fn_crear_caja_fuerte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte, activo)
  VALUES (NEW.id, 'Caja Fuerte / Bóveda', true, true);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_enforce_limite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dim    TEXT := TG_ARGV[0];
  v_limite INT;
  v_count  INT;
BEGIN
  IF NEW.activo IS DISTINCT FROM TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.activo IS TRUE THEN RETURN NEW; END IF;

  v_limite := public.fn_tenant_limite(NEW.tenant_id, v_dim);
  IF v_limite = -1 THEN RETURN NEW; END IF;

  EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1 AND activo = true', TG_TABLE_NAME)
    INTO v_count USING NEW.tenant_id;

  IF v_count >= v_limite THEN
    RAISE EXCEPTION 'Límite del plan alcanzado: % (tenés % de % permitidos). Subí de plan o agregá un add-on.',
      v_dim, v_count, v_limite USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.fn_enforce_limite_cuits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limite INT;
  v_count  INT;
BEGIN
  IF NEW.es_default IS TRUE THEN RETURN NEW; END IF;
  IF NEW.activo IS DISTINCT FROM TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.activo IS TRUE THEN RETURN NEW; END IF;

  v_limite := public.fn_tenant_limite(NEW.tenant_id, 'cuits');
  IF v_limite = -1 THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count FROM public.emisores_fiscales
    WHERE tenant_id = NEW.tenant_id AND activo = true AND es_default = false
      AND id <> NEW.id;

  IF v_count >= GREATEST(v_limite - 1, 0) THEN
    RAISE EXCEPTION 'Límite de CUITs del plan alcanzado (% adicional(es) permitido(s)). Sumá el add-on "CUIT adicional" para facturar con otra razón social.',
      GREATEST(v_limite - 1, 0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.fn_enqueue_meli_stock_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_producto_id UUID;
BEGIN
  v_tenant_id  := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);
  IF v_tenant_id IS NULL OR v_producto_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventario_meli_map WHERE tenant_id = v_tenant_id AND producto_id = v_producto_id AND sync_stock = TRUE) THEN RETURN NEW; END IF;
  INSERT INTO integration_job_queue (tenant_id, integracion, tipo, payload, status, next_attempt_at)
  SELECT v_tenant_id, 'MercadoLibre', 'sync_stock',
         jsonb_build_object('producto_id', v_producto_id, 'meli_item_id', meli_item_id, 'meli_variation_id', meli_variation_id),
         'pending', NOW()
  FROM inventario_meli_map
  WHERE tenant_id = v_tenant_id AND producto_id = v_producto_id AND sync_stock = TRUE
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_enqueue_tn_stock_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_producto_id UUID;
  v_tenant_id   UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_producto_id := OLD.producto_id;
    v_tenant_id   := OLD.tenant_id;
  ELSE
    v_producto_id := NEW.producto_id;
    v_tenant_id   := NEW.tenant_id;
  END IF;

  -- Insertar job para cada mapeo activo del producto (sync_stock=true)
  -- Si ya hay un job pendiente para este producto, no duplicar
  INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, next_attempt_at)
  SELECT
    itm.tenant_id,
    itm.sucursal_id,
    'TiendaNube',
    'sync_stock',
    jsonb_build_object(
      'producto_id',   v_producto_id::text,
      'tn_product_id', itm.tn_product_id,
      'tn_variant_id', itm.tn_variant_id
    ),
    NOW()
  FROM inventario_tn_map itm
  WHERE itm.producto_id = v_producto_id
    AND itm.tenant_id   = v_tenant_id
    AND itm.sync_stock  = true
    AND NOT EXISTS (
      SELECT 1 FROM integration_job_queue q
      WHERE q.tenant_id   = itm.tenant_id
        AND q.integracion  = 'TiendaNube'
        AND q.tipo         = 'sync_stock'
        AND q.status       = 'pending'
        AND q.payload->>'producto_id' = v_producto_id::text
    );

  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_envios_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;$function$


CREATE OR REPLACE FUNCTION public.fn_gastos_iva_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cond text;
BEGIN
  SELECT COALESCE(NULLIF(t.condicion_iva_emisor, ''), 'Monotributista')
    INTO v_cond
  FROM tenants t WHERE t.id = NEW.tenant_id;
  v_cond := COALESCE(v_cond, 'Monotributista');

  IF v_cond <> 'RI' OR COALESCE(NEW.tipo_comprobante, '') <> 'Factura A' THEN
    NEW.iva_monto     := NULL;
    NEW.alicuota_iva  := NULL;
    NEW.tipo_iva      := NULL;
    NEW.iva_deducible := false;
  END IF;

  IF v_cond <> 'RI' THEN
    NEW.deduce_ganancias := false;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_guard_rol_admin()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.rol = 'ADMIN'
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'No autorizado a asignar el rol ADMIN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.fn_notificar_cc_vencidas()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
BEGIN

  -- ── 1. CC CLIENTES VENCIDAS ─────────────────────────────────────────────────
  FOR r IN
    SELECT
      v.tenant_id,
      v.cliente_id,
      c.nombre                                         AS cliente_nombre,
      ROUND(SUM(v.total - COALESCE(v.monto_pagado, 0))::numeric, 2) AS deuda_total,
      u.id                                             AS user_id
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    JOIN users u ON u.tenant_id = v.tenant_id AND u.rol IN ('OWNER','ADMIN')
    WHERE v.es_cuenta_corriente = true
      AND v.estado IN ('despachada', 'facturada')
      AND (v.total - COALESCE(v.monto_pagado, 0)) > 0.5
      AND (v.created_at + (COALESCE(c.plazo_pago_dias, 30) || ' days')::interval)::date < CURRENT_DATE
    GROUP BY v.tenant_id, v.cliente_id, c.nombre, u.id
    HAVING SUM(v.total - COALESCE(v.monto_pagado, 0)) > 0.5
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notificaciones
      WHERE user_id    = r.user_id
        AND action_url = '/clientes'
        AND titulo     LIKE '%' || r.cliente_nombre || '%'
        AND created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      VALUES (
        r.tenant_id,
        r.user_id,
        'warning',
        'CC vencida: ' || r.cliente_nombre,
        'Deuda vencida de $' || r.deuda_total || ' en cuenta corriente sin cobrar.',
        '/clientes'
      );
    END IF;
  END LOOP;

  -- ── 2. OC VENCIDAS SIN PAGAR ────────────────────────────────────────────────
  FOR r IN
    SELECT
      oc.tenant_id,
      oc.id         AS oc_id,
      oc.numero     AS oc_numero,
      p.nombre      AS proveedor_nombre,
      COALESCE(oc.monto_total, 0) AS monto,
      u.id          AS user_id
    FROM ordenes_compra oc
    JOIN proveedores p ON p.id = oc.proveedor_id
    JOIN users u ON u.tenant_id = oc.tenant_id AND u.rol IN ('OWNER','ADMIN')
    WHERE oc.fecha_vencimiento_pago IS NOT NULL
      AND oc.fecha_vencimiento_pago < CURRENT_DATE
      AND oc.estado_pago NOT IN ('pagada')
      AND oc.estado NOT IN ('cancelada')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notificaciones
      WHERE user_id    = r.user_id
        AND action_url = '/proveedores'
        AND titulo     LIKE '%OC #' || r.oc_numero || '%'
        AND created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      VALUES (
        r.tenant_id,
        r.user_id,
        'danger',
        'OC #' || r.oc_numero || ' vencida — ' || r.proveedor_nombre,
        'Orden de compra por $' || r.monto || ' venció sin pagar.',
        '/proveedores'
      );
    END IF;
  END LOOP;

END;
$function$


CREATE OR REPLACE FUNCTION public.fn_plan_base_limite(p_tier text, p_dim text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_tier
    WHEN 'enterprise' THEN -1
    WHEN 'pro' THEN CASE p_dim
      WHEN 'sku' THEN 8000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 14000
      WHEN 'sucursales' THEN 4 WHEN 'usuarios' THEN 15 WHEN 'cuits' THEN 1 ELSE 0 END
    WHEN 'basico' THEN CASE p_dim
      WHEN 'sku' THEN 2000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 6000
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 5 WHEN 'cuits' THEN 1 ELSE 0 END
    ELSE CASE p_dim  -- free
      WHEN 'sku' THEN 50 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 200
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 1 WHEN 'cuits' THEN 1 ELSE 0 END
  END
$function$


CREATE OR REPLACE FUNCTION public.fn_recalcular_salario()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_hab DECIMAL(12,2);
  v_des DECIMAL(12,2);
BEGIN
  v_id := CASE TG_OP WHEN 'DELETE' THEN OLD.salario_id ELSE NEW.salario_id END;

  SELECT
    COALESCE(SUM(CASE WHEN tipo = 'HABER'     THEN monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'DESCUENTO' THEN monto ELSE 0 END), 0)
  INTO v_hab, v_des
  FROM rrhh_salario_items
  WHERE salario_id = v_id;

  UPDATE rrhh_salarios SET
    total_haberes    = v_hab,
    total_descuentos = v_des,
    neto             = v_hab - v_des,
    updated_at       = NOW()
  WHERE id = v_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_registrar_pago_manual(p_tenant_id uuid, p_monto numeric, p_medio text, p_referencia text, p_registrado_por uuid, p_mp_payment_id text, p_notas text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_desde TIMESTAMPTZ;
  v_hasta TIMESTAMPTZ;
BEGIN
  SELECT GREATEST(now(), COALESCE(manual_paid_until, now())) INTO v_desde
    FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF v_desde IS NULL THEN
    RAISE EXCEPTION 'Tenant % no encontrado', p_tenant_id;
  END IF;
  v_hasta := v_desde + INTERVAL '1 month';

  INSERT INTO public.billing_manual_pagos (
    tenant_id, monto, medio, referencia, periodo_desde, periodo_hasta,
    registrado_por, mp_payment_id, notas
  ) VALUES (
    p_tenant_id, p_monto, p_medio, p_referencia, v_desde, v_hasta,
    p_registrado_por, p_mp_payment_id, p_notas
  );

  UPDATE public.tenants SET
    manual_paid_until = v_hasta,
    subscription_status = CASE WHEN subscription_status = 'inactive' THEN 'active' ELSE subscription_status END,
    manual_ultimo_recordatorio_tipo = NULL,
    manual_ultimo_recordatorio_at = NULL
  WHERE id = p_tenant_id;

  RETURN v_hasta;
END $function$


CREATE OR REPLACE FUNCTION public.fn_saldo_proveedor_cc(p_proveedor_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(monto), 0)
  FROM proveedor_cc_movimientos
  WHERE proveedor_id = p_proveedor_id;
$function$


CREATE OR REPLACE FUNCTION public.fn_seed_canales_venta_new_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN PERFORM seed_canales_venta(NEW.id); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.fn_seed_categorias_gasto_new_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM seed_categorias_gasto(NEW.id);
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_seed_tenant_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sucursal_id UUID;
  v_efectivo_cuenta_id UUID;
BEGIN
  v_sucursal_id := gen_random_uuid();
  INSERT INTO sucursales (id, tenant_id, nombre, activo)
  VALUES (v_sucursal_id, NEW.id, 'Sucursal 1', true);

  INSERT INTO cajas (tenant_id, nombre, sucursal_id)
  VALUES (NEW.id, 'Caja Principal', v_sucursal_id);

  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    (NEW.id, 'Compra a proveedor',     'ingreso', true),
    (NEW.id, 'Ingreso inicial',         'ingreso', true),
    (NEW.id, 'Devolución de cliente',   'ingreso', true),
    (NEW.id, 'Venta',                   'rebaje', true),
    (NEW.id, 'Merma / Rotura',          'rebaje', true),
    (NEW.id, 'Consumo interno',         'rebaje', true),
    (NEW.id, 'Vencimiento',             'rebaje', true),
    (NEW.id, 'Ingreso de efectivo',     'caja',   true),
    (NEW.id, 'Extracción / Retiro',     'caja',   true),
    (NEW.id, 'Gastos varios',           'caja',   true),
    (NEW.id, 'Ajuste de inventario',    'ambos',  true);

  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida) VALUES
    (NEW.id, 'Unidad',     'u',   true, true),
    (NEW.id, 'Kilogramo',  'kg',  true, true),
    (NEW.id, 'Gramo',      'g',   true, true),
    (NEW.id, 'Litro',      'L',   true, true),
    (NEW.id, 'Metro',      'm',   true, true),
    (NEW.id, 'Caja',       'caja',true, true)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo', 'efectivo', COALESCE(NEW.moneda, 'ARS'), true)
  RETURNING id INTO v_efectivo_cuenta_id;

  INSERT INTO metodos_pago (tenant_id, nombre, color, orden, activo, es_sistema, cuenta_origen_id) VALUES
    (NEW.id, 'Efectivo',           '#22c55e', 1, true, true, v_efectivo_cuenta_id),
    (NEW.id, 'Mercado Pago',       '#06b6d4', 2, true, true, NULL),
    (NEW.id, 'Tarjeta de débito',  '#eab308', 3, true, true, NULL),
    (NEW.id, 'Transferencia',      '#8b5cf6', 4, true, true, NULL),
    (NEW.id, 'Tarjeta de crédito', '#f97316', 5, true, true, NULL)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_set_caja_sesion_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1
    INTO NEW.numero
    FROM caja_sesiones
    WHERE tenant_id = NEW.tenant_id
      AND COALESCE(sucursal_id::text, '_global') = COALESCE(NEW.sucursal_id::text, '_global');
  END IF;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.fn_set_primera_compra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.subscription_status = 'active'
     AND COALESCE(OLD.subscription_status, '') <> 'active'
     AND NEW.mp_subscription_id IS NOT NULL
     AND NEW.primera_compra_at IS NULL THEN
    NEW.primera_compra_at := now();
  END IF;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.fn_sync_emisor_fiscal_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cuit IS NULL THEN
    RETURN NEW;  -- sin CUIT no hay identidad fiscal que espejar
  END IF;

  UPDATE emisores_fiscales SET
    nombre               = COALESCE(NEW.razon_social_fiscal, NEW.nombre, nombre),
    cuit                 = NEW.cuit,
    razon_social_fiscal  = NEW.razon_social_fiscal,
    condicion_iva_emisor = NEW.condicion_iva_emisor,
    domicilio_fiscal     = NEW.domicilio_fiscal,
    ingresos_brutos      = NEW.ingresos_brutos,
    inicio_actividades   = NEW.inicio_actividades,
    umbral_factura_b     = NEW.umbral_factura_b,
    afip_produccion      = COALESCE(NEW.afip_produccion, false),
    afip_provider        = COALESCE(NEW.afip_provider, 'propio'),
    afipsdk_token        = NEW.afipsdk_token,
    banco                = NEW.banco,
    cbu                  = NEW.cbu,
    alias_cbu            = NEW.alias_cbu,
    leyenda_comprobante  = NEW.leyenda_comprobante,
    logo_url             = NEW.logo_url,
    updated_at           = now()
  WHERE tenant_id = NEW.id AND es_default;

  IF NOT FOUND THEN
    INSERT INTO emisores_fiscales (
      tenant_id, nombre, cuit, razon_social_fiscal, condicion_iva_emisor, domicilio_fiscal,
      ingresos_brutos, inicio_actividades, umbral_factura_b, afip_produccion, afip_provider,
      afipsdk_token, banco, cbu, alias_cbu, leyenda_comprobante, logo_url, es_default, activo
    ) VALUES (
      NEW.id, COALESCE(NEW.razon_social_fiscal, NEW.nombre, 'Emisor principal'), NEW.cuit,
      NEW.razon_social_fiscal, NEW.condicion_iva_emisor, NEW.domicilio_fiscal,
      NEW.ingresos_brutos, NEW.inicio_actividades, NEW.umbral_factura_b,
      COALESCE(NEW.afip_produccion, false), COALESCE(NEW.afip_provider, 'propio'),
      NEW.afipsdk_token, NEW.banco, NEW.cbu, NEW.alias_cbu, NEW.leyenda_comprobante,
      NEW.logo_url, true, true
    );
  END IF;

  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.fn_tenant_limite(p_tenant_id uuid, p_dim text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier TEXT; v_status TEXT; v_trial TIMESTAMPTZ; v_base INT; v_addons INT;
BEGIN
  SELECT plan_tier, subscription_status, trial_ends_at
    INTO v_tier, v_status, v_trial
    FROM public.tenants WHERE id = p_tenant_id;
  IF v_tier IS NULL THEN RETURN 0; END IF;
  IF v_status = 'trial' AND v_trial IS NOT NULL AND v_trial >= now() THEN
    v_tier := 'pro';
  END IF;
  v_base := public.fn_plan_base_limite(v_tier, p_dim);
  IF v_base = -1 THEN RETURN -1; END IF;
  SELECT COALESCE(SUM(cantidad), 0) INTO v_addons
    FROM public.tenant_addons
    WHERE tenant_id = p_tenant_id AND dimension = p_dim
      AND (tipo = 'fijo' OR (tipo = 'temporal' AND vence_at > now()));
  RETURN v_base + v_addons;
END $function$


CREATE OR REPLACE FUNCTION public.fn_tn_sync_heartbeat()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, next_attempt_at)
  SELECT
    itm.tenant_id,
    itm.sucursal_id,
    'TiendaNube',
    'sync_stock',
    jsonb_build_object(
      'producto_id',   itm.producto_id::text,
      'tn_product_id', itm.tn_product_id,
      'tn_variant_id', itm.tn_variant_id
    ),
    NOW()
  FROM inventario_tn_map itm
  WHERE itm.sync_stock = true
  AND NOT EXISTS (
    SELECT 1 FROM integration_job_queue q
    WHERE q.tenant_id              = itm.tenant_id
      AND q.integracion            = 'TiendaNube'
      AND q.tipo                   = 'sync_stock'
      AND q.status                 = 'pending'
      AND q.payload->>'producto_id' = itm.producto_id::text
  );

  PERFORM net.http_post(
    url     := 'https://gcmhzdedrkmmzfzfveig.supabase.co/functions/v1/tn-stock-worker',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.fn_updated_at_job_queue()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.fn_updated_at_mp_creds()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.fn_updated_at_tn_creds()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.fn_ventas_cc_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_eps         numeric := 0.5;
  v_es_cc       boolean := COALESCE(NEW.es_cuenta_corriente, false);
  v_monto_cc    numeric := 0;
  v_deuda_total numeric := 0;
  v_deuda_venc  numeric := 0;
  v_limite      numeric;
  v_enf         text;
  v_moros       text;
BEGIN
  IF NEW.estado = 'pendiente' OR NEW.cliente_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_moros := COALESCE((SELECT cc_morosidad_politica FROM public.tenants WHERE id = NEW.tenant_id), 'bloqueo_cc');

  IF NOT (v_es_cc OR v_moros = 'bloqueo_total') THEN
    RETURN NEW;
  END IF;

  -- Deuda del cliente ANTES de esta venta (BEFORE INSERT → NEW aún no está en la tabla).
  -- Espeja cliente_cc_estado pero scopeado por NEW.tenant_id (independiente de auth.uid()).
  SELECT
    COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0)), 0),
    COALESCE(SUM(CASE WHEN v.fecha_vencimiento_cc IS NOT NULL AND v.fecha_vencimiento_cc < CURRENT_DATE
                      THEN GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0) ELSE 0 END), 0)
    INTO v_deuda_total, v_deuda_venc
    FROM public.ventas v
    WHERE v.cliente_id = NEW.cliente_id
      AND v.tenant_id = NEW.tenant_id
      AND v.es_cuenta_corriente = TRUE
      AND v.estado <> 'cancelada'
      AND (v.total - v.monto_pagado) > v_eps;

  -- B4 — morosidad.
  IF v_deuda_venc > v_eps THEN
    IF v_moros = 'bloqueo_total' THEN
      RAISE EXCEPTION 'Cliente con deuda vencida ($%). No puede comprar hasta saldar.', round(v_deuda_venc)
        USING ERRCODE = 'check_violation';
    ELSIF v_moros = 'bloqueo_cc' AND v_es_cc THEN
      RAISE EXCEPTION 'Cliente con deuda vencida ($%). No puede sumar a cuenta corriente; cobrá por otro medio.', round(v_deuda_venc)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- B1 — límite (parte CC, solo si la política es 'bloquear').
  IF v_es_cc THEN
    BEGIN
      IF NEW.medio_pago IS NOT NULL AND btrim(NEW.medio_pago) <> '' THEN
        SELECT COALESCE(SUM((e->>'monto')::numeric), 0) INTO v_monto_cc
          FROM jsonb_array_elements(NEW.medio_pago::jsonb) e
          WHERE e->>'tipo' = 'Cuenta Corriente';
      END IF;
    EXCEPTION WHEN others THEN
      v_monto_cc := 0;
    END;

    IF v_monto_cc > v_eps THEN
      v_enf := COALESCE((SELECT cc_enforcement_politica FROM public.tenants WHERE id = NEW.tenant_id), 'avisar');
      IF v_enf = 'bloquear' THEN
        SELECT COALESCE(c.limite_credito, t.limite_cc_default)
          INTO v_limite
          FROM public.clientes c, public.tenants t
          WHERE c.id = NEW.cliente_id AND t.id = NEW.tenant_id;
        IF v_limite IS NOT NULL AND (v_deuda_total + v_monto_cc) > v_limite + v_eps THEN
          RAISE EXCEPTION 'La venta deja la cuenta corriente en $% y supera el límite de $%. Operación bloqueada.',
            round(v_deuda_total + v_monto_cc), round(v_limite)
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.fn_ventas_writeoff_rol_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_new_writeoff boolean := false;
  v_rol text;
BEGIN
  BEGIN
    v_new_writeoff :=
      EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.medio_pago,'[]')::jsonb) e
              WHERE e->>'tipo' IN ('Condonación CC','Incobrable'))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(OLD.medio_pago,'[]')::jsonb) e
              WHERE e->>'tipo' IN ('Condonación CC','Incobrable'));
  EXCEPTION WHEN others THEN
    v_new_writeoff := false;  -- JSON malformado → no bloquear
  END;

  IF v_new_writeoff THEN
    v_rol := public.get_user_role();
    IF v_rol IS DISTINCT FROM 'DUEÑO'
       AND v_rol IS DISTINCT FROM 'SUPERVISOR'
       AND v_rol IS DISTINCT FROM 'SUPER_USUARIO'
       AND v_rol IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'No autorizado: dar por perdida (condonar/incobrable) deuda de cuenta corriente requiere rol DUEÑO/SUPERVISOR/ADMIN.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.gen_venta_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id;
  END IF;
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
    FROM ventas
    WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  IF NEW.estado = 'pendiente' AND NEW.presupuesto_numero IS NULL THEN
    SELECT COALESCE(MAX(presupuesto_numero), 0) + 1 INTO NEW.presupuesto_numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id AND presupuesto_numero IS NOT NULL;
    IF NEW.sucursal_id IS NOT NULL THEN
      SELECT COALESCE(MAX(presupuesto_numero_sucursal), 0) + 1 INTO NEW.presupuesto_numero_sucursal
      FROM ventas
      WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id
        AND presupuesto_numero_sucursal IS NOT NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.generar_otp_envio(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID; v_tenant UUID; v_tel TEXT; v_cod TEXT; BEGIN
  SELECT e.id, e.tenant_id, cl.telefono INTO v_id, v_tenant, v_tel
  FROM envios e
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  WHERE e.token_transportista = p_token;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  v_cod := lpad((floor(random()*1000000))::int::text, 6, '0');
  INSERT INTO envio_otp(tenant_id, envio_id, codigo, telefono, enviado_at)
    VALUES (v_tenant, v_id, v_cod, v_tel, NOW());
  UPDATE envios SET pod_otp_verificado = false WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'codigo', v_cod, 'telefono', v_tel);
END;$function$


CREATE OR REPLACE FUNCTION public.generate_lpn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lpn IS NULL OR NEW.lpn = '' THEN
    NEW.lpn := 'LPN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6));
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.get_cuenta_cliente_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cli RECORD; v_ventas JSONB; BEGIN
  SELECT c.id, c.nombre, c.telefono, c.email, c.tenant_id,
         t.nombre AS tenant_nombre, t.moneda
  INTO v_cli
  FROM clientes c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.cuenta_token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'numero',      v.numero,
    'fecha',       v.created_at::date,
    'total',       v.total,
    'pagado',      v.monto_pagado,
    'saldo',       GREATEST(v.total - v.monto_pagado, 0),
    'interes',     v.interes_cc,
    'vencimiento', v.fecha_vencimiento_cc
  ) ORDER BY v.created_at)
  INTO v_ventas
  FROM ventas v
  WHERE v.cliente_id = v_cli.id
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND (v.total - v.monto_pagado) > 0.5;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('nombre', v_cli.nombre, 'telefono', v_cli.telefono, 'email', v_cli.email),
    'negocio', v_cli.tenant_nombre,
    'moneda',  COALESCE(v_cli.moneda, 'ARS'),
    'ventas',  COALESCE(v_ventas, '[]'::jsonb)
  );
END;$function$


CREATE OR REPLACE FUNCTION public.get_envio_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row RECORD; BEGIN
  SELECT e.id, e.numero, e.estado, e.courier, e.servicio, e.tracking_number,
         e.destino_descripcion, e.fecha_entrega_acordada, e.hora_entrega_acordada,
         e.notas, e.costo_cotizado, e.costo_pagado,
         e.pod_fecha, e.pod_receptor, e.pod_notas, e.pod_url,
         e.pod_dni, e.pod_firma_url, e.pod_geo_estado, e.pod_otp_verificado,
         e.intentos, e.subestado_no_entrega, e.no_entrega_motivo,
         (e.courier = 'Envío propio') AS es_propio,
         e.tenant_id, e.token_expira_at,
         cd.calle, cd.numero AS dom_numero, cd.ciudad, cd.provincia,
         cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
         rp.nombre AS repartidor_nombre,
         tn.nombre AS tenant_nombre,
         tn.pod_campos_requeridos, tn.pod_foto_min, tn.pod_otp_umbral,
         tn.envio_reintentos_max, tn.envio_geoloc_alerta_km, tn.envio_identidad_modo
  INTO v_row
  FROM envios e
  LEFT JOIN cliente_domicilios cd ON cd.id = e.destino_id
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  LEFT JOIN repartidores rp ON rp.id = e.repartidor_id
  LEFT JOIN tenants tn ON tn.id = e.tenant_id
  WHERE e.token_transportista = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.token_expira_at IS NOT NULL AND v_row.token_expira_at < NOW() THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END;$function$


CREATE OR REPLACE FUNCTION public.get_envio_items_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_items JSONB; BEGIN
  SELECT jsonb_agg(jsonb_build_object('nombre', p.nombre, 'sku', p.sku, 'cantidad', vi.cantidad)) INTO v_items
  FROM envios e
  JOIN ventas v ON v.id = e.venta_id
  JOIN venta_items vi ON vi.venta_id = v.id
  JOIN productos p ON p.id = vi.producto_id
  WHERE e.token_transportista = p_token;
  RETURN COALESCE(v_items, '[]'::jsonb);
END;$function$


CREATE OR REPLACE FUNCTION public.get_fichado_info(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant_id UUID; v_nombre TEXT; v_empleados JSONB;
BEGIN
  SELECT id, nombre INTO v_tenant_id, v_nombre FROM tenants WHERE fichado_token = p_token;
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', e.id,
    'nombre', e.nombre,
    'apellido', e.apellido,
    'ultimo_tipo_hoy', (
      SELECT f.tipo FROM rrhh_fichadas f
      WHERE f.empleado_id = e.id AND f.ts::date = now()::date
      ORDER BY f.ts DESC LIMIT 1
    )
  ) ORDER BY e.apellido NULLS LAST, e.nombre)
  INTO v_empleados
  FROM empleados e
  WHERE e.tenant_id = v_tenant_id AND e.activo = TRUE;

  RETURN jsonb_build_object('tenant_nombre', v_nombre, 'empleados', COALESCE(v_empleados, '[]'::jsonb));
END;$function$


CREATE OR REPLACE FUNCTION public.get_hoja_ruta_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_hoja RECORD; v_envios JSONB; BEGIN
  SELECT h.id, h.fecha, rp.nombre AS repartidor_nombre, tn.nombre AS tenant_nombre
    INTO v_hoja
  FROM hojas_ruta h
  LEFT JOIN repartidores rp ON rp.id = h.repartidor_id
  LEFT JOIN tenants tn ON tn.id = h.tenant_id
  WHERE h.token = p_token;
  IF v_hoja.id IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'orden', hre.orden, 'numero', e.numero, 'estado', e.estado,
    'token', e.token_transportista, 'cliente', cl.nombre, 'telefono', cl.telefono,
    'direccion', COALESCE(cd.calle || COALESCE(' ' || cd.numero,''), e.destino_descripcion),
    'ciudad', cd.ciudad, 'zona', e.zona_entrega, 'hora', e.hora_entrega_acordada
  ) ORDER BY hre.orden) INTO v_envios
  FROM hoja_ruta_envios hre
  JOIN envios e ON e.id = hre.envio_id
  LEFT JOIN ventas v ON v.id = e.venta_id
  LEFT JOIN clientes cl ON cl.id = v.cliente_id
  LEFT JOIN cliente_domicilios cd ON cd.id = e.destino_id
  WHERE hre.hoja_id = v_hoja.id;
  RETURN jsonb_build_object('fecha', v_hoja.fecha, 'repartidor_nombre', v_hoja.repartidor_nombre,
    'tenant_nombre', v_hoja.tenant_nombre, 'envios', COALESCE(v_envios, '[]'::jsonb));
END;$function$


CREATE OR REPLACE FUNCTION public.get_supervisor_team_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id
  FROM empleados e
  WHERE e.supervisor_id IN (
          SELECT sup.id FROM empleados sup
          WHERE sup.user_id = auth.uid()
            AND sup.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        )
    AND e.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND e.activo = true
$function$


CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT rol FROM users WHERE id = auth.uid()
$function$


CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$function$


CREATE OR REPLACE FUNCTION public.guard_subscription_status_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.subscription_status = 'active'
     AND NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
    IF auth.role() <> 'service_role'
       AND coalesce(public.get_user_role(), '') <> 'ADMIN' THEN
      RAISE EXCEPTION 'subscription_status=active solo lo activa el servidor con el pago verificado (no desde el cliente)';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.iniciar_armado_kit(p_kit_producto_id uuid, p_cantidad numeric, p_ubicacion_id uuid, p_sucursal_id uuid, p_notas text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; rec RECORD; ln RECORD;
  v_requerido numeric; v_disponible numeric; v_restante numeric; v_reservar numeric;
  v_reservados jsonb := '[]'::jsonb; v_log_id uuid; v_nrecetas int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  SELECT count(*) INTO v_nrecetas FROM kit_recetas WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id;
  IF v_nrecetas = 0 THEN RAISE EXCEPTION 'El KIT no tiene receta configurada'; END IF;
  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id LOOP
    v_requerido := rec.cantidad * p_cantidad;
    SELECT COALESCE(sum(cantidad - COALESCE(cantidad_reservada, 0)), 0) INTO v_disponible FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = rec.comp_producto_id AND activo = true AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
    IF v_disponible < v_requerido THEN RAISE EXCEPTION 'Stock insuficiente del componente % (necesita %, hay %)', rec.comp_producto_id, v_requerido, v_disponible; END IF;
  END LOOP;
  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id LOOP
    v_restante := rec.cantidad * p_cantidad;
    FOR ln IN SELECT id, (cantidad - COALESCE(cantidad_reservada, 0)) AS disp FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = rec.comp_producto_id AND activo = true AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id)
        AND (cantidad - COALESCE(cantidad_reservada, 0)) > 0 ORDER BY created_at LOOP
      EXIT WHEN v_restante <= 0;
      v_reservar := LEAST(ln.disp, v_restante);
      UPDATE inventario_lineas SET cantidad_reservada = COALESCE(cantidad_reservada, 0) + v_reservar WHERE id = ln.id;
      v_reservados := v_reservados || jsonb_build_object('linea_id', ln.id, 'comp_producto_id', rec.comp_producto_id, 'cantidad', v_reservar);
      v_restante := v_restante - v_reservar;
    END LOOP;
  END LOOP;
  INSERT INTO kitting_log (tenant_id, kit_producto_id, cantidad_kits, ubicacion_id, usuario_id, notas, tipo, estado, componentes_reservados)
  VALUES (v_tenant, p_kit_producto_id, p_cantidad, p_ubicacion_id, auth.uid(), p_notas, 'armado', 'en_armado', v_reservados) RETURNING id INTO v_log_id;
  RETURN v_log_id;
END $function$


CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND rol = 'ADMIN'
  )
$function$


CREATE OR REPLACE FUNCTION public.is_rrhh()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND (rol = 'RRHH' OR rol = 'DUEÑO')
  )
$function$


CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM support_agents WHERE id = auth.uid() AND activo)
$function$


CREATE OR REPLACE FUNCTION public.liberar_reservas_vencidas(p_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dias       INTEGER;
  v_penal_pct  NUMERIC;
  v_count      INTEGER := 0;
  r            RECORD;
  it           RECORD;
  ln           RECORD;
  v_restante   NUMERIC;
  v_lib        NUMERIC;
  v_acreditar  NUMERIC;
BEGIN
  SELECT reserva_vencimiento_dias, COALESCE(reserva_penalidad_pct, 0)
    INTO v_dias, v_penal_pct
    FROM tenants WHERE id = p_tenant_id;
  IF v_dias IS NULL OR v_dias <= 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT id, cliente_id, COALESCE(monto_pagado, 0) AS monto_pagado, numero
    FROM ventas
    WHERE tenant_id = p_tenant_id
      AND estado = 'reservada'
      AND COALESCE(reservado_at, updated_at) < NOW() - (v_dias * INTERVAL '1 day')
  LOOP
    BEGIN
      FOR it IN
        SELECT vi.id AS item_id, vi.producto_id, vi.cantidad, p.tiene_series
        FROM venta_items vi
        JOIN productos p ON p.id = vi.producto_id
        WHERE vi.venta_id = r.id
      LOOP
        IF it.tiene_series THEN
          UPDATE inventario_series
            SET reservado = false
            WHERE id IN (SELECT serie_id FROM venta_series WHERE venta_item_id = it.item_id);
        ELSE
          v_restante := it.cantidad;
          FOR ln IN
            SELECT id, cantidad_reservada FROM inventario_lineas
            WHERE producto_id = it.producto_id AND activo = true AND cantidad_reservada > 0
            ORDER BY created_at
          LOOP
            EXIT WHEN v_restante <= 0;
            v_lib := LEAST(ln.cantidad_reservada, v_restante);
            UPDATE inventario_lineas
              SET cantidad_reservada = cantidad_reservada - v_lib
              WHERE id = ln.id;
            v_restante := v_restante - v_lib;
          END LOOP;
        END IF;
      END LOOP;

      IF r.monto_pagado > 0.01 AND r.cliente_id IS NOT NULL THEN
        v_acreditar := round((GREATEST(0, r.monto_pagado * (1 - v_penal_pct / 100.0)))::numeric, 2);
        IF v_acreditar > 0.01 THEN
          INSERT INTO cliente_creditos (tenant_id, cliente_id, monto, origen, venta_id, nota)
          VALUES (p_tenant_id, r.cliente_id, v_acreditar, 'reserva_vencida', r.id,
            'Reserva vencida #' || COALESCE(r.numero::text, '?') ||
            CASE WHEN v_penal_pct > 0 THEN ' (penalidad ' || v_penal_pct || '%)' ELSE '' END);
        END IF;
      END IF;

      UPDATE ventas
        SET estado = 'cancelada',
            cancelado_at = NOW(),
            notas = COALESCE(notas, '') || ' · [Reserva vencida: stock liberado automaticamente el '
                    || to_char(NOW(), 'DD/MM/YYYY')
                    || CASE WHEN r.monto_pagado > 0.01 AND r.cliente_id IS NOT NULL
                            THEN '; seña acreditada al cliente' ELSE '' END || ']'
        WHERE id = r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN v_count;
END;
$function$


CREATE OR REPLACE FUNCTION public.liberar_reservas_vencidas_all()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INT := 0;
  v_n     INT;
  t       RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    v_n := liberar_reservas_vencidas(t.id);
    v_total := v_total + COALESCE(v_n, 0);
  END LOOP;
  RETURN v_total;
END;
$function$


CREATE OR REPLACE FUNCTION public.marcar_envios_pagados(p_envio_ids uuid[], p_clave text DEFAULT NULL::text, p_medio text DEFAULT 'Efectivo'::text, p_fecha date DEFAULT NULL::date, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_genera_gasto boolean DEFAULT true, p_iva_pct numeric DEFAULT 21, p_categoria_flete_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant     uuid := public.get_user_tenant_id();
  v_user       uuid := auth.uid();
  v_eps        numeric := 0.5;
  v_totalpago  numeric := 0;
  v_n_envios   int := 0;
  v_umbral     numeric;
  v_clave_real text;
  v_es_efectivo boolean := (p_medio = 'Efectivo');
  v_fecha      date := COALESCE(p_fecha, CURRENT_DATE);
  v_grp        record;
  v_neto       numeric;
  v_iva        numeric;
  v_gasto_id   uuid;
  v_gasto_total numeric := 0;
  v_grupos     int := 0;
  v_concepto   text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF p_envio_ids IS NULL OR array_length(p_envio_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Seleccioná al menos un envío';
  END IF;

  SELECT COALESCE(SUM(COALESCE(costo_cotizado,0)),0), COUNT(*)
    INTO v_totalpago, v_n_envios
    FROM public.envios WHERE id = ANY(p_envio_ids) AND tenant_id = v_tenant;
  IF v_n_envios = 0 THEN RAISE EXCEPTION 'Envíos no encontrados para el tenant'; END IF;

  IF p_caja_sesion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Caja inválida para el tenant';
  END IF;

  v_umbral := (SELECT envio_pago_doble_firma_umbral FROM public.tenants WHERE id = v_tenant);
  IF v_umbral IS NOT NULL AND v_umbral > 0 AND v_totalpago >= v_umbral THEN
    SELECT clave_maestra INTO v_clave_real FROM public.tenants WHERE id = v_tenant;
    IF v_clave_real IS NULL OR length(trim(v_clave_real)) = 0 THEN
      RAISE EXCEPTION 'Pago de $% sobre el umbral de doble firma ($%): configurá una clave maestra (Config → Seguridad) para autorizarlo.',
        round(v_totalpago), round(v_umbral) USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
      RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  FOR v_grp IN
    SELECT s.courier,
           array_agg(s.id) AS ids,
           SUM(COALESCE(s.costo_cotizado,0)) AS total,
           (array_agg(s.sucursal_id) FILTER (WHERE s.sucursal_id IS NOT NULL))[1] AS sucursal_id,
           string_agg('#'||COALESCE(s.numero::text, right(s.id::text,6)), ', ') AS numeros,
           COUNT(*) AS n
    FROM (SELECT id, COALESCE(NULLIF(btrim(courier),''),'Courier') AS courier, costo_cotizado, sucursal_id, numero
          FROM public.envios WHERE id = ANY(p_envio_ids) AND tenant_id = v_tenant) s
    GROUP BY s.courier
  LOOP
    v_grupos := v_grupos + 1;
    v_gasto_id := NULL;

    IF p_genera_gasto AND v_grp.total > v_eps THEN
      IF p_iva_pct IS NULL OR p_iva_pct <= 0 THEN
        v_iva := 0;
      ELSE
        v_neto := v_grp.total / (1 + p_iva_pct / 100);
        v_iva  := round(v_grp.total - v_neto, 2);
      END IF;

      INSERT INTO public.gastos(
        tenant_id, descripcion, monto, categoria, categoria_id, tipo_iva, iva_monto, alicuota_iva,
        iva_deducible, deduce_ganancias, gasto_negocio, medio_pago, fecha, sucursal_id, usuario_id,
        monto_pagado, estado_pago, notas)
      VALUES (
        v_tenant,
        'Flete '||v_grp.courier||' — '||v_grp.n||' envío'||CASE WHEN v_grp.n > 1 THEN 's' ELSE '' END,
        v_grp.total, 'Transporte y fletes', p_categoria_flete_id,
        CASE WHEN p_iva_pct > 0 THEN p_iva_pct::text ELSE NULL END,
        CASE WHEN v_iva > 0 THEN v_iva ELSE NULL END,
        CASE WHEN p_iva_pct > 0 THEN p_iva_pct ELSE NULL END,
        (p_iva_pct > 0), true, true,
        jsonb_build_array(jsonb_build_object('tipo', p_medio, 'monto', v_grp.total))::text,
        v_fecha, v_grp.sucursal_id, v_user, v_grp.total, 'pagado',
        'Pago a courier (Envíos): '||v_grp.numeros)
      RETURNING id INTO v_gasto_id;
      v_gasto_total := v_gasto_total + v_grp.total;

      IF p_caja_sesion_id IS NOT NULL THEN
        v_concepto := 'Flete '||v_grp.courier||' — '||v_grp.n||' envío(s)';
        INSERT INTO public.caja_movimientos(tenant_id, sesion_id, tipo, concepto, monto, usuario_id)
        VALUES (v_tenant, p_caja_sesion_id,
                CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
                CASE WHEN v_es_efectivo THEN v_concepto ELSE '['||p_medio||'] '||v_concepto END,
                v_grp.total, v_user);
      END IF;
    END IF;

    UPDATE public.envios
       SET costo_pagado = true, fecha_pago_courier = v_fecha, medio_pago_courier = p_medio,
           gasto_id = COALESCE(v_gasto_id, gasto_id)
     WHERE id = ANY(v_grp.ids) AND tenant_id = v_tenant;
  END LOOP;

  RETURN jsonb_build_object('envios', v_n_envios, 'gasto_total', v_gasto_total, 'grupos', v_grupos);
END $function$


CREATE OR REPLACE FUNCTION public.marcar_incobrable(p_cliente_id uuid, p_clave text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant  uuid := public.get_user_tenant_id();
  v_rol     text := public.get_user_role();
  v_user    uuid := auth.uid();
  v_nombre  text;
  v_total   numeric := 0;
  v_count   int := 0;
  v_venta   record;
  v_medios  jsonb;
  v_saldo   numeric;
  v_motivo  text := NULLIF(btrim(p_motivo), '');
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol IS DISTINCT FROM 'DUEÑO'
     AND v_rol IS DISTINCT FROM 'SUPER_USUARIO'
     AND v_rol IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'No autorizado: dar de baja incobrable requiere rol DUEÑO/ADMIN.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
    RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT nombre INTO v_nombre FROM public.clientes WHERE id = p_cliente_id AND tenant_id = v_tenant;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado en el tenant'; END IF;

  FOR v_venta IN
    SELECT id, total, monto_pagado, medio_pago
      FROM public.ventas
     WHERE tenant_id = v_tenant
       AND cliente_id = p_cliente_id
       AND es_cuenta_corriente = TRUE
       AND estado IN ('despachada','facturada')
       AND (COALESCE(total,0) - COALESCE(monto_pagado,0)) > 0.5
  LOOP
    BEGIN v_medios := COALESCE(v_venta.medio_pago, '[]')::jsonb; EXCEPTION WHEN others THEN v_medios := '[]'::jsonb; END;
    IF jsonb_typeof(v_medios) <> 'array' THEN v_medios := '[]'::jsonb; END IF;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_medios) e
               WHERE e->>'tipo' IN ('Condonación CC','Cancelación CC','Incobrable')) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(v_venta.total,0) - COALESCE(SUM((e->>'monto')::numeric), 0)
      INTO v_saldo
      FROM jsonb_array_elements(v_medios) e
     WHERE e->>'tipo' <> 'Cuenta Corriente';

    IF v_saldo > 0.5 THEN
      v_medios := v_medios || jsonb_build_object(
        'tipo','Incobrable', 'monto', v_saldo, 'motivo', v_motivo,
        'por', v_user::text,
        'at', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
      v_total := v_total + v_saldo;
    END IF;

    UPDATE public.ventas
       SET monto_pagado = COALESCE(v_venta.total,0), medio_pago = v_medios::text
     WHERE id = v_venta.id;
    v_count := v_count + 1;
  END LOOP;

  IF v_total > 0.5 THEN
    INSERT INTO public.gastos (tenant_id, descripcion, monto, categoria, fecha, usuario_id)
    VALUES (v_tenant,
            'Deudor incobrable: ' || v_nombre || CASE WHEN v_motivo IS NOT NULL THEN ' — ' || v_motivo ELSE '' END,
            round(v_total * 100) / 100,
            'Deudores incobrables',
            (now() AT TIME ZONE 'utc')::date,
            v_user);
  END IF;

  RETURN jsonb_build_object('total_incobrable', v_total, 'ventas_afectadas', v_count);
END $function$


CREATE OR REPLACE FUNCTION public.pagar_nomina_empleado(p_salario_id uuid, p_sesion_id uuid, p_medio_pago text DEFAULT 'efectivo'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sal      rrhh_salarios;
  v_emp      empleados;
  v_mov      UUID;
  v_apertura NUMERIC;
  v_ingresos NUMERIC;
  v_egresos  NUMERIC;
  v_saldo    NUMERIC;
  v_es_efectivo boolean := (p_medio_pago = 'efectivo');
  v_concepto text;
  v_medio_lbl text;
  v_rol         text := public.get_user_role();
  v_doble       boolean;
  v_super_ok    boolean;
BEGIN
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  IF v_sal.pagado THEN RAISE EXCEPTION 'La liquidación ya fue pagada'; END IF;
  IF v_sal.neto <= 0 THEN RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar'; END IF;

  SELECT COALESCE(rrhh_nomina_doble_validacion, false), COALESCE(rrhh_nomina_supervisor_aprueba, false)
    INTO v_doble, v_super_ok
  FROM tenants WHERE id = v_sal.tenant_id;
  IF v_doble THEN
    IF NOT (v_rol IN ('DUEÑO','ADMIN') OR (v_super_ok AND v_rol = 'SUPERVISOR')) THEN
      RAISE EXCEPTION 'Requiere aprobación de DUEÑO/ADMIN (doble validación de nómina activada).'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;

  IF NOT EXISTS (
    SELECT 1 FROM caja_sesiones
    WHERE id = p_sesion_id AND tenant_id = v_sal.tenant_id AND estado = 'abierta'
  ) THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;

  IF v_es_efectivo THEN
    SELECT monto_apertura INTO v_apertura FROM caja_sesiones WHERE id = p_sesion_id;
    SELECT
      COALESCE(SUM(CASE WHEN tipo IN ('ingreso', 'ingreso_reserva', 'ingreso_traspaso') THEN monto ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tipo IN ('egreso', 'egreso_devolucion_sena', 'egreso_traspaso') THEN monto ELSE 0 END), 0)
    INTO v_ingresos, v_egresos
    FROM caja_movimientos WHERE sesion_id = p_sesion_id;
    v_saldo := COALESCE(v_apertura, 0) + v_ingresos - v_egresos;
    IF v_saldo < v_sal.neto THEN
      RAISE EXCEPTION 'Saldo insuficiente: disponible $%, necesita $%', ROUND(v_saldo), ROUND(v_sal.neto);
    END IF;
  END IF;

  v_concepto := 'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY');
  v_medio_lbl := CASE p_medio_pago WHEN 'transferencia_banco' THEN 'Transferencia'
                                   WHEN 'mp' THEN 'Mercado Pago' ELSE p_medio_pago END;

  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (
    v_mov, v_sal.tenant_id, p_sesion_id,
    CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
    CASE WHEN v_es_efectivo THEN v_concepto ELSE '[' || v_medio_lbl || '] ' || v_concepto END,
    v_sal.neto
  );

  UPDATE rrhh_salarios
  SET pagado = TRUE, fecha_pago = NOW(), caja_movimiento_id = v_mov,
      medio_pago = p_medio_pago, updated_at = NOW()
  WHERE id = p_salario_id;

  RETURN v_mov;
END;
$function$


CREATE OR REPLACE FUNCTION public.pagar_nomina_empleado(p_salario_id uuid, p_sesion_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sal rrhh_salarios;
  v_emp empleados;
  v_mov UUID;
BEGIN
  -- Obtener liquidación
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liquidación no encontrada';
  END IF;
  IF v_sal.pagado THEN
    RAISE EXCEPTION 'La liquidación ya fue pagada';
  END IF;
  IF v_sal.neto <= 0 THEN
    RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar';
  END IF;

  -- Obtener empleado
  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;

  -- Validar sesión de caja abierta y del mismo tenant
  IF NOT EXISTS (
    SELECT 1 FROM caja_sesiones
    WHERE id        = p_sesion_id
      AND tenant_id = v_sal.tenant_id
      AND estado    = 'abierta'
  ) THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;

  -- Crear movimiento de egreso en caja
  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (
    v_mov,
    v_sal.tenant_id,
    p_sesion_id,
    'egreso',
    'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY'),
    v_sal.neto
  );

  -- Marcar liquidación como pagada
  UPDATE rrhh_salarios SET
    pagado             = TRUE,
    fecha_pago         = NOW(),
    caja_movimiento_id = v_mov,
    updated_at         = NOW()
  WHERE id = p_salario_id;

  RETURN v_mov;
END;
$function$


CREATE OR REPLACE FUNCTION public.periodo_cerrado(p_tenant_id uuid, p_fecha date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(p_fecha <= ultimo_cierre_hasta(p_tenant_id), FALSE)
$function$


CREATE OR REPLACE FUNCTION public.process_aging_profile_single(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_tenant    UUID;
  v_linea            RECORD;
  v_estado_nuevo     UUID;
  v_estado_ant       TEXT;
  v_estado_nuevo_nom TEXT;
  v_cambios          INT := 0;
  v_dias             INT;
BEGIN
  SELECT tenant_id INTO v_target_tenant FROM users WHERE id = auth.uid();
  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aging_profiles WHERE id = p_profile_id AND tenant_id = v_target_tenant) THEN
    RETURN jsonb_build_object('error', 'Perfil no encontrado', 'cambios', 0);
  END IF;
  FOR v_linea IN
    SELECT il.id, il.estado_id, il.fecha_vencimiento, il.tenant_id, il.producto_id, p.aging_profile_id, p.nombre AS prod_nombre
    FROM inventario_lineas il
    JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id = p_profile_id AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;
    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = p_profile_id AND apr.dias >= v_dias
    ORDER BY apr.dias ASC LIMIT 1;
    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nom FROM estados_inventario WHERE id = v_estado_nuevo;
      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;
      INSERT INTO actividad_log (tenant_id, entidad, entidad_id, entidad_nombre, accion, campo, valor_anterior, valor_nuevo, pagina)
      VALUES (v_linea.tenant_id, 'inventario_linea', v_linea.id, v_linea.prod_nombre, 'cambio_estado', 'estado', COALESCE(v_estado_ant, 'sin estado'), v_estado_nuevo_nom, 'aging_profile_single');
      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('cambios', v_cambios, 'profile_id', p_profile_id);
END;
$function$


CREATE OR REPLACE FUNCTION public.process_aging_profiles(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_tenant UUID;
  v_linea         RECORD;
  v_estado_nuevo  UUID;
  v_estado_ant    TEXT;
  v_estado_nuevo_nombre TEXT;
  v_cambios       INT := 0;
  v_dias          INT;
BEGIN
  IF p_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_target_tenant FROM users WHERE id = auth.uid();
  ELSE
    v_target_tenant := p_tenant_id;
  END IF;

  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
  END IF;

  FOR v_linea IN
    SELECT
      il.id,
      il.estado_id,
      il.fecha_vencimiento,
      il.tenant_id,
      il.producto_id,
      p.aging_profile_id,
      p.nombre AS prod_nombre
    FROM inventario_lineas il
    JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE
      AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id IS NOT NULL
      AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;

    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = v_linea.aging_profile_id
      AND apr.dias >= v_dias
    ORDER BY apr.dias ASC
    LIMIT 1;

    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant        FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nombre FROM estados_inventario WHERE id = v_estado_nuevo;

      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;

      INSERT INTO actividad_log (
        tenant_id, usuario_id, usuario_nombre,
        entidad, entidad_id, entidad_nombre,
        accion, campo, valor_anterior, valor_nuevo, pagina
      ) VALUES (
        v_linea.tenant_id,
        NULL, 'Sistema (Aging)',
        'inventario_linea', v_linea.id::TEXT, v_linea.prod_nombre,
        'cambio_estado_auto',
        'estado',
        COALESCE(v_estado_ant, 'Sin estado'),
        COALESCE(v_estado_nuevo_nombre, 'Sin estado'),
        '/aging-auto'
      );

      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'cambios', v_cambios,
    'tenant_id', v_target_tenant,
    'procesado_en', NOW()
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.puede_aprobar_autorizacion_gasto(p_solicitante_rol text, p_aprobador_rol text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_solicitante_rol = 'CAJERO'     AND p_aprobador_rol IN ('SUPERVISOR','ADMIN','DUEÑO','SUPER_USUARIO') THEN TRUE
    WHEN p_solicitante_rol = 'SUPERVISOR' AND p_aprobador_rol IN ('ADMIN','DUEÑO','SUPER_USUARIO') THEN TRUE
    ELSE FALSE
  END;
$function$


CREATE OR REPLACE FUNCTION public.reabrir_periodo(p_cierre_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_rol       TEXT;
  v_cierre    cierres_contables;
  v_ultimo    DATE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT tenant_id, rol INTO v_tenant_id, v_rol FROM users WHERE id = v_user_id;

  IF v_rol NOT IN ('DUEÑO','SUPER_USUARIO','ADMIN') THEN
    RAISE EXCEPTION 'Sólo DUEÑO/ADMIN pueden reabrir un cierre.';
  END IF;

  SELECT * INTO v_cierre FROM cierres_contables WHERE id = p_cierre_id AND tenant_id = v_tenant_id;
  IF v_cierre.id IS NULL THEN RAISE EXCEPTION 'Cierre no encontrado'; END IF;

  SELECT MAX(periodo) INTO v_ultimo FROM cierres_contables WHERE tenant_id = v_tenant_id;
  IF v_cierre.periodo <> v_ultimo THEN
    RAISE EXCEPTION 'Sólo se puede reabrir el último cierre (% es anterior a %)', TO_CHAR(v_cierre.periodo,'MM/YYYY'), TO_CHAR(v_ultimo,'MM/YYYY');
  END IF;

  DELETE FROM cierres_contables WHERE id = p_cierre_id;
  RETURN TRUE;
END $function$


CREATE OR REPLACE FUNCTION public.recalcular_intereses_cc(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pct NUMERIC;
  v_count INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND tenant_id = p_tenant) THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(cc_interes_mensual_pct, 0) INTO v_pct FROM tenants WHERE id = p_tenant;
  IF v_pct IS NULL OR v_pct <= 0 THEN
    UPDATE ventas SET interes_cc = 0
      WHERE tenant_id = p_tenant AND es_cuenta_corriente = TRUE AND interes_cc <> 0;
    RETURN 0;
  END IF;

  UPDATE ventas v SET interes_cc = ROUND(
      GREATEST(v.total - v.monto_pagado, 0)
      * (v_pct / 100.0)
      * (GREATEST(0, (CURRENT_DATE - v.fecha_vencimiento_cc)) / 30.0)
    , 2)
  WHERE v.tenant_id = p_tenant
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND v.fecha_vencimiento_cc IS NOT NULL
    AND (v.total - v.monto_pagado) > 0.5;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE ventas SET interes_cc = 0
    WHERE tenant_id = p_tenant AND es_cuenta_corriente = TRUE AND interes_cc <> 0
      AND ((total - monto_pagado) <= 0.5
           OR fecha_vencimiento_cc IS NULL
           OR fecha_vencimiento_cc >= CURRENT_DATE);

  RETURN v_count;
END;
$function$


CREATE OR REPLACE FUNCTION public.recalcular_intereses_cc_all()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INT := 0;
  v_count INT;
  v_pct   NUMERIC;
  t       RECORD;
BEGIN
  FOR t IN SELECT id, COALESCE(cc_interes_mensual_pct, 0) AS pct FROM tenants LOOP
    v_pct := t.pct;
    IF v_pct IS NULL OR v_pct <= 0 THEN
      UPDATE ventas SET interes_cc = 0
        WHERE tenant_id = t.id AND es_cuenta_corriente = TRUE AND interes_cc <> 0;
      CONTINUE;
    END IF;

    UPDATE ventas v SET interes_cc = ROUND(
        GREATEST(v.total - v.monto_pagado, 0)
        * (v_pct / 100.0)
        * (GREATEST(0, (CURRENT_DATE - v.fecha_vencimiento_cc)) / 30.0)
      , 2)
    WHERE v.tenant_id = t.id
      AND v.es_cuenta_corriente = TRUE
      AND v.estado <> 'cancelada'
      AND v.fecha_vencimiento_cc IS NOT NULL
      AND (v.total - v.monto_pagado) > 0.5;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;

    UPDATE ventas SET interes_cc = 0
      WHERE tenant_id = t.id AND es_cuenta_corriente = TRUE AND interes_cc <> 0
        AND ((total - monto_pagado) <= 0.5
             OR fecha_vencimiento_cc IS NULL
             OR fecha_vencimiento_cc >= CURRENT_DATE);
  END LOOP;
  RETURN v_total;
END;
$function$


CREATE OR REPLACE FUNCTION public.recalcular_stock(p_producto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tiene_series BOOLEAN;
  v_stock INT;
BEGIN
  SELECT tiene_series INTO v_tiene_series FROM productos WHERE id = p_producto_id;
  IF v_tiene_series THEN
    SELECT COUNT(*) INTO v_stock FROM inventario_series
    WHERE producto_id = p_producto_id AND activo = TRUE;
  ELSE
    SELECT COALESCE(SUM(cantidad), 0) INTO v_stock FROM inventario_lineas
    WHERE producto_id = p_producto_id AND activo = TRUE;
  END IF;
  UPDATE productos SET stock_actual = v_stock WHERE id = p_producto_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.rechazar_vacacion(p_solicitud_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE rrhh_vacaciones_solicitud SET
    estado       = 'rechazada',
    aprobado_por = p_user_id,
    aprobado_at  = NOW(),
    updated_at   = NOW()
  WHERE id = p_solicitud_id AND estado = 'pendiente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada o ya procesada';
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.registrar_pago_oc(p_oc_id uuid, p_medios jsonb, p_descuento_monto numeric DEFAULT 0, p_clave text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_cheque jsonb DEFAULT NULL::jsonb, p_pago_dias integer DEFAULT 30, p_pago_condiciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant      uuid := public.get_user_tenant_id();
  v_rol         text := public.get_user_role();
  v_user        uuid := auth.uid();
  v_eps         numeric := 0.5;
  v_oc          record;
  v_prov_nombre text;
  v_total       numeric;
  v_montocc     numeric := 0;
  v_montonocc   numeric := 0;
  v_montototal  numeric;
  v_montocheque numeric := 0;
  v_descuento   numeric := COALESCE(p_descuento_monto, 0);
  v_saldo       numeric;
  v_umbral      numeric;
  v_clave_real  text;
  v_nuevo_pagado    numeric;
  v_nuevo_descuento numeric;
  v_nuevo_estado    text;
  v_fecha_venc  date;
  v_dias        int;
  v_medio       jsonb;
  v_medios_nocc jsonb;
  v_concepto    text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol IS NULL OR v_rol = 'CONTADOR' THEN
    RAISE EXCEPTION 'No autorizado: el CONTADOR tiene acceso de solo lectura — no puede registrar pagos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_medios IS NULL OR jsonb_typeof(p_medios) <> 'array' THEN RAISE EXCEPTION 'Medios de pago inválidos'; END IF;

  SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = p_oc_id AND tenant_id = v_tenant;
  IF v_oc.id IS NULL THEN RAISE EXCEPTION 'OC no encontrada en el tenant'; END IF;
  SELECT nombre INTO v_prov_nombre FROM public.proveedores WHERE id = v_oc.proveedor_id AND tenant_id = v_tenant;

  v_total := v_oc.monto_total;
  IF v_total IS NULL THEN
    SELECT COALESCE(SUM(COALESCE(cantidad,0) * COALESCE(precio_unitario,0)), 0)
      INTO v_total FROM public.orden_compra_items WHERE oc_id = p_oc_id;
  END IF;

  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocc
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cuenta Corriente';
  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montonocc
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente';
  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocheque
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cheque';
  v_montototal := v_montocc + v_montonocc;
  IF v_montototal <= v_eps THEN RAISE EXCEPTION 'Ingresá al menos un monto válido'; END IF;

  IF p_caja_sesion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Caja inválida para el tenant';
  END IF;

  v_umbral := (SELECT oc_pago_doble_firma_umbral FROM public.tenants WHERE id = v_tenant);
  IF v_umbral IS NOT NULL AND v_umbral > 0 AND v_montototal >= v_umbral THEN
    SELECT clave_maestra INTO v_clave_real FROM public.tenants WHERE id = v_tenant;
    IF v_clave_real IS NULL OR length(trim(v_clave_real)) = 0 THEN
      RAISE EXCEPTION 'Pago de $% sobre el umbral de doble firma ($%): configurá una clave maestra (Config → Seguridad) para autorizarlo.',
        round(v_montototal), round(v_umbral) USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
      RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  v_saldo := v_total - COALESCE(v_oc.monto_pagado,0) - COALESCE(v_oc.monto_descuento,0) - v_descuento;
  IF v_montototal > v_saldo + v_eps THEN
    RAISE EXCEPTION 'El monto $% supera el saldo de $%.', round(v_montototal), round(v_saldo) USING ERRCODE = 'check_violation';
  END IF;

  v_nuevo_pagado    := COALESCE(v_oc.monto_pagado,0) + v_montonocc;
  v_nuevo_descuento := COALESCE(v_oc.monto_descuento,0) + v_descuento;
  IF (v_nuevo_pagado + v_montocc + v_nuevo_descuento) >= v_total - v_eps THEN
    v_nuevo_estado := CASE WHEN v_montocc > 0 AND v_montonocc = 0 THEN 'cuenta_corriente' ELSE 'pagada' END;
  ELSE
    v_nuevo_estado := 'pago_parcial';
  END IF;

  IF v_montocc > 0 THEN
    v_dias := COALESCE(p_pago_dias, 30);
    v_fecha_venc := CURRENT_DATE + v_dias;
    UPDATE public.ordenes_compra SET
      estado_pago = v_nuevo_estado, monto_pagado = v_nuevo_pagado, monto_descuento = v_nuevo_descuento,
      monto_total = v_total, fecha_vencimiento_pago = v_fecha_venc, dias_plazo_pago = v_dias,
      condiciones_pago = NULLIF(p_pago_condiciones, '')
    WHERE id = p_oc_id AND tenant_id = v_tenant;
  ELSE
    UPDATE public.ordenes_compra SET
      estado_pago = v_nuevo_estado, monto_pagado = v_nuevo_pagado, monto_descuento = v_nuevo_descuento,
      monto_total = v_total
    WHERE id = p_oc_id AND tenant_id = v_tenant;
  END IF;

  IF v_montonocc > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('tipo', e->>'tipo', 'monto', (e->>'monto')::numeric))
      INTO v_medios_nocc FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente';
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, fecha, medio_pago, descripcion, caja_sesion_id, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'pago', -v_montonocc, CURRENT_DATE, v_medios_nocc::text,
            'Pago OC #'||v_oc.numero, p_caja_sesion_id, v_user);
  END IF;
  IF v_montocc > 0 THEN
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, fecha, fecha_vencimiento, descripcion, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'oc', v_montocc, CURRENT_DATE, v_fecha_venc,
            'CC OC #'||v_oc.numero||' — '||v_dias||'d', v_user);
  END IF;

  IF v_montocheque > 0 AND p_cheque IS NOT NULL THEN
    INSERT INTO public.cheques(tenant_id, tipo, estado, monto, nro_cheque, banco, fecha_emision, fecha_cobro, proveedor_id, oc_id, sucursal_id, notas, created_by)
    VALUES (v_tenant, 'propio', 'entregado', v_montocheque,
            NULLIF(p_cheque->>'nro',''), NULLIF(p_cheque->>'banco',''), CURRENT_DATE,
            NULLIF(p_cheque->>'fecha_cobro','')::date, v_oc.proveedor_id, p_oc_id,
            NULLIF(p_cheque->>'sucursal_id','')::uuid, 'Generado por pago OC #'||v_oc.numero, v_user);
  END IF;

  IF p_caja_sesion_id IS NOT NULL THEN
    v_concepto := 'Pago OC #'||v_oc.numero||' — '||COALESCE(v_prov_nombre,'');
    FOR v_medio IN SELECT e FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente'
    LOOP
      INSERT INTO public.caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id)
      VALUES (v_tenant, p_caja_sesion_id,
              CASE WHEN v_medio->>'tipo' = 'Efectivo' THEN 'egreso' ELSE 'egreso_informativo' END,
              (v_medio->>'monto')::numeric,
              CASE WHEN v_medio->>'tipo' = 'Efectivo' THEN v_concepto ELSE '['||(v_medio->>'tipo')||'] '||v_concepto END,
              CASE WHEN v_medio->>'tipo' = 'Efectivo' THEN NULL ELSE NULLIF(v_medio->>'cuenta_origen_id','')::uuid END,
              v_user);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_pago', v_nuevo_estado, 'monto_pagado', v_nuevo_pagado, 'monto_cheque', v_montocheque);
END $function$


CREATE OR REPLACE FUNCTION public.reportar_incidencia_envio(p_token text, p_tipo text, p_detalle text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID; v_tenant UUID; BEGIN
  SELECT id, tenant_id INTO v_id, v_tenant FROM envios WHERE token_transportista = p_token;
  IF v_id IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO envio_incidencias(tenant_id, envio_id, tipo, detalle)
    VALUES (v_tenant, v_id, COALESCE(NULLIF(p_tipo,''),'otro'), NULLIF(p_detalle,''));
  RETURN TRUE;
END;$function$


CREATE OR REPLACE FUNCTION public.requiere_clave_maestra(p_tenant_id uuid, p_accion text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clave TEXT;
BEGIN
  SELECT clave_maestra INTO v_clave FROM tenants WHERE id = p_tenant_id;
  IF v_clave IS NULL OR LENGTH(TRIM(v_clave)) = 0 THEN
    RETURN FALSE;
  END IF;
  RETURN p_accion IN ('cerrar_caja_ajena', 'abrir_caja_diferencia', 'anular_venta', 'anular_movimiento');
END $function$


CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION public.seed_canales_venta(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO canales_venta (tenant_id, nombre, clasificacion, icono, predefinido, orden) VALUES
    (p_tenant_id, 'Presencial',   'presencial', '🏪', TRUE, 10),
    (p_tenant_id, 'Instagram',    'online',     '📸', TRUE, 20),
    (p_tenant_id, 'Facebook',     'online',     '👤', TRUE, 30),
    (p_tenant_id, 'WhatsApp',     'online',     '💬', TRUE, 40),
    (p_tenant_id, 'MercadoLibre', 'online',     '🛒', TRUE, 50),
    (p_tenant_id, 'TiendaNube',   'online',     '🛍️', TRUE, 60),
    (p_tenant_id, 'Otros',        'presencial', '📦', TRUE, 99)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$function$


CREATE OR REPLACE FUNCTION public.seed_categorias_gasto(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO categorias_gasto (tenant_id, nombre, requiere_sucursal, predefinida, orden) VALUES
    (p_tenant_id, 'Alquiler',                       TRUE,  TRUE,  10),
    (p_tenant_id, 'Servicios (luz, gas, agua)',     TRUE,  TRUE,  20),
    (p_tenant_id, 'Internet y telefonía',           TRUE,  TRUE,  30),
    (p_tenant_id, 'Mercadería',                     TRUE,  TRUE,  40),
    (p_tenant_id, 'Insumos y suministros',          TRUE,  TRUE,  50),
    (p_tenant_id, 'Mantenimiento y reparaciones',   TRUE,  TRUE,  60),
    (p_tenant_id, 'Limpieza',                       TRUE,  TRUE,  70),
    (p_tenant_id, 'Marketing y publicidad',         FALSE, TRUE,  80),
    (p_tenant_id, 'Combustible',                    FALSE, TRUE,  90),
    (p_tenant_id, 'Transporte y fletes',            FALSE, TRUE, 100),
    (p_tenant_id, 'Impuestos y tasas',              FALSE, TRUE, 110),
    (p_tenant_id, 'Honorarios profesionales',       FALSE, TRUE, 120),
    (p_tenant_id, 'Comisiones bancarias',           FALSE, TRUE, 130),
    (p_tenant_id, 'SaaS y plataformas',             FALSE, TRUE, 140),
    (p_tenant_id, 'Capacitación',                   FALSE, TRUE, 150),
    (p_tenant_id, 'Otros',                          FALSE, TRUE, 999)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_cheque_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero_interno IS NULL OR NEW.numero_interno = 0 THEN
    SELECT COALESCE(MAX(numero_interno), 0) + 1 INTO NEW.numero_interno
      FROM cheques WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_clave_maestra(p_clave text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid;
  v_role   text;
BEGIN
  v_tenant := public.get_user_tenant_id();
  v_role   := public.get_user_role();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant en la sesión';
  END IF;
  IF v_role IS DISTINCT FROM 'DUEÑO' THEN
    RAISE EXCEPTION 'Solo el DUEÑO puede cambiar la clave maestra';
  END IF;
  IF p_clave IS NULL OR length(trim(p_clave)) < 6 THEN
    RAISE EXCEPTION 'La clave maestra debe tener al menos 6 caracteres';
  END IF;
  UPDATE public.tenants
     SET clave_maestra = extensions.crypt(trim(p_clave), extensions.gen_salt('bf'))
   WHERE id = v_tenant;
END $function$


CREATE OR REPLACE FUNCTION public.set_devprov_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM devoluciones_proveedor WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_envio_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.numero := COALESCE((SELECT MAX(numero) FROM envios WHERE tenant_id = NEW.tenant_id), 0) + 1;
  RETURN NEW;
END;$function$


CREATE OR REPLACE FUNCTION public.set_oc_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM ordenes_compra WHERE tenant_id = NEW.tenant_id;
  END IF;
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
      FROM ordenes_compra WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_traslado_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM traslados WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.set_updated_at_oc()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.stock_disponible_producto(p_producto_id uuid, p_tenant_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(
    CASE
      WHEN EXISTS (
        SELECT 1 FROM inventario_series s
        WHERE s.linea_id = il.id AND s.activo = true
      )
      THEN (
        SELECT COUNT(*) FROM inventario_series s
        WHERE s.linea_id = il.id AND s.activo = true AND s.reservado = false
      )
      ELSE GREATEST(0, il.cantidad - COALESCE(il.cantidad_reservada, 0))
    END
  ), 0)
  FROM inventario_lineas il
  WHERE il.producto_id = p_producto_id
    AND il.tenant_id   = p_tenant_id
    AND il.activo      = true
    AND il.cantidad    > 0
    AND il.ubicacion_id IS NOT NULL;
$function$


CREATE OR REPLACE FUNCTION public.tenant_sql_query(query_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET statement_timeout TO '10s'
 SET search_path TO 'public'
AS $function$
DECLARE
  result     JSONB;
  normalized TEXT;
BEGIN
  normalized := trim(regexp_replace(lower(query_text), '[[:space:]]+', ' ', 'g'));

  -- Solo SELECT o WITH — usar (\s|$) en vez de \b (no funciona en PG string literals)
  IF NOT (normalized ~* '^(select|with)([[:space:]]|$)') THEN
    RAISE EXCEPTION 'Solo se permiten consultas SELECT o WITH.';
  END IF;

  -- Bloquear keywords peligrosas
  IF normalized ~* '\m(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|execute|call)\M' THEN
    RAISE EXCEPTION 'La consulta contiene operaciones no permitidas.';
  END IF;

  -- Bloquear acceso a schemas del sistema
  IF normalized ~* '\m(pg_catalog|information_schema|auth|storage|realtime|supabase_functions|cron|net)\M' THEN
    RAISE EXCEPTION 'No se puede acceder a schemas del sistema.';
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s LIMIT 500) t',
    query_text
  ) INTO result;

  RETURN COALESCE(result, '[]'::JSONB);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '%', SQLERRM;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_caja_mov_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar movimientos de caja anteriores.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$


CREATE OR REPLACE FUNCTION public.trg_caja_ses_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.abierta_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar sesiones de caja anteriores.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$


CREATE OR REPLACE FUNCTION public.trg_fn_set_recepcion_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero = 0 THEN
    NEW.numero := COALESCE(
      (SELECT MAX(numero) FROM recepciones WHERE tenant_id = NEW.tenant_id),
      0
    ) + 1;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.trg_gastos_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.fecha <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — usá una nota de corrección en lugar de editar/eliminar gastos viejos.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.fecha IS NOT NULL THEN
    IF v_cierre IS NOT NULL AND NEW.fecha <= v_cierre THEN
      RAISE EXCEPTION 'No podés asignar a este gasto una fecha dentro de un periodo cerrado (% o anterior).', v_cierre USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$


CREATE OR REPLACE FUNCTION public.trg_oc_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar órdenes de compra anteriores.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$


CREATE OR REPLACE FUNCTION public.trg_ventas_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar ventas anteriores.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$


CREATE OR REPLACE FUNCTION public.trigger_recalcular_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalcular_stock(OLD.producto_id);
    RETURN OLD;
  ELSE
    PERFORM recalcular_stock(NEW.producto_id);
    -- Si el producto_id cambió (caso borde), recalcular el anterior también
    IF TG_OP = 'UPDATE' AND OLD.producto_id IS DISTINCT FROM NEW.producto_id THEN
      PERFORM recalcular_stock(OLD.producto_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.ultimo_cierre_hasta(p_tenant_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (date_trunc('month', MAX(periodo)) + INTERVAL '1 month - 1 day')::DATE
  FROM cierres_contables
  WHERE tenant_id = p_tenant_id
$function$


CREATE OR REPLACE FUNCTION public.update_empleados_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_envio_by_token(p_token text, p_estado text, p_pod_fecha date DEFAULT NULL::date, p_pod_receptor text DEFAULT NULL::text, p_pod_notas text DEFAULT NULL::text, p_pod_dni text DEFAULT NULL::text, p_pod_firma_url text DEFAULT NULL::text, p_pod_lat numeric DEFAULT NULL::numeric, p_pod_lon numeric DEFAULT NULL::numeric, p_pod_geo_estado text DEFAULT NULL::text, p_subestado text DEFAULT NULL::text, p_no_entrega_motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_otp_ok BOOLEAN; v_umbral NUMERIC; v_total NUMERIC;
  v_propio BOOLEAN; v_max INT; v_intentos INT;
BEGIN
  SELECT e.pod_otp_verificado, COALESCE(t.pod_otp_umbral,0), COALESCE(e.costo_cotizado,0),
         (e.courier = 'Envío propio'), COALESCE(t.envio_reintentos_max,3), COALESCE(e.intentos,0)
    INTO v_otp_ok, v_umbral, v_total, v_propio, v_max, v_intentos
  FROM envios e JOIN tenants t ON t.id = e.tenant_id
  WHERE e.token_transportista = p_token;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF p_subestado IS NOT NULL AND p_subestado <> '' THEN
    IF p_subestado = 'ausente' AND (v_intentos + 1) < v_max THEN
      UPDATE envios SET estado='en_camino', intentos = intentos + 1,
        subestado_no_entrega = p_subestado,
        no_entrega_motivo = COALESCE(NULLIF(p_no_entrega_motivo,''), no_entrega_motivo),
        updated_at = NOW()
      WHERE token_transportista = p_token AND estado NOT IN ('entregado','cancelado');
    ELSE
      UPDATE envios SET estado='devolucion', intentos = intentos + 1,
        subestado_no_entrega = p_subestado,
        no_entrega_motivo = COALESCE(NULLIF(p_no_entrega_motivo,''), no_entrega_motivo),
        updated_at = NOW()
      WHERE token_transportista = p_token AND estado NOT IN ('entregado','cancelado');
    END IF;
    RETURN FOUND;
  END IF;

  IF p_estado = 'entregado' AND v_propio AND v_umbral > 0 AND v_total >= v_umbral AND NOT COALESCE(v_otp_ok,false) THEN
    RETURN FALSE;
  END IF;

  UPDATE envios SET
    estado         = p_estado,
    pod_fecha      = COALESCE(p_pod_fecha, pod_fecha),
    pod_receptor   = COALESCE(NULLIF(p_pod_receptor,''), pod_receptor),
    pod_notas      = COALESCE(NULLIF(p_pod_notas,''), pod_notas),
    pod_dni        = COALESCE(NULLIF(p_pod_dni,''), pod_dni),
    pod_firma_url  = COALESCE(NULLIF(p_pod_firma_url,''), pod_firma_url),
    pod_lat        = COALESCE(p_pod_lat, pod_lat),
    pod_lon        = COALESCE(p_pod_lon, pod_lon),
    pod_geo_estado = COALESCE(NULLIF(p_pod_geo_estado,''), pod_geo_estado),
    updated_at     = NOW()
  WHERE token_transportista = p_token AND estado NOT IN ('entregado','cancelado');
  RETURN FOUND;
END;$function$


CREATE OR REPLACE FUNCTION public.update_metodos_pago_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$


CREATE OR REPLACE FUNCTION public.update_rrhh_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_user_avatar(p_avatar_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE users SET avatar_url = p_avatar_url WHERE id = auth.uid();
END;
$function$


CREATE OR REPLACE FUNCTION public.verificar_clave_maestra(p_tenant_id uuid, p_clave text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave_real TEXT;
BEGIN
  SELECT clave_maestra INTO v_clave_real FROM public.tenants WHERE id = p_tenant_id;
  IF v_clave_real IS NULL OR LENGTH(TRIM(v_clave_real)) = 0 THEN
    RETURN TRUE;
  END IF;
  IF p_clave IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_clave_real NOT LIKE '$2%' THEN
    RETURN v_clave_real = p_clave;
  END IF;
  RETURN v_clave_real = extensions.crypt(p_clave, v_clave_real);
END $function$


CREATE OR REPLACE FUNCTION public.verificar_otp_envio(p_token text, p_codigo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ok BOOLEAN; BEGIN
  SELECT EXISTS(
    SELECT 1 FROM envio_otp o JOIN envios e ON e.id = o.envio_id
    WHERE e.token_transportista = p_token AND o.codigo = p_codigo
      AND o.verificado_at IS NULL AND o.enviado_at > NOW() - INTERVAL '24 hours'
  ) INTO v_ok;
  IF v_ok THEN
    UPDATE envio_otp o SET verificado_at = NOW()
      FROM envios e
      WHERE e.id = o.envio_id AND e.token_transportista = p_token
        AND o.codigo = p_codigo AND o.verificado_at IS NULL;
    UPDATE envios SET pod_otp_verificado = true WHERE token_transportista = p_token;
  END IF;
  RETURN v_ok;
END;$function$



-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER trg_updated_at_aut_inv BEFORE UPDATE ON public.autorizaciones_inventario FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_caja_mov_cierre BEFORE DELETE OR UPDATE ON public.caja_movimientos FOR EACH ROW EXECUTE FUNCTION trg_caja_mov_periodo_cerrado();
CREATE TRIGGER trg_caja_ses_cierre BEFORE DELETE OR UPDATE ON public.caja_sesiones FOR EACH ROW EXECUTE FUNCTION trg_caja_ses_periodo_cerrado();
CREATE TRIGGER trg_set_caja_sesion_numero BEFORE INSERT ON public.caja_sesiones FOR EACH ROW EXECUTE FUNCTION fn_set_caja_sesion_numero();
CREATE TRIGGER trg_set_cheque_numero BEFORE INSERT ON public.cheques FOR EACH ROW EXECUTE FUNCTION set_cheque_numero();
CREATE TRIGGER trg_set_devprov_numero BEFORE INSERT ON public.devoluciones_proveedor FOR EACH ROW EXECUTE FUNCTION set_devprov_numero();
CREATE TRIGGER trg_enforce_cuits BEFORE INSERT OR UPDATE OF activo, es_default ON public.emisores_fiscales FOR EACH ROW EXECUTE FUNCTION fn_enforce_limite_cuits();
CREATE TRIGGER empleados_update_timestamp BEFORE UPDATE ON public.empleados FOR EACH ROW EXECUTE FUNCTION update_empleados_timestamp();
CREATE TRIGGER trg_envios_updated_at BEFORE UPDATE ON public.envios FOR EACH ROW EXECUTE FUNCTION fn_envios_updated_at();
CREATE TRIGGER trg_set_envio_numero BEFORE INSERT ON public.envios FOR EACH ROW EXECUTE FUNCTION set_envio_numero();
CREATE TRIGGER trg_gastos_cierre BEFORE DELETE OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION trg_gastos_periodo_cerrado();
CREATE TRIGGER trg_gastos_iva_guard BEFORE INSERT OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION fn_gastos_iva_guard();
CREATE TRIGGER trg_updated_at_job_queue BEFORE UPDATE ON public.integration_job_queue FOR EACH ROW EXECUTE FUNCTION fn_updated_at_job_queue();
CREATE TRIGGER trg_updated_at_conteo BEFORE UPDATE ON public.inventario_conteos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER lineas_lpn_trigger BEFORE INSERT ON public.inventario_lineas FOR EACH ROW EXECUTE FUNCTION generate_lpn();
CREATE TRIGGER lineas_recalcular_stock AFTER INSERT OR DELETE OR UPDATE OF cantidad, activo, producto_id ON public.inventario_lineas FOR EACH ROW EXECUTE FUNCTION trigger_recalcular_stock();
CREATE TRIGGER lineas_updated_at BEFORE UPDATE ON public.inventario_lineas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_meli_stock_sync AFTER INSERT OR DELETE OR UPDATE ON public.inventario_lineas FOR EACH ROW EXECUTE FUNCTION fn_enqueue_meli_stock_sync();
CREATE TRIGGER trg_tn_stock_sync AFTER INSERT OR DELETE OR UPDATE OF cantidad, cantidad_reservada, activo ON public.inventario_lineas FOR EACH ROW EXECUTE FUNCTION fn_enqueue_tn_stock_sync();
CREATE TRIGGER series_recalcular_stock AFTER INSERT OR DELETE OR UPDATE ON public.inventario_series FOR EACH ROW EXECUTE FUNCTION trigger_recalcular_stock();
CREATE TRIGGER trg_updated_at_meli_cred BEFORE UPDATE ON public.meli_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_updated_at_mp_creds BEFORE UPDATE ON public.mercadopago_credentials FOR EACH ROW EXECUTE FUNCTION fn_updated_at_mp_creds();
CREATE TRIGGER trg_metodos_pago_updated_at BEFORE UPDATE ON public.metodos_pago FOR EACH ROW EXECUTE FUNCTION update_metodos_pago_updated_at();
CREATE TRIGGER trg_oc_cierre BEFORE DELETE OR UPDATE ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION trg_oc_periodo_cerrado();
CREATE TRIGGER trg_set_oc_numero BEFORE INSERT ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION set_oc_numero();
CREATE TRIGGER trg_updated_at_oc BEFORE UPDATE ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION set_updated_at_oc();
CREATE TRIGGER tr_producto_estructuras_updated_at BEFORE UPDATE ON public.producto_estructuras FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER productos_stock_auto_resolver AFTER UPDATE OF stock_actual ON public.productos FOR EACH ROW EXECUTE FUNCTION auto_resolver_alerta_stock();
CREATE TRIGGER productos_stock_check AFTER UPDATE OF stock_actual ON public.productos FOR EACH ROW EXECUTE FUNCTION check_stock_minimo();
CREATE TRIGGER productos_updated_at BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_enforce_sku BEFORE INSERT OR UPDATE OF activo ON public.productos FOR EACH ROW EXECUTE FUNCTION fn_enforce_limite('sku');
CREATE TRIGGER trg_set_recepcion_numero BEFORE INSERT ON public.recepciones FOR EACH ROW EXECUTE FUNCTION trg_fn_set_recepcion_numero();
CREATE TRIGGER trg_updated_at_recepcion BEFORE UPDATE ON public.recepciones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_recursos_updated_at BEFORE UPDATE ON public.recursos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_asistencia_updated_at BEFORE UPDATE ON public.rrhh_asistencia FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_conceptos_updated_at BEFORE UPDATE ON public.rrhh_conceptos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER rrhh_departamentos_update_timestamp BEFORE UPDATE ON public.rrhh_departamentos FOR EACH ROW EXECUTE FUNCTION update_rrhh_timestamp();
CREATE TRIGGER rrhh_puestos_update_timestamp BEFORE UPDATE ON public.rrhh_puestos FOR EACH ROW EXECUTE FUNCTION update_rrhh_timestamp();
CREATE TRIGGER trg_recalcular_salario AFTER INSERT OR DELETE OR UPDATE ON public.rrhh_salario_items FOR EACH ROW EXECUTE FUNCTION fn_recalcular_salario();
CREATE TRIGGER trg_salarios_updated_at BEFORE UPDATE ON public.rrhh_salarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_vac_sal_updated_at BEFORE UPDATE ON public.rrhh_vacaciones_saldo FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_vac_sol_updated_at BEFORE UPDATE ON public.rrhh_vacaciones_solicitud FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_enforce_sucursales BEFORE INSERT OR UPDATE OF activo ON public.sucursales FOR EACH ROW EXECUTE FUNCTION fn_enforce_limite('sucursales');
CREATE TRIGGER tr_tenant_certificates_updated_at BEFORE UPDATE ON public.tenant_certificates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_crear_caja_fuerte AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION fn_crear_caja_fuerte();
CREATE TRIGGER trg_guard_subscription_status_active BEFORE UPDATE ON public.tenants FOR EACH ROW WHEN ((new.subscription_status IS DISTINCT FROM old.subscription_status)) EXECUTE FUNCTION guard_subscription_status_active();
CREATE TRIGGER trg_seed_canales_venta_new_tenant AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION fn_seed_canales_venta_new_tenant();
CREATE TRIGGER trg_seed_categorias_gasto_new_tenant AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION fn_seed_categorias_gasto_new_tenant();
CREATE TRIGGER trg_seed_tenant_defaults AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION fn_seed_tenant_defaults();
CREATE TRIGGER trg_set_primera_compra BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION fn_set_primera_compra();
CREATE TRIGGER trg_sync_emisor_fiscal_default AFTER INSERT OR UPDATE OF cuit, razon_social_fiscal, condicion_iva_emisor, domicilio_fiscal, ingresos_brutos, inicio_actividades, umbral_factura_b, afip_produccion, afip_provider, afipsdk_token, banco, cbu, alias_cbu, leyenda_comprobante, logo_url ON public.tenants FOR EACH ROW EXECUTE FUNCTION fn_sync_emisor_fiscal_default();
CREATE TRIGGER trg_updated_at_tn_creds BEFORE UPDATE ON public.tiendanube_credentials FOR EACH ROW EXECUTE FUNCTION fn_updated_at_tn_creds();
CREATE TRIGGER trg_set_traslado_numero BEFORE INSERT ON public.traslados FOR EACH ROW EXECUTE FUNCTION set_traslado_numero();
CREATE TRIGGER trg_enforce_usuarios BEFORE INSERT OR UPDATE OF activo ON public.users FOR EACH ROW EXECUTE FUNCTION fn_enforce_limite('usuarios');
CREATE TRIGGER trg_guard_rol_admin BEFORE INSERT OR UPDATE OF rol ON public.users FOR EACH ROW EXECUTE FUNCTION fn_guard_rol_admin();
CREATE TRIGGER set_venta_numero BEFORE INSERT ON public.ventas FOR EACH ROW EXECUTE FUNCTION gen_venta_numero();
CREATE TRIGGER trg_ventas_cc_guard BEFORE INSERT ON public.ventas FOR EACH ROW EXECUTE FUNCTION fn_ventas_cc_guard();
CREATE TRIGGER trg_ventas_cierre BEFORE DELETE OR UPDATE ON public.ventas FOR EACH ROW EXECUTE FUNCTION trg_ventas_periodo_cerrado();
CREATE TRIGGER trg_ventas_writeoff_rol_guard BEFORE UPDATE ON public.ventas FOR EACH ROW EXECUTE FUNCTION fn_ventas_writeoff_rol_guard();
CREATE TRIGGER ventas_updated_at BEFORE UPDATE ON public.ventas FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.actividad_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_batch_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afip_wsaa_ta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aging_profile_reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aging_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archivos_biblioteca ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atributos_variante_valores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autorizaciones_cc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autorizaciones_gasto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autorizaciones_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_cancelaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_manual_pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boveda_arqueos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boveda_retiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_arqueos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_traspasos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canales_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias_gasto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cierres_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_creditos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_domicilios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigo_perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_credenciales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_factura_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas_origen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devolucion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devolucion_proveedor_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devoluciones_proveedor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emisores_fiscales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envio_incidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envio_otp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envio_pod_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gasto_cuotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos_fijos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupo_estado_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_estados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hoja_ruta_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hojas_ruta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_conteo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_conteos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_meli_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_tn_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_recetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitting_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meli_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mercadopago_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metodos_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modo_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motivos_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_billing_alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orden_compra_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordenes_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_billers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_facturas_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_estructuras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_precios_mayorista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_stock_minimo_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_ubicacion_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_cc_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_contactos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_cuentas_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_venta_afip ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recepcion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recepciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recursos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repartidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retenciones_sufridas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles_custom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_anticipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_asistencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_capacitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_conceptos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_documentos_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_evaluaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_feriados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_fichadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_horas_extra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_liquidaciones_finales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_puestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_salario_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_salarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_tipos_contrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_vacaciones_saldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_vacaciones_solicitud ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicio_presupuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiendanube_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traslado_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traslados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ubicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades_medida ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_item_despachos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_externas_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_recurrentes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLICIES (RLS)
-- ============================================================
CREATE POLICY actividad_log_insert ON public.actividad_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY actividad_log_select ON public.actividad_log AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR (tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'SUPERVISOR'::text])))))));
CREATE POLICY addon_batch_select ON public.addon_batch_changes AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id = get_user_tenant_id()) OR is_admin()));
CREATE POLICY aging_profile_reglas_tenant ON public.aging_profile_reglas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY aging_profiles_tenant ON public.aging_profiles AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY alertas_tenant ON public.alertas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id = get_user_tenant_id()));
CREATE POLICY api_keys_owner_manage ON public.api_keys AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['OWNER'::text, 'ADMIN'::text]))))));
CREATE POLICY api_keys_tenant ON public.api_keys AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY archivos_biblioteca_tenant ON public.archivos_biblioteca AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY atributos_variante_valores_tenant ON public.atributos_variante_valores AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY autoriz_cc_tenant ON public.autorizaciones_cc AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY autoriz_gasto_tenant ON public.autorizaciones_gasto AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY aut_inv_tenant ON public.autorizaciones_inventario AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY billing_manual_pagos_select ON public.billing_manual_pagos AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id = get_user_tenant_id()) OR is_admin()));
CREATE POLICY boveda_arqueos_solo_dueno ON public.boveda_arqueos AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))))
  WITH CHECK (((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))));
CREATE POLICY boveda_retiros_solo_dueno ON public.boveda_retiros AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))))
  WITH CHECK (((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))));
CREATE POLICY tenant_caja_arqueos ON public.caja_arqueos AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sesion_id IS NULL) OR (EXISTS ( SELECT 1
   FROM caja_sesiones s
  WHERE ((s.id = caja_arqueos.sesion_id) AND ((s.sucursal_id IS NULL) OR (s.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY mov_caja_tenant ON public.caja_movimientos AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sesion_id IS NULL) OR (EXISTS ( SELECT 1
   FROM caja_sesiones s
  WHERE ((s.id = caja_movimientos.sesion_id) AND ((s.sucursal_id IS NULL) OR (s.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY sesiones_tenant ON public.caja_sesiones AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY traspasos_tenant ON public.caja_traspasos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY cajas_tenant ON public.cajas AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY canales_venta_tenant ON public.canales_venta AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY categorias_insert ON public.categorias AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY categorias_tenant ON public.categorias AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id = get_user_tenant_id()));
CREATE POLICY categorias_gasto_tenant ON public.categorias_gasto AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY cheques_tenant ON public.cheques AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY cierres_tenant ON public.cierres_contables AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY cliente_creditos_tenant ON public.cliente_creditos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY cli_dom_tenant ON public.cliente_domicilios AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY cli_notas_tenant ON public.cliente_notas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY clientes_tenant ON public.clientes AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY codigo_perfiles_tenant ON public.codigo_perfiles AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY combo_items_tenant ON public.combo_items AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY tenant_isolation ON public.combos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY courier_credenciales_tenant ON public.courier_credenciales AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY courier_factura_lineas_tenant ON public.courier_factura_lineas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY courier_facturas_tenant ON public.courier_facturas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY courier_tarifas_tenant ON public.courier_tarifas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY cuentas_origen_tenant ON public.cuentas_origen AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY devitem_tenant_insert ON public.devolucion_items AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((devolucion_id IN ( SELECT devoluciones.id
   FROM devoluciones
  WHERE (devoluciones.tenant_id IN ( SELECT users.tenant_id
           FROM users
          WHERE (users.id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY devitem_tenant_select ON public.devolucion_items AS PERMISSIVE FOR SELECT TO public
  USING ((devolucion_id IN ( SELECT devoluciones.id
   FROM devoluciones
  WHERE (devoluciones.tenant_id IN ( SELECT users.tenant_id
           FROM users
          WHERE (users.id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY devprov_items_tenant ON public.devolucion_proveedor_items AS PERMISSIVE FOR ALL TO public
  USING ((devolucion_id IN ( SELECT devoluciones_proveedor.id
   FROM devoluciones_proveedor
  WHERE (devoluciones_proveedor.tenant_id IN ( SELECT users.tenant_id
           FROM users
          WHERE (users.id = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((devolucion_id IN ( SELECT devoluciones_proveedor.id
   FROM devoluciones_proveedor
  WHERE (devoluciones_proveedor.tenant_id IN ( SELECT users.tenant_id
           FROM users
          WHERE (users.id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY dev_tenant_insert ON public.devoluciones AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY dev_tenant_select ON public.devoluciones AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (venta_id IS NULL) OR (EXISTS ( SELECT 1
   FROM ventas v
  WHERE ((v.id = devoluciones.venta_id) AND ((v.sucursal_id IS NULL) OR (v.sucursal_id = auth_user_sucursal()))))))));
CREATE POLICY devprov_tenant ON public.devoluciones_proveedor AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY emisores_fiscales_tenant ON public.emisores_fiscales AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY empleados_supervisor ON public.empleados AS PERMISSIVE FOR SELECT TO public
  USING ((supervisor_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY empleados_tenant ON public.empleados AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY envio_incidencias_tenant ON public.envio_incidencias AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY envio_items_tenant ON public.envio_items AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (envio_id IS NULL) OR (EXISTS ( SELECT 1
   FROM envios e
  WHERE ((e.id = envio_items.envio_id) AND ((e.sucursal_id IS NULL) OR (e.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY envio_otp_tenant ON public.envio_otp AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY envio_pod_fotos_tenant ON public.envio_pod_fotos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY envios_tenant ON public.envios AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY estados_tenant ON public.estados_inventario AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY gasto_cuotas_tenant ON public.gasto_cuotas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY gastos_tenant ON public.gastos AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY gastos_fijos_tenant ON public.gastos_fijos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY grupo_items_tenant ON public.grupo_estado_items AS PERMISSIVE FOR ALL TO public
  USING ((grupo_id IN ( SELECT grupos_estados.id
   FROM grupos_estados
  WHERE (grupos_estados.tenant_id IN ( SELECT users.tenant_id
           FROM users
          WHERE (users.id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY grupos_tenant ON public.grupos_estados AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY hoja_ruta_envios_tenant ON public.hoja_ruta_envios AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY hojas_ruta_tenant ON public.hojas_ruta AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY job_queue_tenant ON public.integration_job_queue AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY conteo_items_tenant ON public.inventario_conteo_items AS PERMISSIVE FOR ALL TO public
  USING ((conteo_id IN ( SELECT c.id
   FROM inventario_conteos c
  WHERE ((c.tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (c.sucursal_id IS NULL) OR (c.sucursal_id = auth_user_sucursal()))))))
  WITH CHECK ((conteo_id IN ( SELECT c.id
   FROM inventario_conteos c
  WHERE (c.tenant_id = get_user_tenant_id()))));
CREATE POLICY conteos_tenant ON public.inventario_conteos AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY lineas_tenant ON public.inventario_lineas AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY meli_map_tenant ON public.inventario_meli_map AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY series_tenant ON public.inventario_series AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (linea_id IS NULL) OR (EXISTS ( SELECT 1
   FROM inventario_lineas l
  WHERE ((l.id = inventario_series.linea_id) AND ((l.sucursal_id IS NULL) OR (l.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY tn_map_tenant ON public.inventario_tn_map AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY kit_recetas_tenant ON public.kit_recetas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY kitting_log_tenant ON public.kitting_log AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY meli_cred_tenant ON public.meli_credentials AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY mp_creds_tenant ON public.mercadopago_credentials AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY metodos_pago_tenant ON public.metodos_pago AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY tenant_isolation ON public.modo_credentials AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY motivos_tenant ON public.motivos_movimiento AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY movimientos_insert ON public.movimientos_stock AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY movimientos_select ON public.movimientos_stock AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))));
CREATE POLICY notif_delete ON public.notificaciones AS PERMISSIVE FOR DELETE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY notif_insert ON public.notificaciones AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY notif_select ON public.notificaciones AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY notif_update ON public.notificaciones AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY oc_items_tenant ON public.orden_compra_items AS PERMISSIVE FOR ALL TO public
  USING ((orden_compra_id IN ( SELECT o.id
   FROM ordenes_compra o
  WHERE ((o.tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (o.sucursal_id IS NULL) OR (o.sucursal_id = auth_user_sucursal()))))))
  WITH CHECK ((orden_compra_id IN ( SELECT o.id
   FROM ordenes_compra o
  WHERE (o.tenant_id = get_user_tenant_id()))));
CREATE POLICY oc_tenant ON public.ordenes_compra AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY planes_select_public ON public.planes AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY pe_tenant_delete ON public.producto_estructuras AS PERMISSIVE FOR DELETE TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY pe_tenant_insert ON public.producto_estructuras AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY pe_tenant_select ON public.producto_estructuras AS PERMISSIVE FOR SELECT TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY pe_tenant_update ON public.producto_estructuras AS PERMISSIVE FOR UPDATE TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY tenant_isolation ON public.producto_grupos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY ppm_tenant ON public.producto_precios_mayorista AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY psmss_tenant ON public.producto_stock_minimo_sucursal AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY tenant_isolation ON public.producto_ubicacion_sucursal AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY productos_delete_tenant ON public.productos AS PERMISSIVE FOR DELETE TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY productos_insert_tenant ON public.productos AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY productos_select ON public.productos AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) OR is_admin()));
CREATE POLICY productos_update_tenant ON public.productos AS PERMISSIVE FOR UPDATE TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY pcc_tenant ON public.proveedor_cc_movimientos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY tenant_isolation ON public.proveedor_contactos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY prov_cuentas_tenant ON public.proveedor_cuentas_bancarias AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY pp_tenant ON public.proveedor_productos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY proveedores_insert ON public.proveedores AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY proveedores_tenant ON public.proveedores AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id = get_user_tenant_id()));
CREATE POLICY pv_tenant ON public.puntos_venta_afip AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY recepcion_items_tenant ON public.recepcion_items AS PERMISSIVE FOR ALL TO public
  USING ((recepcion_id IN ( SELECT r.id
   FROM recepciones r
  WHERE ((r.tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (r.sucursal_id IS NULL) OR (r.sucursal_id = auth_user_sucursal()))))))
  WITH CHECK ((recepcion_id IN ( SELECT r.id
   FROM recepciones r
  WHERE (r.tenant_id = get_user_tenant_id()))));
CREATE POLICY recepciones_tenant ON public.recepciones AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY recursos_tenant ON public.recursos AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY repartidores_tenant ON public.repartidores AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY ret_tenant ON public.retenciones_sufridas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY roles_custom_tenant ON public.roles_custom AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_anticipos_tenant ON public.rrhh_anticipos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_asistencia_supervisor ON public.rrhh_asistencia AS PERMISSIVE FOR ALL TO public
  USING ((empleado_id IN ( SELECT get_supervisor_team_ids() AS get_supervisor_team_ids)))
  WITH CHECK ((empleado_id IN ( SELECT get_supervisor_team_ids() AS get_supervisor_team_ids)));
CREATE POLICY rrhh_asistencia_tenant ON public.rrhh_asistencia AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_capacitaciones_tenant ON public.rrhh_capacitaciones AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_conceptos_tenant ON public.rrhh_conceptos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_departamentos_tenant ON public.rrhh_departamentos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_documentos_tenant ON public.rrhh_documentos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_doc_catalogo_tenant ON public.rrhh_documentos_catalogo AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_evaluaciones_tenant ON public.rrhh_evaluaciones AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY feriados_tenant ON public.rrhh_feriados AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_fichadas_tenant ON public.rrhh_fichadas AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_horas_extra_tenant ON public.rrhh_horas_extra AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_liq_finales_tenant ON public.rrhh_liquidaciones_finales AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_puestos_tenant ON public.rrhh_puestos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_salario_items_tenant ON public.rrhh_salario_items AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_salarios_tenant ON public.rrhh_salarios AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_tipos_contrato_tenant ON public.rrhh_tipos_contrato AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_vac_sal_tenant ON public.rrhh_vacaciones_saldo AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_vacsaldo_supervisor ON public.rrhh_vacaciones_saldo AS PERMISSIVE FOR ALL TO public
  USING ((empleado_id IN ( SELECT get_supervisor_team_ids() AS get_supervisor_team_ids)))
  WITH CHECK ((empleado_id IN ( SELECT get_supervisor_team_ids() AS get_supervisor_team_ids)));
CREATE POLICY rrhh_vac_sol_tenant ON public.rrhh_vacaciones_solicitud AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY rrhh_vac_supervisor ON public.rrhh_vacaciones_solicitud AS PERMISSIVE FOR ALL TO public
  USING ((empleado_id IN ( SELECT get_supervisor_team_ids() AS get_supervisor_team_ids)))
  WITH CHECK ((empleado_id IN ( SELECT get_supervisor_team_ids() AS get_supervisor_team_ids)));
CREATE POLICY si_tenant ON public.servicio_items AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY sp_tenant ON public.servicio_presupuestos AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY tenant_sucursales ON public.sucursales AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY support_agents_self_read ON public.support_agents AS PERMISSIVE FOR SELECT TO public
  USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY tenant_addons_select ON public.tenant_addons AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id = get_user_tenant_id()) OR is_admin()));
CREATE POLICY tenant_certificates_tenant ON public.tenant_certificates AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY tenants_insert_new_user ON public.tenants AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));
CREATE POLICY tenants_select ON public.tenants AS PERMISSIVE FOR SELECT TO public
  USING (((id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) OR is_admin()));
CREATE POLICY tenants_update ON public.tenants AS PERMISSIVE FOR UPDATE TO public
  USING ((((id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text])))))) OR is_admin()));
CREATE POLICY tn_creds_tenant ON public.tiendanube_credentials AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY traslado_items_tenant ON public.traslado_items AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY traslados_tenant ON public.traslados AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY ubicaciones_insert ON public.ubicaciones AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY ubicaciones_tenant ON public.ubicaciones AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id = get_user_tenant_id()));
CREATE POLICY tenant_isolation ON public.unidades_medida AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY users_delete_owner ON public.users AS PERMISSIVE FOR DELETE TO public
  USING (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text]))));
CREATE POLICY users_delete_self ON public.users AS PERMISSIVE FOR DELETE TO public
  USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY users_insert_owner ON public.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text]))));
CREATE POLICY users_insert_self ON public.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY users_select ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id = get_user_tenant_id()) OR is_admin()));
CREATE POLICY users_update_owner ON public.users AS PERMISSIVE FOR UPDATE TO public
  USING (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text]))));
CREATE POLICY venta_auditoria_tenant ON public.venta_auditoria AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (venta_id IS NULL) OR (EXISTS ( SELECT 1
   FROM ventas v
  WHERE ((v.id = venta_auditoria.venta_id) AND ((v.sucursal_id IS NULL) OR (v.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY venta_item_despachos_tenant ON public.venta_item_despachos AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (venta_id IS NULL) OR (EXISTS ( SELECT 1
   FROM ventas v
  WHERE ((v.id = venta_item_despachos.venta_id) AND ((v.sucursal_id IS NULL) OR (v.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY venta_items_tenant ON public.venta_items AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (venta_id IS NULL) OR (EXISTS ( SELECT 1
   FROM ventas v
  WHERE ((v.id = venta_items.venta_id) AND ((v.sucursal_id IS NULL) OR (v.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY venta_series_tenant ON public.venta_series AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (venta_id IS NULL) OR (EXISTS ( SELECT 1
   FROM ventas v
  WHERE ((v.id = venta_series.venta_id) AND ((v.sucursal_id IS NULL) OR (v.sucursal_id = auth_user_sucursal()))))))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY ventas_tenant ON public.ventas AS PERMISSIVE FOR ALL TO public
  USING (((tenant_id = get_user_tenant_id()) AND (auth_ve_todas_sucursales() OR (sucursal_id IS NULL) OR (sucursal_id = auth_user_sucursal()))))
  WITH CHECK ((tenant_id = get_user_tenant_id()));
CREATE POLICY ventas_externas_tenant ON public.ventas_externas_logs AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY ventas_rec_tenant ON public.ventas_recurrentes AS PERMISSIVE FOR ALL TO public
  USING ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((tenant_id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))));

-- ============================================================
-- GRANTS (tablas)
-- ============================================================
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.actividad_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.actividad_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.actividad_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.addon_batch_changes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.addon_batch_changes TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.admin_audit_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.admin_audit_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.admin_audit_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.afip_wsaa_ta TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.aging_profile_reglas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.aging_profile_reglas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.aging_profile_reglas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.aging_profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.aging_profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.aging_profiles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.alertas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.alertas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.alertas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.api_keys TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.api_keys TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.api_keys TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.archivos_biblioteca TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.archivos_biblioteca TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.archivos_biblioteca TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.atributos_variante_valores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.atributos_variante_valores TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_cc TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_cc TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_cc TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_gasto TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_gasto TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_gasto TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_inventario TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_inventario TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.autorizaciones_inventario TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.billing_cancelaciones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.billing_manual_pagos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.billing_manual_pagos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.boveda_arqueos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.boveda_arqueos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.boveda_arqueos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.boveda_retiros TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.boveda_retiros TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.boveda_retiros TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_arqueos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_arqueos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_arqueos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_movimientos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_movimientos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_movimientos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_sesiones TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_sesiones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_sesiones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_traspasos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_traspasos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.caja_traspasos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cajas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cajas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cajas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.canales_venta TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.canales_venta TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.canales_venta TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categorias TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categorias TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categorias TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categorias_gasto TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categorias_gasto TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categorias_gasto TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cheques TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cheques TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cheques TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cierres_contables TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cierres_contables TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cierres_contables TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_creditos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_creditos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_creditos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_domicilios TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_domicilios TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_domicilios TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_notas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_notas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cliente_notas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.clientes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.clientes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.clientes TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.codigo_perfiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.codigo_perfiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.codigo_perfiles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.combo_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.combo_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.combo_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.combos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.combos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.combos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_credenciales TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_credenciales TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_credenciales TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_factura_lineas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_factura_lineas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_factura_lineas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_facturas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_facturas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_facturas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_tarifas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_tarifas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.courier_tarifas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cuentas_origen TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cuentas_origen TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cuentas_origen TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devolucion_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devolucion_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devolucion_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devolucion_proveedor_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devolucion_proveedor_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devolucion_proveedor_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devoluciones TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devoluciones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devoluciones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devoluciones_proveedor TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devoluciones_proveedor TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.devoluciones_proveedor TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.emisores_fiscales TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.emisores_fiscales TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.empleados TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.empleados TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.empleados TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_incidencias TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_incidencias TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_incidencias TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_otp TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_otp TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_otp TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_pod_fotos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_pod_fotos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envio_pod_fotos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envios TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envios TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.envios TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.estados_inventario TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.estados_inventario TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.estados_inventario TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gasto_cuotas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gasto_cuotas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gasto_cuotas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gastos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gastos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gastos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gastos_fijos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gastos_fijos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.gastos_fijos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.grupo_estado_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.grupo_estado_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.grupo_estado_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.grupos_estados TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.grupos_estados TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.grupos_estados TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.hoja_ruta_envios TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.hoja_ruta_envios TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.hoja_ruta_envios TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.hojas_ruta TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.hojas_ruta TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.hojas_ruta TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.integration_job_queue TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.integration_job_queue TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.integration_job_queue TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_conteo_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_conteo_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_conteo_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_conteos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_conteos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_conteos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_lineas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_lineas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_lineas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_meli_map TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_meli_map TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_meli_map TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_series TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_series TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_series TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_tn_map TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_tn_map TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventario_tn_map TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kit_recetas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kit_recetas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kit_recetas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kitting_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kitting_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kitting_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leads TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leads TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leads TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.meli_credentials TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.meli_credentials TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.meli_credentials TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.mercadopago_credentials TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.mercadopago_credentials TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.mercadopago_credentials TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.metodos_pago TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.metodos_pago TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.metodos_pago TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.modo_credentials TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.modo_credentials TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.modo_credentials TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.motivos_movimiento TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.motivos_movimiento TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.motivos_movimiento TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.movimientos_stock TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.movimientos_stock TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.movimientos_stock TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.mp_billing_alertas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notificaciones TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notificaciones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notificaciones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orden_compra_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orden_compra_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orden_compra_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ordenes_compra TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ordenes_compra TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ordenes_compra TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.planes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.planes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.planes TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_billers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_facturas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_facturas_claims TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_estructuras TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_estructuras TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_estructuras TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_grupos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_grupos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_grupos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_precios_mayorista TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_precios_mayorista TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_precios_mayorista TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_stock_minimo_sucursal TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_stock_minimo_sucursal TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_stock_minimo_sucursal TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_ubicacion_sucursal TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_ubicacion_sucursal TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.producto_ubicacion_sucursal TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.productos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.productos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.productos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_cc_movimientos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_cc_movimientos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_cc_movimientos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_contactos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_contactos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_contactos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_cuentas_bancarias TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_cuentas_bancarias TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_cuentas_bancarias TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_productos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_productos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedor_productos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedores TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.proveedores TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.puntos_venta_afip TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.puntos_venta_afip TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.puntos_venta_afip TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recepcion_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recepcion_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recepcion_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recepciones TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recepciones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recepciones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recursos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recursos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.recursos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.repartidores TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.repartidores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.repartidores TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.retenciones_sufridas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.retenciones_sufridas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.retenciones_sufridas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.roles_custom TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.roles_custom TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.roles_custom TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_anticipos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_anticipos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_anticipos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_asistencia TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_asistencia TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_asistencia TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_capacitaciones TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_capacitaciones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_capacitaciones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_conceptos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_conceptos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_conceptos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_departamentos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_departamentos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_departamentos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_documentos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_documentos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_documentos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_documentos_catalogo TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_documentos_catalogo TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_documentos_catalogo TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_evaluaciones TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_evaluaciones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_evaluaciones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_feriados TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_feriados TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_feriados TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_fichadas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_fichadas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_fichadas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_horas_extra TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_horas_extra TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_horas_extra TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_liquidaciones_finales TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_liquidaciones_finales TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_liquidaciones_finales TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_puestos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_puestos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_puestos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_salario_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_salario_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_salario_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_salarios TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_salarios TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_salarios TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_tipos_contrato TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_tipos_contrato TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_tipos_contrato TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_vacaciones_saldo TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_vacaciones_saldo TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_vacaciones_saldo TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_vacaciones_solicitud TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_vacaciones_solicitud TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rrhh_vacaciones_solicitud TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.servicio_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.servicio_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.servicio_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.servicio_presupuestos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.servicio_presupuestos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.servicio_presupuestos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_por_producto TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_por_producto TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_por_producto TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sucursales TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sucursales TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sucursales TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_agents TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_agents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_agents TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_messages TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_messages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_messages TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_tickets TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_tickets TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.support_tickets TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_addons TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_addons TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_certificates TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_certificates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_certificates TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenants TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenants TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tiendanube_credentials TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tiendanube_credentials TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tiendanube_credentials TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traslado_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traslado_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traslado_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traslados TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traslados TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traslados TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ubicaciones TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ubicaciones TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ubicaciones TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.unidades_medida TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.unidades_medida TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.unidades_medida TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.users TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.users TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.users TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_auditoria TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_auditoria TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_auditoria TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_item_despachos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_item_despachos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_item_despachos TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_series TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_series TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.venta_series TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas_externas_logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas_externas_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas_externas_logs TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas_recurrentes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas_recurrentes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ventas_recurrentes TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_boveda_cuentas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_boveda_cuentas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_boveda_cuentas TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_caja_mensual_por_sucursal TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_caja_mensual_por_sucursal TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_caja_mensual_por_sucursal TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_caja_resumen_diario TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_caja_resumen_diario TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_caja_resumen_diario TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_diferencias_por_cajero TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_diferencias_por_cajero TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_diferencias_por_cajero TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_egresos_consolidados TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_egresos_consolidados TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vw_egresos_consolidados TO service_role;

-- ============================================================
-- VISTAS
-- ============================================================
CREATE OR REPLACE VIEW public.stock_por_producto AS
 SELECT p.id AS producto_id,
    p.tenant_id,
    p.nombre,
    p.sku,
    COALESCE(sum(l.cantidad), (0)::bigint) AS stock_total,
    count(DISTINCT l.id) AS nro_lineas
   FROM (productos p
     LEFT JOIN inventario_lineas l ON (((l.producto_id = p.id) AND (l.activo = true))))
  WHERE (p.activo = true)
  GROUP BY p.id, p.tenant_id, p.nombre, p.sku;

CREATE OR REPLACE VIEW public.vw_boveda_cuentas AS
 SELECT co.tenant_id,
    co.id AS cuenta_origen_id,
    co.nombre,
    co.tipo,
    co.banco,
    co.moneda,
    co.activo,
    (COALESCE(sum(
        CASE
            WHEN (cm.tipo ~~ 'ingreso%'::text) THEN cm.monto
            WHEN (cm.tipo ~~ 'egreso%'::text) THEN (- cm.monto)
            ELSE (0)::numeric
        END), (0)::numeric))::numeric(14,2) AS saldo,
    count(cm.id) AS movimientos_count,
    max(cm.created_at) AS ultimo_movimiento_at
   FROM (cuentas_origen co
     LEFT JOIN caja_movimientos cm ON (((cm.tenant_id = co.tenant_id) AND (COALESCE(cm.cuenta_origen_id,
        CASE
            WHEN (cm.tipo !~~ '%informativo%'::text) THEN ( SELECT e.id
               FROM cuentas_origen e
              WHERE ((e.tenant_id = cm.tenant_id) AND (e.tipo = 'efectivo'::text))
             LIMIT 1)
            ELSE NULL::uuid
        END) = co.id))))
  GROUP BY co.id, co.tenant_id, co.nombre, co.tipo, co.banco, co.moneda, co.activo;

CREATE OR REPLACE VIEW public.vw_caja_mensual_por_sucursal AS
 SELECT cs.tenant_id,
    (date_trunc('month'::text, cs.abierta_at))::date AS periodo,
    cs.sucursal_id,
    s.nombre AS sucursal_nombre,
    (count(*))::integer AS sesiones_count,
    (count(*) FILTER (WHERE (cs.estado = 'cerrada'::text)))::integer AS sesiones_cerradas,
    (COALESCE(sum(cs.total_ingresos), (0)::numeric))::numeric(14,2) AS total_ingresos,
    (COALESCE(sum(cs.total_egresos), (0)::numeric))::numeric(14,2) AS total_egresos,
    (COALESCE(sum(cs.total_ventas), (0)::numeric))::numeric(14,2) AS total_ventas,
    (COALESCE(sum(cs.diferencia_cierre), (0)::numeric))::numeric(14,2) AS diferencia_total,
    (COALESCE(sum(abs(cs.diferencia_cierre)), (0)::numeric))::numeric(14,2) AS diferencia_absoluta,
    (count(DISTINCT cs.caja_id))::integer AS cajas_activas,
    (count(DISTINCT cs.usuario_id))::integer AS cajeros_distintos
   FROM ((caja_sesiones cs
     LEFT JOIN sucursales s ON ((s.id = cs.sucursal_id)))
     LEFT JOIN cajas c ON ((c.id = cs.caja_id)))
  WHERE (NOT COALESCE(c.es_caja_fuerte, false))
  GROUP BY cs.tenant_id, (date_trunc('month'::text, cs.abierta_at)), cs.sucursal_id, s.nombre;

CREATE OR REPLACE VIEW public.vw_caja_resumen_diario AS
 SELECT cs.tenant_id,
    date(cs.abierta_at) AS fecha,
    cs.sucursal_id,
    s.nombre AS sucursal_nombre,
    cs.caja_id,
    c.nombre AS caja_nombre,
    c.moneda,
    (count(*))::integer AS sesiones_count,
    (count(*) FILTER (WHERE (cs.estado = 'cerrada'::text)))::integer AS sesiones_cerradas,
    (COALESCE(sum(cs.monto_apertura), (0)::numeric))::numeric(14,2) AS total_apertura,
    (COALESCE(sum(cs.total_ingresos), (0)::numeric))::numeric(14,2) AS total_ingresos,
    (COALESCE(sum(cs.total_egresos), (0)::numeric))::numeric(14,2) AS total_egresos,
    (COALESCE(sum(cs.total_ventas), (0)::numeric))::numeric(14,2) AS total_ventas,
    (COALESCE(sum(cs.monto_cierre), (0)::numeric))::numeric(14,2) AS saldo_sistema,
    (COALESCE(sum(cs.monto_real_cierre), (0)::numeric))::numeric(14,2) AS conteo_real,
    (COALESCE(sum(cs.diferencia_cierre), (0)::numeric))::numeric(14,2) AS diferencia_total,
    (COALESCE(sum(abs(cs.diferencia_cierre)), (0)::numeric))::numeric(14,2) AS diferencia_absoluta
   FROM ((caja_sesiones cs
     LEFT JOIN sucursales s ON ((s.id = cs.sucursal_id)))
     LEFT JOIN cajas c ON ((c.id = cs.caja_id)))
  WHERE (NOT COALESCE(c.es_caja_fuerte, false))
  GROUP BY cs.tenant_id, (date(cs.abierta_at)), cs.sucursal_id, s.nombre, cs.caja_id, c.nombre, c.moneda;

CREATE OR REPLACE VIEW public.vw_diferencias_por_cajero AS
 SELECT cs.tenant_id,
    cs.usuario_id,
    u.nombre_display AS cajero,
    count(*) AS cierres_count,
    (sum(
        CASE
            WHEN (cs.diferencia_cierre <> (0)::numeric) THEN 1
            ELSE 0
        END))::integer AS cierres_con_diferencia,
    (COALESCE(sum(cs.diferencia_cierre), (0)::numeric))::numeric(14,2) AS diferencia_neta_acumulada,
    (COALESCE(sum(abs(cs.diferencia_cierre)), (0)::numeric))::numeric(14,2) AS diferencia_absoluta_acumulada,
    (COALESCE(max(abs(cs.diferencia_cierre)), (0)::numeric))::numeric(14,2) AS diferencia_maxima
   FROM (caja_sesiones cs
     LEFT JOIN users u ON ((u.id = cs.usuario_id)))
  WHERE ((cs.estado = 'cerrada'::text) AND (cs.cerrada_at >= (now() - '30 days'::interval)) AND (cs.diferencia_cierre IS NOT NULL))
  GROUP BY cs.tenant_id, cs.usuario_id, u.nombre_display;

CREATE OR REPLACE VIEW public.vw_egresos_consolidados AS
 SELECT g.id,
    'gasto'::text AS fuente,
    g.tenant_id,
    g.fecha,
    g.monto,
    g.descripcion,
    g.categoria,
    g.categoria_id,
    g.sucursal_id,
    g.medio_pago,
    g.usuario_id,
    g.recurso_id,
    NULL::uuid AS empleado_id,
    NULL::date AS periodo,
    g.created_at
   FROM gastos g
UNION ALL
 SELECT s.id,
    'rrhh_salario'::text AS fuente,
    s.tenant_id,
    COALESCE((s.fecha_pago)::date, s.periodo) AS fecha,
    s.neto AS monto,
    ((('Nómina '::text || COALESCE(e.nombre, e.dni_rut, 'empleado'::text)) || ' - '::text) || to_char((s.periodo)::timestamp with time zone, 'MM/YYYY'::text)) AS descripcion,
    'Sueldos (RRHH)'::text AS categoria,
    NULL::uuid AS categoria_id,
    NULL::uuid AS sucursal_id,
    s.medio_pago,
    NULL::uuid AS usuario_id,
    NULL::uuid AS recurso_id,
    s.empleado_id,
    s.periodo,
    s.fecha_pago AS created_at
   FROM (rrhh_salarios s
     LEFT JOIN empleados e ON ((e.id = s.empleado_id)))
  WHERE (s.pagado = true);