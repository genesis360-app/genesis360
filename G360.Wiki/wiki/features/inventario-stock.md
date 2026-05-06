---
title: Inventario y Stock
category: features
tags: [inventario, lpn, movimientos, fifo, fefo, stock, autorizaciones, conteos]
sources: [CLAUDE.md, reglas_negocio.md]
updated: 2026-04-30
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
4. **Kits** — CRUD recetas, ejecutar kitting/des-kitting
5. **Conteos** — conteo por ubicación o producto con ajuste automático
6. **Historial** — movimientos con filtros fecha/cat/tipo/motivo
7. **Autorizaciones** — aprobación de cambios solicitados por DEPOSITO

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

- Toggle tipo: Por ubicación / Por producto
- Tabla editable por LPN: cantidad esperada vs contada
- Colores: verde (igual) / ámbar (diferente) / rojo (< 0)
- **Guardar borrador**: no afecta stock
- **Finalizar y ajustar**: aplica `ajuste_ingreso` o `ajuste_rebaje` automáticamente
- Historial de conteos con detalle expandible
- DEPOSITO → ajustes quedan pendientes de aprobación

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

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/alertas]]
- [[wiki/features/wms]]
- [[wiki/features/escaneo-barcode]]
- [[wiki/database/triggers]]
- [[wiki/database/schema-overview]]
