# Genesis360 — Contexto para Claude Code

## ⚡ Wiki — Reglas de oro (OBLIGATORIO)

### Al iniciar cada sesión nueva

Leer **siempre** estos dos archivos antes de responder sobre el estado del proyecto:

1. **`G360.Wiki/sources/raw/project_pendientes.md`** — versión real en PROD/DEV, migrations, pendientes priorizados, referencias técnicas.
2. **`G360.Wiki/log.md`** — última entrada del log (estado al cierre de la sesión anterior).

Tienen prioridad sobre todo lo escrito en este CLAUDE.md.

### Al cerrar cada sesión / tras cualquier cambio relevante

Actualizar el wiki **siempre** antes de terminar:

1. **`G360.Wiki/sources/raw/project_pendientes.md`** — actualizar versión actual, migrations, estado DEV/PROD, pendientes.
2. **`G360.Wiki/log.md`** — agregar entrada `## [YYYY-MM-DD] update | título` con resumen de lo hecho.
3. **Página de feature afectada** en `G360.Wiki/wiki/features/` o `wiki/integrations/` — actualizar con los cambios.
4. **`G360.Wiki/index.md`** — actualizar descripción de la página modificada, agregar nuevas páginas, actualizar contador del pie.
5. **Documentos relacionados** — cualquier página del wiki que referencie la feature modificada debe recibir un link o nota de actualización. Nunca crear o modificar una página de wiki sin verificar si el index y los docs relacionados deben actualizarse.
6. **`G360.Wiki/wiki/business/roadmap.md`** — agregar la versión si fue un release.
7. **`G360.Wiki/wiki/database/migraciones.md`** — agregar migration si se creó una nueva.
8. **Git tag + GitHub release** — crear tag `vX.Y.Z` en el commit correspondiente y `gh release create` con notas de los cambios. Hacerlo en **cada sesión** que produzca código, no solo al deployar a PROD. Usar `--latest` solo en el release más reciente.

### Responder preguntas generales sobre el proyecto

Antes de responder cualquier pregunta sobre el proyecto (features, arquitectura, estado, decisiones, módulos, etc.):

1. **Buscar primero en el wiki** — `G360.Wiki/wiki/` y `G360.Wiki/sources/raw/`. No leer código fuente si la respuesta ya está documentada.
2. **Solo si falta detalle**: buscar en los archivos fuente relevantes al tema (página, hook, migration, etc.).
3. **No leer archivos enteros** cuando alcanza con buscar un símbolo o sección específica (usar Grep/Read con offset).

Objetivo: evitar consumo innecesario de tokens leyendo código que ya está resumido en el wiki.

### Regla de unicidad de documentación

**El wiki es el único lugar donde vive la documentación.** No crear ni mantener docs en ningún otro lado:
- No actualizar solo el CLAUDE.md con historial de versiones o features
- No crear archivos `.md` sueltos en `docs/` u otras carpetas fuera de `G360.Wiki/`
- Si hay info relevante en CLAUDE.md que no está en el wiki → moverla al wiki primero, luego borrarla de CLAUDE.md

---

## Producto
"El cerebro del negocio físico" — no muestra datos, dice qué hacer.

## Stack
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions + Storage)
- **Deploy:** Vercel (frontend) + Supabase (backend) · **Pagos:** Mercado Pago
- **Librerías:** recharts, jspdf, jspdf-autotable, xlsx, @zxing/library, @sentry/react

## Git / Deploy
- `main` = producción. Claude Code **NUNCA** hace push a `main`.
- Todo en `dev` → PR → merge a `main`. Ver `WORKFLOW.md`.
- GH_TOKEN en Windows Credential Manager (`git credential fill`). No en `.env.local`.
- Co-Authored-By: siempre `GNO <gaston.otranto@gmail.com>` en todos los commits.

### ⚠ Checklist obligatorio en cada deploy a PROD
1. Bump `APP_VERSION` en `src/config/brand.ts`
2. PR `dev → main` con título `vX.Y.Z — Descripción`
3. GitHub release sobre `main` con tag `vX.Y.Z`
4. Actualizar `G360.Wiki/sources/raw/project_pendientes.md` + `G360.Wiki/log.md` + `G360.Wiki/wiki/business/roadmap.md`

