---
name: cobertura-02-inventario-conteos
description: Auditoría de cobertura — grupo Inventario / WMS / Conteos / Recepciones / Traslados. Enumera TODA lógica + matriz de flags del tenant (con/sin) cruzada contra tests existentes, con gaps REGLA #0 priorizados.
type: cobertura
modulo: Inventario / WMS / Conteos / Recepciones / Traslados
fecha: 2026-06-21
marco: tests/specs/uat-cobertura.plan.md
---

# Cobertura 02 — Inventario / WMS / Conteos / Recepciones / Traslados

> Marco y convención: `tests/specs/uat-cobertura.plan.md` (§1 método, §3 matriz de flags).
> Leyenda cobertura: **✅e2e (NN)** · **✅unit** · **✅UAT(§)** · **🟡parcial** · **🔴gap**.
> REGLA #0 = movimientos que tocan stock/plata/fiscal → cero error tolerado.
> Capa más fuerte = e2e mutante (aserción POSITIVA **+** verificar la mutación en DB con SQL);
> nunca confiar en `.not.toBeVisible()` (falso-verde).

Archivos auditados: `src/pages/InventarioPage.tsx`, `src/pages/RecepcionesPage.tsx`,
`src/lib/ajusteAutorizacion.ts`, `src/lib/conteoAjuste.ts`, `src/lib/conteoAbc.ts`,
`src/lib/recepcionLogic.ts`, `src/lib/trasladoLogic.ts`, `src/lib/rebajeSort.ts`,
`src/components/TrasladosPanel.tsx`, `src/components/LpnAccionesModal.tsx`,
`src/components/MasivoModal.tsx`, `src/hooks/useConteoBloqueante.ts`.

---

## 1) Tabla de Lógicas

