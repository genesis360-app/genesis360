---
name: uat-app
description: UAT maestro de Genesis360 (básico + avanzado, con tags por modo/flag). Consolida el inventario de cobertura (5 secciones en tests/specs/cobertura/) + hallazgos transversales REGLA #0 + backlog priorizado de gaps. Estructura aprobada por GO (2026-06-21).
type: project
---

# UAT maestro — Genesis360

> **Estructura (decidida con GO 2026-06-21):** un único UAT con escenarios **etiquetados por modo y flag**,
> en vez de archivos básico/avanzado separados (el modo solo gatea UI, no datos → duplicar se desincroniza).
> - `[BÁSICO]` / `[AVANZADO]` / `[AMBOS]` — modo de operación.
> - `[CFG:<flag>=valor]` — el escenario depende de una configuración del tenant.
> - `uat-primer-uso.plan.md` queda APARTE (smoke de alta + paridad DEV↔PROD, se corre antes de cada cliente).
>
> **Migración del UAT viejo:** `uat-modo-basico.md` (~300 escenarios manuales + la tabla §30 de e2e mutantes
> 19-44) sigue siendo válido; sus escenarios se migran/etiquetan a este archivo de forma incremental a
> medida que se tocan. NO está duplicado todavía — este archivo es el índice maestro + backlog + hallazgos.

## Cómo se valida (capas, de más fuerte a más débil)
1. **e2e mutante** (Playwright vs DEV): aserción POSITIVA del resultado **+ verificar la mutación en DB** con SQL. Nunca solo `.not.toBeVisible()`.
2. **unit** (vitest): lógica pura.
3. **UAT click-through manual** (acá): cuando el e2e es frágil (PDFs, impresión, AFIP runtime, integraciones, visual, concurrencia).
4. **code-audit**: leer el código contra la regla.

**Para flags:** cada flag necesita ≥2 escenarios — CON y SIN (o por cada valor del enum) — verificando el efecto real.

---

## 1) Índice de cobertura (inventario detallado por módulo)

La enumeración exhaustiva (lógicas + matriz de flags con CON/SIN + cruce con tests) vive en `tests/specs/cobertura/`:

| Sección | Archivo | Lógicas | Flags | Cubre |
|---------|---------|:------:|:-----:|-------|
| 01 | `cobertura/01_ventas_productos_facturacion.md` | 60 | 27 | Ventas/POS · Productos · Presupuestos/Reservas · Facturación AFIP |
| 02 | `cobertura/02_inventario_conteos.md` | 44 | 14 | Inventario/WMS · Conteos · Recepciones · Traslados |
| 03 | `cobertura/03_caja_clientes_gastos.md` | 55 | 36 | Caja/Bóveda · Clientes/CC · Gastos |
| 04 | `cobertura/04_compras_oc_envios.md` | 43 | 40 | Compras/OC/Proveedores · Envíos |
| 05 | `cobertura/05_rrhh_config_suscripcion.md` | 62 | 25 | RRHH · Configuración · Suscripción/Plan · Roles/Permisos · Modo |
| **Total** | | **~264** | **~142** | (≈ las 140 columnas de config de `tenants`) |

**Patrón de cobertura hallado:** la **lógica pura está muy bien cubierta por unit (52 tests)**; los **flujos
runtime con efecto en DB (plata/stock) y los flags CON/SIN están casi sin cubrir por e2e** — los e2e
existentes corren un único camino feliz con el valor default de cada flag. **Ahí está el grueso del gap.**

---

## 2) 🟥 Hallazgos transversales REGLA #0 (verificados) — AVISO a GO

> Detectados por la auditoría y **verificados contra el código** (no asumidos). Varios conviene **arreglar
> antes** de escribir e2e que validen el comportamiento (porque el comportamiento debería cambiar).

