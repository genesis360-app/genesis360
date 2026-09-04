---
title: Reglas de Negocio Relevadas
category: development
tags: [reglas-negocio, caja, ventas, inventario, clientes, gastos, uat, caja-usd, compras-usd, supervision]
sources: [reglas_negocio.md, uat.md, relevamiento-venta-usd-caja-usd-reglas-negocio.html, relevamiento-compras-gastos-usd-reglas-negocio.html, relevamiento-supervision-retrofit-reglas-negocio.html]
updated: 2026-09-04
---

# Reglas de Negocio Relevadas

> Documento vivo. Relevado con Gastón Otranto (GO). Fuente: `docs/reglas_negocio.md`.

---

## Módulo: Caja

> Relevamiento 2026-05-25 con socio (PDF `relevamiento-caja-reglas-negocio.pdf` · respuestas A-I en `sources/relevamientos/caja_2026-05-25.md`). Tanda 1 implementada en v1.9.1 + Tanda 1.5 (bóveda billetera + extraer dinero) en v1.9.2 — pendientes J-N + features ya respondidas pero no implementadas (detalle en `project_pendientes.md`).
>
> Score implementación: **4 de 8 decisiones críticas cerradas** (eliminar egreso manual ✅ · retiros bóveda solo DUEÑO ✅ · arqueo pre-cierre ✅ · cajas por moneda ✅ · Cuentas de Origen ✅). Pendientes: ticket por mail al DUEÑO · doble validación cierre · diferencias por cajero · clave maestra ampliada.

### Estructura
- Múltiples cajas por sucursal
- Límites por plan: Free=1, Básico=2, Pro=3, Premium=5, Enterprise=10 cajas por sucursal
- **Una caja = una moneda fija** (implementado v1.9.1 — `cajas.moneda`). Para manejar varias monedas, crear cajas separadas.
- **Bóveda**: discriminada por **Cuentas de Origen** (implementado v1.9.1) — cada cuenta bancaria/billetera/efectivo tiene su saldo independiente

### Apertura
- El saldo sugerido al abrir = **monto de cierre de esa misma caja específica** (no el cierre más reciente de cualquier caja)

### Cierre
- CAJERO solo puede cerrar su propia caja
- OWNER/SUPERVISOR pueden cerrar cualquier caja
- **Contraseña maestra** requerida para cerrar caja ajena: campo `clave_maestra` en `tenants` — pendiente implementar
- Al cerrar: diferencia (saldo sistema ≠ conteo real) solo se **registra** — no hay bloqueo
- **Alerta automática** a OWNER y SUPERVISOR si hay diferencia — pendiente implementar

### Ticket de cierre
- PDF imprimible al cerrar con: apertura/cierre, cajero, saldo inicial, ingresos, egresos, diferencia
- **Reimprimible** desde historial de sesiones — pendiente implementar

### Bóveda (pendiente implementar)
- Saldo visible + historial de movimientos
- Transferencia Caja → Bóveda: egreso en caja + ingreso en bóveda (dos movimientos vinculados)
- Transferencia Bóveda → Caja: egreso en bóveda + ingreso en caja
- Acceso: OWNER por defecto, SUPERVISOR con permiso habilitado

### Integración con otros módulos
- Solo **Efectivo** genera movimiento real en caja (afecta saldo)
- Tarjeta / Transferencia / MP → `ingreso_informativo` (solo registro)
- Sin caja abierta = no se puede despachar venta en efectivo ni registrar gasto en efectivo

---

## Módulo: Ventas

### Estados y requisitos

| Estado | Cliente | Pago |
|--------|---------|------|
| `pendiente` | ✅ obligatorio | No requerido |
| `reservada` | ✅ obligatorio | Parcial o total |
| `despachada` | ❌ opcional | Total (100%) |

### Reglas específicas
- Una venta = **un cliente únicamente**
- Venta pendiente: editable (ítems, cantidades, precios)
- Venta reservada: editable. Pago puede ser parcial al reservar; al despachar debe cubrirse el resto
- Venta despachada: **no editable**
- Las ventas pendientes **no vencen automáticamente** → aparecen en Alertas
- Registro inline de cliente: nombre + DNI + teléfono obligatorios; email opcional
- DNI = campo único de identificación (evita duplicados)

### Pago parcial en reservas
- El pago entra a la caja inmediatamente con motivo "Pago de reserva de venta #X"
- El dinero no queda retenido; puede usarse para otras operaciones
- Al despachar: solo se pide el **saldo pendiente** (total − ya pagado)

---

## Módulo: Clientes

### Cuenta corriente
- Cliente puede llevarse mercadería con pago parcial o sin pagar → deuda registrada
- La deuda **no tiene vencimiento ni interés** (por ahora)
- El saldo se salda desde la **ficha del cliente** (no desde una nueva venta)

### Dashboard CC pendiente
- Total de deuda pendiente (plata a cobrar)
- % de ventas pagadas vs. en deuda

---

## Módulo: Inventario (relevado 2026-04-19)

### Roles y permisos