| # | Lógica | file:función / línea | ¿REGLA #0? | Cobertura actual |
|---|--------|----------------------|:----------:|------------------|
| L01 | Ingreso de stock (crea `inventario_lineas` + `movimientos_stock` tipo `ingreso`; mode-aware: básico LPN/ubic/estado NULL) | `InventarioPage.tsx:ingresoMutation` (1007-1149) | 🛑 stock | ✅e2e 23 (toast; no verifica DB) · 🟡 falta aserción DB |
| L02 | Rebaje/quitar stock (no negativo; bloquea si `cant > cantidad − reservada`) | `InventarioPage.tsx:rebajeMutation` (1151-1199); `stock_despues: Math.max(0,…)` (1187) | 🛑 stock | ✅e2e 71 (rebajar 9.999.999 > disponible → "Stock disponible insuficiente", no muta) |
| L03 | Guard mono-SKU en ubicación al ingresar | `InventarioPage.tsx` (1028-1051) | 🟠 inventario | 🔴 gap |
| L04 | Unicidad de LPN por tenant al ingresar | `InventarioPage.tsx` (1053-1066) | 🟠 inventario | 🔴 gap |
| L05 | Ingreso por series (1 línea + N `inventario_series`; 23505 → "ya existen") | `InventarioPage.tsx` (1096-1112) | 🟠 inventario | 🔴 gap |
| L06 | Fusión de LPNs (suma al destino, desactiva orígenes) | `InventarioPage.tsx:fusionarLineas` (929-976) | 🛑 stock | ✅code-verified 2026-06-25 (`stock_actual` conservado por trigger; **fix v1.90.1: el ledger asienta el par espejo `ajuste_ingreso`(dest)+`ajuste_rebaje`(orígenes) = neto 0** → reportes de movimientos ya no sobre-cuentan la fusión) |
| L07 | Asignar LPN madre / cambiar estado de línea | `InventarioPage.tsx:asignarMadre` (978-995), `cambiarEstadoLinea` (998-1005) | 🟠 inventario | 🔴 gap |
| L08 | Edición masiva de LPN (campos lote/venc/sucursal/prov) → directa o a autorización por rol | `InventarioPage.tsx:bulkEditarAtributos` (878-926); `requiereAuthAjuste(rol,cfg,false)` (882) | 🛑 stock/inventario | 🔴 gap e2e |
| L09 | Acciones individuales de LPN (editar/mover/ajustar cantidad) → directa o autorización por rol | `LpnAccionesModal.tsx:requiereAprobacion` (33) | 🛑 stock | 🔴 gap |
| L10 | Rebaje masivo (MasivoModal) ordenando líneas por regla de inventario | `MasivoModal.tsx` (190, 358); `getRebajeSort` | 🛑 stock | 🟡 unit (rebajeSort) · 🔴 e2e |
| L11 | **Orden de rebaje por regla de inventario** (FIFO/FEFO/LEFO/LIFO/Manual; jerarquía SKU > tenant > FIFO) | `rebajeSort.ts:getRebajeSort` (34-81) | 🛑 stock (qué stock sale) | ✅unit (rebajeSort.test, FEFO/LIFO/Manual/fallback) |
| L12 | Kits — desarmar KIT devuelve componentes al stock | `InventarioPage.tsx:desarmarKit` (1441-1502) | 🛑 stock | ✅e2e 75 (desarmar 1 → KIT −1, componente +3 receta×3, `kitting_log`, DB) |
| L13 | Kits — armar KIT consume componentes (recetas) | RPCs `iniciar_armado_kit`/`confirmar_armado_kit`/`cancelar_armado_kit` (mig 244); `InventarioPage.tsx` (1310/1372/1432) | 🛑 stock | ✅DB (sim+ROLLBACK v1.90.1: iniciar reserva 6 → confirmar Leche 16→10 + reserva→0 + KIT línea ×3 + log completado + movimientos; **ahora ATÓMICO vía RPC** — antes varios writes sueltos podían dejar componentes consumidos sin KIT). INVOKER → RLS aísla por tenant. Inverso del desarmar (e2e 75) |
| L14 | Stock por sucursal de kits/componentes (no usa `stock_actual` global) | `InventarioPage.tsx:kStock` (561-571) | 🛑 stock | 🔴 gap |
| L15 | **Conteo — alcance** (producto/ubicación/marca/categoría/sucursal) + snapshot esperada | `InventarioPage.tsx:conteoScopeFields` (1644-1654), carga (1555-1576) | 🛑 stock | ✅e2e 36 (solo "por producto") · 🔴 resto alcances |
| L16 | Conteo — modo rápido (precarga esperada) vs guiado/ciego (arranca vacío) | `InventarioPage.tsx` (238-240, 1571); fuerza rápido en básico (238) | 🟠 | 🔴 gap (solo rápido en 36) |
| L17 | Conteo — revelar esperado a ciegas (solo DUEÑO/SUPERVISOR) | `InventarioPage.tsx:puedeRevelarEsperado` (250) | 🟠 | 🔴 gap |
| L18 | **Conteo — gate de autorización por umbral** (gate inactivo→toda dif. aprueba; activo→solo sobre umbral u/%/$) | `conteoAjuste.ts:requiereAutorizacion/superaUmbral` (17-32); aplicado `InventarioPage.tsx:1793` | 🛑 stock | ✅unit (conteoAjuste) · 🔴 e2e |
| L19 | **Conteo — doble conteo / reconteo por umbral** (1er conteo supera umbral → exige recontar; skip con clave maestra) | `conteoAjuste.ts:requiereReconteo` (38-41); `InventarioPage.tsx:filasReconteoPendiente` (271-277), `intentarFinalizar` (1844+), `contadaEfectiva` (1666-1669) | 🛑 stock | ✅unit (requiereReconteo) · 🔴 e2e (skip por clave, flujo runtime) |
| L20 | **Conteo — autorización de ajuste POR ROL** (DUEÑO directo / 'siempre' aprueba / 'umbral' delega al gate) | `ajusteAutorizacion.ts` (15-39); combinado `InventarioPage.tsx:1794` | 🛑 stock | ✅unit (ajusteAutorizacion) · ✅e2e 36 (DUEÑO directo) · ✅e2e 47 (SUPERVISOR→pendiente) + **✅e2e 51 (2 actores: DUEÑO aprueba lo del SUPERVISOR, stock muta solo al aprobar, `aprobado_por`≠solicitante, DB)** |
| L21 | **Conteo — reconciliación por delta** (nuevo = vivo + (contada − snapshot); respeta ventas intermedias; nunca negativo) | `conteoAjuste.ts:reconciliarDelta` (48-50); aplicado `InventarioPage.tsx:1809-1810` (directo) y `779-781` (al aprobar) | 🛑 stock | ✅unit (**incluye venta-intercalada** `reconciliarDelta(8,7,10)=5`) · ✅code-verified 2026-06-24 (ambos paths leen `vivo` **fresco** de `inventario_lineas.cantidad` al aplicar/aprobar → la venta intercalada ya bajó el stock y el conteo aplica solo su delta encima, nunca pisa). e2e UI opcional |
| L22 | Conteo — aplicar ajuste finalizado (mov. `ajuste_ingreso/ajuste_rebaje`, motivo "Conteo de inventario", `stock_despues Math.max(0,…)`) | `InventarioPage.tsx:finalizarConteoYAplicar` (1752-1840) | 🛑 stock | ✅e2e 36 (+1, DUEÑO; DB manual) |
| L23 | Conteo — aprobar/rechazar autorización pendiente (aplica delta al aprobar) | `InventarioPage.tsx` aprobar (776-795), rechazar (~828-838) | 🛑 stock | ✅code-verified 2026-06-24 (aprobar `ajuste_conteo`: `vivo` fresco → `reconciliarDelta` → `update cantidad=nuevo, activo=nuevo>0` + `movimientos_stock` `ajuste_ingreso/rebaje` con `deltaReal` y `stock_antes/despues` frescos + `estado='aprobada'`) · ✅e2e 51 (2 actores, rama rol≠DUEÑO) |
| L24 | **Conteo wall-to-wall bloqueante** (scope=sucursal + flag → borrador `bloquea_movimientos=true` bloquea POS+ingreso+rebaje+traslado de la sucursal) | `InventarioPage.tsx:iniciaBloqueante` (1527-1531, 1578-1589); consumido por `useConteoBloqueante` en `InventarioPage` (1011,1155), `VentasPage` (141), `TrasladosPanel` (45) | 🛑 stock | ✅e2e 76 (conteo borrador bloqueante → "Venta directa" en el POS bloqueada; no muta). Pata POS validada; ingreso/rebaje/traslado comparten el mismo `useConteoBloqueante` |
| L25 | Conteo cíclico sugerido (ABC × última fecha de conteo × `conteo_ciclico_dias_a/b/c`) | `conteoAbc.ts:sugerirConteoCiclico` (85-107); `InventarioPage.tsx:5337-5339` | 🟢 | ✅unit (conteoAbc) |
| L26 | Clase ABC (Pareto 80/95 por valor de movimiento) | `conteoAbc.ts:clasificarABC` (27-45) | 🟢 | ✅unit (conteoAbc) |
| L27 | Reporte de exactitud/valorización del conteo | `conteoAbc.ts:reporteExactitud` (145-165) | 🟠 contable | ✅unit (conteoAbc) |
| L28 | Marcar `ultimo_conteo_at` de productos contados (alimenta cíclico) | `InventarioPage.tsx` (1774-1781) | 🟢 | 🔴 gap |
| L29 | **Traslado — crear/despachar** (sale stock origen, estado tránsito; roles DEPOSITO+) | `trasladoLogic.ts:puedeCrearTraslado` (10-13), `validarCantidadTraslado` (43-53); `TrasladosPanel.tsx` | 🛑 stock | ✅unit (trasladoLogic) · ✅e2e 30 (despacho) |
| L30 | **Traslado — disponible = cantidad − reservada** (no traslada reservado) | `trasladoLogic.ts:disponibleLinea` (35-37) | 🛑 stock | ✅unit |
| L31 | **Traslado — confirmar recepción** (entra stock destino, tipo `traslado`; destino o puedeVerTodas) | `trasladoLogic.ts:puedeConfirmarRecepcion` (21-32), `validarRecepcion`/`estadoDesdeRecepcion`/`totalFaltante` (64-82); `TrasladosPanel.tsx` | 🛑 stock | ✅unit · ✅e2e 30 (confirmar, DB) |
| L32 | Traslado — recepción parcial → `recibido_parcial` + faltante auditado | `trasladoLogic.ts:estadoDesdeRecepcion/totalFaltante` (74-82) | 🛑 stock | ✅unit · 🔴 e2e parcial |
| L33 | **Recepción → stock** (crea `inventario_lineas` + sube stock por trigger; sin OC exige proveedor) | `RecepcionesPage.tsx:guardar` (~504-640), B2 (455) | 🛑 stock | ✅e2e 29 (sin OC) · ✅e2e 35 (con OC) |
| L34 | **Recepción — over-receipt** (B3: exceso s/tope permitido bloquea según flag + %) | `recepcionLogic.ts:superaOverReceipt` (41-51); aplicado `RecepcionesPage.tsx:488` | 🛑 stock | ✅unit · ✅e2e 52 (SIN: bloquea) · ✅e2e 74 (CON +10%: acepta, stock 0→11, OC recibida, DB) |
| L35 | **Recepción — under-receipt / faltante** (B4: faltante acumulado exige motivo) | `recepcionLogic.ts:tieneFaltante` (54-56); aplicado `RecepcionesPage.tsx:493` | 🛑 stock | ✅unit · 🔴 e2e |
| L36 | **Recepción — ajuste de cantidad ≠ pedido requiere SUPERVISOR+** (B1c) | `recepcionLogic.ts:esAjusteCantidad` (59-61); aplicado `RecepcionesPage.tsx:466` (`esSupervisorPlus`) | 🛑 stock | ✅unit · 🔴 e2e rol cajero |
| L37 | **Recepción — estado de OC por acumulado** (B5: recibida / recibida_parcial / sin_recibir entre múltiples recepciones) | `recepcionLogic.ts:estadoOCdesdeRecibido` (23-33); aplicado `RecepcionesPage.tsx:648` | 🛑 stock + compras | ✅unit · ✅e2e 35 (1 recepción) · 🔴 e2e 2 recepciones parciales |
| L38 | Recepción — remito obligatorio (sube a Storage; bloquea confirmar si falta) | `RecepcionesPage.tsx:remitoObligatorio` (120, 501, 508-516) | 🟠 | 🔴 gap e2e CON/SIN |
| L39 | Recepción — alerta de costo del remito ≠ costo del producto (`compras_costo_alerta_pct`) | `RecepcionesPage.tsx:costoAlertaPct` (121), B6 (669) | 🟠 contable | 🔴 gap (fuera de scope de este grupo) |
| L40 | Recepción — actualizar costo del producto desde el remito | `RecepcionesPage.tsx` (`actualizar_costo`) | 🛑 contable | 🔴 gap |
| L41 | Trazabilidad write-time de despacho (`venta_item_despachos`) gobernada por `trazabilidad_asignacion` | `VentasPage.tsx:2719, 3861`; default ≠false = ON | 🟠 inventario | 🟡 code-audit |
| L42 | Límite de movimientos por plan (`puede_crear_movimiento`) bloquea ingreso/rebaje | `InventarioPage.tsx` (1012, 1156) | 🟢 | 🟡 (planLimits.test indirecto) |
| L43 | Solo-lectura por rol custom en Inventario (`moduloSoloLectura`) | `InventarioPage.tsx` (1009, 1153) | 🟢 | ✅unit (permisosModulo) |
| L44 | Importación masiva de productos con `regla_inventario` por SKU | `ImportarProductosPage.tsx` (234-236, 295) | 🟢 | 🔴 gap |

