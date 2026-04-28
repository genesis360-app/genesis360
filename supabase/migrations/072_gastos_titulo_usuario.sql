-- Migration 072: gastos — título comprobante, usuario, IVA mejorado, ganancias
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS comprobante_titulo TEXT;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS usuario_id      UUID REFERENCES public.users(id);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_iva        TEXT;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS iva_deducible   BOOLEAN DEFAULT FALSE;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS deduce_ganancias BOOLEAN DEFAULT FALSE;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS gasto_negocio   BOOLEAN; -- NULL = no aplica

-- gastos_fijos: alerta + mismos campos fiscales
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS alerta_dias_antes INT DEFAULT 3;
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS tipo_iva           TEXT;
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS iva_deducible      BOOLEAN DEFAULT FALSE;
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS deduce_ganancias   BOOLEAN DEFAULT FALSE;
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS gasto_negocio      BOOLEAN;
