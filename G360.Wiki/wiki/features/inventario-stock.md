---
title: Inventario y Stock
category: features
tags: [inventario, lpn, movimientos, fifo, fefo, stock, autorizaciones, conteos]
sources: [CLAUDE.md, reglas_negocio.md]
updated: 2026-06-03
---

# Inventario y Stock

El núcleo de Genesis360. Modelo **LPN (Location/Product/Lot Number)** para tracking granular.

**Página:** `src/pages/InventarioPage.tsx`  
**Modal principal:** `src/components/LpnAccionesModal.tsx`

---

## Modelo LPN

Toda unidad de stock es una `inventario_lineas` identificada por:
- **Location** — ubicación física (`ubicacion_id`)
- **Product** — el SKU (`producto_id`)
- **Lot** — el lote (`nro_lote`, `fecha_vencimiento`, `lpn` único por tenant)

> [!NOTE] Toda `inventario_lineas` debe tener LPN — nunca puede existir stock sin LPN. Si no se ingresa, se auto-genera.

---

## Tabs de InventarioPage (v0.75+)

1. **Inventario** — vista LPNs por producto o por ubicación
2. **Agregar stock** — ingreso unitario y masivo inline
3. **Quitar stock** — rebaje unitario y masivo
4. **Traslados** (v1.53.0, mig 205) — traslado formal entre sucursales con tránsito + confirmación del destino; ver [[wiki/features/multi-sucursal]] → "Traslados entre sucursales"
5. **Kits** — CRUD recetas, ejecutar kitting/des-kitting
6. **Conteos** — conteo por ubicación o producto con ajuste automático
7. **Historial** — movimientos con filtros fecha/cat/tipo/motivo (badge "Traslado" ámbar para tipo `traslado`)
8. **Autorizaciones** — aprobación de cambios solicitados por DEPOSITO

---

## Tipos de movimiento de stock

| Tipo | Descripción |
|------|-------------|
| `ingreso` | Entrada de mercadería |
| `rebaje` | Salida (venta, consumo) |
| `ajuste_ingreso` | Corrección positiva (conteo) |
| `ajuste_rebaje` | Corrección negativa (conteo) |
| `kitting` | Armado de KIT (reduce componentes, suma KIT) |
| `des_kitting` | Desarmado inverso |
| `traslado` | Referencia de mover LPN (no afecta stock neto) |

> [!NOTE] Stock actualizado **solo por triggers**. Nunca UPDATE manual de `stock_actual`.

---

## Reglas de selección (Rebaje)

Jerarquía: **SKU > negocio > FIFO (fallback hardcoded)**

| Regla | Criterio | Prioridad ubicación |
|-------|---------|---------------------|
| **FIFO** | Más antiguo primero | `ubicaciones.prioridad ASC` (sin ubicación = 999) |
| **FEFO** | Vence antes primero | Ignora prioridad; requiere `tiene_vencimiento=true` |
| **LEFO** | Vence último primero | Ignora prioridad; requiere `tiene_vencimiento=true` |
| **LIFO** | Más reciente primero | `ubicaciones.prioridad ASC` |
| **Manual** | Usuario elige el lote | FIFO como desempate cuando prioridades iguales |

Helper: `src/lib/rebajeSort.ts` → `getRebajeSort(reglaProducto, reglaTenant, tieneVencimiento)`

**Default en onboarding nuevo negocio:** Manual (v1.1.0)

---

## Filtros de líneas disponibles para venta

Una línea se excluye de ventas si:
- `disponible_surtido = false` en ubicación
- `es_disponible_venta = false` en estado del inventario
- `fecha_vencimiento < hoy` (LPN vencido)

---

## Masivo Agregar Stock — vista inline (v0.82.0)

Buscador + scanner en página, sin modal:
- Tabla editable: SKU / Cantidad / Estado / Ubicación / acordeón extras (lote, vencimiento, LPN, series)
- Flujo: escanear → foco Cantidad → Enter → vuelve al buscador
- Mismo SKU sin lote → suma cantidad en lugar de nueva fila
- Botón "Procesar N ingresos" al pie
- Cola secuencial de scans (mismo mecanismo que VentasPage)

---

## LPN Acciones (LpnAccionesModal)

