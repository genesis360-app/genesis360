---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.9.0** ✅ · DEV: **v1.9.0**

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV v1.9.0 / PROD v1.9.0 (cierre sesión 2026-05-25)

- APP_VERSION DEV: `v1.9.0` en `src/config/brand.ts` ✅
- APP_VERSION PROD: `v1.9.0` ✅ (PR #117 mergeado `4ec5885b`, release v1.9.0 como `latest`)
- Migrations DEV: 001–135 ✅
- Migrations PROD: 001–135 ✅ (al día — 134 capitalización + vw_egresos_consolidados · 135 cierre contable)
- Vercel deploys READY: PROD `dpl_DH6q1FMCKxPnPN6tav1xC3j79Kab`
- **Pipeline Reglas de Negocio - Gastos: cerrado ✅** (Fases 1-5 en PROD)

### Lo producido en DEV en esta sesión (2026-05-25 — v1.9.0)
- **v1.8.45 + v1.9.0 combinados** — Fases 4 y 5 reglas Gastos cerradas en un único bump por ser HITO transversal
- **Migration 134**: `gastos.capitaliza_recurso BOOLEAN` + CHECK + índice parcial · VIEW `vw_egresos_consolidados` (gastos + rrhh_salarios.pagado)
- **Migration 135**: tabla `cierres_contables` + `gastos.gasto_padre_id` + `gastos.es_correccion` + 5 triggers BEFORE UPDATE/DELETE (gastos, ventas, caja_movimientos, caja_sesiones, ordenes_compra) + RPCs `cerrar_periodo` y `reabrir_periodo` + helpers `ultimo_cierre_hasta` y `periodo_cerrado`
- **Frontend Fase 4**: checkbox capitalización en form de gasto · query `gastos-por-recurso` + card "Mantenimiento acumulado" + chips mantto/capit en RecursosPage · banner "Costo laboral del período (RRHH)" en DashGastosArea con link a `/rrhh?tab=nomina` · sección "Estado de resultados" con línea separada "Sueldos pagados (RRHH)" en RentabilidadPage
- **Frontend Fase 5**: hook `useCierreContable` + helper `manejarErrorPeriodoCerrado` · componente `CierresContablesPanel` con preview live + listado expandible + reabrir · nuevo tab "Cierres contables" en GastosPage · modo "Nota de corrección" (estado `correccionPadre`, modal banner amber, monto negativo permitido) · candado 🔒 reemplaza Editar/Eliminar para gastos en periodo cerrado · interceptación del error de trigger en VentasPage

### Releases anteriores (todo dentro de v1.8.44)
- **v1.8.41** — Selector courier propio/tercero en VentasPage + fix link transportista con `VITE_APP_URL`
- **v1.8.42** — Fase 1 Reglas Gastos: migrations 130+131 + categorías_gasto seed automático + config comprobante + indicadores fijos 🟢🟡🔴✅ + badge anticipo OC + tab Gastos en ConfigPage
- **v1.8.43** — Fase 2 Reglas Gastos: migration 132 + umbrales por rol/sucursal + autorizaciones_gasto + helpers `umbralGasto.ts` + modales `SolicitarAutorizacionGastoModal` y `BandejaAutorizacionesGasto` + restricciones CAJERO/CONTADOR
- **v1.8.44** — Fase 3 Reglas Gastos + Moneda multi-país: migration 133 + `tenants.moneda` (11 monedas LatAm + EUR/USD) + `formato.ts` central + `ccProveedor.ts` + `SolicitarOverrideCCModal` + `BandejaAutorizacionesCC` + IVA auto + selector alícuota + sucursal obligatoria por categoría + bloqueo CC con override DUEÑO + 8 páginas migradas a `formatMoneda`

---

## Pipeline Reglas de Negocio — Gastos (v1.8.42 → v1.9.0)

Relevamiento completo en sesión 2026-05-24. Detalle de reglas en `wiki/development/reglas-negocio.md` (sección Gastos).

### v1.8.42 — Quick wins (Fase 1) · migrations 130-131
- Tabla `categorias_gasto` + seed ~15-20 categorías base + flag `predefinida` + `requiere_sucursal`
- ConfigPage tab Gastos: 4 toggles obligatoriedad comprobante (OR) + monto umbral + `dias_alerta_borrador` + `dias_alerta_anticipo_oc`
- Default seed: comprobante obligatorio siempre
- Indicadores visuales gastos fijos (🟢 dentro de fecha · 🟡 pendiente este mes · 🔴 atrasado · ✅ generado)
- Badge "💰 Anticipo" en OC + alerta N días sin recibir (`monto_pagado > 0 AND recepcion_estado='pendiente'`)

### v1.8.43 — Permisos y umbrales (Fase 2) · migration 132
- `sucursales.umbral_gasto_supervisor` + `umbral_gasto_cajero`
- Tabla `autorizaciones_gasto` (solicitud → aprobada/rechazada por SUPERVISOR+)
- RLS Gastos por rol: CAJERO solo crea/edita en su caja abierta · CONTADOR solo edita IVA · DUEÑO/ADMIN sin restricción · SUPERVISOR hasta umbral
- Validación umbral en crear + editar
- Notificación borrador (creador + DUEÑO + SUPERVISOR) tras N días via pg_cron

### v1.8.44 — IVA + Multi-sucursal + CC proveedor (Fase 3) · migration 133
- IVA auto (A=21% desglosado, B=21% incluido, C=0) + selector alícuota (21/10.5/27/0/custom)
- Form gasto: sucursal obligatoria/opcional según `categorias_gasto.requiere_sucursal`
- `proveedores.limite_cc DECIMAL` + validación al crear OC con CC
- Bloqueo OC CC nueva con proveedor con OC vencida · override DUEÑO con tabla `autorizaciones_cc` (auditoría)
- Reportes: gasto sin sucursal aparece como "Tenant / Global"

### v1.8.45 — Recursos↔Gastos + Dashboard consolidado (Fase 4) · migration 134 ✅
- ✅ Checkbox "Sumar al valor del recurso" → `gastos.capitaliza_recurso BOOLEAN` (default OFF) + CHECK constraint
- ✅ Card "Mantenimiento acumulado" + chips Mantto/Cap en RecursosPage
- ✅ Vista `vw_egresos_consolidados` (gastos UNION rrhh_salarios.pagado=true) con `security_invoker=true`
- ✅ Dashboard Gastos: banner "Costo laboral del período (RRHH)" con link a `/rrhh?tab=nomina` + total consolidado
- ✅ RentabilidadPage: sección "Estado de resultados" con línea separada "Sueldos pagados (RRHH)" + resultado neto

### v1.9.0 — HITO Cierre Contable Mensual (Fase 5) · migration 135 ✅
- ✅ Tabla `cierres_contables(tenant, periodo, fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB)`
- ✅ RPC `cerrar_periodo()` — DUEÑO/SUPERVISOR/CONTADOR/ADMIN + snapshot de totales
- ✅ RPC `reabrir_periodo()` — solo último cierre, DUEÑO/ADMIN/SUPER_USUARIO
- ✅ 5 triggers BEFORE UPDATE/DELETE en gastos + ventas + caja_movimientos + caja_sesiones + ordenes_compra (RAISE EXCEPTION P0001)
- ✅ Notas de corrección: `gastos.gasto_padre_id` + `es_correccion=TRUE` + monto negativo permitido
- ✅ UI: hook `useCierreContable` + helper `manejarErrorPeriodoCerrado` + componente `CierresContablesPanel`
- ✅ Nuevo tab "Cierres contables" en GastosPage con preview live + listado expandible
- ✅ Candado 🔒 reemplaza Editar/Eliminar para gastos en periodo cerrado + modo corrección
- ✅ Doc: `wiki/development/cierre-contable.md` con concepto, schema, RPCs y casos de uso

### Pendientes opcionales (no bloqueantes)
- UI de candado por fila en `VentasPage`, `CajaPage`, `RecepcionesPage` (hoy solo viene el toast del trigger)
- Reporte "Con/Sin correcciones" en RentabilidadPage (filtrar `es_correccion`)
- Notificación al cerrar/reabrir un periodo
- Exportar PDF del cierre con snapshot de totales (datos ya están en `cierres_contables.totales JSONB`)

### Decisiones de diseño documentadas

- **Sueldos/Nómina**: NO migrar a Gastos. Se quedan en RRHH → Nómina. Integración via vista `vw_egresos_consolidados`
- **Depreciación de recursos**: diferida a fase fiscal posterior (requiere relevamiento con contador)
- **OC anticipo**: sin estado nuevo, mitigación con badge visual + alerta

---

## Lo producido en sesión 2026-05-21 → 2026-05-23 (v1.8.39 → v1.8.41)

### Módulo Envíos — features completas (v1.8.40 — PROD ✅)
- **ISS-165 — Página transportista pública**: `/transporte/:token` mobile-first sin login. El driver actualiza estado (en_camino, en_bodega, entregado, devolución) y carga POD (fecha, receptor, observaciones, foto) directo desde el celular. Migration 129 + 3 funciones SECURITY DEFINER públicas (`get_envio_by_token`, `get_envio_items_by_token`, `update_envio_by_token`).
- **ISS-166 — Cámara POD**: botón con `<input capture="environment">` que abre cámara trasera del celular o explorador en desktop. Sube foto a bucket `etiquetas-envios/pod/{envioId}/` con URL firmada 365 días.
- **ISS-167 — QR codes en remito PDF**: QR del número de envío arriba a la derecha y QR del número de venta al lado del bloque DESTINATARIO. Tabla incluye SKU, LPN y Ubicación. Layout con líneas separadoras grises.
- **ISS-168 — LPN y ubicación en panel expandido**: query de `venta_items` incluye `inventario_lineas(lpn, ubicaciones(nombre))`. Por cada producto muestra badge violeta con LPN y ubicación del depósito.
- **ISS-169 — Pestaña Pagos Courier**: tab con badge naranja de cantidad pendiente. Selección múltiple con checkbox + Seleccionar todo. Medio de pago, fecha, total dinámico. Migration 128: `costo_pagado + fecha_pago_courier + medio_pago_courier`.
- **ISS-171 — Bloqueo si costo no pagado**: `verificarPagoAntes()` antes de avanzar estado. Si `costo_cotizado > 0 AND costo_pagado = false` → toast bloqueante con redirect a Pagos Courier.

### Otros fixes Envíos (v1.8.39 — PROD ✅)
- **POD completo**: pod_url, pod_fecha, pod_receptor, pod_notas en envíos. Modal POD standalone + sección en modal edición + display en panel expandido. Migration 127.
- **Estado `en_bodega`**: nuevo entre `en_camino` y `entregado` (paquete en depósito del courier). Badge violeta + icono Warehouse. CHECK constraint ampliado.
- **BUG CRÍTICO resuelto**: `cliente_id` inexistente en envíos → INSERT silenciosamente fallaba al hacer venta con envío. Fix: eliminado del INSERT.
- Número venta coherente Ventas ↔ Envíos: `formatVentaNum()` igual que `formatTicket()`. Prefijo solo si sucursal tiene `codigo` configurado, fallback `#numero`.
- DashEnviosArea: agrega `en_bodega` al funnel, calcula tiempo medio real desde `pod_fecha`, insight de cancelados.

### Fixes integridad inventario en Ventas
- Cambio de sucursal con carrito activo limpia automáticamente el carrito + draft localStorage. Toast explicativo.
- Query de lineas en `registrarVenta` filtra estrictamente por `sucursal_id` (antes podía descontar de otra sucursal).
- Validación: bloquea venta si hay >1 sucursal y ninguna seleccionada.
- Carrito restaurado: re-fetch de `lineas_disponibles` dentro del mismo `useEffect` (sin race condition con effect separado).
- `productosBusqueda` query usa `enabled: authInitialized` para esperar Supabase session.

### Autocomplete direcciones (reescritura completa)
- `AutocompleteSuggestion.fetchAutocompleteSuggestions()` (nueva Places API, misma que Google Maps internamente, Promise-only).
- Fallback automático a `AutocompleteService` legacy (callback-only) si Suggestion no disponible.
- Fallback final a Nominatim con `addressdetails=1` para labels limpios y coords.
- Min 2 caracteres, debounce 300ms.
- Bug del input congelado: resuelto reemplazando widget de Google por servicio programático que no toca el DOM.

### Cálculo de distancia (reescritura)
- `calcularDistanciaKm()`: intenta `google.maps.DistanceMatrixService` (callback + Promise dual), fallback a Haversine con geocodificación Nominatim.
- En VentasPage: pre-geocodifica origen al activar toggle envío → cálculo Haversine **instantáneo** al seleccionar destino (sin API calls adicionales).
- Alertas claras si origen/destino no geocodifica con link a Sucursales para corregir.

### Otros fixes UX
- Stock 0 al restaurar carrito: resuelto definitivamente (re-fetch inline).
- Número ticket: sin prefijo configurado muestra `#175` (antes mostraba `S1-0175` por fallback hardcodeado).
- Botón "Compartir transportista" usa `VITE_APP_URL` para que el link apunte siempre a PROD.

### Migrations aplicadas en PROD
- 127: `envios` — POD fields + estado `en_bodega`
- 128: `envios` — costo_pagado + fecha_pago_courier + medio_pago_courier
- 129: `envios.token_transportista` + 3 funciones SECURITY DEFINER públicas

### Bug pendiente — ya identificado (NO requiere acción inmediata)
- Ruta `/transporte/:token` solo está en PROD desde v1.8.40. Si el usuario genera link desde dev preview, el link apunta a PROD que ya tiene la ruta (fix con `VITE_APP_URL` en v1.8.41).

---

## Lo producido en sesión 2026-05-21 → 2026-05-23 — más detalle

### Estado infra
- Edge Functions DEV: todas activas · `scan-ticket` v3 (Claude Sonnet 4.6 vision) deployada
- Edge Functions PROD: `invite-user` ✅ · `ai-assistant` ✅ · `cancel-suscripcion` ❌ (no existe en repo)
- ANTHROPIC_API_KEY: DEV ✅ (con créditos cargados) · PROD ✅
- GROQ_API_KEY: DEV ✅ · PROD ✅
- VITE_GOOGLE_MAPS_API_KEY: DEV ✅ · PROD ✅

---

## Migrations pendientes en PROD (093–107) — YA APLICADAS en v1.8.22/v1.8.27

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

## Lo producido en sesiones 2026-05-14 (v1.8.21 + v1.8.22-dev)

### Bugfixes batch — 13 issues resueltos
- ISS-087: ★ visual en caja predeterminada
- ISS-088: sugerido apertura caja usa monto_cierre (confiable)
- ISS-089: selector caja origen en modal Ingresar a Caja Fuerte + validación saldo
- ISS-094: rollback venta CC cuando falla stock (delete ventas en catch)
- ISS-097: fix Rules of Hooks en EnviosPage (useState en IIFE → usa domForm)
- ISS-081: total ventas redondeado a 2 decimales; display correcto
- ISS-082: "Falta asignar" estático mientras se tipea (committedAsignado + onBlur)
- ISS-091: badge stock insuficiente en carrito de ventas
- ISS-092: carrito recuperado restaura modoCC y clienteCCEnabled desde DB
- ISS-093: tag CC en historial de ventas
- ISS-103: selector canal de venta en POS (Presencial, Instagram, Facebook, WhatsApp, Otros)
- ISS-084: gastos efectivo → selector de caja obligatorio + validación saldo + caja fuerte
- ISS-102: clientes y proveedores globales (sin filtro de sucursal)

### Issues pendientes para próximas sesiones (requieren planificación mayor)
- ~~ISS-085: Historial ventas por sucursal + reset # ticket por sucursal~~ ✅ migration 108
- ~~ISS-086: Cuotas tarjeta de crédito~~ ✅ migration 108 + ConfigPage + VentasPage picker
- ~~ISS-090: CC como método de pago parcial~~ ✅ fix validación 2026-05-20 (commit 7e12f35e)
- ~~ISS-095: OC con CC como método de pago parcial~~ ✅ GastosPage modal de pago OC
- ~~ISS-096: Adjuntar archivos en OC/gastos~~ ✅ migration 108 + Storage comprobantes-gastos

### Pendientes de deploy a PROD (en DEV como v1.8.39)
- **scan-ticket EF**: deployada en DEV, pendiente deploy a PROD + configurar ANTHROPIC_API_KEY en PROD
- **ISS-162/163/164**: envíos en VentasPage con autocompletado + cálculo automático ✅
- **POD + en_bodega**: migration 127 aplicada en DEV ✅
- **Fix crítico envíos**: `cliente_id` bug resuelto, fecha_entrega_acordada agregada ✅
- **Corrección totales con envío**: historial, ticket, saldo modal ✅
- **Jerarquía $/km**: fallback global → sucursal ✅
- **Consolidación SucursalesPage**: campos movidos desde Config ✅
- **Dashboard fixes**: categoria FK, filtro inclusivo, banner sucursal ✅
- **ISS-090 CC fix**: validación medios de pago CC parcial ✅

---

## Para la próxima sesión — prioridades

### 1. Deploy PROD v1.8.40 — COMPLETADO ✅
- [x] PR #115 `dev → main` mergeado
- [x] Migrations 127–129 aplicadas en PROD
- [x] GitHub release v1.8.40 como latest
- [x] App version PROD = v1.8.40

### 2. Verificación post-deploy en PROD
- [ ] Verificar página transportista `/transporte/:token` funciona en `app.genesis360.pro` (sin login)
- [ ] Probar generación de link "Compartir transportista" desde Envíos en PROD
- [ ] Verificar QR codes en remito PDF (envío arriba derecha, venta junto a DESTINATARIO)
- [ ] Probar marcar pagos courier desde nueva pestaña

### 3. Pendiente deploy a PROD (DEV v1.8.41)
- [ ] PR `dev → main` con título `v1.8.41 — Selector courier en VentasPage`
- [ ] GitHub release v1.8.41

### 4. Reglas de negocio — relevar e implementar
- **Pendientes de relevar:** Gastos (completo), RRHH (completo), Ventas (devoluciones/límites), Clientes (deuda configurable)
- **Pendientes de implementar:** Bóveda (Caja), contraseña maestra cierre caja ajena, ticket cierre PDF, alerta diferencia cierre

### 5. Envíos — mejoras posibles próximas sesiones
- Cron para limpiar tokens transportista expirados (>30 días, envíos entregados)
- Soporte para múltiples fotos POD (no solo una URL)
- Reportes de pagos courier (acumulado por mes/courier)
- Tracking integrations: APIs de OCA/Andreani para auto-actualizar estado
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
