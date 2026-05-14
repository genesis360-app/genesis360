# Log — Genesis360 Wiki

Log cronológico append-only. Cada entrada empieza con `## [YYYY-MM-DD] tipo | título`.

Tipos: `init` · `ingest` · `query` · `update` · `lint`

---

## [2026-05-13] update | Soporte DB: incidente pool saturado + manual de rescate

- Causa: AppLayout tenía query a `ventas_externas_logs.created_at` (columna inexistente, era `procesado_at`) corriendo cada 30s → saturó el pool de 60 conexiones
- Segunda causa: ReportesPage pedía `estados_inventario.es_default` (inexistente en esa tabla)
- Fix: columnas corregidas en el código, restart del proyecto DEV desde dashboard
- Creado: `G360.Wiki/wiki/support/supabase-db-rescue.md` con manual completo de diagnóstico y rescate

## [2026-05-13] update | Kits y Conteos: filtrado por sucursal activa (v1.8.18)

- Kits: `stockKitsSucursal` query suma `inventario_lineas` por sucursal; helper `kStock()` usado en maxKits, display, desarmar y modal armado
- Kits: `iniciarArmado` verifica y reserva solo componentes de la sucursal; `desarmarKit` filtra `lineasKit` por sucursal
- Conteos: `conteoHistorial` aplica `.eq('sucursal_id')` (queryKey ya lo tenía pero no la query); `cargarLineasParaConteo` idem

## [2026-05-13] update | Inventario: stock por sucursal en movimientos + display (fix integral)

- `getStockAntesSucursal` helper reemplaza `productos.stock_actual` global en todos los inserts de `movimientos_stock`
- Corregido en: ingreso, rebaje, masivo inline, conteo, autorizaciones, kitting, des-kitting
- `sucursal_id` agregado en kitting/des-kitting y autorizaciones (faltaba)
- `inventario_lineas` INSERT del masivo inline ahora incluye `sucursal_id`
- Display "Stock en sucursal: X" en formularios Agregar Stock y Quitar Stock cuando hay sucursal activa
- Query reactiva `stockEnSucursal` con `staleTime: 0`

## [2026-05-13] update | Recursos: tab Ubicaciones + recurrencia + GastosPage renovaciones

- Migration 102: columnas `es_recurrente`, `frecuencia_valor`, `frecuencia_unidad`, `proximo_vencimiento` en `recursos`
- RecursosPage: tab "Ubicaciones" con agrupación por ubicación e inline edit; lógica recurrente en modal (checkbox + frecuencia + fecha próxima calculable); badge visual en cards
- GastosPage tab Recursos: sección "Renovaciones pendientes" con recursos recurrentes vencidos o próximos (≤7 días) + botón "Registrar compra" que crea gasto y avanza la fecha
- LpnAccionesModal: sucursal_id en tab Editar (sesión anterior)

## [2026-05-13] update | v1.8.16 DEV — cierre sesión completo

Renombrado OWNER→DUEÑO (migration 100): constraint, data, RLS, is_rrhh(), caja_fuerte_roles, 21 archivos frontend.
Sucursales (migration 101): selector header limitado a 4 rutas solo para Dueño.
ubicaciones/combos filtran por sucursal. Ingreso bloqueado sin sucursal.
LPN traslado: cantMover default 1 → botón habilitado.
Deploy PROD pendiente con migrations 093-101.

---

## [2026-05-13] update | v1.8.14 DEV — cierre sesión + docs actualizados

Dashboard General completo (9 áreas: Ventas/Gastos/Productos/Inventario/Clientes/Proveedores/Facturación/Envíos/Marketing).
Fixes: DashInventarioArea Treemap→barras custom (recharts v3 bug), DashProductosArea devolucion_items query + periodo default.
Gotchas documentados: recharts v3 Treemap crash, Supabase JS !inner filter.
Pendientes: deploy PROD v1.8.14 (migrations 093-099, EFs, GROQ_API_KEY, GitHub release).

---

## [2026-05-12] update | v1.8.12 DEV — Dashboard General: área Inventario

