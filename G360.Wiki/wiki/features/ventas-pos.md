---
title: Ventas / POS
category: features
tags: [ventas, pos, checkout, carrito, pagos, reservas, combos, cuenta-corriente, envios, multi-sucursal]
sources: [CLAUDE.md, reglas_negocio.md]
updated: 2026-05-23
---

# Ventas / POS

POS completo integrado con inventario, caja, clientes y facturación AFIP.

**Página:** `src/pages/VentasPage.tsx`  
**Acceso:** OWNER · SUPERVISOR · CAJERO · ADMIN

---

## Estados de una venta

| Estado | Cliente | Pago | Stock |
|--------|---------|------|-------|
| `pendiente` | ✅ obligatorio | No requerido | No reservado |
| `reservada` | ✅ obligatorio | Parcial o total | Reservado |
| `despachada` (= "Finalizada" en UI) | ❌ opcional | 100% cubierto | Descontado |
| `cancelada` | — | — | Liberado |
| `devuelta` | — | — | Reingresado |

> [!NOTE] El valor en DB sigue siendo `'despachada'`. En la UI se muestra como "Finalizada" desde v0.61.0.

---

## 3 modos de venta

Toggle en el checkout:
1. **Reservar** — reserva stock, puede pago parcial, requiere cliente
2. **Venta directa** — despacha inmediatamente, pago total obligatorio
3. **Presupuesto** (antes "Sin pago ahora") — sin cobro, sin reserva de stock, sin ticket

---

## Flujo completo

1. Buscar producto por nombre, SKU, barcode o escaneo
2. Agregar al carrito (suma cantidad si mismo producto ya existe sin series)
3. Descuentos por ítem (%) o global ($ o %)
4. Seleccionar cliente (obligatorio para pendiente/reservada)
5. Seleccionar modo + medios de pago
6. Confirmar → trigger descuenta stock automáticamente

---

## Carrito — funcionalidades

### Multi-LPN en carrito
- `CartItem` incluye `lineas_disponibles[]` + `lpn_fuentes[]`
- Al agregar: pre-fetch de TODAS las líneas disponibles (`cantidad - cantidad_reservada > 0`)
- Al cambiar cantidad: recomputa fuentes client-side sin re-fetch
- Badges máx 3 LPNs + "+N más" en el carrito
- Función pura: `calcularLpnFuentes(lineas, cantidad)`
- **Picker manual "Elegir posición de rebaje"** (`lpnPickerIdx`/`overrideLpnSource`): cuando un producto tiene más de una línea de stock candidata, el cajero puede abrir el picker y elegir cuál — **gobierna la línea real que se descuenta al confirmar** (el commit de checkout sigue el plan `item.lpn_fuentes`/`lpn_manual_ids` del carrito ANTES de caer a FIFO/FEFO automático, no es cosmético). ✅ **PROD desde v1.134.0 (2026-07-18):** el picker y los badges del carrito ahora también muestran talle/color/encaje/formato/sabor_aroma (extensión de `calcularLpnFuentes`/`LineaDisponible`/`LpnFuente`) — y si hay más de un valor distinto en stock y el cajero no pasó por el picker, `registrarVenta()` **bloquea el cobro** (mismo patrón que `tiene_series`, función `atributoAmbiguoEnStock`) en vez de dejar que FIFO ciego entregue el valor equivocado — ver [[wiki/features/atributos-variante]].

### ISS-075 — Trazabilidad de despacho por LPN (mig 153)

`venta_items.linea_id` guarda solo el **LPN principal**. Cuando un ítem se despacha desde varios LPN/ubicaciones, el **desglose completo** se persiste en la tabla `venta_item_despachos` (una fila por porción/línea consumida, o por serie en items serializados).

- **Captura**: dentro del rebaje real de `registrarVenta` (Fase 2) y de la transición **reserva → despachada** (`cambiarEstado`). Solo se persiste para ventas `despachada` (la reserva aún no despacha). Insert fire-and-forget — si falla no rompe la venta.
- **Snapshot**: `lpn`, `ubicacion_nombre` y `nro_serie` se guardan como texto; si después se edita/borra el LPN, la traza queda intacta. **Desde la mig 277** (2026-07-18, 🟡 en el working tree de `dev`, sin commitear, sin deploy a PROD todavía) también snapshotea `talle/color/encaje/formato/sabor_aroma` — antes el atributo de variante consumido solo era visible en el carrito antes de confirmar, no en el historial post-venta. Sin backfill (no se puede reconstruir el talle de despachos históricos). Ver [[wiki/features/atributos-variante]] "Ronda 4".
- **Vista**: el modal de detalle de venta lee `venta_item_despachos` (query `venta-despachos`) y muestra por ítem el desglose (`Nu · LPN X · Ubicación` o `#serie · Ubicación`) + los badges de atributo de variante (`atributosDeLinea()`) cuando aplica. Fallback al LPN único (`inventario_lineas.lpn`) si no hay filas de despacho (ventas previas a la mig 153).

