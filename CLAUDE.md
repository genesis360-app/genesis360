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

### v0.32.0 — Dark mode completo + RRHH Phase 2A Nómina ✅ PROD
- **Dark mode completo**: `index.css` overrides globales (inputs/selects/textareas/scrollbar). 30+ archivos (páginas + componentes) con `dark:bg-*`, `dark:text-*`, `dark:border-*`, `dark:hover:*` y variantes de estado (red/amber/green/blue).
- **RRHH Phase 2A — Nómina** (migración 017):
  - `rrhh_conceptos`: catálogo de haberes/descuentos reutilizables por tenant. RLS + índices.
  - `rrhh_salarios`: liquidación por empleado × periodo (DATE YYYY-MM-01). UNIQUE(tenant+empleado+periodo). Campos: basico, total_haberes, total_descuentos, neto, pagado, fecha_pago, caja_movimiento_id.
  - `rrhh_salario_items`: líneas de detalle. Trigger `fn_recalcular_salario` recalcula totals en padre tras INSERT/UPDATE/DELETE.
  - `pagar_nomina_empleado(p_salario_id, p_sesion_id)` SECURITY DEFINER: valida sesión caja abierta → inserta egreso en `caja_movimientos` → marca `pagado=TRUE`.
  - UI tab "Nómina" en RrhhPage: selector mes/año, generar nómina mes (crea borrador para todos los activos), resumen período, tabla expandible por empleado con ítems, botón Pagar con selector caja.
  - Catálogo de conceptos CRUD colapsable dentro de la tab.
  - `actividadLog`: + `nomina` en EntidadLog, + `pagar` en AccionLog.

### v0.34.0 — RRHH Phase 3B Dashboard ✅ PROD
- **Tab Dashboard** en RrhhPage (primera tab, con `LayoutDashboard` icon). Seleccionable mes de referencia.
- **KPIs empleados**: total activos, nuevos este mes, cumpleaños del mes, cantidad de departamentos.
- **KPIs asistencia**: % presencia, presentes/tardanzas/ausentes/licencias del mes seleccionado.
- **KPIs vacaciones**: pendientes de aprobación, aprobadas, días hábiles usados en el año.
- **KPIs nómina**: último período, liquidaciones totales/pagadas, pendientes de pago + monto.
- **Breakdown por departamento**: barra proporcional + count por cada departamento.
- **Exportar reportes Excel**: Asistencia mensual (`asistencia_YYYY-MM.xlsx`) + Nómina histórica (`nomina_historica.xlsx`) usando `xlsx` library.
- Queries: `dashAsist`, `dashVac`, `dashNomina` (enabled solo cuando tab='dashboard').
- Funciones: `exportAsistenciaMes()`, `exportNominaHistorica()` (on-demand, query fresca).

### v0.33.0 — RRHH Phase 2B Vacaciones + Phase 3A Asistencia ✅ PROD
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

### Módulo Recepciones / ASN (pendiente — migration 050)

- **Decisión**: módulos separados pero vinculados. OC en `/proveedores` (OWNER/SUPERVISOR — compromiso comercial). Recepciones en `/recepciones` (DEPOSITO+OWNER+SUPERVISOR — operación de almacén). La recepción puede ocurrir sin OC.
- **Vínculo OC→Recepción**: OC confirmada → botón "Recibir mercadería" → `/recepciones/nuevo?oc_id=XXX` pre-popula ítems. Campo "Contra OC" opcional en recepción (dropdown OCs confirmadas del proveedor).
- **Al confirmar recepción**: genera ingreso en `inventario_lineas` (reutiliza lógica de `procesarMasivoIngreso`) + actualiza estado OC a `recibida_parcial` o `recibida`.
- **Nuevos estados `ordenes_compra`**: agregar `recibida_parcial` y `recibida` al CHECK constraint.
- **Tablas nuevas**: `recepciones` (tenant_id, numero auto, oc_id nullable, proveedor_id, estado, sucursal_id) + `recepcion_items` (recepcion_id, producto_id, oc_item_id nullable, cantidad_esperada, cantidad_recibida, estado_id, ubicacion_id, nro_lote, fecha_vencimiento, lpn, series_txt, inventario_linea_id).
- **Roles con acceso**: OWNER · SUPERVISOR · DEPOSITO (ya en `DEPOSITO_ALLOWED`).
- **Botón ASN**: ya conectado en InventarioPage tab Agregar Stock → `/recepciones` (v0.82.0).

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

### v0.41.0 — Insights automáticos + Mi Plan + Tests ✅ PROD

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
- **`SucursalSelector`**: `<select>` en el header (AppLayout), visible solo cuando `sucursales.length > 0`. Sin opción "Todas" — siempre debe haber una sucursal seleccionada. `useEffect` en AppLayout auto-selecciona la primera si `sucursalId` es null.
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

### v0.88.0 ✅ PROD

#### Módulo Recepciones (migration 059)
- **`RecepcionesPage.tsx`** nueva (`/recepciones`): lista de recepciones + form de carga con pre-populado desde OC. Botón "Recibir mercadería" en OC confirmadas de ProveedoresPage.
- **Al confirmar recepción**: genera `inventario_lineas` + `movimientos_stock` + actualiza estado OC a `recibida_parcial` (si quedan ítems pendientes) o `recibida`.
- **Migration 059**: `ordenes_compra.estado` CHECK ampliado con `recibida_parcial` y `recibida`.
- **AppLayout**: navItem Recepciones (`supervisorOnly: true, depositoVisible: true`) + `/recepciones` en `DEPOSITO_ALLOWED`.
- **supabase.ts**: `EstadoOC` extendido · interfaces `Recepcion` + `RecepcionItem`.

#### Mejoras ProductosPage
- **Barcode mobile**: visible debajo de SKU en card header.
- **SKU uniqueness**: validación debounced 400ms, borde rojo + bloquea submit si duplicado.
- **Foto compresión**: `handleImageChange` comprime ≥1.5MB → max 1200px.
- **Botón OC rápida**: modal (proveedor + cantidad + precio opcional) → crea/agrega a OC borrador.
- **ImportarProductosPage**: campo `notas` en template Excel (col W, 23 columnas total).

### v0.89.0 ✅ PROD

#### Fase 0 Integraciones (migration 060)
- `CREATE EXTENSION pgcrypto` — prerequisito para credenciales encriptadas.
- `ALTER TABLE ventas`: `origen TEXT DEFAULT 'POS' CHECK IN ('POS','MELI','TiendaNube','Shopify','WooCommerce','MP')` + `tracking_id`, `tracking_url`, `costo_envio_logistica`, `marketing_metadata`, `id_pago_externo`, `money_release_date`, `cae`, `vencimiento_cae`, `tipo_comprobante`, `numero_comprobante`, `link_factura_pdf`.
- `ALTER TABLE clientes`: `telefono_normalizado TEXT` + `marketing_optin BOOLEAN DEFAULT TRUE`.
- Tabla `integration_job_queue`: cola async genérica (integracion, tipo, payload, status, retries, next_attempt_at). RLS tenant.
- Tabla `ventas_externas_logs`: idempotencia webhooks entrantes. UNIQUE(tenant_id, integracion, webhook_external_id).

#### Credenciales OAuth (migration 061)
- `tiendanube_credentials`: token permanente por sucursal. UNIQUE(tenant_id, sucursal_id).
- `mercadopago_credentials`: OAuth estándar, `expires_at` (180 días). Índice en `expires_at` para cron refresh.
- `inventario_tn_map`: mapeo producto Genesis360 ↔ TN (tn_product_id + tn_variant_id). Flags `sync_stock` y `sync_precio`.
- Todas con RLS tenant. Frontend solo consulta campos de estado, nunca `access_token`.

#### EF `tn-oauth-callback` + `mp-oauth-callback`
- Ambas sin JWT (`--no-verify-jwt`). Reciben el redirect OAuth, intercambian code por token, upsert en tabla de credenciales, redirigen a `APP_URL/configuracion?tab=integraciones&tn=ok`.
- `state` = `btoa(tenantId:sucursalId)` — identifica qué sucursal está conectando.
- TN: `user_id` viene en la respuesta del token (no en la URL). MP: `expires_in` → calcular `expires_at`.
- Secrets: `TN_CLIENT_SECRET`, `MP_CLIENT_SECRET`, `APP_URL` en Supabase EF secrets (nunca en Vercel).

#### ConfigPage tab Integraciones
- Tab nueva `integraciones` (icono `Plug`).
- TiendaNube (verde `#95BF47`): botón "Conectar" → OAuth redirect con `state`. Badge "Conectada" + fecha. Desconectar elimina la fila.
- MercadoPago (azul `#009EE3`): ídem. Muestra `seller_email` + fecha vencimiento token. Badge "Vencido" si `expires_at < now()`.
- Banner amarillo si faltan env vars (`VITE_TN_APP_ID` / `VITE_MP_CLIENT_ID`).
- Toast de resultado al volver del OAuth (`?tn=ok`, `?mp=ok`, `?error=...`).

