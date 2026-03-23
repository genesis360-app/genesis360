# Stokio — Contexto para Claude Code

## Producto
"El cerebro del negocio físico" — no muestra datos, dice qué hacer.

## Stack
- Frontend: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- Backend: Supabase (PostgreSQL + Auth + RLS + Edge Functions + Storage)
- Deploy: Vercel (frontend) + Supabase (backend) · Pagos: Mercado Pago
- Librerías: recharts, jspdf, jspdf-autotable, xlsx, @zxing/library

## Git / Deploy
- `main` = producción. Claude Code **NUNCA** hace push a `main`.
- Todo en `dev` → PR → merge a `main`. Ver `WORKFLOW.md`.
- GH_TOKEN en Windows Credential Manager (git credential fill). No está en `.env.local`.
- Co-Authored-By: siempre `GNO <gaston.otranto@gmail.com>` en todos los commits.

## Supabase
- **PROD**: `jjffnbrdjchquexdfgwq` — NO tocar directamente
- **DEV**: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`
- Migrations: crear `supabase/migrations/NNN_*.sql` → aplicar en DEV → actualizar `schema_full.sql` → commit → aplicar en PROD solo al deployar

## Arquitectura multi-tenant
- Todas las tablas tienen `tenant_id` con RLS habilitado
- Patrón RLS: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- `is_admin()` con SECURITY DEFINER para rol ADMIN global
- Roles: OWNER, SUPERVISOR, CAJERO, ADMIN

## Estructura del proyecto
```
src/
├── config/
│   ├── brand.ts          # FUENTE ÚNICA de nombre/marca/colores
│   └── tiposComercio.ts  # Lista compartida tipos de comercio (Onboarding + Config)
├── lib/
│   ├── supabase.ts       # Cliente + interfaces TypeScript
│   ├── actividadLog.ts   # logActividad() fire-and-forget
│   └── rebajeSort.ts     # getRebajeSort() — lógica FIFO/FEFO/LEFO/LIFO/Manual
├── store/authStore.ts    # Zustand: user, tenant, loadUserData
├── hooks/
│   ├── useAlertas.ts
│   ├── useGruposEstados.ts
│   ├── usePlanLimits.ts
│   ├── useCotizacion.ts  # hook global — no estado local por página
│   └── useModalKeyboard.ts  # ESC=cerrar / Enter=confirmar en modales
├── components/
│   ├── AuthGuard.tsx     # AuthGuard + SubscriptionGuard (mismo archivo, nunca separar)
│   ├── LpnAccionesModal.tsx
│   ├── Walkthrough.tsx   # Tour 11 slides, auto-launch 1ra vez, re-triggerable
│   └── layout/AppLayout.tsx
└── pages/
    ├── LandingPage.tsx / LoginPage.tsx / OnboardingPage.tsx
    ├── DashboardPage.tsx        # Tabs: General / Métricas
    ├── InventarioPage.tsx       # LpnAccionesModal integrado; badge P{N} = prioridad ubicación
    ├── MovimientosPage.tsx      # Ingreso/rebaje; banner amarillo si cambia ubicación
    ├── VentasPage.tsx           # Carrito + checkout; precio tachado + badge doble descuento
    ├── AlertasPage.tsx / MetricasPage.tsx / ReportesPage.tsx
    ├── CajaPage.tsx             # Shortcuts: Shift+I ingreso / Shift+O egreso
    ├── UsuariosPage.tsx / AdminPage.tsx / HistorialPage.tsx
    ├── ConfigPage.tsx           # Tabs: negocio, categorías, proveedores, ubicaciones,
    │                            #   estados, motivos, combos, grupos (grupos movido acá)
    ├── ProductoFormPage.tsx     # Incluye campo regla_inventario override por SKU
    ├── ImportarProductosPage.tsx / SuscripcionPage.tsx
    └── GruposEstadosPage.tsx    # → redirige a /configuracion (tab integrada)
