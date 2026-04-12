# Genesis360 — Contexto para Claude Code

> Roadmap completo: [ROADMAP.md](ROADMAP.md) · Workflow de deploy: [WORKFLOW.md](WORKFLOW.md)

## Producto
"El cerebro del negocio físico" — no muestra datos, dice qué hacer.

## Stack
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions + Storage)
- **Deploy:** Vercel (frontend) + Supabase (backend) · **Pagos:** Mercado Pago
- **Librerías:** recharts, jspdf, jspdf-autotable, xlsx, @zxing/library

## Git / Deploy
- `main` = producción. Claude Code **NUNCA** hace push a `main`.
- Todo en `dev` → PR → merge a `main`. Ver `WORKFLOW.md`.
- GH_TOKEN en Windows Credential Manager (`git credential fill`). No en `.env.local`.
- Co-Authored-By: siempre `GNO <gaston.otranto@gmail.com>` en todos los commits.

### ⚠ Checklist obligatorio en cada deploy a PROD (sin excepción)
1. **Bump `APP_VERSION`** en `src/config/brand.ts` → versión visible en el sidebar de la app
2. **PR dev → main** con título `vX.Y.Z — Descripción`
3. **GitHub release** sobre `main` con tag `vX.Y.Z` y notas
4. **Docs actualizados**: `CLAUDE.md` (marcar ✅ PROD) · `WORKFLOW.md` (fila en tabla) · `memory/project_pendientes.md`

## Supabase
- **PROD**: `jjffnbrdjchquexdfgwq` — NO tocar directamente
- **DEV**: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`
- Migrations: `supabase/migrations/NNN_*.sql` → aplicar en DEV → actualizar `schema_full.sql` → commit → aplicar en PROD al deployar

## Arquitectura multi-tenant
- Todas las tablas tienen `tenant_id` con RLS habilitado
- Patrón RLS: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- Helper functions SECURITY DEFINER: `is_admin()` (ADMIN global) · `is_rrhh()` (RRHH o OWNER)
- Roles: `OWNER` · `SUPERVISOR` · `CAJERO` · `RRHH` · `ADMIN`

## Estructura del proyecto
```
src/
├── config/
│   ├── brand.ts           # FUENTE ÚNICA nombre/marca/colores
│   └── tiposComercio.ts
├── lib/
│   ├── supabase.ts        # Cliente + interfaces TypeScript
│   ├── actividadLog.ts    # logActividad() fire-and-forget
│   └── rebajeSort.ts      # getRebajeSort() — FIFO/FEFO/LEFO/LIFO/Manual
├── store/authStore.ts     # Zustand: user, tenant, loadUserData
├── hooks/
│   ├── useAlertas.ts / useGruposEstados.ts / usePlanLimits.ts
│   ├── useCotizacion.ts   # hook global — no estado local por página
│   └── useModalKeyboard.ts  # ESC=cerrar / Enter=confirmar en modales
├── components/
│   ├── AuthGuard.tsx      # AuthGuard + SubscriptionGuard (mismo archivo, nunca separar)
│   ├── LpnAccionesModal.tsx / Walkthrough.tsx
│   └── layout/AppLayout.tsx
└── pages/
    ├── LandingPage.tsx / LoginPage.tsx / OnboardingPage.tsx
    ├── DashboardPage.tsx        # Tabs: General / Insights / Métricas / Rentabilidad / Recomendaciones
    ├── ProductosPage.tsx        # Tabs: Productos (listado + resumen expandible + estructura default) / Estructura (CRUD completo)
    ├── InventarioPage.tsx       # Tabs: Movimientos (ingreso/rebaje) / Inventario (LPNs + LpnAccionesModal)
    ├── VentasPage.tsx           # Carrito + checkout; caja integrada; widget estado caja
    ├── RrhhPage.tsx             # Empleados, puestos, departamentos, cumpleaños
    ├── AlertasPage.tsx / MetricasPage.tsx / ReportesPage.tsx
    ├── CajaPage.tsx             # Shortcuts: Shift+I ingreso / Shift+O egreso
    ├── GastosPage.tsx           # Egreso automático en caja al pagar en efectivo
    ├── UsuariosPage.tsx / AdminPage.tsx / HistorialPage.tsx
    ├── ConfigPage.tsx           # Tabs: negocio, categorías, proveedores, ubicaciones,
    │                            #   estados, motivos, combos, grupos, aging profiles
    ├── ProductoFormPage.tsx     # regla_inventario + aging_profile_id por SKU
    ├── ImportarProductosPage.tsx / SuscripcionPage.tsx
    └── GruposEstadosPage.tsx    # → redirige a /configuracion (tab integrada)
```

## Convenciones
- Nombre app: siempre `BRAND.name` de `src/config/brand.ts`, nunca hardcodeado
- `logActividad()`: sin await (fire-and-forget). Nunca lanzar errores.
- `SubscriptionGuard`: siempre en `AuthGuard.tsx`, nunca en archivo separado
- `medio_pago` en `ventas`: JSON string `[{"tipo":"Efectivo","monto":1500}]`
- Triggers recalculan `stock_actual` automáticamente — nunca actualizar manualmente
- `ownerOnly: true` → OWNER+ADMIN; `supervisorOnly: true` → OWNER+SUPERVISOR+ADMIN
- Rutas: verificar que existen en `App.tsx` antes de `navigate()`
- `CREATE POLICY IF NOT EXISTS` no existe en PostgreSQL — usar bloque `DO $$ BEGIN IF NOT EXISTS ...`

## Planes y límites
| Plan | Usuarios | Productos | Precio |
|------|----------|-----------|--------|
| Free | 1 | 50 | $0 |
| Básico | 2 | 500 | $4.900/mes |
| Pro | 10 | 5.000 | $9.900/mes |
| Enterprise | ∞ | ∞ | A consultar |

## Variables de entorno
```
VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_MP_PUBLIC_KEY
VITE_MP_PLAN_BASICO / VITE_MP_PLAN_PRO / VITE_APP_URL
MP_ACCESS_TOKEN (solo Edge Functions)
```

## Deploy
- Repo: https://github.com/genesis360-app/genesis360
- `vercel.json` obligatorio para SPA routing (`rewrites` a `/index.html`)
- Preview `dev`: desactivar Vercel Authentication en Settings → Deployment Protection

## Dominios
- `www.genesis360.pro` → muestra LandingPage (marketing)
- `app.genesis360.pro` → redirige `/` a `/login` directo (usuarios existentes)
- `vercel.json`: `redirects` con `has.host = app.genesis360.pro` para redirigir `/` → `/login`
- `App.tsx`: `isAppDomain` detecta hostname en runtime como fallback
- `VITE_APP_URL` en Vercel Production: `https://app.genesis360.pro`
- Supabase PROD → Redirect URLs: `https://app.genesis360.pro/**` ✅
- Vercel → Domains: `app.genesis360.pro` ✅

---

## Decisiones de arquitectura

### Auth / Onboarding
- **Google OAuth**: `loadUserData` no encuentra `users` → `needsOnboarding:true` → `AuthGuard` redirige a `/onboarding`. Al guardar, NO llama `signUp()`. Llamar `await loadUserData(userId)` ANTES de `navigate('/dashboard')`.
- **RLS SELECT-after-INSERT**: generar UUID en cliente con `crypto.randomUUID()`, nunca SELECT del tenant recién insertado.

### RLS / Supabase
- Políticas: siempre subquery, nunca funciones dentro de políticas que participan en la query.
- Orden del schema: tablas helper → `planes` → `tenants` → `users` → funciones → resto → triggers → RLS.

### Mercado Pago
- Modelo preapproval. `external_reference=tenant_id` para identificar en webhook.
- Planes en `brand.ts` → `MP_PLAN_IDS`: Básico `5823af4a325946f2a88538e3a2fe2dd3` ($4900 ARS/mes) · Pro `e66cf7cd36e84b768b229657e81b0c0f` ($9900 ARS/mes)
- `init_point` construido en frontend directo: `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id={id}&external_reference={tenant_id}&back_url={appUrl}/suscripcion`
- **No usar** `POST /preapproval` vía Edge Function — MP requiere `card_token_id` que no tenemos en este flujo.
- `mp-webhook` y `crear-suscripcion` deployadas en DEV con `--no-verify-jwt` ✅
- **⚠ Pendiente**: registrar webhook en MP Dashboard → `https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-webhook`
- **⚠ Pendiente**: deployar `mp-webhook` en PROD con `--no-verify-jwt`

### IA — scan-product
- Edge Function `scan-product`: imagen base64 → Claude Haiku → si hay barcode → Open Food Facts
- Modelo: `claude-haiku-4-5-20251001` (~$0.0003/imagen). **Requiere créditos en console.anthropic.com**

### Emails transaccionales (Resend)
- Edge Function `send-email`: tipos `welcome`, `venta_confirmada`, `alerta_stock`. Fire-and-forget.
- FROM temporal: `onboarding@resend.dev`. **Cambiar a `noreply@genesis360.pro`** cuando se verifique el dominio en Resend.

### Movimientos y reserva de stock
- `linea_id` en `movimientos_stock`: FK a `inventario_lineas`. Siempre guardar al insertar ingresos/rebajes.
- `cantidad_reservada` en `inventario_lineas` / `reservado` en `inventario_series`: stock comprometido.
- Stock físico solo disminuye al pasar venta a `estado='despachada'`.
- `linea_id` en `venta_items`: existe en schema pero **nunca se escribe** (deuda técnica).

### Reglas de selección de inventario (migración 011)
- `tenants.regla_inventario` (default `FIFO`) + `productos.regla_inventario` nullable (override por SKU).
- Jerarquía: **SKU > negocio > FIFO** (fallback hardcoded).
- Helper: `src/lib/rebajeSort.ts` → `getRebajeSort(reglaProducto, reglaTenant, tieneVencimiento)`
- FIFO/LIFO/Manual: sort primario = `ubicaciones.prioridad ASC` (sin ubicación = 999).
- FEFO/LEFO: ignoran prioridad; requieren `tiene_vencimiento=true` o hacen fallback a FIFO.

### Prioridad + disponible_surtido en ubicaciones (migraciones 010, 012)
- `prioridad INT DEFAULT 0` en `ubicaciones` (NO en lineas). Config UI en ConfigPage → Ubicaciones.
- `disponible_surtido BOOLEAN DEFAULT TRUE`: líneas con NULL `ubicacion_id` o `false` → excluidas de ventas.