Tabs del modal según estado:
- **Editar** — cambiar cantidad, estado, notas, LPN (si no hay reservas)
- **Mover** — a otra ubicación o sucursal (parcial o total)
- **Series** — gestión de números de serie individuales
- **Estructura** — asignar estructura WMS al LPN
- **Eliminar** — eliminar LPN (DEPOSITO requiere autorización)

Si `cantidad_reservada > 0`: solo se muestra tab Mover + banner naranja.

---

## Autorizaciones DEPOSITO (Sprint C · migrations 055+056)

DEPOSITO no puede ejecutar cambios directamente — quedan pendientes de aprobación:
- Cambio de cantidad de un LPN
- Eliminar un LPN
- Eliminar una serie
- Ajustes de conteo

**Tab Autorizaciones** (visible para OWNER/SUPERVISOR/ADMIN):
- Pills Pendientes / Aprobadas / Rechazadas
- Cards con tipo, producto/SKU, LPN, datos del cambio, solicitante, fecha
- **Aprobar** → ejecuta acción + inserta movimiento + marca aprobada
- **Rechazar** → motivo inline

---

## Combinar LPNs + LPN Madre (Sprint D · migration 057)

### Combinar (Fusionar)
- Checkboxes en tabla LPN (selección de ≥ 2 del mismo producto)
- Barra flotante con botón "Combinar"
- Modal con 2 modos:
  - **Fusionar**: todo el stock pasa al LPN destino (los otros quedan `activo=false, cantidad=0`)
  - **LPN Madre**: asigna `parent_lpn_id` sin mover stock → los hijos muestran "↳ PLT-001"

---

## Conteo de inventario (migration 050 · v0.83.0)

- Toggle tipo de alcance: **Por ubicación / Por producto / Por marca / Por categoría / Sucursal completa (wall-to-wall)** *(marca/categoría/sucursal desde v1.25.0 — ver abajo)*
- Tabla editable por LPN: cantidad esperada vs contada
- Colores: verde (igual) / ámbar (diferente) / rojo (< 0)
- **Guardar borrador**: no afecta stock
- **Finalizar y ajustar**: aplica `ajuste_ingreso` o `ajuste_rebaje` automáticamente
- Historial de conteos con detalle expandible
- DEPOSITO → ajustes quedan pendientes de aprobación

### Conteos 2.0 — F1: scope ampliado (v1.25.0 · migration 177)

Primera fase del proyecto **Conteos 2.0** (ISS-CONT, relevado con GO — diseño completo en `relevamiento_conteos_respuestas.md`). El conteo deja de ser solo ubicación/producto:

- **Nuevos alcances:** Por **Marca** (pedido original de GO), por **Categoría** y **Sucursal completa (wall-to-wall)**.
- **Mig 177:** CHECK de `inventario_conteos.tipo` ampliado (`+ marca, categoria, sucursal`) + `filtros JSONB` (guarda el criterio cuando no es FK directa: `{marca}` / `{categoria_id, categoria_nombre}`).
- `cargarLineasParaConteo` arma el query dinámico con `productos!inner` para filtrar por `marca`/`categoria_id`. Wall-to-wall trae todo el stock de la sucursal.
- Las marcas/categorías del selector se **derivan del stock de la sucursal activa** (no del maestro entero) → no se ofrecen scopes vacíos.
- **Aislamiento por sucursal:** los scopes amplios (marca/categoría/wall-to-wall) **exigen una sucursal específica** (no "Todas") — guard al cargar + toggles deshabilitados con tooltip. Evita que el ajuste pise stock de otra sucursal.

### Conteos 2.0 — F2a: modos + conteo a ciegas + unidad de medida + secuencia (v1.26.0 · migration 178)

- **Modo de conteo configurable** (`tenants.conteo_modo`, Config → Inventario → Reglas):
  - **Rápido** = informado: precarga la cantidad del sistema (como hasta v1.25.0).
  - **Guiado** = a ciegas: el input arranca vacío y se ocultan las columnas Esperado/Diferencia; el operador cuenta sin ver el sistema (evita el sesgo de confirmar el número). La diferencia se calcula al finalizar.
  - **Elegir** = el operador decide Rápido/Guiado al crear cada conteo (toggle en el form).