---

## 2) Matriz de Flags del tenant

> Notación: `flag` (default) · uso `file:line` · comportamiento **CON** · comportamiento **SIN** / por-valor · cobertura.
> Todos los flags afectan a **modo básico Y avanzado** salvo `conteo_modo` (se fuerza a 'rapido' en básico — `InventarioPage.tsx:238`).

### 🛑 Inventario / Conteos (REGLA #0 stock)

| Flag | Default | Uso file:line | Comportamiento CON | Comportamiento SIN / por-valor | Cobertura |
|------|---------|---------------|--------------------|--------------------------------|-----------|
| `regla_inventario` (tenant) | `'FIFO'` (mig 011) | `rebajeSort.ts:39`; `VentasPage:1245,2653,3665,3784`; `MasivoModal:190,358`; `InventarioPage:438` | Rebaja consumiendo por la regla: FEFO/LEFO por `fecha_vencimiento`, LIFO/FIFO por `created_at`, Manual por prioridad de ubicación | Sin valor → fallback `'FIFO'`. **Por valor**: cada uno de FIFO/FEFO/LEFO/LIFO/Manual da un orden distinto; FEFO/LEFO sin venc. → fallback FIFO | ✅unit (rebajeSort, 5 valores) · 🔴 **e2e: la venta saca el LPN correcto por regla** (mutación real) |
| `regla_inventario` (producto, override) | `null` | `rebajeSort.ts:39` (SKU gana sobre tenant) | El SKU usa su propia regla aunque el tenant tenga otra | `null` → usa la del tenant | ✅unit · 🔴 e2e |
| `ajuste_autorizacion_roles` (jsonb rol→modo) | `null` → DUEÑO 'directo', resto 'siempre' | `ajusteAutorizacion.ts:15-19`; `InventarioPage:261,882,1794`; `LpnAccionesModal:33` | Por rol: `'directo'` aplica al toque · `'siempre'` siempre a autorización · `'umbral'` delega al gate por umbral | `null`/rol ausente → DUEÑO directo, resto siempre. Valor inválido → cae al default | ✅unit (ajusteAutorizacion) · ✅e2e 36 (solo DUEÑO directo) · 🔴 **e2e rol='siempre' (2 actores: cajero solicita → dueño aprueba)** |
| `conteo_gate_activo` | `false` (mig 179) | `conteoAjuste.ts:28-31`; `InventarioPage:252,1793` | Gate ON: solo diferencias que superan algún umbral (u/%/$) van a autorización; las chicas aplican directo (si el rol es 'umbral') | Gate OFF: **toda** diferencia (>EPS) requiere autorización (para roles 'umbral') | ✅unit (requiereAutorizacion ambas ramas) · 🔴 e2e |
| `conteo_gate_umbral_u` / `_pct` / `_valor` | `null` (mig 179) | `conteoAjuste.ts:17-22`; `InventarioPage:254` | Diferencia ≥ umbral en unidades **o** %·esperada **o** $·|diff| → requiere autorización | Todos null/0 → ningún umbral dispara (`superaUmbral`→false); con gate activo nada va a aprobación | ✅unit (superaUmbral por eje) · 🔴 e2e |
| `conteo_reconteo_umbral_u` / `_pct` / `_valor` | `null` (mig 179) | `conteoAjuste.ts:38-41`; `InventarioPage:257,275,5187` | 1er conteo con dif ≥ umbral → fuerza doble conteo (modo reconteo) antes de aplicar; skip con clave maestra | Todos null → nunca exige reconteo | ✅unit (requiereReconteo) · 🔴 **e2e flujo reconteo + skip por clave** |
| `conteo_modo` (`rapido`/`guiado`/`elegir`) | `'rapido'` (mig 178) | `InventarioPage:238-240,1571` | `guiado` → conteo a ciegas (campo Contado arranca vacío); `elegir` → el operador elige; revelar esperado solo DUEÑO/SUPERVISOR | `rapido` → precarga la esperada. **En básico se fuerza siempre 'rapido'** (gatea WMS) | 🔴 gap (e2e 36 solo rápido) |
| `conteo_wall_to_wall_bloquea` | `false` (mig 181) | `InventarioPage:263,1527`; `useConteoBloqueante` | Conteo scope=sucursal crea borrador `bloquea_movimientos=true` → **bloquea POS + ingreso + rebaje + traslado** de la sucursal hasta cerrarlo (solo DUEÑO/SUPERVISOR lo inicia, con confirm) | `false` → conteo sucursal no bloquea operación | 🔴 **gap e2e (cross-página: POS+inventario+traslados bloqueados)** |
| `conteo_ciclico_dias_a` / `_b` / `_c` | `30` / `90` / `180` (mig 180) | `conteoAbc.ts:77-78,85`; `InventarioPage:5337-5339` | Define cada cuántos días reconteo por clase ABC; el panel sugiere los vencidos | Defaults 30/90/180 | ✅unit (sugerirConteoCiclico) |
| `trazabilidad_asignacion` | `true` (mig 154) | `VentasPage:2719,3861` | ON → persiste `venta_item_despachos` (desglose LPN del despacho) | `false` → no escribe el desglose write-time | 🟡 code-audit · 🔴 e2e CON/SIN |

