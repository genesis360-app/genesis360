---
title: Módulo Caja
category: features
tags: [caja, efectivo, movimientos, sesion, arqueo, traspasos]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
---

# Módulo Caja

La caja es el registro de efectivo físico del negocio. Es obligatoria para registrar ventas y gastos en efectivo.

**Página:** `src/pages/CajaPage.tsx`  
**Shortcuts:** `Shift+I` = ingreso · (egreso solo vía Gastos)

---

## Regla fundamental

> **"Sin caja abierta = sin negocio"**
> No se puede registrar ninguna venta (despachada o reservada) ni gasto en efectivo si no hay sesión de caja abierta.

---

## Ciclo de una sesión de caja

```
Apertura (monto inicial)
  ↓
Movimientos durante el día (ventas, gastos, traspasos)
  ↓
Arqueo parcial (opcional, sin cerrar)
  ↓
Cierre (conteo real obligatorio → diferencia calculada)
```

La apertura **sugiere el monto del cierre anterior** de esa misma caja.

---

## Medios de pago en caja

| Medio | Efecto en caja |
|-------|---------------|
| Efectivo | `ingreso` / `egreso` — **afecta saldo real** |
| Tarjeta / MP / Transferencia | `ingreso_informativo` / `egreso_informativo` — solo registro, **no afecta saldo** |
| Seña en reserva (efectivo) | `ingreso_reserva` |
| Devolución de seña | `egreso_devolucion_sena` |
| Traspaso entre cajas | `ingreso_traspaso` / `egreso_traspaso` |
| Pago nómina | `egreso_nomina` |

> [!NOTE] El saldo de caja solo considera tipos sin `_informativo`. Tarjeta y MP se registran por trazabilidad pero no mueven el efectivo.

---

## Flujo ventas ↔ caja (v0.27.0)

- **Venta despachada** con efectivo → INSERT `ingreso` automático en `caja_movimientos`
- **Reserva** con efectivo → INSERT `ingreso_reserva`
- **Cancelar reserva señada** → INSERT `egreso_devolucion_sena`
- **Al despachar desde reservada** → consulta si ya existe ingreso_reserva para evitar duplicado

---

## Multi-caja

- Un tenant puede tener múltiples cajas (para múltiples sucursales o cajeros)
- Si hay múltiples cajas abiertas → selector UI en checkout/modal
- Si hay 1 sola caja abierta → auto-selección con badge verde
- Query key compartida: `['caja-sesiones-abiertas', tenant.id]` con `refetchInterval: 60_000`
- **Caja preferida por usuario**: `caja_preferida_{tenantId}_{userId}` en localStorage

---

## Reglas por rol

| Rol | Puede abrir | Puede cerrar | Restricción |
|-----|------------|-------------|------------|
| OWNER/SUPERVISOR/ADMIN | Cualquier | Cualquier | — |
| CAJERO | Solo 1 propia simultánea | Solo la propia | No puede cerrar caja de otro |

> [!WARNING] CAJERO no puede tener más de 1 sesión propia abierta simultáneamente. El botón "Cerrar caja" está bloqueado para CAJERO en sesiones ajenas.

---

## Traspasos entre cajas (migration 034)

- `es_caja_fuerte BOOLEAN` en `cajas`
- Tabla `caja_traspasos`: sesion_origen_id, sesion_destino_id, monto, concepto, usuario_id
- Mutation `realizarTraspaso`: valida monto ≤ saldo → inserta egreso en origen + ingreso en destino + registro en `caja_traspasos`
- Botón `ArrowRightLeft` visible solo cuando `cajasAbiertas.length >= 2`

---

## Arqueo parcial (migration 039)

- `caja_arqueos`: saldo_calculado, saldo_real, diferencia GENERATED STORED, notas
- Permite contar el efectivo sin cerrar la sesión
- Visible en historial de movimientos

---

## Cierre de caja

- **Conteo real obligatorio** (`*`) — botón deshabilitado si está vacío
- Campos guardados: `monto_real_cierre` + `diferencia_cierre`
- Ticket PDF se descarga automáticamente al cerrar
- El cierre muestra: Ingresos efectivo / Egresos efectivo / Efectivo esperado / Efectivo contado
- Nota: "Tarjeta, transferencia y MP no se cuentan aquí"
- Incluye `ingreso_traspaso` / `egreso_traspaso` en el cálculo de saldo

---

## Movimientos de sesión enriquecidos

Cada movimiento en la vista detalle de sesión muestra:
- Badge tipo: Venta / Seña / Egreso / No efectivo / Traspaso
- Concepto limpio (sin prefijo `[Tipo]`)
- Hora HH:MM:SS
- Badge medio de pago
- Badge `#N` número de ticket
- **Totales por método** al pie: Efectivo neto, Tarjeta, MP, etc.

