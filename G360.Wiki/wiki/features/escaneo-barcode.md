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
| `@undecaf/zbar-wasm` | Fallback WASM — iOS, Firefox, Desktop (1D + QR) |
| `@zxing/library` | Fallback **DataMatrix** (ISS-127 F3) — zbar no lo decodifica. Se carga y corre solo si el primario no cubre data_matrix; restringido a DATA_MATRIX + throttle 1/3 frames |
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

## Códigos compuestos GS1 (ISS-127)

Subsistema para leer/generar códigos que codifican **varios campos a la vez** (estándar GS1), grado WMS. Distinto del scan de valor único: un mismo código lleva GTIN + lote + vencimiento + cantidad + serie + etc.

### Modelo

- **`codigo_perfiles`** (mig 157): perfiles configurables. `tipo` `gs1`|`custom`, `simbologia` `gs1_128`|`datamatrix`|`qr`, `ais` (lista de AIs a generar; default `["01","10","17","30"]`), `custom_format` (override no-GS1: separador), `lectura_modo` `autocompletar`|`directo`, `proveedor_id` opcional. RLS por tenant.
- **`productos.gtin`** (mig 158): GTIN dedicado (GS1 AI 01) para el match; fallback a `codigo_barras` si NULL.

### Librería `src/lib/gs1.ts`

- `parseGS1(raw)` → `{gtin, lote, vencimiento, produccion, cantidad, serie, precio}`. Maneja FNC1 (`\x1d`), strip de prefijo de simbología (`]C1`/`]d2`/`]Q3`), AIs fijos/variables, fechas `YYMMDD` (día 00 → último del mes), precio `392x` con decimales.
- `buildGS1ElementString(fields, ais)` → element string con paréntesis (`(01)...(10)...`) apto para bwip-js. La cantidad **siempre** se emite como `(30)`.
- `looksLikeGS1(raw)` → distingue un GS1 compuesto de un EAN/SKU plano (clave para no parsear un EAN como GS1).
- `gtinCheckDigit(body)` / `isValidGtin(code)` → validan el dígito verificador GS1 (mod-10).
- `normalizeGtin`, `isoToYYMMDD`, `yymmddToISO`, `AIS_SOPORTADOS`.
- **AIs soportados:** GTIN(01), Lote(10), Vencimiento(17), Producción(11), Serie(21), **Cantidad(30)**, Precio(392x). *(El AI 37 NO se usa: requiere contexto logístico SSCC/02; para "cantidad de unidades" el correcto es 30.)*

### Generación

- **`bwip-js@4`** genera **GS1-128 (1D), GS1 DataMatrix (2D) y GS1 QR Code (2D)**. `bcid`: `gs1-128` / `gs1datamatrix` / `gs1qrcode`. Solo el 1D usa height + texto legible. Import browser: `bwip-js/browser`.
- **`CodigoCompuestoModal`**: desde un LPN (en `LpnAccionesModal`, botón al lado del QR) toma los datos reales del LPN (lote/venc/cantidad/serie/precio) + GTIN del producto y renderiza el código según el perfil elegido. Descargar / imprimir.

### Config

- **Config → Inventario → Códigos** (`CodigoPerfilesPanel`): CRUD de perfiles (nombre, proveedor, tipo, simbología, AIs por chips, modo de lectura, activar/desactivar).

### Lectura en Ingreso (F2)

