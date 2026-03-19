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
- **DEV**: proyecto separado (ver WORKFLOW.md para setup)
- Tenant de desarrollo: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`
- Usuario dueño: `48a4eca2-0152-4a6c-bfae-9a1a0778d12b` (rol OWNER)

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
### Grupo 2 (en progreso)
- [x] Carga masiva productos CSV/Excel
- [x] Filtros por grupo de estados
- [x] Rotación de stock y métricas
- [x] Medios de pago mixtos en ventas
- [ ] Precio en USD con cotización dólar

### Grupo 3
- [ ] Escáner de código de barras en ventas
- [ ] QR por producto
- [ ] Emails transaccionales (Resend)
- [ ] Integración completa Mercado Pago producción

### Visión futura (del documento de objetivos)
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
