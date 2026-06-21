---
name: cobertura-ventas-productos-facturacion
description: Auditoría de cobertura — Ventas/POS + Productos + Presupuestos/Reservas + Facturación AFIP. Inventario exhaustivo de lógicas + matriz de flags (CON/SIN) + gaps priorizados (REGLA #0). Pedido de GO (2026-06-21).
type: project
---

# Cobertura — Ventas/POS · Productos · Presupuestos/Reservas · Facturación AFIP

> Marco y convención: [[uat-cobertura.plan.md]] (capas de validación, tags `[modo]`/`[CFG]`).
> Leyenda cobertura: ✅e2e (spec NN) · ✅unit · ✅UAT(§) · 🟡parcial · 🔴gap. **REGLA #0** = fiscal/plata/stock (cero errores tolerados).
> Refs principales: `src/pages/VentasPage.tsx` (2169+ líneas), `src/pages/ProductosPage.tsx`, `src/pages/ProductoFormPage.tsx`,
> `src/pages/FacturacionPage.tsx`, `src/lib/facturacionLogic.ts`, `supabase/functions/emitir-factura/index.ts`,
> `src/hooks/useCanalesVenta.ts`, `src/hooks/useCotizacion.ts`, `src/hooks/usePlanLimits.ts`, `src/lib/ccLogic.ts`, `src/config/brand.ts` (no aplica).

---

## 1) Lógicas del grupo

| # | Lógica | archivo:función | REGLA #0 | Cobertura actual |
|---|--------|-----------------|:--------:|------------------|
| **Facturación / fiscal** |
| L01 | Auto-detección tipo comprobante (emisor Mono/Exento→C; RI+RI→A; RI+resto→B) | `facturacionLogic.ts:detectarTipoComprobante` (44-51); usado `VentasPage.tsx:1457`, `FacturacionPage.tsx:578` | 🔴 | ✅unit (FAC-TIPO-01..07) · ✅e2e 21 (runtime, primer tipo habilitado) |
| L02 | Letras emitibles según emisor (selector POS/Facturación) | `facturacionLogic.ts:tiposComprobantePermitidos` (57-59); `VentasPage.tsx:7049-7050`, `FacturacionPage.tsx:895` | 🔴 | ✅unit · 🟡e2e (no se valida que NO ofrezca C a RI ni viceversa por UI) |
| L03 | Guard server-side emisor↔letra (Mono/Exento→solo C; RI→nunca C) | `emitir-factura/index.ts:80-91` | 🔴 | 🟡code-audit · 🔴e2e (no se prueba el rechazo 400 directo a la EF) |
| L04 | Desglose IVA por alícuota (neto = subtotal/(1+tasa), precio incl. IVA) | `facturacionLogic.ts:calcularIvaDesglose` (91-131); EF `index.ts:198-235` | 🔴 | ✅unit (FAC-IVA-01..10) · ✅e2e 21 (CAE real) |
| L05 | Normalización numeric PG ("21.00"→"21") anti error AFIP 10051 | `facturacionLogic.ts:105-107`; EF `index.ts:211-217`; `ProductoFormPage.tsx:274,410` | 🔴 | ✅unit (FAC-IVA-08/09/10) · ✅e2e 43 (alta 10,5% persiste) |
| L06 | Importes por tipo: C/NC-C no discrimina IVA (ImpNeto=ImpTotal, sin array Iva) | `facturacionLogic.ts:calcularImportes`/`esComprobanteSinIVA` (143-162); EF `index.ts:194,203-206,320-327` | 🔴 | ✅unit (FAC-C-01..03) · ✅e2e 21 (Factura C) / 42 (NC-C) |
| L07 | Invariante ImpTotal = neto+IVA (anti error AFIP 10048) | `facturacionLogic.ts:124`; EF `index.ts:235-238` | 🔴 | ✅unit (FAC-IVA-07) · 🟡code-audit (el `console.warn` por descuento global no prorrateado NO bloquea) |
| L08 | DocTipo/DocNro del receptor (A→CUIT obligatorio; ≥umbral+DNI→96; resto→99 CF) | `facturacionLogic.ts:determinarReceptor` (183-205); EF `index.ts:168-180` | 🔴 | ✅unit (FAC-DOC-01..07) · 🟡e2e |
| L09 | FAC-27 guard server: Factura B ≥ umbral sin identificar → rechazo | `emitir-factura/index.ts:182-190` | 🔴 | 🔴gap e2e (solo code-audit; el guard UI sí en `VentasPage.tsx:1490-1499`) |
| L10 | Costo de envío facturado → ítem + alícuota predominante + Concepto=3/FchServ* | `emitir-factura/index.ts:139-161,294-295` | 🔴 | 🟡UAT (project_costo_envio_factura: homologación B y C) · 🔴e2e |
| L11 | NC electrónica: ítems desde devolución + CbtesAsoc (anti 10197) + guarda nc_cae | `emitir-factura/index.ts:112-137,313-319,335-343` | 🔴 | ✅e2e 42 (CAE real) |
| L12 | Bloqueo re-emisión: factura con CAE no re-factura; NC ya emitida no re-emite | `emitir-factura/index.ts:104-105,125` | 🔴 | 🟡code-audit |
| L13 | QR fiscal RG 4291 (payload base64, tipoDocRec por largo) | `facturacionLogic.ts:buildQrAfipUrl` (226-250) | 🔴 | ✅unit (FAC-QR-01..05) |
| L14 | Homologación vs producción por-tenant + kill-switch global | `emitir-factura/index.ts:251-252` | 🔴 | 🔴gap (no se testea `afip_produccion`; por diseño NO en prod real) |
| L15 | Cert propio del tenant (bucket) vs token-only | `emitir-factura/index.ts:258-281` | 🔴 | 🔴gap e2e |
| L16 | Email de factura al cliente (fire-and-forget, no NC) | `emitir-factura/index.ts:359-389`; `FacturacionPage.tsx:178-220` | — | 🔴gap (capa C manual) |
| L17 | Estado venta despachada→facturada al obtener CAE | `emitir-factura/index.ts:353` | 🔴 | 🟡e2e 21 (implícito) |
| L18 | PDF de factura (datos fiscales, QR, MP-QR si saldo, forma de pago, domicilio) | `FacturacionPage.tsx:buildFacturaPDFDataById` (63-116); `facturasPDF.ts` | 🔴(importes) | 🔴gap (capa C: PDF/impresión) |
| L19 | Libro IVA Ventas/Compras + liquidación 12 meses + conciliación | `FacturacionPage.tsx:281-374,406-413` | 🔴(contable) | 🔴gap |
| **Ventas / POS** |
| L20 | Registrar venta (pendiente/reservada/despachada) — orquestador | `VentasPage.tsx:registrarVenta` (2332+) | 🔴 | ✅e2e 19 (despachada) · ✅e2e 26 (no-efectivo/reserva) |
| L21 | Reentrada/doble-submit guard (savingRef) | `VentasPage.tsx:2333` | 🔴(plata) | ✅unit (ventasValidation savingRef) |
| L22 | Stock mode-aware: básico surte sin ubicacion_id (`soloUbicado`) | `VentasPage.tsx:137` | 🔴(stock) | 🟡code-audit · 🔴e2e básico explícito |
| L23 | Multi-medio de pago (efectivo+vuelto, CC, crédito a favor, tarjeta) | `VentasPage.tsx:2459+`; saldo `ventasSaldo.ts` | 🔴 | ✅unit (ventasSaldo/ventasCaja) · 🟡e2e 19 (solo efectivo) |
| L24 | Efectivo↔caja (await + toast si falla; fallback única caja abierta) | `VentasPage.tsx` (cobranza/despacho); [[reference_cobranza_efectivo_exige_caja]] | 🔴(contable) | ✅unit (cobranzaCaja) · ✅e2e 19/27/28 |
| L25 | CC parcial: exige cliente con CC habilitada | `VentasPage.tsx:2406-2409` | 🔴(contable) | ✅e2e 28 (cobranza) · 🟡e2e venta CC |
| L26 | Morosidad CC (bloqueo_total/bloqueo_cc) | `VentasPage.tsx:2412-2424`; `ccLogic.ts:evaluarMorosidad` | 🔴 | ✅unit (ccLogic) · 🔴e2e |
| L27 | Límite CC enforcement (avisar/bloquear sobre el tope) | `VentasPage.tsx:2426-2435`; `ccLogic.ts:evaluarLimiteCC` | 🔴 | ✅unit · 🔴e2e |
| L28 | Crédito a favor: requiere cliente, no supera saldo disponible | `VentasPage.tsx:2438-2444` | 🔴 | 🔴gap e2e |
| L29 | Conteo wall-to-wall bloquea reserva/despacho (no presupuesto) | `VentasPage.tsx:2336-2341`; `useConteoBloqueante` | 🔴(stock) | 🟡code-audit (e2e 36 toca conteo, no este bloqueo) |
| L30 | Período cerrado bloquea | `VentasPage.tsx:142` (`useCierreContable`) | 🔴(contable) | 🔴gap e2e |
| L31 | Series obligatorias = cantidad al vender | `VentasPage.tsx:2344-2349` | 🔴(stock) | 🟡unit |
| L32 | Cantidad válida (>0, no NaN) | `VentasPage.tsx:2351-2353` | 🔴 | ✅unit (ventasCantidad) |
| L33 | Descuento por rol (CAJERO bloqueado / SUPERVISOR tope / canal tope) + override clave maestra | `VentasPage.tsx:2355-2387,4480-4515` | 🔴(plata) | 🟡unit (ventasDescuentoCombo) · 🔴e2e (override+tope) |
| L34 | Alerta margen negativo (notif si costo>total al despachar) | `VentasPage.tsx:2556-2562` | 🔴(plata) | 🟡unit · 🔴e2e |
| L35 | Trazabilidad write-time (venta_item_despachos) | `VentasPage.tsx:2719,3861` | 🔴(stock) | 🟡code-audit |
| L36 | Devolución (reintegro stock + caja + crédito/deuda CC) | `VentasPage.tsx` cambiarEstado/devolución | 🔴 | 🟡e2e 22 (reachability) · ✅DB |
| L37 | Anular venta: bloqueado si tiene CAE (solo Devolver→NC) | `VentasPage.tsx` (oculta Anular con CAE); [[project_afip_produccion]] | 🔴(fiscal) | 🟡code-audit · 🔴e2e |
| L38 | Cambiar cliente de la venta | `VentasPage.tsx` | 🔴(fiscal si facturada) | 🔴gap e2e |
| L39 | Canal de venta POS + reglas por canal (descuento/lista/devolución/requiere cliente) | `useCanalesVenta.ts:reglaDe` (68); `VentasPage.tsx:2357,2398,2126` | 🟠 | 🔴gap e2e |
| L40 | Cuotas por banco (tarjeta) + interés | `VentasPage.tsx:308-311,cuotasSeleccion` | 🔴(plata) | 🔴gap |
| L41 | Venta producto en USD → convierte a moneda local a cotización vigente | `VentasPage.tsx:1274,4523` | 🔴(plata) | 🔴gap e2e |
| L42 | Numeración venta/ticket por sucursal (set_venta_numero trigger) | `VentasPage.tsx:formatTicket` (151-168) | 🔴(fiscal) | ✅e2e 14 (coherencia números) |
| **Presupuestos / Reservas** |
| L43 | Presupuesto: crear sin tocar stock/caja → convertir con rebaje (PRES-08) | `VentasPage.tsx:registrarVenta('pendiente')` + convertir | 🔴(stock) | ✅e2e 44 |
| L44 | Presupuesto vencido bloquea convertir hasta actualizar precios | `VentasPage.tsx:isPresupuestoVencido` (56), 5669-5837 | 🔴(plata) | 🔴gap e2e (escenario negativo) |
| L45 | Reserva exige seña real (excluye CC) | `VentasPage.tsx:2446-2453,6650-6657` | 🔴(plata) | 🟡unit (cajaSeña) · 🔴e2e |
| L46 | Seña mínima % del total al reservar/convertir | `VentasPage.tsx:2448-2457,6650-6656` | 🔴 | 🟡unit · 🔴e2e |
| L47 | Cancelar reserva: penalidad % + destino (devolución/crédito) | `VentasPage.tsx:6551-6642` | 🔴(plata) | 🟡unit (cajaSeña) · 🔴e2e |
| L48 | Vencimiento de reservas (sweep) | `VentasPage.tsx:651`; cron-sweeps EF | 🔴(stock) | 🔴gap |
| **Productos / Precios** |
| L49 | Alta/edición producto + alícuota IVA (0/10,5/21/27); `Number.isFinite` no `||21` | `ProductoFormPage.tsx:384-441,960-967` | 🔴(fiscal) | ✅e2e 43 (10,5) · 🟡 resto alícuotas |
| L50 | Margen (markup sobre neto) + precio sugerido por margen objetivo | `ProductoFormPage.tsx:321-337` | 🔴(plata) | 🔴gap |
| L51 | Precio USD + cotización (toggle ARS/USD en form) | `ProductoFormPage.tsx:842-928`; `useCotizacion.ts` | 🔴(plata) | 🔴gap |
| L52 | SKU autogenerado + unicidad por tenant | `ProductoFormPage.tsx:305-315,363-373`; `skuAuto.ts` | — | ✅unit (skuAuto) |
| L53 | Tiers de precio mayorista (cantidad_minima asc) | `ProductoFormPage.tsx:457-475`; selección `VentasPage.tsx:2119-2132` | 🔴(plata) | 🔴gap e2e |
| L54 | Kits (es_kit): badge UI; **NO** hay explosión de componentes al vender (rebaja su propio stock_actual) | `VentasPage.tsx:4290`; `ProductoFormPage.tsx:405` | 🔴(stock) | 🔴gap (ojo: ¿la regla de negocio espera rebajar componentes?) |
| L55 | Variantes (grupo_id, variante_valores) | `ProductoFormPage.tsx:425-427`; `ProductoGrupoModal` | — | 🔴gap |
| L56 | Bulk: precio %/fijo (no deja $0), categoría, regla, atributos, proveedor, activar | `ProductosPage.tsx:aplicarBulk` (664-714) | 🔴(plata en precio) | 🔴gap e2e |
| L57 | Límite de productos por plan (max_productos) | `ProductosPage.tsx:1016`, `1163-1173`; `usePlanLimits.ts:60-97`; `ProductoFormPage.tsx:356-359` | 🟢 | ✅unit (planLimits) · 🔴e2e |
| L58 | Stock disponible mode-aware (básico sin estado_id) | `ProductosPage.tsx:527-558` | 🔴(stock) | 🟡code-audit |
| L59 | Eliminar/duplicar/exportar/escanear ticket/importar | `ProductoFormPage.tsx:486-557`; `ProductosPage.tsx:866-979` | — | 🔴gap |
| L60 | OC rápida desde producto (reusa/crea OC borrador por proveedor+sucursal) | `ProductosPage.tsx:716-760` | 🔴(stock) | 🔴gap |

---

## 2) Matriz de flags (`tenants`) — comportamiento CON / SIN

> Notación dónde se usa = `file:line`. Default = el `?? x` real del código (no la columna DB).
> **🟥 HALLAZGO REGLA #0:** `precio_redondeo` se configura pero **NO está cableado** a ninguna lógica de precio (ver F-PR).

### 🔴 Fiscal / Facturación (PRIORIDAD MÁXIMA)

| Flag | default | dónde se usa | CON | SIN / por valor | Cobertura |
|------|---------|--------------|-----|-----------------|-----------|
| `condicion_iva_emisor` | `''`/RI | `VentasPage.tsx:1458,7049-7050`; `FacturacionPage.tsx:578,895`; `GastosPage.tsx:163`; EF `index.ts:81` | RI → ofrece/emite A o B (A exige CUIT) | Mono/Exento → SOLO C (sin discriminar IVA); guard server rechaza A/B | ✅unit · 🟡e2e 21 · 🔴 matriz RUNTIME RI/Mono/Exento (§29) |
| `facturacion_habilitada` | `false` | `VentasPage.tsx:1455,5638`; `FacturacionPage.tsx:478,579`; `AppLayout.tsx:303` | aparece modal "Emitir comprobante" + botón habilitado + cliente obligatorio si no-CF (L20) | sin: banner "Facturación no habilitada", botón Emitir disabled, no se gatilla cliente-obligatorio-por-factura | 🟡e2e 21 (auto-skip si OFF) · 🔴 escenario SIN explícito |
| `afip_produccion` | `false` | EF `index.ts:252`; `ConfigPage.tsx:621,880` | producción real (NO testear) | homologación (CAE de prueba) | 🔴gap (por diseño no se prueba prod) |
| `umbral_factura_b` | `68305.16` | `VentasPage.tsx:1489-1492`; EF `index.ts:171,177,186`; `facturacionLogic.ts:187` | venta ≥ umbral exige DNI/CUIT (UI L9 + guard server FAC-27) | < umbral → Consumidor Final (99/0) | ✅unit (FAC-DOC-07) · 🔴e2e CON/SIN ident |
| `razon_social_fiscal` | `nombre` | `FacturacionPage.tsx:84,463`; `VentasPage.tsx:1622+` (PDFs) | sale en PDF y header | fallback a `tenant.nombre` (no rompe) | 🔴gap (capa C PDF) |
| `domicilio_fiscal` | `null` | `FacturacionPage.tsx:86`; `VentasPage.tsx:1624+`; `CajaPage.tsx:1318` | sale en PDF | omitido | 🔴gap |
| `ingresos_brutos` | `null` | `facturasPDF.ts:146`; `presupuestoPDF.ts:80`; `remitoPDF.ts:66`; `FacturacionPage.tsx:89` | "Ing. Brutos: …" en PDF | línea omitida | 🔴gap |
| `inicio_actividades` | `null` | `facturasPDF.ts:147`; `FacturacionPage.tsx:90` | "Inicio Act.: …" en PDF | omitido | 🔴gap |
| `leyenda_comprobante` | `null` | `FacturacionPage.tsx:97`; `VentasPage.tsx:1635+` | leyenda en pie del PDF | omitida | 🔴gap |
| `banco`/`cbu`/`alias_cbu` | `null` | `FacturacionPage.tsx:94-96`; `VentasPage.tsx:1634+` | datos bancarios en PDF | omitidos | 🔴gap |
| `email_legal` | `null` | `ConfigPage.tsx:693,1013` (solo guarda) | **(solo persistencia; sin uso de lectura en este grupo)** | — | 🟥 flag sin consumidor visible → confirmar dónde se usa (¿notif legales?) |

### 🟠 Ventas / Reservas / Presupuestos

| Flag | default | dónde se usa | CON | SIN / por valor | Cobertura |
|------|---------|--------------|-----|-----------------|-----------|
| `cliente_obligatorio` | `'reservas'` | `VentasPage.tsx:144,2394-2403`; `ConfigPage.tsx:699,1017` | `siempre`→toda venta exige cliente; `reservas`→presupuesto/reserva exigen | `nunca`→no exige (salvo factura no-CF / canal) | 🔴gap e2e (3 valores) |
| `cliente_consumidor_final` | `true` | `VentasPage.tsx:146,2393,2397` | permite vender como CF (sin cliente) | `false`→cliente obligatorio siempre | 🔴gap e2e |
| `cliente_creacion_inline` | `true` | `VentasPage.tsx:145` | alta de cliente desde el POS | `false`→hay que ir a Clientes | 🔴gap |
| `cliente_datos_minimos` | `'nombre'` | `VentasPage.tsx:147` | exige set de datos al crear inline | otros valores | 🔴gap |
| `presupuesto_validez_dias` | `30` | `VentasPage.tsx:1686,5379,5669-5837,6307`; `ConfigPage.tsx:565,935` | presupuesto > N días = vencido → bloquea convertir + badge "vencido" | null/0 → nunca vence | 🔴gap e2e (escenario vencido) |
| `reserva_sena_obligatoria` | `true` | `VentasPage.tsx:2446,6651`; `ConfigPage.tsx:572,940` | reservar exige seña real >0 (excluye CC) | `false`→reserva sin seña | 🟡unit · 🔴e2e |
| `reserva_sena_minima_pct` | `0` | `VentasPage.tsx:2448,6650`; `ConfigPage.tsx:574,941` | seña < N% del total → bloqueado | `0`→cualquier seña >0 vale | 🟡unit · 🔴e2e |
| `reserva_penalidad_pct` | `0` | `VentasPage.tsx:6554-6555,6622`; `ConfigPage.tsx:580,943` | cancelar reserva retiene N% de la seña | `0`→devuelve todo | 🟡unit (cajaSeña) · 🔴e2e |
| `reserva_vencimiento_dias` | `null` | `VentasPage.tsx:651`; `ConfigPage.tsx:577,942` | sweep vence reservas viejas | null→no vencen | 🔴gap |
| `moneda` | `'ARS'` | `formato.ts`; ~30 sitios (`FacturacionPage.tsx:39`, etc.) | símbolo/locale por moneda (NO convierte) | ARS default | 🟡 (visual; sin e2e dedicado) |
| `cotizacion_usd` | `0` | `useCotizacion.ts:17`; `ProductoFormPage.tsx:39`; `VentasPage.tsx:1274` | habilita toggle USD + conversión venta USD→local | `0`→"Sin cotización USD"; venta USD usa ¿? | 🔴gap e2e (REGLA #0 plata) |
| `precio_redondeo` | `'none'` | `ConfigPage.tsx:694,1014,2430` (**SOLO config**) | 🟥 **sin efecto**: no hay lógica que lo lea al calcular precios | — | 🟥 **gap funcional + cobertura** (flag muerto) |
| `cuotas_bancos` | `[]` | `VentasPage.tsx:310-311`; `ConfigPage.tsx:1690-1697` | ofrece planes de cuotas por banco c/interés en tarjeta | vacío→sin cuotas | 🔴gap e2e |
| `reglas_canal` | `{}` | `useCanalesVenta.ts:53-68`; `VentasPage.tsx:2357,2398,2126,2361` | por canal: tope descuento, lista mayorista/minorista, requiere_cliente, devolución_dias | sin reglas→sin restricción de canal | 🔴gap e2e |
| `descuento_max_cajero_pct` | `null` | `VentasPage.tsx:4487,4510` (UI badge; el bloqueo de CAJERO es total vía `descuentoBloqueadoCajero`) | marca "máx N%" / borde rojo | null→sin tope visual | 🟡unit · 🔴e2e |
| `descuento_max_supervisor_pct` | `null` | `VentasPage.tsx:2360,2366-2369,4487,4510` | SUPERVISOR > N% bloquea (override por clave maestra) | null→sin tope | 🟡unit · 🔴e2e (override) |
| `alerta_margen_negativo` | `true` | `VentasPage.tsx:2556`; `ConfigPage.tsx:568,936` | notifica si despacho con costo>total | `false`→silencioso | 🟡unit · 🔴e2e |
| `trazabilidad_asignacion` | `true` | `VentasPage.tsx:2719,3861`; `ConfigPage.tsx:539,921` | persiste `venta_item_despachos` (desglose LPN) | `false`→solo linea_id principal | 🟡code-audit · 🔴e2e |

### 🟢 Plan / Productos

| Flag | default | dónde se usa | CON | SIN | Cobertura |
|------|---------|--------------|-----|-----|-----------|
| `max_productos` | `50` | `usePlanLimits.ts:60-97`; `ProductosPage.tsx:1016,1163-1173`; `ProductoFormPage.tsx:356-359` | al tope → modal PlanLimit, botón Nuevo bloqueado | `-1`→ilimitado | ✅unit (planLimits) · 🔴e2e |

---

## 3) Gaps priorizados (orden REGLA #0: fiscal/plata/stock primero)

### 🟥 Tanda 0 — hallazgos a AVISAR a GO (REGLA #0 / flag muerto)
- **G0.1 `precio_redondeo` no tiene efecto** (F-PR): se guarda en Config y se documenta "redondear al múltiplo más cercano", pero **ninguna lógica de precio lo consume** (búsqueda global: solo `ConfigPage.tsx` + tipo + migración). El cliente cree que redondea precios y no pasa. Decisión GO: cablearlo (en `precioTierEfectivo`/cálculo de venta + sugerido) o quitarlo de Config. (REGLA #0 plata.)
- **G0.2 Kits sin explosión de componentes** (L54): vender un `es_kit` rebaja su propio `stock_actual` como producto normal; no hay BOM que rebaje componentes. Si la regla de negocio espera descontar componentes, el stock de insumos queda mal. Confirmar regla con GO antes de testear. (REGLA #0 stock.)
- **G0.3 `email_legal`** sin consumidor de lectura en este grupo: confirmar para qué se usa (¿avisos legales/baja?) o es flag huérfano.
- **G0.4 ImpTotal vs descuento global** (L7): el `console.warn` de la EF (`index.ts:236-238`) NO bloquea cuando un descuento/recargo global no está prorrateado en los ítems → el comprobante puede emitirse con total ≠ suma de ítems. Validar que el front siempre prorratea (o agregar guard).

### Tanda A — REGLA #0 sin e2e (plata/stock/fiscal)
1. **§29 matriz fiscal RUNTIME** `condicion_iva_emisor` ∈ {RI, Mono, Exento} × emitir CAE real (A/B/C) + verificar `tipo_comprobante`, ImpIVA, array Iva en DB (homologación). Cubre L01/L02/L03/L06.
2. **FAC-27 CON/SIN** (L9): Factura B con `venta.total` ≥ `umbral_factura_b` — sin DNI/CUIT bloquea (UI y EF 400); con DNI emite DocTipo 96. Llamar también la EF directa para el guard server.
3. **Guard emisor↔letra server** (L3): POST directo a `emitir-factura` con RI+C y Mono+A → 400 con mensaje.
4. **Límite CC + enforcement** (L27): venta CC sobre `limite_cc_default`/`limite_credito` con `cc_enforcement_politica` avisar vs bloquear (verificar deuda en DB).
5. **Morosidad CC** (L26): `cc_morosidad_politica` bloqueo_cc vs bloqueo_total con deuda vencida.
6. **Descuento máx por rol + override clave maestra** (L33): SUPERVISOR > `descuento_max_supervisor_pct` bloquea; con clave maestra autoriza y deja traza (`logVentaAuditoria` override_descuento).
7. **Crédito a favor** (L28): aplicar crédito > disponible bloquea; aplicar válido descuenta `cliente_creditos`.
8. **Venta producto USD** (L41): con `cotizacion_usd` > 0 convierte; con 0, comportamiento (verificar precio final en venta_items).
9. **Tiers mayoristas** (L53): cantidad ≥ `cantidad_minima` aplica precio tier; `reglas_canal.lista_precio` fuerza minorista/mayorista.
10. **Kit** (post-G0.2): según regla confirmada — rebaje de componentes o del propio stock.

### Tanda B — flags de Ventas/Reservas/Productos
11. **Presupuesto vencido** (L44/`presupuesto_validez_dias`): convertir un presupuesto > N días bloqueado hasta actualizar precios (escenario negativo + fix del selector de caja con 2+ cajas — gotcha conocido).
12. **Reservas** (L45-L47): `reserva_sena_obligatoria` CON/SIN; `reserva_sena_minima_pct` por debajo bloquea; `reserva_penalidad_pct` retiene al cancelar (verificar caja/crédito en DB).
13. **`cliente_obligatorio`** (L20) los 3 valores × `cliente_consumidor_final` true/false.
14. **`reglas_canal`** (L39): canal con tope descuento / requiere_cliente / lista mayorista.
15. **`cuotas_bancos`** (L40): selección de cuotas con interés refleja total/medio_pago.
16. **`max_productos`** (L57): al tope, alta bloqueada (modal); `-1` ilimitado.
17. **Alícuotas restantes** en alta (L49): 0/21/27 además del 10,5 ya cubierto (e2e 43).

### Tanda C — capa manual (no e2e)
- PDFs/impresión: factura/NC/remito/presupuesto con `razon_social_fiscal`/`domicilio_fiscal`/`ingresos_brutos`/`inicio_actividades`/`leyenda_comprobante`/`banco`/`cbu`/`alias_cbu` (L18) + QR fiscal + MP-QR si saldo.
- Email de factura (L16), Libros IVA + liquidación (L19), `afip_produccion` (L14), cert propio (L15).

---

## 4) Notas de coherencia con el espejo EF ↔ lib
`facturacionLogic.ts` es el espejo testeable de `emitir-factura/index.ts`. Verificado idénticos en: mapeos `TIPO_CBTE`/`IVA_RECEPTOR_ID`/`ALICUOTA_ID`, normalización numeric (L05), desglose IVA (L04), receptor (L08), C sin IVA (L06). El **único guard que vive solo en la EF** (no en la lib): emisor↔letra (L03), FAC-27 server (L9), costo de envío (L10), CbtesAsoc NC (L11). Mantener sincronía al tocar cualquiera.
