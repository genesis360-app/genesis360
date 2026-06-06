---
name: relevamiento_compras_respuestas
description: Respuestas de GO+socio al relevamiento de Compras (OC + Recepciones) + diseño consolidado, sugerencias y plan por fases
type: project
---

# Relevamiento Compras (OC + Recepciones) — respuestas + diseño

> Relevado con GO + socio (HTML `relevamiento-compras-reglas-negocio.html`, 34 preguntas, secciones A-H).
> Respuestas crudas pasadas por GO el 2026-06-05. Este doc consolida respuesta + diseño + mis sugerencias
> donde difiero, y el plan por fases (CO1-CO8). Filosofía: **fácil/simple para el usuario PyME por fuera,
> inteligente y robusto por dentro** (kiosco, almacén, óptica, farmacia, ferretería, indumentaria…).

## Leyenda
- **Resp GO** = lo elegido. **Diseño** = cómo se implementa. **💡 Sugerencia** = donde propongo algo distinto y por qué.

---

## A — Creación y aprobación de OC

| # | Resp GO | Diseño |
|---|---|---|
| A1 | **C + D** | Creación **configurable por rol y umbral** (motor estilo Gastos/autorizaciones). DEPOSITO puede crear **borradores** (sin enviar); DUEÑO/SUPERVISOR confirma/envía. |
| A2 | **B + C, configurable por roles** | Aprobación antes de enviar: por **umbral de monto** (b) **y/o** doble validación siempre (c), **configurable por rol**. Reusa el patrón de `autorizaciones_*` (mismo motor de umbral u/$/rol que Gastos y Conteos F3). Default sugerido: sin aprobación bajo umbral, aprobación arriba. |
| A3 | **A + B + C configurables** | Mantener OC rápida (a) + **sugerencia automática desde alerta de stock bajo** (b) + **auto-borrador consolidando productos del mismo proveedor bajo mínimo** (c). Las 3 conviven; b/c se activan desde Alertas/Inventario. |
| A4 | **C** | **Sucursal obligatoria siempre** en la OC (se elimina la OC "global"). Default = sucursal activa. 💡 *Nota:* para DUEÑO que compra centralizado para varias sucursales, una "OC central distribuible" sería útil a futuro; para PyME de 1-3 sucursales, obligatoria está bien. |
| A5 | **D con B/C, default B** | Numeración **configurable por tenant**: opciones correlativo por tenant (a), **por sucursal** (b, default, prefijo `S1-OC-0001`) o por proveedor (c). |
| A6 | **D** | Enviar OC al proveedor por **email (PDF) + WhatsApp**, elige el operador o según contacto preferido del proveedor. Email reusa `send-email` + PDF on-demand; WA por **link `wa.me` con plantilla** (no API). |

## B — Recepción de mercadería

| # | Resp GO | Diseño |
|---|---|---|
| B1 | **A + C** | Reciben DUEÑO/SUPERVISOR/DEPOSITO (a); el **ajuste de cantidades** (over/under-receipt) **requiere SUPERVISOR+** (c). |
| B2 | **Ya existe (revisar)** | ✅ **Confirmado en código:** la recepción ya admite `oc_id = null` (recepción libre sin OC; "Contra OC" opcional, `RecepcionesPage.tsx:433`). **Está OK.** Mejoras menores propuestas: exigir **proveedor** cuando es sin OC (hoy también opcional) y ofrecer "generar OC retroactiva" opcional. Sin cambio de modelo. |
| B3 | **C** | Over-receipt **configurable + umbral % máximo** (ej. +10% sobre lo pedido). Extiende el bool actual `tenants.permite_over_receipt` con `over_receipt_pct_max`; granular por proveedor opcional. |
| B4 | **A + D** | Under-receipt: OC queda `recibida_parcial` (a) + **motivo del faltante obligatorio** (d: rotura/faltante/cancelado por proveedor). **Pedido GO:** el faltante debe poder **disparar en Gastos** un pedido de **devolución de dinero** de lo no entregado **o** generar **stock/crédito a favor** para la próxima OC. → se integra con C (devolución/crédito a proveedor). |
| B5 | **A (robusto)** | **⚠ Respuesta honesta: hoy NO es 100% robusto.** El estado de la OC se recalcula **solo con la recepción actual** (`RecepcionesPage.tsx:538-548`), no **acumulando** entre varias recepciones → una OC completada en 2+ recepciones parciales puede quedar mal en `recibida_parcial`, y no hay guard de over-receipt **acumulado**. **Para afirmar "robusto sin cruces" hay que:** (1) acumular `cantidad_recibida` por `oc_item` sumando todas las recepciones; (2) recomputar el estado de la OC desde ese acumulado; (3) aplicar over/under y el umbral % sobre el **pendiente real**. Se hace en CO2. Tras eso, **sí se puede afirmar.** |
| B6 | **A** | Sin validación: el costo que entra al stock usa el precio de la OC. 💡 **Sugerencia: sumar (b)** — permitir **editar el precio en la recepción con audit log**. Motivo: el precio del **remito** suele diferir del de la OC (aumentos, bonificaciones); si no se puede ajustar, el costo del stock entra mal y arrastra el margen. Es barato y se combina con E1 (alerta de cambio de costo). *Queda a tu decisión; lo dejo propuesto.* |
| B7 | **B (configurable, default opcional)** | **Adjuntar PDF/foto del remito** en la recepción; configurable si es obligatorio por monto/siempre, **default opcional**. Reusa el patrón de adjuntos (Storage + URL). |
| B8 | **A** | LPN automático por línea (mantener). |