- **Revelar (B2):** en guiado, DUEÑO/SUPERVISOR/ADMIN/SUPER_USUARIO puede revelar la cantidad esperada de una fila puntual (botón ojo).
- **Filas en blanco (B3):** `inventario_conteo_items.cantidad_contada` es **nullable**. `NULL` = no contada → se omite del ajuste; `0` = contó y no hay unidades → ajusta. Al finalizar, avisa cuántas filas quedaron sin contar.
- **Input "Contado" respeta la unidad de medida:** unidades/piezas → enteros (step 1, redondeo); kg/gr/lt/ml → decimales (`esDecimal`). Corrige el bug de que la flechita pasaba 15 → 14,999 en productos por unidad.
- **`ubicaciones.secuencia`** (I3): orden de recorrido físico para conteo **y** picking (distinto de `prioridad`, que es orden de rebaje al vender). Editable en Config → Inventario → Ubicaciones. El conteo ordena las líneas por esta secuencia (fallback prioridad → nombre).

### Conteos 2.0 — F3: gate de ajustes + autorizaciones + reconciliación delta (v1.27.0 · migration 179)

- **Gate de aprobación (D):** las diferencias de un conteo no tocan el stock hasta que se aprueban. Config en Config → Inventario → Reglas → "Aprobación de ajustes de conteo": toggle `conteo_gate_activo` + umbrales (unidades / % / valor $). **Gate inactivo → toda diferencia va a aprobación**; activo → solo las que superen algún umbral, el resto se aplica directo.
- **Tab Autorizaciones (D1):** las diferencias que pasan el gate quedan en `autorizaciones_inventario` con `tipo='ajuste_conteo'` (motivo "Diferencia Conteo"); un DUEÑO/SUPERVISOR las aprueba en Inventario → Autorizaciones y ahí se aplican.
- **Reconciliación por delta (G1):** al aplicar (directo o aprobado) se usa `stock_vivo + (contado − esperada_snapshot)` en vez de pisar la cantidad → respeta ventas/movimientos ocurridos durante el conteo. (`reconciliarDelta` en `src/lib/conteoAjuste.ts`, testeada.)
- **Doble conteo (C):** umbrales `conteo_reconteo_umbral_*`; al finalizar, avisa qué filas superan el umbral de discrepancia para recontar (versión "aviso").

### Conteos 2.0 — F2b: scan-to-count (v1.29.0)

- Botón **"Escanear para contar"** en el tab Conteo (cualquier alcance/modo, con líneas cargadas) abre el `BarcodeScanner` en modo **persistente** (sigue escaneando tras cada lectura).
- Cada scan resuelve el código con `resolverScanCompuesto` (GS1, con fallback a `codigo_barras`/`sku`) y **suma a la fila del producto**: la cantidad del AI GS1 `(30)` si el código la trae, si no **+1**.
- Respeta la unidad (enteros vs decimales); ref espejo `conteoRowsRef` para no perder scans rápidos consecutivos; toast `+N Producto → total`.
- Encaja con el **modo a ciegas** (F2a): el operador escanea sin ver el esperado, el sistema acumula el contado.
- `BarcodeScanner` ganó la prop `persistentCloseLabel` (para no decir "Finalizar venta" fuera del POS).
- **Limitación conocida:** si se escanea un producto que no está en el conteo (p.ej. 0 esperado en wall-to-wall) da error en vez de agregar la fila (refinamiento futuro).

### Conteos 2.0 — F4: clase ABC + cíclico + reportes + trazabilidad (v1.29.0 · migration 180)

Cierre del módulo. Panel **"Clasificación ABC y conteo cíclico"** en el historial de conteos (DUEÑO/SUPERVISOR/ADMIN):

