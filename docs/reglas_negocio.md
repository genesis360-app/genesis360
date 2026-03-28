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

### Cierre de caja — diferencia de conteo

- Al cerrar se registra el conteo real del cajero físicamente.
- Si hay diferencia (saldo sistema ≠ conteo real): **solo se registra**, no hay flujo de aprobación ni bloqueo.
- Se envía **alerta automática** a OWNER y SUPERVISOR informando el monto de la diferencia.
- Pendiente implementar: lógica que detecte diferencia ≠ 0 al cerrar y genere notificación/alerta.

---

## Pendiente de relevar

### Módulo 1: Caja (preguntas siguientes)
- [ ] ¿Un cajero puede tener más de una caja abierta a la vez, o solo una?
- [ ] ¿Hay un "turno" de caja (fecha/hora de inicio-fin del cajero) separado de la sesión de caja?

### Módulo 2: Ventas
### Módulo 3: Inventario / Movimientos
### Módulo 4: Gastos
### Módulo 5: RRHH