---

## Caja y Gastos

- Gasto nuevo en efectivo → `egreso` automático en `caja_movimientos` (fire-and-forget)
- Gasto con otro medio → `egreso_informativo`
- Bloquea nuevo gasto en efectivo si no hay sesión de caja abierta

---

## Caja y Nómina

```sql
pagar_nomina_empleado(salario_id, sesion_id, medio_pago)
```
Para `medio_pago='efectivo'`:
- Calcula saldo = `monto_apertura + ingresos - egresos`
- Lanza EXCEPTION si saldo < neto del empleado

---

## Diferencia de apertura — v1.5.0

Al abrir una caja con monto ≠ al sugerido (cierre anterior):
- **Warning inline** en tiempo real: ámbar (diferencia leve) o rojo (diferencia significativa)
- **Confirmación en 2 pasos** antes de proceder
- Al confirmar → INSERT en `notificaciones` para OWNER y SUPERVISOR + email automático vía EF `send-email`

**Nuevos campos en `caja_sesiones`** (migration 084):
```sql
monto_sugerido_apertura DECIMAL   -- cierre anterior de esa caja
diferencia_apertura DECIMAL        -- monto_apertura - monto_sugerido
```

---

## Tab Caja Fuerte — v1.5.0

Visible para roles en `tenants.caja_fuerte_roles` (default: `['OWNER','SUPERVISOR','ADMIN']`):
- Historial de depósitos (movimientos tipo `ingreso_traspaso`)
- Sin saldo mostrado (solo historial)
- Botón "Depositar" → modal existente de traspaso

**Trigger `fn_crear_caja_fuerte`**: crea automáticamente la caja fuerte para tenants nuevos.

---

## Tab Configuración de Caja — v1.5.0

Visible solo para OWNER y SUPERVISOR:
- **Soft delete de cajas operativas** (deshabilitado si hay sesión activa)
- **Checkboxes de roles** que pueden acceder a la Caja Fuerte (`tenants.caja_fuerte_roles`)

---

## `getTipoDisplay(tipo, concepto)` — v1.5.0

Helper para distinguir tipos de movimiento en el historial de sesión:
- Si `tipo='ingreso'` y concepto contiene `#N` → **"Venta"**
- Si `tipo='ingreso'` y concepto NO contiene `#N` → **"Ingreso Manual"**

---

## Historial de sesiones — v1.5.0

Diferencia de **apertura** y **cierre** mostradas por separado (antes solo se mostraba la del cierre).

---

## Monitoring operativo

La EF `monitoring-check` alerta cuando hay **cajas abiertas > 16 horas** (umbral configurable en el código).

---

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/gastos]]
- [[wiki/features/rrhh]]
- [[wiki/database/schema-overview]]

---

## Mejoras v1.8.21

### ISS-087 — Caja predeterminada visual
- Ícono ★ (amarillo) junto al nombre de la caja predeterminada en el selector y los botones rápidos
- La preferida se guarda en `localStorage` con clave `caja_preferida_{tenantId}_{userId}`

### ISS-088 — Sugerido de apertura corregido
- Al abrir caja, el monto sugerido usa `monto_real_cierre` (si > 0) o `monto_cierre` como fallback
- Corrige bug que mostraba `diferencia_cierre` en lugar del saldo real

### ISS-089 — Ingresar a Caja Fuerte con selector de caja origen
- Modal "Ingresar a Caja Fuerte" incluye selector de caja de origen (antes usaba solo la caja activa)
- Valida saldo disponible en la caja de origen
- Sin caja seleccionada = ingreso externo (sin límite)
- Query `sesionesAbiertasAll` habilitada también cuando `showDepositoFuerte = true`

---

## Cajas por sucursal (migration 111 · v1.8.28-dev)

### Schema
- `cajas.sucursal_id UUID` FK a `sucursales` (nullable)
- **Caja Fuerte/Bóveda:** `sucursal_id = NULL` siempre (compartida a nivel tenant)
- **Cajas operativas:** cada una asignada a su sucursal

### Filtro en CajaPage
```typescript
// Con sucursal activa: muestra cajas de la sucursal + Caja Fuerte siempre
if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},es_caja_fuerte.eq.true`)
// sucursalId en queryKey → refetch automático al cambiar sucursal
```

### Tab Configuración
- Selector de sucursal por caja (visible con ≥2 sucursales) — permite reasignar cajas existentes
- Al crear caja nueva: recibe `sucursal_id` de la sucursal activa en el header
- Empty state descriptivo cuando no hay cajas en la sucursal seleccionada

### Al registrar negocio nuevo
El seed automático (migration 114) crea la **Caja Principal** asignada a **Sucursal 1** desde el primer momento.

