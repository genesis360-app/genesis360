---
title: Devoluciones
category: features
tags: [devoluciones, stock, nota-credito, caja, serializado]
sources: [CLAUDE.md]
updated: 2026-06-16
---

# Devoluciones

Módulo de devoluciones de ventas. Implementado en v0.58.0 (migration 030).

---

## Marco legal (Argentina) — base de la política de devoluciones

> ⚠️ **Información general, NO asesoramiento legal.** Ley Nacional **24.240** (Defensa del Consumidor) + ley local **CABA 3281**. Puede cambiar con reformas y **varía por provincia**. Validar la política oficial con abogado/contador. Investigado 2026-06-26 (ver [log.md](../../log.md)).

**Regla de fondo: hay 3 casos donde el cliente tiene derecho a la PLATA (no se le puede forzar el crédito/vale), y uno donde el crédito es válido.**

| Caso | ¿Obligación de devolver dinero? | Plazo |
|---|---|---|
| **Producto fallado** (garantía legal, Art. 11-17) | **SÍ** — puede exigir el reintegro del importe pagado (Art. 17) si no se repara bien | **6 meses** (3 si usado) desde la entrega |
| **Compra online/a distancia** — arrepentimiento (Art. 34) | **SÍ** — reintegro del dinero; flete de devolución a cargo del vendedor | **10 días corridos** desde la entrega |
| **Cambio de opinión, presencial (fuera de CABA)** | **NO** hay obligación nacional → aceptar es política propia; puede condicionarse a crédito/cambio | Sin plazo legal |
| **Cambio de opinión, presencial EN CABA** (no perecederos, Ley 3281) | Debe aceptar el cambio, **pero puede dar vale O efectivo a elección del comercio** | Cambio **30 días hábiles** · vale válido **≥90 días hábiles** |

**Implicancia para el "crédito a favor":** si la devolución es por **fallado** o **arrepentimiento online ≤10 días**, aunque el cliente "elija" crédito conserva el derecho a la plata dentro del plazo. Si es **cambio de opinión presencial**, el crédito a favor / cambio es válido (en CABA el vale es expresamente legal).

**Recomendaciones (a confirmar con abogado):**
1. **Clasificar el motivo** (el modal ya guarda "motivo"): para **fallado / online ≤10 días** el **default debe ser DINERO** (mismo medio de pago), no empujar el crédito.
2. **Documentar la libre elección** cuando el cliente opta por crédito sin estar obligado (origen + nota + conformidad).
3. **Vencimiento del crédito:** si se aplica, **≥90 días hábiles** (piso CABA) y comunicado; plazos cortos pueden caer como cláusula abusiva (Art. 37). Lo más seguro: **sin vencimiento** o plazo amplio avisado.
4. **Política de devoluciones escrita y visible** (cartel/web/ticket), revisada por el abogado, distinguiendo los casos.
5. **Cubrir el reclamo posterior:** si el crédito nació de un caso donde correspondía dinero y el cliente después reclama la plata, hay que poder devolvérsela **asentada** → feature **cash-out de saldo a favor** (egreso de caja + `cliente_creditos` negativo atómico).