- feat: DashInventarioArea.tsx — área Inventario & Recursos completa:
  - Toggle vista: Todo / Solo Mercadería / Solo Recursos
  - 8 KPIs: Capital de Trabajo, Patrimonio Operativo, Rotación, Runway, Kits posibles, Recursos en reparación, Reservas, Mermas
  - Gráfico 1: Dona Patrimonio (Mercadería turquesa/recursos violeta)
  - Gráfico 2: Gauge SVG semicircular "Salud del Depósito" (4 zonas crítico→óptimo)
  - Gráfico 3: Barras envejecimiento del capital (0-30/31-90/+90 días)
  - Gráfico 4: Barras apiladas horizontales "Recursos por categoría" (activo/en_reparacion/dado_de_baja)
  - Gráfico 5: Treemap "Cuello de Botella de Combos" (kits bloqueados sin componentes)
  - Insights: recursos en reparación, capital dormido +90 días, combos bloqueados, runway corto, stock crítico, mermas

---

## [2026-05-12] update | v1.8.11 DEV — Dashboard General: área Productos

- feat: DashProductosArea.tsx — área Productos completa:
  - 6 KPIs en 2×3: Margen Global, El Motor, La Mina de Oro, Capital Dormido, Tasa Devolución, Quiebre de Stock
  - Filtros: período + categoría + slider margen mín + ciclo de vida (Estrella/Perro/Nicho)
  - Gráfico 1: Scatter "Cuadrante Mágico" (cantidad vs margen) — 4 cuadrantes con colores verde/azul/amarillo/rojo
  - Gráfico 2: Pareto "Concentración de Ingresos" — barras + línea acumulada + referenceLine al 80%
  - Gráfico 3: Pie "Participación por Categoría"
  - Gráfico 4: "La Tijera de Precios" — doble línea (precio prom morado vs costo prom rojo) últimos 6 meses
  - Insights: margen bajo, producto con costo > precio, capital dormido, quiebre de stock, concentración Pareto, devoluciones, mina de oro oculta
- feat: sub-nav Dashboard General agrega área "Productos" (entre Gastos e Inventario)

---

## [2026-05-12] update | v1.8.10 DEV — Dashboard General: área Gastos

- feat: DashGastosArea.tsx — área Gastos completa:
  - Filtros propios en popover (período Mes/Trimestre/Año/Custom, ARS/USD, Categoría)
  - KPI 1: Total Salidas — badge invertido (subir=rojo, bajar=verde)
  - KPI 2: Velocidad de Gasto / Burn Rate ($X/día)
  - KPI 3: Peso de la Estructura (Ratio Gastos/Ventas %) con alerta >80%
  - KPI 4: Rigidez del Gasto — % fijos vs variables con barra bicolor (usa gastos_fijos)
  - Gráfico 1: Pie por categoría — colores bien diferenciados + leyenda inline
  - Gráfico 2: Barras mensuales últimos 6 meses + línea referencia (promedio) punteada accent; barras rojas si >15% del promedio
  - Gráfico 3: Top 5 destinos de gasto — barras horizontales por descripción
  - Insights: tendencia, cuotas vencidas, por vencer, sin comprobante, anomalía por categoría, ratio crítico, gastos fijos altos

---

## [2026-05-12] update | v1.8.9 DEV — Dashboard General: sub-nav áreas + área Ventas

- feat: DashboardPage — sub-navegación de área en pestaña General (Todo/Ventas/Gastos/Inventario/Clientes/Proveedores/Facturación/Envíos)
- feat: tab "Gráficos" agregado (placeholder "Próximamente")
- feat: DashVentasArea.tsx — área Ventas completa:
  - Filtros propios en popover (período Hoy/7D/15D/30D/Mes/Año/Custom, ARS/USD, c/IVA/s/IVA, Canal)
  - KPI 1: Total Vendido con badge vs período anterior
  - KPI 2: Gasto promedio por cliente
  - KPI 3: Efectividad de presupuestos (% conversión)
  - KPI 4: Clientes Nuevos vs Frecuentes (mini progress bar bicolor)
  - Gráfico 1: "El Camino de la Venta" — funnel horizontal 3 etapas (Presupuestado/Pendiente/Pagado)
  - Gráfico 2: "Tus mejores momentos" — heatmap días×horas con accent color opacity
  - Gráfico 3: "¿Por dónde compran?" — pie chart canales con recharts + leyenda inline
  - Insights automáticos: tendencia, pendiente cobro, efectividad, fidelidad, canal dominante, peak hours