### Aging Profiles (migración 013)
- Tablas: `aging_profiles` + `aging_profile_reglas` (estado_id, dias). Asignado por SKU en ProductoFormPage.
- Función SQL `process_aging_profiles()` SECURITY DEFINER: calcula `dias_restantes`, aplica regla con menor `dias >= dias_restantes`, cambia estado, inserta en `actividad_log`.
- Edge Function `process-aging` + botón manual en ConfigPage → Aging Profiles.
- **⚠ Pendiente**: scheduler diario (Vercel Cron / GitHub Actions / pg_cron).

### Caja ↔ Ventas ↔ Gastos (v0.27.0)
- Solo medio de pago `Efectivo` genera movimiento en caja (tarjeta/transferencia/MP no afectan caja física).
- Venta `despachada` con efectivo → `ingreso` automático en `caja_movimientos`.
- Gasto nuevo con efectivo → `egreso` automático en `caja_movimientos` (fire-and-forget, no bloquea).
- Bloqueo en venta: si efectivo > 0 y no hay sesión abierta → error, no se puede despachar.
- Múltiples cajas abiertas → selector UI en checkout/modal. 1 caja → auto-selección con badge verde.
- Helper `calcularEfectivo(mediosPago, total)` en VentasPage (función pura, fuera del componente).
- Query key compartida: `['caja-sesiones-abiertas', tenant?.id]` con `refetchInterval: 60_000`.
- cambiarEstado historial → despachada: usa primera sesión abierta disponible (sin bloqueo).

### Ventas
- `numero`: trigger `set_venta_numero` (BEFORE INSERT, MAX+1 por tenant). **Nunca** enviar en INSERT.
- Combos: tabla `combos` (producto_id, cantidad, descuento_pct). No afectan stock.
- Indicador live caja: `useQuery` en AppLayout con refetch 60s → punto verde/rojo en nav.

### RRHH Phase 1 (migración 014)
- Tablas: `empleados`, `rrhh_puestos`, `rrhh_departamentos` con RLS. Soft delete `activo=false`.
- Rol `RRHH`: acceso delegado. Helper `is_rrhh()` SECURITY DEFINER. UNIQUE(tenant_id, dni_rut).
- Fases 2–5 en ROADMAP.md.

### Dashboard + Métricas (v0.28.0)
- **Dashboard sin movimiento**: prods inactivos se obtienen del query principal (productos select incluye `nombre, sku`). `rebajesRecientes` selecciona `producto_id, cantidad` → `velocidadMap`. `prodsInactivos` y `prodsCriticos` retornados en stats.
- **Sugerencia de pedido**: `prodsCriticos = prods.filter(stock_actual <= stock_minimo)`. `diasCobertura = floor(stock_actual / (vendido30d/30))`. `sugerido = vendido30d > 0 ? ceil(vendido30d*1.2) - stock_actual : stock_minimo*2 - stock_actual`.
- **Ganancia neta**: `costoVentas = sum(rankingProductos[p].costo * cantidad)`. `gananciaNeta = totalVentas - costoVentas - gastosTotal`. Query `gastos` usa campo `fecha` (date string), no `created_at`.
- **Rango personalizado**: tipo `Periodo = '7d'|'30d'|'90d'|'mes'|'custom'`. `getFechaDesde()` y `getFechaHasta()` manejan `custom`. Query ventas agrega `.lte('created_at', getFechaHasta())` solo para custom.
- **Filtro categoría**: `categoriaFiltro: string | null` en estado. `rankingProductos` incluye `categoria_id`. Filtra `topProductos`, `sinMovimiento` y `margenProductos`.

### Ventas + Métricas (v0.29.0)
- **Trazabilidad LPN→venta**: `linea_id` en `venta_items` (columna ya existía en schema). Non-series: pre-fetch linea primaria en `agregarProducto` usando `getRebajeSort` → guarda en `CartItem.linea_id`. Series: `linea_id` del primer serie seleccionado (null si múltiples lineas).
- **LPN en carrito**: badge azul junto al SKU para non-series; LPNs únicos (deduplicados desde `series_disponibles`) debajo de chips de series seleccionadas.
- **Vista galería ventas**: toggle lista/galería (LayoutGrid/List). Galería: grid 2-3 col con imagen, nombre, SKU, precio, stock. limit 60 en galería. `viewMode` en queryKey para refetch al cambiar.
- **Margen objetivo**: `productos.margen_objetivo DECIMAL(5,2)` nullable (migración 015). Campo en ProductoFormPage con indicador ▲/▼ tiempo real.
- **Insights margen**: `insightsMargen = productos.filter(margen_objetivo != null).map(calcularDesvioPP)`. Solo aparece si hay productos con objetivo. Ordenado por `diff ASC` (peores primero).
- **Métricas inventario**: query `movimientos_stock` por tipo/motivo en período → `motivosMap` con count/cantidad. Query `inventario_lineas` join `ubicaciones`+`productos` → `ubicacionMap` con valor (cantidad × precio_costo).

### v0.30.0 — Sprint UX (incluido en v0.31.0 deploy)
- **Bug #19 fix**: ImportarProductosPage — `numeros_serie` en Excel → inserta `inventario_series`, cantidad = len(series).
- **Proyección de cobertura**: DashboardPage — semáforo rojo ≤7d / ámbar ≤14d / verde >14d, colapsable.
- **LPN en historial/ticket**: historial incluye `inventario_lineas(lpn)` + `venta_series(nro_serie)`. Modal y ticket muestran LPN/S/N.
- **Motivos predefinidos caja**: `tipo='caja'` en `motivos_movimiento`. CajaPage chips pre-llenan Concepto.
- **Invitación por email**: EF `invite-user` → `admin.inviteUserByEmail` + pre-crea `users`. Sin campo contraseña.
- **Importación masiva clientes**: drag-drop/click, preview, duplicados por nombre case-insensitive.
- **Combos multi-tipo**: `descuento_tipo` (`pct`/`monto_ars`/`monto_usd`) + `descuento_monto` (migración 016). VentasPage convierte USD→ARS vía `cotizacionUSD`.
- **Sidebar colapsable**: ChevronLeft/Right, `w-16` modo colapsado, localStorage. Mobile no afectado.
- **useModalKeyboard**: wired en MovimientosPage, GastosPage, UsuariosPage, VentasPage (seriesModal + ventaDetalle).
- **Caja ingresos informativos**: pagos no-efectivo de ventas → `tipo='ingreso_informativo'` (no afecta saldo). CajaPage muestra en azul con `~` e icono `Info`.

### v0.31.0 — Header, dark mode, UX fixes (deployado a PROD via PR #20)
- **Header universal**: `darkMode:'class'` en Tailwind + toggle Moon/Sun en header. Header visible siempre (no solo mobile): brand name + user/rol a la izquierda; Moon/Sun, LifeBuoy (soporte), HelpCircle (tour), LogOut a la derecha. Tour y logout removidos del sidebar.
- **Dashboard fixes**: Stock Crítico → `/alertas`. Links "Ver métricas" usan `setTab('metricas')` (no navegan a `/metricas`) → pestañas persisten. Insights con link `/metricas` también usan `setTab`.
- **Ventas lista view**: imagen miniatura (w-8) a la izquierda en dropdown de búsqueda.
- **Ventas galería**: `max-h-[28rem]`, cards `h-full` para altura uniforme.
- **Modal series**: buscador de N/S y LPN en el modal de selección de series.
- **Caja egreso**: bloquea si monto > saldoActual.
- **Gastos caja cerrada**: bloquea nuevo gasto en efectivo si no hay sesión de caja abierta.
- **Movimientos UX**: búsqueda limita a 5 resultados; label Cantidad muestra UoM; motivos predefinidos → text field oculto salvo "Otro"; mensaje "Sin datos de línea" distingue linea_id null vs linea eliminada.
- **Reportes fixes**: Stock actual agrega N° Lote + Vencimiento + expande por series serializadas; Ventas parsea JSON de medio_pago; Estados exporta correctamente (quitado filtro activo).

### v0.32.0 — Dark mode completo + RRHH Phase 2A Nómina (en dev)
- **Dark mode completo**: `index.css` overrides globales (inputs/selects/textareas/scrollbar). 30+ archivos (páginas + componentes) con `dark:bg-*`, `dark:text-*`, `dark:border-*`, `dark:hover:*` y variantes de estado (red/amber/green/blue).
- **RRHH Phase 2A — Nómina** (migración 017):
  - `rrhh_conceptos`: catálogo de haberes/descuentos reutilizables por tenant. RLS + índices.
  - `rrhh_salarios`: liquidación por empleado × periodo (DATE YYYY-MM-01). UNIQUE(tenant+empleado+periodo). Campos: basico, total_haberes, total_descuentos, neto, pagado, fecha_pago, caja_movimiento_id.
  - `rrhh_salario_items`: líneas de detalle. Trigger `fn_recalcular_salario` recalcula totals en padre tras INSERT/UPDATE/DELETE.
  - `pagar_nomina_empleado(p_salario_id, p_sesion_id)` SECURITY DEFINER: valida sesión caja abierta → inserta egreso en `caja_movimientos` → marca `pagado=TRUE`.
  - UI tab "Nómina" en RrhhPage: selector mes/año, generar nómina mes (crea borrador para todos los activos), resumen período, tabla expandible por empleado con ítems, botón Pagar con selector caja.
  - Catálogo de conceptos CRUD colapsable dentro de la tab.
  - `actividadLog`: + `nomina` en EntidadLog, + `pagar` en AccionLog.

### v0.34.0 — RRHH Phase 3B Dashboard (en dev)
- **Tab Dashboard** en RrhhPage (primera tab, con `LayoutDashboard` icon). Seleccionable mes de referencia.
- **KPIs empleados**: total activos, nuevos este mes, cumpleaños del mes, cantidad de departamentos.
- **KPIs asistencia**: % presencia, presentes/tardanzas/ausentes/licencias del mes seleccionado.
- **KPIs vacaciones**: pendientes de aprobación, aprobadas, días hábiles usados en el año.
- **KPIs nómina**: último período, liquidaciones totales/pagadas, pendientes de pago + monto.
- **Breakdown por departamento**: barra proporcional + count por cada departamento.
- **Exportar reportes Excel**: Asistencia mensual (`asistencia_YYYY-MM.xlsx`) + Nómina histórica (`nomina_historica.xlsx`) usando `xlsx` library.
- Queries: `dashAsist`, `dashVac`, `dashNomina` (enabled solo cuando tab='dashboard').
- Funciones: `exportAsistenciaMes()`, `exportNominaHistorica()` (on-demand, query fresca).

