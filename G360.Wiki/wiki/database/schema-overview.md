---
title: Schema de Base de Datos
category: database
tags: [postgresql, supabase, schema, tablas, migraciones]
sources: []
updated: 2026-04-30
---

# Schema de Base de Datos

Genesis360 tiene 83 migraciones aplicadas al 2026-04-30. El schema completo está en `supabase/migrations/schema_full.sql`.

---

## Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `tenants` | Negocios/empresas (cada tenant = un negocio) |
| `users` | Empleados de cada tenant, con rol |
| `sucursales` | Branches/sucursales del negocio |
| `productos` | Catálogo de productos |
| `inventario` | Stock por LPN (Location/Product/Lot) |
| `movimientos` | Historial de movimientos de stock |
| `ventas` | Cabecera de ventas |
| `ventas_items` | Líneas de detalle de cada venta |
| `caja` | Sesiones de caja (apertura/cierre) |
| `caja_movimientos` | Movimientos de dinero en caja |
| `clientes` | Cartera de clientes |
| `cuenta_corriente` | Saldo y movimientos de cuenta corriente de clientes |
| `proveedores` | Cartera de proveedores |
| `gastos` | Registro de gastos |
| `actividad_log` | Auditoría de acciones (append-only) |
| `subscriptions` | Estado de suscripción por tenant |
| `empleados` | Empleados (módulo RRHH) |
| `liquidaciones` | Liquidaciones de sueldo |
| `asistencia` | Registros de asistencia |
| `vacaciones` | Gestión de vacaciones |
| `capacitaciones` | Capacitaciones de empleados |
| `ordenes_compra` | Órdenes de compra a proveedores |
| `remitos` | Remitos de recepción de mercadería |
| `facturas` | Facturas emitidas (AFIP) |
| `cotizacion` | Cotización USD/ARS (histórico) |
| `precio_historico` | Historial de precios de productos |
| `alertas_inventario` | Configuración de alertas de stock |
| `reglas_inventario` | Reglas de reorden automático |
| `ubicaciones` | Ubicaciones físicas de stock |
| `kits` | Definición de kits (producto → componentes) |
| `marketplace_items` | Productos sincronizados con MeLi / TN |
| `envios` | Envíos y su estado |

---

## Convenciones del schema

- Todas las tablas de negocio tienen `tenant_id UUID NOT NULL`
- PKs son UUIDs (`gen_random_uuid()`)
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()`
- Soft deletes: columna `deleted_at` (no se usa `DELETE` directo)
- RLS habilitado en todas las tablas
- Políticas usando subquery (nunca funciones en `USING`)

---

## Migraciones destacadas

| Migración | Contenido clave |
|-----------|----------------|
| `001_initial_schema.sql` | Base: tenants, users, productos, inventario, movimientos, ventas |
| `002_cotizacion_y_precio_historico.sql` | Tipos de cambio e historial de precios |
| `003_clientes_y_rentabilidad.sql` | CRM básico + cálculo de margen |
| `008_gastos.sql` | Módulo de gastos |
| `009_actividad_log.sql` | Auditoría de acciones |
| `016-019` | RRHH: nómina, vacaciones, asistencia, capacitación |
| `051-060` | Integraciones: Mercado Pago, Mercado Libre, Tienda Nube |
| `083_cuenta_corriente.sql` | Cuenta corriente de clientes (última al 2026-04-30) |

Ver [[wiki/database/migraciones]] para la lista completa.

---

## Triggers importantes

- **Stock:** movimientos → actualización automática de `inventario`
- **Numeración:** auto-incremento de número de venta por tenant
- **Alertas:** verifica límites de stock tras cada movimiento

Ver [[wiki/database/triggers]].

---

## Actividad Log

La tabla `actividad_log` es append-only. El helper `src/lib/actividadLog.ts` expone `logActividad()` que es **fire-and-forget** (nunca usar `await` con ella).

---

## Links relacionados

- [[wiki/database/migraciones]]
- [[wiki/database/rls-policies]]
- [[wiki/database/triggers]]
- [[wiki/architecture/backend-supabase]]
- [[wiki/architecture/multi-tenant-rls]]