> **✅ ESTADO 2026-06-21 (v1.81.0 EN PROD, PR #236, migs 234-238):** **H1 y H2 CERRADOS server-side.**
> Guards: 234 `fn_ventas_cc_guard` (límite+morosidad) · 235 `fn_ventas_writeoff_rol_guard` (rol) · 236
> `marcar_incobrable()` (rol+clave server-side+write-off atómico) · 237 `registrar_pago_oc()` (doble firma
> server-side+pago atómico, **cierra "se omite si no hay clave"**) · 238 `marcar_envios_pagados()` (ídem
> courier). El **comprobante de gasto** se reordenó (sube antes del INSERT → `comprobante_url` atómico;
> **GO eligió reorder sin trigger** porque un trigger blanket rompería ~13 inserts de gastos automáticos).
> **Queda (residual, no bloqueante):** ~~descuento máx por rol~~ ✅ + ~~H3 contrastado~~ ✅ (2026-06-21) +
> ~~H4 flags huérfanos~~ ✅ mayormente (2026-06-22, ver §H4: solo `precio_redondeo` diferido a su sesión),
> Tanda A e2e. Detalle en `log.md` [2026-06-21]/[2026-06-22] y `project_pendientes.md`.

> **✅ 2026-06-21 (sesión siguiente, sin migración — solo frontend + validación):**
> - **Descuento máx por rol — CERRADO (decisión: NO guard server-side, SÍ cerrar el hueco client-side):**
>   se descartó un trigger/RPC porque (a) el override por clave maestra del DUEÑO no es replicable en un
>   trigger (la venta la crea igual el CAJERO → un hard-block server rompería el flujo autorizado), (b) los
>   descuentos por ítem viven en `venta_items` (insertados DESPUÉS de `ventas`) y los descuentos por **monto**
>   se pliegan al `subtotal` → **invisibles** a un trigger BEFORE INSERT en `ventas`, y (c) un descuento sobre
>   tope NO viola la integridad fiscal/contable (la venta queda consistente: total, IVA, caja y CC correctos)
>   → fuera del scope estricto de la REGLA #0; es un control de autorización, no un invariante de plata.
>   **En cambio se cerró el HUECO REAL del enforcement client-side:** un descuento por **$ (monto)** esquivaba
>   el tope **%** del SUPERVISOR/canal (el check solo miraba `descuento_tipo==='pct'`). Ahora se convierte
>   todo descuento a su **% efectivo** (`descuentoEfectivoPct`) y se valida con `validarDescuentosPorRol`
>   (lib pura en `ventasValidation.ts`, +18 unit). El override por clave maestra sigue igual (CON clave →
>   autoriza; SIN clave → bloquea). `descuento_max_cajero_pct` sigue inerte (cajero 100% bloqueado) → su
>   decisión queda en **H4**.
> - **H3 (clave maestra CON vs SIN) — CONTRASTADO + validado server-side en DEV.** Ver la matriz §H3 abajo.
>
> **✅ 2026-06-22 (frontend, sin migración) — follow-up (a) descuento por-ítem read-only:**
> Decisión de GO: **descuento por-ítem = SOLO combos; el descuento manual del operador va por "Descuento
> general".** El input de descuento por-ítem del POS (`VentasPage`) pasó a **read-only** (toggle %/$ deshabilitado,
> hint "auto (combos)" / "por combo"): lo escribe únicamente la lógica de combos (`aplicarCombo` / auto-combo).
> Cierra la inconsistencia: antes, en un tenant **sin combos**, el auto-combo no corría (`if (!combosDisp.length) return`)
> y un valor manual por-ítem persistía; con combos, el auto-combo lo strippeaba. Ahora es uniforme. La matemática
> del subtotal/IVA (`getItemSubtotal`) no cambió. Los e2e 45/48 usan "Descuento general" (`max="100"`) → no afectados.
> **UAT:** verificar que (1) el input por-ítem no acepta tipeo manual; (2) un combo de 1 SKU aplica su descuento y
> se ve "por combo"; (3) el descuento manual sigue disponible vía "Descuento general" para DUEÑO/SUPERVISOR/ADMIN.

### H1 — Controles financieros SOLO client-side (choca con REGLA #0 obligación #3) 🟥🟥
El enforcement de **límite CC, morosidad/bloqueo CC, condonación de deuda, baja por incobrable, descuentos
y comprobante de gasto obligatorio** vive en el **frontend**. Server-side solo existen `fn_gastos_iva_guard`
(mig 227) y el hash de clave (mig 233). Ante **bundle cacheado o escritura por API**, esos topes se saltan.
→ **Recomendación (aprobada por GO 2026-06-21): guards server-side (triggers/RPC SECURITY DEFINER)** antes de un cliente que use CC en serio. **Implementar guard por guard, cada uno testeado en DEV** (es el hot-path de plata — un guard mal hecho bloquea ventas legítimas).