### Cantidades decimales
- `UNIDADES_DECIMALES`: kg, g, gr, mg, l, lt, ml, m, m2, m3, cm, mm, km (case-insensitive)
- Input: `step` y `min` dinámicos. Para no-decimales bloquea `.` y `,`
- Permite escribir "1.5" o "1,5" sin que React resetee durante edición

### Carrito draft (localStorage)
- Se guarda en cada cambio: `carrito_draft_{tenantId}`
- Se restaura al entrar (toast de aviso)
- Se limpia al finalizar la venta
- No guarda `lineas_disponibles` ni `series_disponibles` (datos grandes y posiblemente stale)

### Scanner en carrito
- Cola secuencial: `scanQueueRef` + `scanProcessingRef` procesa de a uno
- Mismo producto sin series → suma cantidad, no crea nueva línea
- `pendingAddRef` previene duplicados por concurrencia

---

## Medios de pago

```typescript
// Almacenados como JSON string en DB
ventas.medio_pago = '[{"tipo":"Efectivo","monto":1500},{"tipo":"Tarjeta","monto":500}]'
```

Disponibles (configurables en ConfigPage → Métodos de pago, migration 045):
- Efectivo (con vuelto al cliente si excede total)
- Tarjeta / Transferencia / Cheque / Mercado Pago QR / Cuenta corriente

### Vuelto
- Efectivo > total → muestra "Vuelto $X" en checkout y ticket
- La caja registra solo el neto (entregado − vuelto)
- `monto_pagado` tope en `total`

### QR Mercado Pago
- EF `mp-crear-link-pago`: crea preference con `external_reference = venta.id`
- `preVentaId` UUID pre-generado para ventas directas
- Polling cada 4s → pantalla "¡Pago recibido!" → botón Finalizar
- Toast global en AppLayout cada 30s cuando llega pago MP

---

## Pago parcial en reservas

- Una reserva puede registrarse con pago parcial o total
- El pago entra a caja inmediatamente: `ingreso_reserva`
- Al despachar con saldo > $0.50 → modal muestra Total / Ya cobrado / Saldo a cobrar
- `monto_pagado` se acumula con `acumularMediosPago()`
- `validarDespacho()` bloquea en UI y en `mutationFn`
- **v1.10.2**: `monto_pagado` al crear reserva con seña parcial se calcula desde la suma real de los medios no-CC ingresados (no desde `total − CC`). Corregía "Ya cobrado" cuando solo se cobró una seña parcial.

---

## Combos automáticos

- `useEffect` detecta cuando cantidad alcanza el umbral del combo → aplica automáticamente
- Toast informativo al aplicar
- Al bajar cantidad del umbral → quita el descuento
- Sugerencia cuando falta 1 unidad para alcanzar umbral
- Soporta `descuento_tipo`: pct / monto_ars / monto_usd (conversión via `useCotizacion`)

---

## Reservas — operaciones especiales

### Modificar reserva
1. Cancela la reserva actual
2. Registra motivo en `notas` (`"Cancelada por modificación — fecha — usuario"`)
3. Pre-puebla el carrito con productos + cliente + medios originales para recrear

### Editar monto cobrado
- Input inline en modal de reservada → actualiza `monto_pagado` directo en DB

### Badge saldo en historial
- Chip naranja "Saldo $X" en reservas con pago parcial pendiente

### Seña obligatoria + mínima (E6 · mig 160)
- `tenants.reserva_sena_obligatoria` (default ON): **sin seña no se puede reservar**. Validado en `registrarVenta` y en el saldoModal de conversión a reserva.
- `tenants.reserva_sena_minima_pct`: seña mínima como % del total (0 = cualquier seña > 0). La seña cuenta dinero real (excluye CC).
- Config: ConfigPage → Ventas → Operativa → **Reservas**.

### Vencimiento + liberación automática (E1 · mig 160)
- `tenants.reserva_vencimiento_dias` (NULL = sin vencimiento, default). `ventas.reservado_at` fija la referencia al pasar a `reservada`.
- Función `liberar_reservas_vencidas(tenant)` (SECURITY DEFINER): libera el stock reservado (series `reservado=false` / `cantidad_reservada` decrementado) y marca la reserva `cancelada` con nota. **No toca dinero** (la seña se resuelve manual). Cada reserva es atómica y saltea las de período contable cerrado.
- Disparo: **sweep lazy** al entrar a Ventas (RPC una vez por montaje si el tenant tiene vencimiento configurado). pg_cron no está habilitado.

### Cancelación con penalidad + crédito (E2 · mig 160)
- Cancelar una reserva **con seña** requiere DUEÑO/SUPERVISOR/ADMIN (gate E4). Abre modal con:
  - **Penalidad** `tenants.reserva_penalidad_pct`: se retiene ese % de la seña (no se devuelve).
  - **Destino** del monto a devolver: *devolución* (egreso en caja, escala efectivo/no-cash) o *crédito a favor* del cliente (tabla `cliente_creditos`, requiere cliente asignado).
