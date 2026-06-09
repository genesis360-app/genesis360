---
title: Roadmap y Versiones
category: business
tags: [roadmap, versiones, releases, pendiente, prod]
sources: [CLAUDE.md, ROADMAP.md, WORKFLOW.md, project_pendientes.md]
updated: 2026-05-29
---

# Roadmap y Versiones

**Versión en PROD:** ver `G360.Wiki/sources/raw/project_pendientes.md` (fuente de verdad)  
**Última actualización:** 3 de Junio, 2026

---

## v1.41.0 — Envíos EN2: POD robusto + cierre de entrega (PROD ✅)

D1 campos POD requeridos configurables · D2 mín. de fotos · D3 firma del receptor (canvas) + DNI + OTP sobre umbral (propio, código al cliente por WA) · D4 geoloc con fallback graceful · D5 sub-estados de no-entrega + motivo · D6 reintento con contador + recargo. RPCs del transportista ampliadas, página del chofer renovada. Lib `enviosPod.ts` + 18 tests → suite 506. Mig 190.

---

## v1.40.0 — Envíos EN1: pagos a courier contables + conciliación (PROD ✅)

C2 gasto automático al pagar courier tercero (Transporte y fletes, IVA crédito fiscal) + egreso de caja si efectivo + link `envios.gasto_id`. C3 tab "Facturas Courier": cargar factura del courier por período + conciliar contra lo registrado + alerta de diferencias (`courier_facturas` + `courier_factura_lineas`). C4 doble firma por umbral con clave maestra. Config → Envíos: toggle gasto + alícuota IVA + umbral. Lib `enviosCourierPago.ts` + 14 tests → suite 488. Mig 189. **Primera fase del relevamiento Envíos (EN1-EN7).**

---

## v1.39.0 — Compras CO8: reportes, alertas, export y calificación · Compras 2.0 completo (PROD ✅)

G1 reportes (tab Reportes en Gastos): compras por proveedor, top productos, aging de pagos, OCs vencidas, evolución de costos. E4 calificación de proveedor (A/B/C). G3 export Excel/CSV/PDF. G2 alerta "bajo mínimo sin OC pendiente". Lib `comprasReportes.ts` + 10 tests → suite 474. Sin migración. **Cierra el plan Compras 2.0 (CO1-CO8).**

## v1.38.0 — Compras CO7b: servicios (PROD ✅)

F1 servicios recurrentes (`servicio_items.recurrente`/`frecuencia`/`proximo_vencimiento`; banner "Generar gasto" con sweep lazy). F2 catálogo genérico del tenant (`proveedor_id` nullable + panel "Servicios generales"). F3 comparar presupuestos lado a lado (agrupa por concepto, marca el más barato). Lib `serviciosRecurrentes.ts` + 11 tests → suite 464. Mig 188.

## v1.37.0 — Compras CO7a: OC inteligente (PROD ✅)

A6 enviar OC al proveedor — PDF (`ocPDF.ts` jsPDF), Email (`send-email`) y WhatsApp (`wa.me`) desde el detalle de la OC. A3 auto-draft desde stock bajo — "Generar OC sugerida" en Alertas consolida productos bajo mínimo por proveedor y crea OCs borrador. +6 tests → suite 453. Sin migración.

## v1.36.0 — Compras CO6: cheques diferidos (PROD ✅)

D4 — gestión de cheques diferidos. Tabla `cheques` (propios emitidos a proveedores / de terceros recibidos), `fecha_cobro` diferida, estados (en_cartera/entregado/depositado/cobrado/endosado/rechazado/anulado) + endoso (pagar a otro proveedor con un cheque de tercero). Nuevo tab **Cheques** en Gastos: registro, transiciones por tipo, endoso, filtros, total pendiente y alerta de próximos a cobrar. Config → `cheques_alerta_dias` (default 7). Lib pura `comprasCheques.ts` + 19 tests → suite 447. Mig 187 (aditiva).

## v1.35.0 — Compras CO5: pago anticipo/contra-entrega + schedule (PROD ✅)

D1 modo de pago por proveedor (`proveedores.modo_pago` contado/anticipo/contra_entrega/cuenta_corriente + `anticipo_pct`) → la OC propone "paga con anticipo" + % al elegir el proveedor (override por OC, snapshot en `ordenes_compra.paga_con_anticipo`/`anticipo_pct`). D2 plan de pagos opcional por OC (`pago_schedule JSONB`, valida suma 100%, guía en el modal de pago). D3 comprobante de transferencia (reusa `ordenes_compra.comprobante_url`). Lib pura `comprasPago.ts` + 16 tests → suite 428. Mig 186 (aditiva).

## v1.34.0 — Compras CO4: devolución a proveedor (PROD ✅)

Entidad separada `devoluciones_proveedor` (+ items). Desde una OC recibida → "Devolver a proveedor": ítems + cantidades, motivo (catálogo) + obs opcional, forma del reembolso: crédito en CC (nota de crédito) / efectivo (ingreso a caja) / reposición (OC nueva borrador). Rebaja stock FIFO + movimiento; valida disponible. Cierra el `tiene_reembolso_pendiente` huérfano. Lib `devolucionProveedor.ts` + 9 tests → suite 412. Mig 185.

## v1.33.0 — Compras CO3: costos (PROD ✅)

E1 alerta de cambio de costo al recibir + el operador decide actualizar (umbral % config) · E2 costos accesorios sueltos en la OC (aduana/comisión/otros) · B6 editar precio en recepción con audit · E3 alta rápida de producto desde la recepción (DUEÑO/SUPERVISOR, pendiente de revisión). Lib `comprasCostos.ts` + 10 tests → suite 403. Mig 184.

## v1.32.0 — Compras CO2: recepción robusta (PROD ✅)

Segunda fase del módulo Compras. **B5 (fix):** el estado de la OC se recalcula desde el acumulado de todas las recepciones confirmadas (no solo la actual) → OC completada en parciales llega bien a `recibida`. + B3 over-receipt umbral % · B4 motivo de faltante + alerta · B1c over/under requiere SUPERVISOR+ · B7 adjuntar remito (bucket privado scoped por tenant) · B2 sin OC exige proveedor. Lib `recepcionLogic.ts` + 13 tests → suite 393. Mig 183.

## v1.31.0 — Compras CO1: gobierno de OC (PROD ✅)

Primera fase del módulo Compras. A1 creación por rol (DEPOSITO solo borradores) · A2 aprobación de OC por umbral antes de enviar · A4 sucursal obligatoria · A5 numeración configurable (default por sucursal) · D5 pago (CONTADOR read-only + doble firma por umbral con clave maestra). Lib `comprasPermisos.ts` + 14 tests. Config en Config → Gastos. Mig 182.

## v1.30.1 — ISS-151: excluir 'Incobrable' del Dashboard (PROD ✅)

Bugfix: el write-off 'Incobrable' (B6) contaba como ingreso en los gráficos de medios de pago → distorsionaba la ganancia. Se excluye junto a los demás pseudo-métodos, unificados en `PSEUDO_METODOS_PAGO`/`esMetodoRealPago` (`src/lib/ccLogic.ts`, +4 tests). Cierra ISS-151 (Condonar/Revertir CC ya estaban en PROD).

## v1.30.0 — Conteos 2.0 · cierre 100% (F2b-ref + F3b + A2) (PROD ✅)

Cierre **100%** de Conteos 2.0 (ISS-CONT).
- **F2b-ref**: escanear un producto fuera del alcance con stock en la sucursal → fila "fuera de alcance" (mercadería mal ubicada); sin stock → aviso hacia Ingreso.
- **F3b**: snapshot de costo por ítem (valorización estable al continuar borradores) + **doble conteo formal** (re-ingreso de filas sobre umbral en columna "Recontar"; saltable con clave maestra SUPERVISOR/DUEÑO).
- **A2**: toggle `conteo_wall_to_wall_bloquea` (default OFF) — el conteo de sucursal completa con confirmación de DUEÑO bloquea ventas (reserva/despacho) y movimientos hasta cerrarlo.
- Mig 181 (aditiva). Build verde, 362 tests verdes.

🎉 **Conteos 2.0 (F1-F4 + refinamientos) cerrado al 100%.**

## v1.29.0 — Conteos 2.0 · F2b (scan-to-count) + F4 (ABC/cíclico/reportes/trazabilidad) — cierre del módulo (PROD ✅)

Cierre de **Conteos 2.0** (ISS-CONT), F1-F4 en PROD.
- **F2b — scan-to-count**: "Escanear para contar" abre cámara persistente que suma a la fila del producto escaneado (cantidad del AI GS1 o +1; reusa el stack GS1).
- **F4 — clase ABC** (auto Pareto 80/95 por valor de movimiento de 12m + override manual), **conteo cíclico sugerido** (días por clase configurables, panel "Conviene contar"), **reportes de exactitud + valorización** ($ faltante/sobrante/neto, por conteo y acumulado + export Excel) y **trazabilidad por operador** (quién contó cada ítem).
- Lógica pura testeada (`conteoAbc.ts`, +16 tests → 362). Mig 180 (aditiva).

Pendientes futuros (no bloqueantes): F2b-refinamiento (alta de fila al escanear fuera de scope) · F3b (doble conteo formal por 2º operador + clave maestra C4 + snapshot de costo) · wall-to-wall A2 (bloqueo POS durante conteo full).

