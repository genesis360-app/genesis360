---
name: full-business-ops-engine
description: 'Actúa como Arquitecto de Software Senior y Consultor de Operaciones. Úsalo para: diseñar/revisar sistemas multi-módulo (WMS↔Ventas↔Caja↔Gastos↔RRHH); evaluar impacto antes de implementar; debuguear integridad de datos; crear schema, triggers, RLS en sistemas multi-tenant.'
argument-hint: 'Describe la funcionalidad, módulo o problema (ej: "Agregar gastos a caja"; "Diseñar RRHH nómina"; "Debuguear mismatch inventario-ventas")'
---

# Motor Integral de Operaciones del Negocio

Metodología exhaustiva para diseñar, implementar y mantener sistemas de comercio integrados donde **múltiples módulos (WMS, Ventas, Caja, Gastos, RRHH) operan como un ecosistema holístico y auditado**.

---

## Cuándo Usarla

✅ **Fase de Diseño/Revisión**
- Arquitectar funcionalidades que abarquen múltiples módulos
- Evaluar impacto: "Si agrego esto a Gastos, ¿qué se rompe en Caja/RRHH?"
- Asegurar que el audit trail (actividad_log) capture todos los cambios

✅ **Fase de Implementación**
- Escribir migraciones, triggers, políticas RLS
- Crear endpoints API o Edge Functions
- Cablear flujos complejos (venta despachada → stock disminuye → ingreso en caja automático)

✅ **Fase de Debugging**
- Mismatch de stock: venta marcada despachada pero stock_actual no cambia
- Discrepancias en caja: egreso registrado pero saldo_actual inconsistente
- Gaps en auditoría: transacción no registrada en actividad_log

---

## Principios Centrales

### 1. Fuente Única de Verdad por Dominio
- **Inventario**: `inventario_lineas.stock_actual` ← SOLO actualizado por triggers en movimientos_stock
- **Caja**: `caja_sesiones.saldo_actual` ← SOLO actualizado por triggers en caja_movimientos
- **Gastos**: `gastos.monto` ← inmutable una vez creado; se puede marcar `anulado=true`
- **RRHH**: `empleados.*` ← registro de empleado canónico; NUNCA duplicar en users

### 2. Transacciones Atómicas
```
Cada operación es UNA de:
  [A] INSERT en tabla primaria (ventas, caja_movimientos, gastos, etc.)
  [B] Trigger(s) disparan para cascadas (stock, saldo, audit log)
  [C] Transacción completa o se revierte
```
**Nunca** POST a API, esperar callback, luego UPDATE en otro lado. Todo es **trigger-driven**.

### 3. Aislamiento Multi-Tenant con RLS
```
Toda tabla tiene tenant_id + política RLS:
  SELECT/INSERT/UPDATE/DELETE permitido
  WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
```
**Sin excepciones.** Sin "saltarse RLS para admin." Admin ve datos de UN tenant.

### 4. Pista de Auditoría Inmutable
```
Todo tipo de transacción (venta, movimiento_stock, caja_movimiento, gasto, rrhh_*)
  → logActividad(tabla, acción, registro_id, cambios, pk_value)
  → NO deletes manuales en actividad_log (usar soft-delete vía `anulado` en tabla original)
```

### 5. Orden del Schema (Migraciones)
```
1. Tablas helpers (sin FK): tenants, planes, cotizaciones
2. Tablas auth: users
3. Datos maestros: productos, categorías, ubicaciones, clientes, proveedores
4. Transaccionales: movimientos_stock, ventas, caja_sesiones, caja_movimientos, gastos
5. RRHH: empleados, rrhh_puestos, rrhh_departamentos
6. Vistas y funciones
7. Triggers
8. Políticas RLS al final
```

---

## Los Cuatro Módulos + Puntos de Integración

### 📦 WMS e Inventario
**Tablas:** `productos`, `inventario_lineas`, `inventario_series`, `movimientos_stock`, `ubicaciones`

**Lógica Clave:**
- `stock_actual` = SUM(cantidad) por SKU entre todas las líneas
- Trigger `ON INSERT movimientos_stock`: actualiza `inventario_lineas.stock_actual`
- `disponible_surtido=true` ← requerido para picking en venta (ubicaciones con `disponible_surtido=false` excluidas)
- Reglas: FIFO/FEFO/LEFO/LIFO/Manual por producto (override por SKU o fallback a default tenant)

**Integraciones:**
- ❌ Venta creada → stock permanece reservado en `inventario_lineas.cantidad_reservada`
- ✅ Venta despachada → stock disminuye `stock_actual`; RLS previene picking cross-tenant

