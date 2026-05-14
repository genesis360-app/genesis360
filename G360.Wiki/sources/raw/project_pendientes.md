---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.8.19** ✅ · DEV: **v1.8.19** (en sync)

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV/PROD — v1.8.19 (deploy 2026-05-14)

- APP_VERSION: `v1.8.19` en `src/config/brand.ts` ✅
- Migrations DEV: 001–107 ✅
- Migrations PROD: 001–107 ✅ (todas aplicadas)
- Edge Functions DEV: todas activas
- Edge Functions PROD: `invite-user` ✅ · `ai-assistant` ✅ · `cancel-suscripcion` ❌ (no existe en repo)
- GROQ_API_KEY: DEV ✅ · PROD ❌ (pendiente — agregar en Supabase PROD secrets)
- VITE_GOOGLE_MAPS_API_KEY: DEV ✅ · PROD ✅ (Vercel Production)

---

## Migrations pendientes en PROD (093–107)

| # | Archivo | Descripción |
|---|---------|-------------|
| 093 | `093_ordenes_compra_sucursal.sql` | `ordenes_compra.sucursal_id` |
| 094 | `094_users_sucursal_permisos.sql` | `users.sucursal_id` + `puede_ver_todas` + índice |
| 095 | `095_oc_derivadas_reembolso.sql` | `ordenes_compra.oc_padre_id/es_derivada/tiene_reembolso_pendiente` |
| 096 | `096_oc_costo_envio_contactos_proveedor.sql` | `ordenes_compra.tiene_envio/costo_envio` + tabla `proveedor_contactos` |
| 097 | `097_gastos_recurso_cuotas.sql` | `gastos.recurso_id/es_cuota/cuotas_total/monto_cuota/tasa_interes` + tabla `gasto_cuotas` |
| 098 | `098_ventas_costo_envio.sql` | `ventas.costo_envio` |
| 099 | `099_notificaciones_metadata.sql` | `notificaciones.metadata JSONB` |
| 100 | `100_rename_owner_to_dueno.sql` | `rol='OWNER'→'DUEÑO'` + políticas RLS + `is_rrhh()` + `caja_fuerte_roles` |
| 101 | `101_ubicaciones_combos_sucursal.sql` | `ubicaciones.sucursal_id` + `combos.sucursal_id` |
| 102 | `102_recursos_recurrentes_ubicaciones.sql` | `recursos.es_recurrente/frecuencia_valor/frecuencia_unidad/proximo_vencimiento` |
| 103 | `103_autorizaciones_bulk_edit.sql` | `linea_id` nullable + tipo `bulk_edit` en `autorizaciones_inventario` |
| 104 | `104_cron_cleanup_job_queue.sql` | cron diario limpieza `integration_job_queue` (status=done, +7 días) |
| 105 | `105_tenant_sql_query.sql` | función `tenant_sql_query` — SQL Runner ReportesPage |
| 106 | `106_process_single_aging_profile.sql` | función `process_aging_profile_single` — procesar un perfil de aging |
| 107 | `107_sucursales_envio_config.sql` | `sucursales.costo_km_envio` + tabla `courier_tarifas` |

---

## Lo producido en sesión 2026-05-14 (v1.8.19-dev)

### SQL Runner (migration 105 + fix regex 106)
- `tenant_sql_query(TEXT)` — SECURITY INVOKER, solo SELECT/WITH, 500 filas, 10s timeout
- ReportesPage: editor SQL monospace con Ctrl+Enter, tabla dinámica, export Excel/PDF
- Solo visible para DUEÑO y SUPER_USUARIO
- Fix: `\b` en PG string literals no funciona → reemplazado por `([[:space:]]|$)`

### Aging profiles — procesar individualmente (migration 106)
- `process_aging_profile_single(p_profile_id)` — misma lógica que general pero filtrada
- Botón "Procesar" por perfil en ConfigPage → tab Progresión de Estados
- `processingAgingId` independiente por perfil

### Shortcuts teclado ESC/ENTER en InventarioPage
- LpnAccionesModal: ESC=cierra, ENTER=guarda (editar/mover/estructura)
- Tab Agregar Stock: ENTER=abre modal ingreso, ESC=limpia selección
- Tab Quitar Stock: ENTER=abre modal rebaje, ESC=limpia selección
- Tab Conteos: ENTER flujo 3 estados (abrir → cargar → finalizar), ESC=cancelar

