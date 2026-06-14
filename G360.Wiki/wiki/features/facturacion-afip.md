---
title: Facturación Electrónica AFIP
category: features
tags: [afip, facturacion, cae, iva, argentina, fiscal, pdf, qr]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-06-13
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
  afip_produccion BOOLEAN        -- false=homologación / true=producción (mig 210)
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
| Notas de Crédito electrónicas | NC-A/B/C desde devoluciones (`devolucion_id`) | ✅ PROD |
| Envío automático por email | `send-email type=factura_emitida` al emitir | ✅ PROD |
| Modo de emisión por-tenant | `tenants.afip_produccion` (homologación↔producción) | ✅ DEV v1.60.0 |
| Tests de la lógica pura | `facturacionLogic.ts` + 25 unit tests | ✅ DEV v1.60.0 |

---

## Modo de emisión: homologación vs producción (v1.60.0)

El módulo SIEMPRE operó contra **homologación** (sandbox de AFIP — los CAE no tienen
valor fiscal). El pase a **producción** (CAE fiscal real) ahora es un interruptor
**por-tenant**, no global:

- **`tenants.afip_produccion BOOLEAN DEFAULT false`** (mig 210). La EF lo lee como
  fuente de verdad: `isProduction = !masterKill && tenant.afip_produccion === true`.
- **`AFIP_FORCE_HOMOLOGACION=true`** (env var de la EF) = freno de emergencia GLOBAL
  que fuerza homologación para todos. Nunca prende producción.
- **UI:** Config → Facturación → banda "Modo de emisión" (DUEÑO). Pasar a producción
  exige CUIT + Token AfipSDK guardados y una confirmación explícita (checkbox de
  reconocimiento de que se emiten comprobantes fiscales reales). Volver a homologación
  es directo (seguro).
- **Por qué por-tenant y no la env var global anterior (`AFIP_PRODUCTION`):** prenderla
  globalmente pasaba a TODOS los tenants con facturación habilitada a emitir real de
  golpe. El flag por-tenant permite habilitar producción **un cliente a la vez**.

### Consistencia ImpTotal (anti error AFIP 10048)

La EF arma `ImpTotal = ImpNeto + ImpIVA` (no `ventas.total`). Si confiara en
`ventas.total` y este difiriera por redondeo de centavos o por un descuento/recargo
global no prorrateado en los ítems, AFIP rechaza con error 10048 ("ImpTotal no es
igual a la suma…"). Si hay diferencia > $0.50 se loguea un warning para investigar.

---

## Runbook — pasar un tenant a PRODUCCIÓN AFIP

Lo de código ya está listo; lo que sigue es **operativo** (CUIT + certificado) y lo hace
el dueño del tenant. Modelo actual = **AfipSDK cloud** (access_token), no cert local.

1. **CUIT activo** habilitado para "Facturación Electrónica" (WS `wsfe`) en AFIP/ARCA.
2. **Certificado de producción**: en AfipSDK, generar/cargar el certificado y vincularlo
   en AFIP vía **Administrador de Relaciones** al servicio Facturación Electrónica.
3. **Token AfipSDK de producción** (plan pago; homologación es gratis).
4. En Genesis360: **Config → Facturación** → cargar CUIT + condición IVA + razón social
   + domicilio + **Token AfipSDK (prod)** → Guardar datos fiscales.
5. Cargar al menos un **Punto de venta** (debe coincidir con uno habilitado en AFIP).
6. Banda **Modo de emisión** → pasar a **PRODUCCIÓN** (confirmar checkbox).
7. **Smoke real:** emitir una Factura B de monto chico → verificar el CAE en el PDF y en
   "Mis Comprobantes" de AFIP. Los logs de la EF muestran `[PRODUCCIÓN]` vs `[homologación]`.

> Para **probar el flujo completo sin valor fiscal**, dejar `afip_produccion=false`
> (homologación) con el token de homologación: emite CAE de prueba real, sin riesgo.

---

## Decisión técnica: AfipSDK cloud vs self-host (cert .crt/.key local)

Hay dos formas de hablar con AFIP, y conviene tenerlas claras:

- **AfipSDK cloud (actual):** `@afipsdk/afip.js` con `access_token`. AfipSDK resuelve el
  WSAA (firma criptográfica CMS del ticket de login, cache del TA ~12 h) en SUS
  servidores. Simple, ya anda, maneja downtime/retries. **Contras:** un tercero (AfipSDK)
  en el camino fiscal; producción requiere plan pago; hoy cada tenant necesita su propio
  token/cuenta AfipSDK (fricción de onboarding).
- **Self-host (cert local):** firmar el WSAA con el `.crt`/`.key` propios y pegarle directo
  a ARCA, sin tercero. **Contras:** hay que implementar WSAA+WSFE; en **Deno (Supabase
  Edge)** la firma CMS/PKCS7 local es impráctica (cripto limitada) → realista solo
  moviendo la EF a un runtime Node o un microservicio dedicado. Mantenimiento continuo de
  la integración AFIP. Por eso existen servicios como AfipSDK.

**Recomendación:** para el primer cliente, **quedarse en AfipSDK cloud** (es "usar una
librería", lo que el consejo recomienda; solo que usamos la variante cloud). Migrar a
self-host solo si el costo/modelo por-tenant de AfipSDK molesta a escala o se quiere
sacar el tercero — y ahí es un proyecto dedicado, no un swap rápido.

> ⚠ **Deuda / trampa de UX:** Config tiene un uploader de certificados `.crt`/`.key`
> (`tenant_certificates` + bucket `certificados-afip`, mig 043) que la EF **NO usa** (usa
> el token). Subir certs ahí hoy no hace nada. Solo tendría sentido si se migra a
> self-host; mientras tanto conviene ocultarlo/relabelearlo para no confundir.

---

## Riesgos

1. **Numeración correlativa** — `getLastVoucher + 1` tiene condición de carrera si hay
   emisiones concurrentes (mismo PV/tipo). Bajo para un mostrador single-cajero; revisar
   si crece el volumen.
2. **AFIP WSFE tiene downtime** — AfipSDK reintenta; igual el toast informa el error.
3. **Clientes sin CUIT** — Factura A exige CUIT del cliente (la EF lanza error claro).
4. **CUIT inactivo del dueño** → usar el CUIT del cliente/empresa que factura.
5. **ImpTotal** — ver "Consistencia ImpTotal" arriba (resuelto en v1.60.0).

---

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/architecture/edge-functions]]
- [[wiki/database/schema-overview]]