### 💳 Ventas y Caja (POS)
**Tablas:** `ventas`, `venta_items`, `venta_series`, `caja_sesiones`, `caja_movimientos`

**Lógica Clave:**
- Flujo venta: borrador → cotizada → confirmada → despachada (o anulada)
- Solo `estado='despachada'` dispara ingreso en caja + disminución de stock
- `medio_pago` es JSON: `[{"tipo":"Efectivo","monto":1500},{"tipo":"Tarjeta","monto":500}]`
- **Efectivo** → auto-insert `caja_movimientos.ingreso` al despachar + actualizar `caja_sesiones.saldo_actual`
- **Tarjeta/Transferencia/MP** → informacional (sin impacto en caja, registrado como `tipo='ingreso_informativo'`)

**Integraciones:**
- ✅ Link venta → stock vía `linea_id` en `venta_items` (trazabilidad WMS→Venta)
- ✅ Link venta → caja vía auto-ingreso cuando `medio_pago='Efectivo'` al despachar

### 💰 Gastos y Finanzas
**Tablas:** `gastos`, `caja_movimientos` (tipo='egreso')

**Lógica Clave:**
- Gasto creado + `medio_pago='Efectivo'` → auto-insert `caja_movimiento.egreso` + actualizar saldo
- Gasto con `medio_pago='No Especificado'` → informacional (sin impacto en caja)
- P&L: `ganancia_neta = total_ventas - costo_ventas - total_gastos`
- `costoVentas = SUM(producto.precio_costo * cantidad)` por período

**Integraciones:**
- ✅ Gasto efectivo → egreso en caja
- ✅ Gasto monto > saldo_caja → bloqueado (error UI antes de POST)

### 👥 RRHH y Nómina
**Tablas:** `empleados`, `rrhh_puestos`, `rrhh_departamentos` (Phase 1)  
**Futuro:** `rrhh_salarios`, `rrhh_vacaciones`, `rrhh_asistencia` (Fases 2–5)

**Lógica Clave:**
- `empleados` es registro maestro inmutable (DNI único por tenant)
- Soft delete: `activo=false` (nunca hard-delete de empleados)
- Phase 2: `rrhh_salarios.estado='pagada'` → auto-insert `caja_movimiento.egreso` + logActividad

**Integraciones:**
- 🟡 Phase 2A: Nómina pagada → auto-egreso en caja (futuro)
- 🟡 Phase 3A: Asistencia + comisiones por venta (futuro)

---

## Procedimiento: Implementar Nueva Funcionalidad

### Paso 1: Evaluación de Impacto (Antes del Código)
**Pregúntate:**
- ¿Qué tablas modifico? (¿Productos? ¿Inventario? ¿Caja?)
- ¿Qué triggers se disparan? (¿Auto-stock decrease? ¿Auto-ingreso caja?)
- ¿Quién lee estos datos? (¿OWNER? ¿RRHH? ¿CAJERO?) → implicaciones RLS
- ¿Cómo se audita? (¿Se requiere entrada actividad_log?)
- Edge case: ¿qué pasa si no hay caja_sesion activa? → ¿bloquear u permitir?

**Output:** Referencia [./references/impact-matrix.md](./references/impact-matrix.md) para mapear funcionalidad → tablas → triggers → RLS

### Paso 2: Diseño del Schema (migrations/NNN_*.sql)
**Checklist:**
1. ✅ Tabla tiene `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
2. ✅ Tabla tiene `created_at` y `updated_at` TIMESTAMPTZ
3. ✅ Patrón soft-delete: `activo BOOLEAN DEFAULT TRUE` (o enum status)
4. ✅ Índices en `tenant_id` + columnas frecuentemente consultadas
5. ✅ RLS habilitado: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
6. ✅ Política RLS usa **subquery**, nunca funciones en WHERE de políticas
7. ✅ Trigger para `set_updated_at()` en cada UPDATE
8. ✅ Trigger para `logActividad()` en INSERT/UPDATE/DELETE donde se requiera auditoría

### Paso 3: Implementar Triggers
**Patrón:**
```sql
-- Trigger: venta → auto-ingreso caja
CREATE OR REPLACE FUNCTION public.venta_dispatch_to_caja()
RETURNS TRIGGER AS $$
DECLARE
  v_efectivo DECIMAL(12,2);
  v_caja_sesion_id UUID;