#### Registros de apps externas
- **TiendaNube Partners**: App ID `30376`. Redirect URI PROD: `https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/tn-oauth-callback`. Permisos: Edit Products + Edit Orders + View Customers.
- **MP Developers**: Client ID `7675256842462289`. Redirect URIs DEV + PROD configuradas. Permisos: read + offline_access + write.

### v1.0.0–v1.1.0 ✅ PROD

#### Stock reservation TN/ML al recibir orden (v1.0.0)
- Al crear venta "Reservada" desde TN/ML webhook → incrementa `cantidad_reservada` en `inventario_lineas` (FIFO)
- Sync worker usa `cantidad - cantidad_reservada` → stock correcto en marketplaces sin oversell
- TN: maneja `order/cancelled` → libera `cantidad_reservada` y cancela venta en G360
- Duplicados TN (race condition `order/paid` + `order/created` simultáneos) → fix: si `order/created` llega después y ya existe venta, la saltea

#### pg_cron para sync exacto cada 5 min (v1.0.0)
- `pg_cron` + `pg_net` instalados en DEV + PROD
- Jobs: `meli-stock-sync` + `tn-stock-sync` corriendo cada 5 min desde la DB
- GitHub Actions sigue activo como backup pero no es el mecanismo principal

#### Importar maestros extendido (v1.1.0)
- ImportarMasterPage: 8 tipos — categorias, proveedores, ubicaciones, estados, motivos, combos, aging (progresión de estado), **grupos de estados**
- Importar productos: validación categoria/proveedor debe existir (no auto-crea). Columnas estructura completas (estr_nombre + dimensiones alto/ancho/largo por nivel)

#### Configuración y UX (v1.1.0)
- Migration 067: `tenants.presupuesto_validez_dias INT DEFAULT 30`
- ConfigPage → Negocio: campo días de validez de presupuesto
- Ticket diferencia presupuesto vs venta (badge "PRESUPUESTO", días de validez)
- Historial detalle de venta: desglose IVA por tasa real (no hardcodeado 21%)
- Historial paginación: selector 20/50/75/100, doble click custom, primera/última, total registros
- Autorizaciones DEPOSITO aprobadas → aparecen en /historial via logActividad
- Caja apertura: sugiere monto del cierre anterior de esa caja
- Onboarding: nuevos negocios con regla=Manual y timeout=Nunca por default
- Logo sidebar → abre `www.genesis360.pro` en nueva pestaña
- Regla Manual usa FIFO como desempate cuando prioridades son iguales

#### VentasPage mejoras (v1.1.0)
- Scanner: mismo producto sin series → suma cantidad en lugar de nueva línea
- Combo: quita descuento al bajar cantidad del umbral + sugerencia cuando falta 1
- VentasPage: `refetchOnMount` en sesiones de caja para detectar caja abierta al navegar
- Notificaciones MP: fix columna `payload_raw` + reset `seenMpLogs` al cambiar de tenant

#### Canales TN+ML en ubicaciones y estados (migration 066, v0.98.0)
- `ubicaciones.disponible_tn/disponible_meli BOOLEAN DEFAULT TRUE`
- `estados_inventario.es_disponible_meli BOOLEAN DEFAULT TRUE`
- ConfigPage → Ubicaciones: botones TN (verde) y ML (amarillo) por ubicación
- ConfigPage → Estados: columna ML en tabla de permisos
- meli-stock-worker filtra por ambos flags

#### Sync manual + auto-complete mapeo TN/ML (v0.99.0)
- Botón "↑ Sync stock" en sección TN y ML → encola jobs + llama worker inmediatamente
- EF `tn-search-products`: busca en TN API por SKU para auto-complete del mapeo
- EF `meli-search-items`: busca en ML API por SKU para auto-complete del mapeo

### v0.91.0–v0.99.0 ✅ PROD

#### Estados de inventario — permisos por canal (migrations 063, 064, 066)
- **Migration 063**: `estados_inventario.es_disponible_tn BOOLEAN DEFAULT TRUE` — excluye estados del sync con TiendaNube.
- **Migration 064**: `estados_inventario.es_disponible_venta BOOLEAN DEFAULT TRUE` — bloquea estados para ventas POS.
- **Migration 066**: `estados_inventario.es_disponible_meli BOOLEAN DEFAULT TRUE` + `ubicaciones.disponible_tn/disponible_meli BOOLEAN DEFAULT TRUE`.
- **ConfigPage → Estados**: sub-tabs (Estados / Grupos de estados / Progresión de estado). Tabla "Permisos por estado": 4 columnas: 🛒 vendible · TN · ML · ↺ devoluciones.
- **ConfigPage → Ubicaciones**: botones TN (verde) y ML (amarillo) por ubicación.
- **VentasPage**: filtra líneas por `es_disponible_venta` al calcular stock vendible y al agregar al carrito.
- **tn-stock-worker**: filtra por `es_disponible_tn` en estados.
- **meli-stock-worker**: filtra por `es_disponible_meli` en estados y `disponible_meli` en ubicaciones.

#### MercadoLibre — integración completa (migration 065)
- **Migration 065**: `meli_credentials` + `inventario_meli_map` + trigger `trg_meli_stock_sync`.
- **EF `meli-oauth-callback`**: OAuth, upsert credenciales, registro webhook automático. Usa `SUPABASE_URL` env para redirect URI (no `req.url`).
- **EF `meli-webhook`**: `orders_v2` → venta `reservada/pendiente`. Idempotencia por `meli-order-{id}`. `tenant_id` en `venta_items`. Crea cliente por nickname. Título ML en notas cuando no hay mapeo.
- **EF `meli-stock-worker`**: jobs `sync_stock` y `sync_precio`. Filtra por `es_disponible_meli`. Refresh token automático.
- **EF `meli-search-items`**: busca items en ML por SKU/nombre para auto-complete del mapeo.
- **GitHub Actions** `.github/workflows/meli-stock-sync.yml`: cron `*/5 * * * *`.
- **ConfigPage → Integraciones → ML**: botones "↑ Sync stock" y "📦 Sync productos (prox)". CRUD mapeo con auto-complete por SKU.
- **App ML**: Client ID `2358829201151305`. MELI_CLIENT_ID + MELI_CLIENT_SECRET en Supabase secrets.
- **Items OMNI**: usar endpoint `PUT /items/{id}/variations/{var_id}` — `available_quantity` a nivel item no es modificable en publicaciones sincronizadas.

#### MercadoPago — QR y pagos (v0.92.x)
- **EF `mp-crear-link-pago`**: crea preference con `external_reference = venta.id`. Venta opcional (pre-venta UUID para ventas directas).
- **VentasPage**: botón QR en checkout + reservas. `preVentaId` UUID pregenerado. Polling 4s → pantalla "¡Pago recibido!" → botón Finalizar.
- **AppLayout**: toast global cada 30s cuando llega pago MP (💳 monto · fecha · hora).
- **mp-webhook**: routing por `seller_id` → actualiza `monto_pagado`. Guarda pago en `ventas_externas_logs` con `mp-preventa-{id}` si venta no existe aún.
- **Presupuesto → Reserva**: abre modal de seña parcial en lugar de error cuando no hay pago previo.

#### TiendaNube — mejoras (v0.91+)
- **tn-search-products EF**: busca productos en TN por SKU/nombre para auto-complete del mapeo.
- **ConfigPage → Integraciones → TN**: botón "↑ Sync stock" manual.
- **tn-stock-worker**: filtra por `es_disponible_tn` en estados + `disponible_tn` en ubicaciones.

#### VentasPage — mejoras (v0.94–v0.97)
- **Tab Canales**: KPIs por canal (POS/MELI/TN/MP) + listado filtrable. Filtros: búsqueda libre, estado, rango de fechas.
- **Stock disponible vs total**: ProductosPage muestra badge verde (disponible) + badge gris (total). Precio costo en lugar de USD.
- **InventarioPage**: unidades solo en estados con `es_disponible_venta = true`.

### v0.90.0 ✅ PROD

#### TiendaNube — Webhooks y Sync de Stock (migration 062)