- `cliente_creditos`: ledger, saldo a favor = `SUM(monto)` (`monto>0` crédito, `monto<0` consumo).
- **Redención** (gastar el crédito): medio de pago **"Crédito a favor"** en el POS, visible cuando el cliente seleccionado tiene saldo > 0. Cuenta como **pagado** (cubre el total, suma a `monto_pagado`) pero **NO entra a caja** (es dinero prepago) y no genera `ingreso_informativo`. Al confirmar la venta inserta el consumo negativo. Validación: no puede superar el saldo disponible.
- **Auto-sugerencia (v1.98.0):** al seleccionar en una venta que cobra (despacho/reserva, NO presupuesto) un cliente con saldo a favor, el medio "🎁 Crédito a favor" **se auto-aplica** por `min(saldo, total)` + toast 🎁 (una vez por cliente). Si gasta menos, el resto queda a favor; si gasta más, el faltante se pide por otro medio. **No pisa al usuario:** solo actúa si los medios están vírgenes o si la única línea es la que auto-aplicó (re-clampa al cambiar el total via `creditoAutoRef`); si ya hay pagos manuales, no interviene. Lógica del monto: `montoSugeridoCredito()` en `src/lib/saldoFavor.ts`. **🛑 REGLA #0:** la sugerencia nunca supera el saldo (respeta el guard server-aware) ni el total (sin vuelto falso); el consumo está gateado por `estado !== 'pendiente'` (un presupuesto no consume crédito).
- **Visibilidad**: badge "🎁 Saldo a favor $X" en la ficha del cliente (`ClientesPage`).

---

## Numeración de presupuestos (F5 · mig 159)

- Los presupuestos (estado `pendiente`) tienen **correlativo propio independiente** de las ventas: `ventas.presupuesto_numero` (por tenant) + `presupuesto_numero_sucursal` (por sucursal). Asignado por el trigger `gen_venta_numero` solo si la venta nace como presupuesto; se conserva al convertir.
- `formatTicket` muestra **`PRES-{codigo_sucursal}-NNNN`** (o `PRES-NNNN` sin código de sucursal). Las ventas reales mantienen su formato.

## Actualizar presupuesto on-demand (F1)

- En el detalle de un presupuesto **no vencido** hay un botón "Actualizar presupuesto (precios + validez)" que recrea con precios actuales y **resetea el contador de validez** (vía `updated_at`, base de `isPresupuestoVencido`). La validez sigue siendo `tenants.presupuesto_validez_dias` (config existente).

## Facturas recurrentes (plantillas · mig 213)

- Origen: paridad Xubio (Comprobantes 2.0). **Plantillas de venta que se repiten**: desde el detalle de una venta, "Convertir en recurrente" guarda un snapshot de los ítems + frecuencia (semanal a anual) + cliente en `ventas_recurrentes`. Helpers puros en `src/lib/ventasRecurrentes.ts`.
- El botón **"Recurrentes"** de la toolbar abre el panel de plantillas, con badge de vencidas (`proximo_at <= hoy`). **Desde v1.116.0 el botón solo aparece si el tenant tiene al menos una plantilla** (toolbar limpia para quien no usa la feature; el punto de entrada es "Convertir en recurrente").
- "Generar" crea un **PRESUPUESTO** (`pendiente`) y corre `proximo_at` al ciclo siguiente. Generación 100% manual (sin cron); **nunca toca stock/caja/AFIP** por sí sola — el presupuesto se revisa, finaliza y factura como cualquier venta.

## Precios mayoristas por cantidad (G1/G2)

- Cada producto puede tener **tiers** en `producto_precios_mayorista` (`cantidad_minima` + `precio` + etiqueta), editables en el form de producto (accordion "Precios mayoristas", solo `canEdit`).
- El POS los aplica **automáticamente por la cantidad de cada línea**: `precioTierEfectivo(item)` toma el tier de mayor `cantidad_minima` que la cantidad satisfaga; si ninguno aplica, usa el precio minorista. **No** es por cliente ni por monto total — es por unidades del producto (confirmado GO 2026-05-31).
- El precio efectivo entra en `getItemSubtotal` y se persiste en `venta_items.precio_unitario`. En el carrito se muestra el indicador "🏷 Precio mayorista: $X/u" con el minorista tachado.

## Motivo de cancelación de reserva (E3)

- Toda cancelación de reserva pasa por el modal con un **catálogo cerrado** de motivos (`Cliente arrepentido` / `Producto roto` / `Stock perdido` / `Otro`) + **observación libre opcional**. El motivo es obligatorio para confirmar.
- Se registra en `ventas.notas` como `[Cancelación: {motivo} — {obs}]`.

## Descuentos por rol (G3)