```

## Convenciones
- Nombre app: siempre `BRAND.name` de `src/config/brand.ts`, nunca hardcodeado
- `logActividad()`: sin await (fire-and-forget). Nunca lanzar errores. En `src/lib/actividadLog.ts`
- `SubscriptionGuard`: siempre en `AuthGuard.tsx`, nunca en archivo separado
- `medio_pago` en `ventas`: JSON string `[{"tipo":"Efectivo","monto":1500}]`. Mostrar con `formatMedioPago()`. Parsear con `JSON.parse()` para métricas
- Triggers recalculan `stock_actual` automáticamente — nunca actualizar manualmente
- `ownerOnly: true` → OWNER+ADMIN; `supervisorOnly: true` → OWNER+SUPERVISOR+ADMIN
- Walkthrough flag en localStorage: `${BRAND.name.toLowerCase()}_walkthrough_v1`
- Rutas: verificar que existen en `App.tsx` antes de `navigate()`

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
- SW pantalla blanca: `navigator.serviceWorker.getRegistrations().then(r=>r.forEach(sw=>sw.unregister())).then(()=>location.reload())`
- Preview `dev`: desactivar Vercel Authentication en Settings → Deployment Protection

## Decisiones de arquitectura

### Auth / Onboarding
- **Google OAuth**: `loadUserData` no encuentra `users` → `needsOnboarding:true` → `AuthGuard` redirige a `/onboarding` (no a `/login`). `OnboardingPage` detecta sesión existente → salta paso de cuenta. Al guardar, NO llama `signUp()`. Llamar `await loadUserData(userId)` ANTES de `navigate('/dashboard')`.
- **RLS SELECT-after-INSERT**: generar UUID en cliente con `crypto.randomUUID()` y nunca hacer SELECT del tenant recién insertado (406 si el user no está en `users` aún).

### RLS / Supabase
- Políticas: siempre subquery, nunca funciones dentro de políticas que participan en la query.
- Orden del schema: tablas helper → `planes` → `tenants` → `users` → funciones → resto → triggers → RLS.

### Mercado Pago
- Modelo preapproval. `external_reference=tenant_id` para identificar en webhook.
- Webhook `mp-webhook`: mapea `preapproval_plan_id` → límites vía `MP_PLAN_LIMITS`.
- Planes: Básico `f57914521a98415290aedf3fafa4bf98`, Pro `fe790716c9294035b6ee8fe50375fc63`
- `init_point` construido en frontend (SuscripcionPage) sin llamar al backend.
- **⚠ Pendiente manual**: configurar webhook en MP apuntando a `https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-webhook`

### IA — scan-product
- Edge Function `scan-product`: imagen base64 → Claude Haiku → si hay barcode → Open Food Facts
- Modelo: `claude-haiku-4-5-20251001` (~$0.0003/imagen). **Requiere créditos en console.anthropic.com**
- Open Food Facts: `https://world.openfoodfacts.org/api/v0/product/{barcode}.json`

### Emails transaccionales (Resend)
- Edge Function `send-email`: 3 tipos: `welcome`, `venta_confirmada`, `alerta_stock`. Fire-and-forget.
- FROM temporal: `onboarding@resend.dev`. **Cambiar a `noreply@stokio.com`** cuando se compre el dominio.

### Movimientos de stock
- `linea_id` en `movimientos_stock`: FK a `inventario_lineas`. Siempre guardar al insertar ingresos/rebajes.

### Reserva de inventario
- `cantidad_reservada` en `inventario_lineas`: unidades comprometidas para ventas pendientes.
- `reservado` (boolean) en `inventario_series`: serie comprometida.
- Stock físico solo disminuye al pasar venta a `estado='despachada'`.
- `linea_id` en `venta_items`: existe en schema pero **nunca se escribe** (deuda técnica — trazabilidad LPN→venta pendiente).
- Toda la lógica de stock es manual en el frontend (no hay triggers en `venta_items`).