---

## [2026-05-12] update | v1.8.8 DEV — fix multi-sucursal inventario

- fix: inventario_lineas INSERT en ingresoMutation omitía sucursal_id → LPNs quedaban sin sucursal → filtrar por sucursal mostraba 0 unidades
- fix: LpnAccionesModal selector sucursal — sucursalDestino con null en vez de '' para evitar confusión visual del browser; opción "Sin sucursal asignada" explícita; sucursalFinal usa ?? en vez de ||
- feat: selector de sucursal en form de ingreso para OWNER en vista global (resaltado en ámbar)

---

## [2026-05-12] update | v1.8.7 DEV — aprobación caja fuerte real + envíos + IA

- fix bug crítico: solicitudes CAJERO→CajaFuerte siempre fallaban (tipo inválido, sin user_id). Ahora notifica a OWNER/SUPER_USUARIO/SUPERVISOR con metadata JSONB.
- NotificacionesButton: botones Aprobar/Rechazar para `solicitud_caja_fuerte` — Aprobar ejecuta egreso+ingreso reales.
- EnviosPage: selector "Nuevo envío" excluye ventas que ya tienen envío asignado.
- ai-assistant: system prompt reescrito con 20 módulos en orden sidebar + botones exactos + roles actualizados.
- Migration 099: `notificaciones.metadata JSONB`.

---

## [2026-05-08] update | v1.8.6 DEV — bump versión + cierre sesión

Bump v1.8.6. Migrations DEV: 093–098. Todo pusheado, pendiente deploy a PROD.
Rol ADMIN renombrado a SUPER_USUARIO. EF invite-user y cancel-suscripcion deployados en DEV.
Ventas: panel envío completo (monto/$km/Maps). Gastos: tab Recursos + cuotas tarjeta.
Recursos: tabs renombrados + flujo gasto automático. Recepciones: bug detalle expandido fix.

---

## [2026-05-08] update | v1.8.5 DEV — mejoras Caja/Inventario/Envíos/Ventas/Recepciones

### Caja
- Historial excluye caja fuerte; historial propio en tab Caja Fuerte (ingresos + egresos)
- "Ingresar a Caja Fuerte": sin restricción de sesión activa para OWNER/SUPER
- "Enviar a Caja": selector de caja destino (antes fijado en la caja activa)
- CAJERO: botón "Caja Fuerte" → genera solicitud (notificación) para OWNER/SUPERVISOR

### Inventario
- Conteos: muestra usuario en historial
- Bulk actions en LPNs: barra desde 1 LPN con "Cambiar estado" y "Cambiar ubicación"; cross-producto habilitado

### Envíos
- Toggle Propio/Tercero; si propio: KM + precio/km → auto-calcula costo

### Ventas
- Toggle "Requiere envío" en POS → auto-crea envío 'pendiente' al confirmar

### Recepciones (bug fixes anteriores)
- Fix detalle expandido: carga recepcion_items lazy con tabla Esperado/Recibido/Diferencia
- Validaciones de atributos (lote, vencimiento, series) antes de confirmar; auto-expande ítem con error
- Modal de resultado post-confirmación con comparativa vs OC
- Botones "Crear OC derivada" y "Solicitar reembolso" para diferencias
- Sucursal predeterminada sincronizada con header

---

## [2026-05-08] update | v1.8.5 DEV — fixes y docs

- fix: rol ADMIN faltaba en mapa local de UsuariosPage — no aparecía en invitar ni cambiar rol
- docs: app-reference.md — revisión completa (Estructuras correcto, Inventario 7 tabs, tabla Kit/Combo/Estructura)