- **Solo DUEÑO / SUPERVISOR / ADMIN** pueden aplicar descuentos (por ítem o global). El resto de roles (CAJERO, DEPÓSITO, etc.) los tiene bloqueados: `ROLES_DESCUENTO` controla `descuentoBloqueadoCajero` (inputs deshabilitados) + validación dura en `registrarVenta` (ítem y global).
- **SUPERVISOR** está limitado por `tenants.descuento_max_supervisor_pct` (aplica a descuento de ítem y al global); **DUEÑO/ADMIN** sin tope.
- Config en Config → Ventas → Descuentos (el campo "máx CAJERO" fue reemplazado por una nota: el cajero no aplica descuentos).
- Sin edición libre de precio (solo % de descuento) — comportamiento previo mantenido.

## Precio en USD (G5 · mig 161)

- `productos.precio_usd` + `productos.moneda_venta` (`'local'` default | `'usd'`). Se configura en el form de producto (select de moneda + input USD + preview de conversión).
- Si `moneda_venta='usd'`, el POS **convierte a moneda local a la cotización vigente** al cargar el producto al carrito (`precio_unitario` queda fijado al cambio del momento; `precio_usd_origen` guarda el dólar original para el hint "Precio USD X · convertido a $Y").
- Cubre el caso "producto cotizado en dólares, cobrado en pesos al cambio del día". **Venta física en USD / caja USD: fase futura.**

## Visibilidad de costo/margen (G4)

- `src/lib/permisosCosto.ts` → `puedeVerCosto(rol)`: **CAJERO y DEPOSITO no ven precio de costo ni margen**. Aplica en `ProductosPage` (cards, panel expandido, botón Orden de Compra) y `ProductoFormPage` (precio de costo, margen actual, margen objetivo, precio sugerido). Visible para DUEÑO/SUPERVISOR/ADMIN/CONTADOR/SUPER_USUARIO.

---

## Cuenta corriente (v1.4.0 · migration 083 · fix ISS-090 v1.8.38)

"Cuenta Corriente" es un medio de pago más dentro del array `mediosPago[]`, combinable con efectivo, MP, etc.

### Modelo de datos
- `es_cuenta_corriente: true` → venta aparece en tab CC de ClientesPage
- `monto_pagado` = monto cubierto por medios NO-CC (lo que va a caja)
- Deuda del cliente = `total - monto_pagado`

### Comportamiento (v1.8.38)
- Opción "💳 Cuenta Corriente" visible en el select de medios solo si el cliente tiene CC habilitada
- `modoCC = montoCC > 0` (derivado, no toggle)
- Al confirmar con CC: siempre despacha (`estado = 'despachada'`) → la deuda queda visible en ClientesPage
- Validación correcta: filtra CC del array, valida el resto contra `totalConEnvio - montoCC`
- Full CC (100% CC): skipea validación de otros medios (no requiere caja abierta)

### Fix ISS-090 (bug histórico)
- Anterior: usaba `.map()` que generaba un array incorrecto → full CC fallaba con "Ingresá un método de pago"; CC + tarjeta/MP fallaba con "El monto excede el total"; solo CC + efectivo funcionaba por accidente
- Corregido 2026-05-20: `.filter()` + `totalSinCC = total - montoCC`

---

## Registro inline de cliente

Mini-form desde el checkout: nombre + DNI + teléfono (todos obligatorios).
Búsqueda por nombre o DNI. `validarDNI()` + `validarTelefono()` al blur.

---

## Tab Canales (v0.94+)

KPIs por canal (POS / MELI / TN / MP) + listado filtrable.
Filtros: búsqueda libre, estado, rango de fechas.

---

## Historial de ventas

- Paginado: empieza en limit 50, botón "Cargar más" (+50)
- Filtro por categoría: client-side, lazy (solo cuando `tab === 'historial'`)
- Apertura por URL: `/ventas?id=XXX` abre el modal de esa venta directamente

---

## Integración con caja

- Sin caja abierta → no se puede despachar ni reservar (bloqueo con banner rojo)
- Solo efectivo afecta saldo de caja
- `refetchOnMount: true` en sesiones para detectar caja abierta al navegar

---

## Integración con facturación AFIP

Si `facturacion_habilitada=true` y CUIT configurado → modal "¿Emitir comprobante?" post-despacho.
Auto-detecta tipo A/B/C. Ver [[wiki/features/facturacion-afip]].

---

## Devoluciones

Botón "Devolver" en modal de venta despachada/facturada. Ver [[wiki/features/devoluciones]].

---

## Validaciones (funciones puras en `ventasValidation.ts`)

```typescript
validarMediosPago(medios)           // al menos 1 con tipo y monto > 0
validarDespacho(carrito, medios)    // cubre el total
calcularSaldoPendiente(venta)       // total - monto_pagado
validarSaldoMediosPago(saldo, medios)
acumularMediosPago(anterior, nuevo)
calcularVuelto(medios, total)
calcularEfectivoCaja(medios, total)
calcularComboRows(carrito)
restaurarMediosPago(json)
esDecimal(unidadMedida)
parseCantidad(str)
calcularLpnFuentes(lineas, cant)
```

