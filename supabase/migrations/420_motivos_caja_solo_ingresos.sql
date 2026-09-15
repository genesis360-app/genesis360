-- 420 — Motivos de caja: solo motivos de INGRESO (decisión de GO, 2026-09-14)
--
-- 🛑 El modal "Ingreso de caja" (CajaPage) SOLO registra ingresos — los egresos van por Gastos, Caja
-- Fuerte o traspasos —, pero la siembra de cada negocio le ofrecía tres chips y dos nombraban SALIDAS:
-- "Extracción / Retiro" y "Gastos varios". El chip solo completa el concepto, no cambia el tipo:
-- grabando el video 5 se registró un flete de $6.200 como +$6.200 de INGRESO, dos veces seguidas.
--
-- 1) fn_seed_tenant_defaults: un negocio nuevo recibe "Ingreso de efectivo", "Aporte del dueño" y
--    "Fondo de cambio". CREATE OR REPLACE completo, copiado de `pg_get_functiondef` en DEV (PROD tenía el
--    mismo código sin los comentarios). Se repiten SECURITY DEFINER y SET search_path: el alta inserta
--    `tenants` antes que `users` (mig 166) y CREATE OR REPLACE no conserva el search_path (mig 413).
-- 2) Negocios existentes: se DESACTIVAN los dos motivos de sistema que nombran salidas (`activo` = false,
--    no se borran) y se agregan los dos nuevos donde falten. Los movimientos ya registrados no cambian: el
--    concepto se guarda como texto en `caja_movimientos`, no apunta al motivo (REGLA #0, punto 7). Los
--    motivos que creó cada negocio no se tocan. Idempotente.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Siembra de negocios nuevos
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_seed_tenant_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sucursal_id UUID;
  v_efectivo_cuenta_id UUID;
BEGIN
  v_sucursal_id := gen_random_uuid();

  INSERT INTO sucursales (id, tenant_id, nombre, activo)
  VALUES (v_sucursal_id, NEW.id, 'Sucursal 1', true);

  INSERT INTO cajas (tenant_id, nombre, sucursal_id)
  VALUES (NEW.id, 'Caja Principal', v_sucursal_id);

  -- mig 420: los motivos de tipo 'caja' son los chips del modal "Ingreso de caja", que SOLO suma plata.
  -- Ninguno puede nombrar una salida ("Extracción / Retiro" y "Gastos varios" invitaban a cargar un
  -- egreso como ingreso).
  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    (NEW.id, 'Compra a proveedor',     'ingreso', true),
    (NEW.id, 'Ingreso inicial',         'ingreso', true),
    (NEW.id, 'Devolución de cliente',   'ingreso', true),
    (NEW.id, 'Venta',                   'rebaje', true),
    (NEW.id, 'Merma / Rotura',          'rebaje', true),
    (NEW.id, 'Consumo interno',         'rebaje', true),
    (NEW.id, 'Vencimiento',             'rebaje', true),
    (NEW.id, 'Ingreso de efectivo',     'caja',   true),
    (NEW.id, 'Aporte del dueño',        'caja',   true),
    (NEW.id, 'Fondo de cambio',         'caja',   true),
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

  -- G5 Fase 5 (F2) — "Efectivo USD" se siembra SIEMPRE, igual que "Efectivo", sin importar si el
  -- tenant termina usando Caja USD. Es la cuenta donde la Bóveda recibe dólares directo (K1: hoy
  -- los tenants ya cobran en USD "a mano" y lo llevan a la caja fuerte). Dormida en $0 no cuesta
  -- nada y evita un 2do seed condicional más adelante.
  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo USD', 'efectivo', 'USD', true)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  INSERT INTO metodos_pago (tenant_id, nombre, color, orden, activo, es_sistema, cuenta_origen_id, es_efectivo, moneda) VALUES
    (NEW.id, 'Efectivo',           '#22c55e', 1, true, true, v_efectivo_cuenta_id, true,  COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Mercado Pago',       '#06b6d4', 2, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Tarjeta de débito',  '#eab308', 3, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Transferencia',      '#8b5cf6', 4, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Tarjeta de crédito', '#f97316', 5, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS'))
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) Negocios existentes
-- ─────────────────────────────────────────────────────────────────────────────────────────────
UPDATE public.motivos_movimiento
   SET activo = false
 WHERE es_sistema = true
   AND tipo = 'caja'
   AND nombre IN ('Extracción / Retiro', 'Gastos varios')
   AND activo = true;

-- Solo en los negocios que ya tenían la siembra de motivos de caja; sin duplicar un nombre que el
-- negocio ya tenga (no hay constraint única por (tenant_id, nombre) en esta tabla).
INSERT INTO public.motivos_movimiento (tenant_id, nombre, tipo, es_sistema)
SELECT t.tenant_id, n.nombre, 'caja', true
  FROM (SELECT DISTINCT tenant_id FROM public.motivos_movimiento WHERE es_sistema = true AND tipo = 'caja') t
 CROSS JOIN (VALUES ('Aporte del dueño'), ('Fondo de cambio')) AS n(nombre)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.motivos_movimiento m
    WHERE m.tenant_id = t.tenant_id AND lower(m.nombre) = lower(n.nombre)
 );