### Envíos — Google Maps + tarifas (migrations 107 + env vars)
- Migration 107: `sucursales.costo_km_envio` + tabla `courier_tarifas` (por sucursal)
- SucursalesPage: dirección OBLIGATORIA, campo $/km, panel couriers con inline edit
- `useGoogleMaps.ts`: hook con `setOptions/importLibrary` API, `calcularDistanciaKm()`
- `AddressAutocompleteInput`: Places Autocomplete + dropdown domicilios del cliente
- ISS-083 (propio): dirección con autocompletado Google Maps, KM y costo auto-calculados
- ISS-098 (tercero): canal auto desde la venta (read-only), costo auto desde courier_tarifas
- Tab Cotizador: eliminado completamente
- `VITE_GOOGLE_MAPS_API_KEY`: configurada en .env.local y Vercel

---

## Para la próxima sesión — prioridades

### 1. Deploy a PROD (v1.8.19)
- [ ] PR `dev → main` con título `v1.8.19 — SQL Runner, Envíos Google Maps, Shortcuts`
- [ ] Aplicar migrations 093–107 en PROD (`jjffnbrdjchquexdfgwq`)
- [ ] Agregar `VITE_GOOGLE_MAPS_API_KEY` en Vercel Production
- [ ] Deploy EF `invite-user`, `cancel-suscripcion`, `ai-assistant` en PROD
- [ ] Configurar secret `GROQ_API_KEY` en PROD
- [ ] GitHub release v1.8.19

### 2. Reglas de negocio — relevar e implementar
- **Pendientes de relevar:** Gastos (completo), RRHH (completo), Ventas (devoluciones/límites), Clientes (deuda configurable)
- **Pendientes de implementar:** Bóveda (Caja), contraseña maestra cierre caja ajena, ticket cierre PDF, alerta diferencia cierre

### 3. Envíos — pendientes
- Probar Google Maps en DEV con la key recién configurada
- Verificar cálculo de distancia sucursal → cliente funciona end-to-end

---

## Lo producido en esta sesión (v1.8.7 → v1.8.17-dev)

### Fixes críticos operativos

**Caja — Solicitudes CAJERO a Caja Fuerte (aprobación real)**
- Bug fix: `enviarSolicitudFuerte` tenía tipo inválido, sin `user_id`, sin `titulo`
- Notifica a OWNER/SUPERVISOR/SUPER_USUARIO con `tipo: 'warning'` y `metadata` JSONB
- `NotificacionesButton`: botones "Aprobar"/"Rechazar" ejecutan egreso+ingreso reales

**Inventario — Multi-sucursal (fix LPNs sin sucursal)**
- `inventario_lineas` INSERT ahora incluye `sucursal_id`
- Selector ámbar para Dueño en vista global al agregar stock
- `LpnAccionesModal`: fix selector sucursal con `string | null`, opción "Sin sucursal" explícita

**Envíos — Selector venta**
- Selector "Nueva venta" excluye ventas ya con envío asignado

**IA Asistente — system prompt**
- Reescrito con 20 módulos, botones exactos, roles actualizados

### Dashboard General — rediseño completo

9 áreas analíticas independientes en la sub-nav de la pestaña General:
Ventas · Gastos · Productos · Inventario · Clientes · Proveedores · Facturación · Envíos · Marketing

Cada área tiene filtros propios, KPIs, gráficos e insights dinámicos.

**Componentes:** `DashVentasArea`, `DashGastosArea`, `DashProductosArea`, `DashInventarioArea`, `DashClientesArea`, `DashProveedoresArea`, `DashFacturacionArea`, `DashEnviosArea`, `DashMarketingArea`

**Tab "Gráficos"** → placeholder "Próximamente".

### Renombrar OWNER → DUEÑO (migration 100)

- DB: constraint, UPDATE users, caja_fuerte_roles, políticas RLS, `is_rrhh()`
- Frontend: 21 archivos — tipos, comparaciones, arrays, claves de objetos
- Edge Functions: `invite-user`, `ai-assistant`
- `ownerOnly` (prop interna de nav, no visible) conservada

### Sucursales — restricciones y mejoras (migration 101)

**AppLayout selector:** Solo en `/inventario`, `/productos`, `/clientes`, `/proveedores`. Solo Dueño ve "Todas las sucursales". Otros roles: nombre fijo de su sucursal (sin cambiar).

**ConfigPage Ubicaciones:** Filtran por sucursal activa + globales (`sucursal_id IS NULL`). INSERT incluye `sucursal_id`.

**ConfigPage Combos:** Mismo comportamiento que ubicaciones.

**Ingreso de stock:** Bloqueado si no hay sucursal seleccionada (simple y masivo). Mensaje claro de error.

**LPN Modal Traslado:** `cantMover` inicializa en `'1'` cuando hay ≥2 unidades → botón habilitado de inmediato.

**LPN Modal Editar:** Nuevo campo `sucursal_id` en tab Editar para reasignar el LPN completo a otra sucursal.