- **`gs1.ts → looksLikeGS1(raw)`**: heurística que distingue un GS1 compuesto de un EAN/SKU plano (prefijo de simbología, FNC1, o AI 01 + 14 dígitos + más datos). **Crítico**: si da false NO se parsea (un EAN se interpretaría mal). Verificado: EAN-13/SKU → plano, GS1-128/FNC1/sin-separador → GS1.
- **`src/lib/scanCompuesto.ts → resolverScanCompuesto(code, tenantId)`**: si `looksLikeGS1`, parsea + matchea el producto por **GTIN** (varias normalizaciones: 14/13 dígitos y sin ceros) con **fallback a `codigo_barras`**, y resuelve el `lectura_modo` (perfil del proveedor → perfil único → `autocompletar`). Devuelve `null` si no es GS1 (el caller cae a la búsqueda plana).
- **InventarioPage**:
  - **Ingreso individual** (`handleBarcodeScan`): scan GS1 → selecciona el producto + autocompleta **lote / vencimiento / cantidad** del form. Toast con el resumen. Si el GTIN no matchea, avisa que falta cargarlo.
  - **Ingreso masivo** (`handleMasivoScan` + `addMasivoRow(prod, overrides)`): scan GS1 → agrega la fila con lote/venc/cantidad pre-cargados. Acelera la carga por bulto.

### Estado / fases

- **F1 ✅ (fundación)**: modelo + `gs1.ts` + Config de perfiles + generación desde LPN.
- **F2 ✅ (lectura ingreso)**: detección GS1 + parseo + match GTIN→producto (fallback codigo_barras) + autocompletado en ingreso individual y masivo.
- **F3 ✅ (completa)**:
  - **DataMatrix lectura** con `@zxing/library` (fallback en `BarcodeScanner` cuando zbar/BarcodeDetector no cubren data_matrix).
  - **Ventas/POS** (`procesarScan`): scan GS1 → identifica el producto por GTIN (fallback codigo_barras) y suma al carrito con la **cantidad** del código (AI 30).
  - **Recepciones**: botón de scanner nuevo en el buscador (`handleScanRecepcion`) → agrega el ítem con lote/venc/cantidad pre-cargados (`agregarProducto` con overrides).
  - **Rebaje**: el scanner compartido identifica el producto por GTIN; un effect auto-selecciona la **línea por lote** (`pendingRebaje`) y setea la cantidad.
  - **Modo `directo`**: si el perfil tiene `lectura_modo='directo'`, un effect guardado (`directoFiredRef`) auto-crea el LPN tras autocompletar el ingreso.
  - **Generación masiva** (`CodigoMasivoModal`): seleccionando varios LPNs en Inventario → botón "Etiquetas GS1" → hoja imprimible con todos los códigos (marca los que no tienen GTIN válido).

> [!NOTE] Lectura por simbología: **GS1-128 (1D)** se lee en todos lados (BarcodeDetector nativo + zbar). **DataMatrix (2D)** se lee con BarcodeDetector nativo (Chrome/Edge/Android) y, donde no está, con **ZXing** (iOS/Firefox/Desktop). **QR** lo cubren BarcodeDetector + zbar.

### Gotchas GS1 (aprendido en QA — v1.11.5/6)

- **AI cantidad = 30, no 37.** bwipp rechaza `(37)` suelto (`GS1missingAIs`: requiere SSCC `00` o `02`). El encoder siempre emite `(30)`.
- **El GTIN necesita dígito verificador válido.** bwipp tira `GS1badChecksum` si no. El modal valida con `isValidGtin` y **sugiere el dígito correcto** (vía `gtinCheckDigit`) antes de llamar a bwip-js. Un EAN-13 válido → GTIN-14 válido (el `0` a la izquierda no altera el check digit).
- **`bcid` de QR = `gs1qrcode`** (sin guión; `gs1-qrcode` no existe en bwipp).
- **Opciones `undefined` rompen bwipp** (`invalidOptionType`). Las opciones se arman condicionalmente: solo el 1D lleva `height`/`includetext`; nunca pasar una clave en `undefined`.
- **Sin GTIN no hay código GS1 válido.** Si el producto no tiene `gtin` ni `codigo_barras`, o el perfil no incluye `(01)`, el modal muestra un mensaje accionable en vez del error críptico.
- **Detección antes de parsear**: nunca correr `parseGS1` sobre un código plano — `looksLikeGS1` decide; si es plano, se cae a la búsqueda por `codigo_barras`/`sku`.

---

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/ventas-pos]]
- [[wiki/architecture/edge-functions]]