## C — Devolución a proveedor

| # | Resp GO | Diseño |
|---|---|---|
| C1 | **B** | **"Devolución a proveedor" como entidad separada** (tabla `devoluciones_proveedor` + items), similar a devoluciones de venta. Más limpio y auditable que una OC negativa. Descuenta stock + registra el movimiento. (Reemplaza el `tiene_reembolso_pendiente` huérfano.) 💡 *Coincido con B; es lo correcto.* |
| C2 | **D (elige A/B/C)** | El operador **elige la forma** del reembolso según el acuerdo: (a) **crédito en CC del proveedor** (descuenta deuda, reusa `ccProveedor.ts`), (b) **efectivo** (ingreso a caja), (c) **reposición** (genera OC nueva por el mismo monto/cantidad). |
| C3 | **C con obs opcional** | **Catálogo cerrado** de motivos (roto / falla de fábrica / incorrecto / vencido / otro) + **observación libre opcional** (no obligatoria). |
| C4 | **A** | Sin plazo para devolver. |

## D — Pago de la OC

| # | Resp GO | Diseño |
|---|---|---|
| D1 | **A + B (anticipo) + lógica transversal** | Mantener badge+alerta de anticipo (a). **Nuevo (pedido GO):** en cada **proveedor** habilitar **"contra entrega"** y **"anticipo"** con **% de anticipo configurable**; al crear la OC se marca si **se paga con anticipo**; bloquear avance/escalar si no se recibió tras X días (b). **Armar la lógica central de anticipo** (`proveedores.modo_pago` + `anticipo_pct`) y aplicarla **en todos los módulos que lo usen** (OC, Gastos/pago, CC proveedor, alertas). |
| D2 | **A + B + C** | Pagos parciales (a) + **schedule de pago** (b: % al confirmar / % al recibir / % a N días) **configurable por OC** (c). 💡 *Sugerencia:* que el schedule sea **plantilla/opcional**, no obligatorio — la (c) ya lo hace flexible; obligatorio sería rígido para PyME. |
| D3 | **A + B + C** | Todos los métodos (a) + **cheque con flujo especial** (b: nro/banco/fecha emisión-cobro/conciliación → ver D4) + **transferencia con comprobante adjunto** (c). |
| D4 | **D (= B + C)** | **Cheques diferidos**: tabla de cheques con **fecha de cobro futuro + alerta** (b) **y endoso** (pagar a otro proveedor con un cheque, c). Feature grande → fase propia. |
| D5 | **A (excepto CONTADOR) + D** | Registrar pago: cualquier rol con acceso (a) **salvo CONTADOR** (read-only, consistente con J3 de Ventas/Clientes) + **doble firma** si supera umbral (d: registra → autoriza). |

## E — Integración con stock y costos

| # | Resp GO | Diseño |
|---|---|---|
| E1 | **D** | Al recibir, **alerta "el costo cambió X%"** y el operador decide si actualiza el `precio_costo` del producto. Umbral % configurable. 💡 *Coincido* — es lo más PyME-friendly (no pisa costos en silencio). Dejo `(b) último` y `(c) PMP` como modo configurable a futuro para quien lo quiera automático. |
| E2 | **B** | Campos accesorios **sueltos** (envío + aduana + comisión + otros) **sin distribuir** al costo unitario. 💡 *Nota:* la distribución (c) sirve a importadores/mayoristas; para PyME, sueltos alcanza. Dejarlo **configurable por OC** a futuro (distribuir on/off) si aparece el caso. |
| E3 | **A** | No permitir alta de producto en la recepción — debe existir en catálogo antes. 💡 **Sugerencia fuerte: reconsiderar a (c)** — permitir **alta rápida solo DUEÑO/SUPERVISOR**, producto entra como **"pendiente de revisión"**. Motivo: en PyMEs (ferretería, kiosco, almacén) es **muy común** recibir un producto nuevo que aún no está cargado; obligar a salir de la recepción, crearlo y volver es fricción real y propenso a error. (c) mantiene el control (rol alto + flag de revisión) sin trabar la operación. *Lo dejo propuesto para tu OK.* |
| E4 | **D (= B + C)** | **Reporte de OCs con diferencias** pedido vs recepción (b) + **calificación automática del proveedor** según cumplimiento (c). |