- **EF `tn-webhook`** (sin JWT): recibe `order/created` → venta `pendiente`; `order/paid` → si existe venta `pendiente` la actualiza a `reservada`, si no existe la crea directamente como `reservada`. Idempotencia por clave `{store_id}-{event}-{orderId}` en `ventas_externas_logs`. Mapeo productos por `inventario_tn_map` + fallback SKU ilike. Crea cliente si no existe.
- **EF `tn-stock-worker`** (sin JWT): procesa jobs `sync_stock` de `integration_job_queue`. Calcula `SUM(cantidad - cantidad_reservada)` en `inventario_lineas`, hace PUT a TN API. Backoff exponencial (1/2/4/8/16 min), máx 5 reintentos. BATCH_SIZE=50. Actualiza `inventario_tn_map.ultimo_sync_at` en éxito.
- **EF `tn-oauth-callback`** actualizada: registra automáticamente webhooks `order/created` + `order/paid` en TN al conectar. Ignora 422 (ya existe).
- **Migration 062**: trigger `trg_tn_stock_sync` AFTER INSERT/UPDATE/DELETE en `inventario_lineas` → `fn_enqueue_tn_stock_sync()` SECURITY DEFINER → INSERT en `integration_job_queue` con NOT EXISTS dedup.
- **GitHub Actions** `.github/workflows/tn-stock-sync.yml`: cron `*/5 * * * *` → llama `tn-stock-worker`.
- **ConfigPage → Integraciones → Productos**: sección colapsable por sucursal con CRUD de `inventario_tn_map` (producto, TN Product ID, TN Variant ID, toggle sync_stock).
- **VentasPage**: línea "Envío $X" en modal detalle y ticket cuando `costo_envio_logistica > 0`.

#### Monitoring diario
- **EF `monitoring-check`** deployada en PROD ✅. Secret `RESEND_API_KEY` configurado. Email diario a las 9 AM AR (Argentina) con KPIs: reservas viejas >5d, stock crítico, cajas abiertas >16h, ventas del día.
- **GitHub Actions** `.github/workflows/monitoring-check.yml`: cron `0 12 * * *`.

#### MercadoPago — IPN pagos regulares
- **EF `mp-ipn`** (sin JWT, DEV + PROD): alternativa independiente — recibe notificación → verifica en MP API → busca venta por `external_reference` (= venta_id UUID o tracking_id) → actualiza `id_pago_externo` + `money_release_date`. Log idempotencia en `ventas_externas_logs`.
- **EF `mp-webhook`** actualizada: enruta por `user_id` del payload. Si coincide con `mercadopago_credentials.seller_id` → pago de **venta** (usa access_token del seller, actualiza venta). Si no coincide → pago de **plataforma** (addon/suscripción, comportamiento anterior). URL configurada en MP Developers para eventos `payment` + `subscription_preapproval`.
- **Registro URL webhook MP**: `https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-webhook` · Eventos: Pagos ✅ + Planes y suscripciones ✅.
- **`external_reference` convention**: para ventas con link de pago MP → usar `venta.id` (UUID). El IPN lo matchea automáticamente.

#### Documentación soporte
- **`docs/soporte_tiendanube.html`**: guía imprimible para el equipo de soporte con flujo completo, pasos de conexión, mapeo de productos, verificación, estados, troubleshooting y FAQ.

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

### v0.46.0 — Tests E2E + Caja + Multi-dominio ✅ PROD
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

### v0.63.0 ✅ PROD

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

### v0.62.0 ✅ PROD

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

### v0.68.0 ✅ PROD

#### IVA por producto (migration 042)
- `productos.alicuota_iva DECIMAL(5,2) DEFAULT 21 CHECK IN (0, 10.5, 21, 27)`: select en ProductoFormPage (Exento/10.5%/21%/27%). Persiste en DB.
- `venta_items.alicuota_iva` + `venta_items.iva_monto`: IVA histórico al momento de la venta. Cálculo: `ivaMonto = subtotal - subtotal / (1 + rate/100)` (precio IVA incluido).
- Checkout: desglose de IVA agrupado por tasa (línea gris por cada tasa activa en el carrito).
- `inventario_lineas.precio_venta_snapshot DECIMAL(14,2)`: precio de venta al momento del ingreso.

#### Biblioteca de Archivos (migration 042)
- Tabla `archivos_biblioteca`: nombre, tipo (certificado_afip_crt/key/contrato/factura_proveedor/manual/otro), storage_path, tamanio, mime_type.
- Bucket privado `archivos-biblioteca` (10 MB). RLS por tenant_id.
- Tab "Biblioteca" en ConfigPage: upload, lista, descarga (signed URL 300s), eliminar.

#### Certificados AFIP (migration 043)
- Tabla `tenant_certificates`: UNIQUE por tenant, cuit, fecha_validez_hasta, activo. Trigger `updated_at`.
- Bucket privado `certificados-afip` (1 MB). RLS filtra por `tenant_id` en el path del archivo.
- `src/lib/afip.ts`: `uploadCertificates()` — valida extensiones, sube .crt + .key, rollback si falla, upsert en DB.
- ConfigPage → tab Negocio: sección colapsable "Certificados AFIP" con badge estado, CUIT, fecha validez, file inputs con `accept=".crt"/.key"`, botón Guardar/Reemplazar.

#### UX fixes
- **Ventas**: precio_unitario read-only en carrito (se edita desde Productos) · reorden checkout (Desc+Notas → Totales → Método pago → Acciones) · "Sin Pago Ahora" → "Presupuesto"
- **Alertas**: botón "Resolver" bloqueado si `stock_actual <= stock_minimo` (toast de error). Complementa el trigger `auto_resolver_alerta_stock` de migration 042.
- **Inventario**: tab default cambiada a `'inventario'` · motivo "Ventas" (`es_sistema=true`) oculto en select de rebaje manual
- **Dashboard**: h1 muestra `tenant.nombre` (en lugar de la fecha); fecha pasa a subtítulo
- **motivos_movimiento**: columna `es_sistema BOOLEAN DEFAULT FALSE`; UPDATE marca "Ventas" como `es_sistema=TRUE`

#### Design System Sprint 1 ✅
- `tailwind.config.js`: tokens nuevos aditivos: `page`, `surface`, `muted`, `border-ds`, `success`, `danger`, `warning`, `info` (via CSS vars). `fontFamily.mono = JetBrains Mono`.
- `src/index.css`: variables `--ds-*` en `:root` (light) y `.dark` (dark). Semánticos = iguales en ambos modos.
- `index.html`: JetBrains Mono 400/500 + preconnect gstatic.
- `src/styles/design-tokens.css`: referencia completa — recetas botones/cards/tabs/inputs, colores raw, guía de uso.
- Tokens existentes (`primary`, `accent`, `brand-bg`) sin modificar → cero regressions.

#### Design System Sprint 2 ✅ — Header + Sidebar
- **Sidebar**: `bg-surface border-r border-border-ds` (blanco light / `#171717` dark). Texto adaptativo: `text-primary dark:text-white` / `text-muted`. Nav items inactivos: `text-gray-700 dark:text-gray-300 hover:bg-accent/10 hover:text-accent`. Nav activo: `bg-accent text-white`.
- **Nav reordenado**: RRHH sube a posición 9 (después de Alertas), Historial 10, Reportes 11.
- **Sin bloque de perfil en sidebar**: se removieron el NavLink de perfil (avatar+nombre+rol+tenant) y el "Mi Plan" del pie. El sidebar queda: Logo → Nav → CotizacionWidget.
- **Header**: `bg-surface border-b border-border-ds`. Botones: `text-muted hover:text-primary dark:hover:text-white`. Sin `shadow-sm`.
- **6 nuevos componentes** (`src/components/`):
  - `AvatarDropdown.tsx`: avatar + dropdown con info usuario (email via `supabase.auth.getSession()`), Perfil, Idioma/País (próximamente), Cerrar sesión.
  - `AyudaModal.tsx`: drawer desde derecha (w-96), FAQs dinámicas por `pathname`, buscador, placeholder videos, form bug-report → `mailto:soporte@genesis360.pro`.
  - `NotificacionesButton.tsx`: campana con badge rojo, popover con datos simulados + marcar como leída. Backend pendiente.
  - `RefreshButton.tsx`: `useQueryClient().invalidateQueries()` + spinner 800ms.
  - `ConfigButton.tsx`: ícono Settings → `/configuracion` (visible solo OWNER/ADMIN).
  - `PlanProgressBar.tsx`: barra reutilizable success/warning/danger por % uso. Reemplaza banners inline en ProductosPage e InventarioPage.
- **Orden header** (izq→der): [hamburger mobile] [spacer] [SucursalSelector] [Refresh] [Notificaciones] [Dark/Light] [Ayuda] [Config] [AvatarDropdown]. Pendiente: reordenar completamente + gestionar cuentas en AvatarDropdown.
- **Logo sidebar**: `<a href>` → `https://www.genesis360.pro` en dominio app, `/` en dev. El toggle colapsar (ChevronLeft/Right) queda separado a la derecha.
- **SucursalSelector**: eliminada opción "Todas las sucursales". Auto-selecciona la primera sucursal si no hay ninguna seleccionada. Siempre se trabaja en una sucursal específica.
- **CotizacionWidget**: colores adaptados para light mode (`text-blue-500 dark:text-blue-300`, etc.).
- **Sin bordes en tarjetas**: removido `border border-gray-{100,200} dark:border-gray-700` de todas las cards en DashboardPage, MetricasPage, RentabilidadPage, RecomendacionesPage. Solo shadow.
- **Barras DS homologadas**: todas las barras de progreso usan `bg-accent` (violeta). Corrige clases Tailwind malformadas (`dark:bg-red-900/20/40`, `dark:bg-green-900/200`) que causaban fondo claro + texto claro en dark mode.
- **Divisores Detalle por venta**: `divide-gray-50` → `divide-gray-200 dark:divide-gray-600` (visibles en ambos modos).