**Fuentes:** [Ley 24.240 actualizada](https://www.argentina.gob.ar/normativa/nacional/ley-24240-638/actualizacion) · [Ley 3281 CABA](http://www2.cedom.gov.ar/es/legislacion/normas/leyes/ley3281.html) · [Mendoza: ¿obligación de cambios?](https://www.mendoza.gov.ar/prensa/defensa-del-consumidor-es-obligacion-del-comercio-admitir-cambios-o-devoluciones-de-productos/) · [Mendoza: plazo de garantía](https://www.mendoza.gov.ar/prensa/defensa-del-consumidor-cual-es-el-plazo-de-garantia-de-un-producto-nuevo/) · [Argentina.gob.ar: Voy de compras](https://www.argentina.gob.ar/justicia/derechofacil/aplicalaley/comprar).

---

## Prerequisito de configuración

Antes de usar devoluciones, configurar en ConfigPage:
1. **Ubicación DEV** (`ubicaciones.es_devolucion = true`) — solo 1 por tenant
2. **Estado DEV** (`estados_inventario.es_devolucion = true`) — solo 1 activo a la vez

Sin esta configuración, la lógica bloquea con error descriptivo.

---

## Acceso

Botón **"Devolver"** en el modal de detalle de una venta.  
Disponible para ventas en estado `despachada` o `facturada`.

---

## Reglas de devolución (v1.76.0 — auditoría UAT básico)

### Tope de cantidad (DEV-07)
No se puede devolver más de lo que queda: el cap es **`vendido − ya_devuelto`** por producto (no la cantidad vendida total). En el modal (`abrir`) se calcula el remanente a partir de las devoluciones previas de esa venta; si ya se devolvió todo → "nada para devolver". Hay además un **guard server-side** en `procesarDevolucion` que re-chequea contra `devolucion_items` previos (defensa ante UI desactualizada).

### Devolución vs. deuda CC del cliente (DEV-04)
Regla GO: **a un cliente con deuda no se le da efectivo.**
- Cliente **con deuda CC** → la devolución se **aplica a reducir la deuda** (FIFO sobre sus ventas CC pendientes, sin movimiento de caja). Un banner avisa "se aplicarán $X a la deuda". Si la devolución supera la deuda, el **excedente** se devuelve por el medio elegido.
- Cliente **sin deuda** → se devuelve por efectivo / otro medio / **crédito a favor** (a elección). "Crédito a favor" genera un saldo en `cliente_creditos` (origen `devolucion`) y exige cliente.

### Efectivo y caja
- El egreso de efectivo de la devolución va **`await`eado + toast si falla** + fallback a la única caja abierta (bug #26, v1.74.0).
- **No se permite caja en negativo (CAJ-18, v1.76.0):** si el efectivo a devolver supera el saldo de la sesión, se bloquea ("hacé un ingreso a la caja o devolvé por otro medio/crédito a favor"). Helper `src/lib/cajaSaldo.ts`.

### Modo básico
El reingreso es **directo** (sin ubicación/estado — `ubicacion_id`/`estado_id` NULL) y **consolida** en la línea de stock existente del producto. La ubicación/estado `es_devolucion` solo se exige en modo avanzado.

---

## Flujo de devolución

**Puntos de entrada:** historial de Ventas (botón Devolver) y, desde v1.52.0, el módulo **Envíos** — un envío en estado `devolucion` muestra el CTA "Registrar devolución de la venta" que abre este flujo pre-apuntado (`/ventas?id=<venta>&devolver=1`). Ver [[wiki/features/envios]].

### Stock no serializado

1. Crea nueva `inventario_lineas` con destino según selección del operador (ver "Destino del stock devuelto" abajo)
2. `notas = "Devolución de venta #N"` (o `"Devolución de LPN {lpn_original}"`)
3. Trigger recalcula `stock_actual` automáticamente
4. Registra movimiento tipo `ingreso`

### A7 — Destino del stock devuelto (2026-05-29)

El modal de devolución tiene un radio con 2 opciones (default **DEV**):

- **Dejar en DEV para revisión** (default): la línea va a `ubicacion_id = ubicDevId` con `estado_id = estadoDevId`. Queda excluida de venta hasta decisión manual. Es el flujo previo.
- **Reintegrar a stock vendible**: la línea queda con `ubicacion_id = NULL` y `estado_id = primer estados_inventario.es_disponible_venta = true`. Entra al stock disponible inmediatamente; aparece en la alerta "Inventario sin ubicación" para que el operador la asigne a la ubicación correcta.

No aplica a items serializados — esos siempre reactivan a su línea original (mantienen ubicación y estado previos al despacho).

### Stock serializado

1. Reactiva las series originales: `activo=true, reservado=false`
2. Reactiva su línea (`inventario_lineas`)
3. Recalcula `stock_actual` manualmente (+cantDev)

### Nota de Crédito

- Si origen = `facturada` → `numero_nc = "NC-{venta.numero}-{n}"` (n = count previas + 1) — esto es el **ticket interno NO fiscal** (comprobante de ajuste).
- Si origen = `despachada` → sin NC
- **NC electrónica AFIP: ✅ desde v1.71.0** (Devolver → botón "Emitir NC" en el detalle → CAE; no hay NC manual). **PDF / imprimir / email de la NC fiscal desde v1.72.0** — ESO es lo que se le entrega legalmente al cliente, NO el ticket interno. La **letra de la NC se deriva de la factura original y queda fija** (Factura C→NC-C; antes defaulteaba a NC-B y rebotaba con AFIP 10040). Datos en `devoluciones.nc_*`; PDF vía `facturasPDF.ts` con `clase:'nota_credito'`. Ver [[project_afip_produccion]].

### Caja

- Efectivo en `medio_pago` de la devolución → INSERT `egreso` en `caja_movimientos`. **v1.74.0:** el insert se **aguarda** + fallback a la **única caja abierta** + aviso si falla (antes era fire-and-forget y un fallo perdía el egreso en silencio — bug venta #26). Ver [[caja]] (auditoría efectivo↔caja).
- Otro medio → `egreso_informativo`
- Bloquea si no hay sesión de caja abierta y el medio es efectivo

---

## Schema (migration 030)

```sql
devoluciones(
  id, tenant_id, venta_id,
  numero_nc TEXT,
  origen TEXT,        -- 'despachada' | 'facturada'
  motivo TEXT,
  monto_total DECIMAL,
  medio_pago TEXT,    -- JSON [{tipo, monto}]
  created_by
)

devolucion_items(
  devolucion_id, producto_id, cantidad, precio_unitario,
  inventario_linea_nueva_id  -- nullable, para no-serializado
)
```

---

## UI

- **Modal de devolución** desde el detalle de venta:
  - Selección de series (chips) o cantidad (input) por ítem
  - Motivo de devolución
  - Medios de devolución (efectivo, transferencia, etc.)
- **Comprobante imprimible** al finalizar
- **Sección colapsable "Devoluciones (n)"** en el modal si ya existen devoluciones previas

### Estado `devuelta`

Al finalizar `procesarDevolucion`:
- Suma todas las devoluciones de la venta
- Si `totalDevuelto >= venta.total` → `UPDATE ventas SET estado='devuelta'`
- Badge naranja "Devuelta" en historial
- Botón "Devolver" ya no aparece

### Rollback de seguridad

Si cualquier operación falla después del INSERT del header `devoluciones`:
- DELETE automático del header para evitar registros huérfanos con 0 ítems

---

## Notas de Crédito electrónicas (✅ implementado)

Para ventas facturadas con AFIP, la devolución habilita la NC electrónica. **Tabla `devoluciones` ya extendida (mig 088):** `nc_cae`, `nc_vencimiento_cae`, `nc_numero_comprobante`, `nc_tipo` (`NC-A/B/C`), `nc_punto_venta`. Flujo: Devolver → "Emitir NC" → EF `emitir-factura` (esNC, con `CbtesAsoc` a la factura original) → CAE. **PDF/imprimir/email desde v1.72.0.** Detalle en [[project_afip_produccion]].

---

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/caja]]
