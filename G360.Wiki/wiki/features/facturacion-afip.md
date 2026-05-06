---
title: Facturación Electrónica AFIP
category: features
tags: [afip, facturacion, cae, iva, argentina, fiscal, pdf, qr]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-05-05
---

# Facturación Electrónica AFIP

Módulo de facturación electrónica conforme a RG 5616 AFIP. Implementado en v1.3.0 PROD ✅.  
**PDF con QR AFIP implementado en v1.5.0 PROD ✅** (RG 4291 — obligatorio desde 2021).

> [!NOTE] Homologación confirmada: CAE `86170057489609` emitido exitosamente (Factura B, CUIT de prueba `20409378472`).

---

## Decisión técnica

**Integración propia con AFIP WSFE** (sin intermediario):
- Break-even vs. servicio tercero (~$300 USD/mes a 20 tenants) en 6-8 meses
- SDK: `@afipsdk/afip.js` vía `npm:` en Deno (no requiere certificados propios por ahora)
- Acceso: AfipSDK cloud service + `access_token` por tenant

---

## Tipos de comprobante (RG 5616)

| Emisor | Receptor | Tipo | CbteTipo | CondicionIVAReceptorId |
|--------|---------|------|---------|----------------------|
| RI | RI | **Factura A** — discrimina IVA | 1 | 1 |
| RI | CF / Monotributista | **Factura B** — IVA incluido | 6 | 5 / 4 |
| Monotributista | Cualquiera | **Factura C** — sin IVA | 11 | según |
| Cualquiera | — | NC-A / NC-B / NC-C | 3/8/13 | — |

> [!TIP] El tridente A/B/C cubre el 99% de los comercios de Genesis360. NC-A/B/C para devoluciones.

---

## Umbral Factura B

- Venta **menor al umbral** (configurable en DB) → "Consumidor Final", sin datos del comprador
- Venta **mayor o igual al umbral** → DNI/CUIT + nombre obligatorio (auto-validación en checkout)

---

## FacturacionPage — 4 tabs

1. **Panel de Control** — KPIs: IVA Débito / IVA Crédito / Posición IVA · Datos fiscales · Disclaimer
2. **Facturación** — Borradores (ventas sin CAE) · Historial emitidas · Modal emitir A/B/C · **Botón PDF con QR**
3. **Libros IVA** — Libro Ventas (débito) y Compras (crédito) · Filtros por alícuota · Exportar Excel · Conciliación
4. **Liquidación** — Historial 12 meses · Retenciones sufridas · Disclaimer legal

---

## PDF con QR AFIP — v1.5.0 ✅

**`src/lib/facturasPDF.ts`** — layout A4 completo:
- Datos del emisor (razón social, CUIT, domicilio fiscal, condición IVA)
- Datos del receptor (CUIT, nombre, condición IVA)
- Ítems con IVA desglosado por tasa
- Totales (neto + IVA por alícuota + total)
- **QR AFIP** (RG 4291): JSON del comprobante → base64 → URL `https://www.afip.gob.ar/fe/qr/?p=<base64>`

**Acceso al botón PDF:**
- FacturacionPage → historial de emitidas (cualquier comprobante con CAE)
- VentasPage → modal detalle de venta cuando `venta.cae !== null`

---

## Prompt "¿Facturar ahora?" al despachar

Si `facturacion_habilitada=true` y CUIT configurado → modal automático post-despacho:
- Auto-detección del tipo: Monotributista → C · cliente RI → A · resto → B
- Selector de punto de venta (desde `puntos_venta_afip` o input manual, lazy-loaded)
- Botón "Emitir Factura X" → llama EF `emitir-factura` → CAE en toast
- Botón "Saltar" → cierra sin facturar (venta ya despachada)
- Aplica en `registrarVenta` y `cambiarEstado → despachada`

---

## Edge Function `emitir-factura`

1. Recibe: `venta_id`, `tipo_comprobante`, `punto_venta`
2. Calcula neto/IVA por alícuota desde `venta_items`
3. Determina `DocTipo` automático (CF=99 / DNI=96 / CUIT=80) + aplica umbral RG 5616
4. Mapea `CondicionIVAReceptorId` desde `clientes.condicion_iva_receptor`
5. Llama AFIP WSFE vía AfipSDK
6. Guarda `cae`, `vencimiento_cae`, `tipo_comprobante`, `numero_comprobante` en `ventas`

---

## Configuración del tenant (ConfigPage → Negocio)

```sql
tenants:
  facturacion_habilitada BOOLEAN
  cuit TEXT
  condicion_iva_emisor TEXT      -- RI / Mono / Exento
  razon_social_fiscal TEXT
  domicilio_fiscal TEXT
  umbral_factura_b DECIMAL
  afipsdk_token TEXT             -- oculto en UI
```

**Puntos de venta AFIP:** CRUD colapsable → `puntos_venta_afip(id, sucursal_id, numero, nombre, activo)`

---

## Campos en Clientes

- `cuit_receptor TEXT` — obligatorio para Factura A
- `condicion_iva_receptor TEXT` — `CF` / `RI` / `Mono` / `Exento`
- Visibles en card expandido del cliente

---

## Schema DB (migrations 076-077)

```sql
puntos_venta_afip(id, tenant_id, sucursal_id, numero, nombre, activo)
retenciones_sufridas(id, tenant_id, tipo, agente, monto, fecha, periodo)
gastos.conciliado_iva BOOLEAN
```

---

## Infraestructura pre-existente

- `tenant_certificates` + bucket `certificados-afip` — migration 043
- `cae`, `vencimiento_cae`, `tipo_comprobante`, `numero_comprobante`, `link_factura_pdf` en `ventas` — migration 060
- `alicuota_iva` en `productos` + `iva_monto` en `venta_items` — migration 042

---

## Estado por fase

| Fase | Descripción | Estado |
|------|-------------|--------|
| Config + datos maestros | Toggle, CUIT, condición IVA, umbral, puntos de venta | ✅ PROD v1.3.0 |
| Emisión CAE | EF `emitir-factura` + prompt al despachar | ✅ PROD v1.3.0 |
| PDF con QR AFIP | `facturasPDF.ts` + RG 4291 | ✅ PROD v1.5.0 |
| Notas de Crédito electrónicas | NC en devoluciones | 🔵 Pendiente |
| Envío automático por email | Al emitir factura | 🔵 Pendiente |

---

## Riesgos

1. **Numeración correlativa** — bugs de duplicados/saltos son graves para AFIP
2. **AFIP WSFE tiene downtime** — retry robusto necesario
3. **Clientes sin CUIT** — flujo de completar datos antes de emitir
4. **CUIT inactivo del dueño** → usar CUIT de empresa cuando se constituya

---

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/architecture/edge-functions]]
- [[wiki/database/schema-overview]]