#### Design System Sprint 3 ✅ — Dashboard tab General
- **5 componentes nuevos** en `src/components/`:
  - `FilterBar.tsx`: período (Hoy/7D/30D/Mes/Trim/Año) + ARS/USD + c/IVA s/IVA. Helpers: `getFechasDashboard`, `getFechasAnteriores`, `labelPeriodo`. Tipos: `PeriodoDash`, `Moneda`, `IVAMode`.
  - `KPICard.tsx`: tarjeta reutilizable con `title`, `value`, `badge` (success/warning/danger/neutral + TrendingUp/Down), `sub`, `icon`, `onClick`.
  - `InsightCard.tsx`: tarjeta insight con `variant` (danger/warning/success/info), `icon`, `title`, `description`, `action`.
  - `VentasVsGastosChart.tsx`: AreaChart "La Balanza" — ventas (área violeta) + gastos (línea roja) por día. Tooltip oscuro con diferencia. Usa `getFechasDashboard` para rango.
  - `MixCajaChart.tsx`: Donut "El Mix de Caja" — por método de pago (Efectivo=accent, Transferencia=blue, Tarjeta=green, MP=cyan). Labels % en sectores, total en centro.
- **DashboardPage tab General** refactorizado:
  - FilterBar arriba; controla periodo/moneda/IVA de KPIs y gráficos
  - 4 KPIs nuevas: Ingreso Neto (caja_movimientos ingreso-egreso), Margen Contribución ((ventas-costo)/ventas×100), Burn Rate diario (gastos/días), Posición IVA (sum venta_items.iva_monto)
  - Badges comparativas auto: `getFechasAnteriores(periodo)` calcula período anterior equivalente
  - Gráficos en grid 2 col: La Balanza + El Mix de Caja
  - Insights automáticos: top 4 de `useRecomendaciones` en grid 2 col con `InsightCard`
  - Tabla Fugas y Movimientos: top 8 gastos+ventas del período ordenados por monto
  - Secciones existentes (stock crítico, proyección, sugerencia pedido, top productos, movimientos) sin cambios debajo

#### Testing por rol
- [x] Tests E2E para CAJERO: `13_rol_cajero.spec.ts` (v0.64.0) — 20 tests ✅
- [x] Tests E2E para SUPERVISOR: `15_rol_supervisor.spec.ts` (v0.65.0) — 23 tests ✅
- [x] Tests E2E para RRHH: `16_rol_rrhh.spec.ts` (v0.66.0) — 18 tests ✅
- [x] Tests de coherencia de números: `14_coherencia_numeros.spec.ts` (v0.64.0)
- Usuarios E2E DEV: OWNER `e2e@genesis360.test` · CAJERO `cajero1@local.com` · RRHH `rrhh1@local.com` · SUPERVISOR `supervisor@test.com` — todos con contraseña `123` (via SQL en auth.users)
- Test regresión v0.57.0: `modificarReserva` con serializado → series disponibles en carrito ✅ (04_ventas.spec.ts)

### v0.70.0 ✅ PROD
- ✅ **Header reorden**: nuevo orden [SucursalSelector][Refresh][Notificaciones][Dark/Light][Ayuda][Config][AvatarDropdown]
- ✅ **ConfigButton**: ícono `Settings2` → `Settings` (rueda, igual que sidebar)
- ✅ **AvatarDropdown — Gestionar cuentas**: al abrir el dropdown guarda cuenta actual en `genesis360_saved_accounts` (localStorage). Muestra cuentas guardadas con avatar/nombre/tenant. Cuenta activa marcada con ✓. Click en otra cuenta → `signOut()` + `navigate('/login?email=...')`. "+ Agregar otra cuenta" → `signOut()` + `navigate('/login')`.

### v0.71.0 ✅ PROD
- ✅ **Seña en caja** (migration 044): `caja_movimientos.tipo` sin cambio de schema (TEXT libre).
  - Al crear reserva con efectivo → INSERT `ingreso_reserva` en `caja_movimientos` (fire-and-forget).
  - Al despachar desde reservada → query `caja_movimientos` por `concepto = 'Seña Venta #N'` para evitar duplicado; si existe → `efectivoOriginal = 0`.
  - Al cancelar reserva con `monto_pagado > 0` y efectivo en `medio_pago` → INSERT `egreso_devolucion_sena` (fire-and-forget).
  - `CajaPage.tsx`: saldo usa `tipo IN ('ingreso','ingreso_reserva')` para ingresos y `tipo IN ('egreso','egreso_devolucion_sena')` para egresos. Colores/prefijos actualizados con misma lógica.
  - `pagar_nomina_empleado` (migration 044): CASE WHEN actualizado con nuevos tipos.
  - 7 unit tests nuevos en `tests/unit/cajaSeña.test.ts`. Total: **148/148** passing.

### v0.72.0 ✅ PROD
- ✅ **Roles CONTADOR + DEPOSITO**: `UserRole` ampliado · AppLayout `CONTADOR_ALLOWED` (dashboard/gastos/historial/reportes) · `DEPOSITO_ALLOWED` (productos/inventario/alertas) · navItems con flags · UsuariosPage con CRUD de ambos roles + modal permisos por usuario
- ✅ **Inventario por ubicación**: query `lineasMap` incluye `productos(nombre,sku,unidad_medida)` + `byUbicacion`. Toggle `LayoutList/Building` en tab Inventario. Vista expandible por ubicación con lineas/producto/stock.
- ✅ **Clonar KIT**: botón Clonar en header KIT (deshabilitado si sin receta) → modal selector de KIT destino → `clonarKitRecetas.mutate({origenId, destinoId})`. Eliminada mutación muerta `clonarKit`.
- ✅ **Compresión imagen**: `browser-image-compression` — si imagen > 2 MB → comprime a 1.5 MB / 1200px. SKU+barcode row full-width en mobile.
- ✅ **FilterBar custom**: eliminado '30D', agregado 'Custom' con date pickers inline. `getFechasDashboard(periodo, customRange?)` y `getFechasAnteriores(periodo, customRange?)`. DashboardPage pasa `customRange`.
- ✅ **GastosPage**: eliminada categoría 'Sueldos y cargas sociales' (pertenece a RRHH/Nómina).
- ✅ **Métodos de pago** (migration 045): tabla `metodos_pago` con tenant_id, nombre, color, activo, es_sistema, orden. ConfigPage tab 'Métodos de pago': CRUD + color picker + toggle activo + seed automático de 5 defaults. MixCajaChart usa colores de DB.

### v0.74.0 ✅ PROD

#### Design System Sprint 4 — VentasPage checkout
- **`VentasPage.tsx`** — 42 reemplazos de tokens DS en checkout, historial y modales:
  - `bg-white dark:bg-gray-800` → `bg-surface` en todos los panels, cards, dropdowns y modales (8+6+1 ocurrencias)
  - `border border-gray-100` → `border border-border-ds` en cards del checkout
  - Section headings `text-gray-700 dark:text-gray-300` → `text-primary`
  - Product names/totals `text-gray-800 dark:text-gray-100` → `text-primary`
  - `divide-y divide-gray-50` → `divide-y divide-gray-200 dark:divide-gray-600`
  - Cart header: `bg-gray-50 dark:bg-gray-700` → `bg-page`
  - Precio read-only field: → `bg-page text-muted`
  - Semánticos en totales: `text-gray-600` → `text-muted`, `text-blue-600` → `text-info`, `text-green-600` → `text-success`
  - `font-mono` en todos los valores numéricos de precio (dropdown, galería, carrito, totales, historial)
- **Design System Sprint status**: Sprint 1 ✅ Tokens · Sprint 2 ✅ Header+Sidebar · Sprint 3 ✅ Dashboard General · Sprint 4 ✅ Ventas checkout

### v0.74.1 ✅ PROD

#### Fix — Medios de pago no-efectivo registrados en caja
- **Bug**: pagos con tarjeta, transferencia, MP y otros no quedaban en `caja_movimientos`. Solo el efectivo era registrado. El resumen de movimientos de sesión no mostraba estas operaciones.
- **Fix `GastosPage.tsx`**: gasto con medio ≠ Efectivo → INSERT `egreso_informativo` con concepto `[MedioPago] Gasto: descripción`.
- **Fix `VentasPage.tsx` `registrarVenta`**: reserva con parte no-efectiva → INSERT `ingreso_informativo` con concepto `[Tipos] Seña Venta #N` (fire-and-forget).
- **Fix `VentasPage.tsx` `cambiarEstado`**: al despachar desde historial → INSERT `ingreso_informativo` con no-efectivo del saldo cobrado ahora + no-efectivo original de la reserva (si ya estaba en caja).
- **Fix `CajaPage.tsx`**: `egreso_informativo` agregado a `TIPO_LABEL` y `extraerMedioPago`; incluido con signo negativo en `totalesMedios`.
- **Invariante de saldo**: `totalIngresos` y `totalEgresos` para calcular saldo solo incluyen tipos `*` (no `*_informativo`) — el saldo de efectivo no se ve afectado.

