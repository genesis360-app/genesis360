---
title: Módulo Gastos
category: features
tags: [gastos, egresos, iva, comprobantes, gastos-fijos, caja, ordenes-compra, categorias-gasto, capitalizacion, cierre-contable]
sources: [CLAUDE.md, ROADMAP.md, reglas_negocio.md]
updated: 2026-05-25
---

# Módulo Gastos

**Página:** `src/pages/GastosPage.tsx` (`/gastos`)  
**Acceso:** DUEÑO · SUPERVISOR · ADMIN · CONTADOR

> [!NOTE] La categoría "Sueldos y cargas sociales" fue eliminada de Gastos (v0.72.0). Los sueldos se registran desde RRHH → Nómina.

---

## Tabs

1. **Gastos variables** — registro de gastos individuales
2. **Gastos fijos** — templates recurrentes con botón "Generar hoy"
3. **Historial** — todos los gastos con filtros avanzados
4. **Órdenes de Compra** — seguimiento de pagos a proveedores
5. **Recursos** — gastos vinculados a activos del negocio
6. **Autorizaciones** (v1.8.43+) — bandeja para DUEÑO/SUPERVISOR/ADMIN
7. **Cierres contables** (v1.9.0) — cierre mensual + historial · DUEÑO/CONTADOR/SUPERVISOR

---

## Gasto variable

### Campos

```
descripcion, monto, categoria, medio_pago (múltiples, JSON array {tipo, monto}),
fecha, comprobante_url (PDF/imagen), comprobante_titulo
tipo_iva, iva_deducible BOOLEAN, iva_monto  ← desglose IVA
deduce_ganancias BOOLEAN, gasto_negocio BOOLEAN ← para contaduría
conciliado_iva BOOLEAN  ← para libro IVA
```

### Badge "Borrador" (ISS-138 · v1.8.36)

Los gastos sin `medio_pago` muestran un badge amber **"Borrador"** en la tabla y en el historial. Indica que el egreso fue registrado pero aún no se sabe cómo fue pagado.

### Bloqueo de edición cuando ya fue a caja (v1.8.37)

Si un gasto ya tiene `medio_pago` asignado (fue registrado en caja):
- El campo **monto** y los **medios de pago** quedan **deshabilitados** en el modal de edición
- Se muestra aviso 🔒: "Monto y método de pago bloqueados — ya fue registrado en caja"
- Todavía se puede editar: descripción, categoría, fecha, notas, comprobante

### IVA deducible

- Campo `iva_monto` junto al monto total
- Columna IVA en tabla + total en footer
- Card de stats "IVA deducible" del período
- Impacta en "Posición IVA" del Dashboard (KPI)

### Comprobantes adjuntos

- Upload de archivo (PDF o imagen) al crear o editar el gasto
- Bucket privado `comprobantes-gastos` (10 MB, img + PDF)
- Ícono 📎 en lista → abre URL firmada (300s)
- Al eliminar el gasto: también elimina el archivo en Storage

---

## Integración con Caja (ISS-084 + ISS-136 · v1.8.22/v1.8.37)

### Flujo completo al crear o editar un gasto

1. **Al crear un gasto nuevo con medio de pago**: se registra automáticamente en la sesión de caja activa
2. **Al editar un gasto borrador para agregarle el pago**: también registra en caja (antes solo lo hacía en el INSERT, no en el UPDATE — fix v1.8.37)
3. **Gastos Fijos → Generar**: mismo comportamiento

### Reglas por tipo de pago

| Medio de pago | Movimiento en caja | Efecto en saldo |
|---|---|---|
| Efectivo | `egreso` | Descuenta del saldo real |
| Cualquier otro | `egreso_informativo` | Aparece como "No efectivo", **no descuenta** |

### Selector de caja

- Aparece cuando hay algún medio de pago con monto > 0 (no solo con efectivo)
- Con 1 caja: badge verde automático con ★
- Con múltiples cajas: dropdown que **pre-selecciona la sesión propia del usuario** (★ mía)
- Prioridad: selección explícita > sesión propia > única disponible

### Reversión al eliminar (v1.8.37)

Si el gasto tenía `medio_pago` (estaba en caja):
- El `confirm` advierte que se creará un movimiento de corrección
- Al confirmar: se crean movimientos inversos en la sesión activa
  - Efectivo → `ingreso` "[Corrección] Gasto eliminado: {descripcion}"
  - Otros → `ingreso_informativo` "[Tipo][Corrección] Gasto eliminado: ..."
- Toast diferenciado: "Gasto eliminado · Corrección registrada en caja"

---

## Métodos de pago dinámicos (ISS-133 · v1.8.36)