> **✅ HECHO en DEV (mig 234, 2026-06-21): guard de CC (`fn_ventas_cc_guard`, BEFORE INSERT en `ventas`)** — límite (B1) + morosidad (B4). Verificado con 8 escenarios (S1-S8) todos verdes: límite bloquear sobre→bloquea / dentro→ok / avisar→no bloquea; presupuesto→skip; no-CC→ok; moroso bloqueo_total→bloquea (hasta no-CC); bloqueo_cc→bloquea solo CC. **Hallazgo clave:** `cliente_cc_estado` filtra por `auth.uid()` y devuelve 0 sin sesión → el guard computa la deuda **inline scopeada por `NEW.tenant_id`** (robusto ante service-role/API/batch). **PROD ⏳** (deploy junto con el resto de guards + OK de GO; cambia comportamiento: hard-block donde antes solo la UI).
>
> **✅ HECHO en DEV (mig 235, 2026-06-21): guard de ROL para write-offs (`fn_ventas_writeoff_rol_guard`, BEFORE UPDATE en `ventas`)** — exige rol DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN cuando se agrega un tag `Condonación CC`/`Incobrable` nuevo. Verificado por impersonación (W1-W4): DUEÑO condona→ok, CAJERO condona→bloquea, CAJERO cobranza normal→ok, CAJERO incobrable→bloquea. **Pendiente (separado):** la **clave maestra del incobrable se omite si no está configurada** y se verifica solo client-side → cerrarlo requiere refactor de condonar/incobrable a **RPC SECURITY DEFINER** (verifica rol + clave + write-off atómico) + cambio de frontend; es una decisión aparte (¿condonación también debería pedir clave?).
>
> **Falta del set H1/H2 (NO cleanly-triggereables — necesitan cambio de frontend, agrupar como tanda "hardening frontend-coupled"):**
> - **Comprobante de gasto obligatorio** — VERIFICADO 2026-06-21: en un gasto nuevo `comprobante_url` se setea en un UPDATE **posterior** al INSERT (sube el archivo con el `gastoId` ya creado, `GastosPage.tsx:1296-1300`). Un trigger BEFORE INSERT vería null y **bloquearía todo gasto con archivo**. Fix: reordenar el frontend (generar `gastoId` client-side + subir archivo + INSERT con `comprobante_url` ya seteado) y recién ahí un trigger puede enforzar; o RPC.
> - **Doble firma OC/courier** (H2) + **clave del incobrable** — RPC clave-gated (ver H2).
> - **Descuento máx por rol** — ✅ **RESUELTO 2026-06-21 (NO guard server-side; hueco client-side cerrado).** Conclusión: no es cleanly-triggereable (override por clave no replicable en trigger; descuentos por ítem/monto invisibles a un trigger en `ventas`) y NO es un invariante de plata (la venta queda consistente). Se cerró el hueco real: descuentos por **$** ahora se convierten a **% efectivo** y se validan contra el tope %/canal (`validarDescuentosPorRol` + unit). Ver el bloque "✅ 2026-06-21" al inicio de §2.
>
> **Conclusión:** los 2 guards cleanly-triggereables (CC límite/morosidad + write-off rol) están HECHOS. El resto es frontend-coupled → tanda deliberada con su propia batería de tests, no triggers sueltos.

> **Diseño verificado del guard de CC (mig futura, BEFORE INSERT en `ventas`, `fn_ventas_cc_guard`):**
> - Saltar si `estado='pendiente'` (presupuesto) o `cliente_id IS NULL`.
> - **`montoCC` = suma de los medios `tipo='Cuenta Corriente'` en `NEW.medio_pago` (JSON), NO `total − monto_pagado`** (el crédito a favor y el envío lo distorsionan) — espeja `VentasPage.tsx:2327`.
> - `cliente_cc_estado(NEW.cliente_id)` → `deuda_total`, `deuda_vencida`.
> - **Morosidad (B4):** si `deuda_vencida > 0.5`: `cc_morosidad_politica='bloqueo_total'` → RAISE (cualquier venta); `'bloqueo_cc'` + `es_cuenta_corriente` → RAISE.
> - **Límite (B1):** solo si `es_cuenta_corriente` + `montoCC>0.5` + `cc_enforcement_politica='bloquear'` (NO 'avisar' — ese es confirm de UX, no se enforza en server): `limite = clientes.limite_credito ?? tenants.limite_cc_default`; si `limite IS NOT NULL` y `deuda_total+montoCC > limite+0.5` → RAISE.
> - EPS = 0.5. Lógica pura espejada en `src/lib/ccLogic.ts` (evaluarLimiteCC/evaluarMorosidad, ya con unit). **Probar en DEV:** bajo límite (ok), sobre límite+bloquear (raise), sobre+avisar (NO raise), moroso bloqueo_total (raise), bloqueo_cc CC (raise) vs no-CC (ok), presupuesto (ok), venta con crédito a favor (montoCC correcto).

