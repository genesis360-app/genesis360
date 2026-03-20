# Stokio — Contexto para Claude Code

## Visión del producto
Stokio no es un "sistema de gestión". Es **el cerebro del negocio físico**.
No muestra datos → **dice qué hacer**.
Posicionamiento: "La herramienta que te dice cómo ganar más plata con tu negocio"

## Stack técnico
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (PostgreSQL + Auth + RLS + Edge Functions + Storage)
- **Deploy**: Vercel (frontend) + Supabase (backend)
- **Pagos**: Mercado Pago (suscripciones)
- **Librerías clave**: recharts, jspdf, jspdf-autotable, xlsx, @zxing/library

## Git / Deploy workflow
- **`main` = producción**. Claude Code **NUNCA** hace push directo a `main`.
- Todo desarrollo va en la rama `dev`. Cuando está listo → PR hacia `main`.
- Ver `WORKFLOW.md` para el flujo completo.

## Supabase
- **PROD**: `https://jjffnbrdjchquexdfgwq.supabase.co` — NO tocar directamente
- **DEV**: `https://gcmhzdedrkmmzfzfveig.supabase.co` — para desarrollo y tests
- Tenant de desarrollo: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`
- Usuario dueño: `48a4eca2-0152-4a6c-bfae-9a1a0778d12b` (rol OWNER)

## Migraciones de schema
- **Siempre crear un archivo** en `supabase/migrations/NNN_descripcion.sql` (numeración secuencial, idempotente)
- **Aplicar en DEV primero**, verificar, luego aplicar en PROD solo al momento del deploy a `main`
- **Claude Code NO aplica en PROD** salvo que el usuario lo pida explícitamente en ese momento
- Actualizar siempre `supabase/schema_full.sql` junto con cada migration
- Ver historial y comandos en `WORKFLOW.md`

## Arquitectura multi-tenant
- Todas las tablas tienen `tenant_id` con RLS habilitado
- Patrón RLS: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- Función `is_admin()` con SECURITY DEFINER para evitar recursión infinita
- Roles: OWNER, SUPERVISOR, CAJERO, ADMIN (superadmin global)

## Estructura del proyecto
```
src/
├── config/brand.ts          # ← FUENTE ÚNICA de nombre/marca (cambiar acá si cambia "Stokio")
├── lib/supabase.ts          # Cliente Supabase + interfaces TypeScript
├── store/authStore.ts       # Zustand: user, tenant, loadUserData
├── hooks/
│   ├── useAlertas.ts
│   ├── useGruposEstados.ts
│   └── usePlanLimits.ts
├── components/
│   ├── AuthGuard.tsx        # AuthGuard + SubscriptionGuard (ambos en el mismo archivo)
│   ├── PlanLimitModal.tsx
│   ├── LpnAccionesModal.tsx # Modal de acciones sobre LPNs
│   └── layout/AppLayout.tsx
└── pages/
    ├── LandingPage.tsx      # Página pública de marketing
    ├── LoginPage.tsx
    ├── OnboardingPage.tsx   # Registro de nuevo negocio
    ├── DashboardPage.tsx
    ├── InventarioPage.tsx   # Con LpnAccionesModal integrado
    ├── MovimientosPage.tsx  # Ingreso y rebaje con motivos predefinidos
    ├── VentasPage.tsx       # Carrito + checkout + historial
    ├── AlertasPage.tsx
    ├── MetricasPage.tsx     # Métricas y rotación de stock
    ├── ReportesPage.tsx     # Exportación Excel y PDF
    ├── CajaPage.tsx         # Apertura/cierre de caja
    ├── UsuariosPage.tsx
    ├── ConfigPage.tsx       # Categorías, proveedores, ubicaciones, estados, motivos
    ├── GruposEstadosPage.tsx
    ├── ProductoFormPage.tsx
    ├── ImportarProductosPage.tsx
    ├── SuscripcionPage.tsx  # Checkout Mercado Pago
    └── AdminPage.tsx        # Panel superadmin (solo rol ADMIN)
