---
title: Convenciones de Código
category: development
tags: [convenciones, typescript, naming, patterns, reglas]
sources: [CLAUDE.md]
updated: 2026-08-31
---

# Convenciones de Código

Reglas que aplican en todo el proyecto. Estas convenciones son el contrato entre el equipo y el agente LLM.

---

## Reglas generales

| Regla | Detalles |
|-------|---------|
| Nombre de la app | Siempre `BRAND.name` de `src/config/brand.ts` — **nunca hardcodeado** |
| `logActividad()` | Sin `await` (fire-and-forget). Nunca lanzar errores desde ella |
| `SubscriptionGuard` | Siempre en `AuthGuard.tsx`, nunca en archivo separado |
| Stock | Los triggers recalculan `stock_actual` automáticamente — **nunca actualizar manualmente** |
| Roles | `ownerOnly: true` → OWNER+ADMIN; `supervisorOnly: true` → OWNER+SUPERVISOR+ADMIN |
| Rutas | Verificar que existen en `App.tsx` antes de llamar `navigate()` |
| RLS policies | `CREATE POLICY IF NOT EXISTS` no existe en PostgreSQL |

---

## Convenio `medio_pago` en ventas

```typescript
// Siempre JSON string en DB
ventas.medio_pago = '[{"tipo":"Efectivo","monto":1500},{"tipo":"Tarjeta","monto":500}]'
```

---

## Imports

Usar el alias `@/*` en lugar de paths relativos largos:
```typescript
// ✅ Correcto
import { supabase } from '@/lib/supabase'
import { usePlanLimits } from '@/hooks/usePlanLimits'

// ❌ Evitar
import { supabase } from '../../../lib/supabase'
```

---

## TypeScript

- **Strict mode** habilitado — sin `any` implícito
- Target: ES2020
- Todas las interfaces de DB en `src/lib/supabase.ts`
- **ESLint (2026-08-31, v1.187.0): `npm run lint` es un gate REAL** —
  `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 161`. Hasta esta fecha el
  comando estaba roto en TODO el repo (no existía `.eslintrc*` ni `eslint.config.*` pese a tener las
  dependencias instaladas) y nadie lo había notado porque corridas previas quedaban filtradas con grep,
  ocultando el fallo — se llegó a reportar "lint limpio" cuando el comando nunca corrió de verdad. Se creó
  `.eslintrc.cjs` (config clásica, ESLint 8.56, `@typescript-eslint/parser` + plugins
  `@typescript-eslint`/`react-hooks`, `extends: ['eslint:recommended', 'plugin:@typescript-eslint/
  recommended']`). Al activarlo por primera vez salieron 228 problemas (67 errores, 161 warnings) — **4 de
  los errores eran bugs REALES, no solo estilo**: hooks llamados después de un early return condicional en
  `AdminPage.tsx` (viola la regla de arriba "Early returns SIEMPRE después de todos los hooks") y en
  `EnviosPage.tsx` (hook dentro de una IIFE condicional en un `.map()`), y un `switch` con fallthrough
  silencioso en `DashGastosArea.tsx`/`DashVentasArea.tsx`. `--max-warnings` quedó en **161** (baseline real
  de warnings preexistentes, no en 0) para que el gate sea funcional hoy sin exigir una limpieza masiva no
  pedida — sigue siendo deuda pendiente de limpieza gradual, no bloqueante. `@typescript-eslint/
  no-explicit-any` y `@typescript-eslint/no-unused-expressions` están `off` a propósito (el 2º porque el
  patrón "ternario como statement" se usa intencionalmente en ~7 lugares del código existente). Ver `log.md`
  (2026-08-31, tipo `lint`), `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", cont. 33, histórico).

---

## Patrones de React Query

```typescript
// queryKey siempre con tenant?.id y sucursalId si aplica
useQuery({
  queryKey: ['ventas', tenant?.id, sucursalId, filterEstado],
  queryFn: async () => { ... },
  enabled: !!tenant?.id,
})

// Lazy queries (solo cuando se necesitan)
enabled: tab === 'historial'
```

---

## Hooks — Rules of Hooks

> [!WARNING] Los early returns con `<UpgradePrompt />` o guards **SIEMPRE** van después de que todos los hooks estén declarados, nunca entre llamadas a hooks.

```typescript
// ✅ Correcto
function MiPage() {
  const { puede_rrhh } = usePlanLimits()  // hook primero
  const data = useQuery(...)              // hook primero

  if (!puede_rrhh) return <UpgradePrompt />  // early return AL FINAL
  
  return <div>...</div>
}
```

---

## Scroll en inputs numéricos

Todos los `<input type="number">` deben tener:
```typescript
onWheel={(e) => e.currentTarget.blur()}
```
Evita cambios accidentales al hacer scroll.

---

## Tooltips en botones icon-only

```tsx
<button title="Descripción de la acción">
  <Icon />
