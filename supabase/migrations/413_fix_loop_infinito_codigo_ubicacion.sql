-- 413 — 🛑 El autogenerador de código de ubicación entra en LOOP INFINITO en la raíz nº 100
--
-- ── El bug ───────────────────────────────────────────────────────────────────────────────────
-- `trg_ubic_autogenerar_codigo` arma el código de una ubicación RAÍZ probando `U01`, `U02`, … hasta
-- encontrar uno libre:
--
--     v_candidato := 'U' || lpad(v_seq::text, 2, '0');
--
-- `lpad` no solo rellena: **si el texto es más largo que `length`, lo TRUNCA**. Con `v_seq = 100`,
-- `lpad('100', 2, '0')` devuelve `'10'` → el candidato es `U10`, que ya existe → `v_seq = 101` →
-- `lpad('101', 2, '0')` = `'10'` otra vez… **el LOOP nunca sale**.
--
-- O sea: el día que un negocio llega a **99 ubicaciones raíz**, la número 100 ya no se puede crear.
-- El INSERT no falla con un error entendible: se queda girando dentro del trigger hasta que lo mata
-- el `statement_timeout` (57014), quemando una conexión y CPU en cada intento. Desde la UI se ve
-- como "Agregar" que no hace nada.
--
-- ── Cómo apareció ────────────────────────────────────────────────────────────────────────────
-- No lo encontró una auditoría: lo encontró la suite e2e. Cuatro specs distintos (107, 114, 126,
-- 130) fallaban con `57014 statement timeout` al insertar en `ubicaciones`, y se habían archivado
-- como "lentitud de DEV". El tenant de prueba tiene exactamente **99 códigos `U01`-`U99`**.
--
-- ── Alcance real ─────────────────────────────────────────────────────────────────────────────
-- En PROD el máximo hoy son **4** ubicaciones raíz en un tenant, así que está LATENTE, no activo.
-- Pero 100 ubicaciones raíz es un número perfectamente normal para un depósito de verdad (un rack o
-- un pasillo por ubicación), así que es cuestión de que entre el primer cliente con volumen.
--
-- ── El arreglo ───────────────────────────────────────────────────────────────────────────────
-- 1. Se mantiene el formato de dos dígitos hasta `U99` (no se renombra nada de lo existente) y a
--    partir de ahí el número se escribe completo: `U100`, `U101`, …
-- 2. **Tope de seguridad en los dos loops.** Un `LOOP` sin cota dentro de un trigger es una bomba de
--    tiempo: si mañana otra condición lo hace no converger, vuelve a colgar el INSERT en vez de
--    fallar. Ahora, pasadas 10.000 vueltas, corta con un error explícito que dice qué pasó.
-- 3. La rama de los HIJOS (`<padre>-1`, `<padre>-2`, …) no usa `lpad`, así que no tenía el bug del
--    truncado — pero recibe el mismo tope por la misma razón.
--
-- ⚠️ Nota para el futuro: con `U100` conviviendo con `U01`-`U99`, ordenar por `codigo` COMO TEXTO
-- pone `U100` antes que `U11`. Hoy no hay ninguna pantalla que lo haga (se verificó en `src/`), y
-- el regex de validación no asume largo fijo — pero si alguien agrega un listado ordenado por
-- código, que ordene por número, no alfabéticamente.

-- ⚠️ `SET search_path` va repetido a propósito: la función YA lo tenía y `CREATE OR REPLACE` NO
-- conserva los atributos que no se vuelven a escribir. Omitirlo lo habría sacado en silencio.
CREATE OR REPLACE FUNCTION public.trg_ubic_autogenerar_codigo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_seq       int;
  v_padre_cod text;
  v_candidato text;
  -- Cota dura: con 10.000 intentos ya se agotó cualquier caso legítimo. Si se llega acá es que hay
  -- un bug, y es mejor un error que se lee que un INSERT colgado hasta el statement_timeout.
  c_max_intentos CONSTANT int := 10000;
BEGIN
  NEW.codigo := NULLIF(upper(trim(NEW.codigo)), '');

  IF NEW.codigo IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- v_seq arranca en 0 (no en un count(*) de filas existentes): el backfill de la sección 6
  -- reusa este trigger vía UPDATE sobre filas que YA EXISTEN físicamente, así que un count(*)
  -- se contaría a sí mismo antes de asignar ningún código y arrancaría en U22/U05 en vez de
  -- U01 (hallazgo de migration-reviewer). EXIT WHEN NOT EXISTS ya garantiza el primer libre.
  IF NEW.padre_ubicacion_id IS NULL THEN
    v_seq := 0;
    LOOP
      v_seq := v_seq + 1;
      -- 🛑 `lpad(x, 2, '0')` TRUNCA cuando el texto ya mide más de 2: con v_seq >= 100 devolvía
      -- siempre 'U10' y el loop no salía nunca. Se conserva el ancho 2 hasta 99 para no cambiar
      -- los códigos ya existentes, y de ahí en adelante se escribe el número completo.
      v_candidato := 'U' || CASE WHEN v_seq < 100 THEN lpad(v_seq::text, 2, '0') ELSE v_seq::text END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ubicaciones WHERE tenant_id = NEW.tenant_id AND codigo = v_candidato);
      IF v_seq > c_max_intentos THEN
        RAISE EXCEPTION 'No se pudo autogenerar un código de ubicación raíz tras % intentos (tenant %). Cargá el código a mano.',
          c_max_intentos, NEW.tenant_id;
      END IF;
    END LOOP;
  ELSE
    SELECT codigo INTO v_padre_cod FROM ubicaciones WHERE id = NEW.padre_ubicacion_id;
    v_seq := 0;
    LOOP
      v_seq := v_seq + 1;
      v_candidato := v_padre_cod || '-' || v_seq::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ubicaciones WHERE tenant_id = NEW.tenant_id AND codigo = v_candidato);
      IF v_seq > c_max_intentos THEN
        RAISE EXCEPTION 'No se pudo autogenerar un código bajo "%" tras % intentos (tenant %). Cargá el código a mano.',
          v_padre_cod, c_max_intentos, NEW.tenant_id;
      END IF;
    END LOOP;
  END IF;

  NEW.codigo := v_candidato;
  RETURN NEW;
END;
$$;

-- NO se agrega índice: el `NOT EXISTS` de cada vuelta ya lo resuelve `uq_ubicaciones_tenant_codigo`
-- (UNIQUE sobre exactamente `(tenant_id, codigo)`). Uno nuevo sería un duplicado exacto: cero
-- beneficio y una estructura más para mantener en cada escritura de `ubicaciones`.
-- Esto además confirma que el cuelgue NO era por falta de índice: el loop era literalmente infinito.