```

## Convenciones importantes
- **Nunca** hardcodear el nombre de la app — siempre usar `BRAND.name` de `src/config/brand.ts`
- **Nunca** poner `SubscriptionGuard` en archivo separado — está en `AuthGuard.tsx`
- RLS policies: siempre usar subquery, nunca funciones que puedan causar recursión
- Triggers de Supabase recalculan `stock_actual` automáticamente — nunca actualizar manualmente
- Atributos de tracking (serie, lote, vencimiento) son obligatorios si el producto los tiene activados

## Módulos pendientes de desarrollar (roadmap)
### Grupo 2 ✅ completo
- [x] Carga masiva productos CSV/Excel
- [x] Filtros por grupo de estados
- [x] Rotación de stock y métricas
- [x] Medios de pago mixtos en ventas
- [x] Precio en USD con cotización dólar

### Grupo 3 (en progreso)
- [x] Escáner de código de barras en ventas
- [x] QR por producto
- [ ] Emails transaccionales (Resend)
- [ ] Integración completa Mercado Pago producción

### Grupo 4 — IA aplicada al negocio
- [ ] Crear producto desde foto: Claude Vision + barcode lookup (UPC/EAN)
  - Supabase Edge Function recibe imagen → llama Claude Haiku → extrae nombre/descripción/categoría/unidad
  - Si hay código de barras en la imagen → lookup en Open Food Facts primero
  - Pre-rellena el form de producto, usuario revisa y guarda

### Backlog — mejoras UX/funcionales

**Config**
- [ ] Filtro en motivos: solo rebaje / solo ingreso / ambos
- [ ] Buscador en todas las pestañas de config (categorías, proveedores, ubicaciones, estados, motivos)

**Dashboard**
- [ ] Bug: "Ingresos" muestra unidades en vez de monto en $
- [ ] Mover Métricas al Dashboard como segunda pestaña ("General" / "Métricas")

**Productos**
- [ ] Combos: crear combo de productos con descuento como producto aparte
  - Si hay combo de 3 con 10% desc y se piden 4 → 1 combo + 1 unidad
  - Detección automática del combo al agregar unidades

**Ventas**
- [ ] Permitir escribir cantidad de unidades directamente (no solo +/-)
- [ ] Cálculo de vuelto/faltante: actualizar solo al presionar Enter, no mientras se escribe
- [ ] Medir descuentos en $ por producto y verlos en el detalle
- [ ] Separar unidades para descuentos parciales (ej: 3 con 10% desc + 1 sin descuento)

**Movimientos**
- [ ] Sacar opción de cambiar precio de compra al ingresar nuevo inventario

**Caja**
- [ ] Al cierre: ingresar monto final real y registrar diferencia (sobre/faltante) con quién cerró
- [ ] Mostrar balance total (ingresos/egresos) y permitir agregar dinero extra con aclaración (ej: caja fuerte, adelanto proveedor)
- [ ] Historial de caja: abrir cada cierre y ver detalle completo de ingresos y egresos

**Métricas**
- [ ] Corregir: faltan productos en el detalle de "sin movimiento en el período"

### Ideas futuras
- Generador de cupones + aplicar cupón en ventas
- Módulo de gastos
- Ubicación del local (para expansión multi-sucursal y logística)
- Guía interactiva / walkthrough para onboarding de nuevos clientes
- Dashboard inteligente con insights automáticos ("estás perdiendo $X por stock muerto")
- Motor de recomendaciones accionables
- Clasificación automática de productos (estrella/problema/oportunidad)
- Modo "Dueño ocupado" — resumen diario por WhatsApp
- IA tipo chat para consultas de negocio
- Benchmark vs otros negocios del rubro
- Automatizaciones (reposición automática, alertas de precio)
- Módulo de clientes con historial y recurrencia
- Gamificación ("score de salud del negocio")

## UX Principles (no negociables)
1. **Cero complejidad** — lenguaje humano, no técnico
2. **Todo visual** — colores semáforo, cards grandes, gráficos simples
3. **Interactivo** — botones accionables, no solo ver datos
4. **Mobile-first** — la mayoría de los dueños de kioscos/ferreterías usan el celular

## Planes y límites
| Plan | Usuarios | Productos | Precio |
|------|----------|-----------|--------|
| Free | 1 | 50 | $0 |
| Básico | 2 | 500 | $4.900/mes |
| Pro | 10 | 5.000 | $9.900/mes |
| Enterprise | ∞ | ∞ | A consultar |

## Variables de entorno necesarias
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_MP_PUBLIC_KEY
VITE_MP_PLAN_BASICO
VITE_MP_PLAN_PRO
VITE_APP_URL
MP_ACCESS_TOKEN (solo Edge Functions)
```

## Deploy
- **Producción**: https://stokio-tau.vercel.app
- **Repo**: https://github.com/tongas86/stokio
- Push a `main` → deploy automático en Vercel

## Decisiones de arquitectura tomadas

### Auth / Onboarding
- **Google OAuth → OnboardingPage**: Cuando un usuario entra por OAuth, ya tiene sesión en Supabase Auth pero NO tiene registro en `users` ni `tenants`. El flujo correcto:
  1. `loadUserData` no encuentra registro en `users` → pone `needsOnboarding: true`
  2. `AuthGuard` detecta `needsOnboarding` → redirige a `/onboarding` (NO a `/login`)
  3. `OnboardingPage` detecta sesión existente con `supabase.auth.getSession()` → salta el paso de cuenta, va directo al paso de negocio
  4. Al guardar, NO llama `signUp()` — usa el `userId` de la sesión existente
  5. **Crítico**: llamar `await loadUserData(userId)` ANTES de `navigate('/dashboard')` para actualizar el authStore; si no, `AuthGuard` vuelve a redirigir
- **RLS SELECT-after-INSERT bug**: Después de hacer INSERT en `tenants`, un SELECT inmediato falla con 406 porque RLS requiere que el usuario ya esté en la tabla `users`. Solución: generar el UUID en el cliente con `crypto.randomUUID()` y nunca hacer SELECT del tenant recién insertado.

