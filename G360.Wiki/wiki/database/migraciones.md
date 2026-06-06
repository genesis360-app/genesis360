---
title: Historial de Migraciones
category: database
tags: [migraciones, schema, postgresql, supabase]
sources: [WORKFLOW.md, CLAUDE.md, ROADMAP.md]
updated: 2026-05-27
---

# Historial de Migraciones (001-185)

**Total al 2026-06-05:** 185 archivos de migración + 086b correctivo.  
Convención: `NNN_descripcion_snake_case.sql` · Todas idempotentes con `IF NOT EXISTS`

> [!WARNING] `CREATE POLICY IF NOT EXISTS` no existe en PostgreSQL. Usar: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE ...) THEN CREATE POLICY ...; END IF; END $$`

---

## Migraciones 001-040 (Base, RRHH, WMS)

| # | Archivo | Descripción |
|---|---------|-------------|
| 001 | `001_initial_schema.sql` | Schema inicial completo: tenants, users, productos, inventario_lineas, movimientos_stock, ventas, venta_items, caja, ubicaciones, estados, motivos |
| 002 | `002_cotizacion_y_precio_historico.sql` | Cotización USD/ARS + precio costo histórico por venta |
| 003 | `003_clientes_y_rentabilidad.sql` | Módulo clientes + rentabilidad real |
| 004 | `004_caja_cierre_real.sql` | Caja: conteo real al cierre, diferencia, cerrado_por |
| 005 | `005_combos.sql` | Tabla combos (reglas de precio por volumen) |
| 006 | `006_ventas_numero_trigger.sql` | Trigger auto-número de venta por tenant |
| 007 | `007_precio_moneda.sql` | precio_costo_moneda / precio_venta_moneda en productos |
| 008 | `008_gastos.sql` | Tabla gastos con RLS |
| 009 | `009_actividad_log.sql` | Audit log append-only con RLS |
| 010 | `010_inventario_prioridad.sql` | `prioridad INT` en ubicaciones |
| 011 | `011_reglas_inventario.sql` | `regla_inventario` en tenants (default FIFO) y productos (override por SKU) |
| 012 | `012_ubicacion_disponible_surtido.sql` | `disponible_surtido BOOLEAN` en ubicaciones |
| 013 | `013_aging_profiles.sql` | Tablas aging_profiles + aging_profile_reglas + `process_aging_profiles()` SECURITY DEFINER |
| 014 | `014_rrhh_empleados.sql` | RRHH Phase 1: empleados, puestos, departamentos + `is_rrhh()` |
| 015 | `015_margen_objetivo.sql` | `productos.margen_objetivo DECIMAL(5,2)` nullable |
| 016 | `016_combos_descuento_tipo.sql` | `combos.descuento_tipo` (pct/monto_ars/monto_usd) + `descuento_monto` |
| 017 | `017_rrhh_nomina.sql` | RRHH Phase 2A: rrhh_conceptos + rrhh_salarios + rrhh_salario_items + `pagar_nomina_empleado()` |
| 018 | `018_rrhh_vacaciones.sql` | RRHH Phase 2B: rrhh_vacaciones_solicitud + rrhh_vacaciones_saldo + aprobar/rechazar |
| 019 | `019_rrhh_asistencia.sql` | RRHH Phase 3A: rrhh_asistencia (presente/ausente/tardanza/licencia) |
| 020 | `020_marketplace.sql` | Marketplace: campos en productos + tenants (marketplace_activo, webhook_url) |
| 021 | `021_movimientos_limite.sql` | Revenue: addon_movimientos en tenants (límite movimientos por plan) |
| 022 | `022_rrhh_nombre_documentos.sql` | RRHH Phase 2C+4A: nombre+apellido en empleados · rrhh_documentos · bucket empleados |
| 023 | `023_rrhh_capacitaciones.sql` | RRHH Phase 4B: rrhh_capacitaciones (nombre, fechas, horas, proveedor, estado, certificado_path) |
| 024 | `024_supervisor_rls.sql` | RRHH Phase 5: `get_supervisor_team_ids()` + RLS SUPERVISOR en asistencia/vacaciones/empleados |
| 025 | `025_sucursales.sql` | Multi-sucursal: tabla sucursales + sucursal_id nullable en 6 tablas operativas |
| 026 | `026_nomina_medio_pago.sql` | RRHH Nómina: medio_pago en rrhh_salarios + verificación saldo caja |
| 027 | `027_storage_productos_security.sql` | Security bucket productos: policy DELETE + file_size_limit 5MB + mime_types |
| 028 | `028_clientes_dni.sql` | Clientes: `dni TEXT` + UNIQUE(tenant_id, dni) WHERE NOT NULL |
| 029 | `029_ventas_monto_pagado.sql` | Ventas: `monto_pagado DECIMAL` para pago parcial en reservas |
| 030 | `030_devoluciones.sql` | Devoluciones: es_devolucion en ubicaciones+estados + tablas devoluciones + devolucion_items |
| 031 | `031_producto_estructuras.sql` | WMS Fase 1: producto_estructuras (niveles unidad/caja/pallet con dimensiones) |
| 032 | `032_ubicaciones_dimensiones.sql` | WMS Fase 2: tipo_ubicacion + dimensiones físicas en ubicaciones |
| 033 | `033_inventario_lineas_notas.sql` | Fix: notas TEXT nullable en inventario_lineas (para devoluciones) |
| 034 | `034_caja_traspasos.sql` | Traspasos entre cajas: es_caja_fuerte + tabla caja_traspasos |
| 035 | `035_users_avatar.sql` | Perfil: users.avatar_url + bucket avatares (public, 2MB) |
| 036 | `036_rrhh_feriados.sql` | RRHH: rrhh_feriados (nacional/provincial/personalizado/no_laborable) |
| 037 | `037_roles_custom.sql` | Roles parametrizables: roles_custom (permisos JSONB) + users.rol_custom_id FK |
| 038 | `038_movimientos_links.sql` | Trazabilidad: venta_id + gasto_id FK en movimientos_stock |
| 039 | `039_caja_arqueos.sql` | Arqueos: caja_arqueos (saldo_calculado, saldo_real, diferencia GENERATED STORED) |
| 040 | `040_kits.sql` | KITs WMS Fase 2.5: kit_recetas + kitting_log + productos.es_kit + tipo kitting |

---

## Migraciones 041-062

| # | Archivo | Descripción |
|---|---------|-------------|
| 041 | `041_...` | Session timeout + kitting_log.tipo(armado/desarmado) + des_kitting en movimientos_stock |
| 042 | `042_iva_biblioteca.sql` | IVA por producto (alicuota_iva) + venta_items.iva_monto + archivos_biblioteca + bucket |
| 043 | `043_certificados_afip.sql` | tenant_certificates + bucket certificados-afip + src/lib/afip.ts |
| 044 | `044_caja_sena.sql` | Nuevos tipos caja: ingreso_reserva, egreso_devolucion_sena + pagar_nomina actualizado |
| 045 | `045_metodos_pago.sql` | Tabla metodos_pago (nombre, color, activo, es_sistema, orden) |
| 046 | *(sin datos)* | — |
| 047 | `047_gastos_iva.sql` | GastosPage: IVA deducible |
| 048 | `048_gastos_fijos.sql` | gastos.comprobante_url + tabla gastos_fijos (descripcion, monto, frecuencia, dia_vencimiento) |
| 049 | `049_proveedores.sql` | ProveedoresPage: 9 campos extendidos + ordenes_compra + orden_compra_items + triggers |
| 050 | `050_recepciones_conteos.sql` | Recepciones + recepcion_items + inventario_conteos + inventario_conteo_items + inventario_lineas.estructura_id |
| 051 | `051_inventario_sprint_a.sql` | I-03 LPN vencidos + I-06 mover a otra sucursal + I-08 permite_over_receipt en tenants |
| 052 | `052_inventario_sprint_b.sql` | I-04 stock_minimo por sucursal + I-05 mono_sku en ubicaciones |
| 053 | `053_security_invoker.sql` | Fix security_invoker view (stock_por_producto) |
| 054 | `054_venta_items_decimal.sql` | venta_items.cantidad INT → DECIMAL(14,4) para UOM decimales |
| 055 | `055_autorizaciones_a.sql` | movimientos_stock.tipo CHECK ampliado (ajuste_ingreso, ajuste_rebaje, traslado) + cantidad DECIMAL |
| 056 | `056_autorizaciones_b.sql` | autorizaciones_inventario (tipo, linea_id, datos_cambio JSONB, estado, solicitado_por) |
| 057 | `057_lpn_madre.sql` | inventario_lineas.parent_lpn_id TEXT (LPN Madre) |
| 058 | `058_...` | Fix users.rol CHECK (RRHH/DEPOSITO/CONTADOR añadidos) |
| 059 | `059_recepciones.sql` | RecepcionesPage: estados OC recibida_parcial/recibida |
| 060 | `060_integraciones_schema.sql` | pgcrypto + ALTER ventas (origen, tracking, cae, etc.) + ALTER clientes + integration_job_queue + ventas_externas_logs |
| 061 | `061_oauth_credentials.sql` | tiendanube_credentials + mercadopago_credentials + inventario_tn_map |
| 062 | `062_tn_stock_trigger.sql` | trigger trg_tn_stock_sync AFTER INSERT/UPDATE/DELETE en inventario_lineas |

---

## Migraciones 063-083

| # | Descripción |
|---|-------------|
| 063 | `estados_inventario.es_disponible_tn BOOLEAN DEFAULT TRUE` |
| 064 | `estados_inventario.es_disponible_venta BOOLEAN DEFAULT TRUE` |
| 065 | meli_credentials + inventario_meli_map + trigger trg_meli_stock_sync |
| 066 | `estados_inventario.es_disponible_meli` + `ubicaciones.disponible_tn/disponible_meli` |
| 067 | `tenants.presupuesto_validez_dias INT DEFAULT 30` |
| 068–071 | *(datos no disponibles en docs)* |
| 072 | GastosPage overhaul: tipo_iva, iva_deducible, deduce_ganancias, múltiples medios de pago |
| 073 | Proveedores/Servicios: proveedor_productos + servicio_items + servicio_presupuestos + etiquetas |
| 074 | cliente_domicilios (alias, calle, ciudad, referencias, es_principal) |
| 075 | Módulo Envíos: tabla envios + bucket etiquetas-envios |
| 076 | Facturación AFIP Fase 1: campos en tenants (cuit, condicion_iva, razon_social, etc.) + clientes (cuit_receptor) |
| 077 | Facturación AFIP Fase 2: puntos_venta_afip + retenciones_sufridas + gastos.conciliado_iva |
| 078 | WhatsApp: tenants.whatsapp_plantilla + tenants.costo_envio_por_km |
| 079 | *(complemento WhatsApp)* |
| 080 | servicio_presupuestos: estado TEXT + gasto_id FK gastos(id) |
| 081 | Clientes mejorado: cliente_notas + clientes.fecha_nacimiento + clientes.etiquetas TEXT[] + codigo_fiscal |
| 082 | Fix crítico triggers stock: AFTER INSERT OR UPDATE OF cantidad,activo OR DELETE (no solo INSERT) |
| 083 | Cuenta Corriente: clientes.cuenta_corriente_habilitada + limite_credito + plazo_pago_dias · ventas.es_cuenta_corriente |
| 084 | Notificaciones reales: tabla notificaciones (RLS user) · caja_sesiones.monto_sugerido_apertura + diferencia_apertura · Caja Fuerte: tenants.caja_fuerte_roles + trigger fn_crear_caja_fuerte |
| 085 | OC gestión pagos: ordenes_compra.estado_pago + monto_total + monto_pagado + fecha_vencimiento_pago + dias_plazo_pago + condiciones_pago · proveedor_cc_movimientos (tipo oc/pago/nota_credito/ajuste) · fn_saldo_proveedor_cc() · proveedores.cuenta_corriente_habilitada + limite_credito_proveedor |
| 086 | Security hardening Fase 1: SET search_path = public en ~35 funciones + REVOKE EXECUTE FROM PUBLIC en funciones de trigger/internas |
| 086b | Security hardening Fase 2: REVOKE FROM PUBLIC + GRANT TO authenticated en funciones de negocio y auth helpers · Buckets avatares+productos: SELECT solo authenticated · Resultado: 80 → 7 warnings en Security Advisor |

---

## Migraciones 087–098

| # | Archivo | Descripción |
|---|---------|-------------|
| 087 | `087_api_keys.sql` | `api_keys` — API pull externa con service role |
| 088 | `088_nc_electronicas.sql` | NC electrónicas en `devoluciones` |
| 089 | `089_recursos.sql` | Módulo Recursos: tabla `recursos` + bucket recursos-fotos |
| 090 | `090_gastos_recepcion_id.sql` | `gastos.recepcion_id` — trazabilidad OC→Gasto automático en RecepcionesPage |
| 091 | `091_notif_cc_vencidas.sql` | `fn_notificar_cc_vencidas()` + pg_cron diario 09:00 AR |
| 092 | `092_producto_precios_mayorista.sql` | `producto_precios_mayorista` — tiers de precio mayorista por cantidad |
| 093 | `093_ordenes_compra_sucursal.sql` | `ordenes_compra.sucursal_id` — filtro por sucursal en Gastos tab OC |
| 094 | `094_users_sucursal_permisos.sql` | `users.sucursal_id` + `users.puede_ver_todas` — permisos multi-sucursal por usuario |
| 095 | `095_oc_derivadas_reembolso.sql` | `ordenes_compra.oc_padre_id` + `es_derivada` + `tiene_reembolso_pendiente` |
| 096 | `096_oc_costo_envio_contactos_proveedor.sql` | `ordenes_compra.tiene_envio/costo_envio` + tabla `proveedor_contactos` (CRUD múltiples contactos) |
| 097 | `097_gastos_recurso_cuotas.sql` | `gastos.recurso_id/es_cuota/cuotas_total/monto_cuota/tasa_interes` + tabla `gasto_cuotas` |
| 098 | `098_ventas_costo_envio.sql` | `ventas.costo_envio` — costo de envío separado del total de productos |

---

## Migraciones 087–108

| # | Archivo | Descripción |
|---|---------|-------------|
| 087–092 | `087_*` … `092_*` | (ver historial anterior) |
| 093 | `093_ordenes_compra_sucursal.sql` | `ordenes_compra.sucursal_id` |
| 094 | `094_users_sucursal_permisos.sql` | `users.sucursal_id` + `puede_ver_todas` + índice |
| 095 | `095_oc_derivadas_reembolso.sql` | `ordenes_compra.oc_padre_id/es_derivada/tiene_reembolso_pendiente` |
| 096 | `096_oc_costo_envio_contactos_proveedor.sql` | `ordenes_compra.tiene_envio/costo_envio` + tabla `proveedor_contactos` |
| 097 | `097_gastos_recurso_cuotas.sql` | `gastos.recurso_id/es_cuota/cuotas_total/monto_cuota/tasa_interes` + `gasto_cuotas` |
| 098 | `098_ventas_costo_envio.sql` | `ventas.costo_envio` |
| 099 | `099_notificaciones_metadata.sql` | `notificaciones.metadata JSONB` |
| 100 | `100_rename_owner_to_dueno.sql` | `rol='OWNER'→'DUEÑO'` + políticas RLS + `is_rrhh()` + `caja_fuerte_roles` |
| 101 | `101_ubicaciones_combos_sucursal.sql` | `ubicaciones.sucursal_id` + `combos.sucursal_id` |
| 102 | `102_recursos_recurrentes_ubicaciones.sql` | `recursos.es_recurrente/frecuencia_valor/.../proximo_vencimiento` |
| 103 | `103_autorizaciones_bulk_edit.sql` | `linea_id` nullable + tipo `bulk_edit` en `autorizaciones_inventario` |
| 104 | `104_cron_cleanup_job_queue.sql` | Cron diario limpieza `integration_job_queue` |
| 105 | `105_tenant_sql_query.sql` | Función `tenant_sql_query` — SQL Runner en ReportesPage |
| 106 | `106_process_single_aging_profile.sql` | Función `process_aging_profile_single` |
| 107 | `107_sucursales_envio_config.sql` | `sucursales.costo_km_envio` + tabla `courier_tarifas` |
| 108 | `108_ticket_sucursal_cuotas_oc_files.sql` | `sucursales.codigo` + `ventas.numero_sucursal` + trigger + `tenants.cuotas_bancos` + `ventas.cuotas_info` + `ordenes_compra.comprobante_url/titulo` |
| 109 | `109_modo_credentials.sql` | Tabla `modo_credentials` — integración MODO payments (merchant_id, api_key, ambiente, conectado) |
| 110 | `110_fix_fn_crear_caja_fuerte_security_definer.sql` | `fn_crear_caja_fuerte` como `SECURITY DEFINER` — fix RLS en registro de nuevo negocio |
| 111 | `111_cajas_sucursal_id.sql` | `cajas.sucursal_id` FK a `sucursales` + índice |
| 112 | `112_seed_tenant_defaults.sql` | Trigger `trg_seed_tenant_defaults` — crea motivos, estados al registrar tenant |
| 113 | `113_users_delete_policy.sql` | Políticas RLS DELETE en `users` (`users_delete_self` + `users_delete_owner`) |
| 114 | `114_sucursal_default_seed.sql` | `fn_seed_tenant_defaults` actualizado: crea Sucursal 1 + Caja Principal · backfill cajas y tenants sin sucursal |
| 115 | `115_backfill_sucursal_ventas_gastos_envios.sql` | Backfill `sucursal_id` en `ventas`, `gastos`, `envios` → sucursal más antigua del tenant |
| 116 | `116_backfill_sucursal_resto.sql` | Backfill `sucursal_id` en `recepciones`, `ordenes_compra`, `movimientos_stock` |
| 117 | `117_backfill_sucursal_completo.sql` | Backfill final: `inventario_lineas`, `inventario_conteos`, `caja_sesiones`, `recursos`, `puntos_venta_afip`, `cajas` (op) |
| 118 | `118_productos_atributos_nuevos.sql` | `productos`: marca, shelf_life_dias, tiene_pais_origen, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma · `inventario_lineas`: pais_origen, talle, color, encaje, formato, sabor_aroma |
| 119 | `119_unidades_medida_custom.sql` | Tabla `unidades_medida` (tenant_id, nombre, simbolo, activo) con RLS |
| 120 | `120_producto_grupos_variantes.sql` | Tabla `producto_grupos` (nombre, atributos JSONB, precio_base, categoria_id) · `productos`: grupo_id FK + variante_valores JSONB |
| 121 | `121_producto_ubicacion_sucursal.sql` | Tabla `producto_ubicacion_sucursal` (producto_id, sucursal_id, ubicacion_id) — UNIQUE(producto_id, sucursal_id) |

---

## Migraciones 122–126 (v1.8.32–v1.8.37)

| # | Archivo | Descripción |
|---|---------|-------------|
| 122 | `122_ventas_origen_extend.sql` | `ventas_origen_check` extendida con Instagram, Facebook, WhatsApp, Otros (ISS-110) |
| 123 | `123_config_fases2_3_4_tenants.sql` | `tenants`: email_legal, precio_redondeo, cliente_obligatorio, cliente_datos_minimos, cliente_consumidor_final, cliente_creacion_inline, descuento_max_cajero_pct, descuento_max_supervisor_pct, clave_maestra, boveda_umbral_caja |
| 124 | `124_sucursales_config_extendida.sql` | `sucursales`: codigo_postal, email, horario_apertura TIME, horario_cierre TIME, punto_venta_afip INTEGER |
| 125 | `125_metodos_pago_comision.sql` | `metodos_pago`: comision_pct NUMERIC(5,2), config JSONB |
| 126 | `126_ordenes_compra_descuento.sql` | `ordenes_compra.monto_descuento NUMERIC(12,2) DEFAULT 0` — descuento del proveedor al pagar (ISS-132) |
| 127 | `127_envios_pod_en_bodega.sql` | `envios`: POD fields (pod_url/pod_fecha/pod_receptor/pod_notas) + estado `en_bodega` en CHECK |
| 128 | `128_envios_pago_courier.sql` | `envios`: `costo_pagado BOOLEAN` + `fecha_pago_courier DATE` + `medio_pago_courier TEXT` (ISS-169) |
| 129 | `129_transportista_token.sql` | `envios.token_transportista` + 3 funciones SECURITY DEFINER públicas (`get_envio_by_token`, `get_envio_items_by_token`, `update_envio_by_token`) para ISS-165 |
| 130 | `130_categorias_gasto.sql` | Tabla `categorias_gasto` (tenant_id, nombre, requiere_sucursal, activo, predefinida, orden) con UNIQUE(tenant_id, nombre) + RLS. Seed automático de 16 categorías base por tenant + backfill para existentes + trigger `AFTER INSERT ON tenants`. FK opcional `gastos.categoria_id` y `gastos_fijos.categoria_id` |
| 131 | `131_tenants_gastos_settings.sql` | 7 columnas en `tenants` para reglas de gastos: 4 toggles OR de obligatoriedad de comprobante (`gastos_comp_siempre/si_iva/si_monto/si_deduce_ganancias`) + `gastos_comp_monto_umbral` + `gastos_dias_alerta_borrador` (default 7) + `gastos_dias_alerta_anticipo_oc` (default 15) |
| 132 | `132_gastos_umbrales_autorizaciones.sql` | `sucursales.umbral_gasto_supervisor/cajero` (DECIMAL nullable) + tabla `autorizaciones_gasto` (tipo/monto/payload/solicitante_rol/estado/aprobador_rol con RLS por tenant) + helper SQL `puede_aprobar_autorizacion_gasto(solic_rol, aprob_rol)` (CAJERO→SUPERVISOR+ · SUPERVISOR→ADMIN/DUEÑO) |
| 133 | `133_moneda_iva_alicuota_cc_autorizaciones.sql` | `tenants.moneda TEXT DEFAULT 'ARS'` con CHECK (11 monedas LatAm + EUR/USD) + `gastos.alicuota_iva DECIMAL(5,2)` + `gastos_fijos.alicuota_iva` + tabla `autorizaciones_cc` (motivo_bloqueo: `limite_excedido | oc_vencida`, payload de solicitud, RLS por tenant) |
| 134 | `134_gastos_capitaliza_egresos_consolidados.sql` | `gastos.capitaliza_recurso BOOLEAN DEFAULT FALSE` con CHECK (TRUE solo si recurso_id IS NOT NULL) + índice parcial + VIEW `vw_egresos_consolidados` (UNION ALL de gastos + rrhh_salarios.pagado=true, `WITH (security_invoker = true)`, columnas `fuente/tenant_id/fecha/monto/descripcion/categoria/sucursal_id/medio_pago/usuario_id/recurso_id/empleado_id/periodo/created_at`) |
| 135 | `135_cierre_contable.sql` | Tabla `cierres_contables(tenant_id, periodo, fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB)` UNIQUE(tenant_id, periodo) + RLS · `gastos.gasto_padre_id` + `gastos.es_correccion BOOLEAN` para notas de corrección · 5 triggers BEFORE UPDATE/DELETE en `gastos/ventas/caja_movimientos/caja_sesiones/ordenes_compra` que rechazan con RAISE EXCEPTION SQLSTATE P0001 si la fecha cae en periodo cerrado · helpers `ultimo_cierre_hasta(tenant)` y `periodo_cerrado(tenant, fecha)` · RPC `cerrar_periodo(p_periodo, p_observaciones)` SECURITY DEFINER (DUEÑO/SUPERVISOR/CONTADOR/ADMIN, snapshot de totales) · RPC `reabrir_periodo(p_cierre_id)` (sólo último cierre, DUEÑO/ADMIN/SUPER_USUARIO) |

**Total aplicadas:** 142 + 086b = 143 archivos en DEV y PROD (al día) ✅

| # | Archivo | Descripción |
|---|---------|-------------|
| 136 | `136_caja_moneda_cuentas_origen.sql` | **Caja Tanda 1 (v1.9.1)** · `cajas.moneda` + tabla `cuentas_origen` + `metodos_pago.cuenta_origen_id` + `caja_movimientos.cuenta_origen_id` + vista `vw_boveda_cuentas` + seed cuenta `Efectivo` por tenant |
| 137 | `137_boveda_retiros_y_backfill.sql` | **Caja Tanda 1.5 (v1.9.2)** · Tabla `boveda_retiros` con RLS estricta (solo DUEÑO/ADMIN/SUPER_USUARIO) + backfill `cuenta_origen_id` en movimientos históricos + UNIQUE partial index (1 cuenta efectivo por tenant) |
| 138 | `138_cuentas_origen_seed_metodos.sql` | **Caja Tanda 1.5 (v1.9.2)** · Auto-seed de cuentas de origen para métodos de pago no-efectivo existentes (banco / billetera inferido por nombre) + re-backfill de conceptos históricos `[Nombre Método] ...` |
| 139 | `139_boveda_backfill_fuzzy.sql` | **Hotfix v1.9.2** · Backfill flexible cuenta_origen_id con normalización (lower + sin tildes + sin "de ") para matchear conceptos viejos como `[Tarjeta crédito]` con `Tarjeta de crédito` |
| 140 | `140_caja_permisos_fase2_0.sql` | **Caja Fase 2.0 (v1.9.3)** · `caja_sesiones.abierta_por` (A2) + `tenants.config_caja JSONB` (config permisos) + RPCs `requiere_clave_maestra` y `verificar_clave_maestra` (B5) |
| 141 | `141_caja_cierre_enriquecido.sql` | **Caja Fase 2.1 (v1.9.4)** · `caja_sesiones.numero` correlativo por sucursal con trigger (K3) + `snapshot_totales JSONB` para regenerar ticket PDF idéntico (K2) + `tenants.diferencia_caja_umbral/alerta_roles/alerta_canales` (B1/B2/B3) + vista `vw_diferencias_por_cajero` 30 días (B4) |
| 142 | `142_caja_reportes.sql` | **Caja HITO v1.10.0** · vista `vw_caja_resumen_diario` (agregado día/caja/sucursal) + vista `vw_caja_mensual_por_sucursal` (alineada con cierre contable). Usadas por los 4 reportes de Caja (I1/I2) |
| 143 | `143_cron_cleanup_envio_tokens.sql` | **v1.10.1 quick win** · pg_cron `cleanup_envio_tokens_transportista` diario 07:00 UTC. NULL en `envios.token_transportista` para envíos entregados/cancelados/devolucion con +30 días desde último update — invalida links públicos viejos sin tocar el resto del envío |
| 144 | `144_envio_pod_fotos.sql` | **v1.10.1 quick win** · tabla `envio_pod_fotos(id, envio_id, tenant_id, url, storage_path, orden, created_at, created_by)` con RLS por tenant + backfill desde `envios.pod_url`. Soporta N fotos por POD; la de orden 0 sincroniza con `envios.pod_url` para retro-compat. Usada por componente `PodFotosManager` |
| 145 | `145_fix_pagar_nomina_saldo.sql` | **Bugfix ISS-186** · `pagar_nomina_empleado` ahora cuenta `ingreso_traspaso`/`egreso_traspaso` en el saldo. Antes la bóveda (que recibe por traspaso) daba "saldo insuficiente" al pagar nómina |
| 146 | `146_caja_traspasos_movimientos_fk.sql` | **Bugfix ISS-193** · `caja_traspasos.movimiento_origen_id` + `movimiento_destino_id` (FK a caja_movimientos). Permite que al corregir un traspaso se ajuste la caja contraparte (devuelve/cobra la diferencia) |
| 147 | `147_empleados_supervisor_empleado.sql` | **Bugfix ISS-185** · `empleados.supervisor_id` re-apuntado de `users(id)` a `empleados(id)` — organigrama armado con empleados de RRHH. `get_supervisor_team_ids()` reescrita: mapea `auth.uid()` → `empleados.user_id` → `supervisor_id`. ⚠ Nulea supervisor_id viejos que apuntaban a users |
| 148 | `148_unidades_medida_predefinidas.sql` | **ISS-180** · columna `predefinida BOOLEAN` en `unidades_medida`. Seed de 6 unidades predefinidas por tenant (Unidad/kg/g/L/m/caja). Backfill tenants existentes. Predefinidas no son editables ni eliminables desde UI |
| 149 | `149_metodos_pago_habilitado_ventas_gastos.sql` | **ISS-135** · `habilitado_ventas` + `habilitado_gastos` en `metodos_pago` (default `true`). ConfigPage muestra toggles POS/Gastos por método. VentasPage y GastosPage filtran por estos flags |
| 150 | `150_gastos_pago_parcial.sql` | **ISS-190** · `monto_pagado NUMERIC` + `estado_pago TEXT` (`pendiente/parcial/pagado`) en `gastos`. Backfill: gastos con `medio_pago` → `pagado`; sin medio → `pendiente`. Índice por `(tenant_id, estado_pago)` |
| 151 | `151_empleados_user_id_unique.sql` | **RRHH-A5** · UNIQUE parcial `empleados(tenant_id, user_id) WHERE user_id IS NOT NULL`. Garantiza que un user del sistema esté vinculado a un único empleado por tenant. Habilita "Mi Equipo" del SUPERVISOR (`get_supervisor_team_ids` mapea `auth.uid()` → `empleados.user_id` unívocamente) |
| 152 | `152_envios_rangos_horarios.sql` | **ISS-178** · `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos (8-13/13-18/18-22) + `envios.rango_horario_desde/hasta TIME` (snapshot al momento del envío, no rompe si después se borra el rango). Editable en Config → Envíos, selector en modal de envío de VentasPage y form de EnviosPage |
| 153 | `153_venta_item_despachos.sql` | **ISS-075** · Nueva tabla `venta_item_despachos`: desglose de despacho por LPN/ubicación de cada `venta_item` (una fila por porción/línea de origen o por serie). Campos texto (`lpn`, `ubicacion_nombre`, `nro_serie`) = snapshot intacto ante edición/borrado del LPN. RLS por tenant. Capturada en `registrarVenta` Fase 2 + transición reserva→despacho |
| 154 | `154_trazabilidad_asignacion_stock.sql` | **ISS-075** · `venta_item_despachos.origen TEXT` (`manual`/`auto`: si el LPN lo eligió el operador o la regla de rebaje del sistema) + `tenants.trazabilidad_asignacion BOOLEAN DEFAULT TRUE` (toggle en Config → Inventario para activar/desactivar el registro del desglose) |
| 155 | `155_actividad_log_ledger.sql` | **Trazabilidad-extendida** · `actividad_log` pasa a ledger grado WMS: +7 columnas aditivas nullables (`transaccion_id`, `tipo_transaccion`, `producto_id`, `lpn`, `nro_serie`, `lote`, `sucursal_id`) — todas snapshot, sin backfill (filas legacy quedan con `transaccion_id` NULL). Habilita consolidar N filas de una acción en 1 transacción + trazabilidad por unidad (recall) por LPN/serie. Índices por `transaccion_id`, `(tenant_id, producto_id)`, `(tenant_id, lpn)`, `(tenant_id, nro_serie)`. Ver [[reportes-metricas]] |
| 156 | `156_venta_items_lpn_plan.sql` | **Reservas — selección manual de LPN** · `venta_items.lpn_plan JSONB` (`[{linea_id,lpn,cantidad,manual}]`). Persiste el plan de LPN del carrito para honrarlo al despachar una reserva (`cambiarEstado`): Fase A sigue el plan, Fase B autocompleta por sort si cambió el stock. Aditiva/nullable (venta directa / items serializados / ventas legacy quedan NULL → sort automático, comportamiento previo) |
| 157 | `157_codigo_perfiles.sql` | **ISS-127 F1** · Tabla `codigo_perfiles` (perfiles de códigos compuestos GS1/custom: `proveedor_id`, `tipo gs1/custom`, `simbologia gs1_128/datamatrix`, `ais JSONB`, `custom_format JSONB`, `lectura_modo autocompletar/directo`). RLS por tenant |
| 158 | `158_productos_gtin.sql` | **ISS-127 F1** · `productos.gtin TEXT` + índice `(tenant_id, gtin)`. GTIN dedicado (GS1 AI 01) para match de códigos compuestos; fallback a `codigo_barras` si NULL |
| 159 | `159_presupuesto_numero.sql` | **Relevamiento Ventas F5** · `ventas.presupuesto_numero` + `presupuesto_numero_sucursal`. Trigger `gen_venta_numero` asigna correlativo de presupuesto independiente (solo si nace `estado='pendiente'`), sin tocar la numeración de ventas. Backfill de presupuestos existentes (deshabilita `trg_ventas_cierre` durante el UPDATE). UI: `formatTicket` → `PRES-{cod}-NNNN` |
| 160 | `160_reservas_sena_vencimiento.sql` | **Relevamiento Ventas E1/E2/E6** · `tenants`: `reserva_sena_obligatoria`, `reserva_sena_minima_pct`, `reserva_vencimiento_dias` (NULL=sin venc.), `reserva_penalidad_pct`. `ventas.reservado_at`. Tabla `cliente_creditos` (ledger saldo a favor, RLS por tenant). Función `liberar_reservas_vencidas(tenant)` SECURITY DEFINER: libera stock reservado + cancela vencidas (NO toca dinero; cada reserva atómica, saltea período cerrado). GRANT a `authenticated` |
| 161 | `161_producto_precio_usd.sql` | **Relevamiento Ventas G5** · `productos.precio_usd DECIMAL` + `productos.moneda_venta TEXT DEFAULT 'local'` (`'local'` \| `'usd'`). Si `'usd'`, el POS convierte `precio_usd` a moneda local a la cotización vigente al cargar al carrito |
| 162 | `162_courier_credenciales.sql` | **ISS-174 F1** · Tabla `courier_credenciales` (`tenant_id, courier, credenciales JSONB, activo`, UNIQUE(tenant,courier), RLS por tenant) — credenciales de API de courier por tenant, usadas server-side. `tenants.envio_peso_fuente TEXT DEFAULT 'manual'` CHECK(`'manual'`\|`'producto'`) — fuente del peso/medidas al cotizar |
| 163 | `163_codigo_postal.sql` | **ISS-174 F1** · Idempotente: `codigo_postal` ya existía en `sucursales` (mig 124) y `cliente_domicilios` (mig 074); re-documenta el propósito para cotización de envíos |
| 164 | `164_productos_peso_dimensiones.sql` | **ISS-174 F1** · `productos.peso_kg DECIMAL(10,3)` + `largo_cm/ancho_cm/alto_cm DECIMAL(10,2)` (nullable) — dato maestro de peso/volumen para cotizar envíos cuando `envio_peso_fuente='producto'` |
| 165 | `165_envios_cotizacion_api.sql` | **ISS-174 F2** · `envios.cotizacion_json JSONB` (snapshot de la opción elegida + opciones) + `courier_orden_id TEXT` (ID de la orden en el courier) + `cotizado_api BOOLEAN DEFAULT false`. Metadata de la integración por API (Edge Function `courier-api`) |
| 166 | `166_fix_seed_categorias_gasto_security_definer.sql` | **Hotfix onboarding (v1.14.1)** · `seed_categorias_gasto()` + `fn_seed_categorias_gasto_new_tenant()` pasan a **SECURITY DEFINER** (+ `search_path=public`). El trigger AFTER INSERT en `tenants` seedeaba categorías de gasto antes de existir la fila en `users`, y el RLS WITH CHECK rechazaba el INSERT → registro de negocio nuevo fallaba. Las otras 2 funciones de seed del tenant ya eran SECURITY DEFINER |
| 167 | `167_ventas_consumidor_final.sql` | **VF1/H5** · `ventas.consumidor_final BOOLEAN DEFAULT TRUE`. Flag por venta (Consumidor Final vs cliente registrado); con facturación activa y no-CF el cliente es obligatorio |
| 168 | `168_canales_venta.sql` | **VF2/I1+I2** · Tabla `canales_venta` (`tenant_id, nombre, clasificacion online\|presencial, icono, activo, predefinido, orden`) + seed `SECURITY DEFINER` + trigger AFTER INSERT en `tenants` + backfill. `tenants.reglas_canal JSONB` (reglas por clasificación: devolucion_dias, descuento_max_pct, lista_precio, requiere_cliente). MP no se seedea (es medio de pago) |
| 169 | `169_venta_auditoria.sql` | **VF3/J1** · Tabla `venta_auditoria` (`tenant_id, venta_id, accion, detalle JSONB, usuario_id, usuario_nombre`) — audit log detallado por venta (anulación, cambio de cliente, override de descuento), visible en el modal de la venta. RLS por tenant |
| 170 | `170_alertas_ventas_config.sql` | **VF4/K2** · `tenants.alerta_margen_negativo BOOLEAN`, `alerta_devoluciones_n INT` (NULL=off), `alerta_devoluciones_dias INT DEFAULT 30`. Umbrales de alertas de ventas event-driven (margen negativo al cerrar venta; cliente/producto con >N devoluciones en M días) |
| 171 | `171_clientes_cl1.sql` | **Clientes CL1** · `clientes.motivo_baja/baja_at/baja_por` (A6 soft delete con razón) + índice parcial `idx_clientes_activo`. `tenants.cliente_etiquetas_catalogo TEXT[]` (F1 catálogo de etiquetas para autocomplete) |
| 172 | `172_clientes_cl2_cc.sql` | **Clientes CL2** · CC clientes. `tenants.limite_cc_default`, `cc_enforcement_politica` (permitir\|avisar\|bloquear), `cc_morosidad_politica` (permitir\|bloqueo_cc\|bloqueo_total), `cc_dias_vencimiento INT`, `cc_interes_mensual_pct`. `ventas.fecha_vencimiento_cc DATE` + `interes_cc DECIMAL`. RPC `cliente_cc_estado(cliente)` (deuda_total/vencida/interés, SECURITY DEFINER tenant-scoped) + `recalcular_intereses_cc(tenant)` (sweep-lazy idempotente de intereses de mora; pg_cron no habilitado) |
| 173 | `173_clientes_cl3.sql` | **Clientes CL3** · B8 estado de cuenta. `clientes.cuenta_token TEXT UNIQUE` + índice parcial. RPC `get_cuenta_cliente_by_token(token)` → JSONB (cliente + ventas CC pendientes), SECURITY DEFINER, GRANT anon — portal público `/cuenta/:token`. B6 incobrable se resuelve en app (sin DDL) |
| 174 | `174_fix_ventas_origen_check.sql` | **Bugfix** · `DROP CONSTRAINT ventas_origen_check`. Desde mig 168 el canal de venta (`ventas.origen`) es configurable por tenant (catálogo `canales_venta`); la constraint rígida (lista fija, mig 122) rechazaba canales nuevos → "new row violates check constraint ventas_origen_check" al vender. El canal se valida a nivel de app |
| 175 | `175_clientes_cl4_notif.sql` | **Clientes CL4** · Config de notificaciones CC en `tenants`: `cc_notif_canales TEXT[]` (email\|whatsapp), `cc_notif_registro_deuda` (C1), `cc_notif_pago` (C4), `cc_notif_pre_venc_dias INT` (C2, default 3), `cc_notif_escalado_dias INT` (C3), `cumple_notif_cliente`/`cumple_notif_duenio` (C5). Defaults OFF (opt-in). Emails event-driven vía Edge Function `send-email` |
| 176 | `176_proveedores_cl5.sql` | **Clientes CL5** · D6: tabla `proveedor_cuentas_bancarias` (banco/titular/cbu/alias/cuenta/es_principal, RLS por tenant) — cuentas bancarias múltiples por proveedor. D4: `proveedor_cc_movimientos.nc_numero` + `adjunto_url` (correlativo y comprobante de NC) |
| 177 | `177_conteos_scope.sql` | **Conteos 2.0 F1** · amplía el CHECK de `inventario_conteos.tipo` (`+ 'marca','categoria','sucursal'`) y agrega `filtros JSONB DEFAULT '{}'` (criterio del conteo cuando el alcance no es FK directa: `{marca}`/`{categoria_id,categoria_nombre}`). Aditiva, idempotente, sin impacto en RLS |
| 178 | `178_conteos_f2a.sql` | **Conteos 2.0 F2a** · `tenants.conteo_modo` (rapido\|guiado\|elegir) · `ubicaciones.secuencia INTEGER` (orden recorrido conteo+picking) · `inventario_conteos.modo` (rapido\|guiado) · `inventario_conteo_items.cantidad_contada` → **NULLABLE** (distingue no-contada de cero, B3). CHECKs idempotentes vía `information_schema.table_constraints` |
| 179 | `179_conteos_f3.sql` | **Conteos 2.0 F3** · `'ajuste_conteo'` en el CHECK de `autorizaciones_inventario.tipo` (gate de aprobación de diferencias de conteo) · `tenants` + 7 columnas de config: `conteo_gate_activo BOOLEAN` + umbrales gate (`_umbral_u/_pct/_valor`) + umbrales reconteo (`_reconteo_umbral_u/_pct/_valor`). Aditiva |
| 180 | `180_conteos_f4.sql` | **Conteos 2.0 F4** · `productos.clase_abc TEXT` (CHECK A/B/C) + `clase_abc_manual BOOLEAN` (override que el recálculo no pisa) + `ultimo_conteo_at TIMESTAMPTZ` · `inventario_conteo_items.contado_por UUID REFERENCES users(id)` (trazabilidad por operador) · `tenants.conteo_ciclico_dias_a/_b/_c INTEGER DEFAULT 30/90/180` (config cíclico) · índice `idx_productos_clase_abc(tenant_id, clase_abc, ultimo_conteo_at)`. Aditiva, idempotente, sin impacto en RLS |
| 181 | `181_conteos_f2bref_f3b_a2.sql` | **Conteos 2.0 cierre 100%** · F2b-ref: `inventario_conteo_items.fuera_de_scope BOOLEAN` (mercadería mal ubicada escaneada) · F3b: `costo_snapshot NUMERIC` (costo congelado al cargar) + `cantidad_reconteo NUMERIC` + `reconteo_por UUID REFERENCES users(id)` (doble conteo formal) · A2: `inventario_conteos.bloquea_movimientos BOOLEAN` + `tenants.conteo_wall_to_wall_bloquea BOOLEAN` (wall-to-wall bloquea sucursal) + índice parcial `idx_conteos_bloqueo`. Aditiva, idempotente |
| 182 | `182_compras_co1_gobierno.sql` | **Compras CO1** · `tenants.oc_aprobacion_activa/_umbral` (A2 aprobación) + `oc_numeracion` (A5, CHECK tenant\|sucursal\|proveedor) + `oc_pago_doble_firma_umbral` (D5) · `ordenes_compra.numero_sucursal` (A5) + `requiere_aprobacion`/`aprobada_por`/`aprobada_at` (A2) · `set_oc_numero()` actualizado (asigna numero + numero_sucursal). Aditiva |
| 183 | `183_compras_co2_recepcion.sql` | **Compras CO2** · `recepcion_items.motivo_faltante` (B4) · `recepciones.remito_url` (B7) · `tenants.over_receipt_pct_max` (B3) + `recepcion_remito_obligatorio` (B7) + `recepcion_alerta_faltante_dias` (B4) · bucket privado `remitos` + policies scoped por tenant. (B5 robustez = recálculo acumulado en la app.) Aditiva |
| 184 | `184_compras_co3_costos.sql` | **Compras CO3** · `tenants.compras_costo_alerta_pct` (E1, default 10) · `ordenes_compra.costo_aduana/comision/otros` (E2) · `productos.pendiente_revision` (E3) + índice parcial. B6 editar precio = audit en `actividad_log`. Aditiva |
| 185 | `185_compras_co4_devolucion_proveedor.sql` | **Compras CO4** · tablas `devoluciones_proveedor` (proveedor/oc/recepcion/sucursal, `forma` CHECK credito_cc\|efectivo\|reposicion, motivo, observacion, monto, caja_sesion_id, oc_reposicion_id) + `devolucion_proveedor_items` (producto/cantidad/costo_unitario/lpn), RLS por tenant + trigger `set_devprov_numero` (correlativo). Confirm/stock/CC/caja/reposición en la app |