### H2 — Doble firma por umbral bypasseable + solo-UI 🟥
Los guards de **pago de OC y de courier** sobre umbral exigen clave maestra **solo si el tenant tiene clave
seteada**; si supera el umbral pero no configuró clave, el pago grande pasa **sin segunda firma, en silencio**
(`GastosPage.tsx:721-727`, `EnviosPage.tsx:788`). Guard solo-UI.

> **Naturaleza (verificado 2026-06-21):** la doble firma ES la verificación de la clave maestra → **no es
> trigger-able** (un trigger no puede validar una clave chequeada antes en el cliente). Opciones:
> - **(A) RPC refactor (correcto, server-side real):** mover el pago de OC/courier a un RPC SECURITY DEFINER
>   que reciba la clave, la verifique y haga el pago atómico. Cierra también el "se omite si no hay clave"
>   (el RPC exige clave cuando el monto supera el umbral). Cambio mayor: frontend (llamar RPC) + backend +
>   re-test de los flujos de pago de OC/courier. Misma forma que la clave del incobrable.
> - **(B) Fix de consistencia client-side (rápido, parcial):** si hay umbral de doble firma pero NO hay
>   `clave_maestra` configurada, la UI debe exigir configurar la clave (o bloquear el pago sobre umbral) en
>   vez de saltear el guard en silencio. No es server-side, pero elimina el bypass más probable.
> **Recomendación:** (A) como hardening real, agrupado con la clave-via-RPC del incobrable (mismo patrón) en
> una tanda "RPCs clave-gated", hecha con calma + su propia batería de tests. (B) como mitigación inmediata.

### H3 — Clave maestra CON vs SIN — ✅ CONTRASTADO 2026-06-21
Con `clave_maestra = null` se apaga el segundo factor; el comportamiento NO es uniforme (algunos gates
bloquean igual, otros siguen de largo solo con el rol). Mapeado y validado server-side en DEV.

**Primitivo compartido `verificar_clave_maestra(tenant, clave)` (mig 233) — validado en DEV (Almacén Jorgito):**
clave correcta → `true`; clave incorrecta → `false`; `NULL` → `false`; **tenant SIN clave configurada → `true`
SIEMPRE** (contrato: "no hay clave = no se exige"). Todos los gates heredan este contrato.

**RPC `marcar_incobrable` (mig 236) — validado por impersonación SQL en DEV (transacción + ROLLBACK):**
DUEÑO + clave correcta → ejecuta · DUEÑO + clave incorrecta → `42501 Clave maestra incorrecta.` ·
CAJERO + clave correcta → `42501 No autorizado: requiere rol DUEÑO/ADMIN` (el rol se chequea ANTES que la clave).
⇒ el gate vive **server-side**, no es bypasseable por bundle cacheado/API.

**Matriz CON vs SIN clave (verificada contra código/migs):**

| Acción | CON clave configurada | SIN clave configurada | Dónde |
|--------|----------------------|----------------------|-------|
| Pago OC ≥ umbral doble firma | pide clave; incorrecta → bloquea | **BLOQUEA** + "configurá una clave" | RPC `registrar_pago_oc` (237) |
| Pago courier ≥ umbral | ídem | **BLOQUEA** + "configurá una clave" | RPC `marcar_envios_pagados` (238) |
| Dar de baja incobrable | pide clave (rol DUEÑO/ADMIN) | **pasa sin clave** (solo rol) | RPC `marcar_incobrable` (236) |
| Override de descuento sobre tope | pide clave → autoriza | **BLOQUEA** (no se puede exceder) | `VentasPage` (client) |
| Anular venta despachada | pide clave | **pasa sin clave — ahora VISIBLE** (toast 🔓 "autorizado por tu rol") | `VentasPage` (client) |
| Cambiar cliente / devolución de venta cobrada | pide clave | **pasa sin clave — ahora VISIBLE** (toast 🔓) | `VentasPage` (client) |
| Cerrar caja ajena / abrir con diferencia | pide clave | **pasa sin clave — ahora VISIBLE** (note gris en el modal de cierre) | `CajaPage` (client) |
| Saltar doble conteo (reconteo) | pide clave | **pasa sin clave — ahora VISIBLE** (texto del modal aclara "solo por tu rol") | `InventarioPage` (client) |