---

## [2026-05-08] update | Permisos de sucursal por usuario (migration 094)

- Migration 094: `users.sucursal_id` + `users.puede_ver_todas`; OWNER/ADMIN/SUPERVISOR/CONTADOR init en true
- authStore: `puedeVerTodas` en estado; usuarios restringidos quedan bloqueados a su sucursal (ignorar localStorage)
- AppLayout: selector visible solo para `puedeVerTodas`; usuarios restringidos ven nombre fijo o badge "Sin sucursal"
- UsuariosPage: toggle Globe + selector sucursal inline por usuario; `updateRol` auto-actualiza `puede_ver_todas`
- VentasPage/GastosPage (OC)/CajaPage: filtros multi-sucursal completados (migration 093 para `ordenes_compra.sucursal_id`)

---

## [2026-05-08] update | Multi-sucursal filtro — RecepcionesPage + ProductosPage

- RecepcionesPage: `useSucursalFilter` + `applyFilter` en query listado + `sucursalId` en queryKey
- ProductosPage: `useSucursalFilter` + `applyFilter` en query `inventario_lineas` (stock crítico badge) + `sucursalId` en queryKey
- EnviosPage y RecursosPage ya tenían el filtro correctamente implementado
- Todos los módulos operativos ahora filtran por sucursal ✅

---

## [2026-05-08] update | Cierre sesión — docs actualizados para mañana

**Estado al cierre:**
- PROD: v1.8.3 ✅ · DEV: v1.8.4 · Migrations: DEV 001–092 / PROD 001–092
- Asistente IA deployado en DEV, GROQ_API_KEY configurada en DEV ✅
- Pendiente para mañana: (1) deploy v1.8.4 a PROD + GROQ_API_KEY en PROD, (2) mejora system prompt asistente, (3) expandir filtro sucursal a RecepcionesPage, EnviosPage, RecursosPage, ProductosPage stock crítico

---

## [2026-05-08] update | v1.8.4 DEV — Asistente IA en header (Groq/Llama 3.1)

- EF `ai-assistant`: Groq API (llama-3.1-8b-instant), auth JWT, system prompt con todos los módulos G360
- `AiAssistant.tsx`: panel chat flotante en header. Acciones rápidas, flujo bug report guiado, botón "Enviar reporte" (aparece tras 4+ mensajes)
- `send-email`: template `bug_report` — envía conversación formateada a gaston.otranto@gmail.com
- Secret `GROQ_API_KEY` configurado en DEV ✅ (pendiente configurar en PROD al deployar)
- Free tier Groq: 14.400 req/día — sin costo

---

## [2026-05-07] update | Plan Roadmap APIs — documentado, pausado

Relevamiento completo de integraciones API actuales y plan de 6 fases para killer features.
Ver: `wiki/integrations/roadmap-apis.md`

**Resumen estado actual:**
- ✅ TiendaNube, MercadoLibre, MercadoPago, Resend, Data-API implementados (básico)
- ⚠️ AFIP parcial (schema listo, worker facturación pendiente)
- ❌ Logística directa, PagoNube, EnvíoNube, Ads (Meta/Google/MELI), WhatsApp, Email marketing

**Plan fases priorizadas (implementación futura a confirmar):**
- Fase 1: MELI rentabilidad neta + MP conciliación + TN BOM + AFIP CUIT + repricing
- Fase 2: PagoNube + EnvíoNube (para operaciones propias y checkout TN)
- Fase 3: Logística directa (Andreani/OCA) + rate shopping + RMA
- Fase 4: MELI Ads (auto-pausado por margen)
- Fase 5: Meta Ads + POAS + GA4 (posicionamiento futuro)
- Fase 6: WhatsApp Cloud API (espera WABA) + Brevo/Klaviyo RFM

---

## [2026-05-07] update | Deploy v1.8.3 a PROD — Precios mayoristas + mass update

- Migration 092 (`producto_precios_mayorista`) aplicada en PROD ✅
- PR #107 mergeado `dev → main` ✅
- GitHub release v1.8.3 ✅
- Migrations PROD: 001–092 ✅

