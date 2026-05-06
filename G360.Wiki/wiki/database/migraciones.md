---
title: Historial de Migraciones
category: database
tags: [migraciones, schema, postgresql, supabase]
sources: [WORKFLOW.md, CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
---

# Historial de Migraciones (001-083)

**Total al 2026-04-30:** 83 migraciones aplicadas.  
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

---

## Reglas de trabajo con migraciones

```
1. Crear supabase/migrations/NNN_descripcion.sql (idempotente)
2. Aplicar en DEV (project gcmhzdedrkmmzfzfveig)
3. Actualizar supabase/schema_full.sql
4. Commit + push dev
5. Al deployar → aplicar en PROD (project jjffnbrdjchquexdfgwq)
```

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