Los medios de pago disponibles en el formulario de gasto se cargan desde la tabla `metodos_pago` de Config (no están hardcodeados). Si el tenant agrega "Tarjeta crédito" en Config → aparece en Gastos automáticamente.

---

## Múltiples medios de pago

Mismo sistema que Ventas: JSON array de `{tipo, monto}`. Permite registrar un gasto pagado en parte con efectivo y en parte con transferencia.

---

## Gastos fijos (migration 048)

Templates recurrentes:

```sql
gastos_fijos(
  descripcion, monto, iva_monto, categoria,
  medio_pago, frecuencia CHECK(mensual|quincenal|semanal),
  dia_vencimiento INT, activo BOOLEAN
)
```

### Generar gasto desde fijo (v1.8.37)

El modal "Registrar gasto" ahora incluye:
- **Selector de caja**: igual que gastos variables (badge ★ si hay default claro, dropdown si múltiples)
- Al registrar: crea `egreso` (efectivo) o `egreso_informativo` (no-efectivo) en la caja seleccionada

---

## Historial separado (v1.3.0 · migration 072)

- Tab "Historial" con filtros: fecha / categoría / monto / operador
- Badge "Borrador" también visible aquí

---

## Tab "Órdenes de Compra" — v1.6.0+

### Campos en `ordenes_compra`

```sql
estado_pago CHECK(pendiente_pago|pago_parcial|pagada|cuenta_corriente)
monto_total DECIMAL
monto_pagado DECIMAL
monto_descuento DECIMAL DEFAULT 0  ← migration 126 (ISS-132)
fecha_vencimiento_pago DATE
dias_plazo_pago INT
condiciones_pago TEXT
comprobante_url TEXT   ← migration 108
comprobante_titulo TEXT
```

### Modal "Confirmar pago" (v1.8.36)

**Descuento del proveedor (ISS-132)**:
- Campo `Descuento ($)` que reduce el saldo sin requerir un medio de pago
- Se acumula en `ordenes_compra.monto_descuento`
- Se muestra en el resumen del modal como "Descuento nuevo / Descuento previo"

**Métodos de pago (ISS-133)**:
- Los medios disponibles vienen de `metodos_pago` de Config (no hardcodeados)
- "Cuenta Corriente" siempre disponible en OC

**Integración con Caja (ISS-136 · v1.8.36)**:
- **Selector de caja** en el modal (badge ★ o dropdown)
- Efectivo → `egreso` en caja
- Transferencia/Tarjeta/etc. → `egreso_informativo` en caja
- Todos los medios quedan registrados en el historial de caja

**ISS-095 — CC como método parcial**:
- Pago mixto: ej. 30% Transferencia + 70% Cuenta Corriente
- Días de plazo CC aparecen solo cuando hay CC en los medios

### Listado

- Filtrable por `estado_pago` y proveedor
- Badge contextual:
  - 🔴 Vencida (mora)
  - ⏰ Próxima (≤ 3 días)

---

## Integración con Facturación AFIP

- `gastos.conciliado_iva BOOLEAN` → para el Libro IVA Compras en FacturacionPage
- Los gastos aparecen en el módulo de facturación como crédito fiscal

---

## Categorías de gasto (v1.8.42 · migration 130)

Catálogo predefinido + custom por tenant. Tabla `categorias_gasto(tenant_id, nombre, requiere_sucursal, activo, predefinida, orden)`.

### Seed automático
- 16 categorías base sembradas en cada tenant nuevo via trigger `AFTER INSERT ON tenants`
- Backfill ejecutado en migration 130 para los tenants existentes
- 7 marcan `requiere_sucursal=true` (Alquiler, Servicios, Internet/Telefonía, Mercadería, Insumos, Mantenimiento, Limpieza) y 9 son globales

### Reglas
- **Predefinidas** no se eliminan, solo se desactivan (toggle `activo`)
- **Custom** se eliminan o editan libremente
- `requiere_sucursal=true` → el form de gasto exige sucursal_id (validación frontend, próxima fase backend)
- Selector de categoría en GastosPage carga desde la tabla; si la query falla usa `CATEGORIAS_GASTO_FALLBACK` hardcoded

### FK opcional
- `gastos.categoria_id` y `gastos_fijos.categoria_id` agregadas como nullable (retrocompat: el campo `categoria TEXT` sigue siendo el principal)
- Migración de datos (texto → FK) se hará en fase futura

---

## Reglas de obligatoriedad de comprobante (v1.8.42 · migration 131)

Configurables en ConfigPage → tab Gastos. Si **cualquier** regla activa aplica → comprobante obligatorio.

