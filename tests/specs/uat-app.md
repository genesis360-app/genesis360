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

### H5 — 🛑 Devolución de seña al ANULAR: iba a la caja equivocada y fallaba en silencio (CERRADO 2026-09-06)

**Encontrado corriendo la regresión de las Tandas F/E, con datos reales — no por inspección.** El spec
`137_ventas_anulacion_supervision_mutante` falló 2 de 2 veces en el paso "revierte caja". La venta
quedaba `cancelada`, el stock se reincorporaba bien… y **el egreso de caja que devuelve el efectivo
cobrado NO se creaba**. El ingreso de la venta sí estaba → **la caja quedaba inflada por el monto
cobrado, en silencio**.

**Causa raíz** (`VentasPage.tsx`, rama `cancelada` de `cambiarEstado`):

```ts
const cancelSesionId = sesionCajaId ?? (sesionesAbiertas.length > 0 ? sesionesAbiertas[0].id : null)
if (cancelSesionId) { try { …insert egreso… } catch {} }
```

`sesionesAbiertas` **mezcla monedas** y su query **no tiene `ORDER BY`**, así que `[0]` podía ser la
sesión de la **Caja USD** → se intentaba asentar un reintegro en pesos en una caja en dólares. Verificado
contra la DB: el último `egreso_devolucion_sena` correcto es del **2026-09-02**, y en DEV se abrió una
**Caja USD el 2026-09-04**. Desde ahí, ninguna anulación volvió a generar su egreso.

Y encima fallaba **mudo**, por dos caminos: `if (cancelSesionId)` sin `else`, y un `catch {}` vacío que
se tragaba cualquier error. Más el `void supabase…insert(…)` fire-and-forget de la pata no-efectivo.
Eso es exactamente lo que prohíbe la **obligación #4 de la REGLA #0** ("todo movimiento de EFECTIVO se
asienta en caja — awaiteado + aviso si falla, nunca fire-and-forget ni silencioso").

**Fix**: se elige la sesión de la lista **`sesionesArs`** (respetando `sesionCajaId` solo si es de
pesos), el guard previo exige una caja **EN PESOS** (antes bastaba "cualquier caja abierta"), la pata
no-efectivo pasa a estar `await`eada, y **todos** los caminos de falla avisan con un toast que dice el
monto y el motivo, pidiendo registro manual. Verificado: el spec 137 vuelve a pasar y la Venta #684
asentó su `egreso_devolucion_sena` de $1.234 en **Caja1 (ARS)**.

⚠ **Queda abierto (nuevo)**: si la venta se cobró en **efectivo USD**, el reintegro al anular no se
contempla en ninguna rama (`efectivoCobrado` solo suma `tipo === 'Efectivo'`, que es pesos). Hay que
relevarlo con GO.

✅ **Desvío de DEV regularizado (autorizado por GO, 2026-09-06).** Las ventas #679 y #682 de las dos
corridas fallidas habían quedado con su `ingreso` y sin el `egreso_devolucion_sena` → $2.468 de más en
Caja1. Se asentaron los dos egresos faltantes en **la misma sesión donde había caído el ingreso**
(Caja1, ARS, abierta) y por el mismo monto, con el concepto marcado como *"regularización manual (bug
caja USD)"* para que quede auditable. Saldo de la sesión: **$33.395** (era $35.863 con el desvío).

**Auditoría de barrido**: se buscaron TODAS las ventas canceladas del tenant con cobro en efectivo que
tuvieran `ingreso` sin su `egreso_devolucion_sena` → **0 resultados**. No había más huérfanos que esos
dos. La consulta queda como control reusable:

```sql
-- ventas canceladas con cobro en efectivo cuyo ingreso NO tiene su egreso de devolución
with cancel as (select numero from ventas where estado='cancelada'
                 and coalesce(monto_pagado,0)>0 and medio_pago ilike '%Efectivo%')
select c.numero from cancel c
where exists (select 1 from caja_movimientos where tipo='ingreso' and concepto='Venta #'||c.numero)
  and not exists (select 1 from caja_movimientos where tipo='egreso_devolucion_sena'
                   and concepto like '%Venta #'||c.numero||'%');
```

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

### ✅ Tanda D — RESILIENCIA: categoría COMPLETA que no existía (abierta y CERRADA el 2026-09-06)

