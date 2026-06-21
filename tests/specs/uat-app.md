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

### H1 — Controles financieros SOLO client-side (choca con REGLA #0 obligación #3) 🟥🟥
El enforcement de **límite CC, morosidad/bloqueo CC, condonación de deuda, baja por incobrable, descuentos
y comprobante de gasto obligatorio** vive en el **frontend**. Server-side solo existen `fn_gastos_iva_guard`
(mig 227) y el hash de clave (mig 233). Ante **bundle cacheado o escritura por API**, esos topes se saltan.
→ **Recomendación (aprobada por GO 2026-06-21): guards server-side (triggers/RPC SECURITY DEFINER)** antes de un cliente que use CC en serio. **Implementar guard por guard, cada uno testeado en DEV** (es el hot-path de plata — un guard mal hecho bloquea ventas legítimas).

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
(`GastosPage.tsx:721`, `EnviosPage.tsx:788`). Guard solo-UI. → server-side + exigir clave si hay umbral.

### H3 — Clave maestra CON vs SIN nunca contrastada 🟥
Con `clave_maestra = null` se **apagan en silencio TODOS los gates** (cerrar caja ajena, anular, incobrable,
doble-firma OC/envío). Falta el escenario que pruebe el comportamiento con clave seteada vs sin clave.

### H4 — Flags huérfanos / rotos (configurables o leídos pero SIN efecto) 🟧 — VERIFICADO
| Flag | Estado verificado | Efecto |
|------|-------------------|--------|
| `precio_redondeo` | set en ConfigPage, **ningún lector** | el "redondeo de precios" prometido en Config **no hace nada** |
| `boveda_umbral_caja` | set en ConfigPage, **ningún lector** | umbral de bóveda inerte |
| `email_legal` | set en ConfigPage, **ningún lector** en src | no sale en ningún lado |
| `recepcion_alerta_faltante_dias` | **ni set ni read** en src (solo en DB) | alerta inexistente |
| `descuento_max_cajero_pct` | set pero **nunca enforzado** (el cajero ya está 100% bloqueado de descuentos) | tope ilusorio |
| `rrhh_tardanza_modo`, `rrhh_horas_mes_base` (y otros `rrhh_*`) | **leídos** en RrhhPage, **sin setter** (tab RRHH de Config es placeholder vacío) | clavados en su default, no configurables |
| `conteo_modo='elegir'` | semi-implementado | el runtime colapsa a rápido/guiado |

→ **Decisión para GO por cada uno:** implementar el efecto, o quitar la opción de Config (no dejar promesas falsas).

### H5 — Otros (fiscal/stock)
- **Kits — ✅ NO es bug (by-design, confirmado con GO 2026-06-21):** el rebaje de componentes ocurre **al ARMAR el kit** (kitting: reserva → rebaja componentes + ingresa 1 kit al stock, `InventarioPage.tsx:1360`); desarmar (des_kitting) reingresa componentes. **Vender el kit rebaja solo el stock del kit terminado** — los componentes ya se rebajaron al armar, volver a rebajarlos sería doble conteo. El hallazgo del agente era falso positivo.
- **EF descuento global solo `console.warn`:** si un descuento/recargo global no está prorrateado en ítems, la EF avisa pero **no bloquea** → riesgo de comprobante con total ≠ suma de ítems (AFIP 10048).
- **ConfigPage:** los tabs `rrhh`/`alertas`/`notificaciones` son **placeholders vacíos** (flags sin UI de configuración). `handleSaveBiz` persiste ~100 columnas de golpe sin importar el tab (condiciona cómo se testea "guardar tab X").

---

## 3) Backlog priorizado de gaps (qué e2e crear)

### 🟥 Tanda A — REGLA #0 sin e2e (PRIMERO, decidido con GO)
1. **§29 matriz fiscal RUNTIME** — `condicion_iva_emisor` RI/Mono/Exento × emitir CAE real (A/B/C) + rechazo 400 del guard FAC-27 / emisor↔letra (hoy solo en la EF, sin e2e). *(requiere AFIP homologación)*
2. **Límite/morosidad CC** — `limite_cc_default` + `cc_enforcement_politica=bloquear` corta la venta CC sobre el tope (con efecto en DB). **+ evaluar guard server (H1).**
3. **Clave maestra CON vs SIN** (H3) — gatea anular/incobrable/cierre ajeno/doble-firma con clave seteada vs sin.
4. **Autorización de ajuste de inventario por rol ≠ DUEÑO** (2 actores: solicita→no muta→aprueba→muta).
5. **Conteo gate por umbral + doble conteo (reconteo)** CON/SIN flag.
6. **Over-receipt** (`permite_over_receipt`+pct) CON vs SIN (bloquea exceso) — efecto en stock + estado OC.
7. **Gate de pago de OC** (efectivo→caja / no-efectivo→informativo / CC→deuda+límite; saldo no excedible) + **doble firma** (H2).
8. **Pagar nómina** (RPC `pagar_nomina_empleado` → caja/CC, efectivo↔caja) + **doble validación** rol≠DUEÑO.
9. **Descuento máx por rol** (`descuento_max_supervisor_pct`) bloquea sobre el tope.
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
