---
name: relevamiento_ventas_respuestas
description: Respuestas consolidadas del relevamiento de reglas de negocio del módulo Ventas (GO + socio). Origen del backlog de implementación.
type: project
status: WIP — A-G respondidas (E-G: 2026-05-31), H-L pendientes
source: relevamiento-ventas-reglas-negocio.html
updated: 2026-05-31
---

# Respuestas — Relevamiento Reglas de Negocio · Ventas

> **Estado:** respondidas secciones **A (Devoluciones)**, **B (Re-apertura/edición)**, **C (Límites)**, **D (CC clientes)**, **E (Reservas)**, **F (Presupuestos)** y **G (Listas de precios)**.
> Faltan secciones **H (Edición POS)**, **I (Canales)**, **J (Auditoría)**, **K (Reportes)** y **L (Top 3 prioridad)**.
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

## E. Reservas

| # | Respuesta | Resumen para implementación |
|---|---|---|
| E1 | **C configurable (default sin vencimiento)** | Vencimiento de reserva configurable por tenant en Config → Ventas: **(1) seña mínima** (ver E6) + **(2) X días de vencimiento**. Al vencer → **liberación automática del stock** (aclararlo explícito en el texto de config: "pasados N días sin despachar, el inventario reservado se libera"). **Default: "Sin vencimiento"**. Regla dura ligada a E6: **sin seña NO se puede crear reserva**. Nuevos: `tenants.reserva_vencimiento_dias INT` (NULL/0 = sin vencimiento), job nocturno que libera reservas vencidas + notifica. |
| E2 | **D + B** | Al cancelar reserva con seña: **el operador elige** entre devolución total o convertir la seña en **crédito en cuenta** del cliente (D), **y** puede aplicar **penalidad configurable en %** reteniendo parte de la seña (B). Nuevos: `tenants.reserva_penalidad_pct DECIMAL` (default 0). El destino (efectivo vs crédito) lo decide el operador en el modal de cancelación. |
| E3 | **C con observación opcional** | Catálogo cerrado de motivos (Cliente arrepentido / Producto roto / Stock perdido / Otro) + observación libre **opcional** (no obligatoria). Reusar el patrón de catálogo de A4. |
| E4 | **C** | Solo **DUEÑO/SUPERVISOR** pueden cancelar una reserva **con seña pagada** (para decidir si penalizar o no); si la reserva **no tiene seña**, la puede cancelar **el creador**. Gate por rol + estado de seña. |
| E5 | **A** | Mantener flujo actual: "Modificar reserva" cancela + recrea pre-poblando el carrito. **Sin cambios.** |
| E6 | **B (en porcentaje)** | Exigir **seña mínima configurable en %** del total (ej: 30%). Ligado a E1: sin seña no hay reserva. Nuevo: `tenants.reserva_sena_minima_pct DECIMAL`. Valida en el flujo de creación de reserva. |

---

## F. Presupuestos

| # | Respuesta | Resumen para implementación |
|---|---|---|
| F1 | **B + botón "Actualizar presupuesto"** | Vencimiento **configurable por tenant** en Config → Ventas (7/15/30 días). Botón **"Actualizar presupuesto"** que **recrea el presupuesto con precios actuales** y **resetea el contador de vencimiento** desde la fecha de actualización. Nuevo: `tenants.presupuesto_vencimiento_dias INT`. |
| F2 | **Configurable (3 modos)** | Nuevo selector en Config → Ventas para la política de conversión presupuesto → venta: **(1) "Mantener si está dentro del plazo, recotiza si venció" (default = opción A actual)**, **(2) "Mantener siempre"**, **(3) "Siempre recotiza"**. Nuevo: `tenants.presupuesto_conversion_politica TEXT` (`mantener_en_plazo` / `mantener_siempre` / `siempre_recotiza`). |
| F3 | **A + C** | Cualquier rol con acceso a Ventas puede convertir, **pero solo dentro de la misma sucursal** donde se creó el presupuesto. Gate por `sucursal_id`. |
| F4 | **D** | PDF + email automático + link WhatsApp, **todo configurable** por tenant. Reusar infra de email (A9 devoluciones) y patrón de links públicos (`VITE_APP_URL`). |
| F5 | **B + C** | Numeración **independiente con prefijo** (ej: `PRES-001`) **y por sucursal**. Nuevo correlativo propio (no comparte con `ventas.numero`); trigger análogo a `set_venta_numero` por sucursal. |

