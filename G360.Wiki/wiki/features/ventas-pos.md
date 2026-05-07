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