### v0.76.0 ✅ PROD

#### Módulo Proveedores completo (migration 049)
- **9 campos extendidos en `proveedores`**: `razon_social`, `cuit`, `domicilio`, `condicion_iva` CHECK (Responsable Inscripto/Monotributista/Exento/Consumidor Final), `plazo_pago_dias INT`, `banco`, `cbu`, `notas`, `sucursal_id`.
- **Tabla `ordenes_compra`**: `tenant_id`, `proveedor_id`, `numero INT` (auto per tenant), `estado CHECK (borrador/enviada/confirmada/cancelada)`, `fecha_esperada`, `notas`, `created_by`. UNIQUE(tenant_id, numero). RLS policy `oc_tenant`.
- **Tabla `orden_compra_items`**: `orden_compra_id`, `producto_id`, `cantidad`, `precio_unitario`, `notas`. RLS policy `oc_items_tenant`.
- **Triggers**: `trg_set_oc_numero` BEFORE INSERT (MAX+1 per tenant, numero=0 como placeholder) · `trg_updated_at_oc`.
- **Interfaces** en `supabase.ts`: `Proveedor` extendida · `EstadoOC = 'borrador'|'enviada'|'confirmada'|'cancelada'` · `OrdenCompra` con join `proveedores` · `OrdenCompraItem` con join `productos`.
- **`ProveedoresPage.tsx`** nueva (~600 líneas): 2 tabs underline — Proveedores (cards + modal form 12 campos, toggle activo) + Órdenes de Compra (filtros estado/proveedor, cards con lifecycle buttons: Send→enviada / CheckCircle→confirmada / XCircle→cancelar / Trash2→borrar borrador). `InlineOCItems` subcomponent para preview expandible. Modal detalle OC completo.
- **ConfigPage**: eliminados todos los bloques de proveedores y archivos (state, queries, mutations, JSX, imports `Truck FolderOpen FileText Download`).
- **Sidebar**: `Truck` icon `/proveedores` (ownerOnly) posicionado entre Clientes y Alertas.
- **Arquitectura ASN-ready**: OC lifecycle termina en `confirmada` — la recepción y generación de stock es responsabilidad del futuro módulo ASN.

### v0.85.0 ✅ PROD

#### Sprint B inventario (migration 052)

- **I-04 — stock_minimo por sucursal**: tabla `producto_stock_minimo_sucursal(tenant_id, producto_id, sucursal_id, stock_minimo)` con UNIQUE + RLS. UI en ProductoFormPage: sección "Stock mínimo por sucursal" visible cuando `isEditing && sucursales.length > 0`. Input por sucursal con placeholder = valor global. Botón "Guardar mínimos" independiente. Fallback al global si no hay override.
- **I-05 — Mono-SKU en ubicaciones**: `ubicaciones.mono_sku BOOLEAN DEFAULT FALSE`. Toggle checkbox en formulario de edición de ConfigPage → Ubicaciones. Badge ámbar "Mono-SKU" en vista de lista. Validación en `ingresoMutation` de InventarioPage: si la ubicación tiene `mono_sku=true` y ya tiene un producto distinto con stock > 0, lanza error descriptivo.
- **I-09 — En Armado kitting**: `kitting_log.estado CHECK('en_armado','completado','cancelado')` + `componentes_reservados JSONB`. Flujo en 2 fases: "Iniciar armado" incrementa `cantidad_reservada` en líneas de componentes y crea `kitting_log` con `estado='en_armado'`; sección "En Armado" en tab Kits muestra armados activos con botones Confirmar (rebaja componentes + ingresa KIT + `estado='completado'`) y Cancelar (libera reservas + `estado='cancelado'`).
- **fix — security_invoker view** (migration 053): `stock_por_producto` recreada con `WITH (security_invoker = true)` — elimina warning del Security Advisor de Supabase.
- **fix — APP_VERSION**: bump a `v0.85.0` en `src/config/brand.ts`.

### v0.87.0 ✅ PROD

#### Sprint D inventario — Combinar LPNs + LPN Madre (migration 057)

- **Migration 057**: `inventario_lineas.parent_lpn_id TEXT DEFAULT NULL` + índice `WHERE parent_lpn_id IS NOT NULL`.
- **Checkboxes en tabla LPN**: grid-cols-7 → grid-cols-8; checkbox header (seleccionar todo del producto) + checkbox por fila. Selección resaltada con borde `border-accent/50`. Validación: solo LPNs del mismo producto.
- **Barra flotante de acción**: aparece en la parte inferior cuando ≥2 LPNs seleccionados. Muestra conteo + botones "Limpiar" y "Combinar".
- **Modal Combinar** con dos modos:
  - **Fusionar**: todo el stock pasa al LPN destino (radio selector). Los otros quedan `activo=false, cantidad=0`. Inserta `ajuste_ingreso` en destino. Muestra stock resultante en tiempo real.
  - **LPN Madre**: asigna `parent_lpn_id` a los LPNs seleccionados. No mueve stock. Los hijos muestran "↳ PLT-001" debajo del LPN en la tabla.
- **Restricción fusionar**: todos los LPNs deben ser del mismo `producto_id` (validado en UI y `mutationFn`).

### v0.86.0 ✅ PROD

#### Sprint C inventario — Tab Autorizaciones DEPOSITO (migrations 055+056)

- **Migration 055**: `movimientos_stock.tipo` CHECK ampliado (`ajuste_ingreso`, `ajuste_rebaje`, `traslado`). `cantidad INT → DECIMAL(14,4)` — soporta UOM decimales (kg, l, g, etc.).
- **Migration 056**: tabla `autorizaciones_inventario` (tipo CHECK('ajuste_cantidad','eliminar_serie','eliminar_lpn'), linea_id, datos_cambio JSONB, estado pendiente/aprobada/rechazada, solicitado_por, aprobado_por, motivo_rechazo). RLS tenant. Índice (tenant_id, estado). Trigger updated_at.
- **LpnAccionesModal — DEPOSITO interception**: `esDeposito = user?.rol === 'DEPOSITO'`. `guardarEdicion`: si cantidad cambia → `crearAutorizacion('ajuste_cantidad', {cantidad_anterior, cantidad_nueva})` + guarda otros campos sin tocar cantidad. `eliminarLpn`: DEPOSITO → solicita autorización; OWNER/SUPERVISOR → ejecuta. `eliminarSerie`: DEPOSITO → solicita autorización; OWNER/SUPERVISOR → ejecuta. Tab Eliminar: DEPOSITO ve UI azul "Solicitar eliminación" (ClipboardList); no-DEPOSITO ve UI roja.
- **Fix historial — conteo y ajuste LPN**: `movimientos_stock.tipo` CHECK ahora incluye `ajuste_ingreso`/`ajuste_rebaje` → conteos y ajustes de LPN quedan en `/historial` y tab Historial de InventarioPage.
- **Fix registrarMovimiento**: `stock_despues` ahora calculado correctamente (`stockAntes + diff`); antes siempre era igual a `stockAntes`.
- **Fix tipos inválidos**: removidos `edicion_lpn`, `edicion_serie` (cantidad=0 violaba CHECK); `traslado` en `moverStock` eliminado (no afecta stock neto). Solo `actividadLog` en operaciones sin cambio de stock.
- **Tab Autorizaciones en InventarioPage**: visible para OWNER/SUPERVISOR/ADMIN. Pills Pendientes/Aprobadas/Rechazadas. Cards por solicitud: tipo badge, producto/SKU, LPN, datos del cambio solicitado, solicitante, fecha. Aprobar (ejecuta acción + inserta movimiento válido + marca aprobada). Rechazar (inline motivo_rechazo).
- **Reorden de tabs**: Inventario → Agregar Stock → Quitar Stock → Kits → Conteos → Historial → Autorizaciones.
- **Historial filtros**: rango de fechas (desde/hasta), categoría de producto, tipo, motivo (búsqueda de texto). Badge "Conteo" detectado por prefijo en motivo.
- **`getTipoBadge(tipo, motivo)`**: helper en InventarioPage — distingue "Conteo" vs "Ajuste ±" para `ajuste_ingreso`/`ajuste_rebaje` según prefijo del motivo.

### v0.85.3 ✅ PROD

#### Fix: cálculo de margen strip IVA (ProductoFormPage, MetricasPage, DashboardPage, useRecomendaciones)