### Módulo Recursos — nuevas features

**Tab Ubicaciones:** muestra todos los recursos activos/pendientes agrupados por `ubicacion`. Edición inline del campo ubicación (lápiz → input → Enter/Escape). Banner de alerta si hay recurrentes vencidos o próximos.

**Recursos recurrentes:** checkbox "Recurso recurrente" en modal de alta/edición. Define frecuencia (N días/semanas/meses/años) y fecha próxima compra (auto-calculada si se deja vacía). Badge violeta/ámbar/rojo en cards según estado. Migration 102 agrega columnas a `recursos`.

**GastosPage → tab Recursos — Renovaciones pendientes:** nueva sección que muestra recursos recurrentes con `proximo_vencimiento ≤ hoy+7` o vencidos. Botón "Registrar compra" → crea gasto pendiente + avanza la fecha al siguiente ciclo.

### Inventario — stock por sucursal (fix integral)

**Helper `getStockAntesSucursal`:** reemplaza `productos.stock_actual` global en todos los inserts de `movimientos_stock`. Suma `inventario_lineas.cantidad` filtrado por `sucursal_id` cuando hay sucursal activa.

**Correcciones aplicadas en:** ingreso simple, rebaje, masivo inline, conteo, autorizaciones (ajuste/serie/LPN), kitting, des-kitting.

**`sucursal_id` agregado** en todos los movimientos que lo faltaban: kitting, des-kitting, autorizaciones. También en `inventario_lineas` INSERT del masivo inline y kitting/des-kitting.

**Display en formularios:** "Stock en sucursal: X" cuando hay sucursal activa (Agregar Stock y Quitar Stock). Query reactiva `stockEnSucursal` se actualiza al cambiar sucursal o producto.

### DB (migrations nuevas en DEV)
- Migration 099: `notificaciones.metadata JSONB`
- Migration 100: rename `DUEÑO` completo
- Migration 101: `sucursal_id` en `ubicaciones` y `combos`
- Migration 102: `es_recurrente/frecuencia_valor/frecuencia_unidad/proximo_vencimiento` en `recursos`

---

## Para la próxima sesión — prioridad 1

### 1. Deploy a PROD (v1.8.16)
- [ ] PR `dev → main` con título `v1.8.16 — Dashboard + DUEÑO + sucursales`
- [ ] Aplicar migrations 093–101 en PROD (`jjffnbrdjchquexdfgwq`)
- [ ] Deploy EF `invite-user` en PROD (usa 'DUEÑO')
- [ ] Deploy EF `cancel-suscripcion` en PROD
- [ ] Deploy EF `ai-assistant` en PROD (system prompt mejorado)
- [ ] Configurar secret `GROQ_API_KEY` en PROD
- [ ] GitHub release v1.8.16
- [ ] Bump APP_VERSION a v1.8.17 en dev

### 2. Sucursales — pendientes
- **Recepciones**: validar sucursal obligatoria (igual que ingreso directo)
- **Relocacion manual de LPNs existentes sin sucursal**: UI para asignar sucursal masivamente
- **Traslado LPN**: probar que el flujo completo funciona en prod (cantidad + sucursal + ubicación)

### 3. Reglas de negocio — relevar y/o implementar (pendiente próxima sesión)

**Ya relevadas, pendientes de implementar:**
- **Caja**: Bóveda (saldo + transferencias caja↔bóveda)
- **Caja**: Contraseña maestra para cerrar caja ajena (`clave_maestra` en `tenants`)
- **Caja**: Ticket de cierre PDF imprimible + reimpresión desde historial
- **Caja**: Alerta automática a OWNER/SUPERVISOR si hay diferencia al cierre
- **Caja**: Arqueo parcial (sin cerrar sesión, sin rastro en historial)

**Pendiente de relevar con GO:**
- **Gastos**: reglas de negocio completas
- **RRHH**: reglas de negocio completas
- **Ventas**: devoluciones/reapertura de despachada/límite de ítems
- **Clientes**: límite de deuda configurable / notificación al cliente

### 4. Recursos — pendientes de esta sesión
- **Migration 102**: aplicar en DEV y luego en PROD con el siguiente deploy
- **Recursos recurrentes — cron automático**: generar gastos pendientes automáticamente (pg_cron o GitHub Actions) sin intervención del usuario

---

## Backlog

- **Dashboard → Tab "Gráficos"**: definir contenido y spec
- **Topes Monotributo** en DashFacturacionArea: actualizar anualmente (valores 2024)
- **Envíos proveedor logístico**: cotizador Andreani/OCA con APIs
- **GS1 Argentina**: integrar `scan-product` EF
- **Centro de Soporte `/ayuda`**
- **WMS Fase 3** — `wms_tareas`

