-- Migration 391: Sección G de la propuesta de Fede (25/8/2026) — medición de consumo por tenant.
-- FASE 1: el LEDGER de costos. Mide lo que Genesis360 PAGA (a Meta, a Anthropic, a Groq) por cada
-- tenant. NO define lo que se le cobra al cliente — el precio de venta y el margen son una decisión de
-- negocio que todavía no está tomada, y va en una fase aparte para no hornear un margen inventado en la
-- base.
--
-- Principio de diseño (mismo criterio que el ledger de trazabilidad WMS): el costo se calcula y se
-- CONGELA en el momento del evento (write-time), nunca se recalcula al leer. Si mañana cambia una
-- tarifa, el histórico no se mueve — mismo criterio que la REGLA #0 sobre no reescribir registros
-- contables históricos (el IVA de un gasto viejo se calculó con la condición de ESE momento).
--
-- Fuente de verdad de la categoría de un mensaje de WhatsApp: el propio webhook de `statuses` de Meta,
-- que informa `pricing.category` y `pricing.billable` de cada mensaje entregado. NO se infiere de
-- nuestro lado. Hasta esta migración, `wa-webhook` descartaba esos eventos ("nada que responder").
--
-- Monedas: Meta factura en ARS (rate card oficial de Argentina), Anthropic en USD. NO se convierte ni
-- se mezcla — se acumula por moneda, mismo criterio que ya usan los KPI de Caja/Dashboard con ARS/USD.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. consumo_tarifas — rate card versionado por fecha (global de plataforma, no por tenant)
-- Versionado por `vigente_desde`/`vigente_hasta` para que un evento viejo conserve la tarifa que regía
-- ese día. Sin RLS por tenant: son precios de lista públicos de Meta/Anthropic, iguales para todos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumo_tarifas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto        TEXT NOT NULL,
  unidad          TEXT NOT NULL CHECK (unidad IN ('mensaje', 'millon_tokens', 'minuto')),
  precio          NUMERIC(20,10) NOT NULL CHECK (precio >= 0),
  moneda          TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
  vigente_desde   DATE NOT NULL,
  vigente_hasta   DATE,                      -- NULL = vigente hasta nuevo aviso
  fuente          TEXT,                      -- de dónde salió el número (auditoría)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumo_tarifas_rango_valido CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  UNIQUE (concepto, vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_consumo_tarifas_lookup
  ON consumo_tarifas (concepto, vigente_desde DESC);

ALTER TABLE consumo_tarifas ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquier usuario logueado (son precios de lista, no hay nada sensible ni por tenant).
-- Escritura: solo service_role — no hay policy de INSERT/UPDATE/DELETE a propósito.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'consumo_tarifas' AND policyname = 'consumo_tarifas_lectura'
  ) THEN
    CREATE POLICY consumo_tarifas_lectura ON consumo_tarifas
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