- **Fórmula corregida**: `precio_venta` en DB incluye IVA. Fórmula anterior `(venta - costo) / costo` sobreestimaba el margen (142% en lugar de 100%). Nueva fórmula: `precio_neto = precio_venta / (1 + iva/100)` → `markup% = (neto - costo) / costo × 100`.
- **Precio sugerido en ProductoFormPage**: con margen objetivo y alícuota configurada → `costo × (1 + margen%) × (1 + iva%)`. Muestra hint azul debajo del campo.
- **Ganancia en ProductoFormPage**: `precio_venta / ivaFactor - precio_costo` (neto, no precio con IVA).
- **MetricasPage — margenProductos**: usa `iva_monto` de `venta_items` para obtener el neto histórico. Markup sobre costo.
- **MetricasPage — gananciaNeta**: strip IVA de ventas antes de restar costo y gastos (`totalVentas - ivaVentasPeriodo - costoVentas - gastosTotal`).
- **MetricasPage — insightsMargen**: usa `alicuota_iva` del producto para el margen actual. Markup.
- **DashboardPage — margenContrib**: `(totalVentasNeto - totalCosto) / totalCosto × 100` donde `totalVentasNeto = totalVentas - ivaVentas`. Misma lógica en período anterior.
- **useRecomendaciones — regla margen-realizado-bajo**: `totalNeto = totalFacturado - totalIva`; umbral 15% sobre markup de neto.

### v0.85.2 ✅ PROD

#### Fixes VentasPage (bugs de cantidad, descuento y venta sin líneas)

- **Descuento: cambio de tipo clampea el valor**: al cambiar de `$` a `%`, si el monto era mayor a 100 queda clampeado a 100%. Al cambiar de `%` a `$`, convierte el porcentaje a monto equivalente sobre el subtotal del ítem. Antes era posible tener >100% tras el cambio de tipo.
- **LPN eliminado del ticket**: el ticket del cliente ya no muestra los LPNs internos (son datos de almacén, no relevantes para el cliente).
- **Cantidad decimal: display con coma**: el input de cantidad muestra `defaultValue` con coma como separador (ej: `1,5` en vez de `1.5`).
- **Cantidad entero: bloquea punto y coma**: para UOM no-decimales (unidades, etc.) el `onKeyDown` previene ingreso de `.` o `,`, evitando que quede `2,5` en pantalla.
- **Stock guard tras restore del carrito**: `updateItem` solo valida stock contra `lineas_disponibles` si tiene al menos una entrada (`length > 0`). Antes, el carrito restaurado desde localStorage (con `lineas_disponibles: []`) causaba que el stock máximo disponible fuera 0.
- **Venta sin líneas imposible**: antes si `venta_items` fallaba (ej: tipo integer en DB), el header `ventas` quedaba huérfano y era finalizable. Ahora: (a) validación previa de cantidad (NaN / ≤ 0 bloqueados), (b) rollback DELETE del header si el insert de items falla.
- **Migration 054**: `venta_items.cantidad INT → DECIMAL(14,4)` — permite guardar cantidades decimales para productos con UOM kg, g, l, etc.
- **`esDecimal` + `parseCantidad` extraídas a `ventasValidation.ts`**: funciones puras accesibles desde tests. 24 nuevos unit tests (`ventasCantidad.test.ts`). Total: **178/178** passing.

### v0.85.1 ✅ PROD

#### Fixes VentasPage

- **Ticket modal scrollable**: `max-h-[90vh] flex flex-col` + `overflow-y-auto flex-1` en contenido — botones Imprimir/Cerrar siempre visibles sin importar cuántos items tenga el ticket.
- **ESC prioridad modal**: `ticketVenta` tiene su propio `useModalKeyboard`. `ventaDetalle` keyboard solo activo cuando `ticketVenta === null` — ESC cierra el modal más interno primero.
- **Decimal punto y coma**: input cantidad usa `defaultValue + onBlur` en vez de `value + onChange` — el usuario puede escribir "1.5" o "1,5" sin que React resetee el punto durante la edición.
- **Descuento clamped**: por item, `pct` máx 100% y `monto` máx subtotal del item. Global: igual con atributo `max` en el input.
- **IVA separado en ticket**: antes del TOTAL aparece línea "Neto (sin IVA)" + líneas "IVA X%" agrupadas por tasa.
- **Presupuesto no genera ticket**: `setTicketVenta` solo se llama si `estado !== 'pendiente'`.
- **Reservar desde historial sin pago bloqueado**: botón "Reservar stock" verifica `monto_pagado > 0` antes de ejecutar, muestra toast descriptivo.
- **Draft carrito vacío**: al vaciar el carrito se borra el draft de localStorage en vez de saltear el save — evita restaurar items ya eliminados al volver a la página.
- **Performance venta directa**: batch insert `venta_items` (1 llamada en vez de N), `Promise.all` por item para series+lineas, batch read `productos` + `Promise.all` para updates + batch insert `movimientos_stock` — de ~80 llamadas secuenciales a ~6 para carrito de 14 items.

### v0.84.0 ✅ PROD

#### Sprint A inventario (migration 051)

- **I-03 — LPN vencidos**: `fecha_vencimiento < hoy` excluye líneas en ventas (4 puntos: `agregarProducto`, `cambiarEstado` reservar, `cambiarEstado` despachar, despacho directo). AlertasPage sección roja "LPNs vencidos" con botón "Ver LPN" → `/inventario?search=LPN-XXX`. Badge `useAlertas` incluye conteo. `InventarioPage` lee `?search=` al montar y pre-filtra.
- **I-06 — Mover LPN a otra sucursal**: selector de sucursal destino en tab Mover de `LpnAccionesModal` (visible solo con ≥2 sucursales configuradas). Nuevo LPN hereda `sucursal_id` seleccionada.
- **I-08 — Over-receipt configurable**: migration 051 `tenants.permite_over_receipt BOOLEAN DEFAULT FALSE`. Toggle en ConfigPage → Negocio. Validación en `RecepcionesPage` (pendiente, módulo futuro).

### v0.83.0 ✅ PROD

#### Conteo de inventario + Estructura LPN (migration 050)

- **Migration 050 bundled**: nuevos estados OC (`recibida_parcial`, `recibida`) + tablas `recepciones` + `recepcion_items` (ASN futuro) + `inventario_lineas.estructura_id UUID FK → producto_estructuras` + tablas `inventario_conteos` + `inventario_conteo_items`. RLS y triggers en todas. DEV ✅.
- **Tab "Conteo"** en `InventarioPage`: nuevo tab con ícono `ClipboardList`.
  - Toggle tipo: **Por ubicación** (selecciona ubicación) / **Por producto** (selecciona producto).
  - Botón "Cargar stock" → `cargarLineasParaConteo()`: query `inventario_lineas` filtrando por `ubicacion_id` o `producto_id`, construye tabla de conteo con `cantidad_esperada` = stock actual.
  - Tabla editable por LPN: nombre, SKU, LPN, stock esperado, campo "Contado" (input numérico).
  - Color diferencias: verde (=esperado), ámbar (contado ≠ esperado), rojo (contado < 0).
  - **Guardar borrador**: `inventario_conteos.estado = 'borrador'` + `inventario_conteo_items` — no afecta stock.
  - **Finalizar y ajustar**: `estado = 'finalizado'`, aplica ajustes secuenciales: `cantidad_contada > esperada` → movimiento `ajuste_ingreso`; `cantidad_contada < esperada` → movimiento `ajuste_rebaje`. `ajuste_aplicado = true`.
  - **Historial de conteos**: query `conteoHistorial` paginada; tarjetas expandibles con detalle de ítems y diferencias.
- **Tab "Estructura"** en `LpnAccionesModal`: nueva pestaña con ícono `Layers`.
  - Query `estructuras`: `producto_estructuras WHERE producto_id = producto.id`.
  - Si hay más de 0 estructuras: cards con nombre, badge "Default", dimensiones por nivel.
  - Radio selector para cambiar la estructura asignada al LPN (o "Sin estructura").
  - Mutation `guardarEstructura`: `UPDATE inventario_lineas SET estructura_id = X WHERE id = linea.id`.
  - Tab visible solo cuando no hay reservas activas (misma lógica que otras tabs).
- **Interfaces TS nuevas** en `supabase.ts`: `InventarioConteo` + `InventarioConteoItem`.
- **Tipos de movimiento**: `ajuste_ingreso` y `ajuste_rebaje` no estaban como valores del CHECK — usar `motivo` en `movimientos_stock` para identificarlos (tipo `ingreso` / `rebaje`).

### v0.82.0 ✅ PROD

#### InventarioPage — series overflow, QR LPN, masivo inline, iconos