> **✅ Follow-up (b) HECHO 2026-06-22 (frontend, sin migración):** el estado "sin clave" ahora es VISIBLE en las
> acciones rol-only (decisión GO: rol-only + mostrar estado, sin forzar). `pedirClaveMaestra` (VentasPage)
> emite un toast 🔓 informativo cuando no hay clave; CajaPage muestra una nota gris en el cierre de caja ajena;
> InventarioPage aclara en el modal de reconteo; ConfigPage muestra el badge "○ Sin configurar — acciones
> sensibles autorizadas solo por rol". typecheck + build verdes.

**Patrón (NO es bug, es semántica a confirmar con GO):** la clave maestra es un **segundo factor OPT-IN**.
Donde hay un **límite numérico configurado** que se está excediendo (umbral de doble firma, tope de descuento)
→ SIN clave **bloquea** (el límite manda; no se puede exceder sin el 2º factor). Donde es una **acción
patrimonial discrecional sin umbral** (anular, incobrable, cerrar caja ajena, saltar reconteo) → SIN clave
**el rol es el único gate** (la clave es endurecimiento opcional). Coherente, pero la inconsistencia "algunos
bloquean / otros siguen" no estaba documentada ni testeada → ahora sí.

> **▶ Decisión para GO (H3, no bloqueante):** ¿las acciones "pasa sin clave" (anular despachada, cerrar caja
> ajena, devolución de venta cobrada) deberían **avisar/forzar configurar la clave** cuando el negocio
> claramente quiere el 2º factor, o se dejan rol-only by-design? Hoy son rol-only si no hay clave. Los pagos
> grandes (OC/courier sobre umbral) ya toman la postura fuerte (bloquean) porque ahí el dinero es mayor.

### H4 — Flags huérfanos / rotos — ✅ MAYORMENTE CERRADO 2026-06-22 (sin migración, solo frontend)
| Flag | Estado | Resolución 2026-06-22 |
|------|--------|-----------------------|
| `descuento_max_cajero_pct` | tope ilusorio (cajero 100% bloqueado) | ✅ **QUITADO del frontend** (Config + hints muertos en VentasPage). El cajero queda siempre bloqueado (regla C3/G3). Columna DB queda inerte. |
| `email_legal` | sin lector | ✅ **QUITADO del frontend** (GO delegó la decisión; rec = quitar: `tenant.email` ya cubre comprobantes/emails, sin caso de uso). Columna DB queda inerte. |
| `boveda_umbral_caja` | sin lector | ✅ **IMPLEMENTADO como alerta no-bloqueante**: cuando una caja operativa ABIERTA supera el umbral de efectivo → alerta "conviene depositar a la Caja Fuerte". Helper puro `cajasSobreUmbralBoveda` (+4 unit) compartido por `useAlertas` (badge) y `AlertasPage` (no divergen). Ambos modos. No muta plata. |
| `rrhh_*` (6 flags: tardanza_modo, tardanza_tolerancia_min, horas_mes_base, horas_extra_requiere_aprobacion, doc_alerta_dias, nomina_supervisor_aprueba) | leídos en RrhhPage, sin setter | ✅ **TAB RRHH DE CONFIG CONSTRUIDO** (los inputs de esos 6). Los otros `rrhh_*` (doble_validacion, portal, notif_config, vacaciones_aviso/remanente) **YA tenían setter** dentro de RrhhPage — el audit sobreestimaba "~11". |
| `conteo_modo='elegir'` | "semi-implementado" | ✅ **NO ERA BUG** — verificado: Config ofrece las 3 opciones y el runtime muestra el toggle Rápido/Guiado al crear el conteo (`InventarioPage:5040`). El finding estaba stale. |
| `recepcion_alerta_faltante_dias` | ni set ni read en src (solo DB) | columna muerta — no se construyó (GO no la pidió, valor mínimo). Limpiar la columna en una pasada de DB. |
| `precio_redondeo` | sin lector | ⏳ **DIFERIDO a su propia sesión** (fiscal + amplio — el precio entra por retail/mayorista/USD/edición manual y la factura/IVA derivan de él). Plan: helper puro `redondearPrecio(precio,modo)` + unit, aplicado en el punto canónico del precio unitario efectivo. **El más valioso, el más riesgoso → no rushear.** |

