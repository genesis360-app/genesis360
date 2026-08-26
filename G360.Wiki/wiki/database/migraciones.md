---
title: Historial de Migraciones
category: database
tags: [migraciones, schema, postgresql, supabase]
sources: [WORKFLOW.md, CLAUDE.md, ROADMAP.md]
updated: 2026-08-25
---

# Historial de Migraciones (001-381)

**381 (`381_compras_gastos_usd_fase3_descalce.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`), COMMITEADA Y PUSHEADA a `origin/dev` (commits `2476a3e4` + `90976a33`), **⚠ código
`v1.180.0`, SIN deployar a PROD todavía**:** Fase 3 (pago con descalce de moneda) del plan "Compras/Gastos en USD + tasa
de cambio editable" (continúa las migs 379 y 380, abajo). Dos partes:
1. 🔴 **Corrección de diseño encontrada ANTES de que importara** (REGLA #0): la mig 379 había puesto
   `cotizacion_usd` como una columna ÚNICA en `ordenes_compra`/`gastos`/`gastos_fijos` — pero una OC/
   gasto se puede pagar en varias cuotas a lo largo del tiempo, así que una sola columna no aguanta más
   de una cotización sin pisar la anterior. Verificado con query real que 0 filas la usaban (ninguna
   OC/gasto en USD existía todavía) antes de corregir. **`ordenes_compra`/`gastos`/`gastos_fijos` pierden
   la columna `cotizacion_usd`** (se movió) — `caja_movimientos` la gana (`numeric(14,2)`, nullable): una
   fila por movimiento real de pago, exactamente el mismo patrón que `ventas.cotizacion_usd` (mig 368,
   G5). Las columnas `moneda` (moneda nativa, fija) de las 3 tablas quedan sin cambios.
2. **`registrar_pago_oc()` gana el parámetro `p_cotizacion_usd`** (nullable, al final, compatible con
   cualquier llamador viejo): si algún medio no-CC está en moneda distinta a la de la OC (descalce),
   exige `p_cotizacion_usd` y convierte **server-side** (1 USD = `p_cotizacion_usd` ARS, nunca confía en
   la aritmética del cliente). El monto ORIGINAL (moneda real del medio) es lo que sale físicamente de
   esa caja; el equivalente convertido cubre `monto_pagado`/saldo (siempre en la moneda nativa de la OC).
   Cuenta Corriente queda excluida de la conversión (moneda-agnóstica por diseño). Sin redondeo (H1).

🔴 **2 hallazgos de seguridad reales, corregidos ANTES de aplicar**: (1) cambiar la CANTIDAD de
parámetros de una función existente NO es reemplazable con un simple `CREATE OR REPLACE` — Postgres
identifica una función por `(nombre, tipos de argumentos)`, así que sin un `DROP FUNCTION IF EXISTS`
explícito con la firma vieja de 8 args esto crea un OVERLOAD nuevo dejando viva la función anterior — el
único caller real (`GastosPage.tsx`) seguía llamando con 8 args nombrados, así que Postgres habría
resuelto siempre hacia la vieja y toda la migración habría quedado código muerto (mismo patrón de fix ya
usado en mig 190/248). (2) al verificar ese fix, se encontró que la función NUEVA (firma de 9 args) NO
hereda los GRANT/REVOKE puntuales de la vieja — Postgres otorga EXECUTE a `PUBLIC` por default en todo
`CREATE FUNCTION` nuevo, así que `anon` seguía pudiendo ejecutar el RPC vía ese grant heredado pese al
`REVOKE FROM anon` explícito (`REVOKE FROM anon` no alcanza cuando `PUBLIC` también tiene EXECUTE).
Cerrado con `REVOKE EXECUTE ... FROM PUBLIC, anon` explícito + `GRANT ... TO authenticated, service_role`
para la firma nueva, reverificado con `has_function_privilege()` real (no alcanza con mirar el nombre en
`information_schema.routine_privileges`).

**Wiring de frontend** (`GastosPage.tsx`, commit `90976a33`, mismo commit que agrega las funciones puras
`convertirMontoAMonedaOC`/`desvioCotizacionFuerte` en `src/lib/comprasPago.ts` y
`puedeCargarCotizacionCompras` en `src/lib/comprasPermisos.ts`, con 20 tests unit nuevos): el modal de
pago de OC ya no bloquea de plano un medio en otra moneda — exige la cotización manual (gateada por el
permiso de la mig 380) y avisa (NO bloqueante) si se aleja ≥20% de la referencia del sidebar; la caja que
recibe el movimiento usa la moneda REAL del medio pagado, no la de la OC.

`migration-reviewer`: **APTA** tras corregir los 2 hallazgos de arriba. Verificado: `tsc`/`build` limpios,
4 e2e reales de pago en ARS (`80_cheque_rechazo_oc_revierte_mutante`, `28_cobranza_cc_mutante`,
`31_cheque_gasto_rechazo_mutante`, `27_gasto_efectivo_mutante`) siguen en verde — cero regresión. Ver
[[wiki/development/reglas-negocio]] → "Módulo: Compras/Gastos en USD", [[wiki/features/gastos]].

---

**380 (`380_compras_gastos_usd_fase2_permisos.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`), COMMITEADA Y PUSHEADA a `origin/dev` (commit `cce107c8`), **⚠ código `v1.180.0`,
SIN deployar a PROD todavía**:** Fase 2 (permisos) del plan "Compras/Gastos en USD + tasa de cambio editable". Agrega
`tenants.compras_cotizacion_roles_permitidos jsonb` — mismo patrón que `cotizacion_usd_roles_permitidos`
de la Caja USD G5 (mig 370): NULL/[] = solo DUEÑO puede cargar/editar la cotización manual de una compra
con descalce de moneda; roles adicionales (base o `custom:{id}`) configurables aparte. Solo cimiento de
configuración — 100% aditivo, sin cambio de comportamiento hasta que la Fase 3 (mig 381, arriba) la
consume. Ver [[wiki/development/reglas-negocio]] → "Módulo: Compras/Gastos en USD".

---

**379 (`379_compras_gastos_usd_fase1_cimientos.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`), COMMITEADA Y PUSHEADA a `origin/dev` (commit `6a0f46af`), **⚠ código `v1.180.0`,
SIN deployar a PROD todavía**:** Fase 1 (cimientos de datos) del plan "Compras/Gastos en USD + tasa de cambio editable" — relevamiento nuevo, generado y
respondido por Fede el 2026-08-21 (100% cerrado), distinto del G5 (Caja USD, que solo cubrió VENTAS): este
cubre el lado de COMPRAS/GASTOS, feature nueva de punta a punta. Agrega:
1. `moneda text NOT NULL DEFAULT 'ARS'` + `cotizacion_usd numeric(14,2)` en `gastos`, `gastos_fijos` y
   `ordenes_compra` — mismo patrón que `ventas.cotizacion_usd` (mig 368, Caja USD): NULL salvo que la
   transacción haya tenido una conversión real (solo se guarda si hay descalce de moneda entre costo y
   pago); nunca se redondea. 100% aditivo, `DEFAULT 'ARS'` preserva el comportamiento actual al 100%.
   **⚠ Corregido por la mig 381 (arriba)**: la columna `cotizacion_usd` de estas 3 tablas fue eliminada y
   movida a `caja_movimientos.cotizacion_usd` (no aguantaba más de un pago por cuota) — `moneda` en las 3
   tablas queda sin cambios.
2. 🔴 **Fix real de REGLA #0 encontrado al diseñar esta fase**: `registrar_pago_oc()` ya insertaba egresos
   reales en `caja_movimientos` (`egreso`/`egreso_informativo`) al pagar una OC — la Caja USD YA soportaba
   egresos, no hacía falta construir esa capacidad de cero (respuesta a una pregunta técnica que Fede le
   dejó a GO) — pero el INSERT nunca completaba la columna `moneda` (`caja_movimientos.moneda`, mig 368):
   quedaba siempre en el DEFAULT `'ARS'` sin importar la moneda real del método de pago usado. Si se
   pagara una OC en USD desde una Caja USD, el movimiento habría quedado mal etiquetado como ARS
   (violación latente de integridad contable). Fix: se agrega `v_moneda_medio` (misma fuente que
   `v_es_efectivo`, `metodos_pago.moneda` por nombre de medio) y se completa `moneda` en el INSERT. **Cero
   cambio de comportamiento para pagos en ARS** (100% del volumen real hoy) — verificado con e2e real.

`migration-reviewer`: **APTA**, sin hallazgos bloqueantes. Solo cimientos de datos — sin wiring de
frontend todavía (permisos, UI de Gastos/OC en USD, reportes quedan para la Fase 2+, sin plan fijo de
fases detallado, se decidió iterar en vez de un plan de 8 fases como G5). Ver
[[wiki/development/reglas-negocio]] → "Módulo: Compras/Gastos en USD", [[wiki/features/gastos]],
[[wiki/features/clientes-proveedores]].

---

**Migraciones 376-378 — ✅ APLICADAS Y VERIFICADAS TAMBIÉN EN PROD (`jjffnbrdjchquexdfgwq`) el 2026-08-20**,
como parte del deploy de `v1.179.0` (PR #332, merge commit `7e19e7a3`) — el detalle de cada una (abajo)
quedó escrito cuando solo estaban en DEV; ver `sources/raw/project_pendientes.md` (cont. 22) para la
confirmación real post-deploy (5 funciones + 2 tablas + 3 policies verificadas con query directa a PROD).

**378 (`378_ai_memoria_listar_rpc.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y EN
PROD (`jjffnbrdjchquexdfgwq`, 2026-08-20, commit `dcccc682`, release `v1.179.0`):** fix de un hallazgo real de `code-reviewer` sobre
la mig 377 (abajo) — la EF `ai-assistant` pretendía inyectar la memoria del negocio en el prompt para
CUALQUIER rol que chatee (solo la ESCRITURA está restringida a DUEÑO/ADMIN), pero lo hacía con un `SELECT`
directo a `ai_tenant_memoria` usando la sesión real del usuario; la policy SELECT de la mig 377 solo permite
DUEÑO/ADMIN/SUPER_USUARIO, así que para cualquier otro rol (CAJERO, DEPOSITO, SUPERVISOR...) ese `SELECT`
devolvía `[]` en silencio — la memoria nunca se inyectaba para esos roles, pese a que el diseño es que se
inyecte para todos. Agrega `fn_ai_memoria_listar()` (`SECURITY DEFINER`, deriva `tenant_id` del JWT, **sin
filtro de rol** — los hechos son datos de negocio de baja sensibilidad, nunca fiscales/personales, reforzado
en la descripción del tool y en el prompt). **✅ `supabase/functions/ai-assistant/index.ts` ya llama a
`fn_ai_memoria_listar()` (ya no al `SELECT` directo) — redeployada a DEV y re-verificada con el e2e mutante
134.** Verificado además con impersonación real (`SET LOCAL ROLE` + `request.jwt.claims`, dentro de un
bloque sin commit): con la sesión de un rol no-DUEÑO/ADMIN/SUPER_USUARIO, el `SELECT` directo a la tabla
da 0 filas (RLS bloquea, como se espera) mientras que `fn_ai_memoria_listar()` da la fila real — confirma
que el fix cierra la brecha. Con esto, el hallazgo del `code-reviewer` quedó 100% resuelto, no solo
reportado.

**377 (`377_ai_tenant_memoria.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y EN PROD
(`jjffnbrdjchquexdfgwq`, 2026-08-20, commit `dcccc682`, release `v1.179.0`):** Plan IA — Fase 3 (memoria persistente por tenant), continúa la Fase 2
(mig 376). Diseño ya definido en el Artifact original del plan (2026-08-14/15): NO se guarda charla cruda —
se guardan HECHOS DESTILADOS que la IA propone guardar, con confirmación explícita del usuario en el chat
(mismo patrón de la Fase 2), y el tenant puede ver/borrar su propia memoria desde Configuración. Agrega:
1. Tabla `ai_tenant_memoria` (`tenant_id`, `hecho` texto ≤300 chars, `usuario_id`, `created_at`) — RLS:
   SELECT/DELETE para DUEÑO/ADMIN/SUPER_USUARIO del tenant (mismo patrón que `ai_config_audit`, mig 376);
   sin policy de INSERT — solo escribe la RPC.
2. RPC `fn_ai_memoria_guardar(p_hecho text)` (`SECURITY DEFINER`): deriva `tenant_id`/rol del JWT de quien
   llama (nunca parámetro), exige DUEÑO/ADMIN, valida y trunca el hecho (máximo 300 caracteres). Tope de 20
   hechos por tenant, podado dentro de la misma RPC en cada escritura (no hay `pg_cron` habilitado en este
   proyecto — sweep sincrónico, no periódico) porque la lista se inyecta COMPLETA en cada system prompt
   nuevo.

`migration-reviewer`: APTA, sin hallazgos bloqueantes. 2 sugerencias menores no bloqueantes ya aplicadas
(guard NULL explícito, tiebreaker `id DESC` en el tope de 20 para evitar no-determinismo en empates de
`created_at`). **Wiring completo (misma sesión)**: la EF `ai-assistant` y el frontend (`AiAssistant.tsx`,
`ConfigPage.tsx`) ya invocan/muestran esta capa — tool-calling de Groq (`guardar_hecho_memoria`) arma la
propuesta, tarjeta de confirmación en el chat (ícono `Brain`), y recién al confirmar se llama a
`fn_ai_memoria_guardar` con la sesión del usuario; `ConfigPage.tsx` suma la sección "Memoria del Asistente
IA" (lista/borra hechos, gateada a DUEÑO). Ver mig 378 arriba (fix, ya resuelto, de lectura para roles no
DUEÑO/ADMIN) y [[wiki/features/asistente-ia]] → "Plan IA" → Fase 3.

**376 (`376_ai_config_rpc_layer.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y EN PROD
(`jjffnbrdjchquexdfgwq`, aplicada retroactivamente el 2026-08-20 junto con 377/378 — era prerrequisito del
wiring que llegó a PROD en `v1.179.0`, no se había aplicado sola en su momento), ✅ COMMITEADA (commit
`1b5e89aa`, tag+release `v1.177.0`):** capa de RPCs para que
el Asistente IA pueda proponer/aplicar cambios de configuración con confirmación previa — Fase 2 del "Plan
IA" (memoria + configuración), continúa la Fase 1 (memoria conversacional del Asistente, sin migración,
mismo commit). Las 3 preguntas que bloqueaban el plan fueron respondidas por GO el 2026-08-20:
alcance de Fase 2 = "todo lo NO fiscal" (allowlist chico y curado hoy, no las ~190 columnas de `tenants` de
una). Agrega:
1. Tabla `ai_config_audit` (campo, valor anterior/nuevo, razón, usuario, timestamp) — RLS: SELECT solo
   DUEÑO/ADMIN/SUPER_USUARIO del propio tenant (mismo patrón que `boveda_conversiones_usd`, mig 373); sin
   policy de escritura — solo las RPCs (`SECURITY DEFINER`) insertan.
2. 3 RPCs tipadas por dato — `fn_ai_config_set_bool`/`_int`/`_text` (evita casteos dinámicos ambiguos de
   una única función "genérica"). Cada una deriva `tenant_id`/rol DEL JWT de quien llama
   (`get_user_tenant_id()`/`get_user_role()` — NUNCA como parámetro, imposible apuntar a otro tenant),
   exige rol DUEÑO o ADMIN, valida el campo contra un ALLOWLIST hardcodeado DENTRO del cuerpo de la
   función (ampliarlo es siempre una migración nueva, auditable en git — no una tabla editable), y escribe
   en `ai_config_audit`.
3. **Allowlist inicial: 6 campos NO fiscales de `tenants`** que ya tienen su propio handler de 1-campo en
   `ConfigPage.tsx` (mismo patrón replicado server-side, no abre capacidad de escritura nueva):
   `wms_reabastecimiento_on_demand`, `wms_reabastecimiento_umbral` (boolean), `pedido_manual_habilitado`,
   `pedido_cierre_automatico` (boolean), `repositor_etiquetas_por_hoja` (integer), `pedido_numeracion`
   (text). Cero campos fiscales/AFIP/contables.

`migration-reviewer`: APTA, sin hallazgos bloqueantes. 4 notas 🟡 no bloqueantes documentadas para cuando
se conecte la IA de verdad (Fase 3 del plan): capturar `check_violation` con un mensaje lindo en vez del
error crudo de Postgres (ej. `repositor_etiquetas_por_hoja` fuera de {4,6,12}); TOCTOU menor entre el
SELECT y el UPDATE (solo afectaría el campo `valor_anterior` del audit log en una carrera extrema, nunca
el valor final escrito); falta `COMMENT ON` en tabla/funciones; falta guard explícito de `p_valor IS
NULL`. Verificado con 4 tests reales en DEV (impersonación vía `set_config('request.jwt.claims', ...)`
dentro de bloques `DO $$` sin COMMIT, confirmado con `SELECT` posterior que nada persistió): (1) caso feliz
cambia el campo y devuelve valor anterior/nuevo correctos; (2) campo NO allowlisted (`cuit`) rechazado; (3)
rol sin permiso (SUPERVISOR) rechazado aunque el campo esté permitido; (4) valor fuera de dominio
(`repositor_etiquetas_por_hoja=7`, fuera de {4,6,12}) frenado por un `CHECK` YA EXISTENTE en la tabla
`tenants` (no hizo falta agregar nada nuevo). **✅ Wiring completo (sesión siguiente, misma jornada
2026-08-20, ✅ COMMITEADA `v1.178.0`, commit `3fb956f8`)**: la EF `ai-assistant` y el frontend
(`AiAssistant.tsx`) ya invocan estas RPCs — tool-calling de Groq arma la propuesta, tarjeta de confirmación
en el chat, y recién al confirmar se llama a la RPC real con la sesión del usuario. Continúa con la Fase 3
(memoria persistente, migs 377-378, arriba). Ver [[wiki/features/asistente-ia]] → "Plan IA — memoria +
configuración con confirmación".

**375 (`375_caja_usd_fase6_devoluciones_nc.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), COMMITEADA Y PUSHEADA a `origin/dev` (commit
`e55a1009`, tag `v1.175.0`), **EN PROD desde 2026-08-20** (PR #331 mergeado a `main`, merge commit
`4dbe7fdb2c59c34a58fc6896c879f93f549178ab`):** Fase 6 ("Devoluciones/NC con
soporte USD") del plan Caja USD (relevamiento G5). Continúa la Fase 5 (migs 373+374, ya
commiteada/pusheada, tag `v1.174.0`). Puramente aditiva, sin funciones/triggers/vistas nuevas — los
`caja_movimientos` que este flujo inserta ya quedan protegidos por los triggers
`fn_validar_moneda_coincide_sesion` (mig 372) y `fn_validar_moneda_coincide_cuenta_origen` (mig 373), que
se disparan sobre cualquier INSERT a esa tabla sin filtrar por origen. Agrega:
1. `tenants.reintegro_usd_cotizacion_original boolean NOT NULL DEFAULT false` — toggle de **G1** (qué
   cotización usa el reintegro en caja de una devolución vía "Efectivo USD": la de hoy por default, o la
   de la venta original si se activa).
2. `devoluciones.monto_usd numeric(14,2)` + `devoluciones.cotizacion_usd_usada numeric(14,4)` — auditoría
   de cuánto USD real se devolvió y con qué cotización; NULL en ambas si la devolución no tuvo componente
   USD.
3. `CHECK devoluciones_usd_ambos_o_ninguno` — exige que las 2 columnas de arriba vayan siempre juntas
   (ambas NULL, o ambas presentes y positivas).

**🐛 Bug real encontrado y corregido en DEV, antes de commitear**: la primera versión del CHECK usaba
`monto_usd > 0 AND cotizacion_usd_usada > 0` sin `IS NOT NULL` explícito — en SQL de 3 valores, comparar
contra NULL da NULL (no `false`), y un CHECK trata NULL como "la fila pasa" (no como rechazo). El
constraint NO rechazaba una fila con solo una de las 2 columnas cargada — exactamente el gap que debía
cerrar. Detectado corriendo 4 INSERTs reales dentro de una transacción con `ROLLBACK` en DEV (no se asumió
que el CHECK funcionaba, se probó). Corregido agregando `IS NOT NULL` explícito en cada rama del CHECK y
reverificado con los mismos 4 tests — los 4 dieron el resultado esperado. La migración aplicada en DEV ya
tiene la versión corregida.

**G2 del relevamiento** (la NC AFIP usa la cotización de la venta original, no la del momento de la
devolución) se investigó a fondo y se confirmó **YA correcta por construcción** en el código existente
(`devolucion_items.precio_unitario` se copia de `venta_items.subtotal/cantidad`, fijo en pesos desde la
venta original, nunca recalculado) — no hizo falta ningún cambio de lógica en `emitir-factura`, solo
comentarios documentando el invariante. Verificado en DEV con INSERTs reales en transacciones con
`ROLLBACK`: default `false` correcto para tenants existentes, CHECK funcionando en sus 4 combinaciones.
Código: `src/lib/ventasValidation.ts` (`elegirCotizacionReintegro`, 5 tests) + `VentasPage.tsx`
(devolución con Caja USD paralela) + `ConfigPage.tsx` (toggle) + `emitir-factura/index.ts` (solo
comentarios). `migration-reviewer`: 3 notas menores, ninguna bloqueante. Ver [[wiki/features/devoluciones]]
→ "Caja en USD — Fase 6 de 8".

**374 (`374_vw_boveda_cuentas_security_invoker.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), COMMITEADA Y PUSHEADA a `origin/dev` (commit
`28d9291e`, tag `v1.174.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):** cierra un
"Security Definer View" PRE-EXISTENTE en `vw_boveda_cuentas`, hallazgo real ocurrido al tocar esa vista
durante la Fase 5 de Caja USD (mig 373, ver abajo). El advisor de seguridad de Supabase (`get_advisors`,
nivel ERROR) marcó que la vista corre con los privilegios de su DUEÑO (comportamiento default de toda vista
en Postgres sin `security_invoker`) en vez de los del usuario que consulta — es decir, **ignora el RLS** de
`cuentas_origen`/`caja_movimientos`. Riesgo real: cualquier usuario autenticado (de cualquier tenant) que
consultara `/rest/v1/vw_boveda_cuentas` sin el filtro `?tenant_id=eq....` que sí aplica `CajaPage.tsx`
podría leer nombres de cuenta y saldos de la Bóveda de OTROS tenants. Confirmado **PRE-EXISTENTE**: la
definición en `schema_full.sql` de antes de esta sesión ya no tenía `security_invoker`, y `CREATE OR
REPLACE VIEW` no lo agrega ni lo quita solo — la mig 373 no lo introdujo, solo lo hizo visible al re-crear
la vista con otro `WHERE`. Fix: `ALTER VIEW public.vw_boveda_cuentas SET (security_invoker = true)` —
verificado antes de aplicar que ambas tablas base tienen RLS habilitado con policy propia.
`migration-reviewer`: APTA. Ver [[wiki/features/caja]] → "Caja en USD — Fase 5 de 8".

**373 (`373_caja_usd_fase5_boveda.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y PROD
(`jjffnbrdjchquexdfgwq`), COMMITEADA Y PUSHEADA a `origin/dev` (commit `28d9291e`, tag `v1.174.0`), **EN
PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`; en PROD aplicó limpio — la vez que había
fallado por el conflicto de índice único fue en DEV, ver punto 5 abajo, y el archivo del repo ya tenía la
versión corregida):** Fase 5
("Bóveda ARS/USD") del plan Caja USD
(relevamiento G5). Continúa la Fase 4 (mig 372, ya commiteada/pusheada, tag `v1.173.0`). Con esta fase, **la
Bóveda deja de asumir 1 sola fila por tenant** — pasa a tener 2 (ARS y USD, pestañas separadas en la UI).
Agrega:
1. `fn_seed_tenant_defaults()` (`CREATE OR REPLACE`) — siembra "Efectivo USD" (`cuentas_origen`) para
   tenants nuevos, dormida en $0, junto a "Efectivo" (ARS).
2. `fn_crear_caja_fuerte()` (`CREATE OR REPLACE`) — siembra "Caja Fuerte USD" (`cajas.es_caja_fuerte=true,
   moneda='USD'`) para tenants nuevos, también dormida en $0.
3. **Backfill para los 10 tenants existentes en DEV** — verificado con query real: los 10 quedaron con
   "Efectivo USD" y "Caja Fuerte USD" sembradas.
4. `vw_boveda_cuentas` (`CREATE OR REPLACE VIEW`) — corrige un fallback de atribución que se volvió
   ambiguo al haber 2 cuentas `tipo='efectivo'` por tenant (ahora cruza también por `moneda`, no solo
   `tenant_id`) — sin este fix, un movimiento en USD sin `cuenta_origen_id` explícito podía atribuirse a la
   cuenta Efectivo ARS (o viceversa) según el orden no determinístico de un `LIMIT 1` sin `ORDER BY`.
5. **Cambio de constraint real, descubierto porque la migración FALLÓ al aplicar por primera vez**: el
   índice único parcial `uq_cuentas_origen_efectivo_por_tenant` (mig 137, "1 sola cuenta efectivo POR
   TENANT") bloqueaba directamente la 2da cuenta "Efectivo USD". Reemplazado por
   `uq_cuentas_origen_efectivo_por_tenant_moneda`, scopeado a `(tenant_id, moneda)` — preserva la intención
   original (evitar ambigüedad) pero ahora permite 1 cuenta efectivo POR MONEDA.
6. Trigger nuevo `fn_validar_moneda_coincide_cuenta_origen` (`BEFORE INSERT OR UPDATE OF moneda,
   cuenta_origen_id ON caja_movimientos`) — defensa en profundidad complementaria a
   `fn_validar_moneda_coincide_sesion` (mig 372, valida movimiento vs. sesión); este valida movimiento vs.
   `cuenta_origen_id` — rechaza un movimiento cuya `moneda` no coincida con la de su cuenta de origen.
7. Tabla nueva `boveda_conversiones_usd` (auditoría de la conversión USD↔$: `sentido`, `monto_origen`,
   `monto_destino`, `cotizacion_usada`, `usuario_id`, `movimiento_origen_id`/`movimiento_destino_id`) — RLS
   calcada del patrón de `boveda_retiros` (DUEÑO/ADMIN/SUPER_USUARIO a nivel DB; la restricción "solo
   DUEÑO" de F2 del relevamiento es de producto/UI, no de aislamiento de datos).

`migration-reviewer` revisó la migración **antes de aplicar**: la primera versión tuvo **2 hallazgos
bloqueantes reales** (columnas inexistentes copiadas mal en `fn_seed_tenant_defaults`, y
`fn_crear_caja_fuerte` basada en una versión vieja sin `search_path`), corregidos y re-revisados como APTA.
Verificada en DEV con 4 tests manuales reales (INSERT dentro de transacciones con `ROLLBACK`, sin dejar
datos): movimiento con moneda≠cuenta rechazado, movimiento con moneda≠sesión rechazado, movimiento con todo
coincidente permitido, 2da cuenta efectivo misma moneda rechazada por el índice único.

**Código cableado**: `src/lib/cajaBoveda.ts` (nuevo) — `calcularConversionUsd()` (función pura, 7 tests
`BOV-CNV-01` a `07`: USD→$ usa la cotización de COMPRA, $→USD usa la de VENTA, sin redondeo — J1) +
`ensureFuerteSesionId()` (helper async compartido, reemplaza 4 bloques duplicados que nunca stampeaban
`moneda` al crear la sesión permanente de la bóveda). `src/lib/cajaPermisos.ts` suma
`convertir_usd_boveda`, solo `['DUEÑO']`. `src/pages/CajaPage.tsx`: `bovedaTab: 'ARS'|'USD'`,
`cajaFuerteArs`/`cajaFuerteUsd` derivados de `cajas`, `cajaFuerte` pasa a depender de la pestaña activa
(vuelve moneda-aware TODA la lógica preexistente de Bóveda con un cambio mínimo), mutation
`convertirUsdBoveda` + modal nuevo, campo de clave maestra condicional en "Extraer dinero" (F3), se
levantan los bloqueos "todavía no soporta Caja USD" que había puesto la Fase 3.
`src/components/NotificacionesButton.tsx`: `aprobarSolicitudCajaFuerte` ya no rechaza en bloque solicitudes
en USD. `src/pages/GastosPage.tsx`: `sesionFuerte` filtra explícitamente `moneda==='ARS'`.

**🐛 2 bugs reales encontrados y corregidos antes de commitear**: (1) la auto-selección de caja al entrar
al tab "Caja" usaba `cajasAbiertas[0]` sin excluir la Caja Fuerte — con 2 Cajas Fuerte permanentemente
abiertas el riesgo de operar sobre ella por accidente se duplicó; fix: filtra contra `cajasOperativas`. (2)
el selector "Cuenta de destino" de "Ingresar a Caja Fuerte" no filtraba por moneda — podía dejar plata
huérfana sin contraparte (egreso commiteado, ingreso rechazado por el trigger nuevo); fix: filtra por la
moneda de la pestaña activa. También ~8 lugares con bug de visualización (símbolo de moneda del tenant en
vez de la moneda real de la cuenta/caja fuerte mostrada).

Typecheck + build + suite completa de tests verdes (100 archivos, 1600 tests). UAT nuevos: `CAJ-37` a
`CAJ-40` (`tests/specs/uat-modo-basico.md`). Ver [[wiki/features/caja]] → "Caja en USD — Fase 5 de 8".

> **Limitaciones conocidas, documentadas y NO resueltas**: el guard de F3 (clave maestra) y la restricción
> "solo DUEÑO" de la conversión son 100% client-side hoy (sin RPC `SECURITY DEFINER` que las revalide en
> DB — mismo patrón preexistente que `verificar_clave_maestra` en otras partes del módulo, no una regresión
> de esta fase). `schema_full.sql` sigue sin regenerar (bug del pooler Supavisor + falta
> `SUPABASE_ACCESS_TOKEN` en esta sesión). Hallazgo PRE-EXISTENTE sin tocar: la Caja Fuerte "primaria" de
> un tenant nace con `cajas.moneda='ARS'` hardcodeado (no `COALESCE(tenant.moneda,'ARS')` como sí hace
> "Efectivo") — bug latente más amplio de la Bóveda multi-moneda, fuera del alcance G5. Hallazgo
> PRE-EXISTENTE sin tocar: migración `368b_fix_acentos_fn_seed_tenant_defaults` aplicada a DEV sin archivo
> local commiteado (drift real, sin riesgo de regresión verificado).

**Fase 5 de Caja USD (G5) queda 100% completa** (migs 373+374), sumada a las Fases 1+2+3+4 (migs 368-372) —
el proyecto completo (Fases 1+2+3+4+5 de 8) está 100% en DEV. **Estado real: migs 373+374 aplicadas y
verificadas en DEV, COMMITEADAS Y PUSHEADAS a `origin/dev`** (commit `28d9291e`, tag+release `v1.174.0`
publicados). Próximo paso: Fase 6 (Devoluciones/NC — sin puntos abiertos propios).

**372 (`372_caja_usd_fase4_pago_combinado.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código COMMITEADO Y PUSHEADO a `origin/dev`
(commit `d783727d`, tag `v1.173.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):**
Fase 4 ("venta con pago combinado
ARS+USD") del plan Caja USD (relevamiento G5). Continúa la Fase 3 (mig 371, ya commiteada/pusheada como
tag `v1.172.0`). Agrega **2 triggers** `fn_validar_moneda_coincide_sesion` (sobre `caja_movimientos` y
`caja_arqueos`) que rechazan cualquier movimiento/arqueo cuya `moneda` no coincida con la moneda real de
su sesión de caja (`caja_sesiones.moneda`, inmutable desde que se abre — mig 368) — red de seguridad
server-side, ya que con esta fase hay MUCHOS más lugares del código (`VentasPage.tsx`) escribiendo
`moneda` en cada movimiento, no solo `CajaPage.tsx` (Fase 3). No hizo falta ningún cambio de esquema para
la funcionalidad en sí — los campos ya existían desde mig 368 (`metodos_pago.moneda`/`es_efectivo`) y mig
370 (`productos.acepta_cualquier_moneda`, `ventas.cotizacion_usd`).

Una revisión de esta migración auditó TODOS los insert-sites de `caja_movimientos`/`caja_arqueos` en todo
el repo (no solo lo tocado en esta sesión) y confirmó: cero riesgo para tenants reales hoy (ninguno tiene
Caja USD en producción de datos), pero encontró **2 gaps preexistentes de REGLA #0 en `GastosPage.tsx`**
(3 movimientos de caja fire-and-forget sin `await`/`toast`, corregidos en esta misma sesión) y un **picker
de caja en Gastos que no filtraba por moneda** (también corregido: ahora excluye Cajas USD, mismo patrón
que Ventas).

**Código — el corazón de la fase, `src/pages/VentasPage.tsx` (el checkout completo del POS):**
- **D2** — nuevo campo opcional `MedioPagoItem.montoUsd` (`src/lib/ventasValidation.ts`): para un método
  de pago "efectivo + USD" (ej. "Efectivo USD", ahora creable desde Config → Ventas → Métodos de pago, que
  hasta esta fase nunca exponía los campos `moneda`/`es_efectivo` en su UI de alta/edición pese a existir
  desde mig 368), el cajero tipea dólares en un input dedicado; el campo `monto` de siempre sigue siendo
  el equivalente en ARS (`montoUsd × cotización vigente`) — `calcularVuelto`/`calcularEfectivoCaja`/
  `validarMediosPago` siguen funcionando exactamente igual, sin cambios.
- **D3** — nueva función pura `calcularEfectivoPorMoneda` (`ventasValidation.ts`, 7 tests nuevos) que
  separa el efectivo cobrado en `{ arsNeto, usdIngreso, vueltoArs }`. Regla D1: el vuelto de un pago en
  USD SIEMPRE se da en pesos — los dólares físicos recibidos van siempre completos a la sesión USD (nunca
  se "netean" contra el vuelto); si hay sobrepago, el vuelto sale siempre en pesos de la sesión ARS
  (puede quedar en EGRESO neto aunque el sobrante haya venido de dólares).
- **Selector de caja doble** (`sesionesArs`/`sesionesUsd`, filtradas por la moneda real de cada sesión) —
  para el 100% de tenants sin Caja USD real, `sesionesArs` es idéntico al array de siempre.
- **A2 gana su primer consumidor real**: `carritoAceptaUsd` — un producto solo puede cobrarse en USD si
  `moneda_venta='usd'` o tiene `acepta_cualquier_moneda=true`; si cualquier línea del carrito no cumple
  ninguna, la venta se bloquea para cobro en USD.
- **`ventas.cotizacion_usd` finalmente se escribe** (columna de la Fase 1, nunca usada hasta ahora):
  snapshot interno cuando la venta involucró conversión real de USD — NUNCA va a AFIP. Base para que la
  Fase 6 (NC) use la cotización de la venta original (G2).
- **🐛 Bug real encontrado y corregido por code-review antes de commitear**: cambiar el `<select>` de un
  medio de "Efectivo" a "Efectivo USD" (o viceversa) dejaba el monto viejo en el campo equivocado — la
  venta pasaba todas las validaciones pero no acreditaba nada en NINGUNA caja. Corregido en 2 capas:
  cambiar el tipo de medio resetea el monto, y `registrarVenta` bloquea si detecta un medio USD con monto
  sin su contraparte en dólares (defensa en profundidad) + guard si falta cargar la cotización.
- **Completar una reserva (seña/saldo) en USD — explícitamente NO soportado en esta fase**: ese flujo
  reusa un picker de medios de pago genérico sin el input especial de dólares; se agregó un guard
  explícito que bloquea con mensaje claro pidiendo usar el POS principal (alcance reducido, documentado).

`migration-reviewer`: APTA, con la auditoría completa de insert-sites descripta arriba. Revisión de código
completa del diff de `VentasPage.tsx`/`ConfigPage.tsx`/`GastosPage.tsx`: encontró el bug de arriba (ya
corregido) + los 2 gaps de Gastos (ya corregidos). Typecheck + build + suite completa de tests verdes
(incluye 7 tests nuevos de `calcularEfectivoPorMoneda` + 6 de `carritoAceptaUsd`). UAT nuevos: `VEN-37` a
`VEN-43` (`tests/specs/uat-modo-basico.md`). Ver [[wiki/features/caja]] → "Caja en USD — Fase 4 de 8" y
[[wiki/features/ventas-pos]] → "Pago combinado ARS+USD".

**Fase 4 de Caja USD (G5) queda 100% completa** (mig 372), sumada a las Fases 1+2+3 (migs 368-371) — el
proyecto completo (Fases 1+2+3+4 de 8) está 100% en DEV. **Estado real: mig 372 aplicada y verificada en
DEV, código COMMITEADO Y PUSHEADO a `origin/dev`** (commit `d783727d`, tag `v1.173.0`).
**Fase 5 (Bóveda por moneda — pestañas ARS/USD, conversión USD↔$, retiro de Caja USD sin destino con clave
maestra) ya la completa — ver migs 373+374 arriba.**

**371 (`371_caja_usd_fase3_ciclo_operativo.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código COMMITEADO Y PUSHEADO a `origin/dev`
(commit `010440cd`, tag `v1.172.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):**
Fase 3 ("ciclo operativo") del plan
Caja USD (relevamiento G5). Continúa la Fase 2 (mig 370, ya commiteada/pusheada). Agrega **2 triggers**
(sin cambios de schema — solo funciones + triggers):
- `fn_validar_traspaso_misma_moneda` (`BEFORE INSERT ON caja_traspasos`) — bloquea un traspaso entre 2
  sesiones de caja de distinta moneda (F1 del relevamiento: antes se podía traspasar "100" de una caja
  ARS a una USD y acreditar 100 dólares directamente, un bug de integridad latente). El código cliente
  (`CajaPage.tsx`: `realizarTraspaso` + el selector del modal) ya filtraba/validaba esto, pero REGLA #0
  pide guard server-side además de la UI.
- `fn_validar_rol_opera_caja_usd` (`BEFORE INSERT ON caja_sesiones`) — bloquea abrir una sesión en una
  caja `moneda='USD'` si el rol de quien la abre no es DUEÑO ni está en `tenants.caja_usd_roles_permitidos`
  (mig 370, I1 del relevamiento). DUEÑO siempre puede — mismo criterio aditivo que
  `cotizacion_usd_roles_permitidos`.

Verificado con tests manuales reales en DEV (INSERT dentro de transacciones con `ROLLBACK`, sin dejar
datos): ARS→USD rechazado con `P0001 No se puede traspasar entre cajas de distinta moneda`, ARS→ARS
permitido; CAJERO rechazado con `P0001 Tu rol no tiene permiso para operar una Caja USD`, DUEÑO permitido.
Para el 100% de cajas ARS (todo tenant real hoy) ambos triggers cortan temprano sin tocar nada — cero
impacto en el flujo actual. Existe 1 caja de prueba real en DEV con `moneda='USD'` (tenant "Almacén
Jorgito"), creada durante el desarrollo de este feature.

**Código cableado** (`src/pages/CajaPage.tsx`): fix del bug de formato — nueva `formatMonedaCaja` usa la
moneda REAL de la caja/sesión activa en vez de `tenant.moneda` (E1); conteo por denominación de billete
USD para Arqueo/Cierre — componente nuevo `src/components/ConteoDenominaciones.tsx` + lógica pura
`src/lib/cajaArqueo.ts` (`sumaDenominaciones`, `DENOMINACIONES_USD`, E2/J2, 6 tests nuevos); umbral de
diferencia propio en USD al cerrar (E3); guard cliente de traspaso cross-moneda + selector filtrado (F1);
`puedeOperarCajaUsd` filtra el picker de cajas operativas (I1); moneda stampeada en cada
movimiento/sesión/arqueo nuevo (activa de verdad las columnas de la Fase 1). 2 hallazgos de code-review
corregidos en la misma sesión: Bóveda excluye Cajas USD como origen/destino; "Abrir caja para" (A2) respeta
el permiso de Caja USD.

`migration-reviewer`: APTA, sin hallazgos bloqueantes. Revisión de código completa del diff de
`CajaPage.tsx`: sin hallazgos 🔴 (los 2 🟡 arriba ya corregidos). Typecheck + build + suite completa de
tests verdes. UAT nuevos: `CAJ-31` a `CAJ-36` (`tests/specs/uat-modo-basico.md`). Ver [[wiki/features/caja]]
→ "Caja en USD — Fase 3 de 8".

**Fase 3 de Caja USD (G5) queda 100% completa** (mig 371), sumada a las Fases 1+2 (migs 368-370) — el
proyecto completo (Fases 1+2+3 de 8) está 100% en DEV. **Estado real: mig 371 COMMITEADA Y PUSHEADA a
`origin/dev` (commit `010440cd` + bump `56f48fe8`), tag+release `v1.172.0` publicados**, corrigiendo el
estado "TODAVÍA SIN COMMITEAR" con el que se documentó esta sección originalmente. Fase 4 (mig 372, ver
arriba) ya está completa también, en una tanda posterior.

**370 (`370_caja_usd_fase2_permisos_config.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código COMMITEADO Y PUSHEADO a `origin/dev`
(commit `310d9b3b`, tag `v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):**
Fase 2 ("permisos y configuración") del plan Caja USD (relevamiento G5).
Aditiva, 100% retro-compatible — solo agrega columnas de configuración, ningún comportamiento cambia salvo
el gate de rol descripto abajo. Agrega a `tenants`: `cotizacion_usd_compra` (pata de compra que la API ya
devolvía y se descartaba), `cotizacion_usd_casa` (qué casa blue/oficial/bolsa/cripto se usó la última
vez), `cotizacion_usd_roles_permitidos` (jsonb, roles ADICIONALES a DUEÑO que pueden elegir tipo de
cotización o cargar manual — DUEÑO siempre puede), `caja_usd_roles_permitidos` (jsonb, mismo patrón para
quién podrá operar la futura Caja USD), `diferencia_caja_umbral_usd` (umbral de arqueo propio en USD,
separado del de pesos), `caja_usd_clave_maestra_umbral` (umbral USD para exigir clave maestra — el campo
nace acá, el enforcement real es Fase 5). Agrega a `productos`: `acepta_cualquier_moneda` (boolean,
default `false`) — checkbox "puede cobrarse en cualquier moneda" (A2 del relevamiento), independiente de
`moneda_venta`; solo se persiste en esta fase, el cobro mixto real es Fase 4 (sin construir).

**Código cableado**: `src/hooks/useCotizacion.ts` gana el gate de rol (DUEÑO siempre + roles habilitados
pueden elegir tipo/cargar manual, el resto solo "refresca" repitiendo la última casa) implementado **en el
hook** (defensa en profundidad, no solo la UI); ahora guarda compra+venta+casa (antes solo venta).
`src/components/CotizacionWidget.tsx` respeta el gate. `src/lib/cajaPermisos.ts` suma `rolEnLista()`
genérica (roles fijos + `custom:<id>`), reusada por `accedeABoveda` sin cambiar su comportamiento
(verificado). `src/pages/ProductoFormPage.tsx` cablea el checkbox en los 4 puntos (estado inicial, carga,
creación/edición, duplicar). `src/pages/ConfigPage.tsx` suma la sección "Caja en Dólares" (tab Negocio).

`migration-reviewer`: APTA, sin hallazgos bloqueantes. `code-reviewer`: OK para commitear, sin hallazgos
🔴 (2 mejoras de forma ya aplicadas: `setTenant` alineado al patrón `.select().single()`, y UAT).
Verificado con `information_schema.columns` (las 7 columnas nuevas, tipo/nullable/default correctos).
Typecheck + build + suite completa (99 archivos, 1574 tests) verdes. UAT nuevos: `PRD-20`/`CAJ-30`. Ver
[[wiki/features/caja]] → "Caja en USD — Fase 2 de 8" y [[wiki/features/productos]].

**Fase 2 de Caja USD (G5) queda 100% completa** (mig 370), sumada a la Fase 1 (migs 368+369) — el proyecto
completo (Fases 1+2 de 8) está 100% en DEV. Próximo paso: Fase 3 (ciclo operativo moneda-aware en
`CajaPage.tsx`).

**369 (`369_caja_usd_fase1_es_efectivo_consumidores.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código COMMITEADO Y PUSHEADO a `origin/dev`
(commit `310d9b3b`, tag `v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):**
cierra la Fase 1 de Caja USD.
Cablea los 4 consumidores server-side/cliente que comparaban el string hardcodeado `'Efectivo'` a leer
`metodos_pago.es_efectivo` (mig 368) — `fn_pedido_generar_venta`, `marcar_envios_pagados`,
`registrar_pago_oc` (`CREATE OR REPLACE`, esta migración) + `ventasValidation.ts`/`VentasPage.tsx`/
`GastosPage.tsx` (mismo cambio del lado cliente, aplicado en la misma sesión, sin migración porque es
solo TS). Comportamiento IDÉNTICO a hoy para todo tenant existente — el backfill de la mig 368 garantiza
`es_efectivo=true` únicamente para el método literalmente llamado 'Efectivo'. `migration-reviewer`: APTA,
0 diferencias línea por línea contra las funciones originales salvo el cambio semántico pedido, sin
pérdida de tildes (se verificó explícitamente después del incidente de la mig 368). Typecheck + build +
`tests/unit/ventasValidation.test.ts` (40/40, 6 casos nuevos de `mediosEfectivo`) verdes.

**Fase 1 de Caja USD (G5) queda 100% completa** (migs 368+369): moneda real en caja/sesiones/arqueos,
cotización snapshot en ventas, y "efectivo real" generalizado de extremo a extremo (frontend + backend).
Próximo paso: Fase 2 (permisos y configuración).

**368 (`368_caja_usd_fase1_cimientos.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código COMMITEADO Y PUSHEADO a `origin/dev`
(commit `310d9b3b`, tag `v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):**
Fase 1 ("cimientos de datos")
del plan Caja USD (relevamiento G5, ver `wiki/development/reglas-negocio.md`). Solo schema, sin cablear
todavía ninguna pantalla/RPC a comportarse distinto — aditiva y retro-compatible al 100%. (1) Agrega
`moneda text NOT NULL DEFAULT 'ARS'` a `caja_sesiones`/`caja_movimientos`/`caja_arqueos`, denormalizado
desde `cajas.moneda` para que quede inmutable en el histórico. (2) Agrega `ventas.cotizacion_usd
numeric(14,2)` (snapshot interno, nunca va a AFIP). (3) Agrega `metodos_pago.es_efectivo boolean`/
`moneda text` — generaliza el string hardcodeado `'Efectivo'` que hoy comparan `ventasValidation.ts` y 3
RPC (`fn_pedido_generar_venta`, `registrar_pago_oc`, `marcar_envios_pagados`) a una lista explícita
atada a moneda (A3 del relevamiento). Backfill `es_efectivo=true WHERE nombre='Efectivo'` — verificado
con query real que TODOS los tenants (8 en DEV, 5 en PROD) usan ese nombre exacto, sin variantes de case,
antes de aplicar el backfill. `fn_seed_tenant_defaults` actualizada para setear ambas columnas en el alta
de tenants nuevos. `migration-reviewer`: APTA, sin hallazgos bloqueantes.

> 🔤 **Nota operativa**: la primera aplicación de esta migración perdió los acentos del español al
> retranscribir el `CREATE OR REPLACE FUNCTION` a mano (quedó "Devolucion"/"debito" sin tilde) — se
> detectó con una verificación explícita post-aplicación y se corrigió en el momento con un segundo
> `apply_migration`. El archivo del repo siempre tuvo el texto correcto. Ver
> `feedback_apply_migration_acentos_transcripcion` en memoria — copiar el contenido exacto del archivo,
> nunca retipear SQL con tildes/ñ a mano.

**✅ Consumidores cableados en la mig 369** (ver arriba) — Fase 1 completa.

**367 (`367_producto_moneda_costo_y_tier_usd.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código COMMITEADO Y PUSHEADO a `origin/dev`
(commit `310d9b3b`, tag `v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):**
fix de 2 bugs reales de
moneda reportados por Fede en la ficha de Producto. (1) Agrega `productos.moneda_costo`/
`precio_costo_usd` — mismo patrón exacto que `moneda_venta`/`precio_usd` (mig 161), pero para el
costo. Cierra un bug real de PERSISTENCIA: el toggle "Ingresar en USD" de costo/venta vivía en
`useState` efímero, nunca guardaba que el origen era USD — al reabrir la ficha el monto USD original
se perdía para siempre. (2) Agrega `'usd'` al CHECK `producto_precios_mayorista_tipo_valor_chk` (antes
solo `precio_fijo`/`pct`) y actualiza `fn_precio_venta_efectivo` (espejo SQL de `src/lib/tiers.ts`) para
convertir un tier `usd` a la cotización vigente del tenant. `migration-reviewer`: APTA, sin hallazgos
bloqueantes (sugirió coordinar el PR de frontend, que se aplicó en la misma sesión). Verificado:
typecheck + build + `tests/unit/tiers.test.ts` (33/33, incluye 6 casos nuevos de `tipo_valor='usd'`)
verdes. Ver `wiki/features/productos.md` y `wiki/features/precios-tiers-empaque.md`.

> ⚠️ **Hallazgo aparte, NO resuelto en esta migración** (ver nota completa en `wiki/features/
> productos.md`): las columnas `precio_costo_moneda`/`precio_venta_moneda` (mig 007) son un
> mecanismo huérfano — solo las usa el importador CSV, guardando el monto SIN convertir; ningún otro
> consumidor de `precio_costo`/`precio_venta` respeta esa columna. Si algún tenant real importó
> productos así, su margen/reportes están silenciosamente mal calculados. Pendiente decisión de GO.

**Total al 2026-08-20:** 378 archivos de migración + 086b correctivo (algunos números salteados por
PRs descartados; la tabla de abajo no está estrictamente ordenada — se agrega al final de cada tanda de
sesión). **Migraciones 001-359 aplicadas tanto en DEV (`gcmhzdedrkmmzfzfveig`) como en PROD
(`jjffnbrdjchquexdfgwq`)** — las 352-357 (módulo Repositores) deployadas a PROD el 2026-08-12 (v1.168.0,
PR #328); **358 (hard delete de tenant con grace period) y 359 (NC electrónica AFIP automática)
deployadas a PROD el 2026-08-13 (v1.170.0, PR #330)**, verificado con `gh release view v1.170.0` +
migraciones 358/359 confirmadas aplicadas contra el proyecto PROD. **v1.169.0 (2026-08-13, PR #329) no
había agregado ninguna migración nueva** — quedó entre la 357 y la 358 sin cambios de DB.
**🚀 360-375 (fix de sincronización Pedido↔Envío entregado, auditoría de performance/seguridad —
361-366—, 2 bugs de moneda en Producto —367—, y Caja USD Fases 1 a 6 —368-375—) están APLICADAS Y
VERIFICADAS TANTO EN DEV COMO EN PROD desde el 2026-08-20** — código commiteado en `dev` en 5 tandas: 360-370
en commit `310d9b3b` + bump `0b4d431a` (tag+release `v1.171.0`); 371 en commit `010440cd` + bump `56f48fe8`
(tag+release `v1.172.0`); 372 en commit `d783727d` + bump `05801eb4` (tag+release `v1.173.0`); 373-374 en
commit `28d9291e` (tag+release `v1.174.0`); 375 en commit `e55a1009` (tag+release `v1.175.0`) — y las 16
migraciones aplicadas a PROD el 2026-08-20, en orden, cada una confirmada con `apply_migration` exitoso
(`{"success":true}`) y re-verificadas con `list_migrations` al final; ninguna falló (la 373, que en su
momento había fallado una vez en DEV por el conflicto de índice único descrito en su propia entrada más
abajo, aplicó limpia en PROD porque el archivo del repo ya tenía la versión corregida). Inmediatamente
después, **PR #331** (`dev`→`main`, "v1.176.0 — Auditoría performance/calidad + Caja USD (Fases 1-7/8)") se
mergeó a `main` — merge commit `4dbe7fdb2c59c34a58fc6896c879f93f549178ab`, confirmado con
`gh pr view 331 --json state,mergedAt,mergeCommit` → `state: MERGED`. **Security advisor de PROD
post-migración** (`get_advisors` tipo security): 0 hallazgos ERROR, 135 WARN (baseline preexistente del
proyecto, no introducidos por este deploy), y 1 hallazgo INFO nuevo esperado (`emision_factura_locks` con
RLS habilitada pero sin policies — intencional, deny-by-default, documentado en el comentario de la propia
migración 361: la Edge Function siempre usa `service_role`, que bypassea RLS). **Vercel**: el deployment de
producción (`dpl_EeGQQQUnbbEuCwqd5Xw8xhC8c9XM`, target=production, commit `4dbe7fdb`) **✅ CONFIRMADO READY**
(build de ~96s, `app.genesis360.pro` sirviendo el commit actual). Verificado contra datos reales de PROD:
8 tenants existentes con "Caja Fuerte USD"/"Efectivo USD" sembrados (backfill mig 373), 0 ventas con
componente USD — sin cambio de comportamiento para tenants existentes. El resto de este
bloque describe el detalle técnico de cada una, incluyendo texto histórico
("SIN COMMITEAR"/"NO en PROD") que
reflejaba el estado AL MOMENTO de escribirse cada entrada — ya no es el estado actual, ver arriba (cada
header individual de 360 a 375 ya fue corregido a "EN PROD desde 2026-08-20"). **363-365
habían quedado escritas y revisadas pero SIN APLICAR por una desconexión del MCP de Supabase a mitad de
una sesión anterior (bloqueante técnico real, no una decisión de diseño) — con el MCP reconectado se
aplicaron y verificaron en esa sesión, junto con la 366 nueva.** **361 y 362 cierran 2 hallazgos 🛑
CRÍTICO (REGLA #0) de una auditoría general de performance/calidad pedida por GO; 363-365 cierran el
resto del top5 de esa misma auditoría (backend ítems #3-#5); 366 cierra el único hallazgo backend "DONE"
del resto del reporte original de esa auditoría (los demás hallazgos quedaron diferidos con razón
documentada o confirmados que no eran un bug — ver
`sources/raw/project_pendientes.md` "ARRANCÁ ACÁ", cont. 8, y `log.md`)** — ver el detalle de cada una más
abajo.

**366 (`366_rls_auth_uid_select_wrap.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y PROD
(`jjffnbrdjchquexdfgwq`), código y migración COMMITEADOS Y PUSHEADOS a `origin/dev` (commit `310d9b3b`, tag
`v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`) — el texto "SIN COMMITEAR" de
abajo describe el estado AL MOMENTO de escribirse esta entrada, ya superado:** cierre del resto (no-top5) de la auditoría de
performance/calidad — antipattern de RLS documentado oficialmente por Supabase: `auth.uid()` usado
directo en vez de `(select auth.uid())` fuerza reevaluación fila por fila del predicado en vez de una sola
vez por query (initPlan). Único lugar del schema donde sobrevivía el patrón viejo (el resto de las ~150
policies ya usa `(select auth.uid())`, confirmado contra `pg_policies`): 4 policies en 3 tablas —
`autorizaciones_reglas_enrutamiento_select`/`_write`, `cupones_tenant`, `cupones_codigos_tenant`. `DROP`+
`CREATE` porque `ALTER POLICY` no permite reemplazar `USING`/`WITH CHECK`; cambio puramente mecánico,
mismo predicado, no cambia ningún permiso ni comportamiento. `migration-reviewer`: sin hallazgos.
**Verificado con datos reales de DEV**: `pg_policies` confirma el predicado idéntico post-cambio (solo
envuelto en `(select ...)`) + impersonación real de 2 usuarios vía `SET LOCAL ROLE` (el dueño sigue viendo
sus 53 cupones, un usuario de otro tenant sigue viendo 0 — aislamiento intacto). De paso,
`supabase/schema_full.sql` se regeneró completo contra DEV (estaba desactualizado desde antes de esta
sesión, no reflejaba las migs 358-365). **Estado real (al 2026-08-20): COMMITEADA (commit `310d9b3b`, tag
`v1.171.0`) y EN PROD (PR #331, merge commit `4dbe7fdb`).**
Ver `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", cont. 8).

**365 (`365_fix_formula_notificar_cc_vencidas.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código COMMITEADO (commit `310d9b3b`, tag
`v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):** resto del top5
de la auditoría de performance/calidad (backend #5). `fn_notificar_cc_vencidas` está MUERTA (ningún
sweep la invoca — `cron-sweeps` solo llama `recalcular_intereses_cc_all`/`liberar_reservas_vencidas_all`;
el proyecto no tiene `pg_cron` habilitado) pero calculaba la deuda de CC con la fórmula vieja `SUM(v.total
- COALESCE(v.monto_pagado,0))` — dos gaps reales contra la fórmula canónica de `cliente_cc_estado`
(`GREATEST(v.total - v.monto_pagado, 0) + v.interes_cc`, la misma que usan `fn_ventas_cc_guard`/
`fn_pedido_generar_venta`): (1) sin el `GREATEST(...,0)` una venta sobrepagada de un cliente podía restar
del total agregado de sus otras ventas con CC; (2) sin sumar `interes_cc`, el monto quedaba subestimado.
Inofensivo hoy (código inerte), pero landmine real si alguien la reactiva sin notar el drift. **Alcance a
propósito acotado**: SOLO se corrigió la fórmula — NO se wireó a ningún sweep/cron, esa es una decisión
de producto (¿se quiere la feature de notificación de CC vencida?) que no correspondía tomar en una
migración de limpieza de auditoría. **Estado real: escrita y revisada en la sesión anterior (MCP de
Supabase desconectado a mitad de sesión, bloqueante técnico); aplicada y verificada en esa sesión, luego
COMMITEADA (commit `310d9b3b`, tag `v1.171.0`) y EN PROD desde 2026-08-20 (PR #331, merge commit
`4dbe7fdb`)** — `prosrc` confirma la fórmula corregida, función ejecutada sin error. Ver
`sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", cont. 8).

**364 (`364_meli_stock_sync_dedupe.sql`) — ✅ APLICADA Y VERIFICADA EN DEV Y PROD, código COMMITEADO (commit
`310d9b3b`, tag `v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):** resto del
top5 (backend #4). Dos gaps reales
encontrados comparando `fn_enqueue_meli_stock_sync`/`trg_meli_stock_sync` contra su gemelo bien hecho
`fn_enqueue_tn_stock_sync`/`trg_tn_stock_sync`: (1) el trigger MELI era `AFTER INSERT OR DELETE OR UPDATE`
SIN acotar columnas — disparaba en CUALQUIER update de `inventario_lineas` (mover de ubicación, cambiar
una nota), no solo cambios que afecten el stock disponible real; corregido a `UPDATE OF cantidad,
cantidad_reservada, activo, producto_id`, igual que TN. (2) `fn_enqueue_meli_stock_sync` "dedupeaba" con
`ON CONFLICT DO NOTHING` pero `integration_job_queue` no tiene ningún constraint UNIQUE detrás — nunca
conflictuaba, dedupe muerto; reemplazado por el mismo patrón `NOT EXISTS` (contra jobs `pending` ya
encolados para el mismo producto) que ya usa correctamente `fn_enqueue_tn_stock_sync`. Consecuencia real
en tenants con integración MELI activa y alto movimiento de líneas: una ráfaga de cambios sobre la misma
línea (sin relación con stock real) encolaba N jobs redundantes, y el worker terminaba llamando N veces a
la API de MercadoLibre para lo mismo. Lógica de negocio preservada exacta, verificada carácter por
carácter contra el original por el `migration-reviewer`. **Estado real: escrita y revisada en la sesión
anterior (MCP de Supabase desconectado a mitad de sesión); aplicada y verificada en esa sesión, luego
COMMITEADA (commit `310d9b3b`, tag `v1.171.0`) y EN PROD desde 2026-08-20 (PR #331, merge commit
`4dbe7fdb`)** — `pg_get_triggerdef` confirma el trigger acotado, `prosrc` confirma el patrón `NOT EXISTS`
real. Ver `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", cont. 8).

**363 (`363_indices_fk_faltantes.sql`) — ✅ APLICADA Y VERIFICADA EN DEV Y PROD, código COMMITEADO (commit
`310d9b3b`, tag `v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):** resto del
top5 (backend #3). 6 `CREATE INDEX IF NOT
EXISTS` aditivos en rutas calientes de uso diario: compuesto `(tenant_id, estado, usuario_asignado_id)`
en `wms_tareas` y `tareas_repositor` (la query de "mis tareas" en Picking/Repositores filtra siempre por
esas 3 columnas — `PickingPage.tsx`: tenant + `estado IN (...)` + `usuario_asignado_id IS NULL/=user.id`
— y resolvía el último filtro con seq scan sobre lo que ya filtró tenant+estado; compuesto en vez de
columnas sueltas porque tenant_id/estado siempre están presentes en la query real); `pedido_items.
tenant_id` (toda policy RLS lo filtra, no tenía índice) y `pedido_items.estado_id` (FK a
`estados_inventario`, modo avanzado); `zonas.tenant_id` y `zonas.sucursal_id` (no tenía NINGÚN índice más
allá de la PK pese a 2 FKs). Sin riesgo — solo `CREATE INDEX`, nada que pueda romper una query existente.
**Estado real: escrita y revisada en la sesión anterior (MCP de Supabase desconectado a mitad de sesión);
aplicada y verificada en esa sesión, luego COMMITEADA (commit `310d9b3b`, tag `v1.171.0`) y EN PROD desde
2026-08-20 (PR #331, merge commit `4dbe7fdb`)** — `pg_indexes` confirma los 6 índices. Ver
`sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", cont. 8).

**362 (`362_stock_reserva_atomica.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y PROD
(`jjffnbrdjchquexdfgwq`), código y migración COMMITEADOS (commit `310d9b3b`, tag `v1.171.0`), **EN PROD
desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):** 🛑 REGLA #0 (inventario) — race condition
real en reservas de stock, hallazgo 🛑 CRÍTICO de una auditoría de performance/calidad pedida por GO.
6 puntos del código (`VentasPage.tsx` ×3, `tn-webhook/index.ts` ×2, `meli-webhook/index.ts` ×1)
reservaban/liberaban `inventario_lineas.cantidad_reservada` leyendo el valor, calculando el nuevo EN
JAVASCRIPT y pisándolo con un `.update()` directo — patrón leer-modificar-escribir NO atómico; dos
operaciones concurrentes sobre la MISMA línea (venta de mostrador + webhook TN/MELI llegando junto, o dos
webhooks en ráfaga) podían pisarse una reserva sin que ningún CHECK lo detectara. Causa raíz real de
**VEN-23 del UAT** ("2 cajeros venden la última unidad"). Dos RPCs nuevas `SECURITY INVOKER` (no
definer — el usuario ya podía hacer este UPDATE bajo RLS): `fn_reservar_stock_linea(p_linea_id,
p_cantidad)` y `fn_liberar_stock_linea(p_linea_id, p_cantidad)`, cada una con `SELECT ... FOR UPDATE`
(lock de fila) antes de calcular el ajuste — serializa transacciones concurrentes en vez de dejarlas
pisarse; reciben la cantidad DESEADA (no un delta ya calculado en JS) y devuelven cuánto se aplicó
realmente, clampeado contra el estado real de la línea. Los 6 call sites migrados a usarlas.
**Verificado con datos reales de DEV**: línea real (`cantidad=14, cantidad_reservada=0`), 2 llamadas
concurrentes a `fn_reservar_stock_linea` pidiendo 10 c/u (20 en total) → la primera se llevó 10, la
segunda clampeó a 4 — total 14, nunca 20 (hubiera violado `chk_cantidad_mayor_o_igual_reservada`);
`fn_liberar_stock_linea` clampea a 0 (verificado); dato de test restaurado después. `migration-reviewer`:
solo mejoras sugeridas. **Estado real (al 2026-08-20): COMMITEADA (commit `310d9b3b`, tag `v1.171.0`) y EN
PROD (PR #331, merge commit `4dbe7fdb`).** Ver
[[wiki/features/inventario-stock]] → "Reservas de stock — race condition atómica".

**361 (`361_emision_factura_lock.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y PROD
(`jjffnbrdjchquexdfgwq`), código y migración COMMITEADOS (commit `310d9b3b`, tag `v1.171.0`), **EN PROD
desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):** 🛑 REGLA #0 (fiscal) — lock anti
doble-submit en `emitir-factura`, hallazgo 🛑 CRÍTICO de la misma auditoría de performance/calidad. El
guard "¿ya tiene CAE?"/"¿ya tiene NC?" era una simple lectura sin lock — check-then-act; dos invocaciones
casi simultáneas (doble click, timeout+reintento, dos pestañas) podían ambas pasar el guard y llamar a
AFIP, resultando en **DOS comprobantes fiscales reales autorizados para la misma venta/devolución**.
Tabla mutex nueva `emision_factura_locks (clave PK, tenant_id, iniciado_at,
requiere_reconciliacion_manual)`, RLS habilitada sin policies + `REVOKE` explícito de
PUBLIC/anon/authenticated (mismo patrón que `afip_wsaa_ta`/`platform_facturas`) — solo `service_role` la
toca. `emitir-factura/index.ts` hace un `INSERT` atómico (clave `'fc:'+venta_id` / `'nc:'+devolucion_id`)
ANTES de cualquier lógica fiscal — si falla por PK duplicada (`23505`) responde 409 sin llamar a AFIP;
libera el lock en un `finally` EXCEPTO si el error contiene la frase literal "NO reintentar" (AFIP pudo
haber autorizado el comprobante sin que el sistema tenga el CAE), caso en que queda en CUARENTENA
(`requiere_reconciliacion_manual=true`, nunca se auto-limpia por tiempo) hasta reconciliación manual —
mismo patrón que `nc_afip_pendientes` (mig 359). Auto-limpieza de locks huérfanos con TTL de 5 min (nunca
limpia los en cuarentena). Tabla-mutex en vez de `pg_advisory_xact_lock` porque la EF habla con Postgres
vía PostgREST/supabase-js sin transacción persistente entre llamadas. **Hallazgo de paso corregido**:
`AfipSdkProvider.createVoucher` no envolvía la llamada en try/catch (a diferencia de
`WsfePropioProvider.createVoucher`) — sin el fix, un error ahí liberaba el lock igual que un error
seguro, reabriendo la carrera en el camino de emergencia; corregido con el mismo criterio ("NO
reintentar"). **También corregido** (hallazgo preexistente, no introducido por este fix): el fetch de
`ventas` y el update de `ventas`/`devoluciones` en `emitir-factura` no filtraban por `tenant_id` (la EF
usa `service_role`, bypassea RLS) — agregado `.eq('tenant_id', tenant_id)` a los 3 puntos.
**Verificado en DEV (SQL directo)**: INSERT duplicado de la misma clave falla con `23505`; lock viejo
simulado en cuarentena + uno viejo normal → la auto-limpieza (TTL 5 min) borró el normal y dejó intacto
el de cuarentena. **No se hizo una invocación HTTP real de punta a punta contra AFIP homologación** en
esta sesión (para no gastar un CAE real) — EF deployada a DEV (v25, ACTIVE), 3 pasadas de code-review.
`migration-reviewer`: faltaba `IF NOT EXISTS` + el `REVOKE` explícito, corregido. Recomendado un smoke
test real antes de decidir el deploy a PROD — hecho: el security advisor de PROD post-migración
(`get_advisors` tipo security) confirmó 0 hallazgos ERROR y 1 hallazgo INFO nuevo esperado
(`emision_factura_locks` con RLS habilitada sin policies — intencional, deny-by-default, ver comentario de
esta misma migración: la EF usa `service_role`, que bypassea RLS). **Estado real (al 2026-08-20):
COMMITEADA (commit `310d9b3b`, tag `v1.171.0`) y EN PROD (PR #331, merge commit `4dbe7fdb`).** Ver
[[wiki/features/facturacion-afip]] → "Lock anti doble-submit en `emitir-factura`".

**360 (`360_pedido_envio_entregado_sync.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código y migración COMMITEADOS (commit
`310d9b3b`, tag `v1.171.0`), **EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`):** 🚚📦 Fix de
sincronización Pedido↔Envío al entregar — GO notó, conversando con Claude, una contradicción real y
visible en la ficha de venta (badge "Envío · Entregado" junto a "Pedido · Listo para entrega") cuando
un pedido tiene envío real (courier/reparto propio). Causa: el camino "retiro en mostrador" sincroniza
`pedidos`+`envios` en una transacción (`fn_pedido_entregar_retiro`, mig 316), pero el camino "envío
real" (`EnviosPage.tsx`, guardar POD) hace un `UPDATE envios` directo sin tocar `pedidos` — confirmado
revisando las migraciones 292-351 completas, nunca existió sincronización para ese camino. Trigger
nuevo `trg_envio_entregado_sincroniza_pedido` (`AFTER INSERT OR UPDATE OF estado ON envios`,
`SECURITY DEFINER`, mismo criterio que la mig 315) sincroniza `pedidos.estado='entregado'` +
`entregado_at=now()` (idempotente, no pisa `entregado`/`cancelado`) + `pedido_items.
cantidad_entregada=cantidad`/`estado='preparado'` para las líneas no canceladas; envuelto en
`EXCEPTION WHEN OTHERS` para nunca bloquear el guardado real del POD. 🛑 **Hallazgo del
`migration-reviewer` corregido antes de aplicar**: la primera versión no filtraba por `tenant_id` —
al ser `SECURITY DEFINER` eso bypasseaba RLS (un envío cuyo `pedido_id` apuntara a un pedido de OTRO
tenant hubiera podido escribir ahí); se agregó el mismo guard de tenant que ya usa
`trg_envio_marca_pedido_con_envio` (mig 315). **Verificado con datos reales de DEV**: sincronización
real (pedido #89, tenant "Almacén Jorgito"); idempotencia (repetir la UPDATE del envío no mueve
`entregado_at`); aislamiento multi-tenant (un envío de un tenant no tocó un pedido de otro al marcarse
entregado, dato de prueba revertido después); y backfill puntual de un caso preexistente real del bug
(pedido #106, `cantidad_entregada=0`/`listo_para_entrega` eterno desde meses antes de este fix — dato
de test, no fiscal; se confirmó por query que no había más casos iguales en DEV). Typecheck/lógica
revisada, sin cambios en build ni tests (migración pura de DB). **Estado real (al 2026-08-20): COMMITEADA
(commit `310d9b3b`, tag `v1.171.0`) y EN PROD (PR #331, merge commit `4dbe7fdb`).** Ver
[[wiki/features/pedidos]] → sección junto a la "Cuarta barrera" y
[[wiki/features/envios]] → "POD — Proof of Delivery".

**359 (`359_nc_afip_pendientes.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y PROD
(`jjffnbrdjchquexdfgwq`), código release `v1.170.0` (PR #330 mergeado
`0687213b39ce7d942de8763756245016a5556cff`, tag+release `v1.170.0`):** 🧾⚡ NC electrónica AFIP automática al
confirmar una devolución — retoma la pregunta **A10** del relevamiento de Ventas (GO ya había elegido
la opción "automática al confirmar", con la cola de reintentos recomendada en la misma respuesta),
pedido explícito de GO hoy ("dale con la NC nomás") tras confirmar que el motor propio de AFIP
(`WsfePropioProvider`) ya está en uso por los 8 tenants reales de PROD. Hoy SOLO existía el flujo
MANUAL (botón "Emitir NC" en el detalle de la devolución). Tabla nueva `nc_afip_pendientes` (cola de
reintento): tenant_id/devolucion_id/venta_id/tipo_comprobante/punto_venta/intentos/ultimo_error/
`requiere_reconciliacion_manual` (boolean)/resuelto_at/notificado_at — índice único parcial `WHERE
resuelto_at IS NULL` (un solo pendiente ACTIVO por devolución); RLS SELECT+INSERT para miembros del
tenant, UPDATE/DELETE solo `service_role`. 🛑 **REGLA #0 — diseño de seguridad**: `emitir-factura/
index.ts` ya marca con la frase literal **"NO reintentar"** dos escenarios donde AFIP pudo haber
autorizado el comprobante aunque el sistema no tenga el CAE (error de transporte a mitad de la llamada
al WSFE, o CAE autorizado pero la escritura en `devoluciones.nc_cae` falló después) — reintentar
ciegamente esos casos podría emitir una **NC DUPLICADA en AFIP**. El diseño NO reintenta todo N veces:
reintenta solo errores genuinamente seguros (validación de negocio) y **escala a revisión humana de
inmediato** (sin gastar ni un intento) cualquier error con "NO reintentar", notificando a
DUEÑO/SUPER_USUARIO/CONTADOR para que concilien contra el "último autorizado" de AFIP antes de tocar la
devolución de nuevo. `src/pages/VentasPage.tsx` (`procesarDevolucion`): tras insertar `devoluciones` de
una venta `facturada`, dispara en segundo plano (fire-and-forget, `void (async () => {...})()`, NUNCA
bloquea ni puede revertir la devolución ya confirmada con su NC interna no-fiscal) un intento automático
con la MISMA EF `emitir-factura` que usaba el botón manual (misma letra derivada de la factura original,
mismo punto de venta). Éxito → toast con el CAE; falla → encola en `nc_afip_pendientes` + toast suave
avisando reintento automático. Edge Function nueva `nc-afip-retry-sweep` (deployada a DEV) +
`.github/workflows/nc-afip-retry-sweep.yml` (cron cada 15 min, GitHub Actions — el proyecto no tiene
pg_cron): por cada pendiente activo, si `ultimo_error` contiene "NO reintentar" o ya llegó a 8 intentos
→ escala (`requiere_reconciliacion_manual=true`, notifica in-app+email UNA vez, sin gastar el intento);
si no, reintenta `emitir-factura` con `SUPABASE_SERVICE_ROLE_KEY` (camino `esServiceRole` que la EF ya
contemplaba, sin cambios ahí) — éxito marca `resuelto_at` + notifica "NC emitida automáticamente"; error
de validación de negocio suma un intento y espera el próximo ciclo; error "NO reintentar" nuevo escala
igual. **Verificado con AFIP homologación REAL, no mockeado**, los 4 caminos: (1) éxito — venta #607
real, `estado='facturada'` Factura C, devolución completa vía Playwright ($600 transferencia) → NC
automática emitida sola contra el WSFE real, `nc_cae='86330757276751'`, `nc_tipo='NC-C'`,
`nc_punto_venta=1`, `nc_numero_comprobante=24`, `afip_provider_usado='propio'` — 0 filas en la cola,
funcionó al primer intento (registro dejado intacto en DEV a propósito, tiene CAE real); (2)
escalamiento — fila insertada a mano con el error real "NO reintentar la emisión a ciegas" → sweep
escaló sin llamar a `emitir-factura` (`intentos` quedó en 0), 3 notificaciones reales (una por usuario
DUEÑO/SUPER_USUARIO/CONTADOR), reinvocación → 0 evaluados (no duplica el aviso); (3) reintento seguro —
error genérico → el sweep SÍ llamó a `emitir-factura` de verdad, devolvió el error de validación real
"Un emisor Monotributista solo puede emitir comprobantes tipo C", `intentos` pasó a 1 sin escalar; (4)
agotamiento — `intentos` llevado a 8 a mano → escaló igual que el caso peligroso. Datos de prueba de la
cola y notificaciones sintéticas limpiados después (solo quedó la NC real de la venta #607). Typecheck
+ `vite build` + 1563 tests unitarios verdes. **Estado real: ✅ EN PROD desde v1.170.0 (2026-08-13, PR
#330).** Ver [[wiki/features/facturacion-afip]] → "NC automática al confirmar la devolución (A10)".

**358 (`358_hard_delete_grace_period.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y
PROD (`jjffnbrdjchquexdfgwq`), código release `v1.170.0` (PR #330 mergeado
`0687213b39ce7d942de8763756245016a5556cff`, tag+release `v1.170.0`):**
🗑️⏳ Hard delete de tenant con grace period — pedido de GO inmediatamente después del deploy de
v1.169.0, retoma un pendiente marcado explícitamente el 2026-08-04 ("auditoría de FKs hecha... NO se
construyó el flujo — queda pendiente de que el usuario lo pida explícito"). Hoy "Eliminar cuenta y
negocio" (`MiCuentaPage.tsx`) hacía un soft delete inmediato (borraba `users` + marcaba
`tenants.subscription_status='cancelled'`) sin ninguna purga real de los datos del tenant. **3
decisiones de diseño confirmadas con GO**: reactivación self-service (sin pasar por soporte), sin
export ZIP automático (ya existen exports por módulo), 30 días de gracia. `ALTER TABLE tenants ADD
COLUMN delete_scheduled_at timestamptz` (NULL = sin baja programada) + índice parcial
`idx_tenants_delete_scheduled_at`. 🛑 **Fix de bloqueo real encontrado al auditar TODAS las FK a
`tenant_id` en las ~140 tablas**: todas tenían `ON DELETE CASCADE` **excepto `autorizaciones`** (tenía
`NO ACTION` — mismo gap ya detectado en la auditoría del 2026-08-04, cuando la tabla se llamaba
`autorizaciones_inventario`; el `RENAME TABLE` de la mig 347 no tocó la definición de esa FK) — sin el
fix, el `DELETE FROM tenants` del sweep habría fallado con cualquier tenant que tuviera una fila en
`autorizaciones`. `ALTER TABLE autorizaciones DROP/ADD CONSTRAINT ... ON DELETE CASCADE`. Frontend:
`MiCuentaPage.tsx` (`handleDeleteAccount()` reescrito — ya NO borra `users`, programa la baja a +30
días, mantiene el guard fail-closed de cancelación MP si había suscripción activa — REGLA #0 — manda
email, no cierra sesión; "zona de riesgo" con estado condicional programar/cancelar);
`AppLayout.tsx` (banner global rojo, mismo mecanismo que `showTrialBanner`, solo rol DUEÑO, con días
restantes y botón "Cancelar eliminación" desde cualquier página); `src/lib/tenantHardDelete.ts` nuevo
(`cancelarBajaProgramada()` compartida entre el banner y MiCuentaPage). Edge Function nueva
`tenant-hard-delete-sweep` (deployada a DEV, `verify_jwt: false`) + workflow
`.github/workflows/tenant-hard-delete-sweep.yml` (cron diario `0 6 * * *` vía GitHub Actions — el
proyecto no tiene pg_cron habilitado, mismo patrón que `repositores-cierre-dia-sweep`): busca tenants
con `delete_scheduled_at` vencido y hace el `DELETE FROM tenants` real; el `ON DELETE CASCADE` de las
FK se encarga de borrar todo lo demás (productos, ventas, inventario, cajas, etc.). **Decisión
consciente de alcance, documentada explícitamente**: el sweep NO borra las cuentas de Supabase Auth de
los ex-usuarios del tenant — el riesgo de borrar por error una cuenta STAFF/ADMIN cross-tenant
(`rol='ADMIN'`, acceso a múltiples tenants) supera el beneficio de limpieza automática; deuda técnica
menor, no bloqueante. Self-reviewed sin `migration-reviewer` (2 `ALTER TABLE`, sin RLS/triggers/
funciones nuevos, perfil de riesgo bajo). Verificado con Playwright real contra DEV (programar → banner
con fecha exacta +30 días confirmada por SQL → cancelar desde el banner → `delete_scheduled_at` vuelve
a NULL, confirmado por SQL; app 100% funcional durante toda la ventana) y con el sweep real invocado
por curl contra un tenant 100% descartable (`__TEST_HARD_DELETE_DESCARTABLE__`) + una fila de prueba en
`autorizaciones` (tenant y fila desaparecieron, CASCADE + fix del FK funcionando; reinvocado, 0
evaluados — no reprocesa lo ya purgado; datos de prueba limpiados sin dejar rastro). Typecheck +
`vite build` + 1563 tests unitarios verdes. **Estado real: ✅ EN PROD desde v1.170.0 (2026-08-13, PR
#330).** Ver [[wiki/features/cancelacion-arrepentimiento]] → "Hard delete de tenant con grace period".

**357 (`357_repositores_fase4_etiquetas.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`)
Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.168.0` CONFIRMADO 100% EN PROD (PR #328 mergeado
`75ad544719467380368cbbcb783c4371d068a791`, tag+release `v1.168.0`, `list_migrations` real contra PROD
y bundle real de `https://genesis360.pro/` verificados con la cadena "v1.168.0"):** 🆕 Repositores Fase
4 (etiquetas de precio + impresión) — **última
fase del módulo**, misma sesión de Repositores continuada (cruzó medianoche a 2026-08-12). Solo 4
`ALTER TABLE ADD COLUMN IF NOT EXISTS`, sin tablas/RLS/triggers/funciones nuevos: `productos.
contenido_cantidad` (numeric) + `productos.contenido_unidad_id` (FK a `unidades_medida_fisicas`) —
cuánto contiene físicamente 1 unidad de venta (ej. 120 para un shampoo de 120ml), distinto de
`unidad_medida_base_id` (cómo se vende); `tenants.repositor_etiquetas_por_hoja` (`CHECK IN (4,6,12)`,
default 12) y `tenants.repositor_hora_impresion` (time, nullable). Investigación previa reusó 2
patrones existentes (`etiquetasEnvioPDF.ts` de Envíos EN7, `CodigoMasivoModal.tsx` de Inventario) —
nuevo `src/lib/etiquetasPreciosPDF.ts`, mismo patrón jsPDF en grilla A4, con código de barras (bwip-js
`code128`) en vez de QR. G1: precio anterior tachado SOLO si es descuento real (nunca en una suba);
`precioPorUnidadGrande()` nueva en `src/lib/unidadMedidaFisica.ts` (mapeo familia→unidad de referencia
Kg/L/m sobre `convertirFisica()` ya existente, sin tocarla). G2: card "Repositores — Etiquetas de
precio" en Config → Inventario → Zonas y picking. H1/H2: banner DENTRO de `/repositores` (no
notificación cross-app), evaluado en cada render — el proyecto no tiene cron ni `setInterval`. H3:
selección múltiple de tareas pendientes → 1 solo PDF en tanda; imprimir NO completa la tarea (2
acciones separadas a propósito). Self-reviewed sin `migration-reviewer` (perfil de riesgo bajo, sin
RLS/SECURITY DEFINER/movimiento de stock a diferencia de 352-356). Verificado con Playwright real
contra DEV (2 tareas de prueba cubriendo ambas ramas de G1, descarga real de PDF de 58.910 bytes,
aislamiento del caso sin código de barras confirmando `if (codigo)` — 3.480 bytes sin la imagen del
barcode, campo "Contenido" y card de Config verificados visualmente). **Cierra las 4 fases OPERATIVAS
de Repositores: mig 352-357 construidas, verificadas Y DEPLOYADAS A PROD el 2026-08-12 (v1.168.0, PR
#328)** — deploy verificado de forma independiente (`gh pr view 328` MERGED, `list_migrations` de PROD
confirma 352-357 aplicadas, bundle real con la cadena "v1.168.0"). Ver [[wiki/features/repositores]].

📌 **Nota histórica (sin migración propia, no agrega fila a esta tabla)**: los 2 puntos que quedaban del
relevamiento original de Repositores — Notificaciones (J) y Reportes (K) — se construyeron en una
sesión posterior el mismo 2026-08-12 (EN DEV en ese momento), **sin ninguna migración SQL nueva** (Edge
Function `repositores-cierre-dia-sweep` + tab "Reportes" nuevo, reusando `sucursales.horario_cierre` ya
existente desde la mig 124 y `fn_usuarios_supervisan_modulo` ya existente de Supervisión). **✅ EN PROD
desde v1.169.0 (2026-08-13, PR #329)** — deployado junto con paginación/navegación de Alertas/
Supervisión y el fix de `tn-webhook`. Con esto, el módulo Repositores queda 100% completo. Detalle en
[[wiki/features/repositores]] → "Notificaciones (J) y Reportes (K)".

**356 (`356_fix_dedupe_reposicion_gondola.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`)
Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.168.0` CONFIRMADO 100% EN PROD (PR #328 mergeado
`75ad544719467380368cbbcb783c4371d068a791`, tag+release `v1.168.0`):** 🐛 Fix de dedupe no atómico en
el generador de la mig 355, mismo
día que Repositores Fase 3, sesión continuada (cruzó medianoche a 2026-08-12). Hallazgo del
`migration-reviewer`: `fn_generar_tareas_reposicion_gondola` dedupeaba con `CONTINUE WHEN EXISTS`
(patrón heredado de `fn_generar_tareas_reabastecimiento_umbral`), no atómico — 2 llamadas concurrentes
(doble click, 2 repositores) podían crear 2 tareas activas para el mismo producto+góndola,
sobre-moviendo stock real (riesgo REGLA #0). Fix: índice único parcial
`uq_wms_tareas_reposicion_gondola_activa` (`WHERE tipo='reposicion_gondola' AND estado IN
('pendiente','en_curso')`) + `INSERT ... ON CONFLICT DO NOTHING` en el generador, mismo patrón que
`uq_tareas_repositor_activa` de la mig 352. De paso, `PedidosPage.tsx` (que tiene su propia tab de WMS
además de Picking) suma `.neq('tipo', 'reposicion_gondola')` a su query — sin ese filtro, un click en
"Confirmar retiro" sobre una tarea de reposición fallaba ruidosamente ahí (no corrompía stock, pero
confundía). Verificado con 2 llamadas seguidas al generador contra DEV real: solo 1 tarea creada. Ver
[[wiki/features/repositores]].

**355 (`355_repositores_fase3_reposicion_gondola.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.168.0` CONFIRMADO 100% EN
PROD (PR #328 mergeado `75ad544719467380368cbbcb783c4371d068a791`, tag+release `v1.168.0`):** 🆕
Repositores Fase 3 (reposición física a góndola), misma sesión
de Repositores continuada — GO eligió esta de las 2 fases futuras que quedaban (reposición física /
etiquetas+impresión). **Corrige la resolución anterior de I3**: investigación previa encontró que
`fn_wms_elegir_ubicacion_picking` (camino de picking automático) sí filtra duro por
`tipo_logico='picking'`, pero `fn_generar_tareas_reabastecimiento_umbral` (camino "por umbral") nunca
tuvo ese filtro en SQL — el único bloqueo real era la UI de Config. Conclusión final: se construye un
`tipo` nuevo (separación conceptual, no mezclar con la cola de Picking), pero se REUSA el mecanismo
real de movimiento de stock (`fn_completar_tarea_reabastecimiento`, mig 297) tal cual. Regla de disparo
MVP: tarea cuando el stock en la ubicación de exhibición del SKU llega a CERO, cantidad = todo lo
disponible en el lote FEFO más próximo a vencer en depósito. `wms_tareas.tipo` suma
`'reposicion_gondola'` (mismo precedente que `'armado'`, mig 345), `wms_tareas.origen` suma
`'repositor'`. `fn_generar_tareas_reposicion_gondola(p_tenant_id)` — `SECURITY INVOKER` a propósito (la
RLS de las 4 tablas que toca bloquea sola un tenant ajeno), recorre SKUs con exhibición asignada +
`disponible_surtido=true` (REGLA #0: sin este flag el POS sigue diciendo "sin stock" aunque el stock
físico ya esté en la góndola — ver [[wiki/features/ubicaciones]] mig 336), detecta góndola en cero,
busca FEFO en depósito, dedupea, asigna vía `fn_repositor_elegir_asignado` (mig 354, reusado). Guard
nuevo `fn_wms_tarea_asignado_valido_tenant` (trigger) en `wms_tareas.usuario_asignado_id` (columna
existente desde mig 289, nunca había tenido este guard). `fn_repositor_elegir_asignado` gana `GRANT
EXECUTE TO authenticated` (2do llamador: el generador, invocado directo por RPC). 🔒
**`migration-reviewer`: 2 hallazgos reales corregidos en el momento** — `PedidosPage.tsx` no filtraba
`reposicion_gondola` de su propia tab de WMS (fix incluido en la mig 356 de abajo) y dedupe no atómico
(fix = mig 356). 2 notas sin corregir, bajo riesgo: el generador no filtra por sucursal visible del
llamador (mismo patrón preexistente de `fn_generar_tareas_reabastecimiento_umbral`); `tareas_repositor`
nunca tuvo `authenticated` explícito en su `REVOKE` (default-privileges igual le da INSERT/DELETE).
Verificada con SQL real contra DEV (reparto por carga, movimiento físico de stock unidad por unidad,
stock de origen a 0 preservando reserva, cancelación/reasignación, guard cross-tenant rechazado) y con
Playwright real contra el navegador (tab "Reposición física", completar → toast + movimiento real en
DB). Ver [[wiki/features/repositores]] y [[wiki/features/wms]].

**354 (`354_repositores_fase2_asignacion.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.168.0` CONFIRMADO 100% EN
PROD (PR #328 mergeado `75ad544719467380368cbbcb783c4371d068a791`, tag+release `v1.168.0`):** 🆕
Repositores Fase 2 (asignación automática + reasignación
manual), misma sesión de Repositores continuada — GO eligió esta de las 3 fases futuras propuestas
(reposición física / asignación-reasignación / etiquetas). `fn_usuarios_hacen_repositor(p_tenant_id,
p_sucursal_id)` — pool de usuarios elegibles para HACER trabajo de repositor en una sucursal (distinto
del pool de `fn_usuarios_supervisan_modulo` de la mig 348, que es para SUPERVISAR/aprobar); roles fijos
DUEÑO/SUPER_USUARIO/SUPERVISOR/CAJERO/DEPOSITO o rol custom con permiso 'editar'/'supervisa' en
'repositores', excluye a propósito ADMIN (staff cross-tenant); `SQL STABLE` sin `SECURITY DEFINER`
(correcto por ser invoker: la RLS de `users` bloquea sola un `tenant_id` ajeno pasado por RPC).
`fn_repositor_elegir_asignado(p_tenant_id, p_sucursal_id)` — reparto por carga (menos tareas
pendientes/en_curso primero, empate al azar, mismo patrón que `fn_autorizaciones_auto_asignar` de la
mig 348), uso interno sin RPC propia; la elección se inlineó DIRECTO en el `INSERT` de los 2 triggers
de la mig 352 (`CREATE OR REPLACE`) en vez de un trigger `BEFORE INSERT` genérico aparte, porque todas
las filas de `tareas_repositor` nacen únicamente de esos 2 triggers; el `ON CONFLICT ... DO UPDATE`
(dedupe de la mig 352) sigue sin tocar `usuario_asignado_id` a propósito. Guard nuevo
`fn_tarea_repositor_asignado_valido_tenant` (trigger `BEFORE INSERT/UPDATE OF usuario_asignado_id`)
rechaza asignar a un usuario de otro tenant — mismo patrón que `fn_regla_enrutamiento_valida_tenant` de
la mig 348. `vw_tareas_repositor` (`CREATE OR REPLACE`, preserva `security_invoker=true` de la mig 353)
suma `usuario_asignado_nombre` al final del `SELECT` (Postgres no permite insertar una columna nueva en
el medio de una vista existente). 🔒 **`migration-reviewer`: veredicto APTA**, 4 sugerencias 🟡 no
bloqueantes, 2 aplicadas en el momento (`fn_repositor_elegir_asignado` de `STABLE` a `VOLATILE` por usar
`random()`; `REVOKE ALL FROM PUBLIC, anon, authenticated` en el guard de tenant), 2 quedan de nota sin
actuar (reasignación gateada solo client-side, igual que `autorizaciones`/mig 347; `schema_full.sql`
sigue desactualizado, falta `SUPABASE_ACCESS_TOKEN`). Verificada con SQL real contra DEV (pool exacto de
5 elegibles vs. 4 excluidos por rol, reparto balanceado entre 2 productos distintos, dedupe respeta el
asignado existente, guard rechaza usuario de otro tenant) y con Playwright real contra `localhost:5173`
(badge de asignado, reasignación con motivo vía UI, toast, `actividad_log` real con
`entidad='tarea_repositor'`/`accion='reasignar'`). De paso corrigió un bug de trazabilidad preexistente
de la Fase 1 (completar/cancelar logueaba `entidad:'pedido'` en vez de un tipo propio — se sumó
`'tarea_repositor'` a `EntidadLog`, `src/lib/actividadLog.ts`). Ver [[wiki/features/repositores]].

**353 (`353_fix_security_invoker_vw_tareas_repositor.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.168.0` CONFIRMADO 100% EN
PROD (PR #328 mergeado `75ad544719467380368cbbcb783c4371d068a791`, tag+release `v1.168.0`):** 🔒🛑 Fix
de seguridad real sobre la vista de la mig 352, misma
sesión de Repositores continuada. Con el límite de gasto mensual de subagentes ya liberado (confirmado
por GO), se volvió a correr el `migration-reviewer` completo sobre la mig 352 (la vez anterior había
fallado a mitad de revisión) — encontró que `vw_tareas_repositor` había quedado creada **SIN** `WITH
(security_invoker = true)`, el mismo gotcha que el proyecto ya había resuelto en la **mig 053**
(`stock_por_producto`) y replicado desde entonces en TODAS las vistas nuevas (migs 136, 141, 142, 226:
`vw_boveda_cuentas`, `vw_diferencias_por_cajero`, `vw_caja_resumen_diario`,
`vw_caja_mensual_por_sucursal`) — `vw_tareas_repositor` fue la **ÚNICA** vista de todo el historial que
quedó afuera de ese patrón (su comentario decía "RLS heredada de las tablas base", incorrecto en este
caso). Sin `security_invoker`, Postgres evalúa las RLS de las tablas subyacentes con los permisos del
DUEÑO de la vista, no del usuario que consulta. **Impacto real mientras estuvo así (solo en DEV, nunca
en PROD)**: cualquier usuario autenticado de CUALQUIER tenant podía leer tareas — y por join,
precios/estados de inventario/vencimientos/patrones de venta — de TODOS los tenants. Fix: `ALTER VIEW
public.vw_tareas_repositor SET (security_invoker = true);` + `REVOKE ALL ... FROM PUBLIC, anon,
authenticated` en las 2 funciones trigger de la mig 352 (`fn_generar_tarea_repositor_precio`,
`fn_generar_tarea_repositor_estado`), sugerencia no bloqueante del reviewer alineada con el precedente
de la mig 272. Verificado contra la DB real de DEV: `pg_class.reloptions` confirma
`security_invoker=true`; `information_schema.role_routine_grants` confirma que las 2 funciones ya no
tienen grant a `authenticated`/`anon` (solo `postgres`/`service_role`). Ver [[wiki/features/repositores]].

**352 (`352_repositores_fase1_nucleo.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y
PROD (`jjffnbrdjchquexdfgwq`), código release `v1.168.0` CONFIRMADO 100% EN PROD (PR #328 mergeado
`75ad544719467380368cbbcb783c4371d068a791`, tag+release `v1.168.0`):** 🆕 Módulo nuevo Repositores,
Fase 1 (núcleo + disparadores +
prioridad) del backlog Comercial de Fede — ver [[wiki/features/repositores]] para el detalle completo.
Tabla `tareas_repositor` (ciclo de vida pendiente/en_curso/completada/cancelada, mismo patrón que
`wms_tareas`) + 2 triggers `SECURITY DEFINER` (`fn_generar_tarea_repositor_precio` AFTER UPDATE OF
`precio_venta` ON `productos`; `fn_generar_tarea_repositor_estado` AFTER UPDATE OF `estado_id` ON
`inventario_lineas`, solo si el estado destino tiene `descuento_pct>0`) que generan/actualizan una
tarea de "cambiar cartel de precio en la góndola", **solo** si el producto tiene
`producto_ubicacion_sucursal.ubicacion_exhibicion_id` apuntando a una ubicación `tipo_logico=
'exhibicion'` en esa sucursal y el tenant está en `modo_operacion='avanzado'`. Dedupe por (producto,
sucursal, tipo) vía `UNIQUE` parcial `WHERE estado IN ('pendiente','en_curso')` + `INSERT ... ON
CONFLICT ... DO UPDATE` — corrige una race condition real que tenía el patrón inicial
`UPDATE...; IF NOT FOUND THEN INSERT` (encontrada en el self-review, ver abajo). Vista
`vw_tareas_repositor` calcula la prioridad de Fede (vendido con el cartel desactualizado > precio
subió > cercanía a vencimiento > más vieja primero) en cada lectura, nunca cacheada — cruza contra
`venta_items`/`ventas` con un `EXISTS` correlacionado para saber si se vendió algo desde que nació la
tarea. Migración puramente aditiva, sin `migration-reviewer` disponible (falló por el límite de gasto
mensual de la cuenta a mitad de sesión) — **revisada a mano contra el mismo checklist que usa el
subagente** (race conditions, `SECURITY DEFINER`, RLS heredada por la vista, GRANTs). Verificada
end-to-end contra datos reales de DEV: los 2 triggers, la prioridad, completar/cancelar — todo
probado con acciones reales por la UI (datos de prueba limpiados después).

**351 (`351_actividad_log_venta_id.sql`) — ✅ APLICADA Y VERIFICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y
PROD (`jjffnbrdjchquexdfgwq`), código release `v1.166.0` CONFIRMADO 100% EN PROD (PR #326 mergeado
`95e837f6`, tag+release `v1.166.0`, bundle real de Vercel verificado con la cadena "v1.166.0"):**
🔍 Trazabilidad completa de una venta en `/historial` — pedido de GO tras trazar a mano la venta real
**#619** (quería filtrar por número de venta y ver TODO lo que pasó — pedido, picking, envío,
devolución — sin cruzar 6 tablas a mano). `ALTER TABLE actividad_log ADD COLUMN venta_id uuid NULL
REFERENCES ventas(id) ON DELETE SET NULL` + índice parcial (`WHERE venta_id IS NOT NULL`), poblada
**WRITE-TIME** (nunca heurística de lectura — mismo criterio que el ledger de trazabilidad de la mig
155) desde `logActividad()`: directo para filas de venta, resuelto vía `pedido.venta_origen_id` o
`envio.venta_id` para las indirectas. `LogParams` gana `venta_id?: string | null`; se suma `'envio'`
al tipo `EntidadLog` (antes Envíos no tenía tipo de entidad propio en el log). **Auditoría real de
gaps ANTES de diseñar**: `EnviosPage.tsx` tenía CERO llamadas a `logActividad()` en todo el archivo
(crear/cambio de estado/eliminar agregados); `PedidosPage.tsx` no logueaba `fn_pedido_cerrar` ni
`fn_pedido_deslanzar` (completados). Filtro nuevo "N° de venta" en `/historial` — trae toda la línea
de tiempo de la venta sin paginar, cruza con `venta_item_despachos` para el LPN/ubicación de cada
línea, distingue "no existe" de "existe pero es de antes de esta trazabilidad" (sin backfill
retroactivo). Verificado end-to-end contra DEV real (insert de prueba en la venta #622, visible y
borrado; venta vieja mostró el mensaje correcto de "sin trazabilidad retroactiva").
🛑 **De paso, construyendo la trazabilidad, GO preguntó si el picking realmente rebaja stock — bug
real de REGLA #0 encontrado y corregido (sin migración propia, fix de frontend en `VentasPage.tsx`):**
verificado contra el SQL real que el picking NUNCA rebaja stock ni toca `cantidad_reservada` para un
pedido nacido de una venta (la reserva es de la venta, migs 316/320/323); el guard de "rebaje por un
solo camino" (mig 350, v1.165.0) excluía solo `estado <> 'cancelado'`, no `'entregado'` — así que una
vez entregado el pedido, el stock reservado por la venta quedaba atascado para siempre, sin ningún
camino para convertirse en rebaje real. Fix: `.not('estado', 'in', '(cancelado,entregado)')`.
Verificado con datos reales de DEV: venta #599 (reservada) con su pedido #91 ya `entregado` — la
query vieja bloqueaba el botón "Finalizar", la nueva lo desbloquea; esa venta sigue así en DEV como
evidencia viva del bug, sin backfill retroactivo. **No confundir con la venta #619** (caso de estudio
de la mig 350) — son ventas reales distintas del mismo tenant. Detalle completo:
[[wiki/features/reportes-metricas]] "Trazabilidad completa de una venta", [[wiki/features/pedidos]]
"Cuarta barrera" (corrección), [[wiki/features/ventas-pos]], [[wiki/features/envios]].

**350 (`350_pedido_venta_viva_bloquea_ya_despachada.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.165.0` CONFIRMADO 100% EN
PROD (PR #324 mergeado, tag+release `v1.165.0`; PR #325/`v1.165.1` — fix del footer de conteo —
también en PROD, ver [[wiki/business/roadmap]]):** 🛑 REGLA #0 (inventario) — cierra el hueco real de rebaje
de stock **por 2 caminos** que encontró GO con la venta real #619 del tenant "Almacén Jorgito" en DEV.
`fn_pedido_venta_viva` (mig 323) ya bloqueaba LANZAR un pedido si la venta era un presupuesto o estaba
anulada/devuelta, pero NO si ya estaba `despachada`/`facturada` — el único camino que rebaja stock
DIRECTO es el botón "Finalizar (rebaja stock)" de Ventas; si alguien lo usa mientras el Pedido de esa
misma venta sigue vivo, y después alguien lanza ese Pedido, se generan tareas de picking para volver a
preparar/rebajar mercadería que YA salió. En la #619 real no hubo doble rebaje solo porque esa tarea
se canceló antes de completarse, pero el sistema lo permitía. `CREATE OR REPLACE` de la misma función
de la mig 323 — agrega el bloqueo `IN ('despachada','facturada')`, resto idéntico. El frontend
(`VentasPage.tsx`) ahora oculta el botón "Finalizar" cuando hay un Pedido vivo (`pedidoActivoVenta`) —
esta migración es el guard SERVER-SIDE que exige la Regla de Oro #0 (la UI se cachea/bypassea).
Verificado en el navegador contra DEV real (venta #622 con Pedido #23, 7 pedidos con venta ya
despachada). Detalle completo: [[wiki/features/pedidos]] "Cuarta barrera".

**349 (`349_fix_registrar_pago_oc_oc_id.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.165.0` CONFIRMADO 100% EN
PROD (PR #324 mergeado, tag+release `v1.165.0`):** 🐛 fix real de Compras — `registrar_pago_oc` (mig 237) fallaba con
**"column oc_id does not exist"** al pagar una OC sin `monto_total` seteado directo: el fallback que
suma `orden_compra_items` filtraba por una columna `oc_id` que nunca existió ahí (la real es
`orden_compra_id`) — bug dormido desde que se creó la función en la mig 237, disparado solo en ese
caso puntual. Reproducido con datos reales: la OC #30 del tenant Almacén Jorgito en DEV.
`CREATE OR REPLACE` de la misma función, único cambio real `WHERE oc_id = p_oc_id` →
`WHERE orden_compra_id = p_oc_id`, resto textualmente idéntico. Detalle:
[[wiki/features/clientes-proveedores]] "Fix real de CO5".

**348 (`348_autorizaciones_auto_asignacion.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.164.0` CONFIRMADO 100% EN
PROD (A2 del relevamiento de Supervisor — asignación automática, cierra 100% el patrón de Supervisor
junto con F1 "Avisar al supervisor" — ver el bloque "ARRANCÁ ACÁ" de `sources/raw/project_pendientes.md`
para el detalle completo):** tabla nueva `autorizaciones_reglas_enrutamiento`
(tenant_id+modulo+tipo → usuario_id, `UNIQUE(tenant_id,modulo,tipo)`, `ON DELETE CASCADE` en
`tenant_id`) — RLS con 2 policies separadas: SELECT tenant-wide (necesario porque el trigger de abajo
corre `SECURITY INVOKER` bajo el rol de CUALQUIER usuario que cree una autorización) y
escritura (INSERT/UPDATE/DELETE) acotada a `get_user_role() IN ('DUEÑO','ADMIN')`. Trigger
`fn_regla_enrutamiento_valida_tenant` (guard: `usuario_id` de la regla debe pertenecer al mismo
tenant). Función `fn_usuarios_supervisan_modulo(p_tenant_id, p_modulo)` — espejo SQL fiel de
`puedeSupervisarModulo` (permisosModulo.ts), `REVOKE FROM PUBLIC/anon`. Trigger
`fn_autorizaciones_auto_asignar` (`BEFORE INSERT ON autorizaciones`): si hay regla de enrutamiento la
respeta, si no reparte por carga (COUNT de pendientes agrupado por `asignado_a`, filtrado a elegibles,
empate desempatado por `random()` — no siempre el mismo UUID, para que el reparto sea justo de verdad).
🔒 **`migration-reviewer` en 2 rondas**: la primera encontró 2 bloqueantes de idempotencia (`CREATE
TABLE`/`CREATE POLICY` sin guard `IF NOT EXISTS`) — corregidos; la segunda confirmó "APTA". Verificado
con SQL real (auto-asignación por carga y por regla, ambas correctas) y con un **JWT real de un
usuario CAJERO** vía `fetch()` directo a PostgREST (403 al intentar escribir una regla) — `execute_sql`
corre como `postgres` con `rolbypassrls=true` y no sirve para probar RLS de escritura. Detalle:
[[wiki/features/supervision]].

**347 (`347_autorizaciones_generico_supervisor.sql`) — ✅ APLICADA Y VERIFICADA EN DEV
(`gcmhzdedrkmmzfzfveig`) Y PROD (`jjffnbrdjchquexdfgwq`), código release `v1.163.0` CONFIRMADO 100% EN
PROD (Pestaña de Supervisor reusable, 2º de 4 relevamientos derivados hacia Repositores — ver el bloque
"ARRANCÁ ACÁ" de `sources/raw/project_pendientes.md` para el detalle completo):** `RENAME TABLE
autorizaciones_inventario → autorizaciones` (preserva PK/FK/RLS/índices/trigger por OID) + columna
`modulo` (NOT NULL, CHECK acotado a `'inventario'` hoy, mismo patrón incremental que `tipo`) + columna
`asignado_a` (reasignación puntual, E1 del relevamiento) + 2 índices nuevos
(`tenant_id,modulo,estado` y `asignado_a`). Redefine (`CREATE OR REPLACE`, lógica idéntica salvo el
nombre de tabla) las 2 únicas funciones que la referenciaban por texto en su cuerpo plpgsql —
`aprobar_cambio_estado_inventario` (REGLA #0, guard anti-fraude de cambio de estado) y
`fn_evaluar_repricing_margen` (D3) — porque un `RENAME TABLE` no actualiza el texto de una función.
🔒 **Hallazgo del `migration-reviewer` antes de aplicar**: el frontend (`InventarioPage.tsx`,
`LpnAccionesModal.tsx`, 7 specs e2e) seguía apuntando al nombre viejo de la tabla — corregido antes de
aplicar. Verificado con SQL real contra DEV: la RPC `aprobar_cambio_estado_inventario` ejecutada con un
usuario impersonado de verdad (`SET request.jwt.claims`) cambió el estado real y marcó la autorización
aprobada; cleanup sin residuo. Estructura (RLS/índices/trigger/grants) verificada intacta en ambos
proyectos tras el rename. Detalle: [[wiki/features/supervision]].

**346 (`346_repricing_margen_meli_d3.sql`) — ✅ APLICADA EN DEV (`gcmhzdedrkmmzfzfveig`) Y PROD
(`jjffnbrdjchquexdfgwq`), código release `v1.162.0` CONFIRMADO 100% EN PROD:** dos
mecanismos independientes definidos por Fede. Mecanismo 1 — `productos.reajuste_margen_auto`
(opt-in), ajusta `precio_venta` (precio base, único cross-canal) para volver al `margen_objetivo`;
config a nivel tenant `tenants.repricing_modo`/`repricing_tope_pct`/`repricing_umbral_aviso_monto`/
`repricing_automatico_desde_monto`. RPC `fn_precio_para_margen` (IMMUTABLE, fórmula única) y
`fn_evaluar_repricing_margen(p_tenant_id)` (el sweep, sin `auth.uid()`, `GRANT` solo `service_role`,
mismo patrón que `fn_iniciar_armado_kit_auto` de la mig 345) que aplica directo o genera fila en
`autorizaciones_inventario` (nuevo tipo `'repricing_margen'` en el CHECK, reusa la pantalla existente,
mismo patrón que `'kit_precio'` de la mig 343). RPC `fn_ultima_comision_meli` de solo lectura
(informativa, nunca certera para fijar precio). Mecanismo 2 — `productos.precio_ajuste_meli_pct`/
`precio_ajuste_tn_pct` (independiente del mecanismo 1): el precio PUBLICADO en cada canal se deriva
del precio base + ese %, sin tocar `precio_venta`. Trigger `trg_enqueue_sync_precio` (función
`fn_enqueue_sync_precio`) encola `sync_precio` en `integration_job_queue` para MELI/TN. 🔒 **Hallazgo
del `migration-reviewer` antes de aplicar, corregido**: el trigger reaccionaba a CUALQUIER cambio de
`precio_venta` sin gate — como `inventario_meli_map.sync_precio` viene `DEFAULT true` desde la mig 065
(checkbox "dormido"), esto habría despertado el push automático de precio para cualquier producto ya
mapeado sin participar de D3 (verificado con datos reales: afectaría 2 ítems de una cuenta MELI real
conectada en DEV) — corregido con un gate que solo dispara si el producto tiene algo de D3 configurado.
Edge Functions `meli-stock-worker` (aplica `precio_ajuste_meli_pct` al publicar, el job `sync_precio`
ya existía dormido) y `tn-stock-worker` (no soportaba precio en absoluto, se le agregó desde cero)
actualizadas, y Edge Function nueva `repricing-sweep` (+ GitHub Action `repricing-sweep.yml`, cron
cada 6hs, no hay pg_cron habilitado) deployadas en DEV y PROD. Verificado con datos reales en DEV
(fórmula, modo alerta sin duplicar, modo automático con tope clampeado, opt-in del trigger, sweep
probado en vivo contra los 10 tenants de DEV, 0 cambios reales). **`APP_VERSION` bumpeada a
`v1.162.0`, commit `792bda42`. Pipeline cerrado: PR #320 (`dev`→`main`) mergeado — merge commit
`bbc8c1db43216512e9608301d715331900e038b0` — tag + GitHub release `v1.162.0` publicados, Vercel PROD
verificado READY (deployment `dpl_GVHKjDYT8FkDRuFQi9zHYdYcfLLg`).** Pendiente real: el mecanismo 2
(push real de precio) sin probar contra una cuenta MELI/TN real conectada. Detalle:
[[wiki/integrations/mercado-libre]], [[wiki/integrations/tienda-nube]].

**🔴 346-bis (sin número propio, hotfix de código puro `v1.162.1`) — embed ambiguo `ubicaciones()`
(PGRST201):** las migraciones 342 y 345 agregaron 2 FK nuevas de `productos` hacia `ubicaciones`
(`rotacion_ubicacion_excepcion_id`, `ubicacion_kit_default_id`), sumadas a la ya existente
`ubicacion_id` — con 3 relaciones posibles, PostgREST ya no puede resolver un embed sin calificar
`ubicaciones(nombre)` (usado en `ProductosPage.tsx`/`ReportesPage.tsx`), devuelve `PGRST201`/HTTP 300 y
tira abajo la lista de Productos y el reporte de Stock en cualquier tenant. **Confirmado en vivo contra
PROD real** con `curl` directo al endpoint REST. Fix: calificar la FK exacta
(`ubicaciones!productos_ubicacion_id_fkey`). **Sin migración de DB** — commit `68a48d9e`. ✅ **CERRADO,
deployado a PROD junto con v1.163.0** (2026-08-10), confirmado contra el bundle real por `curl`.
Detalle técnico: [[wiki/development/convenciones-codigo]] → "Embeds de PostgREST con FK ambigua".

**345 (`345_armado_kits_automatico_d2.sql`) — ✅ EN DEV Y PROD desde v1.161.0** (backend de Combos
automáticos TN/MELI, Fase D2 del roadmap — ver el bloque "ARRANCÁ ACÁ" de
`sources/raw/project_pendientes.md` para el detalle completo): `wms_tareas.tipo` suma `'armado'` y
`wms_tareas.origen` suma `'marketplace'`, `wms_tareas.kitting_log_id` (FK a `kitting_log`),
`productos.ubicacion_kit_default_id`, `tenants.wms_armado_operario_default_id`, RPCs nuevas
`fn_iniciar_armado_kit_auto` (sin `auth.uid()`, `GRANT` solo `service_role`, filtro de canal
`disponible_tn`/`disponible_meli` aplicado por primera vez a una reserva ENTRANTE, todo-o-nada con
`pg_advisory_xact_lock`) y `fn_completar_tarea_armado`, y `fn_cancelar_tarea_wms` extendida para liberar
la reserva de un armado. 🔒 **2 hallazgos del `migration-reviewer` antes de aplicar, corregidos:**
bloqueante #1 la primera versión de `fn_cancelar_tarea_wms` perdía la cascada de cancelación
picking↔reabastecimiento de la mig 291; bloqueante #2 faltaba el chequeo final anti-carrera de stock en
`fn_iniciar_armado_kit_auto`. Verificada con SQL directo contra DEV (todo-o-nada, camino exitoso, filtro
de canal, cancelación); datos de prueba limpiados. **Aplicada en PROD el 2026-08-08** vía
`apply_migration`, confirmada con `list_migrations` + queries directas contra PROD (CHECK de
`wms_tareas.tipo`/`origen` con los valores nuevos, ambas funciones presentes). Edge Functions
`tn-webhook`/`meli-webhook` (con el wiring del armado automático) deployadas en DEV (v21/v25) y PROD
(v20/v13) vía `deploy_edge_function`, sanity check post-deploy OK contra DEV. **PR #319 (`dev`→`main`)
mergeado limpio** (merge commit `7c26b3a641aafe3d39669badb7c61cf8e42ee3e5`), **tag + GitHub release
`v1.161.0`** publicados (`--latest`). **Vercel PROD verificado de forma independiente**: deployment
`dpl_CaSPmabR76uEBq6Uuv2d74x78PTP`, `state: READY`, `target: production`. **🟡 Pendiente real, no
bloqueante del deploy: la prueba end-to-end con una orden real de TN/MELI** — requiere que GO o Fede
generen una orden real en una tienda de test conectada con un kit mapeado (Claude Code no tiene ese
acceso); la lógica de las RPCs ya está 100% verificada con datos de prueba reales.
**001-357: TODAS (352-357 incluidas) EN DEV Y PROD** — ✅ **deploy confirmado el 2026-08-12** (v1.168.0,
PR #328 mergeado `75ad544719467380368cbbcb783c4371d068a791`, tag+release `v1.168.0`, verificado de
forma independiente con `gh pr view 328` MERGED + `list_migrations` real contra PROD + bundle real de
`https://genesis360.pro/` con la cadena "v1.168.0"). Módulo Repositores (Fases 1-4) 100% construido Y
EN PRODUCCIÓN.
**001-357 (histórico, 2026-08-11/12): 351 EN DEV Y PROD, 352-357 SOLO EN DEV.** Mig 357 es Repositores
Fase 4 (etiquetas de precio + impresión) — **última fase del módulo**, misma sesión de Repositores
continuada (cruzó medianoche a 2026-08-12), commit `ad35d0f6` en `origin/dev`, sin mergear a `main` ni
deployar. Con esto **Repositores quedó 100% construido (Fases 1-4, mig 352-357), TODAS solo en DEV** —
deploy a PROD en curso a continuación en la misma sesión (GO ya pidió deployar). **✅ Deployado el
2026-08-12 — ver la línea de arriba.**
**001-356 (histórico, 2026-08-11/12): 351 EN DEV Y PROD, 352-356 SOLO EN DEV.** Migs 355+356 son
Repositores Fase 3 (reposición física a góndola + fix de dedupe) — misma sesión de Repositores
continuada (cruzó medianoche a 2026-08-12), commits `45a3c89b`/`d6f37b08` en `origin/dev`, sin mergear
a `main` ni deployar — decisión pendiente de GO. Corrige la resolución anterior de I3 (el camino de
reabastecimiento por umbral nunca tuvo el filtro de `tipo_logico` que sí tiene el picking automático).
Quedaba **1 SOLA fase sin arrancar** del módulo: etiquetas + impresión. **✅ Deployado el 2026-08-12
junto con el resto del módulo — ver la línea "001-357" de arriba.**
**001-354 (histórico, 2026-08-11): 351 EN DEV Y PROD, 352-354 SOLO EN DEV.** Mig 354 es Repositores
Fase 2 (asignación automática + reasignación manual) — misma sesión de Repositores continuada, commit
`e200d673` en `origin/dev`, sin mergear a `main` ni deployar — decisión pendiente de GO. Fases que
quedaban sin arrancar del módulo: 2 (reposición física a góndola, etiquetas+impresión), no 3. **✅
Deployado el 2026-08-12 — ver la línea "001-357" de arriba.**
**001-353 (histórico, 2026-08-11): 351 EN DEV Y PROD, 352-353 SOLO EN DEV.** Mig 353 es un fix de
seguridad (`security_invoker`) sobre la vista de la mig 352 (`vw_tareas_repositor` exponía datos
cross-tenant) — misma sesión de Repositores Fase 1 continuada, commit `36fc075b` en `origin/dev`, sin
mergear a `main` ni deployar — decisión pendiente de GO. **✅ Deployado el 2026-08-12 — ver la línea
"001-357" de arriba.**
**001-352 (histórico, 2026-08-11): 351 EN DEV Y PROD, 352 SOLO EN DEV.** Código `v1.166.1` 100%
CERRADO Y EN PROD (PR #327, link directo al Pedido desde el detalle de venta, sin migración propia).
**Código `v1.167.0` (Repositores Fase 1, mig 352) EN `origin/dev` (commit `62ba97ec`), SIN mergear a
`main` ni deployar — decisión pendiente de GO.** **✅ Deployado el 2026-08-12 — ver la línea "001-357"
de arriba.**
**001-351 EN DEV Y PROD, código `v1.166.0` 100% CERRADO Y EN PROD (PR #326, merge `95e837f6`, tag+release
`v1.166.0`)** — trazabilidad completa de una venta en `/historial` (mig 351) + fix REGLA #0 (el stock
reservado de una venta quedaba atascado tras entregar su pedido, sin migración propia, código de
`VentasPage.tsx`).
**001-350 EN DEV Y PROD, código `v1.165.0` 100% CERRADO Y EN PROD (PR #324, tag+release `v1.165.0`) +
`v1.165.1` (PR #325, patch de UI del footer de conteo, sin migración propia) también en PROD** — rebaje
de stock por un solo camino (venta #619, mig 350) + fix Compras `registrar_pago_oc` (mig 349).
**001-348 EN DEV Y PROD (base de datos y Edge Functions); código `v1.164.0` 100% CERRADO Y EN PROD**
(PR #323) — Pestaña de Supervisor reusable 100% completa (F1 + A2, mig 348).
**001-347 EN DEV Y PROD, código `v1.163.0` 100% CERRADO Y EN PROD (PR #322)** — incluye el hotfix
`v1.162.1` (PGRST201) y el núcleo de la Pestaña de Supervisor reusable (mig 347).
**001-346 EN DEV Y PROD, código `v1.162.0` (D3) 100% CERRADO Y EN PROD (PR #320).**
**001-345 EN DEV Y PROD (base de datos), deploy v1.161.0 100% CERRADO.**
**001-344 EN DEV Y PROD (base de datos), deploy v1.160.0 100% CERRADO** — las migraciones 339-343 se
aplicaron en PROD (proyecto `jjffnbrdjchquexdfgwq`) el 2026-08-07 vía `apply_migration`, ANTES del merge
del código (mismo patrón "DDL aditivo antes de mergear `dev`→`main`", ver
`feedback_deploy_order_migrations_aditivas`). **PR #317 (`dev`→`main`) mergeado limpio** (commit
`181a6f52`), **tag + GitHub release `v1.160.0`** publicados (`--latest`). **Vercel PROD verificado de
forma independiente por curl**: `app.genesis360.pro` sirve el bundle `assets/index-DY_QVG8v.js` con el
string `v1.160.0` literal (deployment `dpl_6jhCxXxJxiYiFjpDvpciXFY4aB7T`, target `production`, `READY`).
Antes: 001-338 EN DEV Y PROD desde v1.159.0 (deploy 2026-08-06 — PR #314, merge commit
`9caffd63b9d66282736ab9f674e8fad7f065c513`, tag+release `v1.159.0` — agrupa envío automático TN/MELI al
confirmar pago, fulfillment sync TN→despachado/entregado (mig 338), rentabilidad neta real MELI (mig
337), ubicaciones nuevas nacen con TN/MELI/picking apagados (mig 336) y el footer de conteo de
registros en Productos/Inventario/Clientes/Envíos). ⚠ `schema_full.sql` actualizado hasta la mig 343
(a mano en las migs 339-343, sin regenerar por token — ver `reference_supabase_pooler_auth_bug`) — las
migs **344, 345 y 346 todavía no están reflejadas ahí**, pendiente de una próxima regeneración.

> [!WARNING] **🛑 CORRECCIÓN — 334 y 335 NUNCA estuvieron en PROD hasta el 2026-08-08 (mig 344), pese a
> lo que este wiki decía antes.** Este documento (y [[wiki/features/ubicaciones]],
> `wiki/features/configuracion.md`, `wiki/features/precios-tiers-empaque.md`) afirmaban "334/335 ✅ EN
> PROD desde v1.158.0" — **esa afirmación era incorrecta**: `list_migrations` de PROD saltaba de 333 a
> 336 directo, las dos migraciones nunca se habían aplicado ahí. Se descubrió durante el deploy de
> v1.160.0 porque la mig 339 (Fase U5, este mismo deploy) asumía que 334 ya había reescrito 6 funciones
> SQL de WMS/Pedidos que leían `ubicaciones.tipo_ubicacion` — sin corregirlo, esas 6 funciones habrían
> quedado rotas en runtime en PROD (columna inexistente). La mig 344 (ver abajo) reaplicó el contenido
> completo de 334+335 en PROD y cerró el gap. Ver el punto 8 del bloque "ARRANCÁ ACÁ" de
> `sources/raw/project_pendientes.md` para el detalle completo de la investigación y verificación.

**344 (🛑 Fix de un gap real de deploy: reaplica 334+335 en PROD, donde nunca se habían aplicado, ✅ EN PROD desde v1.160.0 — Regla de Oro #0/inventario)** —
Sesión 2026-08-07/08, durante el cierre del deploy de v1.160.0. Hallazgo real: `list_migrations` de
PROD (`jjffnbrdjchquexdfgwq`) saltaba de 333 a 336 — las migraciones **334**
(`ubicaciones_arbol_tipo_logico`) y **335** (`producto_ubicacion_exhibicion`), commiteadas en `main`/DEV
desde v1.157.0/v1.158.0 y **documentadas en este wiki (por error) como "✅ EN PROD desde v1.158.0"**,
**nunca se habían aplicado en la base de PROD**. Era inofensivo hasta que la migración 339 de este mismo
deploy (Fase U5, dropea `ubicaciones.tipo_ubicacion`) asumió que 334 ya había reescrito las 6 funciones
SQL de WMS/Pedidos que leían esa columna (`fn_wms_elegir_ubicacion_picking`,
`fn_generar_tareas_reabastecimiento_umbral`, `fn_generar_tareas_picking_envio/pedido_stock/pedido_venta`,
`fn_lanzar_bolsa_pedidos`) — confirmado con `pg_get_functiondef` contra PROD que las 6 habían quedado
efectivamente rotas (referenciaban una columna ya inexistente, error garantizado en runtime). **Sin este
fix, cualquier lanzamiento de pedido, reabastecimiento por umbral o bolsa de picking real en PROD habría
fallado — caso real de Regla de Oro #0 (inventario).**
`344_fix_ubicaciones_backfill_gap_334_335_en_prod.sql` reaplica el contenido íntegro de 334+335
(columnas `padre_ubicacion_id`/`tipo_logico`/`subtipo_almacenamiento`/`codigo`/`pos_x`/`pos_y`/
`orientacion_deg`, los 4 triggers, el backfill de `codigo`, y el rewrite de las 6 funciones, más
`producto_ubicacion_sucursal.ubicacion_exhibicion_id` de la 335), con la única sección que ya no podía
ejecutarse tal cual (el backfill de `tipo_logico` leyendo `tipo_ubicacion`, columna que la propia 339 ya
había dropeado en este mismo deploy) reemplazada por el mismo valor neutro de fallback que 334 ya usaba
para los casos sin tipo asignado.
✅ **Verificado con SQL directo contra PROD, de forma independiente** (no solo confiado en el reporte del
fix): `select count(*) from ubicaciones` → 7 filas, 0 con `codigo` NULL, 0 con `tipo_logico` NULL (los
nodos contenedora del árbol no aplican todavía en PROD — no hay árbol armado). Las 6 funciones
confirmadas SIN ninguna referencia a `tipo_ubicacion` (`pg_get_functiondef(oid) ilike '%tipo_ubicacion%'`
→ `false` en las 6). Mismo chequeo en DEV (donde 334/335 sí venían aplicadas desde el principio): 114
ubicaciones, 0 sin código, 10 sin `tipo_logico` (correcto — nodos contenedora reales del árbol de DEV, el
guard `trg_ubic_tipo_logico_guard` no permite `tipo_logico` en un nodo con hijos, la migración los
excluye a propósito).
**Impacto de datos conocido y aceptado**: en PROD, 1 ubicación que tenía `tipo_ubicacion='camara'`
históricamente perdió esa clasificación puntual (la columna origen ya no existe en PROD, no se puede
recuperar) — reclasificable a mano desde Config, cero impacto en stock/fiscal/contable.
Commiteada en el mismo PR #317 (commit `b87667d2`). Ver el punto 8 del bloque "ARRANCÁ ACÁ" de
`sources/raw/project_pendientes.md`, [[wiki/features/ubicaciones]] (banner corregido), `log.md`
(2026-08-08, entrada `deploy` de cierre).

**343 (🧩 Motor de Rotación — ejecución real Opción 3 (kits): E3 `iniciar_armado_kit` prioriza el lote en descuento + `'kit_precio'` en `autorizaciones_inventario.tipo`, ✅ EN DEV Y PROD desde v1.160.0)** —
Sesión 2026-08-07, cont. 4, inmediatamente después de que la sesión anterior (mig 342) verificara la
Opción 2 end-to-end (spec 131). GO había scopeado E3+E2/E4 como lo independiente de la Pestaña de
supervisor (construir YA, reusando la pantalla de Kits existente de forma MANUAL, sin disparo
automático) — ver `sources/raw/relevamiento_rotacion_descuento_respuestas.md` sección E.
`CREATE OR REPLACE FUNCTION public.iniciar_armado_kit(...)`: para cada componente de la receta resuelve
`fn_rotacion_reglas_efectivas(comp_producto_id)` (mig 341) y, si `armar_kits` está activo, reordena la
reserva de líneas con `ORDER BY CASE WHEN v_armar_kits AND estado_id = ANY(v_estados_rotacion) THEN 0
ELSE 1 END, created_at` en vez de solo `created_at` — el lote en un estado que dispara Rotación se
reserva PRIMERO (prioridad, no exclusividad — mismo criterio D3 que la Opción 2: el lote en descuento
pierde prioridad para el resto, nunca queda excluido). Para componentes/tenants sin la regla activa, 0
cambio de comportamiento (el `CASE` siempre da 1). Resto de la función (validación de stock, `UPDATE
cantidad_reservada`, `INSERT kitting_log`) sin cambios respecto del original.
Extiende el `CHECK` de `autorizaciones_inventario.tipo` sumando **`'kit_precio'`** (7mo tipo, junto a
`ajuste_cantidad`/`eliminar_serie`/`eliminar_lpn`/`bulk_edit`/`ajuste_conteo`/`cambio_estado`) —
habilita el flujo de aprobación de E2 (modificar el precio de un KIT requiere autorización de
supervisor) reusando la infraestructura EXISTENTE de autorizaciones (mismo patrón que `bulk_edit`), sin
RPC `SECURITY DEFINER` nueva (no hay guard/trigger bloqueando un `UPDATE` directo a
`productos.precio_venta`, a diferencia de `cambio_estado` que sí lo tiene).
Revisada por el `migration-reviewer` antes de aplicar en DEV — sin hallazgos bloqueantes.
Lógica pura nueva `src/lib/kits.ts` (9 tests, `tests/unit/kits.test.ts`): `sugerirNombreKit`/
`sugerirPrecioKit` (E4: precio de lista × cantidad de cada componente, SIN restar descuento — el % de
estado lo aplica el mecanismo existente en el momento de la venta). UI en Inventario → Kits
(`InventarioPage.tsx`): bloque "Sugerido según la receta" con nombre (botón "Usar", aplica directo, sin
autorización) y precio (DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN aplica directo, otros roles vía solicitud
pendiente en Autorizaciones tipo `kit_precio`); `aprobarAutorizacion` extendida para aplicar
`productos.precio_venta` al aprobar + render de la lista (label "Precio de KIT", color violeta).
Agregado `precio_venta` a las queries de `kitsProductos`/`kit_recetas`.
✅ **E3 VERIFICADO end-to-end**: test permanente `tests/e2e/132_kit_armado_prioridad_rotacion_mutante.spec.ts`
(siembra su propia precondición, dispara el armado desde la UI real — Inventario → Kits → Armar →
confirmar cantidad, no llamando la RPC a mano —, verifica en la base que la reserva salió SOLO de la
línea en el estado de Rotación, la más nueva, dejando la línea normal/vieja intacta, y que
`kitting_log.componentes_reservados` apunta a la línea correcta) — **2 corridas consecutivas verdes**
contra DEV.
✅ **E2/E4 (UI de autogeneración/aprobación de precio) VERIFICADOS end-to-end en la sesión de deploy
(2026-08-07, mismo día)**: test permanente `tests/e2e/133_kit_precio_sugerido_autorizacion_mutante.spec.ts`
— rol DEPOSITO dispara el cambio de nombre (directo) y de precio (queda pendiente) desde la UI real,
DUEÑO lo aprueba desde Autorizaciones, verificado en DB en cada paso.
🟡 **E5 (desarmado de kit devuelve componentes al mismo estado de descuento) y lo que depende de la
Pestaña de supervisor (disparo automático de la Opción 3) siguen sin arrancar, a propósito** — GO
scopeó explícitamente E3+E2/E4 como lo independiente de eso.
`schema_full.sql` parcheado A MANO con los mismos 2 cambios de esta migración (mismo gotcha recurrente
de `SUPABASE_ACCESS_TOKEN` faltante para `npm run schema:dump` — no es un dump real).
Verde: tsc · build · **1538 tests unitarios** (97 archivos, 9 nuevos de `kits.ts`).
Ver [[wiki/features/precios-tiers-empaque]], `sources/raw/relevamiento_rotacion_descuento_respuestas.md`,
`sources/raw/project_pendientes.md` (bloque "ARRANCÁ ACÁ", cont. 5), `tests/e2e/133_kit_precio_sugerido_autorizacion_mutante.spec.ts`.

**342 (🔄 Motor de Rotación — ejecución real Opción 1 (agotar antes de reponer): `motivo_vencimiento` + helpers de bloqueo por sucursal, ✅ EN DEV Y PROD desde v1.160.0)** —
Sesión 2026-08-07, misma tarde que la mig 341, después de que GO cerró los 3 gaps del relevamiento
(B4/C2/E5 — ver mig 341 abajo y
`sources/raw/relevamiento_rotacion_descuento_respuestas.md`). `estados_inventario.motivo_vencimiento
boolean NOT NULL DEFAULT false` — distingue estados "por vencimiento" de otros motivos (ej. "Dañado"),
porque C3 exige que la Opción 1 solo cuente motivo vencimiento; toggle nuevo en Config → Inventario →
Estados (ícono reloj ⏰, junto al de "dispara Rotación").
Dos funciones SQL nuevas de solo LECTURA (`LANGUAGE sql STABLE`):
`fn_rotacion_productos_bloqueados_reposicion(p_tenant_id, p_sucursal_id DEFAULT NULL)` (devuelve los
`producto_id` bloqueados para reposición en un solo query — regla activa por jerarquía + stock > 0 en
esa sucursal en un estado que dispara Rotación por motivo vencimiento) y
`fn_rotacion_vencimiento_bloqueante(p_producto_id, p_sucursal_id DEFAULT NULL)` (para UN producto en
UNA sucursal, si está bloqueado y la fecha de vencimiento MÁS LEJANA entre los lotes bloqueantes, para
comparar contra el ingreso nuevo). **`p_sucursal_id` EXPLÍCITO en ambas** (parámetro, no implícito vía
RLS del usuario que llama) — GO confirmó que el bloqueo de C2 es POR SUCURSAL: el stock por vencer de
una sucursal NO bloquea la reposición de otra.
🔒 **Hallazgo real del `migration-reviewer` antes de aplicar:** faltaba `anon` en los `REVOKE` de las
2 funciones nuevas — corregido a `REVOKE ALL ... FROM PUBLIC, anon` antes de aplicar.
Ejecución real construida con estas piezas: OC sugerida (`AlertasPage.tsx`) excluye productos
bloqueados de la generación automática (badge "⏳ Rotación: no reponer aún" + conteo en el toast);
ingreso simple (`InventarioPage.tsx`) avisa (no bloquea) si la fecha nueva es más lejana que el lote
bloqueante. Pendiente NO bloqueante: el mismo aviso no se extendió al ingreso masivo ni a Recepciones.
Detalle técnico completo, incluida la Opción 2 (prioridad de envíos, `rebajeSort.ts`/`VentasPage.tsx`,
✅ VERIFICADA end-to-end en sesión posterior — encontró y corrigió un bug real: la Fase A de
`registrarVenta` consumía el plan de LPN precalculado al agregar el producto al carrito, sin prioridad
de Rotación, y nunca dejaba actuar a la Fase B — ver el bloque "ARRANCÁ ACÁ" de `project_pendientes.md`
y el test permanente `tests/e2e/131_rotacion_prioridad_envios_mutante.spec.ts`) y la Opción 3 (kits, ✅
E3 VERIFICADO end-to-end / E2-E4 construidos sin verificar en navegador desde la mig 343, ver abajo):
`G360.Wiki/sources/raw/relevamiento_rotacion_descuento_respuestas.md`.
Verde: tsc · build · 1529 tests unitarios (4 nuevos de `rebajeSort`).

**341 (🔄 Motor de Rotación de productos con descuento — SOLO esquema de configuración, sin lógica de ejecución, ✅ EN DEV Y PROD desde v1.160.0)** —
Sesión 2026-08-07, 3º de los 4 relevamientos hacia la Fase E/Repositores (ver
[[wiki/features/precios-tiers-empaque]] → "Fase E"). Respondido por Fede el 2026-08-03, GO compartió
la respuesta el 2026-08-07 — **3 preguntas con gap real (B4, C2, E5)** siguen sin cerrar (Fede
contestó algo relacionado pero distinto a lo preguntado); el resto (A1-A3, B1-B3, C1/C3, D1-D3,
E1-E4, F1-F2, G1-G3) cerró completo. A propósito **NO incluye ninguna lógica de EJECUCIÓN** (nada
bloquea reposición, prioriza envíos, ni dispara armado de kits todavía — depende de cerrar los 3
gaps), solo el esquema de configuración + su UI.
> ✅ **Actualización, misma tarde:** GO cerró los 3 gaps (B4/C2/E5) más tarde el mismo día — ver mig
> 342 arriba, donde se construyó la ejecución real de las Opciones 1 y 2.
Jerarquía de 3 niveles (producto → categoría → tenant, mismo patrón que `regla_inventario`): 4
columnas nuevas (`rotacion_agotar_antes_reponer`, `rotacion_prioridad_envios`,
`rotacion_armar_kits`, `rotacion_ubicacion_excepcion_id`) en `tenants` (default raíz, `NOT NULL`),
`categorias` y `productos` (override, `NULL` = usa el nivel de arriba).
🔒 **Hallazgo real del `migration-reviewer` antes de aplicar:** la matriz de compatibilidad (1+2
permitido, 2+3 permitido, 1+3 bloqueado) tenía un `CHECK` por fila que solo cubre el conflicto DENTRO
del mismo nivel — no impide que la resolución CRUZANDO niveles (ej. tenant con regla 1, categoría con
regla 3, cada CHECK individual pasa) termine devolviendo 1+3 activo. Resuelto con un desempate
explícito de solo LECTURA en `fn_rotacion_reglas_efectivas` (`agotar_antes_reponer` gana,
`armar_kits` se fuerza a `false`) — la validación en ESCRITURA queda para cuando se construya el
flujo de ejecución (revalidar todo el árbol de categorías/productos cada vez que cambia el default
del tenant es caro/complejo).
`estados_inventario.dispara_rotacion` (switch aparte de `descuento_pct`) + guard de mismo-tenant en
`rotacion_ubicacion_excepcion_id` (trigger, mismo patrón que `padre_ubicacion_id` de Ubicaciones) +
`GRANT`/`REVOKE EXECUTE` explícitos en `fn_rotacion_reglas_efectivas`, siguiendo la convención de
hardening.
UI nueva en Config → Inventario → Rotación (`ConfigPage.tsx`): default a nivel tenant (3 toggles con
la matriz deshabilitando en vivo + aviso), selector de ubicación de excepción, FIFO/FEFO movido ahí
desde "Reglas de stock", tabla de excepciones por categoría, toggle `dispara_rotacion` en la
sub-pestaña "Estados". Gateado a `canEdit` (DUEÑO). Probado en navegador real contra DEV (Playwright
ad-hoc, sin persistir nada).
Verde: tsc · build · 1525 tests unitarios. Detalle técnico completo:
`G360.Wiki/sources/raw/relevamiento_rotacion_descuento_respuestas.md`.

**340 (🖼️ `productos.imagen_thumb_url` — thumbnail para bajar Cached Egress de Supabase Storage, ✅ EN DEV Y PROD desde v1.160.0)** —
Sesión 2026-08-07. Investigación de por qué Supabase DEV (`gcmhzdedrkmmzfzfveig`) entró en "grace
period" por exceder la cuota de **Cached Egress** + agotar el **Disk IO Budget**: las imágenes de
producto se servían a tamaño COMPLETO (hasta 1200px/1.5MB) incluso como ícono de 32-36px, sin
`loading="lazy"`, en Productos/Inventario/POS. Columna nueva, opcional (nullable): el frontend genera
un thumbnail chico (`browser-image-compression`, `maxWidthOrHeight: 200, maxSizeMB: 0.05`) al subir
la imagen y lo guarda acá; los listados lo usan con fallback a `imagen_url` (productos ya existentes
sin thumbnail siguen funcionando, solo sin la optimización hasta que se re-suba la imagen). Sumado
`loading="lazy"` en los 4 `<img>` de producto. Verde: tsc · build · 1525 tests unitarios. **NO
probado con un usuario real subiendo una imagen en el navegador.** Ver [[wiki/features/productos]].

**339 (🧹 Fase U5 — dropea `ubicaciones.tipo_ubicacion`, columna vieja reemplazada en la mig 334, ✅ EN DEV Y PROD desde v1.160.0)** —
Sesión 2026-08-07. Cierra la limpieza pendiente desde la mig 334 (v1.157.0, rediseño de `ubicaciones`
en árbol): la columna vieja quedó reemplazada por `tipo_logico`/`subtipo_almacenamiento`. Verificado
0 lectores reales antes de aplicar: sin funciones/triggers/vistas en `schema_full.sql` que lean o
escriban la columna, sin referencias en `supabase/functions`, y en `src/` solo quedaba el tipo TS
`deprecated` (`src/lib/supabase.ts`), limpiado junto con esta migración. DROP idempotente, no afecta
datos operativos (nada consumía el valor histórico). Ver [[wiki/features/ubicaciones]].

> [!WARNING] **🐛 Deuda técnica encontrada y corregida el 2026-08-08 — la verificación de "0 lectores"
> de esta migración (y el cambio de default de la mig 336, ver abajo) no había chequeado los fixtures
> de los tests e2e.** `tests/e2e/106_wms_picking_reabastecimiento_mutante.spec.ts` y
> `tests/e2e/107_pedidos_ciclo_completo_mutante.spec.ts` seguían creando ubicaciones de prueba con
> `tipo_ubicacion: 'picking'/'bulk'/'staging'` (columna ya inexistente) y dependían implícitamente del
> viejo `DEFAULT true` de `ubicaciones.disponible_surtido` que la mig 336 cambió a `false` — 6 de 7
> tests fallaban. Fix (sin migración nueva, 100% fixtures de test): `tipo_ubicacion: 'picking'` →
> `tipo_logico: 'picking'`; `tipo_ubicacion: 'bulk'/'staging'` → `tipo_logico: 'almacenamiento',
> subtipo_almacenamiento: 'bulk'/'staging'` (mapeo real de la mig 334) + `disponible_surtido: true`
> explícito donde el stock necesita ser encontrado por `fn_generar_tareas_picking_pedido_stock`.
> **7/7 verdes en ambos specs.** No es un bug de producción — el comportamiento de ambas migraciones es
> intencional — fue puramente deuda de los fixtures de e2e, expuesta dos migraciones después. Detalle
> completo: [[wiki/features/wms]] → "Asignación de tareas a un usuario", [[wiki/features/pedidos]].

**338 (🚚 `ventas.tn_order_id` + trigger `trg_tn_fulfillment_sync` — avisa a TiendaNube al despachar/entregar, ✅ EN DEV Y PROD desde v1.159.0)** —
Sesión 2026-08-06, Fase C del roadmap de integraciones. Agrega `ventas.tn_order_id BIGINT` (ID
interno de la orden en TN, distinto de `tracking_id`/número visible al comerciante — lo necesita la
API de fulfillment-orders y `tn-webhook` ahora lo guarda en cada venta nueva). Trigger
`trg_tn_fulfillment_sync` sobre `envios` (`AFTER UPDATE OF estado`, cuando pasa a
`despachado`/`entregado` en canal `TiendaNube`) → encola job `sync_fulfillment` en
`integration_job_queue` → Edge Function nueva `tn-fulfillment-worker` → `PATCH
/orders/{id}/fulfillment-orders/{fulfillment_id}` con status `DISPATCHED`/`DELIVERED` — mismo patrón
que `trg_tn_stock_sync` (mig 062). Cron cada 5 min vía `cron.schedule` (job `tn-fulfillment-sync`) +
backup `.github/workflows/tn-fulfillment-sync.yml`. Bloqueaba esto la falta de los scopes
`read_fulfillment_orders`/`write_fulfillment_orders` en la app TiendaNube Partners (App ID 30376) —
GO los agregó y reconectó Almacén Jorgito; verificado con una llamada real (PATCH exitoso, GET
posterior confirma orden TN 1955532685 en `DISPATCHED`). MercadoLibre queda deliberadamente fuera de
esta fase. **Aplicada en PROD el 2026-08-06 junto con el resto del deploy de v1.159.0** (PR #314): el
`cron.schedule` del archivo apunta a la URL de DEV, en PROD se sustituyó a mano por la URL de PROD
(`jjffnbrdjchquexdfgwq`), mismo criterio que ya se usa con `meli-stock-sync`; confirmado que el cron
job en PROD apunta a su propia URL. Ver [[wiki/integrations/tienda-nube]], `log.md` (2026-08-06,
entrada `deploy`).

**337 (💰 `venta_items.comision_marketplace` + `ventas.impuestos_marketplace` — rentabilidad neta real MELI, ✅ EN DEV Y PROD desde v1.159.0)** —
Sesión 2026-08-06, Fase D1 del roadmap de integraciones (Fase 1.1, ⭐ killer feature). `meli-webhook`
lee `sale_fee` (comisión ML, en `order_items[]`) y `shipping_cost`/`taxes_amount` (viven en
`order.payments[]`, NO en la orden ni en `order_items` como decía el roadmap original) y los guarda en
las 2 columnas nuevas — nombres genéricos (no `meli_...`) porque `costo_envio_logistica` ya se reusa
entre TN/MELI/POS y podrían aplicar a otras integraciones futuras. `impuestos_marketplace` es la
retención del marketplace sobre el pago, **NO** el IVA fiscal de la factura (`iva_monto`, AFIP/CAE) —
conceptos separados a propósito. Badge "Neto $X" en el tab Canales de `VentasPage.tsx`
(`ganancia_neta = total − costo − comisión − envío − impuestos`). De paso, fix de un bug real
preexistente: `precio_costo_historico` quedaba siempre NULL en `venta_items` de ventas MELI. Verificado
end-to-end en DEV con un pedido real (comisión $1793, envío $8720, costo $600 → neto -$7751).
**Aplicada en PROD el 2026-08-06** junto con el resto del deploy de v1.159.0 (PR #314, EF
`meli-webhook` v10→v11). Ver [[wiki/integrations/mercado-libre]], [[wiki/integrations/roadmap-apis]]
(1.1 ✅), `log.md` (2026-08-06, entrada `deploy`).

**336 (🔒 `ubicaciones` — `disponible_surtido`/`disponible_tn`/`disponible_meli` pasan a `DEFAULT false`, ✅ EN DEV Y PROD desde v1.159.0, Regla de Oro #0)** —
Sesión 2026-08-06, pedido explícito de GO: las ubicaciones nuevas nacían con TN/MercadoLibre/
picking-venta **ENCENDIDOS** por default (`es_devolucion` ya nacía `false`, no hacía falta tocarla) —
una ubicación recién creada quedaba expuesta a sync de canales online y a picking/venta sin que el
usuario lo pidiera. `ALTER TABLE ubicaciones ALTER COLUMN ... SET DEFAULT false` en las 3 columnas,
aplicada en DEV vía `apply_migration` y verificada con `information_schema.columns` (las 4 columnas
dan `column_default = 'false'`). Único INSERT de la app a la tabla: `addUbicacion()` en
`src/pages/ConfigPage.tsx` — no hay seed de onboarding de tenant que dependa de estos defaults, así
que **no afecta tenants ni ubicaciones existentes**, solo las creadas de acá en adelante. **Aplicada
en PROD el 2026-08-06** junto con el resto del deploy de v1.159.0 (PR #314). Ver
[[wiki/features/ubicaciones]], `log.md` (2026-08-06, entrada `deploy`).

**335 (🎯 `producto_ubicacion_sucursal.ubicacion_exhibicion_id` — prepara Repositores, ✅ EN DEV desde v1.158.0; 🛑 EN PROD nunca aplicada hasta el 2026-08-08 vía la mig 344 — ver nota arriba)** —
Fede/GO, 1º de 4 relevamientos hacia Fase E (ver [[wiki/features/precios-tiers-empaque]] → "Fase
E"). Columna **nueva** (no se reinterpretó la `ubicacion_id` existente, que sigue siendo el default
de PUTAWAY al recibir stock): la ubicación de **EXHIBICIÓN** de cara al cliente, que el futuro
módulo Repositores va a necesitar para saber "qué va dónde en el piso de venta". Sin obligatoriedad
a nivel DB todavía — es una regla condicional de negocio, para una fase de UI futura. Ver
[[wiki/features/ubicaciones]].

**334 (🏗️ `ubicaciones` pasa de tabla PLANA a ÁRBOL + `tipo_logico`/`subtipo_almacenamiento`, ✅ EN DEV desde v1.158.0; 🛑 EN PROD nunca aplicada hasta el 2026-08-08 vía la mig 344 — este wiki decía "DEV y PROD desde v1.158.0", era incorrecto, ver la nota de arriba y la mig 344)** —
Fede/GO, 1º de 4 relevamientos hacia la Fase E (módulo Repositores) del backlog Comercial de Fede —
ver [[wiki/features/precios-tiers-empaque]] → "Fase E". Respondido el 2026-08-05 sobre
`relevamiento-ubicaciones-reglas-negocio.html` (generado 2026-08-02), con GO autorizando
explícitamente romper/tocar datos existentes ("no hay clientes reales, son todas pruebas — si hay
que modificar lo que ya está para que funcione con lo nuevo, que se haga").
Self-FK **`padre_ubicacion_id`** — mismo patrón que `producto_presentaciones.padre_linea_id` (mig
307), **NO** una tabla nueva de "niveles". Como `inventario_lineas.ubicacion_id`,
`wms_tareas.ubicacion_origen_id`/`ubicacion_destino_id`, `producto_ubicacion_umbrales.ubicacion_id`,
`producto_ubicacion_sucursal.ubicacion_id` y `venta_item_despachos.ubicacion_id` YA apuntan a
`ubicaciones.id`, y un nivel nuevo es también una fila de esa misma tabla, **ninguna de esas FK
necesitó re-apuntar a nada** — cero migración de datos en esas cinco tablas.
Columnas nuevas: **`tipo_logico`** (enum de negocio: `exhibicion`/`mostrador`/`picking`/
`almacenamiento`) + **`subtipo_almacenamiento`** (técnico WMS, solo válido con
`tipo_logico='almacenamiento'`: `bulk`/`estiba`/`camara`/`cross_dock`/`staging` — reemplaza al viejo
`tipo_ubicacion`) + **`codigo`** (identificador técnico autogenerado NOT NULL UNIQUE por tenant,
formato `^[A-Z0-9]+(-[A-Z0-9]+)*$`, editable) + `pos_x`/`pos_y`/`orientacion_deg` (reservados para
el proyecto pospuesto "Almacén 360", sin UI todavía).
🛑 **Regla de diseño (responde la pregunta del propio relevamiento sobre el "nivel implícito"):**
`tipo_logico` solo se puede asignar a un nodo **SIN HIJOS** — una ubicación plana de hoy YA es una
hoja, así que recibe su tipo directo en el backfill, sin crear nodos sintéticos.
**4 triggers nuevos:** anti-ciclo (`trg_ubic_no_ciclo`), guard de consistencia tipo_logico/subtipo
(`trg_ubic_tipo_logico_guard`), autogeneración de código jerárquico (`trg_ubic_autogenerar_codigo`
— raíz `U01`, `U02`... / hijo `<código del padre>-1`, `-2`...), y un **guard DURO
`trg_ubic_guard_padre_operativo`** (`SECURITY DEFINER`) que bloquea agregar un nivel bajo un padre
que tenga `tipo_logico` asignado, stock activo, umbrales de reabastecimiento configurados, o tareas
WMS pendientes — es inventario real (Regla de Oro #0), no un aviso-y-dejar-pasar.
🔒 **2 hallazgos del `migration-reviewer` antes de aplicar, corregidos:**
1. Sin `SECURITY DEFINER`, un usuario fijado a una sola sucursal podía bypassear el guard duro,
   porque `inventario_lineas`/`wms_tareas` tienen RLS por sucursal (migs 216-218) y `ubicaciones` no
   — el guard, corriendo con los privilegios de ese usuario, no veía el stock/tareas de otra
   sucursal.
2. El backfill de `codigo` hubiera arrancado en "U22" en vez de "U01" — contaba filas que todavía no
   tenían código asignado al calcular el próximo correlativo.
Backfill de las 19 filas de DEV (4 en PROD, sin tocar en esta sesión, verificado con queries reales
antes de escribir la migración): mapeo `tipo_ubicacion` viejo → `tipo_logico`/`subtipo_almacenamiento`
nuevo (`picking`→`picking`; `bulk`/`estiba`/`camara`/`cross_dock`/`staging`→`almacenamiento`+subtipo;
`NULL`→`almacenamiento` sin subtipo, valor neutro no bloqueante).
**6 funciones SQL reescritas** (el relevamiento solo esperaba 2 — un grep exhaustivo de
`schema_full.sql` encontró 4 más): `fn_wms_elegir_ubicacion_picking`,
`fn_generar_tareas_reabastecimiento_umbral`, `fn_generar_tareas_picking_envio`,
`fn_generar_tareas_picking_pedido_stock`, `fn_generar_tareas_picking_pedido_venta`,
`fn_lanzar_bolsa_pedidos` — todas ahora leen `tipo_logico`/`subtipo_almacenamiento`. De paso se
corrigió un bug latente preexistente en `fn_lanzar_bolsa_pedidos` (`<>` no rechazaba NULL, cambiado
a `IS DISTINCT FROM`).
✅ **Confirmado que NO hizo falta tocar** `vw_ubicacion_ocupacion` (migs 321/322/325) ni la
comparación de `producto_ubicacion_umbrales`: ambas ya hacían match exacto por `ubicacion_id` (nunca
agregaban por descendientes), así que ya miden "por nivel" sin cambios.
⏳ La columna vieja **`tipo_ubicacion` NO se dropeó** — 0 lectores en `src/` salvo el tipo TS marcado
`deprecated` en `src/lib/supabase.ts`; el DROP queda para una **Fase U5** de limpieza futura, mismo
patrón que F3b/F4 con las columnas fiscales de `tenants`.
Revisada por el `migration-reviewer` (2 hallazgos arriba, corregidos antes de aplicar) y verificada
con queries reales contra DEV después de aplicar (códigos únicos U01-U19 en orden histórico
correcto, `tipo_logico` seteado en las 19 filas, `fn_wms_elegir_ubicacion_picking` sigue devolviendo
exactamente lo mismo que antes — NULL, ningún tenant real tiene todavía una ubicación tipo picking)
+ pruebas del guard duro (rechazo por tipo_logico y por stock activo) y del caso positivo (código
jerárquico `U06-1`/`U06-2`), todo en transacciones con ROLLBACK.
Frontend (Fases U3/U4) y detalle completo: [[wiki/features/ubicaciones]].

**333 (🔒 guard server-side de la aprobación de cambio de estado, EN DEV y PROD, cierra hallazgo H1)** —
Sesión 2026-08-04, al escribir el e2e de la mig 331: el gate de "cambio de estado con foto" vivía
100% en el cliente — un `PATCH` directo por REST a `inventario_lineas.estado_id` se saltaba
foto+autorización+notificación. Trigger `fn_inventario_estado_aprobacion_guard` (BEFORE UPDATE,
mirror server-side de `requiereAuthAjuste`/`ajuste_autorizacion_roles`, mig 228 — bloquea solo el
modo `'siempre'`, deja pasar `'directo'`/`'umbral'`) + RPC `aprobar_cambio_estado_inventario`
(SECURITY DEFINER, única vía sancionada para aplicar un cambio ya aprobado — valida rol
DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN + tenant, atómico, single vía `linea_id` o batch vía
`datos_cambio.linea_ids`). Exención vía GUC transaction-local
(`genesis360.aprobando_estado_inventario`, no alcanzable por un cliente REST) para el RPC Y para
`process_aging_profile_single`/`process_aging_profiles` (hallazgo del `migration-reviewer`: sin la
exención, "Procesar Aging" se rompía en cuanto un tenant mapeara una regla hacia un estado con
aprobación). El DUEÑO queda exento por default (bypass intencional, confirmado con GO — hallazgo
H2, ver [[wiki/features/inventario-stock]] → "Aprobación de cambio de estado con foto"). Frontend
(`InventarioPage.tsx`) rewireado para llamar al RPC. Cubierto por e2e 117/118/120/121/126
(`tests/specs/uat-modo-basico.md` §49).

**332 (🎟️ cupones — descuento FIJO en $ sobre el TOTAL de la venta, EN DEV y PROD)** —
Fede 25/7, punto 2 (dentro del módulo Comercial). Tablas nuevas: `cupones` (campaña — nombre, motivo,
`monto` fijo en $, CHECK > 0 — **nunca %** —, `vigencia_desde`/`vigencia_hasta` NOT NULL, `activo`,
`created_by`) y `cupones_codigos` (código alfanumérico único **por tenant** —
`UNIQUE(tenant_id, codigo)`, no global, porque dos negocios distintos pueden reusar el mismo texto de
código sin problema, RLS los aísla —, `usado_en_venta_id` nullable FK a `ventas`
`ON DELETE SET NULL`, `usado_at`).
`ventas` gana **`cupon_codigo_id`** (con **`UNIQUE`**, sugerencia del `migration-reviewer` para
blindar a nivel de CONSTRAINT que un mismo código no quede aplicado a dos ventas) + **`cupon_monto`**
(snapshot del $ descontado — el cupón puede cambiar de monto o desactivarse después y la venta ya
facturada tiene que preservar lo que realmente se cobró, Regla #0). RLS tenant-scoped en ambas tablas
+ `REVOKE ALL FROM PUBLIC, anon` (mismo patrón que la mig 298).
🔒 **Decisión de diseño sobre la condición de carrera, consultada con el `migration-reviewer` ANTES
de escribir código, no un gap descubierto después:** no se construyó una RPC dedicada de canje — el
`UPDATE cupones_codigos SET usado_en_venta_id = X WHERE id = Y AND usado_en_venta_id IS NULL` es
**atómico por sí solo a nivel de FILA** (Postgres serializa el `UPDATE`), así que alcanza con
chequear que el `UPDATE` afectó exactamente 1 fila. Se acepta el trade-off de una ventana TOCTOU
sub-segundo sobre `activo`/vigencia (irrelevante en un POS de un cajero por terminal, no un
e-commerce de alta concurrencia) en vez de sumar una función nueva.
Lógica pura en `src/lib/cupones.ts` (11 tests nuevos, `tests/unit/cupones.test.ts`): `cuponVigente`
(mismo criterio que `comboVigente`), `montoDescuentoCupon` (nunca descuenta más que el total),
`generarCodigosCupon`/`generarCodigoCupon` (alfabeto de 32 símbolos sin caracteres ambiguos — sin
O/0, sin I/1 —, `crypto.getRandomValues`, clampeado a `CUPON_CODIGOS_MAXIMO = 100`).
UI de alta/gestión en Config → Ventas → Descuentos y combos (card "Cupones", **temporal** ahí hasta
que exista el módulo Comercial dedicado — mismo criterio que Combos hoy). Canje en el POS
(`VentasPage.tsx`): input en la sección de Descuento general del carrito → se resta del total
**ANTES** del descuento por método de pago (Config → Ventas → Métodos de pago → Promo) — así el % que
descuenta un medio de pago se calcula sobre lo que el cliente REALMENTE va a pagar después del
cupón, no sobre el total original de la mercadería. Al confirmar la venta se re-valida el cupón en
fresco (por si pasó tiempo o alguien más lo usó) ANTES de crearla — si ya no es válido, corta antes de
cobrar; después de crear la venta se hace el `UPDATE` condicional atómico que marca el código usado,
y si por una carrera perdida afecta 0 filas, avisa con un toast en vez de deshacer una venta que ya
quedó asentada en caja.
🛑 **Prorrateo fiscal (Regla #0):** `hayDescGlobal` (dispara `prorratearDescuentoGlobal`, que reparte
el descuento global sobre `venta_items` para que factura/NC/Libro IVA sumen EXACTO lo que el cliente
pagó) ahora incluye el monto del cupón — sin este cambio, una venta con SOLO cupón (sin descuento
general/combo/promo) se hubiera facturado por el monto SIN el descuento del cupón, mismo bug que ese
código ya previene para los demás descuentos globales.
Alcance: solo el POS — no se tocó Pedidos (su config ya aclara que no aplica combos ni lista de
precios por canal; cupones tampoco se extendió ahí, coherente con esa limitación ya documentada). Ver
[[wiki/features/precios-tiers-empaque]] → Fase C.

**331 (🛑 aprobación de cambio de estado con foto — control anti-fraude, EN DEV y PROD)** —
Fede 25/7, punto 2. `estados_inventario.requiere_aprobacion` (boolean, default false), **independiente**
de `descuento_pct` (mig 284) — un estado puede requerir aprobación sin tener descuento asociado (ej.
"Eliminado" da de baja stock pero no rebaja precio), y viceversa. Se agrega `'cambio_estado'` al CHECK
de `autorizaciones_inventario.tipo` (mismo patrón que la mig 103 con `bulk_edit`). Bucket de Storage
privado nuevo **`autorizaciones-fotos`** — a diferencia de `etiquetas-envios` (mig 075, sin scoping),
este SÍ se scopea por tenant vía `storage.foldername(name)[1]` (mismo criterio que `certificados-afip`,
mig 043), porque son fotos de evidencia de fraude interno, más sensibles — hallazgo y sugerencia del
propio `migration-reviewer` antes de aplicar en DEV. Solo imágenes, 5MB máx.
Wireado en `LpnAccionesModal.tsx` (cambio de UN LPN) y `InventarioPage.tsx` (cambio masivo — cerró de
paso un bypass real: el cambio masivo escribía `estado_id` directo sin pasar por NINGÚN gate, ni este
ni el de cantidad, mig 228). Detalle completo:
[[wiki/features/inventario-stock]] → "Aprobación de cambio de estado con foto".

**330 (💵 `fn_precio_venta_efectivo` replica el motor de tiers % + enlace a empaque, EN DEV y PROD, 🛑 PLATA)** —
Fede 25/7, punto 1. La función que usa Pedidos (`fn_pedido_generar_venta`, migs 317/319) para facturar
por fuera del POS reescribe con el MISMO algoritmo que `src/lib/tiers.ts`
(`resolverBloquesTier`/`precioBlendedTier`): los tiers ENLAZADOS a una presentación
(`presentacion_id`, mig 329) se evalúan contra múltiplos completos de esa línea, compiten entre sí y
ese bloque compite contra el mejor tier NORMAL para esa misma cantidad; el resto se evalúa aparte y el
precio final es el promedio ponderado que preserva la plata total exacta. Sin ningún tier enlazado que
matchee, el comportamiento es IDÉNTICO al de siempre (gana el primer tier normal en `orden` asc) —
**verificado con datos REALES de DEV: resultado matemáticamente idéntico al de antes de esta migración
para todos los tiers hoy cargados** (ninguno tiene `presentacion_id`). Sin este cambio un Pedido
armado a mano facturaría distinto que la misma venta cargada por el POS (Regla #0, fuente única de
precio).

**329 (💵 tiers mayoristas: % de descuento + enlace opcional a empaque, EN DEV y PROD, 🛑 PLATA)** —
Fede 25/7, punto 1 ("el caso del pallet"): un tier mayorista puede enlazarse a una línea puntual del
árbol de empaque y el descuento se multiplica automático para cualquier múltiplo exacto (1, 2, 3
pallets...) sin cargar un tier por cada uno. `producto_precios_mayorista` gana **`tipo_valor`**
('precio_fijo' default/legacy | 'pct' — % sobre el precio de LISTA, `productos.precio_venta`, NUNCA
sobre uno ya rebajado por otra capa, CHECK 0-100) + **`presentacion_id`** (FK nullable →
`producto_presentaciones(id)`, `ON DELETE SET NULL`; si está seteado, `cantidad_minima` se compara
contra MÚLTIPLOS COMPLETOS de esa presentación, no unidades sueltas).
🛑 **Guard nuevo, hallazgo del `migration-reviewer` antes de aplicar:** trigger
`trg_ppm_presentacion_mismo_producto` — el FK por sí solo no impide enlazar la presentación de OTRO
producto (o, ya que los checks de FK no pasan por RLS, hasta de otro tenant); sin el guard un tier de
"Producto A" podría apuntar a la presentación de "Producto B" y el multiplicador de cantidad quedaría
calculado contra el `factor_base` equivocado.
Sigue alineado con la mig 307 (el empaque no tiene precio propio): esto no le agrega precio a
`producto_presentaciones`, solo la referencia desde el tier — la línea de empaque sigue siendo 100%
logística. Ver [[wiki/features/precios-tiers-empaque]].

**328 (🏷️ tipo de empaque — categoría informativa, EN DEV y PROD, sin Regla #0)** —
Fede 25/7, punto 6. `unidades_medida.tipo_empaque` (texto libre, **sin CHECK a propósito** — mismo
criterio que `combos.descuento_tipo`: lista abierta que puede crecer sin migración, la UI valida
contra una constante fija) + backfill de las predefinidas que sobrevivieron a la limpieza de la mig
327 (Caja/Pallet/Unidad). **Puramente informativo/reportes, sin función técnica** — no se cruza con
el enlace tier↔empaque de la mig 329, que usa `producto_presentaciones.id` (identidad de línea), no
esta columna. Ver [[wiki/features/precios-tiers-empaque]].

**327 (🧹 limpieza del catálogo de Empaque — dropea unidades físicas coladas por la mig 148, ✅ PROD 2026-07-29)** —
Config → Inventario → Empaque mostraba "Kilogramo"/"Gramo"/"Litro"/"Metro" junto a "Caja"/"Pallet"
(hallazgo de GO). `unidades_medida` es hoy el catálogo de nombres de EMPAQUE
(`producto_presentaciones.nombre_empaque_id`), pero la mig 148 (2026-05-28, previa al rediseño
UoM/Empaque de las migs 303-308) sembró ahí 5 unidades FÍSICAS de cuando la tabla servía para las
dos cosas a la vez. Verificado con datos reales ANTES del DELETE, en las **7 FK** que referencian
`unidades_medida(id)` (no solo las 2 obvias): `producto_presentaciones.nombre_empaque_id` ·
`inventario_lineas.unidad_medida_id` · `combos.unidad_medida_id` · `movimientos_stock.unidad_medida_id` ·
`producto_estructura_niveles.unidad_medida_id` · `reglas_almacenaje.unidad_medida_id` ·
`venta_items.unidad_medida_id`. `Gramo`/`Kilogramo`/`Litro`/`Metro`: 0 usos en las 7, en TODOS los
tenants de DEV y PROD → se dropean, con guards `NOT EXISTS` (defensa en profundidad) por si algún
tenant no relevado tuviera un uso real.
🛑 **"Unidad" se deja afuera a propósito**: tiene uso histórico real en DEV (53+40 filas de
`producto_estructura_niveles`, la tabla vieja marcada "no se dropea, es histórico" desde la mig 311;
2 filas de `movimientos_stock`, ledger inmutable con `ON DELETE SET NULL`) — tocarla habría borrado
trazabilidad real en silencio. Regla #0: no se reescribe histórico.
Se actualiza también `fn_seed_tenant_defaults` para que los tenants nuevos no reciban más la
siembra vieja. Revisado por `migration-reviewer`: apta sin correcciones.

**326 (📦 el reabastecimiento elige una posición de picking QUE TENGA LUGAR, ✅ PROD 2026-07-29)** —
Paso 4 del cubicaje. `fn_wms_elegir_ubicacion_picking` (mig 290) elegía el destino de una tarea
bulk→picking mirando solo si la posición ya tenía stock de ese producto, y después secuencia y
prioridad: **nunca miraba la ocupación**, así que podía mandar un pallet a una cara ya al tope y el
operario llegaba y no entraba. Ahora, con `vw_ubicacion_ocupacion` calculando LPN, peso y volumen
(migs 321/322/325), la ocupación entra como criterio.
🛑 **La capacidad DESEMPATA, nunca EXCLUYE:** si están todas llenas, sigue devolviendo una. Filtrarlas
dejaría la tarea **sin destino** y el stock nunca llegaría al picking — un dato de configuración
cargado a mano frenando mercadería real. Mismo criterio que la UI: avisa, no bloquea.
🛑 **Sin capacidad configurada no cambia nada:** "sin lugar" exige un tope CONFIGURADO y ALCANZADO;
un campo vacío es "no sé", y no sé nunca degrada una posición (si no, todos los tenants que nunca
cargaron capacidad verían su orden de picking reordenado en silencio por el deploy).
Se agrega un desempate final por `u.id` (la 290 terminaba en secuencia/prioridad y Postgres no
garantiza sort estable → el mismo SKU podía ir a dos caras distintas en reabastecimientos seguidos).
Espejo JS: `ubicacionSinLugar()` en `src/lib/medidasLogistica.ts` (10 tests).
⏳ **Pendiente de medir:** `EXPLAIN ANALYZE` contra un tenant con volumen real — la función se llama
una vez por ítem y la vista es un agregado (acotado por RLS al propio tenant, pero sin medir).

**325 (🐛 la vista de ocupación NUNCA encontraba la presentación de una línea — fix de la 322, ✅ PROD 2026-07-29)** —
Tres defectos en `vw_ubicacion_ocupacion`, encontrados al construir el frontend del cubicaje:
**(1) el JOIN comparaba dos tipos de ID distintos.** La 322 unía `producto_presentaciones.id =
inventario_lineas.unidad_medida_id`, pero esa columna referencia `unidades_medida(id)` — el catálogo
de EMPAQUES ("Caja", "Pallet"), no una presentación (mig 293). Verificado en DEV: de las líneas
activas con `unidad_medida_id`, **0 matcheaban por `pp.id` y todas por `unidades_medida.id`**. Como
además la columna no es NULL en esas filas, tampoco entraba el fallback a la base → **aportaban 0 m³**.
O sea: las líneas que entraron en BULTO, las que más volumen ocupan, quedaban en cero, y el error
empuja hacia "parece que hay lugar" — exactamente lo que el cubicaje quería evitar.
**(2) el arreglo obvio duplicaba filas.** Unir por `nombre_empaque_id` a secas multiplica la línea
cuando hay **hermanas** con el mismo empaque ("Caja-12" y "Caja-10" cuelgan las dos del empaque
"Caja"; en DEV hay 8 grupos así, uno con 3) → `lpn_activos` y `peso_kg` inflados ×2/×3: una ubicación
con 3 LPN diría "6 de 4". Se resuelve con **`LEFT JOIN LATERAL … LIMIT 1`**, que estructuralmente no
puede duplicar. Verificado post-fix: 348 LPN en la vista = 348 en el conteo crudo, 0 discrepancias en
46 ubicaciones.
**(3) `cantidad_uom` es un snapshot de INGRESO y se pone viejo.** La 322 lo usaba como primera fuente
de la cantidad; `cantidad` cambia con cada venta/ajuste y él no (en DEV hay líneas con `cantidad = 48`
y `cantidad_uom = 60`). Ahora la cantidad se **deriva del stock actual** (`cantidad / factor_base`) y
`cantidad_uom` queda solo como desempate entre hermanas.
⚠ **Gotcha de Postgres detectado en review:** `il.cantidad` es `integer` y `factor_base` `bigint` → sin
`::numeric` la división **trunca**: 48 unidades en cajas de 10 daban 4 bultos en vez de 4,8 y el peso
salía ~17% corto, justo en el dato que decide si un rack está sobrecargado (seguridad física).
Se aprovechó para que el **peso** use el del NIVEL cuando está cargado (incluye el embalaje: una caja
de 12 pesa más que 12 unidades sueltas) y caiga a `productos.peso_kg` si no.

**324 (no se lanza un pedido cuya venta no está viva, ✅ PROD 2026-07-29)** —
Engancha el guard de la 323 al dispatcher de "Lanzar" (que es chico), y no dentro del algoritmo de
picking: cubre los dos caminos con una línea sin volver a tocar el cuerpo que mueve stock.

**323 (🐛 un PRESUPUESTO no genera pedido + anular la venta cancela su pedido, ✅ PROD 2026-07-29)** —
Dos huecos que encontró GO usando el flujo real: una **venta recurrente** generó un PRESUPUESTO, el
presupuesto generó un PEDIDO, y al cancelarse el presupuesto quedó **un pedido vivo** que cualquiera
podía lanzar, mandando al depósito a preparar mercadería de una venta que ya no existe.
**(1)** Error de criterio de la mig 318: incluí `'pendiente'` entre los estados que generan pedido
razonando "la mercadería no salió". Pero `ventas.estado = 'pendiente'` **ES UN PRESUPUESTO** — el
ticket dice literalmente "★ PRESUPUESTO ★". No hay compromiso: el cliente no aceptó, no pagó y puede
no convertirse nunca. El pedido nace cuando el presupuesto **se convierte** (el trigger ya escucha
`UPDATE OF estado`). Se suma `'facturada'` a los estados vivos.
**(2)** Trigger nuevo `trg_ventas_anulada_cancela_pedido`: cancelar o devolver la venta cancela su
pedido y sus tareas de picking pendientes. ⚠ **NO toca `cantidad_reservada`**: en un venta-pedido el
picking nunca reservó (mig 316) — la reserva es de la VENTA, y liberarla acá la liberaría DOS veces.
Por eso las tareas se cancelan con UPDATE directo y no con `fn_cancelar_tarea_wms`, que sí libera.
Incluye limpieza de los pedidos que ya habían quedado mal (1 en DEV), sin tocar los entregados.

**322 (📦 CUBICAJE VOLUMÉTRICO opt-in — FASE A, ✅ PROD 2026-07-29)** —
`tenants.cubicaje_habilitado` (default **false**) + `cubicaje_factor_aprovechamiento` (default 0.70,
CHECK 0 < f ≤ 1). Con el cubicaje activo, el trigger `trg_presentaciones_exige_medidas` **no acepta**
una presentación sin peso ni las tres medidas — así la cobertura es 100% por construcción de ahí en
adelante, que es lo que responde al reparo de siempre ("con medidas a medias el número miente").
Server-side porque la UI se cachea y el importador/EFs escriben con service_role.
`vw_ubicacion_ocupacion` se amplía con **`volumen_m3`** (calculado sobre la presentación en la que
ENTRÓ cada línea: "3 cajas" ocupa 3 × el volumen de la caja) y `lineas_con_volumen`.
`fn_cubicaje_cobertura(tenant)` devuelve cuántos productos tienen TODAS sus presentaciones medidas —
prender el toggle NO completa el catálogo existente (en DEV: **6 de 296**).
⚠ El cálculo de `volumen_m3` de esta migración **no funcionaba**: el JOIN a la presentación nunca
matcheaba. Corregido en la **mig 325**. Frontend completo (Fases A/B/C) en **v1.150.0**.

**321 (conecta la capacidad de `ubicaciones`, que nadie leía, ✅ PROD 2026-07-29)** —
Los campos `largo/ancho/alto_cm`, `peso_max_kg` y `capacidad_pallets` existían desde la **mig 032** y
**ningún cálculo los usaba**: se cargaban en Config y no servían para nada. Vista nueva
`vw_ubicacion_ocupacion` (`security_invoker`, respeta RLS) con LPN activos y peso total por
ubicación, más `lineas_con_peso`/`lineas_total` para la **cobertura**. ⚠ Si faltan `productos.peso_kg`
el total queda CORTO — el error empuja hacia "parece que hay lugar" justo cuando el rack podría estar
pasado; por eso la UI muestra la cobertura con ⚠ y el aviso salta al 90% del límite, no al 100%.
Avisa, nunca bloquea.

**320 (🐛 el picking de un venta-pedido no sabía de dónde sacar la mercadería, ✅ PROD 2026-07-29)** —
Bug que encontró GO probando el flujo real (venta #448, una RESERVA): la tarea de picking salía
**sin LPN y sin ubicación**. `fn_generar_tareas_picking_pedido_venta` leía SOLO
`venta_item_despachos`, que se escribe al **despachar** (ISS-075) — una venta **reservada** todavía
no tiene ninguna fila ahí: su plan de LPN vive en `venta_items.lpn_plan` (mig 156), que es donde el
POS guarda el LPN elegido, incluida la elección MANUAL del cajero. Y como el pedido nace justamente
de reservas, el caso más común caía SIEMPRE al fallback "sin desglose por LPN".
Se reemplaza por una **cascada de fuentes**, de la más precisa a la más genérica y **sin reservar
nada** (la venta ya comprometió el stock): (1) `venta_item_despachos` · (2) `venta_items.lpn_plan`
resolviendo la ubicación desde la línea · (3) líneas con `cantidad_reservada > 0` en FEFO, solo
lectura · (4) cualquier línea con stock. Si nada matchea, la tarea sale igual pero las notas dicen
"⚠ sin stock ubicado para este producto" en vez de quedar en blanco.
Verificado contra la venta #448: la tarea regenerada apunta a `LPN-20260619-24B551` en `RACK1`.

**319 (💵 el Pedido factura el DESCUENTO POR ESTADO, ✅ PROD 2026-07-29)** —
Cierra el pendiente que la 317 dejó anotado. Un Pedido facturaba **sin** aplicar el descuento por
estado de inventario (migs 284-285): la MISMA mercadería salía más cara entregada por Pedidos que
vendida por mostrador, y `venta_items.descuento_estado_pct/_monto` quedaban vacíos (ni la factura ni
el ticket mostraban el descuento que el cliente sí esperaba). No se pudo hacer en la 317 porque el
precio y el `INSERT` del `venta_items` se escriben ANTES del loop que elige de qué líneas sale el
stock, y el descuento depende del estado de ESAS líneas: se acumula dentro del loop y se aplica al
final sobre subtotal, IVA y los acumuladores de la venta. Prorrateado **por fuente** (cada unidad
según el % del estado de SU línea, nunca un promedio — mismo criterio que
`calcularDescuentoEstadoLinea` del POS); con dos estados distintos el `pct` queda NULL pero el monto
es la suma exacta, mismo contrato que graba el POS.

**318 (regla del pedido por TIPO DE ENTREGA, ✅ PROD 2026-07-29)** —
Reescribe la regla de la 315 según el diagrama de flujo de GO: **todas las ventas generan pedido
MENOS la entrega directa** (canal presencial + despachada + sin envío). Deriva de
`canales_venta.clasificacion` (mig 168) — no hay nada que configurar y es correcto por default.
🛑 Tres cambios de fondo: (a) **el gate de pago se mueve de la CREACIÓN a la ENTREGA** — la reserva
y el retiro con pago parcial se preparan igual, y `fn_pedido_entregar_retiro` es el que no deja
salir mercadería sin saldar (salvo cuenta corriente); (b) `pedido_canales_auto` se **renombra** a
`pedido_canales_excluidos` e invierte su sentido (pasa a ser la excepción); (c) **faltaba el
envío** — `fn_generar_tareas_picking_pedido_venta` no lo creaba, y ahora además el trigger de
`envios` **crea el pedido** si no existía, que es el caso "mostrador + envío", imposible de detectar
en el INSERT de la venta porque el envío se inserta en una llamada HTTP posterior.

**317 (💵 el pedido manual facturaba a PRECIO DE LISTA + pedido manual opt-in, ✅ PROD 2026-07-29)** —
`fn_pedido_generar_venta` ponía `v_precio := COALESCE(productos.precio_venta, 0)` y nada más: sin
tiers por volumen (mig 306), sin redondeo del tenant (H4). De los 4 tipos de pedido sembrados por
default, **"Mayorista" era el que peor salía** — facturaba a precio minorista. Se extrae
`fn_precio_venta_efectivo` (espejo SQL de `precioTierBase` + `redondearPrecio`) y el tier se resuelve
contra el **total pedido** del SKU, no contra lo que se entrega en la tanda: entregar en dos veces no
puede hacer perder el precio por volumen. Además `tenants.pedido_manual_habilitado` (default
**false**): crear un pedido a mano pasa a ser opt-in — para una PyME casi todos los casos tienen hoy
un camino mejor (encargo sin cobrar = venta `pendiente`, armado sin cliente = traslado), y el único
que solo resuelve Pedidos es el mayorista con entregas parciales.
⚠ El cuerpo de `fn_pedido_generar_venta` se copió del archivo de la mig 299 y se editó
programáticamente: son ~270 líneas que mueven stock, plata y caja, y re-tipearlas para cambiar una
es donde se cuela un error silencioso.

**316 (🛑 REGLA #0 — guards del flujo Venta → Pedido + entrega en mostrador, ✅ PROD 2026-07-29)** —
Lo que hace SEGURO lo que abrió la 315. Un pedido con `venta_origen_id` ya tiene su venta, su plata y
su stock resueltos, así que entrar al ciclo normal de Pedidos lo rompería de dos formas silenciosas:
**(1) doble venta** — `fn_pedido_generar_venta` (mig 295) crea una venta nueva, vuelve a rebajar stock
y vuelve a asentar caja; **(2) doble reserva** — `fn_generar_tareas_picking_pedido` (mig 294) reserva
`cantidad_reservada`, pero si la venta era una RESERVA esas unidades ya están reservadas por ella (se
reservaría el doble y el POS diría "sin stock" habiendo), y si era DESPACHADA el stock ya salió de
`cantidad` (reservaría unidades de otras líneas). **Probado por mutación en DEV: por el camino viejo
se habrían reservado 4 unidades de más.**
Piezas: trigger `BEFORE INSERT ON ventas` que rechaza la segunda venta (se hace por trigger y no
editando la RPC para cubrir CUALQUIER camino de escritura, no solo el que conocemos) ·
`fn_generar_tareas_picking_pedido_venta` nueva, que arma el picking desde `venta_item_despachos` (el
LPN REAL que ya eligió la venta, ISS-075) y **no toca `cantidad_reservada`** · la RPC original se
**renombra** a `fn_generar_tareas_picking_pedido_stock` y queda un dispatcher chico con el nombre
viejo (se renombra en vez de re-escribir el cuerpo: son ~150 líneas que mueven stock y volver a
tipearlas para insertar cuatro es donde se cuela un error silencioso; los GRANT siguen a la función) ·
`fn_pedido_entregar_retiro` para el mostrador (NO toca plata ni stock; deja el rastro en Envíos como
`retiro_local`/`entregado` y devuelve la venta para facturarla).
**Además cierra un hueco preexistente:** `listo_para_entrega` era un **estado MUERTO** — estaba en el
CHECK desde la mig 292, la UI le tenía badge y 3 RPCs lo leían como precondición, pero **ningún código
lo seteaba nunca**. Ahora completar la última tarea de picking del pedido lo promueve.
Ver [[wiki/features/pedidos]] y `tests/specs/uat-modo-basico.md` §47.

**315 (Pedido automático desde una VENTA, ✅ PROD 2026-07-29)** —
Pedido de GO: las ventas de ciertos canales generan solo un Pedido de preparación; las **reservas**
solo cuando están **100% pagadas**. 🛑 **Invierte el sentido del flujo original (F4)**: hasta acá el
único puente era Pedido → venta. Config nueva `tenants.pedido_canales_auto` (array de
`canales_venta.id`; `[]` = apagado, ningún tenant existente cambia de comportamiento) +
`pedidos.venta_origen_id` (con UNIQUE parcial: una venta genera a lo sumo un pedido) +
`fn_canal_de_origen` (espejo SQL de `ORIGEN_ALIAS` de `useCanalesVenta.ts` — mantener sincronizados).
Se hace **server-side** y no en el POS a propósito: así también cubre las ventas que entran por
webhook de marketplace o por el importador, que nunca pasan por `registrarVenta`.
💵 La condición del 100% suma el costo de envío: `ventas.total` NO lo incluye pero `monto_pagado` SÍ
(ISS-105) — compararlo contra `total` a secas habría generado el pedido cobrando de menos.
⚠ Detalle que obligó a un segundo trigger: `registrarVenta` inserta la venta y sus `venta_items` en
llamadas HTTP **separadas**, así que cuando corre el `AFTER INSERT` de `ventas` **no existe ni una
línea**. Las líneas las completa un trigger **statement-level** sobre `venta_items`
(`fn_pedido_sync_items_desde_venta`, idempotente y solo mientras el pedido sigue en `confirmado`).
🛑 El trigger va envuelto en `EXCEPTION WHEN OTHERS` + `RAISE WARNING`: **una VENTA nunca se cae por
un documento de logística** — un pedido que no se pudo crear se regenera, una venta perdida en el
mostrador no. Guard anti-loop: una venta nacida de un pedido nunca genera otro pedido.

**314 (🛑 guard de modelo de variante: madre/hijo vs. Atributos de variante, ✅ PROD 2026-07-29)** —
Reconstruye sobre el modelo madre/hijo el guard que la **mig 274** tenía sobre `grupo_id` y que
**desapareció** al dropear esa columna en la **mig 311**: entre una y otra nada impedía que un mismo SKU
fuera variante madre/hijo (`producto_padre_id`) **y** tuviera atributos de variante a nivel LPN
(`tiene_talle`/`tiene_color`/…) encima — dos modelos de stock incompatibles. Decisión de GO: los dos
sistemas coexisten en la app (Eje A) pero **no dentro del mismo producto**.
Dos piezas, porque un CHECK no puede mirar otras filas: **CHECK `chk_productos_variante_sin_atributos`**
(el hijo no puede tener atributos — table-local, garantía dura) + **trigger
`trg_productos_variante_atributos`** (la madre: ni encender un atributo teniendo hijos, ni crearle la
primera variante teniendo atributos). Apagando los atributos el camino se destraba, así que nunca queda
un callejón sin salida; un standalone con atributos sigue siendo válido (el modelo NO se depreca).
`SECURITY DEFINER` a propósito — un guard no puede fallar ABIERTO si la RLS le esconde la fila de la
madre; los dos `SELECT` filtran por `NEW.tenant_id`, así que no hay fuga cross-tenant. El
`BEFORE INSERT OR UPDATE OF <cols>` acota el disparo: `recalcular_stock` y la propagación de nombre no
lo despiertan (verificado con 5 negativos en DEV).
**Verificado ANTES de aplicar (datos REALES):** DEV 404 productos / 42 hijos / 17 madres / 65 con
atributos → **0 en violación**; PROD 23 / 0 / 0 / 1 → **0 en violación**. Entró sin tocar un dato.
⚠ **Nota de modelo:** la razón técnica de la mig 274 ("la UI de Grupo de variantes no pedía el talle") ya
no aplica — un hijo es un producto normal. Hoy esto es una decisión de negocio: si se quisiera el híbrido
"color = SKU separado, talle = atributo de LPN", alcanza con dropear el CHECK y el trigger.
Ver [[wiki/features/atributos-variante]] "Guard de modelo de variante".

**313 (reasignar stock de productos SERIALIZADOS + levanta el guard de la 312, EN DEV y PROD, 🛑 MUEVE STOCK)** —
Cierra el último pendiente del rediseño UoM. `fn_reasignar_stock_variante` pasa a aceptar, por asignación,
la **LISTA de series** a mover (`"series":[uuid,...]`) en vez de una cantidad: en un producto con número
de serie cada unidad ES una serie concreta y hay que decir CUÁL va a CUÁL variante, o el historial de esa
unidad física (garantía, RMA, recall) queda bajo el SKU equivocado.
**Verificado contra el modelo real (no asumido):** `recalcular_stock` cuenta `inventario_series` y NO
`inventario_lineas.cantidad` para estos productos (en DEV hay uno con `sum(cantidad)=100` y 26 series);
`inventario_series` ya tiene trigger `series_recalcular_stock`, así que mover una serie de producto
recalcula ambos lados solo. Por eso lo que se mueve son las FILAS DE SERIE.
**Decisión de diseño:** en serializados NUNCA se re-apunta la línea, SIEMPRE nace un LPN nuevo — una línea
puede tener series INACTIVAS (ya vendidas) que pertenecen al historial de la madre y no se pueden
re-etiquetar; re-apuntar dejaría `serie.producto_id ≠ linea.producto_id`. El LPN viejo se desactiva si se
queda sin series activas, conservando su historial.
Guards: serie de otra línea/vendida/reservada, la misma serie a dos variantes, serializado sin mandar
series, y destino que no maneja series igual que la madre. Se bloquean también las FILAS DE SERIE con
`FOR UPDATE` (el lock de la línea no frena una venta concurrente que consuma una serie).
Además **levanta el guard de la mig 312**: ya no hay callejón sin salida, así que un serializado con stock
vuelve a poder convertirse en agrupador.

**312 (🛑 guard: no convertir en agrupador un producto SERIALIZADO CON STOCK, EN DEV y PROD)** —
Cierra un hueco abierto por la propia mig 309. Esa migración desbloqueó crear la primera variante de un
producto CON stock (queda "sin variante asignada" y se reparte después), pero
`fn_reasignar_stock_variante` **rechaza a propósito** los productos con número de serie: repartir "6 y
4" sin decir QUÉ serie va a cada variante rompería la trazabilidad. Combinadas, dejaban una **trampa**:
el stock de un serializado convertido en agrupador quedaba **atrapado** — no vendible (la madre con
hijos no se vende) y no reasignable. Se agrega el guard en `trg_variante_compose_nombre` (server-side,
porque la UI se cachea y el importador/EFs escriben con service_role), que bloquea SOLO la conversión en
agrupador (madre todavía sin hijos); agregarle otra variante a un agrupador existente no se toca.
Acompañado del mismo bloqueo en `ProductoFormPage` con un mensaje que explica qué hacer.

**311 (rediseño UoM — FASE 5 chunk C: limpieza del modelo viejo de variantes, EN DEV y PROD)** —
DDL destructivo: se **dropean `producto_grupos`, `productos.grupo_id` y `productos.variante_valores`**
(modelo de variantes de la mig 120, reemplazado por madre/hijo `producto_padre_id` en la mig 305). Antes
de dropear se **preserva en `notas`** el dato de los productos que la mig 305 dejó sin migrar a propósito
(grupos de 1 producto — en DEV era uno solo, "Talle: S"). ⚠ NO confundir con el **Eje A** (atributos de
variante a nivel LPN: `inventario_lineas.talle/color/...` + `atributos_variante_valores`), que COEXISTE y
no se toca. También se **REVOCA `fn_estructura_guardar_niveles` de `authenticated`**: desde la mig 310 la
fuente de verdad del empaque es `producto_presentaciones`, y dejar viva la RPC vieja permitiría "guardar
bien" una conversión que ya nadie lee → drift silencioso. `service_role` conserva su GRANT explícito.
Revisada por `migration-reviewer` (sumó el guard `jsonb_typeof = 'object'` para que un dato inesperado en
PROD no aborte un DDL destructivo a medias, y el guard anti-duplicado de la nota). Se borró también
`src/components/ProductoGrupoModal.tsx` (código muerto que habría explotado en runtime si se reenganchaba).

**310 (rediseño UoM — FASE 5 chunk A: presentaciones = FUENTE DE VERDAD + hermanas, EN DEV y PROD)** —
Invierte la fuente de verdad del empaque: `producto_presentaciones` deja de ser un espejo derivado por
trigger de `producto_estructura_niveles` y pasa a ser **la tabla que manda** (se dropean
`trg_pp_sync_niveles` y `trg_pp_sync_estructura`). Se levanta `UNIQUE(producto_id, nombre_empaque_id)` →
habilita **HERMANAS** (Caja-12 y Caja-10 del mismo producto, pedido de Fede); sigue vigente
`UNIQUE(producto_id, etiqueta)`. **Backfill verificado contra datos reales: 0 conversiones perdidas,
314/314 productos con presentación base, 0 árboles incoherentes**, y se RECUPERARON las estructuras
no-default que hasta hoy eran letra muerta (Leche: Caja-12→Pallet-216 + Caja-10→Pallet-360). RPC nueva
**`fn_presentaciones_guardar`** (reemplaza `fn_estructura_guardar_niveles`): el padre se referencia por
**índice ANTERIOR del array** → sin ciclos por construcción; valida una sola base con factor 1, etiquetas
únicas, hijo más grande que el padre y **múltiplo entero**. Trigger **`trg_productos_presentacion_base`**
siembra la base de todo producto nuevo y mantiene H2 (etiqueta base = `productos.unidad_medida`).
`producto_estructuras`/`_niveles` quedan DEPRECADAS pero **NO se dropean**: `inventario_lineas.estructura_id`
las referencia como histórico de recepción (borrarlas sería perder trazabilidad, Regla #0).
Revisada por `migration-reviewer` (sumó peso/dimensiones al backfill de la base, el trigger de siembra
para productos nuevos, y limpieza de código muerto).

**309 (rediseño UoM — FASE 4: stock "sin variante asignada" + borrado multi-sucursal + E3, EN DEV y PROD, 🛑 MUEVE STOCK)** —
**`fn_reasignar_stock_variante(madre, jsonb)`**: reparte entre los hijos el stock que queda colgando de
una madre agrupadora cuando se le crea la primera variante (visible y contable, pero NO vendible). Una
transacción, líneas bloqueadas `FOR UPDATE` en orden determinístico, **par de `movimientos_stock` por
asignación → neto CERO**. Línea entera a un solo hijo = **re-apunta el LPN** (misma caja física, conserva
etiqueta); parcial = descuenta y crea línea nueva heredando ubicación/estado/lote/vencimiento/costo/
`parent_lpn_id`, **desactivando el origen si queda en 0**. Guards: serializados, reservas, LPN contenedor,
sobre-asignación, destino que no es hijo. **Tipo nuevo `reasignacion_variante`** — NO se reusó
`ajuste_rebaje` a propósito: el Dashboard lo cuenta como MERMA y habría inflado una pérdida inexistente.
**🛑 Bug latente corregido en la misma migración:** cambiar el `producto_id` de una línea NO disparaba el
sync de TiendaNube (trigger acotado a cantidad/reservada/activo) y el de MercadoLibre solo encolaba el
producto NUEVO → el listado publicado del producto viejo quedaba con stock desactualizado (**riesgo de
sobreventa**); ambas funciones encolan ahora los dos productos. **`fn_stock_por_sucursal(uuid[])`** para
que el cartel de borrado NOMBRE la sucursal con stock (el bloqueo server-side ya existía). **E3**:
trigger `trg_productos_udm_familia` — cambiar la UdM física dentro de la misma familia es libre, cruzar
de familia con stock se bloquea. Revisada por `migration-reviewer`, que cazó 2 hallazgos 🔴 (el LPN
partido que quedaba activo en 0 y el sync de marketplaces) **antes** de aplicarla.

**308 (rediseño UoM — FASE 1-bis: catálogo completo de unidades físicas, EN DEV, SIN deploy a PROD)** —
`unidades_medida_fisicas` (mig 303) suma la familia **'area'** (se relaja el CHECK de `familia` a
peso/volumen/longitud/conteo/area) y el seed pasa de 11 a **27 unidades** (métrico + imperial —onza,
libra, galón US, pulgada, pie, yarda, milla— + área m²/cm²/ha/km² + docena/millar). El seed ahora setea
`activo` explícito (comunes activas, imperial/raras inactivas) y se re-corre para todos los tenants con
`ON CONFLICT (tenant_id, nombre) DO NOTHING` → solo inserta las nuevas, **no pisa el `activo` toggleado**
por el tenant (enable/disable por tenant). NO toca plata/stock/fiscal. Revisada por `migration-reviewer`
(idempotencia, nombre del CHECK `unidades_medida_fisicas_familia_check`, superset del CHECK, factores de
conversión exactos, SECURITY DEFINER/search_path — todo OK; cazó que el mirror frontend `FamiliaFisica`
sin 'area' crasheaba el form de producto → corregido antes de aplicar). Presets por rubro viven en el
frontend (`PRESETS_RUBRO`). Ver [[wiki/features/estructuras-udm]].

**307 (rediseño UoM — FASE 2-bis chunk 2: empaque sin precio + árbol genealógico, EN DEV, SIN deploy a PROD, 🛑 TOCA PLATA)** —
reencauza mig 304 con el modelo final de Fede: el **empaque es logística pura, sin precio propio**. DROP de
`precio_venta`/`precio_costo` en `producto_presentaciones` Y en `producto_estructura_niveles` (el precio de
una presentación = `productos.precio_venta` por unidad base × `factor_base`; el precio por volumen es un
TIER de mig 306). `producto_presentaciones` gana **`padre_linea_id`** (self-FK, **NO ACTION** = guard de
borrado-con-hijos que sí deja pasar el wipe del rebuild en 1 statement) + trigger `trg_pp_no_ciclo` (ciclo +
mismo-producto + self-parent) + `UNIQUE(producto_id, orden)`. `fn_rebuild_presentaciones` reescrita: sin
precio, setea `padre_linea_id` (cadena lineal: padre = orden inmediatamente menor; base = NULL) + **H2**
(etiqueta de la presentación base = `productos.unidad_medida`). `fn_estructura_guardar_niveles` sin el bloque
de precio por nivel. Revisada por `migration-reviewer` (FK NO ACTION vs wipe, ciclo durante el rebuild
multi-fila, linkeo del padre, idempotencia, RLS/DEFINER/search_path — todo OK). Verificado en DEV: de 22
productos con override, 20 eran E2E/Test (el resto ±2¢ por redondeo). Ver [[wiki/features/estructuras-udm]]
y [[wiki/features/ventas-pos]].

**306 (rediseño UoM — FASE 2-bis: tiers de precio mayorista con OPERADOR, EN DEV, SIN deploy a PROD, 🛑 TOCA PLATA)** —
`producto_precios_mayorista` (mig 092) gana `operador` ('>','<','=','>=','<=', default '>=') + `orden`
(default 0). Resolución nueva (respuestas finales de Fede): se evalúan en `orden` asc, gana el PRIMER
match; si ninguno, precio base. La cantidad comparada es el TOTAL del SKU en el carrito (agregación por
SKU). Relaja `UNIQUE(producto_id, cantidad_minima)` → `UNIQUE(producto_id, cantidad_minima, operador)`.
Backfill de `orden` **DESC** por cantidad_minima (🛑 bug de plata que encontró el `migration-reviewer`:
el POS viejo era last-match "gana el de mayor umbral satisfecho"; con first-match + backfill ASC un
cliente que compra 60 con tiers 10→$90/50→$80 pagaría $90 — el DESC lo reproduce bien). Lógica pura
`src/lib/tiers.ts`. Ver [[wiki/features/estructuras-udm]] y [[wiki/features/ventas-pos]].

**305 (rediseño UoM/Empaque/Variantes — FASE 3: variantes madre/hijo, EN DEV, SIN deploy a PROD)** —
`productos.producto_padre_id` (auto-referencia, NULL=madre/standalone · con valor=hijo) +
`variante_diferenciador` (único entre hermanos, unique parcial). Reemplaza `producto_grupos` (mig 120).
Trigger BEFORE `trg_variante_compose_nombre` compone `nombre = madre.nombre — diferenciador` + guards
(2 niveles, no self-parent, tenant explícito); trigger AFTER `trg_variante_propagar_nombre` propaga el
rename de la madre a los hijos. Madre con hijos = agrupador no vendible (derivado `EXISTS hijos`). DO
block migra grupos con ≥2 productos → madre + hijos (idempotente: filtra `producto_padre_id IS NULL`).
`producto_grupos`/`grupo_id`/`variante_valores` deprecados (COMMENT, no dropeados). Revisada por
`migration-reviewer` (encontró bug bloqueante de idempotencia — 2da corrida duplicaba madres — +
cerró guard de 3 niveles + tenant, todo corregido). NO toca stock (los grupos ya tenían el stock en los
productos → hijos; la madre nace en 0). La migración de stock "sin variante asignada" + guards de borrado
son la FASE 4. Ver [[wiki/features/estructuras-udm]].

**304 (rediseño UoM/Empaque/Variantes — FASE 2: precio en base + presentaciones, EN DEV, SIN deploy a PROD, 🛑 TOCA PLATA)** —
tabla nueva `producto_presentaciones` (modelo plano, `factor_base` directo a la base, RLS, GRANT solo
SELECT a authenticated por ser 100% derivada). Se puebla 1:1 desde `producto_estructura_niveles` y se
mantiene por `fn_rebuild_presentaciones` (SECURITY DEFINER) + triggers `trg_pp_sync_niveles`/
`trg_pp_sync_estructura`. **Se ELIMINÓ `productos.nivel_precio_orden`** (ancla por posición, bug F3):
`productos.precio_venta/costo` pasa a ser SIEMPRE precio por unidad base; presentación = override propio
?? base × factor. Back-calc de plata de los 6 productos anclados (persiste el precio del nivel anclado
como override para no driftear; drift ≤ centavos solo en niveles derivados altos). `fn_estructura_guardar_niveles`
reescrita sin el bloque de `nivel_precio_orden` (habría roto todo guardado tras el DROP). Hermanas
bloqueadas hasta Fase 5 por `UNIQUE(producto,nombre_empaque)`. Revisada por `migration-reviewer`
(GRANT solo-SELECT + guard de idempotencia en el back-calc, aplicados). Verificada contra los 6
productos reales de DEV. Ver [[wiki/features/estructuras-udm]].

**303 (rediseño UoM/Empaque/Variantes — FASE 1: Unidad de Medida física, EN DEV, SIN deploy a PROD)** —
tabla nueva `unidades_medida_fisicas` (por tenant, RLS) con familias de conversión universal fija
(Peso mg/g/kg/t · Volumen ml/L · Longitud mm/cm/m/km · Conteo unidad), `factor_base_familia` +
`es_base_familia` + `permite_decimales` (=familia≠conteo). Función `seed_unidades_medida_fisicas` +
trigger `AFTER INSERT ON tenants` (patrón `seed_tipos_pedido`) + backfill de tenants existentes.
`productos.unidad_medida_base_id` (FK nullable a la nueva tabla, aditiva) + índice + backfill
best-effort desde el texto legacy `productos.unidad_medida` (que se mantiene en sincronía desde el
frontend por compatibilidad — se dropea en una limpieza de fase posterior). Revisada por
`migration-reviewer` (APTA; se agregó el índice sugerido). NO toca stock/precios/fiscal (solo catálogo
+ FK descriptiva). Decisión G1 de GO: tablas SEPARADAS (físicas ≠ nombres de empaque). Ver el diseño
completo en `diseño-uom-empaque-variantes.html` y [[wiki/features/estructuras-udm]] → "Rediseño UoM".

**302 (Pedidos — validaciones de creación, EN DEV, SIN deploy a PROD)** — `pedidos.referencia text`
(Nº externo / referencia del cliente, ej. su OC; el correlativo interno `numero`/`numero_sucursal`
sigue 100% automático, este campo es aparte para no meter huecos ni colisiones) + `seed_tipos_pedido`
actualizada para que los tenants NUEVOS nazcan con `cliente_obligatorio=true` en los 4 tipos (no
afecta tenants existentes — es config por tenant, C3). Revisada por `migration-reviewer` (aditiva,
`CREATE OR REPLACE` preserva el ACL; se agregó el REVOKE explícito por defensa en profundidad). El
resto de las validaciones de esa ronda son client-side en `PedidosPage.tsx` (estado obligatorio +
precargado del default del producto si el tenant usa estados · fecha de entrega obligatoria · cantidad
entera salvo UoM fraccionaria vía `esDecimal` compartido con el POS · repetir producto en N líneas
diferenciadas · aviso NO bloqueante de stock al armar, H2). Ver [[wiki/features/pedidos]] → PED2.

**299-301 (Pedidos — cierra los 5 gaps documentados tras PED1-PED8, sigue EN DEV, SIN deploy a PROD,
SIN commitear al cierre de la sesión anterior)** — cada una revisada por `migration-reviewer`
(299 tuvo 2 rondas, ver detalle):
- **299** (CC en Pedidos valida límite de crédito, B1): `CREATE OR REPLACE fn_pedido_generar_venta`
  agrega el chequeo de `limite_credito` (el trigger genérico `fn_ventas_cc_guard`, mig 234, ya cubre
  B4/morosidad para cualquier venta incl. Pedidos, así que esta migración NO lo duplica — pero para
  B1 el trigger tiene un punto ciego real con Pedidos: lee `NEW.medio_pago` al INSERT, y Pedidos
  inserta con `total=0`/`monto:null` — el chequeo del trigger nunca dispara). Deuda calculada INLINE
  por `tenant_id`, sin pasar por `cliente_cc_estado` (depende de `auth.uid()`, patrón que la propia
  234 evitó). 🔴 **1ra ronda de review:** la versión inicial duplicaba B4 vía `cliente_cc_estado` y
  un monto CC negativo neutralizaba el chequeo de límite — corregido (sacado el duplicado, clamps
  `GREATEST(x,0)`). 🔴 **2da ronda:** el *gate* de la validación seguía dependiendo de un valor
  controlado por el llamante (`v_monto_cc` — una sola entrada CC con monto ≤0 evadía el chequeo
  ENTERO); corregido usando `v_total - v_monto_pagado` (saldo real sin cubrir, ambos términos ya
  defendidos) como gate en vez de `v_monto_cc`.
- **300** (des-pickeo de tarea encadenada a un reabastecimiento): `fn_unpick_tarea_wms` solo
  funcionaba con match exacto producto+ubicación+LPN (picking DIRECTO) — para una tarea encadenada
  el `lpn_origen` es el LPN de BULK viejo, que nunca existió físicamente en la ubicación de picking.
  Fix: fallback que busca cualquier línea reservada del mismo producto en esa ubicación (FEFO) cuando
  el match exacto falla Y la tarea tiene `tarea_precedente_id`. Limitación residual aceptada
  (fungibilidad entre reservas del mismo producto sin distinguir atributo, misma clase que el resto
  del match "por disponibilidad" de WMS).
- **301** (cancelar pedido tras venta devuelta, A5 parcial): `fn_cancelar_pedido` bloqueaba para
  siempre si el pedido alguna vez generó una venta, incluso ya devuelta a mano — el guard no filtraba
  por estado de la venta. Fix: solo bloquea si existe una venta ACTIVA (`estado NOT IN ('cancelada',
  'devuelta')`). La devolución automática end-to-end sigue diferida a propósito (esa lógica fiscal
  vive solo en `VentasPage.tsx`, Regla #0); la UI ahora linkea a `/ventas?id=<id>&devolver=1`.

Además, en la misma ronda: editor de `pedido_transiciones_roles` (E3) en Config → Pedidos
(`src/lib/pedidoTransiciones.ts`, sin migración nueva — reusa la columna jsonb ya creada en la mig
292) y exportes K3 (Excel/PDF/CSV) en `PedidosPage.tsx` (sin migración). Ver [[wiki/features/pedidos]]
→ "Correcciones post-relevamiento" para el detalle completo de los 5 fixes.
Verificación: tsc + build + 1188 tests unitarios verdes (8 nuevos) + 5/5 e2e verdes (spec 107,
incl. un test nuevo del guard de CC contra datos reales de DEV).

**298 (Pedidos PED6 — bolsa de pedidos + staging, sigue EN DEV, SIN deploy a PROD, SIN commitear al
cierre de la sesión)** — RPC `fn_lanzar_bolsa_pedidos(p_pedido_ids uuid[], p_ubicacion_staging_id uuid)`:
agrupa N pedidos lanzándolos juntos (llama a `fn_generar_tareas_picking_pedido` de la mig 294 sin
cambios, pedido por pedido) y etiqueta las tareas con `wms_tareas.lanzamiento_id` (tabla nueva
`pedido_lanzamientos`) — la ubicación de staging (`'staging'` nuevo en el CHECK de
`ubicaciones.tipo_ubicacion`) es metadato organizativo, no cambia el mecanismo de reserva ya
probado. 🔴 El `migration-reviewer` encontró que sin un guard, un pedido YA lanzado incluido en una
bolsa nueva le "robaba" en silencio sus tareas a la bolsa/lanzamiento original (rompe trazabilidad
write-time) — corregido con un `EXISTS` que rechaza la bolsa entera. 🐛 El e2e nuevo encontró
además un bug real de Postgres (`42702 pedido_id ambiguous` — la función tiene `pedido_id` como
columna de salida vía `RETURNS TABLE`, que colisiona con la columna homónima de `wms_tareas` sin
calificar) — corregido calificando `wms_tareas.pedido_id`. Ver [[wiki/features/pedidos]] → PED6.

**294-297 (módulo "Pedidos" completa PED3-PED5, sigue EN DEV, SIN deploy a PROD, SIN commitear al
cierre de la sesión)** — cada una revisada por `migration-reviewer` antes de aplicar, con hallazgos
reales corregidos en las 3:
- **294** (PED3, "Lanzar"): RPC `fn_generar_tareas_picking_pedido(p_pedido_id)` — valida stock
  bloqueante, reserva `inventario_lineas.cantidad_reservada` vía FEFO (filtrando por
  talle/color/encaje/formato/sabor_aroma — 🔴 hallazgo real, sin esto podía reservar/pickear la
  variante equivocada, sin un humano en el loop como en Ventas), genera `wms_tareas`
  (`pedido_id` nuevo, `origen` acepta `'pedido'`), envío condicional. 🟡 También excluye
  `ubicacion_id IS NULL`/`disponible_surtido=false` (evita tareas con destino imposible de completar).
- **295** (PED4, "Entregar" genera la venta real): RPC `fn_pedido_generar_venta(...)` — Pedidos nunca
  pasa por el POS, reusa solo la mecánica de rebaje (`ventas`/`venta_items`/`inventario_lineas`/
  `movimientos_stock`/`venta_item_despachos`/`caja_movimientos`), sin factura automática (queda
  manual en Ventas → Historial). 🔴 El guard de estado no incluía `entregado_parcial` (rompía
  entregas parciales múltiples, G1-G3) — corregido + se agregó `p_idempotency_key`
  (`ventas.pedido_entrega_key` + índice único) para no duplicar en un reintento de red. 🟡 Ventana
  TOCTOU en la sesión de caja — `FOR UPDATE` + validación de sucursal agregadas.
- **297** (fix de WMS compartido, encontrado al construir 295): `fn_completar_tarea_reabastecimiento`
  (mig 290) nunca transfería `cantidad_reservada` del origen al LPN nuevo del destino al mover stock
  bulk→picking — dejaba "stock fantasma" sin reservar en picking. Fix general, no específico de
  Pedidos (afecta también reservas de Ventas). Verificado explícitamente con datos reales en
  `tests/e2e/107_pedidos_ciclo_completo_mutante.spec.ts`.
- **296** (PED5, cancelación + des-pickeo): `fn_pedido_deslanzar` (F5) + `fn_cancelar_pedido` +
  `fn_unpick_tarea_wms(p_tarea_id, p_ubicacion_destino_id)` (E4). 🔴 `fn_cancelar_pedido` no
  chequeaba si ya existía una venta real generada (A5 pide devolución automática, diferida a
  propósito) — ahora bloquea con excepción clara en vez de dejar la venta huérfana. 🔴
  `fn_unpick_tarea_wms` nunca puede des-pickear una tarea encadenada a un reabastecimiento (limitación
  documentada, la UI oculta "Deshacer" para esos casos).

Ver [[wiki/features/pedidos]] (PED3-PED8) y [[wiki/features/wms]] → Fase 4 (mig 297).
Verificación de toda la tanda: tsc + build + 1180 tests unitarios verdes + e2e 107 nuevo (3/3 verde
contra datos reales de DEV).

**293 (Fase 2 del roadmap de estructuras-udm — operar por UdM al ingresar Y rebajar stock, cierra el
único pendiente que quedaba del roadmap, sigue EN DEV, SIN deploy a PROD, SIN commitear al cierre de
la sesión)** — `inventario_lineas.unidad_medida_id`/`.cantidad_uom` (UdM del LPN al recibir,
permanente) + `movimientos_stock.unidad_medida_id`/`.cantidad_uom` (UdM de la operación puntual de
ingreso o rebaje — necesario porque un rebaje puede consumir de varios LPNs con distinta UdM de
origen), ambas con `CHECK (cantidad_uom IS NULL OR cantidad_uom > 0)` (agregado a pedido del
`migration-reviewer`, mismo patrón que `venta_items.cantidad_uom` de la mig 286). `convertirABase()`
en `src/lib/estructuras.ts` ya existía desde Fase 1 (código muerto hasta esta sesión) — el cálculo no
es nuevo, solo se agregó dónde trazar la UdM usada. Wireado en 4 superficies (ingreso simple, rebaje
simple, ingreso masivo, rebaje masivo) — ver [[wiki/features/estructuras-udm]] → "Fase 2". Bug real
corregido de paso: el texto de ayuda mostraba el nombre de unidad incorrecto (`productos.unidad_medida`
texto libre en vez del nombre real del nivel base de la estructura).
**292 (schema del módulo NUEVO "Pedidos", PED1, sigue EN DEV, SIN deploy a PROD, SIN commitear al
cierre de la sesión)** — `tipos_pedido` (catálogo por tenant, seed 4 tipos default + trigger nuevo
tenant) + `pedidos` (cabecera, numeración tenant+sucursal, RLS por sucursal, estados
`borrador→confirmado→en_preparacion→listo_para_entrega→entregado(_parcial)→cancelado`) +
`pedido_items` (líneas SIN precio, cantidad en unidades base, `estado_id` opcional para pickear
respetando FIFO/FEFO, atributos opcionales) + trazabilidad `ventas.pedido_id` /
`venta_items.pedido_item_id` / `envios.pedido_id`. **Pivote de arquitectura (F4, confirmado con GO el
mismo día): Ventas/Envíos YA NO generan tareas WMS — el picking/reabastecimiento nace exclusivamente
desde Pedidos de acá en más** (`fn_generar_tareas_picking_envio` de las migs 290/291 queda código
muerto en la práctica). El `migration-reviewer` encontró un bug real antes de aplicar: el trigger de
numeración sin `SECURITY DEFINER` hubiera duplicado el número de pedido para usuarios restringidos a
una sucursal (mismo bug ya presente, sin corregir, en `set_oc_numero`/`ordenes_compra` desde las migs
182+217 — hallazgo colateral, fuera de alcance, no se tocó); corregido en `pedidos` antes de aplicar.
UI nueva `src/pages/PedidosPage.tsx` (ruta `/pedidos`, PED2: armar/confirmar/cancelar, sin precio, sin
lanzar todavía). Ver [[wiki/features/pedidos]] (página nueva) y [[wiki/features/wms]] → nota de
vigencia al principio de "Fase 3".
**291 (fixes reales encontrados por GO probando el WMS a mano, mismo día, sigue EN DEV, SIN deploy a
PROD, SIN commitear al cierre de la sesión)** — 3 `CREATE OR REPLACE FUNCTION` (sin tablas/columnas
nuevas), verificados contra datos reales del tenant "Almacén Jorgito" (venta #395/envío #44): (1)
`fn_generar_tareas_picking_envio` — la rama "Fuente 1" (`venta_item_despachos`, venta ya despachada,
consumo YA ocurrido) encadenaba reabastecimiento igual que la rama "Fuente 2" (reserva pendiente)
cuando el LPN vivía fuera de zona de picking — rompía trazabilidad (LPN nuevo desvinculado del que
`venta_item_despachos` ya había fijado) aunque el stock total daba correcto (movimiento neto cero);
ahora Fuente 1 SIEMPRE genera picking directo, nunca reabastecimiento; (2)
`fn_generar_tareas_reabastecimiento_umbral` — pedía siempre `stock_maximo − stock_actual` sin
chequear el disponible real en el origen, fallaba al completar si no alcanzaba (bug reproducido por
GO); ahora clampea al disponible real; (3) `fn_cancelar_tarea_wms(p_tarea_id, p_motivo)` nueva — no
existía forma de cancelar una tarea, cancela en cascada el picking dependiente de un reabastecimiento
cancelado. Frontend sin migración: `logActividad()` en Historial (entidad nueva `wms_tarea`) al
completar/cancelar tareas + botón "Cancelar" en `PickingPage.tsx`/`InventarioPage.tsx`; badge "Envío
#N" clickeable en el detalle de venta (`VentasPage.tsx`) que navega a `/envios?busqueda=N` (soporte
nuevo del query param en `EnviosPage.tsx`). Revisada por `migration-reviewer` (aprobada, sin
hallazgos bloqueantes). Test e2e 106 reescrito en 2 tests (el viejo verificaba el comportamiento
buggy) — **e2e todavía sin correr esta sesión**. `npm run build` verde. `APP_VERSION` sigue v1.143.0,
sin bump. Ver [[wiki/features/wms]] → "Fixes de la primera ronda de pruebas manuales de GO".
**289-290 (WMS Zonas + Tareas + Reabastecimiento, cierra Fases 3-5 del roadmap de estructuras-udm,
v1.143.0) EN DEV, SIN deploy a PROD** (fixes reales de la 291 arriba) — 289 tabla `zonas` + `reglas_almacenaje` +
`producto_ubicacion_umbrales` + `wms_tareas` (RLS por sucursal, mismo patrón que
`inventario_lineas`/`envios`) + 2 flags independientes de reabastecimiento en `tenants`; 290 RPCs
SECURITY INVOKER `fn_generar_tareas_picking_envio`/`fn_completar_tarea_reabastecimiento`/
`fn_completar_tarea_picking`/`fn_generar_tareas_reabastecimiento_umbral` + helpers. **Decisión de
arquitectura confirmada con GO: el picking es logística pura** — nunca decide qué LPN consume una
venta ni cuándo se rebaja stock (`VentasPage.tsx`/`rebajeSort.ts` sin cambios); el reabastecimiento
reusa el mismo mecanismo de "Mover LPN" de `LpnAccionesModal`. Revisadas por `migration-reviewer`
antes de aplicar (sumó `FOR UPDATE SKIP LOCKED`); smoke test manual con datos reales en DEV encontró
y corrigió 2 bugs de la RPC + 1 bug del reabastecimiento por umbral. Verde: tsc · build · 1177 unit ·
regresión e2e 13 specs · **e2e nuevo 106** (mutante, DB real). Ver [[wiki/features/wms]] y
[[wiki/features/estructuras-udm]]. Decisión explícita: deploy a PROD queda para cuando GO lo pida.
**282-283 (Fase 1 de Estructuras con niveles dinámicos por UdM, v1.137.0) EN DEV Y PROD ✅ (deploy real
2026-07-22, PR #297)** — 282 tabla
`producto_estructura_niveles` + RPC `fn_estructura_guardar_niveles`; 283 fix del backfill de conversiones
del importador CSV. `producto_estructuras` tenía 0 filas en PROD antes de aplicar → backfill no-op,
confirmado. Ver [[wiki/features/estructuras-udm]].
**284-285 (descuento automático por estado de inventario, backlog Fede punto 3, v1.139.0) EN DEV Y PROD ✅
(deploy real 2026-07-22, PR #297)**
— 284 `estados_inventario.descuento_pct`; 285 `venta_items.descuento_estado_pct/monto` +
`ventas.descuento_estado` jsonb (trazabilidad, mismo criterio que `promo_pago` de la 281). Ver
[[wiki/features/ventas-pos]] → "Descuento automático por estado de inventario".
**286-287 (precio por Unidad de Medida en la estructura, backlog Fede puntos 4/6/7 — Fase 1 v1.140.0 +
Fase 2 v1.141.0, AMBAS mismo día) EN DEV Y PROD ✅ (deploy real 2026-07-22, PR #297)** — 286 `producto_estructura_niveles.
precio_venta/precio_costo` + `productos.nivel_precio_orden` (ancla de precio) + `venta_items.
unidad_medida_id/cantidad_uom` + `combos.unidad_medida_id`; 287 extiende `fn_estructura_guardar_niveles`
para persistir precio por nivel. **Ya se puede vender por UoM en el POS** (Fase 2, v1.141.0 — selector en
el carrito, precio del nivel, combos con UoM propia, UoM en factura/ticket; `venta_items.cantidad` sigue
siempre en unidades base). Ver [[wiki/features/estructuras-udm]] y [[wiki/features/ventas-pos]] → "Venta
por Unidad de Medida".
**288 (fix crítico + cierra el pendiente de precio por nivel en el importador, backlog Fede puntos 4/6/7,
v1.142.0, misma sesión que 286-287) EN DEV Y PROD ✅ (deploy real 2026-07-22, PR #297)** — agrega `productos.notas TEXT`, columna que
`ImportarProductosPage.tsx` y su plantilla Excel pedían desde siempre pero que NINGUNA migración había
creado nunca: el payload de insert/update de productos siempre mandó `notas` → PostgREST rechazaba el
INSERT/UPDATE COMPLETO (`PGRST204`), y el código nunca revisaba el `error` de la respuesta (solo
desestructuraba `data`) → **el importador de productos NUNCA funcionó** (reportaba "X creados" con la
tabla en CERO filas nuevas). Detectado por el e2e nuevo **105** con verificación real en DB. De paso,
`ImportarProductosPage.tsx` suma columnas `estr_precio_ancla`/`estr_precio_venta_*`/`estr_precio_costo_*`
(precio por nivel, cierra el único pendiente que quedaba del backlog de Fede 4/6/7) y el importador ahora
revisa el `error` real de cada insert/update (`erroresDetalle`); mismo código-olor corregido por
prevención en `ImportarMasterPage.tsx` (sin falla activa confirmada ahí). Ver [[wiki/features/estructuras-udm]]
→ "Importador de productos con precio por nivel".
**273, 274, 275 y 276 aplicadas en DEV y PROD** (PR #293, v1.134.0). 274 es el guard
`chk_productos_grupo_sin_atributos_variante` (Grupo de variantes vs. Atributos de variante son
incompatibles) — ⚠ **ese CHECK ya no existe:** se fue con `grupo_id` en la mig 311 y se reconstruyó
sobre el modelo madre/hijo en la **mig 314**. 275 agrega las columnas de atributos de variante a `traslado_items` (se perdían al
trasladar stock entre sucursales). 276 agrega `traslado_items.ubicacion_sugerida_id` (precarga la
ubicación al confirmar recepción cuando el traslado nació de un movimiento parcial de LPN).
**277 (ronda 4 de atributos de variante) aplicada en DEV y PROD** (PR #294, v1.135.0) — agrega las
mismas columnas de atributo a `venta_item_despachos` (snapshot del despacho de venta).
**278-281 aplicadas en DEV Y PROD (verificadas por query — PR #295, v1.136.0):**
278 hard delete real de productos (`fn_producto_tiene_actividad()` + `eliminar_productos_fisico()`) ·
279 `combos.vigencia_desde/hasta` (vigencia por fecha, filtro client-side en POS) ·
280 `tenants.cliente_campos_requeridos` jsonb + backfill desde el enum legacy `cliente_datos_minimos` ·
281 `ventas.promo_pago` jsonb (trazabilidad del descuento por método de pago; la config vive en
`metodos_pago.config.descuento`, sin migración propia porque el jsonb `config` ya existía).
Convención: `NNN_descripcion_snake_case.sql` · Todas idempotentes con `IF NOT EXISTS`

> [!WARNING] `CREATE POLICY IF NOT EXISTS` no existe en PostgreSQL. Usar: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE ...) THEN CREATE POLICY ...; END IF; END $$`

---

## Migraciones 001-040 (Base, RRHH, WMS)

| # | Archivo | Descripción |
|---|---------|-------------|
| 001 | `001_initial_schema.sql` | Schema inicial completo: tenants, users, productos, inventario_lineas, movimientos_stock, ventas, venta_items, caja, ubicaciones, estados, motivos |
| 002 | `002_cotizacion_y_precio_historico.sql` | Cotización USD/ARS + precio costo histórico por venta |
| 003 | `003_clientes_y_rentabilidad.sql` | Módulo clientes + rentabilidad real |
| 004 | `004_caja_cierre_real.sql` | Caja: conteo real al cierre, diferencia, cerrado_por |
| 005 | `005_combos.sql` | Tabla combos (reglas de precio por volumen) |
| 006 | `006_ventas_numero_trigger.sql` | Trigger auto-número de venta por tenant |
| 007 | `007_precio_moneda.sql` | precio_costo_moneda / precio_venta_moneda en productos |
| 008 | `008_gastos.sql` | Tabla gastos con RLS |
| 009 | `009_actividad_log.sql` | Audit log append-only con RLS |
| 010 | `010_inventario_prioridad.sql` | `prioridad INT` en ubicaciones |
| 011 | `011_reglas_inventario.sql` | `regla_inventario` en tenants (default FIFO) y productos (override por SKU) |
| 012 | `012_ubicacion_disponible_surtido.sql` | `disponible_surtido BOOLEAN` en ubicaciones |
| 013 | `013_aging_profiles.sql` | Tablas aging_profiles + aging_profile_reglas + `process_aging_profiles()` SECURITY DEFINER |
| 014 | `014_rrhh_empleados.sql` | RRHH Phase 1: empleados, puestos, departamentos + `is_rrhh()` |
| 015 | `015_margen_objetivo.sql` | `productos.margen_objetivo DECIMAL(5,2)` nullable |
| 016 | `016_combos_descuento_tipo.sql` | `combos.descuento_tipo` (pct/monto_ars/monto_usd) + `descuento_monto` |
| 017 | `017_rrhh_nomina.sql` | RRHH Phase 2A: rrhh_conceptos + rrhh_salarios + rrhh_salario_items + `pagar_nomina_empleado()` |
| 018 | `018_rrhh_vacaciones.sql` | RRHH Phase 2B: rrhh_vacaciones_solicitud + rrhh_vacaciones_saldo + aprobar/rechazar |
| 019 | `019_rrhh_asistencia.sql` | RRHH Phase 3A: rrhh_asistencia (presente/ausente/tardanza/licencia) |
| 020 | `020_marketplace.sql` | Marketplace: campos en productos + tenants (marketplace_activo, webhook_url) |
| 021 | `021_movimientos_limite.sql` | Revenue: addon_movimientos en tenants (límite movimientos por plan) |
| 022 | `022_rrhh_nombre_documentos.sql` | RRHH Phase 2C+4A: nombre+apellido en empleados · rrhh_documentos · bucket empleados |
| 023 | `023_rrhh_capacitaciones.sql` | RRHH Phase 4B: rrhh_capacitaciones (nombre, fechas, horas, proveedor, estado, certificado_path) |
| 024 | `024_supervisor_rls.sql` | RRHH Phase 5: `get_supervisor_team_ids()` + RLS SUPERVISOR en asistencia/vacaciones/empleados |
| 025 | `025_sucursales.sql` | Multi-sucursal: tabla sucursales + sucursal_id nullable en 6 tablas operativas |
| 026 | `026_nomina_medio_pago.sql` | RRHH Nómina: medio_pago en rrhh_salarios + verificación saldo caja |
| 027 | `027_storage_productos_security.sql` | Security bucket productos: policy DELETE + file_size_limit 5MB + mime_types |
| 028 | `028_clientes_dni.sql` | Clientes: `dni TEXT` + UNIQUE(tenant_id, dni) WHERE NOT NULL |
| 029 | `029_ventas_monto_pagado.sql` | Ventas: `monto_pagado DECIMAL` para pago parcial en reservas |
| 030 | `030_devoluciones.sql` | Devoluciones: es_devolucion en ubicaciones+estados + tablas devoluciones + devolucion_items |
| 031 | `031_producto_estructuras.sql` | WMS Fase 1: producto_estructuras (niveles unidad/caja/pallet con dimensiones) |
| 032 | `032_ubicaciones_dimensiones.sql` | WMS Fase 2: tipo_ubicacion + dimensiones físicas en ubicaciones |
| 033 | `033_inventario_lineas_notas.sql` | Fix: notas TEXT nullable en inventario_lineas (para devoluciones) |
| 034 | `034_caja_traspasos.sql` | Traspasos entre cajas: es_caja_fuerte + tabla caja_traspasos |
| 035 | `035_users_avatar.sql` | Perfil: users.avatar_url + bucket avatares (public, 2MB) |
| 036 | `036_rrhh_feriados.sql` | RRHH: rrhh_feriados (nacional/provincial/personalizado/no_laborable) |
| 037 | `037_roles_custom.sql` | Roles parametrizables: roles_custom (permisos JSONB) + users.rol_custom_id FK |
| 038 | `038_movimientos_links.sql` | Trazabilidad: venta_id + gasto_id FK en movimientos_stock |
| 039 | `039_caja_arqueos.sql` | Arqueos: caja_arqueos (saldo_calculado, saldo_real, diferencia GENERATED STORED) |
| 040 | `040_kits.sql` | KITs WMS Fase 2.5: kit_recetas + kitting_log + productos.es_kit + tipo kitting |

---

## Migraciones 041-062

| # | Archivo | Descripción |
|---|---------|-------------|
| 041 | `041_...` | Session timeout + kitting_log.tipo(armado/desarmado) + des_kitting en movimientos_stock |
| 042 | `042_iva_biblioteca.sql` | IVA por producto (alicuota_iva) + venta_items.iva_monto + archivos_biblioteca + bucket |
| 043 | `043_certificados_afip.sql` | tenant_certificates + bucket certificados-afip + src/lib/afip.ts |
| 044 | `044_caja_sena.sql` | Nuevos tipos caja: ingreso_reserva, egreso_devolucion_sena + pagar_nomina actualizado |
| 045 | `045_metodos_pago.sql` | Tabla metodos_pago (nombre, color, activo, es_sistema, orden) |
| 046 | *(sin datos)* | — |
| 047 | `047_gastos_iva.sql` | GastosPage: IVA deducible |
| 048 | `048_gastos_fijos.sql` | gastos.comprobante_url + tabla gastos_fijos (descripcion, monto, frecuencia, dia_vencimiento) |
| 049 | `049_proveedores.sql` | ProveedoresPage: 9 campos extendidos + ordenes_compra + orden_compra_items + triggers |
| 050 | `050_recepciones_conteos.sql` | Recepciones + recepcion_items + inventario_conteos + inventario_conteo_items + inventario_lineas.estructura_id |
| 051 | `051_inventario_sprint_a.sql` | I-03 LPN vencidos + I-06 mover a otra sucursal + I-08 permite_over_receipt en tenants |
| 052 | `052_inventario_sprint_b.sql` | I-04 stock_minimo por sucursal + I-05 mono_sku en ubicaciones |
| 053 | `053_security_invoker.sql` | Fix security_invoker view (stock_por_producto) |
| 054 | `054_venta_items_decimal.sql` | venta_items.cantidad INT → DECIMAL(14,4) para UOM decimales |
| 055 | `055_autorizaciones_a.sql` | movimientos_stock.tipo CHECK ampliado (ajuste_ingreso, ajuste_rebaje, traslado) + cantidad DECIMAL |
| 056 | `056_autorizaciones_b.sql` | autorizaciones_inventario (tipo, linea_id, datos_cambio JSONB, estado, solicitado_por) |
| 057 | `057_lpn_madre.sql` | inventario_lineas.parent_lpn_id TEXT (LPN Madre) |
| 058 | `058_...` | Fix users.rol CHECK (RRHH/DEPOSITO/CONTADOR añadidos) |
| 059 | `059_recepciones.sql` | RecepcionesPage: estados OC recibida_parcial/recibida |
| 060 | `060_integraciones_schema.sql` | pgcrypto + ALTER ventas (origen, tracking, cae, etc.) + ALTER clientes + integration_job_queue + ventas_externas_logs |
| 061 | `061_oauth_credentials.sql` | tiendanube_credentials + mercadopago_credentials + inventario_tn_map |
| 062 | `062_tn_stock_trigger.sql` | trigger trg_tn_stock_sync AFTER INSERT/UPDATE/DELETE en inventario_lineas |

---

## Migraciones 063-083

| # | Descripción |
|---|-------------|
| 063 | `estados_inventario.es_disponible_tn BOOLEAN DEFAULT TRUE` |
| 064 | `estados_inventario.es_disponible_venta BOOLEAN DEFAULT TRUE` |
| 065 | meli_credentials + inventario_meli_map + trigger trg_meli_stock_sync |
| 066 | `estados_inventario.es_disponible_meli` + `ubicaciones.disponible_tn/disponible_meli` |
| 067 | `tenants.presupuesto_validez_dias INT DEFAULT 30` |
| 068–071 | *(datos no disponibles en docs)* |
| 072 | GastosPage overhaul: tipo_iva, iva_deducible, deduce_ganancias, múltiples medios de pago |
| 073 | Proveedores/Servicios: proveedor_productos + servicio_items + servicio_presupuestos + etiquetas |
| 074 | cliente_domicilios (alias, calle, ciudad, referencias, es_principal) |
| 075 | Módulo Envíos: tabla envios + bucket etiquetas-envios |
| 076 | Facturación AFIP Fase 1: campos en tenants (cuit, condicion_iva, razon_social, etc.) + clientes (cuit_receptor) |
| 077 | Facturación AFIP Fase 2: puntos_venta_afip + retenciones_sufridas + gastos.conciliado_iva |
| 078 | WhatsApp: tenants.whatsapp_plantilla + tenants.costo_envio_por_km |
| 079 | *(complemento WhatsApp)* |
| 080 | servicio_presupuestos: estado TEXT + gasto_id FK gastos(id) |
| 081 | Clientes mejorado: cliente_notas + clientes.fecha_nacimiento + clientes.etiquetas TEXT[] + codigo_fiscal |
| 082 | Fix crítico triggers stock: AFTER INSERT OR UPDATE OF cantidad,activo OR DELETE (no solo INSERT) |
| 083 | Cuenta Corriente: clientes.cuenta_corriente_habilitada + limite_credito + plazo_pago_dias · ventas.es_cuenta_corriente |
| 084 | Notificaciones reales: tabla notificaciones (RLS user) · caja_sesiones.monto_sugerido_apertura + diferencia_apertura · Caja Fuerte: tenants.caja_fuerte_roles + trigger fn_crear_caja_fuerte |
| 085 | OC gestión pagos: ordenes_compra.estado_pago + monto_total + monto_pagado + fecha_vencimiento_pago + dias_plazo_pago + condiciones_pago · proveedor_cc_movimientos (tipo oc/pago/nota_credito/ajuste) · fn_saldo_proveedor_cc() · proveedores.cuenta_corriente_habilitada + limite_credito_proveedor |
| 086 | Security hardening Fase 1: SET search_path = public en ~35 funciones + REVOKE EXECUTE FROM PUBLIC en funciones de trigger/internas |
| 086b | Security hardening Fase 2: REVOKE FROM PUBLIC + GRANT TO authenticated en funciones de negocio y auth helpers · Buckets avatares+productos: SELECT solo authenticated · Resultado: 80 → 7 warnings en Security Advisor |

---

## Migraciones 087–098

| # | Archivo | Descripción |
|---|---------|-------------|
| 087 | `087_api_keys.sql` | `api_keys` — API pull externa con service role |
| 088 | `088_nc_electronicas.sql` | NC electrónicas en `devoluciones` |
| 089 | `089_recursos.sql` | Módulo Recursos: tabla `recursos` + bucket recursos-fotos |
| 090 | `090_gastos_recepcion_id.sql` | `gastos.recepcion_id` — trazabilidad OC→Gasto automático en RecepcionesPage |
| 091 | `091_notif_cc_vencidas.sql` | `fn_notificar_cc_vencidas()` + pg_cron diario 09:00 AR |
| 092 | `092_producto_precios_mayorista.sql` | `producto_precios_mayorista` — tiers de precio mayorista por cantidad |
| 093 | `093_ordenes_compra_sucursal.sql` | `ordenes_compra.sucursal_id` — filtro por sucursal en Gastos tab OC |
| 094 | `094_users_sucursal_permisos.sql` | `users.sucursal_id` + `users.puede_ver_todas` — permisos multi-sucursal por usuario |
| 095 | `095_oc_derivadas_reembolso.sql` | `ordenes_compra.oc_padre_id` + `es_derivada` + `tiene_reembolso_pendiente` |
| 096 | `096_oc_costo_envio_contactos_proveedor.sql` | `ordenes_compra.tiene_envio/costo_envio` + tabla `proveedor_contactos` (CRUD múltiples contactos) |
| 097 | `097_gastos_recurso_cuotas.sql` | `gastos.recurso_id/es_cuota/cuotas_total/monto_cuota/tasa_interes` + tabla `gasto_cuotas` |
| 098 | `098_ventas_costo_envio.sql` | `ventas.costo_envio` — costo de envío separado del total de productos |

---

## Migraciones 087–108

| # | Archivo | Descripción |
|---|---------|-------------|
| 087–092 | `087_*` … `092_*` | (ver historial anterior) |
| 093 | `093_ordenes_compra_sucursal.sql` | `ordenes_compra.sucursal_id` |
| 094 | `094_users_sucursal_permisos.sql` | `users.sucursal_id` + `puede_ver_todas` + índice |
| 095 | `095_oc_derivadas_reembolso.sql` | `ordenes_compra.oc_padre_id/es_derivada/tiene_reembolso_pendiente` |
| 096 | `096_oc_costo_envio_contactos_proveedor.sql` | `ordenes_compra.tiene_envio/costo_envio` + tabla `proveedor_contactos` |
| 097 | `097_gastos_recurso_cuotas.sql` | `gastos.recurso_id/es_cuota/cuotas_total/monto_cuota/tasa_interes` + `gasto_cuotas` |
| 098 | `098_ventas_costo_envio.sql` | `ventas.costo_envio` |
| 099 | `099_notificaciones_metadata.sql` | `notificaciones.metadata JSONB` |
| 100 | `100_rename_owner_to_dueno.sql` | `rol='OWNER'→'DUEÑO'` + políticas RLS + `is_rrhh()` + `caja_fuerte_roles` |
| 101 | `101_ubicaciones_combos_sucursal.sql` | `ubicaciones.sucursal_id` + `combos.sucursal_id` |
| 102 | `102_recursos_recurrentes_ubicaciones.sql` | `recursos.es_recurrente/frecuencia_valor/.../proximo_vencimiento` |
| 103 | `103_autorizaciones_bulk_edit.sql` | `linea_id` nullable + tipo `bulk_edit` en `autorizaciones_inventario` |
| 104 | `104_cron_cleanup_job_queue.sql` | Cron diario limpieza `integration_job_queue` |
| 105 | `105_tenant_sql_query.sql` | Función `tenant_sql_query` — SQL Runner en ReportesPage |
| 106 | `106_process_single_aging_profile.sql` | Función `process_aging_profile_single` |
| 107 | `107_sucursales_envio_config.sql` | `sucursales.costo_km_envio` + tabla `courier_tarifas` |
| 108 | `108_ticket_sucursal_cuotas_oc_files.sql` | `sucursales.codigo` + `ventas.numero_sucursal` + trigger + `tenants.cuotas_bancos` + `ventas.cuotas_info` + `ordenes_compra.comprobante_url/titulo` |
| 109 | `109_modo_credentials.sql` | Tabla `modo_credentials` — integración MODO payments (merchant_id, api_key, ambiente, conectado) |
| 110 | `110_fix_fn_crear_caja_fuerte_security_definer.sql` | `fn_crear_caja_fuerte` como `SECURITY DEFINER` — fix RLS en registro de nuevo negocio |
| 111 | `111_cajas_sucursal_id.sql` | `cajas.sucursal_id` FK a `sucursales` + índice |
| 112 | `112_seed_tenant_defaults.sql` | Trigger `trg_seed_tenant_defaults` — crea motivos, estados al registrar tenant |
| 113 | `113_users_delete_policy.sql` | Políticas RLS DELETE en `users` (`users_delete_self` + `users_delete_owner`) |
| 114 | `114_sucursal_default_seed.sql` | `fn_seed_tenant_defaults` actualizado: crea Sucursal 1 + Caja Principal · backfill cajas y tenants sin sucursal |
| 115 | `115_backfill_sucursal_ventas_gastos_envios.sql` | Backfill `sucursal_id` en `ventas`, `gastos`, `envios` → sucursal más antigua del tenant |
| 116 | `116_backfill_sucursal_resto.sql` | Backfill `sucursal_id` en `recepciones`, `ordenes_compra`, `movimientos_stock` |
| 117 | `117_backfill_sucursal_completo.sql` | Backfill final: `inventario_lineas`, `inventario_conteos`, `caja_sesiones`, `recursos`, `puntos_venta_afip`, `cajas` (op) |
| 118 | `118_productos_atributos_nuevos.sql` | `productos`: marca, shelf_life_dias, tiene_pais_origen, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma · `inventario_lineas`: pais_origen, talle, color, encaje, formato, sabor_aroma |
| 119 | `119_unidades_medida_custom.sql` | Tabla `unidades_medida` (tenant_id, nombre, simbolo, activo) con RLS |
| 120 | `120_producto_grupos_variantes.sql` | Tabla `producto_grupos` (nombre, atributos JSONB, precio_base, categoria_id) · `productos`: grupo_id FK + variante_valores JSONB |
| 121 | `121_producto_ubicacion_sucursal.sql` | Tabla `producto_ubicacion_sucursal` (producto_id, sucursal_id, ubicacion_id) — UNIQUE(producto_id, sucursal_id) |

---

## Migraciones 122–126 (v1.8.32–v1.8.37)

| # | Archivo | Descripción |
|---|---------|-------------|
| 122 | `122_ventas_origen_extend.sql` | `ventas_origen_check` extendida con Instagram, Facebook, WhatsApp, Otros (ISS-110) |
| 123 | `123_config_fases2_3_4_tenants.sql` | `tenants`: email_legal, precio_redondeo, cliente_obligatorio, cliente_datos_minimos, cliente_consumidor_final, cliente_creacion_inline, descuento_max_cajero_pct, descuento_max_supervisor_pct, clave_maestra, boveda_umbral_caja |
| 124 | `124_sucursales_config_extendida.sql` | `sucursales`: codigo_postal, email, horario_apertura TIME, horario_cierre TIME, punto_venta_afip INTEGER |
| 125 | `125_metodos_pago_comision.sql` | `metodos_pago`: comision_pct NUMERIC(5,2), config JSONB |
| 126 | `126_ordenes_compra_descuento.sql` | `ordenes_compra.monto_descuento NUMERIC(12,2) DEFAULT 0` — descuento del proveedor al pagar (ISS-132) |
| 127 | `127_envios_pod_en_bodega.sql` | `envios`: POD fields (pod_url/pod_fecha/pod_receptor/pod_notas) + estado `en_bodega` en CHECK |
| 128 | `128_envios_pago_courier.sql` | `envios`: `costo_pagado BOOLEAN` + `fecha_pago_courier DATE` + `medio_pago_courier TEXT` (ISS-169) |
| 129 | `129_transportista_token.sql` | `envios.token_transportista` + 3 funciones SECURITY DEFINER públicas (`get_envio_by_token`, `get_envio_items_by_token`, `update_envio_by_token`) para ISS-165 |
| 130 | `130_categorias_gasto.sql` | Tabla `categorias_gasto` (tenant_id, nombre, requiere_sucursal, activo, predefinida, orden) con UNIQUE(tenant_id, nombre) + RLS. Seed automático de 16 categorías base por tenant + backfill para existentes + trigger `AFTER INSERT ON tenants`. FK opcional `gastos.categoria_id` y `gastos_fijos.categoria_id` |
| 131 | `131_tenants_gastos_settings.sql` | 7 columnas en `tenants` para reglas de gastos: 4 toggles OR de obligatoriedad de comprobante (`gastos_comp_siempre/si_iva/si_monto/si_deduce_ganancias`) + `gastos_comp_monto_umbral` + `gastos_dias_alerta_borrador` (default 7) + `gastos_dias_alerta_anticipo_oc` (default 15) |
| 132 | `132_gastos_umbrales_autorizaciones.sql` | `sucursales.umbral_gasto_supervisor/cajero` (DECIMAL nullable) + tabla `autorizaciones_gasto` (tipo/monto/payload/solicitante_rol/estado/aprobador_rol con RLS por tenant) + helper SQL `puede_aprobar_autorizacion_gasto(solic_rol, aprob_rol)` (CAJERO→SUPERVISOR+ · SUPERVISOR→ADMIN/DUEÑO) |
| 133 | `133_moneda_iva_alicuota_cc_autorizaciones.sql` | `tenants.moneda TEXT DEFAULT 'ARS'` con CHECK (11 monedas LatAm + EUR/USD) + `gastos.alicuota_iva DECIMAL(5,2)` + `gastos_fijos.alicuota_iva` + tabla `autorizaciones_cc` (motivo_bloqueo: `limite_excedido | oc_vencida`, payload de solicitud, RLS por tenant) |
| 134 | `134_gastos_capitaliza_egresos_consolidados.sql` | `gastos.capitaliza_recurso BOOLEAN DEFAULT FALSE` con CHECK (TRUE solo si recurso_id IS NOT NULL) + índice parcial + VIEW `vw_egresos_consolidados` (UNION ALL de gastos + rrhh_salarios.pagado=true, `WITH (security_invoker = true)`, columnas `fuente/tenant_id/fecha/monto/descripcion/categoria/sucursal_id/medio_pago/usuario_id/recurso_id/empleado_id/periodo/created_at`) |
| 135 | `135_cierre_contable.sql` | Tabla `cierres_contables(tenant_id, periodo, fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB)` UNIQUE(tenant_id, periodo) + RLS · `gastos.gasto_padre_id` + `gastos.es_correccion BOOLEAN` para notas de corrección · 5 triggers BEFORE UPDATE/DELETE en `gastos/ventas/caja_movimientos/caja_sesiones/ordenes_compra` que rechazan con RAISE EXCEPTION SQLSTATE P0001 si la fecha cae en periodo cerrado · helpers `ultimo_cierre_hasta(tenant)` y `periodo_cerrado(tenant, fecha)` · RPC `cerrar_periodo(p_periodo, p_observaciones)` SECURITY DEFINER (DUEÑO/SUPERVISOR/CONTADOR/ADMIN, snapshot de totales) · RPC `reabrir_periodo(p_cierre_id)` (sólo último cierre, DUEÑO/ADMIN/SUPER_USUARIO) |

**Total aplicadas:** 142 + 086b = 143 archivos en DEV y PROD (al día) ✅

| # | Archivo | Descripción |
|---|---------|-------------|
| 136 | `136_caja_moneda_cuentas_origen.sql` | **Caja Tanda 1 (v1.9.1)** · `cajas.moneda` + tabla `cuentas_origen` + `metodos_pago.cuenta_origen_id` + `caja_movimientos.cuenta_origen_id` + vista `vw_boveda_cuentas` + seed cuenta `Efectivo` por tenant |
| 137 | `137_boveda_retiros_y_backfill.sql` | **Caja Tanda 1.5 (v1.9.2)** · Tabla `boveda_retiros` con RLS estricta (solo DUEÑO/ADMIN/SUPER_USUARIO) + backfill `cuenta_origen_id` en movimientos históricos + UNIQUE partial index (1 cuenta efectivo por tenant) |
| 138 | `138_cuentas_origen_seed_metodos.sql` | **Caja Tanda 1.5 (v1.9.2)** · Auto-seed de cuentas de origen para métodos de pago no-efectivo existentes (banco / billetera inferido por nombre) + re-backfill de conceptos históricos `[Nombre Método] ...` |
| 139 | `139_boveda_backfill_fuzzy.sql` | **Hotfix v1.9.2** · Backfill flexible cuenta_origen_id con normalización (lower + sin tildes + sin "de ") para matchear conceptos viejos como `[Tarjeta crédito]` con `Tarjeta de crédito` |
| 140 | `140_caja_permisos_fase2_0.sql` | **Caja Fase 2.0 (v1.9.3)** · `caja_sesiones.abierta_por` (A2) + `tenants.config_caja JSONB` (config permisos) + RPCs `requiere_clave_maestra` y `verificar_clave_maestra` (B5) |
| 141 | `141_caja_cierre_enriquecido.sql` | **Caja Fase 2.1 (v1.9.4)** · `caja_sesiones.numero` correlativo por sucursal con trigger (K3) + `snapshot_totales JSONB` para regenerar ticket PDF idéntico (K2) + `tenants.diferencia_caja_umbral/alerta_roles/alerta_canales` (B1/B2/B3) + vista `vw_diferencias_por_cajero` 30 días (B4) |
| 142 | `142_caja_reportes.sql` | **Caja HITO v1.10.0** · vista `vw_caja_resumen_diario` (agregado día/caja/sucursal) + vista `vw_caja_mensual_por_sucursal` (alineada con cierre contable). Usadas por los 4 reportes de Caja (I1/I2) |
| 143 | `143_cron_cleanup_envio_tokens.sql` | **v1.10.1 quick win** · pg_cron `cleanup_envio_tokens_transportista` diario 07:00 UTC. NULL en `envios.token_transportista` para envíos entregados/cancelados/devolucion con +30 días desde último update — invalida links públicos viejos sin tocar el resto del envío |
| 144 | `144_envio_pod_fotos.sql` | **v1.10.1 quick win** · tabla `envio_pod_fotos(id, envio_id, tenant_id, url, storage_path, orden, created_at, created_by)` con RLS por tenant + backfill desde `envios.pod_url`. Soporta N fotos por POD; la de orden 0 sincroniza con `envios.pod_url` para retro-compat. Usada por componente `PodFotosManager` |
| 145 | `145_fix_pagar_nomina_saldo.sql` | **Bugfix ISS-186** · `pagar_nomina_empleado` ahora cuenta `ingreso_traspaso`/`egreso_traspaso` en el saldo. Antes la bóveda (que recibe por traspaso) daba "saldo insuficiente" al pagar nómina |
| 146 | `146_caja_traspasos_movimientos_fk.sql` | **Bugfix ISS-193** · `caja_traspasos.movimiento_origen_id` + `movimiento_destino_id` (FK a caja_movimientos). Permite que al corregir un traspaso se ajuste la caja contraparte (devuelve/cobra la diferencia) |
| 147 | `147_empleados_supervisor_empleado.sql` | **Bugfix ISS-185** · `empleados.supervisor_id` re-apuntado de `users(id)` a `empleados(id)` — organigrama armado con empleados de RRHH. `get_supervisor_team_ids()` reescrita: mapea `auth.uid()` → `empleados.user_id` → `supervisor_id`. ⚠ Nulea supervisor_id viejos que apuntaban a users |
| 148 | `148_unidades_medida_predefinidas.sql` | **ISS-180** · columna `predefinida BOOLEAN` en `unidades_medida`. Seed de 6 unidades predefinidas por tenant (Unidad/kg/g/L/m/caja). Backfill tenants existentes. Predefinidas no son editables ni eliminables desde UI |
| 149 | `149_metodos_pago_habilitado_ventas_gastos.sql` | **ISS-135** · `habilitado_ventas` + `habilitado_gastos` en `metodos_pago` (default `true`). ConfigPage muestra toggles POS/Gastos por método. VentasPage y GastosPage filtran por estos flags |
| 150 | `150_gastos_pago_parcial.sql` | **ISS-190** · `monto_pagado NUMERIC` + `estado_pago TEXT` (`pendiente/parcial/pagado`) en `gastos`. Backfill: gastos con `medio_pago` → `pagado`; sin medio → `pendiente`. Índice por `(tenant_id, estado_pago)` |
| 151 | `151_empleados_user_id_unique.sql` | **RRHH-A5** · UNIQUE parcial `empleados(tenant_id, user_id) WHERE user_id IS NOT NULL`. Garantiza que un user del sistema esté vinculado a un único empleado por tenant. Habilita "Mi Equipo" del SUPERVISOR (`get_supervisor_team_ids` mapea `auth.uid()` → `empleados.user_id` unívocamente) |
| 152 | `152_envios_rangos_horarios.sql` | **ISS-178** · `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos (8-13/13-18/18-22) + `envios.rango_horario_desde/hasta TIME` (snapshot al momento del envío, no rompe si después se borra el rango). Editable en Config → Envíos, selector en modal de envío de VentasPage y form de EnviosPage |
| 153 | `153_venta_item_despachos.sql` | **ISS-075** · Nueva tabla `venta_item_despachos`: desglose de despacho por LPN/ubicación de cada `venta_item` (una fila por porción/línea de origen o por serie). Campos texto (`lpn`, `ubicacion_nombre`, `nro_serie`) = snapshot intacto ante edición/borrado del LPN. RLS por tenant. Capturada en `registrarVenta` Fase 2 + transición reserva→despacho |
| 154 | `154_trazabilidad_asignacion_stock.sql` | **ISS-075** · `venta_item_despachos.origen TEXT` (`manual`/`auto`: si el LPN lo eligió el operador o la regla de rebaje del sistema) + `tenants.trazabilidad_asignacion BOOLEAN DEFAULT TRUE` (toggle en Config → Inventario para activar/desactivar el registro del desglose) |
| 155 | `155_actividad_log_ledger.sql` | **Trazabilidad-extendida** · `actividad_log` pasa a ledger grado WMS: +7 columnas aditivas nullables (`transaccion_id`, `tipo_transaccion`, `producto_id`, `lpn`, `nro_serie`, `lote`, `sucursal_id`) — todas snapshot, sin backfill (filas legacy quedan con `transaccion_id` NULL). Habilita consolidar N filas de una acción en 1 transacción + trazabilidad por unidad (recall) por LPN/serie. Índices por `transaccion_id`, `(tenant_id, producto_id)`, `(tenant_id, lpn)`, `(tenant_id, nro_serie)`. Ver [[reportes-metricas]] |
| 156 | `156_venta_items_lpn_plan.sql` | **Reservas — selección manual de LPN** · `venta_items.lpn_plan JSONB` (`[{linea_id,lpn,cantidad,manual}]`). Persiste el plan de LPN del carrito para honrarlo al despachar una reserva (`cambiarEstado`): Fase A sigue el plan, Fase B autocompleta por sort si cambió el stock. Aditiva/nullable (venta directa / items serializados / ventas legacy quedan NULL → sort automático, comportamiento previo) |
| 157 | `157_codigo_perfiles.sql` | **ISS-127 F1** · Tabla `codigo_perfiles` (perfiles de códigos compuestos GS1/custom: `proveedor_id`, `tipo gs1/custom`, `simbologia gs1_128/datamatrix`, `ais JSONB`, `custom_format JSONB`, `lectura_modo autocompletar/directo`). RLS por tenant |
| 158 | `158_productos_gtin.sql` | **ISS-127 F1** · `productos.gtin TEXT` + índice `(tenant_id, gtin)`. GTIN dedicado (GS1 AI 01) para match de códigos compuestos; fallback a `codigo_barras` si NULL |
| 159 | `159_presupuesto_numero.sql` | **Relevamiento Ventas F5** · `ventas.presupuesto_numero` + `presupuesto_numero_sucursal`. Trigger `gen_venta_numero` asigna correlativo de presupuesto independiente (solo si nace `estado='pendiente'`), sin tocar la numeración de ventas. Backfill de presupuestos existentes (deshabilita `trg_ventas_cierre` durante el UPDATE). UI: `formatTicket` → `PRES-{cod}-NNNN` |
| 160 | `160_reservas_sena_vencimiento.sql` | **Relevamiento Ventas E1/E2/E6** · `tenants`: `reserva_sena_obligatoria`, `reserva_sena_minima_pct`, `reserva_vencimiento_dias` (NULL=sin venc.), `reserva_penalidad_pct`. `ventas.reservado_at`. Tabla `cliente_creditos` (ledger saldo a favor, RLS por tenant). Función `liberar_reservas_vencidas(tenant)` SECURITY DEFINER: libera stock reservado + cancela vencidas (NO toca dinero; cada reserva atómica, saltea período cerrado). GRANT a `authenticated` |
| 161 | `161_producto_precio_usd.sql` | **Relevamiento Ventas G5** · `productos.precio_usd DECIMAL` + `productos.moneda_venta TEXT DEFAULT 'local'` (`'local'` \| `'usd'`). Si `'usd'`, el POS convierte `precio_usd` a moneda local a la cotización vigente al cargar al carrito |
| 162 | `162_courier_credenciales.sql` | **ISS-174 F1** · Tabla `courier_credenciales` (`tenant_id, courier, credenciales JSONB, activo`, UNIQUE(tenant,courier), RLS por tenant) — credenciales de API de courier por tenant, usadas server-side. `tenants.envio_peso_fuente TEXT DEFAULT 'manual'` CHECK(`'manual'`\|`'producto'`) — fuente del peso/medidas al cotizar |
| 163 | `163_codigo_postal.sql` | **ISS-174 F1** · Idempotente: `codigo_postal` ya existía en `sucursales` (mig 124) y `cliente_domicilios` (mig 074); re-documenta el propósito para cotización de envíos |
| 164 | `164_productos_peso_dimensiones.sql` | **ISS-174 F1** · `productos.peso_kg DECIMAL(10,3)` + `largo_cm/ancho_cm/alto_cm DECIMAL(10,2)` (nullable) — dato maestro de peso/volumen para cotizar envíos cuando `envio_peso_fuente='producto'` |
| 165 | `165_envios_cotizacion_api.sql` | **ISS-174 F2** · `envios.cotizacion_json JSONB` (snapshot de la opción elegida + opciones) + `courier_orden_id TEXT` (ID de la orden en el courier) + `cotizado_api BOOLEAN DEFAULT false`. Metadata de la integración por API (Edge Function `courier-api`) |
| 166 | `166_fix_seed_categorias_gasto_security_definer.sql` | **Hotfix onboarding (v1.14.1)** · `seed_categorias_gasto()` + `fn_seed_categorias_gasto_new_tenant()` pasan a **SECURITY DEFINER** (+ `search_path=public`). El trigger AFTER INSERT en `tenants` seedeaba categorías de gasto antes de existir la fila en `users`, y el RLS WITH CHECK rechazaba el INSERT → registro de negocio nuevo fallaba. Las otras 2 funciones de seed del tenant ya eran SECURITY DEFINER |
| 167 | `167_ventas_consumidor_final.sql` | **VF1/H5** · `ventas.consumidor_final BOOLEAN DEFAULT TRUE`. Flag por venta (Consumidor Final vs cliente registrado); con facturación activa y no-CF el cliente es obligatorio |
| 168 | `168_canales_venta.sql` | **VF2/I1+I2** · Tabla `canales_venta` (`tenant_id, nombre, clasificacion online\|presencial, icono, activo, predefinido, orden`) + seed `SECURITY DEFINER` + trigger AFTER INSERT en `tenants` + backfill. `tenants.reglas_canal JSONB` (reglas por clasificación: devolucion_dias, descuento_max_pct, lista_precio, requiere_cliente). MP no se seedea (es medio de pago) |
| 169 | `169_venta_auditoria.sql` | **VF3/J1** · Tabla `venta_auditoria` (`tenant_id, venta_id, accion, detalle JSONB, usuario_id, usuario_nombre`) — audit log detallado por venta (anulación, cambio de cliente, override de descuento), visible en el modal de la venta. RLS por tenant |
| 170 | `170_alertas_ventas_config.sql` | **VF4/K2** · `tenants.alerta_margen_negativo BOOLEAN`, `alerta_devoluciones_n INT` (NULL=off), `alerta_devoluciones_dias INT DEFAULT 30`. Umbrales de alertas de ventas event-driven (margen negativo al cerrar venta; cliente/producto con >N devoluciones en M días) |
| 171 | `171_clientes_cl1.sql` | **Clientes CL1** · `clientes.motivo_baja/baja_at/baja_por` (A6 soft delete con razón) + índice parcial `idx_clientes_activo`. `tenants.cliente_etiquetas_catalogo TEXT[]` (F1 catálogo de etiquetas para autocomplete) |
| 172 | `172_clientes_cl2_cc.sql` | **Clientes CL2** · CC clientes. `tenants.limite_cc_default`, `cc_enforcement_politica` (permitir\|avisar\|bloquear), `cc_morosidad_politica` (permitir\|bloqueo_cc\|bloqueo_total), `cc_dias_vencimiento INT`, `cc_interes_mensual_pct`. `ventas.fecha_vencimiento_cc DATE` + `interes_cc DECIMAL`. RPC `cliente_cc_estado(cliente)` (deuda_total/vencida/interés, SECURITY DEFINER tenant-scoped) + `recalcular_intereses_cc(tenant)` (sweep-lazy idempotente de intereses de mora; pg_cron no habilitado) |
| 173 | `173_clientes_cl3.sql` | **Clientes CL3** · B8 estado de cuenta. `clientes.cuenta_token TEXT UNIQUE` + índice parcial. RPC `get_cuenta_cliente_by_token(token)` → JSONB (cliente + ventas CC pendientes), SECURITY DEFINER, GRANT anon — portal público `/cuenta/:token`. B6 incobrable se resuelve en app (sin DDL) |
| 174 | `174_fix_ventas_origen_check.sql` | **Bugfix** · `DROP CONSTRAINT ventas_origen_check`. Desde mig 168 el canal de venta (`ventas.origen`) es configurable por tenant (catálogo `canales_venta`); la constraint rígida (lista fija, mig 122) rechazaba canales nuevos → "new row violates check constraint ventas_origen_check" al vender. El canal se valida a nivel de app |
| 175 | `175_clientes_cl4_notif.sql` | **Clientes CL4** · Config de notificaciones CC en `tenants`: `cc_notif_canales TEXT[]` (email\|whatsapp), `cc_notif_registro_deuda` (C1), `cc_notif_pago` (C4), `cc_notif_pre_venc_dias INT` (C2, default 3), `cc_notif_escalado_dias INT` (C3), `cumple_notif_cliente`/`cumple_notif_duenio` (C5). Defaults OFF (opt-in). Emails event-driven vía Edge Function `send-email` |
| 176 | `176_proveedores_cl5.sql` | **Clientes CL5** · D6: tabla `proveedor_cuentas_bancarias` (banco/titular/cbu/alias/cuenta/es_principal, RLS por tenant) — cuentas bancarias múltiples por proveedor. D4: `proveedor_cc_movimientos.nc_numero` + `adjunto_url` (correlativo y comprobante de NC) |
| 177 | `177_conteos_scope.sql` | **Conteos 2.0 F1** · amplía el CHECK de `inventario_conteos.tipo` (`+ 'marca','categoria','sucursal'`) y agrega `filtros JSONB DEFAULT '{}'` (criterio del conteo cuando el alcance no es FK directa: `{marca}`/`{categoria_id,categoria_nombre}`). Aditiva, idempotente, sin impacto en RLS |
| 178 | `178_conteos_f2a.sql` | **Conteos 2.0 F2a** · `tenants.conteo_modo` (rapido\|guiado\|elegir) · `ubicaciones.secuencia INTEGER` (orden recorrido conteo+picking) · `inventario_conteos.modo` (rapido\|guiado) · `inventario_conteo_items.cantidad_contada` → **NULLABLE** (distingue no-contada de cero, B3). CHECKs idempotentes vía `information_schema.table_constraints` |
| 179 | `179_conteos_f3.sql` | **Conteos 2.0 F3** · `'ajuste_conteo'` en el CHECK de `autorizaciones_inventario.tipo` (gate de aprobación de diferencias de conteo) · `tenants` + 7 columnas de config: `conteo_gate_activo BOOLEAN` + umbrales gate (`_umbral_u/_pct/_valor`) + umbrales reconteo (`_reconteo_umbral_u/_pct/_valor`). Aditiva |
| 180 | `180_conteos_f4.sql` | **Conteos 2.0 F4** · `productos.clase_abc TEXT` (CHECK A/B/C) + `clase_abc_manual BOOLEAN` (override que el recálculo no pisa) + `ultimo_conteo_at TIMESTAMPTZ` · `inventario_conteo_items.contado_por UUID REFERENCES users(id)` (trazabilidad por operador) · `tenants.conteo_ciclico_dias_a/_b/_c INTEGER DEFAULT 30/90/180` (config cíclico) · índice `idx_productos_clase_abc(tenant_id, clase_abc, ultimo_conteo_at)`. Aditiva, idempotente, sin impacto en RLS |
| 181 | `181_conteos_f2bref_f3b_a2.sql` | **Conteos 2.0 cierre 100%** · F2b-ref: `inventario_conteo_items.fuera_de_scope BOOLEAN` (mercadería mal ubicada escaneada) · F3b: `costo_snapshot NUMERIC` (costo congelado al cargar) + `cantidad_reconteo NUMERIC` + `reconteo_por UUID REFERENCES users(id)` (doble conteo formal) · A2: `inventario_conteos.bloquea_movimientos BOOLEAN` + `tenants.conteo_wall_to_wall_bloquea BOOLEAN` (wall-to-wall bloquea sucursal) + índice parcial `idx_conteos_bloqueo`. Aditiva, idempotente |
| 182 | `182_compras_co1_gobierno.sql` | **Compras CO1** · `tenants.oc_aprobacion_activa/_umbral` (A2 aprobación) + `oc_numeracion` (A5, CHECK tenant\|sucursal\|proveedor) + `oc_pago_doble_firma_umbral` (D5) · `ordenes_compra.numero_sucursal` (A5) + `requiere_aprobacion`/`aprobada_por`/`aprobada_at` (A2) · `set_oc_numero()` actualizado (asigna numero + numero_sucursal). Aditiva |
| 183 | `183_compras_co2_recepcion.sql` | **Compras CO2** · `recepcion_items.motivo_faltante` (B4) · `recepciones.remito_url` (B7) · `tenants.over_receipt_pct_max` (B3) + `recepcion_remito_obligatorio` (B7) + `recepcion_alerta_faltante_dias` (B4) · bucket privado `remitos` + policies scoped por tenant. (B5 robustez = recálculo acumulado en la app.) Aditiva |
| 184 | `184_compras_co3_costos.sql` | **Compras CO3** · `tenants.compras_costo_alerta_pct` (E1, default 10) · `ordenes_compra.costo_aduana/comision/otros` (E2) · `productos.pendiente_revision` (E3) + índice parcial. B6 editar precio = audit en `actividad_log`. Aditiva |
| 185 | `185_compras_co4_devolucion_proveedor.sql` | **Compras CO4** · tablas `devoluciones_proveedor` (proveedor/oc/recepcion/sucursal, `forma` CHECK credito_cc\|efectivo\|reposicion, motivo, observacion, monto, caja_sesion_id, oc_reposicion_id) + `devolucion_proveedor_items` (producto/cantidad/costo_unitario/lpn), RLS por tenant + trigger `set_devprov_numero` (correlativo). Confirm/stock/CC/caja/reposición en la app |
| 186 | `186_compras_co5_pago_anticipo.sql` | **Compras CO5** · `proveedores.modo_pago` (CHECK contado\|anticipo\|contra_entrega\|cuenta_corriente) + `anticipo_pct` (D1) · `ordenes_compra.paga_con_anticipo` + `anticipo_pct` snapshot (D1) + `pago_schedule JSONB` (D2). D3 transferencia con comprobante reusa `ordenes_compra.comprobante_url` (sin columna). Aditiva |
| 187 | `187_compras_co6_cheques.sql` | **Compras CO6** · tabla `cheques` (tipo propio/tercero, nro/banco/monto, fecha_emision/cobro, estado CHECK en_cartera\|entregado\|depositado\|cobrado\|endosado\|rechazado\|anulado, proveedor_id, endosado_a_proveedor_id, cliente_origen, oc_id, sucursal_id), RLS por tenant + trigger `set_cheque_numero` (correlativo) + `tenants.cheques_alerta_dias` (default 7). Aditiva |
| 188 | `188_compras_co7b_servicios.sql` | **Compras CO7b** · `servicio_items` += `recurrente`/`frecuencia`/`proximo_vencimiento`/`activo` (F1) + `proveedor_id` ahora **nullable** (F2 servicios genéricos del tenant). F3 (comparar presupuestos) = vista en la app. Aditiva |
| 189 | `189_envios_en1_pagos_courier.sql` | **Envíos EN1** · `envios.gasto_id`/`courier_factura_id` (C2/C3) + `tenants.envio_courier_genera_gasto`/`envio_courier_iva_pct`/`envio_pago_doble_firma_umbral` (C2/C4) + tablas `courier_facturas` + `courier_factura_lineas` con RLS (C3 conciliación). Aditiva |
| 190 | `190_envios_en2_pod_robusto.sql` | **Envíos EN2 (POD robusto)** · `envios` += pod_firma_url/pod_dni/pod_lat/pod_lon/pod_geo_estado/pod_otp_verificado/intentos/subestado_no_entrega/no_entrega_motivo + `tenants` config POD (pod_campos_requeridos JSONB, pod_foto_min, pod_otp_umbral, envio_geoloc_alerta_km, envio_reintentos_max, envio_reintento_recargo) + tabla `envio_otp` (RLS) + RPCs públicas del transportista ampliadas (get/update_envio_by_token + generar/verificar_otp_envio, SECURITY DEFINER). Aditiva |
| 191 | `191_envios_en3_reparto.sql` | **Envíos EN3 (reparto)** · tabla `repartidores` (RLS, FK empleados) + `envios.repartidor_id`/`token_expira_at`/`hoja_ruta_id` + `tenants` reparto (envio_token_politica/dias, envio_identidad_modo, envio_notif_en_camino, envio_hoja_ruta_modo) + tablas `hojas_ruta`+`hoja_ruta_envios`+`envio_incidencias` (RLS) + RPCs `get_envio_by_token` (ampliada, chequea expiración), `reportar_incidencia_envio`, `get_hoja_ruta_by_token` (SECURITY DEFINER anon). Aditiva |
| 192 | `192_envios_en4_tarifas.sql` | **Envíos EN4 (tarifas)** · `tenants` += envio_factor_km/envio_costo_minimo/envio_tramos/envio_recargo_horario/envio_cobro_politica/envio_cobro_margen_pct/envio_subsidio_umbral/envio_gratis_reglas (B1-B5) + `envios` += diferencia_tipo/diferencia_monto/diferencia_motivo (B6). Aditiva |
| 193 | `193_envios_en5_creacion.sql` | **Envíos EN5 (creación/alcance)** · `envios` += tipo/motivo/sucursal_destino_id (A2) + `tenants` += cp_courier_preferido (A3) / envio_plazo_despacho (A4) + tabla `envio_items` (A5 desglose, RLS). A1 (DEPOSITO crea) = solo permiso UI. Aditiva |
| 194 | `194_envios_en7_propio_reportes.sql` | **Envíos EN7 (propio + reportes)** · `envios` += recurso_id/km_recorridos/gasto_combustible_id (G2) + `recursos` += km_acumulado/consumo_litros_100km (G2) + `tenants` += envio_combustible_precio_litro (G2) / envio_alerta_sin_despacho_horas/pod_pendiente_dias/pago_courier_dias/diferencia_pct (H2) + seed idempotente categoría "Combustible". H1/H3 (reportes/export/etiquetas) = solo frontend. Aditiva |
| 195 | `195_rrhh_rh1_empleados.sql` | **RRHH RH1 (empleados 2.0)** · `empleados` += motivo_egreso (A2) / cbu/alias_cbu/banco/tipo_cuenta/titular_cuenta (A4) + tabla `rrhh_tipos_contrato` (A3, RLS + seed base AR) + **drop** `empleados_tipo_contrato_check`. Aditiva |
| 196 | `196_rrhh_rh2_aportes_sac.sql` | **RRHH RH2 (aportes + SAC)** · `rrhh_conceptos` += pais/predefinido/tipo_calculo/default_pct/default_monto/es_aporte (B3/B4) + `empleados` += config_aportes/beneficios_extra JSONB (B4) + seed catálogo AR (Jubilación 11%/OS 3%/Ley 19.032 3%/Antigüedad/Presentismo/Sindicato, idempotente). Aditiva |
| 197 | `197_rrhh_rh3_nomina_contable.sql` | **RRHH RH3 (nómina contable)** · `rrhh_salarios` += gasto_id (B7) / comprobante_firmado_url (B6) + `tenants` += rrhh_nomina_doble_validacion/_supervisor_aprueba (B8) + categorías de gasto "Sueldos"+"Cargas sociales" (idempotente). Aditiva |
| 198 | `198_rrhh_rh6_asistencia.sql` | **RRHH RH6 (asistencia 2.0)** · tablas `rrhh_fichadas` (D1) + `rrhh_horas_extra` (D5, RLS) + `empleados` += horario_entrada/salida/dias_laborales (D2) + `rrhh_asistencia` += tipo_licencia/comprobante_url/minutos_tarde (D3/D4) + `rrhh_feriados` += regla_pago (D6) + `tenants` += rrhh_tardanza_modo/tolerancia/horas_extra_requiere_aprobacion/horas_mes_base. Aditiva |
| 199 | `199_rrhh_rh4_frecuencia_anticipos.sql` | **RRHH RH4 (frecuencia + anticipos)** · `empleados` += frecuencia_liquidacion/frecuencia_dias (B1, prorratea básico) + tabla `rrhh_anticipos` (B10, RLS; descuento auto en próxima liquidación) + categoría de gasto "Adelantos al personal" (idempotente). Aditiva |
| 200 | `200_rrhh_rh5_vacaciones.sql` | **RRHH RH5 (vacaciones 2.0)** · `rrhh_vacaciones_solicitud` **drop** estado_check (C2, estados validados en app) + preaprobado_por/at + `tenants` += rrhh_vacaciones_flujo (C2) / rrhh_vacaciones_aviso (C3) / rrhh_vacaciones_remanente_max (C6) / rrhh_vacaciones_min_bloque/max_bloques (C5). C1 (días LCT) y C4 (solapamiento) = frontend. Aditiva |
| 201 | `201_rrhh_rh7_docs_evaluacion.sql` | **RRHH RH7 (docs/evaluación/portal)** · tabla `rrhh_documentos_catalogo` (E1, RLS) + `rrhh_documentos` += fecha_vencimiento/catalogo_id (E2) + `rrhh_capacitaciones` += obligatoria (E3) + tabla `rrhh_evaluaciones` (F4, RLS) + `tenants` += rrhh_portal_empleado/_capacidades (F2) / rrhh_notif_config (F3) / rrhh_doc_alerta_dias (E2). Aditiva |
| 202 | `202_rrhh_rh8_liquidacion_final.sql` | **RRHH RH8 (liquidación final)** · tabla `rrhh_liquidaciones_finales` (A2-c, RLS; indemnización+SAC proporcional+vacaciones no gozadas, link al gasto). G1 reportes + G2 export = solo frontend. Aditiva. **🎉 RRHH 2.0 (RH1-RH8) COMPLETO** |
| 203 | `203_caja_cierre_relevamiento.sql` | **Caja — cierre del relevamiento (v1.50.0)** · tabla `boveda_arqueos` (E3 arqueo manual de bóveda, RLS DUEÑO/ADMIN/SUPER_USUARIO + GRANT) + `rrhh_anticipos` += `es_prestamo`/`documento_url` (L3 préstamo a empleado). E1 (bóveda roles custom), M3 (panel cajero), M4 (sonido) = solo frontend. Aditiva. **DEV + PROD ✅ (2026-06-10)** |
| 204 | `204_rrhh_fichado_qr.sql` | **RRHH — fichado por QR público (v1.51.0)** · `tenants.fichado_token` (+ índice único parcial) + RPCs `get_fichado_info(text)` / `fichar_qr(text,uuid)` **SECURITY DEFINER** (`SET search_path=public`) con **GRANT EXECUTE a anon, authenticated** (kiosco /fichar/:token). Auto-descuento de tardanza + portal del empleado = solo frontend (columnas/config ya existían). Aditiva. **DEV + PROD ✅ (2026-06-10)** |
| 205 | `205_traslados_sucursal.sql` | **Traslados de stock entre sucursales (v1.53.0, auditoría #4)** · tablas `traslados` (correlativo por tenant vía trigger `set_traslado_numero`, estados `en_transito/recibido/recibido_parcial/cancelado`, `envio_id` reservado) + `traslado_items` (snapshot LPN/lote/vencimiento/estado/costo + `series JSONB` + `cantidad_recibida`). RLS por tenant en ambas. Reusa `movimientos_stock` tipo `'traslado'` (en el CHECK desde mig 055). Aditiva. **DEV + PROD ✅ (2026-06-11)** |
| 206 | `206_cheques_gasto_link.sql` | **Cheques conectados al circuito de pago (v1.54.0, auditoría #5)** · `cheques.gasto_id` REFERENCES gastos (ON DELETE SET NULL) + índices parciales `idx_cheques_gasto`/`idx_cheques_oc` (`oc_id` existía desde mig 187 pero nunca se llenaba). Pagar OC/gasto con "Cheque" crea el cheque vinculado; rechazado revierte el pago + ajuste en CC proveedor. Aditiva. **DEV + PROD ✅ (2026-06-12)** |
| 207 | `207_modo_operacion.sql` | **Modo de operación Básico vs Avanzado (v1.55.0)** · `tenants.modo_operacion TEXT NOT NULL DEFAULT 'basico'` CHECK (`basico`/`avanzado`) + backfill `UPDATE tenants SET modo_operacion='avanzado'` (existentes conservan la UI completa; solo tenants nuevos arrancan en básico). El modo gatea UI, nunca datos. Rollback: UPDATE a `avanzado` o DROP COLUMN (front viejo compatible). Aditiva. **DEV + PROD ✅ (2026-06-13, PR #189)** |
| 210 | `210_afip_produccion_por_tenant.sql` | **Flag por-tenant de producción AFIP (v1.60.0)** · `tenants.afip_produccion BOOLEAN NOT NULL DEFAULT false` (todos los tenants existentes → homologación, cero impacto). La EF `emitir-factura` lo lee como fuente de verdad para homologación↔producción (reemplaza la decisión global `AFIP_PRODUCTION`; queda `AFIP_FORCE_HOMOLOGACION` como freno de emergencia). Permite pasar a producción real un cliente a la vez. Aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`). **DEV + PROD ✅ (PR #197)** |
| 211 | `211_bucket_logos_tenant.sql` | **Bucket `logos` para el logo del negocio (v1.61.0, paridad Xubio)** · crea el bucket `logos` (público) + policies SELECT/INSERT/UPDATE/DELETE **scopeadas por carpeta de tenant** (`{tenant_id}/logo.ext`, mismo patrón que `productos` de mig 209). `tenants.logo_url` ya existía (mig 001). El PDF embebe el logo vía URL pública (CDN). Idempotente (`ON CONFLICT` + `DROP POLICY IF EXISTS`). **DEV + PROD ✅ (PR #200)** |
| 212 | `212_tenant_datos_comprobante.sql` | **Datos del emisor para comprobantes (v1.62.0, paridad Xubio)** · `tenants += ingresos_brutos TEXT, inicio_actividades DATE, cbu TEXT, alias_cbu TEXT, banco TEXT, leyenda_comprobante TEXT, sitio_web TEXT` (todos opcionales). Salen en factura/presupuesto/remito (IIBB + inicio act en el encabezado; CBU/Alias/Banco + leyenda en el pie). Aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`). **DEV + PROD ✅ (PR #201)** |
| 213 | `213_ventas_recurrentes.sql` | **Facturas/ventas recurrentes (v1.65.0)** · tabla `ventas_recurrentes` (plantilla: `cliente_id`/`cliente_nombre`, `nombre`, `frecuencia_dias`, `proximo_at` DATE, `activo`, `items` JSONB snapshot, `notas`, `ultima_generada_at`) + índices + RLS por tenant. Generación asistida en el frontend (crea presupuesto 'pendiente', no toca stock/caja). Aditiva e idempotente. **DEV + PROD ✅ (PR #205)** |
| 214 | `214_users_rol_viewer.sql` | **Rol fijo VIEWER/Lector (v1.72.0)** · amplía el CHECK de `users.rol` agregando `'VIEWER'` (DROP + ADD CONSTRAINT). Rol pasivo de solo-lectura; el enforcement es en la app (`permisosModulo.ts`). Aditiva (solo widening de constraint). **DEV + PROD ✅** |
| 215 | `215_cron_sweeps_all_tenants.sql` | **Sweeps all-tenants para cron externo (v1.73.0, issue #7)** · funciones SECURITY DEFINER `liberar_reservas_vencidas_all()` (loopea tenants y llama la per-tenant) + `recalcular_intereses_cc_all()` (replica la lógica de mig 172 por tenant, porque la original exige `auth.uid()`). `REVOKE FROM PUBLIC` + `GRANT EXECUTE TO service_role` (las invoca la EF `cron-sweeps`). Idempotente (`CREATE OR REPLACE`). pg_cron NO habilitado → el disparador es GitHub Actions (`sweeps.yml`). **DEV + PROD ✅** |
| 216 | `216_rls_sucursal_core.sql` | **🔒 RLS por sucursal — tanda 1 / core (v1.75.0, #8)** · helpers `auth_ve_todas_sucursales()` (espeja `authStore.puedeVerTodas`: DUEÑO siempre; SUPERVISOR/SUPER_USUARIO/VIEWER global salvo `puede_ver_todas=false`; resto solo si `true`) + `auth_user_sucursal()` (STABLE SECURITY DEFINER, `search_path=public`). Reescribe las policies de `ventas`, `caja_sesiones`, `gastos`, `inventario_lineas`, `movimientos_stock` (SELECT). Patrón `tenant AND ( ve_todas OR sucursal_id IS NULL OR = la del usuario )`; `WITH CHECK` tenant-only. Idempotente (DROP POLICY IF EXISTS). **DEV + PROD ✅ (PR #219)** |
| 217 | `217_rls_sucursal_operativas.sql` | **RLS por sucursal — tanda 2 / operativas (v1.75.0)** · mismo patrón en `envios`, `ordenes_compra`, `recepciones`, `recursos`, `cajas` (bóveda `sucursal_id` NULL sigue visible), `inventario_conteos`. **DEV + PROD ✅ (PR #219)** |
| 218 | `218_rls_sucursal_hijas.sql` | **RLS por sucursal — tanda 3 / hijas sin sucursal_id (v1.75.0)** · scopean vía el padre (1 salto). Con `tenant_id`: venta_items/series/despachos/auditoria, devoluciones (SELECT), caja_movimientos, caja_arqueos, envio_items, inventario_series. **Sin `tenant_id`** (scopean 100% por el padre): orden_compra_items, recepcion_items, inventario_conteo_items. Dejadas tenant-only: finanzas/tesorería, integración, cross-sucursal (caja_traspasos/traslado_items) y devolucion_items (2 saltos). **DEV + PROD ✅ (PR #219)** |
| 219 | `219_fix_rls_notificaciones_insert.sql` | **🔔 Fix RLS `notificaciones` — INSERT cross-user (v1.77.0, auditoría UAT pase 3)** · TODAS las notificaciones in-app las genera un usuario PARA OTROS (cajero → supervisores/dueño: solicitud Caja Fuerte, diferencia apertura/cierre, alertas de venta). La policy bloqueaba el INSERT `user_id != auth.uid()` → nunca se creaban (la de Caja Fuerte además **abortaba** el pedido por `throw`). PROD y DEV estaban **desincronizados** (PROD `notif_user FOR ALL`; DEV `notif_select`+`notif_update` fuera de banda y SIN policy de INSERT). Normaliza a 4 policies: `notif_select`/`notif_update`/`notif_delete` solo propias (aislamiento intacto) + `notif_insert WITH CHECK (tenant_id = get_user_tenant_id())`. Idempotente (DROP POLICY IF EXISTS). Validada impersonando cajero en ambos entornos. **DEV + PROD ✅ (PR #221)** |
| 224 | `224_panel_soporte_leads.sql` | **🛟 CRM de leads del panel (Fase 3)** · tabla `leads` (nombre, empresa, email, estado lead→qualified→demo→trial→won/lost, valor_estimado, origen, asignado_a, tenant_id si convierte). RLS default-deny → EF `admin-api`. EF v4 agrega `crm.leads.list/create/update`, `billing.overview` (MRR + por plan vía join `tenants`→`planes.precio_mensual`) y MRR en `metrics.overview`. **DEV + PROD ✅** |
| 233 | `233_clave_maestra_hash.sql` | **🔐 Clave maestra HASHEADA (bcrypt) + setter server-side** · hasta acá `tenants.clave_maestra` se guardaba en TEXTO PLANO y viajaba al cliente. (a) backfill: hashea las existentes con `extensions.crypt(.., gen_salt('bf'))` (preserva el valor, no es reescritura de historial); (b) `verificar_clave_maestra` compara contra el hash (fallback compat a texto plano); (c) nuevo RPC `set_clave_maestra(p_clave)` SECURITY DEFINER: solo **DUEÑO** del tenant, mínimo 6 chars, hashea server-side. Frontend `ConfigPage` agrega campo de confirmación + valida + guarda vía el RPC (ya no escribe directo). La clave gatea anular/abrir-con-diferencia/cerrar-caja-ajena/incobrable/pago OC-courier. pgcrypto verificado en `extensions` de PROD; backfill hasheó la única clave plaintext de los 5 tenants. **DEV + PROD ✅ (v1.80.2, PR #235)** |
| 234 | `234_ventas_cc_guard_server.sql` | **🔐 Guard server-side de Cuenta Corriente** (REGLA #0 obligación #3: guards server además de UI) · `fn_ventas_cc_guard` BEFORE INSERT en `ventas`: enforza **límite CC (B1)** + **morosidad (B4)** server-side (antes solo en el frontend → bypasseable por API/bundle cacheado). Espeja la lógica de `ccLogic.ts`: morosidad `bloqueo_total`/`bloqueo_cc`; límite con política `bloquear` (NO `avisar` = confirm UX); `montoCC` = suma de medios 'Cuenta Corriente' del JSON `medio_pago`. **Computa la deuda INLINE scopeada por `NEW.tenant_id`** (no vía `cliente_cc_estado`, que filtra por `auth.uid()`→0 sin sesión). Verificado en DEV con 8 escenarios. **DEV + PROD ✅ (v1.81.0, PR #236)** |
| 235 | `235_ventas_writeoff_rol_guard.sql` | **🔐 Guard server-side de ROL para write-offs CC** · `fn_ventas_writeoff_rol_guard` BEFORE UPDATE en `ventas`: exige rol DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN cuando se agrega un tag `Condonación CC`/`Incobrable` nuevo (compara OLD vs NEW; no afecta cobranza normal, ni 'Revertir', ni 'Cancelación CC'). `get_user_role()` sin sesión → bloquea. La clave del incobrable sigue client-side (un trigger no puede validarla → requiere RPC). Verificado en DEV (W1-W4, impersonación). **DEV + PROD ✅ (v1.81.0, PR #236)** |
| 236 | `236_incobrable_rpc_clave_gated.sql` | **🔐 RPC clave-gated del incobrable** (REGLA #0) · `marcar_incobrable(p_cliente_id, p_clave, p_motivo)` SECURITY DEFINER: verifica rol (DUEÑO/SUPER_USUARIO/ADMIN) + **clave maestra server-side** (`verificar_clave_maestra`; antes la clave se validaba solo client-side y se omitía si no estaba configurada) + write-off atómico — condona TODA la deuda CC del cliente (espeja `confirmarIncobrable`: ventas es_cc despachada/facturada con saldo, tag 'Incobrable') + gasto "Deudor incobrable". El trigger mig 235 re-valida el rol en cada UPDATE (defense-in-depth). Wiring `ClientesPage`. Verificado en DEV (rol/clave/efecto en DB). **DEV + PROD ✅ (v1.81.0, PR #236)** |
| 237 | `237_registrar_pago_oc_rpc.sql` | **🔐 RPC atómico del pago de OC** (REGLA #0, H2) · `registrar_pago_oc(oc, medios, descuento, clave, caja, cheque, dias, condiciones)` SECURITY DEFINER: rol (no CONTADOR) + **doble firma server-side** sobre el umbral + saldo no excedible, y escribe OC + proveedor_cc (pago/oc) + cheque + caja en UNA transacción. **Cierra el hueco "se omite si no hay clave"**: si supera el umbral y el tenant NO tiene clave configurada → BLOQUEA y pide configurarla. El frontend pasa los medios enriquecidos con `cuenta_origen_id`. Wiring `GastosPage.registrarPagoOC`. Verificado en DEV (7 escenarios). **DEV + PROD ✅ (v1.81.0, PR #236)** |
| 238 | `238_marcar_envios_pagados_rpc.sql` | **🔐 RPC atómico del pago a courier** (REGLA #0, H2) · `marcar_envios_pagados(envio_ids, clave, medio, fecha, caja, genera_gasto, iva_pct, categoria_flete)` SECURITY DEFINER: **doble firma server-side** sobre el umbral (cierra el "se omite si no hay clave"); agrupa por courier (espeja `agruparPagosPorCourier`), genera un gasto por courier con desglose de IVA (`desgloseIvaFlete`) + caja + marca los envíos pagados, todo atómico. Wiring `EnviosPage.marcarPagados`. Verificado en DEV (6 escenarios, incl. multi-courier). **DEV + PROD ✅ (v1.81.0, PR #236)** |
| 239 | `239_users_caja_preferida.sql` | **🏦 Caja preferida POR USUARIO (server-side)** · `users.caja_preferida_id uuid REFERENCES cajas(id) ON DELETE SET NULL`. Antes la "caja predeterminada" vivía solo en localStorage (por dispositivo) → se perdía y "no auto-seleccionaba". Ahora persiste por usuario → auto-select fiable en POS/Caja/traspasos, en cualquier dispositivo. Aditiva/nullable. Lectura DB con fallback a localStorage; el ★ en Caja escribe en DB + store. **DEV + PROD ✅ (v1.83.0, PR #238)** |
| 240 | `240_limpieza_columnas_inertes.sql` | **🧹 Limpieza de columnas inertes de `tenants`** · DROP de `descuento_max_cajero_pct`, `email_legal`, `recepcion_alerta_faltante_dias` (0 referencias en frontend/EF/funciones/triggers, verificado). Idempotente (DROP IF EXISTS). **DEV + PROD ✅ (v1.83.0, PR #238)** |
| 242 | `242_pagar_nomina_doble_validacion_server.sql` | **🔐 Doble validación de nómina SERVER-SIDE (REGLA #0, autorización sobre plata)** · el gate `puedeAprobarNomina` vivía solo en el frontend (bypasseable por bundle/API). Ahora `pagar_nomina_empleado` lo enforcea en el server: con `rrhh_nomina_doble_validacion` ON, solo DUEÑO/ADMIN paga (o SUPERVISOR si `rrhh_nomina_supervisor_aprueba`); CAJERO → "Requiere aprobación de DUEÑO/ADMIN". Flag OFF (default) = backward-compat. DB-validado (CON flag CAJERO bloqueado/DUEÑO procede; SIN flag procede). Incluye el fix de medio de mig 241. **DEV + PROD ✅ (v1.87.0, PR #242)** |
| 241 | `241_fix_pagar_nomina_medio_no_efectivo.sql` | **🛑 FIX REGLA #0 (plata que no cuadra en caja) — pago de nómina por medio NO-efectivo** · `pagar_nomina_empleado` (mig 145) asentaba SIEMPRE `caja_movimientos` **`egreso`** (afecta el arqueo de EFECTIVO) sin importar `p_medio_pago`. La UI de RRHH ofrece efectivo/transferencia_banco/mp → pagar por transferencia o MP **descuadraba el efectivo** de la caja (restaba plata que nunca salió del cajón). FIX: efectivo→`egreso`; no-efectivo→`egreso_informativo` (no afecta efectivo) con concepto `[Transferencia]/[Mercado Pago] …` (espeja `registrar_pago_oc`/`marcar_envios_pagados`). El chequeo de saldo de efectivo ya estaba bien acotado. Detectado en el barrido UAT cobertura/05 (G1). DB-validado los 3 medios + spec 81. **DEV + PROD ✅ (v1.87.0, PR #242)** |
| 243 | `243_sweep_reservas_penalidad_credito.sql` | **🛑 REGLA #0 (plata) — sweep de reservas vencidas respeta `reserva_penalidad_pct`** · `liberar_reservas_vencidas` antes cancelaba la reserva vencida y forfeit del 100% de la seña (inconsistente con la cancelación MANUAL, que retiene la penalidad y acredita el resto — spec 59). Ahora ambos caminos coinciden: retiene `reserva_penalidad_pct`% y **acredita el resto a `cliente_creditos`** (origen `reserva_vencida`) si hay cliente; sin cliente → forfeit. La seña en efectivo ya está en caja (`ingreso_reserva`); el crédito es un pasivo, no mueve caja. SECURITY DEFINER, error-isolado. DB-validado (seña $3000/20% → crédito $2400 + stock liberado + cancelada). **DEV ✅ · PROD ✅ (v1.90.1)** |
| 244 | `244_kitting_rpcs_atomicas.sql` | **🛑 REGLA #0 (stock) — armado de KITs ATÓMICO** · `iniciar_armado_kit`/`confirmar_armado_kit`/`cancelar_armado_kit` (SECURITY INVOKER → RLS aísla por tenant). Antes iniciar/confirmar/cancelar eran varios writes sueltos desde el frontend → una falla a mitad podía dejar componentes consumidos sin KIT o reservas huérfanas. Ahora cada operación = una transacción (valida stock, reserva FIFO, rebaja componentes, ingresa el KIT + movimientos, todo o nada). Espeja la lógica de InventarioPage. DB-validado (iniciar reserva 6 → confirmar Leche 16→10 + reserva 0 + KIT ×3 + log completado). **DEV ✅ · PROD ✅ (v1.90.1)** |
| 245 | `245_readd_recepcion_alerta_faltante_dias.sql` | **📦 Re-agrega `recepcion_alerta_faltante_dias` a `tenants`** (default 7) · la columna (mig 183) la dropeó la mig 240 por "0 referencias"; ahora SÍ tiene consumidor (badge 📦 "Faltante · Nd" en la lista de OC de `GastosPage` + input configurable en Config → Compras). Aditiva idempotente. **DEV ✅ · PROD ✅ (v1.90.1)** |
| 246 | `246_devolver_saldo_a_favor.sql` | **💵 Cash-out de saldo a favor** · RPC `devolver_saldo_a_favor(p_cliente_id, p_monto, p_sesion_id, p_nota)` SECURITY INVOKER: cierra el gap de poder **devolver en efectivo** un `cliente_creditos` existente (hasta ahora solo se consumía aplicándolo a una venta). 🛑 REGLA #0 atómico + guards server-side: monto ≤ saldo a favor (SUM), sesión de caja abierta+tenant, **no caja en negativo (CAJ-18)**; asienta egreso de efectivo en caja + `cliente_creditos` negativo (origen `retiro_efectivo`). REVOKE FROM PUBLIC + GRANT authenticated/service_role. Verificado en DB DEV (happy + 2 guards, ROLLBACK). Botón "Devolver en efectivo" en el badge de saldo a favor de `ClientesPage`. Relevante a cobertura legal (devolución de dinero, ver [[wiki/features/devoluciones]]). **DEV ✅ · PROD ✅ (v1.96.0)** |
| 247 | `247_guard_subscription_status_active.sql` | **🔐 REGLA #0 (billing) — guard server-side de activación de suscripción** · trigger `BEFORE UPDATE ON tenants` (`guard_subscription_status_active`) que bloquea pasar `subscription_status` a `'active'` salvo `auth.role()='service_role'` (webhook `mp-webhook` / EF `mp-verificar-suscripcion`, ambos con pago verificado) o rol `ADMIN` (staff Genesis360; los tenants no pueden auto-asignarse ADMIN). Cierra el agujero del fallback de `SuscripcionPage` que activaba con un UPDATE directo desde el navegador (y el bypass por PATCH a PostgREST). Otras transiciones (cancelled/trial) sin tocar → cancelar sigue funcionando. Verificado por impersonación DB (DUEÑO→active BLOQUEADO, service_role→active OK, DUEÑO→cancelled OK, ROLLBACK). **DEV ✅ · PROD ✅ (v1.99.0)** |
| 248 | `248_revoke_anon_rpcs_plata.sql` | **🔐 Least-privilege: REVOKE EXECUTE de `anon` en RPCs SECURITY DEFINER de plata/config** · por los default-privileges de Supabase quedaban con EXECUTE para `anon`. Revoca anon de `marcar_incobrable`/`registrar_pago_oc`/`marcar_envios_pagados`/`set_clave_maestra` (mantienen authenticated+service_role) y de los sweeps cross-tenant `liberar_reservas_vencidas_all`/`recalcular_intereses_cc_all` (solo service_role; los llama la EF `cron-sweeps`). NO toca las funciones públicas a propósito (token/QR de envíos, fichado) ni los helpers de RLS (`get_user_*`/`is_admin`/`auth_*` — revocarles anon rompería el RLS). Verificado: anon=false en las 6; authenticated intacto en las 4 del cliente; sweeps solo service_role. **DEV ✅ · PROD ✅ (v1.99.0)** |
| 251 | `251_pricing_addons_modelo.sql` | **💠 Pricing 2026 · FASE 0 — modelo (sin enforcement)** · `tenants.plan_tier` (`free/basico/pro/enterprise`, fuente de verdad, **desacopla el tier de `max_users`** — con add-ons de usuarios max_users dejaba de ser confiable; backfill desde la inferencia actual) + tabla **`tenant_addons`** (dimension sku/movimientos/sucursales/usuarios, cantidad, tipo fijo/temporal, vence_at; RLS SELECT propio, escritura solo service_role) + **`fn_plan_base_limite(tier,dim)`** (base por tier, espejo de `PLAN_BASE_LIMITS` en brand.ts) + **`fn_tenant_limite(tenant,dim)`** (límite EFECTIVO = base + Σ add-ons activos; trial vigente → límites de 'pro'; -1 = ilimitado). Aditiva, NO bloquea nada. Verificado DEV+PROD (trial→pro, enterprise→-1). **DEV ✅ · PROD ✅ (v1.101.0)** |
| 252 | `252_pricing_enforcement_server.sql` | **💠 Pricing 2026 · FASE 1 — enforcement server-side (REGLA #0 de ingresos)** · `fn_enforce_limite()` (SECURITY DEFINER) + triggers `BEFORE INSERT OR UPDATE OF activo` en **productos (sku)**, **users (usuarios)** y **sucursales**: bloquea CREAR por encima de `fn_tenant_limite` (los recursos existentes NO se tocan; solo cuenta activos). **Movimientos DIFERIDO** (hot-path: contar en cada insert de `movimientos_stock` degrada; se hará con contador/RPC). Verificado por impersonación (ROLLBACK): seed de alta entra bajo free (1 sucursal), producto bajo límite pasa, 2ª sucursal sobre límite BLOQUEADA. Límites base nuevos ≥ viejos → sin bloqueo a existentes (PROD: 5 tenants, 0 sobre-límite). **DEV ✅ · PROD ✅ (v1.101.0)** |
| 253 | `253_tenant_addons_idempotencia.sql` | **💠 Pricing 2026 · FASE 2 — idempotencia del add-on temporal (REGLA #0)** · `CREATE UNIQUE INDEX uq_tenant_addons_mp_payment ON tenant_addons(mp_payment_id) WHERE mp_payment_id IS NOT NULL`. El webhook MP reenvía varias notificaciones por pago; el flujo legacy (incrementaba `tenants.addon_movimientos`) NO era idempotente → una re-notificación **duplicaba** los movimientos acreditados. Al mover el add-on al ledger `tenant_addons`, "1 fila por pago MP" → el webhook inserta con captura de 23505 = reintento idempotente. Aditiva/idempotente (los fijos con `mp_payment_id` NULL quedan fuera del índice). Verificado por impersonación (add-on temporal +5.000 suma al límite efectivo; duplicado del mismo pago BLOQUEADO, ROLLBACK). **DEV ✅ · PROD ✅ (v1.102.0)** |
| 254 | `254_guard_rol_admin.sql` | **🔴 SEGURIDAD REGLA #0 — bloquear escalada a rol ADMIN (aislamiento multi-tenant)** · trigger `trg_guard_rol_admin` `BEFORE INSERT OR UPDATE OF rol ON users` (`fn_guard_rol_admin`) que RECHAZA setear `rol='ADMIN'` cuando `auth.uid() IS NOT NULL AND NOT is_admin()` (usuario JWT que no es ya staff). `ADMIN` es el rol cuyo `is_admin()` da acceso a TODOS los tenants (`tenants_select`/`tenants_update`); un DUEÑO podía auto-asignárselo vía `invite-user` (rol sin whitelist, arreglado en el EF) o un `UPDATE users SET rol` directo. Permite service_role/SQL (alta de staff por GO) y a un ADMIN existente. Verificado por impersonación (service_role puede, DUEÑO auto-escalar BLOQUEADO, ROLLBACK). **DEV ✅ · PROD ✅ (v1.105.0)** |
| 255 | `255_subscription_period_end.sql` | **⏳ MP-C9 — grace period al cancelar (REGLA #0 fairness)** · `tenants += subscription_period_end TIMESTAMPTZ` (nullable). Al cancelar una sub PAGA el cliente pagó el período → conserva el acceso hasta el fin: los EFs `cancel-suscripcion`/`admin-api` guardan acá el `next_payment_date` del preapproval de MP (fallback `now()+30d`) y el `SubscriptionGuard` permite `cancelled && now < subscription_period_end`. Aditiva/idempotente; tenants existentes quedan NULL (sin grace retroactivo, correcto). El T&C sección 4 ya prometía esta política. **DEV ✅ · PROD ✅ (v1.110.0)** |
| 256 | `256_mp_billing_alertas.sql` | **🛑 REGLA #0 — sweep de reconciliación billing MP (`mp-reconciliacion`)** · tabla `mp_billing_alertas` (`tipo` ∈ huerfana/drift_mp_cobra/drift_acceso_gratis, `preapproval_id`, `tenant_id` nullable, `resuelto_at`; RLS solo `service_role`; `UNIQUE(tipo, preapproval_id)` para dedupe). La EF `mp-reconciliacion` (cron horario vía `.github/workflows/mp-reconciliacion.yml` + dispatch manual) barre `/preapproval/search` contra la DB y alerta a `soporte@genesis360.pro` UNA vez por hallazgo; **SOLO detecta y alerta, nunca activa/linkea sola** (`payer_email` vacío → sin matching confiable, resolución humana vía `billing.link_subscription`). Sale del caso Fede (preapproval `authorized` sin tenant linkeado, MP-W6). Smoke PROD: 12 preapprovals, 0 hallazgos. Aditiva. **DEV ✅ · PROD ✅ (v1.112.0)** |
| 257 | `257_trial_30_dias.sql` | **🎯 Trial 7→30 días (decisión GO)** · el `DEFAULT` de `tenants.trial_ends_at` pasa de `now()+7d` a `now()+30d` (solo aplica a tenants NUEVOS; NO reescribe los existentes). Acompaña textos actualizados en Landing (badge hero/FAQ/CTAs), `OnboardingPage`, `SuscripcionPage`, `PricingConfigurator` y el email de bienvenida (EF `send-email`). Resuelve la duda abierta en `wiki/business/planes-pricing.md` ("Free 30 días ¿trial o permanente?"); los T&C no fijan una duración numérica → sin conflicto legal. Aditiva/idempotente. **DEV ✅ · PROD ✅ (v1.113.0)** |
| 258 | `258_addon_batch_changes.sql` | **🧩 Batch de add-ons con cobro por delta (Fase 1)** · tabla `addon_batch_changes` (un batch `pendiente_pago` por tenant vía `uq_addon_batch_pendiente`, `packs_objetivo` JSONB, `monto_delta`, `monto_recurrente_nuevo`, idempotencia por `mp_payment_id`; RLS solo `service_role` + SELECT propio) + `fn_aplicar_addon_batch(tenant, change_id)` SECURITY DEFINER (sincroniza `tenant_addons` desde `packs_objetivo` + marca `aplicado`, todo en una transacción — mata el race MP-AD7 de raíz) + `uq_tenant_addons_fijo_dim` (**un pack FIJO por dimensión**, elegir otro reemplaza al anterior) + dimensión `comprobantes` habilitada en `tenant_addons`. Reemplaza el flujo "un click = un cobro" de `mp-addon-fijo` (v1.106-v1.114, validado e2e pero descartado por decisión de producto). Diseño completo en `wiki/features/configurador-addons-batch.md`. Aditiva. **DEV ✅ · PROD ✅ (v1.115.0)** |
| 259 | `259_limites_comprobantes.sql` | **💠 Pricing v2 — COMPROBANTES reemplaza a movimientos** · `fn_plan_base_limite` v2: nueva dimensión `comprobantes` (Básico 6.000/mes · Pro 14.000/mes · Free 200 · Enterprise -1 ilimitado); `movimientos` pasa a **-1 (ilimitado/telemetría)**, ya no cuenta para el enforcement (decisión GO: nunca frenar una venta en el mostrador — SOFT, enforcement por definir Q2). Espeja el catálogo v2 de `brand.ts`/`addons.ts` (packs de comprobantes fijo Y temporal: +1.000=$10k · +5.000=$30k · +10.000=$50k). Aditiva. **DEV ✅ · PROD ✅ (v1.115.0)** |
| 260 | `260_plan_upgrade_batch_arrepentimiento.sql` | **🏗 Fase 2 batch (cambio de PLAN) + ⚖️ Arrepentimiento legal** · `addon_batch_changes += plan_objetivo ('basico'/'pro') + programado_para` + estados nuevos `programado`/`esperando_cobro` (+`uq_addon_batch_programado`: un cambio programado por tenant) · `fn_aplicar_addon_batch` **v2**: aplica también `plan_objetivo` → `tenants.plan_tier` + max_users/max_productos base (acepta `pendiente_pago` y `esperando_cobro`) · `tenants += primera_compra_at` + trigger `fn_set_primera_compra` (1ª activación PAGA; ventana de arrepentimiento Ley 24.240 = +10 días corridos; NO se resetea) · tabla `billing_cancelaciones` (log legal de bajas: tenant/user/tipo arrepentimiento|cancelacion_estandar/detalle con refunds; solo `service_role`). Acompaña: EF nueva `mp-batch-sweep` (E2, workflow horario) + `cancel-suscripcion` v2 (preview/arrepentimiento con refund total fail-closed). Aditiva. **DEV ✅ · PROD ✅ (release v1.123.0, no v1.121.0/v1.122.0 por tag duplicado — PR #278+#279 mergeados, tag+GitHub release publicados, Vercel `READY` en ambos proyectos, confirmado 2026-07-09)** |
| 261 | `261_platform_billing_fede.sql` | **🧾 Facturación automática de PLATAFORMA (Fede, monotributo)** · tablas nuevas `platform_billers` (config AFIP del emisor de ingresos de plataforma — NO es un `tenants`; cuit/razón social/condición IVA/punto de venta/afipsdk_token/certificado/`afip_provider` dual-provider) + `platform_facturas` (comprobantes emitidos: monto/concepto/CAE/`payment_ref`/`tenant_origen_id` trazabilidad) + `platform_facturas_claims` (idempotencia PREVIA a llamar a AFIP — claim-before-emit por `payment_ref`, evita duplicar un CAE ante reintento de webhook o doble corrida de sweep). Acompaña: EF nueva `emitir-factura-plataforma` (Factura C ad-hoc reusando `emitir-factura/providers.ts`, fail-open ante error AFIP) + EF nueva `platform-facturacion-sweep` (reconcilia cobros recurrentes de MP contra `platform_facturas`, ya que el webhook de renovación viene con `external_reference` vacío — MP-W6). Aditiva. **DEV ✅ · PROD ✅ (release v1.123.0, deploy 100% completo 2026-07-09 — PR #278+#279, tag+release+Vercel READY; bloqueante real sigue siendo Fede completando sus 3 pasos en AfipSDK, ver [[wiki/features/facturacion-plataforma]])** |
| 262 | `262_billing_manual.sql` | **💳 Motor de pago MANUAL (`billing_mode`)** · `tenants += billing_mode ('auto'/'manual') + manual_monto_mensual + manual_paid_until + manual_ultimo_recordatorio_tipo/_at`. Tabla `billing_manual_pagos` (historial, `mp_payment_id` con índice único parcial) + `fn_registrar_pago_manual` SECURITY DEFINER (única puerta de escritura — extiende `manual_paid_until` desde el mayor entre ahora y el vencimiento actual, reactiva `subscription_status` si estaba inactive) + `fn_activar_billing_manual` (deriva el precio de lista SERVER-SIDE del `plan_tier` — el monto nunca sale del cliente; solo el DUEÑO puede llamarla). El gate de acceso sigue siendo `subscription_status` — `accesoSuscripcion.ts`/`SubscriptionGuard` sin cambios. Acompaña: EFs nuevas `billing-manual-pagar`/`billing-manual-avisar-pago`/`billing-manual-sweep` + rama `|manualpago|` en `mp-webhook` + 3 acciones nuevas en `admin-api`. Aditiva. **DEV ✅ · PROD ✅ (release v1.123.0, deploy 100% completo 2026-07-09 — PR #278+#279+genesis360-admin #3, tag+release+Vercel READY en ambos proyectos)** |
| 263 | `263_perf_rls_fk_indexes.sql` | **⚡ Performance DB — RLS + índices FK (Supabase Advisors)** · **116 `ALTER POLICY`** envolviendo cada `auth.uid()` sin envolver en `(select auth.uid())` (re-evaluación por fila → evaluación única por statement; lógica de aislamiento multi-tenant IDÉNTICA, solo la expresión USING/WITH CHECK) + **195 `CREATE INDEX IF NOT EXISTS idx_<tabla>_<columna>`** sobre columnas FK sin índice. Cierra los 2 hallazgos más grandes del Performance Advisor. Verificado en DEV tras aplicar: 0 policies con `auth.uid()` sin envolver quedan en `public`, 195 índices `idx_*` confirmados, **aislamiento multi-tenant intacto** (impersonación SQL real: SUPERVISOR de un tenant ve exactamente sus 25 productos de 136 totales en 6 tenants, cero leak). Aditiva/idempotente. **DEV ✅ · PROD ✅ (aplicada 2026-07-09, sin incidentes de lock reportados; PR #278 mergeado a `main` — release real v1.123.0)** |
| 264 | `264_afip_wsaa_ta_cache.sql` | **🧾 WSFE propio (dual-provider fase 3) — cache del TA de WSAA** · Tabla `afip_wsaa_ta` (token+sign+expiration_time del Ticket de Acceso, clave única `(cuit, service, environment)`): el TA dura ~12h y AFIP **no re-emite uno vigente** (`coe.alreadyAuthenticated`) → debe persistir entre invocaciones de la EF (instancias efímeras). Por CUIT y no por tenant (el TA es del certificado ante AFIP; terreno listo para multi-CUIT). Contiene credenciales → RLS habilitado SIN policies + REVOKE PUBLIC/anon/authenticated + GRANT solo `service_role`. La leen/escriben `emitir-factura` y `emitir-factura-plataforma` (TaCache inyectado). **DEV ✅ (2026-07-09, validada con emisión real en homologación) · PROD ✅ (2026-07-10, aplicada junto con el deploy de las EFs v13/v2).** |
| 265 | `265_afip_provider_default_propio.sql` | **🧾 WSFE propio pasa a ser el DEFAULT** · `ALTER TABLE tenants ALTER COLUMN afip_provider SET DEFAULT 'propio'` — cualquier tenant nuevo arranca directo en el circuito propio (antes `'afipsdk'`). Decisión GO 2026-07-10: sin clientes reales todavía (todos los tenants son de GO o Fede), se aprovecha la ventana para dogfoodear el circuito propio ampliamente. Acompañado de un `UPDATE` de datos (no DDL) que flipeó los 17 tenants existentes (10 DEV + 7 PROD) a `'propio'`. Reversible por-tenant sin deploy (flip manual a `'afipsdk'`). **DEV ✅ · PROD ✅ (2026-07-10).** |
| 289 | `289_wms_zonas_tareas_reabastecimiento.sql` | **🏗️ WMS — Zonas + Tareas + Reabastecimiento, schema (cierra Fases 3-5 del roadmap de estructuras-udm, v1.143.0)** · tabla nueva `zonas` (catálogo, RLS tenant-only como `ubicaciones`) + `ubicaciones.zona_id` (agrupa ubicaciones en una zona) · `reglas_almacenaje` (catálogo, sugiere zona destino por UdM al ingresar stock, sugerencia editable, NUNCA bloquea) · `producto_ubicacion_umbrales` (catálogo, mín/máx por producto+ubicación de picking, alimenta el reabastecimiento por umbral) · `wms_tareas` (operativa, RLS **por sucursal** — mismo patrón que `inventario_lineas`/`envios` — tipo picking/replenishment/putaway/conteo, estado, prioridad, producto, cantidad en unidades base, ubicación origen/destino, `envio_id`, `tarea_precedente_id` que encadena reabastecimiento→picking, origen envio/manual/umbral) · 2 flags independientes en `tenants`: `wms_reabastecimiento_on_demand` (default true) y `wms_reabastecimiento_umbral` (default false), habilitables por separado, juntos o ninguno. Aditiva. Ver [[wiki/features/wms]] → "Fase 3" y [[wiki/features/estructuras-udm]] → "Roadmap del plan". **DEV ✅ · PROD ⬜ (feature completa, deploy pendiente de que GO lo pida).** |
| 290 | `290_wms_rpcs.sql` | **🏗️ WMS — RPCs de picking y reabastecimiento (todas SECURITY INVOKER)** · `fn_generar_tareas_picking_envio(envio_id)` genera las tareas de picking de un envío leyendo la decisión de LPN YA TOMADA por la venta (`venta_item_despachos`/`venta_items.lpn_plan`), encadenando una tarea `replenishment` precedente si el LPN vive fuera de zona de picking (`FOR UPDATE SKIP LOCKED`, mejora sumada por el subagente `migration-reviewer`) · `fn_completar_tarea_reabastecimiento(tarea_id)` mueve el stock DE VERDAD ejecutando la misma operación que "Mover LPN" de `LpnAccionesModal` (reduce origen, crea destino) · `fn_completar_tarea_picking(tarea_id)` es solo bookkeeping (nunca toca `inventario_lineas`), bloqueada si la tarea precedente no está completada · `fn_generar_tareas_reabastecimiento_umbral(tenant_id)` sweep on-demand sin pg_cron (mismo patrón "Procesar ahora" de Aging Profiles) · helpers `fn_wms_elegir_ubicacion_picking`/`fn_wms_describir_cantidad` (traduce cantidad en unidades base a UdM, ej. "2 cajas"). **Decisión de arquitectura confirmada con GO: el picking es logística pura, nunca decide qué LPN consume una venta ni cuándo se rebaja stock** — el motor de ventas (`VentasPage.tsx`/`rebajeSort.ts`) no se tocó. Revisada por `migration-reviewer` antes de aplicar. Smoke test manual con datos reales en DEV encontró y corrigió 2 bugs (sintaxis PL/pgSQL, cast numeric→integer) + 1 bug del reabastecimiento por umbral (podía elegir la misma ubicación como origen y destino). Verde: tsc · build · 1177 unit · regresión e2e 13 specs · **e2e nuevo 106** (mutante, DB real). Ver [[wiki/features/wms]] → "Fase 3"/"Fase 4". **DEV ✅ · PROD ⬜.** |
| 284 | `284_estados_inventario_descuento.sql` | **🏷 Descuento automático por estado de inventario** (backlog Fede punto 3) · `estados_inventario += descuento_pct NUMERIC(5,2)` (`CHECK` `NULL` o `0 < x ≤ 100`). Un estado (ej. "Próximo a Vencer") configurado de antemano por un DUEÑO/ADMIN con un % propio hace que **cualquier venta** que consuma stock de un LPN en ese estado aplique el % automáticamente, **sin clave de supervisor**. Config: Config→Inventario→Estados → sub-tab "Permisos por estado" → columna **% desc.**. Aditiva. Ver [[wiki/features/ventas-pos]]. **DEV ✅ · PROD ⬜.** |
| 285 | `285_venta_descuento_estado.sql` | **🏷 Trazabilidad del descuento automático por estado** (backlog Fede punto 3, REGLA #0 — ver mig 284) · `venta_items += descuento_estado_pct NUMERIC(5,2), descuento_estado_monto NUMERIC(12,2)` + `ventas += descuento_estado jsonb` (`[{estado_nombre, pct, cantidad, monto}]`, mismo criterio que `ventas.promo_pago` de la mig 281 — todo descuento que reduce el total cobrado queda registrado en el documento de la venta, no solo implícito en el total). Es un monto **POR LÍNEA** (calculado sobre la previsualización de LPNs del carrito), nunca un descuento global prorrateado; se apila con el descuento general/combo/por método de pago. Lógica pura `src/lib/descuentoEstado.ts`. Aditiva. UAT §41 · e2e 101. **DEV ✅ · PROD ⬜.** |
| 286 | `286_precio_por_uom.sql` | **💲 Precio por Unidad de Medida en la estructura — modelo** (backlog Fede puntos 4/6/7, relevamiento GO 2026-07-21) · `producto_estructura_niveles += precio_venta NUMERIC(12,2), precio_costo NUMERIC(12,2)` (ambos opcionales, `CHECK ≥ 0`; `NULL` = precio EFECTIVO proporcional al nivel anclado por `unidades_base`, nunca encadenando por niveles intermedios) + `productos += nivel_precio_orden INTEGER` (**"ancla de precio"**: por ORDEN no por id — `fn_estructura_guardar_niveles` reinserta todos los niveles en cada save — a qué nivel de la estructura DEFAULT corresponden `precio_venta`/`precio_costo` de la hoja de producto; `NULL` = nivel base) + `venta_items += unidad_medida_id uuid REFERENCES unidades_medida, cantidad_uom NUMERIC(12,3)` + `combos += unidad_medida_id uuid REFERENCES unidades_medida`. Las 3 últimas columnas se migraron en la Fase 1 (v1.140.0) sin consumidor; **ya tienen código real desde la Fase 2 (v1.141.0, misma sesión)** — vender por UoM en el POS, ver [[wiki/features/ventas-pos]] → "Venta por Unidad de Medida". Aditiva. Ver también [[wiki/features/estructuras-udm]]. **DEV ✅ · PROD ⬜.** |
| 287 | `287_fn_estructura_niveles_precio.sql` | **💲 `fn_estructura_guardar_niveles` (mig 282) extendida para persistir precio por nivel** (backlog Fede puntos 4/6/7) · mismo contrato de entrada (jsonb, un objeto por nivel), suma dos claves opcionales `precio_venta`/`precio_costo` (`CHECK` server-side ≥ 0 por nivel); al final del guardado, si el "ancla de precio" (`productos.nivel_precio_orden`) de la estructura DEFAULT quedó apuntando a un orden que ya no existe (se achicó la estructura por debajo de esa posición), la RPC la invalida sola (`UPDATE productos SET nivel_precio_orden = NULL`) — nunca deja un ancla apuntando a la nada. Sin validación cruzada entre niveles (un nivel superior puede tener `precio_venta` menor a uno inferior, mismo criterio ya aceptado para las cantidades). Aditiva. Ver [[wiki/features/estructuras-udm]]. **DEV ✅ · PROD ⬜.** |
| 288 | `288_productos_notas.sql` | **🛑 FIX CRÍTICO — el importador de productos NUNCA funcionó** (backlog Fede puntos 4/6/7, cierra el pendiente en la misma sesión) · agrega `productos.notas TEXT`, columna que `ImportarProductosPage.tsx` y su plantilla Excel pedían desde hace tiempo pero que NINGUNA migración había creado nunca. El payload de INSERT/UPDATE de productos siempre mandaba `notas` → PostgREST rechazaba el request COMPLETO (`PGRST204: Could not find the 'notas' column`), pero el código solo desestructuraba `data` del insert/update sin revisar `error` → el importador reportaba "X creados" mientras la tabla de productos quedaba en CERO filas nuevas, confirmado con inserts directos por REST (con `notas`→400, sin `notas`→201) y por SQL directo contra DEV. Acompaña (mismo commit, sin migración propia): `ImportarProductosPage.tsx` gana columnas `estr_precio_ancla`/`estr_precio_venta_caja`/`estr_precio_costo_caja`/`estr_precio_venta_pallet`/`estr_precio_costo_pallet` (precio por nivel, cierra el único pendiente real que quedaba del backlog de Fede) + el importador ahora revisa el `error` real de cada insert/update (`erroresDetalle`, ya no infla `creados`/`actualizados` a ciegas); mismo código-olor (ignorar `error`) corregido por prevención en `ImportarMasterPage.tsx` (combos, reglas de aging, grupos de estados, categorías/proveedores/ubicaciones/estados/motivos) — sin falla activa confirmada ahí (columnas verificadas por SQL). Detectado por el e2e nuevo **105** con verificación POSITIVA en DB real. Aditiva (`ADD COLUMN IF NOT EXISTS`). Ver [[wiki/features/estructuras-udm]] → "Importador de productos con precio por nivel". **DEV ✅ · PROD ⬜.** |
| 282 | `282_estructura_niveles_dinamicos.sql` | **📦 Estructuras con niveles DINÁMICOS por UdM (Fase 1 footprint estilo Blue Yonder)** · tabla nueva `producto_estructura_niveles` (estructura_id CASCADE, unidad_medida_id RESTRICT, `orden` 1=base, `factor` INT ≥1 contra el nivel ANTERIOR, `unidades_base` BIGINT = producto acumulado CALCULADO SERVER-SIDE, peso/dims opcionales >0; UNIQUE por orden y por UdM dentro de la estructura; RLS tenant `pen_tenant`) + RPC **`fn_estructura_guardar_niveles(uuid, jsonb)`** (SECURITY INVOKER → aplica RLS; reemplazo transaccional de todos los niveles con validación server-side de factores/UdM y recálculo de `unidades_base` — REGLA #0: conversiones exactas, el cliente nunca manda la equivalencia) + **Pallet** sumado a las UdM predefinidas (`fn_seed_tenant_defaults` + backfill a todos los tenants) + backfill de las estructuras viejas (columnas fijas unidad/caja/pallet → filas de niveles; las columnas quedan DEPRECADAS, drop en mig futura post-PROD). Frontend: tab Estructura reescrito (ProductosPage), LpnAccionesModal, importador CSV vía RPC, lib pura `src/lib/estructuras.ts`. Ver [[wiki/features/estructuras-udm]]. **DEV ✅ · PROD ⬜.** |
| 283 | `283_backfill_estructura_niveles_conversiones.sql` | **📦 Fix del backfill de la 282** · el criterio "nivel activo = peso+alto NOT NULL" (heredado del frontend viejo) perdía la CONVERSIÓN de estructuras creadas por el importador CSV (traían `unidades_por_caja`/`cajas_por_pallet` sin dims) — quedaban solo con el nivel base. Reconstruye los niveles de esas estructuras con criterio ampliado (conversión O dims; dims ≤0 → NULL por los CHECKs nuevos). Verificado en DEV: 0 conversiones perdidas (66→119 niveles). Idempotente; no-op en PROD (0 estructuras). **DEV ✅ · PROD ⬜.** |
| 278 | `278_hard_delete_productos.sql` | **🗑️ Hard delete REAL de productos (individual + bulk)** · el botón "Eliminar" de `ProductoFormPage` en realidad hacía `UPDATE productos SET activo=false` (soft-delete, idéntico al toggle "Activo/Inactivo" del mismo form — redundante); no existía ningún hard delete real. `fn_producto_tiene_actividad(p_producto_id)` (SECURITY DEFINER, tenant-wide a propósito: varias tablas tienen RLS por sucursal y el chequeo no puede dejar pasar un delete con actividad en OTRA sucursal que el usuario no ve) chequea actividad en ~17 tablas (venta_items, movimientos_stock, orden_compra_items, recepcion_items, traslado_items, inventario_conteo_items/conteos, devolucion_items, devolucion_proveedor_items, envio_items, venta_item_despachos, inventario_lineas, inventario_series, combo_items, combos, kit_recetas, kitting_log, inventario_meli_map, inventario_tn_map) — "sin stock actual" no alcanza (vendido y agotado ≠ sin historial). `eliminar_productos_fisico(p_ids uuid[])` hace el DELETE real uno por uno, solo si no tiene actividad, devuelve (producto_id, eliminado, motivo) por fila para reportar parciales. **Fix post-aplicación:** columna `producto_id` ambigua en plpgsql (el `RETURNS TABLE` usa esa misma columna) — resuelto calificando `alertas.producto_id`/`productos.id` en los DELETE. `ProductoFormPage.tsx` (botón "Eliminar" ahora hard delete real vía RPC) + `ProductosPage.tsx` (botón "Eliminar" nuevo en la bulk action bar, junto a Activar/Desactivar). Ver [[wiki/features/productos]]. **DEV ✅ · PROD ✅ (PR #295, v1.136.0, 2026-07-19).** |
| 279 | `279_combos_vigencia.sql` | **📅 Vigencia por fecha en combos** (backlog Fede punto 2) · `combos += vigencia_desde date, vigencia_hasta date` (NULL = sin límite, comportamiento previo intacto; ambos inclusive). El filtro es CLIENT-SIDE en el POS (`comboVigente` en `ventasValidation.ts`, fecha LOCAL no UTC — una promo "hasta el 15" vale todo el 15 en AR) + badges vigente/programado/vencido en Config→Ventas. Aditiva. **DEV ✅ · PROD ✅ (PR #295, v1.136.0).** |
| 280 | `280_cliente_campos_requeridos.sql` | **👤 Campos requeridos del cliente en POS por checkbox** (backlog Fede punto 4) · `tenants += cliente_campos_requeridos jsonb` (`{"dni":bool,"telefono":bool,"email":bool}`, nombre siempre obligatorio) + **backfill** desde el enum legacy `cliente_datos_minimos` (que queda como espejo sincronizado al guardar — no se borra para no romper lectores viejos). Helper con fallback: `src/lib/clienteCampos.ts`. El alta rápida del POS ganó input de EMAIL. Aditiva. **DEV ✅ · PROD ✅ (PR #295, v1.136.0, backfill verificado 0 pendientes).** |
| 281 | `281_ventas_promo_pago.sql` | **🏷 Trazabilidad del descuento por método de pago** (backlog Fede punto 1, REGLA #0) · `ventas += promo_pago jsonb` (`[{metodo, pct, monto}]`; el total ya los tiene restados). La CONFIG del descuento vive en `metodos_pago.config.descuento` (% + tope + días 0-6 + desde/hasta) — sin migración propia porque el jsonb `config` existía reservado sin uso. Lógica pura `src/lib/promosPago.ts`; el POS pliega el descuento al prorrateo fiscal G0.6 → `venta_items` suma EXACTO el total (verificado en DB por e2e 98). Aditiva. **DEV ✅ · PROD ✅ (PR #295, v1.136.0).** |
| 277 | `277_venta_item_despachos_atributos_variante.sql` | **🧵 `venta_item_despachos` gana columnas de atributos de variante** (talle/color/encaje/formato/sabor_aroma, TEXT nullable) · sin esto, el desglose de despacho por LPN de una venta (ISS-075) no snapshoteaba qué talle/color se vendió — solo era visible en el carrito antes de confirmar, no en el historial post-venta. `VentasPage.tsx`: los 2 flujos de despacho (checkout directo + reserva→despachada) seleccionan las 5 columnas de `inventario_lineas` al armar el plan de rebaje y las snapshotean en `venta_item_despachos`; el panel de detalle de venta las muestra vía `atributosDeLinea()`. Sin backfill (no se puede reconstruir el talle de despachos históricos). Verificado end-to-end por el e2e spec 96. Ver [[wiki/features/atributos-variante]] "Ronda 4". **DEV ✅ · PROD ✅ (2026-07-19, PR #294, v1.135.0).** |
| 276 | `276_traslado_items_ubicacion_sugerida.sql` | **🚚 `traslado_items.ubicacion_sugerida_id`** (nullable, FK a `ubicaciones` `ON DELETE SET NULL`) · cuando un traslado nace desde el movimiento parcial de un LPN (`LpnAccionesModal` → tab "Mover" hacia otra sucursal, ver más abajo/[[wiki/features/multi-sucursal]]), el usuario ya elige una ubicación destino ahí mismo — sin esta columna esa elección se perdía y "Confirmar recepción" en `TrasladosPanel` siempre arrancaba en "Sin ubicación". Solo la usa `TrasladosPanel.abrirRecepcion` como DEFAULT sugerido (el destino puede cambiarla); traslados armados desde el tab Traslados quedan con esta columna en NULL, sin cambio de comportamiento. **DEV ✅ · PROD ✅ (2026-07-18, PR #293).** |
| 275 | `275_traslado_items_atributos_variante.sql` | **🚚 `traslado_items` gana columnas de atributos de variante** (talle/color/encaje/formato/sabor_aroma) · sin esto, trasladar stock de un producto con el atributo activo entre sucursales lo perdía en el camino: no había dónde snapshotearlo al despachar, y la línea nueva en destino (recepción) o en origen (cancelación/reingreso) quedaba en null. `TrasladosPanel.tsx` actualizado en los 3 puntos: despacho (snapshot desde la línea origen), recepción (propaga a la línea nueva en destino) y cancelación (propaga a la línea nueva en origen) — se hereda, no se re-pregunta (es la misma mercadería física). Ver [[wiki/features/atributos-variante]] "Ronda 3". **DEV ✅ · PROD ✅ (2026-07-18, PR #293).** |
| 274 | `274_guard_grupo_variantes_vs_atributos.sql` | **🛑 Guard server-side: Grupo de variantes vs. Atributos de variante son incompatibles** (REGLA #0) · CHECK constraint `chk_productos_grupo_sin_atributos_variante` en `productos`: `NOT (grupo_id IS NOT NULL AND (tiene_talle OR tiene_color OR tiene_encaje OR tiene_formato OR tiene_sabor_aroma))`. Motivo: GO encontró en la práctica un producto ("Variante1", Almacén Jorgito DEV) vinculado a AMBOS sistemas a la vez (dos modelos de stock incompatibles), con catálogos de talle duplicados sin conexión entre sí. La UI (`ProductoFormPage`) ya bloqueaba la combinación; esta mig cierra el mismo hueco por API/SQL directo. **Verificado**: intento de violación por SQL directo → rechazado con el error del constraint. Dato de prueba corregido a mano en DEV antes de aplicar (1 fila violaba la condición). Verificado también en PROD antes de aplicar: 0 filas violan la condición. Ver [[wiki/features/atributos-variante]] "Ronda 2". **DEV ✅ · PROD ✅ (2026-07-18, PR #293).** |
| 273 | `273_atributos_variante_catalogo.sql` | **🧵 Catálogo configurable de "Atributos de variante"** (talle/color/encaje/formato/sabor_aroma) · tabla nueva `atributos_variante_valores` (id/tenant_id/`atributo` CHECK IN talle,color,encaje,formato,sabor_aroma/valor/orden/activo) — UNA tabla genérica para los 5 atributos, no 5 tablas. RLS tenant-scoped estándar (mismo patrón que `emisores_fiscales`) + REVOKE PUBLIC/anon + GRANT authenticated/service_role. Índice único case-insensitive `(tenant_id, atributo, lower(btrim(valor)))` para que "M"/"m" no fragmenten el catálogo. **Backfill**: sembró con los valores DISTINCT que ya existían como texto libre en `inventario_lineas` (sin tocar esa tabla — REGLA #0, nunca se reescribe inventario histórico); dio 0 filas en DEV (nadie usaba el feature todavía). Cierra el gap reportado por GO ("las opciones de variantes no hacen nada"): antes se capturaba talle/color como texto libre al recibir stock pero no se leía en ningún otro lado; ahora hay catálogo configurable (Config→Inventario→Atributos) + selección real en el picker de rebaje de `VentasPage` (`calcularLpnFuentes` extendido). Ver [[wiki/features/atributos-variante]]. **DEV ✅ · PROD ✅ (2026-07-18, PR #293).** |
| 272 | `272_revoke_execute_fn_triggers_identidad.sql` | **REVOKE EXECUTE de las fn de trigger de la 271** (`fn_espejo_emisor_default_a_tenant`, `fn_guard_emisor_default`) — hallazgo del Security Advisor: SECURITY DEFINER ejecutables por `anon`/`authenticated` vía `/rest/v1/rpc/`. Un trigger no necesita EXECUTE por REST (se chequea al CREAR el trigger, no en runtime). Verificado: espejo OK post-revoke; RPC de anon → 404. **DEV ✅ · PROD ✅ (2026-07-17).** |
| 271 | `271_identidad_fiscal_fuente_unica.sql` | **🏛️ Identidad fiscal = FUENTE ÚNICA (cutover anunciado por la 267) — REGLA #0** · DROP del trigger transicional tenants→emisores (`fn_sync_emisor_fiscal_default`) + **espejo INVERTIDO** `trg_espejo_emisor_default_a_tenant` (emisores(default)→tenants; `tenants.*` fiscal queda de SOLO LECTURA legacy hasta el drop de Fase 4; `IS DISTINCT FROM` evita updates no-op) + **guards** `trg_guard_emisor_default` (el default no se borra —salvo cascade del tenant— ni se desactiva ni pierde la marca; P0001) + backfill idempotente (0 pendientes en DEV y PROD, verificado antes por query). Verificada POR EFECTO en DEV: espejo en vivo, guards rechazando, drift 0. **🛑 BREAKING para el frontend viejo: va a PROD PEGADA al merge de v1.133.0** (el ConfigPage de v1.132 escribe en tenants y post-271 no se espeja → la EF leería identidad stale). **DEV ✅ (2026-07-17) · PROD ✅ (2026-07-17, pegada al merge del PR #292).** |
| 270 | `270_emisores_csr_key_path.sql` | **🏢 Multi-CUIT — wizard de certificado self-service** · `emisores_fiscales += csr_key_path text` (puntero en el bucket `certificados-afip` a la `.key` generada por la EF `generar-csr`, pendiente de aparear con el `.crt` que el cliente baja de ARCA; sobrevive recargas/sesiones porque puede pasar días entre generar el CSR y volver con el `.crt`). La `.key` nunca se guarda en la DB — solo en el bucket (service_role). Se limpia a NULL al finalizar el certificado. Aditiva. **DEV ✅ · PROD ✅ (2026-07-13, deploy multi-CUIT).** |
| 269 | `269_multicuit_addon_cuits.sql` | **🏢 Multi-CUIT (F5) Fase 6 — monetización por add-on "CUIT adicional"** · `tenant_addons` CHECK += `'cuits'` · `fn_plan_base_limite` v3 (base `cuits`=1 en todos los planes, Enterprise -1) · trigger `fn_enforce_limite_cuits` en `emisores_fiscales` (SECURITY DEFINER, ERRCODE check_violation): el emisor **default NO consume cupo** (es el CUIT del negocio); bloquea ACTIVAR el emisor adicional N+1 sin add-on. Espejo `PLAN_BASE_LIMITS`/`ADDON_PACKS` (brand.ts) + EF `mp-addon-batch` (conteo especial que excluye el default). **⚠ Precio del pack PROVISORIO** ($20k/$35k/$45k por 1/2/3) — GO confirma. **DEV ✅ · PROD ✅ (2026-07-13).** |
| 268 | `268_multicuit_certs_pv_por_emisor.sql` | **🏢 Multi-CUIT (F5) Fases 2/3 — certificados y PV POR EMISOR** · dropea `UNIQUE(tenant_id)` de `tenant_certificates` → `UNIQUE(emisor_id)` total (nulls distintos; el upsert de `afip.ts` pasa a `onConflict:'emisor_id'`) + parcial legacy `UNIQUE(tenant_id) WHERE emisor_id IS NULL` · dropea `UNIQUE(tenant_id, numero)` de `puntos_venta_afip` → `UNIQUE(tenant_id, COALESCE(emisor_id, uuid-cero), numero)` (en AFIP los PV son POR CUIT: el PV 1 del CUIT A ≠ PV 1 del CUIT B). Acompaña EF `emitir-factura` v23 (resolución de emisor + guards por emisor). **DEV ✅ (2026-07-11) · PROD ✅ (2026-07-13).** |
| 267 | `267_emisores_fiscales.sql` | **🏢 Multi-CUIT por tenant (F5) — Fase 1: modelo de datos NEUTRO** · Tabla `emisores_fiscales` (identidad fiscal: cuit/razón social/condición IVA/umbral/afip_produccion/afip_provider/token + datos de PDF banco/cbu/leyenda/logo; UNIQUE parcial `es_default` por tenant + UNIQUE (tenant,cuit); RLS tenant-scoped, REVOKE anon) + FKs `ON DELETE SET NULL` en hijos (`tenant_certificates.emisor_id`, `puntos_venta_afip.emisor_id`, `sucursales.emisor_fiscal_id`, `ventas.emisor_id`, `gastos.emisor_id`) + índices + **backfill**: 1 emisor default por tenant con CUIT espejando `tenants.*`, hijos linkeados (ventas solo con CAE, gastos solo deducibles) + **trigger transicional** `fn_sync_emisor_fiscal_default` (SECURITY DEFINER; tenants→emisor default hasta el cutover de Fase 3). CERO cambio de comportamiento (nada la lee todavía). Diseño completo: `wiki/features/multi-cuit.md`. **DEV ✅ (2026-07-10, backfill y trigger verificados) · PROD ✅ (2026-07-13).** |
| 266 | `266_devoluciones_nc_fecha.sql` | **🧾 Fecha de EMISIÓN de la NC electrónica (REGLA #0 — Libro IVA)** · `devoluciones += nc_fecha TIMESTAMPTZ` — `created_at` es la fecha de la DEVOLUCIÓN, pero la NC puede emitirse días después: el Libro IVA imputa la NC al período de su emisión (CbteFch). La setea la EF `emitir-factura` al persistir el CAE de la NC. Backfill idempotente: NC preexistentes toman `created_at`. Parte del fix v1.125.0 "las NC no restaban débito fiscal en ningún reporte" (Libro IVA/KPIs/liquidación/Posición IVA/dashboard — `src/lib/libroIva.ts`). Aditiva. **DEV ✅ (2026-07-10, validada con NC real e2e 42) · PROD ✅ (2026-07-10).** |
| 250 | `250_afip_dual_provider.sql` | **🧾 Dual-provider AFIP (fase 1) — selector por-tenant + trazabilidad** · `tenants += afip_provider TEXT NOT NULL DEFAULT 'afipsdk' CHECK IN ('afipsdk','propio')` (rollback = volver a 'afipsdk', mismo patrón que `afip_produccion` mig 210) + `ventas.afip_provider_usado` + `devoluciones.afip_provider_usado` (con qué provider se emitió el CAE). Aditiva/idempotente y **SIN cambio de comportamiento**: los 10 tenants quedan en 'afipsdk' (circuito actual). Habilita el refactor adapter de `emitir-factura` (interfaz `AfipProvider` → `AfipSdkProvider` actual + `WsfePropioProvider` stub). **DEV ✅ · PROD ✅ (v1.101.0). EF `emitir-factura` NO deployada (sigue la actual).** |
| 249 | `249_tenant_consentimiento_legal.sql` | **📄 Consentimiento legal en el alta (T&C/Privacidad + marketing opt-in)** · `tenants += terminos_aceptados_at TIMESTAMPTZ, terminos_version TEXT, marketing_consent BOOLEAN NOT NULL DEFAULT FALSE`. Se setean en `provisionNegocio` (`OnboardingPage`) al crear el negocio: `terminos_aceptados_at`/`terminos_version` (= `BRAND.LEGAL_VERSION`) del checkbox T&C **requerido**; `marketing_consent` del opt-in **separado y opcional** (Ley 25.326). Aditiva/idempotente (`ADD COLUMN IF NOT EXISTS`); NO reescribe tenants existentes. **DEV ✅ · PROD ✅ (v1.101.0 — GO decidió publicar; ⚠ texto legal AÚN pendiente de revisión de abogado + razón social/CUIT).** |
| 230 | `230_reconciliar_drift_checks_dev_prod.sql` | **🔴 Reconciliar DRIFT de CHECK constraints DEV↔PROD (paridad)** · el escaneo post-mig-229 halló 5 CHECKs en PROD ausentes en DEV. Landmines: `ventas_estado_check` sin `'devuelta'` (rompía la devolución total en PROD) y `notificaciones_tipo_check` (solo info/warning/danger/success, rechazaba claves de evento `diferencia_apertura_caja`/`diferencia_cierre_caja` → abrir/cerrar caja con diferencia rompía). Fija: ventas con set completo (pendiente/reservada/despachada/facturada/cancelada/devuelta), notificaciones SIN check (es clave de evento), caja_sesiones/motivos agregados a DEV, inventario_lineas_cantidad_check eliminado (redundante con chk_cantidad_no_negativa). **Resultado: DEV == PROD, 97 CHECKs, hash `565c8f0…` (PAR-01 cerrado).** Idempotente. **DEV + PROD ✅ (v1.80.1)** |
| 232 | `232_fix_seed_sucursal_caja_unidades.sql` | **🔴 FIX regresión del seed de alta** · la mig 225 (Efectivo por default) reescribió `fn_seed_tenant_defaults` con CREATE OR REPLACE y **perdió** la creación de **Sucursal 1 + Caja Principal + 6 unidades de medida** que tenían las migs 114/148. Desde el 2026-06-18 TODO tenant nuevo nacía **sin sucursal, sin caja operativa y sin unidades** → no podía operar sin configurar a mano. Detectado validando un alta desde cero (UAT primer uso); afectaba a un tenant REAL en PROD ("El muller", creado el 2026-06-20). FIX: restaura el set completo en la función + **backfill** idempotente (Sucursal 1 a tenants sin sucursal · Caja Principal a tenants sin caja operativa · 6 unidades a tenants sin ellas). Verificado: tenant nuevo nace completo; PROD post-fix 0 tenants sin sucursal/caja/unidades. **DEV + PROD ✅** |
| 231 | `231_reconciliar_drift_columnas_dev_prod.sql` | **🔴 Reconciliar DRIFT de COLUMNAS/objetos DEV↔PROD (paridad PAR-03/04)** · la auditoría halló 3 columnas que existían en DEV (con datos, usadas por la app v1.80.1) pero **NO en PROD** (DDL fuera de banda): `ventas.costo_envio` 🔴 fiscal (venta con envío + PDF factura rompían en PROD), `clientes.notas` 🔴 (alta/edición de clientes rompía — el payload la manda siempre), `movimientos_stock.linea_id` 🟠 (FK inventario_lineas, trazabilidad). No se notó porque nadie ejerció esos flujos en PROD (app pre-primer-cliente). Además: `autorizaciones_inventario.linea_id`→nullable (DEV había quedado NOT NULL; alinea con mig 103) y se agrega a DEV el event trigger `ensure_rls`/`rls_auto_enable` (auto-RLS en tablas nuevas, paridad de seguridad). Aditiva, idempotente (ADD COLUMN IF NOT EXISTS / DROP NOT NULL / guardas). **Resultado: DEV == PROD, 1817 cols, hash `d482718f…` (PAR-03 cerrado).** **DEV + PROD ✅ (GO aprobó el apply a PROD)** |
| 229 | `229_fix_caja_movimientos_tipo_check_drift.sql` | **🔴 Fix drift `caja_movimientos_tipo_check`** · BUG en PROD: un alta nueva no podía ingresar a Caja Fuerte (`violates check constraint caja_movimientos_tipo_check`). PROD tenía el CHECK viejo `tipo IN ('ingreso','egreso')`; la app usa `ingreso_traspaso`/`egreso_traspaso`/`ingreso_informativo`/`egreso_informativo`/`ingreso_reserva`/`egreso_devolucion_sena`. DEV había quedado SIN constraint (drift) → ahí no fallaba. En PROD rompía Caja Fuerte, señas, ventas no-efectivo y devoluciones de seña. Fix: CHECK por **prefijo** `^(ingreso|egreso)(_[a-z]+)*$` (consistente con el saldo `LIKE 'ingreso%'/'egreso%'`, a prueba de nuevos sufijos), DEV+PROD. **DEV + PROD ✅ (v1.80.1)** |
| 228 | `228_ajuste_autorizacion_por_rol.sql` | **🔐 Autorización de ajustes de inventario POR ROL (configurable)** · columna `tenants.ajuste_autorizacion_roles` (jsonb, map rol→modo `directo`/`umbral`/`siempre`). Default en código (NULL/rol ausente): **DUEÑO=directo, resto=siempre**. `directo`=ajusta sin aprobación; `siempre`=toda diferencia a aprobación; `umbral`=usa el gate por umbral de conteos. Aplica a diferencias de Conteo, ajuste/eliminación de LPN y edición masiva. Lógica pura `src/lib/ajusteAutorizacion.ts` (+9 tests); UI en Config → Inventario → Reglas. Aditiva. **DEV + PROD ✅ (v1.80.0)** |
| 227 | `227_gastos_tipo_comprobante_iva_guard.sql` | **🧾 Gastos: automatización fiscal por condición del tenant** · columna `tipo_comprobante` en `gastos` y `gastos_fijos` (nullable; backfill `'Factura A'` donde `iva_deducible`). Trigger `fn_gastos_iva_guard` (BEFORE INSERT/UPDATE en `gastos`, SECURITY DEFINER): sanea `iva_monto`/`alicuota_iva`/`tipo_iva`/`iva_deducible` salvo **RI + Factura A**, y `deduce_ganancias` salvo RI (default condición = Monotributista). Es el guard server-side (no hay EF de gastos). Verificado: RI+A permite IVA, RI+B lo sanea. **DEV + PROD ✅ (v1.79.0)** |
| 226 | `226_boveda_cuentas_atribuir_efectivo.sql` | **💰 `vw_boveda_cuentas`: atribuir el efectivo sin cuenta a la cuenta Efectivo** · el "Capital del negocio por cuenta"/"Capital total" no contaba el efectivo de ventas/gastos (esos `caja_movimientos` dejan `cuenta_origen_id` NULL). Fix read-time: los movimientos NULL **no informativos** (efectivo físico) se atribuyen a la cuenta Efectivo del tenant vía `COALESCE`; los informativos (tarjeta/transfer/MP) sin cuenta quedan afuera. Preserva `security_invoker=true`. Verificado: Almacén Jorgito 12.873.811→12.889.570 (sin doble conteo), Kiosco Buildi 10.000→55.300. **Limitación:** aperturas de caja (`monto_apertura`) no son movimientos → no se cuentan (gap aparte). **DEV + PROD ✅ (v1.78.2)** |
| 225 | `225_seed_efectivo_default_tenant.sql` | **💵 Efectivo por default en el alta de tenant (pedido GO)** · extiende el seed de onboarding `fn_seed_tenant_defaults` (SECURITY DEFINER): cada tenant nuevo nace con la **Cuenta de Origen "Efectivo"** (tipo `efectivo`, en la **moneda del tenant**) + los **5 métodos de pago default** con **Efectivo vinculado** a esa cuenta (antes los métodos se creaban lazy desde Config→Ventas, sin cuenta). Backfill: crea la cuenta Efectivo en todos los tenants existentes que no la tenían + vincula el método Efectivo. Verificado con tenant de prueba (moneda USD → cuenta USD, método LINKED_OK). **DEV + PROD ✅ (v1.78.2)** |
| 223 | `223_panel_soporte_tickets.sql` | **🛟 Tickets del panel interno (Fase 1/2)** · `support_tickets` (tenant_id, asunto, estado, prioridad, canal, asignado_a, creado_por) + `support_messages` (hilo: autor_tipo agente/cliente/sistema, cuerpo). RLS ENABLE sin policies para authenticated → solo la EF `admin-api` (service_role). EF v3 agrega `support.tickets.list/get/create/reply/update`, `metrics.overview` (real) y `customers.get` enriquecido (snapshot read-only: usuarios/sucursales/ventas/última venta + últimas 5 ventas). **DEV + PROD ✅** |
| 222 | `222_panel_soporte_roles.sql` | **🛟 Roles del panel interno (acceso por área)** · amplía `support_agents.rol` CHECK a `admin`/`support`/`marketing`/`billing` (migra agent→support, supervisor→admin; default `support`). Matriz rol→módulos en `config/permissions.ts` (front) **y enforzada en la EF `admin-api`** (cada acción pertenece a un módulo; el rol debe tenerlo). admin = todo + gestión de usuarios. **DEV + PROD ✅** |
| 221 | `221_panel_soporte_agentes_auditoria.sql` | **🛟 Cimientos del PANEL INTERNO DE SOPORTE (admin.genesis360.pro)** · tabla `support_agents` (staff interno, NO usuarios de tenant; RLS self-read, escrituras solo service_role) + `admin_audit_log` (ledger append-only de accesos del staff, RLS default-deny → solo la EF `admin-api` con service_role lo escribe) + helper `is_staff()` (STABLE SECURITY DEFINER, autoridad de runtime para revocar). Auth Opción C: mismo `auth.users` + claim `app_metadata.staff` no auto-asignable. Acceso cross-tenant SOLO vía EF `admin-api`. **DEV + PROD ✅** |
| 220 | `220_normalizar_drift_policies.sql` | **🧹 Normalizar drift cosmético de policies DEV↔PROD (post-219)** · barrido completo de `pg_policies` DEV vs PROD → 4 tablas con diferencias **cosméticas** (cero cambio de comportamiento): `clientes` (PROD tenía `tenant_isolation` duplicada), `gasto_cuotas` (policy nunca migrada: nombre `tenant_isolation` en DEV vs `gasto_cuotas_tenant` en PROD), `productos_select` y `tenants_select` (`is_admin()` vs su expresión inline equivalente — `is_admin()` verificada idéntica en ambos). Normaliza al canónico del repo (`is_admin()` + `<tabla>_tenant` + clientes una sola policy). Idempotente. **Tras aplicar: DEV == PROD == 152 policies, mismo hash global.** **DEV + PROD ✅** |
| 209 | `209_storage_bucket_listing.sql` | **Cerrar listado cross-tenant de buckets públicos (v1.59.0, auditoría pre-cliente)** · reemplaza las policies SELECT amplias `avatares_authenticated_read`/`productos_authenticated_read` (qual solo `bucket_id` → cualquier authenticated listaba todos los tenants) por SELECT **scopeado a la propia carpeta** (avatares=`{user_id}`, productos=`{tenant_id}`). La app no lista estos buckets (solo upload+getPublicUrl). Advisor `public_bucket_allows_listing` 2→0. Idempotente (DROP POLICY IF EXISTS + CREATE). **DEV + PROD ✅ (PR #191)** |
| 208 | `208_security_hardening_pre_cliente.sql` | **Endurecimiento de seguridad — auditoría pre-cliente (v1.59.0)** · idempotente, NO destructiva. (1) policy SELECT pública en `public.planes` (cierra `rls_enabled_no_policy`); (2) `SET search_path = public` en 25 funciones (loop por `oid::regprocedure`); (3) `REVOKE EXECUTE FROM PUBLIC, anon` + re-`GRANT TO authenticated, service_role` en SECURITY DEFINER no públicas (períodos, sweeps CC, `cliente_cc_estado`, `verificar/requiere_clave_maestra`), y `REVOKE FROM PUBLIC, anon, authenticated` + `GRANT service_role` en seeds/triggers. **Gotcha:** el EXECUTE de anon venía de PUBLIC, no de un grant a anon → revocar de anon es no-op; hay que revocar de PUBLIC. Conserva anon en los endpoints públicos token-gated. Advisors: search_path 25→0, rls_no_policy 1→0, anon SECURITY DEFINER 29→15. **DEV + PROD ✅ (PR #191)** |

---

## Reglas de trabajo con migraciones

```
1. Crear supabase/migrations/NNN_descripcion.sql (idempotente)
2. Aplicar en DEV (project gcmhzdedrkmmzfzfveig)
3. Actualizar supabase/schema_full.sql
4. Commit + push dev
5. Al deployar → aplicar en PROD (project jjffnbrdjchquexdfgwq)
```

### SIEMPRE al crear una tabla nueva

> [!WARNING] **A partir del 30 de octubre de 2026** Supabase deja de auto-exponer tablas nuevas del schema `public`. Agregar el GRANT al final de toda migration con `CREATE TABLE`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nombre_tabla TO authenticated;
-- GRANT SELECT ON public.nombre_tabla TO anon;  -- solo si es acceso público sin auth
```

Ver patrón completo y explicación en [[wiki/development/convenciones-codigo#grant-obligatorio-en-tablas-nuevas]].

### NUNCA
- ❌ Modificar tablas directamente en PROD sin pasar por DEV
- ❌ ALTER TABLE fuera de un archivo de migration
- ❌ Reescribir una migration ya aplicada en PROD (crear una nueva)

---

## Links relacionados

- [[wiki/database/schema-overview]]
- [[wiki/database/rls-policies]]
- [[wiki/development/deploy]]
- [[wiki/development/supabase-dev-vs-prod]]
