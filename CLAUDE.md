# Stokio — Contexto para Claude Code

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
- Producción: https://stokio-tau.vercel.app · Repo: https://github.com/tongas86/stokio
- `vercel.json` obligatorio para SPA routing (`rewrites` a `/index.html`)
- Preview `dev`: desactivar Vercel Authentication en Settings → Deployment Protection

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
- Planes: Básico `f57914521a98415290aedf3fafa4bf98`, Pro `fe790716c9294035b6ee8fe50375fc63`
- `init_point` construido en frontend (SuscripcionPage) sin llamar al backend.
- **⚠ Pendiente**: configurar webhook en MP → `https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-webhook`

### IA — scan-product
- Edge Function `scan-product`: imagen base64 → Claude Haiku → si hay barcode → Open Food Facts
- Modelo: `claude-haiku-4-5-20251001` (~$0.0003/imagen). **Requiere créditos en console.anthropic.com**

### Emails transaccionales (Resend)
- Edge Function `send-email`: tipos `welcome`, `venta_confirmada`, `alerta_stock`. Fire-and-forget.
- FROM temporal: `onboarding@resend.dev`. **Cambiar a `noreply@stokio.com`** cuando se compre el dominio.

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

### Hooks / Compactación
- PostCompact hook en `.claude/settings.local.json`: inyecta contexto post-compactación.
- Compactar manualmente con `/compact` cuando el contexto esté pesado.

---

## Backlog pendiente

### UX / Config

### Revenue
- [ ] Límite de movimientos por plan (`max_movimientos`)
- [ ] Add-ons: comprar capacidad extra sin cambiar de plan
- [ ] Revisar matriz de funcionalidades por plan (actualmente solo se limitan usuarios y productos)

### RRHH — Phases 2–5 (ver ROADMAP.md)
- [x] Phase 2A — Nómina: `rrhh_salarios` + `rrhh_conceptos` + `rrhh_salario_items`; pagar → egreso automático en Caja (migración 017, en dev)
- [x] Phase 2B — Vacaciones: solicitudes con aprobación; saldo anual + remanente (migración 018, en dev)
- [ ] Phase 2C — Cumpleaños automáticos: Edge Function scheduler
- [x] Phase 3A — Asistencia: `rrhh_asistencia` (entrada/salida/estado/motivo) (migración 019, en dev)
- [x] Phase 3B — Dashboard RRHH: KPIs empleados/asistencia/vacaciones/nómina + breakdown depts + exportar Excel (en dev)
- [ ] Phase 3B — Dashboard RRHH: KPIs + reportes Excel/PDF
- [ ] Phase 4A — Documentos empleado: Storage bucket `empleados`
- [ ] Phase 4B — Capacitaciones + certificados
- [ ] Phase 5 — Supervisor Self-Service: dashboard restringido + árbol jerárquico RLS

### Ideas futuras
Cupones, multi-sucursal, insights automáticos, WhatsApp diario, IA chat, benchmark por rubro, tema oscuro, multilengua.
