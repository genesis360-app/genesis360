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
| v0.12.0 | Búsquedas, config, movimientos, descuentos en ventas | 2026-03 |
| v0.13.0 | Combos, separar unidades, vuelto al Enter | 2026-03 |
| v0.14.0 | Emails transaccionales (Resend) | 2026-03 |
| v0.15.0 | Crear producto desde foto (Claude Vision + Open Food Facts) | 2026-03 |
| v0.16.0 | Branding centralizado + rebrand | 2026-03 |
| v0.17.0 | Export/Import data master + moneda en Excel | 2026-03 |
| v0.18.0 | Módulo de gastos del negocio | 2026-03 |
| v0.19.0 | Tab inventario en importar + reorden menú + clientes mejorado | 2026-03 |
| v0.20.0 | Fix bucket storage + fix fecha import + botones unificados | 2026-03 |
| v0.21.0 | MP producción con external_reference + webhook | 2026-03 |
| v0.22.0 | Historial de actividad (audit log) | 2026-03 |
| v0.23.0 | Walkthrough interactivo 11 slides | 2026-03 |
| v0.24.0 | Keyboard shortcuts + fix historial caja + dot live caja | 2026-03 |
| v0.25.0 | Prioridad ubicaciones + FIFO/FEFO/LEFO/LIFO/Manual + disponible_surtido + aging profiles | 2026-03 |
| v0.26.0 | RRHH Phase 1: empleados, puestos, departamentos, cumpleaños + rol RRHH | 2026-03 |
| v0.27.0 | Integración caja ↔ ventas ↔ gastos (efectivo auto-registra en caja_movimientos) | 2026-03 |
| v0.28.0 | Dashboard: sin movimiento expandable + sugerencia pedido · Métricas: ganancia neta + rango custom + filtro categoría | 2026-03 |
| v0.29.0 | Trazabilidad LPN→venta (linea_id en venta_items) · LPN en carrito · Vista galería ventas · Margen objetivo por SKU · Insights margen + Métricas inventario | 2026-03 |
| v0.30.0 | Fix importar serializados · Proyección cobertura stock · LPN en ticket · Motivos caja · Invitación por email (EF invite-user) · Importación masiva clientes · Combos multi-tipo · Sidebar colapsable · useModalKeyboard wiring · Caja ingresos informativos | 2026-03 (incluido en v0.31.0) |
| v0.31.0 | Header universal (user/rol + dark mode + ayuda + logout) · Dashboard: Stock Crítico→Alertas + links métricas con setTab · Ventas: imagen en lista + galería mejorada + buscador series · Caja: bloqueo egreso > saldo · Gastos: bloqueo si caja cerrada · Movimientos UX (búsqueda, UoM, motivos, trazabilidad) · Reportes: stock con lote/vencimiento/series + medio_pago parseado + estados fix | 2026-03 |
| v0.32.0 | Dark mode completo (31 archivos + global CSS) · RRHH Phase 2A Nómina (conceptos, liquidaciones, pagar→caja, trigger neto) | 2026-03 (incluido en v0.33.0) |
| v0.33.0 | RRHH Phase 2B Vacaciones (solicitudes + saldos + aprobar/rechazar) · RRHH Phase 3A Asistencia (presente/ausente/tardanza/licencia) | 2026-03 |
| v0.34.0 | RRHH Phase 3B Dashboard (KPIs empleados/asistencia/vacaciones/nómina · breakdown depts · exportar Excel) | 2026-03 (en dev) |
| v0.35.0 | Marketplace: EF marketplace-api (pública) + EF marketplace-webhook · UI publicar productos + precio/stock/descripción marketplace · migration 020 | 2026-03 |
| v0.36.0 | Revenue: límite movimientos por plan (Free=200 · Básico=2.000 · Pro=∞) · banner uso en MovimientosPage · bloqueo al alcanzar límite · add-ons +500 movs en SuscripcionPage · migration 021 | 2026-03 |
| v0.37.0 | Matriz de funcionalidades por plan: FEATURES_POR_PLAN · UpgradePrompt · candados sidebar · bloqueo Básico+ (Reportes/Historial/Métricas) · bloqueo Pro+ (Importar/RRHH) | 2026-03 |
| v0.38.0 | RRHH Phase 2C+4A: nombre+apellido empleados · EF birthday-notifications · GH Actions cron · rrhh_documentos + Storage bucket empleados · tab Documentos · trial=Pro completo · migration 022 | 2026-03 |
| v0.39.0 | RRHH Phase 4B+5: Capacitaciones (rrhh_capacitaciones + tab Capacitaciones + cert upload) · Supervisor Self-Service (tab Mi Equipo, KPIs, aprobar vacaciones) · Árbol Organizacional · migrations 023+024 | 2026-03 |
| v0.40.0 | Add-on movimientos con pago automático MP: EF mp-addon + mp-webhook actualizado · secrets PROD configurados · webhook MP registrado | 2026-03 |
| v0.41.0 | Insights automáticos (11 reglas en useRecomendaciones + tab Insights en Dashboard con score de salud) · fix acceso a Mi Plan en sidebar · infraestructura de tests (Playwright E2E + Vitest unit, 49 tests) | 2026-03 |
| v0.42.0 | Multi-sucursal: migration 025 · tabla sucursales · SucursalesPage (OWNER) · SucursalSelector en header · useSucursalFilter · filtro en Inventario/Movimientos/Ventas/Caja/Gastos/Clientes | 2026-03 |
| v0.43.0 | Fix check_stock_minimo SECURITY DEFINER · Ventas filtro categoría · Alertas sin categoría · Dark mode CajaPage · RRHH nómina: medio_pago + check saldo + historial sueldos (migration 026) | 2026-03 |
| v0.44.0 | Caja multi-usuario (quién abrió, warning sesión ajena, bloqueo cerrar CAJERO) · Reportes breakdown ingresos por método de pago · Usuarios: filtros por rol, descripción, fecha alta, matriz de permisos | 2026-03 |
| v0.44.1 | Migración a genesis360.pro: nuevo dominio + org GitHub genesis360-app · .gitignore completo + .env.local removido del tracking · rotación de todas las API keys (MP, Resend, Supabase AT, GH) · referencias stokio.com → genesis360.pro en Edge Functions | 2026-03 |
| v0.45.0 | Rebrand completo Stokio → Genesis360 en todo el codebase (index.html, package.json, EFs, templates email, schema, docs) · Header UX: muestra sucursal activa (o tenant) en lugar del nombre de marca | 2026-03 |
| v0.46.0 | Tests E2E funcionales (49/49 passing) · fix ventas sin caja (bloqueo independiente del medio de pago) · multi-dominio: app.genesis360.pro→login / www.genesis360.pro→landing | 2026-03 |
| v0.47.0 | Fix scanner cámara mobile (html5-qrcode) · versión en sidebar · MP planes creados + checkout directo sin Edge Function · MP_PLAN_IDS en brand.ts · mp-webhook PROD | 2026-03 |
| v0.48.0 | Dark mode: badge alertas visible (bg-red-500) · text-primary legible en dark (.dark .text-primary global CSS) · docs reglas de negocio módulo Caja | 2026-03 |
| v0.49.0 | Banner DEV/PROD · header mobile fix (superposición) · CajaPage colores apertura/saldo en light mode · redirect /→/dashboard y /login→/dashboard si hay sesión | 2026-03 |
| v0.50.0 | Fix ventas: medio de pago obligatorio para reservada/despachada · test unitario ventasValidation (12 casos) · refactor validarMediosPago a lib compartida | 2026-03 |
| v0.51.0 | Scanner reescritura completa (BarcodeDetector + zbar-wasm) · scanner en Movimientos/Nuevo Producto · 2 fotos en Completar desde foto · scan-product sin JWT · búsqueda por codigo_barras | 2026-03 |
| v0.51.1 | Security: policy DELETE bucket productos con validación de tenant · file_size_limit 5 MB · allowed_mime_types jpeg/png/webp (migration 027) | 2026-03 |
| v0.52.0 | DNI obligatorio en clientes (migration 028) · bloqueo pendiente/reservada sin cliente · registro inline desde venta · fix cambiarEstado valida caja | 2026-03 |
| v0.52.1 | Pago parcial en reservas (migration 029) · modal saldo al despachar · reserva permite monto parcial · validarDespacho en mutationFn | 2026-04 |
| v0.53.0 | Ventas: vuelto al cliente · pendiente sin cobro · combos automáticos · editar monto reserva · modificar productos reserva · badge saldo historial · fix caja despacho registra efectivo completo | 2026-04 |
| v0.53.1 | Tests: calcularVuelto · calcularEfectivoCaja · calcularComboRows · restaurarMediosPago (111/111) · fix bug vuelto en tarjeta · refactor funciones puras a ventasValidation.ts | 2026-04 |
| v0.54.0 | Fix bug medio de pago sin tipo (mixto cierra venta) · Dashboard deuda pendiente · Alertas clientes con deuda + link ficha · Alertas link directo a venta (/ventas?id=) · VentasPage/ClientesPage apertura directa por URL params (114/114 tests) | 2026-04 |
| v0.55.0 ✅ | UX Group 1: onWheel blur inputs numéricos · tooltips icon-only · VentasPage carrito sticky + tab label · Sidebar reorden + consolida Rentabilidad/Recomendaciones en Dashboard · ConfigPage layout full-width con sidebar lateral desktop | 2026-04 |
| v0.56.0 ✅ | Grupo 2: ProductosPage (/productos, 2 tabs Productos+Estructura) · nueva InventarioPage (/inventario, 2 tabs Movimientos+LPNs) · rutas renombradas + redirects compatibilidad · referencias actualizadas en 8 archivos | 2026-04 |
| v0.57.0 ✅ | Grupo 3: maestro de estructura de producto (migration 031) — tabla producto_estructuras, CRUD en tab Estructura, resumen default en panel expandible · Grupo 4: ingreso/rebaje masivo multi-SKU (MasivoModal, auto-FIFO para rebaje, serializado con textarea series) · Fixes pre-deploy: bug modificarReserva+series, series reservadas tachadas, Dashboard alertas=badge, "Total productos activos"+inactivos, Caja selector abierta, Ventas tabs underline, Header botón Ayuda | 2026-04 |
| v0.58.0 ✅ | Devoluciones (migration 030): es_devolucion en ubicaciones+estados_inventario, tablas devoluciones+devolucion_items · ConfigPage: toggle ubicación DEV + selector estado DEV · VentasPage: botón Devolver (despachada/facturada), modal ítems/series/motivo/medio, lógica procesarDevolucion (reactiva series / nueva linea no-serial + movimiento ingreso), egreso caja efectivo, NC automática si facturada, comprobante imprimible, sección devoluciones previas colapsable | 2026-04 |
| v0.59.0 ✅ | WMS Fase 2 (migration 032): tipo_ubicacion + dimensiones físicas (alto/ancho/largo/peso_max/capacidad_pallets) en ubicaciones · ConfigPage: sección colapsable "Dimensiones WMS" en edición, badge tipo + medidas en lista · Fix APP_VERSION v0.58.0 omitido | 2026-04 |

---

## Estructura de branches

```
main   ← producción (solo merges desde dev via PR)
dev    ← desarrollo activo
fix/x  ← hotfixes urgentes
```