### Pendiente manual
- Verificar genesis360.pro en Resend → FROM `noreply@genesis360.pro`
- Créditos Anthropic para `scan-product`
- Constitución empresa → CUIT activo
- Google Ads Standard Token
- Membresía GS1 Argentina

---

## Referencias técnicas clave

### Componentes Dashboard General
```
src/components/
├── DashVentasArea.tsx       # Funnel + Heatmap días×horas + Pie canales
├── DashGastosArea.tsx       # Pie cat + Barras mensuales + Top 5
├── DashProductosArea.tsx    # Scatter Cuadrante + Pareto + Pie + Tijera precios
├── DashInventarioArea.tsx   # Dona + Gauge SVG + Aging + Recursos + Combos bloqueados
├── DashClientesArea.tsx     # RFM + Cohort + Origen + Aging CC
├── DashProveedoresArea.tsx  # Donut prov + Aging OC + Evolución gastos
├── DashFacturacionArea.tsx  # IVA + Alícuotas + Topes (estimaciones, banner legal)
├── DashEnviosArea.tsx       # Funnel + Courier + Scatter subsidio/ganancia
└── DashMarketingArea.tsx    # POAS real + Evolución + Donut canal + Radar campañas
```

### Roles del sistema (renombrado OWNER → DUEÑO)
| Rol | `puedeVerTodas` | Acceso |
|-----|----------------|--------|
| DUEÑO | Siempre sí | Total |
| ADMIN | Siempre sí | Solo plataforma (`/admin`) |
| SUPER_USUARIO | Sí por DB | Igual que DUEÑO dentro del tenant |
| SUPERVISOR | Sí por DB | Sin config/usuarios |
| CONTADOR | Sí por DB | Dashboard/gastos/reportes |
| CAJERO | No | Solo ventas/caja/clientes |
| DEPOSITO | No | Solo inventario/productos |
| RRHH | No | Solo módulo RRHH |

### Reglas de sucursal (implementadas v1.8.16)
- **Selector en header**: solo en `/inventario`, `/productos`, `/clientes`, `/proveedores`
- **"Todas las sucursales"**: solo visible para rol DUEÑO
- **Otros roles**: ven su sucursal fija (no pueden cambiarla)
- **Ingreso de stock**: requiere sucursal seleccionada (bloquea si vacía)
- **Ubicaciones y Combos en Config**: filtran por sucursal activa + globales (NULL)
- **LPN Traslado**: `cantMover` default '1' si hay ≥2 unidades; cantidad DEBE ser menor al total

### Gotchas recharts v3 (`^3.8.0`)
- `Treemap content={<Comp/>}` → **CRASHEA**. Usar divs custom o función render
- `Tooltip formatter={(v, name) => ...}` → `name` es `any`, no `string`

### Gotchas Supabase JS
- `.eq('joined_table.col', val)` → **NO funciona**. Hacer 2 queries separados
- `!inner` en select con filtros en tabla unida → tampoco funciona via `.eq()`
- `.select('*', { count: 'exact', head: true })` → destructurar `{ count }`, no `{ data: { count } }`

### Edge Functions DEV (activas)
| EF | Auth | Descripción |
|---|---|---|
| `invite-user` | JWT-less | Invita usuario. Roles: DUEÑO, SUPER_USUARIO, ADMIN |
| `cancel-suscripcion` | JWT | PATCH preapproval MP + actualiza tenant |
| `ai-assistant` | JWT-less | Groq/Llama 3.1 — chat + bug report |
| `scan-product` | JWT-less | Claude Haiku + Open Food Facts |
| `send-email` | JWT | Resend — invitaciones + bug reports |
| `emitir-factura` | JWT | AFIP factura electrónica |
| `crear-suscripcion` | JWT-less | MP preapproval |
| `mp-webhook` | JWT-less | Webhooks MP |
| `data-api` | JWT | API pull externa |
| `tn-stock-worker` | JWT-less | Sync stock TiendaNube |
| `meli-stock-worker` | JWT-less | Sync stock MercadoLibre |

### Supabase projects
- PROD: `jjffnbrdjchquexdfgwq`
- DEV: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`

### pg_cron activo DEV+PROD
- `tn-stock-sync`: cada 5 min
- `meli-stock-sync`: cada 5 min
- `notif-cc-vencidas`: diario 09:00 AR

### PDF Factura QR AFIP (RG 4291)
- `src/lib/facturasPDF.ts`: QR = `btoa(JSON.stringify(payload))` → `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- tipoCmp: A=1 · B=6 · C=11 · NC-A=3 · NC-B=8 · NC-C=13
