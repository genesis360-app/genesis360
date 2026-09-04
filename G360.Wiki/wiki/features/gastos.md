---
title: Módulo Gastos
category: features
tags: [gastos, egresos, iva, comprobantes, gastos-fijos, caja, ordenes-compra, categorias-gasto, capitalizacion, cierre-contable, buscador, moneda-usd]
sources: [CLAUDE.md, ROADMAP.md, reglas_negocio.md, src/pages/GastosPage.tsx, migration 372, migration 373, migration 379, migration 380, migration 381, migration 389, src/components/SolicitarAutorizacionGastoModal.tsx, src/components/BandejaAutorizacionesGasto.tsx]
updated: 2026-09-04
---

# Módulo Gastos

**Página:** `src/pages/GastosPage.tsx` (`/gastos`)  
**Acceso:** DUEÑO · SUPERVISOR · ADMIN · CONTADOR

> [!IMPORTANT] **Guards server-side de plata (v1.81.0, REGLA #0):** el **pago de OC** se hace por el RPC atómico `registrar_pago_oc()` (mig 237): valida rol (no CONTADOR) + **doble firma server-side** sobre el umbral + saldo, y escribe OC + proveedor_cc + cheque + caja en una transacción. **Cierra el hueco "se omite si no hay clave"** (sobre el umbral sin clave configurada → BLOQUEA). El **comprobante de gasto** ahora se sube **ANTES** del INSERT (`comprobante_url` atómico; arregla un bug latente del camino de autorización por umbral, donde el archivo nunca se subía). El "dar de baja incobrable" usa `marcar_incobrable()` (mig 236) — ver [[wiki/features/clientes-proveedores]].

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

### Automatización fiscal por condición del tenant (v1.79.0 · mig 227)

La sección fiscal del form (componente compartido `renderFiscal`, usado en gasto variable **y** fijo) se adapta a `tenants.condicion_iva_emisor` (**default Monotributista** si no está seteada):

- **Columna nueva `tipo_comprobante`** (en `gastos` y `gastos_fijos`): `Factura A` / `Factura B` / `Factura C` / `Ticket`.
- **Monotributista / Exento:** el selector NO ofrece Factura A; el monto cargado es el **total**; se ocultan IVA crédito y "Deducir de Ganancias".
- **Responsable Inscripto (RI):** ofrece A/B/C/Ticket.
  - **Factura A** → muestra **Alícuota de IVA** (default **21%**, 10.5/27/custom) y calcula el **IVA crédito** automático (Neto + IVA).
  - **Factura B/C/Ticket** → `iva_monto = 0` (esos comprobantes no discriminan crédito fiscal).
  - **"Deducir de Ganancias"** marcable (default ON, desmarcable si el gasto es personal).
- **Guard server-side — trigger `fn_gastos_iva_guard`** (BEFORE INSERT/UPDATE en `gastos`, `SECURITY DEFINER`): **sanea** (`iva_monto`/`alicuota_iva`/`tipo_iva` → NULL, `iva_deducible` → false) salvo **RI + Factura A**, y `deduce_ganancias` → false salvo RI. Es la última línea de defensa (no hay Edge Function de gastos). Verificado: RI+A permite IVA, RI+B lo sanea.
- **Notas de modelo:** `iva_credito` del pedido original = columna existente `iva_monto`; `monto_neto` no se persiste (derivable = `monto − iva_monto`).

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
- **v1.10.2**: selector filtra estrictamente por sucursal activa — nunca muestra cajas de otras sucursales (aplica a nuevo gasto, gasto fijo y pago de OC)

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
- **🆕 Buscador por número/proveedor (`ocBusqueda`, 2026-08-12, ronda 3 de feedback sobre Alertas, ✅ EN
  PROD desde v1.169.0)**: antes esta pestaña no tenía NINGÚN buscador de texto — GO lo notó probando el
  deep-link `?oc=<id>` de `/alertas` ("Regularizar"/"Pagar ahora"), que solo expandía la fila puntual
  pero, entre varias OC en pantalla, no había forma de encontrarla a simple vista. Se agregó un input
  que filtra por **Nº de OC o nombre de proveedor**; el deep-link de Alertas ahora pasa el **número**
  de OC (`?oc=<numero>`, antes el id interno) para pre-completarlo, dejando la lista filtrada a 1 sola
  OC auto-expandida. Es un buscador de texto simple (no el sistema de píldoras de
  [[wiki/features/filtro-pildoras]] — acá alcanzaba con substring, no había ambigüedad de campos). Ver
  [[wiki/features/alertas]] → "Ronda 3".

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

## Umbrales y Autorizaciones (v1.8.43 · migration 132) — 🎯 tabla migrada a la genérica `autorizaciones` (C1, mig 389, v1.193.0, 2026-09-01)

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

### Tabla — 🎯 migrada a `autorizaciones` genérica (C1 del relevamiento de Supervisión de Fede, mig 389, `v1.193.0`)

> ⚠ **Histórico (hasta el 2026-09-01)**: existía una tabla propia `autorizaciones_gasto` con columnas
> dedicadas (`monto`, `descripcion`, `payload`, `solicitante_rol`, `aprobador_rol`, `resolved_at`, etc.).
> **Eliminada** por la mig 389 (`DROP TABLE`, confirmado 0 filas reales en DEV dos veces antes de aplicar,
> `migration-reviewer` pidió `IF EXISTS` en el DROP + esa confirmación independiente en la 1ª pasada —
> ambos resueltos, APTA en la 2ª). Gastos ahora usa la tabla genérica `autorizaciones` (`modulo='gastos'`),
> la misma que ya usan Inventario/Clientes/Envíos/Proveedores/Pedidos/RRHH/Productos — consolida TODAS las
> colas de aprobación del proyecto en un solo lugar.
>
> **Pero Gastos sigue siendo distinto de esos 7 módulos a propósito**: no se migró a
> `useSupervisorAutorizaciones`/`SupervisionPanel` (el hook/componente genérico que asume el permiso fijo
> `supervisa`) porque Gastos usa **jerarquía de ROL relativa** (CAJERO→SUPERVISOR/DUEÑO/ADMIN;
> SUPERVISOR→DUEÑO/ADMIN, función `puedeAprobar()` de abajo) — un modelo distinto que ese hook no soporta.
> Gastos conserva sus componentes propios (`SolicitarAutorizacionGastoModal.tsx`,
> `BandejaAutorizacionesGasto.tsx`, con su propio tab "Autorizaciones" ya existente en `GastosPage.tsx`) —
> **solo cambia la tabla destino**.
>
> Mapeo de columnas: `monto`/`descripcion`/`payload`/`sucursal_id`/`gasto_id`/`solicitante_rol` pasan a
> vivir dentro de `datos_cambio` jsonb (mismo criterio ya usado para Clientes/Envíos/Proveedores/Pedidos/
> RRHH); `motivo`→`notas` y `motivo_rechazo` se reusan tal cual (ya eran columnas de primer nivel de
> `autorizaciones`); `aprobador_rol`/`resolved_at` no hacían falta como columnas propias — el rol del
> aprobador se lee en vivo del JOIN a `users` (`aprobado_por`), y `updated_at` (ya con trigger) cumple el
> rol de `resolved_at` (una fila solo se actualiza una vez, al resolverse). `tipo`: sigue siendo
> `crear | editar | eliminar`. `estado`: `pendiente | aprobada | rechazada | cancelada`.
>
> **🐛 Hallazgo real de esta sesión (documentado, NO un bug arreglado — decisión de producto existente,
> no de código)**: `/gastos` **NO está en `CAJERO_ALLOWED`** (`AppLayout.tsx`) — un CAJERO real que navega
> ahí es redirigido a `/ventas` antes de poder cargar nada. Esto significa que **TODO el código de
> `esCajero`/umbral-para-CAJERO en `GastosPage.tsx` (filtrado de "mis gastos", chequeo de
> `umbral_gasto_cajero`) es HOY código muerto en producción** — nunca se ejecuta porque CAJERO nunca llega
> a esa página. No se cambió (es una decisión de acceso existente, no algo a decidir sin más) — la
> verificación de esta migración usó SUPERVISOR→DUEÑO en su lugar, que sí es un camino real y ejercita
> exactamente el mismo código migrado.

### Flujo en GastosPage
1. Al guardar un gasto, después de armar el `payload`, se llama a `evaluarUmbralGasto`
2. Si supera el umbral → se abre `SolicitarAutorizacionGastoModal` con el `payload` completo (NO se inserta el gasto)
3. El usuario completa motivo y envía la solicitud → fila nueva en `autorizaciones` (`modulo='gastos'`,
   `datos_cambio` con el payload) con estado `pendiente` — **antes del 2026-09-01, en `autorizaciones_gasto`**
4. SUPERVISOR/ADMIN/DUEÑO ven el nuevo tab **"Autorizaciones"** con badge amber de pendientes (refetch 30s)
5. Al aprobar: se ejecuta INSERT/UPDATE/DELETE en `gastos` según `tipo` + se marca `aprobada`
6. Al rechazar: se requiere motivo, se marca `rechazada`

**Verificación (mig 389)**: Playwright real contra DEV (spec 136 nuevo) — solicitud sembrada con el TOKEN
REAL de SUPERVISOR (mismo shape exacto que inserta el modal real, RLS real, no simulado) → confirmado que
el gasto NO existe todavía → DUEÑO aprueba desde Gastos→Autorizaciones con un click real → gasto creado de
verdad + autorización `aprobada` con `datos_cambio.gasto_id` apuntando al gasto real. Suite de regresión de
Gastos (3 specs: efectivo/caja, cheque/rechazo, comprobante obligatorio) sin regresión. Ver
[[wiki/features/supervision]] → "Retrofit a más módulos" → "Gastos (C1)".

### Restricciones de rol
- **CAJERO**: las queries de `gastos` y `historial` filtran por `usuario_id = user.id` — solo ve sus propios gastos. **⚠ Nota 2026-09-01: en la práctica esto es código muerto** — `/gastos` no está en `CAJERO_ALLOWED`, un CAJERO real nunca llega a cargar esta página (ver hallazgo arriba).
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

## Cuenta de origen en movimientos informativos (v1.9.1)

Cada gasto con medio de pago ≠ Efectivo inserta `caja_movimientos` con tipo `egreso_informativo` y `cuenta_origen_id` derivado del default del método de pago (`metodos_pago.cuenta_origen_id`). Esto descuenta el saldo de la cuenta bancaria/billetera correspondiente en la vista `vw_boveda_cuentas`. Ver [[wiki/features/caja]] sección "Bóveda como billetera del negocio".

Aplica en 5 puntos de `GastosPage.tsx`:
- Pago de OC con medios no-efectivo
- Edición de gasto borrador para agregar medio de pago
- Creación de gasto nuevo con cualquier medio (incluida caja fuerte)
- Reversión por eliminación de gasto pagado
- Generación de gasto fijo desde el cron manual

> 🛑 **2 gaps de REGLA #0 corregidos (2026-08-18, hallazgo lateral de la migración 372, Fase 4 de Caja
> USD)**: una auditoría de todos los insert-sites de `caja_movimientos` (hecha al construir el trigger
> `fn_validar_moneda_coincide_sesion`, ver [[wiki/features/caja]] → "Caja en USD — Fase 4 de 8") encontró
> **3 movimientos de caja de esta página que eran fire-and-forget** (sin `await` ni `toast` si fallaban —
> el patrón exigido desde la auditoría efectivo↔caja de v1.74.0, ver arriba y [[wiki/features/caja]] →
> "Integridad del efectivo") y **el selector de caja de Gastos no filtraba por moneda** (podía ofrecer una
> Caja USD para un gasto en pesos). Ambos corregidos en la misma sesión: los 3 inserts pasan a `await`eados
> con toast de error, y el picker de caja ahora excluye Cajas USD (mismo patrón que el selector doble de
> Ventas). **Estado: código COMMITEADO Y PUSHEADO a `origin/dev`** (commit `d783727d`, tag `v1.173.0`, mig
> 372).
>
> 🐛 **1 fix más chico, mismo motivo, sesión posterior (2026-08-19, G5 Fase 5 de Caja USD, mig 373,
> COMMITEADO Y PUSHEADO, commit `28d9291e`, tag `v1.174.0`)**: la Bóveda pasó a tener 2 filas
> `es_caja_fuerte=true` por tenant (ARS y
> USD) — `sesionFuerte` (fallback de pago cuando no hay caja operativa abierta) ahora filtra explícitamente
> `moneda==='ARS'`, porque el `.find()` anterior podía agarrar cualquiera de las 2 sin criterio. Ver
> [[wiki/features/caja]] → "Caja en USD — Fase 5 de 8".

