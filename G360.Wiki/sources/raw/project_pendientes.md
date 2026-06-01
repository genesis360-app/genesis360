---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.14.0** ✅ (ISS-174 — cotización/generación de envíos por API de courier: Andreani/Correo/OCA · mig 162-165 · Edge Function `courier-api`; adapters pendientes de validar con cuentas B2B reales) · DEV alineado con PROD

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV / PROD — cierre sesión 2026-05-31

| | DEV | PROD |
|---|---|---|
| APP_VERSION | `v1.14.0` | `v1.14.0` |
| Migrations | 001–**165** ✅ | 001–**165** ✅ |
| Branch | `dev` (alineado con `main`) | `main` (release v1.14.0) |
| Vercel | preview auto desde `dev` | PROD deploy v1.14.0 |

**Migrations DEV pendientes de aplicar en PROD:** ninguna.

**ISS-174 — cotización/generación de envíos por API (v1.14.0, PROD):**
- **F1 (fundación)** — servicio = select dependiente en POS; catálogo `src/lib/couriers/catalogo.ts`; mig 162 (`courier_credenciales` + `tenants.envio_peso_fuente`), 163 (CP idempotente), 164 (productos peso/dim); Config → Envíos (toggle peso-fuente + `CourierCredencialesPanel` owner-only); peso/dim en form de producto.
- **F2-F5 (integración API)** — Edge Function `courier-api` (cotizar/generar/tracking) con adapters **Andreani / Correo Argentino / OCA**; mig 165 (`envios.cotizacion_json/courier_orden_id/cotizado_api`); cliente `src/lib/couriers/api.ts`; cotizar en POS + Envíos, "Generar con courier" + etiqueta + "Actualizar tracking" en Envíos.
- **⚠ PENDIENTE crítico:** los adapters están escritos según docs públicas de cada courier pero **NO probados con cuentas B2B reales** (GO aún no las tiene). Al cargar credenciales reales, validar/ajustar endpoints y mapeos de cada adapter (`supabase/functions/courier-api/{andreani,correo,oca}.ts`). Fail-safe: sin credenciales la cotización muestra error claro y el alta manual sigue funcionando.

**En DEV sin deployar (relevamiento Ventas E/F/G — 2026-05-31):**
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

### Features grandes (requieren relevamiento o diseño antes de implementar)

| ID | Módulo | Descripción | Complejidad |
|---|---|---|---|
| ISS-073 | TiendaNube + Ventas + Envíos + Clientes | Sincronización completa de flujo TN: la orden TN crea automáticamente venta Genesis (con `numero` = número TN para trazabilidad) + cliente nuevo con datos y domicilio si no existe + envío en estado `pendiente` con datos del comprador. Estados sincronizados bidireccional: pendiente_pago → pagada → empaquetada → despachada → entregada / devuelta. Hoy: solo rebaja stock. | Alta — webhook + estado-machine + creación multi-entidad transaccional |
| ~~ISS-127~~ | Config + Inventario + Ventas + Recepciones | ✅ **Cerrado v1.11.6** — Códigos compuestos GS1 (GS1-128 + DataMatrix + QR) leer/escribir con múltiples AIs. Ver `escaneo-barcode.md` y diseño/fases abajo. | ✅ Hecho |
| ISS-130 | Inventario + Ventas | Comandos por voz: hablarle a la app para rebajar/ingresar (SKU, cantidad, estado, ubicación, lote, fecha) y consultar ("¿qué hay en ubicación X?"). Web Speech API + parseo intenciones | Alta — UX nueva, requiere prototipo |
| ISS-137 | Config | Evaluación: integración con Google Drive como almacenamiento propio del cliente para documentos/imágenes | Requiere evaluación primero |
| ~~ISS-174~~ | Ventas + Envíos | ✅ **Cerrado v1.14.0** (F1-F5) — servicio select en POS + cotización/generación por API directa (Andreani/Correo/OCA) vía Edge Function `courier-api`. Ver sección ISS-174 abajo. **Único pendiente:** validar adapters con cuentas B2B reales. | ✅ Hecho |

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

### Bugs / mejoras UX puntuales

| ID | Módulo | Descripción | Estado |
|---|---|---|---|
| ISS-075 | Historial | Trazabilidad de despacho y movimientos. **✅ v1.11.0 (mig 153+154)**: (1) tabla `venta_item_despachos` con desglose por LPN/ubicación/serie de cada ítem vendido + campo `origen` (`manual`/`auto`); (2) detalle de venta (VentasPage), detalle de movimiento (MovimientosPage) y **/historial** (HistorialPage) muestran el desglose completo por LPN; (3) ingreso/rebaje manual se vuelcan al `actividad_log` (`ingreso_stock`/`rebaje_stock`); (4) traslado con ubicación origen→destino; (5) toggle `tenants.trazabilidad_asignacion` en Config → Inventario. **Pendiente futuro**: consolidar aún más el /historial (ver nota Trazabilidad-extendida abajo) | ✅ v1.11.0 |
| ISS-080 | Alertas | Filtrar por sucursal todas las queries de AlertasPage | ✅ Resuelto 2026-05-28 — cruce client-side con `inventario_lineas`+`PSMSS` para stock; cruce con `inventario_lineas` para productos sin categoría |
| ISS-108 | Header / Mobile | Selector de sucursal invisible en celular | ✅ Resuelto 2026-05-28 — bloque mobile con ícono Building2 + nombre + `<select>` transparente superpuesto |
| ISS-148 | Recursos | Input texto libre para ubicación | ✅ Resuelto 2026-05-28 — componente `UbicacionPicker` (select con opciones del histórico de la sucursal + opción "+ Nueva ubicación") en form crear/editar, modal asignar y edit inline |
| ISS-151 | Dashboard + CC | Dashboard sumaba "Cancelación CC" como método de pago → distorsionaba la ganancia. **🔄 Implementado en DEV:** (1) `MixCajaChart` + `MetricasPage` excluyen pseudo-métodos (`Cuenta Corriente`, `Cancelación CC`, `Condonación CC`); (2) `ClientesPage` reemplaza el botón único por **Condonar** (write-off, tag `Condonación CC`) y **Revertir** (restaura la deuda), ambos solo DUEÑO/SUPERVISOR/ADMIN; las condonadas quedan visibles con badge para poder revertir. Ambas acciones mantienen la venta **despachada** (no tocan stock ni estado de entrega — P4). Sin migración. Ver modelo abajo. | 🔄 DEV |

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
| Relevamientos | 5 HTMLs generados (Ventas / RRHH / Clientes / Compras / Envíos) esperando respuestas de GO + socio. Ventas A-D ya respondido (ver `relevamiento_ventas_respuestas.md`), faltan E-L |

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
