---
name: relevamiento_ventas_respuestas
description: Respuestas consolidadas del relevamiento de reglas de negocio del módulo Ventas (GO + socio). Origen del backlog de implementación.
type: project
status: WIP — A-D respondidas (2026-05-28), E-L pendientes
source: relevamiento-ventas-reglas-negocio.html
updated: 2026-05-28
---

# Respuestas — Relevamiento Reglas de Negocio · Ventas

> **Estado:** respondidas secciones **A (Devoluciones)**, **B (Re-apertura/edición)**, **C (Límites)** y **D (CC clientes)**.
> Faltan secciones **E (Reservas)**, **F (Presupuestos)**, **G (Listas de precios)**, **H (Edición POS)**, **I (Canales)**, **J (Auditoría)**, **K (Reportes)** y **L (Top 3 prioridad)**.
> Las preguntas marcadas como ⚠ requieren confirmación final de GO antes de mover a backlog firme.

---

## A. Devoluciones

| # | Respuesta | Resumen para implementación |
|---|---|---|
| A1 | **D** | Plazo legal Defensa del Consumidor (10 días corridos) + extensión configurable por tenant en Config → Ventas. Nuevo: `tenants.devolucion_plazo_extension_dias INT` (default 0 = solo legal). Bloquear devolución si pasa el plazo, override DUEÑO. |
| A2 | **C** | Mantener parcial, pero los ítems que recibieron descuento global se devuelven enteros (no fraccionados). UI: si `descuento_global > 0`, el spinner de cantidad del ítem queda fijo en su cantidad original. |
| A3 | **A** | Cualquier rol con acceso a Ventas (como hoy). Sin cambios. |
| A4 | **C + texto libre opcional** | Catálogo cerrado (Falla / Cambio de talle / Arrepentimiento / Garantía / Otro) + observación libre **opcional** (no obligatoria). Seed catálogo por tenant; editable en Config → Ventas. |
| A5 | **A reforzado** | El operador elige el medio para el reintegro **+ selecciona la cuenta de origen** desde donde sale el dinero. Aclaración GO: "los medios de pago son solo para ventas; para devoluciones lo que importa es la cuenta de origen". Implementación: ya está el decoupling (mig 137); reusar `cuenta_origen_id` en el flujo de devolución. |
| A6 | **A** | Mantener bloqueo de devolución en efectivo si la caja está cerrada. Sin cambios. |
| A7 | **B con DEV default** | ✅ **Implementado v1.10.4 (PROD)** — radio "Dejar en DEV" / "Reintegrar a stock vendible" en modal de devolución, default DEV. Vendible: línea sin ubicación + `estado_id = primer es_disponible_venta` (aparece en alerta "Inventario sin ubicación"). Solo aplica a items no serializados. |
| A8 | **A** | Series devueltas re-activan en la línea original. Sin cambios. |
| A9 | **B** | PDF + email automático al cliente al confirmar la devolución (si el cliente tiene email cargado). |
| A10 | **A** ⚠ | NC electrónica AFIP automática al confirmar devolución de venta facturada. **Ver recomendación abajo** (manejo de error AFIP). |
| A11 | **C + A** | Devolución sin ticket: permitir buscando por DNI del cliente; si no hay match, no se acepta (no devolución "huérfana"). |
| A12 | **A** | Múltiples devoluciones sobre la misma venta sin límite. Sin cambios. |

---

## B. Re-apertura y edición post-venta

| # | Respuesta | Resumen |
|---|---|---|
| B1 | **A** | No permitir re-abrir venta despachada — siempre devolución + nueva venta. Sin cambios. |
| B2 | **A** | No permitir cambiar el cliente de una venta despachada — queda con el cliente original. |
| B3 | **(pendiente — recomendación abajo)** ⚠ | GO pide recomendación entre A/B/C/D. |
| B4 | **B** | Cambio de medio de pago retroactivo: solo si la sesión de caja sigue abierta, con clave maestra del DUEÑO. Audit log obligatorio. |
| B5 | **B** | Agregar botón **"Anular venta"** que hace devolución total automática con motivo "Anulación". UX: 1 click vs flujo de devolución manual. |
| B6 | **A** ⚠ | Mantener bloqueo total por cierre contable, solo nota de corrección. **Ver análisis abajo** (¿hay algo contraproducente?). |

---

## C. Límites y restricciones de venta