| Acción | OWNER | SUPERVISOR | DEPOSITO | CAJERO |
|--------|-------|-----------|---------|--------|
| Ver inventario | ✅ | ✅ | ✅ | ❌ |
| Ingresar stock | ✅ | ✅ | ✅ | ❌ |
| Rebajar stock | ✅ | ✅ | ✅ | ❌ |
| Acciones LPN | ✅ | ✅ | ⚠️ pendiente aprobación | ❌ |
| Eliminar LPN | ✅ | ✅ | ❌ requiere autorización | ❌ |
| Aprobar autorizaciones | ✅ | ✅ | ❌ | ❌ |
| Conteo | ✅ | ✅ | ✅ | ❌ |
| Finalizar ajuste conteo | ✅ | ✅ | ❌ requiere aprobación | ❌ |

### Ingresos
- Precio de costo no obligatorio → alerta si queda en $0
- Producto inactivo: bloqueado para ingreso
- Ubicación DEV: se puede ingresar manualmente pero excluida de venta
- LPN: auto-generado si no se ingresa. Invariante: toda línea debe tener LPN

### LPNs
- **Mover LPN**: todo el LPN o cantidad parcial; a otra sucursal; DEPOSITO → pendiente aprobación
- **LPN multi-SKU (LPN Madre)**: campo `parent_lpn_id` — implementado desde migration 057
- **Combinar**: deben compartir mismo producto (lote y vencimiento no requerido)
- **Dividir**: cubierto por el flujo de "mover parcial"

### Conteo
- Sin límite de frecuencia
- Historial muestra quién hizo el último conteo y cuándo
- Movimientos de ajuste aparecen en historial con etiqueta "Conteo"
- DEPOSITO: los ajustes quedan pendientes de aprobación

### Vencimientos
- `fecha_vencimiento < hoy` → LPN **bloqueado para venta** + alerta automática ✅ implementado

### Lotes y restricciones por ubicación
- Múltiples lotes del mismo producto en la misma ubicación (en distintos LPNs) permitido
- `ubicaciones.mono_sku BOOLEAN` ✅ implementado (migration 052)

### Series
- Una serie puede transferirse entre LPNs sin pasar por venta/devolución
- Al cancelar reserva: series con `reservado=true` se liberan automáticamente ✅

### Stock mínimo
- Configurable por sucursal: `producto_stock_minimo_sucursal` ✅ implementado (migration 052)
- Al superar el mínimo: alerta se auto-resuelve ✅

### Recepciones / ASN
- Una recepción puede vincular ítems de más de una OC
- Over-receipt configurable: `tenants.permite_over_receipt` ✅ implementado (migration 051)

### Kitting
- Al iniciar armado → componentes pasan a "En Armado" (comprometidos sin consumir) ✅ implementado
- KITs pueden tener como componente otros KITs (anidados) — pendiente validar

---

## Módulo: Gastos (relevado 2026-05-24)

### Roles y permisos

| Acción | DUEÑO | ADMIN | SUPERVISOR | CONTADOR | CAJERO |
|--------|-------|-------|-----------|----------|--------|
| Ver gastos | ✅ | ✅ | ✅ | ✅ (incluye comprobante) | ✅ (solo su caja) |
| Crear gasto | ✅ | ✅ | ✅ (hasta umbral) | ❌ | ✅ (hasta umbral, en su caja abierta) |
| Editar gasto completo | ✅ | ✅ | ✅ (hasta umbral) | ❌ | ⚠ con autorización SUPERVISOR+ |
| Editar solo IVA del gasto | ✅ | ✅ | ✅ | ✅ | ❌ |
| Eliminar gasto | ✅ | ✅ | ✅ (hasta umbral) | ❌ | ⚠ con autorización SUPERVISOR+ |

- **Umbrales por sucursal** (configurables):
  - `sucursales.umbral_gasto_supervisor`: máximo sin autorización del DUEÑO
  - `sucursales.umbral_gasto_cajero`: máximo sin autorización del SUPERVISOR
- Aplica tanto al **crear** como al **editar** (si el nuevo monto cruza el umbral)
- RRHH queda **explícitamente fuera** del módulo Gastos
- CONTADOR ve el gasto completo (read-only resto) pero edita solo: `iva_deducible`, `conciliado_iva`, `iva_monto`, `tipo_iva`

### Ciclo de vida y cierre contable

- CAJERO puede crear/editar gastos **solo mientras su caja esté abierta** y **solo en su caja**
- Una vez asignado `medio_pago` y registrado en caja: monto y método quedan bloqueados (ya implementado v1.8.37)
- **Cierre contable mensual** (hito v1.9.0 — feature nueva transversal):
  - Lo dispara DUEÑO / SUPERVISOR / CONTADOR según permisos del rol
  - Aplica a **Gastos + Ventas + Caja + Órdenes de Compra**
  - Bloquea UPDATE/DELETE de registros con `fecha ≤ último cierre`
  - Solo se permite **"Nota de corrección"**: nuevo gasto vinculado al original (`gasto_padre_id` + `es_correccion=true`) con monto invertido
  - Reportes ofrecen vista con/sin correcciones aplicadas

### Multi-sucursal por categoría

- `categorias_gasto.requiere_sucursal BOOLEAN` define si el gasto obliga `sucursal_id`
- Categorías operativas (Alquiler, Servicios, Mercadería): requieren sucursal
- Categorías globales (Impuestos nacionales, SaaS, plataformas): opcional → reporte muestra "Tenant / Global"
- Si el tenant tiene **1 sola sucursal**: autocompletar siempre

### Borradores (gastos sin medio_pago)

