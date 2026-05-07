# Checklist de Integridad Pre-Commit

Usa este checklist **antes de hacer push a cualquier rama de migración o funcionalidad** para asegurar integridad de datos entre módulos.

---

## Checklist de Diseño del Schema

### Toda Tabla Nueva
- [ ] `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- [ ] `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [ ] `created_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] `updated_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] `activo BOOLEAN DEFAULT TRUE` (para soft-delete si se requiere)
- [ ] Índice en `tenant_id`: `CREATE INDEX idx_tablename_tenant ON tablename(tenant_id)`
- [ ] Constraint único incluye `tenant_id` (ej: `UNIQUE(tenant_id, dni_rut)`)
- [ ] No valores hardcodeados en defaults (usa NULLs o trigger-computed)
- [ ] Todas las FKs tienen `ON DELETE CASCADE` o `ON DELETE RESTRICT` (nunca `SET NULL` a menos que intencional)

### Política RLS
- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` presente
- [ ] Política usa subquery: `WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- [ ] Nombre política descriptivo: `policy_name_tenant` o `policy_name_action`
- [ ] NO usar funciones dentro de cláusula WHERE de política (usar subquery)
- [ ] Las cuatro operaciones tienen políticas si se exponen a API: SELECT, INSERT, UPDATE, DELETE

### Trigger para Auditoría
- [ ] `logActividad()` llamado en INSERT/UPDATE/DELETE
- [ ] Trigger usa `SECURITY DEFINER` si llama funciones
- [ ] Trigger envuelto en `CREATE OR REPLACE FUNCTION` (idempotente)
- [ ] Nombre trigger: `tr_tablename_action` (ej: `tr_venta_dispatch`)
- [ ] Trigger tiene `AFTER` (no BEFORE) para poder auditar

---

## Checklist de Sintaxis de Migración

```sql
-- NO usar CREATE POLICY IF NOT EXISTS
-- ❌ NO SOPORTADO EN PostgreSQL

-- USAR: DO $$ BEGIN IF NOT EXISTS ...
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tablename' AND policyname='policy_name') THEN
    CREATE POLICY "policy_name" ON tablename
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Todos los comentarios deben describir lógica negocio, no solo código
-- ❌ MALO: -- this creates a table
-- ✅ BUENO: -- Audit log: registro inmutable de todos los cambios transaccionales

-- Usar IF NOT EXISTS para todos CREATE statements
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
CREATE FUNCTION IF NOT EXISTS ...
```

### Idempotencia
- [ ] Archivo es seguro ejecutarlo dos veces sin errores
- [ ] Todos `CREATE ... IF NOT EXISTS`
- [ ] Todos `DO $$ BEGIN IF NOT EXISTS ...` para políticas
- [ ] Todos `ALTER TABLE IF NOT EXISTS` para agregar columnas
- [ ] Sin DROP statements (usar soft-delete o schema backward-compatible)

---

## Checklist de Integridad Cross-Módulo

### Venta → Stock → Caja
- [ ] Enum estado venta: borrador, cotizada, confirmada, despachada, anulada
- [ ] Trigger `tr_venta_dispatch_to_stock` dispara en `estado='despachada'`
- [ ] Trigger `tr_venta_dispatch_to_caja` dispara en `estado='despachada'` con `tipo_pago='Efectivo'`
- [ ] Stock decrease usa `getRebajeSort()` (FIFO/LEFO/etc.) para seleccionar línea correcta
- [ ] `logActividad` llamado para cambio venta AND movimiento_stock AND caja_movimiento (3 entradas total)
- [ ] No puede despachar sin `caja_sesion_id` activa (si venta.tipo_pago tiene efectivo)

### Gasto → Caja
- [ ] Gasto con `medio_pago='Efectivo'` → crear caja_movimiento egreso
- [ ] Gasto `monto > saldo_actual_caja` → bloqueado en UI (validación antes POST)
- [ ] Gasto con `medio_pago != 'Efectivo'` → NO caja_movimiento
- [ ] logActividad llamado para gasto INSERT AND caja_movimiento egreso (2 entradas)
- [ ] No puede crear gasto.efectivo se no hay caja_sesion activa

### Reconciliación de Inventario
- [ ] `stock_actual` **solo** modificado por trigger en `movimientos_stock`
- [ ] No UPDATEs manuales a `inventario_lineas.stock_actual` permitidos (excepto migraciones backfill)
- [ ] `cantidad_reservada` rastrea confirmadas no-picked (validación future feature)
- [ ] `disponible_surtido=false` ubicaciones excluidas de picking en venta
- [ ] Todos movimientos inventario tienen `linea_id` FK (trazabilidad)

### Reconciliación de Caja
- [ ] `caja_sesiones.saldo_actual = saldo_inicial + SUM(caja_movimientos WHERE tipo IN ('ingreso','egreso'))`
- [ ] `tipo='ingreso_informativo'` NO contado en saldo (solo informativo)
- [ ] Solo `tipo='ingreso'` y `tipo='egreso'` afectan `saldo_actual`
- [ ] No puede cerrar caja si `saldo_actual != saldo_conteo` (diff > 0.01)
- [ ] Todos caja_movimientos tienen entradas logActividad correspondientes

