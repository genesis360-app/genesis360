-- Migration 368: Fase 1 (cimientos de datos) del plan "Caja en USD" (relevamiento G5, respondido
-- 2026-08-18 — ver G360.Wiki/wiki/development/reglas-negocio.md). Alcance elegido: Caja USD completa
-- (activar cajas.moneda de verdad, hoy solo etiqueta), no un MVP parcial.
--
-- Esta migración es SOLO cimiento de datos: agrega columnas + preserva el comportamiento actual al
-- 100% (defaults + backfill que solo confirman lo que ya era cierto hoy). NO cablea todavía ninguna
-- pantalla ni RPC a operar en USD — eso son las fases siguientes del plan. Aditiva, sin DDL destructivo.
--
-- 1) Moneda REAL (no solo etiqueta) en caja_sesiones/caja_movimientos/caja_arqueos, denormalizada
--    desde cajas.moneda al momento de cada operación — así queda INMUTABLE en el histórico aunque
--    alguien edite cajas.moneda después (REGLA #0: nunca reescribir registros contables retroactivos).
--    Hoy NINGUNA caja real es USD (cajas.moneda default 'ARS' desde mig 136, nadie operó una Caja USD
--    todavía) → el DEFAULT 'ARS' ya cubre el 100% de las filas existentes correctamente, sin backfill.
ALTER TABLE caja_sesiones    ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS';
ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS';
ALTER TABLE caja_arqueos     ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS';

-- 2) Cotización snapshot por venta (B1/B2 del relevamiento — uso interno, NUNCA va a AFIP: C1
--    confirma que la factura sigue 100% en pesos). Se completa solo cuando la venta involucró una
--    conversión real de USD (producto en moneda_venta='usd' o pago en USD) — NULL en el resto.
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cotizacion_usd numeric(14,2);

-- 3) Generalizar "medio de pago = efectivo real" (A3, respuesta 'a' del relevamiento). Hoy varios
--    lugares (JS: ventasValidation.ts / VentasPage.tsx / GastosPage.tsx; SQL: fn_pedido_generar_venta,
--    registrar_pago_oc, marcar_envios_pagados) comparan el string exacto 'Efectivo' — un medio nuevo
--    "Efectivo USD" hoy NO sería reconocido como efectivo real (no calcularía vuelto, no movería saldo
--    de caja, caería como ingreso_informativo). Se agrega un flag explícito + la moneda de ese medio,
--    en vez de un string mágico único.
ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS es_efectivo boolean NOT NULL DEFAULT false;
ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS moneda      text    NOT NULL DEFAULT 'ARS';

-- Backfill: el ÚNICO medio que HOY se trata como efectivo real en toda la app es el que se llama
-- literalmente 'Efectivo' (comparación por nombre exacto, ver arriba) — marcarlo explícitamente
-- preserva el comportamiento actual al 100% para todos los tenants existentes. Es justamente lo que
-- habilita reemplazar `tipo === 'Efectivo'` por `es_efectivo` sin cambiar nada para nadie.
UPDATE metodos_pago SET es_efectivo = true WHERE nombre = 'Efectivo';

-- Seed de tenants nuevos: agregar es_efectivo/moneda al alta de métodos de pago default (mig 225).
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

  INSERT INTO metodos_pago (tenant_id, nombre, color, orden, activo, es_sistema, cuenta_origen_id, es_efectivo, moneda) VALUES
    (NEW.id, 'Efectivo',           '#22c55e', 1, true, true, v_efectivo_cuenta_id, true,  COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Mercado Pago',       '#06b6d4', 2, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Tarjeta de débito',  '#eab308', 3, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Transferencia',      '#8b5cf6', 4, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS')),
    (NEW.id, 'Tarjeta de crédito', '#f97316', 5, true, true, NULL,                 false, COALESCE(NEW.moneda, 'ARS'))
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$function$