- Sin límite de tiempo, badge ámbar "Borrador" (ya implementado v1.8.36)
- Alerta automática tras `dias_alerta_borrador` (configurable en Config → Gastos)
- Notificación al **creador + DUEÑO + SUPERVISOR**

### Comprobante adjunto (4 reglas combinables OR)

Configurables en Config → Gastos. Si **cualquier** regla activa aplica → comprobante obligatorio:

1. Si `iva_deducible` o `conciliado_iva` están marcados
2. Si monto > X (X configurable)
3. Si `deduce_ganancias` o `gasto_negocio` están marcados
4. Siempre obligatorio (sin condiciones)

**Default**: regla 4 activa (siempre obligatorio).

### Gastos en cuotas

- **Un gasto madre + N filas en `gasto_cuotas`** (estructura migration 097)
- El gasto madre **no toca caja** al crearse
- Cada cuota dispara movimiento al pagarse:
  - Efectivo → `egreso` con motivo "Cuota X/N de gasto #Y"
  - Otros → `egreso_informativo`
- Reportes mensuales muestran solo las cuotas devengadas del mes, no el total

### Gastos fijos (recurrentes)

- Generación **manual** con botón "Generar hoy" (no auto-cron)
- Indicadores visuales por estado:
  - 🟢 **Dentro de fecha** (día del mes ≥ hoy, sin generar)
  - 🟡 **Pendiente este mes** (ya pasó el `dia_vencimiento`, sin generar)
  - 🔴 **Atrasado** (más de N días sin generar — N configurable)
  - ✅ **Generado** (ya creado el del mes)
- Notificación in-app + email diario al DUEÑO mientras no se genere

### IVA

- Auto-calculado según tipo de comprobante:
  - **A**: 21% desglosado (default)
  - **B**: 21% incluido (default)
  - **C**: 0% (monotributo, sin IVA)
  - **Otros** (M, E, ticket fiscal): manual
- Selector de alícuota visible siempre (21 / 10.5 / 27 / 0 / custom)
- Override manual disponible para casos especiales (comprobante con monto fijo)

### Categorías de gasto

- Catálogo base predefinido (~15-20 categorías seed: Alquiler, Servicios, Mercadería, Marketing, Impuestos, Combustible, Mantenimiento, etc.)
- Tabla `categorias_gasto(tenant_id, nombre, requiere_sucursal, activo, predefinida)`
- Predefinidas: solo se pueden **desactivar** (no eliminar)
- Custom: el tenant agrega/edita/elimina libremente

### Sueldos / Nómina

**Decisión: NO migrar a Gastos.** Se gestionan en Módulo RRHH → Nómina (ya existente desde v0.32.0).

Razones:
- Sueldo tiene haberes + descuentos variables cada mes (no es gasto fijo plano)
- Cargas sociales patronales ≠ neto pagado al empleado
- `pagar_nomina_empleado()` ya inserta el egreso en `caja_movimientos`

**Integración con Gastos**:
- Vista `vw_egresos_consolidados` une `gastos` + `rrhh_salarios.pagado=true`
- Dashboard Gastos: card "Costo laboral del mes" leyendo de `rrhh_salarios`
- P&L con línea separada "Sueldos pagados (RRHH)" con link a `/rrhh?tab=nomina`

### Recursos asociados a gastos

- Default: `gastos.recurso_id` suma al **costo de mantenimiento acumulado** del recurso (ficha del recurso muestra "Gastado en mantenimiento: $X")
- Checkbox **"Sumar al valor del recurso"** (opt-in, default OFF) → `gastos.capitaliza_recurso BOOLEAN`. Capitaliza mejoras estructurales (GPS, alarma, accesorios fijos)
- **Depreciación automática**: diferida a fase fiscal posterior (requiere relevamiento con contador)

### Órdenes de Compra (OC)

**Pago antes de recepción (anticipo a proveedor)**:
- **Permitido** — mismo flujo que `pago_parcial` actual
- Mitigación de bajo costo (sin nuevo estado):
  - Badge naranja **💰 Anticipo** en listado OC cuando `monto_pagado > 0 AND recepcion_estado='pendiente'`
  - Alerta automática si pasan N días sin recibir (N configurable, default 15)

**Cuenta corriente con proveedores**:
- **Límite por proveedor** (`proveedores.limite_cc DECIMAL`): al alcanzarlo, bloquea OC nueva con CC
- **Vencimiento por OC** (`ordenes_compra.dias_plazo_pago` ya existe): genera fecha de vencimiento
- **Bloqueo solo CC** al vencer: el proveedor no puede recibir OC nuevas con método CC. OC con efectivo/transferencia siguen disponibles
- OC en curso (ya creadas pero impagas) **continúan**: se entrega mercadería pendiente
- **Override DUEÑO**: puede autorizar saltar el bloqueo una vez por excepción, registrado en tabla `autorizaciones_cc`

### Plan de implementación (5 fases)

| Release | Migrations | Contenido |
|---------|-----------|-----------|
| **v1.8.42** | 130, 131 | Quick wins: categorías + seed, config comprobante (4 reglas), indicadores fijos, OC anticipo |
| **v1.8.43** | 132 | Permisos: umbrales por sucursal, autorizaciones, RLS por rol, notificación borrador |
| **v1.8.44** | 133 | IVA auto + selector alícuota, multi-sucursal por categoría, CC proveedor (límite/vencimiento/override) |
| **v1.8.45** | 134 | Recursos↔Gastos (mantenimiento + capitalización), Dashboard consolidado, vista `vw_egresos_consolidados` |
| **v1.9.0** | 135 | **HITO**: Cierre contable mensual (Gastos + Ventas + Caja + OC), notas de corrección |