---

## Cheques conectados al circuito de pago (v1.54.0 · migration 206 · auditoría #5)

El tab **Cheques** (CO6, mig 187) dejó de ser un cuaderno aparte:

- **Pagar una OC con medio "Cheque"** (modal de pago de OC) crea el cheque vinculado automáticamente: tipo propio, estado `entregado`, `oc_id` + proveedor. Mini-form inline (n° cheque / banco / **fecha de cobro obligatoria** — alimenta la alerta `chequeProximoACobrar`). Ídem **pago de gasto** (`cheques.gasto_id`, mig 206).
- **Cheque propio RECHAZADO revierte el pago que lo originó** (ChequesPanel → cambiarEstado): la OC vuelve a `pendiente_pago`/`pago_parcial` (`reversionPagoOC`) y se inserta un **ajuste +monto en `proveedor_cc_movimientos`** (la deuda reaparece en la CC del proveedor); el gasto vuelve a `pendiente`/`parcial` (`reversionPagoGasto`). Toast ↩️ + actividad log.
- Lógica pura en `src/lib/comprasCheques.ts`: `montoChequeDeMedios`, `reversionPagoOC`, `reversionPagoGasto` (testeadas).
- **Pendiente menor (futuro):** cheque de tercero depositado/cobrado → impacto en cuenta de origen/bóveda (hoy solo cambia estado).

