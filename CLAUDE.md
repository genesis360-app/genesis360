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
    ├── DashboardPage.tsx        # Tabs: General / Métricas
    ├── InventarioPage.tsx       # LpnAccionesModal; badge P{N} = prioridad ubicación
    ├── MovimientosPage.tsx      # Ingreso/rebaje; banner amarillo si cambia ubicación
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
- [ ] Activar por tenant: `UPDATE tenants SET marketplace_activo = true WHERE id = '...'`
- [ ] Deploy EFs con Supabase CLI

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

### v0.51.0 ✅ PROD
- [x] **Scanner reescritura**: reemplaza `html5-qrcode` (ZXing) por `BarcodeDetector` nativo + `@undecaf/zbar-wasm` fallback. Funciona en iOS, Android y Desktop. Formatos: EAN-13, EAN-8, UPC, Code-128/39, QR, PDF417 y más.
- [x] **Scanner UX**: línea laser animada, flash verde al detectar, beep (Web Audio), vibración háptica, modo manual (teclado + lector físico USB/Bluetooth).
- [x] **Scanner en Movimientos**: ícono de cámara en búsqueda de producto en modal Ingreso y Rebaje. Busca por `codigo_barras` o SKU exacto.
- [x] **Scanner en Nuevo Producto**: botón "Escanear barcode" completa solo el campo `codigo_barras`.
- [x] **Completar desde foto — 2 fotos**: Foto 1 (frente) + Foto 2 (reverso) combinan datos sin pisar campos ya detectados.
- [x] **scan-product EF**: fix 401 (redesplegada sin JWT en DEV y PROD). ANTHROPIC_API_KEY actualizada en DEV y PROD.
- [x] **Búsqueda por código de barras**: InventarioPage y MovimientosPage incluyen `codigo_barras` en filtros.

### Ventas — validación medios de pago
- `pendiente`: no requiere medio de pago.
- `reservada`/`despachada`: requieren al menos un método con tipo y monto > 0, y que cubra el total (±$0.50 tolerancia).
- Lógica en `registrarVenta()` — función pura `validarMediosPago()` testeada en `tests/unit/ventasValidation.test.ts`.

### Reglas de negocio — Caja
- **Sin caja abierta = sin negocio**: no se puede registrar ninguna venta (`despachada` o `reservada`) ni gasto en efectivo si no hay sesión de caja abierta.
- **Medios de pago en caja**: efectivo → `ingreso` en `caja_movimientos` (afecta saldo). Tarjeta/transferencia/MP → `ingreso_informativo` (no afecta saldo, solo registro).
- **Gastos en efectivo**: también requieren caja abierta. Otros medios de pago no bloquean.
- **Nómina**: `pagar_nomina_empleado()` verifica saldo caja si `medio_pago='efectivo'`.

### Ideas futuras
Cupones, WhatsApp diario, IA chat, benchmark por rubro, tema oscuro, multilengua.
