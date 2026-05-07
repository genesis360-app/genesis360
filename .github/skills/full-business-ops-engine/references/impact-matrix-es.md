# Matriz de Evaluación de Impacto

Usa esta matriz **antes de escribir código** para evaluar cómo una nueva funcionalidad afecta todo el sistema.

## Plantilla: Análisis de Impacto de Funcionalidad

| Dimensión | Evaluación | Riesgo |
|-----------|-----------|--------|
| **Tablas Modificadas** | Lista todas las tablas tocadas (INSERT/UPDATE/DELETE) | ⚠️ Más tablas = mayor complejidad |
| **Triggers que se Disparan** | Enumera triggers y su orden | ⚠️ ¿Dependencias circulares? |
| **Políticas RLS Afectadas** | ¿Las políticas existentes necesitan actualización? | 🔴 Fuga cross-tenant si se omite |
| **Auditoría** | ¿Se llama logActividad()? | 🔴 Pérdida de cumplimiento si se omite |
| **Impacto Caja** | ¿Afecta caja_movimientos? | 🔴 Fallo reconciliación si se omite |
| **Impacto Stock** | ¿Afecta inventario_lineas? | 🔴 Errores picking, overselling si se omite |
| **Roles de Usuario** | ¿Qué roles pueden hacer esto? ¿Screening RLS? | ⚠️ CAJERO no debería crear gastos |
| **Transacción Atómica** | ¿Esto puede revertirse limpiamente? | 🔴 Riesgo corrupción datos si no |
| **Edge Cases** | ¿Sin caja activa? ¿Valores negativos? ¿Soft-delete? | ⚠️ Fallos silenciosos en producción |

---

## Ejemplos de Funcionalidades

### ✅ Funcionalidad: Agregar Producto desde Scan (Código de Barras)
```
Tablas Modificadas:    productos (INSERT) + inventario_lineas (INSERT)
Triggers:              trigger_set_updated_at + logActividad
RLS Afectado:          NO (verificación tenant_id estándar)
Auditoría:             SÍ (logActividad en inserciones)
Impacto Caja:          NO
Impacto Stock:         SÍ (nueva línea con stock_inicial)
Roles Usuario:         OWNER + SUPERVISOR solo (screening RLS)
Transacción Atómica:   SÍ (ambos INSERTs en transacción o rollback)
Edge Cases:            • ¿Código de barras vacío? → validación UI + constraint DB
                       • ¿Código duplicado? → índice UNIQUE lo previene
                       • ¿Usuario de otro tenant? → RLS bloquea INSERT
Nivel Riesgo:          🟢 BAJO
```

### ⚠️ Funcionalidad: Anulación de Venta (Reversa)
```
Tablas Modificadas:    ventas (UPDATE) + venta_items (marcar anulada)
                       + caja_movimientos (INSERT reversa)
                       + inventario_lineas (stock_actual restaurado)
Triggers:              tr_venta_anular_to_caja + tr_venta_anular_to_stock
RLS Afectado:          SÍ (venta debe devolver si fue despachada)
Auditoría:             SÍ (múltiples llamadas logActividad)
Impacto Caja:          SÍ (movimiento caja reversal si fue despachada)
Impacto Stock:         SÍ (stock_actual+cantidad_reservada restaurado)
Roles Usuario:         OWNER + SUPERVISOR (no CAJERO)
Transacción Atómica:   SÍ (todo o nada)
Edge Cases:            • ¿Si venta tiene múltiples cajas? → reversa cada ingreso
                       • ¿Stock ya scrapped antes anulación? → input usuario
                       • ¿Venta parcialmente picked? → error + intervención manual
Nivel Riesgo:          🔴 CRÍTICO (afecta caja + reconciliación inventario)
```

### 🔴 Funcionalidad: Modificar Precio Producto (retroactivo)
```
Tablas Modificadas:    productos (UPDATE precio_venta)
                       venta_items (NO MODIFICAR — histórico)
Triggers:              trigger_set_updated_at SOLO (NO price history)
RLS Afectado:          NO
Auditoría:             SÍ (logActividad en cambio precio, no venta_items viejos)
Impacto Caja:          NO
Impacto Stock:         NO
Roles Usuario:         OWNER solo (no SUPERVISOR!)
Transacción Atómica:   SÍ (single UPDATE)
Edge Cases:            • ¿Si precio_costo también cambia? → afecta márgenes
                       • ¿Dashboard usando márgenes cacheados? → invalidar cache
Nivel Riesgo:          🟡 MEDIO (no afecta ventas completadas, pero márgenes futuros)
DECISIÓN:              Cambio precio es FORWARD-looking; ventas viejas mantienen precio_unitario
```

---

## Checklist de Riesgo RLS

🔴 **CRÍTICO — Detente y revisa si:**
- Insertando/actualizando campo `tenant_id` en un trigger
- Política usa cláusula `OR` (fácil abrir datos accidentalmente)
- Función dentro de política RLS (explotable; usa subquery)
- Hard-deleting usuarios o registros tenant

🟡 **MEDIO — Testea exhaustivamente si:**
- Agregando nuevo rol usuario (RRHH, SUPERVISOR_AREA, etc.)
- Cambiando scope RLS (ej: "mostrar factura a cliente")
- Feature cross-tenant (ej: catálogo productos compartido)

🟢 **BAJO — Estándar si:**
- Política simple `tenant_id IN (SELECT ...)`
- Solo agregando nuevo campo a tabla existente con RLS

---

## Checklist de Reconciliación de Caja

**Después de cualquier funcionalidad tocando `caja_movimientos`:**

1. ✅ `tipo IN ('ingreso','egreso','ingreso_informativo')`
2. ✅ `Venta efectivo despachada → ingreso creado? SÍ`
3. ✅ `Venta no-efectivo → NO caja_movimiento (o ingreso_informativo solo)`
4. ✅ `monto > 0 siempre`
5. ✅ `caja_sesion_id not null` (excepto informativo)
6. ✅ `SUM(movimientos) = saldo_actual`
7. ✅ Entrada logActividad para cada movimiento creado

Query para verificar:
```sql
SELECT caja_sesion_id, 
  SUM(CASE WHEN tipo='ingreso' THEN monto 
           WHEN tipo='egreso' THEN -monto 
           ELSE 0 END) as cambio_neto
FROM caja_movimientos 
WHERE caja_sesion_id = $1
GROUP BY caja_sesion_id;

-- Compara cambio_neto contra caja_sesiones.saldo_actual - saldo_inicial
```

---

## Checklist de Reconciliación de Stock

**Después de cualquier funcionalidad tocando `inventario_lineas.stock_actual`:**

1. ✅ Trigger dispara solo en transición `estado='despachada'`
2. ✅ `stock_actual SOLO disminuye` al despachar venta (no UPDATEs manuales)
3. ✅ Movimiento ingreso aumenta stock_actual
4. ✅ Movimiento rebaje disminuye stock_actual
5. ✅ Venta anulada restaura stock_actual
6. ✅ Entrada logActividad para cada movimiento_stock

Query para verificar:
```sql
SELECT p.nombre, p.sku, 
  COALESCE(SUM(il.stock_actual), 0) as total_stock,
  (SELECT COUNT(*) FROM venta_items vi WHERE vi.producto_id = p.id AND vi.venta_id IN 
    (SELECT id FROM ventas WHERE estado='confirmada')) as reservado
FROM productos p
LEFT JOIN inventario_lineas il ON p.id = il.producto_id AND il.tenant_id = p.tenant_id
WHERE p.tenant_id = $1
GROUP BY p.id, p.nombre, p.sku;
```