</button>
```

---

## Confirmaciones y prompts — NUNCA `window.confirm`/`alert`/`prompt` (v1.152.0)

GO, 2026-07-29: *"no quiero ningún popup o cartel que sea del sistema, deben ser diseños de la
app"*. Los diálogos nativos del navegador (`window.confirm`/`alert`/`prompt`) no se pueden
estilizar — muestran el título fijo del navegador ("localhost:5173 dice") y rompen el look de la
app. Barridos y reemplazados los 86 que había en el repo (25 archivos) por un componente propio.

```tsx
import { useConfirm, usePrompt } from '@/hooks/useConfirm'

const confirmar = useConfirm()   // dentro del componente
const preguntar = usePrompt()

// Antes: if (!confirm('¿Eliminar?')) return
if (!(await confirmar('¿Eliminar?', { danger: true }))) return   // danger = rojo, para eliminar

// Antes: const nombre = prompt('Nombre:')
const nombre = await preguntar('Nombre:', { placeholder: 'ej: Monotributo' })
```

- **Misma semántica que las funciones nativas** (`Promise<boolean>` / `Promise<string | null>`) a
  propósito: la migración de un call site existente es mecánica — agregar `await` y `async` en la
  función contenedora, sin reestructurar lógica.
- `ConfirmProvider` está montado UNA VEZ en `App.tsx` (junto al `<Toaster>`), no por página.
- Mensajes multilínea con `\n`/`\n\n` se renderizan bien (`whitespace-pre-line`).
- Un `confirmar()`/`preguntar()` nuevo mientras el anterior seguía sin resolver **resuelve el
  anterior en `false`/`null`** — nunca queda una Promise colgada para siempre.
- Para un `alert()` de error simple, usar `toast.error(...)` (ya es el patrón del resto de la app),
  no un modal nuevo.
- Tests: `tests/unit/useConfirm.test.tsx` — primer test de INTEGRACIÓN de componente del repo
  (render real + click de usuario + verificación de que la Promise resuelve), no solo
  `renderHook`. Requirió sumar `tests/unit/**/*.test.tsx` al `include` de `vitest.config.ts`.

---

## Commits

```
feat: descripción del cambio

Co-Authored-By: GNO <gaston.otranto@gmail.com>
```

---

## RLS — Patrón correcto

```sql
-- ✅ Siempre subquery
CREATE POLICY "policy_name" ON tabla
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ❌ Nunca función en USING (performance)
CREATE POLICY "policy_name" ON tabla
  USING (tenant_id = get_tenant_id());
```

---

## Orden del schema SQL

```
1. Tablas helper (funciones utilitarias)
2. tabla planes
3. tabla tenants
4. tabla users
5. funciones (is_admin, is_rrhh, etc.)
6. resto de tablas
7. triggers
8. políticas RLS
9. GRANTs
```

---

## GRANT obligatorio en tablas nuevas

> [!WARNING] A partir del **30 de octubre de 2026**, Supabase deja de auto-exponer tablas nuevas del schema `public` a los roles PostgREST. Sin GRANT explícito, `supabase-js` no puede consultar la tabla (la request falla silenciosamente con 0 resultados o error 403).

Toda migration que haga `CREATE TABLE` debe incluir al final:

```sql
-- Para tablas con RLS habilitado (casi todas)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nombre_tabla TO authenticated;

-- Solo si la tabla necesita acceso anon (páginas públicas sin auth)
-- GRANT SELECT ON public.nombre_tabla TO anon;
```

El GRANT habilita a PostgREST para rutear las requests. Las policies RLS siguen controlando qué datos devuelve cada query — el GRANT no bypasea RLS.

---

## Embeds de PostgREST con FK ambigua (🐛 incidente real, 2026-08-09)

> [!WARNING] Agregar una FK **nueva** de una tabla A hacia una tabla B que YA tenía otra FK hacia B rompe en **runtime** (no en el DDL) cualquier embed sin calificar de esa tabla B que ya existiera en el frontend.

**Qué pasó:** las migraciones 342 y 345 agregaron 2 columnas FK nuevas de `productos` hacia
`ubicaciones` (`rotacion_ubicacion_excepcion_id`, `ubicacion_kit_default_id`), sumadas a la ya
existente `ubicacion_id`. Con 3 relaciones posibles entre las mismas dos tablas, PostgREST ya no
puede adivinar cuál usar en un embed sin calificar — `.select('..., ubicaciones(nombre)')` empezó a
devolver `PGRST201` / HTTP 300 ("Could not embed because more than one relationship was found"). La
query **entera** falla (no solo la columna embebida), y en React Query eso se traduce en una lista
vacía silenciosa (`const { data = [] }` esconde el error). Así se manifestó: "no tengo productos" en
`ProductosPage.tsx` y en el reporte de Stock de `ReportesPage.tsx`, con los datos intactos en la DB.
Rompió en DEV **y en PROD real** (mismas migraciones, mismo bug), sin que ningún test lo detectara —
ningún e2e ejercitaba esa combinación exacta de columnas seleccionadas.

**Por qué `migration-reviewer` no lo cazó:** revisa el SQL de la migración (el DDL en sí era correcto,
sin nada "mal escrito"), no el consumo del schema cache por PostgREST desde el frontend — este tipo de
ambigüedad es un efecto de composición entre una migración vieja y otra nueva, invisible mirando cada
una por separado.

**El fix:** calificar el embed con el nombre exacto de la constraint:

```ts
// ❌ Ambiguo apenas hay 2+ FK entre las mismas tablas
.select('*, ubicaciones(nombre)')