### v0.33.0 — RRHH Phase 2B Vacaciones + Phase 3A Asistencia (en dev)
- **RRHH Phase 2B — Vacaciones** (migración 018):
  - `rrhh_vacaciones_solicitud`: estado `pendiente/aprobada/rechazada`, dias_habiles calculados (excluye fines de semana), aprobado_por + aprobado_at.
  - `rrhh_vacaciones_saldo`: días totales asignados × año + remanente anterior + días usados. UNIQUE(tenant+empleado+anio).
  - `aprobar_vacacion(p_solicitud_id, p_user_id)` SECURITY DEFINER: upsert saldo + marca aprobada.
  - `rechazar_vacacion(p_solicitud_id, p_user_id)` SECURITY DEFINER: marca rechazada.
  - `calcular_dias_habiles(desde, hasta)` SQL: usa `generate_series` excluyendo DOW 0 y 6.
  - UI tab "Vacaciones" en RrhhPage: selector año, nueva solicitud con preview días hábiles, lista con aprobar/rechazar, saldos colapsables por empleado (editar dias_totales + remanente).
- **RRHH Phase 3A — Asistencia** (migración 019):
  - `rrhh_asistencia`: UNIQUE(tenant+empleado+fecha). Estados: presente/ausente/tardanza/licencia. Campos: hora_entrada, hora_salida, motivo.
  - UI tab "Asistencia": filtro mes + empleado, tabla con badges por estado, CRUD completo.
  - `actividadLog`: + `vacacion` y `asistencia` en EntidadLog.
- `calcularDiasHabilesFrontend(desde, hasta)`: helper frontend, excluye sábado y domingo.

### Marketplace (migración 020)
- **Campos en `productos`**: `publicado_marketplace BOOLEAN`, `precio_marketplace DECIMAL(12,2)`, `stock_reservado_marketplace INT`, `descripcion_marketplace TEXT`.
- **Campos en `tenants`**: `marketplace_activo BOOLEAN`, `marketplace_webhook_url TEXT`.
- **Edge Function `marketplace-api`** (pública, sin JWT): `GET ?tenant_id=uuid` → devuelve productos con `publicado_marketplace=true`. Stock disponible = `stock_actual - stock_reservado_marketplace - suma(cantidad_reservada en inventario_lineas)`. Rate limiting 60 req/min por IP en memoria del isolate. CORS abierto.
- **Edge Function `marketplace-webhook`**: recibe `{ producto_id }` (autenticado desde frontend o como DB Webhook). Busca `marketplace_webhook_url` en tenant → envía POST con `{ tenant_id, producto_id, sku, nombre, stock_disponible, timestamp }`. Timeout 10s. Fire-and-forget desde el frontend.
- **UI en ProductoFormPage**: sección "Marketplace" colapsable (auto-abre si el producto ya está publicado). Solo visible si `tenant.marketplace_activo = true`. Toggle publicar + precio marketplace + stock reservado + descripción pública.
- **Activar marketplace**: desde Supabase Dashboard o SQL: `UPDATE tenants SET marketplace_activo = true WHERE id = '<tenant_id>'`.
- **Configurar webhook externo**: `UPDATE tenants SET marketplace_webhook_url = '<url>' WHERE id = '<tenant_id>'`.

### Revenue — Límites de movimientos (v0.36.0, migración 021)
- **Límites por plan** en `brand.ts` → `MAX_MOVIMIENTOS_POR_PLAN`: Free=200 · Básico=2.000 · Pro/Enterprise=-1 (ilimitado).
- **`tenants.addon_movimientos INT DEFAULT 0`**: movimientos extra comprados (se suman al límite del plan).
- **`usePlanLimits`**: cuenta `movimientos_stock` del mes en curso. Expone `plan_id`, `max_movimientos`, `movimientos_mes`, `puede_crear_movimiento`, `pct_movimientos` + feature flags: `puede_reportes`, `puede_historial`, `puede_metricas`, `puede_importar`, `puede_rrhh`, `puede_aging`, `puede_marketplace`.
- **MovimientosPage**: banner con barra de progreso (green/amber ≥80%/red ≥100%); botones Ingreso y Rebaje deshabilitados; bloqueo también en `mutationFn`.
- **SuscripcionPage**: widget de uso del mes + card add-on (+500 movs $990 vía email precompletado).
- **Activar add-on manualmente**: `UPDATE tenants SET addon_movimientos = addon_movimientos + 500 WHERE id = '...'`
- **Pendiente**: add-on con pago automático MP.

### Matriz de funcionalidades por plan (v0.37.0)
- **`FEATURES_POR_PLAN`** en `brand.ts`: mapa `plan_id → string[]` con features habilitadas. `PLAN_REQUERIDO` mapea feature → plan mínimo.
- **Matriz actual**:
  - Free: inventario, movimientos, alertas, ventas, caja, gastos, clientes
  - Básico: + reportes, historial, metricas
  - Pro/Enterprise: + importar, rrhh, aging, marketplace
- **`usePlanLimits`**: expone `puede_reportes`, `puede_historial`, `puede_metricas`, `puede_importar`, `puede_rrhh`, `puede_aging`, `puede_marketplace`.
- **`UpgradePrompt`** (`src/components/UpgradePrompt.tsx`): componente reutilizable con lock icon, mensaje y botón → `/suscripcion`. Props: `feature: keyof PLAN_REQUERIDO`.
- **Sidebar**: candado pequeño junto al label en items bloqueados (`planFeature` en navItems). Ítem sigue siendo navegable → muestra UpgradePrompt adentro.
- **Páginas bloqueadas con early return**: `ReportesPage`, `HistorialPage`, `ImportarProductosPage`, `RrhhPage`. **Tab bloqueada**: Métricas en `DashboardPage`.
- **Para agregar una nueva feature bloqueada**: 1) agregar a `FEATURES_POR_PLAN` y `PLAN_REQUERIDO`; 2) agregar flag en `usePlanLimits`; 3) early return con `<UpgradePrompt feature="..." />` en la página.
- **⚠ Rules of Hooks**: el early return SIEMPRE debe ir después de que todos los hooks estén declarados (al final, justo antes del `return` principal). Nunca entre llamadas a hooks.

### Hooks / Compactación
- PostCompact hook en `.claude/settings.local.json`: inyecta contexto post-compactación.
- Compactar manualmente con `/compact` cuando el contexto esté pesado.

---