### RLS / Supabase
- **Patrón de políticas**: siempre subquery `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`, nunca llamar funciones dentro de políticas de tablas que ya participan en la query (causa recursión infinita).
- **`is_admin()`**: función con `SECURITY DEFINER` para el rol ADMIN (superadmin global). Única excepción al patrón anterior.
- **Triggers de stock**: `stock_actual` en productos se recalcula automáticamente vía triggers en cada movimiento. **Nunca** actualizar `stock_actual` manualmente desde el frontend.
- **Orden del schema**: al aplicar `schema_full.sql` en un proyecto nuevo, el orden importa: tablas helper → `planes` → `tenants` → `users` → funciones que referencian `users` → resto de tablas → triggers → RLS policies.

### Frontend
- **Cotización USD**: hook global `useCotizacion` (en el sidebar), no estado local por página. Cualquier feature que muestre precios en USD debe importar este hook.
- **`SubscriptionGuard`**: siempre en el mismo archivo que `AuthGuard` (`src/components/AuthGuard.tsx`), nunca en archivo separado.
- **Rutas**: antes de cualquier `navigate()` a una ruta nueva, verificar que existe en `App.tsx`. Error real: `navigate('/inventario/producto/:id')` en lugar de `/inventario/:id/editar` mandaba al wildcard `*`.
- **Nombre de la app**: siempre `BRAND.name` desde `src/config/brand.ts`, nunca hardcodeado.

### Git / Deploy
- **Claude Code NUNCA hace push a `main`**. Todo va a `dev`. Para pasar a `main`: merge manual o PR.
- **GitHub Free**: branch protection no disponible para repos privados vía API. No intentar configurarlo.
- **Vercel envs**: variables de producción apuntan a Supabase PROD; variables de preview apuntan a Supabase DEV. Configurado manualmente en el dashboard de Vercel.
- **Co-Authored-By**: siempre `GNO <gaston.otranto@gmail.com>` en todos los commits.

### Migraciones
- **Flujo**: crear `supabase/migrations/NNN_*.sql` → aplicar en DEV → commit → aplicar en PROD solo al deployar a `main`.
- **Claude Code no aplica en PROD** sin pedido explícito del usuario en el momento del deploy.
- **Exception histórica**: migrations 001–004 se aplicaron en PROD directamente (antes de formalizar el flujo).

### Mercado Pago
- **Suscripciones**: modelo preapproval (no pagos únicos). `preapproval_plan_id` determina el plan.
- **Webhook**: Edge Function `mp-webhook` recibe eventos `subscription_preapproval` y `payment`. Mapea `preapproval_plan_id` → `max_users`/`max_productos` usando `MP_PLAN_LIMITS` (variables de entorno `MP_PLAN_BASICO` / `MP_PLAN_PRO`).
- **`external_reference`**: se usa para pasar el `tenant_id` a MP y recuperarlo en el webhook.
- **Edge Functions**: deploy con `npx supabase functions deploy <nombre> --project-ref <ref>`. No requiere Docker.

### Supabase DEV
- Proyecto ref: `gcmhzdedrkmmzfzfveig`
- Creado y configurado completamente vía Management API (PAT guardado en `.env.local`)
- Schema aplicado desde `supabase/schema_full.sql`
- Google OAuth habilitado y configurado (callback URL registrado en Google Cloud Console)

### Vercel / Deploy
- **`vercel.json` es obligatorio** para SPA routing. Sin él, Vercel devuelve 404 en rutas directas como `/dashboard`. Contenido mínimo: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- **Service worker (PWA)**: cuando hay un nuevo deploy, el SW puede servir el `index.html` viejo con hashes de assets que ya no existen → pantalla en blanco. Fix: en la Console del browser ejecutar `navigator.serviceWorker.getRegistrations().then(r => r.forEach(sw => sw.unregister())).then(() => location.reload())`

### Mercado Pago
- **Planes creados**: Básico `f57914521a98415290aedf3fafa4bf98` ($4.900/mes), Pro `fe790716c9294035b6ee8fe50375fc63` ($9.900/mes)
- **Webhooks MP**: modo prueba → DEV Supabase (`gcmhzdedrkmmzfzfveig`), modo productivo → PROD Supabase (`jjffnbrdjchquexdfgwq`)

### Movimientos de stock
- **`linea_id` en `movimientos_stock`**: columna FK a `inventario_lineas` agregada. Permite mostrar en el detalle del movimiento: LPN, lote, vencimiento, precio de costo, ubicación, proveedor y series. Siempre guardar `linea_id` al insertar movimientos de ingreso y rebaje.

### Hooks / Compactación
- **PostCompact hook** configurado en `.claude/settings.local.json`: inyecta contexto recordando actualizar CLAUDE.md después de cada compactación.
- **Limitación**: no existe un evento de hook para "contexto al 80%". El hook solo corre después de que la compactación ya ocurrió. La compactación debe ejecutarse manualmente con `/compact`.