## v1.27.0 — Conteos 2.0 · F3: gate de ajustes + autorizaciones + reconciliación delta (PROD ✅)

Tercera fase de **Conteos 2.0** — el control de los ajustes (lo más sensible para la plata).
- **Gate de aprobación**: las diferencias de un conteo van al tab **Autorizaciones** (`ajuste_conteo`) antes de tocar el stock. Configurable por umbral (unidades/%/$); sin gate → todo a aprobación.
- **Reconciliación por delta**: al aplicar no se pisa el stock — respeta ventas ocurridas durante el conteo.
- **Doble conteo**: aviso al finalizar de las filas que superan el umbral de discrepancia.
- Lógica pura testeada (`conteoAjuste.ts`, +16 tests → 346). Mig 179. `migration-reviewer` + `code-reviewer` en el flujo.

Pendiente: F2b (scan-to-count) · F3b (doble conteo formal + clave maestra) · F4 (clase ABC + cíclico + reportes).

## v1.26.0 — Conteos 2.0 · F2a: modos + conteo a ciegas + unidad de medida + secuencia (PROD ✅)

Segunda fase de **Conteos 2.0**.
- **Modo configurable** (Rápido / Guiado a ciegas / Elegir al crear), en Config → Inventario.
- **Conteo a ciegas**: el operador cuenta sin ver el stock del sistema (anti sesgo de confirmación); revelar fila puntual (DUEÑO/SUPERVISOR).
- **Filas en blanco**: distingue "no contada" (se omite) de "contó cero" (ajusta).
- **Fix**: el campo "Contado" respeta la unidad — enteros en piezas/unidades, decimales en kg/gr (corrige el 15→14,999).
- **`ubicaciones.secuencia`**: orden de recorrido para conteo y picking. Mig 178.
- `migration-reviewer` + `code-reviewer` en el flujo. 330 tests verdes.

Próximas: F2b (scan-to-count) · F3 (gate de ajustes + autorizaciones + doble conteo) · F4 (clase ABC + cíclico + reportes).

## v1.25.0 — Conteos 2.0 · F1: scope por Marca / Categoría / Wall-to-wall (PROD ✅)

Primera fase de **Conteos 2.0** (ISS-CONT, relevado con GO). El conteo de inventario deja de ser solo por ubicación/producto:
- **Por Marca** (lo pedido), **por Categoría** y **Sucursal completa (wall-to-wall)**.
- Mig 177 (`inventario_conteos.tipo` ampliado + `filtros JSONB`). UI con toggle de 5 alcances + carga dinámica.
- Marcas/categorías derivadas del stock de la sucursal; scopes amplios exigen sucursal específica (aislamiento).
- `migration-reviewer` + `code-reviewer` en el flujo (corrigió un cruce de sucursales en wall-to-wall). 330 tests verdes.

Próximas fases: F2 (modos rápido/guiado + ciego + scan + secuencia de ubicación) · F3 (gate de ajustes + autorizaciones + doble conteo) · F4 (clase ABC + cíclico + reportes).

## v1.24.0 — Clientes: C6 segmentación+export + D4 NC manual de proveedor (PROD ✅)

Backlog diferido de Clientes (sin migración).
- **C6 — Segmentación para marketing:** filtros (etiqueta, estado CC, actividad, mínimo comprado, con contacto) + export CSV/Excel de la lista segmentada, en ClientesPage → Reportes. Para enviar desde una herramienta de mailing/WhatsApp externa.
- **D4 — NC manual de proveedor:** form en el modal CC (monto, correlativo `NC-NNNN`, motivo, adjunto) que registra una nota de crédito que reduce la deuda. Cierra el ◑ que dejó CL5.
- `code-reviewer` en el flujo pre-merge. Build verde, 330 tests verdes.

Diferidos restantes: B7 (tope deuda global, "revisar en 3-6 meses"), F2 (fidelización puntos, requiere relevamiento), C3 (envío background, bloqueado por `pg_cron`).

## v1.23.2 — QA: extensión de tests a Caja / Inventario / Ventas (PROD ✅)

Release interno de calidad (sin cambio de comportamiento, sin migración).
- **Caja:** lógica de arqueo extraída a `src/lib/cajaArqueo.ts` (rewire behavior-preserving de `CajaPage.tsx`) + tests de la matriz de permisos `cajaPermisos` (J3/B5/B6). **+57 tests**.
- **Inventario:** tests de `unidades.ts` (conversión kg↔gr / lt↔ml). **+17 tests**.
- **Ventas:** tests de descuento de combo, visibilidad de costo (G4) y umbral de gasto. **+27 tests**.
- Planes en `tests/specs/{caja,inventario,ventas}.plan.md`. **Suite total: 329 unit tests verdes.**

## v1.23.1 — QA: lógica de CC testeable + ecosistema de subagentes (PROD ✅)

Release interno de calidad (sin cambio de comportamiento, sin migración).
- Lógica de cuenta corriente extraída a `src/lib/ccLogic.ts` (función pura, single source of truth) + **50 unit tests** nuevos. Suite total: 228 verdes.
- Plan de escenarios de Clientes en `tests/specs/clientes.plan.md` (41 escenarios).
- **9 subagentes de proyecto** en `.claude/agents/` (relevamiento, spec-extractor, test-author, test-runner, migration-reviewer, code-reviewer, bug-fixer, deploy-runner, wiki-keeper). Ver `wiki/development/agentes-claude-code.md`.

## v1.23.0 — Relevamiento Clientes CL4+CL5+CL6: módulo Clientes COMPLETO (PROD ✅)

Cierre del relevamiento de Clientes. Migrations 175 (CL4) + 176 (CL5); CL6 sin migración.
- **CL4 notificaciones:** email automático al registrar deuda CC (C1) y al pagar (C4); umbral pre-vencimiento configurable (C2); panel de cumpleaños + saludo WA (C5). Config en Config → Ventas → Operativa. Defaults OFF.
- **CL5 CC proveedores:** cuentas bancarias múltiples (D6), PDF estado de cuenta (D3), columnas de NC con correlativo/adjunto (D4).
- **CL6 reportes/audit:** tab Reportes (top clientes, inactivos +60d, aging CC), export Excel (G3), audit log de cambios del cliente (F4).
- **Fix:** autofill del navegador en el buscador de ventas al abrir el modal de clave maestra.
- **🎉 Módulo Clientes CL1–CL6 completo.**

## v1.20.0 — Relevamiento Clientes CL3: incobrables + estado de cuenta (PROD ✅)

Tercera fase del backlog Clientes. Migration 173 + bugfix 174.
- **B6 incobrables:** "Dar de baja incobrable" (DUEÑO + clave maestra) → condona la deuda CC + gasto automático "Deudores incobrables" + audit.
- **B8 estado de cuenta:** PDF descargable + portal público `/cuenta/:token` (sin login, RPC anon).
- **Bugfix (mig 174):** `DROP CONSTRAINT ventas_origen_check` — el canal de venta es configurable desde mig 168 y la constraint rígida rechazaba canales nuevos al vender.
- **Próximo:** CL4 (notificaciones), CL5-CL6.

## v1.19.0 — Relevamiento Clientes CL1 + CL2: datos/permisos + CC clientes (PROD ✅)

Primeras dos fases del backlog Clientes (relevamiento `relevamiento_clientes_respuestas.md`). Migrations 171 + 172.
- **CL1 (mig 171):** baja = soft delete con razón (A6); alerta de duplicado al crear (A2); import con 3 modos + actualización + etiquetas (A5); autocomplete de etiquetas (F1); habilitar CC solo DUEÑO/SUPERVISOR (B2); CONTADOR read-only en Clientes (H2).
- **CL2 (mig 172):** enforcement de límite CC configurable + límite default (B1); vencimiento + interés de mora con recálculo sweep-lazy (B3); morosidad configurable (B4); cobranza FIFO desde ficha + POS + Caja (B5); config nueva en Configuración → Ventas → Operativa.
- **Próximo:** CL3 (incobrables + estado de cuenta PDF/portal), CL4-CL6.

## v1.17.0 — Relevamiento Ventas VF5: edición post-venta + NC interna (PROD ✅)

Quinta y última fase del backlog Ventas H-K (sin migración). **Relevamiento Ventas A-K completo.**
- **H1a**: quitar/editar ítems de una venta cobrada (vía Devolver) requiere DUEÑO/SUPERVISOR/ADMIN; otros roles necesitan la clave maestra para autorizar.
- **H1b**: al ajustar una venta facturada, el comprobante se identifica como "Nota de Crédito interna · no fiscal" + queda en el audit log de la venta.
- Pendiente futuro (fuera del relevamiento): NC electrónica AFIP (L1), venta física en USD (G5).

## v1.16.0 — Relevamiento Ventas VF4: reportes + alertas + export (PROD ✅)

Cuarta fase del backlog Ventas H-K (mig **170**).
- **K1**: 5 reportes nuevos en ReportesPage — baja rotación, más devoluciones, anuladas/devueltas con motivo, comparativa por canal (online/presencial), margen real por venta.
- **K3**: export CSV además de Excel/PDF en cada reporte.
- **K2**: alertas event-driven (margen negativo al cerrar venta; cliente/producto con >N devoluciones en M días) a DUEÑO/SUPERVISOR/ADMIN, con umbrales en Config → Ventas → Operativa.
- Pendiente del backlog: **VF5** (edición post-venta H1 + NC interna). L1 (Top 3) sin responder.

