---
title: Convenciones de Código
category: development
tags: [convenciones, typescript, naming, patterns, reglas]
sources: [CLAUDE.md]
updated: 2026-04-30
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
- ESLint: max 0 warnings (`npm run lint`)

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
```

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