### 🛑 Recepciones / Compras (REGLA #0 stock)

| Flag | Default | Uso file:line | Comportamiento CON | Comportamiento SIN / por-valor | Cobertura |
|------|---------|---------------|--------------------|--------------------------------|-----------|
| `permite_over_receipt` | `false` (mig 051) | `recepcionLogic.ts:41-51`; `RecepcionesPage:119,488` | Permite recibir más que lo pedido en OC (sujeto a `over_receipt_pct_max`) | `false` → cualquier exceso sobre lo pedido bloquea la confirmación (B3) | ✅unit (superaOverReceipt) · 🔴 **e2e CON (acepta exceso) / SIN (bloquea)** |
| `over_receipt_pct_max` | `null` (mig 183) | `recepcionLogic.ts:48-50`; `RecepcionesPage:119` | Con `permite=true`: tope = esperada·(1+pct/100); recibido acumulado por encima del tope bloquea | `null`/≤0 con permite=true → over-receipt **libre** (sin tope) | ✅unit (tope % exacto/excedido) · 🔴 e2e |
| `recepcion_remito_obligatorio` | `false` (mig 183) | `RecepcionesPage:120,501` | Confirmar recepción exige adjuntar remito (sube a Storage `remitos`) | `false` → remito opcional | 🔴 **gap e2e CON/SIN** |
| `recepcion_alerta_faltante_dias` | `7` (mig 183→drop mig 240→**re-add mig 245**) | `GastosPage.tsx` (lista OC, badge 📦); `ConfigPage` (Compras, input) | OC `recibida_parcial` sin actividad ≥ N días → badge **rojo** "Faltante · Nd"; < N → ámbar | — | ✅ **CABLEADO + CONFIGURABLE v1.90.1** (la mig 240 lo había dropeado por huérfano; mig 245 lo re-agrega con consumidor). Proxy de fecha = `updated_at` de la OC |
| `compras_costo_alerta_pct` | `10` (lectura `?? 10`) | `RecepcionesPage:121,669` | Alerta si el costo del remito difiere > pct del costo del producto (B6) | Lee 10 por defecto | 🔴 gap (fuera del scope estricto del grupo) |