**Origen**: la base de DEV se cayó (instancia `t4g.nano` saturada, CPU 94% / Disk IO 97%). Investigando el
tráfico apareció que **~650 de las ~5.000 requests de 24 h eran una sola pestaña de Chrome reintentando
`POST /auth/v1/token?grant_type=refresh_token`**, casi todas fallando con 5xx de Cloudflare. Una sesión
vencida del 4/9 quedó en bucle de reintentos sin freno. El resto del tráfico legítimo eran decenas de
requests. **La app amplificó la caída que la estaba rompiendo.**

**Por qué NINGÚN test lo detectó — y no es un descuido puntual, es una capa entera que falta:** las 142
specs e2e son todas **funcionales** (¿anda la feature cuando todo lo demás anda?). Corren siempre contra un
backend sano. **Cero specs ejercitan condiciones degradadas**: backend lento, backend caído, 5xx sostenido,
sesión vencida, red intermitente. Un bug que solo se manifiesta cuando el backend falla es, por
construcción, invisible para esta suite. Verificado con grep: ni una spec menciona `refresh_token`, sesión
expirada, offline ni reintentos.

Escenarios a cubrir:
- ✅ **D1 — Refresco de sesión con backend caído** (CERRADO 2026-09-06, ver abajo).
- ✅ **D2 — Sesión vencida con pestaña abierta** (CERRADO 2026-09-06, spec 142).
- ✅ **D3 — Backend 5xx sostenido** (CERRADO 2026-09-06, spec 142).
- ✅ **D4 — Red intermitente** online/offline/online (CERRADO 2026-09-06, spec 142).
- ✅ **D5 — Pestaña dormida / reanudada** (CERRADO 2026-09-06, spec 142).

#### ✅ D2 a D5 — CERRADOS (2026-09-06) · `tests/e2e/142_resiliencia_backend_degradado.spec.ts`

Primera spec del repo que **intercepta la red del browser** (`page.route`, `context.setOffline`) en vez
de necesitar un backend roto de verdad: es determinista, no le agrega carga a DEV y no depende de que
algo esté caído. Verificado con grep que ninguna spec usaba estas APIs — la capa no existía.

**Y el resultado es buena noticia: la app se porta BIEN en condiciones degradadas.** El caso anómalo
era D1, y estaba en auth-js, no en la capa de React Query.

| Escenario | Qué se verifica | Medido |
|---|---|---|
| **D2** | Refresh token inválido (400 `invalid_grant`) → cae en `/login` **sola** y deja de pedir | ≤1 refresco extra tras llegar a login |
| **D3** | Backend 503 sostenido en todas las consultas, 30 s de pantalla quieta | **0 requests** (techo 20) |
| **D4** | Sin red no martilla, y al volver **se recupera sola sin recargar** | **0** offline · >0 al reconectar |
| **D5** | Pestaña dormida y reanudada: revalida sin tormenta | **14 requests** al despertar (techo 60) |

**Hallazgo de D4**: React Query usa `networkMode: 'online'` por default, así que sin red **pausa** las
queries en vez de dispararlas y verlas fallar. Es exactamente lo contrario de lo que hacía auth-js en
D1. Queda afirmado como propiedad para que nadie lo rompa sin darse cuenta.

**Los techos son barandas anti-regresión, no descripciones de un problema**: si alguien saca el
`retry: 1` global, cambia el `networkMode` o mete un `refetchInterval` agresivo, saltan acá. Se
calibraron corriendo la spec con los presupuestos en 0 para ver el valor real y conocer el margen.

> ⚠ **Método que hay que repetir en toda spec de condiciones degradadas**: cada presupuesto va con un
> control **anti-falso-verde** (`toBeGreaterThan(0)`) que prueba que el intercept se activó. Sin eso,
> un intercept mal escrito hace pasar el test **por vacío**. Pasó de verdad escribiendo esta spec: D4
> daba verde con 0 requests fallidas porque, con la pantalla quieta, la app no pide nada y el corte de
> red no ejercitaba nada.

#### ✅ D1 — CERRADO (2026-09-06)

