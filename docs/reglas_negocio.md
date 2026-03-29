# Genesis360 — Reglas de negocio

> Documento vivo. Actualizar a medida que se relevan nuevas reglas.
> Fuente: sesiones de preguntas con el usuario (GO = Gastón Otranto).

---

## Módulo 1: Caja

### Estructura

- **Cajas por sucursal**: múltiples cajas por sucursal. Límite según plan:
  - Free: 1 caja
  - Básico: 2 cajas por sucursal
  - Pro: 3 cajas por sucursal
  - Premium: 5 cajas por sucursal
  - Enterprise: 10 cajas por sucursal
- **Bóveda**: existe el concepto de bóveda como destino/origen de efectivo. Los ingresos y egresos de efectivo pueden ir/venir de la bóveda. Pendiente implementar.
- **Transferencia entre cajas**: existe el concepto de transferencia de efectivo entre cajas (y hacia/desde bóveda). Pendiente implementar.

### Roles con acceso al módulo de Caja

- ✅ OWNER
- ✅ SUPERVISOR
- ✅ CAJERO
- ❌ RRHH (sin acceso)

### Apertura de caja

- El saldo sugerido al abrir es el **monto de cierre de esa misma caja** (última vez que se cerró esa caja específica), no el cierre más reciente de cualquier caja.

### Cierre de caja

- CAJERO solo puede cerrar su propia caja (la que él abrió).
- OWNER/SUPERVISOR pueden cerrar cualquier caja.
- **Verificación al cerrar caja ajena**: modal con **contraseña maestra** definida por el OWNER.
  - El OWNER puede cambiarla cuando quiera y compartirla con sus supervisores.
  - No es la contraseña de la cuenta, es una contraseña específica de operación.
  - Pendiente implementar: campo `clave_maestra` en `tenants` + UI de configuración en ConfigPage.
- **Un cajero no puede tener más de una caja abierta simultáneamente.**

### Ticket de cierre

- Al cerrar la caja se genera un **comprobante/ticket de cierre** imprimible (PDF).
- Datos que debe incluir: fecha/hora de apertura y cierre, nombre del cajero, saldo inicial, total ingresos, total egresos, saldo sistema, conteo real ingresado por el cajero, diferencia.
- El ticket de cierre **puede reimprimirse** desde el historial de sesiones después del cierre.
- Pendiente implementar.

### Cierre de caja — diferencia de conteo

- Al cerrar se registra el conteo real del cajero físicamente.
- Si hay diferencia (saldo sistema ≠ conteo real): **solo se registra**, no hay flujo de aprobación ni bloqueo.
- Se envía **alerta automática** a OWNER y SUPERVISOR informando el monto de la diferencia.
- Pendiente implementar: lógica que detecte diferencia ≠ 0 al cerrar y genere notificación/alerta.

### Arqueo parcial

- Existe el concepto de **arqueo parcial**: el cajero puede consultar si el efectivo físico cuadra con el sistema en cualquier momento.
- **No cierra la sesión**; el cajero sigue trabajando normalmente después.
- **No queda registrado**: es una consulta momentánea sin rastro en el historial.
- Pendiente implementar.

### Movimientos manuales

- Los ingresos y egresos manuales requieren **motivo obligatorio**.
- Motivos predefinidos disponibles (tipo `caja` en `motivos_movimiento`). Si se elige "Otro", campo de texto libre.

### Integración con otros módulos

- Solo **Efectivo** genera movimiento real en caja (afecta saldo).
- Tarjeta / Transferencia / MP → `ingreso_informativo` (no afecta saldo, solo registro).
- Venta despachada con efectivo → ingreso automático en `caja_movimientos`.
- Gasto en efectivo → egreso automático en `caja_movimientos`.
- Nómina RRHH en efectivo → egreso automático + verificación de saldo.
- Sin caja abierta = no se puede despachar venta en efectivo ni registrar gasto en efectivo.

---

### Bóveda

