-- ============================================================
-- 327_limpieza_catalogo_empaque_unidades_fisicas.sql
-- 🧹 Limpieza de catálogo — encontrado por GO (2026-07-29): en Config → Inventario → Empaque
-- aparecían "Gramo", "Kilogramo", "Litro", "Metro" junto a "Caja"/"Pallet". No son empaque.
--
-- Causa raíz: `unidades_medida` es HOY el catálogo de nombres de EMPAQUE
-- (`producto_presentaciones.nombre_empaque_id`) — pero la mig 148 (ISS-180, PREVIA al rediseño
-- UoM/Empaque de las migs 303-308) sembró ahí 5 unidades FÍSICAS ("Unidad", "Kilogramo", "Gramo",
-- "Litro", "Metro") de cuando esta tabla todavía servía para las dos cosas a la vez. Al separarse
-- en `unidades_medida_fisicas` (la correcta para lo físico, alimenta Config → Unidades — mig 303,
-- que dice explícitamente "además del fn_seed_tenant_defaults grande, que NO se toca"), nadie podó
-- la siembra vieja acá. Son `predefinida = true` → la UI no deja borrarlas (candado 🔒).
--
-- Verificado con datos reales ANTES de escribir el DELETE, en las 7 FK que referencian
-- unidades_medida(id) — no solo las dos obvias (empaque de presentaciones e ingreso de LPN) — en
-- DEV y PROD, TODOS los tenants: producto_presentaciones.nombre_empaque_id ·
-- inventario_lineas.unidad_medida_id · combos.unidad_medida_id · movimientos_stock.unidad_medida_id ·
-- producto_estructura_niveles.unidad_medida_id · reglas_almacenaje.unidad_medida_id ·
-- venta_items.unidad_medida_id.
--
-- Gramo/Kilogramo/Litro/Metro: 0 usos en las 7 tablas, en TODOS los tenants de DEV y PROD. Seguras.
--
-- 🛑 "Unidad" se DEJA AFUERA a propósito. Tiene uso real en DEV: 53+40 filas de
-- `producto_estructura_niveles` (la tabla VIEJA, deprecada desde la mig 311 y marcada ahí "NO se
-- dropea: es histórico de recepción, borrarla sería perder trazabilidad") y 2 filas de
-- `movimientos_stock` (ledger inmutable). La FK de `producto_estructura_niveles` es RESTRICT
-- (fallaría ruidoso, seguro) pero la de `movimientos_stock` es SET NULL: borrar "Unidad" borraría
-- en silencio la trazabilidad de 2 movimientos reales. Regla #0: no se reescribe histórico. Si en
-- el futuro se quiere sacar "Unidad" también, hace falta decidir primero qué hacer con esas filas
-- — no es parte de este fix.
-- ============================================================

-- ── 1) El seed de tenants NUEVOS deja de sembrar las 4 unidades físicas como "empaque" ─────
-- Mismo cuerpo que la mig 282 (última versión vigente — la 303 agregó un seed PARALELO para
-- unidades_medida_fisicas y no tocó ésta): solo se recorta el INSERT de unidades_medida.
CREATE OR REPLACE FUNCTION fn_seed_tenant_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sucursal_id UUID;
  v_efectivo_cuenta_id UUID;
BEGIN
  v_sucursal_id := gen_random_uuid();
  INSERT INTO sucursales (id, tenant_id, nombre, activo)
  VALUES (v_sucursal_id, NEW.id, 'Sucursal 1', true);

  INSERT INTO cajas (tenant_id, nombre, sucursal_id)
  VALUES (NEW.id, 'Caja Principal', v_sucursal_id);

  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    (NEW.id, 'Compra a proveedor',     'ingreso', true),
    (NEW.id, 'Ingreso inicial',         'ingreso', true),
    (NEW.id, 'Devolución de cliente',   'ingreso', true),
    (NEW.id, 'Venta',                   'rebaje', true),
    (NEW.id, 'Merma / Rotura',          'rebaje', true),
    (NEW.id, 'Consumo interno',         'rebaje', true),
    (NEW.id, 'Vencimiento',             'rebaje', true),
    (NEW.id, 'Ingreso de efectivo',     'caja',   true),
    (NEW.id, 'Extracción / Retiro',     'caja',   true),
    (NEW.id, 'Gastos varios',           'caja',   true),
    (NEW.id, 'Ajuste de inventario',    'ambos',  true);

  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  -- 🧹 mig 327: solo nombres de EMPAQUE real (Unidad = base sin envase, Caja, Pallet). Kilogramo/
  -- Gramo/Litro/Metro eran unidades FÍSICAS coladas acá antes del rediseño (mig 148) — hoy viven
  -- en unidades_medida_fisicas (mig 303, seed paralelo trg_seed_umf_new_tenant).
  INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida) VALUES
    (NEW.id, 'Unidad',     'u',      true, true),
    (NEW.id, 'Caja',       'caja',   true, true),
    (NEW.id, 'Pallet',     'pallet', true, true)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo', 'efectivo', COALESCE(NEW.moneda, 'ARS'), true)
  RETURNING id INTO v_efectivo_cuenta_id;

  INSERT INTO metodos_pago (tenant_id, nombre, color, orden, activo, es_sistema, cuenta_origen_id) VALUES
    (NEW.id, 'Efectivo',           '#22c55e', 1, true, true, v_efectivo_cuenta_id),
    (NEW.id, 'Mercado Pago',       '#06b6d4', 2, true, true, NULL),
    (NEW.id, 'Tarjeta de débito',  '#eab308', 3, true, true, NULL),
    (NEW.id, 'Transferencia',      '#8b5cf6', 4, true, true, NULL),
    (NEW.id, 'Tarjeta de crédito', '#f97316', 5, true, true, NULL)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── 2) Limpieza de tenants EXISTENTES ───────────────────────────────────────────────────
-- Defensa en profundidad: además del WHERE nombre IN, cada NOT EXISTS repite la verificación
-- hecha a mano antes de escribir esta migración — si algún tenant no visto tuviera un uso real,
-- esa fila puntual se salta en vez de fallar (RESTRICT de producto_estructura_niveles/
-- producto_presentaciones) o peor, borrar en cascada (reglas_almacenaje.unidad_medida_id es
-- ON DELETE CASCADE — nunca debe dispararse acá).
DELETE FROM unidades_medida um
WHERE um.nombre IN ('Gramo', 'Kilogramo', 'Litro', 'Metro')
  AND um.predefinida = true
  AND NOT EXISTS (SELECT 1 FROM producto_presentaciones pp WHERE pp.nombre_empaque_id = um.id)
  AND NOT EXISTS (SELECT 1 FROM inventario_lineas il WHERE il.unidad_medida_id = um.id)
  AND NOT EXISTS (SELECT 1 FROM combos c WHERE c.unidad_medida_id = um.id)
  AND NOT EXISTS (SELECT 1 FROM movimientos_stock ms WHERE ms.unidad_medida_id = um.id)
  AND NOT EXISTS (SELECT 1 FROM producto_estructura_niveles pen WHERE pen.unidad_medida_id = um.id)
  AND NOT EXISTS (SELECT 1 FROM reglas_almacenaje ra WHERE ra.unidad_medida_id = um.id)
  AND NOT EXISTS (SELECT 1 FROM venta_items vi WHERE vi.unidad_medida_id = um.id);
