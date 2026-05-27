# Cierre Contable Mensual — Genesis360

Estado: ✅ Implementado completo en DEV (v1.9.0 + UX v1.10.1 / migration 135) · ✅ Triggers en PROD (135) · ⏳ Mejoras UX v1.10.1 pendientes deploy PROD

## Mejoras UX v1.10.1 (2026-05-27)
- **Candado 🔒 por fila** en VentasPage y CajaPage: badge ámbar "Cerrado" en cada fila/sesión cuya fecha cae en periodo cerrado, usando el hook `useCierreContable.isPeriodoCerrado(fecha)`. Evita el rebote del toast del trigger DB al intentar editar.
- **PDF descargable del cierre** desde `CierresContablesPanel`: botón "Descargar PDF" en el bloque expandido. A4 con header BRAND + datos fiscales + periodo + observaciones + tabla snapshot (Ventas/Gastos/Sueldos/OC con counts) + bloque resumen (Egresos totales + Resultado neto). Lee de `cierres_contables.totales JSONB` (no recalcula al momento de descargar).

## Concepto

El **cierre contable mensual** congela los movimientos del negocio una vez al mes para garantizar la inmutabilidad de los registros y permitir reportes confiables sobre ejercicios cerrados. Cuando un dueño/contador/supervisor cierra un período (mes), todos los registros con fecha dentro o anterior al último día del mes cerrado quedan bloqueados contra UPDATE o DELETE.

Las correcciones posteriores se hacen como **notas de corrección**: nuevos gastos con `es_correccion = TRUE` y `gasto_padre_id` apuntando al original (que queda intacto).

## Migration 135

`supabase/migrations/135_cierre_contable.sql`

### Tabla `cierres_contables`
- `tenant_id` UUID
- `periodo` DATE (siempre YYYY-MM-01 — restringido por CHECK)
- `fecha_cierre` TIMESTAMPTZ
- `cerrado_por` UUID + `cerrado_por_rol` TEXT (snapshot)
- `observaciones` TEXT
- `totales` JSONB — snapshot al momento del cierre (gastos, ventas, sueldos, OC, correcciones)
- UNIQUE(tenant_id, periodo)
- RLS por tenant

### Notas de corrección en `gastos`
- `gasto_padre_id` UUID (FK gastos.id, ON DELETE SET NULL)
- `es_correccion` BOOLEAN DEFAULT FALSE
- Índice parcial `idx_gastos_padre` para los gastos correctivos

### Funciones helper
- `ultimo_cierre_hasta(tenant_id)` → DATE — último día del periodo más reciente cerrado
- `periodo_cerrado(tenant_id, fecha)` → BOOLEAN — TRUE si la fecha cae dentro de un periodo cerrado

### Triggers BEFORE UPDATE/DELETE (rechazan con `RAISE EXCEPTION` SQLSTATE P0001)
| Tabla | Función | Columna usada |
|-------|---------|---------------|
| `gastos` | `trg_gastos_periodo_cerrado` | `fecha` (DATE) + también valida `NEW.fecha` en UPDATE para no permitir mover gasto hacia un periodo cerrado |
| `ventas` | `trg_ventas_periodo_cerrado` | `created_at::date` |
| `caja_movimientos` | `trg_caja_mov_periodo_cerrado` | `created_at::date` |
| `caja_sesiones` | `trg_caja_ses_periodo_cerrado` | `abierta_at::date` |
| `ordenes_compra` | `trg_oc_periodo_cerrado` | `created_at::date` |

Los INSERT no se bloquean: una nota de corrección con `es_correccion=TRUE` puede insertarse aunque referencie un gasto cerrado.

### RPC `cerrar_periodo(p_periodo DATE, p_observaciones TEXT) RETURNS JSON`
- SECURITY DEFINER, GRANT a `authenticated`
- Lee `auth.uid()` → resuelve tenant + rol
- Solo permite roles `DUEÑO`, `SUPERVISOR`, `CONTADOR`, `SUPER_USUARIO`, `ADMIN`
- Valida que el periodo sea estrictamente posterior al último cierre y que NO sea el mes en curso ni futuro
- Calcula snapshot de totales (gastos, ventas despachadas/facturadas, sueldos pagados, OC) y guarda en columna `totales JSONB`
- Devuelve la fila del cierre creado como JSON