- Módulo aparte (no integrado directamente en CajaPage).
- Tiene saldo visible con historial de movimientos.
- Operaciones: ingreso manual, egreso manual, recepción desde caja, envío a caja.
- **Transferencia Caja → Bóveda**: egreso en caja + ingreso en bóveda (dos movimientos vinculados).
- **Transferencia Bóveda → Caja**: egreso en bóveda + ingreso en caja (dos movimientos vinculados).
- **Transferencia entre Cajas**: egreso en caja origen + ingreso en caja destino (dos movimientos vinculados).
- **Acceso**: OWNER por defecto. SUPERVISOR con permiso habilitado por OWNER.
- Tanto OWNER como SUPERVISOR (con permiso) pueden hacer ingresos/egresos manuales en la bóveda.

---

## Módulo 2: Ventas

### Estados y flujo

| Estado | Cliente requerido | Pago requerido |
|---|---|---|
| `pendiente` | ✅ Obligatorio | No requerido |
| `reservada` | ✅ Obligatorio | Parcial o total |
| `despachada` | ❌ Opcional | Total (100%) |
| `cancelada` | — | — |

- **Venta pendiente**: requiere cliente registrado. Editable (ítems, cantidades, precios).
- **Venta reservada**: requiere cliente registrado. Editable. Pago puede ser parcial o total al momento de reservar. Al despachar debe cubrirse el total restante.
- **Venta despachada**: no requiere cliente, pero el monto debe estar 100% cubierto.

### Registro de cliente inline

- Si el cliente no existe al crear una venta, se puede registrar desde la misma pantalla de venta (modal/inline).
- Campos obligatorios para registro inline: **nombre completo, DNI, teléfono**.
- Email: opcional.
- DNI es el campo único de identificación (evita duplicados).
- Pendiente: agregar DNI y teléfono como campos mandatorios al formulario de clientes actual.

### Una venta = un cliente

- Una venta solo puede tener un cliente asignado.

### Pago parcial en reservas

- Una reserva puede registrarse con pago parcial o total.
- El pago entra a la caja inmediatamente con motivo: *"Pago de reserva de venta #X"*.
- El dinero no queda retenido; puede usarse para cualquier operación de caja.
- Al momento de despachar, el sistema calcula y muestra automáticamente el **saldo pendiente** (total − ya pagado), y solo pide ese monto.

### Modificación de ventas

- **Pendiente y reservada**: editables.
- **Alternativa aceptada si agregar ítems es muy complejo**: cancelar la reserva y crear una nueva heredando el monto ya reservado.
- **Despachada**: no editable.

### Descuentos

- Existen descuentos por línea/ítem (ya implementado).
- Existe descuento a nivel de cabecera sobre el total (ya implementado).

### Vencimiento de pendientes

- Las ventas pendientes **no vencen automáticamente**.
- Aparecen en **Alertas** para gestión manual.

---

## Módulo 3: Clientes

### Cuenta corriente

- Un cliente puede llevarse mercadería con pago parcial o sin pagar, generando una deuda registrada en el sistema.
- La deuda **no tiene vencimiento ni interés** (por ahora; a futuro se evaluará).
- El saldo se salda desde la **ficha del cliente** (no desde una nueva venta).

### Alertas de deuda

- Alertas automáticas de clientes con deuda en el tiempo.
- Desde la acción de la alerta → enlace directo a la ficha del cliente.

### Dashboard — indicadores de cuenta corriente

- Total de deuda pendiente (plata a cobrar).
- Porcentaje de ventas pagadas vs. en deuda.
- Pendiente implementar.

---

## Pendiente de relevar

### Módulo 1: Caja
- (completo)

### Módulo 2: Ventas
- [ ] ¿Existe nota de crédito / devolución? ¿Cómo afecta el stock y la caja?
- [ ] ¿Se puede re-abrir una venta despachada?
- [ ] ¿Hay límite de ítems por venta?

### Módulo 3: Clientes
- [ ] ¿Límite de deuda por cliente configurable?
- [ ] ¿Notificación al cliente cuando se registra su deuda?

### Módulo 4: Gastos
### Módulo 5: RRHH
### Módulo 6: Inventario / Movimientos