---

## G. Listas de precios / Mayorista / B2B

| # | Respuesta | Resumen para implementación |
|---|---|---|
| G1 | **B + umbral configurable** ⚠ | 2 listas (Minorista / Mayorista). El precio mayorista se activa **a partir de X (monto/cantidad) configurable**. **Ver tensión con G2 abajo.** |
| G2 | **Por cantidad de unidades por producto, NO por cliente** ⚠ | La distinción mayorista/minorista se decide **automáticamente por la cantidad de unidades compradas de cada producto** en la línea de venta — **no** es un flag por cliente. Combina con G1: en vez de asignar lista al cliente, el sistema aplica precio mayorista cuando la cantidad de esa línea supera el umbral del producto/tenant. **Ver recomendación abajo.** |
| G3 | **A con límite de % por rol** | Sin edición libre de precio: **solo descuento por %**. El descuento lo aplica **solo DUEÑO / SUPERVISOR / ADMIN** (nadie más), según una **regla de límite de % máximo de descuento por ROL**. Al CAJERO le aparece **solo el descuento ya autorizado si cumple las condiciones** configuradas en Config → Ventas → Descuentos. **Liga directo con C3** (descuentos por medio de pago + umbral). |
| G4 | **B** | Precio de **costo y margen visibles solo para DUEÑO / SUPERVISOR / ADMIN / CONTADOR**; **ocultos para CAJERO / DEPOSITO** en POS/Productos. Gate por rol en UI. |
| G5 | **D (3 opciones configurables)** | Producto puede tener precio en USD + flag configurable: **"Vender en moneda local"** (convierte en POS al cargar) **o "Vender en USD"** (caja USD). Reusar cotización USD existente (combos) y moneda por caja. Nuevos: `productos.precio_usd DECIMAL`, `productos.moneda_venta TEXT`. |

---

## H-K. Respuestas finales (relevadas 2026-06-01)

### H. Edición y permisos en el POS
| # | Respuesta | Resumen para implementación |
|---|---|---|
| H1 | **(b) + autorización + NC interna** | Quitar/editar ítem: **libre antes de cobrar**. Una vez **cobrada**, requiere **autorización SUPERVISOR/DUEÑO**; y si la venta **se facturó**, genera **nota de crédito INTERNA/manual** (ajuste + motivo, sin emitir contra AFIP por ahora — la NC electrónica AFIP es feature aparte, ver L1). |
| H2 | **(b) ambas** | Imprimir ticket **opcional**: botón "Imprimir" + "Enviar por email" (las dos disponibles). |
| H3 | **(a)** | Reimprimir ticket de venta anterior: **cualquier rol con acceso a Ventas** desde el historial. |
| H4 | **Quitar excepción 100% CC** | **Presupuesto**: puede crearse **sin caja abierta**. **Reservas y venta directa (incluida 100% CC)**: **siempre exigen caja abierta**. ⚠ Revertir la lógica actual que permitía venta 100% CC sin caja. |
| H5 | **Flag consumidor final + (d)** | Al **iniciar la venta** (armar carrito) un flag **"Consumidor final"** vs **"Cliente registrado"**. Si el negocio tiene **facturación activa** y NO es consumidor final → **cliente obligatorio** (para poder facturar A/B/C). Se apoya en el Config existente **"Cliente en el punto de venta"**. |

### I. Canales de venta
| # | Respuesta | Resumen para implementación |
|---|---|---|
| I1 | **(c) sin MP** | Catálogo de canales **configurable por tenant** + **jerarquía/clasificación online vs presencial**. **Quitar "MP"** del catálogo de canales (es medio de pago, no canal). |
| I2 | **online vs presencial — las 4 reglas** | Reglas configurables distinto por clasificación **online/presencial**: **plazo de devolución**, **descuento máximo**, **lista de precios por defecto**, **requisito de cliente/factura**. |
| I3 | **(a)** | Numeración: **única (correlativo por sucursal)**, como hoy. Sin cambios. |
| I4 | **(a)** | Sync stock online: **stock real publicado, sin buffer**, como hoy. Sin cambios. |