| Columna en `tenants` | Default | Descripción |
|---|---|---|
| `gastos_comp_siempre` | `true` | Comprobante siempre obligatorio (regla por defecto) |
| `gastos_comp_si_iva` | `false` | Obligatorio si `iva_deducible` o `conciliado_iva` |
| `gastos_comp_si_monto` | `false` | Obligatorio si `monto > gastos_comp_monto_umbral` |
| `gastos_comp_si_deduce_ganancias` | `false` | Obligatorio si `deduce_ganancias` o `gasto_negocio` |
| `gastos_comp_monto_umbral` | `null` | Umbral para regla por monto |

Validación frontend en próxima fase (v1.8.43 con permisos completos).

---

## Indicadores visuales en Gastos fijos (v1.8.42)

Badge por fila en tab Fijos según estado del mes actual:

- 🟢 **Dentro de fecha** — día del mes ≥ hoy, sin generar
- 🟡 **Pendiente este mes** — pasó `dia_vencimiento`, sin generar, dentro del umbral de atraso
- 🔴 **Atrasado (+Nd)** — más de `tenant.gastos_dias_alerta_borrador` días desde el vencimiento sin generar
- ✅ **Generado este mes** — existe un gasto en `gastos` del mes con la misma descripción

Detección "ya generado": match por `descripcion === fijo.descripcion` dentro del mes corriente. En fase futura, FK directa `gastos.gasto_fijo_id`.

---

## Badge "💰 Anticipo" en Órdenes de Compra (v1.8.42)

Aparece cuando:
- `monto_pagado > 0` (hay pago realizado)
- Y `estado NOT IN ('recibida', 'recibida_parcial', 'cancelada')` (sin recepción de mercadería)

**Color**:
- Naranja (default) — anticipo normal
- Rojo — pasaron más de `tenant.gastos_dias_alerta_anticipo_oc` días sin recibir mercadería (incluye contador `Nd`)

Sin estado nuevo en OC; mitigación visual de bajo costo para detectar exposición financiera con anticipos sin entregar.

---

## Moneda principal del tenant (v1.8.44 · migration 133)

- `tenants.moneda TEXT NOT NULL DEFAULT 'ARS'` con CHECK (ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR)
- Configurable en **ConfigPage → Mi Negocio** (sólo DUEÑO)
- **Etiqueta visual**: cambia símbolo y formato numérico sin conversión automática
- Helper centralizado `src/lib/formato.ts`: `formatMoneda(monto, moneda)`, `simboloMoneda()`, `localeMoneda()`, `MONEDAS_DISPONIBLES`
- Migración aplicada en: Gastos, Caja, Clientes, Envíos, Facturación, Métricas, Rentabilidad, Reportes

---

## Selector de alícuota IVA + auto según tipo de comprobante (v1.8.44)

### Opciones disponibles
21% · 10,5% · 27% · 0% · Exento · Sin IVA · **Personalizado** (input numérico)

### Auto-fill al elegir tipo de comprobante
Si `tipo_iva` está vacío al elegir el tipo, se asigna automáticamente:
- Factura A / Factura B / Nota A / Nota B / Factura de Importación / Ticket → 21%
- Factura C / Recibo C / Comprobante de bienes usados → sin_iva

No sobrescribe selección manual. El usuario siempre puede ajustar.

### Persistencia
- `gastos.alicuota_iva DECIMAL(5,2)` — guarda el porcentaje aplicado (parseado de `tipo_iva` o del input custom)
- `gastos_fijos.alicuota_iva DECIMAL(5,2)` — heredado al generar gasto

---

## Multi-sucursal por categoría (v1.8.44)

- `categorias_gasto.requiere_sucursal BOOLEAN` (existente desde migration 130)
- **Frontend (nuevo)**: al elegir una categoría con `requiere_sucursal=true` y no hay sucursal activa:
  - Aviso amber inline debajo del selector de categoría
  - Bloqueo en `guardar()` con `toast.error` claro

---

## Bloqueo de Cuenta Corriente con proveedores (v1.8.44 · migration 133)

### Reglas
- **OC vencida**: si el proveedor tiene OC con CC vencida sin pagar (saldo > 0) → bloqueo
- **Límite excedido**: si `saldo_actual_CC + monto_CC_nuevo > limite_credito_proveedor` → bloqueo
- **Override DUEÑO**: solo el DUEÑO/ADMIN/SUPER_USUARIO puede aprobar. Aprobación válida por 24h sin usar.