// ✅ Le dice a PostgREST exactamente qué relación usar
.select('*, ubicaciones!productos_ubicacion_id_fkey(nombre)')
```

La clave del objeto devuelto sigue siendo `ubicaciones` (el hint `!fkey` no cambia el nombre en el
JSON, solo desambigua la relación) — no hace falta tocar el código que lee `producto.ubicaciones?.nombre`.

**Cómo aplicar hacia adelante:** antes de dar por inofensiva una migración que agrega una FK nueva
hacia una tabla muy referenciada (`ubicaciones`, `users`, `productos`, `sucursales`...), grepear el
frontend por embeds sin calificar de esa tabla destino (`grep "tabla_destino(" src -r` sobre queries
`.from('tabla_origen')`) y, si ya hay 1+ FK previa entre esas dos tablas, calificar el embed
existente ANTES de aplicar la migración — o inmediatamente después, verificando con `curl` directo al
endpoint REST real (no solo `execute_sql`, que no pasa por el schema cache de PostgREST).

### 🐛 2ª instancia real (2026-08-11) — `pedidos`↔`ventas`, variante de sintaxis: alias por columna

No hizo falta una migración nueva para reproducir el mismo bug: `pedidos` y `ventas` ya tenían **2 FK
cruzadas** entre sí (`pedidos.venta_origen_id` y `ventas.pedido_id`), documentado desde antes como
motivo para resolver el link Pedido↔Venta de `/picking` con una query aparte (ver
[[wiki/features/pedidos]]). Al agregar un embed nuevo `ventas(estado)` sobre `pedidos` (para el guard
de "Lanzar" de la mig 350) volvió a salir `PGRST201`/HTTP 300. Esta vez se resolvió embebiendo
directo, con la **otra** sintaxis de desambiguación que soporta PostgREST — alias por **nombre de
columna FK** en vez de por nombre de constraint:

```ts
// ❌ Ambiguo: pedidos.venta_origen_id Y ventas.pedido_id apuntan a la otra tabla
.select('*, ventas(estado)')

// ✅ alias:columna_fk(...) — le dice a PostgREST qué relación seguir sin necesitar el nombre exacto
// de la constraint (`!pedidos_venta_origen_id_fkey` funcionaría también, más verboso)
.select('*, ventas:venta_origen_id(estado)')
```

La clave del objeto devuelto pasa a ser el alias (`ventas`, no `venta_origen_id`) — mismo resultado
que con `!fkey`, sintaxis más corta cuando ya se conoce el nombre de la columna. De paso se encontró
que esa misma query silenciaba cualquier error de Supabase (`const { data } = await q` sin chequear
`error`) — un patrón a evitar en cualquier query que dependa de un embed que puede romperse en runtime
por este motivo exacto.

---

## Funciones puras → extraer a lib/

Las funciones de lógica de negocio sin side effects van en `src/lib/`:
- `src/lib/ventasValidation.ts` — validaciones y cálculos de ventas
- `src/lib/rebajeSort.ts` — `getRebajeSort(reglaProducto, reglaTenant, tieneVencimiento)`
- `src/lib/skuAuto.ts` — `calcularSiguienteSKU(skus: string[]): string`
- `src/lib/whatsapp.ts` — normalización y plantillas WA

Estas funciones son testeables con Vitest sin Supabase.

---

## Versioning

- Bump `APP_VERSION` en `src/config/brand.ts` **antes** de cada deploy a PROD
- Tag format: `vX.Y.Z` (semver)
- Versión visible en el sidebar de la app

---

## Links relacionados

- [[wiki/development/workflow-git]]
- [[wiki/development/testing]]
- [[wiki/architecture/frontend-stack]]
