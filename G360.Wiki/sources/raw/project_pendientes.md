---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

## ▶ RETOMAR ACÁ (post-/clear) — próxima sesión

> ### 🟢 ARRANCÁ ACÁ (2026-06-24 · barrido UAT Compras+RRHH EN PROD · handoff para /clear)
> **Estado:** **PROD = DEV = v1.87.0 (migs 001-242)** ✅ deployado (PR #242, release v1.87.0; migs 241+242 aplicadas y verificadas en PROD). build (tsc+vite) verde. v1.87.0 = barrido UAT Compras/OC/Envíos + RRHH/Config/Suscripción **+ 1 fix REGLA #0 (mig 241) + 2 follow-ups (mig 242 + devolución efectivo exige caja)** + 5 specs e2e (77-81).
>
> **⚠️ Nota de sesión:** durante el cierre el MCP de Supabase se desconectó → la validación por `execute_sql`/impersonación quedó no disponible. Para los próximos módulos retomar el patrón DB-impersonación cuando el MCP vuelva.
>
> **🛑 BUG REGLA #0 ENCONTRADO + ARREGLADO (mig 241) — pago de nómina por medio NO-efectivo:** `pagar_nomina_empleado` asentaba SIEMPRE `caja_movimientos` **`egreso`** (afecta el arqueo de EFECTIVO) sin importar el medio. La UI ofrece efectivo/transferencia/MP → pagar por transferencia o MP **descuadraba el efectivo** de la caja (restaba plata que nunca salió del cajón). **Fix:** efectivo→`egreso`, no-efectivo→`egreso_informativo`. **DB-validado (los 3 medios) + spec 81.** ⇒ **deploy a PROD recomendado.**
>
> **▶ DÓNDE QUEDAMOS — UAT EXHAUSTIVO, módulos CERRADOS al 100% REGLA #0** (todo DB-verificado, 2 tenants DEV):
> - **Ventas/POS Tanda A+B** ✅ (45-63 + FAC-27; salvo §29 AFIP, bloqueado por GO).
> - **Caja/Bóveda** ✅ (64-67). **Gastos** ✅ (68 + guards IVA/período-cerrado).
> - **Clientes/CC** ✅ (28/39/40/46/49 + 69/72/73 + incobrable SIN clave).
> - **Productos** ✅ (43 + 70 Exento). **Inventario/Conteos** ✅ (29/30/35/36/47/51/52 + 71/74/75/76 + unit).
> - **🆕 Compras/OC/Envíos** ✅ **CERRADO** (`cobertura/04`): pago OC contable+doble firma (RPC mig237, matriz DB), pago courier+doble firma (RPC mig238, DB + nota fiscal IVA), over/under-receipt (52/74 + **79** motivo + rol code-verified), devolución efectivo/reposición (**77/78** + hallazgo no-caja), rechazo cheque brazo OC (**80** + DB + unit).
> - **🆕 RRHH/Config/Suscripción** ✅ **CERRADO** (`cobertura/05`): pago nómina caja (spec50+**mig241 fix**+**81**), tardanza/cargas/SAC/liq-final (✅unit + gastos pending, sin caja), doble validación = autorización UI, plan/Config = gating/autorización client-side.
>
> **✅ 2 follow-ups de GO RESUELTOS (en v1.87.0, migs 241+242):** (a) **devolución a proveedor en efectivo** ahora **exige caja operativa abierta** (excluye bóveda) ANTES de rebajar stock; sin caja BLOQUEA con toast + **link a Caja** ("Abrí una caja"). (b) **doble validación de nómina** ahora **server-side** (mig 242: `pagar_nomina_empleado` enforcea rol con el flag ON; CAJERO bloqueado). Ambos DB-validados.
>
> **▶ PRÓXIMA SESIÓN (lo que queda del barrido):**
> 1. **DEPLOY v1.87.0 a PROD** (migs 241+242 + specs + 2 follow-ups) — recomendado por los fixes REGLA #0.
> 2. **Residual menor no-crítico** (no REGLA #0 estricto): Inventario — conteo gate flag e2e, armar-kit (2 pasos), delta con venta intercalada, 2 recepciones parciales; Compras/Envíos — `oc_numeracion` por valor, `recepcion_remito_obligatorio`, costo→`precio_costo`, alerta anticipo-OC, cobro al cliente por política, `envio_identidad/notif/peso/rangos` (UX); Ventas — `cliente_consumidor_final=false`, `reglas_canal.requiere_cliente/lista_precio`, sweep reservas.
>
> **🧰 Harness e2e (2 tenants DEV, GO autoriza hacer/deshacer libremente):**
> - **Almacén Jorgito** `3769b1db-10f4-46a6-bc7f-eb669307730d` — clave maestra **12345678**, facturación ON, Sucursal Norte `b56742a9-c3a2-488e-b344-086227ef396e`. Usuarios OWNER (`e2e@genesis360.test`, project `chromium`) + cajero/supervisor/rrhh/deposito/contador. **Cierres contables reales hasta 2026-04 (no tocar en fixtures).**
> - **Familia Otranto De Porto** `4cf85bbb-22b3-4760-91ee-15a24d9e4713` — **SIN clave maestra**, facturación OFF, stock sin ubicar. DUEÑO `3d3mentes@gmail.com` (`d23aedbb-abb7-483c-8bed-0d78d27018d8`), SUPERVISOR harness `e2e.fotranto.sup@local.com`/`Test1234!` (project `chromium-fotranto-sup`). Ideal para escenarios sin-clave.
> - **Correr un spec:** `npx dotenv -e tests/e2e/.env.test.local -- playwright test NN_spec --project=chromium`. Muchos specs mutantes son **env-gated** (E2E_*=1) para no correr en el full-suite.
>
> **🧠 Convenciones del barrido (REGLA #0):**
> - **Evidencia UAT:** las transacciones de prueba (ventas/recepciones/write-offs/desarmados) se DEJAN como evidencia; solo se quitan **estados bloqueantes activos** (conteo wall-to-wall) que deshabilitan el tenant.
> - **Limpieza de ventas (si hace falta):** restaurar SOLO `inventario_lineas.cantidad` — el trigger recalcula `stock_actual` (tocarlo a mano lo DUPLICA).
> - **Método:** e2e mutante (aserción POSITIVA + verificar la mutación en DB con `execute_sql`); nunca solo `.not.toBeVisible()`. Guards server-side se validan por impersonación SQL (RPC) cuando el e2e UI no alcanza.
> - **Gotcha POS:** con 2+ cajas abiertas el despacho exige elegir caja en "Registrar en caja" (incluso 100% CC).
>
> **🔓 Único bloqueo de terceros:** **AFIP §29** — cert/token de **PRODUCCIÓN** en ARCA + (opcional) CUIT RI de homologación (trámite de GO). Sin eso, RI/Exento quedan validados solo por lógica/EF.
>
> ---
> **(Detalle histórico de las tandas abajo — referencia.)**
>
> **▶ DETALLE — UAT EXHAUSTIVO — Ventas/POS Tandas A+B CERRADAS · Caja/Bóveda · Gastos · Clientes/CC · Productos · Inventario.**
> - **✅ Caja/Bóveda — MÓDULO CERRADO (specs 64-67, REGLA #0 contable, DB-verificado, fixtures reversibles):** **64** cierre con diferencia (sobrante $100 → ajuste `ingreso` en DB) · **65** cierre **ajeno** con clave maestra (mala bloquea/correcta cierra, server-side) · **66** extracción de Bóveda (guard saldo insuficiente → no-negativo) · **67** doble validación B7 (sin/invalid 2º usuario bloquea). `diferencia_caja_umbral` = cubierto por unit. G1/G2/G3 ya cerrados antes por mig 234 + specs 40/41/45/46/48/49.
> - **✅ Módulo GASTOS CERRADO (REGLA #0 fiscal/contable):** comprobante obligatorio (spec **68**), **guard fiscal IVA crédito** (`fn_gastos_iva_guard` mig 227, DB-validated Mono/RI×FacturaA/B), **período contable cerrado** (`trg_gastos_periodo_cerrado` mig 135, DB-validated P0001). Gasto efectivo→caja=spec 27; umbral/pago-OC=unit+mig 237. Residual menor: eliminar→reversión (simétrico a 27), gasto cuotas.
> - **▶ Siguiente: Clientes/CC residual** (`cobertura/03` §Clientes): revertir condonación, incobrable SIN clave, vencimiento CC (`cc_dias_vencimiento`), crédito a favor positivo. Ya cerrados: morosidad/límite (46/49), condonar (39), incobrable CON clave (40).
> - **⚠️ Nota op:** Jorgito tiene cierres contables reales hasta **2026-04** (abril). No tocar esos cierres en fixtures.
> - **✅ Ventas/POS — Tanda A REGLA #0 CERRADA** (salvo §29 AFIP, bloqueado por GO): specs 45-57 + FAC-27 (ver entrada log 2026-06-22).
> - **✅ Ventas/POS — Tanda B CERRADA (specs 58-63, 2026-06-23, todos verdes + DB-verificados + DEV limpio):** **58** reserva seña mínima % (seña $1<50% → bloquea) · **59** reserva penalidad % (20% sobre seña $1000 → `cliente_creditos=$800`, DB-verificado) · **60** `cliente_obligatorio='siempre'` (exige cliente en venta directa CF) · **61** `reglas_canal.descuento_max_pct` (tope de canal aplica al DUEÑO → gate de clave) · **62** `cuotas_bancos` (Galicia 3x+0.5% → $10.050 total) **+ fix G0.5** · **63** presupuesto vencido (banner + CTA disabled). Inventario maestro reconciliado = `tests/specs/cobertura/01_ventas_productos_facturacion.md`.
> - **Residual OPCIONAL de Ventas (no REGLA #0 estricto):** `cliente_consumidor_final=false` (mismo efecto que 60 vía `!permiteCF`); `reglas_canal.requiere_cliente` (mismo efecto que 60) y `.lista_precio` mayorista/minorista; sweep de vencimiento de reservas (L48). Documentado en cobertura/01 §3 Tanda B.
> - **▶ SIGUIENTE (elegir):** (A) **Módulo Caja/Bóveda** (`tests/specs/cobertura/03_caja_clientes_gastos.md`) — sigue el orden sugerido. (B) **Productos** (margen, variantes, bulk, max_productos, alícuotas 0/21/27, L49-L60). (C) Opcionales residuales de Ventas (arriba).
> - **Método:** módulo por módulo de `cobertura/0N.md` + `uat-app.md`; e2e mutante (aserción POSITIVA + efecto en DB), fixtures SQL **reversibles** (restaurar SIEMPRE), priorizando plata/stock/fiscal. **Multi-tenant** (Jorgito + Familia Otranto) cuando aplique.
> - **Orden sugerido restante:** ~~Ventas/POS~~ → **Caja/Bóveda** → Inventario/Conteos → Compras/Recepciones → Clientes/CC → RRHH → Envíos → Config/Suscripción.
> - **🆕 Gotchas e2e (de esta sesión):** (1) `updateItem` capa la cantidad al stock disponible → un tier mayorista con umbral > stock queda DORMIDO; (2) un producto en USD necesita stock para aparecer en el buscador del POS; (3) el guard emisor↔letra de la EF corre ANTES de buscar la venta → un `venta_id` dummy alcanza para probar el 400; (4) la anon key (pública) NO está en `.env.test.local` → para tests de API a la EF correr `dotenv -e .env.local -e tests/e2e/.env.test.local`; (5) `pagar_nomina` tiene FK `rrhh_salarios.caja_movimiento_id → caja_movimientos` (no se puede borrar el egreso de una nómina paga); (6) el botón Aprobar de Autorizaciones usa `confirm()` nativo (aceptar el dialog en e2e).
> - **Harness e2e listo:** Jorgito (owner/cajero/supervisor/rrhh/deposito/contador) + **Familia Otranto De Porto** (tenant SIN clave/factura OFF) usuario `e2e.fotranto.sup@local.com`/`Test1234!` → project `chromium-fotranto-sup`. Specs 45-49 verdes. Correr: `npx dotenv -e tests/e2e/.env.test.local -- playwright test NN --project=chromium[-supervisor|-fotranto-sup]`.
> - ✅ **Follow-ups menores de código HECHOS y EN PROD (v1.84.0):** (a) input de descuento **por-ítem read-only** (per-ítem = solo combos; el manual va por "Descuento general"); (b) estado **"sin clave" VISIBLE** en las acciones rol-only (H3): toast 🔓 en VentasPage, nota en CajaPage (cierre ajeno), aclaración en InventarioPage (reconteo), badge en ConfigPage.
> - **Gotchas e2e:** inputs `type=number` del POS controlados por React → native value-setter + `dispatchEvent('input',{bubbles:true})`; "Descuento general" solo en modo ≠ presupuesto; venta 100% CC → CTA "Despachar (cuenta corriente)"; en Familia Otranto el stock está sin ubicar (avanzado solo surte ubicado) y factura OFF (Cliente sin toggle "registrado").
>
> **v1.83.0 (PR #238, migs 239+240):** **Punto 6** — caja preferida **server-side** (mig 239 `users.caja_preferida_id`): antes solo localStorage (por dispositivo) → "no aparecía"; ahora persiste por usuario → auto-select SIEMPRE en POS+Caja. Depósito a Caja Fuerte desde una caja pre-selecciona la caja activa; traspaso caja→caja ya asumía la activa. **Punto 4** — mig 240 dropea 3 columnas inertes de `tenants`. **v1.82.0 previo:** `precio_redondeo` (H4 cerrado) + descuento máx hueco $ + H4 flags.
>
> **🗒️ Decisiones de GO (resueltas):** (1) H3 sin clave = rol-only by-design [pendiente menor: mostrar estado "sin clave"]; (2) **descuento por-ítem = SOLO combos; el manual va por "Descuento general" (RESUELTO por GO).** ⇒ el auto-combo que strippea descuentos por-ítem huérfanos es **by-design** (hallazgo cerrado). **Follow-up menor para la sesión UAT:** que el input de descuento por-ítem **no sea editable manualmente** (solo lo escriben los combos) — hoy en un tenant SIN combos un descuento por-ítem manual persistiría; hacerlo read-only cierra el caso; (3) AFIP: GO hace trámite PRODUCCIÓN + conseguirá CUIT RI homologación (su dueño genera/delega el cert); (4) limpieza HECHA; (5) performance 646 lints = backlog; (6) caja preferida HECHO; (7) Finanzas se mantiene (Bóveda = tesorería de-facto); (8) hard-delete diferido; (9) multi-tenant = práctica permanente.
>
> **▶ Tanda A e2e — 6 specs VERDES (REGLA #0); resto residual documentado:**
> - ✅ **spec 45 — descuento SUPERVISOR sobre tope, CON clave** (`chromium-supervisor`, Jorgito): descuento 30% > tope 10% → gate de clave; clave incorrecta bloquea (server-side); correcta → override. Valida `validarDescuentosPorRol` (hueco $/%) + verificación server-side. Fixture `descuento_max_supervisor_pct=10`.
> - ✅ **spec 46 — límite de CC 'bloquear'** (`chromium`, Jorgito): cliente CC `limite_credito=1` + `cc_enforcement_politica='bloquear'` → venta 100% a CC → "Operación bloqueada", venta NO creada. Capa UI del guard server `fn_ventas_cc_guard` (mig 234). Fixtures reseteados.
> - ✅ **spec 47 — conteo por rol ≠ DUEÑO → autorización pendiente** (`chromium-supervisor`, Jorgito): conteo con diferencia → "pendiente de aprobación" + fila `autorizaciones_inventario` (verificado en DB). Complementa spec 36. mig 228.
> - ✅ **spec 48 — descuento sobre tope SIN clave** (`chromium-fotranto-sup`, **Familia Otranto De Porto = tenant SIN clave**): mismo tope, pero el tenant NO tiene clave → se BLOQUEA con "Descuento no autorizado… Pedí autorización" y **NO hay modal de clave** (sin override). Cierra la matriz H3 CON/SIN. **Multi-tenant**: corre en un 2º tenant (pedido de GO para levantar issues de go-live).
> - ✅ **spec 49 — morosidad CC** (`chromium-fotranto-sup`, Familia Otranto): cliente con deuda vencida + `cc_morosidad_politica='bloqueo_total'` → "No puede comprar hasta saldar", venta NO creada. Capa UI del guard 234.
> - Skip-guards (patrón 35/42) en las fixture-dependientes → el full-suite no falla sin fixtures.
> - **🆕 Harness del tenant SIN clave (Familia Otranto De Porto `4cf85bbb-22b3-4760-91ee-15a24d9e4713`):** usuario de prueba **`e2e.fotranto.sup@local.com` / `Test1234!`** (SUPERVISOR), `auth.fotranto-sup.setup.ts` + project `chromium-fotranto-sup` (gated por `E2E_FOTRANTO_SUP_*`). **Fixtures persistidos en ese tenant (de prueba):** `descuento_max_supervisor_pct=10`, `cc_morosidad_politica='bloqueo_total'`, "Mantecol Clasico 111g" priceado+ubicado, cliente "ZZZ Morosidad Test" + venta CC vencida. **Hallazgos multi-tenant (validan robustez go-live):** stock **sin ubicar** (en avanzado el POS no surte stock no-ubicado, `soloUbicado`) + **facturación OFF** (la sección Cliente no tiene toggle "Cliente registrado", el buscador va directo) → diferencias reales vs Jorgito.
> - ✅ **CERRADOS 2026-06-22 (3 specs e2e nuevos, REGLA #0, validados por DB + DEV limpio; SIN commitear):**
>   - ✅ **spec 50 — pagar nómina** (`pagar_nomina_empleado`, mig 145): pago efectivo desde Caja Principal → `rrhh_salarios.pagado`/`caja_movimiento_id` + `caja_movimientos` egreso (DB-verificado). Dato: FK `caja_movimiento_id→caja_movimientos` impide borrar el egreso de una nómina paga.
>   - ✅ **spec 51 — ajuste por 2 actores** (mig 228): el DUEÑO aprueba una `ajuste_conteo` solicitada por un SUPERVISOR → stock muta SOLO al aprobar (línea 126→127, stock_actual 250→251, `aprobado_por`≠solicitante). **+🐛 fix UI:** la lista de Autorizaciones rotulaba `ajuste_conteo`/`bulk_edit` como "Eliminar LPN" (engañoso) → ahora "Diferencia de conteo"/"Edición masiva" + detalle esperado→contado.
>   - ✅ **spec 52 — over-receipt bloquea** (B3 `superaOverReceipt`): `permite_over_receipt=false` + recibir 7 vs pedido 5 → BLOQUEA, NO crea recepción. Matriz CON/SIN ya en unit (`recepcionLogic.test.ts`); efecto stock+OC del éxito en spec 35.
>   - Los 3 con skip-guard (patrón 45/48); navegación de tabs endurecida (cold-load). Re-sembrar el SQL de fixture para re-correr.
> - ⏳ **Residual que QUEDA:**
>   - **§29 fiscal runtime AFIP** — ver bloque "AFIP" abajo (bloqueado por trámite de GO: cert/token de PRODUCCIÓN + opcional CUIT RI de homologación).
>   - **Tanda B** (sub-ítems menores): doble validación de nómina rol≠DUEÑO, B1c over/under requiere SUPERVISOR (no-supervisor recibe ≠ pedido → bloquea), over-receipt CON-dentro-de-tope con efecto stock por UI.
>
> **🔎 Hallazgo (spec 45) — RESUELTO (GO 2026-06-22):** el auto-combo que strippea descuentos por-ítem huérfanos es **by-design**. Decisión: **descuento por-ítem = SOLO combos; el manual va por "Descuento general"**. Follow-up menor (sesión UAT): hacer el input de descuento por-ítem **read-only** (solo combos lo escriben) — hoy en un tenant SIN combos un descuento por-ítem manual aún persistiría.
>
> **Gotchas e2e (para los próximos specs):** (1) los inputs `type=number` del POS son **controlados por React** → ni `.fill` ni `pressSequentially` disparan su onChange; usar el **native value-setter + `dispatchEvent('input',{bubbles:true})`**. (2) "Descuento general" solo se renderiza en modo **NO presupuesto** (`modoVenta!=='pendiente'`). (3) el check de descuento corre **antes** que caja/cliente/pago → se alcanza el gate sin sembrar caja/cobro.
>
> **Decisión abierta para GO (no bloqueante, H3):** ¿las acciones gated "pasa sin clave" (anular despachada, cerrar caja ajena, devolución cobrada) deberían avisar/forzar configurar la clave, o quedan rol-only by-design? (mi rec: rol-only + hacer visible el estado "sin clave", sin forzar).

> ### 🧾 AFIP — qué puedo hacer y qué falta de GO (aclaración)
> El tenant de pruebas (Almacén Jorgito) está **en HOMOLOGACIÓN** (`afip_produccion=false`, CUIT 23-32031506-9 Monotributista, `afipsdk_token` presente, PV 1).
> - **Lo que YA funciona / puedo testear:** emisión de **CAE real contra AFIP homologación** para la **condición actual (Monotributista → Factura C)** — ya está en la spec 21 + spec 42 (NC). La lógica de qué comprobante construye la EF por cada condición está code-auditada y con unit tests.
> - **Lo que NO puedo hacer yo (es de GO, trámite en AFIP/ARCA):**
>   1. **PRODUCCIÓN real:** generar el **certificado + token de PRODUCCIÓN** en ARCA con tu clave fiscal (asociados a tu CUIT real) y subirlos → recién ahí se activa `afip_produccion`. No se puede generar sin tu clave fiscal de AFIP. Una vez subido, yo cableo/activo el toggle.
>   2. **Matriz §29 completa (RI emite A/B, Exento) con CAE real:** AFIP valida la condición contra SU registro del CUIT. El CUIT de prueba es **Monotributo** en homologación → no puede emitir Factura A/B aunque cambie `condicion_iva_emisor` en nuestra DB. Para testear RI/Exento con CAE real necesito **un CUIT de prueba dado de alta como RI (y/o Exento) en el ambiente de homologación de AFIP** (lo das de alta vos en AFIP, o me confirmás uno). Sin eso, RI/Exento queda validado solo a nivel lógica (no CAE real).
> - **Pendiente de tu lado (resumen):** (a) cert/token de PRODUCCIÓN + avisar para activar; (b) opcional: un CUIT RI de homologación para cerrar la matriz §29 con CAE real.

> ### ❓ DECISIONES / DUDAS ABIERTAS (consolidado — para revisar con tu socio)
> 1. **H3 acciones gated "pasa sin clave"** (anular despachada, cerrar caja ajena, devolución cobrada, incobrable, saltar reconteo): ¿avisar/forzar configurar la clave, o rol-only by-design? (rec: rol-only + mostrar estado "sin clave").
> 2. ~~**Descuento por-ítem + combos**~~ → **RESUELTO (GO):** per-ítem = SOLO combos; el manual va por "Descuento general". Follow-up menor: input per-ítem read-only en UI (sesión UAT).
> 3. **AFIP** (ver bloque arriba): (a) ¿cuándo activamos PRODUCCIÓN (necesito cert/token de ARCA)? (b) ¿conseguís un CUIT RI de homologación para cerrar §29 con CAE real, o lo dejamos validado por lógica?
> 4. **Columnas DB inertes** (`recepcion_alerta_faltante_dias`, `descuento_max_cajero_pct`, `email_legal`): ¿las limpiamos en una migración de limpieza?
> 5. **Performance DB (646 lints):** envolver `auth.*()` en RLS con `(select …)` + índices en FKs. ¿Lo agendamos (migración DEV+PROD)? No urgente (deuda de escala).
> 6. **Gotcha UX:** convertir presupuesto desde el historial con 2+ cajas abiertas no expone selector de caja → falla "elegí una caja". ¿Lo arreglamos (mostrar selector en el convert)?
> 7. **Módulo Finanzas/Tesorería consolidada:** diferido (la Bóveda es la tesorería de-facto). ¿Reevaluar?
> 8. **Hard delete de tenant con grace period:** pendiente (pg_cron no habilitado → sweep externo). ¿Prioridad?
> 9. **Multi-tenant testing (idea de GO):** seguir corriendo flujos en >1 tenant (Familia Otranto, etc.) para levantar issues de go-live. Confirmado como práctica.

**✅ CERRADO el 2026-06-21 (v1.80.2 EN PROD):** #6 NC fiscal, #10 Productos, #11 Presupuestos validados por e2e click-through con efecto en DB (specs 42/43/44) + **deploy a PROD de mig 233 (clave maestra hash) + ConfigPage** (PR #235, release v1.80.2). **PROD = DEV = migs 001-233.** El merge también corrigió el drift de branch (los archivos de migs 231/232/233 no estaban en `main`). Detalle en `log.md` [2026-06-21].

**✅ AUDITORÍA DE COBERTURA F1 HECHA (2026-06-21):** 5 agentes enumeraron **~264 lógicas + ~142 flags** → `tests/specs/cobertura/01-05.md` + master **`tests/specs/uat-app.md`** (estructura aprobada: un UAT con tags `[BÁSICO]/[AVANZADO]/[AMBOS]` + `[CFG:flag]`). Hallazgos REGLA #0 verificados en `uat-app.md` §2.

**✅ HARDENING server-side COMPLETO — 5 guards EN PROD (v1.81.0, PR #236, 2026-06-21). PROD = DEV = migs 001-238.**
- **mig 234** `fn_ventas_cc_guard` (BEFORE INSERT ventas): límite CC + morosidad, deuda inline scopeada por tenant.
- **mig 235** `fn_ventas_writeoff_rol_guard` (BEFORE UPDATE ventas): rol DUEÑO/SUPERVISOR/ADMIN para condonar/incobrable.
- **mig 236** `marcar_incobrable()` RPC SECURITY DEFINER: rol (DUEÑO/SUPER_USUARIO/ADMIN) + **clave server-side** + write-off atómico (condona deuda CC + gasto "Deudor incobrable"). Wiring `ClientesPage.confirmarIncobrable`.
- **mig 237** `registrar_pago_oc()` RPC atómico: rol (no CONTADOR) + **doble firma server-side** + saldo; escribe OC + proveedor_cc + cheque + caja en una transacción. **Cierra el hueco "se omite si no hay clave"** (supera el umbral sin clave configurada → BLOQUEA y pide configurarla). Wiring `GastosPage.registrarPagoOC`.
- **mig 238** `marcar_envios_pagados()` RPC atómico: doble firma server-side del pago a courier (agrupa por courier, gasto con IVA + caja + marca pagado). Wiring `EnviosPage.marcarPagados`.
- **Comprobante de gasto:** reorder del frontend (sube antes del INSERT → `comprobante_url` atómico; arregla un bug latente: en el camino de autorización por umbral el archivo nunca se subía).
- **Validación:** por rol/clave en DEV (transacción con ROLLBACK + verificación del efecto en DB), 4/4 RPCs verdes (incl. multi-courier, supera-saldo, sin-clave-configurada→bloquea). typecheck+build+82 unit verdes. **Check de seguridad PROD:** los 5 tenants en `cc_enforcement='avisar'` sin umbral de doble firma → los guards quedan dormidos hasta configurarse (cero impacto operativo). *(El historial DEV tiene un entry duplicado "234 v2"; el archivo de repo `234_*.sql` es la versión final única.)*

**✅ CERRADO 2026-06-21 (sesión siguiente, sin migración — solo frontend + validación, EN DEV):**
1. **Descuento máx por rol** — decisión: **NO guard server-side** (el override por clave del DUEÑO no es replicable en trigger; los descuentos por ítem/monto son invisibles a un trigger en `ventas`; un descuento sobre tope NO rompe la integridad fiscal/contable → fuera del scope estricto REGLA #0, es control de autorización). **SÍ se cerró el hueco real client-side:** un descuento por **$ (monto)** esquivaba el tope **%** del SUPERVISOR/canal (el check solo miraba `descuento_tipo==='pct'`). Ahora todo descuento se convierte a su **% efectivo** y se valida con `validarDescuentosPorRol` (lib pura en `src/lib/ventasValidation.ts`, +18 unit). Override por clave intacto. `descuento_max_cajero_pct` sigue inerte → decisión va a **H4**.
2. **H3 — clave CON vs SIN** — **contrastado + validado server-side en DEV.** Primitivo `verificar_clave_maestra` (clave OK→true, mala→false, NULL→false, **tenant sin clave→true SIEMPRE**) + RPC `marcar_incobrable` por impersonación SQL (DUEÑO+clave OK→ejecuta; DUEÑO+clave mala→`Clave maestra incorrecta.`; CAJERO→`No autorizado` por rol antes que clave). **Matriz CON/SIN completa documentada en `uat-app.md` §H3.** Hallazgo: la clave es **2º factor opt-in** — donde hay límite numérico (umbral doble firma, tope descuento) SIN clave **bloquea**; donde es acción discrecional (anular, incobrable, cerrar caja ajena, saltar reconteo) SIN clave **el rol es el único gate**. *Decisión para GO (no bloqueante): ¿las acciones rol-only sin clave deberían avisar/forzar configurar la clave?* Falta solo el e2e click-through (toggle de clave) → va en Tanda A.

**✅ CERRADO 2026-06-22 (H4 flags huérfanos — sin migración, solo frontend, EN DEV):**
3. **H4 mayormente resuelto.** Verifiqué el estado REAL de cada flag (2 findings del audit estaban stale). Decisiones de GO + recomendaciones:
   - **`descuento_max_cajero_pct` → QUITADO** del frontend (cajero queda 100% bloqueado, regla C3/G3). Columna DB inerte.
   - **`email_legal` → QUITADO** del frontend (rec: `tenant.email` ya cubre comprobantes/emails; sin caso de uso). Columna DB inerte.
   - **`boveda_umbral_caja` → ALERTA no-bloqueante** "efectivo en caja sobre umbral → depositá a la Caja Fuerte". Helper puro `cajasSobreUmbralBoveda` (+4 unit) compartido por `useAlertas` (badge) + `AlertasPage`. Ambos modos. Query validado contra DEV.
   - **Tab RRHH de Config → CONSTRUIDO** (6 flags reales: tardanza modo/tolerancia, horas mes base, horas extra aprobación, doc alerta días, nómina supervisor aprueba). Los otros `rrhh_*` ya tenían setter en RrhhPage (audit sobreestimaba "~11").
   - **`conteo_modo='elegir'` → NO era bug** (finding stale; Config ofrece las 3 + runtime muestra el toggle). Cerrado.
   - **`recepcion_alerta_faltante_dias`** → columna muerta, no se construyó (limpiar en pasada de DB).
   - **`precio_redondeo` → DIFERIDO a su propia sesión** (fiscal + amplio; el precio entra por retail/mayorista/USD/edición manual → factura/IVA derivan de él). El más valioso, no rushear.

**▶ LO PRIMERO de la próxima sesión — backlog que QUEDA (todo en `uat-app.md`):**
4. **`precio_redondeo`** (único pendiente de H4) — su propia sesión: helper puro `redondearPrecio(precio,modo)` + unit, aplicado en el punto canónico del precio unitario efectivo (consistente con factura/IVA). Plata/fiscal → REGLA #0, con tests.
5. **Tanda A e2e** (post-guards): §29 fiscal runtime, límite CC, **clave maestra con/sin (e2e click-through — el contrato server ya está validado)**, ajuste por rol≠DUEÑO, conteo gate, over-receipt, pagar nómina, **descuento SUPERVISOR sobre tope → bloquea / clave autoriza**.

**Método e2e (recordatorio):** aserción POSITIVA del resultado (toast/efecto) + verificar la mutación en DB con `execute_sql`; nunca solo `.not.toBeVisible()`. Correr con `npx dotenv -e tests/e2e/.env.test.local -- playwright test NN_spec --project=chromium`. Tenant DEV = Almacén Jorgito (`3769b1db…`). Clave maestra del tenant = **12345678**. Las fixtures por SQL (devolución spec 42, OC spec 35) para saltear pasos frágiles/cross-módulo son patrón aceptado. Ver [[reference_e2e_validation_capability]].

**Diferidos/parciales (no bloqueantes):** **gotcha UX — el convert de presupuesto desde historial NO expone selector de caja con 2+ cajas abiertas** (`cambiarEstado` exige caja elegida; ver log 2026-06-21); autorización de conteo por rol ≠ DUEÑO (2 actores), RRHH pagar nómina (RPC `pagar_nomina_empleado`)/recibo PDF/liquidación final, gate de pago de OC (cruza Gastos→OC), brazo OC del rechazo de cheque (revierte OC + ajuste proveedor_cc), formas efectivo/reposición de devolución a proveedor, over/under-receipt B3/B4.

---

## ▶ CIERRE DE SESIÓN 2026-06-20 — dónde retomar

**Estado:** **PROD = v1.80.1 (migs 001–232)**; **DEV = migs 001–233** (mig 233 clave maestra hash solo en DEV). EF `emitir-factura` en DEV **y PROD** (con FAC-27). Releases v1.80.0 + v1.80.1.

**🔐 PENDIENTE PROD — mig 233 (clave maestra hasheada) + frontend `ConfigPage`:** cambio de seguridad REGLA #0 (la clave estaba en texto plano). En DEV ✅. Para PROD: aplicar mig 233 (hashea las claves existentes preservando el valor) + deploy de `ConfigPage` (campo de confirmación + RPC `set_clave_maestra`) → bump de versión + PR dev→main. GO decide cuándo. **Ojo:** tras aplicar en PROD, las claves de los tenants quedan hasheadas (siguen verificando con el mismo valor); no hace falta que nadie re-tipee. Detalle en el log 2026-06-20 + `supabase/migrations/233_clave_maestra_hash.sql`.

**🔴 REGRESIÓN del seed de alta CORREGIDA (2026-06-20) — mig 232:** validando un alta desde cero se detectó que desde la **mig 225** (18/06) `fn_seed_tenant_defaults` dejó de crear **Sucursal 1 + Caja Principal + 6 unidades de medida** (la reescritura para Efectivo las perdió). Todo tenant nuevo nacía sin poder operar; golpeó a un tenant REAL en PROD ("El muller"). **mig 232** restaura el seed completo + backfill (DEV+PROD). Verificado: tenant nuevo nace completo; PROD con 0 tenants sin sucursal/caja/unidades. **Validación e2e (Playwright contra DEV): 163/164 verde**; la única roja es la emisión de Factura C contra AFIP homologación (timeout 30s por lentitud del servicio externo, no bug — confirmar con emisión real). Unit suite no corre en el sandbox por RAM de jsdom (1 archivo suelto = verde; correr en máquina con más RAM). Tenant de testing propio: `ZZZ_VALIDACION_CLAUDE` (DEV).

**🆕 Paridad DEV↔PROD PAR-02..05 CERRADA (2026-06-20) — mig 231:** la auditoría del UAT de primer uso encontró **drift de columnas grave** — PROD NO tenía 3 columnas que la app v1.80.1 usa (`ventas.costo_envio` 🔴 fiscal, `clientes.notas` 🔴, `movimientos_stock.linea_id` 🟠), agregadas a DEV fuera de banda. En PROD **rompían** el alta/edición de clientes, la venta con costo de envío y el PDF de factura (no se notó: nadie ejerció esos flujos en PROD todavía). **mig 231** las agregó a PROD (GO aprobó) + dejó `autorizaciones_inventario.linea_id` nullable en DEV (drift; alinea mig 103) + agregó el event trigger `ensure_rls` a DEV. **Resultado: DEV == PROD** — columnas idénticas (1817, `d482718f…`), policies idénticas (153, `c974cded…`), seed byte-idéntico. El resto del diff de funciones es cosmético (whitespace/CRLF/comentarios; verificadas inventario/contable/RLS = misma lógica). `schema_full.sql` actualizado. **Queda solo el smoke de primer uso PU-01→PU-17** (runtime/UI/e2e en PROD). Ver [[reference_drift_dev_prod_paridad]] y `tests/specs/uat-primer-uso.plan.md`.

**🆕 v1.80.1 + fixes de PRIMER USO (2026-06-20) — disparados por una mala experiencia real de un usuario nuevo en PROD:**
- **SMTP de Auth → Resend** (los mails de confirmación usaban el SMTP integrado → "email rate limit"). *Config de dashboard, hecha por GO.*
- **Onboarding soporta "Confirm email" ON (v1.80.1, PR #233):** el alta fallaba la RLS de `tenants` (signUp sin sesión). Ahora los datos del negocio van en el metadata + `emailRedirectTo=/onboarding`; sin sesión muestra "revisá tu email"; al confirmar, el `useEffect` crea el tenant (`provisionNegocio`). Robusto vía AuthGuard→/onboarding. ✅ **Auth URL config hecha (GO):** Site URL = `https://app.genesis360.pro` (el dominio real de la app) + Redirect URLs con `/**` para app/genesis360.pro/www/localhost (cubre /onboarding); se removió el dominio viejo de Stokio.
- **🔴 DRIFT DEV≠PROD de CHECK constraints (migs 229 + 230) — causa raíz de varios errores en PROD:** `caja_movimientos_tipo_check` (mig 229: rompía Caja Fuerte/señas/ventas no-efectivo/devolución de seña) + `ventas_estado_check` sin `'devuelta'` (rompía la devolución total) + `notificaciones_tipo_check` que rechazaba claves de evento (rompía abrir/cerrar caja con diferencia). **mig 230 reconcilió los 5 CHECKs → DEV == PROD (PAR-01 cerrado, hash `565c8f0…`, 97 CHECKs).** Ver [[reference_drift_dev_prod_paridad]] y `tests/specs/uat-primer-uso.plan.md`.
- **📋 Plan nuevo `tests/specs/uat-primer-uso.plan.md`:** UAT de primer uso (tenant nuevo, cero config) + auditoría de paridad DEV↔PROD. **Es lo que se debe correr antes de cada alta de cliente.**

**v1.80.0 (EN PROD):**
- **🎨 Branding single-source:** ícono nuevo (regenerado de `brand/logo-source.png`) en tab/sidebar/landing/suscripción/login/onboarding vía `BRAND.logo`. Tabs unificadas (`PageTabs`: subrayado + degradé violeta→cian + drag-scroll + badge + **iconos en Inventario y Proveedores**). **Hover de marca** en tabs/sidebar (texto+ícono al degradé, mantiene fondo violeta translúcido). Fondos landing/suscripción/onboarding → degradé (`bg-brand-gradient-hero`). Caja: capital **por moneda** (CAJ-29) + tab "Caja actual" centrado.
- **🔴 Autorización de ajustes de inventario POR ROL (mig 228):** DUEÑO directo, resto requiere aprobación, **configurable por rol** (Directo/Por umbral/Siempre) en Config → Inventario → Reglas. Aplica a Conteo, ajuste/eliminación de LPN y edición masiva. `ajusteAutorizacion.ts` +9 tests. **Tab Autorizaciones de vuelta en básico** (se había sacado por error; el Conteo de básico genera autorizaciones).
- **🧾 Guards fiscales:** **FAC-27** (EF: B ≥ umbral sin DNI/CUIT → 400), **GAS-17** (default Ganancias por condición), **PRD-11** (precio ≥ 0), **GAS-16** by-design. **🛑 REGLA DE ORO #0** en CLAUDE.md.
- **✅ UAT code-audit FINALIZADO** + **§29 matriz fiscal por condición** para runtime.

**🆕 VALIDACIÓN E2E POR CLICK-THROUGH (2026-06-20) — descubrimiento clave para la próxima sesión:**
- **El e2e de Playwright SÍ corre en este entorno** (`npm run test:e2e` levanta el dev server → DEV y maneja la app como usuario). **Usar esto para validar flujos de verdad, no solo code-audit.**
- **El unit suite (vitest) NO corre completo acá por RAM de jsdom** (el error `Cannot read properties of undefined (reading 'config')` que el propio `vitest.config.ts` documenta como OOM). **Un archivo suelto SÍ** (`npx vitest run tests/unit/X.test.ts` = verde). Para la suite completa, correr en la máquina de GO/CI.
- **Suite e2e completa: 163/164 verde** (la única roja = emisión Factura C contra AFIP homologación, timeout por servicio externo lento — NO bug; confirmar con emisión real).
- **Smoke de primer uso (spec `26_primer_uso_smoke`)**: cliente+notas, venta no-efectivo (`ingreso_informativo`), reserva+seña (`ingreso_reserva`) — **verde**; Caja Fuerte (`ingreso_traspaso`) validado a nivel DB (los 7 tipos de `caja_movimientos` se aceptan en un tenant fresco).
- **4 flujos profundos nuevos validados por UI con efecto verificado en DB:** `27_gasto_efectivo` (→egreso caja), `28_cobranza_cc` (deuda 5714→5614 + ingreso), `29_recepcion_stock` (Elite 133→134), `30_traslado_sucursal` (Norte→Sur `recibido`).
- **Lección de autoría e2e:** usar **aserción POSITIVA del resultado** (toast/efecto) + **verificar la mutación en DB**, nunca solo `.not.toBeVisible()` (da falso-verde). La recepción exige lote/venc/series según el producto (usar uno simple). El traslado fija la sucursal origen vía `localStorage('sucursal-id')`.
- **Tenant de testing propio en DEV:** `ZZZ_VALIDACION_CLAUDE` (ya seedeado completo, para validaciones).

### ▶ PRÓXIMA SESIÓN — continuar UAT / e2e / auditorías de TODOS los módulos y funciones restantes

**Método:** por cada módulo → leer el flujo real → autorear un e2e mutante (aserción positiva + verificar efecto en DB) → correr verde. Complementar con code-audit donde aplique.

**Flujos/módulos YA validados por e2e mutante (no repetir):** ventas (venta directa, no-efectivo, reserva+seña), caja (apertura/arqueo/cierre), devolución, despacho de presupuesto, ingreso de inventario, facturación (salvo CAE runtime), gasto efectivo, cobranza CC, recepción→stock, traslado entre sucursales, alta de cliente, **cheques (gasto pagado con cheque → rechazo revierte el pago, spec 31)**, **Caja Fuerte (depósito caja→bóveda con las 2 patas, spec 32)**, **devolución a proveedor (crédito en CC → rebaja stock + nota de crédito, spec 33)**, **creación de OC (spec 34)**, **recepción vinculada a OC → stock↑ + OC recibida por acumulado (spec 35)**, **conteo de inventario con diferencia → ajuste directo del DUEÑO (spec 36)**, **RRHH nómina → gasto de sueldo (spec 37)**, **envío propio → combustible → gasto (spec 38)**, **condonación de deuda CC / write-off (spec 39)**, **dar de baja incobrable con clave maestra (spec 40)**, **setear clave maestra hasheada con confirmación (spec 41)**.

**▶ Backlog de módulos/funciones SIN e2e mutante todavía (priorizar plata/stock/fiscal = REGLA #0):**
1. ✅ **Cheques** — VALIDADO (spec `31_cheque_gasto_rechazo_mutante`): gasto pendiente → pago con "Cheque" crea cheque propio vinculado → rechazo revierte el pago (gasto vuelve a pendiente, verificado en DB). *Falta el brazo OC del rechazo (revierte OC + ajuste en proveedor_cc) → cubrir en #4 OC completa.* **Fixture DEV:** se agregó el método "Cheque" a Almacén Jorgito (el seed no lo trae — ver observación en log).
2. ✅ **Caja Fuerte UI** — VALIDADO el depósito caja→bóveda (spec `32_caja_fuerte_deposito_mutante`): 2 patas balanceadas (`egreso_traspaso` en caja + `ingreso_traspaso` en bóveda, verificado en DB). *Falta click-through de: extracción/envío de bóveda a caja (`retiro`), arqueo de bóveda, ingreso externo.*
3. ✅ **Devolución a proveedor** — VALIDADO el brazo crédito en CC (spec `33_devolucion_proveedor_mutante`): rebaja stock FIFO (251→250, stock_actual 254→253) + `nota_credito` -1000 en CC del proveedor + `devoluciones_proveedor` confirmada (verificado en DB). *Faltan las formas **efectivo** (→ ingreso a caja) y **reposición** (→ OC borrador nueva).*
4. ✅ **OC completa** — VALIDADO el core: **creación** de OC por UI (spec `34_oc_creacion_mutante` → OC borrador + ítem) + **recepción vinculada** (spec `35_recepcion_oc_vinculada_mutante` → stock↑ + OC pasa a `recibida` por el acumulado B5, verificado en DB: OC #14 recibida, Elite Pañuelos 134→139). *Pendientes parciales:* el **gate de pago de OC** (borrador→enviar→pagar/asignar a CC→confirmar; cruza Gastos→OC), el **brazo OC del rechazo de cheque** (revierte OC + ajuste en proveedor_cc), las **formas efectivo/reposición** de devolución a proveedor, y el **over/under-receipt** (B3/B4 con aprobación SUPERVISOR). **Fixture DEV:** OC #14 confirmada (Mayorista MAX, Elite x5) creada por SQL para saltear el gate de pago.
5. ✅ **Conteos de inventario** — VALIDADO el core (spec `36_conteo_ajuste_mutante`): conteo "Por producto" con diferencia +1 → para el DUEÑO (modo `directo`, mig 228) ajusta el stock AL TOQUE (`reconciliarDelta` + `movimientos_stock ajuste_ingreso`), verificado en DB (Elite 139→140, conteo `finalizado`). *Pendientes parciales:* autorización por rol (rol ≠ DUEÑO → `autorizaciones_inventario` pendiente → aprobación), doble conteo (umbral de reconteo), ABC/cíclico.
6. **NC (nota de crédito)** — emisión vía Devolver (CbtesAsoc) — REGLA #0 fiscal (runtime AFIP). **← SIGUIENTE** (requiere AFIP homologación).
7. ✅ **RRHH** — VALIDADO el core nómina→gasto (spec `37_rrhh_nomina_gasto_mutante`): "Generar nómina del mes" + "Generar gasto" → gasto "Sueldo … — período" categoría Sueldos, monto=neto, pendiente, `rrhh_salarios.gasto_id` vinculado (verificado en DB; `deduce_ganancias` saneado a false por ser Monotributista, mig 227). *Pendientes:* pagar nómina (RPC `pagar_nomina_empleado` → caja/CC), cargas sociales, recibo PDF, liquidación final/indemnización, asistencia/fichado, vacaciones, anticipos.
8. ✅ **Envíos** — VALIDADO envío propio → combustible → gasto (spec `38_envio_combustible_gasto_mutante`): gasto categoría Combustible $5000 pagado + `envios.gasto_combustible_id` vinculado (verificado en DB). Fixture DEV: recurso "Moto Reparto Test" asignado a envío #15 (el botón exige `courier='Envío propio' && recurso_id`). *Pendientes:* crear envío, POD, hoja de ruta/reparto, pago a courier (tercero→egreso).
9. ✅ **Clientes/CC avanzado** — VALIDADO la condonación de deuda CC / write-off (spec `39_cc_condonacion_mutante`): venta #210 `monto_pagado` 0→4057 + tag 'Condonación CC' (excluido de ingresos), verificado en DB. **🔴 Bloqueado:** "dar de baja incobrable" (B6) exige la **clave maestra del tenant** (configurada, desconocida/hasheada) → no automatizable sin la clave real. *Pendientes:* crédito a favor (cliente_creditos vía devolución), intereses CC (sweep), incobrable B6.
10. **Productos** (kits/recetas, variantes, mayoristas, estructura).
11. **Presupuestos** (crear → convertir a venta; recurrentes/facturas recurrentes).
12. **Config** (datos fiscales, métodos de pago, cuentas de origen, clave maestra, autorizaciones por rol UI).
13. **Suscripción/planes/trial** (upgrade, gating Pro).
14. **Caja avanzada** (traspaso entre cajas operativas, préstamo a empleado, panel cajero).
15. **Autorización de ajustes por rol (runtime UI)** — DUEÑO directo vs rol→Autorizaciones (mig 228).
16. **§29 matriz fiscal RUNTIME** — cambiar `condicion_iva_emisor` (RI/Mono/Exento) + emitir CAE real homologación (MF-01→14) + Gastos por condición (MG-01→13). *(Requiere AFIP homologación; los guards server-side ya están code-auditados.)*

**Otros pendientes (no e2e):**
- **Verificación VISUAL en PROD:** ícono nuevo (hard-reload por caché PWA), degradé global, hover tabs/sidebar, iconos en tabs, fondos landing/suscripción, capital por moneda.
- **Smoke de primer uso PU-01→17 en PROD** sobre un tenant nuevo real (alta con confirmación de email — no automatizable sin inbox; lo corre GO). La paridad (migs 230-232) ya previene los drifts.
- **▶ Pase de performance DB (backlog, para PROD):** los **646 lints** — envolver `auth.*()` en RLS con `(select auth.*())` + índices en FKs sin índice. Migración DEV+PROD.
- **Limpieza:** borrar el tenant `ZZZ_VALIDACION_CLAUDE` (DEV) cuando ya no se use; los datos de prueba en Almacén Jorgito (clientes test, traslado #1, recepción, gasto) son inocuos.
- **Diferido:** módulo Finanzas/Tesorería consolidada (la Bóveda es la tesorería de-facto).

**⚙️ Infra DEV (2026-06-19):** por el aviso de saturación de recursos se **desactivaron en DEV** los crons `jobid 1` (`net.http_post`) y `jobid 3` (`fn_tn_sync_heartbeat`, sync TiendaNube, cada 5 min) — saturaban el tier chico sin aportar en un entorno de prueba. **Reversibles:** `SELECT cron.alter_job(job_id => 1, active => true)` (ídem 3). jobid 4 (CC vencidas) y 5 (limpieza token envíos), daily, siguen activos. **PROD intacto** (sus crons siguen activos: sync real cada 5 min). No se subió compute (es DEV; el aviso era transitorio por el pico de e2e + diagnóstico).

---

## ▶ CIERRE DE SESIÓN 2026-06-18 — dónde retomar

**Estado:** **PRD = DEV = v1.79.0**, migs **001–227** en DEV **y PROD**. **v1.79.0 (PR #231, mig 227):** Gastos — automatización fiscal por condición del tenant (`tipo_comprobante` + trigger guard de IVA crédito; RI+Factura A discrimina, Mono/Exento total sin crédito ni Ganancias). **v1.78.4 (PR #230):** arqueo repetible visible + flex-wrap + theme_color violeta. **v1.78.3 (PR #227):** fix selector de caja en la venta — excluye la Caja Fuerte y autopreselecciona la única caja operativa. **v1.78.4 (PR #230, sin mig):** arqueo repetible más visible (botón "Arqueo" + tooltip; ya funcionaba, era UI) + acciones de caja `flex-wrap` + `theme_color` del manifest al violeta (#7B00FF). EFs (DEV+PROD): `emitir-factura` (con costo de envío + guard de tipo + fix de alícuota), `cron-sweeps`, `admin-api` (panel de soporte). **v1.78.2 (PR #226):** Efectivo por default en alta de tenant (mig 225) + fix conteo de efectivo en bóveda (mig 226) + Caja Fuerte UI (2 tarjetas + selector de cuenta + lock básico) + **logo/iconos nuevos** + **Caja a pantalla completa (2 columnas)** + **degradé de marca violeta→cian** (single-source en `src/index.css`; `bg-accent`→degradé). **⚠ A VERIFICAR VISUALMENTE en PROD:** el degradé global y el layout de Caja (no se pudieron ver renderizados; revertibles con un commit).

### ▶ Para retomar (post-/clear) — ítems abiertos

1. **Verificación VISUAL en PROD** (no se pudieron ver renderizados; todos revertibles con un commit): el **degradé violeta→cian** en botones/barras de toda la app; el **layout de Caja** (full-width 2 columnas); el **logo/iconos** nuevos (hard-reload por caché PWA/favicon); el **form de Gastos** según la condición del tenant; las **2 tarjetas** de Caja Fuerte.
2. **Decisión pendiente — aperturas de caja en el capital total:** hoy `vw_boveda_cuentas` no suma `caja_sesiones.monto_apertura` (no son movimientos). Incluirlas tiene riesgo de doble conteo según cómo se fondeó la apertura → definir criterio con GO antes de tocar. Ver [[reference_caja_fuerte_capital_efectivo]].
3. **Módulo Finanzas/Tesorería consolidada:** diferido (recomendado NO crearlo aún; la página de Bóveda es la tesorería de-facto). Reevaluar si se necesita flujo de caja en el tiempo + proyecciones.
4. **Dato:** Almacén Jorgito (DEV) quedó en `condicion_iva_emisor = RI` (GO lo cambió). Afecta facturación (emite A/B) y gastos (Factura A con IVA crédito). Si era para probar, recordá volverlo a Monotributista.

**🏦 Caja Fuerte (✅ EN PROD v1.78.2):** 2 tarjetas (saldo bóveda + capital total), selector de cuenta destino en el ingreso (default Efectivo), lock de caja-origen en básico, mig 226 (capital cuenta el efectivo de ventas/gastos). Gap conocido: aperturas no se cuentan (ítem 2 de arriba).

**💵 Efectivo por default en alta de tenant (2026-06-18, mig 225, EN DEV) — pedido GO:** cada tenant nuevo nace con la Cuenta de Origen Efectivo (tipo `efectivo`, moneda del tenant) + 5 métodos default con Efectivo vinculado. Trigger `fn_seed_tenant_defaults` extendido + backfill de existentes + fallback en `ConfigPage`. Verificado en DEV. **▶ PRÓXIMO PASO PROD:** aplicar mig 225 a PROD + bump v1.78.2 + PR `dev→main` + release.

**🧾 Fixes de facturación + ✨ tarjeta Capital Caja Fuerte (2026-06-18, ✅ EN PROD v1.78.1, PR #225) — 4 bugs, uno GRAVE:**
- **▶ Smoke recomendado en homologación (GO):** Factura A/B con producto a 10,5% → Id 4 (antes 21%/AFIP 10051); forzar B siendo monotributista → 400.
- **✨ Caja Fuerte:** tarjeta de Capital total destacada (degradé violeta→cian, estilo Dashboard) en el header — `CajaPage.tsx`. (El pedido de la tarjeta ya está IMPLEMENTADO; queda en backlog la consulta de módulo Finanzas y los múltiples arqueos por caja.)
- **🔴 GRAVE (fiscal):** alícuota ≠ 21% se mandaba a AFIP como 21%. El `numeric` de PG llega `"10.50"/"0.00"/"27.00"` y no matcheaba `ALICUOTA_ID` → default `Id:5` (21%) con importe a la tasa real → **AFIP rechaza (10051)**. Latente (todo lo probado era 21% + monotributistas emiten C). Fix: normalizar con `String(parseFloat())` en `emitir-factura/index.ts` + `facturacionLogic.ts` (+4 unit regresión).
- **🔴 (fiscal):** tipo de comprobante no validado server-side → guard en la EF (Monotributista/Exento→solo C; RI→nunca C; si no 400). La restricción de v1.78.0 era solo UI (ventas #222/#224 de Almacén Jorgito salieron B siendo monotributista).
- **🔴:** producto Exento (0%) se guardaba 21% (`||21` sobre `0`) → `Number.isFinite()`. `ProductoFormPage.tsx`.
- **🟠:** select de alícuota no reflejaba el valor guardado (`"10.50"`≠`"10.5"`) → normalizar al cargar. `ProductoFormPage.tsx`.
- **🟡 botón Emitir en Facturación:** EF OK (logs DEV = 200). Fix: auto-set del primer PV al abrir el modal (no se seteaba → emitía con PV default 1). **Kiosco Buildi NO tiene PV configurado** (revisar con GO). Confirmar con GO el síntoma exacto (posible bundle cacheado).
- **Flujo envío+factura:** auditado y correcto (no duplica total). **753 unit + build verdes.**
- **▶ PRÓXIMO PASO:** GO prueba en homologación (Factura A/B con producto 10,5% → Id 4; forzar B monotributista → 400) → deploy `emitir-factura` a PROD → PR `dev→main` con bump de versión (v1.78.1 o v1.79.0) + release. Frontend (ProductoForm/facturacionLogic/FacturacionPage) va con ese PR. UAT `tests/specs/uat-modo-basico.md` +12 escenarios (FAC-20→26, PRD-15/16/17, VEN-35).

**🚚 v1.78.0 (2026-06-18, EN PROD, PR #224, sin migración) — Costo de envío en factura + envío en básico + restricción de tipos A/B/C por emisor:** ✅ **EN PROD** (EF `emitir-factura` deployada en PROD, frontend mergeado dev→main, release v1.78.0). 750 unit + build verdes. **✅ Validado en homologación: Factura C con envío → CAE OK + envío en el detalle.** Lo hecho:
- **Restricción de tipos A/B/C (frontend, inocuo, no necesita homologación):** el selector del POS y de Facturación ahora ofrece **solo las letras válidas según `condicion_iva_emisor`** — Monotributista/Exento → solo C; RI → A/B (nunca C). Antes mostraba los 3 y dejaba elegir A siendo monotributista. Helper `tiposComprobantePermitidos()` en `facturacionLogic.ts` + 4 unit tests; Facturación además defaultea al tipo auto-detectado.
- **Factura:** `costo_envio` cobrado al cliente ahora entra como ítem "Costo de Envío" + suma al total (antes quedaba afuera). Alícuota del flete = la predominante de los productos (regla AFIP: en A sigue al producto; en C va a neto). **Concepto=3 + FchServDesde/Hasta/VtoPago** cuando hay envío (AFIP los exige). Courier que paga el cliente directo = `costo_envio` 0 → no se agrega (correcto). PDF de factura: línea + total/saldo con envío. NC no afectada.
- **Envío en básico:** ahora es **solo un campo de costo** (se guarda en `ventas.costo_envio`, sale en ticket y factura); se ocultan transporte/courier/km/dirección y **NO crea registro en `envios`** (inserción gateada por `modoAvanzado`). Avanzado sin cambios.
- **✅ EN PROD (2026-06-18):** EF `emitir-factura` deployada en PROD, PR #224 `dev→main` mergeado, release v1.78.0. Validado en homologación (Factura C con envío → CAE OK). Smoke recomendado en PROD: una venta real con envío → ver el "Costo de Envío" en el detalle y el total de la factura.

**✅ HECHO (v1.78.1) — Caja Fuerte: tarjeta de "Capital total" destacada:** `capitalTotal` subido a nivel de componente en `CajaPage.tsx` + tarjeta estilo Dashboard (degradé violeta→cian, número grande) en el header de la bóveda, gateada por `puedeExtraerBoveda`; se quitó el "Total:" chico. **Consulta abierta de GO (evaluar a futuro):** ¿finanzas/capital amerita un módulo aparte (Tesorería consolidada) o se sigue distribuido (Caja + Bóveda + Cuentas de Origen + Cheques + CC + Gastos)? Recomendación: NO crear módulo aún; la página de Bóveda ya es el de-facto tesorería. Un módulo Finanzas tendría sentido cuando se necesite flujo de caja en el TIEMPO + proyecciones + consolidar por-cobrar vs por-pagar.

**✅ ACLARADO (v1.78.4) — múltiples arqueos por caja:** GO reportó que "no se puede hacer más de 1 arqueo". Investigado: **SÍ se puede** — no hay constraint UNIQUE en `caja_arqueos` ni guard en `realizarArqueo`, y hay data real con 2 arqueos en una misma sesión. Era **descubribilidad**: tras el 1er arqueo el botón prominente pasa a "Cerrar caja" y el de arqueo quedaba como ícono ✓ sin texto. Fix v1.78.4: el botón ahora dice "Arqueo" + tooltip aclara que se pueden hacer varios por sesión + fila de acciones `flex-wrap`.

**🛟 Panel de soporte — cambiar contraseña (2026-06-18):** EF `admin-api` action `auth.change_password` (DEV+PROD) + modal en el sidebar. Resuelve el password temporal sin pasar por el dashboard de Supabase. Mergeado dev→main del repo `genesis360-admin` → live en `admin.genesis360.pro`. (El panel quedó desplegado y en uso: ver [[project_plataforma_soporte]].)

### 🟢 RESUELTO (v1.78.0, en DEV) — Costo de envío en factura/ticket + flujo de envío en básico

*(Era backlog prioritario; implementado el 2026-06-18, pendiente solo el deploy fiscal a PROD tras test en homologación.)* Reglas implementadas:

**A) AFIP — el costo de envío cobrado al cliente DEBE ir dentro de la factura (A/B/C)** como un **ítem extra** "Costo de Envío" (no puede quedar afuera; es parte del neto total de la operación). Tratamiento:
- **Envío propio** (o courier que te factura a vos y vos se lo cobrás al cliente): el envío es **servicio accesorio**. En B/C: ítem extra "Costo de Envío" por el valor cobrado. En **A**: el envío sigue la **misma alícuota de IVA que el producto** (producto al 21% → envío al 21%; al 10,5% → 10,5%).
- **Courier que el cliente paga directo** (pago en destino / pago separado al correo): el envío **queda FUERA** de la factura; se factura solo el neto del producto.
- **wsfe / EF `emitir-factura`:** cuando hay envío cobrado, setear **`Concepto=3`** (Productos y Servicios) y agregar la línea de flete en el `Detalle` con su `ImpIVA` según alícuota. (Con `Concepto=1` AFIP puede rechazar si detecta descripción de flete en Factura A.) Hoy `ventas.costo_envio` existe pero **no se está sumando ni a `venta_items`/detalle de la factura ni al total cobrado** → ese es el bug.
- **Verificar también:** el **total cobrado al cliente** en la factura debe incluir el envío (hoy no lo considera).

**B) Modo básico — el envío es SOLO un campo de costo en la venta:**
- En básico: un **campo "Costo de envío"** en el POS para tipear el monto; **NADA de lógica de envíos**, **NO crear un envío en la página de Envíos**, nada de courier/reparto/etc.
- Ese costo debe aparecer **en el ticket Y en la factura** (como ítem, según regla A).
- **Modo avanzado:** sí se gestiona todo el envío (como hoy).
- ⚠️ Bug a confirmar: en básico el flujo estaría derivando al módulo de Envíos (que en básico está oculto) → revisar `VentasPage` (`costoEnvioNum`, creación de envío, gating por `modoAvanzado`).

Fuente: comentario de GO (detalle completo con ejemplo de JSON wsfe `Concepto=3` + ítem ENV-001). **Pendiente de auditoría/implementación** (GO lo marcó "revisar luego").


**🧹 Mig 220 (2026-06-17, DEV+PROD) — barrido de drift de policies:** tras la 219 se comparó `pg_policies` DEV vs PROD; aparecieron 4 tablas con drift **cosmético** (clientes duplicada, gasto_cuotas con nombre distinto + nunca migrada, productos/tenants `is_admin()` vs inline equivalente). Mig 220 las normaliza al canónico del repo. **Resultado: DEV == PROD == 152 policies, mismo hash global** (`54c6422…`). La capa RLS quedó 100% sincronizada. **Regla nueva en CLAUDE.md:** todo DDL va por migración versionada, nunca SQL suelto / botón del Security Advisor (esa fue la causa raíz del drift).

**🔔 v1.77.0 (2026-06-17, mig 219, EN PROD, PR #221) — Pase 3 de la auditoría UAT modo básico (§25-28):** un hallazgo 🔴 — la RLS de `notificaciones` bloqueaba el INSERT cross-user → **TODAS las notificaciones in-app estaban rotas** (solicitud de Caja Fuerte —que además abortaba el pedido del cajero—, diferencia apertura/cierre de caja, alertas de venta margen-negativo/devoluciones). PROD y DEV estaban **desincronizados** (PROD `notif_user FOR ALL` rechazaba cross-user; DEV tenía `notif_select`+`notif_update` aplicadas fuera de banda y **sin policy de INSERT**). **Mig 219** normaliza ambos: SELECT/UPDATE/DELETE solo propias (aislamiento intacto) + INSERT mismo tenant. Validado impersonando cajero en DEV **y PROD**. Sin cambios de frontend. Resto §25-28 verde (escaneo, idempotencia webhooks, chunk recovery, savingRef, export/import).

**⚠ Causa raíz del drift (DEV≠PROD):** comparando `schema_migrations` de ambos, **ninguna migración creaba `notif_select`/`notif_update`** → se aplicaron con **SQL crudo** (dashboard Supabase / quick-fix del Security Advisor / `execute_sql`) solo en DEV, sin archivo ni propagación. PROD = estado del repo. **Regla:** todo DDL persistente va por archivo de migración, nunca por SQL suelto. **Pendiente menor:** barrido de policies DEV-vs-PROD-vs-repo por si hay más casos.

---

### Histórico previo (v1.76.0 y anteriores)

**Estado:** **PRD = DEV = v1.76.0**, migs 001–218, EF `emitir-factura` + `cron-sweeps`. **🧪 v1.76.0 (2026-06-16, PR #220, SIN migración): auditoría exhaustiva del UAT modo básico (`tests/specs/uat-modo-basico.md`, ~300 escenarios) → 7 bugfixes de plata/stock** (DEV-07 tope re-devolución · DEV-04 devolución vs deuda CC/crédito a favor · GAS-01/05 egreso efectivo awaited+aviso · VEN-22 savingRef anti doble-submit · CONTADOR ve Facturación · PRES-08 convert re-valida stock · CAJ-18 no caja negativa, lib `cajaSaldo.ts`). **🔒 v1.75.0 (migs 216-217-218 DEV+PROD): RLS por sucursal a nivel servidor — #8 CERRADO.** Sesión 2026-06-15/16: v1.66→v1.71 (UX + auditoría básico + costuras + click-through GO), **v1.72.0** (NC fiscal PDF · rol Lector · roles custom→Pro · fix sucursal reingreso · fix NC tipo · auto-A/B/C Exento · 3 guards fiscales), **v1.73.0** (issue #10 sucursal default oculta + #10b consolidar reingreso · roles · #7 cron sweeps) y **v1.74.0** (🔴 **auditoría efectivo↔caja**: el egreso de devolución en efectivo no se asentaba — fix + se auditaron despacho/reserva/saldo/cancelación: todo asiento de efectivo ahora es awaited + fallback a caja única + aviso si falla).

**UAT modo básico (NUEVO, v1.76.0):** `tests/specs/uat-modo-basico.md` — checklist de aceptación exhaustiva (~300 escenarios: happy + borde + excepción) de TODA la superficie del básico (operativo + admin + integraciones + AFIP). Tiene los **resultados de auditoría capa código** (pases 1 y 2) con los hallazgos y fixes. Es el guion para la próxima auditoría / click-through. **Pendiente: capa C (click-through manual)** de las áreas que quedaron sin verificar por código (PDFs/impresión, config UI, integraciones, i18n, concurrencia real, PWA). El plan técnico previo (`auditoria-basico.plan.md`) sigue válido como complemento.

**Pendientes / próxima sesión:**
- **✅ #8 RLS por sucursal — CERRADO (v1.75.0).** Aislamiento movido del cliente al servidor en 23 tablas (migs 216-217-218). Tablas globales (clientes/proveedores/catálogo/config) y finanzas/tesorería se dejaron tenant-only a propósito. Pendiente menor opcional (tanda 4): hijas de 2 saltos (`devolucion_items`) y tablas cross-sucursal (`caja_traspasos`, `traslado_items`). Ver [[feedback_aislamiento_sucursal]].
- **GO retesteando en PROD (v1.74.1):** devolución/venta en efectivo → que el egreso/ingreso aparezca en caja (bug #26 arreglado); NC fiscal PDF/imprimir/email; rol Lector; en básico el selector de sucursal oculto + Super Usuario no aparece en invitar; **Alertas: el badge y la página deben coincidir** (fantasma "sin categoría" arreglado en v1.74.1).
- **Backlog sin tocar:** AFIP **producción real** (operativo de GO: cert prod + token prod + toggle — ver [[project_afip_produccion]]) · EN6 couriers (bloqueado B2B) · comprobantes percepciones+USD (sale-time, contra caso real) · pase de performance DB (646 lints) · consolidación de líneas también en ingresos manuales (hoy solo reingresos) · básico con >1 sucursal mantiene selector (edge raro).
- **✅ Cerrados esta sesión:** v1.72 (NC fiscal PDF + rol Lector + roles custom→Pro + fix NC tipo AFIP 10040 + A/B/C Exento + 3 guards fiscales) · v1.73 (#10 sucursal default oculta + #10b consolidar reingreso + #7 cron sweeps + roles) · v1.74.0 (auditoría efectivo↔caja: el efectivo de devolución/venta siempre se asienta) · **v1.74.1 (fix alerta fantasma "sin categoría" en básico — scoping de sucursal mode-aware vía `inventario_lineas.sucursal_id`; + reconciliación DEV de 1 línea de devolución con sucursal NULL que daba "11/12 disponible" en Kiosko).**

### ✅ EN PROD: v1.76.0 (2026-06-16, PR #220, **SIN migración**, release latest) — 🧪 Auditoría UAT modo básico: 7 bugfixes de plata/stock

Se construyó el **UAT exhaustivo de modo básico** (`tests/specs/uat-modo-basico.md`, ~300 escenarios) y se **auditó por código** (capa A) los flujos 🔴. Lo previamente roto (devolución/NC) quedó confirmado OK; se encontraron y repararon **7 bugs nuevos**:

- **DEV-07** 🔴 — **re-devolución sin tope**: el cap era la cantidad *vendida*, no `vendido − ya_devuelto` → en parciales se podía re-devolver hasta el total en cada vuelta (reingreso/reembolso de más). Fix: cap en UI (`abrir`) + **guard server-side** en `procesarDevolucion` + "nada para devolver" si está completa.
- **DEV-04** 🔴 — **devolución vs deuda CC** (regla GO): cliente **con deuda** → la devolución la **reduce** (FIFO sobre sus ventas CC, sin egreso de efectivo); **sin deuda** → efectivo/otro medio/**crédito a favor** (`cliente_creditos`, origen `devolucion`). Banner en el modal + opción "Crédito a favor" + guards (no efectivo a deudor, crédito exige cliente).
- **GAS-01/05** 🔴 — el egreso de **gasto en efectivo** era `.then()` fire-and-forget + se salteaba en silencio sin caja (clase bug #26). Fix: **awaited + toast si falla + aviso si no hay caja** (alta + gasto fijo).
- **VEN-22** ⚠️ — doble-submit del POS sin guard síncrono → `savingRef` en `registrarVenta`.
- **CONTADOR** ⚠️ — Facturación era `ownerOnly` sin `contadorVisible` → el CONTADOR no la veía pese a su rol. Fix: `contadorVisible: true`.
- **PRES-08** 🔴 — convertir presupuesto/reserva → reservada/despachada (`cambiarEstado`) **no re-validaba stock** (a diferencia del POS): rebajaba/reservaba parcial sin avisar. Fix: pre-check (disponible estado-aware: la reserva ya retuvo sus unidades) + post-check `restante > 0` → lanza error.
- **CAJ-18** 🔴 — **no se permite caja en negativo**: gasto y devolución en efectivo se **bloquean si superan el saldo** de la sesión. Lib nueva `src/lib/cajaSaldo.ts` (`calcularSaldoEfectivo` puro + `saldoEfectivoSesion`), **7 unit tests**. (Caja no tiene egreso manual — los egresos van por Gastos/traspaso/devolución; el traspaso ya estaba guardado.)

typecheck + **746 unit** (+7 cajaSaldo) + build verdes. Sin migración → sin cambios en Supabase ni EFs. **Pendiente: capa C (click-through)** de PDFs/impresión/config/integraciones/i18n/concurrencia + auditar el batch ampliado del UAT (§25-28).

### ✅ EN PROD: v1.75.0 (2026-06-16, **migs 216-217-218** DEV+PROD, release latest) — 🔒 RLS por sucursal a nivel servidor (#8 cerrado)

Hasta v1.74.1 la RLS filtraba **solo por `tenant_id`**; el aislamiento por sucursal era 100% client-side (triple blindaje en `authStore`) → un usuario con credenciales podía leer otra sucursal del mismo tenant por API directa. Ahora **23 tablas** filtran por sucursal en la DB.

- **Helpers (mig 216, STABLE SECURITY DEFINER):** `auth_ve_todas_sucursales()` espeja EXACTAMENTE `authStore.puedeVerTodas` (DUEÑO siempre; SUPERVISOR/SUPER_USUARIO/**VIEWER** global salvo `puede_ver_todas=false`; resto solo si `=true`) — el wiki listaba mal los roles globales (faltaba VIEWER); se verificó contra `src/store/authStore.ts:92-95`. `auth_user_sucursal()` = la sucursal del usuario. **Punto crítico:** si el helper no replicara el front, un DUEÑO/SUPERVISOR con `puede_ver_todas=false` + `sucursal_id` NULL quedaría viendo NADA.
- **Patrón:** `tenant = get_user_tenant_id() AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )`. **Filas `sucursal_id` NULL → visibles para todos** (invariante: bóveda/Caja Fuerte es tenant-wide; legacy ya backfilleado). **`WITH CHECK` tenant-only** (no rompe escrituras cross-sucursal: traslados escriben en ambas sucursales, triggers generan filas).
- **mig 216 (tanda 1, core):** ventas, caja_sesiones, gastos, inventario_lineas, movimientos_stock (SELECT; INSERT append-only queda tenant-only).
- **mig 217 (tanda 2, operativas):** envios, ordenes_compra, recepciones, recursos, cajas, inventario_conteos.
- **mig 218 (tanda 3, hijas sin `sucursal_id`):** scopean vía el padre (`EXISTS`/`IN` de 1 salto). Con `tenant_id`: venta_items/series/despachos/auditoria, devoluciones (solo SELECT), caja_movimientos, caja_arqueos, envio_items, inventario_series. **Sin `tenant_id` (scopean 100% por padre):** orden_compra_items, recepcion_items, inventario_conteo_items.
- **Dejadas tenant-only A PROPÓSITO:** catálogo/config (clientes, proveedores, combos, credenciales integración, ubicaciones, producto_*_sucursal, puntos_venta_afip, gastos_fijos), finanzas/tesorería (cheques, proveedor_cc_movimientos, autorizaciones_cc/gasto, devoluciones_proveedor, courier_*), integración (ventas_externas_logs, integration_job_queue), dominio RRHH role-gated, y las que cruzan sucursales por diseño (caja_traspasos doble sesión, traslado_items origen+destino). Pendiente tanda 4 opcional: devolucion_items (2 saltos).
- **Validación:** DEV impersonando (`SET LOCAL ROLE authenticated` + `request.jwt.claims`) cajero1/Cajero2/SUPERVISOR-restringido/DUEÑO contra ground-truth independiente → **coincidencia exacta**, lectura + escritura cruzada (UPDATE de otra sucursal = 0 filas). **PROD: fix de dato previo** — el CAJERO activo `nicolas.otranto86` (tenant Familia Otranto De Porto) estaba restringido **sin sucursal** → con la RLS hubiera quedado sin acceso; se le asignó Casa Huechuraba antes del deploy. Smoke PROD OK (Nico ve solo su sucursal=7 ventas, DUEÑO ve todo=22). **Lección:** todo usuario activo con `puede_ver_todas=false` + `sucursal_id` NULL queda sin acceso bajo la RLS → chequear/backfillear antes de aplicar en cada tenant. 739 unit + build verdes; sin cambios de frontend (solo `APP_VERSION`).
- `schema_full.sql` actualizado para las policies presentes en forma completa; las tablas agregadas por migraciones tardías (no están en el snapshot parcial) se documentan apuntando a su migración.

### ✅ EN PROD: v1.74.1 (2026-06-16, sin migración, release latest) — Fix alerta fantasma "sin categoría" en básico (badge vs página)

Bug (GO, Kiosko): el badge de **Alertas** mostraba "1" pero la página estaba vacía. Causa: el badge (`useAlertas`) cuenta *productos sin categoría* tenant-wide, pero `AlertasPage` los scopeaba por sucursal con un **`ubicaciones!inner`** → en básico (sin ubicaciones, `ubicacion_id` NULL) el INNER join borraba TODO el stock → la página nunca mostraba el producto. Fix: el scoping de sucursal es **mode-aware** — básico filtra por `inventario_lineas.sucursal_id` directo, avanzado por `ubicaciones.sucursal_id`. Ahora badge y página coinciden. **+Reconciliación DEV (no es bug de código, era data legacy):** Productos de Kiosko mostraba "11 disponible / 12 total" — 1 línea de devolución (#16) tenía `sucursal_id` NULL (venta original sin sucursal, pre-v1.73.0) → quedaba fuera del "disponible" por sucursal; backfilleada. typecheck + 739 unit + build verdes.

### ✅ EN PROD: v1.74.0 (2026-06-16, sin migración, release latest) — Auditoría efectivo↔caja: el efectivo de devolución/venta siempre se asienta

typecheck + suite unit **739** + build verdes.
- **🔴 Bug raíz (venta #26 Kiosco):** devolución en efectivo $2.000 reembolsada → **no se asentaba el egreso en caja** (la caja quedaba +2.000 sin la salida). Causa: el egreso era `void` (fire-and-forget, sin `await` ni manejo de error) → un fallo se perdía en silencio; y el modal de "Caja única" no seteaba la caja + el egreso no tenía fallback a la única caja abierta. **Reconciliado** el egreso faltante de #26 en DEV.
- **Fix + auditoría completa de flujos efectivo↔caja en Ventas** (`VentasPage`): despacho (ingreso), reserva (seña), saldo cobrado al despachar, devolución (egreso), cancelación de reserva (reintegro). Patrón unificado: **(1)** resolver caja = elegida ∥ activa ∥ **única abierta** (fallback); **(2)** insert **awaited**; **(3)** si falla, **toast** "se procesó pero el efectivo no se asentó, registralo manual" (nunca más pérdida silenciosa). Los `ingreso_informativo` (no afectan saldo) quedan best-effort.
- **Ya cubiertos antes (v1.69.0):** cobranza CC efectivo (`cobranzaCC.ts`: gate `requiereCaja` + resolver sesión + awaited) y gasto efectivo→caja. **Pendiente menor:** despacho/reserva *informativo* siguen best-effort (no afectan arqueo).

### ✅ EN PROD: v1.73.0 (2026-06-16, **mig 215** + EF `cron-sweeps` DEV+PROD, release latest) — issue #10 sucursales básico + roles + #7 cron sweeps + #10b consolidación

typecheck + suite unit **739** + build verdes.
- **Issue #10 — sucursal default oculta (Opción B):** en básico con 1 sucursal se fija esa sucursal como contexto (nunca "Todas") y **se oculta el selector** del header (`AppLayout`: `sucursalUnicaBasico` + effect de pin). Adiós al bug "el stock devuelto solo se ve en Todas". Además: **origen del ingreso** visible en el Inventario básico (cada línea muestra su `notas`: "Devolución de venta #X" / "Anulación…").
- **#10b — consolidar líneas de reingreso en básico:** Devolver/Anular ahora **suman a la línea de stock existente** del producto (misma sucursal, sin ubicación/estado/lote) en vez de crear una línea por unidad. Como el trigger de stock solo recalcula en INSERT, el merge hace **bump manual** de `stock_actual` (espeja el patrón de la rama de series). Avanzado sigue creando un LPN por línea.
- **#7 — cron sweeps externos:** **mig 215** wrappers `liberar_reservas_vencidas_all()` + `recalcular_intereses_cc_all()` (SECURITY DEFINER, solo `service_role`) + **EF `cron-sweeps`** (service_role, espeja `birthday-notifications`) + workflow **`sweeps.yml`** (diario 06:10 UTC). Cubre intereses CC + reservas vencidas (idempotentes). **Servicios recurrentes quedan asistidos** a propósito (generan gastos). Validado en DEV (RPCs corren 0/0 sin error; EF v1 ACTIVE).
- **Roles:** en básico la invitación ya no ofrece **Super Usuario** (admin técnico, reservado a avanzado) — una PyME no necesita dos "administrador". Descripciones aclaradas (Supervisor = "Encargado: operación, inventario y reportes").

### ✅ EN PROD: v1.72.0 (2026-06-16, **mig 214** DEV+PROD, release latest) — NC fiscal PDF + rol Lector + roles custom Pro + fixes fiscales

typecheck + suite unit **739** verdes + build verde.
- **NC fiscal — PDF / imprimir / email (lo que se entrega al cliente).** El ticket "NOTA DE CRÉDITO INTERNA · NO FISCAL" NO es el documento legal; el legal es la NC electrónica (CAE). Antes la NC se emitía (badge verde) pero **no había forma de imprimirla/entregarla**. Ahora el badge `NC-B #N` tiene 3 acciones (Descargar/Imprimir/Email). `facturasPDF.ts` parametrizado con `clase:'nota_credito'` (título "NOTA DE CRÉDITO", COD/QR con código AFIP de NC vía `TIPO_CBTE`); builder `buildNCPDFDataPorDevolucion` en `VentasPage` (datos en `devoluciones.nc_*`). Reusa send-email `factura_emitida`.
- **Rol fijo LECTOR (Viewer)** — solo-lectura, disponible en todos los planes. Ve operación + reportes (no administración ni flujos de mutación pesada), bloqueo de edición en TODOS los módulos vía `permisosModulo.ts` (rol-aware), allowlist de nav en `navVisibility.ts`. **Mig 214** amplía `users.rol` CHECK con `VIEWER`. Tests: navVisibility + permisosModulo. (Cierra el hueco vs. el set estándar SaaS Owner/Admin/Member/Viewer/Billing.)
- **Roles personalizados → gateados a modo avanzado (Pro+).** Antes disponibles en todos los planes; ahora en básico la sección muestra una card con candado + CTA "Ver planes" (básico = solo roles fijos). `UsuariosPage` con `useModoOperacion`.
- **🔴 Fix sucursal en reingreso** (Devolver + Anular): las líneas/movimientos de stock reingresado heredan el `sucursal_id` de la venta (antes NULL → solo visibles en "Todas"). Ver issue #10.
- **Fix ESC** del ticket de devolución/NC interna (`devComprobante`) — no se registraba en el stack → ESC cerraba el detalle de atrás. Ahora ESC cierra el modal visible.
- **🔴 Fix NC tipo (AFIP 10040)**: la NC defaulteaba a `NC-B` y dejaba elegir cualquier letra → emitir NC-B contra una **Factura C** (Kiosco monotributo) rebota con "CbtesAsoc tipo inválido". Ahora la **letra de la NC se deriva de la factura original y queda fija** (no elegible): Factura C→NC-C, B→NC-B, A→NC-A. La EF ya referenciaba bien la original; el error era el tipo de la NC. (Sin cambio en la EF.)
- **Fix auto-detección A/B/C**: `detectarTipoComprobante` no contemplaba emisor **Exento** (solo Monotributista) → un emisor Exento emitía A/B en vez de **C**. Corregido (Mono **o** Exento → C). +test FAC-TIPO-07. Vocabulario verificado: Config emisor = `RI`/`Monotributista`/`Exento`; cliente receptor = `CF`/`RI`/`Monotributista`/`Exento`. La regla A/B/C del cuadro AFIP queda cumplida y el POS ya auto-defaultea el tipo (con A bloqueada sin CUIT).
- **3 guards fiscales (sugerencias aprobadas por GO):** (1) **No habilitar facturación sin datos fiscales mínimos guardados** — el toggle de Config exige `condicion_iva_emisor` + `cuit` persistidos (un monotributista sin condición emitiría B en vez de C). (2) **Factura B ≥ umbral a consumidor final exige identificación** — el POS bloquea la emisión si total ≥ `umbral_factura_b` (~$68.305) y el cliente no tiene DNI ni CUIT (RG AFIP); aviso en el modal + botón deshabilitado + guard en `emitirFactura`. (3) **Cliente nuevo defaultea a Consumidor Final** (`FORM_VACIO.condicion_iva_receptor='CF'`; el alta queda explícita, no "Sin especificar").
- **Observación SUPERVISOR vs SUPER_USUARIO** (no resuelto): dos roles "administrador" confunden a una PyME; candidato a curar la lista de roles del básico.

---

**✅ EN PROD: v1.71.0** (2026-06-15, PR **#212**, sin migración, **EF `emitir-factura` redeploy DEV+PROD — PRD=DEV**, release latest) — **NC CbtesAsoc + ocultar Anular/Cambiar-cliente con CAE + drag-scroll tabs.** (1) **🔴 NC fallaba con AFIP 10197** → la NC exige `CbtesAsoc` (referencia a la factura original); fix EF: `CbtesAsoc:[{Tipo,PtoVta,Nro}]` (asume mismo PV). (2) Con CAE se ocultan "Anular" y "Cambiar cliente" (factura ya en AFIP a cliente fijo) → solo "Devolver". (3) **Feature drag-scroll** de tabs (`useDragScroll`) en RRHH/Gastos/Inventario.

Antes: **v1.70.0** (2026-06-15, PR **#211**, sin migración, **EF `emitir-factura` redeploy**, release latest) — **Click-through básico tanda 2: NC electrónica + ESC stack + anular factura con CAE.** (1) **🔴 Emitir NC fallaba siempre** — la EF no traía `cae` en el SELECT de la venta → la emisión de NC nunca funcionó (solo se habían probado facturas). Fix EF: `+cae, tipo_comprobante, numero_comprobante`. (2) **🔴 ESC cerraba el modal de atrás** — devolución/NC/cancelar/cambiar-cliente no se registraban en `useModalKeyboard`; ahora ESC cierra el visible. (3) **⚠️ Anular venta con CAE** pasaba a cancelada sin reversar AFIP → ahora bloquea y dirige a Devolver→NC. **Pendiente reconciliación fiscal: venta #20 de Kiosko** (Factura C con CAE anulada pre-fix). Detalle en [[project_afip_produccion]].

Antes: **v1.69.0** (2026-06-15, PR **#210**, sin migración, release latest) — **Auditoría de costuras + click-through básico: 4 bugs reparados.** (1) **Anular venta despachada no restauraba stock** (reembolsaba seña pero no reingresaba; ambos modos) → fix reingreso espejando Devolver, decisión GO "Anular restaura stock". (2) **🔴 Cobranza CC en efectivo sin caja perdía el pago** (saldaba deuda sin asentar el efectivo) → ahora exige caja ANTES de saldar (`requiereCaja`, raíz + 3 callers). (3) Devolución en básico mostraba "ubicación DEV" → sección WMS oculta. (4) Rebaje/ingreso masivo mostraba LPN/lote + preview en básico → UI WMS de MasivoModal gateada por modo. Costuras gasto→caja y servicio-recurrente→gasto auditadas OK. **Pendiente: reconciliar el pago CC huérfano de GO** (saldado sin caja, pre-fix). Detalle en [[reference_basico_stock_null_ubicacion_estado]].

Antes: **v1.68.0** (2026-06-15, PR **#209**, sin migración, release latest) — **Auditoría modo BÁSICO end-to-end + 4 bugs reparados.** Pase estático sobre la clase de bug más cara (mode-awareness del stock: en básico `inventario_lineas.ubicacion_id` Y `estado_id` son NULL — [[reference_basico_stock_null_ubicacion_estado]]). Bugs: (1) `VentasPage` reserva→despachada guardaba `stock_antes/despues=0`; (2) **`ProductosPage` mostraba "0 disponible" en TODOS los productos**; (3) `MasivoModal` rebaje masivo no encontraba stock; (4) **devolución totalmente bloqueada en básico** (exigía ubicación/estado `es_devolucion` que el seed no crea ni básico puede configurar). Plan `tests/specs/auditoria-basico.plan.md` + e2e `22_devolucion`/`23_inventario_ingreso`. typecheck + suite unit 734 verdes. **Falta: deploy + click-through manual del recorrido básico (validación definitiva, el tenant DEV de e2e está en avanzado).**

**✅ EN PROD: v1.67.0** (2026-06-15, PR **#208**, sin migración, release latest) — **Paquete UX.** (1) **Gastos**: scrollbar oculto en la barra de tabs. (2) **Alertas mode-aware**: `useAlertas` (badge sidebar) + `AlertasPage` ya no cuentan/muestran alertas WMS/compras (LPN vencidos, OC vencidas/próximas) en básico → se elimina el "1" fantasma; comunes a ambos modos = stock bajo mínimo, reservas, sin categoría, deuda CC. Ver [[reference_alertas_badge_mode_aware]]. (3) **RRHH**: layout a ancho completo (como Gastos) + tabs en una sola fila scrolleable con iconos (antes flex-wrap amontonado), `text-2xl`. (4) **Configuración**: botones "Guardar" consolidados a uno por tab (Envíos 11→1, Ventas→operativa 5→1). typecheck + build verdes.

Antes: **v1.66.0** (2026-06-15, PR **#207**, sin migración) — **`ActionMenu` replicado** a Proveedores (mata el bug `group-hover:block` de Exportar + colapsa sub-toolbar de Servicios) e Inventario (tab Agregar stock: Ingreso + menú [Masivo, ASN]). Barrido del resto: no requieren ActionMenu. Ver [[feedback_toolbar_actionmenu]].

Antes: **v1.65.0** (2026-06-14, PR **#205**, **mig 213** aplicada DEV+PROD, release latest) — **Facturas/ventas recurrentes** (plantillas). Tabla `ventas_recurrentes` (snapshot ítems + frecuencia + `proximo_at`, RLS); generación **asistida segura** → crea presupuesto 'pendiente' (no toca stock/caja). "Convertir en recurrente" desde una venta + panel con badge de vencidas. Antes: **v1.64.0** (PR #204, sin mig) — **% Dto. por línea en el presupuesto** (dato ya estaba en `venta_items.descuento`). **Backlog restante (percepciones + USD): son sale-time (POS+caja+AFIP), NO tweaks de PDF, y el cliente que migra no las necesita → construir contra caso real.**

Antes: **v1.63.0** (2026-06-14, PR **#203** `370e66e8`, **sin migración**, release latest) — **QR de pago MercadoPago en la factura con saldo pendiente.** Cierra el backlog de paridad Xubio (extra que Xubio no tiene). Reusa EF `mp-crear-link-pago` (ya en PROD) + `mercadopago_credentials`. Si la factura tiene saldo (total − monto_pagado > 0) y el tenant tiene MP conectado → QR "Pagá con MercadoPago" en el pie (`external_reference = venta_id`, `mp-webhook` concilia). Sin MP / pagada → sin QR (graceful). **🎉 PARIDAD XUBIO COMPLETA.** Antes: **v1.62.1** (PR #202, sin mig) — fix domicilio del cliente desde `cliente_domicilios` (no `clientes.direccion`).

Antes: **v1.62.0** (2026-06-14, PR **#201** `dbf94a37`, **mig 212** aplicada DEV+PROD antes del merge, release latest) — **Comprobantes: presupuesto A4 + factura completa + remito (paridad Xubio).** Mig 212 = `tenants += ingresos_brutos/inicio_actividades/cbu/alias_cbu/banco/leyenda_comprobante/sitio_web`. **Presupuesto PDF A4 nuevo** (`presupuestoPDF.ts` — antes solo ticket térmico). **Factura completa**: IIBB + Inicio Act + contacto + N° con letra + moneda + forma de pago + domicilio receptor + Cód. SKU + **Ley 27.743 (B)** + "Comprobante Autorizado" + datos bancarios + leyenda. **Remito nuevo** (`remitoPDF.ts`, no fiscal, "Recibí conforme"). Config → Facturación: sección "Datos para los comprobantes". **Único pendiente del backlog Xubio: link/QR de pago MercadoPago** (integración de pagos, deploy dedicado). Ver "▶ PARIDAD XUBIO".

Antes: **v1.61.0** (2026-06-14, PR **#200** `dca27a78`, **mig 211** aplicada DEV+PROD antes del merge, release latest) — **Logo del negocio en la factura + filename con cliente.** Fase 1 de **paridad con Xubio** (relevamiento de 3 PDFs de un cliente que migra, Maderas El Tilo RI A/B). Mig 211 = bucket `logos` (público, scopeado por tenant). Config → Facturación sube/quita logo (`tenants.logo_url`, ya existía); `facturasPDF` lo embebe arriba a la izq (canvas→dataURL, conserva aspecto, emisor se corre); filename con nombre del cliente. **Plan por fases pendiente:** v1.62.0 (datos fiscales emisor IIBB/Inicio Act + domicilio receptor + moneda + forma de pago + fecha vto + **Transparencia Fiscal Ley 27.743 en B** + desglose IVA + "Comprobante Autorizado" + letra N° + SKU), v1.63.0 (**PDF de presupuesto A4** — hoy solo ticket `window.print()`), v1.64.0 (detalle por línea: Observaciones + % Dto., amplía `venta_items` + UI POS). Ver sección "▶ PARIDAD XUBIO" abajo.

Antes: **v1.60.2** (2026-06-14, PR **#199** `82db1900`, **sin migraciones**, release latest) — **Menú "Acciones" en toolbars + bloqueo Factura A sin CUIT.** Solo frontend: (1) componente reutilizable **`ActionMenu`** (`src/components/ActionMenu.tsx`) que colapsa las acciones secundarias del header en un solo botón "⋯ Acciones" (click, no hover → arregla el dropdown de Exportar que no andaba en touch; descongestiona mobile). **Aplicado en Productos + Clientes (piloto)**; falta replicar al resto (Proveedores tiene el mismo bug de hover, Ventas/Caja/Gastos/Inventario/Envíos…). (2) **Bloqueo de Factura A** en el POS si la venta no tiene cliente con CUIT (botón A deshabilitado + aviso; degrada a B). (3) **Mensaje de error real al emitir** (lee `error.context.json()` en POS/NC/Facturación) en vez del genérico "non-2xx". typecheck + build verdes.

Antes: **v1.60.1** (2026-06-14, PR **#198** `39705d38`, **sin migraciones**, release latest) — **Autocompletar email de factura + layout PDF.** Mejoras de UX sobre facturación (solo frontend): (1) **Enviar factura por email** ahora abre un **modal con el `clientes.email` precargado y editable** (antes `window.prompt`), tanto en **Ventas** (modal post-emisión + detalle/historial) como en el módulo **Facturación**. (2) **PDF de factura**: el bloque "FACTURA / N° / Fecha" pasa a estar **alineado al margen derecho** (`facturasPDF.ts`), antes quedaba pegado al recuadro central del tipo. typecheck + build verdes, `facturacion.test.ts` 28/28. (Nota: el reporte de GO de "botones que no hacen nada" era el SW sirviendo el bundle viejo; el fix real ya estaba en v1.60.0.)

Antes: **v1.60.0** (2026-06-14, PR **#197** `427a03c4`, mig **210** + EF `emitir-factura` **v8** aplicadas en PROD antes del merge, release latest) — **Facturación AFIP production-ready (validada emitiendo CAE real en homologación) + paquete UX/bugfixes.** Los 4 tenants de PROD quedaron en `afip_produccion=false` (homologación, cero impacto). Además de lo de abajo: **cert propio por-tenant cableado a la EF** (lee `.crt`/`.key` del bucket → AfipSDK; modelo final = AfipSDK cloud + cert del tenant), **fix Factura C** (sin IVA en EF + PDF), **fix `tipo_comprobante` "Factura C"→"C"**, **fix 400** (`venta_items.descripcion` inexistente rompía descargar/imprimir/email), **auto-facturada** al emitir, **acciones post-venta** (descargar/imprimir/email con PDF en POS+detalle+historial), **botón "Emitir factura"** en detalle si se saltó el prompt, **visual PDF** (recuadro+wrap), **recuperación de chunk viejo** (vite:preloadError + ErrorBoundary "reading 'default'"), **ESC cierra el modal de arriba primero** (stack en useModalKeyboard +5 tests), **Alertas WMS ocultas en básico** (sin ubicación/proveedor). EF **v8**, suite **734**. Verificado: Factura C real homologación ×3 (Node + app + e2e mutante). Ver log 2026-06-14. — Antes (mismo v1.60.0): **modo producción por-tenant + tests + fix ImpTotal.** "AFIP a PROD" (preparar el camino para el primer cliente que facture). El módulo ya estaba en PROD pero operaba contra **homologación**; esta versión habilita el pase a **producción real** de forma segura: (1) **mig 210** `tenants.afip_produccion` (default false → homologación; todos los tenants existentes sin cambio); la EF `emitir-factura` decide homologación↔producción **por-tenant** (antes env var GLOBAL `AFIP_PRODUCTION` que prendía a todos), con `AFIP_FORCE_HOMOLOGACION` como freno global; toggle owner-only en Config→Facturación con confirmación + guards. (2) **Fix anti error AFIP 10048**: `ImpTotal = ImpNeto + ImpIVA` (no `ventas.total`). (3) **Tests**: `src/lib/facturacionLogic.ts` + **25 unit** (suite 701→**726**); refactor `facturasPDF`/`VentasPage`. (4) Runbook + decisión **AfipSDK cloud vs self-host** en `wiki/features/facturacion-afip.md`. **EF v5 en DEV.** ⏳ Falta: deploy a PROD (mig aditiva default false = cero impacto) + operativo de GO (CUIT activo + cert + token AfipSDK prod) + smoke real. Ver sección "▶ AFIP A PRODUCCIÓN" abajo.

Último release: **v1.59.4** ✅ EN PROD (2026-06-13, PR **#196**, UI-only, `dev=main` `6d76cd92`) — **`$/km` editable en el envío del POS** (en básico no hay Config→Envíos para la tarifa por km → el modo "Por KM" quedaba inusable; ahora el `$/km` es input editable, pre-cargado si hay tarifa o vacío si no, y el costo km×$/km se recalcula solo; modo "$ Monto fijo" sigue como alternativa). Antes hoy: **v1.59.3** (PR #195, UI-only) — **UX Inventario** (alineación columna Cantidad [regresión de v1.59.1] · ESC cierra modal de detalle de movimiento · autoFocus en búsqueda SKU del modal de ingreso/rebaje). Antes hoy: **v1.59.2** (PR #194) — **FIX del bloqueo REAL de venta en básico: el ESTADO** (stock básico tiene `estado_id=NULL`; el cálculo de stock disponible filtraba `es_disponible_venta` → bloqueaba en `agregarProducto`; fix: filtro de estado solo en avanzado). **v1.59.1** (PR #193) — fix venta básico parte 1 (ubicación, `soloUbicado`) + recortes Inventario básico (modal detalle sin Estado/LPN · tab Autorizaciones oculto · grilla sin Lote/Venc./Series) + e2e mutante de ciclo de caja. **⚠ Regla:** el stock de básico tiene `ubicacion_id` Y `estado_id` NULL → queries de venta/stock deben ser mode-aware (ver sección de estado abajo).

Antes: **v1.59.0** ✅ EN PROD (2026-06-13, PR **#191**, migs **208**+**209** aplicadas en PROD, `dev=main`) — **Auditoría pre-primer-cliente, tandas 1+2**. Recortes básico (UI): Productos→**Estructura** y Config→Conectividad→sub-tab **API** ocultos (se mantiene Integraciones TN/MeLi/MP). Seguridad (mig 208): policy SELECT en `planes`, `search_path=public` en 25 funciones, `REVOKE FROM PUBLIC`+re-GRANT en SECURITY DEFINER no públicas (períodos, sweeps CC, clave maestra anti-fuerza-bruta, seeds) → search_path 25→0, rls_no_policy 1→0, anon SECURITY DEFINER 29→15 (resto por diseño). Seguridad (mig 209): buckets `avatares`/`productos` con SELECT scopeado a la propia carpeta → `public_bucket_allows_listing` 2→0. Salud: react-router-dom 6.30.4 (open-redirect). Testing: **701 unit + 158 e2e**, primer e2e MUTANTE real de venta (POS→cobro→caja). Decisiones won't-fix/diferido: pg_net (no relocatable), RLS por sucursal (0 exposición hoy), leaked-password (toggle de Auth de GO). Detalle en "AUDITORÍA PRE-PRIMER CLIENTE" abajo.

Antes: **v1.58.0** ✅ EN PROD (2026-06-13, PR #190, UI-only). Antes: **v1.57.0** ✅ EN PROD (2026-06-13, PR #189, mig **207**, `dev=main`) — **deploy del modo Básico/Avanzado (WMS) completo (v1.55.0→v1.57.0) + auditoría de roles**. Los 4 tenants de PROD quedaron en `avanzado` (cero impacto visual). v1.57.0 = **Modo básico "mínimo mostrador" + auditoría de roles** (sin migración propia). El básico ahora oculta también Recursos/Biblioteca (empresariales) + Facturación (solo si habilitada) + Sucursales (solo si >1) → básico típico = 12 módulos. Visibilidad de nav extraída a `src/lib/navVisibility.ts` (pura) + matriz rol×modo en tests; **2 bugs de roles corregidos** (`supervisorOnly` ocultaba Recepciones a DEPOSITO e Historial a CONTADOR). **Gap cerrado:** rol custom `'ver'` ya no muta (helper `permisosModulo.ts` en Ventas/Caja/Inventario/Productos/Gastos/Clientes). e2e nuevos DEPOSITO (17) + CONTADOR (18) gated por env. Suite unit **701**. **Pendiente de GO:** crear usuarios de prueba DEPOSITO+CONTADOR en DEV para correr esos e2e. — Antes: **v1.56.0** EN DEV (**Modo de operación Básico vs Avanzado (WMS) — COMPLETO F1+F2+F3**, pendiente solo deploy a PROD). **F1 (v1.55.0, mig 207):** `tenants.modo_operacion` (existentes → avanzado, nuevos → básico); **básico** = default en todos los planes, mostrador simple sin LPN/lotes/series/vencimientos/ubicaciones/OC/envíos/historial; **avanzado** = sistema completo, toggle DUEÑO en Config → Negocio gateado a plan **Pro+** (feature `wms`, el trial lo prueba); **el modo gatea UI, nunca datos** (ledger sigue grado WMS; productos heredados con tracking conservan flujo); kill-switch `MODO_BASICO_ENABLED`; lib `modoOperacion.ts` + `useModoOperacion` (+14 tests → suite unit **679**); gating de nav/rutas + Config + Productos + Inventario. **F2+F3 (v1.56.0, sin mig):** POS sin picker LPN ni cotización courier · Proveedores sin tab OC ni comparar presupuestos · Config sin tab Envíos / Inventario solo categorías-motivos-unidades / Gastos sin gobierno OC · Dashboard sin chip Envíos + **banner de sugerencia de modo avanzado por rubro** (descartable, `sugiereModoAvanzado`). **Pendiente: deploy a PROD** (aplicar mig 207 ANTES del merge dev→main — deja PROD en avanzado, cero impacto) + e2e smoke del modo básico (menor). Detalle: `wiki/features/modo-basico-avanzado.md`).

Último release en PROD: **v1.54.0** ✅ (**Cheques conectados al circuito de pago** — pagar OC/gasto con "Cheque" crea el cheque vinculado + rechazado revierte el pago y la deuda reaparece en CC proveedor; mig **206**, suite unit **665**, PR #186; cierra ítems #5 y #6 de la auditoría). Antes: v1.53.0 (**Traslados entre sucursales** — tránsito + confirmación, mig 205, PR #184, ítem #4). Antes: v1.52.0 (**Auditoría de procesos — quick wins 1+2+3**: cobranza CC impacta caja + anular venta cancela envíos pendientes + CTA devolución desde envío devuelto; sin migración, PR #182). Antes: v1.51.1 (**Testing e2e** — suite e2e reparada + gobernanza caja, `vitest fileParallelism:false`, sin migraciones, suite unit 625 / e2e 129, PR #180). Antes: v1.51.0 (RRHH diferidos: tardanza + fichado QR + portal, mig 204), v1.50.0 (Caja A-M completo, mig 203), v1.49.0 (courier probar/logging). 🎉 **RRHH 2.0 (RH1-RH8) COMPLETO** en v1.48.0 (mig 201-202). Antes en PROD: v1.47.0 (RRHH RH4+RH5, mig 199-200), v1.46.0 (RRHH RH1+RH2+RH3+RH6, mig 195-198), v1.45.0 (Envíos EN7, mig 194). Antes: v1.43.0 EN4 tarifas (mig 192), v1.42.0 EN3 reparto (mig 191), v1.41.0 EN2 POD (mig 190), v1.40.0 EN1 (mig 189), v1.39.0 Compras CO8 (🎉 Compras 2.0 COMPLETO). **Relevamiento Envíos → EN1-EN5 ✅ en PROD + EN7 ✅ en DEV; solo falta EN6 (integraciones courier, BLOQUEADO por adapters B2B sin cuentas reales).** Historial Conteos/Compras 1-4 abajo. — v1.30.0 (**Conteos 2.0 · cierre 100% — F2b-ref + F3b + A2**, mig 181). **F2b-ref (E3):** escanear durante el conteo un producto fuera de alcance con stock → lo agrega como fila "fuera de alcance" (mercadería mal ubicada); sin stock → aviso hacia Ingreso. **F3b:** snapshot de costo por ítem (`costo_snapshot`, valorización estable al continuar borradores) + **doble conteo formal** (filas sobre umbral exigen re-ingreso vía columna "Recontar"; saltable con **clave maestra** SUPERVISOR/DUEÑO; persiste `cantidad_reconteo`+`reconteo_por`; el ajuste usa el valor recontado). **A2:** toggle `tenants.conteo_wall_to_wall_bloquea` (default OFF) — conteo de sucursal completa con confirmación de DUEÑO bloquea ventas (reserva/despacho) y movimientos hasta cerrarlo (hook `useConteoBloqueante`, badge "Bloqueante", se libera al finalizar/eliminar). **Conteos 2.0 cerrado (F1-F4 + refinamientos).** Antes: v1.29.0 (**Conteos 2.0 · F2b + F4 — cierre del módulo**. **F2b scan-to-count**: botón "Escanear para contar" = cámara persistente que suma a la fila del producto (cantidad del AI GS1 si viene, si no +1; reusa `resolverScanCompuesto`). **F4**: clase **ABC** (`productos.clase_abc` auto Pareto 80/95 por valor de movimiento 12m + override manual `clase_abc_manual`), **conteo cíclico sugerido** (`tenants.conteo_ciclico_dias_a/b/c`, panel "Conviene contar"), **reportes de exactitud + valorización** ($ faltante/sobrante/neto) por conteo y acumulado + export Excel, **trazabilidad por operador** (`inventario_conteo_items.contado_por` + `productos.ultimo_conteo_at`). Lógica pura en `conteoAbc.ts` (+16 tests → suite **362**). Mig **180** (aditiva). Antes: v1.27.0 (Conteos F3 gate+autorizaciones+delta, mig 179). v1.26.0 (F2a modos+ciego+unidad+secuencia, mig 178). v1.25.0 (F1 scope, mig 177). v1.24.0 (Clientes C6+D4).

**Historial Clientes:** v1.19.0 (CL1+CL2), v1.20.0 (CL3 + bugfix origen), v1.23.0 (CL4+CL5+CL6), v1.23.1 (QA/tests CC + agentes).

**Subagentes** (`.claude/agents/`): relevamiento, spec-extractor, test-author, test-runner, migration-reviewer, code-reviewer, bug-fixer, deploy-runner, wiki-keeper. Ver `G360.Wiki/wiki/development/agentes-claude-code.md`.

**Testing — estado (v1.23.2):** pipeline de QA extendido a **Caja** (`cajaArqueo.ts` + matriz `cajaPermisos`, 57 tests), **Inventario** (`unidades.ts`, 17 tests) y **Ventas** (descuento combo + `puedeVerCosto` G4 + `umbralGasto`, 27 tests). Planes en `tests/specs/{caja,inventario,ventas}.plan.md`. **Suite total: 329 unit tests verdes.** Pendiente futuro: convertir los planes e2e a tests Playwright reales (los `.plan.md` listan escenarios e2e fuera del alcance unit: apertura de caja ajena A2, multi-sesión CAJERO B2, validación de clave maestra real, propagación de traspaso end-to-end).

**Backlog diferido Clientes:** ~~C6 segmentación+export~~ ✅ y ~~D4 UI de NC manual~~ ✅ (v1.24.0). Quedan: B7 tope deuda global (vos: "no necesario aún, revisar en 3-6 meses"), F2 fidelización puntos (feature grande, requiere relevamiento), C3 envío background (bloqueado: pg_cron no habilitado), cobranza CC con impacto en arqueo.

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV / PROD — sesión 2026-06-13 (modo básico/avanzado COMPLETO en PROD)

| | DEV | PROD |
|---|---|---|
| APP_VERSION | `v1.71.0` ✅ (suite 734) | `v1.71.0` ✅ |
| Migrations | 001–**213** ✅ | 001–**213** ✅ |
| Branch | `dev` (= `main` salvo doc de cierre) | `main` (release v1.71.0, PR #212) |
| Vercel | preview auto desde `dev` | PROD deploy v1.71.0 (auto desde `main`) |
| Edge Function `emitir-factura` | **v8** (por-tenant + cert bucket + Factura C + ImpTotal + auto-facturada) ✅ | **v8** ✅ (deployada en PROD) |
| Edge Function `courier-api` | con logging + `probar` ✅ | con logging + `probar` ✅ |

**Migrations DEV pendientes de aplicar en PROD:** ninguna (001–**212** ya en PROD). **EF `emitir-factura` v8 ✅ en PROD.** Cadena reciente:
- **v1.62.0** (PR #201, **mig 212** datos del emisor): **presupuesto PDF A4** (nuevo, antes solo ticket) + **factura completa** (IIBB/Inicio Act/contacto + N° con letra + moneda + forma de pago + domicilio receptor + Cód. SKU + **Ley 27.743 B** + Comprobante Autorizado + datos bancarios + leyenda) + **remito** (nuevo, no fiscal). Config → "Datos para los comprobantes".
- **v1.61.0** (PR #200, **mig 211** bucket `logos`): **logo del negocio en la factura** (Config sube → `tenants.logo_url` → `facturasPDF` lo embebe) + **filename con nombre del cliente**. Fase 1 de paridad Xubio.
- **v1.60.2** (PR #199, sin mig): **`ActionMenu`** (botón "⋯ Acciones" colapsando acciones secundarias del header — click no hover, mobile-friendly; aplicado en Productos + Clientes, falta el resto) + **bloqueo Factura A sin CUIT** en el POS + **mensaje de error real al emitir** (lee `error.context.json()`).
  - **[2026-06-15, en DEV] `ActionMenu` replicado:** **Proveedores** (mata el bug `group-hover:block` de Exportar JSON/CSV + colapsa sub-toolbar de tab Servicios) e **Inventario** (tab Agregar stock: Ingreso + menú [Masivo, ASN]). Barrido del resto: no necesitan ActionMenu (headers de 1 botón o toolbars de filtros/formatos — Reportes deja sus 3 botones de formato Excel/PDF/CSV). Detalle en [[feedback_toolbar_actionmenu]].
- **v1.60.1** (PR #198, sin mig): **autocompletar email de factura** (modal con `clientes.email` precargado en Ventas + Facturación, reemplaza `window.prompt`) + **layout PDF** (bloque "FACTURA / N°" alineado al margen derecho).
Cadena del día previo (v1.59.x ya en PROD):
- **v1.59.4** (PR #196, UI-only): **`$/km` editable en el envío del POS** — en básico no hay Config→Envíos para cargar la tarifa por km, así que el modo "Por KM" quedaba inusable (campo read-only "—"). Ahora el `$/km` es input editable (pre-cargado si hay tarifa, vacío si no); costo km×$/km se recalcula solo. Modo "$ Monto fijo" sigue como alternativa.
- **v1.59.3** (PR #195, UI-only): UX Inventario — alineación columna Cantidad (regresión de v1.59.1), ESC cierra modal de detalle, autoFocus en búsqueda SKU del modal de ingreso/rebaje (Enter ya lo abría).
- **v1.59.2** (PR #194, UI-only): **FIX del bloqueo REAL de venta en básico = ESTADO**. Stock básico tiene `estado_id=NULL`; el cálculo de stock disponible filtraba por `es_disponible_venta` → bloqueaba en `agregarProducto`. Fix: filtro de estado solo en avanzado. (v1.59.1 había arreglado la ubicación pero no era suficiente.)
- **v1.59.1** (PR #193, UI-only): fix venta básico parte 1 (ubicación, `soloUbicado`) + recortes Inventario básico (modal detalle sin Estado/LPN, tab Autorizaciones oculto, grilla sin Lote/Venc./Series) + e2e mutante de ciclo de caja.
- **v1.59.0** (PR #191, migs 208/209): recortes modo básico (Estructura, Config→API) + seguridad (planes RLS, search_path 25→0, anon SECURITY DEFINER 29→15, buckets 2→0) + react-router-dom 6.30.4 + e2e mutante de venta.

### ▶ PARIDAD XUBIO (comprobantes) — relevamiento + plan por fases

**Origen:** GO pasó 3 PDFs de Xubio de un cliente que **se muda a Genesis360** (Maderas El Tilo / Madera Carrizo Hermanos SRL, **Responsable Inscripto** que emite A y B). Objetivo: que nuestros comprobantes tengan **al menos lo mismo** que Xubio.

**Gaps detectados (Xubio tiene / nosotros no):**
- 🔴 **Logo del negocio** → ✅ HECHO v1.61.0 (bucket `logos`, Config, render en factura).
- 🔴 **Ingresos Brutos** + **Inicio de Actividades** del emisor (no existen los campos) → v1.62.0 (mig nueva).
- 🔴 **Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)** en Factura B: "IVA Contenido" + "Otros impuestos nacionales indirectos". **Obligatorio desde 2025.** → v1.62.0.
- 🔴 **PDF de Presupuesto A4** (hoy solo ticket `window.print()`, no hay PDF) → v1.63.0.
- 🟡 Domicilio del receptor (el PDF lo soporta pero los builders no lo pasan), Moneda (texto), Forma de pago, Fecha Vto., **letra en el N°** (`A-0004-…` vs `0004-…`), **SKU por ítem** (Cód.), "Comprobante Autorizado" + disclaimer ARCA, desglose IVA completo (todas las alícuotas) → v1.62.0.
- 🟢 **Observaciones** y **% Dto. por línea** (requiere ampliar `venta_items` + UI del POS) → v1.64.0.
- **Filename**: incluir nombre del cliente → ✅ HECHO v1.61.0.

**Plan RE-SCOPEADO (2026-06-14, tras desafiar Xubio con GO):** no copiamos Xubio al 100%. **Se descartan:** desglose IVA con todas las alícuotas en 0 (mostrar solo las presentes), Prov. Destino (salvo Convenio Multilateral), "Fecha Vto." como campo fijo (solo si CC), Original/Duplicado/Triplicado (no aplica a electrónico). **Observaciones = a nivel documento** (campo en la venta, ej. "No incluye relleno"), **NO per-línea** (se descarta la fase per-línea cara; queda en backlog solo si lo piden). **Se SUMA lo que Xubio no tiene** (decisión GO): datos bancarios (CBU/Alias/Banco) en el pie, **link/QR de pago MercadoPago** en la factura (ya tenemos MP), leyendas + contacto (tel/email/web/redes) configurables, y **Remito/Nota de entrega** (la maderera entrega mercadería → alimentar con envíos/POD).

**Fases (re-scopeadas) — estado:**
- **v1.61.0 ✅ EN PROD:** logo del negocio + filename con cliente.
- **v1.62.0 ✅ EN PROD:** presupuesto PDF A4 (nuevo) + factura completa (IIBB/Inicio Act/contacto + N° con letra + moneda + forma de pago + domicilio receptor + Cód. SKU + **Ley 27.743 B** + Comprobante Autorizado + datos bancarios + leyenda) + **remito** (nuevo, no fiscal) + Config "Datos para los comprobantes". Observaciones = `ventas.notas` (no hizo falta migración de `ventas`). (Absorbió lo que era v1.63.0 y v1.65.0 del plan anterior.)
- **v1.63.0 ✅ EN PROD:** **QR de pago MercadoPago** en la factura con saldo pendiente (reusa EF `mp-crear-link-pago` + `mercadopago_credentials`; `external_reference = venta_id` → `mp-webhook` concilia; graceful si no hay MP). **🎉 PARIDAD XUBIO COMPLETA.**
- **v1.64.0 ✅ EN PROD:** % Dto. por línea en el presupuesto (dato ya estaba en `venta_items.descuento`).
- **v1.65.0 ✅ EN PROD (mig 213):** facturas/ventas recurrentes (plantillas + generación asistida segura → presupuesto 'pendiente').
- **Backlog restante (2 ítems, sale-time, construir contra caso real):** (a) **Percepciones**: cambia lo que paga el cliente → debe cobrarse en el POS y fluir a venta/caja/CC + `Tributos` de la EF AFIP; NO un agregado solo-PDF (descuadre). (b) **Multimoneda USD**: la venta debe estar pricada en USD (hoy ARS) + EF `MonId='DOL'`/`MonCotiz`; cross-module en el POS. **El cliente que migra (RI, ARS, no agente de percepción) no necesita ninguna** → diferidas hasta un caso real. También quedan: per-línea observaciones, percepciones de Ganancias, retenciones (son del comprador, no van en la factura del vendedor).

Cada fase deploya con su release. **Ya por delante de Xubio:** envío por email con PDF, estado de cuenta PDF, factura atada a stock/caja/CC/envíos/RRHH, CAE in-app. Patrones: upload imagen = `storage.from(bucket).upload + getPublicUrl + setTenant`; logo en PDF vía `cargarLogo` (canvas→dataURL).

**⚠ Regla aprendida (no reintroducir):** el stock de **modo básico** tiene `ubicacion_id` Y `estado_id` en **NULL** (no usa ubicaciones ni estados). Toda query de venta/disponibilidad de stock que filtre `.not('ubicacion_id','is',null)` o `.in('estado_id', es_disponible_venta)` **debe ser mode-aware** (saltar esos filtros en básico) o las ventas de básico fallan con "sin stock" pese a haber stock. Helpers en VentasPage: `soloUbicado(q)` + `if (modoAvanzado && estadosFinal…)`.

**Acciones pendientes de GO (no bloqueantes):** activar **Leaked Password Protection** en Supabase Auth (requiere plan Pro) · borrar la rama dependabot del PR #192 (Vite 8, cerrado) para frenar builds de preview fallidos.

### ▶ AFIP A PRODUCCIÓN (v1.60.0) — estado y pasos

**Decisión de GO (2026-06-13):** flag **por-tenant** + **preparar el camino** (sin emitir real todavía). El código quedó listo en DEV.

**Hecho (código, en DEV):**
- `tenants.afip_produccion` (mig 210) + EF `emitir-factura` **v7** decide por-tenant + `AFIP_FORCE_HOMOLOGACION` freno global.
- Toggle owner-only Config→Facturación (confirmación + exige CUIT/token guardados).
- Fix `ImpTotal = ImpNeto+ImpIVA` (anti error AFIP 10048).
- **Certificado propio por tenant CABLEADO:** la EF lee `.crt`/`.key` del bucket `certificados-afip` (`tenant_certificates`) y los pasa a AfipSDK por constructor (`cert`/`key`). El uploader de Config dejó de ser código muerto → es el mecanismo oficial.
- **Fix Factura C (Monotributista):** la EF NO discrimina IVA en C/NC-C (`ImpNeto=ImpTotal`, `ImpIVA=0`, sin array `Iva`) o AFIP rechaza. `calcularImportes` + tests.
- `src/lib/facturacionLogic.ts` + **28 unit tests** (suite 729). Refactor `facturasPDF`/`VentasPage`.
- Runbook + decisión de modelo en `wiki/features/facturacion-afip.md`.

**✅ Verificado el 2026-06-13:** el certificado de HOMOLOGACIÓN real de GO (CUIT **23-32031506-9**, issuer "Computadores Test") emitió **Factura C #1 → CAE 86240262256502** vía AfipSDK con `cert`+`key` por constructor (test Node `C:\Users\gasto\afip-test\test_propio.mjs`). Confirma: (1) el cert anda, (2) AfipSDK acepta cert+key directo. DEV tenant "Almacén Jorgito" (3769b1db) pre-cargado (token homol + facturación + PV nº1). **Falta:** GO sube el cert por la UI (Config→Certificados AFIP) y corre el smoke desde la app.

**Modelo = AfipSDK cloud + certificado propio del tenant (híbrido).** Responde al comentario de GO ("afip.js con .key/.crt"): cada tenant genera su cert, lo sube en Config, la EF lo usa; AfipSDK solo hace la firma WSAA (por eso anda en Deno Edge). Self-host puro (sin AfipSDK) sería proyecto dedicado.

**Para producción real falta (operativo de GO):** CUIT activo (wsfe) + **certificado de PRODUCCIÓN** (issuer real, no "Test") delegado en Administrador de Relaciones → subirlo en Config → token AfipSDK prod (plan pago) → toggle Modo de emisión a PRODUCCIÓN → smoke real.

**Cobertura de tests:** la lógica pura está cubierta (auto-tipo, IVA, Factura C, DocTipo, umbral, QR). La emisión real (WSAA+WSFE round-trip) NO se unit-testea (depende de AFIP) → smoke manual (ya verificado en homologación vía Node).

### ▶ Auditoría de procesos 2026-06-11 — hallazgos y estado

Auditoría de flujos cruzados entre módulos (verificada contra código). **Quick wins 1-3 ✅ CERRADOS en v1.52.0 (PR #182):**
1. ✅ **Cobranza CC → caja**: `cobrarDeudaCCFIFO` registra movimiento de caja en las 3 vías (ficha/POS/Caja). Efectivo → `ingreso` real; otro → `ingreso_informativo` (+cuenta origen en POS). Resolución de sesión: explícita > propia del usuario > única abierta; sin caja imputable → warning. Lógica pura `movimientoCajaCobranza` (+7 tests).
2. ✅ **Anular venta → cancela envíos `pendiente`** (en curso: no se tocan, se avisa). En el branch `cancelada` de VentasPage.
3. ✅ **Envío `devolucion` → CTA "Registrar devolución de la venta"** (`/ventas?id=X&devolver=1` reusa `abrirModalDevolucion` con plazo de canal + clave maestra).

**Backlog de auditoría — PENDIENTES (por prioridad):**
4. ✅ **Traslado de stock entre sucursales — CERRADO en v1.53.0 (mig 205, PR #184).** Tab "Traslados" en Inventario: despachar (origen, DEPOSITO+) → stock sale, "en tránsito" → confirmar recepción (destino) → entra con mismo LPN/lote/series; parciales auditados como faltante; cancelar = reingreso. Decisiones relevadas: tránsito+confirmación · por LPN/línea · DEPOSITO+ crea, destino confirma · parcial auditado. Lib `trasladoLogic.ts` (+22 tests). **Pendiente menor (futuro):** link `traslados.envio_id` al envío `traslado_interno` (columna ya reservada) para el tracking logístico del viaje.
5. ✅ **Cheques conectados — CERRADO en v1.54.0 (mig 206, PR #186).** Pagar OC/gasto con medio "Cheque" crea el cheque vinculado (`oc_id`/`gasto_id`, mini-form n°/banco/fecha de cobro obligatoria); cheque propio **rechazado revierte el pago** (OC→pendiente/parcial + ajuste en CC proveedor; gasto→pendiente/parcial). Libs `montoChequeDeMedios`/`reversionPagoOC`/`reversionPagoGasto` (+11 tests). **Pendiente menor (futuro):** cheque de tercero depositado/cobrado → impacto en cuenta de origen/bóveda (hoy solo cambia estado).
6. ✅ **EFs huérfanas — RESUELTO en v1.54.0 (hallazgo corregido):** `process-aging` **eliminada** (código muerto: ConfigPage llama la RPC `process_aging_profiles` directo). `birthday-notifications` **NO estaba huérfana** — corre por cron diario de GitHub Actions (`.github/workflows/birthday-notifications.yml`, runs OK; la auditoría no había mirado workflows). 
7. ✅ **Sweeps lazy sin cron — CERRADO en v1.73.0.** EF `cron-sweeps` (service_role) + workflow `sweeps.yml` (diario) corren `liberar_reservas_vencidas_all()` + `recalcular_intereses_cc_all()` (mig 215) para todos los tenants. **Servicios recurrentes quedan asistidos** a propósito (generan gastos; no se cronean sin revisión, igual que ventas_recurrentes).
8. 🟠 **RLS por sucursal + portal empleado**: aislamiento solo client-side (deuda conocida, re-confirmada en auditoría).
9. Conocidos ya en backlog: ISS-073 (TN→ventas completas), NC electrónica AFIP (L1), EN6 couriers (bloqueado B2B), venta física USD.
10. ✅ **Sucursales en modo BÁSICO — CERRADO en v1.73.0 (Opción B).** Síntoma original: tras devolución/anulación el stock reingresado solo se veía en "Todas" (`sucursal_id` NULL) + una línea por unidad. Resuelto: (1) v1.72.0 — reingreso hereda `sucursal_id` de la venta (4 spots) + backfill. (2) **v1.73.0 Opción B** — en básico con 1 sucursal se fija como contexto activo (nunca "Todas") y se oculta el selector (`AppLayout.sucursalUnicaBasico` + effect de pin). (3) **#10b** — reingreso consolida en la línea existente del producto (no crea una por unidad; bump manual de stock porque el trigger solo recalcula en INSERT). (4) **Origen visible** en el Inventario básico (muestra `inventario_lineas.notas`). **Pendiente menor (futuro, no bloqueante):** el caso *básico con >1 sucursal* mantiene el selector (edge raro); y la consolidación aplica a reingresos, no a los ingresos manuales (cada "Agregar stock" sigue creando su línea). Ver [[reference_basico_stock_null_ubicacion_estado]].

### ▶ Testing e2e — ✅ HECHO (v1.51.1, 2026-06-11)

**La suite e2e estaba podrida** tras ~50 versiones de evolución de UI (11 smoke tests fallando por selectores/rutas viejos). Se reparó toda la suite contra la UI real y se agregaron tests de **gobernanza** del plan `caja.plan.md`. Detalle en `G360.Wiki/wiki/development/testing.md`.
- **11 smoke reparados:** dashboard (chips de área + menú avatar), inventario (CRUD productos → `/productos`), movimientos (`/movimientos` huérfano → tabs Agregar/Quitar stock de `/inventario`), caja U2 (gate de arqueo previo), clientes (DNI/tel obligatorios + baja A6), suscripción (acceso vía avatar), coherencia (badge capea en "9+").
- **Nuevos (gobernanza caja, fuera de alcance unit):** A2 apertura "a nombre de" cajero ajeno + traspaso entre cajas (ISS-193). Defensivos (se omiten si la precondición de estado no está).
- **Unit:** `vitest fileParallelism:false` — el paralelismo agotaba la RAM (jsdom por worker) y mataba toda la suite con un error genérico; secuencial = **625 verdes** estable.
- **Verificación:** unit **625/625** · e2e **129/129** (owner+cajero+supervisor+rrhh) · build verde · sin migraciones. PR #180, release v1.51.1.

**Pendientes futuros de testing (no bloqueantes):** e2e mutante real de traspaso/cierre end-to-end (hoy defensivo), cobertura POS de visibilidad de costo G4 por rol, usuarios DEPOSITO/CONTADOR para specs de rol.

### ▶ PRÓXIMA SESIÓN — AUDITORÍA PRE-PRIMER CLIENTE 🎯

**Objetivo de GO (2026-06-13):** *"testear todo y que quede la app funcional para que la use un primer cliente."* Plan de auditoría por área, de mayor a menor criticidad. Todo lo de modo Básico/Avanzado (v1.55–v1.58) y la auditoría de roles ya están **en PROD**; arrancamos de base verde.

**A. SEGURIDAD — crítico para un cliente real.** Hallazgos de `get_advisors(security)` (2026-06-13). Remediación: https://supabase.com/docs/guides/database/database-linter

**✅ Parcialmente cerrado en v1.59.0 / mig 208 (aplicada en DEV, pendiente PROD):**
  - ✅ **RLS Enabled No Policy** (`public.planes`): era catálogo global lockeado; agregada policy SELECT pública (el front no lo lee, usa constantes en brand.ts). `1 → 0`.
  - ✅ **Function Search Path Mutable**: `SET search_path = public` en las 25 funciones. `25 → 0`.
  - ✅ **anon SECURITY DEFINER**: `29 → 15`. Gotcha clave: el EXECUTE venía del grant a **PUBLIC** (no a `anon`), así que hubo que `REVOKE FROM PUBLIC` + re-`GRANT` a `authenticated`/`service_role`. Revocadas de anon: cierre/reapertura de períodos, sweeps CC (`liberar_reservas_vencidas`/`recalcular_intereses_cc`/`fn_notificar_cc_vencidas`), `cliente_cc_estado`, `verificar_clave_maestra`/`requiere_clave_maestra` (cortar fuerza bruta de la clave maestra), y seeds/triggers (anon+auth fuera, service_role escape). **Los 15 anon restantes son por diseño:** 10 endpoints públicos token-gated (envío/fichado/cuenta-cliente) + 5 helpers de RLS (`get_user_role/tenant_id`, `is_admin/rrhh`, `get_supervisor_team_ids`) que devuelven null sin `auth.uid()` (revocarlos arriesga romper la evaluación de policies).

**✅ Follow-up de seguridad — tanda 2 (v1.59.0, mig 209):**
  - ✅ **Public Bucket Allows Listing (`avatares`, `productos`) — CERRADO (mig 209).** Las policies `*_authenticated_read` tenían qual amplio (solo `bucket_id`) → cualquier authenticated listaba archivos de TODOS los tenants. Reemplazadas por SELECT **scopeado a la propia carpeta** (avatares=`{user_id}`, productos=`{tenant_id}`). La app no lista estos buckets (solo `upload`+`getPublicUrl`, que no consulta `storage.objects`). Advisor `public_bucket_allows_listing` 2→0. Aplicada en DEV.

**🟡 Follow-up de seguridad — decisiones/pendientes:**
  - ⏭️ **`pg_net` en public — WON'T-FIX (decisión fundamentada).** Es `extrelocatable=false` → `ALTER EXTENSION SET SCHEMA` falla; moverlo exige DROP+CREATE y recrear las **7 funciones** que usan `net.http_*`. Riesgo alto para una WARN de baja severidad (higiene de naming, no vuln activa). No se toca.
  - 🟡 **Leaked Password Protection Disabled**: toggle de Supabase Auth (no es SQL) → **lo activa GO** en Authentication → Policies (chequeo HaveIBeenPwned).
  - 🟠 **`authenticated` SECURITY DEFINER (32)**: ruido esperable de una app SECURITY-DEFINER-pesada; cada RPC valida authz/tenant internamente. Auditoría por-función diferida (no bloqueante).
  - ⏭️ **#8 RLS por sucursal — DIFERIDO con fundamento.** Scoping (2026-06-13, PROD): **33 tablas** con `sucursal_id`, pero **0 tenants multi-sucursal** y **0 usuarios restringidos** (`puede_ver_todas=false` con sucursal fija) → **exposición real hoy = nula** (el RLS por tenant ya aísla; un primer cliente single-sucursal no tiene data cross-sucursal que filtrar). Implementarlo = migración de 33 tablas, riesgo de romper vistas "Todas"/traslados/reportes cross-sucursal. **Hacerlo cuando llegue el primer tenant multi-sucursal**, en tanda dedicada con diseño + tests.

**A.bis — Recortes de modo básico (✅ v1.59.0, UI-only):** auditoría sistemática de sub-pestañas que se colaban en básico. **Cortadas:** Productos → **Estructura** (jerarquía empaque unidad/caja/pallet = WMS) · Configuración → Conectividad → sub-tab **API** (API pública del marketplace; el sub-tab Integraciones TN/MeLi/MP se mantiene, decisión GO). **Verificadas OK (ya gateadas o mantenidas a propósito):** Inventario (Kits/ubicación/columnas WMS) · Proveedores (Órdenes de compra) · Config (Envíos) · Gastos (OC/Reportes-compras/Recursos) · y mantenidas: Caja Fuerte/Bóveda, Cierres, Clientes→CC, Conteos, Autorizaciones, variantes, USD. Ventas→Canales (reporte por canal) se evaluó y se **deja** (decisión GO).

**C. RECORRIDO FUNCIONAL — ✅ HECHO (v1.59.0, veredicto VERDE).** Verificado con tenant nuevo real básico ("Kiosco Buildi" en DEV) + traza de código. Seeds completos al alta (1 sucursal, Caja Principal + Bóveda, 11 motivos, 2 estados, 6 unidades, 7 canales de venta, 16 categorías de gasto, **5 métodos de pago**: Efectivo/MP/Tarjetas/Transferencia). Cargar producto: solo `nombre` obligatorio (categoría opcional). Venta en básico: sin picker de LPN → despacha por **auto-FIFO** (Fase B de `registrarVenta` cuando `lpn_fuentes` vacío), baja stock + registra despacho. Caja/Fiado/Gasto OK. **Sin bloqueantes.** Pulido opcional (no hecho): seedear categoría "General" (el dropdown arranca solo con "Sin categoría"); cuentas de origen vacías (opcional contable). **Falta el recorrido en vivo (click-through) para UX/runtime — el estático no lo cubre.**

**B. TESTING exhaustivo — ✅ EN PROGRESO (v1.59.0).**
  - ✅ Suite completa verde: `npm run test:unit` **701** + `npm run test:e2e` **158 passed** (6 roles: owner/cajero/supervisor/rrhh/deposito/contador). Sin regresiones por los cambios de la auditoría.
  - ✅ **Primer e2e MUTANTE real** (`19_flujo_venta_mutante.spec.ts`): venta directa en efectivo de punta a punta (POS→elige caja→Efectivo→despacha) que verifica la mutación (carrito se limpia ⇒ `registrarVenta` creó venta + rebajó stock + movimiento de caja, atómico). MUTA datos del tenant de prueba DEV (intencional). Gotchas resueltos: resultados de búsqueda son `<button>` en `div.absolute.top-full` (no `.cursor-pointer`); el carrito se valida con el contador "N producto" (no el heading "Agregar productos"); el `<select>` de caja es `label:has-text("Registrar en caja") + select`.
  - **Backlog de mutantes (próxima tanda):** apertura/cierre de caja end-to-end, recepción, devolución.

**C. RECORRIDO FUNCIONAL end-to-end (simular un primer cliente).**
  - Alta de tenant nuevo (onboarding) → arranca en **básico** → cargar productos → vender (POS) → caja (abrir/cobrar/cerrar) → cliente con fiado → gasto. Repetir activando **modo avanzado**.
  - Verificar seeds/defaults del alta (sucursal, caja, categorías, estados, métodos de pago) y que **nada oculto en básico rompa un flujo**.

**D. SALUD TÉCNICA — ✅ HECHO (v1.59.0).**
  - **npm audit:** eran 7 vulns (6 moderate, 1 high). ✅ **Arreglada react-router-dom 6.21→6.30.4** (open-redirect vía URL protocol-relative `//`; patch no-breaking dentro de v6; commit `d6792c4f`). **Quedan 5 (4 moderate + 1 high) dev-only en build-tooling** (esbuild high + vite/vite-plugin-pwa/vite-plugin-top-level-await/uuid moderate) — solo se arreglan con el salto **BREAKING a Vite 8**. **Diferido a propósito:** riesgo alto e impacto runtime ~nulo (el dev-server no se expone en PROD; Vite buildea estáticos). Revisar cuando se haga un upgrade mayor de tooling.
  - **`get_advisors(performance)` PROD: 646 lints** — TODOS deuda de optimización, **ninguno bloquea a un primer cliente con poco volumen** (son temas de escala): 183 `unindexed_foreign_keys`, 172 `unused_index`, 135 `auth_rls_initplan` (RLS re-evalúa `auth.uid()` por fila → fix canónico: envolver en `(SELECT auth.uid())`), 156 `multiple_permissive_policies`. **Decisión:** NO churnear 600+ cambios de schema pre-cliente (optimización prematura + riesgo de regresión). Candidato a un **pase de performance dedicado** cuando el volumen lo justifique; el más valioso sería `auth_rls_initplan` (135 policies, grande/tedioso). Logs de Edge Functions: pendiente revisar.

**E. BLOQUEANTES DE NEGOCIO (si el cliente factura).**
  - Facturación AFIP sigue en **DEV** (requiere CUIT/constitución de empresa para PROD real) · el tenant del primer cliente debe arrancar **sin datos de prueba**.

**Pendientes técnicos previos (siguen vigentes, menor prioridad que la auditoría):**
  - #7 Cron externo para sweeps lazy (infra GH Actions lista: intereses CC / reservas vencidas / servicios recurrentes / notifs CC).
  - Relevamiento Inventario/WMS (GO offline) · cuenta B2B courier para EN6.
  - Diferidos menores: link `traslados.envio_id` → envío `traslado_interno` · cheque de tercero depositado/cobrado → cuenta origen/bóveda · modo básico borderline (Conteos/variantes/USD/bóveda/cheques/cierres se dejaron a propósito, revisar si molestan al usar).

---

**✅ v1.51.0 EN PROD (2026-06-10, PR #179, `dev=main`) — RRHH diferidos cerrados (mig 204):** (1) **auto-descuento de tardanza** en nómina (`crearLiquidacion` suma fichadas de entrada vs `empleados.horario_entrada` con `minutosTardeFacturables` y descuenta según `tenants.rrhh_tardanza_modo`/`_tolerancia_min`/`_horas_mes_base`); (2) **fichado por QR público** `/fichar/:token` (`FicharPage` + `tenants.fichado_token` + RPCs anon; config QR en RRHH → Asistencia); (3) **portal del empleado** `/mi-portal` (`MiPortalPage`: recibos/vacaciones/documentos, gateado por `rrhh_portal_empleado`/`_capacidades`; nav "Mi Portal"). +7 tests → suite **625**. **No quedan diferidos de RRHH.**

**✅ v1.49.0 + v1.50.0 EN PROD (2026-06-10, PR #178, `dev=main`):**
- **v1.49.0** — courier `probar` + logging diagnóstico (sin migración). `courier-api` deployada a DEV+PROD.
- **v1.50.0** — Caja tanda final (cierra el módulo al 100%): E1 bóveda para roles custom · E3 arqueo manual de bóveda (`boveda_arqueos`) · L3 préstamo a empleado (flag + nota firmada en RRHH) · M3 panel de cajero `/caja/panel` · M4 sonido al cobrar. Mig **203** en DEV+PROD. Suite **618**. **🎉 relevamiento Caja A-M COMPLETO.**

**✅ Email saliente (Resend) — RESUELTO 2026-06-09:** el `RESEND_API_KEY` cargado como secret en Supabase era una **key vieja/inválida** (Resend respondía 401 "API key is invalid"). GO la regeneró y actualizó el secret → **correo funcionando** (confirmado: llegaron mails de Genesis). Dominio `genesis360.pro` verificado (DKIM/SPF). El front muestra el error real de Resend si vuelve a fallar (fix en `enviarOCEmail` + ticket de venta). Aprendizaje: ante "Edge Function non-2xx" en `send-email`, revisar primero la validez del `RESEND_API_KEY` en el secret de Supabase.

**ISS-174 — cotización/generación de envíos por API (v1.14.0, PROD):**
- **F1 (fundación)** — servicio = select dependiente en POS; catálogo `src/lib/couriers/catalogo.ts`; mig 162 (`courier_credenciales` + `tenants.envio_peso_fuente`), 163 (CP idempotente), 164 (productos peso/dim); Config → Envíos (toggle peso-fuente + `CourierCredencialesPanel` owner-only); peso/dim en form de producto.
- **F2-F5 (integración API)** — Edge Function `courier-api` (cotizar/generar/tracking) con adapters **Andreani / Correo Argentino / OCA**; mig 165 (`envios.cotizacion_json/courier_orden_id/cotizado_api`); cliente `src/lib/couriers/api.ts`; cotizar en POS + Envíos, "Generar con courier" + etiqueta + "Actualizar tracking" en Envíos.
- **⚠ PENDIENTE crítico:** los adapters están escritos según docs públicas de cada courier pero **NO probados con cuentas B2B reales** (GO aún no las tiene). Al cargar credenciales reales, validar/ajustar endpoints y mapeos de cada adapter (`supabase/functions/courier-api/{andreani,correo,oca}.ts`). Fail-safe: sin credenciales la cotización muestra error claro y el alta manual sigue funcionando.

**Relevamiento Ventas E/F/G — ✅ deployado a PROD (v1.12.0/v1.13.0, histórico):**
- **G4** — costo/margen ocultos para CAJERO/DEPOSITO (`permisosCosto.ts`). Sin migración.
- **F1** — botón "Actualizar presupuesto" on-demand (la config de validez ya existía).
- **F5** (mig 159) — correlativo independiente de presupuestos `PRES-NNNN` por sucursal.
- **E6+E1** (mig 160) — seña obligatoria/mínima %, vencimiento configurable + liberación automática de stock (sweep lazy `liberar_reservas_vencidas`), config en ConfigPage → Ventas → Reservas.
- **E2 completo** (mig 160) — cancelación de reserva con penalidad % + destino devolución/crédito (`cliente_creditos`) + gate E4. **Redención**: medio de pago "Crédito a favor" en el POS (cuenta como pagado, no entra a caja, consumo negativo) + saldo a favor en ficha del cliente.
- Detalle completo y estado por ítem: `relevamiento_ventas_respuestas.md`.

- **G1/G2 completo** — POS aplica precios mayoristas por cantidad (`producto_precios_mayorista`): `precioTierEfectivo`, indicador en carrito, persiste en `venta_items`. Sin migración.
- **E3 completo** — catálogo de motivo de cancelación de reserva + observación opcional (en `ventas.notas`). Sin migración.

**Relevamiento Ventas E/F/G — COMPLETO (v1.13.0):** E1, E2, E3, E6, F1, F5, G1, G2, G3, G4, G5. Único pendiente menor: **venta física en USD / caja USD** (G5 cubre precio-en-USD cobrado en pesos; el cobro físico en dólares queda para una fase futura).

**Deployado en v1.11.2 (2026-05-30):**
- **Trazabilidad-extendida (mig 155)**: `/historial` consolida por transacción + filtro de recall por LPN/serie + export completo. Ver `reportes-metricas.md`.
- Rótulo explícito "Stock total (todas las sucursales)" en Agregar Stock/Rebaje (vista global).
- **Guard de `setSucursal`**: usuario sin `puedeVerTodas` no puede cambiar de sucursal (3ª capa de aislamiento). Ver `multi-sucursal.md` → "Aislamiento por sucursal — enforcement".

**Recalc global de `stock_actual`** ya corrido en DEV (113 prod.) y PROD (21 prod.) — 0 desfasados.

---

## Backlog — pendientes próxima sesión

### Relevamiento Clientes — plan por fases CL1-CL6 (relevado 2026-06-01, GO + socio) — ✅ COMPLETO

**🎉 Las 6 fases implementadas y deployadas a PROD** (v1.19.0 → v1.23.0). Detalle de implementación por ítem en `relevamiento_clientes_respuestas.md`. Tabla original del plan abajo (referencia histórica).

Respuestas completas y cruce con Ventas en `relevamiento_clientes_respuestas.md`. **GO pidió implementar TODO (sin Top 3).** Varios ítems de CC clientes comparten definición con Ventas sección D (respondida, sin implementar — se implementa acá). **Transversal:** `pg_cron` NO habilitado → disparos por tiempo van por sweep lazy vía RPC.

| Fase | Versión | Alcance | Migrations clave |
|---|---|---|---|
| **CL1 — Fundación datos + permisos** | `v1.18.0` | A2 alerta duplicado (vs rechazo duro) · A6 soft delete + razón de baja · A5 import 3 modos + etiquetas CSV · F1 catálogo etiquetas predefinidas+libres · B2 gate habilitar CC (DUEÑO/SUPERVISOR) · H1/H2 permisos (CONTADOR read-only = Ventas J3) | `clientes.activo/motivo_baja`, catálogo etiquetas |
| **CL2 — CC: límite + vencimiento + morosidad** | `v1.19.0` | B1 enforcement configurable (enforce/avisar/permitir, default avisar) · B3 vencimiento + interés mora (sweep lazy) = Ventas D2 · B4 morosidad configurable = Ventas D6 · B5 cobranza ficha+POS+caja masiva = Ventas D5 | `clientes.limite_cc`, `tenants.limite_cc_default/cc_dias_vencimiento/cc_interes_mensual_pct/cc_morosidad_politica/cc_enforcement_politica`, `ventas.fecha_vencimiento_cc` |
| **CL3 — Incobrables + estado de cuenta** | `v1.20.0` | B6 incobrables (gasto auto "Deudores incobrables" + clave maestra DUEÑO + motivo + audit) = Ventas D7 · B8 PDF estado de cuenta + portal público con token (SECURITY DEFINER anon) | token público, categoría gasto reservada |
| **CL4 — Notificaciones al cliente** | `v1.21.0` | C1 registro deuda · C2 recordatorio pre-venc (N días + canal preferido + plantilla) · C3 aviso al vencer + cada 7d + escalado DUEÑO · C4 confirmación pago · C5 cumpleaños (saludo+cupón default ON, lista al dueño opcional). Configurable por canal, sweep lazy | `tenants.cc_notificacion_canales`, plantillas, config cumpleaños |
| **CL5 — CC proveedores** | `v1.22.0` | D2 notif venc + bloqueo · D3 PDF + reporte consolidado vencimientos · D4 NC auto al devolver + correlativo + adjunto · D5 pago parcial FIFO/manual · D6 múltiples cuentas bancarias por proveedor | `proveedor_cuentas_bancarias`, correlativo NC |
| **CL6 — Reportes, alertas, export** | `v1.23.0` | G1 top clientes + inactivos + aging 0-30/31-60/61-90/+90 + cohort + top proveedores · G2 alertas (deuda vencida, DNI sospechoso, prov CC vencida) · G3 export Excel+PDF+CSV · F4 audit log cambios cliente | — |

**Backlog diferido (no en CL1-CL6):** B7 tope deuda global (= Ventas D8) · C6 marketing bulk (solo segmentación+export) · F2 fidelización puntos · F3 descartado (precio solo por cantidad, Ventas G2) · E1-E4 "mantener como está" (E1b proveedor principal = mejora opcional barata).

> Las versiones CL son tentativas; pueden correrse por releases de bugfix intermedios. Confirmar el número real en cada deploy contra `brand.ts`.

### Features grandes (requieren relevamiento o diseño antes de implementar)

| ID | Módulo | Descripción | Complejidad |
|---|---|---|---|
| ISS-073 | TiendaNube + Ventas + Envíos + Clientes | Sincronización completa de flujo TN: la orden TN crea automáticamente venta Genesis (con `numero` = número TN para trazabilidad) + cliente nuevo con datos y domicilio si no existe + envío en estado `pendiente` con datos del comprador. Estados sincronizados bidireccional: pendiente_pago → pagada → empaquetada → despachada → entregada / devuelta. Hoy: solo rebaja stock. | Alta — webhook + estado-machine + creación multi-entidad transaccional |
| ~~ISS-127~~ | Config + Inventario + Ventas + Recepciones | ✅ **Cerrado v1.11.6** — Códigos compuestos GS1 (GS1-128 + DataMatrix + QR) leer/escribir con múltiples AIs. Ver `escaneo-barcode.md` y diseño/fases abajo. | ✅ Hecho |
| ISS-130 | Inventario + Ventas | Comandos por voz: hablarle a la app para rebajar/ingresar (SKU, cantidad, estado, ubicación, lote, fecha) y consultar ("¿qué hay en ubicación X?"). Web Speech API + parseo intenciones | Alta — UX nueva, requiere prototipo |
| ISS-137 | Config | Evaluación: integración con Google Drive como almacenamiento propio del cliente para documentos/imágenes | Requiere evaluación primero |
| ISS-CONT | Inventario → Conteos | **Conteos 2.0** — conteo cíclico / wall-to-wall **por Marca** (pedido GO 2026-06-03) + ampliar scope (categoría, toda la sucursal) + endurecer contra errores del operador (conteo a ciegas, doble conteo de discrepancias, gate de ajustes grandes, scan-to-count) manteniendo el flujo rápido actual. Detalle + fases abajo. | Media-Alta — requiere relevamiento (umbrales, autorizaciones, blind por default) |
| ~~ISS-174~~ | Ventas + Envíos | ✅ **Cerrado v1.14.0** (F1-F5) — servicio select en POS + cotización/generación por API directa (Andreani/Correo/OCA) vía Edge Function `courier-api`. Ver sección ISS-174 abajo. **Único pendiente:** validar adapters con cuentas B2B reales. | ✅ Hecho |

### ISS-CONT — Conteos 2.0 (pedido GO 2026-06-03, SIN relevar todavía)

**Pedido explícito de GO:** poder hacer un **conteo cíclico o wall-to-wall por Marca** del producto (el maestro ya tiene `productos.marca TEXT`, mig 118). Y, en general: revisar el submódulo de Conteos para que sea **fácil y rápido como hoy** pero que también ofrezca un modo **más potente y a prueba de errores del operador**.

**Cómo está hoy (código real):**
- Modelo: `inventario_conteos` (`tipo` ∈ `'ubicacion'|'producto'`, `ubicacion_id`/`producto_id`, `estado` ∈ `'borrador'|'finalizado'`, `ajuste_aplicado`, `sucursal_id`, `created_by`, `notas`) + `inventario_conteo_items` (`producto_id`, `lpn`, `cantidad_esperada`, `cantidad_contada`). Mig 050.
- Flujo (InventarioPage → tab Conteo): elegir tipo (ubicación **o** producto único) → `cargarLineasParaConteo` trae las líneas de la sucursal → editar cantidades → guardar borrador (continuable, ISS-100) o **finalizar y aplicar**: por cada fila con diferencia, pisa `inventario_lineas.cantidad` y registra `movimientos_stock` (`ajuste_ingreso`/`ajuste_rebaje`).

**Debilidades detectadas (oportunidades de mejora):**
1. 🔴 **El conteo NO es a ciegas**: la `cantidad_contada` se **precarga con la esperada** (`String(cantEsperada)`). El operador ve el número del sistema → tiende a confirmarlo sin contar de verdad (sesgo de confirmación). Es el anti-patrón clásico de conteo.
2. 🔴 **Sin reconciliación de movimientos durante el conteo**: al finalizar pisa `cantidad` con lo contado sin contemplar ventas/movimientos ocurridos entre que se cargó el esperado y se cerró (sobre todo en borradores que duran). Puede revertir ventas.
3. 🟡 **Sin filtro por Marca / Categoría / wall-to-wall**: solo ubicación o producto único. (Lo que pide GO.)
4. 🟡 **Sin doble conteo de discrepancias**: cualquier diferencia se ajusta directo; no hay reconteo (idealmente por otro operador) ante diferencias grandes.
5. 🟡 **Sin gate de autorización para ajustes grandes**: un ajuste que borra mucho stock (o mucho **$**) se aplica sin aprobación. Otros módulos (caja, incobrables) ya usan clave maestra.
6. 🟢 **Sin scan-to-count**: se cuenta tipeando (riesgo de fila/tipeo equivocado). El stack de escaneo GS1 (`gs1.ts`, `scanCompuesto.ts`, BarcodeDetector) ya existe y es reutilizable.
7. 🟢 **Sin reporte de exactitud ni valorización**: no se mide el % de exactitud del inventario ni el valor $ de la diferencia (sobrante/faltante).
8. 🟢 **Trazabilidad por operador limitada**: solo `created_by` del conteo, no quién contó/reconto cada ítem.

**Mejoras propuestas (a confirmar en relevamiento):**
- **Scope ampliado** (incluye lo pedido): `tipo` ∈ `marca` | `categoria` | `ubicacion` | `producto` | `sucursal_completa` (wall-to-wall), combinables (ej. marca X en ubicación Y). Snapshot del criterio en el conteo (`marca TEXT`, `categoria_id`).
- **Conteo a ciegas configurable**: opción de NO mostrar la esperada (arranca vacío; el sistema compara al cerrar). Toggle por tenant/por conteo. Se conserva el modo rápido actual (informed) para velocidad.
- **Doble conteo de discrepancias**: filas que superen un umbral (u o %) se marcan para **recontar** antes de aplicar; idealmente segundo operador.
- **Gate de ajuste**: ajustes que superen umbral (unidades / % / **valorización $**) requieren clave maestra o aprobación SUPERVISOR/DUEÑO.
- **Scan-to-count**: contar escaneando (reusa GS1/BarcodeDetector); el scan suma a la fila correcta → menos errores; encaja natural con el modo a ciegas.
- **Conteo cíclico programado**: plan rotativo (por marca/categoría/clase ABC — los de mayor valor más seguido); el sistema sugiere qué contar cada día (sweep lazy o lista on-demand, `pg_cron` no disponible).
- **Reconciliación de movimientos** (freeze/snapshot con timestamp) al aplicar el ajuste → no pisar ventas hechas durante el conteo.
- **Reporte de exactitud + valorización** (% exactitud, ítems con diferencia, $ sobrante/faltante) por conteo y acumulado + export. **Trazabilidad por operador** (quién contó/reconto cada ítem).
- **UX de dos velocidades** (lo que pide GO): mantener "conteo rápido" como default (elegí → contá → listo) y un "conteo guiado/avanzado" que active a ciegas + doble conteo + gate paso a paso. Que lo potente no estorbe a lo simple.

**Fases tentativas:** F1 scope por Marca/Categoría/wall-to-wall (lo pedido; migración chica: `tipo` nuevo + columnas snapshot) · F2 conteo a ciegas + scan-to-count (anti-error, alto impacto) · F3 doble conteo + gate de autorización por umbral/$ · F4 cíclico programado + reporte de exactitud/valorización + reconciliación de movimientos + trazabilidad por operador.

**✅ RELEVADO (2026-06-03, GO+socio).** Respuestas + diseño consolidado + modelo de datos + plan por fases en **`relevamiento_conteos_respuestas.md`**. Decisiones clave: scope combinable (marca/categoría/wall-to-wall) · modo configurable Rápido/Guiado(ciego)/Elegir · doble conteo con umbral combinado u/%/$ · ajustes de conteo van al **tab Autorizaciones existente** (tipo `ajuste_conteo`) · reconciliación por **delta** (no pisar `cantidad`) · nuevos campos `productos.clase_abc` (ABC auto) y `ubicaciones.secuencia` (recorrido conteo+picking) · cíclico solo sugerencia (sin cron).

**Plan por fases:** **F1 ✅ DEPLOYADO PROD (v1.25.0, mig 177)** — scope Marca/Categoría/Wall-to-wall (`inventario_conteos.tipo` ampliado + `filtros JSONB`; UI con toggle de 5 alcances + carga dinámica `productos!inner`; marcas/categorías derivadas del stock de la sucursal; scopes amplios exigen sucursal específica por aislamiento). · **F2a ✅ DEPLOYADO PROD (v1.26.0, mig 178)** — modo configurable `tenants.conteo_modo` (rapido/guiado/elegir) + conteo a ciegas (B1: input vacío, oculta esperado/diferencia; B2: revelar fila DUEÑO/SUPERVISOR) + filas en blanco (B3: `cantidad_contada` nullable, null=no contada se omite, 0=contó cero) + **input "Contado" respeta unidad** (enteros vs decimales según `esDecimal`) + `ubicaciones.secuencia` (orden recorrido conteo+picking, editable en Config). · **F2b ✅ DEPLOYADO PROD (v1.28.0→v1.29.0)** — scan-to-count: botón "Escanear para contar" abre `BarcodeScanner` persistente (nuevo prop `persistentCloseLabel`) que resuelve el código (GS1 vía `resolverScanCompuesto` con fallback barcode/SKU) y suma a la fila del producto (cantidad del AI GS1 o +1), respeta unidad entera/decimal, ref espejo `conteoRowsRef` para scans rápidos. · **F3 ✅ DEPLOYADO PROD (v1.27.0, mig 179)** — gate de aprobación (`tenants.conteo_gate_*`; gate off → todo a aprobación, on → solo > umbral u/%/$); diferencias van al tab **Autorizaciones** (`autorizaciones_inventario` tipo `ajuste_conteo`, motivo "Diferencia Conteo"); al aprobar se aplica con **reconciliación por delta** (`reconciliarDelta`); doble conteo = aviso `window.confirm` sobre umbral (`conteo_reconteo_*`). Lógica pura testeada en `src/lib/conteoAjuste.ts`. · **F4 ✅ DEPLOYADO PROD (v1.29.0, mig 180)** — **clase ABC** (`productos.clase_abc` A/B/C + `clase_abc_manual` + `ultimo_conteo_at`; recálculo client-side Pareto 80/95 por valor de movimiento 12m, respeta override; 3 updates agrupados por clase) + **conteo cíclico sugerido** (`tenants.conteo_ciclico_dias_a/b/c` default 30/90/180 editables en Config; panel "Conviene contar" con vencidos por clase + atajo "Contar") + **reportes de exactitud/valorización** (`reporteExactitud`: % exactitud + $ faltante/sobrante/neto, por conteo y acumulado + export Excel) + **trazabilidad por operador** (`contado_por` por ítem, columna en detalle). Lógica pura `src/lib/conteoAbc.ts` (`clasificarABC`, `sugerirConteoCiclico`, `reporteExactitud`) + 16 tests. · **Cierre 100% ✅ DEPLOYADO PROD (v1.30.0, mig 181):** **F2b-ref** (escanear fuera de alcance con stock → fila "fuera de alcance"; sin stock → aviso) · **F3b** (snapshot `costo_snapshot` + doble conteo formal con columna "Recontar" + clave maestra para saltar, `cantidad_reconteo`/`reconteo_por`) · **A2** (toggle `conteo_wall_to_wall_bloquea` default OFF; wall-to-wall con confirmación de DUEÑO bloquea POS reserva/despacho + ingreso/rebaje vía `useConteoBloqueante`, `inventario_conteos.bloquea_movimientos`). **🎉 Conteos 2.0 (ISS-CONT) CERRADO al 100% — F1-F4 + refinamientos en PROD.**

### ISS-127 — Códigos compuestos GS1 (diseño relevado con GO 2026-05-30)

**Objetivo:** leer y escribir códigos de barra/QR que codifican varios campos a la vez (estándar **GS1**), grado WMS. Reemplaza el scan de valor único actual (`sku`/`codigo_barras`).

**Decisiones relevadas:**
- **Estándar:** GS1 (GS1-128 1D + GS1 DataMatrix 2D), con **override no-GS1** por perfil (separador+campos propios) para proveedores que no usan GS1.
- **AIs soportados:** GTIN `(01)`, Lote `(10)`, Vencimiento `(17)`, Cantidad `(37/30)`, Serie `(21)`, Producción `(11)`, Precio `(392x)`.
- **Dirección:** leer + escribir.
- **Integración:** Ingreso de stock, Rebaje, Ventas/POS, Recepciones.
- **Lectura en ingreso:** comportamiento **configurable por perfil** (autocompletar+confirmar vs crear LPN directo).
- **Match del GTIN→producto:** `productos.gtin` dedicado **con fallback** a `codigo_barras` (ambos normalizados, ceros a la izq.).
- **Perfiles:** múltiples, **ligados a `proveedor_id`** (opcional) + override no-GS1. Como GS1 es autodescriptivo, el perfil gobierna sobre todo la **generación** (qué AIs + simbología + modo de lectura), no el parseo.
- **DataMatrix lectura:** sumar **`@zxing/library`** como fallback (zbar no decodifica DataMatrix). GS1-128 1D ya lo lee el stack actual (BarcodeDetector + zbar).
- **Generación:** desde el LPN (extiende `LpnQR`) **+ generación masiva** (ej: N etiquetas de una recepción). Requiere **`bwip-js`** (genera GS1-128 y GS1-DataMatrix con FNC1 correcto).

**Modelo de datos (propuesto):**
- **Migration A:** `codigo_perfiles` (`id, tenant_id, nombre, proveedor_id NULL, simbologia 'gs1_128'|'datamatrix', tipo 'gs1'|'custom', ais JSONB [lista de AIs a generar], custom_format JSONB {separador, campos}, lectura_modo 'autocompletar'|'directo', activo, created_at`). RLS por tenant.
- **Migration B:** `productos.gtin TEXT` (+ índice `(tenant_id, gtin)`).

**Librería `src/lib/gs1.ts` (sin deps para parse; usa la app):**
- `parseGS1(raw): { gtin?, lote?, vencimiento?, cantidad?, serie?, produccion?, precio?, _raw }` — maneja FNC1 (`\x1d`), AIs de longitud fija y variable, fecha `YYMMDD`.
- `encodeGS1(fields, ais): string` — arma el element string con AIs en orden + FNC1 donde corresponde.
- `parseCustom(raw, perfil)` / `encodeCustom(...)` para el override no-GS1.

**Fases de entrega:**
- **F1 — Fundación ✅ (en DEV, build OK):** migrations 157+158 (perfiles + `productos.gtin`) + `gs1.ts` (parse/encode testeado) + Config UI de perfiles (`CodigoPerfilesPanel` en Config → Inventario → Códigos) + generación GS1-128/DataMatrix desde LPN (`CodigoCompuestoModal` en `LpnAccionesModal`, render `bwip-js`). Pendiente deploy a PROD.
- **F2 — Lectura ingreso ✅ (PROD v1.11.5):** `looksLikeGS1` + `resolverScanCompuesto` (match GTIN→producto con fallback). Ingreso individual + masivo.
- **F3 — Cobertura completa ✅ (PROD v1.11.5):** DataMatrix lectura (`@zxing/library`) + Ventas/POS + Recepciones (scanner nuevo) + Rebaje (auto-selección lote→LPN vía `pendingRebaje`) + modo `directo` (auto-crear LPN, `directoFiredRef`) + generación masiva (`CodigoMasivoModal`).

**ISS-127 cerrado** en v1.11.5. Fixes de QA aplicados: AI cantidad 37→30, validación de GTIN con dígito sugerido, DataMatrix sin `height:undefined`, mensajes GS1 accionables.

**GS1 QR Code ✅ (v1.11.6):** agregada la 3ª simbología `qr` (`bcid: gs1qrcode`) en perfiles, generación individual y masiva. Ahora los perfiles soportan **GS1-128 + DataMatrix + QR**. (El QR simple del LPN sigue existiendo aparte vía `LpnQR`.)

**Riesgos/notas:** verificar que `bwip-js` y `@zxing/library` no reintroduzcan vulnerabilidades (correr `npm audit` post-install). DataMatrix solo lee en BarcodeDetector hasta que entre ZXing (F3). El parseo GS1 de variable-length depende de FNC1: muchos lectores 1D lo emiten como carácter GS (`\x1d`); contemplar lectores que lo omiten.

### ISS-174 — Cotización + generación de envíos por API de courier (relevado con GO 2026-05-31)

**Objetivo:** reemplazar el costo de envío manual/KM por **cotización en tiempo real** contra la API de cada courier (precio + plazo + disponibilidad por servicio, según origen/destino/peso/fecha) y, además, **generar la orden de envío** en el courier para traer **número de tracking + etiqueta PDF** automáticamente. Dos partes:
- **Parte 1 (chica, sin API):** en el POS el campo *Servicio* hoy es texto libre (`VentasPage.tsx` ~3537). Pasarlo a **select dependiente del courier** igual que en Envíos (`SERVICIOS_POR_COURIER`). Requiere extraer `COURIERS` + `SERVICIOS_POR_COURIER` de `EnviosPage.tsx` a un módulo compartido.
- **Parte 2 (grande):** integración real con APIs de courier.

**Decisiones relevadas con GO:**
- **Integración: APIs directas por courier** (no agregador). Orden por trabajo/prolijidad: **Andreani** (REST, la más limpia) → **Correo Argentino** (Mi Correo Empresas / Paq.ar, REST) → **OCA ePak** (SOAP, la más compleja). DHL fuera de alcance (solo si hacen exterior).
- **Alcance completo:** cotizar **+ generar orden/admisión + etiqueta PDF + tracking** automático.
- **Peso/dimensiones: configurable por tenant** (`tenants.envio_peso_fuente 'manual'|'producto'`). El negocio elige: peso/medidas del **bulto cargados a mano por envío** (campos `envios.peso_kg/largo/ancho/alto` ya existen) **o** tomados del **dato maestro del producto** (sumando el carrito). Config → Envíos.
- **Credenciales: por tenant.** Cada negocio carga sus credenciales de cada courier en Config. Por seguridad (secretos + CORS + SOAP) **todas las llamadas a couriers van por Edge Function** con `service_role`; el front nunca ve los secretos.
- **Dónde: ambos.** Cotizar en el **POS** (para cobrar el envío en la venta) y cotizar/generar orden+etiqueta+tracking en el módulo **Envíos**.
- **Código postal: campo estructurado nuevo** en `sucursales.codigo_postal` y `cliente_domicilios.codigo_postal` (autocompletar desde `postal_code` de Google Places cuando venga, editable). Las direcciones de texto libre no alcanzan para las APIs.
- **Tarifa:** la API devuelve lista (servicio + precio + plazo); el operador **elige uno**, ese precio se carga como costo de envío de la venta y es **editable** (override manual permitido).

**Modelo de datos (propuesto):**
- **Migration A — credenciales + config:** `courier_credenciales(id, tenant_id, courier, credenciales JSONB, activo, created_at, updated_at)` UNIQUE(tenant_id, courier). RLS: el dueño hace upsert vía RPC; **los secretos NO se devuelven al front** (solo estado "configurado" + máscara). El Edge Function los lee con service_role. `tenants.envio_peso_fuente TEXT DEFAULT 'manual'` CHECK('manual'|'producto'). Opcional `tenants.envio_cotizacion_activa BOOLEAN`.
- **Migration B — CP estructurado:** `sucursales.codigo_postal TEXT`, `cliente_domicilios.codigo_postal TEXT`.
- **Migration C — dato maestro producto:** `productos.peso_kg`, `largo_cm`, `ancho_cm`, `alto_cm DECIMAL` (nullable).
- **Migration D — metadata API en envíos:** `envios.cotizacion_json JSONB` (snapshot de la opción elegida / todas), `envios.courier_orden_id TEXT` (ID de la orden en el courier), `envios.cotizado_api BOOLEAN`. `tracking_number`, `tracking_url`, `etiqueta_url`, `costo_cotizado/real` ya existen.

**Edge Functions (Deno, router por courier):**
- `courier-cotizar` — input `{courier, origen_cp, destino_cp, peso_kg, dims, valor_declarado?}` → lee credenciales del tenant → devuelve lista normalizada `[{servicio, precio, plazo_dias, disponible}]`.
- `courier-generar` — input `{envio_id}` → crea la orden en el courier → devuelve `{tracking_number, tracking_url, etiqueta_url, courier_orden_id, costo_real}`.
- `courier-tracking` (fase posterior) — refresco de estado del envío desde el courier.
- Adapters por courier dentro del Edge Function: `andreani.ts`, `correo.ts`, `oca.ts` (este último SOAP). Capa de normalización común.

**Fases de entrega:**
- **F1 — Fundación (datos + config, sin API) ✅ (en DEV, build OK):** Parte 1 (servicio como select dependiente en POS + catálogo compartido `src/lib/couriers/catalogo.ts`). Migrations 162 (`courier_credenciales` + `envio_peso_fuente`) + 163 (CP, idempotente: ya existía) + 164 (productos peso/dim). Config → Envíos: toggle peso-fuente (manual/producto, default manual) + `CourierCredencialesPanel` (owner-only). Campos peso/dim en form de producto. `AddressAutocompleteInput` pasa `postcode` best-effort. Pendiente deploy a PROD.
- **F2-F5 — Integración API ✅ (DEV, build OK · v1.14.0):** Edge Function único **`courier-api`** (`action` = cotizar | generar | tracking) con adapters **Andreani** (F2), **Correo Argentino** (F3, Paq.ar) y **OCA** (F4, SOAP); tracking en los tres (F5). Migration **165** (`envios.cotizacion_json/courier_orden_id/cotizado_api`). Cliente front `src/lib/couriers/api.ts`. **POS**: botón "Cotizar {courier}" (CP destino + peso) → lista servicio+precio+plazo → elegir setea servicio+costo (editable). **Envíos**: "Cotizar" en el modal + "Generar con courier" / "Etiqueta" / "Actualizar tracking" en el panel del envío. Credenciales leídas SOLO server-side (service_role). **⚠ Adapters según docs públicas — pendientes de validar con credenciales B2B reales; fail-safe: sin credenciales → error claro, no rompe el alta manual.**

**Riesgos/notas:** cada API requiere contrato B2B propio del negocio (sin cuenta → no hay cotización; fallback a tarifa manual `courier_tarifas`/KM como hoy). OCA es SOAP (parseo XML en Deno). Guardar secretos por tenant exige cuidado: no exponerlos al front, considerar Supabase Vault/pgsodium o columnas con RLS de solo-escritura. El peso volumétrico (dims) suele definir la tarifa: si `envio_peso_fuente='producto'` y faltan medidas, advertir/caer a manual.

### Relevamiento Ventas H-K — plan de implementación (relevado completo 2026-06-01)

Respuestas finales en `relevamiento_ventas_respuestas.md` → sección H-K. Plan por fases (cada una deployable a PROD con su versión). Orden por dependencia/valor; **L1 (Top 3) pendiente** → reordenable.

**Estado: VF1-VF5 ✅ TODAS en PROD (2026-06-01).** VF1-VF3 v1.15.0 (mig 167-169), VF4 v1.16.0 (mig 170), VF5 v1.17.0 (sin migración). **Relevamiento Ventas A-K COMPLETO.** Pendientes futuros (fuera del relevamiento): NC electrónica AFIP (L1), venta física en USD/caja USD (G5). **L1 (Top 3) sin responder.**

**VF1 — POS operativo (H2, H3, H4, H5)** ✅ · bajo riesgo, valor diario:
- **H4** — caja: `presupuesto` se puede crear **sin caja abierta**; `reserva` y venta directa (incl. 100% CC) **exigen caja**. Revertir la excepción actual de venta 100% CC sin caja (revisar `useCierreContable`/`validarDespacho` y el gate de caja en `registrarVenta`). Posible flag config si quieren permitir presupuesto-sin-caja on/off.
- **H5** — flag **"Consumidor final" vs "Cliente registrado"** al iniciar la venta (estado del carrito). Si `facturacion activa` + no consumidor final → cliente obligatorio. Integra con Config "Cliente en el punto de venta". Sin migración (o flag en `ventas` si se quiere persistir el tipo).
- **H2** — imprimir ticket **opcional**: botones "Imprimir" + "Enviar por email" (reusar `send-email` + `formatTicket`). Config tenant para default (siempre/opcional). 
- **H3** — **reimprimir** desde el historial de Ventas (cualquier rol con acceso). Botón en el detalle de venta.

**VF2 — Canales configurables + reglas online/presencial (I1, I2)** ✅ · modelo de datos nuevo, foundational:
- **I1** — tabla `canales_venta` por tenant (CRUD en Config) con `clasificacion ('online'|'presencial')`. **Quitar "MP"** del catálogo (migrar ventas con `origen='MP'`: mantener histórico, sacar de selects). Reemplaza el array hardcodeado `CANALES`.
- **I2** — reglas por clasificación online/presencial (config): **plazo de devolución**, **descuento máximo**, **lista de precios por defecto**, **requisito de cliente/factura**. Tabla/JSON `reglas_canal` por tenant {online:{...}, presencial:{...}}. El POS/devoluciones aplican la regla según la clasificación del canal de la venta.

**VF3 — Auditoría y permisos (J1, J2, J3)** ✅ · governance:
- **J1** — **audit log detallado por venta** (diff de ítems/precio/cliente). Tabla `venta_auditoria` (o reusar `actividad_log` con payload diff) accesible desde el modal de la venta.
- **J2** — clave maestra DUEÑO para **anular venta despachada** + **cambiar cliente** + **override descuento** (extiende `tenants.clave_maestra`).
- **J3** — **CONTADOR read-only** en Ventas: nav + ruta + guard que permite ver historial/detalle/export pero bloquea crear/editar.

**VF4 — Reportes y alertas de Ventas (K1, K2, K3)** ✅ · depende de VF2 (comparativa por canal):
- **K1** — reportes: baja rotación, más devoluciones, anuladas/devueltas con motivo, comparativa por canal, **margen real por venta**. Página/sección Reportes de Ventas.
- **K2** — alertas automáticas: **margen negativo**, **cliente con >N devoluciones en M días**, **producto con >N devoluciones en M días** (umbrales config). Sweep lazy o al registrar venta/devolución → `notificaciones`.
- **K3** — export **Excel + PDF + CSV** en cada reporte (consistente con Caja).

**VF5 — Edición post-venta + NC interna (H1)** ✅ · el más delicado, toca facturación/devoluciones:
- **H1** — quitar/editar ítem libre **antes de cobrar**; **post-cobro** requiere autorización SUPERVISOR/DUEÑO; si la venta **se facturó** → **NC interna/manual** (registro + motivo + ajuste contable, sin AFIP). Integra con devoluciones y el modelo de NC. La **NC electrónica AFIP** queda como feature separada (L1).

**Dependencias clave:** VF4 (comparativa por canal) usa el modelo de VF2. VF5 se apoya en el flujo de devoluciones existente. VF1/VF3 son independientes y pueden ir primero.

### Relevamiento Compras (OC + Recepciones) — plan por fases CO1-CO8 (respondido 2026-06-05)

Respuestas A-H + diseño + modelo de datos + sugerencias completas en **`relevamiento_compras_respuestas.md`**. Plan deployable por fases:

- **CO1 — Gobierno de OC ✅ DEPLOYADO PROD (v1.31.0, mig 182):** A1 creación por rol (`comprasPermisos.capacidadCrearOC`: DUEÑO/ADMIN/SUPERVISOR completa, DEPOSITO solo borradores, CAJERO/CONTADOR sin acceso) · A2 aprobación por umbral (`ocRequiereAprobacion` + `requiere_aprobacion`/`aprobada_por`; "Aprobar y enviar" gateado por `puedeEnviarOC`) · A4 sucursal obligatoria · A5 numeración configurable (`tenants.oc_numeracion`, default sucursal, `numero_sucursal` vía trigger, etiqueta `S-OC-0001`) · D5 pago (CONTADOR read-only + doble firma por umbral con clave maestra). Config en Config → Gastos. Lib `comprasPermisos.ts` + 14 tests.
- **CO2 — Recepción robusta ✅ DEPLOYADO PROD (v1.32.0, mig 183):** **B5 arreglado** — estado de OC se recalcula desde el **acumulado de todas las recepciones confirmadas** (`recepcionLogic.estadoOCdesdeRecibido`), no solo la actual · B3 over-receipt umbral % acumulado (`superaOverReceipt`) · B4 motivo de faltante obligatorio (catálogo) + `recepcion_alerta_faltante_dias` · B1c over/under requiere SUPERVISOR+ (`esAjusteCantidad`) · B7 adjuntar remito (bucket privado `remitos` scoped por tenant, `recepcion_remito_obligatorio`) · B2 recepción sin OC exige proveedor. Lib `recepcionLogic.ts` + 13 tests → suite 393.
- **CO3 — Costos ✅ DEPLOYADO PROD (v1.33.0, mig 184):** E1 alerta de cambio de costo (`tenants.compras_costo_alerta_pct`, default 10%) + el operador decide actualizar el `precio_costo` (checkbox por línea, lib `comprasCostos.superaAlertaCosto`) · E2 costos accesorios sueltos `ordenes_compra.costo_aduana/comision/otros` · B6 editar precio en recepción con audit (`actividad_log`) · E3 alta rápida de producto en recepción (DUEÑO/SUPERVISOR, `productos.pendiente_revision`). Config en Config → Gastos. **E4-reporte de diferencias OC vs recepción → CO8.**
- **CO4 — Devolución a proveedor ✅ DEPLOYADO PROD (v1.34.0, mig 185):** C1 entidad separada `devoluciones_proveedor` + `devolucion_proveedor_items` (RLS + trigger correlativo) · desde OC recibida → "Devolver a proveedor" (ítems + cantidades, motivo catálogo C3 + obs opcional) · C2 forma `credito_cc` (nota de crédito en `proveedor_cc_movimientos`) / `efectivo` (ingreso a caja abierta) / `reposicion` (OC nueva borrador) · rebaja stock FIFO + `ajuste_rebaje` + valida disponible. Lib `devolucionProveedor.ts`. Cierra `tiene_reembolso_pendiente`. Suite 412.
- **CO5 — Pago anticipo/contra-entrega ✅ DEPLOYADO PROD (v1.35.0, mig 186):** D1 modo de pago por proveedor (`proveedores.modo_pago` contado/anticipo/contra_entrega/cuenta_corriente + `anticipo_pct`) → al elegir el proveedor en la OC se propone "paga con anticipo" + % (override por OC: `ordenes_compra.paga_con_anticipo`/`anticipo_pct` snapshot); badge 💰 Anticipo + alerta por días sin recepción ya existía en Gastos → OC (escalado D1b) · D2 plan de pagos opcional por OC (`ordenes_compra.pago_schedule JSONB` = `[{etiqueta,base 'confirmacion'|'recepcion'|'dias',dias?,pct}]`, valida suma 100%, se muestra como guía en el modal de pago) · D3 comprobante de transferencia (reusa `ordenes_compra.comprobante_url` ISS-096: adjuntar/ver en el modal de pago cuando hay medio Transferencia). Lib pura `src/lib/comprasPago.ts` + 16 tests → suite **428**.
- **CO6 — Cheques diferidos ✅ DEPLOYADO PROD (v1.36.0, mig 187):** D4 tabla `cheques` (propios emitidos a proveedores / de terceros recibidos), `fecha_cobro` diferida, estados (`en_cartera`/`entregado`/`depositado`/`cobrado`/`endosado`/`rechazado`/`anulado`) + endoso (pagar a otro proveedor con cheque de tercero). Nuevo tab **Cheques** en Gastos (`ChequesPanel`): registro, transiciones guiadas por tipo, endoso, filtros, total pendiente y **alerta de próximos a cobrar** (badge + vencidos). Config → `cheques_alerta_dias` (default 7). Lib pura `comprasCheques.ts` + 19 tests → suite **447**.
- **CO7a — OC inteligente ✅ DEPLOYADO PROD (v1.37.0, sin migración):** A6 enviar OC al proveedor — PDF (`src/lib/ocPDF.ts` con jsPDF/autotable), Email (`send-email` con resumen) y WhatsApp (link `wa.me` con plantilla `textoOC`/`waLinkOC`), botones en el detalle de OC (ProveedoresPage). A3 auto-draft desde stock bajo — en Alertas "Generar OC sugerida" consolida productos bajo mínimo por proveedor (vía `proveedor_productos`) y crea OCs borrador con cantidad faltante sugerida (gateado por `capacidadCrearOC`, exige sucursal). +6 tests → suite **453**.
- **CO7b — Servicios ✅ DEPLOYADO PROD (v1.38.0, mig 188):** F1 servicios recurrentes (`servicio_items.recurrente`/`frecuencia`/`proximo_vencimiento`; banner de vencidos en el tab Servicios con "Generar gasto" = sweep lazy que crea el gasto y avanza la fecha) · F2 catálogo genérico del tenant (`servicio_items.proveedor_id` nullable + panel "Servicios generales del negocio") · F3 comparar presupuestos lado a lado (`compararPresupuestos` agrupa por concepto normalizado, marca el más barato). Lib pura `serviciosRecurrentes.ts` + 11 tests → suite **464**.
- **CO8 — Reportes + alertas + export ✅ DEPLOYADO PROD (v1.39.0, sin migración):** G1 reportes (nuevo tab **Reportes** en Gastos, `ComprasReportesPanel`): compras por proveedor (volumen/cumplimiento), top productos, aging de pagos (0-30/31-60/61-90/+90), OCs vencidas, evolución de costos por producto · E4 calificación de proveedor (score A/B/C por % cumplimiento) · G3 export Excel/CSV/PDF por reporte (PDF OC ya estaba en CO7a) · G2 alerta "bajo mínimo sin OC pendiente" en Alertas (badge OC en camino / Sin OC). Lib pura `comprasReportes.ts` + 10 tests → suite **474**. **🎉 Compras 2.0 (CO1-CO8) COMPLETO.**

**Decisiones confirmadas por GO (2026-06-05):** E3 alta rápida de producto en recepción ✅ SÍ (rol alto + "pendiente revisión") · B6 editar precio en recepción con audit ✅ SÍ · D1 modos `contado/anticipo/contra_entrega/cuenta_corriente` + % anticipo por proveedor (override opcional por OC) ✅ · A6 WA por link `wa.me` ✅. **Estado:** ✅ CO1 (v1.31.0) · ✅ CO2 (v1.32.0) · ✅ CO3 (v1.33.0) · ✅ CO4 (v1.34.0) en PROD · ✅ CO5 (v1.35.0, mig 186) · ✅ CO6 (v1.36.0, mig 187) · ✅ CO7a (v1.37.0, A6+A3) · ✅ CO7b (v1.38.0, mig 188, F1/F2/F3) · ✅ CO8 (v1.39.0, G1/G2/G3/E4) en PROD. **🎉 Compras 2.0 (CO1-CO8) COMPLETO — sin pendientes del módulo.**

### Relevamiento Envíos — plan por fases EN1-EN7 (respondido 2026-06-06) — EN1-EN5+EN7 ✅ PROD, falta EN6 (bloqueado)

Respuestas A-I + diseño + modelo de datos + recomendación contable/IVA + plan completo en **`relevamiento_envios_respuestas.md`**. Resumen del plan deployable por fases:

- **EN1 — Pagos a courier contables + conciliación (C1/C2/C3/C4) ✅ DEPLOYADO PROD (v1.40.0, mig 189):** **C2** al marcar pagado un courier **tercero** en "Pagos Courier" se genera un **gasto** ("Transporte y fletes", proveedor=courier, **IVA crédito fiscal** vía `desgloseIvaFlete`) + **egreso de caja** si efectivo; link `envios.gasto_id`; un gasto por courier (`agruparPagosPorCourier`). **C3** nuevo tab **"Facturas Courier"** (`courier_facturas` + `courier_factura_lineas`): cargar factura del courier por período + conciliar contra lo registrado + **alerta de diferencias** (`diffFactura`). **C4** doble firma por umbral (`tenants.envio_pago_doble_firma_umbral` + clave maestra). **C1** pago individual/múltiple (como hoy). Config → Envíos: toggle generar gasto + alícuota IVA flete (default 21) + umbral doble firma. Lib pura `src/lib/enviosCourierPago.ts` + 14 tests → suite **488**.
- **EN2 — POD robusto + cierre de entrega (D1-D6) ✅ DEPLOYADO PROD (v1.41.0, mig 190):** **D1** campos POD requeridos config (`tenants.pod_campos_requeridos` JSONB fecha/receptor/foto/firma/dni) · **D2** mín. de fotos (`pod_foto_min`) · **D3** firma del receptor (`SignaturePad` canvas → `envios.pod_firma_url`) + DNI (`pod_dni`) + **OTP** sobre umbral solo propio (`pod_otp_umbral`, tabla `envio_otp`, RPCs `generar_otp_envio`/`verificar_otp_envio`; el chofer genera el código y lo manda al cliente por WA, el cliente se lo dicta) · **D4** geoloc con **fallback graceful** (`pod_lat/lon`/`pod_geo_estado` ok|fuera_rango|no_disponible; si no se puede, registra y NO frena) · **D5** sub-estados no-entrega (`subestado_no_entrega` ausente/rechazado/direccion_incorrecta + `no_entrega_motivo`) · **D6** reintento con contador (`intentos`; ausente vuelve a en_camino hasta `envio_reintentos_max`, resto → devolución) + recargo (`envio_reintento_recargo`). RPCs del transportista ampliadas (SECURITY DEFINER anon+auth). Lib pura `src/lib/enviosPod.ts` + 18 tests → suite **506**.
- **EN3 — Reparto (G1/G3 + E1-E5) ✅ DEPLOYADO PROD (v1.42.0, mig 191):** **G1** catálogo `repartidores` (vinculables a `empleados`) + `envios.repartidor_id` + productividad (`productividadRepartidor`) · **G3/E3** hoja de ruta del día por repartidor (tab **Reparto** en Envíos): orden por proximidad NN o zona/hora (`ordenarHojaRuta`), PDF, **link agrupado** `/hoja-ruta/:token` (público, `HojaRutaPage` + RPC `get_hoja_ruta_by_token`) + cumplimiento (`cumplimientoDia`); tablas `hojas_ruta`+`hoja_ruta_envios` · **E1** expiración token config (`envio_token_politica` al_entregar/dias + `envio_token_dias`; `envios.token_expira_at`; chequeo en `get_envio_by_token`) · **E2** transportista: llamar (`tel:`)/WhatsApp + incidencia (`envio_incidencias` + RPC `reportar_incidencia_envio`) · **E4** identidad (`envio_identidad_modo` anonimo/nombre_dni; gate en TransportistePage) · **E5** notif "en camino" WA al pasar a en_camino (`envio_notif_en_camino` no/wa/wa_tracking). Config → Envíos: `RepartidoresPanel` + reglas. Lib `src/lib/enviosReparto.ts` + 8 tests → suite **514**.
- **EN4 — Costos y tarifas avanzados (B1-B6) ✅ DEPLOYADO PROD (v1.43.0, mig 192):** **B1** recargo por franja horaria (`tenants.envio_recargo_horario`) · **B2** factor KM (`envio_factor_km` default 1.35) · **B3** costo mínimo (`envio_costo_minimo`) + escalonado por tramos (`envio_tramos`) · **B4** cobro al cliente (`envio_cobro_politica` cliente_100/cliente_margen/subsidio + margen/umbral) · **B5** envío gratis condicional (`envio_gratis_reglas` monto/etiquetas/promo) · **B6** diferencia real vs cotizado (`envios.diferencia_tipo/monto/motivo`, modal "Registrar costo real"; precio al cliente inmutable). Motor puro `src/lib/enviosTarifas.ts` (`costoEnvioPropio`/`cobroCliente`/`envioGratis`/`diferenciaReal`) aplicado en el cálculo de KM + Config → Envíos card "Tarifas y cobro". +15 tests → suite **529**.
- **EN5 — Creación y alcance (A1-A5) ✅ DEPLOYADO PROD (v1.44.0, mig 193):** **A1** DEPOSITO ve/crea envíos (`AppLayout` depositoVisible + DEPOSITO_ALLOWED) · **A2** envíos libres sin venta (`envios.tipo` venta/traslado_interno/muestra/dev_proveedor/otro + `motivo` + `sucursal_destino_id`) · **A3** sugerencia de courier por CP (`tenants.cp_courier_preferido` rangos, `sugerirCourierPorCp`, override) · **A4** plazo de despacho por canal (`tenants.envio_plazo_despacho` {presencial/online/mayorista} horas; badge "Atrasado" vía `plazoDespachoVencido`+`clasificarCanal`) · **A5** múltiples envíos por venta con desglose (`envio_items`: editor de qué sale en cada envío, descuenta lo ya despachado; se relajó la exclusión de ventas con envío + badge "N envíos"). Lib `src/lib/enviosCreacion.ts` + 12 tests → suite **541**.
- **EN7 — Envío propio + recursos + reportes/alertas (G2 + H1/H2/H3) ✅ DEPLOYADO PROD (v1.45.0, mig 194):** **G2** asociar envío propio a un **vehículo** (recurso) + **KM** del viaje + **combustible auto-gasto** ("Combustible", IVA crédito fiscal, link `envios.gasto_combustible_id`) que **suma KM al recurso** (`recursos.km_acumulado`); consumo del vehículo (`recursos.consumo_litros_100km`) × precio litro (`tenants.envio_combustible_precio_litro`) estima el monto (editable). **H1** nuevo tab **Reportes** (`EnviosReportesPanel`): pendientes/atrasados · cumplimiento por courier (tiempo medio + % entregados) · pagos a courier por mes · **margen logístico** (ingreso venta − costo real, subsidiados) · distribución por zona/CP · productividad de repartidores. **H2** sección **Alertas** (umbrales config `envio_alerta_*`): sin despachar +Nh · POD pendiente +Nd · pago courier +Nd · diferencia cotizado vs real ≥N%. **H3** export Excel/CSV/PDF por reporte + **etiquetas A4** (4/6/12 por hoja con QR + destinatario, `etiquetasEnvioPDF.ts`) + hoja de ruta PDF (ya estaba en EN3). Libs puras `enviosRecurso.ts` + `enviosReportes.ts` (+17 tests → suite **558**). Config → Envíos: precio litro + 4 umbrales de alerta; consumo por vehículo en Recursos.
- **EN6 — Integraciones courier (F1/F2/F3) — ⛔ BLOQUEADO (único pendiente del módulo):** tracking por número + **cotización comparativa ("más barato")** + etiquetas (descarga + impresión térmica). **Reusa `courier-api` de ISS-174 → depende de validar adapters con cuentas B2B reales que GO aún no tiene.** Se desbloquea al conseguir cuenta (Andreani 1ro) y validar/ajustar los adapters.

**Recomendación contable/IVA (respuesta a la pregunta de GO en C2):** courier tercero = gasto "Logística/Courier" con **IVA crédito fiscal** (respaldo = factura del courier, C3); envío propio NO genera gasto courier (su costo real va por **combustible**, G2). Lo que paga el cliente es **ingreso dentro de la venta** (no se duplica). Margen logístico = ingreso − costo real.

**Top 3 (GO delegó, I1):** EN1 (contable) → EN2 (POD robusto) → EN3 (reparto). EN6 después de validar adapters B2B.

**Pendientes de confirmación:** alícuota IVA del flete (¿21%?), plazos default por canal (A4), canal del OTP (D3), cuentas B2B para EN6.

### Relevamiento RRHH — plan por fases RH1-RH8 (respondido 2026-06-09)

Respuestas A-H + diseño + modelo de datos + plan completo en **`relevamiento_rrhh_respuestas.md`** (fuente de verdad). El módulo RRHH ya era maduro: 13 tablas, RrhhPage ~3700 líneas; varias respuestas ya cumplidas (A5 `user_id`, A1-c `fecha_ingreso`, `fecha_egreso`/`supervisor_id`). **RH1+RH2+RH3+RH6 ✅ DEPLOYADOS PROD (v1.46.0, mig 195-198). Confirmadas las 4 asunciones (% aportes editables en Config, categorías Sueldos/Cargas sociales, prorrateo del básico, indemnización a definir en RH8).**

- **RH1 — Empleados 2.0 (A1-A5) ✅ PROD (v1.46.0, mig 195):** obligatorios en el form (email/tel/puesto/depto) · motivo de egreso (`empleados.motivo_egreso`) + **modal de baja con motivo** + reactivar (limpia egreso) · **tipo de contrato configurable** (tabla `rrhh_tipos_contrato` + seed base AR, drop CHECK; select con "+" inline; `es_relacion_dependencia` dispara aportes) · datos bancarios (`cbu/alias_cbu/banco/tipo_cuenta/titular_cuenta`).
- **RH2 — Conceptos + aportes AR + SAC (B3/B4/B5) ✅ PROD (v1.46.0, mig 196):** `rrhh_conceptos` += `tipo_calculo`(fijo/porcentaje/sobre_bruto)/`default_pct`/`default_monto`/`es_aporte`; seed base AR (Antigüedad/Presentismo/Jubilación 11%/OS 3%/Ley 19.032 3%/Sindicato) · **aportes configurables POR EMPLEADO** (`empleados.config_aportes` JSONB, checkboxes en el form; el % vive en el concepto/Config; "en negro" = sin checkboxes) + **beneficios extra** ($/%, `empleados.beneficios_extra`) · `crearLiquidacion` inyecta básico+beneficios+aportes vía lib pura `rrhhNomina.ts` · **SAC = 50% del mejor sueldo del semestre** (botones SAC 1°/2° sem). +11 tests.
- **RH3 — Nómina contable + recibo + Gastos (B6/B7/B8) ✅ PROD (v1.46.0, mig 197):** botón **"Generar gasto"** por salario → inserta gasto en módulo Gastos (categoría **Sueldos**, `estado_pago=pendiente`, `monto_pagado=0`, link `rrhh_salarios.gasto_id`) · **"Cargas sociales → Gastos"** acumula los aportes del período por concepto (categoría **Cargas sociales**) · **recibo de sueldo PDF** (`reciboSueldoPDF.ts`, con líneas de firma) · **comprobante firmado** opcional (upload bucket `empleados`, `comprobante_firmado_url`) · **doble validación** configurable (`tenants.rrhh_nomina_doble_validacion`/`_supervisor_aprueba`; gate `puedeAprobarNomina`; toggle owner-only). Categorías Sueldos/Cargas sociales seedeadas idempotentes.
- **RH6 — Asistencia 2.0 (D1-D6) ✅ PROD (v1.46.0, mig 198):** **fichado** clock-in/out (`rrhh_fichadas` con origen manual/celular/qr; el check-in rápido ya escribe el ledger) · **horario por empleado** (`horario_entrada/salida`, `dias_laborales`) · **licencias subdivididas** (`tipo_licencia` + catálogo `LICENCIA_TIPOS`) + `comprobante_url` · **horas extra** (`rrhh_horas_extra` con multiplicador 50/100 + aprobación, panel en Asistencia, monto vía `montoHorasExtra`) · **feriados regla de pago** (`regla_pago` simple/doble/triple). Lib pura `rrhhAsistencia.ts` (+9 tests). **Diferido dentro de RH6:** fichado por **QR público** (página `/fichar/:token`) + auto-descuento de tardanza inyectado en nómina (lib `descuentoTardanza` lista, falta el cron/sweep).
- **RH4 — Frecuencia + anticipos (B1/B10) ✅ PROD (v1.47.0, mig 199):** `empleados.frecuencia_liquidacion` (mensual/quincenal/semanal/personalizado) + `frecuencia_dias` → **prorratea el básico** en `crearLiquidacion` (lib `rrhhLiquidacion.basicoProrrateado`: mensual=1/quincenal=½/semanal=¼/personalizado=días/30) · **anticipos** (`rrhh_anticipos`, panel en Nómina): registra + opcional genera gasto "Adelantos al personal" (pendiente) + **descuento automático en la próxima liquidación** (`anticiposADescontar` sin neto negativo, descuento parcial deja resto pendiente, marca `saldado`/`descontado_en_salario_id`). +8 tests.
- **RH5 — Vacaciones 2.0 (C1-C7) ✅ PROD (v1.47.0, mig 200):** **días por antigüedad LCT** 14/21/28/35 (botón "Sugerir LCT" en el saldo, `diasVacacionesLCT`+`antiguedadAnios`) + override · **aprobación con alerta** de plazo de aviso (`tenants.rrhh_vacaciones_aviso` sin/alerta/bloquea, `evaluarAviso`) + **solapamiento** con aprobadas (`solapamientos`, window.confirm) · **remanente auto** desde el año anterior con límite (`remanenteSiguiente`, `tenants.rrhh_vacaciones_remanente_max`) · config en el tab (aviso/remanente) · C7 vacaciones pagas dentro del sueldo (sin concepto especial) · `rrhh_vacaciones_solicitud` += estado `preaprobada` (drop CHECK) + `preaprobado_por/at` (C2, base) · `rrhh_vacaciones_flujo`/`_min_bloque`/`_max_bloques` (C2/C5, base config). Lib pura `rrhhVacaciones.ts` (+10 tests).
- **RH7 — Documentos + capacitaciones + evaluación + portal/notif (E1-E4/F1-F4) ✅ PROD (v1.48.0, mig 201):** **catálogo de documentos obligatorios** (E1, `rrhh_documentos_catalogo` CRUD) + alerta de **faltantes** (`documentosFaltantes`) y **próximos a vencer** (E2, `rrhh_documentos.fecha_vencimiento` + `documentosPorVencer`, umbral `tenants.rrhh_doc_alerta_dias`) · **capacitación obligatoria** (E3, `rrhh_capacitaciones.obligatoria`) · **evaluación de desempeño** 1-10 + tipo auto/supervisor/par (F4, `rrhh_evaluaciones`, panel en Reportes) · config **portal del empleado** (F2, `tenants.rrhh_portal_empleado`/`_capacidades`) + **notificaciones del ciclo** (F3, `tenants.rrhh_notif_config`). E4 (costo capacitación) = NO. Lib `rrhhDocumentos.ts` (+5 tests).
- **RH8 — Reportes + export + liquidación final (G1/G2 + A2-c) ✅ PROD (v1.48.0, mig 202):** nuevo **tab Reportes** (`RrhhReportesPanel`): costo laboral por departamento · asistencia consolidada · vacaciones gozadas/pendientes · antigüedad/rotación · recibos pagados/pendientes (G1) + export Excel/CSV/PDF (G2) · **liquidación final** al egreso (A2-c, `liquidacionFinal.ts`): **indemnización** LCT 245 (mejor sueldo × años, fracción > 3 meses suma año, mín 1 sueldo) + **SAC proporcional** + **vacaciones no gozadas** (sueldo/25 × días), todo **editable**, genera gasto en Gastos + persiste en `rrhh_liquidaciones_finales`. Botón en empleados dados de baja. Libs `rrhhReportes.ts` + `liquidacionFinal.ts` (+12 tests).

**Estado:** 🎉 **RRHH 2.0 (RH1-RH8) COMPLETO en PROD.** **Diferidos ✅ CERRADOS EN PROD (v1.51.0, mig 204, 2026-06-10, PR #179):** **fichado por QR público** (`/fichar/:token`, `FicharPage` + RPCs anon + config QR) · **auto-descuento de tardanza** inyectado en nómina (`crearLiquidacion` usa `minutosTardeFacturables` desde las fichadas + `descuentoTardanza`) · **UI del portal del empleado** (`/mi-portal`, `MiPortalPage`: recibos/vacaciones/documentos según `rrhh_portal_capacidades`). **No quedan diferidos de RRHH.** Libs RRHH: `rrhhNomina` + `rrhhAsistencia` + `rrhhLiquidacion` + `rrhhVacaciones` + `rrhhDocumentos` + `rrhhReportes` + `liquidacionFinal` + `reciboSueldoPDF` + componente `RrhhReportesPanel`.

### Bugs / mejoras UX puntuales

| ID | Módulo | Descripción | Estado |
|---|---|---|---|
| ISS-075 | Historial | Trazabilidad de despacho y movimientos. **✅ v1.11.0 (mig 153+154)**: (1) tabla `venta_item_despachos` con desglose por LPN/ubicación/serie de cada ítem vendido + campo `origen` (`manual`/`auto`); (2) detalle de venta (VentasPage), detalle de movimiento (MovimientosPage) y **/historial** (HistorialPage) muestran el desglose completo por LPN; (3) ingreso/rebaje manual se vuelcan al `actividad_log` (`ingreso_stock`/`rebaje_stock`); (4) traslado con ubicación origen→destino; (5) toggle `tenants.trazabilidad_asignacion` en Config → Inventario. **Pendiente futuro**: consolidar aún más el /historial (ver nota Trazabilidad-extendida abajo) | ✅ v1.11.0 |
| ISS-080 | Alertas | Filtrar por sucursal todas las queries de AlertasPage | ✅ Resuelto 2026-05-28 — cruce client-side con `inventario_lineas`+`PSMSS` para stock; cruce con `inventario_lineas` para productos sin categoría |
| ISS-108 | Header / Mobile | Selector de sucursal invisible en celular | ✅ Resuelto 2026-05-28 — bloque mobile con ícono Building2 + nombre + `<select>` transparente superpuesto |
| ISS-148 | Recursos | Input texto libre para ubicación | ✅ Resuelto 2026-05-28 — componente `UbicacionPicker` (select con opciones del histórico de la sucursal + opción "+ Nueva ubicación") en form crear/editar, modal asignar y edit inline |
| ISS-151 | Dashboard + CC | ✅ **CERRADO (v1.30.1)**. (1) `MixCajaChart` + `MetricasPage` excluyen pseudo-métodos vía constante única `PSEUDO_METODOS_PAGO` en `src/lib/ccLogic.ts` = `Cuenta Corriente` + `Cancelación CC` + `Condonación CC` + **`Incobrable`** (este último era el gap que faltaba: el write-off B6 se escribe en `medio_pago` y distorsionaba la ganancia); (2) `ClientesPage` con **Condonar** (write-off, tag `Condonación CC`) y **Revertir** (restaura la deuda), ambos solo DUEÑO/SUPERVISOR/ADMIN; condonadas con badge para revertir. Ambas mantienen la venta **despachada** (no tocan stock — P4). Sin migración. +4 tests (`esMetodoRealPago`). | ✅ v1.30.1 |

### ISS-151 — modelo alineado (relevado con GO + socio, 2026-05-29)

Decisiones para implementar (no implementado aún):

1. **Dos acciones separadas en una venta con deuda CC** (ambas solo DUEÑO / SUPERVISOR / ADMIN):
   - **Condonar**: la deuda se da por perdida (incobrable). No es un cobro ni un ingreso.
   - **Revertir a pendiente**: la venta vuelve a estado de pago "falta pagar" para re-cobrarla por otro medio o anularla.
   - Reemplaza al actual botón único `cancelarDeudaCC` (`ClientesPage.tsx:405`) que hoy marca `monto_pagado = total` con un medio falso `"Cancelación CC"`.
2. **El cobro posterior de una CC NO suma a la ganancia del día**: la utilidad ya se contabilizó cuando la venta se despachó. Cobrar la deuda después es solo movimiento de caja (pasa de "por cobrar" a efectivo/medio real), no nueva utilidad.
3. **Dashboard**: `"Cancelación CC"` deja de contarse como medio de pago. Cuando la deuda se cobra por un medio real, recién ahí aparece en el gráfico bajo ese método de pago.
4. **Al revertir a pendiente, la venta sigue entregada** (solo cambia el estado de pago). Si hay que devolver mercadería, se usa el flujo de **Devolución** aparte (no se reintegra stock automáticamente).

### BUG-LPN (encontrado + corregido 2026-05-29, en DEV)

**Síntoma:** en venta directa, la selección manual de LPN en el carrito (override de `lpn_fuentes`) se ignoraba en el rebaje real — la Fase 2 de `registrarVenta` re-consultaba y ordenaba por el sort automático, rebajando de un LPN distinto al elegido. El desglose de ISS-075 lo destapó.

**Fix:** rebaje en 2 fases ([VentasPage.tsx Fase 2](src/pages/VentasPage.tsx)) — **Fase A** honra `item.lpn_fuentes` con cantidades exactas por LPN y en orden; **Fase B** completa por sort solo si quedó faltante (stock cambiado). Ahora el rebaje siempre coincide con los badges de LPN del carrito.

**BUG-RACE (mismo producto en varias líneas del carrito):** además del sort, había una **race condition**. La Fase 2 y Fase 3 de `registrarVenta` corrían en `Promise.all` (paralelo). Con el mismo producto en 2 líneas del carrito, ambas leían el mismo stock inicial y se pisaban → distribución de rebaje por LPN incorrecta y `stock_actual` desfasado. Detectado en Venta #198 (2 movimientos leyeron `stock_antes=35` ambos).

**Causa de fondo:** el trigger `lineas_recalcular_stock` → `recalcular_stock(producto_id)` ya setea `stock_actual = SUM(cantidad de líneas activas)` (o COUNT de series activas). El update **manual** de `stock_actual` en Fase 3 de `registrarVenta` peleaba contra el trigger y lo pisaba con un valor racy.

**Fix (en DEV):**
1. Fase 2 ahora es **secuencial** (`for` en vez de `Promise.all`) → sin race entre líneas del mismo producto.
2. Fase 3 **ya no actualiza `stock_actual` manualmente** (lo hace el trigger); solo registra movimientos, **agregados por producto** (un movimiento por producto con la cantidad total). `stock_antes` se reconstruye desde el `stock_actual` post-trigger.
3. Esto además **auto-corrige** desfases históricos: al dejar el trigger como única fuente, `stock_actual` converge a la suma real de líneas.

**Limitación conocida — ✅ RESUELTA (2026-05-30):**
- (b) **`stock_actual` manual en reserva→despacho**: ya estaba resuelto desde v1.11.0 (`cambiarEstado` NO toca `stock_actual`, lo deja al trigger y reconstruye `stock_antes/despues` con `stockVendibleSucursal`). El rótulo de "pendiente" estaba desactualizado.
- (a) **Selección manual de LPN no persistía en reservas**: resuelto con **mig 156** (`venta_items.lpn_plan JSONB`). `registrarVenta` persiste el plan del carrito `[{linea_id,lpn,cantidad,manual}]`; `cambiarEstado` (reservar + despachar) honra el plan (Fase A) y autocompleta por sort si cambió el stock (Fase B), con `origen` manual/auto. Antes el despacho de una reserva re-ordenaba por sort, ignorando el LPN elegido. Sin impacto en cantidades (solo trazabilidad fina del LPN).

**Datos de prueba con stock desfasado:** Ventas #196 y #198 (Almacén Jorgito) quedaron con distribución por LPN incorrecta y/o `stock_actual` −1. **Recalc global corrido en DEV** (113 productos, 0 desfasados). En PROD correr el recalc post-deploy.

### Trazabilidad-extendida — ✅ implementado en DEV (mig 155, 2026-05-30)

Visión (pedido GO 2026-05-30): `/historial` (HistorialPage) como **hub único de trazabilidad grado WMS** (Manhattan / Blue Yonder) para recall / auditoría / análisis. **Implementado en DEV** (mig 155, pendiente deploy PROD):

- ✅ **Consolidar por transacción**: `actividad_log` pasa a ledger con `transaccion_id` (+ `tipo_transaccion`, `producto_id`, `lpn`, `nro_serie`, `lote`, `sucursal_id`). Las N filas de una acción (ej: editar LPN con 4 campos) comparten id → 1 tarjeta en `/historial` ("Editó LPN X — 4 cambios"), expandible campo por campo. Filas legacy (`transaccion_id` NULL) siguen como evento único. Helper `nuevaTransaccion()` en `actividadLog.ts`.
- ✅ **Filtro por LPN/serie (recall)**: panel "Trazá una unidad" reconstruye la historia completa de una unidad cruzando `actividad_log` + `venta_item_despachos`, sin paginar.
- ✅ **Export completo**: Excel del set filtrado completo (no solo la página, hasta 10k filas) con columnas del ledger.

**Decisión de diseño** (GO preguntó cómo igualar/superar un WMS tier-1): se eligió `transaccion_id` write-time (ledger inmutable, auditable), **no** heurística read-time por minuto (frágil, no auditable para recall). Snapshots de LPN/lote/serie desde el día 1.

**✅ Cerrado en v1.11.3 (2026-05-30)**: devoluciones ahora se loguean en `/historial` (`tipo_transaccion='devolucion'`, agrupadas por transacción, con producto_id + LPN); reserva→despacho y venta→devuelta clasificadas; filtro de recall por **producto** (nombre/SKU → producto_id) además de LPN/serie. Trazabilidad-extendida **completa**.

### Deuda técnica / pendientes abiertos

| Área | Descripción |
|---|---|
| **Aislamiento por sucursal a nivel RLS** | **Pedido GO 2026-05-30.** Hoy el aislamiento por sucursal es **solo cliente** (triple blindaje: fijado al cargar + selector oculto + guard de `setSucursal`). La RLS de la DB es por `tenant_id`, no por `sucursal_id` → un usuario técnico con credenciales podría leer otra sucursal vía API directa. Para que sea **imposible a nivel servidor**: RLS por sucursal en tablas operativas (`inventario_lineas`, `movimientos_stock`, `ventas`, `gastos`, `caja_sesiones`, …) cruzando `auth.uid()` → `users.sucursal_id` cuando `puede_ver_todas = false`. Cambio grande (políticas en N tablas) — diseñar antes. Detalle en `multi-sucursal.md`. |
| Gastos | Crash en GastosPage — pendiente stack trace Sentry del ErrorBoundary instrumentado |
| Relevamientos | 8 HTMLs generados (Ventas / RRHH / Clientes / Compras / Envíos / Caja / Conteos / **Inventario**). **Respondidos + implementados:** Ventas, Clientes, Conteos, **Compras ✅ (CO1-CO8 COMPLETO en PROD)**, **Envíos ✅ (EN1-EN5+EN7 en PROD, falta EN6 bloqueado por cuentas B2B)**, **🎉 RRHH ✅ (RH1-RH8 COMPLETO en PROD, v1.46-v1.48)**, **Caja ✅ (A-M COMPLETO en PROD, v1.9.1→v1.10.0 + v1.50.0 mig 203)**. **⏳ SIN RESPONDER: Inventario/WMS** — HTML `relevamiento-inventario-reglas-negocio.html` generado 2026-06-10 (14 secciones A-N: maestro, ingreso, ubicaciones/almacenaje, rebaje, estados/aging, LPN/series/lotes, KITs, autorizaciones, stock mínimo, multi-sucursal, importación, WMS picking). Esperando que GO + socio lo respondan offline. |
| ~~**Email saliente — dominio Resend sin verificar**~~ | ✅ **RESUELTO 2026-06-06** — dominio ya verificado; `FROM` → `noreply@genesis360.pro`; **+ email de OC con template HTML + PDF adjunto** (`send-email` soporta `attachments`). Redeploy DEV v21 / PROD v24. Ver sección abajo. |
| **Couriers — adapters sin validar con cuentas B2B reales** | Ver sección detallada **"Email + Couriers — pendientes a seguir"** abajo. |

---

## Relevamiento Caja — estado real (reconciliado 2026-06-10)

> **GO reportó (2026-06-10) que tenía notas de que Caja estaba "entregado y en PROD", contra la nota stale que decía "Caja sin responder". Se verificó contra el código real: las notas de GO son las correctas.** El `sources/relevamientos/caja_2026-05-25.md` y la lista de "pendientes" de `wiki/features/caja.md` quedaron **congelados antes de las migs 140-142** (stale) — por eso parecían incompletos.

**Caja relevado A-M (2026-05-25, GO+socio) y mayoría implementado en PROD** en 3 tandas:
- **Tanda 1 (v1.9.1, mig 136):** F1 cajas por moneda · H1 cuentas de origen + bóveda discriminada · G2/G3 sin egreso manual · D3 arqueo pre-cierre obligatorio.
- **Tanda 1.5 (v1.9.2, migs 137-138):** E4/E5 retiros de bóveda solo DUEÑO + historial privado · M1 selector de caja auto-asignado.
- **Fase 2 (v1.9.3→v1.10.x, migs 140-142):** **mig 140** A2 abrir a nombre de cajero (`caja_sesiones.abierta_por`)/A4/B5/B6/C2/J permisos (`tenants.config_caja_jsonb`) · **mig 141** C1/C3 ticket enriquecido+58/80mm/K2 snapshot/K3 numeración correlativa por sucursal (`caja_sesiones.numero`)/B1/B2/B3 diferencias+umbral+alertas/B4 diferencia caja · **mig 142 (HITO v1.10.0)** I1/I2 reportes + export (`vw_caja_resumen_diario`, `CajaReportes.tsx`). · **v1.10.2** C2 mail al DUEÑO + se eliminó el PDF auto al cerrar. · Verificado en código: **B7 doble validación al cierre** (`configCaja.doble_validacion_cierre`), **G1 botón Corregir** (reversa + audit), **L1 selector de caja en devolución efectivo** (VentasPage).

**Ítems chicos que faltaban → ✅ CERRADOS en DEV (v1.50.0, mig 203, 2026-06-10):**
- **E1** ✅ — visibilidad de bóveda configurable para **roles personalizados** (helper `accedeABoveda` en `cajaPermisos.ts`; `caja_fuerte_roles` ahora acepta `custom:<rolCustomId>`; Config → Caja lista roles estándar + custom). +5 tests.
- **E3** ✅ — **arqueo manual de bóveda** (`boveda_arqueos`, RLS solo DUEÑO/ADMIN/SUPER_USUARIO): botón "Arquear bóveda" en el tab Caja Fuerte, modal con conteo por cuenta vs sistema + diferencia, historial de arqueos. No cierra la bóveda.
- **L3** ✅ — **préstamo a empleado**: en RRHH → Anticipos, checkbox "Es préstamo" + adjuntar **nota firmada** (bucket `empleados`, `rrhh_anticipos.documento_url` + `es_prestamo`). El egreso de caja sale por Gastos (efectivo, consistente con G2/G3) y se descuenta del próximo sueldo (RH4). Badge "Préstamo" + link al doc en la lista.
- **M3** ✅ — **panel de cajero simplificado** (`/caja/panel`, `PanelCajeroPage`, full-screen sin sidebar): estado de caja + botones grandes Cobrar/Operar caja + toggle de sonido. Acceso desde botón "Modo panel" en CajaPage.
- **M4** ✅ — **sonido al confirmar cobro** (`src/lib/sonidoCobro.ts`, Web Audio, preferencia localStorage default ON, toggle en el panel). Suena al despachar una venta en el POS.
- **N** (top 3 / abiertos) — nunca respondido; quedó moot.

**🎉 Relevamiento Caja A-M COMPLETO en PROD** (mayoría v1.9.1→v1.10.0; estos 5 ítems chicos en v1.50.0, mig 203, PROD 2026-06-10).

**Preguntas abiertas de GO (2026-06-10), resueltas:**
- **J2** (¿DEPOSITO puede hacer devoluciones con efectivo desde caja?): opción **(a)** — DEPOSITO NO opera caja; las devoluciones con efectivo las hace CAJERO/SUPERVISOR/DUEÑO desde el historial de venta con selector de caja (= L1, ya implementado).
- **B4** (¿asociar diferencia al cajero o qué recomendás?): ya implementado como se recomendó — movimiento contable "Diferencia caja" + queda asociado al cajero (vía sesión) + sin descuento automático de sueldo (decisión humana).
- **K1** (recomendación fiscal): cierre Z **digital** (numeración correlativa + snapshot), sin integrar controlador fiscal físico. Implementado.
- **K2** (¿backup de tickets o regenerar?): regeneración **on-demand** desde snapshot JSONB enriquecido + backups automáticos de Supabase; NO se guarda el PDF (evita desync). Implementado.

**Pendiente de cierre documental:** realinear `caja_2026-05-25.md` + `wiki/features/caja.md` (sus listas de "pendientes" están stale) y, si GO quiere, cerrar los 3-4 ítems chicos (E3 / L3 / M3 / M4 / E1-roles-custom).

---

## Email + Couriers — pendientes a seguir (analizado 2026-06-06)

> Surgió al cerrar Compras 2.0. Dos puntos relevados a fondo contra el código. **Prioridad global: Punto 1 primero** (mayor leverage, desbloqueo 90% ops de GO). Punto 2 está bloqueado por conseguir cuenta B2B.

### Punto 1 — Email de la OC (y TODO el email saliente)

**✅ RESUELTO COMPLETO (2026-06-06):** (1) el dominio `genesis360.pro` **ya estaba verificado** en Resend (Cloudflare DNS, sa-east-1 — lo había hecho GO hace ~2 meses); se cambió `FROM` a `Genesis360 <noreply@genesis360.pro>` y se redeployó `send-email`. **Todo el correo saliente usa el dominio propio.** (2) **Mejora del email de OC hecha:** plantilla `type:'oc'` HTML (tabla de ítems + total + anticipo + condiciones, estilo factura) **+ PDF de la OC adjunto** (`generarOCPDF` → base64 → Resend `attachments`); la función ahora soporta `attachments` genéricos. `ProveedoresPage.enviarOCEmail` arma todo. **Redeploys: send-email DEV v21 / PROD v24** (`verify_jwt=true`). **Punto 1 cerrado al 100%.**

**Causa raíz original (histórico):** el remitente. En `supabase/functions/send-email/index.ts:9` estaba `FROM = 'onboarding@resend.dev'` (sender **sandbox** de Resend).
- Provider: **Resend** (`POST https://api.resend.com/emails`, `RESEND_API_KEY` en env). `APP_URL=https://genesis360.pro`.
- Con dominio sin verificar: **entregabilidad mala (spam) + Resend restringe destinatarios**. Afecta **todo** lo saliente, no solo Compras: `welcome`, `venta_confirmada`, `alerta_stock`, `notificacion`, `factura_emitida`, `bug_report`. (La OC usa `type:'notificacion'`, texto plano con `<br>`.)
- El **adjunto** es limitación real pero **secundaria**: Resend soporta `attachments` (base64), pero la función arma el body solo con `{from,to,subject,html}` (línea ~232) — no pasa adjuntos.

**Plan (✅ ambos pasos hechos):**
1. ~~**[GO / ops]** Verificar `genesis360.pro` en Resend + DNS → flip `FROM` + deploy.~~ ✅ **HECHO** (dominio ya verificado; FROM cambiado + redeploy DEV/PROD).
2. ~~**[Claude / código]** `type:'oc'` HTML + adjuntar PDF de la OC (Resend `attachments` base64).~~ ✅ **HECHO** (template `oc` + soporte `attachments` en `send-email`; `enviarOCEmail` genera el PDF con `generarOCPDF`→base64; redeploy DEV v21 / PROD v24). *Patrón `attachments` reutilizable para adjuntar PDF a `factura_emitida` / estado de cuenta a futuro.*

### Punto 2 — Adapters de courier (Andreani / Correo / OCA)

**Estado real:** 3 adapters **completos y fail-safe** en `supabase/functions/courier-api/{andreani,correo,oca}.ts` (+ `index.ts` router, `types.ts`). NO son mocks ni tienen TODOs de incompletitud. Andreani: login Basic→token `x-authorization-token`, `GET /v1/tarifas` (cotizar), `POST /v2/ordenes-de-envio` (generar), `/trazas` (tracking). Sin credenciales → error claro y el **alta manual de envío sigue funcionando** (fallback intacto).
**Riesgo:** **empírico** — endpoints, nombres de campos, auth y forma de respuesta escritos según docs públicas; solo se validan con **cuenta B2B real**. Escribir más código ahora = adivinar.

**Plan:**
1. **NO tocar los adapters todavía** (están OK hasta tener credenciales).
2. **[GO]** Conseguir **UNA** cuenta B2B. **Empezar por Andreani** (REST limpia, mejor doc, tiene entorno de prueba) → Correo (Paq.ar) → **OCA al final** (SOAP, lo más frágil). Validar solo los couriers que GO use.
3. **[GO + Claude, con credenciales]** Validar end-to-end en DEV con dirección real: cotizar → generar → etiqueta → tracking; ajustar mapeos en el adapter.
4. **[Claude, accionable YA sin credenciales — acelera el día 1] ✅ HECHO en DEV (v1.49.0, 2026-06-10):**
   - ✅ **Logging diagnóstico** en `courier-api`: helper `courierFetch` (en `types.ts`) loguea `método + URL + status + body recortado (600 chars)` ante error en todos los fetches de Andreani/Correo + log inline en `soapCall` de OCA. Log de entrada en el router (`action`/`courier`/`tenant`, **nunca** credenciales) y catch con contexto. Visible en Supabase → Edge Function logs.
   - ✅ **Botón "Probar credenciales"** en Config → Envíos (`CourierCredencialesPanel`): nueva acción `probar` en `courier-api` + método `probar(cred)` por adapter (Andreani→`login`, Correo→`getToken`, OCA→tarifa de muestra que valida CUIT+operativa). Cliente front `probarCredencialesCourier()`. Testea las credenciales **guardadas** aunque el courier esté inactivo; resultado inline ✓/✗ + guard de "guardá los cambios primero".
   - **Deploy:** `courier-api` deployada a **DEV + PROD** ✅ (v1.49.0, PR #178, 2026-06-10).

**Lo único que sigue pendiente (ops de GO):** conseguir cuenta B2B (Andreani 1ro) para validar los adapters end-to-end (= EN6 de Envíos). El logging + "Probar credenciales" ya están en PROD para acelerar ese día.

---

## Historial de lotes 2026-05-28

### Lote 3 — RRHH-A5 vinculación empleado ↔ usuario

| ID | Módulo | Fix | Migration |
|---|---|---|---|
| RRHH-A5 | RRHH | Selector "Usuario del sistema" en form empleado + columna "Usuario" en tabla + validación duplicados client-side. Habilita "Mi Equipo" del SUPERVISOR sin tocar la BD a mano | 151 |

### Lote 6 — C3 + A7 (relevamiento Ventas A-D)

Implementación de 2 puntos cerrados del relevamiento Ventas (ver `relevamiento_ventas_respuestas.md`).

| ID | Módulo | Fix |
|---|---|---|
| C3 (parcial) | Ventas / POS | CAJERO ya no puede editar/colocar descuento por ítem ni descuento general en VentasPage. Inputs `disabled` con tooltip "Bloqueado para CAJERO. Pedile al SUPERVISOR/DUEÑO". Constante `descuentoBloqueadoCajero`. **Pendiente del mismo C3** (feature mayor): descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR |
| A7 | Devoluciones | Radio "Dejar en DEV para revisión" / "Reintegrar a stock vendible" en modal de devolución, default DEV. Vendible: línea sin ubicación + `estado_id = primer es_disponible_venta`. No aplica a items serializados (siempre re-activan a su línea) |

### Lote 5 — ISS-178 rangos horarios entrega

| ID | Módulo | Fix | Migration |
|---|---|---|---|
| ISS-178 | Ventas + Envíos + Config | `tenants.envio_rangos_horarios JSONB` con defaults 8-13/13-18/18-22 + `envios.rango_horario_desde/hasta TIME` (snapshot). CRUD en Config → Envíos, selector en modal envío de VentasPage y form de EnviosPage. Tabla de Envíos muestra el rango como badge accent | 152 |

### Lote 4 — 3 bugs UX (ISS-080, ISS-108, ISS-148)

| ID | Módulo | Fix |
|---|---|---|
| ISS-080 | Alertas | AlertasPage filtra por sucursal activa. Queries con `sucursal_id` ya filtraban; nuevo cruce client-side para `alertas` (vs PSMSS + inventario_lineas en la sucursal) y `productos sin categoría` (productos con stock en la sucursal). Sin schema change |
| ISS-108 | Header / Mobile | Bloque nuevo `sm:hidden` con ícono `Building2` + nombre truncado + `<select>` transparente superpuesto (solo si `puedeVerTodas`). Antes el selector desaparecía en < 640px |
| ISS-148 | Recursos | Componente `UbicacionPicker` (select con opciones del histórico filtradas por sucursal + opción "+ Nueva ubicación"). Aplicado en form crear/editar, modal "Asignar ubicación" y edit inline del tab Ubicaciones. Reemplaza al `<input>` libre |

### Lote 1 — commit `f96fd4d1` · release `dev-2026-05-28-lote-iss`

| ID | Módulo | Fix |
|---|---|---|
| ISS-140/141 | Config | Scrollbar oculto en sub-tabs Ventas e Inventario |
| ISS-149 | Gastos | Descuento OC acepta $ o % con toggle |
| ISS-152 | Gastos | `cajasAbiertasOC` filtra por sucursal activa (client-side) |
| ISS-172 | Envíos | KM haversine redondeado a entero |
| ISS-173 | Ventas | "Ya cobrado" → "Seña cobrada" cuando saldo > 0 |
| ISS-177 | Ventas | $/km modal envío es read-only |
| ISS-179 | Config | Form crear ubicación incluye sucursal, Mono-SKU y dims WMS |
| ISS-181 | Config | Comprobantes: reglas mutuamente excluyentes + texto más claro |
| ISS-194 | Caja | ~~Confirmado ya implementado~~ **REFIX**: default `caja_fuerte_roles=['DUEÑO']`; SUPERVISOR/SUPER_USUARIO como toggles habilitables |

### Lote 2 — commits `07d306c5` + `9ba1e3f9` · release `dev-2026-05-28-lote2-iss`

| ID | Módulo | Fix | Migration |
|---|---|---|---|
| ISS-135 | Config | `metodos_pago`: toggles POS/Gastos; VentasPage y GastosPage filtran por flag | 149 |
| ISS-142 | Config + Ventas | `cliente_obligatorio`/`creacion_inline`/`datos_minimos` conectados al POS | — |
| ISS-180 | Config | Unidades predefinidas no eliminables (lock) + validación duplicados | 148 |
| ISS-190 | Gastos | Badges "Sin pagar"/"Pago parcial" + modal pago parcial con movimiento en caja | 150 |

---

## Para el próximo deploy a PROD

Checklist obligatorio:
1. Bump `APP_VERSION` en `src/config/brand.ts` a `v1.10.5` (o v1.11.0 si se agrega feature)
2. PR `dev → main` con título `vX.Y.Z — descripción`
3. GitHub release `vX.Y.Z` sobre `main` como `--latest`
4. Actualizar este archivo + `log.md` + `roadmap.md`

**Nota para tenants existentes (ISS-194):** al deployar, avisar que deben ir a Config → Caja → Acceso a Caja Fuerte y desactivar SUPERVISOR/SUPER_USUARIO si no los quieren habilitados (el valor viejo queda guardado en DB).
