---
title: Triggers de Base de Datos
category: database
tags: [triggers, postgresql, stock, autonumeracion, rls]
sources: [CLAUDE.md, WORKFLOW.md]
updated: 2026-04-30
---

# Triggers de Base de Datos

Listado de triggers activos en producción.

> [!WARNING] El stock se actualiza **solo** via triggers. Nunca hacer UPDATE manual de `stock_actual`.

---

## Triggers de stock

### `lineas_recalcular_stock` (migration 082 — fix crítico)

```sql
AFTER INSERT OR UPDATE OF cantidad,activo OR DELETE ON inventario_lineas
→ recalcula productos.stock_actual
```

**Bug pre-082:** Solo disparaba en `AFTER INSERT`. Al eliminar o editar un LPN (`UPDATE activo=false, cantidad=0`), el trigger no corría y `stock_actual` quedaba con valor incorrecto.

**Fix migration 082:** Ahora dispara en `INSERT OR UPDATE OF cantidad,activo OR DELETE`.

### `series_recalcular_stock`

```sql
AFTER INSERT OR UPDATE OR DELETE ON inventario_series
→ recalcula stock para productos serializados
```

También corregido en migration 082.

---

## Triggers de numeración

### `set_venta_numero`

```sql
BEFORE INSERT ON ventas
→ MAX(numero) + 1 por tenant
```

- **Nunca** enviar `numero` en el INSERT — el trigger lo asigna.
- Garantiza secuencia correcta por tenant (multi-tenant safe).

### `trg_set_oc_numero`

```sql
BEFORE INSERT ON ordenes_compra
→ MAX(numero) + 1 por tenant, numero=0 como placeholder
```

---

## Triggers de integraciones

### `trg_tn_stock_sync` (migration 062)

```sql
AFTER INSERT/UPDATE/DELETE ON inventario_lineas
→ fn_enqueue_tn_stock_sync() SECURITY DEFINER
→ INSERT en integration_job_queue (NOT EXISTS dedup)
```

Encola un job de sync de stock hacia TiendaNube por cada cambio de línea.

### `trg_meli_stock_sync` (migration 065)

```sql
AFTER INSERT/UPDATE/DELETE ON inventario_lineas
→ fn_enqueue_meli_stock_sync() SECURITY DEFINER
→ INSERT en integration_job_queue (NOT EXISTS dedup)
```

Ídem para Mercado Libre.

---

## Trigger de stock mínimo

### `productos_stock_check`

```sql
AFTER UPDATE ON productos
→ check_stock_minimo() SECURITY DEFINER
→ INSERT en alertas si stock_actual <= stock_minimo
```

> [!NOTE] Usa SECURITY DEFINER porque `auth.uid()` no está disponible en el contexto del trigger. Sin SECURITY DEFINER, RLS bloquea el INSERT en alertas con error 400.

Complementado por `auto_resolver_alerta_stock` (migration 042).

---

## Trigger de nómina

### `fn_recalcular_salario`

```sql
AFTER INSERT/UPDATE/DELETE ON rrhh_salario_items
→ recalcula total_haberes, total_descuentos, neto en rrhh_salarios padre
```

---

## Trigger de updated_at

```sql
trg_updated_at_oc  ON ordenes_compra
-- + otros updated_at en tenant_certificates, autorizaciones_inventario, etc.
```

---

## Función `fn_tn_sync_heartbeat()`

No es exactamente un trigger, sino una función cron llamada por `pg_cron`:
- Encola proactivamente todos los productos mapeados en `inventario_tn_map`
- Asegura que el sync corre aunque no haya habido cambios recientes en las líneas

---

## Trigger de creación automática de Caja Fuerte (migration 110)

### `trg_crear_caja_fuerte`

```sql
AFTER INSERT ON tenants
→ fn_crear_caja_fuerte() SECURITY DEFINER
→ INSERT cajas (tenant_id, nombre='Caja Fuerte / Bóveda', es_caja_fuerte=true, activo=true)
```

**Por qué SECURITY DEFINER:** el trigger dispara justo después de insertar el tenant, antes de que el usuario exista en `users`. La RLS de `cajas` (`tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`) no puede resolverse porque el user aún no está en la tabla. Con SECURITY DEFINER el INSERT omite la RLS.

> [!WARNING] Sin `SECURITY DEFINER`, el registro de nuevo negocio falla silenciosamente con "Error al registrar" porque `PostgrestError` no es instancia de `Error` y el catch muestra el fallback genérico.

---

## Links relacionados

- [[wiki/database/schema-overview]]
- [[wiki/database/migraciones]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/autenticacion-onboarding]]
- [[wiki/integrations/tienda-nube]]
- [[wiki/integrations/mercado-libre]]
