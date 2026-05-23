---
title: Escaneo de Barcode y QR
category: features
tags: [scanner, barcode, qr, wasm, claude-vision, zbar, scan-ticket, recepciones, productos]
sources: [CLAUDE.md]
updated: 2026-05-20
---

# Escaneo de Barcode y QR

**Componente:** `src/components/BarcodeScanner.tsx`

---

## Stack técnico

| Librería | Rol |
|---------|-----|
| `BarcodeDetector` (nativo) | Primera opción — Chrome/Edge/Android |
| `@undecaf/zbar-wasm` | Fallback WASM — iOS, Firefox, Desktop |
| `html5-qrcode` | Manejo de cámara y permisos |
| `qrcode` | Generación de QR (no lectura) |

**Formatos soportados:** EAN-13, EAN-8, UPC-A, UPC-E, Code-128, Code-39, QR, PDF417 y más.

---

## UX del scanner

- Línea laser animada
- Flash verde al detectar
- Beep (Web Audio API)
- Vibración háptica
- **Modo manual**: teclado + lector físico USB/Bluetooth (input text)

---

## Dónde está integrado

| Módulo | Uso |
|--------|-----|
| InventarioPage — Agregar Stock | Busca por código de barras o SKU exacto |
| InventarioPage — Quitar Stock | Ídem |
| InventarioPage — Masivo Agregar Stock | Cola secuencial: scan → foco Cantidad → Enter → sig. SKU |
| VentasPage — carrito | Suma cantidad si mismo producto ya en carrito |
| ProductoFormPage — campo barcode | Completa solo el campo `codigo_barras` |

---

## Cola secuencial de scans (VentasPage)

Scans rápidos del mismo producto se encolan con `scanQueueRef` + `scanProcessingRef`:
- `processNext()` procesa de a uno (garantiza orden correcto)
- Elimina duplicados por concurrencia
- Previene stale closure en el carrito

---

## Completar producto desde foto (IA)

**Edge Function `scan-product`:**
1. Frontend envía imagen base64
2. EF llama a `claude-haiku-4-5-20251001`
3. Claude detecta el código de barras de la imagen
4. Si hay barcode → consulta Open Food Facts para datos del producto
5. Retorna barcode + datos al frontend

**Flujo con 2 fotos:**
- Foto 1 (frente) + Foto 2 (reverso) combinan datos sin pisar campos ya detectados

> [!WARNING] Requiere `ANTHROPIC_API_KEY` válida con créditos en console.anthropic.com.

---

## Escaneo de ticket de compra (v1.8.38)

**Edge Function `scan-ticket`** (Claude Sonnet 4.6 vision):

Analiza la foto de un ticket de supermercado y extrae la lista de productos con barcode, nombre, cantidad y precio unitario.

### Imagen procesada en frontend antes de enviar
- Canvas API: redimensiona a max 1200px, convierte a JPEG 82%
- Reduce fotos de 3-5MB a ~150-400KB (evita límite de payload de la EF)
- Normaliza formatos: HEIC (iPhone), PNG, WebP → siempre JPEG

### Integración en RecepcionesPage
**Botón "Escanear ticket"** en la sección "Productos a recibir":
1. Upload/cámara → envía a `scan-ticket` EF
2. Muestra tabla editable con:
   - ✅ Verde: producto encontrado en catálogo (por SKU/barcode o nombre fuzzy)
   - ❌ Gris: no encontrado — no se carga al formulario
3. Cantidad y precio unitario editables antes de confirmar
4. "Cargar N productos al formulario" → pre-popula `FormItem[]` con `precio_costo` del ticket

**Matching:**
1. Por barcode → `sku = barcode` (coincidencia exacta)
2. Por nombre → `nombre.ilike.%primeras-2-palabras%` (fuzzy match)

### Integración en ProductosPage
**Botón "Escanear ticket"** en el toolbar junto a "Nuevo producto":
1. Misma captura/compresión de imagen
2. Tabla de resultados con 3 estados por producto:
   - ✅ Sin cambios (mismo precio ±$0.50)
   - ⚠️ Precio diferente → "BD: $800 → Ticket: $950" + toggle actualizar
   - ➕ No en catálogo → nombre editable + input precio de venta → crear
3. Botón X por fila para omitir
4. "Aplicar cambios" ejecuta updates de `precio_costo` e inserts de productos nuevos
5. SKU auto-generado: barcode si disponible, o `NOMBRE-{ts}{idx}` si no

> [!TIP] La EF siempre retorna HTTP 200 (incluso en error) con `{ error: '...' }` o `{ items: [...] }` para que el frontend muestre el mensaje real en lugar del genérico de Supabase.

---

## QR de LPN

**Componente `LpnQR.tsx`** (en `LpnAccionesModal`):
- Genera QR del LPN con la librería `qrcode`
- Descarga como PNG
- Abre ventana imprimible

---

## Búsqueda por código de barras

`InventarioPage` y búsqueda de productos en VentasPage incluyen `codigo_barras` en los filtros del lado de la DB y del cliente.

---

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/ventas-pos]]
- [[wiki/architecture/edge-functions]]
