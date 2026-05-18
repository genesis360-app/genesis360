---
title: Ventas / POS
category: features
tags: [ventas, pos, checkout, carrito, pagos, reservas, combos, cuenta-corriente]
sources: [CLAUDE.md, reglas_negocio.md]
updated: 2026-04-30
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

---

## Cuenta corriente (v1.4.0 · migration 083)

- Botón "Despachar a cuenta corriente" visible solo si cliente tiene CC habilitada
- Bypasa validación de pago/caja
- Inserta con `monto_pagado=0`, `es_cuenta_corriente=true`
- La deuda queda registrada en la ficha del cliente

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

### ISS-085 — Número de ticket por sucursal (migration 108)
- `sucursales.codigo TEXT`: código corto configurable (ej: "S1", "CC", "N")
- `ventas.numero_sucursal INTEGER`: contador secuencial reiniciado por sucursal
- Trigger `gen_venta_numero()` actualizado para asignar ambos campos
- Display en historial: `S1-0001` (sucursal) o `#N` (global sin sucursal)
- El código se configura en SucursalesPage → formulario de edición

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