### RRHH Phase 2C + 4A (migración 022)
- **`nombre` + `apellido`** en `empleados` (NOT NULL DEFAULT ''). Helper `nombreEmpleado()` centraliza display.
- **Tab Cumpleaños**: `proximoCumpleanos()` calcula días correctamente; card con edad; highlight para el día exacto.
- **EF `birthday-notifications`**: GET/POST → filtra empleados activos con cumpleaños hoy (EXTRACT month+day) → inserta en `actividad_log`. No requiere JWT.
- **GitHub Actions** `.github/workflows/birthday-notifications.yml`: cron `0 8 * * *` (8 AM UTC). Requiere secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` en repo.
- **`rrhh_documentos`**: tenant_id, empleado_id, nombre, tipo (contrato/cert/cv/foto/otro), storage_path, tamanio, mime_type, created_by. RLS tenant.
- **Storage bucket `empleados`** (privado, 10 MB max): path = `{empleado_id}/{timestamp}.{ext}`. URL firmada temporal (300s) para descarga.
- **Tab Documentos** en RrhhPage: filtro por empleado, form upload (select, input file), lista con Ver (signed URL) y Eliminar.
- **Trial = Pro completo**: `usePlanLimits` detecta `subscription_status='trial'` con `trial_ends_at` futuro → usa `FEATURES_POR_PLAN['pro']` en lugar del plan real.
- EF deployada en PROD ✅. GitHub Actions secrets configurados ✅.

### RRHH Phase 4B (migración 023)
- **`rrhh_capacitaciones`**: tenant_id, empleado_id, nombre, descripcion, fecha_inicio, fecha_fin, horas, proveedor, estado (planificada/en_curso/completada/cancelada), resultado, certificado_path, created_by. RLS tenant.
- **certificado_path**: reutiliza bucket `empleados`; path = `{empleado_id}/cap_{timestamp}.{ext}`. URL firmada (300s) para ver.
- **Tab Capacitaciones** en RrhhPage: filtro por empleado + estado, form crear/editar, lista con badge de estado, botón Ver Cert, edit, delete.

### RRHH Phase 5 — Supervisor Self-Service (migración 024)
- **`get_supervisor_team_ids()`** SECURITY DEFINER STABLE: devuelve IDs de empleados donde `supervisor_id = auth.uid()`.
- **RLS SUPERVISOR** (PERMISSIVE, se suman a políticas existentes): `rrhh_asistencia`, `rrhh_vacaciones_solicitud`, `rrhh_vacaciones_saldo`, `empleados` (FOR SELECT) — solo acceden a su equipo.
- **Tab "Mi Equipo"** en RrhhPage: visible para SUPERVISOR (default tab) y OWNER/RRHH. SUPERVISOR ve KPIs asistencia hoy (presentes/ausentes/sin registrar) + vacaciones pendientes del equipo con botones Aprobar/Rechazar.
- **Árbol Organizacional**: sección en tab "equipo" visible para todos los roles. Agrupa empleados por supervisor_id. Sin supervisor = sección "Sin supervisor asignado". Cada supervisor muestra su equipo con indentación y borde izquierdo azul.
- **Tabs por rol**: SUPERVISOR ve solo `equipo, asistencia, vacaciones, cumpleanos`. OWNER/RRHH ven todos los tabs.
- **esSupervisor / esRrhhAdmin**: variables booleanas derivadas de `user?.rol` usadas para filtrar tabs y lógica.

### v0.41.0 — Insights automáticos + Mi Plan + Tests (en dev)

#### Insights automáticos
- **`useRecomendaciones`** extendido con 4 reglas nuevas (11 reglas en total):
  - **Cobertura crítica** (`cobertura-critica`): productos con < 3 días de stock al ritmo actual. Usa `ventaItems30d` para calcular velocidad por producto. `danger`.
  - **Margen realizado bajo** (`margen-realizado-bajo`): margen real del mes (precio_unitario - precio_costo_historico sobre venta_items) < 15%. `warning`.
  - **Día de semana flojo** (`dia-flojo`): 90 días de ventas agrupadas por DOW → detecta días con < 50% del promedio con ≥4 semanas de datos. `info`.
  - **Cumpleaños del mes** (`cumpleanos-mes`): query a `empleados` filtrando `EXTRACT(month) = mes_actual`. `info`. No bloquea si no hay RRHH habilitado (tabla vacía = sin regla).
- Nuevas queries en `queryFn`: `ventas90d` (para análisis DOW) + `empleadosMes` (para cumpleaños).
- **Tab "Insights"** en `DashboardPage`: tercer tab junto a General y Métricas. Muestra score de salud completo con barras por dimensión (Rotación/Rentabilidad/Reservas/Crecimiento/Datos) + lista completa de recomendaciones con descripción expandida + CTA.
- Refactor `tabButtons()`: función local en DashboardPage que centraliza los 3 botones, elimina duplicación de JSX entre early returns.

#### Acceso a Mi Plan (UX fix)
- **Sidebar**: indicador "Mi Plan" permanente al fondo (entre nav y CotizacionWidget). Muestra plan actual capitalizado. Link a `/suscripcion`. Colapsado: solo `CreditCard` icon con tooltip. **Resuelve el gap donde `/suscripcion` era inaccesible sin trial activo.**

#### Testing automatizado
- **Vitest** (`npm run test:unit`): 49 tests, todos verdes. Funciones puras sin Supabase:
  - `tests/unit/rebajeSort.test.ts`: FIFO/LIFO/FEFO/LEFO/Manual, jerarquía, prioridades
  - `tests/unit/brand.test.ts`: planes, features, límites de movimientos, PLAN_REQUERIDO
  - `tests/unit/planLimits.test.ts`: cálculo límites, add-ons, trial activo/vencido
  - `tests/unit/insights.rules.test.ts`: cobertura, margen realizado, días flojos
- **Playwright** (`npm run test:e2e`): E2E con auth real contra DEV. 12 archivos spec (01_dashboard → 12_navegacion_sidebar). Requiere `tests/e2e/.env.test.local` con `E2E_EMAIL` y `E2E_PASSWORD`.
- **GitHub Actions** `.github/workflows/tests.yml`: unit tests en cada push a `dev`; E2E opcional con `vars.RUN_E2E=true` + secrets.
- **Para activar E2E en CI**: en GitHub repo → Settings → Variables → `RUN_E2E=true` + Secrets: `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`.

### v0.42.0 — Multi-sucursal

#### Arquitectura multi-sucursal
- **Migration 025**: tabla `sucursales` (tenant_id, nombre, dirección, teléfono, activo) + `sucursal_id UUID nullable` en 6 tablas operativas: `inventario_lineas`, `movimientos_stock`, `ventas`, `caja_sesiones`, `gastos`, `clientes`. RLS tenant-based. 6 índices.
- **`authStore`**: nuevos campos `sucursales: Sucursal[]` y `sucursalId: string | null`. `loadUserData` carga sucursales activas y valida que el ID en localStorage sigue siendo válido (se resetea si la sucursal fue eliminada). `setSucursal(id)` persiste en localStorage.
- **`useSucursalFilter`** (`src/hooks/useSucursalFilter.ts`): `applyFilter(q)` agrega `.eq('sucursal_id', sucursalId)` solo si hay sucursal activa. Sin sucursal seleccionada → vista global.
- **`SucursalSelector`**: `<select>` en el header (AppLayout), visible solo cuando `sucursales.length > 0`. Primera opción: "Todas las sucursales" (valor vacío = null).
- **`SucursalesPage`** (`/sucursales`, OWNER-only): CRUD. Tras mutación llama `loadUserData` para sincronizar el selector del header.
- **Filtros aplicados**:
  - Read: `inventario_lineas`, `movimientos_stock`, `ventas`, `gastos`, `clientes`. QueryKey incluye `sucursalId` para invalidación automática.
  - Write: `sucursal_id: sucursalId || null` en inserts de movimientos (ingreso/rebaje), ventas, gastos, clientes, caja_sesiones.
- **Invariante**: datos existentes con `sucursal_id = NULL` siempre visibles en vista global. Al seleccionar una sucursal solo se ven los datos de esa sucursal.

### v0.43.0 — Fixes, filtros y RRHH nómina

#### check_stock_minimo SECURITY DEFINER
- Trigger `productos_stock_check` AFTER UPDATE → `check_stock_minimo()`. Sin SECURITY DEFINER, `auth.uid()` no está disponible en el contexto del trigger → INSERT en alertas falla por RLS → 400. Fix: `SECURITY DEFINER` ejecuta con privilegios del owner.

#### Ventas — filtro categoría en historial
- Estado `filterCategoria: string` + query `categoriasHistorial` (lazy, solo cuando `tab === 'historial'`).
- Ventas query agrega `categoria_id` al select de `productos` dentro de `venta_items`.
- `filteredVentas`: filtra si algún `venta_items[].productos.categoria_id === filterCategoria`.
- Select solo aparece si `categoriasHistorial.length > 0`.

#### Alertas — productos sin categoría
- Query `sinCategoria`: `productos WHERE activo=true AND categoria_id IS NULL ORDER BY nombre`.
- Sección naranja con icono `Tag`. `totalAlertas` incluye `sinCategoria.length`.
- Link `to="/inventario/:id/editar"` (ruta correcta en App.tsx).

#### RRHH Nómina (migration 026)
- `medio_pago` en `rrhh_salarios`: DEFAULT 'efectivo', CHECK IN ('efectivo','transferencia_banco','mp').
- `pagar_nomina_empleado(p_salario_id, p_sesion_id, p_medio_pago DEFAULT 'efectivo')`: para `p_medio_pago='efectivo'` calcula saldo = `monto_apertura + ingresos - egresos` de la sesión y lanza EXCEPTION si saldo < neto.
- UI: `medioPagoNomina` state en RrhhPage; select junto al selector de caja. Fila pagada muestra el medio de pago.
- **Historial de sueldos**: `historialEmpleadoId` state + `historialSueldos` query (enabled solo cuando `showHistorialSueldos && historialEmpleadoId`). Tabla colapsable con período, básico, haberes, descuentos, neto, estado, medio de pago.

## Backlog pendiente

### UX / Config

### Revenue
- [x] Límite de movimientos por plan: Free=200/mes · Básico=2.000/mes · Pro/Enterprise=∞ (v0.36.0)
- [x] Add-ons: +500 movimientos por $990 vía email/soporte; `tenants.addon_movimientos` acumula extra (v0.36.0)
- [x] Matriz de funcionalidades por plan: `FEATURES_POR_PLAN` en brand.ts · `UpgradePrompt` reutilizable · candados en sidebar · bloqueo en Reportes/Historial (Básico+), Métricas/Importar/RRHH (Pro+) (v0.37.0)
- [x] Add-on con pago automático vía MP: EF `mp-addon` (preference pago único) + `mp-webhook` actualizado (detecta `|addon_movimientos` → incrementa +500) · secrets PROD configurados · webhook MP registrado (v0.40.0)

### RRHH — Phases 2–5 (ver ROADMAP.md)
- [x] Phase 2A — Nómina: `rrhh_salarios` + `rrhh_conceptos` + `rrhh_salario_items`; pagar → egreso automático en Caja (migración 017, PROD)
- [x] Phase 2B — Vacaciones: solicitudes con aprobación; saldo anual + remanente (migración 018, PROD)
- [x] Phase 2C — Cumpleaños automáticos: EF `birthday-notifications` + GitHub Actions cron diario (migración 022, PROD)
- [x] Phase 3A — Asistencia: `rrhh_asistencia` (entrada/salida/estado/motivo) (migración 019, PROD)
- [x] Phase 3B — Dashboard RRHH: KPIs empleados/asistencia/vacaciones/nómina + breakdown depts + exportar Excel (PROD v0.35.0)
- [x] Phase 4A — Documentos empleado: `rrhh_documentos` + Storage bucket `empleados` + tab UI (migración 022, PROD)
- [x] Phase 4B — Capacitaciones: `rrhh_capacitaciones` + tab Capacitaciones + cert upload al bucket `empleados` (migración 023, en dev)
- [x] Phase 5 — Supervisor Self-Service: tab Mi Equipo + KPIs asistencia/vacaciones hoy + aprobar vacaciones + árbol organizacional + RLS `get_supervisor_team_ids()` (migración 024, en dev)

### Marketplace
- [x] Migration 020: campos marketplace en productos + tenants (PROD v0.35.0)
- [x] EF marketplace-api: GET público con rate limiting (PROD ✅)
- [x] EF marketplace-webhook: notificación externa (PROD ✅)
- [x] UI ProductoFormPage: sección colapsable (solo si marketplace_activo)
- [x] Toggle marketplace_activo desde ConfigPage → Negocio (v0.64.0) — ya no requiere SQL

### Multi-sucursal (v0.42.0 ✅ PROD)
- [x] Migration 025: `sucursales` + `sucursal_id` nullable en 6 tablas operativas (DEV ✅, PROD ✅)
- [x] `Sucursal` interface en supabase.ts
- [x] `authStore`: sucursales[], sucursalId, setSucursal() — persiste en localStorage
- [x] `useSucursalFilter`: applyFilter(q) condicional
- [x] `SucursalSelector` en header — solo visible con ≥1 sucursal configurada
- [x] `SucursalesPage` (/sucursales, OWNER-only): CRUD completo
- [x] Filtro en Inventario, Movimientos, Ventas, Caja, Gastos, Clientes (read + write)

### v0.43.0 ✅ PROD
- [x] **Bug `check_stock_minimo` SECURITY DEFINER**: trigger AFTER UPDATE en productos fallaba con 400 (RLS bloqueaba INSERT en alertas en contexto de trigger). Fix: `SECURITY DEFINER` bypassa RLS.
- [x] **Ventas — filtro por categoría**: dropdown en historial filtra ventas client-side por `categoria_id` de venta_items → productos. Query categorías lazy (solo cuando tab='historial').
- [x] **Alertas — productos sin categoría**: nueva sección naranja (icono Tag). Query `productos WHERE activo=true AND categoria_id IS NULL`. Link a `/inventario/:id/editar`.
- [x] **Dark mode CajaPage**: botón Egreso `bg-red-50` → `bg-red-500` (texto blanco era invisible en light); cards Ingresos/Egresos `dark:bg-*/200/20` (clase inválida) → `bg-*/400/20`.
- [x] **RRHH Nómina — migration 026**: `rrhh_salarios.medio_pago TEXT CHECK IN ('efectivo','transferencia_banco','mp')` DEFAULT 'efectivo'. `pagar_nomina_empleado(p_salario_id, p_sesion_id, p_medio_pago DEFAULT 'efectivo')` — verifica saldo caja (RAISE EXCEPTION si saldo < neto para medio_pago='efectivo'). UI: select de método + caja; badge en fila pagada; sección colapsable "Historial de sueldos" con tabla evolutiva por período.

### v0.44.0 ✅ PROD
- [x] **Caja multi-usuario**: `sesionActiva` join `usuario_id(nombre_display)` → header muestra "Abierta: [fecha] · [nombre]"; banner naranja si la sesión fue abierta por otro usuario; botón "Cerrar caja" bloqueado para CAJERO en sesión ajena (OWNER/SUPERVISOR pueden cerrar cualquier sesión); check defensivo en `abrirCaja.mutationFn` con `.maybeSingle()` antes del insert.
- [x] **Reportes — breakdown por método de pago**: chips `[Tipo] $monto (n)` en resumen del reporte Ventas. IIFE que agrega `medio_pago` JSON de todas las ventas del período por tipo.
- [x] **Usuarios — mejoras UX**: filtros por rol con contadores; descripción del rol en cada card; fecha de alta "Desde DD/MM/YYYY"; sección colapsable "Permisos por rol" (tabla 12 funciones × 4 roles con ✓/✗).

### v0.44.1 ✅ PROD
- [x] **Migración a genesis360.pro**: nuevo dominio (Porkbun) + org GitHub `genesis360-app` + repo renombrado a `genesis360` (público).
- [x] **Seguridad — .gitignore**: `.env.local` estaba trackeado en git. Fix: `.gitignore` completo + `git rm --cached .env.local`.
- [x] **Rotación de API keys**: MP Public Key, MP Access Token, Resend API Key, Supabase Access Token, GitHub Token — todos rotados y actualizados en Vercel + Supabase EF secrets.
- [x] **URLs actualizadas**: referencias `stokio.com` → `genesis360.pro` en EFs (`send-email`, `invite-user`, `crear-suscripcion`, `mp-addon`) y `AppLayout` (soporte email).
- [x] **Vercel**: proyecto renombrado a `genesis360`, `VITE_APP_URL=https://genesis360.pro` en Production.