## Supabase
- **PROD**: `jjffnbrdjchquexdfgwq` — NO tocar directamente
- **DEV**: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`
- Migrations: `supabase/migrations/NNN_*.sql` → aplicar en DEV → actualizar `schema_full.sql` → commit → aplicar en PROD al deployar

## Arquitectura multi-tenant
- Todas las tablas tienen `tenant_id` con RLS habilitado
- Patrón RLS: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- Helper functions SECURITY DEFINER: `is_admin()` · `is_rrhh()`
- Roles: `OWNER` · `SUPERVISOR` · `CAJERO` · `RRHH` · `ADMIN` · `CONTADOR` · `DEPOSITO`

## Estructura del proyecto
```
src/
├── config/
│   ├── brand.ts           # FUENTE ÚNICA nombre/marca/colores/planes/APP_VERSION
│   └── tiposComercio.ts
├── lib/
│   ├── supabase.ts        # Cliente + todas las interfaces TypeScript de DB
│   ├── actividadLog.ts    # logActividad() fire-and-forget
│   ├── rebajeSort.ts      # getRebajeSort() — FIFO/FEFO/LEFO/LIFO/Manual
│   ├── ventasValidation.ts # funciones puras: validar, calcular vuelto, LPN fuentes
│   ├── skuAuto.ts         # calcularSiguienteSKU()
│   ├── whatsapp.ts        # normalización + plantillas WA
│   └── facturasPDF.ts     # PDF A4 con QR AFIP (RG 4291)
├── store/authStore.ts     # Zustand: user, tenant, sucursales, loadUserData
├── hooks/
│   ├── useAlertas.ts / useGruposEstados.ts / usePlanLimits.ts
│   ├── useCotizacion.ts   # hook global — no estado local por página
│   ├── useModalKeyboard.ts  # ESC=cerrar / Enter=confirmar en modales
│   ├── useSucursalFilter.ts # applyFilter(q) — agrega .eq('sucursal_id', id) si hay sucursal activa
│   └── useGoogleMaps.ts     # getGoogleMapsLoader() / calcularDistanciaKm() — Distance Matrix API
├── components/
│   ├── AuthGuard.tsx      # AuthGuard + SubscriptionGuard (mismo archivo, nunca separar)
│   ├── LpnAccionesModal.tsx / Walkthrough.tsx
│   ├── MasivoModal.tsx    # ingreso/rebaje masivo N productos
│   └── layout/AppLayout.tsx
└── pages/                 # ver wiki/architecture/frontend-stack.md para lista completa
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
- Early returns con `<UpgradePrompt />` SIEMPRE después de que todos los hooks estén declarados
- `staleTime: 0` global en React Query — refresh en background al navegar

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
VITE_SENTRY_DSN / VITE_TN_APP_ID / VITE_MP_CLIENT_ID
VITE_GOOGLE_MAPS_API_KEY   # Places Autocomplete + Distance Matrix (Envíos)
MP_ACCESS_TOKEN (solo Edge Functions)
```

## Deploy
- Repo: https://github.com/genesis360-app/genesis360
- `vercel.json` obligatorio para SPA routing (`rewrites` a `/index.html`)
- Preview `dev`: desactivar Vercel Authentication en Settings → Deployment Protection

## Dominios
- `www.genesis360.pro` → LandingPage (marketing)
- `app.genesis360.pro` → redirige `/` a `/login` directo
- `VITE_APP_URL` en Vercel Production: `https://app.genesis360.pro`
- Supabase PROD → Redirect URLs: `https://app.genesis360.pro/**` ✅

## Gotchas clave

- **Google OAuth → nuevo tenant**: `await loadUserData(userId)` ANTES de `navigate('/dashboard')`. Sin esto la store Zustand no tiene datos del tenant.
- **RLS SELECT-after-INSERT**: generar UUID en cliente con `crypto.randomUUID()`. Nunca hacer SELECT del tenant/user recién insertado.
- **`ventas.numero`**: lo asigna el trigger `set_venta_numero`. **Nunca** incluirlo en el INSERT.
- **`linea_id` en `venta_items`**: columna existe en schema pero nunca se escribe (deuda técnica).
- **MP suscripciones**: modelo preapproval, `init_point` construido en frontend directo. No usar `POST /preapproval` vía Edge Function.
- **Aging profiles scheduler**: pendiente configurar cron diario (pg_cron / GitHub Actions).

---

> Decisiones de arquitectura detalladas, historial de versiones y backlog completo: **`G360.Wiki/wiki/business/roadmap.md`**  
> Convenciones extendidas: **`G360.Wiki/wiki/development/convenciones-codigo.md`**  
> Features y módulos: **`G360.Wiki/wiki/`**