| # | Respuesta | Resumen |
|---|---|---|
| C1 | **A** | Sin límite de ítems por venta. Sin cambios. |
| C2 | **A** | Sin límite de monto por venta. Sin autorización adicional. |
| C3 | **A extendida** | ⚠ **Parcialmente en PROD v1.10.4** — bloqueo CAJERO ya implementado (inputs `disabled` en POS). Pendiente del mismo C3 (feature mayor): descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR. |
| C4 | **D primero + C segundo** | Solo permitir venta bajo costo si el descuento global compensa (margen total ≥ 0); si margen total negativo, bloquear salvo autorización SUPERVISOR+. UX: alerta + bloqueo según contexto. |
| C5 | **D refinada** | Configurable por tenant en Config → Ventas (default OFF). **Aclaración GO**: stock negativo **solo en estados Reservar/Presupuestar**, **nunca en Venta Directa** ni en Despachar (incluso si la reserva está 100% pagada). Implementación: flag `tenants.permitir_reserva_sin_stock BOOLEAN` + bloqueo duro en despacho. |
| C6 | **B** | Flag por producto `requiere_validacion` que pide DNI/edad/receta antes de agregar al carrito. Nuevo en `productos`. |

---

## D. Cuenta corriente de clientes

| # | Respuesta | Resumen |
|---|---|---|
| D1 | **B con doble nivel** | `clientes.limite_cc DECIMAL` (NULL = sin límite). Bloqueo si la deuda supera el límite. **2 niveles de configuración**: (1) límite por cliente en `clientes.limite_cc` y (2) límite general del negocio en `tenants.limite_cc_default`. **Precedencia**: cliente > tenant > sin límite. |
| D2 | **C** | Vencimiento por venta + interés mensual configurable sobre saldo vencido. Nuevo: `tenants.cc_dias_vencimiento INT`, `tenants.cc_interes_mensual_pct DECIMAL`, `ventas.fecha_vencimiento_cc DATE`. Job nocturno recalcula intereses. |
| D3 | **E** | Configurable por tenant: enviar solo mail / solo whatsapp / mail + whatsapp / nada al registrar deuda. `tenants.cc_notificacion_canales TEXT[]` (default `[]`). |
| D4 | **A + B** | Configuración general del tenant (default) **+ override por cliente** en su ficha. Permite políticas distintas según el cliente. |
| D5 | **A + B + C** | Combinar las 3: saldar desde ficha del cliente (como hoy) + desde POS como "Pago de deuda" + cobranza masiva (varias ventas en un pago). |
| D6 | **A default + D configurable** | Default: deudor con saldo vencido **no puede comprar en CC pero sí en efectivo/medio cobrado**. Configurable por tenant para activar bloqueo total (opción B) si quieren. `tenants.cc_morosidad_politica TEXT` (`bloqueo_cc_default` / `bloqueo_total`). |
| D7 | **(pendiente — recomendación abajo)** ⚠ | GO duda entre C y D. |
| D8 | **A** ⚠ | "A?" — GO inseguro. **Ver recomendación abajo**. |

---

## Preguntas abiertas — recomendaciones de Claude

### A10 — NC electrónica AFIP automática

Tu elección **A (auto al confirmar)** es la correcta contablemente. Riesgo único: si AFIP cae, bloquea la devolución y queda el cliente esperando. Mitigación recomendada:

- Si AFIP responde OK → marca NC con CAE y se entrega comprobante al cliente.
- Si AFIP falla (timeout/error) → la devolución se confirma de todas formas con NC interna, y queda un job/retry pendiente que reintenta cada N minutos. Notifica al DUEÑO/CONTADOR cuando logra emitir.

Implementación: cola `nc_afip_pendientes` (id, devolucion_id, intentos, ultimo_error, cae, emitida_at). Sin esta cola, una caída de AFIP frenaría a todo el sistema.

### B3 — Vincular factura tardía

Recomiendo **C (solo dentro del mismo mes contable, antes del cierre)**:

- **Por qué C**: AFIP cobra por período fiscal. Una factura emitida en otro mes que la venta original obliga a ajustes manuales del IVA y descalce contable. Genesis ya tiene cierre contable mensual (mig 135) que bloquea ediciones después del cierre — esta regla calza perfecto: "podés facturar tardío mientras el mes siga abierto, después no".
- **Por qué no A (sin restricción)**: te dejaría facturar en junio una venta de marzo → AFIP la cuenta en junio pero la venta vive en marzo → libro IVA desfasado.
- **Por qué no B (N días configurable)**: arbitrario, no se alinea con el ciclo fiscal. Si el plazo cae mid-mes, agregás complejidad sin beneficio.
- **Por qué no D (no permitir)**: caso real frecuente, sería frustrante decirle "rehacé la venta" cuando hay margen contable para resolverlo bien.

