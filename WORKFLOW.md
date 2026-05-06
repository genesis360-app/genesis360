# Genesis360 — Workflow de Desarrollo

## Ambientes

| Ambiente | Supabase | Vercel | Branch |
|----------|----------|--------|--------|
| **PROD** | `jjffnbrdjchquexdfgwq` | genesis360.pro | `main` |
| **DEV**  | `gcmhzdedrkmmzfzfveig` | preview automático | `dev` |

## Reglas fundamentales

- `main` = producción. **Claude Code nunca hace push a `main`**.
- Todo desarrollo en `dev` → PR → merge a `main` → deploy automático.
- GH_TOKEN desde Windows Credential Manager (no está en `.env.local`):
  ```bash
  git credential fill <<< "$(printf 'protocol=https\nhost=github.com')" | grep password | cut -d= -f2
  ```

---

## Flujo de deploy

```
1. Trabajar en dev · commits con Co-Authored-By: GNO <gaston.otranto@gmail.com>
2. Aplicar migrations pendientes en PROD (MCP apply_migration)
3. Crear PR dev → main · Mergear → Vercel deploya automáticamente
4. Crear GitHub release vX.Y.Z
5. Deployar Edge Functions nuevas si las hay
```

### Comandos PR y release
```bash
GH_TOKEN="..." "/c/Program Files/GitHub CLI/gh.exe" pr create --base main --head dev --title "vX.Y.Z — Desc" --body "..."
GH_TOKEN="..." "/c/Program Files/GitHub CLI/gh.exe" pr merge N --merge
GH_TOKEN="..." "/c/Program Files/GitHub CLI/gh.exe" release create vX.Y.Z --target main --title "vX.Y.Z — Desc" --notes "..." --prerelease
```

---

## Migraciones de base de datos

**Regla:** toda modificación al schema = archivo en `supabase/migrations/NNN_descripcion.sql` (idempotente con `IF NOT EXISTS`).

```
1. Crear supabase/migrations/NNN_descripcion.sql
2. Aplicar en DEV (MCP apply_migration · project gcmhzdedrkmmzfzfveig)
3. Actualizar supabase/schema_full.sql
4. Commit + push dev
5. Al deployar → aplicar en PROD (MCP apply_migration · project jjffnbrdjchquexdfgwq)
```

**Claude Code no aplica migraciones en PROD** salvo pedido explícito del usuario.