REVOKE ALL ON consumo_tarifas FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. consumo_eventos — el ledger inmutable, una fila por evento facturable
-- `precio_unitario`, `moneda` y `costo` son un SNAPSHOT del momento: sobreviven a cualquier cambio
-- posterior del rate card. `tarifa_id` queda solo como trazabilidad de qué fila se usó.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumo_eventos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canal             TEXT NOT NULL,             -- 'whatsapp' (único hoy; deja lugar a otros canales)
  concepto          TEXT NOT NULL,             -- 'whatsapp_utility', 'ia_tokens_in', ...
  -- (20,10) y no (16,4): la cantidad de los conceptos de IA se expresa en MILLONES de tokens, así que
  -- un mensaje típico son ~0,0029080000 millones. Con 4 decimales se redondearía a 0,0029 y el costo
  -- saldría mal. `detalle` guarda además el conteo crudo de tokens para poder leerlo a ojo.
  cantidad          NUMERIC(20,10) NOT NULL CHECK (cantidad >= 0),
  unidad            TEXT NOT NULL,
  precio_unitario   NUMERIC(20,10) NOT NULL CHECK (precio_unitario >= 0), -- snapshot
  moneda            TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),       -- snapshot
  costo             NUMERIC(20,10) NOT NULL CHECK (costo >= 0),           -- snapshot: cantidad * precio
  facturable        BOOLEAN NOT NULL DEFAULT TRUE,  -- Meta puede informar que el mensaje fue gratis
  tarifa_encontrada BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = no había tarifa vigente; costo quedó en 0
  tarifa_id         UUID REFERENCES consumo_tarifas(id) ON DELETE SET NULL,
  referencia        TEXT,                      -- message_id de Meta (idempotencia)
  detalle           JSONB,                     -- payload de pricing de Meta, modelo de IA, etc.
  ocurrido_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotencia: Meta reenvía el mismo status (sent/delivered/read) varias veces por mensaje.
  -- Un mismo mensaje SÍ puede generar varios eventos de conceptos distintos (tokens in, tokens out,
  -- costo del mensaje) — por eso el concepto entra en la clave.
  UNIQUE (tenant_id, canal, concepto, referencia)
);

CREATE INDEX IF NOT EXISTS idx_consumo_eventos_tenant_periodo
  ON consumo_eventos (tenant_id, ocurrido_at DESC);

CREATE INDEX IF NOT EXISTS idx_consumo_eventos_sin_tarifa
  ON consumo_eventos (tenant_id) WHERE NOT tarifa_encontrada;

ALTER TABLE consumo_eventos ENABLE ROW LEVEL SECURITY;

-- Solo LECTURA para usuarios del tenant. Sin policies de INSERT/UPDATE/DELETE a propósito: el ledger
-- es inmutable y solo lo escribe service_role desde las Edge Functions. La UI que lo muestra está
-- gateada a DUEÑO/ADMIN, pero el aislamiento real es este.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'consumo_eventos' AND policyname = 'consumo_eventos_lectura_tenant'
  ) THEN
    CREATE POLICY consumo_eventos_lectura_tenant ON consumo_eventos
      FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
  END IF;
END $$;

REVOKE ALL ON consumo_eventos FROM anon;

COMMENT ON TABLE consumo_eventos IS
  'Ledger inmutable de consumo por tenant (Sección G). Costo congelado al momento del evento; nunca recalcular al leer.';
COMMENT ON COLUMN consumo_eventos.tarifa_encontrada IS
  'FALSE = no había tarifa vigente para ese concepto/fecha. El evento se registra igual con costo 0 para no perder el consumo; revisar y completar el rate card.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fn_consumo_tarifa_vigente — resuelve la tarifa de un concepto a una fecha dada
-- STABLE + SECURITY INVOKER: la usan las Edge Functions (service_role) al escribir el evento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_consumo_tarifa_vigente(p_concepto TEXT, p_fecha DATE)
RETURNS TABLE (tarifa_id UUID, precio NUMERIC, moneda TEXT, unidad TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT t.id, t.precio, t.moneda, t.unidad
  FROM consumo_tarifas t
  WHERE t.concepto = p_concepto
    AND t.vigente_desde <= p_fecha
    AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= p_fecha)
  ORDER BY t.vigente_desde DESC
  LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. vw_consumo_mensual — agregado por tenant/mes/concepto/moneda
-- security_invoker: hereda la RLS de consumo_eventos, cada tenant ve solo lo suyo.
-- Sin conversión entre monedas a propósito (ARS de Meta y USD de Anthropic se acumulan por separado).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_consumo_mensual
WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  date_trunc('month', e.ocurrido_at)::date       AS periodo,
  e.canal,
  e.concepto,
  e.moneda,
  COUNT(*)                                       AS eventos,
  SUM(e.cantidad)                                AS cantidad,
  SUM(e.costo) FILTER (WHERE e.facturable)       AS costo_facturable,
  SUM(e.costo)                                   AS costo_total,
  COUNT(*) FILTER (WHERE NOT e.tarifa_encontrada) AS eventos_sin_tarifa