### v0.45.0 ✅ PROD
- [x] **Rebrand completo Stokio → Genesis360**: `index.html` (`<title>`), `package.json` (`name`), `brand.ts` (comentarios), `useRecomendaciones`, `RecomendacionesPage`, `SuscripcionPage`, `VentasPage` (fallback ticket), EF `send-email` (`BRAND`, `APP_URL`), EF `invite-user`, `crear-suscripcion`, `mp-addon` (fallbacks `APP_URL`), `schema_full.sql`, `CLAUDE.md`, `WORKFLOW.md`, `ROADMAP.md`.
- [x] **Header UX — sucursal activa**: el nombre en el header (antes `BRAND.name`) ahora muestra la sucursal seleccionada, o el nombre del tenant en vista global. Fallback a `BRAND.name` si los datos aún no cargaron.

### v0.46.0 — Tests E2E + Caja + Multi-dominio (en dev)
- [x] **Tests E2E funcionales**: `playwright.config.ts` + `auth.setup.ts` fix `__dirname` ES module; walkthrough marcado como visto en localStorage antes de tests; `waitForApp` flexible (aside o networkidle); 49/49 passing.
- [x] **Login form accesibilidad**: `htmlFor`+`id` en inputs email y password (requerido por `getByLabel` en Playwright).
- [x] **Fix ventas sin caja**: bloqueo de `despachada` y `reservada` ahora aplica independientemente del medio de pago. Antes solo bloqueaba con efectivo. Widget de estado de caja siempre visible en checkout.
- [x] **Multi-dominio**: `www.genesis360.pro` → landing; `app.genesis360.pro` → `/login` directo. `vercel.json` redirect con `has.host`. `App.tsx` `isAppDomain` como fallback runtime.
- [x] **`VITE_APP_URL=https://app.genesis360.pro`** en Vercel Production ✅
- [x] **Supabase PROD** → Redirect URLs: `https://app.genesis360.pro/**` ✅
- [x] **Vercel** → Domains: `app.genesis360.pro` ✅

### v0.47.0 ✅ PROD
- [x] **Fix scanner cámara**: reemplazar `@zxing/library` por `html5-qrcode` — maneja permisos, enumeración y decodificación en iOS Safari, Android Chrome y desktop.
- [x] **Versión en sidebar**: `APP_VERSION` en `brand.ts` · mostrada debajo de `BRAND.name` en `AppLayout`.
- [x] **MP checkout directo**: `SuscripcionPage` redirige a `mercadopago.com.ar/subscriptions/checkout` con `preapproval_plan_id` + `external_reference=tenant_id`. Sin Edge Function.
- [x] **MP planes PROD**: Básico `836c7829f7e944c9ac58d7c0c67a513b` ($4900) · Pro `cb3bcdaa39bc444da4e17a517d5eadd1` ($9900) — cuenta real de MP.
- [x] **mp-webhook PROD**: deployada sin JWT · webhook registrado en MP Dashboard (prueba + productivo).

### v0.48.0 ✅ PROD
- [x] **Dark mode — badge alertas**: `bg-red-50` → `bg-red-500` (número era invisible).
- [x] **Dark mode — text-primary global**: `.dark .text-primary { color: rgb(255 255 255) }` en `index.css` — cubre todos los títulos sin parchear 40+ archivos.
- [x] **docs/reglas_negocio.md**: inicio del documento con Módulo 1 (Caja) completo.

### v0.49.0 ✅ PROD
- [x] **Redirect auth**: `/` y `/login` redirigen a `/dashboard` si hay sesión activa. Spinner durante carga (ya existía `initialized`).
- [x] **Banner DEV**: franja amarilla `⚠ Ambiente DEV — {hostname}` visible fuera de dominios de producción.
- [x] **Header mobile**: `flex-1` en bloque nombre/rol · selector sucursal `hidden sm:flex` · LifeBuoy/HelpCircle `hidden sm:inline-flex`.
- [x] **CajaPage colores**: Apertura y Saldo actual con `text-gray-900 dark:text-white` (heredaban `text-white` del padre `bg-primary`).

### v0.50.0 ✅ PROD
- [x] **Fix ventas — medio de pago obligatorio**: `reservada`/`despachada` ahora exigen al menos un método con tipo y monto > 0. Bug: `hayMontos=false` saltaba toda la validación. Test: `tests/unit/ventasValidation.test.ts` (12 casos).
- [x] **Refactor**: `validarMediosPago()` extraída a `src/lib/ventasValidation.ts` — función compartida entre VentasPage y tests.

### v0.51.1 ✅ PROD
- [x] **Security bucket `productos`** (migration 027): policy DELETE verifica `tenant_id` en path del archivo · `file_size_limit` 5 MB · `allowed_mime_types`: jpeg/png/webp.

### v0.52.0 ✅ PROD
- [x] **Clientes — DNI obligatorio** (migration 028): columna `dni TEXT` con `UNIQUE(tenant_id, dni) WHERE dni IS NOT NULL`. Obligatorio en UI junto con teléfono. Mostrado en cards. Búsqueda por nombre o DNI.
- [x] **Ventas — bloqueo sin cliente**: `pendiente` y `reservada` requieren cliente registrado. `despachada` puede ir sin cliente.
- [x] **Ventas — registro inline de cliente**: mini-form nombre+DNI+teléfono desde el checkout. ESC/Enter con `useModalKeyboard`.
- [x] **Fix historial ventas**: `cambiarEstado` a `reservada`/`despachada` ahora valida caja abierta (igual que checkout directo).

### v0.52.1 ✅ PROD
- [x] **Ventas — pago parcial en reservas** (migration 029): `monto_pagado DECIMAL(12,2) DEFAULT 0` en `ventas`. Al crear venta se guarda lo cobrado. Al despachar desde historial con saldo > $0.50 → modal muestra Total / Ya cobrado / Saldo a cobrar con selector de medios. Acumula pago en `medio_pago`.
- [x] **Validación en mutationFn**: `validarDespacho()` bloquea el despacho si hay saldo sin cubrir (no solo en el UI). Función pura testeada.
- [x] **Tests — pago parcial**: `tests/unit/ventasSaldo.test.ts` — 24 casos: `calcularSaldoPendiente`, `validarSaldoMediosPago`, `validarDespacho`, `acumularMediosPago`. Total: 85/85 passing.

### v0.53.0 ✅ PROD
- [x] **Ventas — vuelto al cliente**: efectivo > total → muestra "Vuelto $X" en checkout y en ticket. Caja registra solo el neto (entregado − vuelto). `monto_pagado` tope en `total`. Tests: 87/87.
- [x] **Ventas — selector de modo**: tres modos en un toggle (Reservar / Venta directa / Sin pago ahora). "Sin pago ahora" oculta el form de cobro; `monto_pagado = 0` para pendiente.
- [x] **Ventas — combos automáticos**: `useEffect` detecta cuando la cantidad alcanza el umbral del combo y lo aplica sin intervención del cajero. Toast informativo.
- [x] **Ventas — editar monto cobrado de reserva**: bloque azul en modal detalle de reservada con Ya cobrado / Saldo pendiente. Input inline para corregir el monto sin reabrir la venta.
- [x] **Ventas — modificar productos de reserva**: botón ámbar "Modificar productos" en modal de reservada. Cancela la reserva, registra motivo en `notas` (`"Cancelada por modificación — fecha — usuario"`), pre-puebla el carrito con productos + cliente + medios de pago originales para recrear.
- [x] **Ventas — badge saldo en historial**: chip naranja "Saldo $X" en reservas con pago parcial pendiente.
- [x] **Fix caja despacho**: al despachar una reserva, la caja registra efectivo original de la reserva + efectivo del saldo. Antes el efectivo de la reserva se perdía.