> **Roles (no son flags de tenant pero gobiernan recepción):** `esSupervisorPlus` (DUEÑO/SUPERVISOR/
> SUPER_USUARIO/ADMIN) habilita ajustar cantidad ≠ pedido (B1c) y dar de alta producto desde la
> recepción (`RecepcionesPage:118,366,466`). Cobertura: 🔴 e2e con rol CAJERO (debe bloquear).

---

## 3) Gaps priorizados — REGLA #0 stock (e2e a crear)

> Cada uno es un e2e **mutante** (aserción POSITIVA + verificar la mutación en DB con SQL). Orden por
> riesgo fiscal/stock. Los marcados ⭐ son los de mayor impacto.
>
> **▶ Estado 2026-06-23:** **#1 (autorización ajuste 2 actores)** ✅ **47/51**. **#3 (over-receipt)** ✅ **52** (SIN bloquea) + **74** (CON +10% acepta, stock↑, OC recibida, DB). **#4 (wall-to-wall bloqueante)** ✅ **76** (POS bloqueado por conteo borrador). **#8 (rebaje no-negativo)** ✅ **71**. **#9 (kits)** ✅ **75** (desarmar: kit↔componente + log; armar = inverso by-mechanism). Conteo+ajuste ✅ **36**. Traslados ✅ **30**. Recepción ✅ **29/35**. **#2 (conteo gate/reconteo CON flag)** = cubierto por unit (`conteoAjuste`) + el RESULTADO del gate (autorización 2-actores) por **36/47/51**; el e2e del flag CON/SIN es refinamiento. **Residual menor:** delta con venta intercalada (#5), under-receipt + ajuste por rol (#6), 2 recepciones parciales (#7).