- **Clase ABC** (`productos.clase_abc` A/B/C + `clase_abc_manual` + `ultimo_conteo_at`): botón **"Recalcular ABC"** computa client-side la clasificación **Pareto 80/95** por valor de movimiento de los últimos 12 meses (`Σ cantidad × precio_costo_historico` de ventas no anuladas/presupuesto). Los productos sin movimiento → C. Respeta los overrides manuales (3 updates agrupados por clase). Override por producto desde el selector A/B/C del panel (`clase_abc_manual = true`). Lógica: `clasificarABC` en `src/lib/conteoAbc.ts`.
- **Conteo cíclico sugerido** (`tenants.conteo_ciclico_dias_a/_b/_c`, default 30/90/180, editables en Config → Inventario → Reglas): panel **"Conviene contar"** lista los productos vencidos según su clase y la última fecha de conteo (nunca contado = prioridad máxima), ordenados por mayor atraso. Botón **"Contar"** abre un conteo por producto preseleccionado. Sin automatismo (pg_cron no disponible). Lógica: `sugerirConteoCiclico`.
- **Reportes de exactitud + valorización** (`reporteExactitud`): % de exactitud (líneas exactas / contadas) + valor $ faltante/sobrante/neto. Por conteo (barra en el detalle finalizado, con export **Excel**) y **acumulado** (panel, sobre los conteos finalizados cargados).
- **Trazabilidad por operador** (`inventario_conteo_items.contado_por`): se registra quién contó cada ítem; columna "Contado por" en el detalle. `productos.ultimo_conteo_at` se actualiza al finalizar (alimenta el cíclico).

### Conteos 2.0 — cierre 100%: F2b-ref + F3b + A2 (v1.30.0 · migration 181)

Refinamientos que cierran el módulo al 100%:

- **F2b-ref (E3) — escanear fuera de alcance:** durante el scan-to-count, si se escanea un producto que **no está en el alcance** del conteo pero **tiene stock en la sucursal**, se agrega como fila "fuera de alcance" (badge en la tabla) — sirve para detectar mercadería mal ubicada. Si el producto **no tiene stock** en la sucursal, se avisa de forma accionable hacia Ingreso (el alta de stock nuevo sigue siendo del flujo Ingreso, con LPN/lote/serie). `inventario_conteo_items.fuera_de_scope`.
- **F3b — snapshot de costo + doble conteo formal:**
  - `inventario_conteo_items.costo_snapshot`: el costo unitario se congela al cargar la línea, así la valorización es estable aunque cambie `precio_costo` (antes, al continuar un borrador, usaba el precio actual).
  - **Doble conteo formal:** las filas cuyo primer conteo supera el umbral de discrepancia (`conteo_reconteo_*`) exigen un **re-ingreso** (columna "Recontar", idealmente por otro operador) antes de finalizar. Se puede **saltar con clave maestra** (SUPERVISOR/DUEÑO, `verificar_clave_maestra`). Persiste `cantidad_reconteo` + `reconteo_por`; el ajuste usa el valor recontado.
- **A2 — wall-to-wall bloquea la sucursal:** toggle `tenants.conteo_wall_to_wall_bloquea` (Config → Inventario → Reglas, **default OFF**). Al iniciar un conteo de **sucursal completa** con el toggle activo: confirmación de DUEÑO/SUPERVISOR + se crea el borrador con `inventario_conteos.bloquea_movimientos=true`. Mientras esté abierto, el **POS** no permite reservar/despachar (presupuesto sí, no mueve stock) y el **Inventario** no permite ingreso/rebaje en esa sucursal. Hook compartido `useConteoBloqueante`; badge "🔒 Bloqueante" en el historial; se libera al finalizar o eliminar el conteo.

**🎉 Conteos 2.0 (ISS-CONT) cerrado al 100% — F1-F4 + refinamientos en PROD.**

---

## LPN vencidos (Sprint A · migration 051)

- `fecha_vencimiento < hoy` excluye líneas en:
  - `agregarProducto()` en VentasPage
  - `cambiarEstado` reservar
  - `cambiarEstado` despachar
  - Despacho directo
- Sección roja en AlertasPage
- Badge en `useAlertas`
- InventarioPage lee `?search=` al montar y pre-filtra

---

## LPN QR (v0.82.0)

Componente `LpnQR.tsx` en `LpnAccionesModal`:
- Genera QR del LPN con librería `qrcode`
- Descarga PNG
- Ventana imprimible

---

## Series overflow (v0.82.0)

LPNs con muchas series: chips con primeras 5 + badge "+N más" que abre modal con lista completa.

---

## Vista por ubicación

Toggle `LayoutList/Building` en tab Inventario:
- Vista expandible por ubicación con líneas/producto/stock
- Orden: Sin ubicación primero → A-Z
- Acciones LPN disponibles en ambas vistas