## F — Servicios y suscripciones

| # | Resp GO | Diseño |
|---|---|---|
| F1 | **B** | **Servicio recurrente** (mensual/anual) **genera el gasto automáticamente** con la frecuencia configurada. 💡 *Caveat infra:* sin `pg_cron`, la generación se hace por **sweep lazy** (al entrar a Gastos/Compras se materializan los períodos vencidos) — mismo patrón que `liberar_reservas_vencidas`. Funciona, pero "automático" = al abrir el módulo, no a medianoche exacta. |
| F2 | **C** | Catálogo de servicios **ambos modos**: genéricos del tenant + específicos por proveedor. |
| F3 | **B** | **Comparar varios presupuestos** del mismo servicio (de distintos proveedores) **lado a lado**. |

## G — Reportes y alertas

| # | Resp GO | Diseño |
|---|---|---|
| G1 | **A+B+C+D+E+F (todos)** | Reportes: OCs vencidas · compras por proveedor (volumen/plazo/cumplimiento) · top productos comprados · pendientes de pago (aging) · evolución de costos por SKU · OCs derivadas/devoluciones. |
| G2 | **A+B+C+D (todos)** | Alertas: anticipo sin recepción tras N días · cheque próximo a vencer · costo subió X% vs última compra · producto bajo mínimo sin OC pendiente. |
| G3 | **A + C** | Export **Excel + PDF + CSV** + **PDF de OC imprimible** con datos del proveedor + condiciones de pago. |

## H — Prioridades
- **H1:** GO delega el Top 3 → ver plan abajo. **H2:** sin comentarios libres.

---

## Resumen de mis sugerencias (donde difiero / agrego)
1. **E3 (alta de producto en recepción):** reconsiderar A → **(c)** alta rápida solo DUEÑO/SUPERVISOR con flag "pendiente de revisión". Es el cambio que más reduce fricción en PyME. *(requiere tu OK)*
2. **B6 (precio remito):** sumar **(b)** editar precio en la recepción con audit. Evita que entre mal el costo cuando el remito difiere de la OC. *(requiere tu OK)*
3. **B5 (robustez):** hoy **no** es robusto entre múltiples recepciones; se arregla en CO2 (acumulado por `oc_item`). Recién entonces se puede afirmar "sin cruces".
4. **D2 (schedule):** que el schedule de pago sea **opcional/plantilla**, no obligatorio.
5. **A4 / E2:** OK como están; dejé notas de "configurable a futuro" para multi-sucursal central (A4) y distribución de costos (E2) por si aparece el caso importador.

---

## Modelo de datos (propuesto)

- **`proveedores`** (config de pago D1): `modo_pago TEXT` (`contado|anticipo|contra_entrega|cuenta_corriente`), `anticipo_pct NUMERIC`, `permite_over_receipt BOOLEAN` + `over_receipt_pct_max NUMERIC` (B3), `plazo_devolucion_dias` (no usado, C4=sin plazo).
- **`tenants`** (config): `oc_aprobacion_activa/umbral_*` (A2), `oc_numeracion` (`tenant|sucursal|proveedor`, A5), `oc_pago_doble_firma_umbral` (D5), `compras_costo_alerta_pct` (E1), `recepcion_remito_obligatorio` (B7), `compras_permite_alta_producto` (E3 si se aprueba).
- **`ordenes_compra`**: `numero_sucursal INT` (A5), `paga_con_anticipo BOOLEAN` + `anticipo_pct` snapshot (D1), `costo_aduana/comision/otros NUMERIC` (E2), `pago_schedule JSONB` (D2), estado `pagada_pendiente_recepcion` o flag (D1b).
- **`recepciones` / `recepcion_items`**: `motivo_faltante TEXT` (B4), `remito_url TEXT` (B7), `precio_editado/audit` (B6 si se aprueba). Acumulado por `oc_item` para B5 (vía recálculo, sin columna nueva: `SUM(cantidad_recibida)` por `oc_item_id`).
- **`devoluciones_proveedor`** (C1) + `devolucion_proveedor_items`: `proveedor_id, oc_id?, recepcion_id?, forma ('credito_cc'|'efectivo'|'reposicion'), motivo, observacion?, estado, monto, caja_sesion_id?`. RLS por tenant. Integra `ccProveedor.ts` + caja.
- **`cheques`** (D4): `numero, banco, monto, fecha_emision, fecha_cobro, estado ('en_cartera'|'depositado'|'cobrado'|'endosado'|'rechazado'), proveedor_id?, endosado_a_proveedor_id?, oc_id?`. RLS por tenant.
- **`servicios_recurrentes`** (F1): `servicio_id, frecuencia, proximo_periodo, activo` + sweep lazy que materializa gastos.
- **`oc_diferencias` / calificación proveedor** (E4): vista/reporte + `proveedores.score_cumplimiento` (calculado).