**Diagnóstico verificado contra los logs de edge de DEV, no inferido.** Últimas 24 h: **595 requests** a
`POST /auth/v1/token?grant_type=refresh_token` — 452 con **522**, 49 con **504**, 45 con **521**, 16 con
**524**, 1 con **525**, y solo **32 con 200**. El 100 % eran `grant_type=refresh_token` (ninguna era login).
Distribución por hora: ~65 requests/hora sostenidas entre las 19 h y las 00 h del 5/9 — **cinco horas
seguidas sin rendirse**. Eso descarta la hipótesis de que auth-js descarte la sesión ante un 52x: el bucle
es infinito.

**Causa raíz en auth-js 2.98** (leída en `node_modules/@supabase/auth-js`, no de memoria):
- ticker cada 30 s (`AUTO_REFRESH_TICK_DURATION_MS`) que **nunca se detiene**;
- hasta ~7 reintentos con backoff **dentro de cada tick** (200, 400, 800… ms);
- **no existe contador de fallos entre ticks** → nada corta el bucle.
- Además `NETWORK_ERROR_CODES` solo contempla 502/503/504: los 52x de Cloudflare (que son los que
  realmente llegan) caen fuera de su lógica de reintento.

**Fix** — `src/lib/authRefreshBreaker.ts` (cortacircuitos) + cableado en `src/lib/supabase.ts` +
`src/components/AvisoSesionSinRefresco.tsx`. NO se toca auth-js ni su config: se envuelve el `fetch` del
cliente y se intercepta **únicamente** ese endpoint.
1. Backoff exponencial con jitter ±20 % entre intentos reales: 2 s → 4 → 8 → … tope 5 min.
2. Con el circuito abierto el intento se corta **localmente**: cero tráfico de red.
3. Tras 10 fallos consecutivos se rinde y no vuelve a salir a la red hasta que el usuario decida.
4. El cortocircuito devuelve **503 a propósito**: es el único rango que auth-js trata como reintentable, y
   por lo tanto el único que **no** le hace borrar la sesión guardada. Deliberado: un cajero en medio de una
   venta no puede quedar deslogueado por un blip de 30 s (REGLA #0).
5. Un **400/401** (`invalid_grant`, refresh token revocado) **no** abre el circuito: es respuesta
   definitiva y auth-js hace el login limpio, que es lo correcto.
6. La UI avisa sin bloquear: franja discreta al 2º fallo, tarjeta con **Reintentar** / **Volver a entrar**
   cuando se rindió. "Volver a entrar" usa `signOut({ scope: 'local' })` — no sale a la red, justo cuando
   la red es el problema.

**Cobertura**: `tests/unit/authRefreshBreaker.test.ts`, 19 tests. El de regresión reproduce la caída real
del 5/9 (ticker cada 30 s durante 5 h = 600 intentos) y exige **10 requests de red en total** en vez de 600,
y estado final `rendido`.

**Foto de datos**: ninguna — es lógica pura de cliente con reloj, aleatorio y `fetch` inyectados. Corre
determinístico, sin tenant ni backend. (Es justamente lo que pedía la nota de método: un verde
reproducible.)

**Lo que este fix NO cubre** (queda para D2-D5): que la UI reaccione a un backend caído en las consultas de
datos (no solo en el refresco de sesión), la pestaña dormida y reanudada, y la red intermitente.

### 🟥 Tanda E — STRESS / CARGA: tampoco existe (abierta 2026-09-06)

Cero cobertura de carga sostenida. Nunca se midió cuántos usuarios concurrentes aguanta, ni con qué tamaño
de instancia, ni qué se rompe primero. Con el primer cliente real a 2 semanas, esto deja de ser teórico.

- **E1 — Concurrencia real**: N usuarios operando a la vez (venta + caja + inventario) sin errores.
- **E2 — Techo de la instancia**: a partir de qué carga se satura, para dimensionar el compute.
- **E3 — Volumen de datos**: comportamiento con un catálogo y un historial de tamaño realista, no de demo.
- **E4 — Consultas caras**: identificar las N más pesadas (pg_stat_statements) y ponerles presupuesto.

#### ✅ Primera pasada de Tanda E (2026-09-06)

**Instrumento nuevo**: `scripts/stress-lectura.mjs` (`npm run stress:lectura`). Simula N sesiones
concurrentes con el mix de LECTURAS que hace la app al navegar y reporta p50/p95/p99, RPS y errores.
Solo GET, no escribe nada; se niega a correr contra PROD o con >20 usuarios sin `--si-se-que-hago`.

**E1 — concurrencia ✅ medido** (DEV, compute MICRO, 5 cuentas reales de distinto rol):

| Concurrencia | RPS | Errores | p50 | p95 |
|---|---|---|---|---|
| 5 sesiones · 20 s | 49,8 | **0** | 78 ms | 267 ms |
| 20 sesiones · 25 s | 86,3 | **0** | 112 ms | 1.461 ms |

Sin un solo error en ninguna de las dos. A 20 concurrentes el p95 se dispara y **es casi todo una
sola consulta** (ver E4-h2): el resto de los listados se queda abajo de 250 ms.

**E2 — techo: NO se buscó a propósito.** Saturar la instancia es destructivo y DEV es el ambiente de
trabajo de GO. El instrumento ya está y admite la carga que se le pida (`--usuarios N
--si-se-que-hago`) — **falta acordar con GO cuándo correrlo**.

**E3 — volumen ✅ medido, y el resultado es el hallazgo**: la base ENTERA de DEV (los 10 tenants
juntos) tiene 881 productos, 821 ventas, 2.026 ítems de venta, 1.657 movimientos de stock. Un
comercio real hace 821 ventas en dos semanas. **Nunca se probó nada a escala real** — todos los
números de arriba son con una base de demo, así que son un piso optimista.

**E4 — consultas caras ✅ dos hallazgos, uno arreglado:**

- ✅ **E4-h1 — `ventas` ordenada por fecha: ARREGLADO (mig 395).** `EXPLAIN ANALYZE` real: para
  devolver **20** ventas el plan leía **las 662 del tenant** y recién después ordenaba (top-N
  heapsort) — el `LIMIT` no podía cortar antes. O(n) sobre el historial completo, en cada carga.
  `ventas` tenía 13 índices y ninguno servía para ese orden, que usan **14 lugares del frontend**.
  Índice compuesto `(tenant_id, created_at DESC)` → **17,0 ms → 1,14 ms**, y lee 20 filas en vez de
  662 (deja de crecer con el historial). End-to-end en la sonda: `ventas` p50 **277 → 78 ms**, p95
  **435 → 96 ms**; el total pasó de 35,8 a **49,8 req/s** con la misma concurrencia.

- 🔴 **E4-h2 — `venta_items` castiga a los usuarios restringidos por sucursal (SIN arreglar).**
  `venta_items` no tiene `sucursal_id`, así que su policy resuelve la sucursal con un
  `EXISTS (SELECT 1 FROM ventas v WHERE v.id = venta_items.venta_id AND ...)`. Postgres lo convierte
  en un **hashed SubPlan que materializa TODAS las ventas visibles del tenant** antes de devolver la
  primera fila. Medido con el mismo query: **DUEÑO 2,1 ms · CAJERO 48,0 ms (24×)** — el DUEÑO
  cortocircuita en `auth_ve_todas_sucursales()` y nunca ejecuta el subplan; el cajero sí, y construye
  el hash de las 558 ventas para devolver 50 ítems. Es el causante del p95 de 1,4 s a 20 concurrentes.
  ⚠ **Cuidado con medir esto como DUEÑO: da 2 ms y parece sano.** Escala O(ventas del tenant) por
  query. Dos caminos, los dos necesitan decisión de GO: (a) denormalizar `sucursal_id` en
  `venta_items` (rápido, pero es backfill + trigger sobre una tabla fiscal), o (b) índice de cobertura
  para que el subplan se arme sin tocar el heap (aditivo y sin riesgo, pero mejora menos).

**De paso, corrección de documentación**: `pg_cron` y `pg_net` **SÍ están habilitados** en DEV y PROD
(1.6.4 / 0.20.0), con 3 jobs activos en DEV. Eso explica el `tn-fulfillment-worker` que corría "133
veces por día sin que nadie lo mire": es el job `tn-fulfillment-sync`, `*/5 * * * *`, `active=true`.
El wiki ya lo tenía bien; era la memoria del asistente la que decía "pg_cron NO habilitado".

### 🟧 Tanda F — ROLES: cobertura existe pero es SOLO client-side (pedido de GO 2026-09-06)

Ya hay specs por rol (`13_rol_cajero`, `15_rol_supervisor`, `16_rol_rrhh`, `17_rol_deposito`,
`18_rol_contador`) y verifican positivo y negativo: qué rutas entran, cuáles redirigen, qué links del
sidebar NO se ven. **Pero todo se valida por UI.** Eso choca de frente con el hallazgo **H1** de este mismo
documento ("Controles financieros SOLO client-side") y con la obligación #3 de la REGLA #0: los guards
tienen que estar server-side ADEMÁS de en la UI, porque la UI se cachea y se bypassea.

- **F1 — Negativo server-side por rol**: que un CAJERO no pueda ejecutar por REST/RPC directo lo que la UI
  le esconde. Es la prueba que falta: hoy nadie verifica que la DB lo rechace, solo que el botón no esté.
- **F2 — Matriz completa por rol**: DUEÑO ve todo; SUPERVISOR/CAJERO/DEPÓSITO/RRHH/CONTADOR **solo lo
  configurado**, y nada más. Hoy la cobertura es despareja entre roles.
- **F3 — Roles custom** (`rol_custom_id`) con permisos a medida.
- **F4 — Aislamiento por sucursal cruzado con rol** (ver `reference_rls_por_sucursal`).

#### ✅ Primera pasada de Tanda F (2026-09-06) — spec `141_roles_server_side_matriz.spec.ts`

Spec API-only (sin browser): pega a PostgREST con el `access_token` real de CAJERO, DEPÓSITO, RRHH y
CONTADOR. **Todas las sondas son NO MUTANTES** — UPDATE con el mismo valor (`[]` = RLS bloqueó ·
fila = RLS dejó escribir), INSERT con clave única duplicada (`42501` = bloqueó · `23505` = pasó, y no
inserta nada), y el RPC de cierre pidiendo el mes en curso (que la regla rechaza siempre) para
distinguir un rechazo por ROL de uno por regla de negocio.

**Lo que SÍ está protegido server-side** (9 tests verdes, valen como regresión): configuración del
negocio (`tenants`), escalada de privilegios editando `users`, lectura de la Caja Fuerte
(`boveda_retiros`), `set_clave_maestra`, `marcar_incobrable`, el guard de rol de `cerrar_periodo`
(CONTADOR sí / operativos no) y **F4: ningún rol operativo de Sucursal Norte ve `ventas`,
`caja_sesiones` ni `gastos` de Sur** (la spec 94 solo cubría SUPERVISOR).

**🟥 Lo que NO está protegido — verificado en los 4 roles.** Van en la spec con `test.fail()`: la
aserción correcta hoy falla, Playwright los da en verde mientras el hueco siga abierto y **hace
fallar la corrida el día que se cierren**, que es cuando hay que sacarles el `test.fail()`.

- ✅ **F1-h1 — CERRADO (mig 394): cerrar un período contable salteando el RPC.** `cerrar_periodo()`
  validaba el rol… y la policy de `cierres_contables` era `FOR ALL` por tenant a secas. Un CAJERO
  podía hacer `POST /rest/v1/cierres_contables` directo y **congelar un mes contable entero** (los
  triggers de período cerrado bloquean después toda edición de gastos/ventas de ese mes). El guard
  existía y se esquivaba escribiendo la tabla. Ahora la tabla es **solo lectura** vía RLS: se escribe
  únicamente por los RPC `SECURITY DEFINER`. Verificado que el camino legítimo sigue vivo (DUEÑO
  cierra y reabre por RPC) y que la lectura no se rompió.
- ✅ **F1-h2 — CERRADO (mig 396): cambiar el PRECIO DE VENTA de un producto.**
- ✅ **F1-h3 — CERRADO (mig 396): editar el MONTO de un gasto** — enforzando el **umbral**, no el rol.
- ✅ **F1-h4 — CERRADO (mig 396): dar de alta productos.**
- ✅ **F1-h5 — CERRADO (mig 396): crear/renombrar medios de pago** (config).
- ✅ **F1-h6 — CERRADO (mig 396), HALLAZGO NUEVO y el más grave de los cuatro:** `roles_custom` era
  escribible por **cualquier usuario del tenant**. Alguien con un rol custom podía **auto-otorgarse**
  `'editar'` sobre cualquier módulo y saltear todos los guards de arriba. Un guard que confía en un
  dato que el atacante controla no es un guard — por eso esta tabla se cierra PRIMERO en la migración.

#### Cómo se cerraron h2-h6 (mig 396) sin romper nada

Ninguno se podía cerrar con RLS a secas: **`VentasPage` actualiza `productos.stock_actual` desde el
cliente** en devoluciones y anulaciones, así que un "CAJERO no escribe productos" corta ventas reales.
Y en gastos el CAJERO edita legítimamente **por debajo de su umbral**. Entonces:

- **`productos`** → trigger `BEFORE INSERT OR UPDATE` que mira **solo las columnas de precio**
  (`precio_venta`, `precio_costo`, `precio_marketplace`, `precio_usd`, `precio_costo_usd`,
  `margen_objetivo`). Un UPDATE de `stock_actual` pasa; uno que mueve el precio, no.
- **`gastos`** → se enforcea el **umbral del CAJERO** (espejo exacto de `evaluarUmbralGasto`), más el
  bloqueo de los roles que no operan Gastos (DEPÓSITO/RRHH/Lector) y del alta para CONTADOR —que sí
  edita campos fiscales de un gasto ya creado—. ⚠ El umbral del **SUPERVISOR** queda a propósito
  fuera: el supervisor es quien **aplica** la autorización de un cajero, y enforzarlo rompería una
  aprobación legítima cuando el monto pedido supera también su propio umbral. Cerrarlo requiere antes
  mover la aplicación de autorizaciones a un RPC (patrón de las migs 236/237/238) — **sigue abierto**.
- **`metodos_pago`** y **`roles_custom`** → RLS: lectura para todo el tenant, escritura solo gestión.
- **Roles custom (F3)**: el helper `auth_puede_editar_modulo()` espeja `puedeEditarModulo` del front,
  así que un rol custom en `'ver'`/`'no_ver'` queda bloqueado aunque su rol base pudiera. Verificado
  con datos reales: `cajero1@local.com` tiene el rol custom `GO_Cajero` con `inventario: 'ver'`.

**Verificación (lo que evita el falso verde):** las sondas negativas se corren con un valor **DISTINTO**
—con el mismo valor el trigger no se dispara y todo "pasa"— y hay 4 tests **positivos** que son los que
detectan un guard pasado de estricto: el CAJERO sigue escribiendo `stock_actual`, un UPDATE que no
cambia el precio pasa, DUEÑO/SUPERVISOR sí cambian precios (y el precio queda restaurado), y el
CONTADOR sigue editando campos de un gasto. Las tres ramas del umbral (bajo / sobre / sin umbral) se
verificaron por impersonación SQL con un cajero sin rol custom.

#### 🔴 F2 — matriz de LECTURA por rol (2026-09-06): acá aparecieron los hallazgos más serios

La Tanda F había mirado solo **qué escribe** cada rol. La otra mitad es **qué lee**. Sonda con tokens
reales de los 6 roles sobre 14 tablas sensibles. De 18 tablas sensibles auditadas, **solo 4 tienen
alguna policy que mire el rol**.

| Tabla · columna | Antes | Ahora |
|---|---|---|
| `mercadopago_credentials.access_token` + `refresh_token` | 🔴 lo leían **todos** los roles | ✅ 403 (mig 400) |
| `tiendanube_credentials.access_token` | 🔴 lo leían **todos** | ✅ 403 (mig 400) |
| `whatsapp_credentials.access_token` | 🔴 legible (0 filas en este tenant, pero sin protección) | ✅ 403 (mig 400) |
| `emisores_fiscales.afipsdk_token` | 🔴 lo leen todos (2 de 4 emisores tienen uno cargado) | 🔴 **abierto** |
| `rrhh_salarios.basico/neto` | 🔴 los leía **cualquier rol**, incluido CAJERO | ✅ **cerrado (mig 401)** |
| `empleados.salario_bruto`, `cbu`, `dni_rut` | 🔴 sueldo, cuenta bancaria y DNI de cada empleado | ✅ **cerrado (mig 401)** |
| `tenant_certificates.cert_key_path` | 🟠 ruta de la clave privada AFIP, legible por todos | 🟠 abierto |
| `ai_tenant_memoria`, `boveda_retiros` | ✅ solo DUEÑO | ✅ |

**Lo grave del caso Mercado Pago**: con ese token se opera la cuenta de MP del comercio (cobros,
devoluciones) **desde afuera de Genesis360**. El comentario en `src/lib/supabase.ts` decía *"access_token
nunca expuesto al frontend"* — y era cierto **en la interfaz TypeScript**, que no lo declara. Pero una
interfaz no es un control de acceso: PostgREST devuelve la columna que le pidas. La protección existía
solo en el tipo.

**Fix (mig 400)**: privilegios a nivel **columna**. Se revoca el SELECT de tabla y se re-otorga columna
por columna salteando los secretos (en PostgreSQL no se puede "restar" una columna de un grant de
tabla). Impacto cero verificado: las tres consultas de `ConfigPage.tsx` usan listas explícitas que no
incluyen el token, y `service_role` queda intacto para las Edge Functions. Ojo: con `select('*')`
PostgREST expande a todas las columnas y daría 403 — por eso hay un test que lo cubre.

**Lo que queda abierto y por qué:**
- `emisores_fiscales.afipsdk_token`: mismo fix, pero el panel de Emisores hace `select('*')` y **edita**
  el token, así que revocar la columna rompe la pantalla. Hay que pasar antes a listas explícitas.
#### ✅ Visibilidad de RRHH — CERRADA (mig 401), regla aprobada por GO el 2026-09-07

> **DUEÑO / ADMIN / SUPER_USUARIO / RRHH ven todo · SUPERVISOR ve su equipo · cada empleado ve lo
> suyo · las pantallas de COSTOS leen agregados.**

No se podía cerrar con privilegios de columna como la mig 400: los privilegios de columna son por rol
de **base de datos** (`authenticated`), no por rol de la app — revocar `salario_bruto` se lo sacaría
también a RRHH, que lo necesita. Acá el gate correcto es **RLS por fila**.

Lo que exigió el cambio, y por qué no era mecánico: cinco pantallas leían esas tablas.

| Consumidor | Qué necesitaba | Cómo quedó |
|---|---|---|
| `RrhhPage`, `RrhhReportesPanel` | detalle completo | acceso directo (rol RRHH) |
| `MiPortalPage` | su propia ficha y sus liquidaciones | rama "cada empleado ve lo suyo" |
| `RepartidoresPanel`, `useRecomendaciones` | nombre, teléfono, cumpleaños | **`fn_empleados_basico()`** — sin sueldo/CBU/DNI |
| `DashGastosArea`, `RentabilidadPage`, `CierresContablesPanel` | **solo suman** `neto` | **`fn_sueldos_agregado()`** — totales, nunca filas |

`fn_sueldos_agregado` está gateada a los roles que ya ven reportes de plata (DUEÑO/ADMIN/
SUPER_USUARIO/SUPERVISOR/CONTADOR/RRHH): un CAJERO recibe 403.

**Verificado (28 sondas)**: CAJERO/DEPÓSITO/CONTADOR ven **0 filas** de `empleados` y `rrhh_salarios`;
DUEÑO y RRHH siguen viendo todo; `fn_empleados_basico` devuelve datos para los 6 roles y **no expone**
sueldo/CBU/DNI; `fn_sueldos_agregado` responde a los 4 roles de reportes y da 403 a CAJERO y DEPÓSITO.

**F2 sigue parcialmente abierto**: la matriz de escritura cubre 4 roles × 12 operaciones, no todo.

> **Nota de método para las tres tandas**: hay que definir y documentar **con qué foto de datos** corre cada
> escenario (tenant, sucursales, catálogo, usuarios por rol, estado de caja). Sin fixture explícito, un
> resultado verde no es reproducible — y ya hay antecedente de que esta suite no es determinística bajo
> carga (ver `reference_e2e_suite_no_deterministica`).

---

## 4) Ya validado por e2e mutante (specs 19-44)
Ver la tabla §30 en `uat-modo-basico.md` (se migrará acá con tags). Resumen: venta directa/no-efectivo/reserva,
caja apertura/cierre, devolución, facturación AFIP, **NC fiscal (42)**, **producto alícuota 10,5% (43)**,
**presupuesto crear→convertir (44)**, gasto efectivo, cobranza CC, recepción→stock, traslado, cheques,
Caja Fuerte, devolución a proveedor (crédito CC), OC creación+recepción, conteo (DUEÑO directo), RRHH nómina→gasto,
envío→combustible, condonación CC, incobrable con clave, set clave maestra hash.