---

## Mono-SKU en ubicaciones (migration 052)

`ubicaciones.mono_sku BOOLEAN DEFAULT FALSE`  
Validación en `ingresoMutation`: si la ubicación tiene mono_sku y ya hay otro producto con stock → error descriptivo.

---

## Mover LPN a otra sucursal (migration 051)

Selector de sucursal destino en tab Mover (visible solo con ≥ 2 sucursales).
El nuevo LPN hereda `sucursal_id` seleccionada.

---

## Importar inventario

Página dedicada: `ImportarInventarioPage.tsx` (`/inventario/importar`).
Separada de ImportarProductos desde v0.78.0.

---

## Historial de inventario — filtros

Filtros en tab Historial:
- Rango de fechas (desde/hasta)
- Categoría de producto
- Tipo de movimiento
- Motivo (búsqueda de texto)
- Badge "Conteo" detectado por prefijo en motivo

---

## Reglas de negocio confirmadas (fuente: reglas_negocio.md)

- Precio de costo no obligatorio al ingresar (alerta si queda en $0)
- Producto inactivo: bloqueado para ingreso de stock
- Ubicación DEV (`es_devolucion=true`): excluida de venta pero puede recibir stock manual
- Una serie puede transferirse entre LPNs sin pasar por venta/devolución
- Conteo sin límite de frecuencia sobre cualquier ubicación o producto
- Over-receipt configurable: `tenants.permite_over_receipt BOOLEAN`

---

## Aging Profiles (migration 013)

- Tablas: `aging_profiles` + `aging_profile_reglas` (estado_id, días)
- Asignado por SKU en ProductoFormPage
- Función SQL `process_aging_profiles()` SECURITY DEFINER: calcula días restantes, aplica regla, cambia estado, inserta en actividad_log
- EF `process-aging` + botón manual en ConfigPage → Aging Profiles
- Pendiente: scheduler diario (pg_cron)

---

---

## Stock por sucursal — fix integral (v1.8.17-18 · 2026-05-13)

### getStockAntesSucursal

Helper interno en `InventarioPage` que reemplaza `productos.stock_actual` (global) por la suma de `inventario_lineas.cantidad` filtrada por `sucursal_id` activa.

Corregido en: ingreso simple, rebaje, masivo inline, conteo, autorizaciones (ajuste/serie/LPN), kitting, des-kitting.

### Display en formularios

- "Stock en sucursal: X" cuando hay sucursal activa (query reactiva `staleTime: 0`)
- Columnas "Stock prev./Stock nuevo" **ocultadas** en tabs Agregar y Quitar — solo visibles en Historial (valores históricos son globales, confunden en vista por sucursal)

### Filtros por sucursal en todas las tabs

| Tab | Fix |
|---|---|
| Agregar Stock | Movimientos filtrados por `sucursal_id` ✅ |
| Quitar Stock | `lineas-producto` query filtra por `sucursal_id` ✅ |
| Kits | `stockKitsSucursal` query + helper `kStock()` + iniciarArmado/desarmarKit filtran lineas ✅ |
| Conteos | Historial + carga de líneas filtran por `sucursal_id` ✅ |
| Historial | `applyFilter` en query de movimientos ✅ |

---

## LPN Acciones — mejoras 2026-05-13

- **Tab Editar:** nuevo campo `sucursal_id` (selector de sucursal) para reasignar el LPN completo sin usar el flujo de traslado
- **Tab Mover:** `cantMover` inicializa en `1` cuando hay ≥2 unidades → botón habilitado de inmediato

---

## Bulk Edit de atributos LPN (migration 103 · 2026-05-13)

Cambio masivo de atributos en LPNs seleccionados:

**Acceso:** barra de selección → botón "Editar atributos" (violeta)

**Campos:** sucursal, proveedor, nro_lote, fecha_vencimiento (cualquier combinación con checkbox)

**Flujo DEPOSITO:** genera `autorizaciones_inventario` tipo `bulk_edit` → pendiente de aprobación.

**Flujo otros roles:** aplica directo con `.update().in('id', selectedLineas)`.

**Migration 103:** `linea_id` nullable + tipo `bulk_edit` en CHECK de `autorizaciones_inventario`.