### J. Auditoría y permisos
| # | Respuesta | Resumen para implementación |
|---|---|---|
| J1 | **(b)** | **Audit log detallado por venta** (diff de ítems, precios, cliente) accesible **desde el modal** de la venta. |
| J2 | **(b)** | Clave maestra del DUEÑO requerida además para: **anular venta despachada** + **cambiar cliente** + **override de descuento** (suma a lo existente: cierre caja ajena, corregir movimientos). |
| J3 | **(b) — recomendación Claude** | **CONTADOR**: acceso **read-only al historial completo** de ventas (filtros, detalle, export); **no crea ni edita**. (Los campos fiscales se fijan al emitir, no se editan a mano.) |

### K. Reportes y alertas
| # | Respuesta | Resumen para implementación |
|---|---|---|
| K1 | **b, c, d, e, f** | Reportes: **baja rotación** (b), **más devoluciones** (c), **anuladas/devueltas con motivo agrupado** (d), **comparativa por canal** (e), **margen real por venta** (f). (NO "top vendedores".) |
| K2 | **b, c, d** | Alertas: **margen negativo** (b), **cliente con >N devoluciones en M días** (c), **producto con >N devoluciones en M días** (d). Umbrales N/M configurables. |
| K3 | **(a)** | Exportaciones: **Excel + PDF + CSV** en cada reporte (consistente con Caja). |

> **L (Top 3 prioridad)**: pendiente de responder por GO. El plan propone un orden por dependencia/valor; reordenable según L1.

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

### G1 + G2 — Tensión a resolver antes de implementar ⚠

Hay un **choque entre G1 y G2** que hay que cerrar antes de pasar a backlog firme:

- **G1** dice "mayorista a partir de X **monto** configurable" (umbral sobre el total de la venta).
- **G2** dice "por **cantidad de unidades** compradas **por producto**, no por cliente" (umbral por línea, no por total).

Son dos disparadores distintos. Mi lectura: lo que querés es lo de **G2** (precio escalonado **por cantidad por producto**, automático, sin asignar lista al cliente). Eso en realidad corresponde a la opción **(d) de G1** (listas escalonadas por cantidad), no a la (b). El "monto" de G1 probablemente fue una forma de decir "umbral", pero el umbral real que describís es **cantidad de unidades de ese producto**.

**Recomendación**: modelar como **umbral de cantidad por producto** (cada producto define a partir de cuántas unidades aplica precio mayorista; opcionalmente un default a nivel tenant). No hace falta tabla de "listas N" ni flag por cliente:
- `productos.precio_mayorista DECIMAL` (NULL = no aplica)
- `productos.mayorista_cant_minima INT` (NULL = usa default tenant)
- `tenants.mayorista_cant_minima_default INT`
- El POS, al cargar una línea, si `cantidad >= cant_minima` → usa `precio_mayorista`.

**✅ CONFIRMADO por GO (2026-05-31)**: el disparador es **cantidad de unidades del producto**. **Desbloqueado para backlog firme.**