## v1.15.0 — Relevamiento Ventas VF1-VF3: POS operativo + canales + auditoría (PROD ✅)

Primeras 3 fases del backlog Ventas H-K (mig **167-169**).
- **VF1 (H2-H5)**: caja obligatoria en reserva/venta directa incl. 100% CC (solo presupuesto sin caja); flag Consumidor Final vs cliente registrado (cliente obligatorio si factura); enviar ticket por email; reimpresión desde historial.
- **VF2 (I1-I2)**: canales de venta configurables por tenant (online/presencial) + reglas distintas por clasificación (plazo devolución, descuento máx, lista de precios, requisito de cliente). MP deja de ser canal.
- **VF3 (J1-J3)**: audit log por venta (anulación/cambio cliente/override descuento); clave maestra para esas acciones; CONTADOR read-only en Ventas.
- Pendiente del backlog: VF4 (reportes/alertas) + VF5 (edición post-venta + NC interna). L1 (Top 3) sin responder.

## v1.14.1 — Hotfix: registro de negocio nuevo roto por RLS (PROD ✅)

Trigger de seed de `categorias_gasto` no era SECURITY DEFINER → fallaba el alta de tenant. Fix mig 166.

## v1.14.0 — ISS-174: cotización/generación de envíos por API de courier (PROD ✅)

Integración directa con las APIs de los couriers para cotizar y generar envíos (mig **162-165**).
- **F1 fundación**: servicio = select dependiente en POS; catálogo compartido `src/lib/couriers/catalogo.ts`; `courier_credenciales` (credenciales de API por tenant), `tenants.envio_peso_fuente` ('manual'|'producto'); peso/dim en producto; Config → Envíos (toggle peso-fuente + `CourierCredencialesPanel` owner-only).
- **F2-F5 integración**: Edge Function `courier-api` (cotizar/generar/tracking) con adapters **Andreani** (REST), **Correo Argentino** (Paq.ar) y **OCA** (SOAP). Cliente `src/lib/couriers/api.ts`. Cotizar en POS + Envíos; "Generar con courier" + etiqueta + "Actualizar tracking" en Envíos. Credenciales solo server-side.
- **⚠ Pendiente**: validar los adapters con cuentas B2B reales (escritos según docs públicas). Fail-safe sin credenciales.

## v1.13.0 — Relevamiento Ventas E/F/G completo: descuentos por rol + precio USD (PROD ✅)

Cierra el relevamiento de Ventas (mig **161**).
- **G3 — descuentos por rol**: solo DUEÑO/SUPERVISOR/ADMIN aplican descuentos (antes solo se bloqueaba CAJERO); bloqueo de inputs en POS + validación dura (ítem y global); SUPERVISOR sujeto a `descuento_max_supervisor_pct`, DUEÑO/ADMIN sin tope. Config aclarada.
- **G5 — precio en USD**: `productos.precio_usd` + `moneda_venta` ('local' | 'usd'); si es USD, el POS convierte a pesos a la cotización vigente al cargar el producto al carrito. (Venta física en USD/caja USD: fase futura.)

## v1.12.0 — Relevamiento Ventas E/F/G: reservas, presupuestos, mayorista (PROD ✅)

Implementación de las secciones E/F/G del relevamiento de Ventas (mig **159** + **160**).
- **Reservas (E1/E2/E6)**: seña obligatoria + mínima % configurable; vencimiento configurable con **liberación automática de stock** (`liberar_reservas_vencidas`, sweep lazy); cancelación con **penalidad %** + destino **devolución o crédito a favor** del cliente (`cliente_creditos`), gate por rol (E4); **redención** del crédito como medio de pago en el POS + saldo a favor en la ficha del cliente; **motivo de cancelación** con catálogo + observación (E3).
- **Presupuestos (F1/F5)**: correlativo independiente `PRES-{cod}-NNNN` por sucursal; botón "Actualizar presupuesto" on-demand (precios + reset de validez).
- **Listas/B2B (G1/G2/G4)**: precio **mayorista por cantidad** aplicado en el POS (tiers `producto_precios_mayorista`); **costo/margen oculto** para CAJERO/DEPOSITO.
- Config nueva en Config → Ventas → Operativa → "Reservas".

## v1.11.6 — ISS-127: GS1 QR Code como 3ª simbología (PROD ✅)

Los perfiles de códigos compuestos suman **GS1 QR Code** (`bcid gs1qrcode`) además de GS1-128 y DataMatrix. Generación individual y masiva. Sin migración.

## v1.11.5 — ISS-127 Códigos compuestos GS1 (grado WMS) — completo (PROD ✅)

Subsistema nuevo de códigos compuestos GS1 (GS1-128 + DataMatrix), leer/escribir múltiples campos en un código. **3 fases completas** (mig 157+158):
- **F1 — fundación**: `codigo_perfiles` (perfiles GS1/custom por proveedor) + `productos.gtin` + `src/lib/gs1.ts` (parser/encoder GS1) + Config → Inventario → Códigos + generación desde el LPN (`bwip-js`).
- **F2 — lectura ingreso**: detección GS1 (`looksLikeGS1`) + `resolverScanCompuesto` (match GTIN→producto con fallback) + autocompletado en ingreso individual y masivo.
- **F3 — cobertura completa**: DataMatrix lectura (`@zxing/library`) + Ventas/POS + Recepciones + Rebaje (lote→LPN) + modo `directo` (auto-crear LPN) + generación masiva de etiquetas.

## v1.11.4 — Seguridad deps + restyle visual + selección manual de LPN en reservas (PROD ✅)

Release combinado. **Seguridad**: `npm audit` 13→5 vulnerabilidades (jspdf 2→4 crítica, jspdf-autotable 3→5, xlsx → distribución oficial SheetJS, dompurify; las 5 restantes son solo dev-server). **Visual**: fondo de pantalla `#F5F0FF` (lila) → `#F8FAFC` (slate frío) + scrollbars rediseñados (pill flotante con tinte violeta de marca, light+dark). **Reservas (mig 156)**: `venta_items.lpn_plan JSONB` persiste el plan de LPN del carrito; al despachar una reserva se honra la selección manual del operador (Fase A) + autocompleta por sort si cambió el stock (Fase B). Cierra el anti-patrón de reservas (la parte de `stock_actual` ya estaba resuelta desde v1.11.0).

## v1.11.3 — Cierre Trazabilidad-extendida: devoluciones + recall por producto (PROD ✅)

Completa la Trazabilidad-extendida (sin migration, solo código sobre mig 155). Las **devoluciones** ahora se registran en `/historial` (`tipo_transaccion='devolucion'`, agrupadas por transacción, con producto_id + LPN → entran al recall de la unidad). La transición reserva→despacho/devuelta queda clasificada. El filtro "Trazá una unidad" suma búsqueda por **producto (nombre/SKU)** además de LPN/serie.

## v1.11.2 — Trazabilidad-extendida (/historial grado WMS) + aislamiento sucursal (PROD ✅)

Release que junta tres frentes. **Trazabilidad-extendida (mig 155)**: `actividad_log` pasa a ledger grado WMS (Manhattan/Blue Yonder) con `transaccion_id` + snapshots LPN/lote/serie. `/historial` (a) consolida las N filas de una acción en 1 transacción (cabecera + detalle), (b) suma filtro de recall "Trazá una unidad" por LPN/serie cruzando con `venta_item_despachos`, (c) export del set filtrado completo. **Aislamiento por sucursal**: guard de `setSucursal` (3ª capa cliente) + rótulo "Stock total (todas las sucursales)" en vista global. Decisión de diseño: ledger inmutable write-time, no heurística read-time.

## v1.11.1 — Patch ISS-075: manual/auto + stock vendible por sucursal + Inventario→Historial (PROD ✅)

Correctivo tras QA. Sin migrations. (a) `origen` manual/auto correcto (solo LPN elegidos por el operador son manual); (b) stock del movimiento de venta = vendible en la sucursal (no el total global); (c) desglose por LPN en el modal de Inventario→Historial (vivía en InventarioPage, no en la huérfana MovimientosPage, que se eliminó); (d) ingreso/rebaje manual al Historial de actividad portado a InventarioPage.

## v1.11.0 — ISS-075 trazabilidad despacho por LPN + ISS-151 CC + fix race rebaje (PROD ✅)

- **ISS-075** — trazabilidad de despacho: tabla `venta_item_despachos` (desglose por LPN/ubicación/serie de cada ítem vendido + `origen` manual/auto). Visible en detalle de venta, detalle de movimiento y `/historial`. Ingreso/rebaje manual al `actividad_log`. Toggle en Config → Inventario. Migrations 153+154.
- **ISS-151** — Cuenta Corriente: Condonar (write-off) + Revertir (restaura deuda), solo DUEÑO/SUPERVISOR/ADMIN. Dashboard excluye pseudo-métodos (CC/condonación) del mix de medios de pago.
- **Fix race condition (crítico)**: rebaje de venta era paralelo (`Promise.all`) → con el mismo producto en varias líneas del carrito se pisaba. Ahora secuencial. `stock_actual` lo maneja solo el trigger (se removió el update manual que lo desincronizaba). Recalc global de saneo.

## v1.10.4 — ISS-178 rangos horarios + C3/A7 relevamiento Ventas (PROD ✅)