> `CREATE POLICY IF NOT EXISTS` no existe en PostgreSQL. Usar: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE ...) THEN CREATE POLICY ...; END IF; END $$`

### Historial de migrations

| # | Archivo | Descripción | DEV | PROD |
|---|---------|-------------|-----|------|
| 001 | `001_initial_schema.sql` | Schema inicial completo | ✅ | ✅ |
| 002 | `002_cotizacion_y_precio_historico.sql` | Cotización USD y precio costo histórico | ✅ | ✅ |
| 003 | `003_clientes_y_rentabilidad.sql` | Módulo clientes + rentabilidad real | ✅ | ✅ |
| 004 | `004_caja_cierre_real.sql` | Caja: conteo real al cierre, diferencia, cerrado_por | ✅ | ✅ |
| 005 | `005_combos.sql` | Tabla combos (reglas de precio por volumen) | ✅ | ✅ |
| 006 | `006_ventas_numero_trigger.sql` | Trigger auto-número de venta por tenant | ✅ | ✅ |
| 007 | `007_precio_moneda.sql` | precio_costo_moneda / precio_venta_moneda en productos | ✅ | ✅ |
| 008 | `008_gastos.sql` | Tabla gastos con RLS | ✅ | ✅ |
| 009 | `009_actividad_log.sql` | Audit log con RLS | ✅ | ✅ |
| 010 | `010_inventario_prioridad.sql` | Prioridad en `ubicaciones` | ✅ | ✅ |
| 011 | `011_reglas_inventario.sql` | `regla_inventario` en tenants y productos | ✅ | ✅ |
| 012 | `012_ubicacion_disponible_surtido.sql` | `disponible_surtido` en ubicaciones | ✅ | ✅ |
| 013 | `013_aging_profiles.sql` | Aging profiles + reglas + `process_aging_profiles()` | ✅ | ✅ |
| 014 | `014_rrhh_empleados.sql` | RRHH Phase 1: empleados, puestos, departamentos + `is_rrhh()` | ✅ | ✅ |
| 015 | `015_margen_objetivo.sql` | `productos.margen_objetivo DECIMAL(5,2)` nullable | ✅ | ✅ |
| 016 | `016_combos_descuento_tipo.sql` | `combos.descuento_tipo TEXT` + `descuento_monto DECIMAL(12,2)` | ✅ | ✅ |
| 017 | `017_rrhh_nomina.sql` | RRHH Phase 2A: rrhh_conceptos + rrhh_salarios + rrhh_salario_items + pagar_nomina_empleado() | ✅ | ✅ |
| 018 | `018_rrhh_vacaciones.sql` | RRHH Phase 2B: rrhh_vacaciones_solicitud + rrhh_vacaciones_saldo + aprobar/rechazar_vacacion() | ✅ | ✅ |
| 019 | `019_rrhh_asistencia.sql` | RRHH Phase 3A: rrhh_asistencia (presente/ausente/tardanza/licencia) | ✅ | ✅ |
| 020 | `020_marketplace.sql` | Marketplace: campos en productos + tenants (marketplace_activo, webhook_url) | ✅ | ✅ |
| 021 | `021_movimientos_limite.sql` | Revenue: addon_movimientos en tenants (límite movimientos por plan) | ✅ | ✅ |
| 022 | `022_rrhh_nombre_documentos.sql` | RRHH Phase 2C+4A: nombre+apellido en empleados · rrhh_documentos · Storage bucket empleados | ✅ | ✅ |
| 023 | `023_rrhh_capacitaciones.sql` | RRHH Phase 4B: rrhh_capacitaciones (nombre, fechas, horas, proveedor, estado, certificado_path) | ✅ | ✅ |
| 024 | `024_supervisor_rls.sql` | RRHH Phase 5: get_supervisor_team_ids() + RLS SUPERVISOR en asistencia/vacaciones/empleados | ✅ | ✅ |
| 025 | `025_sucursales.sql` | Multi-sucursal: tabla sucursales + sucursal_id nullable en inventario_lineas/movimientos_stock/ventas/caja_sesiones/gastos/clientes | ✅ | ✅ |
| 026 | `026_nomina_medio_pago.sql` | RRHH Nómina: medio_pago en rrhh_salarios + pagar_nomina_empleado con check saldo caja + p_medio_pago | ✅ | ✅ |
| 027 | `027_storage_productos_security.sql` | Security: policy DELETE bucket productos con validación tenant_id en path · file_size_limit 5 MB · allowed_mime_types jpeg/png/webp | ✅ | ✅ |
| 028 | `028_clientes_dni.sql` | Clientes: columna `dni TEXT` + UNIQUE(tenant_id, dni) WHERE dni IS NOT NULL | ✅ | ✅ |
| 029 | `029_ventas_monto_pagado.sql` | Ventas: `monto_pagado DECIMAL(12,2) DEFAULT 0` para pago parcial en reservas | ✅ | ✅ |
| 030 | `030_devoluciones.sql` | Devoluciones: `es_devolucion` en ubicaciones/estados_inventario + tablas `devoluciones` + `devolucion_items` con RLS | ✅ | ✅ |
| 031 | `031_producto_estructuras.sql` | WMS Fase 1: tabla `producto_estructuras` (niveles unidad/caja/pallet con peso y dimensiones) + partial unique index default | ✅ | ✅ |
| 032 | `032_ubicaciones_dimensiones.sql` | WMS Fase 2: `tipo_ubicacion` + dimensiones físicas (`alto_cm`, `ancho_cm`, `largo_cm`, `peso_max_kg`, `capacidad_pallets`) en `ubicaciones` | ✅ | ✅ |
| 033 | `033_inventario_lineas_notas.sql` | Fix: `notas TEXT` nullable en `inventario_lineas` (usada por devoluciones al crear línea en ubicación DEV) | ✅ | ✅ |
| 034 | `034_caja_traspasos.sql` | Traspasos entre cajas: `es_caja_fuerte` en `cajas` + tabla `caja_traspasos` con RLS | ✅ | ✅ |
| 035 | `035_users_avatar.sql` | Perfil: `users.avatar_url TEXT` + bucket `avatares` (public, 2 MB) con policies por usuario | ✅ | ✅ |
| 036 | `036_rrhh_feriados.sql` | RRHH: tabla `rrhh_feriados` (nacional/provincial/personalizado/no_laborable) con RLS + índice por tenant+fecha | ✅ | ✅ |
| 037 | `037_roles_custom.sql` | Roles parametrizables: tabla `roles_custom` (nombre, permisos JSONB, activo) + `users.rol_custom_id` FK | ✅ | ✅ |
| 038 | `038_movimientos_links.sql` | Trazabilidad: `venta_id` + `gasto_id` FK en `movimientos_stock` con ON DELETE SET NULL | ✅ | ✅ |
| 039 | `039_caja_arqueos.sql` | Arqueos: tabla `caja_arqueos` (saldo_calculado, saldo_real, diferencia GENERATED STORED, notas) con RLS | ✅ | ✅ |
| 040 | `040_kits.sql` | KITs/Kitting WMS Fase 2.5: `kit_recetas` + `kitting_log` + `productos.es_kit` + tipo `kitting` en movimientos_stock | ✅ | ✅ |

### NUNCA
- ❌ Modificar tablas directamente en PROD sin pasar por DEV primero
- ❌ ALTER TABLE fuera de un archivo de migration
- ❌ Reescribir una migration que ya está aplicada en PROD (crear una nueva en su lugar)

---

## Configurar ambiente DEV (una sola vez)

1. Crear proyecto en supabase.com/dashboard → aplicar `supabase/schema_full.sql`
2. Crear bucket `productos` vía API (no se puede con SQL)
3. Agregar variables DEV en Vercel con scope **Preview**; variables PROD con scope **Production**
4. En Supabase DEV → Authentication → Users → crear usuario de prueba

---

## Releases y versioning

SemVer pre-launch: `v0.X.Y` · PATCH = bugfix · MINOR = feature · sin MAJOR hasta lanzamiento.

| Versión | Descripción | Fecha |
|---------|-------------|-------|
| ≤v0.56.0 | v0.12–v0.56: búsquedas, combos, gastos, RRHH phases 1–5, marketplace, multi-sucursal, tests E2E, scanner, devoluciones, LPNs, dark mode completo, pagos MP, etc. Ver git log para detalle completo. | 2026-03/04 |
| v0.57.0 ✅ | Grupo 3: maestro de estructura de producto (migration 031) — tabla producto_estructuras, CRUD en tab Estructura, resumen default en panel expandible · Grupo 4: ingreso/rebaje masivo multi-SKU (MasivoModal, auto-FIFO para rebaje, serializado con textarea series) · Fixes pre-deploy: bug modificarReserva+series, series reservadas tachadas, Dashboard alertas=badge, "Total productos activos"+inactivos, Caja selector abierta, Ventas tabs underline, Header botón Ayuda | 2026-04 |
| v0.58.0 ✅ | Devoluciones (migration 030): es_devolucion en ubicaciones+estados_inventario, tablas devoluciones+devolucion_items · ConfigPage: toggle ubicación DEV + selector estado DEV · VentasPage: botón Devolver (despachada/facturada), modal ítems/series/motivo/medio, lógica procesarDevolucion (reactiva series / nueva linea no-serial + movimiento ingreso), egreso caja efectivo, NC automática si facturada, comprobante imprimible, sección devoluciones previas colapsable | 2026-04 |
| v0.59.0 ✅ | WMS Fase 2 (migration 032): tipo_ubicacion + dimensiones físicas (alto/ancho/largo/peso_max/capacidad_pallets) en ubicaciones · ConfigPage: sección colapsable "Dimensiones WMS" en edición, badge tipo + medidas en lista · Fix APP_VERSION v0.58.0 omitido | 2026-04 |
| v0.59.1 ✅ | Fix devoluciones (migration 033): notas TEXT en inventario_lineas — columna faltante que bloqueaba confirmar devolución de no serializado | 2026-04 |
| v0.59.2 ✅ | Fixes devoluciones: estado 'devuelta' automático cuando totalDevuelto >= venta.total (badge naranja, botón Devolver oculto) · rollback manual si falla post-INSERT header (evita registros huérfanos) | 2026-04 |
| v0.60.0 ✅ | Mobile: maximum-scale=1 + overflow-x hidden · Inventario/LPNs tabla responsive (overflow-x-auto min-w-640) · Sidebar: Inventario→Boxes, RRHH→Briefcase, Usuarios→Shield · Caja: quita botón Egreso · SuscripcionPage: bg-white/10 (Plan Básico legible) · useAlertas badge alineado con totalAlertas (4 categorías) | 2026-04 |
| v0.61.0 ✅ | Ventas: "Despachada"→"Finalizada" · motivo cancelación bloque rojo · bloqueo producto sin precio · Caja: cierre monto obligatorio · ESC modal anidado fix · caja default por usuario (localStorage) · badges cajitas visuales | 2026-04 |
| v0.62.0 ✅ | RRHH bug fix (joins en UPDATE) · SKU auto secuencial (SKU-XXXXX) · Clientes→link venta · Historial→modal detalle · Inventario bloqueo LPNs/series con reservas · Traspasos entre cajas (migration 034) · LPN multi-fuente en carrito (sort+reservas) · 141/141 tests | 2026-04 |
| v0.63.0 ✅ | Mi Cuenta (/mi-cuenta): avatar upload+Google, plan, cambiar contraseña, salir/eliminar · Restricciones menú por rol (RRHH→solo RRHH, CAJERO→Ventas+Caja+Clientes) · Sueldo sugerido al crear empleado · Sidebar: bloque perfil circular bajo logo · Header: sin usuario/rol/negocio · SuscripcionPage: fix ícono light mode + flecha volver + auto-redirect post-pago MP · Migrations 034+035 PROD | 2026-04 |
| v0.64.0 ✅ | Custom roles (permisos_custom sidebar + redirect) · Movimientos→link venta origen (migration 038) · Ticket cierre caja PDF auto-download · Arqueo parcial sin cerrar sesión (migration 039) · Marketplace toggle UI en ConfigPage · Fix useRecomendaciones link · E2E tests CAJERO + coherencia números · Migrations 036–039 PROD | 2026-04 |
| v0.65.0 ✅ | E2E tests rol SUPERVISOR · Fix sync multi-dispositivo caja (refetchInterval 30s + windowFocus) · KITs/Kitting WMS Fase 2.5: kit_recetas + kitting_log + tab Kits en InventarioPage · Toggle es_kit en ProductoFormPage · Migration 040 PROD | 2026-04 |
| v0.66.0 ✅ | E2E tests rol RRHH (18 tests) · Fix /mi-cuenta accesible para CAJERO+RRHH · Redirect SUPERVISOR en rutas ownerOnly (SUPERVISOR_FORBIDDEN) · playwright.config.ts proyectos RRHH · tests.yml E2E_RRHH_* secrets | 2026-04 |
| v0.67.0 ✅ | Sesión expiry por inactividad (5/15/30min/1h/nunca — ConfigPage Negocio · useInactivityTimeout · migration 041) · RRHH feriados AR 2026 bulk-load + widget en Dashboard · Desarmado inverso KITs (modal + validación stock · des_kitting · kitting_log.tipo) · Badge KIT en búsqueda VentasPage | 2026-04 |
| v0.68.0 ✅ | IVA por producto (alicuota_iva 0/10.5/21/27% · histórico en venta_items · desglose por tasa en checkout · migration 042) · Biblioteca de Archivos (archivos_biblioteca + bucket) · Certificados AFIP (tenant_certificates + bucket certificados-afip · ConfigPage Negocio · src/lib/afip.ts · migration 043) · UX fixes: precio read-only carrito · reorden checkout · tab default Inventario · motivo Ventas es_sistema · h1 Dashboard = tenant.nombre · alertas no resolvibles si stock sigue bajo · "Presupuesto" · DS Sprint 1: tokens · DS Sprint 2: Header+Sidebar rediseño (bg-surface, AvatarDropdown, AyudaModal, NotificacionesButton, RefreshButton, ConfigButton, PlanProgressBar) · DS fixes: sidebar sin perfil/MiPlan · CotizacionWidget light mode · sin bordes tarjetas Dashboard/Métricas/Rentabilidad/Recomendaciones · dark mode insight cards · Logo→landing page · sin "Todas las sucursales" · barras accent uniforme · divisores Detalle por venta visibles | 2026-04 |
| v0.69.0 ✅ | DS Sprint 3 — Dashboard tab General rediseño completo: 4 KPIs (Ingreso Neto caja, Margen Contribución, Burn Rate diario, Posición IVA) · FilterBar período/ARS-USD/IVA · La Balanza AreaChart ventas vs gastos · El Mix de Caja Donut por método de pago · Insights automáticos grid InsightCard · Tabla Fugas y Movimientos top 8 · 5 componentes nuevos: KPICard, FilterBar, InsightCard, VentasVsGastosChart, MixCajaChart · badges comparativas vs período anterior · dark mode + DS tokens | 2026-04 |
| v0.70.0 ✅ | Header reorden [Sucursal][Refresh][Notif][Dark/Light][Ayuda][Config][Avatar] · ConfigButton ícono rueda (Settings) · AvatarDropdown "Gestionar cuentas": localStorage genesis360_saved_accounts · cuenta activa con ✓ · cambio de cuenta vía signOut+navigate · "+ Agregar otra cuenta" | 2026-04 |
| v0.71.0 ✅ | Seña en caja: ingreso_reserva al crear reserva con efectivo · no-duplicado al despachar (query por concepto) · egreso_devolucion_sena al cancelar · CajaPage saldo/colores actualizados · pagar_nomina_empleado con nuevos tipos (migration 044) · 7 unit tests nuevos (148 total) | 2026-04 |
| v0.72.0 ✅ | Roles CONTADOR+DEPOSITO + routing AppLayout · Inventario vista Por Ubicación · Clonar KIT modal · Compresión imagen >2MB · FilterBar Custom date range · GastosPage -Sueldos · Métodos de pago ConfigPage+MixCajaChart (migration 045) | 2026-04 |
| v0.73.0 | Fix sucursal filter (OR NULL para datos previos a multi-sucursal) · Post-venta vuelve a Nueva Venta · Caja polling 10s · CAJERO puede abrir 1 caja (no más de 1 propia simultánea) · Cierre caja: labels efectivo + traspasos en saldo · Movimientos sesión: tipo/medio/ticket/hora/totales por método | 2026-04 |
| v0.74.0 | DS Sprint 4: VentasPage checkout — bg-surface, border-border-ds, text-primary, text-muted, font-mono en precios; modales y historial con tokens DS | 2026-04 |
| v0.74.1 ✅ | Fix: pagos no-efectivo (tarjeta/MP/etc.) ahora se registran en caja_movimientos como ingreso_informativo/egreso_informativo en ventas, reservas y gastos | 2026-04 |
| v0.74.2 | Fix: revertir font-mono de VentasPage e InventarioPage · estado LPN read-only (badge) · botón acciones habilitado con reservas · LpnAccionesModal solo muestra tab Mover cuando hay reservas | 2026-04 |
| v0.75.0 ✅ | InventarioPage: 5 tabs underline (Inventario · Agregar stock · Quitar stock · Historial · Kits) · VentasPage: LPN picker fix (incluye líneas sin ubicación) · GastosPage: IVA deducible + comprobantes adjuntos (Storage) + tab Gastos fijos con CRUD, toggle activo, total estimado, botón "Generar hoy" · migrations 047+048 PROD ✅ | 2026-04 |
| v0.76.0 ✅ | ProveedoresPage nueva (/proveedores): CRUD extendido (CUIT, razón social, condición IVA, plazo pago, banco/CBU, domicilio) + toggle activo · Órdenes de Compra (lifecycle borrador→enviada→confirmada/cancelada + ítems dinámicos + detalle) · migration 049 PROD ✅ · ConfigPage: tab Proveedores migrada | 2026-04 |
| v0.77.0 ✅ | BibliotecaPage nueva (/biblioteca): upload, tipos con colores (Cert. AFIP/Contrato/Factura/Manual/Otro), búsqueda+filtro tipo, descarga signed URL 300s · ConfigPage: tab Biblioteca migrada · sin migration (tabla+bucket desde v0.68.0) | 2026-04 |
| v0.78.0 ✅ | InventarioPage: fix filtro __sin__ · búsqueda LPN client-side · acciones LPN vista ubicación · scroll oculto · LPN único por tenant · orden Sin Ubicación primero+A-Z · fix race condition filtros (lineasLoading) · ImportarInventarioPage nueva (/inventario/importar) · ImportarProductosPage: tab inventario eliminada | 2026-04 |
| v0.79.0 ✅ | ImportarProductosPage: template actualizado a 22 columnas — agrega alicuota_iva, margen_objetivo, tiene_series, tiene_lote, tiene_vencimiento, regla_inventario, es_kit, estr_unidades_por_caja, estr_cajas_por_pallet, estr_peso_unidad · crea/actualiza producto_estructuras si hay campos estr_* · hoja Referencia actualizada | 2026-04 |
| v0.80.0 ✅ | VentasPage: fix scanner duplicados (pendingAddRef) · historial paginado limit 50 + "Cargar más" · carrito pre-guardado localStorage (restaura al entrar, limpia al vender) · banner caja cerrada visible arriba · scroll independiente lista ítems carrito (max-h-[45vh]) | 2026-04 |
| v0.81.0 ✅ | Fix: carrito draft (efecto restore antes que save, cartDraftKey omitido de deps) · Fix: scanner cola secuencial (scanQueueRef procesa de a uno, elimina duplicados por concurrencia) · Cantidades decimales en carrito para KG/L/m3/g/ml/m/m2/cm/mm (UNIDADES_DECIMALES, step/min dinámico, parseFloat) | 2026-04 |
| v0.82.0 ✅ | InventarioPage: series overflow → 5 chips + "+N más" modal completo · LpnQR.tsx: QR de LPN en LpnAccionesModal (generar/descargar/imprimir) · Masivo Agregar Stock: vista inline grilla (scanner + tabla SKU/Cant/Estado/Ubic/extras acordeón) con cola secuencial de scans y Enter para siguiente SKU · Iconos ingreso/rebaje: ArrowDown/Up → Plus/Minus · Botón ASN → /recepciones (módulo futuro) | 2026-04 |
| v0.83.0 ✅ | Tab Conteo en InventarioPage: por ubicación o por producto, tabla diferencias esperado/contado, guardar borrador o finalizar + ajustes automáticos (ajuste_ingreso/ajuste_rebaje), historial expandible · Tab Estructura en LpnAccionesModal: asignar/cambiar estructura del LPN (selector con dimensiones) · Migration 050 PROD ✅ | 2026-04 |
| v0.84.0 ✅ | Sprint A inventario: I-03 LPN vencidos (bloqueo ventas + alerta + badge) · I-06 Mover LPN a otra sucursal · I-08 Over-receipt configurable (tenants.permite_over_receipt) · Migration 051 PROD ✅ | 2026-04 |
| v0.85.0 ✅ | Sprint B inventario: I-04 stock_minimo por sucursal (producto_stock_minimo_sucursal) · I-05 Mono-SKU en ubicaciones (ubicaciones.mono_sku) · I-09 En Armado kitting (kitting_log.estado + componentes_reservados) · fix security_invoker view · Migrations 052+053 PROD ✅ | 2026-04 |
| v0.85.1–v0.85.3 ✅ | VentasPage fixes: ticket scrollable, ESC prioridad, cantidad decimal punto/coma, descuento cambio tipo, stock guard, venta sin líneas imposible, batch inserts · Fix margen strip IVA en ProductoFormPage+MetricasPage+DashboardPage+useRecomendaciones · Migration 054 venta_items.cantidad DECIMAL PROD ✅ | 2026-04 |
| v0.86.0 ✅ | Sprint C inventario: Tab Autorizaciones DEPOSITO — DEPOSITO solicita, OWNER/SUPERVISOR aprueba/rechaza · Fix historial conteo y ajuste LPN · Filtros historial (fecha/cat/tipo/motivo) · Reorden tabs · Migrations 055+056 PROD ✅ | 2026-04 |
| v0.87.0 ✅ | Sprint D inventario: Combinar LPNs + LPN Madre — checkboxes, barra flotante, modal Fusionar (transfiere stock) + LPN Madre (parent_lpn_id sin mover stock) · Fix users.rol CHECK (RRHH/DEPOSITO/CONTADOR) · Migrations 057+058 PROD ✅ | 2026-04 |
| v0.88.0 ✅ | Módulo Recepciones (/recepciones): lista + form + confirmar contra OC · Botón "Recibir mercadería" en OC confirmadas · Genera inventario_lineas + movimientos_stock · Estados OC recibida_parcial/recibida · ImportarProductosPage: campo notas (col W) · ProductosPage: barcode mobile, SKU uniqueness, foto compresión, botón OC rápida · Migration 059 PROD ✅ | 2026-04 |
| v0.89.0 ✅ | Integraciones OAuth: tab Integraciones en ConfigPage · TiendaNube OAuth (EF tn-oauth-callback, token permanente) · MercadoPago OAuth (EF mp-oauth-callback, IPN notifications) · Fase 0 schema (pgcrypto + columnas ventas/clientes + integration_job_queue + ventas_externas_logs) · Migrations 060+061 PROD ✅ · PR #65 | 2026-04 |
| v0.90.0 ✅ | TiendaNube webhook (EF tn-webhook: order/created→pendiente / order/paid→reservada) · Sync stock TN (EF tn-stock-worker + trigger migration 062 + GitHub Actions cron 5min) · UI mapeo productos (ConfigPage→Integraciones) · MP IPN pagos regulares (EF mp-ipn + mp-webhook enrutado por seller_id) · Monitoring diario email 9AM AR (EF monitoring-check PROD + RESEND_API_KEY) · Docs soporte TiendaNube (docs/soporte_tiendanube.html) · PR #66 | 2026-04 |
| v0.91.0–v0.99.0 ✅ | MercadoLibre integración completa (meli-oauth-callback, meli-webhook, meli-stock-worker, meli-search-items) · Estados inventario permisos por canal (es_disponible_tn/meli/venta) · Ubicaciones flags disponible_tn/meli · Tab Canales en VentasPage · Sync manual TN+ML · Auto-complete mapeo por SKU · MP QR pagos (EF mp-crear-link-pago + polling) · AppLayout toast pagos MP · Migrations 063–066 PROD ✅ | 2026-04 |
| v1.0.0 ✅ | Stock reservation TN/ML al recibir orden · pg_cron 5min para sync stock (DEV+PROD) · Fix race condition duplicados TN · Fix order/cancelled libera reserva | 2026-04 |
| v1.1.0 ✅ | Importar maestros extendido (8 tipos) · ConfigPage días validez presupuesto · Ticket badge PRESUPUESTO · Historial desglose IVA por tasa real · Historial paginación selector 20/50/75/100 · Caja apertura sugiere monto cierre anterior · Onboarding default regla=Manual · Combos: quita descuento al bajar cantidad · VentasPage refetchOnMount sesiones caja · Migration 067 PROD ✅ | 2026-04 |
| v1.2.0 ✅ | WhatsApp Click-to-Chat (lib/whatsapp.ts + EnviosPage + Config plantilla) · Módulo Envíos completo (EnviosPage /envios, remito PDF, estados, cotizador shell, bloqueo entregado) · Domicilios clientes (migration 074) · Presupuestos servicios: edit/delete, estados, aprobar→crear gasto · GastosPage overhaul (IVA deducible, comprobantes, gastos fijos, múltiples medios) · Migrations 072–075 PROD ✅ | 2026-04 |
| v1.3.0 ✅ | Módulo Facturación AFIP (FacturacionPage 4 tabs, EF emitir-factura, puntos_venta_afip, config fiscal, IVA por tasa) · Clientes mejoras (notas, fecha_nacimiento, etiquetas, codigo_fiscal, domicilios tab) · Proveedores/Servicios (proveedor_productos, servicio_items, presupuestos) · Fix crítico trigger stock_actual (INSERT OR UPDATE OR DELETE) · Stale-time 0 global · Migrations 076–082 PROD ✅ · PR #96 | 2026-05 |
| v1.4.0 ✅ | Cuenta Corriente (migration 083): tab CC en ClientesPage con KPIs+deuda+WA · VentasPage modo CC (bypasa pago/caja) · Presupuesto vencido (badge+banner+botón actualizar precios) · Bulk actions ProductosPage · Modal clientes scroll fix + validación DNI/teléfono · TN stock worker reescrito (BATCH_SIZE=200 CONCURRENCY=20 pre-fetch) · fn_tn_sync_heartbeat encola proactivamente · PROD ✅ | 2026-05 |
| v1.5.0 ✅ | Notificaciones reales (tabla notificaciones + NotificacionesButton reescrito) · Caja: diferencia apertura inline + confirmación 2-paso + notificación OWNER/SUPERVISOR vía campana+email · getTipoDisplay Ingreso Manual vs Venta · Tab Caja Fuerte (historial depósitos, roles configurables) · Tab Configuración OWNER/SUPERVISOR (soft delete cajas, roles) · Historial sesiones diferencia apertura y cierre separados · CC pago inline FIFO · PDF Factura QR AFIP (RG 4291) en FacturacionPage+VentasPage · send-email tipo notificacion · Migration 084 PROD ✅ · PR #97 | 2026-05 |
| v1.6.0 ✅ | OC gestión de pagos (estado_pago + monto_pagado + fecha_vencimiento_pago en ordenes_compra) · Tab 'Órdenes de Compra' en GastosPage: lista filtrable, modal pago/CC con egreso automático a caja · Bloqueo confirmar OC si estado_pago='pendiente_pago' en ProveedoresPage · Modal CC proveedor: saldo adeudado, historial movimientos, pago inline con egreso a caja · AlertasPage + useAlertas: secciones OC vencidas (rojo) y próximas a vencer ≤3d (ámbar) · tabla proveedor_cc_movimientos + fn_saldo_proveedor_cc · Migration 085 PROD ✅ · PR #98 | 2026-05 |
| v1.6.1 ✅ | Sentry integrado (@sentry/react — errores, performance, replays) · Security hardening: 80→7 warnings Supabase Advisor (REVOKE FROM PUBLIC + SET search_path + buckets authenticated) · OC: cantidad respeta unidad_medida (esDecimal) + descargar PDF/CSV · npm audit: 21→7 vulnerabilidades · Migrations 086+086b PROD ✅ · PR #102 | 2026-05 | OC gestión de pagos (estado_pago + monto_pagado + fecha_vencimiento_pago en ordenes_compra) · Tab 'Órdenes de Compra' en GastosPage: lista filtrable, modal pago/CC con egreso automático a caja · Bloqueo confirmar OC si estado_pago='pendiente_pago' en ProveedoresPage · Modal CC proveedor: saldo adeudado, historial movimientos, pago inline con egreso a caja · AlertasPage + useAlertas: secciones OC vencidas (rojo) y próximas a vencer ≤3d (ámbar) · tabla proveedor_cc_movimientos + fn_saldo_proveedor_cc · Migration 085 PROD ✅ · PR #98 | 2026-05 |

---

## Estructura de branches

```
main   ← producción (solo merges desde dev via PR)
dev    ← desarrollo activo
fix/x  ← hotfixes urgentes
```