**⚠ HALLAZGO (2026-05-31): ya existe infraestructura parcial.** La tabla **`producto_precios_mayorista`** (tiers: `cantidad_minima` + `precio` + `descripcion`/etiqueta) **ya está implementada** y se edita en el form de producto (`ProductoFormPage` → accordion "Precios mayoristas", solo `canEdit`). Soporta **N tiers por producto** (mejor que los 2 niveles que pensábamos). **Lo que falta**: el **POS (`VentasPage`) NO aplica los tiers** — guarda los precios pero al vender no baja al precio mayorista según la cantidad de la línea. Por lo tanto G1/G2 se reduce a: **aplicar el tier correcto en el POS cuando `cantidad de la línea >= cantidad_minima`** (tomar el tier de mayor `cantidad_minima` que la cantidad satisfaga). No hace falta crear columnas nuevas ni default tenant; el modelo por-tier ya cubre el caso confirmado.

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
   - Tabla descuentos por medio de pago + límite % por rol (C3 + G3)
   - `tenants.reserva_vencimiento_dias INT` + `tenants.reserva_sena_minima_pct` + `tenants.reserva_penalidad_pct` (E1/E2/E6)
   - `tenants.presupuesto_vencimiento_dias INT` + `tenants.presupuesto_conversion_politica TEXT` (F1/F2)
   - Correlativo independiente de presupuestos por sucursal (F5)
   - `productos.precio_usd` + `productos.moneda_venta` (G5)
   - `productos.precio_mayorista` + `productos.mayorista_cant_minima` + `tenants.mayorista_cant_minima_default` (G1/G2 — pendiente confirmar disparador)

---

## Análisis — qué se puede avanzar YA (independiente de H-L)

Lo respondido en E/F/G **no depende** de las secciones pendientes (H edición POS, I canales, J auditoría, K reportes, L prioridad). Ordenado por relación esfuerzo/independencia:

**Quick wins (self-contained, bajo riesgo):**

1. **G4 — Ocultar costo/margen a CAJERO/DEPOSITO**. Puro gate por rol en UI (POS + Productos). No toca DB ni lógica de negocio. Es lo más rápido y seguro de hacer ahora. **Candidato #1 para arrancar.**
2. **E5 — Sin cambios** (flujo modificar reserva se mantiene). Cero trabajo, solo confirmar.
3. **F1 — Vencimiento presupuesto configurable + botón "Actualizar presupuesto"**. Una columna en `tenants` + reemplazar el plazo hardcoded + botón que recrea con precios actuales. Autocontenido.
4. **F5 — Numeración independiente de presupuestos** (`PRES-NNN` por sucursal). Migration + trigger análogo a `set_venta_numero`. Independiente.

**Medianos (autocontenidos pero más superficie):**

5. **E3 — Catálogo de motivos de cancelación de reserva** (reusa patrón A4). Independiente.
6. **F2 — Política de conversión presupuesto→venta configurable** (3 modos). Una columna + branch en el flujo de despacho de presupuesto.
7. **F4 — PDF presupuesto + email + WhatsApp configurable**. Reusa infra de email/links públicos.
8. **G5 — Precio USD por producto + flag moneda de venta**. Reusa cotización USD y moneda por caja.

**Grandes (mejor por fases, pero igual independientes de H-L):**

9. **E1/E2/E6 — Reservas con seña obligatoria + vencimiento + penalidad** (bloque coherente). Incluye job nocturno de liberación de stock. Es un lote: implementar junto.
10. **G3 + C3 — Descuentos por % con límite por rol**. C3 ya estaba marcado como feature mayor; G3 lo refina con el límite por rol. **Implementar C3 y G3 juntos.**
11. **G1/G2 — Precio mayorista por cantidad**. **Bloqueado** hasta confirmar el disparador (cantidad por producto vs monto total — ver tensión arriba). No avanzar hasta resolverlo.

**Sugerencia de arranque**: G4 (quick win inmediato) → F1 + F5 (presupuestos, autocontenidos) → bloque reservas E1/E2/E6 por fases. Dejar G1/G2 frenado hasta la confirmación.

---

## Estado de implementación (DEV — 2026-05-31)