1. **⭐ Autorización de ajuste por ROL ≠ DUEÑO, 2 actores** (L08/L09/L20, `ajusteAutorizacion.ts` +
   `InventarioPage:1794`/`882`, `LpnAccionesModal:33`). Cajero (modo default 'siempre') solicita un
   ajuste/conteo con diferencia → **NO** muta el stock, crea `autorizaciones_inventario` pendiente; el
   DUEÑO aprueba → recién ahí muta (verificar `movimientos_stock` + `inventario_lineas`). Hoy solo está
   cubierta la rama DUEÑO directo (e2e 36) y la lógica pura (unit). Es el flujo de 2 patas más expuesto.

2. **⭐ Conteo gate por umbral + doble conteo (reconteo)** (L18/L19, `conteoAjuste.ts` +
   `InventarioPage:1793`/`1844`). Con `conteo_gate_activo=true` y `conteo_gate_umbral_*` seteado:
   diferencia bajo umbral aplica directo, diferencia sobre umbral va a autorización. Con
   `conteo_reconteo_umbral_*`: 1er conteo sobre umbral fuerza reconteo antes de aplicar (+ skip con
   clave maestra). Solo cubierto en unit; falta el runtime CON/SIN flag con efecto en DB.

3. **⭐ Recepción over-receipt CON vs SIN** (L34, `recepcionLogic.ts:superaOverReceipt` +
   `RecepcionesPage:488`). `permite_over_receipt=false` → recibir > pedido **bloquea** (toast, sin
   stock); `=true` con `over_receipt_pct_max=10` → acepta hasta +10% (sube stock) y bloquea +11%.
   Verificar stock real y estado de OC en cada caso. (Tanda A §3 del marco.)