**Estado:** desplegado en PROD ✅
**Fecha:** 2026-05-29
**Migration:** 152 (`envio_rangos_horarios JSONB` + `envios.rango_horario_desde/hasta TIME`) aplicada en PROD pre-merge

### Cambios
- **ISS-178** (Ventas + Envíos + Config · mig 152): rangos horarios de entrega configurables. `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos (8-13 / 13-18 / 18-22). `envios.rango_horario_desde/hasta TIME` como snapshot al momento del envío (no rompe si después se borra el rango de la config). Config → Envíos: card nueva con CRUD inline. VentasPage modal de envío y EnviosPage form: selector. EnviosPage tabla: badge accent con el rango.
- **C3 (parcial)** (POS · relevamiento Ventas A-D): CAJERO ya no puede colocar/editar descuentos por ítem ni descuento general en VentasPage. Inputs `disabled` con tooltip "Bloqueado para CAJERO. Pedile al SUPERVISOR/DUEÑO". Pendiente del mismo C3 (feature mayor): descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR.
- **A7** (Devoluciones · relevamiento Ventas A-D): radio "Dejar en DEV para revisión" (default — flujo previo) / "Reintegrar a stock vendible" (línea sin ubicación + `estado_id` = primer `es_disponible_venta`, aparece en alerta "Inventario sin ubicación") en el modal de devolución. Solo afecta a items no serializados.

---

## v1.10.4 — ISS-178 rangos horarios + C3/A7 relevamiento Ventas (PROD ✅)

**Estado:** desplegado en PROD ✅
**Fecha:** 2026-05-29
**Migration:** 152 (`envio_rangos_horarios JSONB` + `envios.rango_horario_desde/hasta TIME`) aplicada en PROD pre-merge

### Cambios
- **ISS-178** (Ventas + Envíos + Config · mig 152): rangos horarios de entrega configurables. `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos (8-13 / 13-18 / 18-22). `envios.rango_horario_desde/hasta TIME` como snapshot al momento del envío (no rompe si después se borra el rango de la config). Config → Envíos: card nueva con CRUD inline. VentasPage modal de envío y EnviosPage form: selector. EnviosPage tabla: badge accent con el rango.
- **C3 (parcial)** (POS · relevamiento Ventas A-D): CAJERO ya no puede colocar/editar descuentos por ítem ni descuento general en VentasPage. Inputs `disabled` con tooltip "Bloqueado para CAJERO. Pedile al SUPERVISOR/DUEÑO". Pendiente del mismo C3 (feature mayor): descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR.
- **A7** (Devoluciones · relevamiento Ventas A-D): radio "Dejar en DEV para revisión" (default — flujo previo) / "Reintegrar a stock vendible" (línea sin ubicación + `estado_id` = primer `es_disponible_venta`, aparece en alerta "Inventario sin ubicación") en el modal de devolución. Solo afecta a items no serializados.

---

## v1.10.3 — ISS-194 caja fuerte + RRHH-A5 + 3 bugs UX (PROD ✅)

**Estado:** desplegado en PROD ✅
**Fecha:** 2026-05-29
**Migration:** 151 (UNIQUE parcial `empleados(tenant_id, user_id)`) aplicada en PROD pre-merge

### Cambios
- **ISS-194** (Caja): `caja_fuerte_roles` default a `['DUEÑO']` (antes incluía SUPERVISOR + SUPER_USUARIO). Estos 2 roles aparecen como toggles habilitables en Config → Caja → Acceso a Caja Fuerte. ADMIN sin acceso. Tenants existentes con el valor viejo conservan su configuración — deben desactivar manualmente si lo prefieren.
- **RRHH-A5** (RRHH · mig 151): selector "Usuario del sistema (opcional)" en el form de empleado + columna "Usuario" en la tabla + validación cliente de duplicados. Habilita "Mi Equipo" del SUPERVISOR sin tocar la BD a mano — antes había que poblar `empleados.user_id` por SQL.
- **ISS-080** (Alertas): AlertasPage filtra por sucursal activa todas las secciones. Cruce client-side para `alertas` (vs PSMSS + `inventario_lineas` en la sucursal) y productos sin categoría (productos con stock activo en la sucursal). Sin schema change — la deuda técnica de `alertas` global queda documentada.
- **ISS-108** (Header / Mobile): selector de sucursal visible en celular. Ícono `Building2` + nombre truncado + `<select>` transparente superpuesto si el usuario `puedeVerTodas`. Antes el selector era `hidden sm:flex` y desaparecía bajo 640px.
- **ISS-148** (Recursos): componente `UbicacionPicker` reemplaza al input libre en los 3 puntos (form crear/editar, modal "Asignar ubicación", edit inline). Select con opciones del histórico filtradas por sucursal + opción "+ Nueva ubicación..." para typing puntual. Sin schema change.

---