| Ítem | Estado | Detalle |
|---|---|---|
| **G4** | ✅ Implementado | `src/lib/permisosCosto.ts` (`puedeVerCosto`). Costo/margen ocultos para CAJERO/DEPOSITO en `ProductosPage` (cards + panel + botón OC) y `ProductoFormPage` (precio costo + margen + margen objetivo + precio sugerido). POS no mostraba costo. |
| **F1** | ✅ Implementado | Ya existía config `presupuesto_validez_dias` + botón "Actualizar precios" (resetea contador vía `updated_at`). Agregado botón "Actualizar presupuesto" on-demand para presupuestos no vencidos en el detalle. |
| **F5** | ✅ Implementado | **Mig 159**. `ventas.presupuesto_numero` + `presupuesto_numero_sucursal`, trigger `gen_venta_numero` + backfill. `formatTicket` muestra `PRES-{cod}-NNNN`. |
| **E6** | ✅ Implementado | **Mig 160**. `tenants.reserva_sena_obligatoria` + `reserva_sena_minima_pct`. Validación en `registrarVenta` y en el saldoModal (conversión a reserva). Config UI en ConfigPage → Ventas → Operativa → Reservas. |
| **E1** | ✅ Implementado | **Mig 160**. `tenants.reserva_vencimiento_dias` (NULL=sin venc.) + `ventas.reservado_at`. Función `liberar_reservas_vencidas(tenant)` (libera stock + cancela, NO toca dinero, saltea período cerrado). Sweep lazy al entrar a Ventas. Config UI. |
| **E2** | ✅ Implementado | **Mig 160**. Cancelación: penalidad % (`reserva_penalidad_pct`) + destino devolución/crédito + gate E4 (DUEÑO/SUPERVISOR para reserva con seña). Tabla `cliente_creditos` (ledger saldo a favor). **Redención**: medio de pago "Crédito a favor" en el POS (cuenta como pagado, NO entra a caja, inserta consumo negativo) + validación contra saldo + badge "Saldo a favor" en ficha del cliente (`ClientesPage`). |
| **G1/G2** | ✅ Implementado | Sin migración (usa `producto_precios_mayorista`). POS: `tiersMayoristaMap` (query) + helper `precioTierEfectivo(item)` aplica el tier de mayor `cantidad_minima` que la cantidad de la línea satisfaga; cae a minorista si ninguno. Usado en `getItemSubtotal`, persistido en `venta_items.precio_unitario`. Indicador "Precio mayorista" en el carrito. |
| **E3** | ✅ Implementado | Sin migración. Catálogo cerrado `MOTIVOS_CANCELACION_RESERVA` (Cliente arrepentido / Producto roto / Stock perdido / Otro) + observación opcional en el modal de cancelación de reserva (toda cancelación de reserva pasa por el modal). Se guarda en `ventas.notas`. E4 gate ya estaba. |
| **G3** | ✅ Implementado | Sin migración. Sin edición libre de precio (ya estaba). Ahora **solo DUEÑO/SUPERVISOR/ADMIN** aplican descuentos (`ROLES_DESCUENTO`, antes solo se bloqueaba CAJERO): bloqueo de inputs en POS + validación dura en `registrarVenta` (ítem y global). SUPERVISOR limitado por `descuento_max_supervisor_pct` (ítem + global); DUEÑO/ADMIN sin tope. Config UI actualizada (campo CAJERO reemplazado por nota). |
| **G5** | ✅ Implementado | **Mig 161**. `productos.precio_usd` + `productos.moneda_venta` ('local' \| 'usd'). Form: select moneda + input USD + preview de conversión. POS: si `moneda_venta='usd'`, convierte a pesos a la cotización vigente al cargar al carrito (`precio_usd_origen` para el hint). **Nota**: venta física en USD / caja USD queda diferida (esta fase cubre precio-en-USD cobrado en pesos). |

> **Migrations**: 159 (presupuesto_numero), 160 (reservas seña/vencimiento/crédito), 161 (producto precio_usd + moneda_venta).
> **Relevamiento Ventas E/F/G — COMPLETO.** Único pendiente menor: venta física en USD con caja USD (fase futura, fuera del alcance original).

2. **Cambios UI grandes**:
   - Devolución: catálogo motivos + radio reintegro stock + selector cuenta_origen + email auto.
   - POS: bloqueo total de inputs de descuento para CAJERO + validación stock-negativo por estado.
   - Cliente ficha: campo `limite_cc` + override notificaciones + botón "Dar de baja incobrable".
   - Anular venta: botón nuevo en detalle de venta despachada.

3. **Jobs nuevos**:
   - Cálculo de intereses CC nocturno (D2c).
   - Notificación vencimiento CC (depende de D4 = pendiente sección posterior).
   - Retry NC AFIP fallidas (A10).
