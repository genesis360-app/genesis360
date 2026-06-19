# Genesis360 — Contexto para Claude Code

## 🛑 REGLA DE ORO #0 — Integridad FISCAL, CONTABLE y de INVENTARIO (CRÍTICO, NO NEGOCIABLE)

**Lo fiscal, lo contable y el inventario deben funcionar PERFECTO. Cero errores tolerados.** Un error acá
(una factura mal emitida, un IVA mal calculado, plata que no cuadra en caja/CC/capital, stock que queda
mal) tiene consecuencias reales para el cliente (AFIP, plata, mercadería). Esta regla está por encima de
la velocidad: ante la duda, frenar y verificar.

**Alcance:**
- **Fiscal:** AFIP/facturación, NC/ND, tipos A/B/C por condición del emisor, alícuotas de IVA, CAE,
  `CbtesAsoc`, umbrales (Factura B con identificación), percepciones, comprobantes.
- **Contable:** caja (ingresos/egresos/arqueos), cuenta corriente (clientes y proveedores), cuentas de
  origen, capital/bóveda, cheques, conciliaciones, medios de pago.
- **Inventario:** stock (`stock_actual`, disponible, reservado), `movimientos_stock`, reingresos,
  consolidación de líneas, trazabilidad, kits.

**Obligaciones (siempre):**
1. **Avisar a GO de inmediato** si detecto algo que está mal —o que *puede* romper— lo fiscal/contable/
   inventario, **aunque sea un edge case latente o no me lo hayan pedido**. No seguir como si nada.
2. **Verificar el comportamiento REAL contra la regla** (AFIP/contable) antes de tocar cualquier flujo que
   mueva plata, comprobantes fiscales o stock. No asumir; leer el código y, si hace falta, los datos.
3. **Guards server-side ADEMÁS de la UI** (la UI se cachea/bypassea): EF `emitir-factura`, triggers de DB.
4. **Todo movimiento de EFECTIVO se asienta en caja** — `await`eado + aviso si falla, nunca fire-and-forget
   ni silencioso (ver [[reference_cobranza_efectivo_exige_caja]]).
5. **El `numeric` de Postgres llega como string** (`"21.00"`) → normalizar con `parseFloat` antes de
   comparar/mapear (bug de alícuota AFIP). Un `||default` sobre `0` convierte Exento en 21% — usar `Number.isFinite`.
6. **Stock nunca negativo en silencio** (`Math.max(0,…)` + bloqueo si rebaja > disponible); queries de stock
   **mode-aware** (básico no tiene `ubicacion_id`/`estado_id`).
7. **Nunca reescribir registros fiscales/contables históricos** retroactivamente (el IVA crédito de un gasto
   se calculó con la condición del tenant *de ese momento*; re-sanearlo falsea el historial).
8. Tras tocar algo fiscal/contable/inventario: typecheck + build + tests verdes, y registrar el escenario en
   el UAT (`tests/specs/uat-modo-basico.md`).

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

### ⚠ TODO cambio de DB va por migración versionada — NUNCA SQL suelto

**Regla de oro anti-drift (aprendida con el bug de `notificaciones`, mig 219):** cualquier DDL persistente
(policies RLS, funciones, columnas, índices, grants) se aplica **exclusivamente** como archivo
`supabase/migrations/NNN_*.sql` (vía `apply_migration`), commiteado al repo, y se aplica en **DEV y PROD**.

- ❌ **PROHIBIDO**: el botón "Fix"/"quick fix" del **Security Advisor** de Supabase, el editor SQL del
  dashboard, o `execute_sql` para DDL que deba persistir. Esos cambios **no generan migración, no quedan
  en el historial y no se propagan** → producen drift DEV≠PROD silencioso (causa raíz de mig 219/220).
- ✅ Si el Advisor sugiere algo, se **traduce a una migración** versionada antes de aplicarlo.
- ✅ `execute_sql` solo para **lectura / diagnóstico** (p.ej. `pg_policies`, impersonar con `SET LOCAL ROLE`).
- 🔍 **Auditoría de drift** (correr periódicamente): comparar `md5(string_agg(...))` de `pg_policies`
  entre DEV y PROD; deben dar el **mismo hash global** (al 2026-06-17: 152 policies, sincronizadas).

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