> [!NOTE] `pendiente`: no requiere medio ni cliente. `reservada`: requiere cliente, permite pago parcial. `despachada` directo: requiere medios que cubran el total.

---

## Reglas de negocio confirmadas (fuente: reglas_negocio.md)

- Una venta = un cliente únicamente
- Las ventas pendientes no vencen automáticamente (aparecen en Alertas)
- Presupuesto vencido: badge "Vencido" + botón "Actualizar precios ahora" (v1.4.0)
- Cierre de caja registra efectivo original de seña + efectivo del saldo al despachar

---

## Cuenta de origen en movimientos informativos (v1.9.1)

Cada venta con medio de pago ≠ Efectivo inserta `caja_movimientos` con tipo `ingreso_informativo` y `cuenta_origen_id` derivado del default del método de pago (configurado en `metodos_pago.cuenta_origen_id`). Esto alimenta la vista `vw_boveda_cuentas` para que el DUEÑO vea TODO el capital del negocio discriminado por cuenta bancaria/billetera en el tab Bóveda. Ver [[wiki/features/caja]] sección "Bóveda como billetera del negocio".

Aplica en 5 puntos de `VentasPage.tsx`:
- Despacho con métodos no-efectivo
- Seña reservada (creación)
- Seña reservada (en `updateVentaEstado`)
- Despacho desde reservada (con `noCashMap` por tipo)
- Devolución de seña al cancelar reserva

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/devoluciones]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/escaneo-barcode]]
- [[wiki/development/testing]]

---

## Mejoras v1.8.21–v1.8.22

### ISS-081 — Decimales en totales
- `total` redondeado a 2 decimales con `Math.round(...*100)/100`
- Display del total y faltante con `maximumFractionDigits: 2`
- Fix `esVuelto = vueltoUI >= 0.5` (antes `>` causaba "Excede por $1")

### ISS-082 — "Falta asignar" estático al tipear
- `committedAsignado`: estado que se actualiza solo en `onBlur` o Enter del input de monto
- La UI de "Falta asignar / Vuelto / Excede" no parpadea mientras se escribe

### ISS-090 — CC como método de pago parcial
- "Cuenta Corriente" es ahora una opción en el select de medios de pago (requiere cliente con CC habilitada)
- Pago mixto: ej. $500 Efectivo + $300 CC → `monto_pagado = $500`, deuda CC = $300
- Elimina el toggle "Despachar a cuenta corriente" (era todo-o-nada)
- `modoCC` derivado de `mediosPago` (no estado)
- CC excluida de movimientos en caja y del `ingreso_informativo`

### ISS-091 — Badge stock insuficiente en carrito
- Cuando `item.cantidad > stock disponible en lineas_disponibles`, aparece badge rojo "Stock insuf. (X disp.)"

### ISS-092 — Recuperación de carrito restaura CC
- El draft guardado en localStorage incluye `mediosPago` (con CC si estaba activo)
- Al restaurar: consulta DB para `clienteCCEnabled` del cliente recuperado
- El botón CC aparece correctamente al volver al módulo

### ISS-093 — Tag CC en historial
- Badge verde "CC" en historial cuando `venta.es_cuenta_corriente = true`

### ISS-103 — Canal de venta en POS
- Selector de canal antes del botón "Venta directa": Presencial (default), Instagram, Facebook, WhatsApp, Otros
- Guarda en `ventas.origen`
- Se resetea a "POS" al completar la venta

### ISS-110 — Canales de venta en constraint DB (v1.8.32 · migration 122)
- La constraint `ventas_origen_check` fue extendida para incluir: `Instagram`, `Facebook`, `WhatsApp`, `Otros`
- Antes solo aceptaba: `POS`, `MELI`, `TiendaNube`, `Shopify`, `WooCommerce`, `MP`
- Fix: creaba ventas en esos canales pero fallaba al guardar en DB

### Descuento máximo por rol en POS (v1.8.34 · actualizado C3 2026-05-29)
- En **Configuración → Ventas → Descuentos**: campo `descuento_max_cajero_pct` y `descuento_max_supervisor_pct`
- Al completar una venta en el POS:
  - Si el rol tiene límite configurado y un ítem supera ese %, el campo se marca en rojo con "máx X%"
  - Al intentar confirmar: bloquea con toast "Descuento del X% supera el límite permitido"
- El DUEÑO nunca tiene límite

**C3 (relevamiento Ventas A-D, 2026-05-29) — CAJERO bloqueado**: los inputs de descuento por ítem y descuento general aparecen `disabled` para `user.rol === 'CAJERO'` (constante `descuentoBloqueadoCajero` en `VentasPage.tsx`). Labels y placeholders se mantienen pero con opacity-60 y badge "Bloqueado / bloqueado para CAJERO". Si necesita aplicar un descuento, lo hace un SUPERVISOR/DUEÑO. Pendiente del mismo C3: descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR (feature mayor, no en este lote).