> ⚙️ **Config requerida para pagar con cheque (decisión GO 2026-06-20, config opcional):** el seed de alta (`fn_seed_tenant_defaults`) crea Efectivo + 5 métodos de pago **pero NO "Cheque"**. Para que la opción "Cheque" aparezca en los modales de pago de OC/gasto, el tenant debe **agregar el método "Cheque"** en *Config → Métodos de pago* (con `habilitado_gastos`). Se decidió dejarlo como configuración opcional (no sumarlo al seed). Validado por e2e: `tests/e2e/31_cheque_gasto_rechazo_mutante.spec.ts` (gasto pagado con cheque → rechazo revierte el pago a `pendiente`).

## Compras/Gastos en USD + tasa de cambio editable — Fases 1-3 (migs 379-381, v1.180.0, 2026-08-24/25)

> **✅ 2026-09-04: verificado con un test e2e real de punta a punta**, no solo revisión estática de código
> — ver "Verificado con test e2e real (2026-09-04)" más abajo. De paso se aclaró un gap de memoria del
> asistente (no del proyecto): el relevamiento de 23 preguntas de este módulo YA estaba 100% respondido por
> Fede desde el 2026-08-21, con las Fases 1-3 ya en PROD desde el 2026-08-27 — nada de esto era un
> pendiente real. Quedan 2 preguntas técnicas dirigidas a GO ("Tonga") resueltas (D1: Caja USD ya soportaba
> egresos, cerrado; G1: NO existe hoy un modo dashboard "real" ARS+USD sin convertir, sería nuevo si se
> confirma) y 2 preguntas reenviadas a Fede sin responder todavía — ver
> [[wiki/development/reglas-negocio]] → "Módulo: Compras/Gastos en USD" (filas D1/G1).