### Reglas de selección de inventario (migración 011)
- `tenants.regla_inventario` (default `FIFO`) + `productos.regla_inventario` nullable (override por SKU).
- Jerarquía: **SKU > negocio > FIFO** (hardcoded fallback).
- Helper: `src/lib/rebajeSort.ts` → `getRebajeSort(reglaProducto, reglaTenant, tieneVencimiento)`
- Reglas: `FIFO` (created_at ASC) · `LIFO` (created_at DESC) · `FEFO` (fecha_vencimiento ASC) · `LEFO` (fecha_vencimiento DESC) · `Manual` (ubicaciones.prioridad ASC)
- FEFO/LEFO ignoran prioridad de ubicación. Si el SKU no tiene `tiene_vencimiento=true` → fallback a FIFO.
- FIFO/LIFO/Manual: sort primario = `ubicaciones.prioridad ASC` (menor = primero; sin ubicación = 999).
- Config UI: ConfigPage → Mi negocio (regla del negocio). ProductoFormPage → Tracking (override por SKU).

### Prioridad de posiciones (migración 010)
- `prioridad INT DEFAULT 0` en `ubicaciones` (NO en `inventario_lineas`).
- Todos los LPNs de una ubicación heredan su prioridad automáticamente.
- Config UI: ConfigPage → Ubicaciones.
- Sort client-side en VentasPage y MovimientosPage vía `getRebajeSort()`.

### Ventas
- `numero` en `ventas`: generado por trigger `set_venta_numero` (BEFORE INSERT, MAX+1 por tenant). **Nunca** enviar `numero` en INSERT.
- Combos: tabla `combos` (producto_id, cantidad, descuento_pct). Detección en carrito, split de filas. No afectan stock.
- Indicador live caja: `useQuery` en AppLayout con refetch 60s → punto verde/rojo en nav.

### Hooks / Compactación
- PostCompact hook en `.claude/settings.local.json`: inyecta contexto post-compactación.
- Compactar manualmente con `/compact` cuando el contexto esté pesado.

## Backlog pendiente

### Bug
- [ ] Dashboard: "stock crítico" lleva a `/alertas`, debería ir a `/movimientos`

### Dashboard
- [ ] Productos sin movimiento → lista desplegable (nombre + días sin movimiento)
- [ ] Sugerencia de pedido: días de stock restante + cantidad sugerida para el mes

### Inventario
- [ ] Proyección de inventario: días de cobertura por producto
- [ ] Regla FEFO como override automático cuando `tiene_vencimiento=true` (ignora regla configurada)
- [ ] Guardar `linea_id` en `venta_items` (trazabilidad LPN→venta)
- [ ] Mostrar LPN origen al registrar venta

### Métricas
- [ ] Rango de fechas personalizado (desde/hasta)
- [ ] Ganancia neta = ventas − (costo + gastos) como KPI principal
- [ ] Ticket promedio por orden
- [ ] Filtro por producto(s) / categoría
- [ ] Margen de ganancia con filtros
- [ ] Campo "margen objetivo" configurable
- [ ] Métricas de inventario: órdenes, motivos, ubicaciones

### Ventas
- [ ] Vista productos tipo galería (imagen + título + precio)
- [ ] Proyección de ventas

### Caja — integración
- [ ] Ventas auto-generan movimiento de caja
- [ ] Bloquear ventas con caja cerrada
- [ ] Motivos predefinidos para ingreso/egreso de caja (en ConfigPage)
- [ ] Gastos: al pagar en efectivo elegir de qué caja sale

### UX / Config
- [ ] `useModalKeyboard` wiring pendiente en: MovimientosPage, VentasPage, GastosPage, UsuariosPage
- [ ] Combos: descuento en % o monto fijo $ o USD
- [ ] Motivos de caja: sección separada en ConfigPage
- [ ] Sidebar colapsable en desktop
- [ ] Invitación por email real (link auto-registro)
- [ ] Carga masiva clientes en bulk (CSV/Excel)

### Revenue
- [ ] Límite de movimientos por plan (`max_movimientos`)
- [ ] Add-ons: comprar capacidad extra sin cambiar de plan

### Ideas futuras
Cupones, multi-sucursal, insights automáticos, motor recomendaciones, WhatsApp diario, IA chat, benchmark por rubro, gamificación, tema oscuro, multilengua.