---

## Reglas de trabajo con migraciones

```
1. Crear supabase/migrations/NNN_descripcion.sql (idempotente)
2. Aplicar en DEV (project gcmhzdedrkmmzfzfveig)
3. Actualizar supabase/schema_full.sql
4. Commit + push dev
5. Al deployar → aplicar en PROD (project jjffnbrdjchquexdfgwq)
```

### SIEMPRE al crear una tabla nueva

> [!WARNING] **A partir del 30 de octubre de 2026** Supabase deja de auto-exponer tablas nuevas del schema `public`. Agregar el GRANT al final de toda migration con `CREATE TABLE`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nombre_tabla TO authenticated;
-- GRANT SELECT ON public.nombre_tabla TO anon;  -- solo si es acceso público sin auth
```

Ver patrón completo y explicación en [[wiki/development/convenciones-codigo#grant-obligatorio-en-tablas-nuevas]].

### NUNCA
- ❌ Modificar tablas directamente en PROD sin pasar por DEV
- ❌ ALTER TABLE fuera de un archivo de migration
- ❌ Reescribir una migration ya aplicada en PROD (crear una nueva)

---

## Links relacionados

- [[wiki/database/schema-overview]]
- [[wiki/database/rls-policies]]
- [[wiki/development/deploy]]
- [[wiki/development/supabase-dev-vs-prod]]
