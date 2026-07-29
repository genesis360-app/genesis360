-- ============================================================
-- 321_vista_ocupacion_ubicacion.sql
-- Conecta la configuración de capacidad de `ubicaciones` (mig **032**), que estaba cargada desde
-- hace ~290 migraciones y **NO la leía ningún cálculo**: se completaba en Config → Inventario →
-- Ubicaciones y no servía para nada. Surgió de una pregunta de GO (2026-07-29): *"¿qué podemos
-- hacer con esta configuración que tienen las ubicaciones a nivel de volumen? ¿lo arreglamos, lo
-- conectamos con algo funcional, o no tiene sentido y lo sacamos?"*.
--
-- Da dos números por ubicación. Los dos son **AVISO, nunca bloqueo**: el dato de capacidad lo carga
-- una persona y puede estar mal o desactualizado; frenar un ingreso de mercadería real por un
-- número de configuración sería peor que el problema — la mercadería ya está físicamente ahí.
--
--   · `lpn_activos` → contra `ubicaciones.capacidad_pallets` ("3 de 4"). No exige medir ni un SKU,
--     y es la señal que sirve en el día a día.
--   · `peso_kg` → contra `ubicaciones.peso_max_kg`. Es el más importante de los tres campos:
--     sobrecargar un rack no es un problema de datos, es de **seguridad física**. Y es el más
--     confiable de calcular, porque el peso es **aditivo y exacto** (a diferencia del volumen).
--
-- ⚠ `lineas_con_peso` / `lineas_total` existen para poder mostrar la **cobertura** del dato. Si
-- faltan pesos el total queda **corto** — o sea que el error va hacia "parece que hay lugar" justo
-- cuando el rack podría estar sobrecargado. Esa dirección del error obliga a decir sobre cuántas
-- líneas se calculó, en vez de mostrar un verde limpio con datos incompletos.
--
-- 🛑 NO calcula volumen. Eso necesita las medidas por nivel de `producto_presentaciones`, que hoy
-- **no se pueden cargar** (el editor no tiene inputs) y están siempre vacías. Las dimensiones de la
-- ubicación (`largo/ancho/alto_cm`) se conservan como referencia y para el día que se haga el
-- cubicaje: son la mitad del cálculo (el continente) y volver a medir un depósito entero después
-- sería carísimo. Ver el backlog "CUBICAJE VOLUMÉTRICO" en `project_pendientes.md`.
-- ============================================================

DROP VIEW IF EXISTS vw_ubicacion_ocupacion;
CREATE VIEW vw_ubicacion_ocupacion
WITH (security_invoker = true)   -- respeta la RLS por tenant/sucursal del que consulta
AS
SELECT
  il.tenant_id,
  il.ubicacion_id,
  count(*)::integer                                               AS lpn_activos,
  COALESCE(SUM(il.cantidad * COALESCE(p.peso_kg, 0)), 0)::numeric AS peso_kg,
  count(*) FILTER (WHERE COALESCE(p.peso_kg, 0) > 0)::integer     AS lineas_con_peso,
  count(*)::integer                                               AS lineas_total
FROM inventario_lineas il
JOIN productos p ON p.id = il.producto_id
WHERE il.activo = true AND il.ubicacion_id IS NOT NULL
GROUP BY il.tenant_id, il.ubicacion_id;

COMMENT ON VIEW vw_ubicacion_ocupacion IS
  'Ocupación real de cada ubicación (mig 321): LPN activos y peso total, para contrastar contra ubicaciones.capacidad_pallets y peso_max_kg. lineas_con_peso/lineas_total dan la COBERTURA del dato — si faltan pesos el total queda corto y hay que decirlo. security_invoker: respeta la RLS del que consulta.';

REVOKE ALL ON vw_ubicacion_ocupacion FROM PUBLIC, anon;
GRANT SELECT ON vw_ubicacion_ocupacion TO authenticated, service_role;