### v0.53.1 ✅ PROD
- [x] **Tests — caja y ventas** (`tests/unit/ventasCaja.test.ts`, 24 casos nuevos): `calcularVuelto`, `calcularEfectivoCaja`, `calcularComboRows`, `restaurarMediosPago`. Total: 111/111 passing.
- [x] **Fix bug vuelto con tarjeta**: `calcularVuelto` solo computaba vuelto sobre efectivo, no sobre el total pagado con todos los medios. Tarjeta > total ya no genera vuelto falso.
- [x] **Refactor funciones puras**: `calcularVuelto`, `calcularEfectivoCaja`, `calcularComboRows`, `restaurarMediosPago` extraídas a `src/lib/ventasValidation.ts`. VentasPage usa las funciones compartidas.

### v0.57.0 ✅ PROD

#### Fixes pre-deploy (commit f0b711cd)
- **Bug: modificarReserva + series** — `VentasPage.tsx`: `modificarReserva()` ahora fetchea `inventario_lineas(inventario_series activo & !reservado)` para cada producto serializado antes de llamar `setCart`. Fix: `series_disponibles` ya no queda vacío al volver al carrito.
- **Bug: series reservadas sin marcar** — `InventarioPage.tsx`: chips de series en tab Inventario muestran `line-through opacity-70 bg-orange-100` para `reservado === true`. Tooltip "Reservada".
- **Dashboard: "Alertas activas" = sidebar badge** — stats query agrega conteo de `reservas_viejas` (mismo criterio que `useAlertas`). `alertasActivas = alertas.length + reservasViejas.count`. Coherencia garantizada con el badge del sidebar.
- **Dashboard: "Total productos activos"** — label renombrado; segunda query `SELECT id count WHERE activo=false`; muestra "X inactivos" debajo si hay alguno.
- **Caja: selector con indicador de abierta** — nueva query `cajasAbiertas` con todos los `caja_id` con sesión abierta. `useEffect` auto-selecciona la primera caja abierta si usuario no seleccionó nada. Opciones del select muestran "✓ Abierta" para cajas con sesión activa.
- **Ventas: tabs underline (Option B)** — reemplaza pill container gris por tabs con `border-b-2 border-accent` en activo. Elimina texto indicador "Todo lo de abajo corresponde a...".
- **Header: botón "Ayuda"** — LifeBuoy button muestra label "Ayuda" visible en desktop (`hidden md:inline`). Punto de entrada futuro al Centro de Soporte (`/ayuda`).

#### Notas de arquitectura / comportamiento documentadas
- **Dashboard "Stock Crítico"** (card) = tiempo real (`stock_actual <= stock_minimo`). **AlertasPage** sección stock = tabla `alertas` (trigger-based). Pueden diferir: el trigger crea la alerta cuando el stock baja pero no la resuelve al reponerse — hay que resolver manualmente. Esto es comportamiento esperado; documentar en FAQ del Centro de Soporte.
- **"Alertas activas"** dashboard card = sidebar badge = `alertas DB + reservas_viejas`. AlertasPage `totalAlertas` incluye además `sinCategoria + clientesConDeuda` (informativas). La diferencia es intencional: dashboard/sidebar muestran alertas urgentes, AlertasPage muestra todo el detalle.

#### Grupo 3 — Maestro de estructura de producto (migration 031)
- Nueva tabla `producto_estructuras`: N estructuras por SKU, una sola default.
  - Niveles: unidad / caja / pallet con peso (kg) y dimensiones alto/ancho/largo (cm).
  - Conversiones: `unidades_por_caja`, `cajas_por_pallet`.
  - Validación: mínimo 2 niveles activos al crear; todos los campos del nivel son obligatorios.
  - Default automático al crear la primera; se reasigna al eliminar la default.
  - `UNIQUE INDEX (tenant_id, producto_id) WHERE is_default = true` — garantía en DB.
  - **Diseño WMS-ready**: estructura pensada para almacenaje dirigido (fase futura) — ver ROADMAP.md § WMS.
- Tab "Estructura" en ProductosPage: CRUD completo con buscador/dropdown de producto,
  modal `EstrModal` con toggle por nivel (`NivelSection`), tarjeta `EstrCard` con detalle por nivel.
- Panel expandible (tab Productos): muestra estructura default con peso y dimensiones por nivel;
  link "Agregar estructura" si no tiene ninguna; link "Gestionar →" navega al tab Estructura con producto preseleccionado.
- Interface `ProductoEstructura` en `supabase.ts`.

#### Grupo 4 — Ingreso y rebaje masivo (sin migration)
- Nuevo `src/components/MasivoModal.tsx`: modal reutilizable para N productos en una sola operación.
  - **Ingreso masivo**: no serializados (cantidad + opcionales expandibles: ubicación, estado,
    proveedor, lote, vencimiento, LPN) · serializados (textarea con series una por línea).
  - **Rebaje masivo**: solo no serializados; auto-FIFO/FEFO/LEFO/LIFO desde líneas existentes;
    serializados muestran aviso "usar rebaje individual" y se excluyen del procesamiento.
  - Buscador + scanner integrado para agregar productos a la lista.
  - Preview stock resultante en tiempo real por fila; procesamiento secuencial (evita race conditions).
- InventarioPage tab Movimientos: 4 botones — Ingreso · **Ingreso masivo** · Rebaje · **Rebaje masivo**.

### v0.56.0 — en DEV
- [x] **ProductosPage** (`/productos`): 2 tabs — Productos (listado con panel de resumen expandible, imagen, precios, stock, categoría, notas) + Estructura (placeholder "próximamente"). Rutas `/productos/nuevo`, `/productos/:id/editar`, `/productos/importar`.
- [x] **InventarioPage** (`/inventario`): 2 tabs — Movimientos (todo el ingreso/rebaje con scanner, modales, historial) + Inventario (listado LPNs por producto con expandir, cambiar estado, acciones LPN modal).
- [x] **Rutas renombradas**: sidebar `/inventario`→`/productos` · `/movimientos`→`/inventario`. Redirects de compatibilidad para URLs viejas (`/inventario/nuevo`, `/inventario/importar`, `/movimientos`). `/inventario/:id/editar` sigue funcionando (apunta a `ProductoFormPage`).
- [x] **Referencias actualizadas**: AlertasPage (`/movimientos`→`/inventario`, `/inventario/:id/editar`→`/productos/:id/editar`) · DashboardPage (card Productos, link Movimientos) · ImportarProductosPage (navigate post-import) · ProductoFormPage (navigate + logActividad) · Walkthrough (rutas del tour).
- [x] **MovimientosPage.tsx** queda como archivo muerto (no importado). No se eliminó para no perder historia.

### v0.55.0 ✅ PROD
- [x] **Fix bug medio de pago sin tipo**: `validarMediosPago` y `validarSaldoMediosPago` bloquean si hay monto > 0 sin tipo seleccionado (mixto con "Elegir método" permitía cerrar venta). 3 tests nuevos (114/114).
- [x] **Dashboard — deuda pendiente**: query paralela en `dashboard-stats` suma `total - monto_pagado` de ventas `pendiente`/`reservada`. Línea "$X pendiente de cobro · N ventas" en tarjeta ventas, link a `/alertas`.
- [x] **Alertas — clientes con saldo pendiente**: nueva sección amarilla agrupa ventas por cliente, muestra saldo acumulado y cantidad de ventas. Botón "Ver ficha" → `/clientes?id=xxx`.
- [x] **Alertas — link directo a venta**: botón "Ver venta" en reservas viejas lleva a `/ventas?id=xxx`.
- [x] **VentasPage — apertura por URL**: `?id=` arranca en tab historial y abre modal de esa venta. Limpia param al abrir.
- [x] **ClientesPage — apertura por URL**: `?id=` expande ficha del cliente automáticamente. Limpia param al abrir.
- [x] **UX — scroll en inputs numéricos**: `onWheel={e => e.currentTarget.blur()}` en todos los `type="number"` (10 archivos).
- [x] **UX — tooltips en botones icon-only**: `title` en todos los botones sin label de texto visible.
- [x] **VentasPage UX**: botón "Despachar (venta directa)" → "Venta directa"; tabs full-width en mobile; carrito sticky en desktop (`lg:sticky lg:top-4`); label tab activa visible debajo de los tabs.
- [x] **Sidebar reorden**: Dashboard, Ventas, Gastos, Caja, Productos, Inventario, Clientes, Alertas, Reportes, Historial, RRHH, Sucursales, Usuarios, Configuración. Eliminados Rentabilidad y Recomendaciones del nav.
- [x] **Dashboard consolida Rentabilidad y Recomendaciones**: tabs adicionales en DashboardPage usando `hideHeader` prop. `RentabilidadPage` y `RecomendacionesPage` soportan `hideHeader`.
- [x] **ConfigPage layout**: reemplaza `max-w-2xl` por `max-w-5xl` con sidebar vertical de tabs en desktop (`hidden lg:flex flex-col w-44 sticky`) y tabs horizontales en mobile (`lg:hidden`).

### v0.63.0 — en dev

#### Restricciones de menú por rol
- **Rol RRHH**: ve solo `/rrhh` en sidebar. Cualquier otra ruta → redirect a `/rrhh`. Flag `rrhhVisible: true` en navItem para bypass de `ownerOnly`.
- **Rol CAJERO**: ve solo Ventas + Caja + Clientes. Cualquier otra ruta → redirect a `/ventas`. Flag `cajeroVisible: true` en navItems.
- Implementado en `AppLayout.tsx`: `useLocation` + `useEffect` + flags por item. `CAJERO_ALLOWED = ['/ventas', '/caja', '/clientes']`.

#### Sueldo sugerido al crear empleado
- `RrhhPage`: al seleccionar puesto en el form, si `salario_bruto` está vacío → autocompleta con `puesto.salario_base_sugerido`.
- Las opciones del select muestran el salario al lado del nombre: `Repositor — $350.000`.

#### Mi Cuenta (`/mi-cuenta`)
- Nueva página accesible desde el bloque de perfil en el sidebar (debajo del logo).
- **Avatar circular**: Google OAuth → `user_metadata.avatar_url` automático. Email/password → upload al bucket `avatares` (public, 2 MB, jpeg/png/webp). `authStore.loadUserData` resuelve el avatar y lo expone en `user.avatar_url`.
- **Plan + estado**: muestra plan actual y `subscription_status` con link a `/suscripcion`.
- **Cambio de contraseña**: solo email/password (no Google). `supabase.auth.updateUser({ password })`.
- **Zona de riesgo** colapsable:
  - Non-OWNER: "Salir del negocio" → `DELETE FROM users WHERE id = auth_user_id`. La cuenta de auth queda libre para otro tenant.
  - OWNER: "Eliminar cuenta permanentemente" → requiere escribir el nombre del negocio + cancela el tenant.