### Features
- **Precios mayoristas**: tabla `producto_precios_mayorista`, toggle + tiers en ProductoFormPage
- **Mass update productos**: +Proveedor, +Precio (% o fijo), +Reactivar en barra bulk

---

## [2026-05-07] update | Deploy v1.8.2 a PROD

- Migrations 090+091 aplicadas en PROD ✅
- PR #106 mergeado `dev → main` ✅
- GitHub release v1.8.2 creado ✅
- Migrations PROD: 001–091 ✅
- pg_cron `notif-cc-vencidas` activo en PROD (09:00 AR diario) ✅

---

## [2026-05-07] update | v1.8.2 DEV — OC→Gasto automático + notif CC vencidas

**Cambios:**

### OC → Gasto automático (migration 090)
- `gastos.recepcion_id` (UUID nullable FK a `recepciones`) para trazabilidad
- `RecepcionesPage`: al confirmar recepción vinculada a OC, crea `gasto` con monto calculado desde ítems recibidos × precio_costo, categoría "Compras", notas con número de recepción
- Dedup natural: cada confirmación crea una recepción nueva → un gasto nuevo

### Notificaciones CC vencidas (migration 091)
- `fn_notificar_cc_vencidas()`: SECURITY DEFINER, notifica OWNER+ADMIN por tenant
  - CC clientes: ventas CC con saldo > 0 y vencidas (created_at + plazo_pago_dias < hoy)
  - OC vencidas: `fecha_vencimiento_pago < hoy AND estado_pago != 'pagada'`
  - Dedup por día: no genera duplicados si ya existe notificación del mismo día para el mismo objeto
- pg_cron `notif-cc-vencidas`: corre a las 12:00 UTC (09:00 AR) todos los días

**Estado al cierre:**
- PROD: v1.8.1 ✅ · DEV: v1.8.2 · Migrations DEV: 001–091 · PROD: 001–089

---

## [2026-05-07] update | Deploy v1.8.1 a PROD

- Migration 089 (`recursos`) aplicada en PROD ✅
- PR #105 mergeado `dev → main` ✅
- GitHub release v1.8.1 creado ✅
- Migrations PROD: 001–089 ✅

---

## [2026-05-07] update | Multi-sucursal: filtrado estricto implementado

**Cambios:**
- `useSucursalFilter.applyFilter`: `.or(eq+null)` → `.eq('sucursal_id', sucursalId)` estricto
- `authStore.setSucursal(null)`: guarda sentinel `'__global__'` en localStorage para distinguir "nunca configurado" de "vista global explícita"
- `AppLayout` auto-select: no sobreescribe preferencia `'__global__'` guardada
- `SucursalSelector`: nueva opción "Todas las sucursales" al inicio del select

**Comportamiento:**
- Sucursal activa → solo datos de esa sucursal (datos NULL históricos no se mezclan)
- Vista global → todo visible (incluye NULL)
- La preferencia persiste entre sesiones

---

## [2026-05-07] update | v1.8.1 — Recursos, estructuras ingreso, fixes, plan multi-sucursal

**Producido en esta sesión:**

### Features
- **Módulo Recursos** (migration 089): `RecursosPage` + tabla `recursos`. Patrimonio del negocio (no para vender). 2 tabs: Patrimonio / Por adquirir. Stats, alertas garantía, CTA proveedores.
- **Estructura en ingreso**: InventarioPage (modal ingreso) + RecepcionesPage (por ítem) — select de estructura que precarga la default del producto y guarda `estructura_id` en `inventario_lineas`.

### Fixes
- Banner DEV más fino (h-4) y sin overlap sobre header/sidebar.
- Badge estado_pago en cards de OC en ProveedoresPage.
- WhatsApp en EnviosPage: faltaba `telefono` en join de clientes.

### Housekeeping
- CLAUDE.md: reducido a ~120 líneas. Reglas de lectura/escritura wiki.
- Wiki: roadmap con v1.7.0, v1.8.0, v1.8.1. Plan multi-sucursal documentado.