### H5 — Otros (fiscal/stock)
- **Kits — ✅ NO es bug (by-design, confirmado con GO 2026-06-21):** el rebaje de componentes ocurre **al ARMAR el kit** (kitting: reserva → rebaja componentes + ingresa 1 kit al stock, `InventarioPage.tsx:1360`); desarmar (des_kitting) reingresa componentes. **Vender el kit rebaja solo el stock del kit terminado** — los componentes ya se rebajaron al armar, volver a rebajarlos sería doble conteo. El hallazgo del agente era falso positivo.
- **EF descuento global solo `console.warn`:** si un descuento/recargo global no está prorrateado en ítems, la EF avisa pero **no bloquea** → riesgo de comprobante con total ≠ suma de ítems (AFIP 10048).
- **ConfigPage:** el tab `rrhh` **ya NO es placeholder** (construido 2026-06-22); quedan `alertas`/`notificaciones` como placeholders vacíos. `handleSaveBiz` persiste ~100 columnas de golpe sin importar el tab (condiciona cómo se testea "guardar tab X").

---

## 3) Backlog priorizado de gaps (qué e2e crear)

### 🟥 Tanda A — REGLA #0 sin e2e (PRIMERO, decidido con GO)
1. **§29 matriz fiscal RUNTIME** — `condicion_iva_emisor` RI/Mono/Exento × emitir CAE real (A/B/C) + rechazo 400 del guard FAC-27 / emisor↔letra (hoy solo en la EF, sin e2e). *(requiere AFIP homologación)*
2. **Límite/morosidad CC** — `limite_cc_default` + `cc_enforcement_politica=bloquear` corta la venta CC sobre el tope (con efecto en DB). **+ evaluar guard server (H1).**
3. **Clave maestra CON vs SIN** (H3) — ✅ contrato CON/SIN **documentado + validado server-side en DEV** (matriz §H3: primitivo `verificar_clave_maestra` + RPC `marcar_incobrable` por impersonación). *Falta solo el e2e click-through como usuario (toggle de clave del tenant) — incluir en esta Tanda A.*
4. **Autorización de ajuste de inventario por rol ≠ DUEÑO** (2 actores: solicita→no muta→aprueba→muta). — ✅ **VALIDADO e2e (spec `51_autorizacion_ajuste_aprobar_mutante`, 2026-06-22):** spec 47 cubre "solicita" (SUPERVISOR→pendiente, sin mutar); ésta cubre "aprueba" → el DUEÑO aprueba una `ajuste_conteo` pendiente (esperado 126→contado 127, solicitada por "Supervisor Test") → DB: `inventario_lineas.cantidad` 126→127 + `stock_actual` 250→251 + `movimientos_stock` ajuste_ingreso x1 + `estado='aprobada'`/`aprobado_por`=DUEÑO≠solicitante (verificado). El stock muta **solo al aprobar**. Fixture SQL = autorización pendiente sobre LPN-MNB85SGE de "Coca Cola 1.5L Original" (re-sembrar; skip-guard si ausente). **🐛 Fix de UI hallado durante el e2e (2026-06-22):** la lista de Autorizaciones rotulaba `ajuste_conteo` y `bulk_edit` como **"Eliminar LPN"** (`tipoLabel` en `InventarioPage` no los cubría → caía al `else`); un DUEÑO veía "Eliminar LPN" al aprobar lo que en realidad SUMA stock. Corregido: label "Diferencia de conteo"/"Edición masiva" + color naranja/azul + detalle esperado→contado / campos. typecheck+build verdes.
5. **Conteo gate por umbral + doble conteo (reconteo)** CON/SIN flag.
6. **Over-receipt** (`permite_over_receipt`+pct) CON vs SIN (bloquea exceso) — ✅ **VALIDADO e2e (spec `52_over_receipt_bloquea_mutante`, 2026-06-22):** con `permite_over_receipt=false`, recibir 7 contra una OC de pedido 5 (producto simple, sin lote/venc) → guard B3 (`superaOverReceipt` cableado en `RecepcionesPage.guardar`) BLOQUEA con "…supera lo permitido sobre lo pedido (5)" y NO crea recepción (DB: OC sigue `confirmada`, 0 recepciones, recibido_acum=0 — sin inflar stock/costo). La **matriz de decisión CON/SIN tope** ya está en unit (`recepcionLogic.test.ts`: sin-exceso / exceso+no-permite / permitido-sin-tope / dentro-vs-fuera-del-pct); el **efecto stock+estado OC del éxito** ya está en spec 35. Fixture SQL = OC #16 confirmada (Mayorista Pepe, Sprite x5) sin recepciones (re-sembrar; skip-guard si ausente). *Falta (Tanda B): B1c over/under requiere SUPERVISOR (no-supervisor recibe ≠ pedido → bloquea) + camino CON-dentro-de-tope con efecto stock por UI.*
7. **Gate de pago de OC** (efectivo→caja / no-efectivo→informativo / CC→deuda+límite; saldo no excedible) + **doble firma** (H2).
8. **Pagar nómina** (RPC `pagar_nomina_empleado` → caja/CC, efectivo↔caja) — ✅ **VALIDADO e2e (spec `50_rrhh_pagar_nomina_mutante`, 2026-06-22):** pago en efectivo de una liquidación impaga desde Caja Principal → toast "Nómina pagada" + DB: `rrhh_salarios.pagado=true`/`medio_pago`/`caja_movimiento_id` + `caja_movimientos` egreso $100 "Nomina … - 06/2026" (verificado). Fixture SQL = empleado inactivo "ZZZ Nomina Test" + salario neto $100 (re-sembrar para re-correr; skip-guard si ausente). **FK `rrhh_salarios.caja_movimiento_id → caja_movimientos` impide borrar el egreso de una nómina paga (integridad OK).** *Falta (Tanda B): doble validación rol≠DUEÑO, medio no-efectivo, liquidación final.*
9. **Descuento máx por rol** (`descuento_max_supervisor_pct`) bloquea sobre el tope. ✅ enforcement client-side cerrado (incl. descuentos por $ vía % efectivo, `validarDescuentosPorRol` + unit); *falta solo el e2e click-through (SUPERVISOR sobre tope → bloquea / clave autoriza).*
10. **Devolución a proveedor formas efectivo (→caja) y reposición (→OC borrador)** · **crédito a favor de cliente** · **intereses CC (sweep)**.