BEGIN
  -- Solo en transición estado='despachada'
  IF NEW.estado = 'despachada' AND OLD.estado != 'despachada' THEN
    -- Extraer efectivo de JSON medio_pago
    v_efectivo := COALESCE(
      (NEW.medio_pago::jsonb ->> 'efectivo')::DECIMAL(12,2), 0
    );
    
    IF v_efectivo > 0 THEN
      -- Obtener sesión caja activa
      SELECT id INTO v_caja_sesion_id
      FROM caja_sesiones
      WHERE tenant_id = NEW.tenant_id AND cerrado_at IS NULL
      LIMIT 1;
      
      IF v_caja_sesion_id IS NULL THEN
        RAISE EXCEPTION 'No hay sesión de caja abierta';
      END IF;
      
      -- Insert caja_movimiento
      INSERT INTO caja_movimientos(tenant_id, caja_sesion_id, tipo, monto, concepto, venta_id)
      VALUES(NEW.tenant_id, v_caja_sesion_id, 'ingreso', v_efectivo, 'Venta#'||NEW.numero, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_venta_dispatch_to_caja
AFTER UPDATE ON ventas
FOR EACH ROW
EXECUTE FUNCTION public.venta_dispatch_to_caja();
```

### Paso 4: Testear Integridad de Datos
Usa [./scripts/integrity-check.sql](./scripts/integrity-check.sql) para validar:
```sql
-- Después de despachar venta con efectivo:
-- 1. caja_movimientos tiene entrada ingreso
-- 2. caja_sesiones.saldo_actual aumentó
-- 3. inventario_lineas.stock_actual disminuyó
-- 4. actividad_log tiene entradas para venta, caja_movimiento, movimiento_stock
```

### Paso 5: Actualizar SYSTEM_MAP.md
Documenta en [./assets/SYSTEM_MAP.md](./assets/SYSTEM_MAP.md):
```
## Funcionalidad: [Nombre Funcionalidad]
- **Trigger:** [Función SQL que se dispara]
- **Tablas afectadas:** [tabla_1, tabla_2, ...]
- **Impacto RLS:** [¿Cambios en políticas?]
- **Auditoría:** [Detalles llamadas logActividad]
- **Flujo usuario:** [Paso a paso desde UI]
```

---

## Procedimiento: Debuguear Problema de Integridad

### Problema: Venta Despachada pero Stock sin Cambiar
**Diagnóstico:**
1. Revisa `actividad_log` por entradas venta + movimientos_stock
2. Ejecuta: `SELECT stock_actual FROM inventario_lineas WHERE producto_id=X AND tenant_id=Y`
3. Verifica si `caja_sesiones` tiene sesión abierta (requerido para efectivo)
4. Verifica RLS: usuario pertenece a correct tenant_id

**Causas Comunes:**
- ❌ Venta tiene `tipo_pago='Tarjeta'` (no auto-decrease, intencional)
- ❌ `estado='confirmada'` no `'despachada'` (trigger solo dispara en despacho)
- ❌ Trigger `venta_dispatch_to_stock` missing o disabled
- ❌ Política RLS bloquea escritura inventario (datos cross-tenant) → verifica `tenant_id`

**Arreglo:**
```sql
-- Fuerza re-aplicar trigger (si está stuck en borrador):
UPDATE ventas SET estado='despachada' WHERE id=... AND estado='confirmada';

-- Verifica audit trail:
SELECT * FROM actividad_log 
WHERE tabla='ventas' AND registro_id=... 
ORDER BY created_at DESC LIMIT 5;
```

### Problema: Mismatch en Caja (saldo_actual ≠ esperado)
**Diagnóstico:**
1. Obtén caja_sesion_id de sesión abierta
2. Ejecuta: `SELECT SUM(CASE WHEN tipo='ingreso' THEN monto ELSE -monto END) FROM caja_movimientos WHERE caja_sesion_id=X`
3. Compara contra `caja_sesiones.saldo_actual`
4. Verifica `saldo_inicial` (¿es 0? ¿sesión debería resetearse?)

**Causas Comunes:**
- ❌ `caja_movimiento` insertado manualmente sin trigger
- ❌ Egreso gasto no linkeado a ningún caja_sesion (missing INSERT)
- ❌ tipo='ingreso_informativo' contado en saldo (NO debería contar)

### Problema: Audit Trail Missing (actividad_log vacío)
**Diagnóstico:**
1. Verifica si tabla tiene trigger `tr_log_...` attached
2. Confirma RLS permite usuario leer `actividad_log.venta_id`
3. Verifica `logActividad()` no está siendo rate-limited

**Causas Comunes:**
- ❌ Trigger nunca creado para tabla
- ❌ logActividad() dispara antes de commit transacción → timing issue
- ❌ Mismatch tipo en función (ej: pasar INT a parámetro UUID)

---

## Procedimiento: Cablear Nueva Phase RRHH

### Ejemplo: Phase 2A — Nómina (Payroll)

**1. Schema** (`migrations/015_rrhh_nomina.sql`)
```sql
CREATE TABLE IF NOT EXISTS rrhh_salarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  salario_basico DECIMAL(12,2) NOT NULL,
  descuentos DECIMAL(12,2) DEFAULT 0,
  comisiones DECIMAL(12,2) DEFAULT 0,
  salario_neto DECIMAL(12,2) GENERATED ALWAYS AS (salario_basico + comisiones - descuentos) STORED,
  estado TEXT CHECK (estado IN ('borrador','procesada','pagada')) DEFAULT 'borrador',
  creado_por UUID REFERENCES users(id),
  pagado_at TIMESTAMPTZ,
  caja_movimiento_id UUID REFERENCES caja_movimientos(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_salarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rrhh_salarios_tenant" ON rrhh_salarios
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_rrhh_salarios_tenant ON rrhh_salarios(tenant_id);
```

**2. Trigger: Pagar nómina → egreso caja**
```sql
CREATE OR REPLACE FUNCTION public.rrhh_salarios_pay_to_caja()
RETURNS TRIGGER AS $$
DECLARE
  v_caja_sesion_id UUID;
  v_caja_movimiento_id UUID;
BEGIN
  IF NEW.estado = 'pagada' AND OLD.estado != 'pagada' THEN
    SELECT id INTO v_caja_sesion_id
    FROM caja_sesiones
    WHERE tenant_id = NEW.tenant_id AND cerrado_at IS NULL
    LIMIT 1;
    
    IF v_caja_sesion_id IS NULL THEN
      RAISE EXCEPTION 'No hay sesión activa para registrar pago de nómina';
    END IF;
    
    INSERT INTO caja_movimientos(tenant_id, caja_sesion_id, tipo, monto, concepto, rrhh_salario_id)
    VALUES(NEW.tenant_id, v_caja_sesion_id, 'egreso', NEW.salario_neto, 
           'Nómina ' || (SELECT email FROM empleados WHERE id = NEW.empleado_id), NEW.id)
    RETURNING id INTO v_caja_movimiento_id;
    
    UPDATE rrhh_salarios SET caja_movimiento_id = v_caja_movimiento_id, pagado_at = NOW()
    WHERE id = NEW.id;
    
    PERFORM logActividad('rrhh_salarios', 'UPDATE', NEW.id, 
      json_build_object('estado', NEW.estado, 'salario_neto', NEW.salario_neto),
      'rrhh_salario_id');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**3. Componente UI** (`src/pages/RrhhPage.tsx`)
- Tab "Nómina": form para crear `rrhh_salarios` en estado 'borrador'
- Editable: descuentos, comisiones
- Botón "Procesar nómina" → batch update estado='procesada'
- Botón "Pagar" → UPDATE estado='pagada' (dispara egreso caja)

**4. Test & Verificar**
```sql
-- Después de click "Pagar":
SELECT * FROM rrhh_salarios WHERE estado='pagada' AND tenant_id=... ORDER BY pagado_at DESC;
SELECT * FROM caja_movimientos WHERE tipo='egreso' AND concepto LIKE 'Nómina%' AND tenant_id=...;
SELECT * FROM actividad_log WHERE tabla='rrhh_salarios' AND tenant_id=... ORDER BY created_at DESC;
```

---

## Documentos de Referencia

- [./references/impact-matrix.md](./references/impact-matrix.md) — Funcionalidad → Tablas → Triggers → impacto RLS
- [./references/integrity-checklist.md](./references/integrity-checklist.md) — Verificación pre-commit
- [./references/patterns.md](./references/patterns.md) — Patrones SQL reutilizables por módulo
- [./assets/SYSTEM_MAP.md](./assets/SYSTEM_MAP.md) — Doc viva de todas las conexiones cross-módulo

---

## Úsala Cuando

✅ Diseñar funcionalidades multi-tabla (ej: "Agregar descuentos a venta_items y sincronizar márgenes")  
✅ Revisar migraciones antes de aplicar en PROD  
✅ Debuguear discrepancias stock/caja/auditoría  
✅ Implementar nuevas fases RRHH  
✅ Evaluar impacto: "¿Qué se rompe si cambio esta tabla?"

---