### Tabla `autorizaciones_cc`
- `motivo_bloqueo`: `limite_excedido | oc_vencida`
- `proveedor_id`, `oc_id`, `monto`, `motivo`, `payload`
- `solicitante_id/rol`, `estado` (pendiente/aprobada/rechazada/cancelada)
- `aprobador_id/rol`, `resolved_at`, `motivo_rechazo`

### Flujo
1. En GastosPage > Tab OC > "Pagar/CC", el usuario agrega CC al pago
2. `chequearBloqueoCC(proveedorId, montoCC)` corre antes del submit
3. Si bloqueado y no hay aprobación vigente → `SolicitarOverrideCCModal` (motivo obligatorio)
4. DUEÑO ve la solicitud en GastosPage > Tab Autorizaciones > Sub-tab "CC Proveedores"
5. Al aprobar, el solicitante puede reintentar el pago (función `existeAutorizacionCCAprobada` valida <24h)

### Componentes
- `src/lib/ccProveedor.ts`: `chequearBloqueoCC`, `existeAutorizacionCCAprobada`
- `src/components/SolicitarOverrideCCModal.tsx`: modal rojo con motivo obligatorio
- `src/components/BandejaAutorizacionesCC.tsx`: bandeja paralela a la de gastos

---

## Umbrales y Autorizaciones (v1.8.43 · migration 132)

### Umbrales por sucursal
- `sucursales.umbral_gasto_supervisor`: monto máximo de gasto que un SUPERVISOR puede crear/editar/eliminar sin pedir autorización del DUEÑO. `NULL = sin restricción`.
- `sucursales.umbral_gasto_cajero`: monto máximo de gasto que un CAJERO puede crear/editar sin pedir autorización del SUPERVISOR. `NULL = todo requiere autorización`.

Configurables en **SucursalesPage** → bloque "Umbrales de autorización de gastos" (2 inputs por sucursal).

### Reglas de umbral por rol (`src/lib/umbralGasto.ts`)

| Rol | Comportamiento |
|---|---|
| DUEÑO, ADMIN, SUPER_USUARIO | Sin restricción nunca |
| SUPERVISOR | Hasta `umbral_gasto_supervisor` (NULL → sin restricción). Si supera → solicita al DUEÑO |
| CAJERO | Hasta `umbral_gasto_cajero` (NULL → todo pide auth). Si supera → solicita al SUPERVISOR |
| CONTADOR | No crea/edita gastos (solo IVA del gasto) |

Aplica tanto al **crear** como al **editar** un gasto.

### Tabla `autorizaciones_gasto`
- `tipo`: `crear | editar | eliminar`
- `monto`, `descripcion`, `motivo`
- `payload JSONB`: snapshot del gasto a aplicar cuando se aprueba
- `solicitante_id`, `solicitante_rol`
- `estado`: `pendiente | aprobada | rechazada | cancelada`
- `aprobador_id`, `aprobador_rol`, `resolved_at`, `motivo_rechazo`
- Helper SQL `puede_aprobar_autorizacion_gasto(solic_rol, aprob_rol)`: CAJERO → SUPERVISOR+ · SUPERVISOR → ADMIN/DUEÑO

### Flujo en GastosPage
1. Al guardar un gasto, después de armar el `payload`, se llama a `evaluarUmbralGasto`
2. Si supera el umbral → se abre `SolicitarAutorizacionGastoModal` con el `payload` completo (NO se inserta el gasto)
3. El usuario completa motivo y envía la solicitud → fila en `autorizaciones_gasto` con estado `pendiente`
4. SUPERVISOR/ADMIN/DUEÑO ven el nuevo tab **"Autorizaciones"** con badge amber de pendientes (refetch 30s)
5. Al aprobar: se ejecuta INSERT/UPDATE/DELETE en `gastos` según `tipo` + se marca `aprobada`
6. Al rechazar: se requiere motivo, se marca `rechazada`

### Restricciones de rol
- **CAJERO**: las queries de `gastos` y `historial` filtran por `usuario_id = user.id` — solo ve sus propios gastos
- **CONTADOR**: botón "Nuevo gasto" oculto · aviso visible 📊 en modal de edición · input de `monto` deshabilitado

### Componentes nuevos
- `src/components/SolicitarAutorizacionGastoModal.tsx` — modal amber con motivo obligatorio
- `src/components/BandejaAutorizacionesGasto.tsx` — bandeja filtrable (pendiente/aprobada/rechazada) · expandible con motivo + payload JSON · aprobar/rechazar inline
- `src/lib/umbralGasto.ts` — helpers `evaluarUmbralGasto()` y `puedeAprobar()`

---

## Capitalización en recursos (v1.8.45 · migration 134)