### ISS-085 — Número de ticket por sucursal (migration 108)
- `sucursales.codigo TEXT`: código corto configurable (ej: "S1", "CC", "N")
- `ventas.numero_sucursal INTEGER`: contador secuencial reiniciado por sucursal
- Trigger `gen_venta_numero()` actualizado para asignar ambos campos
- Display en historial: `S1-0001` (sucursal) o `#N` (global sin sucursal)
- El código se configura en SucursalesPage → formulario de edición

### ISS-162/163/164 — Envío desde POS con autocompletado y cálculo automático (v1.8.38)

**ISS-164 — Autocompletado de dirección de entrega**
- El campo "Dirección de entrega" usa `AddressAutocompleteInput` (Google Places Autocomplete)
- Mientras el usuario escribe, aparecen sugerencias de Google Maps (ej: "Av. Tri" → "Av. Triunvirato")

**ISS-163 — Origen correcto en Google Maps**
- Nuevo campo editable "Dirección de origen (sucursal)" con Google Places Autocomplete
- Pre-llenado automáticamente con `sucursal.direccion` al activar el toggle de envío
- El link "Ver ruta en Google Maps" usa este campo como origen (antes quedaba vacío cuando `sucursalId = null`)

**ISS-162 — Cálculo automático de costo de envío**
- Al activar el toggle: pre-llena `$/km` desde `sucursal.costo_km_envio` (o `tenant.costo_envio_por_km` si la sucursal no tiene valor propio) y activa modo "Por KM"
- Al seleccionar una dirección desde el autocomplete (`onPlaceSelected`): llama `calcularDistanciaKm()` (Distance Matrix API) → setea los km → el effect calcula costo automáticamente
- **Jerarquía $/km**: `sucursal.costo_km_envio` (prioridad) → `tenant.costo_envio_por_km` (fallback global de Config → Envíos)

### ISS-105 — Costo de envío en validación de medios de pago (v1.8.24)
- `totalConEnvio = total + costo_envio` — la validación de medios usa este total
- `monto_pagado` incluye el costo de envío si el cliente lo abona en el mismo acto
- `validarDespacho()` actualizada para cubrir el total con envío

### Historial estricto por sucursal (v1.8.28-dev)
- Eliminado el workaround `OR sucursal_id IS NULL` — el historial usa `applyFilter` estricto
- Posible gracias al backfill migration 115 que asignó sucursal a todas las ventas históricas
- Ventas anteriores al lanzamiento multi-sucursal → asignadas a la sucursal más antigua del tenant

### ISS-106 — Historial de ventas: sucursal + badge CC (v1.8.24)
- Query usa `.or('sucursal_id.eq.X,sucursal_id.is.null')` para incluir ventas históricas sin sucursal asignada
- Badge "CC" en historial: ghost-style (outline, no relleno) cuando `es_cuenta_corriente = true`
- Evita que ventas anteriores al lanzamiento multi-sucursal desaparezcan del historial

### ISS-086 — Cuotas en tarjeta de crédito (migration 108)
- `tenants.cuotas_bancos JSONB`: config de bancos y planes de cuotas por tenant
- `ventas.cuotas_info JSONB`: info de cuotas guardada en la venta
- **ConfigPage → tab Métodos de pago**: nueva sección "Cuotas por banco" — agregar bancos, planes de cuotas (N cuotas, interés %, sin interés)
- **VentasPage**: al seleccionar "Tarjeta crédito" con monto > 0, aparece picker de banco + cuotas con display monto/cuota, total con interés, badge verde "Sin interés"

---

## Mejoras v1.8.39–v1.8.41 (2026-05-21 → 2026-05-23)

### Bug crítico envíos auto-creados (v1.8.39)
- VentasPage insertaba `cliente_id` en `envios` (columna inexistente) → INSERT fallaba silenciosamente
- Toda venta con envío durante meses NO generaba registro en módulo Envíos
- Fix: campo eliminado del INSERT, agregado `canal` desde `canalPOS` + `fecha_entrega_acordada`

### Fecha de entrega acordada en envío (v1.8.39)
- Nuevo campo en el panel de envío del POS al activar el toggle "Incluir envío"
- Se guarda como `envios.fecha_entrega_acordada` en el envío auto-creado

### Pre-llenado destino con domicilios del cliente (v1.8.39)
- Al activar el toggle envío, si el cliente tiene domicilios guardados → pre-rellena con el principal
- Dropdown con todos los domicilios guardados al hacer focus en el campo

### Saldo modal incluye costo_envio (v1.8.39)
- Al completar una reserva/presupuesto con envío, el saldo a cobrar incluye `costo_envio`
- Display de total en historial, ticket, detalle: muestra `total + costo_envio` (total real pagado)