### Plan aprobado — Multi-sucursal (pendiente implementar)
- Filtrado estricto: `.eq()` cuando sucursal activa, sin filtro para vista global.
- Agregar "Vista global" al SucursalSelector.
- Catálogo global, stock/movimientos/ventas/gastos/caja por sucursal, clientes globales.
- Datos NULL: solo visibles en vista global.
- Ver detalle en `wiki/features/multi-sucursal.md`.

**Estado al cierre:**
- PROD: v1.8.0 ✅ · DEV: v1.8.1 · Migrations DEV: 001–089 · PROD: 001–088
- Migration 089 (`recursos`): aplicar en PROD al deployar v1.8.1

---

## [2026-05-07] update | Limpieza CLAUDE.md + reglas wiki + roadmap v1.7.0/v1.8.0

**Cambios de sesión (2026-05-07):**

### CLAUDE.md — reescritura completa
- Reducido de ~1.500 líneas a ~120 líneas
- Eliminado: todo el historial de versiones (v0.26–v1.8.0), todas las secciones "Backlog pendiente" y "Decisiones de arquitectura" — ya están en el wiki
- Conservado: stack, git/deploy, Supabase IDs, estructura de proyecto, convenciones operacionales, planes, env vars, dominios, gotchas clave
- Agregado: sección "Wiki — Reglas de oro" con instrucciones de lectura al inicio y escritura al cierre de sesión. Unicidad de documentación en el wiki.

### Wiki roadmap.md actualizado
- Agregadas secciones v1.7.0 (API pull, migration 087) y v1.8.0 (NC electrónicas, email CAE, migration 088)
- Backlog actualizado: removidos ítems ya completados, agregados pendientes reales actuales
- Historial comprimido en tabla para versiones <v1.3.0

### Estado al cierre
- PROD: **v1.8.0** ✅ · DEV: **v1.8.0** ✅ (confirmado — era caché del browser)
- `main` branch: APP_VERSION = v1.6.0 (pero Vercel sirvió v1.8.0 correctamente)
- `dev` branch (código): **v1.8.0**

---

## [2026-05-06] update | Migración al SSD + consolidación docs — todo listo para compact

**Cambios de sesión (2026-05-06):**

### Migración de paths
- App movida: `E:\OneDrive\...\stockapp` → `D:\Dev\Genesis360` (SSD, fuera de OneDrive)
- Vault movido: `D:\Obsidian\boveda\Genesis360` → `D:\Dev\Genesis360\G360.Wiki` (dentro del repo)
- `npm install` ejecutado en nueva ubicación — build OK (`✓ built in 30.21s`)

### Consolidación de documentación
- `docs/` eliminado de la app — 8 archivos movidos a `G360.Wiki/sources/raw/`
- `G360.Wiki/CLAUDE.md` renombrado a `_schema.md` — evita confusión con CLAUDE.md de la app
- `Bienvenido.md` actualizado con nueva estructura y referencias
- `G360.Wiki/` commiteada en git (rama `dev`, commit `94b09930`)

### Paths actualizados
- `_schema.md`: código fuente apunta a `D:\Dev\Genesis360`
- Memory files: `project_genesis360.md` y `project_wiki_system.md` actualizados con nuevos paths y v1.6.0
- `index.md`: fuentes en raw/ documentadas

### Estado de cierre de sesión
- Versión PROD: v1.6.0 · 85 migraciones · 46 páginas wiki
- Sin pendientes en el wiki
- Listo para /clear o /compact

---

## [2026-05-06] update | Reestructura del vault — consolidación de fuentes

**Cambios estructurales:**
- `CLAUDE.md` renombrado a `_schema.md` — evita confusión con el CLAUDE.md de la app
- `Bienvenido.md` y `_schema.md` actualizados para reflejar el nuevo nombre y aclarar la diferencia
- `sources/raw/` poblado con los 8 archivos de `D:\Dev\Genesis360\docs/`:
  - `arquitectura_escalabilidad.md`
  - `reglas_negocio.md`
  - `uat.md`
  - `genesis360_overview.html`, `soporte_*.html` (×4)