> Relevamiento nuevo (`relevamiento-compras-gastos-usd-reglas-negocio.html`, raíz del repo), generado y
> **respondido por Fede 2026-08-21, 100% cerrado**, con instrucción explícita de arrancar ya (no esperar
> sesión dedicada). Distinto del G5 ("Caja en USD", que solo cubrió el lado de **ventas** — ver
> [[wiki/development/reglas-negocio]] → "Módulo: Caja en USD"): este plan cubre el lado de **compras/
> gastos**, feature nueva de punta a punta (`gastos`/`gastos_fijos`/`ordenes_compra` no tenían ninguna
> columna de moneda hasta la Fase 1).
>
> **Diseño cerrado**: 3 mecanismos de cotización independientes — sidebar/ventas (colaborativo, ya
> existía), Bóveda (separada, exclusiva Dueño), **Compras** (100% manual por transacción, con aviso NO
> bloqueante si la cotización tipeada se aleja ≥20% de la referencia). Solo se guarda `cotizacion_usd` si
> hay **descalce de moneda** entre el costo del ítem y el medio de pago usado; nunca se redondea; queda
> **congelada** al confirmar. El dinero para pagar una compra en USD sale de la **Caja USD operativa**
> (arquitectura: Bóveda = resguardo general, Caja = capa operativa que ya soporta egresos).
>
> **Fases 1, 2 y 3 ✅ CONSTRUIDAS, COMMITEADAS Y PUSHEADAS a `origin/dev`** como **`v1.180.0`** (commit
> `ac1a5c84`, tag+release publicados) — **✅ EN PROD desde el 2026-08-27** (PR #334 "v1.184.0 — Compras/
> Gastos en USD (Fases 1-3) + Asistente WhatsApp IA (Fases 1-4)", merge commit `867d651a`; migs 379-381
> aplicadas y verificadas en PROD `jjffnbrdjchquexdfgwq`). **DORMIDA a propósito**: confirmado por query
> real que ningún tenant de PROD tiene un método de pago USD real configurado, así que el camino nuevo
> (pago de OC/gasto en USD) no se activa solo — el camino existente en ARS (100% del volumen real hoy) fue
> re-verificado sin regresión antes de este deploy. Se estima el plan completo en ~4-5 fases; falta la UI
> de moneda en Gastos sueltos, reportes y algún detalle de UX (ver "Qué falta" más abajo). Detalle del
> deploy: `log.md` (2026-08-27, tipo `deploy`), `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ").

### Fase 1 — cimientos de datos (mig 379, commit `6a0f46af`)

Agrega `moneda text NOT NULL DEFAULT 'ARS'` + `cotizacion_usd numeric(14,2)` a `gastos`, `gastos_fijos` y
`ordenes_compra` — mismo patrón que `ventas.cotizacion_usd` (mig 368). 100% aditivo, cero cambio de
comportamiento para lo existente (todo sigue en ARS por default).

🔴 **Fix real de REGLA #0 encontrado al diseñar esta fase**: `registrar_pago_oc()` (tab "Órdenes de
Compra" de arriba) ya insertaba egresos reales en `caja_movimientos` al pagar una OC — la Caja USD YA
soportaba egresos, no hacía falta construir esa capacidad de cero — pero nunca completaba la columna
`moneda` de `caja_movimientos` (quedaba siempre en el DEFAULT `'ARS'` sin importar el medio de pago
real). Si se pagara una OC en USD desde una Caja USD, el movimiento habría quedado mal etiquetado como
ARS. Corregido, cero cambio de comportamiento para pagos en ARS (100% del volumen real hoy), verificado
con e2e real. `migration-reviewer`: APTA.

### Fase 2 — permisos (mig 380, commit `cce107c8`)

`tenants += compras_cotizacion_roles_permitidos jsonb` — mismo patrón que `cotizacion_usd_roles_permitidos`
de la Caja USD G5 (mig 370): NULL/[] = solo DUEÑO puede cargar/editar la cotización manual de una compra
con descalce; roles adicionales (base o `custom:{id}`) configurables aparte. Solo cimiento de
configuración en este commit — la consume la Fase 3.

### Fase 3 — pago con descalce de moneda (mig 381, commits `2476a3e4` + `90976a33`)

🔴 **Corrección de diseño encontrada ANTES de que importara** (REGLA #0): la Fase 1 había puesto
`cotizacion_usd` como columna única en `ordenes_compra`/`gastos`/`gastos_fijos` — pero una OC/gasto se
puede pagar en varias cuotas a lo largo del tiempo, y una sola columna no aguanta más de una cotización
sin pisar la anterior. Verificado con query real que 0 filas la usaban (nadie había pagado nada en USD
todavía) antes de corregir. Se movió a **`caja_movimientos.cotizacion_usd`** (una fila por movimiento
real de pago), el mismo patrón que ya usa `ventas.cotizacion_usd`. `moneda` de las 3 tablas de cabecera
queda sin cambios.

`registrar_pago_oc()` ganó el parámetro `p_cotizacion_usd`: si un medio de pago está en moneda distinta a
la de la OC (descalce — ej. pagar en pesos una OC pactada en dólares), exige la cotización manual y
**convierte server-side** (nunca confía en la aritmética del cliente para esto). El monto físico que sale
de la caja queda en su moneda real; el equivalente convertido es lo que cubre la deuda de la OC. Cuenta
Corriente queda excluida de la conversión (moneda-agnóstica por diseño).

**2 hallazgos de seguridad reales, corregidos ANTES de aplicar**: (1) cambiar la cantidad de parámetros
de una función existente crea un OVERLOAD en vez de reemplazarla — sin un `DROP FUNCTION IF EXISTS`
explícito con la firma vieja, la función anterior seguía viva y la conversión nunca se hubiera activado
(código muerto, mismo patrón de fix que mig 190/248); (2) al verificar ese fix, se encontró que `anon`
(usuario sin sesión) igual podía ejecutar el RPC de plata — `REVOKE FROM anon` no alcanza cuando `PUBLIC`
también tiene EXECUTE (Postgres se lo da por default a cualquier función nueva). Cerrado con `REVOKE FROM
PUBLIC` explícito + reverificado con `has_function_privilege()` real. De paso se re-verificó una nota
vieja de memoria del proyecto (56 días) que decía que esta función seguía expuesta a `anon` — comprobado
contra PROD real que NO es así, nota corregida.

**Wiring de frontend** (`GastosPage.tsx`, modal de pago de OC): ya no bloquea de plano un medio en otra
moneda — exige la cotización manual (gateada por el permiso de la Fase 2) y un aviso NO bloqueante si la
cotización cargada se aleja ≥20% de la cotización de referencia del sidebar. Fix adicional encontrado al
cablear: la caja que recibe el movimiento tiene que ser de la moneda REAL del medio pagado, no la de la
OC (con descalce son distintas). Lógica de conversión extraída a funciones puras testeadas
(`convertirMontoAMonedaOC`, `desvioCotizacionFuerte` en `src/lib/comprasPago.ts`;
`puedeCargarCotizacionCompras` en `src/lib/comprasPermisos.ts`) — 20 tests unit nuevos.

**Verificado en cada paso**: `tsc`/`build` limpios en las 3 fases; 4 e2e reales que pagan una OC/gasto en
pesos (`80_cheque_rechazo_oc_revierte_mutante`, `28_cobranza_cc_mutante`, `31_cheque_gasto_rechazo_mutante`,
`27_gasto_efectivo_mutante`) siguen en verde en cada incremento — cero regresión para el 100% del volumen
real de hoy (ARS). `schema_full.sql` regenerado (commit `3279b381`).

### Verificado con test e2e real (2026-09-04)

Hasta esta fecha, NINGÚN tenant (DEV ni PROD) tenía un método de pago "Efectivo USD" real configurado, así
que el camino de pago en USD (código en PROD desde v1.184.0/2026-08-27) nunca se había ejercitado con datos
reales, solo revisión estática de código.

**Fixture sembrado en DEV** (tenant "Almacén Jorgito", `3769b1db-10f4-46a6-bc7f-eb669307730d`):
`metodos_pago` nuevo "Efectivo USD" (`es_efectivo=true`, `moneda='USD'`, `habilitado_gastos=true`,
`habilitado_ventas=true` — esto también destraba probar la Caja USD de venta física, G5, que tampoco tenía
nunca un método real). Apunta a la `cuenta_origen` "Efectivo USD" ya existente sin usar; "Caja USD" y "Caja
Fuerte USD" ya existían en DEV. Es un INSERT de datos de prueba, no una migración de esquema.

**Test nuevo permanente**: `tests/e2e/140_compra_pago_oc_usd_mutante.spec.ts` (commit `8deb6a13`, `dev`) —
crea una OC en USD por UI, la paga con "Efectivo USD" desde la Caja USD operativa, verifica el toast de
éxito Y (siguiendo la metodología del proyecto de no confiar solo en el toast) la mutación DIRECTO contra
la base real: `caja_movimientos` con `tipo='egreso'`/`moneda='USD'` correctos (antes de la Fase 1, esa
columna quedaba siempre en el default `'ARS'` sin importar la moneda real del medio de pago usado — el
bug/gap que se verificó que ya no existe), `cotizacion_usd=null` (correcto, sin descalce de moneda);
`ordenes_compra.estado_pago='pagada'`, `monto_pagado=100.00`. **Confirma que las Fases 1-3 funcionan de
verdad con datos reales**, no solo en revisión estática de código.

### Qué falta del plan

- Sugerir la última cotización usada con ESE proveedor específico (segunda sugerencia de B3 del
  relevamiento — hoy el input de cotización arranca vacío/con la referencia general del sidebar, sin
  tracking por-proveedor).
- Gastos en USD con UI propia — la Fase 3 solo cableó el modal de pago de OC; un "gasto suelto" en
  `GastosPage.tsx` todavía no tiene selector de moneda en su formulario de creación, aunque
  `gastos.moneda` ya existe desde la Fase 1.
- C2/C3 (trazabilidad/freeze) — cubiertos de hecho por el diseño actual (`caja_movimientos.cotizacion_usd`
  queda congelado al insertar, el mecanismo de "nota de corrección" ya existente cubre errores) pero sin
  confirmar explícitamente con GO.
- G1/G2 (reportes/dashboard con desglose ARS/USD) — sin empezar. **2026-09-04: G1 verificado contra código
  real que NO existe hoy un modo dashboard "real" ARS+USD sin convertir** (sería nuevo a construir) —
  pregunta reenviada a Fede junto con la duda de a qué se refiere "solo dólar oficial de Banco Nación",
  sigue sin responder. Ver [[wiki/development/reglas-negocio]] → "Módulo: Compras/Gastos en USD" (fila G1).

Detalle completo: `sources/raw/project_pendientes.md` (cont. 46, "ARRANCÁ ACÁ"),
`wiki/database/migraciones.md` (migs 379-381), `wiki/business/roadmap.md` (v1.180.0, v1.195.4).

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