- **Series overflow**: chips con primeras 5 series activas + badge `+N más` que abre modal con lista completa. Evita que LPNs con miles de series colapsen la vista.
- **LpnQR.tsx** (nuevo componente): genera QR del LPN con `qrcode`, descarga PNG y ventana imprimible. Botón `QrCode` en el header de `LpnAccionesModal` (izquierda de la X).
- **Masivo Agregar Stock — vista inline**: el botón "Masivo" ya no abre `MasivoModal`; cambia a una vista en página con buscador + scanner, tabla editable (SKU / Cantidad / Estado / Ubicación / acordeón extras: lote, vencimiento, LPN, series). Flujo: escanear → foco en Cantidad → Enter → vuelve al buscador. Mismo SKU sin lote suma cantidad en lugar de nueva fila. Botón "Procesar N ingresos" al pie. Masivo rebaje sigue usando `MasivoModal`.
- **Iconos botones**: Ingreso y Masivo ingreso: `ArrowDown` → `Plus`. Rebaje y Masivo rebaje: `ArrowUp` → `Minus`.
- **Botón ASN**: ícono `ShoppingBasket` en tab Agregar Stock → navega a `/recepciones` (módulo futuro).

### v0.81.0 ✅ PROD

#### VentasPage — fixes y cantidades decimales

- **Fix carrito draft (localStorage)**: bug de orden de efectos — el save effect borraba el draft antes de que el restore lo leyera. Fix: restore declarado antes que save en el código; `cartDraftKey` omitido de las deps del save effect (evita que se dispare cuando carga el tenant).
- **Fix scanner cola secuencial**: `pendingAddRef` no funcionaba cuando el segundo scan llegaba antes de que el primero terminara su fetch de líneas (findIndex devolvía -1 y el incremento era no-op). Reemplazado por `scanQueueRef` + `scanProcessingRef`: los scans se encolan y `processNext()` los procesa de a uno, garantizando que el segundo scan ve el carrito ya actualizado por el primero.
- **Cantidades decimales en carrito**: `UNIDADES_DECIMALES` (kg, g, gr, mg, l, lt, ml, m, m2, m3, cm, mm, km — case-insensitive). `CartItem` agrega `unidad_medida`. Helpers `esDecimal()`, `stepCantidad()`, `parseCantidad()`. Input: `step` y `min` dinámicos; `parseInt` → `parseFloat`; ancho `w-16`. Botones +/− respetan el step (0.001 para decimales, 1 para enteros).

### v0.80.0 ✅ PROD

#### VentasPage — fixes UX

- **Fix scanner duplicados**: `pendingAddRef` (Set por `producto_id`) previene stale closure — scan rápido del mismo producto suma cantidad en lugar de crear línea nueva. Funciona aunque el fetch async aún no terminó.
- **Historial paginado**: query con `.limit(ventasLimit)` (empieza en 50). Botón "Cargar más ventas" al pie incrementa de 50 en 50. Se resetea al cambiar `filterEstado` o `sucursalId`. Evita traer toda la tabla en negocios con historial largo.
- **Carrito pre-guardado**: guarda draft en `localStorage` (`carrito_draft_{tenantId}`) en cada cambio de cart/cliente/checkout. Restaura al montar (toast de aviso). Clear automático al finalizar venta. No guarda `lineas_disponibles`/`series_disponibles` (datos grandes y potencialmente stale).
- **Banner caja cerrada**: aviso rojo prominente (AlertTriangle + texto + link `/caja`) en la parte superior del tab "Nueva venta" cuando no hay sesión abierta.
- **Scroll independiente carrito**: `max-h-[45vh] overflow-y-auto` en la lista de ítems — los botones de checkout siempre visibles sin scrollear la página entera.

### v0.79.0 ✅ PROD

#### ImportarProductosPage — template actualizado (22 columnas)
- **10 columnas nuevas** en plantilla Excel y lógica de importación:
  - `alicuota_iva`: 0/10.5/21/27 (default 21). Validación estricta.
  - `margen_objetivo`: porcentaje 0–100, opcional.
  - `tiene_series`, `tiene_lote`, `tiene_vencimiento`: SI/NO (helper `parseBool` acepta SI/SÍ/YES/TRUE/1).
  - `regla_inventario`: FIFO/FEFO/LEFO/LIFO/Manual; vacío = usa default del tenant.
  - `es_kit`: SI/NO.
  - `estr_unidades_por_caja`, `estr_cajas_por_pallet`, `estr_peso_unidad`: opcionales — si alguno tiene valor, crea/actualiza la estructura default del producto en `producto_estructuras` (upsert: query por `producto_id + is_default=true`, luego UPDATE o INSERT).
- **Preview table**: columna IVA% visible; `bg-blue-50 dark:bg-blue-900/20` (clase malformada corregida).
- **Hoja Referencia**: actualizada con todos los campos y valores válidos; secciones separadas para Atributos y Estructura.
- **Sin migration**: todos los campos ya existían en DB (migrations 015, 031, 040, 042, etc.).

### v0.78.0 ✅ PROD

#### InventarioPage — fixes y mejoras

- **Fix filtro "Sin X"**: los filtros de ubicación, proveedor y estado con opción `__sin__` tenían lógica invertida — excluían el producto si ALGUNA línea tenía el campo, siendo demasiado estricto. Fix: ahora excluye solo si NINGUNA línea tiene ese campo vacío (muestra el producto si tiene al menos una línea sin el campo).
- **Búsqueda por LPN**: movida de DB-level a client-side en `filteredInv`. Busca por nombre, SKU, código de barras, **ubicación** y **LPN**. La query de productos ya no filtra en DB (evita que búsquedas por LPN retornen vacío). Placeholder actualizado en ambas vistas.
- **Vista por ubicación — acciones LPN**: cada línea expandida ahora tiene botón `Settings2` que abre `LpnAccionesModal`, igual que la vista por producto. Fix: campos `l.lote`→`l.nro_lote`, `l.vencimiento`→`l.fecha_vencimiento`.
- **Ocultar scroll nativo en tabs**: `[&::-webkit-scrollbar]:hidden` + `scrollbarWidth: 'none'` en el contenedor `overflow-x-auto` de la barra de pestañas.
- **Botón Importar en tab Inventario**: header muestra botón "Importar" cuando `tab === 'inventario'` → navega a `/inventario/importar`.
- **`ImportarInventarioPage.tsx`** nueva: importación masiva de stock extraída de `ImportarProductosPage` como módulo dedicado en ruta `/inventario/importar`. Back button → `/inventario`.
- **`ImportarProductosPage`**: tab Inventario eliminada, queda solo catálogo de productos. Ruta `/productos/importar`.
- **LPN único por tenant**: validación en `ingresoMutation` y `MasivoModal` — antes de insertar, consulta `inventario_lineas WHERE lpn = X AND tenant_id = Y AND activo = true`. Error descriptivo con el producto que ya lo tiene. MasivoModal también detecta duplicados dentro del mismo lote (sin tocar DB).
- **Vista por ubicación — orden**: "Sin ubicación" primero, luego A-Z con `localeCompare('es')`.
- **Fix race condition filtros**: `isLoading: lineasLoading` en query `inventario_lineas_all`; spinner combina `invLoading || lineasLoading` — evita render con `lineasMap` vacío mientras `lineasData` carga.

### v0.77.0 ✅ PROD

#### Biblioteca de Archivos como módulo del sidebar
- **`BibliotecaPage.tsx`** nueva (~200 líneas): reutiliza tabla `archivos_biblioteca` y bucket `archivos-biblioteca` de migration 042 (sin nueva migration).
- **Filtros**: buscador por nombre/descripción + dropdown por tipo.
- **`TIPO_COLORS`**: colores distintos por tipo (yellow=AFIP, blue=contrato, green=factura_proveedor, purple=manual, gray=otro).
- **Upload**: `storage.upload(path)` → `archivos_biblioteca.insert()` con rollback si falla la inserción en DB.
- **Descarga**: `createSignedUrl(path, 300)` → `<a>` programático.
- **Sidebar**: `FolderOpen` icon `/biblioteca` (ownerOnly) posicionado junto a Proveedores.
- **ConfigPage**: tab `archivos` eliminada (funcionalidad movida al módulo dedicado).

### v0.75.0 ✅ PROD

#### InventarioPage — reestructura de tabs
- **5 tabs con estilo underline**: Inventario · Agregar stock · Quitar stock · Historial · Kits
- **`type Tab`**: `'inventario' | 'agregar' | 'quitar' | 'historial' | 'kits'`
- Tab default: `'inventario'`. Sub-tabs Ingresos/Egresos eliminados — cada uno es un tab principal.
- `filteredMov` filtra por `tab === 'agregar'` (ingresos) / `tab === 'quitar'` (egresos) / `historial` (todos).
- PlanProgressBar solo en `agregar` y `quitar`. Botones de acción en header contextuales por tab.
- Toggle vista Por producto/Por ubicación mantiene su posición derecha, visible solo en tab `inventario`.