---

## Conteos borrador — mejoras v1.8.23 (ISS-100)

El sistema de conteos mantiene borradores persistentes en DB:

- **Continuar conteo**: desde el historial se puede abrir un conteo en estado `borrador` y seguir cargando cantidades
- **Eliminar borrador**: acción destructiva desde historial (requiere confirmación)
- **Actualizar desde historial**: botón para reabrir y ajustar un borrador existente sin crear uno nuevo
- Los borradores son por sucursal activa; finalizarlos aplica los ajustes como hasta ahora

---

## Rebaje masivo — fix FIFO/FEFO v1.8.23 (ISS-012)

Correcciones en el rebaje masivo por lote:

- **Filtro por sucursal**: las líneas disponibles se filtran por `sucursal_id` activa (antes ignoraba la sucursal)
- **Filtro por ubicación**: respeta el campo `ubicacion` del formulario
- **Preview de LPNs**: muestra qué LPNs específicos se van a consumir antes de confirmar
- **Override**: el operador puede ajustar las cantidades del preview antes de ejecutar
- Aplica correctamente la regla FIFO (por `created_at` ASC) y FEFO (por `fecha_vencimiento` ASC)

---

## Shortcuts teclado en InventarioPage — v1.8.19

Implementado `useModalKeyboard` en todas las secciones:

| Sección | ESC | ENTER |
|---------|-----|-------|
| LpnAccionesModal | Cierra el modal | Guarda (según tab: editar/mover/estructura) |
| Tab Agregar Stock | Limpia selección de producto | Abre modal ingreso |
| Tab Quitar Stock | Limpia selección | Abre modal rebaje |
| Tab Conteos | Cancela conteo en curso | Flujo 3 estados: abrir → cargar → finalizar |

---

## Filtros tab Inventario — pill button (v1.8.28-dev)

- Botón píldora "Filtros" con ícono `SlidersHorizontal` + badge con cantidad de filtros activos
- Popover con: Categoría, Ubicación, Estado, Proveedor + toggle "Solo stock crítico"
- Click fuera cierra el panel
- Las ubicaciones del popover ya están filtradas por sucursal activa
- Filtros filtran el listado de LPNs por sucursal

---

## Defaults del producto al ingresar stock (v1.8.30 + ISS-131 · v1.8.32)

Al seleccionar producto (scan o búsqueda manual), el formulario de ingreso se pre-rellena automáticamente:

| Campo | Fuente |
|-------|--------|
| Ubicación | `producto_ubicacion_sucursal` (sucursal activa) → fallback `productos.ubicacion_id` |
| Estado | `productos.estado_id` |
| Proveedor | `productos.proveedor_id` |

**ISS-131 (v1.8.32):** La query `productosBusqueda` ahora incluye `estado_id` y `proveedor_id` en el SELECT. Antes no los seleccionaba, por lo que los defaults llegaban siempre vacíos.

El operador puede modificar cualquier campo antes de confirmar.

---

## Modales ingreso/quita — UX renovada (v1.8.31-dev)

Ambos modales (Agregar Stock y Quitar Stock) fueron refactorizados para eliminar el doble scrollbar y mejorar la UX mobile:

**Estructura del modal:**
```
Modal: flex flex-col · max-h-[90vh]
├── Header fijo:   título + botón X
├── Search fijo:   input de búsqueda
├── Body scrollable (único overflow-y-auto):
│    ├── Sin producto seleccionado: resultados inline (no dropdown absoluto)
│    └── Con producto seleccionado: chip nombre/SKU/X + formulario completo
└── Footer fijo:   Cancelar + Confirmar (solo visible cuando hay producto)
```

**Cambios clave:**
- Resultados de búsqueda como lista inline dentro del body (no dropdown absoluto sobre el modal)
- Chip con nombre, SKU y botón X para deseleccionar el producto
- Footer con botones solo aparece cuando hay un producto seleccionado
- Un único `overflow-y-auto` en el body — sin doble scrollbar

---

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/alertas]]
- [[wiki/features/wms]]
- [[wiki/features/escaneo-barcode]]
- [[wiki/features/multi-sucursal]]
- [[wiki/features/productos]]
- [[wiki/database/triggers]]
- [[wiki/database/schema-overview]]