### Pista de Auditoría
- [ ] `actividad_log` **nunca** INSERTs manuales (trigger-only)
- [ ] `logActividad()` llamado con params correctos: `(tabla, acción, registro_id, cambios, pk_field)`
- [ ] SELECT `actividad_log` funciona para todos roles (legible por OWNER mínimo)
- [ ] No puede deletear en actividad_log (solo set `anulado=true` en tabla original)

---

## Checklist de Testing

### Antes de Enviar PR

#### Tests Funcionales (UI + Database)
- [ ] Crear venta + despachar con efectivo → stock disminuyó + ingreso caja creado
- [ ] Crear venta + despachar con tarjeta → stock disminuyó + NO ingreso caja
- [ ] Crear gasto.efectivo → egreso caja + saldo disminuyó
- [ ] Crear gasto.no_especificado → NO movimiento caja
- [ ] Anular venta con estado={'despachada'} → stock restaurado + reversa caja
- [ ] Agregar producto desde scan → inventario_lineas creado + logActividad 2 entradas

#### Tests de Edge Cases
- [ ] Despachar venta sin caja_sesion abierta → mensaje error (no crash silencioso)
- [ ] Crear gasto.efectivo con monto > saldo_caja → bloqueado en UI (validación form)
- [ ] Despachar venta de otro tenant (X) mientras logueado como tenant Y → bloqueado por RLS
- [ ] Modificar producto.precio_costo → venta_items.costo viejo inmutable (verificar Histórico)
- [ ] Soft-delete empleado + crear nómina → usar `WHERE activo=true` (omitir borrados)

#### Tests de Auditoría
```sql
-- Después de completar una venta:
SELECT * FROM actividad_log WHERE tabla IN ('ventas','movimientos_stock','caja_movimientos')
  AND registro_id = $venta_id ORDER BY created_at;
  
-- Esperar exactamente 3 entradas: venta UPDATE, movimientos_stock INSERT, caja_movimientos INSERT
-- Si falta alguno → trigger audit log falló
```

#### Tests de RLS
- [ ] Usuario de tenant_A no ve productos/inventario de tenant_B
- [ ] CAJERO no puede crear gastos (solo ver) — verificar en UsuariosPage permisos
- [ ] RRHH no ve ventas (solo ver con rol SUPERVISOR) — verificar políticas RLS

#### Tests de Reconciliación
```sql
-- Test balance caja:
SELECT caja_sesion_id, saldo_inicial, saldo_actual,
  SUM(CASE WHEN tipo='ingreso' THEN monto ELSE -monto END) as saldo_calculado
FROM caja_movimientos 
WHERE caja_sesion_id = $1
GROUP BY caja_sesion_id;
-- saldo_actual debe igualar saldo_inicial + saldo_calculado

-- Test balance stock:
SELECT producto_id, SUM(stock_actual) as total_stock
FROM inventario_lineas
WHERE tenant_id = $1 AND producto_id = $2
GROUP BY producto_id;
-- Verificar número razonable (no negativo, no físicamente imposible)
```

---

## Checklist de Deploy (PROD)

**Antes de aplicar migración a PROD:**

1. ✅ Migración aplicada a DEV y testeada 48+ horas
2. ✅ V2.0 aplicada en este orden:
   - Crear nuevas tablas
   - Agregar columnas a tablas existentes
   - Crear funciones
   - Crear/actualizar triggers
   - Crear/actualizar índices
   - Agregar políticas RLS
3. ✅ Plan rollback documentado (SOP versión previa)
4. ✅ SYSTEM_MAP.md actualizado con descripción de funcionalidad
5. ✅ Notas de release incluyen "breaking changes" si hay
6. ✅ Equipo notificado de cualquier downtime necesario (usualmente 0)

**Durante deployment:**
- [ ] Monitorea `actividad_log` por errors (entradas inesperadas)
- [ ] Monitorea logs Vercel por errores API
- [ ] Verifica métricas Supabase por queries lentos (índices nuevos)
- [ ] Spot-check: venta dispatch crea ingreso caja
- [ ] Spot-check: gasto.efectivo crea egreso caja

**Después de deployment:**
- [ ] Ejecuta queries reconciliación (caja + stock)
- [ ] User acceptance test en 3–5 transacciones sample
- [ ] Crear GitHub issue si hay problemas (no esconder)

---

## Anti-patrones Comunes (Pre-Commit)

| Problema | Cómo Evitar | Impacto |
|----------|------------|--------|
| Dependencias circulares triggers | Dibuja diagrama flujo antes escribir | Loops infinitos o crashes silenciosos |
| RLS bloquea datos legítimos | Testea con múltiples roles antes PR | CAJERO no puede abrir caja, ¡oops! |
| Audit log missing | Llama logActividad() al final trigger | Fallo cumplimiento + debugging infierno |
| Mismatch caja | Escribe query reconciliación EN migración | Usuarios pierden confianza en app |
| Stock overcount | UPDATEs manuales sin triggers | Overselling + stock negativo |
| Soft-delete sin filtro | Siempre `WHERE activo=true` | Empleados borrados en nómina |
| RLS con funciones | Usa subquery, nunca funciones | Fuga datos a competidor |

---