#### VentasPage — LPN picker fix
- **Fix**: query `lineas_disponibles` usaba `.not('ubicacion_id','is',null)` → excluía líneas sin ubicación → picker invisible aunque hubiera múltiples LPNs. Removido el filtro; el filtro JS `disponible_surtido !== false` ya maneja la lógica correcta.

#### GastosPage — IVA deducible + comprobantes + gastos fijos (migration 048)
- **IVA deducible**: campo `iva_monto` en formulario (junto al monto). Columna IVA en tabla + total en footer. Card de stats "IVA deducible" del período.
- **Comprobantes**: `gastos.comprobante_url TEXT` + bucket privado `comprobantes-gastos` (10 MB, img+PDF). Upload en el formulario; ícono 📎 en lista abre URL firmada (300s). Al eliminar gasto también elimina el archivo.
- **Tab "Gastos fijos"**: tabla `gastos_fijos` (descripcion, monto, iva_monto, categoria, medio_pago, frecuencia mensual/quincenal/semanal, dia_vencimiento, activo). CRUD completo. Toggle activo/inactivo. Total mensual estimado en footer. Botón "Generar hoy" → crea gastos variables para el día de hoy desde todos los fijos activos.
- **Tabs**: underline "Gastos variables" / "Gastos fijos". Header contextual: `agregar` muestra Ingreso+Masivo; `quitar` muestra Rebaje+Masivo; fijos muestra Nuevo fijo + Generar hoy.

### v0.74.2 ✅ PROD

#### Fix — Tipografía + restricciones LPN con reservas
- **`font-mono` revertido**: eliminado de todos los valores en `VentasPage.tsx` e `InventarioPage.tsx` (LPN, SKU, N/S, tickets, totales, precios). Vuelve a la tipografía del sistema (v0.72/v0.73). Solo permanece en inputs de formularios donde el monoespaciado ayuda a la edición.
- **Inventario tab Inventario — estado read-only**: el `<select>` inline de estado reemplazado por un badge de solo lectura con el color del estado. Para cambiar estado → Acciones del LPN (engranaje).
- **Botón acciones habilitado con reservas**: antes estaba `disabled` si `cantidad_reservada > 0`. Ahora siempre está habilitado.
- **`LpnAccionesModal` con reservas**: si `linea.cantidad_reservada > 0` → tab inicial = `mover`, solo se muestra tab Mover + banner naranja explicativo. Tabs Editar, Series y Eliminar no aparecen hasta liberar reservas.

#### Fix — Cancelación de reserva con seña + ticket LPN historial
- **Cancelar reserva con monto cobrado**: confirm dialog ahora advierte "⚠ Esta venta tiene $X cobrado al cliente. Recordá devolver el importe." cuando `monto_pagado > 0`. Post-cancelación: toast rojo 8s con el monto a devolver.
- **`egreso_informativo` no-efectivo en cancelación**: al cancelar una reserva señada con tarjeta/MP, se inserta `egreso_informativo` con concepto `[Tipo] Dev. seña Venta #N` y monto = `monto_pagado - efectivo_cobrado`. Complementa el `egreso_devolucion_sena` ya existente para efectivo.
- **Ticket LPN en historial**: "Ver / Imprimir ticket" desde el historial ahora muestra el LPN primario de cada ítem no-serializado. Antes `lpn_fuentes` era `undefined` y el rendering no mostraba ningún LPN. Ahora construye `lpn_fuentes` desde `inventario_lineas.lpn`. Limitación: para ítems multi-LPN el historial solo puede mostrar el LPN principal (deuda técnica: `venta_items.linea_id` es FK simple).
- **Tests `calcularDevolucion`**: 6 casos nuevos en `cajaSeña.test.ts` — efectivo puro, tarjeta pura, mixto, MP, sin pago, monto=0. Total: **154/154** passing.

#### Monitoreo operativo — EF `monitoring-check` + GitHub Action
- **EF `monitoring-check`** (`supabase/functions/monitoring-check/index.ts`): se ejecuta sin JWT. Usa service role para consultar: reservas viejas >5d, stock crítico (stock_actual ≤ stock_minimo), cajas abiertas >16h, ventas finalizadas del día. Envía email HTML via Resend con KPIs + tablas de detalle.
- **Umbrales**: `UMBRAL_RESERVAS_DIAS = 5` · `UMBRAL_CAJA_HORAS = 16` — constantes al tope del archivo, fáciles de ajustar.
- **Email**: subject `✅ Todo en orden` si sin alertas · `⚠️ N alerta(s)` si hay. `ALERT_EMAIL = gaston.otranto@gmail.com`.
- **GitHub Action** `.github/workflows/monitoring-check.yml`: cron `0 12 * * *` (12 UTC = 9 AM Argentina). Reutiliza secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` ya configurados.
- **Deploy**: EF deployada en DEV ✅. **Pendiente PROD**: `npx supabase functions deploy monitoring-check --project-ref jjffnbrdjchquexdfgwq --no-verify-jwt` + configurar secret `RESEND_API_KEY` en PROD.
- **Snippets SQL** (guardados en Supabase PROD → SQL Editor): 2.1 caja activa · 2.2 reservas viejas · 2.3 stock crítico · 2.4 ventas diarias · 2.5 rebajes manuales · 2.6 actividad usuarios · 2.7 tenants · 2.8 consumo free plan.

### v0.73.0 ✅ PROD
- ✅ **Fix sucursal filter**: `useSucursalFilter.applyFilter` usa `.or('sucursal_id.eq.{id},sucursal_id.is.null')` — datos previos a multi-sucursal (NULL) siguen visibles con cualquier sucursal seleccionada. Afecta inventario, movimientos, ventas, gastos, clientes.
- ✅ **Post-venta → Nueva Venta**: tras finalizar/reservar, `setTab('nueva')` en lugar de `'historial'`. El cajero queda listo para seguir vendiendo.
- ✅ **Caja polling 10s**: `cajasAbiertas`, `sesionActiva`, `caja-movimientos` y el indicador del sidebar pasan de 30–15s → 10s. Movimientos de otro usuario aparecen en ~10s sin F5.
- ✅ **CAJERO puede abrir 1 caja, no más**: check por `misSesionesAbiertas` (sesiones propias abiertas) en lugar de `cajasAbiertas` (todas del tenant). `puedeAbrirCaja = puedeAdministrarCaja || misSesionesAbiertas.length === 0`. Botón deshabilitado con mensaje "Ya tenés una caja abierta. Cerrala antes de abrir otra." Check en `mutationFn` con query fresca a DB.
- ✅ **Cierre caja — labels efectivo**: modal de cierre dice "Ingresos efectivo", "Egresos efectivo", "Efectivo esperado", "Efectivo contado en caja". Nota: "Tarjeta, transferencia y MP no se cuentan aquí." Incluye `ingreso_traspaso`/`egreso_traspaso` en el cálculo de saldo.
- ✅ **Movimientos de sesión enriquecidos**: badge de tipo (Venta/Seña/Egreso/No efectivo/Traspaso), concepto limpio (sin prefijo `[Tipo]`), hora HH:MM:SS, badge de medio de pago, badge `#N` de número de ticket. Al pie del card: "Totales por método" (Efectivo neto, Tarjeta, MP, etc.).
  - Helpers: `TIPO_LABEL`, `extraerNumeroVenta(concepto)`, `extraerMedioPago(tipo, concepto)` — module-level, sin migration.
  - `totalesMedios` = IIFE que agrupa por medio con signo (+/-) y excluye `ingreso_apertura` del total por método.

### Restricciones de rutas por rol (AppLayout)
- **RRHH**: solo `/rrhh` + `/mi-cuenta`. Cualquier otra ruta → redirect `/rrhh`.
- **CAJERO**: `CAJERO_ALLOWED = ['/ventas', '/caja', '/clientes', '/mi-cuenta']`. Otra ruta → redirect `/ventas`.
- **SUPERVISOR**: `SUPERVISOR_FORBIDDEN = ['/configuracion', '/usuarios', '/sucursales', '/rrhh']`. Intento de acceso → redirect `/dashboard`.
- **CONTADOR**: `CONTADOR_ALLOWED = ['/dashboard', '/gastos', '/reportes', '/historial', '/metricas', '/mi-cuenta', '/suscripcion']`. Otra ruta → redirect `/dashboard`.
- **DEPOSITO**: `DEPOSITO_ALLOWED = ['/inventario', '/productos', '/alertas', '/mi-cuenta']`. Otra ruta → redirect `/inventario`.
- **permisos_custom**: mayor prioridad que el rol estándar. Si `permisos_custom[modulo] === 'no_ver'` → redirect al primer módulo permitido.

### Ideas futuras
Cupones, WhatsApp diario, IA chat, benchmark por rubro, tema oscuro, multilengua.
 
 # CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" ? "Write tests for invalid inputs, then make them pass"
- "Fix the bug" ? "Write a test that reproduces it, then make it pass"
- "Refactor X" ? "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] ? verify: [check]
2. [Step] ? verify: [check]
3. [Step] ? verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