### 🟧 Tanda B — operativo importante
- Reservas: seña mínima/penalidad/vencimiento (flags) · presupuesto vencido bloquea convertir.
- RRHH: tardanza descontada en liquidación · asistencia/fichado · vacaciones · liquidación final.
- Envíos: crear/POD/reparto · pago a courier tercero (`envio_courier_genera_gasto`) → gasto+caja.
- Suscripción/trial/gating Pro + límites de plan (`max_users`/`max_productos`) + redirect SubscriptionGuard.
- Conteo wall-to-wall bloqueante cross-página · reconciliación por delta con venta intercalada.

### 🟢 Tanda C — capa manual (no e2e)
PDFs/impresión (factura/NC/remito/presupuesto/recibo/etiquetas), PWA, integraciones reales (couriers B2B,
MELI/TN), visual PROD, concurrencia.

### ⚠ Gotcha UX (no bloqueante, ya documentado)
Convertir presupuesto a despachada **desde el Historial** con 2+ cajas abiertas y sin caja preferida no
expone selector de caja → callejón sin salida. Fix sugerido: exponer el selector en el modal de saldo.

---

## 4) Ya validado por e2e mutante (specs 19-44)
Ver la tabla §30 en `uat-modo-basico.md` (se migrará acá con tags). Resumen: venta directa/no-efectivo/reserva,
caja apertura/cierre, devolución, facturación AFIP, **NC fiscal (42)**, **producto alícuota 10,5% (43)**,
**presupuesto crear→convertir (44)**, gasto efectivo, cobranza CC, recepción→stock, traslado, cheques,
Caja Fuerte, devolución a proveedor (crédito CC), OC creación+recepción, conteo (DUEÑO directo), RRHH nómina→gasto,
envío→combustible, condonación CC, incobrable con clave, set clave maestra hash.