### RPC `reabrir_periodo(p_cierre_id UUID) RETURNS BOOLEAN`
- Solo `DUEÑO`, `SUPER_USUARIO`, `ADMIN`
- Solo permite reabrir el **último** cierre (no permite reabrir cierres intermedios)
- DELETE de la fila → triggers vuelven a permitir edición

## Frontend

### Hook `useCierreContable()` (`src/hooks/useCierreContable.ts`)
```ts
const { ultimoCierre, isPeriodoCerrado, isLoading } = useCierreContable()
// ultimoCierre: string | null  (YYYY-MM-DD del último día cerrado)
// isPeriodoCerrado(fecha): boolean
```
- Cachea por 60s en React Query (`['cierre-ultimo', tenant.id]`).
- Helper auxiliar `manejarErrorPeriodoCerrado(error, toastFn)` para interceptar mensajes del trigger.

### Componente `CierresContablesPanel` (`src/components/CierresContablesPanel.tsx`)
- Selector de periodo a cerrar (sugerencias automáticas desde el siguiente mes después del último cierre, sin incluir el mes actual)
- Preview en vivo de gastos / ventas / sueldos del periodo a cerrar
- Botón "Cerrar periodo" con confirmación modal
- Listado histórico expandible con totales snapshot por cierre
- Botón "Reabrir" solo en el último cierre y solo visible a DUEÑO/ADMIN/SUPER_USUARIO

Se renderiza dentro de `GastosPage` como nuevo tab `cierres` (visible a DUEÑO/SUPERVISOR/CONTADOR/SUPER_USUARIO/ADMIN).

### Notas de corrección — flujo en GastosPage
1. La lista de gastos detecta `isPeriodoCerrado(g.fecha)` por fila.
2. En lugar de los botones Editar/Eliminar muestra **🔒 Corregir** (o "Nota de corrección").
3. Al hacer click se abre el modal "Nuevo gasto" en modo corrección:
   - Banner amarillo arriba indicando "Corrige el gasto del X (monto) — el original queda intacto"
   - Pre-rellena descripción (`Corrección de: ...`), categoría, recurso, IVA, etc.
   - Fecha = hoy
   - Acepta monto negativo (para anular total o parcial) — solo en modo corrección
4. Al guardar, el insert incluye `gasto_padre_id` y `es_correccion = TRUE`.

### Bloqueos en Ventas / Caja / OC
- La DB rechaza la mutación con `Periodo contable cerrado hasta YYYY-MM-DD ...` (SQLSTATE P0001).
- Las páginas correspondientes propagan el mensaje del trigger via `toast.error`.
- Para mejorar UX progresivamente: cada página puede leer `useCierreContable()` y mostrar un candado/badge en filas cerradas. Pendiente para iteraciones siguientes.

## Permisos

| Acción | Roles permitidos |
|--------|------------------|
| Cerrar periodo | DUEÑO, ADMIN, SUPERVISOR, CONTADOR, SUPER_USUARIO |
| Reabrir periodo (solo el último) | DUEÑO, ADMIN, SUPER_USUARIO |
| Crear nota de corrección | Cualquiera que pueda crear gastos (respeta umbrales por rol/sucursal) |
| Editar/Eliminar registros en periodo cerrado | **NADIE** — la DB bloquea con trigger |

## Casos de uso

1. **Cierre de mes habitual**: el contador entra a Gastos → Cierres contables, elige el mes anterior, revisa el preview, agrega observación ("conciliado con extracto BBVA") y confirma. Listo.
2. **Corrección de gasto cerrado**: el dueño detecta un gasto duplicado en febrero. Como febrero está cerrado, abre el gasto en la tabla, ve el candado, hace click en "Corregir", carga un monto negativo igual al original y deja observación. La nota queda con fecha de hoy.
3. **Error en el cierre**: el contador cerró marzo por error con datos incompletos. El dueño (único con permiso de reabrir) va a Cierres, ve el último cierre, hace click en "Reabrir", confirma. El trigger vuelve a permitir edición; el cierre desaparece del listado.

## Pendientes opcionales (no bloqueantes)
- UI de candado por fila en `VentasPage`, `CajaPage`, `RecepcionesPage` (hoy solo viene el toast del trigger).
- Reporte "Con/Sin correcciones" en RentabilidadPage (filtrar `es_correccion`).
- Notificación al cerrar/reabrir un periodo (a través del módulo de notificaciones).
- Exportar PDF del cierre con snapshot de totales (ya están en `totales JSONB`, solo falta render).
