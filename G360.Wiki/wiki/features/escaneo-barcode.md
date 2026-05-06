---
title: Escaneo de Barcode y QR
category: features
tags: [scanner, barcode, qr, wasm, claude-haiku, zbar]
sources: [CLAUDE.md]
updated: 2026-04-30
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
2. EF llama a `claude-haiku-4-5-20251001` (~$0.003/imagen)
3. Claude detecta el código de barras de la imagen
4. Si hay barcode → consulta Open Food Facts para datos del producto
5. Retorna barcode + datos al frontend

**Flujo con 2 fotos:**
- Foto 1 (frente) + Foto 2 (reverso) combinan datos sin pisar campos ya detectados

> [!WARNING] Requiere `ANTHROPIC_API_KEY` válida con créditos en console.anthropic.com. Si la clave vence, el scanner físico sigue funcionando pero el fallback por foto deja de estar disponible.

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