- Migration 035: `users.avatar_url TEXT` + bucket `avatares` + 4 policies (read/insert/update/delete por usuario).

#### Sidebar + Header UX
- Bloque de perfil (avatar + nombre + rol + tenant) justo debajo del logo → link a `/mi-cuenta`. Colapsado → solo avatar.
- Pie del sidebar: eliminado botón "Mi Cuenta · Plan X" (redundante).
- Header: eliminados nombre, rol y negocio (ya visibles en sidebar).

#### SuscripcionPage fixes
- **Ícono invisible en light mode**: `bg-white text-white` → `bg-accent text-white`.
- **Flecha volver**: `← Volver` con `navigate(-1)` al tope. Elimina link del pie.
- **Auto-redirect post-pago**: `useEffect` auto-dispara verificación cuando `status=approved`. Muestra spinner. Fix: `loadUserData` usaba `tenant.id` en lugar de `user.id`.

### v0.62.0 — en dev

- **Bug RRHH UPDATE empleado**: `setFormData(emp)` cargaba joins (`puesto`, `departamento`, `supervisor`). Fix: destruturar y excluir antes de `.insert()` / `.update()` en `saveEmpleado.mutationFn`.
- **SKU automático secuencial**: si campo vacío al guardar → consulta `productos WHERE sku LIKE 'SKU-%'`, extrae MAX numérico, genera `SKU-XXXXX` (5 dígitos zero-padded). Lógica pura extraída a `src/lib/skuAuto.ts` → `calcularSiguienteSKU(skus: string[]): string`.
- **Clientes → link venta**: botón `ExternalLink` en cada venta del historial del cliente → `navigate('/ventas?id={v.id}')`.
- **Historial actividad → modal detalle**: filas clickeables (cursor-pointer + hover accent border). Click abre modal con: descripción, entidad, ID, acción, campo, valor anterior/nuevo, fecha, usuario, módulo.
- **Inventario: bloqueo acciones con reservas**: botón `Settings2` en cada LPN deshabilitado si `cantidad_reservada > 0`. Tooltip descriptivo. Series con `reservado=true` ya tenían visual line-through desde v0.57.0.
- **Traspasos entre cajas** (migration 034):
  - `es_caja_fuerte BOOLEAN DEFAULT FALSE` en `cajas`.
  - Tabla `caja_traspasos`: sesion_origen_id, sesion_destino_id, monto, concepto, usuario_id. RLS tenant.
  - Query `sesionesAbiertasAll` (lazy, enabled solo cuando `showTraspaso`): devuelve sesiones abiertas con `cajas(nombre)`.
  - Mutation `realizarTraspaso`: valida monto ≤ saldo; inserta egreso en origen + ingreso en destino + registro en `caja_traspasos`.
  - Botón `ArrowRightLeft` visible solo cuando `cajasAbiertas.length >= 2`.
- **LPN multi-fuente en carrito** (VentasPage):
  - `CartItem` agrega `lineas_disponibles: LineaDisponible[]` (todas las líneas ordenadas por sort activo) y `lpn_fuentes: LpnFuente[]` (qué líneas cubren la cantidad actual).
  - `agregarProducto`: pre-fetch de TODAS las líneas disponibles con `cantidad - cantidad_reservada > 0`; calcula fuentes iniciales (cantidad=1) con `calcularLpnFuentes()`.
  - `updateItem`: al cambiar `cantidad`, recomputa `lpn_fuentes` y `linea_id` client-side desde `lineas_disponibles` (sin re-fetch).
  - Cart JSX: badges múltiples `LPN-X (Nu)` (máx 3 + "+N más"). Si hay una sola fuente, muestra sin cantidad.
  - Función pura `calcularLpnFuentes(lineas, cantidad)` en `src/lib/ventasValidation.ts`. Tipos: `LineaDisponible`, `LpnFuente`.
- **Tests**: `tests/unit/skuAuto.test.ts` (8) + `tests/unit/lpnFuentes.test.ts` (21: 10 unitarios + 8 integración sort+fuentes). Total acumulado: **141/141**.

### v0.61.0 ✅ PROD

#### Ventas + Caja UX
- **"Finalizada"**: `ESTADOS.despachada.label` → `'Finalizada'`. Botón historial → "Finalizar (rebaja stock)". Modal saldo → "Cobrar saldo y finalizar" + botón "Finalizar venta". Toast → "Venta finalizada". El valor en DB sigue siendo `'despachada'`.
- **Motivo cancelación visible**: cuando `ventaDetalle.estado === 'cancelada'` el campo `notas` se muestra en un bloque rojo (`bg-red-50`) con título "Motivo de cancelación" en lugar del texto gris pequeño anterior.
- **Bloqueo producto sin precio**: `agregarProducto()` valida `precio_venta > 0` antes de agregar al carrito — toast de error con nombre del producto.
- **Cierre de caja con monto obligatorio**: campo "Conteo real" renombrado a obligatorio (`*`). Botón deshabilitado si está vacío. `mutationFn` lanza error si `montoRealCierre.trim() === ''`. `monto_real_cierre` y `diferencia_cierre` siempre se guardan al cerrar.
- **ESC modal anidado**: `useModalKeyboard` de `ventaDetalle` desactivado cuando `saldoModal` está abierto — ESC solo cierra el hijo.
- **Caja default por usuario**: `caja_preferida_${tenantId}_${userId}` en localStorage. Auto-selección al cargar. Botón "★ Predeterminar" guarda la selección actual.
- **Badges cajitas**: pills visuales clickeables por caja — verde=abierta, gris=cerrada, accent=seleccionada.

### v0.60.0 ✅ PROD

#### Mobile + Quick UX fixes
- **Viewport mobile**: `maximum-scale=1.0, viewport-fit=cover` en `index.html` — previene zoom automático en iOS al enfocar inputs. `html, body { overflow-x: hidden }` en `index.css` — previene overflow horizontal.
- **Inventario/LPNs tabla mobile**: envuelta en `overflow-x-auto -mx-4 px-4` con `min-w-[640px]` en las grids — scrollea horizontalmente en lugar de superponer columnas en vertical.
- **Sidebar íconos distintos en colapsado**: `/inventario` `ArrowLeftRight` → `Boxes` · `/rrhh` `Users2` → `Briefcase` · `/usuarios` `Users` → `Shield`.
- **CajaPage — Egreso eliminado**: botón Egreso del panel principal removido; shortcut `Shift+O` eliminado. Egresos solo vía módulo Gastos.
- **SuscripcionPage — Plan Básico legible**: card no-destacada `bg-white` → `bg-white/10` — texto blanco visible sobre el gradiente oscuro en modo claro.
- **Badge alertas alineado**: `useAlertas` ahora incluye las 4 categorías (alertas + reservas_viejas + sinCategoria + clientesConDeuda) — coincide con `totalAlertas` de AlertasPage.

### v0.59.2 ✅ PROD

#### Fixes devoluciones
- **Estado `devuelta`**: nuevo valor en `EstadoVenta` (badge naranja). Al finalizar `procesarDevolucion`, suma todas las devoluciones de la venta; si `totalDevuelto >= venta.total` → `UPDATE ventas SET estado='devuelta'`. Botón "Devolver" ya no aparece para ventas en este estado. Filtro historial incluye `devuelta` automáticamente.
- **Rollback manual**: si cualquier operación falla después del INSERT del header `devoluciones`, se elimina automáticamente para evitar registros huérfanos con 0 ítems.

### v0.59.1 ✅ PROD

- **Fix devoluciones** (migration 033): `notas TEXT` nullable en `inventario_lineas`. La lógica de devoluciones insertaba `notas` al crear nueva línea en ubicación DEV pero la columna no existía → error 400. Columna útil para trazabilidad futura.

### v0.59.0 ✅ PROD

#### WMS Fase 2 — Dimensiones en ubicaciones (migration 032)
- **6 columnas opcionales en `ubicaciones`**: `tipo_ubicacion TEXT CHECK IN ('picking','bulk','estiba','camara','cross_dock')` + `alto_cm`, `ancho_cm`, `largo_cm`, `peso_max_kg` `DECIMAL(8,2)` + `capacidad_pallets INT`. Todos nullable — ubicaciones existentes sin impacto.
- **ConfigPage**: sección colapsable "Dimensiones WMS (opcional)" en modo edición de cada ubicación. Se abre automáticamente si ya tiene datos. Grid 3 cols: select tipo + 5 inputs numéricos.
- **Lista**: badge violeta con `tipo_ubicacion` + indicador `📏 alto×ancho×largo cm` si tiene dimensiones.
- **`Ubicacion` interface** en `supabase.ts` actualizada con campos WMS.
- **Fix**: `APP_VERSION` v0.58.0 que se había omitido en el deploy anterior ahora incluido (v0.59.0 visible en sidebar).

### v0.58.0 ✅ PROD

#### Devoluciones (migration 030)
- **`ubicaciones.es_devolucion BOOLEAN DEFAULT false`**: toggle `RotateCcw` naranja en ConfigPage → Ubicaciones. Solo una por tenant.
- **`estados_inventario.es_devolucion BOOLEAN DEFAULT false`**: select en ConfigPage → Estados. Solo uno activo a la vez (desactiva todos antes de asignar).
- **Tablas**: `devoluciones` (id, tenant_id, venta_id, numero_nc, origen, motivo, monto_total, medio_pago TEXT JSON, created_by) + `devolucion_items` (devolucion_id, producto_id, cantidad, precio_unitario, inventario_linea_nueva_id nullable). RLS tenant-based.
- **NC**: solo si origen=`facturada` → `numero_nc = "NC-{venta.numero}-{n}"` (n = count previas + 1). Si `despachada` → sin NC.
- **Stock serializado**: reactiva series originales (`activo=true, reservado=false`) + su linea. Recalcula `stock_actual` manualmente (+cantDev).
- **Stock no serializado**: nueva `inventario_lineas` en ubicación DEV con `estado_id=estadoDevId` + `notas = "Devolución de venta #N"`. Trigger recalcula automáticamente. Registra movimiento `ingreso`.
- **Caja**: Efectivo en `medio_pago` → `egreso` en `caja_movimientos`. Bloquea si no hay sesión abierta.
- **UI**: botón "Devolver" en modal detalle (estados `despachada` y `facturada`). Modal con selección chips de series / input cantidad, motivo, medios de devolución. Comprobante imprimible al finalizar. Sección colapsable "Devoluciones (n)" en modal si ya existen devoluciones previas.
- **Prerequisito de uso**: configurar en Configuración → Ubicaciones una ubicación DEV + en Estados un estado DEV. Sin eso, la lógica bloquea con error descriptivo.
- **Stock no serializado**: nueva `inventario_lineas` en ubicación DEV, estado DEV, `notas = "Devolución de LPN {lpn_original}"`.
- **Stock serializado**: reactiva serie existente (`activo=true, reservado=false`). No crea nuevo registro.
- **Caja**: Efectivo en `medio_pago` → egreso en `caja_movimientos`. Requiere sesión abierta.
- **UI**: botón "Devolver" en modal detalle (despachada/facturada) → modal con tabla ítems + motivo + medio devolución → comprobante imprimible. Sección colapsable "Devoluciones" en modal si ya tiene alguna.