FROM consumo_eventos e
GROUP BY e.tenant_id, date_trunc('month', e.ocurrido_at), e.canal, e.concepto, e.moneda;

REVOKE ALL ON vw_consumo_mensual FROM anon;
GRANT SELECT ON vw_consumo_mensual TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed del rate card
-- Meta: rate card oficial de Argentina en ARS (el mismo PDF/CSV que publica Meta en su página de
--   precios, verificado 2026-09-05). Marketing $89,5620 · Utilidad y Autenticación $37,6798.
-- Anthropic: precios de lista de claude-sonnet-5 (el modelo que usa wa-webhook): USD 2/MTok de
--   entrada y USD 10/MTok de salida.
-- Groq Whisper: se registra el concepto pero sin tarifar (costo despreciable, decisión consciente del
--   2026-08-27). Queda visible en el ledger para poder tarifarlo después sin migración nueva.
--
-- ⚠ `whatsapp_service` tiene DOS filas: gratis hasta el 30/9/2026 y con precio desde el 1/10/2026,
-- cuando Meta empieza a cobrar los mensajes de servicio (verificado contra
-- developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages).
-- El precio de esa segunda fila es una DERIVACIÓN de lo que dice Meta ("rates for service messages are
-- the same as the rates for utility and authentication messages"), NO un número publicado: al
-- 2026-09-05 la columna "Servicio" del rate card argentino todavía no estaba publicada.
-- REVISAR Y CONFIRMAR antes del 1/10/2026.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO consumo_tarifas (concepto, unidad, precio, moneda, vigente_desde, vigente_hasta, fuente) VALUES
  ('whatsapp_marketing',      'mensaje',       89.562000, 'ARS', '2026-07-01', NULL,
   'Rate card oficial de Meta para Argentina (ARS), vigente desde 2026-07-01. Verificado 2026-09-05.'),
  ('whatsapp_utility',        'mensaje',       37.679800, 'ARS', '2026-07-01', NULL,
   'Rate card oficial de Meta para Argentina (ARS), vigente desde 2026-07-01. Verificado 2026-09-05.'),
  ('whatsapp_authentication', 'mensaje',       37.679800, 'ARS', '2026-07-01', NULL,
   'Rate card oficial de Meta para Argentina (ARS), vigente desde 2026-07-01. Verificado 2026-09-05.'),
  ('whatsapp_service',        'mensaje',        0.000000, 'ARS', '2024-11-01', '2026-09-30',
   'Gratis: "Effective November 1, 2024 - Service conversations are now free for all businesses" (Meta).'),
  ('whatsapp_service',        'mensaje',       37.679800, 'ARS', '2026-10-01', NULL,
   'DERIVADO, NO PUBLICADO: Meta anuncia que desde el 1/10/2026 cobra los mensajes de servicio "at the same rates as utility and authentication". La columna Servicio del rate card argentino no estaba publicada al 2026-09-05 — CONFIRMAR antes de esa fecha.'),
  ('ia_tokens_in',            'millon_tokens',  2.000000, 'USD', '2026-01-01', NULL,
   'Precio de lista de Anthropic para claude-sonnet-5: USD 2 por millón de tokens de entrada.'),
  ('ia_tokens_out',           'millon_tokens', 10.000000, 'USD', '2026-01-01', NULL,
   'Precio de lista de Anthropic para claude-sonnet-5: USD 10 por millón de tokens de salida.'),
  ('audio_transcripcion',     'minuto',         0.000000, 'USD', '2026-01-01', NULL,
   'Groq Whisper (whisper-large-v3-turbo). Sin tarifar todavía: costo despreciable, decisión consciente del 2026-08-27. El concepto existe para poder tarifarlo sin migración nueva.')
ON CONFLICT (concepto, vigente_desde) DO NOTHING;