### Selector courier propio/tercero (v1.8.41, pendiente PROD)
- Al activar "Incluir envío" aparecen 2 botones: **🚗 Envío propio** | **📦 Courier / 3ro**
- Si tercero: select de courier (OCA / Correo Argentino / Andreani / DHL Express / Otro) + **select de servicio dependiente del courier** (ISS-174 F1 — antes era texto libre; usa `serviciosDe()` del catálogo compartido `src/lib/couriers/catalogo.ts`, se resetea al cambiar de courier)
- El envío auto-creado lleva `courier = 'Envío propio'` o el courier seleccionado + `servicio`
- **ISS-174 (en progreso)**: la cotización automática por API de courier vive en [[wiki/features/envios]] → "Cotización de envíos por API de courier".

### Fixes integridad multi-sucursal (v1.8.40, ISS-críticos)
- **Cambio de sucursal limpia el carrito automáticamente**: `useEffect` con `prevSucursalRef` detecta cambio (no inicial) y resetea carrito + draft. Toast explicativo.
- **Query de lineas filtra por sucursal_id estrictamente**: antes podía descontar de otra sucursal. Error explícito: "Stock insuficiente en esta sucursal".
- **Validación pre-venta**: bloquea si hay >1 sucursal y ninguna seleccionada (toast: "Seleccioná una sucursal antes de registrar la venta").
- **Completar reserva → despachada**: usa `sucursal_id` de la venta original (no de la sesión actual).

### Re-fetch lineas al restaurar carrito (v1.8.40)
- Al volver al módulo Ventas, el carrito se restauraba pero `lineas_disponibles = []` → "Stock insuf. (0 disp.)"
- Fix: el re-fetch se hace DENTRO del mismo `useEffect` que restaura el carrito, justo después del `setCart`
- Elimina race condition con el effect separado que evaluaba antes de que el cart estuviera poblado

### Número ticket — fix fallback "S1-XXXX" (v1.8.40)
- `formatTicket` usaba `?? \`S${index+1}\`` como fallback cuando `sucursal.codigo = null`
- Toda venta con `sucursal_id` aparecía como `S1-0001` aunque nunca se configuró prefijo
- Fix: si `codigo` no está explícitamente configurado, muestra `#175` (número global)
- SucursalesPage: campo "Prefijo de ticket" opcional con preview en tiempo real

### Autocomplete direcciones reescrito (v1.8.39-v1.8.41)
- **Bug 1**: widget de Google Places Autocomplete tomaba el `<input>` y lo congelaba si fallaba (ApiNotActivatedMapError)
  - Fix: reemplazado por `AutocompleteSuggestion.fetchAutocompleteSuggestions()` (servicio programático, no toca el DOM)
- **Bug 2**: dual callback+Promise causaba que el callback con `status=undefined` resolviera la Promise vacía antes que llegaran resultados reales
  - Fix: API nueva es Promise-only; legacy `AutocompleteService` es callback-only (sin dual handling)
- **Bug 3**: tipeo bloqueaba el input por el `useEffect` watching value
  - Fix: tipeo procesado en `handleChange` directamente, actualiza padre primero, búsqueda en background

### Cálculo distancia con Haversine (v1.8.39-v1.8.41)
- **Antes**: dependía de `calcularDistanciaKm()` que necesitaba geocodificar el origen al momento de seleccionar destino → rate limiting Nominatim → fallaba
- **Ahora**: al activar el toggle envío, pre-geocodifica el origen UNA SOLA VEZ → `envioOrigenCoords`
- Cuando el usuario selecciona destino (que ya tiene `placeId = "lat,lon"` de Nominatim) → Haversine instantáneo × 1.35 (factor carretera)
- Fallback a Maps Distance Matrix API solo si faltan coordenadas

### Alertas geocodificación fallida (v1.8.39)
- Si origen no geocodifica → mensaje rojo bajo el campo "Dirección de origen" con link directo a Sucursales
- Si destino no geocodifica → mensaje rojo bajo "Dirección de entrega" con sugerencia de formato

---

## Relevamiento Ventas VF1-VF3 (v1.15.0, 2026-06-01)

Primeras 3 fases del backlog Ventas H-K. Respuestas en `sources/raw/relevamiento_ventas_respuestas.md` (sección H-K); plan en `project_pendientes.md`.