### B6 — Bloqueo por cierre contable (¿algo contraproducente?)

**A es lo correcto contablemente** y no hay riesgo real, pero hay 2 cosas a vigilar en UX:

1. **Fricción cuando el cajero/cliente piden corrección de un mes ya cerrado**. Mitigación: el modal de venta ya debería mostrar tooltip claro "Este período está cerrado el DD/MM. Para corregir, usá Nota de corrección" + botón directo al flujo de nota. Si no está, agregarlo.
2. **Devolución de venta de mes cerrado**: hoy la devolución genera registros nuevos (no toca la venta original), así que técnicamente funciona, pero el sistema podría malinterpretar el bloqueo. Verificar que el trigger `periodo_cerrado()` (mig 135) **no** bloquee INSERTs en `devoluciones` cuando la venta padre cae en período cerrado.

Salvo eso, A es estándar contable. La "Nota de corrección" ya implementada cubre todos los casos legítimos.

### D7 — Incobrables

Recomiendo **B + D combinadas**:

- Botón **"Dar de baja como incobrable"** en ficha del cliente.
- **Requiere clave maestra del DUEÑO** (no SUPERVISOR — es decisión patrimonial, no operativa).
- Al confirmar: genera **gasto automático "Deudores incobrables"** con monto = deuda dada de baja, categoría reservada, sucursal del cliente. Saldo CC del cliente queda en 0.
- Audit log + reporte mensual de incobrables para el CONTADOR.

**Por qué no solo C (marca + reporte sin gasto)**: contablemente perdés la pérdida — el saldo CC queda como activo eterno aunque no se vaya a cobrar. Estados financieros distorsionados.
**Por qué no solo B sin D**: cualquier supervisor podría "lavar" deudas reales. Necesitás trazabilidad fuerte.

### D8 — Tope de deuda global

Si **dudás**, andate por **A (no es necesario)** ahora. Razones:

- Para PYME, el DUEÑO sabe de memoria su exposición de CC; el alert automático suma poco valor.
- Implementarlo bien requiere job nocturno + canal de notificación + UI de umbral en Config — costo alto vs beneficio chico.
- Si más adelante crece la CC y querés activarlo, **B (umbral fijo)** > **C (% facturación)**: B es predecible, C requiere proyección de facturación y depende del mes.

**Recomendación final D8**: A por ahora. Lo dejamos en backlog y si en 3-6 meses el volumen de CC pega un salto, pasamos a B.

---

## Decisiones de impacto técnico (preview backlog)

Cambios estructurales que van a salir de lo respondido:

1. **Migrations nuevas**:
   - `tenants.devolucion_plazo_extension_dias INT` (A1)
   - Tabla `motivos_devolucion` (catálogo + seed) o `tenants.motivos_devolucion_extras JSONB` (A4)
   - `tenants.permitir_reserva_sin_stock BOOLEAN` (C5)
   - `productos.requiere_validacion BOOLEAN` (C6)
   - `clientes.limite_cc DECIMAL` + `tenants.limite_cc_default DECIMAL` (D1)
   - `tenants.cc_dias_vencimiento INT` + `tenants.cc_interes_mensual_pct` + `ventas.fecha_vencimiento_cc DATE` (D2)
   - `tenants.cc_notificacion_canales TEXT[]` (D3)
   - `clientes.cc_notificacion_override` (D4)
   - `tenants.cc_morosidad_politica TEXT` (D6)
   - Cola `nc_afip_pendientes` (A10)
   - Tabla descuentos por medio de pago (C3)

2. **Cambios UI grandes**:
   - Devolución: catálogo motivos + radio reintegro stock + selector cuenta_origen + email auto.
   - POS: bloqueo total de inputs de descuento para CAJERO + validación stock-negativo por estado.
   - Cliente ficha: campo `limite_cc` + override notificaciones + botón "Dar de baja incobrable".
   - Anular venta: botón nuevo en detalle de venta despachada.

3. **Jobs nuevos**:
   - Cálculo de intereses CC nocturno (D2c).
   - Notificación vencimiento CC (depende de D4 = pendiente sección posterior).
   - Retry NC AFIP fallidas (A10).