---

## Plan por fases (CO1-CO8) — propuesto

Cada fase es deployable a PROD con su versión (patrón del proyecto). Orden por dependencia/valor.

- **CO1 — Gobierno de OC:** A1 (creación rol/umbral, DEPOSITO borradores) · A2 (aprobación por umbral/rol, reusa autorizaciones) · A4 (sucursal obligatoria) · A5 (numeración configurable, default por sucursal) · D5 (permisos de pago, CONTADOR read-only + doble firma umbral). *Base de governance, reusa motores existentes.*
- **CO2 — Recepción robusta:** **B5 robustez** (acumulado por `oc_item` + recálculo de estado OC) · B1c (ajuste requiere SUPERVISOR+) · B3 (over-receipt umbral %) · B4 (under-receipt motivo obligatorio + alerta) · B7 (adjuntar remito) · B2 (mejoras menores sin-OC). *El núcleo: stock y estados correctos.*
- **CO3 — Costos:** E1 (alerta cambio de costo + decide) · E2 (campos accesorios sueltos) · B6 (editar precio en recepción con audit, **si se aprueba**) · E4-reporte (diferencias OC vs recepción). *Costos correctos = márgenes correctos.*
- **CO4 — Devolución a proveedor:** C1 (entidad separada) · C2 (forma: crédito CC/efectivo/reposición) · C3 (catálogo + obs opcional) · C4 (sin plazo) + link de B4 (faltante → devolución de dinero/crédito). *Cierra el hueco `tiene_reembolso_pendiente`.*
- **CO5 — Pago: anticipo + contra-entrega + schedule:** D1 (modo de pago por proveedor + % anticipo + OC paga con anticipo + escalado) · D2 (schedule configurable por OC) · D3 (transferencia con comprobante). *Lógica transversal de anticipo.*
- **CO6 — Cheques diferidos:** D4 (tabla cheques, cobro futuro + alerta + endoso) · D3b (flujo cheque). *Feature grande, fase propia.*
- **CO7 — Envío + OC inteligente + servicios:** A6 (enviar OC email/WA) · A3 (sugerencia/auto-draft desde stock bajo) · F1 (servicio recurrente sweep lazy) · F2 (catálogo ambos modos) · F3 (comparar presupuestos).
- **CO8 — Reportes, alertas y export:** G1 (todos los reportes) · G2 (todas las alertas) · G3 (Excel/PDF/CSV + PDF OC) · E4-calificación (score proveedor).

### Top 3 (H1, mi recomendación)
1. **CO2 — Recepción robusta** (corrige B5, alto valor diario, evita errores de stock/estado).
2. **CO3 — Costos** (que el costo entre bien marca el margen de todo el negocio; depende de CO2).
3. **CO4 — Devolución a proveedor** (feature pedida, cierra un flujo inexistente hoy).

> CO1 (governance) puede ir 1º si preferís ordenar permisos antes de tocar recepción; es independiente. Cheques (CO6) y el resto van después. Reordenable.

---

## Pendientes de confirmación antes de implementar
- **E3:** ¿se aprueba mi sugerencia (alta rápida de producto en recepción, rol alto + "pendiente revisión")? Hoy quedó en A (no permitir).
- **B6:** ¿se aprueba permitir editar precio en la recepción con audit? Hoy quedó en A (sin validación).
- **D1:** confirmar los modos de pago por proveedor exactos (`contado|anticipo|contra_entrega|cuenta_corriente`) y si el % de anticipo es por proveedor (sí) o también override por OC.
- **A6 (WA):** confirmar que alcanza con link `wa.me` + plantilla (sin API de WhatsApp Business).
