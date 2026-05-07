---
title: Estado Global — Zustand + React Query
category: architecture
tags: [zustand, react-query, estado, authstore, cache]
sources: [CLAUDE.md]
updated: 2026-04-30
---

# Estado Global

Genesis360 usa dos capas de estado diferenciadas:

| Capa | Librería | Para qué |
|------|---------|---------|
| Estado de sesión | Zustand (`authStore`) | Usuario, tenant, sucursales, plan |
| Estado del servidor | TanStack React Query | Datos de la DB (productos, ventas, etc.) |

---

## authStore (Zustand)

**Archivo:** `src/store/authStore.ts`

### Qué contiene

```typescript
{
  user: User | null          // datos del usuario autenticado
  tenant: Tenant | null      // datos del negocio
  sucursales: Sucursal[]     // sucursales activas del tenant
  sucursalId: string | null  // sucursal actualmente seleccionada (localStorage)
  initialized: boolean       // si ya corrió loadUserData()
}
```

### Funciones principales

```typescript
loadUserData(userId: string)
  // Carga user, tenant, sucursales, plan desde DB
  // Valida que sucursalId en localStorage siga siendo válido
  // Llama ANTES de navigate() en onboarding

setSucursal(id: string | null)
  // Persiste en localStorage
  // Usado por SucursalSelector en el header
```

### Avatar

`loadUserData` resuelve el avatar del usuario:
- Google OAuth → `user_metadata.avatar_url`
- Email/Password → `users.avatar_url` del bucket `avatares`

---

## useSucursalFilter (hook)

**Archivo:** `src/hooks/useSucursalFilter.ts`

```typescript
applyFilter(query)
  // Si hay sucursal activa: agrega .eq('sucursal_id', sucursalId)
  // También incluye .or('sucursal_id.eq.{id},sucursal_id.is.null')
  //   para datos pre-multi-sucursal (NULL)
  // Sin sucursal: vista global (sin filtro)
```

Usado en todas las queries de: inventario, movimientos, ventas, gastos, clientes.  
`sucursalId` incluido en `queryKey` para invalidación automática al cambiar de sucursal.

---

## TanStack React Query

**Versión:** 5.17.0

### Configuración global

```typescript
// QueryClient config (v1.3.0)
staleTime: 0  // datos siempre "stale" → refetch en background al navegar
// Patrón: stale-while-revalidate → muestra datos inmediatamente, actualiza en silencio
```

### Convenciones de queryKey

```typescript
['productos', tenant?.id]
['inventario-lineas', tenant?.id, sucursalId]
['ventas', tenant?.id, sucursalId, filterEstado]
['caja-sesiones-abiertas', tenant?.id]  // refetchInterval: 60_000
```

Siempre incluir `tenant?.id` y `sucursalId` cuando aplica.

### Queries lazy (enabled)

Algunas queries solo corren bajo condición:

```typescript
enabled: tab === 'historial'   // datos de historial
enabled: showHistorialSueldos && !!historialEmpleadoId
enabled: pageTab === 'cc'      // cuenta corriente
```

---

## usePlanLimits (hook)

**Archivo:** `src/hooks/usePlanLimits.ts`

Expone:
```typescript
{
  plan_id: string
  max_productos: number     // -1 = ilimitado
  max_movimientos: number   // -1 = ilimitado
  max_usuarios: number
  movimientos_mes: number   // actual del mes en curso
  puede_crear_movimiento: boolean
  pct_movimientos: number   // 0-100
  
  // Feature flags:
  puede_reportes: boolean
  puede_historial: boolean
  puede_metricas: boolean
  puede_importar: boolean
  puede_rrhh: boolean
  puede_aging: boolean
  puede_marketplace: boolean
}
```

> [!NOTE] Si `subscription_status='trial'` con `trial_ends_at` futuro → usa `FEATURES_POR_PLAN['pro']` (acceso completo).

---

## useCotizacion (hook)

**Archivo:** `src/hooks/useCotizacion.ts`

Hook global para la cotización USD/ARS. **No usar estado local por página** — siempre este hook.  
Consulta la tabla `cotizacion` en DB. Usado en combos con `descuento_tipo = 'monto_usd'`.

---

## useModalKeyboard (hook)

**Archivo:** `src/hooks/useModalKeyboard.ts`

- `ESC` → cerrar modal
- `Enter` → confirmar acción en modal

Usado en: MovimientosPage, GastosPage, UsuariosPage, VentasPage.

> [!WARNING] Si hay modales anidados: el modal hijo debe tener su propio `useModalKeyboard`. El padre debe desactivar el suyo cuando el hijo está abierto para que ESC cierre el hijo primero.

---

## useRecomendaciones (hook)

**Archivo:** `src/hooks/useRecomendaciones.ts`

11 reglas de insights automáticos:
- Cobertura crítica (< 3 días de stock)
- Margen realizado bajo (< 15%)
- Día de semana flojo (< 50% del promedio)
- Cumpleaños del mes (empleados)
- + 7 reglas base del sistema

---

## Links relacionados

- [[wiki/architecture/frontend-stack]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/features/suscripciones-planes]]
- [[wiki/features/multi-sucursal]]
