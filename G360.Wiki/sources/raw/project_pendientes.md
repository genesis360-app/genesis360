---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.11.2** ✅ (Trazabilidad-extendida /historial grado WMS [mig 155] + aislamiento por sucursal: guard setSucursal + rótulo "Stock total todas las sucursales") · DEV alineado con PROD

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV / PROD — cierre sesión 2026-05-30

| | DEV | PROD |
|---|---|---|
| APP_VERSION | `v1.11.3` (cierre trazabilidad, sin deployar) | `v1.11.2` |
| Migrations | 001–**155** ✅ | 001–**155** ✅ |
| Branch | `dev` **adelante de** `main` (v1.11.3 sin deployar) | `main` (release v1.11.2) |
| Vercel | preview auto desde `dev` | PROD deploy v1.11.2 |

**Migrations DEV pendientes de aplicar en PROD:** ninguna (v1.11.3 es solo código, usa columnas de mig 155 ya en PROD).

**🔜 En DEV pendiente de deploy a PROD (v1.11.3):** cierre de Trazabilidad-extendida — devoluciones en `/historial` + reserva→despacho/devuelta clasificadas + filtro recall por producto. Solo código.

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
| ISS-127 | Config + Inventario | Perfiles de códigos de barra/QR compuestos: configurar campos (SKU, Lote, Vencimiento, Cantidad, etc.) y leer/escribir ese código en ingreso y rebaje de stock | Alta — nuevo subsistema |
| ISS-130 | Inventario + Ventas | Comandos por voz: hablarle a la app para rebajar/ingresar (SKU, cantidad, estado, ubicación, lote, fecha) y consultar ("¿qué hay en ubicación X?"). Web Speech API + parseo intenciones | Alta — UX nueva, requiere prototipo |
| ISS-137 | Config | Evaluación: integración con Google Drive como almacenamiento propio del cliente para documentos/imágenes | Requiere evaluación primero |
| ISS-174 | Ventas + Envíos | Servicio de envío como select (igual que en módulo Envíos) + cotización automática por API de cada courier (precio + disponibilidad según servicio, dirección y fecha) | Alta — depende APIs externas |

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

**Limitación conocida pendiente:** la transición **reserva → despacho** (`cambiarEstado`) (a) no persiste la selección manual de LPN (venta_items solo guarda `linea_id` principal) y (b) **también** actualiza `stock_actual` manualmente (mismo anti-patrón vs trigger — revisar y migrar al patrón de Fase 3). Afecta solo a reservas, no a venta directa.

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