4. **⭐ Conteo wall-to-wall bloqueante (cross-página)** (L24, `conteo_wall_to_wall_bloquea` +
   `useConteoBloqueante`). Iniciar conteo scope=sucursal con el flag ON → intentar **vender en POS**,
   **ingresar/rebajar en Inventario** y **trasladar** debe fallar con el mensaje de bloqueo; al
   finalizar el conteo se levanta. Es el guard que protege la integridad del conteo full y toca 3
   páginas — alto riesgo si se rompe en silencio.

5. ✅ **CERRADO (2026-06-24) — Reconciliación por delta con venta intercalada** (L21). El unit de
   `reconciliarDelta` ya cubre el caso exacto (`reconciliarDelta(8,7,10)=5`: snapshot 10, venta de 2,
   contado 7 → 5) y el code-audit confirma que ambos paths (`InventarioPage:1809` directo, `:779` al
   aprobar) leen el `vivo` **fresco** de `inventario_lineas.cantidad` y aplican `vivo + (K − N)` sin pisar
   la venta (nunca negativo por `Math.max(0,…)`). La venta intercalada ya bajó el stock; el conteo solo
   suma su delta. e2e UI opcional.

6. **Recepción under-receipt exige motivo + ajuste de cantidad por rol** (L35/L36,
   `recepcionLogic.ts:tieneFaltante`/`esAjusteCantidad`, `RecepcionesPage:466,493`). CAJERO no puede
   ajustar cantidad ≠ pedido; faltante sin motivo bloquea confirmar; con motivo confirma y deja OC
   `recibida_parcial`.

7. **Recepción OC en 2 recepciones parciales → acumulado → recibida** (L37,
   `recepcionLogic.ts:estadoOCdesdeRecibido`, `RecepcionesPage:648`). 60 + 40 sobre 100 → la 2ª
   recepción deja la OC `recibida` (no parcial). Hoy e2e 35 cubre 1 sola recepción completa.

8. **Rebaje de stock no negativo + bloqueo por reservado** (L02, `InventarioPage:1174-1177,1187`).
   Intentar rebajar más que (cantidad − reservada) → bloquea; rebaje válido → stock baja y nunca
   negativo. Sin e2e hoy.

9. **Kits: armar consume / desarmar devuelve componentes** (L12/L13, `InventarioPage` ~1290-1480).
   Mutación de stock de componentes — REGLA #0 stock sin ninguna cobertura.

10. **Remito obligatorio CON/SIN + edición masiva de LPN a autorización** (L38/L08). `recepcion_remito_
    obligatorio=true` bloquea confirmar sin adjuntar; edición masiva con rol no-DUEÑO crea autorización
    `bulk_edit` en vez de mutar.

### Hallazgos colaterales (avisar a GO)

- 🔴 **`recepcion_alerta_faltante_dias` (default 7) está definido en `tenants` pero NO tiene
  consumidor en el código** (frontend ni SQL). Es un flag huérfano: se puede configurar pero no hace
  nada. No es bug de plata, pero contradice "todo lo configurable funciona" — decidir cablearlo
  (alerta de recepción parcial añeja) o quitarlo del Config.
- 🟡 **e2e 36 usa `.not.toBeVisible()`** para la rama "pendiente de aprobación" (`36_...:64`). Es un
  chequeo negativo (riesgo de falso-verde); su aserción positiva (toast "N ajuste aplicado") y la
  verificación DB (manual con execute_sql, según el header) lo compensan, pero conviene migrar la
  verificación de stock a SQL dentro del spec.
- 🟡 **`conteo_modo='elegir'`** existe en Config y en el tipo, pero el estado runtime colapsa a
  rápido/guiado (`InventarioPage:239`); validar que 'elegir' realmente expone la elección al operador
  (posible flag semi-implementado).