### VF1 — POS operativo (H2-H5)
- **H4 — Caja obligatoria**: `reserva` y `venta directa` (incluida 100% Cuenta Corriente) **siempre exigen caja abierta**. Solo el **presupuesto** (`pendiente`) se crea sin caja. Se quitó la excepción que permitía despachar 100% CC sin caja (gate en `registrarVenta`).
- **H5 — Consumidor Final**: flag al iniciar la venta **"Consumidor Final" vs "Cliente registrado"** (`ventas.consumidor_final`, mig 167). Si el negocio factura (`factHabilitada`) y NO es CF → **cliente obligatorio**. Toggle en el panel Cliente cuando `factHabilitada && cliente_consumidor_final`. Elegir un cliente registrado marca la venta como no-CF.
- **H2 — Ticket**: botón **"Enviar por email"** en el modal de ticket (reusa `send-email` tipo `venta_confirmada`) junto a "Imprimir".
- **H3 — Reimpresión**: desde el historial vía "Ver / Imprimir ticket" del detalle (cualquier rol con acceso a Ventas).

### VF2 — Canales configurables + reglas online/presencial (I1-I2)
- **I1**: tabla `canales_venta` por tenant (CRUD en **Config → Ventas → Operativa**, `CanalesVentaPanel`) con clasificación **online/presencial**; seed `SECURITY DEFINER` + trigger al alta del tenant. El selector de canal del POS toma los canales del tenant (antes hardcodeado). **MercadoPago no es canal** (es medio de pago) → no se seedea. Hook `src/hooks/useCanalesVenta.ts` (`clasificacionDe`, `reglaDe`).
- **I2**: `tenants.reglas_canal JSONB` con reglas por clasificación, **aplicadas**: `requiere_cliente` (cliente obligatorio en `registrarVenta`), `descuento_max_pct` (tope de descuento por canal), `lista_precio` (fuerza minorista/mayorista en `precioTierEfectivo`), `devolucion_dias` (plazo en `abrirModalDevolucion`).

### VF3 — Auditoría y permisos (J1-J3)
- **J1**: `venta_auditoria` (mig 169) + `logVentaAuditoria()` + **timeline en el modal** de la venta (anulación / cambio de cliente / override de descuento).
- **J2**: **clave maestra** (RPC `verificar_clave_maestra`) para **anular venta despachada**, **cambiar cliente** (botones nuevos en el detalle) y **override de descuento** (autoriza descuentos sobre el tope de rol/canal, re-ejecuta la venta con `overrideDescuento`). Sin `tenants.clave_maestra` configurada no se exige.
- **Anulación → envíos** (v1.52.0, auditoría de procesos): al pasar una venta a `cancelada`, sus envíos `pendiente` se cancelan automáticamente (+toast); envíos ya despachados/en camino no se tocan pero se avisa para gestionarlos en Envíos. Antes el envío quedaba vivo y el depósito podía despachar una venta anulada.
- **`?id=<venta>&devolver=1`** (v1.52.0): el patrón `?id=` de la URL ahora acepta `devolver=1` para abrir directo `abrirModalDevolucion` (CTA desde Envíos cuando un envío vuelve en estado `devolucion`). La **cobranza CC del POS** también registra su movimiento de caja (ver [[wiki/features/caja]]).
- **J3**: **CONTADOR read-only** — `/ventas` en `CONTADOR_ALLOWED` + nav visible; en `VentasPage` solo el tab Historial (sin POS, sin devolución/anular/registrar; guards en `registrarVenta`/`abrirModalDevolucion`).

### VF4 — Reportes y alertas (K1-K3, v1.16.0)
- **K1** (`ReportesPage`): reportes nuevos **baja-rotacion**, **mas-devoluciones**, **anuladas-devueltas** (devoluciones + ventas canceladas con motivo), **comparativa-canal** (online/presencial vía `useCanalesVenta`), **margen-real** (total − `precio_costo_historico`).
- **K3**: export **CSV** (`exportarCSV` + `sheet_to_csv`) además de Excel/PDF.
- **K2** (mig 170): alertas event-driven a DUEÑO/SUPERVISOR/ADMIN (`notificarRolesVentas`): **margen negativo** al cerrar venta despachada; **cliente/producto con >N devoluciones en M días** al `procesarDevolucion`. Umbrales `tenants.alerta_margen_negativo` / `alerta_devoluciones_n` / `alerta_devoluciones_dias` en Config → Ventas → Operativa.

### VF5 — Edición post-venta + NC interna (H1, v1.17.0)
- **H1a — autorización post-cobro**: quitar/editar ítems de una venta cobrada (vía **Devolver**) requiere rol DUEÑO/SUPERVISOR/ADMIN; otros roles (CAJERO) necesitan la **clave maestra** de un autorizado (`pedirClaveMaestra` en `abrirModalDevolucion`). Sin clave configurada, se bloquea.
- **H1b — NC interna**: si la venta era **facturada**, el comprobante de devolución se rotula **"NOTA DE CRÉDITO INTERNA · NO FISCAL"** (no reemplaza la NC electrónica AFIP — feature aparte). Se registra en `venta_auditoria` (acción `nc_interna` con `numero_nc` + monto + motivo + ítems); las devoluciones de despachadas se loguean como `devolucion`. El timeline del detalle (J1) muestra N° de NC + monto. Sin migración (reusa `devoluciones` + `venta_auditoria`).