- `index.md` actualizado con la tabla de fuentes
- `D:\Dev\Genesis360\docs/` se mantiene en la app (fuente original, no se borró)

**Regla de flujo confirmada:**
- Desarrollo → actualizar `CLAUDE.md` / `ROADMAP.md` en `D:\Dev\Genesis360\`
- Al terminar sesión → pedir "actualizá el wiki" → Claude sincroniza las páginas relevantes
- Consulta → abrir Obsidian en `G360.Wiki/`

Para ver las últimas 5 entradas: `grep "^## \[" log.md | tail -5`

---

## [2026-05-05] update | v1.5.0 + v1.6.0 — Notificaciones, Caja Fuerte, PDF AFIP, OC pagos, CC Proveedores

**Versiones detectadas como nuevas:** v1.5.0 (migration 084) y v1.6.0 (migration 085).  
**Fuentes leídas:** CLAUDE.md (líneas 1395-1441) + ROADMAP.md (encabezado + secciones v1.5.0/v1.6.0).

**Páginas actualizadas:**
- `wiki/features/facturacion-afip.md` — recreada (estaba en 0 bytes) + PDF con QR AFIP v1.5.0 ✅
- `wiki/features/caja.md` — diferencia apertura inline, Tab Caja Fuerte, Tab Configuración, getTipoDisplay, historial sesiones
- `wiki/features/alertas.md` — nuevas secciones OC vencidas (rojo) y próximas ≤3d (ámbar), badge actualizado
- `wiki/features/gastos.md` — Tab "Órdenes de Compra" con modal pago/CC, badges contextuales
- `wiki/features/clientes-proveedores.md` — pago CC inline FIFO + módulo CC Proveedores completo
- `wiki/business/roadmap.md` — v1.5.0 + v1.6.0 completos, versión actualizada a v1.6.0
- `wiki/database/migraciones.md` — migrations 084 + 085
- `wiki/overview/genesis360-overview.md` — v1.4.0 → v1.6.0, 83 → 85 migraciones, notificaciones en módulos

**Páginas nuevas:**
- `wiki/features/notificaciones.md` — módulo completamente nuevo: tabla, campana, email, diferencia caja

**Estado final:** 46 páginas · 85 migraciones documentadas · v1.6.0

---

## [2026-05-01] update | Wiki completo — sin pendientes

**Acción:** Finalización completa del wiki. Todas las páginas actualizadas, 6 páginas nuevas desde docs/.

**Páginas actualizadas (thin → completas):**
- `wiki/features/ventas-pos.md` — 3 modos, pago parcial, combos, CC, multi-LPN, scanner, carrito draft, QR MP
- `wiki/features/inventario-stock.md` — Sprints A/B/C/D, autorizaciones DEPOSITO, conteos, masivo inline, LPN madre
- `wiki/integrations/mercado-pago.md` — preapproval model, QR ventas, add-on, routing webhook, IDs PROD
- `wiki/overview/genesis360-overview.md` — v1.4.0, tabla módulos completa, arquitectura actualizada

**Páginas nuevas desde docs/:**
- `wiki/architecture/escalabilidad.md` — costos, capacidad escala, cola jobs, workers, Sentry, cloud
- `wiki/architecture/pwa-config.md` — Service Worker, WASM, SPA routing Vercel
- `wiki/development/reglas-negocio.md` — reglas relevadas con GO (caja, ventas, inventario) + UAT
- `wiki/business/mercado-objetivo.md` — SMB/mid-market LatAm, posicionamiento vs Blue Yonder
- `wiki/business/roadmap.md` — ya existía, sin cambios
- `wiki/integrations/resend-email.md` — ya existía, sin cambios

**Fuentes procesadas en total:**
- CLAUDE.md (1.461 líneas)
- ROADMAP.md (490 líneas)
- WORKFLOW.md (172 líneas)
- README.md (150 líneas)
- docs/arquitectura_escalabilidad.md (163 líneas)
- docs/reglas_negocio.md (335 líneas)
- docs/uat.md (196 líneas)

**Estado final:** 44 páginas wiki · 83 migraciones documentadas · v1.4.0 · sin pendientes

---

## [2026-05-01] update | Poblado completo desde CLAUDE.md + ROADMAP.md + WORKFLOW.md

**Acción:** Lectura completa de los 4 archivos de documentación de la app (1461 líneas CLAUDE.md, 490 ROADMAP.md, 172 WORKFLOW.md, 150 README.md) y creación masiva de páginas wiki.

**Páginas creadas/actualizadas:**
- `wiki/integrations/mercado-libre.md` — OAuth, mapeo, webhooks, sync worker, items OMNI
- `wiki/integrations/tienda-nube.md` — OAuth, webhooks, tn-stock-worker, BATCH_SIZE 200
- `wiki/features/facturacion-afip.md` — AfipSDK, tipos A/B/C, FacturacionPage 4 tabs, homologación confirmada
- `wiki/features/rrhh.md` — 5 fases completas con schema, funciones SQL, UI
- `wiki/features/caja.md` — sesiones, tipos de movimiento, multi-caja, traspasos, arqueos
- `wiki/features/gastos.md` — variables, fijos, IVA, comprobantes, múltiples medios
- `wiki/features/devoluciones.md` — serializado/no-serializado, NC, rollback, caja
- `wiki/features/wms.md` — fases 1-4, KITs, conteos, recepciones/ASN, mono-SKU
- `wiki/features/clientes-proveedores.md` — CRM, CC, domicilios, OC, servicios
- `wiki/features/envios.md` — estados, remito PDF, WhatsApp Click-to-Chat
- `wiki/features/autenticacion-onboarding.md` — OAuth, roles, session timeout, Mi Cuenta
- `wiki/features/marketplace.md` — API pública, webhook, rate limiting
- `wiki/architecture/estado-global.md` — authStore, useSucursalFilter, usePlanLimits, hooks
- `wiki/database/migraciones.md` — 83 migraciones con descripción (001-083)
- `wiki/development/testing.md` — 154+ unit tests, 14 archivos E2E, todos los roles
- `wiki/development/convenciones-codigo.md` — reglas, patterns, TypeScript, RLS
- `wiki/development/supabase-dev-vs-prod.md` — flujo completo, secrets, pg_cron
- `wiki/business/roadmap.md` — historial v0.26–v1.4.0, backlog detallado
- `index.md` — actualizado con todas las páginas y estados

**Estado del proyecto confirmado:** v1.4.0 en PROD · 83 migraciones · 154+ unit tests

---

## [2026-04-30] init | Wiki inicializado desde exploración del código fuente

**Acción:** Inicialización completa del wiki Genesis360.

**Qué se hizo:**
- Exploración del código fuente en `E:\OneDrive\Documentos\01_Gastón\04_Emprendimientos\04_StockApp\stockapp\stockapp`
- Creación de `CLAUDE.md` (schema y reglas del wiki)
- Creación de `index.md` (catálogo inicial de páginas)
- Creación de estructura de carpetas: `sources/`, `wiki/` y subcarpetas
- Creación de página de overview principal
- Creación de páginas de arquitectura, features y development

**Estado del proyecto al momento de la inicialización:**
- Versión activa en producción
- 83 migraciones de DB
- 26 Edge Functions
- ~80 archivos TypeScript/TSX
- Planes: Free / Basic ($4.900 ARS) / Pro ($9.900 ARS) / Enterprise

**Páginas creadas en este init:**
- `wiki/overview/genesis360-overview.md`
- `wiki/architecture/frontend-stack.md`
- `wiki/architecture/backend-supabase.md`
- `wiki/architecture/multi-tenant-rls.md`
- `wiki/architecture/edge-functions.md`
- `wiki/features/inventario-stock.md`
- `wiki/features/ventas-pos.md`
- `wiki/features/suscripciones-planes.md`
- `wiki/development/workflow-git.md`
- `wiki/development/deploy.md`
- `wiki/database/schema-overview.md`
- `wiki/integrations/mercado-pago.md`