### v0.51.0 ✅ PROD
- [x] **Scanner reescritura**: reemplaza `html5-qrcode` (ZXing) por `BarcodeDetector` nativo + `@undecaf/zbar-wasm` fallback. Funciona en iOS, Android y Desktop. Formatos: EAN-13, EAN-8, UPC, Code-128/39, QR, PDF417 y más.
- [x] **Scanner UX**: línea laser animada, flash verde al detectar, beep (Web Audio), vibración háptica, modo manual (teclado + lector físico USB/Bluetooth).
- [x] **Scanner en Movimientos**: ícono de cámara en búsqueda de producto en modal Ingreso y Rebaje. Busca por `codigo_barras` o SKU exacto.
- [x] **Scanner en Nuevo Producto**: botón "Escanear barcode" completa solo el campo `codigo_barras`.
- [x] **Completar desde foto — 2 fotos**: Foto 1 (frente) + Foto 2 (reverso) combinan datos sin pisar campos ya detectados.
- [x] **scan-product EF**: fix 401 (redesplegada sin JWT en DEV y PROD). ANTHROPIC_API_KEY actualizada en DEV y PROD.
- [x] **Búsqueda por código de barras**: InventarioPage y MovimientosPage incluyen `codigo_barras` en filtros.

### Ventas — validación medios de pago y clientes
- `pendiente`: no requiere medio de pago ni cliente. Selector "Sin pago ahora" oculta el form de cobro. `monto_pagado = 0`.
- `reservada`: requiere cliente registrado. Permite pago parcial (monto > 0 pero sin exigir cubrir el total). Guarda `monto_pagado`. Badge naranja "Saldo $X" en historial si hay pendiente.
- `despachada` (directo): requiere al menos un medio con monto > 0 y que cubra el total. Efectivo > total → muestra vuelto, caja registra neto. `monto_pagado = min(pagado, total)`.
- `despachada` (desde reservada): si saldo > $0.50 → modal de cobro. Caja registra efectivo original de reserva + efectivo del saldo. `validarDespacho()` bloquea en UI y en `mutationFn`.
- **Modificar reserva**: cancela la reserva, registra motivo en `notas`, pre-puebla carrito con productos + cliente + medios de pago originales.
- **Editar monto cobrado**: input inline en modal de reservada, actualiza `monto_pagado` directo en DB.
- Registro inline de cliente desde checkout: nombre + DNI + teléfono (mandatorios). Búsqueda por nombre o DNI.
- Funciones puras en `src/lib/ventasValidation.ts`: `validarMediosPago`, `validarDespacho`, `calcularSaldoPendiente`, `validarSaldoMediosPago`, `acumularMediosPago`.
- Tests: `tests/unit/ventasValidation.test.ts` + `tests/unit/ventasSaldo.test.ts`.

### Reglas de negocio — Caja
- **Sin caja abierta = sin negocio**: no se puede registrar ninguna venta (`despachada` o `reservada`) ni gasto en efectivo si no hay sesión de caja abierta.
- **Medios de pago en caja**: efectivo → `ingreso` en `caja_movimientos` (afecta saldo). Tarjeta/transferencia/MP → `ingreso_informativo` (no afecta saldo, solo registro).
- **Gastos en efectivo**: también requieren caja abierta. Otros medios de pago no bloquean.
- **Nómina**: `pagar_nomina_empleado()` verifica saldo caja si `medio_pago='efectivo'`.

### Centro de Soporte / Ayuda (plan aprobado, pendiente implementar)
- Ruta `/ayuda` — acceso desde botón "Ayuda" en header (LifeBuoy + label).
- Secciones: FAQ por módulo · Chat directo (WhatsApp/email) · Buenas Prácticas · Guías Populares interactivas · Reportar un Problema (form: tipo/urgencia/asunto/descripción/adjunto) · Cursos y recursos (YouTube).
- Form "Reportar Problema" → email a `soporte@genesis360.pro` o tabla `soporte_tickets` en DB.
- Guías interactivas: primera versión paso a paso; objetivo final = tour animado con mouse guiado.
- Guías sugeridas: "Crear tu primer producto" · "Gestionar una venta de principio a fin" · "Proceso de recepción de mercadería" · "Configurar tu primera caja" · "Armar tu equipo de usuarios".

### KITs / Kitting (WMS Fase 2.5 — migration 040, v0.65.0 DEV)
- **Tablas**: `kit_recetas` (kit_producto_id, comp_producto_id, cantidad) + `kitting_log` (auditoria de armados).
- **`productos.es_kit BOOLEAN`**: toggle en ProductoFormPage sección atributos.
- **Movimiento tipo `kitting`**: CHECK constraint ampliado en `movimientos_stock.tipo`.
- **Tab "Kits" en InventarioPage**: CRUD de recetas por KIT, preview "puede armar: N" según stock mínimo de componentes, modal ejecutar kitting con consumo en tiempo real + validación stock insuficiente.
- **Desarmado inverso**: pendiente (backlog largo plazo).
- **KIT como producto de venta**: pendiente decidir — el SKU existe y puede venderse, pero el precio/stock se gestiona igual que cualquier producto.

### v0.65.0 ✅ PROD
- ✅ E2E tests rol SUPERVISOR: `auth.supervisor.setup.ts` + `15_rol_supervisor.spec.ts`
- ✅ Fix sync multi-dispositivo caja: `refetchInterval: 30_000` + `refetchOnWindowFocus: true` en `sesion-activa` y `caja-movimientos`
- ✅ KITs/Kitting WMS Fase 2.5: `kit_recetas` + `kitting_log` + `productos.es_kit` + tipo `kitting` (migration 040 PROD ✅)

### v0.66.0 ✅ PROD
- ✅ **E2E tests rol RRHH**: `auth.rrhh.setup.ts` + `16_rol_rrhh.spec.ts` (18 tests)
- ✅ **Fix /mi-cuenta accesible para CAJERO y RRHH**: `CAJERO_ALLOWED` + redirect RRHH ampliados en `AppLayout`
- ✅ **Redirect SUPERVISOR en rutas ownerOnly**: `SUPERVISOR_FORBIDDEN = ['/configuracion', '/usuarios', '/sucursales', '/rrhh']` → redirige a `/dashboard`
- ✅ **playwright.config.ts**: proyectos `setup-rrhh` + `chromium-rrhh` condicionales; `testIgnore` actualizado
- ✅ **tests.yml**: vars `E2E_RRHH_EMAIL` + `E2E_RRHH_PASSWORD`
- ✅ **Todos los roles E2E verdes**: CAJERO 20/20 · SUPERVISOR 23/23 · RRHH 18/18

### v0.67.0 ✅ PROD
- ✅ **Sesión expiry por inactividad**: `useInactivityTimeout` hook · select en ConfigPage → Negocio (5/15/30 min / 1h / Nunca) · aviso toast 1 min antes · migration 041: `tenants.session_timeout_minutes INT DEFAULT NULL`
- ✅ **RRHH feriados nacionales**: botón "🇦🇷 AR 2026" en tab Cumpleaños → carga 16 feriados AR 2026 (solo los faltantes) · widget próximos feriados en Dashboard RRHH
- ✅ **Desarmado inverso KITs**: botón "Desarmar" en tab Kits · modal con preview de componentes · valida stock del KIT · rebaja KIT + ingresa componentes · migration 041: `kitting_log.tipo` (armado/desarmado) + tipo `des_kitting` en `movimientos_stock`
- ✅ **VentasPage — badge KIT**: badge naranja "KIT" en dropdown de búsqueda de productos

### Testing por rol
- [x] Tests E2E para CAJERO: `13_rol_cajero.spec.ts` (v0.64.0) — 20 tests ✅
- [x] Tests E2E para SUPERVISOR: `15_rol_supervisor.spec.ts` (v0.65.0) — 23 tests ✅
- [x] Tests E2E para RRHH: `16_rol_rrhh.spec.ts` (v0.66.0) — 18 tests ✅
- [x] Tests de coherencia de números: `14_coherencia_numeros.spec.ts` (v0.64.0)
- Usuarios E2E DEV: OWNER `e2e@genesis360.test` · CAJERO `cajero1@local.com` · RRHH `rrhh1@local.com` · SUPERVISOR `supervisor@test.com` — todos con contraseña `123` (via SQL en auth.users)
- Escenarios nuevos pendientes: modificarReserva con serializado → series disponibles en carrito.

### Restricciones de rutas por rol (AppLayout)
- **RRHH**: solo `/rrhh` + `/mi-cuenta`. Cualquier otra ruta → redirect `/rrhh`.
- **CAJERO**: `CAJERO_ALLOWED = ['/ventas', '/caja', '/clientes', '/mi-cuenta']`. Otra ruta → redirect `/ventas`.
- **SUPERVISOR**: `SUPERVISOR_FORBIDDEN = ['/configuracion', '/usuarios', '/sucursales', '/rrhh']`. Intento de acceso → redirect `/dashboard`.
- **permisos_custom**: mayor prioridad que el rol estándar. Si `permisos_custom[modulo] === 'no_ver'` → redirect al primer módulo permitido.

### Ideas futuras
Cupones, WhatsApp diario, IA chat, benchmark por rubro, tema oscuro, multilengua.