Cuando un gasto se vincula a un **recurso** (`gastos.recurso_id`), aparece el checkbox **"Sumar al valor del recurso"** (`gastos.capitaliza_recurso BOOLEAN`).

- **Capitalizable** (mejora, ampliación, accesorio que aumenta valor patrimonial) → tildado · suma al valor del recurso
- **Mantenimiento/repuesto** (uso normal, reparación) → sin tildar · cuenta como costo operativo

CHECK constraint: `capitaliza_recurso = TRUE` requiere `recurso_id IS NOT NULL`.

En **RecursosPage** cada card muestra:
- Valor base + `+ $X cap.` (suma de capitalizaciones)
- Badge "🔧 Mantto $Y" + "📈 Cap. $Z" + cantidad de gastos asociados
- Stats globales: nueva card "Mantenimiento acumulado"

---

## Vista `vw_egresos_consolidados` (v1.8.45 · migration 134)

Vista PostgreSQL `SECURITY INVOKER` que une:
- Todos los `gastos` (cualquier estado de comprobante)
- `rrhh_salarios` con `pagado = TRUE`

Columnas: `id, fuente ('gasto' | 'rrhh_salario'), tenant_id, fecha, monto, descripcion, categoria, categoria_id, sucursal_id, medio_pago, usuario_id, recurso_id, empleado_id, periodo, created_at`.

Usada por:
- **DashGastosArea** — banner "Costo laboral del período (RRHH)" debajo de los 4 KPIs principales, con link a `/rrhh?tab=nomina` y total consolidado Gastos + RRHH
- **RentabilidadPage** — sección "Estado de resultados (período)" con línea separada **"Sueldos pagados (RRHH)"** + resultado neto

---

## Cierre contable mensual (v1.9.0 · migration 135)

**HITO transversal**: cierre por período de **Gastos + Ventas + Caja + OC**.

### Tabla `cierres_contables`
- `tenant_id, periodo (YYYY-MM-01), fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB`
- UNIQUE(tenant_id, periodo) · RLS por tenant

### Triggers BEFORE UPDATE/DELETE
- `gastos` (fecha) · `ventas` (created_at::date) · `caja_movimientos` (created_at::date)
- `caja_sesiones` (abierta_at::date) · `ordenes_compra` (created_at::date)
- RAISE EXCEPTION SQLSTATE P0001 con mensaje "Periodo contable cerrado hasta YYYY-MM-DD"
- Los INSERT no se bloquean: las notas de corrección pueden insertarse libremente

### Notas de corrección
- `gastos.gasto_padre_id UUID REFERENCES gastos(id) ON DELETE SET NULL`
- `gastos.es_correccion BOOLEAN DEFAULT FALSE`
- En GastosPage, los gastos con fecha cerrada muestran **🔒 Corregir** en lugar de Editar/Eliminar
- Modal "Nota de corrección" pre-rellena descripción/categoría/recurso/IVA, fecha=hoy, acepta monto negativo

### RPCs
- `cerrar_periodo(p_periodo DATE, p_observaciones TEXT) RETURNS JSON` — DUEÑO/SUPERVISOR/CONTADOR/ADMIN. Valida periodo > último y no en curso. Snapshot totales en JSONB.
- `reabrir_periodo(p_cierre_id UUID) RETURNS BOOLEAN` — solo DUEÑO/ADMIN/SUPER_USUARIO. Solo último cierre.

### Frontend
- Hook `useCierreContable()` → `{ ultimoCierre, isPeriodoCerrado(fecha) }` (cache 60s)
- Helper `manejarErrorPeriodoCerrado(error, toast)` para interceptar errores de trigger
- Componente `CierresContablesPanel` con preview live + listado expandible con totales snapshot
- Visible en GastosPage > Tab "Cierres contables" para DUEÑO/SUPERVISOR/CONTADOR/SUPER_USUARIO/ADMIN

Detalle completo: [[wiki/development/cierre-contable]]

---

## Tab "Gastos" en ConfigPage (v1.8.42)

Nueva tab con 3 secciones:

1. **Reglas de comprobante** — 4 toggles (combinables OR) + input monto umbral si "Si supera monto" está activo
2. **Alertas** — 2 inputs: días borrador (default 7) + días anticipo OC (default 15)
3. **Categorías de gasto** — tabla con CRUD; toggle `requiere_sucursal` + toggle `activo` por fila; agregar custom; eliminar solo permitido en custom

Acceso: DUEÑO (canEdit).

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/alertas]]
- [[wiki/features/recursos]]
- [[wiki/development/reglas-negocio]]
- [[wiki/development/cierre-contable]]
- [[wiki/features/configuracion]]
