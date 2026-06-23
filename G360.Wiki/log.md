# Log — Genesis360 Wiki

Log cronológico append-only. Cada entrada empieza con `## [YYYY-MM-DD] tipo | título`.

Tipos: `init` · `ingest` · `query` · `update` · `lint`

---

## [2026-06-23] update | 🧪 Barrido UAT — Inventario residual cerrado (over-receipt CON, kits, wall-to-wall) specs 74-76 — EN DEV

**Pedido de GO:** cerrar Inventario residual al 100% (dejando evidencia). REGLA #0 stock, DB-verificado.
- ✅ **74 `74_over_receipt_con_tope_mutante`** (L34): `permite_over_receipt=true`+`over_receipt_pct_max=10`, recibir 11 vs pedido 10 → ACEPTA (within +10%), stock 0→11, OC `recibida` (DB). Complementa spec 52 (SIN→bloquea). Env `E2E_OVER_RECEIPT_CON=1`. OC fixture (Sprite) queda de evidencia.
- ✅ **75 `75_kit_desarmar_mutante`** (L12): desarmar 1 "Elite Pañuelos Super Pack x3" → KIT 40→39, componente "Elite Pañuelos" 140→**143** (+3, receta×3), `kitting_log` desarmado (DB). Valida la maquinaria kitting↔stock. L13 armar = inverso (flujo 2 pasos reservar→confirmar), mismo mecanismo. Env `E2E_KIT_DESARMAR=1`.
- ✅ **76 `76_wall_to_wall_bloqueante_mutante`** (L24, cross-página): un `inventario_conteos` borrador con `bloquea_movimientos=true` en Norte → "Venta directa" en el POS **bloqueada** ("conteo wall-to-wall en curso"). Valida la pata POS de `useConteoBloqueante` (inventario/traslados comparten el hook). Env `E2E_WALL_TO_WALL=1`. **El conteo bloqueante se BORRÓ tras el test** (un bloqueo activo deja la sucursal sin operar → NO es evidencia útil, a diferencia de las transacciones que sí se dejan).
- **#2 conteo gate/reconteo** = cubierto por unit (`conteoAjuste`) + el resultado del gate (autorización 2-actores) por specs 36/47/51; el e2e del flag es refinamiento. **Residual menor (no REGLA #0 crítico):** delta con venta intercalada, under-receipt + ajuste por rol, 2 recepciones parciales.

**Inventario/Conteos — gaps REGLA #0 stock cerrados** (36/47/51/52/71/74/75/76 + traslados 30 + recepción 29/35 + unit extensivo). **Convención evidencia (GO):** las transacciones de prueba (ventas, recepciones, write-offs, desarmados) se DEJAN como evidencia UAT; solo se quitan los **estados bloqueantes activos** (conteo wall-to-wall) que deshabilitarían el tenant.

---

## [2026-06-23] update | 🧪 Barrido UAT — Clientes/CC CERRADO 100% (specs 72/73 + incobrable SIN clave en Familia Otranto) — EN DEV

**Pedido de GO:** cerrar Clientes/CC e Inventario al 100% usando los 2 tenants DEV (Jorgito + Familia Otranto, este último SIN clave) — "hacé y deshacé a gusto; mejor dejá la evidencia del UAT, no borres". ⇒ **a partir de acá NO se limpian los fixtures: quedan como evidencia.** (Al no deshacer, el stock queda naturalmente consistente — lo mutó la app, no SQL manual.)

**Clientes/CC — los 3 residuales cerrados (REGLA #0, DB-verificado):**
- ✅ **72 `72_cc_vencimiento_mutante`** (B3): venta 100% CC con `cc_dias_vencimiento=15` → `ventas.fecha_vencimiento_cc = hoy+15` (DB). Valida además el camino **CC EXITOSO** (crea la deuda), complemento de los bloqueos 46/49. Env `E2E_VENC_CC=1`. *Gotcha: con 2+ cajas abiertas el despacho exige elegir caja en "Registrar en caja" aunque sea 100% CC.*
- ✅ **73 `73_credito_a_favor_positivo_mutante`** (E2): pagar con "Crédito a favor" $1.657 → fila negativa `cliente_creditos = −1.657` (origen `consumo_venta`), saldo 5.000→3.343 (DB). Complemento del guard negativo (spec 53). Env `E2E_CREDITO_POS=1`.
- ✅ **incobrable SIN clave** — **DB-validated en Familia Otranto** (`4cf85bbb…`, sin clave) por impersonación del RPC `marcar_incobrable` (mig 236): **DUEÑO + clave vacía → procede** (`{total_incobrable:4000, ventas_afectadas:1}`; venta deuda→0 + tag "Incobrable" + gasto "Deudor incobrable" $4000 cat. "Deudores incobrables"). **Contraste: SUPERVISOR → rechazado por rol** ("requiere rol DUEÑO/ADMIN") aunque NO haya clave → el gate de rol es independiente del de clave. Complementa spec 40 (CON clave, Jorgito, UI). Evidencia queda en FO.

**🔑 Lección REGLA #0 (limpieza de ventas):** al deshacer una venta por SQL, restaurar SOLO `inventario_lineas.cantidad` — el trigger recalcula `stock_actual`. Tocar `stock_actual` a mano lo duplica (lo dice el CLAUDE.md). *(Ya no aplica porque GO pidió no borrar, pero queda anotado.)*

**▶ Sigue:** Inventario residual (over-receipt CON, conteo gate/reconteo, wall-to-wall cross-página, kits).

---

## [2026-06-23] update | 🧪 Barrido UAT — Clientes/CC residual (documentado) + Inventario rebaje no-negativo (spec 71) — EN DEV

**Pedido de GO:** "seguí con lo que queda de clientes y el siguiente módulo". Post-deploy v1.85.0.

**Clientes/CC residual — decisión (documentada, no se fuerza fixture riesgoso):** el núcleo CC ya está cubierto (morosidad 49, límite 46, condonar 39, **revertir 69**, incobrable CON clave 40, cobranza FIFO 28 + unit). Los 3 que quedan se **difieren** porque exigen mutar stock/deuda con reversa frágil — y restaurar stock a mano es justo lo que REGLA #0 prohíbe arriesgar:
- **vencimiento CC** (`cc_dias_vencimiento`): one-liner `today + N`; el aging que lo consume está en unit. e2e requiere una venta CC que rebaja stock.
- **crédito a favor positivo**: el guard negativo está en spec 53; el consumo positivo inserta una fila negativa en `cliente_creditos` — **mismo insert ya verificado en spec 59** (cancelación de reserva → crédito).
- **incobrable SIN clave**: requiere un tenant sin clave con usuario **DUEÑO** (el harness de Familia Otranto es SUPERVISOR, que el RPC no autoriza). Falta harness.

**Inventario/Conteos — siguiente módulo (cobertura/02):**
- ✅ **spec 71 `71_rebaje_no_negativo_mutante`** (L02, REGLA #0 stock): rebajar 9.999.999 > disponible → guard "Stock disponible insuficiente: N u.", NO toca `inventario_lineas`/`movimientos_stock` (no deja stock negativo ni saca reservado). Datos reales, non-mutating → corre en full-suite. **Gotcha:** el modal de Rebaje tiene su propio buscador ("Buscar por nombre, SKU o código…") distinto del de la tab ("Buscar por producto o SKU…") — scopear al modal.
- **Reconciliación cobertura/02:** los gaps top YA estaban cubiertos por specs previas — #1 autorización ajuste 2-actores = **47/51**, #3 over-receipt SIN = **52**, conteo+ajuste = **36**, traslados = **30**, recepción = **29/35**. Quedan menor-prioridad/fixtures-pesados: over-receipt CON, conteo gate/reconteo, wall-to-wall cross-página, delta con venta intercalada, kits.

**▶ Próximo:** Inventario residual (over-receipt CON, conteo gate, wall-to-wall) si se quiere profundizar; luego Compras/OC/Envíos (cobertura/04), RRHH/Config/Suscripción (cobertura/05). AFIP §29 sigue bloqueado por trámite de GO.

---

## [2026-06-23] deploy | 🚀 v1.85.0 EN PROD — fix REGLA #0 picker de cuotas + barrido UAT (specs 58-70) — sin migración

**Pedido de GO:** tras el barrido de Clientes y Productos, "pasá todo a DEV y PROD". Deploy frontend-only (el único cambio de app es el fix de cuotas; el resto son specs e2e test-only). **Sin migraciones** (todo el trabajo en DB del barrido fue validación reversible, sin DDL). **PROD = DEV = migs 001-240.**

**Qué va a PROD:**
- **🐛 Fix REGLA #0 (plata) — picker de cuotas:** `esTarjetaCredito` (normaliza "Tarjeta de crédito" vs "Tarjeta crédito") → el picker de cuotas con interés vuelve a aparecer en el POS con la config estándar. Antes no se podía cobrar el interés de financiación. Validado por spec 62 + build verde.
- **13 specs e2e del barrido UAT** (58-70, REGLA #0, DB-verificados): Ventas Tanda B, Caja/Bóveda completo, Gastos, Clientes/CC revertir, Productos Exento. + guards server-side validados en DB (IVA crédito mig 227, período cerrado mig 135).

**Flujo deploy:** bump APP_VERSION → v1.85.0 (`brand.ts`); build verde (tsc + vite); commit en dev; push; PR dev→main; merge (Vercel PROD); release `v1.85.0`. **Sin migraciones que aplicar en PROD.**

**▶ Próximo:** seguir el barrido — Clientes/CC residual (crédito a favor positivo, vencimiento CC, incobrable SIN clave), Productos residual (max_productos, margen/bulk), luego Inventario/Conteos (cobertura/04), Compras, RRHH, Envíos. AFIP §29 sigue bloqueado por trámite de GO (cert/token PRODUCCIÓN + CUIT RI homologación).

---

## [2026-06-23] update | 🧪 Barrido UAT — Clientes/CC (revertir condonación) + Productos (alícuota Exento) — EN DEV

**Pedido de GO:** "seguí con clientes y productos y luego pasá todo a DEV y PROD". 2 specs nuevos (REGLA #0, DB-verificado, fixtures reversibles):
- ✅ **69 `69_cc_revertir_condonacion_mutante`** (Clientes/CC, ISS-151): revertir una venta CC condonada → quita el medio "Condonación CC" y recomputa `monto_pagado` con pagos reales → deuda restaurada ("falta pagar"). Fixture = cliente CC + venta condonada #247 ($5.000) + venta pendiente #248 ($3.000, para que el cliente aparezca en el tab CC). Env-gated `E2E_CC_REVERTIR=1`, fixture borrado. Complementa spec 39 (condonar).
- ✅ **70 `70_producto_alicuota_exento_mutante`** (Productos, L49, REGLA #0 fiscal): alta de producto **Exento (0%)** → DB `alicuota_iva=0.00` (NO 21). Es el caso del bug `0 || 21` (0 falsy → 21%); el form usa `Number.isFinite(...) ? ... : 21`. Complementa spec 43 (10,5%). Producto de prueba borrado por SKU.

**Cobertura:** Clientes/CC — revertir condonación cerrado; residual (crédito a favor positivo, vencimiento CC `cc_dias_vencimiento`, incobrable SIN clave) ya mayormente cubierto (morosidad/límite 46/49, condonar 39, incobrable CON clave 40) — necesitan fixtures de venta CC/POS pesados, documentados. Productos — núcleo fiscal de alícuotas cubierto (10,5 + 0); residual max_productos (límite de plan)/margen/variantes/bulk = no-fiscal, documentado.

**▶ DEPLOY a PROD** (autorizado por GO): incluye el **fix de cuotas (G0.5, plata, frontend)** + los specs test-only acumulados. Sin migraciones nuevas. Ver entrada deploy abajo.

---

## [2026-06-23] update | 🧪 Barrido UAT — Módulo GASTOS cerrado (comprobante oblig. + guards fiscales server-side) — EN DEV

**Pedido de GO:** "seguí sin parar hasta terminar un módulo y luego otro, ambos al 100%; las decisiones para el final; pasá a dev cada tanto sin preguntar". Tras cerrar Caja/Bóveda, se cierra **Gastos** (`cobertura/03` §Gastos). REGLA #0 fiscal/contable.

**Cubierto:**
- ✅ **Spec 68 `68_gasto_comprobante_obligatorio_mutante`**: con `gastos_comp_siempre=true`, alta de gasto sin adjunto → "Adjuntá el comprobante: la regla 'siempre obligatorio'…", no crea gasto. Las 4 reglas (`siempre`/`si_iva`/`si_deduce_ganancias`/`si_monto`) comparten el mismo OR. Env-gated `E2E_GASTO_COMP=1`, flag restaurado.
- ✅ **Guard fiscal IVA crédito server-side** (`fn_gastos_iva_guard`, mig 227) — **DB-validated** (flip de `condicion_iva_emisor` reversible): **Mono + Factura A** → IVA NULLeado + `deduce_ganancias=false`; **RI + Factura A** → conserva `iva_monto=$21` + `iva_deducible` + `deduce_ganancias`; **RI + Factura B** → IVA NULLeado (no es A) + ganancias se mantiene (cond RI). Gastos de prueba borrados, condición restaurada a Monotributista.
- ✅ **Período contable cerrado** (`trg_gastos_periodo_cerrado`, mig 135) — **DB-validated**: UPDATE de un gasto con fecha en período cerrado → `P0001 "Periodo contable cerrado hasta 2026-04-30 — usá una nota de corrección"`. **Dato:** Jorgito YA tiene cierres reales hasta **2026-04** (abril). El gasto de prueba se borró deshabilitando el trigger momentáneamente (el cierre real de abril quedó intacto).
- Gasto efectivo→caja ya estaba en spec 27; umbral por rol en unit (`evaluarUmbralGasto`); pago OC doble firma en unit + RPC mig 237. Residual menor (no REGLA #0 crítico): eliminar→reversión en caja (simétrico a 27), gasto en cuotas.

**Gotcha:** para validar triggers server-side de período cerrado, el gasto de prueba cae en período ya cerrado → no se puede borrar con DELETE normal; usar `ALTER TABLE gastos DISABLE TRIGGER trg_gastos_cierre` momentáneo (re-enable después). Nunca tocar los cierres reales del tenant.

**▶ Siguiente:** Clientes/CC residual (revertir condonación, incobrable SIN clave, vencimiento CC, crédito a favor positivo) — varios ya cerrados (morosidad/límite 46/49, condonar 39, incobrable CON clave 40).

---

## [2026-06-23] update | 🧪 Barrido UAT — arranca Módulo Caja/Bóveda: cierre con diferencia (spec 64) — EN DEV

**Pedido de GO:** tras cerrar Ventas Tanda B, GO eligió "bundlear el fix de cuotas + seguir testeando" → siguiente módulo del orden sugerido = **Caja/Bóveda** (`cobertura/03`). Primer spec del módulo, REGLA #0 contable, verificado en DB, fixture reversible (la caja de prueba quedó restaurada a 0 sesiones del día).

**Specs nuevos (Caja/Bóveda — REGLA #0 contable, fixtures reversibles):**
- ✅ **64 `64_caja_cierre_diferencia_mutante`** (B4, `CajaPage.cerrarCaja` + `clasificarAjusteDiferencia`): abrir una caja libre (Caja2) con $1.000 → arqueo → cerrar contando $1.100 → "Sobran $100" → Confirmar. **DB-verificado:** `caja_sesiones` `diferencia_cierre=100` + `caja_movimientos` de ajuste `tipo='ingreso'`, `monto=100`, concepto "[Diferencia caja] Sobrante en cierre". Env-gated (`E2E_CAJA_CIERRE_DIF=1`) porque abre/cierra una caja real y dispara el email de cierre al DUEÑO → NO corre en el full-suite. Sesión de prueba borrada tras verificar.
- ✅ **65 `65_caja_cierre_ajeno_clave_mutante`** (B5): caja abierta por cajero1 (≠ OWNER) + clave del tenant configurada → cerrar exige clave maestra; **clave incorrecta → "Clave maestra incorrecta" (server-side `verificar_clave_maestra`), no cierra; clave correcta (12345678) → cierra** (DB `cerrado_por_id`=OWNER). Fixture sesión ajena + arqueo. Env-gated `E2E_CAJA_AJENA=1`. Limpiado.
- ✅ **66 `66_boveda_extraccion_insuficiente_mutante`** (extraerDeBoveda): extraer $999.999.999 de una cuenta de la bóveda → guard **"Saldo insuficiente"**, NO inserta `boveda_retiros`/`caja_movimientos` (no deja la bóveda negativa). Datos reales (no fixture), non-mutating → corre en el full-suite.
- ✅ **67 `67_caja_doble_validacion_cierre_mutante`** (B7, `config_caja.doble_validacion_cierre`): con la doble validación activa, cerrar **sin** 2º usuario → "Doble validación activada: ingresá email y contraseña…"; con **credenciales inválidas** → "Credenciales del 2do usuario inválidas" (auth contra Supabase con cliente temporal). No cierra. Fixture config + sesión propia, env-gated `E2E_CAJA_B7=1`, restaurado.
- **`diferencia_caja_umbral`** queda **cubierto por unit** (`superaUmbralDiferencia`, umbral 0 vs >0): es ruteo de alerta a roles/canales, no integridad de plata (el ajuste contable de la diferencia ya lo cubre el spec 64).

**Reconciliación cobertura/03:** Caja/Bóveda — gaps REGLA #0 contables cerrados (64-67). G1/G2/G3 ya parcialmente cerrados antes por mig 234 + specs 40/41/45/46/48/49. **Módulo Caja/Bóveda = cerrado para el barrido.** Siguiente: **Gastos**.

**Reconciliación de cobertura/03 (dado 2026-06-21):** varios gaps YA cerrados por trabajo posterior — **G1** (límite CC + morosidad) por mig 234 + e2e 46/49; parte de **G2/G3** por specs 40/41/45/48. Nota de progreso agregada al tope de `cobertura/03`.

**Gotcha e2e:** `puedeAbrirCaja = puedeAdministrarCaja || sin sesiones` → un DUEÑO PUEDE abrir una 2ª caja (el bloqueo "ya tenés una caja abierta" es solo para roles no-admin). El cierre exige ≥1 arqueo parcial. El toast "Caja cerrada" colisiona en strict-mode con el heading de caja-cerrada → desambiguar con `getByRole('status')`.

**▶ Próximo incremento de Caja/Bóveda:** cierre **ajeno** con clave maestra (CON/SIN), **extracción de Bóveda** (egreso real), `diferencia_caja_umbral` (alerta por umbral), doble validación de cierre (B7). Detalle en `project_pendientes.md`.

---

## [2026-06-23] update | 🧪 Barrido UAT Ventas/POS — Tanda B CERRADA (specs 58-63) + 🐛 fix REGLA #0 picker de cuotas — EN DEV

**Pedido de GO:** "sigamos" → tras cerrar Ventas/POS Tanda A, GO eligió seguir con **Ventas Tanda B** (cerrar Ventas al 100% antes de cambiar de módulo). 6 specs e2e nuevos (mutantes, aserción POSITIVA + efecto en DB), fixtures SQL **reversibles** (todos los flags de Jorgito restaurados a default, 0 fixtures residuales). Commits **test-only + 1 fix de app** en `dev` (no van a PROD hasta el próximo deploy).

**Specs nuevos (e2e, REGLA #0):**
- ✅ **58 `58_reserva_sena_minima_mutante`** (L46/`reserva_sena_minima_pct`): con flag=50, seña $1 < 50% del total → bloquea ("La seña mínima es 50%…"), no crea reserva. Env-gated (`E2E_SENA_MIN_FIXTURE`). Flag restaurado a 0.
- ✅ **59 `59_reserva_penalidad_mutante`** (L47/`reserva_penalidad_pct`): **el de más valor (plata).** Fixture = reserva con seña $1000 + flag=20; cancelar con destino crédito → **`cliente_creditos=$800`** (1000×0.8), venta `cancelada`, stock reservado liberado — **verificado en DB**. Fixture borrado, flag restaurado.
- ✅ **60 `60_cliente_obligatorio_siempre_mutante`** (L20): `cliente_obligatorio='siempre'` exige cliente hasta en una venta directa CF (que con el default `'reservas'` no lo exige) → bloquea, no crea venta. Aísla el flag manteniendo modo CF. Flag restaurado a 'reservas'.
- ✅ **61 `61_reglas_canal_descuento_mutante`** (L39/`reglas_canal`): `descuento_max_pct=5` por canal topea el descuento **incluso al DUEÑO** (que no tiene tope de rol) → gate de clave con "supera el máximo de este canal (5%)". No se autoriza → no muta. `reglas_canal` restaurado a `{}`.
- ✅ **62 `62_cuotas_interes_mutante`** (L40/`cuotas_bancos`): Banco Galicia 3x +0.5% sobre $10.000 → "3 cuotas de $3.350 = $10.050 total". Datos reales (no fixture). **Destapó el bug G0.5 (ver abajo).** Corre y pasa en el full-suite (guard de regresión del fix).
- ✅ **63 `63_presupuesto_vencido_mutante`** (L44): presupuesto de 40 días (validez 30) → banner "Presupuesto vencido" + CTA "Finalizar (rebaja stock)"/"Reservar stock" **deshabilitados**. Read-only. Fixture borrado.

**🐛 BUG REGLA #0 (plata) hallado y CORREGIDO (G0.5):** el picker de cuotas con interés (ISS-086, `VentasPage`) se gatillaba con `mp.tipo === 'Tarjeta crédito'` (sin "de"), pero el método canónico de Config/fallback/`metodos_pago` es **"Tarjeta de crédito"** (con "de") → con la config estándar **el picker NUNCA aparecía** y no se podía aplicar el interés de financiación en el POS. **Fix (frontend, sin migración):** helper `esTarjetaCredito` que detecta la tarjeta de crédito por normalización (reusa `normalizarNombreMetodo`, que ya saca "de"/tildes); aplicado a las 2 ramas del picker (badge + selector). **typecheck (tsc) + build verdes.** Spec 62 antes del fix skipeaba (picker no aparecía); ahora pasa. **⏳ EN DEV — recomiendo incluirlo en el próximo deploy a PROD (es plata).**

**Gotchas e2e nuevos:** (1) el flag de seña mínima debe testearse con env-gate + restore (sin el flag, una seña baja CREARÍA la reserva → mutación); (2) `isPresupuestoVencido` usa `updated_at ?? created_at` → el fixture debe envejecer AMBAS fechas; (3) el tope de descuento por canal (`maxCanalPct`) aplica a CUALQUIER rol con permiso, incluido el DUEÑO (≠ tope de SUPERVISOR, que solo a ese rol); (4) `numero` de `ventas` lo pone el trigger → omitirlo en el INSERT del fixture.

**▶ Próxima sesión:** seguir el orden sugerido — **Módulo Caja/Bóveda** (`cobertura/03`) y/o cerrar los opcionales de Ventas (cliente_consumidor_final=false, reglas_canal.requiere_cliente/lista_precio) + Productos Tanda B (max_productos, alícuotas 0/21/27, margen/variantes/bulk). **Decisión para GO:** ¿deployar el fix de cuotas (G0.5) ya, o bundlear con el resto del backlog de DEV? Detalle/handoff en `project_pendientes.md`.

---

## [2026-06-22] update | 🧪 Barrido UAT Ventas/POS — Tanda A REGLA #0 COMPLETA (specs 53-57 + FAC-27) — EN DEV (test-only, sin afectar PROD)

**Pedido de GO:** tras deployar v1.84.0, "seguimos con más testing" → residual Tanda A (hecho: specs 50-52, ver entrada deploy v1.84.0) y luego **barrido del orden sugerido empezando por Ventas/POS**. Inventario maestro = `tests/specs/cobertura/01_ventas_productos_facturacion.md` (60 lógicas + matriz flags + gaps). Todos los specs verdes + **verificados en DB** + **DEV dejado limpio** (fixtures SQL reversibles). **Commits test-only en `dev`** (0f8abf94, 604cc7ac, 61c051b2): no van a PROD hasta el próximo deploy (no tocan app code).

**Specs nuevos (e2e mutantes, REGLA #0):**
- ✅ **53 `53_credito_a_favor_excede_mutante`** (L28): cliente con $1 de crédito, aplicar $100 de "Crédito a favor" → bloquea ("No podés aplicar más que eso"), venta NO creada, crédito intacto (DB).
- ✅ **54 `54_tier_mayorista_mutante`** (L53): qty ≥ `cantidad_minima` → "Precio mayorista: $900/u" (lista $1.200 tachada). **Hallazgo (no-bug):** `updateItem` capa la cantidad al stock disponible → un tier con umbral > stock queda DORMIDO hasta restockear (Donuts: umbral 1000, stock 35) → el spec usa un fixture reversible que baja el umbral a 10.
- ✅ **55 `55_venta_usd_conversion_mutante`** (L41): producto `moneda_venta='usd'` + `precio_usd=10` × `cotizacion_usd=1430` → "Precio USD 10 · convertido a $14.300" en el carrito. *Gotcha: el producto USD necesita stock para aparecer en el buscador.*
- ✅ **56 `56_guard_emisor_letra_ef`** (L3, API directa a la EF): Mono+A→400, Mono+B→400 ("solo puede emitir tipo C"); **RI+C→400** ("RI no puede emitir tipo C") validado por flip reversible de `condicion_iva_emisor`. `venta_id` dummy (el guard precede al fetch de la venta). Skip-guard si faltan `VITE_SUPABASE_URL/ANON_KEY` (correr con `dotenv -e .env.local -e tests/e2e/.env.test.local`).
- ✅ **57 `57_reserva_sin_sena_mutante`** (L45/`reserva_sena_obligatoria`): modo Reservar + cliente + sin medio de pago → guard E6 "No se puede reservar sin seña", no crea reserva (0 ventas reservada en DB). Cliente real "Fede Messina".
- ✅ **FAC-27 server (L9)** — validado contra la EF DEV en vivo vía flip reversible Jorgito→RI: Factura B de $100.000 (≥ umbral 68305.16) sin cliente identificado → 400 "AFIP exige identificar al cliente con DNI o CUIT". **Sin spec committeado** (requiere emisor RI persistente; Jorgito=Mono → L3 bloquea B antes) → pendiente un tenant RI de homologación (ligado al trámite AFIP de GO, junto con §29).

**Cobertura reconciliada:** de la Tanda A REGLA #0 de Ventas/POS (cobertura/01), **cerrados** L26/L27/L33 (specs 45-49), L28 (53), L53 (54), L41 (55), L3 (56), L9/FAC-27 (EF), + kit by-design. **Queda solo §29 AFIP runtime** (bloqueado por GO).

**Gotchas e2e nuevos:** (1) `updateItem` capa la cantidad al stock disponible; (2) un producto USD necesita stock para aparecer en el buscador del POS; (3) el guard emisor↔letra de la EF corre ANTES de buscar la venta (venta_id dummy alcanza para probar el 400); (4) la anon key (pública) no está en `.env.test.local` → cargar `.env.local` para los tests de API a la EF.

**▶ Próxima sesión:** seguir el barrido — **Ventas Tanda B** (`reserva_sena_minima_pct`, `reserva_penalidad_pct` cancelación, `cliente_obligatorio` 3 valores, `reglas_canal`, cuotas, presupuesto vencido) y/o **módulo Caja/Bóveda** (cobertura/03). Detalle/handoff en `project_pendientes.md`.

---

## [2026-06-22] deploy | 🚀 v1.84.0 EN PROD — descuento por-ítem read-only + estado "sin clave" visible (H3) + fix label Autorizaciones + 3 specs residual Tanda A (sin migración)

**Pedido de GO:** "sigamos con los pendientes" → residual Tanda A primero, luego orden sugerido del UAT → "pasá todo a DEV y PRD de vercel y luego vamos con el UAT". Todo frontend/specs, **sin migración** (PROD = DEV = migs 001-240). typecheck + build verdes. Bump APP_VERSION → v1.84.0; PR dev→main; release `v1.84.0`.

**Follow-ups de código del handoff (frontend):**
- **(a) Descuento por-ítem read-only** (`VentasPage`): decisión GO = per-ítem SOLO combos; el manual va por "Descuento general". El input del POS pasó a read-only (toggle %/$ deshabilitado, hint "auto (combos)"/"por combo"); lo escribe solo `aplicarCombo`/auto-combo. Cierra la inconsistencia: en un tenant SIN combos el auto-combo no corría (`if (!combosDisp.length) return`) y un valor manual persistía. La matemática de subtotal/IVA no cambió. e2e 45/48 usan "Descuento general" (`max="100"`) → no afectados.
- **(b) Estado "sin clave" VISIBLE** (H3, decisión GO = rol-only + mostrar estado sin forzar): `pedirClaveMaestra` (VentasPage) emite toast 🔓 informativo cuando no hay clave (anular despachada / cambiar cliente / devolución cobrada); CajaPage muestra nota gris en cierre de caja ajena sin clave; InventarioPage aclara en el modal de saltar reconteo; ConfigPage muestra badge "○ Sin configurar — acciones sensibles autorizadas solo por rol".

**Residual Tanda A — 3 specs e2e VERDES (REGLA #0), validados por DB + DEV dejado limpio:**
- ✅ **spec 50 `50_rrhh_pagar_nomina_mutante`** — RPC `pagar_nomina_empleado` (mig 145): pago en efectivo de una liquidación impaga desde Caja Principal → toast "Nómina pagada" + DB `rrhh_salarios.pagado=true`/`medio_pago`/`caja_movimiento_id` + `caja_movimientos` egreso $100 "Nomina … - 06/2026". Fixture SQL = empleado inactivo "ZZZ Nomina Test" + salario neto $100. **Dato de integridad:** la FK `rrhh_salarios.caja_movimiento_id → caja_movimientos` impide borrar el egreso de una nómina paga.
- ✅ **spec 51 `51_autorizacion_ajuste_aprobar_mutante`** — aprobación por 2 actores (mig 228): complementa la spec 47 ("solicita") con el "aprueba" → el DUEÑO aprueba una `ajuste_conteo` pendiente (esperado 126→contado 127, solicitada por "Supervisor Test") → stock muta SOLO al aprobar (`inventario_lineas.cantidad` 126→127, `stock_actual` 250→251, `movimientos_stock` ajuste_ingreso, `estado='aprobada'`/`aprobado_por`=DUEÑO≠solicitante). Fixture SQL = autorización pendiente sobre LPN-MNB85SGE de "Coca Cola 1.5L Original". El botón Aprobar usa `confirm()` nativo → el spec lo acepta.
  - **🐛 Bug de UI hallado durante el e2e (CORREGIDO):** la lista de Autorizaciones (`InventarioPage`) rotulaba `ajuste_conteo` y `bulk_edit` como **"Eliminar LPN"** (el `tipoLabel` no los cubría → caía al `else`); un DUEÑO veía "Eliminar LPN" al aprobar algo que en realidad SUMA stock — engañoso (REGLA #0, inventario). Fix: label "Diferencia de conteo"/"Edición masiva" + color naranja/azul + detalle esperado→contado / campos.
- ✅ **spec 52 `52_over_receipt_bloquea_mutante`** — over-receipt SIN tolerancia: con `permite_over_receipt=false`, recibir 7 contra una OC de pedido 5 (producto simple) → guard B3 (`superaOverReceipt` cableado en `RecepcionesPage.guardar`) BLOQUEA ("…supera lo permitido sobre lo pedido (5)") y NO crea recepción (DB: OC sigue `confirmada`, 0 recepciones). La matriz CON/SIN tope ya está en unit (`recepcionLogic.test.ts`); el efecto stock+OC del éxito en spec 35. Fixture SQL = OC #16 confirmada (Mayorista Pepe, Sprite x5).
- Los 3 con **skip-guard** (patrón 45/48) → el full-suite no falla sin fixtures (re-sembrar el SQL para re-correr). Navegación de tabs endurecida (espera el tab visible) por flake de cold-load del dev server.

**Residual Tanda A restante:** §29 fiscal AFIP (bloqueado por trámite de GO — cert/token de PRODUCCIÓN en ARCA + opcional CUIT RI de homologación). Sub-ítems menores → Tanda B (doble validación de nómina rol≠DUEÑO, B1c over/under requiere SUPERVISOR, camino CON-dentro-de-tope con efecto por UI).

**Deploy:** commit en `dev` (solo los archivos de esta sesión; se dejan afuera `supabase/.temp/cli-latest` y untracked pre-existentes) → push (Vercel DEV) → PR dev→main → merge (Vercel PROD) → release `v1.84.0`. **▶ Próximo:** orden sugerido del UAT (Ventas/POS → Caja → Inventario → …), multi-tenant.

---

## [2026-06-22] update | Decisión punto 2 (descuento por-ítem = solo combos) + handoff para /clear → próxima sesión = UAT exhaustivo

**Decisión de GO:** **descuento por-ítem = SOLO combos; el manual va por "Descuento general".** ⇒ el auto-combo que strippea descuentos por-ítem huérfanos (hallazgo spec 45) es **by-design** — hallazgo CERRADO. **Follow-up menor para la sesión UAT:** hacer el input de descuento por-ítem **read-only** (hoy, en un tenant SIN combos, un descuento por-ítem manual aún persistiría).

**Handoff /clear:** repo limpio + pusheado, PROD READY (v1.83.0). **Próxima sesión = UAT EXHAUSTIVO de toda la app, multi-tenant (Jorgito + Familia Otranto), cero issues go-live.** Plan + orden de módulos + harness + gotchas en `project_pendientes.md` (bloque "ARRANCÁ ACÁ"). Tanda A e2e: 6 specs verdes (45-49). Decisiones de los 9 puntos resueltas (ídem). Pendientes de código a meter durante la UAT: (a) input descuento por-ítem read-only; (b) mostrar estado "sin clave" en acciones rol-only (H3).

---

## [2026-06-22] deploy | 🚀 v1.83.0 EN PROD — caja preferida server-side + origen traspaso/depósito + limpieza columnas (migs 239-240) + Tanda A specs 48/49

**Pedido de GO (9 puntos + norte UAT):** dejar todo 100% funcional sin issues, multi-tenant. Resoluciones:

**v1.83.0 (PR #238, migs 239+240, DEV+PROD = migs 001-240):**
- **Punto 6 — caja preferida server-side (mig 239 `users.caja_preferida_id`):** la "caja predeterminada" vivía solo en localStorage (por dispositivo) → se perdía y "no aparecía" la auto-selección. Ahora se persiste **por usuario en DB** → auto-selecciona SIEMPRE en POS + Caja, en cualquier dispositivo. ★ en Caja escribe en DB + store (toggle on/off); lectura DB con fallback a localStorage. **Traspaso caja→caja**: ya asumía la caja activa como origen (sin selector) — confirmado. **Depósito a Caja Fuerte desde una caja**: pre-selecciona la caja activa. **Convertir presupuesto 2+ cajas**: con preferida resuelve solo + mensaje claro si no hay.
- **Punto 4 — limpieza (mig 240):** DROP de `tenants.descuento_max_cajero_pct`, `email_legal`, `recepcion_alerta_faltante_dias` (0 referencias en frontend/EF/triggers, verificado). Tipos TS limpiados.
- typecheck + build verdes. Migs aplicadas en PROD antes del merge (additive/cleanup, no rompen v1.82.0). El merge resolvió la divergencia de squash (merge `-s ours` de origin/main en dev: dev ya era superset).

**Tanda A e2e — +2 specs VERDES (multi-tenant, en Familia Otranto De Porto = tenant SIN clave):**
- ✅ **spec 48** — descuento sobre tope SIN clave → bloquea sin override ("Pedí autorización", no hay modal de clave). Cierra matriz H3 CON/SIN.
- ✅ **spec 49** — morosidad CC: cliente con deuda vencida + `cc_morosidad_politica='bloqueo_total'` → "No puede comprar hasta saldar". Capa UI del guard 234.
- Harness del tenant sin clave: usuario `e2e.fotranto.sup@local.com`/`Test1234!` + project `chromium-fotranto-sup`. Fixtures persistidos en ese tenant de prueba: `descuento_max_supervisor_pct=10`, `cc_morosidad_politica='bloqueo_total'`, "Mantecol Clasico 111g" priceado+ubicado, cliente "ZZZ Morosidad Test" + venta CC vencida. **Gotcha multi-tenant:** Familia Otranto tiene stock SIN ubicar (en avanzado el POS solo surte stock ubicado) y facturación OFF (la sección Cliente no tiene toggle "Cliente registrado") → diferencias reales vs Jorgito que validan robustez para go-live.

**Resoluciones de los 9 puntos:**
1. **H3 sin clave** → rol-only by-design (mi rec aceptada); pendiente menor: mostrar el estado "sin clave" en esas acciones (no fuerza configurarla).
2. **Descuento por ítem** → GO valida con socio; relevamiento (G3): NO hay edición libre de precio, solo descuento por %; lo aplican SOLO DUEÑO/SUPERVISOR/ADMIN; el **CAJERO está 100% bloqueado** de descuentos (ítem y global), solo ve descuentos automáticos pre-autorizados (C3). ⇒ "el cajero no pone descuento" = correcto/ya implementado. El per-ítem manual SÍ existe para roles autorizados → el auto-combo que lo strippea (hallazgo spec 45) está en tensión con G3 (a decidir).
3. **AFIP** → GO hace el trámite de PRODUCCIÓN; para RI de homologación, conseguir un CUIT RI y que su dueño genere/delegue el certificado (el CUIT solo NO alcanza). Ver respuesta detallada.
4. **Limpieza columnas** → HECHO (mig 240).
5. **Performance 646 lints** → agendado (backlog, ver después).
6. **Caja preferida + traspaso** → HECHO (v1.83.0).
7. **Finanzas/Tesorería** → se mantiene como está (Bóveda = tesorería de-facto) hasta requerir flujo de caja en el tiempo. Decisión registrada.
8. **Hard delete tenant** → diferido.
9. **Multi-tenant testing** → adoptado como práctica permanente (specs 48/49 ya corren en Familia Otranto).

---

## [2026-06-22] deploy | 🚀 v1.82.0 EN PROD — precio_redondeo (H4 cerrado) + descuento máx hueco $ + H3 doc + H4 flags huérfanos (frontend, sin migración)

**Pedido de GO:** "seguimos con precio_redondeo y luego pasás todo lo pendiente a PROD" — autónomo, con OK para deployar. Cierra el backlog de flags huérfanos (H4) y sube a PROD todo el frontend acumulado en `dev` desde el 21/06.

**precio_redondeo (último flag de H4) — REGLA #0, plata/fiscal:**
- Helper puro **`redondearPrecio(precio, modo)`** (`src/lib/precioRedondeo.ts`): redondea al múltiplo más cercano (10/50/100/500/1000), round-half-up, **fail-safe** (modo `none`/desconocido/precio inválido → sin cambios; default `none` ⇒ ningún tenant cambia sin configurarlo). +16 unit.
- Aplicado en el **punto canónico**: se separó `precioTierBase` (precio de lista/tier, SIN redondeo, solo para el label "Precio mayorista") de **`precioTierEfectivo`** (= `redondearPrecio(base)`, redondeado). Como TODA la plata del POS pasa por `precioTierEfectivo` (subtotal, base de descuento, `venta_items.precio_unitario`), el redondeo se propaga **consistente** a subtotal → IVA → factura/NC (que leen `venta_items`). Sin doble redondeo aguas abajo.
- También en `actualizarPrecios` (refresh de precios de un presupuesto desde el catálogo) → mismo redondeo, para que un presupuesto refrescado quede consistente con una venta nueva.
- **Sin migración** (la columna `tenants.precio_redondeo` ya existía desde mig 123).
- typecheck + build verdes; 97 unit money-path (precioRedondeo + ventasValidation + facturacion + cajaSaldo) verdes.

**Lo que sube a PROD con v1.82.0 (todo frontend, migs 001-238 ya estaban en PROD):**
- **precio_redondeo** (esta sesión).
- **Descuento máx por rol** (21/06): cierre del hueco del descuento por **$** que esquivaba el tope **%** (`validarDescuentosPorRol`, lib pura). NO guard server-side (decisión: no rompe integridad fiscal/contable; es control de autorización).
- **H3** (21/06): matriz clave maestra CON/SIN documentada + validada server-side por impersonación (solo doc/validación, sin cambio de código de prod salvo lo ya incluido).
- **H4** (22/06): `descuento_max_cajero_pct` y `email_legal` QUITADOS del frontend (columnas DB inertes); `boveda_umbral_caja` → alerta no-bloqueante (`cajasSobreUmbralBoveda`, badge + AlertasPage); tab RRHH de Config CONSTRUIDO (6 flags); `conteo_modo='elegir'` no era bug.

**Deploy:** APP_VERSION → v1.82.0; commit `9609ced8` en dev; PR dev→main; release `v1.82.0` (--latest). EFs sin cambios. **PROD = DEV = v1.82.0, migs 001-238.**

**▶ H4 CERRADO al 100%.** Próximo norte: **Tanda A e2e** (REGLA #0 sin e2e).

**Tanda A e2e — 3 specs EN VERDE (mismo día, REGLA #0):**
- ✅ **spec 45 `45_descuento_supervisor_tope_mutante`** (`chromium-supervisor`): descuento general 30% > tope 10% → **gate de clave maestra** ("supera el límite del SUPERVISOR") → clave incorrecta **bloquea** (server-side `verificar_clave_maestra`) → clave correcta **autoriza** (override, cierra el modal). Valida `validarDescuentosPorRol` (hueco $/% v1.81.0/v1.82.0) + verificación server-side de clave. Fixture `descuento_max_supervisor_pct=10`.
- ✅ **spec 46 `46_cc_limite_bloquear_mutante`** (`chromium`/OWNER): cliente CC `limite_credito=1` + `cc_enforcement_politica='bloquear'` → venta 100% a CC ($5000 > $1) → "supera el límite … Operación bloqueada.", venta NO creada. Capa UI del guard server `fn_ventas_cc_guard` (mig 234). Fixtures: cliente "ZZZ CC Limite Test" + policy.
- ✅ **spec 47 `47_conteo_autorizacion_rol_mutante`** (`chromium-supervisor`): SUPERVISOR finaliza conteo con diferencia +1 → NO ajusta al toque → "pendiente de aprobación" + fila `autorizaciones_inventario` tipo 'ajuste_conteo' (verificado en DB, stock sin cambiar). Complementa spec 36 (DUEÑO directo). Autorización por rol mig 228.
- Las 3 verdes en **corrida combinada**; 45/46 con **skip-guard** (patrón 35/42) → full-suite no falla sin fixtures. **Fixtures SQL reseteadas** tras correr (DEV limpio: `descuento_max_supervisor_pct=null`, `cc_enforcement='avisar'`, cliente y autorización de prueba borrados).
- **🔎 Hallazgo (NO REGLA #0):** el efecto auto-combo de `VentasPage` (~2200) **strippea el descuento por-ítem si no hay combo asociado** → el descuento manual del operador es el **"Descuento general"** (`descuentoTotal`); el por-ítem es combo-managed. Errra hacia precio más alto (no rompe plata/IVA). **A confirmar con GO**.
- **Gotchas e2e:** inputs `type=number` del POS controlados por React → native value-setter + `dispatchEvent('input',{bubbles:true})`; "Descuento general" solo en modo ≠ presupuesto; venta 100% CC → el CTA es "Despachar (cuenta corriente)"; el check de descuento/CC corre antes que caja/pago.
- ✅ **spec 48 `48_descuento_sin_clave_bloquea_mutante`** (`chromium-fotranto-sup`, **tenant SIN clave "Familia Otranto De Porto"**): descuento 30% > tope 10% SIN clave → se BLOQUEA con "Descuento no autorizado… Pedí autorización" y **NO aparece el modal de clave** (sin override). Cierra la matriz H3 CON/SIN (contraparte de la spec 45). **Multi-tenant** (pedido de GO para go-live). Harness nuevo: usuario de prueba `e2e.fotranto.sup@local.com`/`Test1234!` (SUPERVISOR), `auth.fotranto-sup.setup.ts` + project gated por `E2E_FOTRANTO_SUP_*`. Fixtures persistidos en ese tenant de prueba: `descuento_max_supervisor_pct=10` + "Mantecol Clasico 111g" con precio. **Hallazgo del tenant:** su stock estaba sin ubicar → en avanzado el POS no surte stock no-ubicado (`soloUbicado`) → se ubicó/priceó un producto.
- ⏳ **Residual Tanda A** (ver `project_pendientes.md`): §29 fiscal AFIP (lo que falta es de GO — cert/token de PRODUCCIÓN en ARCA + opcional un CUIT RI de homologación; ver bloque AFIP en project_pendientes), morosidad CC (guard 234 ya 8/8), pagar nómina, over-receipt, aprobación de ajuste con 2 actores.

**🧾 Aclaración AFIP (pedido de GO):** Jorgito está en HOMOLOGACIÓN. Lo que YA testeo: CAE real de homologación para la condición actual (Monotributo→Factura C, specs 21/42). Lo que NO puedo hacer yo: (1) PRODUCCIÓN — generar cert/token de producción en ARCA con la clave fiscal de GO; (2) matriz §29 RI/Exento con CAE real — AFIP valida la condición contra SU registro del CUIT (el de prueba es Monotributo), hace falta un CUIT RI dado de alta en homologación de AFIP. Detalle + lista consolidada de decisiones/dudas abiertas en `project_pendientes.md`.

---

## [2026-06-22] update | H4 — flags huérfanos resueltos (quitar 2, alerta de bóveda, tab RRHH de Config) — EN DEV, sin migración

**Pedido de GO:** "vamos con H4". Decisiones tomadas por AskUserQuestion + recomendaciones. Sin migración (solo frontend). typecheck + build + 45 unit (ventasValidation + cajaSaldo) verdes. **Antes de tocar, verifiqué el estado REAL de cada flag** (no me fié del resumen del audit) → 2 findings del audit estaban **stale**.

**Resoluciones por flag:**
- **`descuento_max_cajero_pct` → QUITADO del frontend** (GO eligió quitar). El campo ni se renderizaba en Config (solo estado+save muertos); se sacó el estado, el save y los hints muertos en `VentasPage` (la rama CAJERO de los hints nunca se alcanza por `descuentoBloqueadoCajero`). El cajero queda siempre 100% bloqueado (regla C3/G3). La columna DB queda inerte.
- **`email_legal` → QUITADO del frontend** (GO delegó; recomendé quitar). Razón: `tenant.email` ya cubre comprobantes + emails salientes; no hay caso de uso; ponerlo en comprobantes es fiscal-adjacent e inusual; un "contacto legal interno" sería feature que nadie pidió. Se sacó el input + estado + save de Config. Columna DB inerte.
- **`boveda_umbral_caja` → IMPLEMENTADO como alerta no-bloqueante** (GO: "sí"). Cuando una caja operativa ABIERTA (excluye la Caja Fuerte permanente) tiene efectivo sobre el umbral → alerta "conviene depositar a la Caja Fuerte". Helper puro **`cajasSobreUmbralBoveda`** en `cajaSaldo.ts` (+4 unit, usa el mismo cálculo de efectivo que CajaPage) compartido por **`useAlertas`** (badge del sidebar) y **`AlertasPage`** (lista visible) vía `cajasSobreUmbralBovedaDelTenant` → no divergen (regla del badge mode-aware). Ambos modos. No muta plata, solo avisa. Validado el query contra datos reales de DEV (Caja Principal $35k / Caja1 $6k).
- **Tab RRHH de Config → CONSTRUIDO** (GO: "sí"). Eran **6** flags huérfanos reales (no ~11 — los demás `rrhh_*` ya tenían setter dentro de RrhhPage): `rrhh_tardanza_modo` (registrar/proporcional/umbral), `rrhh_tardanza_tolerancia_min`, `rrhh_horas_mes_base`, `rrhh_horas_extra_requiere_aprobacion`, `rrhh_doc_alerta_dias`, `rrhh_nomina_supervisor_aprueba`. Tab con 3 secciones (Asistencia/tardanzas, Nómina, Documentos) + `handleSaveBiz`; se sacó el badge "pronto". Las 6 columnas existen en DB (verificado). `setTenant(data)` ya sincroniza el store post-save.
- **`conteo_modo='elegir'` → NO ERA BUG** (finding stale). Verificado: Config ofrece las 3 opciones (`ConfigPage:2936`) y el runtime muestra el toggle Rápido/Guiado al crear el conteo (`InventarioPage:5040`). Cerrado sin tocar.
- **`recepcion_alerta_faltante_dias`**: columna muerta (ni set ni read en src) → no se construyó (GO no la pidió, valor mínimo). Limpiar en una pasada de DB.
- **`precio_redondeo` → DIFERIDO a su propia sesión** (el más valioso pero fiscal + amplio: el precio entra por retail/mayorista/USD/edición manual y la factura/IVA derivan de él). Plan: helper puro `redondearPrecio` + unit, en el punto canónico del precio unitario efectivo. No rushear entre otros 5.

**Pendiente real de H4:** solo `precio_redondeo` (su sesión). Próximo: Tanda A e2e.

---

## [2026-06-21] update | Descuento máx por rol (hueco $ cerrado, sin guard) + H3 clave CON/SIN contrastado y validado server-side — EN DEV, sin migración

**Pedido de GO:** "sigamos con lo de Descuento máx por rol y H3". Backlog residual del hardening (`uat-app.md` §2). Sin migración: solo frontend + validación SQL en DEV. typecheck + build + 34 unit de `ventasValidation` verdes.

**1) Descuento máx por rol — decisión + fix:**
- **Decisión: NO guard server-side.** Es el único ítem H1 que NO es cleanly-triggereable: (a) el override por clave maestra del DUEÑO autoriza un descuento sobre tope, pero la venta la crea igual el CAJERO → un hard-block en trigger rompería el flujo autorizado y no hay forma de que el trigger sepa que la clave se ingresó; (b) los descuentos por ítem viven en `venta_items` (insertados DESPUÉS de `ventas`) y los descuentos por **monto** se pliegan al `subtotal` → invisibles a un trigger BEFORE INSERT en `ventas`; (c) un descuento sobre tope **no rompe la integridad fiscal/contable** (la venta queda consistente: total, IVA, caja, CC) → fuera del scope estricto de la REGLA #0; es un control de autorización, no un invariante de plata.
- **SÍ se cerró el HUECO REAL del enforcement client-side:** un descuento por **$ (monto)** esquivaba el tope **%** del SUPERVISOR/canal porque el check solo miraba `descuento_tipo==='pct'` (`VentasPage` registrarVenta). Ahora todo descuento se convierte a su **% efectivo** (`descuentoEfectivoPct` = monto/base×100) y se valida con **`validarDescuentosPorRol`** — lib pura nueva en `src/lib/ventasValidation.ts` con su batería de unit. El override por clave maestra queda igual (CON clave → autoriza; SIN clave → bloquea). `descuento_max_cajero_pct` sigue inerte (cajero 100% bloqueado de descuentos) → su decisión (quitar / re-significar) va a **H4**.

**2) H3 — clave maestra CON vs SIN — contrastado + validado server-side en DEV:**
- **Primitivo `verificar_clave_maestra` (mig 233) validado:** clave correcta → `true`; incorrecta → `false`; `NULL` → `false`; **tenant SIN clave configurada → `true` SIEMPRE** ("no hay clave = no se exige"). Todos los gates heredan el contrato.
- **RPC `marcar_incobrable` (mig 236) validado por impersonación SQL (transacción + ROLLBACK, sin tocar datos):** DUEÑO + clave correcta → ejecuta; DUEÑO + clave incorrecta → `42501 Clave maestra incorrecta.`; CAJERO + clave correcta → `42501 No autorizado` (el rol se chequea ANTES que la clave). ⇒ el gate es **server-side real**, no bypasseable por bundle cacheado/API.
- **Matriz CON/SIN completa** (8 acciones) documentada en `uat-app.md` §H3. **Hallazgo:** la clave es un **2º factor opt-in** y el comportamiento SIN clave NO es uniforme → donde hay **límite numérico** (umbral de doble firma de OC/courier, tope de descuento) SIN clave **bloquea** (el límite manda); donde es una **acción patrimonial discrecional sin umbral** (anular despachada, incobrable, cerrar caja ajena, saltar reconteo) SIN clave **el rol es el único gate**. Coherente, pero no estaba documentado ni testeado.
- **▶ Decisión pendiente para GO (no bloqueante):** ¿las acciones "pasa sin clave" deberían avisar/forzar configurar la clave cuando el negocio quiere el 2º factor, o se dejan rol-only by-design?
- Falta solo el **e2e click-through** de H3 (toggle de la clave del tenant) — va en **Tanda A**.

**Próximo (a confirmar con GO):** H4 (flags huérfanos) y/o Tanda A e2e.

---

## [2026-06-21] deploy | 🚀 v1.81.0 EN PROD — guards server-side de plata COMPLETOS (RPCs clave-gated: incobrable / pago OC / pago courier) + reorder comprobante

**Pedido de GO:** "terminar los guards y pasarlos TODOS a PROD." Decisiones de scope (AskUserQuestion): doble firma OC/courier → **RPC completo** (no el fix client-side); comprobante de gasto → **reorder frontend sin trigger** (un trigger blanket rompería ~13 inserts de gastos automáticos —nómina/courier/devolución/incobrable— que legítimamente no llevan comprobante).

**Cierra H1/H2 de `tests/specs/uat-app.md` (controles financieros solo client-side). 5 migraciones, DEV → PROD (PROD = DEV = migs 001-238):**
- **234** `fn_ventas_cc_guard` + **235** `fn_ventas_writeoff_rol_guard` (estaban EN DEV desde el 21/06; ahora también en PROD).
- **236 `marcar_incobrable()`** — RPC SECURITY DEFINER: rol (DUEÑO/SUPER_USUARIO/ADMIN) + **clave maestra verificada server-side** (antes solo client-side, y se omitía si no estaba configurada) + write-off atómico (condona toda la deuda CC del cliente + gasto "Deudor incobrable").
- **237 `registrar_pago_oc()`** — RPC atómico del pago de OC: rol (no CONTADOR) + **doble firma server-side** sobre el umbral + saldo no excedible; escribe OC + proveedor_cc (pago/oc) + cheque + caja en UNA transacción. **Cierra el hueco "se omite si no hay clave":** si supera el umbral y el tenant NO tiene clave, BLOQUEA y pide configurarla.
- **238 `marcar_envios_pagados()`** — ídem para el pago a courier (agrupa por courier, gasto con desglose de IVA + caja + marca pagado, doble firma server-side).

**Frontend (v1.81.0):** `ClientesPage.confirmarIncobrable` / `GastosPage.registrarPagoOC` / `EnviosPage.marcarPagados` llaman a los RPCs (el pre-check de clave queda como UX; el enforcement real es el RPC). **Comprobante de gasto:** se sube **ANTES** del INSERT (`comprobante_url` atómico) — arregla un bug latente: en el camino de autorización por umbral el archivo del cajero **nunca se subía** (el INSERT+upload posterior nunca corría por el return temprano).

**Validación en DEV (impersonando por rol, en transacción con ROLLBACK + verificación del efecto en DB):**
- incobrable: CAJERO bloqueado / clave incorrecta bloqueada / DUEÑO+clave → venta marcada `Incobrable` + gasto creado. ✅
- pago OC (7 escenarios): bajo umbral OK / sobre umbral sin clave bloquea / con clave OK / CONTADOR bloqueado / supera saldo bloquea / 100% CC → `cuenta_corriente` con vencimiento / **sin clave configurada → bloquea pidiendo configurarla**. Efectos en caja + proveedor_cc correctos. ✅
- pago courier (6 escenarios): bajo umbral / sobre sin clave bloquea / con clave OK / **multi-courier → 2 grupos/2 gastos** / `genera_gasto=false` marca pagado sin gasto / **sin clave configurada bloquea**. ✅ (el `iva=null` en los gastos nuevos es el guard fiscal mig 227 saneando por Monotributista — esperado.)
- typecheck + build verdes; 82 unit de libs relacionadas (comprasPermisos/enviosCourierPago/ccLogic) verdes.

**Check de seguridad pre-deploy en PROD:** los 5 tenants usan `cc_enforcement_politica='avisar'` y **sin umbral de doble firma OC/courier** → los guards quedan **dormidos** (las ramas de hard-block recién actúan si un tenant configura `bloquear`/umbral) → cero impacto en la operación actual. Verificado: 2 triggers + 3 funciones presentes en PROD.

**Deploy:** PR #236 dev→main (mergeado, commit `4c06033`), release `v1.81.0` (--latest). EFs sin cambios. **PROD = DEV = v1.81.0, migs 001-238.**

**▶ Backlog del hardening que queda (no bloqueante):** descuento máx por rol (bajo valor; el CAJERO ya está 100% bloqueado de descuentos); H3 (clave CON vs SIN — ahora contrastable con los nuevos guards); H4 flags huérfanos (precio_redondeo/email_legal/boveda_umbral/setters RRHH); Tanda A e2e (§29 fiscal runtime, etc.). Todo en `tests/specs/uat-app.md`.

## [2026-06-21] update | 🔍 Auditoría de cobertura (5 agentes) + 🔐 2 guards server-side de CC (migs 234/235 EN DEV)

**Pedido de GO:** listar TODAS las funcionalidades y flags, cruzar contra los UAT, y endurecer con guards server-side. Decisiones de GO: un `uat-app.md` con tags por modo/flag; agentes para enumerar + yo autoría e2e; Tanda A (REGLA #0) primero; implementar el efecto de los flags huérfanos.

**Auditoría F1 (5 agentes read-only en paralelo):** `tests/specs/cobertura/01-05.md` — **~264 lógicas + ~142 flags** de `tenants` con comportamiento CON/SIN, cruzados contra 52 unit + 44 e2e. Consolidado en **`tests/specs/uat-app.md`** (master con tags). **Patrón:** lógica pura bien cubierta por unit; runtime con efecto en DB + flags con/sin casi sin e2e.

**Hallazgos REGLA #0 VERIFICADOS (en `uat-app.md` §2):** H1 controles financieros (límite CC, morosidad, condonación, incobrable, descuento, comprobante) **solo client-side**; H2 doble firma OC/courier bypasseable (se saltea sin clave); H4 **flags huérfanos** (set-only sin lector: `precio_redondeo`/`boveda_umbral_caja`/`email_legal`; ni-set-ni-read: `recepcion_alerta_faltante_dias`; read-sin-setter: `rrhh_tardanza_modo`/`rrhh_horas_mes_base`; ilusorio: `descuento_max_cajero_pct`; semi: `conteo_modo='elegir'`); H5 **kits = NO bug (by-design)** — el rebaje de componentes ocurre al ARMAR el kit, no al venderlo (confirmado con GO + código).

**🔐 2 guards server-side implementados y testeados EN DEV (NO en PROD):**
- **mig 234 `fn_ventas_cc_guard`** (BEFORE INSERT ventas): límite CC (B1) + morosidad (B4), espeja la lógica client-side. **8/8 escenarios verdes.** Computa la deuda **inline scopeada por `NEW.tenant_id`** porque `cliente_cc_estado` filtra por `auth.uid()` y devuelve 0 sin sesión (service-role/API/batch lo saltarían) — hallazgo importante.
- **mig 235 `fn_ventas_writeoff_rol_guard`** (BEFORE UPDATE ventas): exige rol DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN cuando se agrega un tag `Condonación CC`/`Incobrable` nuevo. **4/4 verdes** (impersonando DUEÑO vs CAJERO). No afecta cobranza normal ni revertir.
- ⚠ **DRIFT INTENCIONAL: DEV = migs 001-235, PROD = 001-233.** Los guards NO van a PROD hasta completar el set + OK de GO (cambian comportamiento: hard-block donde antes solo la UI).

**Lo que NO es trigger-able (verificado, requiere frontend/RPC — NO se rusheó, REGLA #0):** doble firma + clave del incobrable (la clave se verifica, no se puede en un trigger → RPC); comprobante de gasto (`comprobante_url` se linkea en UPDATE post-INSERT → un trigger BEFORE INSERT rompería el alta de gastos → reordenar frontend). Plan por ítem en `uat-app.md`.

**H4 flags huérfanos:** GO pidió implementar el efecto; tras verificar el alcance, cada uno necesita trabajo cuidadoso (precio_redondeo = feature de precios amplia+fiscal; email_legal/boveda = intención a definir; setters RRHH = construir UI). Plan por flag en `uat-app.md` §2/H4. **No se rusheó pricing al final de la sesión.**

## [2026-06-21] update | 🚀 v1.80.2 EN PROD — clave maestra hash (mig 233) deployada + validación e2e #6/#10/#11

**Deploy a PROD (v1.80.2, PR #235, release v1.80.2):**
- **🔐 mig 233 (clave maestra hash) APLICADA EN PROD.** La `clave_maestra` deja de estar en TEXTO PLANO → bcrypt. El backfill hasheó la única clave plaintext de los 5 tenants (preservando el valor); `verificar_clave_maestra` compara por hash (con fallback compat); RPC `set_clave_maestra` (DUEÑO, mín 6) activo; `ConfigPage` con campo de confirmación + guarda vía el RPC. pgcrypto verificado en `extensions` de PROD. **PROD = DEV = migs 001-233.**
- **🧹 Drift de branch corregido:** `origin/main` tenía archivos de migración solo hasta 230, pero PROD DB tenía 232 aplicadas (231/232 se habían aplicado directo a la DB sin que los archivos llegaran a main). El merge del PR #235 incorporó los archivos de migs **231/232/233** a main. Ahora repo `main` == PROD DB.

**🧪 Validación e2e por click-through (aserción positiva + efecto verificado en DB) — cierra #6/#10/#11 del backlog:**
- **#6 NC fiscal (spec `42_nc_fiscal_mutante`):** devolución de venta facturada (fixture sobre venta #239, Factura C #31) → botón "Emitir NC" → la EF `emitir-factura` emite la NC electrónica con `CbtesAsoc` referenciando la factura original → **CAE real de AFIP homologación**. Verificado en DB: NC-C #2 (`nc_cae 86250459279279`) + NC-C #3 (`86250459291162`), numeración consecutiva, sin error 10197/10040. Fixture armada (NC-239-3) para la próxima corrida. **AFIP homologación respondió OK.** *La devolución se siembra como fixture (su happy-path monetario es frágil y ya está cubierto por reachability en spec 22); lo que valida #6 es la EMISIÓN FISCAL de la NC.*
- **#10 Productos (spec `43_producto_creacion_mutante`):** alta de producto por UI con alícuota **10,5%** → persiste `alicuota_iva=10.5` (NO 21). Ejercita end-to-end el camino del bug GRAVE v1.78.1 (`0 || 21` / numeric mal normalizado). Verificado en DB.
- **#11 Presupuestos (spec `44_presupuesto_convertir_mutante`):** crear presupuesto con cliente (NO toca stock ni caja) → desde Historial "Finalizar (rebaja stock)" → modal de saldo con medio no-efectivo → despacha con **rebaje real** (PRES-08). Verificado en DB: Coca Cola Norte 250→247 (3 ciclos), ventas 241/242/243 desde presupuestos 15/16/17, cada una con su movimiento `rebaje`.

**⚠️ Gotcha de UX detectado (anotado, NO bloqueante, NO es bug de plata/stock):** convertir un presupuesto a despachada **desde el Historial** con **2+ cajas operativas abiertas y sin caja preferida** dispara "Hay varias cajas abiertas. Seleccioná en cuál registrar" (`cambiarEstado`, VentasPage:3644) pero ese flujo (detalle de venta → Finalizar → modal de saldo) **no expone un selector de caja** → callejón sin salida. Bloquea con seguridad (no rompe nada), pero el usuario no puede finalizar hasta setear caja preferida o cerrar una caja. Sugerencia: exponer el selector de caja en el modal de saldo del convert, o resolver por caja preferida del user. (En el POS directo sí hay selector "Registrar en caja"; el hueco es solo el convert desde historial.)

**Método e2e (recordatorio):** aserción POSITIVA del resultado (toast/efecto) + verificar la mutación en DB con SQL; nunca solo `.not.toBeVisible()`. Las fixtures por SQL para saltear pasos frágiles/cross-módulo (devolución, OC) son patrón aceptado (specs 35/42). El convert de presupuesto exige caja elegida cuando hay 2+ abiertas → seleccionar caja en el POS antes de cambiar a modo Presupuesto.

## [2026-06-20] update | 🔐 Clave maestra HASHEADA (mig 233) + confirmación/validación en Config — EN DEV (PROD pendiente)

Disparado por GO: tenía guardada "12345678" pero la clave real era "123456". **Investigación:** la app NO trunca a 6 — la columna `tenants.clave_maestra` es `text`, el input de Config no tiene `maxLength`/`slice`, y es el único setter → lo guardado (123456) fue lo que efectivamente se tipeó. **PERO** se hallaron 3 huecos REGLA #0 (control/seguridad): (1) **sin campo de confirmación** + input enmascarado → se podía guardar una clave distinta a la querida sin aviso (lo que le pasó a GO); (2) **guardada en TEXTO PLANO** (comparación directa en `verificar_clave_maestra`) y viajaba al cliente en el objeto tenant; (3) sin mínimo de longitud. La clave gatea acciones patrimoniales (anular, abrir caja con diferencia, cerrar caja ajena, **dar de baja incobrable**, pago OC/courier sobre umbral). **GO eligió el endurecimiento completo (confirmación + hashear).**

**mig 233 (DEV; PROD pendiente):** (a) backfill — hashea con **bcrypt** (`extensions.crypt`/`gen_salt('bf')`) las claves en texto plano (preserva el VALOR, no es reescritura de historial); (b) `verificar_clave_maestra` reescrita para comparar contra el hash (con fallback compat a texto plano); (c) nuevo RPC **`set_clave_maestra(p_clave)`** SECURITY DEFINER — solo **DUEÑO** del tenant, mínimo 6 caracteres, hashea server-side. **Frontend (`ConfigPage`):** campo "Repetí la clave maestra" (debe coincidir, feedback en vivo) + mínimo 6 + ahora guarda vía el RPC (ya NO escribe `clave_maestra` directo). typecheck + build verdes.

**Validado en DEV:** clave de Almacén Jorgito → bcrypt (`$2a$06$…`); `verificar('123456')`/`('12345678')`/`('wrong')` correctos; spec e2e `41_clave_maestra_set_hash_mutante` setea la clave por UI con confirmación → el RPC re-hashea (hash nuevo) y verifica. **Se dejó la clave del tenant de prueba = `12345678`** (el valor que GO esperaba) + spec `40` actualizado a esa clave. **▶ PROD pendiente:** aplicar mig 233 + deploy de `ConfigPage` (bump versión + PR dev→main) — GO decide. **Mejora futura menor:** no enviar el hash de `clave_maestra` al cliente (hoy va en el objeto tenant; es hash, no plano, pero idealmente se omite del select).

## [2026-06-20] validate | ✅ #6–#9 por click-through: incobrable (clave maestra), envío→combustible→gasto, condonación CC; + AFIP homologación respondió

- **✅ B6 — dar de baja incobrable con clave maestra (spec `40_cc_incobrable_clave_maestra_mutante`).** Con la clave (12345678): salda toda la deuda CC pendiente del cliente (tag 'Incobrable', monto_pagado=total) + genera gasto "Deudor incobrable: …" categoría "Deudores incobrables". **Verificado en DB:** Gaston Otranto #208 saldada + gasto $1557.
- **✅ AFIP homologación RESPONDIÓ** (spec `21_facturacion_mutante` re-corrido a pedido de GO): venta → Factura C → **CAE de homologación** verde en 26s. O sea hoy AFIP está respondiendo → la NC (#6) también debería poder emitirse ahora; el timeout previo era el servicio externo lento, no bug.

## [2026-06-20] validate | ✅ Continuación UAT/e2e — Cheques (#1) + Caja Fuerte UI (#2) validados por click-through con efecto en DB (REGLA #0 contable)

Continuación del backlog de validación por click-through (método: aserción positiva en UI + verificar la mutación en DB). Dos módulos REGLA #0 contable que faltaban:

**✅ #1 Cheques — ciclo completo (spec `31_cheque_gasto_rechazo_mutante`).** Flujo Auditoría #5 end-to-end: (1) alta de un gasto SIN medio → queda `pendiente`; (2) pago con medio **"Cheque"** → crea un cheque `propio`/`entregado` vinculado (`gasto_id`) y deja el gasto `pagado` (`GastosPage.registrarPagoGasto`); (3) en Gastos → Cheques se marca **"Rechazado"** → el pago se **REVIERTE** (`ChequesPanel.cambiarEstado` → `reversionPagoGasto`). **Verificado en DB:** el gasto volvió a `pendiente` con `monto_pagado` **700 → 0.00** y el cheque quedó `rechazado` vinculado al gasto. *(El otro brazo de la reversión — cheque que pagó una OC → revierte la OC + asiento de ajuste en `proveedor_cc_movimientos` — queda para el módulo OC completa, backlog #4.)*

**✅ #2 Caja Fuerte UI — depósito caja→bóveda (spec `32_caja_fuerte_deposito_mutante`).** Antes solo validado a nivel DB; ahora por click-through. Depositar de una caja operativa a la bóveda genera las **dos patas balanceadas** (`CajaPage.operarCajaFuerte`): `egreso_traspaso` en la sesión de la caja origen + `ingreso_traspaso` en la sesión permanente de la bóveda. **Verificado en DB:** $50 `egreso_traspaso` en **Caja1** + $50 `ingreso_traspaso` en **Caja Fuerte / Bóveda**, mismo concepto único.

**✅ #3 Devolución a proveedor — crédito en CC (spec `33_devolucion_proveedor_mutante`).** Devolver 1 unidad de una OC recibida (CO4, `ProveedoresPage.confirmarDevolucion`) con forma "Crédito en CC". **Verificado en DB** (OC #7 Mayorista MAX, Coca Cola 1.5L, sucursal Norte): stock Norte **251→250** (rebaja FIFO) + `stock_actual` **254→253** (trigger) + movimiento `ajuste_rebaje x1`; `proveedor_cc_movimientos` += `nota_credito` **-1000** (CC del proveedor 990 → **-10**, crédito a favor); `devoluciones_proveedor` #1 `confirmada` monto 1000 + ítems. *(Faltan las otras 2 formas: efectivo → `ingreso` a caja; reposición → OC borrador nueva.)*

**✅ #4 OC completa — core validado (2 specs).** **`34_oc_creacion_mutante`:** crear OC por UI (proveedor + producto + cantidad, `saveOC`) → OC #15 `borrador` con Elite Pañuelos x5 (verificado en DB). *Gotcha de autoría:* `openNewOC` ya arranca con una línea de producto vacía → NO clickear "Agregar línea" (genera una 2da línea vacía que rompe la validación de `saveOC`). **`35_recepcion_oc_vinculada_mutante`:** recepción VINCULADA a una OC (vía el botón real "Recibir mercadería", solo visible en `confirmada` → `/recepciones?oc_id=…` auto-abre el form pre-poblado) → **sube stock + la OC pasa a `recibida`** por el acumulado B5 (`estadoOCdesdeRecibido`). **Verificado en DB:** OC #14 → `recibida` + Elite Pañuelos `stock_actual` **134→139** (+5). **Fixture DEV:** OC #14 confirmada de Mayorista MAX (Elite x5) creada por SQL — el ciclo de workflow completo (borrador→enviar→**pagar/asignar a CC**→confirmar) cruza 3 módulos con gate de pago (el "Confirmar" exige `estado_pago` pagada/CC); ese gate de pago de OC queda como pendiente de click-through aparte.

**✅ #5 Conteos de inventario — core validado (spec `36_conteo_ajuste_mutante`).** Conteo 2.0 "Por producto" en modo rápido con diferencia +1 (`InventarioPage.finalizarConteoYAplicar`). Para el **DUEÑO** (modo de autorización `directo`, mig 228) el ajuste se aplica AL TOQUE: `reconciliarDelta` → actualiza `inventario_lineas` + `movimientos_stock`. **Verificado en DB:** Elite Pañuelos `stock_actual` **139→140**, movimiento `ajuste_ingreso x1` motivo "Conteo de inventario — LPN…", `inventario_conteos` estado `finalizado`. *Gotcha:* en modo rápido el "Contado" viene pre-cargado con lo esperado → hay que subirlo +1 para forzar diferencia; el tenant de prueba no tiene gate por umbral ni umbral de reconteo (sin doble conteo). *Pendientes parciales:* la **autorización por rol** (rol ≠ DUEÑO → `autorizaciones_inventario` 'pendiente' → aprobación), el **doble conteo** (umbral de reconteo) y el **ABC/cíclico**.

**✅ #7 RRHH — nómina → gasto (spec `37_rrhh_nomina_gasto_mutante`).** El pago de sueldos se contabiliza en Gastos (RH3/B7, `RrhhPage.generarGastoNomina`). Flujo: tab Nómina → "Generar nómina del mes" (crea las liquidaciones faltantes del período, idempotente — solo las que no existen) → "Generar gasto" en una liquidación. **Verificado en DB:** gasto "Sueldo Gaston Otranto — 2026-06", categoría **Sueldos**, monto **3.000.000** (= neto), `estado_pago` `pendiente`, `rrhh_salarios.gasto_id` vinculado. *Dato fino:* `deduce_ganancias` quedó **false** — el trigger `fn_gastos_iva_guard` (mig 227) lo saneó por ser el tenant **Monotributista** (REGLA #0 consistente, NO bug; el código pedía true pero el guard manda). *(GO eligió RRHH en lugar del #6 NC porque NC depende de AFIP homologación y es flaky en e2e.) Pendientes de RRHH: pagar la nómina (RPC `pagar_nomina_empleado` → caja/CC), cargas sociales acumuladas, recibo PDF, liquidación final/indemnización, asistencia/fichado, vacaciones, anticipos.*

**✅ #8 Envíos — envío propio → combustible → gasto (spec `38_envio_combustible_gasto_mutante`).** En un envío propio con vehículo asignado, "Registrar combustible" (EN7/G2, `EnviosPage.registrarCombustible`) genera un gasto. **Verificado en DB:** gasto "Combustible — envío #15 (Moto Reparto Test)", categoría **Combustible**, monto 5000, `estado_pago` `pagado`, `envios.gasto_combustible_id` vinculado. **Fixture DEV:** se creó un recurso "Moto Reparto Test" (la query `vehiculos` toma cualquier recurso `estado='activo'`, sin filtro de categoría) y se asignó a un envío propio existente (#15) — el botón "Registrar combustible" solo aparece con `courier='Envío propio' && recurso_id`; la fila se expande con el chevron. *Pendientes de Envíos:* crear envío, POD, hoja de ruta/reparto, pago a courier (tercero → egreso).

**✅ #9 Clientes/CC avanzado — condonación de deuda CC (spec `39_cc_condonacion_mutante`).** Condonar una venta CC (ISS-151, `ClientesPage.condonarDeudaCC`) la da por PERDIDA: `ventas.monto_pagado = total` + tag 'Condonación CC' en `medio_pago` (write-off, excluido de ingresos). **Verificado en DB:** Gaston Otranto venta #210 `monto_pagado` 0→4057 (saldo 0), tag 'Condonación CC'; #208 intacta. **🔴 Bloqueo anotado:** el otro flujo de #9 — "dar de baja incobrable" (B6, condona TODA la deuda del cliente + genera gasto "Deudor incobrable") — **exige la clave maestra del tenant** (está configurada y es desconocida/hasheada) → no automatizable por e2e; queda para validar con la clave real. *Pendientes de #9:* crédito a favor (cliente_creditos, vía devolución), intereses CC (sweep `recalcular_intereses_cc`), incobrable B6.

**🔧 Fixture en DEV (tenant de prueba Almacén Jorgito):** se le agregó el método de pago **"Cheque"** (`metodos_pago`, `habilitado_gastos=true`) porque el seed default NO lo incluye — sin él, el flujo de pago con cheque no aparece en el modal de pago. Es solo data de prueba en DEV (no migración, no PROD). **⚠️ Observación menor para GO:** un tenant nuevo no puede pagar con cheque hasta agregar el método "Cheque" a mano (el seed crea Efectivo + 5 métodos, sin Cheque). No es un bug de plata, pero la feature de cheques queda inalcanzable hasta configurarlo — evaluar si conviene sumarlo al seed o documentarlo. typecheck verde; no se tocó código de app (solo 2 specs nuevos).

**🔧 Decisión GO sobre el método "Cheque":** se deja como **config opcional documentada** (NO se suma al seed de alta). Documentado en `G360.Wiki/wiki/features/gastos.md` (sección Cheques): un tenant que quiera pagar con cheque debe agregar el método "Cheque" en Config → Métodos de pago.

**▶ Sigue del backlog (REGLA #0 primero):** #10 Productos (kits/recetas, variantes, mayoristas), #11 Presupuestos (crear→convertir a venta; recurrentes), #12 Config (datos fiscales, métodos de pago, clave maestra), + **bloqueados/diferidos:** #6 NC runtime AFIP (flaky homologación), B6 incobrable + clave maestra real, autorización de conteo por rol ≠ DUEÑO, RRHH pagar nómina/recibo/liquidación final, brazo OC del rechazo de cheque, formas efectivo/reposición de devolución, gate de pago de OC. Resto en `project_pendientes.md`.

## [2026-06-20] validate | 🔴 Validación integral en DEV — regresión del seed (mig 232) + suite e2e 163/164 + diagnóstico unit/AFIP

GO pidió validar TODA la app en DEV manejándola como un usuario. Se corrió el click-through real con Playwright contra DEV + validación DB. **Hallazgos:**

**🔴 REGRESIÓN del seed de alta (mig 232) — la más grave.** Validando un alta desde cero (tenant nuevo) se detectó que un tenant net-new nacía con **0 sucursales, 0 cajas operativas y 0 unidades de medida** (solo la Bóveda). Causa: la **mig 225** (Efectivo por default, 2026-06-18) reescribió `fn_seed_tenant_defaults` y **perdió** la creación de Sucursal 1 + Caja Principal + 6 unidades que tenían las migs 114/148. **Desde el 18/06 TODO tenant nuevo no podía operar sin configurar a mano** — y golpeó a un tenant REAL en PROD ("El muller", creado el 2026-06-20: 0 sucursales, 0 unidades). **mig 232** restaura el set completo en la función + backfill idempotente. Aplicada en **DEV y PROD**. Verificado: tenant nuevo nace completo (Sucursal 1 + Caja Principal + Bóveda + estados + motivos + categorías + 6 unidades + Efectivo + 5 métodos + 7 canales); "El muller" reparado; PROD post-fix con **0 tenants sin sucursal/caja/unidades** (de 5).

**✅ Suite e2e click-through (Playwright contra DEV): 163/164 verde** (9.9 min, owner+supervisor+rrhh+deposito+contador). La única roja: `21_facturacion_mutante` "emite Factura C → CAE AFIP homologación" — **timeout de 30s esperando el toast de CAE**; los logs de la EF muestran solo el OPTIONS preflight (sin POST con error de app) → es la **llamada externa a AFIP homologación lenta** (dependencia externa, el wiki ya lo nota), no un bug. Pendiente: confirmar con una emisión real en homologación (check runtime §29). Tenant de prueba Almacén Jorgito = Monotributista + CUIT + token + 1 PV (puede emitir C).

**⚙️ Unit suite (vitest):** corrió **roja por límite de RAM de jsdom en el sandbox** (el error `Cannot read properties of undefined (reading 'config')` que el propio `vitest.config.ts` documenta como OOM; aun con `fileParallelism:false` el entorno tardó 113s y murió). **NO es la lógica:** un archivo suelto corre **25/25 verde en 2.6s**. Recomendado correr `npm run test:unit` en una máquina con más RAM (la de GO) o en CI.

**🧪 Tenant de testing creado:** `ZZZ_VALIDACION_CLAUDE` (DEV) para validaciones propias, ya seedeado completo. El 2º descartable se borró.

**✅ Flujos de plata REGLA #0 validados por click-through (specs nuevos 27 + 28):**
- **`27_gasto_efectivo_mutante`** — gasto pagado en efectivo → asienta `egreso` en caja (el módulo Gastos solo tenía cobertura read-only). Verde a la primera.
- **`28_cobranza_cc_mutante`** — cobranza de cuenta corriente en efectivo (exige caja abierta) → `ingreso`. **Verificado el efecto real en DB:** la deuda del cliente bajó (5714 → 5614) + 1 ingreso en caja. ⚠️ **Lección:** la 1ra versión dio FALSO-VERDE por una aserción negativa vacua (`Confirmar pago` "not visible" pasaba sin que el panel se abriera) → se reescribió con aserción **positiva** (toast "Pago de $… registrado") + verificación del efecto en DB. **Regla: en e2e mutante, aserción positiva del resultado + verificar la mutación, nunca solo `.not.toBeVisible()`.**
- **`29_recepcion_stock_mutante`** — recepción de mercadería (sin OC) → **sube el stock**. Verificado en DB: "Elite Pañuelos" 133 → 134 + movimiento `ingreso` de 1. *(Gotchas de autoría: la recepción valida campos por producto — exige lote/vencimiento/series si el producto los tiene; se eligió un producto simple.)*
- **`30_traslado_sucursal_mutante`** — traslado entre sucursales: despacha desde el origen (sale stock) y el dueño confirma la recepción en el destino (entra stock, tipo `traslado`). Verificado en DB: Traslado #1 Sucursal Norte → Sur, estado `recibido`. *(La sucursal origen se fija vía `localStorage('sucursal-id')` que lee `useSucursalFilter`.)*
- **🎉 Los 4 flujos elegidos por GO quedaron validados por click-through UI con efecto verificado en DB** (gasto, cobranza CC, recepción→stock, traslado).

**✅ Smoke de primer uso por click-through (spec `26_primer_uso_smoke.spec.ts`) VALIDADO + verde:** se ejecutó y se dejaron verdes los flujos drift-prone que faltaban — **cliente con notas** (la columna que faltaba en PROD, mig 231), **venta no-efectivo Tarjeta** (`ingreso_informativo`), **reserva con seña efectivo** (`ingreso_reserva`, con cliente + seña). PU-11 **Caja Fuerte (`ingreso_traspaso`)** validado a nivel DB sobre el tenant fresco: se insertaron los **7 tipos de `caja_movimientos`** (ingreso/ingreso_informativo/ingreso_traspaso/ingreso_reserva/egreso/egreso_devolucion_sena/egreso_traspaso) y **todos los acepta el CHECK** (confirma mig 229/230 en un alta nueva). Al autorear el spec se confirmó además **comportamiento correcto de la app**: DNI+Teléfono obligatorios en alta de cliente, **no-sobrepago en medios no-efectivo** (tarjeta no admite vuelto), y **cliente obligatorio en reservas** (`cliente_obligatorio` default 'reservas'). Ninguno era bug.

## [2026-06-20] update | UAT primer uso — onboarding (PU-01/02) code-audit + PU-03 seed verificado + e2e smoke PREPARADO (sin ejecutar)

Continuación del UAT de primer uso tras cerrar la paridad. **Onboarding (`OnboardingPage.provisionNegocio`) auditado por código — sin bugs:** `crypto.randomUUID()` para el tenantId (evita el SELECT post-insert que choca con RLS), rollback del tenant si falla el insert de `users`, dedup por `existingUser.tenant_id` + el PK `users.id` (un 2º tenant concurrente se auto-borra al fallar el insert de user), `loadUserData()` antes de `navigate('/dashboard')` (store Zustand), seed vía trigger `fn_seed_tenant_defaults` que falla-fuerte (si el seed rompe, el insert del tenant hace rollback → el alta falla en vez de dejar un tenant a medio-seedear), email de bienvenida no bloqueante. Path "Confirm email ON": signUp con los datos del negocio en el metadata + `emailRedirectTo=/onboarding` → al confirmar, el useEffect detecta sesión+metadata y provisiona. **PU-03 (seed) verificado en DB (DEV):** el tenant más nuevo nace con Sucursal(1) + Caja Principal+Bóveda(2) + estados(2) + motivos(11) + categorías_gasto(16) + cuenta Efectivo(1) + métodos_pago(5) + canales(7), modo básico, trial → opera sin configurar nada. Seed fn byte-idéntica DEV=PROD. **§29 fiscal — confirmado el mapeo de alícuota (MX-03/MF-02):** `String(parseFloat(tasaStr))` normaliza `"21.00"/"10.50"/"0.00"` antes de mapear a `ALICUOTA_ID` (el bug GRAVE de v1.78.1 sigue arreglado, en `facturacionLogic.ts` y espejado en la EF). **e2e PREPARADO sin ejecutar** (decisión GO: la suite e2e + re-corrida de paridad se hacen al CERRAR el desarrollo): `tests/e2e/26_primer_uso_smoke.spec.ts` cubre clientes-con-notas (PU-16, la columna que faltaba en PROD) + venta no-efectivo (PU-09, `ingreso_informativo`) + stubs `test.fixme` para Caja Fuerte (PU-11) y reserva con seña (PU-12). **No validado** — selectores siguen el patrón de 19/20 pero se ajustan en la 1ra corrida.

**Autorización de ajustes por rol (v1.80.0, mig 228) — code-audit ✅ + 🐞 hallazgo concreto que valida la mig 231:** `ajusteAutorizacion.ts` correcto (DUEÑO=directo, resto=siempre; modos directo/umbral/siempre) y sus 3 consumidores (Conteo `ajuste_conteo`, LPN modal, edición masiva `bulk_edit`). **El `bulk_edit` inserta `linea_id: null`** (los IDs van en `datos_cambio.linea_ids`) y DEV lo **rechazaba** porque `autorizaciones_inventario.linea_id` había quedado `NOT NULL` (drift; la mig 103 lo dejó nullable justo para bulk) → **la edición masiva de LPN con aprobación (rol ≠ DUEÑO) estaba ROTA en DEV** (0 filas bulk_edit; los +9 unit tests son lógica pura, no tocan DB → no lo veían). PROD estaba OK. La **mig 231 (DROP NOT NULL en DEV) lo arregló** — confirmación concreta de que la reconciliación era necesaria. RLS `aut_inv_tenant` (`FOR ALL` tenant-scoped, CHECK=NULL) permite el INSERT del solicitante y el UPDATE cross-user del aprobador (mismo tenant) — sin el bug de `notificaciones`. **Balance: el code-audit de ambos UAT (modo básico + primer uso) queda COMPLETO** — lo que resta es solo capa C/runtime (CAE real, PDFs, integraciones, PWA, visual PROD) + la suite e2e, que por decisión de GO corre con la re-corrida de paridad al cerrar el desarrollo.

## [2026-06-20] update | 🔴 Paridad DEV↔PROD PAR-02..05 — mig 231 reconcilia 3 columnas que FALTABAN en PROD (rompían Clientes / venta con envío / PDF factura)

Continuación del UAT de primer uso (`tests/specs/uat-primer-uso.plan.md`, capa A · paridad). Corrida la auditoría de paridad DEV↔PROD restante (PAR-02..05). **Hallazgo grave (REGLA #0):** PROD tenía **drift de columnas** — 3 columnas existían en DEV (con datos, usadas por la app v1.80.1) pero **NO en PROD**, por DDL fuera de banda (SQL suelto, no versionado):
- **`ventas.costo_envio`** 🔴 fiscal/contable — costo de envío cobrado (v1.78.0). En PROD: la venta con costo de envío fallaba (PostgREST 42703) y el SELECT del **PDF de factura** la pide incondicionalmente → rompía.
- **`clientes.notas`** 🔴 — ClientesPage la manda SIEMPRE en el payload de insert/update → en PROD **rompía TODO el alta/edición de clientes**.
- **`movimientos_stock.linea_id`** 🟠 — trazabilidad WMS (FK a inventario_lineas; 327 filas en DEV).

No se había notado porque **nadie ejerció esos flujos en PROD todavía** (app pre-primer-cliente) — exactamente la tesis del plan. Además: `autorizaciones_inventario.linea_id` había quedado **NOT NULL en DEV** (drift; la mig 103 la dejó nullable para bulk_edit → DEV rechazaría una autorización bulk) y el **event trigger de seguridad `ensure_rls`/`rls_auto_enable`** (auto-habilita RLS en tablas nuevas de public) faltaba en DEV.

**mig 231** (aditiva, sin reescribir histórico) reconcilió todo en **DEV y PROD** (GO aprobó el apply a PROD): +3 columnas, `autoriz.linea_id`→nullable, +`ensure_rls`. **Resultado: PAR-03 columnas idénticas** (1817, hash `d482718f…`), **PAR-02 policies idénticas** (153, `c974cded…`), **PAR-05 seed byte-idéntico**. **PAR-04:** triggers idénticos (50); el resto del diff de cuerpos de funciones (~21) es **100% cosmético** (whitespace/CRLF `\r\n`/comentarios/`·`-vs-`.`) — verificadas a mano las de inventario (`recalcular_stock`, `stock_disponible_producto`), contable (`fn_saldo_proveedor_cc`, `process_aging_profiles`, `liberar_reservas_vencidas`) y RLS (`get_user_role`, `is_admin`, `get_user_tenant_id`): **misma lógica, cero diferencia de comportamiento**. `schema_full.sql` actualizado con la sección 231 (estaba lapsado desde la mig 208). Sin cambio de código de la app, sin bump de versión. **▶ Queda del plan:** el smoke de primer uso PU-01→PU-17 (runtime/UI/e2e, sobre tenant nuevo real en PROD). Ver [[reference_drift_dev_prod_paridad]].

## [2026-06-20] deploy | v1.80.1 EN PROD — fix onboarding con "Confirm email" ON (RLS tenants) + SMTP Auth → Resend

Disparado por un alta real fallando en PROD. **(1) SMTP:** los mails de Auth (confirmación de signup) usaban el SMTP integrado de Supabase (límite bajísimo) → "email rate limit exceeded"; se configuró **Resend como SMTP de Auth** (host smtp.resend.com, user `resend`, pass = API key, FROM noreply@genesis360.pro). **(2) RLS al crear el negocio:** con "Confirm email" ON, `signUp()` no devuelve sesión → el insert de `tenants` fallaba la policy `WITH CHECK (auth.uid() IS NOT NULL)` → "new row violates RLS". **Rework del onboarding (v1.80.1, PR #233):** los datos del negocio viajan en el metadata del signUp + `emailRedirectTo=/onboarding`; sin sesión se muestra "revisá tu email"; al confirmar, el `useEffect` detecta sesión + metadata y crea el tenant + usuario DUEÑO (`provisionNegocio`). Robusto aunque el link caiga fuera de /onboarding (AuthGuard `needsOnboarding` → /onboarding). Fast path (Confirm email OFF) intacto. Sin migración ni EF. **✅ Auth URL config hecha (GO):** Site URL = `https://app.genesis360.pro` + Redirect URLs `/**` (app/genesis360.pro/www/localhost); removido el dominio viejo de Stokio. **Dato: el dominio real de la app es `app.genesis360.pro`.** **(3) DRIFT DEV≠PROD de CHECK constraints (causa raíz, migs 229 + 230):** `caja_movimientos_tipo_check` (PROD solo permitía ingreso/egreso; rompía Caja Fuerte/señas/ventas no-efectivo/devolución de seña) → mig 229 (CHECK por prefijo). Escaneo de paridad → 5 CHECKs en PROD que NO estaban en DEV: `ventas_estado_check` sin `'devuelta'` (rompía devolución total) + `notificaciones_tipo_check` que rechazaba claves de evento (rompía abrir/cerrar caja con diferencia) + caja_sesiones/motivos/inventario → **mig 230 reconcilió todo: DEV == PROD (PAR-01 cerrado, hash `565c8f0…`, 97 CHECKs).** **Plan nuevo `tests/specs/uat-primer-uso.plan.md`** (UAT de primer uso + auditoría de paridad DEV↔PROD; correr antes de cada alta de cliente). Ver [[reference_drift_dev_prod_paridad]].

## [2026-06-19] update | ⚙️ DEV — aviso de saturación de recursos: crons TiendaNube desactivados + pase de performance al backlog

Supabase avisó "exhausting resources" en **DEV**. Diagnóstico (pg_stat_statements): no hay query asesina ni bloat grave (`net._http_response` 26 MB se auto-limpia); la carga es **volumen de requests** (~582k `set_config` = e2e de la sesión + polling de la app) + **crons cada 5 min** (`net.http_post` jobid 1 + `fn_tn_sync_heartbeat` jobid 3, lento 134ms en el tier chico de DEV) + **RLS por-fila** (los 646 lints). **Acción:** desactivados jobid 1+3 en DEV (`cron.alter_job(... active=>false)`, reversibles); jobid 4/5 daily siguen; **PROD intacto**. NO se subió compute (es DEV, pico transitorio). **Backlog (para PROD):** pase de performance — `(select auth.*())` en RLS + índices FK. Ver project_pendientes.

## [2026-06-19] deploy | v1.80.0 EN PROD (PR dev→main, mig 228, EF emitir-factura) — branding (ícono único + degradé) + autorización de ajustes por rol + UAT finalizado

**v1.80.0 a PROD.** mig 228 aplicada en DEV y PROD. EF `emitir-factura` deployada en PROD (incluye el guard FAC-27 de Factura B≥umbral). PR `dev→main` mergeado, release v1.80.0. APP_VERSION v1.80.0.

**Branding (single-source):** ícono nuevo (regenerado desde `brand/logo-source.png` con `scripts/gen-brand-icons.mjs`) en tab del navegador, sidebar, landing, suscripción, login y onboarding — todo desde `BRAND.logo`. Tabs unificadas (componente `PageTabs`: subrayado + degradé violeta→cian + drag-scroll + badge + **iconos en Inventario y Proveedores**). Hover de marca en tabs/sidebar (texto e ícono al degradé, manteniendo el fondo violeta translúcido). Fondos de landing/suscripción/onboarding de negro a degradé de marca (`bg-brand-gradient-hero`). Caja: capital por moneda + tab "Caja actual" centrado.

**🔴 Autorización de ajustes de inventario POR ROL (mig 228, `tenants.ajuste_autorizacion_roles`):** DUEÑO ajusta directo; el resto requiere aprobación; **configurable por rol** (Directo/Por umbral/Siempre) en Config → Inventario → Reglas. Aplica a diferencias de Conteo, ajustes/eliminación de LPN y edición masiva. Lógica pura `ajusteAutorizacion.ts` (+9 tests). **Corrección de un error previo:** se había sacado el tab Autorizaciones del modo básico por una conclusión equivocada; el Conteo (presente en básico) genera ajustes que requieren aprobación → el tab vuelve a básico (gateado por rol aprobador).

**Fiscal (FAC-27):** EF rechaza (400) Factura B ≥ umbral sin DNI/CUIT antes de AFIP. **GAS-17** default Ganancias por condición. **PRD-11** precio ≥ 0. **GAS-16** by-design (no re-saneo histórico). **🛑 REGLA DE ORO #0** (integridad fiscal/contable/inventario) al tope de CLAUDE.md.

**UAT:** code-audit finalizado (§3-§11) + **§29 matriz fiscal por condición** (RI/Mono/Exento) para verificación en runtime. Suite: unit + e2e verdes. **▶ Próxima sesión: verificación RUNTIME de la matriz fiscal §29** (emitir CAE real por condición + cargar gastos) — es el pendiente principal del UAT.

## [2026-06-19] update | v1.80.0 EN DEV — 🎨 Tabs unificadas (degradé de marca + drag-scroll) · 💱 Capital por moneda · 🧾 Guards fiscales (FAC-27/GAS-17) · 🛑 Regla de oro fiscal · ✅ UAT code-audit finalizado + matriz fiscal §29

**Sesión larga, TODO EN DEV (rama dev, preview Vercel = DEV). PROD sigue en v1.79.0. Sin migración nueva (última = 227). `APP_VERSION` → v1.80.0. EF `emitir-factura` redeployada a DEV (v13) con el guard FAC-27.** 9 commits en dev (último `a06a9d1c` + el del wiki).

**🎨 Tabs unificadas (pedido GO):** nuevo componente compartido `src/components/PageTabs.tsx` — formato único subrayado (estilo Clientes) con el tab activo remarcado en el **degradé de marca violeta→cian** (`text-gradient-brand` + barra `bg-brand-gradient`; ícono activo en violeta sólido). Incluye **drag-scroll** (hook `useDragScroll`) para páginas con muchos tabs + soporte `badge`. Migradas TODAS las páginas con tabs: Ventas, Productos, Inventario, Gastos, RRHH, Facturación, Proveedores, Envíos, Clientes (page + sub-tabs), Caja, Config (sub-tabs). El nav principal de Config queda como sidebar (otro paradigma, a propósito).

**💱 Caja:** "Capital total del negocio" ahora **discriminado por moneda** (CAJ-29 — antes sumaba ARS+USD sin convertir; real en DEV: Almacén Jorgito ARS+USD) + tooltip explicativo. Las **aperturas de caja NO se suman al capital** (decisión Opción A de GO: evita doble conteo del arrastre; el capital inicial real se asienta como "Ingreso externo" a la bóveda; el flujo ya existía). El tab "Caja actual" volvió a **columna centrada** (resumen+acciones arriba, movimientos abajo) — se deshizo el "pegado a la izquierda" del layout 2-col de v1.78.2.

**🧾 Guards fiscales:** **FAC-27** — guard server-side en la EF `emitir-factura`: Factura B ≥ umbral sin DNI/CUIT responde **400** antes de llamar a AFIP (espeja `requiereIdentFacturaB` del POS; consistente con el guard de tipo A/B/C). Deployado a DEV (v13); **pendiente PROD (cambio fiscal)**. **GAS-17** — el default de "Deducir de Ganancias" depende de la condición: RI → ON, Monotributista/Exento → OFF. **PRD-11** — clamp de precio ≥ 0 (`Math.max`) en alta/edición de variantes. **GAS-16** — resuelto **by-design** (NO se hace re-saneo masivo: borrar retroactivamente el IVA crédito de gastos cargados cuando el tenant era RI falsearía el historial fiscal).

**🛑 REGLA DE ORO #0 (nueva, al tope de CLAUDE.md):** integridad fiscal/contable/inventario no negociable — cero errores, avisar a GO ante cualquier riesgo aunque sea latente, verificar contra la regla real, guards server-side, efectivo siempre asentado, `numeric`→`parseFloat`, stock nunca negativo + mode-aware, nunca reescribir histórico fiscal.

**✅ UAT — code-audit FINALIZADO** (`tests/specs/uat-modo-basico.md`): auditadas por código §3/§4/§5/§6/§7/§8/§9/§10/§11 (toda la superficie 🔴 de plata/stock/fiscal) — **sin bugs nuevos** (los fixes de pases previos aguantan). Lo que resta es solo capa C (runtime/PDFs/PWA/integraciones reales). Agregada **§29 — matriz fiscal por condición del emisor (RI/Monotributista/Exento)** con casos esperados testeables (MF-01→14 facturación, MG-01→13 gastos, MX-01→03 cross-módulo) **para verificar en runtime la próxima sesión**. **Tests e2e:** 3 selectores desactualizados arreglados (20 caja "Arqueo", 21 facturación adaptable a la condición, 23 inventario scopeado al modal). **Suite: 753 unit + 164 e2e verdes.**

**Dato:** Almacén Jorgito (DEV) se usó en RI para pruebas y GO lo vuelve a Monotributista.

**▶ Pendiente próxima sesión / PROD:** deploy v1.80.0 a PROD (PR dev→main + EF `emitir-factura` a PROD por FAC-27 + release) · verificación runtime de la matriz fiscal §29 · verificación visual en PROD (degradé/tabs/layout Caja/logo, pendiente desde v1.78.2).

## [2026-06-18] update | 🎨 Nuevo logo/iconos de marca Genesis360 (favicon + PWA + sidebar + login) — EN DEV

GO pasó el logo nuevo (G en estrella/compás, degradé violeta→cian, 1024×1024 transparente). Fuente versionada en `brand/logo-source.png` + script reproducible `scripts/gen-brand-icons.mjs` (usa `sharp` + `png-to-ico`, **devDependencies**, no entran al bundle). Generados en `public/`: favicon 16/32 + favicon.ico (transparente), android-chrome 192/512 (transparente), apple-touch-icon 180 + **nuevo** android-chrome-512x512-maskable (fondo blanco + padding para el safe-zone de Android). Manifest (`vite.config.ts`) actualizado: 512 `any` + 512 `maskable` dedicado. `LoginPage` ahora muestra el logo (antes ícono genérico `Package`). El sidebar ya usaba `android-chrome-192`. typecheck + build verdes. **Ojo:** favicon/PWA cacheados pueden tardar en refrescar (hard-reload). **theme_color del manifest sigue `#0000FF`** (no matchea el violeta — opcional cambiarlo). Pendiente PROD (junto con migs 225+226 + fixes de caja).

## [2026-06-18] deploy | v1.79.0 EN PROD (PR #231, mig 227) — 🧾 Gastos: automatización fiscal por condición del tenant

GO pasó un prompt para refactorizar Gastos cruzando `tipo_comprobante` × condición frente al IVA del tenant. Revisado y corregido vs. la realidad: el campo del tenant es **`condicion_iva_emisor`** (no `condicion_iva`); `iva_credito` ya existía como **`iva_monto`**, `deduce_ganancias` ya existía, `monto_neto` es derivable → la **única columna nueva es `tipo_comprobante`**; "backend" = **trigger** (no hay EF de gastos). **Implementado:**
- **mig 227:** `tipo_comprobante` en `gastos` + `gastos_fijos` (backfill `'Factura A'` donde `iva_deducible`); trigger `fn_gastos_iva_guard` que **sanea** el crédito de IVA salvo **RI + Factura A** y `deduce_ganancias` salvo RI (default Monotributista). Elegí sanear (forzar a 0/NULL) en vez de rechazar con error: mismo resultado fiscal, no rompe el flujo.
- **GastosPage (ambos forms, `renderFiscal` compartido):** Mono/Exento → comprobante B/C/Ticket, monto total, sin IVA crédito ni Ganancias. RI → A/B/C/Ticket; **Factura A** muestra alícuota (default 21%) + Neto + IVA crédito; B/C/Ticket → IVA 0; Ganancias marcable (default on).
- **Verificado en DB:** RI+Factura A permite IVA $210; RI+Factura B lo sanea a NULL. mig 227 en DEV y PROD. typecheck + build verdes. **A verificar visualmente en PROD:** el form de gastos según la condición del tenant.

## [2026-06-18] deploy | v1.78.4 EN PROD (PR #230, sin mig) — arqueo repetible visible + acciones flex-wrap + theme_color violeta

Cierre de loose ends de la sesión. **Arqueo (backlog de GO "no se puede hacer >1 arqueo"):** investigado → **SÍ se puede** (sin constraint UNIQUE en `caja_arqueos`, sin guard en `realizarArqueo`, y hay data real con 2 arqueos en una sesión). Era **descubribilidad**: el botón quedaba como ícono ✓ sin texto y tras el 1er arqueo el prominente pasa a "Cerrar caja". Fix: botón "Arqueo" + tooltip ("podés hacer varios por sesión"). **Acciones de caja:** `flex-wrap` (no se amontonan en la columna angosta del layout 2-col nuevo). **PWA:** `theme_color` #7B00FF + `background_color` #F5F0FF (antes #0000FF azul, no matcheaba la marca). typecheck + build verdes. Sin migración.

## [2026-06-18] deploy | v1.78.3 EN PROD (PR #227, sin mig) — fix selector de caja en la venta

GO reportó que en la venta el selector de caja mostraba la **Caja Fuerte** y que, teniendo una sola caja, no la autopreseleccionaba (había que elegirla en cada venta). Causa: la query de `caja_sesiones` abiertas (VentasPage) incluía la **sesión permanente de la bóveda** → el selector la listaba y `sesionesAbiertas.length` era 2 (en vez de 1), así que no entraba el camino "única caja = predeterminada" y además la venta exigía elegir caja (length>1). **Fix:** filtrar `es_caja_fuerte` en la query → solo cajas operativas; con 1 caja `length===1`, se usa esa sola sin selector. typecheck + build verdes. Deployado a PROD (PR #227, release v1.78.3).

## [2026-06-18] deploy | v1.78.2 EN PROD (PR #226, migs 225-226) — 💵 Efectivo default + 💰 fix capital bóveda + 🏦 Caja Fuerte UI + 🎨 logo nuevo + 🖥️ Caja full-width + 🟣 degradé de marca

**v1.78.2 a PROD:** migs 225+226 aplicadas en PROD (verificado: 4/4 tenants con cuenta Efectivo, 0 sin link), PR #226 `dev→main` mergeado, release v1.78.2, `APP_VERSION` v1.78.2. Bundle de los updates de la sesión (Efectivo por default, fix capital bóveda, Caja Fuerte 2-tarjetas + selector de cuenta + lock básico, logo/iconos nuevos, Caja a pantalla completa 2 columnas, degradé de marca violeta→cian single-source). Detalle de cada uno en las entradas `update` de abajo.

**⚠ A verificar visualmente en PROD (no se pudieron ver renderizados, son revertibles):** el **degradé global** (`bg-accent`→degradé en todos los botones/barras) y el **layout de Caja** (2 columnas full-width). Si algo se ve raro, revert de un commit + redeploy.

## [2026-06-18] update | 🏦 Caja Fuerte: 2 tarjetas (bóveda + capital total) + selector de cuenta destino + lock caja-origen en básico + fix conteo de efectivo (mig 226) — EN DEV

**Pedidos de GO sobre la Caja Fuerte (todo en DEV, sin versionar):**
- **2 tarjetas destacadas** (estilo Dashboard) en el header: **"En la caja fuerte"** (saldo de bóveda `fuerteSaldo`, degradé violeta→cian — sube al depositar) + **"Capital total del negocio"** (efectivo en cajas + bóveda + cuentas). Reemplaza el "Total" chico. (GO eligió "mostrar las dos cosas".)
- **Modal Ingresar a Caja Fuerte:** nuevo selector de **Cuenta de destino** (cuentas_origen activas, default Efectivo) — antes el ingreso era siempre Efectivo hardcodeado. La pata de ingreso a la bóveda usa la cuenta elegida; la de egreso de la caja queda en Efectivo.
- **Modo básico:** el selector de **Caja de origen** queda bloqueado y asume la caja activa (no se elige).
- **🔴 Fix conteo de capital (mig 226):** el "Capital por cuenta"/"Capital total" no reflejaba el efectivo de ventas/gastos porque esos `caja_movimientos` dejan `cuenta_origen_id` NULL. La vista `vw_boveda_cuentas` ahora atribuye los movimientos NULL **no informativos** (efectivo físico) a la cuenta Efectivo del tenant (read-time, sin tocar write-paths). Verificado: Almacén Jorgito 12.873.811→12.889.570 (sin doble conteo), Kiosco Buildi 10.000→55.300. **Limitación conocida:** las aperturas de caja (`monto_apertura`) no son movimientos → no se cuentan (gap a evaluar). typecheck + build verdes.
- **⏳ Pendiente PROD:** migs 225+226 + frontend (bump versión + PR `dev→main`).

## [2026-06-18] update | 💵 Efectivo por default en el alta de tenant (cuenta de origen + método vinculado) — mig 225 EN DEV

**Pedido de GO:** cada tenant nuevo debe nacer con (1) la Cuenta de Origen **Efectivo** (tipo `efectivo`, en la moneda del tenant) y (2) el método de pago **Efectivo** vinculado a esa cuenta, todo por default.

- **Diagnóstico:** hoy un tenant nuevo no tiene métodos ni cuentas; recién al abrir Config→Ventas un seed lazy app-side creaba 5 métodos **sin** cuenta vinculada, y la cuenta Efectivo no se creaba en ningún lado.
- **Fix (mig 225, `225_seed_efectivo_default_tenant.sql`):** se extiende el trigger de onboarding `fn_seed_tenant_defaults` (SECURITY DEFINER + search_path=public — el trigger corre antes de existir la fila en `users`) para crear la cuenta Efectivo + los 5 métodos default con Efectivo vinculado. **Backfill:** crea la cuenta Efectivo en todos los tenants existentes que no la tenían + vincula el método Efectivo. El seed lazy de `ConfigPage` queda como fallback (ahora también asegura+vincula la cuenta Efectivo).
- **Verificado en DEV:** tenant de prueba con moneda USD → cuenta `Efectivo / efectivo / USD`, 5 métodos, método Efectivo `LINKED_OK` (luego borrado). Backfill: 9/9 tenants con cuenta Efectivo, 0 métodos Efectivo sin link. typecheck + build verdes.
- **⏳ Pendiente PROD:** aplicar mig 225 + deploy frontend (bump a v1.78.2 + PR `dev→main` + release).

## [2026-06-18] deploy | v1.78.1 EN PROD (PR #225) — 🧾 Facturación: 4 bugs (alícuota ≠21% → AFIP la rechazaba, Exento→21%, select no reflejaba, tipo sin validar server-side) + PV en Facturación + ✨ tarjeta Capital total en Caja Fuerte + UAT blindado

**Disparado por dos reportes de GO en homologación (Almacén Jorgito, monotributista):** (1) "me deja hacer Factura B siendo monotributista" y (2) "puse IVA 10,5% al producto y la factura lo tomó como 21%". La revisión a fondo del flujo de facturación (incl. envío) encontró **4 bugs**, uno grave y latente. **✅ EN PROD: EF `emitir-factura` deployada en DEV y PROD, PR #225 `dev→main` mergeado, release v1.78.1, `APP_VERSION` v1.78.1.** GO autorizó el deploy a PROD (impacto cero: ningún tenant factura en PROD hoy). **Recomendado: GO valida en homologación (Factura A/B con producto 10,5% → Id 4; forzar B siendo monotributista → 400).**

**✨ Además — Caja Fuerte: tarjeta de Capital total destacada** (pedido de GO): el `capitalTotal` (suma de todas las cuentas de la bóveda) pasó de un "Total:" chiquito a una tarjeta estilo Dashboard arriba a la derecha del header, **degradé violeta→cian**, número grande (es el dato principal de la página). Solo UI. `CajaPage.tsx`.

- **🔴 GRAVE (fiscal) — alícuota ≠ 21% se mandaba a AFIP como 21%.** El `numeric` de Postgres llega como `"10.50"/"0.00"/"27.00"` y no matcheaba `ALICUOTA_ID` (claves `"10.5"/"0"/"27"`) → caía al default `Id:5` (21%). El *importe* se calculaba a la tasa real pero el *Id de alícuota* iba como 21% → **AFIP rechaza (error 10051)** o clasifica mal. Latente: todo lo probado era 21% (coincidía con el default) + los monotributistas emiten C (sin IVA discriminado). Hubiera explotado con el primer cliente RI con producto a 10,5%. **Fix:** normalizar la clave con `String(parseFloat(tasaStr))` antes del lookup, en `supabase/functions/emitir-factura/index.ts` y su espejo `src/lib/facturacionLogic.ts`. +4 unit de regresión con el formato real (`"10.50"`, `"0.00"`, `"27.00"`) — la suite pasaba en verde porque solo usaba `"10.5"/"21"` limpios.
- **🔴 (fiscal) — tipo de comprobante no validado server-side.** La restricción A/B/C por emisor (v1.78.0) era **solo UI**; un bundle viejo / API directa podía emitir B siendo monotributista (pasó en ventas #222 y #224 de Almacén Jorgito). **Fix:** guard en la EF — Monotributista/Exento → solo C; RI → nunca C; si no, **400**.
- **🔴 — producto Exento (0%) se guardaba como 21%.** `parseFloat(form.alicuota_iva) || 21` convertía `0→21` (IVA fantasma). **Fix:** `Number.isFinite(...) ? ... : 21` en `src/pages/ProductoFormPage.tsx`.
- **🟠 (UX/confianza) — el `<select>` de alícuota no reflejaba el valor guardado.** Cargaba `"21.00"/"10.50"` (no matchea las opciones `"21"/"10.5"`) → campo en blanco al editar (lo que hizo pensar a GO que el 10,5 "no quedaba"). **Fix:** normalizar al cargar con `String(parseFloat(...))`.
- **🟡 — botón "Emitir factura" en Facturación.** EF verificada OK (logs DEV = `emitir-factura` 200 en todas las emisiones recientes; el backend NO es el problema). Hallazgo: el modal de Facturación **no auto-seleccionaba el punto de venta** (quedaba en default `1`); si el tenant tiene un PV ≠ 1 el `<select value=1>` no matchea → emite con PV inválido. **Fix:** auto-set del primer PV al abrir (consistente con el POS). **Dato:** **Kiosco Buildi no tiene punto de venta configurado** (solo Almacén Jorgito tiene el PV 1) → revisar con GO. Pendiente confirmar con GO el síntoma exacto del botón (posible bundle cacheado).
- **Flujo envío + factura auditado y CORRECTO:** `ventas.total` = suma de ítems (no incluye envío); `costo_envio` aparte; la EF arma `impTotal = venta.total + costo_envio` → **no duplica** (verificado con datos reales en DEV: venta #220 total 13000 + envío 1000 = pagado 14000).
- **🧪 UAT blindado:** `tests/specs/uat-modo-basico.md` +12 escenarios (PRD-15/16/17 alícuota, VEN-21 actualizado + VEN-35 envío, FAC-20→26 tipos por emisor + guard + envío + alícuota) + bloque "Fixes aplicados sesión 2026-06-18". typecheck + **753 unit** + build verdes.

## [2026-06-18] deploy | v1.78.0 EN PROD (PR #224) — 🚚 Costo de envío en la factura AFIP + envío en básico solo-costo + restricción tipos A/B/C · 🛟 Panel de soporte desplegado (admin.genesis360.pro) + cambiar contraseña

**v1.78.0 a PROD:** EF `emitir-factura` deployada en PROD, frontend mergeado `dev→main` (PR #224), release v1.78.0. Sin migración. ✅ Validado en homologación: Factura C con envío → CAE OK + envío en el detalle.

**Sesión larga: panel interno de soporte construido y desplegado + fix de costo de envío en factura.**

**🛟 Panel de soporte (genesis360-admin) — Fase 0-3, EN PROD:** consola interna para el equipo de soporte (diseño Stitch "Genesis360 Admin Control Panel"). Repo separado **público** `github.com/genesis360-app/genesis360-admin` (Vite+React+TS+Tailwind), deployado en Vercel → **`admin.genesis360.pro`** (DNS Cloudflare, CNAME gris). Backend en el repo Genesis360: **migs 221-224** (support_agents + admin_audit_log + is_staff + roles + support_tickets/messages + leads) **DEV+PROD** + EF **`admin-api`** (service_role; valida agente activo + autoriza por rol/módulo + audita). 6 módulos: Dashboard (MRR+counts reales), Clientes + **Vista por Cliente** (snapshot read-only), CRM (Kanban leads), Soporte (tickets), Billing (MRR/planes), Analytics (placeholder, bloqueado Meta/GA4), Usuarios (gestión de agentes). **Acceso por rol** admin/support/marketing/billing (enforzado en la EF). Auth **Opción C** (support_agents + claim `app_metadata.staff`). Agente PROD `soporte@genesis360.pro` (password temporal, cambiable desde el panel). Ramas dev/main del panel (preview=DEV, prod=PROD). Detalle en [[project_plataforma_soporte]].

**🚚 v1.78.0 (app principal, EN DEV, sin migración) — Costo de envío en factura + envío en básico (pedido GO):**
- **Factura AFIP:** el `costo_envio` cobrado al cliente ahora entra como ítem "Costo de Envío" + suma al ImpTotal (antes existía en `ventas.costo_envio` pero NO entraba ni al detalle ni al total — bug). Alícuota del flete = predominante de los productos (regla AFIP: en A sigue al producto, en C va a neto). **Concepto=3 + FchServDesde/Hasta/VtoPago** cuando hay envío (AFIP los exige con Concepto 2/3). Courier pagado directo por el cliente = `costo_envio` 0 → afuera (correcto). PDF de factura con línea + total/saldo con envío. EF `emitir-factura` deployada en **DEV**; **PROD pendiente test homologación + OK GO** (cambio fiscal).
- **Envío en básico:** ahora **solo un campo de costo** (guardado en `ventas.costo_envio`, visible en ticket y factura); se ocultan transporte/courier/km/dirección y **NO crea registro en `envios`** (gateado por `modoAvanzado`) → ya no deriva al módulo de Envíos oculto en básico. Avanzado sin cambios.
- **Restricción de tipos A/B/C por emisor (frontend, inocuo):** el selector del POS y de Facturación ofrece solo las letras válidas según `condicion_iva_emisor` (Monotributista/Exento → solo C; RI → A/B; nunca dejar elegir A a un monotributista). Helper `tiposComprobantePermitidos()` en `facturacionLogic.ts` + 4 tests. Facturación defaultea al tipo auto-detectado.
- **750 unit** + build verdes. **✅ GO probó en homologación una Factura C con envío → CAE OK + envío en el detalle.** **Pendiente PROD:** deploy `emitir-factura` a PROD → PR `dev→main` v1.78.0 + release. Ver [[project_costo_envio_factura]].

**Diferidos del panel (con motivo):** Analytics Meta/GA4 (bloqueado por credenciales externas), login-as real en la app del cliente (riesgoso, toca prod; el snapshot read-only cubre diagnóstico), churn/LTV:CAC (necesita histórico de bajas).

## [2026-06-17] deploy | v1.77.0 EN PROD — 🔔 Fix RLS `notificaciones`: el INSERT cross-user estaba bloqueado (mig 219) · `dev→main` PR #221 · auditoría UAT pase 3 §25-28

**v1.77.0 a DEV + PROD (mig 219 aplicada+verificada en ambos), PR #221, release v1.77.0 latest.** Pase 3 de la auditoría UAT modo básico — se auditaron por código las secciones que habían quedado pendientes (**§25 escaneo · §26 PWA · §27 notificaciones · §28 listas/webhooks/teclado**).

- **🔴 Hallazgo único pero serio (NOT-02/NOT-04): la RLS de `notificaciones` rompía TODAS las notificaciones in-app.** Todas las notificaciones que genera el código apuntan a OTROS usuarios (cajero → supervisores/dueño): **solicitud de Caja Fuerte**, diferencia de apertura/cierre de caja, alertas de venta (margen negativo / muchas devoluciones). La policy bloqueaba el INSERT cuando `user_id != auth.uid()`. **PROD y DEV estaban desincronizados, ambos rotos:**
  - PROD: `notif_user FOR ALL USING (user_id = auth.uid())` — sin `WITH CHECK` propio, el INSERT hereda el USING → rechaza filas para otros usuarios.
  - DEV: `notif_select` + `notif_update` (aplicadas **fuera de banda**, no están en ninguna migración del repo — drift de config) y **ninguna policy de INSERT** → todo insert client-side rechazado.
  - La solicitud de Caja Fuerte además hace `if (error) throw error` → **abortaba el pedido del cajero** (flujo de plata bloqueado). Las otras eran fire-and-forget → fallaban en silencio.
- **Fix (mig 219, `219_fix_rls_notificaciones_insert.sql`):** normaliza ambos entornos a policies explícitas por comando — `notif_select`/`notif_update`/`notif_delete` solo las propias (aislamiento NOT-04 intacto) + `notif_insert` con `WITH CHECK (tenant_id = get_user_tenant_id())` (cualquier usuario crea notificaciones para usuarios de su mismo tenant). **Sin cambios de frontend** (el código ya insertaba bien; el bug era la policy).
- **Validado en DEV impersonando un cajero** (`SET LOCAL ROLE authenticated` + jwt claims): insert cross-user mismo tenant OK, lee notificaciones ajenas = 0, insert cross-tenant bloqueado.
- **Resto de §25-28 verde por código:** escaneo (mode-safe, GS1, cola anti-dup, lector físico vía modo manual), idempotencia de webhooks (doble guard `webhook_external_id` + UNIQUE mig 060 + dedup por `tracking_id`), recuperación de chunk viejo (`vite:preloadError` + ErrorBoundary), anti-doble-submit (`savingRef`/VEN-22), export/import presentes. Pendiente runtime: INT-09 (carrera multicanal = NEG-03), NOT-02 end-to-end.
- **🧹 Mig 220 (DEV+PROD) — barrido de drift de policies + normalización:** tras la 219 se comparó `pg_policies` DEV vs PROD (firma `md5(string_agg(...))` por tabla). De 124 tablas, **4 con drift cosmético** (cero cambio de comportamiento): `clientes` (PROD tenía una `tenant_isolation` duplicada de más), `gasto_cuotas` (su policy **nunca estuvo en una migración** — mig 097 solo hizo ENABLE RLS — y quedó con nombre distinto en cada entorno: `tenant_isolation` DEV vs `gasto_cuotas_tenant` PROD), `productos_select` y `tenants_select` (`is_admin()` en DEV vs su expresión inline en PROD — se verificó que `is_admin()` es **idéntica** en ambos, así que son equivalentes). Mig 220 normaliza al canónico del repo. **Resultado: DEV == PROD == 152 policies, mismo hash global (`54c6422…`).** **Regla nueva en CLAUDE.md** (sección Supabase): todo DDL persistente va por migración versionada; PROHIBIDO el botón "Fix" del Security Advisor / editor SQL del dashboard / `execute_sql` para DDL (esa fue la fuente del drift).
- typecheck + **746 unit** + build verdes. **⚠ Causa raíz del drift identificada:** comparando `supabase_migrations.schema_migrations` de DEV vs PROD, **ninguna migración crea `notif_select`/`notif_update`** → se aplicaron con **SQL crudo** (dashboard de Supabase / quick-fix del Security Advisor / `execute_sql`) **solo en DEV**, sin archivo de migración ni propagación. PROD = estado del repo (mig 084 `notif_user`); DEV adelantado fuera de banda. **Regla violada:** todo DDL persistente va por archivo de migración (`apply_migration` + `.sql` en repo), nunca por SQL suelto. **Pendiente:** barrido de policies DEV-vs-PROD-vs-repo por si hay más drift.

## [2026-06-16] deploy | v1.76.0 EN PROD — 🧪 Auditoría UAT modo básico: 7 bugfixes de plata/stock · `dev→main` PR #220 (SIN migración)

**v1.76.0 a DEV+PROD (Vercel), sin migración, release latest, PR #220.** GO pidió un **archivo de pruebas tipo UAT** exhaustivo del modo básico (happy + borde + excepción, "qué pasa si el usuario hace X") porque en auditorías previas se escaparon bugs (devolución/NC). Se construyó `tests/specs/uat-modo-basico.md` (~300 escenarios, toda la superficie del básico incl. AFIP) y se **auditó por código** (capa A).

- **Lo previamente roto (devolución/NC) quedó confirmado OK** — los fixes v1.70-v1.74 están presentes.
- **7 bugs nuevos encontrados y reparados:**
  - **DEV-07** 🔴 re-devolución sin tope (cap = vendido en vez de vendido − ya_devuelto) → reingreso/reembolso de más. Fix UI + guard server-side.
  - **DEV-04** 🔴 devolución vs deuda CC (regla GO): con deuda → reduce deuda FIFO sin efectivo; sin deuda → efectivo/medio/**crédito a favor**. Banner + opción crédito + guards.
  - **GAS-01/05** 🔴 egreso de gasto efectivo fire-and-forget + silencioso sin caja → awaited + toast + aviso (clase bug #26).
  - **VEN-22** ⚠️ `savingRef` anti doble-submit en `registrarVenta`.
  - **CONTADOR** ⚠️ `contadorVisible` en Facturación (el rol no la veía).
  - **PRES-08** 🔴 convertir presupuesto/reserva → despachada (`cambiarEstado`) no re-validaba stock → pre/post-check (espejo del POS).
  - **CAJ-18** 🔴 no caja negativa: gasto/devolución efectivo > saldo se bloquea. Lib `cajaSaldo.ts` (puro + async) + 7 unit tests.
- typecheck + **746 unit** + build verdes. Sin migración → sin tocar Supabase/EFs.
- **El UAT tiene los resultados de auditoría (pases 1 y 2)** y queda como guion para la próxima pasada (capa C click-through + auditar §25-28). Memorias actualizadas: [[reference_cobranza_efectivo_exige_caja]] (gasto + devolución + caja negativa), [[project_auditoria_primer_cliente]], nueva [[reference_uat_modo_basico]].

## [2026-06-16] deploy | v1.75.0 EN PROD — 🔒 RLS por sucursal a nivel servidor (#8 cerrado) · `dev→main` PR #219 (migs 216-217-218)

**v1.75.0 a DEV+PROD, migs 216-217-218 DEV+PROD, release latest, PR #219.** Cierra la deuda técnica #8: hasta v1.74.1 la RLS filtraba **solo por `tenant_id`** y el aislamiento por sucursal era 100% client-side → un usuario con credenciales podía leer otra sucursal del mismo tenant por API directa. Ahora **23 tablas** filtran por sucursal en la DB.

- **Helpers (mig 216):** `auth_ve_todas_sucursales()` / `auth_user_sucursal()` (STABLE SECURITY DEFINER, `search_path=public`). El primero espeja EXACTAMENTE `authStore.puedeVerTodas` (verificado en `src/store/authStore.ts:92-95` — el wiki listaba mal los roles globales, **faltaba VIEWER**). Si el helper fuera más restrictivo que el front, un DUEÑO/SUPERVISOR con `puede_ver_todas=false`+`sucursal_id` NULL quedaría sin datos.
- **Patrón:** `tenant AND ( ve_todas OR sucursal_id IS NULL OR = la del usuario )`. NULL visible para todos (bóveda/legacy). `WITH CHECK` tenant-only (no rompe traslados/triggers cross-sucursal).
- **216 core** (ventas, caja_sesiones, gastos, inventario_lineas, movimientos_stock-SELECT) · **217 operativas** (envios, ordenes_compra, recepciones, recursos, cajas, inventario_conteos) · **218 hijas sin sucursal_id** (venta_items/series/despachos/auditoria, devoluciones-SELECT, caja_movimientos, caja_arqueos, envio_items, inventario_series + las sin tenant_id que scopean 100% por padre: orden_compra_items, recepcion_items, inventario_conteo_items).
- **Tenant-only a propósito:** catálogo/config, finanzas/tesorería (cheques, CC, devoluciones_proveedor, courier_*), integración, y cross-sucursal por diseño (caja_traspasos, traslado_items). Tanda 4 opcional: devolucion_items (2 saltos).
- **Validación DEV:** impersonando (`SET LOCAL ROLE authenticated` + `request.jwt.claims`) cajero1/Cajero2/SUPERVISOR-restringido/DUEÑO contra ground-truth → coincidencia exacta (lectura + escritura cruzada bloqueada).
- **🔴 Fix de dato PROD pre-deploy:** el CAJERO activo `nicolas.otranto86` (tenant Familia Otranto De Porto, 2 sucursales) estaba restringido **sin sucursal asignada** → bajo la RLS hubiera visto 0 filas (toda la data tiene sucursal). Se le asignó Casa Huechuraba (donde vende) ANTES de aplicar las migs. Smoke PROD OK: Nico ve solo su sucursal (7 ventas), DUEÑO ve todo (22). **Lección clave:** todo usuario activo `puede_ver_todas=false` + `sucursal_id` NULL queda sin acceso → chequear/backfillear por tenant antes de aplicar.

739 unit + build (tsc+vite) verdes. Sin cambios de frontend (solo `APP_VERSION`). Memorias: [[feedback_aislamiento_sucursal]] (RLS DONE), [[project_auditoria_primer_cliente]] (#8 cerrado).

## [2026-06-16] deploy | v1.74.1 EN PROD — Fix alerta fantasma "sin categoría" en básico (badge vs página) · `dev→main` (sin migración)

**v1.74.1 a DEV+PROD, sin migración, release latest.** Dos reportes de GO sobre Kiosko (básico):
- **Badge de Alertas mostraba "1" pero la página vacía.** El badge (`useAlertas`) cuenta *productos sin categoría* tenant-wide; `AlertasPage` los scopeaba por sucursal con `ubicaciones!inner(sucursal_id)` → en básico (sin ubicaciones, `ubicacion_id` NULL) el INNER join borra TODO el stock → la página nunca mostraba el producto (SKU TEST sin categoría). **Fix mode-aware:** básico filtra por `inventario_lineas.sucursal_id` directo; avanzado mantiene el join a ubicaciones. Otra instancia de la clase [[reference_basico_stock_null_ubicacion_estado]]. Ver [[reference_alertas_badge_mode_aware]].
- **Productos mostraba "11 disponible / 12 total".** NO era bug de código: 1 línea de devolución (#16) tenía `sucursal_id` NULL (la venta original no tenía sucursal, pre-v1.73.0/Opción B) → quedaba fuera del "disponible" filtrado por sucursal pero sí en el total (stock_actual global). Reconciliada en DEV (backfill a la única sucursal). El caso ya no se reproduce: v1.73.0 fija la sucursal en básico, así que los reingresos nuevos heredan sucursal no-NULL.

typecheck + suite unit **739/739** + build verdes. **Docs de feature actualizadas:** `wiki/features/caja.md` (auditoría efectivo↔caja v1.74.0) + `wiki/features/devoluciones.md` (NC electrónica ✅ + PDF + egreso robusto).

## [2026-06-16] deploy | v1.74.0 EN PROD — Auditoría efectivo↔caja: el efectivo de devolución/venta siempre se asienta · `dev→main` (sin migración)

**v1.74.0 a DEV+PROD (Vercel), sin migración, release latest.** Disparado por un bug que reportó GO: en la **devolución en efectivo de la venta #26 (Kiosco)** se reembolsaban $2.000 pero **no se registraba el egreso en caja** (quedaba el +2.000 de la venta sin la salida).

- **Causa raíz:** el egreso de la devolución era `void supabase...insert()` (fire-and-forget, sin `await` ni manejo de error) → cualquier fallo (transitorio) se perdía en silencio. Además el modal con **una sola caja** muestra "→ Caja única" pero **no seteaba `devCajaSesionId`**, y el egreso no tenía **fallback a la única caja abierta** (a diferencia de despacho/cancelación). Este camino no estuvo en la auditoría de costuras de v1.69.0.
- **Auditoría completa de efectivo↔caja en `VentasPage`** (lo pidió GO): despacho (ingreso), reserva (seña), saldo cobrado al despachar, devolución (egreso), cancelación de reserva (reintegro). Patrón unificado: caja = elegida ∥ activa ∥ **única abierta**; insert **awaited**; **toast** si falla ("se procesó pero el efectivo no se asentó, registralo manual"). Los `ingreso_informativo` (no afectan saldo) quedan best-effort.
- **Reconciliado** en DEV el egreso faltante de #26 (-$2.000 en la caja abierta de Kiosco → #26 neta en 0).
- **Ya estaban bien (v1.69.0):** cobranza CC efectivo (`requiereCaja` + resolver sesión + awaited) y gasto efectivo→caja.

typecheck + suite unit **739/739** + build verdes. Sin cambios en EFs. **#8 RLS por sucursal: diferido** (se retoma más adelante; 0 exposición hoy con 1 tenant/cliente).

## [2026-06-16] deploy | v1.73.0 EN PROD — issue #10 sucursales básico + roles + #7 cron sweeps + #10b consolidación · `dev→main` (mig 215 + EF cron-sweeps)

**v1.73.0 a DEV+PROD (Vercel), mig 215 DEV+PROD, EF nueva `cron-sweeps` DEV+PROD, workflow `sweeps.yml`, release latest.** Batch acumulado tras v1.72.0:

- **Issue #10 — sucursal default oculta (Opción B):** en básico con 1 sucursal, `AppLayout` fija esa sucursal como contexto (effect de pin que saca al DUEÑO de "Todas") y **oculta el selector** (`sucursalUnicaBasico`). Resuelve el bug "el stock devuelto solo se ve en Todas". + **origen del ingreso** en el Inventario básico (cada línea muestra `inventario_lineas.notas`).
- **#10b — consolidar líneas de reingreso en básico:** Devolver/Anular suman a la línea de stock existente del producto (misma sucursal, sin ubicación/estado/lote) en vez de crear una por unidad. El trigger de stock solo recalcula en INSERT → el merge hace bump manual de `stock_actual` (espeja la rama de series). Avanzado sin cambios (un LPN por línea).
- **#7 — cron sweeps externos:** mig 215 = `liberar_reservas_vencidas_all()` + `recalcular_intereses_cc_all()` (SECURITY DEFINER, solo service_role; el de intereses replica la lógica per-tenant de mig 172 porque la original exige `auth.uid()`). EF `cron-sweeps` (service_role, espeja `birthday-notifications`) + workflow `sweeps.yml` (diario 06:10 UTC, llama la EF con ANON_KEY). Cubre intereses CC + reservas vencidas; **servicios recurrentes quedan asistidos** (generan gastos). Validado en DEV.
- **Roles:** invitación en básico ya no ofrece Super Usuario (admin técnico → avanzado); descripciones aclaradas (Supervisor = "Encargado").

typecheck + suite unit **739/739** + build verdes. **Sin cambios en `emitir-factura`.** pg_cron sigue NO habilitado → el cron es externo (GH Actions), patrón consistente con birthday.

## [2026-06-16] deploy | v1.72.0 EN PROD — NC fiscal PDF + rol Lector + roles custom Pro + fixes fiscales · `dev→main` (mig 214)

**v1.72.0 a DEV+PROD (Vercel), mig 214 DEV+PROD, release latest.** Continuación del click-through de GO sobre Kiosko (básico con AFIP) + features pedidas:

- **NC fiscal — Descargar/Imprimir/Email.** El ticket "NC INTERNA · NO FISCAL" no es el documento legal; el legal es la NC electrónica (CAE). El badge verde `NC-B #N` ahora tiene 3 acciones. `facturasPDF.ts` parametrizado con `clase:'nota_credito'` (título "NOTA DE CRÉDITO", COD/QR con código AFIP de NC vía `TIPO_CBTE`); builder `buildNCPDFDataPorDevolucion` (datos en `devoluciones.nc_*`). Reusa send-email `factura_emitida`.
- **Rol fijo LECTOR (Viewer)** — solo-lectura, todos los planes; ve operación + reportes, nunca administración. Enforcement rol-aware en `permisosModulo.ts` + allowlist en `navVisibility.ts`. **Mig 214** amplía `users.rol` CHECK. Cierra el hueco vs. el set SaaS estándar (Owner/Admin/Member/**Viewer**/Billing).
- **Roles personalizados → modo avanzado (Pro+)**; en básico, card con candado + CTA.
- **🔴 Fix NC tipo (AFIP 10040)**: la letra de la NC se deriva de la factura original y queda fija (Factura C→NC-C). Antes defaulteaba NC-B → rebotaba contra una Factura C.
- **🔴 Fix sucursal en reingreso** (Devolver/Anular): líneas + `movimientos_stock` heredan `sucursal_id` de la venta (antes NULL → solo visibles en "Todas") + **backfill** de 8 líneas viejas en DEV.
- **Fix auto-A/B/C**: emisor **Exento** → C (antes solo Monotributista).
- **3 guards fiscales (sugerencias GO):** (1) no habilitar facturación sin `condicion_iva_emisor` + `cuit` guardados; (2) Factura B ≥ `umbral_factura_b` (~$68.305) a consumidor final exige DNI o CUIT del cliente (bloquea emisión); (3) cliente nuevo defaultea a Consumidor Final.
- **Fix ESC** del ticket de devolución/NC interna (`devComprobante`) — no entraba al stack de `useModalKeyboard`.

typecheck + suite unit **739/739** + build verdes. **Issue documentado #10:** arquitectura de sucursales en modo básico (recomendación: sucursal default oculta) + consolidación de líneas de reingreso (pendiente). **Sin cambios en la EF** (`emitir-factura`).

## [2026-06-15] close | Cierre de sesión — PRD=DEV=v1.71.0

Sesión muy larga (v1.66→v1.71, todo a PROD, sin migraciones nuevas — migs 001-213). Arco: **(a) UX** — ActionMenu en Proveedores+Inventario (v1.66), scrollbar tabs + Alertas mode-aware + layout RRHH + guardado Config consolidado (v1.67). **(b) Auditoría modo básico** — 4 bugs de stock NULL-ubicación/estado (ProductosPage "0 disponible", rebaje masivo, devolución bloqueada, despacho snapshot) (v1.68) + plan `tests/specs/auditoria-basico.plan.md` + e2e 22/23. **(c) Auditoría de costuras** — anular venta no restauraba stock + cobranza CC efectivo sin caja perdía el pago (v1.69). **(d) Click-through interactivo de GO sobre Kiosko Buildi** (básico con AFIP): NC electrónica reparada (EF `+cae` v1.70, `+CbtesAsoc` v1.71 — **nunca había funcionado**), ESC cierra el modal visible, anular-con-CAE bloqueado/oculto, devolución/masivo sin UI WMS en básico, drag-scroll de tabs (`useDragScroll`). EF redeployada DEV+PROD via CLI. Suite unit **734/734** estable. **Próxima sesión:** GO sigue el click-through; ver bloque "▶ CIERRE DE SESIÓN" en `project_pendientes.md`. Memorias nuevas/actualizadas: [[project_afip_produccion]] (NC), [[reference_cobranza_efectivo_exige_caja]], [[reference_basico_stock_null_ubicacion_estado]] (auditoría).

## [2026-06-15] deploy | v1.71.0 EN PROD — NC CbtesAsoc + ocultar Anular/Cambiar-cliente con CAE + drag-scroll de tabs · `dev=main`

**v1.71.0 a PROD (PR #212, sin migración, EF `emitir-factura` redeploy DEV; PROD pendiente OK de GO, release latest).** Continuación del click-through de GO:

- **🔴 NC fallaba con AFIP 10197** ("Si el comprobante es Débito o Crédito, enviar CbteAsoc o PeriodoAsoc"): tras el fix del `cae` (v1.70.0), AFIP exige la estructura **`CbtesAsoc`** referenciando la factura original. Fix EF: agregar `CbtesAsoc: [{ Tipo (de `venta.tipo_comprobante`), PtoVta (mismo PV), Nro (`venta.numero_comprobante`) }]` al payload WSFE de las NC. **Asume mismo PV que la NC (caso single-PV).** Redeploy EF necesario.
- **Ocultar "Anular" + "Cambiar cliente" cuando la venta tiene CAE:** una factura electrónica está en AFIP a nombre de un cliente fijo → anularla la dejaría viva en AFIP y cambiar el cliente descuadraría el comprobante. Ahora con CAE solo se ofrece **"Devolver"** (reversión vía NC). Las ventas sin CAE (despachada o marcada facturada) siguen permitiendo ambas. (Antes v1.70.0 bloqueaba con toast; ahora directamente no se muestran — sugerencia de GO.)
- **Feature: drag-scroll en barras de tabs** (`useDragScroll`): en RRHH/Gastos/Inventario las tabs que no entran en pantalla ahora se pueden **arrastrar con el mouse** (click + mover horizontal); si hubo arrastre, el click no cambia de tab. `cursor-grab` + `select-none`.

typecheck + suite unit **734/734** verdes. **EF `emitir-factura` deployada a DEV + PROD (GO autorizó "dejar PRD=DEV") → PRD=DEV.** Pendiente fiscal menor: NC de la venta #20 de Kiosko (cancelada con CAE de homologación pre-fix; sin peso fiscal real — el fix v1.71.0 ya impide anular facturadas con CAE, así que no es un caso reproducible).

## [2026-06-15] deploy | v1.70.0 EN PROD — Click-through básico (tanda 2): NC electrónica, ESC stack, anular factura con CAE · `dev=main`

**v1.70.0 a PROD (PR #211, sin migración, EF `emitir-factura` redeploy DEV+PROD, release latest).** 3 bugs del click-through interactivo de GO sobre Kiosko Buildi (facturación AFIP habilitada en básico):

- **🔴 Emitir NC fallaba siempre ("La venta no tiene factura emitida. No se puede emitir NC sin CAE original")** aunque la venta tuviera CAE real. Causa: el SELECT de la venta en la EF `emitir-factura` **no incluía `cae`** → `venta.cae` siempre `undefined` → el guard de línea 97 tiraba el error. La emisión de NC nunca había funcionado end-to-end (solo se habían probado facturas). Fix: agregar `cae, tipo_comprobante, numero_comprobante` al SELECT. **Requiere redeploy de la EF.**
- **🔴 ESC cerraba el modal de ATRÁS, no el visible:** los modales de devolución, **Emitir NC**, cancelar-reserva y cambiar-cliente no se registraban en el stack de `useModalKeyboard` → el ESC caía en el detalle de venta (registrado). Fix: registrarlos (la NC va encima de la devolución) + el detalle cede el ESC a cualquier modal apilado. Ahora ESC cierra siempre el modal visible, uno por uno.
- **⚠️ Anular venta facturada con CAE pasaba a "cancelada" sin reversar la factura AFIP** → libros descuadrados (la factura sigue válida en AFIP). Fix: **bloquear "Anular" si la venta tiene CAE** y dirigir a *Devolver → emitir NC* (reversión fiscal correcta). Las ventas sin CAE (solo marcadas facturada) siguen anulándose normal.

Hallazgo de datos en Kiosko: la venta **#20** (Factura C #15, CAE real) fue anulada sin NC ANTES del fix → queda para reconciliación fiscal manual de GO (la factura AFIP sigue vigente). **Sobre cobranza CC no-efectivo sin caja:** se reflejada en la CC del cliente (deuda saldada), NO en caja (el `ingreso_informativo` solo se asienta con caja abierta) — comportamiento correcto, transferencia va al banco. typecheck + suite unit **734/734** verdes.

## [2026-06-15] deploy | v1.69.0 EN PROD — Auditoría costuras + click-through básico: 4 bugs reparados (anular stock, cobranza CC sin caja, devolución/masivo básico) · `dev=main`

**v1.69.0 a PROD (PR #210, sin migración, release latest).** Auditoría de costuras cross-module (costuras §3 del plan `tests/specs/auditoria-basico.plan.md`) + click-through interactivo de GO sobre Kiosko Buildi (básico). Validado contra los 2 tenants DEV (Almacén Jorgito avanzado + Kiosko Buildi básico — Kiosko tiene stock con `ubicacion_id`/`estado_id` NULL, 0 ubicaciones, 0 estados `es_devolucion`).

Costuras auditadas: **Gasto efectivo → caja** ✅ OK · **Servicio recurrente → gasto** ✅ OK. Bugs reparados:

- **🔴 #5 — Anular venta despachada no restauraba stock:** anular una venta **despachada/facturada** reembolsaba la seña pero **NO restauraba el stock** (el loop solo liberaba `cantidad_reservada`, que una despachada ya no tiene) → pérdida fantasma de inventario (ambos modos). **Decisión GO: "Anular restaura el stock".** Fix: reingreso al anular espejando Devolver (series → reactivar; no-series → nueva línea + `movimientos_stock`), mode-aware.
- **🔴 B (grave) — Cobranza CC en efectivo sin caja perdía el pago:** `cobrarDeudaCCFIFO` saldaba la deuda y *después* intentaba la caja; sin caja, la deuda quedaba saldada y el efectivo sin respaldo en arqueo. Fix: para efectivo **exige caja imputable ANTES de saldar** (devuelve `requiereCaja`); sin caja **bloquea** ("Abrí una caja…"). Raíz (`cobranzaCC.ts`) + 3 callers (ClientesPage, CajaCobranzasCC, VentasPage).
- **A — Devolución en básico mostraba "Destino del stock devuelto" (ubicación DEV):** sección WMS oculta en básico (el reingreso es directo, sin ubicación/estado; ya cubierto por el fix #4 de v1.68.0).
- **C — Rebaje/ingreso masivo mostraba LPN/lote + preview de LPNs en básico:** toda la UI WMS de `MasivoModal` (LPN/lote preferido, preview de LPNs a consumir, ubicación/estado/LPN del ingreso) gateada por modo. El "preview de LPNs" era la "cantidad distinta" que confundía.

typecheck + suite unit **734/734** verdes. **Pendiente (no bloqueante): reconciliar el pago CC huérfano de GO** (ya saldado sin asiento en caja, ocurrido antes del fix B) + click-through en vivo del anular/devolución.

## [2026-06-15] deploy | v1.68.0 EN PROD — Auditoría modo BÁSICO: 4 bugs reparados + plan + 2 e2e · `dev=main`

GO pidió dejar el **modo básico al 100%** de punta a punta (caja/ventas/gastos/inventario/productos/clientes/proveedores/facturación) y cazar bugs antes que un cliente. Pase de auditoría estática sobre la **clase de bug más cara** (mode-awareness del stock: en básico `inventario_lineas.ubicacion_id` Y `estado_id` son NULL — ver [[reference_basico_stock_null_ubicacion_estado]]). **4 bugs reales encontrados y reparados:**

1. **Ventas — flujo reserva→despachada** (`VentasPage`, `vendibleIdsCambio` sin gatear): el `movimientos_stock` del despacho guardaba `stock_antes/despues = 0` en básico. Fix: `modoAvanzado ? ... : []`.
2. **Productos — lista** (`ProductosPage`, `stockDisponibleMap`): **todos los productos mostraban "0 disponible"** (filtraba `estado_id IN vendibles`). Fix: gatear `evIds` por modo + no filtrar si vacío.
3. **Inventario — rebaje masivo** (`MasivoModal`, 2 queries con `.not('ubicacion_id')`): no encontraba stock en básico. Fix: aplicar el filtro solo en avanzado.
4. **Ventas — devolución** (`VentasPage`): **totalmente bloqueada en básico** — exigía ubicación + estado `es_devolucion` que el seed no crea y que básico no puede configurar (tabs ocultos). Fix: gatear el requisito por modo; en básico reingresar con `ubicacion_id/estado_id = NULL`.

**Entregables:** plan de auditoría exhaustivo `tests/specs/auditoria-basico.plan.md` (método 3 capas: traza estática + e2e mutante + click-through; checklist por módulo + costuras cross-module). e2e nuevos: `23_inventario_ingreso_mutante` (ingreso de stock, mutante) + `22_devolucion_mutante` (alcanzabilidad del flujo; el happy-path monetario exige medios exactos → manual). **typecheck verde · suite unit 734/734 verde.** Caveat: el tenant DEV de e2e está en avanzado → la validación definitiva de básico es el click-through manual (2 tenants DEV disponibles: **Almacén Jorgito** avanzado + **Kiosko Buildi** básico). **EN PROD v1.68.0 (PR #209, sin migración).**

## [2026-06-15] deploy | v1.67.0 EN PROD — Paquete UX (scrollbar tabs · Alertas mode-aware · layout RRHH · guardado Config) · `dev=main`

**v1.67.0 a PROD (PR #208, sin migración, release latest).** 4 mejoras de UX reportadas por GO:

1. **Gastos — scrollbar en tabs:** la barra de tabs usaba `overflow-x-auto` y mostraba el scrollbar. Se ocultó con `[&::-webkit-scrollbar]:hidden` + `scrollbarWidth:'none'` (mismo patrón que Inventario): scroll sigue, barra no.
2. **Alertas — badge "1" fantasma en básico:** el badge del sidebar (`useAlertas`) sumaba fuentes **avanzado-only** sin gatear (vencimiento de lote/LPN vencidos = WMS, OC vencidas/próximas = compras) → en básico contaba algo que la página no mostraba. Se hizo **mode-aware** el hook (queries condicionales + `queryKey` con `modoAvanzado`) y `AlertasPage` (queries `enabled: modoAvanzado`, render gates, total). Comunes a ambos modos: stock bajo mínimo, reservas, sin categoría, deuda CC. Ahora badge y página **siempre coinciden**. Memoria: [[reference_alertas_badge_mode_aware]].
3. **RRHH — layout feo/amontonado:** se sacó `max-w-7xl mx-auto px-4 py-8` → **ancho completo** (como Gastos, padding del layout general); header `text-4xl`→`text-2xl text-primary`; los ~12 tabs pasaron de `flex-wrap` (varias filas amontonadas) a **una sola fila scrolleable con iconos** (mapa `TAB_META` que además limpió el render verboso de `{tab === 'x' && ...}`).
4. **Configuración — muchos botones "Guardar" por tab:** todos llamaban al mismo `handleSaveBiz` (guarda toda la config). Se consolidaron a **un botón por tab**: **Envíos 11→1**, **Ventas→operativa 5→1** (negocio/inventario/descuentos ya tenían 1; caja 2, aceptable). Se quitaron por `replace_all` scopeado por indentación única de cada tab.

typecheck (`tsc --noEmit`) + `npm run build` verdes. Sin migración → deploy directo (Vercel auto desde `main`).

## [2026-06-15] update | UX — `ActionMenu` ("⋯ Acciones") replicado a Proveedores + Inventario (v1.66.0 EN PROD, PR #207)

Continuación del patrón de toolbar (acción principal visible + secundarias colapsadas en "⋯ Acciones", click no hover — ver [[feedback_toolbar_actionmenu]]). El piloto estaba en Productos + Clientes; GO pidió seguir con "las demás páginas" y revisar también las **sub-páginas/tabs** que cambian sus botones.

- **Proveedores** (`ProveedoresPage.tsx`): se eliminó el **bug real de hover-dropdown** (`group-hover:block`, no abría en touch) — el "Exportar JSON/CSV" del header pasó a `<ActionMenu>`. Además, el sub-toolbar de la tab **Servicios** (Servicios generales / Comparar presupuestos) se colapsó en un ActionMenu. La tab Órdenes solo tiene filtros + "Nueva OC" (sin cambios).
- **Inventario** (`InventarioPage.tsx`): la tab **Agregar stock** pasó de 3 botones (Ingreso / Masivo / ASN) a **Ingreso** (principal) + `ActionMenu[Ingreso masivo, Recepción/ASN]`.

**Barrido página por página del resto — no necesitan ActionMenu** (documentado en la nota): Ventas, Caja, Gastos, Envíos, Recepciones, Usuarios, Sucursales, Config = header de **1 botón** que cambia por tab; Facturación = período + Libros con 1 botón Exportar; **Reportes** = panel con 3 botones de formato Excel/PDF/CSV (color-coded, son el propósito, NO se colapsan); RRHH = formularios/cards sin toolbar de header; Historial = 2 botones (Filtros + Excel), aceptable. **Regla afinada:** colapsar solo con **3+ acciones secundarias dispares** o un **hover-dropdown**; 1-2 botones o toolbars de filtros/formatos se dejan. typecheck (`tsc --noEmit`) verde. Sin versión nueva ni migración — queda en DEV.

## [2026-06-14] deploy | v1.64.0 + v1.65.0 EN PROD — Backlog comprobantes: % Dto. por línea + facturas recurrentes · `dev=main`

GO pidió cerrar el backlog ("si va a servir a futuro, hagámoslo ahora"). Lo evalué críticamente y entregué los 2 de menor riesgo:

- **v1.64.0 (PR #204, sin mig):** **% Dto. por línea en el presupuesto.** El descuento ya vivía en `venta_items.descuento` (es un %, el subtotal ya viene neto); ahora el PDF de presupuesto lo muestra (tabla con columnas dinámicas, la columna aparece solo si hay descuentos).
- **v1.65.0 (PR #205, mig 213):** **Facturas/ventas recurrentes.** Tabla `ventas_recurrentes` (plantilla con snapshot de ítems + frecuencia + `proximo_at`, RLS por tenant). Generación **asistida y segura**: al vencer, crea un **presupuesto** ('pendiente', no toca stock/caja) por insert directo (`crypto.randomUUID`, `numero` por trigger) para revisar y facturar. lib `ventasRecurrentes.ts` + "Convertir en recurrente" desde una venta + panel "Recurrentes" (badge de vencidas, pausar/activar/eliminar, "Generar presupuesto ahora").

**Hallazgo que frenó los otros 2 (decisión consciente):** **percepciones y multimoneda USD NO son tweaks del PDF** — una percepción cambia lo que paga el cliente (descuadre vs caja/CC si solo se agrega a la factura), y una factura en USD requiere que la **venta** esté pricada en USD. Ambas son features de **momento-de-venta** (POS + ventas + caja/CC + EF AFIP). Además **el cliente que migra (RI, factura en ARS) no las necesita**. Recomendación: construirlas bien contra un caso real, no especulativamente. Quedan en backlog priorizado.

## [2026-06-14] deploy | v1.63.0 EN PROD — QR de pago MercadoPago en la factura (cierra paridad Xubio) · `dev=main`

**v1.63.0 a PROD (PR #203, `370e66e8`, release latest). Sin migración.** Cierra el backlog de paridad Xubio con un **extra que Xubio no tiene**. Reusa la EF **`mp-crear-link-pago`** (ya en PROD, la usa el POS) + `mercadopago_credentials` del tenant.

- **`facturasPDF`**: si la factura tiene **saldo pendiente** (`total − monto_pagado > 0`) y el tenant tiene **MP conectado**, el PDF embebe un **QR "Pagá con MercadoPago — saldo $X"** en el pie. `external_reference = venta_id` → `mp-webhook` concilia el pago automáticamente.
- **Builders** (Ventas `crearPagoMpQR` + Facturación): calculan el saldo; si > 0 crean el link y pasan el QR. Si no hay MP conectado o falla → factura **sin** QR (graceful, try/catch). Facturas ya pagadas → sin QR.

**🎉 Plan de paridad Xubio COMPLETO** (v1.61.0 logo → v1.62.0 factura completa + presupuesto A4 + remito → v1.62.1 fix domicilio → v1.63.0 pago MP). Quedan solo en backlog (si los piden): per-línea, factura recurrente de ventas, percepciones/retenciones, multimoneda USD. typecheck + build verdes.

## [2026-06-14] fix | v1.62.1 EN PROD — Domicilio del cliente en comprobantes (cliente_domicilios) · `dev=main`

**v1.62.1 a PROD (PR #202, `8d35d4bf`, release latest). Sin migración.** Bug: crear presupuesto o remito daba `column clientes_1.direccion does not exist` — me confié de un campo de formulario; **`clientes` NO tiene columna `direccion`**, las direcciones viven en la tabla **`cliente_domicilios`** (mig 074: calle/numero/piso_depto/ciudad/provincia/es_principal). **Fix:** los builders embeben `clientes(..., cliente_domicilios(...))` y arman el domicilio del receptor con el principal (helper `composeDomicilioCliente`). Aplica a factura, presupuesto y remito (Ventas) + factura (Facturación). typecheck + build verdes.

## [2026-06-14] deploy | v1.62.0 EN PROD — Comprobantes: presupuesto A4 + factura completa + remito (paridad Xubio) · `dev=main`

**v1.62.0 a PROD (PR #201, `dbf94a37`, release latest). Mig 212 aplicada en DEV+PROD antes del merge.** Cierra la paridad de comprobantes con Xubio (cliente RI que migra) + extras de cobro elegidos por GO.

- **Mig 212**: `tenants += ingresos_brutos, inicio_actividades, cbu, alias_cbu, banco, leyenda_comprobante, sitio_web` (opcionales, aditiva).
- **Presupuesto PDF A4 (nuevo `presupuestoPDF.ts`):** antes el presupuesto solo se imprimía como **ticket térmico** (`window.print()` del modal `ticketVenta`); ahora hay PDF A4 propio (logo + emisor + cliente + ítems con Cód. SKU + total + observaciones=`ventas.notas` + validez + datos bancarios + leyenda). Botones Descargar/Imprimir en el detalle del presupuesto. Builder `buildPresupuestoPDFDataPorId`.
- **Factura completa (`facturasPDF.ts`):** Ing. Brutos + Inicio de Actividades + contacto (tel/email/web); N° **con letra** (A-0001-…); **Moneda** + **Forma de pago** (de `medio_pago`, helper `parseFormaPago`); **domicilio del receptor** (los builders ahora lo pasan); columna **Cód. (SKU)**; **Régimen de Transparencia Fiscal Ley 27.743 en Factura B** (IVA contenido); **"Comprobante Autorizado"** + **datos para transferencia (CBU/Alias/Banco)** + **leyenda** en el pie.
- **Remito (nuevo `remitoPDF.ts`):** nota de entrega **no fiscal** (ítems sin precio + "Recibí conforme"); botones en el detalle de la venta (estado ≠ presupuesto). Builder `buildRemitoPDFDataPorId`.
- **Config → Facturación:** sección "Datos para los comprobantes" (IIBB, Inicio Act, sitio web, banco, CBU, alias, leyenda) + ya estaba el logo (v1.61.0).

**Decisión de re-scope (desafiando Xubio):** se descartó copiar el desglose IVA con todas las alícuotas en 0, Prov. Destino, per-línea (Observaciones quedó a nivel documento vía `ventas.notas`). Se sumó lo que Xubio no tiene: datos bancarios, leyendas/contacto, remito. **Único pendiente: link/QR de pago MercadoPago** (integración de pagos: preference API + creds MP por tenant + edge function + testing → deploy dedicado, no se shipea a ciegas). typecheck + build verdes.

## [2026-06-14] deploy | v1.61.0 EN PROD — Logo del negocio en la factura + filename con cliente · `dev=main`

**v1.61.0 a PROD (PR #200, `dca27a78`, release latest). Mig 211 aplicada en DEV+PROD antes del merge.** Fase 1 de un plan por fases para **igualar el formato de comprobantes de Xubio** (relevamiento a partir de 3 PDFs de un cliente que migra: Maderas El Tilo / Madera Carrizo Hermanos SRL, RI que emite A y B).

- **Mig 211**: bucket `logos` (público, policies scopeadas por carpeta de tenant, mismo patrón que `productos` de mig 209). `tenants.logo_url` ya existía (mig 001).
- **Config → Facturación**: subir / cambiar / quitar logo (`handleLogoChange` → bucket `logos` → `tenants.logo_url`, `setTenant` para sincronizar store).
- **`facturasPDF.ts`**: embebe el logo arriba a la izquierda (`cargarLogo`: Image crossOrigin → canvas → dataURL PNG, conserva aspecto; el bloque emisor usa `emX` y se corre a la derecha si hay logo). Si la imagen no carga → PDF sin logo.
- **Filename**: incluye el nombre del cliente saneado (`sanitizarNombreArchivo`).
- **Builders** (Ventas + Facturación): pasan `emisor_logo_url` desde `tenants.logo_url`.

**Plan por fases pendiente (paridad Xubio):** v1.62.0 = datos fiscales emisor (Ing. Brutos + Inicio de Actividades) + domicilio receptor + moneda + forma de pago + fecha vto + **Régimen de Transparencia Fiscal Ley 27.743** (obligatorio en B) + desglose IVA completo + "Comprobante Autorizado" + letra en N° + SKU por ítem. v1.63.0 = **PDF de presupuesto A4** (hoy el presupuesto solo se imprime como ticket vía `window.print()`). v1.64.0 = detalle por línea (Observaciones + % Dto.). typecheck + build verdes.

## [2026-06-14] deploy | v1.60.2 EN PROD — Menú "Acciones" en toolbars + bloqueo Factura A sin CUIT · `dev=main`

**v1.60.2 a PROD (PR #199, `82db1900`, release latest).** Solo frontend — **sin migraciones**.

- **UX `ActionMenu`** (`src/components/ActionMenu.tsx`): componente reutilizable que colapsa las acciones **secundarias** del header en un solo botón **"⋯ Acciones"** (abre con **click**, cierra con click-afuera/ESC, accesible, en mobile queda solo el ícono ⋯). Descongestiona el toolbar en mobile (GO reportó que los botones se salían de pantalla) y **arregla un bug real**: el menú "Exportar" usaba `group-hover` → en touch no se podía abrir. **Aplicado en Productos y Clientes (piloto)**; la acción principal ("+ Nuevo") queda visible aparte. Pendiente replicar al resto (Proveedores tiene el mismo bug de hover-dropdown, Ventas/Caja/Gastos/Inventario/Envíos/etc.).
- **Facturación — bloqueo de Factura A sin CUIT** en el POS: el botón "Factura A" se deshabilita cuando la venta no tiene cliente con CUIT (Responsable Inscripto) + aviso; si quedaba seleccionada, degrada a B. (La EF ya lo rechazaba con `Para Factura A se requiere CUIT del cliente`, pero ahora no se llega a intentar.)
- **Mensaje de error real al emitir** (POS + NC + módulo Facturación): se lee `error.context.json()` y se muestra el motivo de la EF en vez de "Edge Function returned a non-2xx status code". (GO reportó ese genérico al intentar Factura A a Consumidor Final.)

typecheck + build verdes.

## [2026-06-14] deploy | v1.60.1 EN PROD — Autocompletar email de factura + layout PDF · `dev=main`

**v1.60.1 a PROD (PR #198, `39705d38`, release latest).** Solo frontend — **sin migraciones**. Mejoras de UX sobre la facturación AFIP (v1.60.0):

- **Enviar factura por email → autocompleta el correo del cliente.** El botón "Enviar por email" antes usaba `window.prompt` (el prellenado dependía del navegador). Ahora abre un **modal propio** con el `clientes.email` de la venta **precargado y editable**. Aplica en **Ventas** (modal post-emisión + detalle/historial) **y** en el módulo **Facturación**.
- **PDF de factura → encabezado al margen derecho.** El bloque "FACTURA / N° / Fecha" estaba pegado al recuadro central del tipo de comprobante; ahora está **alineado al margen derecho** (`facturasPDF.ts`, `{ align: 'right' }` en `W - 14`).

**Contexto:** GO reportó que los botones descargar/imprimir/email "no hacían nada". Diagnóstico: el camino (`buildFacturaPDFData…` → `construirFacturaPDFDoc`) estaba sano y las columnas existían (migs 060/076); el síntoma "no pasa nada" era el bundle viejo cacheado por el SW (el fix real ya estaba en v1.60.0). Tras confirmar que ya funcionaban, GO pidió estas dos mejoras. typecheck + build verdes, `facturacion.test.ts` 28/28.

## [2026-06-14] deploy | v1.60.0 EN PROD — Facturación AFIP production-ready + cert propio + UX/bugfixes · `dev=main`

**v1.60.0 a PROD (PR #197, `427a03c4`).** GO autorizó "pasemos todos a PRD". Aplicadas en PROD **antes** del merge (deploy-order de aditivas): **mig 210** (`afip_produccion`, los 4 tenants en false = homologación, cero impacto) + **EF `emitir-factura` v8** (sha idéntico a DEV). PR dev→main merged, release **v1.60.0** marcada latest, Vercel auto-deploy de producción desde `main`. `dev=main` (salvo el commit de doc de cierre). Contenido completo en la entrada de abajo (cert propio cableado, Factura C sin IVA, auto-facturada, acciones descargar/imprimir/email, fix 400 venta_items.descripcion, recuperación de chunk, ESC stack, Alertas WMS en básico). Suite **734**.

**Acción pendiente de GO (no código):** para facturar en **producción real**, cargar cert de PRODUCCIÓN (issuer real, no "Test") + token AfipSDK prod en Config → Facturación y prender el toggle "Modo de emisión" → PRODUCCIÓN. Hoy todos en homologación.

## [2026-06-14] update | v1.60.0 DEV (cont.) — Facturación validada end-to-end + cert propio cableado + paquete de UX/bugfixes

**Sesión larga sobre facturación: de "preparar el camino" a validarla emitiendo CAE real (homologación) desde la app.** Todo en DEV (sin deployar a PROD aún). Suite unit **734** · typecheck + build verdes. EF `emitir-factura` **v8**.

**Hito: GO ya tenía el certificado.** Resultó que GO tenía un cert de **homologación** real (CUIT 23-32031506-9, issuer "Computadores Test"). Verificado emitiendo **Factura C** real por triplicado: test Node aislado (CAE #1), GO desde la app (CAE #2), y **e2e mutante automatizado** (`21_facturacion_mutante`, CAE #4). El certificado **NO** se guardaba en Genesis360 → **cablée la EF para leer `.crt`/`.key` del bucket `certificados-afip`** y pasarlos a AfipSDK por constructor (AfipSDK acepta cert+key directo). Modelo final = **AfipSDK cloud + certificado propio del tenant**. El uploader de Config dejó de ser código muerto.

**Bugs de facturación corregidos:**
- **Factura C (Monotributista) sin IVA:** la EF emitía C con array `Iva` → AFIP la rechazaría. Ahora C/NC-C: `ImpNeto=ImpTotal`, `ImpIVA=0`, sin `Iva`. El **PDF** de la C también: tabla sin columnas IVA + totales sin desglose.
- **`tipo_comprobante` "Factura C"→"C":** la BD guarda "Factura C" pero el PDF esperaba "C" → mostraba COD 06 (de B) y forzaba IVA. Se stripea el prefijo.
- **400 que rompía descargar/imprimir/email:** el SELECT pedía `venta_items.descripcion` (columna inexistente) → 400 → "Venta no encontrada" → fallaba en silencio. Quitada (el nombre viene de `productos.nombre`).
- **ImpTotal = ImpNeto + ImpIVA** (anti error AFIP 10048).
- **Auto-facturada:** al emitir el CAE, si la venta estaba `despachada` pasa a `facturada` (antes había que marcarla a mano). Mejora también las devoluciones (ofrece NC).

**UX de facturación (pedidos de GO):**
- **Acciones post-venta en el POS:** al emitir, la modal pasa a vista con **Descargar / Imprimir / Enviar email** (sin ir al historial). Mismos 3 botones en el detalle de venta y en el historial.
- **Imprimir** vía iframe oculto + autoPrint (el `window.open` tras `await` lo bloqueaba el popup-blocker).
- **Enviar por email** con el **PDF adjunto** (send-email `type=factura_emitida` + attachments base64).
- **Botón "Emitir factura"** en el detalle si se saltó el prompt (venta despachada sin CAE).
- **Visual del PDF:** recuadro del tipo más alto (cerca de la divisoria) + dirección del emisor con wrap (no se superpone con el recuadro).

**Bugs generales corregidos:**
- **"Loop entrada/salida" en /facturacion (y navegación lazy):** era un **chunk viejo** tras un deploy (React.lazy recibía `undefined` → "reading 'default'"). Agregada recuperación: `main.tsx` escucha `vite:preloadError`/errores de chunk y el **ErrorBoundary** detecta también `reading 'default'` → recarga 1 vez (guarda `sessionStorage` anti-bucle). No era reproducible en el código (probado con e2e).
- **ESC cierra el modal de arriba primero:** `useModalKeyboard` ahora usa un **stack global** (último abierto = el de arriba; al cerrarlo el siguiente toma el control). Resuelve que en el POS ESC cerraba el detalle en vez del modal de emitir. +5 unit tests (`modalKeyboard.test.ts`).
- **Alertas en básico:** se ocultan "Inventario sin ubicación" y "sin proveedor" (en básico el stock no usa ubicaciones ni proveedor por LPN → marcaba todo = ruido).

**Consulta respondida (QR de la factura):** es el QR fiscal obligatorio RG 4291. Lo escanea el **cliente** (verificar autenticidad) o **AFIP** (control); el emisor solo debe incluirlo. No sirve para cobrar/pagar.

**▶ Próximo (otra sesión):** decisión de GO de deployar v1.60.0 + mig 210 + EF v8 a PROD; para producción real: cert de PRODUCCIÓN (issuer real, no "Test") + token AfipSDK prod + toggle a PRODUCCIÓN. Commits dev: `d80551a8`→`b43e2fb5`.

## [2026-06-13] update | v1.60.0 DEV — Facturación AFIP: modo producción por-tenant + tests + fix ImpTotal (preparar "AFIP a PROD")

**Arranca "AFIP a PROD" — dejar la facturación lista para el primer cliente que facture.** El módulo ya estaba en PROD pero operando contra **homologación** (sandbox); el código `production` se decidía con una env var GLOBAL `AFIP_PRODUCTION` (peligrosa: prendería a todos los tenants a emitir real de golpe). Decisión de GO: flag **por-tenant** + **preparar el camino** (sin emitir real todavía). En DEV (NO en PROD aún). Suite unit **726** (701→726) · typecheck + build verdes.

- **Modo de emisión por-tenant (mig 210):** `tenants.afip_produccion BOOLEAN DEFAULT false` (todos los existentes → homologación, cero impacto). La EF `emitir-factura` (**v5** en DEV) decide `isProduction = !masterKill && tenant.afip_produccion === true`; `AFIP_FORCE_HOMOLOGACION=true` = freno de emergencia global. Toggle owner-only en Config→Facturación (banda "Modo de emisión") con confirmación explícita (checkbox) + guard (exige CUIT + token guardados).
- **Fix anti error AFIP 10048:** la EF arma `ImpTotal = ImpNeto + ImpIVA` (no `ventas.total`, que puede diferir por redondeo/descuento global → AFIP rechaza). Warning si difiere > $0.50.
- **Tests (pedido de GO):** nueva lib pura `src/lib/facturacionLogic.ts` (auto-tipo A/B/C, desglose IVA multi-alícuota, DocTipo/DocNro + umbral RG 5616, QR RG 4291) + **25 unit tests** (`tests/unit/facturacion.test.ts`, plan en `tests/specs/facturacion.plan.md`). Refactor: `facturasPDF.ts` (QR) y `VentasPage` (auto-tipo) ahora usan la lib (dedup). **La emisión real WSAA+WSFE NO se unit-testea** (depende de AFIP) → smoke manual.
- **Opinión sobre el comentario de GO (afip.js con .key/.crt):** el consejo "usar una librería" ya se cumple — usamos `@afipsdk/afip.js`. El comentario describe el modo **self-host** (cert local). Adoptamos un **híbrido**: cert propio del tenant + AfipSDK para la firma WSAA (ver abajo).
- **GIRO: GO YA tenía el certificado.** Inspeccionando `e:\...\AFIP\Certificado.crt`: CUIT **23-32031506-9**, issuer "Computadores Test" (= **homologación**), válido a 2028. Test Node aislado (`test_propio.mjs`) con `cert`+`key`+token → **Factura C #1, CAE 86240262256502** ✅. Confirma que el cert anda y que **AfipSDK acepta cert+key por constructor**.
- **Por eso CABLEÉ el cert a la EF (v6):** lee `.crt`/`.key` del bucket `certificados-afip` (`tenant_certificates`) y los pasa a AfipSDK. El uploader de Config (antes código muerto, mig 043) es ahora el **mecanismo oficial**. Modelo final = **AfipSDK cloud + certificado propio del tenant**.
- **Fix Factura C / NC-C (EF v7):** Monotributista NO discrimina IVA → `ImpNeto=ImpTotal`, `ImpIVA=0`, sin array `Iva` (AFIP rechaza C con IVA). `calcularImportes` + 3 tests (suite **729**). **Esto habría hecho fallar la emisión de GO** (es monotributista).
- **DEV "Almacén Jorgito" (3769b1db) pre-cargado** (token homol + facturación + PV nº1, CUIT ya estaba). GO entra con su cuenta (es DUEÑO), sube el cert por Config→Certificados AFIP, vende → emite Factura C → CAE.
- **▶ Próximo:** smoke de GO desde la app (homologación) → luego commit/tag final + decisión de deployar v1.60.0 + mig 210 a PROD. Para producción real: cert de PRODUCCIÓN (no "Test") + token AfipSDK prod + toggle a PRODUCCIÓN.

## [2026-06-13] deploy | v1.59.4 PROD — $/km editable en el envío del POS (básico sin Config→Envíos) · `dev=main`

**v1.59.4 (PR #196, UI-only).** GO: en modo básico no existe Config→Envíos para cargar la tarifa por km, así que el modo "Por KM" del envío en el POS quedaba inusable (el campo `$/km` era read-only, mostraba "—"). **Fix:** el campo `$/km` ahora es un **input editable** (pre-cargado con `sucursal.costo_km_envio`/`tenant.costo_envio_por_km` si existe, vacío si no). El costo (km × $/km) se recalcula solo (effect ya existente). Funciona en básico (cargás la tarifa ad-hoc por venta) y en avanzado (override por venta). El modo "$ Monto fijo" sigue como alternativa para tipear el costo total directo. `dev=main` `6d76cd92`.

## [2026-06-13] deploy | v1.59.2 + v1.59.3 PROD — Fix venta en básico (estado) + UX Inventario · `dev=main`

**Dos patches a PROD el mismo día tras el feedback de GO probando el modo básico.** Sin migración (UI-only). `dev=main` en `669e528e`.

**v1.59.2 (PR #194) — el bloqueo REAL de la venta en básico era el ESTADO.** v1.59.1 había arreglado el filtro de **ubicación** en el despacho, pero GO seguía sin poder vender. Causa raíz (que GO intuyó desde el inicio): el stock de básico tiene **`estado_id = NULL`**, y el cálculo de **stock disponible** (`stockMap` que alimenta `agregarProducto`) filtraba `.in('estado_id', es_disponible_venta)` → excluía el stock NULL-estado → `stock_disponible = 0` → `agregarProducto` bloqueaba con "Este producto no tiene stock disponible" ANTES del despacho. **Fix:** el filtro de estado aplica solo en avanzado (`modoAvanzado && estadosFinal…`) en los cálculos de stock disponible (buscador stockMap + grupo2 + snapshot post-venta `stockVendibleSucursal` vía `vendibleIds=[]`). En básico todo el stock activo es vendible. Verificado en DEV (Kiosco Buildi: 14 u NULL-estado → vendibles). **Regla aprendida:** el stock de básico tiene `ubicacion_id` Y `estado_id` en NULL → toda query de venta/disponibilidad que filtre por ubicación o estado debe ser mode-aware.

**v1.59.3 (PR #195) — UX de Inventario (review GO):** (1) **alineación de la columna Cantidad** en la grilla de stock — regresión de v1.59.1: el header quedó en `grid-cols-4` en básico mientras las filas pasaron a `grid-cols-2` (header "centrado", valores a la derecha); header ahora `grid-cols-2`. (2) **ESC cierra el modal de detalle** de movimiento (ingreso/rebaje/historial) vía `useModalKeyboard`. (3) **Enter en Agregar/Quitar Stock** abre el modal de ingreso/rebaje (ya andaba) + ahora la búsqueda de SKU tiene `autoFocus`. Shortcuts generales (básico + avanzado).

## [2026-06-13] deploy | v1.59.1 PROD — Fix venta en básico (bloqueante) + recortes Inventario WMS + e2e caja · `dev=main`

**v1.59.1 a PROD** (PR **#193**, UI-only sin migración — 208/209 ya estaban en PROD; `dev=main` en `7fe10281`). CI unit verde; Vercel producción auto-deploy desde `main`. **Nota:** durante el deploy, Vercel mostró un build ERROR en la rama **dependabot del PR #192** (Vite 8) — `Cannot find module 'esbuild'` (dependabot removió esbuild pero un plugin lo necesita); es la rama cerrada, **no afecta producción** (que buildea desde `main`). Conviene borrar esa rama desde GitHub para que pare el ruido.

## [2026-06-13] fix | v1.59.1 — BUG CRÍTICO: vender en modo básico (stock sin ubicación) + e2e mutante de caja

**Bug reportado por GO: en modo básico no se podía completar una venta** ("stock insuficiente" pese a haber stock). **Causa raíz:** básico no usa ubicaciones → el ingreso de stock deja `inventario_lineas.ubicacion_id = NULL`, pero `registrarVenta` surtía filtrando `.not('ubicacion_id','is',null)` en **5 queries** (buscador de stock, fetch de series, venta nueva, reserva→despachar, despachar reserva) → excluía todo el stock básico. El buscador mostraba `stock_actual` (trigger) pero el despacho devolvía 0. **Fix (v1.59.1, commit `ce50d2ac`):** helper `soloUbicado(q)` que aplica el filtro de ubicación **solo en avanzado** (WMS); en básico se surte aunque `ubicacion_id` sea NULL. Avanzado sin cambios. **Verificado empíricamente en DEV** (Kiosco Buildi básico: query vieja→0 disponible, query nueva→10) + regresión e2e de venta (avanzado) verde + build verde. **Pendiente menor (no bloqueante):** la alerta "Inventario sin ubicación" (`AlertasPage`) marcaría todo el stock básico como sin ubicación = ruido; suprimir en básico.

**Inventario en básico — recortes de superficies WMS (review GO, 4 ítems):** (1) ajuste +1/-1 es por diseño vía Agregar/Quitar stock (no hay ajuste a nivel LPN en básico — correcto); (2) modal de detalle de movimiento (ingreso/rebaje/historial) → ocultos **Estado** y **LPN/Pallet** en básico; (3) tab **Autorizaciones** oculto en básico (+ reset) — no existe el modal de acciones LPN que las genera; (4) grilla de stock → ocultas columnas **Lote/Venc.** y **Series** (header+celdas, grid-cols 4→2). Avanzado sin cambios.

**También (pilar B testing):** primer **e2e mutante de ciclo de caja** (`20_caja_apertura_cierre`): abre una caja cerrada del owner, arqueo parcial y cierre de punta a punta (self-healing). Limpieza previa: sesión stale de Caja4 ($42.714) cerrada en DEV. **v1.59.1 NO deployado a PROD aún** (commits dev `9b1bf085`/`ce50d2ac`/`7ce2073b`).

## [2026-06-13] deploy | v1.59.0 PROD — Auditoría pre-cliente (básico + seguridad migs 208/209 + react-router + e2e mutante) · `dev=main`

**Toda la auditoría pre-cliente (tandas 1+2 + recorrido funcional + salud + testing) a PROD en un PR.** GO autorizó "testing y luego pasamos a PRD". **PR #191** merged a `main`, migs **208**+**209** aplicadas en PROD ANTES del merge (idempotentes/aditivas), release **v1.59.0** `--latest`, `dev=main` (`47749296`). Vercel auto-deploy de producción desde `main`. Verificado en PROD: planes policy ✓, `verificar_clave_maestra` anon=false ✓, `cerrar_periodo` search_path ✓, bucket `avatares` SELECT scopeado ✓. CI: unit verde, e2e SKIPPED (gateado por `RUN_E2E`, no depleta DEV).

- **Contenido:** recortes modo básico (Productos→Estructura, Config→Conectividad→API; se mantiene Integraciones) · seguridad 208 (planes RLS, search_path 25→0, anon SECURITY DEFINER 29→15, clave maestra anti-fuerza-bruta) · seguridad 209 (buckets que listan 2→0) · react-router-dom 6.30.4 · primer e2e mutante de venta (suite 701 unit + 158 e2e).
- **Acción pendiente de GO (no SQL):** activar Leaked Password Protection en Supabase → Authentication → Policies.
- **Backlog post-deploy:** e2e mutantes restantes (caja lifecycle/recepción/devolución), y a futuro RLS por sucursal (cuando haya multi-sucursal), pase de performance, Vite 8, AFIP a PROD.

## [2026-06-13] update | v1.59.0 DEV — Auditoría pre-cliente T1: recortes modo básico + endurecimiento de seguridad (mig 208)

**Arranca la auditoría pre-primer-cliente.** Dos frentes en una tanda, en DEV (NO deployado a PROD aún). Suite unit **701/701** · typecheck + build verdes. Commit `dev` `6eb93b5d`.

**1) Recortes de modo básico (pedido GO: "encontrá vos las sub-pestañas que no deberían estar en básico").** Auditoría sistemática de las pestañas internas de cada módulo visible en básico. UI-only, sin migración. GO eligió:
- **Productos → Estructura** (jerarquía de empaque unidad/caja/pallet con pesos/dims = WMS) → oculta en básico. La página no chequeaba modo (el recorte de v1.58.0 fue en el *form*, no acá). Gateada por `modoAvanzado` + reset de tab.
- **Configuración → Conectividad → sub-tab "API"** (API pública del marketplace `marketplace-api` + webhook) → oculto en básico. **Se mantiene el sub-tab "Integraciones"** (TiendaNube/MercadoLibre/MercadoPago) — decisión GO.
- Evaluadas y **dejadas**: Ventas→Canales (reporte por canal, inofensivo). Verificadas ya-gateadas: Inventario (Kits/ubicación/columnas WMS), Proveedores (OC), Config (Envíos), Gastos (OC/Reportes/Recursos).

**2) Endurecimiento de seguridad — mig 208 (idempotente, aplicada en DEV).** Remedia hallazgos de `get_advisors(security)`:
- **`planes`**: policy SELECT pública (catálogo global lockeado; el front no lo lee). `rls_enabled_no_policy 1→0`.
- **`search_path=public`** en 25 funciones (loop por `oid::regprocedure`). `function_search_path_mutable 25→0`.
- **`REVOKE FROM PUBLIC` + re-`GRANT`** en SECURITY DEFINER no públicas. **Gotcha clave:** el EXECUTE de anon venía del grant a **PUBLIC**, no de un grant a `anon` — `REVOKE FROM anon` era no-op. Tras el fix: `anon SECURITY DEFINER 29→15`. Fuera de anon: períodos (cerrar/reabrir), sweeps CC, `cliente_cc_estado`, `verificar/requiere_clave_maestra` (corta fuerza bruta), seeds/triggers (anon+auth fuera, service_role escape — onboarding sigue OK porque los `fn_seed_*` son SECURITY DEFINER de postgres). Los 15 anon restantes son por diseño (10 token-gated + 5 helpers RLS que no-opean sin `auth.uid()`).
- **Follow-up (no en 208):** 2 buckets que listan (avatares/productos), pg_net en public, leaked-password (toggle Auth de GO), `authenticated` SECURITY DEFINER (by-design), RLS por sucursal (#8).

**3) C. Recorrido funcional — ✅ VERDE.** Tenant nuevo básico ("Kiosco Buildi" en DEV) totalmente operable: seeds completos (sucursal/caja/motivos/estados/unidades/canales/cat-gasto/5 métodos de pago), categoría de producto opcional, venta despacha por auto-FIFO sin picker (Fase B de `registrarVenta`). Sin bloqueantes.

**4) D. Salud técnica — ✅ HECHO.** npm audit 7→5 vulns: arreglada **react-router-dom 6.21→6.30.4** (open-redirect, no-breaking, commit `d6792c4f`); las 5 restantes son build-tooling dev-only (esbuild/vite/uuid) que requieren el salto breaking a Vite 8 → diferido (impacto runtime ~nulo). `get_advisors(performance)` PROD: **646 lints** todos deuda de optimización (FK sin índice, índices sin uso, RLS auth_initplan, policies múltiples) — ninguno bloquea un primer cliente con poco volumen → NO se tocan pre-cliente (optimización prematura + riesgo); candidato a pase de performance dedicado a futuro.

**5) Seguridad follow-up (tanda 2) — mig 209.** ✅ **Buckets que listan CERRADO**: las policies SELECT amplias de `avatares`/`productos` (cualquier authenticated listaba todos los tenants) reemplazadas por SELECT scopeado a la propia carpeta (user_id/tenant_id). Advisor `public_bucket_allows_listing` 2→0; la app no lista (solo upload+getPublicUrl). **pg_net en public → WON'T-FIX** (es `extrelocatable=false`, 7 funciones lo usan, WARN de baja severidad). **RLS por sucursal #8 → DIFERIDO con datos**: 33 tablas con `sucursal_id` pero 0 tenants multi-sucursal y 0 usuarios restringidos en PROD → exposición real nula hoy; hacerlo cuando llegue el primer tenant multi-sucursal (migración grande/riesgosa, no a ciegas). Leaked-password sigue siendo toggle de GO en Auth. Estado seguridad DEV: search_path 0, rls_no_policy 0, bucket_listing 0, anon SECURITY DEFINER 15 (por diseño), authenticated 32 (por diseño), pg_net 1 (won't-fix), leaked-pw 1 (GO).

**▶ Próximo:** decisión GO de deployar v1.59.0 + migs 208/209 a PROD (aplicarlas antes del merge), B. testing exhaustivo + e2e mutantes, leaked-password toggle de GO, y a futuro RLS por sucursal cuando haya multi-sucursal.

## [2026-06-13] cierre-sesión | Modo Básico/Avanzado (WMS) COMPLETO en PROD (v1.55→v1.58) + auditoría de roles · próximo: auditoría pre-primer-cliente

**Sesión grande: 4 releases a PROD (v1.55.0 → v1.58.0).** El modo de operación Básico vs Avanzado quedó **completo y en producción**, más la auditoría de roles y el recorte de superficies internas del básico. Estado al cierre: PROD = DEV = **v1.58.0**, migrations 001-**207**, `dev=main` (salvo 1 commit de wiki). Suite unit **701** · e2e por rol (owner/cajero/supervisor/rrhh/**deposito**/**contador**).

- **v1.55.0** (mig 207) F1 fundación · **v1.56.0** F2+F3 · **v1.57.0** "mínimo mostrador" + auditoría de roles (`navVisibility.ts` puro, 2 bugs corregidos: DEPOSITO/Recepciones + CONTADOR/Historial; rol custom read-only) · **v1.58.0** recorte de superficies internas (Kits, es_kit, mayoristas, tabs OC/Reportes-compras/Recursos de Gastos).
- **e2e DEPOSITO + CONTADOR habilitados:** usuarios de prueba creados en DEV (gotcha GoTrue de tokens NULL resuelto); 27 verdes.

**▶ PRÓXIMA SESIÓN — AUDITORÍA PRE-PRIMER CLIENTE.** GO pidió "testear todo y que quede la app funcional para un primer cliente". Plan completo + hallazgos concretos de `get_advisors(security)` en PROD documentados en `project_pendientes.md` → sección "PRÓXIMA SESIÓN — AUDITORÍA PRE-PRIMER CLIENTE". Resumen: **A. Seguridad** (1 RLS sin policy 🔴, 25 funciones sin search_path, 30/39 SECURITY DEFINER públicas a revisar, buckets que listan, leaked-password off; + #8 RLS por sucursal = riesgo #1) · **B. Testing** (suite completa todos los roles + e2e mutantes reales) · **C. Recorrido funcional** (alta tenant → vender → caja, en básico y avanzado) · **D. Salud** (advisors performance, npm audit 5 vulns) · **E. Bloqueantes** (AFIP en DEV, datos limpios).

## [2026-06-13] deploy | v1.58.0 PROD — recorte modo básico + e2e DEPOSITO/CONTADOR habilitados · `dev=main`

**v1.58.0 a PROD** (PR **#190**, UI-only sin migración; Vercel producción READY desde `main` sha `fa06ccf9`, `dev=main`). Recorte de superficies internas del modo básico (Inventario→Kits · Productos→es_kit+mayoristas · Gastos→OC/Reportes-compras/Recursos).

**e2e DEPOSITO + CONTADOR habilitados (pedido GO):** creados los usuarios de prueba en DEV vía SQL — `deposito1@local.com` (rol DEPOSITO) y `contador1@local.com` (rol CONTADOR), tenant `3769b1db` (el de los e2e), sucursal de los otros test users, `puede_ver_todas=false`. Credenciales en `tests/e2e/.env.test.local` (gitignored). **27 tests verdes** (`npx playwright test --project=chromium-deposito --project=chromium-contador`). **Gotcha resuelto:** al insertar en `auth.users` por SQL, GoTrue rechaza el login si `confirmation_token/recovery_token/email_change_token_new/email_change` quedan en NULL — hay que setearlos en `''` (cadena vacía, como hace cajero1).

## [2026-06-13] update | v1.58.0 DEV — Modo básico: ocultar superficies internas avanzadas "claras"

Tras el deploy, GO pidió auditar qué pestañas/sub-secciones internas seguían siendo avanzado dentro de básico. Auditoría completa por módulo (señalada en el chat); GO eligió mover **solo los claros** (sin migración):
- **Inventario:** pestaña **Kits** oculta en básico (+ reset de tab).
- **Productos:** toggle **"Es un KIT"** (heredado → solo-lectura) y acordeón **Precios mayoristas** ocultos (tiers existentes siguen aplicando en POS).
- **Gastos:** pestañas **Órdenes de Compra**, **Reportes (compras)** y **Recursos** ocultas (+ reset a Gastos).
- **Se dejan en básico (decisión GO, útiles para pyme AR):** Conteos, variantes talle/color, precio USD, Caja Fuerte/Bóveda, Cheques, Cierres contables, Autorizaciones, Cobranzas CC.
- Suite **701** · typecheck + build verdes. Release v1.58.0 sobre `dev`. **No deployado a PROD aún** (va en el próximo pasaje).

## [2026-06-13] deploy | v1.57.0 PROD — Modo Básico/Avanzado (WMS) completo + auditoría de roles (mig 207) · `dev=main`

**Deploy a PROD del modo de operación completo (v1.55.0 → v1.57.0) en un solo PR.** GO autorizó "pasa todo a PROD". **PR #189** merged a `main`, mig **207** aplicada en PROD ANTES del merge (aditiva → los 4 tenants de PROD quedaron en `avanzado`, cero impacto visual). Vercel auto-deploy de producción desde `main` (sha `6b4ed464`). `dev` resincronizado con `main`. Releases v1.55.0/v1.56.0/v1.57.0 ya publicados (tags sobre los commits, ahora en main).

- Lo que entró: **F1** (mig 207, fundación + nav/rutas + Productos + Inventario), **F2+F3** (POS/Proveedores/Config/Dashboard + banner sugerencia), y **v1.57.0** (básico "mínimo mostrador" = 12 módulos + auditoría de roles con `navVisibility.ts` + 2 bugs de roles corregidos + rol custom read-only + e2e DEPOSITO/CONTADOR).
- Para ver el modo básico en un tenant: Configuración → Negocio → Modo de operación → Básico (los existentes arrancan en avanzado).
- **Pendiente menor:** crear usuarios de prueba DEPOSITO+CONTADOR en DEV para correr esos e2e (se omiten sin credenciales).

## [2026-06-13] update | v1.57.0 DEV — Modo básico "mínimo mostrador" + auditoría de roles con tests

GO planteó dos cosas tras el modo Básico/Avanzado: (1) el básico mostraba demasiados módulos, (2) auditar que cada rol pueda hacer su trabajo. Sin migración. Release **v1.57.0** sobre `dev`. Suite unit **701** (+22) · typecheck + build verdes.

- **Nav básico "Mínimo mostrador":** Recursos y Biblioteca → `avanzadoOnly` (features empresariales); Facturación solo en básico si `facturacion_habilitada`; Sucursales solo si >1. Guard de rutas extendido a `/recursos` y `/biblioteca`. Básico típico (DUEÑO, 1 suc, sin facturación) = **12 módulos usables**.
- **Auditoría de roles como tests:** lógica de visibilidad extraída a `src/lib/navVisibility.ts` (pura) + matriz rol×modo (`navVisibility.test.ts`, 16 casos). **2 bugs corregidos:** `supervisorOnly` ocultaba Recepciones a DEPOSITO e Historial a CONTADOR pese a `depositoVisible`/`contadorVisible` (y a estar en sus allowlists) → ahora el permiso explícito por rol prevalece sobre los gates de admin.
- **Gap cerrado — rol custom read-only:** `src/lib/permisosModulo.ts` (`moduloSoloLectura`/`moduloOculto`/`puedeEditarModulo`) + enforcement en las mutaciones de Ventas, Caja, Inventario, Productos, Gastos y Clientes. Antes un rol custom `'ver'` igual podía mutar (solo se chequeaba en el nav).
- **e2e roles faltantes:** specs DEPOSITO (17) y CONTADOR (18) + auth setups + projects en `playwright.config` (gated por `E2E_DEPOSITO_*`/`E2E_CONTADOR_*`; skip sin credenciales). **Prerrequisito de GO:** crear esos 2 usuarios de prueba en DEV.
- **Revisado sin cambio:** ADMIN cierra período contable = no es bug (ADMIN es rol de poder consistente en compras/caja). 
- **Pendiente:** sigue faltando deployar todo el modo (v1.55–v1.57) a PROD — mig 207 antes del merge dev→main.

## [2026-06-12] update | v1.56.0 DEV — Modo básico/avanzado F2+F3 — feature COMPLETO (falta solo deploy a PROD)

Cierra el feature en la misma sesión que F1. **Sin migración.** Release **v1.56.0** sobre `dev` (`--latest`). Unit **679** · build + typecheck verdes.

- **F2 — superficies internas en básico:** POS sin picker de LPN ni cotización por API de courier (costo de envío manual queda) · Proveedores sin tab OC, sin "Nueva OC" ni "Comparar presupuestos" (queda ficha + CC + pagos + servicios) · Config sin tab Envíos, Inventario reducido a Categorías/Motivos/Unidades, Gastos sin gobierno de OC ni alerta de anticipo, deep-links redirigen (`useEffect` guard) · Dashboard sin chip de área Envíos.
- **F3 — adquisición:** banner descartable en Dashboard (DUEÑO en básico + `sugiereModoAvanzado(tipo_comercio)`: repuestos/construcción/electrónica/farmacia/ferretería/perfumería/veterinaria) con CTA a Configuración; dismiss en localStorage por tenant. Copy de planes ya hecho en F1.
- **Pendiente:** deploy a PROD (mig 207 antes del merge) · e2e smoke del modo básico (menor).

## [2026-06-12] update | v1.55.0 DEV — Modo de operación Básico vs Avanzado (WMS) · F1 (mig 207)

**Feature nueva pedida por GO**: dos experiencias en un solo SaaS. **Básico** (default para tenants nuevos, todos los planes) = mostrador simple para kioscos/almacenes/pymes chicas; **Avanzado (WMS)** = el sistema completo, toggle del DUEÑO en Config → Negocio gateado a **Pro+** (feature `wms`; el trial lo prueba gratis vía el mecanismo existente de features Pro en trial). Decisiones de GO: existentes → avanzado · downgrade permitido con advertencia (productos trackeados conservan flujo) · onboarding sugiere avanzado según tipo de comercio (F3). Plan completo + matriz de módulos en `wiki/features/modo-basico-avanzado.md`.

- **Principio**: el modo gatea **UI, nunca datos** — el ledger sigue grado WMS por debajo (LPN auto, despachos, FIFO), así el upgrade muestra el historial ya trazable sin migración de datos.
- **Mig 207** (aditiva, DEV ✅ / PROD pendiente): `tenants.modo_operacion` default `'basico'` + backfill existentes → `'avanzado'`.
- **Fundación**: feature `wms` en `FEATURES_POR_PLAN`/`PLAN_REQUERIDO` + `usePlanLimits.puede_wms` + lib pura `modoOperacion.ts` (esModoAvanzado/motivoBasico/productoRequiereTracking/sugiereModoAvanzado, +14 tests) + hook `useModoOperacion` + kill-switch `MODO_BASICO_ENABLED` (rollback global de 1 línea).
- **Gating F1**: nav/rutas (Recepciones/Envíos/Historial `avanzadoOnly` + redirect) · Config card "Modo de operación" (candado por plan, advertencia downgrade con conteo de trackeados, aviso plan insuficiente) · Productos (tracking/regla/aging/peso-dim/ubicación-estado solo avanzado; heredados solo-lectura) · Inventario (Traslados solo si >1 suc, sin vista por ubicación, ingreso/rebaje simplificados, conteo rápido forzado sin ABC/cíclico, grilla sin columnas WMS).
- **Verificación**: unit **679/679** (+14) · typecheck + build verdes · mig 207 aplicada en DEV (8 tenants → avanzado). Release **v1.55.0** sobre `dev` (`--latest`).
- **Pendiente**: F2 (POS/Proveedores/secciones Config) · F3 (sugerencia onboarding + copy planes + e2e) · aplicar mig 207 en PROD antes del merge dev→main.

## [2026-06-12] cierre-sesión | Sesión 2026-06-11/12: testing e2e + auditoría de procesos #1-6 → 4 releases en PROD · `dev=main`

**Sesión larga con 4 releases a PROD** (v1.51.1 → v1.54.0), todas con `dev=main` al cierre. Suites al cierre: **unit 665/665** (45 archivos) · **e2e 130** (16 specs, 4 roles) · migrations 001-**206** en DEV+PROD.

1. **v1.51.1 — Testing e2e** (PR #180): suite e2e reparada (11 smoke podridos tras ~50 versiones de UI) + tests de gobernanza de caja + `vitest fileParallelism:false` (OOM con paralelismo).
2. **Auditoría de procesos** (pedido GO): flujos cruzados entre módulos verificados contra código → 6 hallazgos accionables + riesgos. Registrada en `project_pendientes.md` → "Auditoría de procesos 2026-06-11".
3. **v1.52.0 — quick wins #1-3** (PR #182, sin mig): cobranza CC impacta caja (3 vías) · anular venta cancela envíos `pendiente` · envío devuelto → CTA devolución.
4. **v1.53.0 — #4 traslados entre sucursales** (PR #184, mig **205**): tab Traslados en Inventario con tránsito + confirmación del destino + faltantes auditados (relevamiento corto con GO: 4 decisiones).
5. **v1.54.0 — #5+#6 cheques conectados + limpieza EF** (PR #186, mig **206**): pagar OC/gasto con "Cheque" crea el cheque vinculado; rechazado revierte el pago (deuda reaparece en CC proveedor) · `process-aging` eliminada (muerta) · `birthday-notifications` verificada (cron GH Actions diario — hallazgo de auditoría corregido).

**Pendientes de la auditoría:** **#7 cron externo para sweeps** (infra GH Actions lista — próximo candidato) · **#8 RLS por sucursal** (deuda de seguridad). **Pendiente de GO:** responder relevamiento Inventario/WMS (`relevamiento-inventario-reglas-negocio.html`) · conseguir cuenta B2B courier (EN6).

## [2026-06-12] deploy | v1.54.0 PROD — Cheques conectados al circuito de pago + limpieza EF (mig 206) · `dev=main`

**Ítems #5 y #6 de la auditoría de procesos.** PR **#186** merged, release **v1.54.0** `--latest`, mig **206** en DEV+PROD (aditiva, antes del merge). Suites: unit **665/665** (+11) · e2e owner 69/69 · build verde.

- **#5 Cheques conectados** (antes: cuaderno standalone — doble carga manual, rechazo cosmético):
  - Mig 206: `cheques.gasto_id` + índices (`oc_id` existía desde mig 187 pero nunca se llenaba).
  - **Pagar OC con medio "Cheque"** (GastosPage → registrarPagoOC) crea el cheque vinculado (propio/entregado, `oc_id`+proveedor) con mini-form inline ámbar: n°/banco/**fecha de cobro obligatoria** (alimenta `chequeProximoACobrar`). Ídem **pago de gasto** (registrarPagoGasto, `gasto_id` + proveedor del gasto).
  - **Cheque propio RECHAZADO revierte el pago** (ChequesPanel → cambiarEstado): OC → `monto_pagado -= cheque` + estado recalculado (`reversionPagoOC`) + **ajuste +monto en `proveedor_cc_movimientos`** (la deuda reaparece en la CC del proveedor); gasto → `pendiente`/`parcial` (`reversionPagoGasto`). Toast "↩️ pago revertido" + actividad log.
  - Lib pura en `comprasCheques.ts`: `montoChequeDeMedios` + 2 reversiones (+11 tests). Pendiente menor futuro: tercero depositado/cobrado → cuenta de origen/bóveda.
- **#6 EFs huérfanas — hallazgo de auditoría CORREGIDO:** `process-aging` **eliminada del repo** (código muerto confirmado: ConfigPage llama la RPC `process_aging_profiles` directo; el wrapper EF quedó sin callers). `birthday-notifications` **NO estaba huérfana**: tiene cron diario en GitHub Actions (`birthday-notifications.yml`, runs diarios OK) — el grep de la auditoría no había revisado `.github/workflows/`. **Bonus:** la infraestructura de cron externo (GH Actions + secrets Supabase) ya existe → el ítem #7 (sweeps lazy → cron) es barato de implementar.

**Próximo de la auditoría:** #7 cron externo para sweeps (infra lista). **Pendiente de GO:** relevamiento Inventario/WMS offline.

## [2026-06-11] deploy | v1.53.0 PROD — Traslados de stock entre sucursales (tránsito + confirmación, mig 205) · `dev=main`

**Ítem #4 de la auditoría de procesos — el gap más grande del modelo multi-sucursal, cerrado.** GO pidió "sigamos con #4"; relevamiento corto vía 4 preguntas (eligió las 4 recomendadas): **tránsito + confirmación** · **detalle por LPN/línea** (lote/venc/series viajan con la línea) · **DEPOSITO+ crea, el destino confirma** · **recepción parcial con faltante auditado**. PR **#184** merged, release **v1.53.0** `--latest`, mig **205** en DEV+PROD (aditiva, aplicada antes del merge). Suites: unit **654/654** (+22) · e2e owner 68/68 + smoke del tab nuevo · build verde.

- **Mig 205**: `traslados` (correlativo por tenant vía trigger `set_traslado_numero`, estados `en_transito/recibido/recibido_parcial/cancelado`, `envio_id` reservado para link logístico futuro) + `traslado_items` (snapshot LPN/lote/vencimiento/estado/costo/series JSONB, `cantidad_recibida` NULL=sin confirmar). RLS por tenant.
- **Tab "Traslados" en Inventario** (`TrasladosPanel.tsx`): **despachar** — destino + líneas/LPN de la sucursal activa (series tildables, decimales según unidad, disponible neto de reservas, re-chequeo fresco contra carreras, guard de conteo wall-to-wall) → el stock sale del origen y queda EN TRÁNSITO (no está en ninguna sucursal) · **confirmar recepción** (gated a usuarios del destino o puedeVerTodas) — entra con el MISMO LPN/lote/series a la ubicación elegida; faltantes auditados (`recibido_parcial` + acción `faltante_traslado` en Historial); series no recibidas quedan inactivas (perdidas en tránsito) · **cancelar en tránsito** — reingreso completo al origen (reactiva/recrea la línea).
- **Ledger**: `movimientos_stock` tipo `'traslado'` en ambas puntas (el tipo estaba en el CHECK desde mig 055 pero solo se usaba para mover-LPN intra-sucursal) + badge "Traslado" en historial de Inventario + acciones `despacho_traslado/recepcion_traslado/faltante_traslado` en HistorialPage.
- **Lib pura** `src/lib/trasladoLogic.ts`: `puedeCrearTraslado`, `puedeConfirmarRecepcion`, `disponibleLinea`, `validarCantidadTraslado`, `validarRecepcion`, `estadoDesdeRecepcion`, `totalFaltante` — 22 tests.

**Próximo de la auditoría:** #5 cheques conectados al circuito de pago. **Pendiente de GO:** relevamiento Inventario/WMS offline.

## [2026-06-11] deploy | v1.52.0 PROD — Auditoría de procesos: quick wins 1+2+3 (caja/envíos/devoluciones) · `dev=main`

**GO pidió una auditoría de procesos** ("qué está mal y qué módulos no se conectan entre sí y deberían") y eligió implementar los 3 quick wins. PR **#182** merged, release **v1.52.0** `--latest`. **Sin migraciones.** Suites: unit **632/632** (+7) · e2e owner 68/68 · build verde.

**Auditoría (verificada contra código, no contra wiki).** Hallazgos críticos: (1) cobranza CC no impactaba caja — descuadre de arqueo garantizado, documentado en el propio código; (2) NO existe traslado de stock entre sucursales (el envío `traslado_interno` es solo logístico); (3) anular venta dejaba el envío vivo; (4) cheques son un cuaderno standalone (sin link a OC/gasto, rechazado no reactiva deuda); (5) envío en `devolucion` moría en el limbo sin reingreso de stock; (6) EFs huérfanas `birthday-notifications`/`process-aging` (nadie las invoca). Backlog completo en `project_pendientes.md` → "Auditoría de procesos 2026-06-11".

**Implementado en v1.52.0 (quick wins 1+2+3):**
- **Cobranza CC → caja**: `cobrarDeudaCCFIFO` ahora registra el movimiento en las 3 vías (ficha cliente / POS / Caja→Cobranzas). Efectivo → `ingreso` real al arqueo; otro método → `ingreso_informativo` con `[Método]` + cuenta de origen (POS). Resolución de sesión: explícita (POS) > caja propia del usuario > única abierta. Sin caja imputable y era efectivo → toast de warning (antes: descuadre silencioso). Lógica pura `movimientoCajaCobranza` en `cobranzaCC.ts` + `tests/unit/cobranzaCaja.test.ts` (7 tests).
- **Anular venta → cancela envíos**: en el branch `cancelada`, los envíos `pendiente` de la venta pasan a `cancelado` (+toast); los `despachado/en_camino/en_bodega` no se tocan pero se avisa.
- **Envío `devolucion` → CTA "Registrar devolución de la venta"** en Envíos: navega a `/ventas?id=X&devolver=1`; VentasPage extiende el patrón `?id=` existente y abre `abrirModalDevolucion` (respeta plazo del canal + clave maestra).

## [2026-06-11] deploy | v1.51.1 PROD — Testing e2e (suite reparada + gobernanza caja) + unit estable · `dev=main`

**Sesión de testing acordada con GO** ("arrancar con testing e2e, ir autónomo hasta PROD"). PR **#180** `dev→main` merged, release **v1.51.1** `--latest`. **Sin migraciones** (test-only, sin cambio de comportamiento). Vercel auto-deploy desde `main`. Suites: **unit 625/625 · e2e 129/129** (owner+cajero+supervisor+rrhh).

- **La suite e2e estaba podrida:** 11 smoke tests fallaban tras ~50 versiones de evolución de UI (selectores/rutas viejos). Reescritos contra la UI real de v1.51:
  - **01 dashboard** — tab "General" ya no existe → chips de área (Todo) + sub-tabs (Insights/Métricas); "Mi Plan" migró del sidebar al menú de avatar (Perfil → /mi-cuenta).
  - **02 inventario** — el CRUD de productos se movió a `/productos` (ProductoFormPage); SKU opcional (auto-gen). Buscador con timeout robusto.
  - **03 movimientos** — `/movimientos` quedó **huérfano** (redirige a `/inventario`); ahora testea el redirect + los tabs reales "Agregar stock"/"Quitar stock".
  - **05 caja** — U2: el cierre exige un **arqueo parcial previo** (gate); el test acepta tanto el modal de cierre como el gate.
  - **08 clientes** — **DNI y teléfono ahora obligatorios**; baja vía **soft-delete A6** (botón "Dar de baja" → modal).
  - **09 suscripción** — acceso a la cuenta vía menú de avatar (no hay link "Mi Plan" en el sidebar).
  - **14 coherencia** — el badge de alertas **capea en "9+"** → no comparar por igualdad cuando está capeado.
- **Tests e2e nuevos — gobernanza de caja** (plan `caja.plan.md`, escenarios "fuera de alcance unit"): **A2** apertura de caja a nombre de otro cajero ("Abrir caja para") + **traspaso entre cajas** (ISS-193, modal "Transferir a otra caja"). Defensivos: se omiten si la precondición de estado no está en el DEV compartido.
- **Unit suite — `vitest fileParallelism:false`:** correr los 43 archivos en paralelo levanta un jsdom por worker, agota la RAM (12 cores, ~5.6 GB libres) y mata **toda** la suite con un error genérico (`Cannot read properties of undefined (reading 'config')`) — falla aunque los tests estén bien. Capar `maxWorkers` a 4 NO alcanzó; secuencial = **625 verdes** estable (~90 s).
- **Wiki:** `testing.md` actualizado (era stale: decía 474 tests + nombres de spec viejos). Pendiente futuro de testing: e2e mutante real de traspaso/cierre end-to-end, cobertura POS de costo G4 por rol, usuarios DEPOSITO/CONTADOR.

## [2026-06-10] deploy | v1.51.0 PROD — RRHH diferidos (tardanza + fichado QR + portal) · `dev=main`

**v1.51.0 a PROD** (GO: "ahora a PROD"). PR **#179** `dev→main` merged, release v1.51.0 `--latest`, mig **204** en PROD (antes del merge), Vercel production deploy desde `main` (commit 672ef264). PROD v1.50.0 → **v1.51.0**. **No quedan diferidos de RRHH.** Suite **625**. Detalle de las 3 features en la entrada `update` de abajo.

## [2026-06-10] update | v1.51.0 — RRHH diferidos: tardanza + fichado QR + portal del empleado

**Cierre de los 3 pendientes diferidos de RRHH 2.0** (mientras GO responde el relevamiento de Inventario). Build + suite **625** verdes (+7 de `minutosTardeFacturables`). Mig **204** en DEV. GO eligió "RRHH diferidos y luego testing e2e".

- **Auto-descuento de tardanza:** `crearLiquidacion` ahora junta las fichadas de **entrada** del período (`rrhh_fichadas`), calcula los minutos de atraso vs `empleados.horario_entrada` (primera entrada de cada día, tolerancia por día) con `minutosTardeFacturables` y descuenta con `descuentoTardanza` según `tenants.rrhh_tardanza_modo` (registrar/proporcional/umbral) + `rrhh_horas_mes_base`. Item "Descuento por tardanza (N min)" antes del descuento de anticipos.
- **Fichado por QR público** (`/fichar/:token`, `FicharPage`): kiosco sin login. Mig 204: `tenants.fichado_token` + RPCs `get_fichado_info`/`fichar_qr` SECURITY DEFINER anon (auto-toggle entrada/salida según el último fichaje del día, origen 'qr'). Config en RRHH → Asistencia: generar/rotar QR + link + descargar PNG (owner-only).
- **Portal del empleado** (`/mi-portal`, `MiPortalPage`): el usuario vinculado a un legajo (`empleados.user_id`) ve **sus** recibos (con PDF), vacaciones (saldo + solicitudes) y documentos, según `tenants.rrhh_portal_capacidades`. Gateado por `rrhh_portal_empleado`; nav "Mi Portal" + allowed-lists de roles. Read-only (scoping client-side; el aislamiento server-side sigue siendo la deuda de RLS).

**Pendiente:** subir v1.51.0 a PROD (mig 204) + el siguiente ítem que pidió GO: **testing e2e** (planes `tests/specs/*.plan.md` → Playwright reales).

## [2026-06-10] deploy | v1.50.0 PROD — Caja tanda final + Courier (v1.49.0) · `dev=main`

**Los 2 releases que estaban en DEV pasaron a PROD** (GO: "pasemos todo a PRD para quedar = DEV"). PR **#178** `dev→main` merged, release **v1.50.0** `--latest`. PROD: v1.48.0 → **v1.50.0**. Mig **203** aplicada en PROD (antes del merge, aditiva). Edge Function `courier-api` deployada a PROD (con logging + `probar`). Vercel production deploy desde `main` (commit 2bee3326). Suite **618**.

- **v1.50.0 (Caja, mig 203):** E1 bóveda para roles custom · E3 arqueo manual de bóveda (`boveda_arqueos`) · L3 préstamo a empleado (RRHH → Anticipos, nota firmada) · M3 panel de cajero `/caja/panel` · M4 sonido al cobrar. **🎉 relevamiento Caja A-M COMPLETO en PROD.**
- **v1.49.0 (Courier, sin migración):** logging diagnóstico en `courier-api` + acción `probar`/botón "Probar credenciales".

**Pendiente (ops de GO):** cuenta B2B de courier (Andreani) para validar adapters end-to-end (= EN6 de Envíos).

## [2026-06-10] update | v1.50.0 (SOLO DEV) — Caja: tanda final (E1/E3/L3/M3/M4) · 🎉 relevamiento Caja A-M COMPLETO

**Reconciliación + cierre del relevamiento Caja.** GO reportó que tenía notas de que Caja estaba "entregado y en PROD" contra la nota stale del wiki que decía "Caja sin responder". **Verificado contra código: las notas de GO eran las correctas** — el relevamiento A-M (2026-05-25) ya estaba casi todo en PROD (migs 136-142, hito v1.10.0). El `caja_2026-05-25.md` y la lista de "pendientes" de `caja.md` quedaron congelados antes de migs 140-142 (stale). Se corrigió la nota errónea y se cerraron los pocos ítems chicos que faltaban. Build + suite **618** verdes (613 + 5 de `accedeABoveda`). Mig **203** en DEV. GO eligió dejarlo en DEV.

- **E1** — visibilidad de bóveda para **roles personalizados** (helper `accedeABoveda` en `cajaPermisos.ts`; `caja_fuerte_roles` acepta `custom:<id>`; editor en Config → Caja lista roles estándar + custom).
- **E3** — **arqueo manual de bóveda** (`boveda_arqueos`, RLS DUEÑO/ADMIN/SUPER_USUARIO): botón "Arquear bóveda" en tab Caja Fuerte + modal conteo por cuenta vs sistema + historial. La bóveda no se cierra.
- **L3** — **préstamo a empleado**: checkbox "Es préstamo" + adjuntar nota firmada en RRHH → Anticipos (`rrhh_anticipos.es_prestamo` + `documento_url`, bucket empleados). Egreso por Gastos (efectivo, G2/G3) + descuento del próximo sueldo (RH4).
- **M3** — **panel de cajero** `/caja/panel` (`PanelCajeroPage`, full-screen sin AppLayout): estado de caja + botones grandes Cobrar/Operar + acceso desde "Modo panel" en CajaPage.
- **M4** — **sonido al cobrar** (`src/lib/sonidoCobro.ts`, Web Audio, pref localStorage default ON, toggle en el panel). Suena al despachar venta en el POS.

**🎉 Relevamiento Caja A-M COMPLETO** (mayoría en PROD; estos 5 en DEV esperando deploy). **Pendiente subir a PROD:** mig 203 + estos cambios + v1.49.0 (courier) → PR `dev → main`.

## [2026-06-10] update | v1.49.0 (SOLO DEV) — Courier: logging diagnóstico + "Probar credenciales"

**Accionable del Punto 2 (Email+Couriers) sin necesidad de cuenta B2B.** GO eligió dejarlo **solo en DEV** por ahora (decisión 2026-06-10). Build + suite **613** verdes. Sin migración. `courier-api` deployada a DEV (`gcmhzdedrkmmzfzfveig`); `dev` adelantado 1 release respecto de `main` (PROD sigue en v1.48.0).

- **Logging diagnóstico en `courier-api`:** helper `courierFetch` en `types.ts` que loguea `método + URL + status + body recortado (600 chars)` ante error, aplicado a todos los fetches de Andreani/Correo; log inline en el `soapCall` de OCA (SOAP). Log de entrada en el router (`action`/`courier`/`tenant`) y catch con contexto. **Nunca** se loguean las credenciales. Visible en Supabase → Edge Function logs para debuggear la 1ª prueba real con cuenta B2B.
- **Acción `probar` + botón "Probar credenciales":** nueva `action: 'probar'` en el router + método `probar(cred)` por adapter — Andreani→`login` Basic, Correo→`getToken`, OCA→tarifa de muestra (valida CUIT+operativa; usr/psw se ejercen recién al generar). Cliente front `probarCredencialesCourier()`. Botón por courier en `CourierCredencialesPanel` (Config → Envíos) con resultado inline ✓/✗; testea las credenciales **guardadas** aunque el courier esté inactivo (para validar antes de activar) + guard de "guardá los cambios primero".
- **Pendiente subir a PROD:** deploy `courier-api` a `jjffnbrdjchquexdfgwq` + PR `dev → main` + release v1.49.0 cuando GO lo decida.

## [2026-06-09] deploy | v1.48.0 PROD — RRHH RH7+RH8 · 🎉 RRHH 2.0 (RH1-RH8) COMPLETO

**Cierre del módulo RRHH 2.0** (migs 201-202 en DEV+PROD, PR #177, release v1.48.0 latest). Build verde, suite **613** (596 + 17). GO pidió RH7+RH8 seguidas y autónomas hasta PROD.

- **RH7 (mig 201):** **catálogo de documentos obligatorios** (E1, `rrhh_documentos_catalogo`) + alerta de **faltantes** y **próximos a vencer** (E2, `rrhh_documentos.fecha_vencimiento` + umbral `rrhh_doc_alerta_dias`) · **capacitación obligatoria** por puesto (E3) · **evaluación de desempeño** 1-10 + 360° (F4, `rrhh_evaluaciones`, panel en Reportes) · config **portal del empleado** (F2) + **notificaciones del ciclo** (F3). E4 (costo capacitación) = NO. Lib `rrhhDocumentos.ts`.
- **RH8 (mig 202):** nuevo **tab Reportes** (`RrhhReportesPanel`): costo laboral por depto · asistencia consolidada · vacaciones gozadas/pendientes · antigüedad/rotación · recibos + export Excel/CSV/PDF · **liquidación final** al egreso (A2-c, `liquidacionFinal.ts`): indemnización LCT 245 + SAC proporcional + vacaciones no gozadas, **editable**, genera gasto + `rrhh_liquidaciones_finales`. Libs `rrhhReportes.ts` + `liquidacionFinal.ts`.

**🎉 RRHH 2.0 (RH1-RH8) COMPLETO en PROD.** Diferidos (mejoras futuras): fichado por **QR público** + **auto-descuento de tardanza** en nómina (RH6; lib `descuentoTardanza` lista) y la **UI completa del portal del empleado** (F2; flag ya configurable). Confirmado por GO: fórmula de indemnización LCT 245 editable.

## [2026-06-09] deploy | v1.47.0 PROD — RRHH RH4+RH5 (frecuencia/anticipos + vacaciones 2.0)

**2 fases más de RRHH a PROD** (migs 199-200 en DEV+PROD, PR #176, release v1.47.0 latest). Build verde, suite **596** (578 + 18). GO pidió RH4+RH5 seguidas y autónomas hasta PROD.

- **RH4 — Frecuencia + anticipos (mig 199):** `empleados.frecuencia_liquidacion` (+`frecuencia_dias`) **prorratea el básico** al generar la liquidación (mensual=1 / quincenal=½ / semanal=¼ / personalizado=días/30, lib `rrhhLiquidacion.ts`) · **anticipos** (`rrhh_anticipos`, panel en Nómina): registra + opcional genera gasto "Adelantos al personal" (pendiente) y **se descuentan automáticamente en la próxima liquidación** sin dejar el neto negativo (descuento parcial deja el resto pendiente).
- **RH5 — Vacaciones 2.0 (mig 200):** **días por antigüedad LCT** 14/21/28/35 (botón "Sugerir LCT" + override) · aprobación con **alerta de plazo de aviso** (sin/alerta/bloquea) + **solapamiento** con otras vacaciones aprobadas · **remanente auto-calculado** con límite configurable · panel de config en el tab (aviso + remanente máx). Vacaciones se pagan dentro del sueldo (C7). Lib `rrhhVacaciones.ts`.

**Pendientes RRHH:** **RH7** (documentos obligatorios/portal del empleado/evaluación de desempeño), **RH8** (reportes + liquidación final con indemnización) + (en RH6) fichado por QR público y auto-descuento de tardanza. Detalle en `relevamiento_rrhh_respuestas.md` + `project_pendientes.md`.

## [2026-06-09] deploy | v1.46.0 PROD — RRHH RH1+RH2+RH3+RH6 (empleados 2.0, aportes/SAC, nómina contable, asistencia 2.0)

**4 fases de RRHH deployadas a PROD** (migs 195-198 en DEV+PROD, PR #175, release v1.46.0 latest, Vercel production). Build verde, suite **578** (558 + 20). GO confirmó las 4 asunciones del plan y pidió RH1+RH2+RH3+RH6 seguidas y autónomas hasta PROD. El módulo RRHH ya era maduro (13 tablas, RrhhPage ~3700 líneas); estas fases lo potencian.

- **RH1 — Empleados 2.0 (mig 195):** obligatorios en el alta (email/tel/puesto/depto) · **motivo de egreso** (modal de baja) + reactivar · **tipo de contrato configurable** (tabla `rrhh_tipos_contrato` + seed base AR, se eliminó la CHECK rígida; `es_relacion_dependencia` dispara aportes) · datos bancarios (CBU/alias/banco/tipo cuenta/titular).
- **RH2 — Aportes AR + SAC (mig 196):** `rrhh_conceptos` += tipo_calculo/default_pct/es_aporte + seed AR (Jubilación 11%/OS 3%/Ley 19.032 3%/etc.) · **aportes configurables por empleado vía checkbox** (`empleados.config_aportes`; el % vive en el concepto/Config; "en negro" = sin checkboxes) + **beneficios extra** ($/%) · `crearLiquidacion` inyecta básico+beneficios+aportes (lib pura `rrhhNomina.ts`) · **SAC = 50% del mejor sueldo del semestre** (botones SAC 1°/2° sem). +11 tests.
- **RH3 — Nómina contable (mig 197):** **"Generar gasto"** por salario → inserta gasto en módulo **Gastos** (categoría Sueldos, estado pendiente, link `rrhh_salarios.gasto_id`) · **"Cargas sociales → Gastos"** acumula aportes del período por concepto (categoría Cargas sociales) · **recibo de sueldo PDF** (`reciboSueldoPDF.ts`) + **comprobante firmado** opcional · **doble validación** configurable (RRHH prepara → DUEÑO/ADMIN o SUPERVISOR firma; toggle owner-only). Categorías Sueldos/Cargas sociales seedeadas idempotentes.
- **RH6 — Asistencia 2.0 (mig 198):** **fichado** clock-in/out (`rrhh_fichadas`, origen manual/celular/qr) · **horario por empleado** · **licencias subdivididas** (`tipo_licencia` + catálogo) + comprobante · **horas extra** (`rrhh_horas_extra`, multiplicador 50/100 + aprobación, panel con monto) · **feriados con regla de pago** (simple/doble/triple). Lib pura `rrhhAsistencia.ts` (+9 tests).

**Diferido (backlog RRHH):** **RH4** (frecuencia/anticipos), **RH5** (vacaciones 2.0), **RH7** (documentos/portal/evaluación), **RH8** (reportes + liquidación final), y dentro de RH6 el **fichado por QR público** + el **auto-descuento de tardanza** inyectado en nómina (la lib `descuentoTardanza` ya existe, falta el sweep). Detalle en `relevamiento_rrhh_respuestas.md` + `project_pendientes.md`.

## [2026-06-09] deploy | v1.45.0 PROD — Envíos EN7 (envío propio + recursos + reportes/alertas) — Envíos cerrado salvo EN6

**EN7 deployado a PROD** (mig 194 aplicada en DEV+PROD, PR #174 dev→main merged, release v1.45.0 latest, Vercel production deploy desde `main`). Build verde, suite **558** = 541 + 17. **Cierra el módulo Envíos salvo EN6** (integraciones courier, bloqueado por cuentas B2B reales que GO aún no tiene).

- **G2 — Envío propio + vehículo + combustible:** el modal de envío propio permite asociar un **vehículo** (recurso categoría Vehículo) + KM del viaje. Desde el detalle del envío, "**Registrar combustible**" genera un **gasto "Combustible"** (IVA crédito fiscal, link `envios.gasto_combustible_id`), **suma los KM al vehículo** (`recursos.km_acumulado`) y estima el monto con `consumo_litros_100km × precio del litro` (`tenants.envio_combustible_precio_litro`, editable). El consumo se carga por vehículo en Recursos. Lib pura `enviosRecurso.ts`.
- **H1 — Reportes (nuevo tab Reportes, `EnviosReportesPanel`):** pendientes/atrasados · cumplimiento por courier (tiempo medio + % entregados) · pagos a courier por mes · **margen logístico** (ingreso `ventas.costo_envio` − costo real, cuenta subsidiados) · distribución por zona/CP · productividad de repartidores (reusa `productividadRepartidor` de EN3). Lib pura `enviosReportes.ts`.
- **H2 — Alertas (sección del tab Reportes):** sin despachar +Nh · POD pendiente +Nd · pago courier pendiente +Nd · diferencia cotizado vs real ≥N%. Umbrales configurables (`tenants.envio_alerta_*`).
- **H3 — Export + etiquetas:** Excel/CSV/PDF en cada reporte (patrón `ComprasReportesPanel`) + **etiquetas A4** 4/6/12 por hoja con QR (link `/transporte/:token`) + datos del destinatario (`etiquetasEnvioPDF.ts`, botón en tab Reparto) + hoja de ruta PDF (ya existía en EN3).
- **Config → Envíos:** card "Envío propio y alertas" (precio litro + 4 umbrales). **Recursos:** campo "Consumo (L/100km)" en vehículos.
- **Mig 194** (aditiva): `envios.recurso_id/km_recorridos/gasto_combustible_id`, `recursos.km_acumulado/consumo_litros_100km`, `tenants.envio_combustible_precio_litro` + 4 umbrales de alerta, seed idempotente de categoría "Combustible".

**Único pendiente del módulo Envíos:** **EN6** (integraciones courier: tracking + cotización comparativa + etiquetas térmicas) — bloqueado hasta tener cuentas B2B reales de courier (Andreani 1ro) para validar los adapters de `courier-api`.

## [2026-06-09] update | Email saliente (Resend) RESUELTO — era API key vieja en el secret

**El correo saliente quedó funcionando.** GO confirmó que le llegaron mails de Genesis. Causa real: el secret `RESEND_API_KEY` en Supabase era una **API key vieja/revocada** → Resend devolvía 401 "API key is invalid" (afectaba TODO el correo: ticket de venta, OC, etc.). NO era un problema de dominio (`genesis360.pro` estaba verificado DKIM/SPF) ni de código (FROM=noreply@genesis360.pro correcto en DEV v21 / PROD v24). GO regeneró la key en Resend y actualizó el secret → resuelto.

Fix de diagnóstico que quedó en el código (v1.42.0/v1.44.0): `enviarOCEmail` (Proveedores → OC) y el envío de **ticket de venta** (VentasPage) ahora leen `error.context.json()` y muestran el **mensaje real de Resend** en vez del genérico "No se pudo enviar". **Aprendizaje:** ante `send-email` non-2xx, revisar primero la validez del `RESEND_API_KEY`. Wiki `resend-email.md` actualizada (estaba desfasada: decía FROM=onboarding@resend.dev).

---

## [2026-06-09] cierre-sesión | Envíos EN1-EN5 en PROD (v1.40.0→v1.44.0) · falta EN6 (bloqueado B2B) + EN7

**Sesión larga. Relevamiento Envíos EN1-EN5 deployado a PROD, una fase por release. Suite 541 verde. `dev=main`.** Resumen de lo hecho hoy:

1. **EN1 (v1.40.0, mig 189)** — pagos courier contables: gasto auto (Transporte y fletes, IVA crédito) + egreso caja + tab "Facturas Courier" (conciliación) + doble firma.
2. **EN2 (v1.41.0, mig 190)** — POD robusto: campos requeridos config, firma canvas, DNI, OTP sobre umbral (propio), geoloc con fallback, sub-estados no-entrega + reintento.
3. **EN3 (v1.42.0, mig 191)** — reparto: repartidores + productividad, tab Reparto (hoja de ruta PDF + link agrupado `/hoja-ruta/:token` + cumplimiento), token expiración config, transportista llamar/WA/incidencia, identidad config, notif "en camino".
4. **EN4 (v1.43.0, mig 192)** — costos/tarifas: factor KM, costo mínimo/tramos, recargo horario, cobro al cliente (100/margen/subsidio), envío gratis condicional, diferencia real vs cotizado (B6).
5. **EN5 (v1.44.0, mig 193)** — creación/alcance: DEPOSITO crea, envíos libres, sugerencia courier por CP, plazo despacho por canal + alerta, múltiples envíos por venta con `envio_items`.

**Libs puras nuevas:** `enviosCourierPago`, `enviosPod`, `enviosReparto`, `enviosTarifas`, `enviosCreacion` (todas con tests). Componentes nuevos: `SignaturePad`, `RepartidoresPanel`, `HojaRutaPage`. Migraciones 189-193.

**Pendiente Envíos:** **EN6** (integraciones courier: tracking/cotización comparativa/etiquetas) **bloqueado** hasta validar adapters de `courier-api` con cuentas B2B reales (ver Email+Couriers). **EN7** (envío propio + recursos + reportes/alertas/export). Quedan también RRHH/Caja sin relevar.

**⚠ Email saliente (Resend) — acción pendiente de GO:** el `RESEND_API_KEY` cargado en Supabase (DEV+PROD) está **inválido** (Resend 401 "API key is invalid"); el dominio `genesis360.pro` SÍ está verificado. Claude NO tocó el secret. GO debe generar una API key nueva en Resend (Sending access) y cargarla como secret en ambos proyectos. El front ya muestra el error real de Resend (OC + ticket).

---

## [2026-06-09] update | Envíos EN5 — creación y alcance (v1.44.0, mig 193, PROD ✅)

**Quinta fase de Envíos en PROD.** Build + 541 tests verdes. Mig 193 (aditiva) DEV+PROD. PR #173, release `v1.44.0`, `dev=main`.

- **A1** DEPOSITO ve y crea envíos (`AppLayout`: `/envios` con `depositoVisible` + agregado a `DEPOSITO_ALLOWED`).
- **A2** Envíos **libres sin venta**: `envios.tipo` (venta/traslado_interno/muestra/dev_proveedor/otro) + `motivo` + `sucursal_destino_id` (traslado interno). Select de tipo en el modal; badge de tipo en la lista.
- **A3** Sugerencia de courier por CP: `tenants.cp_courier_preferido` (rangos desde-hasta → courier); al elegir domicilio con CP propone el courier (`sugerirCourierPorCp`, override permitido). Config → Envíos editor de reglas.
- **A4** Plazo de despacho por canal: `tenants.envio_plazo_despacho` {presencial/online/mayorista} en horas; badge **"Atrasado"** en la lista (`plazoDespachoVencido` + `clasificarCanal`). Config → Envíos.
- **A5** Múltiples envíos por venta con **desglose** (`envio_items`): al seleccionar la venta se cargan los ítems con cantidad restante (descuenta lo ya despachado en envíos previos); editor de qué sale en este envío; se relajó la exclusión de ventas con envío (badge "N envíos" en el selector). Persiste en `envio_items` al crear.
- **Lib pura** `src/lib/enviosCreacion.ts` (`TIPOS_ENVIO`, `sugerirCourierPorCp`, `clasificarCanal`, `plazoDespachoVencido`, `unidadesEnviadas`) + 12 tests.

---

## [2026-06-08] update | Envíos EN4 — costos y tarifas avanzados (v1.43.0, mig 192, PROD ✅)

**Cuarta fase de Envíos en PROD.** Build + 529 tests verdes. Mig 192 (aditiva) en DEV y PROD. PR #172, release `v1.43.0`, `dev=main`.

- **Motor de tarifas puro** `src/lib/enviosTarifas.ts`: `costoEnvioPropio` (B1 recargo franja horaria + B2 factor KM + B3 costo mínimo/tramos escalonados), `cobroCliente` (B4 cliente_100/cliente_margen/subsidio), `envioGratis` (B5 monto/etiqueta/promo), `diferenciaReal` (B6 a_favor/perdida).
- **Config → Envíos** card "Tarifas y cobro del envío propio": factor KM, costo mínimo, editor de tramos, editor de recargo horario, política de cobro (+margen/umbral), envío gratis condicional (monto/etiquetas/promo). Campos en `tenants`: `envio_factor_km`, `envio_costo_minimo`, `envio_tramos`, `envio_recargo_horario`, `envio_cobro_politica`, `envio_cobro_margen_pct`, `envio_subsidio_umbral`, `envio_gratis_reglas`.
- **Aplicación:** el cálculo de KM del envío propio (EnviosPage `calcularKmAuto`) ahora usa `costoEnvioPropio` (factor + mínimo + tramos + recargo horario según la hora acordada).
- **B6:** modal "Registrar costo real" en cada envío con costo cotizado → calcula la diferencia a-favor/pérdida + motivo (catálogo `DIFERENCIA_MOTIVOS`), persiste `envios.costo_real/diferencia_tipo/diferencia_monto/diferencia_motivo`. El precio que pagó el cliente (`costo_cotizado`) NO se toca. +15 tests. **Próximo: EN5 (creación/alcance).**

---

## [2026-06-08] update | Envíos EN3 — reparto: repartidores + hoja de ruta + transportista (v1.42.0, mig 191, PROD ✅)

**Tercera fase de Envíos en PROD.** Build + 514 tests verdes. Mig 191 (aditiva) en DEV y PROD. PR #171, release `v1.42.0`, `dev=main`.

- **G1 repartidores:** tabla `repartidores` (vinculables a `empleados` RRHH) + `envios.repartidor_id`. CRUD en Config → Envíos (`RepartidoresPanel`), asignación en el modal de envío (envío propio), productividad (`productividadRepartidor`).
- **G3/E3 hoja de ruta:** nuevo tab **Reparto** en EnviosPage. Elegís fecha + repartidor → lista ordenada (`ordenarHojaRuta`: vecino más cercano si hay coords y modo proximidad, si no por zona/hora) → **PDF** (jsPDF/autotable) + **link agrupado para el chofer** (`crearHojaRutaToken` → `/hoja-ruta/:token`, página pública `HojaRutaPage` con RPC `get_hoja_ruta_by_token`) + **cumplimiento del día** (`cumplimientoDia`). Tablas `hojas_ruta` + `hoja_ruta_envios`.
- **E1 expiración token:** `tenants.envio_token_politica` (al_entregar/dias) + `envio_token_dias`; al compartir se setea `envios.token_expira_at` (`tokenExpiraAt`); `get_envio_by_token` devuelve null si expiró.
- **E2 transportista:** botones **Llamar** (`tel:`) + **WhatsApp** al cliente + **reportar incidencia** (catálogo `INCIDENCIA_TIPOS` → `envio_incidencias` vía RPC `reportar_incidencia_envio`).
- **E4 identidad:** `tenants.envio_identidad_modo` (anonimo/nombre_dni); en modo nombre_dni la página del chofer pide nombre+DNI antes de operar.
- **E5 notif "en camino":** `tenants.envio_notif_en_camino` (no/wa/wa_tracking); al pasar a en_camino se abre WhatsApp al cliente (con link de tracking si wa_tracking).
- **Lib pura** `src/lib/enviosReparto.ts` (`productividadRepartidor`, `cumplimientoDia`, `ordenarHojaRuta`, `tokenExpiraAt` + constantes) + 8 tests. RPCs públicas SECURITY DEFINER (anon+auth). **Próximo: EN4 (costos/tarifas).**

**Email saliente (Resend) — diagnóstico actualizado con GO:** el dominio `genesis360.pro` **SÍ está verificado** (DKIM/SPF OK, captura de GO). El error real es **"API key is invalid"** (Resend 401) → el secret `RESEND_API_KEY` en Supabase está inválido/desactualizado. Claude NO tocó el secret. Acción de GO: generar API key nueva en Resend y cargarla como secret en ambos proyectos (DEV+PROD). Front mejorado: `enviarOCEmail` (OC) y el envío de ticket de venta ahora muestran el mensaje real de Resend.

---

## [2026-06-08] update | Envíos EN2 — POD robusto + cierre de entrega (v1.41.0, mig 190, PROD ✅)

**Segunda fase de Envíos en PROD.** Build + 506 tests verdes. Mig 190 (aditiva) en DEV y PROD. PR #170, release `v1.41.0`, `dev=main`.

- **D1** campos del POD requeridos configurables por tenant (`tenants.pod_campos_requeridos` JSONB: fecha/receptor/foto/firma/dni). **D2** mínimo de fotos (`pod_foto_min`). Validación con `podFaltantes`.
- **D3** firma del receptor con **canvas** (nuevo `src/components/SignaturePad.tsx`, sin deps → dataURL PNG a `etiquetas-envios`, `envios.pod_firma_url`) + **DNI** (`pod_dni`) + **OTP** sobre umbral solo envío propio (`tenants.pod_otp_umbral`, tabla `envio_otp`). Flujo OTP: el transportista genera el código (`generar_otp_envio`), se lo manda al cliente por WhatsApp (`buildWhatsAppUrl`), el cliente se lo dicta y se verifica (`verificar_otp_envio`); sin OTP verificado no se puede marcar entregado (gate en el RPC). Default off (umbral 0).
- **D4** geoloc del celular al entregar con **fallback graceful** (`navigator.geolocation`; `pod_lat/lon` + `pod_geo_estado` ok/no_disponible). Si el permiso falla o no hay señal, registra `no_disponible` y **no frena** la entrega (pedido GO).
- **D5** sub-estados de no-entrega (`subestado_no_entrega`: ausente/rechazado/direccion_incorrecta + `no_entrega_motivo`), botón "No entregado" en EnviosPage y TransportistePage. **D6** reintento: ausente vuelve a `en_camino` con `intentos++` hasta `envio_reintentos_max`; rechazado/dirección o agotado → `devolucion`. Recargo configurable (`envio_reintento_recargo`). Lógica en `resolverNoEntrega` + el RPC `update_envio_by_token`.
- **RPCs del transportista ampliadas** (`get_envio_by_token` devuelve config POD + `es_propio`; `update_envio_by_token` toma firma/DNI/geoloc/sub-estado; nuevas `generar_otp_envio`/`verificar_otp_envio`), todas SECURITY DEFINER con GRANT a anon+authenticated.
- **Config → Envíos**: card "Prueba de entrega (POD)" con los toggles de requeridos + mín fotos + OTP + geoloc alerta + reintentos + recargo. `PodFotosManager` ahora expone `onCountChange` (validación D2).
- **Lib pura** `src/lib/enviosPod.ts` (`podFaltantes`, `requiereOtp`, `geoEstado`, `resolverNoEntrega`, `recargoReintento`, `haversineKm`, `generarCodigoOtp`) + `tests/unit/enviosPod.test.ts` (18 tests). **Próximo: EN3 (reparto).**

**Bug de email de OC (DEV) — diagnóstico:** GO reportó "No se pudo enviar el email" al mandar una OC a un gmail. Causa: **Resend rechaza** (logs DEV `send-email → 500`). El código está OK (FROM=noreply@genesis360.pro en DEV v21 y PROD v24); falta verificar el dominio `genesis360.pro` en la cuenta de Resend del `RESEND_API_KEY` de DEV (en testing solo envía al email del dueño). Se mejoró `enviarOCEmail` para **mostrar el mensaje real de Resend** (lee `error.context.json`). Acción pendiente de GO: verificar dominio en Resend + confirmar que la API key es de esa cuenta.

---

## [2026-06-08] update | Envíos EN1 — pagos a courier contables + conciliación (v1.40.0, mig 189, PROD ✅)

**Primera fase del relevamiento de Envíos deployada a PROD.** Build + 488 tests verdes. Mig 189 (aditiva) en DEV y PROD. PR #169, release `v1.40.0`, `dev=main`.

- **C2 — gasto automático:** al marcar pagado un courier **tercero** en el tab "Pagos Courier", se genera un gasto contable (categoría **Transporte y fletes**, proveedor=courier, **IVA crédito fiscal** desglosado del bruto vía `desgloseIvaFlete`) + **egreso de caja** si el medio es efectivo (`egreso`/`egreso_informativo`). Se linkea `envios.gasto_id`. Un gasto por courier (`agruparPagosPorCourier` agrupa la selección).
- **C3 — Facturas Courier** (nuevo tab): cargar la factura/resumen del courier por período (courier + nº + período + total + archivo opcional a `etiquetas-envios`) → el sistema busca los envíos del courier en el período, suma lo registrado y calcula la diferencia (`diffFactura`). Persiste `courier_facturas` + `courier_factura_lineas` (una línea por envío). Badge "Conciliada" / "Dif. $X". Estado conciliada si |dif| < 1.
- **C4 — doble firma:** `tenants.envio_pago_doble_firma_umbral` (0 = sin); pagos sobre el umbral piden clave maestra del dueño (`verificar_clave_maestra`, `requiereDobleFirma`).
- **C1:** pago individual o múltiple (sin cambios).
- **Config → Envíos:** card "Pagos a courier (contabilidad)" — toggle generar gasto + alícuota IVA flete (default 21%) + umbral doble firma.
- **Lib pura** `src/lib/enviosCourierPago.ts` (`agruparPagosPorCourier`, `desgloseIvaFlete`, `requiereDobleFirma`, `diffFactura`, `totalRegistrado`) + `tests/unit/enviosCourierPago.test.ts` (14 tests).

**Recomendación contable aplicada:** el gasto se genera SOLO para courier tercero (envío propio va por combustible, EN7); el costo se toma bruto (IVA incluido) y se desglosa el crédito fiscal. **Próximo: EN2 (POD robusto).**

---

## [2026-06-06] cierre-sesión | Resumen para retomar tras /clear (estado: PROD v1.39.0, mig 188)

**Sesión larga. Compras 2.0 completo en PROD. Suite 474 tests verdes.** ⚠ Al cierre, `dev` quedó **adelante de `main`** por: docs del wiki + cambios de email (FROM + email OC HTML/PDF — la Edge Function ya está en PROD, falta el front, que viaja en el próximo merge). Tres bloques:

1. **🎉 Compras 2.0 (CO1-CO8) CERRADO al 100% en PROD.** Esta sesión se hicieron CO5→CO8 (antes ya estaban CO1-CO4): CO5 pago anticipo/contra-entrega/schedule (v1.35.0, mig 186) · CO6 cheques diferidos (v1.36.0, mig 187) · CO7a OC inteligente: enviar OC PDF/email/WhatsApp + auto-draft desde stock bajo (v1.37.0) · CO7b servicios recurrentes/genéricos/comparar presupuestos (v1.38.0, mig 188) · CO8 reportes/alertas/export/calificación proveedor (v1.39.0). Libs nuevas: `comprasPago`, `comprasCheques`, `ocPDF`, `serviciosRecurrentes`, `comprasReportes` (+62 tests). Detalle en entradas de abajo + `project_compras_backlog` (memoria).

2. **Email saliente ✅ RESUELTO + couriers pendiente** (sección "Email + Couriers" en `project_pendientes.md` + memoria `project_email_courier_pendientes`):
   - **Email saliente ✅:** el dominio `genesis360.pro` ya estaba verificado en Resend → se cambió `FROM` a `noreply@genesis360.pro` **y** se mejoró el **email de OC** (template `type:'oc'` HTML + **PDF adjunto** vía Resend `attachments`). `send-email` redeployada **DEV v21 / PROD v24** (`verify_jwt` ok). Todo el correo saliente usa el dominio propio. Patrón `attachments` reutilizable para factura/estado de cuenta. ⚠ El cambio de **frontend** (`enviarOCEmail`) está en `dev`; llega a PROD con el próximo merge a `main` (la función ya está en PROD y es backward-compatible).
   - **Couriers:** adapters Andreani/Correo/OCA completos pero **sin validar con cuentas B2B reales**. Plan: GO consigue cuenta (Andreani 1ro) → validar end-to-end; Claude puede dejar logging diagnóstico + botón "Probar credenciales" sin esperar credenciales.

3. **Relevamiento Envíos respondido por GO (A-I)** → `relevamiento_envios_respuestas.md` con respuestas + diseño + modelo de datos + **recomendación contable/IVA** + plan **EN1-EN7**. **Pendiente de implementar.** Top 3: EN1 (pagos courier contables) → EN2 (POD robusto: firma/DNI/OTP/geoloc/sub-estados/reintento) → EN3 (reparto: repartidores/hoja de ruta/notif "en camino"). EN6 (integraciones courier) depende de validar adapters B2B. Pendiente confirmar: alícuota IVA flete, plazos por canal, canal del OTP.

**Próximo paso sugerido al retomar:** empezar **Envíos EN1** (pagos courier contables, cierra gap contable) — es el Top 1 del relevamiento. Pendiente menor: si `dev` sigue adelante de `main`, el próximo deploy (PR dev→main + Vercel) lleva el front del email de OC a PROD. Couriers EN6 espera cuenta B2B. Relevamientos sin responder: **RRHH / Caja**.

---

## [2026-06-06] update | Compras CO8 — reportes + alertas + export + calificación (v1.39.0, PROD ✅) · 🎉 Compras 2.0 COMPLETO

**Deployada a PROD la fase CO8** (G1/G2/G3/E4) — última del plan Compras 2.0. Sin migración. Build + 474 tests verdes. PR #168, release `v1.39.0`, `dev=main`.

- **G1 — reportes:** nuevo tab **Reportes** en Gastos (`src/components/ComprasReportesPanel.tsx`): compras por proveedor (volumen $ + # OCs + % cumplimiento), top productos comprados, **aging** de pagos pendientes (0-30/31-60/61-90/+90), OCs vencidas (entrega esperada pasada sin recibir), evolución de costos por producto (primer vs último precio + variación %).
- **E4 — calificación de proveedor:** score A/B/C según % de OCs recibidas completas (`calificarProveedor`).
- **G3 — export:** Excel (xlsx) / CSV / PDF (jsPDF+autotable) por reporte. PDF de OC ya estaba en CO7a.
- **G2 — alerta:** "bajo mínimo sin OC pendiente" en Alertas (badge *OC en camino* / *Sin OC pendiente* cruzando productos bajo mínimo con ítems de OCs abiertas). Las demás alertas de compras (anticipo sin recepción, cheque próximo a cobrar, costo subió X%) ya existían (CO3/CO5/CO6).
- **Lib pura** `src/lib/comprasReportes.ts` (`comprasPorProveedor`, `topProductosComprados`, `agingPagos`, `ocsVencidas`, `evolucionCostos`, `calificarProveedor`) + `tests/unit/comprasReportes.test.ts` (10 tests).

**🎉 Compras 2.0 (CO1-CO8) CERRADO al 100% en PROD:** CO1 gobierno OC · CO2 recepción robusta · CO3 costos · CO4 devolución a proveedor · CO5 pago anticipo/schedule · CO6 cheques diferidos · CO7a OC inteligente (enviar OC + auto-draft) · CO7b servicios (recurrentes/genéricos/comparar) · CO8 reportes/alertas/export/calificación. Sin pendientes del módulo.

---

## [2026-06-06] update | Compras CO7b — servicios: recurrentes + catálogo genérico + comparar presupuestos (v1.38.0, mig 188, PROD ✅)

**Deployada a PROD la fase CO7b** (F1+F2+F3). Build + 464 tests verdes. Mig 188 en DEV y PROD. PR #167, release `v1.38.0`, `dev=main`.

- **F1 — servicios recurrentes:** `servicio_items` += `recurrente`/`frecuencia`/`proximo_vencimiento`/`activo`. En el tab Servicios, checkbox recurrente en el form + badge en el listado + **banner de recurrentes vencidos** con "Generar gasto" (`generarGastoServicio`: inserta en `gastos` categoría Servicios y avanza `proximo_vencimiento` con `proximoVencimiento`). Sweep lazy = al abrir el módulo.
- **F2 — catálogo genérico:** `servicio_items.proveedor_id` ahora nullable → panel **"Servicios generales del negocio"** (toggle) para servicios del tenant sin proveedor, con su propio alta/edición.
- **F3 — comparar presupuestos:** modal **"Comparar presupuestos"** que trae todos los `servicio_presupuestos` del tenant, los agrupa por concepto normalizado (`compararPresupuestos`) y marca el **más barato** lado a lado.
- **Lib pura** `src/lib/serviciosRecurrentes.ts` (`proximoVencimiento`, `servicioVencido`, `periodosVencidos`, `normalizarNombre`, `compararPresupuestos`) + `tests/unit/serviciosRecurrentes.test.ts` (11 tests).

**Próximo (CO8 — última fase de Compras):** G1 reportes (OCs vencidas, compras por proveedor, top productos, aging de pagos, evolución de costos) · G2 alertas · G3 export Excel/PDF/CSV + PDF OC · E4 calificación de proveedor.

---

## [2026-06-06] update | Compras CO7a — OC inteligente: enviar OC + auto-draft stock bajo (v1.37.0, PROD ✅)

**Deployada a PROD la fase CO7a de Compras** (A6 + A3). Sin migración. Suite 453 verde. PR #166, release `v1.37.0`, `dev=main`.

- **A6 — enviar OC al proveedor:** lib pura `src/lib/ocPDF.ts` (`generarOCPDF` jsPDF/autotable, `textoOC`, `waLinkOC`, `totalOC`/`subtotalItems`). En el detalle de OC (ProveedoresPage): botones **PDF** (descarga), **Email** (`send-email` type notificacion con el resumen de la OC) y **WhatsApp** (link `wa.me` con plantilla). La query de OC ahora trae `proveedores(email, telefono, cuit, plazo_pago_dias)` + `sucursales(nombre)`. +6 tests.
- **A3 — auto-draft desde stock bajo:** en AlertasPage, botón **"Generar OC sugerida"** en la sección Stock bajo mínimo: consolida los productos bajo mínimo por proveedor (vía `proveedor_productos`), calcula la cantidad faltante sugerida (`max(minimo-actual, cantidad_minima, 1)`) y crea **OCs borrador** (una por proveedor), navega a Proveedores → OC. Gateado por `capacidadCrearOC`; exige sucursal específica; reporta productos sin proveedor.

**Próximo (CO7b + CO8):** CO7b servicios (F1 recurrentes sweep lazy + F2 catálogo genérico del tenant + F3 comparar presupuestos) · CO8 reportes (G1) + alertas (G2) + export + PDF OC (G3) + calificación de proveedor (E4).

---

## [2026-06-06] update | Compras CO6 — cheques diferidos (v1.36.0, mig 187, PROD ✅)

**Implementada y deployada a PROD la fase CO6 de Compras** (D4). Build + 447 tests verdes. Mig 187 en DEV y PROD. PR #165 mergeado, release `v1.36.0`, `dev=main`.

- **Tabla `cheques`** (RLS por tenant + trigger correlativo `set_cheque_numero`): `tipo` propio/tercero, `nro_cheque`, `banco`, `monto`, `fecha_emision`, `fecha_cobro` (diferida), `estado` (en_cartera/entregado/depositado/cobrado/endosado/rechazado/anulado), `proveedor_id`, `endosado_a_proveedor_id`, `cliente_origen`, `oc_id`, `sucursal_id`.
- **Nuevo tab "Cheques" en Gastos** (`src/components/ChequesPanel.tsx`): registro/edición, transiciones de estado guiadas por tipo (`estadosSiguientes`), **endoso** de cheque de tercero a un proveedor, filtros (tipo/estado), total pendiente y **alerta de próximos a cobrar** (badge en el tab + resaltado de vencidos). Config → Gastos: `cheques_alerta_dias` (default 7).
- **Lib pura** `src/lib/comprasCheques.ts` (estados/transiciones, `chequeProximoACobrar`, `chequeVencido`, `puedeEndosar`, `validarChequeAlta`, `totalPendiente`) + `tests/unit/comprasCheques.test.ts` (19 tests). `EntidadLog` += `'cheque'`.

**Próximo (CO7-CO8):** CO7 enviar OC email/WA (A6) + auto-draft desde stock bajo (A3) + servicios recurrentes (F1) + catálogo (F2) + comparar presupuestos (F3) · CO8 reportes (G1) + alertas (G2) + export Excel/PDF/CSV + PDF OC (G3) + calificación de proveedor (E4).

---

## [2026-06-06] update | Compras CO5 — pago anticipo/contra-entrega + schedule (v1.35.0, mig 186, PROD ✅)

**Implementada y deployada a PROD la fase CO5 de Compras** (D1/D2/D3). Build + 428 tests verdes. Mig 186 aplicada en DEV y PROD (aditiva). PR #164 mergeado a `main`, release `v1.35.0` (`--latest`), Vercel PROD deployado. `dev=main`.

- **D1 — modo de pago por proveedor:** `proveedores.modo_pago` (`contado|anticipo|contra_entrega|cuenta_corriente`, CHECK) + `anticipo_pct`. En el form de proveedor: select de modo + % anticipo (solo si modo=anticipo). Al elegir el proveedor en una OC se propone "paga con anticipo" + % (`defaultAnticipoOC`), con override por OC: `ordenes_compra.paga_con_anticipo` + `anticipo_pct` (snapshot). El badge 💰 Anticipo + alerta por días sin recepción ya existía en Gastos → OC (escalado D1b).
- **D2 — plan de pagos opcional por OC:** `ordenes_compra.pago_schedule JSONB` = `[{etiqueta,base 'confirmacion'|'recepcion'|'dias',dias?,pct}]`. Editor de cuotas en el form de OC (valida suma 100% con `scheduleValido`); se muestra como guía en el modal de pago de Gastos → OC.
- **D3 — comprobante de transferencia:** reusa `ordenes_compra.comprobante_url` (ISS-096). En el modal de pago, cuando hay un medio Transferencia con monto, aparece "Adjuntar comprobante" (o "Ver" si ya está) vía `subirComprobanteOC`/`verComprobante`.
- **Lib pura nueva:** `src/lib/comprasPago.ts` (`MODOS_PAGO_PROVEEDOR`, `defaultAnticipoOC`, `montoAnticipo`, `scheduleValido`, `totalPctSchedule`, `montoCuota`, `labelBaseCuota`) + `tests/unit/comprasPago.test.ts` (16 tests).
- **Tocado:** `ProveedoresPage.tsx` (form proveedor + form OC + saveOC), `GastosPage.tsx` (modal de pago de OC), `brand.ts` (v1.35.0), `schema_full.sql`.

**Próximo paso (Compras CO6-CO8):** CO6 cheques diferidos + endoso (D4) · CO7 enviar OC email/WA + auto-draft stock bajo + servicios recurrentes (A6/A3/F1/F2/F3) · CO8 reportes/alertas/export + reporte diferencias OC vs recepción (E4) + calificación de proveedor (G1/G2/G3).

---

## [2026-06-05] cierre-sesión | Resumen para retomar (estado: PROD v1.34.0, mig 185)

**Sesión larga — todo deployado a PROD, dev=main (salvo commits docs en dev, se foldean en el próximo PR). Suite 412 tests verdes.**

Lo hecho en esta sesión, en orden:
1. **Conteos 2.0 cerrado al 100%** — F2b scan-to-count (v1.28→1.29), F4 ABC/cíclico/reportes/trazabilidad (v1.29.0, mig 180), y cierre F2b-ref + F3b (doble conteo formal) + A2 (wall-to-wall bloquea sucursal) (v1.30.0, mig 181). Módulo sin pendientes. Memoria: `project_conteos2_backlog.md`.
2. **ISS-151 cerrado** (v1.30.1) — excluir `Incobrable` de los medios de pago del Dashboard + unificar `PSEUDO_METODOS_PAGO` en `ccLogic.ts`.
3. **Relevamiento Compras respondido** por GO → `relevamiento_compras_respuestas.md` (plan CO1-CO8). Decisiones GO: E3/B6/D1/A6 ✅.
4. **Compras CO1-CO4 deployado a PROD:** CO1 gobierno OC (v1.31.0, mig 182) · CO2 recepción robusta + fix B5 (v1.32.0, mig 183) · CO3 costos (v1.33.0, mig 184) · CO4 devolución a proveedor (v1.34.0, mig 185).

**Próximo paso (Compras CO5-CO8):** CO5 anticipo/contra-entrega por proveedor + schedule de pago (D1/D2/D3) · CO6 cheques diferidos + endoso (D4) · CO7 enviar OC email/WA + auto-draft desde stock bajo + servicios recurrentes (A6/A3/F1/F2/F3) · CO8 reportes/alertas/export + reporte diferencias OC vs recepción (E4) + calificación de proveedor (G1/G2/G3). Detalle y diseño en `relevamiento_compras_respuestas.md` + `project_pendientes.md`.

**Otros pendientes abiertos (fuera de Compras):** RLS por sucursal a nivel servidor (deuda técnica, pedido GO) · relevamientos sin responder: RRHH/Envíos/Caja · bug GastosPage (espera stack trace Sentry) · Clientes diferidos (B7 tope deuda global, F2 fidelización -necesita relevamiento-, cobranza CC→arqueo) · convertir planes `.plan.md` e2e a Playwright reales.

**Libs puras nuevas de la sesión:** `conteoAbc.ts`, `comprasPermisos.ts`, `recepcionLogic.ts`, `comprasCostos.ts`, `devolucionProveedor.ts` (todas con tests).

---

## [2026-06-05] deploy | v1.33.0 + v1.34.0 PROD — Compras CO3 (costos) + CO4 (devolución a proveedor)

Dos fases más del módulo **Compras** a PROD. Migraciones **184** (CO3) y **185** (CO4), ambas en DEV y PROD. Build verde, **412 tests** (+10 `comprasCostos`, +9 `devolucionProveedor`).

**CO3 — Costos (v1.33.0, mig 184):**
- E1 alerta de cambio de costo al recibir (`tenants.compras_costo_alerta_pct`, default 10%) → checkbox por línea para actualizar el `precio_costo` del producto (lib `comprasCostos.superaAlertaCosto`).
- E2 costos accesorios sueltos en la OC (`costo_aduana/comision/otros`, sin distribuir).
- B6 editar precio en recepción con audit (`actividad_log`).
- E3 alta rápida de producto desde la recepción (DUEÑO/SUPERVISOR → `productos.pendiente_revision=true`).
- Config en Config → Gastos. (E4-reporte de diferencias OC vs recepción se hace en CO8.)

**CO4 — Devolución a proveedor (v1.34.0, mig 185):**
- C1 entidad separada `devoluciones_proveedor` + `devolucion_proveedor_items` (RLS por tenant + trigger correlativo).
- Desde el detalle de una OC recibida → "Devolver a proveedor": ítems + cantidades, motivo (catálogo C3) + observación opcional, forma del reembolso (C2): **crédito_cc** (nota de crédito en `proveedor_cc_movimientos`, reduce deuda) / **efectivo** (ingreso a caja abierta) / **reposicion** (OC nueva borrador).
- Al confirmar rebaja stock FIFO por producto en la sucursal + movimiento `ajuste_rebaje`; valida stock disponible (`devolucionProveedor.validarDevolucion`). Cierra el `tiene_reembolso_pendiente` huérfano.

**Pendiente Compras:** CO5 (anticipo/contra-entrega) · CO6 (cheques) · CO7 (envío+inteligente+servicios) · CO8 (reportes + E4-reporte + calificación proveedor). Plan en `relevamiento_compras_respuestas.md`.

---

## [2026-06-05] deploy | v1.31.0 + v1.32.0 PROD — Compras CO1 (gobierno OC) + CO2 (recepción robusta)

Dos fases del módulo **Compras** deployadas a PROD. Migraciones **182** (CO1) y **183** (CO2), ambas en DEV y PROD. Build verde, **393 tests** (+14 `comprasPermisos`, +13 `recepcionLogic`).

**CO1 — Gobierno de OC (v1.31.0, mig 182):**
- A1 creación por rol (`comprasPermisos.capacidadCrearOC`): DUEÑO/ADMIN/SUPERVISOR completa · DEPOSITO solo borradores · CAJERO/CONTADOR sin acceso.
- A2 aprobación por umbral: OC sobre `oc_aprobacion_umbral` queda `requiere_aprobacion` y solo un rol aprobador la envía ("Aprobar y enviar" → `aprobada_por/at`). `puedeEnviarOC`.
- A4 sucursal obligatoria en la OC. A5 numeración configurable `tenants.oc_numeracion` (default sucursal; `set_oc_numero` asigna `numero_sucursal`; etiqueta `S-OC-0001`).
- D5 pago: CONTADOR read-only (`puedeRegistrarPagoOC`) + doble firma por umbral (`oc_pago_doble_firma_umbral`) con clave maestra en el modal de pago de Gastos.
- Config en Config → Gastos → Órdenes de compra. Lib pura `src/lib/comprasPermisos.ts`.

**CO2 — Recepción robusta (v1.32.0, mig 183):**
- **B5 (el bug):** el estado de la OC se recalcula desde el **acumulado de todas las recepciones confirmadas** (`recepcionLogic.estadoOCdesdeRecibido`), no solo la actual → una OC completada en varias parciales ahora llega bien a `recibida`. (Antes `RecepcionesPage` lo calculaba solo con la recepción en curso.)
- B3 over-receipt con umbral % acumulado (`tenants.over_receipt_pct_max`, `superaOverReceipt`). B4 motivo de faltante obligatorio en under-receipt (catálogo) + `recepcion_alerta_faltante_dias`. B1c over/under requiere SUPERVISOR+ (`esAjusteCantidad`). B7 adjuntar remito (bucket privado `remitos` scoped por tenant + `recepcion_remito_obligatorio`). B2 recepción sin OC exige proveedor.
- Lib pura `src/lib/recepcionLogic.ts`.

**Decisiones de GO confirmadas en sesión:** E3 alta producto en recepción ✅ · B6 editar precio remito ✅ · D1 modos de pago por proveedor ✅ · A6 WA por link ✅ (van en CO3/CO5/CO7).

**Pendiente Compras:** CO3 (costos) · CO4 (devolución a proveedor) · CO5 (anticipo/contra-entrega) · CO6 (cheques) · CO7 (envío+inteligente+servicios) · CO8 (reportes). Plan en `relevamiento_compras_respuestas.md`.

---

## [2026-06-05] ingest | Relevamiento Compras respondido — plan por fases CO1-CO8

GO + socio respondieron el relevamiento de Compras (OC + Recepciones, 34 preguntas A-H). Consolidado en `relevamiento_compras_respuestas.md`: respuestas + diseño + modelo de datos + plan por fases **CO1-CO8** + mis sugerencias donde difiero.

- **Hallazgos del código:** (1) B2 — la recepción **ya admite sin OC** (`oc_id` nullable, `RecepcionesPage.tsx:433`), está OK; (2) **B5 — NO es robusto hoy**: el estado de la OC se recalcula solo con la recepción actual, no acumulando entre múltiples recepciones (`RecepcionesPage.tsx:538-548`) → se arregla en CO2.
- **Sugerencias propuestas (esperan OK de GO):** E3 alta rápida de producto en recepción (rol alto + "pendiente revisión") en vez de "no permitir"; B6 editar precio en recepción con audit; D2 schedule opcional; A6 WA por link.
- **Top 3 recomendado:** CO2 (recepción robusta) → CO3 (costos) → CO4 (devolución a proveedor). CO1 (governance) puede ir 1º.

**Pendiente:** confirmar decisiones abiertas con GO → implementar por fases (cada una deployable a PROD).

---

## [2026-06-05] deploy | v1.30.1 PROD — ISS-151: excluir 'Incobrable' del Dashboard + unificar pseudo-métodos

**Deployado a PROD.** Bugfix frontend, sin migración. Build verde, **366 tests verdes** (+4). PR #159, release v1.30.1, dev=main. Cierra **ISS-151**.

- **Fix:** el write-off `Incobrable` (B6) se guarda en `medio_pago` pero el Dashboard solo excluía `Cuenta Corriente`/`Cancelación CC`/`Condonación CC` → contaba como ingreso y distorsionaba la ganancia. Ahora se excluye.
- **Unificación:** `PSEUDO_METODOS_PAGO` + `esMetodoRealPago` en `src/lib/ccLogic.ts` (fuente única, testeada) reemplazan los 3 sets duplicados en `MixCajaChart` y `MetricasPage`.
- **Nota:** Condonar/Revertir CC + las exclusiones base ya estaban en PROD desde un release previo (el wiki tenía el estado 🔄 DEV desactualizado); este patch cerró el gap real (`Incobrable`).

---

## [2026-06-05] deploy | v1.30.0 PROD — Conteos 2.0 cierre 100% (F2b-ref + F3b + A2)

**Deployado a PROD.** Migración **181** (aditiva) en DEV y PROD. Build verde, **362 tests verdes**. PR #158 mergeado, release v1.30.0, dev=main. Vercel PROD en build al cierre. Cierra el 100% de Conteos 2.0 (ISS-CONT).

- **F2b-ref (E3):** escanear durante el conteo un producto **fuera de alcance** que tiene stock en la sucursal lo agrega como fila "fuera de alcance" (mercadería mal ubicada, badge en la tabla); sin stock en la sucursal → aviso accionable hacia Ingreso (el alta de stock nuevo sigue siendo del flujo Ingreso, con LPN/lote/serie). `inventario_conteo_items.fuera_de_scope`.
- **F3b — doble conteo formal + snapshot de costo:**
  - `inventario_conteo_items.costo_snapshot` — el costo se congela al cargar la línea; la valorización deja de usar el `precio_costo` actual al continuar un borrador (bug del pending note).
  - Doble conteo **formal**: las filas cuyo 1er conteo supera el umbral de discrepancia (`conteo_reconteo_*`) exigen **re-ingreso** (columna "Recontar", idealmente otro operador) antes de finalizar; se puede **saltar con clave maestra** (SUPERVISOR/DUEÑO, `verificar_clave_maestra`). Persiste `cantidad_reconteo` + `reconteo_por`; el ajuste usa el valor recontado (`contadaEfectiva`).
- **A2 — wall-to-wall bloquea la sucursal:** toggle `tenants.conteo_wall_to_wall_bloquea` (**default OFF** → sin cambios para tenants actuales). Al iniciar un conteo de sucursal completa con el toggle on: confirmación (DUEÑO/SUPERVISOR) + se crea el borrador con `inventario_conteos.bloquea_movimientos=true` en el acto. Mientras esté abierto, el **POS** no permite reservar/despachar (presupuesto sí, no mueve stock) y el **Inventario** no permite ingreso/rebaje en esa sucursal. Hook compartido `src/hooks/useConteoBloqueante.ts`; badge "🔒 Bloqueante" en el historial; se libera al finalizar/eliminar el conteo.

**🎉 Conteos 2.0 (ISS-CONT) CERRADO al 100% — F1-F4 + refinamientos en PROD.** Diseño/relevamiento en `relevamiento_conteos_respuestas.md`.

---

## [2026-06-05] deploy | v1.29.0 PROD — Conteos 2.0 F2b (scan-to-count) + F4 (ABC/cíclico/reportes/trazabilidad) — cierre del módulo

**Deployado a PROD.** Migración **180** (aditiva) en DEV y PROD. Build verde, **362 tests verdes** (+16 de `conteoAbc`). PR #157 mergeado, release v1.29.0, dev=main. Vercel PROD en build al cierre.

- **F2b — scan-to-count:** botón "Escanear para contar" en el tab Conteo abre `BarcodeScanner` en modo **persistente** (sigue escaneando). Cada lectura resuelve el código (GS1 vía `resolverScanCompuesto` con fallback a barcode/SKU) y **suma a la fila del producto** la cantidad del AI GS1 (30) o **+1**. Respeta unidad entera/decimal; ref espejo `conteoRowsRef` para scans rápidos consecutivos; toast `+N Producto → total`. `BarcodeScanner` gana prop `persistentCloseLabel` (para no decir "Finalizar venta" fuera del POS).
- **F4 — cierre de Conteos 2.0 (4 piezas):**
  - **Clase ABC:** `productos.clase_abc` (A/B/C, CHECK) + `clase_abc_manual` + `ultimo_conteo_at`. "Recalcular ABC" client-side (reusa `clasificarABC`, **Pareto 80/95** por valor de movimiento de 12m = Σ cantidad × `precio_costo_historico`); respeta overrides manuales; 3 updates agrupados por clase. Override por producto desde el panel.
  - **Conteo cíclico sugerido:** `tenants.conteo_ciclico_dias_a/b/c` (default 30/90/180, editables en Config → Inventario). Panel "Conviene contar" (vencidos por clase, nunca contado = prioridad máxima) con atajo "Contar" → conteo por producto preseleccionado.
  - **Reportes de exactitud + valorización:** `reporteExactitud` (% exactitud + $ faltante/sobrante/neto). Por conteo (detalle finalizado) + **acumulado** (panel) + **export Excel** por conteo.
  - **Trazabilidad por operador:** `inventario_conteo_items.contado_por` seteado al guardar + columna "Contado por" en el detalle.
- **Lógica pura** en `src/lib/conteoAbc.ts` (`clasificarABC`, `sugerirConteoCiclico`, `reporteExactitud`) + 16 tests.
- **schema_full.sql** actualizado con bloque consolidado Conteos 2.0 (mig 177-180), que estaba desfasado en mig 176.

**Conteos 2.0 (ISS-CONT) CERRADO — F1-F4 en PROD.** Pendientes futuros (no bloqueantes): F2b-refinamiento (alta de fila al escanear fuera de scope) · F3b (doble conteo formal 2º operador + clave maestra C4 + snapshot de costo) · wall-to-wall A2 (bloqueo POS durante conteo full).

---

## [2026-06-03] deploy | v1.27.0 PROD — Conteos 2.0 F3 (gate de ajustes + autorizaciones + reconciliación delta)

**Deployado a PROD.** Migración **179** en DEV y PROD. Build verde, **346 tests verdes** (+16 de `conteoAjuste`).

- **Gate de aprobación de ajustes (D):** las diferencias de un conteo ya no tocan el stock directo. Config en Config → Inventario: `tenants.conteo_gate_activo` + umbrales `conteo_gate_umbral_u/_pct/_valor`. **Gate inactivo → toda diferencia va a aprobación**; activo → solo las que superen algún umbral (unidades / % / valor $), el resto se aplica directo.
- **Tab Autorizaciones (D1):** las diferencias que pasan el gate se insertan en `autorizaciones_inventario` con `tipo='ajuste_conteo'` (motivo "Diferencia Conteo") → un DUEÑO/SUPERVISOR las aprueba en Inventario → Autorizaciones. `aprobarAutorizacion` aplica el ajuste al aprobar.
- **Reconciliación por delta (G1):** al aplicar (directo o aprobado) NO se pisa el stock; se aplica `vivo + (contado − esperada_snapshot)` sobre el stock vivo → respeta ventas ocurridas durante el conteo en vez de revertirlas. `reconciliarDelta` (testeada).
- **Doble conteo (C):** umbrales `conteo_reconteo_umbral_u/_pct/_valor`; al finalizar avisa qué filas superan el umbral para recontar (versión "aviso", `window.confirm`).
- **Lógica pura** en `src/lib/conteoAjuste.ts`: `superaUmbral` (combinado u/%/$), `requiereAutorizacion`, `requiereReconteo`, `reconciliarDelta` + 16 tests.

**QA (híbrido):** `migration-reviewer` (APTA) + `code-reviewer` detectó 2 bloqueantes — `stock_antes` se leía después de mutar la línea (auditoría errónea, **bug preexistente**) + posible movimiento con cantidad 0 → ambos corregidos en finalizar y en aprobar.

**Pendiente Conteos 2.0:** F2b (scan-to-count) · F3b (doble conteo formal con 2º operador + clave maestra C4; snapshot de costo por ítem) · F4 (clase ABC + cíclico + reportes exactitud/valorización).

---

## [2026-06-03] deploy | v1.26.0 PROD — Conteos 2.0 F2a (modos + a ciegas + unidad de medida + secuencia)

**Deployado a PROD.** Migración **178** en DEV y PROD. Build verde, 330 tests verdes.

- **Modo de conteo configurable** (`tenants.conteo_modo` = rapido | guiado | elegir; Config → Inventario): **Rápido** = informado (precarga la esperada, como antes); **Guiado** = a ciegas (input vacío, oculta Esperado/Diferencia); **Elegir** = el operador decide al crear el conteo (toggle).
- **Conteo a ciegas (B1/B2):** en guiado no se ve el stock del sistema; DUEÑO/SUPERVISOR/ADMIN puede "revelar" la esperada de una fila puntual (botón ojo). Banner de modo.
- **Filas en blanco (B3):** `inventario_conteo_items.cantidad_contada` ahora nullable. `null` = no contada → se omite del ajuste; `0` = contó cero → ajusta. Al finalizar avisa cuántas quedaron sin contar.
- **🐛 Fix (pedido GO): el input "Contado" respeta la unidad de medida.** Antes, con la flechita, 15 → 14,999 en productos de unidades. Ahora: unidades/piezas → enteros (step 1, redondeo); kg/gr/lt/ml → decimales. Reusa `esDecimal()`.
- **`ubicaciones.secuencia`** (I3): nuevo campo de orden de recorrido (conteo + picking), editable en Config → Inventario → Ubicaciones (junto a prioridad de rebaje, que es distinta). El conteo ordena las líneas por esta secuencia (fallback prioridad → nombre).

**QA (híbrido):** `migration-reviewer` corrigió el patrón del CHECK (usar `information_schema.table_constraints` con `table_name`, como mig 134/135). `code-reviewer` detectó 2: `modo` no se persistía al actualizar un borrador + valor negativo tratado como "no contada" en silencio → ambos corregidos.

**Pendiente Conteos 2.0:** F2b (scan-to-count) · F3 (gate ajustes + autorizaciones + doble conteo + reconciliación delta) · F4 (clase ABC + cíclico + reportes).

---

## [2026-06-03] deploy | v1.25.0 PROD — Conteos 2.0 F1 (scope por Marca / Categoría / Wall-to-wall)

**Deployado a PROD.** Migración **177** aplicada en DEV y PROD. Build verde, 330 tests verdes. Primera fase de **Conteos 2.0** (ISS-CONT), arrancando por lo que pidió GO: conteo por **Marca**.

- **Scope ampliado:** el conteo de inventario (InventarioPage → tab Conteo) ahora soporta **por Marca, por Categoría y Sucursal completa (wall-to-wall)**, además de ubicación/producto. Toggle de 5 alcances + selector dinámico.
- **Mig 177:** CHECK de `inventario_conteos.tipo` ampliado (`+ marca, categoria, sucursal`) + `filtros JSONB` (guarda el criterio cuando no es FK directa).
- `cargarLineasParaConteo` arma el query dinámico con `productos!inner` para filtrar por `marca`/`categoria_id`. Las marcas/categorías del selector se derivan del **stock de la sucursal activa** (no del maestro entero).
- **Aislamiento por sucursal:** los scopes amplios (marca/categoría/wall-to-wall) **exigen una sucursal específica** (no "Todas") — guard en la carga + toggles deshabilitados con tooltip.

**Flujo de QA (modelo híbrido):** `migration-reviewer` → APTA (nombre de constraint correcto, idempotencia aceptable, sin DDL destructivo). `code-reviewer` → detectó **un bloqueante**: wall-to-wall con `sucursalId=null` cruzaba sucursales y el ajuste pisaba stock ajeno → corregido (guard + toggles). También reset de `conteoTipo` y filtrado de marcas/categorías por sucursal. Ver [[feedback_usar_subagentes_proyecto]].

**Pendiente Conteos 2.0:** F2 (modos + ciego + scan + secuencia ubicación) · F3 (gate ajustes + tab Autorizaciones + doble conteo + reconciliación delta) · F4 (clase ABC + cíclico + reportes). Diseño completo en `relevamiento_conteos_respuestas.md`.

---

## [2026-06-03] deploy | v1.24.0 PROD — Clientes C6 (segmentación+export) + D4 (NC manual proveedor)

**Deployado a PROD.** Backlog diferido de Clientes, **sin migración** (usa columnas de mig 176 + el tipo `'nota_credito'` ya en el CHECK de mig 085). Build verde, 330 tests verdes.

- **C6 — segmentación de clientes (marketing):** en ClientesPage → tab Reportes, sección "Segmentación de clientes". Filtros por etiqueta, estado CC (habilitada/con deuda/sin deuda), actividad (compraron/nunca/inactivos +60d), mínimo comprado y con contacto (email/tel). Export CSV/Excel de la lista segmentada con datos de marketing. Reusa `statsMap`/`ventasCC`/`creditoMap`/`etiquetasCatalogo`. Cierra C6 (era "solo segmentación+export, sin bulk-sender nativo").
- **D4 — NC manual de proveedor:** en ProveedoresPage → modal CC, sección "Nota de crédito". Form (monto, nº `NC-NNNN` correlativo sugerido sobre toda la historia del proveedor + editable, motivo, adjunto opcional al bucket `comprobantes-gastos`). Inserta movimiento `tipo='nota_credito'`, `monto` negativo (acredita/reduce deuda), con `nc_numero` + `adjunto_url`. Link al comprobante en el historial. Cierra el ◑ que dejó CL5 (las columnas existían, faltaba la UI).

**Flujo de QA estrenado:** `code-reviewer` (subagente, vía Agent) revisó el diff antes de mergear → confirmó behavior/multi-tenant OK y detectó 2 cosas que se arreglaron: correlativo calculado sobre los 50 movimientos visibles (→ query dedicada al máximo real) + form NC sin resetear al cambiar de proveedor (→ reset al abrir el panel). Ver [[feedback_usar_subagentes_proyecto]] (modelo híbrido: grueso inline + agente para revisión read-only del diff).

---

## [2026-06-03] deploy | v1.23.2 PROD — QA: extensión de tests a Caja / Inventario / Ventas (+101)

**Deployado a PROD.** Refactor interno + cobertura de tests, **sin cambio de comportamiento, sin migración**. Sesión autónoma (GO autorizó alcance + deploy de antemano).

Segundo estreno del pipeline de QA, ahora sobre **3 módulos**:

- **Caja:** lógica de arqueo extraída de `CajaPage.tsx` a `src/lib/cajaArqueo.ts` (rewire behavior-preserving): `signoMovimiento`, `saldoSesion`, `calcularDiferenciaCierre`, `calcularDiferenciaApertura`, `superaUmbralDiferencia` (B1/B2/B3), `clasificarAjusteDiferencia` (B4), `tipoAjusteTraspaso` (ISS-193), `acumularTotalesPorMetodo`, `extraerMedioPago`/`extraerNumeroVenta`. Tests: `cajaArqueo.test.ts` (38) + `cajaPermisos.test.ts` (matriz J3 / B5 / B6, 19). **+57**.
- **Inventario:** `unidades.test.ts` (17) — conversión kg↔gr / lt↔ml, compatibilidad, formato es-AR.
- **Ventas:** `ventasDescuentoCombo.test.ts` (7, gap `calcularDescuentoComboMulti`) + `permisosCosto.test.ts` (8, `puedeVerCosto` G4) + `umbralGasto.test.ts` (13, `evaluarUmbralGasto` + `puedeAprobar`). **+28**.
- Planes de escenarios: `tests/specs/{caja,inventario,ventas}.plan.md`.

**Suite total: 329 unit tests verdes** (228 → +101). Build verde (`tsc && vite build`).

---

## [2026-06-03] update | v1.23.1 PROD — QA: lógica de CC testeable + ecosistema de subagentes

**Deployado a PROD** (PR #148). Refactor interno + cobertura de tests, **sin cambio de comportamiento, sin migración**.

**Ecosistema de subagentes de proyecto** (`.claude/agents/`, commiteados): 9 agentes — relevamiento, spec-extractor, test-author, test-runner, migration-reviewer, code-reviewer, bug-fixer, deploy-runner, wiki-keeper. Ver [[wiki/development/agentes-claude-code]].

**Primer estreno del pipeline de QA** sobre Clientes:
- `spec-extractor` → `tests/specs/clientes.plan.md` (41 escenarios; detectó que la lógica de plata de CC estaba 100% sin cubrir).
- Lógica de CC extraída a `src/lib/ccLogic.ts` (single source of truth): `evaluarLimiteCC` (B1), `evaluarMorosidad` (B4), `calcularInteresMora` (B3, espejo RPC), `calcularEstadoCC` (espejo RPC), `planificarCobranzaFIFO` (B5), `agruparAgingCC` (G1). Rewire behavior-preserving en VentasPage/cobranzaCC/ClientesPage.
- `test-author` → `tests/unit/ccLogic.test.ts` (50 casos) + detectó un error de cálculo en el plan (CL2-B3-08: 287.40 → 288.07; el código era correcto).
- Suite total: **228 unit tests verdes**. Build verde.

**Infra de testing confirmada (Fase 0):** `.env.test.local` + auth por rol (cajero/supervisor/rrhh/owner) + 16 specs e2e ya existían.

**Caveat:** los subagentes creados a mitad de sesión recién son invocables por nombre al reiniciar Claude Code; en esta sesión se corrieron vía `general-purpose` embebiendo sus instrucciones.

---

## [2026-06-02] deploy | v1.23.0 PROD — Clientes CL4+CL5+CL6 — MÓDULO CLIENTES COMPLETO

**Deployado a PROD** (PR #143). Migrations 175 (CL4) + 176 (CL5) en DEV y PROD; CL6 sin migración. Build verde. Sesión retomada tras reinicio de máquina (estado verificado: mig 171-174 + v1.20.0 ya en PROD).

- **CL4 notificaciones (mig 175):** `lib/notificacionesCC.ts` (email event-driven vía `send-email`). C1 email al registrar deuda CC; C4 comprobante de pago en las 3 vías (ficha/POS/Caja); C2 umbral pre-vencimiento configurable (resaltado tab CC); C5 panel cumpleaños + saludo WA. Config en ConfigPage → Ventas → Operativa. Defaults OFF (opt-in). C3 escalado configurable (envío background no disponible sin pg_cron).
- **CL5 CC proveedores (mig 176):** tabla `proveedor_cuentas_bancarias` (D6) + CRUD en modal CC; PDF estado de cuenta proveedor (D3); columnas `nc_numero`/`adjunto_url` (D4). D2/D5 ya existían.
- **CL6 reportes/audit (sin migración):** tab "Reportes" (top clientes, inactivos +60d, aging CC 0-30/31-60/61-90/+90); export Excel (G3); audit log de cambios del cliente en sub-tab "Cambios" (F4); tipos `EntidadLog`/`AccionLog` ya extendidos en CL3.
- **🐛 Fix autofill:** Chrome escribía un email guardado en el buscador de ventas (Historial) al aparecer el input de clave maestra. Fix: `autoComplete="new-password"` en el password + `autoComplete="off"` en los buscadores.

**🎉 Módulo Clientes CL1–CL6 COMPLETO.** Backlog diferido: B7, C6, F2, D4 UI NC, C3 background (cron), cobranza CC con impacto en arqueo.

---

## [2026-06-02] deploy | v1.20.0 PROD — Clientes CL3 (incobrables + estado de cuenta) + bugfix origen

**Deployado a PROD.** Migrations 173 (CL3) + **174 (bugfix)**, ambas en DEV y PROD. Build verde.

- **B6 incobrables:** botón "Incobrable" en tab CC (DUEÑO/ADMIN/SUPER_USUARIO) → modal motivo + clave maestra → condona deuda CC del cliente (tag `Incobrable`) + gasto automático "Deudores incobrables" + `logActividad`. Tipos `EntidadLog`/`AccionLog` extendidos (`cliente`/`incobrable`).
- **B8 estado de cuenta:** lib `estadoCuentaPDF.ts` (PDF jspdf) + portal público `/cuenta/:token` (`CuentaClientePage`) vía `clientes.cuenta_token` (mig 173) + RPC `get_cuenta_cliente_by_token` (anon). Botones "Estado de cuenta" y "Link cliente" en el tab CC.
- **🐛 Bugfix (mig 174):** `DROP CONSTRAINT ventas_origen_check`. Reportado por GO: "new row violates check constraint ventas_origen_check" al vender. Causa: mig 168 hizo el canal configurable por tenant, pero la constraint rígida (mig 122) seguía con lista fija. Aplicado directo en DEV+PROD (toma efecto inmediato).

**Pendiente:** CL4 (notificaciones) · CL5-CL6.

---

## [2026-06-01] deploy | v1.19.0 PROD — Clientes CL1 + CL2 (CC + cobranza)

**Deployado a PROD.** PR #140 (`dev → main`) mergeado · release `v1.19.0` (`--latest`) · migrations **171 + 172 aplicadas en PROD** (aditivas/idempotentes) · DEV alineado con PROD · build verde. Vercel PROD deploy desde `main`.

Arranque de implementación del backlog Clientes. Build verde (`tsc && vite build`). Migrations 171+172 en DEV y PROD.

**CL1 — v1.18.0 · mig 171 (soft delete + etiquetas):**
- A6: baja = soft delete con razón (`clientes.motivo_baja/baja_at/baja_por`); botón "Dar de baja" + modal motivo, badge "Baja", toggle "Ver inactivos" + reactivar. El hard-delete (código muerto) se reemplazó.
- A2: alerta de duplicado al crear (DNI/tel/nombre) sin trabar.
- A5: import detecta duplicados contra toda la base + 3 modos (ignorar existentes/nuevos/procesar todos) con UPDATE de existentes; columna `etiquetas` en plantilla.
- F1: autocomplete de etiquetas (`<datalist>`) = `tenants.cliente_etiquetas_catalogo` ∪ usadas.
- B2: habilitar CC solo DUEÑO/SUPERVISOR. H2: CONTADOR read-only en `/clientes`.

**CL2 — v1.19.0 · mig 172 (CC: límite/vencimiento/interés/morosidad):**
- B1: enforcement configurable (`cc_enforcement_politica` permitir/avisar/bloquear) + `limite_cc_default`; reusa `clientes.limite_credito`. Aplicado en el POS al despachar CC.
- B3: `ventas.fecha_vencimiento_cc` al crear venta CC + interés de mora (`cc_interes_mensual_pct` → `ventas.interes_cc`) por RPC `recalcular_intereses_cc` (sweep-lazy, pg_cron no habilitado). Tab CC muestra interés + vencimiento.
- B4: morosidad (`cc_morosidad_politica` permitir/bloqueo_cc/bloqueo_total) en el POS, con RPC `cliente_cc_estado`.
- B5: cobranza FIFO desde las 3 vías — ficha + **POS** (botón "Deuda CC" en el chip) + **Caja** (tab "Cobranzas CC", `CajaCobranzasCC`). Helper compartido `src/lib/cobranzaCC.ts`. **CL2 COMPLETO.**
- ConfigPage → Ventas → Operativa: sección "Cuenta corriente de clientes".

**Pendiente:** CL3-CL6 · deploy a PROD (aplicar mig 171+172).

---

## [2026-06-01] update | Relevamiento Clientes COMPLETO — respuestas consolidadas + plan por fases CL1-CL6

Relevamiento de reglas de negocio del módulo **Clientes** (GO + socio) procesado y cruzado con `relevamiento_ventas_respuestas.md`.

**Qué se hizo:**
- Volcadas todas las respuestas (A-H) a `sources/raw/relevamiento_clientes_respuestas.md`.
- Cruce con Ventas donde GO lo pidió: B4↔Ventas D6, B5↔D5, B6↔D7, B7↔D8, B3↔D2, C1↔D3, H2↔J3. Coherencia confirmada.
- **Resuelto contradicción F3 vs Ventas G2:** GO decidió **precio solo por cantidad por producto** (`producto_precios_mayorista`, ya en PROD). Se **descarta** lista atada al cliente (`cliente.lista_id`).
- Sugerencias cerradas donde GO pidió "¿qué sugerís?": A2 (alerta duplicado vs rechazo duro), B1 (enforcement configurable), D3/D4/D5/D6 (proveedores).
- **GO no eligió Top 3: entra todo.** Plan por fases **CL1-CL6** (v1.18.0 → v1.23.0) documentado en `project_pendientes.md`.
- **Transversal:** disparos por tiempo (intereses, recordatorios, escalados) por sweep lazy (pg_cron no habilitado).

**Pendiente:** arrancar implementación por CL1 (fundación datos + permisos, bajo riesgo). Sin código aún — esta sesión fue relevamiento + diseño.

---

## [2026-06-01] update | v1.17.0 PROD — Relevamiento Ventas VF5 (edición post-venta + NC interna) — RELEVAMIENTO VENTAS COMPLETO

Quinta y última fase del backlog Ventas H-K. Bump v1.16.0 → **v1.17.0**. **Sin migración** (reusa `devoluciones` + `venta_auditoria`).

- **H1a — autorización post-cobro**: quitar/editar ítems de una venta **cobrada** (vía Devolver) ahora requiere rol **DUEÑO/SUPERVISOR/ADMIN**; otros roles (CAJERO) necesitan la **clave maestra** de un autorizado (si no hay clave configurada, se bloquea). Gate en `abrirModalDevolucion` (refactor con closure `abrir` + `pedirClaveMaestra`).
- **H1b — NC interna**: al devolver/ajustar una venta **facturada**, el comprobante se identifica como **"NOTA DE CRÉDITO INTERNA · NO FISCAL"** (no reemplaza la NC electrónica AFIP, que queda como feature aparte). Se registra en el audit log de la venta (`venta_auditoria`, acción `nc_interna` con `numero_nc` + monto + motivo + ítems); las devoluciones de ventas despachadas se loguean como `devolucion`. El timeline del detalle muestra N° de NC + monto.
- Typecheck + `vite build` OK. **Relevamiento de Ventas (A-K) COMPLETO**; único pendiente futuro: NC electrónica AFIP (L1) + venta física en USD/caja USD.

---

## [2026-06-01] update | v1.16.0 PROD — Relevamiento Ventas VF4 (reportes + alertas + export)

Cuarta fase del backlog Ventas H-K. Bump v1.15.0 → **v1.16.0**. Migration **170** (DEV+PROD).

- **K1 (ReportesPage)** — 5 reportes nuevos: **baja rotación** (unidades vendidas asc, incl. no vendidos), **más devoluciones** (ranking de productos por unidades devueltas), **anuladas y devueltas** (devoluciones + ventas canceladas con motivo), **comparativa por canal** (ventas/total/ticket promedio por canal + clasificación online/presencial vía `useCanalesVenta`), **margen real por venta** (total − costo histórico, % de margen).
- **K3** — export **CSV** además de Excel/PDF en cada reporte (`exportarCSV` con `sheet_to_csv` + BOM UTF-8).
- **K2 (mig 170)** — alertas **event-driven** a DUEÑO/SUPERVISOR/ADMIN (`notificarRolesVentas` → `notificaciones`): **margen negativo** al cerrar venta despachada (costo > total); **cliente/producto con >N devoluciones en M días** (chequeo al `procesarDevolucion`, fire-and-forget). Umbrales en Config → Ventas → Operativa (`alerta_margen_negativo`, `alerta_devoluciones_n`, `alerta_devoluciones_dias`).
- Typecheck + `vite build` OK. `schema_full.sql` + wiki actualizados.

---

## [2026-06-01] update | v1.15.0 PROD — Relevamiento Ventas VF1-VF3 (POS operativo + canales + auditoría)

Implementadas las 3 primeras fases del backlog Ventas H-K (relevamiento respondido el 2026-06-01). Bump v1.14.1 → **v1.15.0**. Migrations **167-169** (DEV+PROD). PR `dev → main` + Vercel.

**VF1 — POS operativo (H2-H5):**
- **H4** — reserva y venta directa (incl. 100% CC) **siempre exigen caja abierta**; solo el presupuesto (`pendiente`) puede crearse sin caja. Se quitó la excepción que permitía despachar 100% CC sin caja (`registrarVenta`).
- **H5** (mig 167) — flag **"Consumidor Final" vs "Cliente registrado"** al iniciar la venta (`ventas.consumidor_final`). Con facturación activa y no-CF → cliente obligatorio. Toggle en el panel Cliente (si `factHabilitada && permiteCF`); elegir cliente registrado lo marca como no-CF.
- **H2** — botón **"Enviar por email"** en el modal de ticket (reusa el template `venta_confirmada` de `send-email`), junto a "Imprimir".
- **H3** — reimpresión desde el historial ya disponible vía "Ver / Imprimir ticket" del detalle.

**VF2 — Canales configurables + reglas online/presencial (I1+I2, mig 168):**
- **I1** — tabla `canales_venta` por tenant (CRUD en Config → Ventas → Operativa, `CanalesVentaPanel`) con clasificación **online/presencial**; seed `SECURITY DEFINER` + trigger. El POS toma los canales del tenant (antes hardcodeado). **MP** no se seedea (es medio de pago). Hook `useCanalesVenta` (+ `clasificacionDe`/`reglaDe`).
- **I2** — `tenants.reglas_canal` con reglas por clasificación, **aplicadas** en POS/devoluciones: `requiere_cliente` (cliente obligatorio), `descuento_max_pct` (tope por canal), `lista_precio` (fuerza minorista/mayorista en `precioTierEfectivo`), `devolucion_dias` (plazo en `abrirModalDevolucion`).

**VF3 — Auditoría y permisos (J1-J3, mig 169):**
- **J1** — tabla `venta_auditoria` + helper `logVentaAuditoria` + **timeline en el modal** de la venta. Se registran anulación, cambio de cliente y override de descuento.
- **J2** — **clave maestra** (RPC `verificar_clave_maestra`) para **anular venta despachada**, **cambiar cliente** (botones nuevos en el detalle) y **override de descuento** (autoriza descuentos sobre el tope por rol/canal). Sin clave configurada no se exige.
- **J3** — **CONTADOR** con acceso **read-only** a Ventas: ruta en `CONTADOR_ALLOWED` + nav visible + en VentasPage solo el historial (sin POS, sin devolución/anular/registrar).
- Typecheck + `vite build` OK. `schema_full.sql` + wiki actualizados.

---

## [2026-05-31] hotfix | v1.14.1 PROD — fix RLS en seed de categorías de gasto (onboarding roto)

**Bug reportado por GO:** al registrar un negocio nuevo (Google + datos del negocio → "Crear") saltaba `new row violates row-level security policy for table "categorias_gasto"`.

**Causa raíz:** el onboarding (`OnboardingPage.tsx`) inserta **tenant primero, users después**. El trigger `trg_seed_categorias_gasto_new_tenant` (AFTER INSERT en `tenants`, mig 130) seedea `categorias_gasto` durante el INSERT del tenant — antes de que exista la fila en `users` que liga al usuario con el tenant. La función `fn_seed_categorias_gasto_new_tenant` / `seed_categorias_gasto` **NO eran SECURITY DEFINER**, así que el INSERT quedaba sujeto al RLS `WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))` → conjunto vacío → rechazo. Las otras 2 funciones de seed del tenant (`fn_seed_tenant_defaults`, `fn_crear_caja_fuerte`) ya eran SECURITY DEFINER; ésta quedó sin serlo desde mig 130. No relacionado con ISS-174.

**Fix (mig 166):** ambas funciones pasan a `SECURITY DEFINER` + `SET search_path = public`. Aplicada en DEV + PROD; verificado `prosecdef=true`. Surte efecto inmediato (fix de función en DB). Bump v1.14.0 → v1.14.1.

---

## [2026-05-31] update | v1.14.0 PROD — ISS-174 F2-F5: cotización/generación de envíos por API de courier

Continuación del mismo día: tras F1, se implementaron **todas las fases F2-F5** de ISS-174 y se deployó a PROD como **v1.14.0** (bump v1.13.0 → v1.14.0). Migration **165** aplicada en DEV+PROD. Edge Function `courier-api` deployada en DEV+PROD. PR `dev → main` + Vercel.

- **Edge Function `courier-api`** (`supabase/functions/courier-api/`) — router por `action` (cotizar | generar | tracking) + adapters **Andreani** (F2, REST), **Correo Argentino** (F3, Paq.ar), **OCA** (F4, SOAP); tracking en los tres (F5). Auth por JWT → tenant; credenciales leídas SOLO server-side (service_role), nunca al front. Errores de negocio → 400 con mensaje accionable.
- **mig 165** — `envios.cotizacion_json` (snapshot opciones) + `courier_orden_id` + `cotizado_api`.
- **Front** — `src/lib/couriers/api.ts` (cotizarEnvio / generarEnvioCourier / trackingEnvioCourier). **POS**: botón "Cotizar {courier}" (CP destino + peso) → lista servicio/precio/plazo → elegir setea servicio + costo (editable). **Envíos**: "Cotizar" en el modal + "Generar con courier" / "Etiqueta" / "Actualizar tracking" en el panel del envío. `esCourierApi()` gatea la UI a Andreani/Correo/OCA.
- **⚠ Adapters NO validados con cuentas reales** (GO aún no tiene contratos B2B). Escritos según documentación pública; al conseguir credenciales hay que validar/ajustar endpoints y mapeos. Fail-safe: sin credenciales → error claro, el alta manual de envíos no se ve afectada.
- Typecheck + `vite build` OK. Edge Function deployada (el bundle Deno compila). `schema_full.sql` (F1 cols) + wiki actualizados.

---

## [2026-05-31] update | ISS-174 F1 — Fundación cotización de envíos por courier (DEV)

Relevado con GO el diseño completo de ISS-174 (cotización + generación de envíos por API de courier) y arrancada la **Fase 1** (fundación, sin tocar APIs). Decisiones: **APIs directas** por courier (Andreani → Correo Argentino → OCA), alcance **completo** (cotizar + generar orden + etiqueta + tracking), **credenciales por tenant**, peso **configurable** (manual por envío | dato maestro del producto), cotizar en **POS + Envíos**, **CP estructurado**, operador **elige servicio** (precio editable). Diseño y fases en `project_pendientes.md` → sección ISS-174.

**F1 implementado en DEV:**
- **Parte 1** — *Servicio* de envío en el POS pasó de input libre a **select dependiente del courier** (igual que en Envíos). Catálogo `COURIERS`/`SERVICIOS_POR_COURIER` extraído a `src/lib/couriers/catalogo.ts` (compartido por `EnviosPage` y `VentasPage`).
- **mig 162** — `courier_credenciales` (credenciales de API por tenant, RLS por tenant) + `tenants.envio_peso_fuente` ('manual'|'producto', default manual).
- **mig 163** — idempotente: `codigo_postal` ya existía (sucursales mig 124, cliente_domicilios mig 074); re-documenta para ISS-174.
- **mig 164** — `productos.peso_kg/largo_cm/ancho_cm/alto_cm`.
- **Config → Envíos** — card "Peso y medidas para cotizar envíos" (toggle manual/producto) + `CourierCredencialesPanel` (owner-only; Andreani/Correo/OCA, campos por courier, secretos como password, estado "Configurado"). Campos peso/dim en `ProductoFormPage`. `AddressAutocompleteInput` ahora pasa `postcode` best-effort (Nominatim) para F2.
- Typecheck + `vite build` OK. Migrations 162-164 aplicadas en DEV. `schema_full.sql` actualizado. **Pendiente**: deploy a PROD + F2 (Edge Functions cotizar/generar Andreani, requiere credenciales reales del negocio).

---

## [2026-05-31] update | v1.12.0 PROD — Relevamiento Ventas E/F/G

Deploy a PROD. Bump `APP_VERSION` v1.11.6 → **v1.12.0**. Migrations **159 + 160** aplicadas en PROD (aditivas, antes del merge). PR `dev → main` + merge → Vercel PROD. Release + tag `v1.12.0`.

Contenido: reservas (seña obligatoria/mínima, vencimiento + liberación automática, penalidad + crédito a favor + redención, motivo cancelación), presupuestos (`PRES-NNNN` + actualizar on-demand), mayorista por cantidad en POS, costo/margen oculto por rol. Detalle por ítem en `relevamiento_ventas_respuestas.md`. Pendientes del relevamiento: G3 (refinamiento) y G5 (USD).

---

## [2026-05-31] update | v1.13.0 PROD — Ventas G3 (descuentos por rol) + G5 (precio USD) — relevamiento COMPLETO

Cierra el relevamiento de Ventas E/F/G. Bump v1.12.0 → **v1.13.0**. Migration **161** (DEV+PROD).

- **G3** — solo DUEÑO/SUPERVISOR/ADMIN aplican descuentos (`ROLES_DESCUENTO`; antes solo CAJERO bloqueado). Bloqueo de inputs en POS + validación dura en `registrarVenta` (ítem y global). SUPERVISOR limitado por `descuento_max_supervisor_pct` (ítem + global); DUEÑO/ADMIN sin tope. Config: campo "máx CAJERO" reemplazado por nota (cajero no aplica descuentos). Sin migración.
- **G5** (mig 161) — `productos.precio_usd` + `productos.moneda_venta` ('local'|'usd'). Form: select moneda + input USD + preview de conversión. POS: si `moneda_venta='usd'`, convierte a pesos a la cotización vigente al cargar (`precio_usd_origen` para el hint en el carrito). Venta física en USD/caja USD: diferida.
- Typecheck + build OK. `schema_full.sql` actualizado (productos precio_usd/moneda_venta). Deploy: PR dev→main + merge → Vercel PROD; release+tag v1.13.0.

---

## [2026-05-31] update | Ventas G1/G2 (mayorista por cantidad) + E3 (motivo cancelación) (DEV)

- **G1/G2** — el POS aplica precios mayoristas por **cantidad de la línea** (`producto_precios_mayorista`, infra que ya existía). `tiersMayoristaMap` (query) + helper `precioTierEfectivo(item)` (tier de mayor `cantidad_minima` ≤ cantidad; si no, minorista). Usado en `getItemSubtotal` y persistido en `venta_items.precio_unitario`. Indicador "Precio mayorista" en el carrito (minorista tachado). Sin migración. CartItem += `tiers`.
- **E3** — catálogo cerrado de motivo de cancelación de reserva (`MOTIVOS_CANCELACION_RESERVA`) + observación opcional. **Toda** cancelación de reserva ahora pasa por el modal (antes solo las que tenían seña); motivo obligatorio. Se guarda en `ventas.notas`. Sin migración.
- Typecheck + build OK.

---

## [2026-05-31] update | E2 reservas — redención del crédito a favor en POS (DEV)

Cierre de E2. La redención del saldo a favor quedó completa:
- POS: medio de pago **"Crédito a favor"** (visible si el cliente tiene saldo). Cuenta como pagado (cubre total + suma a `monto_pagado`) pero NO entra a caja (excluido de los 2 loops de `ingreso_informativo`). Al confirmar inserta consumo negativo en `cliente_creditos` (`origen='consumo_venta'`). Validación: no supera el saldo. Effect que trae el saldo al seleccionar cliente (`clienteCredito`).
- ClientesPage: query `creditoMap` (saldo por cliente) + badge "🎁 Saldo a favor $X" en la ficha.
- Typecheck + build OK. Sin migración nueva (usa `cliente_creditos` de mig 160).

---

## [2026-05-31] update | Relevamiento Ventas E/F/G — G4, F1, F5, bloque reservas (DEV)

Implementación de respuestas del relevamiento de Ventas (secciones E/F/G), sin deployar a PROD aún.

- **G4** — `src/lib/permisosCosto.ts` (`puedeVerCosto`). Costo y margen ocultos para CAJERO/DEPOSITO en `ProductosPage` (cards, panel expandido, botón Orden de Compra) y `ProductoFormPage` (precio de costo, margen actual, margen objetivo, precio sugerido). El POS no exponía costo. Sin migración.
- **F1** — botón "Actualizar presupuesto" on-demand en el detalle (presupuestos no vencidos): recrea con precios actuales y resetea el contador de validez. La config `presupuesto_validez_dias` ya existía.
- **F5** (mig **159**) — correlativo independiente de presupuestos `PRES-{cod}-NNNN` por sucursal. `ventas.presupuesto_numero` + `presupuesto_numero_sucursal`, trigger `gen_venta_numero` extendido + backfill (deshabilitando `trg_ventas_cierre` durante el UPDATE). `formatTicket` muestra el prefijo PRES.
- **E6 + E1** (mig **160**) — `tenants.reserva_sena_obligatoria` + `reserva_sena_minima_pct` (validación al reservar, ambos paths) + `reserva_vencimiento_dias` (NULL=sin venc.) + `ventas.reservado_at`. Función `liberar_reservas_vencidas(tenant)` libera stock reservado + cancela las vencidas (NO toca dinero, saltea período cerrado por reserva). Sweep lazy al entrar a Ventas. Config UI nueva en ConfigPage → Ventas → Operativa → "Reservas".
- **E2 parcial** (mig **160**) — cancelación de reserva con seña: penalidad % (`reserva_penalidad_pct`) + elección devolución / crédito a favor. Tabla `cliente_creditos` (ledger, saldo = SUM(monto)). Gate E4: solo DUEÑO/SUPERVISOR/ADMIN cancelan reserva con seña. **Pendiente**: redención del crédito en POS + saldo a favor en ficha del cliente.
- **G1/G2** confirmado por GO: mayorista por **cantidad de unidades del producto**. Hallazgo: `producto_precios_mayorista` (tiers) ya existe; falta aplicarlo en el POS. Queda en backlog.
- Typecheck + `vite build` OK. Migrations 159+160 aplicadas en DEV. `schema_full.sql` actualizado (gen_venta_numero + columnas ventas).

---

## [2026-05-31] update | v1.11.6 PROD — ISS-127: GS1 QR Code como 3ª simbología

Pedido GO al cierre. Los perfiles de códigos compuestos ahora soportan **GS1 QR Code** además de GS1-128 y DataMatrix.

- `bwip-js` bcid `gs1qrcode` (confirmado; `gs1-qrcode` con guión NO existe). `CodigoCompuestoModal` y `CodigoMasivoModal`: mapa de bcid por simbología + solo el 1D (GS1-128) lleva height/texto. `CodigoPerfilesPanel`: opción "GS1 QR Code (2D)" en el select + label en la lista. Tipo `simbologia` += `'qr'`. Sin migración (la columna es TEXT libre).
- Typecheck + build OK. Bump v1.11.6. Wiki: `escaneo-barcode.md`, `project_pendientes.md`, `log.md`, `roadmap.md`.

---

## [2026-05-31] update | v1.11.5 PROD — ISS-127 Códigos compuestos GS1 COMPLETO (F3c/d/e)

Cierre de ISS-127. Deploy a PROD como v1.11.5 (mig 157+158 aplicadas en DEV y PROD).

- **F3c — Recepciones**: botón de scanner en el buscador (`handleScanRecepcion`) → `agregarProducto(prod, {nro_lote, fecha_vencimiento, cantidad_recibida})` con datos del GS1.
- **F3d — Rebaje + modo directo**: el scanner compartido ya identifica el producto por GTIN; `pendingRebaje` + effect auto-seleccionan la **línea por lote** y setean cantidad. Modo `directo`: `pendingDirectoIngreso` + `directoFiredRef` + effect auto-crean el LPN cuando el form queda completo (perfil con `lectura_modo='directo'`).
- **F3e — Generación masiva**: `CodigoMasivoModal` — seleccionando varios LPNs en Inventario, botón "Etiquetas GS1" genera la hoja imprimible con todos los códigos (marca los sin GTIN válido).
- Typecheck + `vite build` OK. Bump v1.11.5. Wiki: `escaneo-barcode.md`, `roadmap.md`, `project_pendientes.md`, `log.md`.

---

## [2026-05-30] update | ISS-127 F3 (parcial) — DataMatrix lectura (ZXing) + Ventas/POS + cierre PR Dependabot #129

- **PR Dependabot #129 cerrado**: bump de vite a 8 incompatible con el peer de @vitejs/plugin-react@4 → build rojo, no aplicable. Vulns involucradas son dev-server only (cluster vite/esbuild, diferido). Rama aislada, no afectaba dev/main.
- **F3a — DataMatrix lectura**: `@zxing/library` restringido a DATA_MATRIX como fallback en `BarcodeScanner`. Se carga/ejecuta solo cuando el primario no cubre data_matrix (zbar activo o BarcodeDetector sin soporte), throttle 1/3 frames, vía `HTMLCanvasElementLuminanceSource`. Audit sin vulns nuevas.
- **F3b — Ventas/POS**: `procesarScan` usa `resolverScanCompuesto` → identifica producto por GTIN (fallback codigo_barras) + suma la cantidad del AI 30 en el incremento del carrito.
- **Fixes previos en este bloque**: AI cantidad 37→30, validación de GTIN (gtinCheckDigit/isValidGtin) con sugerencia del dígito correcto, mensajes GS1 accionables, y DataMatrix sin `height:undefined`.
- Typecheck + build OK. Pendiente F3: Recepciones (scanner propio) + Rebaje (lote→LPN) + modo directo + generación masiva.

---

## [2026-05-30] update | ISS-127 fix — AI cantidad (37→30) + validación GTIN + errores claros (QA GO)

Fixes tras prueba de GO al generar un código desde un LPN.

- **AI de cantidad 37→30**: (37) "count of trade items" requiere contexto logístico GS1 (00/02) → bwipp tiraba `GS1missingAIs`. El correcto para "cantidad de unidades" suelto es **(30)**. `buildGS1ElementString` ahora emite siempre (30) para cantidad; `AIS_SOPORTADOS` y defaults pasan a 30. Perfiles existentes en DEV migrados (37→30) + default de la columna `codigo_perfiles.ais` actualizado (mig file + schema_full).
- **Validación de GTIN**: `gs1.ts` += `gtinCheckDigit` + `isValidGtin`. El modal valida el GTIN antes de bwip-js y, si el dígito verificador está mal, **avisa el dígito correcto** (ej: barcode `0378912345689` inválido → "el correcto sería 8"). Antes salía el críptico `GS1badChecksum`.
- **Mensajes accionables**: falta de GTIN en el producto / perfil sin (01) / checksum → mensajes en español que dicen qué corregir, en vez del error de bwipp.
- Typecheck OK. Aún en DEV (F1+F2+fix sin deployar).

---

## [2026-05-30] update | ISS-127 F2 — lectura GS1 en ingreso (individual + masivo) — en DEV

Fase 2 del subsistema GS1: leer un código compuesto en el ingreso de stock y autocompletar. En DEV sin deployar (sigue a F1).

- **`gs1.ts → looksLikeGS1`**: distingue GS1 compuesto de EAN/SKU plano (prefijo simbología / FNC1 / AI 01+14díg+datos). **Crítico** para no parsear un EAN como GS1. Testeado: EAN-13/SKU→plano, GS1 variantes→GS1.
- **`src/lib/scanCompuesto.ts → resolverScanCompuesto`**: parseo + match del producto por GTIN (normalizaciones 14/13/sin-ceros) con fallback a `codigo_barras`; resuelve `lectura_modo` (perfil del proveedor → perfil único → autocompletar). Devuelve null si no es GS1 (caller cae a búsqueda plana).
- **InventarioPage**: `handleBarcodeScan` (ingreso individual) → selecciona producto + autocompleta lote/venc/cantidad. `handleMasivoScan` + `addMasivoRow(prod, overrides)` (masivo) → fila con lote/venc/cantidad pre-cargados.
- **Rebaje NO incluido**: no tiene scanner propio y requiere resolución lote→LPN → movido a F3 junto con modo `directo`.
- Typecheck OK. Wiki: `escaneo-barcode.md`, `project_pendientes.md`, `log.md`.

---

## [2026-05-30] update | ISS-127 F1 COMPLETA — códigos compuestos GS1: lib + Config perfiles + generación desde LPN — en DEV

Subsistema de códigos compuestos GS1 (relevado con GO, diseño en `project_pendientes.md`). **Fase 1 — fundación, completa y con build OK**. En DEV sin deployar.

- **Migrations 157+158** (DEV): `codigo_perfiles` (perfiles GS1/custom: proveedor_id, tipo, simbologia, ais, custom_format, lectura_modo) + `productos.gtin` (fallback a codigo_barras).
- **`src/lib/gs1.ts`**: parser + encoder GS1 testeado (round-trip OK). `parseGS1` (FNC1/GS, strip prefijo simbología, AIs fijos/variables, YYMMDD incl. día 00→último del mes, precio 392x con decimales), `buildGS1ElementString` (paréntesis para bwip-js), `normalizeGtin`, `AIS_SOPORTADOS`. AIs: 01/10/17/11/21/37/30/392x.
- **`bwip-js@4`** (genera GS1-128 + DataMatrix). `npm audit` sigue en 5 moderate.
- **`CodigoPerfilesPanel`** → Config → Inventario → **Códigos**: CRUD de perfiles (nombre, proveedor, tipo, simbología, AIs por chips, modo lectura, activar/desactivar).
- **`CodigoCompuestoModal`** → botón en `LpnAccionesModal` (al lado del QR): genera el código compuesto con los datos reales del LPN (lote/venc/cantidad/serie/precio + GTIN del producto) según el perfil elegido. Descargar/imprimir.
- Typecheck + `vite build` OK. Wiki: `escaneo-barcode.md`, `migraciones.md`, `schema_full.sql`, `project_pendientes.md`, `log.md`.
- **Pendiente F2**: lectura en ingreso/rebaje (autocompletar/directo). **F3**: DataMatrix lectura (ZXing) + ventas/recepciones + masiva.

---

## [2026-05-30] update | v1.11.4 PROD — Reservas: selección manual de LPN persistida (mig 156) + anti-patrón stock_actual confirmado resuelto

Cierre del "anti-patrón de reservas". Hallazgo: el rótulo del wiki estaba desactualizado.

- **(b) `stock_actual` manual en reserva→despacho**: **ya estaba resuelto desde v1.11.0** (`cambiarEstado` no toca `stock_actual`, lo deja al trigger y reconstruye con `stockVendibleSucursal`). Era el que causaba desync; ya no existe. Corregido el wiki.
- **(a) selección manual de LPN no persistía en reservas** (lo que sí quedaba): **mig 156** `venta_items.lpn_plan JSONB`. `registrarVenta` ya honraba el plan al crear la reserva (`consumirLinea` Fase A/B) pero no lo persistía → al despachar la reserva, `cambiarEstado` re-ordenaba por sort e ignoraba el LPN elegido. Ahora: el plan `[{linea_id,lpn,cantidad,manual}]` se guarda en `venta_items`; `cambiarEstado` (reservar + despachar) lo honra (Fase A) + autocompleta por sort si cambió el stock (Fase B), con `origen` manual/auto en el desglose. `cantidad_reservada` cuadra porque reserva y despacho usan las mismas líneas. Sin impacto en cantidades (solo trazabilidad fina). Aditiva: venta directa / series / legacy quedan NULL.
- Typecheck OK. Mig 156 aplicada en DEV + `schema_full.sql`. Wiki: `project_pendientes.md`, `migraciones.md`, `log.md`.

---

## [2026-05-30] update | Seguridad deps (npm audit 13→5) + restyle visual (fondo slate + scrollbars) — deployado en v1.11.4

Deployado a PROD como parte de v1.11.4 (junto con reservas mig 156).

- **npm audit**: de 13 vulnerabilidades a **5** (todas las restantes son dev-server: vite/esbuild/uuid, requieren vite@8 major — diferido). Resueltas las de riesgo real: `jspdf` 2→4 (crítica: ReDoS/XSS/path traversal), `jspdf-autotable` 3→5, `dompurify` (transitiva de jspdf), `xlsx` reemplazado por la distribución oficial de SheetJS (`xlsx-0.20.3` desde CDN, el paquete de npm está abandonado y sin fix). +fixes transitivos seguros (@babel, fast-uri, brace-expansion, ws). **Build de prod OK.** jspdf usa solo APIs estables (`new jsPDF({...})`, `autoTable(doc,{...})`, `internal.pageSize`) → bajo riesgo; verificar visualmente un PDF antes de deploy.
- **Restyle visual** (`index.css`): fondo de pantalla `--ds-page` `#F5F0FF` (lila) → **`#F8FAFC`** (slate frío, look tech). Scrollbars: el light mode usaba el gris default del navegador → ahora **pill flotante fino con tinte violeta de marca** (light+dark+Firefox). Pedido GO de dar un toque más artístico/tecnológico.

---

## [2026-05-30] update | v1.11.3 PROD — cierre Trazabilidad-extendida: devoluciones + recall por producto

Cierre de los pendientes futuros de la Trazabilidad-extendida. **Solo código** (usa columnas de mig 155 ya en PROD). Deployado a PROD (PR #127, release v1.11.3).

- **Devoluciones en `/historial`**: antes la mutación de devolución (`VentasPage`) no llamaba `logActividad` → las devoluciones no aparecían. Ahora cada ítem reintegrado emite una fila `tipo_transaccion='devolucion'`, agrupadas por `transaccion_id` (1 por devolución), con `producto_id` + LPN de la nueva línea (no-serie) → entran al recall de la unidad. Render legible (`describir` campo `devolución` → "Devolvió N u de Venta #X").
- **Clasificación de estados**: la transición `cambiarEstado` (reserva→despacho, venta→devuelta) ahora tag `tipo_transaccion` (`venta`/`devolucion`) + `sucursal_id`.
- **Recall por producto**: `HistorialPage` suma input "Producto (nombre o SKU)" al panel "Trazá una unidad". Resuelve nombre/SKU → `producto_id` y cruza tanto los snapshots `producto_id` del ledger (`.or(producto_id.in.(...),entidad_nombre.ilike)`) como `venta_item_despachos.producto_id`. Incluido en el export.
- Typecheck `tsc --noEmit` OK. Wiki: `reportes-metricas.md`, `project_pendientes.md`, `roadmap.md`, `log.md`. Bump `APP_VERSION` v1.11.3.

---

## [2026-05-30] update | v1.11.2 PROD — Trazabilidad-extendida /historial grado WMS (mig 155) + aislamiento sucursal

Pedido GO: que `/historial` sea el hub único de trazabilidad para recall/auditoría, "igual o mejor que un WMS como Manhattan / Blue Yonder". Decisión de diseño consensuada: **ledger inmutable con `transaccion_id` write-time**, NO heurística read-time (frágil/no auditable). **Deployado a PROD como v1.11.2** (mig 155 aplicada en DEV y PROD; release junta también el aislamiento por sucursal v1.11.2-candidato: guard setSucursal + rótulo stock global).

- **Mig 155** (`155_actividad_log_ledger.sql`, aditiva): `actividad_log` += `transaccion_id`, `tipo_transaccion`, `producto_id`, `lpn`, `nro_serie`, `lote`, `sucursal_id` (todas nullables/snapshot). Sin backfill: filas legacy quedan con `transaccion_id` NULL = evento único. Índices por transacción + unidad (producto/lpn/serie). Aplicada en DEV + `schema_full.sql`.
- **logActividad** (`actividadLog.ts`): nuevos campos opcionales + helper `nuevaTransaccion()` (`crypto.randomUUID()`). Tipo `TipoTransaccion`.
- **Call-sites**: `LpnAccionesModal` edición de LPN ahora genera **1 `transaccion_id`** para todas las filas (antes hasta 7 sueltas) + clasifica `tipo_transaccion` y snapshots (lpn/serie/lote) en traslado/eliminación/serie. `InventarioPage` ingreso/rebaje y `VentasPage` creación de venta también clasifican tipo + snapshots.
- **HistorialPage (3 fases)**: (1) **consolida** filas por `transaccion_id` en 1 tarjeta ("Editó LPN X — N cambios") con detalle campo por campo en el modal (cabecera+detalle); (2) **filtro recall** "Trazá una unidad" por LPN/serie que cruza `actividad_log` + `venta_item_despachos` y muestra la historia completa sin paginar; (3) **export** del set filtrado completo (hasta 10k filas) con columnas del ledger. Nuevo filtro "Transacción" (tipo WMS).
- Typecheck `tsc --noEmit` OK. Wiki: `reportes-metricas.md`, `migraciones.md`, `project_pendientes.md`, `index.md`, `log.md`.
- **Pendiente futuro**: `transaccion_id` en devoluciones y reserva→despacho; filtro de unidad por `producto_id` además de LPN/serie.

---

## [2026-05-30] update | Aislamiento por sucursal + stock display Agregar Stock (en DEV, v1.11.2-candidato)

Cierre de sesión. Cambios en DEV **sin deployar a PROD** (esperan validación de GO → v1.11.2).

- **Display Agregar Stock/Rebaje**: en vista global "Todas" el form mostraba "Stock total" (global) sin aclarar; ahora rotula **"Stock total (todas las sucursales)"**. Con sucursal activa o destino elegido ya mostraba "Stock en sucursal". No es bug — es la vista global.
- **Aislamiento por sucursal (pedido GO)**: un usuario sin `puedeVerTodas` (CAJERO, roles no habilitados) no debe poder ver/operar otra sucursal. **Triple blindaje cliente**: (1) fijado a su sucursal al cargar (`effectiveSucursalId`), (2) selector de header oculto, (3) **nuevo guard en `setSucursal`** (`if (!get().puedeVerTodas) return`). Documentado en `multi-sucursal.md` → "Aislamiento por sucursal — enforcement".
- **Limitación marcada**: la RLS es por `tenant_id`, no por `sucursal_id` → el aislamiento real (a prueba de API directa) requiere **RLS por sucursal**. Agregado a `project_pendientes.md` (Deuda técnica) como pendiente grande.
- Commits en dev: rótulo stock (`9b18734a`), guard setSucursal (`71bec577`). Pendiente bump v1.11.2 + merge a main cuando GO valide.

---

## [2026-05-30] update | v1.11.1 PROD — patch ISS-075 (manual/auto + stock vendible + Inventario→Historial)

Patch correctivo tras QA de GO sobre v1.11.0. Sin migrations nuevas.

- **manual/auto correcto**: `CartItem.lpn_manual_ids` rastrea los LPN que el operador eligió en el picker; en el rebaje solo esos son `origen='manual'`, el resto del plan autocompletado es `auto`. Antes todo salía `manual`.
- **Stock del movimiento de venta = vendible por sucursal**: `stock_antes/despues` ahora usa `stockVendibleSucursal()` (estados `es_disponible_venta` + ubicación pickeable en la sucursal de la venta), no el total global del producto. Aplica en Fase 3 y en reserva→despacho (B1).
- **Bug de archivo equivocado**: el modal de "Inventario → Historial" lo dibuja `InventarioPage.tsx`, NO `MovimientosPage.tsx` (huérfana, `/movimientos`→`/inventario`). Se **eliminó** MovimientosPage (1221 líneas) y se agregó el desglose por LPN ("Surtido desde") al modal real. Regla [[feedback_mapear_mod_tab_a_ruta]].
- **Log de ingreso/rebaje manual**: portado a InventarioPage. Ingreso → `ingreso_stock` (destino: ubicación+LPN), rebaje → `rebaje_stock` (origen: ubicación+LPN), con cantidad+unidad.
- **Versión** `v1.11.1`. Migrations 153+154 ya estaban en PROD desde v1.11.0.

---

## [2026-05-30] update | v1.11.0 PROD — ISS-075 trazabilidad + ISS-151 CC + fix race rebaje + log de asignación

Release grande. Cierre de toda la sesión 075/151 + bugs encontrados en QA → PROD.

- **Feature log de asignación (mig 154)**: `venta_item_despachos.origen` (`manual`/`auto`) + `tenants.trazabilidad_asignacion` (toggle en Config → Inventario, default ON). El desglose ahora indica si cada LPN lo eligió el operador o la regla de rebaje.
- **Trazabilidad en /historial**: el detalle de una venta en HistorialPage trae `venta_items` + `venta_item_despachos` y muestra, por ítem, de qué LPN/ubicación/serie salió cada unidad (con `origen`). También en VentasPage (detalle) y MovimientosPage (detalle de movimiento de venta).
- **Fix race condition (crítico)**: `registrarVenta` procesaba las líneas del carrito en `Promise.all`. Con el mismo producto en 2 líneas, el rebaje se pisaba (race). Ahora **secuencial**. Además Fase 3 (y el B1 de reserva→despacho) **ya no actualizan `stock_actual` a mano** — lo hace el trigger `lineas/series_recalcular_stock` (`stock_actual = SUM líneas activas`). El update manual peleaba con el trigger y desincronizaba/doble-restaba.
- **Recalc global** de `stock_actual` corrido en DEV (113 productos, 0 desfasados) y en PROD post-deploy.
- **Versión** `v1.11.0` (feature). Migrations 153+154 aplicadas en PROD antes del merge ([[feedback_deploy_order_migrations_aditivas]]).
- Pendiente futuro: Trazabilidad-extendida (consolidar todas las transacciones en /historial) — ver `project_pendientes.md`.

---

## [2026-05-29] update | ISS-075 despacho por LPN (mig 153) + ISS-151 impl + fix BUG-LPN manual — todo en DEV

**ISS-075 — implementado en DEV** (mig 153 aplicada en DEV, pendiente PROD):

- **Migration 153** `153_venta_item_despachos.sql`: nueva tabla con desglose de despacho por LPN/ubicación de cada `venta_item` (fila por porción/línea o por serie). Snapshots de texto (`lpn`/`ubicacion_nombre`/`nro_serie`) intactos ante edición/borrado del LPN. RLS por tenant. Aplicada en DEV + `schema_full.sql`.
- **VentasPage `registrarVenta` (Fase 2)** + **transición reserva→despacho (`cambiarEstado`)**: acumulan y persisten `despachoRows` (fire-and-forget) con el detalle real de qué LPN/ubicación se consumió. Selects enriquecidos con `lpn`, `ubicacion_id`, `ubicaciones(nombre)`.
- **Modal detalle de venta**: query `venta-despachos` + render del desglose por ítem (`Nu · LPN · Ubicación` / `#serie · Ubicación`). Fallback al LPN único para ventas previas a la mig.
- **MovimientosPage**: ingreso/rebaje manual ahora se vuelcan al `actividad_log` con acciones nuevas `ingreso_stock`/`rebaje_stock` (origen/destino + ubicación + LPN). Renderizadas en HistorialPage (`ACCION_LABELS` + `describir()`).
- **LpnAccionesModal traslado**: diff enriquecido con ubicación de **origen** (antes solo LPN).
- **`actividadLog.ts`**: `AccionLog` += `ingreso_stock | rebaje_stock`.
- Corregido gotcha desactualizado en CLAUDE.md (`venta_items.linea_id` sí se escribe; desglose en `venta_item_despachos`).
- Typecheck `tsc --noEmit` OK. Wiki: `ventas-pos.md`, `reportes-metricas.md`, `migraciones.md`, `project_pendientes.md`, `index.md`.

**ISS-151 — implementado en DEV** (sin migración):
- `MixCajaChart` + `MetricasPage`: excluyen pseudo-métodos `Cuenta Corriente`, `Cancelación CC`, `Condonación CC` del mix de medios de pago (ya no distorsionan la ganancia). El cobro real de una CC (abono) agrega su método real y ése sí aparece.
- `ClientesPage`: el botón único "Cancelar deuda" se reemplaza por **Condonar** (write-off, tag `Condonación CC`, monto_pagado=total) y **Revertir** (deshace condonación, restaura monto_pagado a pagos reales). Ambos solo DUEÑO/SUPERVISOR/ADMIN. Las condonadas quedan visibles en la lista CC con badge + botón Revertir. Ninguna acción toca estado de entrega ni stock (P4).
- Helper `esCondonadaCC()` + constante `TAGS_CONDONACION_CC` (incluye el legacy `Cancelación CC`).

**BUG-LPN — corregido en DEV**: la selección manual de LPN en el carrito se ignoraba en el rebaje real (Fase 2 re-ordenaba por sort). Fix: rebaje en 2 fases (A: honra `lpn_fuentes` con cantidades exactas; B: fallback por sort). Limitación: reserva→despacho aún rebaja por sort (no persiste selección manual). Detalle en `project_pendientes.md` → BUG-LPN.

**Config**: tenant DEV "Almacén Jorgito" tenía `cliente_obligatorio='siempre'` (bloqueaba venta directa sin cliente) → cambiado a `'nunca'`. Es config por tenant (ISS-142), no un bug de código.

Estado: **todo en DEV, sin deployar a PROD** (el usuario valida primero). Pendiente para PROD: bump versión (v1.11.0 — feature), aplicar mig 153 en PROD, merge `dev → main`, release ([[feedback_deploy_order_migrations_aditivas]]).

---

## [2026-05-29] update | v1.10.4 PROD — ISS-178 + C3/A7 → PROD

Cierre del tren acumulado en DEV (2 commits desde v1.10.3). Sin breaking change.

- **Migration 152 aplicada en PROD** pre-merge (validado: las 3 columnas no existían). Regla `feedback_deploy_order_migrations_aditivas`.
- **Bump APP_VERSION** a `v1.10.4` en `src/config/brand.ts`.
- **Merge `dev → main`** + release `v1.10.4` `--latest` en GitHub.
- Contenido: ISS-178 (rangos horarios de entrega — Config + VentasPage + EnviosPage), C3 parcial (CAJERO bloqueado para descuentos en POS), A7 (radio destino stock en modal devolución).

---

## [2026-05-29] update | Lote 6 — C3 + A7 del relevamiento Ventas

Dos puntos cerrados del relevamiento Ventas A-D (ver `G360.Wiki/sources/raw/relevamiento_ventas_respuestas.md`). Sin schema change, sin migration.

**C3 (parcial) — CAJERO bloqueado para descuentos** (`src/pages/VentasPage.tsx`)
- Nueva constante `descuentoBloqueadoCajero = user?.rol === 'CAJERO'`.
- 4 controles del POS quedan `disabled` con tooltip "Pedile al SUPERVISOR/DUEÑO": input descuento por ítem + toggle %/$ por ítem + input descuento general + toggle %/$ global.
- Labels muestran "— bloqueado para CAJERO" / "Bloqueado" y el contenedor se atenúa con `opacity-60`.
- Lo más complejo de C3 queda pendiente como feature mayor (descuentos automáticos por medio de pago + umbral por monto para SUPERVISOR).

**A7 — Destino del stock en devolución** (`src/pages/VentasPage.tsx`)
- Nuevo estado `devDestinoStock: 'dev' | 'vendible'` (default `'dev'`). Reset al abrir el modal.
- Radio en el modal de devolución debajo del campo Motivo con 2 opciones: "Dejar en DEV para revisión" (default — flujo previo, va a `ubicDevId`/`estadoDevId`) y "Reintegrar a stock vendible" (`ubicacion_id: null` + `estado_id = primer estados_inventario.es_disponible_venta`, aparece en alerta "Inventario sin ubicación").
- Solo afecta a items no serializados; los serializados siempre reactivan a su línea original.
- Validación: si elige "vendible" pero no hay estado `es_disponible_venta = true` configurado, toast de error sugiriendo cargarlo o elegir "Dejar en DEV".

Wiki: `ventas-pos.md` (sección C3 dentro de Descuentos), `devoluciones.md` (sección A7 nueva en Flujo de devolución), `project_pendientes.md` (Lote 6 en historial), `index.md`.

---

## [2026-05-29] update | ISS-178 — rangos horarios de entrega configurables (mig 152)

Feature acotada, sin dependencias externas. Habilita que el operador elija un rango horario predefinido (8-13 / 13-18 / 18-22) en lugar de tipear una hora exacta — más alineado con el flujo real de coordinación con clientes.

- **Migration 152** (`152_envios_rangos_horarios.sql`): `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos + `envios.rango_horario_desde/hasta TIME` (snapshot). Aplicada en DEV.
- **ConfigPage tab Envíos**: nueva card "Rangos horarios para entrega" con CRUD inline (agregar, editar via inputs `<input type="time">`, eliminar). Defaults visibles inmediatamente.
- **VentasPage modal de envío**: selector "Rango horario" al lado del campo "Fecha de entrega acordada". Reset post-venta.
- **EnviosPage**: form de edición agrega selector "Rango horario" junto a "Hora acordada" (coexisten). Tabla muestra el rango como badge accent debajo de la fecha. Reconstrucción del `idx` matcheando `desde+hasta` contra la config actual del tenant.
- Wiki: `envios.md` sección nueva en Configuración, `migraciones.md` entrada 152, `project_pendientes.md` (ISS-178 removido de features grandes, agregado a Lote 5), `index.md`.

Pendiente PROD: aplicar mig 152 antes del merge `dev → main` ([[feedback_deploy_order_migrations_aditivas]]).

---

## [2026-05-29] update | v1.10.3 PROD — ISS-194 caja fuerte + RRHH-A5 + 3 bugs UX → PROD

Cierre del tren acumulado en DEV (3 commits desde v1.10.2). Sin breaking change.

- **Migration 151 aplicada en PROD** pre-merge (UNIQUE parcial `empleados(tenant_id, user_id)`). Validado sin duplicados antes (regla `feedback_deploy_order_migrations_aditivas`).
- **Bump APP_VERSION** a `v1.10.3` en `src/config/brand.ts`.
- **Merge `dev → main`** + release `v1.10.3` `--latest` en GitHub.
- Contenido: ISS-194 (caja fuerte default solo DUEÑO + toggles), RRHH-A5 (selector usuario en form empleado), ISS-080 (alertas filtra por sucursal), ISS-108 (selector sucursal mobile), ISS-148 (UbicacionPicker en Recursos).

---

## [2026-05-28] update | lote 3 bugs UX — ISS-080, ISS-108, ISS-148

Lote de 3 bugs/mejoras de baja complejidad enfocadas en multi-sucursal y UX. Sin schema change.

- **ISS-080** (`src/pages/AlertasPage.tsx`): AlertasPage ahora filtra por sucursal activa **todas** las secciones. Las queries con `sucursal_id` ya filtraban (reservas viejas, OCs, LPN, inventario). Las 2 que no tenían columna (`alertas` y `productos sin categoría`) ahora cruzan client-side: para stock mínimo se suma `inventario_lineas.cantidad` del producto en la sucursal (JOIN a `ubicaciones.sucursal_id`) y se compara con `producto_stock_minimo_sucursal` o el global. Para sin categoría, se muestran solo los que tienen al menos una `inventario_lineas` activa en la sucursal.
- **ISS-108** (`src/components/layout/AppLayout.tsx`): Header mobile (< 640px). Bloque nuevo `sm:hidden` con ícono `Building2` + nombre de sucursal truncado. Si `puedeVerTodas`, `<select>` transparente superpuesto que permite cambiar con un tap. Antes el bloque era `hidden sm:flex` y desaparecía por completo en celular.
- **ISS-148** (`src/pages/RecursosPage.tsx`): Nuevo componente interno `UbicacionPicker` reemplaza al `<input>` libre en los 3 puntos donde se elegía ubicación: form crear/editar recurso, modal "Asignar ubicación" del tab Ubicaciones, edit inline. Opciones derivadas del histórico (`recursos.ubicacion` distinct, filtrado por sucursal vía `applyFilter`) + opción especial "+ Nueva ubicación..." para typing puntual. Sin schema change ni tabla catálogo.

Wiki: `alertas.md` (sección ISS-080 reemplaza la nota anterior), `recursos.md` (sección ISS-148 en Ubicaciones), `multi-sucursal.md` (selector mobile actualizado), `project_pendientes.md` (los 3 marcados como Resueltos, nuevo Lote 4 en historial).

---

## [2026-05-28] update | RRHH-A5 — vinculación empleado ↔ usuario del sistema (UI + migration 151)

Pendiente histórico de RRHH cerrado. Habilita "Mi Equipo" del SUPERVISOR sin scripts SQL manuales.

- **Migration 151** (`151_empleados_user_id_unique.sql`): índice UNIQUE parcial `empleados(tenant_id, user_id) WHERE user_id IS NOT NULL`. Aplicado en DEV. Garantiza el invariante que asume `get_supervisor_team_ids()` (1 user ↔ 1 empleado por tenant).
- **`src/pages/RrhhPage.tsx`**:
  - Nueva query `tenantUsers` (id, nombre_display, email, rol) por tenant, enabled solo en tabs empleados/equipo.
  - Selector "Usuario del sistema (opcional)" en el form de empleado, después de supervisor. Listado ordenado por nombre, deshabilita los users ya tomados por otro empleado mostrando "ya vinculado a …".
  - Validación cliente en `handleGuardarEmpleado`: rechaza guardar si el `user_id` elegido pertenece a otro empleado.
  - Columna nueva **Usuario** en la tabla de empleados con badge `UserCheck + nombre_display`.
- **schema_full.sql**: índice 151 documentado y FK `empleados.supervisor_id` corregido de `users(id)` → `empleados(id)` (estaba desactualizado desde migration 147).
- **Wiki**: `features/rrhh.md` sección nueva "Vinculación empleado ↔ usuario del sistema (RRHH-A5)". Pendiente removido de `project_pendientes.md`. Index sin cambios estructurales.

Pendiente PROD: aplicar migration 151 antes del merge `dev → main` (regla `feedback_deploy_order_migrations_aditivas`).

---

## [2026-05-28] update | mantenimiento: trim CLAUDE.md + convención GRANT Supabase oct-2026

- **CLAUDE.md trimado**: eliminadas secciones informativas ya cubiertas en el wiki (Stack, Estructura, Planes, Env vars, Deploy, Dominios, Multi-tenant). Reducción ~1.7k tokens/sesión. Se conservaron solo reglas de comportamiento, gotchas de código y IDs de Supabase.
- **wiki/development/convenciones-codigo.md**: nueva sección "GRANT obligatorio en tablas nuevas" — a partir del 30 oct 2026 Supabase deja de auto-exponer tablas del schema `public`; toda migration con `CREATE TABLE` debe incluir `GRANT ... TO authenticated`.
- **wiki/database/migraciones.md**: warning insertado en "Reglas de trabajo con migraciones" con el SQL de GRANT y la fecha límite.

---

## [2026-05-28] update | ISS-194 — caja fuerte: solo DUEÑO por defecto (dev, pendiente PROD)

- `caja_fuerte_roles` default cambia de `['DUEÑO','SUPERVISOR','SUPER_USUARIO']` a `['DUEÑO']`.
- SUPERVISOR y SUPER_USUARIO aparecen ahora en la lista de toggles habilitables (junto a CAJERO/CONTADOR/DEPOSITO/RRHH). ADMIN no tiene acceso.
- Tenants existentes con el valor viejo guardado en DB conservan su configuración actual; deben desactivar manualmente desde Config → Caja.
- Commit `62997596` en dev. Pendiente deploy a PROD (sin migration, solo cambio de código).

---

## [2026-05-28] update | v1.10.2 — bugfixes ISS-152/173 + caja sin PDF automático → PROD

- **ISS-152**: `sesionesAbiertas` en GastosPage ahora incluye `sucursalId` en queryKey y filtra client-side. `cajasAbiertasOC` corrige filtro estricto. El "nuevo gasto" ya no muestra cajas de otras sucursales.
- **ISS-173**: `monto_pagado` al crear reserva con pago parcial usa suma real de medios no-CC. Corrige "Ya cobrado" cuando se cobró seña parcial.
- **Caja**: eliminada descarga automática de PDF al cerrar sesión. Disponible manual desde historial.
- Deploy: migrations 148-150 aplicadas en PROD, PR `dev→main`, release v1.10.2 como `--latest`.

---

## [2026-05-28] update | lote ISS-135/142/180/190 + migrations 148-150 (dev)

4 issues resueltos en 2 commits sobre `dev`, con 3 migrations aplicadas en DEV.

- **ISS-135**: `metodos_pago` ahora tienen `habilitado_ventas` + `habilitado_gastos` (migration 149). ConfigPage muestra toggles "POS" y "Gastos" por método. VentasPage y GastosPage filtran según el flag.
- **ISS-142**: `cliente_obligatorio` / `cliente_creacion_inline` / `cliente_datos_minimos` del tenant conectados al POS en VentasPage — ya no hardcodeados.
- **ISS-180**: `predefinida` en `unidades_medida` (migration 148). 6 unidades predefinidas seed-eadas por tenant. ConfigPage bloquea edición/borrado y valida duplicados antes de insertar.
- **ISS-190**: `monto_pagado` + `estado_pago` en `gastos` (migration 150). Badges "Sin pagar"/"Pago parcial" en tabla y mobile. Modal para registrar pago parcial con movimiento en caja.

Commits: `07d306c5` (ISS-135/142/180) · `9ba1e3f9` (ISS-190)

---

## [2026-05-28] update | lote ISS-140/141/149/152/172/173/177/179/181 — 8 bugfixes (dev)

8 issues resueltos en un solo commit sobre `dev` (`f96fd4d1`), sin deploy a PROD.

- **ISS-140/141**: Scrollbar oculto en sub-tabs Config (Ventas e Inventario) — `[scrollbar-width:none]`
- **ISS-149**: Descuento OC acepta `$` o `%` con toggle en GastosPage
- **ISS-152**: `cajasAbiertasOC` filtra por sucursal activa (client-side filter sobre join)
- **ISS-172**: Haversine km redondeado a entero para consistencia con Distance Matrix
- **ISS-173**: Label reserva: "Ya cobrado" → "Seña cobrada" cuando saldo > 0.5
- **ISS-177**: Campo $/km en VentasPage cambiado a solo lectura (div en lugar de input)
- **ISS-179**: Formulario crear Ubicación incluye todos los campos: sucursal, mono-SKU, dims WMS
- **ISS-181**: Reglas comprobante mutuamente excluyentes (radio) + texto descriptivo mejorado
- **ISS-194**: Confirmado ya implementado (toggle SUPERVISOR boveda en Config → Caja)

Pendientes del backlog: ISS-127, ISS-135, ISS-137, ISS-142, ISS-174, ISS-178, ISS-180, ISS-190 + 5 relevamientos.

---

## [2026-05-28] update | PROD deploy v1.10.1 — Cierre HITO v1.9.0 + quick wins Envíos + 10 bugfixes

Cierre del lote v1.10.1 con despliegue completo a PROD.

### Deploy
- **Migrations 143-147 aplicadas en PROD** pre-merge (regla `feedback_deploy_order_migrations_aditivas`):
  - 143: cron limpieza `envios.token_transportista` +30d
  - 144: tabla `envio_pod_fotos` + RLS + backfill (POD múltiples fotos)
  - 145: fix `pagar_nomina_empleado` (saldo con traspasos)
  - 146: `caja_traspasos.movimiento_origen_id` + `movimiento_destino_id`
  - 147: `empleados.supervisor_id` → FK a `empleados(id)` + `get_supervisor_team_ids()` reescrita
- **Merge `dev → main` resuelto** localmente (conflictos en wiki/brand/CajaPage por squash distinto del previo): `git checkout --ours` en cada caso porque dev ya tenía todos los cambios de main + lo nuevo de v1.10.1. Merge commit `98ca4427` en dev.
- **PR #119 mergeado a main** (squash, commit `842d7353`)
- **Vercel PROD auto-deploy** desde commit del merge — `dpl_BxMq3Zu9iKEoNjLBEus76jk5xfX5`
- **GitHub release v1.10.1** creada como `latest` sobre main → https://github.com/genesis360-app/genesis360/releases/tag/v1.10.1
- `app.genesis360.pro` sirve v1.10.1 una vez termine el build (~90s)

### Score final del lote v1.10.1
- Features cierre HITO v1.9.0: candado por fila + PDF cierre con snapshot ✅
- Quick wins Envíos: cron tokens + múltiples fotos POD ✅
- Bugfixes: 10 (ISS-182/183/184/195/150/186/193/156/175/176/185) ✅
- Resiliencia: ErrorBoundary instrumentado a Sentry + boundary por-ruta ✅
- Relevamientos abiertos: 5 HTMLs (Ventas/RRHH/Clientes/Compras/Envíos)

### Pendientes para próxima sesión
- Vincular `empleados.user_id` (UI) para reactivar "Mi Equipo" del SUPERVISOR — relevamiento RRHH A5
- Crash intermitente "Algo salió mal" en Gastos: esperando stack real del ErrorBoundary instrumentado
- Avanzar con U1-U9 / F1-F7 / M1-M5 (bugfixes UX + features chicas + medianas) cuando GO retome
- Responder los 5 relevamientos abiertos con socio

---

## [2026-05-27] update | v1.10.1-dev — Tanda de bugfixes (10 issues) + resiliencia ErrorBoundary

Continuación de la sesión v1.10.1. Mientras los relevamientos esperan respuesta, se atacó la lista de bugs críticos priorizada con GO. Todo en DEV, parte del lote v1.10.1 (no deployado).

### Bugfixes
- **ISS-182/183 (Gastos)**: `guardar()` y `confirmarGenerarFijo()` ahora validan comprobante obligatorio (según las 4 reglas del tenant) y que los medios de pago cubran exactamente el total con tipo definido. Antes dejaba crear gastos sin comprobante y con medios sin definir.
- **ISS-184 (RRHH)**: la mutation de empleados usa `.select()` con joins + optimistic update via `setQueryData` → el empleado aparece al instante (antes "No hay empleados" hasta F5).
- **ISS-195 (Gastos/Cierre)**: el panel de cierres no listaba nada porque el select pedía `users.email` (columna inexistente; el email vive en auth.users). Removido de `CierresContablesPanel`.
- **ISS-150 (Recepción)**: al recibir una OC ya pagada, el precio costo se muestra como label "OC pagada (no editable)" en vez de input.
- **ISS-186 (RRHH/Caja)** · migration 145: `pagar_nomina_empleado` calculaba saldo sin contar `ingreso_traspaso`/`egreso_traspaso`. La bóveda (que recibe por traspaso) daba "saldo insuficiente". Alineado con la lógica del frontend.
- **ISS-193 (Caja)** · migration 146: `caja_traspasos` ahora guarda `movimiento_origen_id`/`movimiento_destino_id`. Al corregir un traspaso recibido, se inserta el ajuste de la diferencia en la caja origen (si está abierta; si no, error claro). Traspasos viejos sin FK no se propagan.
- **ISS-156/175/176 (Envíos)**: el envío cuyo costo cobró el cliente en la venta nace `costo_pagado=true` (propio siempre; tercero si la venta se despachó). Tab Pagos Courier excluye `Envío propio`. `/transporte` valida pago: banner rojo + botones de avance deshabilitados si el costo está pendiente (`get_envio_by_token` ya exponía `costo_cotizado`/`costo_pagado`).
- **ISS-185 (RRHH)** · migration 147: `empleados.supervisor_id` re-apuntado de `users(id)` a `empleados(id)`. El organigrama se arma con empleados de RRHH. `get_supervisor_team_ids()` reescrita para mapear `auth.uid()` → `empleados.user_id` → `supervisor_id`. Selector de supervisor lista empleados (excluye al editado). Los 8 supervisor_id viejos (a users) se nulearon. **Mi Equipo del SUPERVISOR queda vacío hasta vincular `empleados.user_id`** (pendiente UI — relevamiento A5).

### Resiliencia (Heisenbug "Algo salió mal" reportado por GO)
- ErrorBoundary: antes solo `console.error`. Ahora reporta a **Sentry** (con componentStack) + muestra el mensaje del error + Sentry ID + botón "Copiar detalle". Esto permite diagnosticar los crashes intermitentes que GO reportó en Config→Estados/Grupos y Gastos.
- **Boundary por-ruta** en AppLayout (`<ErrorBoundary inline key={pathname}>` alrededor del `<Outlet />`): un crash de página ya no tumba toda la app — el menú sobrevive y al navegar se resetea.
- `GruposEstadosPage`: blindado `grupo_estado_items ?? []` (causa probable del crash en esa pantalla).
- **Pendiente diagnóstico**: el crash en Gastos no se identificó a ojo — necesita el stack real que el boundary ahora captura.

### Estado al cierre
- DEV: v1.10.1 con migrations 130-147
- PROD: v1.10.0 (143-147 pendientes)
- Lote v1.10.1 listo para PR `dev→main` cuando GO decida deployar

---

## [2026-05-27] update | v1.10.1-dev — Cierre HITO v1.9.0 + quick wins Envíos

Sesión paralela al relevamiento de Ventas/RRHH/Clientes/Compras/Envíos (HTMLs generados ayer, pendientes de respuesta). Se cerraron los últimos pendientes del HITO Cierre Contable v1.9.0 + 2 quick wins del backlog de Envíos.

### Cambios
- **VentasPage**: badge ámbar 🔒 "Cerrado" en cada fila del historial cuando la venta cae en periodo contable cerrado. Botón "Eliminar venta" en el modal de detalle reemplazado por banner amber "Periodo cerrado hasta YYYY-MM-DD — no editable" para evitar errores del trigger DB.
- **CajaPage**: badge 🔒 "Cerrado" junto al nombre de cada sesión cerrada del historial. Botón "Corregir movimiento" reemplazado por candado deshabilitado en movimientos de periodos cerrados.
- **CierresContablesPanel**: nuevo botón "Descargar PDF" en el bloque expandido de cada cierre. Genera A4 con header BRAND + datos fiscales del tenant + periodo + observaciones + tabla snapshot (Ventas/Gastos/Sueldos/OC con counts) + bloque resumen (Egresos totales + Resultado neto). Lee de `cierres_contables.totales JSONB` (no recalcula). `logActividad('cierre_contable','descargar_pdf',…)`
- **Cron limpieza tokens transportista** (migration 143): pg_cron `cleanup_envio_tokens_transportista` corre diario 07:00 UTC. Para envíos en `entregado`/`cancelado`/`devolucion` con +30 días, setea `token_transportista = NULL` para invalidar links públicos. Activo en DEV.
- **Múltiples fotos POD** (migration 144): tabla `envio_pod_fotos` con RLS por tenant + backfill automático desde `envios.pod_url`. Componente `PodFotosManager` con upload múltiple desde cámara/galería (`multiple` + `capture="environment"`), thumbnails con badge "Principal" en orden 0, botón eliminar con confirm + cleanup del storage path. Integrado en modal POD y modal de edición de envío (solo si `editId` existe). La primera foto sincroniza con `envios.pod_url` para retro-compat. Helper `handleFotoCapture` viejo de ISS-166 eliminado del archivo.

### Estado al cierre
- DEV: **v1.10.1** con migrations 130-144 aplicadas
- PROD: v1.10.0 (143-144 pendientes de deploy)
- Cierre HITO v1.9.0: 100% completo en DEV
- Relevamientos abiertos esperando respuesta del usuario (5 HTMLs)

### Pendiente próxima sesión
- PR `dev → main` con título `v1.10.1 — Cierre HITO + quick wins Envíos`
- Aplicar migrations 143 + 144 en PROD antes del merge (aditivas)
- GitHub release v1.10.1 como latest

---

## [2026-05-26] update | PROD deploy v1.10.0 — Pipeline Reglas Caja CERRADO

Cierre del pipeline completo de Caja con 6 versiones consecutivas (v1.9.1 → v1.10.0) en 2 días.

### Deploy
- **Migrations 136–142 aplicadas en PROD** (7 migrations aditivas idempotentes)
  - 136: cajas.moneda + cuentas_origen + cuenta_origen_id en metodos_pago/caja_movimientos + vw_boveda_cuentas + seed
  - 137: boveda_retiros + RLS solo DUEÑO/ADMIN/SUPER_USUARIO + backfill cuenta_origen_id
  - 138: auto-seed cuentas_origen por método no-efectivo
  - 139: backfill fuzzy con normalización (sin tildes/sin "de")
  - 140: caja_sesiones.abierta_por + tenants.config_caja JSONB + RPCs requiere_clave_maestra y verificar_clave_maestra
  - 141: caja_sesiones.numero correlativo + snapshot_totales + tenants.diferencia_caja_* + vw_diferencias_por_cajero
  - 142: vw_caja_resumen_diario + vw_caja_mensual_por_sucursal
- **PR #118 mergeado** en main (squash, commit `c857384b`)
- **Vercel PROD** auto-deploy en estado BUILDING (`dpl_SKeSdLV75LfW2u2cnMWuMq5vLBLe` desde commit del merge)
- **GitHub release v1.10.0** actualizada como **latest** apuntando a main
- `app.genesis360.pro` servirá v1.10.0 una vez termine el build (~90s)

### Score final del pipeline Caja
**8 de 8 decisiones críticas implementadas (100%)** ✅

Recorrido completo:
- v1.9.1 Tanda 1 (F1/H1/G2/D3): cajas por moneda + Cuentas de Origen + sin egreso manual + arqueo pre-cierre
- v1.9.2 Tanda 1.5 (E4/E5): bóveda como billetera + extraer dinero solo DUEÑO + historial privado
- v1.9.3 Fase 2.0 (J1/J3/B5/B6/A2/A4/C2): permisos + CONTADOR read-only + abrir a nombre de cajero + clave maestra + mail al cierre
- v1.9.4 Fase 2.1 (C1/C3/K2/K3/B1-B4): ticket cierre A4/térmico + numeración correlativa + snapshot + umbral diferencia + alertas configurables
- v1.9.5 Fase 2.2a (L1/L4/L5/B7/G1): selector caja devolución + bloqueo sucursal + cadena anulación + corregir movs + doble validación cierre
- v1.10.0 HITO Fase 2.4 (I1/I2): 4 reportes (diario/consolidado/mensual/por cajero) + 3 exports (Excel/PDF/CSV)

### Estado al cierre
- DEV: v1.10.0 con migrations 130-142
- PROD: v1.10.0 con migrations 130-142 ✅ (en deploy)
- **Pipeline Reglas Caja: CERRADO** (todas las decisiones priorizadas del relevamiento implementadas)
- Pendientes opcionales no críticos: Fase 2.2b (L3 préstamos RRHH), Fase 2.3 (M2/M3/M4 + E1/E3 + G5)

### Fixes adicionales en la sesión
- ConfigPage tab Facturación: toggle auto-guarda + botón datos fiscales + `setTenant(data)` para sincronizar store
- VentasPage: caja predeterminada se pre-selecciona automáticamente (useMemo en lugar de useEffect con race)
- VentasPage: medios de pago dinámicos desde tabla `metodos_pago` (eliminada constante hardcodeada con "Otro" genérico)
- Bóveda: backfill fuzzy de cuenta_origen_id + helper `cuentaOrigenDeMetodo` tolerante (lowercase + sin tildes + sin "de")

---

## [2026-05-26] update | v1.10.0-dev — HITO Caja Fase 2.4 — Reportes (I1/I2)

Cierre del pipeline de Reportes con 4 vistas + 3 exports (Excel/PDF/CSV).
**Versión mayor v1.10.0** marca el módulo Caja como completo en su pipeline de relevamiento (todas las features de A a M implementadas según las decisiones priorizadas del relevamiento).

### Migration 142 aplicada en DEV
- Vista `vw_caja_resumen_diario` — agregado por día/caja/sucursal · cierres count + cerrados + total apertura/ingresos/egresos/ventas + saldo_sistema + conteo_real + diferencia_total/absoluta. Excluye caja fuerte (where `NOT es_caja_fuerte`)
- Vista `vw_caja_mensual_por_sucursal` — agregado por mes/sucursal · sesiones + cerradas + ingresos/egresos/ventas + diferencia + cajas_activas + cajeros_distintos. Periodo = `DATE_TRUNC('month', abierta_at)::DATE`

### Frontend
- **Nuevo componente `src/components/CajaReportes.tsx`** (~330 líneas) — 4 sub-tabs:
  - **(a) Diario por caja** — usa `vw_caja_resumen_diario` filtrado por fecha + opcional sucursal
  - **(b) Diario consolidado** — agrega todas las cajas por fecha en frontend (sin nueva vista)
  - **(c) Mensual por sucursal** — usa `vw_caja_mensual_por_sucursal`
  - **(d) Por cajero** — usa `vw_diferencias_por_cajero` (ya existente desde v1.9.4) - últimos 30 días
- **Filtros**: fecha desde/hasta (todos los reportes excepto cajero) + selector sucursal (a + c) opcional
- **Tabla**: render dinámico desde array `columnas[]` con `COL_LABELS` y `COLS_MONETARIAS` para detectar columnas a formatear como dinero. Color rojo/verde en columnas de diferencia. Tfoot con totales si hay >1 fila
- **3 botones de export** en cada reporte:
  - **Excel** (xlsx): hoja Info + hoja Datos. Labels en español
  - **PDF** (jspdf + autoTable): landscape si hay >6 columnas. Header con BRAND + período
  - **CSV** con BOM utf-8 para Excel ES + escape de comillas
- **CajaPage**: nuevo tab `'reportes'` (icono 📊) visible para DUEÑO/SUPERVISOR/SUPER_USUARIO/CONTADOR. Type `Tab` ampliado

### Score final del relevamiento Caja
- **8 de 8 decisiones críticas implementadas (100%)** ✅
- **I1/I2 reportes**: ✅ los 4 reportes prioritarios respondidos en el relevamiento + 3 formatos de export

### Estado al cierre
- DEV: **v1.10.0** con migrations 130-142 aplicadas
- PROD: v1.9.0 (136-142 pendientes de deploy)
- **Pipeline Reglas Caja: CERRADO** (todas las respuestas A-M del PDF de relevamiento implementadas con sus features priorizadas)
- Quedan opcionales: Fase 2.2b (L3 préstamos RRHH), Fase 2.3 (M2/M3/M4 + E1/E3 + G5) — refinos no críticos

---

## [2026-05-26] update | v1.9.5-dev — Caja Fase 2.2a — Operaciones especiales (L1/L4/L5/B7/G1)

Implementación de Fase 2.2 — sin migrations nuevas (solo frontend + uso de tablas existentes).
**L3 (préstamos RRHH) diferido a Fase 2.2b** porque toca otro módulo.

### Cambios

**L4 — Bloqueo cambio de sucursal con caja propia abierta** (`AppLayout.tsx`)
- Nueva query `mis-cajas-abiertas-por-suc` que devuelve `sucursal_id` de cajas abiertas propias
- Wrapper `handleCambiarSucursal(newId)` que intercepta el `onChange` de los 2 selectores de sucursal
- Si user tiene caja en otra sucursal: confirm "Tenés caja abierta en X. Cerrala antes de cambiar" → opción "Ir a esa caja" navega a `/caja` con la sucursal correcta seleccionada

**L1 — Selector de caja para egreso efectivo en devolución** (`VentasPage.tsx`)
- Nuevo state `devCajaSesionId`
- Modal de devolución: si hay medio "Efectivo" con monto > 0 → bloque ámbar pide elegir caja (auto-elige si solo hay 1 sesión)
- Validación: bloquea si hay >1 sesión abierta y no se eligió
- `procesarDevolucion`: usa `devCajaSesionId || sesionCajaId` como destino del egreso + asigna `cuenta_origen_id` de Efectivo
- Reset de `devCajaSesionId` al abrir modal

**L5 — Cadena de anulación venta según estado** (`VentasPage.tsx`)
- En `cambiarEstado` (case `cancelada`): si la venta estaba `despachada` con cobro > 0 y NO hay caja abierta → throw con mensaje detallado sugiriendo "Devolver" o emisión de NC
- `onError`: detecta SQLSTATE P0001 / "periodo_cerrado" del trigger BD y muestra mensaje específico "Generá una nota de corrección desde Gastos → Cierres contables"

**G1 — Botón "Corregir" en movimientos manuales** (`CajaPage.tsx`)
- Nuevo state `corregirMov`, `corregirMonto`, `corregirConcepto`
- Nueva mutation `corregirMovimiento`: inserta `[Reversión] <original>` (tipo opuesto) + nuevo movimiento `[Corregido] <nuevo>` con valores actualizados + `logActividad` con audit trail (valor_anterior → valor_nuevo)
- Botón inline 🔄 visible solo si `puedeEditarMovimiento` (DUEÑO/ADMIN o SUPERVISOR con flag `supervisor_puede_editar_movimientos`)
- Filtros: solo en `tipo='ingreso'` sin `#venta` (manual puro) y excluye los que ya son `[Reversión]`, `[Corregido]` o `[Diferencia caja]`
- Modal de corrección con form (concepto + monto) y referencia visible del original

**B7 — Doble validación al cierre** (`CajaPage.tsx`)
- Flag opcional `config_caja.doble_validacion_cierre` (default false)
- Si activado, modal de cierre muestra inputs email + password adicionales
- Mutation `cerrarCaja`: crea cliente Supabase secundario (`persistSession: false`) que llama `signInWithPassword` sin romper la sesión actual del cerrador
- Valida: credenciales OK + 2do usuario ≠ cerrador + mismo tenant + rol DUEÑO/SUPERVISOR/ADMIN/SUPER_USUARIO
- Logs `signOut` del cliente temporal en todos los paths

**ConfigPage tab Caja — nueva sección "Permisos avanzados"**:
- 3 toggles: doble validación cierre (B7) · SUPERVISOR puede editar movs (G1) · SUPERVISOR puede ver bóveda (E2)
- Mutation `handleSaveConfigCaja` que merge dentro de `tenants.config_caja` JSONB y refresca store

### Score final
- **8 de 8 decisiones críticas del relevamiento implementadas (100%)** 🎉
- B7 era la única que faltaba — ahora implementada como opcional configurable

### Estado al cierre
- DEV: v1.9.5 con migrations 130-141 aplicadas (sin migration nueva en esta fase)
- PROD: v1.9.0 (136-141 pendientes)
- Pipeline Caja: Tanda 1+1.5 (v1.9.1-2) + Fase 2.0 (v1.9.3) + Fase 2.1 (v1.9.4) + Fase 2.2a (v1.9.5)
- Quedan Fase 2.2b (L3 préstamos RRHH), 2.3 (UX + bóveda detalles), 2.4 (HITO v1.10.0 reportes)

---

## [2026-05-26] update | v1.9.4-dev — Caja Fase 2.1 — Ticket cierre + Diferencias (C1/C3/K2/K3/B1-B4)

### Migration 141 aplicada en DEV
- `caja_sesiones.numero INT` con trigger `fn_set_caja_sesion_numero()` que asigna correlativo por sucursal en INSERT (K3) + backfill de 43 sesiones existentes con `ROW_NUMBER() OVER (PARTITION BY tenant_id, sucursal_id ORDER BY abierta_at)`
- `caja_sesiones.snapshot_totales JSONB` para almacenar el estado completo al momento del cierre (K2)
- `tenants.diferencia_caja_umbral DECIMAL(14,2)` (B1)
- `tenants.diferencia_caja_alerta_roles TEXT[]` default `['DUEÑO','SUPERVISOR']` (B2)
- `tenants.diferencia_caja_alerta_canales TEXT[]` default `['inapp','email']` (B3)
- Vista `vw_diferencias_por_cajero` con `security_invoker=true` — cierres_count + cierres_con_diferencia + diferencia_neta/absoluta_acumulada + maxima, últimos 30 días por cajero (B4)

### Frontend
- **CajaPage `cerrarCaja` (K2)**: calcula snapshot completo al cerrar — `montos` (apertura/ingresos/egresos/saldo/conteo/diferencia) + `totales_por_metodo` (agrupados de movimientos) + `ventas` (las que matchean #N en concepto) + `movimientos_manuales` (ingresos/egresos manuales) + `arqueos` de la sesión + `numero_cierre`. Persistido en `caja_sesiones.snapshot_totales`
- **CajaPage `cerrarCaja` (B4)**: si hay diferencia ≠ 0, inserta `caja_movimientos` tipo `ingreso`/`egreso` con concepto `[Diferencia caja] Sobrante|Faltante` asociado al `sesionActiva.usuario_id` (cajero responsable, no quien cerró)
- **CajaPage `cerrarCaja` (B1/B2/B3)**: si `Math.abs(diferencia) >= umbral` (o umbral=null), envía alerta a usuarios con rol en `diferencia_caja_alerta_roles` por canales `inapp` (notificaciones) + `email` (send-email EF). WhatsApp queda como TODO
- **CajaPage `imprimirCierre(sesion, formato)` (C1+C3)**: refactor completo
  - Formato `'a4'` (default): header con logo + datos fiscales del negocio (CUIT, domicilio) · tabla resumen · totales por método de pago (del snapshot) · listado ventas (top 25) · listado movimientos manuales (top 15) · espacio para 2 firmas · numeración correlativa `#NNNN` en pie
  - Formato `'termico'` (nuevo): jsPDF con tamaño custom 80mm × dinámico · diseño tipo ticket de caja registradora · centrado · líneas dashed · misma data condensada
- **CajaPage historial**: botón "Reimprimir PDF" reemplazado por 2 botones (A4 + Tícket) visibles solo si `puedeReimprimirTicket`
- **CajaPage historial**: nueva card "Diferencias por cajero (últimos 30 días)" para DUEÑO/SUPERVISOR/CONTADOR con tabla — cierres count + con diferencia + neto + absoluto + máxima
- **ConfigPage tab Caja**: nueva sección "Diferencias en cierre de caja" con input umbral + chips toggles para roles destinatarios + chips toggles para canales (inapp/email/whatsapp deshabilitado)
- **ConfigPage**: nueva mutation `handleSaveDif` con `setTenant(data)` para refrescar store
- **ConfigPage**: state `bizDifUmbral` / `bizDifRoles` / `bizDifCanales` inicializados desde tenant

### Wiki
- `wiki/database/migraciones.md`: entrada 141
- `wiki/business/roadmap.md`: entrada v1.9.4
- `wiki/features/caja.md`: nueva sección Fase 2.1
- `log.md` + `index.md` + `project_pendientes.md` actualizados

### Estado al cierre
- DEV: v1.9.4 con migrations 130-141 aplicadas
- PROD: v1.9.0 (136-141 pendientes)
- Pipeline Caja: Tanda 1+1.5 (v1.9.1-2) + Fase 2.0 (v1.9.3) + Fase 2.1 (v1.9.4)
- Score: **7 de 8 decisiones críticas del relevamiento implementadas (87.5%)** — falta B7 doble validación

---

## [2026-05-26] update | v1.9.3-dev — Caja Fase 2.0 — Permisos + Roles (J/B5/B6/A2/A4/C2)

Implementación de respuestas J-M del relevamiento Caja (con socio en `relevamiento-caja-reglas-negocio.pdf` + respuestas guardadas en `sources/relevamientos/caja_2026-05-25.md`).

### Migration 140 aplicada en DEV
- `caja_sesiones.abierta_por UUID REFERENCES users(id)` + backfill = usuario_id (A2: registra quien hizo la apertura, distinto del propietario)
- `tenants.config_caja JSONB DEFAULT '{}'` — config flexible de permisos opcionales por rol (supervisor_puede_ver_boveda, supervisor_puede_editar_movimientos, forzar_cierre_dia_anterior)
- RPC `requiere_clave_maestra(tenant, accion)` — centraliza B5: cerrar_caja_ajena | abrir_caja_diferencia | anular_venta | anular_movimiento
- RPC `verificar_clave_maestra(tenant, clave)` SECURITY DEFINER — compara sin exponer clave al frontend

### Frontend
- **Nuevo helper `src/lib/cajaPermisos.ts`** — matriz J3 completa con `puede(rol, accion, configCaja?)` + lista de acciones con clave maestra
- **ConfigPage** tab Caja: clave maestra **solo editable por DUEÑO (B6)** — disabled para SUPERVISOR/ADMIN/CONTADOR + badge "🔒 Solo DUEÑO puede modificarla" + texto expandido sobre cuándo se requiere
- **AppLayout**: CONTADOR ahora ve y puede acceder a `/caja` (read-only)
- **CajaPage**: permisos granulares aplicados — `puedeAbrirAjena`, `puedeOperarCaja`, `puedeReimprimirTicket`, `puedeEditarMovimiento`, `esSoloLectura`
- **CajaPage tab Caja**: si `esSoloLectura` (CONTADOR) → ocultas las acciones Ingreso/Arqueo/Bóveda/Traspaso y se muestra banner "Modo solo lectura"
- **CajaPage modal Apertura (A2)**: si DUEÑO/SUPERVISOR, selector "Abrir caja para" con la lista de cajeros del tenant. Si se selecciona otro, la sesión queda con `usuario_id = cajero` y `abierta_por = current_user`
- **CajaPage abrirCaja mutation**: validación adicional — si abre a nombre de otro, verifica que ESE cajero no tenga ya una sesión abierta
- **CajaPage banner A4**: detecta si user tiene sesión propia abierta hace más de 24h y muestra banner ámbar con CTA "Ir a esa caja →" para forzar cierre
- **CajaPage cerrarCaja (B5)**: si es cierre ajeno Y el tenant tiene `clave_maestra` configurada → modal pide input password + valida vía RPC `verificar_clave_maestra` antes de cerrar
- **CajaPage cerrarCaja (C2)**: CAJERO ya no descarga PDF al cerrar — solo DUEÑO/SUPERVISOR/CONTADOR lo descargan. Toast muestra "El DUEÑO recibirá el detalle por email" para CAJERO. Mail al DUEÑO via EF `send-email` con detalle del cierre (saldo, conteo real, diferencia, ingresos, egresos, notas)
- **CajaPage**: botón "Cerrar caja" oculto para CONTADOR

### Wiki
- `wiki/database/migraciones.md`: entradas 139 + 140 (también 139 que se había olvidado documentar)
- `sources/relevamientos/caja_2026-05-25.md`: respuestas J-M con estado de implementación
- `wiki/business/roadmap.md`: entrada v1.9.3 con Fase 2.0
- `index.md`: actualizado

### Estado al cierre
- DEV: v1.9.3 con migrations 130-140 aplicadas
- PROD: v1.9.0 (136-140 pendientes de deploy)
- Pipeline Reglas Caja: Tanda 1 (v1.9.1) + Tanda 1.5 (v1.9.2) + Fase 2.0 (v1.9.3) implementadas. Resta Fase 2.1 (Ticket+Diferencias), 2.2 (Operaciones especiales), 2.3 (UX+Bóveda detalles), 2.4 (Reportes - HITO v1.10.0)

### Score implementación
- ✅ **6 de 8 decisiones críticas del relevamiento implementadas** (75%)
- Pendientes: B7 doble validación cierre · I1/I2 reportes

---

## [2026-05-25] update | v1.9.2-dev — Caja Tanda 1.5 — Bóveda como billetera del negocio + Extraer dinero (E4/E5)

Cierra el goal del usuario: la bóveda funciona como billetera del negocio con TODO el capital categorizado por cuenta de origen (efectivo, débito, crédito, MP, transferencia, etc.). Solo el DUEÑO puede extraer dinero con registro privado.

### Migration 137 — `137_boveda_retiros_y_backfill.sql`
- Tabla `boveda_retiros(id, tenant_id, cuenta_origen_id, monto, tipo_retiro, motivo, notas, usuario_id, movimiento_id, created_at)` con CHECK `tipo_retiro IN (banco/retiro_personal/gasto/inversion/pago_proveedor/otro)`
- 3 índices (tenant+created_at, cuenta_origen_id, usuario_id)
- **RLS estricta**: USING/WITH CHECK exige rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') vía EXISTS en users — otros roles no ven ni el listado ni el detalle
- Backfill cuenta_origen_id en `caja_movimientos` históricos: match por concepto `[Nombre Método]` para ingreso/egreso informativo; cuenta tipo='efectivo' para ingreso/egreso/ingreso_traspaso/egreso_traspaso/ingreso_reserva/egreso_devolucion_sena/ingreso_apertura
- UNIQUE partial index `uq_cuentas_origen_efectivo_por_tenant` (garantiza 1 cuenta efectivo por tenant)

### Migration 138 — `138_cuentas_origen_seed_metodos.sql`
- Auto-seed: crea cuenta_origen por cada método de pago no-efectivo activo (Mercado Pago/UALA → billetera · Tarjeta/Transferencia → banco · resto → otro) usando moneda del tenant
- Vincula `metodos_pago.cuenta_origen_id` con la cuenta recién creada (match por nombre)
- Re-aplica backfill con conceptos históricos `[Nombre Método]` → cuenta_origen_id del método

### Frontend
- **CajaPage**: nuevo estado para modal Extraer (`extraerCuentaId`, `extraerMonto`, `extraerTipo`, `extraerMotivo`, `extraerNotas`) + `puedeExtraerBoveda = DUEÑO/ADMIN/SUPER_USUARIO`
- **CajaPage**: nueva query `boveda-retiros` con `enabled: puedeExtraerBoveda` (RLS bloquea a otros roles igualmente)
- **CajaPage**: nueva mutation `extraerDeBoveda` que valida saldo de cuenta, obtiene/crea sesión permanente de caja fuerte, inserta movimiento (`egreso_traspaso` si efectivo o `egreso_informativo` si banco/billetera) con `cuenta_origen_id`, e inserta registro en `boveda_retiros` con link al movimiento
- **CajaPage** tab Bóveda: nuevo botón "Extraer dinero" (rojo, ml-auto) solo para DUEÑO+
- **CajaPage** tab Bóveda: nueva sección "Historial de extracciones (privado)" con borde rojo, badge tipo, cuenta, motivo, notas, monto, fecha/hora y usuario — solo para DUEÑO+
- **CajaPage** tab Bóveda: eliminada card hardcodeada "Efectivo (caja fuerte)" basada en `fuerteSaldo` — ahora la card Efectivo viene de `vw_boveda_cuentas` (cuenta tipo='efectivo' única); única fuente de verdad
- **CajaPage** tab Bóveda: indicador "Capital del negocio · Total: $X" arriba a la derecha (solo DUEÑO+) sumando todas las cuentas activas
- **CajaPage** `operarCajaFuerte`: los 4 inserts de traspaso (depósito caja → fuerte + retiro fuerte → caja) ahora setean `cuenta_origen_id = id cuenta efectivo` para que la vista los considere
- **CajaPage** modal Extraer Dinero: pide cuenta (con saldo disponible en label), monto, tipo (6 opciones), motivo obligatorio, notas opcionales

### Datos validados en DEV (tenant `3769b1db`)
- Efectivo: $12.874.811 (86 movs)
- Mercado Pago: $37.228 (10 movs)
- Transferencia: -$958.749 (7 movs · negativo porque hay más gastos que ingresos en transferencia)

### Wiki
- `wiki/features/caja.md`: nueva sección "Bóveda como billetera del negocio — Tanda 1.5"
- `wiki/database/migraciones.md`: entradas 137 y 138
- `sources/relevamientos/caja_2026-05-25.md`: marcadas E4 y E5 como implementadas

### Estado al cierre
- DEV: v1.9.2 con migrations 130-138 aplicadas
- PROD: v1.9.0 (migrations 136-138 pendientes de deploy)

---

## [2026-05-25] update | v1.9.1-dev — Reglas Caja Tanda 1 (moneda + Cuentas de Origen + bóveda discriminada)

Implementación de respuestas A-I del relevamiento de Caja (con socio en `relevamiento-caja-reglas-negocio.pdf` + respuestas guardadas en `sources/relevamientos/caja_2026-05-25.md`).

### Migration 136 aplicada en DEV
- `cajas.moneda TEXT NOT NULL DEFAULT 'ARS'` + índice + seed desde `tenants.moneda` (23 cajas existentes asignadas)
- Tabla `cuentas_origen(id, tenant_id, nombre, tipo, banco, numero, alias, moneda, activo, notas)` con CHECK `tipo IN (banco/billetera/efectivo/otro)` + RLS tenant
- Seed de 1 cuenta `Efectivo` por tenant (7 cuentas creadas) + auto-asociación al método de pago "Efectivo" (5 métodos vinculados)
- `metodos_pago.cuenta_origen_id` FK → cuentas_origen ON DELETE SET NULL
- `caja_movimientos.cuenta_origen_id` FK opcional + índice parcial
- Vista `vw_boveda_cuentas` con `security_invoker=true` → saldo neto por cuenta calculado de `caja_movimientos`

### Frontend
- **ConfigPage** tab Caja: nueva sección "Cuentas de Origen" con ABM completo (alta inline + edición inline + toggle activo + eliminar con guard de FK 23503)
- **ConfigPage** tab Ventas → Métodos de pago: selector "Cuenta de origen default" en cada método + badge `→ Cuenta` en modo display
- **VentasPage**: nueva query `metodos_pago_cfg` + helper `cuentaOrigenDeMetodo(nombre)` aplicado en los 5 puntos de insert informativo (despacho, seña reservada, seña en updateVentaEstado, despacho desde reservada, devolución seña cancelada)
- **GastosPage**: misma query + helper aplicado en los 5 puntos de insert (OC, edición gasto borrador, gasto nuevo caja fuerte/normal, reversión por eliminación, gasto fijo generado)
- **CajaPage** tab Bóveda: cards de saldos discriminados — card Efectivo (caja fuerte tradicional) + 1 card por cada `cuenta_origen` activa con icono por tipo + saldo + count + moneda + empty state que invita a Config
- **CajaPage** modal Nueva Caja: selector de moneda obligatorio (default = `tenant.moneda` o `'ARS'`)
- **CajaPage** selector pílulas: badge `MONEDA` cuando difiere de la del tenant
- **CajaPage** lista en tab Configuración: badge `MONEDA` siempre visible junto al nombre
- **CajaPage** modal movimiento manual: solo registra ingresos (eliminado `setMovTipo`, `movTipo` queda como constante `'ingreso'`), texto guía explica que los egresos pasan por Gastos
- **CajaPage** botón "Cerrar caja": cuando `arqueosSesion.length === 0` se muestra como "Arqueo requerido antes de cerrar" (amber, abre modal de arqueo); mutation `cerrarCaja` valida con throw si no hay arqueos previos

### Wiki
- Nueva página `sources/relevamientos/caja_2026-05-25.md` con respuestas A-I + recomendación B4 + decisiones críticas pendientes
- `wiki/features/caja.md`: nueva sección "Reglas relevadas — Tanda 1 (v1.9.1)" con F1, H1, G2, D3 + listado de pendientes para próximas tandas
- `wiki/database/migraciones.md`: entrada 136
- `index.md`: descripción Caja actualizada + pie con nuevo conteo y estado de relevamiento
- PDF generado en raíz: `relevamiento-caja-reglas-negocio.pdf` (50 preguntas, 14 secciones) — A-I respondidas, J-N pendientes

### Estado al cierre
- DEV: v1.9.1 con migrations 130-136 aplicadas
- PROD: v1.9.0 (migration 136 pendiente de deploy)
- Pendiente próximas tandas: respuestas J-N del relevamiento + features B4/B5/B7/C2/E1/E4/G1 (algunas dependen de respuestas pendientes)

---

## [2026-05-25] update | PROD deploy v1.9.0 — Reglas Gastos Fases 4+5 (capitalización + cierre contable)

- Migrations 134 + 135 aplicadas en PROD ✅ (3 columnas nuevas en gastos, tabla cierres_contables, vista vw_egresos_consolidados, 4 funciones, 5 triggers)
- PR #117 `dev → main` mergeado ✅ (squash commit `4ec5885b`)
- Vercel auto-deploy PROD `dpl_DH6q1FMCKxPnPN6tav1xC3j79Kab` en estado READY ✅ (build 66s)
- `app.genesis360.pro` ya sirviendo v1.9.0
- GitHub release v1.9.0 actualizada como **latest** (título limpio sin sufijo DEV)
- DEV y PROD ahora ambas en v1.9.0 — pipeline Reglas de Negocio Gastos cerrado

---

## [2026-05-25] update | v1.9.0-dev — Fases 4 + 5 reglas Gastos (capitalización + cierre contable)

### Migrations aplicadas en DEV
- **134** `134_gastos_capitaliza_egresos_consolidados.sql`
  - `gastos.capitaliza_recurso BOOLEAN DEFAULT FALSE` + CHECK constraint (TRUE solo si recurso_id IS NOT NULL) + índice parcial `idx_gastos_recurso_capit`
  - VIEW `vw_egresos_consolidados` (UNION ALL de `gastos` + `rrhh_salarios.pagado=true`, `security_invoker=true`)
- **135** `135_cierre_contable.sql`
  - Tabla `cierres_contables(tenant_id, periodo, fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB)` UNIQUE(tenant_id, periodo) + RLS + CHECK periodo=primer día del mes
  - `gastos.gasto_padre_id` + `gastos.es_correccion BOOLEAN` + índice parcial
  - Helpers `ultimo_cierre_hasta(tenant)` y `periodo_cerrado(tenant, fecha)` STABLE
  - 5 triggers BEFORE UPDATE/DELETE en `gastos / ventas / caja_movimientos / caja_sesiones / ordenes_compra` con RAISE EXCEPTION SQLSTATE P0001
  - RPC `cerrar_periodo(p_periodo, p_observaciones)` SECURITY DEFINER — DUEÑO/SUPERVISOR/CONTADOR/ADMIN, valida periodo > último cierre y no en curso, snapshot de totales
  - RPC `reabrir_periodo(p_cierre_id)` — solo último cierre, DUEÑO/ADMIN/SUPER_USUARIO

### Frontend
- **`src/lib/supabase.ts`**: nueva interface `CierreContable` + extensión de `Gasto` (`recurso_id`, `capitaliza_recurso`, `gasto_padre_id`, `es_correccion`)
- **`src/hooks/useCierreContable.ts`** (nuevo): hook que cachea el último cierre + `isPeriodoCerrado(fecha)` helper. Función auxiliar `manejarErrorPeriodoCerrado(error, toastFn)`.
- **`src/components/CierresContablesPanel.tsx`** (nuevo): selector de periodo a cerrar (sugerencias automáticas) + preview live de gastos/ventas/sueldos del periodo + botón "Cerrar periodo" con confirmación + listado histórico expandible con totales snapshot + botón "Reabrir" solo en el último cierre (DUEÑO/ADMIN).
- **GastosPage**:
  - Nuevo tab **"Cierres contables"** visible a DUEÑO/SUPERVISOR/CONTADOR/SUPER_USUARIO/ADMIN
  - Checkbox **"Sumar al valor del recurso"** debajo del selector de recurso (visible solo si hay recurso_id), persiste `capitaliza_recurso`
  - Query nueva `recursos-select-gasto` (carga recursos no dados de baja) para el dropdown del form
  - Modo **"Nota de corrección"**: estado `correccionPadre` + función `abrirCorreccion(g)` que pre-rellena form con datos del gasto original, fecha=hoy, descripción "Corrección de: ..."
  - Validación de monto: en modo corrección admite negativos (anular total/parcial), en modo normal solo positivos
  - En el listado (tab gastos + historial), reemplaza Editar/Eliminar por **🔒 Corregir** cuando `isPeriodoCerrado(g.fecha)`
  - `eliminar()` y `guardar()` chequean el periodo antes y capturan errores del trigger via `manejarErrorPeriodoCerrado`
- **RecursosPage**:
  - Query `gastos-por-recurso` que agrega `mantenimiento`/`capitalizado`/`total`/`count` por recurso_id
  - Nueva card en stats grid: **"Mantenimiento acumulado"** (suma de gastos no capitalizables vinculados)
  - Valor patrimonial ahora incluye capitalizaciones: `valor + capitalizado`
  - Cada `RecursoCard` muestra `+ $X cap.` junto al valor base y chips "🔧 Mantto" + "📈 Cap." con cantidad de gastos asociados
- **DashGastosArea**:
  - Query agrega `rrhh_salarios.pagado=true` del período (actual y previo) → calcula `costoLaboral` y `empleadosLiquidados`
  - Banner nuevo **"Costo laboral del período (RRHH)"** debajo de los 4 KPIs principales, con link a `/rrhh?tab=nomina` y total consolidado "Gastos + RRHH"
- **RentabilidadPage**:
  - Query nueva `rentabilidad-egresos` (gastos + sueldos del período)
  - Nueva sección **"Estado de resultados (período)"** con líneas: Ventas / CMV / Ganancia bruta / Gastos operativos / **Sueldos pagados (RRHH)** (con link a `/rrhh?tab=nomina`) / Resultado neto
- **VentasPage**: handler "Eliminar venta" intercepta y muestra el mensaje del trigger periodo cerrado

### Wiki
- Nueva página `wiki/development/cierre-contable.md` con concepto, schema, triggers, RPCs, hook, componente, casos de uso y pendientes opcionales
- `wiki/features/gastos.md`: nuevas secciones "Capitalización en recursos", "Vista vw_egresos_consolidados", "Cierre contable mensual"; tabs ampliados a 7
- `wiki/features/recursos.md`: nueva card stats "Mantenimiento acumulado" + sección "Capitalización en recursos"
- `wiki/database/migraciones.md`: entradas 134 + 135

### Estado al cierre
- DEV: v1.9.0 con migrations 130-135 aplicadas
- PROD: v1.8.44
- Pendiente deploy PROD: bloque DEV completo (v1.8.45 + v1.9.0)
- Cierre del pipeline Reglas de Negocio - Gastos ✅ — Fases 1-5 completas

---

## [2026-05-24] update | PROD deploy v1.8.44 — Reglas Gastos Fases 1-3 + Moneda multi-país

- PR #116 `dev → main` mergeado ✅ (commit f8f4e434)
- Vercel auto-deploy PROD `dpl_FqCFSJA64t19A9GXGQs7gEibpMmy` en estado READY ✅
- Migrations 130-133 aplicadas en PROD ✅ (4 tenants × 16 categorías = 64 categorías_gasto seedeadas + moneda default ARS + ambas tablas de autorizaciones creadas)
- GitHub release v1.8.44 como **latest** ✅
- DEV y PROD ahora ambas en v1.8.44

## [2026-05-24] update | v1.8.44-dev — Fase 3 reglas Gastos (moneda + IVA + CC proveedor)

### Migration aplicada en DEV
- **133** `133_moneda_iva_alicuota_cc_autorizaciones.sql`
  - `tenants.moneda TEXT NOT NULL DEFAULT 'ARS'` con CHECK (ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR)
  - `gastos.alicuota_iva DECIMAL(5,2)` + `gastos_fijos.alicuota_iva DECIMAL(5,2)` para selector de alícuota persistente
  - Nueva tabla `autorizaciones_cc(tenant_id, proveedor_id, oc_id, motivo_bloqueo, monto, motivo, payload, solicitante_rol, estado, aprobador_rol, ...)` con RLS por tenant
  - `motivo_bloqueo`: `limite_excedido | oc_vencida`

### Frontend
- **`src/lib/formato.ts`** (nuevo): `formatMoneda(monto, moneda, opts)` + `simboloMoneda()` + `localeMoneda()` + `MONEDAS_DISPONIBLES`. 11 monedas: ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR con símbolo + locale específico.
- **`src/lib/ccProveedor.ts`** (nuevo): `chequearBloqueoCC(proveedorId, monto)` retorna `{bloqueado, motivo, detalle, ocsVencidas, saldoActual, limite}`. `existeAutorizacionCCAprobada(proveedorId)` verifica autorización vigente <24h sin usar.
- **`src/components/SolicitarOverrideCCModal.tsx`** (nuevo): modal rojo con motivo obligatorio que crea fila en `autorizaciones_cc`
- **`src/components/BandejaAutorizacionesCC.tsx`** (nuevo): bandeja paralela a la de gastos, solo DUEÑO aprueba/rechaza overrides de CC
- **ConfigPage tab Mi Negocio**: nuevo selector "Moneda principal del negocio" con 11 opciones. Aviso explícito de que es etiqueta visual, no conversión.
- **GastosPage**:
  - `TASAS_IVA` extendido con 27%, 0% y opción `custom` (input numérico al lado del select)
  - `calcularIVA(monto, tipoIva, alicuotaCustom)` actualizado para soportar custom
  - `ivaAutoPorTipoComprobante(tipoComp)` mapea: Factura A/B/Nota A/B/Importación/Ticket → 21% · Factura C/Recibo C/bienes usados → sin_iva. Auto-fill del form al elegir tipo de comprobante (solo si tipo_iva está vacío)
  - Form `alicuota_iva_custom` para input numérico cuando `tipo_iva === 'custom'`
  - Persistencia de `alicuota_iva` en payload de gastos y gastos_fijos
  - Validación nueva en `guardar()`: si la categoría tiene `requiere_sucursal=true` y no hay sucursal activa → toast.error bloqueante. Aviso amber inline cuando el usuario selecciona una categoría con sucursal obligatoria sin tener sucursal activa
  - Validación nueva en `registrarPagoOC()`: si `montoCC > 0` y proveedor está bloqueado (OC vencida o límite excedido), se abre `SolicitarOverrideCCModal`. Si hay autorización aprobada <24h, se permite continuar.
  - Tab "Autorizaciones" extendido con sub-tabs **"Gastos"** y **"CC Proveedores"**
- **Migración formatMoneda a helper central**: GastosPage, CajaPage, ClientesPage, EnviosPage, FacturacionPage, MetricasPage, RentabilidadPage, ReportesPage — ahora cada página usa el helper centralizado con `tenant.moneda`. Cambiar moneda en ConfigPage refleja en toda la app.
- **`src/lib/supabase.ts`**: `Tenant.moneda?`, `Gasto.alicuota_iva?`, nueva interface `AutorizacionCC`

### Estado al cierre
- DEV: v1.8.44 con migrations 130-133 aplicadas
- PROD: v1.8.40
- Pendiente deploy PROD: bloque DEV completo (v1.8.41 + v1.8.42 + v1.8.43 + v1.8.44)
- Fases pendientes:
  - **v1.8.45**: Recursos↔Gastos + Dashboard consolidado + vw_egresos_consolidados
  - **v1.9.0**: Cierre contable mensual (HITO transversal)

---

## [2026-05-24] update | v1.8.43-dev — Fase 2 reglas Gastos (umbrales + autorizaciones)

### Migration aplicada en DEV
- **132** `132_gastos_umbrales_autorizaciones.sql`
  - `sucursales.umbral_gasto_supervisor` + `umbral_gasto_cajero` (DECIMAL nullable)
  - Nueva tabla `autorizaciones_gasto`: `tipo` (crear/editar/eliminar), `monto`, `descripcion`, `motivo`, `payload JSONB`, `solicitante_id/rol`, `estado` (pendiente/aprobada/rechazada/cancelada), `aprobador_id/rol`, `motivo_rechazo`, índices y RLS por tenant
  - Helper SQL `puede_aprobar_autorizacion_gasto(solic_rol, aprob_rol)` con reglas: CAJERO → SUPERVISOR+ · SUPERVISOR → ADMIN/DUEÑO

### Frontend
- **`src/lib/umbralGasto.ts`** (nuevo): helper `evaluarUmbralGasto(rol, sucursal, monto)` y `puedeAprobar(solicRol, aprobRol)`
  - DUEÑO/ADMIN/SUPER_USUARIO → sin restricción
  - SUPERVISOR → umbral configurable (NULL = sin restricción)
  - CAJERO → umbral configurable (NULL = todo requiere autorización)
  - CONTADOR → no crea/edita gastos (solo IVA)
- **`src/components/SolicitarAutorizacionGastoModal.tsx`** (nuevo): modal amber con motivo obligatorio que crea fila en `autorizaciones_gasto` con payload completo del gasto pendiente
- **`src/components/BandejaAutorizacionesGasto.tsx`** (nuevo): lista filtrable pendiente/aprobada/rechazada · expandible con motivo + payload JSON · botón aprobar ejecuta INSERT/UPDATE/DELETE en gastos según `tipo` + marca autorización · botón rechazar requiere motivo · SUPERVISOR ve solo solicitudes de CAJERO, ADMIN/DUEÑO ven todas
- **`SucursalesPage`**: nuevo bloque "Umbrales de autorización de gastos" con 2 inputs por sucursal
- **`GastosPage`**:
  - Query `sucursal-umbrales-gasto` carga umbrales según `sucursalId` activo (o primera del tenant)
  - En `guardar()`, después de armar `payload`, llama a `evaluarUmbralGasto`; si supera → abre `SolicitarAutorizacionGastoModal` con el payload y NO inserta
  - Nuevo tab "Autorizaciones" visible solo a DUEÑO/ADMIN/SUPERVISOR/SUPER_USUARIO con badge amber de pendientes (refetch cada 30s)
  - CAJERO solo ve sus propios gastos (filter `usuario_id = user.id` en queries de gastos + historial)
  - CONTADOR: botón "Nuevo gasto" oculto · aviso visible 📊 en modal de edición · monto bloqueado (disabled)
- **`src/lib/actividadLog.ts`**: agregada entidad `autorizacion_gasto` + acciones `solicitar`/`aprobar`/`rechazar`
- **`src/lib/supabase.ts`**: nueva interface `AutorizacionGasto`, `Sucursal` con campos `umbral_gasto_*`

### Estado al cierre
- DEV: v1.8.43 con migrations 130-132 aplicadas
- PROD: v1.8.40
- Pendiente deploy PROD: bloque DEV completo (v1.8.41 + v1.8.42 + v1.8.43)
- Fases pendientes:
  - **v1.8.44**: IVA auto + selector alícuota + CC proveedor (límite/vencimiento/override) + multi-sucursal por categoría
  - **v1.8.45**: Recursos↔Gastos + Dashboard consolidado
  - **v1.9.0**: Cierre contable mensual (HITO transversal)

---

## [2026-05-24] update | v1.8.42-dev — Fase 1 reglas Gastos (migrations 130, 131)

### Migrations aplicadas en DEV
- **130** `categorias_gasto`: catálogo por tenant + seed de 16 categorías predefinidas + flag `requiere_sucursal` + trigger AFTER INSERT en tenants para alta automática. FK opcional `gastos.categoria_id` + `gastos_fijos.categoria_id`. Verificado: 7 tenants en DEV recibieron las 16 categorías (7 con sucursal obligatoria).
- **131** `tenants.gastos_*`: 7 nuevas columnas — 4 reglas combinables OR de obligatoriedad de comprobante (`siempre`, `si_iva`, `si_monto + monto_umbral`, `si_deduce_ganancias`) + `dias_alerta_borrador` (default 7) + `dias_alerta_anticipo_oc` (default 15). Default activo: `gastos_comp_siempre=true`.

### Frontend
- `src/lib/supabase.ts`: nueva interface `CategoriaGasto`, `Gasto.categoria_id`, 7 campos `gastos_*` en `Tenant`.
- `GastosPage`: la lista hardcoded `CATEGORIAS_GASTO` ahora es `CATEGORIAS_GASTO_FALLBACK`; selector de categoría carga desde `categorias_gasto` (forma activa) con fallback.
- `GastosPage` tab Fijos: badges de estado por gasto fijo: 🟢 Dentro de fecha · 🟡 Pendiente este mes · 🔴 Atrasado (+Nd) · ✅ Generado este mes. Atraso usa `tenant.gastos_dias_alerta_borrador` como umbral. "Generado" se detecta matcheando `gastos.descripcion === fijo.descripcion` dentro del mes actual.
- `GastosPage` tab OC: badge **💰 Anticipo** cuando `monto_pagado > 0 && estado != recibida/recibida_parcial/cancelada`. Color naranja por default, **rojo** si pasaron más de `gastos_dias_alerta_anticipo_oc` días desde la OC sin recibir mercadería.
- `ConfigPage`: nueva tab **Gastos** (icono TrendingDown) con 3 secciones — Reglas de comprobante (4 toggles combinables OR + input monto umbral si "Si supera monto" está activo), Alertas (2 inputs: días borrador + días anticipo OC), Categorías (CRUD con tabla, agregar custom, toggles `requiere_sucursal` y `activo`, delete solo para custom).

### Estado al cierre
- DEV: v1.8.42 con migrations 130-131 aplicadas
- PROD: v1.8.40 (sin cambios en esta sesión)
- Pendiente deploy PROD: bloque DEV completo (v1.8.41 selector courier + v1.8.42 reglas gastos Fase 1)

---

## [2026-05-24] update | relevamiento reglas Gastos + plan implementación 5 fases

### Reglas de negocio relevadas (sesión con GO)

Decisiones clave del módulo **Gastos** documentadas en `wiki/development/reglas-negocio.md`:

- **Permisos por rol** con doble umbral por sucursal (`umbral_gasto_supervisor` + `umbral_gasto_cajero`)
- **CONTADOR**: ve todo, edita solo IVA del gasto
- **CAJERO**: solo en su caja abierta; editar/eliminar requiere autorización SUPERVISOR+
- **Cierre contable mensual**: feature transversal nueva (Gastos + Ventas + Caja + OC) → hito v1.9.0
- **Multi-sucursal por categoría**: `categorias_gasto.requiere_sucursal` define obligatoriedad
- **Borradores**: badge visual + alerta tras N días configurable (creador + DUEÑO + SUPERVISOR)
- **Comprobante**: 4 reglas combinables OR en Config → Gastos (default: siempre obligatorio)
- **Cuotas**: gasto madre + N `gasto_cuotas` (sin tocar caja); cada cuota genera egreso al pagarse
- **Gastos fijos**: manual con "Generar hoy" + indicadores visuales 🟢🟡🔴✅ + notificación + email diario
- **OC anticipo**: permitido; badge "💰 Anticipo" + alerta N días sin recibir (sin estado nuevo)
- **CC proveedor**: límite + vencimiento + bloqueo solo CC + override DUEÑO con auditoría
- **IVA**: auto según tipo (A/B/C) + selector alícuota (21/10.5/27/0/custom)
- **Categorías**: catálogo predefinido + custom; predefinidas se desactivan, no se eliminan
- **Sueldos**: NO migran a Gastos, se quedan en RRHH → Nómina. Integración via `vw_egresos_consolidados`
- **Recursos↔Gastos**: mantenimiento acumulado por default + checkbox capitalizar opt-in

### Plan de implementación (5 fases) en `sources/raw/project_pendientes.md`

| Release | Migrations | Resumen |
|---------|-----------|---------|
| v1.8.42 | 130, 131 | Categorías + config comprobante + indicadores fijos + OC anticipo |
| v1.8.43 | 132 | Umbrales + autorizaciones + RLS por rol + alerta borrador |
| v1.8.44 | 133 | IVA auto + selector alícuota + CC proveedor + multi-sucursal |
| v1.8.45 | 134 | Recursos↔Gastos + Dashboard consolidado + vista vw_egresos_consolidados |
| **v1.9.0** | 135 | **HITO**: Cierre contable mensual (transversal) + notas de corrección |

### Pendientes de relevar (próximas sesiones)

- RRHH (detalle completo) · Devoluciones · Ventas (límites/reapertura) · Clientes (límite deuda) · Compras (derivadas/over-receipt) · Envíos (reglas extra)

---

## [2026-05-23] update | PROD deploy v1.8.40 — modulo Envios completo

- PR #115 `dev → main` mergeado ✅
- Migrations 127-129 aplicadas en PROD ✅
- GitHub release v1.8.40 como latest ✅
- App version DEV y PROD = v1.8.40

## [2026-05-23] update | v1.8.40-dev — ISS-166/167/168/169 + fixes carrito/numeración/autocomplete

### ISS-166 — Botón cámara en modal POD
- Input file con `capture="environment"` para tomar foto con la cámara del dispositivo
- Upload a bucket `etiquetas-envios/pod/{id}/` con URL firmada 365 días como `pod_url`

### ISS-167 — QR codes en remito PDF
- QR número de venta + QR número de envío en esquina superior derecha
- Tabla incluye SKU, LPN y Ubicación de almacén

### ISS-168 — LPN y ubicación de mercadería en Envíos
- Panel expandido muestra LPN en badge + ubicación por producto de la venta

### ISS-169 — Pestaña Pagos Courier
- Tab con badge de pendientes · selección múltiple · marcar como pagados
- Migration 128: `costo_pagado + fecha_pago_courier + medio_pago_courier`

### Fixes sesión (2026-05-21 → 2026-05-23)
- Número venta coherente Ventas↔Envíos (prefijo sucursal opcional, fallback `#global`)
- Carrito restaurado: re-fetch lineas dentro del mismo effect (elimina race condition)
- Autocomplete: `AutocompleteSuggestion` API (misma que Google Maps) + `AutocompleteService` legacy
- Distancia: Haversine con coords pre-geocodificadas · alertas si dirección mala
- DashEnviosArea: `en_bodega` en funnel, tiempo medio desde POD, insight cancelados

## [2026-05-21] update | v1.8.39-dev — autocomplete direcciones con Nominatim fallback

### AddressAutocompleteInput — autocomplete robusto
- **Google Places (primario)**: funciona cuando Maps JS API está habilitada
- **Nominatim/OpenStreetMap (fallback)**: activa automáticamente cuando Maps falla (`gm_authFailure` o `ApiNotActivatedMapError`)
  - Busca desde 3 chars, debounce 450ms, límite 6 resultados, solo Argentina
  - No requiere API key, libre de uso
  - Verificado: "Av Triunvirato 2066 CABA" → retorna "Avenida Triunvirato, Villa Urquiza, Buenos Aires..."
- **Singleton `mapsErrorDetected`**: evita reintentos de Maps en la misma sesión
- **`gm_authFailure`**: hookeado para detectar error de key/dominio además del error de API

### VentasPage — autocompletar dirección con domicilios del cliente
- Query `domicilios-cliente-venta` carga `cliente_domicilios` cuando hay `clienteId`
- Al activar toggle envío: pre-llena destino con domicilio principal del cliente
- Dropdown al enfocar: muestra direcciones guardadas + sugerencias Nominatim unificadas

## [2026-05-21] update | v1.8.39-dev — POD + en_bodega + fix crítico envíos + corrección totales (testing completo ✅)

### Flujos verificados via DB (5 flujos end-to-end)
1. **Venta directa** #78 — POS, Efectivo $4200, sin envío → Caja OK
2. **Venta con envío** #79 — WhatsApp, Transferencia $7650 (6150+1500 envío), Av. Triunvirato 2066 → Envío #4 pendiente/despachado/en_camino/en_bodega/entregado con POD ✅
3. **Reserva → despachada** #80 — Instagram, Seña $1000 efectivo + saldo $4550 débito, envío #5 pendiente ✅
4. **Presupuesto → despachada** #81 — POS, $5000 efectivo + $3400 tarjeta crédito, multi-pago ✅
5. **POD completo** — todos los estados (pendiente→despachado→en_camino→en_bodega→entregado), pod_fecha/receptor/notas/url ✅

### Consistencia verificada
- `monto_pagado == total + costo_envio` en 4/4 ventas test: OK
- Caja: ingreso, ingreso_informativo, ingreso_reserva registrados por tipo de medio de pago: OK
- Dashboard canales: POS/WhatsApp/Instagram con totales reales incluyendo envío: OK
- Envíos: 1 pendiente + 4 entregados (2 con POD); canal hereda de la venta: OK

## [2026-05-21] update | v1.8.39-dev — POD + en_bodega + fix crítico envíos + corrección totales

### Migration 127 — POD y estado en_bodega
- `envios`: 4 nuevas columnas: `pod_url`, `pod_fecha`, `pod_receptor`, `pod_notas`
- CHECK constraint ampliado: `en_bodega` como nuevo estado entre `en_camino` y `entregado`
- Flujo de estados: pendiente → despachado → en_camino → **en_bodega** → entregado

### Fix crítico — BUG envíos auto-creados desde VentasPage
- `cliente_id` no existe en tabla `envios` → INSERT fallaba silenciosamente (sin registro de envío)
- Fix: eliminado `cliente_id` del INSERT; agregado `canal: canalPOS` y `fecha_entrega_acordada`
- Nuevo campo en form de VentasPage: "Fecha de entrega acordada" al activar toggle envío

### EnviosPage — POD completo
- Modal POD standalone: abre al hacer clic en "Registrar POD" desde panel expandido
- Al confirmar POD: guarda pod_fecha/pod_receptor/pod_notas/pod_url + cambia estado a `entregado`
- Display POD en panel expandido: muestra fecha, receptor, observaciones y link comprobante
- Sección POD en modal de edición de envío (cuando se edita uno existente)
- `en_bodega`: badge violeta + icono Warehouse; botón "Registrar entrega (POD)" desde ese estado

### Corrección de totales en ventas con envío
- Historial lista: muestra `total + costo_envio` (total real que pagó el cliente)
- Detalle de venta: línea separada "Envío" + total correcto incluyendo envío
- Ticket (modal post-venta): muestra "Envío" en breakdown + total correcto
- Saldo modal (reserva→despachada): calcula saldo correctamente incluyendo `costo_envio`
- Modal presupuesto→reservada: total correcto con envío para seña

## [2026-05-20] update | v1.8.38-dev — envíos en VentasPage + consolidación SucursalesPage

### ISS-162/163/164 — Envíos en VentasPage
- ISS-164: campo "Dirección de entrega" reemplazado por `AddressAutocompleteInput` → Google Places autocomplete mientras se escribe
- ISS-163: nuevo campo editable "Dirección de origen (sucursal)" también con autocomplete; pre-llenado con `sucursal.direccion` al activar el toggle. URL de Google Maps ahora usa este campo como origen (antes quedaba vacío cuando sucursalId=null)
- ISS-162: al activar envío, pre-llena `$/km` desde `sucursal.costo_km_envio` y activa modo "Por KM"; `onPlaceSelected` dispara `calcularDistanciaKm()` → setea km → calcula costo automáticamente

### Jerarquía global/sucursal para $/km
- `sucursal.costo_km_envio` (prioridad) → `tenant.costo_envio_por_km` (fallback global)
- Afecta EnviosPage, VentasPage; labels actualizados en ConfigPage y SucursalesPage

### Consolidación config por sucursal → SucursalesPage
- Movido desde Config/Mi negocio a SucursalesPage (modal de edición):
  `codigo_postal`, `email`, `horario_apertura`, `horario_cierre`, `punto_venta_afip`
- Eliminado bloque "Configuración por sucursal" y todo el estado de ConfigPage
- Config/Mi negocio queda con configuración puramente a nivel tenant

## [2026-05-20] update | v1.8.38-dev — scan ticket IA, fixes Dashboard, ISS-090 CC

### Nuevas features
- **scan-ticket** EF nueva (Claude Sonnet 4.6 vision): analiza foto de ticket de supermercado y extrae lista de productos con barcode, nombre, cantidad y precio_unitario
- **RecepcionesPage**: botón "Escanear ticket" → foto → matcheo contra DB → tabla editable → carga automática al formulario de recepción
- **ProductosPage**: botón "Escanear ticket" → foto → validación de catálogo: ✓ sin cambios / ⚠ precio diferente / + nuevo → actualiza precio_costo o crea producto

### Bugs críticos resueltos
- **Dashboard Productos/Inventario — todo en $0**: columna `categoria` fue migrada a FK `categoria_id` pero las queries del dashboard nunca se actualizaron → 400 de PostgREST → `data=null` → KPIs en 0. Fix: usar `categorias(nombre)` en el join
- **Dashboard rotación/runway = 0**: VentasPage no incluía `sucursal_id` al insertar en `movimientos_stock` → rebajes sin sucursal → filtro estricto los excluía. Fix: agrega `sucursal_id` al insert + filtro inclusivo `OR NULL` en Dash
- **ISS-090 — CC validación**: `validarMediosPago` con CC roto → full CC fallaba con "Ingresá un método de pago", CC+tarjeta fallaba. Fix: filter (no map) + validar resto contra `totalSinCC`

### UX
- Banner amber en tabs Inventario y Productos del Dashboard cuando hay sucursal seleccionada en el header (el selector no es visible en /dashboard). Botón "Ver todo" para DUEÑO/roles con puedeVerTodas
- APP_VERSION bumpeada a v1.8.38

## [2026-05-19] update | PROD deploy v1.8.37 — migrations 122-126, EFs MODO, ISS-136 completo

- PR #114 `dev → main` mergeado ✅
- Migrations 122-126 aplicadas en PROD ✅
- EFs `modo-webhook` y `modo-crear-pago` deployadas en PROD ✅
- GitHub release v1.8.37 como latest ✅

## [2026-05-19] update | fix: ISS-104/132/133/136/138 — Gastos y Caja (v1.8.36-dev)

- Migration 126: `monto_descuento` en `ordenes_compra`
- ISS-132: campo descuento en modal pago de OC (reduce saldo, se acumula en `monto_descuento`)
- ISS-133: métodos de pago en GastosPage se cargan desde tabla `metodos_pago` en vez de hardcodeados; OC agrega Cuenta Corriente automáticamente
- ISS-138: badge "Borrador" en gastos sin `medio_pago` (tabla y historial)
- ISS-136: OC registra `egreso_informativo` en caja para todos los medios no-efectivo; gastos form muestra selector de caja con cualquier medio de pago (no solo efectivo)
- ISS-104: selector de caja en CajaPage — eliminado select box, solo píldoras con botón ★ de predeterminar integrado por caja

## [2026-05-19] update | feat: MODO integración completa — webhook + polling + deploy (v1.8.35-dev)

- EF `modo-webhook` creada: recibe notificaciones de pago MODO, actualiza `ventas.id_pago_externo` e implementa idempotencia con `ventas_externas_logs`
- EF `modo-crear-pago` deployada en DEV (ya existía en repo, no estaba activa)
- VentasPage: polling cada 4s sobre `ventas.id_pago_externo` mientras el QR MODO está visible
- VentasPage: modal QR rediseñado — estado "Esperando..." con dot animado y estado "¡Pago recibido!" con checkmark al detectar confirmación
- Tests ejecutados: webhook 200 ✅, idempotencia ✅, venta actualizada ✅, JWT inválido 401 en crear-pago ✅
- Pendiente: verificar endpoints reales de MODO sandbox cuando lleguen las credenciales de merchant

## [2026-05-19] update | feat: ConfigPage Fases 2-3-4 — config extendida (v1.8.34-dev)

- Migrations 123-125: `tenants` (email_legal, precio_redondeo, cliente_*, descuento_max_*, clave_maestra, boveda_umbral_caja), `sucursales` (codigo_postal, email, horario_apertura/cierre, punto_venta_afip), `metodos_pago` (comision_pct, config)
- Mi negocio: email legal, redondeo de precios, config de sucursales (CP/email/horario/PV AFIP) por sucursal
- Ventas/Métodos: comisión % por método de pago (badge naranja display, editable inline)
- Ventas/Operativa: cliente obligatorio en POS, datos mínimos, consumidor final, creación inline
- Ventas/Descuentos: descuento máximo cajero/supervisor (% configurable)
- Caja: contraseña maestra para cierre de caja ajena + umbral bóveda
- VentasPage: validación descuento máximo por rol al confirmar venta + badge rojo si excede límite

## [2026-05-19] update | refactor: ConfigPage Fase 1 — nueva estructura de módulos (v1.8.33-dev)

- 11 tabs nuevas en lugar de 10 tabs planas: Negocio / Ventas / Caja / Clientes / Inventario / Envíos / Facturación / RRHH / Alertas / Notificaciones / Conectividad
- Sidebar con separadores de grupos (Negocio / Sistema) y badge "pronto" en placeholders
- Ventas absorbe: Métodos de pago (sub-tab), Combos y descuentos (sub-tab), Operativa (sub-tab)
- Inventario absorbe: Reglas de stock (sub-tab nuevo), Categorías, Ubicaciones, Estados, Motivos, Unidades de medida
- Conectividad absorbe: Integraciones, API
- Envíos: costo por km + plantilla WhatsApp (movidos de Mi negocio)
- Facturación: todo el bloque AFIP (movido de Mi negocio)
- Mi negocio queda con: nombre, tipo, timeout sesión, plan actual, marketplace
- Placeholders con "Próximamente": Caja, Clientes, RRHH, Alertas, Notificaciones

## [2026-05-18] update | fix: 6 issues — Recursos, Dashboard Gastos, Inventario, Ventas (v1.8.32-dev)

- ISS-110: migration 122 — `ventas_origen_check` extendida con Instagram/Facebook/WhatsApp/Otros
- ISS-111: migration 102 (`es_recurrente`/frecuencia/proximo_vencimiento) faltaba en DEV, aplicada
- ISS-112: checkbox "Registrar como gasto" en modal recurso activo (activado por default, desactivable)
- ISS-114: botón Agregar en tab Ubicaciones abre modal "Asignar ubicación" correcto (no el de crear recurso)
- ISS-129: pctFijos en DashGastosArea corregido (fijos/total_combinado); link → `/gastos?tab=fijos`; GastosPage lee `?tab=` de URL
- ISS-131: query `productosBusqueda` incluye `estado_id` y `proveedor_id` para respetar defaults del producto

## [2026-05-18] update | PROD deploy v1.8.31 — PR #113, migrations 111–121 aplicadas

- PR #113 `dev → main` mergeado ✅
- Migrations 111–121 + fix_motivos_tipo_constraint aplicadas en PROD ✅
- GitHub release v1.8.31 como latest ✅
- PROD y DEV en paridad completa: v1.8.31 / migrations 001–121

## [2026-05-18] update | v1.8.31 — bump versión + manuales de uso

- APP_VERSION bumpeada a v1.8.31 en brand.ts
- wiki/manuales/ — 3 manuales HTML nuevos (hogar, ferretería, tienda ropa)
- index.md — sección "Manuales" agregada

## [2026-05-18] update | Wiki — actualización completa v1.8.29–v1.8.31

- `productos.md`: página nueva — ProductoFormPage 6 cards, atributos variante, marca, UdM custom, ubicación por sucursal, grupos, inactivos, defaults al ingresar
- `inventario-stock.md`: filtros pill (v1.8.28), defaults producto (v1.8.30), modales inline results (v1.8.31)
- `reportes-metricas.md`: Dashboard nueva estructura de navegación — area tabs + sub-tabs + filtro pill (v1.8.31)
- `multi-sucursal.md`: ubicacion_sucursal (migration 121), filtros OC/Facturación (v1.8.28)
- `migraciones.md`: migrations 118–121, total DEV 122 archivos
- `project_pendientes.md`: DEV v1.8.31, migrations 001–121
- `index.md`: nueva página productos.md, conteos y versiones actualizados

## [2026-05-17] update | feat: grupos de variantes de producto (migration 120, v1.8.30-dev)

Cambios en esta sesión:
- **ProductoGrupoModal**: CRUD completo de grupos con atributos tipo tag-input (Enter/coma), producto cartesiano de combinaciones, generación de variantes automática, lista de variantes existentes con links.
- **ProductosPage**: botón "Grupos" (panel lateral), toggle "Agrupar variantes" (viewMode flat/grouped), vista agrupada con secciones colapsables por grupo + tabla de variantes con badges, badge de grupo en vista flat.
- **ProductoFormPage**: card "Grupo de variantes" — selector de grupo, inputs por atributo (select o text), badges de valores actuales, desvincular, guardado de grupo_id + variante_valores.
- Migration 120: tabla `producto_grupos` + columnas `grupo_id`/`variante_valores` en `productos`.
- DEV: `v1.8.30` | PROD: `v1.8.27`

## [2026-05-17] update | ISS-113/115/119/120/121/122/123/125/126 — atributos producto + UdM + inactivos + variantes (v1.8.29-dev)

Cambios en esta sesión:
- **ISS-115**: campo `marca` en ProductoFormPage (datos básicos, sin required)
- **ISS-119**: campo `shelf_life_dias` visible solo si `tiene_vencimiento` está activo
- **ISS-113/121**: 6 nuevos toggles de variante en Tracking: pais_origen, talle, color, encaje, formato, sabor_aroma
- **ISS-120**: CRUD de unidades de medida personalizadas en ConfigPage (nuevo tab "Unidades") + optgroup en ProductoFormPage
- **ISS-122**: ProductosPage sin filtro activo, toggle "Ver inactivos", badge Inactivo + opacity-60
- **ISS-123**: Bulk bar: botón único toggle Desactivar/Reactivar según mayoría seleccionada
- **ISS-125**: Campos de variante en LpnAccionesModal (tab Editar) e IngresarPage (modal ingreso)
- **ISS-126**: Campos de variante en RecepcionesPage (FormItem + insert inventario_lineas)
- Migrations aplicadas en DEV: 118 (campos producto variantes) + 119 (unidades_medida)
- DEV: `v1.8.29` | PROD: `v1.8.27`

## [2026-05-16] update | Wiki — actualización completa v1.8.28-dev (multi-sucursal + defaults)

Páginas actualizadas:
- `multi-sucursal.md` — sucursal por defecto, backfill 114–117, filtros estrictos, cajas por sucursal
- `caja.md` — cajas.sucursal_id, filtro CajaPage, Caja Principal en seed
- `autenticacion-onboarding.md` — defaults al registrar negocio, fix duplicados tenant, Sucursal 1
- `ventas-pos.md` — filtro historial estricto (eliminado OR IS NULL)
- `reportes-metricas.md` — Dashboard tab Todo filtro por sucursal
- `triggers.md` — trg_seed_tenant_defaults (Sucursal 1 + Caja Principal + motivos + estados)
- `rls-policies.md` — política DELETE en users (migration 113)
- `migraciones.md` — migrations 111–117
- `project_pendientes.md` — DEV v1.8.28, migrations 001–117, PROD pendientes 113–117

## [2026-05-15] update | Wiki — actualización completa v1.8.23 a v1.8.27

Páginas actualizadas:
- `inventario-stock.md` — conteos borrador (ISS-100), rebaje masivo FIFO fix (ISS-012), shortcuts ESC/ENTER
- `ventas-pos.md` — ISS-105 costo envío en validación, ISS-106 historial OR(sucursal/null) + badge CC ghost
- `clientes-proveedores.md` — ISS-107 cancelar deuda CC (DUEÑO/SUPERVISOR)
- `gastos.md` — ISS-044 OC expanded como ticket/recibo
- `autenticacion-onboarding.md` — roles renombrados (DUEÑO/SUPER_USUARIO), fix registro v1.8.27
- `reportes-metricas.md` — Dashboard 9 áreas, SQL Runner (migration 105), aging individual (migration 106)
- `triggers.md` — trg_crear_caja_fuerte SECURITY DEFINER + explicación RLS
- `migraciones.md` — migrations 109 y 110
- `roadmap-apis.md` — MODO payments framework (ISS-072, migration 109)
- `overview.md` — versión v1.8.27, 110 migraciones
- `index.md` — descripciones actualizadas, pie de página

## [2026-05-15] update | PROD deploy v1.8.27 — fix registro nuevo negocio

- Fix crítico: `fn_crear_caja_fuerte` SECURITY DEFINER — trigger bloqueaba RLS al registrar tenant nuevo
- Migration 109 (modo_credentials) y 110 (fix fn) aplicadas en PROD ✅
- PR #112 mergeado a main · GitHub release v1.8.27 ✅

## [2026-05-15] update | v1.8.26 DEV — ISS-072/044 + ISS-100/012/107 + ISS-105/106

- ISS-100: conteos borrador funcionales (continuar, eliminar, actualizar)
- ISS-012: rebaje masivo FIFO/FEFO corregido + preview LPNs + override
- ISS-107: cancelar deuda CC en clientes (DUEÑO/SUPERVISOR)
- ISS-105: costo envío incluido en validación de medios de pago
- ISS-106: historial ventas OR(sucursal, null) + badge ghost CC ventas
- ISS-072: framework MODO (migration 109 + Edge Function + ConfigPage + VentasPage)
- ISS-044: OC expanded view rediseñado como ticket/recibo (font mono, secciones, totales)

## [2026-05-15] update | v1.8.24 DEV — ISS-105/106 fixes

- ISS-105: validación medios de pago usa totalConEnvio; monto_pagado incluye envío
- ISS-106: historial OR(sucursal_id=X, null) para incluir ventas previas al multi-sucursal; badge ghost CC

## [2026-05-15] update | v1.8.23 DEV — ISS-100/012/107 fixes

- ISS-100: conteos borrador — continuar, eliminar y actualizar desde historial
- ISS-012: rebaje masivo FIFO/FEFO corregido — filtro sucursal + ubicacion + preview LPNs + override
- ISS-107: cancelación de deuda CC por venta (solo DUEÑO/SUPERVISOR)

## [2026-05-15] update | PROD deploy v1.8.22 — PR #111 mergeado, migration 108 aplicada

- PR #111 `dev → main` mergeado ✅
- Migration 108 aplicada en PROD (jjffnbrdjchquexdfgwq): sucursales.codigo, ventas.numero_sucursal, tenants.cuotas_bancos, ventas.cuotas_info, ordenes_compra.comprobante_url/titulo
- GitHub release v1.8.22 marcado como latest en main
- Wiki actualizado: caja.md, ventas-pos.md, gastos.md, envios.md, clientes-proveedores.md, migraciones.md, roadmap.md, index.md

## [2026-05-14] update | v1.8.22 DEV — ISS-085/086/090/095/096 batch features

### ISS-085: Número de ticket por sucursal con prefijo
- Migration 108: `sucursales.codigo` + `ventas.numero_sucursal` + trigger actualizado
- SucursalesPage: campo "Código ticket" en formulario
- VentasPage: `formatTicket()` → "S1-0001" cuando hay sucursal, "#N" global

### ISS-086: Cuotas tarjeta de crédito
- Migration 108: `tenants.cuotas_bancos` JSONB + `ventas.cuotas_info` JSONB
- ConfigPage: sección "Cuotas por banco" con add/edit bancos y planes de cuotas
- VentasPage: picker de cuotas al seleccionar "Tarjeta crédito" — banco, cuotas, interés, badge "Sin interés"

### ISS-090: CC como método de pago parcial en ventas
- Elimina toggle "Despachar a cuenta corriente" — CC es opción en medios de pago
- `modoCC` derivado de `mediosPago` (no estado). Pago mixto soportado.
- CC excluida de movimientos de caja; valida cliente y CC habilitada

### ISS-095: OC con CC como método de pago parcial
- Elimina toggle Pago/CC en OC — CC es un método más en `MEDIOS_OC`
- Pago mixto: ej 30% Transferencia + 70% Cuenta Corriente
- Días plazo CC aparecen solo cuando hay CC en medios

### ISS-096: Comprobante de pago en OC
- Migration 108: `ordenes_compra.comprobante_url` + `comprobante_titulo`
- GastosPage: botón adjuntar comprobante en expanded OC (Storage: comprobantes-gastos/oc/)

---

## [2026-05-14] update | v1.8.21 DEV — bugfixes batch ISS-081/082/084/087/088/089/091/092/093/094/097/102/103

### Caja
- ISS-087: ★ visual en caja predeterminada (localStorage pref)
- ISS-088: sugerir apertura usa monto_real_cierre (si > 0) ?? monto_cierre
- ISS-089: selector de caja origen en modal "Ingresar a Caja Fuerte" + validación saldo

### Ventas
- ISS-094: rollback automático de venta CC si falla stock (delete ventas en catch)
- ISS-081: total redondeado a 2 decimales + display maximumFractionDigits: 2
- ISS-082: committedAsignado — "Falta asignar" estático hasta blur/enter
- ISS-091: badge "Stock insuf." en items del carrito (desde lineas_disponibles)
- ISS-092: draft carrito guarda modoCC; restaura clienteCCEnabled desde DB
- ISS-093: tag CC en historial cuando es_cuenta_corriente = true
- ISS-103: selector canal de venta en POS (Presencial default, Instagram, Facebook, WhatsApp, Otros)

### Gastos
- ISS-084: efectivo requiere selección de caja; saldo validation; Caja Fuerte como opción (egreso_traspaso)

### Envíos
- ISS-097: fix crítico — useState en IIFE viola Rules of Hooks → usa domForm existente

### Clientes/Proveedores
- ISS-102: selector sucursal oculto en /clientes y /proveedores; sin applyFilter en query clientes

---

## [2026-05-14] update | v1.8.20 DEV — fix invite-user redirect dinámico

- `invite-user` EF: redirectTo hardcodeado a genesis360.pro → ahora el frontend pasa
  window.location.origin/dashboard (funciona en localhost, DEV y PROD sin tocar whitelists)
- UsuariosPage: extrae mensaje real del body del FunctionsHttpError para toast útil
- GROQ_API_KEY configurada en Supabase PROD secrets ✅
- Deployado invite-user en DEV y PROD

## [2026-05-14] update | PROD deploy v1.8.19 — PR #110 mergeado, migrations 093-107 aplicadas

- PR #110 mergeado dev → main
- Migrations 093-107 aplicadas en PROD (jjffnbrdjchquexdfgwq)
- Edge Functions PROD: invite-user + ai-assistant deployadas
- VITE_GOOGLE_MAPS_API_KEY configurada en Vercel Production
- GROQ_API_KEY: pendiente en Supabase PROD secrets
- Vercel PROD deployment: READY ✅

## [2026-05-14] update | v1.8.19 — SQL Runner + Envíos Google Maps + shortcuts + aging + Dashboard

### SQL Runner (ReportesPage)
- Migration 105: `tenant_sql_query` SECURITY INVOKER, solo SELECT/WITH, 500 filas
- Fix regex: `\b` → `([[:space:]]|$)` (no funciona en PG string literals)
- UI: editor monospace, Ctrl+Enter, tabla dinámica, export Excel/PDF, solo DUEÑO/SUPER_USUARIO

### Aging profiles individual
- Migration 106: `process_aging_profile_single(p_profile_id)`
- Botón "Procesar" por perfil en ConfigPage con spinner independiente

### Shortcuts ESC/ENTER en InventarioPage
- LpnAccionesModal: ESC=cierra, ENTER=guarda según tab activo
- Tab Agregar/Quitar Stock: ENTER=abre modal, ESC=limpia
- Tab Conteos: flujo 3 estados con ENTER, ESC=cancelar

### Envíos — Google Maps + tarifas (migration 107)
- `sucursales.costo_km_envio` + tabla `courier_tarifas`
- SucursalesPage: dirección obligatoria, costo_km_envio, panel couriers inline
- `useGoogleMaps.ts` + `AddressAutocompleteInput` component
- ISS-083: autocomplete Places, KM auto via Distance Matrix, costo = KM × rate
- ISS-098: canal auto desde venta (read-only), costo courier auto desde tarifas
- Tab Cotizador eliminado
- `VITE_GOOGLE_MAPS_API_KEY` configurada en .env.local y Vercel

### Wiki y docs
- index.md, multi-sucursal.md, inventario-stock.md, alertas.md, recursos.md actualizados
- Regla de cierre de sesión (wiki + GitHub releases) grabada en CLAUDE.md y memory

## [2026-05-13] update | Soporte DB: incidente pool saturado + manual de rescate

- Causa: AppLayout tenía query a `ventas_externas_logs.created_at` (columna inexistente, era `procesado_at`) corriendo cada 30s → saturó el pool de 60 conexiones
- Segunda causa: ReportesPage pedía `estados_inventario.es_default` (inexistente en esa tabla)
- Fix: columnas corregidas en el código, restart del proyecto DEV desde dashboard
- Creado: `G360.Wiki/wiki/support/supabase-db-rescue.md` con manual completo de diagnóstico y rescate

## [2026-05-13] update | Kits y Conteos: filtrado por sucursal activa (v1.8.18)

- Kits: `stockKitsSucursal` query suma `inventario_lineas` por sucursal; helper `kStock()` usado en maxKits, display, desarmar y modal armado
- Kits: `iniciarArmado` verifica y reserva solo componentes de la sucursal; `desarmarKit` filtra `lineasKit` por sucursal
- Conteos: `conteoHistorial` aplica `.eq('sucursal_id')` (queryKey ya lo tenía pero no la query); `cargarLineasParaConteo` idem

## [2026-05-13] update | Inventario: stock por sucursal en movimientos + display (fix integral)

- `getStockAntesSucursal` helper reemplaza `productos.stock_actual` global en todos los inserts de `movimientos_stock`
- Corregido en: ingreso, rebaje, masivo inline, conteo, autorizaciones, kitting, des-kitting
- `sucursal_id` agregado en kitting/des-kitting y autorizaciones (faltaba)
- `inventario_lineas` INSERT del masivo inline ahora incluye `sucursal_id`
- Display "Stock en sucursal: X" en formularios Agregar Stock y Quitar Stock cuando hay sucursal activa
- Query reactiva `stockEnSucursal` con `staleTime: 0`

## [2026-05-13] update | Recursos: tab Ubicaciones + recurrencia + GastosPage renovaciones

- Migration 102: columnas `es_recurrente`, `frecuencia_valor`, `frecuencia_unidad`, `proximo_vencimiento` en `recursos`
- RecursosPage: tab "Ubicaciones" con agrupación por ubicación e inline edit; lógica recurrente en modal (checkbox + frecuencia + fecha próxima calculable); badge visual en cards
- GastosPage tab Recursos: sección "Renovaciones pendientes" con recursos recurrentes vencidos o próximos (≤7 días) + botón "Registrar compra" que crea gasto y avanza la fecha
- LpnAccionesModal: sucursal_id en tab Editar (sesión anterior)

## [2026-05-13] update | v1.8.16 DEV — cierre sesión completo

Renombrado OWNER→DUEÑO (migration 100): constraint, data, RLS, is_rrhh(), caja_fuerte_roles, 21 archivos frontend.
Sucursales (migration 101): selector header limitado a 4 rutas solo para Dueño.
ubicaciones/combos filtran por sucursal. Ingreso bloqueado sin sucursal.
LPN traslado: cantMover default 1 → botón habilitado.
Deploy PROD pendiente con migrations 093-101.

---

## [2026-05-13] update | v1.8.14 DEV — cierre sesión + docs actualizados

Dashboard General completo (9 áreas: Ventas/Gastos/Productos/Inventario/Clientes/Proveedores/Facturación/Envíos/Marketing).
Fixes: DashInventarioArea Treemap→barras custom (recharts v3 bug), DashProductosArea devolucion_items query + periodo default.
Gotchas documentados: recharts v3 Treemap crash, Supabase JS !inner filter.
Pendientes: deploy PROD v1.8.14 (migrations 093-099, EFs, GROQ_API_KEY, GitHub release).

---

## [2026-05-12] update | v1.8.12 DEV — Dashboard General: área Inventario

- feat: DashInventarioArea.tsx — área Inventario & Recursos completa:
  - Toggle vista: Todo / Solo Mercadería / Solo Recursos
  - 8 KPIs: Capital de Trabajo, Patrimonio Operativo, Rotación, Runway, Kits posibles, Recursos en reparación, Reservas, Mermas
  - Gráfico 1: Dona Patrimonio (Mercadería turquesa/recursos violeta)
  - Gráfico 2: Gauge SVG semicircular "Salud del Depósito" (4 zonas crítico→óptimo)
  - Gráfico 3: Barras envejecimiento del capital (0-30/31-90/+90 días)
  - Gráfico 4: Barras apiladas horizontales "Recursos por categoría" (activo/en_reparacion/dado_de_baja)
  - Gráfico 5: Treemap "Cuello de Botella de Combos" (kits bloqueados sin componentes)
  - Insights: recursos en reparación, capital dormido +90 días, combos bloqueados, runway corto, stock crítico, mermas

---

## [2026-05-12] update | v1.8.11 DEV — Dashboard General: área Productos

- feat: DashProductosArea.tsx — área Productos completa:
  - 6 KPIs en 2×3: Margen Global, El Motor, La Mina de Oro, Capital Dormido, Tasa Devolución, Quiebre de Stock
  - Filtros: período + categoría + slider margen mín + ciclo de vida (Estrella/Perro/Nicho)
  - Gráfico 1: Scatter "Cuadrante Mágico" (cantidad vs margen) — 4 cuadrantes con colores verde/azul/amarillo/rojo
  - Gráfico 2: Pareto "Concentración de Ingresos" — barras + línea acumulada + referenceLine al 80%
  - Gráfico 3: Pie "Participación por Categoría"
  - Gráfico 4: "La Tijera de Precios" — doble línea (precio prom morado vs costo prom rojo) últimos 6 meses
  - Insights: margen bajo, producto con costo > precio, capital dormido, quiebre de stock, concentración Pareto, devoluciones, mina de oro oculta
- feat: sub-nav Dashboard General agrega área "Productos" (entre Gastos e Inventario)

---

## [2026-05-12] update | v1.8.10 DEV — Dashboard General: área Gastos

- feat: DashGastosArea.tsx — área Gastos completa:
  - Filtros propios en popover (período Mes/Trimestre/Año/Custom, ARS/USD, Categoría)
  - KPI 1: Total Salidas — badge invertido (subir=rojo, bajar=verde)
  - KPI 2: Velocidad de Gasto / Burn Rate ($X/día)
  - KPI 3: Peso de la Estructura (Ratio Gastos/Ventas %) con alerta >80%
  - KPI 4: Rigidez del Gasto — % fijos vs variables con barra bicolor (usa gastos_fijos)
  - Gráfico 1: Pie por categoría — colores bien diferenciados + leyenda inline
  - Gráfico 2: Barras mensuales últimos 6 meses + línea referencia (promedio) punteada accent; barras rojas si >15% del promedio
  - Gráfico 3: Top 5 destinos de gasto — barras horizontales por descripción
  - Insights: tendencia, cuotas vencidas, por vencer, sin comprobante, anomalía por categoría, ratio crítico, gastos fijos altos

---

## [2026-05-12] update | v1.8.9 DEV — Dashboard General: sub-nav áreas + área Ventas

- feat: DashboardPage — sub-navegación de área en pestaña General (Todo/Ventas/Gastos/Inventario/Clientes/Proveedores/Facturación/Envíos)
- feat: tab "Gráficos" agregado (placeholder "Próximamente")
- feat: DashVentasArea.tsx — área Ventas completa:
  - Filtros propios en popover (período Hoy/7D/15D/30D/Mes/Año/Custom, ARS/USD, c/IVA/s/IVA, Canal)
  - KPI 1: Total Vendido con badge vs período anterior
  - KPI 2: Gasto promedio por cliente
  - KPI 3: Efectividad de presupuestos (% conversión)
  - KPI 4: Clientes Nuevos vs Frecuentes (mini progress bar bicolor)
  - Gráfico 1: "El Camino de la Venta" — funnel horizontal 3 etapas (Presupuestado/Pendiente/Pagado)
  - Gráfico 2: "Tus mejores momentos" — heatmap días×horas con accent color opacity
  - Gráfico 3: "¿Por dónde compran?" — pie chart canales con recharts + leyenda inline
  - Insights automáticos: tendencia, pendiente cobro, efectividad, fidelidad, canal dominante, peak hours

---

## [2026-05-12] update | v1.8.8 DEV — fix multi-sucursal inventario

- fix: inventario_lineas INSERT en ingresoMutation omitía sucursal_id → LPNs quedaban sin sucursal → filtrar por sucursal mostraba 0 unidades
- fix: LpnAccionesModal selector sucursal — sucursalDestino con null en vez de '' para evitar confusión visual del browser; opción "Sin sucursal asignada" explícita; sucursalFinal usa ?? en vez de ||
- feat: selector de sucursal en form de ingreso para OWNER en vista global (resaltado en ámbar)

---

## [2026-05-12] update | v1.8.7 DEV — aprobación caja fuerte real + envíos + IA

- fix bug crítico: solicitudes CAJERO→CajaFuerte siempre fallaban (tipo inválido, sin user_id). Ahora notifica a OWNER/SUPER_USUARIO/SUPERVISOR con metadata JSONB.
- NotificacionesButton: botones Aprobar/Rechazar para `solicitud_caja_fuerte` — Aprobar ejecuta egreso+ingreso reales.
- EnviosPage: selector "Nuevo envío" excluye ventas que ya tienen envío asignado.
- ai-assistant: system prompt reescrito con 20 módulos en orden sidebar + botones exactos + roles actualizados.
- Migration 099: `notificaciones.metadata JSONB`.

---

## [2026-05-08] update | v1.8.6 DEV — bump versión + cierre sesión

Bump v1.8.6. Migrations DEV: 093–098. Todo pusheado, pendiente deploy a PROD.
Rol ADMIN renombrado a SUPER_USUARIO. EF invite-user y cancel-suscripcion deployados en DEV.
Ventas: panel envío completo (monto/$km/Maps). Gastos: tab Recursos + cuotas tarjeta.
Recursos: tabs renombrados + flujo gasto automático. Recepciones: bug detalle expandido fix.

---

## [2026-05-08] update | v1.8.5 DEV — mejoras Caja/Inventario/Envíos/Ventas/Recepciones

### Caja
- Historial excluye caja fuerte; historial propio en tab Caja Fuerte (ingresos + egresos)
- "Ingresar a Caja Fuerte": sin restricción de sesión activa para OWNER/SUPER
- "Enviar a Caja": selector de caja destino (antes fijado en la caja activa)
- CAJERO: botón "Caja Fuerte" → genera solicitud (notificación) para OWNER/SUPERVISOR

### Inventario
- Conteos: muestra usuario en historial
- Bulk actions en LPNs: barra desde 1 LPN con "Cambiar estado" y "Cambiar ubicación"; cross-producto habilitado

### Envíos
- Toggle Propio/Tercero; si propio: KM + precio/km → auto-calcula costo

### Ventas
- Toggle "Requiere envío" en POS → auto-crea envío 'pendiente' al confirmar

### Recepciones (bug fixes anteriores)
- Fix detalle expandido: carga recepcion_items lazy con tabla Esperado/Recibido/Diferencia
- Validaciones de atributos (lote, vencimiento, series) antes de confirmar; auto-expande ítem con error
- Modal de resultado post-confirmación con comparativa vs OC
- Botones "Crear OC derivada" y "Solicitar reembolso" para diferencias
- Sucursal predeterminada sincronizada con header

---

## [2026-05-08] update | v1.8.5 DEV — fixes y docs

- fix: rol ADMIN faltaba en mapa local de UsuariosPage — no aparecía en invitar ni cambiar rol
- docs: app-reference.md — revisión completa (Estructuras correcto, Inventario 7 tabs, tabla Kit/Combo/Estructura)

---

## [2026-05-08] update | Permisos de sucursal por usuario (migration 094)

- Migration 094: `users.sucursal_id` + `users.puede_ver_todas`; OWNER/ADMIN/SUPERVISOR/CONTADOR init en true
- authStore: `puedeVerTodas` en estado; usuarios restringidos quedan bloqueados a su sucursal (ignorar localStorage)
- AppLayout: selector visible solo para `puedeVerTodas`; usuarios restringidos ven nombre fijo o badge "Sin sucursal"
- UsuariosPage: toggle Globe + selector sucursal inline por usuario; `updateRol` auto-actualiza `puede_ver_todas`
- VentasPage/GastosPage (OC)/CajaPage: filtros multi-sucursal completados (migration 093 para `ordenes_compra.sucursal_id`)

---

## [2026-05-08] update | Multi-sucursal filtro — RecepcionesPage + ProductosPage

- RecepcionesPage: `useSucursalFilter` + `applyFilter` en query listado + `sucursalId` en queryKey
- ProductosPage: `useSucursalFilter` + `applyFilter` en query `inventario_lineas` (stock crítico badge) + `sucursalId` en queryKey
- EnviosPage y RecursosPage ya tenían el filtro correctamente implementado
- Todos los módulos operativos ahora filtran por sucursal ✅

---

## [2026-05-08] update | Cierre sesión — docs actualizados para mañana

**Estado al cierre:**
- PROD: v1.8.3 ✅ · DEV: v1.8.4 · Migrations: DEV 001–092 / PROD 001–092
- Asistente IA deployado en DEV, GROQ_API_KEY configurada en DEV ✅
- Pendiente para mañana: (1) deploy v1.8.4 a PROD + GROQ_API_KEY en PROD, (2) mejora system prompt asistente, (3) expandir filtro sucursal a RecepcionesPage, EnviosPage, RecursosPage, ProductosPage stock crítico

---

## [2026-05-08] update | v1.8.4 DEV — Asistente IA en header (Groq/Llama 3.1)

- EF `ai-assistant`: Groq API (llama-3.1-8b-instant), auth JWT, system prompt con todos los módulos G360
- `AiAssistant.tsx`: panel chat flotante en header. Acciones rápidas, flujo bug report guiado, botón "Enviar reporte" (aparece tras 4+ mensajes)
- `send-email`: template `bug_report` — envía conversación formateada a gaston.otranto@gmail.com
- Secret `GROQ_API_KEY` configurado en DEV ✅ (pendiente configurar en PROD al deployar)
- Free tier Groq: 14.400 req/día — sin costo

---

## [2026-05-07] update | Plan Roadmap APIs — documentado, pausado

Relevamiento completo de integraciones API actuales y plan de 6 fases para killer features.
Ver: `wiki/integrations/roadmap-apis.md`

**Resumen estado actual:**
- ✅ TiendaNube, MercadoLibre, MercadoPago, Resend, Data-API implementados (básico)
- ⚠️ AFIP parcial (schema listo, worker facturación pendiente)
- ❌ Logística directa, PagoNube, EnvíoNube, Ads (Meta/Google/MELI), WhatsApp, Email marketing

**Plan fases priorizadas (implementación futura a confirmar):**
- Fase 1: MELI rentabilidad neta + MP conciliación + TN BOM + AFIP CUIT + repricing
- Fase 2: PagoNube + EnvíoNube (para operaciones propias y checkout TN)
- Fase 3: Logística directa (Andreani/OCA) + rate shopping + RMA
- Fase 4: MELI Ads (auto-pausado por margen)
- Fase 5: Meta Ads + POAS + GA4 (posicionamiento futuro)
- Fase 6: WhatsApp Cloud API (espera WABA) + Brevo/Klaviyo RFM

---

## [2026-05-07] update | Deploy v1.8.3 a PROD — Precios mayoristas + mass update

- Migration 092 (`producto_precios_mayorista`) aplicada en PROD ✅
- PR #107 mergeado `dev → main` ✅
- GitHub release v1.8.3 ✅
- Migrations PROD: 001–092 ✅

### Features
- **Precios mayoristas**: tabla `producto_precios_mayorista`, toggle + tiers en ProductoFormPage
- **Mass update productos**: +Proveedor, +Precio (% o fijo), +Reactivar en barra bulk

---

## [2026-05-07] update | Deploy v1.8.2 a PROD

- Migrations 090+091 aplicadas en PROD ✅
- PR #106 mergeado `dev → main` ✅
- GitHub release v1.8.2 creado ✅
- Migrations PROD: 001–091 ✅
- pg_cron `notif-cc-vencidas` activo en PROD (09:00 AR diario) ✅

---

## [2026-05-07] update | v1.8.2 DEV — OC→Gasto automático + notif CC vencidas

**Cambios:**

### OC → Gasto automático (migration 090)
- `gastos.recepcion_id` (UUID nullable FK a `recepciones`) para trazabilidad
- `RecepcionesPage`: al confirmar recepción vinculada a OC, crea `gasto` con monto calculado desde ítems recibidos × precio_costo, categoría "Compras", notas con número de recepción
- Dedup natural: cada confirmación crea una recepción nueva → un gasto nuevo

### Notificaciones CC vencidas (migration 091)
- `fn_notificar_cc_vencidas()`: SECURITY DEFINER, notifica OWNER+ADMIN por tenant
  - CC clientes: ventas CC con saldo > 0 y vencidas (created_at + plazo_pago_dias < hoy)
  - OC vencidas: `fecha_vencimiento_pago < hoy AND estado_pago != 'pagada'`
  - Dedup por día: no genera duplicados si ya existe notificación del mismo día para el mismo objeto
- pg_cron `notif-cc-vencidas`: corre a las 12:00 UTC (09:00 AR) todos los días

**Estado al cierre:**
- PROD: v1.8.1 ✅ · DEV: v1.8.2 · Migrations DEV: 001–091 · PROD: 001–089

---

## [2026-05-07] update | Deploy v1.8.1 a PROD

- Migration 089 (`recursos`) aplicada en PROD ✅
- PR #105 mergeado `dev → main` ✅
- GitHub release v1.8.1 creado ✅
- Migrations PROD: 001–089 ✅

---

## [2026-05-07] update | Multi-sucursal: filtrado estricto implementado

**Cambios:**
- `useSucursalFilter.applyFilter`: `.or(eq+null)` → `.eq('sucursal_id', sucursalId)` estricto
- `authStore.setSucursal(null)`: guarda sentinel `'__global__'` en localStorage para distinguir "nunca configurado" de "vista global explícita"
- `AppLayout` auto-select: no sobreescribe preferencia `'__global__'` guardada
- `SucursalSelector`: nueva opción "Todas las sucursales" al inicio del select

**Comportamiento:**
- Sucursal activa → solo datos de esa sucursal (datos NULL históricos no se mezclan)
- Vista global → todo visible (incluye NULL)
- La preferencia persiste entre sesiones

---

## [2026-05-07] update | v1.8.1 — Recursos, estructuras ingreso, fixes, plan multi-sucursal

**Producido en esta sesión:**

### Features
- **Módulo Recursos** (migration 089): `RecursosPage` + tabla `recursos`. Patrimonio del negocio (no para vender). 2 tabs: Patrimonio / Por adquirir. Stats, alertas garantía, CTA proveedores.
- **Estructura en ingreso**: InventarioPage (modal ingreso) + RecepcionesPage (por ítem) — select de estructura que precarga la default del producto y guarda `estructura_id` en `inventario_lineas`.

### Fixes
- Banner DEV más fino (h-4) y sin overlap sobre header/sidebar.
- Badge estado_pago en cards de OC en ProveedoresPage.
- WhatsApp en EnviosPage: faltaba `telefono` en join de clientes.

### Housekeeping
- CLAUDE.md: reducido a ~120 líneas. Reglas de lectura/escritura wiki.
- Wiki: roadmap con v1.7.0, v1.8.0, v1.8.1. Plan multi-sucursal documentado.

### Plan aprobado — Multi-sucursal (pendiente implementar)
- Filtrado estricto: `.eq()` cuando sucursal activa, sin filtro para vista global.
- Agregar "Vista global" al SucursalSelector.
- Catálogo global, stock/movimientos/ventas/gastos/caja por sucursal, clientes globales.
- Datos NULL: solo visibles en vista global.
- Ver detalle en `wiki/features/multi-sucursal.md`.

**Estado al cierre:**
- PROD: v1.8.0 ✅ · DEV: v1.8.1 · Migrations DEV: 001–089 · PROD: 001–088
- Migration 089 (`recursos`): aplicar en PROD al deployar v1.8.1

---

## [2026-05-07] update | Limpieza CLAUDE.md + reglas wiki + roadmap v1.7.0/v1.8.0

**Cambios de sesión (2026-05-07):**

### CLAUDE.md — reescritura completa
- Reducido de ~1.500 líneas a ~120 líneas
- Eliminado: todo el historial de versiones (v0.26–v1.8.0), todas las secciones "Backlog pendiente" y "Decisiones de arquitectura" — ya están en el wiki
- Conservado: stack, git/deploy, Supabase IDs, estructura de proyecto, convenciones operacionales, planes, env vars, dominios, gotchas clave
- Agregado: sección "Wiki — Reglas de oro" con instrucciones de lectura al inicio y escritura al cierre de sesión. Unicidad de documentación en el wiki.

### Wiki roadmap.md actualizado
- Agregadas secciones v1.7.0 (API pull, migration 087) y v1.8.0 (NC electrónicas, email CAE, migration 088)
- Backlog actualizado: removidos ítems ya completados, agregados pendientes reales actuales
- Historial comprimido en tabla para versiones <v1.3.0

### Estado al cierre
- PROD: **v1.8.0** ✅ · DEV: **v1.8.0** ✅ (confirmado — era caché del browser)
- `main` branch: APP_VERSION = v1.6.0 (pero Vercel sirvió v1.8.0 correctamente)
- `dev` branch (código): **v1.8.0**

---

## [2026-05-06] update | Migración al SSD + consolidación docs — todo listo para compact

**Cambios de sesión (2026-05-06):**

### Migración de paths
- App movida: `E:\OneDrive\...\stockapp` → `D:\Dev\Genesis360` (SSD, fuera de OneDrive)
- Vault movido: `D:\Obsidian\boveda\Genesis360` → `D:\Dev\Genesis360\G360.Wiki` (dentro del repo)
- `npm install` ejecutado en nueva ubicación — build OK (`✓ built in 30.21s`)

### Consolidación de documentación
- `docs/` eliminado de la app — 8 archivos movidos a `G360.Wiki/sources/raw/`
- `G360.Wiki/CLAUDE.md` renombrado a `_schema.md` — evita confusión con CLAUDE.md de la app
- `Bienvenido.md` actualizado con nueva estructura y referencias
- `G360.Wiki/` commiteada en git (rama `dev`, commit `94b09930`)

### Paths actualizados
- `_schema.md`: código fuente apunta a `D:\Dev\Genesis360`
- Memory files: `project_genesis360.md` y `project_wiki_system.md` actualizados con nuevos paths y v1.6.0
- `index.md`: fuentes en raw/ documentadas

### Estado de cierre de sesión
- Versión PROD: v1.6.0 · 85 migraciones · 46 páginas wiki
- Sin pendientes en el wiki
- Listo para /clear o /compact

---

## [2026-05-06] update | Reestructura del vault — consolidación de fuentes

**Cambios estructurales:**
- `CLAUDE.md` renombrado a `_schema.md` — evita confusión con el CLAUDE.md de la app
- `Bienvenido.md` y `_schema.md` actualizados para reflejar el nuevo nombre y aclarar la diferencia
- `sources/raw/` poblado con los 8 archivos de `D:\Dev\Genesis360\docs/`:
  - `arquitectura_escalabilidad.md`
  - `reglas_negocio.md`
  - `uat.md`
  - `genesis360_overview.html`, `soporte_*.html` (×4)
- `index.md` actualizado con la tabla de fuentes
- `D:\Dev\Genesis360\docs/` se mantiene en la app (fuente original, no se borró)

**Regla de flujo confirmada:**
- Desarrollo → actualizar `CLAUDE.md` / `ROADMAP.md` en `D:\Dev\Genesis360\`
- Al terminar sesión → pedir "actualizá el wiki" → Claude sincroniza las páginas relevantes
- Consulta → abrir Obsidian en `G360.Wiki/`

Para ver las últimas 5 entradas: `grep "^## \[" log.md | tail -5`

---

## [2026-05-05] update | v1.5.0 + v1.6.0 — Notificaciones, Caja Fuerte, PDF AFIP, OC pagos, CC Proveedores

**Versiones detectadas como nuevas:** v1.5.0 (migration 084) y v1.6.0 (migration 085).  
**Fuentes leídas:** CLAUDE.md (líneas 1395-1441) + ROADMAP.md (encabezado + secciones v1.5.0/v1.6.0).

**Páginas actualizadas:**
- `wiki/features/facturacion-afip.md` — recreada (estaba en 0 bytes) + PDF con QR AFIP v1.5.0 ✅
- `wiki/features/caja.md` — diferencia apertura inline, Tab Caja Fuerte, Tab Configuración, getTipoDisplay, historial sesiones
- `wiki/features/alertas.md` — nuevas secciones OC vencidas (rojo) y próximas ≤3d (ámbar), badge actualizado
- `wiki/features/gastos.md` — Tab "Órdenes de Compra" con modal pago/CC, badges contextuales
- `wiki/features/clientes-proveedores.md` — pago CC inline FIFO + módulo CC Proveedores completo
- `wiki/business/roadmap.md` — v1.5.0 + v1.6.0 completos, versión actualizada a v1.6.0
- `wiki/database/migraciones.md` — migrations 084 + 085
- `wiki/overview/genesis360-overview.md` — v1.4.0 → v1.6.0, 83 → 85 migraciones, notificaciones en módulos

**Páginas nuevas:**
- `wiki/features/notificaciones.md` — módulo completamente nuevo: tabla, campana, email, diferencia caja

**Estado final:** 46 páginas · 85 migraciones documentadas · v1.6.0

---

## [2026-05-01] update | Wiki completo — sin pendientes

**Acción:** Finalización completa del wiki. Todas las páginas actualizadas, 6 páginas nuevas desde docs/.

**Páginas actualizadas (thin → completas):**
- `wiki/features/ventas-pos.md` — 3 modos, pago parcial, combos, CC, multi-LPN, scanner, carrito draft, QR MP
- `wiki/features/inventario-stock.md` — Sprints A/B/C/D, autorizaciones DEPOSITO, conteos, masivo inline, LPN madre
- `wiki/integrations/mercado-pago.md` — preapproval model, QR ventas, add-on, routing webhook, IDs PROD
- `wiki/overview/genesis360-overview.md` — v1.4.0, tabla módulos completa, arquitectura actualizada

**Páginas nuevas desde docs/:**
- `wiki/architecture/escalabilidad.md` — costos, capacidad escala, cola jobs, workers, Sentry, cloud
- `wiki/architecture/pwa-config.md` — Service Worker, WASM, SPA routing Vercel
- `wiki/development/reglas-negocio.md` — reglas relevadas con GO (caja, ventas, inventario) + UAT
- `wiki/business/mercado-objetivo.md` — SMB/mid-market LatAm, posicionamiento vs Blue Yonder
- `wiki/business/roadmap.md` — ya existía, sin cambios
- `wiki/integrations/resend-email.md` — ya existía, sin cambios

**Fuentes procesadas en total:**
- CLAUDE.md (1.461 líneas)
- ROADMAP.md (490 líneas)
- WORKFLOW.md (172 líneas)
- README.md (150 líneas)
- docs/arquitectura_escalabilidad.md (163 líneas)
- docs/reglas_negocio.md (335 líneas)
- docs/uat.md (196 líneas)

**Estado final:** 44 páginas wiki · 83 migraciones documentadas · v1.4.0 · sin pendientes

---

## [2026-05-01] update | Poblado completo desde CLAUDE.md + ROADMAP.md + WORKFLOW.md

**Acción:** Lectura completa de los 4 archivos de documentación de la app (1461 líneas CLAUDE.md, 490 ROADMAP.md, 172 WORKFLOW.md, 150 README.md) y creación masiva de páginas wiki.

**Páginas creadas/actualizadas:**
- `wiki/integrations/mercado-libre.md` — OAuth, mapeo, webhooks, sync worker, items OMNI
- `wiki/integrations/tienda-nube.md` — OAuth, webhooks, tn-stock-worker, BATCH_SIZE 200
- `wiki/features/facturacion-afip.md` — AfipSDK, tipos A/B/C, FacturacionPage 4 tabs, homologación confirmada
- `wiki/features/rrhh.md` — 5 fases completas con schema, funciones SQL, UI
- `wiki/features/caja.md` — sesiones, tipos de movimiento, multi-caja, traspasos, arqueos
- `wiki/features/gastos.md` — variables, fijos, IVA, comprobantes, múltiples medios
- `wiki/features/devoluciones.md` — serializado/no-serializado, NC, rollback, caja
- `wiki/features/wms.md` — fases 1-4, KITs, conteos, recepciones/ASN, mono-SKU
- `wiki/features/clientes-proveedores.md` — CRM, CC, domicilios, OC, servicios
- `wiki/features/envios.md` — estados, remito PDF, WhatsApp Click-to-Chat
- `wiki/features/autenticacion-onboarding.md` — OAuth, roles, session timeout, Mi Cuenta
- `wiki/features/marketplace.md` — API pública, webhook, rate limiting
- `wiki/architecture/estado-global.md` — authStore, useSucursalFilter, usePlanLimits, hooks
- `wiki/database/migraciones.md` — 83 migraciones con descripción (001-083)
- `wiki/development/testing.md` — 154+ unit tests, 14 archivos E2E, todos los roles
- `wiki/development/convenciones-codigo.md` — reglas, patterns, TypeScript, RLS
- `wiki/development/supabase-dev-vs-prod.md` — flujo completo, secrets, pg_cron
- `wiki/business/roadmap.md` — historial v0.26–v1.4.0, backlog detallado
- `index.md` — actualizado con todas las páginas y estados

**Estado del proyecto confirmado:** v1.4.0 en PROD · 83 migraciones · 154+ unit tests

---

## [2026-04-30] init | Wiki inicializado desde exploración del código fuente

**Acción:** Inicialización completa del wiki Genesis360.

**Qué se hizo:**
- Exploración del código fuente en `E:\OneDrive\Documentos\01_Gastón\04_Emprendimientos\04_StockApp\stockapp\stockapp`
- Creación de `CLAUDE.md` (schema y reglas del wiki)
- Creación de `index.md` (catálogo inicial de páginas)
- Creación de estructura de carpetas: `sources/`, `wiki/` y subcarpetas
- Creación de página de overview principal
- Creación de páginas de arquitectura, features y development

**Estado del proyecto al momento de la inicialización:**
- Versión activa en producción
- 83 migraciones de DB
- 26 Edge Functions
- ~80 archivos TypeScript/TSX
- Planes: Free / Basic ($4.900 ARS) / Pro ($9.900 ARS) / Enterprise

**Páginas creadas en este init:**
- `wiki/overview/genesis360-overview.md`
- `wiki/architecture/frontend-stack.md`
- `wiki/architecture/backend-supabase.md`
- `wiki/architecture/multi-tenant-rls.md`
- `wiki/architecture/edge-functions.md`
- `wiki/features/inventario-stock.md`
- `wiki/features/ventas-pos.md`
- `wiki/features/suscripciones-planes.md`
- `wiki/development/workflow-git.md`
- `wiki/development/deploy.md`
- `wiki/database/schema-overview.md`
- `wiki/integrations/mercado-pago.md`
