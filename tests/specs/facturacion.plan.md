# Plan de escenarios — Facturación electrónica AFIP/ARCA

Fuente de verdad de la lógica pura: `src/lib/facturacionLogic.ts` (espejo testeable de la
Edge Function `emitir-factura` + auto-detección del frontend + QR del PDF).
Tests: `tests/unit/facturacion.test.ts`.

## 1. Auto-detección del tipo de comprobante — `detectarTipoComprobante` (FAC-TIPO)

- FAC-TIPO-01: emisor Monotributista → **C** (sin importar el receptor).
- FAC-TIPO-02: emisor RI + receptor RI → **A** (discrimina IVA).
- FAC-TIPO-03: emisor RI + receptor CF → **B**.
- FAC-TIPO-04: emisor RI + receptor Monotributista → **B**.
- FAC-TIPO-05: emisor RI + receptor sin dato → **B**.
- FAC-TIPO-06: emisor sin dato → **B** (default seguro).

## 2. Desglose de IVA por alícuota — `calcularIvaDesglose` (FAC-IVA)

El precio de venta YA incluye IVA → el neto se obtiene desarmando la tasa.

- FAC-IVA-01: 1 ítem 21% (subtotal 1210) → neto 1000, IVA 210, impTotal 1210, array `[{Id:5,BaseImp:1000,Importe:210}]`.
- FAC-IVA-02: multi-alícuota (21% 1210 + 10.5% 1105) → neto 2000, IVA 315, impTotal 2315.
- FAC-IVA-03: exento → IVA 0, neto = subtotal, Id 3.
- FAC-IVA-04: 0% → IVA 0, Id 3.
- FAC-IVA-05: sin subtotal → usa precio_unitario × cantidad.
- FAC-IVA-06: alícuota numérica (21) equivalente al string '21'.
- FAC-IVA-07: impTotal SIEMPRE = neto + IVA (invariante anti error AFIP 10048).

## 3. Documento del receptor — `determinarReceptor` (FAC-DOC)

- FAC-DOC-01: Factura B bajo umbral, CF → DocTipo 99 / DocNro 0 / condId 5.
- FAC-DOC-02: Factura B ≥ umbral con DNI → DocTipo 96 / DocNro = DNI sin puntos.
- FAC-DOC-03: Factura B ≥ umbral sin DNI → cae a 99/0.
- FAC-DOC-04: Factura A con CUIT → DocTipo 80 / DocNro = CUIT sin guiones.
- FAC-DOC-05: Factura A sin CUIT → lanza error.
- FAC-DOC-06: condicionIvaReceptorId mapea RI→1, CF→5, Mono→4, Exento→2.
- FAC-DOC-07: umbral configurable por tenant respetado.

## 4. QR fiscal RG 4291 — `buildQrAfipUrl` (FAC-QR)

- FAC-QR-01: URL con prefijo `https://www.afip.gob.ar/fe/qr/?p=` + payload base64 decodable.
- FAC-QR-02: campos del payload (ver=1, fecha recortada a 10, cuit/codAut numéricos, tipoCmp).
- FAC-QR-03: receptor CUIT (11 díg) → tipoDocRec 80.
- FAC-QR-04: receptor DNI (7-10 díg) → tipoDocRec 96.
- FAC-QR-05: receptor vacío → tipoDocRec 99, nroDocRec 0.

## Fuera de alcance unit (e2e / manual con ARCA)

- WSAA login + CAE real contra homologación/producción (depende de cert + token AfipSDK).
- Numeración correlativa real (getLastVoucher + 1) y su condición de carrera.
- Render del PDF (jsPDF) y lectura del QR por la app de AFIP.