---

## Módulo: Caja en USD / Venta física en USD (G5)

> Relevamiento 2026-08-13 (`relevamiento-venta-usd-caja-usd-reglas-negocio.html`, raíz del repo, 29
> preguntas A-K). Fede respondió por escrito el 2026-08-18 (interpretado contra el enunciado completo del
> HTML, varias respuestas eran solo códigos de opción). **Estado: relevamiento CERRADO.** Alcance elegido:
> **A1 = (b) Caja USD completa**, con su propio ciclo apertura→cobro→arqueo→cierre, activando la lógica
> real detrás de `cajas.moneda` (hoy solo una etiqueta) — no el MVP mixto (a)/(c). Fede pidió
> explícitamente no ir por partes ("no estar haciendo y deshaciendo") — K3 (prioridad) = "TODO", sin orden
> parcial. Plan de 8 fases (Artifact de la sesión). **Fase 1 (cimientos, migs 368+369), Fase 2 (permisos y
> configuración, mig 370), Fase 3 (ciclo operativo, mig 371), Fase 4 (pago combinado ARS+USD, mig 372),
> Fase 5 (Bóveda ARS/USD, migs 373+374), Fase 6 (Devoluciones/NC con soporte USD, mig 375) y Fase 7
> (Reportes — H1/H2, SIN migración nueva) 100% COMPLETAS y ✅ EN PROD** (código+migraciones 2026-08-18/19,
> deploy a PROD 2026-08-20). Fases 1+2 COMMITEADAS Y
> PUSHEADAS (commit `310d9b3b`, tag `v1.171.0`); Fase 3
> también COMMITEADA Y PUSHEADA en una tanda posterior de la misma sesión (commit `010440cd`, tag
> `v1.172.0`); Fase 4 (mig 372) COMMITEADA Y PUSHEADA (commit `d783727d`, tag `v1.173.0`); Fase 5 (migs
> 373+374) COMMITEADA Y PUSHEADA a `origin/dev` (commit `28d9291e`, tag+release `v1.174.0` publicados);
> Fase 6 (mig 375) COMMITEADA Y PUSHEADA a `origin/dev` (commit `e55a1009`, tag+release `v1.175.0`
> publicados); **Fase 7 (sin migración) COMMITEADA** (commit `50f5579a`, tag+release `v1.176.0`
> publicados). **✅ Las 16 migraciones (360-375, incluye Fases 1-6 de Caja USD 368-375 + auditoría
> performance/calidad 361-366 + fixes de Producto 367) fueron DEPLOYADAS A PROD el 2026-08-20** — PR #331
> mergeado a `main` (merge commit `4dbe7fdb`), verificado con `apply_migration`/`list_migrations` y security
> advisor (0 ERROR, 1 INFO esperado). La Fase 4 activó **D1/D2/D3/A2**: el cajero tipea el monto en USD y el sistema convierte
> (D2), cada caja se contabiliza por lo efectivamente cobrado en ESA moneda — nunca el total convertido — y
> el vuelto de un pago en USD siempre sale en pesos (D3/D1), y `productos.acepta_cualquier_moneda` (A2,
> agregado en la Fase 2 sin usarse hasta ahora) por fin gobierna si un producto puede cobrarse en USD. La
> Fase 5 activa **F2/F3**: la Bóveda deja de asumir 1 sola fila por tenant y pasa a tener 2 (ARS y USD,
> pestañas separadas), sembradas automáticamente para todo tenant; la función "Convertir USD↔$" (único
> punto de conversión de todo el sistema, exclusivo del DUEÑO) queda implementada; y un retiro de Caja USD
> sin destino exige clave maestra además del motivo, si el tenant la tiene configurada y el monto alcanza
> el umbral propio en USD. **La Fase 6 activa G1/G2**: la devolución en caja soporta un medio "Efectivo
> USD" (egreso real en la Caja USD elegida, cotización de hoy por default o de la venta original si el
> tenant activa el toggle `tenants.reintegro_usd_cotizacion_original` — G1), y se confirma que la NC AFIP
> ya usaba la cotización de la venta original por construcción (G2, sin cambio de lógica real en
> `emitir-factura`, solo comentarios). **La Fase 7 activa H1/H2, sin migración**: el reporte de Ventas
> desglosa el monto real en USD por método de pago junto al equivalente en pesos (H1), y el Dashboard excluye
> las ventas con `cotizacion_usd` no nulo de sus indicadores en pesos ("Ventas del mes", "Margen
> Contribución", "Ingreso Neto (Caja)", Rentabilidad), mostrando el componente USD aparte (H2) — de paso se
> corrigieron 2 bugs preexistentes (`costoVentas` sin filtro de estado, `ingresoNeto` sin filtro de moneda).
> Detalle técnico completo: [[wiki/features/caja]] → "Caja en USD —
> Fase 4 de 8" y "Fase 5 de 8", [[wiki/features/devoluciones]] → "Caja en USD — Fase 6 de 8" (fuente de
> verdad de esa fase), [[wiki/features/ventas-pos]] → "Pago combinado ARS+USD",
> [[wiki/features/reportes-metricas]] → "Caja en USD — Fase 7 de 8" (fuente de verdad de esa fase),
> `wiki/database/migraciones.md` (migs 368-375).
>
> **Fede confirmó por escrito (2026-08-18) las 3 preguntas abiertas que quedaban antes de dar el OK
> completo al plan de 8 fases:**
> 1. **Orden 1→8 confirmado tal cual está planteado.** Única duda de Fede: si la Fase 5 (Bóveda) depende
>    técnicamente de la Fase 6 (Devoluciones/NC) o viceversa, o son independientes y se podrían construir
>    en paralelo — lo dejó a criterio de quien mira el código real. Análisis: **no hay dependencia directa
>    entre 5 y 6** (tocan código distinto — `vw_boveda_cuentas`/`operarCajaFuerte` vs.
>    `devolver_saldo_a_favor`/`emitir-nota-credito` — y ninguna necesita que la otra exista). Ambas SÍ
>    dependen de que la Fase 3 (Caja USD operativa) ya exista (Bóveda necesita algo real para depositar;
>    el reintegro en caja de la Fase 6 necesita una sesión de Caja USD viva para acreditar la devolución).
>    La NC de la Fase 6 (lado fiscal) técnicamente podría construirse ya mismo — solo lee el snapshot de
>    `ventas.cotizacion_usd` que la Fase 1 ya deja listo — pero el reintegro en caja (la otra mitad de la
>    Fase 6) además se beneficia de que la Fase 4 (pago combinado) ya exista, para saber cómo se pagó
>    originalmente una venta mixta antes de revertirla. Conclusión: el orden 1→8 ya resuelve esto sin
>    necesidad de reordenar (4 queda antes de 5 y 6); no hay ganancia real de "paralelizar" 5 y 6 al ser un
>    solo build secuencial, pero tampoco hay riesgo en construirlas en cualquier orden entre sí si en algún
>    momento conviniera.
> 2. **Punto 1 (G1 ≠ G2) — confirmado intencional**, ver fila G2 de la tabla de abajo. Deja de ser
>    bloqueante para la Fase 6.
> 3. **Punto 2 (¿arrancar ya o dejarlo para sesión dedicada?) — a criterio de Tonga (GO).** GO instruyó
>    seguir con el plan.
>
> Con esto, **la Fase 6 no tenía ningún punto abierto propio** y se construyó completa (mig 375, ver
> [[wiki/features/devoluciones]] → "Caja en USD — Fase 6 de 8") — **la Fase 7 (Reportes — H1/H2) tampoco
> tenía ningún punto abierto propio** y se construyó completa, sin migración nueva (ver
> [[wiki/features/reportes-metricas]] → "Caja en USD — Fase 7 de 8"), COMMITEADA (commit `50f5579a`,
> tag+release `v1.176.0`) y ✅ DEPLOYADA A PROD el 2026-08-20 (PR #331, merge commit `4dbe7fdb`) — el único
> punto que sigue
> sin cerrar en todo el plan de 8 fases es **C2** (cotización Banco Nación para AFIP, Fase 8), pendiente de
> confirmación con un contador real, y no bloquea nada de las Fases 1-7 (ya EN PROD). **Próximo paso: Fase
> 8** (C2, bloqueada por el contador).

### Decisiones cerradas

| # | Decisión |
|---|---|
| A1 | Caja USD completa (ciclo propio, no un medio de pago más dentro de la caja en pesos) |
| A2 | Cobro en USD y `producto.moneda_venta` son independientes, pero **por producto**: checkbox nuevo en la ficha ("puede cobrarse en cualquier moneda" vs. "obligado a la moneda de su precio de venta") — no es decisión del cajero en el momento |
| A3 | Generalizar "medios que son efectivo real" a una **lista** (no el string único `'Efectivo'` hardcodeado), cada medio atado a una moneda |
| B1/B2 | Snapshot de cotización **por venta** (columna nueva en `ventas`), uso interno — confirmado indirectamente vía G2 ("debe quedar registrado la cotización de cada venta convertida"). `tenant.cotizacion_usd` sigue siendo un valor único sobreescribible, sin historial propio — eso no cambia |
| B3 | Solo el **DUEÑO** elige a qué tipo de dólar (blue/oficial/MEP/cripto) actualizar. Otros roles pueden "refrescar" (repetir la última actualización) pero **no elegir tipo**, salvo que el dueño le dé ese permiso puntual a un rol. Además: traer `compra` Y `venta` de la API (hoy `useCotizacion.ts` solo guarda `.venta`) y usar la que corresponda según si se compra o se vende USD |
| C1 | Factura AFIP sigue **siempre en pesos** (no usar `MonId='DOL'` de WSFE) — sin cambios en `emitir-factura` |
| C2 | 🟡 **Pendiente de confirmación contable, NO cerrado.** La cotización a declarar en el comprobante debe salir de una fuente **Banco Nación** específica, separada de `tenant.cotizacion_usd` (que sigue siendo la cotización comercial de uso interno/POS). Ni Fede ni Claude son contadores — no programar como regla fija hasta confirmar con un profesional. No bloquea el resto del proyecto |
| C3 | La factura nunca redondea — sale siempre en pesos con 2 decimales exactos (no aplica "redondeo USD↔ARS" porque nunca se factura en USD) |
| D1 | El vuelto de un pago en USD **siempre se da en pesos**, a la cotización vigente |
| D2 | El cajero tipea el monto en USD directamente; el sistema lo convierte a pesos con la cotización vigente y lo suma al resto de los medios de pago |
| D3 | Pago combinado ARS+USD reparte automáticamente entre las 2 sesiones de caja correspondientes (deben estar ambas abiertas). **Cada caja se contabiliza por lo efectivamente cobrado en esa moneda, nunca por el total de la venta convertido** — regla de integridad fiscal/contable clave |
| E1 | Mismo flujo de apertura/arqueo/cierre — solo corregir el bug de formato (mostrar "US$" cuando la caja/sesión activa es USD, hoy siempre muestra `tenant.moneda`) |
| E2 | Arqueo con conteo por denominación de billete USD (1/5/10/20/50/100) |
| E3 | Umbral de diferencia de arqueo propio en USD (no relativo al de pesos), **default $0** (tolerancia cero), configurable |
| F1 | **Bloquear** el traspaso entre cajas de distinta moneda (solo ARS↔ARS, USD↔USD) — cierra el bug de integridad latente donde hoy se puede traspasar "100" de una caja ARS a una USD y acreditar 100 dólares |
| F2 | Sembrar cuenta "Efectivo USD" automáticamente en `cuentas_origen`. Además: la Bóveda debe tener **pestañas separadas ARS / USD**, incluyendo USD "virtual" (MercadoPago, transferencias en USD) como categoría propia — nunca mezclado con efectivo físico. **La conversión USD↔$ solo puede hacerse desde la Bóveda, y solo la hace el DUEÑO** — es el único punto de conversión de todo el sistema |
| F3 | Retiro de Caja USD sin destino (dueño se lleva dólares) requiere, además del motivo obligatorio, **contraseña maestra** |
| G1 | Reintegro de una venta cobrada en USD: configurable por tenant. **Default: en pesos, a la cotización del momento de la devolución** |
| G2 | ✅ **Confirmado por Fede como intencional (2026-08-18)** — la Nota de Crédito AFIP usa la cotización **de la venta original** (registrada internamente por B1/B2), no la del momento de la devolución. Distinto a propósito de G1 (reintegro en caja = plata real moviéndose hoy, refleja el valor de hoy; NC = comprobante fiscal, preserva coherencia con lo ya declarado ante AFIP) — "no deben usar la misma cotización entre sí, y no hay que buscar unificarlos". Deja de ser bloqueante para la Fase 6 |
| H1 | Reportes: total único en pesos como resumen **+** detalle desglosado por moneda debajo (no ocultar el desglose) |
| H2 | Dashboard: las ventas en USD se **excluyen** de los totales/indicadores en pesos (ticket promedio, etc.) y se muestran aparte — mezclarlas distorsiona la métrica sin que se note por qué cambió |
| I1 | Quién puede operar la Caja USD: configurable por tenant, por rol |
| I2 | Umbral de contraseña maestra en Caja USD: propio en USD, separado del umbral en pesos |
| J1 | Redondeo USD↔ARS: **ninguno** — decimales exactos |
| J2 | Dentro de la Caja USD: **solo billetes enteros** (US$1 como unidad mínima, sin centavos de dólar) |
| K1 | Cómo lo resuelven hoy "a mano": cobran en USD y van directo a una caja más segura o a la caja fuerte — valida el modelo de Caja USD completa (A1) y el depósito directo a Bóveda (F2) |
| K2 | Nada para agregar — el documento cubre todo a criterio de Fede |
| K3 | Sin prioridad parcial — pide la implementación completa ("TODO") |

### Alcance real (lo que cambia en código, resumen técnico)

Toca: `productos` (checkbox moneda libre), `cajas`/`caja_sesiones`/`caja_movimientos`/`caja_arqueos`
(moneda real, no solo etiqueta), `ventas` (columna cotización snapshot, selector de 2 cajas en pago
combinado), `metodos_pago` (lista de "efectivo real" por moneda en vez de string hardcodeado),
`cuentas_origen`/Bóveda (pestañas ARS/USD, conversión centralizada), `realizarTraspaso` (bloqueo cross-
moneda), `tenants` (permisos de quién elige tipo de dólar, umbrales USD), reportes/Dashboard (desglose
USD/ARS separado). Backend: `abrirCaja`/`cerrarCaja`/`calcularVuelto`/`registrarVenta`/
`devolver_saldo_a_favor` pasan a ser moneda-aware. No toca `emitir-factura` salvo la fuente de cotización
del C2 (pendiente contador).

---

## Módulo: Compras/Gastos en USD + tasa de cambio editable (relevado 2026-08-21)

> Relevamiento `relevamiento-compras-gastos-usd-reglas-negocio.html` (raíz del repo). **Respondido por
> Fede 2026-08-21, 100% CERRADO**, con instrucción explícita de arrancar ya (no esperar sesión dedicada).
> Distinto de G5 (arriba), que solo cubrió el lado de **ventas** — este cubre **compras/gastos**, feature
> nueva de punta a punta. **Fases 1, 2 y 3 (de las ~4-5 fases estimadas del plan) ✅ CONSTRUIDAS,
> COMMITEADAS Y PUSHEADAS a `origin/dev` como `v1.180.0`** (migs 379, 380 y 381, commit `ac1a5c84`,
> tag+release publicados — **✅ EN PROD desde el 2026-08-27** (PR #334, merge commit `867d651a`), **DORMIDA**
> a propósito, ningún tenant de PROD tiene un método de pago USD real configurado): cimientos de datos + permisos
> de cotización manual + pago de OC con descalce de moneda (conversión server-side,
> `caja_movimientos.cotizacion_usd`). **✅ 2026-09-04: verificado con un test e2e real contra datos reales**
> (`tests/e2e/140_compra_pago_oc_usd_mutante.spec.ts`, commit `8deb6a13`), primer método de pago USD
> sembrado en DEV (tenant "Almacén Jorgito") — confirma que las Fases 1-3 funcionan de verdad, no solo en
> revisión estática de código; detalle en [[wiki/features/gastos]]. Detalle técnico completo:
> [[wiki/features/gastos]] → "Compras/Gastos en USD + tasa de cambio editable", [[wiki/features/clientes-proveedores]],
> `wiki/database/migraciones.md` (migs 379-381).

### Decisiones cerradas

| # | Decisión |
|---|---|
| — | **3 mecanismos de cotización independientes**: sidebar/ventas (colaborativo, ya existía, ver G5 arriba), Bóveda (separada, exclusiva DUEÑO, ver F2/F3 de G5), Compras (**100% manual por transacción** — el usuario tipea la cotización al confirmar el pago/costo) |
| C1 | Solo se guarda `cotizacion_usd` si hay **descalce de moneda** entre el costo del ítem y el medio de pago usado — si costo y pago coinciden en moneda, queda NULL (sin conversión que registrar) |
| — | Aviso **NO bloqueante** si la cotización tipeada manualmente se aleja **20-30%** de una referencia (no impide confirmar, solo advierte) |
| H1 | **Nunca se redondea** — mismo criterio que G5 (`numeric(14,2)` preserva decimales exactos) |
| — | La cotización usada queda **congelada** al confirmar la transacción (snapshot, no recalculable después) |
| D1 (técnica) | El dinero para pagar una compra en USD sale de la **Caja USD operativa** (no directo de la Bóveda) — arquitectura: Bóveda = resguardo general, Caja = capa operativa. Confirmado que `registrar_pago_oc()` YA soporta egresos reales en `caja_movimientos` — no hacía falta construir esa capacidad de cero (solo faltaba que completara la columna `moneda`, fix de mig 379). **Reconfirmado con verificación e2e real 2026-09-04** (ver "Alcance real" abajo) |
| G1 (técnica) | 🟡 **Pendiente de respuesta de Fede.** ¿Existe/hace falta un modo dashboard "real" que mezcle ARS y USD sin convertir (no el toggle actual, que los excluye mutuamente)? Verificado 2026-09-04 contra el código real (`DashboardPage.tsx`, `DashVentasArea.tsx`, `DashGastosArea.tsx`, `FilterBar.tsx`): **HOY no existe** — solo un toggle ARS/USD mutuamente excluyente. Sería una tercera opción nueva a construir si Fede lo confirma. Mensaje reenviado a GO 2026-09-04 para pasarle a Fede junto con la aclaración de a qué se refiere "solo dólar oficial de Banco Nación" (¿widget general de cotización o Fase 8/AFIP, C2 arriba?) |

### Alcance real (Fases 1-3, ya construidas)

**Fase 1** (mig 379): `gastos`/`gastos_fijos`/`ordenes_compra` ganan `moneda`/`cotizacion_usd`, mismo
patrón que `ventas.cotizacion_usd` de G5; fix de la columna `moneda` en el INSERT a `caja_movimientos`
de `registrar_pago_oc()`. **Fase 2** (mig 380): `tenants.compras_cotizacion_roles_permitidos` — permiso
de quién puede cargar la cotización manual (DUEÑO siempre + roles adicionales configurables). **Fase 3**
(mig 381): `cotizacion_usd` se mueve de columna única a `caja_movimientos.cotizacion_usd` (una fila por
pago, no aguanta más de un pago con descalce por columna única); `registrar_pago_oc()` gana
`p_cotizacion_usd` y convierte server-side; wiring completo del modal de pago de OC en `GastosPage.tsx`
(exige cotización si hay descalce, avisa si se aleja ≥20% de la referencia). **Sin plan de fases fijo
detallado de antemano** (a diferencia de las 8 fases de G5): se decidió iterar, se estima el plan
completo en ~4-5 fases totales. **✅ EN PROD desde el 2026-08-27** (PR #334, merge commit `867d651a`),
DORMIDA (ver arriba).

**✅ 2026-09-04: verificado con un test e2e real de punta a punta**, no solo revisión estática de código.
Hasta esa sesión, ningún tenant (DEV ni PROD) tenía un método de pago "Efectivo USD" real, así que el
camino nunca se había ejercitado con datos reales. Se sembró un fixture en DEV (tenant "Almacén Jorgito",
`3769b1db-10f4-46a6-bc7f-eb669307730d`: `metodos_pago` "Efectivo USD" nuevo; `cuenta_origen`/Caja USD/Caja
Fuerte USD ya existían) y se agregó `tests/e2e/140_compra_pago_oc_usd_mutante.spec.ts` (commit `8deb6a13`):
paga una OC en USD por UI y confirma la mutación DIRECTO en la base (`caja_movimientos.tipo='egreso'`/
`moneda='USD'` correctos, `cotizacion_usd=null`; `ordenes_compra.estado_pago='pagada'`,
`monto_pagado=100.00`).

Falta: Gastos sueltos con UI de moneda propia, sugerir última cotización por proveedor (B3), confirmar
C2/C3 con GO, reportes G1/G2 (ARS/USD) — este último a la espera de que Fede confirme si además quiere el
modo dashboard "real" (fila G1 de la tabla arriba). Detalle completo: [[wiki/features/gastos]] →
"Compras/Gastos en USD + tasa de cambio editable".

---

## Módulo: Supervisión — retrofit a más módulos (relevado 2026-08-20)

> Relevamiento `relevamiento-supervision-retrofit-reglas-negocio.html` (raíz del repo), continuación de
> `relevamiento_supervisor_tab_respuestas.md` (esa ya cerró "sí, construir el patrón" — este responde "a
> qué módulos y con qué alcance"). **Respondido por Fede 2026-08-20, 100% CERRADO.** Detalle técnico
> completo, incluido el bloqueante técnico común y el estado real: [[wiki/features/supervision]] →
> "Retrofit a más módulos".

### Decisiones cerradas

| # | Módulo | Decisión |
|---|---|---|
| — | Ventas | Solo "anular venta despachada" pasa a cola de aprobación de Supervisión. Regla nueva: si la venta ya fue facturada, primero hay que emitir NC antes de poder eliminarla |
| — | Caja | Sigue con clave maestra síncrona — **nunca** pasa a cola de aprobación asincrónica |
| — | Productos | `kit_precio`/`repricing_margen` (hoy en el tab de Inventario) se reclasifican a `modulo='productos'` |
| — | Clientes / Envíos / Proveedores / Pedidos / RRHH | 2 niveles: eliminaciones delegables a supervisores vía el patrón; un puñado de acciones más sensibles quedan solo-Dueño |

**Bloqueante técnico común**: `productos`, `envios`, `proveedores`, `pedidos` y `recursos` no están hoy en
la lista `MODULOS` de `UsuariosPage.tsx` — hay que sumarlos antes de delegar nada de esos módulos. **✅
2026-08-31 (mig 386, APLICADA Y VERIFICADA EN DEV, `v1.188.0`): el CHECK `autorizaciones.modulo` (antes fijo
a `'inventario'`, mig 347) ya admite los 7 módulos** y se eliminó el CHECK rígido de `tipo` — prerequisito
de schema despejado, sin código de UI/negocio para ningún módulo nuevo todavía (A4/C1 quedan como fases
dedicadas futuras, más grandes de lo que parecían al relevar). **Orden de fases: a criterio de GO, sin
definir.** Detalle: [[wiki/features/supervision]] → "Retrofit a más módulos".

---

## UAT — Casos de prueba documentados

> Fuente: `docs/uat.md` — Actualizado 2026-04-17

| ID | Módulo | Caso | Estado |
|----|--------|------|--------|
| UAT-INV-01 | Inventario | Eliminar LPN actualiza stock_actual en ProductosPage | ✅ Fix + E2E |
| UAT-INV-02 | Inventario | Rebaje masivo descuenta stock correctamente | ✅ Fix + E2E |
| UAT-INV-03 | Inventario | Rebaje masivo respeta `cantidad_reservada` | ✅ Fix (manual) |
| UAT-GAS-01 | Gastos | Formulario abre sin medio de pago pre-seleccionado | ✅ Fix + E2E |
| UAT-GAS-02 | Gastos | Gasto sin medio de pago guarda con `medio_pago=null` | ✅ Fix + E2E |
| UAT-CFG-01 | Config | No se puede eliminar ubicación con inventario activo | ✅ Fix + E2E |
| UAT-CFG-02 | Config | Eliminar ubicación sin stock desvincula referencias | ✅ Fix (manual) |
| UAT-CFG-03 | Config | Eliminar ubicación libre: confirmación simple | ✅ Fix (manual) |
| UAT-CLI-01 | Clientes | Plantilla descargada incluye columna DNI | ✅ Fix + E2E |
| UAT-CLI-02 | Clientes | Importar archivo con DNI funciona correctamente | ✅ Fix (manual) |
| UAT-CLI-03 | Clientes | Importar sin DNI → `dni=null` (retrocompatibilidad) | ✅ Fix (manual) |

### Usuarios de prueba DEV

| Rol | Email | Contraseña |
|-----|-------|-----------|
| OWNER | `e2e@genesis360.test` | en `.env.test.local` |
| CAJERO | `cajero1@local.com` | `123` |
| RRHH | `rrhh1@local.com` | `123` |
| SUPERVISOR | `supervisor@test.com` | `1234` |

---

## Pendientes de relevar

- Módulo: RRHH (detalle completo)
- Devoluciones: ¿se puede re-abrir una venta despachada?
- Ventas: ¿hay límite de ítems por venta?
- Clientes: ¿límite de deuda por cliente configurable?
- Clientes: ¿notificación al cliente cuando se registra su deuda?
- Compras / OC: derivadas con reembolso, recepciones over-receipt, contactos proveedor
- Envíos: reglas pendientes (más allá de lo implementado)

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/gastos]]
- [[wiki/features/recursos]]
- [[wiki/features/rrhh]]
- [[wiki/development/testing]]
