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

## Git / Deploy

- `main` = producción. Claude Code **NUNCA** hace push a `main`.
- Todo en `dev` → PR → merge a `main`.
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

---

## Convenciones y gotchas de código

### Reglas de React / frontend

- **Nombre app**: siempre `BRAND.name` de `src/config/brand.ts`, nunca hardcodeado.
- **`logActividad()`**: sin `await` (fire-and-forget). Nunca lanzar errores.
- **`SubscriptionGuard`**: siempre en `AuthGuard.tsx`, nunca en archivo separado.
- **Early returns** con `<UpgradePrompt />` SIEMPRE después de que todos los hooks estén declarados.
- **`staleTime: 0`** global en React Query — refresh en background al navegar.
- **`ownerOnly: true`** → OWNER+ADMIN; **`supervisorOnly: true`** → OWNER+SUPERVISOR+ADMIN.
- **Rutas**: verificar que existen en `App.tsx` antes de `navigate()`.

### Reglas de DB / Supabase

- **`CREATE POLICY IF NOT EXISTS`** no existe en PostgreSQL — usar bloque `DO $$ BEGIN IF NOT EXISTS ...`
- **Triggers** recalculan `stock_actual` automáticamente — nunca actualizar manualmente.
- **`medio_pago`** en `ventas`: JSON string `[{"tipo":"Efectivo","monto":1500}]`
- **Google OAuth → nuevo tenant**: `await loadUserData(userId)` ANTES de `navigate('/dashboard')`. Sin esto la store Zustand no tiene datos del tenant.
- **RLS SELECT-after-INSERT**: generar UUID en cliente con `crypto.randomUUID()`. Nunca hacer SELECT del tenant/user recién insertado.
- **Seeds en alta de tenant = `SECURITY DEFINER`**: el onboarding inserta `tenants` ANTES que `users`. Cualquier trigger `AFTER INSERT ON tenants` que seedee tablas con RLS (`categorias_gasto`, defaults, caja, etc.) corre antes de existir la fila en `users`, así que la función **debe** ser `SECURITY DEFINER` (+ `SET search_path = public`) o el `WITH CHECK` la rechaza. Bug histórico arreglado en mig 166.
- **`ventas.numero`**: lo asigna el trigger `set_venta_numero`. **Nunca** incluirlo en el INSERT.
- **`linea_id` en `venta_items`**: guarda el LPN principal del despacho (se escribe en `registrarVenta`). El desglose completo cuando un ítem sale de varios LPN vive en `venta_item_despachos` (ISS-075, mig 153).
- **MP suscripciones**: modelo preapproval, `init_point` construido en frontend directo. No usar `POST /preapproval` vía Edge Function.