## v1.10.2 — Bugfixes ISS-152/173 + caja sin PDF automático (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #120 mergeado `cc5c2073`, release latest, migrations 148-150 aplicadas pre-merge)
**Fecha:** 2026-05-28
**Release:** [v1.10.2](https://github.com/genesis360-app/genesis360/releases/tag/v1.10.2)
**Migrations:** 148 (unidades predefinidas) · 149 (habilitado_ventas/gastos en métodos pago) · 150 (monto_pagado/estado_pago en gastos)

### Cambios
- **ISS-152** (Gastos): selector de caja en nuevo gasto filtra estrictamente por sucursal activa — nunca muestra cajas de otras sucursales.
- **ISS-173** (Ventas): `monto_pagado` en reservas con pago parcial (seña) se calcula desde los medios reales ingresados, no desde `total − CC`. Corrige "Ya cobrado" cuando solo se cobró una seña.
- **Caja**: elimina descarga automática de PDF al cerrar sesión. El PDF de cierre sigue disponible manualmente desde el historial.

---

## v1.10.1 — Cierre HITO v1.9.0 + quick wins Envíos + 10 bugfixes (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #119 mergeado `842d7353`, release latest, migrations 143-147 aplicadas pre-merge, Vercel deploy `dpl_BxMq3Zu9iKEoNjLBEus76jk5xfX5`)
**Fecha:** 2026-05-28
**Release:** [v1.10.1](https://github.com/genesis360-app/genesis360/releases/tag/v1.10.1)
**Migrations:** 143 (cron tokens) · 144 (envio_pod_fotos) · 145 (fix saldo nómina) · 146 (FK traspasos) · 147 (supervisor=empleado)

### Cambios — features
- **Candado 🔒 por fila** en VentasPage y CajaPage: badge ámbar "Cerrado" en cada fila/sesión que cae en periodo contable cerrado, usando `useCierreContable.isPeriodoCerrado(fecha)`. Evita el rebote del toast del trigger DB.
- **PDF descargable del cierre contable** desde `CierresContablesPanel`: header BRAND + datos fiscales + periodo + snapshot tabla (Ventas/Gastos/Sueldos/OC) + resumen (Egresos + Resultado neto). Lee de `cierres_contables.totales JSONB`.
- **Cron limpieza tokens transportista** (migration 143): pg_cron diario 07:00 UTC. NULL en `envios.token_transportista` para envíos entregados/cancelados/devolucion con +30 días.
- **Múltiples fotos POD** (migration 144): tabla `envio_pod_fotos` con RLS + backfill + componente `PodFotosManager` con upload múltiple, thumbnails y eliminar. Integrado en modal POD y modal de edición. Sincroniza la primera foto (orden 0) con `envios.pod_url` para retro-compat.

### Cambios — bugfixes (10 issues)
- **ISS-182/183** (Gastos): comprobante obligatorio + medios de pago que cubran el total se validan al guardar.
- **ISS-184** (RRHH): empleados aparecen al instante tras crear (optimistic update).
- **ISS-195** (Cierre): cierres visibles en historial (quitado `users.email` inexistente del select).
- **ISS-150** (Recepción): precio costo no editable si la OC ya está pagada.
- **ISS-186** (RRHH/Caja) · migration 145: pagar nómina desde bóveda/caja considera traspasos en el saldo.
- **ISS-193** (Caja) · migration 146: corregir un traspaso ajusta la caja origen.
- **ISS-156/175/176** (Envíos): envío cobrado en venta no figura en Pagos Courier; `/transporte` valida pago.
- **ISS-185** (RRHH) · migration 147: supervisor del empleado = otro empleado (FK a empleados).

### Resiliencia
- ErrorBoundary reporta a Sentry + muestra detalle/ID + boundary por-ruta (un crash de página no tumba el menú).

---

## v1.10.0 — HITO Pipeline Reglas Caja CERRADO (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #118 mergeado `c857384b`, release latest, migrations 136-142 aplicadas)
**Fecha:** 2026-05-26
**Release:** [v1.10.0](https://github.com/genesis360-app/genesis360/releases/tag/v1.10.0)

### Cierre del pipeline Caja

8 de 8 decisiones críticas del relevamiento (PDF `relevamiento-caja-reglas-negocio.pdf`) implementadas en 6 versiones consecutivas durante 2 días.

### Migration 142 (esta versión)
- Vista `vw_caja_resumen_diario` (día/caja/sucursal) — sesiones, apertura, ingresos/egresos/ventas, saldo sistema, conteo real, diferencias. Excluye caja fuerte
- Vista `vw_caja_mensual_por_sucursal` (mes/sucursal) — totales, cajas activas, cajeros distintos. Alineada con cierre contable

### Componente `<CajaReportes />` (nuevo)
4 sub-tabs en CajaPage → tab Reportes:
- (a) Diario por caja con filtros fecha + sucursal
- (b) Diario consolidado de todas las cajas
- (c) Mensual por sucursal
- (d) Por cajero (volumen + diferencias 30 días)

3 exports en cada reporte: Excel · PDF · CSV (con BOM utf-8 para Excel ES)

### Fixes adicionales en la sesión
- ConfigPage tab Facturación: toggle auto-guarda con `setTenant(data)` para persistir
- VentasPage: caja predeterminada se pre-selecciona con `useMemo` (sin race con `useEffect`)
- VentasPage: medios de pago dinámicos desde `metodos_pago` (eliminada constante hardcodeada con "Otro" genérico)
- Bóveda: backfill fuzzy + helper `cuentaOrigenDeMetodo` tolerante a variantes de nombre (sin tildes/sin "de")

---

## v1.9.5 — Caja Fase 2.2a: Operaciones especiales (PROD ✅ vía v1.10.0)

**Fecha:** 2026-05-26 · L1/L4/L5/B7/G1 sin migration nueva
- L4: bloqueo cambio sucursal con caja propia abierta (AppLayout)
- L1: selector caja en devolución con efectivo (VentasPage)
- L5: cadena anulación según estado (caja abierta/cerrada/periodo cerrado)
- G1: botón "Corregir" en movimientos manuales con audit log
- B7: doble validación al cierre con cliente Supabase secundario (sin romper sesión)

---

## v1.9.4 — Caja Fase 2.1: Ticket cierre + Diferencias (PROD ✅ vía v1.10.0)

**Fecha:** 2026-05-26 · Migration 141
- `caja_sesiones.numero` correlativo por sucursal con trigger (K3)
- `caja_sesiones.snapshot_totales` JSONB para regenerar ticket idéntico (K2)
- `tenants.diferencia_caja_umbral/alerta_roles/alerta_canales` (B1/B2/B3)
- Vista `vw_diferencias_por_cajero` 30 días (B4)
- Ticket PDF ampliado A4 + formato térmico 80mm (C1+C3)
- Movimiento "Diferencia caja" asociado al cajero responsable

---

## v1.9.3 — Caja Fase 2.0: Permisos + Roles (PROD ✅ vía v1.10.0)

**Fecha:** 2026-05-26 · Migration 140
- `caja_sesiones.abierta_por` (A2)
- `tenants.config_caja JSONB` para permisos opcionales
- RPCs `requiere_clave_maestra` y `verificar_clave_maestra` SECURITY DEFINER (B5)
- Helper `src/lib/cajaPermisos.ts` con matriz J3 completa
- CONTADOR read-only · Abrir a nombre de cajero · Banner caja olvidada 24h · Clave maestra al cerrar ajena · Mail al DUEÑO al cierre

---

## v1.9.2 — Caja Tanda 1.5: Bóveda como billetera del negocio + Extraer dinero (PROD ✅ vía v1.10.0)

**Estado:** desplegado en DEV ✅ ([Vercel READY](https://genesis360-git-dev-tongas86s-projects.vercel.app) · commit `45e46cc7` · migrations 137+138 aplicadas)
**Fecha:** 2026-05-25
**Release:** [v1.9.2](https://github.com/genesis360-app/genesis360/releases/tag/v1.9.2)

### Goal cubierto
La bóveda muestra TODO el capital del negocio categorizado por cuenta de origen (efectivo, débito, crédito, MP, transferencia, etc.). Solo el DUEÑO/ADMIN/SUPER_USUARIO puede extraer dinero con registro privado.

### Migrations
- **137** `137_boveda_retiros_y_backfill.sql` · Tabla `boveda_retiros(id, tenant_id, cuenta_origen_id, monto, tipo_retiro, motivo, notas, usuario_id, movimiento_id, created_at)` con CHECK de 6 tipos (`banco/retiro_personal/gasto/inversion/pago_proveedor/otro`) · **RLS estricta** que exige rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') · Backfill `cuenta_origen_id` en movimientos históricos por concepto `[Nombre Método]` o tipo efectivo · UNIQUE partial index (1 cuenta efectivo por tenant)
- **138** `138_cuentas_origen_seed_metodos.sql` · Auto-seed: crea cuenta_origen por cada método de pago activo no-efectivo (MP/UALA → billetera · Tarjeta/Transferencia → banco · resto → otro) + vincula `metodos_pago.cuenta_origen_id` + re-aplica backfill

### Frontend (CajaPage tab Bóveda)
- **Botón "Extraer dinero"** (rojo, ml-auto) solo DUEÑO/ADMIN/SUPER_USUARIO
- **Modal completo**: selector de cuenta con saldo disponible en label · monto (valida saldo) · tipo de retiro (6 opciones) · motivo obligatorio · notas opcionales
- **Mutation `extraerDeBoveda`**: crea movimiento (`egreso_traspaso` si efectivo o `egreso_informativo` si banco/billetera) con `cuenta_origen_id` · inserta registro en `boveda_retiros` con link al movimiento
- **Sección "Historial de extracciones (privado)"** con borde rojo, último 50 retiros, badge por tipo, cuenta, motivo, notas, usuario, fecha/hora — solo DUEÑO+
- **Card "Capital del negocio · Total $X"** arriba derecha sumando todas las cuentas activas (solo DUEÑO+)
- Eliminada card hardcodeada "Efectivo (caja fuerte)" — ahora viene de `vw_boveda_cuentas` (única fuente de verdad)
- `operarCajaFuerte`: los 4 inserts de traspaso ahora setean `cuenta_origen_id = id cuenta efectivo`

### Datos validados en DEV
- Efectivo: $12.874.811 (86 movs)
- Mercado Pago: $37.228 (10 movs)
- Transferencia: -$958.749 (7 movs)

### Cubre del relevamiento
- ✅ **E4 + E5** del relevamiento Caja del 2026-05-25 (parcial — falta umbral configurable + email/notif)

---

## v1.9.1 — Caja Tanda 1: Cajas por moneda + Cuentas de Origen + sin egreso manual + arqueo pre-cierre (DEV ✅)

**Estado:** desplegado en DEV ✅ (commit `92e0cca5` · migration 136 aplicada)
**Fecha:** 2026-05-25
**Release:** [v1.9.1](https://github.com/genesis360-app/genesis360/releases/tag/v1.9.1)

### Migration 136
- `cajas.moneda TEXT NOT NULL DEFAULT 'ARS'` + índice + seed desde `tenants.moneda` (23 cajas en DEV)
- Tabla `cuentas_origen(id, tenant_id, nombre, tipo, banco, numero, alias, moneda, activo, notas)` con CHECK + RLS tenant + seed cuenta `Efectivo` por tenant
- `metodos_pago.cuenta_origen_id` FK opcional
- `caja_movimientos.cuenta_origen_id` FK + índice parcial
- Vista `vw_boveda_cuentas` con `security_invoker=true`

### Frontend
- **ConfigPage** tab Caja: ABM Cuentas de Origen con edición inline + toggle activo + eliminar con guard de FK
- **ConfigPage** tab Ventas: selector "Acredita en" en cada método de pago + badge `→ Cuenta`
- **VentasPage + GastosPage**: nueva query `metodos_pago_cfg` + helper `cuentaOrigenDeMetodo()` aplicado en los 10 inserts de movimientos informativos
- **CajaPage** tab Bóveda: cards de saldos discriminados por cuenta de origen con icono por tipo + saldo + count + moneda
- **CajaPage** modal Nueva Caja: selector de moneda obligatorio
- **CajaPage**: badges de moneda en pílulas y lista de configuración
- **CajaPage** modal movimiento manual: solo registra ingresos (G2 · sin egreso manual)
- **CajaPage**: arqueo pre-cierre obligatorio (D3 · botón "Cerrar caja" reemplazado por "Arqueo requerido" + validación dura)

### Cubre del relevamiento
- ✅ **F1** (cajas por moneda), **H1** (cuentas de origen + bóveda discriminada), **G2** (eliminar egreso manual), **D3** (arqueo pre-cierre obligatorio)

### Documentos
- PDF generado: `relevamiento-caja-reglas-negocio.pdf` (50 preguntas en 14 secciones) en raíz del repo
- Wiki: `sources/relevamientos/caja_2026-05-25.md` con respuestas A-I + estado de implementación

---

## v1.9.0 — HITO: Reglas Gastos Fases 4 + 5 — Capitalización + Cierre Contable (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #117 mergeado, Vercel READY, migrations 134+135 aplicadas)
**Fecha:** 2026-05-25

### Migrations
- **134** `gastos.capitaliza_recurso BOOLEAN` con CHECK constraint (TRUE solo si recurso_id IS NOT NULL) + índice parcial · VIEW `vw_egresos_consolidados` (gastos + rrhh_salarios.pagado=true) con `security_invoker=true`
- **135** Cierre contable mensual: tabla `cierres_contables(tenant, periodo, fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB)` UNIQUE(tenant, periodo) + 5 triggers BEFORE UPDATE/DELETE en `gastos/ventas/caja_movimientos/caja_sesiones/ordenes_compra` + RPCs `cerrar_periodo` y `reabrir_periodo` + `gastos.gasto_padre_id` + `gastos.es_correccion`

### Fase 4 — Recursos↔Gastos + Dashboard consolidado
- **Capitalización**: checkbox "Sumar al valor del recurso" en form de gasto (visible solo si hay recurso_id) → `capitaliza_recurso=true` suma al valor patrimonial
- **RecursosPage**: nueva card stats "Mantenimiento acumulado" + chips por recurso "🔧 Mantto" + "📈 Cap." con cantidad de gastos · valor patrimonial = base + capitalizaciones
- **DashGastosArea**: banner "Costo laboral del período (RRHH)" debajo de los 4 KPIs con link a `/rrhh?tab=nomina` + total consolidado Gastos + RRHH
- **RentabilidadPage**: nueva sección "Estado de resultados (período)" con líneas separadas Ventas / CMV / Ganancia bruta / Gastos operativos / **Sueldos pagados (RRHH)** / Resultado neto

### Fase 5 — Cierre Contable Mensual (HITO transversal)
- **DB**: triggers BEFORE UPDATE/DELETE bloquean modificaciones en periodos cerrados con RAISE EXCEPTION SQLSTATE P0001. Helpers `ultimo_cierre_hasta(tenant)` y `periodo_cerrado(tenant, fecha)`
- **RPC `cerrar_periodo`**: DUEÑO/SUPERVISOR/CONTADOR/SUPER_USUARIO/ADMIN. Valida que el periodo sea > último cierre y no esté en curso. Snapshot de totales (gastos, ventas, sueldos, OC) en JSONB
- **RPC `reabrir_periodo`**: solo último cierre + solo DUEÑO/ADMIN/SUPER_USUARIO
- **Frontend**:
  - Hook `useCierreContable()` → `{ ultimoCierre, isPeriodoCerrado(fecha) }` + helper `manejarErrorPeriodoCerrado()`
  - Componente `CierresContablesPanel` con preview live + listado expandible con totales snapshot + botón "Reabrir"
  - Nuevo tab "Cierres contables" en GastosPage
  - Notas de corrección: candado 🔒 reemplaza Editar/Eliminar para gastos cerrados · modal de corrección pre-rellena datos del padre, fecha=hoy, monto negativo permitido · persiste `gasto_padre_id` + `es_correccion=true`
  - VentasPage: handler "Eliminar venta" intercepta y muestra el mensaje del trigger

### Doc nuevo
- `wiki/development/cierre-contable.md` — concepto, schema, triggers, RPCs, hook, componente, casos de uso, pendientes opcionales

---

## v1.8.44 — Reglas de Negocio Gastos Fases 1-3 + Moneda multi-país (PROD ✅)

**Estado:** completado en DEV
**Fecha:** 2026-05-24

### Migration
- **133** `tenants.moneda` (11 monedas LatAm + EUR/USD) + `gastos/gastos_fijos.alicuota_iva` + tabla `autorizaciones_cc` (motivo_bloqueo `limite_excedido | oc_vencida`)

### Nuevas features
- **Moneda principal del tenant** (etiqueta visual, sin conversión): selector en ConfigPage > Mi Negocio. Lista inicial: ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR
- **Helper centralizado `src/lib/formato.ts`**: `formatMoneda(monto, moneda)` con símbolo + locale específicos por moneda. Migración aplicada en: Gastos, Caja, Clientes, Envíos, Facturación, Métricas, Rentabilidad, Reportes
- **IVA auto según tipo de comprobante**: al seleccionar Factura A/B/Ticket → 21% · Factura C/Recibo/bienes usados → sin_iva. Solo si tipo_iva está vacío (no sobrescribe selección manual)
- **Selector de alícuota IVA extendido**: 21%, 10.5%, 27%, 0%, exento, sin_iva, personalizado (input numérico)
- **Sucursal obligatoria por categoría**: si la categoría tiene `requiere_sucursal=true` y no hay sucursal activa, bloqueo + aviso amber inline
- **Bloqueo CC con proveedor problemático**:
  - Helper `chequearBloqueoCC(proveedorId, monto)`: detecta OC con CC vencida o saldo + monto > límite_credito_proveedor
  - Modal `SolicitarOverrideCCModal` permite pedir autorización al DUEÑO con motivo
  - Bandeja `BandejaAutorizacionesCC` para que el DUEÑO apruebe/rechace
  - `existeAutorizacionCCAprobada(proveedorId)`: si hay aprobación válida <24h sin usar, se permite continuar sin volver a pedir
- **Sub-tabs en "Autorizaciones"** dentro de GastosPage: Gastos / CC Proveedores

### Pendientes Fase 4-5 (v1.8.45 → v1.9.0)
Ver `wiki/development/reglas-negocio.md` sección "Plan de implementación".

---

## v1.8.43 — Reglas de Negocio Gastos Fase 2: Umbrales + Autorizaciones (PROD ✅ vía v1.8.44)

**Estado:** completado en DEV
**Fecha:** 2026-05-24

### Migration
- **132** `sucursales.umbral_gasto_supervisor/cajero` + tabla `autorizaciones_gasto` (tipo/monto/payload/solicitante_rol/estado/aprobador) + helper SQL `puede_aprobar_autorizacion_gasto`

### Nuevas features
- **Helper `src/lib/umbralGasto.ts`**: `evaluarUmbralGasto(rol, sucursal, monto)` + `puedeAprobar(solicRol, aprobRol)`. Reglas: DUEÑO/ADMIN sin tope · SUPERVISOR umbral configurable (NULL = sin tope) · CAJERO umbral configurable (NULL = todo pide auth) · CONTADOR no crea (solo IVA)
- **SolicitarAutorizacionGastoModal** (componente): se abre cuando el monto supera el umbral del rol; pide motivo y crea registro en `autorizaciones_gasto` con payload completo
- **BandejaAutorizacionesGasto** (componente): nuevo tab en GastosPage visible solo a SUPERVISOR+ con badge de pendientes (refetch 30s). Aprueba ejecutando INSERT/UPDATE/DELETE en gastos según `tipo` + marca aprobada; rechaza con motivo obligatorio
- **SucursalesPage** — bloque "Umbrales de autorización de gastos" con 2 inputs por sucursal (supervisor + cajero)
- **GastosPage** — restricciones de rol:
  - CAJERO ve solo sus propios gastos (filter `usuario_id = user.id`)
  - CONTADOR: aviso 📊 en modal de edición + monto bloqueado + botón "Nuevo gasto" oculto

### Pendientes Fase 3-5 (v1.8.44 → v1.9.0)
Ver `wiki/development/reglas-negocio.md` sección "Plan de implementación".

---

## v1.8.42 — Reglas de Negocio Gastos Fase 1 (PROD ✅ vía v1.8.44)

**Estado:** completado en DEV  
**Fecha:** 2026-05-24

### Migrations
- **130** `categorias_gasto`: catálogo por tenant + seed de 16 categorías + trigger automático + FK opcional en gastos/gastos_fijos
- **131** `tenants.gastos_*`: 7 columnas para reglas de comprobante (4 toggles OR + monto umbral) + días alerta borrador + días alerta anticipo OC

### Nuevas features
- **GastosPage** — selector de categoría dinámico desde tabla `categorias_gasto` (fallback a constante hardcoded)
- **GastosPage tab Fijos** — indicadores de estado por gasto fijo: 🟢 Dentro de fecha · 🟡 Pendiente este mes · 🔴 Atrasado (+Nd) · ✅ Generado este mes
- **GastosPage tab OC** — badge "💰 Anticipo" naranja/rojo cuando hay pago sin recepción (rojo después de N días configurable)
- **ConfigPage tab Gastos** (nueva) — 3 secciones: Reglas comprobante (4 toggles + umbral), Alertas (2 inputs), Categorías (CRUD con `requiere_sucursal` + `activo`)

### Pendientes Fase 2-5 (v1.8.43 → v1.9.0)
Ver `wiki/development/reglas-negocio.md` sección "Plan de implementación".

---

## v1.8.40 — Módulo Envíos completo + fixes integridad inventario (PROD ✅)

**Estado:** desplegado a PROD  
**Fecha:** 2026-05-23 · PR #115

### Nuevas features Envíos
- **ISS-165** Página pública `/transporte/:token` para transportista (sin login, mobile-first)
- **ISS-166** Botón cámara en modal POD — sube foto a Storage `etiquetas-envios/pod/`
- **ISS-167** QR codes en remito PDF (envío esquina superior derecha, venta al lado del DESTINATARIO)
- **ISS-168** LPN y ubicación de mercadería en panel expandido de cada envío
- **ISS-169** Pestaña Pagos Courier — selección múltiple, marcar pagados
- **ISS-171** Bloquea progresión de estado si costo del courier no está pagado
- Número venta coherente Ventas ↔ Envíos (prefijo sucursal opcional, fallback `#global`)
- DashEnviosArea: `en_bodega` en funnel, velocidad real desde POD, insight cancelados

### Fixes críticos integridad inventario
- Cambio de sucursal en VentasPage limpia carrito automáticamente (toast explicativo)
- Query de lineas filtra estrictamente por `sucursal_id` al vender/reservar
- Validación: bloquea venta si hay >1 sucursal y ninguna seleccionada
- Carrito restaurado: re-fetch de lineas dentro del mismo effect (sin race condition)

### Fixes UX
- Autocomplete direcciones con `AutocompleteSuggestion` API (misma que Google Maps)
- Cálculo distancia con Haversine + coords pre-geocodificadas (instantáneo, sin API calls)
- Alertas si dirección de origen o destino no geocodifica con link a corregir
- Stock 0 al restaurar carrito: resuelto definitivamente
- Botón "Compartir transportista" usa `VITE_APP_URL` (link siempre a producción)

### Migrations en PROD
- 127: `envios` — POD fields + estado `en_bodega`
- 128: `envios` — `costo_pagado + fecha_pago_courier + medio_pago_courier`
- 129: `envios.token_transportista` + 3 funciones SECURITY DEFINER públicas

---

## v1.8.39 — POD + en_bodega + fix crítico envíos + corrección totales (DEV ✅)

**Estado:** en DEV · pendiente deploy a PROD  
**Fecha:** 2026-05-21

### Fixes críticos
- **BUG envíos auto-creados**: `cliente_id` inexistente en tabla causaba que el INSERT fallara → ningún envío se creaba al hacer una venta con envío. Fix: campo eliminado.
- **Saldo modal con envío**: `ventaDetalle.total` no incluía `costo_envio` → saldo incorrecto al completar reservas o presupuestos con envío. Fix: usa `total + costo_envio`.
- **Totales en historial**: lista, detalle y ticket ahora muestran `total + costo_envio` (total real pagado).

### Nuevas features
- **Estado `en_bodega`**: nuevo estado entre `en_camino` y `entregado` (paquete en depósito del courier). Badge violeta + icono Warehouse.
- **POD (Proof of Delivery)**: campos `pod_fecha`, `pod_receptor`, `pod_notas`, `pod_url` en tabla `envios`. Modal POD standalone + sección en modal de edición.
- **Fecha de entrega acordada en VentasPage**: nuevo campo en el panel de envío del POS, se guarda en el envío auto-creado.
- **Canal correcto en envío auto-creado**: usa `canalPOS` de la venta (Instagram, Facebook, WhatsApp, etc.) en lugar de hardcodear 'POS'.

### Migration
- 127: `envios` — POD fields + CHECK `en_bodega`

---

## v1.8.38 — Scan ticket IA + fixes Dashboard + ISS-090 CC (DEV ✅)

**Estado:** en DEV · pendiente deploy a PROD

### Nuevas features
- **Scan ticket** (Claude Sonnet 4.6 vision): EF `scan-ticket` analiza foto de ticket de supermercado
  - **RecepcionesPage**: escanear ticket → matcheo contra catálogo → carga automática al formulario de recepción con precio_costo del ticket
  - **ProductosPage**: escanear ticket → validar catálogo → actualizar precio_costo o crear productos nuevos con SKU auto-generado

### Fixes críticos
- **Dashboard Productos/Inventario — KPIs en $0**: columna `categoria` migrada a FK `categoria_id` → queries usaban columna inexistente → 400 → data=null → todo en 0
- **Dashboard rotación/runway = 0**: `movimientos_stock` de ventas creados sin `sucursal_id` → filtro estricto los excluía → rotación 0
- **Banner sucursal en Dashboard**: aviso cuando hay sucursal seleccionada (el selector no aparece en /dashboard) + botón "Ver todo"
- **ISS-090 CC validación**: validar correctamente pagos mixtos CC+efectivo, CC+tarjeta, y 100% CC

---

## v1.8.37 — Gastos/Caja/Config/MODO/ISS-136 (PROD ✅)

**PR #114** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.37  
**Migrations 122–126** aplicadas en DEV y PROD ✅

### ISS-136 — Gastos en Caja (fix definitivo)
- Gastos variables, Gastos Fijos (Generar) y pagos OC registran en caja correctamente
- Efectivo → `egreso` (descuenta saldo) · Otros → `egreso_informativo` (informativo)
- Editar gasto borrador para agregarle pago también registra en caja
- Bloqueo de monto/pago al editar si ya fue a caja
- Reversión automática al eliminar gasto con pago (movimiento inverso)
- Prioriza sesión propia del usuario (evita enviar a caja de otro)

### ISS-110 — Canales de venta
- `ventas_origen_check` extendida con Instagram, Facebook, WhatsApp, Otros (migration 122)

### MODO — Integración completa
- `modo-crear-pago` y `modo-webhook` deployadas en DEV y PROD
- QR interoperable + polling de confirmación + modal redesigned

### ConfigPage — Fases 1-4
- 11 tabs temáticas con grupos (Negocio/Sistema)
- Mi negocio: email legal, redondeo de precios, config por sucursal
- Ventas: comisión % por método, cliente en POS, descuento máx cajero/supervisor
- Caja: contraseña maestra, umbral bóveda
- Métodos de pago desde DB (ISS-133), badge "Borrador" (ISS-138), descuento en OC (ISS-132)

---

## v1.8.31 — Variantes, multi-sucursal completo, Dashboard renovado (PROD ✅)

**PR #113** — mergeado a `main` ✅  
**Migrations 111–121** aplicadas ✅

---

## v1.8.27 — Fix crítico registro nuevo negocio (PROD ✅)

**PR #112** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.27  
**Migrations 109–110** aplicadas en DEV y PROD ✅

- Fix: `fn_crear_caja_fuerte` declarada `SECURITY DEFINER` — el trigger disparaba antes de que el user existiera en `users`, bloqueando el INSERT en `cajas` por RLS
- Migration 109: tabla `modo_credentials` (MODO payments — ISS-072)

---

## v1.8.22 — Cuotas tarjeta + CC parcial + Ticket sucursal + Bugfixes (PROD ✅)

**PR #111** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.22  
**Migration 108** aplicada en DEV y PROD ✅

### v1.8.21 — Bugfixes batch (13 issues)
- ISS-087: ★ visual en caja predeterminada
- ISS-088: fix monto sugerido apertura (monto_cierre confiable)
- ISS-089: selector caja origen en modal Ingresar a Caja Fuerte + validación saldo
- ISS-094: rollback venta CC cuando falla stock
- ISS-097: fix crítico Rules of Hooks en EnviosPage
- ISS-081/082: decimales en ventas + faltante estático al tipear
- ISS-091: badge stock insuficiente en carrito
- ISS-092: carrito recuperado restaura modoCC + clienteCCEnabled desde DB
- ISS-093: tag CC en historial de ventas
- ISS-103: selector canal de venta en POS
- ISS-084: gastos efectivo con caja específica + validación saldo + Caja Fuerte
- ISS-102: clientes y proveedores globales (sin filtro de sucursal)

### v1.8.22 — Features batch (5 issues)
- ISS-085: Número de ticket por sucursal con prefijo (migration 108)
- ISS-086: Cuotas tarjeta de crédito — config bancos en ConfigPage + picker en POS
- ISS-090: CC como método de pago parcial en ventas (pago mixto)
- ISS-095: OC con CC como método de pago parcial (flujo unificado)
- ISS-096: Comprobante de pago en OC — adjuntar PDF/imagen

---

## v1.8.1 — Módulo Recursos + estructura en ingreso + multi-sucursal + fixes (PROD ✅)

### Multi-sucursal — filtrado estricto
- `useSucursalFilter.applyFilter`: `.or(eq+null)` → `.eq()` estricto. Con sucursal activa, datos exclusivos de esa sucursal.
- Opción "Todas las sucursales" en selector del header.
- `authStore`: sentinel `'__global__'` en localStorage para persistir vista global entre recargas.

### Módulo Recursos (migration 089)

### Módulo Recursos (migration 089)
- Nueva tabla `recursos` (patrimonio del negocio, no para vender). Estados: activo/en_reparacion/dado_de_baja/pendiente_adquisicion.
- `RecursosPage` 2 tabs: Patrimonio + Por adquirir. CRUD, stats, alertas garantía, CTA cotizar → /proveedores.
- Sidebar: ícono Landmark, ownerOnly, entre Prov./Servicios y Recepciones.

### Estructura de embalaje en ingreso de stock
- `InventarioPage` modal ingreso: select de estructura preseleccionado con la default del producto.
- `RecepcionesPage`: idem por cada ítem. Carga estructuras async al agregar producto (manual o desde OC).
- Guarda `estructura_id` en `inventario_lineas` en ambos flujos.

### Fixes
- Banner DEV: `h-4 text-[10px]` (~25% más fino) + `mt-4` en AppLayout → no solapa header/sidebar.
- ProveedoresPage: badge estado_pago en cards de OC (rojo/ámbar/azul/vencida).
- EnviosPage: botón WhatsApp fallaba — faltaba `telefono` en join de clientes.

### Housekeeping
- CLAUDE.md reducido de ~1500 a ~120 líneas. Reglas de wiki obligatorias.

**Migration 089 aplicada en PROD** ✅  
**PR #105** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.1

---

## v1.8.0 — NC electrónicas + email CAE + fixes OC (migration 088)

### Notas de Crédito electrónicas
- `devoluciones` + campos `nc_cae`, `nc_vencimiento_cae`, `nc_numero_comprobante`, `nc_tipo CHECK(NC-A/NC-B/NC-C)`, `nc_punto_venta`
- EF `emitir-factura`: acepta `tipo_comprobante: NC-A|NC-B|NC-C` + `devolucion_id` → guarda CAE en `devoluciones`
- VentasPage: badge verde `NC-B #000001` + botón "Emitir NC" en sección devoluciones del modal

### Email al cliente al emitir CAE
- EF `send-email`: nuevo tipo `factura_emitida` con tabla ítems + badge CAE
- EF `emitir-factura`: fire-and-forget email post-CAE al cliente (solo facturas, no NC)

### GastosPage OC — fixes
- Medios de pago mixtos en OC: N filas + "+ Agregar medio", total en tiempo real, egreso de caja por cada Efectivo
- Fix CC: ya no valida monto, registra saldo como deuda automáticamente
- OC pagadas al fondo con sort + expand ítems

### ProveedoresPage — fix
- "Confirmar OC" solo habilitado con `estado_pago = 'pagada'` o `'cuenta_corriente'`. Con `pago_parcial` muestra tooltip bloqueado.

---

## v1.7.0 — API pull (migration 087)

- EF `data-api` (--no-verify-jwt): GET con `entity`, `format`, `limit`, `offset`, `updated_since`, `sucursal_id`. Entidades: productos/clientes/proveedores/inventario. Auth: X-API-Key. Rate 120 req/min.
- Migration 087: tabla `api_keys` (key_prefix, key_hash SHA-256, permisos TEXT[], activo, last_used_at). RLS tenant + OWNER/ADMIN.
- ConfigPage tab "API" (OWNER/ADMIN): generar key (plain text una sola vez), tabla prefijo + last_used_at, revocar, docs inline.
- Exportar JSON/CSV en ProductosPage, ClientesPage, ProveedoresPage (dropdown, BOM UTF-8).

---

## v1.6.1 — Security hardening + Sentry + OC PDF/CSV (migrations 086 + 086b)

### Security hardening
- `REVOKE EXECUTE FROM PUBLIC` en funciones de trigger/internas
- `REVOKE FROM PUBLIC + GRANT TO authenticated` en funciones de negocio y auth helpers
- `SET search_path = public` en ~35 funciones
- Buckets `avatares` + `productos`: policy SELECT restringida a `authenticated`
- **Resultado:** 80 → 7 warnings en Supabase Security Advisor (7 aceptados by design)

### Sentry
- `@sentry/react` en `src/main.tsx`, `tracesSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`
- Variable `VITE_SENTRY_DSN` en Vercel Production

### OC — fixes
- Cantidad en ítems respeta `unidad_medida`: enteros bloquean `.`/`,`; decimales `step=0.001`
- Botones PDF (jsPDF + autoTable) y CSV (BOM UTF-8) en modal detalle OC. Nombre: `OC_0001_Proveedor.pdf/.csv`

### npm audit: 21 → 7 vulnerabilidades

---

## v1.6.0 — OC gestión de pagos + CC Proveedores (migration 085)

- `ordenes_compra` + `estado_pago` (pendiente_pago/pago_parcial/pagada/cuenta_corriente) · monto_total · monto_pagado · fecha_vencimiento_pago
- Tab "Órdenes de Compra" en GastosPage: lista filtrable, badge rojo/ámbar por vencimiento, modal pago/CC
- ProveedoresPage: Confirmar OC deshabilitado con `pendiente_pago`, botón CreditCard por proveedor → modal CC
- Tabla `proveedor_cc_movimientos` + `fn_saldo_proveedor_cc()` SECURITY DEFINER
- AlertasPage: sección roja "OC vencidas sin pagar" + sección ámbar "OC por vencer en 3d"

---

## v1.5.0 — Notificaciones reales + Caja Fuerte + PDF Factura QR (migration 084)

- Tabla `notificaciones` real con RLS user-only. `NotificacionesButton` con datos reales.
- EF `send-email` tipo `notificacion`. Warning diferencia apertura → notifica supervisores.
- Tab Caja Fuerte + Tab Configuración en CajaPage. `getTipoDisplay()` distingue venta/manual.
- `src/lib/facturasPDF.ts`: PDF A4 con QR AFIP (RG 4291). `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- Pago CC inline: `registrarPagoCC()` FIFO sobre ventas CC.

---

## v1.4.0 — Cuenta Corriente + Presupuesto vencido + Bulk actions (migration 083)

- `clientes.cuenta_corriente_habilitada` + `limite_credito` + `plazo_pago_dias`; `ventas.es_cuenta_corriente`
- Tab "CC" en ClientesPage: KPIs, deuda, botón WA, registrar pago
- VentasPage: botón "Despachar a cuenta corriente" (bypasa validación pago/caja)
- `isPresupuestoVencido()`: badge "Vencido" + banner en modal + "Actualizar precios ahora"
- Bulk actions en ProductosPage: checkboxes + barra flotante (categoría/regla/aging/atributos/desactivar)
- TN Stock Worker: BATCH_SIZE 200, CONCURRENCY 20 → ~2.400 jobs/min

---

## v1.3.0 — Facturación AFIP + Envíos + WhatsApp (migrations 072–081)

- `FacturacionPage` 4 tabs: Panel · Facturación · Libros IVA · Liquidación. EF `emitir-factura` con AfipSDK. Homologación exitosa.
- `EnviosPage` con estados, remito PDF, WhatsApp Click-to-Chat. Prerequisito: `cliente_domicilios` (migration 074).
- `src/lib/whatsapp.ts`: normalización, plantilla configurable, `$ por km`.
- Clientes: notas (append-only), fecha_nacimiento, etiquetas, búsqueda por DNI.
- GastosPage overhaul: IVA, múltiples medios, historial separado, fijos con alerta.
- Proveedores: `proveedor_productos`, `servicio_items`, `servicio_presupuestos`.

---

## Historial comprimido (antes de v1.3.0)

| Versión | Hito principal |
|---------|---------------|
| v0.26.0 | RRHH Phase 1 — empleados, puestos, departamentos |
| v0.27.0 | Caja ↔ Ventas ↔ Gastos integrados |
| v0.32.0 | RRHH Phase 2A — Nómina |
| v0.33.0 | RRHH Vacaciones + Asistencia |
| v0.34.0 | RRHH Documentos + Capacitaciones |
| v0.35.0 | RRHH Dashboard + Phase 5 Supervisor |
| v0.36.0 | Límites de movimientos por plan |
| v0.37.0 | Matriz de features + UpgradePrompt |
| v0.42.0 | Multi-sucursal |
| v0.47.0 | Scanner reescrito (BarcodeDetector + ZBar WASM) |
| v0.51.0 | Scanner definitivo + Completar desde foto (Claude Haiku) |
| v0.57.0 | WMS Fase 1 (estructuras) + Ingreso/Rebaje masivo |
| v0.58.0 | Devoluciones |
| v0.63.0 | Mi Cuenta + restricciones menú por rol |
| v0.65.0 | KITs/Kitting WMS Fase 2.5 |
| v0.68.0 | IVA por producto + Design System Sprint 1+2 |
| v0.69.0 | Dashboard rediseño + FilterBar + La Balanza + Mix de Caja |
| v0.72.0 | Roles CONTADOR + DEPOSITO |
| v0.76.0 | Módulo Proveedores + Órdenes de Compra |
| v0.83.0 | Conteo de inventario + Estructura LPN |
| v0.86.0 | Tab Autorizaciones DEPOSITO |
| v0.87.0 | Combinar LPNs + LPN Madre |
| v0.88.0 | Módulo Recepciones/ASN |
| v0.89.0 | Integraciones OAuth (TiendaNube + MercadoPago) |
| v0.90.0 | TN Webhooks + Sync stock + Monitoring diario |
| v1.0.0 | Stock reservation + pg_cron sync 5min |
| v1.1.0 | Importar maestros extendido + Config UX |
| v1.2.0 | Clientes mejorado (dominios, etiquetas) |

---

## Pendientes / Backlog

> Estado real de PROD/DEV → ver `G360.Wiki/sources/raw/project_pendientes.md`

### Media prioridad
- **Notificación automática CC vencida** — pg_cron diario → INSERT `notificaciones` para clientes/OC vencidas sin pagar
- **OC → Gasto automático** al confirmar recepción en RecepcionesPage
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas, form bug-report

### Backlog técnico
- **WMS Fase 3** — `wms_tareas` (putaway/picking/replenishment) + listas de picking con ruta óptima
- **RecepcionesPage completa** — schema existe (migrations 050+059), falta flujo UI completo
- **Sync catálogo TN/ML** — push nombre/precio/descripción hacia marketplaces
- ~~**Courier rates APIs (ISS-174)**~~ — ✅ **Hecho en v1.14.0** (F1-F5: cotizar/generar/tracking por API directa Andreani/Correo/OCA, Edge Function `courier-api`). Pendiente solo: validar adapters con cuentas B2B reales.
- **WhatsApp automático** — espera WABA account

### Pendiente manual (no código)
- Verificar genesis360.pro en Resend → cambiar FROM a `noreply@genesis360.pro`
- Cargar créditos en console.anthropic.com para `scan-product` (Claude Haiku ~$0.0003/img)
- Constitución empresa → CUIT activo (bloquea AFIP en PROD real)
- Google Ads Standard Token (proceso largo)

### Ideas futuras
- Cupones de descuento
- WhatsApp diario automático
- IA chat integrado
- Benchmark por rubro
- Multilenguaje

---

## Links relacionados

- [[wiki/business/modelo-negocio]]
- [[wiki/business/planes-pricing]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/wms]]
- [[wiki/features/envios]]
- [[wiki/features/clientes-proveedores]]
